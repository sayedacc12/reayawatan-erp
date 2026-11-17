import { BadRequestException, Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put, Query } from '@nestjs/common';
import { CurrentOrgUser, OrgUser, RequireAnyPermission, RequirePermissions } from '../../core/auth/decorators';
import { ChangeService } from './change.service';
import { ComplianceService } from './compliance.service';
import { ContinuityService } from './continuity.service';
import { RegisterService } from './register.service';
import { RiskAuditBridge, RiskReportsService } from './reports.service';
import { RiskCore } from './risk-core.service';
import { PESTEL_FACTORS, PROCESS_NAMES, SWOT_FACTORS } from './risk-defaults';
import {
  AnalysisDto, AssessmentDto, ChangeDto, ChangeProgressDto, ConfigDto, ContinuityDto, ControlDto, CrisisActivateDto, CrisisCloseDto, CrisisLogDto, CrisisTeamDto,
  DecideDto, GuideEntryDto, ItemToRiskDto, MethodologyDto, MethodologyVersionDto, NewMethodologyDto, ObligationDto, PolicyDto, ProcedureDto, RiskDto, RiskReviewDto,
  TaskDto, TaskProgressDto,
} from './risk.dto';
import { RISK_PERMISSIONS as P } from './risk.manifest';

const uuid = new ParseUUIDPipe();

/** المخاطر والتغيير والالتزام */
@Controller('risk')
export class RiskController {
  constructor(
    private readonly core: RiskCore,
    private readonly register: RegisterService,
    private readonly changes: ChangeService,
    private readonly compliance: ComplianceService,
    private readonly continuity: ContinuityService,
    private readonly reports: RiskReportsService,
    private readonly bridge: RiskAuditBridge,
  ) {}

  // ---------------- اللوحة والتقارير والاعتمادات ----------------

  @Get('dashboard') @RequirePermissions(P.read)
  dashboard(@CurrentOrgUser() a: OrgUser) { return this.reports.dashboard(a); }

  @Get('reports') @RequirePermissions(P.reports)
  report(@CurrentOrgUser() a: OrgUser) { return this.reports.reports(a); }

  @Get('approvals') @RequirePermissions(P.read)
  approvals(@CurrentOrgUser() a: OrgUser) { return this.reports.approvals(a); }

  @Get('audit-universe') @RequirePermissions(P.reports)
  universe(@CurrentOrgUser() a: OrgUser) { return this.bridge.auditUniverse(a.organizationId); }

  // ---------------- الإعدادات والقوائم ----------------

  @Get('config') @RequirePermissions(P.read)
  async config(@CurrentOrgUser() a: OrgUser) {
    return { ...(await this.core.getConfig(a)), processes: PROCESS_NAMES, pestel: PESTEL_FACTORS, swot: SWOT_FACTORS };
  }

  @Put('config') @RequirePermissions(P.settings)
  saveConfig(@CurrentOrgUser() a: OrgUser, @Body() dto: ConfigDto) { return this.core.saveConfig(a, dto.config); }

  @Get('lookups') @RequirePermissions(P.read)
  async lookups(@CurrentOrgUser() a: OrgUser) {
    return { ...(await this.core.lookups(a)), risks: await this.register.riskOptions(a.organizationId) };
  }

  @Get('permission-options') @RequirePermissions(P.read)
  permissionOptions(@CurrentOrgUser() a: OrgUser) { return this.continuity.permissionOptions(a); }

  // ---------------- اللائحة والمنهجيات والدليل ----------------

  @Get('policy') @RequirePermissions(P.read)
  policy(@CurrentOrgUser() a: OrgUser) { return this.core.getPolicy(a); }

  @Get('policy/versions/:v') @RequirePermissions(P.read)
  policyVersion(@CurrentOrgUser() a: OrgUser, @Param('v') v: string) {
    if (!/^\d{1,5}$/.test(v)) throw new BadRequestException('رقم الإصدار غير صحيح');
    return this.core.policyVersion(a, Number(v));
  }

  @Put('policy') @RequirePermissions(P.policy)
  savePolicy(@CurrentOrgUser() a: OrgUser, @Body() dto: PolicyDto) { return this.core.savePolicy(a, dto); }

  @Get('methodologies') @RequirePermissions(P.read)
  methodologies(@CurrentOrgUser() a: OrgUser) { return this.core.listMethodologies(a); }

  @Post('methodologies/install') @RequirePermissions(P.methodologies)
  installMethodologies(@CurrentOrgUser() a: OrgUser) { return this.core.installMethodologies(a); }

  @Post('methodologies') @RequirePermissions(P.methodologies)
  createMethodology(@CurrentOrgUser() a: OrgUser, @Body() dto: NewMethodologyDto) { return this.core.createMethodology(a, dto); }

  @Patch('methodologies/:id') @RequirePermissions(P.methodologies)
  updateMethodology(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string, @Body() dto: MethodologyDto) { return this.core.updateMethodology(a, id, dto); }

  @Post('methodologies/:id/versions') @RequirePermissions(P.methodologies)
  newMethodologyVersion(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string, @Body() dto: MethodologyVersionDto) { return this.core.newMethodologyVersion(a, id, dto); }

  @Get('methodologies/versions/:id') @RequirePermissions(P.read)
  methodologyVersion(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string) { return this.core.methodologyVersion(a, id); }

  @Get('methodologies/:id/at') @RequirePermissions(P.read)
  methodologyAt(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string, @Query('date') date: string) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date ?? '')) throw new BadRequestException('التاريخ غير صحيح');
    return this.core.methodologyAt(a, id, date);
  }

  @Get('guide') @RequirePermissions(P.read)
  guide(@CurrentOrgUser() a: OrgUser) { return this.core.guide(a); }

  @Post('guide') @RequirePermissions(P.guide)
  addGuide(@CurrentOrgUser() a: OrgUser, @Body() dto: GuideEntryDto) { return this.core.saveGuideEntry(a, dto); }

  @Patch('guide/:id') @RequirePermissions(P.guide)
  updateGuide(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string, @Body() dto: GuideEntryDto) { return this.core.saveGuideEntry(a, dto, id); }

  @Delete('guide/:id') @HttpCode(204) @RequirePermissions(P.guide)
  removeGuide(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string) { return this.core.removeGuideEntry(a, id); }

  // ---------------- سجل المخاطر ----------------

  @Get('risks') @RequirePermissions(P.read)
  risks(@CurrentOrgUser() a: OrgUser, @Query() q: Record<string, string>) { return this.register.listRisks(a, q); }

  @Get('risks/:id') @RequirePermissions(P.read)
  risk(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string) { return this.register.getRisk(a, id); }

  @Post('risks') @RequirePermissions(P.register)
  createRisk(@CurrentOrgUser() a: OrgUser, @Body() dto: RiskDto) { return this.register.createRisk(a, dto); }

  @Patch('risks/:id') @RequirePermissions(P.register)
  updateRisk(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string, @Body() dto: RiskDto) { return this.register.updateRisk(a, id, dto); }

  @Delete('risks/:id') @HttpCode(204) @RequirePermissions(P.register)
  removeRisk(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string) { return this.register.removeRisk(a, id); }

  @Post('risks/:id/reviews') @RequirePermissions(P.register)
  reviewRisk(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string, @Body() dto: RiskReviewDto) { return this.register.reviewRisk(a, id, dto); }

  @Post('risks/:id/submit') @RequirePermissions(P.register)
  async submitRisk(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string) { await this.register.submitRisk(a, id); return this.register.getRisk(a, id); }

  @Post('risks/:id/decision') @RequirePermissions(P.read)
  async decideRisk(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string, @Body() dto: DecideDto) {
    await this.register.decideRisk(a, id, dto.decision, dto.note); return this.register.getRisk(a, id);
  }

  // ---------------- الضوابط ----------------

  @Get('controls') @RequirePermissions(P.read)
  controls(@CurrentOrgUser() a: OrgUser) { return this.register.listControls(a); }

  @Post('controls') @RequirePermissions(P.register)
  createControl(@CurrentOrgUser() a: OrgUser, @Body() dto: ControlDto) { return this.register.saveControl(a, dto); }

  @Patch('controls/:id') @RequirePermissions(P.register)
  updateControl(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string, @Body() dto: ControlDto) { return this.register.saveControl(a, dto, id); }

  @Delete('controls/:id') @HttpCode(204) @RequirePermissions(P.register)
  removeControl(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string) { return this.register.removeControl(a, id); }

  // ---------------- التحليلات ----------------

  @Get('analyses') @RequirePermissions(P.read)
  analyses(@CurrentOrgUser() a: OrgUser) { return this.register.listAnalyses(a); }

  @Get('analyses/:id') @RequirePermissions(P.read)
  analysis(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string) { return this.register.getAnalysis(a, id); }

  @Post('analyses') @RequirePermissions(P.analysis)
  createAnalysis(@CurrentOrgUser() a: OrgUser, @Body() dto: AnalysisDto) { return this.register.createAnalysis(a, dto); }

  @Patch('analyses/:id') @RequirePermissions(P.analysis)
  updateAnalysis(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string, @Body() dto: AnalysisDto) { return this.register.updateAnalysis(a, id, dto); }

  @Delete('analyses/:id') @HttpCode(204) @RequirePermissions(P.analysis)
  removeAnalysis(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string) { return this.register.removeAnalysis(a, id); }

  @Post('analyses/:id/to-risk') @RequirePermissions(P.register)
  itemToRisk(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string, @Body() dto: ItemToRiskDto) { return this.register.itemToRisk(a, id, dto); }

  @Post('analyses/:id/submit') @RequirePermissions(P.analysis)
  async submitAnalysis(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string) { await this.register.submitAnalysis(a, id); return this.register.getAnalysis(a, id); }

  @Post('analyses/:id/decision') @RequirePermissions(P.read)
  async decideAnalysis(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string, @Body() dto: DecideDto) {
    await this.register.decideAnalysis(a, id, dto.decision, dto.note); return this.register.getAnalysis(a, id);
  }

  // ---------------- سجل التغيير ومهامه ----------------

  @Get('changes') @RequirePermissions(P.read)
  listChanges(@CurrentOrgUser() a: OrgUser, @Query() q: Record<string, string>) { return this.changes.listChanges(a, q); }

  @Get('changes/:id') @RequirePermissions(P.read)
  change(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string) { return this.changes.getChange(a, id); }

  @Post('changes') @RequirePermissions(P.change)
  createChange(@CurrentOrgUser() a: OrgUser, @Body() dto: ChangeDto) { return this.changes.createChange(a, dto); }

  @Patch('changes/:id') @RequirePermissions(P.change)
  updateChange(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string, @Body() dto: ChangeDto) { return this.changes.updateChange(a, id, dto); }

  @Delete('changes/:id') @HttpCode(204) @RequirePermissions(P.change)
  removeChange(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string) { return this.changes.removeChange(a, id); }

  @Post('changes/:id/submit') @RequirePermissions(P.change)
  async submitChange(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string) { await this.changes.submitChange(a, id); return this.changes.getChange(a, id); }

  @Post('changes/:id/decision') @RequirePermissions(P.read)
  async decideChange(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string, @Body() dto: DecideDto) {
    await this.changes.decideChange(a, id, dto.decision, dto.note); return this.changes.getChange(a, id);
  }

  @Post('changes/:id/progress') @RequirePermissions(P.change)
  progressChange(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string, @Body() dto: ChangeProgressDto) { return this.changes.progressChange(a, id, dto); }

  @Post('changes/:id/tasks') @RequirePermissions(P.change)
  addChangeTask(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string, @Body() dto: TaskDto) { return this.changes.addTask(a, 'change', id, dto); }

  @Get('tasks') @RequirePermissions(P.read)
  tasks(@CurrentOrgUser() a: OrgUser, @Query() q: Record<string, string>) { return this.changes.listTasks(a, q); }

  @Patch('tasks/:id') @RequireAnyPermission(P.change, P.activateCrisis)
  updateTask(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string, @Body() dto: TaskDto) { return this.changes.updateTask(a, id, dto); }

  @Post('tasks/:id/progress') @RequirePermissions(P.read)
  progressTask(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string, @Body() dto: TaskProgressDto) { return this.changes.progressTask(a, id, dto); }

  @Delete('tasks/:id') @HttpCode(204) @RequireAnyPermission(P.change, P.activateCrisis)
  removeTask(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string) { return this.changes.removeTask(a, id); }

  // ---------------- هندسة الإجراءات ----------------

  @Get('procedures') @RequirePermissions(P.read)
  procedures(@CurrentOrgUser() a: OrgUser) { return this.changes.listProcedures(a); }

  @Get('procedures/:id') @RequirePermissions(P.read)
  procedure(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string) { return this.changes.getProcedure(a, id); }

  @Post('procedures') @RequirePermissions(P.procedures)
  createProcedure(@CurrentOrgUser() a: OrgUser, @Body() dto: ProcedureDto) { return this.changes.createProcedure(a, dto); }

  @Patch('procedures/:id') @RequirePermissions(P.procedures)
  updateProcedure(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string, @Body() dto: ProcedureDto) { return this.changes.updateProcedure(a, id, dto); }

  @Delete('procedures/:id') @HttpCode(204) @RequirePermissions(P.procedures)
  removeProcedure(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string) { return this.changes.removeProcedure(a, id); }

  @Post('procedures/:id/submit') @RequirePermissions(P.procedures)
  async submitProcedure(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string) { await this.changes.submitProcedure(a, id); return this.changes.getProcedure(a, id); }

  @Post('procedures/:id/decision') @RequirePermissions(P.read)
  async decideProcedure(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string, @Body() dto: DecideDto) {
    await this.changes.decideProcedure(a, id, dto.decision, dto.note); return this.changes.getProcedure(a, id);
  }

  // ---------------- الالتزام ----------------

  @Get('obligations') @RequirePermissions(P.read)
  obligations(@CurrentOrgUser() a: OrgUser, @Query() q: Record<string, string>) { return this.compliance.listObligations(a, q); }

  @Get('obligations/:id') @RequirePermissions(P.read)
  obligation(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string) { return this.compliance.getObligation(a, id); }

  @Post('obligations') @RequirePermissions(P.compliance)
  createObligation(@CurrentOrgUser() a: OrgUser, @Body() dto: ObligationDto) { return this.compliance.saveObligation(a, dto); }

  @Patch('obligations/:id') @RequirePermissions(P.compliance)
  updateObligation(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string, @Body() dto: ObligationDto) { return this.compliance.saveObligation(a, dto, id); }

  @Delete('obligations/:id') @HttpCode(204) @RequirePermissions(P.compliance)
  removeObligation(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string) { return this.compliance.removeObligation(a, id); }

  @Post('obligations/:id/assessments') @RequirePermissions(P.compliance)
  addAssessment(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string, @Body() dto: AssessmentDto) { return this.compliance.addAssessment(a, id, dto); }

  @Patch('assessments/:id') @RequirePermissions(P.compliance)
  updateAssessment(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string, @Body() dto: AssessmentDto) { return this.compliance.updateAssessment(a, id, dto); }

  @Post('assessments/:id/submit') @RequirePermissions(P.compliance)
  async submitAssessment(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string) {
    const r = await this.compliance.submitAssessment(a, id); return this.compliance.getObligation(a, r.obligationId);
  }

  @Post('assessments/:id/decision') @RequirePermissions(P.read)
  async decideAssessment(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string, @Body() dto: DecideDto) {
    const r = await this.compliance.decideAssessment(a, id, dto.decision, dto.note); return this.compliance.getObligation(a, r.obligationId);
  }

  // ---------------- استمرارية الأعمال ----------------

  @Get('continuity') @RequirePermissions(P.read)
  listContinuity(@CurrentOrgUser() a: OrgUser) { return this.continuity.listContinuity(a); }

  @Get('continuity/:id') @RequirePermissions(P.read)
  getContinuity(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string) { return this.continuity.getContinuity(a, id); }

  @Post('continuity') @RequirePermissions(P.continuity)
  createContinuity(@CurrentOrgUser() a: OrgUser, @Body() dto: ContinuityDto) { return this.continuity.saveContinuity(a, dto); }

  @Patch('continuity/:id') @RequirePermissions(P.continuity)
  updateContinuity(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string, @Body() dto: ContinuityDto) { return this.continuity.saveContinuity(a, dto, id); }

  @Delete('continuity/:id') @HttpCode(204) @RequirePermissions(P.continuity)
  removeContinuity(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string) { return this.continuity.removeContinuity(a, id); }

  @Post('continuity/:id/submit') @RequirePermissions(P.continuity)
  async submitContinuity(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string) { await this.continuity.submitContinuity(a, id); return this.continuity.getContinuity(a, id); }

  @Post('continuity/:id/decision') @RequirePermissions(P.read)
  async decideContinuity(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string, @Body() dto: DecideDto) {
    await this.continuity.decideContinuity(a, id, dto.decision, dto.note); return this.continuity.getContinuity(a, id);
  }

  // ---------------- فرق الأزمات ----------------

  @Get('crisis-teams') @RequirePermissions(P.read)
  teams(@CurrentOrgUser() a: OrgUser) { return this.continuity.listTeams(a); }

  @Get('crisis-teams/:id') @RequirePermissions(P.read)
  team(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string) { return this.continuity.getTeam(a, id); }

  @Post('crisis-teams') @RequirePermissions(P.continuity)
  createTeam(@CurrentOrgUser() a: OrgUser, @Body() dto: CrisisTeamDto) { return this.continuity.saveTeam(a, dto); }

  @Patch('crisis-teams/:id') @RequirePermissions(P.continuity)
  updateTeam(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string, @Body() dto: CrisisTeamDto) { return this.continuity.saveTeam(a, dto, id); }

  @Delete('crisis-teams/:id') @HttpCode(204) @RequirePermissions(P.continuity)
  removeTeam(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string) { return this.continuity.removeTeam(a, id); }

  @Post('crisis-teams/:id/submit') @RequirePermissions(P.continuity)
  async submitTeam(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string) { await this.continuity.submitTeam(a, id); return this.continuity.getTeam(a, id); }

  @Post('crisis-teams/:id/decision') @RequirePermissions(P.read)
  async decideTeam(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string, @Body() dto: DecideDto) {
    await this.continuity.decideTeam(a, id, dto.decision, dto.note); return this.continuity.getTeam(a, id);
  }

  @Post('crisis-teams/:id/activate') @RequirePermissions(P.activateCrisis)
  activate(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string, @Body() dto: CrisisActivateDto) { return this.continuity.activate(a, id, dto); }

  @Get('crisis-events/:id') @RequirePermissions(P.read)
  event(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string) { return this.continuity.getEvent(a, id); }

  @Post('crisis-events/:id/log') @RequirePermissions(P.read)
  addLog(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string, @Body() dto: CrisisLogDto) { return this.continuity.addLog(a, id, dto); }

  @Post('crisis-events/:id/tasks') @RequirePermissions(P.activateCrisis)
  addCrisisTask(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string, @Body() dto: TaskDto) { return this.changes.addTask(a, 'crisis', id, dto); }

  @Post('crisis-events/:id/close') @RequirePermissions(P.activateCrisis)
  close(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string, @Body() dto: CrisisCloseDto) { return this.continuity.close(a, id, dto); }
}
