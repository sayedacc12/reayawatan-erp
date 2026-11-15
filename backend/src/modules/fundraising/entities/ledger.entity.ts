import { Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, OneToMany, PrimaryGeneratedColumn } from 'typeorm';
import { Organization } from '../../../core/entities';
import { moneyCol } from './shared';

/**
 * دفتر اليومية المبسّط: قيود مزدوجة (مدين = دائن) تصدرها الوحدات.
 * عند بناء وحدة المحاسبة الكاملة تنتقل لها ملكية هذه الجداول.
 */
@Entity('ledger_entries')
@Index('UQ_ledger_entries_no', ['organizationId', 'entryNo'], { unique: true })
export class LedgerEntry {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ name: 'organization_id', type: 'uuid' }) organizationId!: string;
  @ManyToOne(() => Organization, { onDelete: 'CASCADE' }) @JoinColumn({ name: 'organization_id' }) organization?: Organization;
  @Column({ name: 'entry_no', type: 'int' }) entryNo!: number;
  @Column({ name: 'entry_date', type: 'date' }) date!: string;
  @Column({ length: 500 }) description!: string;
  /** مصدر القيد: الوحدة ونوع العملية ورقمها */
  @Column({ name: 'source_module', length: 40 }) sourceModule!: string;
  @Column({ name: 'source_type', length: 40 }) sourceType!: string;
  @Column({ name: 'source_id', type: 'uuid', nullable: true }) sourceId!: string | null;
  @Index() @Column({ name: 'activity_id', type: 'uuid', nullable: true }) activityId!: string | null;
  @Index() @Column({ name: 'batch_id', type: 'uuid', nullable: true }) batchId!: string | null;
  @Index() @Column({ name: 'opportunity_id', type: 'uuid', nullable: true }) opportunityId!: string | null;
  @Column(moneyCol('total')) total!: number;
  /** posted: مرحّل · reversed: عُكس بقيد آخر */
  @Column({ type: 'varchar', length: 10, default: 'posted' }) status!: 'posted' | 'reversed';
  @Column({ name: 'reversal_of_id', type: 'uuid', nullable: true }) reversalOfId!: string | null;
  @Column({ name: 'reversed_by_id', type: 'uuid', nullable: true }) reversedById!: string | null;
  @Column({ name: 'created_by_name', type: 'varchar', length: 200, nullable: true }) createdByName!: string | null;
  @OneToMany(() => LedgerLine, (l) => l.entry) lines?: LedgerLine[];
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt!: Date;
}

@Entity('ledger_lines')
export class LedgerLine {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ name: 'organization_id', type: 'uuid' }) organizationId!: string;
  @Index() @Column({ name: 'entry_id', type: 'uuid' }) entryId!: string;
  @ManyToOne(() => LedgerEntry, (e) => e.lines, { onDelete: 'CASCADE' }) @JoinColumn({ name: 'entry_id' }) entry?: LedgerEntry;
  @Column({ name: 'line_no', type: 'int' }) lineNo!: number;
  @Column({ name: 'account_code', type: 'varchar', length: 50, nullable: true }) accountCode!: string | null;
  @Column({ name: 'account_name', length: 200 }) accountName!: string;
  @Column(moneyCol('debit')) debit!: number;
  @Column(moneyCol('credit')) credit!: number;
  @Column({ type: 'varchar', length: 300, nullable: true }) memo!: string | null;
  /** الدفعة والمشروع الخاصين بالسطر (لتتبع القيود على مستوى المشروع) */
  @Index() @Column({ name: 'batch_id', type: 'uuid', nullable: true }) batchId!: string | null;
  @Index() @Column({ name: 'activity_id', type: 'uuid', nullable: true }) activityId!: string | null;
}
