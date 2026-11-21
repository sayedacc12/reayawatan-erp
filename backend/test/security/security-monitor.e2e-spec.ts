import { Test } from '@nestjs/testing';
import { NestExpressApplication } from '@nestjs/platform-express';
import { randomUUID } from 'crypto';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/main';
import { SecurityDetector } from '../../src/core/security/security-detector.service';
import { SecurityMonitor } from '../../src/core/security/security-monitor.service';
import { SecurityReports } from '../../src/core/security/security-report.service';

/**
 * المراقب الأمني «سيد»: يرصد الهجوم ويتعامل مع المصدر المهاجم وحده، دون أن يتأثر بقية المستخدمين.
 * TRUST_PROXY=2 كالإنتاج، فعنوان العميل يُحدد من X-Forwarded-For: <العميل>, <Caddy>.
 */
const DB = process.env.TEST_DATABASE_URL ?? 'postgres://erp:erp@localhost:5432/charity_erp_test';

describe('Security monitor (sayed)', () => {
  let app: NestExpressApplication;
  let http: ReturnType<typeof request>;
  let db: DataSource;
  let platform: string;
  let orgAdmin: string;
  let detector: SecurityDetector;

  const from = (ip: string) => ({ 'X-Forwarded-For': `${ip}, 172.18.0.5` });
  const as = (t: string, ip = '192.0.2.200') => ({ Authorization: `Bearer ${t}`, ...from(ip) });
  const login = (ip: string, body: Record<string, unknown>) => http.post('/api/auth/login').set(from(ip)).send(body);
  const incidents = (rule: string) => db.query(`SELECT * FROM sec_incidents WHERE rule = $1 ORDER BY first_seen_at`, [rule]);
  const alerts = () => db.query(`SELECT to_email, subject FROM mail_outbox WHERE kind = 'security_alert'`);

  beforeAll(async () => {
    Object.assign(process.env, {
      DATABASE_URL: DB, JWT_SECRET: 'test-secret', PLATFORM_ADMIN_EMAIL: 'platform@test.org', PLATFORM_ADMIN_PASSWORD: 'Platform123',
      TRUST_PROXY: '2', MAIL_TRANSPORT: 'test', MAIL_FROM: 'ops@sanabel.test',
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
    detector = app.get(SecurityDetector);
    platform = (await login('192.0.2.200', { login: 'admin', password: 'Platform123' }).expect(200)).body.accessToken;
    await http.post('/api/platform/organizations').set(as(platform)).send({
      name: 'جمعية البر', slug: 'al-bir', adminFullName: 'مدير البر', adminEmail: 'admin@bir.org', adminPassword: 'Admin12345',
    }).expect(201);
    orgAdmin = (await login('192.0.2.201', { email: 'admin@bir.org', password: 'Admin12345', organization: 'al-bir' }).expect(200)).body.accessToken;
    // جعل دخول الإعداد أقدم من الآن حتى تُعد عناوينه «معروفة» وتبدأ الاختبارات من سجل هادئ
    await app.get(SecurityMonitor).flush();
    await db.query(`UPDATE sec_events SET at = at - interval '1 day'`);
  }, 120000);

  afterAll(async () => {
    for (const k of ['MAIL_TRANSPORT', 'MAIL_FROM', 'TRUST_PROXY']) delete process.env[k];
    await db.destroy();
    await app.close();
  });

  it('only platform admins with the security permission can open the monitor', async () => {
    await http.get('/api/platform/security').set(as(orgAdmin)).expect(403);
    const o = await http.get('/api/platform/security').set(as(platform)).expect(200);
    expect(o.body.status).toBe('ok');
    expect(o.body.recipients).toEqual(['ops@sanabel.test']);
  });

  it('records failed logins without passwords, and masks login names that match no account', async () => {
    await login('203.0.113.9', { login: 'Admin', password: 'secret-pass-1' }).expect(401);
    // كلمة مرور لُصقت في حقل الاسم خطأً لا تُحفظ
    await login('203.0.113.9', { login: 'MyPassw0rd!', password: 'secret-pass-2' }).expect(401);
    await app.get(SecurityMonitor).flush();
    const rows = await db.query(`SELECT * FROM sec_events WHERE type = 'login_failed' AND ip = '203.0.113.9' ORDER BY actor`);
    expect(rows[0]).toMatchObject({ actor: 'admin', route: '/api/auth/login', status: 401 });
    expect(rows[1].actor).toMatch(/^~[0-9a-f]{10}$/);
    expect(JSON.stringify(rows)).not.toMatch(/secret-pass|MyPassw0rd/i);
  });

  it('never stores secret tokens from public links', async () => {
    const token = 'Zx9-' + 'q'.repeat(40);
    await http.get(`/api/public/minutes/sign/${token}`).set(from('203.0.113.10'));
    await http.get(`/api/no-such-thing/${token}`).set(from('203.0.113.10')).expect(404);
    await app.get(SecurityMonitor).flush();
    const rows = await db.query(`SELECT * FROM sec_events WHERE ip = '203.0.113.10'`);
    expect(rows.length).toBeGreaterThan(0);
    expect(JSON.stringify(rows)).not.toContain(token);
  });

  it('blocks a brute-force source temporarily, alerts once, and leaves everyone else untouched', async () => {
    const attacker = '203.0.113.50';
    for (let i = 0; i < 10; i++) await login(attacker, { login: 'admin', password: `wrong-${i}` }).expect(401);
    const created = await detector.run();
    expect(created.map((i) => i.rule)).toEqual(['brute_force']);
    const [block] = await db.query(`SELECT * FROM sec_blocks WHERE ip = $1`, [attacker]);
    expect(block.created_by).toContain('سيد');
    // أول حظر قصير لأن العنوان قد يكون مشتركًا، ويطول إن عاد الهجوم
    const left = new Date(block.expires_at).getTime() - Date.now();
    expect(left).toBeGreaterThan(14 * 60_000);
    expect(left).toBeLessThanOrEqual(15 * 60_000);

    // المهاجم يُمنع من كل النظام، وفحص الصحة يبقى متاحًا
    const blocked = await http.get('/api/auth/org/al-bir').set(from(attacker)).expect(429);
    expect(blocked.body.message).toBe('طلبات كثيرة، حاول بعد قليل');
    await http.get('/api/health').set(from(attacker)).expect(200);
    // بقية المستخدمين يعملون كالمعتاد
    await http.get('/api/auth/org/al-bir').set(from('198.51.100.20')).expect(200);
    await http.get('/api/auth/me').set(as(orgAdmin)).expect(200);
    // موظف دخل سابقًا ويشارك المهاجم نفس العنوان (شبكة جوال) يكمل عمله
    await http.get('/api/auth/me').set(as(orgAdmin, attacker)).expect(200);

    // تنبيه واحد فقط حتى لو استمر الرصد
    expect(await alerts()).toEqual([expect.objectContaining({ to_email: 'ops@sanabel.test' })]);
    expect(await detector.run()).toEqual([]);
    expect((await alerts()).length).toBe(1);

    // الرفع اليدوي يعيد الوصول فورًا ويُسجل من رفعه
    await http.post(`/api/platform/security/blocks/${block.id}/lift`).set(as(platform)).expect(200);
    await http.get('/api/auth/org/al-bir').set(from(attacker)).expect(200);
    const [lifted] = await db.query(`SELECT lifted_by FROM sec_blocks WHERE id = $1`, [block.id]);
    expect(lifted.lifted_by).toContain('platform@test.org');
  });

  it('never blocks an address staff signed in from (office), but still alerts', async () => {
    const office = '192.0.2.201';
    for (let i = 0; i < 10; i++) await login(office, { login: 'admin@bir.org', password: `typo-${i}`, organization: 'al-bir' });
    const created = await detector.run();
    expect(created.map((i) => i.rule)).toEqual(['brute_force']);
    expect(created[0].actions.map((a) => a.kind)).toEqual(['skip']);
    expect(await db.query(`SELECT 1 FROM sec_blocks WHERE ip = $1`, [office])).toEqual([]);
  });

  it('blocks an automated scanner that walks many unknown paths', async () => {
    const scanner = '203.0.113.77';
    for (let i = 0; i < 40; i++) await http.get(`/api/wp-admin-${i}.php`).set(from(scanner)).expect(404);
    const created = await detector.run();
    expect(created.map((i) => i.rule)).toEqual(['scanner']);
    await http.get('/api/auth/org/al-bir').set(from(scanner)).expect(429);
  });

  it('alerts on an account probing records it cannot see, ends its sessions only on a strong signal, and waits for approval to suspend it', async () => {
    const probe = (n: number) => Promise.all(Array.from({ length: n }, () => http.get(`/api/beneficiaries/${randomUUID()}`).set(as(orgAdmin)).expect(404)));
    await probe(20);
    const [inc] = await detector.run();
    expect(inc).toMatchObject({ rule: 'probe', severity: 'high', pendingAction: 'suspend_user' });
    expect(inc.actions).toEqual([]);
    // تنبيه وطلب موافقة فقط: الموظف يكمل عمله
    await http.get('/api/auth/me').set(as(orgAdmin)).expect(200);

    // استمرار المحاولات حتى ثلاثة أضعاف الحد: تُنهى الجلسة تلقائيًا
    await probe(40);
    expect(await detector.run()).toEqual([]);
    const [after] = await db.query(`SELECT actions FROM sec_incidents WHERE id = $1`, [inc.id]);
    expect(after.actions.map((a: { kind: string }) => a.kind)).toEqual(['revoke']);
    // الجلسة المسروقة لم تعد صالحة، وصاحب الحساب يدخل من جديد بشكل طبيعي
    await http.get('/api/auth/me').set(as(orgAdmin)).expect(401);
    orgAdmin = (await login('192.0.2.202', { email: 'admin@bir.org', password: 'Admin12345', organization: 'al-bir' }).expect(200)).body.accessToken;
    await http.get('/api/auth/me').set(as(orgAdmin)).expect(200);
    // لا يتكرر الإجراء على نفس الطلبات القديمة (والدخول من عنوان جديد لمدير الشركة يُنبَّه عنه فقط)
    expect((await detector.run()).map((i) => i.rule)).toEqual(['new_admin_ip']);

    // الإيقاف بموافقة الإدارة فقط، ويمكن التراجع عنه
    await http.post(`/api/platform/security/incidents/${inc.id}/approve-suspend`).set(as(orgAdmin)).expect(403);
    await http.post(`/api/platform/security/incidents/${inc.id}/approve-suspend`).set(as(platform)).expect(200);
    await login('192.0.2.202', { email: 'admin@bir.org', password: 'Admin12345', organization: 'al-bir' }).expect(401);
    await http.post(`/api/platform/security/incidents/${inc.id}/reactivate`).set(as(platform)).expect(200);
    orgAdmin = (await login('192.0.2.202', { email: 'admin@bir.org', password: 'Admin12345', organization: 'al-bir' }).expect(200)).body.accessToken;
    const list = await http.get('/api/platform/security/incidents?status=active').set(as(platform)).expect(200);
    const row = list.body.rows.find((r: { id: string }) => r.id === inc.id);
    expect(row.actions.map((a: { kind: string }) => a.kind)).toEqual(['revoke', 'suspend', 'reactivate']);
    expect(row.user).toMatchObject({ email: 'admin@bir.org', org: 'جمعية البر' });
  });

  it('alerts when a platform admin signs in from a new address', async () => {
    await login('198.51.100.88', { login: 'admin', password: 'Platform123' }).expect(200);
    const created = await detector.run();
    expect(created.map((i) => i.rule)).toEqual(['new_admin_ip']);
    expect(created[0].ip).toBe('198.51.100.88');
  });

  it('lets the admin block manually, refusing internal and trusted addresses', async () => {
    await http.post('/api/platform/security/blocks').set(as(platform)).send({ ip: '10.0.0.5', minutes: 60, reason: 'تجربة' }).expect(400);
    // لا يحظر المدير نفسه
    await http.post('/api/platform/security/blocks').set(as(platform, '192.0.2.200')).send({ ip: '192.0.2.200', minutes: 60, reason: 'تجربة' }).expect(400);
    await http.put('/api/platform/security/settings').set(as(platform)).send({
      enabled: true, recipients: ['sec@sanabel.test'], autoActions: true, dailyReport: true, dailyHour: 7, blockMinutes: 30,
      trustedIps: ['198.51.100.0/24'], thresholds: { bruteForce: 10, scan: 40, probe: 20, exports: 30, errors: 20 },
    }).expect(200);
    await http.post('/api/platform/security/blocks').set(as(platform)).send({ ip: '198.51.100.7', minutes: 60, reason: 'تجربة' }).expect(400);
    await http.post('/api/platform/security/blocks').set(as(platform)).send({ ip: '203.0.113.99', minutes: 60, reason: 'عنوان مشبوه' }).expect(201);
    await http.get('/api/auth/org/al-bir').set(from('203.0.113.99')).expect(429);
    await http.put('/api/platform/security/settings').set(as(platform)).send({ enabled: true }).expect(400);
  });

  it('builds and emails the daily report once a day', async () => {
    const reports = app.get(SecurityReports);
    const r = await reports.send('2026-11-20');
    expect(r?.summary).toMatchObject({ status: 'attention', incidents: { total: 6 } });
    expect(await reports.send('2026-11-20')).toBeNull();
    const mails = await db.query(`SELECT to_email, subject FROM mail_outbox WHERE kind = 'security_daily'`);
    expect(mails).toEqual([expect.objectContaining({ to_email: 'sec@sanabel.test' })]);
    expect(mails[0].subject).toContain('يحتاج انتباهك');
    const list = await http.get('/api/platform/security/reports').set(as(platform)).expect(200);
    expect(list.body.length).toBe(1);
  });
});
