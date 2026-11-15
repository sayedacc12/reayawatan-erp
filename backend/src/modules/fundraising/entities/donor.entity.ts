import { Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';
import { Organization } from '../../../core/entities';
import { DonorLevel, SupportManager } from './settings.entity';

/** سجل الداعمين: حقول أساسية + حقول مرنة يحددها مدير النظام */
@Entity('fundraising_donors')
@Index('UQ_fundraising_donors_no', ['organizationId', 'donorNo'], { unique: true })
export class Donor {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ name: 'organization_id', type: 'uuid' }) organizationId!: string;
  @ManyToOne(() => Organization, { onDelete: 'CASCADE' }) @JoinColumn({ name: 'organization_id' }) organization?: Organization;
  @Column({ name: 'donor_no', type: 'int' }) donorNo!: number;
  @Column({ length: 200 }) name!: string;
  /** individual: فرد · entity: جهة (شركة، مؤسسة مانحة، جهة حكومية) */
  @Column({ type: 'varchar', length: 10, default: 'individual' }) type!: 'individual' | 'entity';
  /** رقم الهوية أو السجل التجاري */
  @Column({ type: 'varchar', length: 50, nullable: true }) identifier!: string | null;
  @Column({ type: 'varchar', length: 30, nullable: true }) phone!: string | null;
  @Column({ type: 'varchar', length: 200, nullable: true }) email!: string | null;
  @Column({ type: 'varchar', length: 100, nullable: true }) city!: string | null;
  @Column({ name: 'level_id', type: 'uuid', nullable: true }) levelId!: string | null;
  @ManyToOne(() => DonorLevel, { onDelete: 'SET NULL', nullable: true }) @JoinColumn({ name: 'level_id' }) level?: DonorLevel | null;
  @Column({ name: 'support_manager_id', type: 'uuid', nullable: true }) supportManagerId!: string | null;
  @ManyToOne(() => SupportManager, { onDelete: 'SET NULL', nullable: true }) @JoinColumn({ name: 'support_manager_id' }) supportManager?: SupportManager | null;
  /** قيم الحقول المرنة حسب مفاتيحها في الإعدادات */
  @Column({ name: 'custom_data', type: 'jsonb', default: () => `'{}'` }) customData!: Record<string, unknown>;
  @Column({ type: 'text', nullable: true }) notes!: string | null;
  @Column({ name: 'is_active', default: true }) isActive!: boolean;
  @Column({ name: 'created_by', type: 'uuid', nullable: true }) createdBy!: string | null;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt!: Date;
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' }) updatedAt!: Date;
}
