import { Controller, Delete, HttpCode, Post, Req } from '@nestjs/common';
import { Request } from 'express';
import { AuthUser, CurrentUser, RequirePermissions } from '../../core/auth/decorators';
import { PLATFORM_PERMISSIONS } from '../../core/core.manifest';
import { originOf } from '../../core/subscriptions/subscriptions.controller';
import { DemoService } from './demo.service';

/** زر "جمعية تجريبية" في شاشة الجمعيات لمدير المنصة */
@Controller('platform/demo-organization')
export class DemoController {
  constructor(private readonly demo: DemoService) {}

  @Post()
  @RequirePermissions(PLATFORM_PERMISSIONS.organizationsManage)
  create(@CurrentUser() user: AuthUser, @Req() req: Request) {
    return this.demo.create(user, originOf(req));
  }

  /** حذف الجمعية التجريبية تمهيدًا لإعادة إنشائها */
  @Delete()
  @HttpCode(204)
  @RequirePermissions(PLATFORM_PERMISSIONS.organizationsManage)
  async reset() {
    await this.demo.reset();
  }
}
