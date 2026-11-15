import { Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, OneToOne, PrimaryColumn, UpdateDateColumn } from 'typeorm';
import { Activity } from '../../beneficiaries/entities';
import { money } from '../../beneficiaries/entities/shared';
import { ApprovalStage } from './approval-stage.entity';

/**
 * beneficiaries: الصرف على طلبات المستفيدين (تحميل كل طلب على دفعة)
 * general: صرف عام غير مرتبط بمستفيدين (مثل المشاريع الإعلامية التوعوية) بفواتير مباشرة
 */
export type SpendingMode = 'beneficiaries' | 'general';
/** annual: مشروع يُنشأ لسنة مالية محددة. continuous: مشروع مستمر لا يُعاد إنشاؤه كل سنة */
export type DurationType = 'annual' | 'continuous';
export interface ProjectPhase { name: string; startDate?: string | null; endDate?: string | null; deliverables?: string | null }
export interface ProjectKpi { name: string; baseline?: number | null; target?: number | null; unit?: string | null }
export interface BudgetLine { item: string; quantity?: number | null; unitCost?: number | null; amount: number; notes?: string | null }

/** بيانات المشروع في نظام إدارة المشاريع (سجل واحد لكل مشروع في شجرة الأنشطة) */
@Entity('project_profiles')
@Index('UQ_project_profiles_no', ['organizationId', 'projectNo'], { unique: true })
export class ProjectProfile {
  @PrimaryColumn({ name: 'activity_id', type: 'uuid' })
  activityId!: string;

  @OneToOne(() => Activity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'activity_id' })
  activity?: Activity;

  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId!: string;

  /** رقم المشروع: مسلسل داخل الجمعية (PRJ-0001) */
  @Column({ name: 'project_no', type: 'int' })
  projectNo!: number;

  @Column({ name: 'spending_mode', type: 'varchar', length: 15, default: 'beneficiaries' })
  spendingMode!: SpendingMode;

  @Column({ name: 'manager_name', type: 'varchar', length: 200, nullable: true })
  managerName!: string | null;

  @Column({ name: 'start_date', type: 'date', nullable: true })
  startDate!: string | null;

  @Column({ name: 'end_date', type: 'date', nullable: true })
  endDate!: string | null;

  /** الميزانية التقديرية */
  @Column({ type: 'numeric', precision: 14, scale: 2, nullable: true, transformer: money })
  budget!: number | null;

  /** عدد المستفيدين المستهدف */
  @Column({ name: 'target_beneficiaries', type: 'int', nullable: true })
  targetBeneficiaries!: number | null;

  @Column({ type: 'text', nullable: true })
  goals!: string | null;

  // ---- وثيقة المشروع ----
  @Column({ name: 'duration_type', type: 'varchar', length: 12, default: 'annual' })
  durationType!: DurationType;

  /** السنة المالية للمشروع السنوي */
  @Column({ name: 'fiscal_year', type: 'int', nullable: true })
  fiscalYear!: number | null;

  /** فكرة المشروع ومبرراته */
  @Column({ type: 'text', nullable: true })
  idea!: string | null;

  /** الفئات المستهدفة */
  @Column({ name: 'target_groups', type: 'text', nullable: true })
  targetGroups!: string | null;

  /** نطاق التنفيذ الجغرافي */
  @Column({ type: 'varchar', length: 300, nullable: true })
  location!: string | null;

  /** المخرجات والأثر المتوقع */
  @Column({ type: 'text', nullable: true })
  outcomes!: string | null;

  /** المخاطر وطرق معالجتها */
  @Column({ type: 'text', nullable: true })
  risks!: string | null;

  /** مراحل التنفيذ */
  @Column({ type: 'jsonb', default: () => "'[]'" })
  phases!: ProjectPhase[];

  /** مؤشرات الأداء */
  @Column({ type: 'jsonb', default: () => "'[]'" })
  kpis!: ProjectKpi[];

  /** بنود الموازنة (مجموعها = الميزانية) */
  @Column({ name: 'budget_lines', type: 'jsonb', default: () => "'[]'" })
  budgetLines!: BudgetLine[];

  /** مرحلة الاعتماد الحالية (عندما تكون الحالة pending) */
  @Column({ name: 'current_stage_id', type: 'uuid', nullable: true })
  currentStageId!: string | null;

  @ManyToOne(() => ApprovalStage, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'current_stage_id' })
  currentStage?: ApprovalStage | null;

  @Column({ name: 'submitted_at', type: 'timestamptz', nullable: true })
  submittedAt!: Date | null;

  @Column({ name: 'approved_at', type: 'timestamptz', nullable: true })
  approvedAt!: Date | null;

  @Column({ name: 'created_by_name', type: 'varchar', length: 200, nullable: true })
  createdByName!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
