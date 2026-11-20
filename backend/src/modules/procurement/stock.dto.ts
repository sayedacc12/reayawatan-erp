import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsIn, IsInt, IsNumber, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, MinLength, ValidateNested,
} from 'class-validator';
import { COUNT_KINDS, INSPECTION_RESULTS, RECEIPT_KINDS, WRITEOFF_REASONS } from './entities/stock.entity';

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const keys = (o: object) => Object.keys(o);
const trim = () => Transform(({ value }) => (typeof value === 'string' ? value.trim() || null : value));

// ---------------- الاستلام ----------------

export class ReceiptLineDto {
  /** بند التعميد (للاستلام بتعميد) */
  @IsOptional() @IsUUID() orderLineId?: string | null;
  /** الصنف (للتبرع العيني والرصيد الافتتاحي) */
  @IsOptional() @IsUUID() itemId?: string | null;
  @IsOptional() @IsString() @MaxLength(500) @trim() description?: string | null;
  @IsNumber({}, { message: 'الكمية المسلّمة رقم' }) @Min(0) @Max(10_000_000) qty!: number;
  /** المرفوض بعد الفحص (والباقي مقبول) */
  @IsOptional() @IsNumber() @Min(0) rejectedQty?: number;
  @IsOptional() @IsString() @MaxLength(500) @trim() rejectReason?: string | null;
  /** القيمة العادلة للوحدة (التبرع العيني) أو تكلفة الوحدة (الرصيد الافتتاحي) */
  @IsOptional() @IsNumber() @Min(0) @Max(100_000_000) unitPrice?: number;
  @IsOptional() @IsString() @MaxLength(60) @trim() lot?: string | null;
  @IsOptional() @Matches(DATE, { message: 'تاريخ الصلاحية غير صحيح' }) expiryDate?: string | null;
  @IsOptional() @IsUUID() locationId?: string | null;
}

export class InspectionDto {
  @IsArray() @ArrayMaxSize(10) @IsString({ each: true }) @MaxLength(200, { each: true }) committee!: string[];
  @IsIn(keys(INSPECTION_RESULTS)) result!: keyof typeof INSPECTION_RESULTS;
  @IsOptional() @IsString() @MaxLength(2000) @trim() note?: string | null;
}

export class ReceiptDto {
  @IsIn(keys(RECEIPT_KINDS)) kind!: keyof typeof RECEIPT_KINDS;
  @IsOptional() @IsUUID() orderId?: string | null;
  @IsOptional() @IsUUID() warehouseId?: string | null;
  @Matches(DATE, { message: 'تاريخ الاستلام غير صحيح' }) date!: string;
  @IsOptional() @IsString() @MaxLength(80) @trim() deliveryRef?: string | null;
  @IsOptional() @IsString() @MaxLength(250) @trim() donorName?: string | null;
  @IsOptional() @IsUUID() analyticId?: string | null;
  @IsOptional() @IsUUID() projectId?: string | null;
  @IsOptional() @IsNumber() @Min(0) @Max(100_000_000) extraCost?: number;
  @IsOptional() @IsString() @MaxLength(500) @trim() extraNote?: string | null;
  @IsOptional() @ValidateNested() @Type(() => InspectionDto) inspection?: InspectionDto | null;
  @IsOptional() @IsString() @MaxLength(2000) @trim() notes?: string | null;
  @IsArray() @ArrayMinSize(1, { message: 'أضف بندًا واحدًا على الأقل' }) @ArrayMaxSize(200) @ValidateNested({ each: true }) @Type(() => ReceiptLineDto) lines!: ReceiptLineDto[];
}

// ---------------- طلب الصرف ----------------

export class IssueRequestLineDto {
  @IsOptional() @IsString() @MaxLength(40) id?: string;
  @IsUUID() itemId!: string;
  @IsNumber({}, { message: 'الكمية رقم' }) @Min(0.001, { message: 'الكمية أكبر من صفر' }) @Max(10_000_000) qty!: number;
  @IsOptional() @IsString() @MaxLength(500) @trim() note?: string | null;
}

export class IssueRequestDto {
  @IsUUID() warehouseId!: string;
  @IsString() @MinLength(3, { message: 'اكتب الغرض من الصرف' }) @MaxLength(250) purpose!: string;
  @IsOptional() @IsUUID() unitId?: string | null;
  @IsOptional() @IsUUID() projectId?: string | null;
  @IsOptional() @IsUUID() fundingBatchId?: string | null;
  @IsOptional() @IsUUID() analyticId?: string | null;
  @IsOptional() @IsString() @MaxLength(120) @trim() beneficiaryRef?: string | null;
  @IsOptional() @IsString() @MaxLength(200) @trim() receiverName?: string | null;
  @IsOptional() @Matches(DATE) neededBy?: string | null;
  @IsArray() @ArrayMinSize(1, { message: 'أضف صنفًا واحدًا على الأقل' }) @ArrayMaxSize(100) @ValidateNested({ each: true }) @Type(() => IssueRequestLineDto) lines!: IssueRequestLineDto[];
}

// ---------------- مستندات المخزون ----------------

export class StockDocLineDto {
  @IsUUID() itemId!: string;
  @IsNumber({}, { message: 'الكمية رقم' }) @Min(0.001, { message: 'الكمية أكبر من صفر' }) @Max(10_000_000) qty!: number;
  @IsOptional() @IsString() @MaxLength(60) @trim() lot?: string | null;
  @IsOptional() @IsUUID() locationId?: string | null;
  @IsOptional() @IsUUID() toLocationId?: string | null;
  /** بند طلب الصرف أو بند الاستلام الأصلي أو بند سند الصرف الأصلي */
  @IsOptional() @IsString() @MaxLength(40) refLineId?: string | null;
}

/** سند صرف من طلب صرف معتمد */
export class IssueDto {
  @IsUUID() issueRequestId!: string;
  @Matches(DATE, { message: 'تاريخ الصرف غير صحيح' }) date!: string;
  @IsOptional() @IsString() @MaxLength(200) @trim() receiverName?: string | null;
  @IsOptional() @IsString() @MaxLength(2000) @trim() notes?: string | null;
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(100) @ValidateNested({ each: true }) @Type(() => StockDocLineDto) lines!: StockDocLineDto[];
}

export class TransferDto {
  @IsUUID() warehouseId!: string;
  @IsUUID() toWarehouseId!: string;
  @Matches(DATE, { message: 'تاريخ التحويل غير صحيح' }) date!: string;
  @IsOptional() @IsString() @MaxLength(2000) @trim() notes?: string | null;
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(100) @ValidateNested({ each: true }) @Type(() => StockDocLineDto) lines!: StockDocLineDto[];
}

/** مرتجع للمورد (من استلام) أو مرتجع من جهة (من سند صرف) */
export class ReturnDto {
  @IsUUID() refId!: string;
  @Matches(DATE, { message: 'تاريخ المرتجع غير صحيح' }) date!: string;
  @IsString() @MinLength(3, { message: 'اكتب سبب الإرجاع' }) @MaxLength(2000) notes!: string;
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(100) @ValidateNested({ each: true }) @Type(() => StockDocLineDto) lines!: StockDocLineDto[];
}

export class WriteoffDto {
  @IsUUID() warehouseId!: string;
  @Matches(DATE, { message: 'تاريخ الإتلاف غير صحيح' }) date!: string;
  @IsIn(keys(WRITEOFF_REASONS)) reason!: keyof typeof WRITEOFF_REASONS;
  @IsString() @MinLength(3, { message: 'اكتب تفاصيل الإتلاف ومحضره' }) @MaxLength(2000) notes!: string;
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(100) @ValidateNested({ each: true }) @Type(() => StockDocLineDto) lines!: StockDocLineDto[];
}

// ---------------- الجرد ----------------

export class CountDto {
  @IsIn(keys(COUNT_KINDS)) kind!: keyof typeof COUNT_KINDS;
  @IsUUID() warehouseId!: string;
  @IsOptional() @IsUUID() groupId?: string | null;
  @Matches(DATE, { message: 'تاريخ الجرد غير صحيح' }) date!: string;
  @IsOptional() @IsArray() @ArrayMaxSize(10) @IsUUID('all', { each: true }) committeeIds?: string[];
  @IsOptional() @IsString() @MaxLength(2000) @trim() notes?: string | null;
}

export class CountLineDto {
  @IsInt() @Min(0) index!: number;
  @IsOptional() @IsNumber() @Min(0) @Max(10_000_000) countedQty?: number | null;
  @IsOptional() @IsString() @MaxLength(500) @trim() note?: string | null;
}
export class CountLinesDto {
  @IsArray() @ArrayMaxSize(2000) @ValidateNested({ each: true }) @Type(() => CountLineDto) lines!: CountLineDto[];
}

// ---------------- الإعدادات ----------------

export class StockSettingsDto {
  @IsOptional() @IsUUID() grniAccountId?: string | null;
  @IsOptional() @IsUUID() adjustAccountId?: string | null;
  @IsOptional() @IsUUID() adjustAnalyticId?: string | null;
  @IsOptional() @IsUUID() donationAccountId?: string | null;
  @IsOptional() @IsUUID() openingAccountId?: string | null;
  @IsOptional() @IsUUID() defaultExpenseAccountId?: string | null;
  @IsInt() @Min(1) @Max(730) expiryAlertDays!: number;
  @IsInt() @Min(0) @Max(50) overReceiptPct!: number;
  @IsBoolean() vatInCost!: boolean;
  @IsBoolean() requireInspection!: boolean;
}
