import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, In, Repository } from 'typeorm';
import { OrgUser } from '../../core/auth/decorators';
import { Role } from '../../core/entities';
import { Activity, ApprovalStatus } from '../beneficiaries/entities';
import { SettingsService } from '../beneficiaries/settings.service';
import { ApprovalStage, ProjectAction, ProjectActionKind, ProjectProfile } from './entities';
import { CreateNodeDto, DecisionDto, ProjectFieldsDto, StagesDto } from './projects.dto';
import { PROJECT_PERMISSIONS as P } from './projects.manifest';

export const STATUS_AR: Record<ApprovalStatus, string> = {
  draft: 'مسودة', pending: 'قيد الاعتماد', returned: 'معاد للتعديل', approved: 'معتمد', rejected: 'مرفوض',
};
const EDITABLE: ApprovalStatus[] = ['draft', 'returned', 'rejected'];
export const projectCode = (no: number) => `PRJ-${String(no).padStart(4, '0')}`;

/**
 * نظام إدارة المشاريع: شجرة المحور ← البرنامج ← المشروع ← الخدمة (في جدول الأنشطة المشترك مع المستفيدين)،
 * بيانات المشروع (النوع والزكاة وطريقة الصرف)، ومراحل اعتماد المشاريع.
 */
@Injectable()
export class ProjectsService {
  constructor(
    private readonly db: DataSource,
    private readonly settings: SettingsService,
    @InjectRepository(Activity) private readonly activities: Repository<Activity>,
    @InjectRepository(ProjectProfile) private readonly profiles: Repository<ProjectProfile>,
    @InjectRepository(ApprovalStage) private readonly stages: Repository<ApprovalStage>,
    @InjectRepository(ProjectAction) private readonly actions: Repository<ProjectAction>,
  ) {}

  // ---------------- الشجرة ----------------

  /** الشجرة كاملة مع بيانات كل مشروع وحالة اعتماده */
  async tree(actor: OrgUser) {
    const org = actor.organizationId;
    await this.ensureProfiles(org);
    const [rows, profiles, stages, counts] = await Promise.all([
      this.activities.find({ where: { organizationId: org }, order: { sortOrder: 'ASC', createdAt: 'ASC' } }),
      this.profiles.find({ where: { organizationId: org } }),
      this.stages.find({ where: { organizationId: org } }),
      this.db.query('SELECT project_id, COUNT(*)::int AS count FROM beneficiary_requests WHERE organization_id = $1 GROUP BY project_id', [org]),
    ]);
    const prof = new Map(profiles.map((p) => [p.activityId, p]));
    const stageName = new Map(stages.map((s) => [s.id, s.name]));
    const reqs = new Map<string, number>(counts.map((c: { project_id: string; count: number }) => [c.project_id, c.count]));
    return rows.map((a) => ({
      id: a.id, level: a.level, parentId: a.parentId, name: a.name, description: a.description, isActive: a.isActive,
      portalVisible: a.portalVisible, services: a.services, multiServices: a.multiServices,
      ...(a.level === 'project' ? this.projectFields(a, prof.get(a.id)!, stageName) : {}),
      requestCount: reqs.get(a.id) ?? 0,
    }));
  }

  private projectFields(a: Activity, p: ProjectProfile, stageName: Map<string, string>) {
    return {
      projectNo: p.projectNo, code: projectCode(p.projectNo), fundingType: a.fundingType, zakatEligible: a.zakatEligible,
      approvalStatus: a.approvalStatus, approvalStatusLabel: STATUS_AR[a.approvalStatus],
      currentStage: p.currentStageId ? { id: p.currentStageId, name: stageName.get(p.currentStageId) ?? '' } : null,
      spendingMode: p.spendingMode, managerName: p.managerName, startDate: p.startDate, endDate: p.endDate,
      budget: p.budget, targetBeneficiaries: p.targetBeneficiaries, goals: p.goals,
      submittedAt: p.submittedAt, approvedAt: p.approvedAt,
    };
  }

  async createNode(actor: OrgUser, dto: CreateNodeDto) {
    if (dto.level === 'project') this.checkFunding(dto.fundingType ?? 'restricted', dto.zakatEligible ?? false);
    const created = await this.settings.createActivity(actor, {
      level: dto.level, parentId: dto.parentId, name: dto.name, description: dto.description,
      portalVisible: dto.portalVisible, isActive: dto.isActive,
      ...(dto.level === 'project' ? { services: dto.services, multiServices: dto.multiServices } : {}),
    });
    if (dto.level === 'project') {
      await this.db.transaction(async (em) => {
        await em.update(Activity, { id: created.id }, {
          fundingType: dto.fundingType ?? 'restricted', zakatEligible: dto.zakatEligible ?? false, approvalStatus: 'draft',
        });
        await this.createProfile(em, actor.organizationId, created.id, { ...dto, createdByName: actor.fullName });
        await this.log(em, actor, created.id, 'created');
      });
    }
    return this.node(actor, created.id);
  }

  async updateNode(actor: OrgUser, id: string, dto: ProjectFieldsDto) {
    const a = await this.findActivity(actor, id);
    if (a.level === 'project') {
      const locked = !EDITABLE.includes(a.approvalStatus);
      const core = (['fundingType', 'zakatEligible', 'spendingMode'] as const).filter((k) => dto[k] !== undefined);
      const p = await this.profile(a);
      const changed = core.filter((k) => (k === 'spendingMode' ? p.spendingMode : a[k]) !== dto[k]);
      if (locked && changed.length) {
        throw new ConflictException(a.approvalStatus === 'pending'
          ? 'المشروع قيد الاعتماد، لا يمكن تغيير نوعه أو الزكاة أو طريقة الصرف الآن'
          : 'المشروع معتمد. لتغيير نوعه أو الزكاة أو طريقة الصرف أعد فتحه للتعديل أولًا');
      }
      this.checkFunding(dto.fundingType ?? a.fundingType, dto.zakatEligible ?? a.zakatEligible);
    }
    await this.settings.updateActivity(actor, id, {
      name: dto.name, description: dto.description, portalVisible: dto.portalVisible, isActive: dto.isActive,
      ...(a.level === 'project' ? { services: dto.services, multiServices: dto.multiServices } : {}),
    });
    if (a.level === 'project') {
      await this.db.transaction(async (em) => {
        const upd: Partial<Activity> = {};
        if (dto.fundingType !== undefined) upd.fundingType = dto.fundingType;
        if (dto.zakatEligible !== undefined) upd.zakatEligible = dto.zakatEligible;
        if ((dto.fundingType ?? a.fundingType) !== 'restricted') upd.zakatEligible = false;
        if (Object.keys(upd).length) await em.update(Activity, { id }, upd);
        const pu: Partial<ProjectProfile> = {};
        for (const k of ['spendingMode', 'managerName', 'startDate', 'endDate', 'budget', 'targetBeneficiaries', 'goals'] as const) {
          if (dto[k] !== undefined) (pu as Record<string, unknown>)[k] = dto[k];
        }
        this.checkDates(dto.startDate, dto.endDate);
        if (Object.keys(pu).length) await em.update(ProjectProfile, { activityId: id }, pu);
      });
    }
    return this.node(actor, id);
  }

  async removeNode(actor: OrgUser, id: string) {
    const a = await this.findActivity(actor, id);
    if (a.level === 'project' && a.approvalStatus === 'approved') {
      throw new ConflictException('المشروع معتمد، لذا أوقفه بدلًا من حذفه');
    }
    await this.settings.removeActivity(actor, id);
  }

  private async node(actor: OrgUser, id: string) {
    return (await this.tree(actor)).find((x) => x.id === id);
  }

  // ---------------- مراحل الاعتماد ----------------

  async listStages(actor: OrgUser) {
    const rows = await this.stages.find({ where: { organizationId: actor.organizationId }, relations: { role: true }, order: { sortOrder: 'ASC' } });
    const pending: { stage: string; count: number }[] = await this.db.query(
      `SELECT current_stage_id AS stage, COUNT(*)::int AS count FROM project_profiles
       WHERE organization_id = $1 AND current_stage_id IS NOT NULL GROUP BY current_stage_id`, [actor.organizationId]);
    const byStage = new Map(pending.map((x) => [x.stage, x.count]));
    return rows.map((s) => ({
      id: s.id, name: s.name, instructions: s.instructions, sortOrder: s.sortOrder,
      roleId: s.roleId, roleName: s.role?.name ?? null, pendingCount: byStage.get(s.id) ?? 0,
    }));
  }

  /** حفظ المراحل كاملة بترتيبها. لا يمكن حذف مرحلة عليها مشاريع قيد الاعتماد */
  async saveStages(actor: OrgUser, dto: StagesDto) {
    const org = actor.organizationId;
    await this.db.transaction(async (em) => {
      const existing = await em.find(ApprovalStage, { where: { organizationId: org } });
      const keep = new Set(dto.stages.filter((s) => s.id).map((s) => s.id!));
      for (const s of dto.stages) {
        if (s.id && !existing.some((e) => e.id === s.id)) throw new BadRequestException('مرحلة غير موجودة');
      }
      const roleIds = dto.stages.map((s) => s.roleId).filter((x): x is string => !!x);
      if (roleIds.length) {
        const found = await em.count(Role, { where: { id: In(roleIds), organizationId: org } });
        if (found !== new Set(roleIds).size) throw new BadRequestException('أحد الأدوار المختارة غير موجود');
      }
      const removed = existing.filter((e) => !keep.has(e.id));
      if (removed.length) {
        const busy = await em.count(ProjectProfile, { where: { currentStageId: In(removed.map((r) => r.id)) } });
        if (busy) throw new ConflictException('توجد مشاريع قيد الاعتماد في مرحلة محذوفة، أنهِ قرارها أولًا');
        await em.delete(ApprovalStage, { id: In(removed.map((r) => r.id)) });
      }
      for (const [i, s] of dto.stages.entries()) {
        const data = { name: s.name, instructions: s.instructions ?? null, roleId: s.roleId ?? null, sortOrder: i + 1 };
        if (s.id) await em.update(ApprovalStage, { id: s.id }, data);
        else await em.save(em.create(ApprovalStage, { organizationId: org, ...data }));
      }
    });
    return this.listStages(actor);
  }

  /** إرسال المشروع للاعتماد. بدون مراحل معرفة يُعتمد مباشرة */
  async submit(actor: OrgUser, id: string) {
    await this.db.transaction(async (em) => {
      const a = await this.lock(em, actor, id);
      if (!EDITABLE.includes(a.approvalStatus)) throw new ConflictException(`حالة المشروع الآن: ${STATUS_AR[a.approvalStatus]}`);
      const stages = await em.find(ApprovalStage, { where: { organizationId: actor.organizationId }, order: { sortOrder: 'ASC' } });
      if (!stages.length) {
        await this.setStatus(em, a, 'approved', null);
        await this.log(em, actor, id, 'approved', null, 'اعتماد مباشر: لا توجد مراحل اعتماد معرفة');
        return;
      }
      await this.setStatus(em, a, 'pending', stages[0].id, { submittedAt: new Date() });
      await this.log(em, actor, id, 'submitted', stages[0].name);
    });
    return this.detail(actor, id);
  }

  /** موافقة تنقل للمرحلة التالية، رفض يلغي المشروع بسبب، طلب تعديل يعيده للمرحلة السابقة */
  async decide(actor: OrgUser, id: string, dto: DecisionDto) {
    await this.db.transaction(async (em) => {
      const a = await this.lock(em, actor, id);
      const p = await em.findOneOrFail(ProjectProfile, { where: { activityId: id } });
      if (a.approvalStatus !== 'pending' || !p.currentStageId) throw new ConflictException('المشروع ليس قيد الاعتماد');
      const stages = await em.find(ApprovalStage, { where: { organizationId: actor.organizationId }, order: { sortOrder: 'ASC' } });
      const idx = stages.findIndex((s) => s.id === p.currentStageId);
      const stage = stages[idx];
      if (!(await this.canDecide(actor, stage))) throw new ForbiddenException(`قرار مرحلة "${stage.name}" لدور آخر`);
      if (dto.decision !== 'approve' && !dto.note) {
        throw new BadRequestException(dto.decision === 'reject' ? 'اكتب سبب الرفض' : 'اكتب المطلوب تعديله');
      }
      if (dto.decision === 'approve') {
        const next = stages[idx + 1];
        if (next) await this.setStatus(em, a, 'pending', next.id);
        else await this.setStatus(em, a, 'approved', null, { approvedAt: new Date() });
        await this.log(em, actor, id, 'approved', stage.name, dto.note);
      } else if (dto.decision === 'reject') {
        await this.setStatus(em, a, 'rejected', null);
        await this.log(em, actor, id, 'rejected', stage.name, dto.note);
      } else {
        const prev = stages[idx - 1];
        if (prev) await this.setStatus(em, a, 'pending', prev.id);
        else await this.setStatus(em, a, 'returned', null);
        await this.log(em, actor, id, 'returned', stage.name, dto.note);
      }
    });
    return this.detail(actor, id);
  }

  /** إعادة فتح مشروع معتمد للتعديل: يعود مسودة ويختفي من البوابة حتى يُعتمد من جديد */
  async reopen(actor: OrgUser, id: string, note: string | null | undefined, hasActiveSupport: (em: EntityManager) => Promise<boolean>) {
    await this.db.transaction(async (em) => {
      const a = await this.lock(em, actor, id);
      if (a.approvalStatus !== 'approved') throw new ConflictException('المشروع ليس معتمدًا');
      if (!note) throw new BadRequestException('اكتب سبب إعادة الفتح');
      if (await hasActiveSupport(em)) throw new ConflictException('على المشروع دعم محجوز، لا يمكن إعادة فتحه قبل صرفه أو إلغاء حجزه');
      await this.setStatus(em, a, 'draft', null, { approvedAt: null });
      await this.log(em, actor, id, 'reopened', null, note);
    });
    return this.detail(actor, id);
  }

  /** المشاريع التي تنتظر قرار المستخدم الحالي */
  async inbox(actor: OrgUser) {
    const org = actor.organizationId;
    const rows: { id: string }[] = await this.db.query(
      `SELECT a.id FROM activities a JOIN project_profiles p ON p.activity_id = a.id
       JOIN project_approval_stages s ON s.id = p.current_stage_id
       WHERE a.organization_id = $1 AND a.approval_status = 'pending'
         AND ($2::boolean OR s.role_id IS NULL OR s.role_id IN (SELECT role_id FROM user_roles WHERE user_id = $3))
       ORDER BY p.submitted_at`, [org, actor.isSuperadmin, actor.id]);
    const all = await this.tree(actor);
    const byId = new Map(all.map((x) => [x.id, x]));
    return rows.map((r) => {
      const p = byId.get(r.id)!;
      const program = byId.get(p.parentId!);
      return { ...p, program: program?.name ?? null, axis: program ? byId.get(program.parentId!)?.name ?? null : null };
    });
  }

  /** مشروع واحد بمساره وسجل اعتماده ومراحله */
  async detail(actor: OrgUser, id: string) {
    const a = await this.findActivity(actor, id);
    if (a.level !== 'project') throw new NotFoundException('المشروع غير موجود');
    const all = await this.tree(actor);
    const byId = new Map(all.map((x) => [x.id, x]));
    const project = byId.get(id)!;
    const program = byId.get(a.parentId!)!;
    const axis = byId.get(program.parentId!)!;
    const [history, stages] = await Promise.all([
      this.actions.find({ where: { activityId: id }, order: { createdAt: 'ASC' } }),
      this.listStages(actor),
    ]);
    const current = stages.find((s) => s.id === project.currentStage?.id);
    return {
      ...project,
      program: { id: program.id, name: program.name }, axis: { id: axis.id, name: axis.name },
      history, stages,
      canDecide: !!current && actor.permissions.includes(P.approve) && (await this.canDecide(actor, current as unknown as ApprovalStage)),
    };
  }

  // ---------------- مساعدات ----------------

  /** المشاريع المضافة من شاشة المستفيدين أو قبل نظام المشاريع تأخذ سجلًا تلقائيًا */
  async ensureProfiles(org: string, em: EntityManager = this.db.manager) {
    const missing: { id: string }[] = await em.query(
      `SELECT a.id FROM activities a LEFT JOIN project_profiles p ON p.activity_id = a.id
       WHERE a.organization_id = $1 AND a.level = 'project' AND p.activity_id IS NULL ORDER BY a.created_at`, [org]);
    for (const m of missing) await this.createProfile(em, org, m.id, {});
  }

  private async createProfile(em: EntityManager, org: string, activityId: string, dto: ProjectFieldsDto & { createdByName?: string }) {
    this.checkDates(dto.startDate, dto.endDate);
    await em.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`projects:${org}`]);
    const [{ next }] = await em.query('SELECT COALESCE(MAX(project_no), 0) + 1 AS next FROM project_profiles WHERE organization_id = $1', [org]);
    await em.query(
      `INSERT INTO project_profiles (activity_id, organization_id, project_no, spending_mode, manager_name, start_date, end_date, budget, target_beneficiaries, goals, created_by_name)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) ON CONFLICT (activity_id) DO NOTHING`,
      [activityId, org, Number(next), dto.spendingMode ?? 'beneficiaries', dto.managerName ?? null, dto.startDate ?? null, dto.endDate ?? null,
        dto.budget ?? null, dto.targetBeneficiaries ?? null, dto.goals ?? null, dto.createdByName ?? null]);
  }

  async profile(a: Activity) {
    await this.ensureProfiles(a.organizationId);
    return this.profiles.findOneOrFail({ where: { activityId: a.id } });
  }

  private checkFunding(type: string, zakat: boolean) {
    if (zakat && type !== 'restricted') throw new BadRequestException('المشروع ضمن الزكاة يجب أن يكون مقيدًا');
  }

  private checkDates(start?: string | null, end?: string | null) {
    if (start && end && end < start) throw new BadRequestException('تاريخ نهاية المشروع قبل تاريخ بدايته');
  }

  private async setStatus(em: EntityManager, a: Activity, status: ApprovalStatus, stageId: string | null, extra: Partial<ProjectProfile> = {}) {
    await em.update(Activity, { id: a.id }, { approvalStatus: status });
    await em.update(ProjectProfile, { activityId: a.id }, { currentStageId: stageId, ...extra });
  }

  async canDecide(actor: OrgUser, stage: Pick<ApprovalStage, 'roleId'>) {
    if (!actor.permissions.includes(P.approve)) return false;
    if (!stage.roleId || actor.isSuperadmin) return true;
    const [row] = await this.db.query('SELECT 1 FROM user_roles WHERE user_id = $1 AND role_id = $2', [actor.id, stage.roleId]);
    return !!row;
  }

  private async lock(em: EntityManager, actor: OrgUser, id: string) {
    const a = await em.findOne(Activity, { where: { id, organizationId: actor.organizationId, level: 'project' }, lock: { mode: 'pessimistic_write' } });
    if (!a) throw new NotFoundException('المشروع غير موجود');
    await this.ensureProfiles(actor.organizationId, em);
    return a;
  }

  async findActivity(actor: OrgUser, id: string) {
    const a = await this.activities.findOne({ where: { id, organizationId: actor.organizationId } });
    if (!a) throw new NotFoundException('العنصر غير موجود');
    return a;
  }

  private async log(em: EntityManager, actor: OrgUser, activityId: string, kind: ProjectActionKind, stageName: string | null = null, note: string | null = null) {
    await em.save(em.create(ProjectAction, {
      organizationId: actor.organizationId, activityId, kind, stageName, note: note ?? null, userId: actor.id, userName: actor.fullName,
    }));
  }
}
