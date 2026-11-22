import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { Between, DataSource } from 'typeorm';
import { OrgUser } from '../../core/auth/decorators';
import { attendanceConfig, attendanceMonth, DAY_STATUS_AR, MonthResult } from './attendance-calc';
import { extractPunches, parseAttlog, ParsedPunch, readText, readXlsx } from './attendance-files';
import { buildSheetTemplate, monthName, readSheet } from './attendance-sheet';
import {
  AttendanceConfig, AttendanceSite, HrAttendanceDevice, HrAttendanceImport, HrAttendanceMark, HrAttendancePunch, HrEmployee, HrLeaveRequest, HrPayrollRun,
  HrSettings, HrUnit, MarkKind, PunchSource,
} from './entities/hr.entity';
import { AttendanceConfigDto, DeviceDto, ManualPunchDto, MobilePunchDto } from './hr.dto';
import { HrCore, today } from './hr-core.service';
import { lastDay, MONTH } from './people.service';

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
export const codeOf = (e: Pick<HrEmployee, 'attendanceCode' | 'employeeNo'>) => e.attendanceCode || String(e.employeeNo);
const SOURCE_AR: Record<PunchSource, string> = { device: 'جهاز البصمة', excel: 'ملف Excel', text: 'ملف نصي', manual: 'إدخال يدوي', mobile: 'الجوال' };
const MARK_AR: Record<MarkKind, string> = { present: 'حاضر', absent: 'غائب', leave: 'إجازة أو عذر', late: 'تأخير' };
/** أضعف دقة موقع مقبولة من الجوال (بالمتر) */
export const MOBILE_MAX_ACCURACY = 150;
/** أقل فاصل بين تسجيلين متتاليين من الجوال (بالدقائق) */
const MOBILE_GAP_MINUTES = 2;

/** المسافة بين نقطتين على الأرض بالمتر (هافرساين) */
export function distanceMeters(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const R = 6371000;
  const rad = (x: number) => (x * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(h)));
}
/** الوقت الآن بتوقيت الرياض HH:MM:SS */
const nowTime = () => new Date(Date.now() + 3 * 3600000).toISOString().slice(11, 19);

export interface EmployeeAttendance extends MonthResult { tracked: boolean; sheet: boolean }

/**
 * الحضور والانصراف: أجهزة البصمة ترسل البصمات مباشرة (بروتوكول الإرسال التلقائي ADMS المستخدم في أجهزة ZKTeco وما يشبهها)،
 * أو تُرفع ملفات Excel أو نصية مصدّرة من الجهاز. البصمات تُربط بالموظف برقمه في الجهاز، ثم يُحسب الحضور والغياب والتأخير
 * لكل شهر حسب الدوام والعطل، ويستخدمه مسير الرواتب في الخصم حسب اللائحة.
 */
@Injectable()
export class AttendanceService {
  constructor(private readonly db: DataSource, private readonly core: HrCore) {}

  // ---------------- الإعدادات والأجهزة ----------------

  async config(org: string): Promise<AttendanceConfig> {
    return attendanceConfig((await this.core.settings(org)).attendanceConfig);
  }

  async getSettings(actor: OrgUser) {
    const org = actor.organizationId;
    const devices = await this.db.getRepository(HrAttendanceDevice).find({ where: { organizationId: org }, order: { createdAt: 'ASC' } });
    return { config: await this.config(org), devices };
  }

  async saveConfig(actor: OrgUser, dto: AttendanceConfigDto) {
    if (!TIME.test(dto.workStart) || !TIME.test(dto.workEnd)) throw new BadRequestException('اكتب وقت بداية الدوام ونهايته بصيغة 08:00');
    if (dto.workEnd <= dto.workStart) throw new BadRequestException('نهاية الدوام يجب أن تكون بعد بدايته');
    const weekend = [...new Set(dto.weekend)].filter((d) => d >= 0 && d <= 6).sort();
    if (weekend.length > 3) throw new BadRequestException('أيام الراحة الأسبوعية ثلاثة أيام على الأكثر');
    const seen = new Set<string>();
    const holidays = dto.holidays.map((h) => ({ date: h.date, name: h.name.trim() })).filter((h) => {
      if (seen.has(h.date)) return false;
      seen.add(h.date);
      return true;
    }).sort((a, b) => a.date.localeCompare(b.date));
    const old = await this.config(actor.organizationId);
    const sites: AttendanceSite[] = (dto.sites ?? old.sites).map((x) => ({
      id: x.id && /^[0-9a-f-]{36}$/.test(x.id) ? x.id : randomUUID(), name: x.name.trim(), lat: Number(x.lat), lng: Number(x.lng), radius: Math.round(Number(x.radius)),
    }));
    const config: AttendanceConfig = { enabled: dto.enabled, workStart: dto.workStart, workEnd: dto.workEnd, weekend, holidays, sites };
    await this.core.settings(actor.organizationId);
    await this.db.getRepository(HrSettings).update({ organizationId: actor.organizationId }, { attendanceConfig: config });
    return this.getSettings(actor);
  }

  async saveDevice(actor: OrgUser, dto: DeviceDto, id?: string) {
    const org = actor.organizationId;
    const repo = this.db.getRepository(HrAttendanceDevice);
    const serial = dto.serialNumber.trim().toUpperCase();
    const dup = await repo.findOne({ where: { serialNumber: serial } });
    if (dup && dup.id !== id) {
      throw new ConflictException(dup.organizationId === org ? `الرقم التسلسلي مسجل للجهاز «${dup.name}»` : 'الرقم التسلسلي مسجل لجهة أخرى. تأكد من الرقم المكتوب على الجهاز');
    }
    const fields = { name: dto.name.trim(), brand: dto.brand?.trim() || null, serialNumber: serial, location: dto.location?.trim() || null, isActive: dto.isActive ?? true };
    if (id) {
      const d = await repo.findOne({ where: { id, organizationId: org } });
      if (!d) throw new NotFoundException('الجهاز غير موجود');
      await repo.update({ id }, fields);
    } else {
      await repo.save(repo.create({ organizationId: org, ...fields }));
    }
    return this.getSettings(actor);
  }

  async removeDevice(actor: OrgUser, id: string) {
    const repo = this.db.getRepository(HrAttendanceDevice);
    const d = await repo.findOne({ where: { id, organizationId: actor.organizationId } });
    if (!d) throw new NotFoundException('الجهاز غير موجود');
    if (d.punchCount > 0) throw new ConflictException('وصلت من هذا الجهاز بصمات، فلا يُحذف. يمكنك إيقافه بدلًا من ذلك');
    await repo.delete({ id });
    return this.getSettings(actor);
  }

  // ---------------- الاستلام من الجهاز (ADMS) ----------------

  private async device(serial: string | undefined) {
    if (!serial) return null;
    const d = await this.db.getRepository(HrAttendanceDevice).findOne({ where: { serialNumber: serial.trim().toUpperCase() } });
    if (!d || !d.isActive) return null;
    await this.db.getRepository(HrAttendanceDevice).update({ id: d.id }, { lastSeenAt: new Date() });
    return d;
  }

  /** أول اتصال من الجهاز: نرسل له إعدادات الإرسال */
  async deviceHandshake(serial?: string) {
    const d = await this.device(serial);
    if (!d) return 'UNKNOWN DEVICE';
    return [
      `GET OPTION FROM: ${d.serialNumber}`, 'ATTLOGStamp=None', 'OPERLOGStamp=9999', 'ATTPHOTOStamp=None', 'ErrorDelay=60', 'Delay=30',
      'TransTimes=00:00;14:05', 'TransInterval=1', 'TransFlag=TransData AttLog', 'TimeZone=3', 'Realtime=1', 'Encrypt=None',
    ].join('\n');
  }

  async devicePoll(serial?: string) {
    return (await this.device(serial)) ? 'OK' : 'UNKNOWN DEVICE';
  }

  /** الجهاز يرسل سجل البصمات (ATTLOG). باقي الجداول (المستخدمون والعمليات) نؤكد استلامها فقط */
  async deviceData(serial: string | undefined, table: string | undefined, body: string) {
    const d = await this.device(serial);
    if (!d) return 'UNKNOWN DEVICE';
    const lines = body.split(/\r?\n/).filter((l) => l.trim()).length;
    if ((table ?? '').toUpperCase() !== 'ATTLOG') return `OK: ${lines}`;
    const punches = parseAttlog(body);
    const added = await this.insert(d.organizationId, punches, { source: 'device', deviceId: d.id });
    await this.db.query('UPDATE hr_attendance_devices SET punch_count = punch_count + $2 WHERE id = $1', [d.id, added]);
    return `OK: ${lines}`;
  }

  // ---------------- رفع الملفات والإدخال اليدوي ----------------

  private async insert(org: string, punches: ParsedPunch[], extra: { source: PunchSource; deviceId?: string; importId?: string; note?: string | null; createdByName?: string | null }) {
    if (!punches.length) return 0;
    const employees = await this.db.getRepository(HrEmployee).find({ where: { organizationId: org }, select: ['id', 'employeeNo', 'attendanceCode'] });
    const byCode = new Map(employees.map((e) => [codeOf(e), e.id]));
    let added = 0;
    for (let i = 0; i < punches.length; i += 500) {
      const chunk = punches.slice(i, i + 500);
      const res = await this.db.getRepository(HrAttendancePunch).createQueryBuilder().insert().values(chunk.map((p) => ({
        organizationId: org, employeeId: byCode.get(p.code) ?? null, attendanceCode: p.code, punchDate: p.date, punchTime: p.time,
        source: extra.source, deviceId: extra.deviceId ?? null, importId: extra.importId ?? null, note: extra.note ?? null, createdByName: extra.createdByName ?? null,
      }))).orIgnore().returning('id').execute();
      added += (res.raw as unknown[]).length;
    }
    return added;
  }

  async importFile(actor: OrgUser, file: { originalname: string; buffer: Buffer } | undefined) {
    if (!file) throw new BadRequestException('اختر ملف الحضور');
    const org = actor.organizationId;
    const name = Buffer.from(file.originalname, 'latin1').toString('utf8');
    const isExcel = file.buffer.subarray(0, 2).toString('latin1') === 'PK';
    if (/\.xls$/i.test(name) && !isExcel) throw new BadRequestException('صيغة xls القديمة غير مدعومة. افتح الملف في Excel واحفظه بصيغة xlsx، أو صدّره ملفًا نصيًا CSV');
    let rows: string[][];
    try {
      rows = isExcel ? readXlsx(file.buffer) : readText(file.buffer);
    } catch (e) {
      throw new BadRequestException((e as Error).message);
    }
    const { punches, invalid } = extractPunches(rows);
    if (!punches.length) {
      throw new BadRequestException('لم نجد في الملف بصمات صالحة. يجب أن يحوي كل سطر رقم الموظف في الجهاز والتاريخ والوقت');
    }
    const repo = this.db.getRepository(HrAttendanceImport);
    const imp = await repo.save(repo.create({
      organizationId: org, fileName: name.slice(0, 250), format: isExcel ? 'excel' : 'text', rows: punches.length + invalid, added: 0, duplicates: 0, invalid,
      createdByName: actor.fullName,
    }));
    const added = await this.insert(org, punches, { source: isExcel ? 'excel' : 'text', importId: imp.id, createdByName: actor.fullName });
    const employees = await this.db.getRepository(HrEmployee).find({ where: { organizationId: org }, select: ['id', 'employeeNo', 'attendanceCode'] });
    const known = new Set(employees.map(codeOf));
    const unknownCodes = [...new Set(punches.map((p) => p.code).filter((c) => !known.has(c)))].slice(0, 100);
    const dates = punches.map((p) => p.date).sort();
    await repo.update({ id: imp.id }, { added, duplicates: punches.length - added, unknownCodes, dateFrom: dates[0], dateTo: dates[dates.length - 1] });
    return repo.findOneByOrFail({ id: imp.id });
  }

  async imports(actor: OrgUser) {
    return this.db.getRepository(HrAttendanceImport).find({ where: { organizationId: actor.organizationId }, order: { createdAt: 'DESC' }, take: 30 });
  }

  async addPunch(actor: OrgUser, dto: ManualPunchDto) {
    const org = actor.organizationId;
    if (!TIME.test(dto.time)) throw new BadRequestException('الوقت غير صحيح');
    if (dto.date > today()) throw new BadRequestException('لا تُسجَّل بصمة بتاريخ مستقبلي');
    const e = await this.db.getRepository(HrEmployee).findOne({ where: { id: dto.employeeId, organizationId: org } });
    if (!e) throw new NotFoundException('الموظف غير موجود');
    const added = await this.insert(org, [{ code: codeOf(e), date: dto.date, time: `${dto.time}:00` }], { source: 'manual', note: dto.note, createdByName: actor.fullName });
    if (!added) throw new ConflictException('توجد بصمة بالوقت نفسه');
    return this.employeeMonth(actor, e.id, dto.date.slice(0, 7));
  }

  async removePunch(actor: OrgUser, id: string) {
    const repo = this.db.getRepository(HrAttendancePunch);
    const p = await repo.findOne({ where: { id, organizationId: actor.organizationId } });
    if (!p) throw new NotFoundException('البصمة غير موجودة');
    if (p.source !== 'manual') throw new ConflictException('تُحذف البصمات اليدوية فقط. بصمات الجهاز والملفات تبقى كما وصلت');
    await repo.delete({ id });
    return { ok: true };
  }

  // ---------------- الاحتساب ----------------

  /** حضور الموظفين خلال الشهر، مع آخر يوم وصلت بياناته (ما بعده لا يُحتسب غيابًا) */
  async compute(org: string, month: string, employees: HrEmployee[]) {
    const cfg = await this.config(org);
    const start = `${month}-01`;
    const end = lastDay(month);
    const [cov] = await this.db.query(
      // آخر يوم وصلت بياناته (ولو بعد نهاية الشهر: فالشهر مغطى كاملًا)، وعدد بصمات الشهر
      `SELECT MAX(punch_date)::text AS last, (COUNT(*) FILTER (WHERE punch_date <= $3))::int AS n FROM hr_attendance_punches
        WHERE organization_id = $1 AND punch_date >= $2`, [org, start, end],
    );
    const t = today();
    // شهر بلا أي بصمة يُعد بلا بيانات (لا يُحتسب فيه غياب) حتى لو وصلت بيانات لما بعده
    const coverageEnd: string | null = cov.last && cov.n > 0 ? (cov.last < t ? cov.last : t) : null;
    const codes = employees.map(codeOf);
    const rows: { code: string; d: string; t: string }[] = codes.length ? await this.db.query(
      `SELECT attendance_code AS code, punch_date::text AS d, punch_time AS t FROM hr_attendance_punches
        WHERE organization_id = $1 AND punch_date BETWEEN $2 AND $3 AND attendance_code = ANY($4)`, [org, start, end, codes],
    ) : [];
    const leaves = employees.length ? await this.db.getRepository(HrLeaveRequest).createQueryBuilder('l')
      .where('l.organization_id = :org AND l.status = :s', { org, s: 'approved' }).andWhere('l.start_date <= :end AND l.end_date >= :start', { start, end })
      .getMany() : [];
    const policy = await this.core.policy(org);
    const { covered, marks } = await this.sheetData(org, month, employees.map((e) => e.id));
    const result = new Map<string, EmployeeAttendance>();
    for (const e of employees) {
      const code = codeOf(e);
      const punches = new Map<string, string[]>();
      rows.filter((r) => r.code === code).forEach((r) => punches.set(r.d, [...(punches.get(r.d) ?? []), r.t]));
      const sheet = covered.has(e.id);
      const m = attendanceMonth({
        month, from: e.hireDate > start ? e.hireDate : start, to: e.terminationDate && e.terminationDate < end ? e.terminationDate : end,
        coverageEnd: sheet ? end : coverageEnd, cfg, graceMinutes: policy.payroll.lateGraceMinutes, leaves: leaves.filter((l) => l.employeeId === e.id), punches,
        marks: marks.get(e.id), sheet,
      });
      result.set(e.id, { ...m, tracked: cfg.enabled && !e.attendanceExempt, sheet });
    }
    // الشهر مغطى إن وصلت بصمات أو رُفع له كشف حضور (والموظف خارج الكشف يُحسب من بصماته فقط)
    return { cfg, coverageEnd: coverageEnd ?? (covered.size ? end : null), punchCount: cov.n as number, sheetEmployees: covered.size, result };
  }

  /** الموظفون الذين شملهم كشف حضور شهري لم يُتراجع عنه، وعلاماتهم في الشهر */
  private async sheetData(org: string, month: string, employeeIds: string[]) {
    const covered = new Set<string>();
    const marks = new Map<string, Map<string, { kind: MarkKind; minutes: number }>>();
    if (!employeeIds.length) return { covered, marks };
    const imps = await this.db.getRepository(HrAttendanceImport).createQueryBuilder('i')
      .where('i.organization_id = :org AND i.kind = :k AND i.month = :month AND i.reverted_at IS NULL', { org, k: 'sheet', month }).getMany();
    const wanted = new Set(employeeIds);
    imps.forEach((i) => i.employeeIds.forEach((id) => wanted.has(id) && covered.add(id)));
    if (!covered.size) return { covered, marks };
    const rows = await this.db.getRepository(HrAttendanceMark).createQueryBuilder('m')
      .where('m.organization_id = :org AND m.mark_date BETWEEN :s AND :e AND m.superseded_by IS NULL', { org, s: `${month}-01`, e: lastDay(month) })
      .andWhere('m.employee_id IN (:...ids)', { ids: [...covered] }).getMany();
    for (const r of rows) {
      if (!marks.has(r.employeeId)) marks.set(r.employeeId, new Map());
      marks.get(r.employeeId)!.set(r.markDate, { kind: r.kind, minutes: r.minutes });
    }
    return { covered, marks };
  }

  private async monthEmployees(org: string, month: string) {
    return this.db.getRepository(HrEmployee).createQueryBuilder('e').where('e.organization_id = :org', { org })
      .andWhere('e.hire_date <= :end', { end: lastDay(month) }).andWhere('(e.termination_date IS NULL OR e.termination_date >= :start)', { start: `${month}-01` })
      .orderBy('e.employee_no').getMany();
  }

  async summary(actor: OrgUser, month: string) {
    if (!MONTH.test(month)) throw new BadRequestException('الشهر غير صحيح');
    const org = actor.organizationId;
    const employees = await this.monthEmployees(org, month);
    const units = new Map((await this.db.getRepository(HrUnit).find({ where: { organizationId: org } })).map((u) => [u.id, u.name]));
    const { cfg, coverageEnd, punchCount, sheetEmployees, result } = await this.compute(org, month, employees);
    const known = new Set((await this.db.getRepository(HrEmployee).find({ where: { organizationId: org }, select: ['employeeNo', 'attendanceCode'] })).map(codeOf));
    const unknown: { code: string; n: number }[] = await this.db.query(
      `SELECT attendance_code AS code, COUNT(*)::int AS n FROM hr_attendance_punches WHERE organization_id = $1 AND punch_date BETWEEN $2 AND $3
        GROUP BY attendance_code ORDER BY attendance_code`, [org, `${month}-01`, lastDay(month)],
    );
    return {
      month, config: cfg, coverageEnd, punchCount, sheetEmployees,
      unknownCodes: unknown.filter((u) => !known.has(u.code)),
      rows: employees.map((e) => {
        const r = result.get(e.id)!;
        return {
          employeeId: e.id, employeeNo: e.employeeNo, fullName: e.fullName, unitName: units.get(e.unitId) ?? '', code: codeOf(e), exempt: e.attendanceExempt, mobile: e.mobileAttendance, sheet: r.sheet,
          tracked: r.tracked, workDays: r.workDays, presentDays: r.presentDays, absentDays: r.absentDays, leaveDays: r.leaveDays,
          lateMinutes: r.lateMinutes, earlyMinutes: r.earlyMinutes, deductibleMinutes: r.deductibleMinutes, missingOut: r.missingOut,
        };
      }),
    };
  }

  async employeeMonth(actor: OrgUser, employeeId: string, month: string) {
    if (!MONTH.test(month)) throw new BadRequestException('الشهر غير صحيح');
    const org = actor.organizationId;
    const e = await this.db.getRepository(HrEmployee).findOne({ where: { id: employeeId, organizationId: org } });
    if (!e) throw new NotFoundException('الموظف غير موجود');
    const { cfg, coverageEnd, result } = await this.compute(org, month, [e]);
    const r = result.get(e.id)!;
    const punches = await this.db.getRepository(HrAttendancePunch).find({
      where: { organizationId: org, attendanceCode: codeOf(e), punchDate: Between(`${month}-01`, lastDay(month)) }, order: { punchDate: 'ASC', punchTime: 'ASC' },
    });
    return {
      employee: { id: e.id, fullName: e.fullName, employeeNo: e.employeeNo, code: codeOf(e), exempt: e.attendanceExempt },
      month, config: cfg, coverageEnd, tracked: r.tracked, sheet: r.sheet,
      totals: { workDays: r.workDays, presentDays: r.presentDays, absentDays: r.absentDays, leaveDays: r.leaveDays, lateMinutes: r.lateMinutes, earlyMinutes: r.earlyMinutes, deductibleMinutes: r.deductibleMinutes, missingOut: r.missingOut },
      days: r.days.map((d) => ({
        ...d, statusLabel: DAY_STATUS_AR[d.status] + (d.fromSheet ? ' (كشف الحضور)' : ''),
        punches: punches.filter((p) => p.punchDate === d.date).map((p) => ({
          id: p.id, time: p.punchTime, source: p.source, sourceLabel: SOURCE_AR[p.source], note: p.note, accuracy: p.accuracy, distance: p.distance, clientIp: p.clientIp,
        })),
      })),
    };
  }

  // ---------------- كشف الحضور الشهري (نموذج Excel من المنصة) ----------------

  /** لا يُغيَّر حضور شهر كشفُ رواتبه مرفوع للاعتماد أو معتمد */
  private async assertMonthOpen(org: string, month: string) {
    const run = await this.db.getRepository(HrPayrollRun).createQueryBuilder('r')
      .where('r.organization_id = :org AND r.month = :month AND r.status IN (:...s)', { org, month, s: ['pending', 'approved'] }).getOne();
    if (run) {
      throw new ConflictException(run.status === 'approved'
        ? `كشف رواتب ${monthName(month)} معتمد، فلا يُغيَّر حضوره`
        : `كشف رواتب ${monthName(month)} مرفوع للاعتماد. أعده للتعديل أولًا ثم غيّر الحضور`);
    }
  }

  async sheetTemplate(actor: OrgUser, month: string, unitId?: string) {
    if (!MONTH.test(month)) throw new BadRequestException('الشهر غير صحيح');
    const org = actor.organizationId;
    if (unitId) await this.core.unit(org, unitId);
    const start = `${month}-01`;
    const end = lastDay(month);
    const units = new Map((await this.db.getRepository(HrUnit).find({ where: { organizationId: org } })).map((u) => [u.id, u.name]));
    const employees = (await this.monthEmployees(org, month)).filter((e) => !e.attendanceExempt && (!unitId || e.unitId === unitId));
    if (!employees.length) throw new BadRequestException('لا يوجد موظفون خاضعون للحضور في هذا الشهر');
    const buf = await buildSheetTemplate(month, employees.map((e) => ({
      employeeNo: e.employeeNo, fullName: e.fullName, unitName: units.get(e.unitId) ?? '',
      from: e.hireDate > start ? e.hireDate : start, to: e.terminationDate && e.terminationDate < end ? e.terminationDate : end,
    })), await this.config(org));
    return { buffer: buf, fileName: `attendance-${month}.xlsx` };
  }

  /** يقرأ الكشف ويفحصه دون حفظ: الأخطاء تمنع الترحيل، والتنبيهات (أيام راحة أو خارج الخدمة) تُتجاهل */
  private async checkSheet(actor: OrgUser, file: { originalname: string; buffer: Buffer } | undefined) {
    const org = actor.organizationId;
    if (!file) throw new BadRequestException('اختر ملف كشف الحضور');
    let parsed;
    try {
      parsed = await readSheet(file.buffer);
    } catch (e) {
      throw new BadRequestException((e as Error).message);
    }
    const errors = parsed.errors.slice();
    const warnings: { row: number | null; message: string }[] = [];
    const month = parsed.month;
    if (!month) throw new BadRequestException('لم نجد خانة الشهر في الكشف (مثل 2026-11). استخدم النموذج الذي نزّلته من المنصة');
    if (month > today().slice(0, 7)) throw new BadRequestException('لا يُرفع حضور لشهر لم يبدأ بعد');
    const cfg = await this.config(org);
    const holidays = new Set(cfg.holidays.map((h) => h.date));
    const start = `${month}-01`;
    const end = lastDay(month);
    const t = today();
    const all = await this.db.getRepository(HrEmployee).find({ where: { organizationId: org } });
    const byNo = new Map(all.map((e) => [String(e.employeeNo), e]));
    const seen = new Set<string>();
    const lines: { employee: HrEmployee; marks: { date: string; kind: MarkKind; minutes: number }[] }[] = [];
    for (const r of parsed.rows) {
      const e = byNo.get(r.employeeNo);
      if (!e) {
        errors.push({ row: r.row, message: `لا يوجد موظف برقم ${r.employeeNo}` });
        continue;
      }
      if (seen.has(e.id)) {
        errors.push({ row: r.row, message: `الموظف ${e.fullName} مكرر في الكشف` });
        continue;
      }
      seen.add(e.id);
      if (e.userId && e.userId === actor.id) {
        errors.push({ row: r.row, message: `لا يُدخل حضورك أنت (${e.fullName}) في كشف ترفعه بنفسك. احذف سطرك واطلب من زميل إدخاله` });
        continue;
      }
      if (e.hireDate > end || (e.terminationDate && e.terminationDate < start)) {
        warnings.push({ row: r.row, message: `${e.fullName} ليس على رأس العمل في هذا الشهر، فتُجوهل سطره` });
        continue;
      }
      if (e.attendanceExempt) {
        warnings.push({ row: r.row, message: `${e.fullName} معفى من الحضور، فتُجوهل سطره` });
        continue;
      }
      const from = e.hireDate > start ? e.hireDate : start;
      const to = e.terminationDate && e.terminationDate < end ? e.terminationDate : end;
      const marks: typeof lines[number]['marks'] = [];
      for (const m of r.marks) {
        const day = Number(m.date.slice(8));
        if (m.date > t) errors.push({ row: r.row, message: `${e.fullName}: اليوم ${day} لم يأتِ بعد` });
        else if (m.date < from || m.date > to) warnings.push({ row: r.row, message: `${e.fullName}: اليوم ${day} خارج مدة خدمته، فتُجوهلت قيمته` });
        else if (holidays.has(m.date) || cfg.weekend.includes(new Date(`${m.date}T00:00:00Z`).getUTCDay())) warnings.push({ row: r.row, message: `${e.fullName}: اليوم ${day} راحة أو عطلة، فتُجوهلت قيمته` });
        else marks.push(m);
      }
      lines.push({ employee: e, marks });
    }
    if (!lines.length && !errors.length) errors.push({ row: null, message: 'لا يوجد في الكشف موظفون يمكن تسجيل حضورهم' });
    const count = (k: MarkKind) => lines.reduce((s, l) => s + l.marks.filter((m) => m.kind === k).length, 0);
    const summary = {
      month, monthLabel: monthName(month), employees: lines.length, absentDays: count('absent'), leaveDays: count('leave'),
      lateMinutes: lines.reduce((s, l) => s + l.marks.reduce((x, m) => x + m.minutes, 0), 0),
      errors: errors.slice(0, 200), errorCount: errors.length, warnings: warnings.slice(0, 200), warningCount: warnings.length,
      rows: lines.slice(0, 500).map((l) => ({
        employeeNo: l.employee.employeeNo, fullName: l.employee.fullName,
        absent: l.marks.filter((m) => m.kind === 'absent').length, leave: l.marks.filter((m) => m.kind === 'leave').length,
        lateMinutes: l.marks.reduce((x, m) => x + m.minutes, 0),
        marks: l.marks.map((m) => ({ day: Number(m.date.slice(8)), kind: m.kind, label: m.kind === 'late' ? `${m.minutes} د` : MARK_AR[m.kind] })),
      })),
      canCommit: errors.length === 0,
    };
    return { summary, lines, month };
  }

  async sheetPreview(actor: OrgUser, file: { originalname: string; buffer: Buffer } | undefined) {
    const { summary, month } = await this.checkSheet(actor, file);
    let locked: string | null = null;
    try {
      await this.assertMonthOpen(actor.organizationId, month);
    } catch (e) {
      locked = (e as Error).message;
    }
    return { ...summary, locked, canCommit: summary.canCommit && !locked };
  }

  /** ترحيل الكشف بخطوة واحدة: يستبدل علامات موظفيه في الشهر، ويُحفظ في سجل الملفات ويمكن التراجع عنه */
  async sheetCommit(actor: OrgUser, file: { originalname: string; buffer: Buffer } | undefined) {
    const org = actor.organizationId;
    const { summary, lines, month } = await this.checkSheet(actor, file);
    if (!summary.canCommit) {
      throw new BadRequestException(`في الكشف ${summary.errorCount} خطأ. صححها ثم ارفعه مرة أخرى: ${summary.errors.slice(0, 3).map((e) => (e.row ? `السطر ${e.row}: ` : '') + e.message).join('، ')}`);
    }
    const name = Buffer.from(file!.originalname, 'latin1').toString('utf8');
    const id = await this.db.transaction(async (em) => {
      // قفل حضور الشهر (كشفان متزامنان) وكشف رواتبه إن وُجد حتى لا يُرفع للاعتماد أثناء الترحيل
      await em.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`hr-att:${org}:${month}`]);
      await em.query(`SELECT id FROM hr_payroll_runs WHERE organization_id = $1 AND month = $2 FOR UPDATE`, [org, month]);
      await this.assertMonthOpen(org, month);
      const ids = lines.map((l) => l.employee.id);
      const imp = await em.getRepository(HrAttendanceImport).save(em.getRepository(HrAttendanceImport).create({
        organizationId: org, fileName: name.slice(0, 250), format: 'excel', kind: 'sheet', month, employeeIds: ids,
        rows: lines.length, added: lines.reduce((s, l) => s + l.marks.length, 0), duplicates: 0, invalid: summary.warningCount, unknownCodes: [],
        dateFrom: `${month}-01`, dateTo: lastDay(month), createdByName: actor.fullName, createdById: actor.id,
      }));
      // العلامات السابقة لا تُحذف: تُعلَّم بأن هذا الكشف حل محلها، فيعيدها التراجع عنه
      await em.createQueryBuilder().update(HrAttendanceMark).set({ supersededBy: imp.id })
        .where('organization_id = :org AND mark_date BETWEEN :s AND :e AND superseded_by IS NULL', { org, s: `${month}-01`, e: lastDay(month) })
        .andWhere('employee_id IN (:...ids)', { ids }).execute();
      const values = lines.flatMap((l) => l.marks.map((m) => ({ organizationId: org, employeeId: l.employee.id, markDate: m.date, kind: m.kind, minutes: m.minutes, importId: imp.id })));
      for (let i = 0; i < values.length; i += 500) await em.getRepository(HrAttendanceMark).insert(values.slice(i, i + 500));
      return imp.id;
    });
    return this.db.getRepository(HrAttendanceImport).findOneByOrFail({ id, organizationId: org });
  }

  /**
   * التراجع عن آخر كشف حضور للشهر: تُحذف علاماته وتعود علامات الكشوف التي حل محلها كما كانت،
   * ويخرج موظفوه من تغطيته ما لم يشملهم كشف آخر. التراجع بالترتيب من الأحدث فالأقدم.
   */
  async revertImport(actor: OrgUser, id: string) {
    const org = actor.organizationId;
    await this.db.transaction(async (em) => {
      const imp = await em.getRepository(HrAttendanceImport).createQueryBuilder('i').setLock('pessimistic_write')
        .where('i.id = :id AND i.organization_id = :org', { id, org }).getOne();
      if (!imp) throw new NotFoundException('الملف غير موجود');
      if (imp.kind !== 'sheet' || !imp.month) throw new ConflictException('التراجع متاح لكشوف الحضور الشهرية فقط. البصمات تبقى كما وصلت');
      if (imp.revertedAt) throw new ConflictException('سبق التراجع عن هذا الكشف');
      await em.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`hr-att:${org}:${imp.month}`]);
      await em.query(`SELECT id FROM hr_payroll_runs WHERE organization_id = $1 AND month = $2 FOR UPDATE`, [org, imp.month]);
      await this.assertMonthOpen(org, imp.month);
      const newer = await em.getRepository(HrAttendanceImport).createQueryBuilder('i')
        .where('i.organization_id = :org AND i.kind = :k AND i.month = :m AND i.reverted_at IS NULL AND i.created_at > :at AND i.id <> :id', { org, k: 'sheet', m: imp.month, at: imp.createdAt, id })
        .getCount();
      if (newer) throw new ConflictException('يوجد كشف أحدث لهذا الشهر. تراجع عنه أولًا');
      await em.createQueryBuilder().delete().from(HrAttendanceMark).where('organization_id = :org AND import_id = :id', { org, id }).execute();
      await em.createQueryBuilder().update(HrAttendanceMark).set({ supersededBy: null }).where('organization_id = :org AND superseded_by = :id', { org, id }).execute();
      await em.getRepository(HrAttendanceImport).update({ id, organizationId: org }, { revertedAt: new Date(), revertedByName: actor.fullName, revertedById: actor.id });
    });
    return this.db.getRepository(HrAttendanceImport).findOneByOrFail({ id, organizationId: org });
  }

  // ---------------- التسجيل من الجوال ----------------

  private mobileState(cfg: AttendanceConfig, e: HrEmployee): string | null {
    if (e.status !== 'active') return 'خدمتك منتهية';
    if (!cfg.enabled) return 'الحضور غير مفعّل في المنشأة';
    if (e.attendanceExempt) return 'أنت معفى من تسجيل الحضور';
    if (!e.mobileAttendance) return 'التسجيل من الجوال غير مفعّل لك. راجع شؤون الموظفين';
    if (!cfg.sites.length) return 'لم تُحدَّد مواقع العمل بعد. راجع شؤون الموظفين';
    return null;
  }

  /** حالة الموظف اليوم: هل يحق له التسجيل من الجوال، وبصماته اليوم */
  async myAttendance(org: string, e: HrEmployee) {
    const cfg = await this.config(org);
    const t = today();
    const punches = await this.db.getRepository(HrAttendancePunch).find({
      where: { organizationId: org, attendanceCode: codeOf(e), punchDate: t }, order: { punchTime: 'ASC' },
    });
    const blocked = this.mobileState(cfg, e);
    return {
      date: t, allowed: !blocked, reason: blocked, workStart: cfg.workStart, workEnd: cfg.workEnd,
      sites: cfg.sites.map((x) => ({ name: x.name, radius: x.radius })), maxAccuracy: MOBILE_MAX_ACCURACY,
      punches: punches.map((p) => ({ time: p.punchTime, source: p.source, sourceLabel: SOURCE_AR[p.source] })),
      next: punches.length ? 'out' : 'in',
    };
  }

  /** بصمة من الجوال: تُقبل فقط داخل نطاق أحد مواقع العمل وبدقة موقع كافية، وبوقت الخادم لا وقت الجوال */
  async mobilePunch(org: string, e: HrEmployee, dto: MobilePunchDto, client: { ip?: string | null; userAgent?: string | null } = {}) {
    const cfg = await this.config(org);
    const blocked = this.mobileState(cfg, e);
    if (blocked) throw new ForbiddenException(blocked);
    const accuracy = Math.round(dto.accuracy);
    if (accuracy > MOBILE_MAX_ACCURACY) {
      throw new BadRequestException(`دقة تحديد موقعك ضعيفة (${accuracy} متر). فعّل «الموقع الدقيق» في الجوال واقترب من نافذة أو مكان مفتوح ثم حاول مرة أخرى`);
    }
    const here = { lat: dto.latitude, lng: dto.longitude };
    const nearest = cfg.sites.map((x) => ({ site: x, d: distanceMeters(here, x) })).sort((a, b) => a.d - b.d)[0];
    if (nearest.d > nearest.site.radius) {
      throw new BadRequestException(`أنت خارج نطاق مواقع العمل. أقرب موقع «${nearest.site.name}» يبعد عنك ${nearest.d} متر، والمسموح ${nearest.site.radius} متر`);
    }
    const date = today();
    const time = nowTime();
    const code = codeOf(e);
    const lastRow = await this.db.getRepository(HrAttendancePunch).findOne({
      where: { organizationId: org, attendanceCode: code, punchDate: date }, order: { punchTime: 'DESC' },
    });
    const mins = (x: string) => Number(x.slice(0, 2)) * 60 + Number(x.slice(3, 5));
    if (lastRow && mins(time) - mins(lastRow.punchTime) < MOBILE_GAP_MINUTES) throw new ConflictException('سُجلت بصمتك قبل قليل');
    const res = await this.db.getRepository(HrAttendancePunch).createQueryBuilder().insert().values({
      organizationId: org, employeeId: e.id, attendanceCode: code, punchDate: date, punchTime: time, source: 'mobile',
      note: `من الجوال: ${nearest.site.name}`, createdByName: e.fullName,
      latitude: dto.latitude.toFixed(6), longitude: dto.longitude.toFixed(6), accuracy, distance: nearest.d,
      clientIp: client.ip?.slice(0, 64) ?? null, userAgent: client.userAgent?.slice(0, 300) ?? null,
    }).orIgnore().returning('id').execute();
    if (!(res.raw as unknown[]).length) throw new ConflictException('سُجلت بصمتك قبل قليل');
    return this.myAttendance(org, e);
  }
}
