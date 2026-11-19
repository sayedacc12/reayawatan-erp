import { Test } from '@nestjs/testing';
import { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { LifecycleService } from '../src/core/lifecycle/lifecycle.service';
import { addDays, todayRiyadh } from '../src/core/organizations/org-access';
import { configureApp } from '../src/main';

/** دورة حياة الجمعية: تنبيهات التجربة، وحذف جمعيات التجربة بعد المهلة، وإنهاء العقد بالتراضي والتصدير والإلغاء */
const DB = process.env.TEST_DATABASE_URL ?? 'postgres://erp:erp@localhost:5432/charity_erp_test';

describe('Organization lifecycle: trial deletion and mutual termination', () => {
  let app: NestExpressApplication;
  let http: ReturnType<typeof request>;
  let db: DataSource;
  let lifecycle: LifecycleService;
  let platform: string;
  const today = todayRiyadh();
  const as = (t: string) => ({ Authorization: `Bearer ${t}` });
  const login = (login: string, password: string, organization?: string) => http.post('/api/auth/login').send({ login, password, organization });
  const makeOrg = async (slug: string, sub?: { status: string; trialEndsOn?: string }) => {
    const org = (await http.post('/api/platform/organizations').set(as(platform)).send({
      name: `جمعية ${slug}`, slug, adminFullName: `مدير ${slug}`, adminEmail: `admin@${slug}.sa`, adminPassword: 'Owner12345',
    }).expect(201)).body;
    if (sub) await http.patch(`/api/platform/organizations/${org.id}/subscription`).set(as(platform)).send(sub).expect(200);
    return org.id as string;
  };
  const exists = async (id: string) => (await db.query('SELECT 1 FROM organizations WHERE id = $1', [id])).length > 0;

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
    lifecycle = app.get(LifecycleService);
    platform = (await login('admin', 'Platform123').expect(200)).body.accessToken;
  }, 120000);

  afterAll(async () => {
    await db.destroy();
    await app.close();
  });

  it('warns trial users of the days left before the trial ends and the charity is deleted', async () => {
    await makeOrg('soon', { status: 'trial', trialEndsOn: addDays(today, 5) });
    const t = (await login('admin@soon.sa', 'Owner12345', 'soon').expect(200)).body.accessToken;
    const n = (await http.get('/api/organization/lifecycle').set(as(t)).expect(200)).body;
    expect(n).toMatchObject({ reason: 'trial', daysToTrialEnd: 5, daysToDelete: 13, deleteOn: addDays(today, 13) });
  });

  it('deletes a trial charity automatically once the grace period after its trial ends is over', async () => {
    const id = await makeOrg('expired', { status: 'trial', trialEndsOn: addDays(today, -3) });
    // الدخول متوقف، والرسالة توضح موعد الحذف
    const res = await login('admin@expired.sa', 'Owner12345', 'expired').expect(401);
    expect(res.body.message).toContain('ستُحذف الجمعية وكل بياناتها نهائيًا بعد 5 أيام');

    const o = (await http.get('/api/platform/lifecycle').set(as(platform)).expect(200)).body;
    expect(o.upcoming.find((u: { slug: string }) => u.slug === 'expired')).toMatchObject({ reason: 'trial_expired', daysToDelete: 5 });

    expect(await lifecycle.sweep(today)).toEqual([]);
    expect(await exists(id)).toBe(true);
    // مدير المنصة يقصّر المهلة إلى يومين: يحين الحذف
    await http.put('/api/platform/lifecycle/settings').set(as(platform)).send({ trialGraceDays: 2 }).expect(200);
    expect(await lifecycle.sweep(today)).toEqual(['expired']);
    expect(await exists(id)).toBe(false);
    expect((await db.query('SELECT count(*)::int AS n FROM users WHERE email = $1', ['admin@expired.sa']))[0].n).toBe(0);
    const after = (await http.get('/api/platform/lifecycle').set(as(platform)).expect(200)).body;
    expect(after.deleted[0]).toMatchObject({ orgSlug: 'expired', reason: 'trial_expired', status: 'deleted' });
    await http.put('/api/platform/lifecycle/settings').set(as(platform)).send({ trialGraceDays: 7 }).expect(200);
  });

  it('terminates a contract by mutual agreement, with export, cancellation and deletion', async () => {
    const id = await makeOrg('mutual', { status: 'active' });
    const body = { agreementDate: today, charityRep: 'أحمد المدير التنفيذي', note: 'اتفاق ودي', graceDays: 7 };
    await http.post(`/api/platform/organizations/${id}/terminate`).set(as(platform)).send({ ...body, confirm: 'x' }).expect(400);
    await http.post(`/api/platform/organizations/${id}/terminate`).set(as(platform)).send({ ...body, confirm: 'mutual' }).expect(201);
    await http.post(`/api/platform/organizations/${id}/terminate`).set(as(platform)).send({ ...body, confirm: 'mutual' }).expect(409);
    const res = await login('admin@mutual.sa', 'Owner12345', 'mutual').expect(401);
    expect(res.body.message).toContain('أُنهي عقد الجمعية بالتراضي');

    // التصدير قبل الحذف: بلا كلمات مرور
    const exp = await http.get(`/api/platform/organizations/${id}/export`).set(as(platform)).expect(200);
    const data = JSON.parse(exp.text);
    expect(data.tables.users[0].email).toBe('admin@mutual.sa');
    expect(data.tables.users[0].password_hash).toBeUndefined();

    // الإلغاء خلال المهلة يعيد الجمعية
    await http.post(`/api/platform/organizations/${id}/terminate/cancel`).set(as(platform)).expect(201);
    await login('admin@mutual.sa', 'Owner12345', 'mutual').expect(200);

    // إنهاء جديد ثم الحذف الآن بعد التأكيد
    await http.post(`/api/platform/organizations/${id}/terminate`).set(as(platform)).send({ ...body, confirm: 'mutual' }).expect(201);
    await http.post(`/api/platform/organizations/${id}/delete`).set(as(platform)).send({ confirm: 'nope' }).expect(400);
    const del = (await http.post(`/api/platform/organizations/${id}/delete`).set(as(platform)).send({ confirm: 'mutual' }).expect(201)).body;
    expect(del.deleted).toBeGreaterThan(0);
    expect(await exists(id)).toBe(false);
    const history = (await db.query(`SELECT status, reason, log FROM organization_closures WHERE org_slug = 'mutual' ORDER BY created_at`));
    expect(history.map((h: { status: string }) => h.status)).toEqual(['cancelled', 'deleted']);
    expect(history[1].log.map((e: { action: string }) => e.action)).toEqual(['scheduled', 'deleted']);
  });

  it('never deletes an active charity or a trial still running', async () => {
    const active = await makeOrg('keeper', { status: 'active' });
    const trial = await makeOrg('trying', { status: 'trial', trialEndsOn: addDays(today, 1) });
    await http.post(`/api/platform/organizations/${trial}/delete`).set(as(platform)).send({ confirm: 'trying' }).expect(400);
    expect(await lifecycle.sweep(today)).toEqual([]);
    expect(await exists(active)).toBe(true);
    expect(await exists(trial)).toBe(true);
  });
});
