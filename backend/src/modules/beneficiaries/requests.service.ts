import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Brackets, DataSource, EntityManager, In, Repository } from 'typeorm';
import { OrgUser } from '../../core/auth/decorators';
import { scoreAnswers, supportDecision, validateAnswers } from './dynamic-forms';
import { DocumentStorage } from './document-storage.service';
import {
  Activity, Beneficiary, BeneficiaryDocument, BeneficiaryRequest, BeneficiarySettings, DynamicForm, FormField, Recurrence,
  RequestAction, RequestDecision, Workflow, WorkflowStage,
  type ScoreOutcome,
} from './entities';
import { DecisionDto, ListRequestsQuery, ResubmitDto } from './requests.dto';
import { SettingsService } from './settings.service';

/** من قام بالحركة: موظف أو المستفيد نفسه من البوابة */
export interface ActorRef {
  organizationId: string;
  userId: string | null;
  name: string;
}

export interface NewRequest {
  beneficiaryId: string;
  projectId: string;
  description?: string | null;
  applicationData?: Record<string, unknown>;
  services?: string[];
}

const OPEN = ['in_progress', 'returned'];

export const RECURRENCE_LABEL: Record<Recurrence, string> = {
  once: 'مرة واحدة', weekly: 'أسبوعي', monthly: 'شهري', quarterly: 'كل 3 شهور', semiannual: 'كل 6 شهور', yearly: 'سنوي',
};

function addPeriod(from: Date, r: Recurrence) {
  const d = new Date(from);
  if (r === 'weekly') d.setDate(d.getDate() + 7);
  else d.setMonth(d.getMonth() + ({ monthly: 1, quarterly: 3, semiannual: 6, yearly: 12 } as Record<string, number>)[r]);
  return d;
}

/**
 * محرك سير العمل للطلبات:
 * تقديم ← مرحلة 1 ← ... ← المرحلة الأخيرة (قبولها = اعتماد نهائي).
 * في أي مرحلة: قبول، رفض (مع السبب)، أو إرجاع للمرحلة السابقة (مع السبب)،
 * والإرجاع من المرحلة الأولى يرجّع الطلب لمقدمه لاستكماله وإعادة تقديمه.
 */
@Injectable()
export class RequestsService {
  constructor(
    private readonly db: DataSource,
    @InjectRepository(BeneficiaryRequest) private readonly requests: Repository<BeneficiaryRequest>,
    @InjectRepository(WorkflowStage) private readonly stages: Repository<WorkflowStage>,
    @InjectRepository(Activity) private readonly activities: Repository<Activity>,
    private readonly settings: SettingsService,
    private readonly storage: DocumentStorage,
  ) {}

  // ---------------- القراءة ----------------

  async list(actor: OrgUser, q: ListRequestsQuery) {
    const page = q.page ?? 1;
    const pageSize = q.pageSize ?? 25;
    const qb = this.requests.createQueryBuilder('r')
      .innerJoin('r.beneficiary', 'b')
      .innerJoin('r.project', 'p')
      .leftJoin('r.currentStage', 's')
      .where('r.organization_id = :org', { org: actor.organizationId });
    if (q.status === 'open') qb.andWhere('r.status IN (:...open)', { open: OPEN });
    else if (q.status) qb.andWhere('r.status = :status', { status: q.status });
    if (q.stageId) qb.andWhere('r.current_stage_id = :stage AND r.status = :ip', { stage: q.stageId, ip: 'in_progress' });
    if (q.projectId) qb.andWhere('r.project_id = :project', { project: q.projectId });
    if (q.beneficiaryId) qb.andWhere('r.beneficiary_id = :bid', { bid: q.beneficiaryId });
    if (q.mine) {
      qb.andWhere('r.status = :ip2', { ip2: 'in_progress' });
      if (!actor.isSuperadmin) {
        qb.andWhere(new Brackets((w) => w.where('s.role_id IS NULL')
          .orWhere('s.role_id IN (SELECT role_id FROM user_roles WHERE user_id = :uid)', { uid: actor.id })));
      }
    }
    if (q.search) {
      const term = q.search.replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660));
      const like = `%${term.replace(/[%_\\]/g, '\\$&')}%`;
      qb.andWhere(new Brackets((w) => {
        w.where('b.full_name ILIKE :like', { like }).orWhere('b.national_id LIKE :like', { like });
        if (/^\d{1,9}$/.test(term)) w.orWhere('r.request_no = :no', { no: Number(term) });
      }));
    }
    const total = await qb.getCount();
    const rows = await qb
      .select(['r.id', 'r.requestNo', 'r.status', 'r.source', 'r.createdAt', 'r.updatedAt', 'r.closedAt', 'r.ruleDeviation'])
      .addSelect(['b.id', 'b.fullName', 'b.fileNo', 'p.id', 'p.name', 's.id', 's.name', 's.sortOrder'])
      .orderBy('r.updated_at', 'DESC')
      .offset((page - 1) * pageSize)
      .limit(pageSize)
      .getMany();
    return {
      items: rows.map((r) => ({
        id: r.id, requestNo: r.requestNo, status: r.status, source: r.source, createdAt: r.createdAt, updatedAt: r.updatedAt,
        closedAt: r.closedAt,
        beneficiary: { id: r.beneficiary!.id, fullName: r.beneficiary!.fullName, fileNo: r.beneficiary!.fileNo },
        project: { id: r.project!.id, name: r.project!.name },
        stage: r.currentStage ? { id: r.currentStage.id, name: r.currentStage.name } : null,
        ruleDeviation: r.ruleDeviation,
      })),
      total, page, pageSize,
    };
  }

  /** ملخص للوحة الطلبات: عدد الطلبات في كل مرحلة ولكل حالة */
  async board(actor: OrgUser) {
    const org = actor.organizationId;
    const [byStatus, byStage] = await Promise.all([
      this.db.query('SELECT status, COUNT(*)::int AS count FROM beneficiary_requests WHERE organization_id = $1 GROUP BY status', [org]),
      this.db.query(
        `SELECT w.id AS "workflowId", w.name AS "workflowName", s.id, s.name, s.sort_order AS "sortOrder",
                COUNT(r.id) FILTER (WHERE r.status = 'in_progress')::int AS count
         FROM workflows w JOIN workflow_stages s ON s.workflow_id = w.id
         LEFT JOIN beneficiary_requests r ON r.current_stage_id = s.id
         WHERE w.organization_id = $1
         GROUP BY w.id, w.name, w.created_at, s.id ORDER BY w.created_at, s.sort_order`, [org]),
    ]);
    const workflows = new Map<string, { id: string; name: string; stages: { id: string; name: string; count: number }[] }>();
    for (const s of byStage) {
      if (!workflows.has(s.workflowId)) workflows.set(s.workflowId, { id: s.workflowId, name: s.workflowName, stages: [] });
      workflows.get(s.workflowId)!.stages.push({ id: s.id, name: s.name, count: s.count });
    }
    return {
      byStatus: Object.fromEntries(byStatus.map((r: { status: string; count: number }) => [r.status, r.count])),
      workflows: [...workflows.values()],
    };
  }

  /** تفاصيل الطلب: المستفيد، شجرة النشاط، مراحل سير العمل، السجل، والنماذج */
  async get(organizationId: string, id: string, beneficiaryId?: string) {
    const r = await this.requests.findOne({
      where: { id, organizationId, ...(beneficiaryId ? { beneficiaryId } : {}) },
      relations: { beneficiary: true, project: true, actions: true },
      order: { actions: { createdAt: 'ASC' } },
    });
    if (!r) throw new NotFoundException('الطلب غير موجود');
    const workflow = await this.db.getRepository(Workflow).findOne({
      where: { id: r.workflowId },
      relations: { stages: { form: true, role: true }, applicationForm: true },
      order: { stages: { sortOrder: 'ASC' } },
    });
    const path = await this.projectPath(r.project!);
    const b = r.beneficiary!;
    return {
      id: r.id, requestNo: r.requestNo, status: r.status, source: r.source, description: r.description,
      applicationData: r.applicationData, createdAt: r.createdAt, updatedAt: r.updatedAt, closedAt: r.closedAt,
      currentStageId: r.currentStageId,
      services: r.services, estimatedCost: r.estimatedCost,
      research: r.researchOutcome === null ? null : {
        score: r.researchScore, outcome: r.researchOutcome, contributionPercent: r.contributionPercent ?? 0,
        supportPercent: r.supportPercent, supportAmount: this.supportAmount(r),
        suggestion: r.ruleSuggestion, deviation: r.ruleDeviation, deviationReason: r.deviationReason,
      },
      contribution: {
        status: r.contributionStatus, percent: r.contributionPercent ?? 0, amount: r.contributionAmount,
        requiredAmount: this.requiredAmount(r), documentId: r.contributionDocumentId,
        submittedAt: r.contributionSubmittedAt, verifiedAt: r.contributionVerifiedAt, journal: r.contributionJournal,
      },
      beneficiary: {
        id: b.id, fileNo: b.fileNo, fullName: b.fullName, nationalId: b.nationalId, phone: b.phone,
        category: b.category, status: b.status,
      },
      project: { id: r.project!.id, name: r.project!.name, path },
      workflow: workflow && {
        id: workflow.id, name: workflow.name,
        applicationForm: workflow.applicationForm ? { id: workflow.applicationForm.id, name: workflow.applicationForm.name, fields: workflow.applicationForm.fields } : null,
        stages: (workflow.stages ?? []).map((s) => ({
          id: s.id, name: s.name, instructions: s.instructions, sortOrder: s.sortOrder, canReject: s.canReject,
          canReturn: s.canReturn, roleId: s.roleId, roleName: s.role?.name ?? null, kind: s.kind,
          form: s.form ? { id: s.form.id, name: s.form.name, fields: s.form.fields, scored: s.form.scored, rules: s.form.rules, status: s.form.status, qualityCode: s.form.qualityCode, revision: s.form.revision } : null,
        })),
      },
      actions: (r.actions ?? []).map((a) => ({
        id: a.id, stageId: a.stageId, stageName: a.stageName, decision: a.decision, notes: a.notes,
        formName: a.formName, formData: a.formData, formFields: a.formFields, actorName: a.actorName, createdAt: a.createdAt,
        score: a.score,
      })),
    };
  }

  /** هل المستخدم يقدر يتخذ قرار في المرحلة الحالية؟ */
  async canDecide(actor: OrgUser, stageId: string | null) {
    if (!stageId || !actor.permissions.includes('beneficiaries.requests.process')) return false;
    const stage = await this.stages.findOne({ where: { id: stageId, organizationId: actor.organizationId } });
    if (!stage) return false;
    if (!stage.roleId || actor.isSuperadmin) return true;
    const [row] = await this.db.query('SELECT 1 FROM user_roles WHERE user_id = $1 AND role_id = $2', [actor.id, stage.roleId]);
    return !!row;
  }

  // ---------------- التقديم ----------------

  async create(actor: ActorRef, input: NewRequest, source: 'portal' | 'staff') {
    const org = actor.organizationId;
    const id = await this.db.transaction(async (em) => {
      const beneficiary = await em.findOne(Beneficiary, { where: { id: input.beneficiaryId, organizationId: org } });
      if (!beneficiary) throw new NotFoundException('المستفيد غير موجود');
      if (beneficiary.status === 'suspended') throw new BadRequestException('ملف المستفيد موقوف، لا يمكن تقديم طلبات');
      const project = await em.findOne(Activity, { where: { id: input.projectId, organizationId: org, level: 'project' } });
      if (!project || !project.isActive || (source === 'portal' && !project.portalVisible)) {
        throw new BadRequestException('المشروع غير متاح للتقديم');
      }
      const eligibility = await this.eligibility(em, org, beneficiary.id, project);
      if (!eligibility.canApply) throw new ConflictException(eligibility.reason);
      const { services, estimatedCost } = this.pickServices(project, input.services);

      const workflow = await this.settings.workflowForProject(org, project);
      const stages = await em.find(WorkflowStage, { where: { workflowId: workflow.id }, order: { sortOrder: 'ASC' } });
      if (!stages.length) throw new BadRequestException('سير عمل المشروع ليس له مراحل بعد');
      const applicationData = await this.validateApplication(em, workflow, input.applicationData);

      await em.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`requests:${org}`]);
      const [{ next }] = await em.query(
        'SELECT COALESCE(MAX(request_no), 0) + 1 AS next FROM beneficiary_requests WHERE organization_id = $1', [org],
      );
      const r = await em.save(em.create(BeneficiaryRequest, {
        organizationId: org, requestNo: Number(next), beneficiaryId: beneficiary.id, projectId: project.id,
        workflowId: workflow.id, currentStageId: stages[0].id, status: 'in_progress', source,
        description: input.description ?? null, applicationData, createdBy: actor.userId, services, estimatedCost,
      }));
      await this.log(em, actor, r.id, null, 'submitted', null);
      return r.id;
    });
    return id;
  }

  /** إعادة تقديم طلب رجع لمقدمه بعد استكمال البيانات */
  async resubmit(actor: ActorRef, id: string, dto: ResubmitDto, beneficiaryId?: string) {
    await this.db.transaction(async (em) => {
      const r = await this.lockRequest(em, actor.organizationId, id, beneficiaryId);
      if (r.status !== 'returned') throw new BadRequestException('الطلب ليس في حالة استكمال بيانات');
      const workflow = await em.findOneOrFail(Workflow, { where: { id: r.workflowId } });
      if (dto.applicationData !== undefined) r.applicationData = await this.validateApplication(em, workflow, dto.applicationData);
      if (dto.description !== undefined) r.description = dto.description;
      const first = await em.findOne(WorkflowStage, { where: { workflowId: r.workflowId }, order: { sortOrder: 'ASC' } });
      if (!first) throw new BadRequestException('سير عمل المشروع ليس له مراحل');
      r.status = 'in_progress';
      r.currentStageId = first.id;
      await em.save(r);
      await this.log(em, actor, r.id, null, 'resubmitted', dto.notes ?? null);
    });
  }

  /** إلغاء الطلب من مقدمه قبل البت فيه */
  async cancel(actor: ActorRef, id: string, beneficiaryId: string) {
    await this.db.transaction(async (em) => {
      const r = await this.lockRequest(em, actor.organizationId, id, beneficiaryId);
      if (!OPEN.includes(r.status)) throw new BadRequestException('لا يمكن إلغاء طلب منتهي');
      Object.assign(r, { status: 'cancelled', currentStageId: null, closedAt: new Date() });
      await em.save(r);
      await this.log(em, actor, r.id, null, 'cancelled', null);
    });
  }

  // ---------------- القرارات ----------------

  async decide(user: OrgUser, id: string, dto: DecisionDto) {
    const actor: ActorRef = { organizationId: user.organizationId, userId: user.id, name: user.fullName };
    await this.db.transaction(async (em) => {
      const r = await this.lockRequest(em, user.organizationId, id);
      if (r.status !== 'in_progress' || !r.currentStageId) throw new BadRequestException('الطلب ليس في مرحلة تنتظر قرار');
      if (!(await this.canDecide(user, r.currentStageId))) {
        throw new ForbiddenException('القرار في هذه المرحلة لمسؤول آخر');
      }
      const stages = await em.find(WorkflowStage, {
        where: { workflowId: r.workflowId }, relations: { form: true }, order: { sortOrder: 'ASC' },
      });
      const idx = stages.findIndex((s) => s.id === r.currentStageId);
      const stage = stages[idx];

      if (dto.estimatedCost !== undefined) r.estimatedCost = dto.estimatedCost;
      if (stage.form && stage.form.status !== 'approved' && dto.decision !== 'return') {
        throw new BadRequestException(`نموذج "${stage.form.name}" في المرحلة دي لسه مستني اعتماد مدير الشاشة`);
      }

      if (dto.decision === 'approve') {
        const form = stage.form ? { form: stage.form, data: validateAnswers(stage.form.fields, dto.formData) } : null;
        let score: number | null = null;
        const explicit = form ? supportDecision(form.form.fields, form.data) : null;
        if (explicit?.decision === 'none') throw new BadRequestException('تقييم الباحث "غير مستحق". اختار "رفض" واكتب السبب');
        const rule = form?.form.scored ? scoreAnswers(form.form, form.data) : null;
        if (rule || explicit) {
          // قرار الباحث: مستحق = الجمعية 100%، مستحق بنسبة = نسبة الجمعية والباقي على المستفيد.
          // من غير حقل تقييم الباحث، القبول = اقتراح القواعد (ولو القواعد قالت رفض = قبول كامل مخالف للقاعدة)
          const support = explicit
            ? (explicit.decision === 'full' ? 100 : explicit.percent!)
            : rule!.outcome === 'contribution' ? 100 - rule!.contributionPercent : 100;
          const contribution = Math.round((100 - support) * 100) / 100;
          Object.assign(r, {
            researchOutcome: support === 100 ? 'approve' : 'contribution', supportPercent: support, contributionPercent: contribution,
          });
          if (rule) {
            score = rule.score;
            this.applyRule(r, rule, r.researchOutcome!, contribution, dto.notes);
          }
        }
        if (stage.kind === 'contribution') await this.verifyContribution(em, r, dto);
        await this.log(em, actor, r.id, stage, 'approve', dto.notes ?? null, form, score);
        await this.advance(em, actor, r, stages, idx + 1);
      } else {
        if (!dto.notes) throw new BadRequestException(dto.decision === 'reject' ? 'اكتب سبب الرفض' : 'اكتب سبب الإرجاع');
        let form: { form: DynamicForm; data: Record<string, unknown> } | null = null;
        let score: number | null = null;
        if (dto.decision === 'reject') {
          if (!stage.canReject) throw new BadRequestException('هذه المرحلة لا تسمح بالرفض');
          // الرفض في مرحلة التقييم: نسجل النتيجة ونعلّم الحالة لو القواعد كانت بتقترح قبول
          if (stage.form?.scored && dto.formData && Object.keys(dto.formData).length) {
            form = { form: stage.form, data: validateAnswers(stage.form.fields, dto.formData) };
            const rule = scoreAnswers(stage.form, form.data);
            score = rule.score;
            Object.assign(r, { researchOutcome: 'reject', supportPercent: 0, contributionPercent: null });
            this.applyRule(r, rule, 'reject', 0, dto.notes);
          }
          Object.assign(r, { status: 'rejected', currentStageId: null, closedAt: new Date() });
        } else {
          if (!stage.canReturn) throw new BadRequestException('هذه المرحلة لا تسمح بالإرجاع');
          if (stage.kind === 'contribution') {
            // إرجاع للمستفيد علشان يرفع إثبات المساهمة من جديد
            r.contributionStatus = 'awaiting';
          } else if (idx > 0) r.currentStageId = stages[idx - 1].id;
          // الإرجاع من أول مرحلة = لمقدم الطلب
          else r.status = 'returned';
        }
        await this.log(em, actor, r.id, stage, dto.decision, dto.notes, form, score);
      }
      await em.save(r);
    });
    return this.get(user.organizationId, id);
  }

  // ---------------- مساهمة المستفيد ----------------

  /** المستفيد يرفع إثبات مساهمته من البوابة (في مرحلة تأكيد المساهمة) */
  async submitContribution(actor: ActorRef, id: string, beneficiaryId: string, amount: number, file: Express.Multer.File) {
    const { key, mime } = await this.storage.save(actor.organizationId, file);
    try {
      await this.db.transaction(async (em) => {
        const r = await this.lockRequest(em, actor.organizationId, id, beneficiaryId);
        const stage = r.currentStageId ? await em.findOne(WorkflowStage, { where: { id: r.currentStageId } }) : null;
        if (r.status !== 'in_progress' || stage?.kind !== 'contribution' || !['awaiting', 'submitted'].includes(r.contributionStatus)) {
          throw new BadRequestException('الطلب مش في مرحلة تأكيد المساهمة');
        }
        const doc = await em.save(em.create(BeneficiaryDocument, {
          organizationId: actor.organizationId, beneficiaryId, title: `إثبات مساهمة - طلب رقم ${r.requestNo}`,
          docType: 'contribution_proof', originalName: (file.originalname || 'proof').slice(0, 255), mimeType: mime,
          size: file.size, storageKey: key, uploadedBy: null,
        }));
        Object.assign(r, {
          contributionStatus: 'submitted', contributionAmount: amount, contributionDocumentId: doc.id, contributionSubmittedAt: new Date(),
        });
        await em.save(r);
        await this.log(em, actor, r.id, stage, 'contribution_sent', `المبلغ: ${amount}`);
      });
    } catch (e) {
      await this.storage.remove([key]);
      throw e;
    }
  }

  /** قبول مرحلة تأكيد المساهمة = التحقق منها وتوجيه القيد المحاسبي */
  private async verifyContribution(em: EntityManager, r: BeneficiaryRequest, dto: DecisionDto) {
    if (dto.contributionAmount !== undefined) r.contributionAmount = dto.contributionAmount;
    else if (r.contributionStatus !== 'submitted') {
      throw new BadRequestException('المستفيد لسه مارفعش إثبات المساهمة. استنى رفعه، أو سجّل المبلغ اللي دفعه في الجمعية');
    }
    const amount = r.contributionAmount ?? 0;
    const acc = await em.findOne(BeneficiarySettings, { where: { organizationId: r.organizationId } });
    Object.assign(r, {
      contributionStatus: 'verified',
      contributionVerifiedAt: new Date(),
      contributionJournal: amount > 0 ? {
        date: new Date().toISOString().slice(0, 10),
        amount,
        debit: { code: acc?.contributionDebitCode ?? null, name: acc?.contributionDebitName ?? null },
        credit: { code: acc?.contributionCreditCode ?? null, name: acc?.contributionCreditName ?? null },
        description: `${acc?.contributionDescription || 'مساهمة مستفيد'} - طلب رقم ${r.requestNo}`,
      } : null,
    });
  }

  /**
   * القواعد استرشادية: بنسجل اقتراحها، ولو قرار الباحث اختلف عنها لازم يكتب السبب،
   * والحالة بتتعلّم علشان تبان للمعتمد النهائي
   */
  private applyRule(
    r: BeneficiaryRequest, rule: { score: number; outcome: ScoreOutcome | null; contributionPercent: number },
    decided: ScoreOutcome, contribution: number, notes?: string | null,
  ) {
    r.researchScore = rule.score;
    r.ruleSuggestion = rule.outcome ? { score: rule.score, outcome: rule.outcome, contributionPercent: rule.contributionPercent } : null;
    const differs = !!rule.outcome && (rule.outcome !== decided
      || (decided === 'contribution' && Math.abs(rule.contributionPercent - contribution) > 0.001));
    if (differs && !notes) {
      const suggested = rule.outcome === 'contribution' ? `قبول بمساهمة ${rule.contributionPercent}% من المستفيد` : rule.outcome === 'reject' ? 'رفض' : 'قبول';
      throw new BadRequestException(`القاعدة بتقترح "${suggested}" (النتيجة ${rule.score}%) وقرارك مختلف. اكتب سبب الاختلاف في الملاحظات`);
    }
    r.ruleDeviation = differs;
    r.deviationReason = differs ? notes ?? null : null;
  }

  /** المبلغ اللي الجمعية بتتحمله = اللي بيتحسب ضمن بيانات الدعم في المشروع */
  private supportAmount(r: BeneficiaryRequest) {
    if (r.supportPercent === null || r.estimatedCost === null) return null;
    return Math.round(r.estimatedCost * r.supportPercent) / 100;
  }

  private requiredAmount(r: BeneficiaryRequest) {
    if (!r.contributionPercent || r.estimatedCost === null) return null;
    return Math.round(r.estimatedCost * r.contributionPercent) / 100;
  }

  /**
   * ينقل الطلب للمرحلة التالية. مرحلة تأكيد المساهمة بتتعدى تلقائيًا لو مفيش مساهمة مطلوبة،
   * وبعد آخر مرحلة = اعتماد نهائي.
   */
  private async advance(em: EntityManager, actor: ActorRef, r: BeneficiaryRequest, stages: WorkflowStage[], from: number) {
    for (let i = from; i < stages.length; i++) {
      const next = stages[i];
      if (next.kind === 'contribution') {
        if (!(r.contributionPercent && r.contributionPercent > 0)) {
          await this.log(em, actor, r.id, next, 'skipped', 'مفيش مساهمة مطلوبة من المستفيد');
          continue;
        }
        r.contributionStatus = 'awaiting';
      }
      r.currentStageId = next.id;
      return;
    }
    Object.assign(r, { status: 'approved', currentStageId: null, closedAt: new Date() });
    await em.update(Beneficiary, { id: r.beneficiaryId, status: In(['new', 'under_review']) }, { status: 'eligible' });
  }

  // ---------------- قواعد الدعم ----------------

  /**
   * هل المستفيد يقدر يقدم على المشروع دلوقتي؟
   * - طلب مفتوح على نفس المشروع يمنع طلب جديد إلا لو المشروع بيسمح بأكتر من طلب
   * - التكرار: مرة واحدة، أو بعد مرور الفترة من آخر طلب اتعتمد
   */
  async eligibility(em: EntityManager, org: string, beneficiaryId: string, project: Activity) {
    if (!project.allowConcurrent) {
      const open = await em.findOne(BeneficiaryRequest, {
        where: { organizationId: org, beneficiaryId, projectId: project.id, status: In(OPEN) },
      });
      if (open) return { canApply: false, reason: `يوجد طلب مفتوح على نفس المشروع (طلب رقم ${open.requestNo})`, nextDate: null };
    }
    const last = await em.findOne(BeneficiaryRequest, {
      where: { organizationId: org, beneficiaryId, projectId: project.id, status: 'approved' },
      order: { closedAt: 'DESC' },
    });
    if (last?.closedAt) {
      if (project.recurrence === 'once') {
        return { canApply: false, reason: 'استفدت من المشروع ده قبل كده، والدعم فيه مرة واحدة بس', nextDate: null };
      }
      const next = addPeriod(last.closedAt, project.recurrence);
      if (next > new Date()) {
        const d = next.toISOString().slice(0, 10);
        return { canApply: false, reason: `الدعم في المشروع ده ${RECURRENCE_LABEL[project.recurrence]}، تقدر تقدم تاني من ${d}`, nextDate: d };
      }
    }
    return { canApply: true, reason: null, nextDate: null };
  }

  /** الخدمات المختارة لازم تكون من خدمات المشروع، وواحدة بس لو المشروع مش بيسمح بأكتر */
  private pickServices(project: Activity, picked?: string[]) {
    const available = project.services ?? [];
    if (!available.length) return { services: [], estimatedCost: null };
    const chosen = [...new Set((picked ?? []).map((x) => x.trim()).filter(Boolean))];
    if (!chosen.length) throw new BadRequestException('اختر الخدمة المطلوبة');
    if (!project.multiServices && chosen.length > 1) throw new BadRequestException('المشروع ده بيسمح بخدمة واحدة في الطلب');
    const items = chosen.map((name) => {
      const svc = available.find((x) => x.name === name);
      if (!svc) throw new BadRequestException(`الخدمة "${name}" مش من خدمات المشروع`);
      return svc;
    });
    const costs = items.map((x) => x.cost);
    const estimatedCost = costs.every((c) => typeof c === 'number') ? costs.reduce((a, c) => a + (c as number), 0) : null;
    return { services: chosen, estimatedCost };
  }

  // ---------------- مساعدات ----------------

  /** محور ← برنامج ← مشروع */
  async projectPath(project: Activity) {
    const names = [project.name];
    let parentId = project.parentId;
    while (parentId) {
      const p = await this.activities.findOne({ where: { id: parentId }, select: { id: true, name: true, parentId: true } });
      if (!p) break;
      names.unshift(p.name);
      parentId = p.parentId;
    }
    return names;
  }

  private async validateApplication(em: EntityManager, workflow: Workflow, data?: Record<string, unknown>) {
    if (!workflow.applicationFormId) return {};
    const form = await em.findOne(DynamicForm, { where: { id: workflow.applicationFormId, status: 'approved' } });
    return form ? validateAnswers(form.fields, data) : {};
  }

  private async lockRequest(em: EntityManager, organizationId: string, id: string, beneficiaryId?: string) {
    const r = await em.findOne(BeneficiaryRequest, {
      where: { id, organizationId, ...(beneficiaryId ? { beneficiaryId } : {}) },
      lock: { mode: 'pessimistic_write' },
    });
    if (!r) throw new NotFoundException('الطلب غير موجود');
    return r;
  }

  private async log(
    em: EntityManager, actor: ActorRef, requestId: string, stage: WorkflowStage | null, decision: RequestDecision,
    notes: string | null, form?: { form: DynamicForm; data: Record<string, unknown> } | null, score: number | null = null,
  ) {
    await em.save(em.create(RequestAction, {
      organizationId: actor.organizationId, requestId, stageId: stage?.id ?? null, stageName: stage?.name ?? null,
      decision, notes, actorUserId: actor.userId, actorName: actor.name,
      formName: form?.form.name ?? null, formData: form?.data ?? null, formFields: (form?.form.fields as FormField[]) ?? null,
      score,
    }));
  }
}
