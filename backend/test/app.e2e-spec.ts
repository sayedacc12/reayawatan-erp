import { Test } from '@nestjs/testing';
import { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/main';
import { INSTALLED_MODULES } from '../src/platform/module-registry';

// وحدة اختيارية وهمية لاختبار التفعيل لكل جمعية (مثل بوابة الموقع والتبرعات مستقبلًا)
INSTALLED_MODULES.push({
  code: 'website',
  name: 'الموقع الإلكتروني',
  version: '0.0.1',
  permissions: [{ code: 'website.pages.manage', name: 'إدارة الصفحات' }],
  menu: [{ label: 'الصفحات', path: '/website/pages', permission: 'website.pages.manage' }],
});

/**
 * اختبار تكاملي على قاعدة PostgreSQL حقيقية (TEST_DATABASE_URL).
 * يمسح القاعدة بالكامل في البداية.
 */
const DB = process.env.TEST_DATABASE_URL ?? 'postgres://erp:erp@localhost:5432/charity_erp_test';

describe('Core: SSO + tenancy + roles & permissions', () => {
  let app: NestExpressApplication;
  let http: ReturnType<typeof request>;
  let platformToken: string;
  let adminToken: string;
  let orgBId: string;

  beforeAll(async () => {
    process.env.DATABASE_URL = DB;
    process.env.JWT_SECRET = 'test-secret';
    process.env.PLATFORM_ADMIN_EMAIL = 'platform@test.org';
    process.env.PLATFORM_ADMIN_PASSWORD = 'Platform123';

    const { DataSource: DS } = await import('typeorm');
    const reset = new DS({ type: 'postgres', url: DB });
    await reset.initialize();
    await reset.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
    await reset.destroy();

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(moduleRef.createNestApplication<NestExpressApplication>());
    await app.init();
    http = request(app.getHttpServer());
  });

  afterAll(async () => {
    await app.get(DataSource).destroy();
    await app.close();
  });

  const login = (email: string, password: string, organization?: string) =>
    http.post('/api/auth/login').send({ email, password, organization });
  const as = (token: string) => ({ Authorization: `Bearer ${token}` });

  it('rejects wrong password and unauthenticated access', async () => {
    await login('platform@test.org', 'wrong').expect(401);
    await http.get('/api/users').expect(401);
  });

  let usernameToken: string;
  it('platform admin logs in with username admin', async () => {
    const res = await http.post('/api/auth/login').send({ login: 'Admin', password: 'Platform123' }).expect(200);
    expect(res.body.user.username).toBe('admin');
    usernameToken = res.body.accessToken;
    await http.post('/api/auth/login').send({ login: 'nobody', password: 'Platform123' }).expect(401);
  });

  it('rejects Arabic or reused passwords on change', async () => {
    const t = usernameToken;
    const arabic = await http.post('/api/auth/change-password').set(as(t))
      .send({ currentPassword: 'Platform123', newPassword: 'كلمةسر123456' }).expect(400);
    expect(JSON.stringify(arabic.body.message)).toContain('الإنجليزية');
    const same = await http.post('/api/auth/change-password').set(as(t))
      .send({ currentPassword: 'Platform123', newPassword: 'Platform123' }).expect(400);
    expect(same.body.message).toContain('تختلف');
    await http.post('/api/platform/organizations').set(as(t)).send({
      name: 'جمعية', slug: 'ar-pass', adminFullName: 'مدير', adminEmail: 'ar@test.org', adminPassword: 'سرسرسرسر1',
    }).expect(400);
  });

  it('platform admin creates associations but cannot reach their data', async () => {
    const res = await login('PLATFORM@test.org', 'Platform123').expect(200);
    platformToken = res.body.accessToken;
    expect(res.body.user.isPlatformAdmin).toBe(true);
    expect(res.body.user.permissions).toEqual(['platform.organizations.manage', 'platform.reports.read', 'platform.subscriptions.manage', 'support.manage', 'support.reports', 'support.work']);
    expect(res.body.apps.map((a: { code: string }) => a.code)).toEqual(['platform', 'support']);

    await http.post('/api/platform/organizations').set(as(platformToken)).send({
      name: 'جمعية البر', slug: 'al-bir', adminFullName: 'مدير البر', adminEmail: 'admin@test.org', adminPassword: 'Admin12345',
    }).expect(201);
    const b = await http.post('/api/platform/organizations').set(as(platformToken)).send({
      name: 'جمعية الخير', slug: 'al-khair', adminFullName: 'مدير الخير', adminEmail: 'admin@b.org', adminPassword: 'AdminB1234',
    }).expect(201);
    orgBId = b.body.id;
    expect(b.body.userCount).toBe(1);
    await http.post('/api/platform/organizations').set(as(platformToken)).send({
      name: 'مكرر', slug: 'al-bir', adminFullName: 'مكرر', adminEmail: 'x@x.org', adminPassword: 'xxxxxxxx',
    }).expect(409);

    await http.get('/api/users').set(as(platformToken)).expect(403);
    await http.get('/api/roles').set(as(platformToken)).expect(403);
  });

  it('association admin sees every association app but not the platform', async () => {
    const res = await login('admin@test.org', 'Admin12345', 'al-bir').expect(200);
    adminToken = res.body.accessToken;
    expect(res.body.user.isSuperadmin).toBe(true);
    expect(res.body.user.organizationName).toBe('جمعية البر');
    expect(res.body.user.permissions).toContain('core.roles.manage');
    expect(res.body.user.permissions).not.toContain('platform.organizations.manage');
    expect(res.body.apps.map((a: { code: string }) => a.code)).toEqual(['beneficiaries', 'fundraising', 'projects', 'core']);
    await http.get('/api/platform/organizations').set(as(adminToken)).expect(403);

    const mods = await http.get('/api/modules').set(as(adminToken)).expect(200);
    expect(mods.body.map((m: { code: string }) => m.code)).toEqual(['beneficiaries', 'fundraising', 'projects', 'core']);
    await http.post('/api/roles').set(as(adminToken))
      .send({ name: 'تصعيد', permissions: ['platform.organizations.manage'] }).expect(400);
  });

  it('enables optional modules per association', async () => {
    const opt = await http.get('/api/platform/modules').set(as(platformToken)).expect(200);
    expect(opt.body.map((m: { code: string }) => m.code)).toEqual(['website']);

    // disabled by default: not in matrix, not grantable, not in admin perms
    let mods = await http.get('/api/modules').set(as(adminToken)).expect(200);
    expect(mods.body.map((m: { code: string }) => m.code)).toEqual(['beneficiaries', 'fundraising', 'projects', 'core']);
    await http.post('/api/roles').set(as(adminToken))
      .send({ name: 'محرر الموقع', permissions: ['website.pages.manage'] }).expect(400);

    const orgA = (await http.get('/api/platform/organizations').set(as(platformToken))).body
      .find((o: { slug: string }) => o.slug === 'al-bir');
    await http.put(`/api/platform/organizations/${orgA.id}/modules`).set(as(platformToken))
      .send({ modules: ['core'] }).expect(400);
    const upd = await http.put(`/api/platform/organizations/${orgA.id}/modules`).set(as(platformToken))
      .send({ modules: ['website'] }).expect(200);
    expect(upd.body.modules).toEqual(['website']);

    mods = await http.get('/api/modules').set(as(adminToken)).expect(200);
    expect(mods.body.map((m: { code: string }) => m.code).sort()).toEqual(['beneficiaries', 'core', 'fundraising', 'projects', 'website']);
    const me = await http.get('/api/auth/me').set(as(adminToken)).expect(200);
    expect(me.body.user.permissions).toContain('website.pages.manage');
    await http.post('/api/roles').set(as(adminToken))
      .send({ name: 'محرر الموقع', permissions: ['website.pages.manage'] }).expect(201);

    // the other association does not get it
    const bToken = (await login('admin@b.org', 'AdminB1234', 'al-khair').expect(200)).body.accessToken;
    const bMe = await http.get('/api/auth/me').set(as(bToken)).expect(200);
    expect(bMe.body.user.permissions).not.toContain('website.pages.manage');

    // disabling removes the permission immediately even though the role still lists it
    await http.put(`/api/platform/organizations/${orgA.id}/modules`).set(as(platformToken))
      .send({ modules: [] }).expect(200);
    const after = await http.get('/api/auth/me').set(as(adminToken)).expect(200);
    expect(after.body.user.permissions).not.toContain('website.pages.manage');
  });

  it('isolates data between associations', async () => {
    const users = await http.get('/api/users').set(as(adminToken)).expect(200);
    expect(users.body.map((u: { email: string }) => u.email)).toEqual(['admin@test.org']);
    const bToken = (await login('admin@b.org', 'AdminB1234', 'al-khair').expect(200)).body.accessToken;
    const bUsers = await http.get('/api/users').set(as(bToken)).expect(200);
    expect(bUsers.body.map((u: { email: string }) => u.email)).toEqual(['admin@b.org']);
    // cannot edit a user of another association
    await http.patch(`/api/users/${users.body[0].id}`).set(as(bToken)).send({ fullName: 'hack' }).expect(404);

    // suspending an association blocks its users immediately
    await http.patch(`/api/platform/organizations/${orgBId}`).set(as(platformToken)).send({ isActive: false }).expect(200);
    await http.get('/api/users').set(as(bToken)).expect(401);
    await login('admin@b.org', 'AdminB1234', 'al-khair').expect(401);
  });

  it('enforces per-permission access and blocks privilege escalation', async () => {
    const viewer = await http.post('/api/roles').set(as(adminToken))
      .send({ name: 'مشاهد المستخدمين', permissions: ['core.users.read'] }).expect(201);
    await http.post('/api/roles').set(as(adminToken))
      .send({ name: 'x', permissions: ['nope.perm'] }).expect(400);

    const user = await http.post('/api/users').set(as(adminToken)).send({
      fullName: 'موظف', email: 'staff@test.org', password: 'Staff12345', roleIds: [viewer.body.id],
    }).expect(201);
    expect(user.body.roles[0].name).toBe('مشاهد المستخدمين');

    const staff = (await login('staff@test.org', 'Staff12345', 'al-bir').expect(200)).body;
    expect(staff.user.permissions).toEqual(['core.users.read']);
    expect(staff.apps[0].menu).toEqual([{ label: 'المستخدمون', path: '/settings/users' }]);

    await http.get('/api/users').set(as(staff.accessToken)).expect(200);
    await http.get('/api/roles').set(as(staff.accessToken)).expect(403);
    await http.post('/api/users').set(as(staff.accessToken))
      .send({ fullName: 'x', email: 'x@test.org', password: 'xxxxxxxx', roleIds: [] }).expect(403);

    // manager with users.manage but without roles.manage can't hand out roles beyond own perms
    const mgrRole = await http.post('/api/roles').set(as(adminToken))
      .send({ name: 'مدير مستخدمين', permissions: ['core.users.read', 'core.users.manage'] }).expect(201);
    const admins = await http.post('/api/roles').set(as(adminToken))
      .send({ name: 'كامل', permissions: ['core.roles.manage'] }).expect(201);
    await http.post('/api/users').set(as(adminToken)).send({
      fullName: 'مدير', email: 'mgr@test.org', password: 'Mgr123456', roleIds: [mgrRole.body.id],
    }).expect(201);
    const mgr = (await login('mgr@test.org', 'Mgr123456', 'al-bir').expect(200)).body;
    await http.patch(`/api/users/${user.body.id}`).set(as(mgr.accessToken))
      .send({ roleIds: [admins.body.id] }).expect(403);
    await http.patch(`/api/users/${user.body.id}`).set(as(mgr.accessToken))
      .send({ isSuperadmin: true }).expect(403);

    // revoking takes effect immediately on existing tokens
    await http.patch(`/api/users/${user.body.id}`).set(as(adminToken))
      .send({ isActive: false }).expect(200);
    await http.get('/api/users').set(as(staff.accessToken)).expect(401);
  });

  it('keeps at least one active system admin', async () => {
    const me = (await http.get('/api/auth/me').set(as(adminToken)).expect(200)).body.user;
    await http.patch(`/api/users/${me.id}`).set(as(adminToken)).send({ isActive: false }).expect(400);
  });
});
