import { Body, Controller, Delete, Get, Header, Param, ParseUUIDPipe, Post, Put, Query, Res, StreamableFile, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import { memoryStorage } from 'multer';
import { CurrentOrgUser, OrgUser, Public, RequireAnyPermission, RequirePermissions } from '../../core/auth/decorators';
import { MAX_UPLOAD_BYTES } from '../../core/files/file-store.service';
import { sendFile } from '../knowledge/knowledge.controller';
import { BookingService } from './booking.service';
import { ContentService } from './content.service';
import { FormsService } from './forms.service';
import { GuidesService } from './guides.service';
import { LeadsService } from './leads.service';
import {
  BookingQueryDto, BookingRequestDto, BookingUpdateDto, CancelBookingDto, GuideDto, GuideRequestDto, LeadQueryDto, LeadSubmitDto, LeadUpdateDto, OrderDto, SectionDto, ServiceDto,
} from './website.dto';
import { WEBSITE_PERMISSIONS as P } from './website.manifest';

const upload = FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 } });
const UUID = new ParseUUIDPipe({ version: undefined, errorHttpStatusCode: 404 });

/** لوحة تحكم الموقع داخل النظام */
@Controller('website')
export class WebsiteController {
  constructor(
    private readonly content: ContentService, private readonly leads: LeadsService, private readonly booking: BookingService, private readonly guides: GuidesService,
  ) {}

  @Get('dashboard')
  @RequirePermissions(P.read)
  dashboard(@CurrentOrgUser() u: OrgUser) {
    return this.leads.dashboard(u);
  }

  // ---------------- العملاء المحتملون ----------------

  @Get('leads')
  @RequirePermissions(P.leadsRead)
  leadList(@CurrentOrgUser() u: OrgUser, @Query() q: LeadQueryDto) {
    return this.leads.list(u, q);
  }

  @Get('leads/export')
  @RequirePermissions(P.leadsRead)
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="leads.csv"')
  @Header('Cache-Control', 'private, no-store')
  leadExport(@CurrentOrgUser() u: OrgUser) {
    return this.leads.csv(u);
  }

  @Get('assignees')
  @RequireAnyPermission(P.leadsManage, P.bookings)
  assignees(@CurrentOrgUser() u: OrgUser) {
    return this.leads.assignees(u);
  }

  @Get('leads/:id')
  @RequirePermissions(P.leadsRead)
  lead(@CurrentOrgUser() u: OrgUser, @Param('id', UUID) id: string) {
    return this.leads.get(u, id);
  }

  @Put('leads/:id')
  @RequirePermissions(P.leadsManage)
  updateLead(@CurrentOrgUser() u: OrgUser, @Param('id', UUID) id: string, @Body() dto: LeadUpdateDto) {
    return this.leads.update(u, id, dto);
  }

  // ---------------- الحجوزات ----------------

  @Get('bookings')
  @RequirePermissions(P.leadsRead)
  bookings(@CurrentOrgUser() u: OrgUser, @Query() q: BookingQueryDto) {
    return this.booking.list(u, q);
  }

  @Get('bookings/preview')
  @RequirePermissions(P.bookings)
  preview(@CurrentOrgUser() u: OrgUser) {
    return this.booking.preview(u);
  }

  @Put('bookings/:id')
  @RequirePermissions(P.bookings)
  updateBooking(@CurrentOrgUser() u: OrgUser, @Param('id', UUID) id: string, @Body() dto: BookingUpdateDto) {
    return this.booking.update(u, id, dto);
  }

  // ---------------- المحتوى والخدمات ----------------

  @Get('content')
  @RequireAnyPermission(P.content, P.bookings, P.settings)
  sections(@CurrentOrgUser() u: OrgUser) {
    return this.content.sections(u.organizationId);
  }

  @Put('content/booking')
  @RequirePermissions(P.bookings)
  saveBooking(@CurrentOrgUser() u: OrgUser, @Body() dto: SectionDto) {
    return this.content.saveSection(u, 'booking', dto.data);
  }

  @Put('content/notify')
  @RequirePermissions(P.settings)
  saveNotify(@CurrentOrgUser() u: OrgUser, @Body() dto: SectionDto) {
    return this.content.saveSection(u, 'notify', dto.data);
  }

  @Put('content/:key')
  @RequirePermissions(P.content)
  saveSection(@CurrentOrgUser() u: OrgUser, @Param('key') key: string, @Body() dto: SectionDto) {
    if (key === 'booking' || key === 'notify') return this.content.saveSection(u, '__denied__', dto.data);
    return this.content.saveSection(u, key, dto.data);
  }

  @Delete('content/:key')
  @RequirePermissions(P.content)
  resetSection(@CurrentOrgUser() u: OrgUser, @Param('key') key: string) {
    if (key === 'booking' || key === 'notify') return this.content.resetSection(u, '__denied__');
    return this.content.resetSection(u, key);
  }

  @Get('content-history')
  @RequirePermissions(P.settings)
  contentHistory(@CurrentOrgUser() u: OrgUser) {
    return this.content.history(u.organizationId);
  }

  @Get('services')
  @RequireAnyPermission(P.content, P.guides, P.leadsRead)
  services(@CurrentOrgUser() u: OrgUser) {
    return this.content.services(u.organizationId);
  }

  @Post('services')
  @RequirePermissions(P.content)
  createService(@CurrentOrgUser() u: OrgUser, @Body() dto: ServiceDto) {
    return this.content.createService(u, dto);
  }

  @Put('services/order')
  @RequirePermissions(P.content)
  orderServices(@CurrentOrgUser() u: OrgUser, @Body() dto: OrderDto) {
    return this.content.orderServices(u, dto.ids);
  }

  @Get('services/:id')
  @RequirePermissions(P.content)
  service(@CurrentOrgUser() u: OrgUser, @Param('id', UUID) id: string) {
    return this.content.service(u.organizationId, id);
  }

  @Put('services/:id')
  @RequirePermissions(P.content)
  updateService(@CurrentOrgUser() u: OrgUser, @Param('id', UUID) id: string, @Body() dto: ServiceDto) {
    return this.content.updateService(u, id, dto);
  }

  @Delete('services/:id')
  @RequirePermissions(P.content)
  removeService(@CurrentOrgUser() u: OrgUser, @Param('id', UUID) id: string) {
    return this.content.removeService(u, id);
  }

  // ---------------- مكتبة الأدلة ----------------

  @Get('guides')
  @RequirePermissions(P.guides)
  guideList(@CurrentOrgUser() u: OrgUser) {
    return this.guides.list(u);
  }

  @Post('guides')
  @RequirePermissions(P.guides)
  createGuide(@CurrentOrgUser() u: OrgUser, @Body() dto: GuideDto) {
    return this.guides.create(u, dto);
  }

  @Put('guides/order')
  @RequirePermissions(P.guides)
  orderGuides(@CurrentOrgUser() u: OrgUser, @Body() dto: OrderDto) {
    return this.guides.order(u, dto.ids);
  }

  @Put('guides/:id')
  @RequirePermissions(P.guides)
  updateGuide(@CurrentOrgUser() u: OrgUser, @Param('id', UUID) id: string, @Body() dto: GuideDto) {
    return this.guides.update(u, id, dto);
  }

  @Post('guides/:id/file')
  @RequirePermissions(P.guides)
  @UseInterceptors(upload)
  guideFile(@CurrentOrgUser() u: OrgUser, @Param('id', UUID) id: string, @UploadedFile() file: Express.Multer.File) {
    return this.guides.upload(u, id, 'file', file);
  }

  @Post('guides/:id/cover')
  @RequirePermissions(P.guides)
  @UseInterceptors(upload)
  guideCover(@CurrentOrgUser() u: OrgUser, @Param('id', UUID) id: string, @UploadedFile() file: Express.Multer.File) {
    return this.guides.upload(u, id, 'cover', file);
  }

  @Get('guides/:id/file')
  @RequirePermissions(P.guides)
  async guideDownload(@CurrentOrgUser() u: OrgUser, @Param('id', UUID) id: string, @Res({ passthrough: true }) res: Response) {
    return sendFile(res, await this.guides.staffFile(u, id), true);
  }

  @Delete('guides/:id')
  @RequirePermissions(P.guides)
  removeGuide(@CurrentOrgUser() u: OrgUser, @Param('id', UUID) id: string) {
    return this.guides.remove(u, id);
  }
}

/**
 * الموقع العام لرعاية وطن (بلا دخول). يخدم منشأة الشركة فقط (COMPANY_SLUG)، فلا يقبل معرف منشأة من الطلب.
 * كل نموذج محدود العدد لكل عنوان (Throttle)، وفيه حقل مخفي لاصطياد البرامج الآلية.
 */
@Controller('public/web')
export class PublicSiteController {
  constructor(
    private readonly content: ContentService, private readonly forms: FormsService, private readonly booking: BookingService, private readonly guides: GuidesService,
  ) {}

  private async org() {
    return this.content.companyId();
  }

  @Public()
  @Get()
  @Header('Cache-Control', 'public, max-age=60')
  site() {
    return this.content.publicSite();
  }

  @Public()
  @Throttle({ default: { limit: 8, ttl: 60_000 } })
  @Post('leads')
  async lead(@Body() dto: LeadSubmitDto) {
    if (dto.website) return { ok: true };
    return this.forms.submit(await this.org(), dto);
  }

  @Public()
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @Get('booking/slots')
  @Header('Cache-Control', 'no-store')
  async slots() {
    return this.booking.slots(await this.org());
  }

  @Public()
  @Throttle({ default: { limit: 6, ttl: 60_000 } })
  @Post('booking')
  async book(@Body() dto: BookingRequestDto) {
    if (dto.website) return { ok: true };
    return this.booking.book(await this.org(), dto);
  }

  @Public()
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Get('booking/manage/:token')
  async manage(@Param('token') token: string) {
    return this.booking.manageInfo(await this.org(), token);
  }

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('booking/manage/:token/cancel')
  async cancel(@Param('token') token: string, @Body() dto: CancelBookingDto) {
    return this.booking.cancelByVisitor(await this.org(), token, dto.reason);
  }

  @Public()
  @Throttle({ default: { limit: 8, ttl: 60_000 } })
  @Post('guides/:slug')
  async guide(@Param('slug') slug: string, @Body() dto: GuideRequestDto) {
    if (dto.website) return { ok: true };
    return this.guides.request(await this.org(), slug, dto);
  }

  @Public()
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Get('guides/download/:token')
  async download(@Param('token') token: string, @Res({ passthrough: true }) res: Response) {
    return sendFile(res, await this.guides.download(await this.org(), token), true);
  }

  @Public()
  @Get('guides/:slug/cover')
  async cover(@Param('slug') slug: string, @Res({ passthrough: true }) res: Response) {
    const f = await this.guides.cover(await this.org(), slug);
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    return new StreamableFile(f.stream as never, { type: f.mime });
  }
}
