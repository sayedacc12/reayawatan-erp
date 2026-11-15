import { Column, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';

/** إعدادات إدارة المشاريع لكل جمعية: التوجيه المحاسبي لقيود الصرف */
@Entity('project_settings')
export class ProjectSettings {
  @PrimaryColumn({ name: 'organization_id', type: 'uuid' })
  organizationId!: string;

  /** الحساب المدين عند الصرف (مصروفات المشاريع) */
  @Column({ name: 'expense_debit_code', type: 'varchar', length: 50, nullable: true })
  expenseDebitCode!: string | null;

  @Column({ name: 'expense_debit_name', type: 'varchar', length: 200, nullable: true })
  expenseDebitName!: string | null;

  /** الحساب الدائن عند الصرف (البنك / الصندوق) */
  @Column({ name: 'payment_credit_code', type: 'varchar', length: 50, nullable: true })
  paymentCreditCode!: string | null;

  @Column({ name: 'payment_credit_name', type: 'varchar', length: 200, nullable: true })
  paymentCreditName!: string | null;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
