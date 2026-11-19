import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Put, Res } from '@nestjs/common';
import { IsDateString, IsInt, IsOptional, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';
import { Response } from 'express';
import { AuthUser, CurrentOrgUser, CurrentUser, OrgUser, RequirePermissions } from '../auth/decorators';
import { PLATFORM_PERMISSIONS } from '../core.manifest';
import { LifecycleService } from './lifecycle.service';

export class TerminateDto {
  @IsDateString({}, { message: 'تاريخ الاتفاق غير صحيح' })
  agreementDate!: string;

  @IsString() @MinLength(2, { message: 'اكتب اسم ممثل الجمعية في الاتفاق' }) @MaxLength(200)
  charityRep!: string;

  @IsOptional() @IsString() @MaxLength(2000)
  note?: string;

  @IsInt({ message: 'مهلة الحذف بالأيام' }) @Min(0) @Max(365)
  graceDays!: number;

  @IsString() @MaxLength(64)
  confirm!: string;
}

export class ConfirmDto {
  @IsString() @MaxLength(64)
  confirm!: string;
}

export class LifecycleSettingsDto {
  @IsInt({ message: 'مهلة الحذف بالأيام' }) @Min(0) @Max(365)
  trialGraceDays!: number;
}

/** تنبيه موعد الحذف لكل مستخدمي الجمعية (شريط أعلى النظام) */
@Controller('organization/lifecycle')
export class OrgLifecycleController {
  constructor(private readonly lifecycle: LifecycleService) {}

  @Get()
  notice(@CurrentOrgUser() user: OrgUser) {
    return this.lifecycle.notice(user.organizationId).then((n) => n ?? {});
  }
}

/** مدير المنصة: متابعة مواعيد الحذف، وإنهاء العقد بالتراضي، والتصدير، والحذف */
@Controller('platform')
@RequirePermissions(PLATFORM_PERMISSIONS.organizationsManage)
export class PlatformLifecycleController {
  constructor(private readonly lifecycle: LifecycleService) {}

  @Get('lifecycle')
  overview() {
    return this.lifecycle.overview();
  }

  @Put('lifecycle/settings')
  saveSettings(@Body() dto: LifecycleSettingsDto) {
    return this.lifecycle.saveSettings(dto);
  }

  @Get('organizations/:id/lifecycle')
  status(@Param('id', ParseUUIDPipe) id: string) {
    return this.lifecycle.status(id);
  }

  @Post('organizations/:id/terminate')
  terminate(@Param('id', ParseUUIDPipe) id: string, @Body() dto: TerminateDto, @CurrentUser() user: AuthUser) {
    return this.lifecycle.terminate(id, dto, user);
  }

  @Post('organizations/:id/terminate/cancel')
  cancel(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
    return this.lifecycle.cancel(id, user);
  }

  @Post('organizations/:id/delete')
  deleteNow(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ConfirmDto, @CurrentUser() user: AuthUser) {
    return this.lifecycle.deleteNow(id, dto.confirm, user);
  }

  @Get('organizations/:id/export')
  async export(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser, @Res() res: Response) {
    const { org, json } = await this.lifecycle.export(id, user);
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${org.slug}-export-${new Date().toISOString().slice(0, 10)}.json"`);
    res.send(json);
  }
}
