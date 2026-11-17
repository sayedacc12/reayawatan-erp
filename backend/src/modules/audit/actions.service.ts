import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { OrgUser } from '../../core/auth/decorators';
import { ActionUpdateDto, AssignDto, ClosureDto, ExtendDto, VerifyDto } from './audit.dto';
import { AUDIT_PERMISSIONS as P } from './audit.manifest';
import { ACTION_STATUS_AR, AuditCore, LEVEL_AR, daysBetween, today } from './audit-core.service';
import { ActionLog, AuditAction, AuditDocument, AuditEngagement, AuditFinding } from './entities/audit.entity';

const OPEN = ['open', 'in_progress', 'submitted'];

/**
 * متابعة التوصيات: كل توصية مهمة مزمنة لجهة في الهيكل، تتابعها الجهة بنسبة الإنجاز والملاحظات،
 * ثم تقدّم تقرير الإغلاق الموثق، ويتحقق منه المراجع فيغلقها أو يعيدها.
 */
@Injectable()
export class ActionsService {
  constructor(
    private readonly db: DataSource,
    private readonly core: AuditCore,
    @InjectRepository(AuditAction) private readonly actions: Repository<AuditAction>,
  ) {}

  private isOverdue(a: Pick<AuditAction, 'status' | 'dueDate'>) {
    return OPEN.includes(a.status) && a.dueDate < today();
  }

  private row(a: AuditAction, units: Map<string, string>, eng?: { code: string; title: string }) {
    const overdue = this.isOverdue(a);
    return {
      id: a.id, code: a.code, source: a.source, engagementId: a.engagementId, engagementCode: eng?.code ?? null, engagementTitle: eng?.title ?? null,
      findingId: a.findingId, title: a.title, description: a.description, priority: a.priority, priorityLabel: LEVEL_AR[a.priority],
      responsibleUnitId: a.responsibleUnitId, responsibleUnitName: units.get(a.responsibleUnitId) ?? '—', assigneeUserId: a.assigneeUserId, assigneeName: a.assigneeName,
      startDate: a.startDate, dueDate: a.dueDate, originalDueDate: a.originalDueDate, extended: a.dueDate !== a.originalDueDate,
      status: a.status, statusLabel: overdue ? `${ACTION_STATUS_AR[a.status]} · متأخرة` : ACTION_STATUS_AR[a.status], overdue,
      daysLeft: OPEN.includes(a.status) ? daysBetween(today(), a.dueDate) : null, progress: a.progress, closureReport: a.closureReport,
      verifiedByName: a.verifiedByName, closedAt: a.closedAt, updatedAt: a.updatedAt,
    };
  }

  async list(actor: OrgUser, q: { status?: string; unitId?: string; mine?: boolean; engagementId?: string; priority?: string }) {
    const org = actor.organizationId;
    const qb = this.actions.createQueryBuilder('a').where('a.organization_id = :org', { org }).orderBy('a.due_date', 'ASC');
    if (q.status === 'overdue') qb.andWhere(`a.status IN ('open','in_progress','submitted') AND a.due_date < :t`, { t: today() });
    else if (q.status === 'active') qb.andWhere(`a.status IN ('open','in_progress','submitted')`);
    else if (q.status) qb.andWhere('a.status = :s', { s: q.status });
    if (q.unitId) qb.andWhere('a.responsible_unit_id = :u', { u: q.unitId });
    if (q.engagementId) qb.andWhere('a.engagement_id = :e', { e: q.engagementId });
    if (q.priority) qb.andWhere('a.priority = :p', { p: q.priority });
    // «مهامي»: المسندة إلي. ومن لا يملك صلاحية العرض العامة يرى المسند إليه والمسند للجهات دون شخص محدد
    if (q.mine) qb.andWhere('a.assignee_user_id = :me', { me: actor.id });
    else if (!actor.permissions.includes(P.read)) qb.andWhere('(a.assignee_user_id = :me OR a.assignee_user_id IS NULL)', { me: actor.id });
    const rows = await qb.getMany();
    const units = await this.core.unitNames(org);
    const engs = await this.engagementMap(org, [...new Set(rows.map((r) => r.engagementId))]);
    const list = rows.map((a) => this.row(a, units, engs.get(a.engagementId)));
    return {
      items: list,
      counts: {
        active: list.filter((a) => OPEN.includes(a.status)).length, overdue: list.filter((a) => a.overdue).length,
        submitted: list.filter((a) => a.status === 'submitted').length, closed: list.filter((a) => a.status === 'closed').length,
      },
    };
  }

  private async engagementMap(org: string, ids: string[]) {
    if (!ids.length) return new Map<string, { code: string; title: string }>();
    const rows: { id: string; code: string; title: string }[] = await this.db.query(
      'SELECT id, code, title FROM audit_engagements WHERE organization_id = $1 AND id = ANY($2::uuid[])', [org, ids]);
    return new Map(rows.map((r) => [r.id, { code: r.code, title: r.title }]));
  }

  async find(org: string, id: string) {
    return (await this.actions.findOne({ where: { id, organizationId: org } })) ?? this.core.notFound('مهمة المتابعة');
  }

  /** المسؤول عن الرد: المستخدم المسند إليه، أو من يملك الرد إن لم تُسند لشخص، أو المراجع المتحقق */
  private canRespond(actor: OrgUser, a: AuditAction) {
    if (actor.isSuperadmin || actor.permissions.includes(P.verify)) return true;
    if (!actor.permissions.includes(P.respond)) return false;
    return !a.assigneeUserId || a.assigneeUserId === actor.id;
  }

  private visible(actor: OrgUser, a: AuditAction) {
    if (!actor.permissions.includes(P.read) && !actor.isSuperadmin && a.assigneeUserId && a.assigneeUserId !== actor.id) throw new ForbiddenException('هذه المهمة غير مسندة إليك');
  }

  async get(actor: OrgUser, id: string) {
    const org = actor.organizationId;
    const a = await this.find(org, id);
    this.visible(actor, a);
    const [units, engs, finding, docs, eng] = await Promise.all([
      this.core.unitNames(org), this.engagementMap(org, [a.engagementId]),
      this.db.getRepository(AuditFinding).findOne({ where: { id: a.findingId } }),
      this.db.getRepository(AuditDocument).find({ where: { organizationId: org, ownerType: 'action', ownerId: id }, order: { createdAt: 'ASC' } }),
      this.db.getRepository(AuditEngagement).findOne({ where: { id: a.engagementId }, select: ['id', 'reportNo', 'reportIssuedAt', 'leadName'] }),
    ]);
    return {
      ...this.row(a, units, engs.get(a.engagementId)), log: [...a.log].reverse(),
      canRespond: this.canRespond(actor, a), reportNo: eng?.reportNo ?? null, leadName: eng?.leadName ?? null,
      finding: finding ? { seq: finding.seq, observation: finding.observation, cause: finding.cause, effect: finding.effect, rating: finding.rating, ratingLabel: LEVEL_AR[finding.rating], managementResponse: finding.managementResponse } : null,
      documents: docs.map((d) => ({ id: d.id, kind: d.kind, title: d.title, fileName: d.fileName, uploadedByName: d.uploadedByName, createdAt: d.createdAt })),
    };
  }

  private push(a: AuditAction, actor: OrgUser, entry: Omit<ActionLog, 'at' | 'by'>) {
    a.log = [...a.log, { at: new Date().toISOString(), by: actor.fullName, ...entry }];
  }

  /** تحديث المتابعة: ملاحظة أو نسبة إنجاز */
  async update(actor: OrgUser, id: string, dto: ActionUpdateDto) {
    const a = await this.find(actor.organizationId, id);
    if (!this.canRespond(actor, a)) throw new ForbiddenException('هذه المهمة مسندة لمستخدم آخر');
    if (!['open', 'in_progress'].includes(a.status)) throw new BadRequestException(a.status === 'submitted' ? 'تقرير الإغلاق بانتظار التحقق' : 'المهمة مغلقة');
    if (!dto.text && dto.progress === undefined) throw new BadRequestException('اكتب ملاحظة المتابعة أو نسبة الإنجاز');
    if (dto.progress !== undefined) {
      if (dto.progress === 100) throw new BadRequestException('عند اكتمال التنفيذ قدّم تقرير الإغلاق');
      a.progress = dto.progress;
    }
    if (a.status === 'open') a.status = 'in_progress';
    this.push(a, actor, { kind: 'progress', text: dto.text ?? null, progress: dto.progress ?? null });
    await this.actions.save(a);
    return this.get(actor, id);
  }

  async assign(actor: OrgUser, id: string, dto: AssignDto) {
    const a = await this.find(actor.organizationId, id);
    if (!OPEN.includes(a.status)) throw new BadRequestException('المهمة مغلقة');
    const name = dto.assigneeUserId ? await this.core.userName(actor.organizationId, dto.assigneeUserId) : null;
    Object.assign(a, { assigneeUserId: dto.assigneeUserId ?? null, assigneeName: name });
    this.push(a, actor, { kind: 'assign', text: name ? `أُسندت إلى ${name}` : 'أُلغي الإسناد الشخصي (للجهة كلها)' });
    await this.actions.save(a);
    return this.get(actor, id);
  }

  /** تقرير الإغلاق: ما تم تنفيذه لعلاج الملاحظة، بمرجع وتاريخ، ويُرفق مستنده */
  async submitClosure(actor: OrgUser, id: string, dto: ClosureDto) {
    const org = actor.organizationId;
    const a = await this.find(org, id);
    if (!this.canRespond(actor, a)) throw new ForbiddenException('هذه المهمة مسندة لمستخدم آخر');
    if (!['open', 'in_progress'].includes(a.status)) throw new BadRequestException('لا يمكن تقديم تقرير إغلاق لهذه المهمة الآن');
    if (dto.date > today()) throw new BadRequestException('تاريخ تقرير الإغلاق في المستقبل');
    Object.assign(a, {
      status: 'submitted', progress: 100,
      closureReport: { title: dto.title, refNo: dto.refNo ?? null, date: dto.date, summary: dto.summary, submittedByName: actor.fullName, submittedAt: new Date().toISOString() },
    });
    this.push(a, actor, { kind: 'submit', text: `قُدّم تقرير الإغلاق «${dto.title}»${dto.refNo ? ` رقم ${dto.refNo}` : ''}` });
    await this.actions.save(a);
    return this.get(actor, id);
  }

  async verify(actor: OrgUser, id: string, dto: VerifyDto) {
    const a = await this.find(actor.organizationId, id);
    if (a.status !== 'submitted') throw new BadRequestException('لا يوجد تقرير إغلاق بانتظار التحقق');
    if (dto.decision === 'close') {
      Object.assign(a, { status: 'closed', closedAt: new Date(), verifiedByName: actor.fullName });
      this.push(a, actor, { kind: 'close', text: dto.note ? `أُغلقت بعد التحقق: ${dto.note}` : 'أُغلقت بعد التحقق من تقرير الإغلاق' });
    } else {
      if (!dto.note) throw new BadRequestException('اكتب سبب إعادة التقرير');
      Object.assign(a, { status: 'in_progress', progress: Math.min(a.progress, 90) });
      this.push(a, actor, { kind: 'return', text: dto.note });
    }
    await this.actions.save(a);
    return this.get(actor, id);
  }

  async extend(actor: OrgUser, id: string, dto: ExtendDto) {
    const a = await this.find(actor.organizationId, id);
    if (!OPEN.includes(a.status)) throw new BadRequestException('المهمة مغلقة');
    if (dto.dueDate <= today()) throw new BadRequestException('الموعد الجديد يجب أن يكون بعد اليوم');
    if (dto.dueDate === a.dueDate) throw new BadRequestException('الموعد الجديد هو نفس الموعد الحالي');
    this.push(a, actor, { kind: 'extend', text: dto.reason, dueDate: dto.dueDate });
    a.dueDate = dto.dueDate;
    await this.actions.save(a);
    return this.get(actor, id);
  }

  async checkDocAccess(actor: OrgUser, id: string, write: boolean) {
    const a = await this.find(actor.organizationId, id);
    this.visible(actor, a);
    if (write && (!this.canRespond(actor, a) || !['open', 'in_progress', 'submitted'].includes(a.status))) {
      throw new ForbiddenException('لا يمكنك إرفاق مستندات لهذه المهمة');
    }
    return a;
  }

  /**
   * المهام بصيغة عامة لنقلها إلى نظام متابعة المهام والاتصالات الإدارية لاحقًا:
   * المصدر ومرجعه، العنوان والوصف، الجهة والمسند إليه، التواريخ والحالة والسجل.
   */
  async feed(actor: OrgUser) {
    const org = actor.organizationId;
    const rows = await this.actions.find({ where: { organizationId: org }, order: { createdAt: 'ASC' } });
    const engs = await this.engagementMap(org, [...new Set(rows.map((r) => r.engagementId))]);
    return rows.map((a) => ({
      source: { module: 'audit', type: 'recommendation', id: a.id, code: a.code, parentType: 'engagement', parentId: a.engagementId, parentCode: engs.get(a.engagementId)?.code ?? null },
      title: a.title, description: a.description, priority: a.priority, assignee: { unitId: a.responsibleUnitId, userId: a.assigneeUserId },
      startDate: a.startDate, dueDate: a.dueDate, status: a.status, progress: a.progress, closedAt: a.closedAt, log: a.log,
    }));
  }
}
