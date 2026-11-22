import { BadRequestException, Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Query, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import { memoryStorage } from 'multer';
import { IMPORT_FILE_BYTES } from '../../../core/files/xlsx-sheets';
import { BudgetImportService } from './budget-import.service';
import { CurrentOrgUser, OrgUser, RequireAnyPermission, RequirePermissions } from '../../../core/auth/decorators';
import { DecideDto, SubmitDto } from '../planning.dto';
import { PLANNING_PERMISSIONS as P } from '../planning.manifest';
import { BudgetAvailability } from './budget-availability.service';
import { BudgetExecution, ExecMethod } from './budget-execution.service';
import { AvailabilityCheckDto, BudgetDto, FormulaDto, ImportDto, LineDto, LineMappingDto, PromoteDto, TransferDto, ScenarioDto, TestFormulaDto, UpdateBudgetDto, UpdateFormulaDto, UpdateLineDto } from './budget.dto';
import { BudgetsService } from './budgets.service';
import { FormulasService } from './formulas.service';
import { ScenariosService } from './scenarios.service';

const uuid = new ParseUUIDPipe();
const ver = (v: string) => {
  if (!/^\d{1,4}$/.test(v)) throw new BadRequestException('رقم الإصدار غير صحيح');
  return Number(v);
};
const READ = [P.read, P.budgets];

/** الموازنات التقديرية ومكتبة المعادلات و«المتاح» للصرف */
@Controller('planning')
export class BudgetController {
  constructor(
    private readonly budgets: BudgetsService, private readonly formulas: FormulasService, private readonly avail: BudgetAvailability, private readonly scenarios: ScenariosService,
    private readonly exec: BudgetExecution, private readonly lineImport: BudgetImportService,
  ) {}

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

  @Get('budget-lines/import/template') @RequirePermissions(P.budgets)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  async linesTemplate(@Res() res: Response) {
    const buf = await this.lineImport.template();
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="budget-lines-import.xlsx"; filename*=UTF-8''${encodeURIComponent('نموذج استيراد بنود الموازنة.xlsx')}`);
    res.send(buf);
  }

  /** mode=check يحتسب البنود ويعرضها دون حفظ، وmode=apply يحفظها كلها أو لا شيء */
  @Post('budgets/:id/lines/import') @RequirePermissions(P.budgets)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: IMPORT_FILE_BYTES, files: 1 } }))
  importLinesFile(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string, @UploadedFile() file: Express.Multer.File, @Body('mode') mode?: string) {
    return this.lineImport.import(a, id, file, mode ?? 'check');
  }

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

  // ---------------- السيناريوهات ----------------

  @Get('budgets/:id/scenarios') @RequireAnyPermission(...READ)
  listScenarios(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string) { return this.scenarios.list(a, id); }

  @Post('budgets/:id/scenarios') @RequirePermissions(P.budgets)
  createScenario(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string, @Body() dto: ScenarioDto) { return this.scenarios.create(a, id, dto); }

  @Get('budgets/:id/scenarios/compare') @RequireAnyPermission(...READ)
  compareScenarios(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string, @Query('ids') ids?: string) {
    const list = (ids ?? '').split(',').map((x) => x.trim()).filter(Boolean);
    if (list.some((x) => !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(x))) throw new BadRequestException('أرقام السيناريوهات غير صحيحة');
    return this.scenarios.compare(a, id, list);
  }

  @Get('budgets/:id/sensitivity') @RequireAnyPermission(...READ)
  sensitivity(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string, @Query('step') step?: string) {
    return this.scenarios.sensitivity(a, id, step && /^\d{1,2}$/.test(step) ? Number(step) : 10);
  }

  @Post('scenarios/:id/promote') @RequirePermissions(P.budgets)
  promote(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string, @Body() dto: PromoteDto) { return this.scenarios.promote(a, id, dto); }

  // ---------------- التنفيذ والمناقلات ----------------

  @Get('budgets/:id/execution') @RequireAnyPermission(...READ)
  execution(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string, @Query() q: Record<string, string>) {
    return this.exec.execution(a, id, {
      month: q.month && /^\d{1,2}$/.test(q.month) ? Number(q.month) : undefined, method: q.method as ExecMethod,
      threshold: q.threshold && /^\d{1,3}$/.test(q.threshold) ? Number(q.threshold) : undefined,
    });
  }

  @Get('budgets/:id/execution/trace') @RequireAnyPermission(...READ)
  trace(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string, @Query('key') key: string, @Query('month') month?: string) {
    if (key !== 'hr:group' && !/^[0-9a-f-]{36}$/i.test(key ?? '')) throw new BadRequestException('البند غير صحيح');
    return this.exec.trace(a, id, key, month && /^\d{1,2}$/.test(month) ? Number(month) : undefined);
  }

  @Patch('budget-lines/:id/mapping') @RequirePermissions(P.budgets)
  mapping(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string, @Body() dto: LineMappingDto) { return this.exec.map(a, id, dto); }

  @Post('budgets/:id/transfers/preview') @RequirePermissions(P.budgets)
  previewTransfer(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string, @Body() dto: TransferDto) { return this.exec.preview(a, id, dto); }

  @Post('budgets/:id/transfers') @RequirePermissions(P.budgets)
  requestTransfer(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string, @Body() dto: TransferDto) { return this.exec.request(a, id, dto); }

  @Post('budget-transfers/:id/decision') @RequirePermissions(P.budgetsApprove)
  decideTransfer(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string, @Body() dto: DecideDto) { return this.exec.decide(a, id, dto); }

  @Delete('budget-transfers/:id') @RequirePermissions(P.budgets)
  cancelTransfer(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string) { return this.exec.cancel(a, id); }

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
