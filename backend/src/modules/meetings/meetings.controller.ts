import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Post, Put, Query, Req, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { memoryStorage } from 'multer';
import { CurrentOrgUser, OrgUser, Public, RequirePermissions } from '../../core/auth/decorators';
import { MAX_UPLOAD_BYTES } from '../../core/files/file-store.service';
import { MeetingsInsights } from './insights.service';
import {
  AgendaItemDto, AttendanceDto, BodyDto, DecisionDto, DiscussionDto, GuestDto, MeetingDto, MinutesTextDto, NoteDto, PublicSignDto, RecommendationDto, RsvpDto,
  SettingsDto, SignDto,
} from './meetings.dto';
import { KIND_AR, MeetingsCore, ROLE_AR } from './meetings-core.service';
import { MEETINGS_PERMISSIONS as P } from './meetings.manifest';
import { MeetingsService } from './meetings.service';
import { MinutesService } from './minutes.service';
import { MtgSettings } from './entities/meetings.entity';
import { DataSource } from 'typeorm';

const uuid = new ParseUUIDPipe();
const upload = () => UseInterceptors(FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 } }));
const send = (res: Response, r: { doc: { mimeType: string; fileName: string }; stream: NodeJS.ReadableStream }) => {
  res.setHeader('Content-Type', r.doc.mimeType);
  res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(r.doc.fileName)}`);
  r.stream.pipe(res);
};
const originOf = (req: Request) => {
  const proto = (req.headers['x-forwarded-proto'] as string) ?? req.protocol;
  const host = (req.headers['x-forwarded-host'] as string) ?? req.headers.host;
  return `${proto}://${host}`;
};

/** الاجتماعات واللجان. الاطلاع على كل اجتماع يتحقق منه الخادم (المدعوون وأمانة المجالس ومن له الاطلاع على نوع الجهة) */
@Controller('meetings')
export class MeetingsController {
  constructor(
    private readonly db: DataSource,
    private readonly core: MeetingsCore,
    private readonly meetings: MeetingsService,
    private readonly minutes: MinutesService,
    private readonly insights: MeetingsInsights,
  ) {}

  @Get('dashboard')
  dashboard(@CurrentOrgUser() a: OrgUser) {
    return this.insights.dashboard(a);
  }

  @Get('lookups')
  async lookups(@CurrentOrgUser() a: OrgUser) {
    const org = a.organizationId;
    const [people, units, assembly] = await Promise.all([this.core.comms.people(org), this.core.comms.units(org), this.core.assemblyMembers(org)]);
    return {
      people, units: units.map((u) => ({ id: u.id, parentId: u.parentId, level: u.level, name: u.name })), assembly,
      labels: { kinds: KIND_AR, roles: ROLE_AR },
      can: { manage: this.core.can(a, P.manage), teams: this.core.can(a, P.teamsManage), approve: this.core.can(a, P.approve) },
    };
  }

  @Get('settings')
  @RequirePermissions(P.settings)
  async settings(@CurrentOrgUser() a: OrgUser) {
    const s = await this.core.settings(a.organizationId);
    return { signDays: s.signDays, taskDays: s.taskDays, defaultQuorum: s.defaultQuorum, minutesFooter: s.minutesFooter };
  }

  @Put('settings')
  @RequirePermissions(P.settings)
  async saveSettings(@CurrentOrgUser() a: OrgUser, @Body() dto: SettingsDto) {
    await this.core.settings(a.organizationId);
    await this.db.getRepository(MtgSettings).update({ organizationId: a.organizationId }, { signDays: dto.signDays, taskDays: dto.taskDays, defaultQuorum: dto.defaultQuorum, minutesFooter: dto.minutesFooter ?? null });
    return this.settings(a);
  }

  // ---------------- الجهات ----------------

  @Get('bodies')
  bodies(@CurrentOrgUser() a: OrgUser, @Query('kind') kind?: string) {
    return this.meetings.bodies(a, kind || undefined);
  }

  @Post('bodies')
  createBody(@CurrentOrgUser() a: OrgUser, @Body() dto: BodyDto) {
    return this.meetings.saveBody(a, null, dto);
  }

  @Put('bodies/:id')
  updateBody(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string, @Body() dto: BodyDto) {
    return this.meetings.saveBody(a, id, dto);
  }

  // ---------------- الاجتماعات ----------------

  @Get('list')
  list(@CurrentOrgUser() a: OrgUser, @Query() q: Record<string, string>) {
    return this.meetings.list(a, { kind: q.kind || undefined, bodyId: q.bodyId || undefined, status: q.status || undefined, scope: q.scope || undefined, year: q.year || undefined, q: q.q || undefined });
  }

  @Get('decisions')
  decisions(@CurrentOrgUser() a: OrgUser, @Query() q: Record<string, string>) {
    return this.meetings.decisions(a, { kind: q.kind || undefined, bodyId: q.bodyId || undefined, q: q.q || undefined, status: q.status || undefined });
  }

  @Post()
  create(@CurrentOrgUser() a: OrgUser, @Body() dto: MeetingDto) {
    return this.meetings.create(a, dto);
  }

  @Get('m/:id')
  get(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string) {
    return this.meetings.get(a, id);
  }

  @Put('m/:id')
  update(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string, @Body() dto: MeetingDto) {
    return this.meetings.updatePlan(a, id, dto);
  }

  @Post('m/:id/guests')
  guest(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string, @Body() dto: GuestDto) {
    return this.meetings.addGuest(a, id, dto);
  }

  @Delete('m/:id/attendees/:aid')
  removeAttendee(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string, @Param('aid', uuid) aid: string) {
    return this.meetings.removeAttendee(a, id, aid);
  }

  @Post('m/:id/submit')
  submit(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string) {
    return this.meetings.submit(a, id);
  }

  @Post('m/:id/decide')
  decide(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string, @Body() dto: DecisionDto) {
    return this.meetings.decide(a, id, dto);
  }

  @Post('m/:id/rsvp')
  rsvp(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string, @Body() dto: RsvpDto) {
    return this.meetings.rsvp(a, id, dto);
  }

  @Post('m/:id/cancel')
  cancel(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string, @Body() dto: NoteDto) {
    return this.meetings.cancel(a, id, dto);
  }

  @Post('m/:id/start')
  start(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string) {
    return this.meetings.start(a, id);
  }

  @Put('m/:id/attendance')
  attendance(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string, @Body() dto: AttendanceDto) {
    return this.meetings.attendance(a, id, dto);
  }

  @Post('m/:id/check-in')
  checkIn(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string) {
    return this.meetings.checkIn(a, id);
  }

  @Post('m/:id/end')
  end(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string) {
    return this.meetings.end(a, id);
  }

  @Post('m/:id/items')
  addItem(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string, @Body() dto: AgendaItemDto) {
    return this.meetings.addItem(a, id, dto);
  }

  @Put('m/:id/items/:itemId')
  updateItem(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string, @Param('itemId', uuid) itemId: string, @Body() dto: AgendaItemDto) {
    return this.meetings.updateItem(a, id, itemId, dto);
  }

  @Delete('m/:id/items/:itemId')
  removeItem(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string, @Param('itemId', uuid) itemId: string) {
    return this.meetings.removeItem(a, id, itemId);
  }

  @Post('m/:id/items/:itemId/move/:dir')
  moveItem(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string, @Param('itemId', uuid) itemId: string, @Param('dir') dir: string) {
    return this.meetings.moveItem(a, id, itemId, dir === 'up' ? -1 : 1);
  }

  @Put('m/:id/items/:itemId/discussion')
  discussion(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string, @Param('itemId', uuid) itemId: string, @Body() dto: DiscussionDto) {
    return this.meetings.discussion(a, id, itemId, dto);
  }

  @Post('m/:id/items/:itemId/recommendations')
  addRec(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string, @Param('itemId', uuid) itemId: string, @Body() dto: RecommendationDto) {
    return this.meetings.addRec(a, id, itemId, dto);
  }

  @Put('m/:id/recommendations/:recId')
  updateRec(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string, @Param('recId', uuid) recId: string, @Body() dto: RecommendationDto) {
    return this.meetings.updateRec(a, id, recId, dto);
  }

  @Delete('m/:id/recommendations/:recId')
  removeRec(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string, @Param('recId', uuid) recId: string) {
    return this.meetings.removeRec(a, id, recId);
  }

  @Put('m/:id/minutes-text')
  minutesText(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string, @Body() dto: MinutesTextDto) {
    return this.meetings.minutesText(a, id, dto);
  }

  @Post('m/:id/attachments')
  @upload()
  attach(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string, @UploadedFile() file: Express.Multer.File) {
    return this.meetings.attach(a, id, file);
  }

  @Get('m/:id/files/:fileId')
  async file(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string, @Param('fileId') fileId: string, @Res() res: Response) {
    send(res, await this.meetings.attachment(a, id, fileId));
  }

  // ---------------- المحضر ----------------

  @Post('m/:id/minutes/issue')
  issue(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string) {
    return this.minutes.issue(a, id);
  }

  @Post('m/:id/minutes/recall')
  recall(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string, @Body() dto: NoteDto) {
    return this.minutes.recall(a, id, dto);
  }

  @Post('m/:id/minutes/sign')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  sign(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string, @Body() dto: SignDto, @Req() req: Request) {
    return this.minutes.sign(a, id, dto, req.ip ?? '');
  }

  @Post('m/:id/minutes/sign-link/:aid')
  signLink(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string, @Param('aid', uuid) aid: string, @Req() req: Request) {
    return this.minutes.signLink(a, id, aid, originOf(req));
  }

  @Post('m/:id/minutes/wet-copy')
  @upload()
  wetCopy(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string, @UploadedFile() file: Express.Multer.File, @Body('note') note?: string) {
    return this.minutes.wetCopy(a, id, file, note?.trim() ? note.trim().slice(0, 1000) : null);
  }

  @Post('m/:id/minutes/finalize')
  finalize(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string, @Body() dto: NoteDto) {
    return this.minutes.finalize(a, id, dto);
  }

  @Get('m/:id/minutes/print')
  print(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string) {
    return this.minutes.print(a, id);
  }
}

/** التوقيع برابط ورمز للحاضرين من خارج النظام، والتحقق العام من المحاضر */
@Public()
@Throttle({ default: { limit: 20, ttl: 60_000 } })
@Controller('public/minutes')
export class PublicMinutesController {
  constructor(private readonly minutes: MinutesService) {}

  @Get('sign/:token')
  view(@Param('token') token: string) {
    return this.minutes.publicView(token);
  }

  @Post('sign/:token')
  @Throttle({ default: { limit: 6, ttl: 60_000 } })
  sign(@Param('token') token: string, @Body() dto: PublicSignDto, @Req() req: Request) {
    return this.minutes.publicSign(token, dto, req.ip ?? '');
  }

  @Get('verify/:code')
  verify(@Param('code') code: string) {
    return this.minutes.verify(code.toUpperCase());
  }
}
