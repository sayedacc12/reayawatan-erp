import { Column, CreateDateColumn, Entity, JoinColumn, ManyToOne, OneToMany, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';
import { Organization } from '../../../core/entities';
import { DynamicForm } from './dynamic-form.entity';
import { WorkflowStage } from './workflow-stage.entity';

/** سير عمل الطلبات: مراحل مرتبة تنتهي بالاعتماد النهائي */
@Entity('workflows')
export class Workflow {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId!: string;

  @ManyToOne(() => Organization, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'organization_id' })
  organization?: Organization;

  @Column({ length: 200 })
  name!: string;

  @Column({ type: 'varchar', length: 1000, nullable: true })
  description!: string | null;

  /** سير العمل المستخدم للمشاريع التي لم يُحدد لها سير عمل */
  @Column({ name: 'is_default', default: false })
  isDefault!: boolean;

  /** نموذج بيانات الطلب يعبّيه مقدم الطلب (من البوابة أو الموظف) عند التقديم */
  @Column({ name: 'application_form_id', type: 'uuid', nullable: true })
  applicationFormId!: string | null;

  @ManyToOne(() => DynamicForm, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'application_form_id' })
  applicationForm?: DynamicForm | null;

  @OneToMany(() => WorkflowStage, (s) => s.workflow)
  stages?: WorkflowStage[];

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
