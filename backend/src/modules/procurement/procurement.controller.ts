import {
  BadRequestException, Body, ConflictException, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put, Query, Res, StreamableFile, UploadedFile, UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Response } from 'express';
import { ReadStream } from 'fs';
import { memoryStorage } from 'multer';
import { DataSource } from 'typeorm';
import { CurrentOrgUser, OrgUser, RequireAnyPermission, RequirePermissions } from '../../core/auth/decorators';
import { MAX_UPLOAD_BYTES } from '../../core/files/file-store.service';
import { CatalogService } from './catalog.service';
import { PrSettings, PrSupplierCategory } from './entities/procurement.entity';
import {
  ActiveDto, AlternativeDto, BankDecisionDto, BankDto, DocMetaDto, DocReviewDto, InviteUserDto, ItemDto, LinkPartnerDto, ItemGroupDto, LocationDto, SettingsDto, StopItemDto,
  SupplierCategoriesDto, SupplierDecisionDto, SupplierDto, SuspendDto, UomDto, WarehouseDto,
} from './procurement.dto';
import { PROCUREMENT_PERMISSIONS as P } from './procurement.manifest';
import { ProcurementCore } from './procurement-core.service';
import { staffActor, SuppliersService } from './suppliers.service';
import { WarehousesService } from './warehouses.service';

const uuid = new ParseUUIDPipe();
const upload = FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 } });
const SUP_READ = [P.suppliersRead, P.suppliers, P.approveSuppliers, P.approveBanks];

export function sendFile(res: Response, f: { stream: ReadStream; mime: string; name: string }) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', 'private, no-store');
  return new StreamableFile(f.stream, { type: f.mime, disposition: `inline; filename*=UTF-8''${encodeURIComponent(f.name)}` });
}

/** المشتريات والمستودعات: الإعدادات، والأصناف، والمستودعات، والموردون */
@Controller('procurement')
export class ProcurementController {
  constructor(
    private readonly db: DataSource, private readonly core: ProcurementCore, private readonly catalog: CatalogService,
    private readonly warehouses: WarehousesService, private readonly suppliers: SuppliersService,
  ) {}

  // ---------------- اللوحة والإعدادات ----------------

  @Get('lookups') @RequireAnyPermission(P.read, ...SUP_READ)
  lookups(@CurrentOrgUser() a: OrgUser) { return this.core.lookups(a.organizationId); }

  @Get('dashboard') @RequirePermissions(P.read)
  async dashboard(@CurrentOrgUser() a: OrgUser) {
    const org = a.organizationId;
    await this.core.settings(org);
    const [[items], [wh], sup, expiring, approvals] = await Promise.all([
      this.db.query(`SELECT COUNT(*)::int AS total, COUNT(*) FILTER (WHERE status = 'active')::int AS active, COUNT(*) FILTER (WHERE kind = 'service')::int AS services,
                            COUNT(*) FILTER (WHERE kind = 'asset')::int AS assets, COUNT(*) FILTER (WHERE track_expiry)::int AS expiry FROM pr_items WHERE organization_id = $1`, [org]),
      this.db.query(`SELECT COUNT(*)::int AS total, COUNT(*) FILTER (WHERE is_active)::int AS active,
                            (SELECT COUNT(*)::int FROM pr_locations WHERE organization_id = $1) AS locations FROM pr_warehouses WHERE organization_id = $1`, [org]),
      this.db.query(`SELECT status, COUNT(*)::int AS n FROM pr_suppliers WHERE organization_id = $1 GROUP BY status`, [org]),
      this.suppliers.expiringDocs(org),
      this.suppliers.approvals(a),
    ]);
    const groups = await this.db.query(
      `SELECT g.name, COUNT(i.id)::int AS n FROM pr_item_groups g LEFT JOIN pr_items i ON i.group_id = g.id AND i.status = 'active'
        WHERE g.organization_id = $1 GROUP BY g.id, g.name, g.sort_order ORDER BY g.sort_order`, [org]);
    const activities = await this.db.query(
      `SELECT a AS name, COUNT(*)::int AS n FROM pr_suppliers s, jsonb_array_elements_text(s.activities) a
        WHERE s.organization_id = $1 AND s.status = 'approved' GROUP BY a ORDER BY n DESC LIMIT 8`, [org]);
    return {
      items, warehouses: wh, suppliers: Object.fromEntries(sup.map((r: { status: string; n: number }) => [r.status, r.n])),
      expiring, approvals: { suppliers: approvals.suppliers.length, docs: approvals.docs.length, banks: approvals.banks.length },
      groups, activities, portalUrl: await this.suppliers.portalUrl(org),
    };
  }

  @Put('settings') @RequirePermissions(P.settings)
  async saveSettings(@CurrentOrgUser() a: OrgUser, @Body() dto: SettingsDto) {
    const org = a.organizationId;
    await this.core.settings(org);
    if (dto.supplierDocTypes) {
      const keys = dto.supplierDocTypes.map((d) => d.key);
      if (new Set(keys).size !== keys.length) throw new BadRequestException('رمز المستند مكرر');
    }
    if (dto.partnerCategoryId) {
      const [c] = await this.db.query(`SELECT id FROM acc_partner_categories WHERE organization_id = $1 AND id = $2 AND behavior = 'supplier'`, [org, dto.partnerCategoryId]);
      if (!c) throw new BadRequestException('اختر تصنيفًا سلوكه «مورد» من تصنيفات النظام المالي');
    }
    await this.core.account(org, dto.payablesAccountId, 'liabilities', 'حساب الدائنين');
    const patch: Partial<PrSettings> = {};
    for (const k of ['valuation', 'accountLevel', 'docAlertDays', 'supplierDocTypes', 'portalOpen', 'portalIntro', 'partnerCategoryId', 'payablesAccountId'] as const) {
      if (dto[k] !== undefined) (patch as Record<string, unknown>)[k] = dto[k];
    }
    if (dto.activities) patch.activities = [...new Set(dto.activities.map((x) => x.trim()).filter(Boolean))];
    await this.db.getRepository(PrSettings).update({ organizationId: org }, patch);
    return this.core.lookups(org);
  }

  @Put('supplier-categories') @RequirePermissions(P.settings)
  async saveCategories(@CurrentOrgUser() a: OrgUser, @Body() dto: SupplierCategoriesDto) {
    const org = a.organizationId;
    await this.core.settings(org);
    await this.db.transaction(async (em) => {
      const repo = em.getRepository(PrSupplierCategory);
      const existing = await repo.find({ where: { organizationId: org } });
      const kept = new Set(dto.categories.map((c) => c.id).filter(Boolean));
      for (const c of existing.filter((x) => !kept.has(x.id))) {
        const [used] = await em.query('SELECT COUNT(*)::int AS n FROM pr_suppliers WHERE organization_id = $1 AND category_ids ? $2', [org, c.id]);
        if (used.n) throw new ConflictException(`التصنيف «${c.name}» مستخدم لـ${used.n} مورد، أوقفه بدل حذفه`);
        await repo.delete({ id: c.id });
      }
      for (const [i, c] of dto.categories.entries()) {
        const row = { name: c.name.trim(), description: c.description ?? null, color: c.color, isActive: c.isActive, sortOrder: i };
        if (c.id && existing.some((x) => x.id === c.id)) await repo.update({ id: c.id }, row);
        else await repo.insert({ organizationId: org, ...row });
      }
    });
    return this.core.lookups(org);
  }

  // ---------------- وحدات القياس والمجموعات ----------------

  @Get('uoms') @RequirePermissions(P.read)
  uoms(@CurrentOrgUser() a: OrgUser) { return this.catalog.uoms(a.organizationId); }

  @Post('uoms') @RequirePermissions(P.items)
  createUom(@CurrentOrgUser() a: OrgUser, @Body() dto: UomDto) { return this.catalog.createUom(a, dto); }

  @Patch('uoms/:id') @RequirePermissions(P.items)
  updateUom(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string, @Body() dto: UomDto) { return this.catalog.updateUom(a, id, dto); }

  @Delete('uoms/:id') @RequirePermissions(P.items)
  removeUom(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string) { return this.catalog.removeUom(a, id); }

  @Get('groups') @RequirePermissions(P.read)
  groups(@CurrentOrgUser() a: OrgUser) { return this.catalog.groups(a.organizationId); }

  @Post('groups') @RequirePermissions(P.items)
  createGroup(@CurrentOrgUser() a: OrgUser, @Body() dto: ItemGroupDto) { return this.catalog.createGroup(a, dto); }

  @Patch('groups/:id') @RequirePermissions(P.items)
  updateGroup(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string, @Body() dto: ItemGroupDto) { return this.catalog.updateGroup(a, id, dto); }

  @Delete('groups/:id') @RequirePermissions(P.items)
  removeGroup(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string) { return this.catalog.removeGroup(a, id); }

  // ---------------- الأصناف ----------------

  @Get('items') @RequirePermissions(P.read)
  items(@CurrentOrgUser() a: OrgUser, @Query() q: Record<string, string>) { return this.catalog.items(a.organizationId, q); }

  @Get('items-similar') @RequirePermissions(P.read)
  similar(@CurrentOrgUser() a: OrgUser, @Query('name') name = '', @Query('except') except?: string) {
    return this.catalog.similar(a.organizationId, String(name).slice(0, 250), except && /^[0-9a-f-]{36}$/.test(except) ? except : undefined);
  }

  @Post('items') @RequirePermissions(P.items)
  createItem(@CurrentOrgUser() a: OrgUser, @Body() dto: ItemDto) { return this.catalog.createItem(a, dto); }

  @Get('items/:id') @RequirePermissions(P.read)
  item(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string) { return this.catalog.item(a.organizationId, id); }

  @Put('items/:id') @RequirePermissions(P.items)
  updateItem(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string, @Body() dto: ItemDto) { return this.catalog.updateItem(a, id, dto); }

  @Post('items/:id/stop') @HttpCode(200) @RequirePermissions(P.items)
  stopItem(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string, @Body() dto: StopItemDto) { return this.catalog.stopItem(a, id, dto); }

  @Post('items/:id/reactivate') @HttpCode(200) @RequirePermissions(P.items)
  reactivateItem(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string) { return this.catalog.reactivateItem(a, id); }

  @Post('items/:id/alternatives') @HttpCode(200) @RequirePermissions(P.items)
  addAlternative(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string, @Body() dto: AlternativeDto) { return this.catalog.addAlternative(a, id, dto); }

  @Delete('items/:id/alternatives/:other') @RequirePermissions(P.items)
  removeAlternative(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string, @Param('other', uuid) other: string) { return this.catalog.removeAlternative(a, id, other); }

  @Post('items/:id/image') @HttpCode(200) @RequirePermissions(P.items) @UseInterceptors(upload)
  setImage(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string, @UploadedFile() file: Express.Multer.File) { return this.catalog.setImage(a, id, file); }

  @Post('items/:id/attachments') @HttpCode(200) @RequirePermissions(P.items) @UseInterceptors(upload)
  addAttachment(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string, @UploadedFile() file: Express.Multer.File) { return this.catalog.addAttachment(a, id, file); }

  @Delete('items/:id/attachments/:key') @RequirePermissions(P.items)
  removeAttachment(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string, @Param('key', uuid) key: string) { return this.catalog.removeAttachment(a, id, key); }

  @Get('items/:id/files/:key') @RequirePermissions(P.read)
  async itemFile(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string, @Param('key') key: string, @Res({ passthrough: true }) res: Response) {
    if (key !== 'image' && !/^[0-9a-f-]{36}$/.test(key)) throw new BadRequestException('مرفق غير صحيح');
    return sendFile(res, await this.catalog.file(a.organizationId, id, key));
  }

  // ---------------- المستودعات ----------------

  @Get('warehouses') @RequirePermissions(P.read)
  warehouseList(@CurrentOrgUser() a: OrgUser) { return this.warehouses.list(a.organizationId); }

  @Post('warehouses') @RequirePermissions(P.warehouses)
  createWarehouse(@CurrentOrgUser() a: OrgUser, @Body() dto: WarehouseDto) { return this.warehouses.create(a, dto); }

  @Get('warehouses/:id') @RequirePermissions(P.read)
  warehouse(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string) { return this.warehouses.get(a.organizationId, id); }

  @Put('warehouses/:id') @RequirePermissions(P.warehouses)
  updateWarehouse(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string, @Body() dto: WarehouseDto) { return this.warehouses.update(a, id, dto); }

  @Post('warehouses/:id/locations') @RequirePermissions(P.warehouses)
  createLocation(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string, @Body() dto: LocationDto) { return this.warehouses.createLocation(a, id, dto); }

  @Put('warehouses/:id/locations/:loc') @RequirePermissions(P.warehouses)
  updateLocation(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string, @Param('loc', uuid) loc: string, @Body() dto: LocationDto) {
    return this.warehouses.updateLocation(a, id, loc, dto);
  }

  @Delete('warehouses/:id/locations/:loc') @RequirePermissions(P.warehouses)
  removeLocation(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string, @Param('loc', uuid) loc: string) { return this.warehouses.removeLocation(a, id, loc); }

  // ---------------- الموردون ----------------

  @Get('suppliers') @RequireAnyPermission(...SUP_READ)
  supplierList(@CurrentOrgUser() a: OrgUser, @Query() q: Record<string, string>) { return this.suppliers.list(a.organizationId, q); }

  @Get('supplier-approvals') @RequireAnyPermission(P.approveSuppliers, P.approveBanks)
  approvals(@CurrentOrgUser() a: OrgUser) { return this.suppliers.approvals(a); }

  @Post('suppliers') @RequirePermissions(P.suppliers)
  createSupplier(@CurrentOrgUser() a: OrgUser, @Body() dto: SupplierDto) { return this.suppliers.create(a, dto); }

  @Get('suppliers/:id') @RequireAnyPermission(...SUP_READ)
  supplier(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string) { return this.suppliers.get(a.organizationId, id); }

  @Put('suppliers/:id') @RequirePermissions(P.suppliers)
  updateSupplier(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string, @Body() dto: SupplierDto) { return this.suppliers.update(a, id, dto); }

  @Post('suppliers/:id/decision') @HttpCode(200) @RequirePermissions(P.approveSuppliers)
  decide(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string, @Body() dto: SupplierDecisionDto) { return this.suppliers.decide(a, id, dto); }

  @Post('suppliers/:id/suspend') @HttpCode(200) @RequirePermissions(P.approveSuppliers)
  suspend(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string, @Body() dto: SuspendDto) { return this.suppliers.suspend(a, id, dto); }

  @Post('suppliers/:id/reactivate') @HttpCode(200) @RequirePermissions(P.approveSuppliers)
  reactivate(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string) { return this.suppliers.reactivate(a, id); }

  @Post('suppliers/:id/partner') @HttpCode(200) @RequirePermissions(P.suppliers)
  createPartner(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string) { return this.suppliers.createPartner(a, id); }

  @Put('suppliers/:id/partner') @RequirePermissions(P.suppliers)
  linkPartner(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string, @Body() dto: LinkPartnerDto) {
    return this.suppliers.linkPartner(a, id, dto.partnerId ?? null);
  }

  @Post('suppliers/:id/docs') @HttpCode(200) @RequirePermissions(P.suppliers) @UseInterceptors(upload)
  async addDoc(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string, @Body() dto: DocMetaDto, @UploadedFile() file: Express.Multer.File) {
    await this.suppliers.addDoc(a.organizationId, id, dto, file, staffActor(a));
    return this.suppliers.get(a.organizationId, id);
  }

  @Post('suppliers/:id/docs/:doc/review') @HttpCode(200) @RequirePermissions(P.approveSuppliers)
  reviewDoc(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string, @Param('doc', uuid) doc: string, @Body() dto: DocReviewDto) {
    return this.suppliers.reviewDoc(a, id, doc, dto);
  }

  @Get('suppliers/:id/docs/:doc/file') @RequireAnyPermission(...SUP_READ)
  async docFile(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string, @Param('doc', uuid) doc: string, @Res({ passthrough: true }) res: Response) {
    return sendFile(res, await this.suppliers.docFile(a.organizationId, id, doc));
  }

  @Delete('suppliers/:id/docs/:doc') @RequirePermissions(P.suppliers)
  async removeDoc(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string, @Param('doc', uuid) doc: string) {
    await this.suppliers.removeDoc(a.organizationId, id, doc, staffActor(a));
    return this.suppliers.get(a.organizationId, id);
  }

  @Post('suppliers/:id/banks') @HttpCode(200) @RequirePermissions(P.suppliers) @UseInterceptors(upload)
  async addBank(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string, @Body() dto: BankDto, @UploadedFile() file?: Express.Multer.File) {
    await this.suppliers.addBank(a.organizationId, id, dto, file, staffActor(a));
    return this.suppliers.get(a.organizationId, id);
  }

  @Post('suppliers/:id/banks/:bank/decision') @HttpCode(200) @RequirePermissions(P.approveBanks)
  decideBank(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string, @Param('bank', uuid) bank: string, @Body() dto: BankDecisionDto) {
    return this.suppliers.decideBank(a, id, bank, dto);
  }

  @Get('suppliers/:id/banks/:bank/file') @RequireAnyPermission(...SUP_READ)
  async bankFile(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string, @Param('bank', uuid) bank: string, @Res({ passthrough: true }) res: Response) {
    return sendFile(res, await this.suppliers.bankFile(a.organizationId, id, bank));
  }

  @Post('suppliers/:id/users') @HttpCode(200) @RequirePermissions(P.suppliers)
  inviteUser(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string, @Body() dto: InviteUserDto) { return this.suppliers.inviteUser(a, id, dto); }

  @Post('suppliers/:id/users/:user/reset') @HttpCode(200) @RequirePermissions(P.suppliers)
  resetUser(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string, @Param('user', uuid) user: string) { return this.suppliers.resetUser(a, id, user); }

  @Post('suppliers/:id/users/:user/active') @HttpCode(200) @RequirePermissions(P.suppliers)
  setUserActive(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string, @Param('user', uuid) user: string, @Body() dto: ActiveDto) {
    return this.suppliers.setUserActive(a, id, user, dto.active);
  }
}
