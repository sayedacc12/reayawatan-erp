import { Column, CreateDateColumn, Entity, Index, PrimaryColumn, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

export const RISK_LEVELS = ['low', 'medium', 'high', 'critical'] as const;
export type RiskLevel = (typeof RISK_LEVELS)[number];
export const AREA_CATEGORIES = ['governance', 'strategic', 'operational', 'financial', 'compliance', 'it', 'programs', 'fundraising', 'hr'] as const;
export const CONTROL_RATINGS = ['strong', 'adequate', 'weak', 'unknown'] as const;
export type ControlRating = (typeof CONTROL_RATINGS)[number];
/** نطاق الخطة أو المهمة: الشركة كلها، أو وحدة من الهيكل التنظيمي، أو جهة خارج الهيكل (شريك منفذ، مورد، فرع...) */
export const SCOPE_TYPES = ['org', 'unit', 'outside'] as const;
export type ScopeType = (typeof SCOPE_TYPES)[number];
export type PlanStatus = 'draft' | 'submitted' | 'approved' | 'closed';
export type EngagementStatus = 'planned' | 'fieldwork' | 'review' | 'issued' | 'closed' | 'cancelled';
export type ItemResult = 'pending' | 'satisfactory' | 'finding' | 'na';
export const OPINIONS = ['satisfactory', 'needs_improvement', 'unsatisfactory'] as const;
export type Opinion = (typeof OPINIONS)[number];
export type ActionStatus = 'open' | 'in_progress' | 'submitted' | 'closed' | 'cancelled';

/** نسخة من خطر في سجل المخاطر وقت الربط (المصدر الحي في وحدة المخاطر) */
export interface RiskRef { id: string; code: string; title: string; level: string; score: number | null }
/** نسخة من ضابط رقابي في سجل المخاطر */
export interface ControlRef { id: string; code: string; name: string }
export interface HistoryEntry { at: string; by: string; action: string; note?: string | null }
export interface TeamMember { userId: string; name: string; role: string }
/** سجل متابعة المهمة: ملاحظة، نسبة إنجاز، تمديد، إرسال تقرير الإغلاق، إعادة، إغلاق */
export interface ActionLog { at: string; by: string; kind: string; text?: string | null; progress?: number | null; dueDate?: string | null }
/** التقرير الذي تُغلق على أساسه مهمة المتابعة */
export interface ClosureReport { title: string; refNo: string | null; date: string; summary: string; submittedByName: string; submittedAt: string }

/** إعدادات المراجعة الداخلية لكل جمعية */
@Entity('audit_settings')
export class AuditSettings {
  @PrimaryColumn({ name: 'organization_id', type: 'uuid' })
  organizationId!: string;

  /** أدنى درجة (الاحتمال × الأثر) لكل مستوى: ما دون «متوسط» يُعد منخفضًا */
  @Column({ name: 'risk_bands', type: 'jsonb', default: () => `'{"medium": 5, "high": 10, "critical": 16}'` })
  riskBands!: { medium: number; high: number; critical: number };

  /** تكرار المراجعة بالأشهر حسب مستوى خطر المجال */
  @Column({ type: 'jsonb', default: () => `'{"low": 36, "medium": 24, "high": 12, "critical": 12}'` })
  frequency!: Record<RiskLevel, number>;

  /** المهلة الافتراضية لتنفيذ التوصية بالأيام حسب خطورة الملاحظة */
  @Column({ name: 'due_days', type: 'jsonb', default: () => `'{"low": 90, "medium": 60, "high": 30, "critical": 15}'` })
  dueDays!: Record<RiskLevel, number>;

  /** التنبيه قبل موعد التوصية بعدد أيام */
  @Column({ name: 'reminder_days', type: 'int', default: 7 })
  reminderDays!: number;

  @Column({ name: 'next_engagement_no', type: 'int', default: 1 })
  nextEngagementNo!: number;

  @Column({ name: 'next_action_no', type: 'int', default: 1 })
  nextActionNo!: number;
}

/** مجالات المراجعة (Audit universe) وتقييم مخاطرها: أساس الخطة المبنية على المخاطر */
@Entity('audit_areas')
@Index('UQ_audit_areas_code', ['organizationId', 'code'], { unique: true })
export class AuditArea {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId!: string;

  @Column({ type: 'varchar', length: 30 })
  code!: string;

  @Column({ type: 'varchar', length: 200 })
  name!: string;

  @Column({ type: 'varchar', length: 30, default: 'operational' })
  category!: string;

  @Column({ name: 'scope_type', type: 'varchar', length: 10, default: 'unit' })
  scopeType!: ScopeType;

  @Column({ name: 'unit_id', type: 'uuid', nullable: true })
  unitId!: string | null;

  @Column({ name: 'outside_label', type: 'varchar', length: 200, nullable: true })
  outsideLabel!: string | null;

  @Column({ type: 'varchar', length: 2000, nullable: true })
  description!: string | null;

  @Column({ type: 'int', default: 3 })
  likelihood!: number;

  @Column({ type: 'int', default: 3 })
  impact!: number;

  @Column({ name: 'control_rating', type: 'varchar', length: 10, default: 'unknown' })
  controlRating!: ControlRating;

  @Column({ name: 'risk_refs', type: 'jsonb', default: () => `'[]'` })
  riskRefs!: RiskRef[];

  @Column({ name: 'last_audit_date', type: 'date', nullable: true })
  lastAuditDate!: string | null;

  @Column({ name: 'is_active', default: true })
  isActive!: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}

/** خطة المراجعة: خطة رئيسية سنوية وخطط فرعية تتبعها (على وحدة من الهيكل أو خارجه) */
@Entity('audit_plans')
@Index('UQ_audit_plans_code', ['organizationId', 'code'], { unique: true })
export class AuditPlan {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId!: string;

  @Column({ type: 'varchar', length: 30 })
  code!: string;

  @Column({ type: 'varchar', length: 10 })
  kind!: 'master' | 'sub';

  @Column({ name: 'parent_id', type: 'uuid', nullable: true })
  parentId!: string | null;

  @Column({ type: 'int' })
  year!: number;

  @Column({ type: 'varchar', length: 250 })
  title!: string;

  @Column({ name: 'scope_type', type: 'varchar', length: 10, default: 'org' })
  scopeType!: ScopeType;

  @Column({ name: 'unit_id', type: 'uuid', nullable: true })
  unitId!: string | null;

  @Column({ name: 'outside_label', type: 'varchar', length: 200, nullable: true })
  outsideLabel!: string | null;

  @Column({ name: 'period_from', type: 'date' })
  periodFrom!: string;

  @Column({ name: 'period_to', type: 'date' })
  periodTo!: string;

  @Column({ type: 'text', nullable: true })
  objectives!: string | null;

  /** منهجية المراجعة المعتمدة والمعايير */
  @Column({ type: 'text', nullable: true })
  methodology!: string | null;

  /** الموارد: الفريق والساعات المتاحة */
  @Column({ name: 'available_hours', type: 'int', default: 0 })
  availableHours!: number;

  @Column({ name: 'risk_refs', type: 'jsonb', default: () => `'[]'` })
  riskRefs!: RiskRef[];

  @Column({ type: 'varchar', length: 12, default: 'draft' })
  status!: PlanStatus;

  @Column({ name: 'decision_note', type: 'varchar', length: 1000, nullable: true })
  decisionNote!: string | null;

  @Column({ name: 'approved_by_name', type: 'varchar', length: 200, nullable: true })
  approvedByName!: string | null;

  @Column({ name: 'approved_at', type: 'timestamptz', nullable: true })
  approvedAt!: Date | null;

  @Column({ type: 'jsonb', default: () => `'[]'` })
  history!: HistoryEntry[];

  @Column({ name: 'created_by_name', type: 'varchar', length: 200 })
  createdByName!: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}

/** مهمة مراجعة ضمن خطة: توزَّع على فريق، وتُنفَّذ ببرنامج عمل، وتنتهي بتقرير وتوصيات */
@Entity('audit_engagements')
@Index('UQ_audit_engagements_code', ['organizationId', 'code'], { unique: true })
export class AuditEngagement {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId!: string;

  @Column({ type: 'varchar', length: 30 })
  code!: string;

  @Column({ name: 'plan_id', type: 'uuid' })
  planId!: string;

  @Column({ name: 'area_id', type: 'uuid', nullable: true })
  areaId!: string | null;

  @Column({ type: 'varchar', length: 250 })
  title!: string;

  @Column({ type: 'text', nullable: true })
  objective!: string | null;

  @Column({ type: 'text', nullable: true })
  scope!: string | null;

  @Column({ name: 'scope_type', type: 'varchar', length: 10, default: 'unit' })
  scopeType!: ScopeType;

  @Column({ name: 'unit_id', type: 'uuid', nullable: true })
  unitId!: string | null;

  @Column({ name: 'outside_label', type: 'varchar', length: 200, nullable: true })
  outsideLabel!: string | null;

  @Column({ name: 'risk_refs', type: 'jsonb', default: () => `'[]'` })
  riskRefs!: RiskRef[];

  @Column({ type: 'varchar', length: 10, default: 'medium' })
  priority!: RiskLevel;

  @Column({ name: 'planned_start', type: 'date' })
  plannedStart!: string;

  @Column({ name: 'planned_end', type: 'date' })
  plannedEnd!: string;

  @Column({ name: 'actual_start', type: 'date', nullable: true })
  actualStart!: string | null;

  @Column({ name: 'actual_end', type: 'date', nullable: true })
  actualEnd!: string | null;

  @Column({ name: 'budget_hours', type: 'int', default: 0 })
  budgetHours!: number;

  @Column({ name: 'actual_hours', type: 'int', default: 0 })
  actualHours!: number;

  @Column({ name: 'lead_user_id', type: 'uuid', nullable: true })
  leadUserId!: string | null;

  @Column({ name: 'lead_name', type: 'varchar', length: 200, nullable: true })
  leadName!: string | null;

  @Column({ type: 'jsonb', default: () => `'[]'` })
  team!: TeamMember[];

  @Column({ type: 'varchar', length: 12, default: 'planned' })
  status!: EngagementStatus;

  @Column({ name: 'review_note', type: 'varchar', length: 1000, nullable: true })
  reviewNote!: string | null;

  @Column({ name: 'report_no', type: 'varchar', length: 40, nullable: true })
  reportNo!: string | null;

  @Column({ name: 'report_summary', type: 'text', nullable: true })
  reportSummary!: string | null;

  @Column({ name: 'report_opinion', type: 'varchar', length: 20, nullable: true })
  reportOpinion!: Opinion | null;

  @Column({ name: 'report_issued_at', type: 'timestamptz', nullable: true })
  reportIssuedAt!: Date | null;

  @Column({ name: 'report_issued_by_name', type: 'varchar', length: 200, nullable: true })
  reportIssuedByName!: string | null;

  @Column({ name: 'closed_at', type: 'timestamptz', nullable: true })
  closedAt!: Date | null;

  @Column({ name: 'closure_note', type: 'varchar', length: 2000, nullable: true })
  closureNote!: string | null;

  @Column({ type: 'jsonb', default: () => `'[]'` })
  history!: HistoryEntry[];

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}

/** بند المراجعة في برنامج العمل: المعيار والإجراء ونتيجة الاختبار */
@Entity('audit_items')
@Index('IDX_audit_items_engagement', ['organizationId', 'engagementId'])
export class AuditItem {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId!: string;

  @Column({ name: 'engagement_id', type: 'uuid' })
  engagementId!: string;

  @Column({ type: 'int' })
  seq!: number;

  @Column({ type: 'varchar', length: 300 })
  title!: string;

  /** المعيار أو المرجع: اللائحة أو السياسة أو النظام */
  @Column({ type: 'text', nullable: true })
  criteria!: string | null;

  /** إجراء المراجعة: ما الذي سيُفحص وكيف وحجم العينة */
  @Column({ type: 'text', nullable: true })
  procedure!: string | null;

  @Column({ name: 'control_ref', type: 'jsonb', nullable: true })
  controlRef!: ControlRef | null;

  @Column({ type: 'varchar', length: 12, default: 'pending' })
  result!: ItemResult;

  @Column({ type: 'text', nullable: true })
  conclusion!: string | null;

  @Column({ name: 'tested_by_name', type: 'varchar', length: 200, nullable: true })
  testedByName!: string | null;

  @Column({ name: 'tested_at', type: 'timestamptz', nullable: true })
  testedAt!: Date | null;
}

/** الملاحظة على بند المراجعة: الملاحظة ← السبب ← الأثر ← التوصية ← الجهة المسؤولة */
@Entity('audit_findings')
@Index('IDX_audit_findings_engagement', ['organizationId', 'engagementId'])
export class AuditFinding {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId!: string;

  @Column({ name: 'engagement_id', type: 'uuid' })
  engagementId!: string;

  @Column({ name: 'item_id', type: 'uuid' })
  itemId!: string;

  @Column({ type: 'int' })
  seq!: number;

  @Column({ type: 'varchar', length: 300 })
  title!: string;

  @Column({ type: 'text' })
  observation!: string;

  @Column({ type: 'text', nullable: true })
  cause!: string | null;

  /** الأثر أو النتائج المترتبة على الملاحظة */
  @Column({ type: 'text' })
  effect!: string;

  @Column({ type: 'varchar', length: 10 })
  rating!: RiskLevel;

  /** التوصية الخاصة بالعلاج */
  @Column({ type: 'text' })
  recommendation!: string;

  /** الجهة المسؤولة من الهيكل التنظيمي */
  @Column({ name: 'responsible_unit_id', type: 'uuid' })
  responsibleUnitId!: string;

  @Column({ name: 'responsible_user_id', type: 'uuid', nullable: true })
  responsibleUserId!: string | null;

  @Column({ name: 'due_date', type: 'date' })
  dueDate!: string;

  @Column({ name: 'management_response', type: 'text', nullable: true })
  managementResponse!: string | null;

  @Column({ name: 'risk_refs', type: 'jsonb', default: () => `'[]'` })
  riskRefs!: RiskRef[];

  @Column({ name: 'created_by_name', type: 'varchar', length: 200 })
  createdByName!: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}

/**
 * مهمة متابعة التوصية: تُنشأ تلقائيًا عند إصدار التقرير، مزمّنة ومسندة لجهة في الهيكل.
 * شكلها عام (source/sourceRef/title/responsible/dueDate/status/log) لتنتقل لاحقًا إلى نظام متابعة المهام والاتصالات الإدارية.
 */
@Entity('audit_actions')
@Index('UQ_audit_actions_code', ['organizationId', 'code'], { unique: true })
@Index('IDX_audit_actions_status', ['organizationId', 'status', 'dueDate'])
export class AuditAction {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId!: string;

  @Column({ type: 'varchar', length: 30 })
  code!: string;

  /** مصدر المهمة (audit) ومرجعها، لنقلها إلى نظام المهام العام */
  @Column({ type: 'varchar', length: 30, default: 'audit' })
  source!: string;

  @Column({ name: 'engagement_id', type: 'uuid' })
  engagementId!: string;

  @Column({ name: 'finding_id', type: 'uuid' })
  findingId!: string;

  @Column({ type: 'varchar', length: 300 })
  title!: string;

  @Column({ type: 'text' })
  description!: string;

  @Column({ type: 'varchar', length: 10 })
  priority!: RiskLevel;

  @Column({ name: 'responsible_unit_id', type: 'uuid' })
  responsibleUnitId!: string;

  @Column({ name: 'assignee_user_id', type: 'uuid', nullable: true })
  assigneeUserId!: string | null;

  @Column({ name: 'assignee_name', type: 'varchar', length: 200, nullable: true })
  assigneeName!: string | null;

  @Column({ name: 'start_date', type: 'date' })
  startDate!: string;

  @Column({ name: 'due_date', type: 'date' })
  dueDate!: string;

  @Column({ name: 'original_due_date', type: 'date' })
  originalDueDate!: string;

  @Column({ type: 'varchar', length: 12, default: 'open' })
  status!: ActionStatus;

  @Column({ type: 'int', default: 0 })
  progress!: number;

  @Column({ name: 'closure_report', type: 'jsonb', nullable: true })
  closureReport!: ClosureReport | null;

  @Column({ name: 'verified_by_name', type: 'varchar', length: 200, nullable: true })
  verifiedByName!: string | null;

  @Column({ name: 'closed_at', type: 'timestamptz', nullable: true })
  closedAt!: Date | null;

  @Column({ type: 'jsonb', default: () => `'[]'` })
  log!: ActionLog[];

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}

/** المستندات: تقرير المراجعة الموقّع، أدلة الإثبات، وتقارير الإغلاق */
@Entity('audit_documents')
@Index('IDX_audit_documents_owner', ['organizationId', 'ownerType', 'ownerId'])
export class AuditDocument {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId!: string;

  @Column({ name: 'owner_type', type: 'varchar', length: 12 })
  ownerType!: 'engagement' | 'action';

  @Column({ name: 'owner_id', type: 'uuid' })
  ownerId!: string;

  @Column({ type: 'varchar', length: 12, default: 'evidence' })
  kind!: 'report' | 'evidence' | 'closure';

  @Column({ type: 'varchar', length: 250 })
  title!: string;

  @Column({ name: 'file_key', type: 'varchar', length: 200 })
  fileKey!: string;

  @Column({ name: 'file_name', type: 'varchar', length: 250 })
  fileName!: string;

  @Column({ name: 'mime_type', type: 'varchar', length: 60 })
  mimeType!: string;

  @Column({ name: 'uploaded_by_name', type: 'varchar', length: 200 })
  uploadedByName!: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}

export const AUDIT_ENTITIES = [AuditSettings, AuditArea, AuditPlan, AuditEngagement, AuditItem, AuditFinding, AuditAction, AuditDocument];
