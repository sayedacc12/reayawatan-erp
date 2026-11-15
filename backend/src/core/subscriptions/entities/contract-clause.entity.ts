import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

/**
 * بند في مكتبة بنود عقد الاشتراك. كل بند كائن مستقل له عنوان وفقرات،
 * ويمكن أن تحتوي الفقرات على متغيرات مثل {{اسم الجمعية}} تُستبدل عند إصدار العقد.
 * مدير المنصة يتحكم في البنود وترتيبها، وكل عقد جديد يُنسخ من البنود الفعّالة.
 */
@Entity('contract_clauses')
export class ContractClause {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'int', default: 0 })
  sequence!: number;

  @Column({ length: 200 })
  title!: string;

  @Column({ type: 'jsonb', default: () => "'[]'" })
  paragraphs!: string[];

  /** بند إلزامي: لا يمكن حذفه من أي عقد */
  @Column({ name: 'is_mandatory', default: false })
  isMandatory!: boolean;

  /** بند غير فعّال لا يدخل في العقود الجديدة */
  @Column({ name: 'is_active', default: true })
  isActive!: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
