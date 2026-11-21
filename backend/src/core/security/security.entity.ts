import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/**
 * سجل المراقب الأمني «سيد». سجل المنصة وليس بيانات جمعية، لذلك عمود الجمعية اسمه org_id
 * (لا organization_id) فلا يدخل في تصدير بيانات الجمعية أو حذفها، ويُحذف تلقائيًا بعد مدة الاحتفاظ.
 */
export type SecSeverity = 'info' | 'low' | 'medium' | 'high' | 'critical';

@Entity('sec_events')
@Index('IDX_sec_events_at', ['at'])
@Index('IDX_sec_events_type_at', ['type', 'at'])
@Index('IDX_sec_events_ip_at', ['ip', 'at'])
@Index('IDX_sec_events_user_at', ['userId', 'at'])
export class SecEvent {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'timestamptz' })
  at!: Date;

  @Column({ length: 40 })
  type!: string;

  @Column({ length: 10, default: 'info' })
  severity!: SecSeverity;

  @Column({ type: 'varchar', length: 64, nullable: true })
  ip!: string | null;

  @Column({ name: 'user_id', type: 'uuid', nullable: true })
  userId!: string | null;

  @Column({ name: 'org_id', type: 'uuid', nullable: true })
  orgId!: string | null;

  /** اسم الدخول المستخدم في المحاولة أو اسم المستخدم (لا كلمات مرور أبدًا) */
  @Column({ type: 'varchar', length: 160, nullable: true })
  actor!: string | null;

  @Column({ type: 'varchar', length: 10, nullable: true })
  method!: string | null;

  @Column({ type: 'varchar', length: 200, nullable: true })
  route!: string | null;

  @Column({ type: 'int', nullable: true })
  status!: number | null;

  @Column({ type: 'jsonb', nullable: true })
  detail!: Record<string, unknown> | null;
}

export type IncidentStatus = 'open' | 'acknowledged' | 'resolved';
export interface IncidentAction { at: string; kind: string; text: string; by: string; ref?: string | null }

@Entity('sec_incidents')
@Index('IDX_sec_incidents_status', ['status', 'lastSeenAt'])
@Index('IDX_sec_incidents_key', ['dedupeKey', 'lastSeenAt'])
export class SecIncident {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ length: 40 })
  rule!: string;

  @Column({ length: 10 })
  severity!: SecSeverity;

  @Column({ length: 200 })
  title!: string;

  @Column({ length: 2000 })
  summary!: string;

  @Column({ name: 'dedupe_key', length: 200 })
  dedupeKey!: string;

  @Column({ type: 'varchar', length: 64, nullable: true })
  ip!: string | null;

  @Column({ name: 'user_id', type: 'uuid', nullable: true })
  userId!: string | null;

  @Column({ name: 'org_id', type: 'uuid', nullable: true })
  orgId!: string | null;

  @Column({ type: 'int', default: 1 })
  hits!: number;

  @Column({ length: 14, default: 'open' })
  status!: IncidentStatus;

  @Column({ type: 'jsonb', default: () => "'[]'" })
  actions!: IncidentAction[];

  /** إجراء ينتظر موافقة الإدارة (مثل إيقاف حساب) */
  @Column({ name: 'pending_action', type: 'varchar', length: 30, nullable: true })
  pendingAction!: 'suspend_user' | null;

  @Column({ name: 'alerted_at', type: 'timestamptz', nullable: true })
  alertedAt!: Date | null;

  @CreateDateColumn({ name: 'first_seen_at', type: 'timestamptz' })
  firstSeenAt!: Date;

  @Column({ name: 'last_seen_at', type: 'timestamptz' })
  lastSeenAt!: Date;

  @Column({ name: 'closed_by', type: 'varchar', length: 200, nullable: true })
  closedBy!: string | null;
}

@Entity('sec_blocks')
@Index('IDX_sec_blocks_active', ['ip', 'expiresAt'])
export class SecBlock {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ length: 64 })
  ip!: string;

  @Column({ length: 300 })
  reason!: string;

  @Column({ name: 'incident_id', type: 'uuid', nullable: true })
  incidentId!: string | null;

  /** «سيد» للحظر التلقائي، أو اسم المدير للحظر اليدوي */
  @Column({ name: 'created_by', length: 200 })
  createdBy!: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @Column({ name: 'expires_at', type: 'timestamptz' })
  expiresAt!: Date;

  @Column({ name: 'lifted_at', type: 'timestamptz', nullable: true })
  liftedAt!: Date | null;

  @Column({ name: 'lifted_by', type: 'varchar', length: 200, nullable: true })
  liftedBy!: string | null;

  @Column({ name: 'blocked_requests', type: 'int', default: 0 })
  blockedRequests!: number;
}

@Entity('sec_reports')
export class SecReport {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /** يوم التقرير بتوقيت الرياض، تقرير واحد لكل يوم */
  @Index('UQ_sec_reports_day', { unique: true })
  @Column({ type: 'date' })
  day!: string;

  @Column({ type: 'jsonb' })
  summary!: Record<string, unknown>;

  @Column({ type: 'jsonb', default: () => "'[]'" })
  recipients!: string[];

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}

export const SECURITY_ENTITIES = [SecEvent, SecIncident, SecBlock, SecReport];
