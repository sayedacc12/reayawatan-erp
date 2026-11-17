import { BadRequestException } from '@nestjs/common';
import { plainToInstance, Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize, IsArray, IsDateString, IsEmail, IsIn, IsInt, IsObject, IsOptional, IsString, Matches, Max, MaxLength, Min, MinLength, ValidateIf,
  validate,
} from 'class-validator';

const trim = () => Transform(({ value }) => (typeof value === 'string' ? value.trim() || null : value));
const Nullable = (): PropertyDecorator => (t, k) => [IsOptional(), ValidateIf((_: unknown, v: unknown) => v !== null && v !== '')].forEach((d) => d(t, k));
const DateField = (msg: string) => IsDateString({ strict: true }, { message: msg });
const digits = () => Transform(({ value }) => (typeof value === 'string' ? value.replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660)).replace(/\s/g, '') : value));

/** البيانات الشخصية للمتقدم أو العضو */
export class PersonDto {
  @trim() @IsString({ message: 'اكتب الاسم الكامل' }) @MinLength(3, { message: 'اكتب الاسم الكامل' }) @MaxLength(200)
  fullName!: string;

  @digits() @Matches(/^[12]\d{9}$/, { message: 'رقم الهوية أو الإقامة 10 أرقام ويبدأ بـ 1 أو 2' })
  nationalId!: string;

  @Nullable() @DateField('تاريخ انتهاء الهوية غير صحيح')
  idExpiry?: string | null;

  @trim() @IsString({ message: 'اختر الجنسية' }) @MinLength(2, { message: 'اختر الجنسية' }) @MaxLength(60)
  nationality!: string;

  @IsIn(['male', 'female'], { message: 'اختر الجنس' })
  gender!: 'male' | 'female';

  @Nullable() @DateField('تاريخ الميلاد غير صحيح')
  birthDate?: string | null;

  @digits() @Matches(/^(05\d{8}|\+?9665\d{8})$/, { message: 'رقم الجوال غير صحيح، مثال: 0501234567' })
  mobile!: string;

  @Nullable() @trim() @IsEmail({}, { message: 'البريد الإلكتروني غير صحيح' }) @MaxLength(200)
  email?: string | null;

  @Nullable() @trim() @IsString() @MaxLength(100)
  city?: string | null;

  @Nullable() @trim() @IsString() @MaxLength(300)
  address?: string | null;

  @Nullable() @trim() @IsString() @MaxLength(150)
  occupation?: string | null;

  @Nullable() @trim() @IsString() @MaxLength(200)
  employer?: string | null;

  @Nullable() @trim() @IsString() @MaxLength(100)
  qualification?: string | null;

  @IsString({ message: 'اختر نوع العضوية' }) @MinLength(1, { message: 'اختر نوع العضوية' }) @MaxLength(40)
  typeCode!: string;

  @IsOptional() @IsObject()
  answers?: Record<string, unknown>;
}

/** طلب العضوية: البيانات مع الإقرار بالشروط */
export class ApplicationDto extends PersonDto {
  @IsOptional() @IsArray() @ArrayMaxSize(40) @IsString({ each: true }) @MaxLength(40, { each: true })
  acceptedConditions?: string[];
}

/** إضافة عضو قائم مباشرة (الأعضاء الحاليون قبل استخدام النظام) */
export class DirectMemberDto extends PersonDto {
  @DateField('تاريخ الانضمام غير صحيح')
  joinedOn!: string;

  @DateField('تاريخ بداية العضوية الحالية غير صحيح')
  startDate!: string;

  @Nullable() @DateField('تاريخ نهاية العضوية غير صحيح')
  endDate?: string | null;

  @Nullable() @IsInt({ message: 'رقم العضوية رقم صحيح' }) @Min(1) @Max(9_999_999)
  memberNo?: number | null;
}

export class UpdateMemberDto extends PersonDto {}

export class DecisionDto {
  @IsIn(['approve', 'return', 'reject'], { message: 'القرار غير صحيح' })
  decision!: 'approve' | 'return' | 'reject';

  @Nullable() @trim() @IsString() @MaxLength(1000)
  note?: string | null;
}

export class MemberStatusDto {
  @IsIn(['active', 'suspended', 'terminated'], { message: 'الحالة غير صحيحة' })
  status!: 'active' | 'suspended' | 'terminated';

  @Nullable() @trim() @IsString() @MaxLength(1000)
  note?: string | null;
}

export class ChangeTypeDto {
  @IsString() @MinLength(1, { message: 'اختر نوع العضوية' }) @MaxLength(40)
  typeCode!: string;

  @Nullable() @trim() @IsString() @MaxLength(1000)
  note?: string | null;
}

export class RecordPaymentDto {
  @IsIn(['cash', 'transfer'], { message: 'اختر طريقة السداد' })
  method!: 'cash' | 'transfer';

  @DateField('تاريخ السداد غير صحيح')
  paidOn!: string;

  @Nullable() @trim() @IsString() @MaxLength(120)
  reference?: string | null;
}

export class NoteDto {
  @Nullable() @trim() @IsString() @MaxLength(1000)
  note?: string | null;
}

export class NoticeDto {
  @IsIn(['whatsapp', 'sms', 'email', 'call'], { message: 'اختر وسيلة التنبيه' })
  channel!: 'whatsapp' | 'sms' | 'email' | 'call';

  @trim() @IsString() @MinLength(3, { message: 'اكتب نص التنبيه' }) @MaxLength(3000)
  message!: string;
}

export class SettingsDto {
  @IsObject()
  data!: Record<string, unknown>;
}

/** استعلام العضو عن عضويته من الصفحة العامة */
export class MembershipLookupDto {
  @Type(() => Number) @IsInt({ message: 'اكتب رقم العضوية' }) @Min(1, { message: 'اكتب رقم العضوية' })
  memberNo!: number;

  @digits() @Matches(/^[12]\d{9}$/, { message: 'رقم الهوية أو الإقامة 10 أرقام' })
  nationalId!: string;
}

export class TransferDto {
  @Nullable() @trim() @IsString() @MaxLength(120)
  reference?: string | null;
}

/**
 * يقرأ البيانات المرسلة كنص JSON مع الملفات (multipart) ويتحقق منها بنفس قواعد التحقق.
 */
export async function parseJsonDto<T extends object>(cls: new () => T, raw: unknown): Promise<T> {
  let data: unknown = raw;
  if (typeof raw === 'string') {
    try {
      data = JSON.parse(raw);
    } catch {
      throw new BadRequestException('بيانات الطلب غير صحيحة');
    }
  }
  if (!data || typeof data !== 'object') throw new BadRequestException('بيانات الطلب غير صحيحة');
  const dto = plainToInstance(cls, data);
  const errors = await validate(dto, { whitelist: true, forbidNonWhitelisted: true });
  if (errors.length) {
    const first = (e: (typeof errors)[number]): string => Object.values(e.constraints ?? {})[0] ?? (e.children?.length ? first(e.children[0]) : 'بيانات غير صحيحة');
    const msg = first(errors[0]);
    throw new BadRequestException(msg.includes('should not exist') ? 'بيانات غير متوقعة في الطلب' : msg);
  }
  return dto;
}
