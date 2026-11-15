import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CurrentOrgUser, OrgUser, RequireAnyPermission, RequirePermissions } from '../../core/auth/decorators';
import { ProjectSettings } from './entities';
import { REPORTS, InsightsService } from './insights.service';
import { PROJECT_PERMISSIONS as P } from './projects.manifest';
import { AccountingDto, AllocateDto, AllocateSplitDto, AmendmentDto, DirectPaymentDto, ExecutePaymentDto, GeneralDisbursementDto, PaymentRequestDto, ReasonDto, TransferDto } from './support.dto';
import { SupportService } from './support.service';
import { TransfersService } from './transfers.service';

const uuid = new ParseUUIDPipe();
const optUuid = new ParseUUIDPipe({ optional: true });

/** إدارة الدعم، الصرف المالي، المناقلات، تعديل فرص التبرع، التقارير، والتوجيه المحاسبي */
@Controller('projects-ops')
export class SupportController {
  constructor(
    private readonly support: SupportService,
    private readonly transfers: TransfersService,
    private readonly insights: InsightsService,
    @InjectRepository(ProjectSettings) private readonly settings: Repository<ProjectSettings>,
  ) {}

  // ---- إدارة الدعم ----
  @Get('support/queue')
  @RequirePermissions(P.support)
  queue(@CurrentOrgUser() actor: OrgUser) {
    return this.support.queue(actor);
  }

  @Get('support/requests/:id/options')
  @RequirePermissions(P.support)
  options(@CurrentOrgUser() actor: OrgUser, @Param('id', uuid) id: string, @Query('amount') amount?: string) {
    return this.support.optionsForRequest(actor, id, amount ? Number(amount) : undefined);
  }

  @Get('support/projects/:id/batches')
  @RequireAnyPermission(P.support, P.transfers, P.amendments, P.read)
  projectBatches(@CurrentOrgUser() actor: OrgUser, @Param('id', uuid) id: string) {
    return this.support.batchesForProject(actor, id);
  }

  @Get('support/allocations')
  @RequireAnyPermission(P.support, P.disburse)
  allocations(@CurrentOrgUser() actor: OrgUser, @Query('activityId', optUuid) activityId?: string, @Query('status') status?: string) {
    return this.support.allocations(actor, { activityId, status });
  }

  @Post('support/allocate')
  @RequirePermissions(P.support)
  allocate(@CurrentOrgUser() actor: OrgUser, @Body() dto: AllocateDto) {
    return this.support.allocate(actor, dto);
  }

  @Post('support/allocate-split')
  @RequirePermissions(P.support)
  allocateSplit(@CurrentOrgUser() actor: OrgUser, @Body() dto: AllocateSplitDto) {
    return this.support.allocateSplit(actor, dto);
  }

  @Post('support/general')
  @RequirePermissions(P.support)
  general(@CurrentOrgUser() actor: OrgUser, @Body() dto: GeneralDisbursementDto) {
    return this.support.generalDisbursement(actor, dto);
  }

  @Post('support/allocations/:id/release')
  @HttpCode(200)
  @RequirePermissions(P.support)
  release(@CurrentOrgUser() actor: OrgUser, @Param('id', uuid) id: string, @Body() dto: ReasonDto) {
    return this.support.release(actor, id, dto);
  }

  // ---- طلبات الصرف والصرف المالي ----
  @Get('payments')
  @RequireAnyPermission(P.support, P.disburse)
  payments(@CurrentOrgUser() actor: OrgUser, @Query('status') status?: string, @Query('activityId', optUuid) activityId?: string) {
    return this.support.payments(actor, { status, activityId });
  }

  @Post('payments')
  @RequirePermissions(P.support)
  requestPayment(@CurrentOrgUser() actor: OrgUser, @Body() dto: PaymentRequestDto) {
    return this.support.requestPayment(actor, dto);
  }

  @Post('payments/direct')
  @RequirePermissions(P.disburse)
  direct(@CurrentOrgUser() actor: OrgUser, @Body() dto: DirectPaymentDto) {
    return this.support.direct(actor, dto);
  }

  @Post('payments/:id/execute')
  @HttpCode(200)
  @RequirePermissions(P.disburse)
  execute(@CurrentOrgUser() actor: OrgUser, @Param('id', uuid) id: string, @Body() dto: ExecutePaymentDto) {
    return this.support.execute(actor, id, dto);
  }

  @Post('payments/:id/reject')
  @HttpCode(200)
  @RequirePermissions(P.disburse)
  reject(@CurrentOrgUser() actor: OrgUser, @Param('id', uuid) id: string, @Body() dto: ReasonDto) {
    return this.support.rejectPayment(actor, id, dto);
  }

  // ---- المناقلات ----
  @Get('transfers')
  @RequireAnyPermission(P.transfers, P.read)
  listTransfers(@CurrentOrgUser() actor: OrgUser) {
    return this.transfers.listTransfers(actor);
  }

  @Get('transfers/targets/:batchId')
  @RequireAnyPermission(P.transfers, P.amendments)
  targets(@CurrentOrgUser() actor: OrgUser, @Param('batchId', uuid) batchId: string) {
    return this.transfers.targets(actor, batchId);
  }

  @Post('transfers')
  @RequirePermissions(P.transfers)
  transfer(@CurrentOrgUser() actor: OrgUser, @Body() dto: TransferDto) {
    return this.transfers.transfer(actor, dto);
  }

  // ---- تعديل فرص التبرع ----
  @Get('amendments')
  @RequireAnyPermission(P.amendments, P.read)
  amendments(@CurrentOrgUser() actor: OrgUser) {
    return this.transfers.listAmendments(actor);
  }

  @Post('amendments')
  @RequirePermissions(P.amendments)
  amend(@CurrentOrgUser() actor: OrgUser, @Body() dto: AmendmentDto) {
    return this.transfers.amend(actor, dto);
  }

  // ---- التقارير ----
  @Get('reports')
  @RequirePermissions(P.reports)
  reports() {
    return REPORTS;
  }

  @Get('reports/:key')
  @RequirePermissions(P.reports)
  report(@CurrentOrgUser() actor: OrgUser, @Param('key') key: string, @Query('from') from?: string, @Query('to') to?: string) {
    const date = (d?: string) => (d && /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : undefined);
    return this.insights.report(actor, key, date(from), date(to));
  }

  // ---- التوجيه المحاسبي ----
  @Get('settings/accounting')
  @RequirePermissions(P.settings)
  async accounting(@CurrentOrgUser() actor: OrgUser) {
    return (await this.settings.findOne({ where: { organizationId: actor.organizationId } })) ?? { organizationId: actor.organizationId };
  }

  @Put('settings/accounting')
  @RequirePermissions(P.settings)
  saveAccounting(@CurrentOrgUser() actor: OrgUser, @Body() dto: AccountingDto) {
    return this.settings.save({ organizationId: actor.organizationId, ...dto });
  }
}
