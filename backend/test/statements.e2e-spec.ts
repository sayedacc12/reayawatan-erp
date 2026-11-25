import { Test } from '@nestjs/testing';
import { NestExpressApplication } from '@nestjs/platform-express';
import { mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/main';

/**
 * إعداد الميزانية والقوائم المالية للمراجع، ومشروع توزيع الأرباح، وتقرير انحرافات الموازنة:
 * القوائم متوازنة ومن القيود المرحّلة فقط، والربط الافتراضي للدليل تلقائي ويُعدَّل يدويًا، والإصدار النهائي ممنوع قبل إغلاق الفترة،
 * وكل ذلك يحترم الصلاحيات وعزل الشركات.
 */
const DB = process.env.TEST_DATABASE_URL ?? 'postgres://erp:erp@localhost:5432/charity_erp_test';
const OUT = process.env.STATEMENTS_OUT;

describe('Financial statements, profit appropriation and budget variance', () => {
  let app: NestExpressApplication;
  let http: ReturnType<typeof request>;
  let admin: string;
  let adminB: string;
  let viewer: string;
  let reader: string;
  const as = (t: string) => ({ Authorization: `Bearer ${t}` });
  const login = async (l: string, password: string, organization?: string) =>
    (await http.post('/api/auth/login').send({ login: l, password, organization }).expect(200)).body.accessToken as string;
  const A = '/api/accounting';
  const S = `${A}/statements`;
  const ids: Record<string, string> = {};
  const acc: Record<string, string> = {};
  const q1 = () => ({ yearId: ids.year, span: 'Q', part: 1 });

  beforeAll(async () => {
    Object.assign(process.env, {
      DATABASE_URL: DB, JWT_SECRET: 'test-secret', UPLOAD_DIR: mkdtempSync(join(tmpdir(), 'rw-uploads-')),
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
    for (const slug of ['fs-a', 'fs-b']) {
      await http.post('/api/platform/organizations').set(as(platform)).send({
        name: `شركة ${slug}`, slug, adminFullName: `مدير ${slug}`, adminEmail: `owner@${slug}.sa`, adminPassword: 'Owner12345',
      }).expect(201);
    }
    admin = await login('owner@fs-a.sa', 'Owner12345', 'fs-a');
    adminB = await login('owner@fs-b.sa', 'Owner12345', 'fs-b');
    const role = async (name: string, permissions: string[]) => (await http.post('/api/roles').set(as(admin)).send({ name, permissions }).expect(201)).body.id;
    const user = async (email: string, roleId: string) => {
      await http.post('/api/users').set(as(admin)).send({ fullName: email, email, password: 'User123456', roleIds: [roleId] }).expect(201);
      return login(email, 'User123456', 'fs-a');
    };
    viewer = await user('viewer@fs-a.sa', await role('مطلع', ['accounting.dashboard.read']));
    reader = await user('reader@fs-a.sa', await role('قارئ تقارير', ['accounting.dashboard.read', 'accounting.reports.read']));

    // الدليل والسنة المالية
    await http.post(`${A}/chart/install`).set(as(admin)).expect(201);
    const chart = (await http.get(`${A}/accounts`).set(as(admin)).expect(200)).body.accounts as { id: string; code: string }[];
    const code = (c: string) => chart.find((a) => a.code === c)!.id;
    Object.assign(acc, {
      bank: code('1110100201'), ar: code('1140200101'), prepaid: code('1150100101'), vat: code('2130500101'), ap: code('2130200201'),
      capital: code('2310400101'), revenue: code('3110100101'), rent: code('4120300901'), otherIncome: code('3120500501'),
    });
    ids.year = (await http.post(`${A}/setup`).set(as(admin)).send({ fiscalYear: 2026, startDate: '2026-01-01', endDate: '2026-12-31', isFirstYear: true, firstYearStart: '2026-01-01', firstYearEnd: '2026-12-31' }).expect(201)).body.years[0].id;
    ids.cc = (await http.get(`${A}/analytic`).set(as(admin)).expect(200)).body.accounts.find((a: { kind: string }) => a.kind === 'sub').id;
    const cats = (await http.get(`${A}/categories`).set(as(admin)).expect(200)).body as { id: string; behavior: string }[];
    ids.customer = (await http.post(`${A}/partners`).set(as(admin)).send({ name: 'عميل <b>الاستشارات</b>', categoryId: cats.find((c) => c.behavior === 'customer')!.id, accountId: acc.ar }).expect(201)).body.id;
    ids.supplier = (await http.post(`${A}/partners`).set(as(admin)).send({ name: 'مكتب التأجير', categoryId: cats.find((c) => c.behavior === 'supplier')!.id, accountId: acc.ap }).expect(201)).body.id;

    const entry = (voucherType: string, documentDate: string, description: string, lines: unknown[]) =>
      http.post(`${A}/entries`).set(as(admin)).send({ voucherType, documentDate, description, post: true, lines }).expect(201);
    await entry('opening', '2026-01-01', 'رأس المال المدفوع', [{ accountId: acc.bank, debit: 100000, credit: 0 }, { accountId: acc.capital, debit: 0, credit: 100000 }]);
    await entry('journal', '2026-01-20', 'فاتورة استشارات', [
      { accountId: acc.ar, partnerId: ids.customer, debit: 11500, credit: 0 }, { accountId: acc.revenue, debit: 0, credit: 10000 }, { accountId: acc.vat, debit: 0, credit: 1500 },
    ]);
    await entry('journal', '2026-02-10', 'تحصيل جزئي', [{ accountId: acc.bank, debit: 5000, credit: 0 }, { accountId: acc.ar, partnerId: ids.customer, debit: 0, credit: 5000 }]);
    await entry('journal', '2026-02-15', 'إيجار المكتب', [
      { accountId: acc.rent, debit: 3000, credit: 0, analytic: [{ analyticId: ids.cc, percent: 100 }] }, { accountId: acc.ap, partnerId: ids.supplier, debit: 0, credit: 3000 },
    ]);
    await entry('journal', '2026-03-05', 'إيجار مدفوع مقدمًا', [{ accountId: acc.prepaid, debit: 1200, credit: 0 }, { accountId: acc.bank, debit: 0, credit: 1200 }]);
  }, 240000);

  afterAll(async () => { await app?.close(); });

  it('needs the reports or statements permission, and hides another company’s years (404)', async () => {
    await http.get(S).query(q1()).set(as(viewer)).expect(403);
    await http.get(`${S}/mapping`).set(as(viewer)).expect(403);
    await http.get(S).query(q1()).set(as(reader)).expect(200);
    await http.put(`${S}/mapping/${acc.revenue}`).set(as(reader)).send({ lineCode: 'IS-OTH-INC' }).expect(403);
    await http.post(`${S}/issue`).set(as(reader)).send(q1()).expect(403);
    await http.put(`${S}/appropriation`).set(as(reader)).send({ yearId: ids.year, developmentPct: 30, distributionPct: 0, reserveMonths: 6, unrealized: 0, programs: [] }).expect(403);
    await http.get(S).query(q1()).set(as(adminB)).expect(404);
    await http.get(`${S}/appropriation`).query({ yearId: ids.year }).set(as(adminB)).expect(404);
    await http.put(`${S}/mapping/${acc.revenue}`).set(as(adminB)).send({ lineCode: 'IS-OTH-INC' }).expect(404);
    await http.post(`${S}/issue`).set(as(adminB)).send(q1()).expect(404);
    expect((await http.get(`${S}/mapping`).set(as(adminB)).expect(200)).body.rows).toHaveLength(0);
  });

  it('validates the period', async () => {
    await http.get(S).query({ yearId: ids.year, span: 'Q', part: 5 }).set(as(admin)).expect(400);
    await http.get(S).query({ yearId: ids.year, span: 'W' }).set(as(admin)).expect(400);
    await http.get(S).query({ yearId: 'x', span: 'Y' }).set(as(admin)).expect(400);
    await http.get(S).query({ yearId: ids.year, span: 'Y', extra: 1 }).set(as(admin)).expect(400);
  });

  it('maps the whole chart to statement lines by default', async () => {
    const m = (await http.get(`${S}/mapping`).set(as(admin)).expect(200)).body;
    const row = (id: string) => m.rows.find((r: { id: string }) => r.id === id);
    expect(row(acc.bank)).toMatchObject({ line: 'BS-CA-CASH', source: 'default' });
    expect(row(acc.ar)).toMatchObject({ line: 'BS-CA-AR', source: 'default' });
    expect(row(acc.capital)).toMatchObject({ line: 'BS-EQ-CAP', source: 'default' });
    expect(row(acc.rent)).toMatchObject({ line: 'IS-GA', source: 'default' });
    expect(m.review).toHaveLength(0);
  });

  it('builds balanced statements for a quarter from posted entries only', async () => {
    await http.post(`${A}/entries`).set(as(admin)).send({ voucherType: 'journal', documentDate: '2026-03-20', description: 'مسودة لا تدخل', lines: [
      { accountId: acc.bank, debit: 999, credit: 0 }, { accountId: acc.revenue, debit: 0, credit: 999 },
    ] }).expect(201);
    const st = (await http.get(S).query(q1()).set(as(admin)).expect(200)).body;
    expect(st.period).toMatchObject({ from: '2026-01-01', to: '2026-03-31', key: 'Q1' });
    expect(st.bs.totalAssets.cur).toBe(111500);
    expect(st.bs.totalLiabilities.cur).toBe(4500);
    expect(st.bs.totalEquity.cur).toBe(107000);
    expect(st.bs.difference.cur).toBe(0);
    const line = (code: string) => st.bs.groups.flatMap((g: { rows: { code: string; cur: number }[] }) => g.rows).find((r: { code: string }) => r.code === code);
    expect(line('BS-CA-CASH').cur).toBe(103800);
    expect(line('BS-CA-AR').cur).toBe(6500);
    expect(line('BS-NCA-PPE')).toBeUndefined();
    expect(st.is.netIncome).toBe(7000);
    expect(st.is.sections.find((s: { key: string }) => s.key === 'gross').subtotal.cur).toBe(10000);
    expect(st.cash).toMatchObject({ operatingTotal: 3800, netChange: 3800, cashStart: 100000, cashEnd: 103800, difference: 0 });
    expect(st.equity.rows.at(-1).values.reduce((t: number, v: number) => t + v, 0)).toBe(107000);
    expect(st.comparative).toBeNull();
    expect(st.closure).toMatchObject({ closed: false });
    expect(st.closure.drafts).toBe(1);
    // شهر واحد: فبراير فقط في الدخل، والمركز المالي في نهايته
    const feb = (await http.get(S).query({ yearId: ids.year, span: 'M', part: 2 }).set(as(admin)).expect(200)).body;
    expect(feb.is.netIncome).toBe(-3000);
    expect(feb.is.netIncomeYtd).toBe(7000);
    expect(feb.bs.difference.cur).toBe(0);
    expect(feb.cash.difference).toBe(0);
  });

  it('refuses the final issue before the period is closed and its entries posted', async () => {
    const r = await http.post(`${S}/issue`).set(as(admin)).send(q1()).expect(409);
    expect(r.body.message).toContain('إغلاق الفترة');
    const html = await http.get(`${S}/document`).query(q1()).set(as(admin)).expect(200);
    expect(html.headers['content-type']).toContain('text/html');
    expect(html.text).toContain('مسودة ــ الفترة غير مغلقة');
    for (const s of ['قائمة المركز المالي', 'قائمة الدخل', 'قائمة التغيرات في حقوق الملكية', 'قائمة التدفقات النقدية', 'الإيضاحات المتممة', 'تحليل الإهلاك التفصيلي', 'تحليل العملاء', 'تحليل الموردين', 'الدليل المحاسبي وفق بنود القوائم']) expect(html.text).toContain(s);
    expect(html.text).not.toContain('<b>الاستشارات</b>');
    expect(html.text).toContain('&lt;b&gt;الاستشارات');
    if (OUT) writeFileSync(join(OUT, 'statements-draft.html'), html.text);
  });

  it('moves an account to another line by a manual mapping, with history, and back', async () => {
    await http.put(`${S}/mapping/${acc.revenue}`).set(as(admin)).send({ lineCode: 'BS-CA-OTH' }).expect(400);
    await http.put(`${S}/mapping/${acc.revenue}`).set(as(admin)).send({ lineCode: 'NOPE' }).expect(400);
    const m = (await http.put(`${S}/mapping/${acc.revenue}`).set(as(admin)).send({ lineCode: 'IS-OTH-INC' }).expect(200)).body;
    expect(m.rows.find((r: { id: string }) => r.id === acc.revenue)).toMatchObject({ line: 'IS-OTH-INC', source: 'manual' });
    const st = (await http.get(S).query(q1()).set(as(admin)).expect(200)).body;
    expect(st.is.sections.find((s: { key: string }) => s.key === 'gross').subtotal.cur).toBe(0);
    expect(st.is.netIncome).toBe(7000);
    await http.put(`${S}/mapping/${acc.revenue}`).set(as(admin)).send({ lineCode: null }).expect(200);
    const back = (await http.get(`${S}/mapping`).set(as(admin)).expect(200)).body;
    expect(back.rows.find((r: { id: string }) => r.id === acc.revenue)).toMatchObject({ line: 'IS-REV', source: 'default', manual: null });
    // الإلغاء لا يحذف السجل: يبقى بلا بند ومعه أثر الربط والإلغاء
    const [row] = await app.get(DataSource).query('SELECT line_code, history FROM acc_fs_mappings WHERE account_id = $1', [acc.revenue]);
    expect(row.line_code).toBeNull();
    expect(row.history.map((h: { action: string }) => h.action)).toEqual(['ربط يدوي', 'إلغاء الربط اليدوي والعودة للافتراضي']);
    expect(row.history[1]).toMatchObject({ before: 'IS-OTH-INC', after: null });
    expect(row.history[1].byId).toEqual(expect.any(String));
  });

  it('prepares the profit appropriation within the articles of association limits', async () => {
    const base = { yearId: ids.year, developmentPct: 30, distributionPct: 0, reserveMonths: 6, unrealized: 0, programs: [{ channel: 3, name: 'برنامج دعم مرضى عناية', amount: 3000 }], boardDecision: null, notes: 'مقترح أولي' };
    await http.put(`${S}/appropriation`).set(as(admin)).send({ ...base, distributionPct: 15 }).expect(400);
    await http.put(`${S}/appropriation`).set(as(admin)).send({ ...base, developmentPct: 31 }).expect(400);
    await http.put(`${S}/appropriation`).set(as(admin)).send({ ...base, programs: [{ channel: 19, name: 'خارج المادة', amount: 1 }] }).expect(400);
    const tooMuch = await http.put(`${S}/appropriation`).set(as(admin)).send({ ...base, programs: [{ channel: 3, name: 'كبير', amount: 999999 }] }).expect(400);
    expect(tooMuch.body.message).toContain('المصارف غير الربحية');
    const r = (await http.put(`${S}/appropriation`).set(as(admin)).send(base).expect(200)).body;
    expect(r.saved).toBe(true);
    expect(r.result).toMatchObject({ netProfit: 7000, distributable: 7000, development: 2100, distribution: 0, nonprofit: 4900, programsTotal: 3000, deferred: 1900, nonprofitPct: 70 });
    // الاحتياطي التشغيلي: مصروفات 6 أشهر من 3000 = 1500، من حصة التنمية
    expect(r.result).toMatchObject({ reserveTarget: 1500, reserve: 1500, expansion: 600 });
    expect(r.history).toHaveLength(1);
    // السحب لا يحذف: يعود المشروع للقيم المقترحة ويبقى أثره، والحفظ التالي يعيده
    await http.delete(`${S}/appropriation/${ids.year}`).set(as(reader)).expect(403);
    await http.delete(`${S}/appropriation/${ids.year}`).set(as(adminB)).expect(404);
    await http.delete(`${S}/appropriation/${ids.year}`).set(as(admin)).expect(200);
    await http.delete(`${S}/appropriation/${ids.year}`).set(as(admin)).expect(404);
    const gone = (await http.get(`${S}/appropriation`).query({ yearId: ids.year }).set(as(admin)).expect(200)).body;
    expect(gone.saved).toBe(false);
    expect(gone.inputs.programs).toHaveLength(0);
    expect(gone.history.map((h: { action: string }) => h.action)).toEqual(['إعداد المشروع', 'سحب المشروع']);
    const again = (await http.put(`${S}/appropriation`).set(as(admin)).send(base).expect(200)).body;
    expect(again.saved).toBe(true);
    expect(again.history.at(-1).action).toBe('إعادة إعداد المشروع بعد سحبه');
    const year = (await http.get(S).query({ yearId: ids.year, span: 'Y' }).set(as(admin)).expect(200)).body;
    expect(year.appropriation.saved).toBe(true);
  });

  it('issues the final file only after closing the months, and records it', async () => {
    await http.post(`${A}/posting/batch`).set(as(admin)).send({ dateFrom: '2026-03-01', dateTo: '2026-03-31' }).expect(201);
    await http.post(`${A}/periods/close`).set(as(admin)).send({ fiscalYearId: ids.year, months: ['2026-01', '2026-02', '2026-03'] }).expect(201);
    const st = (await http.get(S).query(q1()).set(as(admin)).expect(200)).body;
    expect(st.closure.closed).toBe(true);
    expect(st.bs.totalAssets.cur).toBe(112499);
    const html = await http.get(`${S}/document`).query(q1()).set(as(admin)).expect(200);
    expect(html.text).not.toContain('مسودة ــ الفترة غير مغلقة');
    const { pdf } = (await http.get(`${S}/options`).set(as(admin)).expect(200)).body;
    if (!pdf) {
      await http.post(`${S}/issue`).set(as(admin)).send(q1()).expect(503);
      return;
    }
    const r = await http.post(`${S}/issue`).set(as(admin)).send(q1()).buffer(true).parse((res, cb) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => cb(null, Buffer.concat(chunks)));
    }).expect(200);
    expect(r.headers['content-type']).toBe('application/pdf');
    expect(r.headers['x-issue-no']).toBe('1');
    expect((r.body as Buffer).subarray(0, 4).toString()).toBe('%PDF');
    if (OUT) writeFileSync(join(OUT, 'statements-Q1.pdf'), r.body as Buffer);
    const issues = (await http.get(`${S}/issues`).set(as(reader)).expect(200)).body;
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ issueNo: 1, periodKey: 'Q1', year: 2026 });
    expect(issues[0].sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(issues[0].issuedById).toEqual(expect.any(String));
    expect((await http.get(`${S}/issues`).set(as(adminB)).expect(200)).body).toHaveLength(0);
  });

  it('reports budget variances against the general ledger in several forms', async () => {
    const R = '/api/planning';
    const b = (await http.post(`${R}/budgets`).set(as(admin)).send({ title: 'موازنة 2026', fiscalYear: 2026 }).expect(201)).body;
    const rent = (await http.post(`${R}/budgets/${b.id}/lines`).set(as(admin)).send({ section: 'opex', kind: 'manual', name: 'إيجار المكتب', params: { manualAmount: 24000 } }).expect(201)).body;
    const rev = (await http.post(`${R}/budgets/${b.id}/lines`).set(as(admin)).send({ section: 'revenue', kind: 'manual', name: 'إيرادات الاستشارات', params: { manualAmount: 120000 } }).expect(201)).body;
    await http.post(`${R}/budgets/${b.id}/submit`).set(as(admin)).send({}).expect(201);
    let x = (await http.get(`${R}/budgets/${b.id}`).set(as(admin)).expect(200)).body;
    for (let i = 0; i < 6 && x.status === 'in_review'; i++) x = (await http.post(`${R}/budgets/${b.id}/decision`).set(as(admin)).send({ decision: 'approve', note: 'قرار مجلس المديرين رقم 1/2026' }).expect(201)).body;
    expect(x.status).toBe('approved');
    const lineId = (l: { id?: string; lines?: { id: string; name: string }[] }, name: string) => l.id ?? l.lines!.find((y) => y.name === name)!.id;
    await http.patch(`${R}/budget-lines/${lineId(rent, 'إيجار المكتب')}/mapping`).set(as(admin)).send({ accountIds: [acc.rent] }).expect(200);
    await http.patch(`${R}/budget-lines/${lineId(rev, 'إيرادات الاستشارات')}/mapping`).set(as(admin)).send({ accountIds: [acc.revenue] }).expect(200);

    const V = `${R}/variance`;
    await http.get(`${V}/budgets`).set(as(viewer)).expect(403);
    expect((await http.get(`${V}/budgets`).set(as(reader)).expect(200)).body.budgets).toHaveLength(1);
    await http.get(`${V}/${b.id}`).query({ span: 'Q', part: 1 }).set(as(adminB)).expect(404);
    await http.get(`${V}/${b.id}`).query({ span: 'Q', part: 9 }).set(as(admin)).expect(400);
    const v = (await http.get(`${V}/${b.id}`).query({ span: 'Q', part: 1 }).set(as(reader)).expect(200)).body;
    expect(v.period).toMatchObject({ m1: 1, m2: 3 });
    const line = (name: string) => v.views.line.find((g: { label: string }) => g.label === name);
    expect(line('إيجار المكتب')).toMatchObject({ planned: 6000, actual: 3000, variance: -3000, status: 'favorable' });
    expect(line('إيرادات الاستشارات')).toMatchObject({ planned: 30000, actual: 10999, status: 'unfavorable' });
    for (const k of ['section', 'unit', 'costcenter', 'account', 'plan']) expect(v.views[k].length).toBeGreaterThan(0);
    expect(v.months).toHaveLength(3);
    const feb = (await http.get(`${V}/${b.id}`).query({ span: 'M', part: 2 }).set(as(admin)).expect(200)).body;
    expect(feb.views.line.find((g: { label: string }) => g.label === 'إيجار المكتب')).toMatchObject({ planned: 2000, actual: 3000, status: 'unfavorable' });
    const ytd = (await http.get(`${V}/${b.id}`).query({ span: 'M', part: 3, basis: 'ytd' }).set(as(admin)).expect(200)).body;
    expect(ytd.period).toMatchObject({ m1: 1, m2: 3 });
    const html = await http.get(`${V}/${b.id}`).query({ span: 'Q', part: 1, format: 'html' }).set(as(admin)).expect(200);
    expect(html.text).toContain('QF-FIN-09');
    expect(html.text).toContain('حسب الخطة التشغيلية والبرنامج');
    const xl = await http.get(`${V}/${b.id}`).query({ span: 'Y', format: 'xlsx' }).set(as(admin)).buffer(true).parse((res, cb) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => cb(null, Buffer.concat(chunks)));
    }).expect(200);
    expect((xl.body as Buffer).subarray(0, 2).toString()).toBe('PK');
  });
});
