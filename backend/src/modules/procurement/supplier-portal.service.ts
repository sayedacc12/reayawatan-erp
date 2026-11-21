import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { createHash, randomBytes } from 'crypto';
import { DataSource } from 'typeorm';
import { Organization } from '../../core/entities';
import { MailService } from '../../core/mail/mail.service';
import { mailLayout } from '../../core/mail/mail-templates';
import { accessProblem } from '../../core/organizations/org-access';
import {
  BANK_STATUS, DOC_STATUS, ENTITY_TYPES, PORTAL_ROLES, PortalRole, PrPortalEvent, PrSupplier, PrSupplierBank, PrSupplierCategory, PrSupplierDoc, PrSupplierUser,
  SUPPLIER_KINDS, SUPPLIER_STATUS,
} from './entities/procurement.entity';
import {
  BankDto, DocMetaDto, PortalChangePasswordDto, PortalForgotDto, PortalLoginDto, PortalRegisterDto, PortalResetDto, PortalUserDto, PortalUserUpdateDto, SupplierDto,
} from './procurement.dto';
import { addDays, logEntry, prToday, ProcurementCore, supplierCode } from './procurement-core.service';
import { SupplierPortalUser } from './supplier-portal.guard';
import { Actor, docTypesFor, SuppliersService } from './suppliers.service';

const DUMMY_HASH = bcrypt.hashSync('supplier-timing-equalizer', 10);
const MAX_FAILED = 5;
const LOCK_MINUTES = 15;
/** البيانات النظامية لا يغيرها المورد بعد إرسال طلبه، بل بطلب للشركة */
const LEGAL: (keyof SupplierDto)[] = ['name', 'entityType', 'crNumber', 'vatNumber', 'nationalId'];
const sha = (s: string) => createHash('sha256').update(s).digest('hex');

/**
 * بوابة الموردين ومزودي الخدمات (خارج دخول الموظفين):
 * التسجيل الذاتي، والدخول بالبريد، واستعادة كلمة المرور بالبريد، وتحديث البيانات، ورفع المستندات،
 * وطلبات الحسابات البنكية (تعتمدها الشركة)، وعدة مستخدمين للحساب بأدوار، وسجل العمليات.
 */
@Injectable()
export class SupplierPortalService {
  constructor(
    private readonly db: DataSource, private readonly jwt: JwtService, private readonly core: ProcurementCore,
    private readonly suppliers: SuppliersService, private readonly mail: MailService,
  ) {}

  async organization(slug: string) {
    const org = await this.db.getRepository(Organization).findOne({ where: { slug: slug.toLowerCase() } });
    if (!org || accessProblem(org)) throw new NotFoundException('بوابة الموردين غير متاحة لهذه الشركة حاليًا');
    return org;
  }

  async info(slug: string) {
    const org = await this.organization(slug);
    const s = await this.core.settings(org.id);
    const cats = await this.db.getRepository(PrSupplierCategory).find({ where: { organizationId: org.id, isActive: true }, order: { sortOrder: 'ASC' } });
    return {
      name: org.name, slug: org.slug, open: s.portalOpen, intro: s.portalIntro,
      docTypes: s.supplierDocTypes.filter((d) => d.isActive), activities: s.activities,
      categories: cats.map((c) => ({ id: c.id, name: c.name, color: c.color, description: c.description })),
      entityTypes: ENTITY_TYPES, supplierKinds: SUPPLIER_KINDS, portalRoles: PORTAL_ROLES,
    };
  }

  private async event(org: string, supplierId: string | null, userId: string | null, userName: string | null, event: string, detail: string | null, ip: string | null) {
    await this.db.getRepository(PrPortalEvent).insert({ organizationId: org, supplierId, userId, userName, event, detail: detail?.slice(0, 500) ?? null, ip: ip?.slice(0, 64) ?? null });
  }

  private async issue(userId: string) {
    return { accessToken: await this.jwt.signAsync({ sub: userId, typ: 'supplier', ts: Date.now() }, { expiresIn: '12h' }) };
  }

  // ---------------- التسجيل والدخول ----------------

  async register(slug: string, dto: PortalRegisterDto, ip: string | null) {
    const org = await this.organization(slug);
    const s = await this.core.settings(org.id);
    if (!s.portalOpen) throw new ForbiddenException('التسجيل الذاتي للموردين مغلق حاليًا لدى الشركة، تواصل معها مباشرة');
    await this.suppliers.assertUnique(org.id, dto);
    await this.suppliers.assertEmailFree(org.id, dto.ownerEmail);
    const cats = await this.suppliers.checkCategories(org.id, dto.categoryIds);
    const { supplierId, userId } = await this.db.transaction(async (em) => {
      const no = await this.suppliers.nextNo(em, org.id);
      const sup = await em.getRepository(PrSupplier).save(em.create(PrSupplier, {
        organizationId: org.id, supplierNo: no, ...this.suppliers.fields(dto, cats), status: 'draft', source: 'portal',
        createdByName: dto.ownerName, log: [logEntry('بدء التسجيل من بوابة الموردين', dto.ownerName)],
      }));
      const u = await em.getRepository(PrSupplierUser).save(em.create(PrSupplierUser, {
        organizationId: org.id, supplierId: sup.id, fullName: dto.ownerName, email: dto.ownerEmail, phone: dto.ownerPhone, role: 'owner',
        passwordHash: await bcrypt.hash(dto.password, 12), lastLoginAt: new Date(),
      }));
      return { supplierId: sup.id, userId: u.id };
    });
    await this.event(org.id, supplierId, userId, dto.ownerName, 'register', null, ip);
    return this.issue(userId);
  }

  async login(slug: string, dto: PortalLoginDto, ip: string | null) {
    const org = await this.organization(slug);
    const u = await this.db.getRepository(PrSupplierUser).createQueryBuilder('u').addSelect('u.passwordHash')
      .where('u.organization_id = :org AND u.email = :email', { org: org.id, email: dto.email }).getOne();
    if (u?.lockedUntil && u.lockedUntil.getTime() > Date.now()) {
      throw new UnauthorizedException(`أُوقف الدخول مؤقتًا بعد محاولات خاطئة متكررة. حاول بعد ${Math.ceil((u.lockedUntil.getTime() - Date.now()) / 60000)} دقيقة، أو استعد كلمة المرور`);
    }
    const ok = await bcrypt.compare(dto.password, u?.passwordHash ?? DUMMY_HASH);
    if (!u || !ok || !u.passwordHash) {
      if (u) {
        const failed = u.failedLogins + 1;
        await this.db.getRepository(PrSupplierUser).update({ id: u.id }, {
          failedLogins: failed >= MAX_FAILED ? 0 : failed, lockedUntil: failed >= MAX_FAILED ? new Date(Date.now() + LOCK_MINUTES * 60_000) : null,
        });
        await this.event(org.id, u.supplierId, u.id, u.fullName, 'login_failed', failed >= MAX_FAILED ? 'إيقاف مؤقت بعد 5 محاولات' : null, ip);
      }
      throw new UnauthorizedException('البريد الإلكتروني أو كلمة المرور غير صحيحة');
    }
    if (!u.isActive) throw new UnauthorizedException('هذا المستخدم موقوف، تواصل مع مدير حساب منشأتكم أو مع الشركة');
    await this.db.getRepository(PrSupplierUser).update({ id: u.id }, { lastLoginAt: new Date(), failedLogins: 0, lockedUntil: null });
    await this.event(org.id, u.supplierId, u.id, u.fullName, 'login', null, ip);
    return { ...(await this.issue(u.id)), mustChangePassword: u.mustChangePassword };
  }

  /** نسيت كلمة المرور: رابط استعادة بالبريد صالح ساعة. الرد واحد دائمًا حتى لا يكشف وجود الحساب */
  async forgot(slug: string, dto: PortalForgotDto, ip: string | null) {
    const org = await this.organization(slug);
    const reply = { message: 'إن كان البريد مسجلًا لدينا فستصلك رسالة برابط لتعيين كلمة مرور جديدة خلال دقائق. الرابط صالح ساعة واحدة.' };
    const u = await this.db.getRepository(PrSupplierUser).findOne({ where: { organizationId: org.id, email: dto.email, isActive: true } });
    if (!u) return reply;
    const token = randomBytes(32).toString('base64url');
    await this.db.getRepository(PrSupplierUser).update({ id: u.id }, { resetTokenHash: sha(token), resetExpiresAt: new Date(Date.now() + 3600_000) });
    const url = `${await this.suppliers.portalUrl(org.id)}?reset=${token}`;
    await this.mail.queue({
      to: u.email, kind: 'supplier-reset', organizationId: org.id, sensitive: true, event: 'passwordReset', dedupeKey: `supplier-reset:${u.id}:${Math.floor(Date.now() / 60000)}`,
      ...mailLayout({
        title: 'استعادة كلمة المرور', greeting: `السلام عليكم ${u.fullName}`,
        paragraphs: [`طلبتم تعيين كلمة مرور جديدة لحسابكم في بوابة الموردين لدى ${org.name}.`],
        button: { label: 'تعيين كلمة مرور جديدة', url }, note: 'الرابط صالح ساعة واحدة. إن لم تطلبوا ذلك فتجاهلوا الرسالة.',
      }),
    });
    await this.event(org.id, u.supplierId, u.id, u.fullName, 'reset_requested', null, ip);
    return reply;
  }

  async reset(slug: string, dto: PortalResetDto, ip: string | null) {
    const org = await this.organization(slug);
    const u = await this.db.getRepository(PrSupplierUser).createQueryBuilder('u')
      .where('u.organization_id = :org AND u.reset_token_hash = :h AND u.reset_expires_at > now() AND u.is_active', { org: org.id, h: sha(dto.token) }).getOne();
    if (!u) throw new BadRequestException('رابط الاستعادة غير صالح أو انتهت مدته. اطلب رابطًا جديدًا');
    await this.db.getRepository(PrSupplierUser).update({ id: u.id }, {
      passwordHash: await bcrypt.hash(dto.password, 12), resetTokenHash: null, resetExpiresAt: null, mustChangePassword: false,
      sessionsValidAfter: new Date(Date.now() - 1000), failedLogins: 0, lockedUntil: null, lastLoginAt: new Date(),
    });
    await this.event(org.id, u.supplierId, u.id, u.fullName, 'password_reset', null, ip);
    return this.issue(u.id);
  }

  async changePassword(p: SupplierPortalUser, dto: PortalChangePasswordDto) {
    const u = await this.db.getRepository(PrSupplierUser).createQueryBuilder('u').addSelect('u.passwordHash').where('u.id = :id', { id: p.userId }).getOneOrFail();
    if (!(await bcrypt.compare(dto.currentPassword, u.passwordHash ?? DUMMY_HASH))) throw new BadRequestException('كلمة المرور الحالية غير صحيحة');
    if (dto.currentPassword === dto.newPassword) throw new BadRequestException('اختر كلمة مرور مختلفة عن الحالية');
    await this.db.getRepository(PrSupplierUser).update({ id: u.id }, { passwordHash: await bcrypt.hash(dto.newPassword, 12), mustChangePassword: false, sessionsValidAfter: new Date(Date.now() - 1000) });
    await this.event(p.organizationId, p.supplierId, p.userId, p.fullName, 'password_changed', null, null);
    return this.issue(u.id);
  }

  // ---------------- الملف ----------------

  async me(p: SupplierPortalUser) {
    const org = p.organizationId;
    const sup = await this.suppliers.find(org, p.supplierId);
    const s = await this.core.settings(org);
    const [docs, banks, users, cats, check, o] = await Promise.all([
      this.db.getRepository(PrSupplierDoc).find({ where: { supplierId: sup.id }, order: { createdAt: 'DESC' } }),
      this.db.getRepository(PrSupplierBank).find({ where: { supplierId: sup.id }, order: { createdAt: 'DESC' } }),
      this.db.getRepository(PrSupplierUser).find({ where: { supplierId: sup.id }, order: { createdAt: 'ASC' } }),
      this.db.getRepository(PrSupplierCategory).find({ where: { organizationId: org } }),
      this.suppliers.checklist(org, sup),
      this.db.getRepository(Organization).findOneOrFail({ where: { id: org } }),
    ]);
    const t = prToday();
    return {
      organization: { name: o.name, slug: o.slug },
      user: { id: p.userId, fullName: p.fullName, email: p.email, role: p.role, roleLabel: PORTAL_ROLES[p.role], mustChangePassword: p.mustChangePassword },
      supplier: {
        id: sup.id, code: supplierCode(sup.supplierNo), name: sup.name, nameEn: sup.nameEn, entityType: sup.entityType, entityTypeLabel: ENTITY_TYPES[sup.entityType],
        supplierKind: sup.supplierKind, kindLabel: SUPPLIER_KINDS[sup.supplierKind], categoryIds: sup.categoryIds,
        categories: sup.categoryIds.map((id) => cats.find((c) => c.id === id)).filter(Boolean).map((c) => ({ id: c!.id, name: c!.name, color: c!.color })),
        activities: sup.activities, about: sup.about, crNumber: sup.crNumber, crExpiry: sup.crExpiry, vatNumber: sup.vatNumber, nationalId: sup.nationalId,
        city: sup.city, address: sup.address, phone: sup.phone, email: sup.email, website: sup.website, contacts: sup.contacts, branches: sup.branches,
        status: sup.status, statusLabel: SUPPLIER_STATUS[sup.status], reviewNote: sup.reviewNote, submittedAt: sup.submittedAt, decidedAt: sup.decidedAt,
        legalLocked: !['draft', 'returned'].includes(sup.status),
      },
      checklist: check,
      docTypes: docTypesFor(s, sup.entityType),
      docs: docs.map((d) => ({
        id: d.id, docType: d.docType, title: d.title, number: d.number, issueDate: d.issueDate, expiryDate: d.expiryDate, fileName: d.fileName, status: d.status,
        statusLabel: DOC_STATUS[d.status], reviewNote: d.reviewNote, isCurrent: d.isCurrent, createdAt: d.createdAt,
        expired: !!(d.expiryDate && d.expiryDate < t), expiring: !!(d.expiryDate && d.expiryDate >= t && d.expiryDate <= addDays(t, s.docAlertDays)),
      })),
      banks: banks.map((b) => ({
        id: b.id, bankName: b.bankName, iban: b.iban, accountName: b.accountName, status: b.status, statusLabel: BANK_STATUS[b.status], isPrimary: b.isPrimary,
        decisionNote: b.decisionNote, createdAt: b.createdAt, decidedAt: b.decidedAt,
      })),
      users: p.role === 'owner'
        ? users.map((u) => ({ id: u.id, fullName: u.fullName, email: u.email, phone: u.phone, role: u.role, roleLabel: PORTAL_ROLES[u.role], isActive: u.isActive, lastLoginAt: u.lastLoginAt }))
        : [],
      log: sup.log.slice(-40).reverse(),
    };
  }

  /** الكتابة ممنوعة على المورد المرفوض أو الموقوف، وبعض الإجراءات لأدوار محددة */
  private async writable(p: SupplierPortalUser, roles: PortalRole[]) {
    if (!roles.includes(p.role)) throw new ForbiddenException(`هذا الإجراء لـ${roles.map((r) => `«${PORTAL_ROLES[r]}»`).join(' أو ')} فقط`);
    const sup = await this.suppliers.find(p.organizationId, p.supplierId);
    if (sup.status === 'rejected') throw new ForbiddenException('طلب التسجيل مرفوض، ولا يمكن تعديل البيانات');
    if (sup.status === 'suspended') throw new ForbiddenException('التعامل مع حسابكم موقوف حاليًا، تواصلوا مع الشركة');
    return sup;
  }

  private actor(p: SupplierPortalUser): Actor {
    return { name: `${p.fullName} (بوابة المورد)`, userId: null, via: 'portal' };
  }

  async updateProfile(p: SupplierPortalUser, dto: SupplierDto) {
    const sup = await this.writable(p, ['owner']);
    const org = p.organizationId;
    if (!['draft', 'returned'].includes(sup.status)) {
      const before = sup as unknown as Record<string, unknown>;
      const after = dto as unknown as Record<string, unknown>;
      const changed = LEGAL.filter((k) => (after[k] ?? null) !== (before[k] ?? null));
      if (changed.length) throw new ForbiddenException('الاسم ونوع الكيان والسجل التجاري والرقم الضريبي لا تتغير من البوابة بعد إرسال الطلب، تواصلوا مع الشركة لتحديثها');
    }
    await this.suppliers.assertUnique(org, dto, sup.id);
    const cats = await this.suppliers.checkCategories(org, dto.categoryIds);
    const f = this.suppliers.fields(dto, cats);
    const changed = this.suppliers.changedFields(sup, f);
    if (changed.length) {
      await this.db.getRepository(PrSupplier).update({ id: sup.id }, { ...f, log: [...sup.log, logEntry('تحديث البيانات من البوابة', p.fullName, changed.join('، '))] });
      await this.event(org, sup.id, p.userId, p.fullName, 'profile_updated', changed.join('، '), null);
    }
    return this.me(p);
  }

  /** إرسال طلب التسجيل (أو إعادة إرساله بعد الاستكمال) للمراجعة */
  async submit(p: SupplierPortalUser) {
    const sup = await this.writable(p, ['owner']);
    if (!['draft', 'returned'].includes(sup.status)) throw new ConflictException('الطلب مرسل بالفعل');
    const check = await this.suppliers.checklist(p.organizationId, sup);
    if (!check.complete) throw new BadRequestException(`أكمل قبل الإرسال: ${[...check.missingProfile, ...check.missingDocs].join('، ')}`);
    await this.db.getRepository(PrSupplier).update({ id: sup.id }, {
      status: 'pending', submittedAt: new Date(), log: [...sup.log, logEntry(sup.status === 'returned' ? 'إعادة إرسال الطلب بعد الاستكمال' : 'إرسال طلب التسجيل', p.fullName)],
    });
    await this.event(p.organizationId, sup.id, p.userId, p.fullName, 'submitted', null, null);
    return this.me(p);
  }

  // ---------------- المستندات والحسابات البنكية ----------------

  async addDoc(p: SupplierPortalUser, dto: DocMetaDto, file: Express.Multer.File | undefined) {
    await this.writable(p, ['owner', 'sales', 'finance']);
    await this.suppliers.addDoc(p.organizationId, p.supplierId, dto, file, this.actor(p));
    await this.event(p.organizationId, p.supplierId, p.userId, p.fullName, 'doc_uploaded', dto.docType, null);
    return this.me(p);
  }

  async removeDoc(p: SupplierPortalUser, id: string) {
    await this.writable(p, ['owner', 'sales', 'finance']);
    await this.suppliers.removeDoc(p.organizationId, p.supplierId, id, this.actor(p));
    return this.me(p);
  }

  async docFile(p: SupplierPortalUser, id: string) {
    return this.suppliers.docFile(p.organizationId, p.supplierId, id);
  }

  async addBank(p: SupplierPortalUser, dto: BankDto, file: Express.Multer.File | undefined) {
    await this.writable(p, ['owner', 'finance']);
    await this.suppliers.addBank(p.organizationId, p.supplierId, dto, file, this.actor(p));
    await this.event(p.organizationId, p.supplierId, p.userId, p.fullName, 'bank_requested', dto.bankName, null);
    return this.me(p);
  }

  // ---------------- مستخدمو الحساب ----------------

  async addUser(p: SupplierPortalUser, dto: PortalUserDto) {
    await this.writable(p, ['owner']);
    await this.suppliers.assertEmailFree(p.organizationId, dto.email);
    await this.db.getRepository(PrSupplierUser).insert({
      organizationId: p.organizationId, supplierId: p.supplierId, fullName: dto.fullName, email: dto.email, phone: dto.phone || null, role: dto.role,
      passwordHash: await bcrypt.hash(dto.password, 12), mustChangePassword: true,
    });
    const sup = await this.suppliers.find(p.organizationId, p.supplierId);
    await this.db.getRepository(PrSupplier).update({ id: sup.id }, { log: [...sup.log, logEntry('إضافة مستخدم للبوابة', p.fullName, `${dto.email} · ${PORTAL_ROLES[dto.role]}`)] });
    await this.event(p.organizationId, p.supplierId, p.userId, p.fullName, 'user_added', dto.email, null);
    return this.me(p);
  }

  async updateUser(p: SupplierPortalUser, id: string, dto: PortalUserUpdateDto) {
    await this.writable(p, ['owner']);
    const u = await this.db.getRepository(PrSupplierUser).findOne({ where: { id, supplierId: p.supplierId } });
    if (!u) throw new NotFoundException('المستخدم غير موجود');
    if (id === p.userId && (dto.isActive === false || (dto.role && dto.role !== 'owner'))) throw new BadRequestException('لا تغيّر صلاحية حسابك أو توقفه بنفسك');
    await this.db.getRepository(PrSupplierUser).update({ id }, {
      role: dto.role ?? u.role, isActive: dto.isActive ?? u.isActive, sessionsValidAfter: dto.isActive === false ? new Date() : u.sessionsValidAfter,
    });
    await this.event(p.organizationId, p.supplierId, p.userId, p.fullName, 'user_updated', u.email, null);
    return this.me(p);
  }
}
