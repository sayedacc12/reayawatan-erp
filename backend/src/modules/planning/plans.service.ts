import { Logger, BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { DataSource, EntityManager, In } from 'typeorm';
import { OrgUser } from '../../core/auth/decorators';
import {
  ISSUE_DEF_KEYS, ITEM_DEF_KEYS, KPI_DEF_KEYS, Plan, PLAN_DEF_KEYS, PlanItem, PlanKpi, PlanKpiReading, PlanLink, PlanMaterialIssue, PlanProgressUpdate, PlanRef, PlanSnapshot,
  PlanStakeholder, PlanVersion, STAKEHOLDER_DEF_KEYS,
} from './entities/planning.entity';
import { planYear, PlanningAnalysis } from './planning-analysis.service';
import {
  assertEditable, canDecide, diffSnapshots, isPeriod, itemCode, markEdited, periodsOf, periodYear, pickRoute, r2, spreadTargets, sumCost, validateLevels, wfDecide, wfSubmit,
} from './planning-calc';
import { PlanningCore, today } from './planning-core.service';
import { PLAN_TEMPLATES, PlanningConfig, TemplateItem } from './planning-defaults';
import {
  CarryDto, CopyPlanDto, DecideDto, IssueDto, ItemDto, KpiDto, LinkDto, PlanDto, ProgressDto, ReadingDto, RefDto, StakeholderDto, TreatmentDto,
} from './planning.dto';
import { PLANNING_PERMISSIONS as P } from './planning.manifest';
import { PlanningLinks, RefOption } from './planning-links.service';

type Filters = { kind?: string; status?: string; year?: string; unitId?: string };
const pick = <T extends object, K extends keyof T>(o: T, keys: readonly K[]) => Object.fromEntries(keys.map((k) => [k, o[k]])) as Pick<T, K>;
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));

class ImportDryRun extends Error {
  constructor(readonly result: { id: string; code: string; items: { key: string; code: string; id: string }[] }) { super('dry-run'); }
}

/** بيانات خطة مستوردة بعد فحصها (انظر PlanImportService) */
export interface PlanImportData {
  header: PlanDto;
  items: { key: string; parentKey: string | null; dto: Partial<ItemDto> }[];
  kpis: { itemKey: string | null; dto: KpiDto }[];
  refs: { itemKey: string; system: RefDto['system']; src: RefOption; contribution: number | null; note: string | null }[];
  parentLinks: { itemKey: string; toItemId: string; contribution: number | null; note: string | null }[];
  issues?: IssueDto[];
  stakeholders?: StakeholderDto[];
}

/** القضايا الجوهرية وخارطة المعنيين: سجلان بسيطان داخل تعريف الخطة */
export type ContextKind = 'issue' | 'stakeholder';
const CONTEXT = {
  issue: { entity: PlanMaterialIssue, prefix: 'MI', keys: ISSUE_DEF_KEYS, missing: 'القضية الجوهرية غير موجودة' },
  stakeholder: { entity: PlanStakeholder, prefix: 'SH', keys: STAKEHOLDER_DEF_KEYS, missing: 'المعني غير موجود' },
} as const;
const MAX_CONTEXT_ROWS = 200;
type ContextRow = PlanMaterialIssue | PlanStakeholder;

/** الخطط وعناصرها ومؤشراتها وعلاقاتها، والاعتماد والإصدارات، ومتابعة الإنجاز والترحيل */
@Injectable()
export class PlansService {
  constructor(private readonly db: DataSource, private readonly core: PlanningCore, private readonly analysis: PlanningAnalysis, private readonly links: PlanningLinks) {}

  // ---------------- صلاحيات التعديل ----------------

  private manageCode(kind: Plan['kind']) {
    return kind === 'strategic' ? P.strategic : P.operational;
  }

  private assertManage(actor: OrgUser, plan: Plan) {
    if (!actor.isSuperadmin && !actor.permissions.includes(this.manageCode(plan.kind))) {
      throw new ForbiddenException(plan.kind === 'strategic' ? 'إعداد الخطط الاستراتيجية ليس من صلاحيتك' : 'إعداد الخطط التشغيلية ليس من صلاحيتك');
    }
  }

  private assertKpiManage(actor: OrgUser, plan: Plan) {
    if (!actor.isSuperadmin && !actor.permissions.includes(P.kpis) && !actor.permissions.includes(this.manageCode(plan.kind))) {
      throw new ForbiddenException('إدارة مؤشرات هذه الخطة ليست من صلاحيتك');
    }
  }

  private async plan(em: EntityManager, org: string, id: string, lock = false) {
    const p = await em.getRepository(Plan).findOne({ where: { id, organizationId: org }, ...(lock ? { lock: { mode: 'pessimistic_write' as const } } : {}) });
    if (!p) throw new NotFoundException('الخطة غير موجودة');
    return p;
  }

  private async item(em: EntityManager, org: string, id: string) {
    const i = await em.getRepository(PlanItem).findOne({ where: { id, organizationId: org } });
    if (!i) throw new NotFoundException('العنصر غير موجود');
    return i;
  }

  /** بدء تعديل: الخطة المعتمدة تصبح مسودة تعديل (إصدارها المعتمد محفوظ كما هو) */
  private async editing(em: EntityManager, actor: OrgUser, planId: string) {
    const p = await this.plan(em, actor.organizationId, planId, true);
    this.assertManage(actor, p);
    assertEditable(p);
    if (p.status === 'approved') {
      markEdited(p, actor.fullName);
      await em.getRepository(Plan).save(p);
    }
    return p;
  }

  /** حذف محتوى خطة في مسودة تعديل تمهيدًا لاستبداله من ملف. يرفض إن كان عليها عمل مسجل لا يصح فقده */
  /**
   * discardBefore: يحذف تحديثات الإنجاز وقراءات المؤشرات المسجلة على الخطة قبل هذا الوقت في المعاملة نفسها بدل رفض الاستبدال
   * (لإدراج حزمة الشركة فقط، بقرار المالك أنها تجريبية). ما سُجّل بعده والأنشطة المرحّلة تمنع الاستبدال دائمًا.
   * يعيد الصفوف المحذوفة بقيمها لتُحفظ في سجل الخطة.
   */
  private async clearContent(em: EntityManager, actor: OrgUser, p: Plan, discardBefore?: string) {
    const org = actor.organizationId;
    const ids = (await em.getRepository(PlanItem).find({ where: { organizationId: org, planId: p.id }, select: ['id'] })).map((i) => i.id);
    // ما يُسمح بحذفه: ما قبل وقت القرار فقط، وبلا قرار لا شيء
    const cut = discardBefore ?? '-infinity';
    const [{ progress, readings, carried }] = await em.query(
      `SELECT (SELECT COUNT(*) FROM plan_progress_updates WHERE organization_id = $1 AND item_id = ANY($2) AND created_at >= $4::timestamptz)::int AS progress,
              (SELECT COUNT(*) FROM plan_kpi_readings r JOIN plan_kpis k ON k.id = r.kpi_id WHERE k.organization_id = $1 AND k.plan_id = $3 AND r.created_at >= $4::timestamptz)::int AS readings,
              (SELECT COUNT(*) FROM plan_items WHERE organization_id = $1 AND (carried_from_id = ANY($2) OR (id = ANY($2) AND carried_from_id IS NOT NULL)))::int AS carried`,
      [org, ids, p.id, cut]);
    if (carried || progress || readings) throw new ConflictException('على الخطة إنجاز أو قراءات مؤشرات أو أنشطة مرحّلة، فلا يُستبدل محتواها. عدّلها من شاشتها');
    const gone = { progress: [] as Record<string, unknown>[], readings: [] as Record<string, unknown>[] };
    if (discardBefore) {
      const rows = (r: unknown) => (Array.isArray(r) && Array.isArray(r[0]) ? r[0] : r) as Record<string, unknown>[];
      gone.progress = rows(await em.query(
        `DELETE FROM plan_progress_updates WHERE organization_id = $1 AND item_id = ANY($2) AND created_at < $3::timestamptz
         RETURNING item_id, update_date::text AS date, progress, state, note, corrective_action, by_name, created_at`, [org, ids, discardBefore]));
      gone.readings = rows(await em.query(
        `DELETE FROM plan_kpi_readings WHERE organization_id = $1 AND created_at < $3::timestamptz AND kpi_id IN (SELECT id FROM plan_kpis WHERE organization_id = $1 AND plan_id = $2)
         RETURNING kpi_id, period, value, note, entered_by_name, created_at`, [org, p.id, discardBefore]));
    }
    if (ids.length) {
      // روابط من خطط أخرى: الخطط التشغيلية التابعة لهذه الخطة تفقد ربطها وتتحول لمسودة تعديل، وأي خطة أخرى تمنع الاستبدال
      const incoming: { id: string; plan_id: string }[] = await em.query(
        `SELECT l.id, f.plan_id FROM plan_links l JOIN plan_items f ON f.id = l.from_item_id
          WHERE l.organization_id = $1 AND l.to_item_id = ANY($2) AND NOT (l.from_item_id = ANY($2))`, [org, ids]);
      for (const planId of new Set(incoming.map((l) => l.plan_id))) {
        const child = await this.plan(em, org, planId, true);
        if (child.parentPlanId !== p.id) throw new ConflictException(`عناصر من الخطة ${child.code} مرتبطة بهذه الخطة وليست تابعة لها. احذف الربط أولًا`);
        assertEditable(child);
        markEdited(child, actor.fullName);
        child.revisionNote = child.revisionNote ?? `أُزيلت روابطها بعناصر الخطة الأم ${p.code} عند استبدال محتواها، ويلزم ربطها من جديد`;
        await em.getRepository(Plan).save(child);
      }
      await em.query(`DELETE FROM plan_links WHERE organization_id = $1 AND (from_item_id = ANY($2) OR to_item_id = ANY($2))`, [org, ids]);
      await em.query(`DELETE FROM plan_refs WHERE organization_id = $1 AND item_id = ANY($2)`, [org, ids]);
    }
    await em.query(`DELETE FROM plan_kpis WHERE organization_id = $1 AND plan_id = $2`, [org, p.id]);
    await em.query(`DELETE FROM plan_items WHERE organization_id = $1 AND plan_id = $2`, [org, p.id]);
    return gone;
  }

  // ---------------- الخطط ----------------

  async list(actor: OrgUser, f: Filters) {
    const a = await this.analysis.analyze(actor.organizationId);
    const d = await this.core.decider(actor);
    const year = f.year && /^\d{4}$/.test(f.year) ? Number(f.year) : null;
    const plans = [...a.plans.values()]
      .filter((p) => (!f.kind || p.kind === f.kind) && (!f.status || p.status === f.status) && (!f.unitId || p.unitId === f.unitId || p.sharedUnits.some((u) => u.id === f.unitId))
        && (!year || (p.startYear <= year && p.endYear >= year)))
      .sort((x, y) => y.startYear - x.startYear || x.code.localeCompare(y.code));
    return plans.map((p) => ({
      ...this.header(p), summary: this.analysis.summary(a, p),
      parent: p.parentPlanId ? (({ id, code, title }) => ({ id, code, title }))(a.plans.get(p.parentPlanId) ?? ({} as Plan)) : null,
      stageName: p.status === 'in_review' && p.stageIndex !== null ? p.wfStages[p.stageIndex]?.name ?? null : null,
      canDecide: canDecide(p, d),
    }));
  }

  private header(p: Plan) {
    return {
      id: p.id, code: p.code, kind: p.kind, title: p.title, description: p.description, startYear: p.startYear, endYear: p.endYear, periodicity: p.periodicity,
      vision: p.vision, mission: p.mission, values: p.values, unitId: p.unitId, unitName: p.unitName, sharedUnits: p.sharedUnits, parentPlanId: p.parentPlanId,
      levels: p.levels, templateKey: p.templateKey, ownerName: p.ownerName, status: p.status, stageIndex: p.stageIndex, wfStages: p.wfStages, routeName: p.routeName,
      approvals: p.approvals, version: p.version, revisionNote: p.revisionNote, approvedAt: p.approvedAt, createdByName: p.createdByName, createdAt: p.createdAt, updatedAt: p.updatedAt,
    };
  }

  async get(actor: OrgUser, id: string) {
    const org = actor.organizationId;
    const a = await this.analysis.analyze(org);
    const p = a.plans.get(id);
    if (!p) throw new NotFoundException('الخطة غير موجودة');
    const d = await this.core.decider(actor);
    const items = a.items.filter((i) => i.planId === id);
    const ids = new Set(items.map((i) => i.id));
    const refs = ids.size ? await this.db.getRepository(PlanRef).find({ where: { organizationId: org, itemId: In([...ids]) }, order: { createdAt: 'ASC' } }) : [];
    const live = await this.links.live(actor, refs);
    const ext = (itemId: string) => {
      const it = a.itemById.get(itemId);
      const pl = it ? a.plans.get(it.planId) : null;
      const r = it ? a.rolled.get(it.id) : null;
      return it && pl ? {
        id: it.id, code: it.code, title: it.title, planId: pl.id, planCode: pl.code, planTitle: pl.title, planKind: pl.kind, unitName: it.unitName ?? pl.unitName,
        ownerName: it.ownerName, progress: r?.progress ?? 0, status: r?.status ?? null, cost: r?.cost ?? 0, levelName: pl.levels[it.level]?.name ?? '',
      } : null;
    };
    const links = a.links.filter((l) => ids.has(l.fromItemId) || ids.has(l.toItemId)).map((l) => ({
      id: l.id, fromItemId: l.fromItemId, toItemId: l.toItemId, relation: l.relation, contribution: l.contribution, note: l.note,
      from: ext(l.fromItemId), to: ext(l.toItemId), owned: ids.has(l.fromItemId),
    }));
    const versions = await this.db.getRepository(PlanVersion).find({ where: { organizationId: org, planId: id }, order: { version: 'DESC' }, select: ['id', 'version', 'note', 'approvedByName', 'approvedAt'] });
    const children = [...a.plans.values()].filter((x) => x.parentPlanId === id).map((x) => ({ id: x.id, code: x.code, title: x.title, unitName: x.unitName, status: x.status, startYear: x.startYear, endYear: x.endYear, ...this.analysis.summary(a, x) }));
    const parent = p.parentPlanId ? a.plans.get(p.parentPlanId) : null;
    const updates = ids.size ? await this.db.getRepository(PlanProgressUpdate).find({ where: { organizationId: org, itemId: In([...ids]) }, order: { createdAt: 'DESC' } }) : [];
    // القضايا والمعنيون للخطة الاستراتيجية، والخطة التشغيلية تعرض ما في خطتها الأم للقراءة فقط
    const ctxPlan = p.kind === 'strategic' ? p : parent ?? null;
    const issues = ctxPlan ? await this.db.getRepository(PlanMaterialIssue).find({ where: { organizationId: org, planId: ctxPlan.id }, order: { sortOrder: 'ASC', code: 'ASC' } }) : [];
    const stakeholders = ctxPlan ? await this.db.getRepository(PlanStakeholder).find({ where: { organizationId: org, planId: ctxPlan.id }, order: { sortOrder: 'ASC', code: 'ASC' } }) : [];
    return {
      ...this.header(p), summary: this.analysis.summary(a, p),
      stageName: p.status === 'in_review' && p.stageIndex !== null ? p.wfStages[p.stageIndex]?.name ?? null : null,
      stages: p.status === 'in_review' ? p.wfStages.map((s) => s.name) : await this.previewStages(org, p, a.cfg),
      canDecide: canDecide(p, d),
      parent: parent ? { id: parent.id, code: parent.code, title: parent.title } : null,
      children,
      items: items.map((i) => {
        const r = a.rolled.get(i.id)!;
        return {
          ...i, rolledProgress: r.progress, plannedProgress: r.planned, rolledCost: r.cost, rolledCostByYear: r.costByYear, execStatus: r.status, progressSource: r.source,
          performance: a.perf.get(i.id) ?? null, refs: refs.filter((x) => x.itemId === i.id).map((x) => ({ ...x, live: live.get(x.id) ?? null })), updates: updates.filter((u) => u.itemId === i.id).slice(0, 10),
          hasChildren: items.some((c) => c.parentId === i.id),
        };
      }),
      kpis: a.kpis.filter((k) => k.planId === id).map((k) => ({ ...k, stat: a.kpiStat.get(k.id) })),
      links,
      issues,
      stakeholders,
      contextFrom: p.kind === 'strategic' ? null : ctxPlan ? { id: ctxPlan.id, code: ctxPlan.code, title: ctxPlan.title } : null,
      versions,
      periods: Array.from({ length: p.endYear - p.startYear + 1 }, (_, i) => p.startYear + i),
    };
  }

  /** مراحل المسار الذي سينطبق على الخطة عند رفعها (للعرض قبل الرفع) */
  private async previewStages(org: string, p: Plan, cfg?: PlanningConfig) {
    const c = cfg ?? (await this.core.config(org));
    const [{ total }] = await this.db.query(`SELECT COALESCE(SUM(planned_cost) FILTER (WHERE state <> 'cancelled'), 0)::float AS total FROM plan_items WHERE plan_id = $1`, [p.id]);
    return pickRoute(c.routes, p.kind, p.unitId, total)?.stages.map((s) => s.name) ?? [];
  }

  private async applyHeader(em: EntityManager, org: string, p: Plan, dto: Partial<PlanDto>, cfg: PlanningConfig) {
    if (dto.title !== undefined) p.title = dto.title;
    if (dto.description !== undefined) p.description = dto.description ?? null;
    if (dto.startYear !== undefined) p.startYear = dto.startYear;
    if (dto.endYear !== undefined) p.endYear = dto.endYear;
    if (p.endYear < p.startYear) throw new BadRequestException('سنة النهاية قبل سنة البداية');
    if (p.endYear - p.startYear > 9) throw new BadRequestException('مدة الخطة 10 سنوات كحد أعلى');
    if (dto.periodicity !== undefined) p.periodicity = dto.periodicity;
    if (dto.vision !== undefined) p.vision = dto.vision ?? null;
    if (dto.mission !== undefined) p.mission = dto.mission ?? null;
    if (dto.values !== undefined) p.values = (dto.values ?? []).map((v) => v.trim()).filter(Boolean);
    if (dto.ownerName !== undefined) p.ownerName = dto.ownerName ?? null;
    if (dto.unitId !== undefined || dto.sharedUnitIds !== undefined) {
      const unitId = dto.unitId !== undefined ? dto.unitId ?? null : p.unitId;
      const shared = dto.sharedUnitIds !== undefined ? dto.sharedUnitIds ?? [] : p.sharedUnits.map((u) => u.id);
      const names = await this.core.unitNames(org, [...(unitId ? [unitId] : []), ...shared], em);
      p.unitId = unitId;
      p.unitName = unitId ? names.get(unitId)! : null;
      p.sharedUnits = shared.filter((u) => u !== unitId).map((u) => ({ id: u, name: names.get(u)! }));
    }
    if (dto.parentPlanId !== undefined) {
      if (dto.parentPlanId) {
        if (p.kind !== 'operational') throw new BadRequestException('الخطة الاستراتيجية لا تتبع خطة أخرى');
        const parent = await this.plan(em, org, dto.parentPlanId);
        if (parent.kind !== 'strategic') throw new BadRequestException('الخطة التشغيلية تتبع خطة استراتيجية فقط');
        if (p.startYear < parent.startYear || p.endYear > parent.endYear) throw new BadRequestException(`مدة الخطة خارج مدة الخطة الاستراتيجية (${parent.startYear} - ${parent.endYear})`);
      }
      p.parentPlanId = dto.parentPlanId ?? null;
    }
    if (dto.levels !== undefined && dto.levels) {
      validateLevels(dto.levels);
      if (p.id) {
        const [{ max }] = await em.query('SELECT COALESCE(MAX(level), -1)::int AS max FROM plan_items WHERE plan_id = $1', [p.id]);
        if (dto.levels.length <= max) throw new BadRequestException('لا يمكن حذف مستوى فيه عناصر. احذف عناصره أولًا');
      }
      p.levels = dto.levels.map((l) => ({ key: l.key, name: l.name.trim(), prefix: l.prefix }));
    }
    if (!p.levels?.length) p.levels = (p.kind === 'strategic' ? cfg.strategicLevels : cfg.operationalLevels).map((l) => ({ ...l }));
  }

  async create(actor: OrgUser, dto: PlanDto) {
    const org = actor.organizationId;
    if (!actor.isSuperadmin && !actor.permissions.includes(this.manageCode(dto.kind))) throw new ForbiddenException('إعداد هذا النوع من الخطط ليس من صلاحيتك');
    const tpl = dto.templateKey ? PLAN_TEMPLATES.find((t) => t.key === dto.templateKey) : null;
    if (dto.templateKey && !tpl) throw new BadRequestException('القالب غير موجود');
    if (tpl && tpl.kind !== dto.kind) throw new BadRequestException('القالب لا يناسب نوع الخطة');
    const cfg = await this.core.config(org);
    const id = await this.db.transaction(async (em) => {
      const p = em.getRepository(Plan).create({
        organizationId: org, kind: dto.kind, code: await this.core.nextCode(em, org, dto.kind === 'strategic' ? 'SP' : 'OP'), status: 'draft', approvals: [], wfStages: [],
        levels: tpl && !dto.levels ? tpl.levels.map((l) => ({ ...l })) : [], values: [], sharedUnits: [], templateKey: tpl?.key ?? null, createdByName: actor.fullName,
      });
      await this.applyHeader(em, org, p, {
        ...dto, vision: dto.vision ?? tpl?.vision ?? null, mission: dto.mission ?? tpl?.mission ?? null, values: dto.values?.length ? dto.values : tpl?.values ?? [],
      }, cfg);
      const saved = await em.getRepository(Plan).save(p);
      if (tpl) await this.installTemplate(em, saved, tpl.items);
      return saved.id;
    });
    return this.get(actor, id);
  }

  /** نسخ هيكل القالب ومؤشراته (المستهدفات موزعة خطيًا على سنوات الخطة) */
  private async installTemplate(em: EntityManager, p: Plan, items: TemplateItem[]) {
    const years = Array.from({ length: p.endYear - p.startYear + 1 }, (_, i) => p.startYear + i);
    let order = 0;
    const add = async (t: TemplateItem, parent: PlanItem | null, level: number, siblings: string[]) => {
      if (level >= p.levels.length) return;
      const code = itemCode(p.levels[level].prefix, parent?.code ?? null, siblings);
      siblings.push(code);
      const it = await em.getRepository(PlanItem).save(em.getRepository(PlanItem).create({
        organizationId: p.organizationId, planId: p.id, parentId: parent?.id ?? null, level, code, title: t.title, description: t.description ?? null,
        participants: [], targets: [], milestones: [], resources: [], costByYear: {}, plannedCost: 0, customValues: {}, sortOrder: order++,
      }));
      for (const k of t.kpis ?? []) {
        await em.getRepository(PlanKpi).save(em.getRepository(PlanKpi).create({
          organizationId: p.organizationId, planId: p.id, itemId: it.id, code: await this.core.nextCode(em, p.organizationId, 'KPI'), name: k.name, unit: k.unit,
          direction: k.direction ?? 'up', frequency: 'annual', aggregation: k.aggregation ?? 'last', baseline: k.baseline ?? null,
          targets: spreadTargets(years, k.target, k.baseline), weight: 1, dataSource: k.dataSource ?? null, sortOrder: order++,
        }));
      }
      const kids: string[] = [];
      for (const c of t.children ?? []) await add(c, it, level + 1, kids);
    };
    const roots: string[] = [];
    for (const t of items) await add(t, null, 0, roots);
  }

  /**
   * خطة كاملة من ملف Excel في معاملة واحدة: الرأس والعناصر والمؤشرات والروابط، بنفس قواعد الإدخال اليدوي.
   * المراجع (المخاطر وعوامل التحليل) محلولة مسبقًا من النظام المرتبط، وعناصر الخطة الأم محمّلة بمعرف الشركة.
   */
  /**
   * استيراد خطة من ملف. مع replaceId يستبدل محتوى خطة قائمة (الرأس والعناصر والمؤشرات والروابط) بمحتوى الملف كمسودة تعديل،
   * ويبقى إصدارها المعتمد السابق محفوظًا للمقارنة، ثم تُرفع للاعتماد فتصبح إصدارًا جديدًا. لا يُستبدل محتوى خطة عليها إنجاز
   * أو قراءات مؤشرات أو أنشطة مرحّلة. روابط الخطط التشغيلية التابعة لها تُزال وتتحول تلك الخطط لمسودة تعديل حتى يُعاد ربطها.
   * يستخدمه إدراج حزمة الشركة فقط، ولا يُعرض في واجهة الاستيراد.
   */
  async importPlan(actor: OrgUser, data: PlanImportData, dryRun = false, replaceId?: string, revisionNote?: string, discardBefore?: string) {
    let discarded = '';
    const org = actor.organizationId;
    if (!actor.isSuperadmin && !actor.permissions.includes(this.manageCode(data.header.kind))) throw new ForbiddenException('إعداد هذا النوع من الخطط ليس من صلاحيتك');
    const cfg = await this.core.config(org);
    const relation = cfg.relationTypes[0]?.code;
    const run = this.db.transaction(async (em) => {
      const same = await em.getRepository(Plan).findOne({ where: { organizationId: org, kind: data.header.kind, title: data.header.title }, select: ['id'] });
      if (same && same.id !== replaceId) {
        throw new ConflictException('توجد خطة بالنوع والعنوان نفسيهما. غيّر العنوان في الملف أو احذف الخطة السابقة');
      }
      let saved: Plan;
      if (replaceId) {
        const p = await this.editing(em, actor, replaceId);
        if (p.kind !== data.header.kind) throw new BadRequestException('نوع الخطة في الملف يختلف عن الخطة المراد تعديلها');
        const gone = await this.clearContent(em, actor, p, discardBefore);
        if (gone.progress.length || gone.readings.length) {
          // تُحفظ القيم المحذوفة كاملة في سجل الخطة (قبل/بعد)
          discarded = `Plan ${p.code} content replaced: discarded ${gone.progress.length} progress updates and ${gone.readings.length} KPI readings entered before ${discardBefore} (owner-approved test entries)`;
          p.approvals = [...p.approvals, { action: 'reopen', stage: null, byName: actor.fullName, at: new Date().toISOString(),
            note: `حذف بيانات تجريبية بقرار المالك عند استبدال المحتوى: ${gone.progress.length} تحديث إنجاز و${gone.readings.length} قراءة مؤشرات. القيم المحذوفة: ${JSON.stringify(gone)}` }];
        }
        await this.applyHeader(em, org, p, data.header, cfg);
        if (revisionNote) p.revisionNote = revisionNote;
        saved = await em.getRepository(Plan).save(p);
      } else {
        const p = em.getRepository(Plan).create({
          organizationId: org, kind: data.header.kind, code: await this.core.nextCode(em, org, data.header.kind === 'strategic' ? 'SP' : 'OP'), status: 'draft', approvals: [], wfStages: [],
          levels: [], values: [], sharedUnits: [], templateKey: null, createdByName: actor.fullName,
        });
        await this.applyHeader(em, org, p, data.header, cfg);
        saved = await em.getRepository(Plan).save(p);
      }
      const byKey = new Map<string, PlanItem>();
      const siblings = new Map<string, string[]>();
      let order = 0;
      for (const row of data.items) {
        const parent = row.parentKey ? byKey.get(row.parentKey)! : null;
        const level = parent ? parent.level + 1 : 0;
        if (level >= saved.levels.length) throw new BadRequestException(`العنصر ${row.key}: «${saved.levels[level - 1]?.name}» هو أدنى مستوى في هذه الخطة`);
        const sib = siblings.get(parent?.id ?? '') ?? [];
        const it = em.getRepository(PlanItem).create({
          organizationId: org, planId: saved.id, parentId: parent?.id ?? null, level, code: itemCode(saved.levels[level].prefix, parent?.code ?? null, sib),
          participants: [], targets: [], milestones: [], resources: [], costByYear: {}, plannedCost: 0, customValues: {}, weight: 1, sortOrder: order++,
        });
        sib.push(it.code);
        siblings.set(parent?.id ?? '', sib);
        try {
          await this.applyItem(em, org, saved, it, row.dto, cfg);
        } catch (e) {
          if (e instanceof BadRequestException) throw new BadRequestException(`العنصر ${row.key}: ${(e.getResponse() as { message?: string }).message ?? e.message}`);
          throw e;
        }
        byKey.set(row.key, await em.getRepository(PlanItem).save(it));
      }
      for (const k of data.kpis) {
        let targets: Record<string, number>;
        try {
          targets = this.validTargets(saved, k.dto.frequency, k.dto.targets);
        } catch (e) {
          if (e instanceof BadRequestException) throw new BadRequestException(`المؤشر «${k.dto.name}»: ${(e.getResponse() as { message?: string }).message ?? e.message}`);
          throw e;
        }
        await em.getRepository(PlanKpi).save(em.getRepository(PlanKpi).create({
          organizationId: org, planId: saved.id, itemId: k.itemKey ? byKey.get(k.itemKey)!.id : null, code: await this.core.nextCode(em, org, 'KPI'), name: k.dto.name,
          description: k.dto.description ?? null, unit: k.dto.unit, direction: k.dto.direction, frequency: k.dto.frequency, aggregation: k.dto.aggregation, baseline: k.dto.baseline ?? null,
          targets, weight: k.dto.weight ?? 1, ownerName: k.dto.ownerName ?? null, dataSource: k.dto.dataSource ?? null, sortOrder: order++,
        }));
      }
      for (const r of data.refs) {
        const itemId = byKey.get(r.itemKey)!.id;
        if (await em.getRepository(PlanRef).count({ where: { organizationId: org, itemId, system: r.system, refId: r.src.id } })) continue;
        await em.getRepository(PlanRef).save(this.refRow(actor, itemId, r.system, r.src, r.contribution, r.note));
      }
      for (const l of data.parentLinks) {
        if (!relation) throw new BadRequestException('لا توجد أنواع علاقات معرفة في إعدادات التخطيط');
        const to = await this.item(em, org, l.toItemId);
        if (to.planId !== saved.parentPlanId) throw new BadRequestException('عنصر الربط ليس من الخطة الأم');
        await this.assertContribution(em, to.id, l.contribution, null);
        await em.getRepository(PlanLink).save(em.getRepository(PlanLink).create({
          organizationId: org, fromItemId: byKey.get(l.itemKey)!.id, toItemId: to.id, relation, contribution: l.contribution, note: l.note,
        }));
      }
      for (const [kind, rows] of [['issue', data.issues ?? []], ['stakeholder', data.stakeholders ?? []]] as const) {
        if (rows.length > MAX_CONTEXT_ROWS) throw new BadRequestException(`الحد الأعلى ${MAX_CONTEXT_ROWS} صف`);
        // استبدال المحتوى بملف فيه الورقة: تحل صفوفها محل الموجود، وبلا الورقة يبقى الموجود كما هو
        if (replaceId && rows.length) await em.getRepository<ContextRow>(CONTEXT[kind].entity).delete({ organizationId: org, planId: saved.id });
        for (const [i, dto] of rows.entries()) await this.insertContext(em, saved, kind, dto, i + 1);
      }
      const result = { id: saved.id, code: saved.code, items: [...byKey.entries()].map(([key, it]) => ({ key, code: it.code, id: it.id })) };
      // الفحص يجري الحفظ كاملًا ثم يتراجع عنه، فيطابق الفحص الحفظ الفعلي تمامًا
      if (dryRun) throw new ImportDryRun(result);
      return result;
    });
    try {
      const res = await run;
      if (discarded) new Logger('Plans').warn(discarded);
      return res;
    } catch (e) {
      if (e instanceof ImportDryRun) return { ...e.result, id: null as string | null, code: null as string | null, items: e.result.items.map((i) => ({ ...i, id: null as string | null })) };
      throw e;
    }
  }

  async update(actor: OrgUser, id: string, dto: Partial<PlanDto>) {
    const org = actor.organizationId;
    const cfg = await this.core.config(org);
    await this.db.transaction(async (em) => {
      const p = await this.editing(em, actor, id);
      if (dto.kind && dto.kind !== p.kind) throw new BadRequestException('لا يمكن تغيير نوع الخطة بعد إنشائها');
      const { kind: _k, templateKey: _t, ...rest } = dto;
      await this.applyHeader(em, org, p, rest, cfg);
      const [{ min, max }] = await em.query(`SELECT MIN(start_date)::text AS min, MAX(start_date)::text AS max FROM plan_items WHERE plan_id = $1`, [id]);
      if (min && (Number(min.slice(0, 4)) < p.startYear || Number(max.slice(0, 4)) > p.endYear)) throw new BadRequestException('بعض العناصر تبدأ خارج مدة الخطة الجديدة. عدّل تواريخها أولًا');
      await em.getRepository(Plan).save(p);
    });
    return this.get(actor, id);
  }

  async remove(actor: OrgUser, id: string) {
    await this.db.transaction(async (em) => {
      const p = await this.plan(em, actor.organizationId, id, true);
      this.assertManage(actor, p);
      if (p.version > 0) throw new ConflictException('الخطة سبق اعتمادها ولها إصدارات محفوظة فلا تُحذف');
      if (p.status === 'in_review') throw new ConflictException('الخطة قيد الاعتماد');
      const kids = await em.count(Plan, { where: { organizationId: actor.organizationId, parentPlanId: id } });
      if (kids) throw new ConflictException('توجد خطط تشغيلية تتبع هذه الخطة');
      const items = await em.getRepository(PlanItem).find({ where: { planId: id }, select: ['id'] });
      const ids = items.map((i) => i.id);
      if (ids.length) {
        const [{ n }] = await em.query(`SELECT COUNT(*)::int AS n FROM plan_links WHERE to_item_id = ANY($1) AND NOT (from_item_id = ANY($1))`, [ids]);
        if (n) throw new ConflictException('عناصر من خطط أخرى مرتبطة بعناصر هذه الخطة. احذف الربط أولًا');
        await em.query(`DELETE FROM plan_links WHERE from_item_id = ANY($1) OR to_item_id = ANY($1)`, [ids]);
        await em.query(`DELETE FROM plan_refs WHERE item_id = ANY($1)`, [ids]);
        await em.query(`DELETE FROM plan_progress_updates WHERE item_id = ANY($1)`, [ids]);
      }
      await em.query(`DELETE FROM plan_kpi_readings WHERE kpi_id IN (SELECT id FROM plan_kpis WHERE plan_id = $1)`, [id]);
      await em.query(`DELETE FROM plan_kpis WHERE plan_id = $1`, [id]);
      await em.query(`DELETE FROM plan_items WHERE plan_id = $1`, [id]);
      await em.query(`DELETE FROM plan_material_issues WHERE organization_id = $1 AND plan_id = $2`, [actor.organizationId, id]);
      await em.query(`DELETE FROM plan_stakeholders WHERE organization_id = $1 AND plan_id = $2`, [actor.organizationId, id]);
      await em.query(`DELETE FROM plan_plans WHERE id = $1`, [id]);
    });
    return { ok: true };
  }

  /** نسخ خطة لفترة جديدة: الهيكل والمؤشرات (بإزاحة سنوات المستهدفات) والعلاقات، بلا إنجاز ولا قراءات */
  async copy(actor: OrgUser, id: string, dto: CopyPlanDto) {
    const org = actor.organizationId;
    const newId = await this.db.transaction(async (em) => {
      const src = await this.plan(em, org, id);
      this.assertManage(actor, src);
      if (dto.endYear < dto.startYear) throw new BadRequestException('سنة النهاية قبل سنة البداية');
      const shift = dto.startYear - src.startYear;
      const p = await em.getRepository(Plan).save(em.getRepository(Plan).create({
        ...pick(src, PLAN_DEF_KEYS), organizationId: org, kind: src.kind, code: await this.core.nextCode(em, org, src.kind === 'strategic' ? 'SP' : 'OP'),
        title: dto.title, startYear: dto.startYear, endYear: dto.endYear, status: 'draft', approvals: [], wfStages: [], version: 0, templateKey: src.templateKey, createdByName: actor.fullName,
        parentPlanId: src.parentPlanId,
      }));
      const shiftDate = (d: string | null) => {
        if (!d) return null;
        const y = Number(d.slice(0, 4)) + shift;
        const md = d.slice(5) === '02-29' ? '02-28' : d.slice(5);
        return `${y}-${md}`;
      };
      const shiftKeys = (o: Record<string, number>) => Object.fromEntries(Object.entries(o).map(([k, v]) => [String(Number(k.slice(0, 4)) + shift) + k.slice(4), v])
        .filter(([k]) => periodYear(k as string) >= dto.startYear && periodYear(k as string) <= dto.endYear));
      const items = await em.getRepository(PlanItem).find({ where: { planId: id }, order: { level: 'ASC', sortOrder: 'ASC' } });
      const map = new Map<string, string>();
      for (const i of items) {
        if (i.state === 'cancelled') continue;
        if (i.parentId && !map.has(i.parentId)) continue;
        const n = await em.getRepository(PlanItem).save(em.getRepository(PlanItem).create({
          ...pick(i, ITEM_DEF_KEYS), id: undefined, organizationId: org, planId: p.id, parentId: i.parentId ? map.get(i.parentId)! : null,
          startDate: shiftDate(i.startDate), endDate: shiftDate(i.endDate), costByYear: shiftKeys(i.costByYear),
          milestones: i.milestones.map((m) => ({ ...m, dueDate: shiftDate(m.dueDate), done: false, doneDate: null })),
          progress: 0, state: 'not_started', progressNote: null, correctiveAction: null,
        }));
        n.plannedCost = sumCost(n.costByYear);
        await em.getRepository(PlanItem).save(n);
        map.set(i.id, n.id);
      }
      for (const k of await em.getRepository(PlanKpi).find({ where: { planId: id } })) {
        if (k.itemId && !map.has(k.itemId)) continue;
        await em.getRepository(PlanKpi).save(em.getRepository(PlanKpi).create({
          ...pick(k, KPI_DEF_KEYS), id: undefined, organizationId: org, planId: p.id, itemId: k.itemId ? map.get(k.itemId)! : null,
          code: await this.core.nextCode(em, org, 'KPI'), targets: shiftKeys(k.targets),
        }));
      }
      const links = map.size ? await em.getRepository(PlanLink).find({ where: { fromItemId: In([...map.keys()]) } }) : [];
      for (const l of links) {
        await em.getRepository(PlanLink).save(em.getRepository(PlanLink).create({
          organizationId: org, fromItemId: map.get(l.fromItemId)!, toItemId: map.get(l.toItemId) ?? l.toItemId, relation: l.relation, contribution: l.contribution, note: l.note,
        }));
      }
      for (const kind of ['issue', 'stakeholder'] as const) {
        const repo = em.getRepository<ContextRow>(CONTEXT[kind].entity);
        for (const r of await repo.find({ where: { organizationId: org, planId: id }, order: { sortOrder: 'ASC' } })) {
          await repo.save(repo.create({ ...pick(r, CONTEXT[kind].keys as readonly (keyof ContextRow)[]), id: undefined, organizationId: org, planId: p.id } as never));
        }
      }
      return p.id;
    });
    return this.get(actor, newId);
  }

  // ---------------- عناصر الخطة ----------------

  private async applyItem(em: EntityManager, org: string, p: Plan, it: PlanItem, dto: Partial<ItemDto>, cfg: PlanningConfig) {
    if (dto.title !== undefined) it.title = dto.title;
    if (dto.description !== undefined) it.description = dto.description ?? null;
    if (dto.ownerUserId !== undefined) {
      it.ownerUserId = dto.ownerUserId ?? null;
      if (it.ownerUserId) it.ownerName = await this.core.userName(org, it.ownerUserId, em);
    }
    if (dto.ownerName !== undefined && !it.ownerUserId) it.ownerName = dto.ownerName ?? null;
    if (dto.unitId !== undefined || dto.participantUnitIds !== undefined) {
      const unitId = dto.unitId !== undefined ? dto.unitId ?? null : it.unitId;
      const parts = dto.participantUnitIds !== undefined ? dto.participantUnitIds ?? [] : it.participants.map((x) => x.id);
      const names = await this.core.unitNames(org, [...(unitId ? [unitId] : []), ...parts], em);
      it.unitId = unitId;
      it.unitName = unitId ? names.get(unitId)! : null;
      it.participants = parts.filter((x) => x !== unitId).map((x) => ({ id: x, name: names.get(x)! }));
    }
    if (dto.startDate !== undefined) it.startDate = dto.startDate ?? null;
    if (dto.endDate !== undefined) it.endDate = dto.endDate ?? null;
    if (it.startDate && it.endDate && it.endDate < it.startDate) throw new BadRequestException('تاريخ النهاية قبل تاريخ البداية');
    if (it.startDate && (Number(it.startDate.slice(0, 4)) < p.startYear || Number(it.startDate.slice(0, 4)) > p.endYear)) {
      throw new BadRequestException(`تاريخ البداية خارج مدة الخطة (${p.startYear} - ${p.endYear})`);
    }
    if (dto.weight !== undefined) it.weight = dto.weight;
    if (dto.targets !== undefined) it.targets = (dto.targets ?? []).map((t) => ({ kind: t.kind, text: t.text, value: t.value ?? null, unit: t.unit ?? null, dueDate: t.dueDate ?? null }));
    if (dto.milestones !== undefined) {
      it.milestones = (dto.milestones ?? []).map((m) => ({ title: m.title, dueDate: m.dueDate ?? null, done: !!m.done, doneDate: m.done ? m.doneDate ?? today() : null }));
    }
    if (dto.resources !== undefined) it.resources = (dto.resources ?? []).map((r) => ({ kind: r.kind, name: r.name, quantity: r.quantity ?? null, unit: r.unit ?? null, cost: r.cost ?? null }));
    if (dto.costByYear !== undefined) {
      const out: Record<string, number> = {};
      const lastYear = Math.max(p.endYear, it.endDate ? Number(it.endDate.slice(0, 4)) : p.endYear);
      for (const [y, v] of Object.entries(dto.costByYear ?? {})) {
        if (v === null || (v as unknown) === '' || v === undefined) continue;
        const n = Number(v);
        if (!/^\d{4}$/.test(y) || Number(y) < p.startYear || Number(y) > lastYear) throw new BadRequestException(`السنة ${y} خارج مدة الخطة أو مدة العنصر`);
        if (!Number.isFinite(n) || n < 0) throw new BadRequestException('التكلفة التقديرية رقم موجب');
        if (n > 0) out[y] = r2(n);
      }
      it.costByYear = out;
      it.plannedCost = sumCost(out);
    }
    if (dto.fundingType !== undefined) it.fundingType = dto.fundingType ?? null;
    if (dto.costCenterId !== undefined) {
      it.costCenterId = dto.costCenterId ?? null;
      it.costCenterName = await this.core.costCenterName(org, it.costCenterId, em);
    }
    if (dto.customValues !== undefined) {
      const fields = cfg.customFields.filter((f) => f.appliesTo === 'all' || f.appliesTo === p.kind);
      const out: Record<string, string | number | null> = {};
      for (const f of fields) {
        const v = dto.customValues?.[f.key];
        if (v === undefined || v === null || v === '') continue;
        if (f.type === 'number' && !Number.isFinite(Number(v))) throw new BadRequestException(`«${f.label}» رقم`);
        if (f.type === 'date' && !/^\d{4}-\d{2}-\d{2}$/.test(String(v))) throw new BadRequestException(`«${f.label}» تاريخ غير صحيح`);
        if (f.type === 'select' && !f.options.includes(String(v))) throw new BadRequestException(`اختر «${f.label}» من القائمة`);
        out[f.key] = f.type === 'number' ? Number(v) : String(v).slice(0, 500);
      }
      it.customValues = out;
    }
  }

  async addItem(actor: OrgUser, planId: string, dto: ItemDto, after?: (em: EntityManager, it: PlanItem) => Promise<void>) {
    const org = actor.organizationId;
    const cfg = await this.core.config(org);
    await this.db.transaction(async (em) => {
      const p = await this.editing(em, actor, planId);
      const parent = dto.parentId ? await this.item(em, org, dto.parentId) : null;
      if (parent && parent.planId !== p.id) throw new BadRequestException('العنصر الأب من خطة أخرى');
      const level = parent ? parent.level + 1 : 0;
      if (level >= p.levels.length) throw new BadRequestException(`«${p.levels[level - 1]?.name}» هو أدنى مستوى في هذه الخطة`);
      const siblings = await em.getRepository(PlanItem).find({ where: { planId: p.id, parentId: parent ? parent.id : (null as unknown as string) }, select: ['code', 'sortOrder'] });
      const it = em.getRepository(PlanItem).create({
        organizationId: org, planId: p.id, parentId: parent?.id ?? null, level, code: itemCode(p.levels[level].prefix, parent?.code ?? null, siblings.map((s) => s.code)),
        participants: [], targets: [], milestones: [], resources: [], costByYear: {}, plannedCost: 0, customValues: {}, weight: 1,
        sortOrder: Math.max(-1, ...siblings.map((s) => s.sortOrder)) + 1,
      });
      if (!dto.unitId && p.unitId && dto.unitId === undefined) dto.unitId = p.unitId;
      await this.applyItem(em, org, p, it, dto, cfg);
      await em.getRepository(PlanItem).save(it);
      if (after) await after(em, it);
    });
    return this.get(actor, planId);
  }

  async updateItem(actor: OrgUser, id: string, dto: Partial<ItemDto>) {
    const org = actor.organizationId;
    const cfg = await this.core.config(org);
    const planId = await this.db.transaction(async (em) => {
      const it = await this.item(em, org, id);
      const p = await this.editing(em, actor, it.planId);
      const { parentId: _p, ...rest } = dto;
      await this.applyItem(em, org, p, it, rest, cfg);
      await em.getRepository(PlanItem).save(it);
      return p.id;
    });
    return this.get(actor, planId);
  }

  /** حذف عنصر وفروعه، ما لم يكن لأي منها سجل إنجاز أو قراءات مؤشرات أو ترحيل (فتُلغى بدل الحذف) */
  async removeItem(actor: OrgUser, id: string) {
    const org = actor.organizationId;
    const planId = await this.db.transaction(async (em) => {
      const it = await this.item(em, org, id);
      const p = await this.editing(em, actor, it.planId);
      const rows: { id: string }[] = await em.query(
        `WITH RECURSIVE t AS (SELECT id FROM plan_items WHERE id = $1 UNION ALL SELECT c.id FROM plan_items c JOIN t ON c.parent_id = t.id) SELECT id FROM t`, [id]);
      const ids = rows.map((r) => r.id);
      const [{ n }] = await em.query(
        `SELECT (SELECT COUNT(*) FROM plan_progress_updates WHERE item_id = ANY($1)) + (SELECT COUNT(*) FROM plan_kpi_readings r JOIN plan_kpis k ON k.id = r.kpi_id WHERE k.item_id = ANY($1))
              + (SELECT COUNT(*) FROM plan_items WHERE id = ANY($1) AND (carried_from_id IS NOT NULL OR carried_to_id IS NOT NULL)) AS n`, [ids]);
      if (Number(n)) throw new ConflictException('للعنصر (أو أحد فروعه) سجل إنجاز أو قراءات مؤشرات أو ترحيل، فلا يُحذف. غيّر حالته إلى «ملغى» بدلًا من الحذف');
      const [{ ext }] = await em.query(`SELECT COUNT(*)::int AS ext FROM plan_links l JOIN plan_items f ON f.id = l.from_item_id WHERE l.to_item_id = ANY($1) AND f.plan_id <> $2`, [ids, p.id]);
      if (ext) throw new ConflictException('عناصر من خطط أخرى مرتبطة بهذا العنصر. احذف الربط من تلك الخطط أولًا');
      await em.query(`DELETE FROM plan_links WHERE from_item_id = ANY($1) OR to_item_id = ANY($1)`, [ids]);
      await em.query(`DELETE FROM plan_refs WHERE item_id = ANY($1)`, [ids]);
      await em.query(`DELETE FROM plan_kpis WHERE item_id = ANY($1)`, [ids]);
      await em.query(`DELETE FROM plan_items WHERE id = ANY($1)`, [ids]);
      return p.id;
    });
    return this.get(actor, planId);
  }

  /** تحديث الإنجاز: للعناصر التنفيذية (بلا فروع) في خطة سبق اعتمادها؛ لا يغيّر تعريف الخطة ولا يحتاج اعتمادًا */
  async progress(actor: OrgUser, id: string, dto: ProgressDto) {
    const org = actor.organizationId;
    const planId = await this.db.transaction(async (em) => {
      const it = await this.item(em, org, id);
      const p = await this.plan(em, org, it.planId);
      if (p.version < 1) throw new ConflictException('يُحدّث الإنجاز بعد اعتماد الخطة');
      if (['carried_over'].includes(it.state)) throw new ConflictException('العنصر مُرحّل إلى خطة أخرى، ويُتابع إنجازه هناك');
      const kids = await em.count(PlanItem, { where: { parentId: id } });
      if (kids) throw new BadRequestException('إنجاز هذا العنصر يُحسب من فروعه');
      const incoming = await em.count(PlanLink, { where: { toItemId: id } });
      if (incoming) throw new BadRequestException('إنجاز هذا العنصر يُحسب من العناصر المرتبطة به');
      const date = dto.updateDate ?? today();
      if (date > today()) throw new BadRequestException('تاريخ التحديث في المستقبل');
      let state = dto.state ?? it.state;
      let progress = r2(dto.progress);
      if (state === 'completed') progress = 100;
      else if (progress >= 100) state = 'completed';
      else if (state !== 'cancelled') state = progress > 0 ? 'in_progress' : 'not_started';
      if (state === 'cancelled' && !dto.note?.trim()) throw new BadRequestException('اكتب سبب إلغاء العنصر');
      it.progress = progress;
      it.state = state;
      it.progressNote = dto.note ?? null;
      it.correctiveAction = dto.correctiveAction ?? it.correctiveAction;
      it.progressUpdatedAt = new Date();
      if (dto.milestonesDone) {
        if (dto.milestonesDone.length !== it.milestones.length) throw new BadRequestException('عدد المعالم لا يطابق المعالم المخططة');
        it.milestones = it.milestones.map((m, i) => ({ ...m, done: dto.milestonesDone![i], doneDate: dto.milestonesDone![i] ? m.doneDate ?? date : null }));
      }
      await em.getRepository(PlanItem).save(it);
      await em.getRepository(PlanProgressUpdate).save(em.getRepository(PlanProgressUpdate).create({
        organizationId: org, itemId: id, updateDate: date, progress, state, note: dto.note ?? null, correctiveAction: dto.correctiveAction ?? null, byName: actor.fullName,
      }));
      return p.id;
    });
    return this.get(actor, planId);
  }

  /**
   * ترحيل نشاط غير منتهٍ (مع فروعه غير المنتهية) إلى خطة تشغيلية لاحقة:
   * الضوابط: الخطة المصدر معتمدة، والعنصر غير منجز أو ملغى أو مرحّل، والخطة الهدف تشغيلية تبدأ في نفس سنة نهاية المصدر أو بعدها،
   * والمستوى مناسب لموقعه في الخطة الهدف، وسبب الترحيل مكتوب. يبقى الأصل في خطته بحالة «مُرحّل» للتتبع.
   */
  async carry(actor: OrgUser, id: string, dto: CarryDto) {
    const org = actor.organizationId;
    const targetId = await this.db.transaction(async (em) => {
      const it = await this.item(em, org, id);
      const src = await this.plan(em, org, it.planId);
      if (!actor.isSuperadmin && !actor.permissions.includes(P.operational)) throw new ForbiddenException('ترحيل الأنشطة ليس من صلاحيتك');
      if (src.kind !== 'operational') throw new BadRequestException('الترحيل للخطط التشغيلية فقط');
      if (src.version < 1) throw new ConflictException('تُرحّل الأنشطة من خطة معتمدة');
      if (['completed', 'cancelled', 'carried_over'].includes(it.state)) throw new ConflictException('العنصر منجز أو ملغى أو مرحّل مسبقًا');
      if (dto.targetPlanId === src.id) throw new BadRequestException('اختر خطة أخرى للترحيل');
      const target = await this.editing(em, actor, dto.targetPlanId);
      if (target.kind !== 'operational') throw new BadRequestException('يُرحّل النشاط إلى خطة تشغيلية');
      if (target.startYear < src.endYear) throw new BadRequestException('الخطة الهدف يجب أن تبدأ في سنة نهاية الخطة الحالية أو بعدها');
      const parent = dto.targetParentId ? await this.item(em, org, dto.targetParentId) : null;
      if (parent && parent.planId !== target.id) throw new BadRequestException('العنصر الأب ليس في الخطة الهدف');
      const level = parent ? parent.level + 1 : 0;
      if (level !== it.level) throw new BadRequestException(`اختر موقعًا في الخطة الهدف بنفس مستوى العنصر (${src.levels[it.level]?.name})`);
      if (level >= target.levels.length) throw new BadRequestException('مستويات الخطة الهدف لا تتسع لهذا العنصر');
      const startOf = `${target.startYear}-01-01`;
      const move = async (s: PlanItem, newParent: PlanItem | null) => {
        const siblings = await em.getRepository(PlanItem).find({ where: { planId: target.id, parentId: newParent ? newParent.id : (null as unknown as string) }, select: ['code', 'sortOrder'] });
        const start = s.startDate && s.startDate > startOf ? s.startDate : startOf;
        const n = await em.getRepository(PlanItem).save(em.getRepository(PlanItem).create({
          ...pick(s, ITEM_DEF_KEYS), id: undefined, organizationId: org, planId: target.id, parentId: newParent?.id ?? null, level: newParent ? newParent.level + 1 : 0,
          code: itemCode(target.levels[newParent ? newParent.level + 1 : 0].prefix, newParent?.code ?? null, siblings.map((x) => x.code)),
          sortOrder: Math.max(-1, ...siblings.map((x) => x.sortOrder)) + 1, startDate: start, endDate: s.endDate && s.endDate >= start ? s.endDate : null,
          costByYear: Object.fromEntries(Object.entries(s.costByYear).filter(([y]) => Number(y) >= target.startYear)),
          progress: s.progress, state: s.progress > 0 ? 'in_progress' : 'not_started', carriedFromId: s.id, progressNote: `مُرحّل من ${src.code} / ${s.code}: ${dto.note}`,
        }));
        n.plannedCost = sumCost(n.costByYear);
        await em.getRepository(PlanItem).save(n);
        s.state = 'carried_over';
        s.carriedToId = n.id;
        s.progressNote = `رُحّل إلى ${target.code} / ${n.code}: ${dto.note}`;
        await em.getRepository(PlanItem).save(s);
        await em.getRepository(PlanProgressUpdate).save(em.getRepository(PlanProgressUpdate).create({
          organizationId: org, itemId: s.id, updateDate: today(), progress: s.progress, state: 'carried_over', note: `ترحيل إلى ${target.code}: ${dto.note}`, correctiveAction: null, byName: actor.fullName,
        }));
        for (const l of await em.getRepository(PlanLink).find({ where: { fromItemId: s.id } })) {
          await em.getRepository(PlanLink).save(em.getRepository(PlanLink).create({ organizationId: org, fromItemId: n.id, toItemId: l.toItemId, relation: l.relation, contribution: l.contribution, note: l.note }));
          await em.getRepository(PlanLink).delete({ id: l.id });
        }
        for (const c of await em.getRepository(PlanItem).find({ where: { parentId: s.id }, order: { sortOrder: 'ASC' } })) {
          if (!['completed', 'cancelled', 'carried_over'].includes(c.state)) await move(c, n);
        }
      };
      await move(it, parent);
      if (!target.revisionNote && target.version > 0) target.revisionNote = `ترحيل أنشطة من ${src.code}`;
      await em.getRepository(Plan).save(target);
      return target.id;
    });
    return this.get(actor, targetId);
  }

  // ---------------- العلاقات والمراجع ----------------

  async addLink(actor: OrgUser, dto: LinkDto) {
    const org = actor.organizationId;
    const cfg = await this.core.config(org);
    if (!cfg.relationTypes.some((r) => r.code === dto.relation)) throw new BadRequestException('نوع العلاقة غير معرّف في الإعدادات');
    if (dto.fromItemId === dto.toItemId) throw new BadRequestException('لا يرتبط العنصر بنفسه');
    const planId = await this.db.transaction(async (em) => {
      const from = await this.item(em, org, dto.fromItemId);
      const to = await this.item(em, org, dto.toItemId);
      const p = await this.editing(em, actor, from.planId);
      const [{ rel }] = await em.query(
        `WITH RECURSIVE up AS (SELECT id, parent_id FROM plan_items WHERE id = $1 UNION ALL SELECT i.id, i.parent_id FROM plan_items i JOIN up ON i.id = up.parent_id),
              dn AS (SELECT id FROM plan_items WHERE id = $1 UNION ALL SELECT i.id FROM plan_items i JOIN dn ON i.parent_id = dn.id)
         SELECT (EXISTS (SELECT 1 FROM up WHERE id = $2) OR EXISTS (SELECT 1 FROM dn WHERE id = $2)) AS rel`, [from.id, to.id]);
      if (rel) throw new BadRequestException('العنصران في نفس الفرع من الهيكل، والعلاقة بينهما قائمة بالتسلسل');
      if (await em.count(PlanLink, { where: { fromItemId: from.id, toItemId: to.id } })) throw new ConflictException('الربط موجود مسبقًا');
      if (await em.count(PlanLink, { where: { fromItemId: to.id, toItemId: from.id } })) throw new BadRequestException('يوجد ربط عكسي بين العنصرين');
      await this.assertContribution(em, to.id, dto.contribution ?? null, null);
      await em.getRepository(PlanLink).save(em.getRepository(PlanLink).create({
        organizationId: org, fromItemId: from.id, toItemId: to.id, relation: dto.relation, contribution: dto.contribution ?? null, note: dto.note ?? null,
      }));
      return p.id;
    });
    return this.get(actor, planId);
  }

  private async assertContribution(em: EntityManager, toItemId: string, add: number | null, exceptId: string | null) {
    if (add === null) return;
    const [{ s }] = await em.query(`SELECT COALESCE(SUM(contribution), 0)::float AS s FROM plan_links WHERE to_item_id = $1 AND ($2::uuid IS NULL OR id <> $2)`, [toItemId, exceptId]);
    if (s + add > 100.001) throw new BadRequestException(`مجموع نسب المساهمة في العنصر يتجاوز 100% (المسجل ${r2(s)}%)`);
  }

  async updateLink(actor: OrgUser, id: string, dto: Partial<LinkDto>) {
    const org = actor.organizationId;
    const cfg = await this.core.config(org);
    const planId = await this.db.transaction(async (em) => {
      const l = await em.getRepository(PlanLink).findOne({ where: { id, organizationId: org } });
      if (!l) throw new NotFoundException('الربط غير موجود');
      const from = await this.item(em, org, l.fromItemId);
      const p = await this.editing(em, actor, from.planId);
      if (dto.relation !== undefined) {
        if (!cfg.relationTypes.some((r) => r.code === dto.relation)) throw new BadRequestException('نوع العلاقة غير معرّف في الإعدادات');
        l.relation = dto.relation;
      }
      if (dto.contribution !== undefined) {
        await this.assertContribution(em, l.toItemId, dto.contribution ?? null, l.id);
        l.contribution = dto.contribution ?? null;
      }
      if (dto.note !== undefined) l.note = dto.note ?? null;
      await em.getRepository(PlanLink).save(l);
      return p.id;
    });
    return this.get(actor, planId);
  }

  async removeLink(actor: OrgUser, id: string) {
    const org = actor.organizationId;
    const planId = await this.db.transaction(async (em) => {
      const l = await em.getRepository(PlanLink).findOne({ where: { id, organizationId: org } });
      if (!l) throw new NotFoundException('الربط غير موجود');
      const from = await this.item(em, org, l.fromItemId);
      const p = await this.editing(em, actor, from.planId);
      await em.getRepository(PlanLink).delete({ id });
      return p.id;
    });
    return this.get(actor, planId);
  }

  /** الربط بعنصر في نظام آخر: يُتحقق من وجوده ويُحفظ رمزه وعنوانه، ولا يُعدّل في النظام المصدر */
  async addRef(actor: OrgUser, itemId: string, dto: RefDto) {
    const org = actor.organizationId;
    const it = await this.item(this.db.manager, org, itemId);
    const p = await this.plan(this.db.manager, org, it.planId);
    this.assertManage(actor, p);
    if (p.status === 'rejected') throw new ConflictException('الخطة مرفوضة');
    const src = await this.links.resolve(actor, dto.system, dto.refId);
    if (await this.db.getRepository(PlanRef).count({ where: { itemId, system: dto.system, refId: dto.refId } })) throw new ConflictException('الربط موجود مسبقًا');
    await this.db.getRepository(PlanRef).save(this.refRow(actor, itemId, dto.system, src, dto.contribution ?? null, dto.note ?? null));
    return this.get(actor, p.id);
  }

  private refRow(actor: OrgUser, itemId: string, system: RefDto['system'], src: RefOption, contribution: number | null, note: string | null) {
    return this.db.getRepository(PlanRef).create({
      organizationId: actor.organizationId, itemId, system, refId: src.id, refCode: src.code.slice(0, 60), refLabel: src.label.slice(0, 400),
      contribution, note, refMeta: src.meta, refVersion: src.version, createdByName: actor.fullName,
    });
  }

  /**
   * نشاط لمعالجة خطر أو تنفيذ إجراء تصحيحي: يُنشأ عنصرًا فرعيًا تحت العنصر المختار ويُربط بمرجعه،
   * وتكلفته التقديرية تدخل الموازنة مع باقي الأنشطة. لا يتغير شيء في سجل المخاطر أو المراجعة.
   */
  async treatment(actor: OrgUser, parentId: string, dto: TreatmentDto) {
    const org = actor.organizationId;
    const parent = await this.item(this.db.manager, org, parentId);
    const src = await this.links.resolve(actor, dto.system, dto.refId);
    const title = dto.title?.trim() || (dto.system === 'risk' ? `معالجة الخطر ${src.code}: ${src.label}` : `تنفيذ الإجراء التصحيحي ${src.code}: ${src.label}`).slice(0, 300);
    const m = src.meta;
    const description = dto.description ?? (dto.system === 'audit' && m.recommendation ? `التوصية: ${m.recommendation}` : null);
    return this.addItem(actor, parent.planId, {
      parentId, title, description, ownerUserId: dto.ownerUserId ?? null, ownerName: dto.ownerName ?? (dto.system === 'audit' ? (m.assigneeName as string | null) : (m.ownerName as string | null)) ?? null,
      unitId: dto.unitId, startDate: dto.startDate ?? null, endDate: dto.endDate ?? (dto.system === 'audit' ? String(m.dueDate) : null),
      costByYear: dto.costByYear ?? {}, fundingType: dto.fundingType ?? null,
    } as ItemDto, async (em, it) => {
      await em.getRepository(PlanRef).save(this.refRow(actor, it.id, dto.system, src, null, dto.system === 'risk' ? 'نشاط معالجة' : 'إجراء تصحيحي'));
    });
  }

  async removeRef(actor: OrgUser, id: string) {
    const org = actor.organizationId;
    const r = await this.db.getRepository(PlanRef).findOne({ where: { id, organizationId: org } });
    if (!r) throw new NotFoundException('الربط غير موجود');
    const it = await this.item(this.db.manager, org, r.itemId);
    const p = await this.plan(this.db.manager, org, it.planId);
    this.assertManage(actor, p);
    await this.db.getRepository(PlanRef).delete({ id });
    return this.get(actor, p.id);
  }

  // ---------------- المؤشرات ----------------

  private validTargets(p: Plan, frequency: PlanKpi['frequency'], targets: Record<string, number>) {
    const allowed = new Set<string>();
    for (let y = p.startYear; y <= p.endYear; y++) {
      allowed.add(String(y));
      for (const x of periodsOf(y, frequency)) allowed.add(x);
    }
    const out: Record<string, number> = {};
    for (const [k, v] of Object.entries(targets ?? {})) {
      if (v === null || (v as unknown) === '' || v === undefined) continue;
      if (!isPeriod(k) || !allowed.has(k)) throw new BadRequestException(`الفترة ${k} خارج مدة الخطة أو لا تناسب دورية المؤشر`);
      const n = Number(v);
      if (!Number.isFinite(n)) throw new BadRequestException('المستهدف رقم');
      out[k] = r2(n);
    }
    if (!Object.keys(out).length) throw new BadRequestException('حدد مستهدفًا واحدًا على الأقل للمؤشر');
    return out;
  }

  async createKpi(actor: OrgUser, planId: string, dto: KpiDto) {
    const org = actor.organizationId;
    await this.db.transaction(async (em) => {
      const p = await this.plan(em, org, planId, true);
      this.assertKpiManage(actor, p);
      assertEditable(p);
      if (dto.itemId) {
        const it = await this.item(em, org, dto.itemId);
        if (it.planId !== p.id) throw new BadRequestException('العنصر المرتبط من خطة أخرى');
      }
      markEdited(p, actor.fullName);
      await em.getRepository(Plan).save(p);
      const [{ max }] = await em.query('SELECT COALESCE(MAX(sort_order), 0)::int AS max FROM plan_kpis WHERE plan_id = $1', [p.id]);
      await em.getRepository(PlanKpi).save(em.getRepository(PlanKpi).create({
        organizationId: org, planId: p.id, itemId: dto.itemId ?? null, code: await this.core.nextCode(em, org, 'KPI'), name: dto.name, description: dto.description ?? null,
        unit: dto.unit, direction: dto.direction, frequency: dto.frequency, aggregation: dto.aggregation, baseline: dto.baseline ?? null,
        targets: this.validTargets(p, dto.frequency, dto.targets), weight: dto.weight ?? 1, ownerName: dto.ownerName ?? null, dataSource: dto.dataSource ?? null, sortOrder: max + 1,
      }));
    });
    return this.get(actor, planId);
  }

  async updateKpi(actor: OrgUser, id: string, dto: Partial<KpiDto>) {
    const org = actor.organizationId;
    const planId = await this.db.transaction(async (em) => {
      const k = await em.getRepository(PlanKpi).findOne({ where: { id, organizationId: org } });
      if (!k) throw new NotFoundException('المؤشر غير موجود');
      const p = await this.plan(em, org, k.planId, true);
      this.assertKpiManage(actor, p);
      assertEditable(p);
      if (dto.itemId !== undefined) {
        if (dto.itemId) {
          const it = await this.item(em, org, dto.itemId);
          if (it.planId !== p.id) throw new BadRequestException('العنصر المرتبط من خطة أخرى');
        }
        k.itemId = dto.itemId ?? null;
      }
      if (dto.frequency !== undefined && dto.frequency !== k.frequency) {
        const n = await em.count(PlanKpiReading, { where: { kpiId: k.id } });
        if (n) throw new ConflictException('للمؤشر قراءات مسجلة، فلا تتغير دورية قياسه');
        k.frequency = dto.frequency;
      }
      for (const f of ['name', 'description', 'unit', 'direction', 'aggregation', 'baseline', 'weight', 'ownerName', 'dataSource'] as const) {
        if (dto[f] !== undefined) (k as unknown as Record<string, unknown>)[f] = dto[f] ?? null;
      }
      if (k.weight === null) k.weight = 1;
      if (dto.targets !== undefined) k.targets = this.validTargets(p, k.frequency, dto.targets);
      markEdited(p, actor.fullName);
      await em.getRepository(Plan).save(p);
      await em.getRepository(PlanKpi).save(k);
      return p.id;
    });
    return this.get(actor, planId);
  }

  async removeKpi(actor: OrgUser, id: string) {
    const org = actor.organizationId;
    const planId = await this.db.transaction(async (em) => {
      const k = await em.getRepository(PlanKpi).findOne({ where: { id, organizationId: org } });
      if (!k) throw new NotFoundException('المؤشر غير موجود');
      const p = await this.plan(em, org, k.planId, true);
      this.assertKpiManage(actor, p);
      assertEditable(p);
      if (await em.count(PlanKpiReading, { where: { kpiId: id } })) throw new ConflictException('للمؤشر قراءات مسجلة فلا يُحذف');
      markEdited(p, actor.fullName);
      await em.getRepository(Plan).save(p);
      await em.getRepository(PlanKpi).delete({ id });
      return p.id;
    });
    return this.get(actor, planId);
  }

  /** تسجيل القراءة الفعلية لفترة (أو تعديلها) */
  async reading(actor: OrgUser, kpiId: string, dto: ReadingDto) {
    const org = actor.organizationId;
    const k = await this.db.getRepository(PlanKpi).findOne({ where: { id: kpiId, organizationId: org } });
    if (!k) throw new NotFoundException('المؤشر غير موجود');
    const p = await this.plan(this.db.manager, org, k.planId);
    if (p.version < 1) throw new ConflictException('تُسجّل القراءات بعد اعتماد الخطة');
    const y = periodYear(dto.period);
    if (!isPeriod(dto.period) || !periodsOf(y, k.frequency).includes(dto.period) || y < p.startYear || y > p.endYear) {
      throw new BadRequestException('الفترة لا تناسب دورية المؤشر أو خارج مدة الخطة');
    }
    if (`${dto.period}` > today().slice(0, dto.period.length) && y > Number(today().slice(0, 4))) throw new BadRequestException('لا تُسجّل قراءة لفترة مستقبلية');
    const repo = this.db.getRepository(PlanKpiReading);
    const existing = await repo.findOne({ where: { kpiId, period: dto.period } });
    if (existing) {
      existing.value = dto.value;
      existing.note = dto.note ?? null;
      existing.enteredByName = actor.fullName;
      await repo.save(existing);
    } else {
      await repo.save(repo.create({ organizationId: org, kpiId, period: dto.period, value: dto.value, note: dto.note ?? null, enteredByName: actor.fullName }));
    }
    return this.get(actor, p.id);
  }

  async removeReading(actor: OrgUser, kpiId: string, period: string) {
    const org = actor.organizationId;
    const k = await this.db.getRepository(PlanKpi).findOne({ where: { id: kpiId, organizationId: org } });
    if (!k) throw new NotFoundException('المؤشر غير موجود');
    await this.db.getRepository(PlanKpiReading).delete({ kpiId, period });
    return this.get(actor, k.planId);
  }

  // ---------------- القضايا الجوهرية وخارطة المعنيين ----------------

  /** إضافة صف برمز يلي آخر رمز في الخطة (الخطة مقفلة بالمعاملة فلا يتكرر الرمز) */
  private async insertContext(em: EntityManager, p: Plan, kind: ContextKind, dto: IssueDto | StakeholderDto, fallbackOrder?: number) {
    if (p.kind !== 'strategic') throw new BadRequestException('القضايا الجوهرية وخارطة المعنيين تُعد في الخطة الاستراتيجية، والخطة التشغيلية تعرضها من خطتها الأم');
    const c = CONTEXT[kind];
    const repo = em.getRepository<ContextRow>(c.entity);
    const rows = await repo.find({ where: { organizationId: p.organizationId, planId: p.id }, select: ['code', 'sortOrder'] });
    if (rows.length >= MAX_CONTEXT_ROWS) throw new BadRequestException(`الحد الأعلى ${MAX_CONTEXT_ROWS} صف في الخطة`);
    const n = Math.max(0, ...rows.map((r) => Number(r.code.slice(c.prefix.length + 1)) || 0)) + 1;
    const order = dto.sortOrder ?? fallbackOrder ?? Math.max(0, ...rows.map((r) => r.sortOrder)) + 1;
    return repo.save(repo.create({ ...dto, organizationId: p.organizationId, planId: p.id, code: `${c.prefix}-${String(n).padStart(2, '0')}`, sortOrder: order } as never));
  }

  async addContext(actor: OrgUser, kind: ContextKind, planId: string, dto: IssueDto | StakeholderDto) {
    await this.db.transaction(async (em) => {
      const p = await this.editing(em, actor, planId);
      await this.insertContext(em, p, kind, dto);
    });
    return this.get(actor, planId);
  }

  /** إضافة عدة صفوف في معاملة واحدة (الإدراج الآلي لبيانات الشركة). لا ترفع الخطة ولا تعتمدها */
  async addContextBatch(actor: OrgUser, planId: string, issues: IssueDto[], stakeholders: StakeholderDto[]) {
    await this.db.transaction(async (em) => {
      const p = await this.editing(em, actor, planId);
      for (const dto of issues) await this.insertContext(em, p, 'issue', dto);
      for (const dto of stakeholders) await this.insertContext(em, p, 'stakeholder', dto);
    });
  }

  private async contextRow(em: EntityManager, org: string, kind: ContextKind, id: string) {
    const r = await em.getRepository<ContextRow>(CONTEXT[kind].entity).findOne({ where: { id, organizationId: org } });
    if (!r) throw new NotFoundException(CONTEXT[kind].missing);
    return r;
  }

  async updateContext(actor: OrgUser, kind: ContextKind, id: string, dto: Partial<IssueDto & StakeholderDto>) {
    const org = actor.organizationId;
    const planId = await this.db.transaction(async (em) => {
      await this.editing(em, actor, (await this.contextRow(em, org, kind, id)).planId);
      // إعادة القراءة بعد قفل الخطة، فلا يُعاد صف حُذف في طلب متزامن
      const r = await this.contextRow(em, org, kind, id);
      const allowed = CONTEXT[kind].keys.filter((k) => k !== 'id' && k !== 'code') as readonly string[];
      for (const [k, v] of Object.entries(dto)) {
        if (v === undefined || !allowed.includes(k)) continue;
        if (v === null && ['title', 'summary', 'name', 'category', 'sortOrder'].includes(k)) throw new BadRequestException('أكمل الحقول الإلزامية');
        (r as unknown as Record<string, unknown>)[k] = v;
      }
      await em.getRepository<ContextRow>(CONTEXT[kind].entity).save(r);
      return r.planId;
    });
    return this.get(actor, planId);
  }

  async removeContext(actor: OrgUser, kind: ContextKind, id: string) {
    const org = actor.organizationId;
    const planId = await this.db.transaction(async (em) => {
      await this.editing(em, actor, (await this.contextRow(em, org, kind, id)).planId);
      const r = await this.contextRow(em, org, kind, id);
      await em.getRepository<ContextRow>(CONTEXT[kind].entity).delete({ id: r.id, organizationId: org });
      return r.planId;
    });
    return this.get(actor, planId);
  }

  // ---------------- الاعتماد والإصدارات ----------------

  async snapshot(em: EntityManager, p: Plan): Promise<PlanSnapshot> {
    const items = await em.getRepository(PlanItem).find({ where: { planId: p.id }, order: { level: 'ASC', sortOrder: 'ASC' } });
    const kpis = await em.getRepository(PlanKpi).find({ where: { planId: p.id }, order: { sortOrder: 'ASC' } });
    const links = items.length ? await em.getRepository(PlanLink).find({ where: { fromItemId: In(items.map((i) => i.id)) } }) : [];
    const issues = await em.getRepository(PlanMaterialIssue).find({ where: { organizationId: p.organizationId, planId: p.id }, order: { sortOrder: 'ASC', code: 'ASC' } });
    const stakeholders = await em.getRepository(PlanStakeholder).find({ where: { organizationId: p.organizationId, planId: p.id }, order: { sortOrder: 'ASC', code: 'ASC' } });
    return clone({
      ...pick(p, PLAN_DEF_KEYS),
      items: items.map((i) => pick(i, ITEM_DEF_KEYS)),
      kpis: kpis.map((k) => pick(k, KPI_DEF_KEYS)),
      links: links.map((l) => ({ fromItemId: l.fromItemId, toItemId: l.toItemId, relation: l.relation, contribution: l.contribution, note: l.note })),
      issues: issues.map((i) => pick(i, ISSUE_DEF_KEYS)),
      stakeholders: stakeholders.map((x) => pick(x, STAKEHOLDER_DEF_KEYS)),
    });
  }

  async submit(actor: OrgUser, id: string, note: string | null) {
    const cfg = await this.core.config(actor.organizationId);
    await this.db.transaction((em) => this.submitIn(em, actor, id, note, cfg));
    return this.get(actor, id);
  }

  private async submitIn(em: EntityManager, actor: OrgUser, id: string, note: string | null, cfg: PlanningConfig) {
    const org = actor.organizationId;
    {
      const p = await this.plan(em, org, id, true);
      this.assertManage(actor, p);
      const items = await em.getRepository(PlanItem).find({ where: { planId: id } });
      if (!items.length) throw new BadRequestException('أضف عناصر الخطة قبل رفعها للاعتماد');
      if (p.version > 0) {
        const text = note?.trim() || p.revisionNote;
        if (!text) throw new BadRequestException('اكتب سبب التعديل على الخطة المعتمدة');
        p.revisionNote = text;
        const last = await em.getRepository(PlanVersion).findOneOrFail({ where: { planId: id, version: p.version } });
        if (!diffSnapshots(last.snapshot, await this.snapshot(em, p)).length) throw new BadRequestException('لا يوجد تعديل على الإصدار المعتمد. استخدم «إلغاء التعديل» للعودة إليه');
      }
      const total = items.filter((i) => i.state !== 'cancelled').reduce((s, i) => s + i.plannedCost, 0);
      const route = pickRoute(cfg.routes, p.kind, p.unitId, total);
      p.routeName = route?.name ?? null;
      wfSubmit(p, route?.stages ?? [], actor.fullName, note?.trim() || null);
      await em.getRepository(Plan).save(p);
      if (p.status === 'approved') await this.afterApprove(em, p, actor.fullName);
      return p;
    }
  }

  async decide(actor: OrgUser, id: string, dto: DecideDto) {
    const d = await this.core.decider(actor);
    await this.db.transaction((em) => this.decideIn(em, actor, id, dto, d));
    return this.get(actor, id);
  }

  private async decideIn(em: EntityManager, actor: OrgUser, id: string, dto: DecideDto, d: Awaited<ReturnType<PlanningCore['decider']>>) {
    const p = await this.plan(em, actor.organizationId, id, true);
    wfDecide(p, d, dto.decision, dto.note ?? null);
    await em.getRepository(Plan).save(p);
    if (p.status === 'approved') await this.afterApprove(em, p, actor.fullName);
    return p;
  }

  /** بعد الاعتماد النهائي: إصدار جديد بنسخة كاملة لا تتغير */
  private async afterApprove(em: EntityManager, p: Plan, byName: string) {
    p.version += 1;
    const note = p.version === 1 ? 'الإصدار الأول المعتمد' : p.revisionNote;
    await em.getRepository(PlanVersion).save(em.getRepository(PlanVersion).create({
      organizationId: p.organizationId, planId: p.id, version: p.version, snapshot: await this.snapshot(em, p), note, approvedByName: byName, approvedAt: p.approvedAt ?? new Date(),
    }));
    p.revisionNote = null;
    await em.getRepository(Plan).save(p);
  }

  /** إلغاء التعديل الجاري: إعادة تعريف الخطة كما في آخر إصدار معتمد (يبقى الإنجاز والقراءات) */
  async discard(actor: OrgUser, id: string) {
    const org = actor.organizationId;
    await this.db.transaction(async (em) => {
      const p = await this.plan(em, org, id, true);
      this.assertManage(actor, p);
      if (p.version < 1) throw new ConflictException('لا يوجد إصدار معتمد للعودة إليه');
      if (!['draft', 'returned', 'rejected'].includes(p.status)) throw new ConflictException('لا يوجد تعديل جارٍ على الخطة');
      const v = await em.getRepository(PlanVersion).findOneOrFail({ where: { planId: id, version: p.version } });
      const s = v.snapshot;
      const keep = new Set(s.items.map((i) => i.id));
      const current = await em.getRepository(PlanItem).find({ where: { planId: id } });
      const extra = current.filter((i) => !keep.has(i.id)).map((i) => i.id);
      if (extra.length) {
        const [{ n }] = await em.query(`SELECT COUNT(*)::int AS n FROM plan_items WHERE id = ANY($1) AND (carried_from_id IS NOT NULL)`, [extra]);
        if (n) throw new ConflictException('أُضيفت للخطة أنشطة مُرحّلة بعد آخر اعتماد، فلا يمكن إلغاء التعديل. ارفع الخطة للاعتماد');
        await em.query(`DELETE FROM plan_links WHERE from_item_id = ANY($1) OR to_item_id = ANY($1)`, [extra]);
        await em.query(`DELETE FROM plan_refs WHERE item_id = ANY($1)`, [extra]);
        await em.query(`DELETE FROM plan_progress_updates WHERE item_id = ANY($1)`, [extra]);
        await em.query(`DELETE FROM plan_kpi_readings WHERE kpi_id IN (SELECT id FROM plan_kpis WHERE item_id = ANY($1))`, [extra]);
        await em.query(`DELETE FROM plan_kpis WHERE item_id = ANY($1)`, [extra]);
        await em.query(`DELETE FROM plan_items WHERE id = ANY($1)`, [extra]);
      }
      const byId = new Map(current.map((i) => [i.id, i]));
      for (const si of [...s.items].sort((a, b) => a.level - b.level)) {
        const cur = byId.get(si.id);
        await em.getRepository(PlanItem).save(cur ? Object.assign(cur, si) : em.getRepository(PlanItem).create({ ...si, organizationId: org, planId: id }));
      }
      const keepK = new Set(s.kpis.map((k) => k.id));
      const curK = await em.getRepository(PlanKpi).find({ where: { planId: id } });
      for (const k of curK.filter((x) => !keepK.has(x.id))) {
        await em.query(`DELETE FROM plan_kpi_readings WHERE kpi_id = $1`, [k.id]);
        await em.getRepository(PlanKpi).delete({ id: k.id });
      }
      const kById = new Map(curK.map((k) => [k.id, k]));
      for (const sk of s.kpis) {
        const cur = kById.get(sk.id);
        await em.getRepository(PlanKpi).save(cur ? Object.assign(cur, sk) : em.getRepository(PlanKpi).create({ ...sk, organizationId: org, planId: id }));
      }
      await em.query(`DELETE FROM plan_links WHERE from_item_id = ANY($1)`, [[...keep]]);
      for (const l of s.links) {
        await em.getRepository(PlanLink).save(em.getRepository(PlanLink).create({ ...l, organizationId: org }));
      }
      // الإصدارات السابقة لإضافة القضايا والمعنيين لا تحويهما، فالعودة إليها تعني سجلين فارغين
      for (const [kind, rows] of [['issue', s.issues ?? []], ['stakeholder', s.stakeholders ?? []]] as const) {
        const repo = em.getRepository<ContextRow>(CONTEXT[kind].entity);
        await repo.delete({ organizationId: org, planId: id });
        for (const r of rows) await repo.save(repo.create({ ...r, organizationId: org, planId: id } as never));
      }
      Object.assign(p, pick(s, PLAN_DEF_KEYS));
      p.status = 'approved';
      p.stageIndex = null;
      p.revisionNote = null;
      p.approvals = [...p.approvals, { action: 'reopen', stage: null, byName: actor.fullName, at: new Date().toISOString(), note: `إلغاء التعديل والعودة للإصدار ${p.version}` }];
      await em.getRepository(Plan).save(p);
    });
    return this.get(actor, id);
  }

  async version(actor: OrgUser, id: string, version: number) {
    const v = await this.db.getRepository(PlanVersion).findOne({ where: { organizationId: actor.organizationId, planId: id, version } });
    if (!v) throw new NotFoundException('الإصدار غير موجود');
    return v;
  }

  /** مقارنة إصدارين، أو إصدار بالمسودة الحالية (to = 0) */
  async compare(actor: OrgUser, id: string, from: number, to: number) {
    const org = actor.organizationId;
    const p = await this.plan(this.db.manager, org, id);
    const a = (await this.version(actor, id, from)).snapshot;
    const b = to ? (await this.version(actor, id, to)).snapshot : await this.snapshot(this.db.manager, p);
    const cost = (s: PlanSnapshot) => r2(s.items.reduce((t, i) => t + i.plannedCost, 0));
    return {
      plan: { id: p.id, code: p.code, title: p.title }, from, to,
      totals: { fromCost: cost(a), toCost: cost(b), fromItems: a.items.length, toItems: b.items.length, fromKpis: a.kpis.length, toKpis: b.kpis.length },
      rows: diffSnapshots(a, b),
    };
  }

  /** قائمة العناصر للربط (من كل الخطط عدا المرفوضة) */
  async linkOptions(actor: OrgUser) {
    const rows = await this.db.query(
      `SELECT i.id, i.code, i.title, i.level, p.id AS "planId", p.code AS "planCode", p.title AS "planTitle", p.kind, p.levels->i.level->>'name' AS "levelName"
         FROM plan_items i JOIN plan_plans p ON p.id = i.plan_id
        WHERE i.organization_id = $1 AND p.status <> 'rejected' AND i.state NOT IN ('cancelled', 'carried_over')
        ORDER BY p.kind DESC, p.start_year DESC, p.code, i.code`, [actor.organizationId]);
    return rows;
  }

  async itemUpdates(actor: OrgUser, id: string) {
    await this.item(this.db.manager, actor.organizationId, id);
    return this.db.getRepository(PlanProgressUpdate).find({ where: { organizationId: actor.organizationId, itemId: id }, order: { createdAt: 'DESC' } });
  }

  /** للعرض المركّز: سنة الخطة الحالية */
  yearOf(p: Plan) {
    return planYear(p, Number(today().slice(0, 4)));
  }
}
