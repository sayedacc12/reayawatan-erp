import { Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import type { DocumentType } from '../constants';
import { Beneficiary } from './beneficiary.entity';

/** مستند مرفوع لملف المستفيد. الملف نفسه على القرص في UPLOAD_DIR */
@Entity('beneficiary_documents')
export class BeneficiaryDocument {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId!: string;

  @Index()
  @Column({ name: 'beneficiary_id', type: 'uuid' })
  beneficiaryId!: string;

  @ManyToOne(() => Beneficiary, (b) => b.documents, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'beneficiary_id' })
  beneficiary?: Beneficiary;

  @Column({ length: 200 })
  title!: string;

  @Column({ name: 'doc_type', type: 'varchar', length: 30 })
  docType!: DocumentType;

  @Column({ name: 'original_name', length: 255 })
  originalName!: string;

  @Column({ name: 'mime_type', length: 100 })
  mimeType!: string;

  @Column({ type: 'int' })
  size!: number;

  /** المسار النسبي داخل UPLOAD_DIR: <organization_id>/<uuid> */
  @Column({ name: 'storage_key', length: 200, select: false })
  storageKey!: string;

  @Column({ name: 'uploaded_by', type: 'uuid', nullable: true })
  uploadedBy!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
