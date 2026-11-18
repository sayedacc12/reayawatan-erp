import {
  Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, OneToMany, PrimaryColumn, PrimaryGeneratedColumn, UpdateDateColumn,
} from 'typeorm';
import { ValueTransformer } from 'typeorm';

/** PostgreSQL يرجّع numeric كنص؛ نحوله لرقم */
const num: ValueTransformer = {
  to: (v?: number | null) => v,
  from: (v?: string | null) => (v === null || v === undefined ? null : Number(v)),
};
const money = (name: string, nullable = false) => ({
  name, type: 'numeric' as const, precision: 16, scale: 2, transformer: num, nullable, ...(nullable ? {} : { default: 0 }),
});

export const NATURES = ['assets', 'liabilities', 'net_assets', 'revenue', 'expenses'] as const;
export type AccountNature = (typeof NATURES)[number];
export const ACCOUNT_KINDS = ['root', 'main', 'sub'] as const;
export type AccountKind = (typeof ACCOUNT_KINDS)[number];
export const VOUCHER_TYPES = ['journal', 'receipt', 'payment', 'opening', 'adjustment'] as const;
export type BuiltinVoucherType = (typeof VOUCHER_TYPES)[number];
/** نوع المستند: أحد الأنواع الأساسية، أو نوع سند خاص بالجمعية يُعرَّف من الإعدادات (رمزه يبدأ بـ d_) */
export type VoucherType = BuiltinVoucherType | `d_${string}`;
/** صيغة رمز نوع السند الخاص بالجمعية */
export const CUSTOM_TYPE_RE = /^d_[a-z0-9]{6,16}$/;
export type EntryStatus = 'draft' | 'posted' | 'cancelled';
export type FiscalYearStatus = 'open' | 'closed';

/** إعدادات النظام المحاسبي لكل جمعية */
@Entity('acc_settings')
export class AccountingSettings {
  @PrimaryColumn({ name: 'organization_id', type: 'uuid' })
  organizationId!: string;

  /** الرقم التالي لرمز القيد الرئيسي (رمز 1): فريد لكل القيود ولا يُعاد استخدامه */
  @Column({ name: 'next_entry_no', type: 'int', default: 1 })
  nextEntryNo!: number;

  /** عدد مستويات الحسابات التحليلية: 2 (رئيسي وفرعي) أو 3 (رئيسي ورئيسي وفرعي) */
  @Column({ name: 'analytic_levels', type: 'int', default: 3 })
  analyticLevels!: number;

  /** حساب صافي الأصول الذي تُقفل فيه نتائج النشاط عند فتح سنة جديدة */
  @Column({ name: 'closing_account_id', type: 'uuid', nullable: true })
  closingAccountId!: string | null;

  /** أنواع المستودعات (مبدئية حتى تصل إعدادات المستودعات) */
  @Column({ name: 'warehouse_types', type: 'jsonb', default: () => `'["مستودع رئيسي", "مستودع فرعي", "مستودع التبرعات العينية"]'` })
  warehouseTypes!: string[];

  /** تاريخ تنصيب الدليل الموحد (null = لم يُنصّب) */
  @Column({ name: 'chart_installed_at', type: 'timestamptz', nullable: true })
  chartInstalledAt!: Date | null;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}

/** السنة المالية */
@Entity('acc_fiscal_years')
@Index('UQ_acc_fiscal_years_org_name', ['organizationId', 'name'], { unique: true })
export class FiscalYear {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId!: string;

  /** اسم السنة، مثل 2026 */
  @Column({ type: 'int' })
  name!: number;

  @Column({ name: 'start_date', type: 'date' })
  startDate!: string;

  @Column({ name: 'end_date', type: 'date' })
  endDate!: string;

  /** السنة المالية الأولى للجمعية في النظام */
  @Column({ name: 'is_first', default: false })
  isFirst!: boolean;

  @Column({ type: 'varchar', length: 10, default: 'open' })
  status!: FiscalYearStatus;

  @Column({ name: 'closed_at', type: 'timestamptz', nullable: true })
  closedAt!: Date | null;

  @Column({ name: 'closed_by_name', type: 'varchar', length: 200, nullable: true })
  closedByName!: string | null;

  /** آخر فك إغلاق للسنة (يظهر تنبيه اختلاف الأرصدة لو تغيرت بعده) */
  @Column({ name: 'reopened_at', type: 'timestamptz', nullable: true })
  reopenedAt!: Date | null;

  @Column({ name: 'reopened_by_name', type: 'varchar', length: 200, nullable: true })
  reopenedByName!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}

/** شهر مغلق داخل سنة مالية */
@Entity('acc_period_locks')
@Index('UQ_acc_period_locks', ['organizationId', 'month'], { unique: true })
export class PeriodLock {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId!: string;

  @Column({ name: 'fiscal_year_id', type: 'uuid' })
  fiscalYearId!: string;

  @ManyToOne(() => FiscalYear, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'fiscal_year_id' })
  fiscalYear?: FiscalYear;

  /** الشهر بصيغة YYYY-MM */
  @Column({ length: 7 })
  month!: string;

  @Column({ name: 'closed_by_name', type: 'varchar', length: 200 })
  closedByName!: string;

  @CreateDateColumn({ name: 'closed_at', type: 'timestamptz' })
  closedAt!: Date;
}

/** تسلسل أرقام السندات (رمز 2) لكل نوع سند في كل سنة مالية، مع المدى المحدد له */
@Entity('acc_voucher_sequences')
@Index('UQ_acc_voucher_sequences', ['fiscalYearId', 'voucherType'], { unique: true })
export class VoucherSequence {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId!: string;

  @Column({ name: 'fiscal_year_id', type: 'uuid' })
  fiscalYearId!: string;

  @ManyToOne(() => FiscalYear, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'fiscal_year_id' })
  fiscalYear?: FiscalYear;

  @Column({ name: 'voucher_type', type: 'varchar', length: 20 })
  voucherType!: VoucherType;

  /** أول رقم في المدى */
  @Column({ name: 'start_serial', type: 'int', default: 1 })
  startSerial!: number;

  /** آخر رقم مسموح في المدى (null = بدون حد) */
  @Column({ name: 'end_serial', type: 'int', nullable: true })
  endSerial!: number | null;

  /** الرقم التالي الذي سيُحجز */
  @Column({ name: 'next_serial', type: 'int', default: 1 })
  nextSerial!: number;
}

/** حساب في الدليل المحاسبي: جذري ← رئيسي ← فرعي، حتى 9 مستويات */
@Entity('acc_accounts')
@Index('UQ_acc_accounts_org_code', ['organizationId', 'code'], { unique: true })
export class Account {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId!: string;

  @Column({ length: 30 })
  code!: string;

  @Column({ length: 250 })
  name!: string;

  @Column({ type: 'varchar', length: 10 })
  kind!: AccountKind;

  @Column({ type: 'varchar', length: 20 })
  nature!: AccountNature;

  @Column({ name: 'parent_id', type: 'uuid', nullable: true })
  parentId!: string | null;

  @ManyToOne(() => Account, { onDelete: 'RESTRICT', nullable: true })
  @JoinColumn({ name: 'parent_id' })
  parent?: Account | null;

  @Column({ type: 'int' })
  level!: number;

  /** يلزم إدخال حساب تحليلي عند التسجيل على هذا الحساب */
  @Column({ name: 'requires_analytic', default: false })
  requiresAnalytic!: boolean;

  @Column({ type: 'varchar', length: 1000, nullable: true })
  description!: string | null;

  @Column({ name: 'is_active', default: true })
  isActive!: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}

/** حساب تحليلي (مركز تكلفة): رئيسي أو فرعي، حتى 3 مستويات، والتسجيل على الفرعي فقط */
@Entity('acc_analytic_accounts')
@Index('UQ_acc_analytic_org_code', ['organizationId', 'code'], { unique: true })
export class AnalyticAccount {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId!: string;

  @Column({ length: 30 })
  code!: string;

  @Column({ length: 250 })
  name!: string;

  @Column({ type: 'varchar', length: 10 })
  kind!: 'main' | 'sub';

  @Column({ name: 'parent_id', type: 'uuid', nullable: true })
  parentId!: string | null;

  @ManyToOne(() => AnalyticAccount, { onDelete: 'RESTRICT', nullable: true })
  @JoinColumn({ name: 'parent_id' })
  parent?: AnalyticAccount | null;

  @Column({ type: 'int' })
  level!: number;

  @Column({ type: 'varchar', length: 1000, nullable: true })
  description!: string | null;

  @Column({ name: 'is_active', default: true })
  isActive!: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}

export type PartnerBehavior = 'customer' | 'supplier' | 'other';

/** تصنيف الشركاء (عملاء، موردون، أو أي تصنيف يضيفه المستخدم) */
@Entity('acc_partner_categories')
export class PartnerCategory {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId!: string;

  @Column({ length: 120 })
  name!: string;

  /** customer: حد ائتماني وحساب مدينين، supplier: حساب دائنين، other: حساب اختياري */
  @Column({ type: 'varchar', length: 12 })
  behavior!: PartnerBehavior;

  @Column({ name: 'sort_order', type: 'int', default: 0 })
  sortOrder!: number;
}

export interface PartnerAddress { label: string; address: string; city?: string | null }

/** شريك: عميل أو مورد أو غيره، مربوط بحساب في الدليل */
@Entity('acc_partners')
@Index('IDX_acc_partners_org', ['organizationId', 'name'])
export class Partner {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId!: string;

  @Column({ name: 'partner_no', type: 'int' })
  partnerNo!: number;

  @Column({ length: 250 })
  name!: string;

  @Column({ name: 'category_id', type: 'uuid' })
  categoryId!: string;

  @ManyToOne(() => PartnerCategory, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'category_id' })
  category?: PartnerCategory;

  @Column({ type: 'varchar', length: 1000, nullable: true })
  description!: string | null;

  @Column({ type: 'jsonb', default: () => `'[]'` })
  phones!: string[];

  @Column({ type: 'jsonb', default: () => `'[]'` })
  emails!: string[];

  @Column({ type: 'jsonb', default: () => `'[]'` })
  addresses!: PartnerAddress[];

  /** الرقم الضريبي */
  @Column({ name: 'tax_number', type: 'varchar', length: 30, nullable: true })
  taxNumber!: string | null;

  /** السجل التجاري */
  @Column({ name: 'cr_number', type: 'varchar', length: 30, nullable: true })
  crNumber!: string | null;

  /** الحساب المرتبط في الدليل (المدينون للعميل، الدائنون للمورد) */
  @Column({ name: 'account_id', type: 'uuid', nullable: true })
  accountId!: string | null;

  @ManyToOne(() => Account, { onDelete: 'RESTRICT', nullable: true })
  @JoinColumn({ name: 'account_id' })
  account?: Account | null;

  /** الحد الائتماني للعميل */
  @Column(money('credit_limit', true))
  creditLimit!: number | null;

  @Column({ name: 'is_active', default: true })
  isActive!: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}

/** حساب بنكي أو صندوق نقدية، مربوط بحساب فرعي في الدليل */
@Entity('acc_cash_accounts')
@Index('UQ_acc_cash_accounts_gl', ['organizationId', 'glAccountId'], { unique: true })
export class CashAccount {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId!: string;

  @Column({ type: 'varchar', length: 10 })
  kind!: 'bank' | 'cash';

  @Column({ length: 200 })
  name!: string;

  @Column({ name: 'bank_name', type: 'varchar', length: 200, nullable: true })
  bankName!: string | null;

  @Column({ name: 'account_number', type: 'varchar', length: 60, nullable: true })
  accountNumber!: string | null;

  @Column({ type: 'varchar', length: 34, nullable: true })
  iban!: string | null;

  @Column({ type: 'varchar', length: 500, nullable: true })
  description!: string | null;

  @Column({ name: 'gl_account_id', type: 'uuid' })
  glAccountId!: string;

  @ManyToOne(() => Account, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'gl_account_id' })
  glAccount?: Account;

  @Column({ name: 'is_active', default: true })
  isActive!: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}

/** مستودع مربوط بحساب في الدليل (تفاصيل المستودعات تصل لاحقًا) */
@Entity('acc_warehouses')
export class Warehouse {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId!: string;

  @Column({ length: 200 })
  name!: string;

  @Column({ type: 'varchar', length: 120 })
  type!: string;

  @Column({ type: 'varchar', length: 500, nullable: true })
  description!: string | null;

  @Column({ name: 'gl_account_id', type: 'uuid' })
  glAccountId!: string;

  @ManyToOne(() => Account, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'gl_account_id' })
  glAccount?: Account;

  @Column({ name: 'is_active', default: true })
  isActive!: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}

/** توزيع تحليلي على سطر القيد: أكثر من حساب تحليلي بنسب مجموعها 100% */
export interface AnalyticShare { analyticId: string; percent: number }

/** القيد / السند */
@Entity('acc_entries')
@Index('UQ_acc_entries_org_no', ['organizationId', 'entryNo'], { unique: true })
@Index('UQ_acc_entries_voucher', ['fiscalYearId', 'voucherType', 'voucherSerial'], { unique: true, where: `status <> 'cancelled'` })
@Index('IDX_acc_entries_org_date', ['organizationId', 'documentDate'])
export class JournalEntry {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId!: string;

  /** رمز 1: رقم القيد الرئيسي، فريد لكل القيود ولا يُحذف */
  @Column({ name: 'entry_no', type: 'int' })
  entryNo!: number;

  @Column({ name: 'fiscal_year_id', type: 'uuid' })
  fiscalYearId!: string;

  @ManyToOne(() => FiscalYear, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'fiscal_year_id' })
  fiscalYear?: FiscalYear;

  @Column({ name: 'voucher_type', type: 'varchar', length: 20 })
  voucherType!: VoucherType;

  /** رمز 2: رقم السند في تسلسل نوعه */
  @Column({ name: 'voucher_serial', type: 'int' })
  voucherSerial!: number;

  /** تاريخ اليوم (تاريخ الإدخال) */
  @Column({ name: 'entry_date', type: 'date' })
  entryDate!: string;

  /** تاريخ المستند: يحدد السنة والشهر */
  @Column({ name: 'document_date', type: 'date' })
  documentDate!: string;

  @Column({ type: 'varchar', length: 1000 })
  description!: string;

  /** المستلم منه أو المصروف له (للسندات) */
  @Column({ type: 'varchar', length: 250, nullable: true })
  counterparty!: string | null;

  @Column({ type: 'varchar', length: 12, default: 'draft' })
  status!: EntryStatus;

  /** manual: يدوي، system: قيد آلي (القيد الافتتاحي عند فتح سنة جديدة)، voucher: ناتج عن اعتماد سند قبض أو صرف */
  @Column({ type: 'varchar', length: 10, default: 'manual' })
  source!: 'manual' | 'system' | 'voucher';

  /** السند الذي نتج عنه القيد */
  @Column({ name: 'voucher_id', type: 'uuid', nullable: true })
  voucherId!: string | null;

  @Column(money('total'))
  total!: number;

  @Column({ name: 'created_by_id', type: 'uuid', nullable: true })
  createdById!: string | null;

  @Column({ name: 'created_by_name', type: 'varchar', length: 200 })
  createdByName!: string;

  @Column({ name: 'posted_at', type: 'timestamptz', nullable: true })
  postedAt!: Date | null;

  @Column({ name: 'posted_by_name', type: 'varchar', length: 200, nullable: true })
  postedByName!: string | null;

  /** طلب إلغاء سند قبض (الاعتماد الأول)، ينتظر الاعتماد الثاني */
  @Column({ name: 'cancel_requested_by_id', type: 'uuid', nullable: true })
  cancelRequestedById!: string | null;

  @Column({ name: 'cancel_requested_by_name', type: 'varchar', length: 200, nullable: true })
  cancelRequestedByName!: string | null;

  @Column({ name: 'cancel_requested_at', type: 'timestamptz', nullable: true })
  cancelRequestedAt!: Date | null;

  @Column({ name: 'cancel_reason', type: 'varchar', length: 1000, nullable: true })
  cancelReason!: string | null;

  @Column({ name: 'cancelled_at', type: 'timestamptz', nullable: true })
  cancelledAt!: Date | null;

  @Column({ name: 'cancelled_by_name', type: 'varchar', length: 200, nullable: true })
  cancelledByName!: string | null;

  @OneToMany(() => JournalLine, (l) => l.entry)
  lines?: JournalLine[];

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}

/** سطر القيد: مدين أو دائن فقط، على حساب فرعي */
@Entity('acc_entry_lines')
@Index('IDX_acc_entry_lines_account', ['organizationId', 'accountId'])
@Index('IDX_acc_entry_lines_partner', ['organizationId', 'partnerId'])
export class JournalLine {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId!: string;

  @Column({ name: 'entry_id', type: 'uuid' })
  entryId!: string;

  @ManyToOne(() => JournalEntry, (e) => e.lines, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'entry_id' })
  entry?: JournalEntry;

  @Column({ name: 'line_no', type: 'int' })
  lineNo!: number;

  @Column({ name: 'account_id', type: 'uuid' })
  accountId!: string;

  @ManyToOne(() => Account, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'account_id' })
  account?: Account;

  @Column(money('debit'))
  debit!: number;

  @Column(money('credit'))
  credit!: number;

  /** البيان */
  @Column({ type: 'varchar', length: 500, nullable: true })
  label!: string | null;

  @Column({ name: 'partner_id', type: 'uuid', nullable: true })
  partnerId!: string | null;

  @ManyToOne(() => Partner, { onDelete: 'RESTRICT', nullable: true })
  @JoinColumn({ name: 'partner_id' })
  partner?: Partner | null;

  @Column({ type: 'jsonb', default: () => `'[]'` })
  analytic!: AnalyticShare[];
}

export interface InventoryRow {
  voucherType: VoucherType;
  first: number | null;
  last: number | null;
  count: number;
  posted: number;
  cancelled: number;
  draft: number;
  /** أرقام غير موجودة داخل المدى (يجب ألا توجد لأن الأرقام لا تُحذف) */
  missing: number[];
}

/** محضر جرد السندات الإلكتروني في نهاية السنة، يعتمده مدير النظام بنفسه */
@Entity('acc_voucher_inventories')
@Index('UQ_acc_voucher_inventories_year', ['fiscalYearId'], { unique: true })
export class VoucherInventory {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId!: string;

  @Column({ name: 'fiscal_year_id', type: 'uuid' })
  fiscalYearId!: string;

  @ManyToOne(() => FiscalYear, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'fiscal_year_id' })
  fiscalYear?: FiscalYear;

  @Column({ type: 'varchar', length: 12, default: 'draft' })
  status!: 'draft' | 'approved';

  @Column({ type: 'jsonb' })
  rows!: InventoryRow[];

  @Column({ type: 'varchar', length: 1000, nullable: true })
  notes!: string | null;

  @Column({ name: 'prepared_by_name', type: 'varchar', length: 200 })
  preparedByName!: string;

  @Column({ name: 'prepared_at', type: 'timestamptz' })
  preparedAt!: Date;

  @Column({ name: 'approved_by_name', type: 'varchar', length: 200, nullable: true })
  approvedByName!: string | null;

  @Column({ name: 'approved_at', type: 'timestamptz', nullable: true })
  approvedAt!: Date | null;
}

export type VoucherKind = 'receipt' | 'payment';
export type VoucherStatus = 'draft' | 'pending' | 'returned' | 'approved' | 'rejected' | 'cancelled';
export type VoucherMethod = 'cash' | 'transfer' | 'cheque' | 'card';
export type VoucherSource = 'manual' | 'opportunity' | 'store' | 'payroll' | 'membership' | 'separation' | 'comms';

/** مرحلة من مراحل اعتماد سندات القبض أو الصرف (مستقلة لكل نوع) */
@Entity('acc_voucher_stages')
@Index('IDX_acc_voucher_stages_org', ['organizationId', 'kind', 'sortOrder'])
export class VoucherStage {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId!: string;

  @Column({ type: 'varchar', length: 10 })
  kind!: VoucherKind;

  @Column({ length: 200 })
  name!: string;

  @Column({ type: 'varchar', length: 1000, nullable: true })
  instructions!: string | null;

  @Column({ name: 'sort_order', type: 'int' })
  sortOrder!: number;

  /** الدور المسؤول عن القرار (فارغ = أي مستخدم معه صلاحية اعتماد السندات) */
  @Column({ name: 'role_id', type: 'uuid', nullable: true })
  roleId!: string | null;
}

/** سند قبض أو سند صرف: يمر بمراحل الاعتماد، وعند الاعتماد النهائي يصدر عنه قيد يومية مرحّل */
@Entity('acc_vouchers')
@Index('UQ_acc_vouchers_serial', ['fiscalYearId', 'kind', 'serial'], { unique: true })
@Index('IDX_acc_vouchers_org', ['organizationId', 'kind', 'voucherDate'])
export class Voucher {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId!: string;

  @Column({ type: 'varchar', length: 10 })
  kind!: VoucherKind;

  @Column({ name: 'fiscal_year_id', type: 'uuid' })
  fiscalYearId!: string;

  @ManyToOne(() => FiscalYear, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'fiscal_year_id' })
  fiscalYear?: FiscalYear;

  /** رقم السند (سيريال مستمر، لا يُحذف بحذف السند ولا يُعاد استخدامه) */
  @Column({ type: 'int' })
  serial!: number;

  @Column({ name: 'voucher_date', type: 'date' })
  voucherDate!: string;

  /** من السادة (القبض) / اصرفوا إلى السادة (الصرف) */
  @Column({ name: 'party_name', length: 250 })
  partyName!: string;

  @Column({ name: 'partner_id', type: 'uuid', nullable: true })
  partnerId!: string | null;

  @ManyToOne(() => Partner, { onDelete: 'RESTRICT', nullable: true })
  @JoinColumn({ name: 'partner_id' })
  partner?: Partner | null;

  @Column(money('amount'))
  amount!: number;

  /** وهو قيمة ... */
  @Column({ type: 'varchar', length: 1000 })
  purpose!: string;

  /** مصدر الشرح: يدوي، أو فرصة تبرع أو المتجر (يُربط آليًا لاحقًا) */
  @Column({ name: 'source_type', type: 'varchar', length: 12, default: 'manual' })
  sourceType!: VoucherSource;

  /** مرجع المصدر عند الربط لاحقًا (رقم فرصة التبرع أو طلب المتجر) */
  @Column({ name: 'source_ref', type: 'varchar', length: 120, nullable: true })
  sourceRef!: string | null;

  /** المشروع الذي يُبوَّب عليه المبلغ (نصي حتى الربط بإدارة المشاريع) */
  @Column({ name: 'project_name', type: 'varchar', length: 250, nullable: true })
  projectName!: string | null;

  @Column({ type: 'varchar', length: 10, default: 'cash' })
  method!: VoucherMethod;

  /** رقم الشيك أو الحوالة */
  @Column({ name: 'method_ref', type: 'varchar', length: 120, nullable: true })
  methodRef!: string | null;

  /** الحساب المستلم عليه أو المصروف منه (بنك أو صندوق) */
  @Column({ name: 'cash_account_id', type: 'uuid' })
  cashAccountId!: string;

  @ManyToOne(() => CashAccount, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'cash_account_id' })
  cashAccount?: CashAccount;

  /** الطرف المقابل في حسابات الجمعية (الدائن في القبض، المدين في الصرف) */
  @Column({ name: 'counter_account_id', type: 'uuid' })
  counterAccountId!: string;

  @ManyToOne(() => Account, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'counter_account_id' })
  counterAccount?: Account;

  @Column({ type: 'jsonb', default: () => `'[]'` })
  analytic!: AnalyticShare[];

  @Column({ type: 'varchar', length: 12, default: 'draft' })
  status!: VoucherStatus;

  @Column({ name: 'current_stage_id', type: 'uuid', nullable: true })
  currentStageId!: string | null;

  /** القيد المرحّل الحالي الناتج عن السند */
  @Column({ name: 'entry_id', type: 'uuid', nullable: true })
  entryId!: string | null;

  /** طلب إعادة للمسودة أو إلغاء (سند القبض باعتماد ثنائي) */
  @Column({ name: 'request_kind', type: 'varchar', length: 10, nullable: true })
  requestKind!: 'draft' | 'cancel' | null;

  @Column({ name: 'request_by_id', type: 'uuid', nullable: true })
  requestById!: string | null;

  @Column({ name: 'request_by_name', type: 'varchar', length: 200, nullable: true })
  requestByName!: string | null;

  @Column({ name: 'request_reason', type: 'varchar', length: 1000, nullable: true })
  requestReason!: string | null;

  @Column({ name: 'request_at', type: 'timestamptz', nullable: true })
  requestAt!: Date | null;

  @Column({ name: 'created_by_id', type: 'uuid', nullable: true })
  createdById!: string | null;

  @Column({ name: 'created_by_name', type: 'varchar', length: 200 })
  createdByName!: string;

  @Column({ name: 'approved_at', type: 'timestamptz', nullable: true })
  approvedAt!: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}

/** سجل إجراءات السند: إنشاء، إرسال، موافقة، رفض، إرجاع، إعادة للمسودة، إلغاء */
@Entity('acc_voucher_actions')
@Index('IDX_acc_voucher_actions_voucher', ['voucherId', 'createdAt'])
export class VoucherAction {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId!: string;

  @Column({ name: 'voucher_id', type: 'uuid' })
  voucherId!: string;

  @ManyToOne(() => Voucher, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'voucher_id' })
  voucher?: Voucher;

  @Column({ type: 'varchar', length: 20 })
  action!: string;

  @Column({ name: 'stage_name', type: 'varchar', length: 200, nullable: true })
  stageName!: string | null;

  @Column({ type: 'varchar', length: 1000, nullable: true })
  note!: string | null;

  @Column({ name: 'actor_id', type: 'uuid', nullable: true })
  actorId!: string | null;

  @Column({ name: 'actor_name', type: 'varchar', length: 200 })
  actorName!: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}

/**
 * أنواع سندات خاصة بالجمعية (مثل سند قيد عهدة، أو سند تسوية مخزون): تُعرَّف من الإعدادات وتظهر تحت «العمليات»،
 * وتعمل مثل قيد اليومية بتسلسل أرقام مستقل يبدأ من 1 كل سنة، وتدخل في الترحيل ومحضر الجرد. لا تُحذف بعد استخدامها بل توقف.
 */
@Entity('acc_document_types')
@Index('UQ_acc_document_types_code', ['organizationId', 'code'], { unique: true })
@Index('UQ_acc_document_types_name', ['organizationId', 'name'], { unique: true })
export class DocumentType {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId!: string;

  @Column({ length: 20 })
  code!: `d_${string}`;

  @Column({ length: 80 })
  name!: string;

  @Column({ type: 'varchar', length: 300, nullable: true })
  description!: string | null;

  @Column({ name: 'is_active', default: true })
  isActive!: boolean;

  @Column({ name: 'sort_order', type: 'int', default: 0 })
  sortOrder!: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}

export const ACCOUNTING_ENTITIES = [
  DocumentType, VoucherStage, Voucher, VoucherAction,
  AccountingSettings, FiscalYear, PeriodLock, VoucherSequence, Account, AnalyticAccount, PartnerCategory, Partner,
  CashAccount, Warehouse, JournalEntry, JournalLine, VoucherInventory,
];
