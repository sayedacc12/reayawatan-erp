import { Injectable } from '@nestjs/common';
import { DataSource, In } from 'typeorm';
import { Plan, PlanItem, PlanKpi, PlanKpiReading, PlanLink } from './entities/planning.entity';
import { achievement, band, Band, performance, periodEnd, periodsOf, Rolled, rollup, yearActual, yearTarget } from './planning-calc';
import { PlanningCore, today } from './planning-core.service';
import { PlanningConfig } from './planning-defaults';

export interface KpiStat {
  year: number; target: number | null; actual: number | null; ach: number | null; band: Band | null;
  series: { year: number; target: number | null; actual: number | null; ach: number | null }[];
  /** فترات انتهت بلا قراءة */
  missing: string[];
  readings: { period: string; value: number; note: string | null; enteredByName: string; updatedAt: Date }[];
}

export interface OrgAnalysis {
  cfg: PlanningConfig;
  asOf: string;
  year: number;
  plans: Map<string, Plan>;
  items: PlanItem[];
  itemById: Map<string, PlanItem>;
  links: PlanLink[];
  kpis: PlanKpi[];
  rolled: Map<string, Rolled>;
  perf: Map<string, number | null>;
  kpiStat: Map<string, KpiStat>;
}

/** السنة المعتبرة لخطة: السنة الحالية إن كانت ضمن مدتها، وإلا أقرب سنة فيها */
export const planYear = (p: Pick<Plan, 'startYear' | 'endYear'>, year: number) => Math.min(p.endYear, Math.max(p.startYear, year));

/**
 * تحليل بيانات التخطيط في الجمعية دفعة واحدة: الإنجاز المجمع (عبر الهيكل والعلاقات بين الخطط)، والتكاليف،
 * وتحقق المؤشرات. يُستخدم في الشاشات والتقارير واللوحة حتى تكون الأرقام واحدة في كل مكان.
 */
@Injectable()
export class PlanningAnalysis {
  constructor(private readonly db: DataSource, private readonly core: PlanningCore) {}

  async analyze(org: string, asOf = today()): Promise<OrgAnalysis> {
    const cfg = await this.core.config(org);
    const year = Number(asOf.slice(0, 4));
    const [plans, items, links, kpis] = await Promise.all([
      this.db.getRepository(Plan).find({ where: { organizationId: org } }),
      this.db.getRepository(PlanItem).find({ where: { organizationId: org }, order: { sortOrder: 'ASC', code: 'ASC' } }),
      this.db.getRepository(PlanLink).find({ where: { organizationId: org } }),
      this.db.getRepository(PlanKpi).find({ where: { organizationId: org }, order: { sortOrder: 'ASC', code: 'ASC' } }),
    ]);
    const readings = kpis.length
      ? await this.db.getRepository(PlanKpiReading).find({ where: { organizationId: org, kpiId: In(kpis.map((k) => k.id)) }, order: { period: 'ASC' } })
      : [];
    const planMap = new Map(plans.map((p) => [p.id, p]));
    const rolled = rollup(items, links, asOf, cfg.delayTolerance);
    const kpiStat = new Map<string, KpiStat>();
    const scores = new Map<string, { weight: number; ach: number | null }[]>();
    for (const k of kpis) {
      const plan = planMap.get(k.planId);
      if (!plan) continue;
      const rs = readings.filter((r) => r.kpiId === k.id);
      const y = planYear(plan, year);
      const series = [];
      for (let yy = plan.startYear; yy <= plan.endYear; yy++) {
        const t = yearTarget(k, yy), a = yearActual(k, rs, yy);
        series.push({ year: yy, target: t, actual: a, ach: achievement(k.direction, a, t) });
      }
      const cur = series.find((s) => s.year === y)!;
      const missing = [];
      for (let yy = plan.startYear; yy <= Math.min(plan.endYear, year); yy++) {
        for (const p of periodsOf(yy, k.frequency)) if (periodEnd(p) < asOf && !rs.some((r) => r.period === p)) missing.push(p);
      }
      kpiStat.set(k.id, {
        year: y, target: cur?.target ?? null, actual: cur?.actual ?? null, ach: cur?.ach ?? null, band: band(cfg, cur?.ach ?? null), series, missing,
        readings: rs.map((r) => ({ period: r.period, value: r.value, note: r.note, enteredByName: r.enteredByName, updatedAt: r.updatedAt })),
      });
      if (k.itemId) scores.set(k.itemId, [...(scores.get(k.itemId) ?? []), { weight: k.weight, ach: cur?.ach ?? null }]);
    }
    const perf = performance(items, scores);
    return { cfg, asOf, year, plans: planMap, items, itemById: new Map(items.map((i) => [i.id, i])), links, kpis, rolled, perf, kpiStat };
  }

  /** ملخص خطة: الإنجاز الموزون لعناصر المستوى الأعلى، والتحقق، والتكلفة، وعدد المتأخر */
  summary(a: OrgAnalysis, plan: Plan) {
    const items = a.items.filter((i) => i.planId === plan.id);
    const roots = items.filter((i) => !i.parentId && i.state !== 'cancelled');
    const w = roots.map((r) => (r.weight > 0 ? r.weight : 0));
    const tw = w.reduce((s, x) => s + x, 0);
    const avg = (f: (id: string) => number | null) => {
      const xs = roots.map((r, i) => ({ v: f(r.id), w: tw ? w[i] : 1 })).filter((x) => x.v !== null);
      const sw = xs.reduce((s, x) => s + x.w, 0);
      return xs.length && sw ? Math.round((xs.reduce((s, x) => s + (x.v as number) * x.w, 0) / sw) * 10) / 10 : null;
    };
    const live = items.filter((i) => i.state !== 'cancelled');
    const leaves = live.filter((i) => !items.some((c) => c.parentId === i.id));
    const status = (s: string) => leaves.filter((i) => a.rolled.get(i.id)?.status === s).length;
    const y = planYear(plan, a.year);
    const kpis = a.kpis.filter((k) => k.planId === plan.id);
    return {
      items: items.length,
      kpis: kpis.length,
      progress: avg((id) => a.rolled.get(id)?.progress ?? null),
      planned: avg((id) => a.rolled.get(id)?.planned ?? null),
      performance: avg((id) => a.perf.get(id) ?? null),
      totalCost: Math.round(live.reduce((s, i) => s + i.plannedCost, 0) * 100) / 100,
      yearCost: Math.round(live.reduce((s, i) => s + (Number(i.costByYear[String(y)]) || 0), 0) * 100) / 100,
      year: y,
      delayed: status('delayed'),
      atRisk: status('at_risk'),
      completed: status('completed'),
      leaves: leaves.length,
      kpiBands: {
        green: kpis.filter((k) => a.kpiStat.get(k.id)?.band === 'green').length,
        amber: kpis.filter((k) => a.kpiStat.get(k.id)?.band === 'amber').length,
        red: kpis.filter((k) => a.kpiStat.get(k.id)?.band === 'red').length,
        none: kpis.filter((k) => !a.kpiStat.get(k.id)?.band).length,
      },
      unowned: live.filter((i) => !i.ownerName).length,
    };
  }
}
