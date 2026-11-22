import { Controller, Get, Param, Post } from '@nestjs/common';
import { AuthenticatedOnly, CurrentOrgUser, OrgUser } from '../../core/auth/decorators';
import { StarterService } from './starter.service';

const REASON = 'الإعدادات الافتراضية لكل نظام: الخدمة تتحقق أن النظام مفعّل للشركة وأن المستخدم مدير النظام أو يملك صلاحية إعدادات ذلك النظام (settingsPermission في manifest)';

/** زر «الإعدادات الافتراضية» في شاشة إعدادات كل نظام */
@Controller('starter')
export class StarterController {
  constructor(private readonly starter: StarterService) {}

  @Get(':module')
  @AuthenticatedOnly(REASON)
  status(@CurrentOrgUser() user: OrgUser, @Param('module') module: string) {
    return this.starter.status(user, module);
  }

  @Post(':module')
  @AuthenticatedOnly(REASON)
  apply(@CurrentOrgUser() user: OrgUser, @Param('module') module: string) {
    return this.starter.apply(user, module);
  }
}
