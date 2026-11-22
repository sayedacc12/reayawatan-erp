import { IsValidPassword } from '../validation';
import { ArrayUnique, IsArray, IsBoolean, IsEmail, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';

export class CreateOrganizationDto {
  @IsString()
  @MinLength(2, { message: 'اسم الشركة قصير جدًا' })
  @MaxLength(200)
  name!: string;

  @Matches(/^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/, {
    message: 'المعرف بحروف إنجليزية صغيرة وأرقام وشرطة فقط، مثل al-bir',
  })
  slug!: string;

  @IsString()
  @MinLength(2, { message: 'اسم مدير الشركة قصير جدًا' })
  @MaxLength(200)
  adminFullName!: string;

  @IsEmail({}, { message: 'بريد مدير الشركة غير صحيح' })
  adminEmail!: string;

  @IsValidPassword('كلمة مرور مدير الشركة 8 أحرف على الأقل')
  adminPassword!: string;
}

export class UpdateOrganizationDto {
  @IsOptional()
  @IsString()
  @MinLength(2, { message: 'اسم الشركة قصير جدًا' })
  @MaxLength(200)
  name?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class SetOrganizationModulesDto {
  /** أكواد الوحدات الاختيارية المفعلة لهذه الشركة (القائمة كاملة) */
  @IsArray()
  @ArrayUnique()
  @IsString({ each: true })
  modules!: string[];
}
