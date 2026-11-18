import { Column, CreateDateColumn, Entity, Index, PrimaryColumn, PrimaryGeneratedColumn, UpdateDateColumn, ValueTransformer } from 'typeorm';
import type { AccountRule, AuditorOpinion, FinFigureKey, FinFigures } from '../catalog';

/** PostgreSQL يرجّع numeric كنص؛ نحوله لرقم */
const num: ValueTransformer = {
  to: (v?: number | null) => v,
  from: (v?: string | null) => (v === null || v === undefined ? null : Number(v)),
};

/** بيانات نظامية عن الجمعية تُستخدم في الإشارات والإنذارات (تُحدّث من الإعدادات) */
export interface GovFacts {
  licenseNo?: string | null;
  licenseExpiry?: string | null;
  boardFormedOn?: string | null;
  boardTermEnd?: string | null;
  boardMembers?: number | null;
  externalAuditor?: string | null;
  auditorContractEnd?: string | null;
  hasBranches?: boolean | null;
  branchesApproved?: boolean | null;
  hasCommittees?: boolean | null;
  openViolations?: number | null;
  websiteUrl?: string | null;
  ctfObliged?: boolean | null;
}

@Entity('gov_settings')
export class GovSettings {
  @PrimaryColumn({ name: 'organization_id', type: 'uuid' })
  organizationId!: string;

  /** تعديلات الجمعية على ربط الأرقام المالية بالحسابات (ما لم يُعدّل يُؤخذ من الافتراضي) */
  @Column({ type: 'jsonb', default: () => `'{}'` })
  mapping!: Partial<Record<FinFigureKey, AccountRule[]>>;

  @Column({ type: 'jsonb', default: () => `'{}'` })
  facts!: GovFacts;

  /** عدد الأيام قبل الموعد التي يبدأ فيها الإنذار */
  @Column({ name: 'alert_days', type: 'int', default: 30 })
  alertDays!: number;

  /** الدرجة المستهدفة للجمعية في التقييم الكلي */
  @Column({ name: 'target_score', type: 'numeric', precision: 5, scale: 2, default: 90, transformer: num })
  targetScore!: number;

  @Column({ name: 'next_assessment_no', type: 'int', default: 1 })
  nextAssessmentNo!: number;

  @Column({ name: 'next_action_no', type: 'int', default: 1 })
  nextActionNo!: number;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}

export const ASSESSMENT_KINDS = ['self', 'mock', 'official'] as const;
export const PERIOD_TYPES = ['quarterly', 'semiannual', 'annual'] as const;
export const ASSESSMENT_STATUSES = ['draft', 'submitted', 'approved'] as const;

export interface ScoreSummary {
  overall: number;
  predicted: number;
  coverage: number;
  axes: { code: string; title: string; weight: number; score: number; predicted: number }[];
  performance: number;
  regulation: number;
  grade: string;
}

/** دورة تقييم: ربعية أو نصف سنوية أو سنوية، أو تقييم تجريبي، أو نتيجة التقييم الرسمي من المركز */
@Entity('gov_assessments')
@Index('UQ_gov_assessments_code', ['organizationId', 'code'], { unique: true })
export class GovAssessment {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId!: string;

  @Column({ type: 'varchar', length: 20 })
  code!: string;

  @Column({ type: 'varchar', length: 250 })
  title!: string;

  @Column({ type: 'varchar', length: 10, default: 'self' })
  kind!: (typeof ASSESSMENT_KINDS)[number];

  @Column({ name: 'period_type', type: 'varchar', length: 12, default: 'quarterly' })
  periodType!: (typeof PERIOD_TYPES)[number];

  @Column({ name: 'fiscal_year', type: 'int' })
  fiscalYear!: number;

  @Column({ name: 'period_from', type: 'date' })
  periodFrom!: string;

  @Column({ name: 'period_to', type: 'date' })
  periodTo!: string;

  @Column({ type: 'varchar', length: 12, default: 'draft' })
  status!: (typeof ASSESSMENT_STATUSES)[number];

  @Column({ type: 'varchar', length: 12, default: 'unqualified' })
  opinion!: AuditorOpinion;

  @Column({ name: 'qualified_items', type: 'int', default: 0 })
  qualifiedItems!: number;

  /** الأرقام المالية المعتمدة في التقييم (لقطة من النظام المالي أو إدخال يدوي) */
  @Column({ type: 'jsonb', nullable: true })
  figures!: FinFigures | null;

  @Column({ name: 'figures_source', type: 'varchar', length: 10, default: 'ledger' })
  figuresSource!: 'ledger' | 'manual';

  @Column({ name: 'figures_at', type: 'timestamptz', nullable: true })
  figuresAt!: Date | null;

  /** آخر نتيجة محسوبة (للمقارنة بين الدورات دون إعادة الحساب) */
  @Column({ type: 'jsonb', nullable: true })
  scores!: ScoreSummary | null;

  @Column({ type: 'varchar', length: 2000, nullable: true })
  notes!: string | null;

  @Column({ name: 'created_by_name', type: 'varchar', length: 200 })
  createdByName!: string;

  @Column({ name: 'submitted_by_name', type: 'varchar', length: 200, nullable: true })
  submittedByName!: string | null;

  @Column({ name: 'approved_by_name', type: 'varchar', length: 200, nullable: true })
  approvedByName!: string | null;

  @Column({ name: 'approved_at', type: 'timestamptz', nullable: true })
  approvedAt!: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}

/** إجابة بند من بنود بطاقات التقييم: اختيار كل سؤال بالترتيب، والشواهد */
@Entity('gov_answers')
@Index('UQ_gov_answers_item', ['assessmentId', 'itemCode'], { unique: true })
export class GovAnswer {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId!: string;

  @Column({ name: 'assessment_id', type: 'uuid' })
  assessmentId!: string;

  @Column({ name: 'item_code', type: 'varchar', length: 20 })
  itemCode!: string;

  @Column({ type: 'jsonb', default: () => `'[]'` })
  choices!: (number | null)[];

  @Column({ type: 'numeric', precision: 6, scale: 2, nullable: true, transformer: num })
  percent!: number | null;

  @Column({ type: 'numeric', precision: 8, scale: 4, default: 0, transformer: num })
  points!: number;

  @Column({ type: 'varchar', length: 2000, nullable: true })
  evidence!: string | null;

  @Column({ type: 'varchar', length: 2000, nullable: true })
  note!: string | null;

  /** الإجابة اقترحها النظام من بيانات الأنظمة الأخرى ولم يغيّرها المقيّم */
  @Column({ name: 'from_signal', type: 'boolean', default: false })
  fromSignal!: boolean;

  @Column({ name: 'answered_by_name', type: 'varchar', length: 200 })
  answeredByName!: string;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}

export const ACTION_STATUSES = ['planned', 'in_progress', 'done', 'cancelled'] as const;
export const PRIORITIES = ['low', 'medium', 'high', 'urgent'] as const;

/** إجراء تحسين: يعالج فجوة في بند أو إنذاراً أو يُضاف يدوياً */
@Entity('gov_actions')
@Index('UQ_gov_actions_code', ['organizationId', 'code'], { unique: true })
export class GovAction {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId!: string;

  @Column({ type: 'varchar', length: 20 })
  code!: string;

  @Column({ name: 'assessment_id', type: 'uuid', nullable: true })
  assessmentId!: string | null;

  @Column({ name: 'item_code', type: 'varchar', length: 20, nullable: true })
  itemCode!: string | null;

  @Column({ name: 'practice_code', type: 'varchar', length: 20, nullable: true })
  practiceCode!: string | null;

  @Column({ type: 'varchar', length: 300 })
  title!: string;

  @Column({ type: 'text', nullable: true })
  description!: string | null;

  @Column({ name: 'owner_name', type: 'varchar', length: 200, nullable: true })
  ownerName!: string | null;

  @Column({ name: 'due_date', type: 'date', nullable: true })
  dueDate!: string | null;

  @Column({ type: 'varchar', length: 12, default: 'planned' })
  status!: (typeof ACTION_STATUSES)[number];

  @Column({ type: 'varchar', length: 10, default: 'medium' })
  priority!: (typeof PRIORITIES)[number];

  @Column({ type: 'int', default: 0 })
  progress!: number;

  /** الدرجات المتوقع كسبها في التقييم الكلي عند التنفيذ */
  @Column({ name: 'expected_gain', type: 'numeric', precision: 8, scale: 3, default: 0, transformer: num })
  expectedGain!: number;

  @Column({ type: 'varchar', length: 10, default: 'manual' })
  source!: 'gap' | 'alert' | 'manual';

  @Column({ name: 'completed_at', type: 'date', nullable: true })
  completedAt!: string | null;

  @Column({ type: 'varchar', length: 2000, nullable: true })
  note!: string | null;

  @Column({ name: 'created_by_name', type: 'varchar', length: 200 })
  createdByName!: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}

export const OBLIGATION_KINDS = [
  'board_meeting', 'ga_meeting', 'quarterly_report', 'annual_statements', 'programs_report', 'budget', 'disclosure', 'self_assessment', 'other',
] as const;
export type ObligationKind = (typeof OBLIGATION_KINDS)[number];

/** موعد نظامي في تقويم الالتزامات: اجتماع أو تقرير أو رفع للمركز */
@Entity('gov_obligations')
@Index('IDX_gov_obligations_due', ['organizationId', 'dueDate'])
export class GovObligation {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId!: string;

  @Column({ type: 'varchar', length: 20 })
  kind!: ObligationKind;

  @Column({ type: 'varchar', length: 300 })
  title!: string;

  /** السنة المالية التي يخصها الالتزام */
  @Column({ name: 'fiscal_year', type: 'int' })
  fiscalYear!: number;

  @Column({ name: 'due_date', type: 'date' })
  dueDate!: string;

  @Column({ name: 'done_date', type: 'date', nullable: true })
  doneDate!: string | null;

  /** بنود الدليل التي يخدمها الالتزام */
  @Column({ type: 'jsonb', default: () => `'[]'` })
  refs!: string[];

  @Column({ type: 'varchar', length: 1000, nullable: true })
  evidence!: string | null;

  @Column({ type: 'varchar', length: 1000, nullable: true })
  note!: string | null;

  @Column({ name: 'done_by_name', type: 'varchar', length: 200, nullable: true })
  doneByName!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}

/** إقرار المستخدم بإنذار أو تأجيله لمدة */
@Entity('gov_alert_states')
@Index('UQ_gov_alert_states_key', ['organizationId', 'alertKey'], { unique: true })
export class GovAlertState {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId!: string;

  @Column({ name: 'alert_key', type: 'varchar', length: 120 })
  alertKey!: string;

  @Column({ name: 'until_date', type: 'date', nullable: true })
  untilDate!: string | null;

  @Column({ type: 'varchar', length: 1000, nullable: true })
  note!: string | null;

  @Column({ name: 'by_name', type: 'varchar', length: 200 })
  byName!: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}

export const GOV_ENTITIES = [GovSettings, GovAssessment, GovAnswer, GovAction, GovObligation, GovAlertState];
