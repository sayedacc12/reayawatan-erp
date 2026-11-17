import {
  BadRequestException, Body, Controller, ForbiddenException, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put, Query, Res, UploadedFile, UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { memoryStorage } from 'multer';
import { CurrentOrgUser, OrgUser, RequireAnyPermission, RequirePermissions } from '../../core/auth/decorators';
import { MAX_UPLOAD_BYTES } from '../../core/files/file-store.service';
import { ActionsService } from './actions.service';
import {
  ActionUpdateDto, AreaDto, AssignDto, CloseEngagementDto, ClosureDto, DecisionDto, DocumentDto, EngagementDto, ExtendDto, FindingDto, IssueDto, ItemDto,
  ItemResultDto, PlanDto, SettingsDto, StageDto, SuggestDto, VerifyDto,
} from './audit.dto';
import { AuditCore, today } from './audit-core.service';
import { AUDIT_PERMISSIONS as P } from './audit.manifest';
import { EngagementService } from './engagement.service';
import { InsightsService } from './insights.service';
import { PlanningService } from './planning.service';

const uuid = new ParseUUIDPipe();
const yearOf = (v?: string) => {
  const y = v ? Number(v) : Number(today().slice(0, 4));
  if (!Number.isInteger(y) || y < 2000 || y > 2100) throw new BadRequestException('السنة غير صحيحة');
  return y;
};
const isUuid = (v?: string) => (v && /^[0-9a-f-]{36}$/i.test(v) ? v : undefined);
const upload = () => UseInterceptors(FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 } }));
const sendFile = (res: Response, doc: { mimeType: string; fileName: string }, stream: NodeJS.ReadableStream) => {
  res.setHeader('Content-Type', doc.mimeType);
  res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(doc.fileName)}`);
  stream.pipe(res);
};

/** المراجعة الداخلية المبنية على المخاطر */
@Controller('audit')
export class AuditController {
  constructor(
    private readonly core: AuditCore,
    private readonly planning: PlanningService,
    private readonly engagements: EngagementService,
    private readonly actions: ActionsService,
    private readonly insights: InsightsService,
  ) {}

  // ---------------- اللوحة والإعدادات والقوائم ----------------

  @Get('dashboard')
  @RequirePermissions(P.read)
  dashboard(@CurrentOrgUser() a: OrgUser, @Query('year') year?: string) {
    return this.insights.dashboard(a, yearOf(year));
  }

  @Get('reports')
  @RequirePermissions(P.reports)
  reports(@CurrentOrgUser() a: OrgUser, @Query('year') year?: string) {
    return this.insights.reports(a, yearOf(year));
  }

  @Get('lookups')
  @RequireAnyPermission(P.read, P.respond)
  lookups(@CurrentOrgUser() a: OrgUser) {
    return this.core.lookups(a);
  }

  @Get('settings')
  @RequirePermissions(P.read)
  settings(@CurrentOrgUser() a: OrgUser) {
    return this.core.getSettings(a);
  }

  @Put('settings')
  @RequirePermissions(P.settings)
  saveSettings(@CurrentOrgUser() a: OrgUser, @Body() dto: SettingsDto) {
    return this.core.saveSettings(a, dto);
  }

  // ---------------- مجالات المراجعة ----------------

  @Get('areas')
  @RequirePermissions(P.read)
  areas(@CurrentOrgUser() a: OrgUser) {
    return this.planning.listAreas(a);
  }

  @Post('areas')
  @RequirePermissions(P.universe)
  createArea(@CurrentOrgUser() a: OrgUser, @Body() dto: AreaDto) {
    return this.planning.createArea(a, dto);
  }

  @Patch('areas/:id')
  @RequirePermissions(P.universe)
  updateArea(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string, @Body() dto: AreaDto) {
    return this.planning.updateArea(a, id, dto);
  }

  @Delete('areas/:id')
  @HttpCode(204)
  @RequirePermissions(P.universe)
  removeArea(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string) {
    return this.planning.removeArea(a, id);
  }

  // ---------------- الخطط ----------------

  @Get('plans')
  @RequirePermissions(P.read)
  plans(@CurrentOrgUser() a: OrgUser, @Query('year') year?: string) {
    return this.planning.listPlans(a, yearOf(year));
  }

  @Get('plans/:id')
  @RequirePermissions(P.read)
  plan(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string) {
    return this.planning.getPlan(a, id);
  }

  @Post('plans')
  @RequirePermissions(P.plans)
  createPlan(@CurrentOrgUser() a: OrgUser, @Body() dto: PlanDto) {
    return this.planning.createPlan(a, dto);
  }

  @Patch('plans/:id')
  @RequirePermissions(P.plans)
  updatePlan(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string, @Body() dto: PlanDto) {
    return this.planning.updatePlan(a, id, dto);
  }

  @Delete('plans/:id')
  @HttpCode(204)
  @RequirePermissions(P.plans)
  removePlan(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string) {
    return this.planning.removePlan(a, id);
  }

  @Post('plans/:id/submit')
  @RequirePermissions(P.plans)
  submitPlan(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string) {
    return this.planning.submitPlan(a, id);
  }

  @Post('plans/:id/decision')
  @RequirePermissions(P.approvePlans)
  decide(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string, @Body() dto: DecisionDto) {
    return this.planning.decide(a, id, dto);
  }

  @Post('plans/:id/close')
  @RequirePermissions(P.approvePlans)
  closePlan(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string, @Body() dto: CloseEngagementDto) {
    return this.planning.closePlan(a, id, dto.note);
  }

  @Post('plans/:id/suggest')
  @RequirePermissions(P.engagements)
  suggest(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string, @Body() dto: SuggestDto) {
    return this.planning.suggest(a, id, dto);
  }

  // ---------------- مهام المراجعة ----------------

  @Get('engagements')
  @RequirePermissions(P.read)
  engagementsList(@CurrentOrgUser() a: OrgUser, @Query('year') year?: string, @Query('planId') planId?: string, @Query('status') status?: string, @Query('mine') mine?: string) {
    return this.engagements.list(a, { year: year ? yearOf(year) : undefined, planId: isUuid(planId), status: status && /^[a-z]+$/.test(status) ? status : undefined, mine: mine === '1' });
  }

  @Get('engagements/:id')
  @RequirePermissions(P.read)
  engagement(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string) {
    return this.engagements.get(a, id);
  }

  @Post('engagements')
  @RequirePermissions(P.engagements)
  createEngagement(@CurrentOrgUser() a: OrgUser, @Body() dto: EngagementDto) {
    return this.engagements.create(a, dto);
  }

  @Patch('engagements/:id')
  @RequirePermissions(P.engagements)
  updateEngagement(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string, @Body() dto: EngagementDto) {
    return this.engagements.update(a, id, dto);
  }

  @Delete('engagements/:id')
  @HttpCode(204)
  @RequirePermissions(P.engagements)
  removeEngagement(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string) {
    return this.engagements.remove(a, id);
  }

  @Post('engagements/:id/stage')
  @RequireAnyPermission(P.fieldwork, P.engagements, P.issue)
  stage(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string, @Body() dto: StageDto) {
    if (dto.action === 'cancel' && !a.permissions.includes(P.engagements)) throw new ForbiddenException('إلغاء المهمة لمن يملك صلاحية توزيع المهام');
    if (dto.action === 'submit' && !a.permissions.includes(P.fieldwork)) throw new ForbiddenException('رفع التقرير لفريق المراجعة');
    return this.engagements.stage(a, id, dto, a.permissions.includes(P.issue));
  }

  @Post('engagements/:id/items')
  @RequirePermissions(P.fieldwork)
  addItem(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string, @Body() dto: ItemDto) {
    return this.engagements.addItem(a, id, dto);
  }

  @Patch('engagements/:id/items/:itemId')
  @RequirePermissions(P.fieldwork)
  updateItem(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string, @Param('itemId', uuid) itemId: string, @Body() dto: ItemDto) {
    return this.engagements.updateItem(a, id, itemId, dto);
  }

  @Delete('engagements/:id/items/:itemId')
  @HttpCode(204)
  @RequirePermissions(P.fieldwork)
  removeItem(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string, @Param('itemId', uuid) itemId: string) {
    return this.engagements.removeItem(a, id, itemId);
  }

  @Post('engagements/:id/items/:itemId/result')
  @RequirePermissions(P.fieldwork)
  setResult(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string, @Param('itemId', uuid) itemId: string, @Body() dto: ItemResultDto) {
    return this.engagements.setResult(a, id, itemId, dto);
  }

  @Post('engagements/:id/findings')
  @RequirePermissions(P.fieldwork)
  addFinding(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string, @Body() dto: FindingDto) {
    return this.engagements.addFinding(a, id, dto);
  }

  @Patch('engagements/:id/findings/:findingId')
  @RequireAnyPermission(P.fieldwork, P.issue)
  updateFinding(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string, @Param('findingId', uuid) fid: string, @Body() dto: FindingDto) {
    return this.engagements.updateFinding(a, id, fid, dto);
  }

  @Delete('engagements/:id/findings/:findingId')
  @HttpCode(204)
  @RequirePermissions(P.fieldwork)
  removeFinding(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string, @Param('findingId', uuid) fid: string) {
    return this.engagements.removeFinding(a, id, fid);
  }

  @Post('engagements/:id/issue')
  @RequirePermissions(P.issue)
  issue(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string, @Body() dto: IssueDto) {
    return this.engagements.issue(a, id, dto);
  }

  @Post('engagements/:id/close')
  @RequirePermissions(P.issue)
  closeEngagement(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string, @Body() dto: CloseEngagementDto) {
    return this.engagements.close(a, id, dto.note);
  }

  @Post('engagements/:id/documents')
  @RequireAnyPermission(P.fieldwork, P.issue)
  @upload()
  async addEngagementDoc(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string, @Body() dto: DocumentDto, @UploadedFile() file: Express.Multer.File) {
    const e = await this.engagements.find(a.organizationId, id);
    if (e.status === 'closed' || e.status === 'cancelled') throw new BadRequestException('المهمة مغلقة');
    return this.engagements.addDocument(a, 'engagement', id, dto.title, dto.kind ?? 'evidence', file);
  }

  @Get('engagements/:id/documents/:docId')
  @RequirePermissions(P.read)
  async engagementDoc(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string, @Param('docId', uuid) docId: string, @Res() res: Response) {
    const { doc, stream } = await this.engagements.document(a.organizationId, 'engagement', id, docId);
    sendFile(res, doc, stream);
  }

  @Delete('engagements/:id/documents/:docId')
  @HttpCode(204)
  @RequireAnyPermission(P.fieldwork, P.issue)
  async removeEngagementDoc(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string, @Param('docId', uuid) docId: string) {
    const e = await this.engagements.find(a.organizationId, id);
    if (e.status === 'closed') throw new BadRequestException('المهمة مغلقة، ومستنداتها جزء من سجلها');
    return this.engagements.removeDocument(a.organizationId, 'engagement', id, docId);
  }

  // ---------------- متابعة التوصيات ----------------

  @Get('actions')
  @RequireAnyPermission(P.read, P.respond)
  actionsList(
    @CurrentOrgUser() a: OrgUser, @Query('status') status?: string, @Query('unitId') unitId?: string, @Query('mine') mine?: string,
    @Query('engagementId') engagementId?: string, @Query('priority') priority?: string,
  ) {
    return this.actions.list(a, {
      status: status && /^[a-z_]+$/.test(status) ? status : undefined, unitId: isUuid(unitId), mine: mine === '1', engagementId: isUuid(engagementId),
      priority: priority && /^[a-z]+$/.test(priority) ? priority : undefined,
    });
  }

  /** المهام بصيغة عامة لنظام متابعة المهام والاتصالات الإدارية */
  @Get('actions/feed')
  @RequirePermissions(P.read)
  feed(@CurrentOrgUser() a: OrgUser) {
    return this.actions.feed(a);
  }

  @Get('actions/:id')
  @RequireAnyPermission(P.read, P.respond)
  action(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string) {
    return this.actions.get(a, id);
  }

  @Post('actions/:id/update')
  @RequireAnyPermission(P.respond, P.verify)
  updateAction(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string, @Body() dto: ActionUpdateDto) {
    return this.actions.update(a, id, dto);
  }

  @Post('actions/:id/assign')
  @RequireAnyPermission(P.verify, P.engagements)
  assign(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string, @Body() dto: AssignDto) {
    return this.actions.assign(a, id, dto);
  }

  @Post('actions/:id/closure')
  @RequireAnyPermission(P.respond, P.verify)
  closure(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string, @Body() dto: ClosureDto) {
    return this.actions.submitClosure(a, id, dto);
  }

  @Post('actions/:id/verify')
  @RequirePermissions(P.verify)
  verify(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string, @Body() dto: VerifyDto) {
    return this.actions.verify(a, id, dto);
  }

  @Post('actions/:id/extend')
  @RequirePermissions(P.verify)
  extend(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string, @Body() dto: ExtendDto) {
    return this.actions.extend(a, id, dto);
  }

  @Post('actions/:id/documents')
  @RequireAnyPermission(P.respond, P.verify)
  @upload()
  async addActionDoc(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string, @Body() dto: DocumentDto, @UploadedFile() file: Express.Multer.File) {
    await this.actions.checkDocAccess(a, id, true);
    return this.engagements.addDocument(a, 'action', id, dto.title, dto.kind ?? 'closure', file);
  }

  @Get('actions/:id/documents/:docId')
  @RequireAnyPermission(P.read, P.respond)
  async actionDoc(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string, @Param('docId', uuid) docId: string, @Res() res: Response) {
    await this.actions.checkDocAccess(a, id, false);
    const { doc, stream } = await this.engagements.document(a.organizationId, 'action', id, docId);
    sendFile(res, doc, stream);
  }

  @Delete('actions/:id/documents/:docId')
  @HttpCode(204)
  @RequireAnyPermission(P.respond, P.verify)
  async removeActionDoc(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string, @Param('docId', uuid) docId: string) {
    const act = await this.actions.checkDocAccess(a, id, true);
    if (act.status === 'submitted') throw new BadRequestException('تقرير الإغلاق بانتظار التحقق، لا تُحذف مستنداته');
    return this.engagements.removeDocument(a.organizationId, 'action', id, docId);
  }
}
