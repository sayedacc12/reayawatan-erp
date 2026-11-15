import { IsValidPassword } from '../validation';
import {
  ArrayUnique, IsArray, IsBoolean, IsEmail, IsOptional, IsString, IsUUID, MaxLength, MinLength,
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
