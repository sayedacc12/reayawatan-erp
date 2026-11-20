import { Body, Controller, Delete, Get, HttpCode, Param, ParseIntPipe, ParseUUIDPipe, Post, Put, Query, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Response } from 'express';
import { memoryStorage } from 'multer';
import { CurrentOrgUser, OrgUser, RequireAnyPermission, RequirePermissions } from '../../core/auth/decorators';
import { MAX_UPLOAD_BYTES } from '../../core/files/file-store.service';
import {
  AmendmentDecisionDto, AmendmentDto, ContractDecisionDto, ContractDto, ContractEndDto, ContractListQueryDto, EvaluationCreateDto, EvaluationListQueryDto,
  EvaluationSettingsDto, EvaluationUpdateDto, KpiQueryDto, KpiReadingDto, PenaltyDecisionDto, PenaltyDto,
} from './contract.dto';
import { ContractsService } from './contracts.service';
import { EvaluationsService } from './evaluations.service';
import { InsightsService } from './insights.service';
import { sendFile } from './procurement.controller';
import { PROCUREMENT_PERMISSIONS as P } from './procurement.manifest';

const uuid = new ParseUUIDPipe();
const upload = FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 } });
const CT_READ = [P.contracts, P.contractsApprove, P.sourcing, P.approveOrders, P.approveOrdersHigh, P.invoices, P.suppliersRead, P.reports];
const EV_READ = [P.evaluations, P.evaluationsApprove, P.suppliersRead, P.reports, P.contracts];
const INSIGHTS = [P.reports, P.contracts, P.contractsApprove, P.evaluationsApprove, P.approveOrders, P.approveOrdersHigh];

/** عقود الموردين، وتقييم أدائهم، والرقابة والمخاطر ومؤشرات الأداء (المرحلة الخامسة) */
@Controller('procurement')
export class ContractsController {
  constructor(private readonly contracts: ContractsService, private readonly evaluations: EvaluationsService, private readonly insights: InsightsService) {}

  // ---------------- العقود ----------------

  @Get('contract-lookups') @RequireAnyPermission(...CT_READ)
  contractLookups(@CurrentOrgUser() a: OrgUser) { return this.contracts.lookups(a); }

  @Get('contracts') @RequireAnyPermission(...CT_READ)
  list(@CurrentOrgUser() a: OrgUser, @Query() q: ContractListQueryDto) { return this.contracts.list(a, q); }

  @Get('suppliers/:id/contracts') @RequireAnyPermission(...CT_READ)
  forSupplier(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string) { return this.contracts.forSupplier(a, id); }

  @Post('contracts') @HttpCode(200) @RequirePermissions(P.contracts)
  create(@CurrentOrgUser() a: OrgUser, @Body() dto: ContractDto) { return this.contracts.create(a, dto); }

  @Get('contracts/:id') @RequireAnyPermission(...CT_READ)
  get(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string) { return this.contracts.get(a, id); }

  @Put('contracts/:id') @RequirePermissions(P.contracts)
  update(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string, @Body() dto: ContractDto) { return this.contracts.update(a, id, dto); }

  @Post('contracts/:id/submit') @HttpCode(200) @RequirePermissions(P.contracts)
  submit(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string) { return this.contracts.submit(a, id); }

  @Post('contracts/:id/approve') @HttpCode(200) @RequirePermissions(P.contractsApprove)
  approve(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string, @Body() dto: ContractDecisionDto) { return this.contracts.decide(a, id, 'approve', dto.note ?? null); }

  @Post('contracts/:id/return') @HttpCode(200) @RequirePermissions(P.contractsApprove)
  returnContract(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string, @Body() dto: ContractDecisionDto) { return this.contracts.decide(a, id, 'return', dto.note ?? null); }

  @Post('contracts/:id/status') @HttpCode(200) @RequireAnyPermission(P.contracts, P.contractsApprove)
  end(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string, @Body() dto: ContractEndDto) { return this.contracts.end(a, id, dto); }

  @Post('contracts/:id/amendments') @HttpCode(200) @RequirePermissions(P.contracts)
  amend(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string, @Body() dto: AmendmentDto) { return this.contracts.amend(a, id, dto); }

  @Post('contracts/:id/amendments/:no/decide') @HttpCode(200) @RequirePermissions(P.contractsApprove)
  decideAmendment(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string, @Param('no', ParseIntPipe) no: number, @Body() dto: AmendmentDecisionDto) {
    return this.contracts.decideAmendment(a, id, no, dto);
  }

  @Post('contracts/:id/penalties') @HttpCode(200) @RequirePermissions(P.contracts)
  penalty(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string, @Body() dto: PenaltyDto) { return this.contracts.penalty(a, id, dto); }

  @Post('contracts/:id/penalties/:pid/decide') @HttpCode(200) @RequirePermissions(P.contractsApprove)
  decidePenalty(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string, @Param('pid', uuid) pid: string, @Body() dto: PenaltyDecisionDto) {
    return this.contracts.decidePenalty(a, id, pid, dto);
  }

  @Post('contracts/:id/kpis') @HttpCode(200) @RequirePermissions(P.contracts)
  kpi(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string, @Body() dto: KpiReadingDto) { return this.contracts.kpi(a, id, dto); }

  @Post('contracts/:id/guarantees/:key/release') @HttpCode(200) @RequirePermissions(P.contractsApprove)
  release(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string, @Param('key') key: string) { return this.contracts.releaseGuarantee(a, id, key); }

  @Post('contracts/:id/files') @HttpCode(200) @RequirePermissions(P.contracts) @UseInterceptors(upload)
  addFile(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string, @UploadedFile() file: Express.Multer.File) { return this.contracts.addFile(a, id, file); }

  @Delete('contracts/:id/files/:key') @RequirePermissions(P.contracts)
  removeFile(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string, @Param('key') key: string) { return this.contracts.removeFile(a, id, key); }

  @Get('contracts/:id/files/:key') @RequireAnyPermission(...CT_READ)
  async file(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string, @Param('key') key: string, @Res({ passthrough: true }) res: Response) {
    return sendFile(res, await this.contracts.file(a, id, key));
  }

  // ---------------- تقييم الموردين ----------------

  @Get('evaluation-lookups') @RequireAnyPermission(...EV_READ, P.settings)
  evalLookups(@CurrentOrgUser() a: OrgUser) { return this.evaluations.lookups(a); }

  @Put('evaluation-settings') @RequirePermissions(P.settings)
  evalSettings(@CurrentOrgUser() a: OrgUser, @Body() dto: EvaluationSettingsDto) { return this.evaluations.saveSettings(a, dto); }

  @Get('evaluations') @RequireAnyPermission(...EV_READ)
  evalList(@CurrentOrgUser() a: OrgUser, @Query() q: EvaluationListQueryDto) { return this.evaluations.list(a, q); }

  @Post('evaluations') @HttpCode(200) @RequirePermissions(P.evaluations)
  evalCreate(@CurrentOrgUser() a: OrgUser, @Body() dto: EvaluationCreateDto) { return this.evaluations.create(a, dto); }

  @Get('evaluations/:id') @RequireAnyPermission(...EV_READ)
  evalGet(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string) { return this.evaluations.get(a, id); }

  @Put('evaluations/:id') @RequirePermissions(P.evaluations)
  evalUpdate(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string, @Body() dto: EvaluationUpdateDto) { return this.evaluations.update(a, id, dto); }

  @Post('evaluations/:id/submit') @HttpCode(200) @RequirePermissions(P.evaluations)
  evalSubmit(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string) { return this.evaluations.submit(a, id); }

  @Post('evaluations/:id/approve') @HttpCode(200) @RequirePermissions(P.evaluationsApprove)
  evalApprove(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string, @Body() dto: ContractDecisionDto) { return this.evaluations.decide(a, id, 'approve', dto.note ?? null); }

  @Post('evaluations/:id/return') @HttpCode(200) @RequirePermissions(P.evaluationsApprove)
  evalReturn(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string, @Body() dto: ContractDecisionDto) { return this.evaluations.decide(a, id, 'return', dto.note ?? null); }

  // ---------------- الرقابة والمخاطر والأداء ----------------

  @Get('insights/risks') @RequireAnyPermission(...INSIGHTS)
  risks(@CurrentOrgUser() a: OrgUser) { return this.insights.risks(a); }

  @Get('insights/controls') @RequireAnyPermission(...INSIGHTS)
  controls(@CurrentOrgUser() a: OrgUser) { return this.insights.controls(a); }

  @Get('insights/kpis') @RequireAnyPermission(...INSIGHTS, P.read)
  kpis(@CurrentOrgUser() a: OrgUser, @Query() q: KpiQueryDto) { return this.insights.kpis(a, q); }
}
