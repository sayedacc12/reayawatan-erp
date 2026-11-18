import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize, IsArray, IsBoolean, IsDateString, IsIn, IsInt, IsNumber, IsObject, IsOptional, IsString, Max, MaxLength, Min, MinLength, ValidateIf,
} from 'class-validator';
import { ACTION_STATUSES, ASSESSMENT_KINDS, OBLIGATION_KINDS, PERIOD_TYPES, PRIORITIES } from './entities/governance.entity';

const trim = () => Transform(({ value }) => (typeof value === 'string' ? value.trim() || null : value));
const Nullable = (): PropertyDecorator => (t, k) => [IsOptional(), ValidateIf((_: unknown, v: unknown) => v !== null && v !== '')].forEach((d) => d(t, k));
const DateField = (msg: string) => IsDateString({ strict: true }, { message: msg });
const Text = (max: number, required = false) => (t: object, k: string | symbol) => {
  trim()(t, k);
  if (!required) Nullable()(t, k);
  IsString()(t, k);
  MaxLength(max)(t, k);
};
const OPINIONS = ['unqualified', 'qualified', 'adverse', 'disclaimer', 'not_issued'] as const;

export class AssessmentDto {
  @Text(250, true) @MinLength(3, { message: 'اكتب عنوان التقييم' })
  title!: string;

  @IsIn(ASSESSMENT_KINDS, { message: 'نوع التقييم غير صحيح' })
  kind!: (typeof ASSESSMENT_KINDS)[number];

  @IsIn(PERIOD_TYPES, { message: 'دورية التقييم غير صحيحة' })
  periodType!: (typeof PERIOD_TYPES)[number];

  @DateField('تاريخ بداية الفترة غير صحيح')
  periodFrom!: string;

  @DateField('تاريخ نهاية الفترة غير صحيح')
  periodTo!: string;

  @IsOptional() @IsIn(OPINIONS, { message: 'رأي المحاسب القانوني غير صحيح' })
  opinion?: (typeof OPINIONS)[number];

  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(20)
  qualifiedItems?: number;

  @Text(2000)
  notes?: string | null;

  /** نسخ إجابات آخر تقييم معتمد كبداية */
  @IsOptional() @IsBoolean()
  copyPrevious?: boolean;
}

export class AssessmentUpdateDto {
  @IsOptional() @Text(250)
  title?: string;

  @IsOptional() @IsIn(OPINIONS, { message: 'رأي المحاسب القانوني غير صحيح' })
  opinion?: (typeof OPINIONS)[number];

  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(20)
  qualifiedItems?: number;

  @Text(2000)
  notes?: string | null;
}

export class AnswerDto {
  @IsArray() @ArrayMaxSize(12)
  choices!: (number | null)[];

  @Text(2000)
  evidence?: string | null;

  @Text(2000)
  note?: string | null;
}

export class FiguresDto {
  @IsObject({ message: 'الأرقام غير مكتملة' })
  figures!: Record<string, number>;
}

export class ActionDto {
  @Text(300, true) @MinLength(3, { message: 'اكتب عنوان الإجراء' })
  title!: string;

  @Text(4000)
  description?: string | null;

  @Text(200)
  ownerName?: string | null;

  @Nullable() @DateField('تاريخ الاستحقاق غير صحيح')
  dueDate?: string | null;

  @IsOptional() @IsIn(PRIORITIES, { message: 'الأولوية غير صحيحة' })
  priority?: (typeof PRIORITIES)[number];

  @IsOptional() @IsIn(ACTION_STATUSES, { message: 'الحالة غير صحيحة' })
  status?: (typeof ACTION_STATUSES)[number];

  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(100)
  progress?: number;

  @Text(20)
  itemCode?: string | null;

  @Text(2000)
  note?: string | null;
}

export class GapActionsDto {
  /** رموز البنود أو مؤشرات الأداء المالي المطلوب إنشاء إجراءات لها */
  @IsArray() @ArrayMaxSize(100) @IsString({ each: true })
  codes!: string[];

  @Text(200)
  ownerName?: string | null;

  @Nullable() @DateField('تاريخ الاستحقاق غير صحيح')
  dueDate?: string | null;
}

export class ObligationDto {
  @IsIn(OBLIGATION_KINDS, { message: 'نوع الالتزام غير صحيح' })
  kind!: (typeof OBLIGATION_KINDS)[number];

  @Text(300, true) @MinLength(3, { message: 'اكتب عنوان الالتزام' })
  title!: string;

  @DateField('تاريخ الاستحقاق غير صحيح')
  dueDate!: string;

  @Nullable() @DateField('تاريخ الإنجاز غير صحيح')
  doneDate?: string | null;

  @Text(1000)
  evidence?: string | null;

  @Text(1000)
  note?: string | null;
}

export class GenerateCalendarDto {
  @Type(() => Number) @IsInt() @Min(2000) @Max(2100)
  fiscalYear!: number;
}

export class AckDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(365)
  days?: number;

  @Text(1000)
  note?: string | null;
}

export class SettingsDto {
  @IsOptional() @IsObject()
  mapping?: Record<string, { code: string; sign?: 1 | -1 }[]>;

  @IsOptional() @IsObject()
  facts?: Record<string, unknown>;

  @IsOptional() @Type(() => Number) @IsInt() @Min(7) @Max(180)
  alertDays?: number;

  @IsOptional() @Type(() => Number) @IsNumber() @Min(50) @Max(100)
  targetScore?: number;
}
