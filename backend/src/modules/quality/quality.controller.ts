import { Body, Controller, Delete, Get, HttpCode, Param, ParseIntPipe, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { CurrentOrgUser, OrgUser, Public, RequireAnyPermission, RequirePermissions } from '../../core/auth/decorators';
import { DocType } from './entities/quality.entity';
import { DocumentsService } from './documents.service';
import { FeedbackService } from './feedback.service';
import { ImprovementService } from './improvement.service';
import {
  AuditDto, AuditExecDto, ComplaintActionDto, ComplaintDto, ContextDto, DistributeDto, DocActionDto, DocumentDto, MeasurementDto, NcrAnalysisDto, NcrDto,
  ObjectiveDto, ProcessMapDto, ReviewDto, RiskDto, SettingsDto, SurveyAnswerDto, SurveyDto, SurveyStatusDto, VerifyDto,
} from './quality.dto';
import { QmsCore } from './quality-core.service';
import { QUALITY_PERMISSIONS as P } from './quality.manifest';
import { ReportsService } from './reports.service';
import { ReviewsService } from './reviews.service';

const uuid = new ParseUUIDPipe();
const year = (v?: string) => (v && /^\d{4}$/.test(v) ? Number(v) : undefined);

/** نظام إدارة الجودة ISO 9001 */
@Controller('quality')
export class QualityController {
  constructor(
    private readonly core: QmsCore,
    private readonly docs: DocumentsService,
    private readonly imp: ImprovementService,
    private readonly fb: FeedbackService,
    private readonly reports: ReportsService,
    private readonly reviews: ReviewsService,
  ) {}

  // ---------------- اللوحة والإعدادات والسياق ----------------

  @Get('dashboard')
  @RequirePermissions(P.read)
  dashboard(@CurrentOrgUser() a: OrgUser, @Query('year') y?: string) {
    return this.reports.dashboard(a, y);
  }

  @Get('settings')
  @RequirePermissions(P.read)
  settings(@CurrentOrgUser() a: OrgUser) {
    return this.core.getSettings(a);
  }

  @Put('settings')
  @RequirePermissions(P.settings)
  saveSettings(@CurrentOrgUser() a: OrgUser, @Body() dto: SettingsDto) {
    return this.core.saveSettings(a, dto);
  }

  @Get('context')
  @RequirePermissions(P.read)
  context(@CurrentOrgUser() a: OrgUser) {
    return this.core.getContext(a);
  }

  @Put('context')
  @RequirePermissions(P.context)
  saveContext(@CurrentOrgUser() a: OrgUser, @Body() dto: ContextDto) {
    return this.core.saveContext(a, dto);
  }

  @Get('standard')
  @RequirePermissions(P.read)
  standard(@CurrentOrgUser() a: OrgUser) {
    return this.reports.standard(a);
  }

  @Get('reports')
  @RequirePermissions(P.reports)
  report(@CurrentOrgUser() a: OrgUser, @Query('from') from?: string, @Query('to') to?: string) {
    return this.reports.report(a, from, to);
  }

  // ---------------- الوثائق ----------------

  @Get('documents')
  @RequirePermissions(P.read)
  documents(@CurrentOrgUser() a: OrgUser, @Query() q: { type?: string; status?: string; department?: string; search?: string; external?: string }) {
    return this.docs.list(a, q);
  }

  @Get('codes/next')
  @RequirePermissions(P.documents)
  nextCode(@CurrentOrgUser() a: OrgUser, @Query('type') type: DocType, @Query('department') dept: string) {
    return this.core.suggestCode(a, type, dept);
  }

  @Get('codes/check')
  @RequirePermissions(P.read)
  async checkCode(@CurrentOrgUser() a: OrgUser, @Query('code') code: string) {
    return { code: (code ?? '').toUpperCase(), usedBy: code ? await this.core.codeOwner(a.organizationId, code) : null };
  }

  @Get('documents/:id')
  @RequirePermissions(P.read)
  document(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string) {
    return this.docs.get(a, id);
  }

  @Post('documents')
  @RequirePermissions(P.documents)
  createDocument(@CurrentOrgUser() a: OrgUser, @Body() dto: DocumentDto) {
    return this.docs.create(a, dto);
  }

  @Put('documents/:id')
  @RequirePermissions(P.documents)
  updateDocument(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string, @Body() dto: DocumentDto) {
    return this.docs.update(a, id, dto);
  }

  @Delete('documents/:id')
  @HttpCode(204)
  @RequirePermissions(P.documents)
  removeDocument(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string) {
    return this.docs.remove(a, id);
  }

  @Post('documents/:id/action')
  @HttpCode(200)
  @RequireAnyPermission(P.documents, P.reviewDocs, P.approveDocs)
  documentAction(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string, @Body() dto: DocActionDto) {
    return this.docs.act(a, id, dto);
  }

  @Post('documents/:id/distribute')
  @HttpCode(200)
  @RequirePermissions(P.documents)
  distribute(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string, @Body() dto: DistributeDto) {
    return this.docs.distribute(a, id, dto);
  }

  @Post('documents/:id/copies/:no/acknowledge')
  @HttpCode(200)
  @RequirePermissions(P.read)
  acknowledge(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string, @Param('no', ParseIntPipe) no: number) {
    return this.docs.acknowledge(a, id, no);
  }

  // ---------------- خرائط الإجراءات ----------------

  @Get('maps')
  @RequirePermissions(P.read)
  maps(@CurrentOrgUser() a: OrgUser) {
    return this.docs.maps(a);
  }

  @Get('maps/:id')
  @RequirePermissions(P.read)
  map(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string) {
    return this.docs.map(a, id);
  }

  @Post('maps')
  @RequirePermissions(P.documents)
  createMap(@CurrentOrgUser() a: OrgUser, @Body() dto: ProcessMapDto) {
    return this.docs.saveMap(a, dto);
  }

  @Put('maps/:id')
  @RequirePermissions(P.documents)
  updateMap(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string, @Body() dto: ProcessMapDto) {
    return this.docs.saveMap(a, dto, id);
  }

  @Delete('maps/:id')
  @HttpCode(204)
  @RequirePermissions(P.documents)
  removeMap(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string) {
    return this.docs.removeMap(a, id);
  }

  // ---------------- المراجعة الداخلية ----------------

  @Get('audits')
  @RequirePermissions(P.read)
  audits(@CurrentOrgUser() a: OrgUser, @Query('year') y?: string) {
    return this.imp.audits(a, year(y));
  }

  @Get('audits/:id')
  @RequirePermissions(P.read)
  audit(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string) {
    return this.imp.audit(a, id);
  }

  @Post('audits')
  @RequirePermissions(P.audits)
  createAudit(@CurrentOrgUser() a: OrgUser, @Body() dto: AuditDto) {
    return this.imp.saveAudit(a, dto);
  }

  @Put('audits/:id')
  @RequirePermissions(P.audits)
  updateAudit(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string, @Body() dto: AuditDto) {
    return this.imp.saveAudit(a, dto, id);
  }

  @Post('audits/:id/execute')
  @HttpCode(200)
  @RequirePermissions(P.audits)
  executeAudit(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string, @Body() dto: AuditExecDto) {
    return this.imp.executeAudit(a, id, dto);
  }

  @Post('audits/:id/cancel')
  @HttpCode(200)
  @RequirePermissions(P.audits)
  cancelAudit(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string) {
    return this.imp.cancelAudit(a, id);
  }

  // ---------------- عدم المطابقة ----------------

  @Get('ncrs')
  @RequirePermissions(P.read)
  ncrs(@CurrentOrgUser() a: OrgUser, @Query() q: { status?: string; source?: string; department?: string }) {
    return this.imp.ncrs(a, q);
  }

  @Get('ncrs/:id')
  @RequirePermissions(P.read)
  ncr(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string) {
    return this.imp.ncr(a, id);
  }

  @Post('ncrs')
  @RequirePermissions(P.ncr)
  createNcr(@CurrentOrgUser() a: OrgUser, @Body() dto: NcrDto) {
    return this.imp.createNcr(a, dto);
  }

  @Put('ncrs/:id')
  @RequirePermissions(P.ncr)
  updateNcr(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string, @Body() dto: NcrDto) {
    return this.imp.updateNcr(a, id, dto);
  }

  @Put('ncrs/:id/analysis')
  @RequirePermissions(P.ncr)
  analyzeNcr(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string, @Body() dto: NcrAnalysisDto) {
    return this.imp.analyzeNcr(a, id, dto);
  }

  @Post('ncrs/:id/verify')
  @HttpCode(200)
  @RequirePermissions(P.closeNcr)
  verifyNcr(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string, @Body() dto: VerifyDto) {
    return this.imp.verifyNcr(a, id, dto);
  }

  // ---------------- المخاطر والأهداف ----------------

  @Get('risks')
  @RequirePermissions(P.read)
  risks(@CurrentOrgUser() a: OrgUser) {
    return this.imp.risks(a);
  }

  @Post('risks')
  @RequirePermissions(P.risks)
  createRisk(@CurrentOrgUser() a: OrgUser, @Body() dto: RiskDto) {
    return this.imp.saveRisk(a, dto);
  }

  @Put('risks/:id')
  @RequirePermissions(P.risks)
  updateRisk(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string, @Body() dto: RiskDto) {
    return this.imp.saveRisk(a, dto, id);
  }

  @Delete('risks/:id')
  @HttpCode(204)
  @RequirePermissions(P.risks)
  removeRisk(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string) {
    return this.imp.removeRisk(a, id);
  }

  @Get('objectives')
  @RequirePermissions(P.read)
  objectives(@CurrentOrgUser() a: OrgUser, @Query('year') y?: string) {
    return this.imp.objectives(a, year(y));
  }

  @Post('objectives')
  @RequirePermissions(P.objectives)
  createObjective(@CurrentOrgUser() a: OrgUser, @Body() dto: ObjectiveDto) {
    return this.imp.saveObjective(a, dto);
  }

  @Put('objectives/:id')
  @RequirePermissions(P.objectives)
  updateObjective(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string, @Body() dto: ObjectiveDto) {
    return this.imp.saveObjective(a, dto, id);
  }

  @Post('objectives/:id/measurements')
  @HttpCode(200)
  @RequirePermissions(P.objectives)
  measure(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string, @Body() dto: MeasurementDto) {
    return this.imp.measure(a, id, dto);
  }

  @Delete('objectives/:id')
  @HttpCode(204)
  @RequirePermissions(P.objectives)
  removeObjective(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string) {
    return this.imp.removeObjective(a, id);
  }

  // ---------------- مراجعة الإدارة ----------------

  @Get('reviews')
  @RequirePermissions(P.read)
  reviewList(@CurrentOrgUser() a: OrgUser) {
    return this.reviews.list(a);
  }

  @Get('reviews/inputs')
  @RequirePermissions(P.reviews)
  reviewInputs(@CurrentOrgUser() a: OrgUser) {
    return this.reports.reviewInputs(a);
  }

  @Get('reviews/:id')
  @RequirePermissions(P.read)
  review(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string) {
    return this.reviews.get(a, id);
  }

  @Post('reviews')
  @RequirePermissions(P.reviews)
  createReview(@CurrentOrgUser() a: OrgUser, @Body() dto: ReviewDto) {
    return this.reviews.create(a, dto);
  }

  @Put('reviews/:id')
  @RequirePermissions(P.reviews)
  updateReview(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string, @Body() dto: ReviewDto) {
    return this.reviews.update(a, id, dto);
  }

  @Post('reviews/:id/refresh-inputs')
  @HttpCode(200)
  @RequirePermissions(P.reviews)
  refreshInputs(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string) {
    return this.reviews.refreshInputs(a, id);
  }

  @Post('reviews/:id/approve')
  @HttpCode(200)
  @RequirePermissions(P.approveReviews)
  approveReview(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string) {
    return this.reviews.approve(a, id);
  }

  @Delete('reviews/:id')
  @HttpCode(204)
  @RequirePermissions(P.reviews)
  removeReview(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string) {
    return this.reviews.remove(a, id);
  }

  // ---------------- الشكاوى ----------------

  @Get('complaints')
  @RequirePermissions(P.read)
  complaints(@CurrentOrgUser() a: OrgUser, @Query('status') status?: string) {
    return this.fb.complaints(a, { status });
  }

  @Get('complaints/portal')
  @RequirePermissions(P.feedback)
  portalComplaints(@CurrentOrgUser() a: OrgUser) {
    return this.fb.portalComplaints(a.organizationId);
  }

  @Post('complaints/portal/:ticketId')
  @RequirePermissions(P.feedback)
  importPortal(@CurrentOrgUser() a: OrgUser, @Param('ticketId', uuid) id: string) {
    return this.fb.importPortal(a, id);
  }

  @Get('complaints/:id')
  @RequirePermissions(P.read)
  complaint(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string) {
    return this.fb.complaint(a, id);
  }

  @Post('complaints')
  @RequirePermissions(P.feedback)
  createComplaint(@CurrentOrgUser() a: OrgUser, @Body() dto: ComplaintDto) {
    return this.fb.createComplaint(a, dto);
  }

  @Post('complaints/:id/action')
  @HttpCode(200)
  @RequirePermissions(P.feedback)
  complaintAction(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string, @Body() dto: ComplaintActionDto) {
    return this.fb.actComplaint(a, id, dto);
  }

  // ---------------- الاستبانات ----------------

  @Get('surveys')
  @RequirePermissions(P.read)
  surveys(@CurrentOrgUser() a: OrgUser) {
    return this.fb.surveys(a);
  }

  @Get('surveys/:id')
  @RequirePermissions(P.read)
  survey(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string) {
    return this.fb.survey(a, id);
  }

  @Post('surveys')
  @RequirePermissions(P.feedback)
  createSurvey(@CurrentOrgUser() a: OrgUser, @Body() dto: SurveyDto) {
    return this.fb.saveSurvey(a, dto);
  }

  @Put('surveys/:id')
  @RequirePermissions(P.feedback)
  updateSurvey(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string, @Body() dto: SurveyDto) {
    return this.fb.saveSurvey(a, dto, id);
  }

  @Post('surveys/:id/status')
  @HttpCode(200)
  @RequirePermissions(P.feedback)
  surveyStatus(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string, @Body() dto: SurveyStatusDto) {
    return this.fb.setSurveyStatus(a, id, dto.status);
  }

  @Post('surveys/:id/responses')
  @HttpCode(200)
  @RequirePermissions(P.feedback)
  addResponse(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string, @Body() dto: SurveyAnswerDto) {
    return this.fb.addResponse(a, id, dto);
  }
}

/** رابط الاستبانة العام: يجيب عنه المستفيد أو الداعم دون تسجيل دخول */
@Public()
@Controller('public/surveys')
export class PublicSurveyController {
  constructor(private readonly fb: FeedbackService) {}

  @Get(':token')
  get(@Param('token') token: string) {
    return this.fb.publicSurvey(token);
  }

  @Post(':token')
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  answer(@Param('token') token: string, @Body() dto: SurveyAnswerDto) {
    return this.fb.publicAnswer(token, dto);
  }
}
