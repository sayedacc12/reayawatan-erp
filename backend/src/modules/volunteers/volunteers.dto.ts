import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize, IsArray, IsBoolean, IsDateString, IsEmail, IsIn, IsInt, IsNumber, IsObject, IsOptional, IsString, IsUUID, Matches, Max,
  MaxLength, Min, MinLength, ValidateIf, ValidateNested,
} from 'class-validator';

const trim = () => Transform(({ value }) => (typeof value === 'string' ? value.trim() || null : value));
const Nullable = (): PropertyDecorator => (t, k) => [IsOptional(), ValidateIf((_: unknown, v: unknown) => v !== null && v !== '')].forEach((d) => d(t, k));
const DateField = (msg: string) => IsDateString({ strict: true }, { message: msg });
const digits = () => Transform(({ value }) => (typeof value === 'string' ? value.replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660)).replace(/\s/g, '') : value));

// ---------------- المتطوع ----------------

export class VolunteerDto {
  @trim() @IsString() @MinLength(3, { message: 'اكتب الاسم الكامل' }) @MaxLength(200)
  fullName!: string;

  @digits() @Matches(/^[12]\d{9}$/, { message: 'رقم الهوية أو الإقامة 10 أرقام ويبدأ بـ 1 أو 2' })
  nationalId!: string;

  @digits() @Matches(/^(05\d{8}|\+?9665\d{8})$/, { message: 'رقم الجوال غير صحيح، مثال: 0501234567' })
  mobile!: string;

  @Nullable() @trim() @IsEmail({}, { message: 'البريد الإلكتروني غير صحيح' }) @MaxLength(200)
  email?: string | null;

  @IsIn(['male', 'female'], { message: 'اختر الجنس' })
  gender!: 'male' | 'female';

  @Nullable() @DateField('تاريخ الميلاد غير صحيح')
  birthDate?: string | null;

  @Nullable() @trim() @IsString() @MaxLength(100)
  city?: string | null;

  @Nullable() @trim() @IsString() @MaxLength(100)
  qualification?: string | null;

  @Nullable() @IsString() @MaxLength(40)
  typeCode?: string | null;

  @IsOptional() @IsArray() @ArrayMaxSize(20) @IsString({ each: true })
  fieldCodes?: string[];

  @Nullable() @trim() @IsString() @MaxLength(1000)
  skills?: string | null;

  @IsOptional() @IsArray() @ArrayMaxSize(10) @IsString({ each: true }) @MaxLength(40, { each: true })
  availability?: string[];

  @IsOptional() @IsObject()
  answers?: Record<string, unknown>;
}

/** التسجيل من الصفحة العامة: نفس البيانات مع الموافقة على الميثاق */
export class PublicVolunteerDto extends VolunteerDto {
  @IsBoolean() @IsIn([true], { message: 'يجب الموافقة على ميثاق التطوع' })
  acceptCharter!: boolean;
}

export class VolunteerStatusDto {
  @IsIn(['active', 'inactive', 'rejected'], { message: 'الحالة غير صحيحة' })
  status!: 'active' | 'inactive' | 'rejected';

  @Nullable() @trim() @IsString() @MaxLength(1000)
  note?: string | null;
}

// ---------------- الفعالية ----------------

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

export class EventDto {
  @trim() @IsString() @MinLength(3, { message: 'اكتب اسم الفعالية' }) @MaxLength(250)
  title!: string;

  @IsIn(['field', 'online'], { message: 'اختر نوع الفعالية: ميدانية أو عن بعد' })
  kind!: 'field' | 'online';

  @Nullable() @IsString() @MaxLength(40)
  categoryCode?: string | null;

  @IsOptional() @IsArray() @ArrayMaxSize(20) @IsString({ each: true })
  fieldCodes?: string[];

  @Nullable() @trim() @IsString() @MaxLength(5000)
  description?: string | null;

  @Nullable() @trim() @IsString() @MaxLength(5000)
  objectives?: string | null;

  @Nullable() @trim() @IsString() @MaxLength(300)
  location?: string | null;

  @Nullable() @trim() @IsString() @MaxLength(100)
  platform?: string | null;

  @Nullable() @trim() @Matches(/^https?:\/\/\S+$/i, { message: 'رابط الفعالية يجب أن يبدأ بـ https://' }) @MaxLength(500)
  onlineLink?: string | null;

  @DateField('تاريخ بداية الفعالية غير صحيح')
  startDate!: string;

  @DateField('تاريخ نهاية الفعالية غير صحيح')
  endDate!: string;

  @Nullable() @Matches(TIME, { message: 'وقت البداية غير صحيح' })
  startTime?: string | null;

  @Nullable() @Matches(TIME, { message: 'وقت النهاية غير صحيح' })
  endTime?: string | null;

  @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }, { message: 'الساعات التطوعية غير صحيحة' }) @Min(0) @Max(1000)
  plannedHours!: number;

  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(100000)
  volunteersNeeded?: number;

  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(10000000)
  targetBeneficiaries?: number;

  @IsOptional() @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0)
  budget?: number;

  @Nullable() @trim() @IsString() @MaxLength(200)
  supervisorName?: string | null;

  @IsOptional() @IsObject()
  answers?: Record<string, unknown>;
}

export class DecisionDto {
  @IsIn(['approve', 'return', 'reject'], { message: 'القرار غير صحيح' })
  decision!: 'approve' | 'return' | 'reject';

  @Nullable() @trim() @IsString() @MaxLength(1000)
  note?: string | null;
}

export class ParticipantsDto {
  @IsArray() @ArrayMaxSize(500) @IsUUID('all', { each: true })
  volunteerIds!: string[];

  @Nullable() @trim() @IsString() @MaxLength(100)
  role?: string | null;
}

class AttendanceRow {
  @IsUUID()
  id!: string;

  @IsIn(['registered', 'attended', 'absent'])
  status!: 'registered' | 'attended' | 'absent';

  @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }, { message: 'الساعات غير صحيحة' }) @Min(0) @Max(1000)
  hours!: number;

  @Nullable() @Type(() => Number) @IsInt() @Min(1) @Max(5)
  rating?: number | null;

  @Nullable() @trim() @IsString() @MaxLength(100)
  role?: string | null;

  @Nullable() @trim() @IsString() @MaxLength(500)
  note?: string | null;
}

export class AttendanceDto {
  @IsArray() @ArrayMaxSize(500) @ValidateNested({ each: true }) @Type(() => AttendanceRow)
  rows!: AttendanceRow[];
}

export class ClosureDto {
  @Type(() => Number) @IsInt({ message: 'عدد المستفيدين الفعلي غير صحيح' }) @Min(0)
  actualBeneficiaries!: number;

  @trim() @IsString() @MinLength(10, { message: 'اكتب ملخص تنفيذ الفعالية (10 أحرف على الأقل)' }) @MaxLength(5000)
  closureSummary!: string;

  @Nullable() @trim() @IsString() @MaxLength(5000)
  achievements?: string | null;

  @Nullable() @trim() @IsString() @MaxLength(5000)
  challenges?: string | null;

  @Nullable() @trim() @IsString() @MaxLength(5000)
  recommendations?: string | null;

  @Nullable() @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0)
  actualCost?: number | null;

  @IsOptional() @IsObject()
  closureAnswers?: Record<string, unknown>;

  /** إصدار استبانة الرضا مع الإغلاق */
  @IsOptional() @IsBoolean()
  openSurvey?: boolean;
}

export class SurveyAnswerDto {
  @IsIn(['volunteer', 'beneficiary'], { message: 'اختر صفتك في الفعالية' })
  audience!: 'volunteer' | 'beneficiary';

  @Nullable() @trim() @IsString() @MaxLength(200)
  respondentName?: string | null;

  @IsObject({ message: 'الإجابات غير مكتملة' })
  answers!: Record<string, unknown>;
}

// ---------------- الشهادات والعقود ----------------

export class CertificateDto {
  @IsUUID('all', { message: 'اختر المتطوع' })
  volunteerId!: string;

  @IsIn(['hours', 'thanks'], { message: 'اختر نوع الشهادة' })
  kind!: 'hours' | 'thanks';

  /** شهادة لفعالية واحدة، أو لكل الفعاليات خلال فترة */
  @Nullable() @IsUUID()
  eventId?: string | null;

  @Nullable() @DateField('تاريخ بداية الفترة غير صحيح')
  periodFrom?: string | null;

  @Nullable() @DateField('تاريخ نهاية الفترة غير صحيح')
  periodTo?: string | null;
}

export class ContractDto {
  @IsUUID('all', { message: 'اختر المتطوع' })
  volunteerId!: string;

  @DateField('تاريخ بداية العقد غير صحيح')
  startDate!: string;

  @DateField('تاريخ نهاية العقد غير صحيح')
  endDate!: string;
}

export class SignContractDto {
  @trim() @IsString() @MinLength(3, { message: 'اكتب اسمك الكامل للتوقيع' }) @MaxLength(200)
  signedName!: string;

  @IsBoolean() @IsIn([true], { message: 'يجب الموافقة على بنود العقد' })
  accept!: boolean;
}

// ---------------- الشكاوى ----------------

export class TicketDto {
  @IsIn(['complaint', 'suggestion', 'inquiry'], { message: 'اختر النوع: شكوى أو مقترح أو استفسار' })
  kind!: 'complaint' | 'suggestion' | 'inquiry';

  @trim() @IsString() @MinLength(3, { message: 'اكتب الاسم' }) @MaxLength(200)
  senderName!: string;

  @Nullable() @digits() @Matches(/^(05\d{8}|\+?9665\d{8})$/, { message: 'رقم الجوال غير صحيح، مثال: 0501234567' })
  senderMobile?: string | null;

  @Nullable() @trim() @IsEmail({}, { message: 'البريد الإلكتروني غير صحيح' })
  senderEmail?: string | null;

  @IsOptional() @IsIn(['volunteer', 'beneficiary', 'other'])
  senderType?: 'volunteer' | 'beneficiary' | 'other';

  @Nullable() @IsUUID()
  volunteerId?: string | null;

  @Nullable() @IsUUID()
  eventId?: string | null;

  @trim() @IsString() @MinLength(3, { message: 'اكتب الموضوع' }) @MaxLength(250)
  subject!: string;

  @trim() @IsString() @MinLength(5, { message: 'اكتب التفاصيل' }) @MaxLength(5000)
  body!: string;
}

export class TicketReplyDto {
  @trim() @IsString() @MinLength(2, { message: 'اكتب الرد' }) @MaxLength(5000)
  reply!: string;

  @IsIn(['in_progress', 'closed'], { message: 'الحالة غير صحيحة' })
  status!: 'in_progress' | 'closed';
}

// ---------------- اللائحة والميثاق والإعدادات ----------------

export class DocumentDto {
  @trim() @IsString() @MinLength(3, { message: 'اكتب عنوان الوثيقة' }) @MaxLength(200)
  title!: string;

  @IsArray({ message: 'أضف أقسام الوثيقة' })
  sections!: unknown[];

  @DateField('تاريخ الاعتماد غير صحيح')
  effectiveDate!: string;

  @Nullable() @trim() @IsString() @MaxLength(1000)
  note?: string | null;
}

export class SettingsDto {
  @IsObject({ message: 'بيانات الإعدادات غير صحيحة' })
  data!: Record<string, unknown>;
}
