import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { DataSource, EntityManager, In } from 'typeorm';
import { AuthUser, OrgUser } from '../auth/decorators';
import { User } from '../entities';
import { FileStore } from '../files/file-store.service';
import { nextNumber } from '../subscriptions/contracts.service';
import { PlatformSetting } from '../subscriptions/entities';
import { CATEGORIES, DEFAULT_SLA, OPEN_STATUSES, PRIORITIES, Priority, SlaLevel } from './sla';
import { SupportMessage, SupportTask, SupportTicket, TicketEvent } from './support.entity';
import { SUPPORT_PERMISSIONS } from './support.manifest';
import { CloseDto, CreateTicketDto, MessageDto, SlaLevelDto, UpdateTicketDto } from './support.dto';

const HOUR = 3_600_000;
const REOPEN_DAYS = 7;
const event = (step: TicketEvent['step'], by: string, note?: string): TicketEvent =>
  ({ step, by, at: new Date().toISOString(), ...(note ? { note } : {}) });

export type SlaState = 'met' | 'on_track' | 'at_risk' | 'breached' | 'paused';

/**
 * طلبات الصيانة والدعم الفني: الشركة تقدّم الطلب وتتابعه، وفريق المنصة يعالجه
 * حسب مستوى الخدمة (مهلة أول رد ومهلة الحل، مع التصعيد).
 */
@Injectable()
export class SupportService {
  constructor(private readonly db: DataSource, private readonly files: FileStore) {}

  // ---------- مستويات الخدمة ----------

  async sla(em: EntityManager = this.db.manager): Promise<SlaLevel[]> {
    const row = await em.findOne(PlatformSetting, { where: { key: 'sla' } });
    const saved = (row?.value?.levels as SlaLevel[] | undefined) ?? [];
    return DEFAULT_SLA.map((d) => ({ ...d, ...(saved.find((s) => s.priority === d.priority) ?? {}) }));
  }

  async setSla(levels: SlaLevelDto[]) {
    for (const l of levels) {
      if (l.resolutionHours < l.responseHours) throw new BadRequestException(`مهلة الحل في "${l.name}" أقل من مهلة الرد`);
    }
    const clean = (a: string[]) => a.map((s) => s.trim()).filter(Boolean);
    await this.db.getRepository(PlatformSetting).save({
      key: 'sla', value: { levels: levels.map((l) => ({ ...l, examples: clean(l.examples), handling: clean(l.handling) })) },
    });
    return this.sla();
  }

  private level(levels: SlaLevel[], p: Priority) {
    return levels.find((l) => l.priority === p)!;
  }

  // ---------- حساب المهل ----------

  /** حالة المهلة الآن. أثناء انتظار رد الشركة تتوقف المهل */
  private slaInfo(t: SupportTicket, levels: SlaLevel[], now = new Date()) {
    const paused = t.status === 'waiting_customer' && t.waitingSince ? now.getTime() - new Date(t.waitingSince).getTime() : 0;
    const respDue = new Date(new Date(t.responseDueAt).getTime() + (t.firstResponseAt ? 0 : paused));
    const resDue = new Date(new Date(t.resolutionDueAt).getTime() + paused);
    const lvl = this.level(levels, t.priority);
    const state = (start: Date, due: Date, doneAt: Date | null, totalH: number): SlaState => {
      if (doneAt) return new Date(doneAt) <= due ? 'met' : 'breached';
      if (t.status === 'waiting_customer') return now > due ? 'breached' : 'paused';
      if (now > due) return 'breached';
      const used = (now.getTime() - start.getTime()) / (totalH * HOUR);
      return used >= 0.75 || due.getTime() - now.getTime() < 0.25 * totalH * HOUR ? 'at_risk' : 'on_track';
    };
    const created = new Date(t.createdAt);
    const response = state(created, respDue, t.firstResponseAt, lvl.responseHours);
    const resolution = state(created, resDue, t.resolvedAt, lvl.resolutionHours);
    // التصعيد: تجاوز أي مهلة، أو مرور نصف مهلة الحل في المستوى الحرج جدًا دون حل
    const halfGone = !t.resolvedAt && now.getTime() - created.getTime() > (resDue.getTime() - created.getTime()) / 2;
    const needsEscalation = OPEN_STATUSES.includes(t.status) && !t.escalatedAt
      && (response === 'breached' || resolution === 'breached' || (t.priority === 'very_critical' && halfGone));
    return { responseDueAt: respDue, resolutionDueAt: resDue, response, resolution, needsEscalation };
  }

  private summary(t: SupportTicket, levels: SlaLevel[]) {
    return {
      id: t.id, number: t.number, subject: t.subject, category: t.category, priority: t.priority, requestedPriority: t.requestedPriority,
      status: t.status, screen: t.screen, createdByName: t.createdByName, contactPhone: t.contactPhone, assigneeId: t.assigneeId, assigneeName: t.assigneeName,
      createdAt: t.createdAt, updatedAt: t.updatedAt, firstResponseAt: t.firstResponseAt, resolvedAt: t.resolvedAt, closedAt: t.closedAt,
      escalatedAt: t.escalatedAt, rating: t.rating,
      organization: t.organization ? { id: t.organization.id, name: t.organization.name, slug: t.organization.slug } : undefined,
      sla: this.slaInfo(t, levels),
    };
  }

  // ---------- الشركة ----------

  async create(actor: OrgUser, dto: CreateTicketDto, file?: Express.Multer.File) {
    const stored = file ? await this.files.save(`support/${actor.organizationId}`, file, 'المرفق') : null;
    try {
      const id = await this.db.transaction(async (em) => {
        const levels = await this.sla(em);
        const lvl = this.level(levels, dto.priority);
        const now = Date.now();
        const t = await em.save(em.create(SupportTicket, {
          number: await nextNumber(em, 'support_tickets', 'SR'),
          organizationId: actor.organizationId, subject: dto.subject, category: dto.category,
          priority: dto.priority, requestedPriority: dto.priority, status: 'new', screen: dto.screen ?? null,
          createdById: actor.id, createdByName: actor.fullName, contactPhone: dto.contactPhone ?? null,
          responseDueAt: new Date(now + lvl.responseHours * HOUR), resolutionDueAt: new Date(now + lvl.resolutionHours * HOUR),
          history: [event('created', actor.fullName)],
        }));
        await em.save(em.create(SupportMessage, {
          ticketId: t.id, side: 'org', authorName: actor.fullName, body: dto.description,
          fileKey: stored?.key ?? null, fileName: stored?.name ?? null, fileMime: stored?.mime ?? null,
        }));
        return t.id;
      });
      return this.orgGet(actor, id);
    } catch (e) {
      if (stored) await this.files.remove(stored.key);
      throw e;
    }
  }

  async orgList(actor: OrgUser) {
    const [rows, levels] = await Promise.all([
      this.db.getRepository(SupportTicket).find({ where: { organizationId: actor.organizationId }, order: { createdAt: 'DESC' } }),
      this.sla(),
    ]);
    return rows.map((t) => this.summary(t, levels));
  }

  private async orgTicket(em: EntityManager, actor: OrgUser, id: string, lock = false) {
    const t = await em.findOne(SupportTicket, { where: { id, organizationId: actor.organizationId }, ...(lock ? { lock: { mode: 'pessimistic_write' as const } } : {}) });
    if (!t) throw new NotFoundException('الطلب غير موجود');
    return t;
  }

  async orgGet(actor: OrgUser, id: string) {
    const t = await this.orgTicket(this.db.manager, actor, id);
    return this.detail(t, false);
  }

  private async detail(t: SupportTicket, platform: boolean) {
    const [messages, levels] = await Promise.all([
      this.db.getRepository(SupportMessage).find({
        where: { ticketId: t.id, ...(platform ? {} : { isInternal: false }) }, order: { createdAt: 'ASC' },
      }),
      this.sla(),
    ]);
    const lvl = this.level(levels, t.priority);
    return {
      ...this.summary(t, levels),
      level: lvl,
      history: t.history,
      messages: messages.map((m) => ({
        id: m.id, side: m.side, authorName: m.authorName, body: m.body, isInternal: m.isInternal,
        createdAt: m.createdAt, file: m.fileName ? { name: m.fileName, mime: m.fileMime } : null,
      })),
      tasks: platform
        ? (await this.db.getRepository(SupportTask).find({ where: { ticketId: t.id }, order: { createdAt: 'ASC' } }))
            .map((k) => ({ id: k.id, number: k.number, title: k.title, status: k.status, assigneeName: k.assigneeName, dueAt: k.dueAt, spentHours: k.spentHours }))
        : undefined,
      canReopen: t.status === 'resolved' || (t.status === 'closed' && !!t.closedAt && Date.now() - new Date(t.closedAt).getTime() < REOPEN_DAYS * 24 * HOUR),
    };
  }

  /** رد الشركة: لو الطلب بانتظار ردها يعود للمعالجة وتُستأنف المهل */
  async orgReply(actor: OrgUser, id: string, dto: MessageDto, file?: Express.Multer.File) {
    return this.reply(id, dto, file, { side: 'org', name: actor.fullName, orgId: actor.organizationId });
  }

  async close(actor: OrgUser, id: string, dto: CloseDto) {
    await this.db.transaction(async (em) => {
      const t = await this.orgTicket(em, actor, id, true);
      if (t.status === 'closed') throw new BadRequestException('الطلب مغلق بالفعل');
      if (dto.rating && t.status !== 'resolved') throw new BadRequestException('التقييم بعد حل الطلب فقط');
      this.resume(t);
      t.status = 'closed';
      t.closedAt = new Date();
      if (dto.rating) t.rating = dto.rating;
      t.history = [...t.history, event('closed', actor.fullName, dto.note || (dto.rating ? `التقييم ${dto.rating} من 5` : undefined))];
      await em.save(t);
    });
    return this.orgGet(actor, id);
  }

  /** إعادة فتح طلب محلول (أو مغلق خلال 7 أيام) لأن المشكلة لم تُحل */
  async reopen(actor: OrgUser, id: string, note: string) {
    await this.db.transaction(async (em) => {
      const t = await this.orgTicket(em, actor, id, true);
      const recent = t.closedAt && Date.now() - new Date(t.closedAt).getTime() < REOPEN_DAYS * 24 * HOUR;
      if (t.status !== 'resolved' && !(t.status === 'closed' && recent)) {
        throw new BadRequestException('يمكن إعادة فتح الطلب المحلول، أو المغلق خلال 7 أيام فقط');
      }
      // مهلة حل جديدة بنفس المستوى من لحظة إعادة الفتح
      const lvl = this.level(await this.sla(em), t.priority);
      Object.assign(t, {
        status: 'in_progress', resolvedAt: null, closedAt: null, rating: null,
        resolutionDueAt: new Date(Date.now() + lvl.resolutionHours * HOUR),
        history: [...t.history, event('reopened', actor.fullName, note)],
      });
      await em.save(t);
      await em.save(em.create(SupportMessage, { ticketId: t.id, side: 'org', authorName: actor.fullName, body: `إعادة فتح الطلب: ${note}` }));
    });
    return this.orgGet(actor, id);
  }

  // ---------- مشترك ----------

  /** ينهي توقف المهل (انتظار رد الشركة) بتأجيل مواعيدها بمدة الانتظار */
  private resume(t: SupportTicket) {
    if (!t.waitingSince) return;
    const paused = Date.now() - new Date(t.waitingSince).getTime();
    t.resolutionDueAt = new Date(new Date(t.resolutionDueAt).getTime() + paused);
    if (!t.firstResponseAt) t.responseDueAt = new Date(new Date(t.responseDueAt).getTime() + paused);
    t.waitingSince = null;
  }

  private setStatus(t: SupportTicket, status: 'in_progress' | 'waiting_customer' | 'resolved', by: string, byId?: string) {
    if (t.status === status) return;
    if (t.status === 'waiting_customer') this.resume(t);
    if (status === 'waiting_customer') t.waitingSince = new Date();
    if (status === 'resolved') {
      t.resolvedAt = new Date();
      t.resolvedById = byId ?? null;
    } else {
      t.resolvedAt = null;
      t.resolvedById = null;
    }
    t.status = status;
    t.history = [...t.history, event('status', by, status)];
  }

  private async reply(
    id: string, dto: MessageDto, file: Express.Multer.File | undefined,
    who: { side: 'org' | 'platform'; name: string; orgId?: string; id?: string },
  ) {
    const t0 = await this.db.getRepository(SupportTicket).findOne({ where: { id, ...(who.orgId ? { organizationId: who.orgId } : {}) } });
    if (!t0) throw new NotFoundException('الطلب غير موجود');
    if (t0.status === 'closed') throw new BadRequestException('الطلب مغلق. أعد فتحه أو قدّم طلبًا جديدًا');
    const stored = file ? await this.files.save(`support/${t0.organizationId}`, file, 'المرفق') : null;
    try {
      await this.db.transaction(async (em) => {
        const t = await em.findOneOrFail(SupportTicket, { where: { id }, lock: { mode: 'pessimistic_write' } });
        const internal = who.side === 'platform' && !!dto.internal;
        await em.save(em.create(SupportMessage, {
          ticketId: id, side: who.side, authorName: who.name, body: dto.body, isInternal: internal,
          fileKey: stored?.key ?? null, fileName: stored?.name ?? null, fileMime: stored?.mime ?? null,
        }));
        if (who.side === 'org') {
          if (t.status === 'waiting_customer') this.setStatus(t, 'in_progress', who.name);
        } else if (!internal) {
          // أول رد من فريق المنصة يحقق مهلة الاستجابة
          if (!t.firstResponseAt) {
            t.firstResponseAt = new Date();
            t.firstResponseById = who.id ?? null;
          }
          this.setStatus(t, dto.status ?? (t.status === 'new' ? 'in_progress' : (t.status as 'in_progress')), who.name, who.id);
        } else if (dto.status) {
          this.setStatus(t, dto.status, who.name, who.id);
        }
        await em.save(t);
      });
    } catch (e) {
      if (stored) await this.files.remove(stored.key);
      throw e;
    }
  }

  async attachment(ticketId: string, messageId: string, orgId?: string) {
    const m = await this.db.getRepository(SupportMessage).findOne({
      where: { id: messageId, ticketId }, relations: { ticket: true },
      select: { id: true, fileKey: true, fileName: true, fileMime: true, isInternal: true, ticket: { id: true, organizationId: true } },
    });
    if (!m?.fileKey || (orgId && (m.ticket.organizationId !== orgId || m.isInternal))) throw new NotFoundException('المرفق غير موجود');
    return { stream: this.files.open(m.fileKey), name: m.fileName!, mime: m.fileMime! };
  }

  // ---------- مدير المنصة ----------

  async platformList(filter: { status?: string; priority?: string; organizationId?: string }) {
    const where: Record<string, unknown> = {};
    if (filter.status === 'open') where.status = In(OPEN_STATUSES);
    else if (filter.status) where.status = filter.status;
    if (filter.priority) where.priority = filter.priority;
    if (filter.organizationId) where.organizationId = filter.organizationId;
    const [rows, levels] = await Promise.all([
      this.db.getRepository(SupportTicket).find({ where, relations: { organization: true }, order: { createdAt: 'DESC' }, take: 500 }),
      this.sla(),
    ]);
    const rank = (p: Priority) => PRIORITIES.indexOf(p);
    // المفتوح أولًا مرتبًا بالمستوى ثم أقرب مهلة
    return rows.map((t) => this.summary(t, levels)).sort((a, b) => {
      const ao = OPEN_STATUSES.includes(a.status) ? 0 : 1;
      const bo = OPEN_STATUSES.includes(b.status) ? 0 : 1;
      if (ao !== bo) return ao - bo;
      if (ao === 1) return +new Date(b.createdAt) - +new Date(a.createdAt);
      return rank(a.priority) - rank(b.priority) || +a.sla.resolutionDueAt - +b.sla.resolutionDueAt;
    });
  }

  async platformGet(id: string) {
    const t = await this.db.getRepository(SupportTicket).findOne({ where: { id }, relations: { organization: true } });
    if (!t) throw new NotFoundException('الطلب غير موجود');
    return this.detail(t, true);
  }

  async platformReply(actor: AuthUser, id: string, dto: MessageDto, file?: Express.Multer.File) {
    await this.reply(id, dto, file, { side: 'platform', name: actor.fullName, id: actor.id });
    return this.platformGet(id);
  }

  async platformUpdate(actor: AuthUser, id: string, dto: UpdateTicketDto) {
    await this.db.transaction(async (em) => {
      const t = await em.findOne(SupportTicket, { where: { id }, lock: { mode: 'pessimistic_write' } });
      if (!t) throw new NotFoundException('الطلب غير موجود');
      if (t.status === 'closed') throw new BadRequestException('الطلب مغلق');
      const manager = actor.permissions.includes(SUPPORT_PERMISSIONS.manage);
      if (dto.status) this.setStatus(t, dto.status, actor.fullName, actor.id);
      if (dto.priority && dto.priority !== t.priority) {
        if (!manager) throw new ForbiddenException('تعديل مستوى الخدمة لمدير الدعم فقط');
        if (!dto.priorityReason || dto.priorityReason.length < 3) throw new BadRequestException('اكتب سبب تغيير مستوى الخدمة ليظهر للشركة');
        // المهل تُعاد حسابها من وقت تقديم الطلب بالمستوى الجديد
        const lvl = this.level(await this.sla(em), dto.priority);
        const created = new Date(t.createdAt).getTime();
        t.responseDueAt = new Date(created + lvl.responseHours * HOUR);
        t.resolutionDueAt = new Date(created + lvl.resolutionHours * HOUR);
        t.history = [...t.history, event('priority', actor.fullName, `${t.priority} → ${dto.priority}: ${dto.priorityReason}`)];
        await em.save(em.create(SupportMessage, {
          ticketId: t.id, side: 'platform', authorName: actor.fullName,
          body: `تم تعديل مستوى الخدمة إلى "${lvl.name}". السبب: ${dto.priorityReason}`,
        }));
        t.priority = dto.priority;
      }
      if (dto.assigneeId && dto.assigneeId !== t.assigneeId) {
        // موظف الدعم يستلم الطلب لنفسه فقط، والتوزيع على الآخرين لمدير الدعم
        if (!manager && dto.assigneeId !== actor.id) throw new ForbiddenException('توزيع الطلبات على الفريق لمدير الدعم فقط');
        if (!manager && t.assigneeId) throw new ForbiddenException('الطلب مسند لعضو آخر');
        const u = await em.findOne(User, { where: { id: dto.assigneeId, isPlatformAdmin: true, isActive: true } });
        if (!u) throw new BadRequestException('المسؤول يجب أن يكون من فريق الدعم');
        t.assigneeId = u.id;
        t.assigneeName = u.fullName;
        t.assignedAt = new Date();
        t.history = [...t.history, event('assigned', actor.fullName, u.fullName)];
      }
      await em.save(t);
    });
    return this.platformGet(id);
  }

  async escalate(actor: AuthUser, id: string, note: string) {
    await this.db.transaction(async (em) => {
      const t = await em.findOne(SupportTicket, { where: { id }, lock: { mode: 'pessimistic_write' } });
      if (!t) throw new NotFoundException('الطلب غير موجود');
      if (!OPEN_STATUSES.includes(t.status)) throw new BadRequestException('لا يمكن تصعيد طلب محلول أو مغلق');
      t.escalatedAt = new Date();
      t.history = [...t.history, event('escalated', actor.fullName, note)];
      await em.save(t);
      await em.save(em.create(SupportMessage, { ticketId: t.id, side: 'platform', authorName: actor.fullName, body: `تصعيد: ${note}`, isInternal: true }));
    });
    return this.platformGet(id);
  }

  /** فريق الدعم النشط (لإسناد الطلبات والمهام) */
  team() {
    return this.db.getRepository(User).find({
      where: { isPlatformAdmin: true, isActive: true }, select: { id: true, fullName: true, platformRole: true }, order: { fullName: 'ASC' },
    });
  }

  // ---------- التقارير ----------

  async report() {
    const [rows, levels] = await Promise.all([
      this.db.getRepository(SupportTicket).find({ relations: { organization: true } }),
      this.sla(),
    ]);
    const all = rows.map((t) => this.summary(t, levels));
    const open = all.filter((t) => OPEN_STATUSES.includes(t.status));
    const byPriority = PRIORITIES.map((p) => {
      const of = all.filter((t) => t.priority === p);
      const decidedResp = of.filter((t) => t.sla.response === 'met' || t.sla.response === 'breached');
      const decidedRes = of.filter((t) => t.sla.resolution === 'met' || t.sla.resolution === 'breached');
      const pct = (xs: typeof of, k: 'response' | 'resolution') => (xs.length ? Math.round((xs.filter((t) => t.sla[k] === 'met').length / xs.length) * 100) : null);
      const resolved = of.filter((t) => t.resolvedAt);
      const avgHours = resolved.length
        ? Math.round((resolved.reduce((s, t) => s + (+new Date(t.resolvedAt!) - +new Date(t.createdAt)), 0) / resolved.length / HOUR) * 10) / 10
        : null;
      return {
        priority: p, name: this.level(levels, p).name, total: of.length, open: of.filter((t) => OPEN_STATUSES.includes(t.status)).length,
        responseCompliance: pct(decidedResp, 'response'), resolutionCompliance: pct(decidedRes, 'resolution'), avgResolutionHours: avgHours,
      };
    });
    const rated = all.filter((t) => t.rating);
    const byOrg = new Map<string, { name: string; total: number; open: number }>();
    for (const t of all) {
      const o = byOrg.get(t.organization!.id) ?? { name: t.organization!.name, total: 0, open: 0 };
      o.total++;
      if (OPEN_STATUSES.includes(t.status)) o.open++;
      byOrg.set(t.organization!.id, o);
    }
    const byCategory = CATEGORIES.map((c) => ({ category: c, total: all.filter((t) => t.category === c).length }));
    return {
      totals: {
        total: all.length, open: open.length,
        breached: open.filter((t) => t.sla.response === 'breached' || t.sla.resolution === 'breached').length,
        atRisk: open.filter((t) => t.sla.response === 'at_risk' || t.sla.resolution === 'at_risk').length,
        needsEscalation: open.filter((t) => t.sla.needsEscalation).length,
        avgRating: rated.length ? Math.round((rated.reduce((s, t) => s + t.rating!, 0) / rated.length) * 10) / 10 : null,
      },
      byPriority, byCategory,
      byOrganization: [...byOrg.values()].sort((a, b) => b.total - a.total).slice(0, 10),
      attention: open.filter((t) => t.sla.needsEscalation || t.sla.resolution === 'breached' || t.sla.resolution === 'at_risk').slice(0, 20),
    };
  }
}
