import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Between, DataSource } from 'typeorm';
import { OrgUser } from '../../core/auth/decorators';
import { attendanceConfig, attendanceMonth, DAY_STATUS_AR, MonthResult } from './attendance-calc';
import { extractPunches, parseAttlog, ParsedPunch, readText, readXlsx } from './attendance-files';
import {
  AttendanceConfig, HrAttendanceDevice, HrAttendanceImport, HrAttendancePunch, HrEmployee, HrLeaveRequest, HrSettings, HrUnit, PunchSource,
} from './entities/hr.entity';
import { AttendanceConfigDto, DeviceDto, ManualPunchDto } from './hr.dto';
import { HrCore, today } from './hr-core.service';
import { lastDay, MONTH } from './people.service';

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
export const codeOf = (e: Pick<HrEmployee, 'attendanceCode' | 'employeeNo'>) => e.attendanceCode || String(e.employeeNo);
const SOURCE_AR: Record<PunchSource, string> = { device: 'جهاز البصمة', excel: 'ملف Excel', text: 'ملف نصي', manual: 'إدخال يدوي' };

export interface EmployeeAttendance extends MonthResult { tracked: boolean }

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
    const config: AttendanceConfig = { enabled: dto.enabled, workStart: dto.workStart, workEnd: dto.workEnd, weekend, holidays };
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
    const result = new Map<string, EmployeeAttendance>();
    for (const e of employees) {
      const code = codeOf(e);
      const punches = new Map<string, string[]>();
      rows.filter((r) => r.code === code).forEach((r) => punches.set(r.d, [...(punches.get(r.d) ?? []), r.t]));
      const m = attendanceMonth({
        month, from: e.hireDate > start ? e.hireDate : start, to: e.terminationDate && e.terminationDate < end ? e.terminationDate : end,
        coverageEnd, cfg, graceMinutes: policy.payroll.lateGraceMinutes, leaves: leaves.filter((l) => l.employeeId === e.id), punches,
      });
      result.set(e.id, { ...m, tracked: cfg.enabled && !e.attendanceExempt });
    }
    return { cfg, coverageEnd, punchCount: cov.n as number, result };
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
    const { cfg, coverageEnd, punchCount, result } = await this.compute(org, month, employees);
    const known = new Set((await this.db.getRepository(HrEmployee).find({ where: { organizationId: org }, select: ['employeeNo', 'attendanceCode'] })).map(codeOf));
    const unknown: { code: string; n: number }[] = await this.db.query(
      `SELECT attendance_code AS code, COUNT(*)::int AS n FROM hr_attendance_punches WHERE organization_id = $1 AND punch_date BETWEEN $2 AND $3
        GROUP BY attendance_code ORDER BY attendance_code`, [org, `${month}-01`, lastDay(month)],
    );
    return {
      month, config: cfg, coverageEnd, punchCount,
      unknownCodes: unknown.filter((u) => !known.has(u.code)),
      rows: employees.map((e) => {
        const r = result.get(e.id)!;
        return {
          employeeId: e.id, employeeNo: e.employeeNo, fullName: e.fullName, unitName: units.get(e.unitId) ?? '', code: codeOf(e), exempt: e.attendanceExempt,
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
      month, config: cfg, coverageEnd, tracked: r.tracked,
      totals: { workDays: r.workDays, presentDays: r.presentDays, absentDays: r.absentDays, leaveDays: r.leaveDays, lateMinutes: r.lateMinutes, earlyMinutes: r.earlyMinutes, deductibleMinutes: r.deductibleMinutes, missingOut: r.missingOut },
      days: r.days.map((d) => ({
        ...d, statusLabel: DAY_STATUS_AR[d.status],
        punches: punches.filter((p) => p.punchDate === d.date).map((p) => ({ id: p.id, time: p.punchTime, source: p.source, sourceLabel: SOURCE_AR[p.source], note: p.note })),
      })),
    };
  }
}
