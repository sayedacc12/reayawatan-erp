import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn, ValueTransformer } from 'typeorm';
import { ItemFile, LogEntry } from './procurement.entity';

const num: ValueTransformer = {
  to: (v?: number | null) => v,
  from: (v?: string | null) => (v === null || v === undefined ? null : Number(v)),
};
const money = (name: string, nullable = false) => ({
  name, type: 'numeric' as const, precision: 14, scale: 2, transformer: num, nullable, ...(nullable ? {} : { default: 0 }),
});

// ---------------- القوائم الثابتة ----------------

export const PURCHASE_METHODS = {
  direct: 'شراء مباشر', quotes: 'طلب عروض أسعار', tender: 'منافسة عامة', emergency: 'شراء طارئ',
} as const;
export type PurchaseMethod = keyof typeof PURCHASE_METHODS;

export const REQUEST_KINDS = {
  goods: 'مواد وأصناف', services: 'خدمات تشغيلية', assets: 'أصول ثابتة', beneficiary: 'خدمة لمستفيد أو برنامج',
} as const;
export type RequestKind = keyof typeof REQUEST_KINDS;

export const PRIORITIES = { normal: 'عادي', high: 'مرتفع', urgent: 'عاجل' } as const;
export type Priority = keyof typeof PRIORITIES;

export const REQUEST_STATUS = {
  draft: 'مسودة', submitted: 'بانتظار الاعتماد', returned: 'معاد للتعديل', approved: 'معتمد', sourcing: 'قيد الطرح',
  ordered: 'صدر تعميده', closed: 'مكتمل', rejected: 'مرفوض', cancelled: 'ملغى',
} as const;
export type RequestStatus = keyof typeof REQUEST_STATUS;

export const RFQ_STATUS = {
  draft: 'مسودة', published: 'منشورة لاستقبال العروض', opened: 'فُتحت العروض', recommended: 'أوصي بالترسية', awarded: 'اعتُمدت الترسية', cancelled: 'ملغاة',
} as const;
export type RfqStatus = keyof typeof RFQ_STATUS;

export const QUOTE_STATUS = { draft: 'مسودة', submitted: 'مقدَّم', withdrawn: 'مسحوب', excluded: 'مستبعد' } as const;
export type QuoteStatus = keyof typeof QUOTE_STATUS;

export const ORDER_KINDS = { goods: 'أمر شراء', services: 'تعميد خدمة', beneficiary: 'تعميد خدمة لمستفيد' } as const;
export type OrderKind = keyof typeof ORDER_KINDS;

export const ORDER_STATUS = {
  draft: 'مسودة', pending: 'بانتظار الاعتماد', returned: 'معاد للتعديل', issued: 'صادر للمورد', acknowledged: 'استلمه المورد', accepted: 'قبله المورد',
  clarification: 'طلب المورد توضيحًا', declined: 'اعتذر المورد', partial: 'مستلم جزئيًا', cancelled: 'ملغى', closed: 'مغلق',
} as const;
export type OrderStatus = keyof typeof ORDER_STATUS;
/** حالات التعميد النافذ (محجوز على الموازنة ومرسل للمورد) */
export const LIVE_ORDER: OrderStatus[] = ['issued', 'acknowledged', 'accepted', 'clarification', 'declined'];

/** مستوى اعتماد للتعميدات: يُشترط إذا بلغت قيمة التعميد الحد الأدنى */
export interface ApprovalLevel { name: string; minAmount: number; permission: string }
/** معيار تقييم العروض: price يُحسب آليًا من الأسعار، technical تقدّره لجنة التقييم */
export interface EvalCriterion { key: string; name: string; weight: number; kind: 'price' | 'technical' }

export interface RequestLine {
  id: string;
  itemId: string | null;
  description: string;
  qty: number;
  uomId: string | null;
  /** السعر التقديري للوحدة */
  estPrice: number;
  specs: string | null;
}

/** نتيجة فحص الموازنة والتمويل كما ظهرت وقت الإجراء */
export interface BudgetCheckSnapshot {
  allowed: boolean; basis: 'funding' | 'budget'; amount: number; available: number; message: string; warnings: string[]; at: string;
}

// ---------------- طلب الشراء ----------------

@Entity('pr_requests')
@Index('UQ_pr_requests_no', ['organizationId', 'requestNo'], { unique: true })
@Index('IDX_pr_requests_status', ['organizationId', 'status'])
export class PrRequest {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ name: 'organization_id', type: 'uuid' }) organizationId!: string;
  @Column({ name: 'request_no', type: 'int' }) requestNo!: number;
  @Column({ length: 250 }) title!: string;
  @Column({ type: 'varchar', length: 12, default: 'goods' }) kind!: RequestKind;
  /** الإدارة الطالبة في الهيكل التنظيمي */
  @Column({ name: 'unit_id', type: 'uuid', nullable: true }) unitId!: string | null;
  /** المشروع أو البرنامج */
  @Column({ name: 'project_id', type: 'uuid', nullable: true }) projectId!: string | null;
  /** مرجع المستفيد أو الحالة (رقم الملف أو الطلب فقط، بلا بيانات شخصية) */
  @Column({ name: 'beneficiary_ref', type: 'varchar', length: 120, nullable: true }) beneficiaryRef!: string | null;
  @Column({ name: 'needed_by', type: 'date', nullable: true }) neededBy!: string | null;
  @Column({ type: 'varchar', length: 8, default: 'normal' }) priority!: Priority;
  @Column({ type: 'text', nullable: true }) justification!: string | null;
  /** أسلوب الشراء المختار، والمقترح حسب القيمة يُحسب عند العرض */
  @Column({ type: 'varchar', length: 10, nullable: true }) method!: PurchaseMethod | null;
  /** مبرر اختيار أسلوب أدنى من المقترح أو الشراء الطارئ */
  @Column({ name: 'method_reason', type: 'varchar', length: 1000, nullable: true }) methodReason!: string | null;
  @Column({ name: 'budget_line_id', type: 'uuid', nullable: true }) budgetLineId!: string | null;
  /** مصدر التمويل (دفعة في نظام تنمية الموارد) */
  @Column({ name: 'funding_batch_id', type: 'uuid', nullable: true }) fundingBatchId!: string | null;
  @Column(money('estimated_total')) estimatedTotal!: number;
  @Column({ type: 'jsonb', default: () => `'[]'` }) lines!: RequestLine[];
  @Column({ type: 'jsonb', default: () => `'[]'` }) attachments!: ItemFile[];
  @Column({ type: 'varchar', length: 10, default: 'draft' }) status!: RequestStatus;
  @Column({ name: 'budget_check', type: 'jsonb', nullable: true }) budgetCheck!: BudgetCheckSnapshot | null;
  @Column({ name: 'requested_by_id', type: 'uuid', nullable: true }) requestedById!: string | null;
  @Column({ name: 'requested_by_name', length: 200 }) requestedByName!: string;
  @Column({ name: 'submitted_at', type: 'timestamptz', nullable: true }) submittedAt!: Date | null;
  @Column({ name: 'decided_by_name', type: 'varchar', length: 200, nullable: true }) decidedByName!: string | null;
  @Column({ name: 'decided_at', type: 'timestamptz', nullable: true }) decidedAt!: Date | null;
  @Column({ name: 'decision_note', type: 'varchar', length: 2000, nullable: true }) decisionNote!: string | null;
  @Column({ type: 'jsonb', default: () => `'[]'` }) log!: LogEntry[];
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt!: Date;
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' }) updatedAt!: Date;
}

// ---------------- المنافسة / طلب عروض الأسعار ----------------

/** بند في كراسة المنافسة كما يراه المورد (بلا السعر التقديري) */
export interface RfqLine { id: string; itemId: string | null; description: string; qty: number; uomName: string | null; specs: string | null }

@Entity('pr_rfqs')
@Index('UQ_pr_rfqs_no', ['organizationId', 'rfqNo'], { unique: true })
@Index('IDX_pr_rfqs_request', ['organizationId', 'requestId'])
export class PrRfq {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ name: 'organization_id', type: 'uuid' }) organizationId!: string;
  @Column({ name: 'rfq_no', type: 'int' }) rfqNo!: number;
  @Column({ name: 'request_id', type: 'uuid' }) requestId!: string;
  @Column({ length: 250 }) title!: string;
  @Column({ type: 'varchar', length: 10 }) method!: PurchaseMethod;
  /** نطاق الأعمال والمواصفات العامة */
  @Column({ type: 'text', nullable: true }) scope!: string | null;
  /** الشروط الفنية والمالية */
  @Column({ type: 'text', nullable: true }) terms!: string | null;
  @Column({ type: 'jsonb', default: () => `'[]'` }) lines!: RfqLine[];
  @Column({ type: 'jsonb', default: () => `'[]'` }) attachments!: ItemFile[];
  /** آخر موعد للاستفسارات */
  @Column({ name: 'questions_until', type: 'timestamptz', nullable: true }) questionsUntil!: Date | null;
  /** آخر موعد لتقديم العروض، ولا تُفتح قبله */
  @Column({ name: 'closes_at', type: 'timestamptz', nullable: true }) closesAt!: Date | null;
  /** الموردون المدعوون */
  @Column({ name: 'invited_ids', type: 'jsonb', default: () => `'[]'` }) invitedIds!: string[];
  /** تصنيفات الموردين المستهدفة (للمنافسة العامة) */
  @Column({ name: 'category_ids', type: 'jsonb', default: () => `'[]'` }) categoryIds!: string[];
  @Column({ type: 'jsonb', default: () => `'[]'` }) criteria!: EvalCriterion[];
  /** الحد الأدنى للدرجة الفنية (من 100) لتأهل العرض ماليًا */
  @Column({ name: 'technical_pass', type: 'int', default: 0 }) technicalPass!: number;
  /** أعضاء لجنة التقييم (مستخدمو الجمعية) */
  @Column({ name: 'committee_ids', type: 'jsonb', default: () => `'[]'` }) committeeIds!: string[];
  @Column({ type: 'varchar', length: 12, default: 'draft' }) status!: RfqStatus;
  @Column({ name: 'published_at', type: 'timestamptz', nullable: true }) publishedAt!: Date | null;
  @Column({ name: 'opened_at', type: 'timestamptz', nullable: true }) openedAt!: Date | null;
  @Column({ name: 'opened_by_name', type: 'varchar', length: 200, nullable: true }) openedByName!: string | null;
  @Column({ name: 'recommended_quote_id', type: 'uuid', nullable: true }) recommendedQuoteId!: string | null;
  /** محضر التوصية ومبرراتها */
  @Column({ type: 'text', nullable: true }) recommendation!: string | null;
  @Column({ name: 'recommended_by_name', type: 'varchar', length: 200, nullable: true }) recommendedByName!: string | null;
  @Column({ name: 'recommended_at', type: 'timestamptz', nullable: true }) recommendedAt!: Date | null;
  @Column({ name: 'cancel_reason', type: 'varchar', length: 1000, nullable: true }) cancelReason!: string | null;
  @Column({ type: 'jsonb', default: () => `'[]'` }) log!: LogEntry[];
  @Column({ name: 'created_by_name', length: 200 }) createdByName!: string;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt!: Date;
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' }) updatedAt!: Date;
}

export interface QuoteLine { lineId: string; unitPrice: number; note: string | null }
export interface QuoteRevision { round: number; at: string; byName: string; note: string | null; before: number; after: number }
/** تقدير عضو اللجنة: درجة من 100 لكل معيار فني */
export interface MemberScore { name: string; scores: Record<string, number>; note: string | null; at: string }

@Entity('pr_quotes')
@Index('UQ_pr_quotes_rfq_supplier', ['rfqId', 'supplierId'], { unique: true })
export class PrQuote {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ name: 'organization_id', type: 'uuid' }) organizationId!: string;
  @Column({ name: 'rfq_id', type: 'uuid' }) rfqId!: string;
  @Column({ name: 'supplier_id', type: 'uuid' }) supplierId!: string;
  @Column({ type: 'varchar', length: 10, default: 'draft' }) status!: QuoteStatus;
  @Column({ type: 'jsonb', default: () => `'[]'` }) lines!: QuoteLine[];
  /** نسبة ضريبة القيمة المضافة (15 أو 0 لغير المسجل) */
  @Column({ name: 'vat_rate', type: 'numeric', precision: 5, scale: 2, transformer: num, default: 15 }) vatRate!: number;
  @Column(money('subtotal')) subtotal!: number;
  @Column(money('vat')) vat!: number;
  @Column(money('total')) total!: number;
  @Column({ name: 'delivery_days', type: 'int', nullable: true }) deliveryDays!: number | null;
  @Column({ name: 'validity_days', type: 'int', nullable: true }) validityDays!: number | null;
  /** العرض الفني والملاحظات */
  @Column({ name: 'technical_note', type: 'text', nullable: true }) technicalNote!: string | null;
  @Column({ type: 'jsonb', default: () => `'[]'` }) attachments!: ItemFile[];
  @Column({ type: 'varchar', length: 8, default: 'portal' }) via!: 'portal' | 'staff';
  @Column({ name: 'submitted_at', type: 'timestamptz', nullable: true }) submittedAt!: Date | null;
  @Column({ name: 'submitted_by_name', type: 'varchar', length: 200, nullable: true }) submittedByName!: string | null;
  @Column({ type: 'jsonb', default: () => `'[]'` }) revisions!: QuoteRevision[];
  /** تقديرات لجنة التقييم بمعرف العضو */
  @Column({ type: 'jsonb', default: () => `'{}'` }) scores!: Record<string, MemberScore>;
  @Column({ name: 'excluded_reason', type: 'varchar', length: 1000, nullable: true }) excludedReason!: string | null;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt!: Date;
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' }) updatedAt!: Date;
}

/** استفسار مورد على منافسة، والرد يُعمم على كل المدعوين إن نُشر */
@Entity('pr_rfq_questions')
@Index('IDX_pr_rfq_questions_rfq', ['rfqId'])
export class PrRfqQuestion {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ name: 'organization_id', type: 'uuid' }) organizationId!: string;
  @Column({ name: 'rfq_id', type: 'uuid' }) rfqId!: string;
  @Column({ name: 'supplier_id', type: 'uuid', nullable: true }) supplierId!: string | null;
  @Column({ type: 'varchar', length: 2000 }) question!: string;
  @Column({ type: 'varchar', length: 4000, nullable: true }) answer!: string | null;
  /** يظهر لكل المدعوين (بلا اسم السائل) */
  @Column({ default: false }) published!: boolean;
  @Column({ name: 'asked_by_name', length: 200 }) askedByName!: string;
  @Column({ name: 'answered_by_name', type: 'varchar', length: 200, nullable: true }) answeredByName!: string | null;
  @Column({ name: 'answered_at', type: 'timestamptz', nullable: true }) answeredAt!: Date | null;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt!: Date;
}

// ---------------- التعميد / أمر الشراء ----------------

export interface OrderLine { lineId: string | null; itemId: string | null; description: string; qty: number; uomId: string | null; unitPrice: number; total: number }
export interface OrderApproval { level: number; name: string; byId: string; byName: string; at: string; note: string | null }
export interface SupplierResponse { action: 'acknowledge' | 'accept' | 'clarify' | 'decline' | 'reply'; note: string | null; byName: string; at: string; via: 'portal' | 'staff' }

@Entity('pr_orders')
@Index('UQ_pr_orders_no', ['organizationId', 'orderNo'], { unique: true })
@Index('IDX_pr_orders_status', ['organizationId', 'status'])
@Index('IDX_pr_orders_supplier', ['organizationId', 'supplierId'])
@Index('IDX_pr_orders_request', ['organizationId', 'requestId'])
export class PrOrder {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ name: 'organization_id', type: 'uuid' }) organizationId!: string;
  @Column({ name: 'order_no', type: 'int' }) orderNo!: number;
  @Column({ type: 'varchar', length: 12, default: 'goods' }) kind!: OrderKind;
  @Column({ name: 'request_id', type: 'uuid' }) requestId!: string;
  @Column({ name: 'rfq_id', type: 'uuid', nullable: true }) rfqId!: string | null;
  @Column({ name: 'quote_id', type: 'uuid', nullable: true }) quoteId!: string | null;
  @Column({ name: 'supplier_id', type: 'uuid' }) supplierId!: string;
  @Column({ length: 250 }) title!: string;
  @Column({ type: 'jsonb', default: () => `'[]'` }) lines!: OrderLine[];
  @Column({ name: 'vat_rate', type: 'numeric', precision: 5, scale: 2, transformer: num, default: 15 }) vatRate!: number;
  @Column(money('subtotal')) subtotal!: number;
  @Column(money('vat')) vat!: number;
  @Column(money('total')) total!: number;
  @Column({ name: 'unit_id', type: 'uuid', nullable: true }) unitId!: string | null;
  @Column({ name: 'project_id', type: 'uuid', nullable: true }) projectId!: string | null;
  @Column({ name: 'beneficiary_ref', type: 'varchar', length: 120, nullable: true }) beneficiaryRef!: string | null;
  @Column({ name: 'budget_line_id', type: 'uuid', nullable: true }) budgetLineId!: string | null;
  @Column({ name: 'funding_batch_id', type: 'uuid', nullable: true }) fundingBatchId!: string | null;
  /** العقد أو الاتفاقية الإطارية التي يصدر عليها التعميد */
  @Column({ name: 'contract_id', type: 'uuid', nullable: true }) contractId!: string | null;
  /** مستودع التسليم (للمواد) */
  @Column({ name: 'warehouse_id', type: 'uuid', nullable: true }) warehouseId!: string | null;
  @Column({ name: 'delivery_date', type: 'date', nullable: true }) deliveryDate!: string | null;
  @Column({ name: 'delivery_place', type: 'varchar', length: 500, nullable: true }) deliveryPlace!: string | null;
  @Column({ type: 'text', nullable: true }) terms!: string | null;
  @Column({ type: 'varchar', length: 14, default: 'draft' }) status!: OrderStatus;
  /** مستويات الاعتماد المطلوبة لقيمته (تُحسب عند الإرسال للاعتماد) */
  @Column({ name: 'required_levels', type: 'jsonb', default: () => `'[]'` }) requiredLevels!: ApprovalLevel[];
  @Column({ type: 'jsonb', default: () => `'[]'` }) approvals!: OrderApproval[];
  /** الحجز على بند الموازنة في نظام التخطيط */
  @Column({ name: 'commitment_id', type: 'uuid', nullable: true }) commitmentId!: string | null;
  /** المبلغ المحجوز من مصدر التمويل */
  @Column(money('funding_reserved')) fundingReserved!: number;
  @Column({ name: 'budget_check', type: 'jsonb', nullable: true }) budgetCheck!: BudgetCheckSnapshot | null;
  @Column({ type: 'int', default: 1 }) version!: number;
  @Column({ type: 'jsonb', default: () => `'[]'` }) responses!: SupplierResponse[];
  @Column({ name: 'issued_at', type: 'timestamptz', nullable: true }) issuedAt!: Date | null;
  @Column({ name: 'acknowledged_at', type: 'timestamptz', nullable: true }) acknowledgedAt!: Date | null;
  @Column({ name: 'accepted_at', type: 'timestamptz', nullable: true }) acceptedAt!: Date | null;
  @Column({ name: 'cancel_reason', type: 'varchar', length: 1000, nullable: true }) cancelReason!: string | null;
  /** طريقة الإغلاق: received اكتمل الاستلام، short أُغلق بالمستلم وفُك حجز الباقي */
  @Column({ name: 'close_kind', type: 'varchar', length: 10, nullable: true }) closeKind!: 'received' | 'short' | null;
  @Column({ name: 'created_by_id', type: 'uuid', nullable: true }) createdById!: string | null;
  @Column({ name: 'created_by_name', length: 200 }) createdByName!: string;
  @Column({ type: 'jsonb', default: () => `'[]'` }) log!: LogEntry[];
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt!: Date;
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' }) updatedAt!: Date;
}

export const SOURCING_ENTITIES = [PrRequest, PrRfq, PrQuote, PrRfqQuestion, PrOrder];
