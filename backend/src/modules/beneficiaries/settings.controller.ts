import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put } from '@nestjs/common';
import { CurrentOrgUser, OrgUser, RequirePermissions } from '../../core/auth/decorators';
import { BENEFICIARY_PERMISSIONS as P } from './beneficiaries.manifest';
import { AccountingDto, ActivityDto, CreateFormDto, FormDto, ReturnFormDto, UpdateActivityDto, WorkflowDto } from './settings.dto';
import { SettingsService } from './settings.service';

const uuid = new ParseUUIDPipe();

/** إعدادات وحدة المستفيدين. القراءة متاحة لمن يعرض الطلبات (لعرض الأنشطة في الفلاتر والنماذج) */
@Controller('beneficiaries/settings')
export class SettingsController {
  constructor(private readonly settings: SettingsService) {}

  @Get('activities')
  @RequirePermissions(P.requestsRead)
  activities(@CurrentOrgUser() actor: OrgUser) {
    return this.settings.listActivities(actor);
  }

  @Post('activities')
  @RequirePermissions(P.settings)
  createActivity(@CurrentOrgUser() actor: OrgUser, @Body() dto: ActivityDto) {
    return this.settings.createActivity(actor, dto);
  }

  @Patch('activities/:id')
  @RequirePermissions(P.settings)
  updateActivity(@CurrentOrgUser() actor: OrgUser, @Param('id', uuid) id: string, @Body() dto: UpdateActivityDto) {
    return this.settings.updateActivity(actor, id, dto);
  }

  @Delete('activities/:id')
  @HttpCode(204)
  @RequirePermissions(P.settings)
  removeActivity(@CurrentOrgUser() actor: OrgUser, @Param('id', uuid) id: string) {
    return this.settings.removeActivity(actor, id);
  }

  @Get('forms')
  @RequirePermissions(P.settings)
  forms(@CurrentOrgUser() actor: OrgUser) {
    return this.settings.listForms(actor);
  }

  @Post('forms')
  @RequirePermissions(P.settings)
  createForm(@CurrentOrgUser() actor: OrgUser, @Body() dto: CreateFormDto) {
    return this.settings.createForm(actor, dto);
  }

  @Post('forms/:id/submit')
  @HttpCode(200)
  @RequirePermissions(P.settings)
  submitForm(@CurrentOrgUser() actor: OrgUser, @Param('id', uuid) id: string) {
    return this.settings.submitForm(actor, id);
  }

  @Post('forms/:id/review')
  @HttpCode(200)
  @RequirePermissions(P.formsReview)
  reviewForm(@CurrentOrgUser() actor: OrgUser, @Param('id', uuid) id: string) {
    return this.settings.reviewForm(actor, id);
  }

  /** الصلاحية بتتحدد حسب مرحلة النموذج (مراجع الجودة أو مدير الشاشة) */
  @Post('forms/:id/return')
  @HttpCode(200)
  returnForm(@CurrentOrgUser() actor: OrgUser, @Param('id', uuid) id: string, @Body() dto: ReturnFormDto) {
    return this.settings.returnForm(actor, id, dto);
  }

  @Post('forms/:id/approve')
  @HttpCode(200)
  @RequirePermissions(P.formsApprove)
  approveForm(@CurrentOrgUser() actor: OrgUser, @Param('id', uuid) id: string) {
    return this.settings.approveForm(actor, id);
  }

  @Put('forms/:id')
  @RequirePermissions(P.settings)
  updateForm(@CurrentOrgUser() actor: OrgUser, @Param('id', uuid) id: string, @Body() dto: FormDto) {
    return this.settings.updateForm(actor, id, dto);
  }

  @Delete('forms/:id')
  @HttpCode(204)
  @RequirePermissions(P.settings)
  removeForm(@CurrentOrgUser() actor: OrgUser, @Param('id', uuid) id: string) {
    return this.settings.removeForm(actor, id);
  }

  @Get('workflows')
  @RequirePermissions(P.requestsRead)
  workflows(@CurrentOrgUser() actor: OrgUser) {
    return this.settings.listWorkflows(actor);
  }

  @Post('workflows')
  @RequirePermissions(P.settings)
  createWorkflow(@CurrentOrgUser() actor: OrgUser, @Body() dto: WorkflowDto) {
    return this.settings.createWorkflow(actor, dto);
  }

  @Put('workflows/:id')
  @RequirePermissions(P.settings)
  updateWorkflow(@CurrentOrgUser() actor: OrgUser, @Param('id', uuid) id: string, @Body() dto: WorkflowDto) {
    return this.settings.updateWorkflow(actor, id, dto);
  }

  @Delete('workflows/:id')
  @HttpCode(204)
  @RequirePermissions(P.settings)
  removeWorkflow(@CurrentOrgUser() actor: OrgUser, @Param('id', uuid) id: string) {
    return this.settings.removeWorkflow(actor, id);
  }

  @Get('roles')
  @RequirePermissions(P.settings)
  roles(@CurrentOrgUser() actor: OrgUser) {
    return this.settings.roles(actor);
  }

  @Get('accounting')
  @RequirePermissions(P.settings)
  accounting(@CurrentOrgUser() actor: OrgUser) {
    return this.settings.accounting(actor.organizationId);
  }

  @Put('accounting')
  @RequirePermissions(P.settings)
  saveAccounting(@CurrentOrgUser() actor: OrgUser, @Body() dto: AccountingDto) {
    return this.settings.saveAccounting(actor, dto);
  }
}
