import { Column, CreateDateColumn, Entity, Index, PrimaryColumn, PrimaryGeneratedColumn, UpdateDateColumn, ValueTransformer } from 'typeorm';
import type { HrPolicy } from '../hr-policy';

/** PostgreSQL يرجّع numeric كنص؛ نحوله لرقم */
const num: ValueTransformer = {
  to: (v?: number | null) => v,
  from: (v?: string | null) => (v === null || v === undefined ? null : Number(v)),
};
const money = (name: string, nullable = false) => ({
  name, type: 'numeric' as const, precision: 14, scale: 2, transformer: num, nullable, ...(nullable ? {} : { default: 0 }),
});

export type ApprovalStatus = 'draft' | 'approved';
export type PlanStatus = 'draft' | 'submitted' | 'approved' | 'rejected';
export type EmployeeStatus = 'active' | 'terminated';
export type LeaveStatus = 'pending' | 'approved' | 'rejected' | 'cancelled';
export type CardStatus = 'draft' | 'agreed' | 'evaluated' | 'approved';
export const COMPETENCY_KINDS = ['core', 'leadership', 'technical'] as const;
export type CompetencyKind = (typeof COMPETENCY_KINDS)[number];
export const CONTRACT_TYPES = ['fixed', 'indefinite', 'part_time', 'temporary'] as const;
export type ContractType = (typeof CONTRACT_TYPES)[number];
export const QIWA_STATUSES = ['documented', 'pending', 'not_documented'] as const;
export type QiwaStatus = (typeof QIWA_STATUSES)[number];

/** بدل افتراضي على المرتبة: نسبة من الأساسي أو مبلغ ثابت */
export interface GradeAllowance { code: string; name: string; kind: 'percent' | 'fixed'; value: number }
/** بند من راتب الموظف */
export interface SalaryItem { code: string; name: string; amount: number }
export interface JobKpi { title: string; weight: number; target: string; unit?: string | null }
export interface JobCompetency { competencyId: string; level: number }
export interface CompetencyLevel { level: number; description: string }
export interface CardObjective { title: string; weight: number; target: string; achievement: number | null; note?: string | null }
export interface CardCompetency { competencyId: string; name: string; requiredLevel: number; rating: number | null }

/** مرحلة اعتماد في مسير الرواتب (الدور فارغ = أي مستخدم معه صلاحية اعتماد المسير) */
export interface PayrollStage { name: string; roleId: string | null }
export interface PayrollConfig {
  /** الرواتب المستحقة (الحساب الافتراضي لأي بند ليس له حساب استحقاق خاص) */
  payableAccountId: string | null;
  /** التأمينات الاجتماعية المستحقة (حصة الموظف والجمعية) */
  gosiPayableAccountId: string | null;
  /** قديم: انتقل مصروف التأمينات إلى فئات تحميل المصروف (المفتاح gosi) */
  gosiExpenseAccountId?: string | null;
  /** الاستقطاعات الأخرى (السلف والجزاءات) */
  deductionsAccountId: string | null;
  /** البنك الافتراضي لصرف أي بند ليس له بنك خاص */
  defaultCashAccountId: string | null;
  stages: PayrollStage[];
}
export interface DevelopmentConfig {
  stages: PayrollStage[];
  /** أنواع الأنشطة التطويرية المتاحة (تدريب، دورة، إرشاد ...) */
  activityTypes: { code: string; name: string }[];
}
export interface AttendanceConfig {
  enabled: boolean;
  workStart: string;
  workEnd: string;
  /** أيام الراحة الأسبوعية (0 = الأحد ... 5 = الجمعة، 6 = السبت) */
  weekend: number[];
  holidays: { date: string; name: string }[];
}

/** إعدادات الموارد البشرية لكل جمعية: مستويات الهيكل والترقيم */
@Entity('hr_settings')
export class HrSettings {
  @PrimaryColumn({ name: 'organization_id', type: 'uuid' })
  organizationId!: string;

  /** أسماء مستويات الهيكل التنظيمي بالترتيب من الأعلى للأدنى، مثل: قطاع، إدارة، قسم، وحدة */
  @Column({ name: 'structure_levels', type: 'jsonb', default: () => `'["الإدارة العليا", "إدارة", "قسم", "وحدة"]'` })
  structureLevels!: string[];

  @Column({ name: 'next_employee_no', type: 'int', default: 1 })
  nextEmployeeNo!: number;

  @Column({ name: 'next_job_no', type: 'int', default: 1 })
  nextJobNo!: number;

  /** الربط المحاسبي للرواتب ومراحل اعتماد المسير */
  @Column({ name: 'payroll_config', type: 'jsonb', default: () => `'{}'` })
  payrollConfig!: Partial<PayrollConfig>;

  /** إعدادات الحضور والانصراف: الدوام والعطل وتفعيل الخصم */
  @Column({ name: 'attendance_config', type: 'jsonb', default: () => `'{}'` })
  attendanceConfig!: Partial<AttendanceConfig>;

  /** إعدادات خطط التطوير والتدريب: مراحل الاعتماد وأنواع الأنشطة التطويرية */
  @Column({ name: 'development_config', type: 'jsonb', default: () => `'{}'` })
  developmentConfig!: Partial<DevelopmentConfig>;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}

/** إصدارات لائحة الموارد البشرية: كل حفظ إصدار جديد، والساري هو الأحدث */
@Entity('hr_policy_versions')
@Index('UQ_hr_policy_versions', ['organizationId', 'version'], { unique: true })
export class HrPolicyVersion {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId!: string;

  @Column({ type: 'int' })
  version!: number;

  @Column({ type: 'jsonb' })
  policy!: HrPolicy;

  @Column({ type: 'varchar', length: 1000, nullable: true })
  note!: string | null;

  /** تاريخ اعتماد اللائحة من مجلس الإدارة أو الجهة المختصة */
  @Column({ name: 'effective_date', type: 'date' })
  effectiveDate!: string;

  @Column({ name: 'approved_by_name', type: 'varchar', length: 200 })
  approvedByName!: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}

/** وحدة في الهيكل التنظيمي (أي مستوى) */
@Entity('hr_units')
@Index('IDX_hr_units_org', ['organizationId', 'parentId'])
export class HrUnit {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId!: string;

  @Column({ name: 'parent_id', type: 'uuid', nullable: true })
  parentId!: string | null;

  /** رقم المستوى في structureLevels (0 = الأعلى) */
  @Column({ type: 'int' })
  level!: number;

  @Column({ type: 'varchar', length: 30, nullable: true })
  code!: string | null;

  @Column({ type: 'varchar', length: 200 })
  name!: string;

  @Column({ name: 'manager_employee_id', type: 'uuid', nullable: true })
  managerEmployeeId!: string | null;

  /** مركز التكلفة (اسم الحساب التحليلي) لتوجيه قيود الرواتب لاحقًا */
  @Column({ name: 'cost_center', type: 'varchar', length: 200, nullable: true })
  costCenter!: string | null;

  /** الحساب التحليلي في النظام المالي الذي تُحمَّل عليه رواتب موظفي الوحدة (فارغ = حساب الوحدة الأعلى) */
  @Column({ name: 'analytic_account_id', type: 'uuid', nullable: true })
  analyticAccountId!: string | null;

  @Column({ type: 'varchar', length: 1000, nullable: true })
  description!: string | null;

  @Column({ name: 'sort_order', type: 'int', default: 0 })
  sortOrder!: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}

/** مرتبة في سلم الرواتب */
@Entity('hr_grades')
@Index('UQ_hr_grades_org_code', ['organizationId', 'code'], { unique: true })
export class HrGrade {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId!: string;

  @Column({ type: 'varchar', length: 20 })
  code!: string;

  @Column({ type: 'varchar', length: 120 })
  name!: string;

  /** مستوى الهيكل الذي تناسبه المرتبة عادة (اختياري، للعرض والاقتراح) */
  @Column({ name: 'structure_level', type: 'int', nullable: true })
  structureLevel!: number | null;

  @Column(money('min_salary'))
  minSalary!: number;

  @Column(money('max_salary'))
  maxSalary!: number;

  /** عدد الدرجات داخل المرتبة */
  @Column({ type: 'int', default: 1 })
  steps!: number;

  /** نسبة العلاوة السنوية بين الدرجات */
  @Column({ name: 'step_increment', type: 'numeric', precision: 6, scale: 2, transformer: num, default: 0 })
  stepIncrement!: number;

  @Column({ type: 'jsonb', default: () => `'[]'` })
  allowances!: GradeAllowance[];

  @Column({ name: 'sort_order', type: 'int', default: 0 })
  sortOrder!: number;
}

/** جدارة في مكتبة الجدارات */
@Entity('hr_competencies')
export class HrCompetency {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId!: string;

  @Column({ type: 'varchar', length: 150 })
  name!: string;

  @Column({ type: 'varchar', length: 12 })
  kind!: CompetencyKind;

  @Column({ type: 'varchar', length: 1000, nullable: true })
  description!: string | null;

  /** المستويات السلوكية من 1 إلى 5 */
  @Column({ type: 'jsonb', default: () => `'[]'` })
  levels!: CompetencyLevel[];

  @Column({ name: 'is_active', default: true })
  isActive!: boolean;
}

/** الوظيفة ووصفها الوظيفي */
@Entity('hr_jobs')
@Index('UQ_hr_jobs_org_code', ['organizationId', 'code'], { unique: true })
export class HrJob {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId!: string;

  @Column({ type: 'varchar', length: 30 })
  code!: string;

  @Column({ type: 'varchar', length: 200 })
  title!: string;

  @Column({ name: 'unit_id', type: 'uuid' })
  unitId!: string;

  @Column({ name: 'grade_id', type: 'uuid', nullable: true })
  gradeId!: string | null;

  @Column({ name: 'reports_to_job_id', type: 'uuid', nullable: true })
  reportsToJobId!: string | null;

  /** فئة تحميل المصروف (إداري، برامج وأنشطة ...): تحدد حسابات مصروف رواتب شاغليها. فارغ = الفئة الافتراضية */
  @Column({ name: 'expense_profile_id', type: 'uuid', nullable: true })
  expenseProfileId!: string | null;

  /** الوظيفة البديلة (الصف الثاني): الوظيفة التي يُعد شاغلها لتولي هذه الوظيفة */
  @Column({ name: 'backup_job_id', type: 'uuid', nullable: true })
  backupJobId!: string | null;

  /** عدد الشواغر المعتمدة لهذه الوظيفة */
  @Column({ type: 'int', default: 1 })
  headcount!: number;

  @Column({ type: 'varchar', length: 2000, nullable: true })
  purpose!: string | null;

  @Column({ type: 'jsonb', default: () => `'[]'` })
  responsibilities!: string[];

  @Column({ type: 'varchar', length: 2000, nullable: true })
  qualifications!: string | null;

  @Column({ name: 'experience_years', type: 'int', default: 0 })
  experienceYears!: number;

  @Column({ type: 'jsonb', default: () => `'[]'` })
  competencies!: JobCompetency[];

  /** مؤشرات الأداء الافتراضية التي تبدأ بها بطاقة الأداء */
  @Column({ type: 'jsonb', default: () => `'[]'` })
  kpis!: JobKpi[];

  /** كود الجودة للوصف الوظيفي (ISO 9001)، مثل QF-HR-JD-001 */
  @Column({ name: 'quality_code', type: 'varchar', length: 40, nullable: true })
  qualityCode!: string | null;

  /** رقم الإصدار: يزيد مع كل إعادة اعتماد */
  @Column({ type: 'int', default: 0 })
  revision!: number;

  @Column({ type: 'varchar', length: 10, default: 'draft' })
  status!: ApprovalStatus;

  @Column({ name: 'approved_at', type: 'timestamptz', nullable: true })
  approvedAt!: Date | null;

  @Column({ name: 'approved_by_name', type: 'varchar', length: 200, nullable: true })
  approvedByName!: string | null;

  @Column({ name: 'is_active', default: true })
  isActive!: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}

/** بند في خطة التعيين السنوية */
@Entity('hr_staffing_plans')
@Index('IDX_hr_staffing_plans_org', ['organizationId', 'year'])
export class HrStaffingPlan {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId!: string;

  @Column({ type: 'int' })
  year!: number;

  @Column({ name: 'job_id', type: 'uuid' })
  jobId!: string;

  @Column({ type: 'int' })
  count!: number;

  /** شهر التعيين المتوقع (1-12) */
  @Column({ name: 'planned_month', type: 'int' })
  plannedMonth!: number;

  /** مصدر التمويل: موارد ذاتية، مشروع، منحة، تبرع مقيد */
  @Column({ name: 'funding_source', type: 'varchar', length: 20, default: 'own' })
  fundingSource!: string;

  @Column({ name: 'funding_note', type: 'varchar', length: 300, nullable: true })
  fundingNote!: string | null;

  /** تعيين سعودي (يؤثر على التأمينات والتوطين) */
  @Column({ name: 'for_saudi', default: true })
  forSaudi!: boolean;

  @Column({ type: 'varchar', length: 1000, nullable: true })
  justification!: string | null;

  @Column({ type: 'varchar', length: 12, default: 'draft' })
  status!: PlanStatus;

  @Column({ name: 'decision_note', type: 'varchar', length: 1000, nullable: true })
  decisionNote!: string | null;

  @Column({ name: 'decided_by_name', type: 'varchar', length: 200, nullable: true })
  decidedByName!: string | null;

  @Column({ name: 'decided_at', type: 'timestamptz', nullable: true })
  decidedAt!: Date | null;

  @Column({ name: 'created_by_name', type: 'varchar', length: 200 })
  createdByName!: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}

/** الموظف وعقده وراتبه */
@Entity('hr_employees')
@Index('UQ_hr_employees_org_no', ['organizationId', 'employeeNo'], { unique: true })
@Index('UQ_hr_employees_org_nid', ['organizationId', 'nationalId'], { unique: true })
export class HrEmployee {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId!: string;

  @Column({ name: 'employee_no', type: 'int' })
  employeeNo!: number;

  @Column({ name: 'full_name', type: 'varchar', length: 200 })
  fullName!: string;

  /** رقم الهوية الوطنية أو الإقامة */
  @Column({ name: 'national_id', type: 'varchar', length: 20 })
  nationalId!: string;

  @Column({ type: 'varchar', length: 100 })
  nationality!: string;

  @Column({ name: 'is_saudi', default: true })
  isSaudi!: boolean;

  @Column({ type: 'varchar', length: 6 })
  gender!: 'male' | 'female';

  @Column({ name: 'birth_date', type: 'date', nullable: true })
  birthDate!: string | null;

  @Column({ type: 'varchar', length: 20, nullable: true })
  phone!: string | null;

  @Column({ type: 'varchar', length: 200, nullable: true })
  email!: string | null;

  @Column({ name: 'unit_id', type: 'uuid' })
  unitId!: string;

  @Column({ name: 'job_id', type: 'uuid' })
  jobId!: string;

  @Column({ name: 'grade_id', type: 'uuid', nullable: true })
  gradeId!: string | null;

  @Column({ type: 'int', default: 1 })
  step!: number;

  @Column({ name: 'manager_id', type: 'uuid', nullable: true })
  managerId!: string | null;

  @Column({ name: 'hire_date', type: 'date' })
  hireDate!: string;

  // ---- العقد ----
  @Column({ name: 'contract_type', type: 'varchar', length: 12, default: 'fixed' })
  contractType!: ContractType;

  @Column({ name: 'contract_start', type: 'date' })
  contractStart!: string;

  @Column({ name: 'contract_end', type: 'date', nullable: true })
  contractEnd!: string | null;

  @Column({ name: 'probation_end', type: 'date', nullable: true })
  probationEnd!: string | null;

  @Column({ name: 'qiwa_status', type: 'varchar', length: 16, default: 'pending' })
  qiwaStatus!: QiwaStatus;

  // ---- الراتب ----
  @Column(money('basic_salary'))
  basicSalary!: number;

  /** البدلات: السكن والنقل وغيرها */
  @Column({ type: 'jsonb', default: () => `'[]'` })
  allowances!: SalaryItem[];

  /** سبب الراتب خارج حدود المرتبة (إن وُجد) */
  @Column({ name: 'salary_exception', type: 'varchar', length: 500, nullable: true })
  salaryException!: string | null;

  @Column({ type: 'varchar', length: 34, nullable: true })
  iban!: string | null;

  // ---- الحضور ----
  /** رقم الموظف في جهاز البصمة (فارغ = رقمه الوظيفي) */
  @Column({ name: 'attendance_code', type: 'varchar', length: 30, nullable: true })
  attendanceCode!: string | null;

  /** معفى من البصمة (لا يُخصم عليه غياب أو تأخير) */
  @Column({ name: 'attendance_exempt', default: false })
  attendanceExempt!: boolean;

  // ---- التأمينات ----
  @Column({ name: 'gosi_number', type: 'varchar', length: 20, nullable: true })
  gosiNumber!: string | null;

  /** تاريخ أول تسجيل في التأمينات (يحدد نسبة المعاشات حسب النظام الجديد) */
  @Column({ name: 'gosi_first_registration', type: 'date', nullable: true })
  gosiFirstRegistration!: string | null;

  // ---- المستندات ----
  @Column({ name: 'id_expiry', type: 'date', nullable: true })
  idExpiry!: string | null;

  @Column({ name: 'passport_expiry', type: 'date', nullable: true })
  passportExpiry!: string | null;

  // ---- الإجازات ----
  /** الأرصدة الافتتاحية عند بدء استخدام النظام: { annual: 12 } */
  @Column({ name: 'leave_opening', type: 'jsonb', default: () => `'{}'` })
  leaveOpening!: Record<string, number>;

  @Column({ name: 'leave_opening_date', type: 'date', nullable: true })
  leaveOpeningDate!: string | null;

  // ---- الحالة ----
  @Column({ type: 'varchar', length: 12, default: 'active' })
  status!: EmployeeStatus;

  @Column({ name: 'termination_date', type: 'date', nullable: true })
  terminationDate!: string | null;

  @Column({ name: 'termination_reason', type: 'varchar', length: 30, nullable: true })
  terminationReason!: string | null;

  @Column({ name: 'termination_note', type: 'varchar', length: 1000, nullable: true })
  terminationNote!: string | null;

  /** مكافأة نهاية الخدمة المحسوبة عند الإنهاء */
  @Column(money('eos_amount', true))
  eosAmount!: number | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}

/** طلب إجازة */
@Entity('hr_leave_requests')
@Index('IDX_hr_leave_requests_emp', ['organizationId', 'employeeId', 'startDate'])
export class HrLeaveRequest {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId!: string;

  @Column({ name: 'employee_id', type: 'uuid' })
  employeeId!: string;

  @Column({ name: 'leave_type', type: 'varchar', length: 30 })
  leaveType!: string;

  @Column({ name: 'start_date', type: 'date' })
  startDate!: string;

  @Column({ name: 'end_date', type: 'date' })
  endDate!: string;

  @Column({ type: 'int' })
  days!: number;

  @Column({ type: 'varchar', length: 1000, nullable: true })
  note!: string | null;

  @Column({ type: 'varchar', length: 12, default: 'pending' })
  status!: LeaveStatus;

  @Column({ name: 'decision_note', type: 'varchar', length: 1000, nullable: true })
  decisionNote!: string | null;

  @Column({ name: 'decided_by_name', type: 'varchar', length: 200, nullable: true })
  decidedByName!: string | null;

  @Column({ name: 'decided_at', type: 'timestamptz', nullable: true })
  decidedAt!: Date | null;

  @Column({ name: 'created_by_name', type: 'varchar', length: 200 })
  createdByName!: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}

/** بطاقة الأداء المستهدف وتقييمها لسنة واحدة */
@Entity('hr_performance_cards')
@Index('UQ_hr_performance_cards', ['organizationId', 'employeeId', 'year'], { unique: true })
export class HrPerformanceCard {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId!: string;

  @Column({ name: 'employee_id', type: 'uuid' })
  employeeId!: string;

  @Column({ type: 'int' })
  year!: number;

  @Column({ type: 'varchar', length: 12, default: 'draft' })
  status!: CardStatus;

  @Column({ type: 'jsonb', default: () => `'[]'` })
  objectives!: CardObjective[];

  @Column({ type: 'jsonb', default: () => `'[]'` })
  competencies!: CardCompetency[];

  /** وزن الأهداف من النتيجة (والباقي للجدارات)، يؤخذ من اللائحة عند الإنشاء */
  @Column({ name: 'objectives_weight', type: 'int', default: 70 })
  objectivesWeight!: number;

  @Column({ name: 'objectives_score', type: 'numeric', precision: 6, scale: 2, transformer: num, nullable: true })
  objectivesScore!: number | null;

  @Column({ name: 'competencies_score', type: 'numeric', precision: 6, scale: 2, transformer: num, nullable: true })
  competenciesScore!: number | null;

  @Column({ name: 'final_score', type: 'numeric', precision: 6, scale: 2, transformer: num, nullable: true })
  finalScore!: number | null;

  @Column({ type: 'varchar', length: 40, nullable: true })
  rating!: string | null;

  @Column({ name: 'manager_note', type: 'varchar', length: 2000, nullable: true })
  managerNote!: string | null;

  @Column({ name: 'employee_note', type: 'varchar', length: 2000, nullable: true })
  employeeNote!: string | null;

  @Column({ name: 'agreed_at', type: 'timestamptz', nullable: true })
  agreedAt!: Date | null;

  @Column({ name: 'evaluated_by_name', type: 'varchar', length: 200, nullable: true })
  evaluatedByName!: string | null;

  @Column({ name: 'evaluated_at', type: 'timestamptz', nullable: true })
  evaluatedAt!: Date | null;

  @Column({ name: 'approved_by_name', type: 'varchar', length: 200, nullable: true })
  approvedByName!: string | null;

  @Column({ name: 'approved_at', type: 'timestamptz', nullable: true })
  approvedAt!: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}

/** بند من بنود الراتب (الأساسي والبدلات): يُعرَّف مرة واحدة، وله حساب استحقاق وبنك صرف. حساب المصروف في فئة تحميل المصروف للوظيفة */
@Entity('hr_allowance_types')
@Index('UQ_hr_allowance_types_code', ['organizationId', 'code'], { unique: true })
export class HrAllowanceType {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId!: string;

  @Column({ length: 30 })
  code!: string;

  @Column({ length: 120 })
  name!: string;

  /** القيمة الافتراضية عند إضافته لمرتبة: نسبة من الأساسي أو مبلغ ثابت */
  @Column({ name: 'default_kind', type: 'varchar', length: 10, default: 'fixed' })
  defaultKind!: 'percent' | 'fixed';

  @Column({ name: 'default_value', type: 'numeric', precision: 12, scale: 2, transformer: num, default: 0 })
  defaultValue!: number;

  /** حساب الاستحقاق (فارغ = حساب الرواتب المستحقة العام) */
  @Column({ name: 'payable_account_id', type: 'uuid', nullable: true })
  payableAccountId!: string | null;

  /** البنك الذي يُصرف منه هذا البند (فارغ = البنك الافتراضي للرواتب) */
  @Column({ name: 'cash_account_id', type: 'uuid', nullable: true })
  cashAccountId!: string | null;

  /** الأساسي بند نظامي لا يُحذف ولا يُضاف للمراتب كبدل */
  @Column({ name: 'is_system', default: false })
  isSystem!: boolean;

  @Column({ name: 'is_active', default: true })
  isActive!: boolean;

  @Column({ name: 'sort_order', type: 'int', default: 0 })
  sortOrder!: number;
}

/**
 * فئة تحميل المصروف: مجموعة حسابات مصروف لبنود الراتب (والمفتاح gosi لحصة الجمعية في التأمينات).
 * تُختار في الوصف الوظيفي، فموظفو الإدارة يُحمَّلون على المصاريف الإدارية وموظفو الأنشطة على مصاريف البرامج.
 */
@Entity('hr_expense_profiles')
@Index('UQ_hr_expense_profiles_name', ['organizationId', 'name'], { unique: true })
export class HrExpenseProfile {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId!: string;

  @Column({ length: 100 })
  name!: string;

  @Column({ type: 'varchar', length: 300, nullable: true })
  description!: string | null;

  /** رمز البند ← حساب المصروف */
  @Column({ type: 'jsonb', default: () => `'{}'` })
  accounts!: Record<string, string>;

  /** الفئة الافتراضية للوظائف التي لم تُحدد لها فئة */
  @Column({ name: 'is_default', default: false })
  isDefault!: boolean;

  @Column({ name: 'sort_order', type: 'int', default: 0 })
  sortOrder!: number;
}

/** جهاز بصمة مسجل: يرسل البصمات مباشرة للنظام برقمه التسلسلي */
@Entity('hr_attendance_devices')
@Index('UQ_hr_attendance_devices_serial', ['serialNumber'], { unique: true })
export class HrAttendanceDevice {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId!: string;

  @Column({ length: 120 })
  name!: string;

  @Column({ type: 'varchar', length: 60, nullable: true })
  brand!: string | null;

  @Column({ name: 'serial_number', length: 60 })
  serialNumber!: string;

  @Column({ type: 'varchar', length: 200, nullable: true })
  location!: string | null;

  @Column({ name: 'is_active', default: true })
  isActive!: boolean;

  @Column({ name: 'last_seen_at', type: 'timestamptz', nullable: true })
  lastSeenAt!: Date | null;

  @Column({ name: 'punch_count', type: 'int', default: 0 })
  punchCount!: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}

export type PunchSource = 'device' | 'excel' | 'text' | 'manual';

/** بصمة حضور أو انصراف: من الجهاز مباشرة، أو من ملف مرفوع، أو مدخلة يدويًا */
@Entity('hr_attendance_punches')
@Index('UQ_hr_attendance_punches', ['organizationId', 'attendanceCode', 'punchDate', 'punchTime'], { unique: true })
@Index('IDX_hr_attendance_punches_emp', ['organizationId', 'employeeId', 'punchDate'])
export class HrAttendancePunch {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId!: string;

  /** فارغ إذا لم يُعرف صاحب الرقم وقت الاستلام (يُربط عند تسجيل الرقم للموظف) */
  @Column({ name: 'employee_id', type: 'uuid', nullable: true })
  employeeId!: string | null;

  @Column({ name: 'attendance_code', length: 30 })
  attendanceCode!: string;

  @Column({ name: 'punch_date', type: 'date' })
  punchDate!: string;

  /** الوقت HH:MM:SS بتوقيت الجمعية */
  @Column({ name: 'punch_time', length: 8 })
  punchTime!: string;

  @Column({ type: 'varchar', length: 10 })
  source!: PunchSource;

  @Column({ name: 'device_id', type: 'uuid', nullable: true })
  deviceId!: string | null;

  @Column({ name: 'import_id', type: 'uuid', nullable: true })
  importId!: string | null;

  @Column({ type: 'varchar', length: 300, nullable: true })
  note!: string | null;

  @Column({ name: 'created_by_name', type: 'varchar', length: 200, nullable: true })
  createdByName!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}

/** سجل ملف حضور مرفوع (Excel أو نصي) */
@Entity('hr_attendance_imports')
export class HrAttendanceImport {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId!: string;

  @Column({ name: 'file_name', length: 250 })
  fileName!: string;

  @Column({ type: 'varchar', length: 10 })
  format!: 'excel' | 'text';

  @Column({ type: 'int' })
  rows!: number;

  @Column({ type: 'int' })
  added!: number;

  @Column({ type: 'int' })
  duplicates!: number;

  @Column({ type: 'int', default: 0 })
  invalid!: number;

  @Column({ name: 'unknown_codes', type: 'jsonb', default: () => `'[]'` })
  unknownCodes!: string[];

  @Column({ name: 'date_from', type: 'date', nullable: true })
  dateFrom!: string | null;

  @Column({ name: 'date_to', type: 'date', nullable: true })
  dateTo!: string | null;

  @Column({ name: 'created_by_name', length: 200 })
  createdByName!: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}

export type PayrollRunStatus = 'draft' | 'pending' | 'returned' | 'approved' | 'cancelled';
/** مبلغ بند من بنود الراتب في سطر المسير */
export interface RunItem { code: string; name: string; full: number; earned: number }
/** سطر موظف في كشف الرواتب (لقطة ثابتة وقت الإعداد، تُعاد عند إعادة الاحتساب قبل الاعتماد) */
export interface RunLine {
  employeeId: string; employeeNo: number; fullName: string; isSaudi: boolean; unitId: string; unitName: string; jobTitle: string; iban: string | null;
  /** فئة تحميل المصروف من وظيفة الموظف (فارغ في الكشوف القديمة = الفئة الافتراضية) */
  expenseProfileId?: string | null;
  items: RunItem[]; gross: number; workedDays: number; ratio: number; dailyWage: number;
  unpaidDays: number; unpaidDeduction: number;
  /** الحضور: محسوب من البصمات، ويمكن تعديله يدويًا قبل الرفع */
  attendance: { tracked: boolean; absentDays: number; lateMinutes: number; missingOut: number; overridden: boolean };
  absenceDeduction: number; lateDeduction: number;
  additions: { code: string; amount: number; note: string | null }[];
  otherDeduction: number; otherDeductionNote: string | null;
  earned: number; gosiEmployee: number; gosiEmployer: number; totalDeductions: number; net: number; employerCost: number;
}
export interface RunHistory { action: string; stageName: string | null; note: string | null; actorName: string; at: string }

/** كشف رواتب شهر: يُعد ثم يمر بمراحل الاعتماد، وعند الاعتماد النهائي يصدر قيده المحاسبي ثم سندات الصرف */
@Entity('hr_payroll_runs')
@Index('UQ_hr_payroll_runs_month', ['organizationId', 'month'], { unique: true, where: `status <> 'cancelled'` })
export class HrPayrollRun {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId!: string;

  /** YYYY-MM */
  @Column({ length: 7 })
  month!: string;

  @Column({ type: 'varchar', length: 12, default: 'draft' })
  status!: PayrollRunStatus;

  /** ترتيب المرحلة الحالية في مراحل الاعتماد (أثناء الانتظار) */
  @Column({ name: 'stage_index', type: 'int', nullable: true })
  stageIndex!: number | null;

  @Column({ type: 'jsonb', default: () => `'[]'` })
  lines!: RunLine[];

  @Column({ type: 'jsonb', default: () => `'{}'` })
  totals!: Record<string, number>;

  @Column({ type: 'jsonb', default: () => `'[]'` })
  warnings!: string[];

  @Column({ type: 'jsonb', default: () => `'[]'` })
  history!: RunHistory[];

  /** قيد استحقاق الرواتب في النظام المالي */
  @Column({ name: 'entry_id', type: 'uuid', nullable: true })
  entryId!: string | null;

  /** سندات الصرف المنشأة في النظام المالي */
  @Column({ name: 'voucher_ids', type: 'jsonb', default: () => `'[]'` })
  voucherIds!: string[];

  @Column({ name: 'created_by_name', length: 200 })
  createdByName!: string;

  @Column({ name: 'approved_at', type: 'timestamptz', nullable: true })
  approvedAt!: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}

// ---------------- التطوير والتدريب والصف الثاني ----------------

export type DevPlanStatus = 'draft' | 'pending' | 'returned' | 'approved' | 'completed' | 'cancelled';
export type DevItemStatus = 'planned' | 'in_progress' | 'done' | 'cancelled';
/** بند في خطة التطوير: جدارة فيها فجوة (أو مهارة إضافية) ونشاط لسدها بمستهدف وموعد */
export interface DevItem {
  id: string; competencyId: string | null; name: string;
  /** المستوى المطلوب في الوصف الوظيفي، والمستوى الفعلي من آخر تقييم (أو يُعدل يدويًا)، والمستوى المستهدف */
  requiredLevel: number | null; currentLevel: number | null; targetLevel: number | null;
  activityType: string; activity: string; provider: string | null; dueDate: string | null; cost: number; hours: number;
  status: DevItemStatus; achievedLevel: number | null; note: string | null;
}
export interface DevHistory { action: string; stageName: string | null; note: string | null; actorName: string; at: string }

/** خطة تطوير وتدريب لموظف: فردية لسد فجوة جدارات وظيفته، أو للصف الثاني لإعداده لوظيفة أخرى */
@Entity('hr_dev_plans')
export class HrDevPlan {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId!: string;

  @Column({ type: 'int' })
  serial!: number;

  @Column({ name: 'employee_id', type: 'uuid' })
  employeeId!: string;

  /** وظيفة الموظف وقت إعداد الخطة */
  @Column({ name: 'job_id', type: 'uuid', nullable: true })
  jobId!: string | null;

  @Column({ type: 'varchar', length: 12, default: 'individual' })
  kind!: 'individual' | 'succession';

  /** في خطط الصف الثاني: الوظيفة التي يُعد لها الموظف */
  @Column({ name: 'target_job_id', type: 'uuid', nullable: true })
  targetJobId!: string | null;

  @Column({ type: 'int' })
  year!: number;

  @Column({ length: 200 })
  title!: string;

  /** مستهدفات الخطة العامة */
  @Column({ type: 'jsonb', default: () => `'[]'` })
  goals!: string[];

  @Column({ type: 'jsonb', default: () => `'[]'` })
  items!: DevItem[];

  @Column({ type: 'varchar', length: 12, default: 'draft' })
  status!: DevPlanStatus;

  @Column({ name: 'stage_index', type: 'int', nullable: true })
  stageIndex!: number | null;

  @Column({ type: 'jsonb', default: () => `'[]'` })
  history!: DevHistory[];

  @Column({ name: 'created_by_name', length: 200 })
  createdByName!: string;

  @Column({ name: 'approved_at', type: 'timestamptz', nullable: true })
  approvedAt!: Date | null;

  @Column({ name: 'completed_at', type: 'timestamptz', nullable: true })
  completedAt!: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}

export const READINESS = ['now', '1y', '2y'] as const;
export type Readiness = (typeof READINESS)[number];

/** موظف مرشح في الصف الثاني لوظيفة، مع جاهزيته وخطة إعداده */
@Entity('hr_succession_candidates')
@Index('UQ_hr_succession_candidates', ['organizationId', 'jobId', 'employeeId'], { unique: true })
export class HrSuccessionCandidate {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId!: string;

  @Column({ name: 'job_id', type: 'uuid' })
  jobId!: string;

  @Column({ name: 'employee_id', type: 'uuid' })
  employeeId!: string;

  @Column({ type: 'varchar', length: 4, default: '1y' })
  readiness!: Readiness;

  @Column({ type: 'varchar', length: 500, nullable: true })
  note!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}

export const HR_ENTITIES = [
  HrExpenseProfile, HrDevPlan, HrSuccessionCandidate, HrAllowanceType, HrAttendanceDevice, HrAttendancePunch, HrAttendanceImport, HrPayrollRun,
  HrSettings, HrPolicyVersion, HrUnit, HrGrade, HrCompetency, HrJob, HrStaffingPlan, HrEmployee, HrLeaveRequest, HrPerformanceCard,
];
