import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize, ArrayUnique, IsArray, IsBoolean, IsDateString, IsEmail, IsIn, IsInt, IsNumber, IsOptional, IsString,
  Matches, Max, MaxLength, Min, MinLength, ValidateNested,
} from 'class-validator';
import { IsValidPassword } from '../validation';
import { BILLING_CYCLES, BillingCycle, SUBSCRIPTION_STATUSES, SubscriptionStatus } from '../entities/organization.entity';

const SLUG = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;
const SLUG_MSG = 'المعرف بحروف إنجليزية صغيرة وأرقام وشرطة فقط، مثل al-bir';
const PHONE = /^\+?[0-9 ]{9,16}$/;
const trim = () => Transform(({ value }) => (typeof value === 'string' ? value.trim() : value));
const lower = () => Transform(({ value }) => (typeof value === 'string' ? value.trim().toLowerCase() : value));
const emptyToUndefined = () => Transform(({ value }) => (value === '' || value === null ? undefined : value));
/** القيم من نموذج multipart تصل نصوصًا */
const toBool = () => Transform(({ value }) => value === true || value === 'true' || value === '1');

/**
 * بيانات طلب الاشتراك (البيانات الرئيسية للجمعية). تصل من نموذج multipart مع ملف الترخيص.
 * بيانات المدير التنفيذي وعضو مجلس الإدارة حقول مسطحة لتناسب النموذج.
 */
export class ApplicationDto {
  @trim() @IsString() @MinLength(3, { message: 'اسم الجمعية قصير جدًا' }) @MaxLength(200)
  orgName!: string;

  @lower() @Matches(SLUG, { message: SLUG_MSG })
  proposedSlug!: string;

  @trim() @IsString() @MinLength(2, { message: 'اكتب مدينة الجمعية' }) @MaxLength(100)
  city!: string;

  @lower() @IsEmail({}, { message: 'بريد الجمعية غير صحيح' })
  orgEmail!: string;

  @trim() @Matches(PHONE, { message: 'رقم هاتف الجمعية غير صحيح' })
  orgPhone!: string;

  @trim() @IsString() @MinLength(1, { message: 'اكتب رقم الترخيص' }) @MaxLength(50)
  licenseNumber!: string;

  @IsDateString({}, { message: 'تاريخ بداية الترخيص مطلوب' })
  licenseStartDate!: string;

  @emptyToUndefined() @IsOptional() @IsDateString({}, { message: 'تاريخ نهاية الترخيص غير صحيح' })
  licenseEndDate?: string;

  @trim() @IsString() @MinLength(3, { message: 'اكتب اسم المدير التنفيذي' }) @MaxLength(200)
  directorName!: string;

  @trim() @Matches(PHONE, { message: 'جوال المدير التنفيذي غير صحيح' })
  directorPhone!: string;

  @lower() @IsEmail({}, { message: 'بريد المدير التنفيذي غير صحيح' })
  directorEmail!: string;

  @trim() @IsString() @MinLength(3, { message: 'اكتب اسم عضو مجلس الإدارة' }) @MaxLength(200)
  boardName!: string;

  @trim() @IsString() @MinLength(2, { message: 'اكتب منصب عضو مجلس الإدارة' }) @MaxLength(100)
  boardPosition!: string;

  @trim() @Matches(PHONE, { message: 'جوال عضو مجلس الإدارة غير صحيح' })
  boardPhone!: string;

  @lower() @IsEmail({}, { message: 'بريد عضو مجلس الإدارة غير صحيح' })
  boardEmail!: string;

  /** مدير نظام الجمعية (يُنشأ حسابه عند الاعتماد). اختياري فقط عند استكمال بيانات جمعية قائمة */
  @emptyToUndefined() @IsOptional() @trim() @IsString() @MinLength(3, { message: 'اكتب اسم مدير النظام' }) @MaxLength(200)
  adminFullName?: string;

  @emptyToUndefined() @IsOptional() @lower() @IsEmail({}, { message: 'بريد مدير النظام غير صحيح' })
  adminEmail?: string;

  @emptyToUndefined() @IsOptional() @IsValidPassword('كلمة مرور مدير النظام 8 أحرف على الأقل')
  adminPassword?: string;
}

/** عند تعديل البيانات الرئيسية: كل الحقول اختيارية */
export class UpdateApplicationDto {
  @IsOptional() @trim() @IsString() @MinLength(3, { message: 'اسم الجمعية قصير جدًا' }) @MaxLength(200) orgName?: string;
  @IsOptional() @lower() @Matches(SLUG, { message: SLUG_MSG }) proposedSlug?: string;
  @IsOptional() @trim() @IsString() @MinLength(2) @MaxLength(100) city?: string;
  @IsOptional() @lower() @IsEmail({}, { message: 'بريد الجمعية غير صحيح' }) orgEmail?: string;
  @IsOptional() @trim() @Matches(PHONE, { message: 'رقم هاتف الجمعية غير صحيح' }) orgPhone?: string;
  @IsOptional() @trim() @IsString() @MinLength(1) @MaxLength(50) licenseNumber?: string;
  @IsOptional() @IsDateString({}, { message: 'تاريخ بداية الترخيص غير صحيح' }) licenseStartDate?: string;
  @emptyToUndefined() @IsOptional() @IsDateString({}, { message: 'تاريخ نهاية الترخيص غير صحيح' }) licenseEndDate?: string;
  @IsOptional() @trim() @IsString() @MinLength(3) @MaxLength(200) directorName?: string;
  @IsOptional() @trim() @Matches(PHONE, { message: 'جوال المدير التنفيذي غير صحيح' }) directorPhone?: string;
  @IsOptional() @lower() @IsEmail({}, { message: 'بريد المدير التنفيذي غير صحيح' }) directorEmail?: string;
  @IsOptional() @trim() @IsString() @MinLength(3) @MaxLength(200) boardName?: string;
  @IsOptional() @trim() @IsString() @MinLength(2) @MaxLength(100) boardPosition?: string;
  @IsOptional() @trim() @Matches(PHONE, { message: 'جوال عضو مجلس الإدارة غير صحيح' }) boardPhone?: string;
  @IsOptional() @lower() @IsEmail({}, { message: 'بريد عضو مجلس الإدارة غير صحيح' }) boardEmail?: string;
  @emptyToUndefined() @IsOptional() @trim() @IsString() @MinLength(3) @MaxLength(200) adminFullName?: string;
  @emptyToUndefined() @IsOptional() @lower() @IsEmail({}, { message: 'بريد مدير النظام غير صحيح' }) adminEmail?: string;
  @emptyToUndefined() @IsOptional() @IsValidPassword('كلمة مرور مدير النظام 8 أحرف على الأقل') adminPassword?: string;
}

/** مدير المنصة يسجّل طلبًا نيابة عن جمعية، أو يستكمل البيانات الرئيسية لجمعية قائمة */
export class AdminApplicationDto extends ApplicationDto {
  @emptyToUndefined() @IsOptional() @IsString()
  organizationId?: string;
}

export class NoteDto {
  @trim() @IsString() @MinLength(3, { message: 'اكتب السبب بوضوح' }) @MaxLength(2000)
  note!: string;
}

/** الشاشات المسموحة: allScreens = كل الشاشات، وإلا القائمة المحددة */
export class AccessDto {
  @IsBoolean()
  allScreens!: boolean;

  @IsArray() @ArrayUnique() @IsString({ each: true })
  screens!: string[];

  @IsArray() @ArrayUnique() @IsString({ each: true })
  modules!: string[];
}

export class ApproveDto extends AccessDto {
  @lower() @Matches(SLUG, { message: SLUG_MSG })
  slug!: string;

  @Type(() => Number) @IsNumber({}, { message: 'قيمة الاشتراك غير صحيحة' }) @Min(0, { message: 'قيمة الاشتراك لا تكون سالبة' }) @Max(10_000_000)
  price!: number;

  @IsIn(BILLING_CYCLES, { message: 'دورة السداد غير صحيحة' })
  billingCycle!: BillingCycle;

  @Type(() => Number) @IsInt() @Min(1, { message: 'مدة الاشتراك شهر على الأقل' }) @Max(60, { message: 'أقصى مدة للعقد 60 شهرًا' })
  months!: number;

  @Type(() => Number) @IsInt() @Min(0) @Max(180, { message: 'أقصى فترة تجريبية 180 يومًا' })
  trialDays!: number;

  @IsDateString({}, { message: 'تاريخ بداية الاشتراك غير صحيح' })
  startsOn!: string;
}

/** تعديل يدوي لحالة اشتراك جمعية (تمديد التجربة، تجديد، ...) */
export class SubscriptionDto {
  @IsIn(SUBSCRIPTION_STATUSES, { message: 'حالة الاشتراك غير صحيحة' })
  status!: SubscriptionStatus;

  @emptyToUndefined() @IsOptional() @IsDateString({}, { message: 'تاريخ نهاية التجربة غير صحيح' })
  trialEndsOn?: string;

  @emptyToUndefined() @IsOptional() @IsDateString({}, { message: 'تاريخ بداية الاشتراك غير صحيح' })
  startsOn?: string;

  @emptyToUndefined() @IsOptional() @IsDateString({}, { message: 'تاريخ نهاية الاشتراك غير صحيح' })
  endsOn?: string;
}

export class ContractItemDto {
  @IsString() @MaxLength(64)
  key!: string;

  @IsOptional() @IsString()
  clauseId?: string | null;

  @trim() @IsString() @MinLength(2, { message: 'عنوان البند مطلوب' }) @MaxLength(200)
  title!: string;

  @IsArray() @ArrayMaxSize(50) @IsString({ each: true }) @MaxLength(4000, { each: true })
  paragraphs!: string[];

  @IsBoolean()
  mandatory!: boolean;
}

export class ContractTermsDto {
  @Type(() => Number) @IsNumber() @Min(0) @Max(10_000_000)
  price!: number;

  @IsIn(BILLING_CYCLES, { message: 'دورة السداد غير صحيحة' })
  billingCycle!: BillingCycle;

  @Type(() => Number) @IsNumber() @Min(0) @Max(100)
  vatRate!: number;

  @Type(() => Number) @IsInt() @Min(1) @Max(60)
  months!: number;

  @IsDateString({}, { message: 'تاريخ بداية الاشتراك غير صحيح' })
  startsOn!: string;

  @Type(() => Number) @IsInt() @Min(0) @Max(180)
  trialDays!: number;

  @IsBoolean()
  allScreens!: boolean;

  @IsArray() @ArrayUnique() @IsString({ each: true })
  screens!: string[];
}

export class UpdateContractDto {
  @IsOptional() @ValidateNested() @Type(() => ContractTermsDto)
  terms?: ContractTermsDto;

  @IsOptional() @IsArray() @ArrayMaxSize(80) @ValidateNested({ each: true }) @Type(() => ContractItemDto)
  items?: ContractItemDto[];
}

export class ClauseDto {
  @trim() @IsString() @MinLength(2, { message: 'عنوان البند مطلوب' }) @MaxLength(200)
  title!: string;

  @IsArray() @ArrayMaxSize(50) @IsString({ each: true }) @MaxLength(4000, { each: true })
  paragraphs!: string[];

  @IsOptional() @IsBoolean()
  isMandatory?: boolean;

  @IsOptional() @IsBoolean()
  isActive?: boolean;
}

export class OrderDto {
  @IsArray() @ArrayUnique() @IsString({ each: true })
  ids!: string[];
}

export class ProviderDto {
  @trim() @IsString() @MinLength(2, { message: 'اسم مقدم الخدمة مطلوب' }) @MaxLength(200) name!: string;
  @trim() @IsString() @MaxLength(50) crNumber!: string;
  @trim() @IsString() @MaxLength(50) vatNumber!: string;
  @trim() @IsString() @MaxLength(300) address!: string;
  @trim() @IsString() @MaxLength(254) email!: string;
  @trim() @IsString() @MaxLength(100) courtCity!: string;
  @Type(() => Number) @IsNumber() @Min(0) @Max(100) vatRate!: number;
}

export class SignContractDto {
  @trim() @IsString() @MinLength(3, { message: 'اكتب اسم الموقّع كاملًا' }) @MaxLength(200)
  signerName!: string;

  @trim() @IsString() @MinLength(2, { message: 'اكتب صفة الموقّع (مثل: المدير التنفيذي)' }) @MaxLength(200)
  signerTitle!: string;

  /** تحقق بسيط من هوية الجمعية: رقم الترخيص المسجل */
  @trim() @IsString() @MinLength(1, { message: 'اكتب رقم ترخيص الجمعية للتحقق' })
  licenseNumber!: string;

  @toBool() @IsBoolean() @IsIn([true], { message: 'يجب الإقرار بالموافقة على بنود العقد' })
  agree!: boolean;
}
