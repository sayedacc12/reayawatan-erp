import { BadRequestException, Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put, Query } from '@nestjs/common';
import { CurrentOrgUser, OrgUser, RequireAnyPermission, RequirePermissions } from '../../core/auth/decorators';
import { isTypeCode, today } from './acc-core.service';
import {
  AccountDto, AccountUpdateDto, AnalyticDto, AnalyticUpdateDto, BatchPostDto, CashAccountDto, CategoryDto, EntryDto, EntryUpdateDto,
  InventoryDto, MonthDto, MonthsDto, DocumentTypeDto, PartnerDto, ReasonDto, RequestDecisionDto, SequencesDto, SettingsDto, SetupDto, SetupUpdateDto,
  VoucherDecisionDto, VoucherDto, VoucherRequestDto, VoucherStagesDto,
} from './accounting.dto';
import { ACC_PERMISSIONS as P } from './accounting.manifest';
import { AccountsService } from './accounts.service';
import { EntryStatus, VoucherKind, VoucherStatus } from './entities/accounting.entity';
import { EntriesService } from './entries.service';
import { InventoryService } from './inventory.service';
import { MastersService } from './masters.service';
import { ReportsService } from './reports.service';
import { SetupService } from './setup.service';
import { VouchersService } from './vouchers.service';

const uuid = new ParseUUIDPipe();
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const date = (v: string | undefined, fallback: string) => {
  if (!v) return fallback;
  if (!DATE.test(v)) throw new BadRequestException('التاريخ غير صحيح');
  return v;
};
const kindOf = (k: string): VoucherKind => {
  if (k !== 'receipt' && k !== 'payment') throw new BadRequestException('نوع السند غير صحيح');
  return k;
};

/** النظام المالي: الافتتاحيات، الدليل والتحليلي، البيانات الأساسية، القيود والترحيل، السندات، المحضر، التقارير */
@Controller('accounting')
export class AccountingController {
  constructor(
    private readonly setup: SetupService,
    private readonly accounts: AccountsService,
    private readonly masters: MastersService,
    private readonly entries: EntriesService,
    private readonly vouchers: VouchersService,
    private readonly inventory: InventoryService,
    private readonly reports: ReportsService,
  ) {}

  // ---------------- اللوحة والافتتاحيات ----------------

  @Get('dashboard')
  @RequirePermissions(P.read)
  dashboard(@CurrentOrgUser() actor: OrgUser) {
    return this.reports.dashboard(actor);
  }

  @Get('setup')
  @RequireAnyPermission(P.read, P.setup, P.closePeriods, P.reopenPeriods)
  overview(@CurrentOrgUser() actor: OrgUser) {
    return this.setup.overview(actor);
  }

  @Post('setup')
  @RequirePermissions(P.setup)
  doSetup(@CurrentOrgUser() actor: OrgUser, @Body() dto: SetupDto) {
    return this.setup.setup(actor, dto);
  }

  @Patch('setup')
  @RequirePermissions(P.setup)
  updateBasics(@CurrentOrgUser() actor: OrgUser, @Body() dto: SetupUpdateDto) {
    return this.setup.updateBasics(actor, dto);
  }

  @Put('years/:id/sequences')
  @RequirePermissions(P.setup)
  sequences(@CurrentOrgUser() actor: OrgUser, @Param('id', uuid) id: string, @Body() dto: SequencesDto) {
    return this.setup.saveSequences(actor, id, dto);
  }

  @Post('years/next')
  @RequirePermissions(P.setup)
  openNext(@CurrentOrgUser() actor: OrgUser) {
    return this.setup.openNextYear(actor);
  }

  @Post('years/:id/refresh-opening')
  @RequirePermissions(P.setup)
  refreshOpening(@CurrentOrgUser() actor: OrgUser, @Param('id', uuid) id: string) {
    return this.setup.refreshOpening(actor, id);
  }

  @Post('years/:id/close')
  @RequirePermissions(P.closePeriods)
  closeYear(@CurrentOrgUser() actor: OrgUser, @Param('id', uuid) id: string) {
    return this.setup.closeYear(actor, id);
  }

  @Post('years/:id/reopen')
  @RequirePermissions(P.reopenPeriods)
  reopenYear(@CurrentOrgUser() actor: OrgUser, @Param('id', uuid) id: string) {
    return this.setup.reopenYear(actor, id);
  }

  @Post('months/close')
  @RequirePermissions(P.closePeriods)
  closeMonth(@CurrentOrgUser() actor: OrgUser, @Body() dto: MonthDto) {
    return this.setup.closeMonth(actor, dto.fiscalYearId, dto.month);
  }

  @Post('months/reopen')
  @RequirePermissions(P.reopenPeriods)
  reopenMonth(@CurrentOrgUser() actor: OrgUser, @Body() dto: MonthDto) {
    return this.setup.reopenMonth(actor, dto.fiscalYearId, dto.month);
  }

  @Get('periods/:yearId')
  @RequireAnyPermission(P.closePeriods, P.reopenPeriods, P.post, P.read)
  periods(@CurrentOrgUser() actor: OrgUser, @Param('yearId', uuid) id: string) {
    return this.setup.periods(actor, id);
  }

  @Post('periods/close')
  @RequirePermissions(P.closePeriods)
  closeMonths(@CurrentOrgUser() actor: OrgUser, @Body() dto: MonthsDto) {
    return this.setup.closeMonths(actor, dto.fiscalYearId, dto.months);
  }

  @Post('periods/reopen')
  @RequirePermissions(P.reopenPeriods)
  reopenMonths(@CurrentOrgUser() actor: OrgUser, @Body() dto: MonthsDto) {
    return this.setup.reopenMonths(actor, dto.fiscalYearId, dto.months);
  }

  // ---------------- الإعدادات ----------------

  @Get('settings')
  @RequirePermissions(P.read)
  settings(@CurrentOrgUser() actor: OrgUser) {
    return this.masters.getSettings(actor);
  }

  @Patch('settings')
  @RequirePermissions(P.settings)
  async saveSettings(@CurrentOrgUser() actor: OrgUser, @Body() dto: SettingsDto) {
    return this.masters.saveSettings(actor, dto);
  }

  @Get('chart')
  @RequirePermissions(P.read)
  chartInfo(@CurrentOrgUser() actor: OrgUser) {
    return this.accounts.chartInfo(actor);
  }

  @Post('chart/install')
  @RequirePermissions(P.settings)
  installChart(@CurrentOrgUser() actor: OrgUser) {
    return this.accounts.installChart(actor);
  }

  // ---------------- أنواع السندات الخاصة بالشركة ----------------

  @Get('document-types')
  @RequirePermissions(P.read)
  documentTypes(@CurrentOrgUser() actor: OrgUser) {
    return this.masters.listDocumentTypes(actor);
  }

  @Post('document-types')
  @RequirePermissions(P.settings)
  createDocumentType(@CurrentOrgUser() actor: OrgUser, @Body() dto: DocumentTypeDto) {
    return this.masters.createDocumentType(actor, dto);
  }

  @Patch('document-types/:id')
  @RequirePermissions(P.settings)
  updateDocumentType(@CurrentOrgUser() actor: OrgUser, @Param('id', uuid) id: string, @Body() dto: DocumentTypeDto) {
    return this.masters.updateDocumentType(actor, id, dto);
  }

  @Delete('document-types/:id')
  @HttpCode(204)
  @RequirePermissions(P.settings)
  async removeDocumentType(@CurrentOrgUser() actor: OrgUser, @Param('id', uuid) id: string) {
    await this.masters.removeDocumentType(actor, id);
  }

  @Get('categories')
  @RequirePermissions(P.read)
  categories(@CurrentOrgUser() actor: OrgUser) {
    return this.masters.listCategories(actor);
  }

  @Post('categories')
  @RequirePermissions(P.settings)
  createCategory(@CurrentOrgUser() actor: OrgUser, @Body() dto: CategoryDto) {
    return this.masters.createCategory(actor, dto);
  }

  @Patch('categories/:id')
  @RequirePermissions(P.settings)
  updateCategory(@CurrentOrgUser() actor: OrgUser, @Param('id', uuid) id: string, @Body() dto: CategoryDto) {
    return this.masters.updateCategory(actor, id, dto);
  }

  @Delete('categories/:id')
  @HttpCode(204)
  @RequirePermissions(P.settings)
  async removeCategory(@CurrentOrgUser() actor: OrgUser, @Param('id', uuid) id: string) {
    await this.masters.removeCategory(actor, id);
  }

  @Get('voucher-stages/:kind')
  @RequireAnyPermission(P.read, P.settings)
  stages(@CurrentOrgUser() actor: OrgUser, @Param('kind') kind: string) {
    return this.vouchers.listStages(actor, kindOf(kind));
  }

  @Put('voucher-stages/:kind')
  @RequirePermissions(P.settings)
  saveStages(@CurrentOrgUser() actor: OrgUser, @Param('kind') kind: string, @Body() dto: VoucherStagesDto) {
    return this.vouchers.saveStages(actor, kindOf(kind), dto);
  }

  // ---------------- الدليل والتحليلي ----------------

  @Get('accounts')
  @RequirePermissions(P.read)
  listAccounts(@CurrentOrgUser() actor: OrgUser) {
    return this.accounts.list(actor);
  }

  @Post('accounts')
  @RequirePermissions(P.accounts)
  createAccount(@CurrentOrgUser() actor: OrgUser, @Body() dto: AccountDto) {
    return this.accounts.create(actor, dto);
  }

  @Patch('accounts/:id')
  @RequirePermissions(P.accounts)
  updateAccount(@CurrentOrgUser() actor: OrgUser, @Param('id', uuid) id: string, @Body() dto: AccountUpdateDto) {
    return this.accounts.update(actor, id, dto);
  }

  @Delete('accounts/:id')
  @HttpCode(204)
  @RequirePermissions(P.accounts)
  async removeAccount(@CurrentOrgUser() actor: OrgUser, @Param('id', uuid) id: string) {
    await this.accounts.remove(actor, id);
  }

  @Get('analytic')
  @RequirePermissions(P.read)
  listAnalytic(@CurrentOrgUser() actor: OrgUser) {
    return this.accounts.listAnalytic(actor);
  }

  @Post('analytic')
  @RequirePermissions(P.accounts)
  createAnalytic(@CurrentOrgUser() actor: OrgUser, @Body() dto: AnalyticDto) {
    return this.accounts.createAnalytic(actor, dto);
  }

  @Patch('analytic/:id')
  @RequirePermissions(P.accounts)
  updateAnalytic(@CurrentOrgUser() actor: OrgUser, @Param('id', uuid) id: string, @Body() dto: AnalyticUpdateDto) {
    return this.accounts.updateAnalytic(actor, id, dto);
  }

  @Delete('analytic/:id')
  @HttpCode(204)
  @RequirePermissions(P.accounts)
  async removeAnalytic(@CurrentOrgUser() actor: OrgUser, @Param('id', uuid) id: string) {
    await this.accounts.removeAnalytic(actor, id);
  }

  // ---------------- الشركاء والبنوك والمستودعات ----------------

  @Get('partners')
  @RequirePermissions(P.read)
  partners(@CurrentOrgUser() actor: OrgUser) {
    return this.masters.listPartners(actor);
  }

  @Post('partners')
  @RequirePermissions(P.partners)
  createPartner(@CurrentOrgUser() actor: OrgUser, @Body() dto: PartnerDto) {
    return this.masters.createPartner(actor, dto);
  }

  @Patch('partners/:id')
  @RequirePermissions(P.partners)
  updatePartner(@CurrentOrgUser() actor: OrgUser, @Param('id', uuid) id: string, @Body() dto: PartnerDto) {
    return this.masters.updatePartner(actor, id, dto);
  }

  @Get('cash-accounts')
  @RequirePermissions(P.read)
  cash(@CurrentOrgUser() actor: OrgUser) {
    return this.masters.listCash(actor);
  }

  @Post('cash-accounts')
  @RequirePermissions(P.banks)
  createCash(@CurrentOrgUser() actor: OrgUser, @Body() dto: CashAccountDto) {
    return this.masters.createCash(actor, dto);
  }

  @Patch('cash-accounts/:id')
  @RequirePermissions(P.banks)
  updateCash(@CurrentOrgUser() actor: OrgUser, @Param('id', uuid) id: string, @Body() dto: CashAccountDto) {
    return this.masters.updateCash(actor, id, dto);
  }

  // ---------------- القيود والترحيل ----------------

  @Get('entries')
  @RequirePermissions(P.read)
  listEntries(
    @CurrentOrgUser() actor: OrgUser, @Query('status') status?: string, @Query('type') type?: string, @Query('from') from?: string,
    @Query('to') to?: string, @Query('q') q?: string, @Query('year') year?: string,
  ) {
    return this.entries.list(actor, {
      status: ['draft', 'posted', 'cancelled'].includes(status ?? '') ? (status as EntryStatus) : undefined,
      voucherType: type && isTypeCode(type) ? type : undefined,
      dateFrom: from ? date(from, '') : undefined, dateTo: to ? date(to, '') : undefined, q: q || undefined,
      fiscalYearId: year && /^[0-9a-f-]{36}$/i.test(year) ? year : undefined,
    });
  }

  @Get('entries/:id')
  @RequirePermissions(P.read)
  getEntry(@CurrentOrgUser() actor: OrgUser, @Param('id', uuid) id: string) {
    return this.entries.get(actor, id);
  }

  @Post('entries')
  @RequirePermissions(P.entries)
  createEntry(@CurrentOrgUser() actor: OrgUser, @Body() dto: EntryDto) {
    return this.entries.create(actor, dto);
  }

  @Put('entries/:id')
  @RequirePermissions(P.entries)
  updateEntry(@CurrentOrgUser() actor: OrgUser, @Param('id', uuid) id: string, @Body() dto: EntryUpdateDto) {
    return this.entries.update(actor, id, dto);
  }

  @Post('entries/:id/post')
  @RequirePermissions(P.post)
  postEntry(@CurrentOrgUser() actor: OrgUser, @Param('id', uuid) id: string) {
    return this.entries.post(actor, id);
  }

  @Post('entries/:id/unpost')
  @RequirePermissions(P.unpost)
  unpostEntry(@CurrentOrgUser() actor: OrgUser, @Param('id', uuid) id: string) {
    return this.entries.unpost(actor, id);
  }

  @Post('entries/:id/cancel')
  @RequirePermissions(P.cancel)
  cancelEntry(@CurrentOrgUser() actor: OrgUser, @Param('id', uuid) id: string, @Body() dto: ReasonDto) {
    return this.entries.cancel(actor, id, dto.reason);
  }

  @Post('posting/batch')
  @RequirePermissions(P.post)
  batchPost(@CurrentOrgUser() actor: OrgUser, @Body() dto: BatchPostDto) {
    return this.entries.batchPost(actor, dto);
  }

  // ---------------- سندات القبض والصرف ----------------

  @Get('vouchers/:kind')
  @RequirePermissions(P.read)
  listVouchers(
    @CurrentOrgUser() actor: OrgUser, @Param('kind') kind: string, @Query('status') status?: string, @Query('q') q?: string,
    @Query('from') from?: string, @Query('to') to?: string, @Query('mine') mine?: string,
  ) {
    return this.vouchers.list(actor, kindOf(kind), {
      status: ['draft', 'pending', 'returned', 'approved', 'rejected', 'cancelled'].includes(status ?? '') ? (status as VoucherStatus) : undefined,
      q: q || undefined, dateFrom: from ? date(from, '') : undefined, dateTo: to ? date(to, '') : undefined, mine: mine === '1',
    });
  }

  @Get('voucher/:id')
  @RequirePermissions(P.read)
  getVoucher(@CurrentOrgUser() actor: OrgUser, @Param('id', uuid) id: string) {
    return this.vouchers.get(actor, id);
  }

  @Post('vouchers/:kind')
  @RequireAnyPermission(P.receipts, P.payments)
  createVoucher(@CurrentOrgUser() actor: OrgUser, @Param('kind') kind: string, @Body() dto: VoucherDto) {
    return this.vouchers.create(actor, kindOf(kind), dto);
  }

  @Put('voucher/:id')
  @RequireAnyPermission(P.receipts, P.payments)
  updateVoucher(@CurrentOrgUser() actor: OrgUser, @Param('id', uuid) id: string, @Body() dto: VoucherDto) {
    return this.vouchers.update(actor, id, dto);
  }

  @Post('voucher/:id/submit')
  @RequireAnyPermission(P.receipts, P.payments)
  submitVoucher(@CurrentOrgUser() actor: OrgUser, @Param('id', uuid) id: string) {
    return this.vouchers.submit(actor, id);
  }

  @Post('voucher/:id/decide')
  @RequirePermissions(P.approveVouchers)
  decideVoucher(@CurrentOrgUser() actor: OrgUser, @Param('id', uuid) id: string, @Body() dto: VoucherDecisionDto) {
    return this.vouchers.decide(actor, id, dto);
  }

  @Post('voucher/:id/request')
  @RequireAnyPermission(P.receipts, P.payments, P.cancel, P.approveVouchers)
  requestVoucher(@CurrentOrgUser() actor: OrgUser, @Param('id', uuid) id: string, @Body() dto: VoucherRequestDto) {
    return this.vouchers.request(actor, id, dto);
  }

  @Post('voucher/:id/request/decide')
  @RequirePermissions(P.approveReceiptCancel)
  decideRequest(@CurrentOrgUser() actor: OrgUser, @Param('id', uuid) id: string, @Body() dto: RequestDecisionDto) {
    return this.vouchers.decideRequest(actor, id, dto);
  }

  // ---------------- محضر جرد السندات ----------------

  @Get('inventory/:yearId')
  @RequirePermissions(P.read)
  getInventory(@CurrentOrgUser() actor: OrgUser, @Param('yearId', uuid) yearId: string) {
    return this.inventory.get(actor, yearId);
  }

  @Post('inventory/prepare')
  @RequireAnyPermission(P.closePeriods, P.setup)
  prepareInventory(@CurrentOrgUser() actor: OrgUser, @Body() dto: InventoryDto) {
    return this.inventory.prepare(actor, dto.fiscalYearId, dto.notes ?? null);
  }

  @Post('inventory/:yearId/approve')
  approveInventory(@CurrentOrgUser() actor: OrgUser, @Param('yearId', uuid) yearId: string) {
    return this.inventory.approve(actor, yearId);
  }

  @Post('inventory/:yearId/revoke')
  revokeInventory(@CurrentOrgUser() actor: OrgUser, @Param('yearId', uuid) yearId: string) {
    return this.inventory.revoke(actor, yearId);
  }

  // ---------------- التقارير ----------------

  @Get('reports')
  @RequirePermissions(P.reports)
  catalog() {
    return this.reports.catalog();
  }

  @Get('reports/trial-balance')
  @RequirePermissions(P.reports)
  trialBalance(@CurrentOrgUser() actor: OrgUser, @Query('from') from?: string, @Query('to') to?: string, @Query('level') level?: string) {
    const t = today();
    return this.reports.trialBalance(actor, date(from, `${t.slice(0, 4)}-01-01`), date(to, t), Math.min(Math.max(Number(level) || 9, 1), 9));
  }

  @Get('reports/ledger/:accountId')
  @RequirePermissions(P.reports)
  ledger(@CurrentOrgUser() actor: OrgUser, @Param('accountId', uuid) id: string, @Query('from') from?: string, @Query('to') to?: string) {
    const t = today();
    return this.reports.ledger(actor, id, date(from, `${t.slice(0, 4)}-01-01`), date(to, t));
  }

  @Get('reports/partner/:partnerId')
  @RequirePermissions(P.reports)
  partner(@CurrentOrgUser() actor: OrgUser, @Param('partnerId', uuid) id: string, @Query('from') from?: string, @Query('to') to?: string) {
    const t = today();
    return this.reports.partnerStatement(actor, id, date(from, `${t.slice(0, 4)}-01-01`), date(to, t));
  }
}
