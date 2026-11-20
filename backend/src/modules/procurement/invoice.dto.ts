import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize, ArrayMinSize, IsArray, IsIn, IsInt, IsNumber, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, MinLength, ValidateNested,
} from 'class-validator';
import { INVOICE_KINDS } from './entities/invoice.entity';

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const trim = () => Transform(({ value }) => (typeof value === 'string' ? value.trim() || null : value));

export class InvoiceLineDto {
  @IsUUID() orderLineId!: string;
  @IsNumber({}, { message: 'الكمية رقم' }) @Min(0) @Max(10_000_000) qty!: number;
  @IsNumber({}, { message: 'سعر الوحدة رقم' }) @Min(0) @Max(100_000_000) unitPrice!: number;
}

/** فاتورة أو إشعار دائن على تعميد (من البوابة أو من الموظف) */
export class InvoiceDto {
  @IsIn(Object.keys(INVOICE_KINDS)) kind!: keyof typeof INVOICE_KINDS;
  @IsUUID() orderId!: string;
  /** الفاتورة الأصلية (للإشعار الدائن) */
  @IsOptional() @IsUUID() refInvoiceId?: string | null;
  @IsString() @MinLength(1, { message: 'اكتب رقم الفاتورة' }) @MaxLength(60) @trim() supplierInvoiceNo!: string;
  @Matches(DATE, { message: 'تاريخ الفاتورة غير صحيح' }) invoiceDate!: string;
  @IsOptional() @Matches(DATE, { message: 'تاريخ الاستحقاق غير صحيح' }) dueDate?: string | null;
  @IsArray() @ArrayMinSize(1, { message: 'أضف بندًا واحدًا على الأقل' }) @ArrayMaxSize(300) @ValidateNested({ each: true }) @Type(() => InvoiceLineDto) lines!: InvoiceLineDto[];
  @IsOptional() @IsNumber() @Min(0) @Max(100_000_000) extraAmount?: number;
  @IsOptional() @IsNumber() @Min(0) @Max(100) vatRate?: number;
  @IsOptional() @IsString() @MaxLength(2000) @trim() notes?: string | null;
}

export class InvoiceApproveDto {
  @IsOptional() @IsString() @MaxLength(1000) @trim() note?: string | null;
  /** سبب اعتماد الفاتورة رغم استثناءات المطابقة (لصاحب صلاحية التجاوز) */
  @IsOptional() @IsString() @MinLength(5, { message: 'اكتب سبب التجاوز بوضوح' }) @MaxLength(1000) @trim() overrideReason?: string | null;
}

export class InvoiceMessageDto {
  @IsString() @MinLength(2, { message: 'اكتب الرسالة' }) @MaxLength(2000) @trim() text!: string;
}

/** تسجيل المستحق في النظام المالي */
export class InvoicePostDto {
  @IsOptional() @Matches(DATE, { message: 'تاريخ القيد غير صحيح' }) date?: string | null;
}

/** سند صرف لسداد فاتورة */
export class InvoicePayDto {
  @Matches(DATE, { message: 'تاريخ السند غير صحيح' }) date!: string;
  @IsIn(['cash', 'bank']) method!: 'cash' | 'bank';
  @IsUUID() cashAccountId!: string;
  @IsNumber({}, { message: 'المبلغ رقم' }) @Min(0.01) @Max(1_000_000_000) amount!: number;
  @IsOptional() @IsString() @MaxLength(500) @trim() note?: string | null;
}

export class InvoiceSettingsDto {
  @IsNumber() @Min(0) @Max(20) matchTolerancePct!: number;
  @IsOptional() @IsUUID() vatInputAccountId?: string | null;
  @IsInt() @Min(0) @Max(365) paymentDays!: number;
}

export class StatementQueryDto {
  @IsOptional() @Matches(DATE) from?: string;
  @IsOptional() @Matches(DATE) to?: string;
  @IsOptional() @IsUUID() order?: string;
}

export class InvoiceListQueryDto {
  @IsOptional() @IsIn(Object.keys({ draft: 1, submitted: 1, returned: 1, rejected: 1, approved: 1, posted: 1, partial: 1, paid: 1, cancelled: 1 })) status?: string;
  @IsOptional() @IsIn(Object.keys(INVOICE_KINDS)) kind?: string;
  @IsOptional() @IsUUID() supplier?: string;
  @IsOptional() @IsUUID() order?: string;
  @IsOptional() @IsString() @MaxLength(100) q?: string;
  /** للمالي: open = المحالة والمسجلة غير المسددة */
  @IsOptional() @IsIn(['open', 'overdue', 'review']) view?: string;
}
