import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { CurrentOrgUser, OrgUser, RequirePermissions } from '../auth/decorators';
import { CORE_PERMISSIONS } from '../core.manifest';
import { CreateUserDto, UpdateUserDto } from './users.dto';
import { UsersService } from './users.service';

@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  @RequirePermissions(CORE_PERMISSIONS.usersRead)
  list(@CurrentOrgUser() actor: OrgUser) {
    return this.users.list(actor);
  }

  @Post()
  @RequirePermissions(CORE_PERMISSIONS.usersManage)
  create(@CurrentOrgUser() actor: OrgUser, @Body() dto: CreateUserDto) {
    return this.users.create(actor, dto);
  }

  @Patch(':id')
  @RequirePermissions(CORE_PERMISSIONS.usersManage)
  update(@CurrentOrgUser() actor: OrgUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateUserDto) {
    return this.users.update(actor, id, dto);
  }
}
