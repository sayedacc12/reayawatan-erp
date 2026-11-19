import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Put, Query } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { AuthUser, CurrentUser, Public, RequirePermissions } from '../auth/decorators';
import { PLATFORM_PERMISSIONS } from '../core.manifest';
import { InquiryDto, InquiryUpdateDto, SiteContactDto } from './site.dto';
import { SITE_SERVICES } from './site.entity';
import { SiteService } from './site.service';

/** الصفحة التعريفية العامة: بيانات التواصل واستقبال الطلبات بدون تسجيل دخول */
@Controller('public/site')
@Public()
export class PublicSiteController {
  constructor(private readonly site: SiteService) {}

  @Get('contact')
  async contact() {
    return { ...(await this.site.contact()), services: SITE_SERVICES };
  }

  @Post('inquiries')
  @Throttle({ default: { limit: 5, ttl: 600_000 } })
  submit(@Body() dto: InquiryDto) {
    return this.site.submit(dto);
  }
}

/** طلبات الخدمات وإعدادات التواصل، ضمن صلاحيات مدير المنصة */
@Controller('platform/site')
@RequirePermissions(PLATFORM_PERMISSIONS.siteManage)
export class PlatformSiteController {
  constructor(private readonly site: SiteService) {}

  @Get('inquiries')
  list(@Query('status') status?: string) {
    return this.site.list(status);
  }

  @Patch('inquiries/:id')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: InquiryUpdateDto, @CurrentUser() user: AuthUser) {
    return this.site.update(id, dto, user);
  }

  @Get('contact')
  contact() {
    return this.site.contact();
  }

  @Put('contact')
  saveContact(@Body() dto: SiteContactDto) {
    return this.site.saveContact(dto);
  }
}
