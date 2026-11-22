import { IsValidPassword } from '../validation';
import {
  ArrayUnique, IsArray, IsBoolean, IsDateString, IsEmail, IsOptional, IsString, IsUUID, Matches, MaxLength, MinLength,
} from 'class-validator';

export class CreateUserDto {
  @IsString()
  @MinLength(2, { message: 'الاسم قصير جدًا' })
  @MaxLength(200)
  fullName!: string;

  @IsEmail({}, { message: 'البريد الإلكتروني غير صحيح' })
  email!: string;

  @IsValidPassword()
  password!: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsBoolean()
  isSuperadmin?: boolean;

  @IsArray()
  @ArrayUnique()
  @IsUUID('all', { each: true })
  roleIds!: string[];
}

export class UpdateUserDto {
  @IsOptional()
  @IsString()
  @MinLength(2, { message: 'الاسم قصير جدًا' })
  @MaxLength(200)
  fullName?: string;

  @IsOptional()
  @IsEmail({}, { message: 'البريد الإلكتروني غير صحيح' })
  email?: string;

  @IsOptional()
  @IsValidPassword()
  password?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsBoolean()
  isSuperadmin?: boolean;

  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsUUID('all', { each: true })
  roleIds?: string[];
}

/** تكليف مستخدم بدور من تاريخ إلى تاريخ */
export class CreateAssignmentDto {
  @IsUUID('all', { message: 'اختر الدور' })
  roleId!: string;

  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'تاريخ البداية بالشكل 2026-01-31' })
  @IsDateString({ strict: true }, { message: 'تاريخ البداية غير صحيح' })
  startDate!: string;

  /** فارغ = مفتوح حتى يُنهى */
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'تاريخ النهاية بالشكل 2026-01-31' })
  @IsDateString({ strict: true }, { message: 'تاريخ النهاية غير صحيح' })
  endDate?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}
