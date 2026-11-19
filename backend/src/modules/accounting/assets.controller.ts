import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Put, Query, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Response } from 'express';
import { memoryStorage } from 'multer';
import { CurrentOrgUser, OrgUser, RequireAnyPermission, RequirePermissions } from '../../core/auth/decorators';
import { MAX_UPLOAD_BYTES } from '../../core/files/file-store.service';
import { AssetOpsService } from './asset-ops.service';
import { ACC_PERMISSIONS as P } from './accounting.manifest';
import { AssetsService } from './assets.service';

const uuid = new ParseUUIDPipe();
type Dto = Record<string, unknown>;
const READ = [P.assetsRead, P.assetsManage, P.assetsOperate, P.assetsDepreciate, P.assetsCustody];

/** الأصول الثابتة داخل النظام المالي */
@Controller('accounting/assets')
export class AssetsController {
  constructor(private readonly assets: AssetsService, private readonly ops: AssetOpsService) {}

  // ---------------- اللوحة والإعدادات ----------------

  @Get('dashboard')
  @RequireAnyPermission(...READ)
  dashboard(@CurrentOrgUser() a: OrgUser) {
    return this.ops.dashboard(a);
  }

  @Get('lookups')
  @RequireAnyPermission(...READ)
  lookups(@CurrentOrgUser() a: OrgUser) {
    return this.assets.lookups(a);
  }

  @Get('config')
  @RequireAnyPermission(...READ, P.settings)
  config(@CurrentOrgUser() a: OrgUser) {
    return this.assets.getConfig(a);
  }

  @Put('config')
  @RequirePermissions(P.settings)
  saveConfig(@CurrentOrgUser() a: OrgUser, @Body() b: Dto) {
    return this.assets.saveConfig(a, b);
  }

  @Get('reconciliation')
  @RequireAnyPermission(...READ)
  reconcile(@CurrentOrgUser() a: OrgUser, @Query('asOf') asOf?: string) {
    return this.ops.reconcile(a, asOf);
  }

  // ---------------- المجموعات ----------------

  @Get('groups')
  @RequireAnyPermission(...READ)
  groups(@CurrentOrgUser() a: OrgUser) {
    return this.assets.listGroups(a);
  }

  @Post('groups')
  @RequirePermissions(P.assetsManage)
  createGroup(@CurrentOrgUser() a: OrgUser, @Body() b: Dto) {
    return this.assets.createGroup(a, b);
  }

  @Patch('groups/:id')
  @RequirePermissions(P.assetsManage)
  updateGroup(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string, @Body() b: Dto) {
    return this.assets.updateGroup(a, id, b);
  }

  @Delete('groups/:id')
  @RequirePermissions(P.assetsManage)
  deleteGroup(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string) {
    return this.assets.deleteGroup(a, id);
  }

  // ---------------- الأرصدة الافتتاحية ----------------

  @Get('opening')
  @RequireAnyPermission(...READ)
  opening(@CurrentOrgUser() a: OrgUser) {
    return this.assets.openingList(a);
  }

  @Post('opening')
  @RequirePermissions(P.assetsManage)
  saveOpening(@CurrentOrgUser() a: OrgUser, @Body() b: Dto) {
    return this.assets.saveOpening(a, b);
  }

  @Delete('opening/:id')
  @RequirePermissions(P.assetsManage)
  deleteOpening(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string) {
    return this.assets.deleteOpening(a, id);
  }

  // ---------------- العمليات ----------------

  @Get('operations')
  @RequireAnyPermission(...READ)
  operations(@CurrentOrgUser() a: OrgUser, @Query('kind') kind?: string, @Query('status') status?: string, @Query('assetId') assetId?: string) {
    return this.ops.operations(a, { kind, status, assetId: assetId && /^[0-9a-f-]{36}$/i.test(assetId) ? assetId : undefined });
  }

  @Post('operations/purchase')
  @RequirePermissions(P.assetsOperate)
  purchase(@CurrentOrgUser() a: OrgUser, @Body() b: Dto) {
    return this.ops.purchase(a, b);
  }

  @Post('operations/donation')
  @RequirePermissions(P.assetsOperate)
  donation(@CurrentOrgUser() a: OrgUser, @Body() b: Dto) {
    return this.ops.donation(a, b);
  }

  @Post('operations/sale')
  @RequirePermissions(P.assetsOperate)
  sale(@CurrentOrgUser() a: OrgUser, @Body() b: Dto) {
    return this.ops.sale(a, b);
  }

  @Post('operations/scrap')
  @RequirePermissions(P.assetsOperate)
  scrap(@CurrentOrgUser() a: OrgUser, @Body() b: Dto) {
    return this.ops.scrap(a, b);
  }

  @Post('operations/:id/cancel')
  @RequirePermissions(P.assetsReverse)
  cancelOp(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string, @Body('reason') reason: unknown) {
    return this.ops.cancelOperation(a, id, reason);
  }

  // ---------------- الإهلاك ----------------

  @Post('depreciation/preview')
  @RequirePermissions(P.assetsDepreciate)
  preview(@CurrentOrgUser() a: OrgUser, @Body() b: Dto) {
    return this.ops.preview(a, b);
  }

  @Post('depreciation/post')
  @RequirePermissions(P.assetsDepreciate)
  post(@CurrentOrgUser() a: OrgUser, @Body() b: Dto) {
    return this.ops.post(a, b);
  }

  @Get('runs')
  @RequireAnyPermission(...READ)
  runs(@CurrentOrgUser() a: OrgUser) {
    return this.ops.runs(a);
  }

  @Get('runs/:id')
  @RequireAnyPermission(...READ)
  run(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string) {
    return this.ops.run(a, id);
  }

  @Post('runs/:id/cancel')
  @RequirePermissions(P.assetsReverse)
  cancelRun(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string, @Body('reason') reason: unknown) {
    return this.ops.cancelRun(a, id, reason);
  }

  // ---------------- العهد ----------------

  @Get('custody')
  @RequireAnyPermission(...READ)
  custody(@CurrentOrgUser() a: OrgUser) {
    return this.assets.custodyBoard(a);
  }

  @Get('custody/employee/:id')
  @RequireAnyPermission(...READ)
  async custodyOfEmployee(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string) {
    return { held: await this.assets.list(a, { custodian: id }), forms: await this.assets.custodyOf(a.organizationId, null, id) };
  }

  @Get('custody/forms/:id')
  @RequireAnyPermission(...READ)
  custodyForm(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string) {
    return this.assets.custodyForm(a, id);
  }

  @Post('custody/forms/:id/confirm')
  confirmCustody(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string) {
    return this.assets.confirmCustody(a, id);
  }

  // ---------------- الجرد الدوري ----------------

  @Get('stocktakes')
  @RequireAnyPermission(...READ)
  stocktakes(@CurrentOrgUser() a: OrgUser) {
    return this.assets.stocktakes(a);
  }

  @Post('stocktakes')
  @RequirePermissions(P.assetsCustody)
  createStocktake(@CurrentOrgUser() a: OrgUser, @Body() b: Dto) {
    return this.assets.createStocktake(a, b);
  }

  @Get('stocktakes/:id')
  @RequireAnyPermission(...READ)
  stocktake(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string) {
    return this.assets.stocktake(a, id);
  }

  @Post('stocktakes/:id/count')
  @RequirePermissions(P.assetsCustody)
  count(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string, @Body() b: Dto) {
    return this.assets.count(a, id, b);
  }

  @Post('stocktakes/:id/close')
  @RequirePermissions(P.assetsCustody)
  closeStocktake(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string) {
    return this.assets.closeStocktake(a, id);
  }

  @Get('labels')
  @RequireAnyPermission(...READ)
  labels(@CurrentOrgUser() a: OrgUser, @Query('base') base: string, @Query('ids') ids?: string) {
    return this.assets.labels(a, (ids ?? '').split(',').filter((x) => /^[0-9a-f-]{36}$/i.test(x)), base ?? '');
  }

  // ---------------- بطاقات الأصول ----------------

  @Get()
  @RequireAnyPermission(...READ)
  list(@CurrentOrgUser() a: OrgUser, @Query() q: Record<string, string>) {
    return this.assets.list(a, { q: q.q, groupId: q.groupId, status: q.status, custodian: q.custodian, unitId: q.unitId });
  }

  @Post()
  @RequirePermissions(P.assetsManage)
  create(@CurrentOrgUser() a: OrgUser, @Body() b: Dto) {
    return this.assets.create(a, b);
  }

  @Get('by-code/:code')
  @RequireAnyPermission(...READ)
  byCode(@CurrentOrgUser() a: OrgUser, @Param('code') code: string) {
    return this.assets.byCode(a, code.slice(0, 40));
  }

  @Get(':id')
  @RequireAnyPermission(...READ)
  get(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string) {
    return this.assets.get(a, id);
  }

  @Patch(':id')
  @RequirePermissions(P.assetsManage)
  update(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string, @Body() b: Dto) {
    return this.assets.update(a, id, b);
  }

  @Delete(':id')
  @RequirePermissions(P.assetsManage)
  remove(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string) {
    return this.assets.remove(a, id);
  }

  @Post(':id/custody')
  @RequirePermissions(P.assetsCustody)
  moveCustody(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string, @Body() b: Dto) {
    return this.assets.moveCustody(a, id, b);
  }

  @Post(':id/image')
  @RequirePermissions(P.assetsManage)
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 } }))
  setImage(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string, @UploadedFile() file: Express.Multer.File) {
    return this.assets.setImage(a, id, file);
  }

  @Delete(':id/image')
  @RequirePermissions(P.assetsManage)
  removeImage(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string) {
    return this.assets.removeImage(a, id);
  }

  @Get(':id/image')
  @RequireAnyPermission(...READ)
  async image(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string, @Res() res: Response) {
    const f = await this.assets.image(a, id);
    res.setHeader('Content-Type', f.mime);
    res.setHeader('Cache-Control', 'private, max-age=300');
    f.stream.pipe(res);
  }
}
