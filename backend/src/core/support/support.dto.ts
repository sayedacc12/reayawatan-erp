import { Transform, Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsEmail, IsIn, IsISO8601, IsInt, IsNumber, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, MinLength, ValidateNested } from 'class-validator';
import { IsValidPassword } from '../validation';
import { PLATFORM_ROLES, PlatformRole } from './support.manifest';
import { CATEGORIES, Category, PRIORITIES, Priority, TICKET_STATUSES } from './sla';

const trim = () => Transform(({ value }) => (typeof value === 'string' ? value.trim() : value));
const emptyToUndefined = () => Transform(({ value }) => (value === '' || value === null ? undefined : value));
const toBool = () => Transform(({ value }) => value === true || value === 'true' || value === '1');

/** طلب صيانة جديد من الجمعية (multipart مع مرفق اختياري) */
export class CreateTicketDto {
  @trim() @IsString() @MinLength(5, { message: 'اكتب عنوانًا واضحًا للطلب' }) @MaxLength(200)
  subject!: string;

  @trim() @IsString() @MinLength(10, { message: 'اشرح المشكلة بتفصيل أكثر (10 أحرف على الأقل)' }) @MaxLength(5000)
  description!: string;

  @IsIn(CATEGORIES, { message: 'نوع الطلب غير صحيح' })
  category!: Category;

  @IsIn(PRIORITIES, { message: 'مستوى الخدمة غير صحيح' })
  priority!: Priority;

  @emptyToUndefined() @IsOptional() @trim() @IsString() @MaxLength(200)
  screen?: string;

  @emptyToUndefined() @IsOptional() @trim() @Matches(/^\+?[0-9 ]{9,16}$/, { message: 'رقم الجوال غير صحيح' })
  contactPhone?: string;
}

export class MessageDto {
  @trim() @IsString() @MinLength(2, { message: 'اكتب نص الرسالة' }) @MaxLength(5000)
  body!: string;

  /** ملاحظة داخلية لفريق المنصة فقط */
  @IsOptional() @toBool() @IsBoolean()
  internal?: boolean;

  /** المنصة: تغيير الحالة مع الرد (مثل: بانتظار رد الجمعية، تم الحل) */
  @emptyToUndefined() @IsOptional() @IsIn(['in_progress', 'waiting_customer', 'resolved'], { message: 'الحالة غير صحيحة' })
  status?: 'in_progress' | 'waiting_customer' | 'resolved';
}

export class UpdateTicketDto {
  @IsOptional() @IsIn(TICKET_STATUSES.filter((s) => s !== 'new' && s !== 'closed'), { message: 'الحالة غير صحيحة' })
  status?: 'in_progress' | 'waiting_customer' | 'resolved';

  @IsOptional() @IsIn(PRIORITIES, { message: 'مستوى الخدمة غير صحيح' })
  priority?: Priority;

  @IsOptional() @trim() @IsString() @MaxLength(500)
  priorityReason?: string;

  @IsOptional() @IsUUID('all', { message: 'المسؤول غير صحيح' })
  assigneeId?: string;
}

export class CloseDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(5)
  rating?: number;

  @IsOptional() @trim() @IsString() @MaxLength(1000)
  note?: string;
}

export class EscalateDto {
  @trim() @IsString() @MinLength(3, { message: 'اكتب سبب التصعيد' }) @MaxLength(1000)
  note!: string;
}

export class SlaLevelDto {
  @IsIn(PRIORITIES) priority!: Priority;
  @trim() @IsString() @MinLength(2) @MaxLength(50) name!: string;
  @Type(() => Number) @IsNumber() @Min(0.25, { message: 'أقل مهلة ربع ساعة' }) @Max(2000) responseHours!: number;
  @Type(() => Number) @IsNumber() @Min(0.5) @Max(5000) resolutionHours!: number;
  @trim() @IsString() @MaxLength(1000) description!: string;
  @IsArray() @ArrayMaxSize(20) @IsString({ each: true }) examples!: string[];
  @IsArray() @ArrayMaxSize(20) @IsString({ each: true }) handling!: string[];
  @trim() @IsString() @MaxLength(1000) escalation!: string;
}

export class SlaDto {
  @IsArray() @ValidateNested({ each: true }) @Type(() => SlaLevelDto)
  levels!: SlaLevelDto[];
}

// ---------- المهام والتكليفات ----------

export class CreateTaskDto {
  @trim() @IsString() @MinLength(3, { message: 'اكتب عنوانًا للمهمة' }) @MaxLength(200)
  title!: string;

  @IsOptional() @trim() @IsString() @MaxLength(5000)
  description?: string;

  @emptyToUndefined() @IsOptional() @IsUUID('all', { message: 'الطلب غير صحيح' })
  ticketId?: string;

  @IsUUID('all', { message: 'اختر المكلَّف بالمهمة' })
  assigneeId!: string;

  @IsOptional() @IsIn(PRIORITIES, { message: 'الأولوية غير صحيحة' })
  priority?: Priority;

  /** موعد التسليم. إن تُرك: موعد حل الطلب المرتبط، أو مهلة الحل لمستوى الأولوية */
  @emptyToUndefined() @IsOptional() @IsISO8601({}, { message: 'موعد التسليم غير صحيح' })
  dueAt?: string;

  @IsOptional() @Type(() => Number) @IsNumber() @Min(0.25) @Max(1000)
  estimatedHours?: number;
}

export class UpdateTaskDto {
  @IsOptional() @IsIn(['todo', 'in_progress', 'done', 'cancelled'], { message: 'الحالة غير صحيحة' })
  status?: 'todo' | 'in_progress' | 'done' | 'cancelled';

  @IsOptional() @IsUUID('all', { message: 'المكلَّف غير صحيح' })
  assigneeId?: string;

  @emptyToUndefined() @IsOptional() @IsISO8601({}, { message: 'موعد التسليم غير صحيح' })
  dueAt?: string;

  @IsOptional() @IsIn(PRIORITIES, { message: 'الأولوية غير صحيحة' })
  priority?: Priority;

  @IsOptional() @trim() @IsString() @MaxLength(1000)
  note?: string;
}

export class LogHoursDto {
  @Type(() => Number) @IsNumber() @Min(0.25, { message: 'أقل مدة ربع ساعة' }) @Max(24, { message: 'أكثر مدة 24 ساعة في المرة' })
  hours!: number;

  @IsOptional() @trim() @IsString() @MaxLength(1000)
  note?: string;
}

// ---------- فريق الدعم ----------

export class CreateMemberDto {
  @trim() @IsString() @MinLength(2, { message: 'الاسم قصير جدًا' }) @MaxLength(200)
  fullName!: string;

  @IsEmail({}, { message: 'البريد الإلكتروني غير صحيح' })
  email!: string;

  @IsValidPassword()
  password!: string;

  @IsIn(PLATFORM_ROLES, { message: 'الدور غير صحيح' })
  role!: PlatformRole;
}

export class UpdateMemberDto {
  @IsOptional() @IsIn(PLATFORM_ROLES, { message: 'الدور غير صحيح' })
  role?: PlatformRole;

  @IsOptional() @IsBoolean()
  isActive?: boolean;

  @IsOptional() @IsValidPassword()
  password?: string;
}
