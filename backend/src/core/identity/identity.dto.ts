import { Type } from 'class-transformer';
import {
  ArrayMaxSize, IsArray, IsBoolean, IsIn, IsOptional, IsString, Matches, MaxLength, ValidateNested,
} from 'class-validator';

/** الخطوط العربية المتاحة (من Google Fonts) */
export const IDENTITY_FONTS = [
  'IBM Plex Sans Arabic', 'Tajawal', 'Cairo', 'Almarai', 'Noto Kufi Arabic', 'Readex Pro', 'Alexandria',
  'El Messiri', 'Changa', 'Reem Kufi', 'Amiri', 'Noto Naskh Arabic', 'Rubik',
] as const;

const COLOR = /^#[0-9a-fA-F]{6}$/;
const COLOR_MSG = 'اللون يجب أن يكون بصيغة #RRGGBB';

export class ColorsDto {
  @Matches(COLOR, { message: COLOR_MSG }) primary!: string;
  @Matches(COLOR, { message: COLOR_MSG }) secondary!: string;
  @Matches(COLOR, { message: COLOR_MSG }) accent!: string;
  @Matches(COLOR, { message: COLOR_MSG }) dark!: string;
}

export class FontsDto {
  @IsIn(IDENTITY_FONTS, { message: 'الخط غير متاح' }) body!: string;
  @IsIn(IDENTITY_FONTS, { message: 'الخط غير متاح' }) heading!: string;
}

export class ValueDto {
  @IsString() @MaxLength(80) title!: string;
  @IsString() @MaxLength(400) text!: string;
}

export class SocialDto {
  @IsOptional() @IsString() @MaxLength(300) x?: string;
  @IsOptional() @IsString() @MaxLength(300) instagram?: string;
  @IsOptional() @IsString() @MaxLength(300) linkedin?: string;
  @IsOptional() @IsString() @MaxLength(300) youtube?: string;
  @IsOptional() @IsString() @MaxLength(300) snapchat?: string;
  @IsOptional() @IsString() @MaxLength(300) tiktok?: string;
  @IsOptional() @IsString() @MaxLength(300) facebook?: string;
  @IsOptional() @IsString() @MaxLength(30) whatsapp?: string;
}

export class ContactDto {
  @IsOptional() @IsString() @MaxLength(30) phone?: string;
  @IsOptional() @IsString() @MaxLength(200) email?: string;
  @IsOptional() @IsString() @MaxLength(300) address?: string;
  @IsOptional() @IsString() @MaxLength(100) city?: string;
  @IsOptional() @IsString() @MaxLength(500) mapUrl?: string;
  @IsOptional() @IsString() @MaxLength(200) workingHours?: string;
  @IsOptional() @IsString() @MaxLength(60) poBox?: string;
  @IsOptional() @ValidateNested() @Type(() => SocialDto) social?: SocialDto;
}

export class IdentityDto {
  @IsOptional() @IsString() @MaxLength(200) displayName?: string | null;
  @IsOptional() @IsString() @MaxLength(60) shortName?: string | null;
  @IsOptional() @IsString() @MaxLength(200) englishName?: string | null;
  @IsOptional() @IsString() @MaxLength(300) slogan?: string | null;
  @IsOptional() @IsString() @MaxLength(4000) about?: string | null;
  @IsOptional() @IsString() @MaxLength(1000) vision?: string | null;
  @IsOptional() @IsString() @MaxLength(1500) mission?: string | null;
  @IsArray() @ArrayMaxSize(20) @IsString({ each: true }) @MaxLength(400, { each: true }) goals!: string[];
  @IsArray() @ArrayMaxSize(12) @ValidateNested({ each: true }) @Type(() => ValueDto) values!: ValueDto[];
  @ValidateNested() @Type(() => ColorsDto) colors!: ColorsDto;
  @ValidateNested() @Type(() => FontsDto) fonts!: FontsDto;
  @ValidateNested() @Type(() => ContactDto) contact!: ContactDto;
  @IsOptional() @IsString() @MaxLength(60) licenseNo?: string | null;
  @IsOptional() @IsString() @MaxLength(200) licenseAuthority?: string | null;
  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'تاريخ التأسيس غير صحيح' }) foundedOn?: string | null;
  @IsBoolean() applyToSystem!: boolean;
}
