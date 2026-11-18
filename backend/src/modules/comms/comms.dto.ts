import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize, IsArray, IsBoolean, IsDateString, IsIn, IsInt, IsNumber, IsOptional, IsString, IsUUID, Max, MaxLength, Min, MinLength, ValidateIf, ValidateNested,
} from 'class-validator';
import { AnalyticShareDto } from '../accounting/accounting.dto';
import { CONFIDENTIALITY, DIRECTIONS, DOC_TYPES, PRIORITIES, PURPOSES, TXN_KINDS } from './entities/comms.entity';

export const trim = () => Transform(({ value }) => (typeof value === 'string' ? value.trim() || null : value));
export const Nullable = (): PropertyDecorator => (t, k) => [IsOptional(), ValidateIf((_: unknown, v: unknown) => v !== null && v !== '')].forEach((d) => d(t, k));
const DateField = (msg: string) => IsDateString({ strict: true }, { message: msg });

// ---------------- الإعدادات ----------------

export class CategoryDto {
  @trim() @IsString() @MinLength(2, { message: 'رمز التصنيف حرفان على الأقل' }) @MaxLength(40) code!: string;
  @trim() @IsString() @MinLength(2, { message: 'اكتب اسم التصنيف' }) @MaxLength(150) name!: string;
  @IsIn(TXN_KINDS, { message: 'نوع التصنيف إداري أو مالي' }) kind!: 'admin' | 'financial';
  @Type(() => Number) @IsInt() @Min(1, { message: 'المهلة يوم على الأقل' }) @Max(180) dueDays!: number;
  @IsBoolean() isActive!: boolean;
}

export class SettingsDto {
  @IsArray() @ArrayMaxSize(60) @ValidateNested({ each: true }) @Type(() => CategoryDto) categories!: CategoryDto[];
  @Type(() => Number) @IsInt() @Min(0) @Max(30) taskReminderDays!: number;
}

// ---------------- المعاملات ----------------

export class TransactionDto {
  @IsIn(DOC_TYPES, { message: 'اختر نوع الوثيقة' }) docType!: (typeof DOC_TYPES)[number];
  @IsIn(TXN_KINDS, { message: 'اختر نوع المعاملة: إدارية أو مالية' }) kind!: (typeof TXN_KINDS)[number];
  @IsOptional() @IsIn(DIRECTIONS) direction?: (typeof DIRECTIONS)[number];
  @Nullable() @trim() @IsString() @MaxLength(250) externalParty?: string | null;
  @Nullable() @trim() @IsString() @MaxLength(100) externalRef?: string | null;
  @Nullable() @trim() @IsString() @MaxLength(40) categoryCode?: string | null;
  @trim() @IsString({ message: 'اكتب موضوع المعاملة' }) @MinLength(3, { message: 'اكتب موضوع المعاملة' }) @MaxLength(300) subject!: string;
  @IsOptional() @IsString() @MaxLength(20000) body?: string;
  @IsIn(CONFIDENTIALITY, { message: 'اختر درجة السرية' }) confidentiality!: (typeof CONFIDENTIALITY)[number];
  @IsIn(PRIORITIES, { message: 'اختر درجة الأهمية' }) priority!: (typeof PRIORITIES)[number];

  @Nullable() @IsIn(['receipt', 'payment'], { message: 'اختر نوع المعاملة المالية: قبض أو صرف' }) financialType?: 'receipt' | 'payment' | null;
  @Nullable() @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }, { message: 'المبلغ رقم بخانتين عشريتين على الأكثر' }) @Min(0.01) @Max(999_999_999) amount?: number | null;
  @Nullable() @trim() @IsString() @MaxLength(250) partyName?: string | null;

  /** المعاملة: تحال إلى موظف أو إلى إدارة (تصل لمديرها) */
  @Nullable() @IsUUID('4', { message: 'اختر الموظف' }) toUserId?: string | null;
  @Nullable() @IsUUID('4', { message: 'اختر الإدارة' }) toUnitId?: string | null;
  @IsOptional() @IsIn(PURPOSES) purpose?: (typeof PURPOSES)[number];
  @Nullable() @DateField('تاريخ الإنجاز المطلوب غير صحيح') dueDate?: string | null;
  @Nullable() @trim() @IsString() @MaxLength(2000) note?: string | null;

  /** القرار أو التعميم: موجه لأشخاص و/أو إدارات كاملة */
  @IsOptional() @IsArray() @ArrayMaxSize(500) @IsUUID('4', { each: true }) recipientUserIds?: string[];
  @IsOptional() @IsArray() @ArrayMaxSize(100) @IsUUID('4', { each: true }) recipientUnitIds?: string[];

  @IsOptional() @IsArray() @ArrayMaxSize(30) @IsUUID('4', { each: true }) followerUserIds?: string[];
  /** حفظ كمسودة دون إرسال */
  @IsOptional() @IsBoolean() draft?: boolean;
}

export class ReferDto {
  @Nullable() @IsUUID('4', { message: 'اختر الموظف' }) toUserId?: string | null;
  @Nullable() @IsUUID('4', { message: 'اختر الإدارة' }) toUnitId?: string | null;
  @IsIn(PURPOSES, { message: 'اختر الغرض من الإحالة' }) purpose!: (typeof PURPOSES)[number];
  @Nullable() @DateField('تاريخ الإنجاز المطلوب غير صحيح') dueDate?: string | null;
  @Nullable() @trim() @IsString() @MaxLength(2000) note?: string | null;
}

export class NoteDto {
  @trim() @IsString({ message: 'اكتب الإفادة' }) @MinLength(2, { message: 'اكتب الإفادة' }) @MaxLength(4000) note!: string;
}

export class FollowersDto {
  @IsArray() @ArrayMaxSize(30) @IsUUID('4', { each: true }) userIds!: string[];
}

export class CloseDto {
  /** done: إنجاز المعاملة الإدارية، archive: حفظ، voucher: سند قبض أو صرف للمعاملة المالية */
  @IsIn(['done', 'archive', 'voucher'], { message: 'اختر طريقة إنهاء المعاملة' }) closeKind!: 'done' | 'archive' | 'voucher';
  @Nullable() @trim() @IsString() @MaxLength(2000) note?: string | null;
  // بيانات السند (عند الإنهاء بسند)
  @Nullable() @DateField('تاريخ السند غير صحيح') voucherDate?: string | null;
  @Nullable() @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0.01) @Max(999_999_999) amount?: number | null;
  @Nullable() @trim() @IsString() @MaxLength(250) partyName?: string | null;
  @Nullable() @IsIn(['cash', 'transfer', 'cheque', 'card']) method?: 'cash' | 'transfer' | 'cheque' | 'card' | null;
  @Nullable() @trim() @IsString() @MaxLength(120) methodRef?: string | null;
  @Nullable() @IsUUID('4', { message: 'اختر البنك أو الصندوق' }) cashAccountId?: string | null;
  @Nullable() @IsUUID('4', { message: 'اختر الحساب المقابل' }) counterAccountId?: string | null;
  /** توزيع المبلغ على الحسابات التحليلية (مراكز التكلفة) عند لزومها للحساب المقابل */
  @IsOptional() @IsArray() @ArrayMaxSize(20) @ValidateNested({ each: true }) @Type(() => AnalyticShareDto) analytic?: AnalyticShareDto[];
}

export class TaskFromTxnDto {
  @trim() @IsString({ message: 'اكتب عنوان المهمة' }) @MinLength(3, { message: 'اكتب عنوان المهمة' }) @MaxLength(300) title!: string;
  @IsUUID('4', { message: 'اختر المسؤول عن التنفيذ' }) ownerUserId!: string;
  @DateField('موعد الإغلاق غير صحيح') dueDate!: string;
}

// ---------------- المهام ----------------

export class TaskDto {
  @trim() @IsString({ message: 'اكتب عنوان المهمة' }) @MinLength(3, { message: 'اكتب عنوان المهمة' }) @MaxLength(300) title!: string;
  @Nullable() @trim() @IsString() @MaxLength(8000) description?: string | null;
  @IsUUID('4', { message: 'اختر المسؤول عن التنفيذ' }) ownerUserId!: string;
  @IsOptional() @IsArray() @ArrayMaxSize(20) @IsUUID('4', { each: true }) supporterUserIds?: string[];
  @IsIn(PRIORITIES, { message: 'اختر الأهمية' }) priority!: (typeof PRIORITIES)[number];
  @Nullable() @DateField('تاريخ البدء غير صحيح') startDate?: string | null;
  @DateField('موعد الإغلاق غير صحيح') dueDate!: string;
}

export class TaskUpdateDto {
  @IsIn(['note', 'progress', 'complete', 'reopen', 'cancel', 'extend', 'reassign', 'supporters'], { message: 'الإجراء غير معروف' })
  action!: 'note' | 'progress' | 'complete' | 'reopen' | 'cancel' | 'extend' | 'reassign' | 'supporters';
  @Nullable() @trim() @IsString() @MaxLength(4000) text?: string | null;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(100) progress?: number;
  @Nullable() @DateField('الموعد الجديد غير صحيح') dueDate?: string | null;
  @Nullable() @IsUUID('4') ownerUserId?: string | null;
  @IsOptional() @IsArray() @ArrayMaxSize(20) @IsUUID('4', { each: true }) supporterUserIds?: string[];
}
