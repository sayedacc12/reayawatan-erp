import { Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';
import { BillingCycle, Organization } from '../../entities/organization.entity';

export const CONTRACT_STATUSES = ['draft', 'sent', 'changes_requested', 'signed', 'cancelled'] as const;
export type ContractStatus = (typeof CONTRACT_STATUSES)[number];

/** بند داخل عقد معيّن (نسخة من مكتبة البنود قابلة للتعديل في هذا العقد فقط) */
export interface ContractItem {
  key: string;
  /** البند الأصلي في المكتبة (فارغ للبند المضاف لهذا العقد فقط) */
  clauseId: string | null;
  title: string;
  paragraphs: string[];
  mandatory: boolean;
}

/** الشروط المالية والزمنية للعقد */
export interface ContractTerms {
  price: number;
  billingCycle: BillingCycle;
  vatRate: number;
  months: number;
  startsOn: string;
  screens: string[] | null;
  trialDays: number;
}

export interface ContractEvent {
  step: 'created' | 'edited' | 'sent' | 'emailed' | 'withdrawn' | 'changes_requested' | 'signed' | 'cancelled';
  by: string;
  at: string;
  note?: string;
}

/**
 * عقد اشتراك إلكتروني بين المنصة وجمعية. الإجراءات:
 * مسودة ← مرسل للجمعية ← (طلب تعديل ← مسودة) ← موقّع إلكترونيًا (يُفعَّل الاشتراك) أو ملغى.
 * عند الإرسال تُثبَّت نسخة نصية نهائية وبصمتها (SHA-256)، وهي التي توقّعها الجمعية.
 */
@Entity('subscription_contracts')
export class SubscriptionContract {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /** رقم العقد مثل CT-2026-0001 */
  @Index({ unique: true })
  @Column({ length: 32 })
  number!: string;

  /** رمز سري لرابط مراجعة العقد وتوقيعه عند الجمعية (/contract/<token>) */
  @Index({ unique: true })
  @Column({ length: 64, select: false })
  token!: string;

  @Index()
  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId!: string;

  @ManyToOne(() => Organization, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'organization_id' })
  organization!: Organization;

  @Column({ name: 'application_id', type: 'uuid', nullable: true })
  applicationId!: string | null;

  @Column({ type: 'varchar', length: 24, default: 'draft' })
  status!: ContractStatus;

  @Column({ type: 'jsonb' })
  terms!: ContractTerms;

  @Column({ type: 'jsonb', default: () => "'[]'" })
  items!: ContractItem[];

  /** النص النهائي بعد استبدال المتغيرات (يُثبَّت عند الإرسال) */
  @Column({ type: 'jsonb', nullable: true })
  rendered!: { title: string; paragraphs: string[] }[] | null;

  @Column({ name: 'content_hash', type: 'varchar', length: 64, nullable: true })
  contentHash!: string | null;

  @Column({ name: 'sent_at', type: 'timestamptz', nullable: true })
  sentAt!: Date | null;

  @Column({ name: 'change_request', type: 'text', nullable: true })
  changeRequest!: string | null;

  @Column({ name: 'signed_at', type: 'timestamptz', nullable: true })
  signedAt!: Date | null;

  @Column({ name: 'signer_name', type: 'varchar', length: 200, nullable: true })
  signerName!: string | null;

  @Column({ name: 'signer_title', type: 'varchar', length: 200, nullable: true })
  signerTitle!: string | null;

  @Column({ name: 'signer_ip', type: 'varchar', length: 64, nullable: true })
  signerIp!: string | null;

  @Column({ type: 'jsonb', default: () => "'[]'" })
  history!: ContractEvent[];

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}

export type { BillingCycle };
