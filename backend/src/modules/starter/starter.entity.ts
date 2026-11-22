import { Column, Entity, Index, JoinColumn, ManyToOne, PrimaryColumn } from 'typeorm';
import { Organization } from '../../core/entities';

export interface StarterResult { key: string; label: string; added: number; note?: string }

/**
 * سجل «الإعدادات الافتراضية» لكل نظام في الشركة: صف واحد لكل (منشأة، نظام) يمنع تفعيل الزر أكثر من مرة،
 * ويحفظ من فعّله ومتى وما أضيف في كل خطوة.
 */
@Entity('organization_starters')
@Index('IDX_org_starters_org', ['organizationId'])
export class OrganizationStarter {
  @PrimaryColumn({ name: 'organization_id', type: 'uuid' })
  organizationId!: string;

  @ManyToOne(() => Organization, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'organization_id' })
  organization?: Organization;

  @PrimaryColumn({ name: 'module_code', type: 'varchar', length: 40 })
  moduleCode!: string;

  /** applying: جارية الآن (تحجز الزر)، applied: اكتملت */
  @Column({ type: 'varchar', length: 12 })
  status!: 'applying' | 'applied';

  @Column({ name: 'applied_by', type: 'varchar', length: 200 })
  appliedBy!: string;

  @Column({ name: 'applied_by_id', type: 'uuid' })
  appliedById!: string;

  @Column({ name: 'applied_at', type: 'timestamptz', default: () => 'now()' })
  appliedAt!: Date;

  @Column({ type: 'jsonb', default: () => "'[]'" })
  results!: StarterResult[];
}
