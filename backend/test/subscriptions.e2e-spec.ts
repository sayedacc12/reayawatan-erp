import { Test } from '@nestjs/testing';
import { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { MailService } from '../src/core/mail/mail.service';
import { configureApp } from '../src/main';
import { DEFAULT_CLAUSES } from '../src/core/subscriptions/contract-defaults';

/**
 * دورة اشتراك جمعية كاملة: طلب تسجيل بمستند الترخيص ← إرجاع واستكمال ← اعتماد بشاشات وقيمة
 * وفترة تجريبية ← دخول بالشاشات المسموحة فقط ← عقد إلكتروني من بنود المكتبة ← توقيع وتفعيل.
 */
const DB = process.env.TEST_DATABASE_URL ?? 'postgres://erp:erp@localhost:5432/charity_erp_test';
const PDF = Buffer.from('%PDF-1.4\n% test license\n');

describe('Association subscriptions & e-contracts', () => {
  let app: NestExpressApplication;
  let http: ReturnType<typeof request>;
  let platform: string;
  let token: string;
  let appId: string;
  let orgId: string;
  let contractId: string;
  let signPath: string;

  beforeAll(async () => {
    process.env.DATABASE_URL = DB;
    process.env.JWT_SECRET = 'test-secret';
    process.env.PLATFORM_ADMIN_EMAIL = 'platform@test.org';
    process.env.PLATFORM_ADMIN_PASSWORD = 'Platform123';
    process.env.UPLOAD_DIR = '/tmp/sanabel-test-uploads';
    process.env.MAIL_TRANSPORT = 'test';
    process.env.PUBLIC_URL = 'https://sanabel.test';
    const { DataSource: DS } = await import('typeorm');
    const reset = new DS({ type: 'postgres', url: DB });
    await reset.initialize();
    await reset.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
    await reset.destroy();
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(moduleRef.createNestApplication<NestExpressApplication>());
    await app.init();
    http = request(app.getHttpServer());
    platform = (await http.post('/api/auth/login').send({ login: 'admin', password: 'Platform123' }).expect(200)).body.accessToken;
  });

  afterAll(async () => {
    delete process.env.MAIL_TRANSPORT;
    delete process.env.PUBLIC_URL;
    await app.get(DataSource).destroy();
    await app.close();
  });

  const as = (t: string) => ({ Authorization: `Bearer ${t}` });
  const fields = {
    orgName: 'جمعية النماء الخيرية', proposedSlug: 'al-namaa', city: 'جدة', orgEmail: 'info@namaa.org', orgPhone: '0126000000',
    licenseNumber: '1234', licenseStartDate: '2020-01-01',
    directorName: 'خالد العتيبي', directorPhone: '0500000001', directorEmail: 'ceo@namaa.org',
    boardName: 'سعد الحربي', boardPosition: 'رئيس مجلس الإدارة', boardPhone: '0500000002', boardEmail: 'chair@namaa.org',
    adminFullName: 'مدير نظام النماء', adminEmail: 'admin@namaa.org', adminPassword: 'Namaa12345',
  };
  const form = (req: request.Test, data: Record<string, string>, file = true) => {
    for (const [k, v] of Object.entries(data)) req.field(k, v);
    return file ? req.attach('license', PDF, 'license.pdf') : req;
  };

  it('seeds the proposed contract draft as clause objects', async () => {
    const res = await http.get('/api/platform/contract-clauses').set(as(platform)).expect(200);
    expect(res.body).toHaveLength(DEFAULT_CLAUSES.length);
    expect(res.body[0].title).toBe('التمهيد');
    expect(res.body.filter((c: { isMandatory: boolean }) => c.isMandatory).length).toBeGreaterThan(3);
  });

  it('requires the license document and the main data', async () => {
    await form(http.post('/api/public/registrations'), fields, false).expect(400);
    // أخطاء جوهرية في الجوالات والبريد والأسماء والترخيص وتأكيد كلمة المرور، في طلب واحد (النقطة العامة محدودة المعدل)
    const bad = await form(http.post('/api/public/registrations'), {
      ...fields, directorPhone: '0612345678', boardPhone: '0555555555', orgPhone: '12345', directorEmail: 'ceo@gmail.con',
      boardEmail: 'chair@namaa', adminEmail: 'مدير@namaa.org', directorName: 'خالد', boardName: 'سعد 2 الحربي',
      licenseNumber: 'abc', licenseEndDate: '2019-01-01', adminPasswordConfirm: 'Other12345',
    }).expect(400);
    const msg = JSON.stringify(bad.body.message);
    for (const text of ['جوال المدير التنفيذي', 'جوال عضو مجلس الإدارة', 'هاتف الشركة', 'gmail.com', 'بريد عضو مجلس الإدارة',
      'بالحروف الإنجليزية', 'الاسم الكامل', 'أرقام', 'رقم الترخيص', 'نهاية الترخيص', 'تأكيد كلمة المرور']) {
      expect(msg).toContain(text);
    }
    await form(http.post('/api/public/registrations'), fields)
      .field('licenseStartDate', '2999-01-01').expect(400);
  });

  it('association submits and tracks its application', async () => {
    const res = await form(http.post('/api/public/registrations'), { ...fields, directorPhone: '+966 50 000 0001', boardPhone: '٠٥٠٠٠٠٠٠٠٢', adminPasswordConfirm: fields.adminPassword }).expect(201);
    expect(res.body.number).toMatch(/^SUB-\d{4}-0001$/);
    token = res.body.token;
    const track = await http.get(`/api/public/registrations/${token}`).expect(200);
    expect(track.body.status).toBe('submitted');
    expect(track.body.data.directorName).toBe('خالد العتيبي');
    expect(track.body.data.directorPhone).toBe('0500000001');
    expect(track.body.data.boardPhone).toBe('0500000002');
    expect(JSON.stringify(track.body)).not.toContain('Hash');
    // نفس بريد مدير النظام في طلب آخر قيد المراجعة
    await form(http.post('/api/public/registrations'), fields).expect(409);
  });

  it('platform returns it for completion and the association resubmits', async () => {
    const list = await http.get('/api/platform/applications').set(as(platform)).expect(200);
    appId = list.body[0].id;
    const file = await http.get(`/api/platform/applications/${appId}/license`).set(as(platform)).expect(200);
    expect(file.headers['content-type']).toContain('application/pdf');
    await http.post(`/api/platform/applications/${appId}/return`).set(as(platform)).send({ note: 'أرفق الترخيص المحدّث' }).expect(200);
    let track = await http.get(`/api/public/registrations/${token}`).expect(200);
    expect(track.body.status).toBe('returned');
    expect(track.body.reviewNote).toBe('أرفق الترخيص المحدّث');
    await http.put(`/api/public/registrations/${token}`).field('licenseNumber', '5678').attach('license', PDF, 'new.pdf').expect(200);
    track = await http.get(`/api/public/registrations/${token}`).expect(200);
    expect(track.body.status).toBe('submitted');
    expect(track.body.data.licenseNumber).toBe('5678');
    await http.put(`/api/public/registrations/${token}`).field('city', 'مكة').expect(400);
  });

  it('approves with chosen screens, price and a trial, generating links', async () => {
    const screens = await http.get('/api/platform/screens').set(as(platform)).expect(200);
    const web = screens.body.find((m: { code: string }) => m.code === 'website');
    expect(web.screens.length).toBeGreaterThan(3);
    expect(screens.body.find((m: { code: string }) => m.code === 'core').locked).toBe(true);

    const body = {
      slug: 'al-namaa', allScreens: false, screens: ['/website/leads', '/website/bookings'], modules: [],
      price: 1000, billingCycle: 'monthly', months: 12, trialDays: 14, startsOn: '2026-12-01',
    };
    await http.post(`/api/platform/applications/${appId}/approve`).set(as(platform)).send({ ...body, screens: ['/nope'] }).expect(400);
    const res = await http.post(`/api/platform/applications/${appId}/approve`).set(as(platform)).send(body).expect(200);
    expect(res.body.links).toEqual({ staff: '/o/al-namaa', portal: '/portal/al-namaa' });
    expect(res.body.generatedPassword).toBeNull();
    // رسالة ترحيب لمدير النظام برابط الدخول، بلا كلمة مرور لأنه اختارها بنفسه
    expect(res.body.emailedTo).toBe('admin@namaa.org');
    await app.get(MailService).processQueue();
    const welcome = app.get(MailService).sentTo('admin@namaa.org')[0];
    expect(welcome.html).toContain('https://sanabel.test/o/al-namaa');
    expect(welcome.text).not.toContain('Namaa12345');
    orgId = res.body.organizationId;
    contractId = res.body.contractId;
    await http.post(`/api/platform/applications/${appId}/approve`).set(as(platform)).send(body).expect(400);

    const orgs = await http.get('/api/platform/organizations').set(as(platform)).expect(200);
    const org = orgs.body.find((o: { id: string }) => o.id === orgId);
    expect(org.state).toBe('trial');
    expect(org.hasProfile).toBe(true);
    expect(org.contractStatus).toBe('draft');
  });

  it('association admin sees only the allowed screens during the trial', async () => {
    const res = await http.post('/api/auth/login').send({ login: 'admin@namaa.org', password: 'Namaa12345', organization: 'al-namaa' }).expect(200);
    const t = res.body.accessToken;
    const web = res.body.apps.find((a: { code: string }) => a.code === 'website');
    expect(web.menu.map((m: { path: string }) => m.path)).toEqual(['/website/leads', '/website/bookings']);
    expect(res.body.apps.find((a: { code: string }) => a.code === 'core')).toBeTruthy();
    expect(res.body.screens.hidden).toContain('/website/guides');
    expect(res.body.user.permissions).toContain('website.leads.read');
    expect(res.body.user.permissions).not.toContain('website.guides.manage');
    expect(res.body.user.permissions).not.toContain('website.settings.manage');
    await http.get('/api/website/guides').set(as(t)).expect(403);
    await http.get('/api/website/leads').set(as(t)).expect(200);
  });

  it('platform edits the contract clauses and keeps mandatory ones', async () => {
    const c = (await http.get(`/api/platform/contracts/${contractId}`).set(as(platform)).expect(200)).body;
    expect(c.status).toBe('draft');
    expect(c.items).toHaveLength(DEFAULT_CLAUSES.length);
    const withoutMandatory = c.items.filter((i: { title: string }) => i.title !== 'التمهيد');
    await http.put(`/api/platform/contracts/${contractId}`).set(as(platform)).send({ items: withoutMandatory }).expect(400);
    const optional = c.items.filter((i: { mandatory: boolean }) => !i.mandatory);
    const items = [
      ...c.items.filter((i: { title: string }) => i.title !== optional[0].title),
      { key: 'custom-1', clauseId: null, title: 'ملحق التدريب', paragraphs: ['يقدم الطرف الأول تدريبًا لـ {{اسم الشركة}}.'], mandatory: true },
    ];
    const upd = await http.put(`/api/platform/contracts/${contractId}`).set(as(platform)).send({ items }).expect(200);
    expect(upd.body.items).toHaveLength(DEFAULT_CLAUSES.length);
    expect(upd.body.items.at(-1).mandatory).toBe(false);

    const preview = await http.get(`/api/platform/contracts/${contractId}/preview`).set(as(platform)).expect(200);
    const text = JSON.stringify(preview.body.rendered);
    expect(text).toContain('جمعية النماء الخيرية');
    expect(text).toContain('5678');
    expect(text).toContain('1,150.00 ريال سعودي');
    expect(text).toContain('13,800.00 ريال سعودي');
    expect(text).toContain('/o/al-namaa');
    expect(text).toContain('هـ');
    expect(preview.body.unknown).toEqual([]);
  });

  it('sends, the association requests a change, then signs and the subscription activates', async () => {
    const sent = await http.post(`/api/platform/contracts/${contractId}/send`).set(as(platform)).expect(200);
    expect(sent.body.status).toBe('sent');
    expect(sent.body.contentHash).toMatch(/^[a-f0-9]{64}$/);
    signPath = sent.body.signPath;
    // رابط التوقيع يصل بالبريد للمدير التنفيذي وعضو المجلس وبريد الشركة
    expect([...sent.body.emailed].sort()).toEqual(['ceo@namaa.org', 'chair@namaa.org', 'info@namaa.org']);
    await app.get(MailService).processQueue();
    expect(app.get(MailService).sentTo('chair@namaa.org')[0].html).toContain(`https://sanabel.test${signPath}`);
    const tok = signPath.split('/').pop()!;
    await http.put(`/api/platform/contracts/${contractId}`).set(as(platform)).send({ items: [] }).expect(400);

    const pub = await http.get(`/api/public/contracts/${tok}`).expect(200);
    expect(pub.body.organizationName).toBe('جمعية النماء الخيرية');
    expect(pub.body.rendered.length).toBe(DEFAULT_CLAUSES.length);

    await http.post(`/api/public/contracts/${tok}/request-changes`).send({ note: 'نرجو جعل السداد ربع سنوي' }).expect(200);
    let c = (await http.get(`/api/platform/contracts/${contractId}`).set(as(platform))).body;
    expect(c.status).toBe('changes_requested');
    expect(c.changeRequest).toContain('ربع سنوي');
    const terms = { ...c.terms, billingCycle: 'quarterly', price: 3000, allScreens: false, screens: c.terms.screens };
    await http.put(`/api/platform/contracts/${contractId}`).set(as(platform)).send({ terms }).expect(200);
    await http.post(`/api/platform/contracts/${contractId}/send`).set(as(platform)).expect(200);

    const sign = { signerName: 'خالد العتيبي', signerTitle: 'المدير التنفيذي', licenseNumber: '0000', agree: true };
    await http.post(`/api/public/contracts/${tok}/sign`).send(sign).expect(400);
    await http.post(`/api/public/contracts/${tok}/sign`).send({ ...sign, licenseNumber: '5678', agree: false }).expect(400);
    const signed = await http.post(`/api/public/contracts/${tok}/sign`).send({ ...sign, licenseNumber: '5678' }).expect(200);
    expect(signed.body.status).toBe('signed');
    await http.post(`/api/public/contracts/${tok}/sign`).send({ ...sign, licenseNumber: '5678' }).expect(400);

    c = (await http.get(`/api/platform/contracts/${contractId}`).set(as(platform))).body;
    expect(c.history.map((h: { step: string }) => h.step)).toEqual(['created', 'edited', 'sent', 'emailed', 'changes_requested', 'edited', 'sent', 'emailed', 'signed']);
    const org = (await http.get(`/api/platform/organizations/${orgId}/details`).set(as(platform))).body.organization;
    expect(org.state).toBe('active');
    expect(org.subscriptionStartsOn).toBe('2026-12-01');
    expect(org.subscriptionEndsOn).toBe('2027-11-30');
    expect(org.billingCycle).toBe('quarterly');
    const track = await http.get(`/api/public/registrations/${token}`).expect(200);
    expect(track.body.contract.status).toBe('signed');
  });

  it('blocks login when the trial or subscription ends', async () => {
    await http.patch(`/api/platform/organizations/${orgId}/subscription`).set(as(platform))
      .send({ status: 'trial', trialEndsOn: '2020-01-01' }).expect(200);
    const res = await http.post('/api/auth/login').send({ login: 'admin@namaa.org', password: 'Namaa12345', organization: 'al-namaa' }).expect(401);
    expect(res.body.message).toContain('الفترة التجريبية');
    await http.patch(`/api/platform/organizations/${orgId}/subscription`).set(as(platform))
      .send({ status: 'active', startsOn: '2026-01-01', endsOn: '2099-12-31' }).expect(200);
    await http.post('/api/auth/login').send({ login: 'admin@namaa.org', password: 'Namaa12345', organization: 'al-namaa' }).expect(200);
  });

  it('platform changes the allowed screens later', async () => {
    await http.put(`/api/platform/organizations/${orgId}/access`).set(as(platform))
      .send({ allScreens: true, screens: [], modules: [] }).expect(200);
    const res = await http.post('/api/auth/login').send({ login: 'admin@namaa.org', password: 'Namaa12345', organization: 'al-namaa' }).expect(200);
    expect(res.body.user.permissions).toContain('website.guides.manage');
    expect(res.body.screens.hidden).toEqual([]);
  });

  it('records main data for an association created before subscriptions', async () => {
    const legacy = await http.post('/api/platform/organizations').set(as(platform)).send({
      name: 'جمعية قديمة', slug: 'old-org', adminFullName: 'مدير', adminEmail: 'old@test.org', adminPassword: 'OldOrg1234',
    }).expect(201);
    const { adminFullName, adminEmail, adminPassword, ...main } = fields;
    void adminFullName; void adminEmail; void adminPassword;
    await form(http.post('/api/platform/applications').set(as(platform)), { ...main, organizationId: legacy.body.id }).expect(201);
    const details = await http.get(`/api/platform/organizations/${legacy.body.id}/details`).set(as(platform)).expect(200);
    expect(details.body.profile.status).toBe('approved');
    expect(details.body.organization.state).toBe('active');
    const ct = await http.post(`/api/platform/organizations/${legacy.body.id}/contracts`).set(as(platform)).expect(201);
    expect(ct.body.status).toBe('draft');
    await http.post(`/api/platform/organizations/${legacy.body.id}/contracts`).set(as(platform)).expect(409);
  });

  it('manages the clause library and reports', async () => {
    const created = await http.post('/api/platform/contract-clauses').set(as(platform))
      .send({ title: 'بند جديد', paragraphs: ['نص {{اسم الشركة}}', '  '] }).expect(201);
    expect(created.body.paragraphs).toEqual(['نص {{اسم الشركة}}']);
    await http.put(`/api/platform/contract-clauses/${created.body.id}`).set(as(platform))
      .send({ title: 'بند معدل', paragraphs: ['نص'], isActive: false }).expect(200);
    await http.delete(`/api/platform/contract-clauses/${created.body.id}`).set(as(platform)).expect(204);
    const restored = await http.post('/api/platform/contract-clauses/restore-defaults').set(as(platform)).expect(200);
    expect(restored.body).toHaveLength(DEFAULT_CLAUSES.length);
    await http.put('/api/platform/provider').set(as(platform)).send({
      name: 'شركة سنابل', crNumber: '4030000000', vatNumber: '300000000000003', address: 'جدة', email: 'a@b.sa', courtCity: 'جدة', vatRate: 15,
    }).expect(200);

    const r = await http.get('/api/platform/reports/subscriptions').set(as(platform)).expect(200);
    expect(r.body.totals.organizations).toBe(2);
    expect(r.body.applications.approved).toBe(2);
    expect(r.body.contracts.signed).toBe(1);
    expect(r.body.totals.annualRevenue).toBe(12000);
    expect(r.body.screens.length).toBeGreaterThan(3);
  });
});
