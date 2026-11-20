import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn, ValueTransformer } from 'typeorm';
import { ItemFile, LogEntry } from './procurement.entity';

const num: ValueTransformer = {
  to: (v?: number | null) => v,
  from: (v?: string | null) => (v === null || v === undefined ? null : Number(v)),
};
const money = (name: string) => ({ name, type: 'numeric' as const, precision: 16, scale: 2, transformer: num, default: 0 });

// ---------------- القوائم الثابتة ----------------

export const INVOICE_KINDS = { invoice: 'فاتورة', credit_note: 'إشعار دائن' } as const;
export type InvoiceKind = keyof typeof INVOICE_KINDS;

/**
 * دورة الفاتورة: يرفعها المورد من البوابة أو يسجلها الموظف، فتُراجع وتُطابق مع التعميد والاستلام (المطابقة الثلاثية)،
 * ثم تُعتمد وتُحال للنظام المالي الذي يسجل المستحق ثم يسدده بسندات صرف.
 */
export const INVOICE_STATUS = {
  draft: 'مسودة', submitted: 'بانتظار المراجعة والمطابقة', returned: 'معادة للمورد للتصحيح', rejected: 'مرفوضة',
  approved: 'مطابقة ومحالة للمالي', posted: 'سُجل المستحق', partial: 'مسددة جزئيًا', paid: 'مسددة', cancelled: 'ملغاة',
} as const;
export type InvoiceStatus = keyof typeof INVOICE_STATUS;
/** الحالات التي تُحتسب فيها الفاتورة على كميات التعميد ورصيد المورد */
export const LIVE_INVOICE: InvoiceStatus[] = ['submitted', 'approved', 'posted', 'partial', 'paid'];
/** الحالات المسجلة في النظام المالي */
export const BOOKED_INVOICE: InvoiceStatus[] = ['posted', 'partial', 'paid'];

/** أنواع استثناءات المطابقة */
export const MATCH_ISSUES = {
  qty: 'كمية أكبر من المستلم غير المفوتر',
  price: 'سعر أعلى من سعر التعميد',
  extra: 'مصاريف أكبر من مصاريف الاستلام غير المفوترة',
  duplicate: 'فاتورة مكررة محتملة',
  total: 'إجمالي الفاتورة لا يساوي بنودها',
  credit: 'الإشعار الدائن أكبر من المتبقي على الفاتورة',
} as const;
export type MatchIssueKind = keyof typeof MATCH_ISSUES;

export interface MatchIssue { kind: MatchIssueKind; message: string; lineId?: string | null }
/** نتيجة المطابقة الثلاثية كما ظهرت وقت الإجراء */
export interface MatchResult { ok: boolean; issues: MatchIssue[]; at: string }

export interface InvoiceLine {
  id: string;
  orderLineId: string;
  description: string;
  /** الكمية المفوترة (للإشعار الدائن: الكمية المخصومة) */
  qty: number;
  /** سعر الوحدة قبل الضريبة في الفاتورة */
  unitPrice: number;
  amount: number;
  /** سعر الوحدة في التعميد وقت الفاتورة */
  orderPrice: number;
}

export interface InvoiceMessage { from: 'supplier' | 'staff'; byName: string; text: string; at: string }

export interface InvoiceOverride { byName: string; reason: string; at: string }

@Entity('pr_invoices')
@Index('UQ_pr_invoices_no', ['organizationId', 'invoiceNo'], { unique: true })
@Index('IDX_pr_invoices_supplier', ['organizationId', 'supplierId', 'status'])
@Index('IDX_pr_invoices_order', ['organizationId', 'orderId'])
@Index('IDX_pr_invoices_key', ['organizationId', 'supplierId', 'supplierKey'])
export class PrInvoice {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ name: 'organization_id', type: 'uuid' }) organizationId!: string;
  @Column({ name: 'invoice_no', type: 'int' }) invoiceNo!: number;
  @Column({ type: 'varchar', length: 12, default: 'invoice' }) kind!: InvoiceKind;
  @Column({ name: 'order_id', type: 'uuid' }) orderId!: string;
  @Column({ name: 'supplier_id', type: 'uuid' }) supplierId!: string;
  /** الفاتورة الأصلية التي يخصم منها الإشعار الدائن */
  @Column({ name: 'ref_invoice_id', type: 'uuid', nullable: true }) refInvoiceId!: string | null;
  /** رقم فاتورة المورد كما في مستنده */
  @Column({ name: 'supplier_invoice_no', type: 'varchar', length: 60 }) supplierInvoiceNo!: string;
  /** الرقم بعد التوحيد (بلا مسافات ورموز وأصفار بادئة) لكشف التكرار */
  @Column({ name: 'supplier_key', type: 'varchar', length: 60 }) supplierKey!: string;
  @Column({ name: 'invoice_date', type: 'date' }) invoiceDate!: string;
  @Column({ name: 'due_date', type: 'date', nullable: true }) dueDate!: string | null;
  @Column({ type: 'jsonb', default: () => `'[]'` }) lines!: InvoiceLine[];
  /** مصاريف النقل والتخليص المفوترة من المورد نفسه (قبل الضريبة) */
  @Column(money('extra_amount')) extraAmount!: number;
  @Column({ name: 'vat_rate', type: 'numeric', precision: 5, scale: 2, transformer: num, default: 15 }) vatRate!: number;
  @Column(money('subtotal')) subtotal!: number;
  @Column(money('vat')) vat!: number;
  @Column(money('total')) total!: number;
  @Column({ type: 'varchar', length: 10, default: 'draft' }) status!: InvoiceStatus;
  @Column({ type: 'jsonb', nullable: true }) match!: MatchResult | null;
  /** اعتماد الفاتورة رغم استثناءات المطابقة بصلاحية خاصة وسبب */
  @Column({ type: 'jsonb', nullable: true }) override!: InvoiceOverride | null;
  @Column({ type: 'varchar', length: 8, default: 'portal' }) via!: 'portal' | 'staff';
  @Column({ type: 'jsonb', default: () => `'[]'` }) attachments!: ItemFile[];
  @Column({ type: 'jsonb', default: () => `'[]'` }) messages!: InvoiceMessage[];
  @Column({ type: 'varchar', length: 2000, nullable: true }) notes!: string | null;
  @Column({ name: 'return_reason', type: 'varchar', length: 1000, nullable: true }) returnReason!: string | null;
  @Column({ name: 'submitted_at', type: 'timestamptz', nullable: true }) submittedAt!: Date | null;
  @Column({ name: 'approved_by_id', type: 'uuid', nullable: true }) approvedById!: string | null;
  @Column({ name: 'approved_by_name', type: 'varchar', length: 200, nullable: true }) approvedByName!: string | null;
  @Column({ name: 'approved_at', type: 'timestamptz', nullable: true }) approvedAt!: Date | null;
  /** قيد فاتورة المورد في النظام المالي */
  @Column({ name: 'entry_id', type: 'uuid', nullable: true }) entryId!: string | null;
  @Column({ name: 'posted_by_name', type: 'varchar', length: 200, nullable: true }) postedByName!: string | null;
  @Column({ name: 'posted_at', type: 'timestamptz', nullable: true }) postedAt!: Date | null;
  /** المسدد بسندات صرف معتمدة */
  @Column(money('paid_amount')) paidAmount!: number;
  /** المخصوم بإشعارات دائنة مسجلة */
  @Column(money('credited_amount')) creditedAmount!: number;
  /** فرق سعر الفاتورة عن التعميد (شامل الضريبة) المحمّل على بند الموازنة عند تسجيلها، والسالب يُعيد للبند */
  @Column(money('budget_diff')) budgetDiff!: number;
  /** ما حُمّل من الفرق على مصدر التمويل */
  @Column(money('funding_diff')) fundingDiff!: number;
  @Column({ name: 'budget_commitment_id', type: 'uuid', nullable: true }) budgetCommitmentId!: string | null;
  /** حركات الإضافة على الأصول الثابتة بفرق السعر (لبنود الأصول) */
  @Column({ name: 'asset_move_ids', type: 'jsonb', default: () => `'[]'` }) assetMoveIds!: string[];
  @Column({ name: 'created_by_id', type: 'uuid', nullable: true }) createdById!: string | null;
  /** الموظفون الذين سجلوا الفاتورة أو عدلوها أو أرسلوها: لا يعتمدون مطابقتها ولا يسجلون مستحقها (فصل المهام) */
  @Column({ name: 'editor_ids', type: 'jsonb', default: () => `'[]'` }) editorIds!: string[];
  @Column({ name: 'created_by_name', length: 200 }) createdByName!: string;
  @Column({ type: 'jsonb', default: () => `'[]'` }) log!: LogEntry[];
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt!: Date;
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' }) updatedAt!: Date;
}

export const INVOICE_ENTITIES = [PrInvoice];
