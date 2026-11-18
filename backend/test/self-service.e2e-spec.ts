import { Test } from '@nestjs/testing';
import { NestExpressApplication } from '@nestjs/platform-express';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/main';
import { checkStartDate, DEFAULT_RULES, reportingLine, renderLetter } from '../src/modules/hr/self-service';

/**
 * الخدمة الذاتية للموظفين: ربط الحساب بالملف، أنواع الطلبات وقيودها المرنة، مسار الاعتماد حسب التبعية
 * في الهيكل، المرفقات، الإرجاع وإعادة التقديم، أثر الاعتماد (الإجازة والسلفة والخطاب)، لوحة المدير، وجرس المهام.
 */
const DB = process.env.TEST_DATABASE_URL ?? 'postgres://erp:erp@localhost:5432/charity_erp_test';
const day = (n: number) => new Date(Date.now() + 3 * 3600000 + n * 86400000).toISOString().slice(0, 10);

describe('self-service rules', () => {
  it('start date: no backdating, grace days, notice and horizon', () => {
    const t = '2026-11-18';
    expect(() => checkStartDate(DEFAULT_RULES, '2026-11-17', t)).toThrow('قبل تاريخ اليوم');
    expect(() => checkStartDate({ ...DEFAULT_RULES, allowPastDays: 3 }, '2026-11-15', t)).not.toThrow();
    expect(() => checkStartDate({ ...DEFAULT_RULES, allowPastDays: 3 }, '2026-11-14', t)).toThrow('المسموح 3');
    expect(() => checkStartDate({ ...DEFAULT_RULES, minNoticeDays: 7 }, '2026-11-20', t)).toThrow('قبل 7');
    expect(() => checkStartDate({ ...DEFAULT_RULES, maxFutureDays: 30 }, '2027-01-30', t)).toThrow('بعيد');
  });

  it('reporting line: explicit manager, unit manager, then the unit above', () => {
    const units = [
      { id: 'u0', parentId: null, managerEmployeeId: 'ceo', level: 0 },
      { id: 'u1', parentId: 'u0', managerEmployeeId: 'head', level: 1 },
      { id: 'u2', parentId: 'u1', managerEmployeeId: null, level: 2 },
    ];
    const emps = [
      { id: 'ceo', managerId: null, unitId: 'u0', status: 'active' as const },
      { id: 'head', managerId: null, unitId: 'u1', status: 'active' as const },
      { id: 'a', managerId: null, unitId: 'u2', status: 'active' as const },
      { id: 'b', managerId: 'a', unitId: 'u2', status: 'active' as const },
    ];
    const l = reportingLine(emps, units);
    expect(l.managerOf('head')).toBe('ceo');
    expect(l.managerOf('a')).toBe('head');
    expect(l.chain('b')).toEqual(['a', 'head', 'ceo']);
    expect(l.team('head').sort()).toEqual(['a', 'b']);
    expect(l.unitHead({ id: 'b', unitId: 'u2' }, 1)).toBe('head');
    expect(l.top()).toBe('ceo');
  });

  it('letters fill known variables and keep unknown ones', () => {
    expect(renderLetter('السيد {اسم_الموظف} {غير_معروف}', { اسم_الموظف: 'سعد' })).toBe('السيد سعد {غير_معروف}');
  });
});

describe('Employee self-service', () => {
  let app: NestExpressApplication;
  let http: ReturnType<typeof request>;
  let uploadDir: string;
  const tk: Record<string, string> = {};
  const ids: Record<string, string> = {};
  const as = (t: string) => ({ Authorization: `Bearer ${t}` });
  const login = async (login: string, password: string, organization?: string) =>
    (await http.post('/api/auth/login').send({ login, password, organization }).expect(200)).body.accessToken as string;
  const H = '/api/hr';
  const pdf = Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF');
  let types: { id: string; code: string; kind: string }[] = [];
  const T = (code: string) => types.find((t) => t.code === code)!.id;
  const submit = (who: string, payload: unknown, file = false) => {
    const req = http.post(`${H}/me/requests`).set(as(tk[who])).field('payload', JSON.stringify(payload));
    return file ? req.attach('files', pdf, 'report.pdf') : req;
  };
  const decide = (who: string, id: string, decision: string, note?: string) => http.post(`${H}/me/requests/${id}/decision`).set(as(tk[who])).send({ decision, note });

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
      name: 'جمعية النور', slug: 'nour', adminFullName: 'المدير التنفيذي', adminEmail: 'ceo@nour.org', adminPassword: 'Admin12345',
    }).expect(201);
    tk.admin = await login('ceo@nour.org', 'Admin12345', 'nour');
    const hrRole = (await http.post('/api/roles').set(as(tk.admin)).send({ name: 'شؤون الموظفين', permissions: ['hr.requests.read', 'hr.requests.approve'] }).expect(201)).body.id;
    const user = async (key: string, fullName: string, roleIds: string[] = []) => {
      ids[`${key}User`] = (await http.post('/api/users').set(as(tk.admin)).send({ fullName, email: `${key}@nour.org`, password: 'Pass12345', roleIds }).expect(201)).body.id;
      tk[key] = await login(`${key}@nour.org`, 'Pass12345', 'nour');
    };
    await user('mgr', 'مديرة البرامج');
    await user('emp', 'موظف البرامج');
    await user('expat', 'محاسب وافد');
    await user('hr', 'موظفة شؤون الموظفين', [hrRole]);
    const me = (await http.get('/api/auth/me').set(as(tk.admin)).expect(200)).body.user;
    ids.adminUser = me.id;

    ids.top = (await http.post(`${H}/units`).set(as(tk.admin)).send({ name: 'الإدارة التنفيذية', level: 0 }).expect(201)).body.id;
    ids.dept = (await http.post(`${H}/units`).set(as(tk.admin)).send({ name: 'إدارة البرامج', level: 1, parentId: ids.top }).expect(201)).body.id;
    const job = await http.post(`${H}/jobs`).set(as(tk.admin)).send({
      title: 'أخصائي برامج', unitId: ids.dept, headcount: 5, purpose: 'تنفيذ البرامج', responsibilities: ['التنفيذ'], qualifications: 'بكالوريوس', experienceYears: 1,
      competencies: [], kpis: [{ title: 'الإنجاز', weight: 100, target: '100%' }],
    }).expect(201);
    ids.job = job.body.id;
    let n = 0;
    const emp = async (fullName: string, userId: string | null, over: Record<string, unknown> = {}) => {
      n++;
      const saudi = over.isSaudi !== false;
      return (await http.post(`${H}/employees`).set(as(tk.admin)).send({
        fullName, nationalId: `${saudi ? 1 : 2}0000000${String(n).padStart(2, '0')}`, nationality: saudi ? 'سعودي' : 'مصري', isSaudi: saudi, gender: 'male', jobId: ids.job,
        hireDate: day(-500), contractType: 'indefinite', contractStart: day(-500), qiwaStatus: 'documented', basicSalary: 8000,
        allowances: [{ code: 'housing', name: 'بدل السكن', amount: 2000 }], userId, ...over,
      }).expect(201)).body.id as string;
    };
    ids.ceo = await emp('المدير التنفيذي', ids.adminUser, { unitId: ids.top });
    ids.mgrE = await emp('مديرة البرامج', ids.mgrUser, { gender: 'female' });
    ids.empE = await emp('موظف البرامج', ids.empUser);
    ids.expatE = await emp('محاسب وافد', ids.expatUser, { isSaudi: false });
    await http.post(`${H}/employees`).set(as(tk.admin)).send({}).expect(400);
    await http.patch(`${H}/units/${ids.top}`).set(as(tk.admin)).send({ name: 'الإدارة التنفيذية', level: 0, managerEmployeeId: ids.ceo }).expect(200);
    await http.patch(`${H}/units/${ids.dept}`).set(as(tk.admin)).send({ name: 'إدارة البرامج', level: 1, parentId: ids.top, managerEmployeeId: ids.mgrE }).expect(200);
   }, 60_000);

  afterAll(async () => {
    await app.get(DataSource).destroy();
    await app.close();
    rmSync(uploadDir, { recursive: true, force: true });
  });

  it('only accounts linked to an employee file reach self-service, and a user links to one employee only', async () => {
    expect((await http.get(`${H}/me/summary`).set(as(tk.hr)).expect(200)).body.linked).toBe(false);
    await http.get(`${H}/me`).set(as(tk.hr)).expect(403);
    const s = (await http.get(`${H}/me/summary`).set(as(tk.mgr)).expect(200)).body;
    expect(s).toMatchObject({ linked: true, isManager: true, team: 2 });
    const users = (await http.get(`${H}/users`).set(as(tk.admin)).expect(200)).body;
    expect(users.find((u: { id: string }) => u.id === ids.empUser).employeeId).toBe(ids.empE);
    const p = (await http.get(`${H}/employees/${ids.expatE}`).set(as(tk.admin)).expect(200)).body;
    await http.patch(`${H}/employees/${ids.expatE}`).set(as(tk.admin)).send({
      fullName: p.fullName, nationalId: p.nationalId, nationality: p.nationality, isSaudi: false, gender: 'male', jobId: ids.job, hireDate: p.hireDate,
      contractType: 'indefinite', contractStart: p.contractStart, qiwaStatus: 'documented', basicSalary: 8000, allowances: [{ code: 'housing', name: 'بدل السكن', amount: 2000 }],
      userId: ids.empUser,
    }).expect(409);
  });

  it('dashboard shows service time, balances, salary, attendance and the request catalog', async () => {
    const d = (await http.get(`${H}/me`).set(as(tk.emp)).expect(200)).body;
    expect(d.employee.managerName).toBe('مديرة البرامج');
    expect(d.service.years).toBe(1);
    expect(d.salary.gross).toBe(10000);
    expect(d.balances.find((b: { code: string }) => b.code === 'annual').available).toBeGreaterThan(20);
    types = d.types;
    expect(types.map((t) => t.code)).toEqual(expect.arrayContaining(['leave', 'sick_leave', 'permission', 'salary_certificate', 'advance', 'general']));
    expect(types.some((t) => t.code === 'exit_reentry')).toBe(false);
    expect(d.manager.isManager).toBe(false);
  });

  it('leave: no backdating, notice days, then manager and HR approve along the reporting line', async () => {
    await submit('emp', { typeId: T('leave'), data: { leaveType: 'annual', startDate: day(-1), endDate: day(2) } }).expect(400);
    await submit('emp', { typeId: T('leave'), data: { leaveType: 'annual', startDate: day(1), endDate: day(2) } }).expect(400);
    const r = (await submit('emp', { typeId: T('leave'), data: { leaveType: 'annual', startDate: day(10), endDate: day(14), note: 'سفر' } }).expect(201)).body;
    expect(r.status).toBe('pending');
    expect(r.steps.map((s: { approverName: string | null; kind: string }) => s.approverName ?? s.kind)).toEqual(['مديرة البرامج', 'hr']);
    expect(r.balance.pending).toBe(5);
    ids.leaveReq = r.id;
    await decide('emp', r.id, 'approve').expect(403);
    await decide('hr', r.id, 'approve').expect(403);
    // المدير يرى الطلب في جرس المهام وفي لوحة فريقه
    const bell = (await http.get('/api/tasks').set(as(tk.mgr)).expect(200)).body;
    expect(bell.total).toBe(1);
    expect(bell.groups[0].items[0].link).toBe(`/me/requests/${r.id}`);
    const team = (await http.get(`${H}/me/team`).set(as(tk.mgr)).expect(200)).body;
    expect(team.members.map((m: { fullName: string }) => m.fullName).sort()).toEqual(['محاسب وافد', 'موظف البرامج']);
    expect(team.awaiting).toHaveLength(1);
    await decide('mgr', r.id, 'approve').expect(200);
    expect((await http.get('/api/tasks').set(as(tk.mgr)).expect(200)).body.total).toBe(0);
    expect((await http.get('/api/tasks').set(as(tk.hr)).expect(200)).body.total).toBe(1);
    const done = (await decide('hr', r.id, 'approve').expect(200)).body;
    expect(done.status).toBe('approved');
    const leaves = (await http.get(`${H}/leaves`).set(as(tk.admin)).expect(200)).body.requests;
    expect(leaves[0]).toMatchObject({ status: 'approved', days: 5 });
  });

  it('sick leave accepts recent past dates and requires the medical report', async () => {
    await submit('emp', { typeId: T('sick_leave'), data: { leaveType: 'sick', startDate: day(-2), endDate: day(-1) } }).expect(400);
    await submit('emp', { typeId: T('sick_leave'), data: { leaveType: 'sick', startDate: day(-9), endDate: day(-8) } }, true).expect(400);
    const r = (await submit('emp', { typeId: T('sick_leave'), data: { leaveType: 'sick', startDate: day(-2), endDate: day(-1) } }, true).expect(201)).body;
    expect(r.attachments).toHaveLength(1);
    const f = await http.get(`${H}/me/requests/${r.id}/attachments/${r.attachments[0].id}`).set(as(tk.mgr)).expect(200);
    expect(f.headers['content-type']).toContain('application/pdf');
    await http.get(`${H}/me/requests/${r.id}`).set(as(tk.expat)).expect(403);
    // قرار شؤون الموظفين من شاشة الإجازات يغلق الطلب نفسه
    const leave = (await http.get(`${H}/leaves?status=pending`).set(as(tk.admin)).expect(200)).body.requests[0];
    await http.post(`${H}/leaves/${leave.id}/decision`).set(as(tk.admin)).send({ decision: 'approve' }).expect(201);
    const after = (await http.get(`${H}/me/requests/${r.id}`).set(as(tk.emp)).expect(200)).body;
    expect(after.status).toBe('approved');
    expect(after.steps[0].onBehalf).toBe(true);
  });

  it('permission: hours per kind and the monthly quota', async () => {
    const date = day(1);
    await submit('emp', { typeId: T('permission'), data: { permissionKind: 'early', date, fromTime: '12:00', toTime: '15:00' } }).expect(400);
    const a = (await submit('emp', { typeId: T('permission'), data: { permissionKind: 'personal', date, fromTime: '09:00', toTime: '12:00' } }).expect(201)).body;
    expect(a.data.hours).toBe(3);
    await submit('emp', { typeId: T('permission'), data: { permissionKind: 'personal', date: day(2), fromTime: '09:00', toTime: '12:00' } }).expect(201);
    const over = await submit('emp', { typeId: T('permission'), data: { permissionKind: 'personal', date: day(3), fromTime: '09:00', toTime: '12:00' } });
    // الحد الشهري 8 ساعات (إلا إذا وقعت التواريخ في شهرين مختلفين)
    if (date.slice(0, 7) === day(3).slice(0, 7)) expect(over.status).toBe(400);
  });

  it('exit and re-entry is for non-Saudis only, one open request at a time', async () => {
    const types2 = (await http.get(`${H}/me/types`).set(as(tk.expat)).expect(200)).body as { id: string; code: string }[];
    const id = types2.find((t) => t.code === 'exit_reentry')!.id;
    await submit('emp', { typeId: id, data: { visaType: 'single', travelDate: day(20), returnDate: day(40), destination: 'القاهرة' } }).expect(400);
    await submit('expat', { typeId: id, data: { visaType: 'single', travelDate: day(3), returnDate: day(40), destination: 'القاهرة' } }).expect(400);
    const r = (await submit('expat', { typeId: id, data: { visaType: 'multiple', travelDate: day(20), returnDate: day(40), destination: 'القاهرة', dependents: 2 } }).expect(201)).body;
    expect(r.summary).toContain('متعددة');
    await submit('expat', { typeId: id, data: { visaType: 'single', travelDate: day(60), returnDate: day(70), destination: 'جدة' } }).expect(400);
  });

  it('a returned request is edited and resubmitted, then rejected with a reason', async () => {
    await submit('emp', { typeId: T('general'), fields: { subject: 'عهدة' } }).expect(400);
    const r = (await submit('emp', { typeId: T('general'), fields: { subject: 'عهدة', details: 'جهاز حاسب' } }).expect(201)).body;
    await decide('mgr', r.id, 'return').expect(400);
    expect((await decide('mgr', r.id, 'return', 'حدد المواصفات').expect(200)).body.status).toBe('returned');
    const bell = (await http.get('/api/tasks').set(as(tk.emp)).expect(200)).body;
    expect(bell.groups[0].items.some((i: { group: string }) => i.group === 'طلباتي المعادة')).toBe(true);
    const again = (await http.patch(`${H}/me/requests/${r.id}`).set(as(tk.emp)).field('payload', JSON.stringify({ fields: { subject: 'عهدة', details: 'حاسب محمول بذاكرة 16' } })).expect(200)).body;
    expect(again.status).toBe('pending');
    expect(again.history.map((h: { action: string }) => h.action)).toEqual(['submit', 'return', 'resubmit']);
    await decide('mgr', r.id, 'approve').expect(200);
    expect((await decide('hr', r.id, 'reject', 'لا تتوفر أجهزة').expect(200)).body.status).toBe('rejected');
  });

  it('salary certificate is issued with the chosen template and the employee data', async () => {
    const r = (await submit('emp', { typeId: T('salary_certificate'), data: { templateId: 'salary', addressee: 'السفارة' } }).expect(201)).body;
    expect(r.steps).toHaveLength(1);
    const done = (await decide('hr', r.id, 'approve').expect(200)).body;
    expect(done.can.print).toBe(true);
    expect(done.result.body).toContain('موظف البرامج');
    expect(done.result.body).toContain('10,000 ريال');
    expect(done.result.body).toContain('السفارة');
    expect(done.result.letterNo).toMatch(/^\d{4}\/\d{4}$/);
  });

  it('advance: limit by salary, approval up to the top manager, and repayment through payroll', async () => {
    await submit('emp', { typeId: T('advance'), data: { amount: 25000, installments: 5, reason: 'زواج' } }).expect(400);
    await submit('emp', { typeId: T('advance'), data: { amount: 6000, installments: 12, reason: 'زواج' } }).expect(400);
    const r = (await submit('emp', { typeId: T('advance'), data: { amount: 6000, installments: 4, reason: 'زواج' } }).expect(201)).body;
    expect(r.steps.map((s: { kind: string; status: string }) => `${s.kind}:${s.status}`)).toEqual(['direct_manager:waiting', 'hr:waiting', 'top_manager:waiting']);
    await decide('mgr', r.id, 'approve').expect(200);
    await decide('hr', r.id, 'approve').expect(200);
    const done = (await decide('admin', r.id, 'approve').expect(200)).body;
    expect(done.status).toBe('approved');
    expect(done.advance).toMatchObject({ amount: 6000, installmentAmount: 1500, remaining: 6000 });
    await submit('emp', { typeId: T('advance'), data: { amount: 1000, installments: 1, reason: 'أخرى' } }).expect(400);
    const d = (await http.get(`${H}/me`).set(as(tk.emp)).expect(200)).body;
    expect(d.advances.remaining).toBe(6000);
    const all = (await http.get(`${H}/advances`).set(as(tk.hr)).expect(200)).body;
    expect(all).toHaveLength(1);
  });

  it('custom request types with fields, a role step and attachment rules', async () => {
    const lookups = (await http.get(`${H}/request-types`).set(as(tk.admin)).expect(200)).body.lookups;
    const hrRole = lookups.roles.find((r: { name: string }) => r.name === 'شؤون الموظفين').id;
    await http.post(`${H}/request-types`).set(as(tk.hr)).send({}).expect(403);
    await http.post(`${H}/request-types`).set(as(tk.admin)).send({ name: 'بلا مسار', kind: 'general', approval: [], fields: [{ label: 'س', type: 'text' }] }).expect(400);
    await http.post(`${H}/request-types`).set(as(tk.admin)).send({
      name: 'خطأ', kind: 'general', approval: [{ kind: 'direct_manager' }], fields: [{ label: 'س', type: 'text' }], rules: { minNoticeDays: 2, allowPastDays: 2 },
    }).expect(400);
    const t = (await http.post(`${H}/request-types`).set(as(tk.admin)).send({
      name: 'طلب تدريب خارجي', kind: 'general', category: 'التطوير', color: '#0ea5e9',
      approval: [{ kind: 'direct_manager' }, { kind: 'role', roleId: hrRole, name: 'التدريب' }],
      fields: [{ label: 'اسم الدورة', type: 'text', required: true }, { label: 'تاريخ البداية', type: 'date', required: true }, { label: 'الجهة', type: 'select', options: ['داخلية', 'خارجية'], required: true }],
      rules: { minNoticeDays: 5, attachment: 'required', attachmentHint: 'عرض الدورة' },
    }).expect(201)).body;
    const k = (key: number) => t.fields[key].key;
    await submit('emp', { typeId: t.id, fields: { [k(0)]: 'إدارة المشاريع', [k(1)]: day(10), [k(2)]: 'خارجية' } }).expect(400);
    await submit('emp', { typeId: t.id, fields: { [k(0)]: 'إدارة المشاريع', [k(1)]: day(2), [k(2)]: 'خارجية' } }, true).expect(400);
    await submit('emp', { typeId: t.id, fields: { [k(0)]: 'إدارة المشاريع', [k(1)]: day(10), [k(2)]: 'أخرى' } }, true).expect(400);
    const r = (await submit('emp', { typeId: t.id, fields: { [k(0)]: 'إدارة المشاريع', [k(1)]: day(10), [k(2)]: 'خارجية' } }, true).expect(201)).body;
    expect(r.summary).toBe('طلب تدريب خارجي: إدارة المشاريع');
    await decide('mgr', r.id, 'approve').expect(200);
    expect(r.steps[1].kind).toBe('role');
    expect((await decide('hr', r.id, 'approve').expect(200)).body.status).toBe('approved');
    await http.delete(`${H}/request-types/${t.id}`).set(as(tk.admin)).expect(409);
  });

  it('a manager submits to the top manager and sees only their own team', async () => {
    const r = (await submit('mgr', { typeId: T('permission'), data: { permissionKind: 'official', date: day(1), fromTime: '09:00', toTime: '11:00' } }).expect(201)).body;
    expect(r.steps[0].approverName).toBe('المدير التنفيذي');
    await http.get(`${H}/me/team/${ids.ceo}`).set(as(tk.mgr)).expect(403);
    const m = (await http.get(`${H}/me/team/${ids.empE}`).set(as(tk.mgr)).expect(200)).body;
    expect(m.employee.nationalId).toBeNull();
    expect(m.requests.length).toBeGreaterThan(3);
    const ceoTeam = (await http.get(`${H}/me/team`).set(as(tk.admin)).expect(200)).body;
    expect(ceoTeam.stats.team).toBe(3);
    expect(ceoTeam.awaiting.map((x: { id: string }) => x.id)).toContain(r.id);
    const hrList = (await http.get(`${H}/requests?status=pending`).set(as(tk.hr)).expect(200)).body;
    expect(hrList.rows.every((x: { status: string }) => x.status === 'pending')).toBe(true);
    await http.get(`${H}/requests`).set(as(tk.emp)).expect(403);
    await http.post(`${H}/me/requests/${r.id}/cancel`).set(as(tk.emp)).expect(403);
    expect((await http.post(`${H}/me/requests/${r.id}/cancel`).set(as(tk.mgr)).expect(200)).body.status).toBe('cancelled');
  });
});
