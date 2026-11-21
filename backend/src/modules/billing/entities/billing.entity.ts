import { Column, CreateDateColumn, Entity, Index, PrimaryColumn, PrimaryGeneratedColumn, UpdateDateColumn, ValueTransformer } from 'typeorm';

const num: ValueTransformer = {
  to: (v?: number | null) => v,
  from: (v?: string | null) => (v === null || v === undefined ? null : Number(v)),
};
const money = (name: string) => ({ name, type: 'numeric' as const, precision: 16, scale: 2, transformer: num, default: 0 });

// ---------------- القوائم الثابتة ----------------

/**
 * وضع الجمعية في الفوترة:
 * - off: النظام غير مفعّل، ولا تصدر فواتير.
 * - unregistered: غير مسجلة في ضريبة القيمة المضافة، فتصدر فواتير عادية بلا ضريبة.
 * - registered: مسجلة، فتصدر فواتير ضريبية برمز QR (المرحلة الأولى) دون إرسال للهيئة.
 * - integrated: مربوطة بمنصة «فاتورة» (المرحلة الثانية)، ويُفعّل بعد اكتمال الربط.
 */
export const BILLING_MODES = {
  off: 'غير مفعّل', unregistered: 'غير مسجلة في ضريبة القيمة المضافة', registered: 'مسجلة في الضريبة (فواتير إلكترونية برمز QR)', integrated: 'مربوطة بمنصة «فاتورة»',
} as const;
export type BillingMode = keyof typeof BILLING_MODES;

/** نوع المعرّف الآخر للبائع أو المشتري حسب قائمة الهيئة */
export const ID_TYPES = {
  CRN: 'السجل التجاري', MOM: 'ترخيص وزارة الموارد البشرية', MLS: 'ترخيص وزارة الشؤون البلدية', SAG: 'ترخيص الاستثمار', '700': 'الرقم الموحد (700)', OTH: 'معرّف آخر (مثل ترخيص الجمعية)',
  NAT: 'الهوية الوطنية', IQA: 'الإقامة', PAS: 'جواز السفر', GCC: 'هوية مواطن خليجي', TIN: 'الرقم المميز',
} as const;
export type IdType = keyof typeof ID_TYPES;
/** معرفات البائع (المنشأة) المسموحة */
export const SELLER_ID_TYPES: IdType[] = ['CRN', 'MOM', 'MLS', 'SAG', '700', 'OTH'];

/** فئات ضريبة القيمة المضافة حسب الهيئة */
export const VAT_CATEGORIES = { S: 'خاضع بالنسبة الأساسية', Z: 'خاضع بنسبة صفر', E: 'معفى من الضريبة', O: 'خارج نطاق الضريبة' } as const;
export type VatCategory = keyof typeof VAT_CATEGORIES;

/** أسباب الإعفاء والنسبة الصفرية وخارج النطاق (قائمة الهيئة) */
export const VAT_REASONS: Record<string, { category: VatCategory; label: string }> = {
  'VATEX-SA-29': { category: 'E', label: 'الخدمات المالية' },
  'VATEX-SA-29-7': { category: 'E', label: 'عقد تأمين على الحياة' },
  'VATEX-SA-30': { category: 'E', label: 'التوريدات العقارية (التأجير السكني)' },
  'VATEX-SA-32': { category: 'Z', label: 'صادرات السلع من المملكة' },
  'VATEX-SA-33': { category: 'Z', label: 'صادرات الخدمات من المملكة' },
  'VATEX-SA-34-1': { category: 'Z', label: 'النقل الدولي للسلع' },
  'VATEX-SA-34-2': { category: 'Z', label: 'النقل الدولي للركاب' },
  'VATEX-SA-34-3': { category: 'Z', label: 'خدمات مرتبطة بالنقل الدولي للركاب' },
  'VATEX-SA-34-4': { category: 'Z', label: 'توريد وسائل النقل المؤهلة' },
  'VATEX-SA-34-5': { category: 'Z', label: 'خدمات مرتبطة بنقل السلع أو الركاب' },
  'VATEX-SA-35': { category: 'Z', label: 'الأدوية والمعدات الطبية' },
  'VATEX-SA-36': { category: 'Z', label: 'المعادن المؤهلة' },
  'VATEX-SA-EDU': { category: 'Z', label: 'الخدمات التعليمية الخاصة للمواطنين' },
  'VATEX-SA-HEA': { category: 'Z', label: 'الخدمات الصحية الخاصة للمواطنين' },
  'VATEX-SA-MLTRY': { category: 'Z', label: 'توريد السلع العسكرية المؤهلة' },
  'VATEX-SA-OOS': { category: 'O', label: 'خارج نطاق الضريبة' },
};

export const ITEM_KINDS = { product: 'منتج', service: 'خدمة' } as const;
export type ItemKind = keyof typeof ITEM_KINDS;

export const CUSTOMER_KINDS = { individual: 'فرد', business: 'منشأة' } as const;
export type CustomerKind = keyof typeof CUSTOMER_KINDS;

export const DOC_KINDS = { invoice: 'فاتورة', credit_note: 'إشعار دائن', debit_note: 'إشعار مدين' } as const;
export type DocKind = keyof typeof DOC_KINDS;

/**
 * نوع الفاتورة:
 * - standard: فاتورة ضريبية للمنشآت (B2B)، وفي المرحلة الثانية تُرسل للهيئة قبل تسليمها.
 * - simplified: فاتورة ضريبية مبسطة للأفراد (B2C)، وفي المرحلة الثانية تُبلّغ خلال 24 ساعة.
 * - nontax: فاتورة عادية لجمعية غير مسجلة في الضريبة.
 */
export const DOC_TYPES = { standard: 'فاتورة ضريبية', simplified: 'فاتورة ضريبية مبسطة', nontax: 'فاتورة' } as const;
export type DocType = keyof typeof DOC_TYPES;

/** دورة المستند: مسودة ← بانتظار الإصدار ← صادرة (لا تُعدل ولا تُحذف بعدها، والتصحيح بإشعار) ← محصلة جزئيًا أو بالكامل */
export const DOC_STATUS = {
  draft: 'مسودة', pending: 'بانتظار الإصدار', issued: 'صادرة', partial: 'محصلة جزئيًا', paid: 'محصلة', cancelled: 'ملغاة',
} as const;
export type DocStatus = keyof typeof DOC_STATUS;
/** المستندات الصادرة (لها قيد ورقم في السلسلة) */
export const ISSUED: DocStatus[] = ['issued', 'partial', 'paid'];

/** أسباب الإشعار الدائن أو المدين (يُختار منها أو يُكتب سبب آخر) */
export const NOTE_REASONS = [
  'إرجاع سلع أو إلغاء جزء من الخدمة',
  'خصم بعد الإصدار',
  'تعديل السعر أو الكمية',
  'خطأ في الفاتورة الأصلية',
  'إلغاء التوريد',
  'رسوم إضافية بعد الإصدار',
];

export interface LogEntry { action: string; note: string | null; byName: string; at: string }

/** عنوان وطني سعودي */
export interface NationalAddress {
  street: string | null; buildingNo: string | null; additionalNo: string | null; district: string | null; city: string | null; postalCode: string | null; country: string;
}

/** بيانات المشتري كما كانت لحظة الإصدار (لا تتغير بتعديل ملف العميل لاحقًا) */
export interface BuyerSnapshot {
  name: string; kind: CustomerKind; vatNumber: string | null; idType: IdType | null; idNumber: string | null; address: NationalAddress | null; phone: string | null; email: string | null;
}

/** سطر في المستند: المبالغ بعد الخصم وقبل الضريبة */
export interface DocLine {
  id: string;
  itemId: string | null;
  description: string;
  unit: string | null;
  qty: number;
  unitPrice: number;
  /** خصم السطر (مبلغ قبل الضريبة) */
  discount: number;
  /** الصافي الخاضع = الكمية × السعر − الخصم */
  net: number;
  category: VatCategory;
  rate: number;
  /** سبب الإعفاء أو الصفر أو خارج النطاق */
  reasonCode: string | null;
  reasonText: string | null;
  vat: number;
  total: number;
  revenueAccountId: string;
  /** السطر المقابل في الفاتورة الأصلية (للإشعار الدائن) */
  refLineId: string | null;
}

/** ملخص الضريبة لكل فئة ونسبة */
export interface VatBreakdown { category: VatCategory; rate: number; reasonCode: string | null; reasonText: string | null; taxable: number; vat: number }

// ---------------- الجداول ----------------

/** إعدادات الفوترة لكل جمعية (صف واحد) */
@Entity('bl_settings')
export class BlSettings {
  @PrimaryColumn({ name: 'organization_id', type: 'uuid' })
  organizationId!: string;

  @Column({ type: 'varchar', length: 16, default: 'off' })
  mode!: BillingMode;

  /** اسم البائع كما في السجل الضريبي */
  @Column({ name: 'seller_name', type: 'varchar', length: 250, nullable: true })
  sellerName!: string | null;

  @Column({ name: 'seller_name_en', type: 'varchar', length: 250, nullable: true })
  sellerNameEn!: string | null;

  /** الرقم الضريبي (15 رقمًا يبدأ وينتهي بـ 3) */
  @Column({ name: 'vat_number', type: 'varchar', length: 15, nullable: true })
  vatNumber!: string | null;

  @Column({ name: 'id_type', type: 'varchar', length: 4, nullable: true })
  idType!: IdType | null;

  @Column({ name: 'id_number', type: 'varchar', length: 40, nullable: true })
  idNumber!: string | null;

  @Column({ type: 'jsonb', nullable: true })
  address!: NationalAddress | null;

  /** نسبة الضريبة الأساسية */
  @Column({ name: 'vat_rate', type: 'numeric', precision: 5, scale: 2, transformer: num, default: 15 })
  vatRate!: number;

  @Column({ name: 'receivables_account_id', type: 'uuid', nullable: true })
  receivablesAccountId!: string | null;

  @Column({ name: 'vat_output_account_id', type: 'uuid', nullable: true })
  vatOutputAccountId!: string | null;

  @Column({ name: 'revenue_account_id', type: 'uuid', nullable: true })
  revenueAccountId!: string | null;

  /** تصنيف العملاء في النظام المالي (لإنشاء الشريك المقابل للعميل) */
  @Column({ name: 'customer_category_id', type: 'uuid', nullable: true })
  customerCategoryId!: string | null;

  /** مركز التكلفة الافتراضي لإيرادات المبيعات (اختياري) */
  @Column({ name: 'analytic_id', type: 'uuid', nullable: true })
  analyticId!: string | null;

  @Column({ name: 'payment_days', type: 'int', default: 30 })
  paymentDays!: number;

  /** شروط وملاحظات تطبع أسفل الفاتورة */
  @Column({ type: 'varchar', length: 2000, nullable: true })
  terms!: string | null;

  @Column({ type: 'jsonb', default: () => `'[]'` })
  log!: LogEntry[];

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}

/** العملاء (المشترون) */
@Entity('bl_customers')
@Index('UQ_bl_customers_no', ['organizationId', 'customerNo'], { unique: true })
export class BlCustomer {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index('IDX_bl_customers_org')
  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId!: string;

  @Column({ name: 'customer_no', type: 'int' })
  customerNo!: number;

  @Column({ type: 'varchar', length: 12, default: 'individual' })
  kind!: CustomerKind;

  @Column({ length: 250 })
  name!: string;

  @Column({ name: 'name_en', type: 'varchar', length: 250, nullable: true })
  nameEn!: string | null;

  @Column({ name: 'vat_number', type: 'varchar', length: 15, nullable: true })
  vatNumber!: string | null;

  @Column({ name: 'id_type', type: 'varchar', length: 4, nullable: true })
  idType!: IdType | null;

  @Column({ name: 'id_number', type: 'varchar', length: 40, nullable: true })
  idNumber!: string | null;

  @Column({ type: 'jsonb', nullable: true })
  address!: NationalAddress | null;

  @Column({ type: 'varchar', length: 20, nullable: true })
  phone!: string | null;

  @Column({ type: 'varchar', length: 200, nullable: true })
  email!: string | null;

  /** الشريك المقابل في النظام المالي (حساب الذمم) */
  @Column({ name: 'partner_id', type: 'uuid', nullable: true })
  partnerId!: string | null;

  @Column({ name: 'is_active', default: true })
  isActive!: boolean;

  @Column({ type: 'varchar', length: 1000, nullable: true })
  notes!: string | null;

  @Column({ type: 'jsonb', default: () => `'[]'` })
  log!: LogEntry[];

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}

/** الأصناف والخدمات التي تبيعها الجمعية */
@Entity('bl_items')
@Index('UQ_bl_items_code', ['organizationId', 'code'], { unique: true })
export class BlItem {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index('IDX_bl_items_org')
  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId!: string;

  @Column({ length: 30 })
  code!: string;

  @Column({ length: 250 })
  name!: string;

  @Column({ name: 'name_en', type: 'varchar', length: 250, nullable: true })
  nameEn!: string | null;

  @Column({ type: 'varchar', length: 10, default: 'service' })
  kind!: ItemKind;

  @Column({ type: 'varchar', length: 40, nullable: true })
  unit!: string | null;

  /** سعر الوحدة قبل الضريبة */
  @Column(money('price'))
  price!: number;

  @Column({ name: 'vat_category', type: 'varchar', length: 1, default: 'S' })
  vatCategory!: VatCategory;

  @Column({ name: 'reason_code', type: 'varchar', length: 20, nullable: true })
  reasonCode!: string | null;

  @Column({ name: 'revenue_account_id', type: 'uuid', nullable: true })
  revenueAccountId!: string | null;

  @Column({ name: 'is_active', default: true })
  isActive!: boolean;

  /** سجل التعديلات بالقيم قبل وبعد (السعر والفئة الضريبية والحساب تؤثر على الضريبة والقيود) */
  @Column({ type: 'jsonb', default: () => `'[]'` })
  log!: LogEntry[];

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}

/** الفواتير والإشعارات الدائنة والمدينة (رقم واحد مسلسل لكل مستندات الجمعية) */
@Entity('bl_documents')
@Index('UQ_bl_documents_no', ['organizationId', 'docNo'], { unique: true })
@Index('IDX_bl_documents_customer', ['organizationId', 'customerId', 'status'])
@Index('IDX_bl_documents_ref', ['organizationId', 'refId'])
@Index('UQ_bl_documents_icv', ['organizationId', 'icv'], { unique: true, where: 'icv IS NOT NULL' })
@Index('UQ_bl_documents_uuid', ['uuid'], { unique: true, where: 'uuid IS NOT NULL' })
export class BlDocument {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId!: string;

  /** رقم المستند المسلسل (يُحجز عند الإنشاء ولا يُعاد استخدامه) */
  @Column({ name: 'doc_no', type: 'int' })
  docNo!: number;

  @Column({ type: 'varchar', length: 12, default: 'invoice' })
  kind!: DocKind;

  @Column({ name: 'doc_type', type: 'varchar', length: 12 })
  docType!: DocType;

  /** المعرّف الفريد للمستند (UUID) يُسند عند الإصدار */
  @Column({ type: 'uuid', nullable: true })
  uuid!: string | null;

  /** عداد المستندات الصادرة (لا ينقطع ولا يُعاد ضبطه) */
  @Column({ type: 'int', nullable: true })
  icv!: number | null;

  @Column({ name: 'customer_id', type: 'uuid', nullable: true })
  customerId!: string | null;

  /** بيانات المشتري لحظة الإصدار (أو المسودة) */
  @Column({ type: 'jsonb', nullable: true })
  buyer!: BuyerSnapshot | null;

  /** الفاتورة الأصلية (للإشعار الدائن أو المدين) */
  @Column({ name: 'ref_id', type: 'uuid', nullable: true })
  refId!: string | null;

  /** سبب الإشعار */
  @Column({ type: 'varchar', length: 500, nullable: true })
  reason!: string | null;

  @Column({ name: 'issue_date', type: 'date' })
  issueDate!: string;

  /** تاريخ التوريد (إن اختلف عن تاريخ الإصدار) */
  @Column({ name: 'supply_date', type: 'date', nullable: true })
  supplyDate!: string | null;

  @Column({ name: 'due_date', type: 'date', nullable: true })
  dueDate!: string | null;

  @Column({ type: 'jsonb', default: () => `'[]'` })
  lines!: DocLine[];

  @Column({ type: 'jsonb', default: () => `'[]'` })
  breakdown!: VatBreakdown[];

  /** مجموع الكمية × السعر قبل الخصم */
  @Column(money('gross'))
  gross!: number;

  @Column(money('discount'))
  discount!: number;

  /** الصافي قبل الضريبة */
  @Column(money('taxable'))
  taxable!: number;

  @Column(money('vat'))
  vat!: number;

  @Column(money('total'))
  total!: number;

  @Column({ type: 'varchar', length: 10, default: 'draft' })
  status!: DocStatus;

  /** مركز التكلفة لإيرادات المستند (اختياري) */
  @Column({ name: 'analytic_id', type: 'uuid', nullable: true })
  analyticId!: string | null;

  /** نص رمز QR (TLV بترميز Base64) */
  @Column({ type: 'text', nullable: true })
  qr!: string | null;

  /** وضع الجمعية وقت الإصدار */
  @Column({ name: 'issued_mode', type: 'varchar', length: 16, nullable: true })
  issuedMode!: BillingMode | null;

  /** بيانات البائع لحظة الإصدار */
  @Column({ type: 'jsonb', nullable: true })
  seller!: { name: string; nameEn: string | null; vatNumber: string | null; idType: IdType | null; idNumber: string | null; address: NationalAddress | null } | null;

  @Column({ name: 'entry_id', type: 'uuid', nullable: true })
  entryId!: string | null;

  /** المحصّل بسندات القبض المعتمدة */
  @Column(money('paid_amount'))
  paidAmount!: number;

  /** مجموع الإشعارات الدائنة الصادرة على الفاتورة */
  @Column(money('credited_amount'))
  creditedAmount!: number;

  /** مجموع الإشعارات المدينة الصادرة على الفاتورة */
  @Column(money('debited_amount'))
  debitedAmount!: number;

  @Column({ type: 'varchar', length: 2000, nullable: true })
  notes!: string | null;

  @Column({ name: 'return_reason', type: 'varchar', length: 1000, nullable: true })
  returnReason!: string | null;

  @Column({ name: 'created_by_id', type: 'uuid', nullable: true })
  createdById!: string | null;

  @Column({ name: 'created_by_name', type: 'varchar', length: 200 })
  createdByName!: string;

  /** كل من عدّل المستند أو أرسله (لا يصدره أحد منهم: فصل المهام) */
  @Column({ name: 'editor_ids', type: 'jsonb', default: () => `'[]'` })
  editorIds!: string[];

  @Column({ name: 'issued_by_id', type: 'uuid', nullable: true })
  issuedById!: string | null;

  @Column({ name: 'issued_by_name', type: 'varchar', length: 200, nullable: true })
  issuedByName!: string | null;

  /** وقت الإصدار الفعلي (يظهر في رمز QR) */
  @Column({ name: 'issued_at', type: 'timestamptz', nullable: true })
  issuedAt!: Date | null;

  @Column({ type: 'jsonb', default: () => `'[]'` })
  log!: LogEntry[];

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}

export const BILLING_ENTITIES = [BlSettings, BlCustomer, BlItem, BlDocument];
