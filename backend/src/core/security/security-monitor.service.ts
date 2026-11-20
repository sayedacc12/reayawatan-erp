import { Injectable, Logger, OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import { isIP } from 'net';
import { DataSource } from 'typeorm';
import { SecSeverity } from './security.entity';
import { DEFAULT_SECURITY_SETTINGS, isPrivateIp, normIp, SecuritySettings, securitySettings } from './security-settings';

export interface SecEventInput {
  type: string;
  severity?: SecSeverity;
  ip?: string | null;
  userId?: string | null;
  orgId?: string | null;
  actor?: string | null;
  method?: string | null;
  route?: string | null;
  status?: number | null;
  detail?: Record<string, unknown> | null;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const uuidOrNull = (v: unknown) => (typeof v === 'string' && UUID_RE.test(v) ? v : null);
const cut = (v: unknown, n: number) => (typeof v === 'string' && v ? v.slice(0, n) : null);

/** حد أعلى للأحداث المنتظرة في الذاكرة: عند هجوم كثيف لا تنمو الذاكرة بلا حد (تُحسب الزيادة فقط) */
const MAX_PENDING = 5000;
const FLUSH_MS = 5_000;
const BLOCKS_REFRESH_MS = 30_000;
const SETTINGS_TTL_MS = 60_000;

/**
 * مسجّل أحداث المراقب الأمني: يجمع الأحداث في الذاكرة ويكتبها دفعة واحدة كل بضع ثوانٍ،
 * فلا يبطئ أي طلب ولا يرمي خطأ أبدًا. ويحتفظ بقائمة العناوين المحظورة مؤقتًا في الذاكرة.
 */
@Injectable()
export class SecurityMonitor implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger('Security');
  private pending: SecEventInput[] = [];
  private dropped = 0;
  private timer?: NodeJS.Timeout;
  private blocksTimer?: NodeJS.Timeout;
  /** العنوان ← موعد انتهاء الحظر */
  private blocked = new Map<string, number>();
  private blockedHits = new Map<string, number>();
  private cached: { at: number; value: SecuritySettings } | null = null;

  constructor(private readonly db: DataSource) {}

  onModuleInit() {
    void this.refreshBlocks();
    if (process.env.JEST_WORKER_ID) return;
    this.timer = setInterval(() => void this.flush(), FLUSH_MS);
    this.timer.unref();
    this.blocksTimer = setInterval(() => void this.refreshBlocks(), BLOCKS_REFRESH_MS);
    this.blocksTimer.unref();
  }

  async onApplicationShutdown() {
    clearInterval(this.timer);
    clearInterval(this.blocksTimer);
    await this.flush();
  }

  /** الإعدادات مع ذاكرة قصيرة (دقيقة) حتى لا يُقرأ الجدول في كل طلب */
  async settings(fresh = false): Promise<SecuritySettings> {
    if (!fresh && this.cached && Date.now() - this.cached.at < SETTINGS_TTL_MS) return this.cached.value;
    try {
      const value = await securitySettings(this.db);
      this.cached = { at: Date.now(), value };
      return value;
    } catch {
      return this.cached?.value ?? DEFAULT_SECURITY_SETTINGS;
    }
  }

  invalidateSettings() {
    this.cached = null;
  }

  /** يسجل حدثًا (لا ينتظر ولا يرمي) */
  record(e: SecEventInput) {
    if (this.cached && !this.cached.value.enabled) return;
    if (this.pending.length >= MAX_PENDING) {
      this.dropped++;
      return;
    }
    this.pending.push(e);
  }

  async flush() {
    await this.settings();
    const blockedHits = this.blockedHits;
    this.blockedHits = new Map();
    if (blockedHits.size) {
      for (const [ip, n] of blockedHits) {
        await this.db
          .query(`UPDATE sec_blocks SET blocked_requests = blocked_requests + $2 WHERE ip = $1 AND lifted_at IS NULL AND expires_at > now()`, [ip, n])
          .catch(() => undefined);
      }
    }
    if (this.dropped) {
      this.pending.push({ type: 'events_dropped', severity: 'medium', detail: { count: this.dropped } });
      this.dropped = 0;
    }
    if (!this.pending.length) return;
    const batch = this.pending;
    this.pending = [];
    const now = new Date();
    const values: unknown[] = [];
    const rows: string[] = [];
    for (const e of batch) {
      const p = values.length;
      values.push(
        now, cut(e.type, 40), e.severity ?? 'info', normIp(e.ip), uuidOrNull(e.userId), uuidOrNull(e.orgId),
        cut(e.actor, 160), cut(e.method, 10), cut(e.route, 200), Number.isInteger(e.status) ? e.status : null,
        e.detail ? JSON.stringify(e.detail) : null,
      );
      rows.push(`(${Array.from({ length: 11 }, (_, i) => `$${p + i + 1}`).join(',')})`);
    }
    try {
      await this.db.query(
        `INSERT INTO sec_events (at, type, severity, ip, user_id, org_id, actor, method, route, status, detail) VALUES ${rows.join(',')}`,
        values,
      );
    } catch (e) {
      this.logger.warn(`تعذر حفظ الأحداث الأمنية: ${(e as Error).message}`);
    }
  }

  // ---------- الحظر المؤقت ----------

  /** هل العنوان محظور الآن؟ (من الذاكرة، بلا استعلام) */
  isBlocked(ip: string | null | undefined) {
    const v = normIp(ip);
    if (!v) return false;
    const until = this.blocked.get(v);
    if (!until) return false;
    if (until <= Date.now()) {
      this.blocked.delete(v);
      return false;
    }
    this.blockedHits.set(v, (this.blockedHits.get(v) ?? 0) + 1);
    return true;
  }

  /** يحدّث الذاكرة فورًا بعد حظر أو رفع حظر في هذه النسخة من الخادم */
  markBlocked(ip: string, until: Date) {
    const v = normIp(ip);
    if (v) this.blocked.set(v, Math.max(this.blocked.get(v) ?? 0, until.getTime()));
  }

  async refreshBlocks() {
    try {
      const rows: { ip: string; until: Date }[] = await this.db.query(
        `SELECT ip, MAX(expires_at) AS until FROM sec_blocks WHERE lifted_at IS NULL AND expires_at > now() GROUP BY ip`,
      );
      this.blocked = new Map(rows.map((r) => [r.ip, new Date(r.until).getTime()]));
    } catch {
      // الجدول غير موجود قبل تشغيل الترحيل: لا حظر
    }
  }

  /** عنوان لا يجوز حظره: شبكة خاصة أو عنوان موثوق من الإعدادات أو صيغة غير صحيحة */
  async protectedIp(ip: string | null | undefined) {
    const v = normIp(ip);
    if (!v || !isIP(v) || isPrivateIp(v)) return true;
    const s = await this.settings();
    return s.trustedIps.map((t) => normIp(t.trim())).includes(v);
  }
}
