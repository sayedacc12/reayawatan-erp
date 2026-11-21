import { Injectable, Logger, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { BackupsService } from '../backups/backups.service';
import { MailService } from '../mail/mail.service';
import { templates } from '../mail/mail-templates';
import { SecReport } from './security.entity';
import { SecurityDetector, SEVERITY_AR } from './security-detector.service';
import { SecurityMonitor } from './security-monitor.service';

/** مدة الاحتفاظ بالأحداث الأمنية التفصيلية (الحوادث والحظر والتقارير تبقى) */
export const RETENTION_DAYS = 90;
const DETECT_MS = 60_000;
const DAILY_CHECK_MS = 10 * 60_000;
const INSERT_REPORT = `INSERT INTO sec_reports (day, summary, recipients) VALUES ($1, $2, $3) ON CONFLICT (day) DO NOTHING RETURNING id`;
const UPSERT_REPORT = `INSERT INTO sec_reports (day, summary, recipients) VALUES ($1, $2, $3)
  ON CONFLICT (day) DO UPDATE SET summary = EXCLUDED.summary, recipients = EXCLUDED.recipients, created_at = now() RETURNING id`;

/** التاريخ والساعة الآن بتوقيت الرياض */
export function riyadhNow(d = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Riyadh', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' })
    .formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return { day: `${get('year')}-${get('month')}-${get('day')}`, hour: Number(get('hour')) };
}

const BACKUP_HEALTH: Record<string, string> = { ok: 'سليم', stale: 'متأخر', failed: 'فشل', off: 'غير مفعل' };
const EVENT_AR: Record<string, string> = {
  login_success: 'دخول ناجح', login_failed: 'دخول فاشل', login_throttled: 'دخول تجاوز الحد', auth_required: 'طلب بلا جلسة',
  forbidden: 'رفض صلاحية', not_found: 'سجل غير موجود', unknown_route: 'مسار غير موجود', rate_limited: 'تجاوز حد الطلبات',
  server_error: 'خطأ خادم', export: 'تصدير', admin_change: 'تغيير إداري', ip_blocked: 'حظر عنوان', auto_action: 'إجراء تلقائي',
};

export interface DailySummary {
  day: string;
  from: string;
  to: string;
  status: 'ok' | 'attention';
  events: Record<string, number>;
  incidents: { total: number; bySeverity: Record<string, number>; open: number; pendingApprovals: number; list: { title: string; severity: string; status: string; at: string }[] };
  blocks: { created: number; active: number; blockedRequests: number };
  topIps: { ip: string; n: number }[];
  performance: { requests: number; avgMs: number; slow: number; maxMs: number; errors: number };
  backups: { overall: string; targets: { name: string; health: string }[] };
  recommendations: string[];
}

/**
 * التقرير اليومي للمراقب «سيد»: الأداء والنسخ الاحتياطي والأحداث الأمنية والحوادث والحظر والتوصيات.
 * يُرسل مرة واحدة كل يوم في الساعة المحددة بتوقيت الرياض (افتراضيًا 7 صباحًا)، ويُحفظ في sec_reports.
 * يشغّل أيضًا دورة الرصد كل دقيقة، وحذف الأحداث الأقدم من 90 يومًا.
 */
@Injectable()
export class SecurityReports implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger('Security');
  private timers: NodeJS.Timeout[] = [];
  /** آخر خطأ مسجل: لا يتكرر نفس الخطأ في السجل كل دقيقة (مثلًا قبل تشغيل الترحيل) */
  private lastError = '';

  constructor(
    private readonly db: DataSource,
    private readonly monitor: SecurityMonitor,
    private readonly detector: SecurityDetector,
    private readonly mail: MailService,
    private readonly backups: BackupsService,
  ) {}

  onApplicationBootstrap() {
    if (process.env.JEST_WORKER_ID) return;
    const detect = setInterval(() => void this.detector.run().then(() => (this.lastError = '')).catch((e) => this.fail('detection', e)), DETECT_MS);
    const daily = setInterval(() => void this.tick().catch((e) => this.fail('report', e)), DAILY_CHECK_MS);
    detect.unref();
    daily.unref();
    this.timers = [detect, daily];
  }

  onApplicationShutdown() {
    this.timers.forEach(clearInterval);
  }

  private fail(what: string, e: unknown) {
    const msg = `Security ${what} failed: ${(e as Error).message}`;
    if (msg !== this.lastError) this.logger.error(msg);
    this.lastError = msg;
  }

  /** يرسل تقرير اليوم إن حان موعده ولم يُرسل، ويحذف الأحداث القديمة */
  async tick(now = new Date()) {
    const s = await this.monitor.settings(true);
    const { day, hour } = riyadhNow(now);
    if (s.enabled && s.dailyReport && hour >= s.dailyHour) {
      const [exists] = await this.db.query(`SELECT 1 FROM sec_reports WHERE day = $1`, [day]);
      if (!exists) await this.send(day, now);
    }
    await this.purge();
  }

  async purge() {
    await this.db.query(`DELETE FROM sec_events WHERE at < now() - make_interval(days => $1)`, [RETENTION_DAYS]);
  }

  /** يبني تقرير آخر 24 ساعة ويحفظه ويرسله. force يعيد إنشاء تقرير اليوم (زر «أرسل الآن») */
  async send(day = riyadhNow().day, now = new Date(), force = false) {
    const summary = await this.build(day, now);
    const to = await this.detector.recipients();
    // الإدراج أولًا يمنع الإرسال المكرر إن كانت هناك أكثر من نسخة من الخادم
    const res = await this.db.query(force ? UPSERT_REPORT : INSERT_REPORT, [day, JSON.stringify(summary), JSON.stringify(to)]);
    if (!res.length) return null;
    await this.mail.queue({
      to, kind: 'security_daily', event: 'security', createdBy: 'المراقب الأمني',
      dedupeKey: force ? `sec-daily:${day}:${now.getTime()}` : `sec-daily:${day}`,
      ...templates.securityDaily(this.mailContent(summary)),
    });
    return this.db.getRepository(SecReport).findOneBy({ day });
  }

  async build(day: string, now = new Date()): Promise<DailySummary> {
    const from = new Date(now.getTime() - 86_400_000);
    const q = <T>(sql: string, params: unknown[] = []) => this.db.query(sql, params) as Promise<T[]>;
    await this.monitor.flush();

    const events = Object.fromEntries(
      (await q<{ type: string; n: number }>(`SELECT type, COUNT(*)::int AS n FROM sec_events WHERE at > $1 AND at <= $2 GROUP BY type`, [from, now]))
        .map((r) => [r.type, r.n]),
    );
    const incidents = await q<{ title: string; severity: string; status: string; at: Date }>(
      `SELECT title, severity, status, first_seen_at AS at FROM sec_incidents WHERE first_seen_at > $1 AND first_seen_at <= $2 ORDER BY first_seen_at DESC`, [from, now]);
    const bySeverity: Record<string, number> = {};
    for (const i of incidents) bySeverity[i.severity] = (bySeverity[i.severity] ?? 0) + 1;
    const [open] = await q<{ n: number; pending: number }>(
      `SELECT COUNT(*)::int AS n, COUNT(*) FILTER (WHERE pending_action IS NOT NULL)::int AS pending FROM sec_incidents WHERE status <> 'resolved'`);
    const [blocks] = await q<{ created: number; active: number; hits: number }>(
      `SELECT COUNT(*) FILTER (WHERE created_at > $1)::int AS created,
              COUNT(*) FILTER (WHERE lifted_at IS NULL AND expires_at > now())::int AS active,
              COALESCE(SUM(blocked_requests) FILTER (WHERE created_at > $1), 0)::int AS hits
       FROM sec_blocks`, [from]);
    const topIps = await q<{ ip: string; n: number }>(
      `SELECT ip, COUNT(*)::int AS n FROM sec_events WHERE at > $1 AND at <= $2 AND ip IS NOT NULL
         AND type IN ('login_failed', 'login_throttled', 'unknown_route', 'auth_required', 'forbidden', 'rate_limited')
       GROUP BY ip ORDER BY n DESC LIMIT 5`, [from, now]);
    const [perf] = await q<{ requests: number; total: number; slow: number; max: number }>(
      `SELECT COALESCE(SUM(count), 0)::bigint AS requests, COALESCE(SUM(total_ms), 0)::bigint AS total,
              COALESCE(SUM(slow_count), 0)::bigint AS slow, COALESCE(MAX(max_ms), 0)::int AS max
       FROM perf_endpoint_stats WHERE day >= ($1::timestamptz AT TIME ZONE 'UTC')::date`, [from]).catch(() => [{ requests: 0, total: 0, slow: 0, max: 0 }]);
    const requests = Number(perf?.requests ?? 0);
    const b = await this.backups.overview().catch(() => null);

    const summary: DailySummary = {
      day, from: from.toISOString(), to: now.toISOString(), status: 'ok', events,
      incidents: {
        total: incidents.length, bySeverity, open: open?.n ?? 0, pendingApprovals: open?.pending ?? 0,
        list: incidents.slice(0, 10).map((i) => ({ title: i.title, severity: i.severity, status: i.status, at: new Date(i.at).toISOString() })),
      },
      blocks: { created: blocks?.created ?? 0, active: blocks?.active ?? 0, blockedRequests: blocks?.hits ?? 0 },
      topIps,
      performance: {
        requests, avgMs: requests ? Math.round(Number(perf.total) / requests) : 0, slow: Number(perf?.slow ?? 0), maxMs: Number(perf?.max ?? 0),
        errors: events.server_error ?? 0,
      },
      backups: { overall: b?.overall ?? 'off', targets: (b?.targets ?? []).map((t) => ({ name: t.name, health: t.health })) },
      recommendations: [],
    };
    summary.recommendations = this.recommend(summary);
    const serious = (bySeverity.critical ?? 0) + (bySeverity.high ?? 0);
    if (serious || summary.incidents.pendingApprovals || summary.backups.overall === 'alert' || summary.performance.errors >= 20) summary.status = 'attention';
    return summary;
  }

  private recommend(s: DailySummary): string[] {
    const r: string[] = [];
    if (s.incidents.pendingApprovals) r.push(`يوجد ${s.incidents.pendingApprovals} إجراء ينتظر موافقتك (إيقاف حساب مشتبه به). راجعه في شاشة المراقب الأمني.`);
    if ((s.incidents.bySeverity.critical ?? 0) > 0) r.push('حدثت حادثة حرجة: راجعها الآن، وغيّر كلمة مرور الحساب المعني، وتأكد من صاحبه.');
    if (s.incidents.open > 0 && !s.incidents.pendingApprovals) r.push(`توجد ${s.incidents.open} حادثة مفتوحة. راجعها وأغلق ما تأكدت منه.`);
    if (s.backups.overall === 'alert') r.push('النسخ الاحتياطي يحتاج مراجعة: افتح شاشة النسخ الاحتياطي.');
    if (s.backups.overall === 'off') r.push('لم تُسجل أي نسخة احتياطية بعد. تأكد من تشغيل النسخ الاحتياطي اليومي على السيرفر.');
    if (s.performance.errors >= 20) r.push(`ظهر ${s.performance.errors} خطأ خادم خلال اليوم. راجع سجل الأحداث لمعرفة الشاشة المتأثرة.`);
    if (s.performance.requests && s.performance.slow / s.performance.requests > 0.05) r.push('أكثر من 5% من الطلبات كانت بطيئة. راجع شاشة الأداء وحجم البيانات.');
    if ((s.events.login_failed ?? 0) >= 50) r.push('عدد محاولات الدخول الفاشلة مرتفع. ذكّر الموظفين باستخدام كلمات مرور قوية وعدم مشاركتها.');
    return r;
  }

  mailContent(s: DailySummary) {
    const n = (k: string) => String(s.events[k] ?? 0);
    const sev = Object.entries(s.incidents.bySeverity).map(([k, v]) => `${SEVERITY_AR[k as keyof typeof SEVERITY_AR] ?? k}: ${v}`).join('، ');
    const backupLine = s.backups.targets.length ? s.backups.targets.map((t) => `${t.name}: ${BACKUP_HEALTH[t.health] ?? t.health}`).join('، ') : 'لا توجد نسخ مسجلة';
    const paragraphs = [
      s.status === 'ok'
        ? 'كان يوم أمس هادئًا: لم تُرصد حوادث خطيرة، والأنظمة تعمل كالمعتاد.'
        : 'يحتاج يوم أمس إلى انتباهك: راجع الحوادث والتوصيات أدناه.',
      s.incidents.list.length
        ? `الحوادث: ${s.incidents.list.map((i) => `${i.title} (${SEVERITY_AR[i.severity as keyof typeof SEVERITY_AR] ?? i.severity})`).join('؛ ')}.`
        : 'لم تُسجل أي حادثة أمنية خلال آخر 24 ساعة.',
    ];
    return {
      day: s.day,
      status: s.status === 'ok' ? 'كل شيء سليم' : 'يحتاج انتباهك',
      paragraphs,
      facts: [
        { label: 'الطلبات ومتوسط الاستجابة', value: `${s.performance.requests} طلب، ${s.performance.avgMs} ملي ثانية` },
        { label: 'الطلبات البطيئة وأخطاء الخادم', value: `${s.performance.slow} بطيء، ${s.performance.errors} خطأ` },
        { label: 'النسخ الاحتياطي', value: backupLine },
        { label: 'الدخول', value: `${n('login_success')} ناجح، ${n('login_failed')} فاشل` },
        { label: 'طلبات مرفوضة', value: `${n('forbidden')} رفض صلاحية، ${n('unknown_route')} مسار غير موجود، ${n('rate_limited')} تجاوز حد` },
        { label: 'الحوادث', value: s.incidents.total ? `${s.incidents.total} (${sev})` : 'لا يوجد' },
        { label: 'الحظر المؤقت', value: `${s.blocks.created} عنوان جديد، ${s.blocks.active} نشط الآن، ${s.blocks.blockedRequests} طلب مُنع` },
        { label: 'تصدير البيانات والتغييرات الإدارية', value: `${n('export')} تصدير، ${n('admin_change')} تغيير` },
        ...(s.topIps.length ? [{ label: 'أكثر العناوين رفضًا', value: s.topIps.map((x) => `${x.ip} (${x.n})`).join('، '), ltr: true }] : []),
      ],
      recommendations: s.recommendations,
    };
  }

  static eventName(type: string) {
    return EVENT_AR[type] ?? type;
  }
}
