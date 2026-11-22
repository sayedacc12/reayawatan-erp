import { Column, CreateDateColumn, Entity, Index, PrimaryColumn, PrimaryGeneratedColumn, UpdateDateColumn, ValueTransformer } from 'typeorm';
import type { RiskConfig } from '../risk-defaults';

/** PostgreSQL يرجّع numeric كنص؛ نحوله لرقم */
const num: ValueTransformer = {
  to: (v?: number | null) => v,
  from: (v?: string | null) => (v === null || v === undefined ? null : Number(v)),
};

/** حالات الاعتماد الموحدة لكل عناصر الوحدة (المراحل نفسها تُضبط من الإعدادات لكل إجراء) */
export const WF_STATUSES = ['draft', 'in_review', 'returned', 'approved', 'rejected'] as const;
export type WfStatus = (typeof WF_STATUSES)[number];
export interface WfLog { action: 'submit' | 'approve' | 'return' | 'reject' | 'reopen'; stage: string | null; byName: string; at: string; note: string | null }

export const RISK_SOURCES = ['internal', 'external', 'product'] as const;
export type RiskSource = (typeof RISK_SOURCES)[number];
export const TREATMENTS = ['avoid', 'reduce', 'transfer', 'accept'] as const;
export const RISK_STATES = ['open', 'treating', 'monitoring', 'closed'] as const;
export const CONTROL_TYPES = ['preventive', 'detective', 'corrective', 'directive'] as const;
export const EFFECTIVENESS = ['effective', 'partial', 'ineffective', 'not_tested'] as const;
export const FREQUENCIES = ['once', 'monthly', 'quarterly', 'semiannual', 'annual', 'continuous'] as const;
export const COMPLIANCE_RESULTS = ['compliant', 'partial', 'non_compliant', 'not_applicable'] as const;
export const ANALYSIS_KINDS = ['pestel', 'swot'] as const;
export const CHANGE_PHASES = ['request', 'implementing', 'completed', 'closed'] as const;
export const PRIORITIES = ['low', 'medium', 'high', 'urgent'] as const;

export interface RiskAction { title: string; ownerName: string | null; dueDate: string | null; status: 'planned' | 'in_progress' | 'done'; note?: string | null }
export interface RiskKri { name: string; threshold: string; current: string | null; breached: boolean }
export interface AnalysisItem { id: string; factor: string; text: string; impact: number; likelihood: number; trend: 'up' | 'stable' | 'down' | null; note: string | null; riskId: string | null }
export interface AnalysisStrategy { type: 'SO' | 'WO' | 'ST' | 'WT'; text: string }
export interface ChangeImpact { area: string; level: number; note: string | null }
export interface CrisisMember { userId: string | null; name: string; teamRole: string; phone: string | null; alternate: string | null }
export interface CrisisAuthority { authority: string; holder: string; limit: string | null }
export interface CrisisLog { at: string; byName: string; text: string }
export interface ProcedureStep { title: string; actor: string; description: string | null; durationDays: number | null; output: string | null; control: string | null; decision: boolean }
export interface ContinuityStep { title: string; ownerName: string | null; withinHours: number | null }
export interface BiaImpacts { financial: number; beneficiaries: number; reputation: number; legal: number; operational: number }

/**
 * أعمدة مشتركة: كل عنصر في الوحدة له رمز ثابت (يُستخدم مرجعًا في المراجعة الداخلية لاحقًا)،
 * وحالة اعتماد بمراحل تُضبط من الإعدادات، ورقم مراجعة يزيد مع كل إعادة اعتماد، وسجل للقرارات.
 */
abstract class GrcRecord {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId!: string;

  @Column({ type: 'varchar', length: 20 })
  code!: string;

  @Column({ type: 'varchar', length: 12, default: 'draft' })
  status!: WfStatus;

  @Column({ name: 'stage_index', type: 'int', nullable: true })
  stageIndex!: number | null;

  @Column({ type: 'jsonb', default: () => `'[]'` })
  approvals!: WfLog[];

  /** رقم المراجعة: يبدأ من 0 ويزيد مع كل اعتماد بعد تعديل */
  @Column({ type: 'int', default: 0 })
  revision!: number;

  @Column({ name: 'approved_at', type: 'timestamptz', nullable: true })
  approvedAt!: Date | null;

  @Column({ type: 'varchar', name: 'created_by_name', length: 200 })
  createdByName!: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}

/** إعدادات الوحدة لكل جمعية: مصفوفة التقييم والقوائم ومراحل الاعتماد والترقيم */
@Entity('risk_settings')
export class RiskSettings {
  @PrimaryColumn({ name: 'organization_id', type: 'uuid' })
  organizationId!: string;

  @Column({ type: 'jsonb', default: () => `'{}'` })
  config!: Partial<RiskConfig>;

  /** آخر رقم مستخدم لكل نوع (RSK، CHG، ...) */
  @Column({ type: 'jsonb', default: () => `'{}'` })
  counters!: Record<string, number>;

  /** نُصّب دليل المصطلحات والمخاطر المقترح (مرة واحدة) */
  @Column({ name: 'guide_installed', default: false })
  guideInstalled!: boolean;
}

/** لائحة إدارة المخاطر والتغيير والالتزام ومنهجياتها: كل حفظ إصدار جديد بسجل لما تغيّر */
@Entity('risk_policy_versions')
@Index('UQ_risk_policy_version', ['organizationId', 'version'], { unique: true })
export class RiskPolicyVersion {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId!: string;

  @Column({ type: 'int' })
  version!: number;

  @Column({ type: 'jsonb' })
  sections!: { key: string; title: string; body: string }[];

  /** عناوين الأقسام التي تغيرت عن الإصدار السابق (أضيفت أو عُدّلت أو حُذفت) */
  @Column({ name: 'changed_sections', type: 'jsonb', default: () => `'[]'` })
  changedSections!: { title: string; change: 'added' | 'modified' | 'removed' }[];

  @Column({ type: 'varchar', length: 1000 })
  note!: string;

  @Column({ name: 'effective_date', type: 'date' })
  effectiveDate!: string;

  /** الجهة المعتمدة (مثل: مجلس الإدارة - محضر رقم ...) */
  @Column({ name: 'approved_by', type: 'varchar', length: 200, nullable: true })
  approvedBy!: string | null;

  @Column({ type: 'varchar', name: 'created_by_name', length: 200 })
  createdByName!: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}

/** أدوات التحليل الاستراتيجي: PESTEL (البيئة الخارجية) وSWOT (القوة والضعف والفرص والتهديدات) */
@Entity('risk_analyses')
@Index('UQ_risk_analyses_code', ['organizationId', 'code'], { unique: true })
export class RiskAnalysis extends GrcRecord {
  @Column({ type: 'varchar', length: 10 })
  kind!: 'pestel' | 'swot';

  @Column({ type: 'varchar', length: 200 })
  title!: string;

  /** نطاق التحليل: الشركة كلها أو برنامج أو مشروع أو خدمة */
  @Column({ type: 'varchar', length: 200, nullable: true })
  scope!: string | null;

  @Column({ name: 'analysis_date', type: 'date' })
  analysisDate!: string;

  @Column({ type: 'jsonb', default: () => `'[]'` })
  items!: AnalysisItem[];

  /** استراتيجيات TOWS المستخلصة من SWOT */
  @Column({ type: 'jsonb', default: () => `'[]'` })
  strategies!: AnalysisStrategy[];

  @Column({ type: 'text', nullable: true })
  summary!: string | null;
}

/** سجل المخاطر المؤسسي: المرجع الموحد لكل مخاطر الشركة (الداخلية والخارجية ومخاطر المنتجات والخدمات) */
@Entity('risk_register')
@Index('UQ_risk_register_code', ['organizationId', 'code'], { unique: true })
export class RiskItem extends GrcRecord {
  @Column({ type: 'varchar', length: 250 })
  title!: string;

  @Column({ type: 'text', nullable: true })
  description!: string | null;

  @Column({ type: 'varchar', length: 10 })
  source!: RiskSource;

  @Column({ type: 'varchar', length: 40 })
  category!: string;

  /** المنتج أو الخدمة أو البرنامج (لمخاطر المنتجات والخدمات) */
  @Column({ name: 'product_name', type: 'varchar', length: 200, nullable: true })
  productName!: string | null;

  /** الوحدة المسؤولة من الهيكل التنظيمي (hr_units.id) */
  @Column({ name: 'unit_id', type: 'uuid', nullable: true })
  unitId!: string | null;

  @Column({ name: 'unit_name', type: 'varchar', length: 200, nullable: true })
  unitName!: string | null;

  /** مالك الخطر: المسؤول عن متابعته ومعالجته */
  @Column({ name: 'owner_name', type: 'varchar', length: 200, nullable: true })
  ownerName!: string | null;

  @Column({ type: 'text', nullable: true })
  causes!: string | null;

  @Column({ type: 'text', nullable: true })
  consequences!: string | null;

  @Column({ name: 'inherent_likelihood', type: 'int' })
  inherentLikelihood!: number;

  @Column({ name: 'inherent_impact', type: 'int' })
  inherentImpact!: number;

  @Column({ name: 'inherent_score', type: 'int' })
  inherentScore!: number;

  @Column({ name: 'residual_likelihood', type: 'int' })
  residualLikelihood!: number;

  @Column({ name: 'residual_impact', type: 'int' })
  residualImpact!: number;

  @Column({ name: 'residual_score', type: 'int' })
  residualScore!: number;

  @Column({ name: 'target_score', type: 'int', nullable: true })
  targetScore!: number | null;

  @Column({ type: 'varchar', length: 10, default: 'reduce' })
  treatment!: (typeof TREATMENTS)[number];

  /** مبرر قبول الخطر (إلزامي عند القبول والخطر فوق حد الرغبة) */
  @Column({ name: 'treatment_note', type: 'text', nullable: true })
  treatmentNote!: string | null;

  @Column({ type: 'jsonb', default: () => `'[]'` })
  actions!: RiskAction[];

  @Column({ type: 'jsonb', default: () => `'[]'` })
  kris!: RiskKri[];

  @Column({ type: 'varchar', name: 'risk_state', length: 12, default: 'open' })
  riskState!: (typeof RISK_STATES)[number];

  @Column({ name: 'identified_date', type: 'date' })
  identifiedDate!: string;

  @Column({ name: 'next_review_date', type: 'date', nullable: true })
  nextReviewDate!: string | null;

  /** مصدر تحديد الخطر من أدوات التحليل (اختياري) */
  @Column({ name: 'analysis_id', type: 'uuid', nullable: true })
  analysisId!: string | null;

  @Column({ name: 'analysis_item_id', type: 'varchar', length: 40, nullable: true })
  analysisItemId!: string | null;
}

/** سجل مراجعات الخطر: كل إعادة تقييم تُحفظ لمتابعة اتجاه الخطر عبر الزمن */
@Entity('risk_reviews')
@Index('IDX_risk_reviews_risk', ['organizationId', 'riskId'])
export class RiskReview {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId!: string;

  @Column({ name: 'risk_id', type: 'uuid' })
  riskId!: string;

  @Column({ name: 'review_date', type: 'date' })
  reviewDate!: string;

  @Column({ type: 'int' })
  likelihood!: number;

  @Column({ type: 'int' })
  impact!: number;

  @Column({ type: 'int' })
  score!: number;

  @Column({ type: 'varchar', length: 1000, nullable: true })
  note!: string | null;

  @Column({ type: 'varchar', name: 'by_name', length: 200 })
  byName!: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}

/** مكتبة الضوابط الرقابية: يرتبط الضابط بمخاطر ومتطلبات، ويُختبر دوريًا (أساس عمل المراجعة الداخلية) */
@Entity('risk_controls')
@Index('UQ_risk_controls_code', ['organizationId', 'code'], { unique: true })
export class RiskControl {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId!: string;

  @Column({ type: 'varchar', length: 20 })
  code!: string;

  @Column({ type: 'varchar', length: 250 })
  name!: string;

  @Column({ type: 'text', nullable: true })
  description!: string | null;

  @Column({ type: 'varchar', length: 12 })
  type!: (typeof CONTROL_TYPES)[number];

  @Column({ type: 'boolean', default: false })
  automated!: boolean;

  @Column({ type: 'varchar', length: 12, default: 'continuous' })
  frequency!: (typeof FREQUENCIES)[number];

  @Column({ name: 'owner_name', type: 'varchar', length: 200, nullable: true })
  ownerName!: string | null;

  @Column({ type: 'varchar', length: 12, default: 'not_tested' })
  effectiveness!: (typeof EFFECTIVENESS)[number];

  @Column({ name: 'last_test_date', type: 'date', nullable: true })
  lastTestDate!: string | null;

  @Column({ name: 'last_test_note', type: 'varchar', length: 1000, nullable: true })
  lastTestNote!: string | null;

  @Column({ name: 'risk_ids', type: 'jsonb', default: () => `'[]'` })
  riskIds!: string[];

  @Column({ name: 'obligation_ids', type: 'jsonb', default: () => `'[]'` })
  obligationIds!: string[];

  @Column({ name: 'is_active', default: true })
  isActive!: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}

/** طلبات التغيير: طلب، تقييم أثر، اعتماد بمراحل، تنفيذ بخطة، مراجعة ما بعد التنفيذ، إغلاق */
@Entity('risk_changes')
@Index('UQ_risk_changes_code', ['organizationId', 'code'], { unique: true })
export class RiskChange extends GrcRecord {
  @Column({ type: 'varchar', length: 250 })
  title!: string;

  @Column({ type: 'varchar', name: 'change_type', length: 40 })
  changeType!: string;

  /** تصنيف التغيير: قياسي (معتمد مسبقًا) أو عادي أو طارئ */
  @Column({ type: 'varchar', name: 'change_class', length: 10, default: 'normal' })
  changeClass!: 'standard' | 'normal' | 'emergency';

  @Column({ type: 'varchar', length: 10, default: 'medium' })
  priority!: (typeof PRIORITIES)[number];

  @Column({ type: 'text' })
  reason!: string;

  @Column({ type: 'text', nullable: true })
  description!: string | null;

  @Column({ name: 'affected_units', type: 'varchar', length: 500, nullable: true })
  affectedUnits!: string | null;

  @Column({ type: 'jsonb', default: () => `'[]'` })
  impacts!: ChangeImpact[];

  @Column({ type: 'text', nullable: true })
  benefits!: string | null;

  @Column({ name: 'cost_estimate', type: 'numeric', precision: 14, scale: 2, transformer: num, nullable: true })
  costEstimate!: number | null;

  @Column({ name: 'risk_ids', type: 'jsonb', default: () => `'[]'` })
  riskIds!: string[];

  /** خطة التواصل وإدارة الجانب البشري للتغيير */
  @Column({ type: 'text', nullable: true })
  communication!: string | null;

  @Column({ type: 'varchar', name: 'requested_by', length: 200 })
  requestedBy!: string;

  @Column({ name: 'planned_start', type: 'date', nullable: true })
  plannedStart!: string | null;

  @Column({ name: 'planned_end', type: 'date', nullable: true })
  plannedEnd!: string | null;

  /** مرحلة التنفيذ بعد الاعتماد */
  @Column({ type: 'varchar', length: 14, default: 'request' })
  phase!: (typeof CHANGE_PHASES)[number];

  @Column({ name: 'review_result', type: 'text', nullable: true })
  reviewResult!: string | null;

  @Column({ type: 'text', nullable: true })
  lessons!: string | null;

  @Column({ name: 'closed_at', type: 'timestamptz', nullable: true })
  closedAt!: Date | null;
}

/** سجل الالتزام: المتطلبات النظامية والتعاقدية والداخلية التي تلتزم بها الشركة */
@Entity('risk_obligations')
@Index('UQ_risk_obligations_code', ['organizationId', 'code'], { unique: true })
export class RiskObligation {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId!: string;

  @Column({ type: 'varchar', length: 20 })
  code!: string;

  @Column({ type: 'varchar', length: 300 })
  title!: string;

  /** الجهة أو المرجع: نظام الجمعيات، المركز الوطني، هيئة الزكاة، اشتراطات مانح... */
  @Column({ type: 'varchar', length: 200 })
  authority!: string;

  /** رقم المادة أو البند */
  @Column({ type: 'varchar', length: 200, nullable: true })
  reference!: string | null;

  @Column({ type: 'text', nullable: true })
  description!: string | null;

  @Column({ name: 'owner_name', type: 'varchar', length: 200, nullable: true })
  ownerName!: string | null;

  @Column({ type: 'varchar', length: 12, default: 'annual' })
  frequency!: (typeof FREQUENCIES)[number];

  @Column({ name: 'next_due_date', type: 'date', nullable: true })
  nextDueDate!: string | null;

  @Column({ name: 'risk_id', type: 'uuid', nullable: true })
  riskId!: string | null;

  @Column({ name: 'last_result', type: 'varchar', length: 16, nullable: true })
  lastResult!: (typeof COMPLIANCE_RESULTS)[number] | null;

  @Column({ name: 'last_assessed_at', type: 'date', nullable: true })
  lastAssessedAt!: string | null;

  @Column({ name: 'is_active', default: true })
  isActive!: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}

/** تقييم الامتثال لمتطلب: النتيجة والدليل والفجوة والإجراء التصحيحي، ويُعتمد بمراحل */
@Entity('risk_compliance_assessments')
@Index('IDX_risk_assess_obligation', ['organizationId', 'obligationId'])
export class RiskAssessment extends GrcRecord {
  @Column({ name: 'obligation_id', type: 'uuid' })
  obligationId!: string;

  @Column({ name: 'assessment_date', type: 'date' })
  assessmentDate!: string;

  @Column({ type: 'varchar', length: 16 })
  result!: (typeof COMPLIANCE_RESULTS)[number];

  @Column({ type: 'text', nullable: true })
  evidence!: string | null;

  @Column({ type: 'text', nullable: true })
  gaps!: string | null;

  @Column({ name: 'corrective_action', type: 'text', nullable: true })
  correctiveAction!: string | null;

  @Column({ name: 'action_owner', type: 'varchar', length: 200, nullable: true })
  actionOwner!: string | null;

  @Column({ name: 'action_due_date', type: 'date', nullable: true })
  actionDueDate!: string | null;

  @Column({ name: 'action_done', default: false })
  actionDone!: boolean;
}

/** استمرارية الأعمال: تحليل أثر توقف النشاط (BIA) وخطة الاستمرارية والاستعادة واختباراتها */
@Entity('risk_continuity')
@Index('UQ_risk_continuity_code', ['organizationId', 'code'], { unique: true })
export class RiskContinuity extends GrcRecord {
  @Column({ type: 'varchar', length: 250 })
  activity!: string;

  @Column({ name: 'unit_name', type: 'varchar', length: 200, nullable: true })
  unitName!: string | null;

  @Column({ name: 'owner_name', type: 'varchar', length: 200, nullable: true })
  ownerName!: string | null;

  @Column({ type: 'text', nullable: true })
  description!: string | null;

  @Column({ type: 'jsonb' })
  impacts!: BiaImpacts;

  /** أقصى فترة توقف محتملة (ساعة) */
  @Column({ name: 'mtpd_hours', type: 'int' })
  mtpdHours!: number;

  /** الوقت المستهدف للاستعادة (ساعة) */
  @Column({ name: 'rto_hours', type: 'int' })
  rtoHours!: number;

  /** أقصى فقد مقبول للبيانات (ساعة) */
  @Column({ name: 'rpo_hours', type: 'int', nullable: true })
  rpoHours!: number | null;

  @Column({ name: 'min_resources', type: 'text', nullable: true })
  minResources!: string | null;

  @Column({ type: 'jsonb', default: () => `'[]'` })
  dependencies!: { kind: string; name: string }[];

  @Column({ type: 'text', nullable: true })
  strategy!: string | null;

  @Column({ type: 'jsonb', default: () => `'[]'` })
  steps!: ContinuityStep[];

  @Column({ name: 'risk_ids', type: 'jsonb', default: () => `'[]'` })
  riskIds!: string[];

  @Column({ name: 'last_test_date', type: 'date', nullable: true })
  lastTestDate!: string | null;

  @Column({ name: 'last_test_result', type: 'varchar', length: 1000, nullable: true })
  lastTestResult!: string | null;
}

/** هندسة الإجراءات: كل إجراء بخطواته والمسؤول عن كل خطوة ومخرجاتها وضوابطها، بإصدارات معتمدة */
@Entity('risk_procedures')
@Index('UQ_risk_procedures_code', ['organizationId', 'code'], { unique: true })
export class RiskProcedure extends GrcRecord {
  @Column({ type: 'varchar', length: 250 })
  name!: string;

  /** المجال: المخاطر، التغيير، الالتزام، الاستمرارية، أخرى */
  @Column({ type: 'varchar', length: 20 })
  domain!: string;

  @Column({ type: 'text', nullable: true })
  purpose!: string | null;

  @Column({ type: 'text', nullable: true })
  scope!: string | null;

  @Column({ name: 'owner_name', type: 'varchar', length: 200, nullable: true })
  ownerName!: string | null;

  @Column({ type: 'text', nullable: true })
  inputs!: string | null;

  @Column({ type: 'text', nullable: true })
  outputs!: string | null;

  @Column({ type: 'jsonb', default: () => `'[]'` })
  steps!: ProcedureStep[];

  @Column({ type: 'jsonb', default: () => `'[]'` })
  kpis!: { name: string; target: string }[];

  @Column({ name: 'risk_ids', type: 'jsonb', default: () => `'[]'` })
  riskIds!: string[];

  @Column({ name: 'control_ids', type: 'jsonb', default: () => `'[]'` })
  controlIds!: string[];
}

/** دليل المصطلحات (term) ودليل المخاطر النموذجية (risk) */
@Entity('risk_guide')
@Index('IDX_risk_guide_kind', ['organizationId', 'kind'])
export class RiskGuideEntry {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId!: string;

  @Column({ type: 'varchar', length: 6 })
  kind!: 'term' | 'risk';

  @Column({ type: 'varchar', length: 250 })
  title!: string;

  @Column({ name: 'title_en', type: 'varchar', length: 250, nullable: true })
  titleEn!: string | null;

  @Column({ type: 'varchar', length: 40 })
  category!: string;

  @Column({ type: 'text' })
  body!: string;

  /** للمخاطر النموذجية: المصدر والأسباب والضوابط المقترحة ومؤشرات الإنذار */
  @Column({ type: 'jsonb', default: () => `'{}'` })
  details!: { source?: RiskSource; causes?: string; controls?: string; kris?: string };

  @Column({ name: 'sort_order', type: 'int', default: 0 })
  sortOrder!: number;
}

/** مهام عمل مزمنة: تتولد من طلبات التغيير (وغيرها لاحقًا) وتُسند لوحدة من الهيكل التنظيمي ومسؤول */
@Entity('risk_tasks')
@Index('IDX_risk_tasks_source', ['organizationId', 'sourceType', 'sourceId'])
export class RiskTask {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId!: string;

  /** مصدر المهمة: change (طلب تغيير)، crisis (حالة أزمة)، risk ... */
  @Column({ type: 'varchar', name: 'source_type', length: 12 })
  sourceType!: string;

  @Column({ name: 'source_id', type: 'uuid' })
  sourceId!: string;

  @Column({ type: 'varchar', length: 300 })
  title!: string;

  @Column({ type: 'text', nullable: true })
  description!: string | null;

  /** الجهة المسؤولة من الهيكل التنظيمي (hr_units.id واسمها) */
  @Column({ name: 'unit_id', type: 'uuid', nullable: true })
  unitId!: string | null;

  @Column({ name: 'unit_name', type: 'varchar', length: 200, nullable: true })
  unitName!: string | null;

  @Column({ name: 'assignee_user_id', type: 'uuid', nullable: true })
  assigneeUserId!: string | null;

  @Column({ name: 'assignee_name', type: 'varchar', length: 200, nullable: true })
  assigneeName!: string | null;

  @Column({ name: 'start_date', type: 'date', nullable: true })
  startDate!: string | null;

  @Column({ name: 'due_date', type: 'date' })
  dueDate!: string;

  @Column({ type: 'varchar', length: 12, default: 'open' })
  status!: 'open' | 'in_progress' | 'done' | 'cancelled';

  @Column({ type: 'int', default: 0 })
  progress!: number;

  @Column({ name: 'completion_note', type: 'text', nullable: true })
  completionNote!: string | null;

  @Column({ name: 'completed_at', type: 'timestamptz', nullable: true })
  completedAt!: Date | null;

  @Column({ type: 'varchar', name: 'created_by_name', length: 200 })
  createdByName!: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}

/** سجل المنهجيات المعتمدة: كل منهجية لها إصدارات بتواريخ سريان واعتماد يُرجع لها عند الحاجة */
@Entity('risk_methodologies')
@Index('UQ_risk_methodologies_code', ['organizationId', 'code'], { unique: true })
export class RiskMethodology {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId!: string;

  @Column({ type: 'varchar', length: 20 })
  code!: string;

  @Column({ type: 'varchar', length: 250 })
  name!: string;

  /** المجال: risk / continuity / change / compliance / procedures / other */
  @Column({ type: 'varchar', length: 20 })
  domain!: string;

  /** المرجع (مثل ISO 31000) */
  @Column({ type: 'varchar', length: 200, nullable: true })
  reference!: string | null;

  @Column({ name: 'is_active', default: true })
  isActive!: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}

@Entity('risk_methodology_versions')
@Index('UQ_risk_methodology_version', ['methodologyId', 'version'], { unique: true })
export class RiskMethodologyVersion {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId!: string;

  @Column({ name: 'methodology_id', type: 'uuid' })
  methodologyId!: string;

  @Column({ type: 'int' })
  version!: number;

  @Column({ type: 'text' })
  body!: string;

  @Column({ name: 'effective_date', type: 'date' })
  effectiveDate!: string;

  @Column({ name: 'approved_by', type: 'varchar', length: 200, nullable: true })
  approvedBy!: string | null;

  @Column({ type: 'varchar', length: 1000 })
  note!: string;

  @Column({ type: 'varchar', name: 'created_by_name', length: 200 })
  createdByName!: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}

/**
 * فرق الأزمات والكوارث: الأعضاء من مستخدمي النظام بأدوارهم في الفريق، ولائحة صلاحيات تفصيلية،
 * وصلاحيات نظام تُمنح للأعضاء تلقائيًا عند تفعيل الأزمة وتُسحب عند إنهائها.
 */
@Entity('risk_crisis_teams')
@Index('UQ_risk_crisis_teams_code', ['organizationId', 'code'], { unique: true })
export class RiskCrisisTeam extends GrcRecord {
  @Column({ type: 'varchar', length: 200 })
  name!: string;

  /** crisis: إدارة الأزمات، disaster: الكوارث والطوارئ، recovery: التعافي */
  @Column({ type: 'varchar', length: 10 })
  kind!: 'crisis' | 'disaster' | 'recovery';

  @Column({ type: 'text', nullable: true })
  mandate!: string | null;

  @Column({ type: 'jsonb', default: () => `'[]'` })
  members!: CrisisMember[];

  /** لائحة الصلاحيات التفصيلية أثناء الأزمة */
  @Column({ type: 'jsonb', default: () => `'[]'` })
  authorities!: CrisisAuthority[];

  /** صلاحيات النظام التي تُمنح للأعضاء عند التفعيل */
  @Column({ name: 'system_permissions', type: 'jsonb', default: () => `'[]'` })
  systemPermissions!: string[];

  /** خطة إدارة الأزمة: خطوات الاستجابة بالترتيب */
  @Column({ type: 'jsonb', default: () => `'[]'` })
  playbook!: ContinuityStep[];

  @Column({ type: 'text', nullable: true })
  communication!: string | null;

  /** خطط التعافي (أنشطة تحليل أثر التوقف) التي يتولاها الفريق */
  @Column({ name: 'continuity_ids', type: 'jsonb', default: () => `'[]'` })
  continuityIds!: string[];

  /** دور النظام الذي يُنشأ للفريق ويُسند للأعضاء أثناء التفعيل */
  @Column({ name: 'role_id', type: 'uuid', nullable: true })
  roleId!: string | null;
}

/** حالة أزمة مفعّلة: من التفعيل حتى الإنهاء، بسجل أحداث ومهام */
@Entity('risk_crisis_events')
@Index('IDX_risk_crisis_events_team', ['organizationId', 'teamId'])
export class RiskCrisisEvent {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId!: string;

  @Column({ type: 'varchar', length: 20 })
  code!: string;

  @Column({ name: 'team_id', type: 'uuid' })
  teamId!: string;

  @Column({ type: 'varchar', length: 250 })
  title!: string;

  @Column({ type: 'text', nullable: true })
  scenario!: string | null;

  @Column({ type: 'varchar', length: 10 })
  severity!: 'minor' | 'major' | 'critical';

  @Column({ name: 'risk_id', type: 'uuid', nullable: true })
  riskId!: string | null;

  /** المستخدمون الذين أُسند لهم دور الفريق بسبب هذا التفعيل (لسحبه عند الإنهاء) */
  @Column({ name: 'granted_user_ids', type: 'jsonb', default: () => `'[]'` })
  grantedUserIds!: string[];

  @Column({ type: 'jsonb', default: () => `'[]'` })
  log!: CrisisLog[];

  @Column({ name: 'activated_at', type: 'timestamptz' })
  activatedAt!: Date;

  @Column({ type: 'varchar', name: 'activated_by_name', length: 200 })
  activatedByName!: string;

  @Column({ name: 'closed_at', type: 'timestamptz', nullable: true })
  closedAt!: Date | null;

  @Column({ name: 'closed_by_name', type: 'varchar', length: 200, nullable: true })
  closedByName!: string | null;

  @Column({ type: 'text', nullable: true })
  lessons!: string | null;
}

export const RISK_ENTITIES = [
  RiskTask, RiskMethodology, RiskMethodologyVersion, RiskCrisisTeam, RiskCrisisEvent,
  RiskSettings, RiskPolicyVersion, RiskAnalysis, RiskItem, RiskReview, RiskControl, RiskChange, RiskObligation, RiskAssessment, RiskContinuity,
  RiskProcedure, RiskGuideEntry,
];
