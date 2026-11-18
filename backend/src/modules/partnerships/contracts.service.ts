import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { createHash, randomBytes, randomUUID } from 'crypto';
import { DataSource, EntityManager, Not } from 'typeorm';
import { OrgUser } from '../../core/auth/decorators';
import { addDays } from '../../core/organizations/org-access';
import { formatDate, monthsLabel } from '../../core/subscriptions/contract-render';
import {
  CONTRACT_STATUS, ContractItem, ContractStatus, PtClass, PtClause, PtContract, PtFollowup, PtPartner, PtSettings, PtType, RenderedClause,
} from './entities/partnerships.entity';
import { ManualSignDto, NewContractDto, SignDto, TermsDto, UpdateContractDto } from './partnerships.dto';
import { PARTNERSHIP_PERMISSIONS as P } from './partnerships.manifest';
import { PT_VARIABLES } from './partnerships-defaults';
import { PartnershipsService, UUID, clean, contractState, logEntry, ptToday } from './partnerships.service';

const EDITABLE: ContractStatus[] = ['draft', 'changes_requested'];
const OPEN: ContractStatus[] = ['draft', 'review', 'approved', 'sent', 'changes_requested'];
const money = (n: number) => `${new Intl.NumberFormat('ar-SA-u-nu-latn', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n)} ريال سعودي`;
const VAR = /\{\{\s*([^{}]+?)\s*\}\}/g;

/** مدة العقد بالأشهر (أو الأيام إن كانت أقل من شهر) */
export function durationLabel(from: string, to: string) {
  const days = Math.round((Date.parse(to) - Date.parse(from)) / 86400000) + 1;
  const months = Math.round(days / 30.44);
  if (months < 1) return `${days} يومًا`;
  if (months % 12 === 0) return months === 12 ? 'سنة واحدة' : months === 24 ? 'سنتان' : `${months / 12} سنوات`;
  return monthsLabel(months);
}

export function fillItems(items: ContractItem[], vars: Record<string, string>): RenderedClause[] {
  const fill = (s: string) => s.replace(VAR, (m, k: string) => vars[k] ?? m);
  return items.map((i) => ({ title: fill(i.title), category: i.categoryName, paragraphs: i.paragraphs.map(fill).filter((p) => p.trim()) }));
}
export function unknownVars(items: ContractItem[]) {
  const known = new Set(PT_VARIABLES.map((v) => v.key));
  const found = new Set<string>();
  for (const i of items) for (const s of [i.title, ...i.paragraphs]) for (const m of s.matchAll(VAR)) if (!known.has(m[1])) found.add(m[1]);
  return [...found];
}

/**
 * عقود الشراكة: تُبنى من مكتبة البنود المبوبة حسب نوع الشراكة، وتُعدّل لكل عقد بمفرده،
 * ثم تُعتمد داخليًا وتُرسل للشريك برابط سري يراجع منه النص ويوقعه إلكترونيًا أو يطلب تعديلًا.
 * كل إرسال يثبت نسخة من النص وبصمتها (SHA-256) في سجل الإصدارات.
 */
@Injectable()
export class PtContractsService {
  constructor(private readonly db: DataSource, private readonly pt: PartnershipsService) {}

  private async load(org: string, id: string, em: EntityManager = this.db.manager, lock = false) {
    if (!UUID.test(id)) throw new NotFoundException('العقد غير موجود');
    const c = await em.findOne(PtContract, { where: { id, organizationId: org }, ...(lock ? { lock: { mode: 'pessimistic_write' as const } } : {}) });
    if (!c) throw new NotFoundException('العقد غير موجود');
    return c;
  }

  private async nextNumber(em: EntityManager, org: string) {
    await em.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`pt_contract_no:${org}`]);
    const year = ptToday().slice(0, 4);
    const [row] = await em.query(
      `SELECT coalesce(max(substring(number from '[0-9]+$')::int), 0) AS n FROM pt_contracts WHERE organization_id = $1 AND number LIKE $2`, [org, `PA-${year}-%`]);
    return `PA-${year}-${String(Number(row.n) + 1).padStart(4, '0')}`;
  }

  private checkTerms(t: { startsOn: string; endsOn: string }) {
    if (t.endsOn <= t.startsOn) throw new BadRequestException('تاريخ نهاية العقد يجب أن يكون بعد تاريخ بدايته');
  }

  private async checkProject(em: EntityManager, org: string, projectId?: string | null) {
    if (!projectId) return null;
    const [p] = await em.query('SELECT a.id FROM activities a JOIN project_profiles p ON p.activity_id = a.id WHERE a.id = $1 AND a.organization_id = $2', [projectId, org]);
    if (!p) throw new BadRequestException('المشروع غير موجود في نظام المشاريع');
    return projectId;
  }

  /** بنود العقد الجديد: البنود الفعالة الأساسية في المكتبة العامة أو الخاصة بنوع الشراكة، مرتبة حسب التبويب */
  private async draftItems(em: EntityManager, org: string, typeId: string): Promise<ContractItem[]> {
    const s = await this.pt.settings(org, em);
    const clauses = await this.pt.clauses(org);
    const cats = new Map(s.clauseCategories.map((c) => [c.id, c.name]));
    return clauses
      .filter((c) => c.isActive && (c.isDefault || c.isMandatory) && (!c.typeIds.length || c.typeIds.includes(typeId)))
      .map((c) => ({ key: randomUUID(), clauseId: c.id, categoryId: c.categoryId, categoryName: cats.get(c.categoryId) ?? 'أخرى', title: c.title, paragraphs: [...c.paragraphs], mandatory: c.isMandatory }));
  }

  async create(u: OrgUser, dto: NewContractDto) {
    const org = u.organizationId;
    this.checkTerms(dto);
    const s = await this.pt.settings(org);
    const id = await this.db.transaction(async (em) => {
      const p = await this.pt.loadPartner(org, dto.partnerId, em);
      if (p.status !== 'approved') throw new BadRequestException('اعتمد الشريك أولًا من تقييمه، ثم أنشئ عقده');
      const type = await em.findOne(PtType, { where: { id: dto.typeId, organizationId: org } });
      if (!type) throw new BadRequestException('نوع الشراكة غير موجود');
      const c = await em.save(em.create(PtContract, {
        organizationId: org, number: await this.nextNumber(em, org), token: randomBytes(24).toString('hex'), partnerId: p.id, typeId: type.id,
        title: dto.title.trim(), projectId: await this.checkProject(em, org, dto.projectId), startsOn: dto.startsOn, endsOn: dto.endsOn,
        value: dto.value === null || dto.value === undefined ? null : String(dto.value),
        orgSignerName: clean(dto.orgSignerName) ?? s.signerName, orgSignerTitle: clean(dto.orgSignerTitle) ?? s.signerTitle,
        status: 'draft', items: await this.draftItems(em, org, type.id), createdByName: u.fullName, log: [logEntry('إنشاء مسودة العقد', u.fullName)],
      }));
      await em.update(PtPartner, { id: p.id }, { log: [...p.log, logEntry('إنشاء عقد', u.fullName, `${c.number}: ${c.title}`)] });
      return c.id;
    });
    return this.get(u, id);
  }

  async list(u: OrgUser, f: { status?: string; partner?: string; type?: string; q?: string }) {
    const org = u.organizationId;
    const today = ptToday();
    const qb = this.db.getRepository(PtContract).createQueryBuilder('c').where('c.organization_id = :org', { org });
    if (f.status === 'expired') qb.andWhere(`c.status = 'signed' AND c.ends_on < :t`, { t: today });
    else if (f.status === 'signed') qb.andWhere(`c.status = 'signed' AND c.ends_on >= :t`, { t: today });
    else if (f.status === 'open') qb.andWhere('c.status IN (:...open)', { open: OPEN });
    else if (f.status && f.status in CONTRACT_STATUS) qb.andWhere('c.status = :st', { st: f.status });
    if (f.partner && UUID.test(f.partner)) qb.andWhere('c.partner_id = :p', { p: f.partner });
    if (f.type && UUID.test(f.type)) qb.andWhere('c.type_id = :ty', { ty: f.type });
    const q = (f.q ?? '').trim().replace(/[%_]/g, '');
    if (q) qb.andWhere('(c.title ILIKE :q OR c.number ILIKE :q OR c.partner_id IN (SELECT id FROM pt_partners WHERE organization_id = :org AND name ILIKE :q))', { q: `%${q}%` });
    const rows = await qb.orderBy('c.created_at', 'DESC').take(1000).getMany();
    return this.rows(org, rows);
  }

  private async rows(org: string, rows: PtContract[]) {
    const today = ptToday();
    const [types, partners, projects] = await Promise.all([
      this.pt.types(org), this.db.getRepository(PtPartner).find({ where: { organizationId: org } }), this.pt.projectNames(org, rows.map((r) => r.projectId)),
    ]);
    return rows.map((c) => {
      const st = contractState(c, today);
      const type = types.find((t) => t.id === c.typeId);
      return {
        id: c.id, number: c.number, title: c.title, partnerId: c.partnerId, partnerName: partners.find((p) => p.id === c.partnerId)?.name ?? '',
        typeId: c.typeId, typeName: type?.name ?? null, typeColor: type?.color ?? '#64748b', projectId: c.projectId, projectName: c.projectId ? projects.get(c.projectId) ?? null : null,
        startsOn: c.startsOn, endsOn: c.endsOn, value: c.value === null ? null : Number(c.value), status: st, statusLabel: CONTRACT_STATUS[st as keyof typeof CONTRACT_STATUS],
        version: c.version, clauses: c.items.length, signedAt: c.signedAt, renewalOf: c.renewalOf,
        daysLeft: st === 'signed' ? Math.round((Date.parse(c.endsOn) - Date.parse(today)) / 86400000) : null, createdAt: c.createdAt,
      };
    });
  }

  async get(u: OrgUser, id: string) {
    const org = u.organizationId;
    if (!UUID.test(id)) throw new NotFoundException('العقد غير موجود');
    const c = await this.db.getRepository(PtContract).findOne({ where: { id, organizationId: org }, select: this.allColumns() });
    if (!c) throw new NotFoundException('العقد غير موجود');
    const [row] = await this.rows(org, [c]);
    const p = await this.pt.loadPartner(org, c.partnerId);
    const followups = await this.db.getRepository(PtFollowup).find({ where: { contractId: c.id }, order: { dueDate: 'ASC' } });
    const renewals = await this.db.getRepository(PtContract).find({ where: { renewalOf: c.id }, select: { id: true, number: true, status: true } });
    const prev = c.renewalOf ? await this.db.getRepository(PtContract).findOne({ where: { id: c.renewalOf }, select: { id: true, number: true } }) : null;
    const st = row.status;
    const has = (perm: string) => u.permissions.includes(perm);
    return {
      ...row, items: c.items, rendered: c.rendered, contentHash: c.contentHash, versions: c.versions.map(({ rendered, ...v }) => ({ ...v, clauses: rendered.length })),
      orgSignerName: c.orgSignerName, orgSignerTitle: c.orgSignerTitle, changeRequest: c.changeRequest, sentAt: c.sentAt, signerName: c.signerName,
      signerTitle: c.signerTitle, signerIp: c.signerIp, signMethod: c.signMethod, endedAt: c.endedAt, endReason: c.endReason, log: [...c.log].reverse(),
      partner: { id: p.id, name: p.name, contactName: p.contactName, contactTitle: p.contactTitle, email: p.email, phone: p.phone, registrationNo: p.registrationNo, status: p.status },
      followups: followups.map((f) => this.pt.followupRow(f, c, p.name)),
      renewals, previous: prev,
      signPath: ['sent', 'changes_requested', 'signed'].includes(c.status) ? `/pc/${c.token}` : null,
      can: {
        edit: has(P.contracts) && EDITABLE.includes(c.status), submit: has(P.contracts) && EDITABLE.includes(c.status), decide: has(P.approve) && c.status === 'review',
        send: has(P.contracts) && c.status === 'approved', withdraw: has(P.contracts) && c.status === 'sent', manualSign: has(P.approve) && ['approved', 'sent'].includes(c.status),
        cancel: has(P.contracts) && OPEN.includes(c.status), terminate: has(P.approve) && st === 'signed', renew: has(P.contracts) && ['signed', 'expired'].includes(st) && !renewals.some((r) => r.status !== 'cancelled'),
        remove: has(P.contracts) && c.status === 'draft' && c.version === 0, followups: has(P.contracts) && !['cancelled', 'terminated'].includes(c.status),
      },
    };
  }

  private allColumns() {
    const cols = this.db.getMetadata(PtContract).columns.map((c) => c.propertyName);
    return Object.fromEntries(cols.map((c) => [c, true])) as Record<keyof PtContract, true>;
  }

  async update(u: OrgUser, id: string, dto: UpdateContractDto) {
    const org = u.organizationId;
    await this.db.transaction(async (em) => {
      const c = await this.load(org, id, em, true);
      if (!EDITABLE.includes(c.status)) throw new BadRequestException('لا يُعدّل العقد إلا وهو مسودة أو بعد طلب الشريك تعديله');
      if (dto.terms) {
        const t: TermsDto = dto.terms;
        this.checkTerms(t);
        Object.assign(c, {
          title: t.title.trim(), startsOn: t.startsOn, endsOn: t.endsOn, value: t.value === null || t.value === undefined ? null : String(t.value),
          projectId: await this.checkProject(em, org, t.projectId), orgSignerName: clean(t.orgSignerName), orgSignerTitle: clean(t.orgSignerTitle),
        });
      }
      if (dto.items) {
        const s = await this.pt.settings(org, em);
        const cats = new Map(s.clauseCategories.map((x) => [x.id, x.name]));
        const kept = new Set(dto.items.map((i) => i.key));
        const missing = c.items.filter((i) => i.mandatory && !kept.has(i.key));
        if (missing.length) throw new BadRequestException(`لا يمكن حذف البنود الإلزامية: ${missing.map((m) => m.title).join('، ')}`);
        const original = new Map(c.items.map((i) => [i.key, i]));
        const lib = new Set((await em.find(PtClause, { where: { organizationId: org }, select: { id: true } })).map((x) => x.id));
        c.items = dto.items.map((i) => {
          if (!cats.has(i.categoryId)) throw new BadRequestException(`تبويب غير معروف للبند «${i.title}»`);
          return {
            key: i.key, clauseId: i.clauseId && lib.has(i.clauseId) ? i.clauseId : null, categoryId: i.categoryId, categoryName: cats.get(i.categoryId)!,
            title: i.title.trim(), paragraphs: i.paragraphs.map((p) => p.trim()).filter(Boolean),
            // صفة الإلزام من العقد نفسه أو من المكتبة، لا من المتصفح
            mandatory: original.get(i.key)?.mandatory ?? false,
          };
        });
        const empty = c.items.find((i) => !i.paragraphs.length);
        if (empty) throw new BadRequestException(`البند «${empty.title}» بلا فقرات`);
      }
      c.log = [...c.log, logEntry('تعديل العقد', u.fullName)];
      await em.save(c);
    });
    return this.get(u, id);
  }

  /** إضافة بند من المكتبة يحمل صفة الإلزام من المكتبة */
  async addClause(u: OrgUser, id: string, clauseId: string) {
    const org = u.organizationId;
    await this.db.transaction(async (em) => {
      const c = await this.load(org, id, em, true);
      if (!EDITABLE.includes(c.status)) throw new BadRequestException('العقد غير قابل للتعديل');
      const cl = await em.findOne(PtClause, { where: { id: clauseId, organizationId: org } });
      if (!cl) throw new NotFoundException('البند غير موجود');
      const s = await this.pt.settings(org, em);
      const item: ContractItem = {
        key: randomUUID(), clauseId: cl.id, categoryId: cl.categoryId, categoryName: s.clauseCategories.find((x) => x.id === cl.categoryId)?.name ?? 'أخرى',
        title: cl.title, paragraphs: [...cl.paragraphs], mandatory: cl.isMandatory,
      };
      // يُدرج بعد آخر بند في تبويبه، ليبقى العقد مرتبًا حسب التبويب
      const order = s.clauseCategories.map((x) => x.id);
      const rank = (cat: string) => (order.indexOf(cat) === -1 ? 99 : order.indexOf(cat));
      const same = c.items.map((x) => x.categoryId).lastIndexOf(item.categoryId);
      const later = c.items.findIndex((x) => rank(x.categoryId) > rank(item.categoryId));
      const at = same >= 0 ? same + 1 : later >= 0 ? later : c.items.length;
      c.items = [...c.items.slice(0, at), item, ...c.items.slice(at)];
      c.log = [...c.log, logEntry('إضافة بند من المكتبة', u.fullName, cl.title)];
      await em.save(c);
    });
    return this.get(u, id);
  }

  private async variables(em: EntityManager, c: PtContract, issuedOn: string, version: number) {
    const org = c.organizationId;
    const s = await em.findOneOrFail(PtSettings, { where: { organizationId: org } });
    const [o] = await em.query('SELECT name FROM organizations WHERE id = $1', [org]);
    const p = await em.findOneOrFail(PtPartner, { where: { id: c.partnerId } });
    const cls = p.classId ? await em.findOne(PtClass, { where: { id: p.classId } }) : null;
    const type = c.typeId ? await em.findOne(PtType, { where: { id: c.typeId } }) : null;
    const [proj] = c.projectId ? await em.query('SELECT name FROM activities WHERE id = $1', [c.projectId]) : [null];
    const or = (v: string | null | undefined) => (v && v.trim() ? v : '........');
    return {
      'رقم العقد': c.number, 'رقم الإصدار': String(version), 'تاريخ العقد': formatDate(issuedOn), 'عنوان العقد': c.title, 'نوع الشراكة': or(type?.name),
      'اسم الجمعية': o?.name ?? '........', 'رقم ترخيص الجمعية': or(s.orgLicense), 'مدينة الجمعية': or(s.orgCity), 'ممثل الجمعية': or(c.orgSignerName),
      'صفة ممثل الجمعية': or(c.orgSignerTitle), 'اسم الشريك': p.name, 'تصنيف الشريك': or(cls?.name), 'سجل الشريك': or(p.registrationNo), 'مدينة الشريك': or(p.city),
      'ممثل الشريك': or(p.contactName), 'صفة ممثل الشريك': or(p.contactTitle), 'بريد الشريك': or(p.email), 'تاريخ بداية العقد': formatDate(c.startsOn),
      'تاريخ نهاية العقد': formatDate(c.endsOn), 'مدة العقد': durationLabel(c.startsOn, c.endsOn), 'قيمة الشراكة': c.value === null ? 'لا يوجد' : money(Number(c.value)),
      'اسم المشروع': proj?.name ?? 'البرامج المتفق عليها', 'مدينة المحكمة المختصة': or(s.courtCity ?? s.orgCity),
    } as Record<string, string>;
  }

  async preview(u: OrgUser, id: string) {
    const c = await this.load(u.organizationId, id);
    if (c.rendered && !EDITABLE.includes(c.status) && c.status !== 'review' && c.status !== 'approved') return { rendered: c.rendered, unknown: [] };
    const vars = await this.variables(this.db.manager, c, ptToday(), c.version + (EDITABLE.includes(c.status) || ['review', 'approved'].includes(c.status) ? 1 : 0));
    return { rendered: fillItems(c.items, vars), unknown: unknownVars(c.items) };
  }

  private async transition(u: OrgUser, id: string, from: ContractStatus[], fn: (c: PtContract, em: EntityManager) => Promise<void> | void) {
    await this.db.transaction(async (em) => {
      const c = await this.load(u.organizationId, id, em, true);
      if (!from.includes(c.status)) throw new BadRequestException('لا يمكن تنفيذ هذا الإجراء في حالة العقد الحالية');
      await fn(c, em);
      await em.save(c);
    });
    return this.get(u, id);
  }

  /** رفع المسودة للاعتماد الداخلي */
  submit(u: OrgUser, id: string) {
    return this.transition(u, id, EDITABLE, (c) => {
      if (!c.items.length) throw new BadRequestException('العقد بلا بنود');
      const unknown = unknownVars(c.items);
      if (unknown.length) throw new BadRequestException(`متغيرات غير معروفة في البنود: ${unknown.join('، ')}`);
      if (!c.orgSignerName) throw new BadRequestException('اكتب اسم ممثل الجمعية في التوقيع (تبويب بيانات العقد)');
      c.status = 'review';
      c.log = [...c.log, logEntry('رفع للاعتماد', u.fullName)];
    });
  }

  decide(u: OrgUser, id: string, decision: 'approve' | 'return', note: string | null) {
    return this.transition(u, id, ['review'], (c) => {
      if (decision === 'return' && (!note || note.trim().length < 3)) throw new BadRequestException('اكتب سبب الإرجاع');
      c.status = decision === 'approve' ? 'approved' : 'draft';
      c.log = [...c.log, logEntry(decision === 'approve' ? 'اعتماد العقد داخليًا' : 'إرجاع العقد للتعديل', u.fullName, clean(note))];
    });
  }

  /** تثبيت النص النهائي وبصمته كإصدار جديد */
  private async freeze(em: EntityManager, c: PtContract) {
    const unknown = unknownVars(c.items);
    if (unknown.length) throw new BadRequestException(`متغيرات غير معروفة في البنود: ${unknown.join('، ')}`);
    c.version += 1;
    c.sentAt = new Date();
    c.rendered = fillItems(c.items, await this.variables(em, c, ptToday(), c.version));
    c.contentHash = createHash('sha256').update(JSON.stringify({ number: c.number, version: c.version, rendered: c.rendered })).digest('hex');
    c.versions = [...c.versions, { version: c.version, rendered: c.rendered, hash: c.contentHash, sentAt: c.sentAt.toISOString(), outcome: null }];
    c.changeRequest = null;
  }
  private outcome(c: PtContract, text: string) {
    if (c.versions.length) c.versions = c.versions.map((v, i) => (i === c.versions.length - 1 ? { ...v, outcome: text } : v));
  }

  send(u: OrgUser, id: string) {
    return this.transition(u, id, ['approved'], async (c, em) => {
      await this.freeze(em, c);
      c.status = 'sent';
      c.log = [...c.log, logEntry('إرسال العقد للشريك', u.fullName, `الإصدار ${c.version}`)];
    });
  }

  withdraw(u: OrgUser, id: string) {
    return this.transition(u, id, ['sent'], (c) => {
      this.outcome(c, 'سُحب للتعديل');
      Object.assign(c, { status: 'draft', rendered: null, contentHash: null });
      c.log = [...c.log, logEntry('سحب العقد للتعديل', u.fullName)];
    });
  }

  /** تسجيل توقيع الشريك يدويًا بعد توقيع نسخة ورقية من النص المعتمد */
  manualSign(u: OrgUser, id: string, dto: ManualSignDto) {
    return this.transition(u, id, ['approved', 'sent'], async (c, em) => {
      if (c.status === 'approved') await this.freeze(em, c);
      this.outcome(c, 'وُقّع');
      Object.assign(c, {
        status: 'signed', signMethod: 'manual', signerName: dto.signerName.trim(), signerTitle: dto.signerTitle.trim(), signerIp: null,
        signedAt: new Date(`${dto.signedOn}T09:00:00+03:00`),
      });
      c.log = [...c.log, logEntry('تسجيل توقيع الشريك (نسخة ورقية)', u.fullName, `${c.signerName} (${c.signerTitle})`)];
    });
  }

  cancel(u: OrgUser, id: string, note: string) {
    return this.transition(u, id, OPEN, (c) => {
      if (c.status === 'sent') this.outcome(c, 'أُلغي');
      Object.assign(c, { status: 'cancelled', endedAt: new Date(), endReason: note.trim() });
      c.log = [...c.log, logEntry('إلغاء العقد', u.fullName, note.trim())];
    });
  }

  terminate(u: OrgUser, id: string, note: string) {
    return this.transition(u, id, ['signed'], (c) => {
      Object.assign(c, { status: 'terminated', endedAt: new Date(), endReason: note.trim() });
      c.log = [...c.log, logEntry('إنهاء العقد قبل موعده', u.fullName, note.trim())];
    });
  }

  /** تجديد: عقد جديد بنفس البنود والشروط، يبدأ في اليوم التالي لنهاية العقد الحالي وبنفس المدة */
  async renew(u: OrgUser, id: string) {
    const org = u.organizationId;
    const newId = await this.db.transaction(async (em) => {
      const c = await this.load(org, id, em, true);
      if (c.status !== 'signed') throw new BadRequestException('يُجدَّد العقد الموقّع فقط');
      if (await em.exists(PtContract, { where: { renewalOf: c.id, status: Not('cancelled') } })) throw new ConflictException('للعقد تجديد قائم بالفعل');
      const p = await this.pt.loadPartner(org, c.partnerId, em);
      if (p.status !== 'approved') throw new BadRequestException('الشريك غير معتمد حاليًا. أعد تقييمه أولًا');
      const days = Math.round((Date.parse(c.endsOn) - Date.parse(c.startsOn)) / 86400000);
      const startsOn = addDays(c.endsOn, 1);
      const n = await em.save(em.create(PtContract, {
        organizationId: org, number: await this.nextNumber(em, org), token: randomBytes(24).toString('hex'), partnerId: c.partnerId, typeId: c.typeId,
        title: c.title, projectId: c.projectId, startsOn, endsOn: addDays(startsOn, days), value: c.value, orgSignerName: c.orgSignerName, orgSignerTitle: c.orgSignerTitle,
        status: 'draft', items: c.items.map((i) => ({ ...i, key: randomUUID(), paragraphs: [...i.paragraphs] })), renewalOf: c.id, createdByName: u.fullName,
        log: [logEntry('إنشاء مسودة تجديد', u.fullName, `تجديد للعقد ${c.number}`)],
      }));
      c.log = [...c.log, logEntry('بدء التجديد', u.fullName, n.number)];
      await em.save(c);
      return n.id;
    });
    return this.get(u, newId);
  }

  async remove(u: OrgUser, id: string) {
    const c = await this.load(u.organizationId, id);
    if (c.status !== 'draft' || c.version > 0) throw new ConflictException('تُحذف المسودة التي لم تُرسل قط، وغيرها يُلغى');
    await this.db.transaction(async (em) => {
      await em.delete(PtFollowup, { contractId: id });
      await em.delete(PtContract, { id });
    });
    return { ok: true };
  }

  /** نص إصدار سابق مثبت */
  async version(u: OrgUser, id: string, v: number) {
    const c = await this.load(u.organizationId, id);
    const ver = c.versions.find((x) => x.version === v);
    if (!ver) throw new NotFoundException('الإصدار غير موجود');
    return ver;
  }

  // ---------------- صفحة الشريك العامة (برابط سري) ----------------

  private async byToken(em: EntityManager, token: string, lock = false) {
    if (!/^[a-f0-9]{48}$/.test(token)) throw new NotFoundException('الرابط غير صحيح');
    const c = await em.findOne(PtContract, { where: { token, status: Not('draft') }, ...(lock ? { lock: { mode: 'pessimistic_write' as const } } : {}) });
    if (!c || !c.rendered || ['review', 'approved'].includes(c.status)) throw new NotFoundException('العقد غير موجود أو لم يُرسل بعد');
    return c;
  }

  async publicView(token: string) {
    const c = await this.byToken(this.db.manager, token);
    const [o] = await this.db.query('SELECT name FROM organizations WHERE id = $1', [c.organizationId]);
    const p = await this.db.getRepository(PtPartner).findOneOrFail({ where: { id: c.partnerId } });
    const st = contractState(c);
    return {
      number: c.number, version: c.version, title: c.title, status: st, statusLabel: CONTRACT_STATUS[st as keyof typeof CONTRACT_STATUS], organizationName: o?.name ?? '',
      partnerName: p.name, contactName: p.contactName, contactTitle: p.contactTitle, needsRegistration: !!p.registrationNo, rendered: c.rendered, contentHash: c.contentHash,
      sentAt: c.sentAt, signedAt: c.signedAt, signerName: c.signerName, signerTitle: c.signerTitle, changeRequest: c.changeRequest, startsOn: c.startsOn, endsOn: c.endsOn,
    };
  }

  async sign(token: string, dto: SignDto, ip: string) {
    if (!dto.agree) throw new BadRequestException('وافق على بنود العقد أولًا');
    await this.db.transaction(async (em) => {
      const c = await this.byToken(em, token, true);
      if (c.status !== 'sent') throw new BadRequestException(c.status === 'signed' ? 'العقد موقّع بالفعل' : 'العقد غير متاح للتوقيع');
      const p = await em.findOneOrFail(PtPartner, { where: { id: c.partnerId } });
      const norm = (s: string | null | undefined) => (s ?? '').replace(/\s/g, '').replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660)).toLowerCase();
      if (p.registrationNo && norm(p.registrationNo) !== norm(dto.registrationNo)) throw new BadRequestException('رقم السجل أو الترخيص لا يطابق المسجل لدى الجمعية');
      this.outcome(c, 'وُقّع');
      Object.assign(c, {
        status: 'signed', signMethod: 'online', signedAt: new Date(), signerName: dto.signerName.trim(), signerTitle: dto.signerTitle.trim(), signerIp: ip.slice(0, 64),
        log: [...c.log, logEntry('توقيع الشريك إلكترونيًا', `${dto.signerName.trim()} (${dto.signerTitle.trim()})`)],
      });
      await em.save(c);
      await em.update(PtPartner, { id: p.id }, { log: [...p.log, logEntry('توقيع عقد', dto.signerName.trim(), c.number)] });
    });
    return this.publicView(token);
  }

  async requestChanges(token: string, note: string) {
    await this.db.transaction(async (em) => {
      const c = await this.byToken(em, token, true);
      if (c.status !== 'sent') throw new BadRequestException('لا يمكن طلب تعديل في حالة العقد الحالية');
      this.outcome(c, 'طلب الشريك تعديله');
      Object.assign(c, { status: 'changes_requested', changeRequest: note.trim(), log: [...c.log, logEntry('طلب الشريك تعديلًا', 'الشريك', note.trim())] });
      await em.save(c);
    });
    return this.publicView(token);
  }
}
