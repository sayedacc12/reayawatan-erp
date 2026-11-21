import {
  Check, Column, CreateDateColumn, Entity, Index, JoinColumn, JoinTable, ManyToMany, ManyToOne,
  PrimaryGeneratedColumn, UpdateDateColumn,
} from 'typeorm';
import { Organization } from './organization.entity';
import { Role } from './role.entity';

@Entity('users')
// مدير المنصة بلا جمعية، وكل من عداه لازم ينتمي لجمعية
@Check('CHK_users_tenant', `("is_platform_admin" AND "organization_id" IS NULL) OR (NOT "is_platform_admin" AND "organization_id" IS NOT NULL)`)
export class User {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /** فارغ لمدير المنصة فقط؛ كل مستخدم آخر ينتمي لجمعية واحدة */
  @Column({ name: 'organization_id', type: 'uuid', nullable: true })
  organizationId!: string | null;

  @ManyToOne(() => Organization, { onDelete: 'CASCADE', nullable: true })
  @JoinColumn({ name: 'organization_id' })
  organization!: Organization | null;

  @Column({ name: 'full_name', length: 200 })
  fullName!: string;

  /** يُخزن دائمًا بحروف صغيرة */
  @Index({ unique: true })
  @Column({ length: 254 })
  email!: string;

  /** اسم دخول اختياري (مثل admin)، بحروف صغيرة وفريد على مستوى المنصة */
  @Index('IDX_users_username', { unique: true, where: '"username" IS NOT NULL' })
  @Column({ type: 'varchar', length: 50, nullable: true })
  username!: string | null;

  @Column({ name: 'password_hash', length: 100, select: false })
  passwordHash!: string;

  @Column({ name: 'is_active', default: true })
  isActive!: boolean;

  /** مدير نظام الشركة: له كل الصلاحيات في كل وحدات شركته */
  @Column({ name: 'is_superadmin', default: false })
  isSuperadmin!: boolean;

  /** مدير المنصة: يدير الجمعيات المشتركة ولا يرى بيانات أي جمعية */
  @Column({ name: 'is_platform_admin', default: false })
  isPlatformAdmin!: boolean;

  /** دور عضو فريق المنصة: فارغ = مالك المنصة (كل الصلاحيات)، أو مدير دعم، أو موظف دعم */
  @Column({ name: 'platform_role', type: 'varchar', length: 24, nullable: true })
  platformRole!: 'support_manager' | 'support_agent' | null;

  @ManyToMany(() => Role)
  @JoinTable({
    name: 'user_roles',
    joinColumn: { name: 'user_id', referencedColumnName: 'id' },
    inverseJoinColumn: { name: 'role_id', referencedColumnName: 'id' },
  })
  roles!: Role[];

  /** دخل بكلمة مرور مؤقتة: لا يستخدم النظام حتى يغيّرها */
  @Column({ name: 'must_change_password', default: false })
  mustChangePassword!: boolean;

  /** آخر موعد لاستخدام كلمة المرور المؤقتة */
  @Column({ name: 'temp_password_expires_at', type: 'timestamptz', nullable: true })
  tempPasswordExpiresAt!: Date | null;

  /** رموز الدخول الصادرة قبل هذا الوقت مرفوضة (يُضبط عند إصدار كلمة مؤقتة) */
  @Column({ name: 'sessions_valid_after', type: 'timestamptz', nullable: true })
  sessionsValidAfter!: Date | null;

  @Column({ name: 'last_login_at', type: 'timestamptz', nullable: true })
  lastLoginAt!: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
