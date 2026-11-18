import { Column, CreateDateColumn, Entity, Index, PrimaryColumn, PrimaryGeneratedColumn, UpdateDateColumn, ValueTransformer } from 'typeorm';

/** PostgreSQL يرجّع numeric كنص؛ نحوله لرقم */
const num: ValueTransformer = {
  to: (v?: number | null) => v,
  from: (v?: string | null) => (v === null || v === undefined ? null : Number(v)),
};

// ---------------- أنواع مشتركة ----------------

/** أقسام الموقع التي تفعّلها الجمعية أو تخفيها */
export interface SiteSections {
  about: boolean; programs: boolean; news: boolean; governance: boolean; partners: boolean; contact: boolean; store: boolean;
  volunteer: boolean; membership: boolean; portal: boolean;
}
export interface HeroCta { label: string; target: string }
export interface HomeStat { value: string; label: string }
export interface HomeContent {
  kicker: string; title: string; text: string; imageId: string | null;
  primaryCta: HeroCta; secondaryCta: HeroCta; stats: HomeStat[];
  showTicker: boolean; showGoals: boolean; showValues: boolean;
  announcement: { on: boolean; text: string; link: string };
}
export interface AboutContent { story: string; imageId: string | null; showStructure: boolean }
export interface Leader { name: string; role: string; photoId: string | null }
export interface BoardRow { k: string; v: string }
export interface Disclosure { title: string; text: string; status: string; docId: string | null }
export interface GovernanceContent {
  intro: string; leaders: Leader[]; boardRows: BoardRow[]; assembly: string; committees: string[]; ceo: string; units: string[];
  structureImageId: string | null; disclosures: Disclosure[]; showDocuments: boolean; showStructure: boolean; showBoard: boolean;
}
export interface Partner { name: string; url: string; kind: string; logoId: string | null }
export interface SeoContent { title: string; description: string; keywords: string }
export interface StoreConfig {
  /** استقبال التبرعات من الموقع */
  enabled: boolean;
  /** التبرع العام غير المقيد (بدون مشروع محدد) */
  general: boolean;
  generalTitle: string;
  /** الحد الأدنى العام للتبرع الواحد (ريال) */
  min: number;
  /** الحد الأعلى العام للتبرع الواحد (ريال) */
  max: number;
  presets: number[];
  gift: boolean;
  monthly: boolean;
  /** تنبيه يظهر في الإيصال، مثل رقم الترخيص */
  receiptNote: string;
  thanks: string;
}
export const SITE_GATEWAYS = ['sandbox', 'moyasar'] as const;
export interface SitePayment { provider: (typeof SITE_GATEWAYS)[number]; publishableKey: string | null; secretKey: string | null }
export interface SiteAccounting { generalRevenueAccountId: string | null; waqfRevenueAccountId: string | null; onlineCashAccountId: string | null }
export interface LogEntry { action: string; note: string | null; byName: string; at: string }

// ---------------- الإعدادات والمحتوى الثابت ----------------

/** إعدادات الموقع ومحتوى صفحاته الثابتة لكل جمعية */
@Entity('web_settings')
export class WebSettings {
  @PrimaryColumn({ name: 'organization_id', type: 'uuid' })
  organizationId!: string;

  /** الموقع منشور للزوار */
  @Column({ default: false })
  published!: boolean;

  @Column({ type: 'jsonb', default: () => `'{}'` })
  sections!: SiteSections;

  @Column({ type: 'jsonb', default: () => `'{}'` })
  home!: HomeContent;

  @Column({ type: 'jsonb', default: () => `'{}'` })
  about!: AboutContent;

  @Column({ type: 'jsonb', default: () => `'{}'` })
  governance!: GovernanceContent;

  @Column({ type: 'jsonb', default: () => `'[]'` })
  partners!: Partner[];

  @Column({ type: 'jsonb', default: () => `'{}'` })
  seo!: SeoContent;

  @Column({ name: 'footer_text', type: 'varchar', length: 600, nullable: true })
  footerText!: string | null;

  /** النطاق الخاص بالجمعية (للعرض والتوثيق، ويُربط من الخادم) */
  @Column({ name: 'custom_domain', type: 'varchar', length: 200, nullable: true })
  customDomain!: string | null;

  @Column({ type: 'jsonb', default: () => `'{}'` })
  store!: StoreConfig;

  @Column({ type: 'jsonb', default: () => `'{}'` })
  payment!: SitePayment;

  @Column({ type: 'jsonb', default: () => `'{}'` })
  accounting!: SiteAccounting;

  /** مفتاح معاينة الموقع قبل نشره (يُضاف للرابط ?preview=) */
  @Column({ name: 'preview_key', type: 'varchar', length: 40, nullable: true })
  previewKey!: string | null;

  @Column({ default: false })
  initialized!: boolean;

  @Column({ name: 'next_receipt_no', type: 'int', default: 1 })
  nextReceiptNo!: number;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}

/** مكتبة الصور: كل صورة في الموقع تُرفع هنا وتُعرض للزوار برابط عام */
@Entity('web_media')
@Index('IDX_web_media_org', ['organizationId'])
export class WebMedia {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId!: string;

  @Column({ name: 'file_key', length: 200 })
  fileKey!: string;

  @Column({ length: 40 })
  mime!: string;

  @Column({ length: 200 })
  name!: string;

  @Column({ type: 'int' })
  size!: number;

  @Column({ name: 'created_by_name', type: 'varchar', length: 200 })
  createdByName!: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}

// ---------------- الأخبار ----------------

export type NewsStatus = 'draft' | 'pending' | 'returned' | 'published';

@Entity('web_news')
@Index('IDX_web_news_org', ['organizationId', 'status', 'newsDate'])
export class WebNews {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId!: string;

  @Column({ length: 250 })
  title!: string;

  @Column({ type: 'varchar', length: 600 })
  summary!: string;

  @Column({ type: 'text' })
  body!: string;

  @Column({ name: 'image_id', type: 'uuid', nullable: true })
  imageId!: string | null;

  @Column({ name: 'news_date', type: 'date' })
  newsDate!: string;

  /** يظهر في الشريط الإخباري المتحرك */
  @Column({ default: true })
  ticker!: boolean;

  @Column({ type: 'varchar', length: 12, default: 'draft' })
  status!: NewsStatus;

  @Column({ name: 'review_note', type: 'varchar', length: 1000, nullable: true })
  reviewNote!: string | null;

  @Column({ type: 'int', default: 0 })
  views!: number;

  @Column({ name: 'created_by_id', type: 'uuid', nullable: true })
  createdById!: string | null;

  @Column({ name: 'created_by_name', type: 'varchar', length: 200 })
  createdByName!: string;

  @Column({ name: 'published_by_name', type: 'varchar', length: 200, nullable: true })
  publishedByName!: string | null;

  @Column({ name: 'published_at', type: 'timestamptz', nullable: true })
  publishedAt!: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}

// ---------------- البرامج والمشاريع (ومتجر التبرعات) ----------------

export type ProgramStatus = 'draft' | 'pending' | 'returned' | 'approved' | 'rejected';
export interface ProgramService { icon: string; title: string; text: string }
/** بيانات المتجر التي يحددها المعتمد: هل يُنشر في المتجر، ونوع التبرع، والمستهدف وحدود التبرع */
export interface ProgramStore {
  on: boolean; kind: 'project' | 'waqf'; goal: number; endDate: string | null; min: number; max: number; presets: number[];
  stop: boolean; monthly: boolean; gift: boolean; revenueAccountId: string | null;
}

@Entity('web_programs')
@Index('UQ_web_programs_org_slug', ['organizationId', 'slug'], { unique: true })
export class WebProgram {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId!: string;

  /** رمز البرنامج في الرابط (حروف إنجليزية) */
  @Column({ length: 60 })
  slug!: string;

  @Column({ length: 200 })
  name!: string;

  @Column({ type: 'varchar', length: 300, nullable: true })
  tagline!: string | null;

  @Column({ type: 'varchar', length: 800 })
  summary!: string;

  @Column({ type: 'text', nullable: true })
  about!: string | null;

  @Column({ type: 'varchar', length: 800, nullable: true })
  audience!: string | null;

  @Column({ type: 'varchar', length: 200, nullable: true })
  timing!: string | null;

  @Column({ type: 'jsonb', default: () => `'[]'` })
  services!: ProgramService[];

  @Column({ type: 'jsonb', default: () => `'[]'` })
  points!: string[];

  @Column({ type: 'varchar', length: 20, default: 'heart' })
  icon!: string;

  @Column({ name: 'image_id', type: 'uuid', nullable: true })
  imageId!: string | null;

  /** الحقيبة التعريفية: وثيقة من أرشيف المعرفة */
  @Column({ name: 'kit_doc_id', type: 'uuid', nullable: true })
  kitDocId!: string | null;

  /** المشروع المرتبط في إدارة المشاريع (يُذكر في سند القبض) */
  @Column({ name: 'activity_id', type: 'uuid', nullable: true })
  activityId!: string | null;

  /** يظهر في صفحة البرامج بالموقع */
  @Column({ name: 'show_on_site', default: true })
  showOnSite!: boolean;

  /** مميز في الصفحة الرئيسية */
  @Column({ default: false })
  featured!: boolean;

  @Column({ type: 'varchar', length: 12, default: 'draft' })
  status!: ProgramStatus;

  @Column({ name: 'review_note', type: 'varchar', length: 1000, nullable: true })
  reviewNote!: string | null;

  @Column({ type: 'jsonb', default: () => `'{}'` })
  store!: ProgramStore;

  @Column({ type: 'numeric', precision: 14, scale: 2, default: 0, transformer: num })
  raised!: number;

  @Column({ name: 'donations_count', type: 'int', default: 0 })
  donationsCount!: number;

  @Column({ name: 'sort_order', type: 'int', default: 0 })
  sortOrder!: number;

  @Column({ type: 'jsonb', default: () => `'[]'` })
  log!: LogEntry[];

  @Column({ name: 'created_by_name', type: 'varchar', length: 200 })
  createdByName!: string;

  @Column({ name: 'approved_by_name', type: 'varchar', length: 200, nullable: true })
  approvedByName!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}

// ---------------- التبرعات ----------------

export type DonationStatus = 'pending' | 'paid' | 'failed' | 'cancelled';
export type DonationKind = 'project' | 'waqf' | 'general';
export interface Gift { to: string; phone: string; message: string }

@Entity('web_donations')
@Index('IDX_web_donations_org', ['organizationId', 'status', 'createdAt'])
@Index('UQ_web_donations_token', ['payToken'], { unique: true })
@Index('UQ_web_donations_org_receipt', ['organizationId', 'receiptNo'], { unique: true, where: 'receipt_no IS NOT NULL' })
export class WebDonation {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId!: string;

  /** رقم الإيصال: يُعطى عند اكتمال الدفع فقط */
  @Column({ name: 'receipt_no', type: 'int', nullable: true })
  receiptNo!: number | null;

  @Column({ name: 'program_id', type: 'uuid', nullable: true })
  programId!: string | null;

  @Column({ name: 'program_name', length: 200 })
  programName!: string;

  @Column({ type: 'varchar', length: 10 })
  kind!: DonationKind;

  @Column({ type: 'numeric', precision: 12, scale: 2, transformer: num })
  amount!: number;

  @Column({ name: 'donor_name', type: 'varchar', length: 200, nullable: true })
  donorName!: string | null;

  @Column({ name: 'donor_phone', type: 'varchar', length: 20, nullable: true })
  donorPhone!: string | null;

  @Column({ name: 'donor_email', type: 'varchar', length: 200, nullable: true })
  donorEmail!: string | null;

  @Column({ type: 'jsonb', nullable: true })
  gift!: Gift | null;

  @Column({ default: false })
  monthly!: boolean;

  @Column({ name: 'subscription_id', type: 'uuid', nullable: true })
  subscriptionId!: string | null;

  @Column({ type: 'varchar', length: 12, default: 'pending' })
  status!: DonationStatus;

  @Column({ name: 'pay_token', length: 40 })
  payToken!: string;

  /** رمز التحقق المطبوع على الإيصال */
  @Column({ name: 'verify_code', length: 12 })
  verifyCode!: string;

  @Column({ name: 'gateway_id', type: 'varchar', length: 120, nullable: true })
  gatewayId!: string | null;

  @Column({ name: 'gateway_url', type: 'varchar', length: 500, nullable: true })
  gatewayUrl!: string | null;

  @Column({ name: 'payment_ref', type: 'varchar', length: 120, nullable: true })
  paymentRef!: string | null;

  @Column({ name: 'paid_at', type: 'timestamptz', nullable: true })
  paidAt!: Date | null;

  @Column({ name: 'voucher_id', type: 'uuid', nullable: true })
  voucherId!: string | null;

  @Column({ name: 'voucher_error', type: 'varchar', length: 500, nullable: true })
  voucherError!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}

export type SubscriptionStatus = 'active' | 'paused' | 'cancelled';

/** التبرع الشهري: يُصدر له رابط سداد كل شهر في موعد استحقاقه */
@Entity('web_subscriptions')
@Index('IDX_web_subscriptions_org', ['organizationId', 'status', 'nextDue'])
export class WebSubscription {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId!: string;

  @Column({ name: 'program_id', type: 'uuid', nullable: true })
  programId!: string | null;

  @Column({ name: 'program_name', length: 200 })
  programName!: string;

  @Column({ type: 'numeric', precision: 12, scale: 2, transformer: num })
  amount!: number;

  @Column({ name: 'donor_name', type: 'varchar', length: 200, nullable: true })
  donorName!: string | null;

  @Column({ name: 'donor_phone', type: 'varchar', length: 20 })
  donorPhone!: string;

  @Column({ type: 'varchar', length: 12, default: 'active' })
  status!: SubscriptionStatus;

  /** تاريخ الاستحقاق القادم */
  @Column({ name: 'next_due', type: 'date' })
  nextDue!: string;

  @Column({ type: 'int', default: 0 })
  charges!: number;

  @Column({ name: 'last_paid_at', type: 'timestamptz', nullable: true })
  lastPaidAt!: Date | null;

  /** آخر تبرع (رابط سداد) أُصدر لهذا الاشتراك */
  @Column({ name: 'open_donation_id', type: 'uuid', nullable: true })
  openDonationId!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}

// ---------------- رسائل الزوار وسجل النشاط ----------------

export type MessageStatus = 'new' | 'in_progress' | 'closed';

@Entity('web_messages')
@Index('IDX_web_messages_org', ['organizationId', 'status'])
export class WebMessage {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId!: string;

  @Column({ length: 200 })
  name!: string;

  @Column({ type: 'varchar', length: 20, nullable: true })
  phone!: string | null;

  @Column({ type: 'varchar', length: 200, nullable: true })
  email!: string | null;

  @Column({ length: 40 })
  topic!: string;

  @Column({ type: 'varchar', length: 4000 })
  body!: string;

  @Column({ type: 'varchar', length: 12, default: 'new' })
  status!: MessageStatus;

  @Column({ name: 'reply_note', type: 'varchar', length: 2000, nullable: true })
  replyNote!: string | null;

  @Column({ name: 'handled_by_name', type: 'varchar', length: 200, nullable: true })
  handledByName!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}

@Entity('web_activity')
@Index('IDX_web_activity_org', ['organizationId', 'at'])
export class WebActivity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId!: string;

  @Column({ name: 'by_name', length: 200 })
  byName!: string;

  @Column({ length: 120 })
  action!: string;

  @Column({ type: 'varchar', length: 300, nullable: true })
  target!: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  at!: Date;
}

export const WEBSITE_ENTITIES = [WebSettings, WebMedia, WebNews, WebProgram, WebDonation, WebSubscription, WebMessage, WebActivity];
