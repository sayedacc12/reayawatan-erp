import {
  BadRequestException, Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Put, Query, Res, UploadedFile, UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Response } from 'express';
import { memoryStorage } from 'multer';
import { DataSource } from 'typeorm';
import { CurrentOrgUser, OrgUser, RequireAnyPermission, RequirePermissions } from '../../core/auth/decorators';
import { MAX_UPLOAD_BYTES } from '../../core/files/file-store.service';
import { PrSettings } from './entities/procurement.entity';
import { OrdersService } from './orders.service';
import { sendFile } from './procurement.controller';
import { PROCUREMENT_PERMISSIONS as P } from './procurement.manifest';
import { ProcurementCore } from './procurement-core.service';
import { RequestsService } from './requests.service';
import { RfqsService } from './rfqs.service';
import { SourcingCore } from './sourcing-core.service';
import {
  AmendDto, AnswerDto, BudgetCheckDto, ExtendDto, NegotiateDto, NoteDto, OrderDto, PublishDto, ReasonDto, RecommendDto, RequestDto, RfqDto, ScoreDto,
  SourcingSettingsDto, StaffQuoteDto, SubmitRequestDto,
} from './sourcing.dto';

const uuid = new ParseUUIDPipe();
const upload = FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 } });
const REQ_READ = [P.requests, P.approveRequests, P.sourcing, P.approveOrders, P.approveOrdersHigh];
const RFQ_READ = [P.sourcing, P.evaluate, P.approveOrders, P.approveOrdersHigh];
const ORD_READ = [P.sourcing, P.approveOrders, P.approveOrdersHigh, P.read, P.stockOperate, P.stockApprove];
const ORD_APPROVE = [P.approveOrders, P.approveOrdersHigh];

/** المشتريات: طلبات الشراء، والمنافسات والعروض والتقييم والترسية، والتعميدات واعتمادها */
@Controller('procurement')
export class SourcingController {
  constructor(
    private readonly db: DataSource, private readonly core: ProcurementCore, private readonly sc: SourcingCore,
    private readonly requests: RequestsService, private readonly rfqs: RfqsService, private readonly orders: OrdersService,
  ) {}

  // ---------------- الربط المالي والإعدادات ----------------

  @Get('budget-options') @RequireAnyPermission(...REQ_READ)
  budgetOptions(@CurrentOrgUser() a: OrgUser, @Query('year') year?: string) {
    const y = Number(year) || new Date().getFullYear();
    return this.sc.budgetOptions(a.organizationId, y);
  }

  @Post('budget-check') @HttpCode(200) @RequireAnyPermission(...REQ_READ)
  async budgetCheck(@CurrentOrgUser() a: OrgUser, @Body() dto: BudgetCheckDto) {
    const c = await this.sc.check(a.organizationId, {
      amount: dto.amount, budgetLineId: dto.budgetLineId ?? null, fundingBatchId: dto.fundingBatchId ?? null, projectId: dto.projectId ?? null, kind: dto.kind ?? 'goods',
    });
    return { ...this.sc.snapshot(c), line: c.line, funding: c.funding };
  }

  @Put('sourcing-settings') @RequirePermissions(P.settings)
  async saveSettings(@CurrentOrgUser() a: OrgUser, @Body() dto: SourcingSettingsDto) {
    const org = a.organizationId;
    await this.core.settings(org);
    if (dto.methodLimits && dto.methodLimits.quotes < dto.methodLimits.direct) throw new BadRequestException('حد طلب العروض يكون أكبر من حد الشراء المباشر');
    if (dto.evalCriteria) {
      const sum = dto.evalCriteria.reduce((s, c) => s + c.weight, 0);
      if (sum !== 100) throw new BadRequestException(`مجموع أوزان المعايير ${sum}، ويجب أن يكون 100`);
      if (new Set(dto.evalCriteria.map((c) => c.key)).size !== dto.evalCriteria.length) throw new BadRequestException('رمز معيار مكرر');
    }
    if (dto.approvalLevels) {
      dto.approvalLevels.sort((x, y) => x.minAmount - y.minAmount);
      if (dto.approvalLevels[0].minAmount !== 0) throw new BadRequestException('المستوى الأول يبدأ من صفر حتى يُعتمد كل تعميد');
    }
    const patch: Partial<PrSettings> = {};
    for (const k of ['methodLimits', 'minQuotes', 'approvalLevels', 'evalCriteria', 'technicalPass', 'orderTerms', 'discloseWinner'] as const) {
      if (dto[k] !== undefined) (patch as Record<string, unknown>)[k] = dto[k];
    }
    await this.db.getRepository(PrSettings).update({ organizationId: org }, patch);
    return this.core.lookups(org);
  }

  // ---------------- طلبات الشراء ----------------

  @Get('requests') @RequireAnyPermission(...REQ_READ)
  listRequests(@CurrentOrgUser() a: OrgUser, @Query() q: { status?: string; q?: string; mine?: string; unit?: string }) { return this.requests.list(a, q); }

  @Post('requests') @RequireAnyPermission(P.requests, P.sourcing)
  createRequest(@CurrentOrgUser() a: OrgUser, @Body() dto: RequestDto) { return this.requests.create(a, dto); }

  @Get('requests/:id') @RequireAnyPermission(...REQ_READ)
  getRequest(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string) { return this.requests.get(a, id); }

  @Put('requests/:id') @RequireAnyPermission(P.requests, P.sourcing)
  updateRequest(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string, @Body() dto: RequestDto) { return this.requests.update(a, id, dto); }

  @Get('requests/:id/similar') @RequireAnyPermission(...REQ_READ)
  similar(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string) { return this.requests.similar(a, id); }

  @Post('requests/:id/submit') @HttpCode(200) @RequireAnyPermission(P.requests, P.sourcing)
  submitRequest(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string, @Body() dto: SubmitRequestDto) { return this.requests.submit(a, id, !!dto.confirmDuplicate); }

  @Post('requests/:id/approve') @HttpCode(200) @RequirePermissions(P.approveRequests)
  approveRequest(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string, @Body() dto: NoteDto) { return this.requests.decide(a, id, 'approve', dto.note ?? null); }

  @Post('requests/:id/return') @HttpCode(200) @RequirePermissions(P.approveRequests)
  returnRequest(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string, @Body() dto: NoteDto) { return this.requests.decide(a, id, 'return', dto.note ?? null); }

  @Post('requests/:id/reject') @HttpCode(200) @RequirePermissions(P.approveRequests)
  rejectRequest(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string, @Body() dto: NoteDto) { return this.requests.decide(a, id, 'reject', dto.note ?? null); }

  @Post('requests/:id/cancel') @HttpCode(200) @RequireAnyPermission(P.requests, P.sourcing)
  cancelRequest(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string, @Body() dto: ReasonDto) { return this.requests.cancel(a, id, dto.reason); }

  @Post('requests/:id/attachments') @HttpCode(200) @RequireAnyPermission(P.requests, P.sourcing) @UseInterceptors(upload)
  addRequestFile(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string, @UploadedFile() file: Express.Multer.File) { return this.requests.addAttachment(a, id, file); }

  @Delete('requests/:id/attachments/:key') @RequireAnyPermission(P.requests, P.sourcing)
  removeRequestFile(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string, @Param('key') key: string) { return this.requests.removeAttachment(a, id, key); }

  @Get('requests/:id/files/:key') @RequireAnyPermission(...REQ_READ)
  async requestFile(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string, @Param('key') key: string, @Res({ passthrough: true }) res: Response) {
    return sendFile(res, await this.requests.file(a, id, key));
  }

  // ---------------- المنافسات ----------------

  @Get('rfqs') @RequireAnyPermission(...RFQ_READ)
  listRfqs(@CurrentOrgUser() a: OrgUser, @Query() q: { status?: string; q?: string }) { return this.rfqs.list(a, q); }

  @Post('rfqs') @RequirePermissions(P.sourcing)
  createRfq(@CurrentOrgUser() a: OrgUser, @Body() dto: RfqDto) { return this.rfqs.create(a, dto); }

  @Get('rfqs/:id') @RequireAnyPermission(...RFQ_READ)
  getRfq(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string) { return this.rfqs.get(a, id); }

  @Put('rfqs/:id') @RequirePermissions(P.sourcing)
  updateRfq(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string, @Body() dto: RfqDto) { return this.rfqs.update(a, id, dto); }

  @Post('rfqs/:id/publish') @HttpCode(200) @RequirePermissions(P.sourcing)
  publish(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string, @Body() dto: PublishDto) { return this.rfqs.publish(a, id, dto.fewerReason ?? null); }

  @Post('rfqs/:id/extend') @HttpCode(200) @RequirePermissions(P.sourcing)
  extend(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string, @Body() dto: ExtendDto) { return this.rfqs.extend(a, id, dto); }

  @Post('rfqs/:id/open') @HttpCode(200) @RequirePermissions(P.sourcing)
  open(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string) { return this.rfqs.open(a, id); }

  @Post('rfqs/:id/cancel') @HttpCode(200) @RequirePermissions(P.sourcing)
  cancelRfq(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string, @Body() dto: ReasonDto) { return this.rfqs.cancel(a, id, dto.reason); }

  @Post('rfqs/:id/recommend') @HttpCode(200) @RequirePermissions(P.sourcing)
  recommend(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string, @Body() dto: RecommendDto) { return this.rfqs.recommend(a, id, dto); }

  @Post('rfqs/:id/questions/:q/answer') @HttpCode(200) @RequirePermissions(P.sourcing)
  answer(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string, @Param('q', uuid) q: string, @Body() dto: AnswerDto) { return this.rfqs.answer(a, id, q, dto); }

  @Post('rfqs/:id/quotes') @HttpCode(200) @RequirePermissions(P.sourcing)
  staffQuote(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string, @Body() dto: StaffQuoteDto) { return this.rfqs.staffQuote(a, id, dto); }

  @Post('rfqs/:id/attachments') @HttpCode(200) @RequirePermissions(P.sourcing) @UseInterceptors(upload)
  addRfqFile(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string, @UploadedFile() file: Express.Multer.File) { return this.rfqs.addAttachment(a, id, file); }

  @Delete('rfqs/:id/attachments/:key') @RequirePermissions(P.sourcing)
  removeRfqFile(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string, @Param('key') key: string) { return this.rfqs.removeAttachment(a, id, key); }

  @Get('rfqs/:id/files/:key') @RequireAnyPermission(...RFQ_READ)
  async rfqFile(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string, @Param('key') key: string, @Res({ passthrough: true }) res: Response) {
    return sendFile(res, await this.rfqs.file(a, id, key));
  }

  @Post('quotes/:id/score') @HttpCode(200) @RequirePermissions(P.evaluate)
  score(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string, @Body() dto: ScoreDto) { return this.rfqs.score(a, id, dto); }

  @Post('quotes/:id/exclude') @HttpCode(200) @RequirePermissions(P.sourcing)
  exclude(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string, @Body() dto: ReasonDto) { return this.rfqs.exclude(a, id, dto.reason); }

  @Post('quotes/:id/restore') @HttpCode(200) @RequirePermissions(P.sourcing)
  restore(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string) { return this.rfqs.exclude(a, id, null); }

  @Post('quotes/:id/negotiate') @HttpCode(200) @RequirePermissions(P.sourcing)
  negotiate(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string, @Body() dto: NegotiateDto) { return this.rfqs.negotiate(a, id, dto); }

  @Get('quotes/:id/files/:key') @RequireAnyPermission(...RFQ_READ)
  async quoteFile(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string, @Param('key') key: string, @Res({ passthrough: true }) res: Response) {
    return sendFile(res, await this.rfqs.quoteFile(a, id, key));
  }

  // ---------------- التعميدات ----------------

  @Get('orders') @RequireAnyPermission(...ORD_READ)
  listOrders(@CurrentOrgUser() a: OrgUser, @Query() q: { status?: string; supplier?: string; q?: string; mine?: string }) { return this.orders.list(a, q); }

  @Post('orders') @RequirePermissions(P.sourcing)
  createOrder(@CurrentOrgUser() a: OrgUser, @Body() dto: OrderDto) { return this.orders.createDirect(a, dto); }

  @Get('orders/:id') @RequireAnyPermission(...ORD_READ)
  getOrder(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string) { return this.orders.get(a, id); }

  @Put('orders/:id') @RequirePermissions(P.sourcing)
  updateOrder(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string, @Body() dto: OrderDto) { return this.orders.update(a, id, dto); }

  @Post('orders/:id/submit') @HttpCode(200) @RequirePermissions(P.sourcing)
  submitOrder(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string) { return this.orders.submit(a, id); }

  @Post('orders/:id/approve') @HttpCode(200) @RequireAnyPermission(...ORD_APPROVE)
  approveOrder(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string, @Body() dto: NoteDto) { return this.orders.approve(a, id, dto.note ?? null); }

  @Post('orders/:id/return') @HttpCode(200) @RequireAnyPermission(...ORD_APPROVE)
  returnOrder(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string, @Body() dto: ReasonDto) { return this.orders.returnOrder(a, id, dto.reason); }

  @Post('orders/:id/cancel') @HttpCode(200) @RequireAnyPermission(P.sourcing, ...ORD_APPROVE)
  cancelOrder(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string, @Body() dto: ReasonDto) { return this.orders.cancel(a, id, dto.reason); }

  @Post('orders/:id/amend') @HttpCode(200) @RequirePermissions(P.sourcing)
  amend(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string, @Body() dto: AmendDto) { return this.orders.amend(a, id, dto); }

  @Post('orders/:id/reply') @HttpCode(200) @RequirePermissions(P.sourcing)
  reply(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string, @Body() dto: ReasonDto) { return this.orders.reply(a, id, dto.reason); }
}
