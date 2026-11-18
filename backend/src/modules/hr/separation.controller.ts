import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import { CurrentOrgUser, OrgUser, RequireAnyPermission, RequirePermissions } from '../../core/auth/decorators';
import { SeparationConfig } from './entities/hr.entity';
import { HR_PERMISSIONS as P } from './hr.manifest';
import { SeparationInput, SeparationService } from './separation.service';

const uuid = new ParseUUIDPipe();

/**
 * إخلاء الطرف ونهاية الخدمة. صفحة الملف وإخلاء البنود متاحة لمسؤولي البنود (مثل المدير المباشر) بلا صلاحية إضافية،
 * والخدمة تتحقق أن المستخدم مسؤول عن البند أو من شؤون الموظفين أو الموظف نفسه.
 */
@Controller('hr')
export class SeparationController {
  constructor(private readonly sep: SeparationService) {}

  @Get('separations')
  @RequireAnyPermission(P.separations, P.approveSeparations, P.payPayroll)
  list(@CurrentOrgUser() a: OrgUser, @Query('status') status?: string) {
    return this.sep.list(a, status);
  }

  @Post('separations')
  @RequirePermissions(P.separations)
  create(@CurrentOrgUser() a: OrgUser, @Body() body: SeparationInput) {
    return this.sep.create(a, body);
  }

  @Get('separation-config')
  @RequireAnyPermission(P.settings, P.separations)
  config(@CurrentOrgUser() a: OrgUser) {
    return this.sep.getConfig(a);
  }

  @Put('separation-config')
  @RequirePermissions(P.settings)
  saveConfig(@CurrentOrgUser() a: OrgUser, @Body() body: Partial<SeparationConfig>) {
    return this.sep.saveConfig(a, body);
  }

  @Get('me/clearance')
  clearance(@CurrentOrgUser() a: OrgUser) {
    return this.sep.awaitingItems(a);
  }

  @Get('separations/:id')
  get(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string) {
    return this.sep.get(a, id);
  }

  @Post('separations/:id/items/:code')
  @HttpCode(200)
  clear(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string, @Param('code') code: string, @Body() body: { decision?: string; deduction?: unknown; note?: unknown }) {
    return this.sep.clearItem(a, id, code, body ?? {});
  }

  @Post('separations/:id/settle')
  @HttpCode(200)
  @RequirePermissions(P.separations)
  settle(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string, @Body() body: { adjustments?: unknown; note?: unknown }) {
    return this.sep.settle(a, id, body ?? {});
  }

  @Post('separations/:id/decision')
  @HttpCode(200)
  @RequirePermissions(P.approveSeparations)
  decide(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string, @Body() body: { decision?: string; note?: unknown }) {
    return this.sep.decide(a, id, body ?? {});
  }

  @Post('separations/:id/pay')
  @HttpCode(200)
  @RequirePermissions(P.payPayroll)
  pay(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string, @Body() body: { voucherDate?: string; cashAccountId?: string | null }) {
    return this.sep.pay(a, id, body ?? {});
  }

  @Post('separations/:id/cancel')
  @HttpCode(200)
  @RequirePermissions(P.separations)
  cancel(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string, @Body() body: { note?: unknown }) {
    return this.sep.cancel(a, id, body?.note);
  }
}
