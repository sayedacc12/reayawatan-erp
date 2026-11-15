import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { Between, DataSource, In, IsNull, Not } from 'typeorm';
import { AuthUser } from '../auth/decorators';
import { User } from '../entities';
import { nextNumber } from '../subscriptions/contracts.service';
import { OPEN_STATUSES, Priority } from './sla';
import { SupportTask, SupportTicket, TaskEvent, TaskStatus } from './support.entity';
import { SUPPORT_PERMISSIONS } from './support.manifest';
import { CreateMemberDto, CreateTaskDto, LogHoursDto, UpdateMemberDto, UpdateTaskDto } from './support.dto';
import { SupportService } from './support.service';

const HOUR = 3_600_000;
const OPEN_TASK: TaskStatus[] = ['todo', 'in_progress'];
const ev = (step: TaskEvent['step'], by: string, extra: Partial<TaskEvent> = {}): TaskEvent => ({ step, by, at: new Date().toISOString(), ...extra });

/** أوزان تقييم الأداء (من 100) */
export const SCORE_WEIGHTS = { response: 30, resolution: 30, tasks: 20, rating: 20 };

export function grade(score: number | null) {
  if (score === null) return 'لا توجد بيانات';
  if (score >= 90) return 'ممتاز';
  if (score >= 80) return 'جيد جدًا';
  if (score >= 70) return 'جيد';
  if (score >= 60) return 'مقبول';
  return 'يحتاج إلى تحسين';
}

const pct = (ok: number, total: number) => (total ? Math.round((ok / total) * 100) : null);
const avgHours = (xs: number[]) => (xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length / HOUR) * 10) / 10 : null);

/**
 * تطبيق الدعم الفني: مهام العمل والتكليفات، وفريق الدعم، وتقييم الأداء
 * المبني على الالتزام بساعات الاستجابة والحل وإنجاز المهام وتقييم الجمعيات.
 */
@Injectable()
export class SupportDeskService {
  constructor(private readonly db: DataSource, private readonly tickets: SupportService) {}

  private isManager(actor: AuthUser) {
    return actor.permissions.includes(SUPPORT_PERMISSIONS.manage);
  }

  private async member(id: string) {
    const u = await this.db.getRepository(User).findOne({ where: { id, isPlatformAdmin: true, isActive: true } });
    if (!u) throw new BadRequestException('المكلَّف يجب أن يكون عضوًا نشطًا في فريق الدعم');
    return u;
  }

  // ---------- المهام ----------

  private present(t: SupportTask) {
    const open = OPEN_TASK.includes(t.status);
    return {
      id: t.id, number: t.number, title: t.title, description: t.description, priority: t.priority, status: t.status,
      assigneeId: t.assigneeId, assigneeName: t.assigneeName, createdByName: t.createdByName,
      dueAt: t.dueAt, estimatedHours: t.estimatedHours, spentHours: t.spentHours, startedAt: t.startedAt, completedAt: t.completedAt,
      createdAt: t.createdAt, history: t.history,
      overdue: open && new Date(t.dueAt).getTime() < Date.now(),
      onTime: t.status === 'done' ? new Date(t.completedAt!).getTime() <= new Date(t.dueAt).getTime() : null,
      ticket: t.ticket ? { id: t.ticket.id, number: t.ticket.number, subject: t.ticket.subject } : null,
    };
  }

  async listTasks(actor: AuthUser, f: { scope?: string; ticketId?: string; assigneeId?: string }) {
    const where: Record<string, unknown> = {};
    // موظف الدعم يرى مهامه فقط، ومدير الدعم يرى الكل
    if (!this.isManager(actor) || f.scope === 'mine') where.assigneeId = actor.id;
    else if (f.assigneeId) where.assigneeId = f.assigneeId;
    if (f.ticketId) where.ticketId = f.ticketId;
    const rows = await this.db.getRepository(SupportTask).find({ where, relations: { ticket: true }, order: { dueAt: 'ASC' }, take: 500 });
    return rows.map((t) => this.present(t));
  }

  async getTask(actor: AuthUser, id: string) {
    const t = await this.db.getRepository(SupportTask).findOne({ where: { id }, relations: { ticket: true } });
    if (!t || (!this.isManager(actor) && t.assigneeId !== actor.id)) throw new NotFoundException('المهمة غير موجودة');
    return this.present(t);
  }

  async createTask(actor: AuthUser, dto: CreateTaskDto) {
    if (!this.isManager(actor) && dto.assigneeId !== actor.id) throw new ForbiddenException('تكليف الآخرين بالمهام لمدير الدعم فقط');
    const assignee = await this.member(dto.assigneeId);
    const id = await this.db.transaction(async (em) => {
      let ticket: SupportTicket | null = null;
      if (dto.ticketId) {
        ticket = await em.findOne(SupportTicket, { where: { id: dto.ticketId } });
        if (!ticket) throw new NotFoundException('الطلب غير موجود');
        if (!OPEN_STATUSES.includes(ticket.status)) throw new BadRequestException('لا يمكن إضافة مهام لطلب محلول أو مغلق');
      }
      const priority: Priority = dto.priority ?? ticket?.priority ?? 'normal';
      const levels = await this.tickets.sla(em);
      const lvl = levels.find((l) => l.priority === priority)!;
      const due = dto.dueAt ? new Date(dto.dueAt) : ticket ? new Date(ticket.resolutionDueAt) : new Date(Date.now() + lvl.resolutionHours * HOUR);
      const t = await em.save(em.create(SupportTask, {
        number: await nextNumber(em, 'support_tasks', 'TK'),
        ticketId: ticket?.id ?? null, title: dto.title, description: dto.description ?? '', priority, status: 'todo',
        assigneeId: assignee.id, assigneeName: assignee.fullName, createdById: actor.id, createdByName: actor.fullName,
        dueAt: due, estimatedHours: dto.estimatedHours ?? null, spentHours: 0,
        history: [ev('created', actor.fullName, { note: `تكليف ${assignee.fullName}` })],
      }));
      // تكليف من طلب غير مسند يجعل المكلَّف مسؤولًا عن الطلب
      if (ticket && !ticket.assigneeId) {
        Object.assign(ticket, {
          assigneeId: assignee.id, assigneeName: assignee.fullName, assignedAt: new Date(),
          history: [...ticket.history, { step: 'assigned', by: actor.fullName, at: new Date().toISOString(), note: assignee.fullName }],
        });
        await em.save(ticket);
      }
      return t.id;
    });
    return this.getTask(actor, id);
  }

  async updateTask(actor: AuthUser, id: string, dto: UpdateTaskDto) {
    const manager = this.isManager(actor);
    await this.db.transaction(async (em) => {
      const t = await em.findOne(SupportTask, { where: { id }, lock: { mode: 'pessimistic_write' } });
      if (!t || (!manager && t.assigneeId !== actor.id)) throw new NotFoundException('المهمة غير موجودة');
      const add = (e: TaskEvent) => { t.history = [...t.history, e]; };
      if (dto.assigneeId && dto.assigneeId !== t.assigneeId) {
        if (!manager) throw new ForbiddenException('إعادة التكليف لمدير الدعم فقط');
        const u = await this.member(dto.assigneeId);
        t.assigneeId = u.id;
        t.assigneeName = u.fullName;
        add(ev('assigned', actor.fullName, { note: u.fullName }));
      }
      if (dto.dueAt) {
        if (!manager) throw new ForbiddenException('تعديل موعد التسليم لمدير الدعم فقط');
        t.dueAt = new Date(dto.dueAt);
        add(ev('due', actor.fullName, { note: dto.dueAt }));
      }
      if (dto.priority && dto.priority !== t.priority) {
        if (!manager) throw new ForbiddenException('تعديل الأولوية لمدير الدعم فقط');
        t.priority = dto.priority;
      }
      if (dto.status && dto.status !== t.status) {
        if (dto.status === 'cancelled' && !manager) throw new ForbiddenException('إلغاء المهمة لمدير الدعم فقط');
        if (dto.status === 'in_progress' && !t.startedAt) t.startedAt = new Date();
        t.completedAt = dto.status === 'done' ? new Date() : null;
        t.status = dto.status;
        add(ev('status', actor.fullName, { note: dto.status }));
      }
      if (dto.note) add(ev('comment', actor.fullName, { note: dto.note }));
      await em.save(t);
    });
    return this.getTask(actor, id);
  }

  async logHours(actor: AuthUser, id: string, dto: LogHoursDto) {
    await this.db.transaction(async (em) => {
      const t = await em.findOne(SupportTask, { where: { id }, lock: { mode: 'pessimistic_write' } });
      if (!t || (!this.isManager(actor) && t.assigneeId !== actor.id)) throw new NotFoundException('المهمة غير موجودة');
      if (t.status === 'cancelled') throw new BadRequestException('المهمة ملغاة');
      t.spentHours = Math.round((Number(t.spentHours) + dto.hours) * 100) / 100;
      if (!t.startedAt) t.startedAt = new Date();
      if (t.status === 'todo') t.status = 'in_progress';
      t.history = [...t.history, ev('hours', actor.fullName, { byId: actor.id, hours: dto.hours, note: dto.note })];
      await em.save(t);
    });
    return this.getTask(actor, id);
  }

  // ---------- فريق الدعم ----------

  async team() {
    const [users, tickets, tasks] = await Promise.all([
      this.db.getRepository(User).find({ where: { isPlatformAdmin: true }, order: { fullName: 'ASC' } }),
      this.db.getRepository(SupportTicket).find({ where: { status: In(OPEN_STATUSES), assigneeId: Not(IsNull()) }, select: { id: true, assigneeId: true } }),
      this.db.getRepository(SupportTask).find({ where: { status: In(OPEN_TASK) }, select: { id: true, assigneeId: true, dueAt: true } }),
    ]);
    const now = Date.now();
    return users.map((u) => ({
      id: u.id, fullName: u.fullName, email: u.email, role: u.platformRole ?? 'owner', isActive: u.isActive, lastLoginAt: u.lastLoginAt,
      openTickets: tickets.filter((t) => t.assigneeId === u.id).length,
      openTasks: tasks.filter((t) => t.assigneeId === u.id).length,
      overdueTasks: tasks.filter((t) => t.assigneeId === u.id && new Date(t.dueAt).getTime() < now).length,
    }));
  }

  async createMember(dto: CreateMemberDto) {
    const email = dto.email.trim().toLowerCase();
    if (await this.db.getRepository(User).exists({ where: { email } })) throw new ConflictException('البريد الإلكتروني مستخدم بالفعل');
    const u = await this.db.getRepository(User).save(this.db.getRepository(User).create({
      fullName: dto.fullName, email, passwordHash: await bcrypt.hash(dto.password, 12),
      isPlatformAdmin: true, organizationId: null, platformRole: dto.role, isActive: true,
    }));
    return { id: u.id };
  }

  async updateMember(actor: AuthUser, id: string, dto: UpdateMemberDto) {
    const repo = this.db.getRepository(User);
    const u = await repo.findOne({ where: { id, isPlatformAdmin: true } });
    if (!u) throw new NotFoundException('العضو غير موجود');
    // حساب مالك المنصة لا يُعدَّل من هنا
    if (!u.platformRole) throw new ForbiddenException('لا يمكن تعديل حساب مالك المنصة من فريق الدعم');
    if (id === actor.id && (dto.isActive === false || dto.role)) throw new BadRequestException('لا يمكنك تعديل دورك أو إيقاف حسابك');
    if (dto.role) u.platformRole = dto.role;
    if (dto.isActive !== undefined) u.isActive = dto.isActive;
    if (dto.password) u.passwordHash = await bcrypt.hash(dto.password, 12);
    await repo.save(u);
    return { ok: true };
  }

  // ---------- تقييم الأداء ----------

  /** تقييم كل عضو في الفترة: الالتزام بمهلة الرد ومهلة الحل، وإنجاز المهام في موعدها، وتقييم الجمعيات */
  async performance(fromIso?: string, toIso?: string) {
    const now = new Date();
    const from = fromIso ? new Date(fromIso) : new Date(now.getFullYear(), now.getMonth(), 1);
    const to = toIso ? new Date(new Date(toIso).getTime() + 24 * HOUR - 1) : now;
    if (isNaN(+from) || isNaN(+to) || from > to) throw new BadRequestException('الفترة غير صحيحة');
    const range = Between(from, to);
    const [users, responded, resolved, rated, done, openTasks, allTasks] = await Promise.all([
      this.db.getRepository(User).find({ where: { isPlatformAdmin: true }, order: { fullName: 'ASC' } }),
      this.db.getRepository(SupportTicket).find({ where: { firstResponseAt: range, firstResponseById: Not(IsNull()) } }),
      this.db.getRepository(SupportTicket).find({ where: { resolvedAt: range, resolvedById: Not(IsNull()) } }),
      this.db.getRepository(SupportTicket).find({ where: { closedAt: range, rating: Not(IsNull()), assigneeId: Not(IsNull()) } }),
      this.db.getRepository(SupportTask).find({ where: { completedAt: range, status: 'done' } }),
      this.db.getRepository(SupportTask).find({ where: { status: In(OPEN_TASK) } }),
      this.db.getRepository(SupportTask).find({ where: { updatedAt: Between(from, now) } }),
    ]);
    const members = users.map((u) => {
      const resp = responded.filter((t) => t.firstResponseById === u.id);
      const respMet = resp.filter((t) => +new Date(t.firstResponseAt!) <= +new Date(t.responseDueAt));
      const res = resolved.filter((t) => t.resolvedById === u.id);
      const resMet = res.filter((t) => +new Date(t.resolvedAt!) <= +new Date(t.resolutionDueAt));
      const myDone = done.filter((t) => t.assigneeId === u.id);
      const onTime = myDone.filter((t) => +new Date(t.completedAt!) <= +new Date(t.dueAt));
      const overdue = openTasks.filter((t) => t.assigneeId === u.id && +new Date(t.dueAt) < +now);
      const ratings = rated.filter((t) => t.assigneeId === u.id).map((t) => t.rating!);
      const hours = allTasks.flatMap((t) => t.history).filter((e) => e.step === 'hours' && e.byId === u.id && +new Date(e.at) >= +from && +new Date(e.at) <= +to)
        .reduce((s, e) => s + (e.hours ?? 0), 0);
      const parts = {
        response: pct(respMet.length, resp.length),
        resolution: pct(resMet.length, res.length),
        tasks: pct(onTime.length, myDone.length + overdue.length),
        rating: ratings.length ? Math.round((ratings.reduce((a, b) => a + b, 0) / ratings.length / 5) * 100) : null,
      };
      // الأجزاء التي لا بيانات لها لا تُحسب ويُعاد توزيع وزنها
      let w = 0;
      let sum = 0;
      for (const k of Object.keys(SCORE_WEIGHTS) as (keyof typeof SCORE_WEIGHTS)[]) {
        if (parts[k] === null) continue;
        w += SCORE_WEIGHTS[k];
        sum += parts[k]! * SCORE_WEIGHTS[k];
      }
      const score = w ? Math.round(sum / w) : null;
      return {
        id: u.id, fullName: u.fullName, role: u.platformRole ?? 'owner', isActive: u.isActive,
        responses: resp.length, responseCompliance: parts.response, avgResponseHours: avgHours(resp.map((t) => +new Date(t.firstResponseAt!) - +new Date(t.createdAt))),
        resolved: res.length, resolutionCompliance: parts.resolution, avgResolutionHours: avgHours(res.map((t) => +new Date(t.resolvedAt!) - +new Date(t.createdAt))),
        tasksDone: myDone.length, tasksOnTime: onTime.length, tasksOverdue: overdue.length, taskCompliance: parts.tasks,
        hoursLogged: Math.round(hours * 100) / 100,
        avgRating: ratings.length ? Math.round((ratings.reduce((a, b) => a + b, 0) / ratings.length) * 10) / 10 : null, ratings: ratings.length,
        score, grade: grade(score),
      };
    });
    return {
      from: from.toISOString(), to: to.toISOString(), weights: SCORE_WEIGHTS,
      members: members.filter((m) => m.isActive || m.responses || m.resolved || m.tasksDone).sort((a, b) => (b.score ?? -1) - (a.score ?? -1)),
    };
  }

  // ---------- لوحة الدعم ----------

  async dashboard(actor: AuthUser) {
    const [tickets, myTasks] = await Promise.all([
      this.tickets.platformList({ status: 'open' }),
      this.db.getRepository(SupportTask).find({ where: { assigneeId: actor.id, status: In(OPEN_TASK) }, relations: { ticket: true }, order: { dueAt: 'ASC' } }),
    ]);
    const perf = await this.performance();
    const me = perf.members.find((m) => m.id === actor.id) ?? null;
    const endOfDay = new Date();
    endOfDay.setHours(23, 59, 59, 999);
    return {
      me,
      myTickets: tickets.filter((t) => t.assigneeId === actor.id),
      myTasks: myTasks.map((t) => this.present(t)),
      unassigned: tickets.filter((t) => !t.assigneeId),
      counts: {
        open: tickets.length,
        breached: tickets.filter((t) => t.sla.response === 'breached' || t.sla.resolution === 'breached').length,
        escalate: tickets.filter((t) => t.sla.needsEscalation).length,
        tasksDueToday: myTasks.filter((t) => +new Date(t.dueAt) <= +endOfDay).length,
      },
      team: this.isManager(actor) ? perf.members.filter((m) => m.isActive) : undefined,
      workload: this.isManager(actor) ? await this.team() : undefined,
    };
  }
}
