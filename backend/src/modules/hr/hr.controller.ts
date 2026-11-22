import { BadRequestException, Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put, Query } from '@nestjs/common';
import { CurrentOrgUser, OrgUser, RequireAnyPermission, RequirePermissions } from '../../core/auth/decorators';
import {
  CardActionDto, CardCreateDto, CardUpdateDto, CompetencyDto, DecisionDto, EmployeeDto, EosCalcDto, GradeDto, JobDto, LeaveDto, PlanDto, PolicyDto,
  SettingsDto, TerminateDto, UnitDto,
} from './hr.dto';
import { HrCore, today } from './hr-core.service';
import { HR_PERMISSIONS as P } from './hr.manifest';
import { OrgService } from './org.service';
import { PeopleService } from './people.service';
import { PerformanceService } from './performance.service';

const uuid = new ParseUUIDPipe();
const yearOf = (v?: string) => {
  const y = v ? Number(v) : Number(today().slice(0, 4));
  if (!Number.isInteger(y) || y < 2000 || y > 2100) throw new BadRequestException('السنة غير صحيحة');
  return y;
};

/** الموارد البشرية: اللائحة والإعدادات، التنظيم والتخطيط، شؤون الموظفين، الإجازات، الأداء */
@Controller('hr')
export class HrController {
  constructor(
    private readonly core: HrCore,
    private readonly org: OrgService,
    private readonly people: PeopleService,
    private readonly perf: PerformanceService,
  ) {}

  // ---------------- اللوحة والإعدادات واللائحة ----------------

  @Get('dashboard')
  @RequirePermissions(P.read)
  async dashboard(@CurrentOrgUser() actor: OrgUser) {
    return this.people.dashboard(actor, await this.org.vacancies(actor.organizationId));
  }

  @Get('settings')
  @RequirePermissions(P.read)
  settings(@CurrentOrgUser() actor: OrgUser) {
    return this.core.getSettings(actor);
  }

  @Put('settings')
  @RequirePermissions(P.settings)
  saveSettings(@CurrentOrgUser() actor: OrgUser, @Body() dto: SettingsDto) {
    return this.core.saveSettings(actor, dto);
  }

  @Get('policy')
  @RequirePermissions(P.read)
  policy(@CurrentOrgUser() actor: OrgUser) {
    return this.core.getPolicy(actor);
  }

  @Put('policy')
  @RequirePermissions(P.policy)
  savePolicy(@CurrentOrgUser() actor: OrgUser, @Body() dto: PolicyDto) {
    return this.core.savePolicy(actor, dto);
  }

  // ---------------- الهيكل التنظيمي ----------------

  @Get('structure')
  @RequirePermissions(P.read)
  structure(@CurrentOrgUser() actor: OrgUser) {
    return this.org.structure(actor);
  }

  @Post('units')
  @RequirePermissions(P.structure)
  createUnit(@CurrentOrgUser() actor: OrgUser, @Body() dto: UnitDto) {
    return this.org.createUnit(actor, dto);
  }

  @Patch('units/:id')
  @RequirePermissions(P.structure)
  updateUnit(@CurrentOrgUser() actor: OrgUser, @Param('id', uuid) id: string, @Body() dto: UnitDto) {
    return this.org.updateUnit(actor, id, dto);
  }

  @Delete('units/:id')
  @HttpCode(204)
  @RequirePermissions(P.structure)
  removeUnit(@CurrentOrgUser() actor: OrgUser, @Param('id', uuid) id: string) {
    return this.org.removeUnit(actor, id);
  }

  // ---------------- سلم الرواتب ----------------

  @Get('grades')
  @RequirePermissions(P.read)
  grades(@CurrentOrgUser() actor: OrgUser) {
    return this.org.listGrades(actor);
  }

  @Post('grades')
  @RequirePermissions(P.grades)
  createGrade(@CurrentOrgUser() actor: OrgUser, @Body() dto: GradeDto) {
    return this.org.createGrade(actor, dto);
  }

  @Patch('grades/:id')
  @RequirePermissions(P.grades)
  updateGrade(@CurrentOrgUser() actor: OrgUser, @Param('id', uuid) id: string, @Body() dto: GradeDto) {
    return this.org.updateGrade(actor, id, dto);
  }

  @Delete('grades/:id')
  @HttpCode(204)
  @RequirePermissions(P.grades)
  removeGrade(@CurrentOrgUser() actor: OrgUser, @Param('id', uuid) id: string) {
    return this.org.removeGrade(actor, id);
  }

  // ---------------- الجدارات ----------------

  @Get('competencies')
  @RequirePermissions(P.read)
  competencies(@CurrentOrgUser() actor: OrgUser) {
    return this.org.listCompetencies(actor);
  }

  @Post('competencies')
  @RequirePermissions(P.competencies)
  createCompetency(@CurrentOrgUser() actor: OrgUser, @Body() dto: CompetencyDto) {
    return this.org.createCompetency(actor, dto);
  }

  @Patch('competencies/:id')
  @RequirePermissions(P.competencies)
  updateCompetency(@CurrentOrgUser() actor: OrgUser, @Param('id', uuid) id: string, @Body() dto: CompetencyDto) {
    return this.org.updateCompetency(actor, id, dto);
  }

  @Delete('competencies/:id')
  @HttpCode(204)
  @RequirePermissions(P.competencies)
  removeCompetency(@CurrentOrgUser() actor: OrgUser, @Param('id', uuid) id: string) {
    return this.org.removeCompetency(actor, id);
  }

  // ---------------- الوظائف ----------------

  @Get('jobs')
  @RequirePermissions(P.read)
  jobs(@CurrentOrgUser() actor: OrgUser) {
    return this.org.listJobs(actor);
  }

  @Get('jobs/:id')
  @RequirePermissions(P.read)
  job(@CurrentOrgUser() actor: OrgUser, @Param('id', uuid) id: string) {
    return this.org.job(actor, id);
  }

  @Post('jobs')
  @RequirePermissions(P.jobs)
  createJob(@CurrentOrgUser() actor: OrgUser, @Body() dto: JobDto) {
    return this.org.createJob(actor, dto);
  }

  @Patch('jobs/:id')
  @RequirePermissions(P.jobs)
  updateJob(@CurrentOrgUser() actor: OrgUser, @Param('id', uuid) id: string, @Body() dto: JobDto) {
    return this.org.updateJob(actor, id, dto);
  }

  @Post('jobs/:id/approve')
  @RequirePermissions(P.approveJobs)
  approveJob(@CurrentOrgUser() actor: OrgUser, @Param('id', uuid) id: string) {
    return this.org.approveJob(actor, id);
  }

  @Delete('jobs/:id')
  @HttpCode(204)
  @RequirePermissions(P.jobs)
  removeJob(@CurrentOrgUser() actor: OrgUser, @Param('id', uuid) id: string) {
    return this.org.removeJob(actor, id);
  }

  // ---------------- خطط التعيين ----------------

  @Get('plans')
  @RequirePermissions(P.read)
  plans(@CurrentOrgUser() actor: OrgUser, @Query('year') year?: string) {
    return this.org.listPlans(actor, yearOf(year));
  }

  @Post('plans')
  @RequirePermissions(P.plans)
  createPlan(@CurrentOrgUser() actor: OrgUser, @Body() dto: PlanDto) {
    return this.org.createPlan(actor, dto);
  }

  @Patch('plans/:id')
  @RequirePermissions(P.plans)
  updatePlan(@CurrentOrgUser() actor: OrgUser, @Param('id', uuid) id: string, @Body() dto: PlanDto) {
    return this.org.updatePlan(actor, id, dto);
  }

  @Post('plans/:id/submit')
  @RequirePermissions(P.plans)
  submitPlan(@CurrentOrgUser() actor: OrgUser, @Param('id', uuid) id: string) {
    return this.org.submitPlan(actor, id);
  }

  @Post('plans/:id/decision')
  @RequirePermissions(P.approvePlans)
  decidePlan(@CurrentOrgUser() actor: OrgUser, @Param('id', uuid) id: string, @Body() dto: DecisionDto) {
    return this.org.decidePlan(actor, id, dto);
  }

  @Delete('plans/:id')
  @HttpCode(204)
  @RequirePermissions(P.plans)
  removePlan(@CurrentOrgUser() actor: OrgUser, @Param('id', uuid) id: string) {
    return this.org.removePlan(actor, id);
  }

  // ---------------- الموظفون ----------------

  @Get('employees')
  @RequirePermissions(P.read)
  employees(@CurrentOrgUser() actor: OrgUser, @Query('status') status?: string) {
    return this.people.list(actor, status);
  }

  /** حسابات الدخول في الشركة لربط الموظف بحسابه (الخدمة الذاتية) */
  @Get('users')
  @RequirePermissions(P.employees)
  users(@CurrentOrgUser() actor: OrgUser) {
    return this.people.users(actor);
  }

  @Get('employees/:id')
  @RequirePermissions(P.read)
  employee(@CurrentOrgUser() actor: OrgUser, @Param('id', uuid) id: string) {
    return this.people.profile(actor, id);
  }

  @Post('employees')
  @RequirePermissions(P.employees)
  createEmployee(@CurrentOrgUser() actor: OrgUser, @Body() dto: EmployeeDto) {
    return this.people.create(actor, dto);
  }

  @Patch('employees/:id')
  @RequirePermissions(P.employees)
  updateEmployee(@CurrentOrgUser() actor: OrgUser, @Param('id', uuid) id: string, @Body() dto: EmployeeDto) {
    return this.people.update(actor, id, dto);
  }

  @Post('employees/:id/terminate')
  @RequirePermissions(P.employees, P.salaries)
  terminate(@CurrentOrgUser() actor: OrgUser, @Param('id', uuid) id: string, @Body() dto: TerminateDto) {
    return this.people.terminate(actor, id, dto);
  }

  @Get('employees/:id/balances')
  @RequireAnyPermission(P.read, P.leaves)
  balances(@CurrentOrgUser() actor: OrgUser, @Param('id', uuid) id: string) {
    return this.people.employeeBalances(actor, id);
  }

  // ---------------- الرواتب ونهاية الخدمة ----------------

  @Get('payroll')
  @RequirePermissions(P.salaries)
  payroll(@CurrentOrgUser() actor: OrgUser, @Query('month') month?: string) {
    return this.people.payroll(actor, month ?? today().slice(0, 7));
  }

  @Get('eos/reasons')
  @RequirePermissions(P.read)
  reasons() {
    return this.people.reasons();
  }

  @Post('eos/calculate')
  @HttpCode(200)
  @RequirePermissions(P.salaries)
  eos(@CurrentOrgUser() actor: OrgUser, @Body() dto: EosCalcDto) {
    return this.people.eosCalc(actor, dto);
  }

  // ---------------- الإجازات ----------------

  @Get('leaves')
  @RequirePermissions(P.read)
  leaves(@CurrentOrgUser() actor: OrgUser, @Query('status') status?: string) {
    return this.people.listLeaves(actor, status);
  }

  @Post('leaves')
  @RequirePermissions(P.leaves)
  requestLeave(@CurrentOrgUser() actor: OrgUser, @Body() dto: LeaveDto) {
    return this.people.requestLeave(actor, dto);
  }

  @Post('leaves/:id/decision')
  @RequirePermissions(P.approveLeaves)
  decideLeave(@CurrentOrgUser() actor: OrgUser, @Param('id', uuid) id: string, @Body() dto: DecisionDto) {
    return this.people.decideLeave(actor, id, dto.decision, dto.note ?? null);
  }

  @Post('leaves/:id/cancel')
  @RequireAnyPermission(P.leaves, P.approveLeaves)
  cancelLeave(@CurrentOrgUser() actor: OrgUser, @Param('id', uuid) id: string) {
    return this.people.cancelLeave(actor, id);
  }

  // ---------------- الأداء ----------------

  @Get('performance')
  @RequirePermissions(P.read)
  cards(@CurrentOrgUser() actor: OrgUser, @Query('year') year?: string) {
    return this.perf.list(actor, yearOf(year));
  }

  @Get('performance/:id')
  @RequirePermissions(P.read)
  card(@CurrentOrgUser() actor: OrgUser, @Param('id', uuid) id: string) {
    return this.perf.get(actor, id);
  }

  @Post('performance')
  @RequirePermissions(P.performance)
  createCard(@CurrentOrgUser() actor: OrgUser, @Body() dto: CardCreateDto) {
    return this.perf.create(actor, dto);
  }

  @Post('performance/generate')
  @RequirePermissions(P.performance)
  generate(@CurrentOrgUser() actor: OrgUser, @Query('year') year?: string) {
    return this.perf.generate(actor, yearOf(year));
  }

  @Patch('performance/:id')
  @RequirePermissions(P.performance)
  updateCard(@CurrentOrgUser() actor: OrgUser, @Param('id', uuid) id: string, @Body() dto: CardUpdateDto) {
    return this.perf.update(actor, id, dto);
  }

  @Post('performance/:id/action')
  @RequireAnyPermission(P.performance, P.approvePerformance)
  cardAction(@CurrentOrgUser() actor: OrgUser, @Param('id', uuid) id: string, @Body() dto: CardActionDto) {
    return this.perf.action(actor, id, dto);
  }

  @Delete('performance/:id')
  @HttpCode(204)
  @RequirePermissions(P.performance)
  removeCard(@CurrentOrgUser() actor: OrgUser, @Param('id', uuid) id: string) {
    return this.perf.remove(actor, id);
  }
}
