import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { OrgUser } from '../../core/auth/decorators';
import {
  RiskAnalysis, RiskAssessment, RiskChange, RiskContinuity, RiskControl, RiskCrisisEvent, RiskCrisisTeam, RiskItem, RiskObligation, RiskProcedure, RiskReview, RiskTask,
} from './entities/risk.entity';
import { criticality, levelOf, WfRecord } from './risk-calc';
import { RiskConfig, WfProcess } from './risk-defaults';
import { RiskCore, today } from './risk-core.service';

const count = <T>(rows: T[], key: (r: T) => string) => {
  const m = new Map<string, number>();
  for (const r of rows) m.set(key(r), (m.get(key(r)) ?? 0) + 1);
  return [...m.entries()].map(([k, n]) => ({ key: k, n })).sort((a, b) => b.n - a.n);
};

/** لوحة المعلومات والتقارير وصندوق الاعتمادات */
@Injectable()
export class RiskReportsService {
  constructor(private readonly db: DataSource, private readonly core: RiskCore) {}

  private heat(rows: RiskItem[], kind: 'inherent' | 'residual') {
    const grid = Array.from({ length: 5 }, () => Array<number>(5).fill(0));
    for (const r of rows) {
      const l = kind === 'inherent' ? r.inherentLikelihood : r.residualLikelihood;
      const i = kind === 'inherent' ? r.inherentImpact : r.residualImpact;
      grid[l - 1][i - 1] += 1;
    }
    return grid;
  }

  private async load(org: string) {
    const [risks, controls, obligations, changes, bia, tasks, events, teams, assessments] = await Promise.all([
      this.db.getRepository(RiskItem).find({ where: { organizationId: org } }),
      this.db.getRepository(RiskControl).find({ where: { organizationId: org, isActive: true } }),
      this.db.getRepository(RiskObligation).find({ where: { organizationId: org, isActive: true } }),
      this.db.getRepository(RiskChange).find({ where: { organizationId: org } }),
      this.db.getRepository(RiskContinuity).find({ where: { organizationId: org } }),
      this.db.getRepository(RiskTask).find({ where: { organizationId: org } }),
      this.db.getRepository(RiskCrisisEvent).find({ where: { organizationId: org }, order: { activatedAt: 'DESC' } }),
      this.db.getRepository(RiskCrisisTeam).find({ where: { organizationId: org } }),
      this.db.getRepository(RiskAssessment).find({ where: { organizationId: org, status: 'approved' } }),
    ]);
    return { risks, controls, obligations, changes, bia, tasks, events, teams, assessments };
  }

  async dashboard(actor: OrgUser) {
    const org = actor.organizationId;
    const cfg = await this.core.config(org);
    const d = await this.load(org);
    const t = today();
    const live = d.risks.filter((r) => r.riskState !== 'closed' && r.status !== 'rejected');
    const assessed = d.obligations.filter((o) => o.lastResult && o.lastResult !== 'not_applicable');
    const compliance = assessed.length ? Math.round((assessed.reduce((s, o) => s + (o.lastResult === 'compliant' ? 1 : o.lastResult === 'partial' ? 0.5 : 0), 0) / assessed.length) * 1000) / 10 : null;
    const openTasks = d.tasks.filter((x) => x.status === 'open' || x.status === 'in_progress');
    const lv = (s: number) => levelOf(cfg, s);
    const alerts: { kind: string; level: 'danger' | 'warning' | 'info'; text: string; link: string; date?: string | null }[] = [];
    for (const e of d.events.filter((e) => !e.closedAt)) alerts.push({ kind: 'crisis', level: 'danger', text: `أزمة قائمة: ${e.title}`, link: `/risk/crisis/event/${e.id}`, date: e.activatedAt.toISOString().slice(0, 10) });
    for (const r of live.filter((r) => r.residualScore >= lv(r.residualScore).min && lv(r.residualScore).key === cfg.levels[cfg.levels.length - 1].key)) {
      alerts.push({ kind: 'critical', level: 'danger', text: `${r.code} خطر ${lv(r.residualScore).name}: ${r.title}`, link: `/risk/register/${r.id}` });
    }
    for (const r of live.filter((r) => r.kris.some((k) => k.breached))) alerts.push({ kind: 'kri', level: 'danger', text: `${r.code} تجاوز مؤشر إنذار مبكر: ${r.kris.find((k) => k.breached)!.name}`, link: `/risk/register/${r.id}` });
    for (const r of live.filter((r) => r.nextReviewDate && r.nextReviewDate < t)) alerts.push({ kind: 'review', level: 'warning', text: `${r.code} تأخرت مراجعته: ${r.title}`, link: `/risk/register/${r.id}`, date: r.nextReviewDate });
    for (const o of d.obligations.filter((o) => o.nextDueDate && o.nextDueDate <= t)) alerts.push({ kind: 'compliance', level: 'warning', text: `${o.code} حان تقييم الامتثال: ${o.title}`, link: `/risk/compliance?id=${o.id}`, date: o.nextDueDate });
    for (const x of openTasks.filter((x) => x.dueDate < t)) alerts.push({ kind: 'task', level: 'warning', text: `مهمة متأخرة: ${x.title}`, link: '/risk/tasks', date: x.dueDate });
    return {
      risks: {
        total: live.length, aboveAppetite: live.filter((r) => r.residualScore > cfg.appetite).length, appetite: cfg.appetite,
        byLevel: cfg.levels.map((l) => ({ ...l, n: live.filter((r) => lv(r.residualScore).key === l.key).length })),
        bySource: count(live, (r) => r.source), heatResidual: this.heat(live, 'residual'), heatInherent: this.heat(live, 'inherent'),
        top: [...live].sort((a, b) => b.residualScore - a.residualScore).slice(0, 6).map((r) => ({ id: r.id, code: r.code, title: r.title, score: r.residualScore, level: lv(r.residualScore), ownerName: r.ownerName })),
        reviewOverdue: live.filter((r) => r.nextReviewDate && r.nextReviewDate < t).length,
        overdueActions: live.reduce((s, r) => s + r.actions.filter((a) => a.status !== 'done' && a.dueDate && a.dueDate < t).length, 0),
      },
      compliance: { rate: compliance, obligations: d.obligations.length, nonCompliant: d.obligations.filter((o) => o.lastResult === 'non_compliant').length, due: d.obligations.filter((o) => o.nextDueDate && o.nextDueDate <= t).length },
      changes: { open: d.changes.filter((c) => c.phase !== 'closed' && c.status !== 'rejected').length, inReview: d.changes.filter((c) => c.status === 'in_review').length, implementing: d.changes.filter((c) => c.phase === 'implementing').length },
      tasks: { open: openTasks.length, overdue: openTasks.filter((x) => x.dueDate < t).length, mine: openTasks.filter((x) => x.assigneeUserId === actor.id).length },
      continuity: { activities: d.bia.length, critical: d.bia.filter((b) => criticality(b.impacts, b.mtpdHours).value >= 4).length, teams: d.teams.length, activeCrises: d.events.filter((e) => !e.closedAt).length },
      controls: { total: d.controls.length, ineffective: d.controls.filter((c) => c.effectiveness === 'ineffective').length },
      pendingMine: (await this.approvals(actor)).length,
      alerts: alerts.slice(0, 40), alertsTotal: alerts.length,
    };
  }

  async reports(actor: OrgUser) {
    const org = actor.organizationId;
    const cfg = await this.core.config(org);
    const d = await this.load(org);
    const t = today();
    const live = d.risks.filter((r) => r.riskState !== 'closed' && r.status !== 'rejected');
    const lv = (s: number) => levelOf(cfg, s);
    const reviews = await this.db.getRepository(RiskReview).find({ where: { organizationId: org } });
    // اتجاه المخاطر: متوسط الدرجة المتبقية في آخر 12 شهرًا (آخر مراجعة لكل خطر حتى نهاية الشهر)
    const trend: { month: string; avg: number | null; n: number }[] = [];
    const now = new Date(`${t}T00:00:00Z`);
    for (let i = 11; i >= 0; i--) {
      const m = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i + 1, 0)).toISOString().slice(0, 10);
      const latest = new Map<string, RiskReview>();
      for (const r of reviews) if (r.reviewDate <= m) { const p = latest.get(r.riskId); if (!p || p.reviewDate <= r.reviewDate) latest.set(r.riskId, r); }
      const vals = [...latest.values()].map((r) => r.score);
      trend.push({ month: m.slice(0, 7), avg: vals.length ? Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 10) / 10 : null, n: vals.length });
    }
    const byAuthority = new Map<string, { authority: string; total: number; compliant: number; partial: number; non: number; notAssessed: number }>();
    for (const o of d.obligations) {
      const g = byAuthority.get(o.authority) ?? { authority: o.authority, total: 0, compliant: 0, partial: 0, non: 0, notAssessed: 0 };
      g.total += 1;
      if (o.lastResult === 'compliant') g.compliant += 1; else if (o.lastResult === 'partial') g.partial += 1;
      else if (o.lastResult === 'non_compliant') g.non += 1; else if (!o.lastResult) g.notAssessed += 1;
      byAuthority.set(o.authority, g);
    }
    const catName = new Map(cfg.categories.map((c) => [c.code, c.name]));
    const yearAgo = new Date(Date.now() - 365 * 86400000).toISOString().slice(0, 10);
    const approvedChanges = d.changes.filter((c) => c.approvedAt);
    const daysToApprove = approvedChanges.map((c) => {
      const sub = c.approvals.find((a) => a.action === 'submit');
      return sub ? (c.approvedAt!.getTime() - new Date(sub.at).getTime()) / 86400000 : 0;
    });
    return {
      generatedAt: new Date().toISOString(), config: { levels: cfg.levels, appetite: cfg.appetite, likelihood: cfg.likelihood, impact: cfg.impact },
      risks: {
        total: live.length, closed: d.risks.filter((r) => r.riskState === 'closed').length,
        heatInherent: this.heat(live, 'inherent'), heatResidual: this.heat(live, 'residual'),
        byCategory: count(live, (r) => r.category).map((x) => ({ ...x, name: catName.get(x.key) ?? x.key, avg: Math.round((live.filter((r) => r.category === x.key).reduce((s, r) => s + r.residualScore, 0) / x.n) * 10) / 10 })),
        bySource: count(live, (r) => r.source), byState: count(live, (r) => r.riskState), byTreatment: count(live, (r) => r.treatment),
        byLevel: cfg.levels.map((l) => ({ name: l.name, color: l.color, inherent: live.filter((r) => lv(r.inherentScore).key === l.key).length, residual: live.filter((r) => lv(r.residualScore).key === l.key).length })),
        reduction: live.length ? Math.round((1 - live.reduce((s, r) => s + r.residualScore, 0) / Math.max(1, live.reduce((s, r) => s + r.inherentScore, 0))) * 1000) / 10 : 0,
        aboveAppetite: live.filter((r) => r.residualScore > cfg.appetite).map((r) => ({ id: r.id, code: r.code, title: r.title, score: r.residualScore, treatment: r.treatment, ownerName: r.ownerName, level: lv(r.residualScore) })),
        top10: [...live].sort((a, b) => b.residualScore - a.residualScore).slice(0, 10).map((r) => ({ id: r.id, code: r.code, title: r.title, category: catName.get(r.category) ?? r.category, inherent: r.inherentScore, residual: r.residualScore, level: lv(r.residualScore), ownerName: r.ownerName, unitName: r.unitName })),
        overdueActions: live.flatMap((r) => r.actions.filter((a) => a.status !== 'done' && a.dueDate && a.dueDate < t).map((a) => ({ riskId: r.id, code: r.code, title: a.title, ownerName: a.ownerName, dueDate: a.dueDate }))),
        reviewOverdue: live.filter((r) => r.nextReviewDate && r.nextReviewDate < t).map((r) => ({ id: r.id, code: r.code, title: r.title, nextReviewDate: r.nextReviewDate, ownerName: r.ownerName })),
        kriBreaches: live.flatMap((r) => r.kris.filter((k) => k.breached).map((k) => ({ riskId: r.id, code: r.code, kri: k.name, threshold: k.threshold, current: k.current }))),
        byUnit: count(live.filter((r) => r.unitName), (r) => r.unitName!),
        trend,
      },
      controls: { byEffectiveness: count(d.controls, (c) => c.effectiveness), byType: count(d.controls, (c) => c.type), untested: d.controls.filter((c) => !c.lastTestDate || c.lastTestDate < yearAgo).length, total: d.controls.length },
      compliance: {
        byAuthority: [...byAuthority.values()].map((g) => ({ ...g, rate: g.total - g.notAssessed ? Math.round(((g.compliant + g.partial * 0.5) / (g.total - g.notAssessed)) * 1000) / 10 : null })),
        openGaps: d.assessments.filter((a) => (a.result === 'partial' || a.result === 'non_compliant') && !a.actionDone).map((a) => {
          const o = d.obligations.find((x) => x.id === a.obligationId);
          return { obligationId: a.obligationId, code: o?.code ?? '', title: o?.title ?? '', gaps: a.gaps, actionOwner: a.actionOwner, actionDueDate: a.actionDueDate, overdue: !!a.actionDueDate && a.actionDueDate < t };
        }),
      },
      changes: {
        byStatus: count(d.changes, (c) => c.status), byPhase: count(d.changes, (c) => c.phase), byType: count(d.changes, (c) => c.changeType),
        avgApprovalDays: daysToApprove.length ? Math.round((daysToApprove.reduce((a, b) => a + b, 0) / daysToApprove.length) * 10) / 10 : null,
        tasks: { total: d.tasks.filter((x) => x.sourceType === 'change').length, done: d.tasks.filter((x) => x.sourceType === 'change' && x.status === 'done').length, overdue: d.tasks.filter((x) => x.sourceType === 'change' && !['done', 'cancelled'].includes(x.status) && x.dueDate < t).length },
        tasksByUnit: count(d.tasks.filter((x) => x.unitName && !['done', 'cancelled'].includes(x.status)), (x) => x.unitName!),
      },
      continuity: {
        activities: d.bia.map((b) => ({ id: b.id, code: b.code, activity: b.activity, rtoHours: b.rtoHours, mtpdHours: b.mtpdHours, criticality: criticality(b.impacts, b.mtpdHours), lastTestDate: b.lastTestDate, untested: !b.lastTestDate || b.lastTestDate < yearAgo, status: b.status })).sort((a, b) => b.criticality.value - a.criticality.value),
        teams: d.teams.map((x) => ({ id: x.id, code: x.code, name: x.name, members: x.members.length, status: x.status })),
        events: d.events.slice(0, 20).map((e) => ({ id: e.id, code: e.code, title: e.title, severity: e.severity, activatedAt: e.activatedAt, closedAt: e.closedAt })),
      },
    };
  }

  /** كل العناصر التي بانتظار قرار المستخدم الحالي، من كل الأنواع */
  async approvals(actor: OrgUser) {
    const org = actor.organizationId;
    const cfg = await this.core.config(org);
    const out: { process: WfProcess; id: string; code: string; title: string; stageName: string | null; link: string; submittedAt: string | null; byName: string | null }[] = [];
    const add = async (process: WfProcess, rows: (WfRecord & { id: string; code: string })[], title: (r: never) => string, link: (r: never) => string) => {
      const stage = await this.core.stageInfo(actor, process, cfg);
      for (const r of rows) {
        const s = stage(r);
        if (!s.canDecide) continue;
        const sub = [...r.approvals].reverse().find((a) => a.action === 'submit');
        out.push({ process, id: r.id, code: r.code, title: title(r as never), stageName: s.stageName, link: link(r as never), submittedAt: sub?.at ?? null, byName: sub?.byName ?? null });
      }
    };
    const w = { organizationId: org, status: 'in_review' as const };
    const [risks, analyses, changes, assess, bia, teams, procs] = await Promise.all([
      this.db.getRepository(RiskItem).find({ where: w }), this.db.getRepository(RiskAnalysis).find({ where: w }), this.db.getRepository(RiskChange).find({ where: w }),
      this.db.getRepository(RiskAssessment).find({ where: w }), this.db.getRepository(RiskContinuity).find({ where: w }), this.db.getRepository(RiskCrisisTeam).find({ where: w }),
      this.db.getRepository(RiskProcedure).find({ where: w }),
    ]);
    const obl = assess.length ? await this.db.getRepository(RiskObligation).find({ where: { organizationId: org } }) : [];
    await add('risk', risks, (r: RiskItem) => r.title, (r: RiskItem) => `/risk/register/${r.id}`);
    await add('analysis', analyses, (r: RiskAnalysis) => r.title, (r: RiskAnalysis) => `/risk/analysis/${r.id}`);
    await add('change', changes, (r: RiskChange) => r.title, (r: RiskChange) => `/risk/changes/${r.id}`);
    await add('compliance', assess, (r: RiskAssessment) => `تقييم: ${obl.find((o) => o.id === r.obligationId)?.title ?? ''}`, (r: RiskAssessment) => `/risk/compliance?id=${r.obligationId}`);
    await add('continuity', bia, (r: RiskContinuity) => r.activity, (r: RiskContinuity) => `/risk/continuity/${r.id}`);
    await add('crisis', teams, (r: RiskCrisisTeam) => r.name, (r: RiskCrisisTeam) => `/risk/crisis/${r.id}`);
    await add('procedure', procs, (r: RiskProcedure) => r.name, (r: RiskProcedure) => `/risk/procedures/${r.id}`);
    return out.sort((a, b) => (a.submittedAt ?? '').localeCompare(b.submittedAt ?? ''));
  }
}

/**
 * واجهة الربط مع نظام المراجعة الداخلية (وحدة audit): تُسجَّل بالتوكن 'RISK_REGISTER_LOOKUP'
 * وتقرأ منها وحدة المراجعة سجل المخاطر والضوابط وعالم المراجعة دون الكتابة في جداول هذه الوحدة.
 */
@Injectable()
export class RiskAuditBridge {
  constructor(private readonly db: DataSource, private readonly core: RiskCore) {}

  async listRisks(orgId: string) {
    const cfg: RiskConfig = await this.core.config(orgId);
    const rows = await this.db.getRepository(RiskItem).find({ where: { organizationId: orgId }, order: { residualScore: 'DESC', code: 'ASC' } });
    return rows.filter((r) => r.status !== 'rejected').map((r) => {
      const l = levelOf(cfg, r.residualScore);
      return {
        id: r.id, code: r.code, title: r.title, category: r.category, unitId: r.unitId, unitName: r.unitName,
        likelihood: r.residualLikelihood, impact: r.residualImpact, score: r.residualScore, level: l.key, levelLabel: l.name, status: r.riskState,
      };
    });
  }

  async listControls(orgId: string) {
    const rows = await this.db.getRepository(RiskControl).find({ where: { organizationId: orgId, isActive: true }, order: { code: 'ASC' } });
    return rows.map((c) => ({ id: c.id, code: c.code, name: c.name, type: c.type, effectiveness: c.effectiveness, riskIds: c.riskIds }));
  }

  /** عالم المراجعة: كل العناصر القابلة للمراجعة برموزها الثابتة */
  async auditUniverse(orgId: string) {
    const [risks, controls, obligations, procedures, bia] = await Promise.all([
      this.listRisks(orgId), this.listControls(orgId),
      this.db.getRepository(RiskObligation).find({ where: { organizationId: orgId, isActive: true } }),
      this.db.getRepository(RiskProcedure).find({ where: { organizationId: orgId, status: 'approved' } }),
      this.db.getRepository(RiskContinuity).find({ where: { organizationId: orgId } }),
    ]);
    return [
      ...risks.map((r) => ({ type: 'risk', id: r.id, code: r.code, title: r.title, owner: r.unitName, rating: r.levelLabel, score: r.score })),
      ...controls.map((c) => ({ type: 'control', id: c.id, code: c.code, title: c.name, owner: null, rating: c.effectiveness, score: null })),
      ...obligations.map((o) => ({ type: 'obligation', id: o.id, code: o.code, title: o.title, owner: o.ownerName, rating: o.lastResult, score: null })),
      ...procedures.map((p) => ({ type: 'procedure', id: p.id, code: p.code, title: p.name, owner: p.ownerName, rating: `Rev.${p.revision}`, score: null })),
      ...bia.map((b) => ({ type: 'continuity', id: b.id, code: b.code, title: b.activity, owner: b.unitName, rating: criticality(b.impacts, b.mtpdHours).name, score: null })),
    ];
  }
}
