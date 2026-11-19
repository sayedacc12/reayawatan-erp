import { Injectable } from '@nestjs/common';
import { OrgUser } from '../../core/auth/decorators';
import { Plan } from './entities/planning.entity';
import { OrgAnalysis, planYear, PlanningAnalysis } from './planning-analysis.service';
import { canDecide, PERIOD_LABEL } from './planning-calc';
import { PlanningCore, today } from './planning-core.service';

const addDays = (d: string, n: number) => new Date(new Date(`${d}T00:00:00Z`).getTime() + n * 86400000).toISOString().slice(0, 10);

/** اللوحة وقائمة الاعتمادات ومتابعة التنفيذ وسجل المؤشرات */
@Injectable()
export class PlanningViews {
  constructor(private readonly core: PlanningCore, private readonly analysis: PlanningAnalysis) {}

  private brief(a: OrgAnalysis, p: Plan) {
    return {
      id: p.id, code: p.code, kind: p.kind, title: p.title, startYear: p.startYear, endYear: p.endYear, unitName: p.unitName, status: p.status, version: p.version,
      stageName: p.status === 'in_review' && p.stageIndex !== null ? p.wfStages[p.stageIndex]?.name ?? null : null, summary: this.analysis.summary(a, p),
    };
  }

  /** الخطط الفعالة في السنة: معتمدة (ولو قيد تعديل) وتغطي السنة */
  private active(a: OrgAnalysis, year: number) {
    return [...a.plans.values()].filter((p) => p.version > 0 && p.startYear <= year && p.endYear >= year);
  }

  async dashboard(actor: OrgUser, yearParam?: string) {
    const a = await this.analysis.analyze(actor.organizationId);
    const year = yearParam && /^\d{4}$/.test(yearParam) ? Number(yearParam) : a.year;
    const d = await this.core.decider(actor);
    const plans = [...a.plans.values()];
    const active = this.active(a, year);
    const strategic = active.filter((p) => p.kind === 'strategic').sort((x, y) => y.startYear - x.startYear)[0]
      ?? plans.filter((p) => p.kind === 'strategic' && p.status !== 'rejected' && p.startYear <= year && p.endYear >= year)[0] ?? null;
    const pillars = strategic ? a.items.filter((i) => i.planId === strategic.id && !i.parentId).map((i) => {
      const r = a.rolled.get(i.id)!;
      return { id: i.id, code: i.code, title: i.title, progress: r.progress, planned: r.planned, performance: a.perf.get(i.id) ?? null, cost: r.cost, status: r.status,
        children: a.items.filter((c) => c.parentId === i.id).length };
    }) : [];
    const operational = active.filter((p) => p.kind === 'operational').map((p) => this.brief(a, p)).sort((x, y) => (x.summary.progress ?? 0) - (y.summary.progress ?? 0));
    const activeIds = new Set(active.map((p) => p.id));
    const leaves = a.items.filter((i) => activeIds.has(i.planId) && !a.items.some((c) => c.parentId === i.id));
    const status = (s: string) => leaves.filter((i) => a.rolled.get(i.id)?.status === s);
    const kpis = a.kpis.filter((k) => activeIds.has(k.planId));
    const bands = { green: 0, amber: 0, red: 0, none: 0 };
    for (const k of kpis) bands[a.kpiStat.get(k.id)?.band ?? 'none'] += 1;
    const alerts: { level: 'danger' | 'warning' | 'info'; kind: string; text: string; link: string; date: string | null }[] = [];
    const planOf = (id: string) => a.plans.get(id)!;
    for (const i of status('delayed').slice(0, 15)) {
      const r = a.rolled.get(i.id)!;
      alerts.push({ level: 'danger', kind: 'delay', text: `${planOf(i.planId).code} · ${i.code} ${i.title}: إنجاز ${r.progress}% والمخطط ${r.planned ?? 0}%`, link: `/planning/plans/${i.planId}?item=${i.id}`, date: i.endDate });
    }
    const soon = addDays(a.asOf, 14);
    for (const i of leaves) {
      for (const m of i.milestones) {
        if (!m.done && m.dueDate && m.dueDate <= soon && i.state !== 'cancelled' && i.state !== 'carried_over') {
          alerts.push({ level: m.dueDate < a.asOf ? 'danger' : 'warning', kind: 'milestone', text: `معلم «${m.title}» في ${i.code} ${i.title}`, link: `/planning/plans/${i.planId}?item=${i.id}`, date: m.dueDate });
        }
      }
    }
    for (const k of kpis) {
      const st = a.kpiStat.get(k.id);
      if (st?.missing.length) alerts.push({ level: 'info', kind: 'reading', text: `${k.code} ${k.name}: لا قراءة للفترة ${PERIOD_LABEL(st.missing[st.missing.length - 1])}${st.missing.length > 1 ? ` و${st.missing.length - 1} فترات أخرى` : ''}`, link: `/planning/kpis?kpi=${k.id}`, date: null });
    }
    for (const p of plans.filter((x) => x.status === 'returned')) {
      alerts.push({ level: 'warning', kind: 'returned', text: `${p.code} ${p.title}: أُعيدت للتعديل`, link: `/planning/plans/${p.id}`, date: null });
    }
    const unowned = leaves.filter((i) => !i.ownerName && i.state !== 'cancelled' && i.state !== 'carried_over').length;
    if (unowned) alerts.push({ level: 'info', kind: 'owner', text: `${unowned} نشاطًا أو عنصرًا بلا مسؤول محدد`, link: '/planning/execution?owner=none', date: null });
    const order = { danger: 0, warning: 1, info: 2 };
    alerts.sort((x, y) => order[x.level] - order[y.level] || (x.date ?? '9').localeCompare(y.date ?? '9'));
    const yearCost = (kind: string) => Math.round(active.filter((p) => p.kind === kind).reduce((s, p) =>
      s + a.items.filter((i) => i.planId === p.id && i.state !== 'cancelled').reduce((t, i) => t + (Number(i.costByYear[String(year)]) || 0), 0), 0));
    return {
      year, asOf: a.asOf,
      strategic: strategic ? { ...this.brief(a, strategic), vision: strategic.vision, mission: strategic.mission, values: strategic.values, levels: strategic.levels, pillars } : null,
      operational,
      counts: {
        strategic: plans.filter((p) => p.kind === 'strategic').length, operational: plans.filter((p) => p.kind === 'operational').length,
        inReview: plans.filter((p) => p.status === 'in_review').length, drafts: plans.filter((p) => p.status === 'draft' || p.status === 'returned').length,
        pendingMine: plans.filter((p) => canDecide(p, d)).length,
      },
      execution: {
        total: leaves.filter((i) => i.state !== 'cancelled' && i.state !== 'carried_over').length, completed: status('completed').length, onTrack: status('on_track').length,
        atRisk: status('at_risk').length, delayed: status('delayed').length, notStarted: status('not_started').length + status('no_schedule').length,
      },
      kpis: { total: kpis.length, ...bands },
      cost: { strategic: yearCost('strategic'), operational: yearCost('operational') },
      alerts: alerts.slice(0, 40), alertsTotal: alerts.length,
    };
  }

  async approvals(actor: OrgUser) {
    const a = await this.analysis.analyze(actor.organizationId);
    const d = await this.core.decider(actor);
    const plans = [...a.plans.values()].filter((p) => p.status === 'in_review');
    return plans.map((p) => ({ ...this.brief(a, p), canDecide: canDecide(p, d), routeName: p.routeName, revisionNote: p.revisionNote, submittedAt: [...p.approvals].reverse().find((x) => x.action === 'submit')?.at ?? null }))
      .sort((x, y) => Number(y.canDecide) - Number(x.canDecide));
  }

  /** متابعة التنفيذ: العناصر التنفيذية (بلا فروع) في الخطط الفعالة للسنة */
  async execution(actor: OrgUser, f: { year?: string; planId?: string; unitId?: string; status?: string; owner?: string; kind?: string }) {
    const a = await this.analysis.analyze(actor.organizationId);
    const year = f.year && /^\d{4}$/.test(f.year) ? Number(f.year) : a.year;
    const plans = this.active(a, year).filter((p) => (!f.planId || p.id === f.planId) && (!f.kind || p.kind === f.kind));
    const ids = new Set(plans.map((p) => p.id));
    const incoming = new Set(a.links.map((l) => l.toItemId));
    const rows = a.items.filter((i) => ids.has(i.planId) && !a.items.some((c) => c.parentId === i.id) && !incoming.has(i.id))
      .filter((i) => !f.unitId || i.unitId === f.unitId || a.plans.get(i.planId)!.unitId === f.unitId)
      .filter((i) => !f.owner || (f.owner === 'none' ? !i.ownerName : i.ownerName === f.owner))
      .map((i) => {
        const p = a.plans.get(i.planId)!;
        const r = a.rolled.get(i.id)!;
        const parent = i.parentId ? a.itemById.get(i.parentId) : null;
        return {
          id: i.id, code: i.code, title: i.title, planId: p.id, planCode: p.code, planTitle: p.title, planKind: p.kind, levelName: p.levels[i.level]?.name ?? '',
          parent: parent ? `${parent.code} ${parent.title}` : null, unitName: i.unitName ?? p.unitName, ownerName: i.ownerName, startDate: i.startDate, endDate: i.endDate,
          progress: i.progress, planned: r.planned, status: r.status, state: i.state, cost: i.plannedCost, yearCost: Number(i.costByYear[String(year)]) || 0,
          milestones: i.milestones, progressNote: i.progressNote, correctiveAction: i.correctiveAction, progressUpdatedAt: i.progressUpdatedAt,
          contributesTo: a.links.filter((l) => l.fromItemId === i.id).map((l) => a.itemById.get(l.toItemId)).filter(Boolean).map((t) => `${t!.code} ${t!.title}`),
        };
      })
      .filter((r) => !f.status || r.status === f.status);
    rows.sort((x, y) => (['delayed', 'at_risk'].indexOf(y.status) - ['delayed', 'at_risk'].indexOf(x.status)) || x.planCode.localeCompare(y.planCode) || x.code.localeCompare(y.code));
    return { year, plans: plans.map((p) => ({ id: p.id, code: p.code, title: p.title, kind: p.kind })), rows };
  }

  async kpis(actor: OrgUser, f: { planId?: string; band?: string }) {
    const a = await this.analysis.analyze(actor.organizationId);
    return a.kpis.filter((k) => (!f.planId || k.planId === f.planId) && a.plans.get(k.planId)?.status !== 'rejected').map((k) => {
      const p = a.plans.get(k.planId)!;
      const it = k.itemId ? a.itemById.get(k.itemId) : null;
      return { ...k, plan: { id: p.id, code: p.code, title: p.title, kind: p.kind, version: p.version, startYear: p.startYear, endYear: p.endYear }, item: it ? { id: it.id, code: it.code, title: it.title } : null, stat: a.kpiStat.get(k.id), year: planYear(p, a.year) };
    }).filter((k) => !f.band || (k.stat?.band ?? 'none') === f.band);
  }

  todayYear() { return Number(today().slice(0, 4)); }
}
