import { Type } from 'class-transformer';
import {
  ArrayMaxSize, IsArray, IsBoolean, IsIn, IsInt, IsOptional, IsString, IsUUID, Matches, MaxLength, MinLength, ValidateNested,
} from 'class-validator';
import { DOC_STATUS, DOC_TYPES, DOC_VISIBILITY } from './entities/knowledge.entity';

const DATE = /^\d{4}-\d{2}-\d{2}$/;

export class DocumentDto {
  @IsOptional() @IsString() @MaxLength(40) code?: string | null;
  @IsString() @MinLength(2, { message: 'اكتب عنوان الوثيقة' }) @MaxLength(250) title!: string;
  @IsOptional() @IsUUID() categoryId?: string | null;
  @IsIn(Object.keys(DOC_TYPES), { message: 'نوع الوثيقة غير معروف' }) docType!: string;
  @IsOptional() @IsString() @MaxLength(1500) summary?: string | null;
  @IsOptional() @IsString() @MaxLength(60000) content?: string | null;
  @IsArray() @ArrayMaxSize(15) @IsString({ each: true }) @MaxLength(40, { each: true }) tags!: string[];
  @IsString() @MinLength(1) @MaxLength(20) version!: string;
  @IsOptional() @Matches(DATE, { message: 'تاريخ الإصدار غير صحيح' }) issuedOn?: string | null;
  @IsOptional() @Matches(DATE, { message: 'تاريخ المراجعة غير صحيح' }) reviewOn?: string | null;
  @IsOptional() @IsString() @MaxLength(200) ownerName?: string | null;
  @IsOptional() @IsString() @MaxLength(200) approvedBy?: string | null;
  @IsOptional() @IsString() @MaxLength(500) externalUrl?: string | null;
}

export class StatusDto {
  @IsIn(Object.keys(DOC_STATUS)) status!: string;
  @IsIn(Object.keys(DOC_VISIBILITY)) visibility!: string;
  @IsOptional() @IsString() @MaxLength(500) note?: string | null;
}

export class VersionDto {
  @IsString() @MinLength(1) @MaxLength(20) version!: string;
  @IsOptional() @Matches(DATE) issuedOn?: string;
  @IsOptional() @IsString() @MaxLength(500) note?: string;
}

export class CategoryDto {
  @IsOptional() @IsUUID() id?: string;
  @IsString() @MinLength(2) @MaxLength(120) name!: string;
  @IsOptional() @IsString() @MaxLength(500) description?: string | null;
  @Matches(/^#[0-9a-fA-F]{6}$/) color!: string;
  @IsBoolean() isActive!: boolean;
  @IsOptional() @IsInt() sortOrder?: number;
}

export class CategoriesDto {
  @IsArray() @ArrayMaxSize(60) @ValidateNested({ each: true }) @Type(() => CategoryDto) categories!: CategoryDto[];
}
