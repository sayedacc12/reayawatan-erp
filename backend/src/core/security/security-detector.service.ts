import { Injectable, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { MailService } from '../mail/mail.service';
import { templates } from '../mail/mail-templates';
import { IncidentAction, SecBlock, SecIncident, SecSeverity } from './security.entity';
import { SecurityMonitor } from './security-monitor.service';
import { normIp, SecuritySettings } from './security-settings';

export const SEVERITY_AR: Record<SecSeverity, string> = { critical: 'حرج', high: 'مرتفع', medium: 'متوسط', low: 'منخفض', info: 'معلومة' };

export const RULES = {
  brute_force: 'محاولات دخول فاشلة متكررة من عنوان واحد',
  password_spray: 'تجربة كلمات مرور على حسابات متعددة من عنوان واحد',
  account_attack: 'محاولات دخول على حساب واحد من عناوين متعددة',
  scanner: 'فحص آلي لمسارات النظام',
  probe: 'محاولة الوصول لسجلات غير مسموحة',
  spray_success: 'دخول ناجح من عنوان كان يجرب كلمات المرور',
  new_admin_ip: 'دخول حساب بصلاحيات عليا من عنوان جديد',
  error_spike: 'ارتفاع أخطاء الخادم',
  mass_export: 'تصدير بيانات بكميات كبيرة',
} as const;
export type RuleCode = keyof typeof RULES;

/** حادثة لنفس المصدر خلال هذه المدة تُحدَّث ولا تتكرر رسالتها */
const DEDUPE_HOURS = 6;
/** عنوان سجّل منه موظف دخولًا ناجحًا خلال هذه المدة يُعدّ معروفًا: يُنبَّه عنه ولا يُحظر */
const KNOWN_IP_DAYS = 14;
/** عدد الحسابات المختلفة من عنوان واحد التي تعني تجربة كلمات مرور على حسابات كثيرة */
const SPRAY_ACCOUNTS = 5;
/** عدد العناوين المختلفة على حساب واحد التي تعني هجومًا موزعًا على الحساب */
const ACCOUNT_IPS = 5;
/** أقل عدد مسارات مختلفة لاعتبار الطلبات المرفوضة فحصًا آليًا (التحديث الدوري لصفحة واحدة لا يُحتسب) */
const SCAN_DISTINCT_PATHS = 10;
const SYSTEM = 'سيد (تلقائي)';

interface Finding {
  rule: RuleCode;
  severity: SecSeverity;
  key: string;
  summary: string;
  hits: number;
  ip?: string | null;
  userId?: string | null;
  orgId?: string | null;
  /** الإجراء المقترح: يُنفذ تلقائيًا إن سمحت الإعدادات */
  act?: 'block' | 'revoke' | null;
  /** يطلب موافقة الإدارة على إيقاف الحساب */
  suspend?: boolean;
}

/**
 * محرك الرصد: يفحص الأحداث الأخيرة بقواعد واضحة، وينشئ حادثة لكل نمط شاذ، وينفذ الإجراء الموضعي
 * على المصدر المهاجم وحده (حظر عنوان مؤقتًا أو إنهاء جلسات حساب)، ويرسل تنبيهًا فوريًا بالبريد.
 * لا يوقف أي نظام، ولا يوقف حساب موظف إلا بموافقة الإدارة.
 */
@Injectable()
export class SecurityDetector {
  private readonly logger = new Logger('Security');
  private since = new Date(Date.now() - 10 * 60_000);
  private running = false;

  constructor(
    private readonly db: DataSource,
    private readonly monitor: SecurityMonitor,
    private readonly mail: MailService,
  ) {}

  /** دورة رصد كاملة: يكتب الأحداث المنتظرة أولًا ثم يفحصها. تعيد الحوادث الجديدة */
  async run(): Promise<SecIncident[]> {
    if (this.running) return [];
    this.running = true;
    try {
      await this.monitor.flush();
      const s = await this.monitor.settings(true);
      if (!s.enabled) return [];
      const started = new Date();
      const findings = await this.findings(s, new Date(this.since.getTime() - 60_000));
      this.since = started;
      const created: SecIncident[] = [];
      for (const f of findings) {
        try {
          const inc = await this.handle(f, s);
          if (inc) created.push(inc);
        } catch (e) {
          this.logger.warn(`تعذر معالجة حادثة ${f.rule}: ${(e as Error).message}`);
        }
      }
      return created;
    } finally {
      this.running = false;
    }
  }

  private async findings(s: SecuritySettings, since: Date): Promise<Finding[]> {
    const t = s.thresholds;
    const out: Finding[] = [];
    const q = <T>(sql: string, params: unknown[] = []) => this.db.query(sql, params) as Promise<T[]>;

    // 1) محاولات دخول فاشلة من عنوان واحد خلال 10 دقائق
    for (const r of await q<{ ip: string; n: number; actors: number }>(
      `SELECT ip, COUNT(*)::int AS n, COUNT(DISTINCT actor)::int AS actors FROM sec_events
       WHERE type IN ('login_failed', 'login_throttled') AND at > now() - interval '10 minutes' AND ip IS NOT NULL
       GROUP BY ip HAVING COUNT(*) >= $1`, [t.bruteForce])) {
      const spray = r.actors >= SPRAY_ACCOUNTS;
      out.push({
        rule: spray ? 'password_spray' : 'brute_force', severity: 'high', key: `${spray ? 'spray' : 'brute'}:${r.ip}`, ip: r.ip, hits: r.n, act: 'block',
        summary: spray
          ? `${r.n} محاولة دخول فاشلة خلال 10 دقائق من العنوان ${r.ip} على ${r.actors} حسابات مختلفة.`
          : `${r.n} محاولة دخول فاشلة خلال 10 دقائق من العنوان ${r.ip}.`,
      });
    }

    // 2) حساب واحد تُجرَّب كلمته من عناوين كثيرة خلال ساعة
    for (const r of await q<{ actor: string; n: number; ips: number }>(
      `SELECT actor, COUNT(*)::int AS n, COUNT(DISTINCT ip)::int AS ips FROM sec_events
       WHERE type = 'login_failed' AND actor IS NOT NULL AND at > now() - interval '1 hour'
       GROUP BY actor HAVING COUNT(DISTINCT ip) >= $1 AND COUNT(*) >= $2`, [ACCOUNT_IPS, t.bruteForce])) {
      out.push({
        rule: 'account_attack', severity: 'medium', key: `account:${r.actor}`, hits: r.n,
        summary: `${r.n} محاولة دخول فاشلة خلال ساعة على الحساب «${r.actor}» من ${r.ips} عناوين مختلفة. يُنصح بتغيير كلمة مروره إن كانت ضعيفة.`,
      });
    }

    // 3) فحص آلي: طلبات مرفوضة أو لمسارات غير موجودة بلا جلسة، على مسارات كثيرة مختلفة خلال 5 دقائق
    for (const r of await q<{ ip: string; n: number; paths: number }>(
      `SELECT ip, COUNT(*)::int AS n, COUNT(DISTINCT COALESCE(detail->>'path', route))::int AS paths FROM sec_events
       WHERE type IN ('unknown_route', 'auth_required', 'not_found', 'forbidden', 'rate_limited') AND user_id IS NULL
         AND ip IS NOT NULL AND at > now() - interval '5 minutes'
       GROUP BY ip HAVING COUNT(*) >= $1 AND COUNT(DISTINCT COALESCE(detail->>'path', route)) >= $2`, [t.scan, SCAN_DISTINCT_PATHS])) {
      out.push({
        rule: 'scanner', severity: 'medium', key: `scan:${r.ip}`, ip: r.ip, hits: r.n, act: 'block',
        summary: `${r.n} طلبًا مرفوضًا خلال 5 دقائق من العنوان ${r.ip} على ${r.paths} مسارًا مختلفًا، وهذا نمط أدوات الفحص الآلي.`,
      });
    }

    // 4) حساب داخل النظام يطلب سجلات كثيرة غير موجودة أو غير مسموحة له (محاولة الوصول لبيانات جمعية أخرى)
    //    تُحتسب فقط الطلبات بعد آخر إنهاء لجلساته، حتى لا يتكرر الإجراء على نفس الأحداث
    for (const r of await q<{ userId: string; orgId: string | null; ip: string | null; n: number; paths: number; email: string }>(
      `SELECT e.user_id AS "userId", MAX(e.org_id::text) AS "orgId", MAX(e.ip) AS ip, COUNT(*)::int AS n,
              COUNT(DISTINCT COALESCE(e.detail->>'path', e.route))::int AS paths, MAX(u.email) AS email
       FROM sec_events e JOIN users u ON u.id = e.user_id
       WHERE e.type IN ('not_found', 'forbidden') AND e.at > GREATEST(now() - interval '10 minutes', COALESCE(u.sessions_valid_after, '-infinity'::timestamptz))
       GROUP BY e.user_id HAVING COUNT(DISTINCT COALESCE(e.detail->>'path', e.route)) >= $1`, [t.probe])) {
      out.push({
        rule: 'probe', severity: 'high', key: `probe:${r.userId}`, userId: r.userId, orgId: r.orgId, ip: r.ip, hits: r.n, act: 'revoke', suspend: true,
        summary: `الحساب ${r.email} طلب ${r.paths} سجلًا أو مسارًا مختلفًا غير موجود أو غير مسموح له خلال 10 دقائق. هذا نمط محاولة الوصول لبيانات لا تخصه، وقد يعني أن الحساب مخترق.`,
      });
    }

    // 5) دخول ناجح من عنوان جرّب كلمات مرور على حسابات كثيرة خلال الساعة السابقة
    for (const r of await q<{ ip: string; userId: string; orgId: string | null; actor: string | null; accounts: number }>(
      `SELECT s.ip, s.user_id AS "userId", s.org_id AS "orgId", s.actor,
              (SELECT COUNT(DISTINCT f.actor) FROM sec_events f WHERE f.ip = s.ip AND f.type = 'login_failed'
                 AND f.at BETWEEN s.at - interval '1 hour' AND s.at)::int AS accounts
       FROM sec_events s WHERE s.type = 'login_success' AND s.at > $1 AND s.ip IS NOT NULL AND s.user_id IS NOT NULL`, [since])) {
      if (r.accounts < SPRAY_ACCOUNTS) continue;
      out.push({
        rule: 'spray_success', severity: 'critical', key: `spray_success:${r.userId}:${r.ip}`, ip: r.ip, userId: r.userId, orgId: r.orgId, hits: r.accounts,
        act: 'revoke', suspend: true,
        summary: `دخل الحساب «${r.actor ?? ''}» بنجاح من العنوان ${r.ip} الذي جرّب كلمات مرور على ${r.accounts} حسابات خلال الساعة السابقة. قد تكون كلمة مرور هذا الحساب قد كُشفت.`,
      });
    }

    // 6) مدير منصة أو مدير جمعية يدخل من عنوان لم يُرَ له من قبل (خلال 90 يومًا)
    for (const r of await q<{ ip: string; userId: string; orgId: string | null; actor: string | null }>(
      `SELECT s.ip, s.user_id AS "userId", s.org_id AS "orgId", s.actor FROM sec_events s
       WHERE s.type = 'login_success' AND s.at > $1 AND s.ip IS NOT NULL AND s.detail->>'privileged' = 'true'
         AND EXISTS (SELECT 1 FROM sec_events p WHERE p.user_id = s.user_id AND p.type = 'login_success' AND p.at < s.at AND p.at > s.at - interval '90 days')
         AND NOT EXISTS (SELECT 1 FROM sec_events p WHERE p.user_id = s.user_id AND p.type = 'login_success' AND p.ip = s.ip AND p.at < s.at AND p.at > s.at - interval '90 days')`,
      [since])) {
      if (await this.monitor.protectedIp(r.ip)) continue;
      out.push({
        rule: 'new_admin_ip', severity: 'medium', key: `newip:${r.userId}:${r.ip}`, ip: r.ip, userId: r.userId, orgId: r.orgId, hits: 1,
        summary: `دخل الحساب «${r.actor ?? ''}» (صلاحيات عليا) من عنوان جديد ${r.ip} لم يُستخدم معه من قبل. إن لم يكن هذا الدخول منك أو من صاحب الحساب فغيّر كلمة المرور فورًا.`,
      });
    }

    // 7) ارتفاع أخطاء الخادم
    const [errs] = await q<{ n: number }>(`SELECT COUNT(*)::int AS n FROM sec_events WHERE type = 'server_error' AND at > now() - interval '10 minutes'`);
    if (errs && errs.n >= t.errors) {
      out.push({
        rule: 'error_spike', severity: 'high', key: 'errors', hits: errs.n,
        summary: `${errs.n} خطأ خادم خلال 10 دقائق. قد يكون عطلًا في النظام أو محاولة لإرباكه. راجع سجل الأخطاء في شاشة المراقب.`,
      });
    }

    // 8) تصدير بيانات كثيرة من حساب واحد خلال ساعة
    for (const r of await q<{ userId: string; orgId: string | null; ip: string | null; n: number; email: string | null }>(
      `SELECT user_id AS "userId", MAX(org_id::text) AS "orgId", MAX(ip) AS ip, COUNT(*)::int AS n, MAX(actor) AS email FROM sec_events
       WHERE type = 'export' AND user_id IS NOT NULL AND at > now() - interval '1 hour' GROUP BY user_id HAVING COUNT(*) >= $1`, [t.exports])) {
      out.push({
        rule: 'mass_export', severity: 'medium', key: `export:${r.userId}`, userId: r.userId, orgId: r.orgId, ip: r.ip, hits: r.n,
        summary: `الحساب ${r.email ?? ''} نفّذ ${r.n} عملية تصدير خلال ساعة. تأكد أن هذا ضمن عمله المعتاد.`,
      });
    }
    return out;
  }

  /** ينشئ الحادثة أو يحدّثها، وينفذ الإجراء المسموح، ويرسل التنبيه للحوادث الجديدة */
  private async handle(f: Finding, s: SecuritySettings): Promise<SecIncident | null> {
    const repo = this.db.getRepository(SecIncident);
    let inc = await repo
      .createQueryBuilder('i')
      .where('i.dedupeKey = :k AND i.status IN (:...st) AND i.lastSeenAt > :after', {
        k: f.key.slice(0, 200), st: ['open', 'acknowledged'], after: new Date(Date.now() - DEDUPE_HOURS * 3_600_000),
      })
      .orderBy('i.lastSeenAt', 'DESC')
      .getOne();
    const isNew = !inc;
    if (!inc) {
      inc = repo.create({
        rule: f.rule, severity: f.severity, title: RULES[f.rule], summary: f.summary.slice(0, 2000), dedupeKey: f.key.slice(0, 200),
        ip: normIp(f.ip), userId: f.userId ?? null, orgId: f.orgId ?? null, hits: f.hits, status: 'open', actions: [], pendingAction: null,
        lastSeenAt: new Date(),
      });
    } else {
      inc.hits = Math.max(inc.hits, f.hits);
      inc.summary = f.summary.slice(0, 2000);
      inc.lastSeenAt = new Date();
    }
    inc = await repo.save(inc);

    const done: string[] = [];
    const known = f.ip ? await this.knownIp(f.ip, f.userId) : false;
    if (f.act === 'block' && f.ip) {
      if (await this.monitor.protectedIp(f.ip)) {
        if (isNew) this.note(inc, 'skip', 'لم يُحظر العنوان لأنه عنوان داخلي أو موثوق في الإعدادات');
      } else if (known) {
        if (isNew) this.note(inc, 'skip', `لم يُحظر العنوان لأن موظفًا دخل منه بنجاح خلال آخر ${KNOWN_IP_DAYS} يومًا (قد يكون عنوان مكتب)، والتنبيه للمراجعة`);
      } else if (!s.autoActions) {
        if (isNew) this.note(inc, 'skip', 'الإجراءات التلقائية موقوفة من الإعدادات');
      } else if (!(await this.activeBlock(f.ip))) {
        const b = await this.block(f.ip, s.blockMinutes, `${RULES[f.rule]} (${f.hits})`, inc.id, SYSTEM);
        this.note(inc, 'block', `حُظر العنوان ${f.ip} مؤقتًا لمدة ${s.blockMinutes} دقيقة`, b.id);
        done.push(`حظر العنوان ${f.ip} مؤقتًا لمدة ${s.blockMinutes} دقيقة`);
      }
    }
    if (f.act === 'revoke' && f.userId) {
      const isSpray = f.rule === 'spray_success';
      if (isSpray && known) {
        if (isNew) this.note(inc, 'skip', 'لم تُنهَ الجلسة لأن الدخول من عنوان معروف استُخدم بنجاح من قبل');
      } else if (!s.autoActions) {
        if (isNew) this.note(inc, 'skip', 'الإجراءات التلقائية موقوفة من الإعدادات');
      } else {
        await this.db.query(`UPDATE users SET sessions_valid_after = now() WHERE id = $1`, [f.userId]);
        this.note(inc, 'revoke', 'أُنهيت جلسات الحساب المفتوحة، وعليه الدخول من جديد');
        done.push('إنهاء جلسات الحساب المشتبه به (يدخل من جديد)');
        this.monitor.record({ type: 'auto_action', severity: 'medium', userId: f.userId, orgId: f.orgId, ip: f.ip, detail: { action: 'revoke', incident: inc.id } });
      }
    }
    if (f.suspend && f.userId && isNew && !inc.pendingAction) {
      const [u] = await this.db.query(`SELECT is_platform_admin AS pa, is_active AS active FROM users WHERE id = $1`, [f.userId]);
      if (u?.active && !u.pa) inc.pendingAction = 'suspend_user';
    }
    inc = await repo.save(inc);

    if (isNew) {
      await this.alert(inc, done, s).catch((e) => this.logger.warn(`تعذر إرسال التنبيه الأمني: ${(e as Error).message}`));
      return inc;
    }
    return null;
  }

  private note(inc: SecIncident, kind: string, text: string, ref?: string | null) {
    const a: IncidentAction = { at: new Date().toISOString(), kind, text, by: SYSTEM, ref: ref ?? null };
    inc.actions = [...(inc.actions ?? []), a];
  }

  /** عنوان دخل منه موظف بنجاح خلال آخر 14 يومًا (غير المستخدم نفسه في الحادثة إن وُجد) */
  private async knownIp(ip: string, exceptUser?: string | null) {
    const [r] = await this.db.query(
      `SELECT 1 FROM sec_events WHERE type = 'login_success' AND ip = $1 AND at > now() - make_interval(days => $2)
         AND at < now() - interval '2 minutes' AND ($3::uuid IS NULL OR user_id <> $3::uuid) LIMIT 1`,
      [normIp(ip), KNOWN_IP_DAYS, exceptUser ?? null],
    );
    return !!r;
  }

  private async activeBlock(ip: string) {
    const [r] = await this.db.query(`SELECT 1 FROM sec_blocks WHERE ip = $1 AND lifted_at IS NULL AND expires_at > now() LIMIT 1`, [normIp(ip)]);
    return !!r;
  }

  async block(ip: string, minutes: number, reason: string, incidentId: string | null, by: string): Promise<SecBlock> {
    const repo = this.db.getRepository(SecBlock);
    const b = await repo.save(repo.create({
      ip: normIp(ip)!, reason: reason.slice(0, 300), incidentId, createdBy: by.slice(0, 200), expiresAt: new Date(Date.now() + minutes * 60_000),
    }));
    this.monitor.markBlocked(b.ip, b.expiresAt);
    this.monitor.record({ type: 'ip_blocked', severity: 'medium', ip: b.ip, detail: { minutes, by, incident: incidentId } });
    return b;
  }

  async recipients(s?: SecuritySettings) {
    const settings = s ?? (await this.monitor.settings());
    return settings.recipients.length ? settings.recipients : this.mail.adminRecipients();
  }

  private async alert(inc: SecIncident, done: string[], s: SecuritySettings) {
    const to = await this.recipients(s);
    if (!to.length) return;
    const facts: { label: string; value: string; ltr?: boolean }[] = [
      { label: 'الخطورة', value: SEVERITY_AR[inc.severity] },
      { label: 'الوقت', value: fmtRiyadh(inc.lastSeenAt) },
    ];
    if (inc.ip) facts.push({ label: 'العنوان', value: inc.ip, ltr: true });
    if (inc.userId) {
      const [u] = await this.db.query(
        `SELECT u.full_name AS name, u.email, o.name AS org FROM users u LEFT JOIN organizations o ON o.id = u.organization_id WHERE u.id = $1`, [inc.userId]);
      if (u) {
        facts.push({ label: 'الحساب', value: `${u.name} (${u.email})` });
        facts.push({ label: 'الجمعية', value: u.org ?? 'إدارة المنصة' });
      }
    }
    await this.mail.queue({
      to, kind: 'security_alert', event: 'security', createdBy: 'المراقب الأمني', dedupeKey: `sec-incident:${inc.id}`,
      ...templates.securityAlert({
        severity: SEVERITY_AR[inc.severity], title: inc.title, summary: inc.summary, facts, actions: done,
        pending: inc.pendingAction === 'suspend_user' ? 'إيقاف الحساب المشتبه به' : null,
      }),
    });
    inc.alertedAt = new Date();
    await this.db.getRepository(SecIncident).update(inc.id, { alertedAt: inc.alertedAt });
  }
}

export const fmtRiyadh = (d: Date) =>
  new Date(d).toLocaleString('ar-SA-u-ca-gregory-nu-latn', { timeZone: 'Asia/Riyadh', dateStyle: 'medium', timeStyle: 'short' });
