import { Test } from '@nestjs/testing';
import { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/main';
import { BootstrapService } from '../src/core/bootstrap.service';
import { DEFAULT_ROLES } from '../src/core/roles/default-roles';
import { COMPANY_TEAM } from '../src/core/company-team';

/**
 * الأدوار الافتراضية لرعاية وطن (تُضاف مرة واحدة) والتكليفات: دور لمستخدم من تاريخ إلى تاريخ أو مفتوح، يسقط تلقائيًا أو بإنهائه.
 */
const DB = process.env.TEST_DATABASE_URL ?? 'postgres://erp:erp@localhost:5432/charity_erp_test';
const RECEIPTS = 'accounting.receipts.manage';
const day = (offset: number) => new Date(Date.now() + 3 * 3600000 + offset * 86400000).toISOString().slice(0, 10);

describe('Default company roles and temporary role assignments', () => {
  let app: NestExpressApplication;
  let http: ReturnType<typeof request>;
  let db: DataSource;
  let director: string;
  let manager: string;
  let other: string;
  let clerkId: string;
  let accountantRole: string;
  const as = (t: string) => ({ Authorization: `Bearer ${t}` });
  const login = async (l: string, password: string, organization?: string) =>
    (await http.post('/api/auth/login').send({ login: l, password, organization }).expect(200)).body.accessToken as string;
  let clerk: string;
  // الصلاحيات تُحسب مع كل طلب، فلا حاجة لدخول جديد بعد التكليف أو إنهائه
  const clerkPerms = async () => JSON.stringify((await http.get('/api/auth/me').set(as(clerk)).expect(200)).body);

  beforeAll(async () => {
    Object.assign(process.env, {
      DATABASE_URL: DB, JWT_SECRET: 'test-secret', COMPANY_SLUG: 'rw-roles', COMPANY_NAME: 'رعاية وطن',
      DIRECTOR_EMAIL: 'director@rw.test', DIRECTOR_USERNAME: 'director', DIRECTOR_PASSWORD: 'RwAdmin2026',
      PLATFORM_ADMIN_EMAIL: 'platform@test.org', PLATFORM_ADMIN_PASSWORD: 'Platform123', UPLOAD_DIR: '/tmp/rw-test-uploads',
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
    // المدير يُنشأ في أول تشغيل، والأدوار الافتراضية بعده: تشغيل ثانٍ كما يحدث عند إعادة تشغيل الخادم
    await app.get(BootstrapService).onApplicationBootstrap();
    director = await login('director', 'RwAdmin2026');

    const roles = (await http.get('/api/roles').set(as(director)).expect(200)).body as { id: string; name: string }[];
    accountantRole = roles.find((r) => r.name === 'المحاسب')!.id;
    // مسؤول مستخدمين لا يملك صلاحيات المالية، وموظف بلا أدوار
    const usersOnly = (await http.post('/api/roles').set(as(director)).send({ name: 'مستخدمون فقط', permissions: ['core.users.read', 'core.users.manage'] }).expect(201)).body.id;
    await http.post('/api/users').set(as(director)).send({ fullName: 'مسؤول المستخدمين', email: 'manager@rw.test', password: 'Manager1234', roleIds: [usersOnly] }).expect(201);
    clerkId = (await http.post('/api/users').set(as(director)).send({ fullName: 'أحمد الموظف', email: 'clerk@rw.test', password: 'Clerk12345', roleIds: [] }).expect(201)).body.id;
    manager = await login('manager@rw.test', 'Manager1234');
    clerk = await login('clerk@rw.test', 'Clerk12345');

    const platform = await login('admin', 'Platform123');
    await http.post('/api/platform/organizations').set(as(platform))
      .send({ name: 'منشأة أخرى', slug: 'other', adminFullName: 'مدير', adminEmail: 'o@other.org', adminPassword: 'Admin12345' }).expect(201);
    other = await login('o@other.org', 'Admin12345', 'other');
  }, 180000);

  afterAll(async () => {
    await db.destroy();
    await app.close();
  });

  it('adds the company team once, each with open assignments for their roles and no usable password', async () => {
    const users = (await http.get('/api/users').set(as(director)).expect(200)).body as { id: string; email: string }[];
    const list = (await http.get('/api/users/assignments').set(as(director)).expect(200)).body as { userId: string; roleName: string; endDate: string | null; state: string }[];
    for (const m of COMPANY_TEAM) {
      const u = users.find((x) => x.email === m.email.toLowerCase());
      expect(u).toBeDefined();
      const mine = list.filter((a) => a.userId === u!.id);
      expect(mine.map((a) => a.roleName).sort()).toEqual([...m.roles].sort());
      expect(mine.every((a) => a.endDate === null && a.state === 'active')).toBe(true);
    }
    // لا يدخل أحد قبل أن يصدر له المدير كلمة مؤقتة
    await http.post('/api/auth/login').send({ login: COMPANY_TEAM[1].email, password: 'Anything123' }).expect(401);
    // إنهاء تكليف ثم إعادة التشغيل لا يعيده
    const one = (await http.get('/api/users/assignments').set(as(director))).body as { id: string }[];
    await http.post(`/api/users/assignments/${one[0].id}/end`).set(as(director)).expect(201);
    const before = one.length;
    await app.get(BootstrapService).onApplicationBootstrap();
    expect(((await http.get('/api/users/assignments').set(as(director))).body as unknown[]).length).toBe(before);
  });

  it('adds the default roles to the company once, and never brings back a deleted one', async () => {
    const names = ((await http.get('/api/roles').set(as(director)).expect(200)).body as { name: string }[]).map((r) => r.name);
    for (const r of DEFAULT_ROLES) expect(names).toContain(r.name);
    const exec = ((await http.get('/api/roles').set(as(director))).body as { id: string; name: string }[]).find((r) => r.name === 'المدير التنفيذي')!;
    await http.delete(`/api/roles/${exec.id}`).set(as(director)).expect((r) => expect([200, 204]).toContain(r.status));
    await app.get(BootstrapService).onApplicationBootstrap();
    const after = ((await http.get('/api/roles').set(as(director))).body as { name: string }[]).map((r) => r.name);
    expect(after).not.toContain('المدير التنفيذي');
    // المنشأة الأخرى لا تأخذ أدوار الشركة
    const otherNames = ((await http.get('/api/roles').set(as(other)).expect(200)).body as { name: string }[]).map((r) => r.name);
    expect(otherNames).not.toContain('المحاسب');
  });

  it('grants the role\'s permissions only while the assignment is in force, and ending it removes them', async () => {
    expect(await clerkPerms()).not.toContain(RECEIPTS);
    // تكليف يبدأ غدًا: لا أثر له اليوم
    const future = (await http.post(`/api/users/${clerkId}/assignments`).set(as(director))
      .send({ roleId: accountantRole, startDate: day(1), endDate: day(30) }).expect(201)).body;
    expect(future.state).toBe('upcoming');
    expect(await clerkPerms()).not.toContain(RECEIPTS);
    await http.post(`/api/users/assignments/${future.id}/end`).set(as(director)).expect(201);

    // تكليف مفتوح (إلى أن يأتي تعيين جديد) يبدأ اليوم
    const open = (await http.post(`/api/users/${clerkId}/assignments`).set(as(director))
      .send({ roleId: accountantRole, startDate: day(0), note: 'إلى أن يأتي تعيين جديد' }).expect(201)).body;
    expect(open).toMatchObject({ state: 'active', endDate: null, roleName: 'المحاسب', userName: 'أحمد الموظف' });
    expect(await clerkPerms()).toContain(RECEIPTS);
    // لا تكليفان متداخلان بالدور نفسه
    await http.post(`/api/users/${clerkId}/assignments`).set(as(director)).send({ roleId: accountantRole, startDate: day(5), endDate: day(6) }).expect(409);

    const list = (await http.get('/api/users/assignments').set(as(director)).expect(200)).body as { id: string }[];
    expect(list.map((a) => a.id)).toEqual(expect.arrayContaining([open.id, future.id]));

    await http.post(`/api/users/assignments/${open.id}/end`).set(as(director)).expect(201);
    expect(await clerkPerms()).not.toContain(RECEIPTS);
    await http.post(`/api/users/assignments/${open.id}/end`).set(as(director)).expect(409);
  });

  it('drops an assignment automatically after its end date', async () => {
    const a = (await http.post(`/api/users/${clerkId}/assignments`).set(as(director))
      .send({ roleId: accountantRole, startDate: day(0), endDate: day(0) }).expect(201)).body;
    expect(await clerkPerms()).toContain(RECEIPTS);
    // نقل التكليف إلى الماضي كأن مدته انقضت
    await db.query('UPDATE role_assignments SET start_date = $2, end_date = $3 WHERE id = $1', [a.id, day(-10), day(-1)]);
    expect(await clerkPerms()).not.toContain(RECEIPTS);
    const row = ((await http.get('/api/users/assignments').set(as(director))).body as { id: string; state: string }[]).find((x) => x.id === a.id)!;
    expect(row.state).toBe('expired');
    await http.post(`/api/users/${clerkId}/assignments`).set(as(director)).send({ roleId: accountantRole, startDate: day(-5), endDate: day(-1) }).expect(400);
  });

  it('needs the users permission, cannot grant what the actor lacks, and stays inside the organization', async () => {
    await http.get('/api/users/assignments').set(as(clerk)).expect(403);
    await http.post(`/api/users/${clerkId}/assignments`).set(as(clerk)).send({ roleId: accountantRole, startDate: day(0) }).expect(403);
    // مسؤول المستخدمين لا يمنح صلاحيات مالية لا يملكها
    await http.post(`/api/users/${clerkId}/assignments`).set(as(manager)).send({ roleId: accountantRole, startDate: day(0) }).expect(403);

    // ولا يكلّف نفسه ولا يضيف لنفسه دورًا (حتى لا يجعل تكليفًا مؤقتًا دائمًا)
    const me = ((await http.get('/api/users').set(as(director))).body as { id: string; email: string }[]).find((u) => u.email === 'manager@rw.test')!;
    const usersOnly = ((await http.get('/api/roles').set(as(director))).body as { id: string; name: string }[]).find((r) => r.name === 'مستخدمون فقط')!.id;
    await http.post(`/api/users/${me.id}/assignments`).set(as(manager)).send({ roleId: usersOnly, startDate: day(1) }).expect(403);
    await http.post(`/api/users/${clerkId}/assignments`).set(as(director)).send({ roleId: accountantRole, startDate: '2026-11-22T23:30:00-05:00' }).expect(400);

    // منشأة أخرى: المستخدم والتكليف غير موجودين لها
    await http.post(`/api/users/${clerkId}/assignments`).set(as(other)).send({ roleId: accountantRole, startDate: day(0) }).expect(404);
    const mine = (await http.get('/api/users/assignments').set(as(director))).body as { id: string }[];
    await http.post(`/api/users/assignments/${mine[0].id}/end`).set(as(other)).expect(404);
    expect((await http.get('/api/users/assignments').set(as(other)).expect(200)).body).toEqual([]);
    // ودور منشأة أخرى لا يُسند هنا
    const otherRole = (await http.post('/api/roles').set(as(other)).send({ name: 'دور آخر', permissions: ['accounting.dashboard.read'] }).expect(201)).body.id;
    await http.post(`/api/users/${clerkId}/assignments`).set(as(director)).send({ roleId: otherRole, startDate: day(0) }).expect(400);
  });
});
