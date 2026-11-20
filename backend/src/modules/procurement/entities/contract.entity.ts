import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn, ValueTransformer } from 'typeorm';
import { ItemFile, LogEntry } from './procurement.entity';

const num: ValueTransformer = {
  to: (v?: number | null) => v,
  from: (v?: string | null) => (v === null || v === undefined ? null : Number(v)),
};
const money = (name: string) => ({ name, type: 'numeric' as const, precision: 16, scale: 2, transformer: num, default: 0 });

// ---------------- العقود ----------------

export const CONTRACT_KINDS = { supply: 'عقد توريد', service: 'عقد خدمات', framework: 'اتفاقية إطارية' } as const;
export type ContractKind = keyof typeof CONTRACT_KINDS;

/** دورة العقد: مسودة ← بانتظار الاعتماد ← ساري ← منتهٍ أو منهى. الملاحق تُعتمد ويبقى أثرها في النسخ التاريخية */
export const CONTRACT_STATUS = {
  draft: 'مسودة', pending: 'بانتظار الاعتماد', returned: 'معاد للتعديل', active: 'ساري', suspended: 'موقوف مؤقتًا',
  closed: 'منتهٍ', terminated: 'منهى', cancelled: 'ملغى',
} as const;
export type ContractStatus = keyof typeof CONTRACT_STATUS;

export const GUARANTEE_KINDS = { initial: 'ضمان ابتدائي', final: 'ضمان نهائي', advance: 'ضمان دفعة مقدمة', warranty: 'ضمان صيانة', other: 'أخرى' } as const;
export type GuaranteeKind = keyof typeof GUARANTEE_KINDS;
export const AMENDMENT_KINDS = { extension: 'تمديد المدة', value: 'تعديل القيمة', prices: 'تعديل الأسعار', terms: 'تعديل الشروط' } as const;
export type AmendmentKind = keyof typeof AMENDMENT_KINDS;
export const PENALTY_BASIS = { percent: 'نسبة من قيمة التعميد', fixed: 'مبلغ مقطوع', per_day: 'مبلغ عن كل يوم تأخير' } as const;
export type PenaltyBasis = keyof typeof PENALTY_BASIS;

/** سعر تعاقدي لصنف أو خدمة */
export interface ContractPrice { key: string; itemId: string | null; description: string; unit: string | null; unitPrice: number; maxQty: number | null }
export interface ContractGuarantee { key: string; kind: GuaranteeKind; amount: number; ref: string | null; issuer: string | null; expiresOn: string | null; released: boolean }
/** مستوى خدمة أو مؤشر أداء تعاقدي: الهدف حد أدنى (min) أو حد أعلى (max) */
export interface ContractSla { key: string; name: string; target: number; unit: string; direction: 'min' | 'max' }
export interface ContractKpiReading { slaKey: string; period: string; value: number; met: boolean; note: string | null; byName: string; at: string }
/** قاعدة جزاء في العقد، وسقفها نسبة من قيمة العقد */
export interface ContractPenaltyRule { key: string; name: string; basis: PenaltyBasis; rate: number; capPct: number | null }
export type PenaltyStatus = 'pending' | 'approved' | 'rejected';
export interface ContractPenalty {
  id: string; ruleKey: string | null; ruleName: string | null; date: string; amount: number; reason: string; orderId: string | null;
  status: PenaltyStatus; byId: string; byName: string; at: string; decidedByName: string | null; decidedAt: string | null; decisionNote: string | null;
}
/** ملحق العقد: يُطلب ثم يُعتمد من غير طالبه، ويُحفظ ما قبله وما بعده */
export interface ContractAmendment {
  no: number; kind: AmendmentKind; reason: string; status: 'pending' | 'approved' | 'rejected';
  before: { endsOn: string; value: number; terms: string | null; prices: ContractPrice[] };
  after: { endsOn: string; value: number; terms: string | null; prices: ContractPrice[] };
  byId: string; byName: string; at: string; decidedByName: string | null; decidedAt: string | null; decisionNote: string | null;
}

@Entity('pr_contracts')
@Index('IDX_pr_contracts_org', ['organizationId', 'status'])
@Index('IDX_pr_contracts_supplier', ['organizationId', 'supplierId'])
@Index('UQ_pr_contracts_no', ['organizationId', 'contractNo'], { unique: true })
export class PrContract {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ name: 'organization_id', type: 'uuid' }) organizationId!: string;
  @Column({ name: 'contract_no', type: 'int' }) contractNo!: number;
  @Column({ type: 'varchar', length: 12, default: 'supply' }) kind!: ContractKind;
  @Column({ name: 'supplier_id', type: 'uuid' }) supplierId!: string;
  /** رقم العقد لدى المورد أو المرجع الورقي */
  @Column({ name: 'reference', type: 'varchar', length: 60, nullable: true }) reference!: string | null;
  @Column({ length: 250 }) title!: string;
  @Column({ type: 'text', nullable: true }) scope!: string | null;
  @Column({ type: 'text', nullable: true }) terms!: string | null;
  @Column({ name: 'starts_on', type: 'date' }) startsOn!: string;
  @Column({ name: 'ends_on', type: 'date' }) endsOn!: string;
  /** سقف العقد شاملًا الضريبة: لا تتجاوزه التعميدات المرتبطة */
  @Column(money('value')) value!: number;
  /** التنبيه عند بلوغ هذه النسبة من السقف، وقبل الانتهاء بهذه الأيام */
  @Column({ name: 'alert_pct', type: 'int', default: 80 }) alertPct!: number;
  @Column({ name: 'alert_days', type: 'int', default: 30 }) alertDays!: number;
  @Column({ name: 'project_id', type: 'uuid', nullable: true }) projectId!: string | null;
  @Column({ name: 'budget_line_id', type: 'uuid', nullable: true }) budgetLineId!: string | null;
  @Column({ name: 'funding_batch_id', type: 'uuid', nullable: true }) fundingBatchId!: string | null;
  /** عقد الشراكة المرتبط في نظام الشراكات (العقود المشتركة بين الطرفين) */
  @Column({ name: 'pt_contract_id', type: 'uuid', nullable: true }) ptContractId!: string | null;
  /** المخاطر المرتبطة من سجل المخاطر */
  @Column({ name: 'risk_ids', type: 'jsonb', default: () => `'[]'` }) riskIds!: string[];
  @Column({ type: 'jsonb', default: () => `'[]'` }) prices!: ContractPrice[];
  @Column({ type: 'jsonb', default: () => `'[]'` }) guarantees!: ContractGuarantee[];
  @Column({ type: 'jsonb', default: () => `'[]'` }) slas!: ContractSla[];
  @Column({ name: 'kpi_readings', type: 'jsonb', default: () => `'[]'` }) kpiReadings!: ContractKpiReading[];
  @Column({ name: 'penalty_rules', type: 'jsonb', default: () => `'[]'` }) penaltyRules!: ContractPenaltyRule[];
  @Column({ type: 'jsonb', default: () => `'[]'` }) penalties!: ContractPenalty[];
  @Column({ type: 'jsonb', default: () => `'[]'` }) amendments!: ContractAmendment[];
  @Column({ name: 'required_docs', type: 'jsonb', default: () => `'[]'` }) requiredDocs!: string[];
  @Column({ type: 'jsonb', default: () => `'[]'` }) attachments!: ItemFile[];
  /** يطلع عليه المورد في البوابة بعد اعتماده */
  @Column({ name: 'share_with_supplier', default: true }) shareWithSupplier!: boolean;
  @Column({ type: 'varchar', length: 12, default: 'draft' }) status!: ContractStatus;
  @Column({ type: 'int', default: 1 }) version!: number;
  @Column({ name: 'return_reason', type: 'varchar', length: 1000, nullable: true }) returnReason!: string | null;
  @Column({ name: 'end_reason', type: 'varchar', length: 1000, nullable: true }) endReason!: string | null;
  @Column({ name: 'approved_by_id', type: 'uuid', nullable: true }) approvedById!: string | null;
  @Column({ name: 'approved_by_name', type: 'varchar', length: 200, nullable: true }) approvedByName!: string | null;
  @Column({ name: 'approved_at', type: 'timestamptz', nullable: true }) approvedAt!: Date | null;
  @Column({ name: 'created_by_id', type: 'uuid', nullable: true }) createdById!: string | null;
  @Column({ name: 'created_by_name', length: 200 }) createdByName!: string;
  /** كل من عدّل العقد أو أرسله للاعتماد: لا يعتمده أحد منهم (فصل المهام) */
  @Column({ name: 'editor_ids', type: 'jsonb', default: () => `'[]'` }) editorIds!: string[];
  @Column({ type: 'jsonb', default: () => `'[]'` }) log!: LogEntry[];
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt!: Date;
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' }) updatedAt!: Date;
}

// ---------------- تقييم الموردين ----------------

export const EVAL_KINDS = { periodic: 'تقييم دوري', order: 'بعد تنفيذ تعميد', contract: 'بعد انتهاء عقد' } as const;
export type SupplierEvalKind = keyof typeof EVAL_KINDS;
export const SUPPLIER_EVAL_STATUS = { draft: 'مسودة', submitted: 'بانتظار الاعتماد', returned: 'معاد للمقيّم', approved: 'معتمد' } as const;
export type SupplierEvalStatus = keyof typeof SUPPLIER_EVAL_STATUS;
export const GRADES = { A: 'ممتاز', B: 'جيد', C: 'مقبول', D: 'ضعيف (تحت الرقابة)' } as const;
export type Grade = keyof typeof GRADES;

/** المؤشرات المحسوبة آليًا من التعميدات والاستلامات والفواتير والعقود في فترة التقييم */
export interface EvalMetrics {
  orders: number; deliveries: number; onTime: number; late: number; onTimePct: number | null; avgDelayDays: number | null;
  ordered: number; received: number; fillPct: number | null; rejected: number; rejectPct: number | null;
  invoices: number; invoiceExceptions: number; invoiceOkPct: number | null; avgResponseHours: number | null;
  penalties: number; penaltyAmount: number; kpiMet: number; kpiTotal: number; kpiPct: number | null; spend: number;
}
export interface EvalScore { key: string; name: string; weight: number; metric: string | null; auto: number | null; score: number; note: string | null }

@Entity('pr_supplier_evaluations')
@Index('IDX_pr_sup_evals_supplier', ['organizationId', 'supplierId'])
@Index('UQ_pr_sup_evals_no', ['organizationId', 'evalNo'], { unique: true })
export class PrSupplierEvaluation {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ name: 'organization_id', type: 'uuid' }) organizationId!: string;
  @Column({ name: 'eval_no', type: 'int' }) evalNo!: number;
  @Column({ name: 'supplier_id', type: 'uuid' }) supplierId!: string;
  @Column({ type: 'varchar', length: 10, default: 'periodic' }) kind!: SupplierEvalKind;
  @Column({ name: 'order_id', type: 'uuid', nullable: true }) orderId!: string | null;
  @Column({ name: 'contract_id', type: 'uuid', nullable: true }) contractId!: string | null;
  @Column({ name: 'period_from', type: 'date' }) periodFrom!: string;
  @Column({ name: 'period_to', type: 'date' }) periodTo!: string;
  @Column({ type: 'jsonb' }) metrics!: EvalMetrics;
  @Column({ type: 'jsonb', default: () => `'[]'` }) scores!: EvalScore[];
  @Column({ type: 'numeric', precision: 5, scale: 2, transformer: num, default: 0 }) total!: number;
  @Column({ type: 'varchar', length: 1, default: 'C' }) grade!: Grade;
  @Column({ type: 'text', nullable: true }) strengths!: string | null;
  @Column({ type: 'text', nullable: true }) weaknesses!: string | null;
  @Column({ type: 'text', nullable: true }) recommendation!: string | null;
  @Column({ type: 'varchar', length: 10, default: 'draft' }) status!: SupplierEvalStatus;
  /** تُشارك النتيجة والملاحظات مع المورد في البوابة بعد الاعتماد */
  @Column({ name: 'share_with_supplier', default: true }) shareWithSupplier!: boolean;
  @Column({ name: 'supplier_response', type: 'text', nullable: true }) supplierResponse!: string | null;
  @Column({ name: 'improvement_plan', type: 'text', nullable: true }) improvementPlan!: string | null;
  @Column({ name: 'response_at', type: 'timestamptz', nullable: true }) responseAt!: Date | null;
  @Column({ name: 'return_reason', type: 'varchar', length: 1000, nullable: true }) returnReason!: string | null;
  @Column({ name: 'evaluator_id', type: 'uuid', nullable: true }) evaluatorId!: string | null;
  @Column({ name: 'evaluator_name', length: 200 }) evaluatorName!: string;
  /** كل من عدّل الدرجات أو أرسل التقييم: لا يعتمده أحد منهم (فصل المهام) */
  @Column({ name: 'editor_ids', type: 'jsonb', default: () => `'[]'` }) editorIds!: string[];
  @Column({ name: 'approved_by_id', type: 'uuid', nullable: true }) approvedById!: string | null;
  @Column({ name: 'approved_by_name', type: 'varchar', length: 200, nullable: true }) approvedByName!: string | null;
  @Column({ name: 'approved_at', type: 'timestamptz', nullable: true }) approvedAt!: Date | null;
  @Column({ type: 'jsonb', default: () => `'[]'` }) log!: LogEntry[];
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt!: Date;
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' }) updatedAt!: Date;
}

/** معايير تقييم الموردين الافتراضية، وكل معيار يُقترح له درجة من مؤشر محسوب */
export const DEFAULT_SUPPLIER_CRITERIA: { key: string; name: string; weight: number; metric: string | null }[] = [
  { key: 'time', name: 'الالتزام بمواعيد التوريد', weight: 25, metric: 'onTimePct' },
  { key: 'qty', name: 'الالتزام بالكميات', weight: 15, metric: 'fillPct' },
  { key: 'quality', name: 'الجودة ومطابقة المواصفات', weight: 25, metric: 'qualityPct' },
  { key: 'billing', name: 'دقة الفواتير والمطابقة', weight: 10, metric: 'invoiceOkPct' },
  { key: 'contract', name: 'الالتزام بالعقد ومستويات الخدمة', weight: 15, metric: 'kpiPct' },
  { key: 'response', name: 'سرعة الاستجابة ومعالجة الملاحظات', weight: 10, metric: null },
];
export const DEFAULT_GRADE_LIMITS = { A: 90, B: 75, C: 60 };

export const CONTRACT_ENTITIES = [PrContract, PrSupplierEvaluation];
