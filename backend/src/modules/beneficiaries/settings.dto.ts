import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsIn, IsInt, IsOptional, IsString, IsUUID, MaxLength, Min, MinLength, ValidateIf, ValidateNested,
} from 'class-validator';

const trim = () => Transform(({ value }) => (typeof value === 'string' ? value.trim() || null : value));

export class ActivityDto {
  @IsIn(['axis', 'program', 'project'], { message: 'اختر المستوى' })
  level!: 'axis' | 'program' | 'project';

  @IsOptional() @IsUUID()
  parentId?: string | null;

  @trim() @IsString() @MinLength(2, { message: 'الاسم قصير جدًا' }) @MaxLength(200)
  name!: string;

  @IsOptional() @trim() @IsString() @MaxLength(1000)
  description?: string | null;

  @IsOptional() @ValidateIf((_, v) => v !== null) @IsUUID()
  workflowId?: string | null;

  @IsOptional() @IsBoolean()
  portalVisible?: boolean;

  @IsOptional() @IsBoolean()
  isActive?: boolean;

  @IsOptional() @IsInt() @Min(0)
  sortOrder?: number;
}

export class UpdateActivityDto {
  @IsOptional() @trim() @IsString() @MinLength(2, { message: 'الاسم قصير جدًا' }) @MaxLength(200)
  name?: string;

  @IsOptional() @trim() @IsString() @MaxLength(1000)
  description?: string | null;

  @IsOptional() @ValidateIf((_, v) => v !== null) @IsUUID()
  workflowId?: string | null;

  @IsOptional() @IsBoolean()
  portalVisible?: boolean;

  @IsOptional() @IsBoolean()
  isActive?: boolean;

  @IsOptional() @IsInt() @Min(0)
  sortOrder?: number;
}

export class FormDto {
  @trim() @IsString() @MinLength(2, { message: 'اسم النموذج قصير جدًا' }) @MaxLength(200)
  name!: string;

  @IsOptional() @trim() @IsString() @MaxLength(1000)
  description?: string | null;

  /** يُتحقق منها بالتفصيل في normalizeFields */
  @IsArray()
  fields!: unknown[];
}

export class StageDto {
  /** موجود = تعديل مرحلة قائمة، فاضي = مرحلة جديدة */
  @IsOptional() @IsUUID()
  id?: string;

  @trim() @IsString() @MinLength(2, { message: 'اسم المرحلة قصير جدًا' }) @MaxLength(200)
  name!: string;

  @IsOptional() @trim() @IsString() @MaxLength(1000)
  instructions?: string | null;

  @IsOptional() @ValidateIf((_, v) => v !== null) @IsUUID()
  formId?: string | null;

  @IsOptional() @ValidateIf((_, v) => v !== null) @IsUUID()
  roleId?: string | null;

  @IsOptional() @IsBoolean()
  canReject?: boolean;

  @IsOptional() @IsBoolean()
  canReturn?: boolean;
}

export class WorkflowDto {
  @trim() @IsString() @MinLength(2, { message: 'اسم سير العمل قصير جدًا' }) @MaxLength(200)
  name!: string;

  @IsOptional() @trim() @IsString() @MaxLength(1000)
  description?: string | null;

  @IsOptional() @IsBoolean()
  isDefault?: boolean;

  @IsOptional() @ValidateIf((_, v) => v !== null) @IsUUID()
  applicationFormId?: string | null;

  /** المراحل بالترتيب؛ الأخيرة هي الاعتماد النهائي */
  @IsArray() @ArrayMinSize(1, { message: 'أضف مرحلة واحدة على الأقل' }) @ArrayMaxSize(30)
  @ValidateNested({ each: true }) @Type(() => StageDto)
  stages!: StageDto[];
}
