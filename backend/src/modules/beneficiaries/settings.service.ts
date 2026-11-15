import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, In, Repository } from 'typeorm';
import { OrgUser } from '../../core/auth/decorators';
import { Role } from '../../core/entities';
import { normalizeFields, normalizeRules } from './dynamic-forms';
import { BENEFICIARY_PERMISSIONS as P } from './beneficiaries.manifest';
import { Activity, BeneficiaryRequest, BeneficiarySettings, DynamicForm, FormHistoryEntry, FormStatus, FormStep, Workflow, WorkflowStage } from './entities';
import { AccountingDto, ActivityDto, CreateFormDto, FormDto, ReturnFormDto, ServiceDto, UpdateActivityDto, WorkflowDto } from './settings.dto';

const FORM_STATUS_AR: Record<FormStatus, string> = { draft: 'مسودة', review: 'عند مراجع الجودة', reviewed: 'بانتظار اعتماد مدير الشاشة', approved: 'معتمد' };

const PARENT_LEVEL = { axis: null, program: 'axis', project: 'program' } as const;

/** إعدادات وحدة المستفيدين: شجرة الأنشطة، النماذج، وسير العمل بمراحله */
@Injectable()
export class SettingsService {
  constructor(
    private readonly db: DataSource,
    @InjectRepository(Activity) private readonly activities: Repository<Activity>,
    @InjectRepository(DynamicForm) private readonly forms: Repository<DynamicForm>,
    @InjectRepository(Workflow) private readonly workflows: Repository<Workflow>,
    @InjectRepository(WorkflowStage) private readonly stages: Repository<WorkflowStage>,
    @InjectRepository(BeneficiaryRequest) private readonly requests: Repository<BeneficiaryRequest>,
  ) {}

  // ---------------- الأنشطة ----------------

  async listActivities(actor: OrgUser) {
    const rows = await this.activities.find({
      where: { organizationId: actor.organizationId },
      relations: { workflow: true },
      order: { sortOrder: 'ASC', createdAt: 'ASC' },
    });
    const counts: { project_id: string; count: number }[] = await this.db.query(
      'SELECT project_id, COUNT(*)::int AS count FROM beneficiary_requests WHERE organization_id = $1 GROUP BY project_id',
      [actor.organizationId],
    );
    const byProject = new Map(counts.map((c) => [c.project_id, c.count]));
    return rows.map((a) => ({
      id: a.id, level: a.level, parentId: a.parentId, name: a.name, description: a.description,
      workflowId: a.workflowId, workflowName: a.workflow?.name ?? null, portalVisible: a.portalVisible,
      isActive: a.isActive, sortOrder: a.sortOrder, requestCount: byProject.get(a.id) ?? 0,
      services: a.services, multiServices: a.multiServices, allowConcurrent: a.allowConcurrent, recurrence: a.recurrence,
    }));
  }

  async createActivity(actor: OrgUser, dto: ActivityDto) {
    const parentLevel = PARENT_LEVEL[dto.level];
    if (parentLevel) {
      if (!dto.parentId) throw new BadRequestException(dto.level === 'program' ? 'اختر المحور التابع له البرنامج' : 'اختر البرنامج التابع له المشروع');
      const parent = await this.activities.findOne({ where: { id: dto.parentId, organizationId: actor.organizationId } });
      if (!parent || parent.level !== parentLevel) throw new BadRequestException('المستوى الأعلى غير صحيح');
    }
    if (dto.level === 'project' && dto.workflowId) await this.findWorkflow(actor, dto.workflowId);
    const saved = await this.activities.save(this.activities.create({
      organizationId: actor.organizationId,
      level: dto.level,
      parentId: parentLevel ? dto.parentId! : null,
      name: dto.name,
      description: dto.description ?? null,
      workflowId: dto.level === 'project' ? dto.workflowId ?? null : null,
      portalVisible: dto.portalVisible ?? true,
      isActive: dto.isActive ?? true,
      sortOrder: dto.sortOrder ?? 0,
      ...(dto.level === 'project' ? this.supportRules(dto) : {}),
    }));
    return saved;
  }

  async updateActivity(actor: OrgUser, id: string, dto: UpdateActivityDto) {
    const a = await this.findActivity(actor, id);
    if (dto.workflowId !== undefined && a.level === 'project') {
      if (dto.workflowId) await this.findWorkflow(actor, dto.workflowId);
      a.workflowId = dto.workflowId;
    }
    for (const k of ['name', 'description', 'portalVisible', 'isActive', 'sortOrder'] as const) {
      if (dto[k] !== undefined) (a as unknown as Record<string, unknown>)[k] = dto[k];
    }
    if (a.level === 'project') Object.assign(a, this.supportRules(dto));
    return this.activities.save(a);
  }

  /** قواعد الدعم للمشروع: الخدمات، تعدد الخدمات والطلبات، والتكرار */
  private supportRules(dto: UpdateActivityDto) {
    const out: Partial<Activity> = {};
    if (dto.services !== undefined) {
      const names = new Set<string>();
      out.services = dto.services.map((x: ServiceDto) => {
        if (names.has(x.name)) throw new BadRequestException(`الخدمة "${x.name}" مكررة`);
        names.add(x.name);
        return { name: x.name, cost: x.cost ?? null };
      });
    }
    if (dto.multiServices !== undefined) out.multiServices = dto.multiServices;
    if (dto.allowConcurrent !== undefined) out.allowConcurrent = dto.allowConcurrent;
    if (dto.recurrence !== undefined) out.recurrence = dto.recurrence;
    return out;
  }

  async removeActivity(actor: OrgUser, id: string) {
    const a = await this.findActivity(actor, id);
    if (await this.activities.exists({ where: { parentId: a.id } })) {
      throw new ConflictException('احذف العناصر التابعة له أولًا');
    }
    if (await this.requests.exists({ where: { projectId: a.id } })) {
      throw new ConflictException('يوجد طلبات على هذا المشروع، لذا أوقفه بدلًا من حذفه');
    }
    await this.activities.delete({ id: a.id });
  }

  // ---------------- النماذج ----------------

  /** النماذج ومكان كل نموذج (سير العمل والمرحلة) */
  async listForms(actor: OrgUser) {
    const org = actor.organizationId;
    const [forms, workflows] = await Promise.all([
      this.forms.find({ where: { organizationId: org }, order: { createdAt: 'ASC' } }),
      this.workflows.find({ where: { organizationId: org }, relations: { stages: true } }),
    ]);
    return forms.map((f) => {
      const placements: { workflowId: string; workflowName: string; stageId: string | null; stageName: string }[] = [];
      for (const w of workflows) {
        if (w.applicationFormId === f.id) placements.push({ workflowId: w.id, workflowName: w.name, stageId: null, stageName: 'تقديم الطلب' });
        for (const s of w.stages ?? []) {
          if (s.formId === f.id) placements.push({ workflowId: w.id, workflowName: w.name, stageId: s.id, stageName: s.name });
        }
      }
      return { ...f, placements };
    });
  }

  /** النموذج بيتعمل على مرحلة (أو على تقديم الطلب) ويبدأ مسودة لحد ما مدير الشاشة يعتمده */
  async createForm(actor: OrgUser, dto: CreateFormDto) {
    const id = await this.db.transaction(async (em) => {
      const w = await em.findOne(Workflow, { where: { id: dto.workflowId, organizationId: actor.organizationId } });
      if (!w) throw new BadRequestException('سير العمل غير موجود');
      let stage: WorkflowStage | null = null;
      if (dto.stageId) {
        stage = await em.findOne(WorkflowStage, { where: { id: dto.stageId, workflowId: w.id } });
        if (!stage) throw new BadRequestException('المرحلة غير موجودة في سير العمل هذا');
        if (stage.formId) throw new ConflictException(`مرحلة "${stage.name}" مرتبطة بنموذج بالفعل`);
      } else if (w.applicationFormId) throw new ConflictException('يوجد نموذج مرتبط بتقديم الطلب في سير العمل هذا');
      const qualityCode = await this.uniqueCode(em, actor.organizationId, dto.qualityCode);
      const f = await em.save(em.create(DynamicForm, {
        organizationId: actor.organizationId, name: dto.name, description: dto.description ?? null, ...this.formBody(dto),
        qualityCode, status: 'draft', createdByName: actor.fullName, history: [this.step(actor, 'created')],
      }));
      if (stage) await em.update(WorkflowStage, { id: stage.id }, { formId: f.id });
      else await em.update(Workflow, { id: w.id }, { applicationFormId: f.id });
      return f.id;
    });
    return (await this.listForms(actor)).find((x) => x.id === id);
  }

  /** أي تعديل بيرجّع النموذج مسودة، ولازم يعدّي على مسار الاعتماد من الأول */
  async updateForm(actor: OrgUser, id: string, dto: FormDto) {
    const f = await this.findForm(actor, id);
    const qualityCode = await this.uniqueCode(this.forms.manager, actor.organizationId, dto.qualityCode, f.id);
    const history = f.status === 'draft' ? f.history : [...f.history, this.step(actor, 'edited', `كانت حالته: ${FORM_STATUS_AR[f.status]}`)];
    Object.assign(f, {
      name: dto.name, description: dto.description ?? null, ...this.formBody(dto), qualityCode, history,
      status: 'draft', reviewedByName: null, reviewedAt: null, approvedByName: null, approvedAt: null,
    });
    await this.forms.save(f);
    return (await this.listForms(actor)).find((x) => x.id === id);
  }

  /** مسار الاعتماد: إنشاء (مسودة) ← إرسال للمراجعة ← مراجعة الجودة ← اعتماد مدير الشاشة */
  async submitForm(actor: OrgUser, id: string) {
    return this.moveForm(actor, id, 'draft', 'review', 'submitted');
  }

  async reviewForm(actor: OrgUser, id: string) {
    return this.moveForm(actor, id, 'review', 'reviewed', 'reviewed', { reviewedByName: actor.fullName, reviewedAt: new Date() });
  }

  async approveForm(actor: OrgUser, id: string) {
    return this.moveForm(actor, id, 'reviewed', 'approved', 'approved', { approvedByName: actor.fullName, approvedAt: new Date() });
  }

  /** مراجع الجودة (وهو عنده) أو مدير الشاشة (وهو عنده) يرجّع النموذج مسودة مع السبب */
  async returnForm(actor: OrgUser, id: string, dto: ReturnFormDto) {
    const f = await this.findForm(actor, id);
    const needed = f.status === 'review' ? P.formsReview : f.status === 'reviewed' ? P.formsApprove : null;
    if (!needed) throw new ConflictException('لا يمكن إرجاع النموذج لأنه ليس في مرحلة المراجعة أو الاعتماد');
    if (!actor.permissions.includes(needed)) throw new ForbiddenException('ليست لديك صلاحية إرجاع النموذج في هذه المرحلة');
    Object.assign(f, {
      status: 'draft', reviewedByName: null, reviewedAt: null,
      history: [...f.history, this.step(actor, 'returned', dto.note)],
    });
    await this.forms.save(f);
    return (await this.listForms(actor)).find((x) => x.id === id);
  }

  private async moveForm(actor: OrgUser, id: string, from: FormStatus, to: FormStatus, step: FormStep, extra: Partial<DynamicForm> = {}) {
    const f = await this.findForm(actor, id);
    if (f.status !== from) {
      throw new ConflictException(`حالة النموذج الآن: ${FORM_STATUS_AR[f.status]}، وهذه الخطوة تتطلب أن تكون حالته: ${FORM_STATUS_AR[from]}`);
    }
    if (!f.qualityCode) throw new BadRequestException('أدخل كود الجودة للنموذج أولًا (من خلال تعديل النموذج)');
    if (to === 'approved' && f.history.some((h) => h.step === 'approved')) f.revision += 1;
    Object.assign(f, extra, { status: to });
    f.history = [...f.history, { ...this.step(actor, step), ...(to === 'approved' ? { revision: f.revision } : {}) }];
    await this.forms.save(f);
    return (await this.listForms(actor)).find((x) => x.id === id);
  }

  private step(actor: OrgUser, step: FormStep, note?: string): FormHistoryEntry {
    return { step, by: actor.fullName, at: new Date().toISOString(), ...(note ? { note } : {}) };
  }

  /** كود الجودة فريد في الجمعية */
  private async uniqueCode(em: EntityManager, org: string, code: string, exceptId?: string) {
    const qualityCode = code.toUpperCase();
    const other = await em.findOne(DynamicForm, { where: { organizationId: org, qualityCode }, select: { id: true, name: true } });
    if (other && other.id !== exceptId) throw new ConflictException(`كود الجودة ${qualityCode} مستخدم في النموذج "${other.name}"`);
    return qualityCode;
  }

  /** النموذج العادي أو نموذج التقييم (أوزان إجماليها 100% + قواعد النتيجة) */
  private formBody(dto: FormDto) {
    const scored = !!dto.scored;
    return { scored, fields: normalizeFields(dto.fields, scored), rules: scored ? normalizeRules(dto.rules) : [] };
  }

  async removeForm(actor: OrgUser, id: string) {
    const f = await this.findForm(actor, id);
    if (f.history.some((h) => h.step === 'approved') || f.status === 'approved') {
      throw new ConflictException('لا يمكن حذف النموذج لأنه اعتُمد سابقًا وهو مسجل في نظام الجودة');
    }
    // المسودة بتتشال من مرحلتها وتتحذف
    await this.stages.update({ formId: f.id }, { formId: null });
    await this.workflows.update({ applicationFormId: f.id }, { applicationFormId: null });
    await this.forms.delete({ id: f.id });
  }

  // ---------------- سير العمل ----------------

  async listWorkflows(actor: OrgUser) {
    const rows = await this.workflows.find({
      where: { organizationId: actor.organizationId },
      relations: { stages: { form: true, role: true }, applicationForm: true },
      order: { createdAt: 'ASC', stages: { sortOrder: 'ASC' } },
    });
    const active: { stage_id: string; count: number }[] = await this.db.query(
      `SELECT current_stage_id AS stage_id, COUNT(*)::int AS count FROM beneficiary_requests
       WHERE organization_id = $1 AND status IN ('in_progress', 'returned') GROUP BY current_stage_id`,
      [actor.organizationId],
    );
    const atStage = new Map(active.map((r) => [r.stage_id, r.count]));
    return rows.map((w) => ({
      id: w.id, name: w.name, description: w.description, isDefault: w.isDefault,
      applicationFormId: w.applicationFormId, applicationFormName: w.applicationForm?.name ?? null, applicationFormStatus: w.applicationForm?.status ?? null,
      applicationFormFields: w.applicationForm?.fields ?? null,
      stages: (w.stages ?? []).map((s) => ({
        id: s.id, name: s.name, instructions: s.instructions, sortOrder: s.sortOrder,
        formId: s.formId, formName: s.form?.name ?? null, roleId: s.roleId, roleName: s.role?.name ?? null,
        canReject: s.canReject, canReturn: s.canReturn, kind: s.kind, formScored: !!s.form?.scored, formStatus: s.form?.status ?? null,
        activeRequests: atStage.get(s.id) ?? 0,
      })),
    }));
  }

  async createWorkflow(actor: OrgUser, dto: WorkflowDto) {
    const id = await this.db.transaction(async (em) => {
      await this.validateRefs(em, actor, dto);
      const first = !(await em.exists(Workflow, { where: { organizationId: actor.organizationId } }));
      const isDefault = first || !!dto.isDefault;
      if (isDefault) await em.update(Workflow, { organizationId: actor.organizationId }, { isDefault: false });
      const w = await em.save(em.create(Workflow, {
        organizationId: actor.organizationId, name: dto.name, description: dto.description ?? null,
        isDefault, applicationFormId: dto.applicationFormId ?? null,
      }));
      await this.syncStages(em, actor, w.id, dto);
      return w.id;
    });
    return (await this.listWorkflows(actor)).find((w) => w.id === id);
  }

  async updateWorkflow(actor: OrgUser, id: string, dto: WorkflowDto) {
    const w = await this.findWorkflow(actor, id);
    await this.db.transaction(async (em) => {
      await this.validateRefs(em, actor, dto);
      if (dto.isDefault && !w.isDefault) {
        await em.update(Workflow, { organizationId: actor.organizationId }, { isDefault: false });
        w.isDefault = true;
      }
      if (dto.applicationFormId !== undefined && (dto.applicationFormId ?? null) !== w.applicationFormId) {
        await this.assertNotApproved(em, w.applicationFormId, 'نموذج تقديم الطلب معتمد، ولا يمكن فصله عن سير العمل');
        w.applicationFormId = dto.applicationFormId ?? null;
      }
      Object.assign(w, { name: dto.name, description: dto.description ?? null });
      await em.save(w);
      await this.syncStages(em, actor, w.id, dto);
    });
    return (await this.listWorkflows(actor)).find((x) => x.id === id);
  }

  async removeWorkflow(actor: OrgUser, id: string) {
    const w = await this.findWorkflow(actor, id);
    if (await this.requests.exists({ where: { workflowId: w.id } })) {
      throw new ConflictException('سير العمل عليه طلبات مسجلة، لا يمكن حذفه');
    }
    const stageForms = (await this.stages.find({ where: { workflowId: w.id } })).map((s) => s.formId);
    if ((await this.approvedForms(this.forms.manager, [w.applicationFormId, ...stageForms])).size) {
      throw new ConflictException('لا يمكن حذف سير العمل لأن بعض مراحله مرتبطة بنماذج معتمدة');
    }
    await this.workflows.delete({ id: w.id });
    if (w.isDefault) {
      const next = await this.workflows.findOne({ where: { organizationId: actor.organizationId }, order: { createdAt: 'ASC' } });
      if (next) await this.workflows.update(next.id, { isDefault: true });
    }
  }

  // ---------------- التوجيه المحاسبي ----------------

  async accounting(organizationId: string) {
    const row = await this.db.getRepository(BeneficiarySettings).findOne({ where: { organizationId } });
    return {
      debitAccountCode: row?.contributionDebitCode ?? null,
      debitAccountName: row?.contributionDebitName ?? null,
      creditAccountCode: row?.contributionCreditCode ?? null,
      creditAccountName: row?.contributionCreditName ?? null,
      description: row?.contributionDescription ?? null,
    };
  }

  async saveAccounting(actor: OrgUser, dto: AccountingDto) {
    await this.db.getRepository(BeneficiarySettings).save({
      organizationId: actor.organizationId,
      contributionDebitCode: dto.debitAccountCode ?? null,
      contributionDebitName: dto.debitAccountName ?? null,
      contributionCreditCode: dto.creditAccountCode ?? null,
      contributionCreditName: dto.creditAccountName ?? null,
      contributionDescription: dto.description ?? null,
    });
    return this.accounting(actor.organizationId);
  }

  /** أدوار الجمعية (لاختيار المسؤول عن كل مرحلة) */
  async roles(actor: OrgUser) {
    return this.db.getRepository(Role).find({
      where: { organizationId: actor.organizationId },
      select: { id: true, name: true },
      order: { name: 'ASC' },
    });
  }

  /** سير العمل المطبق على مشروع: الخاص به أو الافتراضي */
  async workflowForProject(organizationId: string, project: Activity) {
    const w = project.workflowId
      ? await this.workflows.findOne({ where: { id: project.workflowId, organizationId } })
      : await this.workflows.findOne({ where: { organizationId, isDefault: true } });
    if (!w) throw new BadRequestException('لم يتم إعداد سير عمل للطلبات بعد. تواصل مع إدارة الجمعية');
    return w;
  }

  // ---------------- مساعدات داخلية ----------------

  /** يحدّث مراحل سير العمل بالترتيب المرسل: يعدّل الموجود، يضيف الجديد، ويحذف المحذوف */
  private async syncStages(em: EntityManager, actor: OrgUser, workflowId: string, dto: WorkflowDto) {
    const existing = await em.find(WorkflowStage, { where: { workflowId } });
    const existingIds = new Set(existing.map((s) => s.id));
    for (const s of dto.stages) {
      if (s.id && !existingIds.has(s.id)) throw new BadRequestException('مرحلة غير موجودة في سير العمل');
    }
    const keep = new Set(dto.stages.filter((s) => s.id).map((s) => s.id!));
    const removed = existing.filter((s) => !keep.has(s.id));
    if (removed.length) {
      const locked = await this.approvedForms(em, removed.map((s) => s.formId));
      const lockedStage = removed.find((s) => s.formId && locked.has(s.formId));
      if (lockedStage) throw new ConflictException(`لا يمكن حذف مرحلة "${lockedStage.name}" لأنها مرتبطة بنموذج معتمد`);
      const busy = await em.count(BeneficiaryRequest, {
        where: { currentStageId: In(removed.map((s) => s.id)), status: In(['in_progress', 'returned']) },
      });
      if (busy) throw new ConflictException(`يوجد ${busy} طلب في مرحلة تحاول حذفها. أنهِ هذه الطلبات أولًا`);
      // الطلبات المنتهية تحتفظ باسم المرحلة في سجلها، فنفك الربط فقط
      await em.update(BeneficiaryRequest, { currentStageId: In(removed.map((s) => s.id)) }, { currentStageId: null });
      await em.delete(WorkflowStage, { id: In(removed.map((s) => s.id)) });
    }
    const byId = new Map(existing.map((s) => [s.id, s]));
    const locked = await this.approvedForms(em, existing.map((s) => s.formId));
    for (const [i, s] of dto.stages.entries()) {
      // النموذج بيتربط بالمرحلة من شاشة النماذج، ولو مش مبعوت بيفضل زي ما هو
      const current = s.id ? byId.get(s.id)!.formId : null;
      const formId = s.formId === undefined ? current : s.formId ?? null;
      if (current && formId !== current && locked.has(current)) {
        throw new ConflictException(`لا يمكن تغيير نموذج مرحلة "${s.name}" لأنه معتمد`);
      }
      const values = {
        name: s.name, instructions: s.instructions ?? null, sortOrder: i + 1, formId,
        roleId: s.roleId ?? null, canReject: s.canReject ?? true, canReturn: s.canReturn ?? true,
        kind: s.kind ?? 'standard',
      };
      if (s.id) await em.update(WorkflowStage, { id: s.id }, values);
      else await em.save(em.create(WorkflowStage, { ...values, organizationId: actor.organizationId, workflowId }));
    }
  }

  private async validateRefs(em: EntityManager, actor: OrgUser, dto: WorkflowDto) {
    const org = actor.organizationId;
    const formIds = [...new Set([dto.applicationFormId, ...dto.stages.map((s) => s.formId)].filter(Boolean) as string[])];
    if (formIds.length && (await em.count(DynamicForm, { where: { id: In(formIds), organizationId: org } })) !== formIds.length) {
      throw new BadRequestException('نموذج غير موجود');
    }
    const roleIds = [...new Set(dto.stages.map((s) => s.roleId).filter(Boolean) as string[])];
    if (roleIds.length && (await em.count(Role, { where: { id: In(roleIds), organizationId: org } })) !== roleIds.length) {
      throw new BadRequestException('دور غير موجود');
    }
  }

  private async findActivity(actor: OrgUser, id: string) {
    const a = await this.activities.findOne({ where: { id, organizationId: actor.organizationId } });
    if (!a) throw new NotFoundException('النشاط غير موجود');
    return a;
  }

  private async approvedForms(em: EntityManager, ids: (string | null)[]) {
    const list = ids.filter(Boolean) as string[];
    if (!list.length) return new Set<string>();
    // النموذج اللي اتعتمد مرة بيفضل قافل مرحلته حتى لو رجع مسودة للتعديل
    const rows = await em.createQueryBuilder(DynamicForm, 'f').select('f.id', 'id')
      .where('f.id IN (:...list)', { list })
      .andWhere(`(f.status = 'approved' OR f.history @> '[{"step":"approved"}]'::jsonb)`)
      .getRawMany<{ id: string }>();
    return new Set(rows.map((r) => r.id));
  }

  private async assertNotApproved(em: EntityManager, formId: string | null, message: string) {
    if ((await this.approvedForms(em, [formId])).size) throw new ConflictException(message);
  }

  private async findForm(actor: OrgUser, id: string) {
    const f = await this.forms.findOne({ where: { id, organizationId: actor.organizationId } });
    if (!f) throw new NotFoundException('النموذج غير موجود');
    return f;
  }

  private async findWorkflow(actor: OrgUser, id: string) {
    const w = await this.workflows.findOne({ where: { id, organizationId: actor.organizationId } });
    if (!w) throw new NotFoundException('سير العمل غير موجود');
    return w;
  }
}
