import { Test } from '@nestjs/testing';
import { NestExpressApplication } from '@nestjs/platform-express';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { deflateRawSync } from 'zlib';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/main';
import { attendanceMonth, DEFAULT_ATTENDANCE } from '../src/modules/hr/attendance-calc';
import { extractPunches, parseCell, readText, readXlsx } from '../src/modules/hr/attendance-files';
import { allocateLine, computeLine } from '../src/modules/hr/payroll.service';
import { defaultPolicy } from '../src/modules/hr/hr-policy';
import type { RunLine } from '../src/modules/hr/entities/hr.entity';

/**
 * مسير الرواتب والحضور: قراءة ملفات البصمة (Excel والنصية وإرسال الجهاز)، احتساب الغياب والتأخير،
 * بنود الراتب وحساباتها، كشف الرواتب ومراحل اعتماده، قيد الاستحقاق المحمّل على الحساب التحليلي للوحدة، وسندات الصرف.
 */
const DB = process.env.TEST_DATABASE_URL ?? 'postgres://erp:erp@localhost:5432/charity_erp_test';

/** ملف xlsx صغير للاختبار (ورقة واحدة ونصوص مشتركة) */
function makeXlsx(rows: (string | number)[][]) {
  const strings: string[] = [];
  const sheet = rows.map((r, i) => `<row r="${i + 1}">${r.map((v, j) => {
    const ref = `${String.fromCharCode(65 + j)}${i + 1}`;
    if (typeof v === 'number') return `<c r="${ref}"><v>${v}</v></c>`;
    strings.push(v);
    return `<c r="${ref}" t="s"><v>${strings.length - 1}</v></c>`;
  }).join('')}</row>`).join('');
  const files: [string, string][] = [
    ['xl/worksheets/sheet1.xml', `<?xml version="1.0"?><worksheet><sheetData>${sheet}</sheetData></worksheet>`],
    ['xl/sharedStrings.xml', `<?xml version="1.0"?><sst>${strings.map((s) => `<si><t>${s.replace(/&/g, '&amp;')}</t></si>`).join('')}</sst>`],
  ];
  const locals: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const [name, content] of files) {
    const data = deflateRawSync(Buffer.from(content));
    const n = Buffer.from(name);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0);
    lh.writeUInt16LE(8, 8);
    lh.writeUInt32LE(data.length, 18);
    lh.writeUInt32LE(content.length, 22);
    lh.writeUInt16LE(n.length, 26);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0);
    ch.writeUInt16LE(8, 10);
    ch.writeUInt32LE(data.length, 20);
    ch.writeUInt32LE(content.length, 24);
    ch.writeUInt16LE(n.length, 28);
    ch.writeUInt32LE(offset, 42);
    locals.push(lh, n, data);
    central.push(ch, n);
    offset += 30 + n.length + data.length;
  }
  const cd = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}

describe('attendance files and calculations', () => {
  it('reads device text, CSV with headers, and Excel files', () => {
    const attlog = extractPunches(readText(Buffer.from('    7\t2026-10-01 07:58:12\t1\t0\t1\t0\n    7\t2026-10-01 15:02:40\t1\t1\t1\t0\nbad line\n')));
    expect(attlog.punches).toEqual([{ code: '7', date: '2026-10-01', time: '07:58:12' }, { code: '7', date: '2026-10-01', time: '15:02:40' }]);
    expect(attlog.invalid).toBe(1);
    const csv = extractPunches(readText(Buffer.from('﻿القسم,الاسم,No.,Date/Time\nالبرامج,سارة,12,05/10/2026 08:20 AM\nالبرامج,سارة,12,05/10/2026 03:10 PM\n')));
    expect(csv.punches).toEqual([{ code: '12', date: '2026-10-05', time: '08:20:00' }, { code: '12', date: '2026-10-05', time: '15:10:00' }]);
    // Excel: التاريخ رقم تسلسلي والوقت كسر من اليوم
    const xlsx = readXlsx(makeXlsx([['رقم الموظف', 'التاريخ', 'الوقت'], ['15', 46296, 0.3125], ['15', '2026-10-01', '14:45']]));
    const x = extractPunches(xlsx);
    expect(x.punches).toEqual([{ code: '15', date: '2026-10-01', time: '07:30:00' }, { code: '15', date: '2026-10-01', time: '14:45:00' }]);
    expect(parseCell('2026-10-01 7:05 م')).toEqual({ date: '2026-10-01', time: '19:05:00' });
  });

  it('counts absence and lateness on work days only, after the grace period', () => {
    const punches = new Map<string, string[]>([
      ['2026-10-01', ['08:05:00', '15:00:00']], // ضمن السماح
      ['2026-10-04', ['08:40:00', '15:00:00']], // تأخير 40 دقيقة
      ['2026-10-05', ['08:00:00']], // انصراف ناقص
      ['2026-10-06', ['08:00:00', '14:30:00']], // خروج مبكر 30 دقيقة
    ]);
    const m = attendanceMonth({
      month: '2026-10', from: '2026-10-01', to: '2026-10-31', coverageEnd: '2026-10-08', graceMinutes: 15,
      cfg: { ...DEFAULT_ATTENDANCE, enabled: true, holidays: [{ date: '2026-10-07', name: 'عطلة' }] },
      leaves: [{ startDate: '2026-10-08', endDate: '2026-10-08' }], punches,
    });
    const status = (d: string) => m.days.find((x) => x.date === d)!.status;
    expect(status('2026-10-02')).toBe('weekend'); // الجمعة
    expect(status('2026-10-07')).toBe('holiday');
    expect(status('2026-10-08')).toBe('leave');
    expect(status('2026-10-09')).toBe('weekend');
    expect(status('2026-10-11')).toBe('no_data');
    expect(m.absentDays).toBe(0);
    expect(m.presentDays).toBe(4);
    expect(m.deductibleMinutes).toBe(70);
    expect(m.missingOut).toBe(1);
    const gap = attendanceMonth({
      month: '2026-10', from: '2026-10-01', to: '2026-10-31', coverageEnd: '2026-10-31', graceMinutes: 15,
      cfg: { ...DEFAULT_ATTENDANCE, enabled: true }, leaves: [], punches,
    });
    expect(gap.absentDays).toBe(21 - 4);
  });

  it('allocates deductions from the basic salary first', () => {
    const p = defaultPolicy();
    const base: RunLine = {
      employeeId: 'e', employeeNo: 1, fullName: 'x', isSaudi: true, unitId: 'u', unitName: 'u', jobTitle: 'j', iban: null,
      items: [{ code: 'basic', name: 'أساسي', full: 8000, earned: 8000 }, { code: 'housing', name: 'سكن', full: 2000, earned: 2000 }, { code: 'transport', name: 'نقل', full: 800, earned: 800 }],
      gross: 10800, workedDays: 31, ratio: 1, dailyWage: 360, unpaidDays: 0, unpaidDeduction: 0,
      attendance: { tracked: true, absentDays: 2, lateMinutes: 40, missingOut: 0, overridden: false }, absenceDeduction: 0, lateDeduction: 0,
      additions: [{ code: 'housing', amount: 100, note: null }], otherDeduction: 200, otherDeductionNote: 'سلفة',
      earned: 0, gosiEmployee: 975, gosiEmployer: 1175, totalDeductions: 0, net: 0, employerCost: 0,
    };
    const l = computeLine(base, p);
    expect(l.absenceDeduction).toBe(720);
    expect(l.lateDeduction).toBe(30);
    expect(l.earned).toBe(10900);
    expect(l.net).toBe(10900 - 720 - 30 - 975 - 200);
    expect(l.employerCost).toBe(10900 - 750 + 1175);
    const a = allocateLine(l);
    expect(a.find((x) => x.code === 'basic')).toEqual({ code: 'basic', expense: 7250, payable: 6075 });
    expect(a.find((x) => x.code === 'housing')).toEqual({ code: 'housing', expense: 2100, payable: 2100 });
    expect(a.reduce((s, x) => s + x.payable, 0)).toBeCloseTo(l.net, 2);
  });
});

describe('Payroll', () => {
  let app: NestExpressApplication;
  let http: ReturnType<typeof request>;
  let admin: string;
  let clerk: string;
  let uploadDir: string;
  const as = (t: string) => ({ Authorization: `Bearer ${t}` });
  const login = async (login: string, password: string, organization?: string) =>
    (await http.post('/api/auth/login').send({ login, password, organization }).expect(200)).body.accessToken as string;
  const H = '/api/hr';
  const A = '/api/accounting';
  const ids: Record<string, string> = {};
  const now = new Date(Date.now() + 3 * 3600000);
  const prev = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  const month = prev.toISOString().slice(0, 7);
  const year = prev.getUTCFullYear();
  const lastDay = new Date(Date.UTC(year, prev.getUTCMonth() + 1, 0)).toISOString().slice(0, 10);
  const days = Array.from({ length: Number(lastDay.slice(8)) }, (_, i) => `${month}-${String(i + 1).padStart(2, '0')}`);
  const workDays = days.filter((d) => ![5, 6].includes(new Date(`${d}T00:00:00Z`).getUTCDay()));
  const acc: Record<string, string> = {};

  beforeAll(async () => {
    uploadDir = mkdtempSync(join(tmpdir(), 'sanabel-uploads-'));
    Object.assign(process.env, {
      DATABASE_URL: DB, JWT_SECRET: 'test-secret', UPLOAD_DIR: uploadDir,
      PLATFORM_ADMIN_EMAIL: 'platform@test.org', PLATFORM_ADMIN_PASSWORD: 'Platform123',
    });
    const reset = new DataSource({ type: 'postgres', url: DB });
    await reset.initialize();
    await reset.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
    await reset.destroy();
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(moduleRef.createNestApplication<NestExpressApplication>());
    await app.init();
    http = request(app.getHttpServer());
    const platform = await login('admin', 'Platform123');
    await http.post('/api/platform/organizations').set(as(platform)).send({
      name: 'جمعية البر', slug: 'albir', adminFullName: 'مدير النظام', adminEmail: 'albir@test.org', adminPassword: 'Admin12345',
    }).expect(201);
    admin = await login('albir@test.org', 'Admin12345', 'albir');
    const role = await http.post('/api/roles').set(as(admin)).send({
      name: 'محاسب الرواتب', permissions: ['hr.dashboard.read', 'hr.salaries.read', 'hr.payroll.manage', 'hr.attendance.manage'],
    }).expect(201);
    await http.post('/api/users').set(as(admin)).send({ fullName: 'محاسب الرواتب', email: 'clerk@test.org', password: 'Clerk12345', roleIds: [role.body.id] }).expect(201);
    clerk = await login('clerk@test.org', 'Clerk12345', 'albir');

    // النظام المالي: الدليل والسنة المالية وبنكان
    await http.post(`${A}/chart/install`).set(as(admin)).expect(201);
    const accounts = (await http.get(`${A}/accounts`).set(as(admin)).expect(200)).body.accounts as { id: string; code: string }[];
    accounts.forEach((a) => (acc[a.code] = a.id));
    const analytic = (await http.get(`${A}/analytic`).set(as(admin)).expect(200)).body.accounts as { id: string; code: string }[];
    analytic.forEach((a) => (acc[a.code] = a.id));
    await http.post(`${A}/setup`).set(as(admin)).send({
      fiscalYear: year, startDate: `${year}-01-01`, endDate: `${year}-12-31`, isFirstYear: true, firstYearStart: `${year}-01-01`, firstYearEnd: `${year}-12-31`,
    }).expect(201);
    ids.bank1 = (await http.post(`${A}/cash-accounts`).set(as(admin)).send({ kind: 'bank', name: 'الراجحي - الرواتب', bankName: 'مصرف الراجحي', accountNumber: '608010167519', glAccountId: acc['1110100201'] }).expect(201)).body.id;
    ids.bank2 = (await http.post(`${A}/cash-accounts`).set(as(admin)).send({ kind: 'bank', name: 'الرياض - البدلات', bankName: 'بنك الرياض', accountNumber: '2110045570940', glAccountId: acc['1110100101'] }).expect(201)).body.id;
  });

  afterAll(async () => {
    await app.get(DataSource).destroy();
    await app.close();
    rmSync(uploadDir, { recursive: true, force: true });
  });

  it('units carry the analytic account that their salaries are charged to', async () => {
    ids.top = (await http.post(`${H}/units`).set(as(admin)).send({ name: 'الإدارة العامة', level: 0, analyticAccountId: acc.CC01 }).expect(201)).body.id;
    ids.programs = (await http.post(`${H}/units`).set(as(admin)).send({ name: 'إدارة البرامج', level: 1, parentId: ids.top, analyticAccountId: acc.CC02 }).expect(201)).body.id;
    // وحدة بدون حساب تحليلي تأخذ حساب الوحدة الأعلى
    ids.finance = (await http.post(`${H}/units`).set(as(admin)).send({ name: 'الشؤون المالية', level: 1, parentId: ids.top }).expect(201)).body.id;
    await http.post(`${H}/units`).set(as(admin)).send({ name: 'خطأ', level: 1, parentId: ids.top, analyticAccountId: acc.CC }).expect(400);
  });

  it('salary items are defined once, each with its own payable account and bank', async () => {
    const list = (await http.get(`${H}/allowance-types`).set(as(admin)).expect(200)).body as { id: string; code: string; isSystem: boolean }[];
    expect(list.map((x) => x.code)).toEqual(['basic', 'housing', 'transport']);
    const byCode = Object.fromEntries(list.map((x) => [x.code, x.id]));
    const save = (code: string, name: string, payable: string, bank: string, extra = {}) =>
      http.put(`${H}/allowance-types/${byCode[code]}`).set(as(admin)).send({
        code, name, defaultKind: 'percent', defaultValue: 0, payableAccountId: acc[payable], cashAccountId: bank, ...extra,
      });
    await save('basic', 'الراتب الأساسي', '2140100101', ids.bank1).expect(200);
    await save('housing', 'بدل السكن', '2140100102', ids.bank1, { defaultValue: 25 }).expect(200);
    await save('transport', 'بدل النقل', '2140100103', ids.bank2, { defaultValue: 10 }).expect(200);
    await save('transport', 'بدل النقل', '4110100301', ids.bank2).expect(400);
    // حساب المصروف لم يعد على البند (انتقل لفئة الوظيفة)
    await save('transport', 'بدل النقل', '2140100103', ids.bank2, { expenseAccountId: acc['4110100301'] }).expect(400);
    await http.post(`${H}/allowance-types`).set(as(admin)).send({ code: 'phone', name: 'بدل الاتصال', defaultKind: 'fixed', defaultValue: 300 }).expect(201);
    await http.post(`${H}/allowance-types`).set(as(clerk)).send({ code: 'food', name: 'بدل إعاشة', defaultKind: 'fixed', defaultValue: 0 }).expect(403);
    // البدل غير المعرّف لا يُقبل في المرتبة
    await http.post(`${H}/grades`).set(as(admin)).send({ code: 'G1', name: 'أخصائي', minSalary: 5000, maxSalary: 12000, steps: 3, stepIncrement: 5, allowances: [{ code: 'other', name: 'أخرى', kind: 'fixed', value: 1 }] }).expect(400);
  });

  it('expense accounts are set per job through expense profiles (administrative or activities)', async () => {
    const list = (await http.get(`${H}/expense-profiles`).set(as(admin)).expect(200)).body as { id: string; name: string; isDefault: boolean }[];
    expect(list).toHaveLength(1);
    expect(list[0].isDefault).toBe(true);
    const accounts = (m: Record<string, string>) => Object.entries(m).map(([code, a]) => ({ code, accountId: acc[a] }));
    await http.put(`${H}/expense-profiles/${list[0].id}`).set(as(admin)).send({
      name: 'المصروفات الإدارية', accounts: accounts({ basic: '4110100101', housing: '4110100201', transport: '4110100301', phone: '4110100401', gosi: '4110100801' }),
    }).expect(200);
    const program = { name: 'البرامج والأنشطة', accounts: accounts({ basic: '4410100101', housing: '4410100101', transport: '4410100101', gosi: '4410100101' }) };
    await http.post(`${H}/expense-profiles`).set(as(clerk)).send(program).expect(403);
    await http.post(`${H}/expense-profiles`).set(as(admin)).send({ ...program, accounts: accounts({ basic: '2140100101' }) }).expect(400);
    await http.post(`${H}/expense-profiles`).set(as(admin)).send({ ...program, accounts: [{ code: 'nothing', accountId: acc['4410100101'] }] }).expect(400);
    const after = (await http.post(`${H}/expense-profiles`).set(as(admin)).send(program).expect(201)).body as { id: string; name: string }[];
    ids.programProfile = after.find((p) => p.name === program.name)!.id;
    await http.post(`${H}/expense-profiles`).set(as(admin)).send(program).expect(409);
    await http.delete(`${H}/expense-profiles/${list[0].id}`).set(as(admin)).expect(400);
  });

  it('attendance from uploaded files and the fingerprint device', async () => {
    const job = { title: 'أخصائي', unitId: ids.programs, headcount: 3, purpose: 'عمل', responsibilities: ['مهمة'], experienceYears: 0, competencies: [], kpis: [] };
    ids.job = (await http.post(`${H}/jobs`).set(as(admin)).send({ ...job, expenseProfileId: ids.programProfile }).expect(201)).body.id;
    const jobs = (await http.get(`${H}/jobs`).set(as(admin)).expect(200)).body as { id: string; expenseProfileName: string }[];
    expect(jobs.find((j) => j.id === ids.job)!.expenseProfileName).toBe('البرامج والأنشطة');
    await http.delete(`${H}/expense-profiles/${ids.programProfile}`).set(as(admin)).expect(409);
    ids.jobFin = (await http.post(`${H}/jobs`).set(as(admin)).send({ ...job, title: 'محاسب', unitId: ids.finance }).expect(201)).body.id;
    const hire = `${year - 1}-01-01`;
    const emp = {
      fullName: 'سارة أحمد العتيبي', nationalId: '1012345678', nationality: 'سعودية', isSaudi: true, gender: 'female', jobId: ids.job,
      hireDate: hire, contractType: 'indefinite', contractStart: hire, qiwaStatus: 'documented', basicSalary: 8000,
      allowances: [{ code: 'housing', name: 'x', amount: 2000 }, { code: 'transport', name: 'x', amount: 800 }],
      gosiFirstRegistration: '2020-01-01', iban: 'SA0380000000608010167519', attendanceCode: '101',
    };
    ids.sara = (await http.post(`${H}/employees`).set(as(admin)).send(emp).expect(201)).body.id;
    ids.ali = (await http.post(`${H}/employees`).set(as(admin)).send({
      ...emp, fullName: 'علي محمد الشهري', nationalId: '2012345678', isSaudi: false, nationality: 'مصري', gender: 'male', jobId: ids.jobFin,
      basicSalary: 6000, allowances: [{ code: 'housing', name: 'x', amount: 1500 }], attendanceCode: null, attendanceExempt: true, iban: null,
    }).expect(201)).body.id;
    await http.post(`${H}/employees`).set(as(admin)).send({ ...emp, fullName: 'رقم بصمة مكرر', nationalId: '1099999999', attendanceCode: '101' }).expect(409);

    await http.put(`${H}/attendance/settings`).set(as(admin)).send({ enabled: true, workStart: '08:00', workEnd: '15:00', weekend: [5, 6], holidays: [] }).expect(200);
    // كل أيام العمل عدا يومين غياب، ويوم تأخير 40 دقيقة
    const absent = [workDays[2], workDays[5]];
    const lines = ['No.,Name,Date/Time'];
    workDays.filter((d) => !absent.includes(d)).forEach((d, i) => {
      const [y, m, dd] = d.split('-');
      lines.push(`101,سارة,${dd}/${m}/${y} ${i === 0 ? '08:40' : '07:55'}`, `101,سارة,${dd}/${m}/${y} 03:05 PM`);
    });
    lines.push(`999,مجهول,01/${month.slice(5)}/${year} 08:00`);
    const up = await http.post(`${H}/attendance/import`).set(as(clerk)).attach('file', Buffer.from(lines.join('\n')), 'attendance.csv').expect(201);
    expect(up.body.added).toBe((workDays.length - 2) * 2 + 1);
    expect(up.body.unknownCodes).toEqual(['999']);
    const again = await http.post(`${H}/attendance/import`).set(as(clerk)).attach('file', Buffer.from(lines.join('\n')), 'attendance.csv').expect(201);
    expect(again.body.added).toBe(0);
    expect(again.body.duplicates).toBe(up.body.added);

    // جهاز البصمة يرسل مباشرة برقمه التسلسلي
    await http.post(`${H}/attendance/devices`).set(as(admin)).send({ name: 'جهاز المدخل الرئيسي', brand: 'ZKTeco', serialNumber: 'cqz7240001' }).expect(201);
    const hs = await http.get('/api/hr/iclock/cdata?SN=CQZ7240001&options=all').expect(200);
    expect(hs.text).toContain('GET OPTION FROM: CQZ7240001');
    expect((await http.get('/api/hr/iclock/cdata?SN=UNKNOWN1').expect(200)).text).toBe('UNKNOWN DEVICE');
    const push = await http.post('/api/hr/iclock/cdata?SN=CQZ7240001&table=ATTLOG').set('Content-Type', 'text/plain')
      .send(`101\t${lastDay} 16:30:00\t0\t1\t0\t0\n`).expect(200);
    expect(push.text).toBe('OK: 1');
    const settings = (await http.get(`${H}/attendance/settings`).set(as(admin)).expect(200)).body;
    expect(settings.devices[0].punchCount).toBe(1);

    const s = (await http.get(`${H}/attendance?month=${month}`).set(as(admin)).expect(200)).body;
    const sara = s.rows.find((r: { employeeId: string }) => r.employeeId === ids.sara);
    expect(sara.absentDays).toBe(2);
    expect(sara.deductibleMinutes).toBe(40);
    expect(s.rows.find((r: { employeeId: string }) => r.employeeId === ids.ali).tracked).toBe(false);
    expect(s.unknownCodes.map((u: { code: string }) => u.code)).toEqual(['999']);

    const manual = await http.post(`${H}/attendance/punches`).set(as(clerk)).send({ employeeId: ids.sara, date: absent[0], time: '08:00', note: 'نسي البصمة بعذر' }).expect(201);
    expect(manual.body.totals.absentDays).toBe(1);
    const p = manual.body.days.find((d: { date: string }) => d.date === absent[0]).punches[0];
    await http.delete(`${H}/attendance/punches/${p.id}`).set(as(clerk)).expect(200);
  });

  it('payroll sheet with attendance deductions, adjustments and approval stages', async () => {
    await http.post(`${H}/payroll-runs`).set(as(clerk)).send({ month: '2099-01' }).expect(400);
    const run = (await http.post(`${H}/payroll-runs`).set(as(clerk)).send({ month }).expect(201)).body;
    ids.run = run.id;
    await http.post(`${H}/payroll-runs`).set(as(clerk)).send({ month }).expect(409);
    const sara = run.lines.find((l: { employeeId: string }) => l.employeeId === ids.sara);
    expect(sara.attendance).toMatchObject({ tracked: true, absentDays: 2, lateMinutes: 40 });
    expect(sara.absenceDeduction).toBe(720);
    expect(sara.lateDeduction).toBe(30);
    expect(sara.gosiEmployee).toBe(975);
    expect(sara.net).toBe(10800 - 750 - 975);
    const ali = run.lines.find((l: { employeeId: string }) => l.employeeId === ids.ali);
    expect(ali.attendance.tracked).toBe(false);
    expect(ali.gosiEmployee).toBe(0);
    expect(run.planError).toContain('حساب الرواتب المستحقة');

    // تعديل يدوي: غياب يوم واحد بعذر، وإضافة على بدل السكن، وسلفة (السبب إلزامي)
    const edit = { overrideAttendance: true, absentDays: 1, lateMinutes: 40, additions: [{ code: 'housing', amount: 500, note: 'فرق بدل' }], otherDeduction: 300, otherDeductionNote: 'قسط سلفة' };
    await http.put(`${H}/payroll-runs/${ids.run}/lines/${ids.sara}`).set(as(clerk)).send(edit).expect(400);
    await http.put(`${H}/payroll-runs/${ids.run}/lines/${ids.sara}`).set(as(clerk)).send({ ...edit, reason: '   ' }).expect(400);
    const upd = await http.put(`${H}/payroll-runs/${ids.run}/lines/${ids.sara}`).set(as(clerk)).send({ ...edit, reason: 'غياب يوم بعذر طبي، وفرق بدل السكن' }).expect(200);
    // التعديل يظهر للمعتمد بسببه وقيمه قبل وبعد
    expect(upd.body.edits).toHaveLength(1);
    expect(upd.body.edits[0]).toMatchObject({ employeeId: ids.sara, employeeName: 'سارة أحمد العتيبي', reason: 'غياب يوم بعذر طبي، وفرق بدل السكن', actorName: 'محاسب الرواتب' });
    expect(upd.body.edits[0].changes).toEqual(expect.arrayContaining([
      { field: 'absentDays', label: 'أيام الغياب', before: 2, after: 1 }, { field: 'additions', label: 'الإضافات', before: 0, after: 500 },
      { field: 'otherDeduction', label: 'الاستقطاعات الأخرى', before: 0, after: 300 },
    ]));
    const s2 = upd.body.lines.find((l: { employeeId: string }) => l.employeeId === ids.sara);
    expect(s2.net).toBe(10800 + 500 - 360 - 30 - 975 - 300);
    await http.put(`${H}/payroll-runs/${ids.run}/lines/${ids.sara}`).set(as(clerk)).send({ additions: [], otherDeduction: 50000, otherDeductionNote: 'كبير', reason: 'جزاء' }).expect(400);
    // إعادة الاحتساب تحافظ على التعديلات اليدوية
    const re = await http.post(`${H}/payroll-runs/${ids.run}/recalc`).set(as(clerk)).expect(201);
    expect(re.body.lines.find((l: { employeeId: string }) => l.employeeId === ids.sara).net).toBe(s2.net);
    // إلغاء تعديل الحضور يعيد حضور سارة وحدها من البصمات، ويُسجل بقيمه قبل وبعد
    const aliNet = re.body.lines.find((l: { employeeId: string }) => l.employeeId === ids.ali).net;
    const back = (await http.put(`${H}/payroll-runs/${ids.run}/lines/${ids.sara}`).set(as(clerk)).send({
      ...edit, overrideAttendance: false, additions: [{ code: 'transport', amount: 500, note: 'فرق بدل' }], reason: 'لم يُقدَّم العذر الطبي',
    }).expect(200)).body;
    expect(back.lines.find((l: { employeeId: string }) => l.employeeId === ids.sara).attendance).toMatchObject({ absentDays: 2, overridden: false });
    expect(back.lines.find((l: { employeeId: string }) => l.employeeId === ids.ali).net).toBe(aliNet);
    expect(back.edits).toHaveLength(2);
    expect(back.edits[0].reason).toBe('لم يُقدَّم العذر الطبي');
    expect(back.edits[0].changes.map((c: { field: string }) => c.field)).toEqual(expect.arrayContaining(['absentDays', 'additionItems', 'overridden']));
    await http.put(`${H}/payroll-runs/${ids.run}/lines/${ids.sara}`).set(as(clerk)).send({ ...edit, reason: 'قُدّم العذر الطبي' }).expect(200);

    // لا يُرفع قبل اكتمال الربط المحاسبي
    await http.post(`${H}/payroll-runs/${ids.run}/submit`).set(as(clerk)).expect(400);
    const cfg = {
      payableAccountId: acc['2140100101'], gosiPayableAccountId: acc['2140100108'], deductionsAccountId: acc['1140400101'],
      defaultCashAccountId: ids.bank1, stages: [{ name: 'مراجعة المدير المالي', roleId: null }, { name: 'اعتماد المدير التنفيذي', roleId: null }],
    };
    await http.put(`${H}/payroll-config`).set(as(admin)).send({ ...cfg, payableAccountId: acc['4110100101'] }).expect(400);
    await http.put(`${H}/payroll-config`).set(as(admin)).send(cfg).expect(200);
    const sub = await http.post(`${H}/payroll-runs/${ids.run}/submit`).set(as(clerk)).expect(201);
    expect(sub.body.status).toBe('pending');
    expect(sub.body.stageName).toBe('مراجعة المدير المالي');
    await http.put(`${H}/payroll-runs/${ids.run}/lines/${ids.sara}`).set(as(clerk)).send({ additions: [], otherDeduction: 0 }).expect(409);
    await http.post(`${H}/payroll-runs/${ids.run}/decision`).set(as(clerk)).send({ decision: 'approve' }).expect(403);
    await http.post(`${H}/payroll-runs/${ids.run}/decision`).set(as(admin)).send({ decision: 'return' }).expect(400);
    const ret = await http.post(`${H}/payroll-runs/${ids.run}/decision`).set(as(admin)).send({ decision: 'return', note: 'راجع السلفة' }).expect(201);
    expect(ret.body.status).toBe('returned');
    await http.post(`${H}/payroll-runs/${ids.run}/submit`).set(as(clerk)).expect(201);
    const st1 = await http.post(`${H}/payroll-runs/${ids.run}/decision`).set(as(admin)).send({ decision: 'approve' }).expect(201);
    expect(st1.body.stageName).toBe('اعتماد المدير التنفيذي');
    const fin = await http.post(`${H}/payroll-runs/${ids.run}/decision`).set(as(admin)).send({ decision: 'approve', note: 'معتمد' }).expect(201);
    expect(fin.body.status).toBe('approved');
    expect(fin.body.entry.status).toBe('posted');
    ids.entry = fin.body.entry.id;
  });

  it('the accrual entry is balanced and charged to each unit analytic account', async () => {
    const e = (await http.get(`${A}/entries/${ids.entry}`).set(as(admin)).expect(200)).body;
    const lines = e.lines as { accountCode: string; debit: number; credit: number; analytic: { code: string }[] }[];
    const sum = (k: 'debit' | 'credit') => Math.round(lines.reduce((s, l) => s + l[k], 0) * 100) / 100;
    expect(sum('debit')).toBe(sum('credit'));
    const run = (await http.get(`${H}/payroll-runs/${ids.run}`).set(as(admin)).expect(200)).body;
    expect(sum('debit')).toBe(Math.round((run.totals.gross - run.totals.absenceDeduction - run.totals.lateDeduction - run.totals.unpaidDeduction + run.totals.gosiEmployer) * 100) / 100);
    // علي (وظيفة إدارية بالفئة الافتراضية) في الشؤون المالية بلا حساب تحليلي فيأخذ حساب الإدارة العامة (CC01)
    const basic = lines.filter((l) => l.accountCode === '4110100101');
    expect(basic.map((l) => l.analytic[0].code)).toEqual(['CC01']);
    // سارة على وظيفة من فئة البرامج والأنشطة: كل مصروفها على حساب الفئة ومحمّل على تحليلي إدارة البرامج (CC02)
    const program = lines.filter((l) => l.accountCode === '4410100101');
    expect(program.length).toBeGreaterThan(0);
    expect(program.every((l) => l.analytic[0].code === 'CC02')).toBe(true);
    expect(lines.find((l) => l.accountCode === '2140100108')!.credit).toBe(run.totals.gosiEmployee + run.totals.gosiEmployer);
    expect(lines.find((l) => l.accountCode === '1140400101')!.credit).toBe(300);
    expect(run.bankSheets.map((b: { cashAccountName: string }) => b.cashAccountName).sort()).toEqual(['الراجحي - الرواتب', 'الرياض - البدلات']);
  });

  it('payment vouchers per bank and payable account, through the accounting approval', async () => {
    await http.post(`${H}/payroll-runs/${ids.run}/vouchers`).set(as(clerk)).send({ voucherDate: lastDay }).expect(403);
    const r = (await http.post(`${H}/payroll-runs/${ids.run}/vouchers`).set(as(admin)).send({ voucherDate: lastDay }).expect(201)).body;
    expect(r.vouchers).toHaveLength(3);
    expect(r.vouchers.every((v: { status: string }) => v.status === 'draft')).toBe(true);
    const total = Math.round(r.vouchers.reduce((s: number, v: { amount: number }) => s + v.amount, 0) * 100) / 100;
    expect(total).toBe(r.totals.net);
    expect(r.can.vouchers).toBe(false);
    await http.post(`${H}/payroll-runs/${ids.run}/vouchers`).set(as(admin)).send({ voucherDate: lastDay }).expect(409);
    await http.post(`${H}/payroll-runs/${ids.run}/reopen`).set(as(admin)).send({ note: 'خطأ' }).expect(409);
    const v = (await http.get(`${A}/voucher/${r.vouchers[0].id}`).set(as(admin)).expect(200)).body;
    expect(v.sourceType).toBe('payroll');
    expect(v.counterAccountCode).toMatch(/^21401001/);
    await http.post(`${A}/voucher/${v.id}/submit`).set(as(admin)).expect(201);
    const after = (await http.get(`${H}/payroll-runs/${ids.run}`).set(as(admin)).expect(200)).body;
    expect(after.vouchers.find((x: { id: string }) => x.id === v.id).status).toBe('approved');
  });
});
