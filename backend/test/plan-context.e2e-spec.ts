import { Test } from '@nestjs/testing';
import { NestExpressApplication } from '@nestjs/platform-express';
import ExcelJS from 'exceljs';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/main';
import { CompanyPlanContextService, PLAN_CONTEXT_NOTE } from '../src/modules/starter/company-plan-context.service';

/**
 * القضايا الجوهرية وخارطة المعنيين في الخطة: الإضافة والتعديل والحذف بصلاحية نوع الخطة، وعزل المنشآت (404)،
 * ودخولهما في الإصدار المعتمد والمقارنة وإلغاء التعديل والنسخ، والاستيراد من Excel،
 * ثم الإدراج الآلي لبيانات رعاية وطن في أحدث خطة استراتيجية للشركة مرة واحدة لكل خطة.
 */
const DB = process.env.TEST_DATABASE_URL ?? 'postgres://erp:erp@localhost:5432/charity_erp_test';
const R = '/api/planning';

/* eslint-disable @typescript-eslint/no-explicit-any */
describe('Plan material issues and stakeholder map', () => {
  let app: NestExpressApplication;
  let db: DataSource;
  let http: ReturnType<typeof request>;
  let director: string;
  let clerk: string;
  let otherAdmin: string;
  let company: string;
  let other: string;
  const as = (t: string) => ({ Authorization: `Bearer ${t}` });
  const login = async (l: string, password: string, organization?: string) =>
    (await http.post('/api/auth/login').send({ login: l, password, organization }).expect(200)).body.accessToken as string;
  const ids: Record<string, string> = {};
  const approveAll = async (planId: string, note = 'اعتماد'): Promise<any> => {
    let p = (await http.post(`${R}/plans/${planId}/submit`).set(as(director)).send({ note }).expect(201)).body;
    for (let i = 0; i < 6 && p.status === 'in_review'; i++) p = (await http.post(`${R}/plans/${planId}/decision`).set(as(director)).send({ decision: 'approve' }).expect(201)).body;
    return p;
  };
  const newPlan = async (title: string, startYear: number, endYear: number) => {
    const p = (await http.post(`${R}/plans`).set(as(director)).send({ kind: 'strategic', title, startYear, endYear, periodicity: 'annual' }).expect(201)).body;
    await http.post(`${R}/plans/${p.id}/items`).set(as(director)).send({ title: 'توجه أول' }).expect(201);
    return p.id as string;
  };

  beforeAll(async () => {
    Object.assign(process.env, {
      DATABASE_URL: DB, JWT_SECRET: 'test-secret', COMPANY_SLUG: 'rw-ctx', COMPANY_NAME: 'رعاية وطن',
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
    http = request(app.getHttpServer());
    const platform = await login('admin', 'Platform123');
    other = (await http.post('/api/platform/organizations').set(as(platform))
      .send({ name: 'منشأة أخرى', slug: 'other', adminFullName: 'مدير', adminEmail: 'o@other.org', adminPassword: 'Admin12345' }).expect(201)).body.id;
    company = (await db.query(`SELECT id FROM organizations WHERE slug = 'rw-ctx'`))[0].id;
    director = await login('director', 'RwAdmin2026');
    otherAdmin = await login('o@other.org', 'Admin12345', 'other');
    const role = await http.post('/api/roles').set(as(director)).send({ name: 'منسق تشغيلي', permissions: ['planning.dashboard.read', 'planning.operational.manage'] }).expect(201);
    await http.post('/api/users').set(as(director)).send({ fullName: 'منسق', email: 'clerk@rw.test', password: 'Clerk12345', roleIds: [role.body.id] }).expect(201);
    clerk = await login('clerk@rw.test', 'Clerk12345');
  }, 120000);

  afterAll(async () => {
    delete process.env.COMPANY_SLUG;
    await app?.close();
  });

  it('adds, edits and removes issues and stakeholders with the plan permission, scoped to the organization', async () => {
    ids.sp = await newPlan('الخطة الاستراتيجية التجريبية', 2027, 2029);
    let p = await approveAll(ids.sp);
    expect(p).toMatchObject({ status: 'approved', version: 1, issues: [], stakeholders: [] });

    // بلا صلاحية الخطط الاستراتيجية، وبلا أي صلاحية تحرير
    await http.post(`${R}/plans/${ids.sp}/issues`).set(as(clerk)).send({ title: 'قضية', summary: 'ملخص القضية' }).expect(403);
    // منشأة أخرى لا ترى الخطة
    await http.post(`${R}/plans/${ids.sp}/issues`).set(as(otherAdmin)).send({ title: 'قضية', summary: 'ملخص القضية' }).expect(404);
    await http.post(`${R}/plans/${ids.sp}/issues`).set(as(director)).send({ title: 'قضية', summary: 'ملخص', organizationId: other }).expect(400);
    await http.post(`${R}/plans/${ids.sp}/issues`).set(as(director)).send({ title: 'قضية بلا ملخص' }).expect(400);

    p = (await http.post(`${R}/plans/${ids.sp}/issues`).set(as(director))
      .send({ title: 'الاعتماد على عميل واحد', summary: 'معظم الدخل من الجهة المالكة', recommendations: 'تنويع الإيرادات\nباقات سنوية' }).expect(201)).body;
    // التعديل على خطة معتمدة يفتح مسودة تعديل
    expect(p.status).toBe('draft');
    expect(p.issues).toHaveLength(1);
    expect(p.issues[0].code).toBe('MI-01');
    ids.issue = p.issues[0].id;
    p = (await http.post(`${R}/plans/${ids.sp}/stakeholders`).set(as(director))
      .send({ name: 'الجمعية المالكة', category: 'الجهة المالكة', definition: 'المالك الوحيد', expectsFromUs: 'عوائد', weExpect: 'عقود' }).expect(201)).body;
    expect(p.stakeholders[0]).toMatchObject({ code: 'SH-01', name: 'الجمعية المالكة', category: 'الجهة المالكة', expectsFromUs: 'عوائد', weExpect: 'عقود' });
    ids.sh = p.stakeholders[0].id;

    await http.patch(`${R}/issues/${ids.issue}`).set(as(clerk)).send({ title: 'عنوان آخر' }).expect(403);
    await http.patch(`${R}/issues/${ids.issue}`).set(as(otherAdmin)).send({ title: 'عنوان آخر' }).expect(404);
    await http.delete(`${R}/issues/${ids.issue}`).set(as(otherAdmin)).expect(404);
    await http.patch(`${R}/stakeholders/${ids.sh}`).set(as(otherAdmin)).send({ name: 'آخر' }).expect(404);
    await http.delete(`${R}/stakeholders/${ids.sh}`).set(as(otherAdmin)).expect(404);
    await http.patch(`${R}/issues/${ids.issue}`).set(as(director)).send({ title: null }).expect(400);
    await http.patch(`${R}/issues/${ids.issue}`).set(as(director)).send({ sortOrder: null }).expect(400);
    p = (await http.patch(`${R}/issues/${ids.issue}`).set(as(director)).send({ title: 'تركز الإيرادات في الجهة المالكة' }).expect(200)).body;
    expect(p.issues[0].title).toBe('تركز الإيرادات في الجهة المالكة');
    expect(p.issues[0].summary).toBe('معظم الدخل من الجهة المالكة');

    // المقارنة بالإصدار المعتمد تعرض الإضافتين
    const c = (await http.get(`${R}/plans/${ids.sp}/compare?from=1`).set(as(director)).expect(200)).body;
    expect(c.rows.filter((r: any) => r.change === 'added').map((r: any) => [r.kind, r.code])).toEqual(expect.arrayContaining([['issue', 'MI-01'], ['stakeholder', 'SH-01']]));
    p = await approveAll(ids.sp, 'إضافة القضايا الجوهرية وخارطة المعنيين');
    expect(p.version).toBe(2);
    const v2 = (await http.get(`${R}/plans/${ids.sp}/versions/2`).set(as(director)).expect(200)).body;
    expect(v2.snapshot.issues).toHaveLength(1);
    expect(v2.snapshot.stakeholders[0].name).toBe('الجمعية المالكة');

    // إلغاء التعديل بعد حذف يعيدهما كما في الإصدار 2
    p = (await http.delete(`${R}/stakeholders/${ids.sh}`).set(as(director)).expect(200)).body;
    expect(p.stakeholders).toHaveLength(0);
    p = (await http.post(`${R}/plans/${ids.sp}/discard`).set(as(director)).expect(201)).body;
    expect(p.status).toBe('approved');
    expect(p.stakeholders.map((s: any) => s.id)).toEqual([ids.sh]);

    // النسخ لفترة جديدة ينسخهما
    const copy = (await http.post(`${R}/plans/${ids.sp}/copy`).set(as(director)).send({ title: 'نسخة الخطة', startYear: 2030, endYear: 2032 }).expect(201)).body;
    expect(copy.issues.map((i: any) => i.title)).toEqual(['تركز الإيرادات في الجهة المالكة']);
    expect(copy.stakeholders).toHaveLength(1);
    expect(copy.stakeholders[0].id).not.toBe(ids.sh);
    await http.delete(`${R}/plans/${copy.id}`).set(as(director)).expect(200);
    expect(Number((await db.query('SELECT count(*) AS n FROM plan_stakeholders WHERE plan_id = $1', [copy.id]))[0].n)).toBe(0);
  });

  it('imports the two optional sheets with the plan from Excel', async () => {
    const tpl = await http.get(`${R}/plans/import/template`).set(as(director)).buffer(true).parse((res, cb) => {
      const parts: Buffer[] = [];
      res.on('data', (d: Buffer) => parts.push(d));
      res.on('end', () => cb(null, Buffer.concat(parts)));
    }).expect(200);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(tpl.body);
    expect(wb.worksheets.map((w) => w.name)).toEqual(expect.arrayContaining(['القضايا الجوهرية', 'خارطة المعنيين']));
    // ملف بخطة صغيرة وعناوين أعمدة النموذج نفسه
    const build = async (extraStake: string[][]) => {
      const f = new ExcelJS.Workbook();
      f.addWorksheet('الخطة').addRows([['الحقل', 'القيمة'], ['نوع الخطة', 'استراتيجية'], ['عنوان الخطة', 'خطة مستوردة'], ['سنة البداية', 2027], ['سنة النهاية', 2028],
        ['دورية المتابعة', 'سنوية'], ['المستويات', 'توجه استراتيجي | D\nهدف استراتيجي | G']]);
      f.addWorksheet('العناصر').addRows([['الرمز *', 'الرمز الأب', 'العنوان *'], ['D1', '', 'توجه مستورد']]);
      f.addWorksheet('القضايا الجوهرية').addRows([['عنوان القضية *', 'ملخص القضية *', 'التوصيات المتوقعة'], ['الاعتماد على مصدر إيراد واحد', 'ملخص القضية', 'تنويع\nاحتياطي']]);
      f.addWorksheet('خارطة المعنيين').addRows([['المعني *', 'التصنيف *', 'التعريف', 'ما يتوقعه من الشركة', 'ما تتوقعه الشركة منه'],
        ['العملاء من الجمعيات', 'العملاء', 'الجمعيات المتعاقدة', 'جودة', 'سداد'], ['مجلس المديرين', 'الحوكمة', 'يعتمد الخطط', 'تقارير', 'قرارات'], ...extraStake]);
      return Buffer.from(await f.xlsx.writeBuffer());
    };
    const file = await build([['بلا تصنيف', '', '', '', '']]);

    let r = (await http.post(`${R}/plans/import`).set(as(director)).field('mode', 'check').attach('file', file, 'plan.xlsx').expect(201)).body;
    expect(r.ok).toBe(false);
    expect(r.errors.some((e: any) => e.sheet === 'خارطة المعنيين' && e.label === 'بلا تصنيف')).toBe(true);
    const fixed = await build([]);
    r = (await http.post(`${R}/plans/import`).set(as(director)).field('mode', 'apply').attach('file', fixed, 'plan.xlsx').expect(201)).body;
    expect(r.errors).toEqual([]);
    expect(r).toMatchObject({ ok: true, issues: 1, stakeholders: 2 });
    const p = (await http.get(`${R}/plans/${r.plan.id}`).set(as(director)).expect(200)).body;
    expect(p.issues[0]).toMatchObject({ code: 'MI-01', title: 'الاعتماد على مصدر إيراد واحد', recommendations: 'تنويع\nاحتياطي' });
    expect(p.stakeholders.map((s: any) => [s.code, s.name, s.category])).toEqual([['SH-01', 'العملاء من الجمعيات', 'العملاء'], ['SH-02', 'مجلس المديرين', 'الحوكمة']]);
    ids.imported = r.plan.id;
  });

  it('loads the company issues and stakeholders into the latest strategic plan once per plan', async () => {
    const svc = app.get(CompanyPlanContextService);
    const content = await svc.content();
    expect(content.issues.length).toBeGreaterThanOrEqual(8);
    expect(content.stakeholders.length).toBeGreaterThanOrEqual(12);
    const count = async (table: string, planId: string) => Number((await db.query(`SELECT count(*)::int AS n FROM ${table} WHERE organization_id = $1 AND plan_id = $2`, [company, planId]))[0].n);

    // أحدث خطة 2027 (المستوردة) مسودة: لا يُكتب في مسودة، ويُعاد المحاولة لاحقًا
    let r = await svc.run();
    expect(r).toBe('wait');
    expect(await count('plan_material_issues', ids.imported)).toBe(1);
    await http.delete(`${R}/plans/${ids.imported}`).set(as(director)).expect(200);
    // خطة معتمدة فيها قضايا مسبقًا لا يضاف إليها شيء
    r = await svc.run();
    expect(r).toMatchObject({ added: 0 });
    expect(await count('plan_material_issues', ids.sp)).toBe(1);

    // خطة جديدة معتمدة بلا قضايا: تُضاف البيانات ويُعتمد إصدار جديد
    ids.latest = await newPlan('الخطة الاستراتيجية لشركة رعاية وطن 2027 - 2029', 2027, 2029);
    await approveAll(ids.latest);
    r = await svc.run();
    expect(r).toMatchObject({ added: content.issues.length + content.stakeholders.length });
    expect(await count('plan_material_issues', ids.latest)).toBe(content.issues.length);
    expect(await count('plan_stakeholders', ids.latest)).toBe(content.stakeholders.length);
    const p = (await http.get(`${R}/plans/${ids.latest}`).set(as(director)).expect(200)).body;
    expect(p).toMatchObject({ status: 'approved', version: 2 });
    expect(p.versions[0].note).toBe(PLAN_CONTEXT_NOTE);
    expect(p.stakeholders[0].category).toBe('الجهة المالكة');

    // التشغيل الثاني لا يكرر، وحذف الشركة لقضية لا يعيدها
    expect(await svc.run()).toBeNull();
    await http.delete(`${R}/issues/${p.issues[0].id}`).set(as(director)).expect(200);
    await approveAll(ids.latest, 'حذف قضية');
    expect(await svc.run()).toBeNull();
    expect(await count('plan_material_issues', ids.latest)).toBe(content.issues.length - 1);
    // المنشآت الأخرى لا تتأثر
    expect(Number((await db.query('SELECT count(*)::int AS n FROM plan_stakeholders WHERE organization_id = $1', [other]))[0].n)).toBe(0);

    // خطط دورة لاحقة لا يُدرج فيها محتوى 2027
    const later = await newPlan('خطة الدورة التالية', 2030, 2032);
    await approveAll(later);
    expect(await svc.run()).toBeNull();
    expect(await count('plan_stakeholders', later)).toBe(0);
    // خطة 2027 قيد الاعتماد لا تُمس
    const pending = await newPlan('خطة 2027 أخرى', 2027, 2029);
    await http.post(`${R}/plans/${pending}/submit`).set(as(director)).send({}).expect(201);
    expect(await svc.run()).toBe('wait');
    expect(await count('plan_stakeholders', pending)).toBe(0);
  });
});
