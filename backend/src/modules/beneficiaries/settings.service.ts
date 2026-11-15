import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, In, Repository } from 'typeorm';
import { OrgUser } from '../../core/auth/decorators';
import { Role } from '../../core/entities';
import { normalizeFields } from './dynamic-forms';
import { Activity, BeneficiaryRequest, DynamicForm, Workflow, WorkflowStage } from './entities';
import { ActivityDto, FormDto, UpdateActivityDto, WorkflowDto } from './settings.dto';

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
    return this.activities.save(a);
  }

  async removeActivity(actor: OrgUser, id: string) {
    const a = await this.findActivity(actor, id);
    if (await this.activities.exists({ where: { parentId: a.id } })) {
      throw new ConflictException('احذف العناصر التابعة له أولًا');
    }
    if (await this.requests.exists({ where: { projectId: a.id } })) {
      throw new ConflictException('المشروع عليه طلبات، أوقفه بدل ما تحذفه');
    }
    await this.activities.delete({ id: a.id });
  }

  // ---------------- النماذج ----------------

  async listForms(actor: OrgUser) {
    return this.forms.find({ where: { organizationId: actor.organizationId }, order: { createdAt: 'ASC' } });
  }

  async createForm(actor: OrgUser, dto: FormDto) {
    return this.forms.save(this.forms.create({
      organizationId: actor.organizationId, name: dto.name, description: dto.description ?? null,
      fields: normalizeFields(dto.fields),
    }));
  }

  async updateForm(actor: OrgUser, id: string, dto: FormDto) {
    const f = await this.findForm(actor, id);
    Object.assign(f, { name: dto.name, description: dto.description ?? null, fields: normalizeFields(dto.fields) });
    return this.forms.save(f);
  }

  async removeForm(actor: OrgUser, id: string) {
    const f = await this.findForm(actor, id);
    const used = (await this.stages.exists({ where: { formId: f.id } }))
      || (await this.workflows.exists({ where: { applicationFormId: f.id } }));
    if (used) throw new ConflictException('النموذج مستخدم في سير عمل، شيله من المراحل أولًا');
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
      applicationFormId: w.applicationFormId, applicationFormName: w.applicationForm?.name ?? null,
      applicationFormFields: w.applicationForm?.fields ?? null,
      stages: (w.stages ?? []).map((s) => ({
        id: s.id, name: s.name, instructions: s.instructions, sortOrder: s.sortOrder,
        formId: s.formId, formName: s.form?.name ?? null, roleId: s.roleId, roleName: s.role?.name ?? null,
        canReject: s.canReject, canReturn: s.canReturn, activeRequests: atStage.get(s.id) ?? 0,
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
      Object.assign(w, { name: dto.name, description: dto.description ?? null, applicationFormId: dto.applicationFormId ?? null });
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
    await this.workflows.delete({ id: w.id });
    if (w.isDefault) {
      const next = await this.workflows.findOne({ where: { organizationId: actor.organizationId }, order: { createdAt: 'ASC' } });
      if (next) await this.workflows.update(next.id, { isDefault: true });
    }
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
      const busy = await em.count(BeneficiaryRequest, {
        where: { currentStageId: In(removed.map((s) => s.id)), status: In(['in_progress', 'returned']) },
      });
      if (busy) throw new ConflictException(`فيه ${busy} طلب واقف على مرحلة بتحاول تحذفها. خلّصهم الأول`);
      // الطلبات المنتهية تحتفظ باسم المرحلة في سجلها، فنفك الربط فقط
      await em.update(BeneficiaryRequest, { currentStageId: In(removed.map((s) => s.id)) }, { currentStageId: null });
      await em.delete(WorkflowStage, { id: In(removed.map((s) => s.id)) });
    }
    for (const [i, s] of dto.stages.entries()) {
      const values = {
        name: s.name, instructions: s.instructions ?? null, sortOrder: i + 1, formId: s.formId ?? null,
        roleId: s.roleId ?? null, canReject: s.canReject ?? true, canReturn: s.canReturn ?? true,
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
