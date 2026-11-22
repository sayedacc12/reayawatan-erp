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
 * إخلاء الطرف وصرف المستحقات ونهاية العقود: طلب الاستقالة من الخدمة الذاتية يفتح الملف، كل بند يخليه مسؤوله حسب الهيكل
 * أو دوره، بيان المستحقات بعد اكتمال الإخلاء، فصل المهام في الاعتماد، الإرجاع وإعادة الحساب، الاعتماد النهائي (إنهاء الخدمة
 * وتسوية السلفة وقيد المستحقات)، ثم سند الصرف.
 */
const DB = process.env.TEST_DATABASE_URL ?? 'postgres://erp:erp@localhost:5432/charity_erp_test';
const day = (n: number) => new Date(Date.now() + 3 * 3600000 + n * 86400000).toISOString().slice(0, 10);

describe('Clearance and end-of-service settlement', () => {
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
  const year = Number(day(0).slice(0, 4));
  let types: { id: string; code: string }[] = [];
  const T = (code: string) => types.find((t) => t.code === code)!.id;
  const submit = (who: string, payload: unknown) => http.post(`${H}/me/requests`).set(as(tk[who])).field('payload', JSON.stringify(payload));
  const decide = (who: string, id: string, decision: string, note?: string) => http.post(`${H}/me/requests/${id}/decision`).set(as(tk[who])).send({ decision, note });
  const item = (who: string, code: string, body: Record<string, unknown>) => http.post(`${H}/separations/${ids.sep}/items/${code}`).set(as(tk[who])).send(body);

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
      name: 'جمعية الوفاء', slug: 'wafa', adminFullName: 'المدير التنفيذي', adminEmail: 'ceo@wafa.org', adminPassword: 'Admin12345',
    }).expect(201);
    tk.admin = await login('ceo@wafa.org', 'Admin12345', 'wafa');
    ids.adminUser = (await http.get('/api/auth/me').set(as(tk.admin)).expect(200)).body.user.id;

    // النظام المالي
    await http.post(`${A}/chart/install`).set(as(tk.admin)).expect(201);
    ((await http.get(`${A}/accounts`).set(as(tk.admin)).expect(200)).body.accounts as { id: string; code: string }[]).forEach((a) => (acc[a.code] = a.id));
    ((await http.get(`${A}/analytic`).set(as(tk.admin)).expect(200)).body.accounts as { id: string; code: string }[]).forEach((a) => (acc[a.code] = a.id));
    await http.post(`${A}/setup`).set(as(tk.admin)).send({
      fiscalYear: year, startDate: `${year}-01-01`, endDate: `${year}-12-31`, isFirstYear: true, firstYearStart: `${year}-01-01`, firstYearEnd: `${year}-12-31`,
    }).expect(201);
    // آخر يوم عمل بعد 40 يومًا قد يقع في السنة التالية (من أواخر نوفمبر)، فتُفتح السنة التالية أيضًا
    await http.post(`${A}/years/next`).set(as(tk.admin)).expect(201);
    ids.bank = (await http.post(`${A}/cash-accounts`).set(as(tk.admin)).send({ kind: 'bank', name: 'الراجحي', bankName: 'مصرف الراجحي', accountNumber: '608010167519', glAccountId: acc['1110100201'] }).expect(201)).body.id;
    await http.put(`${H}/payroll-config`).set(as(tk.admin)).send({
      payableAccountId: acc['2140100101'], gosiPayableAccountId: acc['2140100108'], deductionsAccountId: acc['1140100401'], defaultCashAccountId: ids.bank, stages: [],
    }).expect(200);

    // الأدوار: شؤون الموظفين (تعد الملف والبيان) والمالية (تعتمد) وتقنية المعلومات (تخلي بند الأنظمة)
    const role = async (name: string, permissions: string[]) => (await http.post('/api/roles').set(as(tk.admin)).send({ name, permissions }).expect(201)).body.id as string;
    ids.hrRole = await role('شؤون الموظفين', ['hr.separations.manage', 'hr.separations.approve', 'hr.requests.approve', 'hr.requests.read']);
    ids.finRole = await role('المالية', ['hr.separations.approve']);
    ids.itRole = await role('تقنية المعلومات', []);
    const user = async (key: string, fullName: string, roleIds: string[] = []) => {
      ids[`${key}User`] = (await http.post('/api/users').set(as(tk.admin)).send({ fullName, email: `${key}@wafa.org`, password: 'Pass12345', roleIds }).expect(201)).body.id;
      tk[key] = await login(`${key}@wafa.org`, 'Pass12345', 'wafa');
    };
    await user('mgr', 'مدير البرامج');
    await user('emp', 'أخصائي البرامج');
    await user('other', 'موظف آخر');
    await user('hr', 'أخصائية شؤون الموظفين', [ids.hrRole]);
    await user('fin', 'المدير المالي', [ids.finRole]);
    await user('it', 'مسؤول التقنية', [ids.itRole]);

    ids.top = (await http.post(`${H}/units`).set(as(tk.admin)).send({ name: 'الإدارة التنفيذية', level: 0, analyticAccountId: acc.CC01 }).expect(201)).body.id;
    ids.dept = (await http.post(`${H}/units`).set(as(tk.admin)).send({ name: 'إدارة البرامج', level: 1, parentId: ids.top }).expect(201)).body.id;
    ids.job = (await http.post(`${H}/jobs`).set(as(tk.admin)).send({
      title: 'أخصائي برامج', unitId: ids.dept, headcount: 5, purpose: 'تنفيذ البرامج', responsibilities: ['التنفيذ'], experienceYears: 1, competencies: [], kpis: [],
    }).expect(201)).body.id;
    let n = 0;
    const emp = async (fullName: string, userId: string | null, over: Record<string, unknown> = {}) => {
      n++;
      return (await http.post(`${H}/employees`).set(as(tk.admin)).send({
        fullName, nationalId: `10000000${String(n).padStart(2, '0')}`, nationality: 'سعودي', isSaudi: true, gender: 'male', jobId: ids.job,
        hireDate: day(-2300), contractType: 'indefinite', contractStart: day(-2300), qiwaStatus: 'documented', basicSalary: 9000,
        allowances: [{ code: 'housing', name: 'بدل السكن', amount: 3000 }], iban: 'SA0380000000608010167599', userId, ...over,
      }).expect(201)).body.id as string;
    };
    ids.ceo = await emp('المدير التنفيذي', ids.adminUser, { unitId: ids.top });
    ids.mgrE = await emp('مدير البرامج', ids.mgrUser);
    ids.empE = await emp('أخصائي البرامج', ids.empUser);
    ids.otherE = await emp('موظف آخر', ids.otherUser);
    await http.patch(`${H}/units/${ids.top}`).set(as(tk.admin)).send({ name: 'الإدارة التنفيذية', level: 0, analyticAccountId: acc.CC01, managerEmployeeId: ids.ceo }).expect(200);
    await http.patch(`${H}/units/${ids.dept}`).set(as(tk.admin)).send({ name: 'إدارة البرامج', level: 1, parentId: ids.top, managerEmployeeId: ids.mgrE }).expect(200);
  }, 90_000);

  afterAll(async () => {
    await app.get(DataSource).destroy();
    await app.close();
    rmSync(uploadDir, { recursive: true, force: true });
  });

  it('settings: clearance items with their responsible, approval stages and accounts', async () => {
    const c = (await http.get(`${H}/separation-config`).set(as(tk.admin)).expect(200)).body;
    expect(c.config.items.map((i: { code: string }) => i.code)).toEqual(['handover', 'assets', 'finance', 'systems', 'exit_interview']);
    const items = c.config.items.map((i: { code: string }) => (i.code === 'systems' ? { ...i, approver: 'role', roleId: ids.itRole } : i));
    const body = {
      ...c.config, items, eosAccountId: acc['4110202001'], leaveAccountId: acc['4110200101'], otherAccountId: acc['4110200701'],
      stages: [{ name: 'مراجعة المالية', roleId: ids.finRole }, { name: 'اعتماد المدير التنفيذي', roleId: null }],
    };
    await http.put(`${H}/separation-config`).set(as(tk.admin)).send({ ...body, eosAccountId: acc['41102'] }).expect(400);
    await http.put(`${H}/separation-config`).set(as(tk.admin)).send({ ...body, items: [{ name: 'بند', approver: 'role' }] }).expect(400);
    await http.put(`${H}/separation-config`).set(as(tk.hr)).send(body).expect(403);
    const saved = (await http.put(`${H}/separation-config`).set(as(tk.admin)).send(body).expect(200)).body;
    expect(saved.config.stages).toHaveLength(2);
  });

  it('an advance taken before leaving is settled from the dues later', async () => {
    types = (await http.get(`${H}/me`).set(as(tk.emp)).expect(200)).body.types;
    expect(types.map((t) => t.code)).toContain('resignation');
    const r = (await submit('emp', { typeId: T('advance'), data: { amount: 3000, installments: 3, reason: 'ظرف طارئ' } }).expect(201)).body;
    await decide('mgr', r.id, 'approve').expect(200);
    await decide('hr', r.id, 'approve').expect(200);
    const done = (await decide('admin', r.id, 'approve').expect(200)).body;
    expect(done.status).toBe('approved');
  });

  it('resignation from self-service needs notice, follows the chain, then opens the clearance file', async () => {
    await submit('emp', { typeId: T('resignation'), data: { lastWorkingDay: day(10), reason: 'فرصة أخرى' } }).expect(400);
    await submit('emp', { typeId: T('resignation'), data: { lastWorkingDay: day(40) } }).expect(400);
    const r = (await submit('emp', { typeId: T('resignation'), data: { lastWorkingDay: day(40), reason: 'الانتقال لمدينة أخرى' } }).expect(201)).body;
    expect(r.steps.map((s: { approverName: string | null; kind: string }) => s.approverName ?? s.kind)).toEqual(['مدير البرامج', 'المدير التنفيذي', 'hr']);
    await decide('mgr', r.id, 'approve').expect(200);
    await decide('admin', r.id, 'approve').expect(200);
    const done = (await decide('hr', r.id, 'approve', 'تُفتح إجراءات إخلاء الطرف').expect(200)).body;
    expect(done.status).toBe('approved');
    ids.sep = done.result.separationId;
    expect(ids.sep).toBeTruthy();
    const s = (await http.get(`${H}/separations/${ids.sep}`).set(as(tk.hr)).expect(200)).body;
    expect(s).toMatchObject({ status: 'clearance', reason: 'resignation', lastWorkingDay: day(40), fromRequest: true, items: expect.any(Array) });
    const who = Object.fromEntries(s.items.map((i: { code: string; approverName: string | null; kind: string }) => [i.code, i.approverName ?? i.kind]));
    expect(who).toEqual({ handover: 'مدير البرامج', assets: 'hr', finance: 'مدير البرامج', systems: 'role', exit_interview: 'hr' });
    // قبل اكتمال الإخلاء: معاينة المستحقات لشؤون الموظفين فقط
    expect(s.preview.eos.factor).toBeCloseTo(2 / 3);
    expect(s.preview.advancesTotal).toBe(3000);
    // ملف واحد مفتوح للموظف، ولا إنهاء مباشر للخدمة أثناءه
    await http.post(`${H}/separations`).set(as(tk.hr)).send({ employeeId: ids.empE, reason: 'mutual', lastWorkingDay: day(30) }).expect(409);
    await http.post(`${H}/employees/${ids.empE}/terminate`).set(as(tk.admin)).send({ terminationDate: day(30), reason: 'mutual' }).expect(409);
    // ولا طلب استقالة ثانٍ
    await submit('emp', { typeId: T('resignation'), data: { lastWorkingDay: day(60), reason: 'x' } }).expect(400);
  });

  it('who can see the file: HR, item owners and the employee, not other staff', async () => {
    await http.get(`${H}/separations/${ids.sep}`).set(as(tk.other)).expect(403);
    const own = (await http.get(`${H}/separations/${ids.sep}`).set(as(tk.emp)).expect(200)).body;
    expect(own.viewer.owner).toBe(true);
    expect(own.items.every((i: { can: boolean }) => !i.can)).toBe(true);
    const it = (await http.get(`${H}/separations/${ids.sep}`).set(as(tk.it)).expect(200)).body;
    expect(it.items.filter((i: { can: boolean }) => i.can).map((i: { code: string }) => i.code)).toEqual(['systems']);
    expect(it.preview).toBeNull();
    const d = (await http.get(`${H}/me`).set(as(tk.emp)).expect(200)).body;
    expect(d.separation).toMatchObject({ id: ids.sep, items: 5, cleared: 0 });
  });

  it('each responsible clears their own items; deductions need a reason; blocking needs a note', async () => {
    // المدير يرى بنوده في الجرس وفي قائمة الإخلاء
    const bell = (await http.get('/api/tasks').set(as(tk.mgr)).expect(200)).body;
    const hrGroup = bell.groups.find((g: { module: string }) => g.module === 'hr');
    expect(hrGroup.items.filter((i: { group: string }) => i.group === 'إخلاء الطرف')).toHaveLength(2);
    expect((await http.get(`${H}/me/clearance`).set(as(tk.mgr)).expect(200)).body).toHaveLength(2);

    await item('emp', 'handover', { decision: 'clear' }).expect(403);
    await item('hr', 'handover', { decision: 'clear' }).expect(403);
    await item('it', 'assets', { decision: 'clear' }).expect(403);
    await item('mgr', 'handover', { decision: 'clear', deduction: 100, note: 'x' }).expect(400);
    await item('mgr', 'handover', { decision: 'clear', note: 'سُلمت الملفات' }).expect(200);
    await item('mgr', 'finance', { decision: 'block' }).expect(400);
    await item('mgr', 'finance', { decision: 'block', note: 'عهدة نقدية 500 لم تُسوّ' }).expect(200);
    await http.post(`${H}/separations/${ids.sep}/settle`).set(as(tk.hr)).send({}).expect(400);
    await item('mgr', 'finance', { decision: 'clear', note: 'سُويت العهدة' }).expect(200);
    await item('hr', 'assets', { decision: 'clear', deduction: 300 }).expect(400);
    await item('hr', 'assets', { decision: 'clear', deduction: 300, note: 'بطاقة دخول مفقودة' }).expect(200);
    await item('it', 'systems', { decision: 'clear', note: 'أُوقفت الحسابات' }).expect(200);
    await item('hr', 'exit_interview', { decision: 'clear' }).expect(200);
    const s = (await http.get(`${H}/separations/${ids.sep}`).set(as(tk.hr)).expect(200)).body;
    expect(s.cleared).toBe(5);
    expect(s.can.settle).toBe(true);
    expect(s.history.map((h: { action: string }) => h.action)).toEqual(expect.arrayContaining(['create', 'clear', 'block']));
  });

  it('the dues statement: EOS by reason, leave encashment, advance and clearance deductions', async () => {
    await http.post(`${H}/separations/${ids.sep}/settle`).set(as(tk.fin)).send({}).expect(403);
    await http.post(`${H}/separations/${ids.sep}/settle`).set(as(tk.hr)).send({ adjustments: [{ kind: 'addition', label: 'x', amount: -5 }] }).expect(400);
    const s = (await http.post(`${H}/separations/${ids.sep}/settle`).set(as(tk.hr)).send({
      adjustments: [{ kind: 'addition', label: 'مكافأة إنجاز المشروع', amount: 1000 }],
    }).expect(200)).body;
    expect(s.status).toBe('settlement');
    const st = s.settlement;
    expect(st.eos.factor).toBeCloseTo(2 / 3);
    expect(st.advancesTotal).toBe(3000);
    expect(st.clearanceDeductions).toBe(300);
    expect(st.gross).toBeCloseTo(st.eos.amount + st.leaveEncashment + 1000, 2);
    expect(st.net).toBeCloseTo(st.gross - 3300, 2);
    expect(s.plan.problems).toEqual([]);
    expect(s.stages.map((x: { current: boolean }) => x.current)).toEqual([true, false]);
  });

  it('segregation of duties: the preparer cannot approve; return sends it back for recalculation', async () => {
    const own = (await http.post(`${H}/separations/${ids.sep}/decision`).set(as(tk.hr)).send({ decision: 'approve' }).expect(403)).body;
    expect(own.message).toContain('معد بيان المستحقات');
    await http.post(`${H}/separations/${ids.sep}/decision`).set(as(tk.mgr)).send({ decision: 'approve' }).expect(403);
    await http.post(`${H}/separations/${ids.sep}/decision`).set(as(tk.fin)).send({ decision: 'approve', note: 'مطابق' }).expect(200);
    // بعد بدء الاعتماد لا يُعدل البيان
    await http.post(`${H}/separations/${ids.sep}/settle`).set(as(tk.hr)).send({}).expect(409);
    await http.post(`${H}/separations/${ids.sep}/decision`).set(as(tk.fin)).send({ decision: 'return' }).expect(400);
    await http.post(`${H}/separations/${ids.sep}/decision`).set(as(tk.fin)).send({ decision: 'return', note: 'احذف المكافأة غير المعتمدة' }).expect(200);
    const s = (await http.post(`${H}/separations/${ids.sep}/settle`).set(as(tk.hr)).send({ adjustments: [] }).expect(200)).body;
    expect(s.settlement.adjustments).toEqual([]);
    ids.net = String(s.settlement.net);
    await http.post(`${H}/separations/${ids.sep}/decision`).set(as(tk.fin)).send({ decision: 'approve' }).expect(200);
  });

  it('final approval ends the service, settles the advance and posts a balanced entry', async () => {
    const s = (await http.post(`${H}/separations/${ids.sep}/decision`).set(as(tk.fin)).send({ decision: 'approve', note: 'يُصرف' }).expect(200)).body;
    expect(s.status).toBe('approved');
    expect(s.entry.entryNo).toBeGreaterThan(0);
    const e = (await http.get(`${H}/employees/${ids.empE}`).set(as(tk.admin)).expect(200)).body;
    expect(e).toMatchObject({ status: 'terminated', terminationDate: day(40), terminationReason: 'resignation' });
    expect(e.eosAmount).toBe(s.settlement.eos.amount);
    const adv = (await http.get(`${H}/advances`).set(as(tk.hr)).expect(200)).body;
    expect(adv.find((a: { employeeId: string }) => a.employeeId === ids.empE).remaining).toBe(0);
    const entry = (await http.get(`${A}/entries/${s.entry.id}`).set(as(tk.admin)).expect(200)).body;
    const lines = entry.lines as { accountCode: string; debit: number; credit: number; analytic: { code: string }[] }[];
    const sum = (k: 'debit' | 'credit') => Math.round(lines.reduce((x, l) => x + l[k], 0) * 100) / 100;
    expect(sum('debit')).toBe(sum('credit'));
    expect(lines.find((l) => l.accountCode === '4110202001')!.analytic[0].code).toBe('CC01');
    expect(lines.find((l) => l.accountCode === '2140100101')!.credit).toBe(Number(ids.net));
    expect(lines.filter((l) => l.accountCode === '1140100401').reduce((x, l) => x + l.credit, 0)).toBe(3300);
    await http.post(`${H}/separations/${ids.sep}/cancel`).set(as(tk.hr)).send({ note: 'x' }).expect(409);
  });

  it('payout voucher goes to the financial system for its own approvals', async () => {
    await http.post(`${H}/separations/${ids.sep}/pay`).set(as(tk.fin)).send({}).expect(403);
    const s = (await http.post(`${H}/separations/${ids.sep}/pay`).set(as(tk.admin)).send({ voucherDate: day(0) }).expect(200)).body;
    expect(s.status).toBe('paid');
    expect(s.voucher).toMatchObject({ amount: Number(ids.net), status: 'draft' });
    await http.post(`${H}/separations/${ids.sep}/pay`).set(as(tk.admin)).send({}).expect(409);
  });

  it('HR opens a file directly, lists it, and can cancel it before approval', async () => {
    const s = (await http.post(`${H}/separations`).set(as(tk.hr)).send({ employeeId: ids.otherE, reason: 'contract_end', lastWorkingDay: day(15), note: 'انتهاء العقد' }).expect(201)).body;
    expect(s.separationNo).toBe(2);
    await http.post(`${H}/separations`).set(as(tk.hr)).send({ employeeId: ids.otherE, reason: 'bad', lastWorkingDay: day(15) }).expect(400);
    const list = (await http.get(`${H}/separations`).set(as(tk.hr)).expect(200)).body;
    expect(list.rows.map((r: { status: string }) => r.status)).toEqual(['clearance', 'paid']);
    await http.get(`${H}/separations`).set(as(tk.other)).expect(403);
    await http.post(`${H}/separations/${s.id}/cancel`).set(as(tk.hr)).send({}).expect(400);
    expect((await http.post(`${H}/separations/${s.id}/cancel`).set(as(tk.hr)).send({ note: 'جُدد العقد' }).expect(200)).body.status).toBe('cancelled');
  });
});
