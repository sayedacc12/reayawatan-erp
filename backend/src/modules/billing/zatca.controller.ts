import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Put, Res } from '@nestjs/common';
import type { Response } from 'express';
import { CurrentOrgUser, OrgUser, RequireAnyPermission, RequirePermissions } from '../../core/auth/decorators';
import { ReasonDto, ZatcaEnvDto, ZatcaOnboardDto } from './billing.dto';
import { BILLING_PERMISSIONS as P } from './billing.manifest';
import { ZatcaService } from './zatca.service';

const uuid = new ParseUUIDPipe();

/** الربط مع منصة «فاتورة»: حالة الربط وخطواته (لمن يملك إعدادات الفوترة)، وتنزيل الملف الإلكتروني الموقّع */
@Controller('billing')
export class ZatcaController {
  constructor(private readonly zatca: ZatcaService) {}

  @Get('zatca') @RequirePermissions(P.settings)
  status(@CurrentOrgUser() a: OrgUser) {
    return this.zatca.status(a);
  }

  @Put('zatca/env') @RequirePermissions(P.settings)
  setEnv(@CurrentOrgUser() a: OrgUser, @Body() dto: ZatcaEnvDto) {
    return this.zatca.setEnv(a, dto.env);
  }

  @Post('zatca/onboard') @HttpCode(200) @RequirePermissions(P.settings)
  onboard(@CurrentOrgUser() a: OrgUser, @Body() dto: ZatcaOnboardDto) {
    return this.zatca.onboard(a, dto.otp);
  }

  @Post('zatca/reset') @HttpCode(200) @RequirePermissions(P.settings)
  reset(@CurrentOrgUser() a: OrgUser, @Body() dto: ReasonDto) {
    return this.zatca.reset(a, dto.reason);
  }

  @Get('documents/:id/xml') @RequireAnyPermission(P.read, P.invoices, P.issue, P.reports)
  async xml(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string, @Res() res: Response) {
    const f = await this.zatca.xml(a.organizationId, id);
    res.setHeader('Content-Type', 'application/xml; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(f.name)}`);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.send(f.xml);
  }
}
