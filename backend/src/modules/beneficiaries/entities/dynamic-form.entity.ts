import { Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';
import { Organization } from '../../../core/entities';

/** support = تقييم الباحث: مستحق / مستحق بنسبة (مع نسبة دعم الجمعية) / غير مستحق */
export type FieldType = 'text' | 'textarea' | 'number' | 'date' | 'select' | 'checkbox' | 'support';
/** مسار اعتماد النموذج (ضبط الوثائق - ISO 9001): إنشاء ← مراجعة الجودة ← اعتماد مدير الشاشة */
export type FormStatus = 'draft' | 'review' | 'reviewed' | 'approved';
export type FormStep = 'created' | 'edited' | 'submitted' | 'reviewed' | 'approved' | 'returned';
export interface FormHistoryEntry { step: FormStep; by: string; at: string; note?: string; revision?: number }
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
@Index('UQ_dynamic_forms_quality_code', ['organizationId', 'qualityCode'], { unique: true })
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

  /** كود الوثيقة في نظام الجودة (ISO 9001)، مثال QF-BEN-01 */
  @Column({ name: 'quality_code', type: 'varchar', length: 50, nullable: true })
  qualityCode!: string | null;

  /** رقم الإصدار: 0 عند أول اعتماد ويزيد مع كل اعتماد بعد تعديل */
  @Column({ type: 'int', default: 0 })
  revision!: number;

  /** draft = مسودة، review = عند مراجع الجودة، reviewed = مستني اعتماد مدير الشاشة، approved = معتمد ويشتغل */
  @Column({ type: 'varchar', length: 10, default: 'draft' })
  status!: FormStatus;

  /** سجل مراحل الاعتماد */
  @Column({ type: 'jsonb', default: () => `'[]'` })
  history!: FormHistoryEntry[];

  @Column({ name: 'reviewed_by_name', type: 'varchar', length: 200, nullable: true })
  reviewedByName!: string | null;

  @Column({ name: 'reviewed_at', type: 'timestamptz', nullable: true })
  reviewedAt!: Date | null;

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
