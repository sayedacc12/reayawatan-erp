import {
  Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, OneToMany, PrimaryGeneratedColumn, UpdateDateColumn,
} from 'typeorm';
import { Activity } from './activity.entity';
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
