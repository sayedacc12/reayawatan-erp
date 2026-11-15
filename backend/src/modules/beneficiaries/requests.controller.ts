import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { CurrentOrgUser, OrgUser, RequirePermissions } from '../../core/auth/decorators';
import { BENEFICIARY_PERMISSIONS as P } from './beneficiaries.manifest';
import { CreateRequestDto, DecisionDto, ListRequestsQuery, ResubmitDto } from './requests.dto';
import { RequestsService } from './requests.service';

const uuid = new ParseUUIDPipe();

@Controller('beneficiaries/requests')
export class RequestsController {
  constructor(private readonly requests: RequestsService) {}

  @Get('board')
  @RequirePermissions(P.requestsRead)
  board(@CurrentOrgUser() actor: OrgUser) {
    return this.requests.board(actor);
  }

  @Get()
  @RequirePermissions(P.requestsRead)
  list(@CurrentOrgUser() actor: OrgUser, @Query() q: ListRequestsQuery) {
    return this.requests.list(actor, q);
  }

  @Post()
  @RequirePermissions(P.requestsCreate)
  async create(@CurrentOrgUser() actor: OrgUser, @Body() dto: CreateRequestDto) {
    const id = await this.requests.create({ organizationId: actor.organizationId, userId: actor.id, name: actor.fullName }, dto, 'staff');
    return this.get(actor, id);
  }

  @Get(':id')
  @RequirePermissions(P.requestsRead)
  async get(@CurrentOrgUser() actor: OrgUser, @Param('id', uuid) id: string) {
    const r = await this.requests.get(actor.organizationId, id);
    return { ...r, caseFile: await this.requests.caseFile(actor.organizationId, r.beneficiary.id, r.id), canDecide: r.status === 'in_progress' && (await this.requests.canDecide(actor, r.currentStageId)) };
  }

  @Post(':id/decision')
  @RequirePermissions(P.requestsProcess)
  async decide(@CurrentOrgUser() actor: OrgUser, @Param('id', uuid) id: string, @Body() dto: DecisionDto) {
    await this.requests.decide(actor, id, dto);
    return this.get(actor, id);
  }

  /** الموظف يعيد تقديم طلب راجع لمقدمه (بعد ما استكمل البيانات معاه) */
  @Post(':id/resubmit')
  @RequirePermissions(P.requestsCreate)
  async resubmit(@CurrentOrgUser() actor: OrgUser, @Param('id', uuid) id: string, @Body() dto: ResubmitDto) {
    await this.requests.resubmit({ organizationId: actor.organizationId, userId: actor.id, name: actor.fullName }, id, dto);
    return this.get(actor, id);
  }
}
