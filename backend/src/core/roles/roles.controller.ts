import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put } from '@nestjs/common';
import { CurrentOrgUser, OrgUser, RequirePermissions } from '../auth/decorators';
import { CORE_PERMISSIONS } from '../core.manifest';
import { CreateRoleDto, ModulePermissionsDto, UpdateRoleDto } from './roles.dto';
import { RolesService } from './roles.service';

@Controller('roles')
export class RolesController {
  constructor(private readonly roles: RolesService) {}

  @Get()
  @RequirePermissions(CORE_PERMISSIONS.rolesRead)
  list(@CurrentOrgUser() actor: OrgUser) {
    return this.roles.list(actor);
  }

  /**
   * صلاحيات وحدة واحدة على كل الأدوار، لتبويب "الصلاحيات" داخل إعدادات الوحدة.
   * متاح لمن يملك إعدادات الوحدة أو صلاحيات الأدوار العامة (الفحص داخل الخدمة).
   */
  @Get('module/:code')
  moduleRoles(@CurrentOrgUser() actor: OrgUser, @Param('code') code: string) {
    return this.roles.moduleRoles(actor, code);
  }

  @Post('module/:code')
  createForModule(@CurrentOrgUser() actor: OrgUser, @Param('code') code: string, @Body() dto: CreateRoleDto) {
    return this.roles.createForModule(actor, code, dto);
  }

  @Put(':id/module/:code')
  setModulePermissions(
    @CurrentOrgUser() actor: OrgUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('code') code: string,
    @Body() dto: ModulePermissionsDto,
  ) {
    return this.roles.setModulePermissions(actor, id, code, dto.permissions);
  }

  @Post()
  @RequirePermissions(CORE_PERMISSIONS.rolesManage)
  create(@CurrentOrgUser() actor: OrgUser, @Body() dto: CreateRoleDto) {
    return this.roles.create(actor, dto);
  }

  @Patch(':id')
  @RequirePermissions(CORE_PERMISSIONS.rolesManage)
  update(@CurrentOrgUser() actor: OrgUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateRoleDto) {
    return this.roles.update(actor, id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermissions(CORE_PERMISSIONS.rolesManage)
  async remove(@CurrentOrgUser() actor: OrgUser, @Param('id', ParseUUIDPipe) id: string) {
    await this.roles.remove(actor, id);
  }
}
