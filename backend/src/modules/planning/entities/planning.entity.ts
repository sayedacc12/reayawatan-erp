import { Column, CreateDateColumn, Entity, Index, PrimaryColumn, PrimaryGeneratedColumn, UpdateDateColumn, ValueTransformer } from 'typeorm';
import type { PlanningConfig, PlanLevel } from '../planning-defaults';
import { BUDGET_ENTITIES } from '../budget/budget.entity';

/** PostgreSQL يرجّع numeric كنص؛ نحوله لرقم */
const num: ValueTransformer = {
  to: (v?: number | null) => v,
  from: (v?: string | null) => (v === null || v === undefined ? null : Number(v)),
};

export const PLAN_KINDS = ['strategic', 'operational'] as const;
export type PlanKind = (typeof PLAN_KINDS)[number];
/** دورية التخطيط والمتابعة: تحدد فترات المستهدفات والقراءات */
export const PERIODICITIES = ['annual', 'semiannual', 'quarterly', 'monthly'] as const;
export type Periodicity = (typeof PERIODICITIES)[number];
export const WF_STATUSES = ['draft', 'in_review', 'returned', 'approved', 'rejected'] as const;
export type WfStatus = (typeof WF_STATUSES)[number];
/** حالة تنفيذ العنصر (يُحسب «متأخر» و«في خطر» آليًا من الإنجاز المخطط والفعلي) */
export const ITEM_STATES = ['not_started', 'in_progress', 'completed', 'cancelled', 'carried_over'] as const;
export type ItemState = (typeof ITEM_STATES)[number];
export const TARGET_KINDS = ['quantitative', 'qualitative', 'time'] as const;
export const RESOURCE_KINDS = ['human', 'material', 'financial'] as const;
/** نوع التمويل: مقيد أو غير مقيد أو مختلط (أساس الموازنة في المراحل القادمة) */
export const FUNDING_TYPES = ['restricted', 'unrestricted', 'mixed'] as const;
export const KPI_DIRECTIONS = ['up', 'down'] as const;
export const KPI_AGGREGATIONS = ['last', 'sum', 'avg'] as const;
/** الأنظمة التي يُربط بها عنصر الخطة كمرجع للقراءة فقط (الملكية تبقى في النظام المصدر) */
export const REF_SYSTEMS = ['projects', 'capital_budget', 'risk', 'risk_analysis', 'audit', 'hr_performance'] as const;
export type RefSystem = (typeof REF_SYSTEMS)[number];

export interface WfStage { name: string; roleId: string | null }
export interface WfLog { action: 'submit' | 'approve' | 'return' | 'reject' | 'reopen'; stage: string | null; byName: string; at: string; note: string | null }
export interface ItemTarget { kind: (typeof TARGET_KINDS)[number]; text: string; value: number | null; unit: string | null; dueDate: string | null }
export interface ItemMilestone { title: string; dueDate: string | null; done: boolean; doneDate?: string | null }
export interface ItemResource { kind: (typeof RESOURCE_KINDS)[number]; name: string; quantity: number | null; unit: string | null; cost: number | null }

/** إعدادات النظام لكل جمعية: مستويات الهيكل، القوائم، الحقول الإضافية، مسارات الاعتماد، والترقيم */
@Entity('plan_settings')
export class PlanSettings {
  @PrimaryColumn({ name: 'organization_id', type: 'uuid' })
  organizationId!: string;

  @Column({ type: 'jsonb', default: () => `'{}'` })
  config!: Partial<PlanningConfig>;

  @Column({ type: 'jsonb', default: () => `'{}'` })
  counters!: Record<string, number>;
}

/**
 * الخطة: استراتيجية متعددة السنوات أو تشغيلية لإدارة (أو مشتركة بين عدة إدارات، أو على مستوى الشركة).
 * مستويات هيكلها تُنسخ من الإعدادات أو القالب عند الإنشاء، فلا يتأثر هيكل خطة قائمة بتغيير الإعدادات لاحقًا.
 * الاعتماد يحفظ نسخة كاملة (إصدار) لا تتغير، والتعديل بعدها يعمل على مسودة تعديل حتى تُعتمد كإصدار جديد.
 */
@Entity('plan_plans')
@Index('UQ_plan_plans_code', ['organizationId', 'code'], { unique: true })
export class Plan {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId!: string;

  @Column({ type: 'varchar', length: 20 })
  code!: string;

  @Column({ type: 'varchar', length: 12 })
  kind!: PlanKind;

  @Column({ length: 250 })
  title!: string;

  @Column({ type: 'varchar', length: 3000, nullable: true })
  description!: string | null;

  @Column({ name: 'start_year', type: 'int' })
  startYear!: number;

  @Column({ name: 'end_year', type: 'int' })
  endYear!: number;

  @Column({ type: 'varchar', length: 12, default: 'annual' })
  periodicity!: Periodicity;

  @Column({ type: 'varchar', length: 1000, nullable: true })
  vision!: string | null;

  @Column({ type: 'varchar', length: 1500, nullable: true })
  mission!: string | null;

  @Column({ type: 'jsonb', default: () => `'[]'` })
  values!: string[];

  /** الإدارة المالكة (للخطة التشغيلية)؛ فارغة = على مستوى الشركة */
  @Column({ name: 'unit_id', type: 'uuid', nullable: true })
  unitId!: string | null;

  @Column({ name: 'unit_name', type: 'varchar', length: 200, nullable: true })
  unitName!: string | null;

  /** الإدارات المشاركة (خطة مشتركة بين عدة إدارات) */
  @Column({ name: 'shared_units', type: 'jsonb', default: () => `'[]'` })
  sharedUnits!: { id: string; name: string }[];

  /** الخطة الاستراتيجية التي تنفذها هذه الخطة التشغيلية (اختياري: يمكن إنشاؤها مستقلة) */
  @Column({ name: 'parent_plan_id', type: 'uuid', nullable: true })
  parentPlanId!: string | null;

  /** مستويات الهيكل الخاصة بهذه الخطة */
  @Column({ type: 'jsonb' })
  levels!: PlanLevel[];

  @Column({ name: 'template_key', type: 'varchar', length: 40, nullable: true })
  templateKey!: string | null;

  @Column({ name: 'owner_name', type: 'varchar', length: 200, nullable: true })
  ownerName!: string | null;

  @Column({ type: 'varchar', length: 12, default: 'draft' })
  status!: WfStatus;

  @Column({ name: 'stage_index', type: 'int', nullable: true })
  stageIndex!: number | null;

  /** مراحل الاعتماد كما كانت عند الرفع (مسار الاعتماد المطابق لنوع الخطة وإدارتها وتكلفتها) */
  @Column({ name: 'wf_stages', type: 'jsonb', default: () => `'[]'` })
  wfStages!: WfStage[];

  @Column({ name: 'route_name', type: 'varchar', length: 150, nullable: true })
  routeName!: string | null;

  @Column({ type: 'jsonb', default: () => `'[]'` })
  approvals!: WfLog[];

  /** رقم آخر إصدار معتمد (0 = لم تُعتمد بعد) */
  @Column({ type: 'int', default: 0 })
  version!: number;

  /** سبب التعديل الجاري على خطة سبق اعتمادها (يُحفظ مع الإصدار الجديد) */
  @Column({ name: 'revision_note', type: 'varchar', length: 1000, nullable: true })
  revisionNote!: string | null;

  @Column({ name: 'approved_at', type: 'timestamptz', nullable: true })
  approvedAt!: Date | null;

  @Column({ name: 'created_by_name', length: 200 })
  createdByName!: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}

/**
 * عنصر في هيكل الخطة: محور، هدف، مبادرة، برنامج، مشروع، نشاط، مهمة... حسب مستويات الخطة.
 * نفس الجدول للخطط الاستراتيجية والتشغيلية؛ والفرق في المستويات والحقول المستخدمة.
 */
@Entity('plan_items')
@Index('IDX_plan_items_plan', ['planId'])
export class PlanItem {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId!: string;

  @Column({ name: 'plan_id', type: 'uuid' })
  planId!: string;

  @Column({ name: 'parent_id', type: 'uuid', nullable: true })
  parentId!: string | null;

  /** رقم المستوى في مستويات الخطة (0 = الأعلى) */
  @Column({ type: 'int' })
  level!: number;

  @Column({ type: 'varchar', length: 30 })
  code!: string;

  @Column({ length: 300 })
  title!: string;

  @Column({ type: 'varchar', length: 3000, nullable: true })
  description!: string | null;

  @Column({ name: 'owner_user_id', type: 'uuid', nullable: true })
  ownerUserId!: string | null;

  @Column({ name: 'owner_name', type: 'varchar', length: 200, nullable: true })
  ownerName!: string | null;

  @Column({ name: 'unit_id', type: 'uuid', nullable: true })
  unitId!: string | null;

  @Column({ name: 'unit_name', type: 'varchar', length: 200, nullable: true })
  unitName!: string | null;

  /** الجهات المشاركة */
  @Column({ type: 'jsonb', default: () => `'[]'` })
  participants!: { id: string; name: string }[];

  @Column({ name: 'start_date', type: 'date', nullable: true })
  startDate!: string | null;

  @Column({ name: 'end_date', type: 'date', nullable: true })
  endDate!: string | null;

  /** الوزن النسبي بين العناصر الشقيقة (يُطبّع آليًا عند التجميع) */
  @Column({ type: 'numeric', precision: 9, scale: 2, default: 1, transformer: num })
  weight!: number;

  /** المستهدفات الكمية والنوعية والزمنية */
  @Column({ type: 'jsonb', default: () => `'[]'` })
  targets!: ItemTarget[];

  /** المراحل والمعالم الرئيسية */
  @Column({ type: 'jsonb', default: () => `'[]'` })
  milestones!: ItemMilestone[];

  /** الموارد البشرية والمادية والمالية المطلوبة */
  @Column({ type: 'jsonb', default: () => `'[]'` })
  resources!: ItemResource[];

  /** التكلفة التقديرية موزعة على السنوات المالية: { "2026": 120000, "2027": 80000 } */
  @Column({ name: 'cost_by_year', type: 'jsonb', default: () => `'{}'` })
  costByYear!: Record<string, number>;

  /** إجمالي التكلفة التقديرية (مجموع السنوات) */
  @Column({ name: 'planned_cost', type: 'numeric', precision: 16, scale: 2, default: 0, transformer: num })
  plannedCost!: number;

  /** طريقة تقدير التكلفة: مباشرة الآن، ومعادلة في المرحلة الثانية */
  @Column({ name: 'cost_method', type: 'varchar', length: 12, default: 'direct' })
  costMethod!: 'direct' | 'formula';

  @Column({ name: 'funding_type', type: 'varchar', length: 14, nullable: true })
  fundingType!: (typeof FUNDING_TYPES)[number] | null;

  /** مركز التكلفة من النظام المالي (حساب تحليلي) */
  @Column({ name: 'cost_center_id', type: 'uuid', nullable: true })
  costCenterId!: string | null;

  @Column({ name: 'cost_center_name', type: 'varchar', length: 250, nullable: true })
  costCenterName!: string | null;

  /** قيم الحقول الإضافية المعرّفة في الإعدادات */
  @Column({ name: 'custom_values', type: 'jsonb', default: () => `'{}'` })
  customValues!: Record<string, string | number | null>;

  /** نسبة الإنجاز الفعلية المدخلة (للعناصر التنفيذية بلا فروع) */
  @Column({ type: 'numeric', precision: 5, scale: 2, default: 0, transformer: num })
  progress!: number;

  @Column({ type: 'varchar', length: 14, default: 'not_started' })
  state!: ItemState;

  @Column({ name: 'progress_note', type: 'varchar', length: 1000, nullable: true })
  progressNote!: string | null;

  /** الإجراء التصحيحي عند التأخر أو الانحراف */
  @Column({ name: 'corrective_action', type: 'varchar', length: 1000, nullable: true })
  correctiveAction!: string | null;

  @Column({ name: 'progress_updated_at', type: 'timestamptz', nullable: true })
  progressUpdatedAt!: Date | null;

  /** رُحّل من عنصر في خطة سابقة / رُحّل إلى عنصر في خطة لاحقة */
  @Column({ name: 'carried_from_id', type: 'uuid', nullable: true })
  carriedFromId!: string | null;

  @Column({ name: 'carried_to_id', type: 'uuid', nullable: true })
  carriedToId!: string | null;

  @Column({ name: 'sort_order', type: 'int', default: 0 })
  sortOrder!: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}

/**
 * علاقة بين عنصرين (يمكن أن يكونا في خطتين مختلفتين): المبادرة تخدم عدة أهداف، والنشاط التشغيلي يخدم مبادرة استراتيجية.
 * نسبة المساهمة اختيارية، وتُستخدم في احتساب إنجاز العنصر المستفيد.
 */
@Entity('plan_links')
@Index('UQ_plan_links_pair', ['fromItemId', 'toItemId'], { unique: true })
export class PlanLink {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId!: string;

  /** العنصر المساهم (المبادرة، النشاط) */
  @Column({ name: 'from_item_id', type: 'uuid' })
  fromItemId!: string;

  /** العنصر المستفيد (الهدف، المبادرة) */
  @Column({ name: 'to_item_id', type: 'uuid' })
  toItemId!: string;

  @Column({ type: 'varchar', length: 30 })
  relation!: string;

  @Column({ type: 'numeric', precision: 5, scale: 2, nullable: true, transformer: num })
  contribution!: number | null;

  @Column({ type: 'varchar', length: 500, nullable: true })
  note!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}

/**
 * مرجع في نظام آخر (مشروع، بند موازنة رأسمالية، خطر، توصية مراجعة...): قراءة فقط، والملكية تبقى في النظام المصدر.
 * يُحفظ الرمز والعنوان وقت الربط للتتبع حتى لو تغيّر المصدر.
 */
@Entity('plan_refs')
@Index('UQ_plan_refs_item', ['itemId', 'system', 'refId'], { unique: true })
@Index('IDX_plan_refs_source', ['organizationId', 'system', 'refId'])
export class PlanRef {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId!: string;

  @Column({ name: 'item_id', type: 'uuid' })
  itemId!: string;

  @Column({ type: 'varchar', length: 20 })
  system!: RefSystem;

  /** معرف العنصر في المصدر؛ لعناصر التحليل وأهداف بطاقات الأداء: «معرف التحليل أو البطاقة:معرف العنصر» */
  @Column({ name: 'ref_id', type: 'varchar', length: 100 })
  refId!: string;

  @Column({ name: 'ref_code', type: 'varchar', length: 60, nullable: true })
  refCode!: string | null;

  @Column({ name: 'ref_label', length: 400 })
  refLabel!: string;

  @Column({ type: 'numeric', precision: 5, scale: 2, nullable: true, transformer: num })
  contribution!: number | null;

  @Column({ type: 'varchar', length: 500, nullable: true })
  note!: string | null;

  /** حالة العنصر وقت الربط (درجة الخطر ومستواه، موعد الإجراء...) للمقارنة بحالته الحالية */
  @Column({ name: 'ref_meta', type: 'jsonb', default: () => `'{}'` })
  refMeta!: Record<string, unknown>;

  /** إصدار المرجع الذي استندت إليه الخطة (مثل رقم مراجعة التحليل المعتمد) */
  @Column({ name: 'ref_version', type: 'varchar', length: 40, nullable: true })
  refVersion!: string | null;

  @Column({ name: 'created_by_name', length: 200 })
  createdByName!: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}

/** مؤشر أداء مرتبط بعنصر في الخطة، بمستهدفات لكل فترة وأوزان قابلة للتعديل */
@Entity('plan_kpis')
@Index('UQ_plan_kpis_code', ['organizationId', 'code'], { unique: true })
export class PlanKpi {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId!: string;

  @Column({ name: 'plan_id', type: 'uuid' })
  planId!: string;

  @Column({ name: 'item_id', type: 'uuid', nullable: true })
  itemId!: string | null;

  @Column({ type: 'varchar', length: 20 })
  code!: string;

  @Column({ length: 300 })
  name!: string;

  @Column({ type: 'varchar', length: 1500, nullable: true })
  description!: string | null;

  @Column({ type: 'varchar', length: 30 })
  unit!: string;

  /** up: الأعلى أفضل، down: الأقل أفضل */
  @Column({ type: 'varchar', length: 4, default: 'up' })
  direction!: (typeof KPI_DIRECTIONS)[number];

  @Column({ type: 'varchar', length: 12, default: 'annual' })
  frequency!: Periodicity;

  /** تجميع قراءات السنة: آخر قراءة، أو المجموع (تراكمي)، أو المتوسط */
  @Column({ type: 'varchar', length: 4, default: 'last' })
  aggregation!: (typeof KPI_AGGREGATIONS)[number];

  @Column({ type: 'numeric', precision: 16, scale: 2, nullable: true, transformer: num })
  baseline!: number | null;

  /** المستهدفات لكل فترة: { "2026": 80, "2027": 85 } أو { "2026-Q1": 20 } */
  @Column({ type: 'jsonb', default: () => `'{}'` })
  targets!: Record<string, number>;

  @Column({ type: 'numeric', precision: 9, scale: 2, default: 1, transformer: num })
  weight!: number;

  @Column({ name: 'owner_name', type: 'varchar', length: 200, nullable: true })
  ownerName!: string | null;

  /** مصدر البيانات وطريقة القياس */
  @Column({ name: 'data_source', type: 'varchar', length: 500, nullable: true })
  dataSource!: string | null;

  @Column({ name: 'sort_order', type: 'int', default: 0 })
  sortOrder!: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}

/** القراءة الفعلية للمؤشر في فترة */
@Entity('plan_kpi_readings')
@Index('UQ_plan_kpi_readings_period', ['kpiId', 'period'], { unique: true })
export class PlanKpiReading {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId!: string;

  @Column({ name: 'kpi_id', type: 'uuid' })
  kpiId!: string;

  @Column({ type: 'varchar', length: 10 })
  period!: string;

  @Column({ type: 'numeric', precision: 16, scale: 2, transformer: num })
  value!: number;

  @Column({ type: 'varchar', length: 1000, nullable: true })
  note!: string | null;

  @Column({ name: 'entered_by_name', length: 200 })
  enteredByName!: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}

/** سجل تحديثات الإنجاز (تاريخ كل تحديث ونسبته وملاحظته والإجراء التصحيحي) */
@Entity('plan_progress_updates')
@Index('IDX_plan_progress_item', ['itemId'])
export class PlanProgressUpdate {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId!: string;

  @Column({ name: 'item_id', type: 'uuid' })
  itemId!: string;

  @Column({ name: 'update_date', type: 'date' })
  updateDate!: string;

  @Column({ type: 'numeric', precision: 5, scale: 2, transformer: num })
  progress!: number;

  @Column({ type: 'varchar', length: 14 })
  state!: ItemState;

  @Column({ type: 'varchar', length: 1000, nullable: true })
  note!: string | null;

  @Column({ name: 'corrective_action', type: 'varchar', length: 1000, nullable: true })
  correctiveAction!: string | null;

  @Column({ name: 'by_name', length: 200 })
  byName!: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}

/** إصدار معتمد من الخطة: نسخة كاملة لا تتغير (الهيكل والمؤشرات والعلاقات) للمقارنة والتتبع */
@Entity('plan_versions')
@Index('UQ_plan_versions_no', ['planId', 'version'], { unique: true })
export class PlanVersion {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId!: string;

  @Column({ name: 'plan_id', type: 'uuid' })
  planId!: string;

  @Column({ type: 'int' })
  version!: number;

  @Column({ type: 'jsonb' })
  snapshot!: PlanSnapshot;

  @Column({ type: 'varchar', length: 1000, nullable: true })
  note!: string | null;

  @Column({ name: 'approved_by_name', length: 200 })
  approvedByName!: string;

  @Column({ name: 'approved_at', type: 'timestamptz' })
  approvedAt!: Date;
}

/** الحقول التعريفية للعنصر التي يحفظها الإصدار (لا تشمل الإنجاز ولا حالة التنفيذ) */
export const ITEM_DEF_KEYS = [
  'id', 'parentId', 'level', 'code', 'title', 'description', 'ownerUserId', 'ownerName', 'unitId', 'unitName', 'participants', 'startDate', 'endDate', 'weight',
  'targets', 'milestones', 'resources', 'costByYear', 'plannedCost', 'costMethod', 'fundingType', 'costCenterId', 'costCenterName', 'customValues', 'sortOrder',
] as const;
export type SnapshotItem = Pick<PlanItem, (typeof ITEM_DEF_KEYS)[number]>;
export const KPI_DEF_KEYS = [
  'id', 'itemId', 'code', 'name', 'description', 'unit', 'direction', 'frequency', 'aggregation', 'baseline', 'targets', 'weight', 'ownerName', 'dataSource', 'sortOrder',
] as const;
export type SnapshotKpi = Pick<PlanKpi, (typeof KPI_DEF_KEYS)[number]>;
export const PLAN_DEF_KEYS = [
  'title', 'description', 'startYear', 'endYear', 'periodicity', 'vision', 'mission', 'values', 'unitId', 'unitName', 'sharedUnits', 'parentPlanId', 'levels', 'ownerName',
] as const;
export type PlanSnapshot = Pick<Plan, (typeof PLAN_DEF_KEYS)[number]> & {
  items: SnapshotItem[]; kpis: SnapshotKpi[];
  links: { fromItemId: string; toItemId: string; relation: string; contribution: number | null; note: string | null }[];
};

export const PLANNING_ENTITIES = [PlanSettings, Plan, PlanItem, PlanLink, PlanRef, PlanKpi, PlanKpiReading, PlanProgressUpdate, PlanVersion, ...BUDGET_ENTITIES];
export type { PlanningConfig };
