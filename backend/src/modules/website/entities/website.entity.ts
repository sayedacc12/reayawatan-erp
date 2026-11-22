import { Column, CreateDateColumn, Entity, Index, PrimaryColumn, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

/** أقسام محتوى الموقع (الرئيسية، من نحن، التواصل، أسئلة التقييم...) وإعداداته، كل قسم JSON */
@Entity('rw_site_content')
export class SiteContent {
  @PrimaryColumn({ name: 'organization_id', type: 'uuid' })
  organizationId!: string;

  @PrimaryColumn({ length: 40 })
  key!: string;

  @Column({ type: 'jsonb' })
  data!: Record<string, unknown>;

  @Column({ name: 'updated_by', type: 'uuid', nullable: true })
  updatedBy!: string | null;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}

export interface ServiceItem { title: string; desc: string }
export interface ServiceShift { from: string; to: string }

/** خدمات الشركة كما تظهر في الموقع (المجالات السبعة) */
@Entity('rw_services')
@Index('UQ_rw_services_slug', ['organizationId', 'slug'], { unique: true })
export class SiteService {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId!: string;

  @Column({ length: 60 })
  slug!: string;

  @Column({ length: 160 })
  title!: string;

  /** مرحلة دورة العمل: التوجيه، التنظيم... */
  @Column({ length: 60, default: '' })
  stage!: string;

  /** مفتاح الأيقونة */
  @Column({ length: 30, default: 'strategy' })
  icon!: string;

  @Column({ type: 'text', default: '' })
  short!: string;

  @Column({ type: 'text', default: '' })
  intro!: string;

  /** الأثر المستهدف */
  @Column({ type: 'text', default: '' })
  value!: string;

  @Column({ type: 'jsonb', default: () => "'[]'" })
  deliverables!: ServiceItem[];

  @Column({ type: 'jsonb', default: () => "'[]'" })
  audience!: string[];

  @Column({ type: 'jsonb', default: () => "'[]'" })
  steps!: ServiceItem[];

  @Column({ type: 'jsonb', default: () => "'[]'" })
  shifts!: ServiceShift[];

  @Column({ type: 'jsonb', default: () => "'[]'" })
  kpis!: string[];

  @Column({ default: false })
  featured!: boolean;

  @Column({ default: true })
  published!: boolean;

  @Column({ name: 'sort_order', type: 'int', default: 0 })
  sortOrder!: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}

export const LEAD_SOURCES = ['consultation', 'calculator', 'assessment', 'guide', 'booking'] as const;
export type LeadSource = (typeof LEAD_SOURCES)[number];
export const LEAD_STATUSES = ['new', 'contacted', 'qualified', 'proposal', 'won', 'lost', 'spam'] as const;
export type LeadStatus = (typeof LEAD_STATUSES)[number];

/** عميل محتمل: كل نموذج يرسله زائر الموقع (طلب استشارة، الحاسبة، التقييم، تنزيل دليل، حجز جلسة) */
@Entity('rw_leads')
@Index('IDX_rw_leads_org_created', ['organizationId', 'createdAt'])
export class Lead {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId!: string;

  /** رقم متسلسل داخل المنشأة للعرض */
  @Column({ name: 'lead_no', type: 'int' })
  leadNo!: number;

  @Column({ length: 20 })
  source!: LeadSource;

  @Column({ length: 20, default: 'new' })
  status!: LeadStatus;

  @Column({ length: 160 })
  name!: string;

  @Column({ name: 'org_name', type: 'varchar', length: 200, nullable: true })
  orgName!: string | null;

  @Column({ length: 200 })
  email!: string;

  @Column({ type: 'varchar', length: 30, nullable: true })
  phone!: string | null;

  @Column({ name: 'org_type', type: 'varchar', length: 60, nullable: true })
  orgType!: string | null;

  @Column({ name: 'service_slug', type: 'varchar', length: 60, nullable: true })
  serviceSlug!: string | null;

  @Column({ type: 'text', nullable: true })
  message!: string | null;

  /** نتيجة الأداة: مدخلات الحاسبة ونتائجها، أو إجابات التقييم ودرجته ومجالاته الأضعف، أو الدليل، أو موعد الجلسة */
  @Column({ type: 'jsonb', nullable: true })
  result!: Record<string, unknown> | null;

  /** درجة التقييم (0-100) للفرز السريع */
  @Column({ type: 'int', nullable: true })
  score!: number | null;

  @Column({ name: 'assigned_to', type: 'uuid', nullable: true })
  assignedTo!: string | null;

  @Column({ name: 'next_action_on', type: 'date', nullable: true })
  nextActionOn!: string | null;

  /** صفحة الإرسال ومصدر الزيارة (utm) إن وُجدت */
  @Column({ type: 'jsonb', nullable: true })
  meta!: Record<string, unknown> | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}

/** سجل متابعة العميل المحتمل: من غيّر الحالة أو أضاف ملاحظة ومتى (قبل وبعد) */
@Entity('rw_lead_events')
export class LeadEvent {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId!: string;

  @Index()
  @Column({ name: 'lead_id', type: 'uuid' })
  leadId!: string;

  /** created | status | assign | note | booking | guide | email */
  @Column({ length: 20 })
  kind!: string;

  @Column({ type: 'text', nullable: true })
  text!: string | null;

  @Column({ type: 'jsonb', nullable: true })
  before!: Record<string, unknown> | null;

  @Column({ type: 'jsonb', nullable: true })
  after!: Record<string, unknown> | null;

  @Column({ name: 'user_id', type: 'uuid', nullable: true })
  userId!: string | null;

  @Column({ name: 'user_name', type: 'varchar', length: 200, nullable: true })
  userName!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}

export const BOOKING_STATUSES = ['booked', 'confirmed', 'done', 'cancelled', 'no_show'] as const;
export type BookingStatus = (typeof BOOKING_STATUSES)[number];
export const ACTIVE_BOOKING = ['booked', 'confirmed'] as const;

/** حجز جلسة تشخيص مجانية من الموقع. لا يتكرر نفس الموعد لحجزين نشطين (فهرس فريد جزئي في القاعدة) */
@Entity('rw_bookings')
@Index('UQ_rw_bookings_active_slot', ['organizationId', 'startsAt'], { unique: true, where: `"status" IN ('booked','confirmed')` })
export class Booking {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId!: string;

  @Index()
  @Column({ name: 'lead_id', type: 'uuid' })
  leadId!: string;

  @Column({ name: 'starts_at', type: 'timestamptz' })
  startsAt!: Date;

  @Column({ name: 'ends_at', type: 'timestamptz' })
  endsAt!: Date;

  @Column({ length: 20, default: 'booked' })
  status!: BookingStatus;

  @Column({ type: 'varchar', length: 300, nullable: true })
  topic!: string | null;

  /** رابط الاجتماع المرئي (يضيفه الفريق عند التأكيد) */
  @Column({ name: 'meeting_url', type: 'varchar', length: 500, nullable: true })
  meetingUrl!: string | null;

  @Column({ name: 'consultant_id', type: 'uuid', nullable: true })
  consultantId!: string | null;

  /** بصمة رمز الإلغاء الذي يصل للعميل في بريده (الرمز نفسه لا يُحفظ) */
  @Index('UQ_rw_bookings_token', { unique: true })
  @Column({ name: 'manage_token_hash', type: 'varchar', length: 64 })
  manageTokenHash!: string;

  @Column({ name: 'cancel_reason', type: 'varchar', length: 500, nullable: true })
  cancelReason!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}

/** دليل مجاني في المكتبة: يُنزَّل مقابل البريد الإلكتروني */
@Entity('rw_guides')
@Index('UQ_rw_guides_slug', ['organizationId', 'slug'], { unique: true })
export class Guide {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId!: string;

  @Column({ length: 80 })
  slug!: string;

  @Column({ length: 200 })
  title!: string;

  @Column({ type: 'text', default: '' })
  summary!: string;

  /** مفتاح الخدمة المرتبطة (اختياري) */
  @Column({ name: 'service_slug', type: 'varchar', length: 60, nullable: true })
  serviceSlug!: string | null;

  @Column({ type: 'int', nullable: true })
  pages!: number | null;

  @Column({ name: 'file_key', type: 'varchar', length: 200, nullable: true })
  fileKey!: string | null;

  @Column({ name: 'file_name', type: 'varchar', length: 200, nullable: true })
  fileName!: string | null;

  @Column({ name: 'file_mime', type: 'varchar', length: 60, nullable: true })
  fileMime!: string | null;

  @Column({ name: 'file_size', type: 'int', nullable: true })
  fileSize!: number | null;

  @Column({ name: 'cover_key', type: 'varchar', length: 200, nullable: true })
  coverKey!: string | null;

  @Column({ name: 'cover_mime', type: 'varchar', length: 60, nullable: true })
  coverMime!: string | null;

  @Column({ default: false })
  published!: boolean;

  @Column({ name: 'sort_order', type: 'int', default: 0 })
  sortOrder!: number;

  @Column({ type: 'int', default: 0 })
  downloads!: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}

/** رابط تنزيل مؤقت يصدر بعد إدخال البريد (الرمز نفسه لا يُحفظ، فقط بصمته) */
@Entity('rw_guide_downloads')
export class GuideDownload {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId!: string;

  @Column({ name: 'guide_id', type: 'uuid' })
  guideId!: string;

  @Column({ name: 'lead_id', type: 'uuid' })
  leadId!: string;

  @Index('UQ_rw_guide_downloads_token', { unique: true })
  @Column({ name: 'token_hash', length: 64 })
  tokenHash!: string;

  @Column({ name: 'expires_at', type: 'timestamptz' })
  expiresAt!: Date;

  @Column({ name: 'used_count', type: 'int', default: 0 })
  usedCount!: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}

/** سجل تعديلات محتوى الموقع وخدماته وأدلته وإعداداته: من عدّل ومتى، وما قبل التعديل وما بعده */
@Entity('rw_content_events')
@Index(['organizationId', 'createdAt'])
export class ContentEvent {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId!: string;

  /** content | service | guide */
  @Column({ length: 20 })
  area!: string;

  /** save | reset | create | update | delete | hide | upload | order */
  @Column({ length: 20 })
  action!: string;

  /** مفتاح القسم أو معرف الخدمة أو الدليل */
  @Column({ type: 'varchar', length: 200, nullable: true })
  target!: string | null;

  @Column({ type: 'jsonb', nullable: true })
  before!: unknown;

  @Column({ type: 'jsonb', nullable: true })
  after!: unknown;

  @Column({ name: 'user_id', type: 'uuid', nullable: true })
  userId!: string | null;

  @Column({ name: 'user_name', type: 'varchar', length: 200, nullable: true })
  userName!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}

export const WEBSITE_ENTITIES = [SiteContent, SiteService, Lead, LeadEvent, Booking, Guide, GuideDownload, ContentEvent];
