import { BadRequestException, Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Put, Query } from '@nestjs/common';
import { CurrentOrgUser, OrgUser, RequireAnyPermission, RequirePermissions } from '../../core/auth/decorators';
import { PlanningCore } from './planning-core.service';
import { PlanningViews } from './planning-views.service';
import {
  CarryDto, ConfigDto, CopyPlanDto, DecideDto, ItemDto, KpiDto, LinkDto, PlanDto, ProgressDto, ReadingDto, RefDto, SubmitDto, UpdateItemDto, UpdateKpiDto, UpdateLinkDto, UpdatePlanDto,
} from './planning.dto';
import { PLANNING_PERMISSIONS as P } from './planning.manifest';
import { PlansService } from './plans.service';

const uuid = new ParseUUIDPipe();
const EDIT = [P.strategic, P.operational];
const ver = (v: string) => {
  if (!/^\d{1,4}$/.test(v)) throw new BadRequestException('رقم الإصدار غير صحيح');
  return Number(v);
};

/** التخطيط الاستراتيجي والتشغيلي */
@Controller('planning')
export class PlanningController {
  constructor(private readonly core: PlanningCore, private readonly plans: PlansService, private readonly views: PlanningViews) {}

  // ---------------- اللوحة والقوائم ----------------

  @Get('dashboard') @RequirePermissions(P.read)
  dashboard(@CurrentOrgUser() a: OrgUser, @Query('year') year?: string) { return this.views.dashboard(a, year); }

  @Get('approvals') @RequirePermissions(P.read)
  approvals(@CurrentOrgUser() a: OrgUser) { return this.views.approvals(a); }

  @Get('execution') @RequirePermissions(P.read)
  execution(@CurrentOrgUser() a: OrgUser, @Query() q: Record<string, string>) { return this.views.execution(a, q); }

  @Get('kpis') @RequirePermissions(P.read)
  kpis(@CurrentOrgUser() a: OrgUser, @Query() q: Record<string, string>) { return this.views.kpis(a, q); }

  @Get('config') @RequirePermissions(P.read)
  config(@CurrentOrgUser() a: OrgUser) { return this.core.getConfig(a); }

  @Put('config') @RequirePermissions(P.settings)
  saveConfig(@CurrentOrgUser() a: OrgUser, @Body() dto: ConfigDto) { return this.core.saveConfig(a, dto.config); }

  @Get('lookups') @RequirePermissions(P.read)
  lookups(@CurrentOrgUser() a: OrgUser) { return this.core.lookups(a); }

  @Get('link-options') @RequirePermissions(P.read)
  linkOptions(@CurrentOrgUser() a: OrgUser) { return this.plans.linkOptions(a); }

  // ---------------- الخطط ----------------

  @Get('plans') @RequirePermissions(P.read)
  list(@CurrentOrgUser() a: OrgUser, @Query() q: Record<string, string>) { return this.plans.list(a, q); }

  @Post('plans') @RequireAnyPermission(...EDIT)
  create(@CurrentOrgUser() a: OrgUser, @Body() dto: PlanDto) { return this.plans.create(a, dto); }

  @Get('plans/:id') @RequirePermissions(P.read)
  get(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string) { return this.plans.get(a, id); }

  @Patch('plans/:id') @RequireAnyPermission(...EDIT)
  update(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string, @Body() dto: UpdatePlanDto) { return this.plans.update(a, id, dto); }

  @Delete('plans/:id') @RequireAnyPermission(...EDIT)
  remove(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string) { return this.plans.remove(a, id); }

  @Post('plans/:id/copy') @RequireAnyPermission(...EDIT)
  copy(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string, @Body() dto: CopyPlanDto) { return this.plans.copy(a, id, dto); }

  @Post('plans/:id/submit') @RequireAnyPermission(...EDIT)
  submit(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string, @Body() dto: SubmitDto) { return this.plans.submit(a, id, dto.note ?? null); }

  @Post('plans/:id/decision') @RequirePermissions(P.approve)
  decide(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string, @Body() dto: DecideDto) { return this.plans.decide(a, id, dto); }

  @Post('plans/:id/discard') @RequireAnyPermission(...EDIT)
  discard(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string) { return this.plans.discard(a, id); }

  @Get('plans/:id/versions/:v') @RequirePermissions(P.read)
  version(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string, @Param('v') v: string) { return this.plans.version(a, id, ver(v)); }

  @Get('plans/:id/compare') @RequirePermissions(P.read)
  compare(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string, @Query('from') from: string, @Query('to') to?: string) {
    return this.plans.compare(a, id, ver(from), to ? ver(to) : 0);
  }

  // ---------------- العناصر ----------------

  @Post('plans/:id/items') @RequireAnyPermission(...EDIT)
  addItem(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string, @Body() dto: ItemDto) { return this.plans.addItem(a, id, dto); }

  @Patch('items/:id') @RequireAnyPermission(...EDIT)
  updateItem(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string, @Body() dto: UpdateItemDto) { return this.plans.updateItem(a, id, dto); }

  @Delete('items/:id') @RequireAnyPermission(...EDIT)
  removeItem(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string) { return this.plans.removeItem(a, id); }

  @Post('items/:id/progress') @RequirePermissions(P.progress)
  progress(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string, @Body() dto: ProgressDto) { return this.plans.progress(a, id, dto); }

  @Get('items/:id/updates') @RequirePermissions(P.read)
  updates(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string) { return this.plans.itemUpdates(a, id); }

  @Post('items/:id/carry') @RequirePermissions(P.operational)
  carry(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string, @Body() dto: CarryDto) { return this.plans.carry(a, id, dto); }

  @Post('items/:id/refs') @RequireAnyPermission(...EDIT)
  addRef(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string, @Body() dto: RefDto) { return this.plans.addRef(a, id, dto); }

  @Delete('refs/:id') @RequireAnyPermission(...EDIT)
  removeRef(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string) { return this.plans.removeRef(a, id); }

  // ---------------- العلاقات ----------------

  @Post('links') @RequireAnyPermission(...EDIT)
  addLink(@CurrentOrgUser() a: OrgUser, @Body() dto: LinkDto) { return this.plans.addLink(a, dto); }

  @Patch('links/:id') @RequireAnyPermission(...EDIT)
  updateLink(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string, @Body() dto: UpdateLinkDto) { return this.plans.updateLink(a, id, dto); }

  @Delete('links/:id') @RequireAnyPermission(...EDIT)
  removeLink(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string) { return this.plans.removeLink(a, id); }

  // ---------------- المؤشرات ----------------

  @Post('plans/:id/kpis') @RequireAnyPermission(P.kpis, ...EDIT)
  createKpi(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string, @Body() dto: KpiDto) { return this.plans.createKpi(a, id, dto); }

  @Patch('kpis/:id') @RequireAnyPermission(P.kpis, ...EDIT)
  updateKpi(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string, @Body() dto: UpdateKpiDto) { return this.plans.updateKpi(a, id, dto); }

  @Delete('kpis/:id') @RequireAnyPermission(P.kpis, ...EDIT)
  removeKpi(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string) { return this.plans.removeKpi(a, id); }

  @Put('kpis/:id/readings') @RequirePermissions(P.progress)
  reading(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string, @Body() dto: ReadingDto) { return this.plans.reading(a, id, dto); }

  @Delete('kpis/:id/readings/:period') @RequirePermissions(P.progress)
  removeReading(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string, @Param('period') period: string) { return this.plans.removeReading(a, id, period); }
}
