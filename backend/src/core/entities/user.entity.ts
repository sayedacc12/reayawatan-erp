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

  @Column({ name: 'password_hash', length: 100, select: false })
  passwordHash!: string;

  @Column({ name: 'is_active', default: true })
  isActive!: boolean;

  /** مدير نظام الجمعية: له كل الصلاحيات في كل وحدات جمعيته */
  @Column({ name: 'is_superadmin', default: false })
  isSuperadmin!: boolean;

  /** مدير المنصة: يدير الجمعيات المشتركة ولا يرى بيانات أي جمعية */
  @Column({ name: 'is_platform_admin', default: false })
  isPlatformAdmin!: boolean;

  @ManyToMany(() => Role)
  @JoinTable({
    name: 'user_roles',
    joinColumn: { name: 'user_id', referencedColumnName: 'id' },
    inverseJoinColumn: { name: 'role_id', referencedColumnName: 'id' },
  })
  roles!: Role[];

  @Column({ name: 'last_login_at', type: 'timestamptz', nullable: true })
  lastLoginAt!: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
