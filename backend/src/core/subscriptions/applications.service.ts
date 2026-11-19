import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { randomBytes } from 'crypto';
import { DataSource, EntityManager, In } from 'typeorm';
import { AuthUser } from '../auth/decorators';
import { Organization, OrganizationModule, User } from '../entities';
import { FileStore } from '../files/file-store.service';
import { MailService } from '../mail/mail.service';
import { publicOrigin, templates } from '../mail/mail-templates';
import { ModuleCatalogService } from '../modules/module-catalog.service';
import { addDays, todayRiyadh } from '../organizations/org-access';
import { ContractsService, nextNumber } from './contracts.service';
import { ApplicationEvent, SubscriptionApplication, SubscriptionContract } from './entities';
import { AccessDto, AdminApplicationDto, ApplicationDto, ApproveDto, UpdateApplicationDto } from './subscriptions.dto';

const event = (step: ApplicationEvent['step'], by: string, note?: string): ApplicationEvent =>
  ({ step, by, at: new Date().toISOString(), ...(note ? { note } : {}) });

const FILE_FOLDER = 'platform/licenses';

/**
 * طلبات اشتراك الجمعيات: التقديم (من صفحة التسجيل العامة أو من مدير المنصة)،
 * والإرجاع للاستكمال، والرفض، والاعتماد الذي ينشئ الجمعية ومدير نظامها ومسودة العقد.
 */
@Injectable()
export class ApplicationsService {
  constructor(
    private readonly db: DataSource,
    private readonly files: FileStore,
    private readonly catalog: ModuleCatalogService,
    private readonly contracts: ContractsService,
    private readonly mail: MailService,
  ) {}

  private fields(dto: ApplicationDto | UpdateApplicationDto, current?: SubscriptionApplication) {
    const contact = (prefix: 'director' | 'board') => {
      const base = prefix === 'director' ? current?.executiveDirector : current?.boardMember;
      const d = dto as Record<string, string | undefined>;
      return {
        name: d[`${prefix}Name`] ?? base?.name ?? '',
        ...(prefix === 'board' ? { position: d.boardPosition ?? base?.position ?? '' } : {}),
        phone: d[`${prefix}Phone`] ?? base?.phone ?? '',
        email: d[`${prefix}Email`] ?? base?.email ?? '',
      };
    };
    const v = <K extends keyof ApplicationDto>(k: K) => dto[k] as ApplicationDto[K] | undefined;
    return {
      ...(v('orgName') !== undefined && { orgName: v('orgName') }),
      ...(v('proposedSlug') !== undefined && { proposedSlug: v('proposedSlug') }),
      ...(v('city') !== undefined && { city: v('city') }),
      ...(v('orgEmail') !== undefined && { orgEmail: v('orgEmail') }),
      ...(v('orgPhone') !== undefined && { orgPhone: v('orgPhone') }),
      ...(v('licenseNumber') !== undefined && { licenseNumber: v('licenseNumber') }),
      ...(v('licenseStartDate') !== undefined && { licenseStartDate: v('licenseStartDate') }),
      licenseEndDate: v('licenseEndDate') ?? (current ? current.licenseEndDate : null),
      ...(v('adminFullName') !== undefined && { adminFullName: v('adminFullName') }),
      ...(v('adminEmail') !== undefined && { adminEmail: v('adminEmail') }),
      executiveDirector: contact('director'),
      boardMember: contact('board'),
    };
  }

  private async assertAdminEmailFree(em: EntityManager, email: string | undefined, exceptId?: string) {
    if (!email) return;
    if (await em.exists(User, { where: { email } })) throw new ConflictException('بريد مدير النظام مستخدم بالفعل في المنصة');
    const pending = await em.findOne(SubscriptionApplication, { where: { adminEmail: email, status: In(['submitted', 'returned']) } });
    if (pending && pending.id !== exceptId) throw new ConflictException('يوجد طلب اشتراك قيد المراجعة بنفس بريد مدير النظام');
  }

  private assertDates(start?: string, end?: string | null) {
    if (start && start > todayRiyadh()) throw new BadRequestException('تاريخ بداية الترخيص لا يكون في المستقبل');
    if (start && end && end < start) throw new BadRequestException('تاريخ نهاية الترخيص قبل تاريخ بدايته');
  }

  /**
   * تقديم طلب اشتراك. من صفحة التسجيل العامة: ملف الترخيص وحساب مدير النظام إلزاميان.
   * من مدير المنصة مع organizationId: استكمال البيانات الرئيسية لجمعية قائمة (يُعتمد مباشرة).
   */
  async submit(dto: AdminApplicationDto, file: Express.Multer.File | undefined, actor?: AuthUser) {
    const linking = !!(actor && dto.organizationId);
    if (!linking && (!dto.adminFullName || !dto.adminEmail || !dto.adminPassword)) {
      throw new BadRequestException('أكمل بيانات حساب مدير النظام (الاسم والبريد وكلمة المرور)');
    }
    this.assertDates(dto.licenseStartDate, dto.licenseEndDate);
    const stored = await this.files.save(FILE_FOLDER, file, 'مستند الترخيص');
    try {
      const result = await this.db.transaction(async (em) => {
        let org: Organization | null = null;
        if (linking) {
          org = await em.findOne(Organization, { where: { id: dto.organizationId } });
          if (!org) throw new NotFoundException('الجمعية غير موجودة');
          if (await em.exists(SubscriptionApplication, { where: { organizationId: org.id } })) {
            throw new ConflictException('للجمعية بيانات رئيسية مسجلة بالفعل. عدّلها بدل إنشاء جديدة');
          }
        } else {
          await this.assertAdminEmailFree(em, dto.adminEmail);
        }
        const by = actor ? actor.fullName : dto.directorName;
        const app = em.create(SubscriptionApplication, {
          ...this.fields(dto),
          number: await nextNumber(em, 'subscription_applications', 'SUB'),
          token: randomBytes(24).toString('hex'),
          status: linking ? 'approved' : 'submitted',
          proposedSlug: org?.slug ?? dto.proposedSlug,
          adminFullName: dto.adminFullName ?? '',
          adminEmail: dto.adminEmail ?? '',
          adminPasswordHash: dto.adminPassword ? await bcrypt.hash(dto.adminPassword, 12) : null,
          licenseFileKey: stored.key, licenseFileMime: stored.mime, licenseFileName: stored.name,
          organizationId: org?.id ?? null,
          decidedAt: linking ? new Date() : null,
          history: [event('submitted', by, linking ? 'استكمال البيانات الرئيسية لجمعية قائمة' : actor ? 'سجّله مدير المنصة' : undefined)],
        });
        const saved = await em.save(app);
        const token = app.token;
        return { id: saved.id, number: saved.number, token };
      });
      return result;
    } catch (e) {
      await this.files.remove(stored.key);
      throw e;
    }
  }

  // ---------- متابعة الطلب عند الجمعية (برابط سري) ----------

  private async byToken(em: EntityManager, token: string) {
    if (!/^[a-f0-9]{48}$/.test(token)) throw new NotFoundException('الرابط غير صحيح');
    const app = await em.findOne(SubscriptionApplication, { where: { token }, relations: { organization: true } });
    if (!app) throw new NotFoundException('الطلب غير موجود');
    return app;
  }

  async track(token: string) {
    const app = await this.byToken(this.db.manager, token);
    const contract = app.organizationId
      ? await this.db.getRepository(SubscriptionContract).findOne({
        where: { organizationId: app.organizationId, status: In(['sent', 'changes_requested', 'signed']) },
        order: { createdAt: 'DESC' }, select: { id: true, number: true, status: true, token: true },
      })
      : null;
    const org = app.organization;
    return {
      number: app.number, status: app.status, reviewNote: app.reviewNote, createdAt: app.createdAt, decidedAt: app.decidedAt,
      data: this.publicData(app),
      history: app.history.map(({ step, at, note }) => ({ step, at, note })),
      organization: org ? {
        name: org.name, slug: org.slug, subscriptionStatus: org.subscriptionStatus, trialEndsOn: org.trialEndsOn,
        subscriptionEndsOn: org.subscriptionEndsOn,
      } : null,
      contract: contract ? { number: contract.number, status: contract.status, path: `/contract/${contract.token}` } : null,
    };
  }

  /** البيانات الرئيسية بدون الحقول الداخلية */
  private publicData(a: SubscriptionApplication) {
    return {
      orgName: a.orgName, proposedSlug: a.proposedSlug, city: a.city, orgEmail: a.orgEmail, orgPhone: a.orgPhone,
      licenseNumber: a.licenseNumber, licenseStartDate: a.licenseStartDate, licenseEndDate: a.licenseEndDate,
      licenseFileName: a.licenseFileName,
      directorName: a.executiveDirector.name, directorPhone: a.executiveDirector.phone, directorEmail: a.executiveDirector.email,
      boardName: a.boardMember.name, boardPosition: a.boardMember.position ?? '', boardPhone: a.boardMember.phone, boardEmail: a.boardMember.email,
      adminFullName: a.adminFullName, adminEmail: a.adminEmail,
    };
  }

  /** الجمعية تعدّل طلبها المُعاد للاستكمال وتعيد تقديمه */
  async resubmit(token: string, dto: UpdateApplicationDto, file?: Express.Multer.File) {
    const app = await this.byToken(this.db.manager, token);
    if (app.status !== 'returned') throw new BadRequestException('لا يمكن تعديل الطلب إلا بعد إعادته للاستكمال');
    await this.applyUpdate(app.id, dto, file, null);
    return this.track(token);
  }

  // ---------- مدير المنصة ----------

  async list(status?: string) {
    const rows = await this.db.getRepository(SubscriptionApplication).find({
      where: status ? { status: status as SubscriptionApplication['status'] } : {},
      relations: { organization: true },
      order: { createdAt: 'DESC' },
    });
    return rows.map((a) => ({
      id: a.id, number: a.number, status: a.status, orgName: a.orgName, city: a.city, licenseNumber: a.licenseNumber,
      directorName: a.executiveDirector.name, createdAt: a.createdAt, decidedAt: a.decidedAt,
      organization: a.organization ? { id: a.organization.id, slug: a.organization.slug } : null,
    }));
  }

  async get(id: string) {
    const a = await this.db.getRepository(SubscriptionApplication).findOne({ where: { id }, relations: { organization: true } });
    if (!a) throw new NotFoundException('الطلب غير موجود');
    const hasPassword = !!(await this.db.getRepository(SubscriptionApplication)
      .createQueryBuilder('a').select('a.admin_password_hash IS NOT NULL', 'has').where('a.id = :id', { id }).getRawOne())?.has;
    return {
      id: a.id, number: a.number, status: a.status, reviewNote: a.reviewNote, createdAt: a.createdAt, decidedAt: a.decidedAt,
      data: this.publicData(a), licenseFileMime: a.licenseFileMime, terms: a.terms, history: a.history,
      hasAdminPassword: hasPassword,
      organization: a.organization ? { id: a.organization.id, name: a.organization.name, slug: a.organization.slug } : null,
    };
  }

  async licenseFile(id: string) {
    const a = await this.db.getRepository(SubscriptionApplication).findOne({ where: { id } });
    if (!a) throw new NotFoundException('الطلب غير موجود');
    return { stream: this.files.open(a.licenseFileKey), mime: a.licenseFileMime, name: a.licenseFileName };
  }

  /** البيانات الرئيسية لجمعية (طلبها المعتمد) */
  async forOrganization(organizationId: string) {
    const a = await this.db.getRepository(SubscriptionApplication).findOne({ where: { organizationId }, order: { createdAt: 'DESC' } });
    return a ? this.get(a.id) : null;
  }

  async update(id: string, dto: UpdateApplicationDto, file: Express.Multer.File | undefined, actor: AuthUser) {
    await this.applyUpdate(id, dto, file, actor);
    return this.get(id);
  }

  private async applyUpdate(id: string, dto: UpdateApplicationDto, file: Express.Multer.File | undefined, actor: AuthUser | null) {
    const stored = file ? await this.files.save(FILE_FOLDER, file, 'مستند الترخيص') : null;
    let oldKey: string | null = null;
    try {
      await this.db.transaction(async (em) => {
        const app = await em.findOne(SubscriptionApplication, { where: { id }, lock: { mode: 'pessimistic_write' } });
        if (!app) throw new NotFoundException('الطلب غير موجود');
        if (app.status === 'rejected') throw new BadRequestException('الطلب مرفوض ولا يمكن تعديله');
        const approved = app.status === 'approved';
        if (approved && (dto.adminEmail || dto.adminPassword || dto.proposedSlug)) {
          throw new BadRequestException('بعد الاعتماد يُدار حساب مدير النظام والمعرف من داخل الجمعية');
        }
        if (dto.adminEmail && dto.adminEmail !== app.adminEmail) await this.assertAdminEmailFree(em, dto.adminEmail, app.id);
        Object.assign(app, this.fields(dto, app));
        this.assertDates(app.licenseStartDate, app.licenseEndDate);
        if (dto.adminPassword) {
          await em.update(SubscriptionApplication, { id }, { adminPasswordHash: await bcrypt.hash(dto.adminPassword, 12) });
        }
        if (stored) {
          oldKey = app.licenseFileKey;
          Object.assign(app, { licenseFileKey: stored.key, licenseFileMime: stored.mime, licenseFileName: stored.name });
        }
        if (actor) {
          app.history = [...app.history, event('edited', actor.fullName)];
        } else {
          app.status = 'submitted';
          app.history = [...app.history, event('resubmitted', app.executiveDirector.name)];
        }
        // اسم الجمعية المعتمدة يتبع البيانات الرئيسية
        if (approved && app.organizationId && dto.orgName) await em.update(Organization, { id: app.organizationId }, { name: dto.orgName });
        await em.save(app);
      });
    } catch (e) {
      if (stored) await this.files.remove(stored.key);
      throw e;
    }
    if (oldKey) await this.files.remove(oldKey);
  }

  async returnForCompletion(id: string, note: string, actor: AuthUser) {
    return this.decide(id, 'returned', note, actor);
  }

  async reject(id: string, note: string, actor: AuthUser) {
    return this.decide(id, 'rejected', note, actor);
  }

  private async decide(id: string, status: 'returned' | 'rejected', note: string, actor: AuthUser) {
    await this.db.transaction(async (em) => {
      const app = await em.findOne(SubscriptionApplication, { where: { id }, lock: { mode: 'pessimistic_write' } });
      if (!app) throw new NotFoundException('الطلب غير موجود');
      if (app.status !== 'submitted') throw new BadRequestException('الطلب ليس بانتظار المراجعة');
      Object.assign(app, {
        status, reviewNote: note, decidedAt: status === 'rejected' ? new Date() : null,
        history: [...app.history, event(status, actor.fullName, note)],
      });
      await em.save(app);
    });
    return this.get(id);
  }

  /** يتحقق من قائمة الشاشات والوحدات الاختيارية */
  normalizeAccess(dto: AccessDto) {
    const badModules = dto.modules.filter((m) => !this.catalog.isOptionalModule(m));
    if (badModules.length) throw new BadRequestException(`وحدات غير قابلة للتفعيل: ${badModules.join(', ')}`);
    return { screens: dto.allScreens ? null : this.contracts.validScreens(dto.screens), modules: dto.modules };
  }

  /**
   * اعتماد الطلب: ينشئ الجمعية بالشاشات المسموحة ومدير نظامها، ويفتح الفترة التجريبية إن وُجدت
   * (وإلا تبقى بانتظار توقيع العقد)، وينشئ مسودة عقد بالشروط المالية.
   */
  async approve(id: string, dto: ApproveDto, actor: AuthUser, origin?: string) {
    const access = this.normalizeAccess(dto);
    let generatedPassword: string | null = null;
    const result = await this.db.transaction(async (em) => {
      const app = await em.findOne(SubscriptionApplication, {
        where: { id }, lock: { mode: 'pessimistic_write' },
        select: { ...Object.fromEntries(em.getRepository(SubscriptionApplication).metadata.columns.map((c) => [c.propertyName, true])) },
      });
      if (!app) throw new NotFoundException('الطلب غير موجود');
      if (app.status !== 'submitted') throw new BadRequestException('الطلب ليس بانتظار المراجعة');
      if (await em.exists(Organization, { where: { slug: dto.slug } })) throw new ConflictException('معرف الجمعية مستخدم بالفعل، اختر معرفًا آخر');
      if (await em.exists(User, { where: { email: app.adminEmail } })) throw new ConflictException('بريد مدير النظام مستخدم بالفعل في المنصة');

      const today = todayRiyadh();
      const trial = dto.trialDays > 0;
      const org = await em.save(em.create(Organization, {
        name: app.orgName, slug: dto.slug, isActive: true,
        allowedScreens: access.screens,
        subscriptionStatus: trial ? 'trial' : 'awaiting_contract',
        trialEndsOn: trial ? addDays(today, dto.trialDays - 1) : null,
        subscriptionPrice: String(dto.price),
        billingCycle: dto.billingCycle,
      }));
      if (access.modules.length) {
        await em.insert(OrganizationModule, access.modules.map((moduleCode) => ({ organizationId: org.id, moduleCode })));
      }
      let hash = app.adminPasswordHash;
      if (!hash) {
        generatedPassword = `Snb-${randomBytes(5).toString('hex')}`;
        hash = await bcrypt.hash(generatedPassword, 12);
      }
      await em.save(em.create(User, {
        organizationId: org.id, fullName: app.adminFullName, email: app.adminEmail, passwordHash: hash, isSuperadmin: true,
      }));

      const terms = {
        screens: access.screens, modules: access.modules, price: dto.price, billingCycle: dto.billingCycle,
        months: dto.months, trialDays: dto.trialDays, startsOn: dto.startsOn,
      };
      Object.assign(app, {
        status: 'approved', organizationId: org.id, terms, decidedAt: new Date(), reviewNote: null, adminPasswordHash: null,
        history: [...app.history, event('approved', actor.fullName, trial ? `فترة تجريبية ${dto.trialDays} يومًا` : undefined)],
      });
      await em.save(app);

      const provider = await this.contracts.provider(em);
      const contract = await this.contracts.createDraft(em, org.id, {
        price: dto.price, billingCycle: dto.billingCycle, vatRate: provider.vatRate, months: dto.months,
        startsOn: dto.startsOn, screens: access.screens, trialDays: dto.trialDays,
      }, actor.fullName, app.id);
      return { organizationId: org.id, slug: org.slug, contractId: contract.id, orgName: org.name, adminName: app.adminFullName, adminEmail: app.adminEmail };
    });
    // رسالة ترحيب لمدير نظام الجمعية برابط الدخول (وكلمة المرور المولدة إن وُجدت)
    const emailedTo = await this.mail.queue({
      to: result.adminEmail, kind: 'admin_welcome', event: 'accounts', organizationId: result.organizationId,
      sensitive: !!generatedPassword, createdBy: actor.fullName,
      ...templates.adminWelcome({
        orgName: result.orgName, name: result.adminName, login: result.adminEmail, path: `/o/${result.slug}`,
        password: generatedPassword, origin: publicOrigin() ?? origin,
      }),
    }).catch(() => [] as string[]);
    return {
      ...result,
      emailedTo: emailedTo[0] ?? null,
      links: { staff: `/o/${result.slug}`, portal: `/portal/${result.slug}` },
      generatedPassword,
      application: await this.get(id),
    };
  }
}
