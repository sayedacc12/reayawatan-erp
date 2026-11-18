import { Type } from 'class-transformer';
import {
  ArrayMaxSize, IsArray, IsBoolean, IsDateString, IsIn, IsInt, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, MinLength, ValidateNested,
} from 'class-validator';
import { Nullable, trim } from '../comms/comms.dto';
import { BODY_KINDS, MEMBER_ROLES } from './entities/meetings.entity';

const DateField = (msg: string) => IsDateString({ strict: true }, { message: msg });
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

export class SettingsDto {
  @Type(() => Number) @IsInt() @Min(1) @Max(60) signDays!: number;
  @Type(() => Number) @IsInt() @Min(1) @Max(365) taskDays!: number;
  @Type(() => Number) @IsInt() @Min(1) @Max(100) defaultQuorum!: number;
  @Nullable() @trim() @IsString() @MaxLength(1000) minutesFooter?: string | null;
}

export class BodyMemberDto {
  @IsOptional() @IsString() @MaxLength(60) key?: string;
  @IsIn(['user', 'member', 'external']) type!: 'user' | 'member' | 'external';
  @Nullable() @IsUUID('4') userId?: string | null;
  @Nullable() @IsUUID('4') memberId?: string | null;
  @IsOptional() @trim() @IsString() @MaxLength(200) name?: string;
  @IsIn(MEMBER_ROLES, { message: 'اختر صفة العضو' }) role!: (typeof MEMBER_ROLES)[number];
  @Nullable() @trim() @IsString() @MaxLength(200) title?: string | null;
  @Nullable() @trim() @IsString() @MaxLength(30) mobile?: string | null;
  @Nullable() @trim() @IsString() @MaxLength(200) email?: string | null;
  @IsBoolean() voting!: boolean;
}

export class BodyDto {
  @IsIn(BODY_KINDS, { message: 'اختر نوع الجهة' }) kind!: (typeof BODY_KINDS)[number];
  @trim() @IsString() @Matches(/^[A-Za-z0-9-]{2,20}$/, { message: 'الرمز حروف إنجليزية وأرقام (مثل BRD أو CMT-FIN)' }) code!: string;
  @trim() @IsString({ message: 'اكتب اسم الجهة' }) @MinLength(3, { message: 'اكتب اسم الجهة' }) @MaxLength(200) name!: string;
  @Nullable() @trim() @IsString() @MaxLength(4000) description?: string | null;
  @Nullable() @IsUUID('4') unitId?: string | null;
  @Nullable() @IsUUID('4') approverUserId?: string | null;
  @Nullable() @IsUUID('4') secretaryUserId?: string | null;
  @IsArray() @ArrayMaxSize(500) @ValidateNested({ each: true }) @Type(() => BodyMemberDto) members!: BodyMemberDto[];
  @Type(() => Number) @IsInt() @Min(1, { message: 'النصاب بين 1 و100%' }) @Max(100, { message: 'النصاب بين 1 و100%' }) quorumPercent!: number;
  @IsBoolean() isConfidential!: boolean;
  @Nullable() @DateField('بداية الدورة غير صحيحة') termStart?: string | null;
  @Nullable() @DateField('نهاية الدورة غير صحيحة') termEnd?: string | null;
  @IsBoolean() isActive!: boolean;
}

export class MeetingDto {
  @IsUUID('4', { message: 'اختر الجهة' }) bodyId!: string;
  @trim() @IsString({ message: 'اكتب عنوان الاجتماع' }) @MinLength(3, { message: 'اكتب عنوان الاجتماع' }) @MaxLength(300) title!: string;
  @IsIn(['ordinary', 'extraordinary']) meetingType!: 'ordinary' | 'extraordinary';
  @IsIn(['in_person', 'online', 'hybrid'], { message: 'اختر طريقة الانعقاد' }) mode!: 'in_person' | 'online' | 'hybrid';
  @Nullable() @trim() @IsString() @MaxLength(300) location?: string | null;
  @Nullable() @trim() @IsString() @MaxLength(500) onlineLink?: string | null;
  @DateField('تاريخ الاجتماع غير صحيح') meetingDate!: string;
  @Matches(TIME, { message: 'وقت البداية بصيغة 09:30' }) startTime!: string;
  @Nullable() @Matches(TIME, { message: 'وقت النهاية بصيغة 11:00' }) endTime?: string | null;
  @Nullable() @trim() @IsString() @MaxLength(4000) objectives?: string | null;
  @IsOptional() @IsBoolean() isConfidential?: boolean;
  /** بنود جدول الأعمال المبدئية عند الإنشاء */
  @IsOptional() @IsArray() @ArrayMaxSize(40) @IsString({ each: true }) @MaxLength(300, { each: true }) agenda?: string[];
}

export class GuestDto {
  @IsIn(['user', 'member', 'external']) type!: 'user' | 'member' | 'external';
  @Nullable() @IsUUID('4') userId?: string | null;
  @Nullable() @IsUUID('4') memberId?: string | null;
  @IsOptional() @trim() @IsString() @MaxLength(200) name?: string;
  @Nullable() @trim() @IsString() @MaxLength(200) title?: string | null;
  @Nullable() @trim() @IsString() @MaxLength(30) mobile?: string | null;
}

export class AgendaItemDto {
  @trim() @IsString({ message: 'اكتب عنوان البند' }) @MinLength(2, { message: 'اكتب عنوان البند' }) @MaxLength(300) title!: string;
  @Nullable() @trim() @IsString() @MaxLength(4000) description?: string | null;
  @Nullable() @trim() @IsString() @MaxLength(200) presenterName?: string | null;
  @Nullable() @Type(() => Number) @IsInt() @Min(1) @Max(600) durationMinutes?: number | null;
}

export class DiscussionDto {
  @Nullable() @IsString() @MaxLength(20000) discussion?: string | null;
  @IsIn(['pending', 'discussed', 'deferred']) status!: 'pending' | 'discussed' | 'deferred';
}

export class RecommendationDto {
  @IsIn(['recommendation', 'decision']) kind!: 'recommendation' | 'decision';
  @trim() @IsString({ message: 'اكتب نص التوصية' }) @MinLength(3, { message: 'اكتب نص التوصية' }) @MaxLength(4000) text!: string;
  @Nullable() @IsUUID('4', { message: 'اختر المسؤول' }) ownerUserId?: string | null;
  @IsOptional() @IsArray() @ArrayMaxSize(20) @IsUUID('4', { each: true }) supporterUserIds?: string[];
  @Nullable() @DateField('موعد التنفيذ غير صحيح') dueDate?: string | null;
  @Nullable() @Type(() => Number) @IsInt() @Min(0) @Max(100000) votesFor?: number | null;
  @Nullable() @Type(() => Number) @IsInt() @Min(0) @Max(100000) votesAgainst?: number | null;
  @Nullable() @Type(() => Number) @IsInt() @Min(0) @Max(100000) votesAbstain?: number | null;
}

export class DecisionDto {
  @IsIn(['approve', 'return'], { message: 'اختر القرار' }) decision!: 'approve' | 'return';
  @Nullable() @trim() @IsString() @MaxLength(1000) note?: string | null;
}

export class RsvpDto {
  @IsIn(['accepted', 'declined', 'tentative'], { message: 'اختر الرد' }) rsvp!: 'accepted' | 'declined' | 'tentative';
  @Nullable() @trim() @IsString() @MaxLength(500) note?: string | null;
}

export class AttendanceDto {
  @IsArray() @ArrayMaxSize(600) @ValidateNested({ each: true }) @Type(() => AttendanceRow) rows!: AttendanceRow[];
}
export class AttendanceRow {
  @IsUUID('4') id!: string;
  @Nullable() @IsIn(['present', 'remote', 'absent', 'excused']) attendance?: 'present' | 'remote' | 'absent' | 'excused' | null;
}

export class MinutesTextDto {
  @Nullable() @IsString() @MaxLength(10000) opening?: string | null;
  @Nullable() @IsString() @MaxLength(10000) closing?: string | null;
}

export class NoteDto {
  @trim() @IsString({ message: 'اكتب السبب' }) @MinLength(3, { message: 'اكتب السبب' }) @MaxLength(1000) note!: string;
}

export class SignDto {
  @IsIn(['sign', 'abstain'], { message: 'اختر: توقيع أو امتناع' }) decision!: 'sign' | 'abstain';
  @IsString({ message: 'اكتب كلمة المرور لتأكيد هويتك' }) @MinLength(1, { message: 'اكتب كلمة المرور لتأكيد هويتك' }) @MaxLength(200) password!: string;
  @Nullable() @trim() @IsString() @MaxLength(1000) reason?: string | null;
}

export class PublicSignDto {
  @IsIn(['sign', 'abstain'], { message: 'اختر: توقيع أو امتناع' }) decision!: 'sign' | 'abstain';
  @Matches(/^\d{6}$/, { message: 'رمز التحقق 6 أرقام' }) code!: string;
  @Nullable() @trim() @IsString() @MaxLength(1000) reason?: string | null;
}
