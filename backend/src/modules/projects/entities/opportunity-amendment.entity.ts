import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { money } from '../../beneficiaries/entities/shared';

/** لقطة اشتراطات الدفعة قبل التعديل وبعده */
export interface AmendmentTerms {
  activityId: string | null;
  activityName: string | null;
  conditions: Record<string, unknown>;
}

/**
 * تعديل فرصة تبرع: تعديل اشتراطات دفعة (أو مشروعها) من تاريخ التعديل بعد موافقة الداعم وإقرار المسؤول.
 * الأثر المالي: قيد عكسي بالمبلغ المعدل (لا يزيد عن صافي الرصيد غير المحجوز وغير المخصوم)، ثم قيد جديد بالقيمة نفسها.
 */
@Entity('opportunity_amendments')
@Index('UQ_opportunity_amendments_no', ['organizationId', 'amendmentNo'], { unique: true })
export class OpportunityAmendment {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId!: string;

  @Column({ name: 'amendment_no', type: 'int' })
  amendmentNo!: number;

  @Index()
  @Column({ name: 'opportunity_id', type: 'uuid' })
  opportunityId!: string;

  /** الدفعة التي عُدلت اشتراطاتها */
  @Column({ name: 'batch_id', type: 'uuid' })
  batchId!: string;

  /** الدفعة الجديدة بالاشتراطات المعدلة */
  @Column({ name: 'new_batch_id', type: 'uuid', nullable: true })
  newBatchId!: string | null;

  @Column({ name: 'effective_date', type: 'date' })
  effectiveDate!: string;

  /** المبلغ المنشأ في التعديل */
  @Column({ type: 'numeric', precision: 14, scale: 2, transformer: money })
  amount!: number;

  @Column({ type: 'jsonb' })
  before!: AmendmentTerms;

  @Column({ type: 'jsonb' })
  after!: AmendmentTerms;

  @Column({ type: 'text' })
  reason!: string;

  /** موافقة الداعم ومرجعها (خطاب، بريد...) */
  @Column({ name: 'donor_approved', default: false })
  donorApproved!: boolean;

  @Column({ name: 'donor_approval_ref', type: 'varchar', length: 300, nullable: true })
  donorApprovalRef!: string | null;

  /** إقرار المسؤول بعلامة داخل النموذج */
  @Column({ name: 'acknowledged_by_name', type: 'varchar', length: 200 })
  acknowledgedByName!: string;

  @Column({ name: 'reversal_entry_id', type: 'uuid', nullable: true })
  reversalEntryId!: string | null;

  @Column({ name: 'reissue_entry_id', type: 'uuid', nullable: true })
  reissueEntryId!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
