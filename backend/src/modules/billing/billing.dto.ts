import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsEmail, IsIn, IsInt, IsNumber, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, MinLength, ValidateNested,
} from 'class-validator';
import { BILLING_MODES, CUSTOMER_KINDS, DOC_KINDS, DOC_STATUS, DOC_TYPES, ID_TYPES, ITEM_KINDS, VAT_CATEGORIES, ZATCA_ENVS } from './entities/billing.entity';

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const trim = () => Transform(({ value }) => (typeof value === 'string' ? value.trim() || null : value));
const digits = () => Transform(({ value }) => (typeof value === 'string' ? value.replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d))).replace(/\s+/g, '') || null : value));

export class AddressDto {
  @IsOptional() @IsString() @MaxLength(200) @trim() street?: string | null;
  @IsOptional() @digits() @Matches(/^\d{4}$/, { message: 'رقم المبنى 4 أرقام' }) buildingNo?: string | null;
  @IsOptional() @digits() @Matches(/^\d{4}$/, { message: 'الرقم الإضافي 4 أرقام' }) additionalNo?: string | null;
  @IsOptional() @IsString() @MaxLength(120) @trim() district?: string | null;
  @IsOptional() @IsString() @MaxLength(120) @trim() city?: string | null;
  @IsOptional() @digits() @Matches(/^\d{5}$/, { message: 'الرمز البريدي 5 أرقام' }) postalCode?: string | null;
  @IsOptional() @IsString() @Matches(/^[A-Z]{2}$/, { message: 'رمز الدولة حرفان مثل SA' }) country?: string | null;
}

export class BillingSettingsDto {
  @IsIn(Object.keys(BILLING_MODES).filter((m) => m !== 'integrated'), { message: 'الربط مع منصة «فاتورة» يُفعّل من شاشة الربط بعد اكتماله' }) mode!: 'off' | 'unregistered' | 'registered';
  @IsOptional() @IsString() @MaxLength(250) @trim() sellerName?: string | null;
  @IsOptional() @IsString() @MaxLength(250) @trim() sellerNameEn?: string | null;
  @IsOptional() @digits() @Matches(/^3\d{13}3$/, { message: 'الرقم الضريبي 15 رقمًا يبدأ بـ 3 وينتهي بـ 3' }) vatNumber?: string | null;
  @IsOptional() @IsIn(Object.keys(ID_TYPES)) idType?: keyof typeof ID_TYPES | null;
  @IsOptional() @IsString() @MaxLength(40) @digits() idNumber?: string | null;
  @IsOptional() @ValidateNested() @Type(() => AddressDto) address?: AddressDto | null;
  @IsNumber() @Min(0) @Max(100) vatRate!: number;
  @IsOptional() @IsUUID() receivablesAccountId?: string | null;
  @IsOptional() @IsUUID() vatOutputAccountId?: string | null;
  @IsOptional() @IsUUID() revenueAccountId?: string | null;
  @IsOptional() @IsUUID() customerCategoryId?: string | null;
  @IsOptional() @IsUUID() analyticId?: string | null;
  @IsInt() @Min(0) @Max(365) paymentDays!: number;
  @IsOptional() @IsBoolean() separateIssuer?: boolean;
  @IsOptional() @IsString() @MaxLength(2000) @trim() terms?: string | null;
}

export class CustomerDto {
  @IsIn(Object.keys(CUSTOMER_KINDS)) kind!: keyof typeof CUSTOMER_KINDS;
  @IsString() @MinLength(2, { message: 'اكتب اسم العميل' }) @MaxLength(250) @trim() name!: string;
  @IsOptional() @IsString() @MaxLength(250) @trim() nameEn?: string | null;
  @IsOptional() @digits() @Matches(/^3\d{13}3$/, { message: 'الرقم الضريبي للعميل 15 رقمًا يبدأ بـ 3 وينتهي بـ 3' }) vatNumber?: string | null;
  @IsOptional() @IsIn(Object.keys(ID_TYPES)) idType?: keyof typeof ID_TYPES | null;
  @IsOptional() @IsString() @MaxLength(40) @digits() idNumber?: string | null;
  @IsOptional() @ValidateNested() @Type(() => AddressDto) address?: AddressDto | null;
  @IsOptional() @digits() @Matches(/^(05\d{8}|01[1-7]\d{7}|9200\d{5}|\+?\d{8,15})$/, { message: 'رقم الهاتف غير صحيح' }) phone?: string | null;
  @IsOptional() @IsEmail({}, { message: 'البريد الإلكتروني غير صحيح' }) @MaxLength(200) email?: string | null;
  @IsOptional() @IsBoolean() isActive?: boolean;
  @IsOptional() @IsString() @MaxLength(1000) @trim() notes?: string | null;
}

export class ItemDto {
  @IsOptional() @IsString() @MaxLength(30) @Matches(/^[A-Za-z0-9-]*$/, { message: 'رمز الصنف حروف إنجليزية وأرقام فقط' }) @trim() code?: string | null;
  @IsString() @MinLength(2, { message: 'اكتب اسم الصنف أو الخدمة' }) @MaxLength(250) @trim() name!: string;
  @IsOptional() @IsString() @MaxLength(250) @trim() nameEn?: string | null;
  @IsIn(Object.keys(ITEM_KINDS)) kind!: keyof typeof ITEM_KINDS;
  @IsOptional() @IsString() @MaxLength(40) @trim() unit?: string | null;
  @IsNumber({ maxDecimalPlaces: 2 }, { message: 'السعر رقم بخانتين عشريتين على الأكثر' }) @Min(0) @Max(100_000_000) price!: number;
  @IsIn(Object.keys(VAT_CATEGORIES)) vatCategory!: keyof typeof VAT_CATEGORIES;
  @IsOptional() @IsString() @MaxLength(20) reasonCode?: string | null;
  @IsOptional() @IsUUID() revenueAccountId?: string | null;
  @IsOptional() @IsBoolean() isActive?: boolean;
}

export class DocLineDto {
  @IsOptional() @IsUUID() itemId?: string | null;
  /** السطر المقابل في الفاتورة الأصلية (للإشعار الدائن) */
  @IsOptional() @IsUUID() refLineId?: string | null;
  @IsOptional() @IsString() @MaxLength(500) @trim() description?: string | null;
  @IsOptional() @IsString() @MaxLength(40) @trim() unit?: string | null;
  @IsNumber({ maxDecimalPlaces: 3 }, { message: 'الكمية رقم بثلاث خانات عشرية على الأكثر' }) @Min(0.001, { message: 'الكمية أكبر من صفر' }) @Max(10_000_000) qty!: number;
  @IsNumber({ maxDecimalPlaces: 2 }, { message: 'السعر رقم بخانتين عشريتين على الأكثر' }) @Min(0) @Max(100_000_000) unitPrice!: number;
  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }, { message: 'الخصم رقم بخانتين عشريتين على الأكثر' }) @Min(0) @Max(100_000_000) discount?: number;
  /** الفئة الضريبية للسطر (تُؤخذ من الصنف إن لم تُحدد) */
  @IsOptional() @IsIn(Object.keys(VAT_CATEGORIES)) category?: keyof typeof VAT_CATEGORIES;
  @IsOptional() @IsString() @MaxLength(20) reasonCode?: string | null;
}

/** فاتورة أو إشعار دائن أو مدين */
export class DocDto {
  @IsIn(Object.keys(DOC_KINDS)) kind!: keyof typeof DOC_KINDS;
  /** نوع الفاتورة (يُحدد آليًا من وضع الشركة ونوع العميل إن لم يُرسل) */
  @IsOptional() @IsIn(Object.keys(DOC_TYPES)) docType?: keyof typeof DOC_TYPES;
  @IsOptional() @IsUUID() customerId?: string | null;
  /** اسم المشتري للفاتورة المبسطة بلا عميل مسجل */
  @IsOptional() @IsString() @MaxLength(250) @trim() buyerName?: string | null;
  @IsOptional() @IsUUID() refId?: string | null;
  @IsOptional() @IsString() @MaxLength(500) @trim() reason?: string | null;
  @IsOptional() @Matches(DATE, { message: 'تاريخ التوريد غير صحيح' }) supplyDate?: string | null;
  @IsOptional() @Matches(DATE, { message: 'تاريخ الاستحقاق غير صحيح' }) dueDate?: string | null;
  @IsOptional() @IsUUID() analyticId?: string | null;
  @IsArray() @ArrayMinSize(1, { message: 'أضف سطرًا واحدًا على الأقل' }) @ArrayMaxSize(300) @ValidateNested({ each: true }) @Type(() => DocLineDto) lines!: DocLineDto[];
  @IsOptional() @IsString() @MaxLength(2000) @trim() notes?: string | null;
}

export class IssueDto {
  /** تاريخ الإصدار (افتراضيًا اليوم). لا يُقبل تاريخ آخر بعد الربط مع منصة «فاتورة» */
  @IsOptional() @Matches(DATE, { message: 'تاريخ الإصدار غير صحيح' }) date?: string | null;
}

export class CollectDto {
  @Matches(DATE, { message: 'تاريخ السند غير صحيح' }) date!: string;
  @IsIn(['cash', 'transfer', 'card']) method!: 'cash' | 'transfer' | 'card';
  @IsUUID() cashAccountId!: string;
  @IsNumber({ maxDecimalPlaces: 2 }, { message: 'المبلغ رقم بخانتين عشريتين على الأكثر' }) @Min(0.01) @Max(1_000_000_000) amount!: number;
  @IsOptional() @IsString() @MaxLength(500) @trim() note?: string | null;
}

export class DocListQueryDto {
  @IsOptional() @IsIn(Object.keys(DOC_STATUS)) status?: string;
  @IsOptional() @IsIn(Object.keys(DOC_KINDS)) kind?: string;
  @IsOptional() @IsIn(Object.keys(DOC_TYPES)) docType?: string;
  @IsOptional() @IsUUID() customer?: string;
  @IsOptional() @IsString() @MaxLength(100) q?: string;
  @IsOptional() @Matches(DATE) from?: string;
  @IsOptional() @Matches(DATE) to?: string;
  /** pending = بانتظار الإصدار، open = غير محصلة، overdue = متأخرة */
  @IsOptional() @IsIn(['pending', 'open', 'overdue', 'drafts']) view?: string;
}

export class CustomerListQueryDto {
  @IsOptional() @IsString() @MaxLength(100) q?: string;
  @IsOptional() @IsIn(Object.keys(CUSTOMER_KINDS)) kind?: string;
  @IsOptional() @IsIn(['active', 'stopped']) status?: string;
}

export class StatementQueryDto {
  @IsOptional() @Matches(DATE) from?: string;
  @IsOptional() @Matches(DATE) to?: string;
}

export class AsOfQueryDto {
  @IsOptional() @Matches(DATE) asOf?: string;
}

export class ReasonDto {
  @IsString() @MinLength(3, { message: 'اكتب السبب' }) @MaxLength(500) @trim() reason!: string;
}

export class ZatcaEnvDto {
  @IsIn(Object.keys(ZATCA_ENVS)) env!: keyof typeof ZATCA_ENVS;
}

export class ZatcaOnboardDto {
  @IsOptional() @IsString() @Matches(/^\d{6}$/, { message: 'رمز التحقق (OTP) 6 أرقام' }) otp?: string;
}
