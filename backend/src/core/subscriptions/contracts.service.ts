import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException, OnApplicationBootstrap } from '@nestjs/common';
import { randomBytes, randomUUID } from 'crypto';
import { DataSource, EntityManager, In, Not } from 'typeorm';
import { AuthUser } from '../auth/decorators';
import { Organization } from '../entities';
import { ModuleCatalogService } from '../modules/module-catalog.service';
import { addMonths, todayRiyadh } from '../organizations/org-access';
import { CONTRACT_VARIABLES, DEFAULT_CLAUSES, DEFAULT_PROVIDER, ProviderInfo } from './contract-defaults';
import { contractVariables, hashRendered, renderItems, unknownVariables } from './contract-render';
import {
  ContractClause, ContractEvent, ContractItem, ContractTerms, PlatformSetting, SubscriptionApplication, SubscriptionContract,
} from './entities';
import { ClauseDto, ProviderDto, SignContractDto, UpdateContractDto } from './subscriptions.dto';

const OPEN_STATUSES = ['draft', 'sent', 'changes_requested'] as const;
const event = (step: ContractEvent['step'], by: string, note?: string): ContractEvent =>
  ({ step, by, at: new Date().toISOString(), ...(note ? { note } : {}) });

/** يولد رقمًا متسلسلًا لكل سنة مثل CT-2026-0001 (داخل معاملة عليها قفل) */
export async function nextNumber(em: EntityManager, table: string, prefix: string) {
  await em.query('SELECT pg_advisory_xact_lock(hashtext($1))', [table]);
  const year = todayRiyadh().slice(0, 4);
  const [row] = await em.query(
    `SELECT coalesce(max(substring(number from '[0-9]+$')::int), 0) AS n FROM ${table} WHERE number LIKE $1`,
    [`${prefix}-${year}-%`],
  );
  return `${prefix}-${year}-${String(Number(row.n) + 1).padStart(4, '0')}`;
}

/**
 * عقود الاشتراك الإلكترونية ومكتبة بنودها وبيانات مقدم الخدمة.
 */
@Injectable()
export class ContractsService implements OnApplicationBootstrap {
  private readonly logger = new Logger('Contracts');

  constructor(private readonly db: DataSource, private readonly catalog: ModuleCatalogService) {}

  /** أول تشغيل: مكتبة البنود فارغة، فننشئ المسودة المقترحة */
  async onApplicationBootstrap() {
    await this.db.transaction(async (em) => {
      await em.query('SELECT pg_advisory_xact_lock(hashtext($1))', ['contract_clauses_seed']);
      if (await em.count(ContractClause)) return;
      await this.insertDefaults(em);
      this.logger.log('Seeded default contract clauses');
    });
  }

  private async insertDefaults(em: EntityManager) {
    await em.insert(ContractClause, DEFAULT_CLAUSES.map((c, i) => ({
      sequence: (i + 1) * 10, title: c.title, paragraphs: c.paragraphs, isMandatory: !!c.mandatory, isActive: true,
    })));
  }

  // ---------- مكتبة البنود ----------

  clauses() {
    return this.db.getRepository(ContractClause).find({ order: { sequence: 'ASC', createdAt: 'ASC' } });
  }

  variables() {
    return CONTRACT_VARIABLES;
  }

  async createClause(dto: ClauseDto) {
    const repo = this.db.getRepository(ContractClause);
    const [{ max }] = await repo.query('SELECT coalesce(max(sequence), 0) AS max FROM contract_clauses');
    return repo.save(repo.create({ ...dto, paragraphs: this.cleanParagraphs(dto.paragraphs), sequence: Number(max) + 10 }));
  }

  async updateClause(id: string, dto: ClauseDto) {
    const repo = this.db.getRepository(ContractClause);
    const c = await repo.findOne({ where: { id } });
    if (!c) throw new NotFoundException('البند غير موجود');
    Object.assign(c, { ...dto, paragraphs: this.cleanParagraphs(dto.paragraphs) });
    return repo.save(c);
  }

  async deleteClause(id: string) {
    const res = await this.db.getRepository(ContractClause).delete({ id });
    if (!res.affected) throw new NotFoundException('البند غير موجود');
  }

  async reorderClauses(ids: string[]) {
    await this.db.transaction(async (em) => {
      for (const [i, id] of ids.entries()) await em.update(ContractClause, { id }, { sequence: (i + 1) * 10 });
    });
    return this.clauses();
  }

  /** استعادة المسودة المقترحة: تستبدل كل بنود المكتبة (العقود الصادرة لا تتأثر) */
  async restoreDefaults() {
    await this.db.transaction(async (em) => {
      await em.createQueryBuilder().delete().from(ContractClause).execute();
      await this.insertDefaults(em);
    });
    return this.clauses();
  }

  private cleanParagraphs(ps: string[]) {
    return ps.map((p) => p.trim()).filter(Boolean);
  }

  // ---------- بيانات مقدم الخدمة ----------

  async provider(em: EntityManager = this.db.manager): Promise<ProviderInfo> {
    const row = await em.findOne(PlatformSetting, { where: { key: 'provider' } });
    return { ...DEFAULT_PROVIDER, ...(row?.value as Partial<ProviderInfo> | undefined) };
  }

  async setProvider(dto: ProviderDto) {
    await this.db.getRepository(PlatformSetting).save({ key: 'provider', value: { ...dto } });
    return this.provider();
  }

  // ---------- العقود ----------

  /** ينشئ مسودة عقد لجمعية من بنود المكتبة الفعّالة. يُرفض لو للجمعية عقد مفتوح */
  async createDraft(em: EntityManager, organizationId: string, terms: ContractTerms, actor: string, applicationId: string | null = null) {
    if (await em.exists(SubscriptionContract, { where: { organizationId, status: In([...OPEN_STATUSES]) } })) {
      throw new ConflictException('للجمعية عقد مفتوح بالفعل. أكمله أو ألغه أولًا');
    }
    const clauses = await em.find(ContractClause, { where: { isActive: true }, order: { sequence: 'ASC', createdAt: 'ASC' } });
    const items: ContractItem[] = clauses.map((c) => ({
      key: randomUUID(), clauseId: c.id, title: c.title, paragraphs: [...c.paragraphs], mandatory: c.isMandatory,
    }));
    const contract = em.create(SubscriptionContract, {
      number: await nextNumber(em, 'subscription_contracts', 'CT'),
      token: randomBytes(24).toString('hex'),
      organizationId, applicationId, status: 'draft', terms, items,
      history: [event('created', actor)],
    });
    return em.save(contract);
  }

  /** عقد جديد لجمعية قائمة (تجديد أو جمعية أُنشئت قبل نظام الاشتراكات) بشروطها الحالية */
  async createForOrganization(organizationId: string, actor: AuthUser) {
    const id = await this.db.transaction(async (em) => {
      const org = await em.findOne(Organization, { where: { id: organizationId } });
      if (!org) throw new NotFoundException('الجمعية غير موجودة');
      const app = await em.findOne(SubscriptionApplication, { where: { organizationId }, order: { createdAt: 'DESC' } });
      const provider = await this.provider(em);
      const today = todayRiyadh();
      // التجديد يبدأ في اليوم التالي لنهاية الاشتراك الساري، وإلا من اليوم
      const startsOn = org.subscriptionEndsOn && org.subscriptionEndsOn >= today ? this.dayAfter(org.subscriptionEndsOn) : today;
      const terms: ContractTerms = {
        price: Number(org.subscriptionPrice ?? app?.terms?.price ?? 0),
        billingCycle: org.billingCycle ?? app?.terms?.billingCycle ?? 'annual',
        vatRate: provider.vatRate,
        months: app?.terms?.months ?? 12,
        startsOn,
        screens: org.allowedScreens,
        trialDays: 0,
      };
      return (await this.createDraft(em, organizationId, terms, actor.fullName, app?.id ?? null)).id;
    });
    return this.get(id);
  }

  private dayAfter(date: string) {
    const d = new Date(`${date}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + 1);
    return d.toISOString().slice(0, 10);
  }

  async list(status?: string) {
    const rows = await this.db.getRepository(SubscriptionContract).find({
      where: status ? { status: status as SubscriptionContract['status'] } : {},
      relations: { organization: true },
      order: { createdAt: 'DESC' },
    });
    return rows.map((c) => this.summary(c));
  }

  private summary(c: SubscriptionContract) {
    return {
      id: c.id, number: c.number, status: c.status, organizationId: c.organizationId,
      organizationName: c.organization?.name ?? null, organizationSlug: c.organization?.slug ?? null,
      terms: c.terms, sentAt: c.sentAt, signedAt: c.signedAt, signerName: c.signerName, createdAt: c.createdAt,
    };
  }

  async get(id: string) {
    const c = await this.db.getRepository(SubscriptionContract).findOne({
      where: { id }, relations: { organization: true }, select: this.withToken(),
    });
    if (!c) throw new NotFoundException('العقد غير موجود');
    return {
      ...this.summary(c), items: c.items, rendered: c.rendered, contentHash: c.contentHash,
      changeRequest: c.changeRequest, signerTitle: c.signerTitle, signerIp: c.signerIp, history: c.history,
      // رابط التوقيع يظهر لمدير المنصة فقط ليرسله للجمعية
      signPath: c.status === 'draft' ? null : `/contract/${c.token}`,
      recipients: await this.recipients(c),
    };
  }

  /** جهات التواصل في الجمعية التي يُرسَل لها رابط العقد (من طلب الاشتراك) — لا يوجد إشعار تلقائي */
  private async recipients(c: SubscriptionContract) {
    const repo = this.db.getRepository(SubscriptionApplication);
    const app = (c.applicationId ? await repo.findOne({ where: { id: c.applicationId } }) : null)
      ?? await repo.findOne({ where: { organizationId: c.organizationId }, order: { createdAt: 'DESC' } });
    if (!app) return [];
    const list = [
      { role: 'المدير التنفيذي', name: app.executiveDirector?.name, phone: app.executiveDirector?.phone, email: app.executiveDirector?.email },
      { role: app.boardMember?.position || 'عضو مجلس الإدارة', name: app.boardMember?.name, phone: app.boardMember?.phone, email: app.boardMember?.email },
      { role: 'الجمعية', name: app.orgName, phone: app.orgPhone, email: app.orgEmail },
    ];
    return list
      .filter((r) => r.phone || r.email)
      .map((r) => ({ role: r.role, name: r.name ?? '', phone: r.phone || null, email: r.email || null }));
  }

  /** كل أعمدة العقد مع الرمز السري (select: false افتراضيًا) */
  private withToken() {
    const cols = this.db.getMetadata(SubscriptionContract).columns.map((c) => c.propertyName);
    return Object.fromEntries(cols.map((c) => [c, true])) as Record<keyof SubscriptionContract, true>;
  }

  async update(id: string, dto: UpdateContractDto, actor: AuthUser) {
    await this.db.transaction(async (em) => {
      const c = await em.findOne(SubscriptionContract, { where: { id }, lock: { mode: 'pessimistic_write' } });
      if (!c) throw new NotFoundException('العقد غير موجود');
      if (c.status !== 'draft' && c.status !== 'changes_requested') {
        throw new BadRequestException('لا يمكن تعديل العقد بعد إرساله. اسحبه أولًا لإعادته مسودة');
      }
      if (dto.terms) {
        const { allScreens, screens, ...t } = dto.terms;
        c.terms = { ...t, screens: allScreens ? null : this.validScreens(screens) };
      }
      if (dto.items) {
        // البنود الإلزامية لا تُحذف من العقد
        const kept = new Set(dto.items.map((i) => i.clauseId).filter(Boolean));
        const missing = c.items.filter((i) => i.mandatory && i.clauseId && !kept.has(i.clauseId));
        if (missing.length) throw new BadRequestException(`لا يمكن حذف البنود الإلزامية: ${missing.map((m) => m.title).join('، ')}`);
        const original = new Map(c.items.map((i) => [i.key, i]));
        c.items = dto.items.map((i) => ({
          key: i.key, clauseId: i.clauseId ?? null, title: i.title,
          paragraphs: this.cleanParagraphs(i.paragraphs),
          // صفة الإلزام تأتي من العقد الأصلي، لا من المتصفح
          mandatory: original.get(i.key)?.mandatory ?? false,
        }));
      }
      c.history = [...c.history, event('edited', actor.fullName)];
      await em.save(c);
    });
    return this.get(id);
  }

  validScreens(screens: string[]) {
    const all = new Set(this.catalog.screenPaths());
    const bad = screens.filter((s) => !all.has(s));
    if (bad.length) throw new BadRequestException(`شاشات غير معروفة: ${bad.join(', ')}`);
    return screens;
  }

  /** معاينة النص النهائي كما سيظهر للجمعية */
  async preview(id: string, origin: string) {
    const c = await this.db.getRepository(SubscriptionContract).findOne({ where: { id } });
    if (!c) throw new NotFoundException('العقد غير موجود');
    const vars = await this.variablesFor(this.db.manager, c, origin);
    return {
      rendered: renderItems(c.items, vars),
      unknown: unknownVariables(c.items, Object.keys(vars)),
    };
  }

  private async variablesFor(em: EntityManager, c: SubscriptionContract, origin: string) {
    const org = await em.findOneOrFail(Organization, { where: { id: c.organizationId } });
    const app = await em.findOne(SubscriptionApplication, { where: { organizationId: c.organizationId }, order: { createdAt: 'DESC' } });
    return contractVariables({
      number: c.number,
      issuedOn: (c.sentAt ? new Date(c.sentAt) : new Date()).toISOString().slice(0, 10),
      provider: await this.provider(em),
      org: {
        name: org.name, slug: org.slug, licenseNumber: app?.licenseNumber, licenseStartDate: app?.licenseStartDate,
        city: app?.city, director: app?.executiveDirector?.name, email: app?.orgEmail,
      },
      terms: c.terms,
      screenLabels: c.terms.screens ? c.terms.screens.map((s) => this.catalog.screenLabel(s)) : null,
      origin,
    });
  }

  /** إرسال العقد للجمعية: يُثبَّت النص النهائي وبصمته ويظهر رابط التوقيع */
  async send(id: string, actor: AuthUser, origin: string) {
    await this.db.transaction(async (em) => {
      const c = await em.findOne(SubscriptionContract, { where: { id }, lock: { mode: 'pessimistic_write' } });
      if (!c) throw new NotFoundException('العقد غير موجود');
      if (c.status !== 'draft' && c.status !== 'changes_requested') throw new BadRequestException('العقد ليس مسودة');
      if (!c.items.length) throw new BadRequestException('العقد بلا بنود');
      c.sentAt = new Date();
      const vars = await this.variablesFor(em, c, origin);
      const unknown = unknownVariables(c.items, Object.keys(vars));
      if (unknown.length) throw new BadRequestException(`متغيرات غير معروفة في البنود: ${unknown.join('، ')}`);
      c.rendered = renderItems(c.items, vars);
      c.contentHash = hashRendered(c.number, c.rendered);
      c.status = 'sent';
      c.changeRequest = null;
      c.history = [...c.history, event('sent', actor.fullName)];
      await em.save(c);
    });
    return this.get(id);
  }

  /** سحب العقد المرسل قبل توقيعه وإعادته مسودة */
  async withdraw(id: string, actor: AuthUser) {
    return this.transition(id, ['sent'], 'draft', event('withdrawn', actor.fullName));
  }

  async cancel(id: string, actor: AuthUser, note: string) {
    return this.transition(id, [...OPEN_STATUSES], 'cancelled', event('cancelled', actor.fullName, note));
  }

  private async transition(id: string, from: string[], to: SubscriptionContract['status'], ev: ContractEvent) {
    await this.db.transaction(async (em) => {
      const c = await em.findOne(SubscriptionContract, { where: { id }, lock: { mode: 'pessimistic_write' } });
      if (!c) throw new NotFoundException('العقد غير موجود');
      if (!from.includes(c.status)) throw new BadRequestException('لا يمكن تنفيذ هذا الإجراء في حالة العقد الحالية');
      c.status = to;
      if (to === 'draft') { c.rendered = null; c.contentHash = null; c.sentAt = null; }
      c.history = [...c.history, ev];
      await em.save(c);
    });
    return this.get(id);
  }

  // ---------- صفحة الجمعية العامة (برابط سري) ----------

  private async byToken(em: EntityManager, token: string, lock = false) {
    if (!/^[a-f0-9]{48}$/.test(token)) throw new NotFoundException('الرابط غير صحيح');
    const c = await em.findOne(SubscriptionContract, {
      where: { token, status: Not('draft') }, ...(lock ? { lock: { mode: 'pessimistic_write' as const } } : {}),
    });
    if (!c) throw new NotFoundException('العقد غير موجود أو لم يُرسل بعد');
    return c;
  }

  async publicView(token: string) {
    const c = await this.byToken(this.db.manager, token);
    const org = await this.db.getRepository(Organization).findOneOrFail({ where: { id: c.organizationId } });
    return {
      number: c.number, status: c.status, organizationName: org.name, rendered: c.rendered, contentHash: c.contentHash,
      sentAt: c.sentAt, signedAt: c.signedAt, signerName: c.signerName, signerTitle: c.signerTitle,
      changeRequest: c.changeRequest, terms: { ...c.terms, screens: undefined },
    };
  }

  /** توقيع الجمعية إلكترونيًا: يُفعَّل اشتراكها بشروط العقد */
  async sign(token: string, dto: SignContractDto, ip: string) {
    await this.db.transaction(async (em) => {
      const c = await this.byToken(em, token, true);
      if (c.status !== 'sent') throw new BadRequestException(c.status === 'signed' ? 'العقد موقّع بالفعل' : 'العقد غير متاح للتوقيع');
      const app = await em.findOne(SubscriptionApplication, { where: { organizationId: c.organizationId }, order: { createdAt: 'DESC' } });
      if (app && app.licenseNumber.trim() !== dto.licenseNumber.trim()) {
        throw new BadRequestException('رقم الترخيص لا يطابق المسجل للجمعية');
      }
      Object.assign(c, {
        status: 'signed', signedAt: new Date(), signerName: dto.signerName, signerTitle: dto.signerTitle, signerIp: ip.slice(0, 64),
        history: [...c.history, event('signed', `${dto.signerName} (${dto.signerTitle})`)],
      });
      await em.save(c);
      // تفعيل الاشتراك بشروط العقد
      const t = c.terms;
      await em.update(Organization, { id: c.organizationId }, {
        subscriptionStatus: 'active',
        subscriptionStartsOn: t.startsOn,
        subscriptionEndsOn: addMonths(t.startsOn, t.months),
        subscriptionPrice: String(t.price),
        billingCycle: t.billingCycle,
        allowedScreens: t.screens,
      });
    });
    return this.publicView(token);
  }

  async requestChanges(token: string, note: string) {
    await this.db.transaction(async (em) => {
      const c = await this.byToken(em, token, true);
      if (c.status !== 'sent') throw new BadRequestException('لا يمكن طلب تعديل في حالة العقد الحالية');
      c.status = 'changes_requested';
      c.changeRequest = note;
      c.history = [...c.history, event('changes_requested', 'الجمعية', note)];
      await em.save(c);
    });
    return this.publicView(token);
  }

  /** عقود جمعية (لصفحة الجمعية عند مدير المنصة) */
  async forOrganization(organizationId: string) {
    const rows = await this.db.getRepository(SubscriptionContract).find({
      where: { organizationId }, relations: { organization: true }, order: { createdAt: 'DESC' },
    });
    return rows.map((c) => this.summary(c));
  }
}
