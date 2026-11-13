import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { CurrentOrgUser, OrgUser, RequirePermissions } from '../auth/decorators';
import { CORE_PERMISSIONS } from '../core.manifest';
import { CreateRoleDto, UpdateRoleDto } from './roles.dto';
import { RolesService } from './roles.service';

@Controller('roles')
export class RolesController {
  constructor(private readonly roles: RolesService) {}

  @Get()
  @RequirePermissions(CORE_PERMISSIONS.rolesRead)
  list(@CurrentOrgUser() actor: OrgUser) {
    return this.roles.list(actor);
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
