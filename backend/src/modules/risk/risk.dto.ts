import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize, IsArray, IsBoolean, IsDateString, IsIn, IsInt, IsNumber, IsObject, IsOptional, IsString, IsUUID, Max, MaxLength, Min, MinLength,
  ValidateIf, ValidateNested,
} from 'class-validator';
import {
  ANALYSIS_KINDS, COMPLIANCE_RESULTS, CONTROL_TYPES, EFFECTIVENESS, FREQUENCIES, PRIORITIES, RISK_SOURCES, RISK_STATES, TREATMENTS,
} from './entities/risk.entity';

const trim = () => Transform(({ value }) => (typeof value === 'string' ? value.trim() || null : value));
const Nullable = (): PropertyDecorator => (t, k) => [IsOptional(), ValidateIf((_: unknown, v: unknown) => v !== null && v !== '')].forEach((d) => d(t, k));
const DateField = (msg: string) => IsDateString({ strict: true }, { message: msg });
const Scale = (msg: string) => (t: object, k: string | symbol) => {
  Type(() => Number)(t, k);
  IsInt({ message: msg })(t, k);
  Min(1, { message: msg })(t, k);
  Max(5, { message: msg })(t, k);
};
const Text = (max: number, required = false) => (t: object, k: string | symbol) => {
  trim()(t, k);
  if (!required) Nullable()(t, k);
  IsString()(t, k);
  MaxLength(max)(t, k);
};
const Uuids = () => (t: object, k: string | symbol) => {
  IsOptional()(t, k);
  IsArray()(t, k);
  ArrayMaxSize(100)(t, k);
  IsUUID('4', { each: true })(t, k);
};

// ---------------- الإعدادات واللائحة والدليل ----------------

export class ConfigDto {
  @IsObject({ message: 'الإعدادات غير مكتملة' })
  config!: Record<string, unknown>;
}

export class PolicySectionDto {
  @IsString() @MaxLength(40)
  key!: string;

  @Text(200, true) @MinLength(2, { message: 'اكتب عنوان كل باب' })
  title!: string;

  @IsString() @MaxLength(20000)
  body!: string;
}

export class PolicyDto {
  @IsArray() @ArrayMaxSize(40) @ValidateNested({ each: true }) @Type(() => PolicySectionDto)
  sections!: PolicySectionDto[];

  @DateField('تاريخ سريان الإصدار غير صحيح')
  effectiveDate!: string;

  @Text(1000, true) @MinLength(3, { message: 'اكتب ملخص التعديل في سجل الإصدارات' })
  note!: string;

  @Text(200)
  approvedBy?: string | null;
}

export class GuideEntryDto {
  @IsIn(['term', 'risk'])
  kind!: 'term' | 'risk';

  @Text(250, true) @MinLength(2, { message: 'اكتب العنوان' })
  title!: string;

  @Text(250)
  titleEn?: string | null;

  @IsString() @MaxLength(40)
  category!: string;

  @Text(5000, true) @MinLength(2, { message: 'اكتب التعريف أو الوصف' })
  body!: string;

  @IsOptional() @IsObject()
  details?: { source?: string; causes?: string; controls?: string; kris?: string };
}

export class DecideDto {
  @IsIn(['approve', 'return', 'reject'])
  decision!: 'approve' | 'return' | 'reject';

  @Text(1000)
  note?: string | null;
}

// ---------------- سجل المخاطر ----------------

export class RiskActionDto {
  @Text(300, true) @MinLength(2, { message: 'اكتب عنوان كل إجراء معالجة' })
  title!: string;

  @Text(200)
  ownerName?: string | null;

  @Nullable() @DateField('تاريخ استحقاق الإجراء غير صحيح')
  dueDate?: string | null;

  @IsIn(['planned', 'in_progress', 'done'])
  status!: 'planned' | 'in_progress' | 'done';

  @Text(500)
  note?: string | null;
}

export class RiskKriDto {
  @Text(200, true) @MinLength(2, { message: 'اكتب اسم المؤشر' })
  name!: string;

  @Text(100, true)
  threshold!: string;

  @Text(100)
  current?: string | null;

  @IsBoolean()
  breached!: boolean;
}

export class RiskDto {
  @Text(250, true) @MinLength(3, { message: 'اكتب عنوان الخطر' })
  title!: string;

  @Text(5000)
  description?: string | null;

  @IsIn(RISK_SOURCES, { message: 'حدد مصدر الخطر' })
  source!: (typeof RISK_SOURCES)[number];

  @IsString() @MaxLength(40)
  category!: string;

  @Text(200)
  productName?: string | null;

  @Nullable() @IsUUID()
  unitId?: string | null;

  @Text(200)
  ownerName?: string | null;

  @Text(5000)
  causes?: string | null;

  @Text(5000)
  consequences?: string | null;

  @Scale('احتمالية الخطر الكامن من 1 إلى 5')
  inherentLikelihood!: number;

  @Scale('أثر الخطر الكامن من 1 إلى 5')
  inherentImpact!: number;

  @Scale('احتمالية الخطر المتبقي من 1 إلى 5')
  residualLikelihood!: number;

  @Scale('أثر الخطر المتبقي من 1 إلى 5')
  residualImpact!: number;

  @Nullable() @Type(() => Number) @IsInt() @Min(1) @Max(25)
  targetScore?: number | null;

  @IsIn(TREATMENTS, { message: 'حدد خيار المعالجة' })
  treatment!: (typeof TREATMENTS)[number];

  @Text(2000)
  treatmentNote?: string | null;

  @IsArray() @ArrayMaxSize(50) @ValidateNested({ each: true }) @Type(() => RiskActionDto)
  actions!: RiskActionDto[];

  @IsArray() @ArrayMaxSize(20) @ValidateNested({ each: true }) @Type(() => RiskKriDto)
  kris!: RiskKriDto[];

  @IsOptional() @IsIn(RISK_STATES)
  riskState?: (typeof RISK_STATES)[number];

  @IsOptional() @DateField('تاريخ تحديد الخطر غير صحيح')
  identifiedDate?: string;

  @Nullable() @IsUUID()
  analysisId?: string | null;

  @Text(40)
  analysisItemId?: string | null;
}

export class RiskReviewDto {
  @DateField('تاريخ المراجعة غير صحيح')
  reviewDate!: string;

  @Scale('الاحتمالية من 1 إلى 5')
  likelihood!: number;

  @Scale('الأثر من 1 إلى 5')
  impact!: number;

  @Text(1000)
  note?: string | null;
}

export class ControlDto {
  @Text(250, true) @MinLength(3, { message: 'اكتب اسم الضابط' })
  name!: string;

  @Text(5000)
  description?: string | null;

  @IsIn(CONTROL_TYPES, { message: 'حدد نوع الضابط' })
  type!: (typeof CONTROL_TYPES)[number];

  @IsBoolean()
  automated!: boolean;

  @IsIn(FREQUENCIES)
  frequency!: (typeof FREQUENCIES)[number];

  @Text(200)
  ownerName?: string | null;

  @IsIn(EFFECTIVENESS)
  effectiveness!: (typeof EFFECTIVENESS)[number];

  @Nullable() @DateField('تاريخ آخر اختبار غير صحيح')
  lastTestDate?: string | null;

  @Text(1000)
  lastTestNote?: string | null;

  @Uuids()
  riskIds?: string[];

  @Uuids()
  obligationIds?: string[];

  @IsOptional() @IsBoolean()
  isActive?: boolean;
}

// ---------------- التحليلات ----------------

export class AnalysisItemDto {
  @IsOptional() @IsString() @MaxLength(40)
  id?: string;

  @IsString() @MaxLength(20)
  factor!: string;

  @Text(1000, true) @MinLength(2, { message: 'اكتب نص كل عامل' })
  text!: string;

  @Scale('الأثر من 1 إلى 5')
  impact!: number;

  @Scale('الاحتمالية من 1 إلى 5')
  likelihood!: number;

  @Nullable() @IsIn(['up', 'stable', 'down'])
  trend?: 'up' | 'stable' | 'down' | null;

  @Text(1000)
  note?: string | null;
}

export class StrategyDto {
  @IsIn(['SO', 'WO', 'ST', 'WT'])
  type!: 'SO' | 'WO' | 'ST' | 'WT';

  @Text(1000, true) @MinLength(2)
  text!: string;
}

export class AnalysisDto {
  @IsIn(ANALYSIS_KINDS)
  kind!: (typeof ANALYSIS_KINDS)[number];

  @Text(200, true) @MinLength(3, { message: 'اكتب عنوان التحليل' })
  title!: string;

  @Text(200)
  scope?: string | null;

  @DateField('تاريخ التحليل غير صحيح')
  analysisDate!: string;

  @IsArray() @ArrayMaxSize(120) @ValidateNested({ each: true }) @Type(() => AnalysisItemDto)
  items!: AnalysisItemDto[];

  @IsOptional() @IsArray() @ArrayMaxSize(40) @ValidateNested({ each: true }) @Type(() => StrategyDto)
  strategies?: StrategyDto[];

  @Text(5000)
  summary?: string | null;
}

export class ItemToRiskDto {
  @IsString() @MaxLength(40)
  itemId!: string;

  @IsString() @MaxLength(40)
  category!: string;

  @Text(200)
  ownerName?: string | null;
}

// ---------------- التغيير ----------------

export class ImpactDto {
  @Text(100, true)
  area!: string;

  @Type(() => Number) @IsInt() @Min(0) @Max(5)
  level!: number;

  @Text(1000)
  note?: string | null;
}

export class ChangeDto {
  @Text(250, true) @MinLength(3, { message: 'اكتب عنوان التغيير' })
  title!: string;

  @IsString() @MaxLength(40)
  changeType!: string;

  @IsIn(['standard', 'normal', 'emergency'])
  changeClass!: 'standard' | 'normal' | 'emergency';

  @IsIn(PRIORITIES)
  priority!: (typeof PRIORITIES)[number];

  @Text(5000, true) @MinLength(3, { message: 'اكتب مبرر التغيير' })
  reason!: string;

  @Text(5000)
  description?: string | null;

  @Text(500)
  affectedUnits?: string | null;

  @IsArray() @ArrayMaxSize(20) @ValidateNested({ each: true }) @Type(() => ImpactDto)
  impacts!: ImpactDto[];

  @Text(5000)
  benefits?: string | null;

  @Nullable() @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0)
  costEstimate?: number | null;

  @Uuids()
  riskIds?: string[];

  @Text(5000)
  communication?: string | null;

  @Nullable() @DateField('تاريخ البداية غير صحيح')
  plannedStart?: string | null;

  @Nullable() @DateField('تاريخ النهاية غير صحيح')
  plannedEnd?: string | null;
}

export class ChangeProgressDto {
  @IsIn(['implementing', 'completed', 'closed'])
  phase!: 'implementing' | 'completed' | 'closed';

  @Text(5000)
  reviewResult?: string | null;

  @Text(5000)
  lessons?: string | null;
}

// ---------------- الالتزام ----------------

export class ObligationDto {
  @Text(300, true) @MinLength(3, { message: 'اكتب نص المتطلب' })
  title!: string;

  @Text(200, true) @MinLength(2, { message: 'حدد الجهة أو المرجع' })
  authority!: string;

  @Text(200)
  reference?: string | null;

  @Text(5000)
  description?: string | null;

  @Text(200)
  ownerName?: string | null;

  @IsIn(FREQUENCIES)
  frequency!: (typeof FREQUENCIES)[number];

  @Nullable() @DateField('تاريخ التقييم القادم غير صحيح')
  nextDueDate?: string | null;

  @Nullable() @IsUUID()
  riskId?: string | null;

  @IsOptional() @IsBoolean()
  isActive?: boolean;
}

export class AssessmentDto {
  @DateField('تاريخ التقييم غير صحيح')
  assessmentDate!: string;

  @IsIn(COMPLIANCE_RESULTS, { message: 'حدد نتيجة التقييم' })
  result!: (typeof COMPLIANCE_RESULTS)[number];

  @Text(5000)
  evidence?: string | null;

  @Text(5000)
  gaps?: string | null;

  @Text(5000)
  correctiveAction?: string | null;

  @Text(200)
  actionOwner?: string | null;

  @Nullable() @DateField('موعد الإجراء التصحيحي غير صحيح')
  actionDueDate?: string | null;

  @IsOptional() @IsBoolean()
  actionDone?: boolean;
}

// ---------------- الاستمرارية والإجراءات ----------------

export class BiaImpactsDto {
  @Scale('الأثر المالي من 1 إلى 5') financial!: number;
  @Scale('الأثر على المستفيدين من 1 إلى 5') beneficiaries!: number;
  @Scale('الأثر على السمعة من 1 إلى 5') reputation!: number;
  @Scale('الأثر النظامي من 1 إلى 5') legal!: number;
  @Scale('الأثر التشغيلي من 1 إلى 5') operational!: number;
}

export class ContinuityStepDto {
  @Text(300, true) @MinLength(2, { message: 'اكتب عنوان كل خطوة' })
  title!: string;

  @Text(200)
  ownerName?: string | null;

  @Nullable() @Type(() => Number) @IsInt() @Min(0) @Max(8760)
  withinHours?: number | null;
}

export class DependencyDto {
  @IsIn(['people', 'system', 'supplier', 'facility', 'data'])
  kind!: string;

  @Text(200, true)
  name!: string;
}

export class ContinuityDto {
  @Text(250, true) @MinLength(3, { message: 'اكتب اسم النشاط' })
  activity!: string;

  @Text(200)
  unitName?: string | null;

  @Text(200)
  ownerName?: string | null;

  @Text(5000)
  description?: string | null;

  @ValidateNested() @Type(() => BiaImpactsDto)
  impacts!: BiaImpactsDto;

  @Type(() => Number) @IsInt({ message: 'أقصى فترة توقف بالساعات' }) @Min(1) @Max(8760)
  mtpdHours!: number;

  @Type(() => Number) @IsInt({ message: 'وقت الاستعادة بالساعات' }) @Min(0) @Max(8760)
  rtoHours!: number;

  @Nullable() @Type(() => Number) @IsInt() @Min(0) @Max(8760)
  rpoHours?: number | null;

  @Text(5000)
  minResources?: string | null;

  @IsArray() @ArrayMaxSize(40) @ValidateNested({ each: true }) @Type(() => DependencyDto)
  dependencies!: DependencyDto[];

  @Text(5000)
  strategy?: string | null;

  @IsArray() @ArrayMaxSize(60) @ValidateNested({ each: true }) @Type(() => ContinuityStepDto)
  steps!: ContinuityStepDto[];

  @Uuids()
  riskIds?: string[];

  @Nullable() @DateField('تاريخ آخر اختبار غير صحيح')
  lastTestDate?: string | null;

  @Text(1000)
  lastTestResult?: string | null;
}

export class ProcedureStepDto {
  @Text(300, true) @MinLength(2, { message: 'اكتب عنوان كل خطوة' })
  title!: string;

  @Text(200, true) @MinLength(2, { message: 'حدد المنفذ لكل خطوة' })
  actor!: string;

  @Text(2000)
  description?: string | null;

  @Nullable() @Type(() => Number) @IsNumber() @Min(0) @Max(365)
  durationDays?: number | null;

  @Text(300)
  output?: string | null;

  @Text(300)
  control?: string | null;

  @IsBoolean()
  decision!: boolean;
}

export class ProcedureDto {
  @Text(250, true) @MinLength(3, { message: 'اكتب اسم الإجراء' })
  name!: string;

  @IsIn(['risk', 'change', 'compliance', 'continuity', 'other'])
  domain!: string;

  @Text(5000) purpose?: string | null;
  @Text(5000) scope?: string | null;
  @Text(200) ownerName?: string | null;
  @Text(2000) inputs?: string | null;
  @Text(2000) outputs?: string | null;

  @IsArray() @ArrayMaxSize(60) @ValidateNested({ each: true }) @Type(() => ProcedureStepDto)
  steps!: ProcedureStepDto[];

  @IsOptional() @IsArray() @ArrayMaxSize(20)
  kpis?: { name: string; target: string }[];

  @Uuids()
  riskIds?: string[];

  @Uuids()
  controlIds?: string[];
}

// ---------------- مهام المتابعة ----------------

export class TaskDto {
  @Text(300, true) @MinLength(2, { message: 'اكتب عنوان المهمة' })
  title!: string;

  @Text(5000)
  description?: string | null;

  @Nullable() @IsUUID()
  unitId?: string | null;

  @Nullable() @IsUUID()
  assigneeUserId?: string | null;

  @Nullable() @DateField('تاريخ البداية غير صحيح')
  startDate?: string | null;

  @DateField('حدد تاريخ استحقاق المهمة')
  dueDate!: string;
}

export class TaskProgressDto {
  @IsIn(['open', 'in_progress', 'done', 'cancelled'])
  status!: 'open' | 'in_progress' | 'done' | 'cancelled';

  @Type(() => Number) @IsInt() @Min(0) @Max(100)
  progress!: number;

  @Text(5000)
  completionNote?: string | null;
}

// ---------------- سجل المنهجيات ----------------

export class MethodologyDto {
  @Text(250, true) @MinLength(3, { message: 'اكتب اسم المنهجية' })
  name!: string;

  @IsIn(['risk', 'continuity', 'change', 'compliance', 'procedures', 'other'])
  domain!: string;

  @Text(200)
  reference?: string | null;

  @IsOptional() @IsBoolean()
  isActive?: boolean;
}

export class MethodologyVersionDto {
  @IsString() @MinLength(20, { message: 'نص المنهجية قصير جدًا' }) @MaxLength(50000)
  body!: string;

  @DateField('تاريخ السريان غير صحيح')
  effectiveDate!: string;

  @Text(200)
  approvedBy?: string | null;

  @Text(1000, true) @MinLength(3, { message: 'اكتب ملخص التعديل' })
  note!: string;
}

export class NewMethodologyDto extends MethodologyDto {
  @IsString() @MinLength(20, { message: 'نص المنهجية قصير جدًا' }) @MaxLength(50000)
  body!: string;

  @DateField('تاريخ السريان غير صحيح')
  effectiveDate!: string;

  @Text(200)
  approvedBy?: string | null;
}

// ---------------- فرق الأزمات ----------------

export class CrisisMemberDto {
  @Nullable() @IsUUID()
  userId?: string | null;

  @Text(200, true) @MinLength(2, { message: 'اكتب اسم كل عضو' })
  name!: string;

  @Text(100, true) @MinLength(2, { message: 'حدد دور كل عضو في الفريق' })
  teamRole!: string;

  @Text(30)
  phone?: string | null;

  @Text(200)
  alternate?: string | null;
}

export class CrisisAuthorityDto {
  @Text(500, true) @MinLength(3, { message: 'اكتب نص كل صلاحية' })
  authority!: string;

  @Text(100, true) @MinLength(2, { message: 'حدد صاحب كل صلاحية' })
  holder!: string;

  @Text(200)
  limit?: string | null;
}

export class CrisisTeamDto {
  @Text(200, true) @MinLength(3, { message: 'اكتب اسم الفريق' })
  name!: string;

  @IsIn(['crisis', 'disaster', 'recovery'])
  kind!: 'crisis' | 'disaster' | 'recovery';

  @Text(5000)
  mandate?: string | null;

  @IsArray() @ArrayMaxSize(40) @ValidateNested({ each: true }) @Type(() => CrisisMemberDto)
  members!: CrisisMemberDto[];

  @IsArray() @ArrayMaxSize(60) @ValidateNested({ each: true }) @Type(() => CrisisAuthorityDto)
  authorities!: CrisisAuthorityDto[];

  @IsArray() @ArrayMaxSize(200) @IsString({ each: true })
  systemPermissions!: string[];

  @IsArray() @ArrayMaxSize(60) @ValidateNested({ each: true }) @Type(() => ContinuityStepDto)
  playbook!: ContinuityStepDto[];

  @Text(5000)
  communication?: string | null;

  @Uuids()
  continuityIds?: string[];
}

export class CrisisActivateDto {
  @Text(250, true) @MinLength(3, { message: 'اكتب عنوان الأزمة' })
  title!: string;

  @Text(5000)
  scenario?: string | null;

  @IsIn(['minor', 'major', 'critical'])
  severity!: 'minor' | 'major' | 'critical';

  @Nullable() @IsUUID()
  riskId?: string | null;
}

export class CrisisLogDto {
  @Text(2000, true) @MinLength(2, { message: 'اكتب نص الحدث' })
  text!: string;
}

export class CrisisCloseDto {
  @Text(5000, true) @MinLength(3, { message: 'اكتب الدروس المستفادة' })
  lessons!: string;
}
