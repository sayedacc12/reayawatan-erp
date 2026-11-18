import { BadRequestException, ConflictException, ForbiddenException, Injectable } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { OrgUser } from '../../core/auth/decorators';
import { PendingTask } from '../../core/tasks/tasks.registry';
import { CommsCore, PRIORITY_AR, SOURCE_AR, TASK_STATUS_AR, addDays, daysBetween, today } from './comms-core.service';
import { TaskDto, TaskUpdateDto } from './comms.dto';
import { COMMS_PERMISSIONS as P } from './comms.manifest';
import { CommsTask, PersonRef, Priority, TaskSource } from './entities/comms.entity';

const OPEN = ['open', 'in_progress'];
const bad = (m: string): never => {
  throw new BadRequestException(m);
};

/** مهمة تنشئها وحدة أخرى (توصية اجتماع أو معاملة) */
export interface SourceTask {
  title: string; description?: string | null; ownerUserId: string; supporterUserIds?: string[]; dueDate: string; priority?: Priority;
  sourceType: TaskSource; sourceId: string; sourceRef: string; sourceLink: string; isConfidential?: boolean;
}

/**
 * المهام: لكل مهمة مسؤول واحد عن التنفيذ وموعد إغلاق. المساندون يرون المهمة للمتابعة ويضيفون ملاحظاتهم،
 * لكنها ليست من مسؤولياتهم ولا يغيرون حالتها. من أسندها يمدد موعدها أو يعيد إسنادها أو يلغيها.
 */
@Injectable()
export class TasksService {
  constructor(private readonly db: DataSource, private readonly core: CommsCore) {}

  private overdue(t: Pick<CommsTask, 'status' | 'dueDate'>) {
    return OPEN.includes(t.status) && t.dueDate < today();
  }

  row(t: CommsTask, me?: string) {
    const overdue = this.overdue(t);
    return {
      id: t.id, refNo: t.refNo, title: t.title, description: t.description, ownerUserId: t.ownerUserId, ownerName: t.ownerName, ownerUnitName: t.ownerUnitName,
      supporters: t.supporters, assignedById: t.assignedById, assignedByName: t.assignedByName, priority: t.priority, priorityLabel: PRIORITY_AR[t.priority],
      startDate: t.startDate, dueDate: t.dueDate, originalDueDate: t.originalDueDate, extended: t.dueDate !== t.originalDueDate,
      status: t.status, statusLabel: overdue ? `${TASK_STATUS_AR[t.status]} · متأخرة` : TASK_STATUS_AR[t.status], overdue,
      daysLeft: OPEN.includes(t.status) ? daysBetween(today(), t.dueDate) : null, progress: t.progress,
      sourceType: t.sourceType, sourceLabel: SOURCE_AR[t.sourceType], sourceRef: t.sourceRef, sourceLink: t.sourceLink, isConfidential: t.isConfidential,
      completionNote: t.completionNote, completedAt: t.completedAt, createdAt: t.createdAt,
      myRole: me === t.ownerUserId ? 'owner' : me && t.supporterUserIds.includes(me) ? 'supporter' : me === t.assignedById ? 'assigner' : 'viewer',
    };
  }

  private canSee(u: OrgUser, t: CommsTask) {
    if (t.ownerUserId === u.id || t.assignedById === u.id || t.supporterUserIds.includes(u.id)) return true;
    return !t.isConfidential && this.core.can(u, P.tasksAll);
  }

  async list(actor: OrgUser, q: { scope?: string; status?: string; source?: string; q?: string }) {
    const org = actor.organizationId;
    const qb = this.db.getRepository(CommsTask).createQueryBuilder('t').where('t.organization_id = :org', { org }).orderBy('t.due_date', 'ASC').limit(1000);
    const scope = q.scope ?? 'mine';
    if (scope === 'mine') qb.andWhere('t.owner_user_id = :me', { me: actor.id });
    else if (scope === 'supporting') qb.andWhere(':me = ANY(t.supporter_user_ids)', { me: actor.id });
    else if (scope === 'assigned') qb.andWhere('t.assigned_by_id = :me AND t.owner_user_id <> :me', { me: actor.id });
    else if (scope === 'all') {
      if (!this.core.can(actor, P.tasksAll)) throw new ForbiddenException('متابعة كل المهام تحتاج صلاحية');
      qb.andWhere('(NOT t.is_confidential OR t.owner_user_id = :me OR t.assigned_by_id = :me OR :me = ANY(t.supporter_user_ids))', { me: actor.id });
    } else bad('العرض غير معروف');
    if (q.status === 'active') qb.andWhere(`t.status IN ('open','in_progress')`);
    else if (q.status === 'overdue') qb.andWhere(`t.status IN ('open','in_progress') AND t.due_date < :t`, { t: today() });
    else if (q.status) qb.andWhere('t.status = :s', { s: q.status });
    if (q.source) qb.andWhere('t.source_type = :src', { src: q.source });
    if (q.q) qb.andWhere('(t.title ILIKE :q OR t.ref_no ILIKE :q OR t.owner_name ILIKE :q)', { q: `%${q.q}%` });
    const items = (await qb.getMany()).map((t) => this.row(t, actor.id));
    // عدادات «مهامي» في كل الحالات بغض النظر عن الفلتر
    const [c] = await this.db.query(
      `SELECT COUNT(*) FILTER (WHERE owner_user_id = $2 AND status IN ('open','in_progress'))::int AS mine,
              COUNT(*) FILTER (WHERE owner_user_id = $2 AND status IN ('open','in_progress') AND due_date < $3)::int AS overdue,
              COUNT(*) FILTER (WHERE $2 = ANY(supporter_user_ids) AND status IN ('open','in_progress'))::int AS supporting,
              COUNT(*) FILTER (WHERE assigned_by_id = $2 AND owner_user_id <> $2 AND status IN ('open','in_progress'))::int AS assigned,
              COUNT(*) FILTER (WHERE owner_user_id = $2 AND status = 'done')::int AS done
         FROM comms_tasks WHERE organization_id = $1`, [org, actor.id, today()],
    );
    return { items, counts: c };
  }

  private async load(em: EntityManager, org: string, id: string, lock = false) {
    const t = await em.getRepository(CommsTask).findOne({ where: { id, organizationId: org }, ...(lock ? { lock: { mode: 'pessimistic_write' as const } } : {}) });
    return t ?? this.core.notFound('المهمة');
  }

  async get(actor: OrgUser, id: string) {
    const t = await this.load(this.db.manager, actor.organizationId, id);
    if (!this.canSee(actor, t)) throw new ForbiddenException('هذه المهمة ليست لك');
    return { ...this.row(t, actor.id), log: t.log };
  }

  private async supportersOf(em: EntityManager, org: string, ids: string[], ownerId: string): Promise<PersonRef[]> {
    const uniq = [...new Set(ids)].filter((x) => x !== ownerId);
    const out: PersonRef[] = [];
    for (const id of uniq) {
      const p = await this.core.person(org, id, em);
      out.push({ userId: p.id, name: p.fullName, unitName: p.unitName });
    }
    return out;
  }

  private entry(actor: OrgUser, kind: string, extra: Partial<CommsTask['log'][number]> = {}) {
    return { at: new Date().toISOString(), by: actor.fullName, kind, ...extra };
  }

  async create(actor: OrgUser, dto: TaskDto) {
    if (dto.ownerUserId !== actor.id && !this.core.can(actor, P.tasks)) throw new ForbiddenException('إسناد المهام لغيرك يحتاج صلاحية «إسناد المهام للموظفين»');
    const id = await this.db.transaction(async (em) => (await this.insert(em, actor, {
      title: dto.title, description: dto.description ?? null, ownerUserId: dto.ownerUserId, supporterUserIds: dto.supporterUserIds ?? [],
      dueDate: dto.dueDate, priority: dto.priority, startDate: dto.startDate ?? null, sourceType: 'manual', sourceId: null, sourceRef: null, sourceLink: null,
    })).id);
    return this.get(actor, id);
  }

  /** مهمة من وحدة أخرى داخل معاملتها (توصيات الاجتماعات والمعاملات). الصلاحية تتحقق منها الوحدة المرسلة */
  async createFromSource(em: EntityManager, actor: OrgUser, s: SourceTask) {
    return this.insert(em, actor, { ...s, startDate: null, description: s.description ?? null, supporterUserIds: s.supporterUserIds ?? [], priority: s.priority ?? 'normal' });
  }

  private async insert(em: EntityManager, actor: OrgUser, d: {
    title: string; description: string | null; ownerUserId: string; supporterUserIds: string[]; dueDate: string; priority: Priority; startDate: string | null;
    sourceType: TaskSource; sourceId: string | null; sourceRef: string | null; sourceLink: string | null; isConfidential?: boolean;
  }) {
    const org = actor.organizationId;
    const start = d.startDate ?? today();
    if (d.dueDate < start) bad('موعد الإغلاق قبل تاريخ البدء');
    const owner = await this.core.person(org, d.ownerUserId, em);
    const supporters = await this.supportersOf(em, org, d.supporterUserIds, owner.id);
    const refNo = await this.core.nextRef(em, org, 'TK');
    return em.getRepository(CommsTask).save(em.create(CommsTask, {
      organizationId: org, refNo, title: d.title, description: d.description, ownerUserId: owner.id, ownerName: owner.fullName, ownerUnitName: owner.unitName,
      supporters, supporterUserIds: supporters.map((s) => s.userId), assignedById: actor.id, assignedByName: actor.fullName, priority: d.priority,
      startDate: start, dueDate: d.dueDate, originalDueDate: d.dueDate, status: 'open', progress: 0, sourceType: d.sourceType, sourceId: d.sourceId,
      sourceRef: d.sourceRef, sourceLink: d.sourceLink, isConfidential: !!d.isConfidential,
      log: [this.entry(actor, 'create', { text: `أُسندت إلى ${owner.fullName}${supporters.length ? `، والمساندون: ${supporters.map((s) => s.name).join('، ')}` : ''}`, dueDate: d.dueDate })],
    }));
  }

  async update(actor: OrgUser, id: string, dto: TaskUpdateDto) {
    const org = actor.organizationId;
    await this.db.transaction(async (em) => {
      const t = await this.load(em, org, id, true);
      if (!this.canSee(actor, t)) throw new ForbiddenException('هذه المهمة ليست لك');
      const isOwner = t.ownerUserId === actor.id;
      const isAssigner = t.assignedById === actor.id || (this.core.can(actor, P.tasksAll) && this.core.can(actor, P.tasks) && !t.isConfidential);
      const isSupporter = t.supporterUserIds.includes(actor.id);
      const open = OPEN.includes(t.status);
      const text = dto.text ?? null;
      switch (dto.action) {
        case 'note':
          if (!isOwner && !isSupporter && !isAssigner) throw new ForbiddenException('الملاحظات للمسؤول والمساندين ومن أسند المهمة');
          if (!text) bad('اكتب الملاحظة');
          t.log.push(this.entry(actor, isSupporter && !isOwner ? 'support' : 'note', { text }));
          break;
        case 'progress': {
          if (!isOwner) throw new ForbiddenException('نسبة الإنجاز يحدّثها المسؤول عن المهمة فقط');
          if (!open) throw new ConflictException('المهمة ليست مفتوحة');
          const pct = dto.progress ?? bad('اختر نسبة الإنجاز');
          if (pct >= 100) bad('اختر نسبة إنجاز أقل من 100%، ولإنهاء المهمة استخدم «إنجاز المهمة»');
          t.progress = pct;
          t.status = pct > 0 ? 'in_progress' : t.status;
          t.log.push(this.entry(actor, 'progress', { progress: pct, text }));
          break;
        }
        case 'complete':
          if (!isOwner) throw new ForbiddenException('ينهي المهمة المسؤول عنها فقط، والمساند يتابعها دون أن تكون من مسؤولياته');
          if (!open) throw new ConflictException('المهمة ليست مفتوحة');
          if (!text || text.length < 3) bad('اكتب ما تم إنجازه');
          Object.assign(t, { status: 'done', progress: 100, completionNote: text, completedAt: new Date() });
          t.log.push(this.entry(actor, 'complete', { text, progress: 100 }));
          break;
        case 'reopen':
          if (!isAssigner) throw new ForbiddenException('يعيد فتح المهمة من أسندها');
          if (t.status !== 'done' && t.status !== 'cancelled') throw new ConflictException('المهمة مفتوحة أصلًا');
          if (!text) bad('اكتب سبب إعادة الفتح');
          Object.assign(t, { status: 'in_progress', completedAt: null, progress: Math.min(t.progress, 90) });
          if (dto.dueDate) t.dueDate = dto.dueDate;
          t.log.push(this.entry(actor, 'reopen', { text, dueDate: dto.dueDate ?? null }));
          break;
        case 'cancel':
          if (!isAssigner) throw new ForbiddenException('يلغي المهمة من أسندها');
          if (!open) throw new ConflictException('المهمة ليست مفتوحة');
          if (!text) bad('اكتب سبب الإلغاء');
          t.status = 'cancelled';
          t.log.push(this.entry(actor, 'cancel', { text }));
          break;
        case 'extend': {
          if (!isAssigner) throw new ForbiddenException('يمدد الموعد من أسند المهمة');
          if (!open) throw new ConflictException('المهمة ليست مفتوحة');
          const due = dto.dueDate ?? bad('اختر الموعد الجديد');
          if (due < t.startDate) bad('الموعد الجديد قبل تاريخ البدء');
          if (!text) bad('اكتب سبب التمديد');
          t.log.push(this.entry(actor, 'extend', { text: `${text} (من ${t.dueDate})`, dueDate: due }));
          t.dueDate = due;
          break;
        }
        case 'reassign': {
          if (!isAssigner) throw new ForbiddenException('يعيد الإسناد من أسند المهمة');
          if (!open) throw new ConflictException('المهمة ليست مفتوحة');
          if (!dto.ownerUserId || dto.ownerUserId === t.ownerUserId) bad('اختر المسؤول الجديد');
          const p = await this.core.person(org, dto.ownerUserId!, em);
          t.log.push(this.entry(actor, 'reassign', { text: `من ${t.ownerName} إلى ${p.fullName}${text ? `: ${text}` : ''}` }));
          Object.assign(t, { ownerUserId: p.id, ownerName: p.fullName, ownerUnitName: p.unitName });
          t.supporters = t.supporters.filter((s) => s.userId !== p.id);
          t.supporterUserIds = t.supporters.map((s) => s.userId);
          break;
        }
        case 'supporters': {
          if (!isAssigner && !isOwner) throw new ForbiddenException('يضيف المساندين المسؤول أو من أسند المهمة');
          t.supporters = await this.supportersOf(em, org, dto.supporterUserIds ?? [], t.ownerUserId);
          t.supporterUserIds = t.supporters.map((s) => s.userId);
          t.log.push(this.entry(actor, 'supporters', { text: t.supporters.length ? t.supporters.map((s) => s.name).join('، ') : 'بلا مساندين' }));
          break;
        }
      }
      await em.getRepository(CommsTask).save(t);
    });
    return this.get(actor, id);
  }

  /** المهام المسندة إلي في الأنظمة الأخرى (توصيات المراجعة الداخلية ومهام المخاطر)، للعرض الموحد فقط */
  async external(actor: OrgUser) {
    const org = actor.organizationId;
    const q = async (sql: string) => {
      try {
        return await this.db.query(sql, [org, actor.id]);
      } catch {
        return [];
      }
    };
    const audit: { id: string; code: string; title: string; due_date: string; status: string; progress: number }[] = await q(
      `SELECT id, code, title, due_date::text, status, progress FROM audit_actions WHERE organization_id = $1 AND assignee_user_id = $2 AND status IN ('open','in_progress','submitted') ORDER BY due_date`);
    const risk: { id: string; title: string; due_date: string; status: string; progress: number }[] = await q(
      `SELECT id, title, due_date::text, status, progress FROM risk_tasks WHERE organization_id = $1 AND assignee_user_id = $2 AND status NOT IN ('done','cancelled','closed') ORDER BY due_date`);
    return [
      ...audit.map((a) => ({ id: a.id, system: 'المراجعة الداخلية', refNo: a.code, title: a.title, dueDate: a.due_date, progress: a.progress, overdue: a.due_date < today(), link: `/audit/actions/${a.id}` })),
      ...risk.map((r) => ({ id: r.id, system: 'المخاطر والتغيير', refNo: null, title: r.title, dueDate: r.due_date, progress: r.progress, overdue: r.due_date < today(), link: '/risk/tasks' })),
    ];
  }

  /** جرس المهام: مهامي المفتوحة (المتأخرة والقريبة عاجلة) */
  async pendingFor(u: OrgUser): Promise<PendingTask[]> {
    const s = await this.core.settings(u.organizationId);
    const rows = await this.db.getRepository(CommsTask).createQueryBuilder('t')
      .where(`t.organization_id = :org AND t.owner_user_id = :me AND t.status IN ('open','in_progress')`, { org: u.organizationId, me: u.id })
      .orderBy('t.due_date', 'ASC').limit(50).getMany();
    const soon = addDays(today(), s.taskReminderDays);
    return rows.map((t) => ({
      id: `task:${t.id}`, group: 'مهامي', link: `/comms/tasks/${t.id}`, at: t.createdAt, urgent: t.dueDate <= soon,
      title: t.title, subtitle: `${t.refNo} · ${t.dueDate < today() ? `متأخرة منذ ${t.dueDate}` : `الموعد ${t.dueDate}`}${t.sourceRef ? ` · ${t.sourceRef}` : ''}`,
    }));
  }
}
