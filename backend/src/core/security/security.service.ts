import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { isIP } from 'net';
import { DataSource } from 'typeorm';
import { AuthUser } from '../auth/decorators';
import { PlatformSetting } from '../subscriptions/entities';
import { EMAIL_RE } from '../mail/mail-settings';
import { IncidentAction, SecBlock, SecIncident } from './security.entity';
import { RULES, SecurityDetector } from './security-detector.service';
import { SecurityMonitor } from './security-monitor.service';
import { RETENTION_DAYS, SecurityReports } from './security-report.service';
import { isPrivateIp, normIp, SecuritySettings } from './security-settings';

const PAGE = 50;
const by = (u: AuthUser) => `${u.fullName} (${u.email})`.slice(0, 200);

/** عمليات شاشة المراقب الأمني لمدير المنصة. كل إجراء يُسجل في الحادثة ويمكن التراجع عنه */
@Injectable()
export class SecurityService {
  constructor(
    private readonly db: DataSource,
    private readonly monitor: SecurityMonitor,
    private readonly detector: SecurityDetector,
    private readonly reports: SecurityReports,
  ) {}

  async overview() {
    await this.monitor.flush();
    const q = <T>(sql: string, p: unknown[] = []) => this.db.query(sql, p) as Promise<T[]>;
    const counts = Object.fromEntries(
      (await q<{ type: string; n: number }>(`SELECT type, COUNT(*)::int AS n FROM sec_events WHERE at > now() - interval '24 hours' GROUP BY type`))
        .map((r) => [r.type, r.n]),
    );
    const [inc] = await q<{ open: number; pending: number; serious: number }>(
      `SELECT COUNT(*)::int AS open, COUNT(*) FILTER (WHERE pending_action IS NOT NULL)::int AS pending,
              COUNT(*) FILTER (WHERE severity IN ('high', 'critical'))::int AS serious
       FROM sec_incidents WHERE status <> 'resolved'`);
    const [blocks] = await q<{ active: number }>(`SELECT COUNT(*)::int AS active FROM sec_blocks WHERE lifted_at IS NULL AND expires_at > now()`);
    const [last] = await q<{ day: string; created_at: Date; status: string }>(
      `SELECT day::text, created_at, summary->>'status' AS status FROM sec_reports ORDER BY day DESC LIMIT 1`);
    const settings = await this.monitor.settings(true);
    return {
      status: inc.serious || inc.pending ? 'attention' : inc.open ? 'watch' : 'ok',
      counts, openIncidents: inc.open, pendingApprovals: inc.pending, activeBlocks: blocks.active,
      lastReport: last ? { day: last.day, at: last.created_at, status: last.status } : null,
      settings, recipients: await this.detector.recipients(settings), rules: RULES, retentionDays: RETENTION_DAYS,
    };
  }

  async incidents(q: { status?: string; page?: number }) {
    const page = Math.max(1, Number(q.page) || 1);
    const qb = this.db.getRepository(SecIncident).createQueryBuilder('i').orderBy('i.lastSeenAt', 'DESC').skip((page - 1) * PAGE).take(PAGE);
    if (q.status === 'active') qb.where('i.status <> :r', { r: 'resolved' });
    else if (q.status && ['open', 'acknowledged', 'resolved'].includes(q.status)) qb.where('i.status = :s', { s: q.status });
    const [rows, total] = await qb.getManyAndCount();
    const ids = [...new Set(rows.map((r) => r.userId).filter((x): x is string => !!x))];
    const users: { id: string; name: string; email: string; active: boolean; org: string | null }[] = ids.length
      ? await this.db.query(
        `SELECT u.id, u.full_name AS name, u.email, u.is_active AS active, o.name AS org FROM users u
         LEFT JOIN organizations o ON o.id = u.organization_id WHERE u.id = ANY($1::uuid[])`, [ids])
      : [];
    const map = new Map(users.map((u) => [u.id, u]));
    return { total, page, pageSize: PAGE, rows: rows.map((r) => ({ ...r, user: r.userId ? map.get(r.userId) ?? null : null })) };
  }

  private async incident(id: string) {
    const inc = await this.db.getRepository(SecIncident).findOneBy({ id });
    if (!inc) throw new NotFoundException('الحادثة غير موجودة');
    return inc;
  }

  private async act(inc: SecIncident, user: AuthUser, kind: string, text: string) {
    const a: IncidentAction = { at: new Date().toISOString(), kind, text, by: by(user) };
    inc.actions = [...(inc.actions ?? []), a];
    await this.db.getRepository(SecIncident).save(inc);
    this.monitor.record({ type: 'admin_security', severity: 'low', userId: user.id, actor: user.email, detail: { incident: inc.id, action: kind } });
    return inc;
  }

  async acknowledge(id: string, user: AuthUser) {
    const inc = await this.incident(id);
    if (inc.status !== 'open') throw new BadRequestException('الحادثة ليست مفتوحة');
    inc.status = 'acknowledged';
    return this.act(inc, user, 'ack', 'اطّلع على الحادثة');
  }

  async resolve(id: string, user: AuthUser, note?: string) {
    const inc = await this.incident(id);
    if (inc.status === 'resolved') throw new BadRequestException('الحادثة مغلقة من قبل');
    inc.status = 'resolved';
    inc.closedBy = by(user);
    if (inc.pendingAction) inc.pendingAction = null;
    return this.act(inc, user, 'resolve', note?.trim() ? `أغلق الحادثة: ${note.trim().slice(0, 300)}` : 'أغلق الحادثة');
  }

  /** موافقة الإدارة على إيقاف الحساب المشتبه به (لا يحدث تلقائيًا أبدًا) */
  async approveSuspend(id: string, user: AuthUser) {
    const inc = await this.incident(id);
    if (inc.pendingAction !== 'suspend_user' || !inc.userId) throw new BadRequestException('لا يوجد إجراء ينتظر الموافقة');
    const [u] = await this.db.query(`SELECT is_platform_admin AS pa FROM users WHERE id = $1`, [inc.userId]);
    if (!u) throw new NotFoundException('الحساب غير موجود');
    if (u.pa) throw new BadRequestException('لا يمكن إيقاف حساب مدير المنصة من هنا');
    await this.db.query(`UPDATE users SET is_active = false, sessions_valid_after = now() WHERE id = $1`, [inc.userId]);
    inc.pendingAction = null;
    return this.act(inc, user, 'suspend', 'أوقف الحساب المشتبه به بموافقة الإدارة');
  }

  async dismissSuspend(id: string, user: AuthUser) {
    const inc = await this.incident(id);
    if (inc.pendingAction !== 'suspend_user') throw new BadRequestException('لا يوجد إجراء ينتظر الموافقة');
    inc.pendingAction = null;
    return this.act(inc, user, 'dismiss', 'رفض إيقاف الحساب');
  }

  /** التراجع عن إيقاف حساب أُوقف من هذه الشاشة */
  async reactivate(id: string, user: AuthUser) {
    const inc = await this.incident(id);
    if (!inc.userId || !(inc.actions ?? []).some((a) => a.kind === 'suspend')) throw new BadRequestException('لم يُوقف حساب من هذه الحادثة');
    await this.db.query(`UPDATE users SET is_active = true WHERE id = $1`, [inc.userId]);
    return this.act(inc, user, 'reactivate', 'أعاد تفعيل الحساب');
  }

  async blocks(q: { active?: string; page?: number }) {
    const page = Math.max(1, Number(q.page) || 1);
    const qb = this.db.getRepository(SecBlock).createQueryBuilder('b').orderBy('b.createdAt', 'DESC').skip((page - 1) * PAGE).take(PAGE);
    if (q.active === '1' || q.active === 'true') qb.where('b.liftedAt IS NULL AND b.expiresAt > now()');
    const [rows, total] = await qb.getManyAndCount();
    return { total, page, pageSize: PAGE, rows };
  }

  async addBlock(dto: { ip: string; minutes: number; reason: string }, user: AuthUser) {
    const ip = normIp(dto.ip.trim());
    if (!ip || !isIP(ip)) throw new BadRequestException('العنوان غير صحيح');
    if (isPrivateIp(ip)) throw new BadRequestException('لا يمكن حظر عنوان داخلي');
    const s = await this.monitor.settings(true);
    if (s.trustedIps.map((t) => normIp(t.trim())).includes(ip)) throw new BadRequestException('هذا العنوان ضمن العناوين الموثوقة في الإعدادات');
    return this.detector.block(ip, dto.minutes, dto.reason.trim(), null, by(user));
  }

  async liftBlock(id: string, user: AuthUser) {
    const repo = this.db.getRepository(SecBlock);
    const b = await repo.findOneBy({ id });
    if (!b) throw new NotFoundException('الحظر غير موجود');
    if (b.liftedAt || b.expiresAt.getTime() <= Date.now()) throw new BadRequestException('الحظر منتهٍ من قبل');
    b.liftedAt = new Date();
    b.liftedBy = by(user);
    await repo.save(b);
    await this.monitor.refreshBlocks();
    this.monitor.record({ type: 'ip_unblocked', severity: 'low', ip: b.ip, userId: user.id, actor: user.email });
    return b;
  }

  async events(q: { type?: string; ip?: string; page?: number }) {
    await this.monitor.flush();
    const page = Math.max(1, Number(q.page) || 1);
    const type = q.type ? q.type.slice(0, 40) : null;
    const ip = q.ip ? normIp(q.ip.trim()) : null;
    const [{ n }] = await this.db.query(`SELECT COUNT(*)::int AS n FROM sec_events WHERE ($1::text IS NULL OR type = $1) AND ($2::text IS NULL OR ip = $2)`, [type, ip]);
    const rows = await this.db.query(
      `SELECT id, at, type, severity, ip, user_id AS "userId", org_id AS "orgId", actor, method, route, status, detail
       FROM sec_events WHERE ($1::text IS NULL OR type = $1) AND ($2::text IS NULL OR ip = $2) ORDER BY at DESC LIMIT $3 OFFSET $4`, [type, ip, PAGE, (page - 1) * PAGE]);
    return { total: n, page, pageSize: PAGE, rows };
  }

  async updateSettings(dto: SecuritySettings) {
    const current = await this.monitor.settings(true);
    const emails = [...new Set((dto.recipients ?? []).map((e) => e.trim().toLowerCase()).filter(Boolean))];
    const bad = emails.find((e) => !EMAIL_RE.test(e));
    if (bad) throw new BadRequestException(`البريد غير صحيح: ${bad}`);
    const ips = [...new Set((dto.trustedIps ?? []).map((i) => normIp(i.trim())).filter((i): i is string => !!i))];
    const badIp = ips.find((i) => !isIP(i));
    if (badIp) throw new BadRequestException(`العنوان غير صحيح: ${badIp}`);
    const value: SecuritySettings = {
      ...current, ...dto, recipients: emails, trustedIps: ips, thresholds: { ...current.thresholds, ...(dto.thresholds ?? {}) },
    };
    await this.db.getRepository(PlatformSetting).save({ key: 'security', value: value as unknown as Record<string, unknown> });
    this.monitor.invalidateSettings();
    return this.monitor.settings(true);
  }

  reportsList() {
    return this.db.query(`SELECT id, day::text, summary, recipients, created_at AS "createdAt" FROM sec_reports ORDER BY day DESC LIMIT 30`);
  }

  sendReport() {
    return this.reports.send(undefined, new Date(), true);
  }
}
