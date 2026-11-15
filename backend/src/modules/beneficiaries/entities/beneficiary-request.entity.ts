import {
  Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, OneToMany, PrimaryGeneratedColumn, UpdateDateColumn,
} from 'typeorm';
import { Activity } from './activity.entity';
import { money } from './shared';
import { Beneficiary } from './beneficiary.entity';
import { RequestAction } from './request-action.entity';
import { Workflow } from './workflow.entity';
import { WorkflowStage } from './workflow-stage.entity';

/**
 * in_progress: في مرحلة من مراحل سير العمل
 * returned: رجع لمقدم الطلب لاستكمال البيانات
 * approved: اعتماد نهائي · rejected: مرفوض · cancelled: ألغاه مقدم الطلب
 */
export type RequestStatus = 'in_progress' | 'returned' | 'approved' | 'rejected' | 'cancelled';

/** none: مفيش مساهمة · awaiting: مستني المستفيد يرفق الإثبات · submitted: أرفقه · verified: الجمعية اتحققت */
export type ContributionStatus = 'none' | 'awaiting' | 'submitted' | 'verified';

/** توجيه القيد المحاسبي لمساهمة المستفيد (لقطة وقت التحقق) */
export interface JournalEntry {
  date: string;
  amount: number;
  debit: { code: string | null; name: string | null };
  credit: { code: string | null; name: string | null };
  description: string;
}

/** طلب مستفيد على مشروع من مشاريع الجمعية */
@Entity('beneficiary_requests')
@Index('UQ_beneficiary_requests_no', ['organizationId', 'requestNo'], { unique: true })
@Index('IDX_beneficiary_requests_org_status', ['organizationId', 'status'])
export class BeneficiaryRequest {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId!: string;

  @Column({ name: 'request_no', type: 'int' })
  requestNo!: number;

  @Index()
  @Column({ name: 'beneficiary_id', type: 'uuid' })
  beneficiaryId!: string;

  @ManyToOne(() => Beneficiary, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'beneficiary_id' })
  beneficiary?: Beneficiary;

  @Column({ name: 'project_id', type: 'uuid' })
  projectId!: string;

  @ManyToOne(() => Activity, { onDelete: 'NO ACTION' })
  @JoinColumn({ name: 'project_id' })
  project?: Activity;

  @Column({ name: 'workflow_id', type: 'uuid' })
  workflowId!: string;

  @ManyToOne(() => Workflow, { onDelete: 'NO ACTION' })
  @JoinColumn({ name: 'workflow_id' })
  workflow?: Workflow;

  @Column({ name: 'current_stage_id', type: 'uuid', nullable: true })
  currentStageId!: string | null;

  @ManyToOne(() => WorkflowStage, { onDelete: 'NO ACTION', nullable: true })
  @JoinColumn({ name: 'current_stage_id' })
  currentStage?: WorkflowStage | null;

  @Column({ type: 'varchar', length: 20, default: 'in_progress' })
  status!: RequestStatus;

  /** portal: من بوابة المستفيد · staff: سجله موظف */
  @Column({ type: 'varchar', length: 10 })
  source!: 'portal' | 'staff';

  @Column({ type: 'text', nullable: true })
  description!: string | null;

  /** إجابات نموذج بيانات الطلب */
  @Column({ name: 'application_data', type: 'jsonb', default: () => `'{}'` })
  applicationData!: Record<string, unknown>;

  /** الخدمات المختارة من خدمات المشروع */
  @Column({ type: 'jsonb', default: () => `'[]'` })
  services!: string[];

  /** التكلفة التقديرية (مجموع تكلفة الخدمات، أو يحددها الموظف) */
  @Column({ name: 'estimated_cost', type: 'numeric', precision: 14, scale: 2, nullable: true, transformer: money })
  estimatedCost!: number | null;

  // ---- نتيجة البحث الاجتماعي الآلية ----
  @Column({ name: 'research_score', type: 'numeric', precision: 5, scale: 2, nullable: true, transformer: money })
  researchScore!: number | null;

  @Column({ name: 'research_outcome', type: 'varchar', length: 20, nullable: true })
  researchOutcome!: 'reject' | 'approve' | 'contribution' | null;

  /** نسبة تحمّل المستفيد من التكلفة */
  @Column({ name: 'contribution_percent', type: 'numeric', precision: 5, scale: 2, nullable: true, transformer: money })
  contributionPercent!: number | null;

  /** نسبة دعم الجمعية من التكلفة (الباقي على المستفيد) */
  @Column({ name: 'support_percent', type: 'numeric', precision: 5, scale: 2, nullable: true, transformer: money })
  supportPercent!: number | null;

  /** اقتراح قواعد التقييم (استرشادي للباحث) */
  @Column({ name: 'rule_suggestion', type: 'jsonb', nullable: true })
  ruleSuggestion!: { score: number; outcome: 'reject' | 'approve' | 'contribution'; contributionPercent: number } | null;

  /** قرار الباحث اختلف عن اقتراح القواعد: بيظهر بعلامة للمعتمد النهائي */
  @Column({ name: 'rule_deviation', type: 'boolean', default: false })
  ruleDeviation!: boolean;

  @Column({ name: 'deviation_reason', type: 'text', nullable: true })
  deviationReason!: string | null;

  // ---- مساهمة المستفيد ----
  @Column({ name: 'contribution_status', type: 'varchar', length: 12, default: 'none' })
  contributionStatus!: ContributionStatus;

  @Column({ name: 'contribution_amount', type: 'numeric', precision: 14, scale: 2, nullable: true, transformer: money })
  contributionAmount!: number | null;

  /** مستند إثبات المساهمة (من مستندات المستفيد) */
  @Column({ name: 'contribution_document_id', type: 'uuid', nullable: true })
  contributionDocumentId!: string | null;

  @Column({ name: 'contribution_sent_at', type: 'timestamptz', nullable: true })
  contributionSubmittedAt!: Date | null;

  @Column({ name: 'contribution_verified_at', type: 'timestamptz', nullable: true })
  contributionVerifiedAt!: Date | null;

  @Column({ name: 'contribution_journal', type: 'jsonb', nullable: true })
  contributionJournal!: JournalEntry | null;

  @Column({ name: 'closed_at', type: 'timestamptz', nullable: true })
  closedAt!: Date | null;

  @Column({ name: 'created_by', type: 'uuid', nullable: true })
  createdBy!: string | null;

  @OneToMany(() => RequestAction, (a) => a.request)
  actions?: RequestAction[];

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
