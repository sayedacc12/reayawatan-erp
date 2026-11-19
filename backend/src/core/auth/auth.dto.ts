import { IsOptional, IsString, MaxLength, MinLength, ValidateIf } from 'class-validator';
import { IsStrongPassword } from '../validation';

export class LoginDto {
  /** البريد الإلكتروني أو اسم المستخدم */
  @ValidateIf((o: LoginDto) => o.email === undefined)
  @IsString({ message: 'اكتب البريد الإلكتروني أو اسم المستخدم' })
  @MinLength(1, { message: 'اكتب البريد الإلكتروني أو اسم المستخدم' })
  @MaxLength(254)
  login?: string;

  /** الاسم القديم للحقل، مقبول للتوافق مع الواجهات القديمة */
  @IsOptional()
  @IsString()
  @MaxLength(254)
  email?: string;

  @IsString()
  @MinLength(1, { message: 'كلمة المرور مطلوبة' })
  @MaxLength(200)
  password!: string;

  /** معرف الجمعية (slug) من رابط صفحة دخولها. بدونه الدخول لمدير المنصة فقط */
  @IsOptional()
  @IsString()
  @MaxLength(64)
  organization?: string;
}

export class ChangePasswordDto {
  @IsString()
  @MinLength(1, { message: 'كلمة المرور الحالية مطلوبة' })
  currentPassword!: string;

  @IsStrongPassword()
  newPassword!: string;
}

export class ForgotPasswordDto {
  /** البريد الإلكتروني أو اسم المستخدم */
  @IsString({ message: 'اكتب البريد الإلكتروني أو اسم المستخدم' })
  @MinLength(1, { message: 'اكتب البريد الإلكتروني أو اسم المستخدم' })
  @MaxLength(254)
  login!: string;

  /** معرف الجمعية من رابط صفحة دخولها، وبدونه الطلب لفريق المنصة */
  @IsOptional()
  @IsString()
  @MaxLength(64)
  organization?: string;
}
