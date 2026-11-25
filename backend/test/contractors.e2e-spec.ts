import { Test } from '@nestjs/testing';
import { NestExpressApplication } from '@nestjs/platform-express';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/main';

/**
 * المتعاونون: تصنيف الموظف متعاونًا بطريقة أجر يختارها المستخدم (شهري، يومي، بالساعة، بالمهمة) بحضور أو بدونه،
 * وكشف مستقل بلا تأمينات بتعديل مرن، وقيد على حساب مصروف مستقل (في حكم الاستشارات)، وسند صرف لكل متعاون.
 */
jest.setTimeout(60000);
const DB = process.env.TEST_DATABASE_URL ?? 'postgres://erp:erp@localhost:5432/charity_erp_test';

describe('Contractors payroll', () => {
  let app: NestExpressApplication;
  let http: ReturnType<typeof request>;
  let uploadDir: string;
  const tk: Record<string, string> = {};
  const ids: Record<string, string> = {};
  const acc: Record<string, string> = {};
  const as = (t: string) => ({ Authorization: `Bearer ${t}` });
  const login = async (login: string, password: string, organization?: string) =>
    (await http.post('/api/auth/login').send({ login, password, organization }).expect(200)).body.accessToken as string;
  const H = '/api/hr';
  const A = '/api/accounting';
  const now = new Date(Date.now() + 3 * 3600000);
  const prev = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  const month = prev.toISOString().slice(0, 7);
  const year = prev.getUTCFullYear();
  const lastDay = new Date(Date.UTC(year, prev.getUTCMonth() + 1, 0)).toISOString().slice(0, 10);
  const days = Array.from({ length: Number(lastDay.slice(8)) }, (_, i) => `${month}-${String(i + 1).padStart(2, '0')}`);
  const workDays = days.filter((d) => ![5, 6].includes(new Date(`${d}T00:00:00Z`).getUTCDay()));
  type Line = {
    employeeId: string; fullName: string; earned: number; net: number; gosiEmployee: number; gosiEmployer: number; absenceDeduction: number; lateDeduction: number;
    otherDeduction: number; additions: { code: string; amount: number; note: string | null }[];
    attendance: { tracked: boolean; absentDays: number }; contract: { basis: string; rate: number; units: number; manualUnits: boolean; note: string | null };
  };
  const line = (run: { lines: Line[] }, id: string) => run.lines.find((l) => l.employeeId === id)!;

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
    for (const [name, slug] of [['جمعية البر', 'albir'], ['جمعية أخرى', 'other']]) {
      await http.post('/api/platform/organizations').set(as(platform)).send({
        name, slug, adminFullName: 'مدير النظام', adminEmail: `admin@${slug}.org`, adminPassword: 'Admin12345',
      }).expect(201);
    }
    tk.admin = await login('admin@albir.org', 'Admin12345', 'albir');
    tk.other = await login('admin@other.org', 'Admin12345', 'other');
    const role = async (name: string, permissions: string[]) => (await http.post('/api/roles').set(as(tk.admin)).send({ name, permissions }).expect(201)).body.id;
    const user = async (key: string, fullName: string, roleIds: string[]) => {
      await http.post('/api/users').set(as(tk.admin)).send({ fullName, email: `${key}@albir.org`, password: 'Pass12345', roleIds }).expect(201);
      tk[key] = await login(`${key}@albir.org`, 'Pass12345', 'albir');
    };
    await user('clerk', 'مسؤول الرواتب', [await role('مسؤول الرواتب', ['hr.dashboard.read', 'hr.salaries.read', 'hr.payroll.manage', 'hr.employees.manage'])]);
    await user('hrclerk', 'موظف شؤون', [await role('شؤون الموظفين', ['hr.dashboard.read', 'hr.employees.manage'])]);
    await user('viewer', 'مطلع', [await role('مطلع', ['hr.dashboard.read', 'hr.salaries.read'])]);

    await http.post(`${A}/chart/install`).set(as(tk.admin)).expect(201);
    const accounts = (await http.get(`${A}/accounts`).set(as(tk.admin)).expect(200)).body.accounts as { id: string; code: string }[];
    accounts.forEach((a) => (acc[a.code] = a.id));
    const analytic = (await http.get(`${A}/analytic`).set(as(tk.admin)).expect(200)).body.accounts as { id: string; code: string }[];
    analytic.forEach((a) => (acc[a.code] = a.id));
    await http.post(`${A}/setup`).set(as(tk.admin)).send({
      fiscalYear: year, startDate: `${year}-01-01`, endDate: `${year}-12-31`, isFirstYear: true, firstYearStart: `${year}-01-01`, firstYearEnd: `${year}-12-31`,
    }).expect(201);
    ids.bank = (await http.post(`${A}/cash-accounts`).set(as(tk.admin)).send({ kind: 'bank', name: 'الراجحي', bankName: 'مصرف الراجحي', accountNumber: '608010167519', glAccountId: acc['1110100201'] }).expect(201)).body.id;
    // حساب مستحق مستقل لأتعاب المتعاونين
    const group = (await http.post(`${A}/accounts`).set(as(tk.admin)).send({ code: '21401006', name: 'التكاليف المهنية ــ المستحقة', kind: 'main', nature: 'liabilities', parentId: acc['21401'] }).expect(201)).body;
    acc.payable = (await http.post(`${A}/accounts`).set(as(tk.admin)).send({ code: '2140100601', name: 'أتعاب المتعاونين ــ المستحقة', kind: 'sub', nature: 'liabilities', parentId: group.id }).expect(201)).body.id;

    ids.unit = (await http.post(`${H}/units`).set(as(tk.admin)).send({ name: 'الإدارة العامة', level: 0, analyticAccountId: acc.CC01 }).expect(201)).body.id;
    const job = { title: 'مدرب', unitId: ids.unit, headcount: 5, purpose: 'عمل', responsibilities: ['مهمة'], experienceYears: 0, competencies: [], kpis: [] };
    ids.job = (await http.post(`${H}/jobs`).set(as(tk.admin)).send(job).expect(201)).body.id;
    await http.put(`${H}/attendance/settings`).set(as(tk.admin)).send({ enabled: true, workStart: '08:00', workEnd: '15:00', weekend: [5, 6], holidays: [] }).expect(200);
  });

  afterAll(async () => {
    await app.get(DataSource).destroy();
    await app.close();
    rmSync(uploadDir, { recursive: true, force: true });
  });

  const hire = `${year - 1}-01-01`;
  const base = (fullName: string, nationalId: string, extra: Record<string, unknown> = {}) => ({
    fullName, nationalId, nationality: 'سعودي', isSaudi: true, gender: 'male', jobId: ids.job, hireDate: hire, contractType: 'indefinite', contractStart: hire,
    qiwaStatus: 'documented', basicSalary: 6000, allowances: [{ code: 'housing', name: 'x', amount: 1500 }], gosiFirstRegistration: '2020-01-01',
    iban: 'SA0380000000608010167519', ...extra,
  });

  it('a contractor has a pay basis and rate, and no salary, allowances or end-of-service', async () => {
    await http.post(`${H}/employees`).set(as(tk.clerk)).send(base('متعاون بلا أساس أجر', '1000000001', { employmentKind: 'contractor' })).expect(400);
    await http.post(`${H}/employees`).set(as(tk.clerk)).send(base('متعاون بأساس غير معروف', '1000000001', { employmentKind: 'contractor', payBasis: 'weekly', payRate: 10 })).expect(400);
    ids.daily = (await http.post(`${H}/employees`).set(as(tk.clerk)).send(base('فهد عبدالله القحطاني', '1000000001', {
      employmentKind: 'contractor', payBasis: 'daily', payRate: 450, attendanceCode: '201',
    })).expect(201)).body.id;
    ids.hourly = (await http.post(`${H}/employees`).set(as(tk.clerk)).send(base('سلمان ناصر العتيبي', '1000000002', {
      employmentKind: 'contractor', payBasis: 'hourly', payRate: 300, attendanceExempt: true,
    })).expect(201)).body.id;
    ids.monthly = (await http.post(`${H}/employees`).set(as(tk.clerk)).send(base('ماجد علي الزهراني', '1000000003', {
      employmentKind: 'contractor', payBasis: 'monthly', payRate: 6000, attendanceCode: '202',
    })).expect(201)).body.id;
    ids.staff = (await http.post(`${H}/employees`).set(as(tk.clerk)).send(base('سارة أحمد العتيبي', '1000000004', { attendanceExempt: true, payBasis: 'daily', payRate: 99 })).expect(201)).body.id;

    const c = (await http.get(`${H}/employees/${ids.daily}`).set(as(tk.clerk)).expect(200)).body;
    expect(c).toMatchObject({ employmentKind: 'contractor', payBasis: 'daily', payRate: 450, basicSalary: 0, allowances: [], gradeId: null, breakdown: null, eos: null });
    // الموظف العادي لا يحمل أساس أجر المتعاون حتى لو أُرسل
    const s = (await http.get(`${H}/employees/${ids.staff}`).set(as(tk.clerk)).expect(200)).body;
    expect(s).toMatchObject({ employmentKind: 'staff', payBasis: null, payRate: null, basicSalary: 6000 });
    expect(s.breakdown).not.toBeNull();
    const list = (await http.get(`${H}/employees`).set(as(tk.clerk)).expect(200)).body as { id: string; employmentKind: string; gross: number | null }[];
    expect(list.find((e) => e.id === ids.daily)).toMatchObject({ employmentKind: 'contractor', gross: null });
    // جمعية أخرى لا ترى المتعاون
    await http.get(`${H}/employees/${ids.daily}`).set(as(tk.other)).expect(404);
  });

  it('the contractors sheet is separate from the staff payroll and has no social insurance', async () => {
    // حضور الشهر: اليومي غاب يومين، والشهري غاب يومًا واحدًا
    const lines = ['No.,Name,Date/Time'];
    workDays.forEach((d, i) => {
      const [y, m, dd] = d.split('-');
      if (i !== 2 && i !== 5) lines.push(`201,فهد,${dd}/${m}/${y} 07:55`, `201,فهد,${dd}/${m}/${y} 03:05 PM`);
      if (i !== 3) lines.push(`202,ماجد,${dd}/${m}/${y} 07:55`, `202,ماجد,${dd}/${m}/${y} 03:05 PM`);
    });
    await http.post(`${H}/attendance/import`).set(as(tk.admin)).attach('file', Buffer.from(lines.join('\n')), 'attendance.csv').expect(201);

    const staff = (await http.post(`${H}/payroll-runs`).set(as(tk.clerk)).send({ month }).expect(201)).body;
    expect(staff.kind).toBe('staff');
    ids.staffRun = staff.id;
    expect(staff.lines.map((l: Line) => l.employeeId)).toEqual([ids.staff]);
    await http.post(`${H}/payroll-runs`).set(as(tk.viewer)).send({ month, kind: 'contractors' }).expect(403);
    await http.post(`${H}/payroll-runs`).set(as(tk.clerk)).send({ month, kind: 'others' }).expect(400);
    const run = (await http.post(`${H}/payroll-runs`).set(as(tk.clerk)).send({ month, kind: 'contractors' }).expect(201)).body;
    ids.run = run.id;
    expect(run.kind).toBe('contractors');
    await http.post(`${H}/payroll-runs`).set(as(tk.clerk)).send({ month, kind: 'contractors' }).expect(409);
    expect(run.lines.map((l: Line) => l.employeeId).sort()).toEqual([ids.daily, ids.hourly, ids.monthly].sort());
    expect(run.lines.every((l: Line) => l.gosiEmployee === 0 && l.gosiEmployer === 0)).toBe(true);

    const daily = line(run, ids.daily);
    expect(daily.contract).toMatchObject({ basis: 'daily', rate: 450, units: workDays.length - 2, manualUnits: false });
    expect(daily.earned).toBe(450 * (workDays.length - 2));
    expect(daily.absenceDeduction).toBe(0);
    const hourly = line(run, ids.hourly);
    expect(hourly.contract.units).toBe(0);
    expect(hourly.net).toBe(0);
    expect(run.warnings.join(' ')).toContain('سلمان ناصر العتيبي: اكتب عدد الساعات');
    const monthly = line(run, ids.monthly);
    expect(monthly.attendance).toMatchObject({ tracked: true, absentDays: 1 });
    expect(monthly.earned).toBe(6000);
    expect(monthly.absenceDeduction).toBeGreaterThan(0);
    expect(monthly.net).toBe(6000 - monthly.absenceDeduction - monthly.lateDeduction);

    const list = (await http.get(`${H}/payroll-runs`).set(as(tk.clerk)).expect(200)).body as { id: string; kind: string; kindLabel: string }[];
    expect(list.find((r) => r.id === ids.run)).toMatchObject({ kind: 'contractors', kindLabel: 'كشف المتعاونين' });
    await http.get(`${H}/payroll-runs/${ids.run}`).set(as(tk.other)).expect(404);
  });

  it('the payroll officer edits contractor lines freely, without a reason', async () => {
    const put = (id: string, body: Record<string, unknown>, token = tk.clerk) =>
      http.put(`${H}/payroll-runs/${ids.run}/lines/${id}`).set(as(token)).send({ additions: [], otherDeduction: 0, ...body });
    await put(ids.hourly, { units: 10 }, tk.viewer).expect(403);
    await put(ids.hourly, { units: 10 }, tk.other).expect(404);
    let run = (await put(ids.hourly, { units: 10, rate: 320, additions: [{ code: 'anything', amount: 100 }], otherDeduction: 50, note: 'استشارات العقود' }).expect(200)).body;
    const h = line(run, ids.hourly);
    expect(h.contract).toMatchObject({ units: 10, rate: 320, manualUnits: true, note: 'استشارات العقود' });
    expect(h.additions).toEqual([{ code: 'bonus', amount: 100, note: null }]);
    expect(h.otherDeduction).toBe(50);
    expect(h.net).toBe(3200 + 100 - 50);
    // أيام المتعاون اليومي تُعدّل يدويًا وتبقى بعد إعادة الاحتساب
    run = (await put(ids.daily, { units: 5 }).expect(200)).body;
    expect(line(run, ids.daily).earned).toBe(2250);
    run = (await http.post(`${H}/payroll-runs/${ids.run}/recalc`).set(as(tk.clerk)).expect(201)).body;
    expect(line(run, ids.daily).contract).toMatchObject({ units: 5, manualUnits: true });
    expect(line(run, ids.hourly).net).toBe(3250);
    // الغياب في الشهري يُعدّل يدويًا
    run = (await put(ids.monthly, { overrideAttendance: true, absentDays: 0, lateMinutes: 0 }).expect(200)).body;
    expect(line(run, ids.monthly).net).toBe(6000);
    await put(ids.monthly, { otherDeduction: 999999 }).expect(400);
    const history = run.history as { action: string; note: string | null }[];
    expect(history.filter((x) => x.action === 'line').length).toBeGreaterThanOrEqual(3);
  });

  it('approval posts one entry on the separate contractor accounts and one payment voucher per contractor', async () => {
    const cfg = {
      payableAccountId: acc['2140100101'], gosiPayableAccountId: acc['2140100108'], deductionsAccountId: acc['1140400101'], defaultCashAccountId: ids.bank,
      stages: [{ name: 'اعتماد المدير التنفيذي', roleId: null }],
    };
    await http.put(`${H}/payroll-config`).set(as(tk.admin)).send(cfg).expect(200);
    const before = (await http.get(`${H}/payroll-runs/${ids.run}`).set(as(tk.clerk)).expect(200)).body;
    expect(before.planError).toContain('حساب مصروف أتعاب المتعاونين');
    await http.post(`${H}/payroll-runs/${ids.run}/submit`).set(as(tk.clerk)).expect(400);
    // المصروف من طبيعة المصروفات، والمستحق من الالتزامات
    await http.put(`${H}/payroll-config`).set(as(tk.admin)).send({ ...cfg, contractorExpenseAccountId: acc.payable, contractorPayableAccountId: acc.payable }).expect(400);
    await http.put(`${H}/payroll-config`).set(as(tk.admin)).send({ ...cfg, contractorExpenseAccountId: acc['4120301001'], contractorPayableAccountId: acc['4120301001'] }).expect(400);
    await http.put(`${H}/payroll-config`).set(as(tk.clerk)).send({ ...cfg, contractorExpenseAccountId: acc['4120301001'], contractorPayableAccountId: acc.payable }).expect(403);
    await http.put(`${H}/payroll-config`).set(as(tk.admin)).send({ ...cfg, contractorExpenseAccountId: acc['4120301001'], contractorPayableAccountId: acc.payable }).expect(200);

    await http.post(`${H}/payroll-runs/${ids.run}/submit`).set(as(tk.clerk)).expect(201);
    const fin = (await http.post(`${H}/payroll-runs/${ids.run}/decision`).set(as(tk.admin)).send({ decision: 'approve' }).expect(201)).body;
    expect(fin.status).toBe('approved');
    expect(fin.entry.status).toBe('posted');
    const e = (await http.get(`${A}/entries/${fin.entry.id}`).set(as(tk.admin)).expect(200)).body;
    expect(e.description).toContain('المتعاونين');
    const lines = e.lines as { accountCode: string; debit: number; credit: number; analytic: { code: string }[] }[];
    const sum = (k: 'debit' | 'credit') => Math.round(lines.reduce((s, l) => s + l[k], 0) * 100) / 100;
    expect(sum('debit')).toBe(sum('credit'));
    const expense = lines.filter((l) => l.accountCode === '4120301001');
    expect(expense.every((l) => l.analytic[0].code === 'CC01')).toBe(true);
    expect(Math.round(expense.reduce((s, l) => s + l.debit, 0) * 100) / 100).toBe(fin.totals.gross - fin.totals.absenceDeduction - fin.totals.lateDeduction);
    expect(lines.find((l) => l.accountCode === '2140100601')!.credit).toBe(fin.totals.net);
    expect(lines.find((l) => l.accountCode === '1140400101')!.credit).toBe(50);
    // لا شيء على حسابات الرواتب أو التأمينات
    expect(lines.some((l) => l.accountCode.startsWith('21401001'))).toBe(false);

    const r = (await http.post(`${H}/payroll-runs/${ids.run}/vouchers`).set(as(tk.admin)).send({ voucherDate: lastDay }).expect(201)).body;
    expect(r.vouchers).toHaveLength(3);
    const total = Math.round(r.vouchers.reduce((s: number, v: { amount: number }) => s + v.amount, 0) * 100) / 100;
    expect(total).toBe(r.totals.net);
    const v = (await http.get(`${A}/voucher/${r.vouchers[0].id}`).set(as(tk.admin)).expect(200)).body;
    expect(['فهد عبدالله القحطاني', 'سلمان ناصر العتيبي', 'ماجد علي الزهراني']).toContain(v.partyName);
    expect(v.counterAccountCode).toBe('2140100601');
    expect(v.purpose).toContain('كشف المتعاونين');
  });

  it('records before and after values of every line edit', async () => {
    const run = (await http.get(`${H}/payroll-runs/${ids.run}`).set(as(tk.admin)).expect(200)).body;
    const edit = (run.history as { action: string; employeeId?: string; actorId?: string; changes?: { field: string; before: unknown; after: unknown }[] }[])
      .find((h) => h.action === 'line' && h.employeeId === ids.hourly)!;
    expect(edit.actorId).toBeTruthy();
    expect(edit.changes).toEqual(expect.arrayContaining([
      { field: 'rate', label: 'قيمة الوحدة', before: 300, after: 320 }, { field: 'units', label: 'العدد', before: 0, after: 10 },
      { field: 'otherDeduction', label: 'الاستقطاعات الأخرى', before: 0, after: 50 },
    ]));
  });

  it('a person is never paid in both sheets of the same month, and only salary users change pay terms', async () => {
    const staffBody = base('سارة أحمد العتيبي', '1000000004', { attendanceExempt: true });
    // سارة في كشف الموظفين قيد الإعداد: لا يتغير تصنيفها
    await http.patch(`${H}/employees/${ids.staff}`).set(as(tk.clerk)).send({ ...staffBody, employmentKind: 'contractor', payBasis: 'monthly', payRate: 5000 }).expect(409);
    // من لا يملك صلاحية الرواتب لا يغيّر أجر المتعاون ولا تصنيفه
    const fahd = base('فهد عبدالله القحطاني', '1000000001', { employmentKind: 'contractor', payBasis: 'daily', payRate: 450, attendanceCode: '201' });
    await http.patch(`${H}/employees/${ids.daily}`).set(as(tk.hrclerk)).send({ ...fahd, payRate: 1, employmentKind: 'staff' }).expect(200);
    expect((await http.get(`${H}/employees/${ids.daily}`).set(as(tk.clerk)).expect(200)).body).toMatchObject({ employmentKind: 'contractor', payRate: 450 });
    // فهد صُرف له في كشف المتعاونين المعتمد؛ إن صار موظفًا لا يدخل كشف الموظفين للشهر نفسه
    await http.post(`${H}/payroll-runs/${ids.staffRun}/cancel`).set(as(tk.clerk)).expect(201);
    await http.patch(`${H}/employees/${ids.daily}`).set(as(tk.clerk)).send({ ...fahd, employmentKind: 'staff', basicSalary: 6000 }).expect(200);
    const staff = (await http.post(`${H}/payroll-runs`).set(as(tk.clerk)).send({ month }).expect(201)).body;
    expect(staff.lines.map((l: Line) => l.employeeId)).toEqual([ids.staff]);
    expect(staff.warnings.join(' ')).toContain('فهد عبدالله القحطاني: له سطر في كشف المتعاونين');
  });
  it('a contractor has no end-of-service gratuity, provision or leave encashment', async () => {
    // حاسبة نهاية الخدمة لمتعاون مسجل: صفر مع السبب، أيًا كان سبب الانتهاء
    for (const reason of ['contract_end', 'employer_termination', 'resignation']) {
      const calc = (await http.post(`${H}/eos/calculate`).set(as(tk.clerk)).send({ employeeId: ids.monthly, endDate: lastDay, reason }).expect(200)).body;
      expect(calc).toMatchObject({ contractor: true, total: 0, leaveDays: 0, leaveEncashment: 0, eos: { amount: 0, fullAmount: 0, wage: 0 } });
      expect(calc.eos.explanation).toContain('لا يستحق مكافأة نهاية خدمة');
    }
    // معاينة مسير الرواتب للموظفين فقط: لا يظهر المتعاون ولا يُجنَّب له مخصص
    const preview = (await http.get(`${H}/payroll?month=${month}`).set(as(tk.clerk)).expect(200)).body;
    const listed = preview.lines.map((l: { id: string }) => l.id);
    expect(listed).not.toContain(ids.monthly);
    expect(listed).not.toContain(ids.hourly);
    // ملف إنهاء التعاون: بيان المستحقات بلا مكافأة ولا بدل إجازات
    const sep = (await http.post(`${H}/separations`).set(as(tk.admin)).send({ employeeId: ids.hourly, reason: 'contract_end', lastWorkingDay: lastDay }).expect(201)).body;
    expect(sep.preview).toMatchObject({ contractor: true, leaveEncashment: 0, gross: 0, eos: { amount: 0 } });
    // لا يتغير تصنيفه إلى موظف وملف إنهاء التعاون قائم
    const hourly = (await http.get(`${H}/employees/${ids.hourly}`).set(as(tk.clerk)).expect(200)).body;
    await http.patch(`${H}/employees/${ids.hourly}`).set(as(tk.clerk)).send({ ...base(hourly.fullName, hourly.nationalId, { attendanceExempt: true }), employmentKind: 'staff', basicSalary: 6000 }).expect(409);
    // ملف المتعاون في الشاشة بلا تفصيل مكافأة
    expect((await http.get(`${H}/employees/${ids.monthly}`).set(as(tk.clerk)).expect(200)).body.eos).toBeNull();
  });
});
