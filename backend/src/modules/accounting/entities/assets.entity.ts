import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn, ValueTransformer } from 'typeorm';

/**
 * الأصول الثابتة: تبويب مستقل داخل النظام المالي.
 * المجموعة تحدد التوجيه المحاسبي (حساب الأصل ومجمع الإهلاك ومصروف الإهلاك وأرباح وخسائر البيع) وطريقة الإهلاك ونسبته،
 * والأصل يتبع مجموعة، وكل حركة على تكلفته أو مجمع إهلاكه مسجلة في جدول حركات مستقل.
 */
const num: ValueTransformer = {
  to: (v?: number | null) => v,
  from: (v?: string | null) => (v === null || v === undefined ? null : Number(v)),
};
const money = (name: string, nullable = false) => ({
  name, type: 'numeric' as const, precision: 16, scale: 2, transformer: num, nullable, ...(nullable ? {} : { default: 0 }),
});

export const DEP_METHODS = ['straight_line', 'declining', 'accelerated'] as const;
export type DepMethod = (typeof DEP_METHODS)[number];
export const FIELD_TYPES = ['text', 'number', 'date', 'select'] as const;
export type AssetFieldType = (typeof FIELD_TYPES)[number];

/** حقل مرن يُعرَّف على مستوى المجموعة (مثل رقم اللوحة وتاريخ انتهاء الترخيص للسيارات) */
export interface AssetFieldDef {
  key: string;
  label: string;
  type: AssetFieldType;
  required: boolean;
  options?: string[];
  /** للحقول من نوع التاريخ: تنبيه قبل الانتهاء */
  expiry?: boolean;
}

/** عقد صيانة مسجل على الأصل */
export interface MaintenanceContract {
  id: string;
  provider: string;
  startDate: string;
  endDate: string;
  cost: number;
  notes: string | null;
}

export interface StoredImage { key: string; mime: string; name: string }

/** وثيقة تأمين الأصل */
export interface AssetInsurance {
  provider: string;
  policyNo: string | null;
  startDate: string;
  endDate: string;
  cost: number;
  coverage: number;
  notes: string | null;
}

/** ضمان المورد أو الشركة المصنعة */
export interface AssetWarranty {
  provider: string;
  startDate: string | null;
  endDate: string;
  notes: string | null;
}

/** خطة الصيانة الوقائية: كل كم شهر، وموعد الصيانة القادمة */
export interface MaintenancePlan {
  intervalMonths: number;
  nextDate: string;
  notes: string | null;
}

/** مجموعة أصول: مباني، سيارات، أجهزة حاسب... */
@Entity('acc_asset_groups')
@Index('UQ_acc_asset_groups_code', ['organizationId', 'code'], { unique: true })
export class AssetGroup {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId!: string;

  /** رمز قصير يدخل في ترميز الأصول (مثل CAR) */
  @Column({ length: 12 })
  code!: string;

  @Column({ length: 150 })
  name!: string;

  @Column({ type: 'varchar', length: 1000, nullable: true })
  description!: string | null;

  /** حساب الأصل في الدليل */
  @Column({ name: 'asset_account_id', type: 'uuid' })
  assetAccountId!: string;

  /** حساب مجمع الإهلاك (فارغ للمجموعات التي لا تُهلك مثل الأراضي) */
  @Column({ name: 'accum_account_id', type: 'uuid', nullable: true })
  accumAccountId!: string | null;

  /** حساب مصروف الإهلاك */
  @Column({ name: 'expense_account_id', type: 'uuid', nullable: true })
  expenseAccountId!: string | null;

  /** حساب أرباح وخسائر بيع الأصول واستبعادها */
  @Column({ name: 'gain_loss_account_id', type: 'uuid' })
  gainLossAccountId!: string;

  /** مركز التكلفة لمصروف الإهلاك والخسائر (إن تطلب الحساب حسابًا تحليليًا) */
  @Column({ name: 'analytic_id', type: 'uuid', nullable: true })
  analyticId!: string | null;

  @Column({ type: 'varchar', length: 16, default: 'straight_line' })
  method!: DepMethod;

  /** نسبة الإهلاك السنوية المعتمدة (0 = لا يُهلك، مثل الأراضي) */
  @Column({ type: 'numeric', precision: 6, scale: 2, transformer: num, default: 0 })
  rate!: number;

  /** العمر الإنتاجي بالسنوات (يُحسب من النسبة أو يُدخل) */
  @Column({ name: 'life_years', type: 'numeric', precision: 6, scale: 2, transformer: num, nullable: true })
  lifeYears!: number | null;

  /** أصول مادية: يجب أن تكون في عهدة موظف */
  @Column({ name: 'is_tangible', default: true })
  isTangible!: boolean;

  @Column({ type: 'jsonb', default: () => `'[]'` })
  fields!: AssetFieldDef[];

  @Column({ name: 'is_active', default: true })
  isActive!: boolean;

  @Column({ name: 'sort_order', type: 'int', default: 0 })
  sortOrder!: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}

/**
 * draft مسجل بلا قيمة، construction تحت التنفيذ (تتراكم تكاليفه في حساب المشروعات تحت التنفيذ حتى رسملته)،
 * pending_purchase ينتظر اعتماد سند الشراء، active في الدفاتر، pending_sale ينتظر اعتماد سند البيع
 */
export type AssetStatus = 'draft' | 'construction' | 'pending_purchase' | 'active' | 'pending_sale' | 'sold' | 'scrapped';

/** بطاقة الأصل */
@Entity('acc_assets')
@Index('UQ_acc_assets_code', ['organizationId', 'code'], { unique: true })
@Index('IDX_acc_assets_group', ['organizationId', 'groupId'])
@Index('IDX_acc_assets_custodian', ['organizationId', 'custodianEmployeeId'])
export class FixedAsset {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId!: string;

  @Column({ name: 'asset_no', type: 'int' })
  assetNo!: number;

  /** ترميز الأصل (يُطبع على ملصق QR) */
  @Column({ length: 40 })
  code!: string;

  @Column({ length: 250 })
  name!: string;

  @Column({ type: 'varchar', length: 2000, nullable: true })
  description!: string | null;

  @Column({ name: 'group_id', type: 'uuid' })
  groupId!: string;

  @Column({ type: 'varchar', length: 16, default: 'draft' })
  status!: AssetStatus;

  @Column({ name: 'serial_number', type: 'varchar', length: 120, nullable: true })
  serialNumber!: string | null;

  /** الموقع (مبنى، دور، غرفة، فرع) */
  @Column({ type: 'varchar', length: 250, nullable: true })
  location!: string | null;

  /** الجهة المسؤولة: وحدة إدارية من هيكل الموارد البشرية */
  @Column({ name: 'unit_id', type: 'uuid', nullable: true })
  unitId!: string | null;

  /** الموظف الذي في عهدته الأصل حاليًا */
  @Column({ name: 'custodian_employee_id', type: 'uuid', nullable: true })
  custodianEmployeeId!: string | null;

  @Column({ type: 'jsonb', nullable: true })
  image!: StoredImage | null;

  @Column({ name: 'field_values', type: 'jsonb', default: () => `'{}'` })
  fieldValues!: Record<string, string | number | null>;

  @Column({ type: 'jsonb', default: () => `'[]'` })
  maintenance!: MaintenanceContract[];

  /** الأصل يتطلب تأمينًا: يظهر تنبيه إن لم تُسجل له وثيقة سارية */
  @Column({ name: 'insurance_required', default: false })
  insuranceRequired!: boolean;

  @Column({ type: 'jsonb', nullable: true })
  insurance!: AssetInsurance | null;

  /** الأصل له ضمان من المورد أو المصنّع يُتابع انتهاؤه */
  @Column({ name: 'warranty_required', default: false })
  warrantyRequired!: boolean;

  @Column({ type: 'jsonb', nullable: true })
  warranty!: AssetWarranty | null;

  @Column({ name: 'maintenance_plan', type: 'jsonb', nullable: true })
  maintenancePlan!: MaintenancePlan | null;

  /** طريقة الإهلاك ونسبته وعمره إن اختلفت عن المجموعة */
  @Column({ type: 'varchar', length: 16, nullable: true })
  method!: DepMethod | null;

  @Column({ type: 'numeric', precision: 6, scale: 2, transformer: num, nullable: true })
  rate!: number | null;

  @Column({ name: 'life_years', type: 'numeric', precision: 6, scale: 2, transformer: num, nullable: true })
  lifeYears!: number | null;

  /** القيمة التخريدية المتوقعة في نهاية العمر */
  @Column(money('salvage_value'))
  salvageValue!: number;

  @Column({ name: 'analytic_id', type: 'uuid', nullable: true })
  analyticId!: string | null;

  /** تاريخ الشراء أو بدء الاستخدام (يبدأ منه الإهلاك) */
  @Column({ name: 'in_service_date', type: 'date', nullable: true })
  inServiceDate!: string | null;

  /** التكلفة الحالية (الشراء والإضافات) */
  @Column(money('cost'))
  cost!: number;

  /** مجمع الإهلاك الحالي */
  @Column(money('accum'))
  accum!: number;

  /** آخر تاريخ احتُسب حتى نهايته إهلاك (أو تاريخ الرصيد الافتتاحي) */
  @Column({ name: 'depreciated_through', type: 'date', nullable: true })
  depreciatedThrough!: string | null;

  /** طريقة الاقتناء: شراء أو تبرع عيني أو رصيد افتتاحي أو رسملة أصل تحت التنفيذ */
  @Column({ name: 'acquisition', type: 'varchar', length: 12, nullable: true })
  acquisition!: 'purchase' | 'donation' | 'opening' | 'capitalize' | null;

  @Column({ name: 'disposed_at', type: 'date', nullable: true })
  disposedAt!: string | null;

  @Column({ name: 'created_by_name', type: 'varchar', length: 200 })
  createdByName!: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}

export type AssetMoveKind = 'opening' | 'purchase' | 'donation' | 'addition' | 'revaluation' | 'impairment' | 'wip' | 'capitalize' | 'sale' | 'scrap';
export type AssetMoveStatus = 'pending' | 'done' | 'cancelled';
export type AssetPayMethod = 'cash' | 'bank' | 'credit';

/**
 * حركة على تكلفة الأصل أو مجمع إهلاكه: رصيد افتتاحي، شراء، تبرع عيني، إضافة، إعادة تقييم (تزيد التكلفة)،
 * هبوط قيمة (يزيد مجمع الإهلاك)، دفعة تحت التنفيذ (لا تدخل التكلفة حتى الرسملة)، رسملة، بيع، تخريد
 */
@Entity('acc_asset_moves')
@Index('IDX_acc_asset_moves_asset', ['assetId', 'date'])
@Index('IDX_acc_asset_moves_voucher', ['voucherId'])
export class AssetMove {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId!: string;

  @Column({ name: 'move_no', type: 'int' })
  moveNo!: number;

  @Column({ name: 'asset_id', type: 'uuid' })
  assetId!: string;

  @Column({ type: 'varchar', length: 12 })
  kind!: AssetMoveKind;

  @Column({ type: 'date' })
  date!: string;

  /** التغير في التكلفة (موجب للاقتناء والإضافة، سالب للاستبعاد) */
  @Column(money('amount'))
  amount!: number;

  /** التغير في مجمع الإهلاك (الرصيد الافتتاحي موجب، والاستبعاد سالب) */
  @Column(money('accum_delta'))
  accumDelta!: number;

  /** قيمة البيع */
  @Column(money('proceeds'))
  proceeds!: number;

  /** الربح (موجب) أو الخسارة (سالب) من الاستبعاد */
  @Column(money('gain_loss'))
  gainLoss!: number;

  @Column({ type: 'varchar', length: 8, nullable: true })
  method!: AssetPayMethod | null;

  @Column({ name: 'cash_account_id', type: 'uuid', nullable: true })
  cashAccountId!: string | null;

  @Column({ name: 'partner_id', type: 'uuid', nullable: true })
  partnerId!: string | null;

  /** الحساب المقابل للتبرع العيني */
  @Column({ name: 'counter_account_id', type: 'uuid', nullable: true })
  counterAccountId!: string | null;

  @Column({ name: 'party_name', type: 'varchar', length: 250, nullable: true })
  partyName!: string | null;

  /** سند الصرف (الشراء والإضافة) أو القبض (البيع) */
  @Column({ name: 'voucher_id', type: 'uuid', nullable: true })
  voucherId!: string | null;

  /** قيد سند الأصول (التخريد والتبرع العيني) */
  @Column({ name: 'entry_id', type: 'uuid', nullable: true })
  entryId!: string | null;

  /** حركة الإهلاك الجزئي حتى تاريخ البيع أو التخريد */
  @Column({ name: 'dep_run_id', type: 'uuid', nullable: true })
  depRunId!: string | null;

  /** تمويل من منحة أو مشروع: الحساب المقيد الذي يُخفَّض عند اعتماد الشراء */
  @Column({ name: 'funding_account_id', type: 'uuid', nullable: true })
  fundingAccountId!: string | null;

  /** اسم المنحة أو المشروع أو الجهة المانحة */
  @Column({ name: 'funding_name', type: 'varchar', length: 250, nullable: true })
  fundingName!: string | null;

  /** المبلغ الممول من المنحة (كل المبلغ أو جزء منه) */
  @Column(money('funded_amount'))
  fundedAmount!: number;

  /** قيد تحرير القيد عن المبلغ الممول (يصدر عند اعتماد سند الشراء) */
  @Column({ name: 'funding_entry_id', type: 'uuid', nullable: true })
  fundingEntryId!: string | null;

  /** بند الموازنة الرأسمالية الذي يُحمَّل عليه الشراء */
  @Column({ name: 'budget_line_id', type: 'uuid', nullable: true })
  budgetLineId!: string | null;

  @Column({ type: 'varchar', length: 10, default: 'done' })
  status!: AssetMoveStatus;

  @Column({ type: 'varchar', length: 1000, nullable: true })
  notes!: string | null;

  @Column({ name: 'created_by_name', type: 'varchar', length: 200 })
  createdByName!: string;

  @Column({ name: 'cancelled_by_name', type: 'varchar', length: 200, nullable: true })
  cancelledByName!: string | null;

  @Column({ name: 'cancel_reason', type: 'varchar', length: 1000, nullable: true })
  cancelReason!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}

/** عملية احتساب إهلاك مرحّلة: لفترة (شهر) أو جزئية حتى تاريخ استبعاد */
@Entity('acc_asset_dep_runs')
@Index('UQ_acc_asset_dep_runs_no', ['organizationId', 'runNo'], { unique: true })
export class DepRun {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId!: string;

  @Column({ name: 'run_no', type: 'int' })
  runNo!: number;

  @Column({ type: 'varchar', length: 10 })
  kind!: 'period' | 'disposal';

  /** الشهر YYYY-MM */
  @Column({ length: 7 })
  period!: string;

  @Column({ name: 'to_date', type: 'date' })
  toDate!: string;

  /** نطاق الاحتساب: الكل، أو مجموعات أو أصول محددة */
  @Column({ type: 'jsonb' })
  scope!: { groupIds?: string[]; assetIds?: string[]; label: string };

  @Column(money('total'))
  total!: number;

  @Column({ name: 'asset_count', type: 'int', default: 0 })
  assetCount!: number;

  @Column({ name: 'entry_id', type: 'uuid', nullable: true })
  entryId!: string | null;

  @Column({ type: 'varchar', length: 10, default: 'posted' })
  status!: 'posted' | 'cancelled';

  @Column({ name: 'created_by_name', type: 'varchar', length: 200 })
  createdByName!: string;

  @Column({ name: 'cancelled_at', type: 'timestamptz', nullable: true })
  cancelledAt!: Date | null;

  @Column({ name: 'cancelled_by_name', type: 'varchar', length: 200, nullable: true })
  cancelledByName!: string | null;

  @Column({ name: 'cancel_reason', type: 'varchar', length: 1000, nullable: true })
  cancelReason!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}

/** إهلاك أصل واحد داخل عملية احتساب */
@Entity('acc_asset_dep_lines')
@Index('IDX_acc_asset_dep_lines_asset', ['assetId', 'toDate'])
@Index('IDX_acc_asset_dep_lines_run', ['runId'])
export class DepLine {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId!: string;

  @Column({ name: 'run_id', type: 'uuid' })
  runId!: string;

  @Column({ name: 'asset_id', type: 'uuid' })
  assetId!: string;

  @Column({ name: 'group_id', type: 'uuid' })
  groupId!: string;

  @Column({ name: 'from_date', type: 'date' })
  fromDate!: string;

  @Column({ name: 'to_date', type: 'date' })
  toDate!: string;

  @Column(money('amount'))
  amount!: number;

  @Column(money('accum_before'))
  accumBefore!: number;

  @Column(money('cost'))
  cost!: number;

  /** تفصيل الإهلاك بالأشهر */
  @Column({ type: 'jsonb', default: () => `'[]'` })
  months!: { month: string; from: string; to: string; fraction: number; amount: number }[];

  /** الحركة نشطة ما لم تُلغَ عمليتها */
  @Column({ default: true })
  active!: boolean;
}

/** نموذج تسليم أو نقل أو استلام عهدة */
@Entity('acc_asset_custody')
@Index('IDX_acc_asset_custody_asset', ['assetId', 'createdAt'])
@Index('UQ_acc_asset_custody_no', ['organizationId', 'formNo'], { unique: true })
export class AssetCustody {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId!: string;

  @Column({ name: 'form_no', type: 'int' })
  formNo!: number;

  @Column({ name: 'asset_id', type: 'uuid' })
  assetId!: string;

  /** issue تسليم، transfer نقل لموظف آخر، return استلام من الموظف، release إنهاء العهدة بالبيع أو التخريد */
  @Column({ type: 'varchar', length: 10 })
  kind!: 'issue' | 'transfer' | 'return' | 'release';

  @Column({ name: 'from_employee_id', type: 'uuid', nullable: true })
  fromEmployeeId!: string | null;

  @Column({ name: 'to_employee_id', type: 'uuid', nullable: true })
  toEmployeeId!: string | null;

  @Column({ name: 'from_location', type: 'varchar', length: 250, nullable: true })
  fromLocation!: string | null;

  @Column({ name: 'to_location', type: 'varchar', length: 250, nullable: true })
  toLocation!: string | null;

  @Column({ type: 'date' })
  date!: string;

  /** حالة الأصل عند التسليم */
  @Column({ type: 'varchar', length: 60, nullable: true })
  condition!: string | null;

  @Column({ type: 'varchar', length: 1000, nullable: true })
  notes!: string | null;

  /** إقرار المستلم بالاستلام */
  @Column({ name: 'confirmed_at', type: 'timestamptz', nullable: true })
  confirmedAt!: Date | null;

  @Column({ name: 'confirmed_by_name', type: 'varchar', length: 200, nullable: true })
  confirmedByName!: string | null;

  @Column({ name: 'created_by_name', type: 'varchar', length: 200 })
  createdByName!: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}

export interface StocktakeLine {
  assetId: string;
  code: string;
  name: string;
  expectedLocation: string | null;
  expectedCustodian: string | null;
  /** pending لم يُجرد، found موجود، missing مفقود */
  result: 'pending' | 'found' | 'missing';
  foundLocation: string | null;
  condition: string | null;
  notes: string | null;
  countedByName: string | null;
  countedAt: string | null;
}

/** جرد دوري للأصول (بمسح ملصق QR بالجوال) */
@Entity('acc_asset_stocktakes')
@Index('UQ_acc_asset_stocktakes_no', ['organizationId', 'stocktakeNo'], { unique: true })
export class AssetStocktake {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId!: string;

  @Column({ name: 'stocktake_no', type: 'int' })
  stocktakeNo!: number;

  @Column({ length: 200 })
  title!: string;

  @Column({ type: 'date' })
  date!: string;

  @Column({ type: 'jsonb' })
  scope!: { groupIds?: string[]; location?: string | null; label: string };

  @Column({ type: 'varchar', length: 10, default: 'open' })
  status!: 'open' | 'closed';

  @Column({ type: 'jsonb' })
  lines!: StocktakeLine[];

  /** أصول وُجدت أثناء الجرد ولم تكن في نطاقه أو بلا ملصق مسجل */
  @Column({ type: 'jsonb', default: () => `'[]'` })
  extras!: { code: string; note: string | null; byName: string; at: string }[];

  @Column({ name: 'created_by_name', type: 'varchar', length: 200 })
  createdByName!: string;

  @Column({ name: 'closed_at', type: 'timestamptz', nullable: true })
  closedAt!: Date | null;

  @Column({ name: 'closed_by_name', type: 'varchar', length: 200, nullable: true })
  closedByName!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}

/** سجل الصيانة: وقائية مجدولة أو إصلاح عطل، بتكلفتها ومدة التوقف */
@Entity('acc_asset_maintenance')
@Index('IDX_acc_asset_maintenance_asset', ['assetId', 'date'])
@Index('UQ_acc_asset_maintenance_no', ['organizationId', 'recordNo'], { unique: true })
export class AssetMaintenance {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId!: string;

  @Column({ name: 'record_no', type: 'int' })
  recordNo!: number;

  @Column({ name: 'asset_id', type: 'uuid' })
  assetId!: string;

  @Column({ type: 'date' })
  date!: string;

  /** preventive صيانة وقائية، repair إصلاح عطل */
  @Column({ type: 'varchar', length: 10 })
  kind!: 'preventive' | 'repair';

  @Column({ length: 1000 })
  description!: string;

  @Column({ type: 'varchar', length: 250, nullable: true })
  vendor!: string | null;

  @Column(money('cost'))
  cost!: number;

  /** أيام توقف الأصل عن العمل */
  @Column({ name: 'downtime_days', type: 'int', default: 0 })
  downtimeDays!: number;

  /** سند الصرف إن سُددت التكلفة من الأصول الثابتة */
  @Column({ name: 'voucher_id', type: 'uuid', nullable: true })
  voucherId!: string | null;

  @Column({ type: 'varchar', length: 1000, nullable: true })
  notes!: string | null;

  @Column({ name: 'created_by_name', type: 'varchar', length: 200 })
  createdByName!: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}

/**
 * الموازنة الرأسمالية لسنة: بنود مخطط شراؤها مقابل الفعلي.
 * external_ref في الرأس والبنود للربط مستقبلًا مع نظام الخطة والموازنة (رقم الخطة أو البند هناك).
 */
@Entity('acc_asset_budgets')
@Index('UQ_acc_asset_budgets_year', ['organizationId', 'fiscalYearId'], { unique: true })
export class CapitalBudget {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId!: string;

  @Column({ name: 'fiscal_year_id', type: 'uuid' })
  fiscalYearId!: string;

  @Column({ length: 200 })
  title!: string;

  @Column({ type: 'varchar', length: 10, default: 'draft' })
  status!: 'draft' | 'approved';

  @Column({ name: 'external_ref', type: 'varchar', length: 120, nullable: true })
  externalRef!: string | null;

  @Column({ type: 'varchar', length: 1000, nullable: true })
  notes!: string | null;

  @Column({ name: 'approved_by_name', type: 'varchar', length: 200, nullable: true })
  approvedByName!: string | null;

  @Column({ name: 'approved_at', type: 'timestamptz', nullable: true })
  approvedAt!: Date | null;

  @Column({ name: 'created_by_name', type: 'varchar', length: 200 })
  createdByName!: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}

@Entity('acc_asset_budget_lines')
@Index('IDX_acc_asset_budget_lines_budget', ['budgetId'])
export class CapitalBudgetLine {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId!: string;

  @Column({ name: 'budget_id', type: 'uuid' })
  budgetId!: string;

  @Column({ name: 'line_no', type: 'int' })
  lineNo!: number;

  /** مجموعة الأصول المخطط شراؤها (يُقارن بها الفعلي غير المربوط ببند) */
  @Column({ name: 'group_id', type: 'uuid' })
  groupId!: string;

  @Column({ length: 300 })
  description!: string;

  @Column({ type: 'int', default: 1 })
  quantity!: number;

  @Column(money('amount'))
  amount!: number;

  /** الربع المتوقع للشراء (1-4) */
  @Column({ type: 'int', nullable: true })
  quarter!: number | null;

  @Column({ name: 'unit_id', type: 'uuid', nullable: true })
  unitId!: string | null;

  /** رقم البند في نظام الخطة والموازنة (للربط مستقبلًا) */
  @Column({ name: 'external_ref', type: 'varchar', length: 120, nullable: true })
  externalRef!: string | null;

  @Column({ type: 'varchar', length: 1000, nullable: true })
  notes!: string | null;
}

/** سجل عمليات استيراد الأصول من ملف Excel */
@Entity('acc_asset_imports')
export class AssetImport {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId!: string;

  @Column({ name: 'file_name', length: 250 })
  fileName!: string;

  /** complete مكتملة، partial جزئية، rejected مرفوضة */
  @Column({ type: 'varchar', length: 10 })
  status!: 'complete' | 'partial' | 'rejected';

  @Column({ type: 'int', default: 0 })
  total!: number;

  @Column({ type: 'int', default: 0 })
  imported!: number;

  @Column({ type: 'jsonb', default: () => `'[]'` })
  errors!: { row: number; name: string | null; messages: string[] }[];

  /** الأصول التي أُنشئت */
  @Column({ type: 'jsonb', default: () => `'[]'` })
  assets!: { id: string; code: string; name: string }[];

  @Column({ name: 'created_by_name', type: 'varchar', length: 200 })
  createdByName!: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}

export const ASSET_ENTITIES = [
  AssetGroup, FixedAsset, AssetMove, DepRun, DepLine, AssetCustody, AssetStocktake, AssetMaintenance, CapitalBudget, CapitalBudgetLine, AssetImport,
];
