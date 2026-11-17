import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { DataSource, EntityManager, In } from 'typeorm';
import { OrgUser } from '../../core/auth/decorators';
import { RiskChange, RiskControl, RiskItem, RiskProcedure, RiskTask } from './entities/risk.entity';
import { assertEditable, markEdited } from './risk-calc';
import { ChangeDto, ChangeProgressDto, ProcedureDto, TaskDto, TaskProgressDto } from './risk.dto';
import { RiskCore, today } from './risk-core.service';
import { RISK_PERMISSIONS as P } from './risk.manifest';

/** سجل التغيير ومهام المتابعة المزمنة، وهندسة الإجراءات */
@Injectable()
export class ChangeService {
  constructor(private readonly db: DataSource, private readonly core: RiskCore) {}

  private async checkRisks(em: EntityManager, org: string, ids: string[] = []) {
    if (ids.length && (await em.getRepository(RiskItem).count({ where: { organizationId: org, id: In(ids) } })) !== new Set(ids).size) {
      throw new BadRequestException('أحد المخاطر المختارة غير موجود');
    }
  }

  // ---------------- مهام المتابعة ----------------

  private taskView(t: RiskTask) {
    return { ...t, overdue: t.status !== 'done' && t.status !== 'cancelled' && t.dueDate < today() };
  }

  async tasksOf(org: string, sourceType: string, sourceId: string, em: EntityManager = this.db.manager) {
    return (await em.getRepository(RiskTask).find({ where: { organizationId: org, sourceType, sourceId }, order: { dueDate: 'ASC', createdAt: 'ASC' } })).map((t) => this.taskView(t));
  }

  /** كل المهام: للمتابعة (مع اسم المصدر ورمزه) وفلترة «مهامي» */
  async listTasks(actor: OrgUser, q: { mine?: string; status?: string; unitId?: string }) {
    const org = actor.organizationId;
    const qb = this.db.getRepository(RiskTask).createQueryBuilder('t').where('t.organization_id = :org', { org });
    if (q.mine === '1') qb.andWhere('t.assignee_user_id = :u', { u: actor.id });
    if (q.status === 'open') qb.andWhere(`t.status IN ('open', 'in_progress')`);
    else if (q.status) qb.andWhere('t.status = :s', { s: q.status });
    if (q.unitId) qb.andWhere('t.unit_id = :unit', { unit: q.unitId });
    const rows = await qb.orderBy('t.due_date', 'ASC').getMany();
    const changeIds = rows.filter((t) => t.sourceType === 'change').map((t) => t.sourceId);
    const crisisIds = rows.filter((t) => t.sourceType === 'crisis').map((t) => t.sourceId);
    const [changes, events] = await Promise.all([
      changeIds.length ? this.db.getRepository(RiskChange).find({ where: { id: In(changeIds) }, select: { id: true, code: true, title: true } }) : [],
      crisisIds.length ? this.db.query('SELECT id, code, title FROM risk_crisis_events WHERE id = ANY($1)', [crisisIds]) : [],
    ]);
    const src = new Map<string, { code: string; title: string }>([...changes, ...events].map((c: { id: string; code: string; title: string }) => [c.id, c]));
    return rows.map((t) => ({ ...this.taskView(t), source: src.get(t.sourceId) ?? null }));
  }

  private async taskData(org: string, dto: TaskDto, em: EntityManager) {
    let assigneeName: string | null = null;
    if (dto.assigneeUserId) {
      const [u] = await em.query('SELECT full_name FROM users WHERE organization_id = $1 AND id = $2', [org, dto.assigneeUserId]);
      if (!u) throw new BadRequestException('المسؤول المختار غير موجود');
      assigneeName = u.full_name;
    }
    if (!dto.unitId && !dto.assigneeUserId) throw new BadRequestException('حدد الجهة المسؤولة من الهيكل أو الموظف المسؤول عن المهمة');
    if (dto.startDate && dto.startDate > dto.dueDate) throw new BadRequestException('تاريخ الاستحقاق قبل تاريخ البداية');
    return {
      title: dto.title, description: dto.description ?? null, unitId: dto.unitId ?? null, unitName: await this.core.unitName(org, dto.unitId, em),
      assigneeUserId: dto.assigneeUserId ?? null, assigneeName, startDate: dto.startDate ?? null, dueDate: dto.dueDate,
    };
  }

  /** إضافة مهمة على مصدر (طلب تغيير أو حالة أزمة) */
  async addTask(actor: OrgUser, sourceType: 'change' | 'crisis', sourceId: string, dto: TaskDto) {
    const org = actor.organizationId;
    return this.db.transaction(async (em) => {
      if (sourceType === 'change') {
        const c = await em.getRepository(RiskChange).findOne({ where: { id: sourceId, organizationId: org } });
        if (!c) throw new NotFoundException('طلب التغيير غير موجود');
        if (c.phase === 'closed' || c.status === 'rejected') throw new ConflictException('طلب التغيير مغلق أو مرفوض');
      } else {
        const [e] = await em.query('SELECT closed_at FROM risk_crisis_events WHERE organization_id = $1 AND id = $2', [org, sourceId]);
        if (!e) throw new NotFoundException('حالة الأزمة غير موجودة');
        if (e.closed_at) throw new ConflictException('حالة الأزمة منتهية');
      }
      const repo = em.getRepository(RiskTask);
      return repo.save(repo.create({ ...(await this.taskData(org, dto, em)), organizationId: org, sourceType, sourceId, createdByName: actor.fullName }));
    });
  }

  async updateTask(actor: OrgUser, id: string, dto: TaskDto) {
    const org = actor.organizationId;
    return this.db.transaction(async (em) => {
      const t = await em.getRepository(RiskTask).findOne({ where: { id, organizationId: org } });
      if (!t) throw new NotFoundException('المهمة غير موجودة');
      if (t.status === 'done') throw new ConflictException('المهمة منجزة');
      await em.getRepository(RiskTask).update({ id }, await this.taskData(org, dto, em));
      return this.taskView(await em.getRepository(RiskTask).findOneByOrFail({ id }));
    });
  }

  /** تحديث الإنجاز: المسؤول عن المهمة أو من يملك صلاحية إدارة التغيير. الإغلاق يلزمه توثيق ما تم */
  async progressTask(actor: OrgUser, id: string, dto: TaskProgressDto) {
    const repo = this.db.getRepository(RiskTask);
    const t = await repo.findOne({ where: { id, organizationId: actor.organizationId } });
    if (!t) throw new NotFoundException('المهمة غير موجودة');
    const manager = actor.isSuperadmin || actor.permissions.includes(t.sourceType === 'crisis' ? P.activateCrisis : P.change);
    if (!manager && t.assigneeUserId !== actor.id) throw new ForbiddenException('تحديث المهمة للمسؤول عنها أو لمدير التغيير');
    if (t.status === 'done' && dto.status !== 'done' && !manager) throw new ForbiddenException('إعادة فتح مهمة منجزة لمدير التغيير فقط');
    if (dto.status === 'done' && !dto.completionNote?.trim()) throw new BadRequestException('وثّق ما تم إنجازه لإغلاق المهمة');
    if (dto.status === 'cancelled' && !manager) throw new ForbiddenException('إلغاء المهمة لمدير التغيير فقط');
    await repo.update({ id }, {
      status: dto.status, progress: dto.status === 'done' ? 100 : dto.progress, completionNote: dto.completionNote ?? t.completionNote,
      completedAt: dto.status === 'done' ? t.completedAt ?? new Date() : null,
    });
    return this.taskView(await repo.findOneByOrFail({ id }));
  }

  async removeTask(actor: OrgUser, id: string) {
    const t = await this.db.getRepository(RiskTask).findOne({ where: { id, organizationId: actor.organizationId } });
    if (!t) throw new NotFoundException('المهمة غير موجودة');
    if (t.status !== 'open' || t.progress > 0) throw new ConflictException('مهمة بدأ تنفيذها لا تُحذف، ألغها بدلًا من ذلك');
    await this.db.getRepository(RiskTask).delete({ id });
  }

  // ---------------- سجل التغيير ----------------

  private changeView(c: RiskChange, tasks: ReturnType<ChangeService['taskView']>[]) {
    const active = tasks.filter((t) => t.status !== 'cancelled');
    return {
      ...c, tasksTotal: active.length, tasksDone: active.filter((t) => t.status === 'done').length, tasksOverdue: active.filter((t) => t.overdue).length,
      progress: active.length ? Math.round(active.reduce((s, t) => s + t.progress, 0) / active.length) : 0,
      impactLevel: Math.max(0, ...c.impacts.map((i) => i.level)),
    };
  }

  async listChanges(actor: OrgUser, q: { status?: string; phase?: string }) {
    const org = actor.organizationId;
    const where: Record<string, unknown> = { organizationId: org };
    if (q.status) where.status = q.status;
    if (q.phase) where.phase = q.phase;
    const rows = await this.db.getRepository(RiskChange).find({ where, order: { createdAt: 'DESC' } });
    const tasks = rows.length ? await this.db.getRepository(RiskTask).find({ where: { organizationId: org, sourceType: 'change', sourceId: In(rows.map((r) => r.id)) } }) : [];
    const stage = await this.core.stageInfo(actor, 'change');
    return rows.map((c) => ({ ...this.changeView(c, tasks.filter((t) => t.sourceId === c.id).map((t) => this.taskView(t))), ...stage(c) }));
  }

  async getChange(actor: OrgUser, id: string) {
    const org = actor.organizationId;
    const c = await this.db.getRepository(RiskChange).findOne({ where: { id, organizationId: org } });
    if (!c) throw new NotFoundException('طلب التغيير غير موجود');
    const tasks = await this.tasksOf(org, 'change', id);
    const risks = c.riskIds.length ? await this.db.getRepository(RiskItem).find({ where: { id: In(c.riskIds) }, select: { id: true, code: true, title: true, residualScore: true } }) : [];
    return { ...this.changeView(c, tasks), ...(await this.core.stageInfo(actor, 'change'))(c), tasks, risks };
  }

  private async changeData(org: string, dto: ChangeDto, em: EntityManager) {
    const cfg = await this.core.config(org, em);
    if (!cfg.changeTypes.some((t) => t.code === dto.changeType)) throw new BadRequestException('نوع التغيير غير معرّف في الإعدادات');
    if (dto.plannedStart && dto.plannedEnd && dto.plannedEnd < dto.plannedStart) throw new BadRequestException('تاريخ النهاية قبل البداية');
    await this.checkRisks(em, org, dto.riskIds);
    return {
      title: dto.title, changeType: dto.changeType, changeClass: dto.changeClass, priority: dto.priority, reason: dto.reason, description: dto.description ?? null,
      affectedUnits: dto.affectedUnits ?? null, impacts: dto.impacts.map((i) => ({ area: i.area, level: i.level, note: i.note ?? null })), benefits: dto.benefits ?? null,
      costEstimate: dto.costEstimate ?? null, riskIds: [...new Set(dto.riskIds ?? [])], communication: dto.communication ?? null,
      plannedStart: dto.plannedStart ?? null, plannedEnd: dto.plannedEnd ?? null,
    };
  }

  async createChange(actor: OrgUser, dto: ChangeDto) {
    const org = actor.organizationId;
    const id = await this.db.transaction(async (em) => {
      const repo = em.getRepository(RiskChange);
      return (await repo.save(repo.create({
        ...(await this.changeData(org, dto, em)), organizationId: org, code: await this.core.nextCode(em, org, 'CHG'), requestedBy: actor.fullName, createdByName: actor.fullName,
      }))).id;
    });
    return this.getChange(actor, id);
  }

  async updateChange(actor: OrgUser, id: string, dto: ChangeDto) {
    await this.db.transaction(async (em) => {
      const repo = em.getRepository(RiskChange);
      const c = await repo.findOne({ where: { id, organizationId: actor.organizationId }, lock: { mode: 'pessimistic_write' } });
      if (!c) throw new NotFoundException('طلب التغيير غير موجود');
      assertEditable(c);
      if (c.phase !== 'request') throw new ConflictException('بدأ تنفيذ التغيير، ولا يُعدّل نطاقه. قدّم طلب تغيير جديدًا');
      markEdited(c, actor.fullName);
      Object.assign(c, await this.changeData(actor.organizationId, dto, em));
      await repo.save(c);
    });
    return this.getChange(actor, id);
  }

  async removeChange(actor: OrgUser, id: string) {
    const c = await this.db.getRepository(RiskChange).findOne({ where: { id, organizationId: actor.organizationId } });
    if (!c) throw new NotFoundException('طلب التغيير غير موجود');
    if (c.approvals.length) throw new ConflictException('طلب رُفع للاعتماد مرة لا يُحذف');
    await this.db.transaction(async (em) => {
      await em.getRepository(RiskTask).delete({ organizationId: actor.organizationId, sourceType: 'change', sourceId: id });
      await em.getRepository(RiskChange).delete({ id });
    });
  }

  submitChange(actor: OrgUser, id: string) {
    return this.core.transition(actor, 'change', (em) => em.getRepository(RiskChange), id, { submit: true }, {
      beforeSubmit: (c) => { if (!c.impacts.length) throw new BadRequestException('أكمل تقييم أثر التغيير قبل رفعه للاعتماد'); },
    });
  }

  decideChange(actor: OrgUser, id: string, decision: 'approve' | 'return' | 'reject', note?: string | null) {
    return this.core.transition(actor, 'change', (em) => em.getRepository(RiskChange), id, { decision, note });
  }

  /** مراحل التنفيذ بعد الاعتماد: تنفيذ ← اكتمال (بمراجعة ما بعد التنفيذ) ← إغلاق (بعد إنجاز كل المهام) */
  async progressChange(actor: OrgUser, id: string, dto: ChangeProgressDto) {
    const org = actor.organizationId;
    await this.db.transaction(async (em) => {
      const repo = em.getRepository(RiskChange);
      const c = await repo.findOne({ where: { id, organizationId: org }, lock: { mode: 'pessimistic_write' } });
      if (!c) throw new NotFoundException('طلب التغيير غير موجود');
      // التغيير الطارئ يُنفذ قبل اكتمال اعتماده ويُستكمل توثيقه بعده
      if (c.status !== 'approved' && !(c.changeClass === 'emergency' && c.status !== 'rejected')) throw new ConflictException('لا يبدأ التنفيذ قبل اعتماد طلب التغيير');
      const order = ['request', 'implementing', 'completed', 'closed'];
      if (order.indexOf(dto.phase) !== order.indexOf(c.phase) + 1) throw new BadRequestException('انتقال غير صحيح بين مراحل التنفيذ');
      const tasks = await this.tasksOf(org, 'change', id, em);
      if (dto.phase === 'implementing' && !tasks.length) throw new BadRequestException('أضف مهام المتابعة الفرعية قبل بدء التنفيذ');
      if (dto.phase === 'completed') {
        if (tasks.some((t) => t.status !== 'done' && t.status !== 'cancelled')) throw new BadRequestException('أنجز كل مهام التغيير أو ألغها قبل اعتباره مكتملًا');
        if (!dto.reviewResult?.trim()) throw new BadRequestException('اكتب نتيجة المراجعة بعد التنفيذ');
      }
      if (dto.phase === 'closed' && c.status !== 'approved') throw new ConflictException('التغيير الطارئ لا يُغلق قبل استكمال اعتماده');
      Object.assign(c, {
        phase: dto.phase, reviewResult: dto.reviewResult ?? c.reviewResult, lessons: dto.lessons ?? c.lessons,
        closedAt: dto.phase === 'closed' ? new Date() : c.closedAt,
      });
      await repo.save(c);
    });
    return this.getChange(actor, id);
  }

  // ---------------- هندسة الإجراءات ----------------

  async listProcedures(actor: OrgUser) {
    const rows = await this.db.getRepository(RiskProcedure).find({ where: { organizationId: actor.organizationId }, order: { code: 'ASC' } });
    const stage = await this.core.stageInfo(actor, 'procedure');
    return rows.map((p) => ({
      id: p.id, code: p.code, name: p.name, domain: p.domain, ownerName: p.ownerName, status: p.status, revision: p.revision, approvedAt: p.approvedAt,
      steps: p.steps.length, controls: p.controlIds.length, risks: p.riskIds.length, totalDays: p.steps.reduce((s, x) => s + (x.durationDays ?? 0), 0), ...stage(p),
    }));
  }

  async getProcedure(actor: OrgUser, id: string) {
    const org = actor.organizationId;
    const p = await this.db.getRepository(RiskProcedure).findOne({ where: { id, organizationId: org } });
    if (!p) throw new NotFoundException('الإجراء غير موجود');
    const [risks, controls] = await Promise.all([
      p.riskIds.length ? this.db.getRepository(RiskItem).find({ where: { id: In(p.riskIds) }, select: { id: true, code: true, title: true, residualScore: true } }) : [],
      p.controlIds.length ? this.db.getRepository(RiskControl).find({ where: { id: In(p.controlIds) }, select: { id: true, code: true, name: true, effectiveness: true } }) : [],
    ]);
    return { ...p, ...(await this.core.stageInfo(actor, 'procedure'))(p), risks, controls, qualityCode: `${p.code} Rev.${String(p.revision).padStart(2, '0')}` };
  }

  private async procedureData(org: string, dto: ProcedureDto, em: EntityManager) {
    await this.checkRisks(em, org, dto.riskIds);
    const ctl = dto.controlIds ?? [];
    if (ctl.length && (await em.getRepository(RiskControl).count({ where: { organizationId: org, id: In(ctl) } })) !== new Set(ctl).size) {
      throw new BadRequestException('أحد الضوابط المختارة غير موجود');
    }
    return {
      name: dto.name, domain: dto.domain, purpose: dto.purpose ?? null, scope: dto.scope ?? null, ownerName: dto.ownerName ?? null, inputs: dto.inputs ?? null,
      outputs: dto.outputs ?? null,
      steps: dto.steps.map((s) => ({ title: s.title, actor: s.actor, description: s.description ?? null, durationDays: s.durationDays ?? null, output: s.output ?? null, control: s.control ?? null, decision: s.decision })),
      kpis: (dto.kpis ?? []).filter((k) => k?.name?.trim()).map((k) => ({ name: String(k.name).slice(0, 200), target: String(k.target ?? '').slice(0, 100) })),
      riskIds: [...new Set(dto.riskIds ?? [])], controlIds: [...new Set(ctl)],
    };
  }

  async createProcedure(actor: OrgUser, dto: ProcedureDto) {
    const org = actor.organizationId;
    const id = await this.db.transaction(async (em) => {
      const repo = em.getRepository(RiskProcedure);
      return (await repo.save(repo.create({ ...(await this.procedureData(org, dto, em)), organizationId: org, code: await this.core.nextCode(em, org, 'PRC'), createdByName: actor.fullName }))).id;
    });
    return this.getProcedure(actor, id);
  }

  async updateProcedure(actor: OrgUser, id: string, dto: ProcedureDto) {
    await this.db.transaction(async (em) => {
      const repo = em.getRepository(RiskProcedure);
      const p = await repo.findOne({ where: { id, organizationId: actor.organizationId }, lock: { mode: 'pessimistic_write' } });
      if (!p) throw new NotFoundException('الإجراء غير موجود');
      assertEditable(p);
      markEdited(p, actor.fullName);
      Object.assign(p, await this.procedureData(actor.organizationId, dto, em));
      await repo.save(p);
    });
    return this.getProcedure(actor, id);
  }

  async removeProcedure(actor: OrgUser, id: string) {
    const p = await this.db.getRepository(RiskProcedure).findOne({ where: { id, organizationId: actor.organizationId } });
    if (!p) throw new NotFoundException('الإجراء غير موجود');
    if (p.approvedAt) throw new ConflictException('إجراء اعتُمد مرة لا يُحذف');
    await this.db.getRepository(RiskProcedure).delete({ id });
  }

  submitProcedure(actor: OrgUser, id: string) {
    return this.core.transition(actor, 'procedure', (em) => em.getRepository(RiskProcedure), id, { submit: true }, {
      beforeSubmit: (p) => { if (p.steps.length < 2) throw new BadRequestException('وثّق خطوتين على الأقل قبل رفع الإجراء للاعتماد'); },
    });
  }

  decideProcedure(actor: OrgUser, id: string, decision: 'approve' | 'return' | 'reject', note?: string | null) {
    return this.core.transition(actor, 'procedure', (em) => em.getRepository(RiskProcedure), id, { decision, note });
  }
}
