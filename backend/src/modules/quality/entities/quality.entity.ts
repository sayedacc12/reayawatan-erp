import { Column, CreateDateColumn, Entity, Index, PrimaryColumn, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

// ---------------- الأنواع المشتركة ----------------

export const DOC_TYPES = ['manual', 'policy', 'procedure', 'instruction', 'form', 'record', 'plan', 'external'] as const;
export type DocType = (typeof DOC_TYPES)[number];
export type DocStatus = 'draft' | 'review' | 'approval' | 'approved' | 'obsolete';

export const NCR_SOURCES = ['audit', 'complaint', 'process', 'beneficiary', 'supplier', 'review', 'risk', 'other'] as const;
export type NcrSource = (typeof NCR_SOURCES)[number];
export type NcrStatus = 'open' | 'analysis' | 'action' | 'verification' | 'closed';

export const AUDIT_RESULTS = ['conform', 'minor', 'major', 'observation', 'ofi', 'na'] as const;
export type AuditResult = (typeof AUDIT_RESULTS)[number];
export type AuditStatus = 'planned' | 'in_progress' | 'completed' | 'cancelled';

export const RISK_TREATMENTS = ['avoid', 'mitigate', 'transfer', 'accept', 'exploit', 'enhance', 'share'] as const;
export const OBJ_FREQUENCIES = ['monthly', 'quarterly', 'semiannual', 'annual'] as const;
export const AUTO_METRICS = ['satisfaction', 'complaint_days', 'complaints_closed', 'ncr_closed', 'ncr_days', 'audit_done', 'docs_current'] as const;
export type AutoMetric = (typeof AUTO_METRICS)[number];

export const COMPLAINT_CHANNELS = ['portal', 'phone', 'email', 'visit', 'social', 'box', 'other'] as const;
export const PARTY_TYPES = ['beneficiary', 'donor', 'volunteer', 'employee', 'partner', 'community'] as const;
export type ComplaintStatus = 'received' | 'investigating' | 'resolved' | 'closed' | 'rejected';
export type SurveyStatus = 'draft' | 'open' | 'closed';

/** خطوة في سجل أي سجل جودة (من فعل ماذا ومتى) */
export interface QmsStep { action: string; byName: string; at: string; note?: string | null; revision?: number }
export interface DocSection { title: string; body: string }
/** نسخة موزعة من الوثيقة: لمن سُلّمت، وهل استلمها، وهل سُحبت لأنها أصبحت ملغاة */
export interface DocCopy { copyNo: number; holder: string; revision: number; issuedAt: string; acknowledgedAt: string | null; withdrawnAt: string | null }
export interface MapStep { id: string; kind: 'start' | 'task' | 'decision' | 'document' | 'end'; label: string; lane: number; docCode?: string | null; next: { to: string; label?: string | null }[] }
export interface ChecklistItem { clause: string; question: string; result: AuditResult | null; evidence: string | null }
export interface ActionItem { id: string; title: string; ownerName: string; dueDate: string | null; status: 'open' | 'done'; doneAt: string | null; note: string | null }
export interface Fishbone { man: string; method: string; machine: string; material: string; measurement: string; environment: string }
export interface Verification { result: 'effective' | 'not_effective'; note: string | null; byName: string; at: string }
export interface Measurement { period: string; value: number; note: string | null; byName: string; at: string }
export interface ReviewInput { key: string; title: string; summary: string }
export interface ReviewOutput { id: string; type: 'improvement' | 'change' | 'resources'; decision: string; ownerName: string; dueDate: string | null; status: 'open' | 'done' }
export interface SurveyQuestion { id: string; text: string; type: 'rating' | 'choice' | 'text'; options?: string[] }

/** سياق الشركة ونطاق النظام والسياسة (البندان 4 و5) */
export interface QmsContext {
  scope: string;
  exclusions: string;
  issues: { kind: 'internal' | 'external'; category: string; text: string }[];
  parties: { name: string; needs: string; monitoring: string }[];
  processes: { name: string; owner: string; inputs: string; outputs: string; kpi: string }[];
  policy: { text: string; approvedBy: string; date: string | null };
  responsibilities: { role: string; duties: string }[];
}

/** بادئات أنواع الوثائق في الترميز */
export const DEFAULT_PREFIXES: Record<DocType, string> = {
  manual: 'QM', policy: 'POL', procedure: 'QP', instruction: 'WI', form: 'QF', record: 'QR', plan: 'PLN', external: 'EXT',
};
/** رموز الإدارات والأنظمة في الترميز الموحد */
export const DEFAULT_DEPARTMENTS = [
  { code: 'QMS', name: 'الجودة' }, { code: 'ADM', name: 'الإدارة التنفيذية' }, { code: 'BEN', name: 'العملاء والبحث الاجتماعي' },
  { code: 'PRJ', name: 'المشاريع والبرامج' }, { code: 'FR', name: 'تنمية الموارد' }, { code: 'FIN', name: 'الشؤون المالية' },
  { code: 'HR', name: 'الموارد البشرية' }, { code: 'IT', name: 'تقنية المعلومات' }, { code: 'VOL', name: 'التطوع' },
];

// ---------------- الإعدادات ----------------

@Entity('quality_settings')
export class QmsSettings {
  @PrimaryColumn({ name: 'organization_id', type: 'uuid' })
  organizationId!: string;

  /** بادئة كل نوع وثيقة، مثل QP للإجراءات وQF للنماذج */
  @Column({ type: 'jsonb', default: () => `'{}'` })
  prefixes!: Partial<Record<DocType, string>>;

  /** رموز الإدارات والأنظمة المستخدمة في الترميز */
  @Column({ type: 'jsonb', default: () => `'[]'` })
  departments!: { code: string; name: string }[];

  /** عدد خانات الرقم التسلسلي في الكود (QP-QMS-01 = خانتان) */
  @Column({ name: 'seq_digits', type: 'int', default: 2 })
  seqDigits!: number;

  /** مدة المراجعة الدورية للوثيقة المعتمدة بالأشهر */
  @Column({ name: 'review_months', type: 'int', default: 12 })
  reviewMonths!: number;

  /** المدة المستهدفة لإغلاق الشكوى بالأيام */
  @Column({ name: 'complaint_days', type: 'int', default: 7 })
  complaintDays!: number;

  /** المدة الافتراضية لإغلاق حالة عدم المطابقة بالأيام */
  @Column({ name: 'ncr_days', type: 'int', default: 30 })
  ncrDays!: number;

  @Column({ type: 'jsonb', default: () => `'{}'` })
  context!: Partial<QmsContext>;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}

// ---------------- الوثائق المضبوطة ----------------

@Entity('quality_documents')
@Index('UQ_quality_documents_code', ['organizationId', 'code'], { unique: true })
export class QmsDocument {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId!: string;

  @Column({ type: 'varchar', length: 50 })
  code!: string;

  @Column({ type: 'varchar', length: 250 })
  title!: string;

  @Column({ name: 'doc_type', type: 'varchar', length: 20 })
  docType!: DocType;

  @Column({ type: 'varchar', length: 20 })
  department!: string;

  /** بنود المواصفة التي تغطيها الوثيقة، مثل 7.5 و8.2 */
  @Column({ name: 'iso_clauses', type: 'jsonb', default: () => `'[]'` })
  isoClauses!: string[];

  /** الجهة المالكة للوثيقة (المسؤولة عن تحديثها) */
  @Column({ name: 'owner_name', type: 'varchar', length: 200, nullable: true })
  ownerName!: string | null;

  /** رقم الإصدار الجاري العمل عليه (Rev.00 للإصدار الأول) */
  @Column({ type: 'int', default: 0 })
  revision!: number;

  /** آخر إصدار معتمد ساري (null = لم يُعتمد بعد) */
  @Column({ name: 'approved_revision', type: 'int', nullable: true })
  approvedRevision!: number | null;

  @Column({ type: 'varchar', length: 12, default: 'draft' })
  status!: DocStatus;

  @Column({ type: 'jsonb', default: () => `'[]'` })
  sections!: DocSection[];

  /** وثائق مرتبطة (أكواد) */
  @Column({ name: 'related_codes', type: 'jsonb', default: () => `'[]'` })
  relatedCodes!: string[];

  /** للسجلات: مدة الحفظ ومكانه */
  @Column({ type: 'varchar', length: 300, nullable: true })
  retention!: string | null;

  @Column({ name: 'change_summary', type: 'varchar', length: 1000, nullable: true })
  changeSummary!: string | null;

  @Column({ name: 'effective_date', type: 'date', nullable: true })
  effectiveDate!: string | null;

  @Column({ name: 'next_review_date', type: 'date', nullable: true })
  nextReviewDate!: string | null;

  @Column({ type: 'jsonb', default: () => `'[]'` })
  distribution!: DocCopy[];

  @Column({ type: 'jsonb', default: () => `'[]'` })
  history!: QmsStep[];

  @Column({ name: 'created_by_name', type: 'varchar', length: 200 })
  createdByName!: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}

/** نسخة محفوظة من كل إصدار معتمد: الساري هو الأحدث، والسابق يُعلَّم ملغى */
@Entity('quality_document_revisions')
@Index('UQ_quality_document_revisions', ['documentId', 'revision'], { unique: true })
export class QmsDocumentRevision {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId!: string;

  @Column({ name: 'document_id', type: 'uuid' })
  documentId!: string;

  @Column({ type: 'int' })
  revision!: number;

  @Column({ type: 'varchar', length: 250 })
  title!: string;

  @Column({ type: 'jsonb' })
  sections!: DocSection[];

  @Column({ name: 'change_summary', type: 'varchar', length: 1000, nullable: true })
  changeSummary!: string | null;

  @Column({ name: 'reviewed_by_name', type: 'varchar', length: 200, nullable: true })
  reviewedByName!: string | null;

  @Column({ name: 'approved_by_name', type: 'varchar', length: 200 })
  approvedByName!: string;

  @Column({ name: 'effective_date', type: 'date' })
  effectiveDate!: string;

  /** تاريخ إلغاء هذا الإصدار بصدور إصدار أحدث أو بإلغاء الوثيقة */
  @Column({ name: 'superseded_at', type: 'date', nullable: true })
  supersededAt!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}

/** خريطة إجراء (مخطط تدفق بمسارات المسؤولين) مرتبطة بوثيقة الإجراء */
@Entity('quality_process_maps')
@Index('UQ_quality_process_maps_code', ['organizationId', 'code'], { unique: true })
export class QmsProcessMap {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId!: string;

  @Column({ type: 'varchar', length: 50 })
  code!: string;

  @Column({ type: 'varchar', length: 250 })
  title!: string;

  @Column({ type: 'varchar', length: 1000, nullable: true })
  description!: string | null;

  /** وثيقة الإجراء المرتبطة */
  @Column({ name: 'document_id', type: 'uuid', nullable: true })
  documentId!: string | null;

  /** المسارات: الجهات المسؤولة عن الخطوات */
  @Column({ type: 'jsonb', default: () => `'[]'` })
  lanes!: string[];

  @Column({ type: 'jsonb', default: () => `'[]'` })
  steps!: MapStep[];

  /** يزيد مع كل حفظ */
  @Column({ type: 'int', default: 1 })
  version!: number;

  @Column({ name: 'updated_by_name', type: 'varchar', length: 200 })
  updatedByName!: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}

// ---------------- المراجعة الداخلية ----------------

@Entity('quality_audits')
@Index('UQ_quality_audits_no', ['organizationId', 'auditNo'], { unique: true })
export class QmsAudit {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId!: string;

  @Column({ name: 'audit_no', type: 'int' })
  auditNo!: number;

  @Column({ type: 'int' })
  year!: number;

  @Column({ type: 'varchar', length: 250 })
  title!: string;

  /** العملية أو النشاط محل المراجعة */
  @Column({ type: 'varchar', length: 300 })
  scope!: string;

  @Column({ type: 'varchar', length: 20 })
  department!: string;

  @Column({ type: 'jsonb', default: () => `'[]'` })
  clauses!: string[];

  @Column({ name: 'lead_auditor', type: 'varchar', length: 200 })
  leadAuditor!: string;

  @Column({ type: 'varchar', length: 400, nullable: true })
  auditors!: string | null;

  @Column({ name: 'auditee_name', type: 'varchar', length: 200, nullable: true })
  auditeeName!: string | null;

  @Column({ name: 'planned_date', type: 'date' })
  plannedDate!: string;

  @Column({ name: 'actual_date', type: 'date', nullable: true })
  actualDate!: string | null;

  @Column({ type: 'varchar', length: 12, default: 'planned' })
  status!: AuditStatus;

  @Column({ type: 'jsonb', default: () => `'[]'` })
  checklist!: ChecklistItem[];

  @Column({ type: 'text', nullable: true })
  summary!: string | null;

  @Column({ name: 'completed_by_name', type: 'varchar', length: 200, nullable: true })
  completedByName!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}

// ---------------- عدم المطابقة والإجراءات التصحيحية ----------------

@Entity('quality_ncrs')
@Index('UQ_quality_ncrs_no', ['organizationId', 'ncrNo'], { unique: true })
export class QmsNcr {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId!: string;

  @Column({ name: 'ncr_no', type: 'int' })
  ncrNo!: number;

  @Column({ type: 'varchar', length: 20 })
  source!: NcrSource;

  /** مرجع المصدر: رقم المراجعة أو الشكوى أو غيرها */
  @Column({ name: 'source_ref', type: 'varchar', length: 100, nullable: true })
  sourceRef!: string | null;

  @Column({ name: 'audit_id', type: 'uuid', nullable: true })
  auditId!: string | null;

  @Column({ name: 'complaint_id', type: 'uuid', nullable: true })
  complaintId!: string | null;

  @Column({ type: 'varchar', length: 250 })
  title!: string;

  @Column({ type: 'text' })
  description!: string;

  @Column({ type: 'varchar', length: 20, nullable: true })
  clause!: string | null;

  @Column({ type: 'varchar', length: 10, default: 'minor' })
  severity!: 'minor' | 'major';

  @Column({ type: 'varchar', length: 20 })
  department!: string;

  @Column({ name: 'detected_date', type: 'date' })
  detectedDate!: string;

  @Column({ name: 'detected_by_name', type: 'varchar', length: 200 })
  detectedByName!: string;

  @Column({ name: 'due_date', type: 'date', nullable: true })
  dueDate!: string | null;

  /** التصحيح الفوري (احتواء الأثر) */
  @Column({ type: 'text', nullable: true })
  correction!: string | null;

  @Column({ name: 'rca_method', type: 'varchar', length: 12, default: 'five_whys' })
  rcaMethod!: 'five_whys' | 'fishbone';

  @Column({ type: 'jsonb', default: () => `'[]'` })
  whys!: string[];

  @Column({ type: 'jsonb', nullable: true })
  fishbone!: Fishbone | null;

  @Column({ name: 'root_cause', type: 'text', nullable: true })
  rootCause!: string | null;

  @Column({ type: 'jsonb', default: () => `'[]'` })
  actions!: ActionItem[];

  @Column({ type: 'jsonb', nullable: true })
  verification!: Verification | null;

  /** هل تستلزم الحالة تحديث سجل المخاطر أو تعديل وثيقة */
  @Column({ name: 'needs_risk_update', type: 'boolean', default: false })
  needsRiskUpdate!: boolean;

  @Column({ name: 'related_code', type: 'varchar', length: 50, nullable: true })
  relatedCode!: string | null;

  @Column({ type: 'varchar', length: 14, default: 'open' })
  status!: NcrStatus;

  @Column({ name: 'closed_at', type: 'date', nullable: true })
  closedAt!: string | null;

  @Column({ type: 'jsonb', default: () => `'[]'` })
  history!: QmsStep[];

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}

// ---------------- المخاطر والفرص ----------------

@Entity('quality_risks')
@Index('UQ_quality_risks_no', ['organizationId', 'riskNo'], { unique: true })
export class QmsRisk {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId!: string;

  @Column({ name: 'risk_no', type: 'int' })
  riskNo!: number;

  @Column({ type: 'varchar', length: 12 })
  kind!: 'risk' | 'opportunity';

  @Column({ type: 'varchar', length: 250 })
  title!: string;

  @Column({ type: 'varchar', length: 200 })
  process!: string;

  @Column({ type: 'varchar', length: 20 })
  department!: string;

  @Column({ type: 'varchar', length: 1000, nullable: true })
  cause!: string | null;

  @Column({ type: 'varchar', length: 1000, nullable: true })
  consequence!: string | null;

  /** الاحتمال 1-5 */
  @Column({ type: 'int' })
  likelihood!: number;

  /** الأثر 1-5 */
  @Column({ type: 'int' })
  impact!: number;

  @Column({ type: 'varchar', length: 12 })
  treatment!: string;

  @Column({ type: 'jsonb', default: () => `'[]'` })
  actions!: ActionItem[];

  @Column({ name: 'owner_name', type: 'varchar', length: 200 })
  ownerName!: string;

  /** التقييم بعد المعالجة */
  @Column({ name: 'residual_likelihood', type: 'int', nullable: true })
  residualLikelihood!: number | null;

  @Column({ name: 'residual_impact', type: 'int', nullable: true })
  residualImpact!: number | null;

  @Column({ type: 'varchar', length: 10, default: 'open' })
  status!: 'open' | 'treated' | 'closed';

  @Column({ name: 'review_date', type: 'date', nullable: true })
  reviewDate!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}

// ---------------- أهداف الجودة ----------------

@Entity('quality_objectives')
export class QmsObjective {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId!: string;

  @Column({ type: 'int' })
  year!: number;

  @Column({ type: 'varchar', length: 300 })
  title!: string;

  /** المؤشر الذي يقيس الهدف */
  @Column({ type: 'varchar', length: 300 })
  kpi!: string;

  @Column({ type: 'varchar', length: 30 })
  unit!: string;

  @Column({ type: 'numeric', precision: 14, scale: 2, nullable: true, transformer: { to: (v) => v, from: (v) => (v === null ? null : Number(v)) } })
  baseline!: number | null;

  @Column({ type: 'numeric', precision: 14, scale: 2, transformer: { to: (v) => v, from: (v) => Number(v) } })
  target!: number;

  /** increase: كلما زاد كان أفضل، decrease: كلما قل كان أفضل */
  @Column({ type: 'varchar', length: 10, default: 'increase' })
  direction!: 'increase' | 'decrease';

  @Column({ type: 'varchar', length: 12, default: 'quarterly' })
  frequency!: string;

  /** قياس تلقائي من بيانات النظام بدل الإدخال اليدوي */
  @Column({ name: 'auto_metric', type: 'varchar', length: 20, nullable: true })
  autoMetric!: AutoMetric | null;

  @Column({ type: 'varchar', length: 20 })
  department!: string;

  @Column({ name: 'owner_name', type: 'varchar', length: 200 })
  ownerName!: string;

  /** خطة تحقيق الهدف: ماذا سيُعمل والموارد والمسؤول */
  @Column({ type: 'varchar', length: 2000, nullable: true })
  plan!: string | null;

  @Column({ type: 'jsonb', default: () => `'[]'` })
  measurements!: Measurement[];

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive!: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}

// ---------------- مراجعة الإدارة ----------------

@Entity('quality_management_reviews')
@Index('UQ_quality_management_reviews_no', ['organizationId', 'reviewNo'], { unique: true })
export class QmsReview {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId!: string;

  @Column({ name: 'review_no', type: 'int' })
  reviewNo!: number;

  @Column({ type: 'varchar', length: 250 })
  title!: string;

  @Column({ name: 'meeting_date', type: 'date' })
  meetingDate!: string;

  @Column({ name: 'chair_name', type: 'varchar', length: 200 })
  chairName!: string;

  @Column({ type: 'varchar', length: 1000, nullable: true })
  attendees!: string | null;

  @Column({ type: 'jsonb', default: () => `'[]'` })
  inputs!: ReviewInput[];

  @Column({ type: 'jsonb', default: () => `'[]'` })
  outputs!: ReviewOutput[];

  @Column({ type: 'text', nullable: true })
  minutes!: string | null;

  @Column({ type: 'varchar', length: 10, default: 'draft' })
  status!: 'draft' | 'approved';

  @Column({ name: 'approved_by_name', type: 'varchar', length: 200, nullable: true })
  approvedByName!: string | null;

  @Column({ name: 'approved_at', type: 'date', nullable: true })
  approvedAt!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}

// ---------------- الشكاوى وقياس الرضا ----------------

@Entity('quality_complaints')
@Index('UQ_quality_complaints_no', ['organizationId', 'complaintNo'], { unique: true })
export class QmsComplaint {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId!: string;

  @Column({ name: 'complaint_no', type: 'int' })
  complaintNo!: number;

  @Column({ type: 'varchar', length: 12 })
  channel!: string;

  @Column({ name: 'party_type', type: 'varchar', length: 12 })
  partyType!: string;

  @Column({ name: 'complainant_name', type: 'varchar', length: 200, nullable: true })
  complainantName!: string | null;

  @Column({ type: 'varchar', length: 120, nullable: true })
  contact!: string | null;

  @Column({ type: 'varchar', length: 250 })
  subject!: string;

  @Column({ type: 'text' })
  details!: string;

  @Column({ type: 'varchar', length: 100, nullable: true })
  category!: string | null;

  @Column({ type: 'varchar', length: 20 })
  department!: string;

  @Column({ name: 'received_date', type: 'date' })
  receivedDate!: string;

  @Column({ name: 'assigned_to', type: 'varchar', length: 200, nullable: true })
  assignedTo!: string | null;

  @Column({ type: 'varchar', length: 14, default: 'received' })
  status!: ComplaintStatus;

  @Column({ type: 'text', nullable: true })
  investigation!: string | null;

  @Column({ type: 'text', nullable: true })
  response!: string | null;

  @Column({ name: 'resolved_date', type: 'date', nullable: true })
  resolvedDate!: string | null;

  /** رضا صاحب الشكوى عن المعالجة (1-5) */
  @Column({ type: 'int', nullable: true })
  satisfaction!: number | null;

  @Column({ name: 'ncr_id', type: 'uuid', nullable: true })
  ncrId!: string | null;

  /** مرجع خارجي: شكوى من بوابة العملاء أو من نظام آخر */
  @Column({ name: 'external_ref', type: 'varchar', length: 100, nullable: true })
  externalRef!: string | null;

  @Column({ type: 'jsonb', default: () => `'[]'` })
  history!: QmsStep[];

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}

@Entity('quality_surveys')
export class QmsSurvey {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId!: string;

  @Column({ type: 'varchar', length: 250 })
  title!: string;

  @Column({ type: 'varchar', length: 12 })
  audience!: string;

  @Column({ type: 'varchar', length: 1000, nullable: true })
  description!: string | null;

  /** كود النموذج في سجل الوثائق (مثل QF-QMS-08) */
  @Column({ name: 'form_code', type: 'varchar', length: 50, nullable: true })
  formCode!: string | null;

  @Column({ type: 'jsonb', default: () => `'[]'` })
  questions!: SurveyQuestion[];

  @Column({ type: 'varchar', length: 10, default: 'draft' })
  status!: SurveyStatus;

  /** رابط الاستبانة العام */
  @Index('UQ_quality_surveys_token', { unique: true })
  @Column({ name: 'public_token', type: 'varchar', length: 40 })
  publicToken!: string;

  @Column({ name: 'target_responses', type: 'int', default: 0 })
  targetResponses!: number;

  @Column({ name: 'created_by_name', type: 'varchar', length: 200 })
  createdByName!: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}

@Entity('quality_survey_responses')
export class QmsSurveyResponse {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId!: string;

  @Index()
  @Column({ name: 'survey_id', type: 'uuid' })
  surveyId!: string;

  @Column({ type: 'jsonb' })
  answers!: Record<string, string | number>;

  /** مؤشر الرضا لهذا الرد من 100 (من أسئلة التقييم) */
  @Column({ type: 'numeric', precision: 5, scale: 2, nullable: true, transformer: { to: (v) => v, from: (v) => (v === null ? null : Number(v)) } })
  score!: number | null;

  @Column({ name: 'respondent_name', type: 'varchar', length: 200, nullable: true })
  respondentName!: string | null;

  /** link: من الرابط العام، manual: إدخال من الموظف (استبانة ورقية أو هاتفية) */
  @Column({ type: 'varchar', length: 10 })
  channel!: 'link' | 'manual';

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}

export const QUALITY_ENTITIES = [
  QmsSettings, QmsDocument, QmsDocumentRevision, QmsProcessMap, QmsAudit, QmsNcr, QmsRisk, QmsObjective, QmsReview, QmsComplaint, QmsSurvey, QmsSurveyResponse,
];
