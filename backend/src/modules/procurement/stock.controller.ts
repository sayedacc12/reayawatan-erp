import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import { CurrentOrgUser, OrgUser, RequireAnyPermission, RequirePermissions } from '../../core/auth/decorators';
import { COUNT_KINDS, COUNT_STATUS, INSPECTION_RESULTS, ISSUE_REQUEST_STATUS, LINE_TREATMENT, MOVE_KINDS, RECEIPT_KINDS, STOCK_DOC_KINDS, WRITEOFF_REASONS } from './entities/stock.entity';
import { CountsService } from './counts.service';
import { IssueRequestsService } from './issue-requests.service';
import { PROCUREMENT_PERMISSIONS as P } from './procurement.manifest';
import { ReceiptsService } from './receipts.service';
import { NoteDto, ReasonDto } from './sourcing.dto';
import { StockDocsService } from './stock-docs.service';
import { StockService } from './stock.service';
import { CountDto, CountLinesDto, IssueDto, IssueRequestDto, ReceiptDto, ReturnDto, StockSettingsDto, TransferDto, WriteoffDto } from './stock.dto';

const uuid = new ParseUUIDPipe();
const STOCK_READ = [P.stockOperate, P.stockApprove, P.read];
const ISR_READ = [P.issueRequest, P.issueApprove, P.stockOperate, P.read];

/** المستودعات: الاستلام والفحص، وأرصدة المخزون، وطلبات الصرف، والصرف والتحويل والمرتجعات والإتلاف، والجرد، والمطابقة مع الدليل */
@Controller('procurement')
export class StockController {
  constructor(
    private readonly receipts: ReceiptsService, private readonly docs: StockDocsService, private readonly issues: IssueRequestsService,
    private readonly counts: CountsService, private readonly stock: StockService,
  ) {}

  // ---------------- الإعدادات والقوائم ----------------

  @Get('stock-lookups') @RequireAnyPermission(...ISR_READ, P.settings, P.stockApprove)
  async lookups(@CurrentOrgUser() a: OrgUser) {
    return {
      ...(await this.stock.lookups(a.organizationId)),
      receiptKinds: RECEIPT_KINDS, inspectionResults: INSPECTION_RESULTS, treatments: LINE_TREATMENT, issueRequestStatus: ISSUE_REQUEST_STATUS,
      docKinds: STOCK_DOC_KINDS, writeoffReasons: WRITEOFF_REASONS, countKinds: COUNT_KINDS, countStatus: COUNT_STATUS, moveKinds: MOVE_KINDS,
    };
  }

  @Put('stock-settings') @RequirePermissions(P.settings)
  saveSettings(@CurrentOrgUser() a: OrgUser, @Body() dto: StockSettingsDto) {
    return this.stock.saveSettings(a, dto);
  }

  // ---------------- الأرصدة والمطابقة ----------------

  @Get('stock') @RequireAnyPermission(...STOCK_READ)
  balances(@CurrentOrgUser() a: OrgUser, @Query() q: Record<string, string>) {
    return this.stock.balances(a, q);
  }

  @Get('stock/summary') @RequireAnyPermission(...STOCK_READ)
  summary(@CurrentOrgUser() a: OrgUser) {
    return this.stock.summary(a);
  }

  @Get('stock/reconcile') @RequireAnyPermission(...STOCK_READ, P.settings)
  reconcile(@CurrentOrgUser() a: OrgUser, @Query('asOf') asOf?: string) {
    return this.stock.reconcile(a.organizationId, asOf);
  }

  @Get('stock/lots') @RequireAnyPermission(...ISR_READ)
  lots(@CurrentOrgUser() a: OrgUser, @Query('item', uuid) item: string, @Query('warehouse', uuid) warehouse: string) {
    return this.stock.lots(a, item, warehouse);
  }

  @Get('stock/items/:id') @RequireAnyPermission(...STOCK_READ)
  card(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string, @Query() q: Record<string, string>) {
    return this.stock.card(a, id, q);
  }

  // ---------------- الاستلام ----------------

  @Get('receipts') @RequireAnyPermission(...STOCK_READ)
  receiptList(@CurrentOrgUser() a: OrgUser, @Query() q: Record<string, string>) {
    return this.receipts.list(a, q);
  }

  @Get('receipts/receivable/:orderId') @RequireAnyPermission(P.stockOperate)
  receivable(@CurrentOrgUser() a: OrgUser, @Param('orderId', uuid) id: string) {
    return this.receipts.receivable(a, id);
  }

  @Get('receipts/:id') @RequireAnyPermission(...STOCK_READ)
  receipt(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string) {
    return this.receipts.get(a, id);
  }

  @Post('receipts') @RequirePermissions(P.stockOperate)
  receive(@CurrentOrgUser() a: OrgUser, @Body() dto: ReceiptDto) {
    return this.receipts.create(a, dto);
  }

  @Post('receipts/:id/cancel') @HttpCode(200) @RequirePermissions(P.stockApprove)
  cancelReceipt(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string, @Body() dto: ReasonDto) {
    return this.receipts.cancel(a, id, dto.reason);
  }

  @Post('orders/:id/short-close') @HttpCode(200) @RequireAnyPermission(P.sourcing, P.approveOrders, P.approveOrdersHigh)
  async shortClose(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string, @Body() dto: ReasonDto) {
    const o = await this.receipts.shortClose(a, id, dto.reason);
    return { id: o.id, status: o.status };
  }

  // ---------------- طلبات الصرف ----------------

  @Get('issue-requests') @RequireAnyPermission(...ISR_READ)
  issueList(@CurrentOrgUser() a: OrgUser, @Query() q: Record<string, string>) {
    return this.issues.list(a, q);
  }

  @Get('issue-requests/:id') @RequireAnyPermission(...ISR_READ)
  issueGet(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string) {
    return this.issues.get(a, id);
  }

  @Post('issue-requests') @RequirePermissions(P.issueRequest)
  issueCreate(@CurrentOrgUser() a: OrgUser, @Body() dto: IssueRequestDto, @Query('submit') submit?: string) {
    return this.issues.create(a, dto, submit === '1');
  }

  @Put('issue-requests/:id') @RequirePermissions(P.issueRequest)
  issueUpdate(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string, @Body() dto: IssueRequestDto) {
    return this.issues.update(a, id, dto);
  }

  @Post('issue-requests/:id/submit') @HttpCode(200) @RequirePermissions(P.issueRequest)
  issueSubmit(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string) {
    return this.issues.submit(a, id);
  }

  @Post('issue-requests/:id/approve') @HttpCode(200) @RequirePermissions(P.issueApprove)
  issueApprove(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string, @Body() dto: NoteDto) {
    return this.issues.decide(a, id, 'approve', dto.note ?? null);
  }

  @Post('issue-requests/:id/return') @HttpCode(200) @RequirePermissions(P.issueApprove)
  issueReturn(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string, @Body() dto: NoteDto) {
    return this.issues.decide(a, id, 'return', dto.note ?? null);
  }

  @Post('issue-requests/:id/reject') @HttpCode(200) @RequirePermissions(P.issueApprove)
  issueReject(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string, @Body() dto: NoteDto) {
    return this.issues.decide(a, id, 'reject', dto.note ?? null);
  }

  @Post('issue-requests/:id/cancel') @HttpCode(200) @RequireAnyPermission(P.issueRequest, P.issueApprove)
  issueCancel(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string, @Body() dto: ReasonDto) {
    return this.issues.cancel(a, id, dto.reason);
  }

  // ---------------- مستندات المخزون ----------------

  @Get('stock-docs') @RequireAnyPermission(...STOCK_READ)
  docList(@CurrentOrgUser() a: OrgUser, @Query() q: Record<string, string>) {
    return this.docs.list(a, q);
  }

  @Get('stock-docs/:id') @RequireAnyPermission(...STOCK_READ, P.issueRequest, P.issueApprove)
  docGet(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string) {
    return this.docs.get(a, id);
  }

  @Post('stock-docs/issue') @RequirePermissions(P.stockOperate)
  issue(@CurrentOrgUser() a: OrgUser, @Body() dto: IssueDto) {
    return this.docs.issue(a, dto);
  }

  @Post('stock-docs/transfer') @RequirePermissions(P.stockOperate)
  transfer(@CurrentOrgUser() a: OrgUser, @Body() dto: TransferDto) {
    return this.docs.transfer(a, dto);
  }

  @Post('stock-docs/return-supplier') @RequirePermissions(P.stockOperate)
  returnSupplier(@CurrentOrgUser() a: OrgUser, @Body() dto: ReturnDto) {
    return this.docs.returnToSupplier(a, dto);
  }

  @Post('stock-docs/return-in') @RequirePermissions(P.stockOperate)
  returnIn(@CurrentOrgUser() a: OrgUser, @Body() dto: ReturnDto) {
    return this.docs.returnIn(a, dto);
  }

  @Post('stock-docs/writeoff') @RequirePermissions(P.stockOperate)
  writeoff(@CurrentOrgUser() a: OrgUser, @Body() dto: WriteoffDto) {
    return this.docs.writeoff(a, dto);
  }

  @Post('stock-docs/:id/approve') @HttpCode(200) @RequirePermissions(P.stockApprove)
  approveDoc(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string, @Body() dto: NoteDto) {
    return this.docs.approveWriteoff(a, id, dto.note ?? null);
  }

  @Post('stock-docs/:id/reject') @HttpCode(200) @RequireAnyPermission(P.stockApprove, P.stockOperate)
  rejectDoc(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string, @Body() dto: ReasonDto) {
    return this.docs.rejectWriteoff(a, id, dto.reason);
  }

  // ---------------- الجرد ----------------

  @Get('counts') @RequireAnyPermission(...STOCK_READ)
  countList(@CurrentOrgUser() a: OrgUser, @Query() q: Record<string, string>) {
    return this.counts.list(a, q);
  }

  @Get('counts/:id') @RequireAnyPermission(...STOCK_READ)
  countGet(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string) {
    return this.counts.get(a, id);
  }

  @Post('counts') @RequirePermissions(P.stockOperate)
  countCreate(@CurrentOrgUser() a: OrgUser, @Body() dto: CountDto) {
    return this.counts.create(a, dto);
  }

  @Put('counts/:id/lines') @RequireAnyPermission(P.stockOperate, P.stockApprove)
  countLines(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string, @Body() dto: CountLinesDto) {
    return this.counts.saveLines(a, id, dto);
  }

  @Post('counts/:id/submit') @HttpCode(200) @RequireAnyPermission(P.stockOperate, P.stockApprove)
  countSubmit(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string) {
    return this.counts.submit(a, id);
  }

  @Post('counts/:id/approve') @HttpCode(200) @RequirePermissions(P.stockApprove)
  countApprove(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string, @Body() dto: NoteDto) {
    return this.counts.approve(a, id, dto.note ?? null);
  }

  @Post('counts/:id/return') @HttpCode(200) @RequirePermissions(P.stockApprove)
  countReturn(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string, @Body() dto: ReasonDto) {
    return this.counts.returnCount(a, id, dto.reason);
  }

  @Post('counts/:id/cancel') @HttpCode(200) @RequireAnyPermission(P.stockOperate, P.stockApprove)
  countCancel(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string, @Body() dto: ReasonDto) {
    return this.counts.cancel(a, id, dto.reason);
  }
}
