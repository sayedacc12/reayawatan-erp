import { Column, CreateDateColumn, Entity, Index, PrimaryColumn, PrimaryGeneratedColumn, UpdateDateColumn, ValueTransformer } from 'typeorm';

/** PostgreSQL يرجّع numeric كنص؛ نحوله لرقم */
const num: ValueTransformer = {
  to: (v?: number | null) => v,
  from: (v?: string | null) => (v === null || v === undefined ? null : Number(v)),
};
const qty = (name: string, nullable = true) => ({
  name, type: 'numeric' as const, precision: 14, scale: 3, transformer: num, nullable, ...(nullable ? {} : { default: 0 }),
});

// ---------------- القوائم الثابتة ----------------

export const ITEM_KINDS = {
  stock: 'صنف مخزني', consumable: 'مستهلكات تُصرف مباشرة', asset: 'أصل ثابت', service: 'خدمة',
} as const;
export type ItemKind = keyof typeof ITEM_KINDS;

export const VALUATION = { avg: 'المتوسط المرجح', fifo: 'الوارد أولًا يُصرف أولًا' } as const;
export type Valuation = keyof typeof VALUATION;

export const ISSUE_POLICY = { fifo: 'الأقدم استلامًا أولًا', fefo: 'الأقرب انتهاءً أولًا' } as const;
export type IssuePolicy = keyof typeof ISSUE_POLICY;

export const WAREHOUSE_KINDS = { main: 'رئيسي', sub: 'فرعي', field: 'ميداني', temporary: 'مؤقت' } as const;
export type WarehouseKind = keyof typeof WAREHOUSE_KINDS;

export const LOCATION_KINDS = { zone: 'منطقة', aisle: 'ممر', rack: 'رف', shelf: 'رف فرعي', bin: 'خانة' } as const;
export type LocationKind = keyof typeof LOCATION_KINDS;

export const LOCATION_PURPOSE = {
  storage: 'تخزين عادي', receiving: 'استلام وفحص', reserved: 'مواد محجوزة', returns: 'مرتجعات', damaged: 'تالف', quarantine: 'عزل وتحفظ',
} as const;
export type LocationPurpose = keyof typeof LOCATION_PURPOSE;

export const ENTITY_TYPES = {
  company: 'شركة', establishment: 'مؤسسة فردية', individual: 'فرد (مستقل)', government: 'جهة حكومية', nonprofit: 'جهة غير ربحية',
} as const;
export type EntityType = keyof typeof ENTITY_TYPES;

export const SUPPLIER_KINDS = { supplier: 'مورد مواد', service_provider: 'مزود خدمة', both: 'مورد ومزود خدمة' } as const;
export type SupplierKind = keyof typeof SUPPLIER_KINDS;

export const SUPPLIER_STATUS = {
  draft: 'تسجيل لم يُرسل', pending: 'بانتظار المراجعة', returned: 'معاد للاستكمال', approved: 'معتمد', rejected: 'مرفوض', suspended: 'موقوف',
} as const;
export type SupplierStatus = keyof typeof SUPPLIER_STATUS;

export const DOC_STATUS = { pending: 'بانتظار المراجعة', accepted: 'مقبول', rejected: 'مرفوض' } as const;
export type DocStatus = keyof typeof DOC_STATUS;

export const BANK_STATUS = { pending: 'بانتظار الاعتماد', approved: 'معتمد', rejected: 'مرفوض', inactive: 'غير مستخدم' } as const;
export type BankStatus = keyof typeof BANK_STATUS;

export const PORTAL_ROLES = {
  owner: 'مدير الحساب', sales: 'المبيعات والعروض', finance: 'المالية والفواتير', viewer: 'اطلاع فقط',
} as const;
export type PortalRole = keyof typeof PORTAL_ROLES;

/** نوع مستند مطلوب من الموردين (السجل التجاري، شهادة الزكاة ...) */
export interface SupplierDocType {
  key: string;
  name: string;
  /** إلزامي قبل إرسال طلب التسجيل */
  required: boolean;
  /** له تاريخ انتهاء يُتابع ويُنبَّه قبله */
  hasExpiry: boolean;
  /** أنواع الكيانات التي يُطلب منها (فارغ = الكل) */
  entityTypes: EntityType[];
  isActive: boolean;
}

export interface LogEntry { action: string; note: string | null; byName: string; at: string }

// ---------------- الإعدادات ----------------

/** إعدادات المشتريات والمستودعات لكل جمعية */
@Entity('pr_settings')
export class PrSettings {
  @PrimaryColumn({ name: 'organization_id', type: 'uuid' }) organizationId!: string;
  /** طريقة التقييم الافتراضية للمخزون */
  @Column({ type: 'varchar', length: 6, default: 'avg' }) valuation!: Valuation;
  /** حسابات المخزون تُحدد على مستوى: group مجموعة الأصناف، warehouse المستودع */
  @Column({ name: 'account_level', type: 'varchar', length: 10, default: 'group' }) accountLevel!: 'group' | 'warehouse';
  /** التنبيه قبل انتهاء مستندات الموردين بهذا العدد من الأيام */
  @Column({ name: 'doc_alert_days', type: 'int', default: 30 }) docAlertDays!: number;
  @Column({ name: 'supplier_doc_types', type: 'jsonb', default: () => `'[]'` }) supplierDocTypes!: SupplierDocType[];
  /** الأنشطة والخدمات التي يختار منها المورد */
  @Column({ type: 'jsonb', default: () => `'[]'` }) activities!: string[];
  /** بوابة الموردين مفتوحة للتسجيل الذاتي */
  @Column({ name: 'portal_open', default: true }) portalOpen!: boolean;
  /** نص ترحيبي في صفحة تسجيل الموردين */
  @Column({ name: 'portal_intro', type: 'text', nullable: true }) portalIntro!: string | null;
  /** تصنيف الشركاء في النظام المالي الذي يُنشأ فيه المورد المعتمد (سلوكه «مورد») */
  @Column({ name: 'partner_category_id', type: 'uuid', nullable: true }) partnerCategoryId!: string | null;
  /** حساب الدائنين الافتراضي للموردين في الدليل */
  @Column({ name: 'payables_account_id', type: 'uuid', nullable: true }) payablesAccountId!: string | null;
  /** حدود أسلوب الشراء بالقيمة التقديرية: حتى direct شراء مباشر، وحتى quotes طلب عروض أسعار، وما فوقه منافسة عامة */
  @Column({ name: 'method_limits', type: 'jsonb', default: () => `'{"direct": 10000, "quotes": 100000}'` }) methodLimits!: { direct: number; quotes: number };
  /** أقل عدد من الموردين المدعوين في طلب عروض الأسعار */
  @Column({ name: 'min_quotes', type: 'int', default: 3 }) minQuotes!: number;
  /** مصفوفة اعتماد التعميدات بالقيمة */
  @Column({ name: 'approval_levels', type: 'jsonb', default: () => `'[]'` }) approvalLevels!: { name: string; minAmount: number; permission: string }[];
  /** معايير تقييم العروض الافتراضية وأوزانها */
  @Column({ name: 'eval_criteria', type: 'jsonb', default: () => `'[]'` }) evalCriteria!: { key: string; name: string; weight: number; kind: 'price' | 'technical' }[];
  /** الحد الأدنى الافتراضي للدرجة الفنية */
  @Column({ name: 'technical_pass', type: 'int', default: 60 }) technicalPass!: number;
  /** الشروط العامة التي تُطبع في التعميد */
  @Column({ name: 'order_terms', type: 'text', nullable: true }) orderTerms!: string | null;
  /** إظهار اسم المورد الفائز لباقي المتنافسين في البوابة */
  @Column({ name: 'disclose_winner', default: false }) discloseWinner!: boolean;
  // ---- المستودعات (المرحلة الثالثة) ----
  /** حساب البضاعة المستلمة غير المفوترة (من الخصوم): يُقيد له الاستلام، ويُقفل عند قيد فاتورة المورد */
  @Column({ name: 'grni_account_id', type: 'uuid', nullable: true }) grniAccountId!: string | null;
  /** حساب فروقات الجرد والإتلاف والتسويات (من المصروفات) */
  @Column({ name: 'adjust_account_id', type: 'uuid', nullable: true }) adjustAccountId!: string | null;
  /** مركز التكلفة لقيود الفروقات والإتلاف (إن تطلبه الحساب) */
  @Column({ name: 'adjust_analytic_id', type: 'uuid', nullable: true }) adjustAnalyticId!: string | null;
  /** حساب التبرعات العينية (من الإيرادات): يُقيد له الاستلام بالقيمة العادلة */
  @Column({ name: 'donation_account_id', type: 'uuid', nullable: true }) donationAccountId!: string | null;
  /** الحساب المقابل للأرصدة الافتتاحية للمستودعات (من صافي الأصول) */
  @Column({ name: 'opening_account_id', type: 'uuid', nullable: true }) openingAccountId!: string | null;
  /** حساب المصروف الافتراضي للصرف والخدمات إن لم يُحدد للصنف أو مجموعته */
  @Column({ name: 'default_expense_account_id', type: 'uuid', nullable: true }) defaultExpenseAccountId!: string | null;
  /** التنبيه قبل انتهاء صلاحية الأصناف بهذا العدد من الأيام */
  @Column({ name: 'expiry_alert_days', type: 'int', default: 60 }) expiryAlertDays!: number;
  /** نسبة الزيادة المسموح استلامها عن كمية التعميد */
  @Column({ name: 'over_receipt_pct', type: 'int', default: 0 }) overReceiptPct!: number;
  /** ضريبة القيمة المضافة جزء من تكلفة الصنف (الجمعية غير مسجلة في الضريبة أو لا تسترد ضريبة المشتريات) */
  @Column({ name: 'vat_in_cost', default: true }) vatInCost!: boolean;
  /** فحص لجنة الاستلام إلزامي قبل اعتماد الاستلام */
  @Column({ name: 'require_inspection', default: false }) requireInspection!: boolean;

  // ---- الفواتير والمستحقات (المرحلة الرابعة) ----
  /** نسبة التجاوز المقبولة في سعر الفاتورة عن سعر التعميد قبل اعتبارها استثناء */
  @Column({ name: 'match_tolerance_pct', type: 'numeric', precision: 5, scale: 2, default: 0, transformer: { to: (v?: number | null) => v, from: (v?: string | null) => Number(v ?? 0) } }) matchTolerancePct!: number;
  /** حساب ضريبة المدخلات القابلة للاسترداد (إذا لم تكن الضريبة جزءًا من التكلفة) */
  @Column({ name: 'vat_input_account_id', type: 'uuid', nullable: true }) vatInputAccountId!: string | null;
  /** مدة السداد الافتراضية بالأيام من تاريخ الفاتورة */
  @Column({ name: 'payment_days', type: 'int', default: 30 }) paymentDays!: number;

  // ---- العقود وتقييم الموردين (المرحلة الخامسة) ----
  /** معايير تقييم الموردين وأوزانها، وكل معيار يقترح درجته من مؤشر محسوب */
  @Column({ name: 'supplier_criteria', type: 'jsonb', nullable: true }) supplierCriteria!: { key: string; name: string; weight: number; metric: string | null }[] | null;
  /** الحد الأدنى للتقديرات: ممتاز وجيد ومقبول، وما دونه ضعيف */
  @Column({ name: 'grade_limits', type: 'jsonb', nullable: true }) gradeLimits!: { A: number; B: number; C: number } | null;
  /** لا يُدعى المورد ذو التقدير الضعيف للمنافسات */
  @Column({ name: 'block_weak', default: false }) blockWeak!: boolean;
  /** مجالات المراجعة الداخلية المتعلقة بالمشتريات والمستودعات */
  @Column({ name: 'audit_area_ids', type: 'jsonb', default: () => `'[]'` }) auditAreaIds!: string[];
}

// ---------------- الأصناف ----------------

/** وحدة قياس (حبة، كرتون، كيلو، لتر ...) */
@Entity('pr_uoms')
@Index('IDX_pr_uoms_org', ['organizationId'])
export class PrUom {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ name: 'organization_id', type: 'uuid' }) organizationId!: string;
  @Column({ length: 60 }) name!: string;
  @Column({ type: 'varchar', length: 20, nullable: true }) symbol!: string | null;
  @Column({ name: 'sort_order', type: 'int', default: 0 }) sortOrder!: number;
  @Column({ name: 'is_active', default: true }) isActive!: boolean;
}

/** مجموعة أصناف بشجرة مستويات، وحساباتها في الدليل */
@Entity('pr_item_groups')
@Index('UQ_pr_item_groups_code', ['organizationId', 'code'], { unique: true })
export class PrItemGroup {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ name: 'organization_id', type: 'uuid' }) organizationId!: string;
  @Column({ name: 'parent_id', type: 'uuid', nullable: true }) parentId!: string | null;
  /** رمز المجموعة، ويدخل في ترميز أصنافها (مثل FOOD) */
  @Column({ length: 12 }) code!: string;
  @Column({ length: 150 }) name!: string;
  @Column({ type: 'varchar', length: 12, default: 'stock' }) kind!: ItemKind;
  /** حساب المخزون (من الأصول) لقيمة أصناف المجموعة */
  @Column({ name: 'inventory_account_id', type: 'uuid', nullable: true }) inventoryAccountId!: string | null;
  /** حساب المصروف عند الصرف أو الاستهلاك */
  @Column({ name: 'expense_account_id', type: 'uuid', nullable: true }) expenseAccountId!: string | null;
  /** مجموعة الأصول الثابتة لأصناف «أصل ثابت» */
  @Column({ name: 'asset_group_id', type: 'uuid', nullable: true }) assetGroupId!: string | null;
  /** طريقة التقييم (فارغة = إعداد الجمعية) */
  @Column({ type: 'varchar', length: 6, nullable: true }) valuation!: Valuation | null;
  @Column({ type: 'varchar', length: 500, nullable: true }) description!: string | null;
  @Column({ name: 'sort_order', type: 'int', default: 0 }) sortOrder!: number;
  @Column({ name: 'is_active', default: true }) isActive!: boolean;
}

/** وحدة بديلة للصنف: كم وحدة أساسية فيها (كرتون = 24 حبة) */
export interface ItemUnit { uomId: string; factor: number; barcode: string | null }
export interface ItemSpec { name: string; value: string }
export interface ItemFile { key: string; name: string; mime: string; size: number; at: string; byName: string }
/** صنف بديل أو مكافئ، يُعتمد قبل استخدامه */
export interface ItemAlternative { itemId: string; kind: 'alternative' | 'equivalent'; note: string | null; approvedByName: string; approvedAt: string }

/** الصنف في الدليل الموحد */
@Entity('pr_items')
@Index('UQ_pr_items_code', ['organizationId', 'code'], { unique: true })
@Index('UQ_pr_items_name', ['organizationId', 'nameKey'], { unique: true })
@Index('UQ_pr_items_barcode', ['organizationId', 'barcode'], { unique: true, where: 'barcode IS NOT NULL' })
@Index('IDX_pr_items_group', ['organizationId', 'groupId'])
export class PrItem {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ name: 'organization_id', type: 'uuid' }) organizationId!: string;
  @Column({ length: 30 }) code!: string;
  @Column({ length: 250 }) name!: string;
  /** الاسم بعد التوحيد (بلا تشكيل ولا همزات ولا مسافات زائدة) لمنع التكرار */
  @Column({ name: 'name_key', length: 250 }) nameKey!: string;
  @Column({ name: 'group_id', type: 'uuid' }) groupId!: string;
  @Column({ type: 'varchar', length: 12 }) kind!: ItemKind;
  @Column({ name: 'uom_id', type: 'uuid' }) uomId!: string;
  @Column({ type: 'jsonb', default: () => `'[]'` }) units!: ItemUnit[];
  @Column({ type: 'varchar', length: 60, nullable: true }) barcode!: string | null;
  @Column({ type: 'text', nullable: true }) description!: string | null;
  @Column({ type: 'jsonb', default: () => `'[]'` }) specs!: ItemSpec[];
  @Column({ name: 'track_batch', default: false }) trackBatch!: boolean;
  @Column({ name: 'track_serial', default: false }) trackSerial!: boolean;
  @Column({ name: 'track_expiry', default: false }) trackExpiry!: boolean;
  /** مدة الصلاحية المعتادة بالأيام */
  @Column({ name: 'shelf_life_days', type: 'int', nullable: true }) shelfLifeDays!: number | null;
  @Column(qty('min_qty')) minQty!: number | null;
  @Column(qty('max_qty')) maxQty!: number | null;
  @Column(qty('reorder_point')) reorderPoint!: number | null;
  @Column(qty('reorder_qty')) reorderQty!: number | null;
  @Column({ name: 'issue_policy', type: 'varchar', length: 6, default: 'fifo' }) issuePolicy!: IssuePolicy;
  /** طريقة التقييم (فارغة = إعداد المجموعة ثم الجمعية) */
  @Column({ type: 'varchar', length: 6, nullable: true }) valuation!: Valuation | null;
  /** حسابات خاصة بالصنف (فارغة = حسابات المجموعة) */
  @Column({ name: 'inventory_account_id', type: 'uuid', nullable: true }) inventoryAccountId!: string | null;
  @Column({ name: 'expense_account_id', type: 'uuid', nullable: true }) expenseAccountId!: string | null;
  /** آخر سعر شراء تقديري (يُحدّث من المشتريات لاحقًا) */
  @Column({ name: 'ref_price', type: 'numeric', precision: 14, scale: 2, transformer: num, nullable: true }) refPrice!: number | null;
  @Column({ name: 'image_key', type: 'varchar', length: 120, nullable: true }) imageKey!: string | null;
  @Column({ name: 'image_mime', type: 'varchar', length: 40, nullable: true }) imageMime!: string | null;
  @Column({ type: 'jsonb', default: () => `'[]'` }) attachments!: ItemFile[];
  @Column({ type: 'jsonb', default: () => `'[]'` }) alternatives!: ItemAlternative[];
  /** active نشط، stopped موقوف (يبقى بسجله التاريخي) */
  @Column({ type: 'varchar', length: 10, default: 'active' }) status!: 'active' | 'stopped';
  @Column({ name: 'stop_reason', type: 'varchar', length: 500, nullable: true }) stopReason!: string | null;
  /** الصنف البديل الذي حل محله عند الإيقاف */
  @Column({ name: 'replaced_by_id', type: 'uuid', nullable: true }) replacedById!: string | null;
  @Column({ type: 'jsonb', default: () => `'[]'` }) log!: LogEntry[];
  @Column({ name: 'created_by_name', length: 200 }) createdByName!: string;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt!: Date;
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' }) updatedAt!: Date;
}

// ---------------- المستودعات ----------------

/** المستودع (رئيسي أو فرعي أو ميداني أو مؤقت) */
@Entity('pr_warehouses')
@Index('UQ_pr_warehouses_code', ['organizationId', 'code'], { unique: true })
export class PrWarehouse {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ name: 'organization_id', type: 'uuid' }) organizationId!: string;
  @Column({ length: 20 }) code!: string;
  @Column({ length: 200 }) name!: string;
  @Column({ type: 'varchar', length: 10, default: 'main' }) kind!: WarehouseKind;
  /** المستودع الرئيسي الذي يتبعه (للفرعي والميداني) */
  @Column({ name: 'parent_id', type: 'uuid', nullable: true }) parentId!: string | null;
  /** الفرع أو الإدارة في الهيكل التنظيمي */
  @Column({ name: 'unit_id', type: 'uuid', nullable: true }) unitId!: string | null;
  /** المشروع المرتبط (للمستودعات الميدانية والمؤقتة) */
  @Column({ name: 'project_id', type: 'uuid', nullable: true }) projectId!: string | null;
  @Column({ type: 'varchar', length: 100, nullable: true }) city!: string | null;
  @Column({ type: 'varchar', length: 500, nullable: true }) address!: string | null;
  /** أمين المستودع ومساعدوه (مستخدمو الجمعية) */
  @Column({ name: 'keeper_ids', type: 'jsonb', default: () => `'[]'` }) keeperIds!: string[];
  /** حساب المخزون في الدليل (عند تحديد الحسابات على مستوى المستودع) */
  @Column({ name: 'gl_account_id', type: 'uuid', nullable: true }) glAccountId!: string | null;
  /** الطاقة التخزينية والقيود التشغيلية (مبردات، مواد خطرة ...) */
  @Column({ type: 'varchar', length: 500, nullable: true }) capacity!: string | null;
  @Column({ type: 'varchar', length: 1000, nullable: true }) notes!: string | null;
  @Column({ name: 'is_active', default: true }) isActive!: boolean;
  @Column({ type: 'jsonb', default: () => `'[]'` }) log!: LogEntry[];
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt!: Date;
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' }) updatedAt!: Date;
}

/** موقع تخزين داخل المستودع: منطقة ثم ممر ثم رف ثم خانة */
@Entity('pr_locations')
@Index('UQ_pr_locations_code', ['warehouseId', 'code'], { unique: true })
export class PrLocation {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ name: 'organization_id', type: 'uuid' }) organizationId!: string;
  @Column({ name: 'warehouse_id', type: 'uuid' }) warehouseId!: string;
  @Column({ name: 'parent_id', type: 'uuid', nullable: true }) parentId!: string | null;
  @Column({ length: 30 }) code!: string;
  @Column({ length: 150 }) name!: string;
  @Column({ type: 'varchar', length: 8, default: 'zone' }) kind!: LocationKind;
  @Column({ type: 'varchar', length: 12, default: 'storage' }) purpose!: LocationPurpose;
  @Column({ type: 'varchar', length: 200, nullable: true }) capacity!: string | null;
  @Column({ name: 'sort_order', type: 'int', default: 0 }) sortOrder!: number;
  @Column({ name: 'is_active', default: true }) isActive!: boolean;
}

// ---------------- الموردون ----------------

/** تصنيف الموردين (مواد غذائية، خدمات طبية، مقاولات ...) */
@Entity('pr_supplier_categories')
@Index('IDX_pr_supplier_categories_org', ['organizationId'])
export class PrSupplierCategory {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ name: 'organization_id', type: 'uuid' }) organizationId!: string;
  @Column({ length: 120 }) name!: string;
  @Column({ type: 'varchar', length: 500, nullable: true }) description!: string | null;
  @Column({ type: 'varchar', length: 9, default: '#0f766e' }) color!: string;
  @Column({ name: 'sort_order', type: 'int', default: 0 }) sortOrder!: number;
  @Column({ name: 'is_active', default: true }) isActive!: boolean;
}

export interface SupplierContact { name: string; title: string | null; phone: string | null; email: string | null; authorized: boolean }
export interface SupplierBranch { name: string; city: string | null; address: string | null; phone: string | null }

/** المورد أو مزود الخدمة */
@Entity('pr_suppliers')
@Index('UQ_pr_suppliers_no', ['organizationId', 'supplierNo'], { unique: true })
@Index('UQ_pr_suppliers_cr', ['organizationId', 'crNumber'], { unique: true, where: 'cr_number IS NOT NULL' })
@Index('UQ_pr_suppliers_vat', ['organizationId', 'vatNumber'], { unique: true, where: 'vat_number IS NOT NULL' })
@Index('IDX_pr_suppliers_status', ['organizationId', 'status'])
export class PrSupplier {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ name: 'organization_id', type: 'uuid' }) organizationId!: string;
  @Column({ name: 'supplier_no', type: 'int' }) supplierNo!: number;
  @Column({ length: 250 }) name!: string;
  @Column({ name: 'name_en', type: 'varchar', length: 250, nullable: true }) nameEn!: string | null;
  @Column({ name: 'entity_type', type: 'varchar', length: 14, default: 'company' }) entityType!: EntityType;
  @Column({ name: 'supplier_kind', type: 'varchar', length: 16, default: 'supplier' }) supplierKind!: SupplierKind;
  @Column({ name: 'category_ids', type: 'jsonb', default: () => `'[]'` }) categoryIds!: string[];
  @Column({ type: 'jsonb', default: () => `'[]'` }) activities!: string[];
  /** وصف الخدمات والمنتجات التي يقدمها */
  @Column({ type: 'text', nullable: true }) about!: string | null;
  @Column({ name: 'cr_number', type: 'varchar', length: 20, nullable: true }) crNumber!: string | null;
  @Column({ name: 'cr_expiry', type: 'date', nullable: true }) crExpiry!: string | null;
  @Column({ name: 'vat_number', type: 'varchar', length: 20, nullable: true }) vatNumber!: string | null;
  /** رقم الهوية للمورد الفرد */
  @Column({ name: 'national_id', type: 'varchar', length: 12, nullable: true }) nationalId!: string | null;
  @Column({ type: 'varchar', length: 100, nullable: true }) city!: string | null;
  /** العنوان الوطني */
  @Column({ type: 'varchar', length: 500, nullable: true }) address!: string | null;
  @Column({ type: 'varchar', length: 30, nullable: true }) phone!: string | null;
  @Column({ type: 'varchar', length: 200, nullable: true }) email!: string | null;
  @Column({ type: 'varchar', length: 300, nullable: true }) website!: string | null;
  @Column({ type: 'jsonb', default: () => `'[]'` }) contacts!: SupplierContact[];
  @Column({ type: 'jsonb', default: () => `'[]'` }) branches!: SupplierBranch[];
  @Column({ type: 'varchar', length: 10, default: 'pending' }) status!: SupplierStatus;
  /** internal سجله موظف الجمعية، portal سجّل نفسه من البوابة */
  @Column({ type: 'varchar', length: 10, default: 'internal' }) source!: 'internal' | 'portal';
  @Column({ name: 'submitted_at', type: 'timestamptz', nullable: true }) submittedAt!: Date | null;
  /** ملاحظات المراجعة الأخيرة (سبب الإعادة أو الرفض أو الإيقاف) */
  @Column({ name: 'review_note', type: 'varchar', length: 2000, nullable: true }) reviewNote!: string | null;
  @Column({ name: 'decided_by_name', type: 'varchar', length: 200, nullable: true }) decidedByName!: string | null;
  @Column({ name: 'decided_at', type: 'timestamptz', nullable: true }) decidedAt!: Date | null;
  /** الشريك المقابل في النظام المالي (حساب الدائنين) */
  @Column({ name: 'acc_partner_id', type: 'uuid', nullable: true }) accPartnerId!: string | null;
  /** نتيجة آخر تقييم معتمد: الدرجة والتقدير وتاريخه */
  @Column({ type: 'numeric', precision: 5, scale: 2, nullable: true, transformer: { to: (v?: number | null) => v, from: (v?: string | null) => (v === null || v === undefined ? null : Number(v)) } }) rating!: number | null;
  @Column({ type: 'varchar', length: 1, nullable: true }) grade!: 'A' | 'B' | 'C' | 'D' | null;
  @Column({ name: 'rated_at', type: 'timestamptz', nullable: true }) ratedAt!: Date | null;
  @Column({ type: 'jsonb', default: () => `'[]'` }) log!: LogEntry[];
  @Column({ name: 'created_by_name', length: 200 }) createdByName!: string;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt!: Date;
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' }) updatedAt!: Date;
}

/** مستند المورد (سجل تجاري، شهادة زكاة، ترخيص ...) */
@Entity('pr_supplier_docs')
@Index('IDX_pr_supplier_docs_supplier', ['organizationId', 'supplierId'])
export class PrSupplierDoc {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ name: 'organization_id', type: 'uuid' }) organizationId!: string;
  @Column({ name: 'supplier_id', type: 'uuid' }) supplierId!: string;
  @Column({ name: 'doc_type', length: 40 }) docType!: string;
  @Column({ length: 200 }) title!: string;
  @Column({ type: 'varchar', length: 60, nullable: true }) number!: string | null;
  @Column({ name: 'issue_date', type: 'date', nullable: true }) issueDate!: string | null;
  @Column({ name: 'expiry_date', type: 'date', nullable: true }) expiryDate!: string | null;
  @Column({ name: 'file_key', length: 120 }) fileKey!: string;
  @Column({ name: 'file_name', length: 200 }) fileName!: string;
  @Column({ name: 'file_mime', length: 40 }) fileMime!: string;
  @Column({ name: 'file_size', type: 'int', default: 0 }) fileSize!: number;
  @Column({ type: 'varchar', length: 10, default: 'pending' }) status!: DocStatus;
  /** المستند الحالي لنوعه (القديم يبقى في السجل عند التجديد) */
  @Column({ name: 'is_current', default: true }) isCurrent!: boolean;
  @Column({ name: 'review_note', type: 'varchar', length: 1000, nullable: true }) reviewNote!: string | null;
  @Column({ name: 'reviewed_by_name', type: 'varchar', length: 200, nullable: true }) reviewedByName!: string | null;
  @Column({ name: 'reviewed_at', type: 'timestamptz', nullable: true }) reviewedAt!: Date | null;
  @Column({ name: 'uploaded_via', type: 'varchar', length: 8, default: 'staff' }) uploadedVia!: 'staff' | 'portal';
  @Column({ name: 'uploaded_by_name', length: 200 }) uploadedByName!: string;
  /** آخر تنبيه أُرسل قبل الانتهاء (لا يتكرر يوميًا) */
  @Column({ name: 'alerted_at', type: 'timestamptz', nullable: true }) alertedAt!: Date | null;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt!: Date;
}

/** حساب بنكي للمورد: لا يُستخدم في الصرف إلا بعد اعتماد مستقل عن طالبه */
@Entity('pr_supplier_banks')
@Index('IDX_pr_supplier_banks_supplier', ['organizationId', 'supplierId'])
export class PrSupplierBank {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ name: 'organization_id', type: 'uuid' }) organizationId!: string;
  @Column({ name: 'supplier_id', type: 'uuid' }) supplierId!: string;
  @Column({ name: 'bank_name', length: 120 }) bankName!: string;
  @Column({ length: 34 }) iban!: string;
  @Column({ name: 'account_name', length: 250 }) accountName!: string;
  /** خطاب البنك أو شهادة الآيبان */
  @Column({ name: 'file_key', type: 'varchar', length: 120, nullable: true }) fileKey!: string | null;
  @Column({ name: 'file_name', type: 'varchar', length: 200, nullable: true }) fileName!: string | null;
  @Column({ name: 'file_mime', type: 'varchar', length: 40, nullable: true }) fileMime!: string | null;
  @Column({ type: 'varchar', length: 10, default: 'pending' }) status!: BankStatus;
  @Column({ name: 'is_primary', default: false }) isPrimary!: boolean;
  @Column({ name: 'requested_via', type: 'varchar', length: 8, default: 'staff' }) requestedVia!: 'staff' | 'portal';
  @Column({ name: 'requested_by_id', type: 'uuid', nullable: true }) requestedById!: string | null;
  @Column({ name: 'requested_by_name', length: 200 }) requestedByName!: string;
  @Column({ name: 'decided_by_name', type: 'varchar', length: 200, nullable: true }) decidedByName!: string | null;
  @Column({ name: 'decided_at', type: 'timestamptz', nullable: true }) decidedAt!: Date | null;
  @Column({ name: 'decision_note', type: 'varchar', length: 1000, nullable: true }) decisionNote!: string | null;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt!: Date;
}

/** مستخدم بوابة الموردين (عدة مستخدمين للحساب الواحد بأدوار مختلفة) */
@Entity('pr_supplier_users')
@Index('UQ_pr_supplier_users_email', ['organizationId', 'email'], { unique: true })
export class PrSupplierUser {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ name: 'organization_id', type: 'uuid' }) organizationId!: string;
  @Column({ name: 'supplier_id', type: 'uuid' }) supplierId!: string;
  @Column({ name: 'full_name', length: 200 }) fullName!: string;
  @Column({ length: 200 }) email!: string;
  @Column({ type: 'varchar', length: 30, nullable: true }) phone!: string | null;
  @Column({ type: 'varchar', length: 10, default: 'owner' }) role!: PortalRole;
  @Column({ name: 'password_hash', type: 'varchar', length: 100, nullable: true, select: false }) passwordHash!: string | null;
  @Column({ name: 'must_change_password', default: false }) mustChangePassword!: boolean;
  @Column({ name: 'is_active', default: true }) isActive!: boolean;
  @Column({ name: 'failed_logins', type: 'int', default: 0 }) failedLogins!: number;
  @Column({ name: 'locked_until', type: 'timestamptz', nullable: true }) lockedUntil!: Date | null;
  @Column({ name: 'last_login_at', type: 'timestamptz', nullable: true }) lastLoginAt!: Date | null;
  /** رموز الدخول الصادرة قبل هذا الوقت مرفوضة (عند تغيير كلمة المرور أو الإيقاف) */
  @Column({ name: 'sessions_valid_after', type: 'timestamptz', nullable: true }) sessionsValidAfter!: Date | null;
  @Column({ name: 'reset_token_hash', type: 'varchar', length: 64, nullable: true, select: false }) resetTokenHash!: string | null;
  @Column({ name: 'reset_expires_at', type: 'timestamptz', nullable: true }) resetExpiresAt!: Date | null;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt!: Date;
}

/** سجل دخول وعمليات بوابة الموردين */
@Entity('pr_portal_events')
@Index('IDX_pr_portal_events_supplier', ['organizationId', 'supplierId', 'at'])
export class PrPortalEvent {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ name: 'organization_id', type: 'uuid' }) organizationId!: string;
  @Column({ name: 'supplier_id', type: 'uuid', nullable: true }) supplierId!: string | null;
  @Column({ name: 'user_id', type: 'uuid', nullable: true }) userId!: string | null;
  @Column({ name: 'user_name', type: 'varchar', length: 200, nullable: true }) userName!: string | null;
  @Column({ length: 40 }) event!: string;
  @Column({ type: 'varchar', length: 500, nullable: true }) detail!: string | null;
  @Column({ type: 'varchar', length: 64, nullable: true }) ip!: string | null;
  @CreateDateColumn({ type: 'timestamptz' }) at!: Date;
}

export const PROCUREMENT_ENTITIES = [
  PrSettings, PrUom, PrItemGroup, PrItem, PrWarehouse, PrLocation, PrSupplierCategory, PrSupplier, PrSupplierDoc, PrSupplierBank, PrSupplierUser, PrPortalEvent,
];
