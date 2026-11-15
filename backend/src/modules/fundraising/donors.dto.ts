import { Type } from 'class-transformer';
import { IsBoolean, IsEmail, IsIn, IsInt, IsObject, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, MinLength, ValidateIf } from 'class-validator';
import { trim } from './settings.dto';

export class DonorDto {
  @trim() @IsString() @MinLength(2, { message: 'اسم الداعم قصير جدًا' }) @MaxLength(200)
  name!: string;

  @IsIn(['individual', 'entity'], { message: 'اختر نوع الداعم' })
  type!: 'individual' | 'entity';

  @IsOptional() @trim() @IsString() @MaxLength(50)
  identifier?: string | null;

  @IsOptional() @trim() @ValidateIf((_, v) => v !== null) @IsString() @Matches(/^\+?[0-9]{8,15}$/, { message: 'رقم الجوال غير صحيح' })
  phone?: string | null;

  @IsOptional() @trim() @ValidateIf((_, v) => v !== null) @IsEmail({}, { message: 'البريد الإلكتروني غير صحيح' })
  email?: string | null;

  @IsOptional() @trim() @IsString() @MaxLength(100)
  city?: string | null;

  @IsOptional() @ValidateIf((_, v) => v !== null) @IsUUID()
  levelId?: string | null;

  @IsOptional() @ValidateIf((_, v) => v !== null) @IsUUID()
  supportManagerId?: string | null;

  @IsOptional() @IsObject()
  customData?: Record<string, unknown>;

  @IsOptional() @trim() @IsString() @MaxLength(4000)
  notes?: string | null;

  @IsOptional() @IsBoolean()
  isActive?: boolean;
}

export class ListDonorsQuery {
  @IsOptional() @IsString() @MaxLength(100)
  search?: string;

  @IsOptional() @IsUUID()
  levelId?: string;

  @IsOptional() @IsUUID()
  supportManagerId?: string;

  @IsOptional() @IsIn(['individual', 'entity'])
  type?: 'individual' | 'entity';

  @IsOptional() @IsIn(['true', 'false'])
  active?: 'true' | 'false';

  @IsOptional() @Type(() => Number) @IsInt() @Min(1)
  page?: number;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(200)
  pageSize?: number;
}
