import { Test } from '@nestjs/testing';
import { NestExpressApplication } from '@nestjs/platform-express';
import ExcelJS from 'exceljs';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/main';

/**
 * استيراد الخطة الاستراتيجية من Excel: تحليلا PESTEL وSWOT واستراتيجيات TOWS والمخاطر المرتبطة بعواملها،
 * ثم الخطة الاستراتيجية بعناصرها ومؤشراتها وروابطها بالمخاطر والعوامل، ثم خطة تشغيلية تتبعها، ثم بنود الموازنة.
 * الفحص لا يحفظ شيئًا، والحفظ كله أو لا شيء، والتكرار لا يُنشئ نسخًا، والصلاحيات وعزل الشركات.
 */
const DB = process.env.TEST_DATABASE_URL ?? 'postgres://erp:erp@localhost:5432/charity_erp_test';
const Y = new Date().getUTCFullYear() + 1;

type Cell = string | number;
async function book(sheets: Record<string, Cell[][]>) {
  const wb = new ExcelJS.Workbook();
  for (const [name, rows] of Object.entries(sheets)) { const ws = wb.addWorksheet(name); rows.forEach((r) => ws.addRow(r)); }
  return Buffer.from(await wb.xlsx.writeBuffer());
}

const FACTOR_HEAD = ['الرمز *', 'العامل *', 'النص *', 'الأثر *', 'الاحتمالية *', 'الاتجاه', 'ملاحظة'];
const RISK_HEAD = ['الرمز', 'عنوان الخطر', 'المصدر', 'التصنيف', 'المسؤول', 'الاحتمالية الكامنة', 'الأثر الكامن', 'الاحتمالية المتبقية', 'الأثر المتبقي', 'المعالجة', 'إجراءات المعالجة', 'مؤشرات الإنذار المبكر', 'رمز العامل في التحليل'];
const riskBook = (risks: Cell[][], extra: Record<string, Cell[][]> = {}) => book({
  'البيانات العامة': [['الحقل', 'القيمة'], ['عنوان تحليل PESTEL', 'PESTEL الخطة'], ['عنوان تحليل SWOT', 'SWOT الخطة'], ['تاريخ التحليل', `${Y - 1}-11-22`], ['النطاق', 'الشركة']],
  PESTEL: [FACTOR_HEAD, ['PL1', 'سياسية', 'رؤية 2030 للقطاع غير الربحي', 5, 5, 'متصاعد', ''], ['LG1', 'قانونية وتنظيمية', 'الفوترة الإلكترونية', 4, 5, 'متصاعد', '']],
  SWOT: [FACTOR_HEAD, ['S1', 'قوة', 'ملكية الجمعية', 5, 5, 'مستقر', ''], ['W1', 'ضعف', 'رأس مال محدود', 5, 5, 'مستقر', '']],
  TOWS: [['النوع', 'الاستراتيجية'], ['WO', 'دخل ثابت من الجمعية']],
  المخاطر: [RISK_HEAD, ...risks],
  ...extra,
});
const GOOD_RISKS: Cell[][] = [
  ['R01', 'نقص السيولة', 'داخلي', 'مالية', 'المدير المالي', 4, 5, 3, 4, 'تخفيف', `دفعة مقدمة | المدير المالي | ${Y}-01-31\nتوقع نقدي | المحاسب | ${Y}-02-28`, 'النقد بالأشهر | أقل من شهرين', 'W1'],
  ['R02', 'مخالفة الفوترة الإلكترونية', 'خارجي', 'نظامية والتزام', 'المحاسب', 3, 4, 2, 3, 'تخفيف', '', '', 'LG1'],
];

describe('Strategy, risk and budget import from Excel', () => {
  let app: NestExpressApplication;
  let http: ReturnType<typeof request>;
  let db: DataSource;
  let admin: string;
  let clerk: string;
  let viewer: string;
  let adminB: string;
  let orgA: string;
  const as = (t: string) => ({ Authorization: `Bearer ${t}` });
  const login = async (login: string, password: string, organization?: string) =>
    (await http.post('/api/auth/login').send({ login, password, organization }).expect(200)).body.accessToken as string;
  const up = (url: string, t: string, buf: Buffer, mode: string) => http.post(url).set(as(t)).attach('file', buf, 'pack.xlsx').field('mode', mode);
  const n = async (table: string, org = orgA) => Number((await db.query(`SELECT count(*)::int AS n FROM ${table} WHERE organization_id = $1`, [org]))[0].n);

  beforeAll(async () => {
    Object.assign(process.env, {
      DATABASE_URL: DB, JWT_SECRET: 'test-secret', UPLOAD_DIR: '/tmp/rw-test-uploads',
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
    db = app.get(DataSource);
    const platform = await login('admin', 'Platform123');
    const mk = async (slug: string) => (await http.post('/api/platform/organizations').set(as(platform)).send({
      name: `شركة ${slug}`, slug, adminFullName: `مدير ${slug}`, adminEmail: `owner@${slug}.sa`, adminPassword: 'Owner12345',
    }).expect(201)).body.id as string;
    orgA = await mk('pack-a');
    await mk('pack-b');
    admin = await login('owner@pack-a.sa', 'Owner12345', 'pack-a');
    adminB = await login('owner@pack-b.sa', 'Owner12345', 'pack-b');
    const role = async (name: string, permissions: string[]) => (await http.post('/api/roles').set(as(admin)).send({ name, permissions }).expect(201)).body.id;
    const planner = await role('مخطط', [
      'risk.dashboard.read', 'risk.register.manage', 'risk.analysis.manage', 'planning.dashboard.read', 'planning.strategic.manage', 'planning.operational.manage',
      'planning.budgets.manage', 'planning.budgets.hr',
    ]);
    const reader = await role('مشاهد', ['risk.dashboard.read', 'planning.dashboard.read']);
    await http.post('/api/users').set(as(admin)).send({ fullName: 'المخطط', email: 'clerk@pack-a.sa', password: 'Clerk12345', roleIds: [planner] }).expect(201);
    await http.post('/api/users').set(as(admin)).send({ fullName: 'المشاهد', email: 'viewer@pack-a.sa', password: 'View12345', roleIds: [reader] }).expect(201);
    clerk = await login('clerk@pack-a.sa', 'Clerk12345', 'pack-a');
    viewer = await login('viewer@pack-a.sa', 'View12345', 'pack-a');
  }, 240000);

  afterAll(async () => {
    await db.destroy();
    await app.close();
  });

  const RI = '/api/risk/analyses/import';
  const PI = '/api/planning/plans/import';

  it('templates and imports need the module permissions', async () => {
    await http.get(`${RI}/template`).set(as(viewer)).expect(403);
    await http.get(`${PI}/template`).set(as(viewer)).expect(403);
    await http.get('/api/planning/budget-lines/import/template').set(as(viewer)).expect(403);
    await up(RI, viewer, await riskBook(GOOD_RISKS), 'check').expect(403);
    await up(PI, viewer, await book({ الخطة: [['الحقل', 'القيمة']] }), 'check').expect(403);
    const t = await http.get(`${RI}/template`).set(as(clerk)).buffer(true).parse((res, cb) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => cb(null, Buffer.concat(chunks)));
    }).expect(200);
    expect(t.headers['content-disposition']).toContain('attachment');
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(t.body as ArrayBuffer);
    expect(wb.worksheets.map((w) => w.name)).toEqual(['التعليمات', 'البيانات العامة', 'PESTEL', 'SWOT', 'TOWS', 'المخاطر']);
    await http.get(`${PI}/template`).set(as(clerk)).expect(200);
    await http.get('/api/planning/budget-lines/import/template').set(as(clerk)).expect(200);
  });

  it('rejects non-xlsx files', async () => {
    const r = await http.post(RI).set(as(clerk)).attach('file', Buffer.from('not excel'), 'pack.xlsx').field('mode', 'check').expect(400);
    expect(r.body.message).toContain('Excel');
    await http.post(RI).set(as(clerk)).attach('file', Buffer.from('a,b'), 'pack.csv').field('mode', 'check').expect(400);
  });

  it('reports every row error and saves nothing while errors remain', async () => {
    const bad = await riskBook([
      ...GOOD_RISKS,
      ['R03', 'متبقٍ أعلى من الكامن', 'داخلي', 'مالية', '', 2, 2, 4, 4, 'تخفيف', '', '', ''],
      ['R04', 'تصنيف غير معروف', 'داخلي', 'غير موجود', '', 2, 2, 1, 1, 'تخفيف', '', '', ''],
      ['R05', 'مربوط بنقطة قوة', 'داخلي', 'مالية', '', 2, 2, 1, 1, 'تخفيف', '', '', 'S1'],
      ['R06', 'قبول فوق الحد دون مبرر', 'داخلي', 'مالية', '', 4, 4, 4, 4, 'قبول', '', '', ''],
    ]);
    const r = (await up(RI, clerk, bad, 'apply').expect(201)).body;
    expect(r.ok).toBe(false);
    const msgs = (row: string) => r.errors.find((e: { label: string }) => e.label === row)?.messages.join(' ') ?? '';
    expect(msgs('R03')).toContain('المتبقي لا يكون أعلى');
    expect(msgs('R04')).toContain('غير معرّف');
    expect(msgs('R05')).toContain('نقاط القوة');
    expect(msgs('R06')).toContain('المبرر');
    expect(r.created).toEqual({ analyses: 0, risks: 0 });
    expect(await n('risk_register')).toBe(0);
    expect(await n('risk_analyses')).toBe(0);
  });

  it('checks without saving, then imports analyses and linked risks in one go, and never duplicates', async () => {
    const file = await riskBook(GOOD_RISKS);
    const c = (await up(RI, clerk, file, 'check').expect(201)).body;
    expect(c.ok).toBe(true);
    expect(c.analyses.map((a: { kind: string; items: number; status: string }) => `${a.kind}:${a.items}:${a.status}`)).toEqual(['pestel:2:new', 'swot:2:new']);
    expect(c.risks.map((x: { residual: number; factorKey: string }) => `${x.residual}:${x.factorKey}`)).toEqual(['12:W1', '6:LG1']);
    expect(await n('risk_register')).toBe(0);

    const a = (await up(RI, clerk, file, 'apply').expect(201)).body;
    expect(a.created).toEqual({ analyses: 2, risks: 2 });
    const swot = (await http.get(`/api/risk/analyses/${a.analyses[1].id}`).set(as(clerk)).expect(200)).body;
    expect(swot.status).toBe('draft');
    expect(swot.strategies).toEqual([{ type: 'WO', text: 'دخل ثابت من الجمعية' }]);
    const w1 = swot.items.find((i: { text: string }) => i.text === 'رأس مال محدود');
    const risk = (await http.get(`/api/risk/risks/${a.risks[0].id}`).set(as(clerk)).expect(200)).body;
    expect(risk).toMatchObject({ title: 'نقص السيولة', inherentScore: 20, residualScore: 12, analysisId: swot.id, analysisItemId: w1.id, status: 'draft', category: 'financial' });
    expect(risk.actions.map((x: { title: string; dueDate: string }) => `${x.title}|${x.dueDate}`)).toEqual([`دفعة مقدمة|${Y}-01-31`, `توقع نقدي|${Y}-02-28`]);
    expect(risk.kris).toEqual([{ name: 'النقد بالأشهر', threshold: 'أقل من شهرين', current: null, breached: false }]);
    expect(w1.riskId).toBe(risk.id);

    const again = (await up(RI, clerk, file, 'apply').expect(201)).body;
    expect(again.created).toEqual({ analyses: 0, risks: 0 });
    expect(again.warnings.length).toBe(4);
    expect(await n('risk_register')).toBe(2);
  });

  it('keeps each company to its own data', async () => {
    const b = (await up(RI, adminB, await riskBook(GOOD_RISKS), 'check').expect(201)).body;
    expect(b.risks.every((r: { status: string }) => r.status === 'new')).toBe(true);
    expect((await http.get('/api/risk/risks').set(as(adminB)).expect(200)).body).toEqual([]);
  });

  const planBook = (extra: Record<string, Cell[][]> = {}, title = 'الخطة الاستراتيجية') => book({
    الخطة: [['الحقل', 'القيمة'], ['نوع الخطة', 'استراتيجية'], ['عنوان الخطة', title], ['سنة البداية', Y], ['سنة النهاية', Y + 3], ['دورية المتابعة', 'سنوية'],
      ['الرؤية', 'الريادة'], ['القيم', 'الشفافية\nالأمانة'], ['مالك الخطة', 'ماجد القادري'], ['المستويات', 'توجه استراتيجي | D\nهدف استراتيجي | G\nمبادرة | I']],
    العناصر: [['الرمز', 'الرمز الأب', 'العنوان', 'المسؤول', 'تاريخ البداية', 'تاريخ النهاية', `تكلفة ${Y}`, `تكلفة ${Y + 1}`],
      ['D1', '', 'الاستدامة المالية', 'المدير التنفيذي', '', '', '', ''],
      ['G1.1', 'D1', 'تنويع الإيرادات', 'سيد محمد سيد', '', '', '', ''],
      ['I1.1.1', 'G1.1', 'محفظة الخدمات', 'سيد محمد سيد', `${Y}-01-01`, `${Y}-06-30`, 8000, ''],
      ['I1.1.2', 'G1.1', 'التسويق', 'سيد محمد سيد', `${Y}-01-01`, `${Y + 3}-12-31`, 25000, 50000]],
    المؤشرات: [['رمز العنصر', 'اسم المؤشر', 'الوحدة', 'الاتجاه', 'دورية القياس', 'طريقة التجميع', 'خط الأساس', `مستهدف ${Y}`, `مستهدف ${Y + 1}`],
      ['G1.1', 'إجمالي الإيرادات', 'ريال', 'تصاعدي', 'سنوية', 'مجموع', '', 1230000, 1750000]],
    الروابط: [['رمز العنصر', 'النظام', 'المرجع', 'ملاحظة'],
      ['G1.1', 'سجل المخاطر', 'نقص السيولة', ''], ['G1.1', 'تحليل PESTEL وSWOT', 'رأس مال محدود', ''], ['G1.1', 'سجل المخاطر', 'خطر غير موجود', '']],
    ...extra,
  });

  it('imports a strategic plan with KPIs and links, and reports what it could not link', async () => {
    const bad = (await up(PI, clerk, await planBook({ العناصر: [['الرمز', 'الرمز الأب', 'العنوان'], ['D1', 'X9', 'يتيم']] }), 'apply').expect(201)).body;
    expect(bad.ok).toBe(false);
    expect(bad.errors[0].messages.join(' ')).toContain('X9');
    expect(await n('plan_plans')).toBe(0);

    // قبل اعتماد تحليل SWOT لا يُربط عامله، ويظهر تنبيه
    const c = (await up(PI, clerk, await planBook(), 'check').expect(201)).body;
    expect(c.ok).toBe(true);
    expect(c.items.map((i: { code: string }) => i.code)).toEqual(['D1', 'G1.1', 'I1.1.1', 'I1.1.2']);
    expect(c.links.map((l: { resolved: string | null }) => !!l.resolved)).toEqual([true, false, false]);
    expect(await n('plan_plans')).toBe(0);

    const swot = (await http.get('/api/risk/analyses').set(as(clerk)).expect(200)).body.find((a: { kind: string }) => a.kind === 'swot');
    await http.post(`/api/risk/analyses/${swot.id}/submit`).set(as(clerk)).expect(201);
    await http.post(`/api/risk/analyses/${swot.id}/decision`).set(as(admin)).send({ decision: 'approve' }).expect(201);

    const a = (await up(PI, clerk, await planBook(), 'apply').expect(201)).body;
    expect(a.ok).toBe(true);
    expect(a.links.map((l: { resolved: string | null }) => !!l.resolved)).toEqual([true, true, false]);
    const plan = (await http.get(`/api/planning/plans/${a.plan.id}`).set(as(clerk)).expect(200)).body;
    expect(plan).toMatchObject({ kind: 'strategic', status: 'draft', startYear: Y, endYear: Y + 3, values: ['الشفافية', 'الأمانة'], ownerName: 'ماجد القادري' });
    expect(plan.levels.map((l: { prefix: string }) => l.prefix)).toEqual(['D', 'G', 'I']);
    const [{ cost }] = await db.query(`SELECT (cost_by_year->>'${Y + 1}')::int AS cost FROM plan_items WHERE plan_id = $1 AND code = 'I1.1.2'`, [a.plan.id]);
    expect(cost).toBe(50000);
    const [{ targets }] = await db.query('SELECT targets FROM plan_kpis WHERE plan_id = $1', [a.plan.id]);
    expect(targets).toEqual({ [Y]: 1230000, [Y + 1]: 1750000 });
    const refs = await db.query('SELECT system, ref_label FROM plan_refs WHERE organization_id = $1 ORDER BY system', [orgA]);
    expect(refs.map((r: { system: string }) => r.system)).toEqual(['risk', 'risk_analysis']);

    const dup = (await up(PI, clerk, await planBook(), 'apply').expect(201)).body;
    expect(dup.ok).toBe(false);
    expect(dup.errors[0].messages[0]).toContain('توجد خطة');
    expect(await n('plan_plans')).toBe(1);
  });

  it('imports an operational plan under the strategic plan, then budget lines into a draft budget', async () => {
    const op = await book({
      الخطة: [['الحقل', 'القيمة'], ['نوع الخطة', 'تشغيلية'], ['عنوان الخطة', `الخطة التشغيلية ${Y}`], ['سنة البداية', Y], ['سنة النهاية', Y], ['الخطة الأم', 'الخطة الاستراتيجية']],
      العناصر: [['الرمز', 'الرمز الأب', 'العنوان', 'تاريخ البداية', 'تاريخ النهاية', `تكلفة ${Y}`], ['B1', '', 'محفظة الخدمات', '', '', ''], ['A1.1', 'B1', 'تصميم الدليل', `${Y}-01-01`, `${Y}-06-30`, 8000]],
      الروابط: [['رمز العنصر', 'النظام', 'المرجع', 'نسبة المساهمة'], ['B1', 'الخطة الأم', 'I1.1.1', 100]],
    });
    const r = (await up(PI, clerk, op, 'apply').expect(201)).body;
    expect(r.ok).toBe(true);
    const [{ n: links }] = await db.query('SELECT count(*)::int AS n FROM plan_links WHERE organization_id = $1 AND contribution = 100', [orgA]);
    expect(links).toBe(1);

    const LI = (id: string) => `/api/planning/budgets/${id}/lines/import`;
    const b = (await http.post('/api/planning/budgets').set(as(clerk)).send({ title: `موازنة ${Y}`, fiscalYear: Y }).expect(201)).body;
    const lines = await book({
      البنود: [['القسم', 'نوع البند', 'اسم البند', 'المبلغ السنوي', 'ملاحظة'],
        ['الإيرادات', 'مبلغ', 'الاستشارات', 440000, '8 مشاريع'], ['الموارد البشرية', 'مبلغ', 'أتعاب المتعاونين', 444000, ''], ['المصروفات التشغيلية', 'مبلغ', 'المراجع الخارجي', 25000, '']],
    });
    await up(LI(b.id), viewer, lines, 'check').expect(403);
    await up(LI(b.id), adminB, lines, 'check').expect(404);
    const c = (await up(LI(b.id), clerk, lines, 'check').expect(201)).body;
    expect(c.totals).toEqual({ revenue: 440000, hr: 444000, opex: 25000, activity: 0 });
    expect(await n('plan_budget_lines')).toBe(0);
    const a = (await up(LI(b.id), clerk, lines, 'apply').expect(201)).body;
    expect(a.ok).toBe(true);
    expect(await n('plan_budget_lines')).toBe(3);
    const again = (await up(LI(b.id), clerk, lines, 'apply').expect(201)).body;
    expect(again.warnings.length).toBe(3);
    expect(await n('plan_budget_lines')).toBe(3);
    const badKind = await book({ البنود: [['القسم', 'نوع البند', 'اسم البند', 'المبلغ السنوي'], ['الإيرادات', 'وظيفة', 'خطأ', 1]] });
    expect((await up(LI(b.id), clerk, badKind, 'apply').expect(201)).body.ok).toBe(false);
  });
});
