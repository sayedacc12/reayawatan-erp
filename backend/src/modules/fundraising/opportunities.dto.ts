import { Type } from 'class-transformer';
import {
  ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsDateString, IsIn, IsInt, IsNumber, IsOptional, IsString, IsUUID, Max, MaxLength, Min, MinLength,
  ValidateIf, ValidateNested,
} from 'class-validator';
import { trim } from './settings.dto';

export class ConditionsDto {
  @IsOptional() @IsBoolean()
  acceptsPatientContribution?: boolean;

  @IsOptional() @ValidateIf((_, v) => v !== null) @IsNumber({}, { message: 'الحد الأعلى للصرف يجب أن يكون رقمًا' }) @Min(0)
  maxSpend?: number | null;

  @IsOptional() @IsArray() @ArrayMaxSize(50) @IsString({ each: true })
  nationalities?: string[];

  @IsOptional() @IsArray() @ArrayMaxSize(3) @IsIn(['citizen', 'resident', 'visitor'], { each: true, message: 'الفئة غير صحيحة' })
  categories?: ('citizen' | 'resident' | 'visitor')[];

  @IsOptional() @ValidateIf((_, v) => v !== null) @IsDateString({}, { message: 'تاريخ انتهاء المشروع غير صحيح' })
  endDate?: string | null;
}

export class LineDto {
  @IsIn(['operational', 'program', 'waqf', 'case'], { message: 'اختر نوع البند' })
  targetKind!: 'operational' | 'program' | 'waqf' | 'case';

  @IsOptional() @ValidateIf((_, v) => v !== null) @IsUUID()
  activityId?: string | null;

  @IsOptional() @ValidateIf((_, v) => v !== null) @IsUUID()
  waqfProjectId?: string | null;

  @IsOptional() @ValidateIf((_, v) => v !== null) @IsUUID()
  beneficiaryRequestId?: string | null;

  @IsIn(['amount', 'percent'], { message: 'اختر طريقة التوزيع: مبلغ أو نسبة' })
  mode!: 'amount' | 'percent';

  @IsOptional() @ValidateIf((_, v) => v !== null) @IsNumber({}, { message: 'النسبة يجب أن تكون رقمًا' }) @Min(0) @Max(100)
  percent?: number | null;

  @IsOptional() @ValidateIf((_, v) => v !== null) @IsNumber({ maxDecimalPlaces: 2 }, { message: 'المبلغ يجب أن يكون رقمًا بخانتين عشريتين على الأكثر' }) @Min(0)
  amount?: number | null;
}

export class OpportunityDto {
  @IsIn(['cash', 'in_kind', 'pledge'], { message: 'اختر نوع الفرصة' })
  kind!: 'cash' | 'in_kind' | 'pledge';

  @IsUUID('all', { message: 'اختر الداعم' })
  donorId!: string;

  @IsOptional() @ValidateIf((_, v) => v !== null) @IsUUID()
  supportManagerId?: string | null;

  @IsDateString({}, { message: 'تاريخ الفرصة غير صحيح' })
  date!: string;

  @IsNumber({ maxDecimalPlaces: 2 }, { message: 'إجمالي التبرع يجب أن يكون رقمًا بخانتين عشريتين على الأكثر' }) @Min(1, { message: 'إجمالي التبرع يجب أن يكون أكبر من صفر' })
  totalAmount!: number;

  @IsOptional() @ValidateIf((_, v) => v !== null) @IsUUID()
  bankAccountId?: string | null;

  @IsOptional() @trim() @IsString() @MaxLength(100)
  transferReference?: string | null;

  @IsOptional() @IsBoolean()
  isZakat?: boolean;

  @IsOptional() @ValidateNested() @Type(() => ConditionsDto)
  conditions?: ConditionsDto;

  @IsOptional() @trim() @IsString() @MaxLength(4000)
  conditionsText?: string | null;

  @IsOptional() @trim() @IsString() @MaxLength(4000)
  inKindDescription?: string | null;

  @IsArray() @ArrayMinSize(1, { message: 'أضف بندًا واحدًا على الأقل في توزيع التبرع' }) @ArrayMaxSize(50)
  @ValidateNested({ each: true }) @Type(() => LineDto)
  lines!: LineDto[];
}

export class DecisionDto {
  @IsIn(['approve', 'reject', 'return'], { message: 'اختر القرار' })
  decision!: 'approve' | 'reject' | 'return';

  @IsOptional() @trim() @IsString() @MaxLength(2000)
  notes?: string | null;
}

export class CollectDto {
  @IsDateString({}, { message: 'تاريخ السداد غير صحيح' })
  date!: string;

  @IsNumber({ maxDecimalPlaces: 2 }, { message: 'المبلغ غير صحيح' }) @Min(0.01, { message: 'المبلغ يجب أن يكون أكبر من صفر' })
  amount!: number;

  @IsUUID('all', { message: 'اختر الحساب البنكي' })
  bankAccountId!: string;

  @IsOptional() @trim() @IsString() @MaxLength(100)
  transferReference?: string | null;
}

export class DocumentDto {
  @trim() @IsString() @MinLength(2, { message: 'اكتب اسم المستند' }) @MaxLength(200)
  title!: string;
}

export class ListOpportunitiesQuery {
  @IsOptional() @IsString() @MaxLength(100)
  search?: string;

  @IsOptional() @IsIn(['in_progress', 'returned', 'approved', 'rejected'])
  status?: string;

  @IsOptional() @IsIn(['cash', 'in_kind', 'pledge'])
  kind?: string;

  @IsOptional() @IsUUID()
  donorId?: string;

  @IsOptional() @IsIn(['true', 'false'])
  zakat?: 'true' | 'false';

  @IsOptional() @IsIn(['true'])
  mine?: 'true';

  @IsOptional() @IsDateString()
  from?: string;

  @IsOptional() @IsDateString()
  to?: string;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1)
  page?: number;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(200)
  pageSize?: number;
}

export class ListBatchesQuery {
  @IsOptional() @IsString() @MaxLength(100)
  search?: string;

  @IsOptional() @IsIn(['pending', 'active', 'closed', 'cancelled'])
  status?: 'pending' | 'active' | 'closed' | 'cancelled';

  @IsOptional() @IsIn(['operational', 'program', 'waqf', 'case'])
  targetKind?: 'operational' | 'program' | 'waqf' | 'case';

  @IsOptional() @IsUUID()
  activityId?: string;

  @IsOptional() @IsUUID()
  donorId?: string;

  @IsOptional() @IsUUID()
  opportunityId?: string;

  @IsOptional() @IsIn(['true', 'false'])
  zakat?: 'true' | 'false';
}
