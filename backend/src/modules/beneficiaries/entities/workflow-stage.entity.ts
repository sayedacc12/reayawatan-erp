import { Column, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { Role } from '../../../core/entities';
import { DynamicForm } from './dynamic-form.entity';
import { Workflow } from './workflow.entity';

/**
 * مرحلة في سير العمل. القرارات: قبول (ينتقل للمرحلة التالية، والأخيرة = اعتماد نهائي)،
 * رفض، أو إرجاع للمرحلة السابقة مع ذكر السبب.
 */
@Entity('workflow_stages')
export class WorkflowStage {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId!: string;

  @Index()
  @Column({ name: 'workflow_id', type: 'uuid' })
  workflowId!: string;

  @ManyToOne(() => Workflow, (w) => w.stages, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'workflow_id' })
  workflow?: Workflow;

  @Column({ length: 200 })
  name!: string;

  @Column({ type: 'varchar', length: 1000, nullable: true })
  instructions!: string | null;

  @Column({ name: 'sort_order', type: 'int' })
  sortOrder!: number;

  /** نموذج لازم يتعبّى قبل قبول المرحلة (اختياري) */
  @Column({ name: 'form_id', type: 'uuid', nullable: true })
  formId!: string | null;

  @ManyToOne(() => DynamicForm, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'form_id' })
  form?: DynamicForm | null;

  /** الدور المسؤول عن قرار المرحلة (فاضي = أي مستخدم معه صلاحية معالجة الطلبات) */
  @Column({ name: 'role_id', type: 'uuid', nullable: true })
  roleId!: string | null;

  @ManyToOne(() => Role, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'role_id' })
  role?: Role | null;

  @Column({ name: 'can_reject', default: true })
  canReject!: boolean;

  @Column({ name: 'can_return', default: true })
  canReturn!: boolean;
}
