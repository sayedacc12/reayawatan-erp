import { ArrayUnique, IsArray, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class CreateRoleDto {
  @IsString()
  @MinLength(2, { message: 'اسم الدور قصير جدًا' })
  @MaxLength(100)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @IsArray()
  @ArrayUnique()
  @IsString({ each: true })
  permissions!: string[];
}

export class UpdateRoleDto {
  @IsOptional()
  @IsString()
  @MinLength(2, { message: 'اسم الدور قصير جدًا' })
  @MaxLength(100)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsString({ each: true })
  permissions?: string[];
}

/** صلاحيات وحدة واحدة في دور (من شاشة إعدادات الوحدة) */
export class ModulePermissionsDto {
  @IsArray()
  @ArrayUnique()
  @IsString({ each: true })
  permissions!: string[];
}
