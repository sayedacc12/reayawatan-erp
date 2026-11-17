import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize, IsArray, IsDateString, IsIn, IsInt, IsNumber, IsObject, IsOptional, IsString, IsUUID, Max, MaxLength, Min, MinLength,
  ValidateIf, ValidateNested,
} from 'class-validator';
import { AREA_CATEGORIES, CONTROL_RATINGS, OPINIONS, RISK_LEVELS, SCOPE_TYPES } from './entities/audit.entity';

const trim = () => Transform(({ value }) => (typeof value === 'string' ? value.trim() || null : value));
const Nullable = (): PropertyDecorator => (t, k) => [IsOptional(), ValidateIf((_: unknown, v: unknown) => v !== null && v !== '')].forEach((d) => d(t, k));
const DateField = (msg: string) => IsDateString({ strict: true }, { message: msg });
const Score = (msg: string) => (t: object, k: string | symbol) => {
  Type(() => Number)(t, k);
  IsInt({ message: msg })(t, k);
  Min(1, { message: msg })(t, k);
  Max(5, { message: msg })(t, k);
};

export class RiskRefDto {
  @IsString() @MaxLength(60) id!: string;
  @IsString() @MaxLength(40) code!: string;
  @IsString() @MaxLength(300) title!: string;
  @IsString() @MaxLength(30) level!: string;
  @IsOptional() @IsNumber() score!: number | null;
}

export class ControlRefDto {
  @IsString() @MaxLength(60) id!: string;
  @IsString() @MaxLength(40) code!: string;
  @IsString() @MaxLength(300) name!: string;
}

class RiskRefs {
  @IsOptional() @IsArray() @ArrayMaxSize(30) @ValidateNested({ each: true }) @Type(() => RiskRefDto)
  riskRefs?: RiskRefDto[];
}

// ---------------- الإعدادات ----------------

export class SettingsDto {
  @IsObject() riskBands!: { medium: number; high: number; critical: number };
  @IsObject() frequency!: Record<string, number>;
  @IsObject() dueDays!: Record<string, number>;
  @Type(() => Number) @IsInt() @Min(0) @Max(60) reminderDays!: number;
}

// ---------------- مجالات المراجعة ----------------

export class AreaDto extends RiskRefs {
  @trim() @IsString() @MinLength(1, { message: 'اكتب رمز المجال' }) @MaxLength(30)
  code!: string;

  @trim() @IsString() @MinLength(2, { message: 'اكتب اسم المجال' }) @MaxLength(200)
  name!: string;

  @IsIn(AREA_CATEGORIES, { message: 'اختر تصنيف المجال' })
  category!: string;

  @IsIn(['unit', 'outside'], { message: 'حدد هل المجال داخل الهيكل أو خارجه' })
  scopeType!: 'unit' | 'outside';

  @Nullable() @IsUUID('4', { message: 'اختر الوحدة من الهيكل' })
  unitId?: string | null;

  @Nullable() @trim() @IsString() @MaxLength(200)
  outsideLabel?: string | null;

  @Nullable() @trim() @IsString() @MaxLength(2000)
  description?: string | null;

  @Score('الاحتمال من 1 إلى 5') likelihood!: number;
  @Score('الأثر من 1 إلى 5') impact!: number;

  @IsIn(CONTROL_RATINGS, { message: 'اختر تقييم الضوابط' })
  controlRating!: string;

  @Nullable() @DateField('تاريخ آخر مراجعة غير صحيح')
  lastAuditDate?: string | null;

  @IsOptional() isActive?: boolean;
}

// ---------------- الخطط ----------------

export class PlanDto extends RiskRefs {
  @IsIn(['master', 'sub'], { message: 'حدد نوع الخطة' })
  kind!: 'master' | 'sub';

  @Nullable() @IsUUID('4', { message: 'اختر الخطة الرئيسية' })
  parentId?: string | null;

  @Type(() => Number) @IsInt() @Min(2000) @Max(2100)
  year!: number;

  @trim() @IsString() @MinLength(3, { message: 'اكتب عنوان الخطة' }) @MaxLength(250)
  title!: string;

  @IsIn(SCOPE_TYPES, { message: 'حدد نطاق الخطة' })
  scopeType!: 'org' | 'unit' | 'outside';

  @Nullable() @IsUUID('4', { message: 'اختر الوحدة من الهيكل' })
  unitId?: string | null;

  @Nullable() @trim() @IsString() @MaxLength(200)
  outsideLabel?: string | null;

  @DateField('بداية فترة الخطة غير صحيحة') periodFrom!: string;
  @DateField('نهاية فترة الخطة غير صحيحة') periodTo!: string;

  @Nullable() @trim() @IsString() @MaxLength(5000) objectives?: string | null;
  @Nullable() @trim() @IsString() @MaxLength(5000) methodology?: string | null;

  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(100000)
  availableHours?: number;
}

export class DecisionDto {
  @IsIn(['approve', 'return'], { message: 'القرار غير صحيح' })
  decision!: 'approve' | 'return';

  @Nullable() @trim() @IsString() @MaxLength(1000)
  note?: string | null;
}

/** اقتراح مهام من مجالات المراجعة المستحقة حسب المخاطر */
export class SuggestDto {
  @IsArray() @ArrayMaxSize(100) @IsUUID('4', { each: true })
  areaIds!: string[];
}

// ---------------- المهام ----------------

export class TeamMemberDto {
  @IsUUID('4') userId!: string;
  @trim() @IsString() @MaxLength(60) role!: string;
}

export class EngagementDto extends RiskRefs {
  @IsUUID('4', { message: 'اختر الخطة' })
  planId!: string;

  @Nullable() @IsUUID('4') areaId?: string | null;

  @trim() @IsString() @MinLength(3, { message: 'اكتب عنوان المهمة' }) @MaxLength(250)
  title!: string;

  @Nullable() @trim() @IsString() @MaxLength(5000) objective?: string | null;
  @Nullable() @trim() @IsString() @MaxLength(5000) scope?: string | null;

  @IsIn(['unit', 'outside'], { message: 'حدد الجهة محل المراجعة' })
  scopeType!: 'unit' | 'outside';

  @Nullable() @IsUUID('4', { message: 'اختر الوحدة من الهيكل' }) unitId?: string | null;
  @Nullable() @trim() @IsString() @MaxLength(200) outsideLabel?: string | null;

  @IsIn(RISK_LEVELS, { message: 'اختر أولوية المهمة' })
  priority!: string;

  @DateField('تاريخ البداية المخطط غير صحيح') plannedStart!: string;
  @DateField('تاريخ النهاية المخطط غير صحيح') plannedEnd!: string;

  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(10000) budgetHours?: number;

  @Nullable() @IsUUID('4', { message: 'اختر قائد المهمة' }) leadUserId?: string | null;

  @IsOptional() @IsArray() @ArrayMaxSize(20) @ValidateNested({ each: true }) @Type(() => TeamMemberDto)
  team?: TeamMemberDto[];
}

export class StageDto {
  @IsIn(['start', 'submit', 'return', 'cancel'], { message: 'الإجراء غير صحيح' })
  action!: 'start' | 'submit' | 'return' | 'cancel';

  @Nullable() @trim() @IsString() @MaxLength(1000) note?: string | null;

  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(10000) actualHours?: number;
}

export class ItemDto {
  @trim() @IsString() @MinLength(3, { message: 'اكتب بند المراجعة' }) @MaxLength(300)
  title!: string;

  @Nullable() @trim() @IsString() @MaxLength(5000) criteria?: string | null;
  @Nullable() @trim() @IsString() @MaxLength(5000) procedure?: string | null;

  @IsOptional() @ValidateIf((_, v) => v !== null) @ValidateNested() @Type(() => ControlRefDto)
  controlRef?: ControlRefDto | null;
}

export class ItemResultDto {
  @IsIn(['pending', 'satisfactory', 'finding', 'na'], { message: 'اختر نتيجة البند' })
  result!: 'pending' | 'satisfactory' | 'finding' | 'na';

  @Nullable() @trim() @IsString() @MaxLength(5000) conclusion?: string | null;
}

export class FindingDto extends RiskRefs {
  @IsUUID('4', { message: 'اختر بند المراجعة' })
  itemId!: string;

  @trim() @IsString() @MinLength(3, { message: 'اكتب عنوان الملاحظة' }) @MaxLength(300)
  title!: string;

  @trim() @IsString() @MinLength(5, { message: 'اكتب الملاحظة' }) @MaxLength(10000)
  observation!: string;

  @Nullable() @trim() @IsString() @MaxLength(5000) cause?: string | null;

  @trim() @IsString() @MinLength(5, { message: 'اكتب الأثر أو النتائج المترتبة على الملاحظة' }) @MaxLength(5000)
  effect!: string;

  @IsIn(RISK_LEVELS, { message: 'اختر خطورة الملاحظة' })
  rating!: string;

  @trim() @IsString() @MinLength(5, { message: 'اكتب التوصية الخاصة بالعلاج' }) @MaxLength(5000)
  recommendation!: string;

  @IsUUID('4', { message: 'اختر الجهة المسؤولة من الهيكل التنظيمي' })
  responsibleUnitId!: string;

  @Nullable() @IsUUID('4') responsibleUserId?: string | null;

  @Nullable() @DateField('موعد التنفيذ غير صحيح') dueDate?: string | null;

  @Nullable() @trim() @IsString() @MaxLength(5000) managementResponse?: string | null;
}

export class IssueDto {
  @trim() @IsString() @MinLength(10, { message: 'اكتب ملخص التقرير' }) @MaxLength(10000)
  summary!: string;

  @IsIn(OPINIONS, { message: 'اختر الرأي العام للمراجعة' })
  opinion!: string;
}

export class CloseEngagementDto {
  @Nullable() @trim() @IsString() @MaxLength(2000) note?: string | null;
}

export class DocumentDto {
  @trim() @IsString() @MinLength(2, { message: 'اكتب عنوان المستند' }) @MaxLength(250)
  title!: string;

  @IsOptional() @IsIn(['report', 'evidence', 'closure']) kind?: 'report' | 'evidence' | 'closure';
}

// ---------------- متابعة التوصيات ----------------

export class ActionUpdateDto {
  @Nullable() @trim() @IsString() @MaxLength(3000) text?: string | null;

  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(100) progress?: number;
}

export class AssignDto {
  @Nullable() @IsUUID('4', { message: 'اختر المستخدم' }) assigneeUserId?: string | null;
}

export class ClosureDto {
  @trim() @IsString() @MinLength(3, { message: 'اكتب عنوان تقرير الإغلاق' }) @MaxLength(250)
  title!: string;

  @Nullable() @trim() @IsString() @MaxLength(60) refNo?: string | null;

  @DateField('تاريخ التقرير غير صحيح') date!: string;

  @trim() @IsString() @MinLength(10, { message: 'اكتب ملخص ما تم تنفيذه لعلاج الملاحظة' }) @MaxLength(5000)
  summary!: string;
}

export class VerifyDto {
  @IsIn(['close', 'return'], { message: 'القرار غير صحيح' })
  decision!: 'close' | 'return';

  @Nullable() @trim() @IsString() @MaxLength(2000) note?: string | null;
}

export class ExtendDto {
  @DateField('الموعد الجديد غير صحيح') dueDate!: string;

  @trim() @IsString() @MinLength(5, { message: 'اكتب سبب التمديد' }) @MaxLength(1000)
  reason!: string;
}
