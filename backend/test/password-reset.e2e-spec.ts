import { Test } from '@nestjs/testing';
import { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/main';

/** استعادة كلمة المرور: الطلب بلا كشف للحساب، وكلمة مؤقتة تُغيّر إلزاميًا، والسجل */
const DB = process.env.TEST_DATABASE_URL ?? 'postgres://erp:erp@localhost:5432/charity_erp_test';

describe('Password reset', () => {
  let app: NestExpressApplication;
  let http: ReturnType<typeof request>;
  let platform: string;
  let admin: string;
  let clerkId: string;
  const as = (t: string) => ({ Authorization: `Bearer ${t}` });
  const login = async (l: string, password: string, organization?: string) =>
    (await http.post('/api/auth/login').send({ login: l, password, organization }).expect(200)).body.accessToken as string;

  beforeAll(async () => {
    Object.assign(process.env, {
      DATABASE_URL: DB, JWT_SECRET: 'test-secret', PLATFORM_ADMIN_EMAIL: 'platform@test.org', PLATFORM_ADMIN_PASSWORD: 'Platform123',
    });
    const reset = new DataSource({ type: 'postgres', url: DB });
    await reset.initialize();
    await reset.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
    await reset.destroy();
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(moduleRef.createNestApplication<NestExpressApplication>());
    await app.init();
    http = request(app.getHttpServer());
    platform = await login('admin', 'Platform123');
    await http.post('/api/platform/organizations').set(as(platform)).send({
      name: 'جمعية الخير', slug: 'alkhair', adminFullName: 'مدير', adminEmail: 'alkhair@test.org', adminPassword: 'Admin12345',
    }).expect(201);
    admin = await login('alkhair@test.org', 'Admin12345', 'alkhair');
    clerkId = (await http.post('/api/users').set(as(admin)).send({ fullName: 'سارة الموظفة', email: 'clerk@test.org', password: 'Clerk12345', roleIds: [] }).expect(201)).body.id;
  });

  afterAll(async () => {
    await app.get(DataSource).destroy();
    await app.close();
  });

  it('answers the same way for existing and unknown accounts', async () => {
    const real = await http.post('/api/auth/forgot').send({ login: 'clerk@test.org', organization: 'alkhair' }).expect(200);
    const fake = await http.post('/api/auth/forgot').send({ login: 'nobody@test.org', organization: 'alkhair' }).expect(200);
    expect(real.body).toEqual(fake.body);
    // طلب ثانٍ لا ينشئ طلبًا مكررًا
    await http.post('/api/auth/forgot').send({ login: 'clerk@test.org', organization: 'alkhair' }).expect(200);
    const list = await http.get('/api/users/password-resets').set(as(admin)).expect(200);
    expect(list.body.pending).toHaveLength(1);
    expect(list.body.pending[0].name).toBe('سارة الموظفة');
    // جرس المهام عند مدير النظام
    const tasks = await http.get('/api/tasks').set(as(admin)).expect(200);
    expect(JSON.stringify(tasks.body)).toContain('نسي كلمة المرور');
  });

  it('issues a temporary password that must be changed and ends old sessions', async () => {
    const old = await login('clerk@test.org', 'Clerk12345', 'alkhair');
    const res = await http.post(`/api/users/${clerkId}/temp-password`).set(as(admin)).expect(201);
    expect(res.body.password).toMatch(/^Tmp-/);
    await http.get('/api/auth/me').set(as(old)).expect(401);
    await http.post('/api/auth/login').send({ login: 'clerk@test.org', password: 'Clerk12345', organization: 'alkhair' }).expect(401);

    const t = await login('clerk@test.org', res.body.password, 'alkhair');
    const me = await http.get('/api/auth/me').set(as(t)).expect(200);
    expect(me.body.user.mustChangePassword).toBe(true);
    expect(me.body.user.sessionsValidAfter).toBeUndefined();
    const blocked = await http.get('/api/tasks').set(as(t)).expect(403);
    expect(blocked.body.message).toContain('المؤقتة');
    // كلمة ضعيفة (بلا أرقام) مرفوضة
    await http.post('/api/auth/change-password').set(as(t)).send({ currentPassword: res.body.password, newPassword: 'onlyletters' }).expect(400);
    await http.post('/api/auth/change-password').set(as(t)).send({ currentPassword: res.body.password, newPassword: 'NewPass2026' }).expect(204);
    await http.get('/api/tasks').set(as(t)).expect(200);

    const log = await http.get('/api/users/password-resets').set(as(admin)).expect(200);
    expect(log.body.pending).toHaveLength(0);
    expect(log.body.log[0]).toMatchObject({ status: 'completed', origin: 'request', issuedBy: 'مدير' });
  });

  it('rejects an expired temporary password', async () => {
    const res = await http.post(`/api/users/${clerkId}/temp-password`).set(as(admin)).expect(201);
    await app.get(DataSource).query(`UPDATE users SET temp_password_expires_at = now() - interval '1 hour' WHERE id = $1`, [clerkId]);
    const r = await http.post('/api/auth/login').send({ login: 'clerk@test.org', password: res.body.password, organization: 'alkhair' }).expect(401);
    expect(r.body.message).toContain('انتهت صلاحية');
  });

  it('routes an org admin request to the platform owner', async () => {
    await http.post('/api/auth/forgot').send({ login: 'alkhair@test.org', organization: 'alkhair' }).expect(200);
    const list = await http.get('/api/platform/password-resets').set(as(platform)).expect(200);
    expect(list.body.pending).toHaveLength(1);
    const issued = await http.post(`/api/platform/password-resets/${list.body.pending[0].id}/issue`).set(as(platform)).expect(201);
    const t = await login('alkhair@test.org', issued.body.password, 'alkhair');
    expect((await http.get('/api/auth/me').set(as(t))).body.user.mustChangePassword).toBe(true);
    // اسم الدخول لا يكون جزءًا من كلمة المرور
    await http.post('/api/auth/change-password').set(as(t)).send({ currentPassword: issued.body.password, newPassword: 'alkhair2026' }).expect(400);
    await http.post('/api/auth/change-password').set(as(t)).send({ currentPassword: issued.body.password, newPassword: 'Admin2026x' }).expect(204);
    admin = t;
    // الموظف العادي لا يُستعاد من المنصة
    await http.post('/api/auth/forgot').send({ login: 'clerk@test.org', organization: 'alkhair' }).expect(200);
    const again = await http.get('/api/platform/password-resets').set(as(platform)).expect(200);
    expect(again.body.pending).toHaveLength(0);
  });

});
