import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { OrgUser } from '../../core/auth/decorators';
import { ActionItem, AutoMetric, NcrStatus, QmsAudit, QmsNcr, QmsObjective, QmsRisk } from './entities/quality.entity';
import { ActionItemDto, AuditDto, AuditExecDto, MeasurementDto, NcrAnalysisDto, NcrDto, ObjectiveDto, RiskDto, VerifyDto } from './quality.dto';
import { QmsCore, addDays, daysBetween, shortId, step, today } from './quality-core.service';

export const NCR_STATUS_LABELS: Record<NcrStatus, string> = {
  open: 'مفتوحة: بانتظار التصحيح', analysis: 'تحليل السبب الجذري', action: 'تنفيذ الإجراءات التصحيحية', verification: 'التحقق من الفاعلية', closed: 'مغلقة',
};
export const NCR_SOURCE_LABELS: Record<string, string> = {
  audit: 'مراجعة داخلية', complaint: 'شكوى', process: 'متابعة العمليات', beneficiary: 'ملاحظة مستفيد', supplier: 'مورد أو جهة خارجية', review: 'مراجعة الإدارة', risk: 'خطر تحقق', other: 'أخرى',
};
export const AUDIT_STATUS_LABELS: Record<string, string> = { planned: 'مخططة', in_progress: 'قيد التنفيذ', completed: 'مكتملة', cancelled: 'ملغاة' };
export const AUDIT_RESULT_LABELS: Record<string, string> = {
  conform: 'مطابق', minor: 'عدم مطابقة بسيطة', major: 'عدم مطابقة جسيمة', observation: 'ملاحظة', ofi: 'فرصة تحسين', na: 'لا ينطبق',
};
export const TREATMENT_LABELS: Record<string, string> = {
  avoid: 'تجنب', mitigate: 'تخفيف', transfer: 'نقل', accept: 'قبول', exploit: 'استغلال', enhance: 'تعزيز', share: 'مشاركة',
};
export const METRIC_LABELS: Record<AutoMetric, { label: string; unit: string; direction: 'increase' | 'decrease' }> = {
  satisfaction: { label: 'مؤشر رضا المستفيدين من الاستبانات', unit: '%', direction: 'increase' },
  complaint_days: { label: 'متوسط أيام معالجة الشكوى', unit: 'يوم', direction: 'decrease' },
  complaints_closed: { label: 'نسبة الشكاوى المعالجة', unit: '%', direction: 'increase' },
  ncr_closed: { label: 'نسبة إغلاق حالات عدم المطابقة', unit: '%', direction: 'increase' },
  ncr_days: { label: 'متوسط أيام إغلاق حالة عدم المطابقة', unit: 'يوم', direction: 'decrease' },
  audit_done: { label: 'نسبة تنفيذ برنامج المراجعة الداخلية', unit: '%', direction: 'increase' },
  docs_current: { label: 'نسبة الوثائق المحدّثة في موعدها', unit: '%', direction: 'increase' },
};
export const riskLevel = (score: number) => (score >= 15 ? 'high' : score >= 8 ? 'medium' : 'low');
export const RISK_LEVEL_LABELS: Record<string, string> = { high: 'مرتفع', medium: 'متوسط', low: 'منخفض' };

const round = (n: number, d = 1) => Math.round(n * 10 ** d) / 10 ** d;

/** المراجعة الداخلية (9.2)، عدم المطابقة والإجراء التصحيحي (8.7، 10.2)، المخاطر والفرص (6.1)، أهداف الجودة (6.2) */
@Injectable()
export class ImprovementService {
  constructor(private readonly db: DataSource, private readonly core: QmsCore) {}

  private normActions(list: ActionItemDto[], old: ActionItem[] = []): ActionItem[] {
    return list.map((a) => {
      const prev = old.find((o) => o.id === a.id);
      return {
        id: a.id && prev ? a.id : shortId(), title: a.title, ownerName: a.ownerName, dueDate: a.dueDate ?? null, status: a.status, note: a.note ?? null,
        doneAt: a.status === 'done' ? (prev?.doneAt ?? today()) : null,
      };
    });
  }

  // ---------------- المراجعة الداخلية ----------------

  private auditRow(a: QmsAudit, depts: Record<string, string>) {
    const res = (r: string) => a.checklist.filter((c) => c.result === r).length;
    const answered = a.checklist.filter((c) => c.result).length;
    return {
      id: a.id, auditNo: a.auditNo, code: `IA-${a.year}-${String(a.auditNo).padStart(2, '0')}`, year: a.year, title: a.title, scope: a.scope,
      department: a.department, departmentName: depts[a.department] ?? a.department, clauses: a.clauses, leadAuditor: a.leadAuditor, auditors: a.auditors,
      auditeeName: a.auditeeName, plannedDate: a.plannedDate, actualDate: a.actualDate, status: a.status, statusLabel: AUDIT_STATUS_LABELS[a.status],
      overdue: a.status === 'planned' && a.plannedDate < today(), questions: a.checklist.length, answered,
      findings: { conform: res('conform'), minor: res('minor'), major: res('major'), observation: res('observation'), ofi: res('ofi') },
    };
  }

  async audits(actor: OrgUser, year?: number) {
    const depts = await this.core.deptNames(actor.organizationId);
    const rows = await this.db.getRepository(QmsAudit).find({ where: { organizationId: actor.organizationId, ...(year ? { year } : {}) }, order: { plannedDate: 'ASC' } });
    return rows.map((a) => this.auditRow(a, depts));
  }

  async audit(actor: OrgUser, id: string) {
    const a = await this.db.getRepository(QmsAudit).findOne({ where: { id, organizationId: actor.organizationId } });
    if (!a) throw new NotFoundException('المراجعة غير موجودة');
    const depts = await this.core.deptNames(actor.organizationId);
    const ncrs = await this.db.getRepository(QmsNcr).find({ where: { organizationId: actor.organizationId, auditId: a.id }, order: { ncrNo: 'ASC' } });
    return {
      ...this.auditRow(a, depts), checklist: a.checklist, summary: a.summary, completedByName: a.completedByName,
      ncrs: ncrs.map((n) => ({ id: n.id, ncrNo: n.ncrNo, title: n.title, severity: n.severity, status: n.status, statusLabel: NCR_STATUS_LABELS[n.status] })),
    };
  }

  async saveAudit(actor: OrgUser, dto: AuditDto, id?: string) {
    const org = actor.organizationId;
    await this.core.department(org, dto.department);
    const checklist = (dto.checklist ?? []).map((c) => ({ clause: c.clause, question: c.question, result: c.result ?? null, evidence: c.evidence ?? null }));
    const body = {
      title: dto.title, scope: dto.scope, department: dto.department, clauses: dto.clauses, leadAuditor: dto.leadAuditor, auditors: dto.auditors ?? null,
      auditeeName: dto.auditeeName ?? null, plannedDate: dto.plannedDate, year: Number(dto.plannedDate.slice(0, 4)),
    };
    if (id) {
      const repo = this.db.getRepository(QmsAudit);
      const a = await repo.findOne({ where: { id, organizationId: org } });
      if (!a) throw new NotFoundException('المراجعة غير موجودة');
      if (a.status === 'completed' || a.status === 'cancelled') throw new BadRequestException('المراجعة مغلقة');
      Object.assign(a, body, dto.checklist ? { checklist } : {});
      await repo.save(a);
      return this.audit(actor, a.id);
    }
    const saved = await this.db.transaction(async (em) => {
      const auditNo = await this.core.nextNo(em, 'quality_audits', 'audit_no', org);
      return em.save(em.create(QmsAudit, { organizationId: org, auditNo, ...body, checklist }));
    });
    return this.audit(actor, saved.id);
  }

  /** تنفيذ المراجعة: تسجيل النتائج، وعند الإنهاء تُصدر حالة عدم مطابقة لكل نتيجة غير مطابقة */
  async executeAudit(actor: OrgUser, id: string, dto: AuditExecDto) {
    const org = actor.organizationId;
    await this.db.transaction(async (em) => {
      const a = await em.findOne(QmsAudit, { where: { id, organizationId: org }, lock: { mode: 'pessimistic_write' } });
      if (!a) throw new NotFoundException('المراجعة غير موجودة');
      if (a.status === 'completed' || a.status === 'cancelled') throw new BadRequestException('المراجعة مغلقة');
      a.checklist = dto.checklist.map((c) => ({ clause: c.clause, question: c.question, result: c.result ?? null, evidence: c.evidence ?? null }));
      a.summary = dto.summary ?? a.summary;
      a.actualDate = dto.actualDate ?? a.actualDate ?? today();
      a.status = 'in_progress';
      if (dto.complete) {
        if (!a.checklist.length) throw new BadRequestException('أضف أسئلة قائمة التحقق أولًا');
        if (a.checklist.some((c) => !c.result)) throw new BadRequestException('سجّل نتيجة كل سؤال قبل إنهاء المراجعة');
        const findings = a.checklist.filter((c) => c.result === 'minor' || c.result === 'major');
        for (const f of findings) {
          if (!f.evidence) throw new BadRequestException('اكتب الدليل الموضوعي لكل نتيجة عدم مطابقة');
        }
        const code = `IA-${a.year}-${String(a.auditNo).padStart(2, '0')}`;
        for (const f of findings) {
          await this.insertNcr(em, actor, {
            source: 'audit', sourceRef: code, title: `${f.clause}: ${f.question}`.slice(0, 250), description: f.evidence!, clause: f.clause,
            severity: f.result as 'minor' | 'major', department: a.department, detectedDate: a.actualDate!,
          }, { auditId: a.id });
        }
        a.status = 'completed';
        a.completedByName = actor.fullName;
      }
      await em.save(a);
    });
    return this.audit(actor, id);
  }

  async cancelAudit(actor: OrgUser, id: string) {
    const repo = this.db.getRepository(QmsAudit);
    const a = await repo.findOne({ where: { id, organizationId: actor.organizationId } });
    if (!a) throw new NotFoundException('المراجعة غير موجودة');
    if (a.status === 'completed') throw new BadRequestException('المراجعة مكتملة');
    a.status = 'cancelled';
    await repo.save(a);
    return this.audit(actor, id);
  }

  // ---------------- عدم المطابقة والإجراءات التصحيحية ----------------

  /** الحالة تُشتق من اكتمال كل مرحلة: التصحيح ← السبب الجذري والإجراءات ← التنفيذ ← التحقق */
  private ncrStatus(n: QmsNcr): NcrStatus {
    if (n.status === 'closed') return 'closed';
    if (!n.rootCause) return n.correction ? 'analysis' : 'open';
    if (!n.actions.length || n.actions.some((a) => a.status !== 'done')) return 'action';
    return 'verification';
  }

  private ncrRow(n: QmsNcr, depts: Record<string, string>) {
    const t = today();
    const overdueActions = n.actions.filter((a) => a.status === 'open' && a.dueDate && a.dueDate < t).length;
    return {
      id: n.id, ncrNo: n.ncrNo, code: `NCR-${n.detectedDate.slice(0, 4)}-${String(n.ncrNo).padStart(3, '0')}`, source: n.source, sourceLabel: NCR_SOURCE_LABELS[n.source], sourceRef: n.sourceRef,
      title: n.title, clause: n.clause, severity: n.severity, department: n.department, departmentName: depts[n.department] ?? n.department,
      detectedDate: n.detectedDate, detectedByName: n.detectedByName, dueDate: n.dueDate, status: n.status, statusLabel: NCR_STATUS_LABELS[n.status],
      overdue: n.status !== 'closed' && !!n.dueDate && n.dueDate < t, overdueActions, actions: n.actions.length, actionsDone: n.actions.filter((a) => a.status === 'done').length,
      closedAt: n.closedAt, daysOpen: daysBetween(n.detectedDate, n.closedAt ?? t),
    };
  }

  async ncrs(actor: OrgUser, q: { status?: string; source?: string; department?: string }) {
    const depts = await this.core.deptNames(actor.organizationId);
    const rows = await this.db.getRepository(QmsNcr).find({ where: { organizationId: actor.organizationId }, order: { ncrNo: 'DESC' } });
    return rows.filter((n) => (!q.status || (q.status === 'active' ? n.status !== 'closed' : n.status === q.status)) && (!q.source || n.source === q.source) && (!q.department || n.department === q.department))
      .map((n) => this.ncrRow(n, depts));
  }

  async ncr(actor: OrgUser, id: string) {
    const n = await this.db.getRepository(QmsNcr).findOne({ where: { id, organizationId: actor.organizationId } });
    if (!n) throw new NotFoundException('الحالة غير موجودة');
    const depts = await this.core.deptNames(actor.organizationId);
    const audit = n.auditId ? await this.db.getRepository(QmsAudit).findOne({ where: { id: n.auditId }, select: { id: true, title: true } }) : null;
    return {
      ...this.ncrRow(n, depts), description: n.description, correction: n.correction, rcaMethod: n.rcaMethod, whys: n.whys, fishbone: n.fishbone, rootCause: n.rootCause,
      actionItems: n.actions, verification: n.verification, needsRiskUpdate: n.needsRiskUpdate, relatedCode: n.relatedCode, history: n.history,
      auditId: n.auditId, auditTitle: audit?.title ?? null, complaintId: n.complaintId,
    };
  }

  async insertNcr(em: EntityManager, actor: OrgUser, dto: NcrDto, links: { auditId?: string; complaintId?: string } = {}) {
    const org = actor.organizationId;
    await this.core.department(org, dto.department);
    const s = await this.core.settings(org, em);
    const ncrNo = await this.core.nextNo(em, 'quality_ncrs', 'ncr_no', org);
    return em.save(em.create(QmsNcr, {
      organizationId: org, ncrNo, source: dto.source, sourceRef: dto.sourceRef ?? null, title: dto.title, description: dto.description, clause: dto.clause ?? null,
      severity: dto.severity, department: dto.department, detectedDate: dto.detectedDate, detectedByName: actor.fullName,
      dueDate: dto.dueDate ?? addDays(dto.detectedDate, s.ncrDays), relatedCode: dto.relatedCode?.toUpperCase() ?? null,
      auditId: links.auditId ?? null, complaintId: links.complaintId ?? null, history: [step(actor, 'created')],
    }));
  }

  async createNcr(actor: OrgUser, dto: NcrDto) {
    const n = await this.db.transaction((em) => this.insertNcr(em, actor, dto));
    return this.ncr(actor, n.id);
  }

  async updateNcr(actor: OrgUser, id: string, dto: NcrDto) {
    const repo = this.db.getRepository(QmsNcr);
    const n = await repo.findOne({ where: { id, organizationId: actor.organizationId } });
    if (!n) throw new NotFoundException('الحالة غير موجودة');
    if (n.status === 'closed') throw new BadRequestException('الحالة مغلقة');
    await this.core.department(actor.organizationId, dto.department);
    Object.assign(n, {
      title: dto.title, description: dto.description, clause: dto.clause ?? null, severity: dto.severity, department: dto.department, detectedDate: dto.detectedDate,
      dueDate: dto.dueDate ?? n.dueDate, sourceRef: dto.sourceRef ?? n.sourceRef, relatedCode: dto.relatedCode?.toUpperCase() ?? n.relatedCode,
    });
    n.history = [...n.history, step(actor, 'updated')];
    await repo.save(n);
    return this.ncr(actor, n.id);
  }

  /** التصحيح الفوري وتحليل السبب الجذري والإجراءات التصحيحية ومتابعة تنفيذها */
  async analyzeNcr(actor: OrgUser, id: string, dto: NcrAnalysisDto) {
    const repo = this.db.getRepository(QmsNcr);
    const n = await repo.findOne({ where: { id, organizationId: actor.organizationId } });
    if (!n) throw new NotFoundException('الحالة غير موجودة');
    if (n.status === 'closed') throw new BadRequestException('الحالة مغلقة');
    if (dto.actions.length && !dto.rootCause) throw new BadRequestException('حدد السبب الجذري قبل الإجراءات التصحيحية');
    const fb = dto.fishbone ?? null;
    Object.assign(n, {
      correction: dto.correction ?? null, rcaMethod: dto.rcaMethod, whys: dto.whys.map((w) => w.trim()).filter(Boolean),
      fishbone: fb ? { man: '', method: '', machine: '', material: '', measurement: '', environment: '', ...Object.fromEntries(Object.entries(fb).map(([k, v]) => [k, String(v ?? '').slice(0, 500)])) } : null,
      rootCause: dto.rootCause ?? null, actions: this.normActions(dto.actions, n.actions), needsRiskUpdate: dto.needsRiskUpdate ?? n.needsRiskUpdate,
      relatedCode: dto.relatedCode?.toUpperCase() ?? n.relatedCode,
    });
    const before = n.status;
    n.status = this.ncrStatus(n);
    n.history = [...n.history, step(actor, before === n.status ? 'updated' : `status:${n.status}`)];
    await repo.save(n);
    return this.ncr(actor, n.id);
  }

  /** التحقق من فاعلية الإجراءات: فعّالة تُغلق الحالة، وغير فعّالة تعيدها لتحليل السبب */
  async verifyNcr(actor: OrgUser, id: string, dto: VerifyDto) {
    const repo = this.db.getRepository(QmsNcr);
    const n = await repo.findOne({ where: { id, organizationId: actor.organizationId } });
    if (!n) throw new NotFoundException('الحالة غير موجودة');
    if (n.status !== 'verification') throw new BadRequestException('أكمل تنفيذ كل الإجراءات التصحيحية قبل التحقق من فاعليتها');
    n.verification = { result: dto.result, note: dto.note ?? null, byName: actor.fullName, at: today() };
    if (dto.result === 'effective') {
      n.status = 'closed';
      n.closedAt = today();
    } else {
      if (!dto.note) throw new BadRequestException('اكتب سبب عدم فاعلية الإجراءات');
      n.rootCause = null;
      n.status = this.ncrStatus(n);
    }
    n.history = [...n.history, step(actor, dto.result === 'effective' ? 'closed' : 'not_effective', dto.note)];
    await repo.save(n);
    return this.ncr(actor, n.id);
  }

  // ---------------- المخاطر والفرص ----------------

  private riskRow(r: QmsRisk, depts: Record<string, string>) {
    const score = r.likelihood * r.impact;
    const residual = r.residualLikelihood && r.residualImpact ? r.residualLikelihood * r.residualImpact : null;
    return {
      ...r, code: `${r.kind === 'risk' ? 'RSK' : 'OPP'}-${String(r.riskNo).padStart(3, '0')}`, departmentName: depts[r.department] ?? r.department,
      score, level: riskLevel(score), levelLabel: RISK_LEVEL_LABELS[riskLevel(score)], residualScore: residual, residualLevel: residual ? riskLevel(residual) : null,
      treatmentLabel: TREATMENT_LABELS[r.treatment] ?? r.treatment, actionsOpen: r.actions.filter((a) => a.status === 'open').length,
      reviewDue: r.status !== 'closed' && !!r.reviewDate && r.reviewDate < today(),
    };
  }

  async risks(actor: OrgUser) {
    const depts = await this.core.deptNames(actor.organizationId);
    const rows = await this.db.getRepository(QmsRisk).find({ where: { organizationId: actor.organizationId }, order: { riskNo: 'ASC' } });
    return rows.map((r) => this.riskRow(r, depts)).sort((a, b) => b.score - a.score);
  }

  async saveRisk(actor: OrgUser, dto: RiskDto, id?: string) {
    const org = actor.organizationId;
    await this.core.department(org, dto.department);
    const body = {
      kind: dto.kind, title: dto.title, process: dto.process, department: dto.department, cause: dto.cause ?? null, consequence: dto.consequence ?? null,
      likelihood: dto.likelihood, impact: dto.impact, treatment: dto.treatment, ownerName: dto.ownerName, residualLikelihood: dto.residualLikelihood ?? null,
      residualImpact: dto.residualImpact ?? null, status: dto.status, reviewDate: dto.reviewDate ?? null,
    };
    const repo = this.db.getRepository(QmsRisk);
    let r: QmsRisk;
    if (id) {
      const found = await repo.findOne({ where: { id, organizationId: org } });
      if (!found) throw new NotFoundException('السجل غير موجود');
      r = await repo.save(Object.assign(found, body, { actions: this.normActions(dto.actions, found.actions) }));
    } else {
      r = await this.db.transaction(async (em) => {
        const riskNo = await this.core.nextNo(em, 'quality_risks', 'risk_no', org);
        return em.save(em.create(QmsRisk, { organizationId: org, riskNo, ...body, actions: this.normActions(dto.actions) }));
      });
    }
    return this.riskRow(r, await this.core.deptNames(org));
  }

  async removeRisk(actor: OrgUser, id: string) {
    const repo = this.db.getRepository(QmsRisk);
    const r = await repo.findOne({ where: { id, organizationId: actor.organizationId } });
    if (!r) throw new NotFoundException('السجل غير موجود');
    await repo.remove(r);
  }

  // ---------------- أهداف الجودة ----------------

  /** قيمة المؤشر التلقائي من بيانات النظام لسنة الهدف */
  async metric(org: string, m: AutoMetric, year: number): Promise<number | null> {
    const q = async (sql: string) => {
      const [r] = await this.db.query(sql, [org, year]);
      return r?.v === null || r?.v === undefined ? null : round(Number(r.v));
    };
    switch (m) {
      case 'satisfaction':
        return q(`SELECT AVG(score) AS v FROM quality_survey_responses WHERE organization_id = $1 AND score IS NOT NULL AND EXTRACT(YEAR FROM created_at) = $2`);
      case 'complaint_days':
        return q(`SELECT AVG(resolved_date - received_date) AS v FROM quality_complaints WHERE organization_id = $1 AND resolved_date IS NOT NULL AND EXTRACT(YEAR FROM received_date) = $2`);
      case 'complaints_closed':
        return q(`SELECT 100.0 * COUNT(*) FILTER (WHERE status IN ('resolved','closed','rejected')) / NULLIF(COUNT(*), 0) AS v FROM quality_complaints WHERE organization_id = $1 AND EXTRACT(YEAR FROM received_date) = $2`);
      case 'ncr_closed':
        return q(`SELECT 100.0 * COUNT(*) FILTER (WHERE status = 'closed') / NULLIF(COUNT(*), 0) AS v FROM quality_ncrs WHERE organization_id = $1 AND EXTRACT(YEAR FROM detected_date) = $2`);
      case 'ncr_days':
        return q(`SELECT AVG(closed_at - detected_date) AS v FROM quality_ncrs WHERE organization_id = $1 AND closed_at IS NOT NULL AND EXTRACT(YEAR FROM detected_date) = $2`);
      case 'audit_done':
        return q(`SELECT 100.0 * COUNT(*) FILTER (WHERE status = 'completed') / NULLIF(COUNT(*), 0) AS v FROM quality_audits WHERE organization_id = $1 AND status <> 'cancelled' AND year = $2`);
      case 'docs_current':
        return q(`SELECT 100.0 * COUNT(*) FILTER (WHERE next_review_date >= CURRENT_DATE) / NULLIF(COUNT(*), 0) AS v FROM quality_documents WHERE organization_id = $1 AND status = 'approved' AND $2::int > 0`);
    }
  }

  async objectiveRow(o: QmsObjective, depts: Record<string, string>) {
    const auto = o.autoMetric ? await this.metric(o.organizationId, o.autoMetric, o.year) : null;
    const last = [...o.measurements].sort((a, b) => a.period.localeCompare(b.period)).at(-1);
    const current = o.autoMetric ? auto : last?.value ?? null;
    let progress: number | null = null;
    let status: 'achieved' | 'on_track' | 'behind' | 'no_data' = 'no_data';
    if (current !== null) {
      const achieved = o.direction === 'increase' ? current >= o.target : current <= o.target;
      progress = o.direction === 'increase' ? (o.target ? (current / o.target) * 100 : 100) : current ? (o.target / current) * 100 : 100;
      progress = Math.max(0, Math.min(100, round(progress)));
      status = achieved ? 'achieved' : progress >= 90 ? 'on_track' : 'behind';
    }
    return {
      ...o, departmentName: depts[o.department] ?? o.department, current, progress, status,
      statusLabel: { achieved: 'محقق', on_track: 'قريب من المستهدف', behind: 'متأخر', no_data: 'لا توجد قياسات' }[status],
      metricLabel: o.autoMetric ? METRIC_LABELS[o.autoMetric].label : null,
      measurements: [...o.measurements].sort((a, b) => a.period.localeCompare(b.period)),
    };
  }

  async objectives(actor: OrgUser, year?: number) {
    const depts = await this.core.deptNames(actor.organizationId);
    const rows = await this.db.getRepository(QmsObjective).find({ where: { organizationId: actor.organizationId, ...(year ? { year } : {}) }, order: { year: 'DESC', createdAt: 'ASC' } });
    return {
      rows: await Promise.all(rows.map((o) => this.objectiveRow(o, depts))),
      metrics: Object.entries(METRIC_LABELS).map(([value, m]) => ({ value, ...m })),
    };
  }

  async saveObjective(actor: OrgUser, dto: ObjectiveDto, id?: string) {
    const org = actor.organizationId;
    await this.core.department(org, dto.department);
    const repo = this.db.getRepository(QmsObjective);
    const body = {
      year: dto.year, title: dto.title, kpi: dto.kpi, unit: dto.unit, baseline: dto.baseline ?? null, target: dto.target, direction: dto.direction, frequency: dto.frequency,
      autoMetric: dto.autoMetric ?? null, department: dto.department, ownerName: dto.ownerName, plan: dto.plan ?? null, isActive: dto.isActive ?? true,
    };
    let o: QmsObjective;
    if (id) {
      const found = await repo.findOne({ where: { id, organizationId: org } });
      if (!found) throw new NotFoundException('الهدف غير موجود');
      o = await repo.save(Object.assign(found, body));
    } else {
      o = await repo.save(repo.create({ organizationId: org, ...body }));
    }
    return this.objectiveRow(o, await this.core.deptNames(org));
  }

  async measure(actor: OrgUser, id: string, dto: MeasurementDto) {
    const repo = this.db.getRepository(QmsObjective);
    const o = await repo.findOne({ where: { id, organizationId: actor.organizationId } });
    if (!o) throw new NotFoundException('الهدف غير موجود');
    if (o.autoMetric) throw new BadRequestException('هذا الهدف يُقاس تلقائيًا من بيانات النظام');
    if (!dto.period.startsWith(String(o.year))) throw new BadRequestException(`الفترة يجب أن تكون ضمن سنة الهدف ${o.year}`);
    o.measurements = [...o.measurements.filter((m) => m.period !== dto.period), { period: dto.period, value: dto.value, note: dto.note ?? null, byName: actor.fullName, at: today() }];
    await repo.save(o);
    return this.objectiveRow(o, await this.core.deptNames(actor.organizationId));
  }

  async removeObjective(actor: OrgUser, id: string) {
    const repo = this.db.getRepository(QmsObjective);
    const o = await repo.findOne({ where: { id, organizationId: actor.organizationId } });
    if (!o) throw new NotFoundException('الهدف غير موجود');
    await repo.remove(o);
  }
}
