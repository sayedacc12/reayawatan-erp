import { Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import type { AidType } from '../constants';
import { Beneficiary } from './beneficiary.entity';
import { BeneficiaryRequest } from './beneficiary-request.entity';
import { money } from './shared';

/** مساعدة مصروفة لمستفيد (نقدية أو عينية بقيمتها التقديرية) */
@Entity('beneficiary_aids')
@Index('IDX_beneficiary_aids_org_date', ['organizationId', 'disbursedOn'])
export class AidDisbursement {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId!: string;

  @Index()
  @Column({ name: 'beneficiary_id', type: 'uuid' })
  beneficiaryId!: string;

  @ManyToOne(() => Beneficiary, (b) => b.aids, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'beneficiary_id' })
  beneficiary?: Beneficiary;

  @Column({ name: 'aid_type', type: 'varchar', length: 20 })
  aidType!: AidType;

  @Column({ type: 'numeric', precision: 12, scale: 2, default: 0, transformer: money })
  amount!: number;

  @Column({ type: 'varchar', length: 300, nullable: true })
  description!: string | null;

  @Column({ name: 'disbursed_on', type: 'date' })
  disbursedOn!: string;

  /** رقم إيصال الصرف أو المرجع */
  @Column({ name: 'reference_no', type: 'varchar', length: 50, nullable: true })
  referenceNo!: string | null;

  /** الطلب المعتمد الذي صُرفت عليه المساعدة (اختياري) */
  @Column({ name: 'request_id', type: 'uuid', nullable: true })
  requestId!: string | null;

  @ManyToOne(() => BeneficiaryRequest, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'request_id' })
  request?: BeneficiaryRequest | null;

  @Column({ name: 'created_by', type: 'uuid', nullable: true })
  createdBy!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
