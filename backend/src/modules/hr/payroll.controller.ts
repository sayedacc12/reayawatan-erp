import {
  BadRequestException, Body, Controller, Delete, Get, Header, HttpCode, Param, ParseUUIDPipe, Post, Put, Query, Req, Res, UploadedFile, UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { memoryStorage } from 'multer';
import { CurrentOrgUser, OrgUser, Public, RequireAnyPermission, RequirePermissions } from '../../core/auth/decorators';
import { AttendanceService } from './attendance.service';
import {
  AllowanceTypeDto, AttendanceConfigDto, DeviceDto, ExpenseProfileDto, ManualPunchDto, PayrollConfigDto, RunCreateDto, RunDecisionDto, RunLineDto, RunNoteDto, RunVouchersDto,
} from './hr.dto';
import { today } from './hr-core.service';
import { HR_PERMISSIONS as P } from './hr.manifest';
import { PayrollService } from './payroll.service';

const uuid = new ParseUUIDPipe();
const MAX_FILE = 10 * 1024 * 1024;

/** بنود الراتب والربط المحاسبي، الحضور والانصراف، وكشوف الرواتب الشهرية */
@Controller('hr')
export class PayrollController {
  constructor(private readonly payroll: PayrollService, private readonly attendance: AttendanceService) {}

  // ---------------- بنود الراتب (البدلات) ----------------

  @Get('allowance-types')
  @RequirePermissions(P.read)
  allowances(@CurrentOrgUser() actor: OrgUser) {
    return this.payroll.listAllowances(actor);
  }

  @Post('allowance-types')
  @RequirePermissions(P.settings)
  createAllowance(@CurrentOrgUser() actor: OrgUser, @Body() dto: AllowanceTypeDto) {
    return this.payroll.saveAllowance(actor, dto);
  }

  @Put('allowance-types/:id')
  @RequirePermissions(P.settings)
  updateAllowance(@CurrentOrgUser() actor: OrgUser, @Param('id', uuid) id: string, @Body() dto: AllowanceTypeDto) {
    return this.payroll.saveAllowance(actor, dto, id);
  }

  @Delete('allowance-types/:id')
  @RequirePermissions(P.settings)
  removeAllowance(@CurrentOrgUser() actor: OrgUser, @Param('id', uuid) id: string) {
    return this.payroll.removeAllowance(actor, id);
  }

  // ---------------- الربط المحاسبي ومراحل الاعتماد ----------------

  @Get('expense-profiles')
  @RequirePermissions(P.read)
  profiles(@CurrentOrgUser() actor: OrgUser) {
    return this.payroll.listProfiles(actor);
  }

  @Post('expense-profiles')
  @RequirePermissions(P.settings)
  createProfile(@CurrentOrgUser() actor: OrgUser, @Body() dto: ExpenseProfileDto) {
    return this.payroll.saveProfile(actor, dto);
  }

  @Put('expense-profiles/:id')
  @RequirePermissions(P.settings)
  updateProfile(@CurrentOrgUser() actor: OrgUser, @Param('id', uuid) id: string, @Body() dto: ExpenseProfileDto) {
    return this.payroll.saveProfile(actor, dto, id);
  }

  @Delete('expense-profiles/:id')
  @RequirePermissions(P.settings)
  removeProfile(@CurrentOrgUser() actor: OrgUser, @Param('id', uuid) id: string) {
    return this.payroll.removeProfile(actor, id);
  }

  @Get('payroll-config')
  @RequireAnyPermission(P.settings, P.structure)
  config(@CurrentOrgUser() actor: OrgUser) {
    return this.payroll.getConfig(actor);
  }

  @Put('payroll-config')
  @RequirePermissions(P.settings)
  saveConfig(@CurrentOrgUser() actor: OrgUser, @Body() dto: PayrollConfigDto) {
    return this.payroll.saveConfig(actor, dto);
  }

  // ---------------- كشوف الرواتب ----------------

  @Get('payroll-runs')
  @RequirePermissions(P.salaries)
  runs(@CurrentOrgUser() actor: OrgUser) {
    return this.payroll.list(actor);
  }

  @Post('payroll-runs')
  @RequirePermissions(P.salaries, P.payroll)
  createRun(@CurrentOrgUser() actor: OrgUser, @Body() dto: RunCreateDto) {
    return this.payroll.create(actor, dto.month, dto.kind ?? 'staff');
  }

  @Get('payroll-runs/:id')
  @RequirePermissions(P.salaries)
  run(@CurrentOrgUser() actor: OrgUser, @Param('id', uuid) id: string) {
    return this.payroll.get(actor, id);
  }

  @Post('payroll-runs/:id/recalc')
  @RequirePermissions(P.salaries, P.payroll)
  recalc(@CurrentOrgUser() actor: OrgUser, @Param('id', uuid) id: string) {
    return this.payroll.recalc(actor, id);
  }

  @Put('payroll-runs/:id/lines/:employeeId')
  @RequirePermissions(P.salaries, P.payroll)
  line(@CurrentOrgUser() actor: OrgUser, @Param('id', uuid) id: string, @Param('employeeId', uuid) employeeId: string, @Body() dto: RunLineDto) {
    return this.payroll.updateLine(actor, id, employeeId, dto);
  }

  @Post('payroll-runs/:id/submit')
  @RequirePermissions(P.salaries, P.payroll)
  submit(@CurrentOrgUser() actor: OrgUser, @Param('id', uuid) id: string) {
    return this.payroll.submit(actor, id);
  }

  @Post('payroll-runs/:id/decision')
  @RequirePermissions(P.salaries, P.approvePayroll)
  decide(@CurrentOrgUser() actor: OrgUser, @Param('id', uuid) id: string, @Body() dto: RunDecisionDto) {
    return this.payroll.decide(actor, id, dto);
  }

  @Post('payroll-runs/:id/reopen')
  @RequirePermissions(P.salaries, P.approvePayroll)
  reopen(@CurrentOrgUser() actor: OrgUser, @Param('id', uuid) id: string, @Body() dto: RunNoteDto) {
    return this.payroll.reopen(actor, id, dto.note);
  }

  @Post('payroll-runs/:id/cancel')
  @RequirePermissions(P.salaries, P.payroll)
  cancel(@CurrentOrgUser() actor: OrgUser, @Param('id', uuid) id: string) {
    return this.payroll.cancel(actor, id);
  }

  @Post('payroll-runs/:id/vouchers')
  @RequirePermissions(P.salaries, P.payPayroll)
  vouchers(@CurrentOrgUser() actor: OrgUser, @Param('id', uuid) id: string, @Body() dto: RunVouchersDto) {
    return this.payroll.createVouchers(actor, id, dto);
  }

  // ---------------- الحضور والانصراف ----------------

  @Get('attendance/settings')
  @RequirePermissions(P.read)
  attendanceSettings(@CurrentOrgUser() actor: OrgUser) {
    return this.attendance.getSettings(actor);
  }

  @Put('attendance/settings')
  @RequirePermissions(P.settings)
  saveAttendance(@CurrentOrgUser() actor: OrgUser, @Body() dto: AttendanceConfigDto) {
    return this.attendance.saveConfig(actor, dto);
  }

  @Post('attendance/devices')
  @RequirePermissions(P.settings)
  addDevice(@CurrentOrgUser() actor: OrgUser, @Body() dto: DeviceDto) {
    return this.attendance.saveDevice(actor, dto);
  }

  @Put('attendance/devices/:id')
  @RequirePermissions(P.settings)
  updateDevice(@CurrentOrgUser() actor: OrgUser, @Param('id', uuid) id: string, @Body() dto: DeviceDto) {
    return this.attendance.saveDevice(actor, dto, id);
  }

  @Delete('attendance/devices/:id')
  @RequirePermissions(P.settings)
  removeDevice(@CurrentOrgUser() actor: OrgUser, @Param('id', uuid) id: string) {
    return this.attendance.removeDevice(actor, id);
  }

  @Get('attendance')
  @RequirePermissions(P.read)
  summary(@CurrentOrgUser() actor: OrgUser, @Query('month') month?: string) {
    return this.attendance.summary(actor, month ?? today().slice(0, 7));
  }

  @Get('attendance/employees/:id')
  @RequirePermissions(P.read)
  employeeMonth(@CurrentOrgUser() actor: OrgUser, @Param('id', uuid) id: string, @Query('month') month?: string) {
    return this.attendance.employeeMonth(actor, id, month ?? today().slice(0, 7));
  }

  @Get('attendance/imports')
  @RequirePermissions(P.read)
  imports(@CurrentOrgUser() actor: OrgUser) {
    return this.attendance.imports(actor);
  }

  @Get('attendance/sheet/template')
  @RequirePermissions(P.attendance)
  async sheetTemplate(@CurrentOrgUser() actor: OrgUser, @Res() res: Response, @Query('month') month?: string, @Query('unitId') unitId?: string) {
    if (unitId) uuid.transform(unitId, { type: 'query' });
    const m = month ?? today().slice(0, 7);
    const { buffer, fileName } = await this.attendance.sheetTemplate(actor, m, unitId || undefined);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"; filename*=UTF-8''${encodeURIComponent(`كشف الحضور ${m}.xlsx`)}`);
    res.send(buffer);
  }

  @Post('attendance/sheet/preview')
  @HttpCode(200)
  @Throttle({ default: { limit: 20, ttl: 60000 } })
  @RequirePermissions(P.attendance)
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: MAX_FILE, files: 1 } }))
  sheetPreview(@CurrentOrgUser() actor: OrgUser, @UploadedFile() file: Express.Multer.File) {
    return this.attendance.sheetPreview(actor, file);
  }

  @Post('attendance/sheet')
  @Throttle({ default: { limit: 20, ttl: 60000 } })
  @RequirePermissions(P.attendance)
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: MAX_FILE, files: 1 } }))
  sheetCommit(@CurrentOrgUser() actor: OrgUser, @UploadedFile() file: Express.Multer.File) {
    return this.attendance.sheetCommit(actor, file);
  }

  @Delete('attendance/imports/:id')
  @RequirePermissions(P.attendance)
  revertImport(@CurrentOrgUser() actor: OrgUser, @Param('id', uuid) id: string) {
    return this.attendance.revertImport(actor, id);
  }

  @Post('attendance/import')
  @RequirePermissions(P.attendance)
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: MAX_FILE, files: 1 } }))
  importFile(@CurrentOrgUser() actor: OrgUser, @UploadedFile() file: Express.Multer.File) {
    return this.attendance.importFile(actor, file);
  }

  @Post('attendance/punches')
  @RequirePermissions(P.attendance)
  addPunch(@CurrentOrgUser() actor: OrgUser, @Body() dto: ManualPunchDto) {
    return this.attendance.addPunch(actor, dto);
  }

  @Delete('attendance/punches/:id')
  @RequirePermissions(P.attendance)
  removePunch(@CurrentOrgUser() actor: OrgUser, @Param('id', uuid) id: string) {
    return this.attendance.removePunch(actor, id);
  }
}

/** يقرأ جسم الطلب النصي كما أرسله الجهاز (لا يحلله Nest لأنه ليس JSON) */
async function rawText(req: Request): Promise<string> {
  if (typeof req.body === 'string') return req.body;
  if (req.readableEnded) return '';
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const c of req) {
    size += (c as Buffer).length;
    if (size > 2 * 1024 * 1024) throw new BadRequestException('too large');
    chunks.push(c as Buffer);
  }
  return Buffer.concat(chunks).toString('utf8');
}

/**
 * استقبال أجهزة البصمة (بروتوكول الإرسال التلقائي ADMS / iclock المستخدم في أجهزة ZKTeco وما يشبهها).
 * عنوان الخادم في الجهاز: نطاق النظام، والمسار /iclock يوجَّه إلى هنا. الجهاز يُعرف برقمه التسلسلي المسجل في الإعدادات.
 */
@Public()
@Controller('hr/iclock')
export class IclockController {
  constructor(private readonly attendance: AttendanceService) {}

  @Get('cdata')
  @Header('Content-Type', 'text/plain')
  @Throttle({ default: { limit: 120, ttl: 60000 } })
  handshake(@Query('SN') sn?: string) {
    return this.attendance.deviceHandshake(sn);
  }

  @Post('cdata')
  @HttpCode(200)
  @Header('Content-Type', 'text/plain')
  @Throttle({ default: { limit: 120, ttl: 60000 } })
  async data(@Req() req: Request, @Query('SN') sn?: string, @Query('table') table?: string) {
    return this.attendance.deviceData(sn, table, await rawText(req));
  }

  @Get('getrequest')
  @Header('Content-Type', 'text/plain')
  @Throttle({ default: { limit: 120, ttl: 60000 } })
  poll(@Query('SN') sn?: string) {
    return this.attendance.devicePoll(sn);
  }

  @Post('devicecmd')
  @HttpCode(200)
  @Header('Content-Type', 'text/plain')
  devicecmd() {
    return 'OK';
  }
}
