import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import { OrgUser } from '../../core/auth/decorators';
import { AreaDto, DecisionDto, PlanDto, SuggestDto } from './audit.dto';
import {
  AuditCore, CATEGORY_AR, CONTROL_AR, CONTROL_FACTOR, ENG_STATUS_AR, LEVEL_AR, PLAN_STATUS_AR, RegisterRisk, addDays, today,
} from './audit-core.service';
import { AuditArea, AuditEngagement, AuditPlan, AuditSettings, RiskRef } from './entities/audit.entity';

const addMonths = (d: string, m: number) => {
  const x = new Date(`${d}T00:00:00Z`);
  x.setUTCMonth(x.getUTCMonth() + m);
  return x.toISOString().slice(0, 10);
};

/** يحدّث نسخة الخطر المحفوظة من سجل المخاطر الحي (المستوى والدرجة الحالية) */
export function liveRefs(refs: RiskRef[], live: Map<string, RegisterRisk>) {
  return refs.map((r) => {
    const l = live.get(r.id);
    return l ? { ...r, title: l.title, level: l.level, score: l.score, levelLabel: l.levelLabel ?? LEVEL_AR[l.level] ?? l.level, status: l.status ?? null, live: true }
      : { ...r, levelLabel: LEVEL_AR[r.level] ?? r.level, status: null, live: false };
  });
}

/** التخطيط المبني على المخاطر: مجالات المراجعة وتقييمها، والخطة الرئيسية والخطط الفرعية واعتمادها */
@Injectable()
export class PlanningService {
  constructor(
    private readonly db: DataSource,
    private readonly core: AuditCore,
    @InjectRepository(AuditArea) private readonly areas: Repository<AuditArea>,
    @InjectRepository(AuditPlan) private readonly plans: Repository<AuditPlan>,
    @InjectRepository(AuditEngagement) private readonly engagements: Repository<AuditEngagement>,
  ) {}

  // ---------------- مجالات المراجعة ----------------

  /** تقييم المجال: الدرجة والمستوى والأولوية بعد أثر الضوابط، وموعد المراجعة التالي حسب التكرار */
  assess(a: AuditArea, s: AuditSettings) {
    const score = a.likelihood * a.impact;
    const level = this.core.levelOf(s.riskBands, score);
    const priority = Math.round(score * CONTROL_FACTOR[a.controlRating] * 10) / 10;
    const months = s.frequency[level];
    const nextDue = a.lastAuditDate ? addMonths(a.lastAuditDate, months) : null;
    return { score, level, levelLabel: LEVEL_AR[level], priority, frequencyMonths: months, nextDue, isDue: !nextDue || nextDue <= addDays(today(), 90) };
  }

  async listAreas(actor: OrgUser) {
    const org = actor.organizationId;
    const [rows, s, units, risks] = await Promise.all([
      this.areas.find({ where: { organizationId: org }, order: { code: 'ASC' } }), this.core.settings(org), this.core.unitNames(org), this.core.risks(org),
    ]);
    const live = new Map(risks.map((r) => [r.id, r]));
    const counts: { area_id: string; n: number; open: number }[] = await this.db.query(
      `SELECT area_id, COUNT(*)::int AS n, COUNT(*) FILTER (WHERE status IN ('planned','fieldwork','review'))::int AS open
       FROM audit_engagements WHERE organization_id = $1 AND area_id IS NOT NULL AND status <> 'cancelled' GROUP BY 1`, [org]);
    const c = new Map(counts.map((x) => [x.area_id, x]));
    return rows.map((a) => ({
      id: a.id, code: a.code, name: a.name, category: a.category, categoryLabel: CATEGORY_AR[a.category] ?? a.category, scopeType: a.scopeType,
      unitId: a.unitId, unitName: a.unitId ? units.get(a.unitId) ?? null : null, outsideLabel: a.outsideLabel, description: a.description,
      likelihood: a.likelihood, impact: a.impact, controlRating: a.controlRating, controlLabel: CONTROL_AR[a.controlRating], lastAuditDate: a.lastAuditDate,
      isActive: a.isActive, riskRefs: liveRefs(a.riskRefs, live), engagements: c.get(a.id)?.n ?? 0, openEngagements: c.get(a.id)?.open ?? 0,
      ...this.assess(a, s),
    })).sort((x, y) => Number(y.isActive) - Number(x.isActive) || y.priority - x.priority);
  }

  private async areaFields(org: string, dto: AreaDto) {
    const scope = await this.core.checkScope(org, dto.scopeType, dto.unitId, dto.outsideLabel);
    return {
      code: dto.code.toUpperCase(), name: dto.name, category: dto.category, scopeType: dto.scopeType, ...scope, description: dto.description ?? null,
      likelihood: dto.likelihood, impact: dto.impact, controlRating: dto.controlRating as AuditArea['controlRating'], riskRefs: dto.riskRefs ?? [],
      lastAuditDate: dto.lastAuditDate ?? null, isActive: dto.isActive ?? true,
    };
  }

  async createArea(actor: OrgUser, dto: AreaDto) {
    const org = actor.organizationId;
    const f = await this.areaFields(org, dto);
    if (await this.areas.exist({ where: { organizationId: org, code: f.code } })) throw new ConflictException(`الرمز ${f.code} مستخدم لمجال آخر`);
    const a = await this.areas.save(this.areas.create({ ...f, organizationId: org }));
    return { id: a.id };
  }

  async updateArea(actor: OrgUser, id: string, dto: AreaDto) {
    const org = actor.organizationId;
    const a = (await this.areas.findOne({ where: { id, organizationId: org } })) ?? this.core.notFound('المجال');
    const f = await this.areaFields(org, dto);
    if (f.code !== a.code && (await this.areas.exist({ where: { organizationId: org, code: f.code } }))) throw new ConflictException(`الرمز ${f.code} مستخدم لمجال آخر`);
    Object.assign(a, f);
    await this.areas.save(a);
    return { id };
  }

  async removeArea(actor: OrgUser, id: string) {
    const org = actor.organizationId;
    (await this.areas.findOne({ where: { id, organizationId: org } })) ?? this.core.notFound('المجال');
    if (await this.engagements.exist({ where: { organizationId: org, areaId: id } })) throw new ConflictException('على المجال مهام مراجعة، أوقفه بدل حذفه');
    await this.areas.delete({ id, organizationId: org });
  }

  // ---------------- الخطط ----------------

  private async planStats(org: string, ids: string[]) {
    if (!ids.length) return new Map<string, { total: number; done: number; active: number; hours: number; actualHours: number; findings: number }>();
    const rows: { plan_id: string; total: number; done: number; active: number; hours: number; actual_hours: number }[] = await this.db.query(
      `SELECT plan_id, COUNT(*)::int AS total,
         COUNT(*) FILTER (WHERE status IN ('issued','closed'))::int AS done,
         COUNT(*) FILTER (WHERE status IN ('fieldwork','review'))::int AS active,
         COALESCE(SUM(budget_hours),0)::int AS hours, COALESCE(SUM(actual_hours),0)::int AS actual_hours
       FROM audit_engagements WHERE organization_id = $1 AND plan_id = ANY($2::uuid[]) AND status <> 'cancelled' GROUP BY 1`, [org, ids]);
    const f: { plan_id: string; n: number }[] = await this.db.query(
      `SELECT e.plan_id, COUNT(f.id)::int AS n FROM audit_findings f JOIN audit_engagements e ON e.id = f.engagement_id
       WHERE f.organization_id = $1 AND e.plan_id = ANY($2::uuid[]) AND e.status IN ('issued','closed') GROUP BY 1`, [org, ids]);
    const fm = new Map(f.map((x) => [x.plan_id, x.n]));
    return new Map(rows.map((r) => [r.plan_id, { total: r.total, done: r.done, active: r.active, hours: r.hours, actualHours: r.actual_hours, findings: fm.get(r.plan_id) ?? 0 }]));
  }

  private planView(p: AuditPlan, units: Map<string, string>, stats?: { total: number; done: number; active: number; hours: number; actualHours: number; findings: number }) {
    const st = stats ?? { total: 0, done: 0, active: 0, hours: 0, actualHours: 0, findings: 0 };
    return {
      id: p.id, code: p.code, kind: p.kind, parentId: p.parentId, year: p.year, title: p.title, scopeType: p.scopeType, unitId: p.unitId,
      scopeLabel: p.scopeType === 'unit' ? units.get(p.unitId ?? '') ?? '—' : p.scopeType === 'outside' ? p.outsideLabel : 'الجمعية كلها',
      outsideLabel: p.outsideLabel, periodFrom: p.periodFrom, periodTo: p.periodTo, objectives: p.objectives, methodology: p.methodology,
      availableHours: p.availableHours, riskRefs: p.riskRefs, status: p.status, statusLabel: PLAN_STATUS_AR[p.status], decisionNote: p.decisionNote,
      approvedByName: p.approvedByName, approvedAt: p.approvedAt, createdByName: p.createdByName, history: p.history,
      stats: { ...st, progress: st.total ? Math.round((st.done / st.total) * 100) : 0 },
    };
  }

  async listPlans(actor: OrgUser, year: number) {
    const org = actor.organizationId;
    const rows = await this.plans.find({ where: { organizationId: org, year }, order: { kind: 'ASC', code: 'ASC' } });
    const [units, stats] = await Promise.all([this.core.unitNames(org), this.planStats(org, rows.map((r) => r.id))]);
    const views = rows.map((p) => this.planView(p, units, stats.get(p.id)));
    return views.filter((p) => p.kind === 'master').map((m) => {
      const subs = views.filter((s) => s.parentId === m.id);
      const all = [m, ...subs];
      const total = all.reduce((a, p) => a + p.stats.total, 0);
      const done = all.reduce((a, p) => a + p.stats.done, 0);
      return { ...m, subs, overall: { total, done, progress: total ? Math.round((done / total) * 100) : 0, hours: all.reduce((a, p) => a + p.stats.hours, 0) } };
    });
  }

  async getPlan(actor: OrgUser, id: string) {
    const org = actor.organizationId;
    const p = (await this.plans.findOne({ where: { id, organizationId: org } })) ?? this.core.notFound('الخطة');
    const subs = p.kind === 'master' ? await this.plans.find({ where: { organizationId: org, parentId: id }, order: { code: 'ASC' } }) : [];
    const parent = p.parentId ? await this.plans.findOne({ where: { id: p.parentId } }) : null;
    const [units, stats, risks] = await Promise.all([this.core.unitNames(org), this.planStats(org, [p.id, ...subs.map((s) => s.id)]), this.core.risks(org)]);
    const live = new Map(risks.map((r) => [r.id, r]));
    const engs = await this.engagements.find({ where: { organizationId: org, planId: In([p.id, ...subs.map((s) => s.id)]) }, order: { plannedStart: 'ASC' } });
    return {
      ...this.planView(p, units, stats.get(p.id)), riskRefs: liveRefs(p.riskRefs, live),
      parent: parent ? { id: parent.id, code: parent.code, title: parent.title, status: parent.status } : null,
      subs: subs.map((s) => this.planView(s, units, stats.get(s.id))),
      engagements: engs.map((e) => ({
        id: e.id, code: e.code, planId: e.planId, title: e.title, priority: e.priority, priorityLabel: LEVEL_AR[e.priority], status: e.status, statusLabel: ENG_STATUS_AR[e.status],
        scopeLabel: e.scopeType === 'unit' ? units.get(e.unitId ?? '') ?? '—' : e.outsideLabel, plannedStart: e.plannedStart, plannedEnd: e.plannedEnd,
        leadName: e.leadName, budgetHours: e.budgetHours, riskRefs: e.riskRefs.length,
      })),
    };
  }

  private async planFields(org: string, dto: PlanDto, selfId?: string) {
    if (dto.periodTo < dto.periodFrom) throw new BadRequestException('نهاية فترة الخطة قبل بدايتها');
    let parentId: string | null = null;
    if (dto.kind === 'sub') {
      if (!dto.parentId) throw new BadRequestException('الخطة الفرعية تتبع خطة رئيسية، اخترها');
      const parent = (await this.plans.findOne({ where: { id: dto.parentId, organizationId: org } })) ?? this.core.notFound('الخطة الرئيسية');
      if (parent.kind !== 'master') throw new BadRequestException('اختر خطة رئيسية');
      if (parent.year !== dto.year) throw new BadRequestException('سنة الخطة الفرعية تختلف عن سنة الخطة الرئيسية');
      if (dto.periodFrom < parent.periodFrom || dto.periodTo > parent.periodTo) throw new BadRequestException('فترة الخطة الفرعية خارج فترة الخطة الرئيسية');
      if (parent.status === 'closed') throw new BadRequestException('الخطة الرئيسية مغلقة');
      if (dto.scopeType === 'org') throw new BadRequestException('الخطة الفرعية تكون على وحدة من الهيكل أو جهة خارجه');
      parentId = parent.id;
    } else {
      const other = await this.plans.findOne({ where: { organizationId: org, year: dto.year, kind: 'master' } });
      if (other && other.id !== selfId) throw new ConflictException(`للسنة ${dto.year} خطة رئيسية بالفعل (${other.code})، أضف خططًا فرعية تحتها`);
    }
    const scope = await this.core.checkScope(org, dto.scopeType, dto.unitId, dto.outsideLabel);
    return {
      kind: dto.kind, parentId, year: dto.year, title: dto.title, scopeType: dto.scopeType, ...scope, periodFrom: dto.periodFrom, periodTo: dto.periodTo,
      objectives: dto.objectives ?? null, methodology: dto.methodology ?? null, availableHours: dto.availableHours ?? 0, riskRefs: dto.riskRefs ?? [],
    };
  }

  private log(p: AuditPlan, actor: OrgUser, action: string, note?: string | null) {
    p.history = [...p.history, { at: new Date().toISOString(), by: actor.fullName, action, note: note ?? null }];
  }

  async createPlan(actor: OrgUser, dto: PlanDto) {
    const org = actor.organizationId;
    const f = await this.planFields(org, dto);
    return this.db.transaction(async (em) => {
      let code = `IAP-${dto.year}`;
      if (f.kind === 'sub') {
        const [{ n }] = await em.query('SELECT COUNT(*)::int AS n FROM audit_plans WHERE organization_id = $1 AND parent_id = $2', [org, f.parentId]);
        code = `IAP-${dto.year}-${String(n + 1).padStart(2, '0')}`;
        while (await em.getRepository(AuditPlan).exist({ where: { organizationId: org, code } })) code = `${code}A`;
      }
      const p = em.getRepository(AuditPlan).create({ ...f, organizationId: org, code, createdByName: actor.fullName, history: [] });
      this.log(p, actor, 'إنشاء الخطة');
      await em.getRepository(AuditPlan).save(p);
      return { id: p.id, code };
    });
  }

  async updatePlan(actor: OrgUser, id: string, dto: PlanDto) {
    const org = actor.organizationId;
    const p = (await this.plans.findOne({ where: { id, organizationId: org } })) ?? this.core.notFound('الخطة');
    if (p.status !== 'draft') throw new BadRequestException('لا تُعدَّل الخطة إلا وهي مسودة. أعدها للتعديل أولًا');
    if (dto.kind !== p.kind) throw new BadRequestException('لا يمكن تغيير نوع الخطة');
    const f = await this.planFields(org, dto, id);
    if (p.kind === 'master' && f.year !== p.year && (await this.plans.exist({ where: { organizationId: org, parentId: id } }))) {
      throw new BadRequestException('للخطة خطط فرعية، فلا تتغير سنتها');
    }
    Object.assign(p, f);
    this.log(p, actor, 'تعديل الخطة');
    await this.plans.save(p);
    return { id };
  }

  async removePlan(actor: OrgUser, id: string) {
    const org = actor.organizationId;
    const p = (await this.plans.findOne({ where: { id, organizationId: org } })) ?? this.core.notFound('الخطة');
    if (p.status !== 'draft') throw new BadRequestException('لا تُحذف إلا الخطة المسودة');
    if (await this.plans.exist({ where: { organizationId: org, parentId: id } })) throw new ConflictException('للخطة خطط فرعية، احذفها أولًا');
    if (await this.engagements.exist({ where: { organizationId: org, planId: id } })) throw new ConflictException('على الخطة مهام مراجعة، احذفها أولًا');
    await this.plans.delete({ id, organizationId: org });
  }

  async submitPlan(actor: OrgUser, id: string) {
    const p = (await this.plans.findOne({ where: { id, organizationId: actor.organizationId } })) ?? this.core.notFound('الخطة');
    if (p.status !== 'draft') throw new BadRequestException('الخطة ليست مسودة');
    if (!(await this.engagements.exist({ where: { organizationId: actor.organizationId, planId: id } })) && p.kind === 'sub') {
      throw new BadRequestException('أضف مهام المراجعة للخطة الفرعية قبل إرسالها للاعتماد');
    }
    p.status = 'submitted';
    p.decisionNote = null;
    this.log(p, actor, 'إرسال للاعتماد');
    await this.plans.save(p);
    return { id };
  }

  async decide(actor: OrgUser, id: string, dto: DecisionDto) {
    const org = actor.organizationId;
    const p = (await this.plans.findOne({ where: { id, organizationId: org } })) ?? this.core.notFound('الخطة');
    if (p.status !== 'submitted') throw new BadRequestException('الخطة ليست بانتظار الاعتماد');
    if (dto.decision === 'return') {
      if (!dto.note) throw new BadRequestException('اكتب سبب الإعادة');
      p.status = 'draft';
      p.decisionNote = dto.note;
      this.log(p, actor, 'إعادة للتعديل', dto.note);
    } else {
      if (p.parentId) {
        const parent = await this.plans.findOneOrFail({ where: { id: p.parentId } });
        if (parent.status !== 'approved') throw new BadRequestException(`اعتمد الخطة الرئيسية ${parent.code} أولًا`);
      }
      Object.assign(p, { status: 'approved', decisionNote: dto.note ?? null, approvedByName: actor.fullName, approvedAt: new Date() });
      this.log(p, actor, 'اعتماد الخطة', dto.note);
    }
    await this.plans.save(p);
    return { id };
  }

  /** إغلاق الخطة بعد انتهاء مهامها (أو نقل ما لم يُنفذ للسنة التالية يدويًا) */
  async closePlan(actor: OrgUser, id: string, note?: string | null) {
    const org = actor.organizationId;
    const p = (await this.plans.findOne({ where: { id, organizationId: org } })) ?? this.core.notFound('الخطة');
    if (p.status !== 'approved') throw new BadRequestException('لا تُغلق إلا الخطة المعتمدة');
    const [{ n }] = await this.db.query(
      `SELECT COUNT(*)::int AS n FROM audit_engagements WHERE organization_id = $1 AND plan_id = $2 AND status IN ('fieldwork','review')`, [org, id]);
    if (n) throw new BadRequestException(`على الخطة ${n} مهمة قيد التنفيذ`);
    if (p.kind === 'master' && (await this.plans.exist({ where: { organizationId: org, parentId: id, status: In(['draft', 'submitted', 'approved']) } }))) {
      throw new BadRequestException('أغلق الخطط الفرعية أولًا');
    }
    p.status = 'closed';
    this.log(p, actor, 'إغلاق الخطة', note);
    await this.plans.save(p);
    return { id };
  }

  /** إنشاء مهام مراجعة في الخطة من المجالات المختارة (الأعلى خطرًا والمستحقة)، موزعة على فترة الخطة */
  async suggest(actor: OrgUser, planId: string, dto: SuggestDto) {
    const org = actor.organizationId;
    const p = (await this.plans.findOne({ where: { id: planId, organizationId: org } })) ?? this.core.notFound('الخطة');
    if (p.status === 'closed') throw new BadRequestException('الخطة مغلقة');
    const s = await this.core.settings(org);
    const list = await this.areas.find({ where: { organizationId: org, id: In(dto.areaIds), isActive: true } });
    if (!list.length) throw new BadRequestException('اختر مجالًا واحدًا على الأقل');
    const sorted = list.map((a) => ({ a, r: this.assess(a, s) })).sort((x, y) => y.r.priority - x.r.priority);
    const span = Math.max(1, Math.floor((new Date(p.periodTo).getTime() - new Date(p.periodFrom).getTime()) / 86400000));
    const step = Math.max(14, Math.floor(span / sorted.length));
    const created: string[] = [];
    await this.db.transaction(async (em) => {
      for (const [i, { a, r }] of sorted.entries()) {
        const start = addDays(p.periodFrom, Math.min(i * step, span - 14 > 0 ? span - 14 : 0));
        const end = addDays(start, 21) > p.periodTo ? p.periodTo : addDays(start, 21);
        const no = await this.core.nextNo(em, org, 'nextEngagementNo');
        const e = em.getRepository(AuditEngagement).create({
          organizationId: org, code: `IA-${p.year}-${String(no).padStart(3, '0')}`, planId, areaId: a.id, title: `مراجعة ${a.name}`,
          objective: `التحقق من كفاية وفاعلية الضوابط في ${a.name} في ضوء المخاطر المرتبطة به`, scope: a.description,
          scopeType: a.scopeType === 'outside' ? 'outside' : 'unit', unitId: a.unitId, outsideLabel: a.outsideLabel, riskRefs: a.riskRefs, priority: r.level,
          plannedStart: start, plannedEnd: end, budgetHours: r.level === 'critical' ? 80 : r.level === 'high' ? 60 : 40, team: [],
          history: [{ at: new Date().toISOString(), by: actor.fullName, action: 'إنشاء المهمة من تقييم المخاطر' }],
        });
        await em.getRepository(AuditEngagement).save(e);
        created.push(e.id);
      }
    });
    return { created: created.length };
  }
}
