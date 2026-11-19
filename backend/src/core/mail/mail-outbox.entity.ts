import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

export const MAIL_STATUSES = ['queued', 'sending', 'sent', 'failed', 'skipped'] as const;
export type MailStatus = (typeof MAIL_STATUSES)[number];

/**
 * صندوق البريد الصادر: كل رسالة تُحفظ هنا أولًا ثم يرسلها العامل مع إعادة المحاولة.
 * الرسائل الحساسة (كلمة مرور أو رابط استعادة) يُمسح نصها بعد الإرسال أو الفشل النهائي.
 */
@Entity('mail_outbox')
@Index('IDX_mail_outbox_due', ['status', 'nextAttemptAt'])
@Index('IDX_mail_outbox_created', ['createdAt'])
export class MailMessage {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'to_email', length: 254 })
  to!: string;

  @Column({ length: 300 })
  subject!: string;

  @Column({ type: 'text', nullable: true })
  html!: string | null;

  @Column({ type: 'text', nullable: true })
  text!: string | null;

  /** نوع الرسالة: test, contract_link, admin_welcome, temp_password, lifecycle, inquiry_admin, inquiry_ack, password_reset ... */
  @Column({ length: 40 })
  kind!: string;

  @Column({ name: 'organization_id', type: 'uuid', nullable: true })
  organizationId!: string | null;

  @Column({ default: false })
  sensitive!: boolean;

  /** يمنع تكرار نفس التذكير (مثل تنبيه الحذف لنفس الجمعية ونفس الموعد) */
  @Index('UQ_mail_outbox_dedupe', { unique: true })
  @Column({ name: 'dedupe_key', type: 'varchar', length: 200, nullable: true })
  dedupeKey!: string | null;

  @Column({ type: 'varchar', length: 16, default: 'queued' })
  status!: MailStatus;

  @Column({ type: 'int', default: 0 })
  attempts!: number;

  @Column({ name: 'last_error', type: 'varchar', length: 500, nullable: true })
  lastError!: string | null;

  @Column({ name: 'next_attempt_at', type: 'timestamptz', default: () => 'now()' })
  nextAttemptAt!: Date;

  @Column({ name: 'sent_at', type: 'timestamptz', nullable: true })
  sentAt!: Date | null;

  @Column({ name: 'created_by', type: 'varchar', length: 200, nullable: true })
  createdBy!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
