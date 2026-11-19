import { BadRequestException, Injectable, Logger, NotFoundException, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { createTransport, Transporter } from 'nodemailer';
import { DataSource } from 'typeorm';
import { PlatformSetting } from '../subscriptions/entities';
import { MailMessage, MAIL_STATUSES, MailStatus } from './mail-outbox.entity';
import { DEFAULT_MAIL_SETTINGS, EMAIL_RE, MAIL_EVENTS, MailEvent, MailSettings, mailSettings, maskEmail, smtpEnv, SmtpEnv } from './mail-settings';
import { MailContent, templates } from './mail-templates';

export interface QueueMail extends MailContent {
  to: string | (string | null | undefined)[];
  kind: string;
  /** الحدث الذي يمكن إيقافه من الإعدادات (إن وُجد) */
  event?: MailEvent;
  organizationId?: string | null;
  /** رسالة فيها كلمة مرور أو رابط سري: يُمسح نصها بعد الإرسال */
  sensitive?: boolean;
  /** مفتاح يمنع التكرار؛ يُضاف إليه عنوان المستلم */
  dedupeKey?: string;
  createdBy?: string | null;
}

/** مهلة إعادة المحاولة بالدقائق بعد كل فشل */
const RETRY_MINUTES = [1, 5, 15, 60, 180];
export const MAX_ATTEMPTS = RETRY_MINUTES.length + 1;
const TICK_MS = 15_000;
const BATCH = 20;

/** رسائل تشير لخطأ في الإعدادات لا يفيد معه تكرار المحاولة */
const isAuthError = (e: unknown) => {
  const x = e as { code?: string; responseCode?: number };
  return x?.code === 'EAUTH' || x?.responseCode === 535 || x?.responseCode === 534;
};

/** شرح عربي مختصر لأخطاء الخادم الشائعة لمدير المنصة */
export function explainError(e: unknown): string {
  const x = e as { code?: string; responseCode?: number; message?: string };
  if (isAuthError(e)) return 'رفض Gmail اسم المستخدم أو كلمة مرور التطبيق. تأكد من كلمة مرور التطبيق في ملف .env على السيرفر';
  if (x?.code === 'ECONNECTION' || x?.code === 'ETIMEDOUT' || x?.code === 'ESOCKET' || x?.code === 'EDNS') return 'تعذر الاتصال بخادم البريد. تحقق من اتصال السيرفر بالإنترنت ومن المنفذ';
  if (x?.responseCode === 550 || x?.responseCode === 553) return `رفض الخادم عنوان المستلم: ${x.message ?? ''}`.slice(0, 480);
  if (x?.responseCode === 421 || x?.responseCode === 454 || /limit|quota/i.test(x?.message ?? '')) return 'تجاوزت الحد المسموح من Gmail مؤقتًا، وستُعاد المحاولة لاحقًا';
  return (x?.message ?? String(e)).slice(0, 480);
}

/**
 * خدمة البريد الصادر للمنصة. قابلة للتبديل: الإرسال عبر SMTP بإعدادات من ملف .env
 * (Gmail الآن، وGoogle Workspace أو أي مزود لاحقًا بتغيير الإعدادات فقط).
 * كل رسالة تُحفظ في صندوق الصادر، والعامل يرسلها ويعيد المحاولة عند الفشل ويحترم الحد اليومي.
 */
@Injectable()
export class MailService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger('Mail');
  private timer: NodeJS.Timeout | null = null;
  private transport: Transporter | null = null;
  private transportKey = '';
  private running = false;
  /** الرسائل المرسلة في وضع الاختبار (MAIL_TRANSPORT=test) */
  readonly testSent: { to: string; subject: string; html: string; text: string; from: string; replyTo?: string }[] = [];

  constructor(private readonly db: DataSource) {}

  onApplicationBootstrap() {
    const env = smtpEnv();
    this.logger.log(env.mode === 'off' ? 'Mail is not configured (SMTP_USER/SMTP_PASS missing); messages will be skipped' : `Mail via ${env.host}:${env.port} as ${maskEmail(env.from)}`);
    if (process.env.JEST_WORKER_ID || process.env.MAIL_WORKER === 'off') return;
    let ticks = 0;
    this.timer = setInterval(() => {
      if (++ticks % 240 === 0) this.prune().catch(() => undefined);
      this.processQueue().catch((e) => this.logger.error(`Mail worker failed: ${(e as Error).message}`));
    }, TICK_MS);
    this.timer.unref();
  }

  onApplicationShutdown() {
    if (this.timer) clearInterval(this.timer);
    this.transport?.close();
  }

  settings() {
    return mailSettings(this.db);
  }

  /** هل يمكن الإرسال الآن (الخادم مضبوط والبريد مفعل)؟ */
  async ready(event?: MailEvent) {
    const env = smtpEnv();
    if (env.mode === 'off') return false;
    const s = await this.settings();
    return s.enabled && (!event || s.events[event]);
  }

  private getTransport(env: SmtpEnv): Transporter {
    const key = JSON.stringify([env.mode, env.host, env.port, env.secure, env.user, env.pass]);
    if (this.transport && key === this.transportKey) return this.transport;
    this.transport?.close();
    this.transport = env.mode === 'test'
      ? createTransport({ jsonTransport: true })
      : createTransport({
        host: env.host!, port: env.port, secure: env.secure,
        auth: env.user ? { user: env.user, pass: env.pass! } : undefined,
        pool: true, maxConnections: 2, maxMessages: 50,
        connectionTimeout: 20_000, greetingTimeout: 15_000, socketTimeout: 30_000,
      });
    this.transportKey = key;
    return this.transport;
  }

  /**
   * يضيف رسالة لكل مستلم إلى صندوق الصادر. يعيد العناوين التي أُضيفت.
   * إذا كان البريد غير مضبوط أو الحدث موقوفًا تُسجَّل الرسالة «متجاوزة» بلا نص.
   */
  async queue(m: QueueMail): Promise<string[]> {
    const list = [...new Set((Array.isArray(m.to) ? m.to : [m.to])
      .map((t) => t?.trim().toLowerCase())
      .filter((t): t is string => !!t && EMAIL_RE.test(t)))];
    if (!list.length) return [];
    const env = smtpEnv();
    const s = await this.settings();
    const skipReason = env.mode === 'off' ? 'البريد غير مضبوط على السيرفر'
      : !s.enabled ? 'الإرسال موقوف من إعدادات البريد'
      : m.event && !s.events[m.event] ? `هذا النوع موقوف: ${MAIL_EVENTS[m.event]}` : null;
    const rows = list.map((to) => ({
      to, subject: m.subject.slice(0, 300), kind: m.kind, organizationId: m.organizationId ?? null,
      sensitive: !!m.sensitive, createdBy: m.createdBy ?? null,
      dedupeKey: m.dedupeKey ? `${m.dedupeKey}:${to}`.slice(0, 200) : null,
      status: (skipReason ? 'skipped' : 'queued') as MailStatus,
      lastError: skipReason,
      html: skipReason ? null : m.html,
      text: skipReason ? null : m.text,
    }));
    const res = await this.db.createQueryBuilder().insert().into(MailMessage).values(rows).orIgnore().returning(['to', 'status']).execute();
    const added = (res.raw as { to_email: string; status: string }[]).filter((r) => r.status === 'queued').map((r) => r.to_email);
    if (added.length) this.kick();
    return added;
  }

  /** إرسال فوري بعد الإضافة بدل انتظار الدورة التالية (يتوقف في الاختبارات التي تستدعي processQueue بنفسها) */
  private kick() {
    if (process.env.JEST_WORKER_ID || process.env.MAIL_WORKER === 'off') return;
    setImmediate(() => this.processQueue().catch((e) => this.logger.error(`Mail worker failed: ${(e as Error).message}`)));
  }

  private async sentLast24h() {
    const [r] = await this.db.query(`SELECT COUNT(*)::int AS n FROM mail_outbox WHERE status = 'sent' AND sent_at > now() - interval '24 hours'`);
    return r.n as number;
  }

  /** يرسل الرسائل المستحقة. يعمل مرة واحدة في كل وقت لكل عملية، ويحجز الرسائل بقفل لتجنب الإرسال المكرر */
  async processQueue(): Promise<number> {
    if (this.running) return 0;
    this.running = true;
    try {
      const env = smtpEnv();
      if (env.mode === 'off') return 0;
      const s = await this.settings();
      if (!s.enabled) return 0;
      const room = s.dailyLimit - (await this.sentLast24h());
      if (room <= 0) return 0;
      // حجز دفعة: من «في الطابور» إلى «قيد الإرسال» (رسائل علقت أكثر من 10 دقائق تُستعاد)
      const res = await this.db.query(
        `UPDATE mail_outbox SET status = 'sending', attempts = attempts + 1, next_attempt_at = now() + interval '10 minutes'
          WHERE id IN (SELECT id FROM mail_outbox WHERE status IN ('queued', 'sending') AND next_attempt_at <= now()
                        ORDER BY created_at LIMIT $1 FOR UPDATE SKIP LOCKED)
          RETURNING id, to_email AS "to", subject, html, text, attempts, sensitive`, [Math.min(BATCH, room)]);
      // مع UPDATE ... RETURNING يعيد TypeORM مصفوفة [الصفوف، العدد]
      const claimed: MailMessage[] = Array.isArray(res[0]) ? res[0] : res;
      let sent = 0;
      for (const m of claimed) {
        if (await this.deliver(m, env, s)) sent++;
      }
      return sent;
    } finally {
      this.running = false;
    }
  }

  private async deliver(m: Pick<MailMessage, 'id' | 'to' | 'subject' | 'html' | 'text' | 'attempts' | 'sensitive'>, env: SmtpEnv, s: MailSettings) {
    const repo = this.db.getRepository(MailMessage);
    if (!m.html && !m.text) {
      await repo.update(m.id, { status: 'failed', lastError: 'لا يوجد نص للرسالة' });
      return false;
    }
    try {
      await this.sendNow(env, s, { to: m.to, subject: m.subject, html: m.html ?? undefined, text: m.text ?? undefined });
      await repo.update(m.id, {
        status: 'sent', sentAt: new Date(), lastError: null,
        ...(m.sensitive ? { html: null, text: null } : {}),
      });
      return true;
    } catch (e) {
      const final = m.attempts >= MAX_ATTEMPTS || isAuthError(e) && m.attempts >= 3;
      const wait = RETRY_MINUTES[Math.min(m.attempts - 1, RETRY_MINUTES.length - 1)];
      await repo.update(m.id, {
        status: final ? 'failed' : 'queued', lastError: explainError(e),
        nextAttemptAt: new Date(Date.now() + wait * 60_000),
        ...(final && m.sensitive ? { html: null, text: null } : {}),
      });
      this.logger.warn(`Mail to ${maskEmail(m.to)} failed (attempt ${m.attempts}${final ? ', final' : ''}): ${(e as Error).message}`);
      return false;
    }
  }

  private async sendNow(env: SmtpEnv, s: MailSettings, msg: { to: string; subject: string; html?: string; text?: string }) {
    const from = { name: s.senderName || DEFAULT_MAIL_SETTINGS.senderName, address: env.from! };
    const info = await this.getTransport(env).sendMail({
      from, to: msg.to, subject: msg.subject, html: msg.html, text: msg.text,
      replyTo: s.replyTo || undefined,
      headers: { 'Auto-Submitted': 'auto-generated' },
    });
    if (env.mode === 'test') {
      const j = JSON.parse((info as { message: string }).message);
      this.testSent.push({ to: msg.to, subject: msg.subject, html: msg.html ?? '', text: msg.text ?? '', from: `${j.from?.name} <${j.from?.address}>`, replyTo: j.replyTo?.[0]?.address });
    }
  }

  /** رسالة تجريبية تُرسل فورًا ليرى مدير المنصة النتيجة أو سبب الخطأ مباشرة */
  async sendTest(to: string, by: string) {
    const email = to?.trim().toLowerCase();
    if (!email || !EMAIL_RE.test(email)) throw new BadRequestException('اكتب بريدًا إلكترونيًا صحيحًا');
    const env = smtpEnv();
    if (env.mode === 'off') throw new BadRequestException('البريد غير مضبوط على السيرفر بعد. أضف بيانات Gmail في ملف .env ثم أعد التشغيل');
    const s = await this.settings();
    const t = templates.test(by);
    const row = await this.db.getRepository(MailMessage).save({
      to: email, subject: t.subject, html: t.html, text: t.text, kind: 'test', status: 'sending', attempts: 1, createdBy: by,
    });
    try {
      await this.sendNow(env, s, { to: email, ...t });
      await this.db.getRepository(MailMessage).update(row.id, { status: 'sent', sentAt: new Date() });
      return { ok: true, message: `تم الإرسال إلى ${email}. تحقق من صندوق الوارد (وأحيانًا مجلد الرسائل غير المرغوب فيها).` };
    } catch (e) {
      const err = explainError(e);
      await this.db.getRepository(MailMessage).update(row.id, { status: 'failed', lastError: err });
      throw new BadRequestException(`لم تُرسل الرسالة: ${err}`);
    }
  }

  async status() {
    const env = smtpEnv();
    const s = await this.settings();
    const counts: { status: string; n: number }[] = await this.db.query(
      `SELECT status, COUNT(*)::int AS n FROM mail_outbox WHERE created_at > now() - interval '30 days' GROUP BY status`);
    return {
      configured: env.mode !== 'off',
      mode: env.mode,
      host: env.host, port: env.port,
      from: env.from,
      provider: env.host === 'smtp.gmail.com' ? 'Gmail' : env.mode === 'test' ? 'اختبار' : env.host,
      sentLast24h: await this.sentLast24h(),
      counts: Object.fromEntries(MAIL_STATUSES.map((k) => [k, counts.find((c) => c.status === k)?.n ?? 0])),
      settings: s,
      events: MAIL_EVENTS,
    };
  }

  async saveSettings(dto: Partial<MailSettings>) {
    const cur = await this.settings();
    const adminEmails = (dto.adminEmails ?? cur.adminEmails).map((e) => e.trim().toLowerCase()).filter(Boolean);
    const bad = adminEmails.filter((e) => !EMAIL_RE.test(e));
    if (bad.length) throw new BadRequestException(`بريد غير صحيح: ${bad.join('، ')}`);
    const replyTo = dto.replyTo === undefined ? cur.replyTo : dto.replyTo?.trim().toLowerCase() || null;
    if (replyTo && !EMAIL_RE.test(replyTo)) throw new BadRequestException('بريد الرد غير صحيح');
    const dailyLimit = Math.round(Number(dto.dailyLimit ?? cur.dailyLimit));
    if (!Number.isFinite(dailyLimit) || dailyLimit < 1 || dailyLimit > 100_000) throw new BadRequestException('الحد اليومي بين 1 و100000');
    const senderName = (dto.senderName ?? cur.senderName).trim().slice(0, 60) || DEFAULT_MAIL_SETTINGS.senderName;
    const events = { ...cur.events };
    for (const k of Object.keys(MAIL_EVENTS) as MailEvent[]) if (typeof dto.events?.[k] === 'boolean') events[k] = dto.events[k];
    const value: MailSettings = { enabled: dto.enabled ?? cur.enabled, senderName, replyTo, adminEmails: [...new Set(adminEmails)].slice(0, 10), dailyLimit, events };
    await this.db.getRepository(PlatformSetting).save({ key: 'mail', value: value as unknown as Record<string, unknown> });
    return this.status();
  }

  /** عناوين إشعارات الإدارة: من الإعدادات، وإلا بريد الإرسال نفسه */
  async adminRecipients() {
    const s = await this.settings();
    if (s.adminEmails.length) return s.adminEmails;
    const from = smtpEnv().from;
    return from ? [from] : [];
  }

  async log(q: { status?: string; kind?: string; page?: number }) {
    const take = 50;
    const page = Math.max(1, Number(q.page) || 1);
    const where: Record<string, unknown> = {};
    if (q.status && (MAIL_STATUSES as readonly string[]).includes(q.status)) where.status = q.status;
    if (q.kind) where.kind = q.kind.slice(0, 40);
    const [rows, total] = await this.db.getRepository(MailMessage).findAndCount({
      where, order: { createdAt: 'DESC' }, take, skip: (page - 1) * take,
      select: { id: true, to: true, subject: true, kind: true, status: true, attempts: true, lastError: true, sentAt: true, createdAt: true, sensitive: true, createdBy: true, nextAttemptAt: true },
    });
    return { rows, total, page, pages: Math.max(1, Math.ceil(total / take)) };
  }

  /** معاينة نص رسالة (غير الحساسة) */
  async preview(id: string) {
    const m = await this.db.getRepository(MailMessage).findOne({ where: { id } });
    if (!m) throw new NotFoundException('الرسالة غير موجودة');
    if (m.sensitive) throw new BadRequestException('هذه الرسالة تحتوي على بيانات دخول، ولا يُعرض نصها');
    return { html: m.html, text: m.text, subject: m.subject, to: m.to };
  }

  /** إعادة محاولة رسالة فشلت */
  async retry(id: string) {
    const m = await this.db.getRepository(MailMessage).findOne({ where: { id } });
    if (!m) throw new NotFoundException('الرسالة غير موجودة');
    if (!['failed', 'queued'].includes(m.status)) throw new BadRequestException('لا يمكن إعادة إرسال هذه الرسالة');
    if (!m.html && !m.text) throw new BadRequestException('نص الرسالة غير محفوظ لأنها تحتوي على بيانات دخول. أنشئ كلمة مرور مؤقتة جديدة بدلًا من ذلك');
    await this.db.getRepository(MailMessage).update(m.id, { status: 'queued', attempts: 0, nextAttemptAt: new Date(), lastError: null });
    this.kick();
    return { ok: true };
  }

  /** حذف نصوص الرسائل القديمة (أكثر من 90 يومًا) مع إبقاء سجلها */
  async prune() {
    await this.db.query(`UPDATE mail_outbox SET html = NULL, text = NULL WHERE created_at < now() - interval '90 days' AND (html IS NOT NULL OR text IS NOT NULL) AND status IN ('sent', 'failed', 'skipped')`);
  }

  /** للاختبارات: كل الرسائل المرسلة لعنوان */
  sentTo(email: string) {
    return this.testSent.filter((m) => m.to === email.toLowerCase());
  }
}
