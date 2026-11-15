import { Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';
import { Organization } from '../../../core/entities';
import { Workflow } from './workflow.entity';

export type ActivityLevel = 'axis' | 'program' | 'project';

/** تكرار الدعم: مرة واحدة، أو يتجدد كل فترة (المستفيد يقدر يقدم تاني بعدها) */
export type Recurrence = 'once' | 'weekly' | 'monthly' | 'quarterly' | 'semiannual' | 'yearly';

/** خدمة داخل المشروع (مثل: سلة غذائية، بطانية) وتكلفتها التقديرية */
export interface ProjectService {
  name: string;
  cost?: number | null;
}

/**
 * شجرة الأنشطة بثلاث مستويات: محور ← برنامج ← مشروع.
 * طلبات المستفيدين تُقدَّم على مستوى المشروع.
 */
@Entity('activities')
@Index('IDX_activities_org_parent', ['organizationId', 'parentId'])
export class Activity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId!: string;

  @ManyToOne(() => Organization, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'organization_id' })
  organization?: Organization;

  @Column({ type: 'varchar', length: 10 })
  level!: ActivityLevel;

  /** المحور ليس له أب، البرنامج أبوه محور، المشروع أبوه برنامج */
  @Column({ name: 'parent_id', type: 'uuid', nullable: true })
  parentId!: string | null;

  @ManyToOne(() => Activity, { onDelete: 'NO ACTION', nullable: true })
  @JoinColumn({ name: 'parent_id' })
  parent?: Activity | null;

  @Column({ length: 200 })
  name!: string;

  @Column({ type: 'varchar', length: 1000, nullable: true })
  description!: string | null;

  /** للمشاريع: سير العمل الخاص بطلباتها (لو فاضي يُستخدم سير العمل الافتراضي) */
  @Column({ name: 'workflow_id', type: 'uuid', nullable: true })
  workflowId!: string | null;

  @ManyToOne(() => Workflow, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'workflow_id' })
  workflow?: Workflow | null;

  /** للمشاريع: يظهر في بوابة المستفيدين ويمكن التقديم عليه */
  @Column({ name: 'portal_visible', default: true })
  portalVisible!: boolean;

  // ---- قواعد الدعم (للمشاريع) ----

  /** الخدمات المتاحة في المشروع */
  @Column({ type: 'jsonb', default: () => `'[]'` })
  services!: ProjectService[];

  /** المستفيد يختار أكتر من خدمة في نفس الطلب */
  @Column({ name: 'multi_services', default: false })
  multiServices!: boolean;

  /** المستفيد يقدر يفتح أكتر من طلب في نفس الوقت على المشروع */
  @Column({ name: 'allow_concurrent', default: false })
  allowConcurrent!: boolean;

  /** تكرار الدعم */
  @Column({ type: 'varchar', length: 12, default: 'once' })
  recurrence!: Recurrence;

  @Column({ name: 'is_active', default: true })
  isActive!: boolean;

  @Column({ name: 'sort_order', type: 'int', default: 0 })
  sortOrder!: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
