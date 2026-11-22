import {
  BadRequestException, Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Put, Query, Req, Res, StreamableFile, UploadedFile, UploadedFiles, UseInterceptors,
} from '@nestjs/common';
import { AnyFilesInterceptor, FileInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { memoryStorage } from 'multer';
import { CurrentOrgUser, OrgUser, Public, RequirePermissions } from '../../core/auth/decorators';
import { MAX_UPLOAD_BYTES } from '../../core/files/file-store.service';
import { originOf } from '../../core/subscriptions/subscriptions.controller';
import { ApplicationsService } from './applications.service';
import { BillingService } from './billing.service';
import { MEMBER_PERMISSIONS as P } from './members.manifest';
import {
  ApplicationDto, ChangeTypeDto, DecisionDto, DirectMemberDto, MembershipLookupDto, MemberStatusDto, NoteDto, NoticeDto, parseJsonDto, RecordPaymentDto,
  SettingsDto, TransferDto, UpdateMemberDto,
} from './members.dto';
import { MembersService } from './members.service';
import { MemCore, SETTINGS_SECTIONS, SettingsSection } from './mem-core.service';
import { MemReportsService } from './reports.service';

const uuid = new ParseUUIDPipe();
const filesUpload = () => UseInterceptors(AnyFilesInterceptor({ storage: memoryStorage(), limits: { fileSize: MAX_UPLOAD_BYTES, files: 10 } }));
const fileUpload = (name: string) => UseInterceptors(FileInterceptor(name, { storage: memoryStorage(), limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 } }));
const KEY = /^[a-z][a-z0-9_]{0,39}$/;

function stream(res: Response, f: { stream: NodeJS.ReadableStream; mime: string; name: string }) {
  res.setHeader('Cache-Control', 'private, no-store');
  return new StreamableFile(f.stream as never, { type: f.mime, disposition: `inline; filename*=UTF-8''${encodeURIComponent(f.name)}` });
}

/** عضوية الجمعية العمومية داخل الشركة */
@Controller('members')
export class MembersController {
  constructor(
    private readonly core: MemCore,
    private readonly apps: ApplicationsService,
    private readonly people: MembersService,
    private readonly billing: BillingService,
    private readonly reportsService: MemReportsService,
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

  @Get('assembly')
  @RequirePermissions(P.read)
  assembly(@CurrentOrgUser() actor: OrgUser, @Query('date') date?: string) {
    return this.reportsService.assembly(actor, date);
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
    if (!SETTINGS_SECTIONS.includes(section as SettingsSection)) throw new BadRequestException('قسم الإعدادات غير معروف');
    return this.core.saveSettings(actor, section as SettingsSection, dto.data);
  }

  // ---------------- الطلبات ----------------

  @Get('applications')
  @RequirePermissions(P.read)
  applications(@CurrentOrgUser() actor: OrgUser, @Query() q: { status?: string; type?: string; search?: string; awaiting?: string; source?: string }) {
    return this.apps.list(actor, q);
  }

  /** إدخال طلب داخليًا: البيانات في الحقل data كنص JSON، والمستندات ملفات بأسماء مفاتيحها */
  @Post('applications')
  @RequirePermissions(P.applications)
  @filesUpload()
  async createApplication(@CurrentOrgUser() actor: OrgUser, @Body('data') data: string, @UploadedFiles() files: Express.Multer.File[] = []) {
    const dto = await parseJsonDto(ApplicationDto, data);
    const r = await this.apps.create(actor.organizationId, dto, files, 'staff', actor.fullName);
    return this.apps.detail(actor, r.id);
  }

  @Get('applications/:id')
  @RequirePermissions(P.read)
  application(@CurrentOrgUser() actor: OrgUser, @Param('id', uuid) id: string) {
    return this.apps.detail(actor, id);
  }

  @Post('applications/:id/resubmit')
  @RequirePermissions(P.applications)
  @filesUpload()
  async resubmit(@CurrentOrgUser() actor: OrgUser, @Param('id', uuid) id: string, @Body('data') data: string, @UploadedFiles() files: Express.Multer.File[] = []) {
    const dto = await parseJsonDto(ApplicationDto, data);
    await this.apps.resubmit(actor.organizationId, id, dto, files, actor.fullName, false);
    return this.apps.detail(actor, id);
  }

  @Post('applications/:id/decision')
  @RequirePermissions(P.approve)
  decide(@CurrentOrgUser() actor: OrgUser, @Param('id', uuid) id: string, @Body() dto: DecisionDto) {
    return this.apps.decide(actor, id, dto);
  }

  @Post('applications/:id/cancel')
  @RequirePermissions(P.applications)
  cancelApplication(@CurrentOrgUser() actor: OrgUser, @Param('id', uuid) id: string, @Body() dto: NoteDto) {
    return this.apps.cancel(actor, id, dto.note);
  }

  @Get('applications/:id/documents/:key')
  @RequirePermissions(P.read)
  async applicationDocument(@CurrentOrgUser() actor: OrgUser, @Param('id', uuid) id: string, @Param('key') key: string, @Res({ passthrough: true }) res: Response) {
    return stream(res, await this.apps.documentFile(actor.organizationId, id, key));
  }

  // ---------------- الأعضاء ----------------

  @Get('members')
  @RequirePermissions(P.read)
  list(@CurrentOrgUser() actor: OrgUser, @Query() q: { status?: string; type?: string; search?: string; voting?: string; gender?: string }) {
    return this.people.list(actor, q);
  }

  @Post('members')
  @RequirePermissions(P.members)
  createDirect(@CurrentOrgUser() actor: OrgUser, @Body() dto: DirectMemberDto) {
    return this.people.createDirect(actor, dto);
  }

  @Get('members/:id')
  @RequirePermissions(P.read)
  profile(@CurrentOrgUser() actor: OrgUser, @Param('id', uuid) id: string) {
    return this.people.profile(actor, id);
  }

  @Patch('members/:id')
  @RequirePermissions(P.members)
  update(@CurrentOrgUser() actor: OrgUser, @Param('id', uuid) id: string, @Body() dto: UpdateMemberDto) {
    return this.people.update(actor, id, dto);
  }

  @Post('members/:id/type')
  @RequirePermissions(P.members)
  changeType(@CurrentOrgUser() actor: OrgUser, @Param('id', uuid) id: string, @Body() dto: ChangeTypeDto) {
    return this.people.changeType(actor, id, dto);
  }

  @Post('members/:id/status')
  @RequirePermissions(P.members)
  setStatus(@CurrentOrgUser() actor: OrgUser, @Param('id', uuid) id: string, @Body() dto: MemberStatusDto) {
    return this.people.setStatus(actor, id, dto);
  }

  @Post('members/:id/documents/:key')
  @RequirePermissions(P.members)
  @filesUpload()
  uploadDocument(@CurrentOrgUser() actor: OrgUser, @Param('id', uuid) id: string, @Param('key') key: string, @UploadedFiles() files: Express.Multer.File[] = []) {
    if (!KEY.test(key)) throw new BadRequestException('المستند غير معروف');
    const file = files[0];
    if (!file) throw new BadRequestException('اختر ملفًا لرفعه');
    return this.people.uploadDocument(actor, id, { ...file, fieldname: key });
  }

  @Get('members/:id/documents/:key')
  @RequirePermissions(P.read)
  async memberDocument(@CurrentOrgUser() actor: OrgUser, @Param('id', uuid) id: string, @Param('key') key: string, @Res({ passthrough: true }) res: Response) {
    return stream(res, await this.people.documentFile(actor.organizationId, id, key));
  }

  @Get('members/:id/card')
  @RequirePermissions(P.read)
  card(@CurrentOrgUser() actor: OrgUser, @Param('id', uuid) id: string) {
    return this.people.card(actor.organizationId, id);
  }

  @Post('members/:id/renewal')
  @RequirePermissions(P.payments)
  async renewal(@CurrentOrgUser() actor: OrgUser, @Param('id', uuid) id: string) {
    const r = await this.billing.issueRenewal(actor.organizationId, id, actor.fullName);
    return { invoiceId: r.invoice?.id ?? null, created: r.created, extended: r.extended };
  }

  @Post('members/:id/notices')
  @RequirePermissions(P.members)
  notice(@CurrentOrgUser() actor: OrgUser, @Param('id', uuid) id: string, @Body() dto: NoticeDto) {
    return this.billing.notice(actor, id, dto);
  }

  @Get('renewals')
  @RequirePermissions(P.read)
  renewals(@CurrentOrgUser() actor: OrgUser, @Req() req: Request) {
    return this.billing.renewals(actor, originOf(req));
  }

  // ---------------- المطالبات ----------------

  @Get('invoices')
  @RequirePermissions(P.read)
  invoices(@CurrentOrgUser() actor: OrgUser, @Query() q: { status?: string; kind?: string; search?: string; method?: string }) {
    return this.billing.list(actor, q);
  }

  @Get('invoices/:id')
  @RequirePermissions(P.read)
  invoice(@CurrentOrgUser() actor: OrgUser, @Param('id', uuid) id: string) {
    return this.billing.get(actor, id);
  }

  @Post('invoices/:id/pay')
  @RequirePermissions(P.payments)
  pay(@CurrentOrgUser() actor: OrgUser, @Param('id', uuid) id: string, @Body() dto: RecordPaymentDto) {
    return this.billing.recordPayment(actor, id, dto);
  }

  @Post('invoices/:id/reject-transfer')
  @RequirePermissions(P.payments)
  rejectTransfer(@CurrentOrgUser() actor: OrgUser, @Param('id', uuid) id: string, @Body() dto: NoteDto) {
    return this.billing.rejectTransfer(actor, id, dto.note);
  }

  @Post('invoices/:id/cancel')
  @RequirePermissions(P.payments)
  cancelInvoice(@CurrentOrgUser() actor: OrgUser, @Param('id', uuid) id: string, @Body() dto: NoteDto) {
    return this.billing.cancel(actor, id, dto.note);
  }

  @Post('invoices/:id/voucher')
  @RequirePermissions(P.payments)
  voucher(@CurrentOrgUser() actor: OrgUser, @Param('id', uuid) id: string) {
    return this.billing.retryVoucher(actor, id);
  }

  @Post('invoices/:id/check')
  @RequirePermissions(P.payments)
  check(@CurrentOrgUser() actor: OrgUser, @Param('id', uuid) id: string) {
    return this.billing.checkGateway(actor, id);
  }

  @Get('invoices/:id/receipt')
  @RequirePermissions(P.read)
  async receipt(@CurrentOrgUser() actor: OrgUser, @Param('id', uuid) id: string, @Res({ passthrough: true }) res: Response) {
    return stream(res, await this.billing.receiptFile(actor.organizationId, id));
  }
}

/**
 * الصفحات العامة بدون دخول: شروط العضوية وأنواعها والتقديم، متابعة الطلب واستكماله،
 * «عضويتي» والتجديد، رابط السداد، والتحقق من بطاقة العضوية.
 */
@Public()
@Throttle({ default: { limit: 30, ttl: 60_000 } })
@Controller('public/members')
export class PublicMembersController {
  constructor(
    private readonly core: MemCore,
    private readonly apps: ApplicationsService,
    private readonly people: MembersService,
    private readonly billing: BillingService,
  ) {}

  @Get('org/:slug')
  async info(@Param('slug') slug: string) {
    const org = await this.core.organization(slug);
    const s = await this.core.settings(org.id);
    return {
      name: org.name, slug: org.slug, publicEnabled: s.publicEnabled, intro: s.intro,
      types: s.types.filter((t) => t.isActive && t.publicApply).map((t) => ({
        code: t.code, name: t.name, description: t.description, fee: t.fee, joiningFee: t.joiningFee, durationMonths: t.durationMonths,
        votingRights: t.votingRights, minAge: t.minAge, saudiOnly: t.saudiOnly, benefits: t.benefits, color: t.color,
      })),
      conditions: s.conditions.filter((c) => c.isActive), regulation: { title: s.regulation.title, sections: s.regulation.sections, version: s.regulation.version, effectiveDate: s.regulation.effectiveDate },
      applicationFields: s.applicationFields, documents: s.documents.filter((d) => d.isActive), nationalities: await this.core.nationalities(org.id),
      payment: { online: s.payment.online, transfer: s.payment.transfer, cash: s.payment.cash },
    };
  }

  @Post('org/:slug/apply')
  @Throttle({ default: { limit: 8, ttl: 60_000 } })
  @filesUpload()
  async apply(@Param('slug') slug: string, @Body('data') data: string, @UploadedFiles() files: Express.Multer.File[] = []) {
    const org = await this.core.organization(slug);
    const dto = await parseJsonDto(ApplicationDto, data);
    return this.apps.create(org.id, dto, files, 'public', null);
  }

  @Get('org/:slug/applications/:no')
  async track(@Param('slug') slug: string, @Param('no') no: string, @Query('code') code = '') {
    const org = await this.core.organization(slug);
    return this.apps.publicTrack(org.id, no, code);
  }

  @Post('org/:slug/applications/:no/resubmit')
  @Throttle({ default: { limit: 8, ttl: 60_000 } })
  @filesUpload()
  async resubmit(@Param('slug') slug: string, @Param('no') no: string, @Query('code') code: string, @Body('data') data: string, @UploadedFiles() files: Express.Multer.File[] = []) {
    const org = await this.core.organization(slug);
    const a = await this.apps.publicFind(org.id, no, code ?? '');
    const dto = await parseJsonDto(ApplicationDto, data);
    await this.apps.resubmit(org.id, a.id, dto, files, a.fullName, true);
    return this.apps.publicTrack(org.id, no, code);
  }

  @Post('org/:slug/membership')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async membership(@Param('slug') slug: string, @Body() dto: MembershipLookupDto) {
    const org = await this.core.organization(slug);
    return this.people.publicMembership(org.id, dto.memberNo, dto.nationalId);
  }

  @Post('org/:slug/membership/renew')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async renew(@Param('slug') slug: string, @Body() dto: MembershipLookupDto) {
    const org = await this.core.organization(slug);
    const m = await this.people.findForPublic(org.id, dto.memberNo, dto.nationalId);
    const r = await this.billing.issueRenewal(org.id, m.id, `${m.fullName} (من صفحة العضوية)`);
    if (!r.invoice) return { payToken: null, extended: r.extended };
    return { payToken: r.invoice.payToken, extended: null };
  }

  @Get('pay/:token')
  payInfo(@Param('token') t: string) {
    return this.billing.payInfo(t);
  }

  @Post('pay/:token/online')
  online(@Param('token') t: string, @Req() req: Request) {
    return this.billing.startOnline(t, originOf(req));
  }

  @Post('pay/:token/sandbox')
  sandbox(@Param('token') t: string, @Body() body: { ref?: string }) {
    return this.billing.sandboxPay(t, String(body?.ref ?? ''));
  }

  @Post('pay/:token/verify')
  verify(@Param('token') t: string) {
    return this.billing.verifyOnline(t);
  }

  @Post('pay/:token/transfer')
  @Throttle({ default: { limit: 6, ttl: 60_000 } })
  @fileUpload('receipt')
  transfer(@Param('token') t: string, @Body() dto: TransferDto, @UploadedFile() file?: Express.Multer.File) {
    return this.billing.submitTransfer(t, file, dto.reference ?? null);
  }

  @Get('card/:code')
  verifyCard(@Param('code') code: string) {
    return this.people.verifyCard(code);
  }
}
