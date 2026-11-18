import { Body, Controller, Delete, Get, HttpCode, Param, ParseIntPipe, Post, Put, Query, Req } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { CurrentOrgUser, OrgUser, Public, RequireAnyPermission, RequirePermissions } from '../../core/auth/decorators';
import { PtContractsService } from './contracts.service';
import {
  CategoriesDto, ChangesDto, ClassesDto, ClauseDto, CriteriaDto, DecisionDto, EvaluationDto, FollowupDoneDto, FollowupDto, GeneralSettingsDto, ManualSignDto,
  NewContractDto, NoteDto, OrderDto, PartnerDto, PartnerStatusDto, ReasonDto, SignDto, TypesDto, UpdateContractDto,
} from './partnerships.dto';
import { PARTNERSHIP_PERMISSIONS as P } from './partnerships.manifest';
import { PartnershipsService } from './partnerships.service';

@Controller('partnerships')
export class PartnershipsController {
  constructor(private readonly pt: PartnershipsService, private readonly contracts: PtContractsService) {}

  // ---------- الإعدادات ----------

  @Get('lookups')
  @RequireAnyPermission(P.read, P.settings)
  lookups(@CurrentOrgUser() u: OrgUser) {
    return this.pt.lookups(u.organizationId);
  }

  @Get('picks')
  @RequirePermissions(P.read)
  picks(@CurrentOrgUser() u: OrgUser) {
    return this.pt.picks(u);
  }

  @Put('settings/general')
  @RequirePermissions(P.settings)
  general(@CurrentOrgUser() u: OrgUser, @Body() dto: GeneralSettingsDto) {
    return this.pt.saveGeneral(u, dto);
  }

  @Put('settings/types')
  @RequirePermissions(P.settings)
  types(@CurrentOrgUser() u: OrgUser, @Body() dto: TypesDto) {
    return this.pt.saveTypes(u, dto);
  }

  @Put('settings/classes')
  @RequirePermissions(P.settings)
  classes(@CurrentOrgUser() u: OrgUser, @Body() dto: ClassesDto) {
    return this.pt.saveClasses(u, dto);
  }

  @Put('settings/criteria')
  @RequirePermissions(P.settings)
  criteria(@CurrentOrgUser() u: OrgUser, @Body() dto: CriteriaDto) {
    return this.pt.saveCriteria(u, dto);
  }

  @Put('settings/categories')
  @RequireAnyPermission(P.settings, P.contracts)
  categories(@CurrentOrgUser() u: OrgUser, @Body() dto: CategoriesDto) {
    return this.pt.saveCategories(u, dto);
  }

  // ---------- مكتبة البنود ----------

  @Get('clauses')
  @RequireAnyPermission(P.read, P.settings)
  clauses(@CurrentOrgUser() u: OrgUser) {
    return this.pt.clauses(u.organizationId);
  }

  @Post('clauses')
  @RequirePermissions(P.contracts)
  createClause(@CurrentOrgUser() u: OrgUser, @Body() dto: ClauseDto) {
    return this.pt.createClause(u, dto);
  }

  @Put('clauses/order')
  @RequirePermissions(P.contracts)
  order(@CurrentOrgUser() u: OrgUser, @Body() dto: OrderDto) {
    return this.pt.reorderClauses(u, dto.ids);
  }

  @Post('clauses/restore')
  @RequirePermissions(P.contracts)
  restore(@CurrentOrgUser() u: OrgUser) {
    return this.pt.restoreClauses(u);
  }

  @Put('clauses/:id')
  @RequirePermissions(P.contracts)
  updateClause(@CurrentOrgUser() u: OrgUser, @Param('id') id: string, @Body() dto: ClauseDto) {
    return this.pt.updateClause(u, id, dto);
  }

  @Delete('clauses/:id')
  @RequirePermissions(P.contracts)
  deleteClause(@CurrentOrgUser() u: OrgUser, @Param('id') id: string) {
    return this.pt.deleteClause(u, id);
  }

  // ---------- اللوحة والشركاء ----------

  @Get('overview')
  @RequirePermissions(P.read)
  overview(@CurrentOrgUser() u: OrgUser) {
    return this.pt.overview(u);
  }

  @Get('partners')
  @RequirePermissions(P.read)
  partners(@CurrentOrgUser() u: OrgUser, @Query() q: Record<string, string>) {
    return this.pt.partners(u, q);
  }

  @Post('partners')
  @RequirePermissions(P.partners)
  createPartner(@CurrentOrgUser() u: OrgUser, @Body() dto: PartnerDto) {
    return this.pt.createPartner(u, dto);
  }

  @Get('partners/:id')
  @RequirePermissions(P.read)
  partner(@CurrentOrgUser() u: OrgUser, @Param('id') id: string) {
    return this.pt.partner(u, id);
  }

  @Put('partners/:id')
  @RequirePermissions(P.partners)
  updatePartner(@CurrentOrgUser() u: OrgUser, @Param('id') id: string, @Body() dto: PartnerDto) {
    return this.pt.updatePartner(u, id, dto);
  }

  @Delete('partners/:id')
  @RequirePermissions(P.partners)
  removePartner(@CurrentOrgUser() u: OrgUser, @Param('id') id: string) {
    return this.pt.removePartner(u, id);
  }

  @Post('partners/:id/status')
  @RequirePermissions(P.approve)
  partnerStatus(@CurrentOrgUser() u: OrgUser, @Param('id') id: string, @Body() dto: PartnerStatusDto) {
    return this.pt.setPartnerStatus(u, id, dto);
  }

  @Post('partners/:id/evaluations')
  @RequirePermissions(P.evaluate)
  evaluate(@CurrentOrgUser() u: OrgUser, @Param('id') id: string, @Body() dto: EvaluationDto) {
    return this.pt.saveEvaluation(u, id, dto);
  }

  @Put('partners/:id/evaluations/:eid')
  @RequirePermissions(P.evaluate)
  updateEvaluation(@CurrentOrgUser() u: OrgUser, @Param('id') id: string, @Param('eid') eid: string, @Body() dto: EvaluationDto) {
    return this.pt.saveEvaluation(u, id, dto, eid);
  }

  @Post('evaluations/:id/decision')
  @RequirePermissions(P.approve)
  decideEvaluation(@CurrentOrgUser() u: OrgUser, @Param('id') id: string, @Body() dto: DecisionDto) {
    return this.pt.decideEvaluation(u, id, dto);
  }

  @Get('approvals')
  @RequirePermissions(P.approve)
  approvals(@CurrentOrgUser() u: OrgUser) {
    return this.pt.approvals(u);
  }

  // ---------- العقود ----------

  @Get('contracts')
  @RequirePermissions(P.read)
  listContracts(@CurrentOrgUser() u: OrgUser, @Query() q: Record<string, string>) {
    return this.contracts.list(u, q);
  }

  @Post('contracts')
  @RequirePermissions(P.contracts)
  createContract(@CurrentOrgUser() u: OrgUser, @Body() dto: NewContractDto) {
    return this.contracts.create(u, dto);
  }

  @Get('contracts/:id')
  @RequirePermissions(P.read)
  contract(@CurrentOrgUser() u: OrgUser, @Param('id') id: string) {
    return this.contracts.get(u, id);
  }

  @Put('contracts/:id')
  @RequirePermissions(P.contracts)
  updateContract(@CurrentOrgUser() u: OrgUser, @Param('id') id: string, @Body() dto: UpdateContractDto) {
    return this.contracts.update(u, id, dto);
  }

  @Delete('contracts/:id')
  @RequirePermissions(P.contracts)
  removeContract(@CurrentOrgUser() u: OrgUser, @Param('id') id: string) {
    return this.contracts.remove(u, id);
  }

  @Post('contracts/:id/clauses/:clauseId')
  @RequirePermissions(P.contracts)
  addClause(@CurrentOrgUser() u: OrgUser, @Param('id') id: string, @Param('clauseId') clauseId: string) {
    return this.contracts.addClause(u, id, clauseId);
  }

  @Get('contracts/:id/preview')
  @RequirePermissions(P.read)
  preview(@CurrentOrgUser() u: OrgUser, @Param('id') id: string) {
    return this.contracts.preview(u, id);
  }

  @Get('contracts/:id/versions/:v')
  @RequirePermissions(P.read)
  version(@CurrentOrgUser() u: OrgUser, @Param('id') id: string, @Param('v', ParseIntPipe) v: number) {
    return this.contracts.version(u, id, v);
  }

  @Post('contracts/:id/submit')
  @RequirePermissions(P.contracts)
  submit(@CurrentOrgUser() u: OrgUser, @Param('id') id: string) {
    return this.contracts.submit(u, id);
  }

  @Post('contracts/:id/approve')
  @RequirePermissions(P.approve)
  approve(@CurrentOrgUser() u: OrgUser, @Param('id') id: string, @Body() dto: NoteDto) {
    return this.contracts.decide(u, id, 'approve', dto.note ?? null);
  }

  @Post('contracts/:id/return')
  @RequirePermissions(P.approve)
  returnContract(@CurrentOrgUser() u: OrgUser, @Param('id') id: string, @Body() dto: NoteDto) {
    return this.contracts.decide(u, id, 'return', dto.note ?? null);
  }

  @Post('contracts/:id/send')
  @RequirePermissions(P.contracts)
  send(@CurrentOrgUser() u: OrgUser, @Param('id') id: string) {
    return this.contracts.send(u, id);
  }

  @Post('contracts/:id/withdraw')
  @RequirePermissions(P.contracts)
  withdraw(@CurrentOrgUser() u: OrgUser, @Param('id') id: string) {
    return this.contracts.withdraw(u, id);
  }

  @Post('contracts/:id/manual-sign')
  @RequirePermissions(P.approve)
  manualSign(@CurrentOrgUser() u: OrgUser, @Param('id') id: string, @Body() dto: ManualSignDto) {
    return this.contracts.manualSign(u, id, dto);
  }

  @Post('contracts/:id/cancel')
  @RequirePermissions(P.contracts)
  cancel(@CurrentOrgUser() u: OrgUser, @Param('id') id: string, @Body() dto: ReasonDto) {
    return this.contracts.cancel(u, id, dto.note);
  }

  @Post('contracts/:id/terminate')
  @RequirePermissions(P.approve)
  terminate(@CurrentOrgUser() u: OrgUser, @Param('id') id: string, @Body() dto: ReasonDto) {
    return this.contracts.terminate(u, id, dto.note);
  }

  @Post('contracts/:id/renew')
  @RequirePermissions(P.contracts)
  renew(@CurrentOrgUser() u: OrgUser, @Param('id') id: string) {
    return this.contracts.renew(u, id);
  }

  // ---------- المتابعة ----------

  @Get('followups')
  @RequirePermissions(P.read)
  followups(@CurrentOrgUser() u: OrgUser, @Query() q: Record<string, string>) {
    return this.pt.followups(u, q);
  }

  @Post('contracts/:id/followups')
  @RequirePermissions(P.contracts)
  addFollowup(@CurrentOrgUser() u: OrgUser, @Param('id') id: string, @Body() dto: FollowupDto) {
    return this.pt.addFollowup(u, id, dto);
  }

  @Put('followups/:id')
  @RequirePermissions(P.contracts)
  updateFollowup(@CurrentOrgUser() u: OrgUser, @Param('id') id: string, @Body() dto: FollowupDto) {
    return this.pt.updateFollowup(u, id, dto);
  }

  @Post('followups/:id/done')
  @RequirePermissions(P.contracts)
  doneFollowup(@CurrentOrgUser() u: OrgUser, @Param('id') id: string, @Body() dto: FollowupDoneDto) {
    return this.pt.doneFollowup(u, id, dto);
  }

  @Delete('followups/:id')
  @RequirePermissions(P.contracts)
  removeFollowup(@CurrentOrgUser() u: OrgUser, @Param('id') id: string) {
    return this.pt.removeFollowup(u, id);
  }

  @Get('donor/:id')
  @RequireAnyPermission(P.read, 'fundraising.donors.read')
  donor(@CurrentOrgUser() u: OrgUser, @Param('id') id: string) {
    return /^[0-9a-f-]{36}$/i.test(id) ? this.pt.forDonor(u.organizationId, id) : [];
  }
}

/** صفحة الشريك العامة: مراجعة عقد الشراكة وتوقيعه برابط سري (بدون تسجيل دخول) */
@Controller('public/partnership-contracts')
@Public()
export class PublicPartnershipsController {
  constructor(private readonly contracts: PtContractsService) {}

  @Get(':token')
  view(@Param('token') token: string) {
    return this.contracts.publicView(token);
  }

  @Post(':token/sign')
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 600_000 } })
  sign(@Param('token') token: string, @Body() dto: SignDto, @Req() req: Request) {
    return this.contracts.sign(token, dto, req.ip ?? '');
  }

  @Post(':token/request-changes')
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 600_000 } })
  changes(@Param('token') token: string, @Body() dto: ChangesDto) {
    return this.contracts.requestChanges(token, dto.note);
  }
}
