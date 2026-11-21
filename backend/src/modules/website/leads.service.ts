import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { OrgUser } from '../../core/auth/decorators';
import { User } from '../../core/entities';
import { MailService } from '../../core/mail/mail.service';
import { mailLayout, publicOrigin } from '../../core/mail/mail-templates';
import { Lead, LeadEvent, LeadSource, LeadStatus } from './entities/website.entity';
import { ContentService } from './content.service';
import { AssessmentInputDto, CalculatorInputDto, LeadQueryDto, LeadUpdateDto } from './website.dto';

/** حصص بريد الموقع اليومية (من حد الإرسال اليومي العام 450 رسالة) */
const TEAM_MAILS_PER_DAY = 120;
const VISITOR_MAILS_PER_DAY = 100;
const VISITOR_MAILS_PER_EMAIL = 3;

export const SOURCE_LABEL: Record<LeadSource, string> = {
  consultation: 'طلب استشارة',
  calculator: 'حاسبة مضاعف الأثر',
  assessment: 'تقييم الجاهزية',
  guide: 'تنزيل دليل',
  booking: 'حجز جلسة تشخيص',
};
export const STATUS_LABEL: Record<LeadStatus, string> = {
  new: 'جديد', contacted: 'تم التواصل', qualified: 'مؤهل', proposal: 'عرض مقدم', won: 'تم التعاقد', lost: 'لم يتم', spam: 'غير جاد',
};

export interface VisitorInput {
  name: string; email: string; orgName?: string; phone?: string; orgType?: string; page?: string; utm?: string;
}

const fmt = (n: number) => Math.round(n).toLocaleString('en-US');

/** نتيجة الحاسبة تُحسب في الخادم من المدخلات (لا يُوثق برقم يرسله المتصفح) */
export function calculatorResult(c: CalculatorInputDto) {
  const now = c.budget / c.cost;
  const saving = (c.budget * c.efficiency) / 100;
  const additional = saving / c.cost;
  return { budget: c.budget, cost: c.cost, efficiency: c.efficiency, beneficiariesNow: Math.round(now), annualSaving: Math.round(saving), additionalBeneficiaries: Math.round(additional) };
}

@Injectable()
export class LeadsService {
  private readonly logger = new Logger('WebsiteLeads');

  constructor(private readonly db: DataSource, private readonly content: ContentService, private readonly mail: MailService) {}

  /** نتيجة تقييم الجاهزية: الدرجة من 100 والمجالات الأضعف بترتيب الأولوية */
  async assessmentResult(org: string, a: AssessmentInputDto) {
    const cfg = await this.content.section<{ questions: { service: string; text: string }[] }>(org, 'assessment');
    if (a.answers.length !== cfg.questions.length) throw new BadRequestException('أجيبوا عن كل الأسئلة');
    const services = await this.content.services(org, true);
    const title = new Map(services.map((s) => [s.slug, s.title]));
    const score = Math.round((a.answers.reduce((x, v) => x + v, 0) / (cfg.questions.length * 2)) * 100);
    const gaps = a.answers.map((v, i) => ({ v, i })).filter((x) => x.v < 2).sort((x, y) => x.v - y.v || x.i - y.i).slice(0, 3)
      .map((x) => ({ service: cfg.questions[x.i].service, title: title.get(cfg.questions[x.i].service) ?? cfg.questions[x.i].service }));
    const answers = cfg.questions.map((q, i) => ({ service: q.service, question: q.text, answer: a.answers[i] }));
    return { score, gaps, answers };
  }

  private async nextNo(em: EntityManager, org: string): Promise<number> {
    await em.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`rw_leads:${org}`]);
    const [{ n }] = await em.query('SELECT COALESCE(MAX(lead_no), 0)::int + 1 AS n FROM rw_leads WHERE organization_id = $1', [org]);
    return n as number;
  }

  /** يسجل عميلًا محتملًا جديدًا من نموذج في الموقع داخل المعاملة المعطاة */
  async create(em: EntityManager, org: string, source: LeadSource, v: VisitorInput, extra: { serviceSlug?: string | null; message?: string | null; result?: Record<string, unknown> | null; score?: number | null }) {
    const leadNo = await this.nextNo(em, org);
    const lead = await em.save(em.create(Lead, {
      organizationId: org, leadNo, source, status: 'new',
      name: v.name.trim(), email: v.email.trim().toLowerCase(), orgName: v.orgName?.trim() || null, phone: v.phone?.trim() || null,
      orgType: v.orgType?.trim() || null, serviceSlug: extra.serviceSlug || null, message: extra.message?.trim() || null,
      result: extra.result ?? null, score: extra.score ?? null,
      meta: v.page || v.utm ? { page: v.page ?? null, utm: v.utm ?? null } : null,
    }));
    await em.save(LeadEvent, { organizationId: org, leadId: lead.id, kind: 'created', text: SOURCE_LABEL[source], userName: 'الموقع الإلكتروني' });
    return lead;
  }

  /**
   * حصة يومية لرسائل الموقع حتى لا تستهلك نماذجه العامة حد البريد اليومي المشترك (ومنه رسائل استعادة كلمات المرور)،
   * وحد لكل بريد زائر حتى لا يُستخدم الموقع لإغراق بريد شخص آخر.
   */
  private async mailBudget(org: string, kind: string, perDay: number, to?: string) {
    const [{ n }] = await this.db.query(
      `SELECT count(*)::int AS n FROM mail_outbox
        WHERE organization_id = $1 AND kind = $2 AND created_at > now() - interval '1 day' AND ($3::text IS NULL OR lower(to_email) = $3)`,
      [org, kind, to ? to.trim().toLowerCase() : null]);
    return (n as number) < perDay;
  }

  /** إشعار الفريق بطلب جديد (بعد حفظ الطلب؛ فشل البريد لا يُفشل الطلب) */
  async notifyTeam(org: string, lead: Lead, facts: { label: string; value: string; ltr?: boolean }[] = []) {
    try {
      // الطلب محفوظ في النظام دائمًا؛ الإشعار وحده يتوقف عند تجاوز الحصة اليومية
      if (!(await this.mailBudget(org, 'website.lead', TEAM_MAILS_PER_DAY))) return;
      const n = await this.content.notify(org);
      let to = n.emails;
      if (!to.length) {
        const admins = await this.db.getRepository(User).find({ where: { organizationId: org, isSuperadmin: true, isActive: true }, select: { email: true } });
        to = admins.map((a) => a.email);
      }
      const origin = publicOrigin();
      const m = mailLayout({
        title: `${SOURCE_LABEL[lead.source]} جديد من الموقع`,
        subject: `[الموقع] ${SOURCE_LABEL[lead.source]}: ${lead.name}${lead.orgName ? ` (${lead.orgName})` : ''}`,
        paragraphs: ['وصل طلب جديد من موقع رعاية وطن، وهو الآن في قائمة العملاء المحتملين بانتظار المتابعة.'],
        facts: [
          { label: 'رقم الطلب', value: String(lead.leadNo) },
          { label: 'الاسم', value: lead.name },
          ...(lead.orgName ? [{ label: 'الجهة', value: lead.orgName }] : []),
          { label: 'البريد', value: lead.email, ltr: true },
          ...(lead.phone ? [{ label: 'الجوال', value: lead.phone, ltr: true }] : []),
          ...facts,
        ],
        button: origin ? { label: 'فتح الطلب في النظام', url: `${origin}/website/leads/${lead.id}` } : undefined,
      });
      await this.mail.queue({ ...m, to, kind: 'website.lead', organizationId: org, dedupeKey: `lead:${lead.id}` });
    } catch (e) {
      this.logger.error(`Lead notification failed: ${(e as Error).message}`);
    }
  }

  /** نسخة للزائر بنتيجته (التقييم أو الحاسبة) أو تأكيد استلام طلبه */
  async confirmVisitor(org: string, lead: Lead, title: string, paragraphs: string[], facts: { label: string; value: string }[] = [], button?: { label: string; url: string }) {
    try {
      const n = await this.content.notify(org);
      if (!n.confirmVisitor) return;
      if (!(await this.mailBudget(org, 'website.visitor', VISITOR_MAILS_PER_DAY))) return;
      if (!(await this.mailBudget(org, 'website.visitor', VISITOR_MAILS_PER_EMAIL, lead.email))) return;
      // التحية بلا اسم الزائر: الاسم نص حر من نموذج عام، فلا يُرسل باسم الشركة إلى بريد لم يُتحقق منه
      const m = mailLayout({ title, greeting: 'مرحبًا،', paragraphs, facts, button, note: 'وصلتكم هذه الرسالة لأنكم أرسلتم نموذجًا في موقع رعاية وطن. إن لم تكونوا أنتم، تجاهلوها.' });
      await this.mail.queue({ ...m, to: lead.email, kind: 'website.visitor', organizationId: org, dedupeKey: `visitor:${lead.id}:${title}`.slice(0, 150) });
    } catch (e) {
      this.logger.error(`Visitor mail failed: ${(e as Error).message}`);
    }
  }

  // ---------------- لوحة التحكم ----------------

  async list(u: OrgUser, q: LeadQueryDto) {
    const org = u.organizationId;
    const where: string[] = ['l.organization_id = $1'];
    const params: unknown[] = [org];
    if (q.status === 'open') where.push(`l.status IN ('new','contacted','qualified','proposal')`);
    else if (q.status) { params.push(q.status); where.push(`l.status = $${params.length}`); }
    if (q.source) { params.push(q.source); where.push(`l.source = $${params.length}`); }
    if (q.q?.trim()) {
      params.push(`%${q.q.trim().replace(/[%_\\]/g, '\\$&')}%`);
      where.push(`(l.name ILIKE $${params.length} OR l.email ILIKE $${params.length} OR l.org_name ILIKE $${params.length} OR l.phone ILIKE $${params.length})`);
    }
    const page = q.page ?? 1;
    const size = 50;
    const rows = await this.db.query(
      `SELECT l.id, l.lead_no AS "leadNo", l.source, l.status, l.name, l.org_name AS "orgName", l.email, l.phone, l.service_slug AS "serviceSlug",
              l.score, l.next_action_on::text AS "nextActionOn", l.created_at AS "createdAt", a.full_name AS "assignedName",
              (SELECT b.starts_at FROM rw_bookings b WHERE b.organization_id = l.organization_id AND b.lead_id = l.id ORDER BY b.starts_at DESC LIMIT 1) AS "bookingAt",
              count(*) OVER()::int AS total
         FROM rw_leads l LEFT JOIN users a ON a.id = l.assigned_to AND a.organization_id = l.organization_id
        WHERE ${where.join(' AND ')}
        ORDER BY l.created_at DESC LIMIT ${size} OFFSET ${(page - 1) * size}`, params);
    const counts = await this.db.query(`SELECT status, count(*)::int AS n FROM rw_leads WHERE organization_id = $1 GROUP BY status`, [org]);
    return { rows: rows.map(({ total: _t, ...r }: { total: number }) => r), total: rows[0]?.total ?? 0, page, size, counts: Object.fromEntries(counts.map((c: { status: string; n: number }) => [c.status, c.n])) };
  }

  async get(u: OrgUser, id: string) {
    const org = u.organizationId;
    const lead = await this.db.getRepository(Lead).findOne({ where: { id, organizationId: org } });
    if (!lead) throw new NotFoundException('الطلب غير موجود');
    const [events, bookings, downloads, assignee] = await Promise.all([
      this.db.getRepository(LeadEvent).find({ where: { leadId: id, organizationId: org }, order: { createdAt: 'DESC' } }),
      this.db.query(`SELECT id, starts_at AS "startsAt", ends_at AS "endsAt", status, topic, meeting_url AS "meetingUrl" FROM rw_bookings WHERE organization_id = $1 AND lead_id = $2 ORDER BY starts_at DESC`, [org, id]),
      this.db.query(`SELECT d.created_at AS "at", d.used_count AS "usedCount", g.title FROM rw_guide_downloads d JOIN rw_guides g ON g.id = d.guide_id AND g.organization_id = d.organization_id WHERE d.organization_id = $1 AND d.lead_id = $2 ORDER BY d.created_at DESC`, [org, id]),
      lead.assignedTo ? this.db.getRepository(User).findOne({ where: { id: lead.assignedTo, organizationId: org }, select: { id: true, fullName: true } }) : null,
    ]);
    // طلبات أخرى من نفس البريد (نفس الجهة تعود من أكثر من نموذج)
    const related = await this.db.query(
      `SELECT id, lead_no AS "leadNo", source, status, created_at AS "createdAt" FROM rw_leads WHERE organization_id = $1 AND email = $2 AND id <> $3 ORDER BY created_at DESC LIMIT 20`,
      [org, lead.email, id]);
    return { ...lead, assignedName: assignee?.fullName ?? null, events, bookings, downloads, related };
  }

  async update(u: OrgUser, id: string, dto: LeadUpdateDto) {
    const org = u.organizationId;
    return this.db.transaction(async (em) => {
      const lead = await em.findOne(Lead, { where: { id, organizationId: org }, lock: { mode: 'pessimistic_write' } });
      if (!lead) throw new NotFoundException('الطلب غير موجود');
      const ev = (kind: string, text: string | null, before?: Record<string, unknown>, after?: Record<string, unknown>) =>
        em.save(LeadEvent, { organizationId: org, leadId: id, kind, text, before: before ?? null, after: after ?? null, userId: u.id, userName: u.fullName });
      if (dto.status && dto.status !== lead.status) {
        await ev('status', `${STATUS_LABEL[lead.status]} ← ${STATUS_LABEL[dto.status as LeadStatus]}`, { status: lead.status }, { status: dto.status });
        lead.status = dto.status as LeadStatus;
      }
      if (dto.assignedTo !== undefined && dto.assignedTo !== lead.assignedTo) {
        let name: string | null = null;
        if (dto.assignedTo) {
          const user = await em.findOne(User, { where: { id: dto.assignedTo, organizationId: org, isActive: true }, select: { id: true, fullName: true } });
          if (!user) throw new NotFoundException('الموظف غير موجود');
          name = user.fullName;
        }
        await ev('assign', name ? `أُسند إلى ${name}` : 'أُلغي الإسناد', { assignedTo: lead.assignedTo }, { assignedTo: dto.assignedTo });
        lead.assignedTo = dto.assignedTo;
      }
      if (dto.nextActionOn !== undefined && dto.nextActionOn !== lead.nextActionOn) {
        await ev('followup', dto.nextActionOn ? `موعد المتابعة التالية ${dto.nextActionOn}` : 'أُلغي موعد المتابعة', { nextActionOn: lead.nextActionOn }, { nextActionOn: dto.nextActionOn });
        lead.nextActionOn = dto.nextActionOn;
      }
      if (dto.note?.trim()) await ev('note', dto.note.trim());
      await em.save(lead);
      return { ok: true };
    });
  }

  /** موظفو المنشأة النشطون لقائمة الإسناد */
  async assignees(u: OrgUser) {
    return this.db.getRepository(User).find({ where: { organizationId: u.organizationId, isActive: true }, select: { id: true, fullName: true }, order: { fullName: 'ASC' } });
  }

  async dashboard(u: OrgUser) {
    const org = u.organizationId;
    const [[totals], bySource, recent, upcoming, guides, weekly] = await Promise.all([
      this.db.query(
        `SELECT count(*)::int AS total,
                count(*) FILTER (WHERE status = 'new')::int AS "new",
                count(*) FILTER (WHERE status IN ('new','contacted','qualified','proposal'))::int AS open,
                count(*) FILTER (WHERE status = 'won')::int AS won,
                count(*) FILTER (WHERE created_at > now() - interval '30 days')::int AS last30,
                round(avg(score) FILTER (WHERE source = 'assessment'))::int AS "avgScore"
           FROM rw_leads WHERE organization_id = $1`, [org]),
      this.db.query(`SELECT source, count(*)::int AS n FROM rw_leads WHERE organization_id = $1 AND created_at > now() - interval '90 days' GROUP BY source`, [org]),
      this.db.query(`SELECT id, lead_no AS "leadNo", source, status, name, org_name AS "orgName", created_at AS "createdAt" FROM rw_leads WHERE organization_id = $1 ORDER BY created_at DESC LIMIT 8`, [org]),
      this.db.query(
        `SELECT b.id, b.starts_at AS "startsAt", b.status, l.id AS "leadId", l.name, l.org_name AS "orgName"
           FROM rw_bookings b JOIN rw_leads l ON l.id = b.lead_id AND l.organization_id = b.organization_id
          WHERE b.organization_id = $1 AND b.status IN ('booked','confirmed') AND b.starts_at > now() ORDER BY b.starts_at LIMIT 8`, [org]),
      this.db.query(`SELECT title, downloads FROM rw_guides WHERE organization_id = $1 ORDER BY downloads DESC, title LIMIT 5`, [org]),
      this.db.query(
        `SELECT to_char(date_trunc('week', created_at AT TIME ZONE 'Asia/Riyadh'), 'YYYY-MM-DD') AS week, count(*)::int AS n
           FROM rw_leads WHERE organization_id = $1 AND created_at > now() - interval '12 weeks' GROUP BY 1 ORDER BY 1`, [org]),
    ]);
    return { totals, bySource, recent, upcoming, guides, weekly };
  }

  /** تصدير CSV للعملاء المحتملين (بلا ملاحظات داخلية) */
  async csv(u: OrgUser) {
    const rows: Record<string, unknown>[] = await this.db.query(
      `SELECT lead_no, source, status, name, org_name, org_type, email, phone, service_slug, score, created_at FROM rw_leads WHERE organization_id = $1 ORDER BY lead_no`, [u.organizationId]);
    const head = ['الرقم', 'المصدر', 'الحالة', 'الاسم', 'الجهة', 'نوع الجهة', 'البريد', 'الجوال', 'الخدمة', 'درجة التقييم', 'التاريخ'];
    // يمنع تنفيذ الصيغ في Excel (خلية تبدأ بـ = + - @)
    const cell = (v: unknown) => {
      let s = v instanceof Date ? v.toISOString() : v === null || v === undefined ? '' : String(v);
      if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
      return `"${s.replace(/"/g, '""')}"`;
    };
    const lines = rows.map((r) => [r.lead_no, SOURCE_LABEL[r.source as LeadSource] ?? r.source, STATUS_LABEL[r.status as LeadStatus] ?? r.status, r.name, r.org_name, r.org_type, r.email, r.phone, r.service_slug, r.score, r.created_at].map(cell).join(','));
    return '﻿' + [head.map(cell).join(','), ...lines].join('\r\n');
  }

  fmt = fmt;
}
