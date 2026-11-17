import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, In, Repository } from 'typeorm';
import { OrgUser } from '../../core/auth/decorators';
import { FileStore } from '../../core/files/file-store.service';
import { EngagementDto, FindingDto, IssueDto, ItemDto, ItemResultDto, StageDto } from './audit.dto';
import {
  ACTION_STATUS_AR, AuditCore, ENG_STATUS_AR, ITEM_RESULT_AR, LEVEL_AR, OPINION_AR, PLAN_STATUS_AR, addDays, daysBetween, today,
} from './audit-core.service';
import {
  AuditAction, AuditArea, AuditDocument, AuditEngagement, AuditFinding, AuditItem, AuditPlan, RiskLevel, TeamMember,
} from './entities/audit.entity';
import { liveRefs } from './planning.service';

/** تنفيذ مهام المراجعة: التوزيع، برنامج العمل، الملاحظات والتوصيات، التقرير، وتحويل التوصيات إلى مهام متابعة */
@Injectable()
export class EngagementService {
  constructor(
    private readonly db: DataSource,
    private readonly core: AuditCore,
    private readonly files: FileStore,
    @InjectRepository(AuditEngagement) private readonly engagements: Repository<AuditEngagement>,
    @InjectRepository(AuditItem) private readonly items: Repository<AuditItem>,
    @InjectRepository(AuditFinding) private readonly findings: Repository<AuditFinding>,
    @InjectRepository(AuditAction) private readonly actions: Repository<AuditAction>,
    @InjectRepository(AuditDocument) private readonly docs: Repository<AuditDocument>,
  ) {}

  async find(org: string, id: string) {
    return (await this.engagements.findOne({ where: { id, organizationId: org } })) ?? this.core.notFound('مهمة المراجعة');
  }

  private log(e: AuditEngagement, actor: OrgUser, action: string, note?: string | null) {
    e.history = [...e.history, { at: new Date().toISOString(), by: actor.fullName, action, note: note ?? null }];
  }

  async list(actor: OrgUser, q: { year?: number; planId?: string; status?: string; mine?: boolean }) {
    const org = actor.organizationId;
    const qb = this.engagements.createQueryBuilder('e').innerJoin(AuditPlan, 'p', 'p.id = e.plan_id')
      .where('e.organization_id = :org', { org }).orderBy('e.planned_start', 'ASC').addOrderBy('e.code', 'ASC')
      .addSelect(['p.code', 'p.title', 'p.kind']);
    if (q.year) qb.andWhere('p.year = :year', { year: q.year });
    if (q.planId) qb.andWhere('(e.plan_id = :plan OR p.parent_id = :plan)', { plan: q.planId });
    if (q.status) qb.andWhere('e.status = :status', { status: q.status });
    if (q.mine) qb.andWhere(`(e.lead_user_id = :me OR e.team @> :member::jsonb)`, { me: actor.id, member: JSON.stringify([{ userId: actor.id }]) });
    const { entities, raw } = await qb.getRawAndEntities();
    const ids = entities.map((e) => e.id);
    const units = await this.core.unitNames(org);
    const prog: { engagement_id: string; total: number; tested: number }[] = ids.length ? await this.db.query(
      `SELECT engagement_id, COUNT(*)::int AS total, COUNT(*) FILTER (WHERE result <> 'pending')::int AS tested FROM audit_items
       WHERE organization_id = $1 AND engagement_id = ANY($2::uuid[]) GROUP BY 1`, [org, ids]) : [];
    const fnd: { engagement_id: string; n: number }[] = ids.length ? await this.db.query(
      'SELECT engagement_id, COUNT(*)::int AS n FROM audit_findings WHERE organization_id = $1 AND engagement_id = ANY($2::uuid[]) GROUP BY 1', [org, ids]) : [];
    const act: { engagement_id: string; total: number; closed: number; overdue: number }[] = ids.length ? await this.db.query(
      `SELECT engagement_id, COUNT(*)::int AS total, COUNT(*) FILTER (WHERE status = 'closed')::int AS closed,
         COUNT(*) FILTER (WHERE status IN ('open','in_progress','submitted') AND due_date < $3)::int AS overdue
       FROM audit_actions WHERE organization_id = $1 AND engagement_id = ANY($2::uuid[]) AND status <> 'cancelled' GROUP BY 1`, [org, ids, today()]) : [];
    const pm = new Map(prog.map((x) => [x.engagement_id, x]));
    const fm = new Map(fnd.map((x) => [x.engagement_id, x.n]));
    const am = new Map(act.map((x) => [x.engagement_id, x]));
    return entities.map((e, i) => {
      const pr = pm.get(e.id);
      return {
        id: e.id, code: e.code, title: e.title, planId: e.planId, planCode: raw[i].p_code, planTitle: raw[i].p_title, planKind: raw[i].p_kind,
        priority: e.priority, priorityLabel: LEVEL_AR[e.priority], status: e.status, statusLabel: ENG_STATUS_AR[e.status],
        scopeType: e.scopeType, scopeLabel: e.scopeType === 'unit' ? units.get(e.unitId ?? '') ?? '—' : e.outsideLabel,
        plannedStart: e.plannedStart, plannedEnd: e.plannedEnd, actualStart: e.actualStart, actualEnd: e.actualEnd, leadName: e.leadName, team: e.team,
        budgetHours: e.budgetHours, actualHours: e.actualHours, risks: e.riskRefs.length,
        items: pr?.total ?? 0, tested: pr?.tested ?? 0, progress: pr?.total ? Math.round((pr.tested / pr.total) * 100) : 0,
        findings: fm.get(e.id) ?? 0, actions: am.get(e.id) ?? { total: 0, closed: 0, overdue: 0 },
        late: ['planned', 'fieldwork', 'review'].includes(e.status) && e.plannedEnd < today(),
      };
    });
  }

  async get(actor: OrgUser, id: string) {
    const org = actor.organizationId;
    const e = await this.find(org, id);
    const [plan, area, items, findings, actions, docs, units, risks, users] = await Promise.all([
      this.db.getRepository(AuditPlan).findOneOrFail({ where: { id: e.planId } }),
      e.areaId ? this.db.getRepository(AuditArea).findOne({ where: { id: e.areaId } }) : null,
      this.items.find({ where: { organizationId: org, engagementId: id }, order: { seq: 'ASC' } }),
      this.findings.find({ where: { organizationId: org, engagementId: id }, order: { seq: 'ASC' } }),
      this.actions.find({ where: { organizationId: org, engagementId: id }, order: { code: 'ASC' } }),
      this.docs.find({ where: { organizationId: org, ownerType: 'engagement', ownerId: id }, order: { createdAt: 'ASC' } }),
      this.core.unitNames(org), this.core.risks(org), this.core.users(org),
    ]);
    const live = new Map(risks.map((r) => [r.id, r]));
    const userName = new Map(users.map((u) => [u.id, u.fullName]));
    const t = today();
    const actionOf = new Map(actions.map((a) => [a.findingId, a]));
    const fView = (f: AuditFinding) => {
      const a = actionOf.get(f.id);
      return {
        id: f.id, itemId: f.itemId, seq: f.seq, title: f.title, observation: f.observation, cause: f.cause, effect: f.effect, rating: f.rating, ratingLabel: LEVEL_AR[f.rating],
        recommendation: f.recommendation, responsibleUnitId: f.responsibleUnitId, responsibleUnitName: units.get(f.responsibleUnitId) ?? '—',
        responsibleUserId: f.responsibleUserId, responsibleUserName: f.responsibleUserId ? userName.get(f.responsibleUserId) ?? null : null,
        dueDate: f.dueDate, managementResponse: f.managementResponse, riskRefs: liveRefs(f.riskRefs, live), createdByName: f.createdByName,
        action: a ? { id: a.id, code: a.code, status: a.status, statusLabel: ACTION_STATUS_AR[a.status], dueDate: a.dueDate, progress: a.progress, overdue: ['open', 'in_progress', 'submitted'].includes(a.status) && a.dueDate < t } : null,
      };
    };
    const tested = items.filter((i) => i.result !== 'pending').length;
    return {
      id: e.id, code: e.code, title: e.title, objective: e.objective, scope: e.scope, scopeType: e.scopeType, unitId: e.unitId, outsideLabel: e.outsideLabel,
      scopeLabel: e.scopeType === 'unit' ? units.get(e.unitId ?? '') ?? '—' : e.outsideLabel,
      plan: { id: plan.id, code: plan.code, title: plan.title, kind: plan.kind, status: plan.status, statusLabel: PLAN_STATUS_AR[plan.status], year: plan.year },
      area: area ? { id: area.id, code: area.code, name: area.name } : null, areaId: e.areaId,
      riskRefs: liveRefs(e.riskRefs, live), priority: e.priority, priorityLabel: LEVEL_AR[e.priority], status: e.status, statusLabel: ENG_STATUS_AR[e.status],
      plannedStart: e.plannedStart, plannedEnd: e.plannedEnd, actualStart: e.actualStart, actualEnd: e.actualEnd, budgetHours: e.budgetHours, actualHours: e.actualHours,
      leadUserId: e.leadUserId, leadName: e.leadName, team: e.team, reviewNote: e.reviewNote,
      report: e.reportIssuedAt ? {
        no: e.reportNo, summary: e.reportSummary, opinion: e.reportOpinion, opinionLabel: e.reportOpinion ? OPINION_AR[e.reportOpinion] : null,
        issuedAt: e.reportIssuedAt, issuedByName: e.reportIssuedByName,
      } : null,
      closedAt: e.closedAt, closureNote: e.closureNote, history: e.history,
      progress: { items: items.length, tested, percent: items.length ? Math.round((tested / items.length) * 100) : 0 },
      items: items.map((i) => ({
        id: i.id, seq: i.seq, title: i.title, criteria: i.criteria, procedure: i.procedure, controlRef: i.controlRef, result: i.result, resultLabel: ITEM_RESULT_AR[i.result],
        conclusion: i.conclusion, testedByName: i.testedByName, testedAt: i.testedAt, findings: findings.filter((f) => f.itemId === i.id).map(fView),
      })),
      findingsCount: findings.length,
      ratings: Object.fromEntries((['critical', 'high', 'medium', 'low'] as const).map((l) => [l, findings.filter((f) => f.rating === l).length])),
      actions: { total: actions.length, closed: actions.filter((a) => a.status === 'closed').length, overdue: actions.filter((a) => ['open', 'in_progress', 'submitted'].includes(a.status) && a.dueDate < t).length },
      documents: docs.map((d) => ({ id: d.id, kind: d.kind, title: d.title, fileName: d.fileName, uploadedByName: d.uploadedByName, createdAt: d.createdAt })),
    };
  }

  // ---------------- إنشاء المهمة وتوزيعها ----------------

  private async fields(org: string, dto: EngagementDto) {
    const plan = (await this.db.getRepository(AuditPlan).findOne({ where: { id: dto.planId, organizationId: org } })) ?? this.core.notFound('الخطة');
    if (plan.status === 'closed') throw new BadRequestException('الخطة مغلقة');
    if (dto.plannedEnd < dto.plannedStart) throw new BadRequestException('نهاية المهمة قبل بدايتها');
    if (dto.plannedStart < plan.periodFrom || dto.plannedEnd > plan.periodTo) throw new BadRequestException(`مواعيد المهمة خارج فترة الخطة ${plan.code}`);
    if (dto.areaId && !(await this.db.getRepository(AuditArea).exist({ where: { id: dto.areaId, organizationId: org } }))) throw new BadRequestException('مجال المراجعة غير موجود');
    const scope = await this.core.checkScope(org, dto.scopeType, dto.unitId, dto.outsideLabel);
    const leadName = dto.leadUserId ? await this.core.userName(org, dto.leadUserId) : null;
    const team: TeamMember[] = [];
    for (const m of dto.team ?? []) {
      if (m.userId === dto.leadUserId) continue;
      if (team.some((t) => t.userId === m.userId)) continue;
      team.push({ userId: m.userId, name: await this.core.userName(org, m.userId), role: m.role || 'مراجع' });
    }
    return {
      planId: plan.id, areaId: dto.areaId ?? null, title: dto.title, objective: dto.objective ?? null, scope: dto.scope ?? null, scopeType: dto.scopeType, ...scope,
      riskRefs: dto.riskRefs ?? [], priority: dto.priority as RiskLevel, plannedStart: dto.plannedStart, plannedEnd: dto.plannedEnd,
      budgetHours: dto.budgetHours ?? 0, leadUserId: dto.leadUserId ?? null, leadName, team, year: plan.year,
    };
  }

  async create(actor: OrgUser, dto: EngagementDto) {
    const org = actor.organizationId;
    const { year, ...f } = await this.fields(org, dto);
    return this.db.transaction(async (em) => {
      const no = await this.core.nextNo(em, org, 'nextEngagementNo');
      const e = em.getRepository(AuditEngagement).create({ ...f, organizationId: org, code: `IA-${year}-${String(no).padStart(3, '0')}`, history: [] });
      this.log(e, actor, 'إنشاء المهمة', f.leadName ? `قائد المهمة: ${f.leadName}` : null);
      await em.getRepository(AuditEngagement).save(e);
      return { id: e.id, code: e.code };
    });
  }

  async update(actor: OrgUser, id: string, dto: EngagementDto) {
    const org = actor.organizationId;
    const e = await this.find(org, id);
    if (!['planned', 'fieldwork'].includes(e.status)) throw new BadRequestException('لا تُعدَّل المهمة بعد رفع تقريرها');
    const { year: _y, ...f } = await this.fields(org, dto);
    const assigned = f.leadUserId !== e.leadUserId || JSON.stringify(f.team) !== JSON.stringify(e.team);
    Object.assign(e, f);
    this.log(e, actor, assigned ? 'تعديل المهمة وتوزيع الفريق' : 'تعديل المهمة');
    await this.engagements.save(e);
    return { id };
  }

  async remove(actor: OrgUser, id: string) {
    const org = actor.organizationId;
    const e = await this.find(org, id);
    if (e.status !== 'planned') throw new BadRequestException('لا تُحذف إلا المهمة المخططة التي لم تبدأ، ويمكن إلغاؤها بدل ذلك');
    if (await this.findings.exist({ where: { organizationId: org, engagementId: id } })) throw new ConflictException('على المهمة ملاحظات');
    await this.db.transaction(async (em) => {
      await em.delete(AuditItem, { organizationId: org, engagementId: id });
      await em.delete(AuditEngagement, { id, organizationId: org });
    });
  }

  /** مراحل التنفيذ: بدء العمل الميداني، رفع التقرير للمراجعة، إعادته للفريق، أو الإلغاء */
  async stage(actor: OrgUser, id: string, dto: StageDto, canReview: boolean) {
    const org = actor.organizationId;
    const e = await this.find(org, id);
    if (dto.action === 'start') {
      if (e.status !== 'planned') throw new BadRequestException('المهمة بدأت بالفعل');
      const plan = await this.db.getRepository(AuditPlan).findOneOrFail({ where: { id: e.planId } });
      if (plan.status !== 'approved') throw new BadRequestException(`لا تبدأ المهمة قبل اعتماد الخطة ${plan.code}`);
      if (!e.leadUserId) throw new BadRequestException('حدد قائد المهمة قبل البدء');
      Object.assign(e, { status: 'fieldwork', actualStart: today() });
      this.log(e, actor, 'بدء العمل الميداني');
    } else if (dto.action === 'submit') {
      if (e.status !== 'fieldwork') throw new BadRequestException('المهمة ليست قيد التنفيذ');
      const items = await this.items.find({ where: { organizationId: org, engagementId: id } });
      if (!items.length) throw new BadRequestException('أضف بنود برنامج المراجعة أولًا');
      const pending = items.filter((i) => i.result === 'pending');
      if (pending.length) throw new BadRequestException(`باقي ${pending.length} بند لم تُسجَّل نتيجته: ${pending.map((i) => i.seq).join('، ')}`);
      const fs = await this.findings.find({ where: { organizationId: org, engagementId: id } });
      const empty = items.filter((i) => i.result === 'finding' && !fs.some((f) => f.itemId === i.id));
      if (empty.length) throw new BadRequestException(`البند ${empty.map((i) => i.seq).join('، ')} نتيجته «عليه ملاحظة» بدون ملاحظة مسجلة`);
      Object.assign(e, { status: 'review', actualEnd: today(), reviewNote: null, actualHours: dto.actualHours ?? e.actualHours });
      this.log(e, actor, 'رفع مسودة التقرير للمراجعة والاعتماد', dto.note);
    } else if (dto.action === 'return') {
      if (!canReview) throw new BadRequestException('إعادة التقرير لمن يملك صلاحية إصدار التقارير');
      if (e.status !== 'review') throw new BadRequestException('المهمة ليست بانتظار المراجعة');
      if (!dto.note) throw new BadRequestException('اكتب سبب الإعادة');
      Object.assign(e, { status: 'fieldwork', reviewNote: dto.note, actualEnd: null });
      this.log(e, actor, 'إعادة للفريق', dto.note);
    } else {
      if (!['planned', 'fieldwork'].includes(e.status)) throw new BadRequestException('لا تُلغى المهمة بعد رفع تقريرها');
      if (!dto.note) throw new BadRequestException('اكتب سبب الإلغاء');
      e.status = 'cancelled';
      this.log(e, actor, 'إلغاء المهمة', dto.note);
    }
    await this.engagements.save(e);
    return { id, status: e.status };
  }

  // ---------------- برنامج العمل ----------------

  private async editable(org: string, id: string, allowPlanned = true) {
    const e = await this.find(org, id);
    if (e.status !== 'fieldwork' && !(allowPlanned && e.status === 'planned')) {
      throw new BadRequestException(e.status === 'planned' ? 'ابدأ العمل الميداني أولًا' : 'المهمة ليست قيد التنفيذ');
    }
    return e;
  }

  async addItem(actor: OrgUser, id: string, dto: ItemDto) {
    const org = actor.organizationId;
    await this.editable(org, id);
    const [{ n }] = await this.db.query('SELECT COALESCE(MAX(seq),0)::int AS n FROM audit_items WHERE organization_id = $1 AND engagement_id = $2', [org, id]);
    const i = await this.items.save(this.items.create({
      organizationId: org, engagementId: id, seq: n + 1, title: dto.title, criteria: dto.criteria ?? null, procedure: dto.procedure ?? null, controlRef: dto.controlRef ?? null,
    }));
    return { id: i.id };
  }

  private async item(org: string, id: string, itemId: string) {
    return (await this.items.findOne({ where: { id: itemId, organizationId: org, engagementId: id } })) ?? this.core.notFound('بند المراجعة');
  }

  async updateItem(actor: OrgUser, id: string, itemId: string, dto: ItemDto) {
    const org = actor.organizationId;
    await this.editable(org, id);
    const i = await this.item(org, id, itemId);
    Object.assign(i, { title: dto.title, criteria: dto.criteria ?? null, procedure: dto.procedure ?? null, controlRef: dto.controlRef ?? null });
    await this.items.save(i);
    return { id: itemId };
  }

  async removeItem(actor: OrgUser, id: string, itemId: string) {
    const org = actor.organizationId;
    await this.editable(org, id);
    await this.item(org, id, itemId);
    if (await this.findings.exist({ where: { organizationId: org, itemId } })) throw new ConflictException('على البند ملاحظات، احذفها أولًا');
    await this.items.delete({ id: itemId, organizationId: org });
  }

  async setResult(actor: OrgUser, id: string, itemId: string, dto: ItemResultDto) {
    const org = actor.organizationId;
    await this.editable(org, id, false);
    const i = await this.item(org, id, itemId);
    const hasFindings = await this.findings.exist({ where: { organizationId: org, itemId } });
    if (hasFindings && dto.result !== 'finding') throw new BadRequestException('على البند ملاحظات، فنتيجته «عليه ملاحظة»');
    if (dto.result === 'satisfactory' && !dto.conclusion) throw new BadRequestException('اكتب خلاصة الاختبار وما تم فحصه');
    Object.assign(i, { result: dto.result, conclusion: dto.conclusion ?? null, testedByName: dto.result === 'pending' ? null : actor.fullName, testedAt: dto.result === 'pending' ? null : new Date() });
    await this.items.save(i);
    return { id: itemId };
  }

  // ---------------- الملاحظات والتوصيات ----------------

  private async findingFields(org: string, dto: FindingDto) {
    await this.core.checkUnit(org, dto.responsibleUnitId);
    if (dto.responsibleUserId) await this.core.userName(org, dto.responsibleUserId);
    const s = await this.core.settings(org);
    const dueDate = dto.dueDate ?? addDays(today(), s.dueDays[dto.rating as RiskLevel]);
    if (dueDate < today()) throw new BadRequestException('موعد تنفيذ التوصية في الماضي');
    return {
      title: dto.title, observation: dto.observation, cause: dto.cause ?? null, effect: dto.effect, rating: dto.rating as RiskLevel, recommendation: dto.recommendation,
      responsibleUnitId: dto.responsibleUnitId, responsibleUserId: dto.responsibleUserId ?? null, dueDate, managementResponse: dto.managementResponse ?? null,
      riskRefs: dto.riskRefs ?? [],
    };
  }

  async addFinding(actor: OrgUser, id: string, dto: FindingDto) {
    const org = actor.organizationId;
    const e = await this.editable(org, id, false);
    const i = await this.item(org, id, dto.itemId);
    const f = await this.findingFields(org, dto);
    return this.db.transaction(async (em) => {
      const [{ n }] = await em.query('SELECT COALESCE(MAX(seq),0)::int AS n FROM audit_findings WHERE organization_id = $1 AND engagement_id = $2', [org, e.id]);
      const row = await em.getRepository(AuditFinding).save(em.getRepository(AuditFinding).create({ ...f, organizationId: org, engagementId: id, itemId: i.id, seq: n + 1, createdByName: actor.fullName }));
      await em.update(AuditItem, { id: i.id }, { result: 'finding', testedByName: actor.fullName, testedAt: new Date() });
      return { id: row.id };
    });
  }

  private async finding(org: string, id: string, findingId: string) {
    return (await this.findings.findOne({ where: { id: findingId, organizationId: org, engagementId: id } })) ?? this.core.notFound('الملاحظة');
  }

  /** الملاحظة تُعدَّل أثناء العمل الميداني، وردّ الإدارة يُضاف أيضًا أثناء مراجعة التقرير */
  async updateFinding(actor: OrgUser, id: string, findingId: string, dto: FindingDto) {
    const org = actor.organizationId;
    const e = await this.find(org, id);
    if (!['fieldwork', 'review'].includes(e.status)) throw new BadRequestException('لا تُعدَّل الملاحظات بعد إصدار التقرير');
    const row = await this.finding(org, id, findingId);
    const f = await this.findingFields(org, dto);
    if (dto.itemId !== row.itemId) {
      await this.item(org, id, dto.itemId);
      row.itemId = dto.itemId;
      await this.items.update({ id: dto.itemId }, { result: 'finding' });
    }
    Object.assign(row, f);
    await this.findings.save(row);
    return { id: findingId };
  }

  async removeFinding(actor: OrgUser, id: string, findingId: string) {
    const org = actor.organizationId;
    await this.editable(org, id, false);
    await this.finding(org, id, findingId);
    await this.findings.delete({ id: findingId, organizationId: org });
  }

  // ---------------- التقرير وتحويل التوصيات ----------------

  /** اعتماد التقرير وإصداره: كل توصية تتحول إلى مهمة متابعة مزمنة للجهة المسؤولة */
  async issue(actor: OrgUser, id: string, dto: IssueDto) {
    const org = actor.organizationId;
    const e = await this.find(org, id);
    if (e.status !== 'review') throw new BadRequestException('التقرير ليس بانتظار الاعتماد');
    const plan = await this.db.getRepository(AuditPlan).findOneOrFail({ where: { id: e.planId } });
    const fs = await this.findings.find({ where: { organizationId: org, engagementId: id }, order: { seq: 'ASC' } });
    const users = new Map((await this.core.users(org)).map((u) => [u.id, u.fullName]));
    let created = 0;
    await this.db.transaction(async (em) => {
      for (const f of fs) {
        if (f.dueDate < today()) throw new BadRequestException(`موعد التوصية في الملاحظة ${f.seq} مضى، حدّثه قبل الإصدار`);
        const no = await this.core.nextNo(em, org, 'nextActionNo');
        await em.getRepository(AuditAction).save(em.getRepository(AuditAction).create({
          organizationId: org, code: `AT-${plan.year}-${String(no).padStart(3, '0')}`, source: 'audit', engagementId: id, findingId: f.id,
          title: f.title, description: f.recommendation, priority: f.rating, responsibleUnitId: f.responsibleUnitId,
          assigneeUserId: f.responsibleUserId, assigneeName: f.responsibleUserId ? users.get(f.responsibleUserId) ?? null : null,
          startDate: today(), dueDate: f.dueDate, originalDueDate: f.dueDate, status: 'open', progress: 0,
          log: [{ at: new Date().toISOString(), by: actor.fullName, kind: 'create', text: `أُنشئت من تقرير المراجعة ${e.code}` }],
        }));
        created++;
      }
      Object.assign(e, {
        status: fs.length ? 'issued' : 'closed', reportNo: `${e.code}-R`, reportSummary: dto.summary, reportOpinion: dto.opinion,
        reportIssuedAt: new Date(), reportIssuedByName: actor.fullName, closedAt: fs.length ? null : new Date(),
      });
      this.log(e, actor, 'اعتماد التقرير وإصداره', created ? `تحولت ${created} توصية إلى مهام متابعة` : 'لا توجد ملاحظات، أُغلقت المهمة');
      await em.getRepository(AuditEngagement).save(e);
      if (e.areaId) await em.update(AuditArea, { id: e.areaId }, { lastAuditDate: today() });
    });
    return { id, actions: created, status: e.status };
  }

  /** إغلاق المهمة بعد إغلاق كل توصياتها بتقارير الإغلاق الموثقة */
  async close(actor: OrgUser, id: string, note?: string | null) {
    const org = actor.organizationId;
    const e = await this.find(org, id);
    if (e.status !== 'issued') throw new BadRequestException('المهمة ليست في مرحلة متابعة التوصيات');
    const open = await this.actions.count({ where: { organizationId: org, engagementId: id, status: In(['open', 'in_progress', 'submitted']) } });
    if (open) throw new BadRequestException(`باقي ${open} توصية لم تُغلق بتقرير إغلاق معتمد`);
    Object.assign(e, { status: 'closed', closedAt: new Date(), closureNote: note ?? null });
    this.log(e, actor, 'إغلاق المهمة', note);
    await this.engagements.save(e);
    return { id };
  }

  // ---------------- المستندات ----------------

  async addDocument(actor: OrgUser, ownerType: 'engagement' | 'action', ownerId: string, title: string, kind: AuditDocument['kind'], file: Express.Multer.File, em?: EntityManager) {
    const saved = await this.files.save(`audit/${actor.organizationId}`, file, 'المستند');
    const repo = (em ?? this.db.manager).getRepository(AuditDocument);
    const d = await repo.save(repo.create({
      organizationId: actor.organizationId, ownerType, ownerId, kind, title, fileKey: saved.key, fileName: saved.name, mimeType: saved.mime, uploadedByName: actor.fullName,
    }));
    return { id: d.id };
  }

  async document(org: string, ownerType: 'engagement' | 'action', ownerId: string, docId: string) {
    const doc = (await this.docs.findOne({ where: { id: docId, organizationId: org, ownerType, ownerId } })) ?? this.core.notFound('المستند');
    return { doc, stream: this.files.open(doc.fileKey) };
  }

  async removeDocument(org: string, ownerType: 'engagement' | 'action', ownerId: string, docId: string) {
    const doc = (await this.docs.findOne({ where: { id: docId, organizationId: org, ownerType, ownerId } })) ?? this.core.notFound('المستند');
    await this.docs.delete({ id: doc.id });
    await this.files.remove(doc.fileKey).catch(() => undefined);
  }

  daysLeft(due: string) {
    return daysBetween(today(), due);
  }
}
