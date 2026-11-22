import { randomUUID } from 'crypto';
import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { DataSource, EntityManager, In } from 'typeorm';
import { OrgUser } from '../../core/auth/decorators';
import {
  DevelopmentConfig, DevHistory, DevItem, DevPlanStatus, HrCompetency, HrDevPlan, HrEmployee, HrJob, HrPerformanceCard, HrSettings, HrSuccessionCandidate, HrUnit,
  Readiness,
} from './entities/hr.entity';
import { CandidateDto, DevConfigDto, DevPlanCreateDto, DevPlanDto, DevProgressDto, RunDecisionDto, SuccessionJobDto } from './hr.dto';
import { HrCore } from './hr-core.service';
import { HR_PERMISSIONS as P } from './hr.manifest';
import { round2 } from './hr-policy';

export const DEV_STATUS_AR: Record<DevPlanStatus, string> = {
  draft: 'قيد الإعداد', pending: 'قيد الاعتماد', returned: 'معادة للتعديل', approved: 'معتمدة وقيد التنفيذ', completed: 'مكتملة', cancelled: 'ملغاة',
};
export const ITEM_STATUS_AR = { planned: 'مخطط', in_progress: 'جارٍ التنفيذ', done: 'منجز', cancelled: 'ملغى' } as const;
export const READINESS_AR: Record<Readiness, string> = { now: 'جاهز الآن', '1y': 'جاهز خلال سنة', '2y': 'جاهز خلال سنتين' };
const ACTION_AR: Record<string, string> = {
  create: 'إعداد الخطة', update: 'تعديل الخطة', submit: 'رفع للاعتماد', approve: 'موافقة', final: 'اعتماد نهائي', return: 'إرجاع للتعديل',
  progress: 'تحديث التنفيذ', complete: 'إغلاق الخطة', cancel: 'إلغاء الخطة',
};

export const DEFAULT_ACTIVITY_TYPES = [
  { code: 'course', name: 'دورة تدريبية' }, { code: 'workshop', name: 'ورشة عمل' }, { code: 'ojt', name: 'تدريب على رأس العمل' },
  { code: 'mentoring', name: 'إرشاد وتوجيه من مدير أو خبير' }, { code: 'project', name: 'مهمة أو مشروع تطويري' }, { code: 'rotation', name: 'تدوير وظيفي أو تكليف مؤقت' },
  { code: 'certificate', name: 'شهادة مهنية' }, { code: 'self', name: 'تعلم ذاتي وقراءة' },
];

interface Ratings { year: number | null; levels: Map<string, number> }

/**
 * التطوير والتدريب: فجوة الجدارات (المطلوب في الوصف الوظيفي مقابل الفعلي من آخر تقييم أداء)، وخطط تطوير
 * فردية بمستهدفات وأنشطة تمر بمراحل اعتماد ثم تُتابع حتى الإغلاق. والصف الثاني: وظيفة بديلة لكل وظيفة،
 * ومرشحون بجاهزيتهم وخطط إعدادهم.
 */
@Injectable()
export class DevelopmentService {
  constructor(private readonly db: DataSource, private readonly core: HrCore) {}

  // ---------------- الإعدادات ----------------

  async config(org: string, em: EntityManager = this.db.manager): Promise<DevelopmentConfig> {
    const c = (await this.core.settings(org, em)).developmentConfig ?? {};
    return { stages: c.stages ?? [], activityTypes: c.activityTypes?.length ? c.activityTypes : DEFAULT_ACTIVITY_TYPES };
  }

  async getConfig(actor: OrgUser) {
    const roles = await this.db.query('SELECT id, name FROM roles WHERE organization_id = $1 ORDER BY name', [actor.organizationId]);
    return { config: await this.config(actor.organizationId), roles };
  }

  async saveConfig(actor: OrgUser, dto: DevConfigDto) {
    const org = actor.organizationId;
    const roleIds = dto.stages.map((s) => s.roleId).filter((x): x is string => !!x);
    const roles: { id: string }[] = roleIds.length ? await this.db.query('SELECT id FROM roles WHERE organization_id = $1 AND id = ANY($2)', [org, roleIds]) : [];
    if (roles.length !== new Set(roleIds).size) throw new BadRequestException('أحد الأدوار المختارة غير موجود');
    const codes = dto.activityTypes.map((t) => t.code);
    if (new Set(codes).size !== codes.length) throw new BadRequestException('رمز نوع النشاط مكرر');
    const used: { t: string }[] = await this.db.query(
      `SELECT DISTINCT x->>'activityType' AS t FROM hr_dev_plans p, jsonb_array_elements(p.items) x WHERE p.organization_id = $1`, [org],
    );
    const removed = used.find((u) => !codes.includes(u.t));
    if (removed) throw new ConflictException(`النوع «${removed.t}» مستخدم في خطط تطوير، فلا يُحذف`);
    const config: DevelopmentConfig = {
      stages: dto.stages.map((s) => ({ name: s.name, roleId: s.roleId ?? null })),
      activityTypes: dto.activityTypes.map((t) => ({ code: t.code, name: t.name })),
    };
    await this.core.settings(org);
    await this.db.getRepository(HrSettings).update({ organizationId: org }, { developmentConfig: config });
    return this.getConfig(actor);
  }

  // ---------------- فجوة الجدارات ----------------

  /** المستوى الفعلي لكل جدارة من آخر بطاقة أداء مُقيَّمة للموظف */
  private async ratings(org: string, employeeIds: string[]): Promise<Map<string, Ratings>> {
    const out = new Map<string, Ratings>();
    if (!employeeIds.length) return out;
    const cards = await this.db.getRepository(HrPerformanceCard).find({
      where: { organizationId: org, employeeId: In(employeeIds), status: In(['evaluated', 'approved']) }, order: { year: 'DESC' },
    });
    for (const c of cards) {
      if (out.has(c.employeeId)) continue;
      out.set(c.employeeId, { year: c.year, levels: new Map(c.competencies.filter((x) => x.rating !== null).map((x) => [x.competencyId, x.rating!])) });
    }
    return out;
  }

  private async comps(org: string) {
    return new Map((await this.db.getRepository(HrCompetency).find({ where: { organizationId: org } })).map((c) => [c.id, c]));
  }

  /** فجوة جدارات وظيفة لموظف: المطلوب في الوصف الوظيفي، والفعلي من آخر تقييم */
  private gapRows(job: HrJob | undefined, r: Ratings | undefined, comps: Map<string, HrCompetency>) {
    return (job?.competencies ?? []).map((c) => {
      const actual = r?.levels.get(c.competencyId) ?? null;
      return {
        competencyId: c.competencyId, name: comps.get(c.competencyId)?.name ?? 'جدارة محذوفة', kind: comps.get(c.competencyId)?.kind ?? null,
        required: c.level, actual, gap: actual === null ? null : Math.max(c.level - actual, 0),
      };
    });
  }

  async gaps(actor: OrgUser) {
    const org = actor.organizationId;
    const emps = await this.db.getRepository(HrEmployee).find({ where: { organizationId: org, status: 'active' }, order: { employeeNo: 'ASC' } });
    const [jobs, units, comps, ratings, plans] = await Promise.all([
      this.db.getRepository(HrJob).find({ where: { organizationId: org } }),
      this.db.getRepository(HrUnit).find({ where: { organizationId: org } }),
      this.comps(org),
      this.ratings(org, emps.map((e) => e.id)),
      this.db.getRepository(HrDevPlan).find({ where: { organizationId: org, status: In(['draft', 'pending', 'returned', 'approved']) } }),
    ]);
    const jm = new Map(jobs.map((j) => [j.id, j]));
    const um = new Map(units.map((u) => [u.id, u.name]));
    const rows = emps.map((e) => {
      const r = ratings.get(e.id);
      const gaps = this.gapRows(jm.get(e.jobId), r, comps);
      const plan = plans.find((p) => p.employeeId === e.id && p.kind === 'individual');
      return {
        employeeId: e.id, employeeNo: e.employeeNo, fullName: e.fullName, jobTitle: jm.get(e.jobId)?.title ?? '', unitName: um.get(e.unitId) ?? '',
        evaluatedYear: r?.year ?? null, competencies: gaps, totalGap: gaps.reduce((s, g) => s + (g.gap ?? 0), 0),
        withGap: gaps.filter((g) => (g.gap ?? 0) > 0).length, unrated: gaps.filter((g) => g.actual === null).length,
        plan: plan ? { id: plan.id, serial: plan.serial, status: plan.status, statusLabel: DEV_STATUS_AR[plan.status] } : null,
      };
    });
    // الجدارات الأكثر فجوة على مستوى الشركة (لتخطيط التدريب الجماعي)
    const byComp = new Map<string, { competencyId: string; name: string; employees: number; totalGap: number }>();
    rows.forEach((r) => r.competencies.filter((g) => (g.gap ?? 0) > 0).forEach((g) => {
      const x = byComp.get(g.competencyId) ?? { competencyId: g.competencyId, name: g.name, employees: 0, totalGap: 0 };
      x.employees += 1;
      x.totalGap += g.gap!;
      byComp.set(g.competencyId, x);
    }));
    return { rows, topGaps: [...byComp.values()].sort((a, b) => b.totalGap - a.totalGap).slice(0, 8) };
  }

  /** بنود الخطة المقترحة: كل جدارة دون المستوى المطلوب (أو لم تُقيَّم بعد) */
  private suggest(job: HrJob | undefined, r: Ratings | undefined, comps: Map<string, HrCompetency>, year: number): DevItem[] {
    return this.gapRows(job, r, comps)
      .filter((g) => g.actual === null || g.actual < g.required)
      .map((g) => ({
        id: randomUUID(), competencyId: g.competencyId, name: g.name, requiredLevel: g.required, currentLevel: g.actual, targetLevel: g.required,
        activityType: g.kind === 'leadership' ? 'mentoring' : g.kind === 'technical' ? 'course' : 'workshop',
        activity: `برنامج تطويري في ${g.name}`, provider: null, dueDate: `${year}-12-31`, cost: 0, hours: 0, status: 'planned' as const, achievedLevel: null,
        note: g.actual === null ? 'لم تُقيَّم هذه الجدارة بعد: حدّد المستوى الفعلي' : null,
      }));
  }

  // ---------------- خطط التطوير ----------------

  private history(actor: OrgUser, action: string, note: string | null = null, stageName: string | null = null): DevHistory {
    return { action, stageName, note, actorName: actor.fullName, at: new Date().toISOString() };
  }

  private async load(em: EntityManager, org: string, id: string) {
    const p = await em.getRepository(HrDevPlan).createQueryBuilder('p').setLock('pessimistic_write')
      .where('p.id = :id AND p.organization_id = :org', { id, org }).getOne();
    if (!p) throw new NotFoundException('خطة التطوير غير موجودة');
    return p;
  }

  private manage(actor: OrgUser) {
    return actor.isSuperadmin || actor.permissions.includes(P.development);
  }

  private async roleIds(actor: OrgUser): Promise<Set<string>> {
    const rows: { role_id: string }[] = await this.db.query('SELECT role_id FROM effective_user_roles WHERE user_id = $1', [actor.id]);
    return new Set(rows.map((r) => r.role_id));
  }

  private canDecide(actor: OrgUser, stage: { roleId: string | null } | undefined, roles: Set<string>) {
    if (!actor.permissions.includes(P.approveDevelopment) && !actor.isSuperadmin) return false;
    if (!stage?.roleId || actor.isSuperadmin) return true;
    return roles.has(stage.roleId);
  }

  private progressOf(items: DevItem[]) {
    const live = items.filter((i) => i.status !== 'cancelled');
    const done = live.filter((i) => i.status === 'done').length;
    return {
      items: live.length, done, percent: live.length ? Math.round((done / live.length) * 100) : 0,
      cost: round2(live.reduce((s, i) => s + i.cost, 0)), hours: round2(live.reduce((s, i) => s + i.hours, 0)),
      closedGaps: live.filter((i) => i.achievedLevel !== null && i.targetLevel !== null && i.achievedLevel >= i.targetLevel).length,
    };
  }

  async list(actor: OrgUser, year?: number) {
    const org = actor.organizationId;
    const rows = await this.db.getRepository(HrDevPlan).find({ where: { organizationId: org, ...(year ? { year } : {}) }, order: { serial: 'DESC' } });
    const emps = new Map((await this.db.getRepository(HrEmployee).find({ where: { organizationId: org } })).map((e) => [e.id, e]));
    const jobs = new Map((await this.db.getRepository(HrJob).find({ where: { organizationId: org } })).map((j) => [j.id, j.title]));
    const cfg = await this.config(org);
    return rows.map((p) => ({
      id: p.id, serial: p.serial, year: p.year, kind: p.kind, title: p.title, employeeId: p.employeeId, employeeName: emps.get(p.employeeId)?.fullName ?? '',
      jobTitle: p.jobId ? jobs.get(p.jobId) ?? '' : '', targetJobTitle: p.targetJobId ? jobs.get(p.targetJobId) ?? '' : null,
      status: p.status, statusLabel: DEV_STATUS_AR[p.status], stageName: p.status === 'pending' && p.stageIndex !== null ? cfg.stages[p.stageIndex]?.name ?? null : null,
      ...this.progressOf(p.items),
    }));
  }

  async create(actor: OrgUser, dto: DevPlanCreateDto) {
    const org = actor.organizationId;
    const e = await this.db.getRepository(HrEmployee).findOne({ where: { id: dto.employeeId, organizationId: org } });
    if (!e || e.status !== 'active') throw new NotFoundException('الموظف غير موجود أو منتهية خدمته');
    const jobs = new Map((await this.db.getRepository(HrJob).find({ where: { organizationId: org } })).map((j) => [j.id, j]));
    let target: HrJob | undefined;
    if (dto.kind === 'succession') {
      target = dto.targetJobId ? jobs.get(dto.targetJobId) : undefined;
      if (!target) throw new BadRequestException('اختر الوظيفة التي يُعد لها الموظف');
      if (target.id === e.jobId) throw new BadRequestException('الموظف يشغل هذه الوظيفة فعلًا');
    } else {
      const open = await this.db.getRepository(HrDevPlan).findOne({
        where: { organizationId: org, employeeId: e.id, kind: 'individual', year: dto.year, status: In(['draft', 'pending', 'returned', 'approved']) },
      });
      if (open) throw new ConflictException(`للموظف خطة تطوير قائمة لعام ${dto.year} (رقم ${open.serial})`);
    }
    const comps = await this.comps(org);
    const r = (await this.ratings(org, [e.id])).get(e.id);
    const items = this.suggest(target ?? jobs.get(e.jobId), r, comps, dto.year);
    const goals = target
      ? [`الوصول لمستوى الجاهزية لتولي وظيفة «${target.title}»`, 'سد فجوة الجدارات المطلوبة للوظيفة قبل نهاية الخطة']
      : ['سد فجوة الجدارات المطلوبة في الوصف الوظيفي', 'تحسين نتيجة تقييم الأداء في العام القادم'];
    const id = await this.db.transaction(async (em) => {
      await em.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`dev-plan:${org}`]);
      const [{ max }] = await em.query('SELECT COALESCE(MAX(serial), 0)::int AS max FROM hr_dev_plans WHERE organization_id = $1', [org]);
      const repo = em.getRepository(HrDevPlan);
      const saved = await repo.save(repo.create({
        organizationId: org, serial: max + 1, employeeId: e.id, jobId: e.jobId, kind: dto.kind, targetJobId: target?.id ?? null, year: dto.year,
        title: target ? `إعداد ${e.fullName} لوظيفة ${target.title}` : `خطة تطوير ${e.fullName} لعام ${dto.year}`,
        goals, items, status: 'draft', history: [this.history(actor, 'create')], createdByName: actor.fullName,
      }));
      return saved.id;
    });
    return this.get(actor, id);
  }

  async get(actor: OrgUser, id: string) {
    const org = actor.organizationId;
    const p = await this.db.getRepository(HrDevPlan).findOne({ where: { id, organizationId: org } });
    if (!p) throw new NotFoundException('خطة التطوير غير موجودة');
    const cfg = await this.config(org);
    const e = await this.db.getRepository(HrEmployee).findOneOrFail({ where: { id: p.employeeId } });
    const jobs = new Map((await this.db.getRepository(HrJob).find({ where: { organizationId: org } })).map((j) => [j.id, j]));
    const comps = await this.comps(org);
    const unit = await this.db.getRepository(HrUnit).findOne({ where: { id: e.unitId } });
    const stage = p.status === 'pending' && p.stageIndex !== null ? cfg.stages[p.stageIndex] : undefined;
    const roles = await this.roleIds(actor);
    const editable = p.status === 'draft' || p.status === 'returned';
    const live = p.items.filter((i) => i.status !== 'cancelled');
    const typeName = new Map(cfg.activityTypes.map((t) => [t.code, t.name]));
    const r = (await this.ratings(org, [e.id])).get(e.id);
    const gapJob = jobs.get(p.targetJobId ?? e.jobId);
    return {
      id: p.id, serial: p.serial, year: p.year, kind: p.kind, title: p.title, goals: p.goals, status: p.status, statusLabel: DEV_STATUS_AR[p.status],
      employee: { id: e.id, fullName: e.fullName, employeeNo: e.employeeNo, unitName: unit?.name ?? '', jobTitle: jobs.get(e.jobId)?.title ?? '' },
      targetJob: p.targetJobId ? { id: p.targetJobId, title: jobs.get(p.targetJobId)?.title ?? '' } : null,
      evaluatedYear: r?.year ?? null,
      gaps: this.gapRows(gapJob, r, comps),
      items: p.items.map((i) => ({
        ...i, activityTypeName: typeName.get(i.activityType) ?? i.activityType, statusLabel: ITEM_STATUS_AR[i.status],
        levelDescription: i.competencyId && i.targetLevel ? comps.get(i.competencyId)?.levels.find((l) => l.level === i.targetLevel)?.description ?? null : null,
      })),
      progress: this.progressOf(p.items),
      stages: cfg.stages.map((s, i) => ({ name: s.name, current: p.status === 'pending' && p.stageIndex === i, done: ['approved', 'completed'].includes(p.status) || (p.status === 'pending' && (p.stageIndex ?? 0) > i) })),
      stageName: stage?.name ?? null,
      activityTypes: cfg.activityTypes,
      competencies: [...comps.values()].filter((c) => c.isActive).map((c) => ({ id: c.id, name: c.name, levels: c.levels })),
      history: p.history.map((h) => ({ ...h, label: ACTION_AR[h.action] ?? h.action })),
      createdByName: p.createdByName, approvedAt: p.approvedAt, completedAt: p.completedAt,
      can: {
        edit: editable && this.manage(actor),
        submit: editable && this.manage(actor),
        decide: p.status === 'pending' && this.canDecide(actor, stage, roles),
        progress: p.status === 'approved' && this.manage(actor),
        complete: p.status === 'approved' && this.manage(actor) && live.length > 0 && live.every((i) => i.status === 'done'),
        cancel: ['draft', 'returned', 'pending', 'approved'].includes(p.status) && this.manage(actor),
      },
    };
  }

  async update(actor: OrgUser, id: string, dto: DevPlanDto) {
    const org = actor.organizationId;
    const cfg = await this.config(org);
    const types = new Set(cfg.activityTypes.map((t) => t.code));
    const comps = await this.comps(org);
    await this.db.transaction(async (em) => {
      const p = await this.load(em, org, id);
      if (p.status !== 'draft' && p.status !== 'returned') throw new ConflictException('لا تُعدَّل الخطة إلا وهي قيد الإعداد أو معادة للتعديل');
      const items: DevItem[] = dto.items.map((i) => {
        if (!types.has(i.activityType)) throw new BadRequestException(`نوع النشاط «${i.activityType}» غير معرّف في الإعدادات`);
        if (i.competencyId && !comps.has(i.competencyId)) throw new BadRequestException('جدارة غير موجودة');
        if (i.targetLevel && i.currentLevel !== null && i.currentLevel !== undefined && i.targetLevel <= i.currentLevel) {
          throw new BadRequestException(`المستوى المستهدف في «${i.name}» يجب أن يكون أعلى من المستوى الفعلي`);
        }
        const old = p.items.find((x) => x.id === i.id);
        return {
          id: old?.id ?? randomUUID(), competencyId: i.competencyId ?? null, name: i.name, requiredLevel: i.requiredLevel ?? null, currentLevel: i.currentLevel ?? null,
          targetLevel: i.targetLevel ?? null, activityType: i.activityType, activity: i.activity, provider: i.provider ?? null, dueDate: i.dueDate ?? null,
          cost: i.cost, hours: i.hours, status: 'planned', achievedLevel: null, note: i.note ?? null,
        };
      });
      await em.getRepository(HrDevPlan).update({ id }, {
        title: dto.title, goals: dto.goals.map((g) => g.trim()).filter(Boolean), items, history: [...p.history, this.history(actor, 'update')],
      });
    });
    return this.get(actor, id);
  }

  private assertReady(p: HrDevPlan) {
    if (!p.items.length) throw new BadRequestException('أضف نشاطًا تطويريًا واحدًا على الأقل');
    if (!p.goals.length) throw new BadRequestException('اكتب مستهدفات الخطة');
    const missing = p.items.find((i) => !i.dueDate || i.targetLevel === null);
    if (missing) throw new BadRequestException(`حدّد المستوى المستهدف وموعد الإنجاز لـ«${missing.name}»`);
  }

  async submit(actor: OrgUser, id: string) {
    const org = actor.organizationId;
    await this.db.transaction(async (em) => {
      const p = await this.load(em, org, id);
      if (p.status !== 'draft' && p.status !== 'returned') throw new ConflictException('الخطة ليست قيد الإعداد');
      this.assertReady(p);
      const cfg = await this.config(org, em);
      const repo = em.getRepository(HrDevPlan);
      if (!cfg.stages.length) {
        if (!this.canDecide(actor, undefined, new Set())) throw new ForbiddenException('لم تُعرَّف مراحل لاعتماد خطط التطوير، والاعتماد المباشر يحتاج صلاحية اعتمادها');
        await repo.update({ id }, { status: 'approved', stageIndex: null, approvedAt: new Date(), history: [...p.history, this.history(actor, 'submit'), this.history(actor, 'final')] });
        return;
      }
      await repo.update({ id }, { status: 'pending', stageIndex: 0, history: [...p.history, this.history(actor, 'submit', null, cfg.stages[0].name)] });
    });
    return this.get(actor, id);
  }

  async decide(actor: OrgUser, id: string, dto: RunDecisionDto) {
    const org = actor.organizationId;
    await this.db.transaction(async (em) => {
      const p = await this.load(em, org, id);
      if (p.status !== 'pending') throw new ConflictException('الخطة لا تنتظر قرارًا');
      const cfg = await this.config(org, em);
      const idx = p.stageIndex ?? 0;
      const stage = cfg.stages[idx];
      if (!this.canDecide(actor, stage, await this.roleIds(actor))) throw new ForbiddenException('القرار في هذه المرحلة ليس من صلاحيتك');
      const repo = em.getRepository(HrDevPlan);
      const h = (a: string) => [...p.history, this.history(actor, a, dto.note ?? null, stage?.name ?? null)];
      if (dto.decision === 'return') {
        if (!dto.note) throw new BadRequestException('اكتب سبب الإرجاع');
        await repo.update({ id }, { status: 'returned', stageIndex: null, history: h('return') });
      } else if (idx < cfg.stages.length - 1) {
        await repo.update({ id }, { stageIndex: idx + 1, history: h('approve') });
      } else {
        await repo.update({ id }, { status: 'approved', stageIndex: null, approvedAt: new Date(), history: h('final') });
      }
    });
    return this.get(actor, id);
  }

  async progress(actor: OrgUser, id: string, dto: DevProgressDto) {
    const org = actor.organizationId;
    await this.db.transaction(async (em) => {
      const p = await this.load(em, org, id);
      if (p.status !== 'approved') throw new ConflictException('تُتابع الخطة بعد اعتمادها');
      const items = p.items.map((i) => {
        const u = dto.items.find((x) => x.id === i.id);
        if (!u) return i;
        if (u.status === 'done' && (u.achievedLevel === null || u.achievedLevel === undefined) && i.competencyId) {
          throw new BadRequestException(`حدّد المستوى المحقق في «${i.name}» عند إنجازه`);
        }
        return { ...i, status: u.status, achievedLevel: u.achievedLevel ?? null, note: u.note ?? i.note };
      });
      await em.getRepository(HrDevPlan).update({ id }, { items, history: [...p.history, this.history(actor, 'progress')] });
    });
    return this.get(actor, id);
  }

  async complete(actor: OrgUser, id: string, note: string | null | undefined) {
    const org = actor.organizationId;
    await this.db.transaction(async (em) => {
      const p = await this.load(em, org, id);
      if (p.status !== 'approved') throw new ConflictException('الخطة غير معتمدة');
      const live = p.items.filter((i) => i.status !== 'cancelled');
      if (!live.length || live.some((i) => i.status !== 'done')) throw new BadRequestException('أنجز كل الأنشطة (أو ألغِ ما لن يُنفذ) قبل إغلاق الخطة');
      await em.getRepository(HrDevPlan).update({ id }, { status: 'completed', completedAt: new Date(), history: [...p.history, this.history(actor, 'complete', note ?? null)] });
    });
    return this.get(actor, id);
  }

  async cancel(actor: OrgUser, id: string, note: string | null | undefined) {
    const org = actor.organizationId;
    if (!note) throw new BadRequestException('اكتب سبب الإلغاء');
    await this.db.transaction(async (em) => {
      const p = await this.load(em, org, id);
      if (p.status === 'completed' || p.status === 'cancelled') throw new ConflictException('الخطة مغلقة');
      await em.getRepository(HrDevPlan).update({ id }, { status: 'cancelled', stageIndex: null, history: [...p.history, this.history(actor, 'cancel', note)] });
    });
    return this.get(actor, id);
  }

  // ---------------- الصف الثاني ----------------

  async succession(actor: OrgUser) {
    const org = actor.organizationId;
    const [jobs, emps, units, cands, plans] = await Promise.all([
      this.db.getRepository(HrJob).find({ where: { organizationId: org, isActive: true }, order: { code: 'ASC' } }),
      this.db.getRepository(HrEmployee).find({ where: { organizationId: org, status: 'active' } }),
      this.db.getRepository(HrUnit).find({ where: { organizationId: org } }),
      this.db.getRepository(HrSuccessionCandidate).find({ where: { organizationId: org }, order: { createdAt: 'ASC' } }),
      this.db.getRepository(HrDevPlan).find({ where: { organizationId: org, kind: 'succession' }, order: { serial: 'DESC' } }),
    ]);
    const jm = new Map(jobs.map((j) => [j.id, j]));
    const um = new Map(units.map((u) => [u.id, u.name]));
    const em = new Map(emps.map((e) => [e.id, e]));
    const holders = (jobId: string) => emps.filter((e) => e.jobId === jobId).map((e) => ({ id: e.id, fullName: e.fullName }));
    const rows = jobs.map((j) => {
      const list = cands.filter((c) => c.jobId === j.id && em.has(c.employeeId)).map((c) => {
        const e = em.get(c.employeeId)!;
        const plan = plans.find((p) => p.employeeId === c.employeeId && p.targetJobId === j.id && p.status !== 'cancelled');
        return {
          id: c.id, employeeId: c.employeeId, fullName: e.fullName, jobTitle: jm.get(e.jobId)?.title ?? '', readiness: c.readiness, readinessLabel: READINESS_AR[c.readiness],
          note: c.note, plan: plan ? { id: plan.id, serial: plan.serial, status: plan.status, statusLabel: DEV_STATUS_AR[plan.status], percent: this.progressOf(plan.items).percent } : null,
        };
      });
      const backup = j.backupJobId ? jm.get(j.backupJobId) : undefined;
      const backupHolders = backup ? holders(backup.id) : [];
      // بدون بديل: لا وظيفة بديلة ولا مرشح، أو وظيفة بديلة شاغرة بلا مرشح
      const covered = list.length > 0 || backupHolders.length > 0;
      return {
        jobId: j.id, code: j.code, title: j.title, unitName: um.get(j.unitId) ?? '', headcount: j.headcount, holders: holders(j.id), leader: !!jobs.some((x) => x.reportsToJobId === j.id),
        backupJobId: j.backupJobId, backupJobTitle: backup?.title ?? null, backupHolders, candidates: list,
        status: !covered ? 'none' : list.some((c) => c.readiness === 'now') ? 'ready' : 'developing',
      };
    });
    return {
      rows,
      totals: {
        jobs: rows.length, none: rows.filter((r) => r.status === 'none').length, ready: rows.filter((r) => r.status === 'ready').length,
        candidates: new Set(cands.map((c) => c.employeeId)).size, leadersWithout: rows.filter((r) => r.leader && r.status === 'none').length,
      },
      employees: emps.sort((a, b) => a.employeeNo - b.employeeNo).map((e) => ({ id: e.id, fullName: e.fullName, jobId: e.jobId, jobTitle: jm.get(e.jobId)?.title ?? '' })),
    };
  }

  async setBackup(actor: OrgUser, jobId: string, dto: SuccessionJobDto) {
    const org = actor.organizationId;
    const repo = this.db.getRepository(HrJob);
    const j = await repo.findOne({ where: { id: jobId, organizationId: org } });
    if (!j) throw new NotFoundException('الوظيفة غير موجودة');
    if (dto.backupJobId) {
      if (dto.backupJobId === jobId) throw new BadRequestException('لا تكون الوظيفة بديلة لنفسها');
      if (!(await repo.exist({ where: { id: dto.backupJobId, organizationId: org } }))) throw new NotFoundException('الوظيفة البديلة غير موجودة');
    }
    await repo.update({ id: jobId }, { backupJobId: dto.backupJobId ?? null });
    return this.succession(actor);
  }

  async addCandidate(actor: OrgUser, jobId: string, dto: CandidateDto) {
    const org = actor.organizationId;
    const j = await this.db.getRepository(HrJob).findOne({ where: { id: jobId, organizationId: org } });
    if (!j) throw new NotFoundException('الوظيفة غير موجودة');
    const e = await this.db.getRepository(HrEmployee).findOne({ where: { id: dto.employeeId, organizationId: org } });
    if (!e || e.status !== 'active') throw new NotFoundException('الموظف غير موجود أو منتهية خدمته');
    if (e.jobId === jobId) throw new BadRequestException(`${e.fullName} يشغل هذه الوظيفة فعلًا`);
    const repo = this.db.getRepository(HrSuccessionCandidate);
    const old = await repo.findOne({ where: { organizationId: org, jobId, employeeId: e.id } });
    if (old) await repo.update({ id: old.id }, { readiness: dto.readiness, note: dto.note ?? null });
    else await repo.save(repo.create({ organizationId: org, jobId, employeeId: e.id, readiness: dto.readiness, note: dto.note ?? null }));
    return this.succession(actor);
  }

  async removeCandidate(actor: OrgUser, id: string) {
    const repo = this.db.getRepository(HrSuccessionCandidate);
    const c = await repo.findOne({ where: { id, organizationId: actor.organizationId } });
    if (!c) throw new NotFoundException('المرشح غير موجود');
    await repo.delete({ id });
    return this.succession(actor);
  }
}
