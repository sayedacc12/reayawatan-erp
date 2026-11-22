import {
  BadRequestException, Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query, Req, Res, UploadedFiles, UseInterceptors,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import type { Request, Response } from 'express';
import { memoryStorage } from 'multer';
import { Throttle } from '@nestjs/throttler';
import { AuthenticatedOnly, CurrentOrgUser, OrgUser, RequireAnyPermission, RequirePermissions } from '../../core/auth/decorators';
import { AttendanceService } from './attendance.service';
import { MobilePunchDto } from './hr.dto';
import { MAX_UPLOAD_BYTES } from '../../core/files/file-store.service';
import { HR_PERMISSIONS as P } from './hr.manifest';
import { RequestInput, RequestsService, TypeInput } from './requests.service';
import { SelfServiceService } from './self-service.service';

const uuid = new ParseUUIDPipe();
const upload = () => UseInterceptors(FilesInterceptor('files', 5, { storage: memoryStorage(), limits: { fileSize: MAX_UPLOAD_BYTES, files: 5 } }));

/** الطلب يصل multipart: بياناته نص JSON في الحقل payload والمرفقات في files */
function payloadOf(body: { payload?: string } & Partial<RequestInput>): RequestInput {
  if (typeof body.payload === 'string') {
    try {
      return JSON.parse(body.payload) as RequestInput;
    } catch {
      throw new BadRequestException('بيانات الطلب غير صحيحة');
    }
  }
  return body as RequestInput;
}

/**
 * الخدمة الذاتية: لكل موظف مربوط حسابه بملفه (بلا صلاحيات إضافية) لوحته وطلباته، ولمديره فريقه واعتماداته.
 * وشؤون الموظفين: أنواع الطلبات ومساراتها وكل الطلبات والسلف.
 */
@Controller('hr')
export class SelfServiceController {
  constructor(private readonly requests: RequestsService, private readonly self: SelfServiceService, private readonly attendance: AttendanceService) {}

  // ---------------- الحضور من الجوال ----------------

  @Get('me/attendance')
  @AuthenticatedOnly('الموظف يرى حالة حضوره اليوم فقط؛ الخدمة تتحقق من ربط حسابه بملفه')
  async myAttendance(@CurrentOrgUser() a: OrgUser) {
    const me = await this.requests.requireEmployee(a);
    return this.attendance.myAttendance(a.organizationId, me.employee);
  }

  @Post('me/attendance')
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @AuthenticatedOnly('الموظف يسجل حضوره هو فقط من الجوال؛ الخدمة تتحقق من ربط حسابه بملفه وتفعيل الجوال له والموقع')
  async mobilePunch(@CurrentOrgUser() a: OrgUser, @Body() dto: MobilePunchDto, @Req() req: Request) {
    const me = await this.requests.requireEmployee(a);
    return this.attendance.mobilePunch(a.organizationId, me.employee, dto, { ip: req.ip ?? null, userAgent: req.get('user-agent') ?? null });
  }

  // ---------------- الموظف ----------------

  @Get('me/summary')
  summary(@CurrentOrgUser() a: OrgUser) {
    return this.self.summary(a);
  }

  @Get('me')
  dashboard(@CurrentOrgUser() a: OrgUser) {
    return this.self.dashboard(a);
  }

  @Get('me/types')
  async myTypes(@CurrentOrgUser() a: OrgUser) {
    const me = await this.requests.requireEmployee(a);
    return this.requests.availableTypes(a.organizationId, me.employee);
  }

  @Get('me/requests')
  mine(@CurrentOrgUser() a: OrgUser) {
    return this.requests.mine(a);
  }

  @Post('me/requests')
  @upload()
  submit(@CurrentOrgUser() a: OrgUser, @Body() body: { payload?: string }, @UploadedFiles() files: Express.Multer.File[]) {
    return this.requests.submit(a, payloadOf(body), files);
  }

  @Get('me/requests/:id')
  request(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string) {
    return this.requests.view(a, id);
  }

  @Patch('me/requests/:id')
  @upload()
  resubmit(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string, @Body() body: { payload?: string }, @UploadedFiles() files: Express.Multer.File[]) {
    return this.requests.resubmit(a, id, payloadOf(body), files);
  }

  @Post('me/requests/:id/cancel')
  @HttpCode(200)
  cancel(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string) {
    return this.requests.cancel(a, id);
  }

  @Post('me/requests/:id/attachments')
  @upload()
  attach(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string, @UploadedFiles() files: Express.Multer.File[]) {
    return this.requests.addAttachments(a, id, files);
  }

  @Get('me/requests/:id/attachments/:attId')
  async file(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string, @Param('attId', uuid) attId: string, @Res() res: Response) {
    const { doc, stream } = await this.requests.attachment(a, id, attId);
    res.setHeader('Content-Type', doc.mimeType);
    res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(doc.fileName)}`);
    stream.pipe(res);
  }

  @Post('me/requests/:id/decision')
  @HttpCode(200)
  decide(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string, @Body() body: { decision?: string; note?: string | null }) {
    const d = body.decision;
    if (d !== 'approve' && d !== 'return' && d !== 'reject') throw new BadRequestException('اختر القرار');
    const note = typeof body.note === 'string' && body.note.trim() ? body.note.trim().slice(0, 1000) : null;
    return this.requests.decide(a, id, d, note);
  }

  // ---------------- المدير ----------------

  @Get('me/approvals')
  approvals(@CurrentOrgUser() a: OrgUser) {
    return this.requests.approvals(a);
  }

  @Get('me/team')
  team(@CurrentOrgUser() a: OrgUser) {
    return this.self.team(a);
  }

  @Get('me/team/:id')
  member(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string) {
    return this.self.member(a, id);
  }

  // ---------------- شؤون الموظفين ----------------

  @Get('requests')
  @RequirePermissions(P.requests)
  all(@CurrentOrgUser() a: OrgUser, @Query('status') status?: string, @Query('typeId') typeId?: string, @Query('employeeId') employeeId?: string) {
    return this.requests.all(a, { status, typeId, employeeId });
  }

  @Get('advances')
  @RequirePermissions(P.requests)
  advances(@CurrentOrgUser() a: OrgUser, @Query('employeeId') employeeId?: string) {
    return this.requests.advances(a.organizationId, { employeeId: employeeId && /^[0-9a-f-]{36}$/i.test(employeeId) ? employeeId : undefined });
  }

  @Get('request-types')
  @RequireAnyPermission(P.settings, P.requests)
  types(@CurrentOrgUser() a: OrgUser) {
    return this.requests.listTypes(a);
  }

  @Post('request-types')
  @RequirePermissions(P.settings)
  createType(@CurrentOrgUser() a: OrgUser, @Body() dto: TypeInput) {
    return this.requests.createType(a, dto);
  }

  @Post('request-types/defaults')
  @HttpCode(200)
  @RequirePermissions(P.settings)
  async defaults(@CurrentOrgUser() a: OrgUser) {
    return { added: await this.requests.addDefaults(a.organizationId) };
  }

  @Patch('request-types/:id')
  @RequirePermissions(P.settings)
  updateType(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string, @Body() dto: TypeInput) {
    return this.requests.updateType(a, id, dto);
  }

  @Delete('request-types/:id')
  @HttpCode(204)
  @RequirePermissions(P.settings)
  removeType(@CurrentOrgUser() a: OrgUser, @Param('id', uuid) id: string) {
    return this.requests.removeType(a, id);
  }
}
