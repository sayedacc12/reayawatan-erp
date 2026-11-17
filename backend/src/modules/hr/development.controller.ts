import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import { CurrentOrgUser, OrgUser, RequirePermissions } from '../../core/auth/decorators';
import { DevelopmentService } from './development.service';
import { CandidateDto, DevConfigDto, DevPlanCreateDto, DevPlanDto, DevProgressDto, RunDecisionDto, RunNoteDto, SuccessionJobDto } from './hr.dto';
import { HR_PERMISSIONS as P } from './hr.manifest';

const uuid = new ParseUUIDPipe();

/** التطوير والتدريب (فجوة الجدارات وخطط التطوير) والصف الثاني */
@Controller('hr')
export class DevelopmentController {
  constructor(private readonly dev: DevelopmentService) {}

  @Get('development/config')
  @RequirePermissions(P.read)
  config(@CurrentOrgUser() actor: OrgUser) {
    return this.dev.getConfig(actor);
  }

  @Put('development/config')
  @RequirePermissions(P.settings)
  saveConfig(@CurrentOrgUser() actor: OrgUser, @Body() dto: DevConfigDto) {
    return this.dev.saveConfig(actor, dto);
  }

  @Get('development/gaps')
  @RequirePermissions(P.read)
  gaps(@CurrentOrgUser() actor: OrgUser) {
    return this.dev.gaps(actor);
  }

  @Get('dev-plans')
  @RequirePermissions(P.read)
  list(@CurrentOrgUser() actor: OrgUser, @Query('year') year?: string) {
    return this.dev.list(actor, year ? Number(year) : undefined);
  }

  @Post('dev-plans')
  @RequirePermissions(P.development)
  create(@CurrentOrgUser() actor: OrgUser, @Body() dto: DevPlanCreateDto) {
    return this.dev.create(actor, dto);
  }

  @Get('dev-plans/:id')
  @RequirePermissions(P.read)
  get(@CurrentOrgUser() actor: OrgUser, @Param('id', uuid) id: string) {
    return this.dev.get(actor, id);
  }

  @Put('dev-plans/:id')
  @RequirePermissions(P.development)
  update(@CurrentOrgUser() actor: OrgUser, @Param('id', uuid) id: string, @Body() dto: DevPlanDto) {
    return this.dev.update(actor, id, dto);
  }

  @Post('dev-plans/:id/submit')
  @RequirePermissions(P.development)
  submit(@CurrentOrgUser() actor: OrgUser, @Param('id', uuid) id: string) {
    return this.dev.submit(actor, id);
  }

  @Post('dev-plans/:id/decision')
  @RequirePermissions(P.approveDevelopment)
  decide(@CurrentOrgUser() actor: OrgUser, @Param('id', uuid) id: string, @Body() dto: RunDecisionDto) {
    return this.dev.decide(actor, id, dto);
  }

  @Post('dev-plans/:id/progress')
  @RequirePermissions(P.development)
  progress(@CurrentOrgUser() actor: OrgUser, @Param('id', uuid) id: string, @Body() dto: DevProgressDto) {
    return this.dev.progress(actor, id, dto);
  }

  @Post('dev-plans/:id/complete')
  @RequirePermissions(P.development)
  complete(@CurrentOrgUser() actor: OrgUser, @Param('id', uuid) id: string, @Body() dto: RunNoteDto) {
    return this.dev.complete(actor, id, dto.note);
  }

  @Post('dev-plans/:id/cancel')
  @RequirePermissions(P.development)
  cancel(@CurrentOrgUser() actor: OrgUser, @Param('id', uuid) id: string, @Body() dto: RunNoteDto) {
    return this.dev.cancel(actor, id, dto.note);
  }

  @Get('succession')
  @RequirePermissions(P.read)
  succession(@CurrentOrgUser() actor: OrgUser) {
    return this.dev.succession(actor);
  }

  @Put('succession/jobs/:jobId')
  @RequirePermissions(P.development)
  setBackup(@CurrentOrgUser() actor: OrgUser, @Param('jobId', uuid) jobId: string, @Body() dto: SuccessionJobDto) {
    return this.dev.setBackup(actor, jobId, dto);
  }

  @Post('succession/jobs/:jobId/candidates')
  @RequirePermissions(P.development)
  addCandidate(@CurrentOrgUser() actor: OrgUser, @Param('jobId', uuid) jobId: string, @Body() dto: CandidateDto) {
    return this.dev.addCandidate(actor, jobId, dto);
  }

  @Delete('succession/candidates/:id')
  @RequirePermissions(P.development)
  removeCandidate(@CurrentOrgUser() actor: OrgUser, @Param('id', uuid) id: string) {
    return this.dev.removeCandidate(actor, id);
  }
}
