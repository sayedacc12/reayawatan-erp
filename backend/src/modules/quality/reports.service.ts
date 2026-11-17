import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { OrgUser } from '../../core/auth/decorators';
import { QmsAudit, QmsComplaint, QmsNcr, QmsReview } from './entities/quality.entity';
import { DocumentsService } from './documents.service';
import { FeedbackService } from './feedback.service';
import { ISO_CLAUSES, ISO_SECTIONS, REVIEW_INPUTS } from './iso-clauses';
import { AUDIT_RESULT_LABELS, ImprovementService, NCR_SOURCE_LABELS } from './improvement.service';
import { QmsCore, addDays, today } from './quality-core.service';

const avg = (xs: number[]) => (xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 10) / 10 : null);
const pct = (a: number, b: number) => (b ? Math.round((a / b) * 1000) / 10 : null);

/** لوحة الجودة، مصفوفة المطابقة لبنود المواصفة، تقرير الجودة الدوري، ومدخلات مراجعة الإدارة */
@Injectable()
export class ReportsService {
  constructor(
    private readonly db: DataSource,
    private readonly core: QmsCore,
    private readonly documents: DocumentsService,
    private readonly improvement: ImprovementService,
    private readonly feedback: FeedbackService,
  ) {}

  /** كل بيانات الجودة لفترة: أساس اللوحة والتقرير ومدخلات مراجعة الإدارة */
  async snapshot(actor: OrgUser, from: string, to: string) {
    const org = actor.organizationId;
    const inRange = (d: string | null | undefined) => !!d && d.slice(0, 10) >= from && d.slice(0, 10) <= to;
    const [docs, ncrsAll, risks, objectives, complaintsAll, surveys, audits, maps, ctx] = await Promise.all([
      this.documents.list(actor, {}), this.improvement.ncrs(actor, {}), this.improvement.risks(actor), this.improvement.objectives(actor),
      this.feedback.complaints(actor, {}), this.feedback.surveys(actor), this.improvement.audits(actor), this.documents.maps(actor), this.core.getContext(actor),
    ]);
    const ncrs = ncrsAll.filter((n) => inRange(n.detectedDate));
    const complaints = complaintsAll.rows.filter((c) => inRange(c.receivedDate));
    const periodAudits = audits.filter((a) => inRange(a.plannedDate));
    const scores: { score: string }[] = await this.db.query(
      `SELECT score FROM quality_survey_responses WHERE organization_id = $1 AND score IS NOT NULL AND created_at::date BETWEEN $2 AND $3`, [org, from, to]);
    const own = docs.rows.filter((d) => d.source === 'quality');
    const active = (x: { status: string }) => x.status !== 'closed';
    const sat = avg(scores.map((s) => Number(s.score)));
    const byGroup = <T>(rows: T[], key: (r: T) => string) => Object.entries(rows.reduce<Record<string, number>>((m, r) => ({ ...m, [key(r)]: (m[key(r)] ?? 0) + 1 }), {}))
      .map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count);
    const reviews = await this.db.getRepository(QmsReview).find({ where: { organizationId: org }, order: { meetingDate: 'DESC' } });
    return {
      period: { from, to },
      context: ctx,
      documents: {
        total: docs.counts.total, own: own.length, approved: docs.counts.approved, pending: docs.counts.pending, due: own.filter((d) => d.reviewDue).length,
        overdue: own.filter((d) => d.reviewOverdue).length, obsolete: docs.counts.obsolete, external: docs.counts.external, maps: maps.length,
        procedures: own.filter((d) => d.docType === 'procedure' && d.status !== 'obsolete').length,
        byType: byGroup(docs.rows.filter((d) => d.status !== 'obsolete'), (d) => d.typeLabel),
        changed: own.filter((d) => inRange(d.effectiveDate ?? undefined)).map((d) => ({ code: d.code, title: d.title, revisionLabel: d.revisionLabel })),
        dueList: own.filter((d) => d.reviewDue).map((d) => ({ id: d.id, code: d.code, title: d.title, nextReviewDate: d.nextReviewDate, overdue: d.reviewOverdue })),
        pendingAck: own.reduce((s, d) => s + d.pendingAck, 0),
      },
      ncr: {
        total: ncrs.length, open: ncrsAll.filter(active).length, closed: ncrs.filter((n) => n.status === 'closed').length, major: ncrs.filter((n) => n.severity === 'major').length,
        overdue: ncrsAll.filter((n) => n.overdue).length, overdueActions: ncrsAll.reduce((s, n) => s + n.overdueActions, 0),
        closureRate: pct(ncrs.filter((n) => n.status === 'closed').length, ncrs.length), avgDays: avg(ncrs.filter((n) => n.closedAt).map((n) => n.daysOpen)),
        bySource: byGroup(ncrs, (n) => NCR_SOURCE_LABELS[n.source]), byDepartment: byGroup(ncrs, (n) => n.departmentName),
        byStatus: byGroup(ncrsAll.filter(active), (n) => n.statusLabel),
        list: ncrsAll.filter((n) => inRange(n.detectedDate) || active(n)),
      },
      audits: {
        planned: periodAudits.filter((a) => a.status !== 'cancelled').length, completed: periodAudits.filter((a) => a.status === 'completed').length,
        overdue: audits.filter((a) => a.overdue).length, upcoming: audits.filter((a) => a.status === 'planned' && a.plannedDate >= today() && a.plannedDate <= addDays(today(), 30)),
        findings: Object.fromEntries(['minor', 'major', 'observation', 'ofi'].map((k) => [k, periodAudits.reduce((s, a) => s + a.findings[k as 'minor'], 0)])),
        list: periodAudits, resultLabels: AUDIT_RESULT_LABELS,
      },
      risks: {
        total: risks.length, risks: risks.filter((r) => r.kind === 'risk').length, opportunities: risks.filter((r) => r.kind === 'opportunity').length,
        high: risks.filter((r) => r.kind === 'risk' && r.level === 'high' && r.status !== 'closed').length,
        openActions: risks.reduce((s, r) => s + r.actionsOpen, 0), reviewDue: risks.filter((r) => r.reviewDue).length,
        heat: [5, 4, 3, 2, 1].map((l) => [1, 2, 3, 4, 5].map((i) => risks.filter((r) => r.kind === 'risk' && r.status !== 'closed' && r.likelihood === l && r.impact === i).length)),
        top: risks.filter((r) => r.kind === 'risk' && r.status !== 'closed').slice(0, 8),
      },
      objectives: {
        total: objectives.rows.filter((o) => o.isActive).length,
        achieved: objectives.rows.filter((o) => o.isActive && o.status === 'achieved').length,
        behind: objectives.rows.filter((o) => o.isActive && o.status === 'behind').length,
        list: objectives.rows.filter((o) => o.isActive && o.year >= Number(from.slice(0, 4)) && o.year <= Number(to.slice(0, 4))),
      },
      complaints: {
        total: complaints.length, open: complaintsAll.rows.filter((c) => c.status === 'received' || c.status === 'investigating').length,
        late: complaintsAll.rows.filter((c) => c.late).length, resolved: complaints.filter((c) => ['resolved', 'closed', 'rejected'].includes(c.status)).length,
        avgDays: avg(complaints.filter((c) => c.resolvedDate).map((c) => c.days)), targetDays: complaintsAll.targetDays,
        satisfaction: avg(complaints.map((c) => c.satisfaction).filter((x): x is number => x !== null)),
        toNcr: complaints.filter((c) => c.ncrId).length, byCategory: byGroup(complaints, (c) => c.category ?? 'غير مصنفة'),
        byChannel: byGroup(complaints, (c) => c.channelLabel), byParty: byGroup(complaints, (c) => c.partyLabel), pendingImports: complaintsAll.pendingImports,
      },
      satisfaction: { index: sat, responses: scores.length, surveys: surveys.map((s) => ({ id: s.id, title: s.title, audienceLabel: s.audienceLabel, responses: s.responses, index: s.index, status: s.status })) },
      reviews: {
        total: reviews.length, last: reviews[0] ? { id: reviews[0].id, title: reviews[0].title, meetingDate: reviews[0].meetingDate, status: reviews[0].status } : null,
        openOutputs: reviews.reduce((s, r) => s + r.outputs.filter((o) => o.status === 'open').length, 0),
      },
    };
  }

  private yearRange(year?: string) {
    const y = year && /^\d{4}$/.test(year) ? year : today().slice(0, 4);
    return { from: `${y}-01-01`, to: `${y}-12-31` };
  }

  async dashboard(actor: OrgUser, year?: string) {
    const { from, to } = this.yearRange(year);
    const s = await this.snapshot(actor, from, to);
    const t = today();
    const alerts: { level: 'danger' | 'warning' | 'info'; text: string; path: string }[] = [];
    for (const d of s.documents.dueList) alerts.push({ level: d.overdue ? 'danger' : 'warning', text: `${d.overdue ? 'تجاوزت' : 'تقترب'} الوثيقة ${d.code} موعد مراجعتها الدورية`, path: `/quality/documents/${d.id}` });
    for (const n of s.ncr.list.filter((x) => x.overdue || x.overdueActions)) alerts.push({ level: 'danger', text: `${n.code}: ${n.overdue ? 'تجاوزت موعد الإغلاق' : `${n.overdueActions} إجراء متأخر`}`, path: `/quality/ncr/${n.id}` });
    for (const a of s.audits.list.filter((x) => x.overdue)) alerts.push({ level: 'danger', text: `المراجعة الداخلية "${a.title}" متأخرة عن موعدها`, path: `/quality/audits/${a.id}` });
    for (const a of s.audits.upcoming) alerts.push({ level: 'info', text: `مراجعة داخلية "${a.title}" بتاريخ ${a.plannedDate}`, path: `/quality/audits/${a.id}` });
    if (s.complaints.late) alerts.push({ level: 'warning', text: `${s.complaints.late} شكوى تجاوزت مدة المعالجة المستهدفة`, path: '/quality/complaints' });
    if (s.complaints.pendingImports) alerts.push({ level: 'info', text: `${s.complaints.pendingImports} شكوى واردة من البوابات بانتظار تسجيلها في سجل الشكاوى`, path: '/quality/complaints' });
    if (s.risks.high) alerts.push({ level: 'warning', text: `${s.risks.high} خطر مرتفع لم يُغلق بعد`, path: '/quality/risks' });
    if (s.documents.pending) alerts.push({ level: 'info', text: `${s.documents.pending} وثيقة بانتظار المراجعة أو الاعتماد`, path: '/quality/documents?status=review' });
    const matrix = await this.standard(actor, s);
    return {
      year: Number(from.slice(0, 4)), today: t,
      kpis: {
        documents: s.documents.total, approvedDocs: s.documents.approved, openNcr: s.ncr.open, closureRate: s.ncr.closureRate, satisfaction: s.satisfaction.index,
        complaintsOpen: s.complaints.open, objectivesAchieved: s.objectives.achieved, objectivesTotal: s.objectives.total, highRisks: s.risks.high,
        auditsDone: s.audits.completed, auditsPlanned: s.audits.planned, compliance: matrix.score,
      },
      alerts,
      ncrByStatus: s.ncr.byStatus,
      objectives: s.objectives.list.slice(0, 6),
      heat: s.risks.heat,
      sections: matrix.sections,
      lastReview: s.reviews.last,
    };
  }

  /** مصفوفة المطابقة: كل بند من 4 إلى 10 وهل يوجد له دليل في النظام */
  async standard(actor: OrgUser, snap?: Awaited<ReturnType<ReportsService['snapshot']>>) {
    const s = snap ?? (await this.snapshot(actor, this.yearRange().from, this.yearRange().to));
    const org = actor.organizationId;
    const docs = (await this.documents.list(actor, { external: '0' })).rows.filter((d) => d.status === 'approved');
    const docsFor = (clause: string) => docs.filter((d) => d.isoClauses.some((c) => c === clause || c.startsWith(`${clause}.`)));
    const [{ jobs }] = await this.db.query(`SELECT COUNT(*) FILTER (WHERE status = 'approved')::int AS jobs FROM hr_jobs WHERE organization_id = $1`, [org]);
    const [{ forms }] = await this.db.query(`SELECT COUNT(*) FILTER (WHERE status = 'approved')::int AS forms FROM dynamic_forms WHERE organization_id = $1`, [org]);
    const [{ projects }] = await this.db.query(`SELECT COUNT(*)::int AS projects FROM activities WHERE organization_id = $1 AND level = 'project'`, [org]).catch(() => [{ projects: 0 }]);
    const [{ requests }] = await this.db.query(`SELECT COUNT(*)::int AS requests FROM beneficiary_requests WHERE organization_id = $1`, [org]).catch(() => [{ requests: 0 }]);
    const allNcr = await this.db.getRepository(QmsNcr).count({ where: { organizationId: org } });
    const closedNcr = await this.db.getRepository(QmsNcr).count({ where: { organizationId: org, status: 'closed' } });
    const audits = await this.db.getRepository(QmsAudit).count({ where: { organizationId: org, status: 'completed' } });
    const complaints = await this.db.getRepository(QmsComplaint).count({ where: { organizationId: org } });
    const reviews = await this.db.getRepository(QmsReview).find({ where: { organizationId: org } });
    const approvedReviews = reviews.filter((r) => r.status === 'approved');
    const resourceDecisions = approvedReviews.some((r) => r.outputs.some((o) => o.type === 'resources'));
    const c = s.context;
    const ev: Record<string, { ok: boolean; partial?: boolean; text: string }> = {
      issues: { ok: c.issues.some((i) => i.kind === 'internal') && c.issues.some((i) => i.kind === 'external'), partial: c.issues.length > 0, text: `${c.issues.length} قضية داخلية وخارجية` },
      parties: { ok: c.parties.length >= 3, partial: c.parties.length > 0, text: `${c.parties.length} طرف معني` },
      scope: { ok: !!c.scope, text: c.scope ? 'النطاق محدد' : 'لم يُحدد النطاق' },
      processes: { ok: c.processes.length > 0 && s.documents.maps > 0, partial: c.processes.length > 0 || s.documents.maps > 0, text: `${c.processes.length} عملية، ${s.documents.maps} خريطة إجراء` },
      reviews: { ok: approvedReviews.length > 0, partial: reviews.length > 0, text: `${approvedReviews.length} مراجعة إدارة معتمدة` },
      policy: { ok: !!c.policy.text && !!c.policy.date, partial: !!c.policy.text, text: c.policy.text ? `معتمدة ${c.policy.date ?? '(بدون تاريخ اعتماد)'}` : 'لم تُكتب السياسة' },
      responsibilities: { ok: c.responsibilities.length > 0 && jobs > 0, partial: c.responsibilities.length > 0 || jobs > 0, text: `${c.responsibilities.length} دور جودة، ${jobs} وصف وظيفي معتمد` },
      risks: { ok: s.risks.risks > 0 && s.risks.top.every((r) => r.actions.length > 0), partial: s.risks.total > 0, text: `${s.risks.risks} خطر و${s.risks.opportunities} فرصة` },
      objectives: { ok: s.objectives.total > 0, text: `${s.objectives.total} هدف نشط` },
      changes: { ok: docs.some((d) => d.approvedRevision! > 0) || docs.length > 0, text: `${docs.length} وثيقة معتمدة بسجل تغييراتها` },
      resources: { ok: resourceDecisions, partial: reviews.length > 0, text: resourceDecisions ? 'قرارات موارد في مراجعة الإدارة' : 'لا قرارات موارد مسجلة' },
      competence: { ok: jobs > 0, text: `${jobs} وصف وظيفي معتمد بالجدارات` },
      awareness: { ok: s.documents.pendingAck === 0 && docs.some((d) => d.copies > 0), partial: docs.some((d) => d.copies > 0), text: `${s.documents.pendingAck} نسخة لم يؤكَّد استلامها` },
      communication: { ok: complaints > 0 || s.satisfaction.surveys.length > 0, text: `${complaints} شكوى، ${s.satisfaction.surveys.length} استبانة` },
      documents: { ok: docs.length > 0 && s.documents.overdue === 0, partial: docs.length > 0, text: `${docs.length} وثيقة معتمدة، ${s.documents.overdue} متأخرة المراجعة` },
      procedures: { ok: s.documents.procedures > 0, text: `${s.documents.procedures} إجراء موثق` },
      forms: { ok: forms > 0, text: `${forms} نموذج طلب معتمد` },
      design: { ok: Number(projects) > 0, text: `${projects} مشروع` },
      external: { ok: docsFor('8.4').length > 0, text: docsFor('8.4').length ? `${docsFor('8.4').length} وثيقة للبند` : 'لا يوجد إجراء معتمد للبند' },
      delivery: { ok: Number(requests) > 0, text: `${requests} طلب مستفيد` },
      release: { ok: Number(requests) > 0, text: 'اعتماد نهائي قبل الصرف' },
      nonconforming: { ok: allNcr > 0, text: `${allNcr} حالة مسجلة` },
      satisfaction: { ok: s.satisfaction.responses > 0, partial: s.satisfaction.surveys.length > 0, text: s.satisfaction.index !== null ? `مؤشر الرضا ${s.satisfaction.index}%` : 'لا توجد ردود هذا العام' },
      audits: { ok: audits > 0, partial: s.audits.planned > 0, text: `${audits} مراجعة مكتملة` },
      improvement: { ok: s.risks.opportunities > 0 || s.audits.findings.ofi > 0, text: `${s.risks.opportunities} فرصة، ${s.audits.findings.ofi} فرصة تحسين من المراجعات` },
      capa: { ok: closedNcr > 0, partial: allNcr > 0, text: `${closedNcr} من ${allNcr} مغلقة بعد التحقق من الفاعلية` },
      continual: { ok: approvedReviews.some((r) => r.outputs.length > 0) && s.objectives.total > 0, partial: reviews.length > 0, text: `${s.reviews.openOutputs} قرار تحسين قيد التنفيذ` },
    };
    const clauses = ISO_CLAUSES.map((cl) => {
      const e = ev[cl.evidence];
      const status = e?.ok ? 'met' : e?.partial ? 'partial' : 'gap';
      return { ...cl, status, evidenceText: e?.text ?? '', documents: docsFor(cl.code).map((d) => ({ id: d.id, code: d.code, title: d.title })) };
    });
    const points = clauses.reduce((sum, x) => sum + (x.status === 'met' ? 1 : x.status === 'partial' ? 0.5 : 0), 0);
    return {
      score: Math.round((points / clauses.length) * 100),
      sections: ISO_SECTIONS.map((sec) => {
        const items = clauses.filter((x) => x.code.split('.')[0] === sec.code);
        const p = items.reduce((sum, x) => sum + (x.status === 'met' ? 1 : x.status === 'partial' ? 0.5 : 0), 0);
        return { ...sec, score: Math.round((p / items.length) * 100), clauses: items };
      }),
    };
  }

  /** تقرير الجودة للفترة (افتراضيًا السنة الحالية) */
  async report(actor: OrgUser, from?: string, to?: string) {
    const r = this.yearRange();
    const f = from && /^\d{4}-\d{2}-\d{2}$/.test(from) ? from : r.from;
    const t = to && /^\d{4}-\d{2}-\d{2}$/.test(to) ? to : r.to;
    const s = await this.snapshot(actor, f, t);
    const [org] = await this.db.query('SELECT name FROM organizations WHERE id = $1', [actor.organizationId]);
    return { ...s, organizationName: org?.name ?? '', standard: await this.standard(actor, s), generatedAt: new Date().toISOString(), generatedBy: actor.fullName };
  }

  /** مدخلات مراجعة الإدارة (9.3.2) تُعبأ تلقائيًا من بيانات النظام منذ آخر مراجعة */
  async reviewInputs(actor: OrgUser, since?: string) {
    const from = since ?? `${today().slice(0, 4)}-01-01`;
    const s = await this.snapshot(actor, from, today());
    const prev = await this.db.getRepository(QmsReview).find({ where: { organizationId: actor.organizationId, status: 'approved' }, order: { meetingDate: 'DESC' }, take: 1 });
    const prevOut = prev[0]?.outputs ?? [];
    const pc = (v: number | null) => (v === null ? 'لا توجد بيانات' : `${v}%`);
    const text: Record<string, string> = {
      previous: prev[0] ? `قرارات المراجعة السابقة (${prev[0].meetingDate}): ${prevOut.length} قرار، نُفذ منها ${prevOut.filter((o) => o.status === 'done').length}، ومفتوح ${prevOut.filter((o) => o.status === 'open').length}.` : 'هذه أول مراجعة إدارة مسجلة في النظام.',
      context: `القضايا المسجلة: ${s.context.issues.filter((i) => i.kind === 'internal').length} داخلية و${s.context.issues.filter((i) => i.kind === 'external').length} خارجية، والأطراف المعنية ${s.context.parties.length}.`,
      satisfaction: `مؤشر الرضا من الاستبانات ${pc(s.satisfaction.index)} من ${s.satisfaction.responses} رد. الشكاوى ${s.complaints.total} (مفتوحة ${s.complaints.open}، متوسط المعالجة ${s.complaints.avgDays ?? '—'} يوم).`,
      objectives: `أهداف الجودة النشطة ${s.objectives.total}: محقق ${s.objectives.achieved}، ومتأخر ${s.objectives.behind}.`,
      processes: `الإجراءات الموثقة ${s.documents.procedures} وخرائط الإجراءات ${s.documents.maps}. الوثائق المعتمدة ${s.documents.approved} من ${s.documents.total}، ومتأخرة المراجعة ${s.documents.overdue}.`,
      ncr: `حالات عدم المطابقة في الفترة ${s.ncr.total} (جسيمة ${s.ncr.major})، مغلقة ${s.ncr.closed}، ونسبة الإغلاق ${pc(s.ncr.closureRate)}. إجراءات متأخرة ${s.ncr.overdueActions}.`,
      monitoring: s.objectives.list.map((o) => `${o.kpi}: ${o.current ?? '—'} ${o.unit} (المستهدف ${o.target})`).join('، ') || 'لا توجد قياسات.',
      audits: `المراجعات المخططة ${s.audits.planned} والمنفذة ${s.audits.completed}. النتائج: ${s.audits.findings.major} جسيمة، ${s.audits.findings.minor} بسيطة، ${s.audits.findings.observation} ملاحظة، ${s.audits.findings.ofi} فرصة تحسين.`,
      providers: `حالات عدم مطابقة من الموردين والجهات الخارجية: ${s.ncr.list.filter((n) => n.source === 'supplier').length}.`,
      resources: 'يُناقش في الاجتماع: كفاية الموظفين والميزانية والبنية التقنية لتحقيق الأهداف.',
      risks: `المخاطر ${s.risks.risks} (مرتفعة مفتوحة ${s.risks.high})، والفرص ${s.risks.opportunities}، وإجراءات معالجة مفتوحة ${s.risks.openActions}.`,
      improvement: `فرص التحسين من المراجعات ${s.audits.findings.ofi}، والفرص في سجل المخاطر ${s.risks.opportunities}.`,
    };
    return REVIEW_INPUTS.map((i) => ({ ...i, summary: text[i.key] ?? '' }));
  }
}
