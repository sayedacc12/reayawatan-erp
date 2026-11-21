import { Column, CreateDateColumn, Entity, Index, PrimaryColumn, PrimaryGeneratedColumn, UpdateDateColumn, ValueTransformer } from 'typeorm';

/** PostgreSQL يرجّع numeric كنص؛ نحوله لرقم */
const num: ValueTransformer = {
  to: (v?: number | null) => v,
  from: (v?: string | null) => (v === null || v === undefined ? null : Number(v)),
};

// ---------------- أنواع مشتركة ----------------

export const FIELD_TYPES = ['text', 'textarea', 'number', 'date', 'select', 'checkbox'] as const;
export type FieldType = (typeof FIELD_TYPES)[number];
/** حقل إضافي في نموذج طلب العضوية يعرّفه مدير النظام من الإعدادات */
export interface FormField { key: string; label: string; type: FieldType; required: boolean; options?: string[]; placeholder?: string }

/**
 * نوع عضوية (عامل، منتسب، فخري...) بقيمة اشتراكه ومدته وشروطه وحق التصويت.
 * الرمز ثابت بعد الإنشاء، والنوع المستخدم يُوقف ولا يُحذف.
 */
export interface MembershipType {
  code: string;
  name: string;
  description: string | null;
  /** قيمة الاشتراك لكل مدة (ريال) */
  fee: number;
  /** رسوم الانتساب: تُدفع مرة واحدة مع أول اشتراك */
  joiningFee: number;
  /** مدة العضوية بالأشهر (12 = سنوية) */
  durationMonths: number;
  /** حق حضور الجمعية العمومية والتصويت فيها */
  votingRights: boolean;
  /** أيام من الانضمام قبل اكتساب حق التصويت (0 = فورًا) */
  votingAfterDays: number;
  /** أقل عمر للتقديم على هذا النوع (null = بدون شرط) */
  minAge: number | null;
  /** للسعوديين فقط */
  saudiOnly: boolean;
  /** يظهر في صفحة التقديم العامة (الفخري مثلًا يُمنح داخليًا فقط) */
  publicApply: boolean;
  /** المزايا التي يحصل عليها العضو */
  benefits: string | null;
  /** حساب إيراد خاص بالنوع في النظام المالي (null = حساب الإيراد العام في إعدادات العضوية) */
  revenueAccountId: string | null;
  color: string;
  isActive: boolean;
}

/** شرط من شروط العضوية وفق اللائحة الأساسية، يقر به المتقدم */
export interface MembershipCondition { key: string; text: string; reference: string | null; isActive: boolean }

/** مستند مطلوب مع الطلب (صورة الهوية، صورة شخصية...) */
export interface DocumentRequirement { key: string; name: string; required: boolean; isActive: boolean }

/** مرحلة اعتماد طلبات العضوية (الدور فارغ = أي مستخدم معه صلاحية اعتماد الطلبات) */
export interface ApprovalStage { name: string; roleId: string | null }

export interface DocSection { title: string; body: string }
/** أحكام العضوية في اللائحة الأساسية: تُعرض للمتقدم، وكل حفظ يرفع رقم الإصدار */
export interface Regulation { title: string; sections: DocSection[]; version: number; effectiveDate: string | null; updatedByName: string | null }

export const GATEWAYS = ['sandbox', 'moyasar'] as const;
export type GatewayProvider = (typeof GATEWAYS)[number];
export interface PaymentConfig {
  /** الدفع الإلكتروني عبر بوابة الدفع */
  online: boolean;
  /** التحويل البنكي مع رفع إيصال التحويل */
  transfer: boolean;
  /** الدفع النقدي في مقر الشركة (يسجله الموظف) */
  cash: boolean;
  /** sandbox = بيئة تجريبية تحاكي الدفع، moyasar = بوابة ميسر */
  provider: GatewayProvider;
  publishableKey: string | null;
  /** المفتاح السري لا يُعاد للواجهة أبدًا */
  secretKey: string | null;
  bankName: string | null;
  accountName: string | null;
  iban: string | null;
  /** مهلة السداد بالأيام من تاريخ إصدار المطالبة */
  dueDays: number;
}

/** الربط بالنظام المالي: سند قبض لكل تحصيل */
export interface AccountingLink {
  revenueAccountId: string | null;
  onlineCashAccountId: string | null;
  transferCashAccountId: string | null;
  cashCashAccountId: string | null;
}

export interface RenewalConfig {
  /** أيام التنبيه قبل انتهاء العضوية، مثل [30, 7] */
  reminderDays: number[];
  /** مهلة السماح بعد الانتهاء: التجديد خلالها يكمل من تاريخ الانتهاء السابق */
  graceDays: number;
  /** إصدار مطالبة التجديد تلقائيًا قبل الانتهاء بعدد أيام (null = يدويًا) */
  autoInvoiceDays: number | null;
  /** نص رسالة التذكير بمتغيرات مثل {اسم العضو} */
  message: string;
}

export interface CardConfig { title: string; signatoryName: string; signatoryTitle: string; note: string }

export type ApplicationStatus = 'in_review' | 'returned' | 'rejected' | 'awaiting_payment' | 'completed' | 'cancelled';
export type MemberStatus = 'active' | 'suspended' | 'terminated';
export type InvoiceStatus = 'unpaid' | 'review' | 'paid' | 'cancelled';
export type InvoiceKind = 'new' | 'renewal';
export type PayMethod = 'online' | 'transfer' | 'cash';

export interface StoredDoc { key: string; name: string; fileKey: string; mime: string; fileName: string; uploadedAt: string }
export interface ApprovalLog { stage: string; decision: 'submit' | 'approve' | 'return' | 'reject' | 'resubmit' | 'cancel'; byName: string; at: string; note: string | null }
export interface HistoryEntry { action: string; note: string | null; byName: string; at: string }
export interface InvoiceItem { label: string; amount: number }

// ---------------- الإعدادات ----------------

/** إعدادات العضوية لكل جمعية: الأنواع والشروط واللائحة والنموذج والمراحل والدفع والربط المالي والتجديد */
@Entity('mem_settings')
export class MemSettings {
  @PrimaryColumn({ name: 'organization_id', type: 'uuid' })
  organizationId!: string;

  /** صفحة التقديم العامة /m/<معرف الشركة> */
  @Column({ name: 'public_enabled', type: 'boolean', default: true })
  publicEnabled!: boolean;

  /** نبذة ترحيبية في الصفحة العامة */
  @Column({ type: 'text', nullable: true })
  intro!: string | null;

  @Column({ type: 'jsonb', default: () => `'[]'` })
  types!: MembershipType[];

  @Column({ type: 'jsonb', default: () => `'[]'` })
  conditions!: MembershipCondition[];

  @Column({ type: 'jsonb', default: () => `'{}'` })
  regulation!: Regulation;

  @Column({ name: 'application_fields', type: 'jsonb', default: () => `'[]'` })
  applicationFields!: FormField[];

  @Column({ type: 'jsonb', default: () => `'[]'` })
  documents!: DocumentRequirement[];

  @Column({ type: 'jsonb', default: () => `'[]'` })
  stages!: ApprovalStage[];

  @Column({ type: 'jsonb', default: () => `'{}'` })
  payment!: PaymentConfig;

  @Column({ type: 'jsonb', default: () => `'{}'` })
  accounting!: AccountingLink;

  @Column({ type: 'jsonb', default: () => `'{}'` })
  renewal!: RenewalConfig;

  @Column({ type: 'jsonb', default: () => `'{}'` })
  card!: CardConfig;

  @Column({ type: 'boolean', default: false })
  initialized!: boolean;

  @Column({ name: 'next_application_no', type: 'int', default: 1 })
  nextApplicationNo!: number;

  @Column({ name: 'next_member_no', type: 'int', default: 1 })
  nextMemberNo!: number;

  @Column({ name: 'next_invoice_no', type: 'int', default: 1 })
  nextInvoiceNo!: number;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}

/** البيانات الشخصية المشتركة بين الطلب والعضو */
abstract class PersonColumns {
  @Column({ name: 'full_name', length: 200 })
  fullName!: string;

  @Column({ name: 'national_id', length: 20 })
  nationalId!: string;

  @Column({ name: 'id_expiry', type: 'date', nullable: true })
  idExpiry!: string | null;

  @Column({ type: 'varchar', length: 60 })
  nationality!: string;

  @Column({ type: 'varchar', length: 10 })
  gender!: 'male' | 'female';

  @Column({ name: 'birth_date', type: 'date', nullable: true })
  birthDate!: string | null;

  @Column({ length: 20 })
  mobile!: string;

  @Column({ type: 'varchar', length: 200, nullable: true })
  email!: string | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  city!: string | null;

  @Column({ type: 'varchar', length: 300, nullable: true })
  address!: string | null;

  @Column({ type: 'varchar', length: 150, nullable: true })
  occupation!: string | null;

  @Column({ type: 'varchar', length: 200, nullable: true })
  employer!: string | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  qualification!: string | null;

  /** إجابات الحقول الإضافية المعرّفة في الإعدادات */
  @Column({ type: 'jsonb', default: () => `'{}'` })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  answers!: Record<string, any>;

  /** صور الهوية والمستندات المرفقة */
  @Column({ type: 'jsonb', default: () => `'[]'` })
  documents!: StoredDoc[];
}

// ---------------- طلبات العضوية ----------------

@Entity('mem_applications')
@Index('UQ_mem_applications_org_no', ['organizationId', 'applicationNo'], { unique: true })
@Index('IDX_mem_applications_nid', ['organizationId', 'nationalId'])
export class MemApplication extends PersonColumns {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId!: string;

  @Column({ name: 'application_no', length: 30 })
  applicationNo!: string;

  @Column({ name: 'type_code', length: 40 })
  typeCode!: string;

  /** مفاتيح الشروط التي أقر بها المتقدم */
  @Column({ name: 'accepted_conditions', type: 'jsonb', default: () => `'[]'` })
  acceptedConditions!: string[];

  @Column({ type: 'varchar', length: 20, default: 'in_review' })
  status!: ApplicationStatus;

  @Column({ name: 'stage_index', type: 'int', default: 0 })
  stageIndex!: number;

  /** نسخة من مراحل الاعتماد وقت التقديم */
  @Column({ type: 'jsonb', default: () => `'[]'` })
  stages!: ApprovalStage[];

  @Column({ name: 'approval_log', type: 'jsonb', default: () => `'[]'` })
  approvalLog!: ApprovalLog[];

  /** public = من الصفحة العامة، staff = أدخله موظف */
  @Column({ type: 'varchar', length: 10, default: 'staff' })
  source!: 'public' | 'staff';

  /** رمز متابعة الطلب من الصفحة العامة */
  @Column({ name: 'track_code', length: 20 })
  trackCode!: string;

  @Column({ name: 'member_id', type: 'uuid', nullable: true })
  memberId!: string | null;

  @Column({ name: 'invoice_id', type: 'uuid', nullable: true })
  invoiceId!: string | null;

  @Column({ name: 'created_by_name', type: 'varchar', length: 200, nullable: true })
  createdByName!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}

// ---------------- سجل الأعضاء ----------------

@Entity('mem_members')
@Index('UQ_mem_members_org_no', ['organizationId', 'memberNo'], { unique: true })
@Index('UQ_mem_members_org_nid', ['organizationId', 'nationalId'], { unique: true })
@Index('UQ_mem_members_card', ['cardCode'], { unique: true })
export class MemMember extends PersonColumns {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId!: string;

  @Column({ name: 'member_no', type: 'int' })
  memberNo!: number;

  @Column({ name: 'type_code', length: 40 })
  typeCode!: string;

  /** الحالة المسجلة؛ انتهاء العضوية يُحسب من تاريخ النهاية */
  @Column({ type: 'varchar', length: 20, default: 'active' })
  status!: MemberStatus;

  /** تاريخ الانضمام الأول (يُحسب منه حق التصويت) */
  @Column({ name: 'joined_on', type: 'date' })
  joinedOn!: string;

  /** بداية مدة العضوية الحالية ونهايتها */
  @Column({ name: 'start_date', type: 'date' })
  startDate!: string;

  @Column({ name: 'end_date', type: 'date' })
  endDate!: string;

  @Column({ name: 'application_id', type: 'uuid', nullable: true })
  applicationId!: string | null;

  /** رمز التحقق من بطاقة العضوية */
  @Column({ name: 'card_code', length: 20 })
  cardCode!: string;

  @Column({ name: 'status_note', type: 'varchar', length: 1000, nullable: true })
  statusNote!: string | null;

  /** application = من طلب معتمد، direct = عضو قائم أُدخل مباشرة */
  @Column({ type: 'varchar', length: 12, default: 'application' })
  source!: 'application' | 'direct';

  /** سجل العضو: الانضمام والتجديد وتغيير النوع والحالة */
  @Column({ type: 'jsonb', default: () => `'[]'` })
  history!: HistoryEntry[];

  @Column({ name: 'created_by_name', type: 'varchar', length: 200, nullable: true })
  createdByName!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}

// ---------------- المطالبات والمدفوعات ----------------

/** مطالبة اشتراك: للعضوية الجديدة بعد اعتماد الطلب، أو للتجديد. تُسدد إلكترونيًا أو بتحويل أو نقدًا */
@Entity('mem_invoices')
@Index('UQ_mem_invoices_org_no', ['organizationId', 'invoiceNo'], { unique: true })
@Index('UQ_mem_invoices_token', ['payToken'], { unique: true })
@Index('IDX_mem_invoices_member', ['organizationId', 'memberId'])
export class MemInvoice {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId!: string;

  @Column({ name: 'invoice_no', length: 30 })
  invoiceNo!: string;

  @Column({ type: 'varchar', length: 10 })
  kind!: InvoiceKind;

  @Column({ name: 'member_id', type: 'uuid', nullable: true })
  memberId!: string | null;

  @Column({ name: 'application_id', type: 'uuid', nullable: true })
  applicationId!: string | null;

  @Column({ name: 'type_code', length: 40 })
  typeCode!: string;

  @Column({ name: 'party_name', length: 200 })
  partyName!: string;

  @Column({ name: 'national_id', length: 20 })
  nationalId!: string;

  @Column({ length: 20 })
  mobile!: string;

  @Column({ type: 'jsonb', default: () => `'[]'` })
  items!: InvoiceItem[];

  @Column({ type: 'numeric', precision: 12, scale: 2, transformer: num })
  amount!: number;

  @Column({ name: 'due_date', type: 'date' })
  dueDate!: string;

  @Column({ type: 'varchar', length: 20, default: 'unpaid' })
  status!: InvoiceStatus;

  /** رمز رابط السداد العام */
  @Column({ name: 'pay_token', length: 40 })
  payToken!: string;

  @Column({ type: 'varchar', length: 10, nullable: true })
  method!: PayMethod | null;

  @Column({ name: 'paid_on', type: 'date', nullable: true })
  paidOn!: string | null;

  @Column({ name: 'paid_at', type: 'timestamptz', nullable: true })
  paidAt!: Date | null;

  /** مدة العضوية التي غطتها المطالبة (تُحدد عند السداد) */
  @Column({ name: 'period_start', type: 'date', nullable: true })
  periodStart!: string | null;

  @Column({ name: 'period_end', type: 'date', nullable: true })
  periodEnd!: string | null;

  /** رقم العملية في بوابة الدفع */
  @Column({ name: 'gateway_id', type: 'varchar', length: 120, nullable: true })
  gatewayId!: string | null;

  @Column({ name: 'gateway_url', type: 'varchar', length: 500, nullable: true })
  gatewayUrl!: string | null;

  /** إيصال التحويل البنكي الذي رفعه العضو */
  @Column({ name: 'transfer_receipt', type: 'jsonb', nullable: true })
  transferReceipt!: { fileKey: string; mime: string; fileName: string; reference: string | null; uploadedAt: string } | null;

  /** مرجع السداد: رقم العملية أو الحوالة أو الإيصال */
  @Column({ name: 'payment_ref', type: 'varchar', length: 120, nullable: true })
  paymentRef!: string | null;

  @Column({ name: 'received_by_name', type: 'varchar', length: 200, nullable: true })
  receivedByName!: string | null;

  /** سند القبض في النظام المالي */
  @Column({ name: 'voucher_id', type: 'uuid', nullable: true })
  voucherId!: string | null;

  /** سبب تعذر إنشاء سند القبض (مثل عدم اكتمال الربط المالي) ليعاد المحاولة لاحقًا */
  @Column({ name: 'voucher_error', type: 'varchar', length: 500, nullable: true })
  voucherError!: string | null;

  @Column({ type: 'varchar', length: 1000, nullable: true })
  note!: string | null;

  @Column({ name: 'created_by_name', type: 'varchar', length: 200, nullable: true })
  createdByName!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}

// ---------------- التنبيهات ----------------

/** سجل تنبيهات قرب انتهاء العضوية والتجديد المرسلة لكل عضو */
@Entity('mem_notices')
@Index('IDX_mem_notices_member', ['organizationId', 'memberId'])
export class MemNotice {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId!: string;

  @Column({ name: 'member_id', type: 'uuid' })
  memberId!: string;

  @Column({ name: 'invoice_id', type: 'uuid', nullable: true })
  invoiceId!: string | null;

  /** whatsapp أو sms أو email أو call، وauto لما ينشئه النظام تلقائيًا */
  @Column({ type: 'varchar', length: 20 })
  channel!: string;

  /** الأيام المتبقية على الانتهاء وقت التنبيه (سالب = بعد الانتهاء) */
  @Column({ name: 'days_left', type: 'int' })
  daysLeft!: number;

  @Column({ type: 'text' })
  message!: string;

  @Column({ name: 'sent_by_name', type: 'varchar', length: 200 })
  sentByName!: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}

export const MEMBERS_ENTITIES = [MemSettings, MemApplication, MemMember, MemInvoice, MemNotice];
