import {
  Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put, Query, Res, UploadedFile, UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { memoryStorage } from 'multer';
import { CurrentOrgUser, OrgUser, RequireAnyPermission, RequirePermissions } from '../../core/auth/decorators';
import { MAX_DOCUMENT_BYTES } from '../beneficiaries/constants';
import { DonorDto, ListDonorsQuery } from './donors.dto';
import { DonorsService } from './donors.service';
import { FUNDRAISING_PERMISSIONS as P } from './fundraising.manifest';
import { FundraisingService } from './fundraising.service';
import { LedgerService } from './ledger.service';
import { CollectDto, DecisionDto, DocumentDto, ListBatchesQuery, ListOpportunitiesQuery, OpportunityDto } from './opportunities.dto';
import { FundraisingReportsService } from './reports.service';
import { BankAccountDto, DonorLevelDto, GeneralSettingsDto, StagesDto, SupportManagerDto, WaqfProjectDto } from './settings.dto';
import { FundraisingSettingsService, ListName } from './settings.service';

const uuid = new ParseUUIDPipe();
const LIST_DTOS = { levels: DonorLevelDto, managers: SupportManagerDto, banks: BankAccountDto, waqf: WaqfProjectDto };

/** الإعدادات: القراءة لمن يستخدم الوحدة (لقوائم الحسابات البنكية ومدراء الدعم في النماذج) والتعديل لمدير الإعدادات */
@Controller('fundraising/settings')
export class FundraisingSettingsController {
  constructor(private readonly settings: FundraisingSettingsService) {}

  @Get()
  @RequireAnyPermission(P.settings, P.read, P.donorsRead, P.reports)
  all(@CurrentOrgUser() actor: OrgUser) {
    return this.settings.all(actor);
  }

  @Put('general')
  @RequirePermissions(P.settings)
  general(@CurrentOrgUser() actor: OrgUser, @Body() dto: GeneralSettingsDto) {
    return this.settings.updateGeneral(actor, dto);
  }

  @Put('stages')
  @RequirePermissions(P.settings)
  stages(@CurrentOrgUser() actor: OrgUser, @Body() dto: StagesDto) {
    return this.settings.saveStages(actor, dto);
  }

  /** موظفو الجمعية لاختيار مدير الدعم */
  @Get('users')
  @RequirePermissions(P.settings)
  users(@CurrentOrgUser() actor: OrgUser) {
    return this.settings.users(actor.organizationId);
  }

  /** أدوار الجمعية لتحديد المسؤول عن كل مرحلة اعتماد */
  @Get('roles')
  @RequirePermissions(P.settings)
  roles(@CurrentOrgUser() actor: OrgUser) {
    return this.settings.roles(actor.organizationId);
  }

  @Post('levels')
  @RequirePermissions(P.settings)
  createLevel(@CurrentOrgUser() a: OrgUser, @Body() dto: DonorLevelDto) {
    return this.settings.createItem(a, 'levels', dto);
  }

  @Patch('levels/:id')
  @RequirePermissions(P.settings)
  updateLevel(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string, @Body() dto: DonorLevelDto) {
    return this.settings.updateItem(a, 'levels', id, dto);
  }

  @Post('managers')
  @RequirePermissions(P.settings)
  createManager(@CurrentOrgUser() a: OrgUser, @Body() dto: SupportManagerDto) {
    return this.settings.createItem(a, 'managers', dto);
  }

  @Patch('managers/:id')
  @RequirePermissions(P.settings)
  updateManager(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string, @Body() dto: SupportManagerDto) {
    return this.settings.updateItem(a, 'managers', id, dto);
  }

  @Post('banks')
  @RequirePermissions(P.settings)
  createBank(@CurrentOrgUser() a: OrgUser, @Body() dto: BankAccountDto) {
    return this.settings.createItem(a, 'banks', dto);
  }

  @Patch('banks/:id')
  @RequirePermissions(P.settings)
  updateBank(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string, @Body() dto: BankAccountDto) {
    return this.settings.updateItem(a, 'banks', id, dto);
  }

  @Post('waqf')
  @RequirePermissions(P.settings)
  createWaqf(@CurrentOrgUser() a: OrgUser, @Body() dto: WaqfProjectDto) {
    return this.settings.createItem(a, 'waqf', dto);
  }

  @Patch('waqf/:id')
  @RequirePermissions(P.settings)
  updateWaqf(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string, @Body() dto: WaqfProjectDto) {
    return this.settings.updateItem(a, 'waqf', id, dto);
  }

  @Delete(':list/:id')
  @HttpCode(204)
  @RequirePermissions(P.settings)
  remove(@CurrentOrgUser() a: OrgUser, @Param('list') list: string, @Param('id', uuid) id: string) {
    if (!(list in LIST_DTOS)) return;
    return this.settings.removeItem(a, list as ListName, id);
  }
}

@Controller('fundraising/donors')
export class DonorsController {
  constructor(private readonly donors: DonorsService) {}

  @Get()
  @RequirePermissions(P.donorsRead)
  list(@CurrentOrgUser() a: OrgUser, @Query() q: ListDonorsQuery) {
    return this.donors.list(a, q);
  }

  @Post()
  @RequirePermissions(P.donorsManage)
  create(@CurrentOrgUser() a: OrgUser, @Body() dto: DonorDto) {
    return this.donors.create(a, dto);
  }

  @Get(':id')
  @RequirePermissions(P.donorsRead)
  get(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string) {
    return this.donors.get(a, id);
  }

  @Put(':id')
  @RequirePermissions(P.donorsManage)
  update(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string, @Body() dto: DonorDto) {
    return this.donors.update(a, id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermissions(P.donorsManage)
  remove(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string) {
    return this.donors.remove(a, id);
  }
}

@Controller('fundraising')
export class OpportunitiesController {
  constructor(
    private readonly service: FundraisingService,
    private readonly ledger: LedgerService,
    private readonly reports: FundraisingReportsService,
  ) {}

  @Get('targets')
  @RequirePermissions(P.create)
  targets(@CurrentOrgUser() a: OrgUser) {
    return this.service.targets(a);
  }

  @Get('opportunities')
  @RequirePermissions(P.read)
  list(@CurrentOrgUser() a: OrgUser, @Query() q: ListOpportunitiesQuery) {
    return this.service.list(a, q);
  }

  @Post('opportunities')
  @RequirePermissions(P.create)
  create(@CurrentOrgUser() a: OrgUser, @Body() dto: OpportunityDto) {
    return this.service.create(a, dto);
  }

  @Get('opportunities/:id')
  @RequirePermissions(P.read)
  get(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string) {
    return this.service.get(a, id);
  }

  @Put('opportunities/:id')
  @RequirePermissions(P.create)
  update(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string, @Body() dto: OpportunityDto) {
    return this.service.update(a, id, dto);
  }

  @Post('opportunities/:id/decision')
  @HttpCode(200)
  @RequirePermissions(P.process)
  decide(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string, @Body() dto: DecisionDto) {
    return this.service.decide(a, id, dto);
  }

  @Post('opportunities/:id/collections')
  @RequirePermissions(P.collect)
  collect(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string, @Body() dto: CollectDto) {
    return this.service.collect(a, id, dto);
  }

  @Get('opportunities/:id/receipt')
  @RequirePermissions(P.read)
  receipt(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string, @Query('collection') collection?: string) {
    return this.service.receipt(a, id, collection && /^[0-9a-f-]{36}$/i.test(collection) ? collection : undefined);
  }

  @Post('opportunities/:id/documents')
  @RequirePermissions(P.create)
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: MAX_DOCUMENT_BYTES, files: 1 } }))
  addDocument(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string, @Body() dto: DocumentDto, @UploadedFile() file: Express.Multer.File) {
    return this.service.addDocument(a, id, dto.title, file);
  }

  @Get('opportunities/:id/documents/:docId')
  @RequirePermissions(P.read)
  async document(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string, @Param('docId', uuid) docId: string, @Res() res: Response) {
    const { doc, stream } = await this.service.document(a, id, docId);
    res.setHeader('Content-Type', doc.mimeType);
    res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(doc.fileName)}`);
    stream.pipe(res);
  }

  @Delete('opportunities/:id/documents/:docId')
  @RequirePermissions(P.create)
  removeDocument(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string, @Param('docId', uuid) docId: string) {
    return this.service.removeDocument(a, id, docId);
  }

  @Get('batches')
  @RequirePermissions(P.read)
  batches(@CurrentOrgUser() a: OrgUser, @Query() q: ListBatchesQuery) {
    return this.service.listBatches(a.organizationId, q);
  }

  @Get('batches/:id')
  @RequirePermissions(P.read)
  batch(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string) {
    return this.service.getBatch(a.organizationId, id);
  }

  @Get('journal')
  @RequirePermissions(P.journal)
  journal(@CurrentOrgUser() a: OrgUser, @Query('from') from?: string, @Query('to') to?: string) {
    const d = (s?: string) => (s && /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : undefined);
    return this.ledger.listEntries(a.organizationId, { from: d(from), to: d(to) });
  }

  @Get('dashboard')
  @RequirePermissions(P.reports)
  dashboard(@CurrentOrgUser() a: OrgUser, @Query('from') from?: string, @Query('to') to?: string, @Query('compare') compare?: string) {
    return this.reports.dashboard(a, { from, to, compare });
  }

  @Get('reports/:name')
  @RequirePermissions(P.reports)
  report(@CurrentOrgUser() a: OrgUser, @Param('name') name: string, @Query('from') from?: string, @Query('to') to?: string) {
    return this.reports.report(a, name, { from, to });
  }
}
