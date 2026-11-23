import { Test } from '@nestjs/testing';
import { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/main';
import { CompanyQualityService } from '../src/modules/starter/company-quality.service';

/**
 * إجراءات الجودة الجاهزة لرعاية وطن: تُدرج في منشأة الشركة فقط بحالة «مسودة» Rev.00 ببياناتها الكاملة وخرائطها،
 * مرة واحدة لكل ملف، ولا تمس وثيقة موجودة بالكود نفسه، ولا تعيد مسودة حذفتها الشركة، والمنشآت الأخرى لا تتأثر.
 */
const DB = process.env.TEST_DATABASE_URL ?? 'postgres://erp:erp@localhost:5432/charity_erp_test';

describe('Company quality procedures pack (drafts)', () => {
  let app: NestExpressApplication;
  let db: DataSource;
  let pack: CompanyQualityService;
  let company: string;
  let other: string;
  let http: ReturnType<typeof request>;
  let director: string;
  let otherAdmin: string;
  const n = async (table: string, org: string, where = 'TRUE') =>
    Number((await db.query(`SELECT count(*)::int AS n FROM ${table} WHERE organization_id = $1 AND ${where}`, [org]))[0].n);

  beforeAll(async () => {
    Object.assign(process.env, {
      DATABASE_URL: DB, JWT_SECRET: 'test-secret', COMPANY_SLUG: 'rw-quality', COMPANY_NAME: 'رعاية وطن',
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
    db = app.get(DataSource);
    pack = app.get(CompanyQualityService);
    http = request(app.getHttpServer());
    const platform = (await http.post('/api/auth/login').send({ login: 'admin', password: 'Platform123' }).expect(200)).body.accessToken;
    other = (await http.post('/api/platform/organizations').set({ Authorization: `Bearer ${platform}` })
      .send({ name: 'منشأة أخرى', slug: 'other', adminFullName: 'مدير', adminEmail: 'o@other.org', adminPassword: 'Admin12345' }).expect(201)).body.id;
    company = (await db.query(`SELECT id FROM organizations WHERE slug = 'rw-quality'`))[0].id;
    director = (await http.post('/api/auth/login').send({ login: 'director', password: 'RwAdmin2026' }).expect(200)).body.accessToken;
    otherAdmin = (await http.post('/api/auth/login').send({ login: 'o@other.org', password: 'Admin12345', organization: 'other' }).expect(200)).body.accessToken;
  }, 120000);

  afterAll(async () => {
    delete process.env.COMPANY_SLUG;
    await db.destroy();
    await app.close();
  });

  it('inserts every procedure as a full draft with its maps, in the company only', async () => {
    // وثيقة أنشأتها الشركة بالكود نفسه قبل الإدراج: تبقى كما هي
    await db.query(`INSERT INTO quality_documents (organization_id, code, title, doc_type, department, status, revision, sections, history, created_by_name)
      VALUES ($1, 'QP-QMS-01', 'نسخة الشركة', 'procedure', 'QMS', 'draft', 0, '[]', '[]', 'الشركة')`, [company]);
    const files = await pack.files();
    const expected = files.reduce((s, f) => s + f.documents.length, 0);
    const results = await pack.run();
    expect(results!.map((r) => r.key)).toEqual(['departments', ...files.map((f) => f.key)]);

    expect(await n('quality_documents', company)).toBe(expected);
    expect(await n('quality_documents', company, `status <> 'draft' OR revision <> 0 OR approved_revision IS NOT NULL`)).toBe(0);
    expect((await db.query(`SELECT title FROM quality_documents WHERE organization_id = $1 AND code = 'QP-QMS-01'`, [company]))[0].title).toBe('نسخة الشركة');
    expect(await n('quality_process_maps', company)).toBe(files.reduce((s, f) => s + f.maps.length, 0));
    expect(await n('quality_process_maps', company, 'document_id IS NULL')).toBe(0);
    expect(await n('quality_documents', other)).toBe(0);
    expect(await n('quality_process_maps', other)).toBe(0);

    // بيانات الإجراء كاملة: الغرض والنطاق والمسؤوليات والخطوات والنماذج، ومرتبط بدليله ونماذجه
    const [p] = await db.query(`SELECT * FROM quality_documents WHERE organization_id = $1 AND code = 'QP-FIN-03'`, [company]);
    expect(p).toMatchObject({ doc_type: 'procedure', department: 'FIN', status: 'draft', revision: 0 });
    const titles = (p.sections as { title: string; body: string }[]).map((s) => s.title);
    expect(titles).toEqual(expect.arrayContaining(['الغرض', 'النطاق', 'المسؤوليات', 'خطوات الإجراء', 'السجلات والنماذج المرتبطة']));
    expect((p.sections as { body: string }[]).every((s) => s.body.length > 0)).toBe(true);
    expect(p.related_codes).toEqual(expect.arrayContaining(['QM-FIN-01', 'QF-FIN-01']));
    expect(await n('quality_documents', company, `code IN ('QM-QMS-01', 'POL-QMS-01', 'QM-FIN-01', 'WI-FIN-01', 'QF-PLN-01', 'QF-PLN-06', 'QR-FIN-03')`)).toBe(7);
    const [s] = await db.query('SELECT departments FROM quality_settings WHERE organization_id = $1', [company]);
    expect((s.departments as { code: string }[]).map((d) => d.code)).toEqual(expect.arrayContaining(['QMS', 'FIN', 'PLN', 'HR', 'AUD']));

    // تظهر في سجل الإجراءات للشركة، ولا تظهر للمنشأة الأخرى
    const list = (await http.get('/api/quality/documents?external=0').set({ Authorization: `Bearer ${director}` }).expect(200)).body;
    expect(list.rows.filter((r: { status: string }) => r.status === 'draft').length).toBe(expected);
    const id = list.rows.find((r: { code: string }) => r.code === 'QP-FIN-03').id;
    await http.get(`/api/quality/documents/${id}`).set({ Authorization: `Bearer ${otherAdmin}` }).expect(404);
    // المسودة جاهزة لمسار الاعتماد المعتاد
    await http.post(`/api/quality/documents/${id}/action`).set({ Authorization: `Bearer ${director}` }).send({ action: 'submit' }).expect(200);
  });

  it('never runs a file twice, and a deleted draft does not come back', async () => {
    const before = await n('quality_documents', company);
    await db.query(`DELETE FROM quality_process_maps WHERE organization_id = $1 AND code = 'PM-QP-FIN-01'`, [company]);
    await db.query(`DELETE FROM quality_documents WHERE organization_id = $1 AND code = 'QP-FIN-01'`, [company]);
    expect(await pack.run()).toEqual([]);
    expect(await n('quality_documents', company)).toBe(before - 1);
    expect(await n('organization_starters', company, `module_code LIKE 'quality.%' AND status = 'applied'`)).toBe((await pack.files()).length);
  });

  it('a stopped run resumes without duplicating what was inserted', async () => {
    const [{ id }] = await db.query(`SELECT id FROM quality_documents WHERE organization_id = $1 AND code = 'QF-PLN-02'`, [company]);
    await db.query(`DELETE FROM quality_documents WHERE organization_id = $1 AND id = $2`, [company, id]);
    await db.query(`DELETE FROM organization_starters WHERE organization_id = $1 AND module_code = 'quality.pln-board'`, [company]);
    const r = await pack.run();
    expect(r).toEqual([expect.objectContaining({ key: 'pln-board', added: 1 })]);
    expect(await n('quality_documents', company, `code LIKE 'QF-PLN-%'`)).toBe(6);
  });
});
