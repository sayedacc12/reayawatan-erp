import { Column, CreateDateColumn, Entity, Index, PrimaryColumn, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

export const PARTNER_STATUS = {
  prospect: 'شريك محتمل', evaluating: 'قيد التقييم', pending: 'بانتظار الاعتماد', approved: 'شريك معتمد', rejected: 'غير مقبول', suspended: 'موقوف',
} as const;
export type PartnerStatus = keyof typeof PARTNER_STATUS;

export const EVAL_STATUS = { draft: 'مسودة', submitted: 'بانتظار الاعتماد', approved: 'معتمد', rejected: 'مرفوض', returned: 'معاد للمقيّم' } as const;
export type EvalStatus = keyof typeof EVAL_STATUS;

export const CONTRACT_STATUS = {
  draft: 'مسودة', review: 'بانتظار الاعتماد الداخلي', approved: 'معتمد داخليًا', sent: 'مرسل للشريك', changes_requested: 'طلب الشريك تعديلًا',
  signed: 'ساري', expired: 'منتهي', terminated: 'منهى', cancelled: 'ملغى',
} as const;
/** الحالة المخزنة (expired تُحسب من تاريخ النهاية للعقد الموقّع) */
export type ContractStatus = Exclude<keyof typeof CONTRACT_STATUS, 'expired'>;

export const FOLLOWUP_KINDS = { obligation: 'التزام تعاقدي', report: 'تقرير دوري', payment: 'دفعة مالية', meeting: 'اجتماع متابعة', review: 'مراجعة أداء الشراكة', other: 'أخرى' } as const;
export type FollowupKind = keyof typeof FOLLOWUP_KINDS;

/** مستوى الشريك حسب درجة التقييم (مثل: استراتيجي ≥ 85) */
export interface Tier { key: string; label: string; min: number; color: string }
/** تبويب بنود العقود (مثل: الالتزامات، الأحكام المالية) */
export interface ClauseCategory { id: string; name: string; color: string }

export interface LogEntry { action: string; note: string | null; byName: string; at: string }

/** إعدادات الشراكات لكل جمعية */
@Entity('pt_settings')
export class PtSettings {
  @PrimaryColumn({ name: 'organization_id', type: 'uuid' }) organizationId!: string;
  /** مستويات الشركاء حسب الدرجة، من الأعلى للأدنى */
  @Column({ type: 'jsonb', default: () => `'[]'` }) tiers!: Tier[];
  /** تبويب مكتبة البنود */
  @Column({ name: 'clause_categories', type: 'jsonb', default: () => `'[]'` }) clauseCategories!: ClauseCategory[];
  /** التنبيه قبل انتهاء العقد بهذا العدد من الأيام */
  @Column({ name: 'alert_days', type: 'int', default: 60 }) alertDays!: number;
  /** صلاحية تقييم الشريك بالأشهر، ثم يُعاد تقييمه */
  @Column({ name: 'evaluation_months', type: 'int', default: 24 }) evaluationMonths!: number;
  /** من يمثل الجمعية في توقيع العقود افتراضيًا */
  @Column({ name: 'signer_name', type: 'varchar', length: 200, nullable: true }) signerName!: string | null;
  @Column({ name: 'signer_title', type: 'varchar', length: 200, nullable: true }) signerTitle!: string | null;
  @Column({ name: 'org_city', type: 'varchar', length: 100, nullable: true }) orgCity!: string | null;
  @Column({ name: 'org_license', type: 'varchar', length: 60, nullable: true }) orgLicense!: string | null;
  @Column({ name: 'court_city', type: 'varchar', length: 100, nullable: true }) courtCity!: string | null;
}

/** نوع الشراكة (تمويلية، تنفيذية، معرفية ...) */
@Entity('pt_types')
@Index('IDX_pt_types_org', ['organizationId'])
export class PtType {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ name: 'organization_id', type: 'uuid' }) organizationId!: string;
  @Column({ length: 120 }) name!: string;
  @Column({ type: 'varchar', length: 500, nullable: true }) description!: string | null;
  @Column({ type: 'varchar', length: 9, default: '#0f766e' }) color!: string;
  /** أقل درجة تقييم لقبول الشريك في هذا النوع */
  @Column({ name: 'min_score', type: 'int', default: 60 }) minScore!: number;
  /** المدة المعتادة لعقد هذا النوع بالأشهر */
  @Column({ name: 'default_months', type: 'int', default: 12 }) defaultMonths!: number;
  @Column({ name: 'sort_order', type: 'int', default: 0 }) sortOrder!: number;
  @Column({ name: 'is_active', default: true }) isActive!: boolean;
}

/** تصنيف الشريك (جهة حكومية، قطاع خاص، جهة مانحة ...) */
@Entity('pt_classes')
@Index('IDX_pt_classes_org', ['organizationId'])
export class PtClass {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ name: 'organization_id', type: 'uuid' }) organizationId!: string;
  @Column({ length: 120 }) name!: string;
  @Column({ type: 'varchar', length: 500, nullable: true }) description!: string | null;
  @Column({ type: 'varchar', length: 9, default: '#0369a1' }) color!: string;
  @Column({ name: 'sort_order', type: 'int', default: 0 }) sortOrder!: number;
  @Column({ name: 'is_active', default: true }) isActive!: boolean;
}

/** معيار اختيار الشريك: وزن من 100، ودرجة من 1 إلى 5. المعيار الحاسم بدرجة 1 يستبعد الشريك */
@Entity('pt_criteria')
@Index('IDX_pt_criteria_org', ['organizationId'])
export class PtCriterion {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ name: 'organization_id', type: 'uuid' }) organizationId!: string;
  @Column({ length: 200 }) name!: string;
  @Column({ type: 'varchar', length: 800, nullable: true }) guide!: string | null;
  @Column({ type: 'int' }) weight!: number;
  @Column({ default: false }) knockout!: boolean;
  @Column({ name: 'sort_order', type: 'int', default: 0 }) sortOrder!: number;
  @Column({ name: 'is_active', default: true }) isActive!: boolean;
}

/** بند في مكتبة بنود عقود الشراكة: كائن مستقل له تبويب وعنوان وفقرات ومتغيرات */
@Entity('pt_clauses')
@Index('IDX_pt_clauses_org', ['organizationId'])
export class PtClause {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ name: 'organization_id', type: 'uuid' }) organizationId!: string;
  @Column({ name: 'category_id', type: 'varchar', length: 40 }) categoryId!: string;
  @Column({ length: 200 }) title!: string;
  @Column({ type: 'jsonb', default: () => `'[]'` }) paragraphs!: string[];
  /** أنواع الشراكة التي يدخل البند في عقودها تلقائيًا (فارغة = كل الأنواع) */
  @Column({ name: 'type_ids', type: 'jsonb', default: () => `'[]'` }) typeIds!: string[];
  /** بند إلزامي لا يُحذف من أي عقد */
  @Column({ name: 'is_mandatory', default: false }) isMandatory!: boolean;
  /** البند الاختياري لا يدخل العقد تلقائيًا، ويُضاف من المكتبة عند الحاجة */
  @Column({ name: 'is_default', default: true }) isDefault!: boolean;
  @Column({ name: 'is_active', default: true }) isActive!: boolean;
  @Column({ type: 'int', default: 0 }) sequence!: number;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt!: Date;
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' }) updatedAt!: Date;
}

/** الشريك: جهة نتعاون معها أو نرغب في الشراكة معها */
@Entity('pt_partners')
@Index('IDX_pt_partners_org', ['organizationId', 'status'])
@Index('UQ_pt_partners_no', ['organizationId', 'partnerNo'], { unique: true })
export class PtPartner {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ name: 'organization_id', type: 'uuid' }) organizationId!: string;
  @Column({ name: 'partner_no', type: 'int' }) partnerNo!: number;
  @Column({ length: 200 }) name!: string;
  @Column({ name: 'class_id', type: 'uuid', nullable: true }) classId!: string | null;
  /** أنواع الشراكة المرشح لها */
  @Column({ name: 'type_ids', type: 'jsonb', default: () => `'[]'` }) typeIds!: string[];
  /** رقم السجل التجاري أو الترخيص (يُستخدم للتحقق عند التوقيع) */
  @Column({ name: 'registration_no', type: 'varchar', length: 60, nullable: true }) registrationNo!: string | null;
  @Column({ type: 'varchar', length: 100, nullable: true }) city!: string | null;
  @Column({ type: 'varchar', length: 300, nullable: true }) website!: string | null;
  @Column({ name: 'contact_name', type: 'varchar', length: 200, nullable: true }) contactName!: string | null;
  @Column({ name: 'contact_title', type: 'varchar', length: 200, nullable: true }) contactTitle!: string | null;
  @Column({ type: 'varchar', length: 30, nullable: true }) phone!: string | null;
  @Column({ type: 'varchar', length: 200, nullable: true }) email!: string | null;
  @Column({ type: 'text', nullable: true }) about!: string | null;
  /** المانح المقابل في تنمية الموارد (إن كان الشريك داعمًا) */
  @Column({ name: 'donor_id', type: 'uuid', nullable: true }) donorId!: string | null;
  /** يظهر في صفحة الشركاء بالموقع الإلكتروني بعد اعتماده */
  @Column({ name: 'show_on_website', default: false }) showOnWebsite!: boolean;
  @Column({ type: 'varchar', length: 20, default: 'prospect' }) status!: PartnerStatus;
  @Column({ type: 'varchar', length: 30, nullable: true }) tier!: string | null;
  @Column({ type: 'numeric', precision: 5, scale: 2, nullable: true }) score!: string | null;
  @Column({ name: 'approved_at', type: 'timestamptz', nullable: true }) approvedAt!: Date | null;
  /** موعد إعادة التقييم */
  @Column({ name: 'next_evaluation_on', type: 'date', nullable: true }) nextEvaluationOn!: string | null;
  @Column({ type: 'jsonb', default: () => `'[]'` }) log!: LogEntry[];
  @Column({ name: 'created_by_name', type: 'varchar', length: 200 }) createdByName!: string;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt!: Date;
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' }) updatedAt!: Date;
}

export interface EvalScore { criterionId: string; name: string; weight: number; knockout: boolean; score: number; note: string | null }

/** تقييم الشريك وفق معايير الاختيار لنوع شراكة معيّن */
@Entity('pt_evaluations')
@Index('IDX_pt_evaluations_partner', ['organizationId', 'partnerId'])
export class PtEvaluation {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ name: 'organization_id', type: 'uuid' }) organizationId!: string;
  @Column({ name: 'partner_id', type: 'uuid' }) partnerId!: string;
  @Column({ name: 'type_id', type: 'uuid', nullable: true }) typeId!: string | null;
  @Column({ type: 'jsonb', default: () => `'[]'` }) scores!: EvalScore[];
  @Column({ type: 'numeric', precision: 5, scale: 2, default: 0 }) total!: string;
  @Column({ type: 'varchar', length: 30, nullable: true }) tier!: string | null;
  /** أقل درجة للقبول في نوع الشراكة وقت التقييم */
  @Column({ name: 'min_score', type: 'int', default: 0 }) minScore!: number;
  @Column({ name: 'knockout_failed', default: false }) knockoutFailed!: boolean;
  @Column({ type: 'text', nullable: true }) recommendation!: string | null;
  @Column({ type: 'varchar', length: 12, default: 'draft' }) status!: EvalStatus;
  /** اعتُمد رغم مخالفة القواعد (درجة أقل من الحد أو معيار حاسم)، والسبب في decisionNote */
  @Column({ default: false }) overridden!: boolean;
  @Column({ name: 'decision_note', type: 'varchar', length: 1000, nullable: true }) decisionNote!: string | null;
  @Column({ name: 'evaluator_name', type: 'varchar', length: 200 }) evaluatorName!: string;
  @Column({ name: 'submitted_at', type: 'timestamptz', nullable: true }) submittedAt!: Date | null;
  @Column({ name: 'decided_by_name', type: 'varchar', length: 200, nullable: true }) decidedByName!: string | null;
  @Column({ name: 'decided_at', type: 'timestamptz', nullable: true }) decidedAt!: Date | null;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt!: Date;
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' }) updatedAt!: Date;
}

/** بند داخل عقد (نسخة من المكتبة قابلة للتعديل في هذا العقد فقط) */
export interface ContractItem { key: string; clauseId: string | null; categoryId: string; categoryName: string; title: string; paragraphs: string[]; mandatory: boolean }
export interface RenderedClause { title: string; category: string; paragraphs: string[] }
/** نسخة مثبتة من نص العقد عند كل إرسال */
export interface ContractVersion { version: number; rendered: RenderedClause[]; hash: string; sentAt: string; outcome: string | null }

/** عقد شراكة: مسودة ← اعتماد داخلي ← إرسال للشريك ← توقيع إلكتروني ← ساري ← منتهٍ أو منهى */
@Entity('pt_contracts')
@Index('IDX_pt_contracts_org', ['organizationId', 'status'])
@Index('UQ_pt_contracts_number', ['organizationId', 'number'], { unique: true })
export class PtContract {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ name: 'organization_id', type: 'uuid' }) organizationId!: string;
  /** رقم العقد مثل PA-2026-0001 */
  @Column({ length: 32 }) number!: string;
  @Index({ unique: true }) @Column({ length: 64, select: false }) token!: string;
  @Column({ name: 'partner_id', type: 'uuid' }) partnerId!: string;
  @Column({ name: 'type_id', type: 'uuid', nullable: true }) typeId!: string | null;
  @Column({ length: 250 }) title!: string;
  /** المشروع المرتبط في نظام المشاريع (اختياري) */
  @Column({ name: 'project_id', type: 'uuid', nullable: true }) projectId!: string | null;
  @Column({ name: 'starts_on', type: 'date' }) startsOn!: string;
  @Column({ name: 'ends_on', type: 'date' }) endsOn!: string;
  @Column({ type: 'numeric', precision: 14, scale: 2, nullable: true }) value!: string | null;
  @Column({ name: 'org_signer_name', type: 'varchar', length: 200, nullable: true }) orgSignerName!: string | null;
  @Column({ name: 'org_signer_title', type: 'varchar', length: 200, nullable: true }) orgSignerTitle!: string | null;
  @Column({ type: 'varchar', length: 20, default: 'draft' }) status!: ContractStatus;
  /** رقم الإصدار: يزيد مع كل إرسال جديد بعد التعديل */
  @Column({ type: 'int', default: 0 }) version!: number;
  @Column({ type: 'jsonb', default: () => `'[]'` }) items!: ContractItem[];
  @Column({ type: 'jsonb', nullable: true }) rendered!: RenderedClause[] | null;
  @Column({ name: 'content_hash', type: 'varchar', length: 64, nullable: true }) contentHash!: string | null;
  @Column({ type: 'jsonb', default: () => `'[]'` }) versions!: ContractVersion[];
  @Column({ name: 'sent_at', type: 'timestamptz', nullable: true }) sentAt!: Date | null;
  @Column({ name: 'change_request', type: 'text', nullable: true }) changeRequest!: string | null;
  @Column({ name: 'signed_at', type: 'timestamptz', nullable: true }) signedAt!: Date | null;
  @Column({ name: 'signer_name', type: 'varchar', length: 200, nullable: true }) signerName!: string | null;
  @Column({ name: 'signer_title', type: 'varchar', length: 200, nullable: true }) signerTitle!: string | null;
  @Column({ name: 'signer_ip', type: 'varchar', length: 64, nullable: true }) signerIp!: string | null;
  /** طريقة التوقيع: إلكتروني من رابط الشريك، أو مسجل يدويًا بعد توقيع ورقي */
  @Column({ name: 'sign_method', type: 'varchar', length: 12, nullable: true }) signMethod!: 'online' | 'manual' | null;
  @Column({ name: 'renewal_of', type: 'uuid', nullable: true }) renewalOf!: string | null;
  @Column({ name: 'ended_at', type: 'timestamptz', nullable: true }) endedAt!: Date | null;
  @Column({ name: 'end_reason', type: 'varchar', length: 1000, nullable: true }) endReason!: string | null;
  @Column({ type: 'jsonb', default: () => `'[]'` }) log!: LogEntry[];
  @Column({ name: 'created_by_name', type: 'varchar', length: 200 }) createdByName!: string;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt!: Date;
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' }) updatedAt!: Date;
}

/** التزام أو موعد متابعة على عقد شراكة */
@Entity('pt_followups')
@Index('IDX_pt_followups_due', ['organizationId', 'dueDate'])
export class PtFollowup {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ name: 'organization_id', type: 'uuid' }) organizationId!: string;
  @Column({ name: 'contract_id', type: 'uuid' }) contractId!: string;
  @Column({ length: 250 }) title!: string;
  @Column({ type: 'varchar', length: 12, default: 'obligation' }) kind!: FollowupKind;
  /** الطرف المسؤول: الجمعية أو الشريك */
  @Column({ type: 'varchar', length: 8, default: 'org' }) party!: 'org' | 'partner';
  @Column({ name: 'due_date', type: 'date' }) dueDate!: string;
  @Column({ type: 'varchar', length: 200, nullable: true }) responsible!: string | null;
  @Column({ name: 'done_at', type: 'date', nullable: true }) doneAt!: string | null;
  @Column({ type: 'varchar', length: 1000, nullable: true }) note!: string | null;
  @Column({ name: 'created_by_name', type: 'varchar', length: 200 }) createdByName!: string;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt!: Date;
}

export const PARTNERSHIP_ENTITIES = [PtSettings, PtType, PtClass, PtCriterion, PtClause, PtPartner, PtEvaluation, PtContract, PtFollowup];
