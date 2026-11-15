import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put } from '@nestjs/common';
import { CurrentOrgUser, OrgUser, RequireAnyPermission, RequirePermissions } from '../../core/auth/decorators';
import { CreateNodeDto, DecisionDto, ProjectFieldsDto, ReopenDto, StagesDto } from './projects.dto';
import { PROJECT_PERMISSIONS as P } from './projects.manifest';
import { ProjectsService } from './projects.service';
import { InsightsService } from './insights.service';

const uuid = new ParseUUIDPipe();

/** الشجرة ومراحل الاعتماد وصفحة المشروع */
@Controller('projects')
export class ProjectsController {
  constructor(private readonly projects: ProjectsService, private readonly insights: InsightsService) {}

  @Get('tree')
  @RequirePermissions(P.read)
  tree(@CurrentOrgUser() actor: OrgUser) {
    return this.projects.tree(actor);
  }

  @Post('nodes')
  @RequirePermissions(P.manage)
  create(@CurrentOrgUser() actor: OrgUser, @Body() dto: CreateNodeDto) {
    return this.projects.createNode(actor, dto);
  }

  @Patch('nodes/:id')
  @RequirePermissions(P.manage)
  update(@CurrentOrgUser() actor: OrgUser, @Param('id', uuid) id: string, @Body() dto: ProjectFieldsDto) {
    return this.projects.updateNode(actor, id, dto);
  }

  @Delete('nodes/:id')
  @HttpCode(204)
  @RequirePermissions(P.manage)
  async remove(@CurrentOrgUser() actor: OrgUser, @Param('id', uuid) id: string) {
    await this.insights.ensureNoSupport(actor, id);
    return this.projects.removeNode(actor, id);
  }

  @Get('stages')
  @RequireAnyPermission(P.settings, P.approve, P.manage)
  stages(@CurrentOrgUser() actor: OrgUser) {
    return this.projects.listStages(actor);
  }

  @Put('stages')
  @RequirePermissions(P.settings)
  saveStages(@CurrentOrgUser() actor: OrgUser, @Body() dto: StagesDto) {
    return this.projects.saveStages(actor, dto);
  }

  @Get('approvals/inbox')
  @RequirePermissions(P.approve)
  inbox(@CurrentOrgUser() actor: OrgUser) {
    return this.projects.inbox(actor);
  }

  @Get('dashboard')
  @RequirePermissions(P.read)
  dashboard(@CurrentOrgUser() actor: OrgUser) {
    return this.insights.dashboard(actor);
  }

  @Get('list')
  @RequirePermissions(P.read)
  list(@CurrentOrgUser() actor: OrgUser) {
    return this.insights.overview(actor);
  }

  @Get(':id')
  @RequirePermissions(P.read)
  page(@CurrentOrgUser() actor: OrgUser, @Param('id', uuid) id: string) {
    return this.insights.projectPage(actor, id);
  }

  @Post(':id/submit')
  @HttpCode(200)
  @RequirePermissions(P.manage)
  submit(@CurrentOrgUser() actor: OrgUser, @Param('id', uuid) id: string) {
    return this.projects.submit(actor, id);
  }

  @Post(':id/decision')
  @HttpCode(200)
  @RequirePermissions(P.approve)
  decide(@CurrentOrgUser() actor: OrgUser, @Param('id', uuid) id: string, @Body() dto: DecisionDto) {
    return this.projects.decide(actor, id, dto);
  }

  @Post(':id/reopen')
  @HttpCode(200)
  @RequirePermissions(P.manage)
  reopen(@CurrentOrgUser() actor: OrgUser, @Param('id', uuid) id: string, @Body() dto: ReopenDto) {
    return this.projects.reopen(actor, id, dto.note, (em) => this.insights.hasActiveSupport(actor.organizationId, id, em));
  }
}
