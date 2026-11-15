import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

export type ProjectActionKind = 'created' | 'submitted' | 'approved' | 'rejected' | 'returned' | 'reopened' | 'edited';

/** سجل اعتماد المشروع: كل قرار بمن اتخذه ومتى وفي أي مرحلة */
@Entity('project_actions')
@Index('IDX_project_actions_project', ['activityId', 'createdAt'])
export class ProjectAction {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId!: string;

  @Column({ name: 'activity_id', type: 'uuid' })
  activityId!: string;

  @Column({ type: 'varchar', length: 12 })
  kind!: ProjectActionKind;

  @Column({ name: 'stage_name', type: 'varchar', length: 200, nullable: true })
  stageName!: string | null;

  @Column({ type: 'text', nullable: true })
  note!: string | null;

  @Column({ name: 'user_id', type: 'uuid', nullable: true })
  userId!: string | null;

  @Column({ name: 'user_name', type: 'varchar', length: 200 })
  userName!: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
