import { ArrayUnique, IsArray, IsBoolean, IsEmail, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';

export class CreateOrganizationDto {
  @IsString()
  @MinLength(2, { message: 'اسم الجمعية قصير جدًا' })
  @MaxLength(200)
  name!: string;

  @Matches(/^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/, {
    message: 'المعرف بحروف إنجليزية صغيرة وأرقام وشرطة فقط، مثل al-bir',
  })
  slug!: string;

  @IsString()
  @MinLength(2, { message: 'اسم مدير الجمعية قصير جدًا' })
  @MaxLength(200)
  adminFullName!: string;

  @IsEmail({}, { message: 'بريد مدير الجمعية غير صحيح' })
  adminEmail!: string;

  @IsString()
  @MinLength(8, { message: 'كلمة مرور مدير الجمعية 8 أحرف على الأقل' })
  @MaxLength(200)
  adminPassword!: string;
}

export class UpdateOrganizationDto {
  @IsOptional()
  @IsString()
  @MinLength(2, { message: 'اسم الجمعية قصير جدًا' })
  @MaxLength(200)
  name?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class SetOrganizationModulesDto {
  /** أكواد الوحدات الاختيارية المفعلة لهذه الجمعية (القائمة كاملة) */
  @IsArray()
  @ArrayUnique()
  @IsString({ each: true })
  modules!: string[];
}
