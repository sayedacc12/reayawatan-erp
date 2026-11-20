import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize, IsArray, IsBoolean, IsIn, IsInt, IsNumber, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, MinLength, ValidateNested,
} from 'class-validator';
import { AMENDMENT_KINDS, CONTRACT_KINDS, EVAL_KINDS, GUARANTEE_KINDS, PENALTY_BASIS } from './entities/contract.entity';

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const PERIOD = /^\d{4}-(0[1-9]|1[0-2])$/;
const KEY = /^[a-z0-9_-]{1,40}$/;
const trim = () => Transform(({ value }) => (typeof value === 'string' ? value.trim() || null : value));

export class ContractPriceDto {
  @IsOptional() @Matches(KEY) key?: string;
  @IsOptional() @IsUUID() itemId?: string | null;
  @IsString() @MinLength(2, { message: 'اكتب وصف البند' }) @MaxLength(300) @trim() description!: string;
  @IsOptional() @IsString() @MaxLength(40) @trim() unit?: string | null;
  @IsNumber() @Min(0) @Max(100_000_000) unitPrice!: number;
  @IsOptional() @IsNumber() @Min(0) @Max(100_000_000) maxQty?: number | null;
}

export class ContractGuaranteeDto {
  @IsOptional() @Matches(KEY) key?: string;
  @IsIn(Object.keys(GUARANTEE_KINDS)) kind!: keyof typeof GUARANTEE_KINDS;
  @IsNumber() @Min(0) @Max(1_000_000_000) amount!: number;
  @IsOptional() @IsString() @MaxLength(60) @trim() ref?: string | null;
  @IsOptional() @IsString() @MaxLength(200) @trim() issuer?: string | null;
  @IsOptional() @Matches(DATE, { message: 'تاريخ انتهاء الضمان غير صحيح' }) expiresOn?: string | null;
  @IsOptional() @IsBoolean() released?: boolean;
}

export class ContractSlaDto {
  @IsOptional() @Matches(KEY) key?: string;
  @IsString() @MinLength(2, { message: 'اكتب اسم المؤشر' }) @MaxLength(200) @trim() name!: string;
  @IsNumber() @Min(0) @Max(1_000_000) target!: number;
  @IsString() @MinLength(1) @MaxLength(30) @trim() unit!: string;
  @IsIn(['min', 'max']) direction!: 'min' | 'max';
}

export class ContractPenaltyRuleDto {
  @IsOptional() @Matches(KEY) key?: string;
  @IsString() @MinLength(2, { message: 'اكتب اسم الجزاء' }) @MaxLength(200) @trim() name!: string;
  @IsIn(Object.keys(PENALTY_BASIS)) basis!: keyof typeof PENALTY_BASIS;
  @IsNumber() @Min(0) @Max(10_000_000) rate!: number;
  @IsOptional() @IsNumber() @Min(0) @Max(100) capPct?: number | null;
}

export class ContractDto {
  @IsIn(Object.keys(CONTRACT_KINDS)) kind!: keyof typeof CONTRACT_KINDS;
  @IsUUID() supplierId!: string;
  @IsOptional() @IsString() @MaxLength(60) @trim() reference?: string | null;
  @IsString() @MinLength(3, { message: 'اكتب عنوان العقد' }) @MaxLength(250) @trim() title!: string;
  @IsOptional() @IsString() @MaxLength(8000) @trim() scope?: string | null;
  @IsOptional() @IsString() @MaxLength(20000) @trim() terms?: string | null;
  @Matches(DATE, { message: 'تاريخ البداية غير صحيح' }) startsOn!: string;
  @Matches(DATE, { message: 'تاريخ النهاية غير صحيح' }) endsOn!: string;
  @IsNumber({}, { message: 'قيمة العقد رقم' }) @Min(1) @Max(1_000_000_000) value!: number;
  @IsOptional() @IsInt() @Min(1) @Max(100) alertPct?: number;
  @IsOptional() @IsInt() @Min(0) @Max(365) alertDays?: number;
  @IsOptional() @IsUUID() projectId?: string | null;
  @IsOptional() @IsUUID() budgetLineId?: string | null;
  @IsOptional() @IsUUID() fundingBatchId?: string | null;
  @IsOptional() @IsUUID() ptContractId?: string | null;
  @IsOptional() @IsArray() @ArrayMaxSize(20) @IsUUID('all', { each: true }) riskIds?: string[];
  @IsOptional() @IsArray() @ArrayMaxSize(200) @ValidateNested({ each: true }) @Type(() => ContractPriceDto) prices?: ContractPriceDto[];
  @IsOptional() @IsArray() @ArrayMaxSize(20) @ValidateNested({ each: true }) @Type(() => ContractGuaranteeDto) guarantees?: ContractGuaranteeDto[];
  @IsOptional() @IsArray() @ArrayMaxSize(30) @ValidateNested({ each: true }) @Type(() => ContractSlaDto) slas?: ContractSlaDto[];
  @IsOptional() @IsArray() @ArrayMaxSize(30) @ValidateNested({ each: true }) @Type(() => ContractPenaltyRuleDto) penaltyRules?: ContractPenaltyRuleDto[];
  @IsOptional() @IsArray() @ArrayMaxSize(30) @IsString({ each: true }) @MaxLength(200, { each: true }) requiredDocs?: string[];
  @IsOptional() @IsBoolean() shareWithSupplier?: boolean;
}

export class ContractListQueryDto {
  @IsOptional() @IsString() @MaxLength(100) q?: string;
  @IsOptional() @IsIn(['draft', 'pending', 'returned', 'active', 'suspended', 'closed', 'terminated', 'cancelled']) status?: string;
  @IsOptional() @IsUUID() supplier?: string;
  @IsOptional() @IsUUID() ptContract?: string;
  @IsOptional() @IsIn(['alerts']) view?: string;
}

export class ContractDecisionDto {
  @IsOptional() @IsString() @MaxLength(1000) @trim() note?: string | null;
}

/** إنهاء العقد أو إيقافه أو إغلاقه أو إلغاؤه */
export class ContractEndDto {
  @IsIn(['suspend', 'resume', 'close', 'terminate', 'cancel']) action!: 'suspend' | 'resume' | 'close' | 'terminate' | 'cancel';
  @IsOptional() @IsString() @MaxLength(1000) @trim() reason?: string | null;
}

export class AmendmentDto {
  @IsIn(Object.keys(AMENDMENT_KINDS)) kind!: keyof typeof AMENDMENT_KINDS;
  @IsString() @MinLength(5, { message: 'اكتب سبب الملحق' }) @MaxLength(2000) @trim() reason!: string;
  @IsOptional() @Matches(DATE, { message: 'تاريخ النهاية غير صحيح' }) endsOn?: string;
  @IsOptional() @IsNumber() @Min(1) @Max(1_000_000_000) value?: number;
  @IsOptional() @IsString() @MaxLength(20000) @trim() terms?: string | null;
  @IsOptional() @IsArray() @ArrayMaxSize(200) @ValidateNested({ each: true }) @Type(() => ContractPriceDto) prices?: ContractPriceDto[];
}

export class AmendmentDecisionDto {
  @IsIn(['approve', 'reject']) decision!: 'approve' | 'reject';
  @IsOptional() @IsString() @MaxLength(1000) @trim() note?: string | null;
}

export class PenaltyDto {
  @IsOptional() @Matches(KEY) ruleKey?: string | null;
  @Matches(DATE, { message: 'تاريخ المخالفة غير صحيح' }) date!: string;
  /** للجزاء اليومي: عدد أيام التأخير، وللنسبة: قيمة التعميد تُحسب من التعميد المرتبط */
  @IsOptional() @IsNumber() @Min(0) @Max(3650) days?: number | null;
  @IsOptional() @IsNumber() @Min(0.01) @Max(100_000_000) amount?: number | null;
  @IsString() @MinLength(5, { message: 'اكتب سبب الجزاء' }) @MaxLength(1000) @trim() reason!: string;
  @IsOptional() @IsUUID() orderId?: string | null;
}

export class PenaltyDecisionDto {
  @IsIn(['approve', 'reject']) decision!: 'approve' | 'reject';
  @IsOptional() @IsString() @MaxLength(1000) @trim() note?: string | null;
}

export class KpiReadingDto {
  @Matches(KEY) slaKey!: string;
  @Matches(PERIOD, { message: 'الفترة بصيغة سنة-شهر' }) period!: string;
  @IsNumber() @Min(0) @Max(1_000_000) value!: number;
  @IsOptional() @IsString() @MaxLength(500) @trim() note?: string | null;
}

// ---------------- تقييم الموردين ----------------

export class EvaluationCreateDto {
  @IsUUID() supplierId!: string;
  @IsIn(Object.keys(EVAL_KINDS)) kind!: keyof typeof EVAL_KINDS;
  @IsOptional() @IsUUID() orderId?: string | null;
  @IsOptional() @IsUUID() contractId?: string | null;
  @Matches(DATE, { message: 'بداية الفترة غير صحيحة' }) periodFrom!: string;
  @Matches(DATE, { message: 'نهاية الفترة غير صحيحة' }) periodTo!: string;
}

export class EvalScoreDto {
  @Matches(KEY) key!: string;
  @IsNumber() @Min(0) @Max(100) score!: number;
  @IsOptional() @IsString() @MaxLength(500) @trim() note?: string | null;
}

export class EvaluationUpdateDto {
  @IsArray() @ArrayMaxSize(20) @ValidateNested({ each: true }) @Type(() => EvalScoreDto) scores!: EvalScoreDto[];
  @IsOptional() @IsString() @MaxLength(4000) @trim() strengths?: string | null;
  @IsOptional() @IsString() @MaxLength(4000) @trim() weaknesses?: string | null;
  @IsOptional() @IsString() @MaxLength(4000) @trim() recommendation?: string | null;
  @IsOptional() @IsBoolean() shareWithSupplier?: boolean;
}

export class EvaluationListQueryDto {
  @IsOptional() @IsUUID() supplier?: string;
  @IsOptional() @IsIn(['draft', 'submitted', 'returned', 'approved']) status?: string;
}

export class EvalCriterionDto {
  @Matches(KEY) key!: string;
  @IsString() @MinLength(2) @MaxLength(200) @trim() name!: string;
  @IsNumber() @Min(0) @Max(100) weight!: number;
  @IsOptional() @IsIn(['onTimePct', 'fillPct', 'qualityPct', 'invoiceOkPct', 'kpiPct']) metric?: string | null;
}

export class EvaluationSettingsDto {
  @IsArray() @ArrayMaxSize(20) @ValidateNested({ each: true }) @Type(() => EvalCriterionDto) criteria!: EvalCriterionDto[];
  @IsInt() @Min(1) @Max(100) gradeA!: number;
  @IsInt() @Min(1) @Max(100) gradeB!: number;
  @IsInt() @Min(1) @Max(100) gradeC!: number;
  /** منع دعوة الموردين ذوي التقدير الضعيف للمنافسات */
  @IsBoolean() blockWeak!: boolean;
  /** إدارات المراجعة الداخلية ذات العلاقة بالمشتريات والمستودعات */
  @IsOptional() @IsArray() @ArrayMaxSize(20) @IsUUID('all', { each: true }) auditAreaIds?: string[];
}

export class SupplierResponseDto {
  @IsString() @MinLength(5, { message: 'اكتب ردكم' }) @MaxLength(4000) @trim() response!: string;
  @IsOptional() @IsString() @MaxLength(4000) @trim() improvementPlan?: string | null;
}

export class KpiQueryDto {
  @IsOptional() @Matches(DATE) from?: string;
  @IsOptional() @Matches(DATE) to?: string;
}
