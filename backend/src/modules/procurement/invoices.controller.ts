import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Put, Query, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Response } from 'express';
import { memoryStorage } from 'multer';
import { CurrentOrgUser, OrgUser, RequireAnyPermission, RequirePermissions } from '../../core/auth/decorators';
import { MAX_UPLOAD_BYTES } from '../../core/files/file-store.service';
import { ACC_PERMISSIONS as ACC } from '../accounting/accounting.manifest';
import { INVOICE_KINDS, INVOICE_STATUS, MATCH_ISSUES } from './entities/invoice.entity';
import { InvoiceApproveDto, InvoiceDto, InvoiceListQueryDto, InvoiceMessageDto, InvoicePayDto, InvoicePostDto, InvoiceSettingsDto, StatementQueryDto } from './invoice.dto';
import { InvoicesService } from './invoices.service';
import { sendFile } from './procurement.controller';
import { PROCUREMENT_PERMISSIONS as P } from './procurement.manifest';
import { ReasonDto } from './sourcing.dto';

const uuid = new ParseUUIDPipe();
const upload = FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 } });
/** من يرى الفواتير: المشتريات (التسجيل والمطابقة والتجاوز وسجل الموردين والتقارير) والمالي (المستحقات والسداد) */
const INV_READ = [P.invoices, P.invoicesOverride, P.suppliersRead, P.reports, ACC.payables, ACC.payments];

/** فواتير الموردين والمطابقة الثلاثية (المشتريات)، ومستحقات الموردين وسدادها (النظام المالي)، وكشوف حساب الموردين */
@Controller('procurement')
export class InvoicesController {
  constructor(private readonly invoices: InvoicesService) {}

  @Get('invoice-lookups') @RequireAnyPermission(...INV_READ, P.settings)
  async lookups(@CurrentOrgUser() a: OrgUser) {
    return { kinds: INVOICE_KINDS, status: INVOICE_STATUS, matchIssues: MATCH_ISSUES, cashAccounts: await this.invoices.cashAccounts(a.organizationId) };
  }

  @Put('invoice-settings') @RequirePermissions(P.settings)
  saveSettings(@CurrentOrgUser() a: OrgUser, @Body() dto: InvoiceSettingsDto) {
    return this.invoices.saveSettings(a, dto);
  }

  @Get('invoices') @RequireAnyPermission(...INV_READ)
  list(@CurrentOrgUser() a: OrgUser, @Query() q: InvoiceListQueryDto) {
    return this.invoices.list(a, q);
  }

  @Get('orders/:id/billable') @RequireAnyPermission(...INV_READ)
  billable(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string) {
    return this.invoices.billableForStaff(a, id);
  }

  @Post('invoices') @HttpCode(200) @RequirePermissions(P.invoices)
  create(@CurrentOrgUser() a: OrgUser, @Body() dto: InvoiceDto) {
    return this.invoices.create(a, dto);
  }

  @Get('invoices/:id') @RequireAnyPermission(...INV_READ)
  get(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string) {
    return this.invoices.get(a, id);
  }

  @Put('invoices/:id') @RequirePermissions(P.invoices)
  update(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string, @Body() dto: InvoiceDto) {
    return this.invoices.update(a, id, dto);
  }

  @Post('invoices/:id/submit') @HttpCode(200) @RequirePermissions(P.invoices)
  submit(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string) {
    return this.invoices.submit(a, id);
  }

  @Post('invoices/:id/approve') @HttpCode(200) @RequireAnyPermission(P.invoices, P.invoicesOverride)
  approve(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string, @Body() dto: InvoiceApproveDto) {
    return this.invoices.approve(a, id, dto);
  }

  @Post('invoices/:id/return') @HttpCode(200) @RequireAnyPermission(P.invoices, P.invoicesOverride)
  returnInv(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string, @Body() dto: ReasonDto) {
    return this.invoices.decline(a, id, 'return', dto.reason);
  }

  @Post('invoices/:id/reject') @HttpCode(200) @RequireAnyPermission(P.invoices, P.invoicesOverride)
  reject(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string, @Body() dto: ReasonDto) {
    return this.invoices.decline(a, id, 'reject', dto.reason);
  }

  @Post('invoices/:id/cancel') @HttpCode(200) @RequirePermissions(P.invoices)
  cancel(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string, @Body() dto: ReasonDto) {
    return this.invoices.cancel(a, id, dto.reason);
  }

  @Post('invoices/:id/messages') @HttpCode(200) @RequireAnyPermission(P.invoices, P.invoicesOverride, ACC.payables)
  message(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string, @Body() dto: InvoiceMessageDto) {
    return this.invoices.message(a, id, dto.text);
  }

  @Post('invoices/:id/files') @HttpCode(200) @RequirePermissions(P.invoices) @UseInterceptors(upload)
  addFile(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string, @UploadedFile() file: Express.Multer.File) {
    return this.invoices.addFile(a, id, file);
  }

  @Delete('invoices/:id/files/:key') @RequirePermissions(P.invoices)
  removeFile(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string, @Param('key') key: string) {
    return this.invoices.removeFile(a, id, key);
  }

  @Get('invoices/:id/files/:key') @RequireAnyPermission(...INV_READ)
  async file(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string, @Param('key') key: string, @Res({ passthrough: true }) res: Response) {
    return sendFile(res, await this.invoices.file(a, id, key));
  }

  // ---------------- النظام المالي ----------------

  @Get('payables') @RequireAnyPermission(ACC.payables, ACC.payments)
  payables(@CurrentOrgUser() a: OrgUser) {
    return this.invoices.payables(a);
  }

  @Post('invoices/:id/post') @HttpCode(200) @RequirePermissions(ACC.payables)
  post(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string, @Body() dto: InvoicePostDto) {
    return this.invoices.post(a, id, dto);
  }

  @Post('invoices/:id/unpost') @HttpCode(200) @RequirePermissions(ACC.payables)
  unpost(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string, @Body() dto: ReasonDto) {
    return this.invoices.unpost(a, id, dto.reason);
  }

  @Post('invoices/:id/pay') @HttpCode(200) @RequirePermissions(ACC.payments)
  pay(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string, @Body() dto: InvoicePayDto) {
    return this.invoices.pay(a, id, dto);
  }

  // ---------------- كشف حساب المورد ----------------

  @Get('suppliers/:id/statement') @RequireAnyPermission(...INV_READ)
  statement(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string, @Query() q: StatementQueryDto) {
    return this.invoices.staffStatement(a, id, q);
  }
}
