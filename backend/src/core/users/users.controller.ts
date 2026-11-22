import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { CurrentOrgUser, OrgUser, RequirePermissions } from '../auth/decorators';
import { PasswordResetService } from '../auth/password-reset.service';
import { CORE_PERMISSIONS } from '../core.manifest';
import { AssignmentsService } from './assignments.service';
import { CreateAssignmentDto, CreateUserDto, UpdateUserDto } from './users.dto';
import { UsersService } from './users.service';

@Controller('users')
export class UsersController {
  constructor(
    private readonly users: UsersService,
    private readonly resets: PasswordResetService,
    private readonly assignments: AssignmentsService,
  ) {}

  @Get()
  @RequirePermissions(CORE_PERMISSIONS.usersRead)
  list(@CurrentOrgUser() actor: OrgUser) {
    return this.users.list(actor);
  }

  /** طلبات «نسيت كلمة المرور» من موظفي الشركة وسجل كلمات المرور المؤقتة */
  @Get('password-resets')
  @RequirePermissions(CORE_PERMISSIONS.usersManage)
  passwordResets(@CurrentOrgUser() actor: OrgUser) {
    return this.resets.orgOverview(actor);
  }

  /** كلمة مرور مؤقتة لموظف: تظهر مرة واحدة، صالحة 24 ساعة، ويغيّرها عند أول دخول */
  @Post(':id/temp-password')
  @RequirePermissions(CORE_PERMISSIONS.usersManage)
  tempPassword(@CurrentOrgUser() actor: OrgUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.resets.issueByOrg(actor, id);
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

  /** التكليفات: أدوار مؤقتة بتاريخ بداية ونهاية تسقط تلقائيًا */
  @Get('assignments')
  @RequirePermissions(CORE_PERMISSIONS.usersRead)
  listAssignments(@CurrentOrgUser() actor: OrgUser) {
    return this.assignments.list(actor);
  }

  @Post(':id/assignments')
  @RequirePermissions(CORE_PERMISSIONS.usersManage)
  assign(@CurrentOrgUser() actor: OrgUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: CreateAssignmentDto) {
    return this.assignments.create(actor, id, dto);
  }

  @Post('assignments/:aid/end')
  @RequirePermissions(CORE_PERMISSIONS.usersManage)
  endAssignment(@CurrentOrgUser() actor: OrgUser, @Param('aid', ParseUUIDPipe) aid: string) {
    return this.assignments.end(actor, aid);
  }
}
