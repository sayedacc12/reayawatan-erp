import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';
import { money } from '../../beneficiaries/entities/shared';

/** request: تحميل طلب مستفيد على دفعة · general: صرف عام لمشروع غير مرتبط بمستفيدين */
export type AllocationKind = 'request' | 'general';
/** reserved: محجوز · partial: صُرف جزء منه · spent: مخصوم بالكامل · released: أُلغي الحجز */
export type AllocationStatus = 'reserved' | 'partial' | 'spent' | 'released';

/**
 * تحميل دعم على دفعة داعم. المبلغ يظهر "محجوزًا" على الدفعة حتى تصرفه المالية فيصبح "مخصومًا".
 * remaining = amount - spent - released
 */
@Entity('project_allocations')
@Index('UQ_project_allocations_no', ['organizationId', 'allocationNo'], { unique: true })
@Index('IDX_project_allocations_project', ['organizationId', 'activityId'])
@Index('IDX_project_allocations_batch', ['batchId'])
export class SupportAllocation {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId!: string;

  @Column({ name: 'allocation_no', type: 'int' })
  allocationNo!: number;

  @Column({ type: 'varchar', length: 10 })
  kind!: AllocationKind;

  /** المشروع المستفيد من الدعم */
  @Column({ name: 'activity_id', type: 'uuid' })
  activityId!: string;

  /** دفعة الداعم (من نظام الموارد المالية) */
  @Column({ name: 'batch_id', type: 'uuid' })
  batchId!: string;

  @Column({ name: 'request_id', type: 'uuid', nullable: true })
  requestId!: string | null;

  @Column({ name: 'beneficiary_id', type: 'uuid', nullable: true })
  beneficiaryId!: string | null;

  @Column({ type: 'numeric', precision: 14, scale: 2, transformer: money })
  amount!: number;

  @Column({ name: 'spent_amount', type: 'numeric', precision: 14, scale: 2, default: 0, transformer: money })
  spentAmount!: number;

  @Column({ name: 'released_amount', type: 'numeric', precision: 14, scale: 2, default: 0, transformer: money })
  releasedAmount!: number;

  @Column({ type: 'varchar', length: 10, default: 'reserved' })
  status!: AllocationStatus;

  @Column({ type: 'text', nullable: true })
  notes!: string | null;

  @Column({ name: 'created_by_name', type: 'varchar', length: 200 })
  createdByName!: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
