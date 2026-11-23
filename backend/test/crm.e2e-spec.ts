import { Test } from '@nestjs/testing';
import { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/main';
import { normName, normPhone } from '../src/modules/crm/crm-core.service';
import { LeadsService } from '../src/modules/crm/leads.service';
import { FormsService } from '../src/modules/website/forms.service';

jest.setTimeout(120_000);

const DB = process.env.TEST_DATABASE_URL ?? 'postgres://erp:erp@localhost:5432/charity_erp_test';

describe('CRM rules', () => {
  it('normalizes phones and names for duplicate detection', () => {
    expect(normPhone('+966 55 123 4567')).toBe('0551234567');
    expect(normPhone('٠٥٥١٢٣٤٥٦٧')).toBe('0551234567');
    expect(normName('  مؤسسة  الإحسان ')).toBe(normName('مؤسسه الاحسان'));
  });
});

describe('CRM module (phase 1)', () => {
  let app: NestExpressApplication;
  let http: ReturnType<typeof request>;
  let db: DataSource;
  let admin: string;
  let sales: string;
  let sales2: string;
  let viewer: string;
  let merger: string;
  let other: string;
  let salesId: string;
  let sales2Id: string;
  let viewerId: string;
  const as = (t: string) => ({ Authorization: `Bearer ${t}` });
  const login = async (login: string, password: string, organization?: string) =>
    (await http.post('/api/auth/login').send({ login, password, organization }).expect(200)).body.accessToken as string;
  const C = '/api/crm';
  const ids: Record<string, string> = {};

  beforeAll(async () => {
    Object.assign(process.env, {
      DATABASE_URL: DB, JWT_SECRET: 'test-secret', UPLOAD_DIR: '/tmp/sanabel-test-uploads', PLATFORM_ADMIN_EMAIL: 'platform@test.org', PLATFORM_ADMIN_PASSWORD: 'Platform123',
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
    for (const slug of ['crm', 'crm2']) {
      await http.post('/api/platform/organizations').set(as(platform)).send({
        name: `جمعية ${slug}`, slug, adminFullName: `مدير ${slug}`, adminEmail: `${slug}@test.org`, adminPassword: 'Admin12345',
      }).expect(201);
    }
    admin = await login('crm@test.org', 'Admin12345', 'crm');
    other = await login('crm2@test.org', 'Admin12345', 'crm2');
    const mkRole = async (name: string, permissions: string[]) => (await http.post('/api/roles').set(as(admin)).send({ name, permissions }).expect(201)).body.id;
    const salesRole = await mkRole('موظف مبيعات', ['crm.records.read', 'crm.records.manage', 'partnerships.partners.read']);
    const mergeRole = await mkRole('مدقق بيانات', ['crm.records.read', 'crm.parties.merge']);
    const viewRole = await mkRole('مطلع', ['crm.records.read', 'crm.reports.read']);
    const mkUser = async (fullName: string, email: string, roleId: string) =>
      (await http.post('/api/users').set(as(admin)).send({ fullName, email, password: 'Sales12345', roleIds: [roleId] }).expect(201)).body.id as string;
    salesId = await mkUser('موظف المبيعات', 'sales@test.org', salesRole);
    sales2Id = await mkUser('موظفة المبيعات', 'sales2@test.org', salesRole);
    viewerId = await mkUser('المطلع', 'viewer@test.org', viewRole);
    await mkUser('مدقق البيانات', 'merger@test.org', mergeRole);
    sales = await login('sales@test.org', 'Sales12345', 'crm');
    sales2 = await login('sales2@test.org', 'Sales12345', 'crm');
    viewer = await login('viewer@test.org', 'Sales12345', 'crm');
    merger = await login('merger@test.org', 'Sales12345', 'crm');
  });

  afterAll(async () => {
    await app.close();
  });

  it('initializes settings with suggested lists on first use', async () => {
    const lk = (await http.get(`${C}/lookups`).set(as(sales)).expect(200)).body;
    expect(lk.settings.sources.map((s: { key: string }) => s.key)).toEqual(expect.arrayContaining(['website', 'manual', 'import', 'event']));
    expect(lk.settings.interests.length).toBeGreaterThan(3);
    // طلبات الموقع لا تدخل إلا بعد أن تختار الشركة نماذجها
    expect(lk.settings.webTopics).toEqual([]);
    expect(lk.can.assign).toBe(false);
  });

  it('links partners and customers sharing a phone into one party', async () => {
    await http.post('/api/partnerships/partners').set(as(admin)).send({ name: 'شركة الإحسان', typeIds: [], phone: '0551230000', email: 'csr@ihsan.test', showOnWebsite: false }).expect(201);
    await http.post('/api/billing/customers').set(as(admin)).send({ kind: 'business', name: 'شركة الإحسان للتجارة', phone: '+966551230000', email: 'csr@ihsan.test' }).expect(200);
    await http.post('/api/partnerships/partners').set(as(admin)).send({ name: 'شريك آخر', typeIds: [], phone: '0559990000', showOnWebsite: false }).expect(201);
    const r = (await http.post(`${C}/parties/sync`).set(as(admin)).expect(201)).body;
    expect(r.created).toBe(2);
    expect(r.linked).toBe(1);
    const list = (await http.get(`${C}/parties?q=الإحسان`).set(as(admin)).expect(200)).body;
    expect(list).toHaveLength(1);
    expect(list[0].roles.sort()).toEqual(['customer', 'partner']);
    ids.ihsan = list[0].id;
    const p = (await http.get(`${C}/parties/${ids.ihsan}`).set(as(admin)).expect(200)).body;
    expect(p.records.map((x: { role: string }) => x.role).sort()).toEqual(['customer', 'partner']);
    // من لا يملك صلاحية الفوترة لا يرى تفاصيل الفواتير
    const asSales = (await http.get(`${C}/parties/${ids.ihsan}`).set(as(sales)).expect(200)).body;
    expect(asSales.records.find((x: { role: string }) => x.role === 'customer').hidden).toBe(true);
    expect(asSales.records.find((x: { role: string }) => x.role === 'partner').hidden).toBeFalsy();
    // المزامنة آمنة للتكرار
    expect((await http.post(`${C}/parties/sync`).set(as(admin)).expect(201)).body).toEqual({ linked: 0, created: 0 });
  });

  it('hides partners, customers, members and volunteers from staff who cannot see them in their own systems', async () => {
    // المطلع على علاقات العملاء فقط لا يرى جوال الشريك أو بريده من أي باب: القائمة والملف والتقرير وفحص التكرار
    const list = (await http.get(`${C}/parties?role=partner`).set(as(viewer)).expect(200)).body;
    expect(list).toHaveLength(0);
    await http.get(`${C}/parties/${ids.ihsan}`).set(as(viewer)).expect(404);
    const chk = (await http.get(`${C}/parties/check?phone=0551230000`).set(as(viewer)).expect(200)).body;
    expect(chk.parties).toHaveLength(0);
    expect(chk.hiddenParties).toBe(1);
    expect(JSON.stringify(chk)).not.toContain('0551230000');
    const rep = (await http.get('/api/reports/run/crm.parties').set(as(viewer)).expect(200)).body;
    expect(JSON.stringify(rep)).not.toContain('0551230000');
    const repAdmin = (await http.get('/api/reports/run/crm.parties').set(as(admin)).expect(200)).body;
    expect(JSON.stringify(repAdmin)).toContain('0551230000');
    // صلاحية الدمج وحدها لا تكشف سجلات نظام آخر
    await http.get(`${C}/parties/${ids.ihsan}/link-candidates?role=customer`).set(as(merger)).expect(404);
    const dupView = (await http.get(`${C}/duplicates`).set(as(merger)).expect(200)).body;
    expect(JSON.stringify(dupView)).not.toContain('csr@ihsan.test');
  });

  it('warns about duplicates and merges them', async () => {
    const dup = await http.post(`${C}/parties`).set(as(sales)).send({ kind: 'org', name: 'الإحسان', email: 'CSR@ihsan.test' }).expect(409);
    expect(dup.body.message).toContain('شركة الإحسان');
    const created = (await http.post(`${C}/parties`).set(as(sales)).send({ kind: 'org', name: 'الإحسان', email: 'csr@ihsan.test', tags: ['معرض'], allowDuplicate: true }).expect(201)).body;
    ids.dup = created.id;
    await http.get(`${C}/duplicates`).set(as(sales)).expect(403);
    const groups = (await http.get(`${C}/duplicates`).set(as(admin)).expect(200)).body;
    expect(groups.some((g: { by: string[] }) => g.by.includes('email'))).toBe(true);
    await http.post(`${C}/activities`).set(as(sales)).send({ type: 'call', subject: 'اتصال تعريفي', done: true, partyId: ids.dup }).expect(201);
    const m = (await http.post(`${C}/parties/${ids.ihsan}/merge`).set(as(admin)).send({ removeId: ids.dup }).expect(201)).body;
    expect(m.moved.activities).toBe(1);
    const p = (await http.get(`${C}/parties/${ids.ihsan}`).set(as(admin)).expect(200)).body;
    expect(p.tags).toContain('معرض');
    expect(p.activities).toHaveLength(1);
    expect(p.merges).toHaveLength(1);
    // الجهة المدموجة لا تُعدَّل
    await http.put(`${C}/parties/${ids.dup}`).set(as(admin)).send({ kind: 'org', name: 'x x' }).expect(400);
  });

  it('records marketing consents per channel with their source', async () => {
    await http.put(`${C}/parties/${ids.ihsan}/consents`).set(as(sales)).send({ items: [{ channel: 'email', granted: true, source: 'نموذج المعرض' }], doNotContact: false }).expect(200);
    const p = (await http.get(`${C}/parties/${ids.ihsan}`).set(as(sales)).expect(200)).body;
    expect(p.consents.email).toMatchObject({ granted: true, source: 'نموذج المعرض', byName: 'موظف المبيعات' });
  });

  it('round-robin assigns new leads and enforces ownership', async () => {
    await http.put(`${C}/settings`).set(as(sales)).send({ slaHours: 4, assignMode: 'round_robin', team: [salesId, sales2Id], webTopics: ['consultation'], partyVisibility: 'own' }).expect(403);
    await http.put(`${C}/settings`).set(as(admin)).send({ slaHours: 4, assignMode: 'round_robin', team: [salesId, sales2Id], webTopics: ['consultation', 'booking'], partyVisibility: 'own' }).expect(200);
    const a = (await http.post(`${C}/leads`).set(as(admin)).send({ name: 'عميل أول', phone: '0551110001', source: 'event' }).expect(201)).body;
    const b = (await http.post(`${C}/leads`).set(as(admin)).send({ name: 'عميل ثان', phone: '0551110002', source: 'event' }).expect(201)).body;
    const owners = await db.query('SELECT owner_id FROM crm_leads WHERE id = ANY($1) ORDER BY lead_no', [[a.id, b.id]]);
    expect(new Set(owners.map((o: { owner_id: string }) => o.owner_id))).toEqual(new Set([salesId, sales2Id]));
    const mine = owners[0].owner_id === salesId ? a.id : b.id;
    const theirs = mine === a.id ? b.id : a.id;
    ids.lead = mine;
    // الموظف يرى عملاءه فقط
    await http.get(`${C}/leads/${theirs}`).set(as(sales)).expect(404);
    const list = (await http.get(`${C}/leads`).set(as(sales)).expect(200)).body;
    expect(list.map((l: { id: string }) => l.id)).toEqual([mine]);
    await http.put(`${C}/leads/${mine}/owner`).set(as(sales)).send({ ownerId: sales2Id }).expect(403);
    // تكرار الجوال يُنبَّه عليه
    await http.post(`${C}/leads`).set(as(sales)).send({ name: 'مكرر', phone: '0551110001', source: 'manual' }).expect(409);
    await http.post(`${C}/leads`).set(as(viewer)).send({ name: 'مطلع', phone: '0551110009', source: 'manual' }).expect(403);
  });

  it('first contact activity stamps the SLA and moves the lead to contacted', async () => {
    const before = (await http.get(`${C}/leads/${ids.lead}`).set(as(sales)).expect(200)).body;
    expect(before.status).toBe('new');
    await http.post(`${C}/activities`).set(as(sales)).send({ type: 'call', subject: 'أول اتصال', done: true, outcome: 'مهتم', leadId: ids.lead }).expect(201);
    const after = (await http.get(`${C}/leads/${ids.lead}`).set(as(sales)).expect(200)).body;
    expect(after.status).toBe('contacted');
    expect(after.firstContactAt).toBeTruthy();
    await http.post(`${C}/leads/${ids.lead}/status`).set(as(sales)).send({ status: 'disqualified' }).expect(400);
  });

  it('converts a company lead into an org party with a primary contact', async () => {
    await http.put(`${C}/leads/${ids.lead}`).set(as(sales)).send({ name: 'عميل أول', company: 'شركة الريادة', phone: '0551110001', source: 'event' }).expect(200);
    // سجل التدقيق يحفظ المعدِّل والقيم قبل التعديل وبعده
    const edited = (await http.get(`${C}/leads/${ids.lead}`).set(as(sales)).expect(200)).body;
    const last = edited.log[edited.log.length - 1];
    expect(last).toMatchObject({ action: 'تعديل البيانات', byId: salesId });
    expect(last.changes).toEqual(expect.arrayContaining([{ field: 'company', from: null, to: 'شركة الريادة' }]));
    const r = (await http.post(`${C}/leads/${ids.lead}/convert`).set(as(sales)).send({ nextSubject: 'إرسال عرض سعر', nextDueAt: new Date(Date.now() + 86400000).toISOString() }).expect(201)).body;
    const p = (await http.get(`${C}/parties/${r.partyId}`).set(as(sales)).expect(200)).body;
    expect(p.kind).toBe('org');
    expect(p.name).toBe('شركة الريادة');
    expect(p.contacts[0]).toMatchObject({ name: 'عميل أول', isPrimary: true });
    expect(p.records.map((x: { role: string }) => x.role)).toEqual(['lead']);
    expect(p.activities.map((a: { subject: string }) => a.subject)).toEqual(expect.arrayContaining(['أول اتصال', 'إرسال عرض سعر']));
    await http.post(`${C}/leads/${ids.lead}/convert`).set(as(sales)).send({}).expect(400);
    // رؤية «جهاته فقط»: الزميلة لا ترى الجهة
    await http.get(`${C}/parties/${r.partyId}`).set(as(sales2)).expect(404);
  });

  it('website consultation requests become leads once; unselected forms never do', async () => {
    const org = (await db.query(`SELECT id FROM organizations WHERE slug = 'crm'`))[0].id;
    const leads = app.get(LeadsService);
    const msg = { id: '6f1b6e8e-2b4a-4c1d-9a55-1c2d3e4f5a6b', name: 'شركة النماء', phone: null, email: 'csr@namaa.test', topic: 'consultation', topicLabel: 'طلب استشارة', body: 'نرغب في قياس أثر برنامج' };
    const id1 = await leads.fromWebsite(org, msg);
    const id2 = await leads.fromWebsite(org, msg);
    expect(id1).toBeTruthy();
    expect(id2).toBe(id1);
    expect(await leads.fromWebsite(org, { ...msg, id: '7f1b6e8e-2b4a-4c1d-9a55-1c2d3e4f5a6b', email: 'x@y.test', topic: 'guide' })).toBeNull();
    expect(await leads.fromWebsite(org, { ...msg, id: '9f1b6e8e-2b4a-4c1d-9a55-1c2d3e4f5a6b', email: 'z@y.test', topic: 'complaint' })).toBeNull();
    // طلب ثان من المرسل نفسه تُضاف نشاطًا للعميل المحتمل المفتوح
    const id3 = await leads.fromWebsite(org, { ...msg, id: '8f1b6e8e-2b4a-4c1d-9a55-1c2d3e4f5a6b', body: 'متابعة' });
    expect(id3).toBe(id1);
    const [{ n }] = await db.query(`SELECT count(*)::int AS n FROM crm_activities WHERE lead_id = $1`, [id1]);
    expect(n).toBe(1);
  });

  it('a consultation form on the website reaches the CRM of its own organization only', async () => {
    const org = (await db.query(`SELECT id FROM organizations WHERE slug = 'crm'`))[0].id;
    const forms = app.get(FormsService);
    await forms.submit(org, { name: 'منى الحربي', email: 'mona@web.test', orgName: 'جمعية الأمل الصحية', phone: '0554443322', source: 'consultation', message: 'نحتاج خطة استراتيجية' } as never);
    const [l] = await db.query(`SELECT company, source, status, message FROM crm_leads WHERE organization_id = $1 AND email = 'mona@web.test'`, [org]);
    expect(l).toMatchObject({ company: 'جمعية الأمل الصحية', source: 'website', status: 'new' });
    expect(l.message).toContain('نحتاج خطة استراتيجية');
    // تبقى في قائمة طلبات الموقع كما هي
    const [w] = await db.query(`SELECT status FROM rw_leads WHERE organization_id = $1 AND email = 'mona@web.test'`, [org]);
    expect(w.status).toBe('new');
    // لا تصل إلى منشأة أخرى
    const otherOrg = (await db.query(`SELECT id FROM organizations WHERE slug = 'crm2'`))[0].id;
    expect((await db.query(`SELECT count(*)::int AS n FROM crm_leads WHERE organization_id = $1`, [otherOrg]))[0].n).toBe(0);
  });

  it('imports leads with a dry run and skips duplicates', async () => {
    await http.post(`${C}/leads/import`).set(as(sales)).send({ source: 'event', dryRun: true, rows: [] }).expect(403);
    const rows = [{ name: 'أ', phone: '0552220001' }, { name: 'ب ب', phone: '0552220001' }, { name: 'ج ج', email: 'bad' }, { name: 'د د', phone: '0551230000' }, { name: 'هـ هـ', email: 'h@test.org' }];
    const dry = (await http.post(`${C}/leads/import`).set(as(admin)).send({ source: 'event', dryRun: true, rows: rows.slice(1) }).expect(201)).body;
    expect(dry).toMatchObject({ ready: 2, skipped: 2 });
    const done = (await http.post(`${C}/leads/import`).set(as(admin)).send({ source: 'event', campaign: 'معرض', dryRun: false, rows: rows.slice(1) }).expect(201)).body;
    expect(done.created).toBe(2);
  });

  it('activities: own list, complete with next step, and overdue tasks in the bell', async () => {
    const a = (await http.post(`${C}/activities`).set(as(sales)).send({ type: 'task', subject: 'مهمة متأخرة', dueAt: new Date(Date.now() - 3600_000).toISOString(), done: false }).expect(201)).body;
    const list = (await http.get(`${C}/activities?status=overdue`).set(as(sales)).expect(200)).body;
    expect(list.map((x: { id: string }) => x.id)).toContain(a.id);
    await http.get(`${C}/activities?owner=${sales2Id}`).set(as(sales)).expect(403);
    const tasks = (await http.get('/api/tasks').set(as(sales)).expect(200)).body;
    expect(JSON.stringify(tasks)).toContain('مهمة متأخرة');
    await http.post(`${C}/activities/${a.id}/complete`).set(as(sales2)).send({}).expect(404);
    await http.post(`${C}/activities/${a.id}/complete`).set(as(sales)).send({ outcome: 'تم', nextSubject: 'متابعة', nextDueAt: new Date(Date.now() + 86400000).toISOString() }).expect(201);
    await http.delete(`${C}/activities/${a.id}`).set(as(sales)).expect(400);
  });

  it('links one activity to several parties or to all customers, with an assignee and read-only followers', async () => {
    const mk = async (name: string, email: string) => (await http.post(`${C}/parties`).set(as(sales)).send({ kind: 'org', name, email }).expect(201)).body.id as string;
    const p1 = await mk('مركز الشفاء الطبي', 'info@shifa.test');
    const p2 = await mk('عيادات الريان', 'info@rayan.test');
    const due = new Date(Date.now() + 86400_000).toISOString();
    // جهات مختارة، ومسندة لزميلة، ومتابع للاطلاع
    const a = (await http.post(`${C}/activities`).set(as(sales)).send({
      type: 'meeting', subject: 'ورشة تعريفية مشتركة', dueAt: due, done: false, partyIds: [p1, p2, p1], ownerId: sales2Id, followerIds: [viewerId],
    }).expect(201)).body;
    expect(a.parties).toBe(2);
    const forOwner = (await http.get(`${C}/activities?status=open`).set(as(sales2)).expect(200)).body.find((x: { id: string }) => x.id === a.id);
    expect(forOwner).toMatchObject({ audience: 'many', partyCount: 2, audienceLabel: 'جهات مختارة (2)', following: false });
    expect(forOwner.followers.map((f: { id: string }) => f.id)).toEqual([viewerId]);
    expect(JSON.stringify((await http.get('/api/tasks').set(as(sales2)).expect(200)).body)).not.toContain('ورشة تعريفية مشتركة'); // موعدها غدًا
    // المنشئ يبقى يراه، والمتابع يراه للاطلاع
    expect((await http.get(`${C}/activities`).set(as(sales)).expect(200)).body.some((x: { id: string }) => x.id === a.id)).toBe(true);
    const forViewer = (await http.get(`${C}/activities`).set(as(viewer)).expect(200)).body.find((x: { id: string }) => x.id === a.id);
    expect(forViewer.following).toBe(true);
    // يظهر في ملف كل جهة، ويُحسب في عدد أنشطتها
    for (const id of [p1, p2]) {
      const prof = (await http.get(`${C}/parties/${id}`).set(as(sales)).expect(200)).body;
      expect(prof.activities.find((x: { id: string }) => x.id === a.id)).toMatchObject({ audienceLabel: 'جهات مختارة (2)' });
    }
    // الإنجاز مع خطوة تالية: الجهات والمتابعون ينتقلون إليها
    await http.post(`${C}/activities/${a.id}/complete`).set(as(sales2)).send({ outcome: 'حضر الجميع', nextSubject: 'إرسال العروض', nextDueAt: due }).expect(201);
    const next = (await http.get(`${C}/activities?status=open`).set(as(sales2)).expect(200)).body.find((x: { subject: string }) => x.subject === 'إرسال العروض');
    expect(next).toMatchObject({ audience: 'many', partyCount: 2 });
    expect(next.followers.map((f: { id: string }) => f.id)).toEqual([viewerId]);

    // لا يُسند نشاط جهة لزميل لا يرى الجهة، ولا يُضاف متابعًا، ولا لمن لا يملك صلاحية علاقات العملاء
    const hidden = await http.post(`${C}/activities`).set(as(sales)).send({ type: 'call', subject: 'اتصال', dueAt: due, done: false, partyId: p1, ownerId: sales2Id }).expect(400);
    expect(hidden.body.message).toContain('لا يرى');
    await http.post(`${C}/activities`).set(as(sales)).send({ type: 'call', subject: 'اتصال', dueAt: due, done: false, partyId: p1, followerIds: [sales2Id] }).expect(400);
    await http.post(`${C}/activities`).set(as(sales)).send({ type: 'task', subject: 'مهمة', dueAt: due, done: false, ownerId: viewerId }).expect(400);

    // المتابع لا ينجز ولا يحذف (403 برسالة واضحة)، ويعدّل المتابعين المسؤول أو المنشئ
    const b = (await http.post(`${C}/activities`).set(as(sales2)).send({ type: 'task', subject: 'تجهيز القاعة', dueAt: due, done: false, followerIds: [salesId] }).expect(201)).body;
    const r = await http.post(`${C}/activities/${b.id}/complete`).set(as(sales)).send({}).expect(403);
    expect(r.body.message).toContain('للاطلاع فقط');
    await http.delete(`${C}/activities/${b.id}`).set(as(sales)).expect(403);
    await http.put(`${C}/activities/${b.id}/followers`).set(as(sales)).send({ userIds: [] }).expect(403);
    await http.put(`${C}/activities/${b.id}/followers`).set(as(viewer)).send({ userIds: [] }).expect(403);
    await http.put(`${C}/activities/${b.id}/followers`).set(as(other)).send({ userIds: [] }).expect(404);
    await http.put(`${C}/activities/${b.id}/followers`).set(as(sales2)).send({ userIds: ['00000000-0000-4000-8000-000000000000'] }).expect(400);
    expect((await http.put(`${C}/activities/${b.id}/followers`).set(as(sales2)).send({ userIds: [viewerId, sales2Id] }).expect(200)).body.followers).toBe(1);
    expect((await http.get(`${C}/activities`).set(as(sales)).expect(200)).body.some((x: { id: string }) => x.id === b.id)).toBe(false);

    // كل العملاء: لقطة بالجهات ذات دور «عميل» في نطاق رؤية الموظف
    const all = (await http.post(`${C}/activities`).set(as(sales)).send({ type: 'email', subject: 'نشرة الخدمات الجديدة', done: true, allParties: true, audienceRole: 'customer' }).expect(201)).body;
    expect(all.parties).toBe(1);
    const prof = (await http.get(`${C}/parties/${ids.ihsan}`).set(as(admin)).expect(200)).body;
    expect(prof.activities.find((x: { id: string }) => x.id === all.id)).toMatchObject({ audienceLabel: 'كل العملاء (1)' });
    const rep = (await http.get(`/api/reports/run/crm.activities?from=2020-01-01&to=2100-01-01`).set(as(admin)).expect(200)).body;
    expect(JSON.stringify(rep)).toContain('كل العملاء (1)');

    // طريقة ربط واحدة فقط، وجهات منشأة أخرى غير موجودة
    await http.post(`${C}/activities`).set(as(sales)).send({ type: 'note', subject: 'ملاحظة', done: true, partyIds: [p1, p2], leadId: ids.lead }).expect(400);
    await http.post(`${C}/activities`).set(as(sales)).send({ type: 'note', subject: 'ملاحظة', done: true, partyIds: [p1], allParties: true }).expect(400);
    const foreign = (await http.post(`${C}/parties`).set(as(other)).send({ kind: 'org', name: 'جهة منشأة أخرى' }).expect(201)).body.id;
    await http.post(`${C}/activities`).set(as(sales)).send({ type: 'note', subject: 'ملاحظة', done: true, partyIds: [p1, foreign] }).expect(404);
    await db.query('DELETE FROM crm_parties WHERE id = $1', [foreign]); // اختبار العزل لاحقًا يتوقع منشأة أخرى فارغة
    await http.post(`${C}/activities`).set(as(sales)).send({ type: 'note', subject: 'ملاحظة', done: true, followerIds: ['00000000-0000-4000-8000-000000000000'] }).expect(400);
    await http.post(`${C}/activities`).set(as(viewer)).send({ type: 'note', subject: 'ملاحظة', done: true, partyIds: [p1, p2] }).expect(403);

    // دمج جهة مكررة في نشاط جماعي: يبقى النشاط مرة واحدة في الجهة الأساسية
    const dup = (await http.post(`${C}/parties`).set(as(sales)).send({ kind: 'org', name: 'الشفاء الطبي', email: 'info@shifa.test', allowDuplicate: true }).expect(201)).body.id;
    const g = (await http.post(`${C}/activities`).set(as(sales)).send({ type: 'note', subject: 'ملاحظة مشتركة', done: true, partyIds: [p1, dup] }).expect(201)).body;
    await http.post(`${C}/parties/${p1}/merge`).set(as(admin)).send({ removeId: dup }).expect(201);
    const merged = (await http.get(`${C}/parties/${p1}`).set(as(admin)).expect(200)).body;
    expect(merged.activities.filter((x: { id: string }) => x.id === g.id)).toHaveLength(1);
    const [{ n }] = await db.query('SELECT count(*)::int AS n FROM crm_activity_parties WHERE activity_id = $1', [g.id]);
    expect(n).toBe(1);
  });

  it('dashboard and reports work', async () => {
    const d = (await http.get(`${C}/dashboard`).set(as(admin)).expect(200)).body;
    expect(d.leads.open).toBeGreaterThan(0);
    expect(d.parties.total).toBeGreaterThan(0);
    for (const code of ['crm.parties', 'crm.leads', 'crm.sources', 'crm.team', 'crm.activities']) {
      const r = await http.get(`/api/reports/run/${code}?from=2020-01-01&to=2100-01-01`).set(as(admin));
      expect(r.status).toBe(200);
    }
  });

  it('isolates organizations', async () => {
    await http.get(`${C}/parties/${ids.ihsan}`).set(as(other)).expect(404);
    await http.get(`${C}/leads/${ids.lead}`).set(as(other)).expect(404);
    await http.post(`${C}/parties/${ids.ihsan}/merge`).set(as(other)).send({ removeId: ids.dup }).expect(404);
    expect((await http.get(`${C}/parties`).set(as(other)).expect(200)).body).toEqual([]);
    expect((await http.get(`${C}/leads`).set(as(other)).expect(200)).body).toEqual([]);
  });
});
