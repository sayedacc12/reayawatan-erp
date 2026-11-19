import { BadRequestException, Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { CurrentOrgUser, OrgUser, RequireAnyPermission, RequirePermissions } from '../../../core/auth/decorators';
import { DecideDto, SubmitDto } from '../planning.dto';
import { PLANNING_PERMISSIONS as P } from '../planning.manifest';
import { BudgetAvailability } from './budget-availability.service';
import { AvailabilityCheckDto, BudgetDto, FormulaDto, ImportDto, LineDto, TestFormulaDto, UpdateBudgetDto, UpdateFormulaDto, UpdateLineDto } from './budget.dto';
import { BudgetsService } from './budgets.service';
import { FormulasService } from './formulas.service';

const uuid = new ParseUUIDPipe();
const ver = (v: string) => {
  if (!/^\d{1,4}$/.test(v)) throw new BadRequestException('رقم الإصدار غير صحيح');
  return Number(v);
};
const READ = [P.read, P.budgets];

/** الموازنات التقديرية ومكتبة المعادلات و«المتاح» للصرف */
@Controller('planning')
export class BudgetController {
  constructor(private readonly budgets: BudgetsService, private readonly formulas: FormulasService, private readonly avail: BudgetAvailability) {}

  // ---------------- المعادلات ----------------

  @Get('formulas') @RequireAnyPermission(...READ, P.formulas)
  listFormulas(@CurrentOrgUser() a: OrgUser) { return this.formulas.list(a); }

  @Post('formulas') @RequirePermissions(P.formulas)
  createFormula(@CurrentOrgUser() a: OrgUser, @Body() dto: FormulaDto) { return this.formulas.create(a, dto); }

  @Patch('formulas/:id') @RequirePermissions(P.formulas)
  updateFormula(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string, @Body() dto: UpdateFormulaDto) { return this.formulas.update(a, id, dto); }

  @Delete('formulas/:id') @RequirePermissions(P.formulas)
  removeFormula(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string) { return this.formulas.remove(a, id); }

  @Post('formulas/test') @RequireAnyPermission(P.formulas, P.budgets)
  testFormula(@CurrentOrgUser() a: OrgUser, @Body() dto: TestFormulaDto) { return this.formulas.test(a, dto); }

  // ---------------- الموازنات ----------------

  @Get('budget-lookups') @RequireAnyPermission(...READ)
  lookups(@CurrentOrgUser() a: OrgUser) { return this.budgets.lookups(a); }

  @Get('budgets') @RequireAnyPermission(...READ)
  list(@CurrentOrgUser() a: OrgUser, @Query() q: Record<string, string>) { return this.budgets.list(a, q); }

  @Post('budgets') @RequirePermissions(P.budgets)
  create(@CurrentOrgUser() a: OrgUser, @Body() dto: BudgetDto) { return this.budgets.create(a, dto); }

  @Get('budgets/:id') @RequireAnyPermission(...READ)
  get(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string) { return this.budgets.get(a, id); }

  @Patch('budgets/:id') @RequirePermissions(P.budgets)
  update(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string, @Body() dto: UpdateBudgetDto) { return this.budgets.update(a, id, dto); }

  @Delete('budgets/:id') @RequirePermissions(P.budgets)
  remove(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string) { return this.budgets.remove(a, id); }

  @Post('budgets/:id/import') @RequirePermissions(P.budgets)
  import(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string, @Body() dto: ImportDto) { return this.budgets.importLines(a, id, dto); }

  @Post('budgets/:id/recalculate') @RequirePermissions(P.budgets)
  recalculate(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string) { return this.budgets.recalculate(a, id); }

  @Post('budgets/:id/lines') @RequirePermissions(P.budgets)
  addLine(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string, @Body() dto: LineDto) { return this.budgets.addLine(a, id, dto); }

  @Patch('budget-lines/:id') @RequirePermissions(P.budgets)
  updateLine(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string, @Body() dto: UpdateLineDto) { return this.budgets.updateLine(a, id, dto); }

  @Post('budget-lines/:id/refresh') @RequirePermissions(P.budgets)
  refresh(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string) { return this.budgets.refreshHistory(a, id); }

  @Delete('budget-lines/:id') @RequirePermissions(P.budgets)
  removeLine(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string) { return this.budgets.removeLine(a, id); }

  @Post('budgets/:id/submit') @RequirePermissions(P.budgets)
  submit(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string, @Body() dto: SubmitDto) { return this.budgets.submit(a, id, dto.note ?? null); }

  @Post('budgets/:id/decision') @RequirePermissions(P.budgetsApprove)
  decide(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string, @Body() dto: DecideDto) { return this.budgets.decide(a, id, dto); }

  @Post('budgets/:id/discard') @RequirePermissions(P.budgets)
  discard(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string) { return this.budgets.discard(a, id); }

  @Get('budgets/:id/versions/:v') @RequireAnyPermission(...READ)
  version(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string, @Param('v') v: string) { return this.budgets.version(a, id, ver(v)); }

  @Get('budgets/:id/compare') @RequireAnyPermission(...READ)
  compare(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string, @Query('from') from: string, @Query('to') to?: string) {
    return this.budgets.compare(a, id, ver(from), to ? ver(to) : 0);
  }

  // ---------------- المتاح للصرف (لنظام المشتريات وغيره) ----------------

  @Get('availability') @RequireAnyPermission(...READ)
  availability(@CurrentOrgUser() a: OrgUser, @Query('year') year?: string) {
    const y = year && /^\d{4}$/.test(year) ? Number(year) : new Date().getFullYear();
    return this.avail.lines(a.organizationId, y);
  }

  @Get('availability/funding') @RequireAnyPermission(...READ)
  fundingSources(@CurrentOrgUser() a: OrgUser) { return this.avail.fundingSources(a.organizationId); }

  @Get('availability/funding/:id') @RequireAnyPermission(...READ)
  funding(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string) { return this.avail.funding(a.organizationId, id); }

  @Get('availability/lines/:id') @RequireAnyPermission(...READ)
  line(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string) { return this.avail.line(a.organizationId, id); }

  @Post('availability/check') @RequireAnyPermission(...READ)
  check(@CurrentOrgUser() a: OrgUser, @Body() dto: AvailabilityCheckDto) { return this.avail.check(a.organizationId, dto); }
}
