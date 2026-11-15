import { Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { BeneficiaryRequest } from './beneficiary-request.entity';
import { money } from './shared';

export type RequestDecision =
  | 'submitted' | 'approve' | 'reject' | 'return' | 'resubmitted' | 'cancelled'
  | 'skipped' | 'contribution_sent';

/** سجل كل حركة على الطلب: تقديم، قبول مرحلة، رفض، إرجاع مع السبب... */
@Entity('beneficiary_request_actions')
export class RequestAction {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId!: string;

  @Index()
  @Column({ name: 'request_id', type: 'uuid' })
  requestId!: string;

  @ManyToOne(() => BeneficiaryRequest, (r) => r.actions, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'request_id' })
  request?: BeneficiaryRequest;

  /** المرحلة وقت الحركة (الاسم محفوظ حتى لو اتعدلت المرحلة بعدين) */
  @Column({ name: 'stage_id', type: 'uuid', nullable: true })
  stageId!: string | null;

  @Column({ name: 'stage_name', type: 'varchar', length: 200, nullable: true })
  stageName!: string | null;

  @Column({ type: 'varchar', length: 20 })
  decision!: RequestDecision;

  /** الملاحظات أو سبب الرفض/الإرجاع */
  @Column({ type: 'text', nullable: true })
  notes!: string | null;

  /** إجابات نموذج المرحلة (مثل نموذج البحث الاجتماعي) */
  @Column({ name: 'form_name', type: 'varchar', length: 200, nullable: true })
  formName!: string | null;

  @Column({ name: 'form_data', type: 'jsonb', nullable: true })
  formData!: Record<string, unknown> | null;

  /** نسخة من حقول النموذج وقت التعبئة لعرض الإجابات بأسمائها */
  @Column({ name: 'form_fields', type: 'jsonb', nullable: true })
  formFields!: unknown[] | null;

  @Column({ name: 'actor_user_id', type: 'uuid', nullable: true })
  actorUserId!: string | null;

  /** اسم من قام بالحركة (موظف أو المستفيد نفسه) */
  @Column({ name: 'actor_name', length: 200 })
  actorName!: string;

  /** نتيجة التقييم الآلي لو المرحلة فيها نموذج تقييم */
  @Column({ type: 'numeric', precision: 5, scale: 2, nullable: true, transformer: money })
  score!: number | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
