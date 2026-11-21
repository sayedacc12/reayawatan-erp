import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { createHash, randomBytes } from 'crypto';
import { DataSource, EntityManager } from 'typeorm';
import { OrgUser } from '../../core/auth/decorators';
import { User } from '../../core/entities';
import { publicOrigin } from '../../core/mail/mail-templates';
import { ACTIVE_BOOKING, Booking, BookingStatus, Lead, LeadEvent } from './entities/website.entity';
import { ContentService } from './content.service';
import { calculatorResult, LeadsService } from './leads.service';
import { BookingSettings } from './website-defaults';
import { BookingQueryDto, BookingRequestDto, BookingUpdateDto } from './website.dto';

/** توقيت الرياض ثابت (UTC+3 بلا توقيت صيفي) */
const RIYADH_OFFSET_MIN = 180;
const DAY_MS = 86400000;
const AR_DAYS = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];

export const tokenHash = (t: string) => createHash('sha256').update(t).digest('hex');

/** وقت بتوقيت الرياض للعرض: الأحد 2026-11-22 الساعة 09:00 */
export function riyadhLabel(d: Date) {
  const l = new Date(d.getTime() + RIYADH_OFFSET_MIN * 60000);
  const hh = String(l.getUTCHours()).padStart(2, '0');
  const mm = String(l.getUTCMinutes()).padStart(2, '0');
  return `${AR_DAYS[l.getUTCDay()]} ${l.toISOString().slice(0, 10)} الساعة ${hh}:${mm} (بتوقيت الرياض)`;
}

const BOOKING_STATUS_LABEL: Record<BookingStatus, string> = { booked: 'محجوز', confirmed: 'مؤكد', done: 'تمت', cancelled: 'ملغى', no_show: 'لم يحضر' };

@Injectable()
export class BookingService {
  constructor(private readonly db: DataSource, private readonly content: ContentService, private readonly leads: LeadsService) {}

  /** المواعيد المتاحة: الإتاحة الأسبوعية ناقص الأيام المغلقة والمواعيد المحجوزة وما قبل أقل مدة للحجز */
  async slots(org: string, em: EntityManager = this.db.manager, now = new Date()) {
    const b = await this.content.booking(org, em);
    if (!b.enabled) return { enabled: false, slotMinutes: b.slotMinutes, days: [] as { date: string; label: string; slots: string[] }[] };
    const step = (b.slotMinutes + b.bufferMinutes) * 60000;
    const earliest = now.getTime() + b.minNoticeHours * 3600000;
    const horizonEnd = now.getTime() + b.horizonDays * DAY_MS;
    const taken: { s: Date; e: Date }[] = await em.query(
      `SELECT starts_at AS s, ends_at AS e FROM rw_bookings WHERE organization_id = $1 AND status = ANY($2) AND ends_at > now() AND starts_at < $3`,
      [org, ACTIVE_BOOKING, new Date(horizonEnd)]);
    const blackout = new Set(b.blackouts);
    const localToday = new Date(now.getTime() + RIYADH_OFFSET_MIN * 60000);
    const startDay = Date.UTC(localToday.getUTCFullYear(), localToday.getUTCMonth(), localToday.getUTCDate());
    const days: { date: string; label: string; slots: string[] }[] = [];
    for (let i = 0; i <= b.horizonDays; i++) {
      const dayUtc = startDay + i * DAY_MS;
      const date = new Date(dayUtc).toISOString().slice(0, 10);
      const dow = new Date(dayUtc).getUTCDay();
      if (blackout.has(date)) continue;
      const out: string[] = [];
      for (const w of b.weekly.filter((x) => x.day === dow).sort((x, y) => x.from.localeCompare(y.from))) {
        const [fh, fm] = w.from.split(':').map(Number);
        const [th, tm] = w.to.split(':').map(Number);
        const from = dayUtc + (fh * 60 + fm - RIYADH_OFFSET_MIN) * 60000;
        const to = dayUtc + (th * 60 + tm - RIYADH_OFFSET_MIN) * 60000;
        for (let s = from; s + b.slotMinutes * 60000 <= to; s += step) {
          const e = s + b.slotMinutes * 60000;
          if (s < earliest || s > horizonEnd) continue;
          if (taken.some((t) => s < new Date(t.e).getTime() + b.bufferMinutes * 60000 && e + b.bufferMinutes * 60000 > new Date(t.s).getTime())) continue;
          out.push(new Date(s).toISOString());
        }
      }
      if (out.length) days.push({ date, label: `${AR_DAYS[dow]} ${date}`, slots: [...new Set(out)].sort() });
    }
    return { enabled: true, slotMinutes: b.slotMinutes, days };
  }

  /**
   * حجز من الموقع: يعيد حساب المواعيد داخل معاملة مقفلة على المنشأة، فلا يُحجز موعد غير متاح ولا موعد واحد مرتين
   * (وفهرس فريد جزئي في القاعدة يمنع التكرار حتى لو تجاوز طلبان القفل).
   */
  async book(org: string, dto: BookingRequestDto) {
    const start = new Date(dto.startsAt);
    if (Number.isNaN(start.getTime())) throw new BadRequestException('اختاروا موعدًا');
    const token = randomBytes(32).toString('base64url');
    const { lead, booking, settings } = await this.db.transaction(async (em) => {
      await em.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`rw_bookings:${org}`]);
      const settings = await this.content.booking(org, em);
      const avail = await this.slots(org, em);
      if (!avail.enabled) throw new BadRequestException('الحجز الإلكتروني متوقف حاليًا، تواصلوا معنا من نموذج طلب الاستشارة');
      if (!avail.days.some((d) => d.slots.includes(start.toISOString()))) throw new ConflictException('هذا الموعد لم يعد متاحًا، اختاروا موعدًا آخر');
      const result: Record<string, unknown> = { startsAt: start.toISOString(), slotMinutes: settings.slotMinutes };
      if (dto.calculator) result.calculator = calculatorResult(dto.calculator);
      let score: number | null = null;
      if (dto.assessment) {
        const a = await this.leads.assessmentResult(org, dto.assessment);
        result.assessment = a;
        score = a.score;
      }
      const lead = await this.leads.create(em, org, 'booking', dto, { message: dto.topic ?? null, result, score });
      const booking = await em.save(em.create(Booking, {
        organizationId: org, leadId: lead.id, startsAt: start, endsAt: new Date(start.getTime() + settings.slotMinutes * 60000),
        status: 'booked', topic: dto.topic?.trim() || null, manageTokenHash: tokenHash(token),
      }));
      return { lead, booking, settings };
    }).catch((e: { code?: string }) => {
      if (e?.code === '23505') throw new ConflictException('هذا الموعد لم يعد متاحًا، اختاروا موعدًا آخر');
      throw e;
    });
    const when = riyadhLabel(booking.startsAt);
    await this.leads.notifyTeam(org, lead, [{ label: 'موعد الجلسة', value: when }, ...(booking.topic ? [{ label: 'الموضوع', value: booking.topic }] : [])]);
    const origin = publicOrigin();
    await this.leads.confirmVisitor(org, lead, 'تم حجز جلسة التشخيص المجانية', [
      `حجزنا لكم جلسة تشخيص مجانية مدتها ${settings.slotMinutes} دقيقة.`, settings.meetingNote,
    ], [{ label: 'الموعد', value: when }], origin ? { label: 'إلغاء الموعد أو تغييره', url: `${origin}/book/manage/${token}` } : undefined);
    return { ok: true, startsAt: booking.startsAt, label: when, manageToken: token };
  }

  private async byToken(org: string, token: string, em: EntityManager = this.db.manager) {
    if (!/^[A-Za-z0-9_-]{40,60}$/.test(token)) throw new NotFoundException('الرابط غير صحيح أو انتهت صلاحيته');
    const b = await em.findOne(Booking, { where: { organizationId: org, manageTokenHash: tokenHash(token) } });
    if (!b) throw new NotFoundException('الرابط غير صحيح أو انتهت صلاحيته');
    return b;
  }

  async manageInfo(org: string, token: string) {
    const b = await this.byToken(org, token);
    return { status: b.status, statusLabel: BOOKING_STATUS_LABEL[b.status], startsAt: b.startsAt, label: riyadhLabel(b.startsAt), cancellable: ACTIVE_BOOKING.includes(b.status as never) && b.startsAt.getTime() > Date.now() };
  }

  async cancelByVisitor(org: string, token: string, reason?: string) {
    const { lead, booking } = await this.db.transaction(async (em) => {
      const b = await this.byToken(org, token, em);
      if (!ACTIVE_BOOKING.includes(b.status as never) || b.startsAt.getTime() <= Date.now()) throw new BadRequestException('لا يمكن إلغاء هذا الموعد');
      b.status = 'cancelled';
      b.cancelReason = reason?.trim() || 'ألغاه العميل من الرابط';
      await em.save(b);
      await em.save(LeadEvent, { organizationId: org, leadId: b.leadId, kind: 'booking', text: `ألغى العميل موعد ${riyadhLabel(b.startsAt)}${reason ? `: ${reason}` : ''}`, userName: 'العميل' });
      const lead = await em.findOneOrFail(Lead, { where: { id: b.leadId, organizationId: org } });
      return { lead, booking: b };
    });
    await this.leads.notifyTeam(org, lead, [{ label: 'إلغاء موعد', value: riyadhLabel(booking.startsAt) }]);
    return { ok: true };
  }

  // ---------------- لوحة التحكم ----------------

  async list(u: OrgUser, q: BookingQueryDto) {
    const params: unknown[] = [u.organizationId];
    const where = ['b.organization_id = $1'];
    if (q.when === 'upcoming' || !q.when) where.push('b.ends_at > now()');
    if (q.when === 'past') where.push('b.ends_at <= now()');
    if (q.status) { params.push(q.status); where.push(`b.status = $${params.length}`); }
    return this.db.query(
      `SELECT b.id, b.starts_at AS "startsAt", b.ends_at AS "endsAt", b.status, b.topic, b.meeting_url AS "meetingUrl", b.cancel_reason AS "cancelReason",
              l.id AS "leadId", l.lead_no AS "leadNo", l.name, l.org_name AS "orgName", l.email, l.phone, c.full_name AS "consultantName", b.consultant_id AS "consultantId"
         FROM rw_bookings b JOIN rw_leads l ON l.id = b.lead_id AND l.organization_id = b.organization_id
         LEFT JOIN users c ON c.id = b.consultant_id AND c.organization_id = b.organization_id
        WHERE ${where.join(' AND ')}
        ORDER BY b.starts_at ${q.when === 'past' ? 'DESC' : 'ASC'} LIMIT 300`, params);
  }

  async update(u: OrgUser, id: string, dto: BookingUpdateDto) {
    const org = u.organizationId;
    const { b, lead, before } = await this.db.transaction(async (em) => {
      const b = await em.findOne(Booking, { where: { id, organizationId: org }, lock: { mode: 'pessimistic_write' } });
      if (!b) throw new NotFoundException('الحجز غير موجود');
      const before = { status: b.status, meetingUrl: b.meetingUrl, consultantId: b.consultantId };
      if (dto.consultantId !== undefined) {
        if (dto.consultantId && !(await em.exists(User, { where: { id: dto.consultantId, organizationId: org, isActive: true } }))) throw new NotFoundException('الموظف غير موجود');
        b.consultantId = dto.consultantId;
      }
      if (dto.meetingUrl !== undefined) b.meetingUrl = dto.meetingUrl;
      if (dto.status && dto.status !== b.status) {
        if (dto.status === 'cancelled') b.cancelReason = dto.reason?.trim() || 'ألغاه فريق رعاية وطن';
        b.status = dto.status as BookingStatus;
      }
      await em.save(b);
      const after = { status: b.status, meetingUrl: b.meetingUrl, consultantId: b.consultantId };
      await em.save(LeadEvent, {
        organizationId: org, leadId: b.leadId, kind: 'booking', userId: u.id, userName: u.fullName, before, after,
        text: before.status !== b.status ? `حالة موعد ${riyadhLabel(b.startsAt)}: ${BOOKING_STATUS_LABEL[before.status]} ← ${BOOKING_STATUS_LABEL[b.status]}` : `تحديث بيانات موعد ${riyadhLabel(b.startsAt)}`,
      });
      const lead = await em.findOneOrFail(Lead, { where: { id: b.leadId, organizationId: org } });
      return { b, lead, before };
    });
    if (dto.notifyVisitor) {
      if (b.status === 'confirmed' && (before.status !== 'confirmed' || before.meetingUrl !== b.meetingUrl)) {
        await this.leads.confirmVisitor(org, lead, 'تأكيد موعد جلسة التشخيص', ['يسعدنا تأكيد موعد جلستكم مع فريق رعاية وطن.'],
          [{ label: 'الموعد', value: riyadhLabel(b.startsAt) }], b.meetingUrl ? { label: 'رابط الاجتماع', url: b.meetingUrl } : undefined);
      } else if (b.status === 'cancelled' && before.status !== 'cancelled') {
        await this.leads.confirmVisitor(org, lead, 'إلغاء موعد جلسة التشخيص', [`نعتذر، أُلغي موعد ${riyadhLabel(b.startsAt)}. ${b.cancelReason ?? ''}`, 'يمكنكم حجز موعد جديد من الموقع في أي وقت.']);
      }
    }
    return { ok: true };
  }

  /** معاينة المواعيد المتاحة بالإعدادات الحالية (لشاشة أوقات الإتاحة) */
  preview(u: OrgUser) {
    return this.slots(u.organizationId);
  }

  settingsOf(org: string): Promise<BookingSettings> {
    return this.content.booking(org);
  }
}
