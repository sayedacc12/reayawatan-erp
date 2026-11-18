import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

export const DOC_TYPES = {
  regulation: 'لائحة', policy: 'سياسة', procedure: 'إجراء ودليل عمل', guide: 'دليل إرشادي', form: 'نموذج', study: 'دراسة وبحث',
  report: 'تقرير', lesson: 'درس مستفاد وأفضل ممارسة', training: 'مادة تدريبية', media: 'مادة إعلامية', other: 'أخرى',
} as const;
export type DocType = keyof typeof DOC_TYPES;
export const DOC_STATUS = { draft: 'مسودة', published: 'منشورة', archived: 'مؤرشفة' } as const;
export type DocStatus = keyof typeof DOC_STATUS;
export const DOC_VISIBILITY = { internal: 'داخلية لموظفي الجمعية', public: 'منشورة في الموقع الإلكتروني' } as const;
export type DocVisibility = keyof typeof DOC_VISIBILITY;

export interface DocFile { key: string; name: string; mime: string; size: number }
/** إصدار سابق للوثيقة: يبقى ملفه محفوظًا للرجوع إليه */
export interface DocVersion { version: string; file: DocFile | null; issuedOn: string | null; note: string | null; byName: string; at: string }
export interface DocLog { action: string; note: string | null; byName: string; at: string }

/** تصنيف في أرشيف المعرفة (مثل: الحوكمة، الموارد البشرية، البرامج) */
@Entity('kn_categories')
@Index('IDX_kn_categories_org', ['organizationId'])
export class KnCategory {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId!: string;

  @Column({ length: 120 })
  name!: string;

  @Column({ type: 'varchar', length: 500, nullable: true })
  description!: string | null;

  @Column({ type: 'varchar', length: 9, default: '#0f766e' })
  color!: string;

  @Column({ name: 'sort_order', type: 'int', default: 0 })
  sortOrder!: number;

  @Column({ name: 'is_active', default: true })
  isActive!: boolean;
}

/** وثيقة معرفية: ملف أو رابط أو نص مكتوب، بإصدار وتصنيف وحالة نشر */
@Entity('kn_documents')
@Index('IDX_kn_documents_org', ['organizationId', 'status'])
@Index('UQ_kn_documents_org_code', ['organizationId', 'code'], { unique: true, where: 'code IS NOT NULL' })
export class KnDocument {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId!: string;

  /** الرمز (مثل ل-01 أو QP-HR-02)، فريد داخل الجمعية إن وُجد */
  @Column({ type: 'varchar', length: 40, nullable: true })
  code!: string | null;

  @Column({ length: 250 })
  title!: string;

  @Column({ name: 'category_id', type: 'uuid', nullable: true })
  categoryId!: string | null;

  @Column({ name: 'doc_type', type: 'varchar', length: 20 })
  docType!: DocType;

  @Column({ type: 'varchar', length: 1500, nullable: true })
  summary!: string | null;

  /** محتوى مكتوب (للأدلة القصيرة والدروس المستفادة) */
  @Column({ type: 'text', nullable: true })
  content!: string | null;

  @Column({ type: 'jsonb', default: () => `'[]'` })
  tags!: string[];

  @Column({ type: 'varchar', length: 20, default: '1.0' })
  version!: string;

  @Column({ name: 'issued_on', type: 'date', nullable: true })
  issuedOn!: string | null;

  /** موعد المراجعة القادمة: تظهر الوثيقة في «تحتاج مراجعة» بعده */
  @Column({ name: 'review_on', type: 'date', nullable: true })
  reviewOn!: string | null;

  /** الجهة المالكة للوثيقة (الإدارة أو اللجنة) */
  @Column({ name: 'owner_name', type: 'varchar', length: 200, nullable: true })
  ownerName!: string | null;

  /** الجهة المعتمدة (مثل: مجلس الإدارة) */
  @Column({ name: 'approved_by', type: 'varchar', length: 200, nullable: true })
  approvedBy!: string | null;

  @Column({ type: 'jsonb', nullable: true })
  file!: DocFile | null;

  @Column({ name: 'external_url', type: 'varchar', length: 500, nullable: true })
  externalUrl!: string | null;

  @Column({ type: 'varchar', length: 12, default: 'internal' })
  visibility!: DocVisibility;

  @Column({ type: 'varchar', length: 12, default: 'draft' })
  status!: DocStatus;

  @Column({ type: 'jsonb', default: () => `'[]'` })
  versions!: DocVersion[];

  @Column({ type: 'jsonb', default: () => `'[]'` })
  log!: DocLog[];

  @Column({ type: 'int', default: 0 })
  views!: number;

  @Column({ type: 'int', default: 0 })
  downloads!: number;

  @Column({ name: 'created_by_name', type: 'varchar', length: 200 })
  createdByName!: string;

  @Column({ name: 'published_at', type: 'timestamptz', nullable: true })
  publishedAt!: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}

export const KNOWLEDGE_ENTITIES = [KnCategory, KnDocument];
