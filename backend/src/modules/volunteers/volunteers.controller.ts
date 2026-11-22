import { BadRequestException, Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put, Query } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { CurrentOrgUser, OrgUser, Public, RequirePermissions } from '../../core/auth/decorators';
import { EventsService } from './events.service';
import { VOL_PERMISSIONS as P } from './volunteers.manifest';
import {
  AttendanceDto, CertificateDto, ClosureDto, ContractDto, DecisionDto, DocumentDto, EventDto, ParticipantsDto, PublicVolunteerDto, SettingsDto, SignContractDto,
  SurveyAnswerDto, TicketDto, TicketReplyDto, VolunteerDto, VolunteerStatusDto,
} from './volunteers.dto';
import { VolunteersService } from './volunteers.service';
import { SettingsSection, VolCore } from './vol-core.service';
import { VolReportsService } from './vol-reports.service';

const uuid = new ParseUUIDPipe();
const SECTIONS: SettingsSection[] = ['registration', 'lookups', 'events', 'closure', 'surveys', 'certificates', 'contract', 'general'];

/** نظام التطوع داخل الشركة */
@Controller('volunteers')
export class VolunteersController {
  constructor(
    private readonly core: VolCore,
    private readonly people: VolunteersService,
    private readonly events: EventsService,
    private readonly reportsService: VolReportsService,
  ) {}

  // ---------------- اللوحة والتقارير والإعدادات ----------------

  @Get('dashboard')
  @RequirePermissions(P.read)
  dashboard(@CurrentOrgUser() actor: OrgUser) {
    return this.reportsService.dashboard(actor);
  }

  @Get('reports')
  @RequirePermissions(P.reports)
  reports(@CurrentOrgUser() actor: OrgUser, @Query('from') from?: string, @Query('to') to?: string) {
    return this.reportsService.reports(actor, { from, to });
  }

  @Get('lookups')
  @RequirePermissions(P.read)
  lookups(@CurrentOrgUser() actor: OrgUser) {
    return this.core.lookups(actor.organizationId);
  }

  @Get('settings')
  @RequirePermissions(P.settings)
  settings(@CurrentOrgUser() actor: OrgUser) {
    return this.core.getSettings(actor);
  }

  @Put('settings/:section')
  @RequirePermissions(P.settings)
  saveSettings(@CurrentOrgUser() actor: OrgUser, @Param('section') section: string, @Body() dto: SettingsDto) {
    if (!SECTIONS.includes(section as SettingsSection)) throw new BadRequestException('قسم الإعدادات غير معروف');
    return this.core.saveSettings(actor, section as SettingsSection, dto.data);
  }

  @Get('documents')
  @RequirePermissions(P.read)
  documents(@CurrentOrgUser() actor: OrgUser) {
    return this.core.documents(actor);
  }

  @Put('documents/:kind')
  @RequirePermissions(P.policy)
  saveDocument(@CurrentOrgUser() actor: OrgUser, @Param('kind') kind: string, @Body() dto: DocumentDto) {
    if (kind !== 'policy' && kind !== 'charter') throw new BadRequestException('الوثيقة غير معروفة');
    return this.core.saveDocument(actor, kind, dto);
  }

  // ---------------- المتطوعون ----------------

  @Get('volunteers')
  @RequirePermissions(P.read)
  list(@CurrentOrgUser() actor: OrgUser, @Query() q: { status?: string; search?: string; field?: string; type?: string }) {
    return this.people.list(actor, q);
  }

  @Post('volunteers')
  @RequirePermissions(P.volunteers)
  async create(@CurrentOrgUser() actor: OrgUser, @Body() dto: VolunteerDto) {
    const v = await this.people.create(actor, actor.organizationId, dto);
    return this.people.profile(actor, v.id);
  }

  @Get('volunteers/:id')
  @RequirePermissions(P.read)
  profile(@CurrentOrgUser() actor: OrgUser, @Param('id', uuid) id: string) {
    return this.people.profile(actor, id);
  }

  @Patch('volunteers/:id')
  @RequirePermissions(P.volunteers)
  update(@CurrentOrgUser() actor: OrgUser, @Param('id', uuid) id: string, @Body() dto: VolunteerDto) {
    return this.people.update(actor, id, dto);
  }

  @Post('volunteers/:id/status')
  @RequirePermissions(P.volunteers)
  setStatus(@CurrentOrgUser() actor: OrgUser, @Param('id', uuid) id: string, @Body() dto: VolunteerStatusDto) {
    return this.people.setStatus(actor, id, dto);
  }

  @Delete('volunteers/:id')
  @HttpCode(204)
  @RequirePermissions(P.volunteers)
  remove(@CurrentOrgUser() actor: OrgUser, @Param('id', uuid) id: string) {
    return this.people.remove(actor, id);
  }

  // ---------------- الفعاليات ----------------

  @Get('events')
  @RequirePermissions(P.read)
  eventList(@CurrentOrgUser() actor: OrgUser, @Query() q: { status?: string; kind?: string; awaiting?: string }) {
    return this.events.list(actor, q);
  }

  @Post('events')
  @RequirePermissions(P.events)
  createEvent(@CurrentOrgUser() actor: OrgUser, @Body() dto: EventDto) {
    return this.events.create(actor, dto);
  }

  @Get('events/:id')
  @RequirePermissions(P.read)
  event(@CurrentOrgUser() actor: OrgUser, @Param('id', uuid) id: string) {
    return this.events.detail(actor, id);
  }

  @Patch('events/:id')
  @RequirePermissions(P.events)
  updateEvent(@CurrentOrgUser() actor: OrgUser, @Param('id', uuid) id: string, @Body() dto: EventDto) {
    return this.events.update(actor, id, dto);
  }

  @Delete('events/:id')
  @HttpCode(204)
  @RequirePermissions(P.events)
  removeEvent(@CurrentOrgUser() actor: OrgUser, @Param('id', uuid) id: string) {
    return this.events.remove(actor, id);
  }

  @Post('events/:id/submit')
  @RequirePermissions(P.events)
  submit(@CurrentOrgUser() actor: OrgUser, @Param('id', uuid) id: string) {
    return this.events.submit(actor, id);
  }

  @Post('events/:id/decision')
  @RequirePermissions(P.approveEvents)
  decide(@CurrentOrgUser() actor: OrgUser, @Param('id', uuid) id: string, @Body() dto: DecisionDto) {
    return this.events.decide(actor, id, dto);
  }

  @Post('events/:id/cancel')
  @RequirePermissions(P.events)
  cancel(@CurrentOrgUser() actor: OrgUser, @Param('id', uuid) id: string, @Body() body: { note?: string }) {
    return this.events.cancel(actor, id, typeof body?.note === 'string' ? body.note.trim().slice(0, 1000) || null : null);
  }

  @Post('events/:id/participants')
  @RequirePermissions(P.events)
  addParticipants(@CurrentOrgUser() actor: OrgUser, @Param('id', uuid) id: string, @Body() dto: ParticipantsDto) {
    return this.events.addParticipants(actor, id, dto);
  }

  @Delete('events/:id/participants/:pid')
  @RequirePermissions(P.events)
  removeParticipant(@CurrentOrgUser() actor: OrgUser, @Param('id', uuid) id: string, @Param('pid', uuid) pid: string) {
    return this.events.removeParticipant(actor, id, pid);
  }

  @Put('events/:id/attendance')
  @RequirePermissions(P.events)
  attendance(@CurrentOrgUser() actor: OrgUser, @Param('id', uuid) id: string, @Body() dto: AttendanceDto) {
    return this.events.attendance(actor, id, dto);
  }

  @Post('events/:id/close')
  @RequirePermissions(P.events)
  close(@CurrentOrgUser() actor: OrgUser, @Param('id', uuid) id: string, @Body() dto: ClosureDto) {
    return this.events.close(actor, id, dto);
  }

  @Post('events/:id/survey')
  @RequirePermissions(P.events)
  survey(@CurrentOrgUser() actor: OrgUser, @Param('id', uuid) id: string, @Body() body: { open?: boolean }) {
    return this.events.setSurvey(actor, id, body?.open !== false);
  }

  @Get('surveys')
  @RequirePermissions(P.read)
  surveys(@CurrentOrgUser() actor: OrgUser) {
    return this.events.surveys(actor);
  }

  // ---------------- الشهادات ----------------

  @Get('certificates')
  @RequirePermissions(P.read)
  certificates(@CurrentOrgUser() actor: OrgUser) {
    return this.people.certificates(actor);
  }

  @Post('certificates')
  @RequirePermissions(P.certificates)
  issueCertificate(@CurrentOrgUser() actor: OrgUser, @Body() dto: CertificateDto) {
    return this.people.issueCertificate(actor, dto);
  }

  @Get('certificates/:id')
  @RequirePermissions(P.read)
  certificate(@CurrentOrgUser() actor: OrgUser, @Param('id', uuid) id: string) {
    return this.people.certificate(actor.organizationId, id, actor.organizationName);
  }

  @Post('certificates/:id/revoke')
  @RequirePermissions(P.certificates)
  revoke(@CurrentOrgUser() actor: OrgUser, @Param('id', uuid) id: string) {
    return this.people.revokeCertificate(actor, id);
  }

  // ---------------- العقود ----------------

  @Get('contracts')
  @RequirePermissions(P.read)
  contracts(@CurrentOrgUser() actor: OrgUser) {
    return this.people.contracts(actor);
  }

  @Post('contracts')
  @RequirePermissions(P.contracts)
  issueContract(@CurrentOrgUser() actor: OrgUser, @Body() dto: ContractDto) {
    return this.people.issueContract(actor, dto);
  }

  @Get('contracts/:id')
  @RequirePermissions(P.read)
  contract(@CurrentOrgUser() actor: OrgUser, @Param('id', uuid) id: string) {
    return this.people.contract(actor.organizationId, id);
  }

  @Post('contracts/:id/:action')
  @RequirePermissions(P.contracts)
  contractAction(@CurrentOrgUser() actor: OrgUser, @Param('id', uuid) id: string, @Param('action') action: string) {
    if (action !== 'paper' && action !== 'cancel') throw new BadRequestException('الإجراء غير معروف');
    return this.people.contractAction(actor, id, action);
  }

  // ---------------- الشكاوى ----------------

  @Get('tickets')
  @RequirePermissions(P.read)
  tickets(@CurrentOrgUser() actor: OrgUser, @Query() q: { status?: string; kind?: string }) {
    return this.people.tickets(actor, q);
  }

  @Post('tickets')
  @RequirePermissions(P.tickets)
  createTicket(@CurrentOrgUser() actor: OrgUser, @Body() dto: TicketDto) {
    return this.people.createTicket(actor.organizationId, dto, 'staff');
  }

  @Post('tickets/:id/reply')
  @RequirePermissions(P.tickets)
  reply(@CurrentOrgUser() actor: OrgUser, @Param('id', uuid) id: string, @Body() dto: TicketReplyDto) {
    return this.people.replyTicket(actor, id, dto);
  }
}

/**
 * الصفحات العامة بدون دخول: تسجيل المتطوعين، الشكاوى والمقترحات ومتابعتها، استبانة الرضا،
 * توقيع عقد التطوع، والتحقق من الشهادة.
 */
@Public()
@Throttle({ default: { limit: 30, ttl: 60_000 } })
@Controller('public/volunteers')
export class PublicVolunteersController {
  constructor(
    private readonly core: VolCore,
    private readonly people: VolunteersService,
    private readonly events: EventsService,
  ) {}

  @Get('org/:slug')
  async info(@Param('slug') slug: string) {
    const org = await this.core.organization(slug);
    const l = await this.core.lookups(org.id);
    const charter = await this.core.document(org.id, 'charter');
    return {
      name: org.name, slug: org.slug, publicRegistration: l.publicRegistration,
      volunteerTypes: l.volunteerTypes.filter((x) => x.isActive), volunteerFields: l.volunteerFields.filter((x) => x.isActive),
      registrationFields: l.registrationFields, charter: { title: charter.title, sections: charter.sections },
    };
  }

  @Post('org/:slug/register')
  async register(@Param('slug') slug: string, @Body() dto: PublicVolunteerDto) {
    const org = await this.core.organization(slug);
    return this.people.register(org.id, dto);
  }

  @Post('org/:slug/tickets')
  async ticket(@Param('slug') slug: string, @Body() dto: TicketDto) {
    const org = await this.core.organization(slug);
    return this.people.createTicket(org.id, { ...dto, volunteerId: null, eventId: null }, 'public');
  }

  @Get('org/:slug/tickets/:no')
  async track(@Param('slug') slug: string, @Param('no') no: string, @Query('code') code = '') {
    const org = await this.core.organization(slug);
    return this.people.trackTicket(org.id, no, code);
  }

  @Get('survey/:token')
  survey(@Param('token') token: string) {
    return this.events.publicSurvey(token);
  }

  @Post('survey/:token')
  answer(@Param('token') token: string, @Body() dto: SurveyAnswerDto) {
    return this.events.answerSurvey(token, dto);
  }

  @Get('contract/:token')
  contract(@Param('token') token: string) {
    return this.people.publicContract(token);
  }

  @Post('contract/:token/sign')
  sign(@Param('token') token: string, @Body() dto: SignContractDto) {
    return this.people.signContract(token, dto.signedName);
  }

  @Get('certificate/:code')
  verify(@Param('code') code: string) {
    return this.people.verifyCertificate(code);
  }
}
