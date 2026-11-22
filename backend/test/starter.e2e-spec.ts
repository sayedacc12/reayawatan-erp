import { Test } from '@nestjs/testing';
import { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/main';

/**
 * زر «الإعدادات الافتراضية» داخل كل نظام: يضيف إعدادات بداية حقيقية لشركة استشارية مرة واحدة فقط لكل نظام في كل منشأة،
 * ولا يعدّل ما أدخلته الشركة، ولا يتاح إلا لمن يملك إعدادات النظام، ولا يمس منشأة أخرى.
 */
const DB = process.env.TEST_DATABASE_URL ?? 'postgres://erp:erp@localhost:5432/charity_erp_test';
const MODULES = [
  'accounting', 'billing', 'hr', 'procurement', 'risk', 'audit', 'quality', 'governance',
  'meetings', 'volunteers', 'members', 'partnerships', 'comms', 'knowledge', 'planning',
];

describe('Default settings button per system', () => {
  let app: NestExpressApplication;
  let http: ReturnType<typeof request>;
  let db: DataSource;
  let admin: string;
  let adminB: string;
  let clerk: string;
  let accSettings: string;
  let orgA: string;
  let orgB: string;
  const as = (t: string) => ({ Authorization: `Bearer ${t}` });
  const login = async (login: string, password: string, organization?: string) =>
    (await http.post('/api/auth/login').send({ login, password, organization }).expect(200)).body.accessToken as string;
  const count = async (table: string, org: string) => Number((await db.query(`SELECT count(*)::int AS n FROM ${table} WHERE organization_id = $1`, [org]))[0].n);

  beforeAll(async () => {
    Object.assign(process.env, {
      DATABASE_URL: DB, JWT_SECRET: 'test-secret', PLATFORM_ADMIN_EMAIL: 'platform@test.org', PLATFORM_ADMIN_PASSWORD: 'Platform123',
      UPLOAD_DIR: '/tmp/rw-test-uploads',
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
    const mk = async (slug: string, email: string) => (await http.post('/api/platform/organizations').set(as(platform)).send({
      name: `شركة ${slug}`, slug, adminFullName: `مدير ${slug}`, adminEmail: email, adminPassword: 'Owner12345',
    }).expect(201)).body.id as string;
    orgA = await mk('starter-a', 'owner@starter-a.sa');
    orgB = await mk('starter-b', 'owner@starter-b.sa');
    admin = await login('owner@starter-a.sa', 'Owner12345', 'starter-a');
    adminB = await login('owner@starter-b.sa', 'Owner12345', 'starter-b');

    // موظف بلا صلاحيات إعدادات، وآخر يملك إعدادات النظام المالي فقط
    const viewer = (await http.post('/api/roles').set(as(admin)).send({ name: 'مشاهد', permissions: ['accounting.dashboard.read'] }).expect(201)).body.id;
    const settings = (await http.post('/api/roles').set(as(admin)).send({ name: 'إعدادات المالي', permissions: ['accounting.settings.manage'] }).expect(201)).body.id;
    await http.post('/api/users').set(as(admin)).send({ fullName: 'موظف', email: 'clerk@starter-a.sa', password: 'Clerk12345', roleIds: [viewer] }).expect(201);
    await http.post('/api/users').set(as(admin)).send({ fullName: 'محاسب', email: 'acc@starter-a.sa', password: 'Accnt12345', roleIds: [settings] }).expect(201);
    clerk = await login('clerk@starter-a.sa', 'Clerk12345', 'starter-a');
    accSettings = await login('acc@starter-a.sa', 'Accnt12345', 'starter-a');
  }, 240000);

  afterAll(async () => {
    await db.destroy();
    await app.close();
  });

  it('is available only to the system admin or holders of that system\'s settings permission', async () => {
    await http.get('/api/starter/accounting').set(as(clerk)).expect(403);
    await http.post('/api/starter/accounting').set(as(clerk)).expect(403);
    const s = (await http.get('/api/starter/accounting').set(as(accSettings)).expect(200)).body;
    expect(s).toMatchObject({ module: 'accounting', status: 'available', applied: null });
    expect(s.steps.length).toBeGreaterThan(0);
    // صلاحية إعدادات المالي لا تفتح أنظمة أخرى
    await http.get('/api/starter/hr').set(as(accSettings)).expect(403);
    // نظام بلا إعدادات افتراضية أو غير موجود، ومنها الأنظمة المحذوفة من رعاية وطن والموقع (محتواه الافتراضي تلقائي)
    for (const m of ['nothing', 'beneficiaries', 'projects', 'fundraising', 'website']) await http.get(`/api/starter/${m}`).set(as(admin)).expect(404);
  });

  it('applies the accounting defaults once, through the settings holder, without touching other organizations', async () => {
    const r = (await http.post('/api/starter/accounting').set(as(accSettings)).expect(201)).body;
    expect(r.status).toBe('applied');
    expect(r.applied.by).toBe('محاسب');
    const res = Object.fromEntries(r.applied.results.map((x: { key: string; added: number }) => [x.key, x.added]));
    expect(res.chart).toBeGreaterThan(100);
    expect(res.stages).toBe(4);
    expect(res.cash).toBe(1);
    expect(await count('acc_voucher_stages', orgA)).toBe(4);
    expect(await count('acc_cash_accounts', orgA)).toBe(1);
    // مرة واحدة فقط
    await http.post('/api/starter/accounting').set(as(admin)).expect(409);
    expect((await http.get('/api/starter/accounting').set(as(admin)).expect(200)).body.status).toBe('applied');
    // المنشأة الأخرى لم تتأثر وما زال الزر متاحًا لها
    expect(await count('acc_accounts', orgB)).toBe(0);
    expect((await http.get('/api/starter/accounting').set(as(adminB)).expect(200)).body.status).toBe('available');
  });

  it('never overwrites what the organization already set up', async () => {
    // الشركة الثانية أضافت وحدة في الهيكل بنفسها قبل الزر
    await http.post('/api/hr/units').set(as(adminB)).send({ name: 'وحدتي الخاصة', level: 0, parentId: null }).expect((res) => expect(res.status).toBeLessThan(300));
    const r = (await http.post('/api/starter/hr').set(as(adminB)).expect(201)).body;
    const structure = r.applied.results.find((x: { key: string }) => x.key === 'structure');
    expect(structure.added).toBe(0);
    expect(structure.note).toContain('لم تتغير');
    const rows = await db.query('SELECT name FROM hr_units WHERE organization_id = $1', [orgB]);
    expect(rows.map((x: { name: string }) => x.name)).toEqual(['وحدتي الخاصة']);
  });

  it('lets only one of two simultaneous presses through', async () => {
    const [a, b] = await Promise.all([http.post('/api/starter/comms').set(as(adminB)), http.post('/api/starter/comms').set(as(adminB))]);
    expect([a.status, b.status].sort()).toEqual([201, 409]);
  });

  it('leaves billing untouched for an organization that started linking with the tax authority platform', async () => {
    await http.post('/api/starter/accounting').set(as(adminB)).expect(201);
    await db.query(`INSERT INTO bl_zatca (organization_id, stage) VALUES ($1, 'compliance') ON CONFLICT (organization_id) DO UPDATE SET stage = 'compliance'`, [orgB]);
    const r = (await http.post('/api/starter/billing').set(as(adminB)).expect(201)).body;
    expect(r.applied.results[0].added).toBe(0);
    const [s] = await db.query('SELECT receivables_account_id AS rec FROM bl_settings WHERE organization_id = $1', [orgB]);
    expect(s?.rec ?? null).toBeNull();
  });

  it('applies the defaults of every system on a fresh organization', async () => {
    for (const m of MODULES.filter((x) => x !== 'accounting')) {
      const res = await http.post(`/api/starter/${m}`).set(as(admin));
      if (res.status !== 201) throw new Error(`${m}: ${res.status} ${JSON.stringify(res.body)}`);
      expect(res.body.status).toBe('applied');
      const total = res.body.applied.results.reduce((s: number, x: { added: number }) => s + x.added, 0);
      if (total === 0) throw new Error(`${m}: nothing added ${JSON.stringify(res.body.applied.results)}`);
    }
    // الهيكل والسلم والجدارات بما يناسب شركة استشارية
    const units = (await db.query('SELECT name FROM hr_units WHERE organization_id = $1 ORDER BY level, name', [orgA])).map((x: { name: string }) => x.name);
    expect(units[0]).toBe('الإدارة العامة');
    expect(units).toContain('إدارة الاستشارات والمشاريع');
    expect(await count('hr_grades', orgA)).toBe(6);
    expect(await count('hr_competencies', orgA)).toBe(7);
    expect(await count('audit_areas', orgA)).toBe(10);
    expect(await count('mtg_bodies', orgA)).toBe(4);
    expect(await count('pr_warehouses', orgA)).toBe(1);
    expect(await count('risk_methodologies', orgA)).toBe(5);
    // تقويم الشركة: لا مواعيد للمركز الوطني ولا للجمعية العمومية، وفيه إقرارات ضريبة القيمة المضافة
    const titles = (await db.query('SELECT title FROM gov_obligations WHERE organization_id = $1', [orgA])).map((x: { title: string }) => x.title);
    expect(titles).toHaveLength(16);
    expect(titles.filter((t: string) => t.startsWith('إقرار ضريبة القيمة المضافة'))).toHaveLength(4);
    expect(titles.some((t: string) => /المركز|الجمعية العمومية/.test(t))).toBe(false);
    // ولا ذكر للمستفيدين أو التبرعات في سياق الجودة
    const [ctx] = await db.query('SELECT context::text AS c FROM quality_settings WHERE organization_id = $1', [orgA]);
    expect(ctx.c).toContain('العملاء');
    expect(ctx.c).not.toMatch(/المستفيد|التبرع/);
    // الفوترة رُبطت بحسابات الدليل دون تغيير وضع الشركة الضريبي
    const [bl] = await db.query(
      `SELECT s.mode, r.code AS rec, v.code AS vat, rv.code AS rev, s.customer_category_id AS cat FROM bl_settings s
         LEFT JOIN acc_accounts r ON r.id = s.receivables_account_id LEFT JOIN acc_accounts v ON v.id = s.vat_output_account_id
         LEFT JOIN acc_accounts rv ON rv.id = s.revenue_account_id WHERE s.organization_id = $1`, [orgA]);
    expect(bl).toMatchObject({ mode: 'off', rec: '1140200101', vat: '2130500101', rev: '3110100101' });
    expect(bl.cat).toBeTruthy();
    // ولا شيء منها في المنشأة الأخرى (عدا ما فعّلته هي)
    expect(await count('audit_areas', orgB)).toBe(0);
    expect(await count('gov_obligations', orgB)).toBe(0);
  }, 240000);
});
