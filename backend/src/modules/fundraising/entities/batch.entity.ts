import { Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';
import { Organization } from '../../../core/entities';
import { Donor } from './donor.entity';
import type { DonorConditions, Opportunity } from './opportunity.entity';
import { WaqfProject } from './settings.entity';
import { moneyCol } from './shared';

/**
 * operational: تشغيلي (عام أو على مشروع تشغيلي) · program: برنامج/مشروع مقيد
 * waqf: مشروع وقف · case: حالة محددة (طلب مستفيد)
 */
export type BatchTarget = 'operational' | 'program' | 'waqf' | 'case';
/** pending: الفرصة لم تُعتمد بعد · active: متاحة للتحميل · closed: استُنفدت · cancelled: رُفضت الفرصة */
export type BatchStatus = 'pending' | 'active' | 'closed' | 'cancelled';

/**
 * الدفعة: بند من بنود توزيع فرصة التبرع، برقم مستقل عن رقم الفرصة.
 * الصافي = المبلغ − المحجوز − المخصوم (المصروف) − المحوَّل بالمناقلات.
 * وحدة إدارة المشاريع تحجز وتصرف وتناقل من خلال FundraisingService.
 */
@Entity('fundraising_batches')
@Index('UQ_fundraising_batches_no', ['organizationId', 'batchNo'], { unique: true })
@Index('IDX_fundraising_batches_activity', ['organizationId', 'activityId'])
export class Batch {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ name: 'organization_id', type: 'uuid' }) organizationId!: string;
  @ManyToOne(() => Organization, { onDelete: 'CASCADE' }) @JoinColumn({ name: 'organization_id' }) organization?: Organization;
  @Column({ name: 'batch_no', type: 'int' }) batchNo!: number;
  @Index() @Column({ name: 'opportunity_id', type: 'uuid' }) opportunityId!: string;
  @ManyToOne('Opportunity', 'batches', { onDelete: 'CASCADE' }) @JoinColumn({ name: 'opportunity_id' }) opportunity?: Opportunity;
  @Column({ name: 'line_no', type: 'int', default: 1 }) lineNo!: number;
  @Index() @Column({ name: 'donor_id', type: 'uuid' }) donorId!: string;
  @ManyToOne(() => Donor, { onDelete: 'NO ACTION' }) @JoinColumn({ name: 'donor_id' }) donor?: Donor;

  @Column({ name: 'target_kind', type: 'varchar', length: 12 }) targetKind!: BatchTarget;
  /** البرنامج أو المشروع (من شجرة الأنشطة)، أو مشروع الطلب للحالة */
  @Column({ name: 'activity_id', type: 'uuid', nullable: true }) activityId!: string | null;
  @Column({ name: 'waqf_project_id', type: 'uuid', nullable: true }) waqfProjectId!: string | null;
  @ManyToOne(() => WaqfProject, { onDelete: 'NO ACTION', nullable: true }) @JoinColumn({ name: 'waqf_project_id' }) waqfProject?: WaqfProject | null;
  @Column({ name: 'beneficiary_request_id', type: 'uuid', nullable: true }) beneficiaryRequestId!: string | null;
  /** اسم الجهة المستهدفة وقت الإنشاء (للعرض حتى لو تغيّر الاسم بعدين) */
  @Column({ name: 'target_name', type: 'varchar', length: 300 }) targetName!: string;

  /** amount: مبلغ محدد · percent: نسبة من إجمالي الفرصة */
  @Column({ name: 'allocation_mode', type: 'varchar', length: 8, default: 'amount' }) allocationMode!: 'amount' | 'percent';
  @Column({ type: 'numeric', precision: 7, scale: 4, nullable: true, transformer: { to: (v?: number | null) => v, from: (v?: string | null) => (v == null ? null : Number(v)) } })
  percent!: number | null;
  @Column(moneyCol('amount')) amount!: number;
  @Column({ name: 'is_zakat', default: false }) isZakat!: boolean;
  /** true للوعد بالدفع حتى يسدده الداعم */
  @Column({ name: 'is_promised', default: false }) isPromised!: boolean;
  @Column({ type: 'jsonb' }) conditions!: DonorConditions;
  @Column({ type: 'varchar', length: 12, default: 'pending' }) status!: BatchStatus;

  @Column(moneyCol('reserved_amount')) reservedAmount!: number;
  @Column(moneyCol('spent_amount')) spentAmount!: number;
  @Column(moneyCol('transferred_amount')) transferredAmount!: number;
  /** للدفعات الناتجة عن مناقلة: الدفعة الأصل */
  @Column({ name: 'parent_batch_id', type: 'uuid', nullable: true }) parentBatchId!: string | null;
  @ManyToOne(() => Batch, { onDelete: 'NO ACTION', nullable: true }) @JoinColumn({ name: 'parent_batch_id' }) parentBatch?: Batch | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt!: Date;
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' }) updatedAt!: Date;
}
