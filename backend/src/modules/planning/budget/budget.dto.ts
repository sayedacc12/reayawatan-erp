import { Transform, Type } from 'class-transformer';
import { IsArray, IsBoolean, IsIn, IsInt, IsNumber, IsObject, IsOptional, IsString, IsUUID, Max, MaxLength, Min, MinLength, ValidateIf } from 'class-validator';
import { FORMULA_TARGETS, METHODOLOGIES, SECTIONS } from './budget-defaults';

const trim = () => Transform(({ value }) => (typeof value === 'string' ? value.trim() || null : value));
const Opt = (): PropertyDecorator => (t, k) => [IsOptional(), ValidateIf((_: unknown, v: unknown) => v !== null && v !== '')].forEach((d) => d(t, k));

export class FormulaDto {
  @IsString() @MinLength(2) @MaxLength(40) @Transform(({ value }) => (typeof value === 'string' ? value.trim().toUpperCase() : value))
  code!: string;

  @IsString() @MinLength(3, { message: 'اكتب اسم المعادلة' }) @MaxLength(200) @trim()
  name!: string;

  @IsIn(FORMULA_TARGETS, { message: 'اختر أين تُستخدم المعادلة' })
  target!: (typeof FORMULA_TARGETS)[number];

  @IsString() @MinLength(1, { message: 'اكتب المعادلة' }) @MaxLength(2000)
  expression!: string;

  @Opt() @IsString() @MaxLength(1500) @trim()
  description?: string | null;

  @IsOptional() @IsIn(['active', 'draft', 'archived'])
  status?: 'active' | 'draft' | 'archived';
}

export class UpdateFormulaDto {
  @IsOptional() @IsString() @MinLength(3) @MaxLength(200) @trim()
  name?: string;

  @IsOptional() @IsString() @MinLength(1) @MaxLength(2000)
  expression?: string;

  @Opt() @IsString() @MaxLength(1500) @trim()
  description?: string | null;

  @IsOptional() @IsIn(['active', 'draft', 'archived'])
  status?: 'active' | 'draft' | 'archived';

  /** سبب التعديل (يُحفظ في سجل إصدارات المعادلة) */
  @Opt() @IsString() @MaxLength(500) @trim()
  note?: string | null;
}

export class TestFormulaDto {
  @IsString() @MinLength(1, { message: 'اكتب المعادلة' }) @MaxLength(2000)
  expression!: string;

  @IsIn(FORMULA_TARGETS)
  target!: (typeof FORMULA_TARGETS)[number];

  @IsOptional() @IsObject()
  vars?: Record<string, number>;

  @Opt() @IsUUID('4')
  budgetId?: string | null;
}

export class BudgetDto {
  @IsString() @MinLength(3, { message: 'اكتب عنوان الموازنة' }) @MaxLength(250) @trim()
  title!: string;

  @Type(() => Number) @IsInt({ message: 'السنة المالية غير صحيحة' }) @Min(2000) @Max(2100)
  fiscalYear!: number;

  @Opt() @IsString() @MaxLength(2000) @trim()
  description?: string | null;

  @IsOptional() @IsIn(METHODOLOGIES)
  methodology?: (typeof METHODOLOGIES)[number];

  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(10)
  historyYears?: number;

  /** نسخ الافتراضات وقواعد العلاوات والسقوف وبنود المصروفات والإيرادات من موازنة سابقة */
  @Opt() @IsUUID('4')
  copyFromId?: string | null;
}

export class UpdateBudgetDto {
  @IsOptional() @IsString() @MinLength(3) @MaxLength(250) @trim()
  title?: string;

  @Opt() @IsString() @MaxLength(2000) @trim()
  description?: string | null;

  @IsOptional() @IsIn(METHODOLOGIES)
  methodology?: (typeof METHODOLOGIES)[number];

  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(10)
  historyYears?: number;

  @IsOptional() @IsArray()
  variables?: unknown[];

  @IsOptional() @IsArray()
  raiseRules?: unknown[];

  @IsOptional() @IsObject()
  hrSetup?: { monthlyFormula: string; annualFormula: string };

  @IsOptional() @IsArray()
  ceilings?: unknown[];
}

export class ImportDto {
  @IsIn(['employees', 'staffing', 'expenses', 'revenues', 'activities', 'projects'], { message: 'مصدر الاستيراد غير صحيح' })
  source!: 'employees' | 'staffing' | 'expenses' | 'revenues' | 'activities' | 'projects';
}

export class LineDto {
  @IsIn(SECTIONS)
  section!: (typeof SECTIONS)[number];

  @IsIn(['new_position', 'hr_other', 'account', 'manual'], { message: 'نوع البند غير صحيح' })
  kind!: 'new_position' | 'hr_other' | 'account' | 'manual';

  @IsString() @MinLength(2, { message: 'اكتب اسم البند' }) @MaxLength(300) @trim()
  name!: string;

  @Opt() @IsUUID('4')
  accountId?: string | null;

  @Opt() @IsUUID('4')
  unitId?: string | null;

  @Opt() @IsUUID('4')
  costCenterId?: string | null;

  @IsOptional() @IsObject()
  params?: Record<string, unknown>;
}

export class UpdateLineDto {
  @IsOptional() @IsString() @MinLength(2) @MaxLength(300) @trim()
  name?: string;

  @IsOptional() @IsObject()
  params?: Record<string, unknown>;

  @Opt() @Type(() => Number) @IsNumber({}, { message: 'المبلغ المقترح رقم' })
  overrideAmount?: number | null;

  @Opt() @IsString() @MaxLength(1000) @trim()
  overrideNote?: string | null;

  @IsOptional() @IsBoolean()
  included?: boolean;

  @IsOptional() @IsIn(METHODOLOGIES)
  methodology?: (typeof METHODOLOGIES)[number];

  @IsOptional() @IsArray()
  allocations?: { costCenterId: string | null; name: string; pct: number }[];

  @Opt() @IsUUID('4')
  unitId?: string | null;

  @Opt() @IsUUID('4')
  costCenterId?: string | null;

  @Opt() @IsUUID('4')
  accountId?: string | null;

  @Opt() @IsIn(['restricted', 'unrestricted', 'mixed'])
  fundingType?: string | null;

  @Opt() @IsString() @MaxLength(1000) @trim()
  note?: string | null;
}

export class AvailabilityCheckDto {
  @Type(() => Number) @IsNumber({}, { message: 'المبلغ رقم' }) @Min(0.01, { message: 'المبلغ يجب أن يكون أكبر من صفر' })
  amount!: number;

  @Opt() @IsUUID('4')
  budgetLineId?: string | null;

  @Opt() @IsUUID('4')
  fundingBatchId?: string | null;
}
