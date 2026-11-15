import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Brackets, DataSource, EntityManager, In, Repository } from 'typeorm';
import { OrgUser } from '../../core/auth/decorators';
import { validateAnswers } from './dynamic-forms';
import {
  Activity, Beneficiary, BeneficiaryRequest, DynamicForm, FormField, RequestAction, RequestDecision, Workflow, WorkflowStage,
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
}

const OPEN = ['in_progress', 'returned'];

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
      .select(['r.id', 'r.requestNo', 'r.status', 'r.source', 'r.createdAt', 'r.updatedAt', 'r.closedAt'])
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
          canReturn: s.canReturn, roleId: s.roleId, roleName: s.role?.name ?? null,
          form: s.form ? { id: s.form.id, name: s.form.name, fields: s.form.fields } : null,
        })),
      },
      actions: (r.actions ?? []).map((a) => ({
        id: a.id, stageId: a.stageId, stageName: a.stageName, decision: a.decision, notes: a.notes,
        formName: a.formName, formData: a.formData, formFields: a.formFields, actorName: a.actorName, createdAt: a.createdAt,
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
      const open = await em.findOne(BeneficiaryRequest, {
        where: { organizationId: org, beneficiaryId: beneficiary.id, projectId: project.id, status: In(OPEN) },
      });
      if (open) throw new ConflictException(`يوجد طلب مفتوح على نفس المشروع (طلب رقم ${open.requestNo})`);

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
        description: input.description ?? null, applicationData, createdBy: actor.userId,
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

      if (dto.decision === 'approve') {
        const form = stage.form ? { form: stage.form, data: validateAnswers(stage.form.fields, dto.formData) } : null;
        await this.log(em, actor, r.id, stage, 'approve', dto.notes ?? null, form);
        const next = stages[idx + 1];
        if (next) {
          r.currentStageId = next.id;
        } else {
          // اعتماد نهائي
          Object.assign(r, { status: 'approved', currentStageId: null, closedAt: new Date() });
          await em.update(Beneficiary, { id: r.beneficiaryId, status: In(['new', 'under_review']) }, { status: 'eligible' });
        }
      } else {
        if (!dto.notes) throw new BadRequestException(dto.decision === 'reject' ? 'اكتب سبب الرفض' : 'اكتب سبب الإرجاع');
        if (dto.decision === 'reject') {
          if (!stage.canReject) throw new BadRequestException('هذه المرحلة لا تسمح بالرفض');
          Object.assign(r, { status: 'rejected', currentStageId: null, closedAt: new Date() });
        } else {
          if (!stage.canReturn) throw new BadRequestException('هذه المرحلة لا تسمح بالإرجاع');
          // الإرجاع من أول مرحلة = لمقدم الطلب
          if (idx > 0) r.currentStageId = stages[idx - 1].id;
          else r.status = 'returned';
        }
        await this.log(em, actor, r.id, stage, dto.decision, dto.notes);
      }
      await em.save(r);
    });
    return this.get(user.organizationId, id);
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
    const form = await em.findOne(DynamicForm, { where: { id: workflow.applicationFormId } });
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
    notes: string | null, form?: { form: DynamicForm; data: Record<string, unknown> } | null,
  ) {
    await em.save(em.create(RequestAction, {
      organizationId: actor.organizationId, requestId, stageId: stage?.id ?? null, stageName: stage?.name ?? null,
      decision, notes, actorUserId: actor.userId, actorName: actor.name,
      formName: form?.form.name ?? null, formData: form?.data ?? null, formFields: (form?.form.fields as FormField[]) ?? null,
    }));
  }
}
