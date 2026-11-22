import { Test } from '@nestjs/testing';
import { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/main';

/**
 * البيانات التجريبية داخل جمعية مشتركة في فترة التجربة، ثم تحويلها لجمعية فعلية:
 * لا تتأثر أي جمعية أخرى، ويبقى ما كان قبل البيانات التجريبية وحسابات الشركة، ويُحذف الباقي بعد التأكيد.
 */
const DB = process.env.TEST_DATABASE_URL ?? 'postgres://erp:erp@localhost:5432/charity_erp_test';

describe('Sample data in a trial organization and conversion to a real one', () => {
  let app: NestExpressApplication;
  let http: ReturnType<typeof request>;
  let db: DataSource;
  let platform: string;
  let admin: string;
  let orgId: string;
  let baselineRoleId: string;
  const as = (t: string) => ({ Authorization: `Bearer ${t}` });
  const login = async (login: string, password: string, organization?: string) =>
    (await http.post('/api/auth/login').send({ login, password, organization }).expect(200)).body.accessToken as string;
  const count = async (table: string, org: string) => Number((await db.query(`SELECT count(*)::int AS n FROM ${table} WHERE organization_id = $1`, [org]))[0].n);
  const demoId = async () => (await db.query(`SELECT id FROM organizations WHERE slug = 'demo'`))[0].id as string;

  beforeAll(async () => {
    Object.assign(process.env, {
      DATABASE_URL: DB, JWT_SECRET: 'test-secret', PLATFORM_ADMIN_EMAIL: 'platform@test.org', PLATFORM_ADMIN_PASSWORD: 'Platform123',
      UPLOAD_DIR: '/tmp/sanabel-test-uploads',
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
    platform = await login('admin', 'Platform123');

    // الشركة التجريبية العامة موجودة: يجب ألا تتعارض معها البيانات التجريبية ولا تتأثر بالتحويل
    await http.post('/api/platform/demo-organization').set(as(platform)).expect(201);

    const org = (await http.post('/api/platform/organizations').set(as(platform)).send({
      name: 'جمعية التجربة', slug: 'trial-one', adminFullName: 'مدير جمعية التجربة', adminEmail: 'owner@trial-one.sa', adminPassword: 'Owner12345',
    }).expect(201)).body;
    orgId = org.id;
    await http.patch(`/api/platform/organizations/${orgId}/subscription`).set(as(platform))
      .send({ status: 'trial', trialEndsOn: new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10) }).expect(200);
    admin = await login('owner@trial-one.sa', 'Owner12345', 'trial-one');
    // قبل البيانات التجريبية: دور أنشأته الشركة، وفتح بعض الشاشات (تُنشئ إعداداتها الافتراضية)
    baselineRoleId = (await http.post('/api/roles').set(as(admin)).send({ name: 'منسق البرامج', permissions: [] }).expect(201)).body.id;
    await http.get('/api/website/content').set(as(admin));
    await http.get('/api/accounting/settings').set(as(admin));
  }, 240000);

  afterAll(async () => {
    await db.destroy();
    await app.close();
  });

  it('offers the button only to the charity admin of a trial organization', async () => {
    const s = (await http.get('/api/sample-data').set(as(admin)).expect(200)).body;
    expect(s).toMatchObject({ status: 'none', canLoad: true, isTrial: true });
    // الشركة التجريبية العامة ليست في فترة تجربة، فلا يظهر لها الزر
    const demo = (await http.get(`/api/platform/organizations/${await demoId()}/sample-data`).set(as(platform)).expect(200)).body;
    expect(demo.canLoad).toBe(false);
    await http.post(`/api/platform/organizations/${await demoId()}/sample-data`).set(as(platform)).expect(400);
  });

  let demoBefore: Record<string, number>;
  it('loads connected sample data across all systems into the trial organization', async () => {
    const demo = await demoId();
    demoBefore = {
      leads: await count('rw_leads', demo), entries: await count('acc_entries', demo), users: await count('users', demo),
    };
    const res = (await http.post('/api/sample-data').set(as(admin)).expect(201)).body;
    expect(res.records).toBeGreaterThan(500);
    expect(res.staff.length).toBe(7);
    expect(res.staff.every((s: { email: string }) => s.email.endsWith('.trial-one@sanabelerp.com'))).toBe(true);
    expect(res.systems.map((s: { system: string }) => s.system)).toEqual(expect.arrayContaining(['الموقع والعملاء المحتملون', 'النظام المالي', 'الموارد البشرية']));
    expect(await count('rw_leads', orgId)).toBeGreaterThan(3);
    expect(await count('acc_entries', orgId)).toBeGreaterThan(5);
    // موظف تجريبي يدخل بكلمة المرور التي ظهرت مرة واحدة
    await login(res.staff[1].email, res.staffPassword, 'trial-one');
    // لا تكرار
    await http.post('/api/sample-data').set(as(admin)).expect(409);
    const s = (await http.get('/api/sample-data').set(as(admin)).expect(200)).body;
    expect(s).toMatchObject({ status: 'loaded', canLoad: false });
    expect(s.log[0]).toMatchObject({ action: 'loaded', by: 'مدير جمعية التجربة' });
  }, 300000);

  let ownUserEmail: string;
  it('previews what conversion deletes, separating records entered by the charity', async () => {
    // بعد البيانات التجريبية: الشركة أضافت موظفًا حقيقيًا وسجلًا من عندها
    ownUserEmail = 'staff@trial-one.sa';
    await http.post('/api/users').set(as(admin)).send({ fullName: 'موظف حقيقي', email: ownUserEmail, password: 'Staff12345', roleIds: [baselineRoleId] }).expect(201);
    await db.query(`INSERT INTO kn_categories (organization_id, name) VALUES ($1, 'تصنيف أدخلته الشركة')`, [orgId]);

    const p = (await http.get(`/api/platform/organizations/${orgId}/sample-data/preview`).set(as(platform)).expect(200)).body;
    expect(p.sample.total).toBeGreaterThan(500);
    expect(p.own.total).toBe(1);
    expect(p.own.systems).toEqual([{ system: 'أرشيف المعرفة', count: 1 }]);
    expect(p.keptPeople).toEqual({ users: 1, roles: 0 });
    // مستخدم الشركة لا يصل لشاشات مدير المنصة
    await http.get(`/api/platform/organizations/${orgId}/sample-data/preview`).set(as(admin)).expect(403);
  });

  it('converts to a real organization only after typing its identifier, leaving it empty', async () => {
    await http.post(`/api/platform/organizations/${orgId}/sample-data/clear`).set(as(platform)).send({ confirm: 'wrong' }).expect(400);
    // إعدادات افتراضية فُعّلت خلال التجربة تُحذف مع ما بعد اللقطة، فيعود زرها متاحًا
    await db.query(`INSERT INTO organization_starters (organization_id, module_code, status, applied_by, applied_by_id) VALUES ($1, 'comms', 'applied', 'x', $1)`, [orgId]);
    const r = (await http.post(`/api/platform/organizations/${orgId}/sample-data/clear`).set(as(platform)).send({ confirm: 'trial-one' }).expect(201)).body;
    expect(r.sample).toBeGreaterThan(500);
    expect(r.own).toBe(1);
    expect(r.keptUsers).toBe(1);

    for (const t of ['rw_leads', 'rw_bookings', 'acc_entries', 'acc_vouchers', 'hr_employees', 'risk_register', 'mtg_meetings', 'kn_categories', 'quality_documents']) {
      expect([t, await count(t, orgId)]).toEqual([t, 0]);
    }
    // يبقى: مدير النظام والموظف الذي أضافته الشركة والدور الذي أنشأته قبل التجربة، والعقد والاشتراك
    const users = (await db.query('SELECT email FROM users WHERE organization_id = $1 ORDER BY email', [orgId])).map((u: { email: string }) => u.email);
    expect(users).toEqual(['owner@trial-one.sa', ownUserEmail]);
    expect((await db.query('SELECT name FROM roles WHERE organization_id = $1', [orgId])).map((x: { name: string }) => x.name)).toEqual(['منسق البرامج']);
    const org = (await db.query('SELECT subscription_status FROM organizations WHERE id = $1', [orgId]))[0];
    expect(org.subscription_status).toBe('trial');
    expect(await count('organization_starters', orgId)).toBe(0);
    // الإعدادات التي كانت قبل البيانات التجريبية باقية
    expect(await count('acc_settings', orgId)).toBeLessThanOrEqual(1);

    // الدخول ما زال يعمل، والأنظمة فارغة
    const again = await login('owner@trial-one.sa', 'Owner12345', 'trial-one');
    await login(ownUserEmail, 'Staff12345', 'trial-one');
    const s = (await http.get('/api/sample-data').set(as(again)).expect(200)).body;
    expect(s).toMatchObject({ status: 'cleared', canLoad: false });
    expect(s.log.map((e: { action: string }) => e.action)).toEqual(['loaded', 'cleared']);
    await http.post(`/api/platform/organizations/${orgId}/sample-data/clear`).set(as(platform)).send({ confirm: 'trial-one' }).expect(400);

    // الشركة التجريبية العامة لم تتأثر
    const demo = await demoId();
    expect({
      leads: await count('rw_leads', demo), entries: await count('acc_entries', demo), users: await count('users', demo),
    }).toEqual(demoBefore);
  }, 120000);
});
