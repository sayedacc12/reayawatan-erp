import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

export interface HistoryEntry { at: string; by: string; byId?: string; action: string; before: unknown; after: unknown }

/**
 * ربط يدوي لحساب ببند في القوائم المالية، يسري على الحساب وما تحته ويتقدم على الربط الافتراضي.
 * الحساب الذي ليس له صف هنا يأخذ ربط أقرب أب له صف، وإلا الربط الافتراضي من fs-template.ts.
 */
@Entity('acc_fs_mappings')
@Index('UQ_acc_fs_mappings_account', ['organizationId', 'accountId'], { unique: true })
export class FsMapping {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId!: string;

  @Column({ name: 'account_id', type: 'uuid' })
  accountId!: string;

  /** null = أُلغي الربط اليدوي وعاد الحساب للربط الافتراضي (يبقى السطر لحفظ سجل التغييرات) */
  @Column({ name: 'line_code', type: 'varchar', length: 20, nullable: true })
  lineCode!: string | null;

  /** سجل التعديلات: من وماذا ومتى، والقيمة قبل وبعد */
  @Column({ type: 'jsonb', default: () => `'[]'` })
  history!: HistoryEntry[];

  @Column({ name: 'updated_by_name', type: 'varchar', length: 200 })
  updatedByName!: string;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}

/** برنامج مقترح تمويله من حصة المصارف غير الربحية (المبلغ بالهللات) */
export interface AppropriationProgram { channel: number; name: string; amountHalalas: number }

export interface AppropriationInputs {
  /** نسبة تنمية الاستثمارات والتوسع ومنها الاحتياطي (حد النظام الأساس 30%) */
  developmentPct: number;
  /** نسبة التوزيع (حد النظام الأساس 10%) */
  distributionPct: number;
  /** الاحتياطي التشغيلي المستهدف بعدد أشهر من المصروفات */
  reserveMonths: number;
  /** أرباح غير محققة نقدًا تُستبعد (مثل أرباح إعادة التقييم)، بالهللات */
  unrealizedHalalas: number;
  programs: AppropriationProgram[];
  /** مرجع قرار المجلس بعد الاعتماد (نص) */
  boardDecision: string | null;
  notes: string | null;
}

/**
 * مشروع توزيع (تخصيص) أرباح سنة مالية وفق المادة (10) من النظام الأساس وسياسة POL-FIN-03.
 * مقترح يُرفع مع القوائم المالية السنوية؛ لا يُنشئ قيودًا. صف واحد لكل سنة مالية.
 */
@Entity('acc_fs_appropriations')
@Index('UQ_acc_fs_appropriations_year', ['organizationId', 'fiscalYearId'], { unique: true })
export class FsAppropriation {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId!: string;

  @Column({ name: 'fiscal_year_id', type: 'uuid' })
  fiscalYearId!: string;

  @Column({ type: 'jsonb' })
  inputs!: AppropriationInputs;

  /** سُحب المشروع (لا يُحذف حتى يبقى أثره)، ويعود للظهور بالقيم المقترحة؛ والحفظ التالي يعيده */
  @Column({ name: 'withdrawn_at', type: 'timestamptz', nullable: true })
  withdrawnAt!: Date | null;

  @Column({ type: 'jsonb', default: () => `'[]'` })
  history!: HistoryEntry[];

  @Column({ name: 'created_by_name', type: 'varchar', length: 200 })
  createdByName!: string;

  @Column({ name: 'updated_by_name', type: 'varchar', length: 200 })
  updatedByName!: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}

/** سجل إصدار ملف القوائم المالية النهائي (بعد إغلاق الفترة): رقم متسلسل وملخص الأرقام وبصمة الملف */
@Entity('acc_fs_issues')
@Index('UQ_acc_fs_issues_no', ['organizationId', 'issueNo'], { unique: true })
export class FsIssue {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId!: string;

  @Column({ name: 'issue_no', type: 'int' })
  issueNo!: number;

  @Column({ name: 'fiscal_year_id', type: 'uuid' })
  fiscalYearId!: string;

  /** الفترة: Y أو Q1..Q4 أو H1..H2 أو M01..M12 من شهور السنة المالية */
  @Column({ name: 'period_key', type: 'varchar', length: 8 })
  periodKey!: string;

  @Column({ name: 'period_label', type: 'varchar', length: 120 })
  periodLabel!: string;

  @Column({ name: 'from_date', type: 'date' })
  fromDate!: string;

  @Column({ name: 'to_date', type: 'date' })
  toDate!: string;

  /** إجماليات القوائم وقت الإصدار (للمطابقة مع الملف المرسل للمراجع) */
  @Column({ type: 'jsonb' })
  totals!: Record<string, number>;

  /** بصمة SHA-256 لملف PDF المصدر */
  @Column({ type: 'varchar', length: 64 })
  sha256!: string;

  @Column({ name: 'issued_by_name', type: 'varchar', length: 200 })
  issuedByName!: string;

  @Column({ name: 'issued_by_id', type: 'uuid', nullable: true })
  issuedById!: string | null;

  @CreateDateColumn({ name: 'issued_at', type: 'timestamptz' })
  issuedAt!: Date;
}

export const FS_ENTITIES = [FsMapping, FsAppropriation, FsIssue];
