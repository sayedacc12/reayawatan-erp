import { Column, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { Role } from '../../../core/entities';

/**
 * مرحلة من مراحل اعتماد المشاريع. القرارات: موافقة (تنقل المشروع للمرحلة التالية، والأخيرة = اعتماد)،
 * رفض بسبب، أو طلب تعديل يعيده للمرحلة السابقة.
 */
@Entity('project_approval_stages')
@Index('IDX_project_approval_stages_org', ['organizationId', 'sortOrder'])
export class ApprovalStage {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId!: string;

  @Column({ length: 200 })
  name!: string;

  @Column({ type: 'varchar', length: 1000, nullable: true })
  instructions!: string | null;

  @Column({ name: 'sort_order', type: 'int' })
  sortOrder!: number;

  /** الدور المسؤول عن القرار (فارغ = أي مستخدم معه صلاحية اعتماد المشاريع) */
  @Column({ name: 'role_id', type: 'uuid', nullable: true })
  roleId!: string | null;

  @ManyToOne(() => Role, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'role_id' })
  role?: Role | null;
}
