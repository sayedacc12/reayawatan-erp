import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize, IsArray, IsBoolean, IsDateString, IsIn, IsInt, IsNumber, IsObject, IsOptional, IsString, Matches, Max, MaxLength, Min, MinLength,
  ValidateIf, ValidateNested,
} from 'class-validator';
import {
  AUDIT_RESULTS, AUTO_METRICS, COMPLAINT_CHANNELS, DOC_TYPES, NCR_SOURCES, OBJ_FREQUENCIES, PARTY_TYPES, RISK_TREATMENTS,
} from './entities/quality.entity';

const trim = () => Transform(({ value }) => (typeof value === 'string' ? value.trim() || null : value));
const Nullable = (): PropertyDecorator => (t, k) => [IsOptional(), ValidateIf((_: unknown, v: unknown) => v !== null && v !== '')].forEach((d) => d(t, k));
const DateField = (msg: string) => IsDateString({ strict: true }, { message: msg });
const Text = (max: number, msg?: string) => (t: object, k: string | symbol) => {
  trim()(t, k);
  IsString({ message: msg })(t, k);
  MaxLength(max)(t, k);
};
const Rating = () => (t: object, k: string | symbol) => {
  Type(() => Number)(t, k);
  IsInt({ message: 'التقييم من 1 إلى 5' })(t, k);
  Min(1, { message: 'التقييم من 1 إلى 5' })(t, k);
  Max(5, { message: 'التقييم من 1 إلى 5' })(t, k);
};
const CODE_RE = /^[A-Za-z0-9][A-Za-z0-9.\-_/]{1,48}$/;

// ---------------- الإعدادات والسياق ----------------

export class DepartmentDto {
  @trim() @Matches(/^[A-Za-z][A-Za-z0-9]{0,9}$/, { message: 'رمز الإدارة حروف إنجليزية وأرقام (حتى 10)' })
  code!: string;

  @Text(120) @MinLength(2, { message: 'اكتب اسم الإدارة' })
  name!: string;
}

export class SettingsDto {
  @IsObject()
  prefixes!: Record<string, string>;

  @IsArray() @ArrayMaxSize(40) @ValidateNested({ each: true }) @Type(() => DepartmentDto)
  departments!: DepartmentDto[];

  @Type(() => Number) @IsInt() @Min(2) @Max(4)
  seqDigits!: number;

  @Type(() => Number) @IsInt() @Min(1, { message: 'مدة المراجعة شهر على الأقل' }) @Max(60)
  reviewMonths!: number;

  @Type(() => Number) @IsInt() @Min(1) @Max(90)
  complaintDays!: number;

  @Type(() => Number) @IsInt() @Min(1) @Max(365)
  ncrDays!: number;
}

export class ContextDto {
  @IsObject({ message: 'بيانات السياق غير مكتملة' })
  context!: Record<string, unknown>;
}

// ---------------- الوثائق ----------------

export class SectionDto {
  @Text(200) @MinLength(1, { message: 'اكتب عنوان القسم' })
  title!: string;

  @IsString() @MaxLength(20000)
  body!: string;
}

export class DocumentDto {
  @Nullable() @trim() @Matches(CODE_RE, { message: 'كود الوثيقة حروف إنجليزية وأرقام وشرطات، مثل QP-QMS-01' })
  code?: string | null;

  @Text(250) @MinLength(3, { message: 'اكتب عنوان الوثيقة' })
  title!: string;

  @IsIn(DOC_TYPES, { message: 'نوع الوثيقة غير صحيح' })
  docType!: (typeof DOC_TYPES)[number];

  @trim() @IsString() @MaxLength(20)
  department!: string;

  @IsArray() @ArrayMaxSize(30) @IsString({ each: true })
  isoClauses!: string[];

  @Nullable() @Text(200)
  ownerName?: string | null;

  @IsArray() @ArrayMaxSize(40) @ValidateNested({ each: true }) @Type(() => SectionDto)
  sections!: SectionDto[];

  @IsOptional() @IsArray() @ArrayMaxSize(40) @IsString({ each: true })
  relatedCodes?: string[];

  @Nullable() @Text(300)
  retention?: string | null;

  @Nullable() @Text(1000)
  changeSummary?: string | null;
}

export class DocActionDto {
  @IsIn(['submit', 'pass', 'return', 'approve', 'revise', 'obsolete'])
  action!: 'submit' | 'pass' | 'return' | 'approve' | 'revise' | 'obsolete';

  @Nullable() @Text(1000)
  note?: string | null;
}

export class DistributeDto {
  @IsArray() @ArrayMaxSize(50) @IsString({ each: true }) @MaxLength(200, { each: true })
  holders!: string[];
}

export class MapStepDto {
  @IsString() @MaxLength(20)
  id!: string;

  @IsIn(['start', 'task', 'decision', 'document', 'end'])
  kind!: 'start' | 'task' | 'decision' | 'document' | 'end';

  @Text(200) @MinLength(1, { message: 'اكتب وصف كل خطوة في الخريطة' })
  label!: string;

  @Type(() => Number) @IsInt() @Min(0)
  lane!: number;

  @Nullable() @trim() @IsString() @MaxLength(50)
  docCode?: string | null;

  @IsArray() @ArrayMaxSize(6)
  next!: { to: string; label?: string | null }[];
}

export class ProcessMapDto {
  @Nullable() @trim() @Matches(CODE_RE, { message: 'كود الخريطة غير صحيح' })
  code?: string | null;

  @Text(250) @MinLength(3, { message: 'اكتب عنوان الخريطة' })
  title!: string;

  @Nullable() @Text(1000)
  description?: string | null;

  @Nullable() @IsString()
  documentId?: string | null;

  @IsArray() @ArrayMaxSize(8) @IsString({ each: true }) @MaxLength(80, { each: true })
  lanes!: string[];

  @IsArray() @ArrayMaxSize(60) @ValidateNested({ each: true }) @Type(() => MapStepDto)
  steps!: MapStepDto[];
}

// ---------------- المراجعة الداخلية ----------------

export class ChecklistItemDto {
  @trim() @IsString() @MaxLength(20)
  clause!: string;

  @Text(500) @MinLength(3, { message: 'اكتب سؤال التحقق' })
  question!: string;

  @Nullable() @IsIn(AUDIT_RESULTS)
  result?: (typeof AUDIT_RESULTS)[number] | null;

  @Nullable() @Text(2000)
  evidence?: string | null;
}

export class AuditDto {
  @Text(250) @MinLength(3, { message: 'اكتب عنوان المراجعة' })
  title!: string;

  @Text(300) @MinLength(2, { message: 'حدد العملية محل المراجعة' })
  scope!: string;

  @trim() @IsString() @MaxLength(20)
  department!: string;

  @IsArray() @ArrayMaxSize(40) @IsString({ each: true })
  clauses!: string[];

  @Text(200) @MinLength(2, { message: 'اكتب اسم رئيس فريق المراجعة' })
  leadAuditor!: string;

  @Nullable() @Text(400)
  auditors?: string | null;

  @Nullable() @Text(200)
  auditeeName?: string | null;

  @DateField('تاريخ المراجعة غير صحيح')
  plannedDate!: string;

  @IsOptional() @IsArray() @ArrayMaxSize(80) @ValidateNested({ each: true }) @Type(() => ChecklistItemDto)
  checklist?: ChecklistItemDto[];
}

export class AuditExecDto {
  @IsArray() @ArrayMaxSize(80) @ValidateNested({ each: true }) @Type(() => ChecklistItemDto)
  checklist!: ChecklistItemDto[];

  @Nullable() @Text(5000)
  summary?: string | null;

  @Nullable() @DateField('تاريخ التنفيذ غير صحيح')
  actualDate?: string | null;

  /** true = إنهاء المراجعة وإصدار حالات عدم المطابقة لنتائجها */
  @IsOptional() @IsBoolean()
  complete?: boolean;
}

// ---------------- عدم المطابقة ----------------

export class NcrDto {
  @IsIn(NCR_SOURCES, { message: 'مصدر الحالة غير صحيح' })
  source!: (typeof NCR_SOURCES)[number];

  @Nullable() @Text(100)
  sourceRef?: string | null;

  @Text(250) @MinLength(3, { message: 'اكتب عنوان الحالة' })
  title!: string;

  @Text(5000) @MinLength(5, { message: 'اكتب وصف عدم المطابقة' })
  description!: string;

  @Nullable() @Text(20)
  clause?: string | null;

  @IsIn(['minor', 'major'])
  severity!: 'minor' | 'major';

  @trim() @IsString() @MaxLength(20)
  department!: string;

  @DateField('تاريخ الاكتشاف غير صحيح')
  detectedDate!: string;

  @Nullable() @DateField('تاريخ الإغلاق المستهدف غير صحيح')
  dueDate?: string | null;

  @Nullable() @Text(50)
  relatedCode?: string | null;
}

export class ActionItemDto {
  @IsOptional() @IsString() @MaxLength(20)
  id?: string;

  @Text(500) @MinLength(3, { message: 'اكتب وصف الإجراء' })
  title!: string;

  @Text(200) @MinLength(2, { message: 'حدد المسؤول عن كل إجراء' })
  ownerName!: string;

  @Nullable() @DateField('تاريخ الإجراء غير صحيح')
  dueDate?: string | null;

  @IsIn(['open', 'done'])
  status!: 'open' | 'done';

  @Nullable() @Text(1000)
  note?: string | null;
}

export class NcrAnalysisDto {
  @Nullable() @Text(5000)
  correction?: string | null;

  @IsIn(['five_whys', 'fishbone'])
  rcaMethod!: 'five_whys' | 'fishbone';

  @IsArray() @ArrayMaxSize(7) @IsString({ each: true }) @MaxLength(500, { each: true })
  whys!: string[];

  @Nullable() @IsObject()
  fishbone?: Record<string, string> | null;

  @Nullable() @Text(3000)
  rootCause?: string | null;

  @IsArray() @ArrayMaxSize(20) @ValidateNested({ each: true }) @Type(() => ActionItemDto)
  actions!: ActionItemDto[];

  @IsOptional() @IsBoolean()
  needsRiskUpdate?: boolean;

  @Nullable() @Text(50)
  relatedCode?: string | null;
}

export class VerifyDto {
  @IsIn(['effective', 'not_effective'])
  result!: 'effective' | 'not_effective';

  @Nullable() @Text(2000)
  note?: string | null;
}

// ---------------- المخاطر والأهداف ----------------

export class RiskDto {
  @IsIn(['risk', 'opportunity'])
  kind!: 'risk' | 'opportunity';

  @Text(250) @MinLength(3, { message: 'اكتب وصف الخطر أو الفرصة' })
  title!: string;

  @Text(200) @MinLength(2, { message: 'حدد العملية' })
  process!: string;

  @trim() @IsString() @MaxLength(20)
  department!: string;

  @Nullable() @Text(1000)
  cause?: string | null;

  @Nullable() @Text(1000)
  consequence?: string | null;

  @Rating()
  likelihood!: number;

  @Rating()
  impact!: number;

  @IsIn(RISK_TREATMENTS, { message: 'طريقة المعالجة غير صحيحة' })
  treatment!: string;

  @IsArray() @ArrayMaxSize(20) @ValidateNested({ each: true }) @Type(() => ActionItemDto)
  actions!: ActionItemDto[];

  @Text(200) @MinLength(2, { message: 'حدد مالك الخطر' })
  ownerName!: string;

  @Nullable() @Rating()
  residualLikelihood?: number | null;

  @Nullable() @Rating()
  residualImpact?: number | null;

  @IsIn(['open', 'treated', 'closed'])
  status!: 'open' | 'treated' | 'closed';

  @Nullable() @DateField('تاريخ المراجعة غير صحيح')
  reviewDate?: string | null;
}

export class ObjectiveDto {
  @Type(() => Number) @IsInt() @Min(2000) @Max(2100)
  year!: number;

  @Text(300) @MinLength(3, { message: 'اكتب الهدف' })
  title!: string;

  @Text(300) @MinLength(3, { message: 'اكتب المؤشر الذي يقيس الهدف' })
  kpi!: string;

  @Text(30) @MinLength(1, { message: 'حدد وحدة القياس' })
  unit!: string;

  @Nullable() @Type(() => Number) @IsNumber()
  baseline?: number | null;

  @Type(() => Number) @IsNumber({}, { message: 'المستهدف رقم' })
  target!: number;

  @IsIn(['increase', 'decrease'])
  direction!: 'increase' | 'decrease';

  @IsIn(OBJ_FREQUENCIES)
  frequency!: string;

  @Nullable() @IsIn(AUTO_METRICS)
  autoMetric?: (typeof AUTO_METRICS)[number] | null;

  @trim() @IsString() @MaxLength(20)
  department!: string;

  @Text(200) @MinLength(2, { message: 'حدد المسؤول عن الهدف' })
  ownerName!: string;

  @Nullable() @Text(2000)
  plan?: string | null;

  @IsOptional() @IsBoolean()
  isActive?: boolean;
}

export class MeasurementDto {
  @trim() @Matches(/^\d{4}(-(0[1-9]|1[0-2]|Q[1-4]|H[12]))?$/, { message: 'الفترة بالشكل 2026-03 أو 2026-Q1 أو 2026-H1 أو 2026' })
  period!: string;

  @Type(() => Number) @IsNumber({}, { message: 'القيمة رقم' })
  value!: number;

  @Nullable() @Text(500)
  note?: string | null;
}

// ---------------- مراجعة الإدارة ----------------

export class ReviewOutputDto {
  @IsOptional() @IsString() @MaxLength(20)
  id?: string;

  @IsIn(['improvement', 'change', 'resources'])
  type!: 'improvement' | 'change' | 'resources';

  @Text(1000) @MinLength(3, { message: 'اكتب القرار' })
  decision!: string;

  @Text(200) @MinLength(2, { message: 'حدد المسؤول عن القرار' })
  ownerName!: string;

  @Nullable() @DateField('تاريخ القرار غير صحيح')
  dueDate?: string | null;

  @IsIn(['open', 'done'])
  status!: 'open' | 'done';
}

export class ReviewInputDto {
  @IsString() @MaxLength(30)
  key!: string;

  @Text(200)
  title!: string;

  @IsString() @MaxLength(5000)
  summary!: string;
}

export class ReviewDto {
  @Text(250) @MinLength(3, { message: 'اكتب عنوان الاجتماع' })
  title!: string;

  @DateField('تاريخ الاجتماع غير صحيح')
  meetingDate!: string;

  @Text(200) @MinLength(2, { message: 'اكتب اسم رئيس الاجتماع' })
  chairName!: string;

  @Nullable() @Text(1000)
  attendees?: string | null;

  @IsOptional() @IsArray() @ArrayMaxSize(20) @ValidateNested({ each: true }) @Type(() => ReviewInputDto)
  inputs?: ReviewInputDto[];

  @IsOptional() @IsArray() @ArrayMaxSize(40) @ValidateNested({ each: true }) @Type(() => ReviewOutputDto)
  outputs?: ReviewOutputDto[];

  @Nullable() @Text(10000)
  minutes?: string | null;
}

// ---------------- الشكاوى والاستبانات ----------------

export class ComplaintDto {
  @IsIn(COMPLAINT_CHANNELS, { message: 'قناة الشكوى غير صحيحة' })
  channel!: string;

  @IsIn(PARTY_TYPES, { message: 'نوع صاحب الشكوى غير صحيح' })
  partyType!: string;

  @Nullable() @Text(200)
  complainantName?: string | null;

  @Nullable() @Text(120)
  contact?: string | null;

  @Text(250) @MinLength(3, { message: 'اكتب موضوع الشكوى' })
  subject!: string;

  @Text(5000) @MinLength(3, { message: 'اكتب تفاصيل الشكوى' })
  details!: string;

  @Nullable() @Text(100)
  category?: string | null;

  @trim() @IsString() @MaxLength(20)
  department!: string;

  @DateField('تاريخ الاستلام غير صحيح')
  receivedDate!: string;

  @Nullable() @Text(200)
  assignedTo?: string | null;
}

export class ComplaintActionDto {
  @IsIn(['investigate', 'resolve', 'close', 'reject', 'ncr'])
  action!: 'investigate' | 'resolve' | 'close' | 'reject' | 'ncr';

  @Nullable() @Text(5000)
  investigation?: string | null;

  @Nullable() @Text(5000)
  response?: string | null;

  @Nullable() @Rating()
  satisfaction?: number | null;

  @Nullable() @Text(200)
  assignedTo?: string | null;

  @IsOptional() @IsIn(['minor', 'major'])
  severity?: 'minor' | 'major';
}

export class SurveyQuestionDto {
  @IsOptional() @IsString() @MaxLength(20)
  id?: string;

  @Text(400) @MinLength(3, { message: 'اكتب نص كل سؤال' })
  text!: string;

  @IsIn(['rating', 'choice', 'text'])
  type!: 'rating' | 'choice' | 'text';

  @IsOptional() @IsArray() @ArrayMaxSize(10) @IsString({ each: true }) @MaxLength(120, { each: true })
  options?: string[];
}

export class SurveyDto {
  @Text(250) @MinLength(3, { message: 'اكتب عنوان الاستبانة' })
  title!: string;

  @IsIn(PARTY_TYPES, { message: 'الفئة المستهدفة غير صحيحة' })
  audience!: string;

  @Nullable() @Text(1000)
  description?: string | null;

  @Nullable() @Text(50)
  formCode?: string | null;

  @IsArray() @ArrayMaxSize(40) @ValidateNested({ each: true }) @Type(() => SurveyQuestionDto)
  questions!: SurveyQuestionDto[];

  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(100000)
  targetResponses?: number;
}

export class SurveyStatusDto {
  @IsIn(['draft', 'open', 'closed'])
  status!: 'draft' | 'open' | 'closed';
}

export class SurveyAnswerDto {
  @IsObject({ message: 'أجب عن الأسئلة' })
  answers!: Record<string, string | number>;

  @Nullable() @Text(200)
  respondentName?: string | null;
}
