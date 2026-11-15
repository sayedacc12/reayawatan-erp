import {
  Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put, Query, Req, Res, StreamableFile,
  UploadedFile, UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Request, Response } from 'express';
import { memoryStorage } from 'multer';
import { CurrentUser, AuthUser, RequirePermissions } from '../auth/decorators';
import { PLATFORM_PERMISSIONS } from '../core.manifest';
import { MAX_UPLOAD_BYTES } from '../files/file-store.service';
import { ModuleCatalogService } from '../modules/module-catalog.service';
import { OrganizationsService } from '../organizations/organizations.service';
import { ApplicationsService } from './applications.service';
import { ContractsService } from './contracts.service';
import { SubscriptionReportsService } from './reports.service';
import {
  AccessDto, AdminApplicationDto, ApproveDto, ClauseDto, NoteDto, OrderDto, ProviderDto, SubscriptionDto,
  UpdateApplicationDto, UpdateContractDto,
} from './subscriptions.dto';

export const licenseUpload = () =>
  UseInterceptors(FileInterceptor('license', { storage: memoryStorage(), limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 } }));

/** أصل الروابط في نص العقد (مثل https://sanabelerp.com) */
export const originOf = (req: Request) => process.env.PUBLIC_URL?.replace(/\/$/, '') ?? `${req.protocol}://${req.get('host')}`;

/** اشتراكات الجمعيات لمدير المنصة: الطلبات والاعتماد والشاشات والعقود وبنودها */
@Controller('platform')
@RequirePermissions(PLATFORM_PERMISSIONS.subscriptionsManage)
export class SubscriptionsController {
  constructor(
    private readonly apps: ApplicationsService,
    private readonly contracts: ContractsService,
    private readonly orgs: OrganizationsService,
    private readonly catalog: ModuleCatalogService,
  ) {}

  // ---------- طلبات الاشتراك ----------

  @Get('applications')
  listApplications(@Query('status') status?: string) {
    return this.apps.list(status);
  }

  @Post('applications')
  @licenseUpload()
  createApplication(@Body() dto: AdminApplicationDto, @UploadedFile() file: Express.Multer.File, @CurrentUser() actor: AuthUser) {
    return this.apps.submit(dto, file, actor);
  }

  @Get('applications/:id')
  getApplication(@Param('id', ParseUUIDPipe) id: string) {
    return this.apps.get(id);
  }

  @Patch('applications/:id')
  @licenseUpload()
  updateApplication(
    @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateApplicationDto,
    @UploadedFile() file: Express.Multer.File | undefined, @CurrentUser() actor: AuthUser,
  ) {
    return this.apps.update(id, dto, file, actor);
  }

  @Get('applications/:id/license')
  async license(@Param('id', ParseUUIDPipe) id: string, @Res({ passthrough: true }) res: Response) {
    const f = await this.apps.licenseFile(id);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'private, no-store');
    return new StreamableFile(f.stream, { type: f.mime, disposition: `inline; filename*=UTF-8''${encodeURIComponent(f.name)}` });
  }

  @Post('applications/:id/return')
  @HttpCode(200)
  returnApplication(@Param('id', ParseUUIDPipe) id: string, @Body() dto: NoteDto, @CurrentUser() actor: AuthUser) {
    return this.apps.returnForCompletion(id, dto.note, actor);
  }

  @Post('applications/:id/reject')
  @HttpCode(200)
  rejectApplication(@Param('id', ParseUUIDPipe) id: string, @Body() dto: NoteDto, @CurrentUser() actor: AuthUser) {
    return this.apps.reject(id, dto.note, actor);
  }

  @Post('applications/:id/approve')
  @HttpCode(200)
  approve(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ApproveDto, @CurrentUser() actor: AuthUser) {
    return this.apps.approve(id, dto, actor);
  }

  // ---------- الشاشات والاشتراك لكل جمعية ----------

  @Get('screens')
  screens() {
    return this.catalog.screenCatalog();
  }

  @Get('organizations/:id/details')
  async details(@Param('id', ParseUUIDPipe) id: string) {
    const [organization, profile, contracts] = await Promise.all([
      this.orgs.get(id), this.apps.forOrganization(id), this.contracts.forOrganization(id),
    ]);
    return { organization, profile, contracts };
  }

  @Put('organizations/:id/access')
  setAccess(@Param('id', ParseUUIDPipe) id: string, @Body() dto: AccessDto) {
    const { screens, modules } = this.apps.normalizeAccess(dto);
    return this.orgs.setAccess(id, screens, modules);
  }

  @Patch('organizations/:id/subscription')
  setSubscription(@Param('id', ParseUUIDPipe) id: string, @Body() dto: SubscriptionDto) {
    return this.orgs.setSubscription(id, dto);
  }

  @Post('organizations/:id/contracts')
  newContract(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() actor: AuthUser) {
    return this.contracts.createForOrganization(id, actor);
  }

  // ---------- العقود ----------

  @Get('contracts')
  listContracts(@Query('status') status?: string) {
    return this.contracts.list(status);
  }

  @Get('contracts/:id')
  getContract(@Param('id', ParseUUIDPipe) id: string) {
    return this.contracts.get(id);
  }

  @Put('contracts/:id')
  updateContract(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateContractDto, @CurrentUser() actor: AuthUser) {
    return this.contracts.update(id, dto, actor);
  }

  @Get('contracts/:id/preview')
  preview(@Param('id', ParseUUIDPipe) id: string, @Req() req: Request) {
    return this.contracts.preview(id, originOf(req));
  }

  @Post('contracts/:id/send')
  @HttpCode(200)
  send(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() actor: AuthUser, @Req() req: Request) {
    return this.contracts.send(id, actor, originOf(req));
  }

  @Post('contracts/:id/withdraw')
  @HttpCode(200)
  withdraw(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() actor: AuthUser) {
    return this.contracts.withdraw(id, actor);
  }

  @Post('contracts/:id/cancel')
  @HttpCode(200)
  cancel(@Param('id', ParseUUIDPipe) id: string, @Body() dto: NoteDto, @CurrentUser() actor: AuthUser) {
    return this.contracts.cancel(id, actor, dto.note);
  }

  // ---------- مكتبة بنود العقد وبيانات مقدم الخدمة ----------

  @Get('contract-clauses')
  clauses() {
    return this.contracts.clauses();
  }

  @Get('contract-variables')
  variables() {
    return this.contracts.variables();
  }

  @Post('contract-clauses')
  createClause(@Body() dto: ClauseDto) {
    return this.contracts.createClause(dto);
  }

  @Put('contract-clauses/order')
  reorder(@Body() dto: OrderDto) {
    return this.contracts.reorderClauses(dto.ids);
  }

  @Post('contract-clauses/restore-defaults')
  @HttpCode(200)
  restore() {
    return this.contracts.restoreDefaults();
  }

  @Put('contract-clauses/:id')
  updateClause(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ClauseDto) {
    return this.contracts.updateClause(id, dto);
  }

  @Delete('contract-clauses/:id')
  @HttpCode(204)
  deleteClause(@Param('id', ParseUUIDPipe) id: string) {
    return this.contracts.deleteClause(id);
  }

  @Get('provider')
  provider() {
    return this.contracts.provider();
  }

  @Put('provider')
  setProvider(@Body() dto: ProviderDto) {
    return this.contracts.setProvider(dto);
  }
}

/** تقارير الاشتراكات (قسم التقارير المستقل لإدارة المنصة) */
@Controller('platform/reports')
@RequirePermissions(PLATFORM_PERMISSIONS.reportsRead)
export class SubscriptionReportsController {
  constructor(private readonly reports: SubscriptionReportsService) {}

  @Get('subscriptions')
  overview() {
    return this.reports.overview();
  }
}
