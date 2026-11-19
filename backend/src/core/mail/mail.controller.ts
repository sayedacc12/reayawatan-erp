import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { IsArray, IsBoolean, IsInt, IsObject, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { AuthUser, CurrentUser, RequirePermissions } from '../auth/decorators';
import { PLATFORM_PERMISSIONS } from '../core.manifest';
import { MailService } from './mail.service';

export class MailSettingsDto {
  @IsOptional() @IsBoolean() enabled?: boolean;
  @IsOptional() @IsString() @MaxLength(60) senderName?: string;
  @IsOptional() @IsString() @MaxLength(254) replyTo?: string | null;
  @IsOptional() @IsArray() @IsString({ each: true }) @MaxLength(254, { each: true }) adminEmails?: string[];
  @IsOptional() @IsInt() @Min(1) @Max(100000) dailyLimit?: number;
  @IsOptional() @IsObject() events?: Record<string, boolean>;
}

export class MailTestDto {
  @IsString() @MaxLength(254) to!: string;
}

/** إعدادات البريد الصادر وسجله ورسالة الاختبار، لمدير المنصة */
@Controller('platform/mail')
@RequirePermissions(PLATFORM_PERMISSIONS.siteManage)
export class MailController {
  constructor(private readonly mail: MailService) {}

  @Get()
  status() {
    return this.mail.status();
  }

  @Put('settings')
  save(@Body() dto: MailSettingsDto) {
    return this.mail.saveSettings(dto as never);
  }

  @Post('test')
  @Throttle({ default: { limit: 10, ttl: 600_000 } })
  test(@Body() dto: MailTestDto, @CurrentUser() user: AuthUser) {
    return this.mail.sendTest(dto.to, user.fullName);
  }

  @Get('log')
  log(@Query('status') status?: string, @Query('kind') kind?: string, @Query('page') page?: string) {
    return this.mail.log({ status, kind, page: Number(page) || 1 });
  }

  @Get('log/:id')
  preview(@Param('id', ParseUUIDPipe) id: string) {
    return this.mail.preview(id);
  }

  @Post('log/:id/retry')
  retry(@Param('id', ParseUUIDPipe) id: string) {
    return this.mail.retry(id);
  }
}
