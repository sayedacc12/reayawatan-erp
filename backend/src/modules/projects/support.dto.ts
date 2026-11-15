import { Transform } from 'class-transformer';
import { IsDateString, IsIn, IsNumber, IsOptional, IsString, IsUUID, MaxLength, Min, MinLength } from 'class-validator';

const trim = () => Transform(({ value }) => (typeof value === 'string' ? value.trim() || null : value));
const amount = () => [IsNumber({ maxDecimalPlaces: 2 }, { message: 'المبلغ يجب أن يكون رقمًا بحد أقصى منزلتين عشريتين' }), Min(0.01, { message: 'المبلغ يجب أن يكون أكبر من صفر' })];
const Amount = (): PropertyDecorator => (t, k) => amount().forEach((d) => d(t, k));

export class AllocateDto {
  @IsUUID('4', { message: 'اختر الطلب' })
  requestId!: string;

  @IsUUID('4', { message: 'اختر الدفعة' })
  batchId!: string;

  @Amount()
  amount!: number;

  @IsOptional() @trim() @IsString() @MaxLength(1000)
  notes?: string | null;
}

export class GeneralDisbursementDto {
  @IsUUID('4', { message: 'اختر المشروع' })
  activityId!: string;

  @IsUUID('4', { message: 'اختر الدفعة' })
  batchId!: string;

  @IsOptional() @trim() @IsString() @MaxLength(1000)
  notes?: string | null;
}

export class ReasonDto {
  @trim() @IsString({ message: 'اكتب السبب' }) @MinLength(3, { message: 'اكتب السبب' }) @MaxLength(2000)
  reason!: string;
}

export class PaymentRequestDto {
  @IsUUID('4', { message: 'اختر المبلغ المحجوز' })
  allocationId!: string;

  @Amount()
  amount!: number;

  @IsIn(['voucher', 'invoice'], { message: 'اختر طريقة الصرف: سند صرف أو فاتورة' })
  method!: 'voucher' | 'invoice';

  @IsOptional() @IsIn(['beneficiary', 'provider', 'other'])
  payeeKind?: 'beneficiary' | 'provider' | 'other';

  @IsOptional() @trim() @IsString() @MaxLength(200)
  payeeName?: string | null;

  @IsOptional() @trim() @IsString() @MaxLength(500)
  description?: string | null;
}

export class ExecutePaymentDto {
  @trim() @IsString({ message: 'اكتب رقم سند الصرف أو الفاتورة' }) @MinLength(1, { message: 'اكتب رقم سند الصرف أو الفاتورة' }) @MaxLength(60)
  referenceNo!: string;

  @IsOptional() @IsDateString({}, { message: 'تاريخ الصرف غير صحيح' })
  paidOn?: string;
}

export class DirectPaymentDto extends PaymentRequestDto {
  @trim() @IsString({ message: 'اكتب رقم سند الصرف أو الفاتورة' }) @MinLength(1, { message: 'اكتب رقم سند الصرف أو الفاتورة' }) @MaxLength(60)
  referenceNo!: string;

  @IsOptional() @IsDateString({}, { message: 'تاريخ الصرف غير صحيح' })
  paidOn?: string;
}

export class TransferDto {
  @IsUUID('4', { message: 'اختر الدفعة المنقول منها' })
  sourceBatchId!: string;

  @IsUUID('4', { message: 'اختر المشروع المنقول إليه' })
  targetActivityId!: string;

  @Amount()
  amount!: number;

  @trim() @IsString({ message: 'اكتب سبب المناقلة' }) @MinLength(3, { message: 'اكتب سبب المناقلة' }) @MaxLength(2000)
  reason!: string;
}

export class AmendmentDto {
  @IsUUID('4', { message: 'اختر الدفعة' })
  batchId!: string;

  @Amount()
  amount!: number;

  @IsDateString({}, { message: 'اختر تاريخ سريان التعديل' })
  effectiveDate!: string;

  /** المشروع بعد التعديل (فارغ = نفس المشروع) */
  @IsOptional() @IsUUID()
  newActivityId?: string | null;

  @IsOptional()
  acceptsPatientContribution?: boolean;

  @IsOptional() @IsNumber({}, { message: 'الحد الأعلى للصرف يجب أن يكون رقمًا' }) @Min(0)
  maxSpend?: number | null;

  @IsOptional() @IsString({ each: true }) @MaxLength(60, { each: true })
  nationalities?: string[];

  @IsOptional() @IsIn(['citizen', 'resident', 'visitor'], { each: true })
  categories?: ('citizen' | 'resident' | 'visitor')[];

  @IsOptional() @IsDateString({}, { message: 'تاريخ انتهاء المشروع غير صحيح' })
  endDate?: string | null;

  @trim() @IsString({ message: 'اكتب سبب التعديل' }) @MinLength(3, { message: 'اكتب سبب التعديل' }) @MaxLength(2000)
  reason!: string;

  /** موافقة الداعم على التعديل */
  @IsIn([true], { message: 'لا يُعتمد التعديل قبل موافقة الداعم' })
  donorApproved!: boolean;

  @IsOptional() @trim() @IsString() @MaxLength(300)
  donorApprovalRef?: string | null;

  /** إقرار المسؤول بعلامة داخل النموذج */
  @IsIn([true], { message: 'ضع علامة الإقرار قبل الحفظ' })
  acknowledged!: boolean;
}

export class AccountingDto {
  @IsOptional() @trim() @IsString() @MaxLength(50)
  expenseDebitCode?: string | null;

  @IsOptional() @trim() @IsString() @MaxLength(200)
  expenseDebitName?: string | null;

  @IsOptional() @trim() @IsString() @MaxLength(50)
  paymentCreditCode?: string | null;

  @IsOptional() @trim() @IsString() @MaxLength(200)
  paymentCreditName?: string | null;
}
