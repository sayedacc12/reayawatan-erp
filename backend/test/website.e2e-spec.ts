import { Test } from '@nestjs/testing';
import { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/main';

/**
 * رعاية وطن: وضع الشركة الواحدة ووحدة الموقع.
 * - عند أول تشغيل تُنشأ المنشأة ومديرها، ويدخل المدير بلا رابط منشأة.
 * - نماذج الموقع (استشارة، حاسبة، تقييم، دليل، حجز) تصل كعملاء محتملين بنتائجها المحسوبة في الخادم.
 * - الحجز لا يقبل موعدًا غير متاح ولا موعدًا محجوزًا، والإلغاء برمز سري.
 * - الصلاحيات: موظف بلا صلاحية يُمنع (403)، ومنشأة أخرى لا ترى طلبات الشركة (404).
 */
const DB = process.env.TEST_DATABASE_URL ?? 'postgres://erp:erp@localhost:5432/charity_erp_test';
const PDF = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n');

describe('Reaya Watan website module', () => {
  let app: NestExpressApplication;
  let http: ReturnType<typeof request>;
  let director: string;
  let viewer: string;
  let other: string;
  const as = (t: string) => ({ Authorization: `Bearer ${t}` });
  const visitor = { name: 'سارة أحمد', email: 'Sara@Charity.org', orgName: 'جمعية الخير', phone: '0501234567', orgType: 'جمعية صحية' };

  beforeAll(async () => {
    Object.assign(process.env, {
      DATABASE_URL: DB, JWT_SECRET: 'test-secret', COMPANY_SLUG: 'rw-test', COMPANY_NAME: 'رعاية وطن',
      DIRECTOR_EMAIL: 'director@rw.test', DIRECTOR_USERNAME: 'director', DIRECTOR_PASSWORD: 'Director123',
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
    director = (await http.post('/api/auth/login').send({ login: 'director', password: 'Director123' }).expect(200)).body.accessToken;

    // موظف يرى العملاء المحتملين فقط
    const role = await http.post('/api/roles').set(as(director)).send({ name: 'مطلع', permissions: ['website.dashboard.read', 'website.leads.read'] }).expect(201);
    await http.post('/api/users').set(as(director)).send({ fullName: 'موظف مطلع', email: 'viewer@rw.test', password: 'Viewer1234', roleIds: [role.body.id] }).expect(201);
    viewer = (await http.post('/api/auth/login').send({ login: 'viewer@rw.test', password: 'Viewer1234' }).expect(200)).body.accessToken;

    // منشأة أخرى (لفحص العزل)
    const platform = (await http.post('/api/auth/login').send({ login: 'admin', password: 'Platform123' }).expect(200)).body.accessToken;
    await http.post('/api/platform/organizations').set(as(platform))
      .send({ name: 'منشأة أخرى', slug: 'other', adminFullName: 'مدير', adminEmail: 'o@other.org', adminPassword: 'Admin12345' }).expect(201);
    other = (await http.post('/api/auth/login').send({ login: 'o@other.org', password: 'Admin12345', organization: 'other' }).expect(200)).body.accessToken;
  }, 120000);

  afterAll(async () => {
    await app.get(DataSource).destroy();
    await app.close();
  });

  it('creates the company and its director with full permissions', async () => {
    const me = await http.get('/api/auth/me').set(as(director)).expect(200);
    expect(me.body.organizationSlug ?? me.body.user?.organizationSlug).toBe('rw-test');
    expect(JSON.stringify(me.body)).toContain('website.content.manage');
  });

  it('serves the public site with the seven services in work-cycle order', async () => {
    const res = await http.get('/api/public/web').expect(200);
    expect(res.body.services.map((s: { slug: string }) => s.slug)).toEqual(['strategy', 'gov', 'finance', 'tech', 'pm', 'health', 'impact']);
    expect(res.body.content.home.title).toContain('نصنع الأثر');
    expect(res.body.content.notify).toBeUndefined();
    expect(res.body.content.booking.weekly).toBeUndefined();
  });

  it('records a consultation request as a lead and ignores bots', async () => {
    const bad = await http.post('/api/public/web/leads').send({ ...visitor, source: 'consultation', email: 'x' }).expect(400);
    expect(bad.body.message.join(' ')).toContain('البريد الإلكتروني غير صحيح');
    await http.post('/api/public/web/leads').send({ ...visitor, source: 'consultation', serviceSlug: 'gov', message: 'نحتاج لوائح' }).expect(201);
    await http.post('/api/public/web/leads').send({ ...visitor, source: 'consultation', message: 'آلي', website: 'http://spam' }).expect(201);
    const list = await http.get('/api/website/leads').set(as(director)).expect(200);
    expect(list.body.total).toBe(1);
    expect(list.body.rows[0]).toMatchObject({ source: 'consultation', status: 'new', email: 'sara@charity.org', serviceSlug: 'gov', leadNo: 1 });
  });

  it('computes calculator and assessment results on the server', async () => {
    const calc = await http.post('/api/public/web/leads').send({ ...visitor, source: 'calculator', calculator: { budget: 3000000, cost: 1500, efficiency: 10 } }).expect(201);
    expect(calc.body.result.calculator).toMatchObject({ beneficiariesNow: 2000, annualSaving: 300000, additionalBeneficiaries: 200 });
    const short = await http.post('/api/public/web/leads').send({ ...visitor, source: 'assessment', assessment: { answers: [2, 1] } }).expect(400);
    expect(short.body.message).toContain('أجيبوا عن كل الأسئلة');
    const a = await http.post('/api/public/web/leads').send({ ...visitor, source: 'assessment', assessment: { answers: [2, 1, 0, 2, 2, 1, 0] } }).expect(201);
    expect(a.body.result.assessment.score).toBe(57);
    expect(a.body.result.assessment.gaps.map((g: { service: string }) => g.service)).toEqual(['finance', 'impact', 'gov']);
    const list = await http.get('/api/website/leads?source=assessment').set(as(director)).expect(200);
    expect(list.body.rows[0].score).toBe(57);
  });

  it('lets staff follow a lead with an audited history', async () => {
    const list = await http.get('/api/website/leads').set(as(director)).expect(200);
    const id = list.body.rows[0].id;
    await http.put(`/api/website/leads/${id}`).set(as(viewer)).send({ status: 'contacted' }).expect(403);
    await http.put(`/api/website/leads/${id}`).set(as(director)).send({ status: 'contacted', note: 'اتصلنا بها', nextActionOn: '2030-01-01' }).expect(200);
    const lead = await http.get(`/api/website/leads/${id}`).set(as(viewer)).expect(200);
    expect(lead.body.status).toBe('contacted');
    const kinds = lead.body.events.map((e: { kind: string }) => e.kind);
    expect(kinds).toEqual(expect.arrayContaining(['created', 'status', 'note', 'followup']));
    expect(lead.body.related.length).toBeGreaterThan(0);
    // منشأة أخرى لا ترى الطلب
    await http.get(`/api/website/leads/${id}`).set(as(other)).expect(404);
    const otherList = await http.get('/api/website/leads').set(as(other)).expect(200);
    expect(otherList.body.total).toBe(0);
    const csv = await http.get('/api/website/leads/export').set(as(director)).expect(200);
    expect(csv.text).toContain('sara@charity.org');
  });

  it('books a free diagnostic session once per slot and lets the visitor cancel', async () => {
    // إتاحة كل الأيام لضمان مواعيد في أي يوم يعمل فيه الاختبار
    const all = { day: 0, from: '08:00', to: '20:00' };
    await http.put('/api/website/content/booking').set(as(viewer)).send({ data: {} }).expect(403);
    await http.put('/api/website/content/booking').set(as(director)).send({ data: { weekly: [0, 1, 2, 3, 4, 5, 6].map((day) => ({ ...all, day })), minNoticeHours: 1 } }).expect(200);
    await http.put('/api/website/content/booking').set(as(director)).send({ data: { weekly: [{ day: 1, from: '14:00', to: '09:00' }] } }).expect(400);
    const slots = await http.get('/api/public/web/booking/slots').expect(200);
    expect(slots.body.enabled).toBe(true);
    const slot = slots.body.days[1].slots[0];
    await http.post('/api/public/web/booking').send({ ...visitor, startsAt: '2020-01-01T09:00:00.000Z' }).expect(409);
    const ok = await http.post('/api/public/web/booking').send({ ...visitor, startsAt: slot, topic: 'الحوكمة', assessment: { answers: [2, 2, 2, 2, 2, 2, 2] } }).expect(201);
    expect(ok.body.manageToken).toHaveLength(43);
    await http.post('/api/public/web/booking').send({ ...visitor, email: 'b@b.org', startsAt: slot }).expect(409);
    const after = await http.get('/api/public/web/booking/slots').expect(200);
    expect(after.body.days.flatMap((d: { slots: string[] }) => d.slots)).not.toContain(slot);

    const bookings = await http.get('/api/website/bookings').set(as(director)).expect(200);
    expect(bookings.body).toHaveLength(1);
    expect(bookings.body[0]).toMatchObject({ status: 'booked', topic: 'الحوكمة' });
    await http.put(`/api/website/bookings/${bookings.body[0].id}`).set(as(other)).send({ status: 'confirmed' }).expect(404);
    await http.put(`/api/website/bookings/${bookings.body[0].id}`).set(as(director)).send({ status: 'confirmed', meetingUrl: 'http://x' }).expect(400);
    await http.put(`/api/website/bookings/${bookings.body[0].id}`).set(as(director)).send({ status: 'confirmed', meetingUrl: 'https://meet.example.com/abc', notifyVisitor: true }).expect(200);

    await http.get('/api/public/web/booking/manage/not-a-real-token').expect(404);
    const info = await http.get(`/api/public/web/booking/manage/${ok.body.manageToken}`).expect(200);
    expect(info.body).toMatchObject({ status: 'confirmed', cancellable: true });
    await http.post(`/api/public/web/booking/manage/${ok.body.manageToken}/cancel`).send({ reason: 'تعارض' }).expect(201);
    const again = await http.get('/api/public/web/booking/slots').expect(200);
    expect(again.body.days.flatMap((d: { slots: string[] }) => d.slots)).toContain(slot);
  });

  it('gives a guide for an email and counts the download', async () => {
    const g = await http.post('/api/website/guides').set(as(director)).send({ slug: 'gov-checklist', title: 'قائمة فحص الحوكمة', summary: 'عشرون سؤالًا', published: false }).expect(201);
    await http.put(`/api/website/guides/${g.body.id}`).set(as(director)).send({ slug: 'gov-checklist', title: 'قائمة فحص الحوكمة', summary: 'عشرون سؤالًا', published: true }).expect(400);
    await http.post(`/api/website/guides/${g.body.id}/file`).set(as(director)).attach('file', Buffer.from('not a pdf'), 'x.pdf').expect(400);
    await http.post(`/api/website/guides/${g.body.id}/file`).set(as(director)).attach('file', PDF, 'guide.pdf').expect(201);
    await http.put(`/api/website/guides/${g.body.id}`).set(as(director)).send({ slug: 'gov-checklist', title: 'قائمة فحص الحوكمة', summary: 'عشرون سؤالًا', serviceSlug: 'gov', published: true }).expect(200);
    await http.get('/api/website/guides').set(as(viewer)).expect(403);

    const site = await http.get('/api/public/web').expect(200);
    expect(site.body.guides.map((x: { slug: string }) => x.slug)).toContain('gov-checklist');
    await http.post('/api/public/web/guides/missing').send(visitor).expect(404);
    const req = await http.post('/api/public/web/guides/gov-checklist').send(visitor).expect(201);
    const file = await http.get(req.body.downloadUrl).expect(200);
    expect(file.headers['content-disposition']).toContain('attachment');
    expect(Buffer.from(file.body).subarray(0, 4).toString()).toBe('%PDF');
    await http.get('/api/public/web/guides/download/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA').expect(404);

    const list = await http.get('/api/website/guides').set(as(director)).expect(200);
    expect(list.body[0].downloads).toBe(1);
    const leads = await http.get('/api/website/leads?source=guide').set(as(director)).expect(200);
    expect(leads.body.total).toBe(1);
  });

  it('edits page content with shape validation and serves it publicly', async () => {
    await http.put('/api/website/content/home').set(as(viewer)).send({ data: {} }).expect(403);
    await http.put('/api/website/content/home').set(as(director)).send({ data: { title: 123 } }).expect(400);
    await http.put('/api/website/content/notify').set(as(director)).send({ data: { emails: ['bad'] } }).expect(400);
    const saved = await http.put('/api/website/content/home').set(as(director)).send({ data: { title: 'عنوان جديد', injected: '<script>' } }).expect(200);
    expect(saved.body.data.injected).toBeUndefined();
    const site = await http.get('/api/public/web').expect(200);
    expect(site.body.content.home.title).toBe('عنوان جديد');
    expect(site.body.content.home.lead).toContain('نقوّي الجمعيات');
    const svc = (await http.get('/api/website/services').set(as(director)).expect(200)).body[0];
    await http.put(`/api/website/services/${svc.id}`).set(as(director)).send({ ...svc, published: false }).expect(400);
    const { id: _i, organizationId: _o, createdAt: _c, updatedAt: _u, sortOrder: _s, ...body } = svc;
    await http.put(`/api/website/services/${svc.id}`).set(as(director)).send({ ...body, published: false }).expect(200);
    const after = await http.get('/api/public/web').expect(200);
    expect(after.body.services).toHaveLength(6);
  });

  it('shows a dashboard and bell tasks for new leads', async () => {
    const d = await http.get('/api/website/dashboard').set(as(director)).expect(200);
    expect(d.body.totals.total).toBeGreaterThanOrEqual(5);
    const o = await http.get('/api/website/dashboard').set(as(other)).expect(200);
    expect(o.body.totals.total).toBe(0);
  });
});
