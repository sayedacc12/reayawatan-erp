import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { money } from '../../beneficiaries/entities/shared';

/**
 * مناقلة: نقل المتبقي من صافي رصيد دفعة إلى مشروع آخر لنفس الداعم وبنفس اشتراطاته.
 * نظام الموارد المالية ينشئ دفعة فرعية على المشروع الجديد (target_batch_id).
 */
@Entity('project_transfers')
@Index('UQ_project_transfers_no', ['organizationId', 'transferNo'], { unique: true })
export class BatchTransfer {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId!: string;

  @Column({ name: 'transfer_no', type: 'int' })
  transferNo!: number;

  @Index()
  @Column({ name: 'source_batch_id', type: 'uuid' })
  sourceBatchId!: string;

  @Column({ name: 'target_batch_id', type: 'uuid' })
  targetBatchId!: string;

  @Column({ name: 'source_activity_id', type: 'uuid', nullable: true })
  sourceActivityId!: string | null;

  @Column({ name: 'target_activity_id', type: 'uuid' })
  targetActivityId!: string;

  @Column({ name: 'donor_id', type: 'uuid', nullable: true })
  donorId!: string | null;

  @Column({ type: 'numeric', precision: 14, scale: 2, transformer: money })
  amount!: number;

  @Column({ type: 'text' })
  reason!: string;

  @Column({ name: 'created_by_name', type: 'varchar', length: 200 })
  createdByName!: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
