import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn, ValueTransformer } from 'typeorm';
import { ItemFile, LogEntry } from './procurement.entity';

const num: ValueTransformer = {
  to: (v?: number | null) => v,
  from: (v?: string | null) => (v === null || v === undefined ? null : Number(v)),
};
const money = (name: string) => ({ name, type: 'numeric' as const, precision: 16, scale: 2, transformer: num, default: 0 });
const qty = (name: string) => ({ name, type: 'numeric' as const, precision: 14, scale: 3, transformer: num, default: 0 });

// ---------------- القوائم الثابتة ----------------

export const RECEIPT_KINDS = { order: 'استلام بتعميد', donation: 'تبرع عيني', opening: 'رصيد افتتاحي' } as const;
export type ReceiptKind = keyof typeof RECEIPT_KINDS;
export const RECEIPT_STATUS = { posted: 'معتمد', cancelled: 'ملغى' } as const;
export type ReceiptStatus = keyof typeof RECEIPT_STATUS;
export const INSPECTION_RESULTS = { accepted: 'مطابق', partial: 'مطابق جزئيًا', rejected: 'غير مطابق' } as const;

/** معالجة البند عند الاستلام: يدخل المخزون، أو يُنشأ أصلًا ثابتًا، أو يُحمّل مصروفًا مباشرة (خدمات وتسليم مباشر) */
export const LINE_TREATMENT = { stock: 'يدخل المخزون', asset: 'أصل ثابت', expense: 'مصروف مباشر' } as const;
export type LineTreatment = keyof typeof LINE_TREATMENT;

export const ISSUE_REQUEST_STATUS = {
  draft: 'مسودة', submitted: 'بانتظار الاعتماد', approved: 'معتمد للصرف', partial: 'صُرف جزئيًا', issued: 'صُرف بالكامل',
  returned: 'معاد للتعديل', rejected: 'مرفوض', cancelled: 'ملغى',
} as const;
export type IssueRequestStatus = keyof typeof ISSUE_REQUEST_STATUS;

export const STOCK_DOC_KINDS = {
  issue: 'سند صرف', transfer: 'تحويل بين المستودعات', return_supplier: 'مرتجع للمورد', return_in: 'مرتجع من الجهة', writeoff: 'إتلاف وشطب',
} as const;
export type StockDocKind = keyof typeof STOCK_DOC_KINDS;
export const WRITEOFF_REASONS = { expired: 'منتهي الصلاحية', damaged: 'تالف', lost: 'مفقود', other: 'أخرى' } as const;

export const COUNT_KINDS = { periodic: 'دوري', annual: 'سنوي', surprise: 'مفاجئ', cycle: 'مستمر (لمجموعة أصناف)' } as const;
export const COUNT_STATUS = { open: 'قيد العد', submitted: 'بانتظار اعتماد الفروقات', approved: 'معتمد ومُسوّى', cancelled: 'ملغى' } as const;
export type CountStatus = keyof typeof COUNT_STATUS;

/** أنواع حركات المخزون في دفتر الأستاذ المساعد */
export const MOVE_KINDS = {
  receipt: 'استلام', donation: 'تبرع عيني', opening: 'رصيد افتتاحي', issue: 'صرف', transfer_out: 'تحويل صادر', transfer_in: 'تحويل وارد',
  return_supplier: 'مرتجع للمورد', return_in: 'مرتجع من الجهة', writeoff: 'إتلاف', count_in: 'زيادة جرد', count_out: 'عجز جرد',
} as const;
export type MoveKind = keyof typeof MOVE_KINDS;

// ---------------- الاستلام ----------------

export interface ReceiptLine {
  id: string;
  /** بند التعميد (للاستلام بتعميد) */
  orderLineId: string | null;
  itemId: string | null;
  description: string;
  uomId: string | null;
  treatment: LineTreatment;
  /** الكمية المسلّمة */
  qty: number;
  /** المقبول بعد الفحص (يدخل المخزون أو الأصول أو المصروف) */
  acceptedQty: number;
  rejectedQty: number;
  rejectReason: string | null;
  /** سعر الوحدة في التعميد أو القيمة العادلة للتبرع */
  unitPrice: number;
  /** نصيب الوحدة من مصاريف النقل والتخليص */
  extraUnit: number;
  /** التكلفة = (السعر + نصيب المصاريف) × المقبول */
  value: number;
  lot: string | null;
  expiryDate: string | null;
  locationId: string | null;
  /** الحساب المدين (المخزون أو المصروف) */
  accountId: string | null;
  /** الأصول الثابتة المنشأة من البند */
  assetIds: string[];
}

export interface Inspection { committee: string[]; result: keyof typeof INSPECTION_RESULTS; note: string | null; byName: string; at: string }

@Entity('pr_receipts')
@Index('UQ_pr_receipts_no', ['organizationId', 'receiptNo'], { unique: true })
@Index('IDX_pr_receipts_order', ['organizationId', 'orderId'])
export class PrReceipt {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ name: 'organization_id', type: 'uuid' }) organizationId!: string;
  @Column({ name: 'receipt_no', type: 'int' }) receiptNo!: number;
  @Column({ type: 'varchar', length: 10 }) kind!: ReceiptKind;
  @Column({ name: 'order_id', type: 'uuid', nullable: true }) orderId!: string | null;
  @Column({ name: 'supplier_id', type: 'uuid', nullable: true }) supplierId!: string | null;
  @Column({ name: 'warehouse_id', type: 'uuid', nullable: true }) warehouseId!: string | null;
  @Column({ type: 'date' }) date!: string;
  /** رقم إشعار التسليم من المورد أو مرجع التبرع */
  @Column({ name: 'delivery_ref', type: 'varchar', length: 80, nullable: true }) deliveryRef!: string | null;
  @Column({ name: 'donor_name', type: 'varchar', length: 250, nullable: true }) donorName!: string | null;
  /** مركز التكلفة للبنود التي تُحمّل مصروفًا مباشرًا */
  @Column({ name: 'analytic_id', type: 'uuid', nullable: true }) analyticId!: string | null;
  @Column({ name: 'project_id', type: 'uuid', nullable: true }) projectId!: string | null;
  @Column({ type: 'jsonb', default: () => `'[]'` }) lines!: ReceiptLine[];
  /** مصاريف النقل والتخليص على المورد نفسه (تُوزع على البنود المقبولة بنسبة قيمتها) */
  @Column(money('extra_cost')) extraCost!: number;
  @Column({ name: 'extra_note', type: 'varchar', length: 500, nullable: true }) extraNote!: string | null;
  @Column(money('total')) total!: number;
  /** القيمة بأسعار التعميد قبل المصاريف (أساس استهلاك حجز الموازنة) */
  @Column(money('order_value')) orderValue!: number;
  @Column({ type: 'jsonb', nullable: true }) inspection!: Inspection | null;
  @Column({ type: 'varchar', length: 10, default: 'posted' }) status!: ReceiptStatus;
  @Column({ name: 'entry_id', type: 'uuid', nullable: true }) entryId!: string | null;
  /** المبلغ المستهلك من حجز الموازنة ومصدر التمويل (شامل الضريبة بنسبة التعميد) */
  @Column(money('consumed')) consumed!: number;
  /** المبلغ المصروف من مصدر التمويل بهذا الاستلام */
  @Column(money('funding_spent')) fundingSpent!: number;
  @Column({ type: 'varchar', length: 2000, nullable: true }) notes!: string | null;
  @Column({ type: 'jsonb', default: () => `'[]'` }) attachments!: ItemFile[];
  @Column({ name: 'cancel_reason', type: 'varchar', length: 1000, nullable: true }) cancelReason!: string | null;
  @Column({ name: 'created_by_id', type: 'uuid', nullable: true }) createdById!: string | null;
  @Column({ name: 'created_by_name', length: 200 }) createdByName!: string;
  @Column({ type: 'jsonb', default: () => `'[]'` }) log!: LogEntry[];
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt!: Date;
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' }) updatedAt!: Date;
}

// ---------------- دفتر المخزون ----------------

/** حركة مخزون: كل استلام وصرف وتحويل وتسوية يحدّث الرصيد والقيمة فورًا (جرد مستمر) */
@Entity('pr_stock_moves')
@Index('IDX_pr_stock_moves_item', ['organizationId', 'itemId', 'warehouseId', 'date'])
@Index('IDX_pr_stock_moves_doc', ['docId'])
@Index('IDX_pr_stock_moves_account', ['organizationId', 'accountId'])
export class PrStockMove {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ name: 'organization_id', type: 'uuid' }) organizationId!: string;
  @Column({ type: 'date' }) date!: string;
  @Column({ type: 'varchar', length: 16 }) kind!: MoveKind;
  @Column({ name: 'item_id', type: 'uuid' }) itemId!: string;
  @Column({ name: 'warehouse_id', type: 'uuid' }) warehouseId!: string;
  @Column({ name: 'location_id', type: 'uuid', nullable: true }) locationId!: string | null;
  @Column({ type: 'varchar', length: 60, nullable: true }) lot!: string | null;
  @Column({ name: 'expiry_date', type: 'date', nullable: true }) expiryDate!: string | null;
  /** موجبة للوارد وسالبة للصادر */
  @Column(qty('qty')) qty!: number;
  @Column(money('value')) value!: number;
  /** الرصيد بعد الحركة (للصنف في المستودع) */
  @Column(qty('balance_qty')) balanceQty!: number;
  @Column(money('balance_value')) balanceValue!: number;
  /** حساب المخزون الذي تأثر بالحركة (أساس المطابقة مع الدليل) */
  @Column({ name: 'account_id', type: 'uuid', nullable: true }) accountId!: string | null;
  @Column({ name: 'doc_type', type: 'varchar', length: 16 }) docType!: 'receipt' | 'doc' | 'count';
  @Column({ name: 'doc_id', type: 'uuid' }) docId!: string;
  @Column({ name: 'doc_code', type: 'varchar', length: 20 }) docCode!: string;
  @Column({ name: 'project_id', type: 'uuid', nullable: true }) projectId!: string | null;
  @Column({ name: 'unit_id', type: 'uuid', nullable: true }) unitId!: string | null;
  @Column({ name: 'cancelled', default: false }) cancelled!: boolean;
  @Column({ name: 'by_name', length: 200 }) byName!: string;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt!: Date;
}

/** طبقة مخزون: كمية دخلت بتاريخ وتشغيلة وصلاحية وتكلفة، يُصرف منها بالأقدم أو الأقرب انتهاءً */
@Entity('pr_stock_layers')
@Index('IDX_pr_stock_layers_item', ['organizationId', 'itemId', 'warehouseId'])
@Index('IDX_pr_stock_layers_source', ['sourceId'])
export class PrStockLayer {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ name: 'organization_id', type: 'uuid' }) organizationId!: string;
  @Column({ name: 'item_id', type: 'uuid' }) itemId!: string;
  @Column({ name: 'warehouse_id', type: 'uuid' }) warehouseId!: string;
  @Column({ name: 'location_id', type: 'uuid', nullable: true }) locationId!: string | null;
  @Column({ type: 'varchar', length: 60, nullable: true }) lot!: string | null;
  @Column({ name: 'expiry_date', type: 'date', nullable: true }) expiryDate!: string | null;
  @Column({ type: 'date' }) date!: string;
  @Column({ name: 'unit_cost', type: 'numeric', precision: 16, scale: 4, transformer: num }) unitCost!: number;
  @Column(qty('qty_in')) qtyIn!: number;
  @Column(qty('qty_left')) qtyLeft!: number;
  /** المستند الذي أدخل الطبقة (استلام أو تحويل أو مرتجع أو زيادة جرد) */
  @Column({ name: 'source_id', type: 'uuid' }) sourceId!: string;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt!: Date;
}

/** رصيد الصنف في المستودع وقيمته (التكلفة المتوسطة = القيمة ÷ الكمية) */
@Entity('pr_stock_balances')
@Index('UQ_pr_stock_balances', ['organizationId', 'itemId', 'warehouseId'], { unique: true })
export class PrStockBalance {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ name: 'organization_id', type: 'uuid' }) organizationId!: string;
  @Column({ name: 'item_id', type: 'uuid' }) itemId!: string;
  @Column({ name: 'warehouse_id', type: 'uuid' }) warehouseId!: string;
  @Column(qty('qty')) qty!: number;
  @Column(money('value')) value!: number;
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' }) updatedAt!: Date;
}

// ---------------- طلبات الصرف ومستندات المخزون ----------------

export interface IssueRequestLine { id: string; itemId: string; qty: number; issuedQty: number; note: string | null }

@Entity('pr_issue_requests')
@Index('UQ_pr_issue_requests_no', ['organizationId', 'requestNo'], { unique: true })
export class PrIssueRequest {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ name: 'organization_id', type: 'uuid' }) organizationId!: string;
  @Column({ name: 'request_no', type: 'int' }) requestNo!: number;
  @Column({ name: 'warehouse_id', type: 'uuid' }) warehouseId!: string;
  @Column({ length: 250 }) purpose!: string;
  @Column({ name: 'unit_id', type: 'uuid', nullable: true }) unitId!: string | null;
  @Column({ name: 'project_id', type: 'uuid', nullable: true }) projectId!: string | null;
  @Column({ name: 'funding_batch_id', type: 'uuid', nullable: true }) fundingBatchId!: string | null;
  /** مركز التكلفة الذي يُحمّل عليه المصروف */
  @Column({ name: 'analytic_id', type: 'uuid', nullable: true }) analyticId!: string | null;
  @Column({ name: 'beneficiary_ref', type: 'varchar', length: 120, nullable: true }) beneficiaryRef!: string | null;
  /** الجهة أو الشخص المستلم */
  @Column({ name: 'receiver_name', type: 'varchar', length: 200, nullable: true }) receiverName!: string | null;
  @Column({ name: 'needed_by', type: 'date', nullable: true }) neededBy!: string | null;
  @Column({ type: 'jsonb', default: () => `'[]'` }) lines!: IssueRequestLine[];
  @Column({ type: 'varchar', length: 10, default: 'draft' }) status!: IssueRequestStatus;
  @Column({ name: 'decision_note', type: 'varchar', length: 1000, nullable: true }) decisionNote!: string | null;
  @Column({ name: 'decided_by_name', type: 'varchar', length: 200, nullable: true }) decidedByName!: string | null;
  @Column({ name: 'requested_by_id', type: 'uuid', nullable: true }) requestedById!: string | null;
  @Column({ name: 'requested_by_name', length: 200 }) requestedByName!: string;
  @Column({ type: 'jsonb', default: () => `'[]'` }) log!: LogEntry[];
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt!: Date;
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' }) updatedAt!: Date;
}

export interface StockDocLine {
  id: string;
  itemId: string;
  qty: number;
  lot: string | null;
  expiryDate: string | null;
  locationId: string | null;
  toLocationId: string | null;
  value: number;
  /** بند طلب الصرف أو بند الاستلام أو بند سند الصرف الأصلي */
  refLineId: string | null;
}

@Entity('pr_stock_docs')
@Index('UQ_pr_stock_docs_no', ['organizationId', 'kind', 'docNo'], { unique: true })
@Index('IDX_pr_stock_docs_ref', ['refId'])
export class PrStockDoc {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ name: 'organization_id', type: 'uuid' }) organizationId!: string;
  @Column({ type: 'varchar', length: 16 }) kind!: StockDocKind;
  @Column({ name: 'doc_no', type: 'int' }) docNo!: number;
  @Column({ type: 'date' }) date!: string;
  @Column({ name: 'warehouse_id', type: 'uuid' }) warehouseId!: string;
  @Column({ name: 'to_warehouse_id', type: 'uuid', nullable: true }) toWarehouseId!: string | null;
  @Column({ name: 'issue_request_id', type: 'uuid', nullable: true }) issueRequestId!: string | null;
  /** الاستلام الأصلي (مرتجع للمورد) أو سند الصرف الأصلي (مرتجع من الجهة) */
  @Column({ name: 'ref_id', type: 'uuid', nullable: true }) refId!: string | null;
  @Column({ name: 'supplier_id', type: 'uuid', nullable: true }) supplierId!: string | null;
  @Column({ name: 'unit_id', type: 'uuid', nullable: true }) unitId!: string | null;
  @Column({ name: 'project_id', type: 'uuid', nullable: true }) projectId!: string | null;
  @Column({ name: 'analytic_id', type: 'uuid', nullable: true }) analyticId!: string | null;
  @Column({ name: 'funding_batch_id', type: 'uuid', nullable: true }) fundingBatchId!: string | null;
  @Column({ name: 'receiver_name', type: 'varchar', length: 200, nullable: true }) receiverName!: string | null;
  @Column({ type: 'varchar', length: 12, nullable: true }) reason!: keyof typeof WRITEOFF_REASONS | null;
  @Column({ type: 'jsonb', default: () => `'[]'` }) lines!: StockDocLine[];
  @Column(money('total')) total!: number;
  /** المرتجع للمورد: ما أُعيد إلى حجز الموازنة ومصدر التمويل */
  @Column(money('budget_back')) budgetBack!: number;
  @Column(money('funding_back')) fundingBack!: number;
  @Column({ type: 'varchar', length: 10, default: 'posted' }) status!: 'pending' | 'posted' | 'cancelled';
  @Column({ name: 'entry_id', type: 'uuid', nullable: true }) entryId!: string | null;
  @Column({ type: 'varchar', length: 2000, nullable: true }) notes!: string | null;
  @Column({ name: 'approved_by_name', type: 'varchar', length: 200, nullable: true }) approvedByName!: string | null;
  @Column({ name: 'cancel_reason', type: 'varchar', length: 1000, nullable: true }) cancelReason!: string | null;
  @Column({ name: 'created_by_id', type: 'uuid', nullable: true }) createdById!: string | null;
  @Column({ name: 'created_by_name', length: 200 }) createdByName!: string;
  @Column({ type: 'jsonb', default: () => `'[]'` }) log!: LogEntry[];
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt!: Date;
}

// ---------------- الجرد ----------------

export interface CountLine {
  itemId: string;
  lot: string | null;
  expiryDate: string | null;
  systemQty: number;
  countedQty: number | null;
  unitCost: number;
  diffQty: number;
  diffValue: number;
  note: string | null;
}

@Entity('pr_counts')
@Index('UQ_pr_counts_no', ['organizationId', 'countNo'], { unique: true })
export class PrCount {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ name: 'organization_id', type: 'uuid' }) organizationId!: string;
  @Column({ name: 'count_no', type: 'int' }) countNo!: number;
  @Column({ type: 'varchar', length: 10 }) kind!: keyof typeof COUNT_KINDS;
  @Column({ name: 'warehouse_id', type: 'uuid' }) warehouseId!: string;
  /** جرد مجموعة أصناف محددة (الجرد المستمر)، وإلا كل الأصناف */
  @Column({ name: 'group_id', type: 'uuid', nullable: true }) groupId!: string | null;
  @Column({ name: 'committee_ids', type: 'jsonb', default: () => `'[]'` }) committeeIds!: string[];
  @Column({ type: 'date' }) date!: string;
  @Column({ type: 'jsonb', default: () => `'[]'` }) lines!: CountLine[];
  @Column({ type: 'varchar', length: 10, default: 'open' }) status!: CountStatus;
  @Column(money('shortage')) shortage!: number;
  @Column(money('surplus')) surplus!: number;
  @Column({ name: 'entry_id', type: 'uuid', nullable: true }) entryId!: string | null;
  @Column({ type: 'varchar', length: 2000, nullable: true }) notes!: string | null;
  @Column({ name: 'approved_by_name', type: 'varchar', length: 200, nullable: true }) approvedByName!: string | null;
  @Column({ name: 'submitted_by_id', type: 'uuid', nullable: true }) submittedById!: string | null;
  @Column({ name: 'created_by_name', length: 200 }) createdByName!: string;
  @Column({ type: 'jsonb', default: () => `'[]'` }) log!: LogEntry[];
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt!: Date;
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' }) updatedAt!: Date;
}

export const STOCK_ENTITIES = [PrReceipt, PrStockMove, PrStockLayer, PrStockBalance, PrIssueRequest, PrStockDoc, PrCount];
