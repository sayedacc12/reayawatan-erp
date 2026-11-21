import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import { CurrentOrgUser, OrgUser, RequireAnyPermission, RequirePermissions } from '../../core/auth/decorators';
import { ACC_PERMISSIONS as ACC } from '../accounting/accounting.manifest';
import { BillingCore } from './billing-core.service';
import { BillingOpsService } from './billing-ops.service';
import {
  AsOfQueryDto, BillingSettingsDto, CollectDto, CustomerDto, CustomerListQueryDto, DocDto, DocListQueryDto, IssueDto, ItemDto, ReasonDto, StatementQueryDto,
} from './billing.dto';
import { BILLING_PERMISSIONS as P } from './billing.manifest';
import { CatalogService } from './catalog.service';
import { DocumentsService, isBillingStaff, maskId } from './documents.service';

const uuid = new ParseUUIDPipe();
/** من يرى الفوترة: موظفو الفوترة والإصدار والتقارير والعملاء، والمالي لتحصيل الفواتير بسندات القبض */
const READ = [P.read, P.invoices, P.issue, P.reports, P.customers, ACC.receipts];

/** نظام الفوترة والمبيعات: الإعدادات والعملاء والأصناف والفواتير والإشعارات والتحصيل والمطابقة */
@Controller('billing')
export class BillingController {
  constructor(
    private readonly core: BillingCore, private readonly ops: BillingOpsService, private readonly catalog: CatalogService, private readonly docs: DocumentsService,
  ) {}

  @Get('lookups') @RequireAnyPermission(...READ, P.items, P.settings)
  lookups(@CurrentOrgUser() a: OrgUser) {
    return this.core.lookups(a.organizationId);
  }

  @Get('dashboard') @RequireAnyPermission(...READ)
  dashboard(@CurrentOrgUser() a: OrgUser) {
    return this.ops.dashboard(a);
  }

  @Put('settings') @RequirePermissions(P.settings)
  saveSettings(@CurrentOrgUser() a: OrgUser, @Body() dto: BillingSettingsDto) {
    return this.ops.saveSettings(a, dto);
  }

  @Get('reconciliation') @RequireAnyPermission(P.read, P.reports, P.settings)
  reconcile(@CurrentOrgUser() a: OrgUser, @Query() q: AsOfQueryDto) {
    return this.ops.reconcile(a, q);
  }

  // ---------------- العملاء ----------------

  @Get('customers') @RequireAnyPermission(...READ)
  customers(@CurrentOrgUser() a: OrgUser, @Query() q: CustomerListQueryDto) {
    return this.catalog.customers(a.organizationId, q);
  }

  @Post('customers') @HttpCode(200) @RequirePermissions(P.customers)
  createCustomer(@CurrentOrgUser() a: OrgUser, @Body() dto: CustomerDto) {
    return this.catalog.createCustomer(a, dto);
  }

  @Get('customers/:id') @RequireAnyPermission(...READ)
  async customer(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string) {
    const c = await this.catalog.getCustomer(a.organizationId, id);
    return isBillingStaff(a) ? c : { ...c, idNumber: maskId(c.idNumber), log: [] };
  }

  @Put('customers/:id') @RequirePermissions(P.customers)
  updateCustomer(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string, @Body() dto: CustomerDto) {
    return this.catalog.updateCustomer(a, id, dto);
  }

  @Get('customers/:id/statement') @RequireAnyPermission(...READ)
  statement(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string, @Query() q: StatementQueryDto) {
    return this.docs.statement(a, id, q);
  }

  // ---------------- الأصناف والخدمات ----------------

  @Get('items') @RequireAnyPermission(...READ, P.items)
  items(@CurrentOrgUser() a: OrgUser) {
    return this.catalog.items(a.organizationId);
  }

  @Post('items') @HttpCode(200) @RequirePermissions(P.items)
  createItem(@CurrentOrgUser() a: OrgUser, @Body() dto: ItemDto) {
    return this.catalog.createItem(a, dto);
  }

  @Put('items/:id') @RequirePermissions(P.items)
  updateItem(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string, @Body() dto: ItemDto) {
    return this.catalog.updateItem(a, id, dto);
  }

  // ---------------- الفواتير والإشعارات ----------------

  @Get('documents') @RequireAnyPermission(...READ)
  list(@CurrentOrgUser() a: OrgUser, @Query() q: DocListQueryDto) {
    return this.docs.list(a, q);
  }

  @Post('documents') @HttpCode(200) @RequirePermissions(P.invoices)
  create(@CurrentOrgUser() a: OrgUser, @Body() dto: DocDto) {
    return this.docs.create(a, dto);
  }

  @Get('documents/:id') @RequireAnyPermission(...READ)
  get(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string) {
    return this.docs.get(a, id);
  }

  @Put('documents/:id') @RequirePermissions(P.invoices)
  update(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string, @Body() dto: DocDto) {
    return this.docs.update(a, id, dto);
  }

  @Post('documents/:id/submit') @HttpCode(200) @RequirePermissions(P.invoices)
  submit(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string) {
    return this.docs.submit(a, id);
  }

  @Post('documents/:id/return') @HttpCode(200) @RequirePermissions(P.issue)
  returnDoc(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string, @Body() dto: ReasonDto) {
    return this.docs.returnDoc(a, id, dto.reason);
  }

  @Post('documents/:id/issue') @HttpCode(200) @RequirePermissions(P.issue)
  issue(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string, @Body() dto: IssueDto) {
    return this.docs.issue(a, id, dto);
  }

  @Post('documents/:id/cancel') @HttpCode(200) @RequirePermissions(P.invoices)
  cancel(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string, @Body() dto: ReasonDto) {
    return this.docs.cancel(a, id, dto.reason);
  }

  @Post('documents/:id/collect') @HttpCode(200) @RequirePermissions(ACC.receipts)
  collect(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string, @Body() dto: CollectDto) {
    return this.docs.collect(a, id, dto);
  }
}
