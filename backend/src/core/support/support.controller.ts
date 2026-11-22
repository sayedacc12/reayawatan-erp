import {
  Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put, Query, Res, StreamableFile, UploadedFile, UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { memoryStorage } from 'multer';
import { AuthUser, CurrentOrgUser, CurrentUser, OrgUser, RequirePermissions } from '../auth/decorators';
import { CORE_PERMISSIONS } from '../core.manifest';
import { SupportDeskService } from './support-desk.service';
import { SUPPORT_PERMISSIONS } from './support.manifest';
import { MAX_UPLOAD_BYTES } from '../files/file-store.service';
import { NoteDto } from '../subscriptions/subscriptions.dto';
import {
  CloseDto, CreateMemberDto, CreateTaskDto, CreateTicketDto, EscalateDto, LogHoursDto, MessageDto, SlaDto, UpdateMemberDto, UpdateTaskDto, UpdateTicketDto,
} from './support.dto';
import { SupportService } from './support.service';

const attachment = () =>
  UseInterceptors(FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 } }));

function sendFile(res: Response, f: { stream: NodeJS.ReadableStream; name: string; mime: string }) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', 'private, no-store');
  return new StreamableFile(f.stream as never, { type: f.mime, disposition: `inline; filename*=UTF-8''${encodeURIComponent(f.name)}` });
}

/** طلبات الصيانة والدعم من داخل الشركة */
@Controller('support')
@RequirePermissions(CORE_PERMISSIONS.supportManage)
export class OrgSupportController {
  constructor(private readonly support: SupportService) {}

  @Get('sla')
  sla() {
    return this.support.sla();
  }

  @Get('tickets')
  list(@CurrentOrgUser() actor: OrgUser) {
    return this.support.orgList(actor);
  }

  @Post('tickets')
  @attachment()
  create(@CurrentOrgUser() actor: OrgUser, @Body() dto: CreateTicketDto, @UploadedFile() file?: Express.Multer.File) {
    return this.support.create(actor, dto, file);
  }

  @Get('tickets/:id')
  get(@CurrentOrgUser() actor: OrgUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.support.orgGet(actor, id);
  }

  @Post('tickets/:id/messages')
  @attachment()
  async reply(
    @CurrentOrgUser() actor: OrgUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: MessageDto, @UploadedFile() file?: Express.Multer.File,
  ) {
    await this.support.orgReply(actor, id, { body: dto.body }, file);
    return this.support.orgGet(actor, id);
  }

  @Post('tickets/:id/close')
  @HttpCode(200)
  close(@CurrentOrgUser() actor: OrgUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: CloseDto) {
    return this.support.close(actor, id, dto);
  }

  @Post('tickets/:id/reopen')
  @HttpCode(200)
  reopen(@CurrentOrgUser() actor: OrgUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: NoteDto) {
    return this.support.reopen(actor, id, dto.note);
  }

  @Get('tickets/:id/messages/:messageId/file')
  async file(
    @CurrentOrgUser() actor: OrgUser, @Param('id', ParseUUIDPipe) id: string, @Param('messageId', ParseUUIDPipe) messageId: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    return sendFile(res, await this.support.attachment(id, messageId, actor.organizationId));
  }
}

/** تطبيق الدعم الفني لفريق المنصة: الطلبات والمهام والفريق والتقييم */
@Controller('support-desk')
@RequirePermissions(SUPPORT_PERMISSIONS.work)
export class SupportDeskController {
  constructor(private readonly support: SupportService, private readonly desk: SupportDeskService) {}

  @Get('dashboard')
  dashboard(@CurrentUser() actor: AuthUser) {
    return this.desk.dashboard(actor);
  }

  @Get('sla')
  sla() {
    return this.support.sla();
  }

  @Put('sla')
  @RequirePermissions(SUPPORT_PERMISSIONS.manage)
  setSla(@Body() dto: SlaDto) {
    return this.support.setSla(dto.levels);
  }

  /** قائمة مختصرة للإسناد */
  @Get('assignees')
  assignees() {
    return this.support.team();
  }

  @Get('tickets')
  list(@Query('status') status?: string, @Query('priority') priority?: string, @Query('organizationId') organizationId?: string) {
    return this.support.platformList({ status, priority, organizationId });
  }

  @Get('tickets/:id')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.support.platformGet(id);
  }

  @Post('tickets/:id/messages')
  @attachment()
  reply(@CurrentUser() actor: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: MessageDto, @UploadedFile() file?: Express.Multer.File) {
    return this.support.platformReply(actor, id, dto, file);
  }

  @Patch('tickets/:id')
  update(@CurrentUser() actor: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateTicketDto) {
    return this.support.platformUpdate(actor, id, dto);
  }

  @Post('tickets/:id/escalate')
  @HttpCode(200)
  escalate(@CurrentUser() actor: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: EscalateDto) {
    return this.support.escalate(actor, id, dto.note);
  }

  @Get('tickets/:id/messages/:messageId/file')
  async file(@Param('id', ParseUUIDPipe) id: string, @Param('messageId', ParseUUIDPipe) messageId: string, @Res({ passthrough: true }) res: Response) {
    return sendFile(res, await this.support.attachment(id, messageId));
  }

  // ---------- المهام ----------

  @Get('tasks')
  tasks(@CurrentUser() actor: AuthUser, @Query('scope') scope?: string, @Query('ticketId') ticketId?: string, @Query('assigneeId') assigneeId?: string) {
    return this.desk.listTasks(actor, { scope, ticketId, assigneeId });
  }

  @Post('tasks')
  createTask(@CurrentUser() actor: AuthUser, @Body() dto: CreateTaskDto) {
    return this.desk.createTask(actor, dto);
  }

  @Get('tasks/:id')
  task(@CurrentUser() actor: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.desk.getTask(actor, id);
  }

  @Patch('tasks/:id')
  updateTask(@CurrentUser() actor: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateTaskDto) {
    return this.desk.updateTask(actor, id, dto);
  }

  @Post('tasks/:id/hours')
  logHours(@CurrentUser() actor: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: LogHoursDto) {
    return this.desk.logHours(actor, id, dto);
  }

  // ---------- الفريق والتقييم ----------

  @Get('team')
  @RequirePermissions(SUPPORT_PERMISSIONS.manage)
  team() {
    return this.desk.team();
  }

  @Post('team')
  @RequirePermissions(SUPPORT_PERMISSIONS.manage)
  addMember(@Body() dto: CreateMemberDto) {
    return this.desk.createMember(dto);
  }

  @Patch('team/:id')
  @RequirePermissions(SUPPORT_PERMISSIONS.manage)
  updateMember(@CurrentUser() actor: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateMemberDto) {
    return this.desk.updateMember(actor, id, dto);
  }

  @Get('performance')
  @RequirePermissions(SUPPORT_PERMISSIONS.reports)
  performance(@Query('from') from?: string, @Query('to') to?: string) {
    return this.desk.performance(from, to);
  }

  @Get('report')
  @RequirePermissions(SUPPORT_PERMISSIONS.reports)
  report() {
    return this.support.report();
  }
}
