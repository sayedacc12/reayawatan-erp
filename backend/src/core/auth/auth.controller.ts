import { Body, Controller, Get, HttpCode, Ip, Param, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { AuthService } from './auth.service';
import { ChangePasswordDto, ForgotPasswordDto, LoginDto } from './auth.dto';
import { AllowWithTempPassword, AuthUser, CurrentUser, Public } from './decorators';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  /** الدخول الموحد لكل وحدات النظام */
  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('login')
  @HttpCode(200)
  login(@Body() dto: LoginDto) {
    return this.auth.login(dto.login ?? dto.email ?? '', dto.password, dto.organization);
  }

  /** بيانات صفحة دخول الجمعية (اسمها فقط) */
  @Public()
  @Get('org/:slug')
  organization(@Param('slug') slug: string) {
    return this.auth.organizationLogin(slug);
  }

  /** نسيت كلمة المرور: 5 طلبات كل 15 دقيقة لكل عنوان، والرد واحد دائمًا */
  @Public()
  @Throttle({ default: { limit: 5, ttl: 15 * 60_000 } })
  @Post('forgot')
  @HttpCode(200)
  forgot(@Body() dto: ForgotPasswordDto, @Ip() ip: string) {
    return this.auth.forgot(dto.login, dto.organization, ip ?? null);
  }

  @AllowWithTempPassword()
  @Get('me')
  me(@CurrentUser() user: AuthUser) {
    return this.auth.session(user.id);
  }

  @AllowWithTempPassword()
  @Post('change-password')
  @HttpCode(204)
  async changePassword(@CurrentUser() user: AuthUser, @Body() dto: ChangePasswordDto) {
    await this.auth.changePassword(user.id, dto.currentPassword, dto.newPassword);
  }
}
