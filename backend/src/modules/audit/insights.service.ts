import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { OrgUser } from '../../core/auth/decorators';
import { ACTION_STATUS_AR, AuditCore, ENG_STATUS_AR, LEVEL_AR, OPINION_AR, addDays, daysBetween, today } from './audit-core.service';
import { PlanningService } from './planning.service';

type Row = Record<string, unknown>;
const LEVELS = ['critical', 'high', 'medium', 'low'] as const;

/** لوحة المعلومات وتقارير المراجعة الداخلية */
@Injectable()
export class InsightsService {
  constructor(private readonly db: DataSource, private readonly core: AuditCore, private readonly planning: PlanningService) {}

  private async actionsOf(org: string) {
    return (await this.db.query(
      `SELECT a.id, a.code, a.title, a.priority, a.status, a.due_date::text AS due, a.original_due_date::text AS original_due, a.start_date::text AS start,
              a.closed_at, a.responsible_unit_id AS unit, a.assignee_name, a.progress, e.code AS eng_code, p.year
       FROM audit_actions a JOIN audit_engagements e ON e.id = a.engagement_id JOIN audit_plans p ON p.id = e.plan_id
       WHERE a.organization_id = $1 AND a.status <> 'cancelled'`, [org])) as {
      id: string; code: string; title: string; priority: string; status: string; due: string; original_due: string; start: string; closed_at: Date | null;
      unit: string; assignee_name: string | null; progress: number; eng_code: string; year: number;
    }[];
  }

  async dashboard(actor: OrgUser, year: number) {
    const org = actor.organizationId;
    const t = today();
    const s = await this.core.settings(org);
    const [engs, actions, findings, areas, units, risks] = await Promise.all([
      this.db.query(
        `SELECT e.id, e.code, e.title, e.status, e.priority, e.planned_start::text AS ps, e.planned_end::text AS pe, e.lead_name, e.budget_hours, e.actual_hours, e.risk_refs
         FROM audit_engagements e JOIN audit_plans p ON p.id = e.plan_id WHERE e.organization_id = $1 AND p.year = $2 AND e.status <> 'cancelled'
         ORDER BY e.planned_start`, [org, year]) as Promise<{ id: string; code: string; title: string; status: string; priority: string; ps: string; pe: string; lead_name: string | null; budget_hours: number; actual_hours: number; risk_refs: { id: string }[] }[]>,
      this.actionsOf(org),
      this.db.query(
        `SELECT f.rating, COUNT(*)::int AS n FROM audit_findings f JOIN audit_engagements e ON e.id = f.engagement_id JOIN audit_plans p ON p.id = e.plan_id
         WHERE f.organization_id = $1 AND p.year = $2 GROUP BY 1`, [org, year]) as Promise<{ rating: string; n: number }[]>,
      this.planning.listAreas(actor),
      this.core.unitNames(org),
      this.core.risks(org),
    ]);
    const plans: { status: string; kind: string; code: string; title: string }[] = await this.db.query(
      'SELECT status, kind, code, title FROM audit_plans WHERE organization_id = $1 AND year = $2 ORDER BY kind, code', [org, year]);
    const open = actions.filter((a) => ['open', 'in_progress', 'submitted'].includes(a.status));
    const overdue = open.filter((a) => a.due < t);
    const closed = actions.filter((a) => a.status === 'closed');
    const closedOnTime = closed.filter((a) => a.closed_at && new Date(a.closed_at).toISOString().slice(0, 10) <= a.due).length;
    const avgClose = closed.length ? Math.round(closed.reduce((x, a) => x + daysBetween(a.start, new Date(a.closed_at!).toISOString().slice(0, 10)), 0) / closed.length) : null;
    const aging = [
      { label: 'حتى 30 يومًا', n: overdue.filter((a) => daysBetween(a.due, t) <= 30).length },
      { label: '31 ـ 60 يومًا', n: overdue.filter((a) => daysBetween(a.due, t) > 30 && daysBetween(a.due, t) <= 60).length },
      { label: '61 ـ 90 يومًا', n: overdue.filter((a) => daysBetween(a.due, t) > 60 && daysBetween(a.due, t) <= 90).length },
      { label: 'أكثر من 90 يومًا', n: overdue.filter((a) => daysBetween(a.due, t) > 90).length },
    ];
    const byUnit = new Map<string, { unit: string; open: number; overdue: number; closed: number }>();
    for (const a of actions) {
      const k = units.get(a.unit) ?? '—';
      const r = byUnit.get(k) ?? { unit: k, open: 0, overdue: 0, closed: 0 };
      if (a.status === 'closed') r.closed++;
      else { r.open++; if (a.due < t) r.overdue++; }
      byUnit.set(k, r);
    }
    // خريطة حرارة المجالات: الاحتمال × الأثر
    const heat: { likelihood: number; impact: number; areas: { code: string; name: string }[] }[] = [];
    for (let l = 5; l >= 1; l--) for (let i = 1; i <= 5; i++) heat.push({ likelihood: l, impact: i, areas: [] });
    for (const a of areas.filter((x) => x.isActive)) heat.find((h) => h.likelihood === a.likelihood && h.impact === a.impact)!.areas.push({ code: a.code, name: a.name });
    // تغطية المخاطر العالية في سجل المخاطر بمهام هذه السنة
    const covered = new Set(engs.flatMap((e) => e.risk_refs.map((r) => r.id)));
    const keyRisks = risks.filter((r) => ['high', 'critical'].includes(r.level) && r.status !== 'closed');
    return {
      year,
      plans: plans.map((p) => ({ ...p, statusLabel: { draft: 'مسودة', submitted: 'بانتظار الاعتماد', approved: 'معتمدة', closed: 'مغلقة' }[p.status] })),
      engagements: {
        total: engs.length,
        byStatus: Object.fromEntries(['planned', 'fieldwork', 'review', 'issued', 'closed'].map((st) => [st, engs.filter((e) => e.status === st).length])),
        completed: engs.filter((e) => ['issued', 'closed'].includes(e.status)).length,
        late: engs.filter((e) => ['planned', 'fieldwork', 'review'].includes(e.status) && e.pe < t).length,
        hours: { budget: engs.reduce((x, e) => x + e.budget_hours, 0), actual: engs.reduce((x, e) => x + e.actual_hours, 0) },
        upcoming: engs.filter((e) => ['planned', 'fieldwork', 'review'].includes(e.status)).slice(0, 6).map((e) => ({
          id: e.id, code: e.code, title: e.title, status: e.status, statusLabel: ENG_STATUS_AR[e.status], priority: e.priority, priorityLabel: LEVEL_AR[e.priority],
          plannedStart: e.ps, plannedEnd: e.pe, leadName: e.lead_name, late: e.pe < t,
        })),
      },
      actions: {
        total: actions.length, open: open.length, overdue: overdue.length, submitted: open.filter((a) => a.status === 'submitted').length, closed: closed.length,
        closureRate: actions.length ? Math.round((closed.length / actions.length) * 100) : 0,
        onTimeRate: closed.length ? Math.round((closedOnTime / closed.length) * 100) : null, avgDaysToClose: avgClose,
        extended: actions.filter((a) => a.due !== a.original_due).length, aging,
        dueSoon: open.filter((a) => a.due >= t && a.due <= addDays(t, s.reminderDays)).map((a) => ({
          id: a.id, code: a.code, title: a.title, due: a.due, unit: units.get(a.unit) ?? '—', priority: a.priority, priorityLabel: LEVEL_AR[a.priority], daysLeft: daysBetween(t, a.due),
        })),
        overdueList: overdue.sort((x, y) => x.due.localeCompare(y.due)).slice(0, 8).map((a) => ({
          id: a.id, code: a.code, title: a.title, due: a.due, unit: units.get(a.unit) ?? '—', priority: a.priority, priorityLabel: LEVEL_AR[a.priority], daysLate: daysBetween(a.due, t),
        })),
        byUnit: [...byUnit.values()].sort((x, y) => y.overdue - x.overdue || y.open - x.open),
      },
      findings: Object.fromEntries(LEVELS.map((l) => [l, findings.find((f) => f.rating === l)?.n ?? 0])),
      risk: {
        heat, registerAvailable: await this.core.registerAvailable(),
        areas: { total: areas.filter((a) => a.isActive).length, due: areas.filter((a) => a.isActive && a.isDue).length, byLevel: Object.fromEntries(LEVELS.map((l) => [l, areas.filter((a) => a.isActive && a.level === l).length])) },
        topAreas: areas.filter((a) => a.isActive).slice(0, 6).map((a) => ({ id: a.id, code: a.code, name: a.name, level: a.level, levelLabel: a.levelLabel, score: a.score, priority: a.priority, isDue: a.isDue, nextDue: a.nextDue })),
        keyRisks: keyRisks.length, keyRisksCovered: keyRisks.filter((r) => covered.has(r.id)).length,
        uncovered: keyRisks.filter((r) => !covered.has(r.id)).slice(0, 6).map((r) => ({ id: r.id, code: r.code, title: r.title, level: r.level, levelLabel: r.levelLabel ?? LEVEL_AR[r.level] ?? r.level, unitName: r.unitName ?? null })),
      },
    };
  }

  /** قسم التقارير: تنفيذ الخطة، التوصيات حسب الجهة، الملاحظات حسب الخطورة والمجال، تغطية المخاطر، والمتأخرات */
  async reports(actor: OrgUser, year: number) {
    const org = actor.organizationId;
    const t = today();
    const [plans, engs, findings, actions, units, risks, areas] = await Promise.all([
      this.planning.listPlans(actor, year),
      this.db.query(
        `SELECT e.id, e.code, e.title, e.status, e.priority, e.plan_id, e.planned_start::text AS ps, e.planned_end::text AS pe, e.actual_start::text AS "as", e.actual_end::text AS ae,
                e.budget_hours, e.actual_hours, e.lead_name, e.report_no, e.report_opinion, e.report_issued_at, e.risk_refs, e.scope_type, e.unit_id, e.outside_label, e.area_id
         FROM audit_engagements e JOIN audit_plans p ON p.id = e.plan_id WHERE e.organization_id = $1 AND p.year = $2 AND e.status <> 'cancelled'
         ORDER BY e.code`, [org, year]) as Promise<Row[]>,
      this.db.query(
        `SELECT f.rating, f.responsible_unit_id AS unit, a.category FROM audit_findings f JOIN audit_engagements e ON e.id = f.engagement_id
         JOIN audit_plans p ON p.id = e.plan_id LEFT JOIN audit_areas a ON a.id = e.area_id
         WHERE f.organization_id = $1 AND p.year = $2 AND e.status IN ('issued','closed')`, [org, year]) as Promise<{ rating: string; unit: string; category: string | null }[]>,
      this.actionsOf(org),
      this.core.unitNames(org),
      this.core.risks(org),
      this.planning.listAreas(actor),
    ]);
    const unitName = (id: unknown) => units.get(String(id)) ?? '—';
    const yearActions = actions.filter((a) => a.year === year);
    const byUnit = new Map<string, { unit: string; total: number; closed: number; open: number; overdue: number; submitted: number; extended: number }>();
    for (const a of yearActions) {
      const k = unitName(a.unit);
      const r = byUnit.get(k) ?? { unit: k, total: 0, closed: 0, open: 0, overdue: 0, submitted: 0, extended: 0 };
      r.total++;
      if (a.status === 'closed') r.closed++;
      else { r.open++; if (a.due < t) r.overdue++; if (a.status === 'submitted') r.submitted++; }
      if (a.due !== a.original_due) r.extended++;
      byUnit.set(k, r);
    }
    const catLabels = (await this.core.lookups(actor)).labels.categories as Record<string, string>;
    const byCategory = new Map<string, Record<string, number>>();
    for (const f of findings) {
      const k = f.category ? catLabels[f.category] ?? f.category : 'بدون مجال';
      const r = byCategory.get(k) ?? { critical: 0, high: 0, medium: 0, low: 0 };
      r[f.rating]++;
      byCategory.set(k, r);
    }
    const covered = new Map<string, string[]>();
    for (const e of engs) for (const r of e.risk_refs as { id: string }[]) covered.set(r.id, [...(covered.get(r.id) ?? []), String(e.code)]);
    return {
      year,
      planExecution: plans.flatMap((m) => [m, ...m.subs]).map((p) => ({
        code: p.code, title: p.title, kind: p.kind, scopeLabel: p.scopeLabel, status: p.statusLabel, ...p.stats, availableHours: p.availableHours,
      })),
      engagements: engs.map((e) => ({
        id: e.id, code: e.code, title: e.title, status: ENG_STATUS_AR[String(e.status)], priority: LEVEL_AR[String(e.priority)],
        scopeLabel: e.scope_type === 'unit' ? unitName(e.unit_id) : e.outside_label, plannedStart: e.ps, plannedEnd: e.pe, actualStart: e.as, actualEnd: e.ae,
        budgetHours: e.budget_hours, actualHours: e.actual_hours, leadName: e.lead_name, reportNo: e.report_no,
        opinion: e.report_opinion ? OPINION_AR[String(e.report_opinion)] : null, late: ['planned', 'fieldwork', 'review'].includes(String(e.status)) && String(e.pe) < t,
      })),
      byUnit: [...byUnit.values()].map((r) => ({ ...r, closureRate: r.total ? Math.round((r.closed / r.total) * 100) : 0 })).sort((a, b) => b.overdue - a.overdue || b.total - a.total),
      findingsByCategory: [...byCategory.entries()].map(([category, r]) => ({ category, ...r, total: r.critical + r.high + r.medium + r.low })),
      findingsTotal: Object.fromEntries(LEVELS.map((l) => [l, findings.filter((f) => f.rating === l).length])),
      riskCoverage: {
        registerAvailable: await this.core.registerAvailable(),
        risks: risks.filter((r) => r.status !== 'closed').map((r) => ({
          code: r.code, title: r.title, level: r.level, levelLabel: r.levelLabel ?? LEVEL_AR[r.level] ?? r.level, score: r.score, unitName: r.unitName ?? null, engagements: covered.get(r.id) ?? [],
        })).sort((a, b) => (b.score ?? 0) - (a.score ?? 0)),
        areas: areas.filter((a) => a.isActive).map((a) => ({
          code: a.code, name: a.name, levelLabel: a.levelLabel, level: a.level, score: a.score, priority: a.priority, lastAuditDate: a.lastAuditDate, nextDue: a.nextDue, isDue: a.isDue,
          plannedThisYear: engs.some((e) => e.area_id === a.id),
        })),
      },
      overdue: actions.filter((a) => ['open', 'in_progress', 'submitted'].includes(a.status) && a.due < t).sort((x, y) => x.due.localeCompare(y.due)).map((a) => ({
        id: a.id, code: a.code, title: a.title, engagement: a.eng_code, unit: unitName(a.unit), assignee: a.assignee_name, priority: LEVEL_AR[a.priority],
        due: a.due, daysLate: daysBetween(a.due, t), progress: a.progress, status: ACTION_STATUS_AR[a.status],
      })),
    };
  }
}
