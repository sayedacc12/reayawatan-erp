import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

export const SUBSCRIPTION_STATUSES = ['trial', 'awaiting_contract', 'active'] as const;
export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];
export const BILLING_CYCLES = ['monthly', 'quarterly', 'semiannual', 'annual'] as const;
export type BillingCycle = (typeof BILLING_CYCLES)[number];

/**
 * الشركة (المستأجر في المنصة). كل جدول بيانات في أي وحدة يحمل organization_id،
 * وكل استعلام يُقيَّد بجمعية المستخدم الحالي، فلا ترى جمعية بيانات جمعية أخرى.
 */
@Entity('organizations')
export class Organization {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ length: 200 })
  name!: string;

  /** معرف قصير بالإنجليزية (يصلح لاحقًا كنطاق فرعي: slug.example.com) */
  @Index({ unique: true })
  @Column({ length: 64 })
  slug!: string;

  /** إيقاف الشركة يمنع كل مستخدميها من الدخول */
  @Column({ name: 'is_active', default: true })
  isActive!: boolean;

  /**
   * الشاشات المسموحة للشركة (مسارات قوائم الوحدات). null = كل الشاشات.
   * يحددها مدير المنصة عند اعتماد الاشتراك أو من شاشة الشركة.
   */
  @Column({ name: 'allowed_screens', type: 'jsonb', nullable: true })
  allowedScreens!: string[] | null;

  /** قائمة الجنسيات المعتمدة في الشركة (null = القائمة الافتراضية)، يستخدمها المستفيدون والموارد المالية */
  @Column({ type: 'jsonb', nullable: true })
  nationalities!: string[] | null;

  /** الرقم الضريبي للشركة (إن وجد)، من البيانات الأساسية */
  @Column({ name: 'tax_number', type: 'varchar', length: 30, nullable: true })
  taxNumber!: string | null;

  /** حالة الاشتراك: trial تجريبي، awaiting_contract بانتظار توقيع العقد، active ساري */
  @Column({ name: 'subscription_status', type: 'varchar', length: 24, default: 'active' })
  subscriptionStatus!: SubscriptionStatus;

  /** آخر يوم في الفترة التجريبية */
  @Column({ name: 'trial_ends_on', type: 'date', nullable: true })
  trialEndsOn!: string | null;

  @Column({ name: 'subscription_starts_on', type: 'date', nullable: true })
  subscriptionStartsOn!: string | null;

  /** آخر يوم في الاشتراك (null = بدون نهاية) */
  @Column({ name: 'subscription_ends_on', type: 'date', nullable: true })
  subscriptionEndsOn!: string | null;

  /** قيمة الاشتراك بالريال (قبل الضريبة) لكل دورة سداد */
  @Column({ name: 'subscription_price', type: 'numeric', precision: 12, scale: 2, nullable: true })
  subscriptionPrice!: string | null;

  @Column({ name: 'billing_cycle', type: 'varchar', length: 16, nullable: true })
  billingCycle!: BillingCycle | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
