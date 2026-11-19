import { ConflictException, Injectable, Logger, NotFoundException, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { AuthUser } from '../auth/decorators';
import { PerfCollector } from './perf-collector.service';
import { EndpointPerf, OrgVolume, PERF_BUCKETS, PerfSnapshot, SLOW_MS, SnapshotTotals, VolumeRow } from './performance.entity';

/** تصنيف الجداول على الأنظمة حسب بادئة اسم الجدول (الأصول الثابتة تظهر مستقلة عن المالي لأهميتها) */
const TABLE_MODULES: [RegExp, string][] = [
  [/^acc_asset/, 'assets'],
  [/^acc_/, 'accounting'],
  [/^(beneficiar|dynamic_forms|workflow)/, 'beneficiaries'],
  [/^(project|activities|opportunity_amendments)/, 'projects'],
  [/^(fundraising|ledger)/, 'fundraising'],
  [/^hr_/, 'hr'],
  [/^risk_/, 'risk'],
  [/^gov_/, 'governance'],
  [/^vol_/, 'volunteers'],
  [/^quality_/, 'quality'],
  [/^audit_/, 'audit'],
  [/^mem_/, 'members'],
  [/^kn_/, 'knowledge'],
  [/^web_/, 'website'],
  [/^pt_/, 'partnerships'],
  [/^comms_/, 'comms'],
  [/^mtg_/, 'meetings'],
  [/^support_/, 'support'],
  [/^(subscription|platform_|contract_clauses|perf_)/, 'platform'],
];
const EXTRA_NAMES: Record<string, string> = { assets: 'الأصول الثابتة' };
export const moduleOfTable = (t: string) => TABLE_MODULES.find(([re]) => re.test(t))?.[1] ?? 'core';

/** فترة حساب أداء الشاشات في كل قياس: آخر 7 أيام */
const WINDOW_DAYS = 7;
const DAY_MS = 86_400_000;

/** تقدير الزمن الذي لا يتجاوزه 95% من الطلبات من الشرائح الزمنية */
function p95(buckets: number[], maxMs: number) {
  const total = buckets.reduce((s, n) => s + n, 0);
  if (!total) return 0;
  let acc = 0;
  for (let i = 0; i < buckets.length; i++) {
    acc += buckets[i];
    if (acc >= total * 0.95) return i < PERF_BUCKETS.length ? Math.min(PERF_BUCKETS[i], maxMs) : maxMs;
  }
  return maxMs;
}

@Injectable()
export class PerformanceService implements OnModuleInit {
  private readonly logger = new Logger('Performance');
  private running = false;

  constructor(
    private readonly db: DataSource,
    private readonly collector: PerfCollector,
    @InjectRepository(PerfSnapshot) private readonly snapshots: Repository<PerfSnapshot>,
  ) {}

  /** قياس يومي تلقائي: يُفحص كل ساعة، ويؤخذ قياس إذا مضى يوم على آخر قياس */
  onModuleInit() {
    if (process.env.PERF_SNAPSHOTS === 'off') return;
    const tick = () => void this.dailyIfDue().catch((e) => this.logger.warn(`تعذر أخذ القياس اليومي: ${(e as Error).message}`));
    setTimeout(tick, 5 * 60_000).unref();
    setInterval(tick, 60 * 60_000).unref();
  }

  private async dailyIfDue() {
    const last = await this.snapshots.findOne({ where: {}, order: { takenAt: 'DESC' }, select: { id: true, takenAt: true } });
    if (last && Date.now() - last.takenAt.getTime() < 23 * 3600_000) return;
    await this.take('daily', null, null);
  }

  /** أداء الشاشات من الجدول اليومي خلال فترة */
  private async endpointStats(from: Date): Promise<{ endpoints: EndpointPerf[]; totals: Pick<SnapshotTotals, 'avgMs' | 'p95Ms' | 'requests' | 'slowPercent'> }> {
    const rows: { method: string; route: string; count: string; total: string; max: number; slow: string; buckets: number[] }[] = await this.db.query(
      `SELECT method, route, SUM(count) AS count, SUM(total_ms) AS total, MAX(max_ms) AS max, SUM(slow_count) AS slow,
              ARRAY(SELECT SUM(b) FROM perf_endpoint_stats s2, unnest(s2.buckets) WITH ORDINALITY AS u(b, i)
                    WHERE s2.method = s.method AND s2.route = s.route AND s2.day >= $1 GROUP BY i ORDER BY i)::int[] AS buckets
       FROM perf_endpoint_stats s WHERE day >= $1 GROUP BY method, route`,
      [from.toISOString().slice(0, 10)],
    );
    const all = new Array(PERF_BUCKETS.length + 1).fill(0);
    let count = 0;
    let total = 0;
    let slow = 0;
    let max = 0;
    const endpoints = rows.map((r) => {
      const n = Number(r.count);
      count += n;
      total += Number(r.total);
      slow += Number(r.slow);
      max = Math.max(max, r.max);
      r.buckets.forEach((b, i) => (all[i] += b));
      return { method: r.method, route: r.route, count: n, avgMs: Math.round(Number(r.total) / Math.max(n, 1)), p95Ms: p95(r.buckets, r.max), maxMs: r.max, slow: Number(r.slow) };
    });
    endpoints.sort((a, b) => b.avgMs - a.avgMs);
    return {
      endpoints,
      totals: { avgMs: count ? Math.round(total / count) : 0, p95Ms: p95(all, max), requests: count, slowPercent: count ? Math.round((slow / count) * 1000) / 10 : 0 },
    };
  }

  /** أسماء الأنظمة كما تظهر للمستخدم */
  private async moduleNames() {
    const rows: { code: string; name: string }[] = await this.db.query(`SELECT code, name FROM erp_modules`);
    return { ...Object.fromEntries(rows.map((r) => [r.code, r.name])), ...EXTRA_NAMES } as Record<string, string>;
  }

  /** يأخذ قياسًا كاملًا: حجم كل جدول ونظام وجمعية، وأداء الشاشات خلال آخر 7 أيام */
  async take(kind: 'daily' | 'manual', label: string | null, user: AuthUser | null) {
    if (this.running) throw new ConflictException('يوجد قياس قيد التنفيذ الآن، انتظر قليلًا');
    this.running = true;
    const started = Date.now();
    try {
      await this.collector.flush();
      const names = await this.moduleNames();
      const tables: { name: string; bytes: string; has_org: boolean }[] = await this.db.query(
        `SELECT c.relname AS name, pg_total_relation_size(c.oid) AS bytes,
                EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = c.oid AND a.attname = 'organization_id' AND NOT a.attisdropped) AS has_org
         FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = current_schema() AND c.relkind = 'r' AND c.relname <> 'migrations'`,
      );
      // عدّ دقيق لكل جدول مقسومًا على الجمعيات (استعلام واحد)
      const parts = tables.map((t) =>
        t.has_org
          ? `SELECT '${t.name}' AS t, organization_id::text AS org, COUNT(*)::bigint AS n FROM "${t.name}" GROUP BY organization_id`
          : `SELECT '${t.name}' AS t, NULL AS org, COUNT(*)::bigint AS n FROM "${t.name}"`,
      );
      const counts: { t: string; org: string | null; n: string }[] = parts.length ? await this.db.query(parts.join(' UNION ALL ')) : [];

      const tableRows = new Map<string, number>();
      const orgMap = new Map<string, Record<string, number>>();
      for (const c of counts) {
        const n = Number(c.n);
        tableRows.set(c.t, (tableRows.get(c.t) ?? 0) + n);
        if (!c.org) continue;
        const m = orgMap.get(c.org) ?? {};
        const mod = moduleOfTable(c.t);
        m[mod] = (m[mod] ?? 0) + n;
        orgMap.set(c.org, m);
      }
      const tableList: VolumeRow[] = tables
        .map((t) => ({ code: t.name, name: names[moduleOfTable(t.name)] ?? moduleOfTable(t.name), rows: tableRows.get(t.name) ?? 0, bytes: Number(t.bytes) }))
        .sort((a, b) => b.rows - a.rows);
      const modMap = new Map<string, VolumeRow>();
      for (const t of tableList) {
        const code = moduleOfTable(t.code);
        const m = modMap.get(code) ?? { code, name: names[code] ?? code, rows: 0, bytes: 0 };
        m.rows += t.rows;
        m.bytes += t.bytes;
        modMap.set(code, m);
      }
      const orgInfo: { id: string; name: string; slug: string }[] = await this.db.query(`SELECT id::text, name, slug FROM organizations`);
      const orgs: OrgVolume[] = orgInfo
        .map((o) => {
          const modules = orgMap.get(o.id) ?? {};
          return { ...o, modules, rows: Object.values(modules).reduce((s, n) => s + n, 0) };
        })
        .sort((a, b) => b.rows - a.rows);

      const periodFrom = new Date(Date.now() - WINDOW_DAYS * DAY_MS);
      const perf = await this.endpointStats(periodFrom);
      const [{ size }] = await this.db.query(`SELECT pg_database_size(current_database()) AS size`);
      const hasBaseline = await this.snapshots.exists({ where: { isBaseline: true } });

      const snap = this.snapshots.create({
        kind,
        label,
        takenBy: user?.fullName ?? null,
        isBaseline: !hasBaseline,
        periodFrom,
        totals: {
          dbBytes: Number(size),
          rows: tableList.reduce((s, t) => s + t.rows, 0),
          organizations: orgInfo.length,
          users: tableRows.get('users') ?? 0,
          ...perf.totals,
        },
        modules: [...modMap.values()].sort((a, b) => b.rows - a.rows),
        tables: tableList,
        orgs,
        endpoints: perf.endpoints,
        durationMs: Date.now() - started,
      });
      const saved = await this.snapshots.save(snap);
      this.logger.log(`قياس ${kind}: ${snap.totals.rows} سجل، ${Math.round(snap.totals.dbBytes / 1048576)} م.ب، خلال ${snap.durationMs} م.ث`);
      return saved;
    } finally {
      this.running = false;
    }
  }

  /** الشاشة الرئيسية: آخر قياس وخط الأساس وتاريخ القياسات وأداء الشاشات الحي */
  async overview() {
    const history = await this.snapshots.find({
      select: { id: true, takenAt: true, kind: true, label: true, isBaseline: true, takenBy: true, totals: true, durationMs: true },
      order: { takenAt: 'DESC' },
      take: 120,
    });
    const latest = history[0] ? await this.snapshots.findOneBy({ id: history[0].id }) : null;
    const baseline = await this.snapshots.findOne({ where: { isBaseline: true } });
    const live = await this.endpointStats(new Date(Date.now() - DAY_MS));
    return { latest, baseline, history, live, windowDays: WINDOW_DAYS, slowMs: SLOW_MS };
  }

  async get(id: string) {
    const s = await this.snapshots.findOneBy({ id });
    if (!s) throw new NotFoundException('القياس غير موجود');
    return s;
  }

  /** تغيير خط الأساس بقرار صريح من مدير المنصة فقط */
  async setBaseline(id: string) {
    await this.get(id);
    await this.db.transaction(async (em) => {
      await em.update(PerfSnapshot, { isBaseline: true }, { isBaseline: false });
      await em.update(PerfSnapshot, { id }, { isBaseline: true });
    });
    return this.overview();
  }
}
