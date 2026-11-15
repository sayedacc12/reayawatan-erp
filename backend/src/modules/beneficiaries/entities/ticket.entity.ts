import { Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';
import { Beneficiary } from './beneficiary.entity';

export type TicketType = 'complaint' | 'suggestion' | 'inquiry';
export type TicketStatus = 'open' | 'answered' | 'closed';

/** شكوى أو اقتراح أو استفسار من المستفيد عبر البوابة */
@Entity('beneficiary_tickets')
@Index('UQ_beneficiary_tickets_no', ['organizationId', 'ticketNo'], { unique: true })
export class Ticket {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId!: string;

  @Column({ name: 'ticket_no', type: 'int' })
  ticketNo!: number;

  @Index()
  @Column({ name: 'beneficiary_id', type: 'uuid' })
  beneficiaryId!: string;

  @ManyToOne(() => Beneficiary, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'beneficiary_id' })
  beneficiary?: Beneficiary;

  @Column({ type: 'varchar', length: 20 })
  type!: TicketType;

  @Column({ length: 200 })
  subject!: string;

  @Column({ type: 'text' })
  message!: string;

  /** طلب مرتبط (اختياري) */
  @Column({ name: 'request_id', type: 'uuid', nullable: true })
  requestId!: string | null;

  @Column({ type: 'varchar', length: 20, default: 'open' })
  status!: TicketStatus;

  @Column({ type: 'text', nullable: true })
  reply!: string | null;

  @Column({ name: 'replied_by_name', type: 'varchar', length: 200, nullable: true })
  repliedByName!: string | null;

  @Column({ name: 'replied_at', type: 'timestamptz', nullable: true })
  repliedAt!: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
