import { Check, Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { Role } from './role.entity';
import { User } from './user.entity';

/**
 * التكليف: دور يُسند لمستخدم من تاريخ إلى تاريخ (بتوقيت الرياض)، ويسقط تلقائيًا بعد تاريخ نهايته إن حُدد، أو بإنهائه.
 * صلاحيات المستخدم = أدواره الدائمة + أدوار تكليفاته السارية اليوم (العرض effective_user_roles).
 */
@Entity('role_assignments')
@Index('IDX_role_assignments_org_user', ['organizationId', 'userId'])
@Check('CHK_role_assignments_dates', '"end_date" IS NULL OR "end_date" >= "start_date"')
export class RoleAssignment {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId!: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId!: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user?: User;

  @Column({ name: 'role_id', type: 'uuid' })
  roleId!: string;

  @ManyToOne(() => Role, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'role_id' })
  role?: Role;

  @Column({ name: 'start_date', type: 'date' })
  startDate!: string;

  /** فارغ = مفتوح حتى يُنهى (إلى أن يأتي تعيين جديد) */
  @Column({ name: 'end_date', type: 'date', nullable: true })
  endDate!: string | null;

  /** سبب التكليف أو رقم قراره */
  @Column({ type: 'varchar', length: 500, nullable: true })
  note!: string | null;

  @Column({ name: 'created_by_name', type: 'varchar', length: 200 })
  createdByName!: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  /** إنهاء التكليف قبل موعده */
  @Column({ name: 'ended_at', type: 'timestamptz', nullable: true })
  endedAt!: Date | null;

  @Column({ name: 'ended_by_name', type: 'varchar', length: 200, nullable: true })
  endedByName!: string | null;
}
