import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { money } from '../../beneficiaries/entities/shared';

/** voucher: سند صرف للمستفيد مباشرة · invoice: فاتورة مستحقة لمزود خدمة */
export type PaymentMethod = 'voucher' | 'invoice';
export type PaymentStatus = 'pending' | 'paid' | 'rejected';
export type PayeeKind = 'beneficiary' | 'provider' | 'other';

/**
 * طلب صرف من إدارة المشاريع إلى الإدارة المالية على مبلغ محجوز.
 * عند تنفيذه (سند صرف أو اعتماد وصرف فاتورة) يتحول المبلغ من محجوز إلى مخصوم.
 */
@Entity('project_payment_requests')
@Index('UQ_project_payment_requests_no', ['organizationId', 'requestNo'], { unique: true })
@Index('IDX_project_payment_requests_status', ['organizationId', 'status'])
export class PaymentRequest {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId!: string;

  @Column({ name: 'request_no', type: 'int' })
  requestNo!: number;

  @Column({ name: 'activity_id', type: 'uuid' })
  activityId!: string;

  @Index()
  @Column({ name: 'allocation_id', type: 'uuid' })
  allocationId!: string;

  @Column({ name: 'batch_id', type: 'uuid' })
  batchId!: string;

  @Column({ type: 'numeric', precision: 14, scale: 2, transformer: money })
  amount!: number;

  @Column({ type: 'varchar', length: 10 })
  method!: PaymentMethod;

  @Column({ name: 'payee_kind', type: 'varchar', length: 12 })
  payeeKind!: PayeeKind;

  @Column({ name: 'payee_name', type: 'varchar', length: 200 })
  payeeName!: string;

  @Column({ type: 'varchar', length: 500, nullable: true })
  description!: string | null;

  @Column({ type: 'varchar', length: 10, default: 'pending' })
  status!: PaymentStatus;

  @Column({ name: 'requested_by_name', type: 'varchar', length: 200 })
  requestedByName!: string;

  /** رقم سند الصرف أو الفاتورة من المالية */
  @Column({ name: 'reference_no', type: 'varchar', length: 60, nullable: true })
  referenceNo!: string | null;

  @Column({ name: 'paid_on', type: 'date', nullable: true })
  paidOn!: string | null;

  @Column({ name: 'executed_by_name', type: 'varchar', length: 200, nullable: true })
  executedByName!: string | null;

  @Column({ name: 'executed_at', type: 'timestamptz', nullable: true })
  executedAt!: Date | null;

  @Column({ name: 'reject_reason', type: 'text', nullable: true })
  rejectReason!: string | null;

  /** القيد المحاسبي للصرف */
  @Column({ name: 'journal_entry_id', type: 'uuid', nullable: true })
  journalEntryId!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
