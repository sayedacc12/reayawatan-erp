import { Test } from '@nestjs/testing';
import { NestExpressApplication } from '@nestjs/platform-express';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/main';
import { defaultPolicy } from '../src/modules/hr/hr-policy';
import { computeHist, computeHr, distribute, finalize, historyYears, HistParams, HistSnapshot } from '../src/modules/planning/budget/budget-calc';
import { DEFAULT_VARIABLES } from '../src/modules/planning/budget/budget-defaults';
import { histDefaults } from '../src/modules/planning/budget/budgets.service';
import { FormulaError, run } from '../src/modules/planning/budget/formula-engine';

/**
 * الموازنات التقديرية (المرحلة الثانية من نظام التخطيط والموازنات):
 * محرك المعادلات الآمن، واحتساب الرواتب والمصروفات من التاريخ، ثم دورة كاملة عبر الواجهة البرمجية:
 * مكتبة المعادلات بإصدارات، موازنة ببنود يدوية ووظائف جديدة، صلاحية الرواتب، التعديل اليدوي بمبرر،
 * الاعتماد والإصدارات والمقارنة، و«المتاح» للصرف حسب قاعدة مصدر التمويل ثم بند الموازنة، والتقارير.
 */
const DB = process.env.TEST_DATABASE_URL ?? 'postgres://erp:erp@localhost:5432/charity_erp_test';
const Y = new Date().getUTCFullYear() + 1;

describe('Formula engine', () => {
  it('evaluates safely with functions, Arabic digits and traces used variables', () => {
    expect(run('IF(gross > 10000, gross * 0.1, 500) + ROUND(x / 3, 2)', { gross: 12000, x: 10 }).value).toBe(1203.33);
    expect(run('٢٫٥ * a', { a: 2 }).value).toBe(5);
    expect(run('CLAMP(t, -0.3, 0.3)', { t: 0.9 }).value).toBe(0.3);
    const r = run('a / b', { a: 5, b: 0 });
    expect(r.value).toBe(0);
    expect(r.warnings.length).toBe(1);
    expect(run('basic * 2', { basic: 3, unused: 9 }).used).toEqual({ basic: 3 });
    expect(() => run('missing + 1', {})).toThrow(FormulaError);
    expect(() => run('constructor.constructor("x")()', {})).toThrow(FormulaError);
    expect(() => run('process.exit(1)', {})).toThrow(FormulaError);
    expect(() => run('1 +', {})).toThrow(FormulaError);
  });
});

describe('Budget calculations', () => {
  const vars = DEFAULT_VARIABLES;
  it('computes an employee month by month with raise from its month and stepped variables', () => {
    const variables = vars.map((v) => (v.key === 'medical_monthly' ? { ...v, steps: [{ fromMonth: 7, value: 600 }] } : v));
    const line = {
      unitId: null,
      params: { jobTitle: 'محاسب', gradeName: null, isSaudi: false, firstRegistration: null, hireDate: '2020-01-01', basic: 10000, housing: 2500, transport: 500, other: 0, rating: null, ratingScore: null, count: 1, startMonth: 1, endMonth: 12, isNew: false },
    };
    const monthly = { code: 'HR_MONTHLY', version: 1, name: 'شهري', expression: 'gross * (1 + raise) + medical_monthly' };
    const r = computeHr(2027, { variables, raiseRules: [{ key: 'r', name: 'قاعدة', pct: 10, fromMonth: 4, appliesToNew: false, match: { unitId: null, gradeName: null, jobTitle: 'محاسب', rating: null, nationality: null } }] },
      line as never, defaultPolicy(), monthly, null);
    expect(r.monthly[0]).toBe(13000 + 450);
    expect(r.monthly[3]).toBe(14300 + 450);
    expect(r.monthly[6]).toBe(14300 + 600);
    expect(r.trace[0].label).toContain('10%');
    expect(r.auto).toBe(13450 * 3 + 14750 * 3 + 14900 * 6);
  });

  it('estimates from history with exclusions, annualizes the current year and adds contracts', () => {
    const h: HistSnapshot = {
      years: { 2025: 12000, 2026: 11000 }, months: { 2025: Array(12).fill(1000), 2026: [...Array(10).fill(1000), 1000, 0] },
      entries: [{ id: 'e1', date: '2025-05-10', description: 'إصلاح طارئ', amount: 2000 }], currentYear: 2026, currentMonths: 10, fetchedAt: '', source: 'test',
    };
    const p: HistParams = { ...histDefaults('X', 2), excludedEntryIds: ['e1'] };
    const ys = historyYears(h, p, 2027);
    expect(ys.map((y) => y.value)).toEqual([10000, 12000]);
    const f = { code: 'X', version: 2, name: 'نمو', expression: 'hist_avg * (1 + growth)' };
    const r = computeHist(2027, { variables: vars }, { unitId: null, section: 'opex', params: { ...p, contracts: [{ name: 'عقد', amount: 1200, fromMonth: 7, toMonth: 12, kind: 'new' }] } as never, history: h as never }, f);
    expect(r.auto).toBe(11000 * 1.03 + 600);
    expect(r.trace.find((t) => t.formulaCode === 'X')!.formulaVersion).toBe(2);
  });

  it('distributes and finalizes a management override on the same pattern', () => {
    expect(distribute(1200, 'even', null, null).every((x) => x === 100)).toBe(true);
    expect(distribute(100, 'even', null, null, 11, 12)).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 50, 50]);
    const f = finalize(1200, Array(12).fill(100), 600);
    expect(f.amount).toBe(600);
    expect(f.monthly[0]).toBe(50);
  });
});

describe('Budgets', () => {
  let app: NestExpressApplication;
  let http: ReturnType<typeof request>;
  let admin: string;
  let clerk: string;
  const as = (t: string) => ({ Authorization: `Bearer ${t}` });
  const login = async (login: string, password: string, organization?: string) =>
    (await http.post('/api/auth/login').send({ login, password, organization }).expect(200)).body.accessToken as string;
  const R = '/api/planning';
  const ids: Record<string, string> = {};

  beforeAll(async () => {
    Object.assign(process.env, {
      DATABASE_URL: DB, JWT_SECRET: 'test-secret', UPLOAD_DIR: mkdtempSync(join(tmpdir(), 'sanabel-uploads-')),
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
    const role = await http.post('/api/roles').set(as(admin)).send({ name: 'معد موازنة', permissions: ['planning.dashboard.read', 'planning.budgets.manage'] }).expect(201);
    await http.post('/api/users').set(as(admin)).send({ fullName: 'معد الموازنة', email: 'clerk@test.org', password: 'Clerk12345', roleIds: [role.body.id] }).expect(201);
    clerk = await login('clerk@test.org', 'Clerk12345', 'albir');
    ids.unit = (await http.post('/api/hr/units').set(as(admin)).send({ name: 'إدارة البرامج', level: 0 }).expect(201)).body.id;
  });

  afterAll(async () => { await app?.close(); });

  it('manages the formula library with versions and tests formulas without saving', async () => {
    const list = (await http.get(`${R}/formulas`).set(as(admin)).expect(200)).body;
    expect(list.formulas.map((f: { code: string }) => f.code)).toEqual(expect.arrayContaining(['HR_MONTHLY', 'HR_ANNUAL', 'OPEX_HIST', 'REV_HIST']));
    const t = (await http.post(`${R}/formulas/test`).set(as(admin)).send({ expression: 'hist_avg * (1 + growth)', target: 'opex', vars: { hist_avg: 1000 } }).expect(201)).body;
    expect(t.value).toBe(1030);
    await http.post(`${R}/formulas`).set(as(admin)).send({ code: 'OPEX_X', name: 'خاطئة', target: 'opex', expression: 'hist_avg *' }).expect(400);
    const f = (await http.post(`${R}/formulas`).set(as(admin)).send({ code: 'OPEX_X', name: 'نمو مضاعف', target: 'opex', expression: 'hist_avg * (1 + growth) * (1 + inflation)' }).expect(201)).body;
    const u = (await http.patch(`${R}/formulas/${f.id}`).set(as(admin)).send({ expression: 'hist_avg * (1 + growth * 2)', note: 'تشديد' }).expect(200)).body;
    expect(u.version).toBe(2);
    expect(u.history.length).toBe(2);
    ids.formula = f.id;
    await http.post(`${R}/formulas`).set(as(clerk)).send({ code: 'OPEX_Y', name: 'ممنوع', target: 'opex', expression: '1' }).expect(403);
  });

  it('builds a budget with manual lines and new positions, guarding salaries and overrides', async () => {
    const b = (await http.post(`${R}/budgets`).set(as(clerk)).send({ title: 'موازنة السنة القادمة', fiscalYear: Y }).expect(201)).body;
    ids.b = b.id;
    expect(b.code).toBe('BG-001');
    expect(b.status).toBe('draft');
    // معد الموازنة بلا صلاحية الرواتب لا يضيف بنود موارد بشرية
    await http.post(`${R}/budgets/${b.id}/lines`).set(as(clerk)).send({ section: 'hr', kind: 'new_position', name: 'أخصائي', params: { basic: 8000 } }).expect(403);
    await http.post(`${R}/budgets/${b.id}/import`).set(as(clerk)).send({ source: 'employees' }).expect(403);
    const hr = (await http.post(`${R}/budgets/${b.id}/lines`).set(as(admin)).send({
      section: 'hr', kind: 'new_position', name: 'أخصائي اجتماعي', unitId: ids.unit, params: { basic: 8000, housing: 2000, transport: 800, count: 2, startMonth: 7, isSaudi: true },
    }).expect(201)).body;
    expect(hr.monthly.slice(0, 6).every((x: number) => x === 0)).toBe(true);
    expect(hr.amount).toBeGreaterThan(2 * 6 * 10800);
    expect(hr.trace.some((t: { formulaCode?: string }) => t.formulaCode === 'HR_MONTHLY')).toBe(true);
    const opex = (await http.post(`${R}/budgets/${b.id}/lines`).set(as(clerk)).send({ section: 'opex', kind: 'manual', name: 'صيانة المبنى', unitId: ids.unit, params: { manualAmount: 120000 } }).expect(201)).body;
    ids.opex = opex.id;
    expect(opex.amount).toBe(120000);
    await http.patch(`${R}/budget-lines/${opex.id}`).set(as(clerk)).send({ overrideAmount: 100000 }).expect(400);
    const o = (await http.patch(`${R}/budget-lines/${opex.id}`).set(as(clerk)).send({ overrideAmount: 100000, overrideNote: 'ترشيد' }).expect(200)).body;
    expect(o.amount).toBe(100000);
    expect(o.auto).toBe(120000);
    await http.post(`${R}/budgets/${b.id}/lines`).set(as(clerk)).send({ section: 'revenue', kind: 'manual', name: 'منحة', params: { manualAmount: 500000 } }).expect(201);
    // الافتراضات وسقف الإدارة
    await http.patch(`${R}/budgets/${b.id}`).set(as(clerk)).send({ variables: [{ key: 'basic', name: 'محجوز', value: 1 }] }).expect(400);
    const up = (await http.patch(`${R}/budgets/${b.id}`).set(as(clerk)).send({ ceilings: [{ unitId: ids.unit, amount: 150000 }] }).expect(200)).body;
    expect(up.checks.some((c: { key: string }) => c.key === 'ceiling')).toBe(true);
    // من لا يملك صلاحية الرواتب يرى غير الموظفين الحاليين كما هم
    const view = (await http.get(`${R}/budgets/${b.id}`).set(as(clerk)).expect(200)).body;
    expect(view.canHr).toBe(false);
    expect(view.summary.expenses).toBe(Math.round((hr.amount + 100000) * 100) / 100);
    expect(view.summary.revenues).toBe(500000);
  });

  it('approves through the budget route, keeps versions and compares them', async () => {
    await http.post(`${R}/budgets/${ids.b}/submit`).set(as(clerk)).send({}).expect(201);
    await http.post(`${R}/budgets/${ids.b}/decision`).set(as(clerk)).send({ decision: 'approve' }).expect(403);
    let b = (await http.get(`${R}/budgets/${ids.b}`).set(as(admin)).expect(200)).body;
    expect(b.routeName).toBe('اعتماد الموازنة التقديرية');
    for (let i = 0; i < 5 && b.status === 'in_review'; i++) b = (await http.post(`${R}/budgets/${ids.b}/decision`).set(as(admin)).send({ decision: 'approve' }).expect(201)).body;
    expect(b.status).toBe('approved');
    expect(b.version).toBe(1);
    // تعديل بعد الاعتماد: مسودة، والإصدار المعتمد يبقى مرجع المتاح
    await http.patch(`${R}/budget-lines/${ids.opex}`).set(as(clerk)).send({ overrideAmount: 90000, overrideNote: 'ترشيد إضافي' }).expect(200);
    const av = (await http.get(`${R}/availability/lines/${ids.opex}`).set(as(clerk)).expect(200)).body;
    expect(av.budgeted).toBe(100000);
    const cmp = (await http.get(`${R}/budgets/${ids.b}/compare?from=1`).set(as(clerk)).expect(200)).body;
    expect(cmp.rows).toEqual([expect.objectContaining({ change: 'modified', name: 'صيانة المبنى', diff: -10000 })]);
    await http.post(`${R}/budgets/${ids.b}/discard`).set(as(clerk)).expect(201);
    b = (await http.get(`${R}/budgets/${ids.b}`).set(as(clerk)).expect(200)).body;
    expect(b.status).toBe('approved');
    expect(b.lines.find((l: { id: string }) => l.id === ids.opex).amount).toBe(100000);
    await http.delete(`${R}/budgets/${ids.b}`).set(as(clerk)).expect(409);
  });

  it('checks availability: budget line is the hard limit when there is no funding source', async () => {
    const ok = (await http.post(`${R}/availability/check`).set(as(clerk)).send({ amount: 60000, budgetLineId: ids.opex }).expect(201)).body;
    expect(ok).toMatchObject({ allowed: true, basis: 'budget', available: 100000 });
    const no = (await http.post(`${R}/availability/check`).set(as(clerk)).send({ amount: 100001, budgetLineId: ids.opex }).expect(201)).body;
    expect(no).toMatchObject({ allowed: false, basis: 'budget', shortfall: 1 });
    await http.post(`${R}/availability/check`).set(as(clerk)).send({ amount: 10, budgetLineId: ids.opex, fundingBatchId: '00000000-0000-4000-8000-000000000000' }).expect(404);
    await http.post(`${R}/availability/check`).set(as(clerk)).send({ amount: 10 }).expect(400);
    const list = (await http.get(`${R}/availability?year=${Y}`).set(as(clerk)).expect(200)).body;
    expect(list.lines.map((l: { lineId: string }) => l.lineId)).toContain(ids.opex);
  });

  it('serves budget reports', async () => {
    for (const code of ['planning.budget.lines', 'planning.budget.monthly', 'planning.budget.ceilings', 'planning.budget.hr']) {
      const r = (await http.get(`/api/reports/run/${code}?budgetId=${ids.b}`).set(as(admin)).expect(200)).body;
      expect(r.rows.length).toBeGreaterThan(0);
    }
    const f = (await http.get('/api/reports/run/planning.budget.formulas').set(as(admin)).expect(200)).body;
    expect(f.rows.find((x: { code: string }) => x.code === 'OPEX_X').version).toBe(2);
    await http.get(`/api/reports/run/planning.budget.hr?budgetId=${ids.b}`).set(as(clerk)).expect(403);
  });
});
