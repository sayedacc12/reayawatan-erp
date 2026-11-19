import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Put, Req } from '@nestjs/common';
import type { Request } from 'express';
import { AuthUser, CurrentUser, RequirePermissions } from '../auth/decorators';
import { originOf } from '../subscriptions/subscriptions.controller';
import { ResetPasswordDto } from '../subscriptions/subscriptions.dto';
import { PLATFORM_PERMISSIONS } from '../core.manifest';
import { CreateOrganizationDto, SetOrganizationModulesDto, UpdateOrganizationDto } from './organizations.dto';
import { OrganizationsService } from './organizations.service';

@Controller('platform')
@RequirePermissions(PLATFORM_PERMISSIONS.organizationsManage)
export class OrganizationsController {
  constructor(private readonly orgs: OrganizationsService) {}

  @Get('modules')
  optionalModules() {
    return this.orgs.optionalModules();
  }

  @Get('organizations')
  list() {
    return this.orgs.list();
  }

  @Post('organizations')
  create(@Body() dto: CreateOrganizationDto) {
    return this.orgs.create(dto);
  }

  @Patch('organizations/:id')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateOrganizationDto) {
    return this.orgs.update(id, dto);
  }

  @Get('organizations/:id/admins')
  admins(@Param('id', ParseUUIDPipe) id: string) {
    return this.orgs.admins(id);
  }

  @Post('organizations/:id/admins/:userId/reset-password')
  resetAdminPassword(
    @Param('id', ParseUUIDPipe) id: string, @Param('userId', ParseUUIDPipe) userId: string,
    @Body() dto: ResetPasswordDto, @CurrentUser() actor: AuthUser, @Req() req: Request,
  ) {
    return this.orgs.resetAdminPassword(id, userId, { sendEmail: dto?.sendEmail, actor: actor.fullName, origin: originOf(req) });
  }

  /** تفعيل/إيقاف الوحدات الاختيارية لجمعية */
  @Put('organizations/:id/modules')
  setModules(@Param('id', ParseUUIDPipe) id: string, @Body() dto: SetOrganizationModulesDto) {
    return this.orgs.setModules(id, dto.modules);
  }
}
