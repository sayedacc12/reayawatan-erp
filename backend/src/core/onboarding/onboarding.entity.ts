import { Column, Entity, JoinColumn, ManyToOne, PrimaryColumn, UpdateDateColumn } from 'typeorm';
import { User } from '../entities/user.entity';

/** حالة التعريف بالنظام لكل مستخدم: شاشة الترحيب والجولة وخطوات الإطلاق وما احتُفل به */
@Entity('user_onboarding')
export class UserOnboarding {
  @PrimaryColumn({ name: 'user_id', type: 'uuid' })
  userId!: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user!: User;

  /** متى رأى شاشة الترحيب أول مرة */
  @Column({ name: 'welcome_seen_at', type: 'timestamptz', nullable: true })
  welcomeSeenAt!: Date | null;

  /** متى أنهى الجولة التعريفية أو تخطاها */
  @Column({ name: 'tour_done_at', type: 'timestamptz', nullable: true })
  tourDoneAt!: Date | null;

  /** أخفى بطاقة خطوات الإطلاق من لوحته */
  @Column({ name: 'launch_hidden', default: false })
  launchHidden!: boolean;

  /** خطوات علّمها يدويًا: { مفتاح الخطوة: 'done' | 'skipped' } */
  @Column({ type: 'jsonb', default: () => `'{}'` })
  marks!: Record<string, 'done' | 'skipped'>;

  /** ما احتُفل به من قبل (مراحل وخطوات) حتى لا تتكرر التهنئة */
  @Column({ type: 'jsonb', default: () => `'[]'` })
  celebrated!: string[];

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
