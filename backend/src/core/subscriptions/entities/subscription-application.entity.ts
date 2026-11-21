import { Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';
import { BillingCycle, Organization } from '../../entities/organization.entity';

export const APPLICATION_STATUSES = ['submitted', 'returned', 'approved', 'rejected'] as const;
export type ApplicationStatus = (typeof APPLICATION_STATUSES)[number];

export interface Contact {
  name: string;
  /** المنصب (لعضو مجلس الإدارة) */
  position?: string;
  phone: string;
  email: string;
}

export interface ApplicationEvent {
  step: 'submitted' | 'resubmitted' | 'returned' | 'rejected' | 'approved' | 'edited';
  by: string;
  at: string;
  note?: string;
}

/** شروط الاشتراك التي يحددها مدير المنصة عند الاعتماد */
export interface ApprovedTerms {
  screens: string[] | null;
  modules: string[];
  price: number;
  billingCycle: BillingCycle;
  months: number;
  trialDays: number;
  startsOn: string;
}

/**
 * طلب اشتراك جمعية في المنصة، وهو في نفس الوقت "البيانات الرئيسية" للشركة بعد اعتمادها
 * (الترخيص، المدير التنفيذي، عضو مجلس الإدارة، بيانات التواصل).
 * دورة الطلب: مقدم ← (معاد للاستكمال ← مقدم) ← معتمد أو مرفوض.
 */
@Entity('subscription_applications')
export class SubscriptionApplication {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /** رقم الطلب مثل SUB-2026-0001 */
  @Index({ unique: true })
  @Column({ length: 32 })
  number!: string;

  /** رمز سري لرابط متابعة الطلب عند الشركة (/register/<token>) */
  @Index({ unique: true })
  @Column({ length: 64, select: false })
  token!: string;

  @Column({ type: 'varchar', length: 16, default: 'submitted' })
  status!: ApplicationStatus;

  @Column({ name: 'org_name', length: 200 })
  orgName!: string;

  /** المعرف المقترح للروابط (/o/<slug>) */
  @Column({ name: 'proposed_slug', length: 64 })
  proposedSlug!: string;

  @Column({ length: 100 })
  city!: string;

  @Column({ name: 'org_email', length: 254 })
  orgEmail!: string;

  @Column({ name: 'org_phone', length: 30 })
  orgPhone!: string;

  @Column({ name: 'license_number', length: 50 })
  licenseNumber!: string;

  @Column({ name: 'license_start_date', type: 'date' })
  licenseStartDate!: string;

  @Column({ name: 'license_end_date', type: 'date', nullable: true })
  licenseEndDate!: string | null;

  @Column({ name: 'license_file_key', length: 200 })
  licenseFileKey!: string;

  @Column({ name: 'license_file_mime', length: 64 })
  licenseFileMime!: string;

  @Column({ name: 'license_file_name', length: 200 })
  licenseFileName!: string;

  @Column({ name: 'executive_director', type: 'jsonb' })
  executiveDirector!: Contact;

  @Column({ name: 'board_member', type: 'jsonb' })
  boardMember!: Contact;

  /** مدير نظام الشركة: يُنشأ حسابه بهذه البيانات عند الاعتماد */
  @Column({ name: 'admin_full_name', length: 200 })
  adminFullName!: string;

  @Column({ name: 'admin_email', length: 254 })
  adminEmail!: string;

  @Column({ name: 'admin_password_hash', type: 'varchar', length: 100, select: false, nullable: true })
  adminPasswordHash!: string | null;

  /** آخر ملاحظة من مدير المنصة (سبب الإرجاع أو الرفض) */
  @Column({ name: 'review_note', type: 'text', nullable: true })
  reviewNote!: string | null;

  @Column({ name: 'decided_at', type: 'timestamptz', nullable: true })
  decidedAt!: Date | null;

  @Column({ type: 'jsonb', nullable: true })
  terms!: ApprovedTerms | null;

  @Column({ type: 'jsonb', default: () => "'[]'" })
  history!: ApplicationEvent[];

  /** الشركة بعد الاعتماد */
  @Index()
  @Column({ name: 'organization_id', type: 'uuid', nullable: true })
  organizationId!: string | null;

  @ManyToOne(() => Organization, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'organization_id' })
  organization!: Organization | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
