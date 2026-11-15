import { Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import type { ResearchDecision } from '../constants';
import { Beneficiary } from './beneficiary.entity';

/** بحث اجتماعي (زيارة ميدانية) وقرار الاستحقاق الناتج عنه */
@Entity('beneficiary_researches')
export class CaseResearch {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId!: string;

  @Index()
  @Column({ name: 'beneficiary_id', type: 'uuid' })
  beneficiaryId!: string;

  @ManyToOne(() => Beneficiary, (b) => b.researches, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'beneficiary_id' })
  beneficiary?: Beneficiary;

  @Column({ name: 'visit_date', type: 'date' })
  visitDate!: string;

  @Column({ name: 'researcher_name', length: 200 })
  researcherName!: string;

  @Column({ type: 'text' })
  findings!: string;

  @Column({ type: 'varchar', length: 20 })
  decision!: ResearchDecision;

  /** المساعدة المقترحة من الباحث */
  @Column({ name: 'recommended_aid', type: 'varchar', length: 300, nullable: true })
  recommendedAid!: string | null;

  @Column({ name: 'next_review_date', type: 'date', nullable: true })
  nextReviewDate!: string | null;

  @Column({ name: 'created_by', type: 'uuid', nullable: true })
  createdBy!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
