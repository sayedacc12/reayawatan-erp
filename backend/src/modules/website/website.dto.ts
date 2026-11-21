import { Type } from 'class-transformer';
import {
  ArrayMaxSize, IsArray, IsBoolean, IsEmail, IsIn, IsInt, IsISO8601, IsObject, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, MinLength, ValidateNested,
} from 'class-validator';
import { BOOKING_STATUSES, LEAD_STATUSES } from './entities/website.entity';
import { SERVICE_ICONS } from './website-defaults';

const PHONE = /^[0-9+\s()-]{7,20}$/;

/** حقول التواصل المشتركة في كل نماذج الموقع */
class VisitorDto {
  @IsString() @MinLength(2, { message: 'اكتبوا الاسم' }) @MaxLength(160)
  name!: string;

  @IsEmail({}, { message: 'البريد الإلكتروني غير صحيح' }) @MaxLength(200)
  email!: string;

  @IsOptional() @IsString() @MaxLength(200)
  orgName?: string;

  @IsOptional() @IsString() @Matches(PHONE, { message: 'رقم الجوال غير صحيح' })
  phone?: string;

  @IsOptional() @IsString() @MaxLength(60)
  orgType?: string;

  /** حقل مخفي لاصطياد البرامج الآلية: الإنسان لا يراه فيتركه فارغًا */
  @IsOptional() @IsString() @MaxLength(200)
  website?: string;

  /** الصفحة ومصدر الزيارة */
  @IsOptional() @IsString() @MaxLength(300)
  page?: string;

  @IsOptional() @IsString() @MaxLength(120)
  utm?: string;
}

export class CalculatorInputDto {
  @Type(() => Number) @IsInt() @Min(10_000) @Max(1_000_000_000)
  budget!: number;

  @Type(() => Number) @IsInt() @Min(10) @Max(1_000_000)
  cost!: number;

  @Type(() => Number) @IsInt() @Min(1) @Max(50)
  efficiency!: number;
}

export class AssessmentInputDto {
  @IsArray() @ArrayMaxSize(20) @IsInt({ each: true }) @Min(0, { each: true }) @Max(2, { each: true })
  answers!: number[];
}

/** نموذج عام: طلب استشارة، أو إرسال نتيجة الحاسبة أو التقييم */
export class LeadSubmitDto extends VisitorDto {
  @IsIn(['consultation', 'calculator', 'assessment'])
  source!: 'consultation' | 'calculator' | 'assessment';

  @IsOptional() @IsString() @MaxLength(60)
  serviceSlug?: string;

  @IsOptional() @IsString() @MaxLength(4000)
  message?: string;

  @IsOptional() @ValidateNested() @Type(() => CalculatorInputDto)
  calculator?: CalculatorInputDto;

  @IsOptional() @ValidateNested() @Type(() => AssessmentInputDto)
  assessment?: AssessmentInputDto;
}

export class GuideRequestDto extends VisitorDto {}

export class BookingRequestDto extends VisitorDto {
  @IsISO8601({ strict: true }, { message: 'اختاروا موعدًا' })
  startsAt!: string;

  @IsOptional() @IsString() @MaxLength(300)
  topic?: string;

  @IsOptional() @ValidateNested() @Type(() => CalculatorInputDto)
  calculator?: CalculatorInputDto;

  @IsOptional() @ValidateNested() @Type(() => AssessmentInputDto)
  assessment?: AssessmentInputDto;
}

export class CancelBookingDto {
  @IsOptional() @IsString() @MaxLength(500)
  reason?: string;
}

// ---------------- لوحة التحكم ----------------

export class LeadQueryDto {
  @IsOptional() @IsIn([...LEAD_STATUSES, 'open'])
  status?: string;

  @IsOptional() @IsIn(['consultation', 'calculator', 'assessment', 'guide', 'booking'])
  source?: string;

  @IsOptional() @IsString() @MaxLength(100)
  q?: string;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(1000)
  page?: number;
}

export class LeadUpdateDto {
  @IsOptional() @IsIn(LEAD_STATUSES)
  status?: string;

  @IsOptional() @IsUUID('all', { message: 'الموظف غير صحيح' })
  assignedTo?: string | null;

  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/)
  nextActionOn?: string | null;

  @IsOptional() @IsString() @MaxLength(4000)
  note?: string;
}

export class BookingQueryDto {
  @IsOptional() @IsIn(['upcoming', 'past', 'all'])
  when?: string;

  @IsOptional() @IsIn(BOOKING_STATUSES)
  status?: string;
}

export class BookingUpdateDto {
  @IsOptional() @IsIn(BOOKING_STATUSES)
  status?: string;

  @IsOptional() @Matches(/^https:\/\/[^\s]{4,490}$/, { message: 'رابط الاجتماع يبدأ بـ https://' })
  meetingUrl?: string | null;

  @IsOptional() @IsUUID('all')
  consultantId?: string | null;

  @IsOptional() @IsString() @MaxLength(500)
  reason?: string;

  /** إبلاغ العميل بالتأكيد أو الإلغاء على بريده */
  @IsOptional() @IsBoolean()
  notifyVisitor?: boolean;
}

/** قسم محتوى كامل. التحقق من شكل كل قسم في الخدمة (قائمة الحقول المسموحة لكل قسم) */
export class SectionDto {
  @IsObject()
  data!: Record<string, unknown>;
}

class ItemDto {
  @IsString() @MaxLength(200) title!: string;
  @IsString() @MaxLength(1000) desc!: string;
}
class ShiftDto {
  @IsString() @MaxLength(300) from!: string;
  @IsString() @MaxLength(300) to!: string;
}

export class ServiceDto {
  @Matches(/^[a-z0-9](?:[a-z0-9-]{0,58}[a-z0-9])?$/, { message: 'المعرف بحروف إنجليزية صغيرة وأرقام وشرطة فقط' })
  slug!: string;

  @IsString() @MinLength(2) @MaxLength(160) title!: string;
  @IsString() @MaxLength(60) stage!: string;
  @IsIn(SERVICE_ICONS) icon!: string;
  @IsString() @MaxLength(600) short!: string;
  @IsString() @MaxLength(3000) intro!: string;
  @IsString() @MaxLength(600) value!: string;

  @IsArray() @ArrayMaxSize(12) @ValidateNested({ each: true }) @Type(() => ItemDto)
  deliverables!: ItemDto[];

  @IsArray() @ArrayMaxSize(12) @IsString({ each: true }) @MaxLength(120, { each: true })
  audience!: string[];

  @IsArray() @ArrayMaxSize(10) @ValidateNested({ each: true }) @Type(() => ItemDto)
  steps!: ItemDto[];

  @IsArray() @ArrayMaxSize(8) @ValidateNested({ each: true }) @Type(() => ShiftDto)
  shifts!: ShiftDto[];

  @IsArray() @ArrayMaxSize(10) @IsString({ each: true }) @MaxLength(200, { each: true })
  kpis!: string[];

  @IsBoolean() featured!: boolean;
  @IsBoolean() published!: boolean;
}

export class OrderDto {
  @IsArray() @ArrayMaxSize(100) @IsUUID('all', { each: true })
  ids!: string[];
}

export class GuideDto {
  @Matches(/^[a-z0-9](?:[a-z0-9-]{0,78}[a-z0-9])?$/, { message: 'المعرف بحروف إنجليزية صغيرة وأرقام وشرطة فقط' })
  slug!: string;

  @IsString() @MinLength(2) @MaxLength(200) title!: string;
  @IsString() @MaxLength(1500) summary!: string;

  @IsOptional() @IsString() @MaxLength(60)
  serviceSlug?: string | null;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(2000)
  pages?: number | null;

  @IsBoolean() published!: boolean;
}
