import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsIn, IsInt, IsNumber, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, MinLength, ValidateNested,
} from 'class-validator';
import { PRIORITIES, PURCHASE_METHODS, REQUEST_KINDS } from './entities/sourcing.entity';

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const keys = (o: object) => Object.keys(o);
const trim = () => Transform(({ value }) => (typeof value === 'string' ? value.trim() || null : value));

// ---------------- طلب الشراء ----------------

export class RequestLineDto {
  @IsOptional() @IsUUID() id?: string;
  @IsOptional() @IsUUID() itemId?: string | null;
  @IsString() @MinLength(2, { message: 'اكتب وصف البند' }) @MaxLength(500) description!: string;
  @IsNumber({}, { message: 'الكمية رقم' }) @Min(0.001, { message: 'الكمية أكبر من صفر' }) @Max(10_000_000) qty!: number;
  @IsOptional() @IsUUID() uomId?: string | null;
  @IsNumber({}, { message: 'السعر التقديري رقم' }) @Min(0) @Max(100_000_000) estPrice!: number;
  @IsOptional() @IsString() @MaxLength(2000) @trim() specs?: string | null;
}

export class RequestDto {
  @IsString() @MinLength(3, { message: 'اكتب عنوانًا واضحًا للطلب' }) @MaxLength(250) title!: string;
  @IsIn(keys(REQUEST_KINDS)) kind!: keyof typeof REQUEST_KINDS;
  @IsOptional() @IsUUID() unitId?: string | null;
  @IsOptional() @IsUUID() projectId?: string | null;
  @IsOptional() @IsString() @MaxLength(120) @trim() beneficiaryRef?: string | null;
  @IsOptional() @Matches(DATE, { message: 'تاريخ الاحتياج غير صحيح' }) neededBy?: string | null;
  @IsIn(keys(PRIORITIES)) priority!: keyof typeof PRIORITIES;
  @IsOptional() @IsString() @MaxLength(4000) @trim() justification?: string | null;
  @IsOptional() @IsIn(keys(PURCHASE_METHODS)) method?: keyof typeof PURCHASE_METHODS | null;
  @IsOptional() @IsString() @MaxLength(1000) @trim() methodReason?: string | null;
  @IsOptional() @IsUUID() budgetLineId?: string | null;
  @IsOptional() @IsUUID() fundingBatchId?: string | null;
  @IsArray() @ArrayMaxSize(100) @ValidateNested({ each: true }) @Type(() => RequestLineDto) lines!: RequestLineDto[];
}

export class SubmitRequestDto {
  /** تأكيد الإرسال رغم وجود طلبات مشابهة مفتوحة */
  @IsOptional() @IsBoolean() confirmDuplicate?: boolean;
}

export class NoteDto {
  @IsOptional() @IsString() @MaxLength(2000) @trim() note?: string | null;
}
export class ReasonDto {
  @IsString() @MinLength(3, { message: 'اكتب السبب' }) @MaxLength(2000) reason!: string;
}

export class BudgetCheckDto {
  @IsNumber() @Min(0.01) amount!: number;
  @IsOptional() @IsUUID() budgetLineId?: string | null;
  @IsOptional() @IsUUID() fundingBatchId?: string | null;
  @IsOptional() @IsUUID() projectId?: string | null;
  @IsOptional() @IsIn(keys(REQUEST_KINDS)) kind?: keyof typeof REQUEST_KINDS;
}

// ---------------- المنافسة ----------------

export class CriterionDto {
  @IsString() @Matches(/^[a-z][a-z0-9_]{1,29}$/, { message: 'رمز المعيار بالحروف الإنجليزية الصغيرة' }) key!: string;
  @IsString() @MinLength(2, { message: 'اكتب اسم المعيار' }) @MaxLength(150) name!: string;
  @IsInt() @Min(1) @Max(100) weight!: number;
  @IsIn(['price', 'technical']) kind!: 'price' | 'technical';
}

export class RfqDto {
  @IsOptional() @IsUUID() requestId?: string;
  @IsString() @MinLength(3, { message: 'اكتب عنوان المنافسة' }) @MaxLength(250) title!: string;
  @IsIn(['quotes', 'tender']) method!: 'quotes' | 'tender';
  @IsOptional() @IsString() @MaxLength(8000) @trim() scope?: string | null;
  @IsOptional() @IsString() @MaxLength(8000) @trim() terms?: string | null;
  @IsOptional() @IsString() questionsUntil?: string | null;
  @IsOptional() @IsString() closesAt?: string | null;
  @IsArray() @ArrayMaxSize(300) @IsUUID('4', { each: true }) invitedIds!: string[];
  @IsArray() @ArrayMaxSize(40) @IsUUID('4', { each: true }) categoryIds!: string[];
  @IsArray() @ArrayMinSize(1, { message: 'أضف معيار تقييم واحدًا على الأقل' }) @ArrayMaxSize(15) @ValidateNested({ each: true }) @Type(() => CriterionDto) criteria!: CriterionDto[];
  @IsInt() @Min(0) @Max(100) technicalPass!: number;
  @IsArray() @ArrayMaxSize(15) @IsUUID('4', { each: true }) committeeIds!: string[];
}

export class PublishDto {
  /** مبرر دعوة عدد أقل من الحد الأدنى للعروض */
  @IsOptional() @IsString() @MaxLength(1000) @trim() fewerReason?: string | null;
}

export class ExtendDto {
  @IsString() closesAt!: string;
  @IsOptional() @IsString() questionsUntil?: string | null;
  @IsString() @MinLength(3, { message: 'اكتب سبب التمديد' }) @MaxLength(1000) reason!: string;
}

export class AnswerDto {
  @IsString() @MinLength(2, { message: 'اكتب الرد' }) @MaxLength(4000) answer!: string;
  @IsBoolean() published!: boolean;
}

export class QuoteLineDto {
  @IsUUID() lineId!: string;
  @IsNumber({}, { message: 'السعر رقم' }) @Min(0) @Max(100_000_000) unitPrice!: number;
  @IsOptional() @IsString() @MaxLength(500) @trim() note?: string | null;
}

export class QuoteDto {
  @IsArray() @ArrayMaxSize(100) @ValidateNested({ each: true }) @Type(() => QuoteLineDto) lines!: QuoteLineDto[];
  @IsIn([0, 15]) vatRate!: number;
  @IsOptional() @IsInt() @Min(0) @Max(3650) deliveryDays?: number | null;
  @IsOptional() @IsInt() @Min(1) @Max(3650) validityDays?: number | null;
  @IsOptional() @IsString() @MaxLength(8000) @trim() technicalNote?: string | null;
  /** إرسال العرض نهائيًا (وإلا يُحفظ مسودة) */
  @IsOptional() @IsBoolean() submit?: boolean;
}

export class StaffQuoteDto extends QuoteDto {
  @IsUUID() supplierId!: string;
}

export class ScoreDto {
  @IsArray() @ArrayMaxSize(15) @ValidateNested({ each: true }) @Type(() => ScoreItemDto) scores!: ScoreItemDto[];
  @IsOptional() @IsString() @MaxLength(2000) @trim() note?: string | null;
}
export class ScoreItemDto {
  @IsString() key!: string;
  @IsInt() @Min(0) @Max(100) score!: number;
}

export class NegotiateDto {
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(100) @ValidateNested({ each: true }) @Type(() => QuoteLineDto) lines!: QuoteLineDto[];
  @IsString() @MinLength(3, { message: 'اكتب نتيجة جولة التفاوض' }) @MaxLength(2000) note!: string;
}

export class RecommendDto {
  @IsUUID() quoteId!: string;
  @IsString() @MinLength(10, { message: 'اكتب محضر التوصية ومبرراتها' }) @MaxLength(8000) recommendation!: string;
}

export class QuestionDto {
  @IsString() @MinLength(5, { message: 'اكتب الاستفسار' }) @MaxLength(2000) question!: string;
}

// ---------------- التعميد ----------------

export class OrderLineDto {
  @IsOptional() @IsUUID() lineId?: string | null;
  @IsNumber({}, { message: 'الكمية رقم' }) @Min(0.001, { message: 'الكمية أكبر من صفر' }) @Max(10_000_000) qty!: number;
  @IsNumber({}, { message: 'السعر رقم' }) @Min(0.01, { message: 'سعر الوحدة أكبر من صفر' }) @Max(100_000_000) unitPrice!: number;
}

export class OrderDto {
  @IsOptional() @IsUUID() requestId?: string;
  @IsOptional() @IsUUID() supplierId?: string;
  @IsOptional() @IsString() @MaxLength(250) title?: string;
  @IsArray() @ArrayMinSize(1, { message: 'أضف بندًا واحدًا على الأقل' }) @ArrayMaxSize(100) @ValidateNested({ each: true }) @Type(() => OrderLineDto) lines!: OrderLineDto[];
  @IsIn([0, 15]) vatRate!: number;
  @IsOptional() @IsUUID() warehouseId?: string | null;
  @IsOptional() @Matches(DATE, { message: 'تاريخ التسليم غير صحيح' }) deliveryDate?: string | null;
  @IsOptional() @IsString() @MaxLength(500) @trim() deliveryPlace?: string | null;
  @IsOptional() @IsString() @MaxLength(8000) @trim() terms?: string | null;
}

export class AmendDto {
  @IsOptional() @IsArray() @ArrayMaxSize(100) @ValidateNested({ each: true }) @Type(() => OrderLineDto) lines?: OrderLineDto[];
  @IsOptional() @Matches(DATE, { message: 'تاريخ التسليم غير صحيح' }) deliveryDate?: string | null;
  @IsOptional() @IsString() @MaxLength(8000) @trim() terms?: string | null;
  @IsString() @MinLength(3, { message: 'اكتب سبب التعديل' }) @MaxLength(2000) reason!: string;
}

export class RespondDto {
  @IsIn(['acknowledge', 'accept', 'clarify', 'decline']) action!: 'acknowledge' | 'accept' | 'clarify' | 'decline';
  @IsOptional() @IsString() @MaxLength(2000) @trim() note?: string | null;
}

// ---------------- الإعدادات ----------------

export class ApprovalLevelDto {
  @IsString() @MinLength(2, { message: 'اكتب اسم المستوى' }) @MaxLength(120) name!: string;
  @IsNumber() @Min(0) minAmount!: number;
  @IsIn(['procurement.orders.approve', 'procurement.orders.approve_high']) permission!: string;
}

export class MethodLimitsDto {
  @IsNumber() @Min(0) direct!: number;
  @IsNumber() @Min(0) quotes!: number;
}

export class SourcingSettingsDto {
  @IsOptional() @ValidateNested() @Type(() => MethodLimitsDto) methodLimits?: MethodLimitsDto;
  @IsOptional() @IsInt() @Min(1) @Max(10) minQuotes?: number;
  @IsOptional() @IsArray() @ArrayMinSize(1, { message: 'أضف مستوى اعتماد واحدًا على الأقل' }) @ArrayMaxSize(6) @ValidateNested({ each: true }) @Type(() => ApprovalLevelDto) approvalLevels?: ApprovalLevelDto[];
  @IsOptional() @IsArray() @ArrayMinSize(1) @ArrayMaxSize(15) @ValidateNested({ each: true }) @Type(() => CriterionDto) evalCriteria?: CriterionDto[];
  @IsOptional() @IsInt() @Min(0) @Max(100) technicalPass?: number;
  @IsOptional() @IsString() @MaxLength(8000) orderTerms?: string | null;
  @IsOptional() @IsBoolean() discloseWinner?: boolean;
}
