import { Test } from '@nestjs/testing';
import { NestExpressApplication } from '@nestjs/platform-express';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/main';
import { defaultPolicy, endOfService, gosi, performanceScore } from '../src/modules/hr/hr-policy';

/**
 * الموارد البشرية: اللائحة بإصداراتها، الهيكل المرن، سلم الرواتب والجدارات والأوصاف الوظيفية واعتمادها،
 * خطط التعيين وتكلفتها، الموظف وحدود المرتبة، التأمينات بالنظامين، نهاية الخدمة، الإجازات وأرصدتها،
 * بطاقة الأداء من الإعداد حتى الاعتماد، مسير الرواتب، وإنهاء الخدمة.
 */
const DB = process.env.TEST_DATABASE_URL ?? 'postgres://erp:erp@localhost:5432/charity_erp_test';
const ago = (days: number) => new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);

describe('HR calculations', () => {
  const p = defaultPolicy();
  const w = { basic: 8000, housing: 2000, transport: 800, others: 0 };

  it('GOSI under the old and new systems', () => {
    const old = gosi(p, w, true, '2020-01-01', '2026-11-15');
    expect(old.base).toBe(10000);
    expect(old.employee.total).toBe(975);
    expect(old.employer.total).toBe(1175);
    const nw = gosi(p, w, true, '2025-01-01', '2026-11-15');
    expect(nw.rates.pension).toBe(10);
    expect(nw.employee.total).toBe(1075);
    const expat = gosi(p, w, false, null, '2026-11-15');
    expect(expat.employee.total).toBe(0);
    expect(expat.employer.total).toBe(200);
    expect(gosi(p, { basic: 60000, housing: 0, transport: 0, others: 0 }, true, null, '2026-01-01').base).toBe(45000);
  });

  it('end of service by reason and years', () => {
    const r = endOfService(p, 10000, '2020-01-01', '2022-12-31', 'resignation');
    expect(r.fullAmount).toBeCloseTo(15013.7, 0);
    expect(r.amount).toBeCloseTo(15013.7 / 3, 0);
    expect(endOfService(p, 10000, '2023-01-01', '2024-06-30', 'resignation').amount).toBe(0);
    const long = endOfService(p, 10000, '2010-01-01', '2021-12-31', 'contract_end');
    expect(long.firstPart).toBe(25000);
    expect(long.amount).toBeGreaterThan(90000);
    expect(endOfService(p, 10000, '2010-01-01', '2021-12-31', 'article80').amount).toBe(0);
  });

  it('performance score with weights and bands', () => {
    const s = performanceScore(p, 70, [{ weight: 60, achievement: 100 }, { weight: 40, achievement: 50 }], [{ requiredLevel: 4, rating: 4 }, { requiredLevel: 4, rating: 2 }]);
    expect(s.objectivesScore).toBe(80);
    expect(s.competenciesScore).toBe(75);
    expect(s.finalScore).toBe(78.5);
    expect(s.rating).toBe('جيد');
  });
});

describe('HR', () => {
  let app: NestExpressApplication;
  let http: ReturnType<typeof request>;
  let admin: string;
  let clerk: string;
  let uploadDir: string;
  const as = (t: string) => ({ Authorization: `Bearer ${t}` });
  const login = async (login: string, password: string, organization?: string) =>
    (await http.post('/api/auth/login').send({ login, password, organization }).expect(200)).body.accessToken as string;
  const H = '/api/hr';
  const ids: Record<string, string> = {};
  const year = Number(new Date().toISOString().slice(0, 4));

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
      name: 'موظف شؤون الموظفين', permissions: ['hr.dashboard.read', 'hr.leaves.manage', 'hr.performance.manage'],
    }).expect(201);
    await http.post('/api/users').set(as(admin)).send({ fullName: 'موظف الشؤون', email: 'clerk@test.org', password: 'Clerk12345', roleIds: [role.body.id] }).expect(201);
    clerk = await login('clerk@test.org', 'Clerk12345', 'albir');
  });

  afterAll(async () => {
    await app.get(DataSource).destroy();
    await app.close();
    rmSync(uploadDir, { recursive: true, force: true });
  });

  it('policy has Saudi defaults and saves new versions', async () => {
    const r = await http.get(`${H}/policy`).set(as(admin)).expect(200);
    expect(r.body.current).toBeNull();
    expect(r.body.policy.leaveTypes.find((t: { code: string }) => t.code === 'annual').days).toBe(21);
    const policy = { ...r.body.policy, work: { ...r.body.policy.work, probationDays: 200 } };
    await http.put(`${H}/policy`).set(as(admin)).send({ policy, effectiveDate: '2026-01-01' }).expect(400);
    const ok = { ...r.body.policy, performance: { ...r.body.policy.performance, objectivesWeight: 70 } };
    const saved = await http.put(`${H}/policy`).set(as(admin)).send({ policy: ok, effectiveDate: '2026-01-01', note: 'اعتماد مجلس الإدارة' }).expect(200);
    expect(saved.body.current.version).toBe(1);
    await http.put(`${H}/policy`).set(as(clerk)).send({ policy: ok, effectiveDate: '2026-01-01' }).expect(403);
  });

  it('flexible structure levels and units', async () => {
    await http.put(`${H}/settings`).set(as(admin)).send({ structureLevels: ['المدير التنفيذي', 'إدارة', 'قسم'] }).expect(200);
    ids.top = (await http.post(`${H}/units`).set(as(admin)).send({ name: 'الإدارة التنفيذية', level: 0 }).expect(201)).body.id;
    // تسلسل مرن: قسم يتبع الإدارة العليا مباشرة بدون إدارة وسيطة
    ids.hrDept = (await http.post(`${H}/units`).set(as(admin)).send({ name: 'قسم الموارد البشرية', level: 2, parentId: ids.top }).expect(201)).body.id;
    ids.programs = (await http.post(`${H}/units`).set(as(admin)).send({ name: 'إدارة البرامج', level: 1, parentId: ids.top, costCenter: 'البرامج' }).expect(201)).body.id;
    await http.post(`${H}/units`).set(as(admin)).send({ name: 'خطأ', level: 1, parentId: ids.hrDept }).expect(400);
    await http.post(`${H}/units`).set(as(admin)).send({ name: 'بدون أب', level: 1 }).expect(400);
    await http.put(`${H}/settings`).set(as(admin)).send({ structureLevels: ['المدير التنفيذي', 'إدارة'] }).expect(400);
    const s = await http.get(`${H}/structure`).set(as(admin)).expect(200);
    expect(s.body.units).toHaveLength(3);
    expect(s.body.units.find((u: { id: string }) => u.id === ids.hrDept).levelName).toBe('قسم');
  });

  it('grades, competencies and approved job descriptions', async () => {
    ids.grade = (await http.post(`${H}/grades`).set(as(admin)).send({
      code: 'G5', name: 'أخصائي', structureLevel: 2, minSalary: 7000, maxSalary: 11000, steps: 5, stepIncrement: 5,
      allowances: [{ code: 'housing', name: 'بدل السكن', kind: 'percent', value: 25 }, { code: 'transport', name: 'بدل النقل', kind: 'percent', value: 10 }],
    }).expect(201)).body.id;
    await http.post(`${H}/grades`).set(as(admin)).send({ code: 'G6', name: 'خطأ', minSalary: 9000, maxSalary: 8000, steps: 1, stepIncrement: 0, allowances: [] }).expect(400);
    const g = await http.get(`${H}/grades`).set(as(admin)).expect(200);
    expect(g.body[0].scale[1].basic).toBe(7350);
    expect(g.body[0].scale[0].gross).toBe(9450);
    ids.comp = (await http.post(`${H}/competencies`).set(as(admin)).send({
      name: 'التواصل الفعّال', kind: 'core', levels: [1, 2, 3, 4, 5].map((level) => ({ level, description: `مستوى ${level}` })),
    }).expect(201)).body.id;
    const job = {
      title: 'أخصائي اجتماعي', unitId: ids.programs, gradeId: ids.grade, headcount: 3, purpose: 'دراسة حالات المستفيدين',
      responsibilities: ['إجراء الزيارات الميدانية', 'إعداد البحث الاجتماعي'], qualifications: 'بكالوريوس خدمة اجتماعية', experienceYears: 2,
      competencies: [{ competencyId: ids.comp, level: 4 }],
      kpis: [{ title: 'عدد الحالات المدروسة', weight: 60, target: '40', unit: 'حالة' }, { title: 'رضا المستفيدين', weight: 30, target: '85%' }],
    };
    await http.post(`${H}/jobs`).set(as(admin)).send(job).expect(400);
    job.kpis[1].weight = 40;
    const created = await http.post(`${H}/jobs`).set(as(admin)).send(job).expect(201);
    ids.job = created.body.id;
    const j = await http.get(`${H}/jobs/${ids.job}`).set(as(admin)).expect(200);
    expect(j.body.code).toBe('JOB-001');
    expect(j.body.qualityCode).toBe('QF-HR-JD-001');
    expect(j.body.competencies[0].levelDescription).toBe('مستوى 4');
    await http.post(`${H}/jobs/${ids.job}/approve`).set(as(clerk)).expect(403);
    expect((await http.post(`${H}/jobs/${ids.job}/approve`).set(as(admin)).expect(201)).body.revision).toBe(0);
    await http.patch(`${H}/jobs/${ids.job}`).set(as(admin)).send({ ...job, headcount: 4 }).expect(200);
    expect((await http.post(`${H}/jobs/${ids.job}/approve`).set(as(admin)).expect(201)).body.revision).toBe(1);
    await http.delete(`${H}/jobs/${ids.job}`).set(as(admin)).expect(409);
    ids.managerJob = (await http.post(`${H}/jobs`).set(as(admin)).send({ ...job, title: 'مدير البرامج', headcount: 1, kpis: [], competencies: [] }).expect(201)).body.id;
  });

  it('staffing plans with estimated cost', async () => {
    ids.plan = (await http.post(`${H}/plans`).set(as(admin)).send({
      year, jobId: ids.managerJob, count: 1, plannedMonth: 1, fundingSource: 'grant', fundingNote: 'منحة مؤسسة خيرية', forSaudi: true,
    }).expect(201)).body.id;
    await http.post(`${H}/plans/${ids.plan}/submit`).set(as(admin)).expect(400);
    await http.post(`${H}/jobs/${ids.managerJob}/approve`).set(as(admin)).expect(201);
    await http.post(`${H}/plans/${ids.plan}/submit`).set(as(admin)).expect(201);
    await http.post(`${H}/plans/${ids.plan}/decision`).set(as(admin)).send({ decision: 'reject' }).expect(400);
    await http.post(`${H}/plans/${ids.plan}/decision`).set(as(admin)).send({ decision: 'approve' }).expect(201);
    const r = await http.get(`${H}/plans?year=${year}`).set(as(admin)).expect(200);
    const item = r.body.items[0];
    expect(item.monthlyCost.gross).toBe(9450);
    expect(item.monthlyCost.total).toBeGreaterThan(9450);
    expect(item.annualCost).toBe(Math.round(item.monthlyCost.total * 12 * 100) / 100);
    expect(r.body.totals.positions).toBe(1);
  });

  const employee = (over: Record<string, unknown> = {}) => ({
    fullName: 'سارة أحمد العتيبي', nationalId: '1012345678', nationality: 'سعودية', isSaudi: true, gender: 'female', jobId: ids.job,
    hireDate: ago(365), contractType: 'fixed', contractStart: ago(365), contractEnd: ago(-365), qiwaStatus: 'documented',
    basicSalary: 8000, allowances: [{ code: 'housing', name: 'بدل السكن', amount: 2000 }, { code: 'transport', name: 'بدل النقل', amount: 800 }],
    gosiFirstRegistration: '2020-01-01', iban: 'SA0380000000608010167519', ...over,
  });

  it('employees respect grade limits and get a salary breakdown', async () => {
    await http.post(`${H}/employees`).set(as(admin)).send(employee({ basicSalary: 15000 })).expect(400);
    await http.post(`${H}/employees`).set(as(admin)).send(employee({ nationalId: '2012345678' })).expect(400);
    const r = await http.post(`${H}/employees`).set(as(admin)).send(employee()).expect(201);
    ids.emp = r.body.id;
    await http.post(`${H}/employees`).set(as(admin)).send(employee({ fullName: 'مكرر الهوية' })).expect(409);
    ids.emp2 = (await http.post(`${H}/employees`).set(as(admin)).send(employee({
      fullName: 'محمد علي القحطاني', nationalId: '1098765432', gender: 'male', jobId: ids.managerJob, basicSalary: 12000, salaryException: 'خبرة طويلة',
      hireDate: ago(30), contractStart: ago(30), gosiFirstRegistration: ago(30), managerId: null,
    })).expect(201)).body.id;
    const p = await http.get(`${H}/employees/${ids.emp}`).set(as(admin)).expect(200);
    expect(p.body.employeeNo).toBe(1);
    expect(p.body.probationEnd).toBe(ago(365 - 89));
    expect(p.body.breakdown.gross).toBe(10800);
    expect(p.body.breakdown.gosi.employee.total).toBe(975);
    expect(p.body.breakdown.net).toBe(9825);
    expect(p.body.eos.resignation.amount).toBe(0);
    // من لا يملك صلاحية الرواتب لا يرى المبالغ
    const hidden = await http.get(`${H}/employees/${ids.emp}`).set(as(clerk)).expect(200);
    expect(hidden.body.basicSalary).toBeNull();
    expect(hidden.body.breakdown).toBeNull();
    await http.get(`${H}/payroll`).set(as(clerk)).expect(403);
  });

  it('leave balances and requests follow the policy', async () => {
    const b = (await http.get(`${H}/employees/${ids.emp}/balances`).set(as(admin)).expect(200)).body;
    const annual = b.find((x: { code: string }) => x.code === 'annual');
    expect(annual.entitlement).toBeCloseTo(21, 0);
    expect(b.find((x: { code: string }) => x.code === 'paternity')).toBeUndefined();
    expect(b.find((x: { code: string }) => x.code === 'hajj').available).toBe(0);
    await http.post(`${H}/leaves`).set(as(clerk)).send({ employeeId: ids.emp, leaveType: 'annual', startDate: ago(-10), endDate: ago(-40) }).expect(400);
    await http.post(`${H}/leaves`).set(as(clerk)).send({ employeeId: ids.emp, leaveType: 'annual', startDate: ago(-10), endDate: ago(-35) }).expect(400);
    const ok = await http.post(`${H}/leaves`).set(as(clerk)).send({ employeeId: ids.emp, leaveType: 'annual', startDate: ago(-10), endDate: ago(-19) }).expect(201);
    expect(ok.body.days).toBe(10);
    await http.post(`${H}/leaves`).set(as(clerk)).send({ employeeId: ids.emp, leaveType: 'sick', startDate: ago(-15), endDate: ago(-16) }).expect(409);
    await http.post(`${H}/leaves`).set(as(clerk)).send({ employeeId: ids.emp2, leaveType: 'maternity', startDate: ago(-1), endDate: ago(-2) }).expect(400);
    await http.post(`${H}/leaves/${ok.body.id}/decision`).set(as(clerk)).send({ decision: 'approve' }).expect(403);
    await http.post(`${H}/leaves/${ok.body.id}/decision`).set(as(admin)).send({ decision: 'approve' }).expect(201);
    const after = (await http.get(`${H}/employees/${ids.emp}/balances`).set(as(admin)).expect(200)).body.find((x: { code: string }) => x.code === 'annual');
    expect(after.taken).toBe(10);
    ids.unpaid = (await http.post(`${H}/leaves`).set(as(admin)).send({ employeeId: ids.emp, leaveType: 'unpaid', startDate: ago(5), endDate: ago(4) }).expect(201)).body.id;
    await http.post(`${H}/leaves/${ids.unpaid}/decision`).set(as(admin)).send({ decision: 'approve' }).expect(201);
  });

  it('payroll preview deducts unpaid leave and prorates new hires', async () => {
    const month = ago(4).slice(0, 7);
    const r = await http.get(`${H}/payroll?month=${month}`).set(as(admin)).expect(200);
    const line = r.body.lines.find((l: { id: string }) => l.id === ids.emp);
    expect(line.unpaidDays).toBeGreaterThanOrEqual(1);
    expect(line.unpaidDeduction).toBe(Math.round(line.unpaidDays * 360 * 100) / 100);
    expect(r.body.totals.employees).toBeGreaterThanOrEqual(1);
  });

  it('performance card from target to approval', async () => {
    const gen = await http.post(`${H}/performance/generate?year=${year}`).set(as(clerk)).expect(201);
    expect(gen.body.created).toBe(2);
    const list = (await http.get(`${H}/performance?year=${year}`).set(as(admin)).expect(200)).body;
    const cardId = list.cards.find((c: { employeeId: string }) => c.employeeId === ids.emp).id;
    let c = (await http.get(`${H}/performance/${cardId}`).set(as(admin)).expect(200)).body;
    expect(c.objectives).toHaveLength(2);
    expect(c.objectives[0].target).toBe('40 حالة');
    expect(c.competencies[0].requiredLevel).toBe(4);
    await http.post(`${H}/performance/${cardId}/action`).set(as(clerk)).send({ action: 'evaluate' }).expect(400);
    await http.post(`${H}/performance/${cardId}/action`).set(as(clerk)).send({ action: 'agree' }).expect(201);
    await http.post(`${H}/performance/${cardId}/action`).set(as(clerk)).send({ action: 'evaluate' }).expect(400);
    c = (await http.patch(`${H}/performance/${cardId}`).set(as(clerk)).send({
      objectives: c.objectives.map((o: Record<string, unknown>, i: number) => ({ ...o, achievement: i === 0 ? 100 : 50 })),
      competencies: [{ competencyId: ids.comp, requiredLevel: 4, rating: 3 }], managerNote: 'أداء جيد',
    }).expect(200)).body;
    expect(c.preview.objectivesScore).toBe(80);
    expect(c.preview.competenciesScore).toBe(75);
    await http.post(`${H}/performance/${cardId}/action`).set(as(clerk)).send({ action: 'evaluate' }).expect(201);
    await http.post(`${H}/performance/${cardId}/action`).set(as(clerk)).send({ action: 'approve' }).expect(403);
    const done = await http.post(`${H}/performance/${cardId}/action`).set(as(admin)).send({ action: 'approve' }).expect(201);
    expect(done.body.status).toBe('approved');
    expect(done.body.finalScore).toBe(78.5);
    expect(done.body.rating).toBe('جيد');
  });

  it('dashboard alerts and termination settlement', async () => {
    const d = (await http.get(`${H}/dashboard`).set(as(admin)).expect(200)).body;
    expect(d.headcount).toBe(2);
    expect(d.saudization).toBe(100);
    expect(d.payroll.gross).toBeGreaterThan(0);
    expect(d.vacancies).toBe(3);
    const calc = await http.post(`${H}/eos/calculate`).set(as(admin)).send({ wage: 10000, startDate: '2020-01-01', endDate: '2022-12-31', reason: 'resignation' }).expect(200);
    expect(calc.body.eos.factor).toBeCloseTo(1 / 3, 3);
    const s = await http.post(`${H}/employees/${ids.emp2}/terminate`).set(as(admin)).send({ terminationDate: ago(0), reason: 'employer_termination' }).expect(201);
    expect(s.body.eos.amount).toBeGreaterThan(0);
    expect(s.body.total).toBe(Math.round((s.body.eos.amount + s.body.leaveEncashment) * 100) / 100);
    await http.patch(`${H}/employees/${ids.emp2}`).set(as(admin)).send(employee()).expect(400);
    const list = (await http.get(`${H}/employees?status=terminated`).set(as(admin)).expect(200)).body;
    expect(list).toHaveLength(1);
  });
});
