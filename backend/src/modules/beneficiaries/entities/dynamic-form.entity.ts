import { Column, CreateDateColumn, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';
import { Organization } from '../../../core/entities';

/** support = تقييم الباحث: مستحق / مستحق بنسبة (مع نسبة دعم الجمعية) / غير مستحق */
export type FieldType = 'text' | 'textarea' | 'number' | 'date' | 'select' | 'checkbox' | 'support';
export type FormStatus = 'draft' | 'approved';
export type SupportDecision = 'full' | 'partial' | 'none';
export interface SupportAnswer { decision: SupportDecision; percent?: number }

export interface FormField {
  /** مفتاح ثابت بالإنجليزي يُحفظ به الجواب */
  key: string;
  label: string;
  type: FieldType;
  required?: boolean;
  /** خيارات حقل القائمة */
  options?: string[];
  placeholder?: string;
  /** في نموذج التقييم: الأهمية النسبية للبند (% من 100) */
  weight?: number;
  /** درجة كل خيار من 100 (بنفس ترتيب options) */
  optionScores?: number[];
}

export type ScoreOutcome = 'reject' | 'approve' | 'contribution';

/** قاعدة على نتيجة البحث: من درجة إلى درجة ← رفض / قبول / قبول بمساهمة من المستفيد */
export interface ScoreRule {
  min: number;
  max: number;
  outcome: ScoreOutcome;
  /** نسبة تحمّل المستفيد من التكلفة (لـ contribution) */
  contributionPercent?: number;
}

/** نموذج يعرّفه مدير النظام من الإعدادات (مثل نموذج البحث الاجتماعي) */
@Entity('dynamic_forms')
export class DynamicForm {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId!: string;

  @ManyToOne(() => Organization, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'organization_id' })
  organization?: Organization;

  @Column({ length: 200 })
  name!: string;

  @Column({ type: 'varchar', length: 1000, nullable: true })
  description!: string | null;

  @Column({ type: 'jsonb', default: () => `'[]'` })
  fields!: FormField[];

  /** نموذج تقييم: لكل بند أهمية نسبية ولكل اختيار درجة، والنظام يحسب نتيجة من 100 */
  @Column({ default: false })
  scored!: boolean;

  /** قواعد التعامل مع نتيجة التقييم */
  @Column({ type: 'jsonb', default: () => `'[]'` })
  rules!: ScoreRule[];

  /** draft = مستني اعتماد مدير الشاشة، approved = معتمد ويشتغل في المرحلة */
  @Column({ type: 'varchar', length: 10, default: 'draft' })
  status!: FormStatus;

  @Column({ name: 'created_by_name', type: 'varchar', length: 200, nullable: true })
  createdByName!: string | null;

  @Column({ name: 'approved_by_name', type: 'varchar', length: 200, nullable: true })
  approvedByName!: string | null;

  @Column({ name: 'approved_at', type: 'timestamptz', nullable: true })
  approvedAt!: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
