import { PartialType } from '@nestjs/mapped-types';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize, IsArray, IsBoolean, IsDateString, IsIn, IsInt, IsNumber, IsObject, IsOptional, IsString, IsUUID, Max, MaxLength, Min, MinLength,
  ValidateIf, ValidateNested,
} from 'class-validator';
import { FUNDING_TYPES, ITEM_STATES, KPI_AGGREGATIONS, KPI_DIRECTIONS, PERIODICITIES, PLAN_KINDS, REF_SYSTEMS, RESOURCE_KINDS, TARGET_KINDS } from './entities/planning.entity';

const trim = () => Transform(({ value }) => (typeof value === 'string' ? value.trim() || null : value));
const Nullable = (): PropertyDecorator => (t, k) => [IsOptional(), ValidateIf((_: unknown, v: unknown) => v !== null && v !== '')].forEach((d) => d(t, k));
const DateField = (msg: string) => IsDateString({ strict: true }, { message: msg });
const Text = (max: number, required = false) => (t: object, k: string | symbol) => {
  trim()(t, k);
  if (!required) Nullable()(t, k);
  IsString()(t, k);
  MaxLength(max)(t, k);
};
const Year = (msg: string) => (t: object, k: string | symbol) => {
  Type(() => Number)(t, k);
  IsInt({ message: msg })(t, k);
  Min(2000, { message: msg })(t, k);
  Max(2100, { message: msg })(t, k);
};
const OptUuid = () => (t: object, k: string | symbol) => { Nullable()(t, k); IsUUID('4')(t, k); };
const Num = (min: number, max: number, msg: string) => (t: object, k: string | symbol) => {
  Type(() => Number)(t, k);
  IsNumber({}, { message: msg })(t, k);
  Min(min, { message: msg })(t, k);
  Max(max, { message: msg })(t, k);
};

export class ConfigDto {
  @IsObject({ message: 'الإعدادات غير مكتملة' })
  config!: Record<string, unknown>;
}

export class LevelDto {
  @IsString() @MaxLength(30)
  key!: string;

  @Text(60, true) @MinLength(2, { message: 'اكتب اسم كل مستوى' })
  name!: string;

  @IsString() @MaxLength(3)
  prefix!: string;
}

export class PlanDto {
  @IsIn(PLAN_KINDS, { message: 'نوع الخطة غير صحيح' })
  kind!: (typeof PLAN_KINDS)[number];

  @Text(250, true) @MinLength(3, { message: 'اكتب عنوان الخطة' })
  title!: string;

  @Text(3000)
  description?: string | null;

  @Year('سنة البداية غير صحيحة')
  startYear!: number;

  @Year('سنة النهاية غير صحيحة')
  endYear!: number;

  @IsIn(PERIODICITIES, { message: 'دورية المتابعة غير صحيحة' })
  periodicity!: (typeof PERIODICITIES)[number];

  @Text(1000)
  vision?: string | null;

  @Text(1500)
  mission?: string | null;

  @IsOptional() @IsArray() @ArrayMaxSize(20) @IsString({ each: true }) @MaxLength(100, { each: true })
  values?: string[];

  @OptUuid()
  unitId?: string | null;

  @IsOptional() @IsArray() @ArrayMaxSize(50) @IsUUID('4', { each: true })
  sharedUnitIds?: string[];

  @OptUuid()
  parentPlanId?: string | null;

  @Text(200)
  ownerName?: string | null;

  /** عند الإنشاء فقط: قالب جاهز يُنسخ هيكله ومؤشراته */
  @Text(40)
  templateKey?: string | null;

  @IsOptional() @IsArray() @ArrayMaxSize(6) @ValidateNested({ each: true }) @Type(() => LevelDto)
  levels?: LevelDto[];
}

export class TargetDto {
  @IsIn(TARGET_KINDS)
  kind!: (typeof TARGET_KINDS)[number];

  @Text(500, true) @MinLength(2, { message: 'اكتب نص كل مستهدف' })
  text!: string;

  @Nullable() @Type(() => Number) @IsNumber()
  value!: number | null;

  @Text(30)
  unit!: string | null;

  @Nullable() @DateField('تاريخ المستهدف غير صحيح')
  dueDate!: string | null;
}

export class MilestoneDto {
  @Text(300, true) @MinLength(2, { message: 'اكتب عنوان كل معلم' })
  title!: string;

  @Nullable() @DateField('تاريخ المعلم غير صحيح')
  dueDate!: string | null;

  @IsBoolean()
  done!: boolean;

  @Nullable() @DateField('تاريخ إنجاز المعلم غير صحيح')
  doneDate?: string | null;
}

export class ResourceDto {
  @IsIn(RESOURCE_KINDS)
  kind!: (typeof RESOURCE_KINDS)[number];

  @Text(200, true) @MinLength(2, { message: 'اكتب اسم كل مورد' })
  name!: string;

  @Nullable() @Type(() => Number) @IsNumber() @Min(0)
  quantity!: number | null;

  @Text(30)
  unit!: string | null;

  @Nullable() @Type(() => Number) @IsNumber() @Min(0, { message: 'تكلفة المورد لا تكون سالبة' })
  cost!: number | null;
}

export class ItemDto {
  /** عند الإنشاء: العنصر الأب (فارغ = المستوى الأعلى) */
  @OptUuid()
  parentId?: string | null;

  @Text(300, true) @MinLength(2, { message: 'اكتب عنوان العنصر' })
  title!: string;

  @Text(3000)
  description?: string | null;

  @OptUuid()
  ownerUserId?: string | null;

  @Text(200)
  ownerName?: string | null;

  @OptUuid()
  unitId?: string | null;

  @IsOptional() @IsArray() @ArrayMaxSize(30) @IsUUID('4', { each: true })
  participantUnitIds?: string[];

  @Nullable() @DateField('تاريخ البداية غير صحيح')
  startDate?: string | null;

  @Nullable() @DateField('تاريخ النهاية غير صحيح')
  endDate?: string | null;

  @IsOptional() @Num(0, 1000, 'الوزن بين 0 و1000')
  weight?: number;

  @IsOptional() @IsArray() @ArrayMaxSize(30) @ValidateNested({ each: true }) @Type(() => TargetDto)
  targets?: TargetDto[];

  @IsOptional() @IsArray() @ArrayMaxSize(50) @ValidateNested({ each: true }) @Type(() => MilestoneDto)
  milestones?: MilestoneDto[];

  @IsOptional() @IsArray() @ArrayMaxSize(50) @ValidateNested({ each: true }) @Type(() => ResourceDto)
  resources?: ResourceDto[];

  @IsOptional() @IsObject()
  costByYear?: Record<string, number>;

  @Nullable() @IsIn(FUNDING_TYPES)
  fundingType?: (typeof FUNDING_TYPES)[number] | null;

  @OptUuid()
  costCenterId?: string | null;

  @IsOptional() @IsObject()
  customValues?: Record<string, string | number | null>;
}

export class ProgressDto {
  @Num(0, 100, 'نسبة الإنجاز بين 0 و100')
  progress!: number;

  @IsOptional() @IsIn(ITEM_STATES.filter((s) => s !== 'carried_over'), { message: 'حالة التنفيذ غير صحيحة' })
  state?: (typeof ITEM_STATES)[number];

  @Nullable() @DateField('تاريخ التحديث غير صحيح')
  updateDate?: string | null;

  @Text(1000)
  note?: string | null;

  @Text(1000)
  correctiveAction?: string | null;

  /** إنجاز المعالم بنفس ترتيبها */
  @IsOptional() @IsArray() @ArrayMaxSize(50) @IsBoolean({ each: true })
  milestonesDone?: boolean[];
}

export class LinkDto {
  @IsUUID('4', { message: 'اختر العنصر المساهم' })
  fromItemId!: string;

  @IsUUID('4', { message: 'اختر العنصر المستفيد' })
  toItemId!: string;

  @IsString() @MaxLength(30)
  relation!: string;

  @Nullable() @Num(0.01, 100, 'نسبة المساهمة بين 0.01 و100')
  contribution?: number | null;

  @Text(500)
  note?: string | null;
}

export class RefDto {
  @IsIn(REF_SYSTEMS, { message: 'النظام المرتبط غير معروف' })
  system!: (typeof REF_SYSTEMS)[number];

  @IsString({ message: 'اختر العنصر من النظام المرتبط' }) @MinLength(1, { message: 'اختر العنصر من النظام المرتبط' }) @MaxLength(100)
  refId!: string;

  @Nullable() @Num(0.01, 100, 'نسبة المساهمة بين 0.01 و100')
  contribution?: number | null;

  @Text(500)
  note?: string | null;
}

/** نشاط لمعالجة خطر أو تنفيذ إجراء تصحيحي من المراجعة الداخلية: يُنشأ تحت العنصر ويُربط بمرجعه */
export class TreatmentDto {
  @IsIn(['risk', 'audit'], { message: 'المعالجة لخطر أو لتوصية مراجعة' })
  system!: 'risk' | 'audit';

  @IsString() @MinLength(1, { message: 'اختر الخطر أو التوصية' }) @MaxLength(100)
  refId!: string;

  @Text(300)
  title?: string | null;

  @Text(3000)
  description?: string | null;

  @OptUuid()
  ownerUserId?: string | null;

  @Text(200)
  ownerName?: string | null;

  @OptUuid()
  unitId?: string | null;

  @Nullable() @DateField('تاريخ البداية غير صحيح')
  startDate?: string | null;

  @Nullable() @DateField('تاريخ النهاية غير صحيح')
  endDate?: string | null;

  @IsOptional() @IsObject()
  costByYear?: Record<string, number>;

  @Nullable() @IsIn(FUNDING_TYPES)
  fundingType?: (typeof FUNDING_TYPES)[number] | null;
}

export class KpiDto {
  @OptUuid()
  itemId?: string | null;

  @Text(300, true) @MinLength(3, { message: 'اكتب اسم المؤشر' })
  name!: string;

  @Text(1500)
  description?: string | null;

  @Text(30, true) @MinLength(1, { message: 'اختر وحدة القياس' })
  unit!: string;

  @IsIn(KPI_DIRECTIONS)
  direction!: (typeof KPI_DIRECTIONS)[number];

  @IsIn(PERIODICITIES, { message: 'دورية القياس غير صحيحة' })
  frequency!: (typeof PERIODICITIES)[number];

  @IsIn(KPI_AGGREGATIONS)
  aggregation!: (typeof KPI_AGGREGATIONS)[number];

  @Nullable() @Type(() => Number) @IsNumber({}, { message: 'خط الأساس رقم' })
  baseline?: number | null;

  @IsObject({ message: 'حدد مستهدفات المؤشر' })
  targets!: Record<string, number>;

  @IsOptional() @Num(0, 1000, 'الوزن بين 0 و1000')
  weight?: number;

  @Text(200)
  ownerName?: string | null;

  @Text(500)
  dataSource?: string | null;
}

export class ReadingDto {
  @IsString() @MaxLength(10)
  period!: string;

  @Type(() => Number) @IsNumber({}, { message: 'القيمة الفعلية رقم' })
  value!: number;

  @Text(1000)
  note?: string | null;
}

export class SubmitDto {
  @Text(1000)
  note?: string | null;
}

export class DecideDto {
  @IsIn(['approve', 'return', 'reject'])
  decision!: 'approve' | 'return' | 'reject';

  @Text(1000)
  note?: string | null;
}

export class CarryDto {
  @IsUUID('4', { message: 'اختر الخطة التي يُرحّل إليها' })
  targetPlanId!: string;

  @OptUuid()
  targetParentId?: string | null;

  @Text(1000, true) @MinLength(3, { message: 'اكتب سبب الترحيل' })
  note!: string;
}

export class CopyPlanDto {
  @Text(250, true) @MinLength(3, { message: 'اكتب عنوان الخطة الجديدة' })
  title!: string;

  @Year('سنة البداية غير صحيحة')
  startYear!: number;

  @Year('سنة النهاية غير صحيحة')
  endYear!: number;
}

export class UpdatePlanDto extends PartialType(PlanDto) {}
export class UpdateItemDto extends PartialType(ItemDto) {}
export class UpdateKpiDto extends PartialType(KpiDto) {}
export class UpdateLinkDto extends PartialType(LinkDto) {}
