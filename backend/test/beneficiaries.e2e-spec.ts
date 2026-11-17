import { Test } from '@nestjs/testing';
import { NestExpressApplication } from '@nestjs/platform-express';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/main';

/** اختبار وحدة المستفيدين على PostgreSQL حقيقية (TEST_DATABASE_URL). يمسح القاعدة في البداية. */
const DB = process.env.TEST_DATABASE_URL ?? 'postgres://erp:erp@localhost:5432/charity_erp_test';
const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8ffff3f0005fe02fea7d6a4b40000000049454e44ae426082', 'hex');

describe('Beneficiaries module', () => {
  let app: NestExpressApplication;
  let http: ReturnType<typeof request>;
  let admin: string;
  let otherAdmin: string;
  let uploadDir: string;
  const as = (t: string) => ({ Authorization: `Bearer ${t}` });
  const login = async (login: string, password: string, organization?: string) =>
    (await http.post('/api/auth/login').send({ login, password, organization }).expect(200)).body.accessToken as string;

  beforeAll(async () => {
    uploadDir = mkdtempSync(join(tmpdir(), 'sanabel-uploads-'));
    Object.assign(process.env, {
      DATABASE_URL: DB, JWT_SECRET: 'test-secret', UPLOAD_DIR: uploadDir,
      PLATFORM_ADMIN_EMAIL: 'platform@test.org', PLATFORM_ADMIN_PASSWORD: 'Platform123',
    });
    const reset = new DataSource({ type: 'postgres', url: DB });
    await reset.initialize();
    await reset.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
    await reset.destroy();

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(moduleRef.createNestApplication<NestExpressApplication>());
    await app.init();
    http = request(app.getHttpServer());

    const platform = await login('admin', 'Platform123');
    for (const [slug, email] of [['a', 'a@test.org'], ['b', 'b@test.org']]) {
      await http.post('/api/platform/organizations').set(as(platform)).send({
        name: `جمعية ${slug}`, slug: `org-${slug}`, adminFullName: 'مدير', adminEmail: email, adminPassword: 'Admin12345',
      }).expect(201);
    }
    admin = await login('a@test.org', 'Admin12345', 'org-a');
    otherAdmin = await login('b@test.org', 'Admin12345', 'org-b');
  });

  afterAll(async () => {
    await app.get(DataSource).destroy();
    await app.close();
    rmSync(uploadDir, { recursive: true, force: true });
  });

  let id: string;

  it('creates a file with sequential numbers and rejects duplicate national IDs', async () => {
    const res = await http.post('/api/beneficiaries').set(as(admin)).send({ nationality: 'سعودي',
      fullName: '  فاطمة محمد علي ', nationalId: '٢٩٠٠١٠١٠١٢٣٤٥٦', gender: 'female', category: 'widow',
      maritalStatus: 'widowed', monthlyIncome: 1200, housingType: 'rented', monthlyRent: 600, phone: '',
    }).expect(201);
    id = res.body.id;
    expect(res.body.fileNo).toBe(1);
    expect(res.body.fullName).toBe('فاطمة محمد علي');
    expect(res.body.nationalId).toBe('29001010123456');
    expect(res.body.phone).toBeNull();
    expect(res.body.status).toBe('new');

    const second = await http.post('/api/beneficiaries').set(as(admin))
      .send({ nationality: 'سعودي', fullName: 'أحمد حسن', gender: 'male', category: 'elderly' }).expect(201);
    expect(second.body.fileNo).toBe(2);

    const dup = await http.post('/api/beneficiaries').set(as(admin))
      .send({ nationality: 'سعودي', fullName: 'مكرر', nationalId: '29001010123456', gender: 'male', category: 'other' }).expect(409);
    expect(dup.body.message).toContain('ملف رقم 1');
    await http.patch(`/api/beneficiaries/${second.body.id}`).set(as(admin)).send({ nationalId: '29001010123456' }).expect(409);

    await http.post('/api/beneficiaries').set(as(admin)).send({ nationality: 'سعودي', fullName: 'x', gender: 'male', category: 'nope' }).expect(400);

    // كل جمعية لها ترقيمها الخاص، ونفس رقم الهوية مسموح في جمعية أخرى
    const other = await http.post('/api/beneficiaries').set(as(otherAdmin))
      .send({ nationality: 'سعودي', fullName: 'حالة جمعية ب', nationalId: '29001010123456', gender: 'male', category: 'other' }).expect(201);
    expect(other.body.fileNo).toBe(1);

    // الجنسية إلزامية ومن قائمة الجنسيات المعتمدة في الإعدادات
    const noNat = await http.post('/api/beneficiaries').set(as(admin)).send({ fullName: 'بلا جنسية', gender: 'male', category: 'other' }).expect(400);
    expect(JSON.stringify(noNat.body.message)).toContain('اختر الجنسية');
    const bad = await http.post('/api/beneficiaries').set(as(admin)).send({ fullName: 'جنسية حرة', gender: 'male', category: 'other', nationality: 'مريخي' }).expect(400);
    expect(bad.body.message).toContain('قائمة الجنسيات');
    await http.patch(`/api/beneficiaries/${second.body.id}`).set(as(admin)).send({ nationality: 'مريخي' }).expect(400);
    await http.put('/api/lookups/nationalities').set(as(admin)).send({ nationalities: ['سعودي', 'مريخي'] }).expect(200);
    await http.patch(`/api/beneficiaries/${second.body.id}`).set(as(admin)).send({ nationality: 'مريخي' }).expect(200);
  });

  it('manages family members and computes per-capita income', async () => {
    await http.post(`/api/beneficiaries/${id}/family`).set(as(admin))
      .send({ fullName: 'سارة', relation: 'ابنة', gender: 'female', birthDate: '2012-05-01', occupation: 'إعدادي' }).expect(201);
    const son = await http.post(`/api/beneficiaries/${id}/family`).set(as(admin))
      .send({ fullName: 'محمود', relation: 'ابن', gender: 'male', monthlyIncome: 300 }).expect(201);
    await http.patch(`/api/beneficiaries/${id}/family/${son.body.id}`).set(as(admin)).send({ monthlyIncome: 600 }).expect(200);

    const res = await http.get(`/api/beneficiaries/${id}`).set(as(admin)).expect(200);
    expect(res.body.family).toHaveLength(2);
    expect(res.body.summary.familySize).toBe(3);
    expect(res.body.summary.householdIncome).toBe(1800);
    expect(res.body.summary.perCapitaIncome).toBe(400); // (1800 - 600 إيجار) / 3
  });

  it('research decisions drive the case status, and blocks aid for ineligible cases', async () => {
    await http.post(`/api/beneficiaries/${id}/researches`).set(as(admin)).send({
      visitDate: '2026-11-01', researcherName: 'أ. منى', findings: 'الأسرة تحتاج دعم شهري', decision: 'ineligible',
    }).expect(201);
    expect((await http.get(`/api/beneficiaries/${id}`).set(as(admin))).body.status).toBe('ineligible');
    await http.post(`/api/beneficiaries/${id}/aids`).set(as(admin))
      .send({ aidType: 'cash', amount: 500, disbursedOn: '2026-11-02' }).expect(400);

    await http.post(`/api/beneficiaries/${id}/researches`).set(as(admin)).send({
      visitDate: '2026-11-03', researcherName: 'أ. منى', findings: 'بعد المراجعة: مستحقة', decision: 'eligible',
      recommendedAid: 'كفالة شهرية 500', nextReviewDate: '2026-11-20',
    }).expect(201);
    const res = await http.get(`/api/beneficiaries/${id}`).set(as(admin)).expect(200);
    expect(res.body.status).toBe('eligible');
    expect(res.body.researches[0].decision).toBe('eligible');
  });

  it('records aid and reports it in the log, list and dashboard', async () => {
    const today = new Date().toISOString().slice(0, 10);
    await http.post(`/api/beneficiaries/${id}/aids`).set(as(admin))
      .send({ aidType: 'cash', amount: 500, disbursedOn: today, referenceNo: 'R-1' }).expect(201);
    const kind = await http.post(`/api/beneficiaries/${id}/aids`).set(as(admin))
      .send({ aidType: 'in_kind', amount: 250.5, description: 'كرتونة رمضان', disbursedOn: today }).expect(201);
    expect(kind.body.amount).toBe(250.5);

    const log = await http.get('/api/beneficiaries/aid-log').set(as(admin)).expect(200);
    expect(log.body.total).toBe(2);
    expect(log.body.totalAmount).toBe(750.5);
    expect(log.body.items[0].beneficiary.fileNo).toBe(1);
    const cashOnly = await http.get('/api/beneficiaries/aid-log?aidType=cash').set(as(admin)).expect(200);
    expect(cashOnly.body.totalAmount).toBe(500);

    const list = await http.get('/api/beneficiaries?search=فاطمة').set(as(admin)).expect(200);
    expect(list.body.total).toBe(1);
    expect(list.body.items[0]).toMatchObject({ fileNo: 1, familySize: 3, aidTotal: 750.5, lastAidOn: today });
    expect((await http.get('/api/beneficiaries?search=2').set(as(admin))).body.items[0].fileNo).toBe(2);
    expect((await http.get('/api/beneficiaries?status=eligible').set(as(admin))).body.total).toBe(1);

    const stats = await http.get('/api/beneficiaries/stats').set(as(admin)).expect(200);
    expect(stats.body).toMatchObject({ beneficiaries: 2, familyMembers: 2, aidThisMonth: 750.5 });
    expect(stats.body.byStatus).toEqual({ eligible: 1, new: 1 });
    expect(stats.body.monthly).toHaveLength(6);
    expect(stats.body.upcomingReviews[0].fileNo).toBe(1);
    expect(stats.body.recentAids).toHaveLength(2);
  });

  it('uploads, serves and deletes documents, rejecting fake file types', async () => {
    const up = await http.post(`/api/beneficiaries/${id}/documents`).set(as(admin))
      .field('title', 'صورة البطاقة').field('docType', 'national_id')
      .attach('file', PNG, { filename: 'بطاقة.png', contentType: 'image/png' }).expect(201);
    expect(up.body.mimeType).toBe('image/png');
    expect(up.body.originalName).toBe('بطاقة.png');
    expect(up.body.storageKey).toBeUndefined();

    await http.post(`/api/beneficiaries/${id}/documents`).set(as(admin))
      .field('title', 'سكربت').field('docType', 'other')
      .attach('file', Buffer.from('<script>alert(1)</script>'), { filename: 'x.png', contentType: 'image/png' }).expect(400);

    const file = await http.get(`/api/beneficiaries/${id}/documents/${up.body.id}/file`).set(as(admin)).expect(200);
    expect(file.headers['content-type']).toBe('image/png');
    expect(Buffer.compare(file.body, PNG)).toBe(0);
    await http.get(`/api/beneficiaries/${id}/documents/${up.body.id}/file`).set(as(otherAdmin)).expect(404);

    await http.delete(`/api/beneficiaries/${id}/documents/${up.body.id}`).set(as(admin)).expect(204);
    await http.get(`/api/beneficiaries/${id}/documents/${up.body.id}/file`).set(as(admin)).expect(404);
  });

  it('isolates associations and enforces per-action permissions', async () => {
    await http.get(`/api/beneficiaries/${id}`).set(as(otherAdmin)).expect(404);
    await http.patch(`/api/beneficiaries/${id}`).set(as(otherAdmin)).send({ fullName: 'hack' }).expect(404);
    await http.post(`/api/beneficiaries/${id}/aids`).set(as(otherAdmin))
      .send({ aidType: 'cash', amount: 1, disbursedOn: '2026-11-01' }).expect(404);
    const otherList = await http.get('/api/beneficiaries').set(as(otherAdmin)).expect(200);
    expect(otherList.body.items.map((b: { fullName: string }) => b.fullName)).toEqual(['حالة جمعية ب']);

    // موظف استقبال: يضيف ويعدل الملفات فقط
    const role = await http.post('/api/roles').set(as(admin)).send({
      name: 'استقبال', permissions: ['beneficiaries.cases.read', 'beneficiaries.cases.manage'],
    }).expect(201);
    await http.post('/api/users').set(as(admin)).send({
      fullName: 'موظف استقبال', email: 'desk@test.org', password: 'Desk12345', roleIds: [role.body.id],
    }).expect(201);
    const desk = await login('desk@test.org', 'Desk12345', 'org-a');
    await http.get('/api/beneficiaries').set(as(desk)).expect(200);
    await http.patch(`/api/beneficiaries/${id}`).set(as(desk)).send({ phone: '01001234567' }).expect(200);
    await http.post(`/api/beneficiaries/${id}/aids`).set(as(desk))
      .send({ aidType: 'cash', amount: 1, disbursedOn: '2026-11-01' }).expect(403);
    await http.post(`/api/beneficiaries/${id}/researches`).set(as(desk)).send({
      visitDate: '2026-11-01', researcherName: 'x', findings: 'xxxxxx', decision: 'eligible',
    }).expect(403);
    await http.delete(`/api/beneficiaries/${id}`).set(as(desk)).expect(403);
  });

  it('deletes a file with everything under it', async () => {
    await http.delete(`/api/beneficiaries/${id}`).set(as(admin)).expect(204);
    await http.get(`/api/beneficiaries/${id}`).set(as(admin)).expect(404);
    const log = await http.get('/api/beneficiaries/aid-log').set(as(admin)).expect(200);
    expect(log.body.total).toBe(0);
  });

  it('staff log in only from their own association page', async () => {
    const page = await http.get('/api/auth/org/org-a').expect(200);
    expect(page.body).toEqual({ name: 'جمعية a', slug: 'org-a' });
    await http.get('/api/auth/org/nope').expect(404);
    // موظف جمعية من صفحة الدخول العامة: يتوجه لرابط جمعيته
    const general = await http.post('/api/auth/login').send({ login: 'a@test.org', password: 'Admin12345' }).expect(401);
    expect(general.body.message).toContain('/o/org-a');
    // من صفحة جمعية أخرى: مرفوض بنفس رسالة كلمة المرور الخطأ
    const wrong = await http.post('/api/auth/login').send({ login: 'a@test.org', password: 'Admin12345', organization: 'org-b' }).expect(401);
    expect(wrong.body.message).toBe('بيانات الدخول أو كلمة المرور غير صحيحة');
    await http.post('/api/auth/login').send({ login: 'a@test.org', password: 'x', organization: 'org-a' }).expect(401);
    // مدير المنصة لا يدخل من صفحة جمعية
    await http.post('/api/auth/login').send({ login: 'admin', password: 'Platform123', organization: 'org-a' }).expect(401);
  });

  it('manages a module\'s permissions from inside the module settings', async () => {
    const role = await http.post('/api/roles').set(as(admin)).send({
      name: 'مسؤول إعدادات', permissions: ['beneficiaries.settings.manage', 'beneficiaries.cases.read', 'core.users.read'],
    }).expect(201);
    await http.post('/api/users').set(as(admin)).send({
      fullName: 'مسؤول', email: 'cfg@test.org', password: 'Config12345', roleIds: [role.body.id],
    }).expect(201);
    const cfg = await login('cfg@test.org', 'Config12345', 'org-a');
    // لا يملك صلاحيات الأدوار العامة، لكن يدير صلاحيات وحدة المستفيدين
    await http.get('/api/roles').set(as(cfg)).expect(403);
    const mod = await http.get('/api/roles/module/beneficiaries').set(as(cfg)).expect(200);
    expect(mod.body.module.name).toBe('المساعدات الاجتماعية');
    const mine = mod.body.roles.find((r: { id: string }) => r.id === role.body.id);
    expect(mine.permissions).toEqual(['beneficiaries.cases.read', 'beneficiaries.settings.manage']);
    await http.get('/api/roles/module/core').set(as(cfg)).expect(404);

    const created = await http.post('/api/roles/module/beneficiaries').set(as(cfg))
      .send({ name: 'متابعة ملفات', permissions: ['beneficiaries.cases.read'] }).expect(201);
    const viewer = created.body.roles.find((r: { name: string }) => r.name === 'متابعة ملفات');
    // صلاحيات من خارج الوحدة مرفوضة، ولا يمنح صلاحية لا يملكها
    await http.put(`/api/roles/${viewer.id}/module/beneficiaries`).set(as(cfg)).send({ permissions: ['core.users.read'] }).expect(400);
    await http.put(`/api/roles/${viewer.id}/module/beneficiaries`).set(as(cfg)).send({ permissions: ['beneficiaries.aid.manage'] }).expect(403);

    // تعديل صلاحيات الوحدة لا يمس صلاحيات الوحدات الأخرى في نفس الدور
    await http.put(`/api/roles/${role.body.id}/module/beneficiaries`).set(as(admin))
      .send({ permissions: ['beneficiaries.settings.manage'] }).expect(200);
    const all = await http.get('/api/roles').set(as(admin)).expect(200);
    expect(all.body.find((r: { id: string }) => r.id === role.body.id).permissions)
      .toEqual(['beneficiaries.settings.manage', 'core.users.read']);

    // مستخدم بدون إعدادات الوحدة لا يصل
    const desk = await login('desk@test.org', 'Desk12345', 'org-a');
    await http.get('/api/roles/module/beneficiaries').set(as(desk)).expect(403);
  });
});
