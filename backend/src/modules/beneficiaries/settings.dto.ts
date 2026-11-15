import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsIn, IsInt, IsNumber, IsOptional, IsString, IsUUID, Matches, MaxLength, Min, MinLength, ValidateIf, ValidateNested,
} from 'class-validator';

const trim = () => Transform(({ value }) => (typeof value === 'string' ? value.trim() || null : value));

/** خدمة في المشروع وتكلفتها التقديرية */
export class ServiceDto {
  @trim() @IsString() @MinLength(2, { message: 'اسم الخدمة قصير جدًا' }) @MaxLength(200)
  name!: string;

  @IsOptional() @ValidateIf((_, v) => v !== null) @IsNumber({}, { message: 'تكلفة الخدمة لازم تكون رقم' }) @Min(0)
  cost?: number | null;
}

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

  @IsOptional() @IsArray() @ArrayMaxSize(50) @ValidateNested({ each: true }) @Type(() => ServiceDto)
  services?: ServiceDto[];

  @IsOptional() @IsBoolean()
  multiServices?: boolean;

  @IsOptional() @IsBoolean()
  allowConcurrent?: boolean;

  @IsOptional() @IsIn(['once', 'weekly', 'monthly', 'quarterly', 'semiannual', 'yearly'])
  recurrence?: 'once' | 'weekly' | 'monthly' | 'quarterly' | 'semiannual' | 'yearly';
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

  @IsOptional() @IsArray() @ArrayMaxSize(50) @ValidateNested({ each: true }) @Type(() => ServiceDto)
  services?: ServiceDto[];

  @IsOptional() @IsBoolean()
  multiServices?: boolean;

  @IsOptional() @IsBoolean()
  allowConcurrent?: boolean;

  @IsOptional() @IsIn(['once', 'weekly', 'monthly', 'quarterly', 'semiannual', 'yearly'])
  recurrence?: 'once' | 'weekly' | 'monthly' | 'quarterly' | 'semiannual' | 'yearly';
}

export class FormDto {
  @trim() @IsString() @MinLength(2, { message: 'اسم النموذج قصير جدًا' }) @MaxLength(200)
  name!: string;

  @IsOptional() @trim() @IsString() @MaxLength(1000)
  description?: string | null;

  /** كود الوثيقة في نظام الجودة ISO 9001 */
  @trim() @IsString({ message: 'اكتب كود الجودة للنموذج' })
  @Matches(/^[A-Za-z0-9][A-Za-z0-9._/-]{1,49}$/, { message: 'كود الجودة لازم يكون حروف إنجليزي وأرقام وشرطة، مثال QF-BEN-01' })
  qualityCode!: string;

  /** يُتحقق منها بالتفصيل في normalizeFields */
  @IsArray()
  fields!: unknown[];

  /** نموذج تقييم (أوزان ودرجات) */
  @IsOptional() @IsBoolean()
  scored?: boolean;

  /** قواعد نتيجة التقييم، يُتحقق منها في normalizeRules */
  @IsOptional() @IsArray()
  rules?: unknown[];
}

/** إنشاء نموذج: لازم يكون على مرحلة (أو على تقديم الطلب في سير عمل) */
export class CreateFormDto extends FormDto {
  @IsUUID('all', { message: 'اختر سير العمل' })
  workflowId!: string;

  /** فاضي = نموذج تقديم الطلب */
  @IsOptional() @IsUUID('all', { message: 'اختر المرحلة' })
  stageId?: string | null;
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

  /** standard: قرار عادي · contribution: تأكيد مساهمة المستفيد */
  @IsOptional() @IsIn(['standard', 'contribution'])
  kind?: 'standard' | 'contribution';
}

/** توجيه القيد المحاسبي لمساهمات المستفيدين */
export class AccountingDto {
  @IsOptional() @trim() @IsString() @MaxLength(50)
  debitAccountCode?: string | null;

  @IsOptional() @trim() @IsString() @MaxLength(200)
  debitAccountName?: string | null;

  @IsOptional() @trim() @IsString() @MaxLength(50)
  creditAccountCode?: string | null;

  @IsOptional() @trim() @IsString() @MaxLength(200)
  creditAccountName?: string | null;

  @IsOptional() @trim() @IsString() @MaxLength(300)
  description?: string | null;
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

/** إرجاع النموذج للمسودة من مراجع الجودة أو مدير الشاشة */
export class ReturnFormDto {
  @trim() @IsString() @MinLength(3, { message: 'اكتب سبب الإرجاع' }) @MaxLength(1000)
  note!: string;
}
