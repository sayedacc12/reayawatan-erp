import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { DataSource, EntityManager, In } from 'typeorm';
import { OrgUser } from '../../core/auth/decorators';
import { addMonths } from '../../core/organizations/org-access';
import {
  CONTRACT_STATUS, ClauseCategory, EVAL_STATUS, EvalScore, FOLLOWUP_KINDS, FollowupKind, LogEntry, PARTNER_STATUS, PtClass, PtClause, PtContract,
  PtCriterion, PtEvaluation, PtFollowup, PtPartner, PtSettings, PtType, Tier,
} from './entities/partnerships.entity';
import {
  DEFAULT_CATEGORIES, DEFAULT_CLASSES, DEFAULT_CLAUSES, DEFAULT_CRITERIA, DEFAULT_TIERS, DEFAULT_TYPES, PT_VARIABLES,
} from './partnerships-defaults';
import {
  CategoriesDto, ClassesDto, ClauseDto, CriteriaDto, DecisionDto, EvaluationDto, FollowupDoneDto, FollowupDto, GeneralSettingsDto, PartnerDto,
  PartnerStatusDto, TypesDto,
} from './partnerships.dto';
import { PARTNERSHIP_PERMISSIONS as P } from './partnerships.manifest';

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const ptToday = () => new Date(Date.now() + 3 * 3600000).toISOString().slice(0, 10);
export const clean = (s: string | null | undefined) => (s ?? '').trim() || null;
export const logEntry = (action: string, byName: string, note: string | null = null): LogEntry => ({ action, note, byName, at: new Date().toISOString() });
export const partnerCode = (n: number) => `PT-${String(n).padStart(4, '0')}`;
const r2 = (n: number) => Math.round(n * 100) / 100;
const NIL = '00000000-0000-0000-0000-000000000000';

/** حالة العقد المعروضة: الموقّع الذي تجاوز تاريخ نهايته «منتهي» */
export const contractState = (c: { status: string; endsOn: string }, today = ptToday()) => (c.status === 'signed' && c.endsOn < today ? 'expired' : c.status);

/** درجة التقييم من 100: مجموع (الوزن × الدرجة ÷ 5) */
export function scoreOf(scores: { weight: number; score: number }[]) {
  const w = scores.reduce((a, s) => a + s.weight, 0) || 1;
  return r2(scores.reduce((a, s) => a + (s.weight * s.score) / 5, 0) * (100 / w));
}
export function tierOf(tiers: Tier[], total: number, knockout: boolean) {
  if (knockout) return null;
  return [...tiers].sort((a, b) => b.min - a.min).find((t) => total >= t.min) ?? null;
}

/**
 * نظام الشراكات: الإعدادات (الأنواع والتصنيفات والمعايير والمستويات وتبويب البنود)، ومكتبة البنود،
 * وسجل الشركاء وتقييمهم واعتمادهم، ومتابعة التزامات العقود. العقود نفسها في ContractsService.
 */
@Injectable()
export class PartnershipsService {
  constructor(private readonly db: DataSource) {}

  // ================= التهيئة والإعدادات =================

  /** أول استخدام للجمعية: تُنشأ الإعدادات المقترحة (الأنواع والتصنيفات والمعايير والبنود) */
  async settings(org: string, em: EntityManager = this.db.manager): Promise<PtSettings> {
    const found = await em.findOne(PtSettings, { where: { organizationId: org } });
    if (found) return found;
    return this.db.transaction(async (tx) => {
      await tx.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`pt_setup:${org}`]);
      const again = await tx.findOne(PtSettings, { where: { organizationId: org } });
      if (again) return again;
      const s = await tx.save(tx.create(PtSettings, { organizationId: org, tiers: DEFAULT_TIERS, clauseCategories: DEFAULT_CATEGORIES, courtCity: null }));
      const typeIds: Record<string, string> = {};
      for (const [i, t] of DEFAULT_TYPES.entries()) {
        const row = await tx.save(tx.create(PtType, { organizationId: org, name: t.name, description: t.description, color: t.color, minScore: t.minScore, defaultMonths: t.defaultMonths, sortOrder: i }));
        typeIds[t.key] = row.id;
      }
      await tx.insert(PtClass, DEFAULT_CLASSES.map((c, i) => ({ ...c, organizationId: org, sortOrder: i })));
      await tx.insert(PtCriterion, DEFAULT_CRITERIA.map((c, i) => ({ ...c, organizationId: org, sortOrder: i })));
      await tx.insert(PtClause, DEFAULT_CLAUSES.map((c, i) => ({
        organizationId: org, categoryId: c.category, title: c.title, paragraphs: c.paragraphs, typeIds: (c.types ?? []).map((k) => typeIds[k]),
        isMandatory: !!c.mandatory, isDefault: !c.optional, isActive: true, sequence: (i + 1) * 10,
      })));
      return s;
    });
  }

  async types(org: string, em: EntityManager = this.db.manager) {
    await this.settings(org, em);
    return em.find(PtType, { where: { organizationId: org }, order: { sortOrder: 'ASC', name: 'ASC' } });
  }
  async classes(org: string, em: EntityManager = this.db.manager) {
    await this.settings(org, em);
    return em.find(PtClass, { where: { organizationId: org }, order: { sortOrder: 'ASC', name: 'ASC' } });
  }
  async criteria(org: string, em: EntityManager = this.db.manager) {
    await this.settings(org, em);
    return em.find(PtCriterion, { where: { organizationId: org }, order: { sortOrder: 'ASC' } });
  }

  async lookups(org: string) {
    const s = await this.settings(org);
    const [types, classes, criteria] = await Promise.all([this.types(org), this.classes(org), this.criteria(org)]);
    return {
      settings: s, types, classes, criteria, tiers: s.tiers, categories: s.clauseCategories, variables: PT_VARIABLES,
      partnerStatus: PARTNER_STATUS, evalStatus: EVAL_STATUS, contractStatus: CONTRACT_STATUS, followupKinds: FOLLOWUP_KINDS,
    };
  }

  async saveGeneral(u: OrgUser, dto: GeneralSettingsDto) {
    await this.settings(u.organizationId);
    await this.db.getRepository(PtSettings).update({ organizationId: u.organizationId }, {
      alertDays: dto.alertDays, evaluationMonths: dto.evaluationMonths, signerName: clean(dto.signerName), signerTitle: clean(dto.signerTitle),
      orgCity: clean(dto.orgCity), orgLicense: clean(dto.orgLicense), courtCity: clean(dto.courtCity),
    });
    return this.lookups(u.organizationId);
  }

  /** حفظ قائمة كاملة (أنواع أو تصنيفات): يُحدّث الموجود ويُضاف الجديد، ويُمنع حذف المستخدم */
  private async saveList<T extends { id: string; organizationId: string }>(
    org: string, entity: new () => T, rows: ({ id?: string } & Record<string, unknown>)[], used: (em: EntityManager, id: string) => Promise<number>, label: (r: T) => string,
  ) {
    await this.settings(org);
    await this.db.transaction(async (em) => {
      const repo = em.getRepository(entity);
      const existing = await repo.find({ where: { organizationId: org } as never });
      const keep = new Set<string>();
      for (const [i, r] of rows.entries()) {
        const { id, ...data } = r;
        const row = { ...data, name: String(data.name).trim(), description: clean(data.description as string), sortOrder: i } as never;
        if (id) {
          if (!existing.some((x) => x.id === id)) throw new BadRequestException('عنصر غير موجود');
          await repo.update({ id } as never, row);
          keep.add(id);
        } else {
          keep.add((await repo.save(repo.create({ ...(row as object), organizationId: org } as never)) as unknown as T).id);
        }
      }
      for (const x of existing.filter((e) => !keep.has(e.id))) {
        const n = await used(em, x.id);
        if (n) throw new ConflictException(`لا يمكن حذف «${label(x)}» لأنه مستخدم في ${n} سجل. أوقفه بدلًا من ذلك`);
        await repo.delete({ id: x.id } as never);
      }
    });
  }

  async saveTypes(u: OrgUser, dto: TypesDto) {
    await this.saveList(u.organizationId, PtType, dto.types as never, async (em, id) => {
      const [{ n }] = await em.query(
        `SELECT ((SELECT count(*) FROM pt_contracts WHERE type_id = $1) + (SELECT count(*) FROM pt_evaluations WHERE type_id = $1)
               + (SELECT count(*) FROM pt_partners WHERE type_ids ? $1::text))::int AS n`, [id]);
      return n;
    }, (r) => r.name);
    return this.types(u.organizationId);
  }

  async saveClasses(u: OrgUser, dto: ClassesDto) {
    await this.saveList(u.organizationId, PtClass, dto.classes as never, async (em, id) => {
      const [{ n }] = await em.query('SELECT count(*)::int AS n FROM pt_partners WHERE class_id = $1', [id]);
      return n;
    }, (r) => r.name);
    return this.classes(u.organizationId);
  }

  /** المعايير: مجموع أوزان المعايير الفعالة 100%، والمستويات بحدود دنيا متنازلة */
  async saveCriteria(u: OrgUser, dto: CriteriaDto) {
    const org = u.organizationId;
    const total = dto.criteria.filter((c) => c.isActive).reduce((a, c) => a + c.weight, 0);
    if (total !== 100) throw new BadRequestException(`مجموع أوزان المعايير الفعالة يجب أن يكون 100% (الحالي ${total}%)`);
    if (!dto.tiers.length) throw new BadRequestException('أضف مستوى واحدًا على الأقل');
    const keys = new Set(dto.tiers.map((t) => t.key));
    if (keys.size !== dto.tiers.length) throw new BadRequestException('رموز المستويات مكررة');
    await this.settings(org);
    await this.db.transaction(async (em) => {
      const repo = em.getRepository(PtCriterion);
      const existing = await repo.find({ where: { organizationId: org } });
      const keep = new Set<string>();
      for (const [i, c] of dto.criteria.entries()) {
        const data = { name: c.name.trim(), guide: clean(c.guide), weight: c.weight, knockout: c.knockout, isActive: c.isActive, sortOrder: i };
        if (c.id) {
          if (!existing.some((x) => x.id === c.id)) throw new BadRequestException('معيار غير موجود');
          await repo.update({ id: c.id }, data);
          keep.add(c.id);
        } else keep.add((await repo.save(repo.create({ ...data, organizationId: org }))).id);
      }
      // المعيار المستخدم في تقييم سابق يبقى محفوظًا في التقييم نفسه، فيمكن حذفه من القائمة
      const gone = existing.filter((x) => !keep.has(x.id)).map((x) => x.id);
      if (gone.length) await repo.delete({ id: In(gone) });
      await em.update(PtSettings, { organizationId: org }, { tiers: [...dto.tiers].sort((a, b) => b.min - a.min).map((t) => ({ ...t, label: t.label.trim() })) });
    });
    return this.lookups(org);
  }

  async saveCategories(u: OrgUser, dto: CategoriesDto) {
    const org = u.organizationId;
    const s = await this.settings(org);
    const slug = () => `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    const list: ClauseCategory[] = dto.categories.map((c) => ({ id: c.id && s.clauseCategories.some((x) => x.id === c.id) ? c.id : slug(), name: c.name.trim(), color: c.color.toLowerCase() }));
    if (!list.length) throw new BadRequestException('أضف تبويبًا واحدًا على الأقل');
    const removed = s.clauseCategories.filter((c) => !list.some((x) => x.id === c.id));
    for (const c of removed) {
      const [{ n }] = await this.db.query('SELECT count(*)::int AS n FROM pt_clauses WHERE organization_id = $1 AND category_id = $2', [org, c.id]);
      if (n) throw new ConflictException(`لا يمكن حذف التبويب «${c.name}» لأن فيه ${n} بند. انقل بنوده أولًا`);
    }
    await this.db.getRepository(PtSettings).update({ organizationId: org }, { clauseCategories: list });
    return list;
  }

  // ================= مكتبة البنود =================

  async clauses(org: string) {
    const s = await this.settings(org);
    const order = new Map(s.clauseCategories.map((c, i) => [c.id, i]));
    const rows = await this.db.getRepository(PtClause).find({ where: { organizationId: org }, order: { sequence: 'ASC', createdAt: 'ASC' } });
    return rows.sort((a, b) => (order.get(a.categoryId) ?? 99) - (order.get(b.categoryId) ?? 99) || a.sequence - b.sequence);
  }

  private async clauseFields(org: string, dto: ClauseDto) {
    const s = await this.settings(org);
    if (!s.clauseCategories.some((c) => c.id === dto.categoryId)) throw new BadRequestException('اختر تبويب البند');
    const paragraphs = dto.paragraphs.map((p) => p.trim()).filter(Boolean);
    if (!paragraphs.length) throw new BadRequestException('اكتب فقرة واحدة على الأقل');
    if (dto.typeIds.length) {
      const [{ n }] = await this.db.query('SELECT count(*)::int AS n FROM pt_types WHERE organization_id = $1 AND id = ANY($2::uuid[])', [org, dto.typeIds]);
      if (n !== new Set(dto.typeIds).size) throw new BadRequestException('نوع شراكة غير معروف');
    }
    return { categoryId: dto.categoryId, title: dto.title.trim(), paragraphs, typeIds: [...new Set(dto.typeIds)], isMandatory: dto.isMandatory, isDefault: dto.isDefault || dto.isMandatory, isActive: dto.isActive };
  }

  async createClause(u: OrgUser, dto: ClauseDto) {
    const org = u.organizationId;
    const f = await this.clauseFields(org, dto);
    const [{ max }] = await this.db.query('SELECT coalesce(max(sequence), 0)::int AS max FROM pt_clauses WHERE organization_id = $1', [org]);
    const repo = this.db.getRepository(PtClause);
    return repo.save(repo.create({ ...f, organizationId: org, sequence: max + 10 }));
  }

  async updateClause(u: OrgUser, id: string, dto: ClauseDto) {
    const c = await this.loadClause(u.organizationId, id);
    await this.db.getRepository(PtClause).update({ id: c.id }, await this.clauseFields(u.organizationId, dto));
    return this.loadClause(u.organizationId, id);
  }

  private async loadClause(org: string, id: string) {
    if (!UUID.test(id)) throw new NotFoundException('البند غير موجود');
    const c = await this.db.getRepository(PtClause).findOne({ where: { id, organizationId: org } });
    if (!c) throw new NotFoundException('البند غير موجود');
    return c;
  }

  /** حذف بند من المكتبة لا يؤثر على العقود الصادرة (كل عقد يحمل نسخته من البنود) */
  async deleteClause(u: OrgUser, id: string) {
    const c = await this.loadClause(u.organizationId, id);
    await this.db.getRepository(PtClause).delete({ id: c.id });
    return { ok: true };
  }

  async reorderClauses(u: OrgUser, ids: string[]) {
    await this.db.transaction(async (em) => {
      for (const [i, id] of ids.entries()) await em.update(PtClause, { id, organizationId: u.organizationId }, { sequence: (i + 1) * 10 });
    });
    return this.clauses(u.organizationId);
  }

  /** استعادة البنود المقترحة: تُضاف البنود الناقصة (بالعنوان) دون المساس بما عدّلته الجمعية */
  async restoreClauses(u: OrgUser) {
    const org = u.organizationId;
    const s = await this.settings(org);
    const cats = [...s.clauseCategories];
    for (const d of DEFAULT_CATEGORIES) if (!cats.some((c) => c.id === d.id)) cats.push(d);
    await this.db.getRepository(PtSettings).update({ organizationId: org }, { clauseCategories: cats });
    const existing = new Set((await this.clauses(org)).map((c) => c.title));
    const types = await this.types(org);
    const byKey = Object.fromEntries(DEFAULT_TYPES.map((t) => [t.key, types.find((x) => x.name === t.name)?.id]).filter(([, v]) => v));
    const [{ max }] = await this.db.query('SELECT coalesce(max(sequence), 0)::int AS max FROM pt_clauses WHERE organization_id = $1', [org]);
    const add = DEFAULT_CLAUSES.filter((c) => !existing.has(c.title));
    if (add.length) {
      await this.db.getRepository(PtClause).insert(add.map((c, i) => ({
        organizationId: org, categoryId: c.category, title: c.title, paragraphs: c.paragraphs, typeIds: (c.types ?? []).map((k) => byKey[k]).filter(Boolean) as string[],
        isMandatory: !!c.mandatory, isDefault: !c.optional, isActive: true, sequence: max + (i + 1) * 10,
      })));
    }
    return { added: add.length, clauses: await this.clauses(org) };
  }

  // ================= الشركاء =================

  private async ctx(org: string) {
    const [s, types, classes] = await Promise.all([this.settings(org), this.types(org), this.classes(org)]);
    return { s, types: new Map(types.map((t) => [t.id, t])), classes: new Map(classes.map((c) => [c.id, c])) };
  }

  private partnerRow(p: PtPartner, c: Awaited<ReturnType<PartnershipsService['ctx']>>, extra: { contracts?: number } = {}) {
    const cls = p.classId ? c.classes.get(p.classId) : null;
    const tier = p.tier ? c.s.tiers.find((t) => t.key === p.tier) : null;
    const today = ptToday();
    return {
      id: p.id, partnerNo: p.partnerNo, code: partnerCode(p.partnerNo), name: p.name, classId: p.classId, className: cls?.name ?? null, classColor: cls?.color ?? '#64748b',
      typeIds: p.typeIds, types: p.typeIds.map((id) => c.types.get(id)).filter(Boolean).map((t) => ({ id: t!.id, name: t!.name, color: t!.color })),
      registrationNo: p.registrationNo, city: p.city, website: p.website, contactName: p.contactName, contactTitle: p.contactTitle, phone: p.phone, email: p.email,
      status: p.status, statusLabel: PARTNER_STATUS[p.status], tier: p.tier, tierLabel: tier?.label ?? null, tierColor: tier?.color ?? null,
      score: p.score === null ? null : Number(p.score), showOnWebsite: p.showOnWebsite, donorId: p.donorId, nextEvaluationOn: p.nextEvaluationOn,
      evaluationDue: p.status === 'approved' && !!p.nextEvaluationOn && p.nextEvaluationOn <= today, approvedAt: p.approvedAt,
      activeContracts: extra.contracts ?? 0, updatedAt: p.updatedAt,
    };
  }

  async partners(u: OrgUser, f: { q?: string; status?: string; type?: string; class?: string; tier?: string }) {
    const org = u.organizationId;
    const c = await this.ctx(org);
    const qb = this.db.getRepository(PtPartner).createQueryBuilder('p').where('p.organization_id = :org', { org });
    if (f.status && f.status in PARTNER_STATUS) qb.andWhere('p.status = :st', { st: f.status });
    if (f.type && UUID.test(f.type)) qb.andWhere('p.type_ids ? :t', { t: f.type });
    if (f.class && UUID.test(f.class)) qb.andWhere('p.class_id = :c', { c: f.class });
    if (f.tier) qb.andWhere('p.tier = :tier', { tier: f.tier });
    const q = (f.q ?? '').trim().replace(/[%_]/g, '');
    if (q) qb.andWhere('(p.name ILIKE :q OR p.contact_name ILIKE :q OR p.city ILIKE :q OR p.registration_no ILIKE :q OR p.email ILIKE :q)', { q: `%${q}%` });
    const rows = await qb.orderBy('p.updated_at', 'DESC').take(1000).getMany();
    const counts: { partner_id: string; n: number }[] = await this.db.query(
      `SELECT partner_id, count(*)::int AS n FROM pt_contracts WHERE organization_id = $1 AND status = 'signed' AND ends_on >= $2 GROUP BY partner_id`, [org, ptToday()]);
    const m = new Map(counts.map((x) => [x.partner_id, x.n]));
    return rows.map((p) => this.partnerRow(p, c, { contracts: m.get(p.id) ?? 0 }));
  }

  async loadPartner(org: string, id: string, em: EntityManager = this.db.manager) {
    if (!UUID.test(id)) throw new NotFoundException('الشريك غير موجود');
    const p = await em.findOne(PtPartner, { where: { id, organizationId: org } });
    if (!p) throw new NotFoundException('الشريك غير موجود');
    return p;
  }

  async partner(u: OrgUser, id: string) {
    const org = u.organizationId;
    const p = await this.loadPartner(org, id);
    const c = await this.ctx(org);
    const evaluations = await this.db.getRepository(PtEvaluation).find({ where: { organizationId: org, partnerId: id }, order: { createdAt: 'DESC' } });
    const contracts = await this.db.getRepository(PtContract).find({ where: { organizationId: org, partnerId: id }, order: { createdAt: 'DESC' } });
    const projectNames = await this.projectNames(org, contracts.map((x) => x.projectId));
    const [donor] = p.donorId ? await this.db.query('SELECT id, name, donor_no AS "donorNo" FROM fundraising_donors WHERE id = $1 AND organization_id = $2', [p.donorId, org]) : [null];
    const followups = contracts.length ? await this.db.getRepository(PtFollowup).find({ where: { organizationId: org, contractId: In(contracts.map((x) => x.id)) }, order: { dueDate: 'ASC' } }) : [];
    const today = ptToday();
    const active = contracts.filter((x) => contractState(x, today) === 'signed').length;
    return {
      ...this.partnerRow(p, c, { contracts: active }), about: p.about, donor: donor ?? null, log: [...p.log].reverse(), createdByName: p.createdByName, createdAt: p.createdAt,
      evaluations: evaluations.map((e) => this.evalRow(e, c)),
      contracts: contracts.map((x) => ({
        id: x.id, number: x.number, title: x.title, typeName: x.typeId ? c.types.get(x.typeId)?.name ?? null : null, startsOn: x.startsOn, endsOn: x.endsOn,
        value: x.value === null ? null : Number(x.value), status: contractState(x, today), statusLabel: CONTRACT_STATUS[contractState(x, today) as keyof typeof CONTRACT_STATUS],
        projectName: x.projectId ? projectNames.get(x.projectId) ?? null : null, version: x.version,
      })),
      followups: followups.map((f) => this.followupRow(f, contracts.find((x) => x.id === f.contractId)!, p.name)),
      can: {
        edit: u.permissions.includes(P.partners), evaluate: u.permissions.includes(P.evaluate), contract: u.permissions.includes(P.contracts) && p.status === 'approved',
        decide: u.permissions.includes(P.approve), status: u.permissions.includes(P.approve),
      },
    };
  }

  private async partnerFields(em: EntityManager, org: string, dto: PartnerDto, id?: string) {
    const name = dto.name.trim();
    const [dup] = await em.query('SELECT id FROM pt_partners WHERE organization_id = $1 AND lower(name) = lower($2) AND id <> $3', [org, name, id ?? NIL]);
    if (dup) throw new ConflictException(`يوجد شريك مسجل بالاسم «${name}»`);
    if (dto.classId) {
      const [c] = await em.query('SELECT id FROM pt_classes WHERE id = $1 AND organization_id = $2', [dto.classId, org]);
      if (!c) throw new BadRequestException('التصنيف غير موجود');
    }
    const typeIds = [...new Set(dto.typeIds)];
    if (typeIds.length) {
      const [{ n }] = await em.query('SELECT count(*)::int AS n FROM pt_types WHERE organization_id = $1 AND id = ANY($2::uuid[])', [org, typeIds]);
      if (n !== typeIds.length) throw new BadRequestException('نوع شراكة غير معروف');
    }
    if (dto.donorId) {
      const [d] = await em.query('SELECT id FROM fundraising_donors WHERE id = $1 AND organization_id = $2', [dto.donorId, org]);
      if (!d) throw new BadRequestException('المانح غير موجود في تنمية الموارد');
    }
    let website = clean(dto.website);
    if (website && !/^https?:\/\//i.test(website)) website = `https://${website}`;
    if (website && !/^https?:\/\/[^\s"'<>]+$/i.test(website)) throw new BadRequestException('رابط الموقع غير صحيح');
    return {
      name, classId: dto.classId ?? null, typeIds, registrationNo: clean(dto.registrationNo), city: clean(dto.city), website, contactName: clean(dto.contactName),
      contactTitle: clean(dto.contactTitle), phone: clean(dto.phone), email: clean(dto.email)?.toLowerCase() ?? null, about: clean(dto.about), donorId: dto.donorId ?? null,
      showOnWebsite: dto.showOnWebsite,
    };
  }

  async createPartner(u: OrgUser, dto: PartnerDto) {
    const org = u.organizationId;
    await this.settings(org);
    const id = await this.db.transaction(async (em) => {
      await em.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`pt_partner_no:${org}`]);
      const f = await this.partnerFields(em, org, dto);
      const [{ n }] = await em.query('SELECT coalesce(max(partner_no), 0)::int + 1 AS n FROM pt_partners WHERE organization_id = $1', [org]);
      const p = await em.save(em.create(PtPartner, { ...f, organizationId: org, partnerNo: n, status: 'prospect', createdByName: u.fullName, log: [logEntry('تسجيل الشريك', u.fullName)] }));
      return p.id;
    });
    return this.partner(u, id);
  }

  async updatePartner(u: OrgUser, id: string, dto: PartnerDto) {
    await this.db.transaction(async (em) => {
      const p = await this.loadPartner(u.organizationId, id, em);
      const f = await this.partnerFields(em, u.organizationId, dto, id);
      await em.update(PtPartner, { id }, { ...f, log: [...p.log, logEntry('تعديل البيانات', u.fullName)] });
    });
    return this.partner(u, id);
  }

  /** إيقاف شريك معتمد أو إعادته، أو إعادة شريك غير مقبول إلى «محتمل» لتقييمه من جديد */
  async setPartnerStatus(u: OrgUser, id: string, dto: PartnerStatusDto) {
    const p = await this.loadPartner(u.organizationId, id);
    const allowed: Record<string, string[]> = { suspended: ['approved'], approved: ['suspended'], prospect: ['rejected', 'suspended'] };
    if (!allowed[dto.status].includes(p.status)) throw new BadRequestException('لا يمكن تنفيذ هذا الإجراء في حالة الشريك الحالية');
    if (dto.status === 'approved' && !p.tier) throw new BadRequestException('الشريك يحتاج تقييمًا معتمدًا');
    const label = dto.status === 'suspended' ? 'إيقاف الشراكة' : dto.status === 'approved' ? 'إعادة تفعيل الشراكة' : 'إعادته شريكًا محتملًا';
    await this.db.getRepository(PtPartner).update({ id }, {
      status: dto.status, ...(dto.status === 'prospect' ? { tier: null, score: null } : {}),
      log: [...p.log, logEntry(label, u.fullName, dto.note.trim())],
    });
    return this.partner(u, id);
  }

  async removePartner(u: OrgUser, id: string) {
    const p = await this.loadPartner(u.organizationId, id);
    const [{ n }] = await this.db.query('SELECT count(*)::int AS n FROM pt_contracts WHERE partner_id = $1', [id]);
    if (n || p.status === 'approved') throw new ConflictException('لا يُحذف شريك معتمد أو له عقود، أوقفه بدلًا من ذلك');
    await this.db.transaction(async (em) => {
      await em.delete(PtEvaluation, { partnerId: id });
      await em.delete(PtPartner, { id });
    });
    return { ok: true };
  }

  // ================= التقييم والاعتماد =================

  private evalRow(e: PtEvaluation, c: Awaited<ReturnType<PartnershipsService['ctx']>>) {
    const tier = e.tier ? c.s.tiers.find((t) => t.key === e.tier) : null;
    const total = Number(e.total);
    return {
      id: e.id, partnerId: e.partnerId, typeId: e.typeId, typeName: e.typeId ? c.types.get(e.typeId)?.name ?? null : null, scores: e.scores, total,
      tier: e.tier, tierLabel: tier?.label ?? null, tierColor: tier?.color ?? null, minScore: e.minScore, knockoutFailed: e.knockoutFailed,
      meetsRules: !e.knockoutFailed && total >= e.minScore, recommendation: e.recommendation, status: e.status, statusLabel: EVAL_STATUS[e.status],
      overridden: e.overridden, decisionNote: e.decisionNote, evaluatorName: e.evaluatorName, submittedAt: e.submittedAt, decidedByName: e.decidedByName,
      decidedAt: e.decidedAt, createdAt: e.createdAt,
    };
  }

  /** حفظ تقييم الشريك (مسودة أو رفع للاعتماد). تقييم مفتوح واحد لكل شريك */
  async saveEvaluation(u: OrgUser, partnerId: string, dto: EvaluationDto, evaluationId?: string) {
    const org = u.organizationId;
    const s = await this.settings(org);
    const id = await this.db.transaction(async (em) => {
      const p = await this.loadPartner(org, partnerId, em);
      if (p.status === 'suspended') throw new BadRequestException('الشريك موقوف، أعده أولًا');
      const type = await em.findOne(PtType, { where: { id: dto.typeId, organizationId: org } });
      if (!type) throw new BadRequestException('نوع الشراكة غير موجود');
      const criteria = await em.find(PtCriterion, { where: { organizationId: org, isActive: true }, order: { sortOrder: 'ASC' } });
      if (!criteria.length) throw new BadRequestException('لا توجد معايير اختيار فعالة. أضفها من الإعدادات');
      const given = new Map(dto.scores.map((x) => [x.criterionId, x]));
      const missing = criteria.filter((c) => !given.has(c.id));
      if (dto.submit && missing.length) throw new BadRequestException(`قيّم كل المعايير قبل الرفع: ${missing.map((m) => m.name).join('، ')}`);
      const scores: EvalScore[] = criteria.filter((c) => given.has(c.id)).map((c) => ({
        criterionId: c.id, name: c.name, weight: c.weight, knockout: c.knockout, score: given.get(c.id)!.score, note: clean(given.get(c.id)!.note),
      }));
      const total = missing.length ? scoreOf([...scores, ...missing.map((m) => ({ weight: m.weight, score: 0 }))]) : scoreOf(scores);
      const knockoutFailed = scores.some((x) => x.knockout && x.score <= 1);
      const tier = tierOf(s.tiers, total, knockoutFailed);
      const repo = em.getRepository(PtEvaluation);
      let e: PtEvaluation | null = null;
      if (evaluationId) {
        e = await repo.findOne({ where: { id: evaluationId, organizationId: org, partnerId } });
        if (!e) throw new NotFoundException('التقييم غير موجود');
        if (e.status !== 'draft' && e.status !== 'returned') throw new BadRequestException('التقييم مرفوع للاعتماد ولا يُعدّل');
      } else {
        const open = await repo.findOne({ where: { organizationId: org, partnerId, status: In(['draft', 'submitted', 'returned']) } });
        if (open) throw new ConflictException('للشريك تقييم مفتوح بالفعل. أكمله أولًا');
      }
      const data = {
        typeId: type.id, scores, total: String(total), tier: tier?.key ?? null, minScore: type.minScore, knockoutFailed, recommendation: clean(dto.recommendation),
        status: dto.submit ? 'submitted' as const : 'draft' as const, submittedAt: dto.submit ? new Date() : null, evaluatorName: u.fullName,
      };
      const saved = e ? (await repo.update({ id: e.id }, data), e.id) : (await repo.save(repo.create({ ...data, organizationId: org, partnerId }))).id;
      const next = p.status === 'approved' ? 'approved' : dto.submit ? 'pending' : 'evaluating';
      await em.update(PtPartner, { id: p.id }, {
        status: next,
        log: [...p.log, logEntry(dto.submit ? 'رفع التقييم للاعتماد' : 'حفظ مسودة التقييم', u.fullName, `${type.name}: ${total} من 100${knockoutFailed ? ' (لم يجتز معيارًا حاسمًا)' : ''}`)],
      });
      return saved;
    });
    const c = await this.ctx(org);
    return this.evalRow(await this.db.getRepository(PtEvaluation).findOneByOrFail({ id }), c);
  }

  /**
   * قرار المعتمد: اعتماد أو رفض أو إرجاع للمقيّم. القواعد استرشادية:
   * الاعتماد رغم درجة أقل من الحد أو معيار حاسم غير مجتاز يحتاج سببًا، ويُعلَّم التقييم بذلك.
   */
  async decideEvaluation(u: OrgUser, evaluationId: string, dto: DecisionDto) {
    const org = u.organizationId;
    const s = await this.settings(org);
    if (!UUID.test(evaluationId)) throw new NotFoundException('التقييم غير موجود');
    await this.db.transaction(async (em) => {
      const e = await em.findOne(PtEvaluation, { where: { id: evaluationId, organizationId: org }, lock: { mode: 'pessimistic_write' } });
      if (!e) throw new NotFoundException('التقييم غير موجود');
      if (e.status !== 'submitted') throw new BadRequestException('التقييم ليس بانتظار الاعتماد');
      const p = await this.loadPartner(org, e.partnerId, em);
      const note = clean(dto.note);
      const total = Number(e.total);
      const breaks = e.knockoutFailed || total < e.minScore;
      if (dto.decision !== 'approve' && (!note || note.length < 3)) throw new BadRequestException('اكتب سبب القرار');
      if (dto.decision === 'approve' && breaks && (!note || note.length < 5)) {
        throw new BadRequestException(e.knockoutFailed ? 'الشريك لم يجتز معيارًا حاسمًا. اكتب سبب الاعتماد رغم ذلك' : `الدرجة ${total} أقل من الحد الأدنى ${e.minScore}. اكتب سبب الاعتماد رغم ذلك`);
      }
      const status = dto.decision === 'approve' ? 'approved' : dto.decision === 'reject' ? 'rejected' : 'returned';
      // المعتمد رغم الاستبعاد يأخذ أدنى مستوى
      const tier = dto.decision === 'approve' ? (e.tier ?? [...s.tiers].sort((a, b) => a.min - b.min)[0]?.key ?? null) : e.tier;
      await em.update(PtEvaluation, { id: e.id }, {
        status, tier, overridden: dto.decision === 'approve' && breaks, decisionNote: note, decidedByName: u.fullName, decidedAt: new Date(),
      });
      const label = { approved: 'اعتماد الشريك', rejected: 'رفض التقييم', returned: 'إرجاع التقييم للمقيّم' }[status];
      const patch: Partial<PtPartner> = { log: [...p.log, logEntry(label, u.fullName, note)] };
      if (status === 'approved') {
        Object.assign(patch, {
          status: 'approved', tier, score: e.total, approvedAt: new Date(), nextEvaluationOn: addMonths(ptToday(), s.evaluationMonths),
          typeIds: e.typeId && !p.typeIds.includes(e.typeId) ? [...p.typeIds, e.typeId] : p.typeIds,
        });
      } else if (status === 'rejected') {
        if (p.status !== 'approved') patch.status = 'rejected';
      } else if (p.status === 'pending') patch.status = 'evaluating';
      await em.update(PtPartner, { id: p.id }, patch);
    });
    return this.partner(u, (await this.db.getRepository(PtEvaluation).findOneByOrFail({ id: evaluationId })).partnerId);
  }

  /** الاعتمادات المعلقة: التقييمات المرفوعة والعقود بانتظار الاعتماد الداخلي */
  async approvals(u: OrgUser) {
    const org = u.organizationId;
    const c = await this.ctx(org);
    const evals = await this.db.getRepository(PtEvaluation).find({ where: { organizationId: org, status: 'submitted' }, order: { submittedAt: 'ASC' } });
    const partners = evals.length ? await this.db.getRepository(PtPartner).find({ where: { id: In(evals.map((e) => e.partnerId)) } }) : [];
    const contracts = await this.db.getRepository(PtContract).find({ where: { organizationId: org, status: 'review' }, order: { updatedAt: 'ASC' } });
    const cp = contracts.length ? await this.db.getRepository(PtPartner).find({ where: { id: In(contracts.map((x) => x.partnerId)) } }) : [];
    return {
      evaluations: evals.map((e) => {
        const p = partners.find((x) => x.id === e.partnerId)!;
        return { ...this.evalRow(e, c), partner: this.partnerRow(p, c), about: p.about };
      }),
      contracts: contracts.map((x) => ({
        id: x.id, number: x.number, title: x.title, partnerName: cp.find((p) => p.id === x.partnerId)?.name ?? '', typeName: x.typeId ? c.types.get(x.typeId)?.name ?? null : null,
        startsOn: x.startsOn, endsOn: x.endsOn, value: x.value === null ? null : Number(x.value), clauses: x.items.length, submittedBy: [...x.log].reverse().find((l) => l.action === 'رفع للاعتماد')?.byName ?? x.createdByName,
      })),
    };
  }

  // ================= المتابعة =================

  followupRow(f: PtFollowup, contract: { number: string; title: string; partnerId: string }, partnerName: string) {
    const today = ptToday();
    return {
      id: f.id, contractId: f.contractId, contractNumber: contract.number, contractTitle: contract.title, partnerId: contract.partnerId, partnerName,
      title: f.title, kind: f.kind, kindLabel: FOLLOWUP_KINDS[f.kind], party: f.party, dueDate: f.dueDate, responsible: f.responsible, doneAt: f.doneAt, note: f.note,
      overdue: !f.doneAt && f.dueDate < today, daysLeft: Math.round((Date.parse(f.dueDate) - Date.parse(today)) / 86400000),
    };
  }

  async followups(u: OrgUser, f: { status?: string; contract?: string }) {
    const org = u.organizationId;
    const qb = this.db.getRepository(PtFollowup).createQueryBuilder('f').where('f.organization_id = :org', { org });
    if (f.contract && UUID.test(f.contract)) qb.andWhere('f.contract_id = :c', { c: f.contract });
    if (f.status === 'open') qb.andWhere('f.done_at IS NULL');
    if (f.status === 'done') qb.andWhere('f.done_at IS NOT NULL');
    if (f.status === 'overdue') qb.andWhere('f.done_at IS NULL AND f.due_date < :t', { t: ptToday() });
    const rows = await qb.orderBy('f.done_at IS NULL', 'DESC').addOrderBy('f.due_date', 'ASC').take(1000).getMany();
    const contracts = rows.length ? await this.db.getRepository(PtContract).find({ where: { id: In([...new Set(rows.map((r) => r.contractId))]) } }) : [];
    const partners = contracts.length ? await this.db.getRepository(PtPartner).find({ where: { id: In([...new Set(contracts.map((c) => c.partnerId))]) } }) : [];
    return rows.map((r) => {
      const c = contracts.find((x) => x.id === r.contractId)!;
      return this.followupRow(r, c, partners.find((p) => p.id === c.partnerId)?.name ?? '');
    });
  }

  private async contractFor(org: string, id: string) {
    if (!UUID.test(id)) throw new NotFoundException('العقد غير موجود');
    const c = await this.db.getRepository(PtContract).findOne({ where: { id, organizationId: org } });
    if (!c) throw new NotFoundException('العقد غير موجود');
    return c;
  }

  async addFollowup(u: OrgUser, contractId: string, dto: FollowupDto) {
    const c = await this.contractFor(u.organizationId, contractId);
    if (['cancelled', 'terminated'].includes(c.status)) throw new BadRequestException('العقد منتهٍ أو ملغى');
    const repo = this.db.getRepository(PtFollowup);
    await repo.save(repo.create({
      organizationId: u.organizationId, contractId, title: dto.title.trim(), kind: dto.kind as FollowupKind, party: dto.party, dueDate: dto.dueDate,
      responsible: clean(dto.responsible), note: clean(dto.note), createdByName: u.fullName,
    }));
    return this.followups(u, { contract: contractId });
  }

  private async loadFollowup(org: string, id: string) {
    if (!UUID.test(id)) throw new NotFoundException('المتابعة غير موجودة');
    const f = await this.db.getRepository(PtFollowup).findOne({ where: { id, organizationId: org } });
    if (!f) throw new NotFoundException('المتابعة غير موجودة');
    return f;
  }

  async updateFollowup(u: OrgUser, id: string, dto: FollowupDto) {
    const f = await this.loadFollowup(u.organizationId, id);
    await this.db.getRepository(PtFollowup).update({ id }, {
      title: dto.title.trim(), kind: dto.kind as FollowupKind, party: dto.party, dueDate: dto.dueDate, responsible: clean(dto.responsible), note: clean(dto.note),
    });
    return this.followups(u, { contract: f.contractId });
  }

  async doneFollowup(u: OrgUser, id: string, dto: FollowupDoneDto) {
    const f = await this.loadFollowup(u.organizationId, id);
    await this.db.getRepository(PtFollowup).update({ id }, { doneAt: dto.done ? ptToday() : null, note: dto.note !== undefined ? clean(dto.note) : f.note });
    return this.followups(u, { contract: f.contractId });
  }

  async removeFollowup(u: OrgUser, id: string) {
    const f = await this.loadFollowup(u.organizationId, id);
    await this.db.getRepository(PtFollowup).delete({ id });
    return this.followups(u, { contract: f.contractId });
  }

  // ================= اللوحة =================

  async overview(u: OrgUser) {
    const org = u.organizationId;
    const c = await this.ctx(org);
    const today = ptToday();
    const soon = new Date(Date.parse(today) + c.s.alertDays * 86400000).toISOString().slice(0, 10);
    const partners = await this.db.getRepository(PtPartner).find({ where: { organizationId: org } });
    const contracts = await this.db.getRepository(PtContract).find({ where: { organizationId: org } });
    const pname = new Map(partners.map((p) => [p.id, p.name]));
    const approved = partners.filter((p) => p.status === 'approved');
    const active = contracts.filter((x) => contractState(x, today) === 'signed');
    const expiring = active.filter((x) => x.endsOn <= soon).sort((a, b) => a.endsOn.localeCompare(b.endsOn));
    const [fu] = await this.db.query(
      `SELECT count(*) FILTER (WHERE done_at IS NULL AND due_date < $2)::int AS overdue, count(*) FILTER (WHERE done_at IS NULL AND due_date BETWEEN $2 AND $3)::int AS soon,
              count(*) FILTER (WHERE done_at IS NOT NULL)::int AS done, count(*)::int AS total
         FROM pt_followups WHERE organization_id = $1`, [org, today, new Date(Date.parse(today) + 30 * 86400000).toISOString().slice(0, 10)]);
    const overdueList = (await this.followups(u, { status: 'overdue' })).slice(0, 8);
    const [evalCount] = await this.db.query(`SELECT count(*) FILTER (WHERE status = 'submitted')::int AS pending FROM pt_evaluations WHERE organization_id = $1`, [org]);
    const totalValue = active.reduce((a, x) => a + Number(x.value ?? 0), 0);
    return {
      alertDays: c.s.alertDays,
      partners: {
        total: partners.length, approved: approved.length, prospects: partners.filter((p) => ['prospect', 'evaluating'].includes(p.status)).length,
        pending: partners.filter((p) => p.status === 'pending').length, suspended: partners.filter((p) => p.status === 'suspended').length,
        evaluationDue: approved.filter((p) => p.nextEvaluationOn && p.nextEvaluationOn <= today).length,
        avgScore: approved.length ? r2(approved.reduce((a, p) => a + Number(p.score ?? 0), 0) / approved.length) : 0,
      },
      contracts: {
        active: active.length, value: totalValue, expiring: expiring.length, drafts: contracts.filter((x) => x.status === 'draft').length,
        review: contracts.filter((x) => x.status === 'review').length, awaitingSign: contracts.filter((x) => ['approved', 'sent'].includes(x.status)).length,
        changes: contracts.filter((x) => x.status === 'changes_requested').length, expired: contracts.filter((x) => contractState(x, today) === 'expired').length,
      },
      followups: fu, pendingEvaluations: evalCount.pending,
      byTier: c.s.tiers.map((t) => ({ ...t, count: approved.filter((p) => p.tier === t.key).length })),
      byType: [...c.types.values()].filter((t) => t.isActive).map((t) => ({ id: t.id, name: t.name, color: t.color, partners: approved.filter((p) => p.typeIds.includes(t.id)).length, contracts: active.filter((x) => x.typeId === t.id).length })),
      byClass: [...c.classes.values()].filter((x) => x.isActive).map((x) => ({ id: x.id, name: x.name, color: x.color, count: partners.filter((p) => p.classId === x.id && p.status !== 'rejected').length })),
      expiring: expiring.slice(0, 8).map((x) => ({ id: x.id, number: x.number, title: x.title, partnerName: pname.get(x.partnerId) ?? '', endsOn: x.endsOn, daysLeft: Math.round((Date.parse(x.endsOn) - Date.parse(today)) / 86400000) })),
      overdue: overdueList,
      evaluationDue: approved.filter((p) => p.nextEvaluationOn && p.nextEvaluationOn <= soon).slice(0, 6).map((p) => ({ id: p.id, name: p.name, nextEvaluationOn: p.nextEvaluationOn })),
      recent: partners.sort((a, b) => +b.updatedAt - +a.updatedAt).slice(0, 6).map((p) => this.partnerRow(p, c)),
    };
  }

  // ================= الربط مع الأنظمة الأخرى =================

  /** قوائم اختيار: المانحون من تنمية الموارد، والمشاريع من نظام المشاريع، والشركاء المعتمدون */
  async picks(u: OrgUser) {
    const org = u.organizationId;
    const [donors, projects, partners] = await Promise.all([
      this.db.query(`SELECT id, name, donor_no AS "donorNo", type FROM fundraising_donors WHERE organization_id = $1 AND is_active ORDER BY (type = 'entity') DESC, name LIMIT 2000`, [org]),
      this.db.query(`SELECT a.id, a.name, p.project_no AS "projectNo" FROM activities a JOIN project_profiles p ON p.activity_id = a.id WHERE a.organization_id = $1 ORDER BY a.name`, [org]),
      this.db.query(`SELECT id, name, partner_no AS "partnerNo", status, type_ids AS "typeIds", contact_name AS "contactName", contact_title AS "contactTitle" FROM pt_partners WHERE organization_id = $1 ORDER BY name`, [org]),
    ]);
    return { donors, projects, partners };
  }

  async projectNames(org: string, ids: (string | null)[]) {
    const list = [...new Set(ids.filter(Boolean))] as string[];
    if (!list.length) return new Map<string, string>();
    const rows: { id: string; name: string }[] = await this.db.query('SELECT id, name FROM activities WHERE organization_id = $1 AND id = ANY($2::uuid[])', [org, list]);
    return new Map(rows.map((r) => [r.id, r.name]));
  }

  /** الشركاء المعتمدون المختارون للظهور في صفحة الشركاء بالموقع الإلكتروني */
  async websitePartners(org: string) {
    const exists = await this.db.getRepository(PtSettings).exists({ where: { organizationId: org } });
    if (!exists) return [];
    const c = await this.ctx(org);
    const rows = await this.db.getRepository(PtPartner).find({ where: { organizationId: org, status: 'approved', showOnWebsite: true }, order: { score: 'DESC', name: 'ASC' } });
    return rows.map((p) => ({
      name: p.name, url: p.website && /^https:\/\//.test(p.website) ? p.website : '',
      kind: (p.typeIds.map((id) => c.types.get(id)?.name).find(Boolean) ?? (p.classId ? c.classes.get(p.classId)?.name : null)) ?? 'شريك',
    }));
  }

  /** شراكات مانح من تنمية الموارد (لعرضها في ملف المانح) */
  async forDonor(org: string, donorId: string) {
    const rows = await this.db.query(
      `SELECT p.id, p.name, p.status, p.tier, (SELECT count(*)::int FROM pt_contracts c WHERE c.partner_id = p.id AND c.status = 'signed' AND c.ends_on >= $3) AS contracts
         FROM pt_partners p WHERE p.organization_id = $1 AND p.donor_id = $2`, [org, donorId, ptToday()]);
    return rows.map((r: { status: keyof typeof PARTNER_STATUS }) => ({ ...r, statusLabel: PARTNER_STATUS[r.status] }));
  }
}
