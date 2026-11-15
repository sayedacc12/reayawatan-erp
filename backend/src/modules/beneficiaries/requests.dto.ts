import { Transform, Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsIn, IsInt, IsNumber, IsObject, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from 'class-validator';

const trim = () => Transform(({ value }) => (typeof value === 'string' ? value.trim() || null : value));

export class CreateRequestDto {
  @IsUUID('all', { message: 'اختر المستفيد' })
  beneficiaryId!: string;

  @IsUUID('all', { message: 'اختر المشروع' })
  projectId!: string;

  @IsOptional() @trim() @IsString() @MaxLength(5000)
  description?: string | null;

  @IsOptional() @IsObject()
  applicationData?: Record<string, unknown>;

  /** الخدمات المختارة من خدمات المشروع */
  @IsOptional() @IsArray() @ArrayMaxSize(50) @IsString({ each: true })
  services?: string[];
}

export class DecisionDto {
  @IsIn(['approve', 'reject', 'return'], { message: 'اختر القرار' })
  decision!: 'approve' | 'reject' | 'return';

  @IsOptional() @trim() @IsString() @MaxLength(5000)
  notes?: string | null;

  @IsOptional() @IsObject()
  formData?: Record<string, unknown>;

  /** تحديد/تعديل التكلفة التقديرية للحالة */
  @IsOptional() @Type(() => Number) @IsNumber({}, { message: 'يجب أن تكون التكلفة رقمًا' }) @Min(0)
  estimatedCost?: number;

  /** في مرحلة تأكيد المساهمة: المبلغ المحصّل فعلًا (لو المستفيد دفع في الجمعية) */
  @IsOptional() @Type(() => Number) @IsNumber({}, { message: 'يجب أن يكون المبلغ رقمًا' }) @Min(0)
  contributionAmount?: number;
}

export class ResubmitDto {
  @IsOptional() @trim() @IsString() @MaxLength(5000)
  description?: string | null;

  @IsOptional() @IsObject()
  applicationData?: Record<string, unknown>;

  @IsOptional() @trim() @IsString() @MaxLength(5000)
  notes?: string | null;
}

export class ListRequestsQuery {
  @IsOptional() @IsIn(['in_progress', 'returned', 'approved', 'rejected', 'cancelled', 'open'])
  status?: string;

  @IsOptional() @IsUUID()
  stageId?: string;

  @IsOptional() @IsUUID()
  projectId?: string;

  @IsOptional() @IsUUID()
  beneficiaryId?: string;

  @IsOptional() @trim() @IsString() @MaxLength(100)
  search?: string;

  /** الطلبات اللي عليّ قرار فيها */
  @IsOptional() @Transform(({ value }) => value === 'true' || value === true)
  mine?: boolean;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1)
  page?: number;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100)
  pageSize?: number;
}
