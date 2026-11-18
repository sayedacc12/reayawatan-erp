import { Type } from 'class-transformer';
import {
  ArrayMaxSize, IsArray, IsBoolean, IsEmail, IsIn, IsInt, IsNumber, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, MinLength, ValidateIf, ValidateNested,
} from 'class-validator';
import { FOLLOWUP_KINDS } from './entities/partnerships.entity';

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const COLOR = /^#[0-9a-fA-F]{6}$/;
const opt = (_: unknown, v: unknown) => v !== null && v !== undefined && v !== '';

// ---------------- الإعدادات ----------------

export class TypeDto {
  @IsOptional() @IsUUID() id?: string;
  @IsString() @MinLength(2, { message: 'اكتب اسم نوع الشراكة' }) @MaxLength(120) name!: string;
  @IsOptional() @IsString() @MaxLength(500) description?: string | null;
  @Matches(COLOR) color!: string;
  @IsInt() @Min(0) @Max(100) minScore!: number;
  @IsInt() @Min(1) @Max(120) defaultMonths!: number;
  @IsBoolean() isActive!: boolean;
}
export class TypesDto {
  @IsArray() @ArrayMaxSize(40) @ValidateNested({ each: true }) @Type(() => TypeDto) types!: TypeDto[];
}

export class ClassDto {
  @IsOptional() @IsUUID() id?: string;
  @IsString() @MinLength(2, { message: 'اكتب اسم التصنيف' }) @MaxLength(120) name!: string;
  @IsOptional() @IsString() @MaxLength(500) description?: string | null;
  @Matches(COLOR) color!: string;
  @IsBoolean() isActive!: boolean;
}
export class ClassesDto {
  @IsArray() @ArrayMaxSize(40) @ValidateNested({ each: true }) @Type(() => ClassDto) classes!: ClassDto[];
}

export class CriterionDto {
  @IsOptional() @IsUUID() id?: string;
  @IsString() @MinLength(2, { message: 'اكتب اسم المعيار' }) @MaxLength(200) name!: string;
  @IsOptional() @IsString() @MaxLength(800) guide?: string | null;
  @IsInt({ message: 'الوزن رقم صحيح' }) @Min(1) @Max(100) weight!: number;
  @IsBoolean() knockout!: boolean;
  @IsBoolean() isActive!: boolean;
}
export class TierDto {
  @IsString() @Matches(/^[a-z][a-z0-9_]{1,29}$/) key!: string;
  @IsString() @MinLength(2) @MaxLength(60) label!: string;
  @IsInt() @Min(1) @Max(100) min!: number;
  @Matches(COLOR) color!: string;
}
export class CriteriaDto {
  @IsArray() @ArrayMaxSize(30) @ValidateNested({ each: true }) @Type(() => CriterionDto) criteria!: CriterionDto[];
  @IsArray() @ArrayMaxSize(8) @ValidateNested({ each: true }) @Type(() => TierDto) tiers!: TierDto[];
}

export class CategoryDto {
  @IsOptional() @IsString() @Matches(/^[a-z0-9-]{2,40}$/) id?: string;
  @IsString() @MinLength(2, { message: 'اكتب اسم التبويب' }) @MaxLength(100) name!: string;
  @Matches(COLOR) color!: string;
}
export class CategoriesDto {
  @IsArray() @ArrayMaxSize(30) @ValidateNested({ each: true }) @Type(() => CategoryDto) categories!: CategoryDto[];
}

export class GeneralSettingsDto {
  @IsInt() @Min(7) @Max(365) alertDays!: number;
  @IsInt() @Min(3) @Max(60) evaluationMonths!: number;
  @IsOptional() @IsString() @MaxLength(200) signerName?: string | null;
  @IsOptional() @IsString() @MaxLength(200) signerTitle?: string | null;
  @IsOptional() @IsString() @MaxLength(100) orgCity?: string | null;
  @IsOptional() @IsString() @MaxLength(60) orgLicense?: string | null;
  @IsOptional() @IsString() @MaxLength(100) courtCity?: string | null;
}

// ---------------- مكتبة البنود ----------------

export class ClauseDto {
  @IsString() @MinLength(2) @MaxLength(40) categoryId!: string;
  @IsString() @MinLength(2, { message: 'اكتب عنوان البند' }) @MaxLength(200) title!: string;
  @IsArray() @ArrayMaxSize(40) @IsString({ each: true }) @MaxLength(3000, { each: true }) paragraphs!: string[];
  @IsArray() @ArrayMaxSize(40) @IsUUID('all', { each: true }) typeIds!: string[];
  @IsBoolean() isMandatory!: boolean;
  @IsBoolean() isDefault!: boolean;
  @IsBoolean() isActive!: boolean;
}
export class OrderDto {
  @IsArray() @ArrayMaxSize(500) @IsUUID('all', { each: true }) ids!: string[];
}

// ---------------- الشركاء والتقييم ----------------

export class PartnerDto {
  @IsString() @MinLength(2, { message: 'اكتب اسم الشريك' }) @MaxLength(200) name!: string;
  @IsOptional() @IsUUID() classId?: string | null;
  @IsArray() @ArrayMaxSize(20) @IsUUID('all', { each: true }) typeIds!: string[];
  @IsOptional() @IsString() @MaxLength(60) registrationNo?: string | null;
  @IsOptional() @IsString() @MaxLength(100) city?: string | null;
  @IsOptional() @IsString() @MaxLength(300) website?: string | null;
  @IsOptional() @IsString() @MaxLength(200) contactName?: string | null;
  @IsOptional() @IsString() @MaxLength(200) contactTitle?: string | null;
  @IsOptional() @IsString() @MaxLength(30) phone?: string | null;
  @IsOptional() @ValidateIf(opt) @IsEmail({}, { message: 'البريد الإلكتروني غير صحيح' }) @MaxLength(200) email?: string | null;
  @IsOptional() @IsString() @MaxLength(5000) about?: string | null;
  @IsOptional() @IsUUID() donorId?: string | null;
  @IsBoolean() showOnWebsite!: boolean;
}

export class PartnerStatusDto {
  @IsIn(['suspended', 'approved', 'prospect']) status!: 'suspended' | 'approved' | 'prospect';
  @IsString() @MinLength(3, { message: 'اكتب السبب' }) @MaxLength(1000) note!: string;
}

export class ScoreDto {
  @IsUUID() criterionId!: string;
  @IsInt() @Min(1, { message: 'اختر درجة من 1 إلى 5 لكل معيار' }) @Max(5) score!: number;
  @IsOptional() @IsString() @MaxLength(500) note?: string | null;
}
export class EvaluationDto {
  @IsUUID('all', { message: 'اختر نوع الشراكة' }) typeId!: string;
  @IsArray() @ArrayMaxSize(30) @ValidateNested({ each: true }) @Type(() => ScoreDto) scores!: ScoreDto[];
  @IsOptional() @IsString() @MaxLength(3000) recommendation?: string | null;
  @IsBoolean() submit!: boolean;
}
export class DecisionDto {
  @IsIn(['approve', 'reject', 'return']) decision!: 'approve' | 'reject' | 'return';
  @IsOptional() @IsString() @MaxLength(1000) note?: string | null;
}

// ---------------- العقود ----------------

export class NewContractDto {
  @IsUUID('all', { message: 'اختر الشريك' }) partnerId!: string;
  @IsUUID('all', { message: 'اختر نوع الشراكة' }) typeId!: string;
  @IsString() @MinLength(3, { message: 'اكتب عنوان العقد' }) @MaxLength(250) title!: string;
  @Matches(DATE, { message: 'تاريخ البداية غير صحيح' }) startsOn!: string;
  @Matches(DATE, { message: 'تاريخ النهاية غير صحيح' }) endsOn!: string;
  @IsOptional() @IsNumber() @Min(0) value?: number | null;
  @IsOptional() @IsUUID() projectId?: string | null;
  @IsOptional() @IsString() @MaxLength(200) orgSignerName?: string | null;
  @IsOptional() @IsString() @MaxLength(200) orgSignerTitle?: string | null;
}

export class ItemDto {
  @IsString() @MinLength(1) @MaxLength(60) key!: string;
  @IsOptional() @IsUUID() clauseId?: string | null;
  @IsString() @MinLength(2) @MaxLength(40) categoryId!: string;
  @IsString() @MinLength(2, { message: 'كل بند يحتاج عنوانًا' }) @MaxLength(200) title!: string;
  @IsArray() @ArrayMaxSize(40) @IsString({ each: true }) @MaxLength(3000, { each: true }) paragraphs!: string[];
  /** للعرض فقط: الاسم من الإعدادات والإلزام من العقد المحفوظ */
  @IsOptional() @IsString() @MaxLength(100) categoryName?: string;
  @IsOptional() @IsBoolean() mandatory?: boolean;
}
export class TermsDto {
  @IsString() @MinLength(3) @MaxLength(250) title!: string;
  @Matches(DATE) startsOn!: string;
  @Matches(DATE) endsOn!: string;
  @IsOptional() @IsNumber() @Min(0) value?: number | null;
  @IsOptional() @IsUUID() projectId?: string | null;
  @IsOptional() @IsString() @MaxLength(200) orgSignerName?: string | null;
  @IsOptional() @IsString() @MaxLength(200) orgSignerTitle?: string | null;
}
export class UpdateContractDto {
  @IsOptional() @ValidateNested() @Type(() => TermsDto) terms?: TermsDto;
  @IsOptional() @IsArray() @ArrayMaxSize(120) @ValidateNested({ each: true }) @Type(() => ItemDto) items?: ItemDto[];
}
export class NoteDto {
  @IsOptional() @IsString() @MaxLength(1000) note?: string | null;
}
export class ReasonDto {
  @IsString() @MinLength(3, { message: 'اكتب السبب' }) @MaxLength(1000) note!: string;
}
export class ManualSignDto {
  @IsString() @MinLength(3, { message: 'اكتب اسم موقّع الشريك' }) @MaxLength(200) signerName!: string;
  @IsString() @MinLength(2) @MaxLength(200) signerTitle!: string;
  @Matches(DATE, { message: 'تاريخ التوقيع غير صحيح' }) signedOn!: string;
}
export class SignDto {
  @IsString() @MinLength(3, { message: 'اكتب اسم الموقّع' }) @MaxLength(200) signerName!: string;
  @IsString() @MinLength(2, { message: 'اكتب صفة الموقّع' }) @MaxLength(200) signerTitle!: string;
  @IsOptional() @IsString() @MaxLength(60) registrationNo?: string | null;
  @IsBoolean() agree!: boolean;
}
export class ChangesDto {
  @IsString() @MinLength(3, { message: 'اكتب التعديل المطلوب' }) @MaxLength(3000) note!: string;
}

export class FollowupDto {
  @IsString() @MinLength(3, { message: 'اكتب عنوان المتابعة' }) @MaxLength(250) title!: string;
  @IsIn(Object.keys(FOLLOWUP_KINDS)) kind!: string;
  @IsIn(['org', 'partner']) party!: 'org' | 'partner';
  @Matches(DATE, { message: 'تاريخ الاستحقاق غير صحيح' }) dueDate!: string;
  @IsOptional() @IsString() @MaxLength(200) responsible?: string | null;
  @IsOptional() @IsString() @MaxLength(1000) note?: string | null;
}
export class FollowupDoneDto {
  @IsBoolean() done!: boolean;
  @IsOptional() @IsString() @MaxLength(1000) note?: string | null;
}
