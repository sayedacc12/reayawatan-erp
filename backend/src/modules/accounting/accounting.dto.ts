import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsDateString, IsEmail, IsIn, IsInt, IsNumber, IsOptional, IsString, IsUUID,
  Matches, Max, MaxLength, Min, MinLength, ValidateIf, ValidateNested,
} from 'class-validator';
import { ACCOUNT_KINDS, NATURES, VoucherType } from './entities/accounting.entity';

const trim = () => Transform(({ value }) => (typeof value === 'string' ? value.trim() || null : value));
const Nullable = (): PropertyDecorator => (t, k) => [IsOptional(), ValidateIf((_: unknown, v: unknown) => v !== null && v !== '')].forEach((d) => d(t, k));
const DateField = (msg: string) => IsDateString({ strict: true }, { message: msg });

// ---------------- الافتتاحيات ----------------

export class SetupDto {
  @Type(() => Number) @IsInt({ message: 'اكتب السنة المالية بالأرقام، مثل 2026' }) @Min(2000) @Max(2100)
  fiscalYear!: number;

  @DateField('تاريخ بداية السنة المالية غير صحيح')
  startDate!: string;

  @DateField('تاريخ نهاية السنة المالية غير صحيح')
  endDate!: string;

  @IsBoolean()
  isFirstYear!: boolean;

  @Nullable() @DateField('تاريخ بداية السنة المالية الأولى غير صحيح')
  firstYearStart?: string | null;

  @Nullable() @DateField('تاريخ نهاية السنة المالية الأولى غير صحيح')
  firstYearEnd?: string | null;

  @Nullable() @trim() @Matches(/^\d{15}$/, { message: 'الرقم الضريبي 15 رقمًا' })
  taxNumber?: string | null;

  @Nullable() @Type(() => Number) @IsInt({ message: 'أول رقم لسندات القبض يجب أن يكون رقمًا صحيحًا' }) @Min(1)
  receiptStart?: number | null;

  @Nullable() @Type(() => Number) @IsInt({ message: 'أول رقم لسندات الصرف يجب أن يكون رقمًا صحيحًا' }) @Min(1)
  paymentStart?: number | null;
}

export class SetupUpdateDto {
  @Nullable() @trim() @Matches(/^\d{15}$/, { message: 'الرقم الضريبي 15 رقمًا' })
  taxNumber?: string | null;
}

/** نوع المستند: أساسي، أو نوع سند خاص بالجمعية (يُتحقق من وجوده في الخدمة) */
const TYPE_CODE = /^(journal|receipt|payment|opening|adjustment|d_[a-z0-9]{6,16})$/;

export class SequenceDto {
  @IsString() @Matches(TYPE_CODE, { message: 'نوع السند غير صحيح' })
  voucherType!: VoucherType;

  @Type(() => Number) @IsInt({ message: 'بداية المدى رقم صحيح' }) @Min(1)
  startSerial!: number;

  @Nullable() @Type(() => Number) @IsInt({ message: 'نهاية المدى رقم صحيح' }) @Min(1)
  endSerial?: number | null;
}

export class SequencesDto {
  @IsArray() @ValidateNested({ each: true }) @Type(() => SequenceDto)
  sequences!: SequenceDto[];
}

export class MonthDto {
  @IsUUID()
  fiscalYearId!: string;

  @Matches(/^\d{4}-\d{2}$/, { message: 'الشهر بصيغة 2026-01' })
  month!: string;
}

export class MonthsDto {
  @IsUUID()
  fiscalYearId!: string;

  @IsArray() @ArrayMinSize(1, { message: 'اختر شهرًا واحدًا على الأقل' }) @ArrayMaxSize(24)
  @Matches(/^\d{4}-\d{2}$/, { each: true, message: 'الشهر بصيغة 2026-01' })
  months!: string[];
}

// ---------------- الإعدادات ----------------

export class SettingsDto {
  @IsOptional() @IsIn([2, 3], { message: 'مستويات الحسابات التحليلية 2 أو 3' })
  analyticLevels?: number;

  @Nullable() @IsUUID('4', { message: 'اختر حساب إقفال نتائج النشاط' })
  closingAccountId?: string | null;

  @IsOptional() @IsArray() @ArrayMaxSize(30) @IsString({ each: true }) @MaxLength(120, { each: true })
  warehouseTypes?: string[];
}

export class DocumentTypeDto {
  @trim() @IsString({ message: 'اكتب اسم نوع السند' }) @MinLength(3, { message: 'اكتب اسم نوع السند' }) @MaxLength(80)
  name!: string;

  @Nullable() @trim() @IsString() @MaxLength(300)
  description?: string | null;

  @IsOptional() @IsBoolean()
  isActive?: boolean;
}

export class CategoryDto {
  @trim() @IsString({ message: 'اكتب اسم التصنيف' }) @MinLength(2, { message: 'اكتب اسم التصنيف' }) @MaxLength(120)
  name!: string;

  @IsIn(['customer', 'supplier', 'other'], { message: 'اختر نوع التصنيف' })
  behavior!: 'customer' | 'supplier' | 'other';
}

// ---------------- الدليل المحاسبي ----------------

export class AccountDto {
  @trim() @IsString({ message: 'اكتب رقم الحساب' }) @Matches(/^[0-9A-Za-z.-]{1,30}$/, { message: 'رقم الحساب أرقام أو حروف إنجليزية فقط، بدون مسافات' })
  code!: string;

  @trim() @IsString({ message: 'اكتب اسم الحساب' }) @MinLength(2, { message: 'اكتب اسم الحساب' }) @MaxLength(250)
  name!: string;

  @IsIn(ACCOUNT_KINDS, { message: 'اختر نوع الحساب: جذري أو رئيسي أو فرعي' })
  kind!: (typeof ACCOUNT_KINDS)[number];

  @IsIn(NATURES, { message: 'اختر طبيعة الحساب' })
  nature!: (typeof NATURES)[number];

  @Nullable() @IsUUID('4', { message: 'اختر الحساب الأب' })
  parentId?: string | null;

  @IsOptional() @IsBoolean()
  requiresAnalytic?: boolean;

  @Nullable() @trim() @IsString() @MaxLength(1000)
  description?: string | null;

  @IsOptional() @IsBoolean()
  isActive?: boolean;
}

export class AccountUpdateDto {
  @IsOptional() @trim() @IsString() @Matches(/^[0-9A-Za-z.-]{1,30}$/, { message: 'رقم الحساب أرقام أو حروف إنجليزية فقط، بدون مسافات' })
  code?: string;

  @IsOptional() @trim() @IsString() @MinLength(2, { message: 'اكتب اسم الحساب' }) @MaxLength(250)
  name?: string;

  @IsOptional() @IsIn(ACCOUNT_KINDS)
  kind?: (typeof ACCOUNT_KINDS)[number];

  @IsOptional() @IsIn(NATURES)
  nature?: (typeof NATURES)[number];

  @IsOptional() @IsBoolean()
  requiresAnalytic?: boolean;

  @Nullable() @trim() @IsString() @MaxLength(1000)
  description?: string | null;

  @IsOptional() @IsBoolean()
  isActive?: boolean;
}

export class AnalyticDto {
  @trim() @IsString({ message: 'اكتب رمز الحساب التحليلي' }) @Matches(/^[0-9A-Za-z.-]{1,30}$/, { message: 'الرمز أرقام أو حروف إنجليزية فقط' })
  code!: string;

  @trim() @IsString({ message: 'اكتب اسم الحساب التحليلي' }) @MinLength(2, { message: 'اكتب اسم الحساب التحليلي' }) @MaxLength(250)
  name!: string;

  @IsIn(['main', 'sub'], { message: 'اختر: رئيسي أو فرعي' })
  kind!: 'main' | 'sub';

  @Nullable() @IsUUID('4')
  parentId?: string | null;

  @Nullable() @trim() @IsString() @MaxLength(1000)
  description?: string | null;

  @IsOptional() @IsBoolean()
  isActive?: boolean;
}

export class AnalyticUpdateDto {
  @IsOptional() @trim() @IsString() @Matches(/^[0-9A-Za-z.-]{1,30}$/, { message: 'الرمز أرقام أو حروف إنجليزية فقط' })
  code?: string;

  @IsOptional() @trim() @IsString() @MinLength(2) @MaxLength(250)
  name?: string;

  @Nullable() @trim() @IsString() @MaxLength(1000)
  description?: string | null;

  @IsOptional() @IsBoolean()
  isActive?: boolean;
}

// ---------------- الشركاء والبنوك والمستودعات ----------------

export class AddressDto {
  @trim() @IsString() @MaxLength(80)
  label!: string;

  @trim() @IsString({ message: 'اكتب العنوان' }) @MinLength(2, { message: 'اكتب العنوان' }) @MaxLength(300)
  address!: string;

  @Nullable() @trim() @IsString() @MaxLength(80)
  city?: string | null;
}

export class PartnerDto {
  @trim() @IsString({ message: 'اكتب اسم الشريك' }) @MinLength(2, { message: 'اكتب اسم الشريك' }) @MaxLength(250)
  name!: string;

  @IsUUID('4', { message: 'اختر تصنيف الشريك' })
  categoryId!: string;

  @Nullable() @trim() @IsString() @MaxLength(1000)
  description?: string | null;

  @IsOptional() @IsArray() @ArrayMaxSize(10) @IsString({ each: true }) @Matches(/^[0-9+ -]{5,20}$/, { each: true, message: 'رقم التواصل غير صحيح' })
  phones?: string[];

  @IsOptional() @IsArray() @ArrayMaxSize(10) @IsEmail({}, { each: true, message: 'البريد الإلكتروني غير صحيح' })
  emails?: string[];

  @IsOptional() @IsArray() @ArrayMaxSize(10) @ValidateNested({ each: true }) @Type(() => AddressDto)
  addresses?: AddressDto[];

  @Nullable() @trim() @Matches(/^\d{15}$/, { message: 'الرقم الضريبي 15 رقمًا' })
  taxNumber?: string | null;

  @Nullable() @trim() @Matches(/^\d{10}$/, { message: 'السجل التجاري 10 أرقام' })
  crNumber?: string | null;

  @Nullable() @IsUUID('4', { message: 'اختر الحساب المرتبط' })
  accountId?: string | null;

  @Nullable() @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }, { message: 'الحد الائتماني رقم' }) @Min(0)
  creditLimit?: number | null;

  @IsOptional() @IsBoolean()
  isActive?: boolean;
}

export class CashAccountDto {
  @IsIn(['bank', 'cash'], { message: 'اختر: حساب بنكي أو صندوق نقدية' })
  kind!: 'bank' | 'cash';

  @trim() @IsString({ message: 'اكتب اسم الحساب' }) @MinLength(2, { message: 'اكتب اسم الحساب' }) @MaxLength(200)
  name!: string;

  @Nullable() @trim() @IsString() @MaxLength(200)
  bankName?: string | null;

  @Nullable() @trim() @Matches(/^[0-9-]{4,60}$/, { message: 'رقم الحساب البنكي أرقام فقط' })
  accountNumber?: string | null;

  @Nullable() @Transform(({ value }) => (typeof value === 'string' ? value.replace(/\s+/g, '').toUpperCase() || null : value))
  @Matches(/^SA\d{22}$/, { message: 'رقم الآيبان السعودي يبدأ بـ SA ويليه 22 رقمًا' })
  iban?: string | null;

  @Nullable() @trim() @IsString() @MaxLength(500)
  description?: string | null;

  @IsUUID('4', { message: 'اختر الحساب المرتبط في الدليل المحاسبي' })
  glAccountId!: string;

  @IsOptional() @IsBoolean()
  isActive?: boolean;
}

// ---------------- القيود ----------------

export class AnalyticShareDto {
  @IsUUID('4', { message: 'اختر الحساب التحليلي' })
  analyticId!: string;

  @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }, { message: 'نسبة التوزيع رقم' }) @Min(0.01) @Max(100)
  percent!: number;
}

export class LineDto {
  @IsUUID('4', { message: 'اختر الحساب في كل سطر' })
  accountId!: string;

  @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }, { message: 'المدين رقم بخانتين عشريتين على الأكثر' }) @Min(0)
  debit!: number;

  @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }, { message: 'الدائن رقم بخانتين عشريتين على الأكثر' }) @Min(0)
  credit!: number;

  @Nullable() @trim() @IsString() @MaxLength(500)
  label?: string | null;

  @Nullable() @IsUUID('4')
  partnerId?: string | null;

  @IsOptional() @IsArray() @ArrayMaxSize(20) @ValidateNested({ each: true }) @Type(() => AnalyticShareDto)
  analytic?: AnalyticShareDto[];
}

export class EntryDto {
  @IsString({ message: 'اختر نوع السند' }) @Matches(TYPE_CODE, { message: 'اختر نوع السند' })
  voucherType!: VoucherType;

  @DateField('تاريخ المستند غير صحيح')
  documentDate!: string;

  @trim() @IsString({ message: 'اكتب شرح القيد' }) @MinLength(3, { message: 'اكتب شرح القيد' }) @MaxLength(1000)
  description!: string;

  @Nullable() @trim() @IsString() @MaxLength(250)
  counterparty?: string | null;

  @IsArray() @ArrayMinSize(2, { message: 'القيد يحتاج سطرين على الأقل: مدين ودائن' }) @ArrayMaxSize(300)
  @ValidateNested({ each: true }) @Type(() => LineDto)
  lines!: LineDto[];

  /** حفظ وترحيل مباشرة */
  @IsOptional() @IsBoolean()
  post?: boolean;
}

export class EntryUpdateDto {
  @DateField('تاريخ المستند غير صحيح')
  documentDate!: string;

  @trim() @IsString({ message: 'اكتب شرح القيد' }) @MinLength(3, { message: 'اكتب شرح القيد' }) @MaxLength(1000)
  description!: string;

  @Nullable() @trim() @IsString() @MaxLength(250)
  counterparty?: string | null;

  @IsArray() @ArrayMinSize(2, { message: 'القيد يحتاج سطرين على الأقل: مدين ودائن' }) @ArrayMaxSize(300)
  @ValidateNested({ each: true }) @Type(() => LineDto)
  lines!: LineDto[];
}

export class ReasonDto {
  @trim() @IsString({ message: 'اكتب سبب الإلغاء' }) @MinLength(3, { message: 'اكتب سبب الإلغاء' }) @MaxLength(1000)
  reason!: string;
}

export class BatchPostDto {
  @DateField('تاريخ البداية غير صحيح')
  dateFrom!: string;

  @DateField('تاريخ النهاية غير صحيح')
  dateTo!: string;

  @Nullable() @IsString() @Matches(TYPE_CODE, { message: 'نوع السند غير صحيح' })
  voucherType?: VoucherType | null;

  @Nullable() @Type(() => Number) @IsInt() @Min(1)
  serialFrom?: number | null;

  @Nullable() @Type(() => Number) @IsInt() @Min(1)
  serialTo?: number | null;

  /** معاينة فقط بدون ترحيل */
  @IsOptional() @IsBoolean()
  preview?: boolean;
}

export class InventoryDto {
  @IsUUID()
  fiscalYearId!: string;

  @Nullable() @trim() @IsString() @MaxLength(1000)
  notes?: string | null;
}

// ---------------- سندات القبض والصرف ----------------

export class VoucherStageDto {
  @Nullable() @IsUUID('4')
  id?: string | null;

  @trim() @IsString({ message: 'اكتب اسم المرحلة' }) @MinLength(2, { message: 'اكتب اسم المرحلة' }) @MaxLength(200)
  name!: string;

  @Nullable() @trim() @IsString() @MaxLength(1000)
  instructions?: string | null;

  @Nullable() @IsUUID('4')
  roleId?: string | null;
}

export class VoucherStagesDto {
  @IsArray() @ArrayMaxSize(10, { message: 'عشر مراحل على الأكثر' }) @ValidateNested({ each: true }) @Type(() => VoucherStageDto)
  stages!: VoucherStageDto[];
}

export class VoucherDto {
  @DateField('تاريخ السند غير صحيح')
  voucherDate!: string;

  @trim() @IsString({ message: 'اكتب اسم الجهة' }) @MinLength(2, { message: 'اكتب اسم الجهة' }) @MaxLength(250)
  partyName!: string;

  @Nullable() @IsUUID('4')
  partnerId?: string | null;

  @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }, { message: 'المبلغ رقم بخانتين عشريتين على الأكثر' })
  @Min(0.01, { message: 'المبلغ يجب أن يكون أكبر من صفر' }) @Max(999_999_999)
  amount!: number;

  @trim() @IsString({ message: 'اكتب البيان (وهو قيمة ...)' }) @MinLength(3, { message: 'اكتب البيان (وهو قيمة ...)' }) @MaxLength(1000)
  purpose!: string;

  @IsOptional() @IsIn(['manual', 'opportunity', 'store', 'payroll', 'membership', 'separation', 'comms'])
  sourceType?: 'manual' | 'opportunity' | 'store' | 'payroll' | 'membership' | 'separation' | 'comms';

  @Nullable() @trim() @IsString() @MaxLength(120)
  sourceRef?: string | null;

  @Nullable() @trim() @IsString() @MaxLength(250)
  projectName?: string | null;

  @IsIn(['cash', 'transfer', 'cheque', 'card'], { message: 'اختر طريقة الدفع' })
  method!: 'cash' | 'transfer' | 'cheque' | 'card';

  @Nullable() @trim() @IsString() @MaxLength(120)
  methodRef?: string | null;

  @IsUUID('4', { message: 'اختر البنك أو الصندوق' })
  cashAccountId!: string;

  /** يُملأ تلقائيًا من ملف الشريك إن اختير شريك مسجل مربوط بحساب */
  @Nullable() @IsUUID('4', { message: 'اختر الحساب المقابل' })
  counterAccountId?: string | null;

  @IsOptional() @IsArray() @ArrayMaxSize(20) @ValidateNested({ each: true }) @Type(() => AnalyticShareDto)
  analytic?: AnalyticShareDto[];
}

export class VoucherDecisionDto {
  @IsIn(['approve', 'reject', 'return'], { message: 'اختر القرار' })
  decision!: 'approve' | 'reject' | 'return';

  @Nullable() @trim() @IsString() @MaxLength(1000)
  note?: string | null;
}

export class VoucherRequestDto {
  @IsIn(['draft', 'cancel'], { message: 'اختر نوع الطلب' })
  kind!: 'draft' | 'cancel';

  @trim() @IsString({ message: 'اكتب السبب' }) @MinLength(3, { message: 'اكتب السبب' }) @MaxLength(1000)
  reason!: string;
}

export class RequestDecisionDto {
  @IsIn(['approve', 'reject'], { message: 'اختر القرار' })
  decision!: 'approve' | 'reject';

  @Nullable() @trim() @IsString() @MaxLength(1000)
  note?: string | null;
}
