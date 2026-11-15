import { Controller, Post } from '@nestjs/common';
import { RequirePermissions } from '../../core/auth/decorators';
import { PLATFORM_PERMISSIONS } from '../../core/core.manifest';
import { DemoService } from './demo.service';

/** زر "جمعية تجريبية" في شاشة الجمعيات لمدير المنصة */
@Controller('platform/demo-organization')
export class DemoController {
  constructor(private readonly demo: DemoService) {}

  @Post()
  @RequirePermissions(PLATFORM_PERMISSIONS.organizationsManage)
  create() {
    return this.demo.create();
  }
}
