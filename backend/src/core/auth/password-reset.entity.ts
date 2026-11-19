import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/** لمن الحساب: موظف جمعية، أو عضو فريق المنصة، أو مستفيد في البوابة */
export type ResetAudience = 'staff' | 'platform' | 'portal';
/** pending: ينتظر من يسلّمه كلمة مؤقتة · issued: سُلّمت كلمة مؤقتة · completed: غيّرها صاحبها · cancelled: أُلغي */
export type ResetStatus = 'pending' | 'issued' | 'completed' | 'cancelled';

/**
 * طلبات استعادة كلمة المرور وسجلها. كل سطر يحفظ من طلب ومتى ومن أي عنوان،
 * ومن سلّم كلمة المرور المؤقتة ومتى، ومتى غيّرها صاحبها.
 * لا يُسجل سطر لحساب غير موجود، حتى لا يكشف السجل أسماء الدخول المجربة.
 */
@Entity('password_resets')
@Index('IDX_password_resets_org_status', ['organizationId', 'status'])
export class PasswordReset {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'organization_id', type: 'uuid', nullable: true })
  organizationId!: string | null;

  @Column({ type: 'varchar', length: 12 })
  audience!: ResetAudience;

  @Index('IDX_password_resets_user')
  @Column({ name: 'user_id', type: 'uuid', nullable: true })
  userId!: string | null;

  @Index('IDX_password_resets_beneficiary')
  @Column({ name: 'beneficiary_id', type: 'uuid', nullable: true })
  beneficiaryId!: string | null;

  /** اسم صاحب الحساب وقت الطلب (للعرض في السجل) */
  @Column({ name: 'subject_name', length: 200 })
  subjectName!: string;

  /** request: طلبه صاحب الحساب من «نسيت كلمة المرور» · direct: أصدرها المسؤول مباشرة */
  @Column({ type: 'varchar', length: 10, default: 'request' })
  origin!: 'request' | 'direct';

  /**
   * طريقة التسليم. حاليًا manual: المسؤول يسلّم الكلمة المؤقتة بنفسه (واتساب أو اتصال).
   * عند ربط البريد أو الرسائل النصية تُضاف email و sms بنفس السجل.
   */
  @Column({ type: 'varchar', length: 10, default: 'manual' })
  channel!: 'manual' | 'email' | 'sms';

  @Column({ type: 'varchar', length: 12, default: 'pending' })
  status!: ResetStatus;

  @Column({ name: 'request_ip', type: 'varchar', length: 64, nullable: true })
  requestIp!: string | null;

  @Column({ name: 'issued_at', type: 'timestamptz', nullable: true })
  issuedAt!: Date | null;

  @Column({ name: 'issued_by', type: 'varchar', length: 200, nullable: true })
  issuedBy!: string | null;

  /** آخر موعد لاستخدام كلمة المرور المؤقتة */
  @Column({ name: 'expires_at', type: 'timestamptz', nullable: true })
  expiresAt!: Date | null;

  @Column({ name: 'completed_at', type: 'timestamptz', nullable: true })
  completedAt!: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
