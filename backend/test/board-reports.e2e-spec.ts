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
 * تقارير مجلس المديرين للخطط والموازنات (QF-PLN-01 إلى QF-PLN-06):
 * تُولّد من بيانات النظام، وتُهرّب كل قيمة، وتحترم الصلاحيات وعزل الشركات، وتملأ التوقيعات من تشكيل المجلس.
 */
const DB = process.env.TEST_DATABASE_URL ?? 'postgres://erp:erp@localhost:5432/charity_erp_test';
const Y = new Date().getUTCFullYear();
const OUT = process.env.BOARD_REPORTS_OUT;

describe('Board reports for plans and budgets', () => {
  let app: NestExpressApplication;
  let http: ReturnType<typeof request>;
  let admin: string;
  let viewer: string;
  let budgeter: string;
  let adminB: string;
  const as = (t: string) => ({ Authorization: `Bearer ${t}` });
  const login = async (login: string, password: string, organization?: string) =>
    (await http.post('/api/auth/login').send({ login, password, organization }).expect(200)).body.accessToken as string;
  const R = '/api/planning';
  const BR = `${R}/board-reports`;
  const ids: Record<string, string> = {};
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const approve = async (path: string): Promise<any> => {
    let x = (await http.get(path).set(as(admin)).expect(200)).body;
    for (let i = 0; i < 6 && x.status === 'in_review'; i++) x = (await http.post(`${path}/decision`).set(as(admin)).send({ decision: 'approve' }).expect(201)).body;
    return x;
  };
  const html = async (type: string, q: Record<string, string>, t = admin) => {
    const r = await http.get(`${BR}/${type}`).query(q).set(as(t)).expect(200);
    expect(r.headers['content-type']).toContain('text/html');
    if (OUT) writeFileSync(join(OUT, `${type}-${Object.values(q).join('-').slice(0, 20)}.html`), r.text);
    return r.text;
  };

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
    for (const slug of ['board-a', 'board-b']) {
      await http.post('/api/platform/organizations').set(as(platform)).send({
        name: `شركة ${slug}`, slug, adminFullName: `مدير ${slug}`, adminEmail: `owner@${slug}.sa`, adminPassword: 'Owner12345',
      }).expect(201);
    }
    admin = await login('owner@board-a.sa', 'Owner12345', 'board-a');
    adminB = await login('owner@board-b.sa', 'Owner12345', 'board-b');
    const role = async (name: string, permissions: string[]) => (await http.post('/api/roles').set(as(admin)).send({ name, permissions }).expect(201)).body.id;
    const user = async (email: string, roleId: string) => {
      await http.post('/api/users').set(as(admin)).send({ fullName: email, email, password: 'User123456', roleIds: [roleId] }).expect(201);
      return login(email, 'User123456', 'board-a');
    };
    viewer = await user('viewer@board-a.sa', await role('مشاهد', ['planning.dashboard.read']));
    budgeter = await user('budget@board-a.sa', await role('معد موازنة', ['planning.dashboard.read', 'planning.budgets.manage']));
    ids.unit = (await http.post('/api/hr/units').set(as(admin)).send({ name: 'إدارة الاستشارات', level: 0 }).expect(201)).body.id;
  }, 240000);

  afterAll(async () => { await app?.close(); });

  it('prepares a strategic plan, an operational plan and a budget', async () => {
    const sp = (await http.post(`${R}/plans`).set(as(admin)).send({
      kind: 'strategic', title: 'الخطة الاستراتيجية <script>alert(1)</script>', startYear: Y, endYear: Y + 2, periodicity: 'annual', templateKey: 'ncnp-strategic',
    }).expect(201)).body;
    ids.sp = sp.id;
    const init = sp.items.find((i: { level: number }) => i.level === 2);
    await http.patch(`${R}/items/${init.id}`).set(as(admin)).send({ costByYear: { [Y]: 120000, [Y + 1]: 80000 }, fundingType: 'unrestricted', ownerName: 'مدير التطوير' }).expect(200);
    await http.post(`${R}/plans/${ids.sp}/submit`).set(as(admin)).send({}).expect(201);
    expect((await approve(`${R}/plans/${ids.sp}`)).status).toBe('approved');

    const op = (await http.post(`${R}/plans`).set(as(admin)).send({ kind: 'operational', title: 'الخطة التشغيلية للاستشارات', startYear: Y, endYear: Y, periodicity: 'quarterly', unitId: ids.unit, parentPlanId: ids.sp }).expect(201)).body;
    ids.op = op.id;
    const prog = (await http.post(`${R}/plans/${ids.op}/items`).set(as(admin)).send({ title: 'برنامج الاستشارات' }).expect(201)).body.items[0];
    const act = (await http.post(`${R}/plans/${ids.op}/items`).set(as(admin)).send({
      parentId: prog.id, title: 'حملة تعريفية', startDate: `${Y}-01-01`, endDate: `${Y}-03-31`, costByYear: { [Y]: 30000 }, milestones: [{ title: 'إطلاق الحملة', dueDate: `${Y}-02-01`, done: false }],
    }).expect(201)).body.items.find((i: { title: string }) => i.title === 'حملة تعريفية');
    await http.post(`${R}/links`).set(as(admin)).send({ fromItemId: act.id, toItemId: init.id, relation: 'contributes', contribution: 50 }).expect(201);
    await http.post(`${R}/plans/${ids.op}/submit`).set(as(admin)).send({}).expect(201);
    expect((await approve(`${R}/plans/${ids.op}`)).status).toBe('approved');
    await http.post(`${R}/items/${act.id}/progress`).set(as(admin)).send({ progress: 40, note: 'نُفذ جزء من الحملة' }).expect(201);

    const b = (await http.post(`${R}/budgets`).set(as(admin)).send({ title: 'الموازنة التقديرية', fiscalYear: Y }).expect(201)).body;
    ids.b = b.id;
    await http.post(`${R}/budgets/${b.id}/lines`).set(as(admin)).send({ section: 'hr', kind: 'new_position', name: 'مستشار', unitId: ids.unit, params: { basic: 9000, housing: 2000, transport: 800, count: 1, startMonth: 1, isSaudi: true } }).expect(201);
    await http.post(`${R}/budgets/${b.id}/lines`).set(as(admin)).send({ section: 'opex', kind: 'manual', name: 'إيجار المكتب', unitId: ids.unit, params: { manualAmount: 60000 } }).expect(201);
    await http.post(`${R}/budgets/${b.id}/lines`).set(as(admin)).send({ section: 'revenue', kind: 'manual', name: 'إيرادات الاستشارات', params: { manualAmount: 400000 } }).expect(201);
    // تشكيل المجلس في نظام الاجتماعات يملأ صفحة التوقيعات
    await http.post('/api/meetings/bodies').set(as(admin)).send({
      kind: 'board', code: 'BRD', name: 'مجلس المديرين', members: [
        { type: 'external', name: 'رئيس تجريبي', role: 'chair', voting: true }, { type: 'external', name: 'عضو تجريبي', role: 'member', voting: true },
      ], quorumPercent: 50, isConfidential: false, isActive: true,
    }).expect(201);
  }, 120000);

  it('does not show a confidential board body on the signature page', async () => {
    await http.post('/api/meetings/bodies').set(as(admin)).send({
      kind: 'board', code: 'BRD-S', name: 'مجلس سري', members: [{ type: 'external', name: 'عضو سري', role: 'chair', voting: true }], quorumPercent: 50, isConfidential: true, isActive: true,
    }).expect(201);
    const h = await html('plan-approval', { planId: ids.sp });
    expect(h).not.toContain('عضو سري');
    expect(h).not.toContain('مجلس سري');
  });

  it('lists the six coded forms by permission', async () => {
    const c = (await http.get(BR).set(as(admin)).expect(200)).body;
    expect(c.forms.map((f: { code: string }) => f.code)).toEqual(['QF-PLN-01', 'QF-PLN-02', 'QF-PLN-03', 'QF-PLN-04', 'QF-PLN-05', 'QF-PLN-06']);
    expect(c.plans).toHaveLength(2);
    expect(c.budgets).toHaveLength(1);
    const cb = (await http.get(BR).set(as(budgeter)).expect(200)).body;
    expect(cb.forms.map((f: { code: string }) => f.code)).toEqual(['QF-PLN-03', 'QF-PLN-06']);
    expect(cb.plans).toHaveLength(0);
  });

  it('needs the reports or budgets permission, and plan forms need the reports permission', async () => {
    await http.get(BR).set(as(viewer)).expect(403);
    await http.get(`${BR}/plan-approval`).query({ planId: ids.sp }).set(as(viewer)).expect(403);
    await http.get(`${BR}/plan-approval`).query({ planId: ids.sp }).set(as(budgeter)).expect(403);
    await html('budget-approval', { budgetId: ids.b }, budgeter);
  });

  it('hides another company’s plans and budgets (404)', async () => {
    await http.get(`${BR}/plan-approval`).query({ planId: ids.sp }).set(as(adminB)).expect(404);
    await http.get(`${BR}/plan-performance`).query({ planId: ids.op }).set(as(adminB)).expect(404);
    await http.get(`${BR}/budget-approval`).query({ budgetId: ids.b }).set(as(adminB)).expect(404);
    await http.get(`${BR}/budget-performance`).query({ budgetId: ids.b }).set(as(adminB)).expect(404);
    expect((await http.get(BR).set(as(adminB)).expect(200)).body.plans).toHaveLength(0);
  });

  it('validates the type, the target and the period', async () => {
    await http.get(`${BR}/unknown`).set(as(admin)).expect(404);
    await http.get(`${BR}/plan-approval`).set(as(admin)).expect(400);
    await http.get(`${BR}/plan-approval`).query({ planId: 'x' }).set(as(admin)).expect(400);
    await http.get(`${BR}/plan-performance`).query({ planId: ids.sp, period: `${Y}-Q5` }).set(as(admin)).expect(400);
    await http.get(`${BR}/plan-approval`).query({ planId: ids.sp, extra: '1' }).set(as(admin)).expect(400);
  });

  it('builds the strategic plan approval report (QF-PLN-01) from the plan, escaping its text', async () => {
    const h = await html('plan-approval', { planId: ids.sp, meetingNo: '3/2026' });
    expect(h).toContain('QF-PLN-01');
    expect(h).toContain('تقرير اعتماد الخطة الاستراتيجية');
    expect(h).not.toContain('<script>alert(1)</script>');
    expect(h).toContain('&lt;script&gt;');
    for (const s of ['الملخص التنفيذي', 'الإطار الاستراتيجي', 'مؤشرات الأداء ومستهدفاتها', 'التكلفة التقديرية ومصادر التمويل', 'الخطط التشغيلية المنفذة لها', 'سجل الإعداد والاعتماد', 'قرار المجلس والتوقيعات']) expect(h).toContain(s);
    expect(h).toContain('رئيس تجريبي');
    expect(h).toContain('3/2026');
    expect(h).toContain('مدير التطوير');
    expect(h).toMatch(/<img class="logo" src="data:image\/png;base64,/);
  });

  it('builds the operational plan approval report (QF-PLN-02) with its schedule and strategic links', async () => {
    const h = await html('plan-approval', { planId: ids.op });
    expect(h).toContain('QF-PLN-02');
    expect(h).toContain('الجدول الزمني للأنشطة');
    expect(h).toContain('مساهمة الأنشطة في الخطة الاستراتيجية');
    expect(h).toContain('إطلاق الحملة');
  });

  it('builds the plan performance reports (QF-PLN-04/05) for a period', async () => {
    const s = await html('plan-performance', { planId: ids.sp, period: `${Y}-Q4` });
    expect(s).toContain('QF-PLN-04');
    expect(s).toContain('التقييم العام');
    const o = await html('plan-performance', { planId: ids.op, period: String(Y) });
    expect(o).toContain('QF-PLN-05');
    expect(o).toContain('نُفذ جزء من الحملة');
    expect(o).toContain('الانحرافات والإجراءات التصحيحية');
  });

  it('builds the budget approval report (QF-PLN-03) with each section as its own tab', async () => {
    const h = await html('budget-approval', { budgetId: ids.b });
    expect(h).toContain('QF-PLN-03');
    for (const s of ['الأسس والافتراضات', 'بنود الموارد البشرية', 'بنود المصروفات التشغيلية', 'بنود الإيرادات والتمويل', 'التوزيع الشهري', 'إيجار المكتب']) expect(h).toContain(s);
  });

  it('builds the budget performance report (QF-PLN-06) only after approval', async () => {
    await http.get(`${BR}/budget-performance`).query({ budgetId: ids.b }).set(as(admin)).expect(409);
    await http.post(`${R}/budgets/${ids.b}/submit`).set(as(admin)).send({}).expect(201);
    expect((await approve(`${R}/budgets/${ids.b}`)).status).toBe('approved');
    const h = await html('budget-performance', { budgetId: ids.b, period: `${Y}-H1` });
    expect(h).toContain('QF-PLN-06');
    for (const s of ['الأداء حسب الأقسام', 'الأداء الشهري', 'الانحرافات الجوهرية والتوصيات']) expect(h).toContain(s);
    await http.get(`${BR}/budget-performance`).query({ budgetId: ids.b, period: String(Y + 1) }).set(as(admin)).expect(400);
  });

  it('exports a PDF when Chromium is available', async () => {
    const c = (await http.get(BR).set(as(admin)).expect(200)).body;
    if (!c.pdf) return;
    const r = await http.get(`${BR}/plan-approval`).query({ planId: ids.sp, format: 'pdf' }).set(as(admin)).buffer(true).parse((res, cb) => {
      const chunks: Buffer[] = [];
      res.on('data', (x: Buffer) => chunks.push(x));
      res.on('end', () => cb(null, Buffer.concat(chunks)));
    }).expect(200);
    expect(r.headers['content-type']).toBe('application/pdf');
    expect(r.headers['content-disposition']).toContain('attachment');
    expect((r.body as Buffer).subarray(0, 4).toString()).toBe('%PDF');
    if (OUT) writeFileSync(join(OUT, 'plan-approval.pdf'), r.body as Buffer);
  }, 120000);
});
