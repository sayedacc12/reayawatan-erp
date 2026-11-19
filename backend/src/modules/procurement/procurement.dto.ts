import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize, IsArray, IsBoolean, IsIn, IsInt, IsNumber, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, MinLength, ValidateIf, ValidateNested,
} from 'class-validator';
import { IsCheckedEmail, IsPersonName, IsSaudiMobile, IsSaudiPhone, toLatinDigits } from '../../core/contact-validation';
import { IsStrongPassword } from '../../core/validation';
import {
  ENTITY_TYPES, ISSUE_POLICY, ITEM_KINDS, LOCATION_KINDS, LOCATION_PURPOSE, PORTAL_ROLES, SUPPLIER_KINDS, VALUATION, WAREHOUSE_KINDS,
} from './entities/procurement.entity';

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const COLOR = /^#[0-9a-fA-F]{6}$/;
const CODE = /^[A-Z0-9][A-Z0-9-]{0,11}$/;
const opt = (_: unknown, v: unknown) => v !== null && v !== undefined && v !== '';
const keys = (o: object) => Object.keys(o);
const digits = () => Transform(({ value }) => (typeof value === 'string' ? toLatinDigits(value).replace(/\s+/g, '') || null : value));
const upper = () => Transform(({ value }) => (typeof value === 'string' ? toLatinDigits(value).trim().toUpperCase() : value));
const trim = () => Transform(({ value }) => (typeof value === 'string' ? value.trim() || null : value));

// ---------------- الإعدادات ----------------

export class DocTypeDto {
  @IsString() @Matches(/^[a-z][a-z0-9_]{1,39}$/, { message: 'رمز المستند بالحروف الإنجليزية الصغيرة' }) key!: string;
  @IsString() @MinLength(2, { message: 'اكتب اسم المستند' }) @MaxLength(200) name!: string;
  @IsBoolean() required!: boolean;
  @IsBoolean() hasExpiry!: boolean;
  @IsArray() @IsIn(keys(ENTITY_TYPES), { each: true }) entityTypes!: (keyof typeof ENTITY_TYPES)[];
  @IsBoolean() isActive!: boolean;
}

export class SettingsDto {
  @IsOptional() @IsIn(keys(VALUATION)) valuation?: keyof typeof VALUATION;
  @IsOptional() @IsIn(['group', 'warehouse']) accountLevel?: 'group' | 'warehouse';
  @IsOptional() @IsInt() @Min(1) @Max(365) docAlertDays?: number;
  @IsOptional() @IsArray() @ArrayMaxSize(40) @ValidateNested({ each: true }) @Type(() => DocTypeDto) supplierDocTypes?: DocTypeDto[];
  @IsOptional() @IsArray() @ArrayMaxSize(80) @IsString({ each: true }) @MaxLength(80, { each: true }) activities?: string[];
  @IsOptional() @IsBoolean() portalOpen?: boolean;
  @IsOptional() @IsString() @MaxLength(2000) portalIntro?: string | null;
  @IsOptional() @IsUUID() partnerCategoryId?: string | null;
  @IsOptional() @IsUUID() payablesAccountId?: string | null;
}

export class SupplierCategoryDto {
  @IsOptional() @IsUUID() id?: string;
  @IsString() @MinLength(2, { message: 'اكتب اسم التصنيف' }) @MaxLength(120) name!: string;
  @IsOptional() @IsString() @MaxLength(500) description?: string | null;
  @Matches(COLOR) color!: string;
  @IsBoolean() isActive!: boolean;
}
export class SupplierCategoriesDto {
  @IsArray() @ArrayMaxSize(60) @ValidateNested({ each: true }) @Type(() => SupplierCategoryDto) categories!: SupplierCategoryDto[];
}

// ---------------- الأصناف ----------------

export class UomDto {
  @IsString() @MinLength(1, { message: 'اكتب اسم الوحدة' }) @MaxLength(60) name!: string;
  @IsOptional() @IsString() @MaxLength(20) symbol?: string | null;
  @IsOptional() @IsBoolean() isActive?: boolean;
}

export class ItemGroupDto {
  @IsOptional() @IsUUID() parentId?: string | null;
  @upper() @Matches(CODE, { message: 'رمز المجموعة بالحروف الإنجليزية الكبيرة والأرقام (حتى 12 خانة)، مثل FOOD' }) code!: string;
  @IsString() @MinLength(2, { message: 'اكتب اسم المجموعة' }) @MaxLength(150) name!: string;
  @IsIn(keys(ITEM_KINDS)) kind!: keyof typeof ITEM_KINDS;
  @IsOptional() @IsUUID() inventoryAccountId?: string | null;
  @IsOptional() @IsUUID() expenseAccountId?: string | null;
  @IsOptional() @IsUUID() assetGroupId?: string | null;
  @IsOptional() @IsIn(keys(VALUATION)) valuation?: keyof typeof VALUATION | null;
  @IsOptional() @IsString() @MaxLength(500) description?: string | null;
  @IsOptional() @IsBoolean() isActive?: boolean;
}

export class ItemUnitDto {
  @IsUUID() uomId!: string;
  @IsNumber({}, { message: 'معامل التحويل رقم' }) @Min(0.0001) @Max(1_000_000) factor!: number;
  @IsOptional() @digits() @IsString() @MaxLength(60) barcode?: string | null;
}
export class ItemSpecDto {
  @IsString() @MinLength(1) @MaxLength(100) name!: string;
  @IsString() @MaxLength(500) value!: string;
}

export class ItemDto {
  @IsString() @MinLength(2, { message: 'اكتب اسم الصنف' }) @MaxLength(250) name!: string;
  @IsUUID('all', { message: 'اختر مجموعة الصنف' }) groupId!: string;
  @IsOptional() @IsIn(keys(ITEM_KINDS)) kind?: keyof typeof ITEM_KINDS;
  @IsUUID('all', { message: 'اختر وحدة القياس الأساسية' }) uomId!: string;
  @IsOptional() @IsArray() @ArrayMaxSize(10) @ValidateNested({ each: true }) @Type(() => ItemUnitDto) units?: ItemUnitDto[];
  @IsOptional() @digits() @IsString() @MaxLength(60) barcode?: string | null;
  @IsOptional() @IsString() @MaxLength(4000) description?: string | null;
  @IsOptional() @IsArray() @ArrayMaxSize(30) @ValidateNested({ each: true }) @Type(() => ItemSpecDto) specs?: ItemSpecDto[];
  @IsOptional() @IsBoolean() trackBatch?: boolean;
  @IsOptional() @IsBoolean() trackSerial?: boolean;
  @IsOptional() @IsBoolean() trackExpiry?: boolean;
  @IsOptional() @IsInt() @Min(1) @Max(36500) shelfLifeDays?: number | null;
  @IsOptional() @IsNumber() @Min(0) minQty?: number | null;
  @IsOptional() @IsNumber() @Min(0) maxQty?: number | null;
  @IsOptional() @IsNumber() @Min(0) reorderPoint?: number | null;
  @IsOptional() @IsNumber() @Min(0) reorderQty?: number | null;
  @IsOptional() @IsIn(keys(ISSUE_POLICY)) issuePolicy?: keyof typeof ISSUE_POLICY;
  @IsOptional() @IsIn(keys(VALUATION)) valuation?: keyof typeof VALUATION | null;
  @IsOptional() @IsUUID() inventoryAccountId?: string | null;
  @IsOptional() @IsUUID() expenseAccountId?: string | null;
  @IsOptional() @IsNumber() @Min(0) refPrice?: number | null;
  /** تأكيد الحفظ رغم وجود صنف باسم قريب */
  @IsOptional() @IsBoolean() confirmSimilar?: boolean;
}

export class StopItemDto {
  @IsString() @MinLength(3, { message: 'اكتب سبب الإيقاف' }) @MaxLength(500) reason!: string;
  @IsOptional() @IsUUID() replacedById?: string | null;
}

export class AlternativeDto {
  @IsUUID() itemId!: string;
  @IsIn(['alternative', 'equivalent']) kind!: 'alternative' | 'equivalent';
  @IsOptional() @IsString() @MaxLength(500) note?: string | null;
}

// ---------------- المستودعات ----------------

export class WarehouseDto {
  @IsOptional() @upper() @Matches(/^[A-Z0-9][A-Z0-9-]{0,19}$/, { message: 'رمز المستودع بالحروف الإنجليزية والأرقام، مثل WH-01' }) code?: string;
  @IsString() @MinLength(2, { message: 'اكتب اسم المستودع' }) @MaxLength(200) name!: string;
  @IsIn(keys(WAREHOUSE_KINDS)) kind!: keyof typeof WAREHOUSE_KINDS;
  @IsOptional() @IsUUID() parentId?: string | null;
  @IsOptional() @IsUUID() unitId?: string | null;
  @IsOptional() @IsUUID() projectId?: string | null;
  @IsOptional() @IsString() @MaxLength(100) city?: string | null;
  @IsOptional() @IsString() @MaxLength(500) address?: string | null;
  @IsOptional() @IsArray() @ArrayMaxSize(10) @IsUUID('all', { each: true }) keeperIds?: string[];
  @IsOptional() @IsUUID() glAccountId?: string | null;
  @IsOptional() @IsString() @MaxLength(500) capacity?: string | null;
  @IsOptional() @IsString() @MaxLength(1000) notes?: string | null;
  @IsOptional() @IsBoolean() isActive?: boolean;
}

export class LocationDto {
  @IsOptional() @IsUUID() parentId?: string | null;
  @upper() @Matches(/^[A-Z0-9][A-Z0-9-]{0,29}$/, { message: 'رمز الموقع بالحروف الإنجليزية والأرقام، مثل A-01' }) code!: string;
  @IsString() @MinLength(1, { message: 'اكتب اسم الموقع' }) @MaxLength(150) name!: string;
  @IsIn(keys(LOCATION_KINDS)) kind!: keyof typeof LOCATION_KINDS;
  @IsIn(keys(LOCATION_PURPOSE)) purpose!: keyof typeof LOCATION_PURPOSE;
  @IsOptional() @IsString() @MaxLength(200) capacity?: string | null;
  @IsOptional() @IsBoolean() isActive?: boolean;
}

// ---------------- الموردون ----------------

export class ContactDto {
  @IsString() @MinLength(2, { message: 'اكتب اسم جهة التواصل' }) @MaxLength(200) name!: string;
  @IsOptional() @IsString() @MaxLength(120) title?: string | null;
  @IsOptional() @ValidateIf(opt) @IsSaudiPhone('جوال جهة التواصل') phone?: string | null;
  @IsOptional() @ValidateIf(opt) @IsCheckedEmail('بريد جهة التواصل') email?: string | null;
  @IsBoolean() authorized!: boolean;
}
export class BranchDto {
  @IsString() @MinLength(2, { message: 'اكتب اسم الفرع' }) @MaxLength(150) name!: string;
  @IsOptional() @IsString() @MaxLength(100) city?: string | null;
  @IsOptional() @IsString() @MaxLength(300) address?: string | null;
  @IsOptional() @ValidateIf(opt) @IsSaudiPhone('هاتف الفرع') phone?: string | null;
}

/** بيانات المورد (من الموظف أو من البوابة) */
export class SupplierDto {
  @IsString() @MinLength(2, { message: 'اكتب اسم المنشأة' }) @MaxLength(250) name!: string;
  @IsOptional() @IsString() @MaxLength(250) nameEn?: string | null;
  @IsIn(keys(ENTITY_TYPES), { message: 'اختر نوع الكيان' }) entityType!: keyof typeof ENTITY_TYPES;
  @IsIn(keys(SUPPLIER_KINDS), { message: 'اختر نوع المورد' }) supplierKind!: keyof typeof SUPPLIER_KINDS;
  @IsOptional() @IsArray() @ArrayMaxSize(10) @IsUUID('all', { each: true }) categoryIds?: string[];
  @IsOptional() @IsArray() @ArrayMaxSize(30) @IsString({ each: true }) @MaxLength(80, { each: true }) activities?: string[];
  @IsOptional() @IsString() @MaxLength(4000) about?: string | null;
  @IsOptional() @digits() @ValidateIf(opt) @Matches(/^\d{10}$/, { message: 'رقم السجل التجاري 10 أرقام' }) crNumber?: string | null;
  @IsOptional() @ValidateIf(opt) @Matches(DATE) crExpiry?: string | null;
  @IsOptional() @digits() @ValidateIf(opt) @Matches(/^3\d{13}3$/, { message: 'الرقم الضريبي 15 رقمًا يبدأ بـ 3 وينتهي بـ 3' }) vatNumber?: string | null;
  @IsOptional() @digits() @ValidateIf(opt) @Matches(/^[12]\d{9}$/, { message: 'رقم الهوية أو الإقامة 10 أرقام يبدأ بـ 1 أو 2' }) nationalId?: string | null;
  @IsOptional() @IsString() @MaxLength(100) city?: string | null;
  @IsOptional() @IsString() @MaxLength(500) address?: string | null;
  @IsOptional() @ValidateIf(opt) @IsSaudiPhone('هاتف المنشأة') phone?: string | null;
  @IsOptional() @ValidateIf(opt) @IsCheckedEmail('بريد المنشأة') email?: string | null;
  @IsOptional() @trim() @ValidateIf(opt) @Matches(/^https?:\/\/\S{3,290}$/, { message: 'الموقع الإلكتروني يبدأ بـ https://' }) website?: string | null;
  @IsOptional() @IsArray() @ArrayMaxSize(10) @ValidateNested({ each: true }) @Type(() => ContactDto) contacts?: ContactDto[];
  @IsOptional() @IsArray() @ArrayMaxSize(30) @ValidateNested({ each: true }) @Type(() => BranchDto) branches?: BranchDto[];
}

export class SupplierDecisionDto {
  @IsIn(['approve', 'return', 'reject']) decision!: 'approve' | 'return' | 'reject';
  @IsOptional() @IsString() @MaxLength(2000) note?: string | null;
}

export class SuspendDto {
  @IsString() @MinLength(3, { message: 'اكتب سبب الإيقاف' }) @MaxLength(2000) reason!: string;
}

export class DocMetaDto {
  @IsString() @Matches(/^[a-z][a-z0-9_]{1,39}$/, { message: 'اختر نوع المستند' }) docType!: string;
  @IsOptional() @IsString() @MaxLength(60) number?: string | null;
  @IsOptional() @ValidateIf(opt) @Matches(DATE, { message: 'تاريخ الإصدار غير صحيح' }) issueDate?: string | null;
  @IsOptional() @ValidateIf(opt) @Matches(DATE, { message: 'تاريخ الانتهاء غير صحيح' }) expiryDate?: string | null;
}

export class DocReviewDto {
  @IsIn(['accept', 'reject']) decision!: 'accept' | 'reject';
  @IsOptional() @IsString() @MaxLength(1000) note?: string | null;
}

export class BankDto {
  @IsString() @MinLength(2, { message: 'اكتب اسم البنك' }) @MaxLength(120) bankName!: string;
  @IsString() @MaxLength(40) iban!: string;
  @IsString() @MinLength(2, { message: 'اكتب اسم صاحب الحساب كما في البنك' }) @MaxLength(250) accountName!: string;
}

export class BankDecisionDto {
  @IsIn(['approve', 'reject']) decision!: 'approve' | 'reject';
  @IsOptional() @IsString() @MaxLength(1000) note?: string | null;
}

export class LinkPartnerDto {
  @IsOptional() @IsUUID() partnerId?: string | null;
}

export class ActiveDto {
  @IsBoolean() active!: boolean;
}

/** حساب بوابة لمورد سجّله الموظف */
export class InviteUserDto {
  @IsPersonName('اسم المستخدم') fullName!: string;
  @IsCheckedEmail('البريد الإلكتروني') email!: string;
  @IsOptional() @ValidateIf(opt) @IsSaudiMobile('الجوال') phone?: string | null;
  @IsOptional() @IsIn(keys(PORTAL_ROLES)) role?: keyof typeof PORTAL_ROLES;
}

// ---------------- بوابة الموردين ----------------

export class PortalRegisterDto extends SupplierDto {
  @IsPersonName('اسم مدير الحساب') ownerName!: string;
  @IsCheckedEmail('البريد الإلكتروني للدخول') ownerEmail!: string;
  @IsSaudiMobile('جوال مدير الحساب') ownerPhone!: string;
  @IsStrongPassword() password!: string;
}

export class PortalLoginDto {
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toLowerCase() : value)) @IsString() @MaxLength(200) email!: string;
  @IsString() @MaxLength(200) password!: string;
}

export class PortalForgotDto {
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toLowerCase() : value)) @IsString() @MaxLength(200) email!: string;
}

export class PortalResetDto {
  @IsString() @Matches(/^[A-Za-z0-9_-]{20,100}$/) token!: string;
  @IsStrongPassword() password!: string;
}

export class PortalChangePasswordDto {
  @IsString() @MaxLength(200) currentPassword!: string;
  @IsStrongPassword() newPassword!: string;
}

export class PortalUserDto {
  @IsPersonName('اسم المستخدم') fullName!: string;
  @IsCheckedEmail('البريد الإلكتروني') email!: string;
  @IsOptional() @ValidateIf(opt) @IsSaudiMobile('الجوال') phone?: string | null;
  @IsIn(keys(PORTAL_ROLES)) role!: keyof typeof PORTAL_ROLES;
  @IsStrongPassword() password!: string;
}

export class PortalUserUpdateDto {
  @IsOptional() @IsIn(keys(PORTAL_ROLES)) role?: keyof typeof PORTAL_ROLES;
  @IsOptional() @IsBoolean() isActive?: boolean;
}
