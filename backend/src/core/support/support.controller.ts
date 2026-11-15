import {
  Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put, Query, Res, StreamableFile, UploadedFile, UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { memoryStorage } from 'multer';
import { AuthUser, CurrentOrgUser, CurrentUser, OrgUser, RequirePermissions } from '../auth/decorators';
import { CORE_PERMISSIONS, PLATFORM_PERMISSIONS } from '../core.manifest';
import { MAX_UPLOAD_BYTES } from '../files/file-store.service';
import { NoteDto } from '../subscriptions/subscriptions.dto';
import { CloseDto, CreateTicketDto, EscalateDto, MessageDto, SlaDto, UpdateTicketDto } from './support.dto';
import { SupportService } from './support.service';

const attachment = () =>
  UseInterceptors(FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 } }));

function sendFile(res: Response, f: { stream: NodeJS.ReadableStream; name: string; mime: string }) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', 'private, no-store');
  return new StreamableFile(f.stream as never, { type: f.mime, disposition: `inline; filename*=UTF-8''${encodeURIComponent(f.name)}` });
}

/** طلبات الصيانة والدعم من داخل الجمعية */
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

/** صندوق طلبات الصيانة لدى مدير المنصة، ومستويات الخدمة */
@Controller('platform/support')
@RequirePermissions(PLATFORM_PERMISSIONS.supportManage)
export class PlatformSupportController {
  constructor(private readonly support: SupportService) {}

  @Get('sla')
  sla() {
    return this.support.sla();
  }

  @Put('sla')
  setSla(@Body() dto: SlaDto) {
    return this.support.setSla(dto.levels);
  }

  @Get('team')
  team() {
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

  @Get('report')
  @RequirePermissions(PLATFORM_PERMISSIONS.reportsRead)
  report() {
    return this.support.report();
  }
}
