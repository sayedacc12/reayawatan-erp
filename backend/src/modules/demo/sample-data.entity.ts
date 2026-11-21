import { Column, Entity, JoinColumn, OneToOne, PrimaryColumn } from 'typeorm';
import { Organization } from '../../core/entities';
import type { Snapshot } from '../../core/lifecycle/org-data';

export type SampleDataStatus = 'loading' | 'loaded' | 'cleared';
export interface SampleDataEvent { at: string; by: string; action: 'loaded' | 'failed' | 'cleared'; note?: string; counts?: Record<string, number> }

/**
 * البيانات التجريبية داخل جمعية مشتركة (فترة التجربة): لقطة سجلات الشركة قبل الإضافة،
 * ومعرفات كل سجل تجريبي أُضيف، وسجل العمليات (إضافة، فشل، تحويل لجمعية فعلية).
 */
@Entity('organization_sample_data')
export class OrganizationSampleData {
  @PrimaryColumn({ name: 'organization_id', type: 'uuid' })
  organizationId!: string;

  @OneToOne(() => Organization, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'organization_id' })
  organization?: Organization;

  @Column({ type: 'varchar', length: 16 })
  status!: SampleDataStatus;

  @Column({ name: 'loaded_by', type: 'varchar', length: 200 })
  loadedBy!: string;

  @Column({ name: 'loaded_at', type: 'timestamptz', default: () => 'now()' })
  loadedAt!: Date;

  /** سجلات الشركة قبل إضافة البيانات التجريبية (تبقى عند التحويل) */
  @Column({ type: 'jsonb', select: false })
  baseline!: Snapshot;

  /** معرفات السجلات التجريبية لكل جدول (null أثناء الإضافة) */
  @Column({ type: 'jsonb', nullable: true, select: false })
  sample!: Record<string, string[]> | null;

  @Column({ name: 'cleared_at', type: 'timestamptz', nullable: true })
  clearedAt!: Date | null;

  @Column({ name: 'cleared_by', type: 'varchar', length: 200, nullable: true })
  clearedBy!: string | null;

  @Column({ type: 'jsonb', default: () => "'[]'" })
  log!: SampleDataEvent[];
}
