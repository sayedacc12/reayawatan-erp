import { Body, Controller, Delete, Get, HttpCode, Ip, Param, ParseUUIDPipe, Patch, Post, Put, Query, Res, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import { Response } from 'express';
import { memoryStorage } from 'multer';
import { AllowWithTempPassword, Public } from '../../core/auth/decorators';
import { MAX_UPLOAD_BYTES } from '../../core/files/file-store.service';
import { sendFile } from './procurement.controller';
import {
  BankDto, DocMetaDto, PortalChangePasswordDto, PortalForgotDto, PortalLoginDto, PortalRegisterDto, PortalResetDto, PortalUserDto, PortalUserUpdateDto, SupplierDto,
} from './procurement.dto';
import { CurrentSupplier, SupplierPortalGuard, SupplierPortalUser } from './supplier-portal.guard';
import { SupplierPortalService } from './supplier-portal.service';
import { SourcingPortalService } from './sourcing-portal.service';
import { InvoiceDto, InvoiceMessageDto, StatementQueryDto } from './invoice.dto';
import { InvoicesService } from './invoices.service';
import { QuestionDto, QuoteDto, RespondDto } from './sourcing.dto';

const uuid = new ParseUUIDPipe();
const upload = FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 } });

/**
 * بوابة الموردين ومزودي الخدمات:
 * /supplier-portal/o/:slug/...  عام لكل جمعية (المعلومات، التسجيل، الدخول، الاستعادة)
 * /supplier-portal/...          بعد دخول مستخدم المورد
 */
@Public()
@Controller('supplier-portal')
export class SupplierPortalController {
  constructor(private readonly portal: SupplierPortalService, private readonly sourcing: SourcingPortalService, private readonly invoices: InvoicesService) {}

  @Get('o/:slug')
  info(@Param('slug') slug: string) { return this.portal.info(slug); }

  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('o/:slug/register')
  register(@Param('slug') slug: string, @Body() dto: PortalRegisterDto, @Ip() ip: string) { return this.portal.register(slug, dto, ip ?? null); }

  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('o/:slug/login') @HttpCode(200)
  login(@Param('slug') slug: string, @Body() dto: PortalLoginDto, @Ip() ip: string) { return this.portal.login(slug, dto, ip ?? null); }

  @Throttle({ default: { limit: 5, ttl: 15 * 60_000 } })
  @Post('o/:slug/forgot') @HttpCode(200)
  forgot(@Param('slug') slug: string, @Body() dto: PortalForgotDto, @Ip() ip: string) { return this.portal.forgot(slug, dto, ip ?? null); }

  @Throttle({ default: { limit: 10, ttl: 15 * 60_000 } })
  @Post('o/:slug/reset') @HttpCode(200)
  reset(@Param('slug') slug: string, @Body() dto: PortalResetDto, @Ip() ip: string) { return this.portal.reset(slug, dto, ip ?? null); }

  @UseGuards(SupplierPortalGuard) @AllowWithTempPassword()
  @Post('change-password') @HttpCode(200)
  changePassword(@CurrentSupplier() p: SupplierPortalUser, @Body() dto: PortalChangePasswordDto) { return this.portal.changePassword(p, dto); }

  @UseGuards(SupplierPortalGuard) @AllowWithTempPassword()
  @Get('me')
  me(@CurrentSupplier() p: SupplierPortalUser) { return this.portal.me(p); }

  @UseGuards(SupplierPortalGuard)
  @Put('me')
  update(@CurrentSupplier() p: SupplierPortalUser, @Body() dto: SupplierDto) { return this.portal.updateProfile(p, dto); }

  @UseGuards(SupplierPortalGuard)
  @Post('submit') @HttpCode(200)
  submit(@CurrentSupplier() p: SupplierPortalUser) { return this.portal.submit(p); }

  @UseGuards(SupplierPortalGuard)
  @Post('docs') @HttpCode(200) @UseInterceptors(upload)
  addDoc(@CurrentSupplier() p: SupplierPortalUser, @Body() dto: DocMetaDto, @UploadedFile() file: Express.Multer.File) { return this.portal.addDoc(p, dto, file); }

  @UseGuards(SupplierPortalGuard)
  @Delete('docs/:id')
  removeDoc(@CurrentSupplier() p: SupplierPortalUser, @Param('id', uuid) id: string) { return this.portal.removeDoc(p, id); }

  @UseGuards(SupplierPortalGuard)
  @Get('docs/:id/file')
  async docFile(@CurrentSupplier() p: SupplierPortalUser, @Param('id', uuid) id: string, @Res({ passthrough: true }) res: Response) {
    return sendFile(res, await this.portal.docFile(p, id));
  }

  @UseGuards(SupplierPortalGuard)
  @Post('banks') @HttpCode(200) @UseInterceptors(upload)
  addBank(@CurrentSupplier() p: SupplierPortalUser, @Body() dto: BankDto, @UploadedFile() file: Express.Multer.File) { return this.portal.addBank(p, dto, file); }

  @UseGuards(SupplierPortalGuard)
  @Post('users') @HttpCode(200)
  addUser(@CurrentSupplier() p: SupplierPortalUser, @Body() dto: PortalUserDto) { return this.portal.addUser(p, dto); }

  @UseGuards(SupplierPortalGuard)
  @Patch('users/:id')
  updateUser(@CurrentSupplier() p: SupplierPortalUser, @Param('id', uuid) id: string, @Body() dto: PortalUserUpdateDto) { return this.portal.updateUser(p, id, dto); }

  // ---------------- المنافسات والتعميدات ----------------

  @UseGuards(SupplierPortalGuard)
  @Get('sourcing-summary')
  sourcingSummary(@CurrentSupplier() p: SupplierPortalUser) { return this.sourcing.summary(p); }

  @UseGuards(SupplierPortalGuard)
  @Get('rfqs')
  rfqs(@CurrentSupplier() p: SupplierPortalUser) { return this.sourcing.rfqs(p); }

  @UseGuards(SupplierPortalGuard)
  @Get('rfqs/:id')
  rfq(@CurrentSupplier() p: SupplierPortalUser, @Param('id', uuid) id: string) { return this.sourcing.rfqDetail(p, id); }

  @UseGuards(SupplierPortalGuard)
  @Post('rfqs/:id/questions') @HttpCode(200)
  ask(@CurrentSupplier() p: SupplierPortalUser, @Param('id', uuid) id: string, @Body() dto: QuestionDto) { return this.sourcing.ask(p, id, dto); }

  @UseGuards(SupplierPortalGuard)
  @Put('rfqs/:id/quote')
  saveQuote(@CurrentSupplier() p: SupplierPortalUser, @Param('id', uuid) id: string, @Body() dto: QuoteDto) { return this.sourcing.saveQuote(p, id, dto); }

  @UseGuards(SupplierPortalGuard)
  @Post('rfqs/:id/withdraw') @HttpCode(200)
  withdraw(@CurrentSupplier() p: SupplierPortalUser, @Param('id', uuid) id: string) { return this.sourcing.withdraw(p, id); }

  @UseGuards(SupplierPortalGuard)
  @Post('rfqs/:id/files') @HttpCode(200) @UseInterceptors(upload)
  addQuoteFile(@CurrentSupplier() p: SupplierPortalUser, @Param('id', uuid) id: string, @UploadedFile() file: Express.Multer.File) { return this.sourcing.addQuoteFile(p, id, file); }

  @UseGuards(SupplierPortalGuard)
  @Delete('rfqs/:id/files/:key')
  removeQuoteFile(@CurrentSupplier() p: SupplierPortalUser, @Param('id', uuid) id: string, @Param('key') key: string) { return this.sourcing.removeQuoteFile(p, id, key); }

  @UseGuards(SupplierPortalGuard)
  @Get('rfqs/:id/files/:key')
  async rfqFile(@CurrentSupplier() p: SupplierPortalUser, @Param('id', uuid) id: string, @Param('key') key: string, @Res({ passthrough: true }) res: Response) {
    return sendFile(res, await this.sourcing.file(p, id, key));
  }

  @UseGuards(SupplierPortalGuard)
  @Get('orders')
  orders(@CurrentSupplier() p: SupplierPortalUser) { return this.sourcing.ordersList(p); }

  @UseGuards(SupplierPortalGuard)
  @Get('orders/:id')
  order(@CurrentSupplier() p: SupplierPortalUser, @Param('id', uuid) id: string) { return this.sourcing.order(p, id); }

  @UseGuards(SupplierPortalGuard)
  @Post('orders/:id/respond') @HttpCode(200)
  respond(@CurrentSupplier() p: SupplierPortalUser, @Param('id', uuid) id: string, @Body() dto: RespondDto) { return this.sourcing.respond(p, id, dto); }

  // ---------------- الفواتير وكشف الحساب ----------------

  @UseGuards(SupplierPortalGuard)
  @Get('invoices')
  invoiceList(@CurrentSupplier() p: SupplierPortalUser) { return this.invoices.portalList(p); }

  @UseGuards(SupplierPortalGuard)
  @Get('billable')
  billableOrders(@CurrentSupplier() p: SupplierPortalUser) { return this.invoices.portalBillable(p); }

  @UseGuards(SupplierPortalGuard)
  @Get('billable/:orderId')
  billable(@CurrentSupplier() p: SupplierPortalUser, @Param('orderId', uuid) orderId: string) { return this.invoices.portalBillable(p, orderId); }

  @UseGuards(SupplierPortalGuard)
  @Post('invoices') @HttpCode(200)
  createInvoice(@CurrentSupplier() p: SupplierPortalUser, @Body() dto: InvoiceDto) { return this.invoices.portalSave(p, dto, null); }

  @UseGuards(SupplierPortalGuard)
  @Get('invoices/:id')
  invoice(@CurrentSupplier() p: SupplierPortalUser, @Param('id', uuid) id: string) { return this.invoices.portalGet(p, id); }

  @UseGuards(SupplierPortalGuard)
  @Put('invoices/:id')
  updateInvoice(@CurrentSupplier() p: SupplierPortalUser, @Param('id', uuid) id: string, @Body() dto: InvoiceDto) { return this.invoices.portalSave(p, dto, id); }

  @UseGuards(SupplierPortalGuard)
  @Post('invoices/:id/submit') @HttpCode(200)
  submitInvoice(@CurrentSupplier() p: SupplierPortalUser, @Param('id', uuid) id: string) { return this.invoices.portalSubmit(p, id); }

  @UseGuards(SupplierPortalGuard)
  @Post('invoices/:id/cancel') @HttpCode(200)
  cancelInvoice(@CurrentSupplier() p: SupplierPortalUser, @Param('id', uuid) id: string) { return this.invoices.portalCancel(p, id); }

  @UseGuards(SupplierPortalGuard)
  @Post('invoices/:id/messages') @HttpCode(200)
  invoiceMessage(@CurrentSupplier() p: SupplierPortalUser, @Param('id', uuid) id: string, @Body() dto: InvoiceMessageDto) { return this.invoices.portalMessage(p, id, dto.text); }

  @UseGuards(SupplierPortalGuard)
  @Post('invoices/:id/files') @HttpCode(200) @UseInterceptors(upload)
  addInvoiceFile(@CurrentSupplier() p: SupplierPortalUser, @Param('id', uuid) id: string, @UploadedFile() file: Express.Multer.File) { return this.invoices.portalAddFile(p, id, file); }

  @UseGuards(SupplierPortalGuard)
  @Delete('invoices/:id/files/:key')
  removeInvoiceFile(@CurrentSupplier() p: SupplierPortalUser, @Param('id', uuid) id: string, @Param('key') key: string) { return this.invoices.portalRemoveFile(p, id, key); }

  @UseGuards(SupplierPortalGuard)
  @Get('invoices/:id/files/:key')
  async invoiceFile(@CurrentSupplier() p: SupplierPortalUser, @Param('id', uuid) id: string, @Param('key') key: string, @Res({ passthrough: true }) res: Response) {
    return sendFile(res, await this.invoices.portalFile(p, id, key));
  }

  @UseGuards(SupplierPortalGuard)
  @Get('statement')
  statement(@CurrentSupplier() p: SupplierPortalUser, @Query() q: StatementQueryDto) { return this.invoices.portalStatement(p, q); }
}
