import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import { CurrentOrgUser, OrgUser, RequireAnyPermission, RequirePermissions } from '../../core/auth/decorators';
import { ActivitiesService } from './activities.service';
import { CrmCore } from './crm-core.service';
import {
  ActivityDto, ActivityListQuery, CompleteActivityDto, ConsentsDto, ContactDto, ConvertDto, DuplicateCheckQuery, ImportDto, LeadDto, LeadListQuery, LeadStatusDto,
  LinkCandidatesQuery, LinkDto, ListsDto, MergeDto, OwnerDto, PartyDto, PartyListQuery, SettingsDto,
} from './crm.dto';
import { CRM_PERMISSIONS as P } from './crm.manifest';
import { LeadsService } from './leads.service';
import { PartiesService } from './parties.service';

const ID = new ParseUUIDPipe({ version: '4' });

@Controller('crm')
export class CrmController {
  constructor(
    private readonly core: CrmCore, private readonly parties: PartiesService, private readonly leads: LeadsService, private readonly activities: ActivitiesService,
  ) {}

  // ---------- الإعدادات ----------

  @Get('lookups')
  @RequireAnyPermission(P.read, P.settings)
  lookups(@CurrentOrgUser() u: OrgUser) {
    return this.core.lookups(u);
  }

  @Put('settings')
  @RequirePermissions(P.settings)
  saveSettings(@CurrentOrgUser() u: OrgUser, @Body() dto: SettingsDto) {
    return this.core.saveSettings(u, dto);
  }

  @Put('settings/lists')
  @RequirePermissions(P.settings)
  saveLists(@CurrentOrgUser() u: OrgUser, @Body() dto: ListsDto) {
    return this.core.saveLists(u, dto);
  }

  @Get('dashboard')
  @RequirePermissions(P.read)
  dashboard(@CurrentOrgUser() u: OrgUser) {
    return this.activities.dashboard(u);
  }

  // ---------- الجهات ----------

  @Get('parties')
  @RequirePermissions(P.read)
  partyList(@CurrentOrgUser() u: OrgUser, @Query() q: PartyListQuery) {
    return this.parties.list(u, q);
  }

  @Get('parties/check')
  @RequirePermissions(P.read)
  check(@CurrentOrgUser() u: OrgUser, @Query() q: DuplicateCheckQuery) {
    return this.parties.duplicatesOf(u, q);
  }

  @Post('parties/sync')
  @RequirePermissions(P.merge)
  sync(@CurrentOrgUser() u: OrgUser) {
    return this.parties.sync(u.organizationId, true);
  }

  @Get('duplicates')
  @RequirePermissions(P.merge)
  duplicates(@CurrentOrgUser() u: OrgUser) {
    return this.parties.duplicateGroups(u);
  }

  @Post('parties')
  @RequirePermissions(P.manage)
  createParty(@CurrentOrgUser() u: OrgUser, @Body() dto: PartyDto) {
    return this.parties.create(u, dto);
  }

  @Get('parties/:id')
  @RequirePermissions(P.read)
  party(@CurrentOrgUser() u: OrgUser, @Param('id', ID) id: string) {
    return this.parties.profile(u, id);
  }

  @Put('parties/:id')
  @RequirePermissions(P.manage)
  updateParty(@CurrentOrgUser() u: OrgUser, @Param('id', ID) id: string, @Body() dto: PartyDto) {
    return this.parties.update(u, id, dto);
  }

  @Put('parties/:id/owner')
  @RequireAnyPermission(P.assign, P.all)
  partyOwner(@CurrentOrgUser() u: OrgUser, @Param('id', ID) id: string, @Body() dto: OwnerDto) {
    return this.parties.setOwner(u, id, dto.ownerId ?? null);
  }

  @Put('parties/:id/consents')
  @RequirePermissions(P.manage)
  consents(@CurrentOrgUser() u: OrgUser, @Param('id', ID) id: string, @Body() dto: ConsentsDto) {
    return this.parties.setConsents(u, id, dto);
  }

  @Post('parties/:id/contacts')
  @RequirePermissions(P.manage)
  addContact(@CurrentOrgUser() u: OrgUser, @Param('id', ID) id: string, @Body() dto: ContactDto) {
    return this.parties.saveContact(u, id, dto);
  }

  @Put('parties/:id/contacts/:cid')
  @RequirePermissions(P.manage)
  editContact(@CurrentOrgUser() u: OrgUser, @Param('id', ID) id: string, @Param('cid', ID) cid: string, @Body() dto: ContactDto) {
    return this.parties.saveContact(u, id, dto, cid);
  }

  @Delete('parties/:id/contacts/:cid')
  @RequirePermissions(P.manage)
  removeContact(@CurrentOrgUser() u: OrgUser, @Param('id', ID) id: string, @Param('cid', ID) cid: string) {
    return this.parties.removeContact(u, id, cid);
  }

  @Get('parties/:id/link-candidates')
  @RequirePermissions(P.merge)
  linkCandidates(@CurrentOrgUser() u: OrgUser, @Param('id', ID) id: string, @Query() q: LinkCandidatesQuery) {
    return this.parties.linkCandidates(u, id, q.role, q.q);
  }

  @Post('parties/:id/links')
  @RequirePermissions(P.merge)
  link(@CurrentOrgUser() u: OrgUser, @Param('id', ID) id: string, @Body() dto: LinkDto) {
    return this.parties.link(u, id, dto);
  }

  @Post('parties/:id/links/:linkId/detach')
  @RequirePermissions(P.merge)
  detach(@CurrentOrgUser() u: OrgUser, @Param('id', ID) id: string, @Param('linkId', ID) linkId: string) {
    return this.parties.detach(u, id, linkId);
  }

  @Post('parties/:id/merge')
  @RequirePermissions(P.merge)
  merge(@CurrentOrgUser() u: OrgUser, @Param('id', ID) id: string, @Body() dto: MergeDto) {
    return this.parties.merge(u, id, dto.removeId);
  }

  // ---------- العملاء المحتملون ----------

  @Get('leads')
  @RequirePermissions(P.read)
  leadList(@CurrentOrgUser() u: OrgUser, @Query() q: LeadListQuery) {
    return this.leads.list(u, q);
  }

  @Post('leads')
  @RequirePermissions(P.manage)
  createLead(@CurrentOrgUser() u: OrgUser, @Body() dto: LeadDto) {
    return this.leads.create(u, dto);
  }

  @Post('leads/import')
  @RequirePermissions(P.import)
  importLeads(@CurrentOrgUser() u: OrgUser, @Body() dto: ImportDto) {
    return this.leads.import(u, dto);
  }

  @Get('leads/:id')
  @RequirePermissions(P.read)
  lead(@CurrentOrgUser() u: OrgUser, @Param('id', ID) id: string) {
    return this.leads.get(u, id);
  }

  @Put('leads/:id')
  @RequirePermissions(P.manage)
  updateLead(@CurrentOrgUser() u: OrgUser, @Param('id', ID) id: string, @Body() dto: LeadDto) {
    return this.leads.update(u, id, dto);
  }

  @Put('leads/:id/owner')
  @RequireAnyPermission(P.assign, P.all)
  leadOwner(@CurrentOrgUser() u: OrgUser, @Param('id', ID) id: string, @Body() dto: OwnerDto) {
    return this.leads.assign(u, id, dto.ownerId ?? null);
  }

  @Post('leads/:id/status')
  @RequirePermissions(P.manage)
  leadStatus(@CurrentOrgUser() u: OrgUser, @Param('id', ID) id: string, @Body() dto: LeadStatusDto) {
    return this.leads.setStatus(u, id, dto);
  }

  @Post('leads/:id/convert')
  @RequirePermissions(P.manage)
  convert(@CurrentOrgUser() u: OrgUser, @Param('id', ID) id: string, @Body() dto: ConvertDto) {
    return this.leads.convert(u, id, dto);
  }

  // ---------- الأنشطة ----------

  @Get('activities')
  @RequirePermissions(P.read)
  activityList(@CurrentOrgUser() u: OrgUser, @Query() q: ActivityListQuery) {
    return this.activities.list(u, q);
  }

  @Post('activities')
  @RequirePermissions(P.manage)
  createActivity(@CurrentOrgUser() u: OrgUser, @Body() dto: ActivityDto) {
    return this.activities.create(u, dto);
  }

  @Post('activities/:id/complete')
  @RequirePermissions(P.manage)
  complete(@CurrentOrgUser() u: OrgUser, @Param('id', ID) id: string, @Body() dto: CompleteActivityDto) {
    return this.activities.complete(u, id, dto);
  }

  @Delete('activities/:id')
  @RequirePermissions(P.manage)
  removeActivity(@CurrentOrgUser() u: OrgUser, @Param('id', ID) id: string) {
    return this.activities.remove(u, id);
  }
}
