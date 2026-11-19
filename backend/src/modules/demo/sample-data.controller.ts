import { Body, Controller, ForbiddenException, Get, Param, ParseUUIDPipe, Post, Req } from '@nestjs/common';
import { IsString, MaxLength } from 'class-validator';
import { Request } from 'express';
import { AuthUser, CurrentOrgUser, CurrentUser, OrgUser, RequirePermissions } from '../../core/auth/decorators';
import { PLATFORM_PERMISSIONS } from '../../core/core.manifest';
import { originOf } from '../../core/subscriptions/subscriptions.controller';
import { SampleDataService } from './sample-data.service';

export class ClearSampleDataDto {
  /** معرّف الجمعية (slug) يكتبه مدير المنصة للتأكيد */
  @IsString()
  @MaxLength(64)
  confirm!: string;
}

const superadminOnly = (u: OrgUser) => {
  if (!u.isSuperadmin) throw new ForbiddenException('هذا الإجراء لمدير نظام الجمعية فقط');
};

/** زر «إضافة بيانات تجريبية» لمدير نظام الجمعية في فترة التجربة */
@Controller('sample-data')
export class SampleDataController {
  constructor(private readonly samples: SampleDataService) {}

  @Get()
  status(@CurrentOrgUser() user: OrgUser) {
    superadminOnly(user);
    return this.samples.status(user.organizationId);
  }

  @Post()
  load(@CurrentOrgUser() user: OrgUser, @Req() req: Request) {
    superadminOnly(user);
    return this.samples.load(user.organizationId, user, originOf(req));
  }
}

/** البيانات التجريبية من ملف الجمعية لدى مدير المنصة: الإضافة، ومعاينة التحويل، والتحويل إلى جمعية فعلية */
@Controller('platform/organizations/:id/sample-data')
@RequirePermissions(PLATFORM_PERMISSIONS.organizationsManage)
export class PlatformSampleDataController {
  constructor(private readonly samples: SampleDataService) {}

  @Get()
  status(@Param('id', ParseUUIDPipe) id: string) {
    return this.samples.status(id);
  }

  @Post()
  load(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser, @Req() req: Request) {
    return this.samples.load(id, user, originOf(req));
  }

  @Get('preview')
  preview(@Param('id', ParseUUIDPipe) id: string) {
    return this.samples.preview(id);
  }

  @Post('clear')
  clear(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ClearSampleDataDto, @CurrentUser() user: AuthUser) {
    return this.samples.clear(id, dto.confirm, user);
  }
}
