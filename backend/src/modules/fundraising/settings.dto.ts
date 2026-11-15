import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize, IsArray, IsBoolean, IsEmail, IsIn, IsInt, IsNumber, IsObject, IsOptional, IsString, IsUUID, Matches, MaxLength, Min, MinLength, ValidateIf, ValidateNested,
} from 'class-validator';

export const trim = () => Transform(({ value }) => (typeof value === 'string' ? value.trim() || null : value));

export class GeneralSettingsDto {
  @IsOptional() @IsArray() @ArrayMaxSize(60)
  donorFields?: unknown[];

  @IsOptional() @IsObject()
  journalRouting?: Record<string, unknown>;
}

export class DonorLevelDto {
  @trim() @IsString() @MinLength(2, { message: 'اسم المستوى قصير جدًا' }) @MaxLength(100)
  name!: string;

  @IsOptional() @IsString() @Matches(/^#[0-9a-fA-F]{6}$/, { message: 'اللون غير صحيح' })
  color?: string;

  @IsOptional() @ValidateIf((_, v) => v !== null) @IsNumber({}, { message: 'الحد الأدنى يجب أن يكون رقمًا' }) @Min(0)
  minAmount?: number | null;

  @IsOptional() @IsInt() @Min(0)
  sortOrder?: number;
}

export class SupportManagerDto {
  @trim() @IsString() @MinLength(2, { message: 'الاسم قصير جدًا' }) @MaxLength(200)
  name!: string;

  @IsIn(['employee', 'external'], { message: 'اختر نوع مدير الدعم' })
  kind!: 'employee' | 'external';

  @IsOptional() @ValidateIf((_, v) => v !== null) @IsUUID()
  userId?: string | null;

  @IsOptional() @trim() @IsString() @MaxLength(200)
  entityName?: string | null;

  @IsOptional() @trim() @IsString() @Matches(/^\+?[0-9]{8,15}$/, { message: 'رقم الجوال غير صحيح' })
  phone?: string | null;

  @IsOptional() @trim() @ValidateIf((_, v) => v !== null) @IsEmail({}, { message: 'البريد الإلكتروني غير صحيح' })
  email?: string | null;

  @IsOptional() @IsBoolean()
  isActive?: boolean;
}

export class BankAccountDto {
  @trim() @IsString() @MinLength(2, { message: 'اسم البنك قصير جدًا' }) @MaxLength(200)
  bankName!: string;

  @IsOptional() @trim() @IsString() @MaxLength(200)
  accountName?: string | null;

  @trim() @IsString() @Matches(/^[0-9A-Za-z-]{4,50}$/, { message: 'رقم الحساب غير صحيح' })
  accountNumber!: string;

  @IsOptional() @trim() @ValidateIf((_, v) => v !== null) @IsString() @Matches(/^SA[0-9]{22}$/, { message: 'رقم الآيبان يبدأ بـ SA ويتكون من 24 خانة' })
  iban?: string | null;

  @IsOptional() @trim() @IsString() @MaxLength(50)
  glCode?: string | null;

  @IsOptional() @trim() @IsString() @MaxLength(200)
  glName?: string | null;

  @IsOptional() @IsBoolean()
  isActive?: boolean;
}

export class WaqfProjectDto {
  @trim() @IsString() @MinLength(2, { message: 'اسم المشروع قصير جدًا' }) @MaxLength(200)
  name!: string;

  @IsOptional() @trim() @IsString() @MaxLength(1000)
  description?: string | null;

  @IsOptional() @ValidateIf((_, v) => v !== null) @IsNumber({}, { message: 'المبلغ المستهدف يجب أن يكون رقمًا' }) @Min(0)
  targetAmount?: number | null;

  @IsOptional() @IsBoolean()
  isActive?: boolean;
}

export class StageDto {
  @IsOptional() @IsUUID()
  id?: string;

  @trim() @IsString() @MinLength(2, { message: 'اسم المرحلة قصير جدًا' }) @MaxLength(200)
  name!: string;

  @IsOptional() @trim() @IsString() @MaxLength(1000)
  instructions?: string | null;

  @IsOptional() @ValidateIf((_, v) => v !== null) @IsUUID()
  roleId?: string | null;

  @IsOptional() @IsBoolean()
  canReject?: boolean;

  @IsOptional() @IsBoolean()
  canReturn?: boolean;
}

export class StagesDto {
  @IsArray() @ArrayMaxSize(10) @ValidateNested({ each: true }) @Type(() => StageDto)
  stages!: StageDto[];
}
