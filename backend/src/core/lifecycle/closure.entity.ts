import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

export type ClosureReason = 'mutual' | 'trial_expired';
export type ClosureStatus = 'scheduled' | 'cancelled' | 'deleted';
export interface ClosureEvent { at: string; by: string; action: 'scheduled' | 'cancelled' | 'deleted' | 'exported'; note?: string }

/**
 * إغلاق جمعية وحذف بياناتها: إنهاء العقد بالتراضي (بمهلة قبل الحذف) أو انتهاء الفترة التجريبية دون اشتراك.
 * يبقى السجل بعد حذف الشركة للرجوع إليه (اسمها ومعرفها وسبب الحذف ومن نفذه وعدد السجلات)، بلا أي بيانات من داخلها.
 */
@Entity('organization_closures')
export class OrganizationClosure {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /** بلا ربط بجدول الجمعيات لأن السجل يبقى بعد حذفها */
  @Index('IDX_organization_closures_org')
  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId!: string;

  @Column({ name: 'org_name', length: 200 })
  orgName!: string;

  @Column({ name: 'org_slug', length: 64 })
  orgSlug!: string;

  @Column({ type: 'varchar', length: 16 })
  reason!: ClosureReason;

  @Column({ type: 'varchar', length: 16 })
  status!: ClosureStatus;

  /** يوم الحذف: تُحذف الشركة في هذا اليوم أو بعده */
  @Column({ name: 'delete_on', type: 'date' })
  deleteOn!: string;

  /** بيانات الاتفاق في الإنهاء بالتراضي: تاريخه وممثل الشركة وملاحظات */
  @Column({ type: 'jsonb', nullable: true })
  agreement!: { date: string; charityRep: string; note: string | null } | null;

  @Column({ name: 'requested_by', length: 200 })
  requestedBy!: string;

  @Column({ name: 'deleted_at', type: 'timestamptz', nullable: true })
  deletedAt!: Date | null;

  @Column({ name: 'deleted_records', type: 'int', nullable: true })
  deletedRecords!: number | null;

  @Column({ type: 'jsonb', default: () => "'[]'" })
  log!: ClosureEvent[];

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
