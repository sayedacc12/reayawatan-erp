import { PartialType } from '@nestjs/mapped-types';
import { Transform, Type } from 'class-transformer';
import {
  IsDateString, IsIn, IsInt, IsUUID, IsNumber, IsOptional, IsString, Matches, Max, MaxLength, Min, MinLength,
} from 'class-validator';
import {
  AID_TYPES, CASE_STATUSES, CATEGORIES, DOCUMENT_TYPES, GENDERS, HOUSING_TYPES, MARITAL_STATUSES, RESEARCH_DECISIONS,
} from './constants';
import type {
  AidType, CaseStatus, Category, DocumentType, Gender, HousingType, MaritalStatus, ResearchDecision,
} from './constants';

/** يحول النص الفاضي لـ null ويشيل المسافات، ويحوّل الأرقام العربية (٠-٩) لإنجليزية */
const clean = () =>
  Transform(({ value }) => {
    if (typeof value !== 'string') return value;
    const v = value.trim().replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660));
    return v === '' ? null : v;
  });

const NATIONAL_ID = /^[0-9]{5,20}$/;
const PHONE = /^\+?[0-9 -]{6,20}$/;
const MONEY = { maxDecimalPlaces: 2 };

export class CreateBeneficiaryDto {
  @clean() @IsString() @MinLength(3, { message: 'الاسم قصير جدًا' }) @MaxLength(200)
  fullName!: string;

  @IsOptional() @clean() @Matches(NATIONAL_ID, { message: 'رقم الهوية أرقام فقط (من 5 إلى 20 رقم)' })
  nationalId?: string | null;

  @IsIn(GENDERS, { message: 'اختر النوع' })
  gender!: Gender;

  @IsOptional() @clean() @IsDateString({}, { message: 'تاريخ الميلاد غير صحيح' })
  birthDate?: string | null;

  @IsOptional() @clean() @Matches(PHONE, { message: 'رقم الجوال غير صحيح' })
  phone?: string | null;

  @IsOptional() @clean() @Matches(PHONE, { message: 'الرقم الإضافي غير صحيح' })
  altPhone?: string | null;

  @IsOptional() @clean() @IsString() @MaxLength(100)
  city?: string | null;

  @IsOptional() @clean() @IsString() @MaxLength(300)
  address?: string | null;

  @IsOptional() @IsIn([...MARITAL_STATUSES, null])
  maritalStatus?: MaritalStatus | null;

  @IsIn(CATEGORIES, { message: 'اختر فئة الحالة' })
  category!: Category;

  @IsOptional() @IsIn(CASE_STATUSES)
  status?: CaseStatus;

  @IsOptional() @Type(() => Number) @IsNumber(MONEY, { message: 'الدخل رقم' }) @Min(0) @Max(9_999_999)
  monthlyIncome?: number;

  @IsOptional() @clean() @IsString() @MaxLength(200)
  incomeSource?: string | null;

  @IsOptional() @IsIn([...HOUSING_TYPES, null])
  housingType?: HousingType | null;

  @IsOptional() @Type(() => Number) @IsNumber(MONEY, { message: 'الإيجار رقم' }) @Min(0) @Max(9_999_999)
  monthlyRent?: number | null;

  @IsOptional() @clean() @IsString() @MaxLength(300)
  healthStatus?: string | null;

  @IsOptional() @clean() @IsString() @MaxLength(5000)
  notes?: string | null;
}

export class UpdateBeneficiaryDto extends PartialType(CreateBeneficiaryDto) {}

export class ListBeneficiariesQuery {
  @IsOptional() @clean() @IsString() @MaxLength(100)
  search?: string;

  @IsOptional() @IsIn(CASE_STATUSES)
  status?: CaseStatus;

  @IsOptional() @IsIn(CATEGORIES)
  category?: Category;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1)
  page?: number;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100)
  pageSize?: number;
}

export class FamilyMemberDto {
  @clean() @IsString() @MinLength(2, { message: 'الاسم قصير جدًا' }) @MaxLength(200)
  fullName!: string;

  @clean() @IsString() @MinLength(2, { message: 'اكتب صلة القرابة' }) @MaxLength(50)
  relation!: string;

  @IsIn(GENDERS, { message: 'اختر النوع' })
  gender!: Gender;

  @IsOptional() @clean() @IsDateString({}, { message: 'تاريخ الميلاد غير صحيح' })
  birthDate?: string | null;

  @IsOptional() @clean() @Matches(NATIONAL_ID, { message: 'رقم الهوية أرقام فقط (من 5 إلى 20 رقم)' })
  nationalId?: string | null;

  @IsOptional() @clean() @IsString() @MaxLength(200)
  occupation?: string | null;

  @IsOptional() @Type(() => Number) @IsNumber(MONEY, { message: 'الدخل رقم' }) @Min(0) @Max(9_999_999)
  monthlyIncome?: number;

  @IsOptional() @clean() @IsString() @MaxLength(300)
  healthStatus?: string | null;
}

export class UpdateFamilyMemberDto extends PartialType(FamilyMemberDto) {}

export class ResearchDto {
  @IsDateString({}, { message: 'تاريخ الزيارة غير صحيح' })
  visitDate!: string;

  @clean() @IsString() @MinLength(2, { message: 'اكتب اسم الباحث' }) @MaxLength(200)
  researcherName!: string;

  @clean() @IsString() @MinLength(5, { message: 'اكتب نتيجة البحث' }) @MaxLength(5000)
  findings!: string;

  @IsIn(RESEARCH_DECISIONS, { message: 'اختر قرار الاستحقاق' })
  decision!: ResearchDecision;

  @IsOptional() @clean() @IsString() @MaxLength(300)
  recommendedAid?: string | null;

  @IsOptional() @clean() @IsDateString({}, { message: 'تاريخ المراجعة القادمة غير صحيح' })
  nextReviewDate?: string | null;
}

export class AidDto {
  @IsIn(AID_TYPES, { message: 'اختر نوع المساعدة' })
  aidType!: AidType;

  @Type(() => Number) @IsNumber(MONEY, { message: 'القيمة رقم' }) @Min(0) @Max(9_999_999)
  amount!: number;

  @IsOptional() @clean() @IsString() @MaxLength(300)
  description?: string | null;

  @IsDateString({}, { message: 'تاريخ الصرف غير صحيح' })
  disbursedOn!: string;

  @IsOptional() @clean() @IsString() @MaxLength(50)
  referenceNo?: string | null;

  /** الطلب المعتمد الذي تُصرف عليه المساعدة */
  @IsOptional() @IsUUID()
  requestId?: string | null;
}

export class AidLogQuery {
  @IsOptional() @IsDateString()
  from?: string;

  @IsOptional() @IsDateString()
  to?: string;

  @IsOptional() @IsIn(AID_TYPES)
  aidType?: AidType;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1)
  page?: number;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(200)
  pageSize?: number;
}

export class UploadDocumentDto {
  @clean() @IsString() @MinLength(2, { message: 'اكتب اسم المستند' }) @MaxLength(200)
  title!: string;

  @IsIn(DOCUMENT_TYPES, { message: 'اختر نوع المستند' })
  docType!: DocumentType;
}
