import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize, IsArray, IsBoolean, IsEmail, IsIn, IsInt, IsNumber, IsObject, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, MinLength, ValidateNested,
} from 'class-validator';
import { ICONS } from './website-defaults';

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const trim = () => Transform(({ value }) => (typeof value === 'string' ? value.trim() : value));

// ---------------- الأخبار ----------------

export class NewsDto {
  @trim() @IsString() @MinLength(5, { message: 'اكتب عنوان الخبر (5 أحرف على الأقل)' }) @MaxLength(250) title!: string;
  @trim() @IsString() @MinLength(10, { message: 'اكتب ملخصًا قصيرًا للخبر' }) @MaxLength(600) summary!: string;
  @trim() @IsString() @MinLength(20, { message: 'اكتب نص الخبر' }) @MaxLength(30000) body!: string;
  @IsOptional() @IsUUID() imageId?: string | null;
  @Matches(DATE, { message: 'تاريخ الخبر غير صحيح' }) newsDate!: string;
  @IsBoolean() ticker!: boolean;
  /** draft: حفظ كمسودة، submit: إرسال للاعتماد، publish: نشر مباشر (لمن يملك صلاحية الاعتماد) */
  @IsIn(['draft', 'submit', 'publish']) action!: 'draft' | 'submit' | 'publish';
}

export class DecisionDto {
  @IsIn(['approve', 'return', 'reject', 'unpublish']) decision!: 'approve' | 'return' | 'reject' | 'unpublish';
  @IsOptional() @trim() @IsString() @MaxLength(1000) note?: string;
}

// ---------------- البرامج ----------------

export class ServiceDto {
  @IsIn(ICONS) icon!: string;
  @trim() @IsString() @MinLength(2) @MaxLength(80) title!: string;
  @trim() @IsString() @MaxLength(300) text!: string;
}

export class ProgramDto {
  @Matches(/^[a-z0-9][a-z0-9-]{1,58}$/, { message: 'رمز البرنامج حروف إنجليزية صغيرة وأرقام وشرطات فقط، مثل: orphans-care' }) slug!: string;
  @trim() @IsString() @MinLength(3, { message: 'اكتب اسم البرنامج' }) @MaxLength(200) name!: string;
  @IsOptional() @trim() @IsString() @MaxLength(300) tagline?: string | null;
  @trim() @IsString() @MinLength(10, { message: 'اكتب نبذة مختصرة عن البرنامج' }) @MaxLength(800) summary!: string;
  @IsOptional() @IsString() @MaxLength(8000) about?: string | null;
  @IsOptional() @IsString() @MaxLength(800) audience?: string | null;
  @IsOptional() @IsString() @MaxLength(200) timing?: string | null;
  @IsArray() @ArrayMaxSize(12) @ValidateNested({ each: true }) @Type(() => ServiceDto) services!: ServiceDto[];
  @IsArray() @ArrayMaxSize(12) @IsString({ each: true }) @MaxLength(200, { each: true }) points!: string[];
  @IsIn(ICONS) icon!: string;
  @IsOptional() @IsUUID() imageId?: string | null;
  @IsOptional() @IsUUID() kitDocId?: string | null;
  @IsOptional() @IsUUID() activityId?: string | null;
  @IsIn(['draft', 'submit']) action!: 'draft' | 'submit';
}

export class ProgramStoreDto {
  @IsBoolean() on!: boolean;
  @IsIn(['project', 'waqf']) kind!: 'project' | 'waqf';
  @Type(() => Number) @IsInt() @Min(0) @Max(1_000_000_000) goal!: number;
  @IsOptional() @Matches(DATE, { message: 'تاريخ انتهاء الحملة غير صحيح' }) endDate?: string | null;
  @Type(() => Number) @IsInt() @Min(0) @Max(1_000_000) min!: number;
  @Type(() => Number) @IsInt() @Min(0) @Max(1_000_000) max!: number;
  @IsArray() @ArrayMaxSize(6) @Type(() => Number) @IsInt({ each: true }) @Min(1, { each: true }) @Max(1_000_000, { each: true }) presets!: number[];
  @IsBoolean() stop!: boolean;
  @IsBoolean() monthly!: boolean;
  @IsBoolean() gift!: boolean;
  @IsOptional() @IsUUID() revenueAccountId?: string | null;
}

export class ProgramDecisionDto extends DecisionDto {
  @IsOptional() @IsBoolean() showOnSite?: boolean;
  @IsOptional() @IsBoolean() featured?: boolean;
  @IsOptional() @ValidateNested() @Type(() => ProgramStoreDto) store?: ProgramStoreDto;
}

export class OrderDto {
  @IsArray() @ArrayMaxSize(500) @IsUUID('all', { each: true }) ids!: string[];
}

// ---------------- الإعدادات والصفحات ----------------

export class SectionDto {
  @IsObject() data!: Record<string, unknown>;
}

// ---------------- العامة ----------------

export class GiftDto {
  @trim() @IsString() @MinLength(2, { message: 'اكتب اسم المُهدى إليه' }) @MaxLength(80) to!: string;
  @IsOptional() @trim() @IsString() @MaxLength(20) phone?: string;
  @IsOptional() @trim() @IsString() @MaxLength(200) message?: string;
}

export class DonateDto {
  @IsOptional() @IsUUID() programId?: string | null;
  @Type(() => Number) @IsNumber({ maxDecimalPlaces: 0 }, { message: 'المبلغ رقم صحيح بالريال' }) @Min(1) @Max(1_000_000) amount!: number;
  @IsOptional() @trim() @IsString() @MaxLength(200) name?: string;
  @trim() @IsString() @MaxLength(20) phone!: string;
  @IsOptional() @trim() @IsEmail({}, { message: 'البريد الإلكتروني غير صحيح' }) @MaxLength(200) email?: string;
  @IsOptional() @ValidateNested() @Type(() => GiftDto) gift?: GiftDto | null;
  @IsOptional() @IsBoolean() monthly?: boolean;
}

export class SandboxPayDto {
  @IsString() @MaxLength(40) ref!: string;
}

export class ContactDto {
  @trim() @IsString() @MinLength(2, { message: 'اكتب اسمك' }) @MaxLength(200) name!: string;
  @IsOptional() @trim() @IsString() @MaxLength(20) phone?: string;
  @IsOptional() @trim() @IsEmail({}, { message: 'البريد الإلكتروني غير صحيح' }) @MaxLength(200) email?: string;
  @IsIn(['inquiry', 'suggestion', 'complaint', 'partnership', 'other']) topic!: string;
  @trim() @IsString() @MinLength(10, { message: 'اكتب رسالتك (10 أحرف على الأقل)' }) @MaxLength(4000) body!: string;
}

export class MessageUpdateDto {
  @IsIn(['new', 'in_progress', 'closed']) status!: string;
  @IsOptional() @trim() @IsString() @MaxLength(2000) replyNote?: string | null;
}

export class SubscriptionStatusDto {
  @IsIn(['active', 'paused', 'cancelled']) status!: string;
}
