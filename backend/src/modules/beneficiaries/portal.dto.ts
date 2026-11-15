import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize, IsArray, IsDateString, IsIn, IsNumber, IsObject, IsOptional, IsString, IsUUID, Matches, MaxLength, Min, MinLength,
} from 'class-validator';
import { IsValidPassword } from '../../core/validation';
import { CATEGORIES, GENDERS } from './constants';

const clean = () =>
  Transform(({ value }) => {
    if (typeof value !== 'string') return value;
    const v = value.trim().replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660));
    return v === '' ? null : v;
  });

export class PortalRegisterDto {
  @clean() @IsString() @MinLength(3, { message: 'اكتب الاسم بالكامل' }) @MaxLength(200)
  fullName!: string;

  @clean() @Matches(/^[0-9]{5,20}$/, { message: 'رقم الهوية أرقام فقط (من 5 إلى 20 رقم)' })
  nationalId!: string;

  @clean() @Matches(/^\+?[0-9 -]{6,20}$/, { message: 'رقم الجوال غير صحيح' })
  phone!: string;

  @IsIn(GENDERS, { message: 'اختر النوع' })
  gender!: 'male' | 'female';

  @IsOptional() @clean() @IsDateString({}, { message: 'تاريخ الميلاد غير صحيح' })
  birthDate?: string | null;

  @IsOptional() @clean() @IsString() @MaxLength(100)
  city?: string | null;

  @IsOptional() @IsIn(CATEGORIES)
  category?: string;

  @IsValidPassword()
  password!: string;
}

export class PortalLoginDto {
  @clean() @IsString() @MaxLength(20)
  nationalId!: string;

  @IsString() @MaxLength(200)
  password!: string;
}

export class PortalProfileDto {
  @IsOptional() @clean() @Matches(/^\+?[0-9 -]{6,20}$/, { message: 'رقم الجوال غير صحيح' })
  phone?: string;

  @IsOptional() @clean() @Matches(/^\+?[0-9 -]{6,20}$/, { message: 'الرقم الإضافي غير صحيح' })
  altPhone?: string | null;

  @IsOptional() @clean() @IsString() @MaxLength(100)
  city?: string | null;

  @IsOptional() @clean() @IsString() @MaxLength(300)
  address?: string | null;
}

export class PortalRequestDto {
  @IsUUID('all', { message: 'اختر المشروع' })
  projectId!: string;

  @IsOptional() @clean() @IsString() @MaxLength(5000)
  description?: string | null;

  @IsOptional() @IsObject()
  applicationData?: Record<string, unknown>;

  @IsOptional() @IsArray() @ArrayMaxSize(50) @IsString({ each: true })
  services?: string[];
}

/** إثبات المساهمة: المبلغ المدفوع (الملف في multipart) */
export class ContributionDto {
  @Type(() => Number) @IsNumber({}, { message: 'أدخل المبلغ الذي دفعته' }) @Min(0.01, { message: 'أدخل المبلغ الذي دفعته' })
  amount!: number;
}

export class TicketDto {
  @IsIn(['complaint', 'suggestion', 'inquiry'], { message: 'اختر النوع' })
  type!: 'complaint' | 'suggestion' | 'inquiry';

  @clean() @IsString() @MinLength(3, { message: 'اكتب عنوان الرسالة' }) @MaxLength(200)
  subject!: string;

  @clean() @IsString() @MinLength(5, { message: 'اكتب تفاصيل الرسالة' }) @MaxLength(5000)
  message!: string;

  @IsOptional() @IsUUID()
  requestId?: string | null;
}

export class TicketReplyDto {
  @clean() @IsString() @MinLength(2, { message: 'اكتب الرد' }) @MaxLength(5000)
  reply!: string;

  @IsOptional()
  close?: boolean;
}

export class PortalAccessDto {
  @IsValidPassword()
  password!: string;
}
