import { Controller, Get } from '@nestjs/common';
import { RequirePermissions } from '../auth/decorators';
import { PLATFORM_PERMISSIONS } from '../core.manifest';
import { BackupsService } from './backups.service';

/** شاشة «النسخ الاحتياطي» لمدير المنصة: حالة كل وجهة وآخر نسخة وتجربة استرجاع وسجل التشغيل */
@Controller('platform/backups')
@RequirePermissions(PLATFORM_PERMISSIONS.reportsRead)
export class BackupsController {
  constructor(private readonly backups: BackupsService) {}

  @Get()
  overview() {
    return this.backups.overview();
  }
}
