import { Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, OneToMany, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';
import { Organization } from '../../../core/entities';
import { Batch } from './batch.entity';
import { Donor } from './donor.entity';
import { ApprovalStage, BankAccount, SupportManager } from './settings.entity';
import { moneyCol } from './shared';

/** cash: نقدية · in_kind: عينية · pledge: وعد بالدفع (يسدد الداعم بعد تنفيذ المشروع) */
export type OpportunityKind = 'cash' | 'in_kind' | 'pledge';
/** in_progress: في مراحل الاعتماد · returned: أعيدت لمُنشئها للتعديل · approved: معتمدة نهائيًا · rejected: مرفوضة (ملغاة) */
export type OpportunityStatus = 'in_progress' | 'returned' | 'approved' | 'rejected';

export type ResidencyCategory = 'citizen' | 'resident' | 'visitor';
export const RESIDENCY_CATEGORIES: ResidencyCategory[] = ['citizen', 'resident', 'visitor'];

/** اشتراطات الداعم، وتنتقل نسخة منها لكل دفعة */
export interface DonorConditions {
  /** هل يقبل الداعم مساهمة المستفيد (المريض) في التكلفة */
  acceptsPatientContribution: boolean;
  /** الحد الأعلى للصرف للحالة الواحدة */
  maxSpend: number | null;
  nationalities: string[];
  /** فئات الإقامة: citizen مواطن · resident مقيم · visitor زائر */
  categories: ResidencyCategory[];
  /** تاريخ انتهاء المشروع المتفق عليه مع الداعم */
  endDate: string | null;
}

/** فرصة تبرع: الداعم، المبلغ، الاشتراطات، وتوزيع المبلغ على البنود (الدفعات) */
@Entity('fundraising_opportunities')
@Index('UQ_fundraising_opportunities_no', ['organizationId', 'opportunityNo'], { unique: true })
@Index('IDX_fundraising_opportunities_org_status', ['organizationId', 'status'])
export class Opportunity {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ name: 'organization_id', type: 'uuid' }) organizationId!: string;
  @ManyToOne(() => Organization, { onDelete: 'CASCADE' }) @JoinColumn({ name: 'organization_id' }) organization?: Organization;
  @Column({ name: 'opportunity_no', type: 'int' }) opportunityNo!: number;
  @Column({ type: 'varchar', length: 10 }) kind!: OpportunityKind;
  @Column({ type: 'varchar', length: 12, default: 'in_progress' }) status!: OpportunityStatus;
  @Column({ name: 'current_stage_id', type: 'uuid', nullable: true }) currentStageId!: string | null;
  @ManyToOne(() => ApprovalStage, { onDelete: 'SET NULL', nullable: true }) @JoinColumn({ name: 'current_stage_id' }) currentStage?: ApprovalStage | null;

  @Index() @Column({ name: 'donor_id', type: 'uuid' }) donorId!: string;
  @ManyToOne(() => Donor, { onDelete: 'NO ACTION' }) @JoinColumn({ name: 'donor_id' }) donor?: Donor;
  @Column({ name: 'support_manager_id', type: 'uuid', nullable: true }) supportManagerId!: string | null;
  @ManyToOne(() => SupportManager, { onDelete: 'SET NULL', nullable: true }) @JoinColumn({ name: 'support_manager_id' }) supportManager?: SupportManager | null;

  @Column({ name: 'opportunity_date', type: 'date' }) date!: string;
  @Column(moneyCol('total_amount')) totalAmount!: number;
  /** الحساب البنكي الذي حُوِّل إليه التبرع (إلزامي للنقدية) */
  @Column({ name: 'bank_account_id', type: 'uuid', nullable: true }) bankAccountId!: string | null;
  @ManyToOne(() => BankAccount, { onDelete: 'NO ACTION', nullable: true }) @JoinColumn({ name: 'bank_account_id' }) bankAccount?: BankAccount | null;
  /** رقم الحوالة أو المرجع البنكي */
  @Column({ name: 'transfer_reference', type: 'varchar', length: 100, nullable: true }) transferReference!: string | null;

  @Column({ name: 'is_zakat', default: false }) isZakat!: boolean;
  @Column({ type: 'jsonb' }) conditions!: DonorConditions;
  /** اشتراطات أو إضافات أخرى يكتبها الموظف نصًا */
  @Column({ name: 'conditions_text', type: 'text', nullable: true }) conditionsText!: string | null;
  /** للعينية: وصف الأصناف المتبرع بها */
  @Column({ name: 'in_kind_description', type: 'text', nullable: true }) inKindDescription!: string | null;

  /** رقم سند القبض (للنقدية عند الاعتماد) */
  @Column({ name: 'receipt_no', type: 'int', nullable: true }) receiptNo!: number | null;
  @Column({ name: 'journal_entry_id', type: 'uuid', nullable: true }) journalEntryId!: string | null;
  /** للوعد بالدفع: إجمالي ما سدده الداعم */
  @Column(moneyCol('collected_amount')) collectedAmount!: number;

  @Column({ name: 'created_by', type: 'uuid', nullable: true }) createdBy!: string | null;
  @Column({ name: 'created_by_name', type: 'varchar', length: 200, nullable: true }) createdByName!: string | null;
  @Column({ name: 'approved_at', type: 'timestamptz', nullable: true }) approvedAt!: Date | null;
  @Column({ name: 'closed_at', type: 'timestamptz', nullable: true }) closedAt!: Date | null;

  @OneToMany(() => Batch, (b) => b.opportunity) batches?: Batch[];
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt!: Date;
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' }) updatedAt!: Date;
}

export type OpportunityActionType =
  | 'created' | 'edited' | 'resubmitted' | 'approve' | 'reject' | 'return' | 'approved_final'
  | 'document_added' | 'document_removed' | 'collected' | 'amended';

/** سجل الأنشطة على الفرصة: التاريخ، نوع الإجراء، القائم به، والسبب */
@Entity('fundraising_opportunity_actions')
export class OpportunityAction {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ name: 'organization_id', type: 'uuid' }) organizationId!: string;
  @Index() @Column({ name: 'opportunity_id', type: 'uuid' }) opportunityId!: string;
  @ManyToOne(() => Opportunity, { onDelete: 'CASCADE' }) @JoinColumn({ name: 'opportunity_id' }) opportunity?: Opportunity;
  @Column({ type: 'varchar', length: 20 }) action!: OpportunityActionType;
  @Column({ name: 'stage_name', type: 'varchar', length: 200, nullable: true }) stageName!: string | null;
  @Column({ type: 'text', nullable: true }) notes!: string | null;
  @Column({ name: 'actor_user_id', type: 'uuid', nullable: true }) actorUserId!: string | null;
  @Column({ name: 'actor_name', length: 200 }) actorName!: string;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt!: Date;
}

/** مستندات الفرصة: الاتفاقيات، إشعارات التحويل... */
@Entity('fundraising_opportunity_documents')
export class OpportunityDocument {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ name: 'organization_id', type: 'uuid' }) organizationId!: string;
  @Index() @Column({ name: 'opportunity_id', type: 'uuid' }) opportunityId!: string;
  @ManyToOne(() => Opportunity, { onDelete: 'CASCADE' }) @JoinColumn({ name: 'opportunity_id' }) opportunity?: Opportunity;
  @Column({ length: 200 }) title!: string;
  @Column({ name: 'file_name', length: 255 }) fileName!: string;
  @Column({ name: 'storage_key', length: 200 }) storageKey!: string;
  @Column({ name: 'mime_type', length: 100 }) mimeType!: string;
  @Column({ name: 'size_bytes', type: 'int' }) sizeBytes!: number;
  @Column({ name: 'uploaded_by_name', type: 'varchar', length: 200, nullable: true }) uploadedByName!: string | null;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt!: Date;
}

/** سداد وعد بالدفع (كليًا أو جزئيًا) بسند قبض وقيد */
@Entity('fundraising_pledge_collections')
export class PledgeCollection {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ name: 'organization_id', type: 'uuid' }) organizationId!: string;
  @Index() @Column({ name: 'opportunity_id', type: 'uuid' }) opportunityId!: string;
  @ManyToOne(() => Opportunity, { onDelete: 'CASCADE' }) @JoinColumn({ name: 'opportunity_id' }) opportunity?: Opportunity;
  @Column({ name: 'collected_on', type: 'date' }) collectedOn!: string;
  @Column(moneyCol('amount')) amount!: number;
  @Column({ name: 'bank_account_id', type: 'uuid' }) bankAccountId!: string;
  @ManyToOne(() => BankAccount, { onDelete: 'NO ACTION' }) @JoinColumn({ name: 'bank_account_id' }) bankAccount?: BankAccount;
  @Column({ name: 'transfer_reference', type: 'varchar', length: 100, nullable: true }) transferReference!: string | null;
  @Column({ name: 'receipt_no', type: 'int' }) receiptNo!: number;
  @Column({ name: 'journal_entry_id', type: 'uuid', nullable: true }) journalEntryId!: string | null;
  @Column({ name: 'created_by_name', type: 'varchar', length: 200, nullable: true }) createdByName!: string | null;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt!: Date;
}
