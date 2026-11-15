import { Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';
import { Organization } from '../entities/organization.entity';
import { Category, Priority, TicketStatus } from './sla';

export interface TicketEvent {
  step: 'created' | 'status' | 'priority' | 'assigned' | 'escalated' | 'reopened' | 'closed' | 'rated';
  by: string;
  at: string;
  note?: string;
}

/**
 * طلب صيانة أو دعم فني من جمعية إلى إدارة المنصة.
 * المهل: response_due_at (أول رد من المنصة) و resolution_due_at (الحل)، وتتأجل بمدة انتظار رد الجمعية.
 */
@Entity('support_tickets')
@Index(['organizationId', 'createdAt'])
export class SupportTicket {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /** رقم الطلب مثل SR-2026-0001 */
  @Index({ unique: true })
  @Column({ length: 32 })
  number!: string;

  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId!: string;

  @ManyToOne(() => Organization, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'organization_id' })
  organization!: Organization;

  @Column({ length: 200 })
  subject!: string;

  @Column({ type: 'varchar', length: 24 })
  category!: Category;

  /** المستوى الذي اختارته الجمعية، ويمكن لمدير المنصة إعادة تصنيفه */
  @Column({ type: 'varchar', length: 24 })
  priority!: Priority;

  @Column({ name: 'requested_priority', type: 'varchar', length: 24 })
  requestedPriority!: Priority;

  @Index()
  @Column({ type: 'varchar', length: 24, default: 'new' })
  status!: TicketStatus;

  /** الشاشة أو الوحدة المتأثرة (اختياري) */
  @Column({ name: 'screen', type: 'varchar', length: 200, nullable: true })
  screen!: string | null;

  @Column({ name: 'created_by_id', type: 'uuid', nullable: true })
  createdById!: string | null;

  @Column({ name: 'created_by_name', length: 200 })
  createdByName!: string;

  @Column({ name: 'contact_phone', type: 'varchar', length: 30, nullable: true })
  contactPhone!: string | null;

  @Column({ name: 'assignee_id', type: 'uuid', nullable: true })
  assigneeId!: string | null;

  @Column({ name: 'assignee_name', type: 'varchar', length: 200, nullable: true })
  assigneeName!: string | null;

  @Column({ name: 'assigned_at', type: 'timestamptz', nullable: true })
  assignedAt!: Date | null;

  @Column({ name: 'response_due_at', type: 'timestamptz' })
  responseDueAt!: Date;

  @Column({ name: 'resolution_due_at', type: 'timestamptz' })
  resolutionDueAt!: Date;

  @Column({ name: 'first_response_at', type: 'timestamptz', nullable: true })
  firstResponseAt!: Date | null;

  /** من قدّم أول رد (لتقييم الأداء) */
  @Column({ name: 'first_response_by_id', type: 'uuid', nullable: true })
  firstResponseById!: string | null;

  /** من أنهى الطلب بالحل (لتقييم الأداء) */
  @Column({ name: 'resolved_by_id', type: 'uuid', nullable: true })
  resolvedById!: string | null;

  /** بداية انتظار رد الجمعية (تتوقف المهل) */
  @Column({ name: 'waiting_since', type: 'timestamptz', nullable: true })
  waitingSince!: Date | null;

  @Column({ name: 'resolved_at', type: 'timestamptz', nullable: true })
  resolvedAt!: Date | null;

  @Column({ name: 'closed_at', type: 'timestamptz', nullable: true })
  closedAt!: Date | null;

  @Column({ name: 'escalated_at', type: 'timestamptz', nullable: true })
  escalatedAt!: Date | null;

  /** تقييم الجمعية للخدمة عند الإغلاق (1 إلى 5) */
  @Column({ type: 'smallint', nullable: true })
  rating!: number | null;

  @Column({ type: 'jsonb', default: () => "'[]'" })
  history!: TicketEvent[];

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}

/** رسالة في محادثة الطلب، مع مرفق اختياري. الملاحظة الداخلية لا تظهر للجمعية */
@Entity('support_messages')
@Index(['ticketId', 'createdAt'])
export class SupportMessage {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'ticket_id', type: 'uuid' })
  ticketId!: string;

  @ManyToOne(() => SupportTicket, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'ticket_id' })
  ticket!: SupportTicket;

  /** org: من الجمعية، platform: من فريق المنصة */
  @Column({ type: 'varchar', length: 16 })
  side!: 'org' | 'platform';

  @Column({ name: 'author_name', length: 200 })
  authorName!: string;

  @Column({ type: 'text' })
  body!: string;

  @Column({ name: 'is_internal', default: false })
  isInternal!: boolean;

  @Column({ name: 'file_key', type: 'varchar', length: 200, nullable: true, select: false })
  fileKey!: string | null;

  @Column({ name: 'file_name', type: 'varchar', length: 200, nullable: true })
  fileName!: string | null;

  @Column({ name: 'file_mime', type: 'varchar', length: 64, nullable: true })
  fileMime!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}

export type TaskStatus = 'todo' | 'in_progress' | 'done' | 'cancelled';
export const TASK_STATUSES: TaskStatus[] = ['todo', 'in_progress', 'done', 'cancelled'];

export interface TaskEvent { step: 'created' | 'assigned' | 'status' | 'hours' | 'due' | 'comment'; by: string; byId?: string; at: string; note?: string; hours?: number }

/**
 * مهمة عمل لفريق الدعم: تكليف لعضو بمهلة، مرتبط بطلب صيانة أو مستقل
 * (مثل: إصلاح خلل، مراجعة سجلات، تدريب جمعية). تُسجَّل عليها ساعات العمل.
 */
@Entity('support_tasks')
@Index(['assigneeId', 'status'])
export class SupportTask {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /** رقم المهمة مثل TK-2026-0001 */
  @Index({ unique: true })
  @Column({ length: 32 })
  number!: string;

  @Index()
  @Column({ name: 'ticket_id', type: 'uuid', nullable: true })
  ticketId!: string | null;

  @ManyToOne(() => SupportTicket, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'ticket_id' })
  ticket!: SupportTicket | null;

  @Column({ length: 200 })
  title!: string;

  @Column({ type: 'text', default: '' })
  description!: string;

  @Column({ type: 'varchar', length: 24 })
  priority!: Priority;

  @Column({ type: 'varchar', length: 24, default: 'todo' })
  status!: TaskStatus;

  @Column({ name: 'assignee_id', type: 'uuid' })
  assigneeId!: string;

  @Column({ name: 'assignee_name', length: 200 })
  assigneeName!: string;

  @Column({ name: 'created_by_id', type: 'uuid' })
  createdById!: string;

  @Column({ name: 'created_by_name', length: 200 })
  createdByName!: string;

  @Column({ name: 'due_at', type: 'timestamptz' })
  dueAt!: Date;

  @Column({ name: 'estimated_hours', type: 'numeric', precision: 7, scale: 2, nullable: true, transformer: { to: (v) => v, from: (v) => (v === null ? null : Number(v)) } })
  estimatedHours!: number | null;

  @Column({ name: 'spent_hours', type: 'numeric', precision: 7, scale: 2, default: 0, transformer: { to: (v) => v, from: (v) => Number(v) } })
  spentHours!: number;

  @Column({ name: 'started_at', type: 'timestamptz', nullable: true })
  startedAt!: Date | null;

  @Column({ name: 'completed_at', type: 'timestamptz', nullable: true })
  completedAt!: Date | null;

  @Column({ type: 'jsonb', default: () => "'[]'" })
  history!: TaskEvent[];

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}

export const SUPPORT_ENTITIES = [SupportTicket, SupportMessage, SupportTask];
