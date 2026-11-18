import { BadRequestException, Body, Controller, Delete, Get, Param, Post, Put, Query, Req, Res, StreamableFile, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { memoryStorage } from 'multer';
import { CurrentOrgUser, OrgUser, Public, RequireAnyPermission, RequirePermissions } from '../../core/auth/decorators';
import { originOf } from '../../core/subscriptions/subscriptions.controller';
import { sendFile } from '../knowledge/knowledge.controller';
import { ContentService } from './content.service';
import { ContactDto, DecisionDto, DonateDto, MessageUpdateDto, NewsDto, OrderDto, ProgramDecisionDto, ProgramDto, SandboxPayDto, SectionDto, SubscriptionStatusDto } from './website.dto';
import { WEBSITE_PERMISSIONS as P } from './website.manifest';
import { PAGE_SECTIONS, PageSection, SETTINGS_SECTIONS, SettingsSection, SiteService } from './site.service';
import { StoreService } from './store.service';
import { WebCore } from './web-core.service';


/** لوحة تحكم الموقع الإلكتروني داخل الجمعية */
@Controller('website')
export class WebsiteController {
  constructor(private readonly core: WebCore, private readonly content: ContentService, private readonly site: SiteService, private readonly store: StoreService) {}

  @Get('dashboard')
  @RequirePermissions(P.read)
  dashboard(@CurrentOrgUser() u: OrgUser) {
    return this.site.dashboard(u);
  }

  // ---------------- الأخبار ----------------

  @Get('news')
  @RequirePermissions(P.read)
  news(@CurrentOrgUser() u: OrgUser, @Query('status') status?: string) {
    return this.content.newsList(u, status);
  }

  @Post('news')
  @RequireAnyPermission(P.edit, P.publish)
  createNews(@CurrentOrgUser() u: OrgUser, @Body() dto: NewsDto) {
    return this.content.newsCreate(u, dto);
  }

  @Get('news/:id')
  @RequirePermissions(P.read)
  newsItem(@CurrentOrgUser() u: OrgUser, @Param('id') id: string) {
    return this.content.newsGet(u, id);
  }

  @Put('news/:id')
  @RequireAnyPermission(P.edit, P.publish)
  updateNews(@CurrentOrgUser() u: OrgUser, @Param('id') id: string, @Body() dto: NewsDto) {
    return this.content.newsUpdate(u, id, dto);
  }

  @Post('news/:id/decision')
  @RequirePermissions(P.publish)
  decideNews(@CurrentOrgUser() u: OrgUser, @Param('id') id: string, @Body() dto: DecisionDto) {
    return this.content.newsDecide(u, id, dto);
  }

  @Delete('news/:id')
  @RequireAnyPermission(P.edit, P.publish)
  removeNews(@CurrentOrgUser() u: OrgUser, @Param('id') id: string) {
    return this.content.newsRemove(u, id);
  }

  // ---------------- البرامج ----------------

  @Get('programs')
  @RequirePermissions(P.read)
  programs(@CurrentOrgUser() u: OrgUser) {
    return this.content.programs(u);
  }

  @Get('programs/lookups')
  @RequirePermissions(P.read)
  programLookups(@CurrentOrgUser() u: OrgUser) {
    return this.content.programLookups(u);
  }

  @Put('programs/order')
  @RequirePermissions(P.publish)
  order(@CurrentOrgUser() u: OrgUser, @Body() dto: OrderDto) {
    return this.content.programOrder(u, dto);
  }

  @Post('programs')
  @RequireAnyPermission(P.edit, P.publish)
  createProgram(@CurrentOrgUser() u: OrgUser, @Body() dto: ProgramDto) {
    return this.content.programCreate(u, dto);
  }

  @Get('programs/:id')
  @RequirePermissions(P.read)
  program(@CurrentOrgUser() u: OrgUser, @Param('id') id: string) {
    return this.content.program(u, id);
  }

  @Put('programs/:id')
  @RequireAnyPermission(P.edit, P.publish)
  updateProgram(@CurrentOrgUser() u: OrgUser, @Param('id') id: string, @Body() dto: ProgramDto) {
    return this.content.programUpdate(u, id, dto);
  }

  @Post('programs/:id/decision')
  @RequirePermissions(P.publish)
  decideProgram(@CurrentOrgUser() u: OrgUser, @Param('id') id: string, @Body() dto: ProgramDecisionDto) {
    return this.content.programDecide(u, id, dto);
  }

  @Delete('programs/:id')
  @RequireAnyPermission(P.edit, P.publish)
  removeProgram(@CurrentOrgUser() u: OrgUser, @Param('id') id: string) {
    return this.content.programRemove(u, id);
  }

  // ---------------- الصفحات والصور ----------------

  @Get('pages')
  @RequirePermissions(P.pages)
  pages(@CurrentOrgUser() u: OrgUser) {
    return this.site.getPages(u);
  }

  @Put('pages/:section')
  @RequirePermissions(P.pages)
  savePage(@CurrentOrgUser() u: OrgUser, @Param('section') section: string, @Body() dto: SectionDto) {
    if (!PAGE_SECTIONS.includes(section as PageSection)) throw new BadRequestException('الصفحة غير معروفة');
    return this.site.savePage(u, section as PageSection, dto.data);
  }

  @Get('media')
  @RequireAnyPermission(P.edit, P.publish, P.pages)
  media(@CurrentOrgUser() u: OrgUser) {
    return this.core.media(u);
  }

  @Post('media')
  @RequireAnyPermission(P.edit, P.publish, P.pages)
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: 5 * 1024 * 1024, files: 1 } }))
  upload(@CurrentOrgUser() u: OrgUser, @UploadedFile() file: Express.Multer.File) {
    return this.core.upload(u, file);
  }

  @Delete('media/:id')
  @RequireAnyPermission(P.publish, P.pages)
  removeMedia(@CurrentOrgUser() u: OrgUser, @Param('id') id: string) {
    return this.core.removeMedia(u, id);
  }

  // ---------------- المتجر ----------------

  @Get('donations')
  @RequirePermissions(P.donations)
  donations(@CurrentOrgUser() u: OrgUser, @Query() q: Record<string, string>) {
    return this.store.donations(u, q);
  }

  @Get('donations/:id')
  @RequirePermissions(P.donations)
  donation(@CurrentOrgUser() u: OrgUser, @Param('id') id: string) {
    return this.store.donation(u, id);
  }

  @Post('donations/:id/voucher')
  @RequirePermissions(P.donations)
  retryVoucher(@CurrentOrgUser() u: OrgUser, @Param('id') id: string) {
    return this.store.retryVoucher(u, id);
  }

  @Post('donations/:id/cancel')
  @RequirePermissions(P.donations, P.settings)
  cancel(@CurrentOrgUser() u: OrgUser, @Param('id') id: string) {
    return this.store.cancelDonation(u, id);
  }

  @Get('subscriptions')
  @RequirePermissions(P.donations)
  subscriptions(@CurrentOrgUser() u: OrgUser, @Req() req: Request) {
    return this.store.subscriptions(u, originOf(req));
  }

  @Post('subscriptions/:id/status')
  @RequirePermissions(P.donations, P.settings)
  subscriptionStatus(@CurrentOrgUser() u: OrgUser, @Param('id') id: string, @Body() dto: SubscriptionStatusDto) {
    return this.store.setSubscription(u, id, dto.status);
  }

  // ---------------- الرسائل والسجل والإعدادات ----------------

  @Get('messages')
  @RequirePermissions(P.messages)
  messages(@CurrentOrgUser() u: OrgUser, @Query('status') status?: string) {
    return this.site.messages(u, status);
  }

  @Put('messages/:id')
  @RequirePermissions(P.messages)
  updateMessage(@CurrentOrgUser() u: OrgUser, @Param('id') id: string, @Body() dto: MessageUpdateDto) {
    return this.site.updateMessage(u, id, dto);
  }

  @Get('activity')
  @RequirePermissions(P.settings)
  activity(@CurrentOrgUser() u: OrgUser) {
    return this.core.activity(u.organizationId);
  }

  @Get('settings')
  @RequirePermissions(P.settings)
  settings(@CurrentOrgUser() u: OrgUser) {
    return this.site.getSettings(u);
  }

  @Put('settings/:section')
  @RequirePermissions(P.settings)
  saveSettings(@CurrentOrgUser() u: OrgUser, @Param('section') section: string, @Body() dto: SectionDto) {
    if (!SETTINGS_SECTIONS.includes(section as SettingsSection)) throw new BadRequestException('قسم الإعدادات غير معروف');
    return this.site.saveSettings(u, section as SettingsSection, dto.data);
  }
}

/** الموقع الإلكتروني العام للجمعية: بدون دخول */
@Controller('public/website/:slug')
export class PublicWebsiteController {
  constructor(private readonly site: SiteService, private readonly store: StoreService) {}

  @Public()
  @Get()
  get(@Param('slug') slug: string, @Query('preview') preview?: string) {
    return this.site.publicSite(slug, preview);
  }

  @Public()
  @Get('governance')
  governance(@Param('slug') slug: string, @Query('preview') preview?: string) {
    return this.site.publicGovernance(slug, preview);
  }

  @Public()
  @Get('news')
  news(@Param('slug') slug: string, @Query('page') page?: string, @Query('preview') preview?: string) {
    return this.site.publicNews(slug, Number(page) || 1, preview);
  }

  @Public()
  @Get('news/:id')
  newsItem(@Param('slug') slug: string, @Param('id') id: string, @Query('preview') preview?: string) {
    return this.site.publicNewsItem(slug, id, preview);
  }

  @Public()
  @Get('programs/:pslug')
  program(@Param('slug') slug: string, @Param('pslug') pslug: string, @Query('preview') preview?: string) {
    return this.site.publicProgramPage(slug, pslug, preview);
  }

  @Public()
  @Get('search')
  search(@Param('slug') slug: string, @Query('q') q: string, @Query('preview') preview?: string) {
    return this.site.search(slug, q, preview);
  }

  @Public()
  @Get('documents/:id')
  document(@Param('slug') slug: string, @Param('id') id: string, @Query('preview') preview?: string) {
    return this.site.publicDocument(slug, id, preview);
  }

  @Public()
  @Get('documents/:id/file')
  async documentFile(@Param('slug') slug: string, @Param('id') id: string, @Res({ passthrough: true }) res: Response, @Query('preview') preview?: string) {
    return sendFile(res, await this.site.publicDocumentFile(slug, id, preview));
  }

  @Public()
  @Get('media/:id')
  async media(@Param('slug') slug: string, @Param('id') id: string, @Res({ passthrough: true }) res: Response) {
    const f = await this.site.media(slug, id);
    res.setHeader('Cache-Control', 'public, max-age=604800, immutable');
    return new StreamableFile(f.stream as never, { type: f.mime });
  }

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('contact')
  contact(@Param('slug') slug: string, @Body() dto: ContactDto) {
    return this.site.contact(slug, dto);
  }

  @Public()
  @Throttle({ default: { limit: 15, ttl: 60_000 } })
  @Post('donate')
  donate(@Param('slug') slug: string, @Body() dto: DonateDto, @Req() req: Request) {
    return this.store.donate(slug, dto, originOf(req));
  }

  @Public()
  @Get('pay/:token')
  pay(@Param('slug') slug: string, @Param('token') token: string) {
    return this.store.payInfo(slug, token);
  }

  @Public()
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Post('pay/:token/sandbox')
  sandbox(@Param('slug') slug: string, @Param('token') token: string, @Body() dto: SandboxPayDto) {
    return this.store.sandboxPay(slug, token, dto.ref);
  }

  @Public()
  @Get('receipt/:token')
  receipt(@Param('slug') slug: string, @Param('token') token: string, @Query('gift') gift?: string) {
    return this.store.receipt(slug, token, gift === '1');
  }

  @Public()
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Get('verify')
  verify(@Param('slug') slug: string, @Query('no') no: string, @Query('code') code: string) {
    return this.store.verify(slug, no, code);
  }
}
