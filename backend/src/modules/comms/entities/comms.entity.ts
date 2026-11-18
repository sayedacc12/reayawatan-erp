import { Column, CreateDateColumn, Entity, Index, PrimaryColumn, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

/** درجات السرية: العادية يراها سجل المعاملات، ومتوسطة السرية يراها من له صلاحيتها، والسرية والعالية السرية للموجهة لهم فقط */
export const CONFIDENTIALITY = ['normal', 'medium', 'confidential', 'top_secret'] as const;
export type Confidentiality = (typeof CONFIDENTIALITY)[number];
export const PRIORITIES = ['normal', 'urgent', 'very_urgent'] as const;
export type Priority = (typeof PRIORITIES)[number];
/** نوع الوثيقة: معاملة تتنقل بين الجهات، أو قرار، أو تعميم/إشعار يُوجَّه لعدة أشخاص دفعة واحدة */
export const DOC_TYPES = ['transaction', 'decision', 'circular'] as const;
export type DocType = (typeof DOC_TYPES)[number];
export const TXN_KINDS = ['admin', 'financial'] as const;
export type TxnKind = (typeof TXN_KINDS)[number];
/** اتجاه المعاملة: داخلية بين الإدارات، أو واردة من جهة خارجية، أو صادرة إليها */
export const DIRECTIONS = ['internal', 'incoming', 'outgoing'] as const;
export type Direction = (typeof DIRECTIONS)[number];
/** الغرض من الإحالة */
export const PURPOSES = ['action', 'opinion', 'approve', 'sign', 'info'] as const;
export type Purpose = (typeof PURPOSES)[number];
export type TxnStatus = 'draft' | 'open' | 'closed' | 'archived' | 'issued' | 'cancelled';
export type TaskStatus = 'open' | 'in_progress' | 'done' | 'cancelled';
export type TaskSource = 'manual' | 'meeting' | 'transaction';

export interface Category { code: string; name: string; kind: TxnKind; dueDays: number; isActive: boolean }
export interface PersonRef { userId: string; name: string; unitName?: string | null }
export interface Recipient extends PersonRef { readAt: string | null }
export interface Attachment { id: string; key: string; name: string; mime: string; size: number; byName: string; at: string }
/** حركة على المعاملة: إنشاء، إحالة، إفادة، إعادة، إضافة متابع، اطلاع، إغلاق، حفظ، سند ... */
export interface Movement {
  at: string; kind: string; byId: string; byName: string;
  toUserId?: string | null; toName?: string | null; toUnitName?: string | null; purpose?: Purpose | null; note?: string | null; dueDate?: string | null;
}
export interface TaskLog { at: string; by: string; kind: string; text?: string | null; progress?: number | null; dueDate?: string | null }

/** إعدادات الاتصالات الإدارية لكل جمعية */
@Entity('comms_settings')
export class CommsSettings {
  @PrimaryColumn({ name: 'organization_id', type: 'uuid' })
  organizationId!: string;

  /** تصنيفات المعاملات: إدارية أو مالية، ولكل تصنيف مهلة إنجاز افتراضية */
  @Column({ type: 'jsonb', default: () => `'[]'` })
  categories!: Category[];

  /** التذكير بالمهام قبل موعدها بعدد أيام */
  @Column({ name: 'task_reminder_days', type: 'int', default: 3 })
  taskReminderDays!: number;

  /** عدادات الترقيم السنوية: {"TR-2026": 12, "TK-2026": 40} */
  @Column({ type: 'jsonb', default: () => `'{}'` })
  counters!: Record<string, number>;
}

/** المعاملات والقرارات والتعاميم */
@Entity('comms_transactions')
@Index('UQ_comms_transactions_ref', ['organizationId', 'refNo'], { unique: true })
@Index('IDX_comms_transactions_holder', ['organizationId', 'holderUserId', 'status'])
export class CommsTransaction {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId!: string;

  @Column({ name: 'doc_type', type: 'varchar', length: 12, default: 'transaction' })
  docType!: DocType;

  @Column({ name: 'ref_no', type: 'varchar', length: 30 })
  refNo!: string;

  @Column({ type: 'varchar', length: 10, default: 'admin' })
  kind!: TxnKind;

  @Column({ type: 'varchar', length: 10, default: 'internal' })
  direction!: Direction;

  @Column({ name: 'external_party', type: 'varchar', length: 250, nullable: true })
  externalParty!: string | null;

  @Column({ name: 'external_ref', type: 'varchar', length: 100, nullable: true })
  externalRef!: string | null;

  @Column({ name: 'category_code', type: 'varchar', length: 40, nullable: true })
  categoryCode!: string | null;

  @Column({ name: 'category_name', type: 'varchar', length: 150, nullable: true })
  categoryName!: string | null;

  @Column({ type: 'varchar', length: 300 })
  subject!: string;

  @Column({ type: 'text', default: '' })
  body!: string;

  @Column({ type: 'varchar', length: 12, default: 'normal' })
  confidentiality!: Confidentiality;

  @Column({ type: 'varchar', length: 12, default: 'normal' })
  priority!: Priority;

  // ---- المعاملة المالية: تنتهي بسند قبض أو صرف في النظام المالي، أو تُحفظ
  @Column({ name: 'financial_type', type: 'varchar', length: 10, nullable: true })
  financialType!: 'receipt' | 'payment' | null;

  @Column({ type: 'numeric', precision: 16, scale: 2, nullable: true })
  amount!: string | null;

  @Column({ name: 'party_name', type: 'varchar', length: 250, nullable: true })
  partyName!: string | null;

  // ---- الجهة المنشئة
  @Column({ name: 'origin_unit_id', type: 'uuid', nullable: true })
  originUnitId!: string | null;

  @Column({ name: 'origin_unit_name', type: 'varchar', length: 200, nullable: true })
  originUnitName!: string | null;

  @Column({ name: 'created_by_id', type: 'uuid' })
  createdById!: string;

  @Column({ name: 'created_by_name', type: 'varchar', length: 200 })
  createdByName!: string;

  // ---- الحائز الحالي (من المعاملة عنده الآن)
  @Column({ name: 'holder_user_id', type: 'uuid', nullable: true })
  holderUserId!: string | null;

  @Column({ name: 'holder_name', type: 'varchar', length: 200, nullable: true })
  holderName!: string | null;

  @Column({ name: 'holder_unit_name', type: 'varchar', length: 200, nullable: true })
  holderUnitName!: string | null;

  @Column({ name: 'holder_purpose', type: 'varchar', length: 10, nullable: true })
  holderPurpose!: Purpose | null;

  @Column({ name: 'holder_since', type: 'timestamptz', nullable: true })
  holderSince!: Date | null;

  @Column({ name: 'due_date', type: 'date', nullable: true })
  dueDate!: string | null;

  /** كل من أُحيلت إليه أو أنشأها أو وُجهت إليه (يرى المعاملة مهما كانت سريتها) */
  @Column({ name: 'party_user_ids', type: 'uuid', array: true, default: () => `'{}'` })
  partyUserIds!: string[];

  /** المتابعون: يطلعون على سير المعاملة دون أن يتدخلوا في إجراءاتها */
  @Column({ type: 'jsonb', default: () => `'[]'` })
  followers!: PersonRef[];

  @Column({ name: 'follower_user_ids', type: 'uuid', array: true, default: () => `'{}'` })
  followerUserIds!: string[];

  /** الموجَّه إليهم القرار أو التعميم، مع وقت اطلاع كل منهم */
  @Column({ type: 'jsonb', default: () => `'[]'` })
  recipients!: Recipient[];

  @Column({ type: 'jsonb', default: () => `'[]'` })
  movements!: Movement[];

  @Column({ type: 'jsonb', default: () => `'[]'` })
  attachments!: Attachment[];

  @Column({ type: 'varchar', length: 10, default: 'open' })
  status!: TxnStatus;

  @Column({ name: 'close_kind', type: 'varchar', length: 10, nullable: true })
  closeKind!: 'done' | 'archive' | 'voucher' | null;

  @Column({ name: 'close_note', type: 'varchar', length: 2000, nullable: true })
  closeNote!: string | null;

  @Column({ name: 'closed_at', type: 'timestamptz', nullable: true })
  closedAt!: Date | null;

  @Column({ name: 'closed_by_name', type: 'varchar', length: 200, nullable: true })
  closedByName!: string | null;

  @Column({ name: 'voucher_id', type: 'uuid', nullable: true })
  voucherId!: string | null;

  @Column({ name: 'voucher_serial', type: 'int', nullable: true })
  voucherSerial!: number | null;

  /** تاريخ إصدار القرار أو التعميم */
  @Column({ name: 'issued_at', type: 'timestamptz', nullable: true })
  issuedAt!: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}

/** المهام: لكل مهمة مسؤول واحد عن تنفيذها وموعد إغلاق، ومساندون يتابعونها دون أن تكون من مسؤولياتهم */
@Entity('comms_tasks')
@Index('UQ_comms_tasks_ref', ['organizationId', 'refNo'], { unique: true })
@Index('IDX_comms_tasks_owner', ['organizationId', 'ownerUserId', 'status'])
@Index('IDX_comms_tasks_source', ['organizationId', 'sourceType', 'sourceId'])
export class CommsTask {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId!: string;

  @Column({ name: 'ref_no', type: 'varchar', length: 30 })
  refNo!: string;

  @Column({ type: 'varchar', length: 300 })
  title!: string;

  @Column({ type: 'text', nullable: true })
  description!: string | null;

  @Column({ name: 'owner_user_id', type: 'uuid' })
  ownerUserId!: string;

  @Column({ name: 'owner_name', type: 'varchar', length: 200 })
  ownerName!: string;

  @Column({ name: 'owner_unit_name', type: 'varchar', length: 200, nullable: true })
  ownerUnitName!: string | null;

  @Column({ type: 'jsonb', default: () => `'[]'` })
  supporters!: PersonRef[];

  @Column({ name: 'supporter_user_ids', type: 'uuid', array: true, default: () => `'{}'` })
  supporterUserIds!: string[];

  @Column({ name: 'assigned_by_id', type: 'uuid' })
  assignedById!: string;

  @Column({ name: 'assigned_by_name', type: 'varchar', length: 200 })
  assignedByName!: string;

  @Column({ type: 'varchar', length: 12, default: 'normal' })
  priority!: Priority;

  @Column({ name: 'start_date', type: 'date' })
  startDate!: string;

  @Column({ name: 'due_date', type: 'date' })
  dueDate!: string;

  @Column({ name: 'original_due_date', type: 'date' })
  originalDueDate!: string;

  @Column({ type: 'varchar', length: 12, default: 'open' })
  status!: TaskStatus;

  @Column({ type: 'int', default: 0 })
  progress!: number;

  /** مصدر المهمة: يدوية، أو توصية اجتماع، أو معاملة */
  @Column({ name: 'source_type', type: 'varchar', length: 12, default: 'manual' })
  sourceType!: TaskSource;

  @Column({ name: 'source_id', type: 'uuid', nullable: true })
  sourceId!: string | null;

  @Column({ name: 'source_ref', type: 'varchar', length: 300, nullable: true })
  sourceRef!: string | null;

  @Column({ name: 'source_link', type: 'varchar', length: 200, nullable: true })
  sourceLink!: string | null;

  /** مهمة من اجتماع سري: لا يراها إلا المسؤول والمساندون ومن أسندها */
  @Column({ name: 'is_confidential', type: 'boolean', default: false })
  isConfidential!: boolean;

  @Column({ type: 'jsonb', default: () => `'[]'` })
  log!: TaskLog[];

  @Column({ name: 'completion_note', type: 'text', nullable: true })
  completionNote!: string | null;

  @Column({ name: 'completed_at', type: 'timestamptz', nullable: true })
  completedAt!: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}

export const COMMS_ENTITIES = [CommsSettings, CommsTransaction, CommsTask];
