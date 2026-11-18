import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Put, Query, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { memoryStorage } from 'multer';
import { CurrentOrgUser, OrgUser, RequirePermissions } from '../../core/auth/decorators';
import { MAX_UPLOAD_BYTES } from '../../core/files/file-store.service';
import { CONF_AR, CommsCore, DOC_AR, KIND_AR, PRIORITY_AR, PURPOSE_AR } from './comms-core.service';
import { CloseDto, FollowersDto, NoteDto, ReferDto, SettingsDto, TaskDto, TaskFromTxnDto, TaskUpdateDto, TransactionDto } from './comms.dto';
import { COMMS_PERMISSIONS as P } from './comms.manifest';
import { CommsInsights } from './insights.service';
import { TasksService } from './tasks.service';
import { TransactionsService } from './transactions.service';

const uuid = new ParseUUIDPipe();

/**
 * الاتصالات الإدارية والمهام. الاطلاع على المعاملة والمهمة يتحقق منه الخادم لكل سجل (حسب الأطراف والسرية)،
 * فشاشات التفاصيل متاحة لكل موظف موجه إليه شيء ولو بلا صلاحيات النظام.
 */
@Controller('comms')
export class CommsController {
  constructor(
    private readonly core: CommsCore,
    private readonly txns: TransactionsService,
    private readonly tasks: TasksService,
    private readonly insights: CommsInsights,
  ) {}

  @Get('dashboard')
  dashboard(@CurrentOrgUser() a: OrgUser) {
    return this.insights.dashboard(a);
  }

  @Get('lookups')
  async lookups(@CurrentOrgUser() a: OrgUser) {
    const org = a.organizationId;
    const [people, units, s] = await Promise.all([this.core.people(org), this.core.units(org), this.core.settings(org)]);
    return {
      people, units, categories: s.categories.filter((c) => c.isActive),
      labels: { confidentiality: CONF_AR, priority: PRIORITY_AR, docType: DOC_AR, kind: KIND_AR, purpose: PURPOSE_AR },
      can: {
        create: this.core.can(a, P.create), decisions: this.core.can(a, P.decisions), financial: this.core.can(a, P.financial), tasks: this.core.can(a, P.tasks),
        tasksAll: this.core.can(a, P.tasksAll), registry: this.core.can(a, P.registry) || this.core.can(a, P.registryMedium),
      },
    };
  }

  @Get('settings')
  @RequirePermissions(P.settings)
  settings(@CurrentOrgUser() a: OrgUser) {
    return this.core.getSettings(a);
  }

  @Put('settings')
  @RequirePermissions(P.settings)
  saveSettings(@CurrentOrgUser() a: OrgUser, @Body() dto: SettingsDto) {
    return this.core.saveSettings(a, dto);
  }

  // ---------------- المعاملات ----------------

  @Get('transactions')
  list(@CurrentOrgUser() a: OrgUser, @Query() q: Record<string, string>) {
    return this.txns.list(a, { box: q.box, status: q.status || undefined, docType: q.docType || undefined, kind: q.kind || undefined, confidentiality: q.confidentiality || undefined, q: q.q || undefined });
  }

  @Post('transactions')
  create(@CurrentOrgUser() a: OrgUser, @Body() dto: TransactionDto) {
    return this.txns.create(a, dto);
  }

  @Get('transactions/:id')
  get(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string) {
    return this.txns.get(a, id);
  }

  @Put('transactions/:id')
  update(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string, @Body() dto: TransactionDto) {
    return this.txns.update(a, id, dto);
  }

  @Post('transactions/:id/refer')
  refer(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string, @Body() dto: ReferDto) {
    return this.txns.refer(a, id, dto);
  }

  @Post('transactions/:id/return')
  returnBack(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string, @Body() dto: NoteDto) {
    return this.txns.returnBack(a, id, dto);
  }

  @Post('transactions/:id/note')
  note(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string, @Body() dto: NoteDto) {
    return this.txns.note(a, id, dto);
  }

  @Put('transactions/:id/followers')
  followers(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string, @Body() dto: FollowersDto) {
    return this.txns.setFollowers(a, id, dto.userIds);
  }

  @Post('transactions/:id/ack')
  ack(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string) {
    return this.txns.acknowledge(a, id);
  }

  @Post('transactions/:id/close')
  close(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string, @Body() dto: CloseDto) {
    return this.txns.close(a, id, dto);
  }

  @Post('transactions/:id/reopen')
  reopen(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string, @Body() dto: NoteDto) {
    return this.txns.reopen(a, id, dto);
  }

  @Post('transactions/:id/cancel')
  cancel(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string, @Body() dto: NoteDto) {
    return this.txns.cancel(a, id, dto);
  }

  @Post('transactions/:id/task')
  task(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string, @Body() dto: TaskFromTxnDto) {
    return this.txns.task(a, id, dto);
  }

  @Post('transactions/:id/attachments')
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 } }))
  attach(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string, @UploadedFile() file: Express.Multer.File) {
    return this.txns.attach(a, id, file);
  }

  @Get('transactions/:id/attachments/:fileId')
  async attachment(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string, @Param('fileId', uuid) fileId: string, @Res() res: Response) {
    const { doc, stream } = await this.txns.attachment(a, id, fileId);
    res.setHeader('Content-Type', doc.mimeType);
    res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(doc.fileName)}`);
    stream.pipe(res);
  }

  // ---------------- المهام ----------------

  @Get('tasks')
  tasksList(@CurrentOrgUser() a: OrgUser, @Query() q: Record<string, string>) {
    return this.tasks.list(a, { scope: q.scope || 'mine', status: q.status || undefined, source: q.source || undefined, q: q.q || undefined });
  }

  @Get('tasks/external')
  external(@CurrentOrgUser() a: OrgUser) {
    return this.tasks.external(a);
  }

  @Post('tasks')
  createTask(@CurrentOrgUser() a: OrgUser, @Body() dto: TaskDto) {
    return this.tasks.create(a, dto);
  }

  @Get('tasks/:id')
  getTask(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string) {
    return this.tasks.get(a, id);
  }

  @Post('tasks/:id/update')
  updateTask(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string, @Body() dto: TaskUpdateDto) {
    return this.tasks.update(a, id, dto);
  }
}
