import { Column, Entity, JoinColumn, OneToOne, PrimaryColumn, UpdateDateColumn } from 'typeorm';
import { Organization } from '../../../core/entities';

/** إعدادات عامة لوحدة المستفيدين لكل جمعية (مثل توجيه القيد المحاسبي للمساهمات) */
@Entity('beneficiary_settings')
export class BeneficiarySettings {
  @PrimaryColumn({ name: 'organization_id', type: 'uuid' })
  organizationId!: string;

  @OneToOne(() => Organization, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'organization_id' })
  organization?: Organization;

  /** الحساب المدين لمساهمات المستفيدين (مثل: البنك / الصندوق) */
  @Column({ name: 'contribution_debit_code', type: 'varchar', length: 50, nullable: true })
  contributionDebitCode!: string | null;

  @Column({ name: 'contribution_debit_name', type: 'varchar', length: 200, nullable: true })
  contributionDebitName!: string | null;

  /** الحساب الدائن (مثل: إيرادات مساهمات المستفيدين) */
  @Column({ name: 'contribution_credit_code', type: 'varchar', length: 50, nullable: true })
  contributionCreditCode!: string | null;

  @Column({ name: 'contribution_credit_name', type: 'varchar', length: 200, nullable: true })
  contributionCreditName!: string | null;

  /** بيان القيد */
  @Column({ name: 'contribution_description', type: 'varchar', length: 300, nullable: true })
  contributionDescription!: string | null;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
