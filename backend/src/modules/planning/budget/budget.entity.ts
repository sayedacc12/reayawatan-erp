import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn, ValueTransformer } from 'typeorm';
import type { WfLog, WfStage, WfStatus } from '../entities/planning.entity';
import type { BudgetVariable, Ceiling, FormulaTarget, Methodology, RaiseRule, Section } from './budget-defaults';

const num: ValueTransformer = {
  to: (v?: number | null) => v,
  from: (v?: string | null) => (v === null || v === undefined ? null : Number(v)),
};

/**
 * مكتبة معادلات الموازنة: لكل جمعية، بإصدارات موثقة.
 * الموازنات تحفظ نتائجها وقت الاحتساب مع رقم إصدار المعادلة، فتعديل المعادلة لا يغير موازنة معتمدة بأثر رجعي.
 */
@Entity('plan_formulas')
@Index('UQ_plan_formulas_code', ['organizationId', 'code'], { unique: true })
export class PlanFormula {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId!: string;

  @Column({ type: 'varchar', length: 40 })
  code!: string;

  @Column({ length: 200 })
  name!: string;

  @Column({ type: 'varchar', length: 20 })
  target!: FormulaTarget;

  @Column({ type: 'varchar', length: 2000 })
  expression!: string;

  @Column({ type: 'varchar', length: 1500, nullable: true })
  description!: string | null;

  /** active: تُستخدم في الموازنات. draft: تحت التجربة. archived: موقوفة */
  @Column({ type: 'varchar', length: 12, default: 'active' })
  status!: 'active' | 'draft' | 'archived';

  @Column({ type: 'int', default: 1 })
  version!: number;

  @Column({ name: 'is_system', type: 'boolean', default: false })
  isSystem!: boolean;

  /** سجل الإصدارات: كل تغيير في المعادلة بتاريخه ومن عدّله وسببه */
  @Column({ type: 'jsonb', default: () => `'[]'` })
  history!: { version: number; expression: string; at: string; byName: string; note: string | null }[];

  @Column({ name: 'updated_by_name', type: 'varchar', length: 200, nullable: true })
  updatedByName!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}

/** إعدادات احتساب الموارد البشرية في الموازنة */
export interface HrSetup { monthlyFormula: string; annualFormula: string }

/**
 * الموازنة التقديرية لسنة مالية: افتراضات، وقواعد علاوات، وسقوف للإدارات، وبنود في أقسام
 * (الموارد البشرية، المصروفات التشغيلية، الأنشطة، الإيرادات). تُعتمد بمسار اعتماد وتُحفظ إصداراتها.
 * isScenario وbaseBudgetId محجوزان لمرحلة السيناريوهات.
 */
@Entity('plan_budgets')
@Index('UQ_plan_budgets_code', ['organizationId', 'code'], { unique: true })
export class Budget {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId!: string;

  @Column({ type: 'varchar', length: 20 })
  code!: string;

  @Column({ length: 250 })
  title!: string;

  @Column({ name: 'fiscal_year', type: 'int' })
  fiscalYear!: number;

  @Column({ type: 'varchar', length: 2000, nullable: true })
  description!: string | null;

  /** المنهجية الافتراضية للبنود الجديدة (لكل بند منهجيته) */
  @Column({ type: 'varchar', length: 20, default: 'mixed' })
  methodology!: Methodology;

  @Column({ type: 'jsonb', default: () => `'[]'` })
  variables!: BudgetVariable[];

  @Column({ name: 'raise_rules', type: 'jsonb', default: () => `'[]'` })
  raiseRules!: RaiseRule[];

  @Column({ name: 'hr_setup', type: 'jsonb', default: () => `'{}'` })
  hrSetup!: HrSetup;

  /** سقوف الإدارات (موازنة من الأعلى) لمقارنتها بما تطلبه الإدارات (من الأسفل) */
  @Column({ type: 'jsonb', default: () => `'[]'` })
  ceilings!: Ceiling[];

  /** عدد سنوات التاريخ الافتراضي ونسبة السنة الجارية */
  @Column({ name: 'history_years', type: 'int', default: 3 })
  historyYears!: number;

  @Column({ name: 'is_scenario', type: 'boolean', default: false })
  isScenario!: boolean;

  @Column({ name: 'base_budget_id', type: 'uuid', nullable: true })
  baseBudgetId!: string | null;

  @Column({ type: 'varchar', length: 12, default: 'draft' })
  status!: WfStatus;

  @Column({ name: 'stage_index', type: 'int', nullable: true })
  stageIndex!: number | null;

  @Column({ name: 'wf_stages', type: 'jsonb', default: () => `'[]'` })
  wfStages!: WfStage[];

  @Column({ name: 'route_name', type: 'varchar', length: 150, nullable: true })
  routeName!: string | null;

  @Column({ type: 'jsonb', default: () => `'[]'` })
  approvals!: WfLog[];

  @Column({ type: 'int', default: 0 })
  version!: number;

  @Column({ name: 'revision_note', type: 'varchar', length: 1000, nullable: true })
  revisionNote!: string | null;

  @Column({ name: 'approved_at', type: 'timestamptz', nullable: true })
  approvedAt!: Date | null;

  @Column({ name: 'calculated_at', type: 'timestamptz', nullable: true })
  calculatedAt!: Date | null;

  @Column({ name: 'created_by_name', length: 200 })
  createdByName!: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}

export interface Allocation { costCenterId: string | null; name: string; pct: number }
export interface TraceStep { label: string; formula?: string | null; formulaCode?: string | null; formulaVersion?: number | null; vars?: Record<string, number>; value: number; source?: string | null }

/**
 * بند موازنة. params يحمل مدخلات البند حسب القسم (بيانات الموظف، طريقة التقدير، الاستبعادات، العقود...)،
 * وhistory لقطة من الفعلي المستورد وقت الاستيراد (مصدر البيانات واضح وقابل للتكرار)،
 * والنتائج (auto/final/monthly/trace) محفوظة وقت الاحتساب ولا تتغير إلا بإعادة احتساب مصرح بها.
 */
@Entity('plan_budget_lines')
@Index('IDX_plan_budget_lines_budget', ['budgetId', 'section'])
export class BudgetLine {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId!: string;

  @Column({ name: 'budget_id', type: 'uuid' })
  budgetId!: string;

  @Column({ type: 'varchar', length: 12 })
  section!: Section;

  /** employee | new_position | hr_other | account | activity | manual */
  @Column({ type: 'varchar', length: 20 })
  kind!: string;

  @Column({ length: 300 })
  name!: string;

  /** مرجع المصدر: الموظف، أو خطة التعيين، أو الحساب، أو عنصر الخطة */
  @Column({ name: 'source_id', type: 'uuid', nullable: true })
  sourceId!: string | null;

  @Column({ name: 'source_ref', type: 'varchar', length: 120, nullable: true })
  sourceRef!: string | null;

  @Column({ name: 'unit_id', type: 'uuid', nullable: true })
  unitId!: string | null;

  @Column({ name: 'unit_name', type: 'varchar', length: 200, nullable: true })
  unitName!: string | null;

  @Column({ name: 'account_id', type: 'uuid', nullable: true })
  accountId!: string | null;

  @Column({ name: 'account_code', type: 'varchar', length: 40, nullable: true })
  accountCode!: string | null;

  @Column({ name: 'account_name', type: 'varchar', length: 200, nullable: true })
  accountName!: string | null;

  @Column({ name: 'cost_center_id', type: 'uuid', nullable: true })
  costCenterId!: string | null;

  @Column({ name: 'cost_center_name', type: 'varchar', length: 200, nullable: true })
  costCenterName!: string | null;

  @Column({ name: 'funding_type', type: 'varchar', length: 14, nullable: true })
  fundingType!: string | null;

  @Column({ type: 'varchar', length: 20, default: 'mixed' })
  methodology!: Methodology;

  @Column({ type: 'jsonb', default: () => `'{}'` })
  params!: Record<string, unknown>;

  @Column({ type: 'jsonb', default: () => `'{}'` })
  history!: Record<string, unknown>;

  /** توزيع تكلفة البند على مراكز التكلفة أو المشاريع بنسب */
  @Column({ type: 'jsonb', default: () => `'[]'` })
  allocations!: Allocation[];

  /** التقدير الآلي حسب الطريقة والمعادلة */
  @Column({ type: 'numeric', precision: 16, scale: 2, default: 0, transformer: num })
  auto!: number;

  /** القيمة المقترحة من الإدارة (تعديل يدوي بمبرر) */
  @Column({ name: 'override_amount', type: 'numeric', precision: 16, scale: 2, nullable: true, transformer: num })
  overrideAmount!: number | null;

  @Column({ name: 'override_note', type: 'varchar', length: 1000, nullable: true })
  overrideNote!: string | null;

  /** المعتمد في الموازنة = المقترح إن وجد وإلا الآلي */
  @Column({ type: 'numeric', precision: 16, scale: 2, default: 0, transformer: num })
  amount!: number;

  @Column({ type: 'jsonb', default: () => `'[]'` })
  monthly!: number[];

  @Column({ type: 'jsonb', default: () => `'[]'` })
  trace!: TraceStep[];

  @Column({ type: 'jsonb', default: () => `'[]'` })
  warnings!: string[];

  /** يُستبعد من الإجمالي (مثل تكلفة مغطاة في بند آخر) */
  @Column({ type: 'boolean', default: true })
  included!: boolean;

  @Column({ type: 'varchar', length: 1000, nullable: true })
  note!: string | null;

  @Column({ name: 'sort_order', type: 'int', default: 0 })
  sortOrder!: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}

/** لقطة كاملة للموازنة عند الاعتماد (لا تتغير) */
@Entity('plan_budget_versions')
@Index('UQ_plan_budget_versions', ['budgetId', 'version'], { unique: true })
export class BudgetVersion {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId!: string;

  @Column({ name: 'budget_id', type: 'uuid' })
  budgetId!: string;

  @Column({ type: 'int' })
  version!: number;

  @Column({ type: 'jsonb' })
  snapshot!: BudgetSnapshot;

  @Column({ type: 'numeric', precision: 16, scale: 2, default: 0, transformer: num })
  expenses!: number;

  @Column({ type: 'numeric', precision: 16, scale: 2, default: 0, transformer: num })
  revenues!: number;

  @Column({ type: 'varchar', length: 1000, nullable: true })
  note!: string | null;

  @Column({ name: 'approved_by_name', length: 200 })
  approvedByName!: string;

  @Column({ name: 'approved_at', type: 'timestamptz' })
  approvedAt!: Date;
}

/** بند كما حُفظ في لقطة الإصدار (كل حقوله ليمكن الرجوع إليه) */
export type SnapLine = Omit<BudgetLine, 'organizationId' | 'budgetId' | 'createdAt' | 'updatedAt'>;
export interface BudgetSnapshot {
  title: string; fiscalYear: number; description: string | null; methodology: Methodology; historyYears: number;
  variables: BudgetVariable[]; raiseRules: RaiseRule[]; hrSetup: HrSetup; ceilings: Ceiling[];
  lines: SnapLine[];
  formulas: { code: string; version: number; expression: string }[];
}

/**
 * حجز أو صرف على بند موازنة من نظام آخر (المشتريات لاحقًا): يُخفّض «المتاح» في البند.
 * fundingBatchId: مصدر التمويل (دفعة تبرع مقيد/منحة) إن وُجد؛ عندها رصيد المصدر هو الحد الصارم وبند الموازنة للمتابعة فقط.
 */
@Entity('plan_budget_commitments')
@Index('IDX_plan_budget_commitments_line', ['lineId', 'status'])
export class BudgetCommitment {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId!: string;

  @Column({ name: 'budget_id', type: 'uuid' })
  budgetId!: string;

  @Column({ name: 'line_id', type: 'uuid' })
  lineId!: string;

  @Column({ name: 'funding_batch_id', type: 'uuid', nullable: true })
  fundingBatchId!: string | null;

  /** النظام الطالب ومرجعه (مثل procurement وأمر الشراء) */
  @Column({ name: 'source_module', type: 'varchar', length: 40 })
  sourceModule!: string;

  @Column({ name: 'source_ref', type: 'varchar', length: 120 })
  sourceRef!: string;

  @Column({ name: 'source_id', type: 'uuid', nullable: true })
  sourceId!: string | null;

  @Column({ type: 'numeric', precision: 16, scale: 2, transformer: num })
  amount!: number;

  /** reserved: محجوز (تعميد) · consumed: صُرف فعلًا · released: أُلغي الحجز */
  @Column({ type: 'varchar', length: 10, default: 'reserved' })
  status!: 'reserved' | 'consumed' | 'released';

  @Column({ type: 'varchar', length: 500, nullable: true })
  note!: string | null;

  @Column({ name: 'created_by_name', length: 200 })
  createdByName!: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}

export const BUDGET_ENTITIES = [PlanFormula, Budget, BudgetLine, BudgetVersion, BudgetCommitment];
