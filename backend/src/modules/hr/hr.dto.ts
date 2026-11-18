import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsDateString, IsEmail, IsIn, IsInt, IsNumber, IsObject, IsOptional, IsString, IsUUID,
  Matches, Max, MaxLength, Min, MinLength, ValidateIf, ValidateNested,
} from 'class-validator';
import { COMPETENCY_KINDS, CONTRACT_TYPES, QIWA_STATUSES } from './entities/hr.entity';
import { EOS_REASONS } from './hr-policy';

const trim = () => Transform(({ value }) => (typeof value === 'string' ? value.trim() || null : value));
const Nullable = (): PropertyDecorator => (t, k) => [IsOptional(), ValidateIf((_: unknown, v: unknown) => v !== null && v !== '')].forEach((d) => d(t, k));
const DateField = (msg: string) => IsDateString({ strict: true }, { message: msg });
const Money = (msg: string) => (t: object, k: string | symbol) => {
  Type(() => Number)(t, k);
  IsNumber({ maxDecimalPlaces: 2 }, { message: msg })(t, k);
  Min(0, { message: msg })(t, k);
};

// ---------------- الإعدادات واللائحة ----------------

export class SettingsDto {
  @IsArray() @ArrayMinSize(1, { message: 'أضف مستوى واحدًا على الأقل للهيكل' }) @ArrayMaxSize(8, { message: 'الحد الأعلى 8 مستويات' })
  @IsString({ each: true }) @MaxLength(60, { each: true })
  structureLevels!: string[];
}

export class PolicyDto {
  @IsObject({ message: 'اللائحة غير مكتملة' })
  policy!: Record<string, unknown>;

  @DateField('تاريخ اعتماد اللائحة غير صحيح')
  effectiveDate!: string;

  @Nullable() @trim() @IsString() @MaxLength(1000)
  note?: string | null;
}

// ---------------- الهيكل ----------------

export class UnitDto {
  @trim() @IsString() @MinLength(2, { message: 'اكتب اسم الوحدة' }) @MaxLength(200)
  name!: string;

  @Type(() => Number) @IsInt() @Min(0)
  level!: number;

  @Nullable() @IsUUID()
  parentId?: string | null;

  @Nullable() @trim() @IsString() @MaxLength(30)
  code?: string | null;

  @Nullable() @IsUUID()
  managerEmployeeId?: string | null;

  @Nullable() @trim() @IsString() @MaxLength(200)
  costCenter?: string | null;

  @Nullable() @IsUUID()
  analyticAccountId?: string | null;

  @Nullable() @trim() @IsString() @MaxLength(1000)
  description?: string | null;

  @IsOptional() @Type(() => Number) @IsInt()
  sortOrder?: number;
}

// ---------------- سلم الرواتب ----------------

export class GradeAllowanceDto {
  @IsString() @Matches(/^[a-z][a-z0-9_]{1,29}$/, { message: 'رمز البدل حروف إنجليزية صغيرة' })
  code!: string;

  /** يؤخذ من تعريف البند في تبويب البدلات */
  @IsOptional() @IsString() @MaxLength(100)
  name!: string;

  @IsIn(['percent', 'fixed'])
  kind!: 'percent' | 'fixed';

  @Type(() => Number) @IsNumber() @Min(0)
  value!: number;
}

export class GradeDto {
  @trim() @IsString() @MinLength(1, { message: 'اكتب رمز المرتبة' }) @MaxLength(20)
  code!: string;

  @trim() @IsString() @MinLength(2, { message: 'اكتب اسم المرتبة' }) @MaxLength(120)
  name!: string;

  @Nullable() @Type(() => Number) @IsInt() @Min(0)
  structureLevel?: number | null;

  @Money('الحد الأدنى للراتب غير صحيح')
  minSalary!: number;

  @Money('الحد الأعلى للراتب غير صحيح')
  maxSalary!: number;

  @Type(() => Number) @IsInt({ message: 'عدد الدرجات رقم صحيح' }) @Min(1) @Max(30)
  steps!: number;

  @Type(() => Number) @IsNumber() @Min(0) @Max(50)
  stepIncrement!: number;

  @IsArray() @ValidateNested({ each: true }) @Type(() => GradeAllowanceDto)
  allowances!: GradeAllowanceDto[];

  @IsOptional() @Type(() => Number) @IsInt()
  sortOrder?: number;
}

// ---------------- الجدارات ----------------

export class CompetencyLevelDto {
  @Type(() => Number) @IsInt() @Min(1) @Max(5)
  level!: number;

  @trim() @IsString() @MaxLength(500)
  description!: string;
}

export class CompetencyDto {
  @trim() @IsString() @MinLength(2, { message: 'اكتب اسم الجدارة' }) @MaxLength(150)
  name!: string;

  @IsIn(COMPETENCY_KINDS)
  kind!: (typeof COMPETENCY_KINDS)[number];

  @Nullable() @trim() @IsString() @MaxLength(1000)
  description?: string | null;

  @IsArray() @ValidateNested({ each: true }) @Type(() => CompetencyLevelDto)
  levels!: CompetencyLevelDto[];

  @IsOptional() @IsBoolean()
  isActive?: boolean;
}

// ---------------- الوظائف ----------------

export class JobCompetencyDto {
  @IsUUID()
  competencyId!: string;

  @Type(() => Number) @IsInt() @Min(1) @Max(5)
  level!: number;
}

export class JobKpiDto {
  @trim() @IsString() @MinLength(2, { message: 'اكتب اسم المؤشر' }) @MaxLength(300)
  title!: string;

  @Type(() => Number) @IsNumber() @Min(0) @Max(100)
  weight!: number;

  @trim() @IsString() @MaxLength(200)
  target!: string;

  @Nullable() @trim() @IsString() @MaxLength(40)
  unit?: string | null;
}

export class JobDto {
  @trim() @IsString() @MinLength(2, { message: 'اكتب المسمى الوظيفي' }) @MaxLength(200)
  title!: string;

  @IsUUID('4', { message: 'اختر الوحدة التنظيمية' })
  unitId!: string;

  @Nullable() @IsUUID()
  gradeId?: string | null;

  @Nullable() @IsUUID()
  reportsToJobId?: string | null;

  /** فئة تحميل المصروف (فارغ = الفئة الافتراضية) */
  @Nullable() @IsUUID('4', { message: 'اختر فئة تحميل المصروف' })
  expenseProfileId?: string | null;

  @Type(() => Number) @IsInt() @Min(0) @Max(1000)
  headcount!: number;

  @Nullable() @trim() @IsString() @MaxLength(2000)
  purpose?: string | null;

  @IsArray() @IsString({ each: true }) @MaxLength(500, { each: true }) @ArrayMaxSize(40)
  responsibilities!: string[];

  @Nullable() @trim() @IsString() @MaxLength(2000)
  qualifications?: string | null;

  @Type(() => Number) @IsInt() @Min(0) @Max(50)
  experienceYears!: number;

  @IsArray() @ValidateNested({ each: true }) @Type(() => JobCompetencyDto)
  competencies!: JobCompetencyDto[];

  @IsArray() @ValidateNested({ each: true }) @Type(() => JobKpiDto)
  kpis!: JobKpiDto[];

  @Nullable() @trim() @IsString() @Matches(/^[A-Z0-9][A-Z0-9-]{2,39}$/, { message: 'كود الجودة حروف إنجليزية كبيرة وأرقام وشرطات، مثل QF-HR-JD-01' })
  qualityCode?: string | null;

  @IsOptional() @IsBoolean()
  isActive?: boolean;
}

// ---------------- خطط التعيين ----------------

export class PlanDto {
  @Type(() => Number) @IsInt() @Min(2000) @Max(2100)
  year!: number;

  @IsUUID('4', { message: 'اختر الوظيفة' })
  jobId!: string;

  @Type(() => Number) @IsInt({ message: 'العدد رقم صحيح' }) @Min(1) @Max(500)
  count!: number;

  @Type(() => Number) @IsInt() @Min(1) @Max(12)
  plannedMonth!: number;

  @IsIn(['own', 'project', 'grant', 'restricted'])
  fundingSource!: string;

  @Nullable() @trim() @IsString() @MaxLength(300)
  fundingNote?: string | null;

  @IsBoolean()
  forSaudi!: boolean;

  @Nullable() @trim() @IsString() @MaxLength(1000)
  justification?: string | null;
}

export class DecisionDto {
  @IsIn(['approve', 'reject'])
  decision!: 'approve' | 'reject';

  @Nullable() @trim() @IsString() @MaxLength(1000)
  note?: string | null;
}

// ---------------- الموظفون ----------------

export class SalaryItemDto {
  @IsString() @Matches(/^[a-z][a-z0-9_]{1,29}$/)
  code!: string;

  /** يؤخذ من تعريف البند في تبويب البدلات */
  @IsOptional() @IsString() @MaxLength(100)
  name!: string;

  @Money('مبلغ البدل غير صحيح')
  amount!: number;
}

export class EmployeeDto {
  @trim() @IsString() @MinLength(5, { message: 'اكتب الاسم الكامل' }) @MaxLength(200)
  fullName!: string;

  @trim() @Matches(/^[12]\d{9}$/, { message: 'رقم الهوية أو الإقامة 10 أرقام يبدأ بـ 1 أو 2' })
  nationalId!: string;

  @trim() @IsString() @MinLength(2, { message: 'اختر الجنسية' }) @MaxLength(100)
  nationality!: string;

  @IsBoolean()
  isSaudi!: boolean;

  @IsIn(['male', 'female'], { message: 'اختر الجنس' })
  gender!: 'male' | 'female';

  @Nullable() @DateField('تاريخ الميلاد غير صحيح')
  birthDate?: string | null;

  @Nullable() @trim() @Matches(/^05\d{8}$/, { message: 'رقم الجوال يبدأ بـ 05 ومكوّن من 10 أرقام' })
  phone?: string | null;

  @Nullable() @trim() @IsEmail({}, { message: 'البريد الإلكتروني غير صحيح' })
  email?: string | null;

  @IsUUID('4', { message: 'اختر الوظيفة' })
  jobId!: string;

  @Nullable() @IsUUID()
  unitId?: string | null;

  @Nullable() @IsUUID()
  managerId?: string | null;

  /** حساب الدخول المربوط (للخدمة الذاتية). غير مرسل = يبقى كما هو، null = فك الربط */
  @Nullable() @IsUUID('4', { message: 'حساب الدخول غير صحيح' })
  userId?: string | null;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(30)
  step?: number;

  @DateField('تاريخ المباشرة غير صحيح')
  hireDate!: string;

  @IsIn(CONTRACT_TYPES)
  contractType!: (typeof CONTRACT_TYPES)[number];

  @DateField('تاريخ بداية العقد غير صحيح')
  contractStart!: string;

  @Nullable() @DateField('تاريخ نهاية العقد غير صحيح')
  contractEnd?: string | null;

  @Nullable() @DateField('تاريخ نهاية فترة التجربة غير صحيح')
  probationEnd?: string | null;

  @IsIn(QIWA_STATUSES)
  qiwaStatus!: (typeof QIWA_STATUSES)[number];

  @Money('الراتب الأساسي غير صحيح')
  basicSalary!: number;

  @IsArray() @ValidateNested({ each: true }) @Type(() => SalaryItemDto)
  allowances!: SalaryItemDto[];

  @Nullable() @trim() @IsString() @MaxLength(500)
  salaryException?: string | null;

  @Nullable() @trim() @Matches(/^SA\d{22}$/, { message: 'رقم الآيبان يبدأ بـ SA ويتكون من 24 خانة' })
  iban?: string | null;

  @Nullable() @trim() @Matches(/^[A-Za-z0-9_-]{1,30}$/, { message: 'رقم الموظف في جهاز البصمة حروف إنجليزية وأرقام فقط' })
  attendanceCode?: string | null;

  @IsOptional() @IsBoolean()
  attendanceExempt?: boolean;

  @Nullable() @trim() @Matches(/^\d{6,15}$/, { message: 'رقم المشترك في التأمينات أرقام فقط' })
  gosiNumber?: string | null;

  @Nullable() @DateField('تاريخ أول تسجيل في التأمينات غير صحيح')
  gosiFirstRegistration?: string | null;

  @Nullable() @DateField('تاريخ انتهاء الهوية غير صحيح')
  idExpiry?: string | null;

  @Nullable() @DateField('تاريخ انتهاء الجواز غير صحيح')
  passportExpiry?: string | null;

  @IsOptional() @IsObject()
  leaveOpening?: Record<string, number>;

  @Nullable() @DateField('تاريخ الرصيد الافتتاحي غير صحيح')
  leaveOpeningDate?: string | null;
}

export class TerminateDto {
  @DateField('تاريخ آخر يوم عمل غير صحيح')
  terminationDate!: string;

  @IsIn(Object.keys(EOS_REASONS), { message: 'اختر سبب انتهاء الخدمة' })
  reason!: keyof typeof EOS_REASONS;

  @Nullable() @trim() @IsString() @MaxLength(1000)
  note?: string | null;
}

export class EosCalcDto {
  @Nullable() @IsUUID()
  employeeId?: string | null;

  @Nullable() @Type(() => Number) @IsNumber() @Min(0)
  wage?: number | null;

  @Nullable() @DateField('تاريخ المباشرة غير صحيح')
  startDate?: string | null;

  @DateField('تاريخ نهاية الخدمة غير صحيح')
  endDate!: string;

  @IsIn(Object.keys(EOS_REASONS), { message: 'اختر سبب انتهاء الخدمة' })
  reason!: keyof typeof EOS_REASONS;
}

// ---------------- الإجازات ----------------

export class LeaveDto {
  @IsUUID('4', { message: 'اختر الموظف' })
  employeeId!: string;

  @IsString() @MaxLength(30)
  leaveType!: string;

  @DateField('تاريخ بداية الإجازة غير صحيح')
  startDate!: string;

  @DateField('تاريخ نهاية الإجازة غير صحيح')
  endDate!: string;

  @Nullable() @trim() @IsString() @MaxLength(1000)
  note?: string | null;
}

// ---------------- الأداء ----------------

export class CardCreateDto {
  @IsUUID('4', { message: 'اختر الموظف' })
  employeeId!: string;

  @Type(() => Number) @IsInt() @Min(2000) @Max(2100)
  year!: number;
}

export class CardObjectiveDto {
  @trim() @IsString() @MinLength(2, { message: 'اكتب الهدف' }) @MaxLength(300)
  title!: string;

  @Type(() => Number) @IsNumber() @Min(0) @Max(100)
  weight!: number;

  @trim() @IsString() @MaxLength(200)
  target!: string;

  @Nullable() @Type(() => Number) @IsNumber() @Min(0) @Max(200)
  achievement?: number | null;

  @Nullable() @trim() @IsString() @MaxLength(500)
  note?: string | null;
}

export class CardCompetencyDto {
  @IsUUID()
  competencyId!: string;

  @Type(() => Number) @IsInt() @Min(1) @Max(5)
  requiredLevel!: number;

  @Nullable() @Type(() => Number) @IsInt() @Min(1) @Max(5)
  rating?: number | null;
}

export class CardUpdateDto {
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => CardObjectiveDto)
  objectives?: CardObjectiveDto[];

  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => CardCompetencyDto)
  competencies?: CardCompetencyDto[];

  @Nullable() @trim() @IsString() @MaxLength(2000)
  managerNote?: string | null;

  @Nullable() @trim() @IsString() @MaxLength(2000)
  employeeNote?: string | null;
}

export class CardActionDto {
  @IsIn(['agree', 'evaluate', 'approve', 'reopen'])
  action!: 'agree' | 'evaluate' | 'approve' | 'reopen';
}

// ---------------- بنود الراتب والربط المحاسبي ----------------

export class AllowanceTypeDto {
  @trim() @Matches(/^[a-z][a-z0-9_]{1,29}$/, { message: 'رمز البند حروف إنجليزية صغيرة وأرقام، مثل housing' })
  code!: string;

  @trim() @IsString() @MinLength(2, { message: 'اكتب اسم البند' }) @MaxLength(120)
  name!: string;

  @IsIn(['percent', 'fixed'])
  defaultKind!: 'percent' | 'fixed';

  @Money('القيمة الافتراضية رقم موجب')
  defaultValue!: number;

  @Nullable() @IsUUID()
  payableAccountId?: string | null;

  @Nullable() @IsUUID()
  cashAccountId?: string | null;

  @IsOptional() @IsBoolean()
  isActive?: boolean;

  @IsOptional() @Type(() => Number) @IsInt()
  sortOrder?: number;
}

export class PayrollStageDto {
  @trim() @IsString() @MinLength(2, { message: 'اكتب اسم المرحلة' }) @MaxLength(120)
  name!: string;

  @Nullable() @IsUUID()
  roleId?: string | null;
}

export class PayrollConfigDto {
  @Nullable() @IsUUID()
  payableAccountId?: string | null;

  @Nullable() @IsUUID()
  gosiPayableAccountId?: string | null;

  @Nullable() @IsUUID()
  deductionsAccountId?: string | null;

  @Nullable() @IsUUID()
  advancesAccountId?: string | null;

  @Nullable() @IsUUID()
  defaultCashAccountId?: string | null;

  @IsArray() @ArrayMaxSize(8, { message: 'ثماني مراحل على الأكثر' }) @ValidateNested({ each: true }) @Type(() => PayrollStageDto)
  stages!: PayrollStageDto[];
}

// ---------------- كشف الرواتب ----------------

export class RunCreateDto {
  @Matches(/^\d{4}-(0[1-9]|1[0-2])$/, { message: 'اختر الشهر' })
  month!: string;
}

export class RunAdditionDto {
  @trim() @IsString()
  code!: string;

  @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }, { message: 'مبلغ الإضافة رقم' }) @Min(0.01, { message: 'مبلغ الإضافة أكبر من صفر' })
  amount!: number;

  @Nullable() @trim() @IsString() @MaxLength(300)
  note?: string | null;
}

export class RunLineDto {
  /** تعديل الحضور يدويًا (فارغ = كما حُسب من البصمات) */
  @IsOptional() @IsBoolean()
  overrideAttendance?: boolean;

  @IsOptional() @Type(() => Number) @IsNumber({ maxDecimalPlaces: 1 }) @Min(0) @Max(31)
  absentDays?: number;

  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(20000)
  lateMinutes?: number;

  @IsArray() @ArrayMaxSize(10) @ValidateNested({ each: true }) @Type(() => RunAdditionDto)
  additions!: RunAdditionDto[];

  @Money('الاستقطاع رقم موجب')
  otherDeduction!: number;

  @Nullable() @trim() @IsString() @MaxLength(300)
  otherDeductionNote?: string | null;
}

export class RunDecisionDto {
  @IsIn(['approve', 'return'])
  decision!: 'approve' | 'return';

  @Nullable() @trim() @IsString() @MaxLength(1000)
  note?: string | null;
}

export class RunNoteDto {
  @Nullable() @trim() @IsString() @MaxLength(1000)
  note?: string | null;
}

export class RunVouchersDto {
  @DateField('تاريخ الصرف غير صحيح')
  voucherDate!: string;
}

// ---------------- الحضور والانصراف ----------------

export class HolidayDto {
  @DateField('تاريخ العطلة غير صحيح')
  date!: string;

  @trim() @IsString() @MinLength(2, { message: 'اكتب اسم العطلة' }) @MaxLength(100)
  name!: string;
}

export class AttendanceConfigDto {
  @IsBoolean()
  enabled!: boolean;

  @IsString()
  workStart!: string;

  @IsString()
  workEnd!: string;

  @IsArray() @ArrayMaxSize(7) @Type(() => Number) @IsInt({ each: true })
  weekend!: number[];

  @IsArray() @ArrayMaxSize(60) @ValidateNested({ each: true }) @Type(() => HolidayDto)
  holidays!: HolidayDto[];
}

export class DeviceDto {
  @trim() @IsString() @MinLength(2, { message: 'اكتب اسم الجهاز' }) @MaxLength(120)
  name!: string;

  @Nullable() @trim() @IsString() @MaxLength(60)
  brand?: string | null;

  @trim() @Matches(/^[A-Za-z0-9_-]{4,60}$/, { message: 'الرقم التسلسلي للجهاز (SN) حروف إنجليزية وأرقام كما في شاشة الجهاز' })
  serialNumber!: string;

  @Nullable() @trim() @IsString() @MaxLength(200)
  location?: string | null;

  @IsOptional() @IsBoolean()
  isActive?: boolean;
}

export class ManualPunchDto {
  @IsUUID()
  employeeId!: string;

  @DateField('التاريخ غير صحيح')
  date!: string;

  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, { message: 'الوقت غير صحيح' })
  time!: string;

  @trim() @IsString({ message: 'اكتب سبب الإدخال اليدوي' }) @MinLength(3, { message: 'اكتب سبب الإدخال اليدوي' }) @MaxLength(300)
  note!: string;
}

// ---------------- فئات تحميل المصروف ----------------

export class ProfileAccountDto {
  @trim() @IsString()
  code!: string;

  @IsUUID('4', { message: 'اختر حساب المصروف' })
  accountId!: string;
}

export class ExpenseProfileDto {
  @trim() @IsString() @MinLength(2, { message: 'اكتب اسم الفئة' }) @MaxLength(100)
  name!: string;

  @Nullable() @trim() @IsString() @MaxLength(300)
  description?: string | null;

  @IsArray() @ArrayMaxSize(60) @ValidateNested({ each: true }) @Type(() => ProfileAccountDto)
  accounts!: ProfileAccountDto[];

  @IsOptional() @IsBoolean()
  isDefault?: boolean;
}

// ---------------- التطوير والتدريب والصف الثاني ----------------

export class DevConfigDto {
  @IsArray() @ArrayMaxSize(8, { message: 'ثماني مراحل على الأكثر' }) @ValidateNested({ each: true }) @Type(() => PayrollStageDto)
  stages!: PayrollStageDto[];

  @IsArray() @ArrayMinSize(1, { message: 'أضف نوعًا واحدًا على الأقل من الأنشطة التطويرية' }) @ArrayMaxSize(30) @ValidateNested({ each: true }) @Type(() => DevActivityTypeDto)
  activityTypes!: DevActivityTypeDto[];
}

export class DevActivityTypeDto {
  @trim() @Matches(/^[a-z][a-z0-9_]{1,29}$/, { message: 'رمز النوع حروف إنجليزية صغيرة، مثل course' })
  code!: string;

  @trim() @IsString() @MinLength(2, { message: 'اكتب اسم النوع' }) @MaxLength(80)
  name!: string;
}

export class DevPlanCreateDto {
  @IsUUID('4', { message: 'اختر الموظف' })
  employeeId!: string;

  @IsIn(['individual', 'succession'])
  kind!: 'individual' | 'succession';

  /** خطط الصف الثاني: الوظيفة التي يُعد لها الموظف */
  @Nullable() @IsUUID('4', { message: 'اختر الوظيفة المستهدفة' })
  targetJobId?: string | null;

  @Type(() => Number) @IsInt() @Min(2000) @Max(2100)
  year!: number;
}

export class DevItemDto {
  @IsOptional() @IsString() @MaxLength(40)
  id?: string;

  @Nullable() @IsUUID()
  competencyId?: string | null;

  @trim() @IsString() @MinLength(2, { message: 'اكتب الجدارة أو المهارة' }) @MaxLength(200)
  name!: string;

  @Nullable() @Type(() => Number) @IsInt() @Min(1) @Max(5)
  requiredLevel?: number | null;

  @Nullable() @Type(() => Number) @IsInt() @Min(0) @Max(5)
  currentLevel?: number | null;

  @Nullable() @Type(() => Number) @IsInt({ message: 'المستوى المستهدف من 1 إلى 5' }) @Min(1) @Max(5)
  targetLevel?: number | null;

  @trim() @IsString() @MinLength(1, { message: 'اختر نوع النشاط' }) @MaxLength(30)
  activityType!: string;

  @trim() @IsString() @MinLength(2, { message: 'اكتب النشاط التطويري (مثل اسم الدورة)' }) @MaxLength(300)
  activity!: string;

  @Nullable() @trim() @IsString() @MaxLength(200)
  provider?: string | null;

  @Nullable() @DateField('تاريخ الإنجاز غير صحيح')
  dueDate?: string | null;

  @Money('التكلفة رقم موجب')
  cost!: number;

  @Type(() => Number) @IsNumber({ maxDecimalPlaces: 1 }, { message: 'الساعات رقم' }) @Min(0) @Max(2000)
  hours!: number;

  @IsOptional() @IsIn(['planned', 'in_progress', 'done', 'cancelled'])
  status?: 'planned' | 'in_progress' | 'done' | 'cancelled';

  @Nullable() @Type(() => Number) @IsInt() @Min(0) @Max(5)
  achievedLevel?: number | null;

  @Nullable() @trim() @IsString() @MaxLength(500)
  note?: string | null;
}

export class DevPlanDto {
  @trim() @IsString() @MinLength(3, { message: 'اكتب عنوان الخطة' }) @MaxLength(200)
  title!: string;

  @IsArray() @ArrayMaxSize(15) @IsString({ each: true }) @MaxLength(300, { each: true })
  goals!: string[];

  @IsArray() @ArrayMaxSize(40) @ValidateNested({ each: true }) @Type(() => DevItemDto)
  items!: DevItemDto[];
}

/** متابعة التنفيذ بعد الاعتماد: حالة كل نشاط والمستوى المحقق */
export class DevProgressItemDto {
  @IsString() @MaxLength(40)
  id!: string;

  @IsIn(['planned', 'in_progress', 'done', 'cancelled'])
  status!: 'planned' | 'in_progress' | 'done' | 'cancelled';

  @Nullable() @Type(() => Number) @IsInt() @Min(0) @Max(5)
  achievedLevel?: number | null;

  @Nullable() @trim() @IsString() @MaxLength(500)
  note?: string | null;
}

export class DevProgressDto {
  @IsArray() @ArrayMaxSize(40) @ValidateNested({ each: true }) @Type(() => DevProgressItemDto)
  items!: DevProgressItemDto[];
}

export class SuccessionJobDto {
  @Nullable() @IsUUID('4', { message: 'اختر الوظيفة البديلة' })
  backupJobId?: string | null;
}

export class CandidateDto {
  @IsUUID('4', { message: 'اختر الموظف' })
  employeeId!: string;

  @IsIn(['now', '1y', '2y'], { message: 'اختر الجاهزية' })
  readiness!: 'now' | '1y' | '2y';

  @Nullable() @trim() @IsString() @MaxLength(500)
  note?: string | null;
}
