import { Test } from '@nestjs/testing';
import { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/main';
import { LifecycleService } from '../src/core/lifecycle/lifecycle.service';
import { MailService } from '../src/core/mail/mail.service';
import { smtpEnv } from '../src/core/mail/mail-settings';
import { addDays, todayRiyadh } from '../src/core/organizations/org-access';
import { Organization } from '../src/core/entities';

/** البريد الصادر: الإعدادات، والرسالة التجريبية، والطابور وإعادة المحاولة، وربطه بالطلبات وكلمة المرور والتذكيرات */
const DB = process.env.TEST_DATABASE_URL ?? 'postgres://erp:erp@localhost:5432/charity_erp_test';

describe('Outbound mail', () => {
  let app: NestExpressApplication;
  let http: ReturnType<typeof request>;
  let platform: string;
  let mail: MailService;
  let orgId: string;
  let adminId: string;

  beforeAll(async () => {
    Object.assign(process.env, {
      DATABASE_URL: DB, JWT_SECRET: 'test-secret', PLATFORM_ADMIN_EMAIL: 'platform@test.org', PLATFORM_ADMIN_PASSWORD: 'Platform123',
      PUBLIC_URL: 'https://sanabel.test',
    });
    delete process.env.MAIL_TRANSPORT;
    const { DataSource: DS } = await import('typeorm');
    const reset = new DS({ type: 'postgres', url: DB });
    await reset.initialize();
    await reset.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
    await reset.destroy();
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(moduleRef.createNestApplication<NestExpressApplication>());
    await app.init();
    http = request(app.getHttpServer());
    mail = app.get(MailService);
    platform = (await http.post('/api/auth/login').send({ login: 'admin', password: 'Platform123' }).expect(200)).body.accessToken;
    const org = await http.post('/api/platform/organizations').set(as(platform))
      .send({ name: 'جمعية البريد', slug: 'mail-org', adminFullName: 'مدير البريد', adminEmail: 'boss@mail-org.org', adminPassword: 'Admin12345' }).expect(201);
    orgId = org.body.id;
  });

  afterAll(async () => {
    for (const k of ['MAIL_TRANSPORT', 'PUBLIC_URL', 'SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASS', 'MAIL_FROM']) delete process.env[k];
    await app.get(DataSource).destroy();
    await app.close();
  });

  const as = (t: string) => ({ Authorization: `Bearer ${t}` });
  const outbox = (kind: string) => app.get(DataSource).query(`SELECT * FROM mail_outbox WHERE kind = $1 ORDER BY created_at`, [kind]);

  it('reads Gmail settings from the environment and strips app-password spaces', () => {
    const env = smtpEnv({ SMTP_USER: 'Sayed.acc1@gmail.com', SMTP_PASS: 'abcd efgh ijkl mnop' });
    expect(env).toMatchObject({ mode: 'smtp', host: 'smtp.gmail.com', port: 465, secure: true, pass: 'abcdefghijklmnop', from: 'Sayed.acc1@gmail.com' });
    expect(smtpEnv({ SMTP_USER: 'x@gmail.com' }).mode).toBe('off');
    expect(smtpEnv({}).mode).toBe('off');
  });

  it('records messages as skipped while mail is not configured, and the test button explains why', async () => {
    const st = await http.get('/api/platform/mail').set(as(platform)).expect(200);
    expect(st.body.configured).toBe(false);
    await http.post('/api/platform/mail/test').set(as(platform)).send({ to: 'me@test.org' }).expect(400);
    await http.post('/api/public/site/inquiries').send({ kind: 'demo', orgName: 'جمعية قبل الضبط', contactName: 'أحمد علي', phone: '0500000000' }).expect(201);
    expect(await outbox('inquiry_admin')).toHaveLength(0); // لا يوجد بريد إدارة معروف قبل الضبط
    expect(await mail.queue({ to: 'early@test.org', kind: 'early', subject: 'قبل الضبط', html: '<p>x</p>', text: 'x' })).toEqual([]);
    const [row] = await outbox('early');
    expect(row).toMatchObject({ status: 'skipped', html: null, last_error: 'البريد غير مضبوط على السيرفر' });
  });

  it('only the platform admin manages mail settings, with validation', async () => {
    process.env.MAIL_TRANSPORT = 'test';
    process.env.MAIL_FROM = 'sayed.acc1@gmail.com';
    await http.put('/api/platform/mail/settings').set(as(platform)).send({ adminEmails: ['bad'] }).expect(400);
    await http.put('/api/platform/mail/settings').set(as(platform)).send({ replyTo: 'nope' }).expect(400);
    const ok = await http.put('/api/platform/mail/settings').set(as(platform))
      .send({ senderName: 'سنابل', replyTo: 'Support@Sanabelerp.com', dailyLimit: 450 }).expect(200);
    expect(ok.body.settings.replyTo).toBe('support@sanabelerp.com');
    expect(ok.body.configured).toBe(true);
    const orgToken = (await http.post('/api/auth/login').send({ login: 'boss@mail-org.org', password: 'Admin12345', organization: 'mail-org' })).body.accessToken;
    await http.get('/api/platform/mail').set(as(orgToken)).expect(403);
  });

  it('sends a test message immediately with the Arabic sender name and reply-to', async () => {
    const res = await http.post('/api/platform/mail/test').set(as(platform)).send({ to: 'Me@Test.org' }).expect(201);
    expect(res.body.ok).toBe(true);
    const m = mail.sentTo('me@test.org')[0];
    expect(m.from).toBe('سنابل <sayed.acc1@gmail.com>');
    expect(m.replyTo).toBe('support@sanabelerp.com');
    expect(m.html).toContain('dir="rtl"');
    const log = await http.get('/api/platform/mail/log').set(as(platform)).expect(200);
    expect(log.body.rows[0]).toMatchObject({ to: 'me@test.org', kind: 'test', status: 'sent' });
  });

  it('notifies the admin about a new service request and thanks the requester', async () => {
    await http.post('/api/public/site/inquiries').send({
      kind: 'quote', serviceCode: 'impact', orgName: 'جمعية البر', contactName: 'أحمد علي', phone: '0501234567', email: 'Ahmad@Bir.org',
    }).expect(201);
    expect(await mail.processQueue()).toBe(2);
    const admin = mail.sentTo('sayed.acc1@gmail.com').find((x) => x.subject.includes('جمعية البر'))!;
    expect(admin.text).toContain('قياس الأثر الاجتماعي');
    expect(admin.html).toContain('https://sanabel.test/platform/inquiries');
    expect(mail.sentTo('ahmad@bir.org')[0].subject).toContain('استلمنا طلبكم');
  });

  it('respects switched-off events', async () => {
    await http.put('/api/platform/mail/settings').set(as(platform)).send({ events: { inquiryAck: false } }).expect(200);
    await http.post('/api/public/site/inquiries').send({ kind: 'consultation', orgName: 'جمعية الخير', contactName: 'سارة محمد', phone: '0501234568', email: 'sara@khair.org' }).expect(201);
    const [ack] = await outbox('inquiry_ack').then((r) => r.filter((x: { to_email: string }) => x.to_email === 'sara@khair.org'));
    expect(ack.status).toBe('skipped');
    expect(ack.html).toBeNull();
    await http.put('/api/platform/mail/settings').set(as(platform)).send({ events: { inquiryAck: true } }).expect(200);
  });

  it('emails a temporary password and wipes the message body after sending', async () => {
    const admins = await http.get(`/api/platform/organizations/${orgId}/admins`).set(as(platform)).expect(200);
    adminId = admins.body[0].id;
    const r = await http.post(`/api/platform/organizations/${orgId}/admins/${adminId}/reset-password`).set(as(platform)).send({ sendEmail: true }).expect(201);
    expect(r.body.emailedTo).toBe('boss@mail-org.org');
    await mail.processQueue();
    const m = mail.sentTo('boss@mail-org.org').at(-1)!;
    expect(m.text).toContain(r.body.password);
    expect(m.html).toContain('https://sanabel.test/o/mail-org');
    const [row] = await outbox('temp_password');
    expect(row).toMatchObject({ status: 'sent', sensitive: true, html: null, text: null });
    await http.get(`/api/platform/mail/log/${row.id}`).set(as(platform)).expect(400);
    // بدون طلب البريد لا يُرسل شيء
    const r2 = await http.post(`/api/platform/organizations/${orgId}/admins/${adminId}/reset-password`).set(as(platform)).send({}).expect(201);
    expect(r2.body.emailedTo).toBeNull();
  });

  it('reminds a trial organization once before its trial ends and again before deletion', async () => {
    const today = todayRiyadh();
    await http.patch(`/api/platform/organizations/${orgId}/subscription`).set(as(platform)).send({ status: 'trial', trialEndsOn: addDays(today, 2) }).expect(200);
    const life = app.get(LifecycleService);
    const org = await app.get(DataSource).getRepository(Organization).findOneByOrFail({ id: orgId });
    expect(await life.remindOrg(org, today)).toEqual(['boss@mail-org.org']);
    expect(await life.remindOrg(org, today)).toEqual([]); // لا تكرار
    // بعد انتهاء التجربة: تذكير بالحذف، ثم تنبيه أخير قبل الحذف بيوم
    expect(await life.remindOrg(org, addDays(today, 3))).toEqual(['boss@mail-org.org']);
    expect(await life.remindOrg(org, addDays(today, 3 + 6))).toEqual(['boss@mail-org.org']);
    const kinds = (await app.get(DataSource).query(`SELECT kind FROM mail_outbox WHERE kind LIKE 'lifecycle_%' ORDER BY created_at`)).map((r: { kind: string }) => r.kind);
    expect(kinds).toEqual(['lifecycle_trial_ending', 'lifecycle_trial_expired', 'lifecycle_final']);
    await mail.processQueue();
    expect(mail.sentTo('boss@mail-org.org').some((m) => m.subject.includes('تنبيه أخير'))).toBe(true);
  });

  it('keeps a failed message in the queue with an Arabic reason and lets the admin retry', async () => {
    delete process.env.MAIL_TRANSPORT;
    Object.assign(process.env, { SMTP_HOST: '127.0.0.1', SMTP_PORT: '1', SMTP_USER: 'sayed.acc1@gmail.com', SMTP_PASS: 'abcdabcdabcdabcd' });
    await http.post('/api/platform/mail/test').set(as(platform)).send({ to: 'x@test.org' }).expect(400);
    await mail.queue({ to: 'later@test.org', kind: 'note', subject: 'تجربة', html: '<p>مرحبا</p>', text: 'مرحبا' });
    expect(await mail.processQueue()).toBe(0);
    const [row] = await outbox('note');
    expect(row.status).toBe('queued');
    expect(row.attempts).toBe(1);
    expect(row.last_error).toContain('تعذر الاتصال');
    expect(new Date(row.next_attempt_at).getTime()).toBeGreaterThan(Date.now());
    // يعود الإرسال بعد إصلاح الإعدادات
    process.env.MAIL_TRANSPORT = 'test';
    await http.post(`/api/platform/mail/log/${row.id}/retry`).set(as(platform)).expect(201);
    expect(await mail.processQueue()).toBe(1);
    expect(mail.sentTo('later@test.org')).toHaveLength(1);
  });

  it('stops at the daily limit', async () => {
    await http.put('/api/platform/mail/settings').set(as(platform)).send({ dailyLimit: 1 }).expect(200);
    await mail.queue({ to: 'cap@test.org', kind: 'note', subject: 'حد', html: '<p>x</p>', text: 'x' });
    expect(await mail.processQueue()).toBe(0);
    const st = await http.get('/api/platform/mail').set(as(platform)).expect(200);
    expect(st.body.counts.queued).toBeGreaterThanOrEqual(1);
  });
});
