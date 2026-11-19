import { Column, CreateDateColumn, Entity, Index, PrimaryColumn, PrimaryGeneratedColumn } from 'typeorm';

/** حجم بيانات نظام واحد (أو جدول) في لحظة القياس */
export interface VolumeRow {
  code: string;
  name: string;
  rows: number;
  bytes: number;
}

/** حجم بيانات جمعية واحدة: إجمالي السجلات وتوزيعها على الأنظمة */
export interface OrgVolume {
  id: string;
  name: string;
  slug: string;
  rows: number;
  modules: Record<string, number>;
}

/** أداء شاشة (طلب API) خلال فترة: عدد الطلبات ومتوسط الزمن وتقدير 95% منها وأقصى زمن */
export interface EndpointPerf {
  method: string;
  route: string;
  count: number;
  avgMs: number;
  p95Ms: number;
  maxMs: number;
  slow: number;
}

export interface SnapshotTotals {
  dbBytes: number;
  rows: number;
  organizations: number;
  users: number;
  /** متوسط زمن الاستجابة لكل الطلبات في فترة القياس (مللي ثانية) */
  avgMs: number;
  p95Ms: number;
  requests: number;
  /** نسبة الطلبات التي تجاوزت ثانية واحدة */
  slowPercent: number;
}

/**
 * قياس دوري لحجم البيانات والأداء. أول قياس يُعلَّم خط أساس رسميًا تُقارن به كل القياسات اللاحقة،
 * ولا يتغير خط الأساس إلا بقرار صريح من مدير المنصة.
 */
@Entity('perf_snapshots')
@Index('IDX_perf_snapshots_taken', ['takenAt'])
export class PerfSnapshot {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @CreateDateColumn({ name: 'taken_at', type: 'timestamptz' })
  takenAt!: Date;

  /** daily: تلقائي يومي، manual: بطلب مدير المنصة */
  @Column({ length: 10 })
  kind!: 'daily' | 'manual';

  @Column({ type: 'varchar', length: 200, nullable: true })
  label!: string | null;

  @Column({ name: 'is_baseline', default: false })
  isBaseline!: boolean;

  @Column({ name: 'taken_by', type: 'varchar', length: 200, nullable: true })
  takenBy!: string | null;

  /** بداية الفترة التي حُسب منها أداء الشاشات */
  @Column({ name: 'period_from', type: 'timestamptz' })
  periodFrom!: Date;

  @Column({ type: 'jsonb' })
  totals!: SnapshotTotals;

  @Column({ type: 'jsonb' })
  modules!: VolumeRow[];

  @Column({ type: 'jsonb' })
  tables!: VolumeRow[];

  @Column({ type: 'jsonb' })
  orgs!: OrgVolume[];

  @Column({ type: 'jsonb' })
  endpoints!: EndpointPerf[];

  @Column({ name: 'duration_ms', type: 'int', default: 0 })
  durationMs!: number;
}

/**
 * أزمنة الاستجابة الفعلية لكل شاشة مجمّعة باليوم. تُجمع في الذاكرة وتُضاف للجدول كل دقيقة،
 * فلا يتأثر زمن الطلب نفسه. buckets: عدد الطلبات في كل شريحة زمنية من PERF_BUCKETS.
 */
@Entity('perf_endpoint_stats')
export class PerfEndpointStat {
  @PrimaryColumn({ type: 'date' })
  day!: string;

  @PrimaryColumn({ length: 8 })
  method!: string;

  @PrimaryColumn({ length: 300 })
  route!: string;

  @Column({ type: 'int', default: 0 })
  count!: number;

  @Column({ name: 'total_ms', type: 'bigint', default: 0 })
  totalMs!: string;

  @Column({ name: 'max_ms', type: 'int', default: 0 })
  maxMs!: number;

  @Column({ name: 'slow_count', type: 'int', default: 0 })
  slowCount!: number;

  @Column({ type: 'int', array: true })
  buckets!: number[];
}

/** حدود الشرائح الزمنية بالمللي ثانية (الشريحة الأخيرة لما فوق 5 ثوانٍ) */
export const PERF_BUCKETS = [50, 100, 200, 300, 500, 1000, 2000, 5000];
export const SLOW_MS = 1000;
