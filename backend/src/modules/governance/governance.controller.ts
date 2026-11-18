import { BadRequestException, Body, Controller, Delete, Get, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import { CurrentOrgUser, OrgUser, RequireAnyPermission, RequirePermissions } from '../../core/auth/decorators';
import {
  AckDto, ActionDto, AnswerDto, AssessmentDto, AssessmentUpdateDto, FiguresDto, GapActionsDto, GenerateCalendarDto, ObligationDto, SettingsDto,
} from './governance.dto';
import { GOV_PERMISSIONS as P } from './governance.manifest';
import { GovernanceService } from './governance.service';

const uuid = new ParseUUIDPipe();
const ITEM = /^[A-Z]{3}-P\d{2}-\d{1,2}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** الحوكمة: التقييم الذاتي التنبؤي، السلامة المالية، الإنذار المبكر، خطة التحسين، تقويم الالتزامات */
@Controller('governance')
export class GovernanceController {
  constructor(private readonly gov: GovernanceService) {}

  @Get('dashboard') @RequirePermissions(P.read)
  dashboard(@CurrentOrgUser() a: OrgUser) { return this.gov.dashboard(a); }

  @Get('catalog') @RequirePermissions(P.read)
  catalog() { return this.gov.catalog(); }

  @Get('finance') @RequirePermissions(P.read)
  finance(@CurrentOrgUser() a: OrgUser, @Query('to') to?: string) {
    if (to && !DATE.test(to)) throw new BadRequestException('التاريخ غير صحيح');
    return this.gov.financeView(a, to);
  }

  // ---------------- الإعدادات ----------------

  @Get('settings') @RequireAnyPermission(P.read, P.settings)
  settings(@CurrentOrgUser() a: OrgUser) { return this.gov.getSettings(a); }

  @Put('settings') @RequirePermissions(P.settings)
  saveSettings(@CurrentOrgUser() a: OrgUser, @Body() dto: SettingsDto) { return this.gov.saveSettings(a, dto); }

  // ---------------- الإنذار المبكر ----------------

  @Get('alerts') @RequirePermissions(P.read)
  alerts(@CurrentOrgUser() a: OrgUser, @Query('all') all?: string) { return this.gov.alerts(a, all === '1'); }

  @Post('alerts/:key/ack') @RequireAnyPermission(P.assess, P.actions, P.settings)
  ack(@CurrentOrgUser() a: OrgUser, @Param('key') key: string, @Body() dto: AckDto) { return this.gov.ack(a, key, dto); }

  @Delete('alerts/:key/ack') @RequireAnyPermission(P.assess, P.actions, P.settings)
  unack(@CurrentOrgUser() a: OrgUser, @Param('key') key: string) { return this.gov.unack(a, key); }

  // ---------------- التقييمات ----------------

  @Get('assessments') @RequirePermissions(P.read)
  assessments(@CurrentOrgUser() a: OrgUser) { return this.gov.assessments(a); }

  @Post('assessments') @RequirePermissions(P.assess)
  create(@CurrentOrgUser() a: OrgUser, @Body() dto: AssessmentDto) { return this.gov.createAssessment(a, dto); }

  @Get('assessments/:id') @RequirePermissions(P.read)
  assessment(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string) { return this.gov.assessment(a, id); }

  @Put('assessments/:id') @RequirePermissions(P.assess)
  update(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string, @Body() dto: AssessmentUpdateDto) { return this.gov.updateAssessment(a, id, dto); }

  @Delete('assessments/:id') @RequirePermissions(P.assess)
  remove(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string) { return this.gov.removeAssessment(a, id); }

  @Put('assessments/:id/answers/:item') @RequirePermissions(P.assess)
  answer(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string, @Param('item') item: string, @Body() dto: AnswerDto) {
    if (!ITEM.test(item)) throw new BadRequestException('رمز البند غير صحيح');
    return this.gov.answer(a, id, item, dto);
  }

  @Delete('assessments/:id/answers/:item') @RequirePermissions(P.assess)
  clear(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string, @Param('item') item: string) {
    if (!ITEM.test(item)) throw new BadRequestException('رمز البند غير صحيح');
    return this.gov.clearAnswer(a, id, item);
  }

  @Post('assessments/:id/apply-suggestions') @RequirePermissions(P.assess)
  apply(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string) { return this.gov.applySuggestions(a, id); }

  @Post('assessments/:id/refresh-figures') @RequirePermissions(P.assess)
  refresh(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string) { return this.gov.refreshFigures(a, id); }

  @Put('assessments/:id/figures') @RequirePermissions(P.assess)
  figures(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string, @Body() dto: FiguresDto) { return this.gov.setFigures(a, id, dto); }

  @Post('assessments/:id/submit') @RequirePermissions(P.assess)
  submit(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string) { return this.gov.submit(a, id); }

  @Post('assessments/:id/approve') @RequirePermissions(P.approve)
  approve(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string) { return this.gov.approve(a, id); }

  @Post('assessments/:id/reopen') @RequirePermissions(P.approve)
  reopen(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string) { return this.gov.reopen(a, id); }

  @Get('opportunities') @RequirePermissions(P.read)
  opportunities(@CurrentOrgUser() a: OrgUser, @Query('assessment') id?: string) {
    if (id) uuid.transform(id, { type: 'query' });
    return this.gov.opportunities(a, id || undefined);
  }

  // ---------------- خطة التحسين ----------------

  @Get('actions') @RequirePermissions(P.read)
  actions(@CurrentOrgUser() a: OrgUser) { return this.gov.actions(a); }

  @Post('actions') @RequirePermissions(P.actions)
  createAction(@CurrentOrgUser() a: OrgUser, @Body() dto: ActionDto) { return this.gov.createAction(a, dto); }

  @Post('actions/from-gaps') @RequirePermissions(P.actions)
  fromGaps(@CurrentOrgUser() a: OrgUser, @Body() dto: GapActionsDto) { return this.gov.actionsFromGaps(a, dto); }

  @Put('actions/:id') @RequirePermissions(P.actions)
  updateAction(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string, @Body() dto: ActionDto) { return this.gov.updateAction(a, id, dto); }

  @Delete('actions/:id') @RequirePermissions(P.actions)
  removeAction(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string) { return this.gov.removeAction(a, id); }

  // ---------------- تقويم الالتزامات ----------------

  @Get('obligations') @RequirePermissions(P.read)
  obligations(@CurrentOrgUser() a: OrgUser, @Query('year') year?: string) {
    if (year && !/^\d{4}$/.test(year)) throw new BadRequestException('السنة غير صحيحة');
    return this.gov.obligations(a, year ? Number(year) : undefined);
  }

  @Post('obligations') @RequirePermissions(P.calendar)
  createObligation(@CurrentOrgUser() a: OrgUser, @Body() dto: ObligationDto) { return this.gov.createObligation(a, dto); }

  @Post('obligations/generate') @RequirePermissions(P.calendar)
  generate(@CurrentOrgUser() a: OrgUser, @Body() dto: GenerateCalendarDto) { return this.gov.generateCalendar(a, dto); }

  @Put('obligations/:id') @RequirePermissions(P.calendar)
  updateObligation(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string, @Body() dto: ObligationDto) { return this.gov.updateObligation(a, id, dto); }

  @Delete('obligations/:id') @RequirePermissions(P.calendar)
  removeObligation(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string) { return this.gov.removeObligation(a, id); }
}
