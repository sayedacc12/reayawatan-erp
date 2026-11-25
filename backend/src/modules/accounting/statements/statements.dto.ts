import { Transform, Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsIn, IsInt, IsNumber, IsOptional, IsString, IsUUID, Max, MaxLength, Min, MinLength, ValidateIf, ValidateNested } from 'class-validator';
import { FS_LINES, NONPROFIT_CHANNELS, PROFIT_POLICY } from './fs-template';
import { SPANS, Span } from './fs-period';

const trim = () => Transform(({ value }) => (typeof value === 'string' ? value.trim() || null : value));

/** الفترة: السنة المالية ونوع الفترة (شهر، ربع، نصف، سنة) ورقمها داخل السنة */
export class FsPeriodQueryDto {
  @IsUUID('all', { message: 'اختر السنة المالية' })
  yearId!: string;

  @IsIn(SPANS, { message: 'نوع الفترة: شهري أو ربعي أو نصفي أو سنوي' })
  span!: Span;

  @IsOptional() @Type(() => Number) @IsInt({ message: 'رقم الفترة غير صحيح' }) @Min(1) @Max(12)
  part?: number;
}

export class FsDocumentQueryDto extends FsPeriodQueryDto {
  @IsOptional() @IsIn(['html'])
  format?: 'html';
}

export class FsMappingDto {
  /** null يلغي الربط اليدوي فيعود الحساب للربط الافتراضي */
  @ValidateIf((_: unknown, v: unknown) => v !== null)
  @IsIn(FS_LINES.map((l) => l.code), { message: 'اختر بندًا من بنود القوائم' })
  lineCode!: string | null;
}

export class FsYearQueryDto {
  @IsUUID('all', { message: 'اختر السنة المالية' })
  yearId!: string;
}

export class AppropriationProgramDto {
  @Type(() => Number) @IsInt() @Min(1) @Max(NONPROFIT_CHANNELS.length, { message: 'المصرف غير موجود في المادة (4)' })
  channel!: number;

  @IsString() @MinLength(2, { message: 'اكتب اسم البرنامج' }) @MaxLength(250)
  name!: string;

  @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }, { message: 'مبلغ البرنامج غير صحيح' }) @Min(0) @Max(999_999_999_999)
  amount!: number;
}

export class AppropriationDto {
  @IsUUID('all', { message: 'اختر السنة المالية' })
  yearId!: string;

  @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(PROFIT_POLICY.maxDevelopmentPct, { message: `حصة التنمية لا تتجاوز ${PROFIT_POLICY.maxDevelopmentPct}% (المادة 10 من النظام الأساس)` })
  developmentPct!: number;

  @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(PROFIT_POLICY.maxDistributionPct, { message: `التوزيع لا يتجاوز ${PROFIT_POLICY.maxDistributionPct}% (المادة 10 من النظام الأساس)` })
  distributionPct!: number;

  @Type(() => Number) @IsInt() @Min(0) @Max(24)
  reserveMonths!: number;

  @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(999_999_999_999)
  unrealized!: number;

  @IsArray() @ArrayMaxSize(50) @ValidateNested({ each: true }) @Type(() => AppropriationProgramDto)
  programs!: AppropriationProgramDto[];

  @IsOptional() @trim() @IsString() @MaxLength(300)
  boardDecision?: string | null;

  @IsOptional() @trim() @IsString() @MaxLength(2000)
  notes?: string | null;
}
