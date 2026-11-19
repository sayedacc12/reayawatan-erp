import { Injectable, Logger, OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { PERF_BUCKETS, SLOW_MS } from './performance.entity';

interface Agg {
  count: number;
  totalMs: number;
  maxMs: number;
  slow: number;
  buckets: number[];
}

/** مسارات لا تمثل شاشات يستخدمها الموظفون، فلا تدخل في الإحصاء */
const IGNORED = [/^\/api\/health/, /^\/api\/hr\/iclock/, /^\/api\/platform\/performance/];

/**
 * يجمع أزمنة الطلبات في الذاكرة ويضيفها لجدول perf_endpoint_stats كل دقيقة بإضافة تراكمية،
 * فيعمل بشكل صحيح حتى مع أكثر من نسخة من الخادم.
 */
@Injectable()
export class PerfCollector implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger('Performance');
  private pending = new Map<string, Agg>();
  private timer?: NodeJS.Timeout;

  constructor(private readonly db: DataSource) {}

  onModuleInit() {
    this.timer = setInterval(() => void this.flush(), 60_000);
    this.timer.unref();
  }

  async onApplicationShutdown() {
    clearInterval(this.timer);
    await this.flush();
  }

  record(method: string, route: string, ms: number) {
    if (IGNORED.some((r) => r.test(route))) return;
    const key = `${method} ${route}`;
    let a = this.pending.get(key);
    if (!a) {
      a = { count: 0, totalMs: 0, maxMs: 0, slow: 0, buckets: new Array(PERF_BUCKETS.length + 1).fill(0) };
      this.pending.set(key, a);
    }
    a.count++;
    a.totalMs += ms;
    a.maxMs = Math.max(a.maxMs, ms);
    if (ms > SLOW_MS) a.slow++;
    const i = PERF_BUCKETS.findIndex((b) => ms <= b);
    a.buckets[i === -1 ? PERF_BUCKETS.length : i]++;
  }

  /** يكتب ما تجمّع في الذاكرة (يُستدعى أيضًا قبل أخذ قياس حتى يشمل آخر الطلبات) */
  async flush() {
    if (!this.pending.size) return;
    const batch = this.pending;
    this.pending = new Map();
    const day = new Date().toISOString().slice(0, 10);
    const values: unknown[] = [];
    const rows: string[] = [];
    for (const [key, a] of batch) {
      const sp = key.indexOf(' ');
      const p = values.length;
      values.push(day, key.slice(0, sp), key.slice(sp + 1, sp + 301), a.count, Math.round(a.totalMs), Math.round(a.maxMs), a.slow, a.buckets);
      rows.push(`($${p + 1}::date,$${p + 2},$${p + 3},$${p + 4},$${p + 5},$${p + 6},$${p + 7},$${p + 8}::int[])`);
    }
    try {
      await this.db.query(
        `INSERT INTO perf_endpoint_stats (day, method, route, count, total_ms, max_ms, slow_count, buckets) VALUES ${rows.join(',')}
         ON CONFLICT (day, method, route) DO UPDATE SET
           count = perf_endpoint_stats.count + EXCLUDED.count,
           total_ms = perf_endpoint_stats.total_ms + EXCLUDED.total_ms,
           max_ms = GREATEST(perf_endpoint_stats.max_ms, EXCLUDED.max_ms),
           slow_count = perf_endpoint_stats.slow_count + EXCLUDED.slow_count,
           buckets = ARRAY(SELECT a + b FROM unnest(perf_endpoint_stats.buckets, EXCLUDED.buckets) WITH ORDINALITY AS t(a, b, i) ORDER BY i)`,
        values,
      );
    } catch (e) {
      this.logger.warn(`تعذر حفظ إحصاءات الأداء: ${(e as Error).message}`);
    }
  }
}
