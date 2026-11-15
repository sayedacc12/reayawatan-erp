import { Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import type { Gender } from '../constants';
import { Beneficiary } from './beneficiary.entity';
import { money } from './shared';

/** فرد من أسرة المستفيد */
@Entity('beneficiary_family_members')
export class FamilyMember {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId!: string;

  @Index()
  @Column({ name: 'beneficiary_id', type: 'uuid' })
  beneficiaryId!: string;

  @ManyToOne(() => Beneficiary, (b) => b.family, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'beneficiary_id' })
  beneficiary?: Beneficiary;

  @Column({ name: 'full_name', length: 200 })
  fullName!: string;

  /** صلة القرابة: زوج/زوجة، ابن، ابنة، أب، أم... */
  @Column({ length: 50 })
  relation!: string;

  @Column({ type: 'varchar', length: 10 })
  gender!: Gender;

  @Column({ name: 'birth_date', type: 'date', nullable: true })
  birthDate!: string | null;

  @Column({ name: 'national_id', type: 'varchar', length: 20, nullable: true })
  nationalId!: string | null;

  /** المرحلة الدراسية أو العمل */
  @Column({ type: 'varchar', length: 200, nullable: true })
  occupation!: string | null;

  @Column({ name: 'monthly_income', type: 'numeric', precision: 12, scale: 2, default: 0, transformer: money })
  monthlyIncome!: number;

  @Column({ name: 'health_status', type: 'varchar', length: 300, nullable: true })
  healthStatus!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
