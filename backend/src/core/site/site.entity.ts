import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

/** الخدمات السبع (السنابل السبع) التي تقدمها المنصة للجمعيات */
export const SITE_SERVICES = [
  { code: 'digital', name: 'التحول الرقمي' },
  { code: 'governance', name: 'الحوكمة والالتزام' },
  { code: 'risk_audit', name: 'المخاطر والمراجعة الداخلية' },
  { code: 'impact', name: 'قياس الأثر الاجتماعي' },
  { code: 'sustainability', name: 'الاستدامة المالية' },
  { code: 'strategy_quality', name: 'التخطيط الاستراتيجي والجودة' },
  { code: 'capacity', name: 'بناء القدرات' },
] as const;
export const SERVICE_CODES = SITE_SERVICES.map((s) => s.code) as string[];

/** نوع الطلب: استشارة مجانية، عرض سعر لخدمة، عرض تجريبي لمنصة سنابل */
export const INQUIRY_KINDS = ['consultation', 'quote', 'demo'] as const;
export type InquiryKind = (typeof INQUIRY_KINDS)[number];

/** مراحل متابعة الطلب لدى إدارة المنصة */
export const INQUIRY_STATUSES = ['new', 'contacted', 'in_progress', 'won', 'closed'] as const;
export type InquiryStatus = (typeof INQUIRY_STATUSES)[number];

export interface InquiryLogEntry {
  at: string;
  by: string;
  action: 'status' | 'note';
  status?: InquiryStatus;
  note?: string;
}

/** طلب وارد من الصفحة التعريفية للمنصة (sanabelerp.com) */
@Entity('platform_inquiries')
@Index('IDX_platform_inquiries_status', ['status', 'createdAt'])
export class SiteInquiry {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /** رقم تسلسلي يظهر لمدير المنصة وللزائر بعد الإرسال */
  @Column({ type: 'int', generated: 'increment' })
  number!: number;

  @Column({ length: 20 })
  kind!: InquiryKind;

  /** رمز الخدمة من SITE_SERVICES (فارغ في طلب العرض التجريبي العام) */
  @Column({ name: 'service_code', type: 'varchar', length: 30, nullable: true })
  serviceCode!: string | null;

  @Column({ name: 'org_name', length: 200 })
  orgName!: string;

  @Column({ name: 'contact_name', length: 200 })
  contactName!: string;

  @Column({ name: 'job_title', type: 'varchar', length: 120, nullable: true })
  jobTitle!: string | null;

  @Column({ length: 30 })
  phone!: string;

  @Column({ type: 'varchar', length: 200, nullable: true })
  email!: string | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  city!: string | null;

  @Column({ type: 'text', nullable: true })
  message!: string | null;

  @Column({ length: 20, default: 'new' })
  status!: InquiryStatus;

  @Column({ type: 'jsonb', default: () => "'[]'" })
  log!: InquiryLogEntry[];

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
