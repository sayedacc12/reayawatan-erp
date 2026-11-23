import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize, IsArray, IsBoolean, IsDateString, IsEmail, IsIn, IsInt, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, MinLength, ValidateIf, ValidateNested,
} from 'class-validator';
import { ACTIVITY_TYPES, ASSIGN_MODES, CHANNELS, DECISION_ROLES, LEAD_STATUS, MAX_FOLLOWERS, MAX_PICKED_PARTIES, PARTY_KINDS, PARTY_ROLES } from './entities/crm.entity';
import { WEB_TOPIC_INTEREST } from './crm-defaults';

const KEY = /^[a-z][a-z0-9_]{1,39}$/;
const PHONE = /^\+?[0-9]{7,20}$/;
const opt = (_: unknown, v: unknown) => v !== null && v !== undefined && v !== '';
const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const lower = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim().toLowerCase() : value);
const PHONE_MSG = 'رقم الجوال أو الهاتف غير صحيح (أرقام فقط، مثل 0512345678)';

// ---------------- الإعدادات ----------------

export class ListItemDto {
  @Matches(KEY, { message: 'رمز العنصر حروف إنجليزية صغيرة' }) key!: string;
  @IsString() @Transform(trim) @MinLength(2, { message: 'اكتب اسم العنصر' }) @MaxLength(120) label!: string;
  @IsBoolean() isActive!: boolean;
}

export class SettingsDto {
  @IsInt() @Min(1, { message: 'المهلة ساعة واحدة على الأقل' }) @Max(720) slaHours!: number;
  @IsIn(Object.keys(ASSIGN_MODES)) assignMode!: keyof typeof ASSIGN_MODES;
  @IsArray() @ArrayMaxSize(200) @IsUUID('all', { each: true }) team!: string[];
  @IsArray() @ArrayMaxSize(5) @IsIn(Object.keys(WEB_TOPIC_INTEREST), { each: true }) webTopics!: string[];
  @IsIn(['all', 'own']) partyVisibility!: 'all' | 'own';
}

export class ListsDto {
  @IsArray() @ArrayMaxSize(60) @ValidateNested({ each: true }) @Type(() => ListItemDto) sources!: ListItemDto[];
  @IsArray() @ArrayMaxSize(60) @ValidateNested({ each: true }) @Type(() => ListItemDto) interests!: ListItemDto[];
  @IsArray() @ArrayMaxSize(60) @ValidateNested({ each: true }) @Type(() => ListItemDto) disqualifyReasons!: ListItemDto[];
}

// ---------------- الجهات ----------------

export class PartyListQuery {
  @IsOptional() @IsString() @MaxLength(100) q?: string;
  @IsOptional() @IsIn(Object.keys(PARTY_ROLES)) role?: string;
  @IsOptional() @IsIn(Object.keys(PARTY_KINDS)) kind?: string;
  @IsOptional() @IsUUID() owner?: string;
  @IsOptional() @IsString() @MaxLength(60) tag?: string;
  @IsOptional() @IsIn(['mine', 'unowned']) scope?: string;
}

export class PartyDto {
  @IsIn(Object.keys(PARTY_KINDS)) kind!: keyof typeof PARTY_KINDS;
  @IsString() @Transform(trim) @MinLength(2, { message: 'اكتب اسم الجهة' }) @MaxLength(250) name!: string;
  @IsOptional() @ValidateIf(opt) @Transform(trim) @Matches(PHONE, { message: PHONE_MSG }) phone?: string | null;
  @IsOptional() @ValidateIf(opt) @Transform(lower) @IsEmail({}, { message: 'البريد الإلكتروني غير صحيح' }) @MaxLength(200) email?: string | null;
  @IsOptional() @IsString() @MaxLength(100) city?: string | null;
  @IsOptional() @ValidateIf(opt) @Matches(/^3\d{13}3$/, { message: 'الرقم الضريبي 15 رقمًا يبدأ وينتهي بالرقم 3' }) vatNumber?: string | null;
  @IsOptional() @IsString() @MaxLength(40) crNumber?: string | null;
  @IsOptional() @ValidateIf(opt) @IsUUID() ownerId?: string | null;
  @IsOptional() @ValidateIf(opt) @Matches(KEY) source?: string | null;
  @IsOptional() @IsArray() @ArrayMaxSize(20) @IsString({ each: true }) @MaxLength(40, { each: true }) tags?: string[];
  @IsOptional() @IsString() @MaxLength(2000) notes?: string | null;
  /** تجاوز تنبيه التكرار بعد أن رأى المستخدم الجهات المشابهة */
  @IsOptional() @IsBoolean() allowDuplicate?: boolean;
}

export class DuplicateCheckQuery {
  @IsOptional() @IsString() @MaxLength(30) phone?: string;
  @IsOptional() @IsString() @MaxLength(200) email?: string;
  @IsOptional() @IsString() @MaxLength(15) vat?: string;
  @IsOptional() @IsString() @MaxLength(250) name?: string;
  @IsOptional() @IsUUID() exclude?: string;
}

export class ConsentItemDto {
  @IsIn(Object.keys(CHANNELS)) channel!: keyof typeof CHANNELS;
  @IsBoolean() granted!: boolean;
  @IsString() @Transform(trim) @MinLength(2, { message: 'اذكر مصدر الموافقة أو الإلغاء، مثل: نموذج التسجيل في المعرض' }) @MaxLength(200) source!: string;
}
export class ConsentsDto {
  @IsArray() @ArrayMaxSize(3) @ValidateNested({ each: true }) @Type(() => ConsentItemDto) items!: ConsentItemDto[];
  @IsBoolean() doNotContact!: boolean;
}

export class ContactDto {
  @IsString() @Transform(trim) @MinLength(2, { message: 'اكتب اسم الشخص' }) @MaxLength(200) name!: string;
  @IsOptional() @IsString() @MaxLength(150) title?: string | null;
  @IsOptional() @ValidateIf(opt) @Transform(trim) @Matches(PHONE, { message: PHONE_MSG }) phone?: string | null;
  @IsOptional() @ValidateIf(opt) @Transform(lower) @IsEmail({}, { message: 'البريد الإلكتروني غير صحيح' }) email?: string | null;
  @IsIn(Object.keys(DECISION_ROLES)) decisionRole!: keyof typeof DECISION_ROLES;
  @IsBoolean() isPrimary!: boolean;
  @IsOptional() @IsString() @MaxLength(1000) notes?: string | null;
}

export class LinkDto {
  @IsIn(['customer', 'member', 'volunteer', 'partner']) role!: 'customer' | 'member' | 'volunteer' | 'partner';
  @IsUUID() refId!: string;
}

export class LinkCandidatesQuery {
  @IsIn(['customer', 'member', 'volunteer', 'partner']) role!: 'customer' | 'member' | 'volunteer' | 'partner';
  @IsOptional() @IsString() @MaxLength(100) q?: string;
}

export class MergeDto {
  @IsUUID() removeId!: string;
}

export class OwnerDto {
  @IsOptional() @ValidateIf(opt) @IsUUID() ownerId!: string | null;
}

// ---------------- العملاء المحتملون ----------------

export class LeadListQuery {
  @IsOptional() @IsString() @MaxLength(100) q?: string;
  @IsOptional() @IsIn([...Object.keys(LEAD_STATUS), 'open']) status?: string;
  @IsOptional() @Matches(KEY) source?: string;
  @IsOptional() @Matches(KEY) interest?: string;
  @IsOptional() @IsUUID() owner?: string;
  @IsOptional() @IsIn(['mine', 'unassigned', 'overdue']) scope?: string;
}

export class LeadDto {
  @IsString() @Transform(trim) @MinLength(2, { message: 'اكتب اسم العميل المحتمل' }) @MaxLength(200) name!: string;
  @IsOptional() @IsString() @MaxLength(250) company?: string | null;
  @IsOptional() @IsString() @MaxLength(150) title?: string | null;
  @IsOptional() @ValidateIf(opt) @Transform(trim) @Matches(PHONE, { message: PHONE_MSG }) phone?: string | null;
  @IsOptional() @ValidateIf(opt) @Transform(lower) @IsEmail({}, { message: 'البريد الإلكتروني غير صحيح' }) @MaxLength(200) email?: string | null;
  @IsOptional() @IsString() @MaxLength(100) city?: string | null;
  @IsOptional() @ValidateIf(opt) @Matches(KEY) interest?: string | null;
  @Matches(KEY, { message: 'اختر مصدر العميل المحتمل' }) source!: string;
  @IsOptional() @IsString() @MaxLength(200) campaign?: string | null;
  @IsOptional() @IsString() @MaxLength(4000) message?: string | null;
  @IsOptional() @ValidateIf(opt) @IsUUID() ownerId?: string | null;
  @IsOptional() @IsBoolean() allowDuplicate?: boolean;
}

export class LeadStatusDto {
  @IsIn(['new', 'contacted', 'qualified', 'disqualified']) status!: 'new' | 'contacted' | 'qualified' | 'disqualified';
  @ValidateIf((o: LeadStatusDto) => o.status === 'disqualified') @Matches(KEY, { message: 'اختر سبب عدم التأهيل' }) reason?: string;
  @IsOptional() @IsString() @MaxLength(1000) note?: string | null;
}

export class ConvertDto {
  /** ربط العميل المحتمل بجهة موجودة بدل إنشاء جهة جديدة */
  @IsOptional() @ValidateIf(opt) @IsUUID() partyId?: string | null;
  /** نشاط المتابعة التالي (اختياري) */
  @IsOptional() @IsString() @MaxLength(250) nextSubject?: string | null;
  @IsOptional() @ValidateIf(opt) @IsDateString() nextDueAt?: string | null;
  @IsOptional() @IsBoolean() allowDuplicate?: boolean;
}

export class ImportRowDto {
  @IsString() @Transform(trim) @MinLength(2) @MaxLength(200) name!: string;
  @IsOptional() @IsString() @MaxLength(250) company?: string | null;
  @IsOptional() @IsString() @MaxLength(40) phone?: string | null;
  @IsOptional() @IsString() @MaxLength(200) email?: string | null;
  @IsOptional() @IsString() @MaxLength(100) city?: string | null;
  @IsOptional() @IsString() @MaxLength(1000) notes?: string | null;
}
export class ImportDto {
  @IsArray() @ArrayMaxSize(2000, { message: 'الحد الأقصى 2000 صف في المرة الواحدة' }) @ValidateNested({ each: true }) @Type(() => ImportRowDto) rows!: ImportRowDto[];
  @Matches(KEY, { message: 'اختر المصدر' }) source!: string;
  @IsOptional() @ValidateIf(opt) @Matches(KEY) interest?: string | null;
  @IsOptional() @IsString() @MaxLength(200) campaign?: string | null;
  /** تجربة فقط: يعرض ما سيحدث دون حفظ */
  @IsBoolean() dryRun!: boolean;
}

// ---------------- الأنشطة ----------------

export class ActivityListQuery {
  @IsOptional() @IsIn(['open', 'done', 'overdue', 'today']) status?: string;
  @IsOptional() @IsUUID() owner?: string;
  @IsOptional() @IsDateString() from?: string;
  @IsOptional() @IsDateString() to?: string;
  @IsOptional() @IsIn(Object.keys(ACTIVITY_TYPES)) type?: string;
}

export class ActivityDto {
  @IsIn(Object.keys(ACTIVITY_TYPES)) type!: keyof typeof ACTIVITY_TYPES;
  @IsString() @Transform(trim) @MinLength(2, { message: 'اكتب عنوان النشاط' }) @MaxLength(250) subject!: string;
  @IsOptional() @IsString() @MaxLength(4000) details?: string | null;
  @IsOptional() @ValidateIf(opt) @IsDateString() dueAt?: string | null;
  /** تم تنفيذه الآن (يُسجل كنشاط منجز) */
  @IsBoolean() done!: boolean;
  @IsOptional() @IsString() @MaxLength(2000) outcome?: string | null;
  @IsOptional() @ValidateIf(opt) @IsUUID() partyId?: string | null;
  @IsOptional() @ValidateIf(opt) @IsUUID() leadId?: string | null;
  /** عدة جهات مختارة (جهة واحدة هنا تُعامل كـ partyId) */
  @IsOptional() @IsArray() @ArrayMaxSize(MAX_PICKED_PARTIES, { message: `اختر ${MAX_PICKED_PARTIES} جهة على الأكثر، أو اختر «الكل»` }) @IsUUID('all', { each: true }) partyIds?: string[];
  /** كل العملاء (أو كل الجهات إن كان audienceRole فارغًا) في نطاق رؤية الموظف وقت الإنشاء */
  @IsOptional() @IsBoolean() allParties?: boolean;
  @IsOptional() @ValidateIf(opt) @IsIn(Object.keys(PARTY_ROLES)) audienceRole?: keyof typeof PARTY_ROLES | null;
  @IsOptional() @ValidateIf(opt) @IsUUID() ownerId?: string | null;
  /** متابعون للاطلاع فقط */
  @IsOptional() @IsArray() @ArrayMaxSize(MAX_FOLLOWERS) @IsUUID('all', { each: true }) followerIds?: string[];
}

export class FollowersDto {
  @IsArray() @ArrayMaxSize(MAX_FOLLOWERS) @IsUUID('all', { each: true }) userIds!: string[];
}

export class CompleteActivityDto {
  @IsOptional() @IsString() @MaxLength(2000) outcome?: string | null;
  @IsOptional() @IsString() @MaxLength(250) nextSubject?: string | null;
  @IsOptional() @IsIn(Object.keys(ACTIVITY_TYPES)) nextType?: keyof typeof ACTIVITY_TYPES;
  @IsOptional() @ValidateIf(opt) @IsDateString() nextDueAt?: string | null;
}
