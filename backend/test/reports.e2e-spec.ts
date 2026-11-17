import { Test } from '@nestjs/testing';
import { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { ReportPdfService } from '../src/core/reports/report-pdf.service';
import { configureApp } from '../src/main';

/** بنية التقارير الموحدة: كل تقارير الأنظمة تعمل على بيانات الجمعية التجريبية وتُصدَّر، والصلاحيات تُحترم */
const DB = process.env.TEST_DATABASE_URL ?? 'postgres://erp:erp@localhost:5432/charity_erp_test';
const ORG_MODULES = ['beneficiaries', 'fundraising', 'projects', 'accounting', 'hr', 'volunteers', 'quality', 'risk', 'audit'];
const PLATFORM_MODULES = ['platform', 'support'];

describe('Unified reports', () => {
  let app: NestExpressApplication;
  let http: ReturnType<typeof request>;
  let platform: string;
  let admin: string;
  let researcher: string;
  const as = (t: string) => ({ Authorization: `Bearer ${t}` });
  const login = async (login: string, password: string, organization?: string) =>
    (await http.post('/api/auth/login').send({ login, password, organization }).expect(200)).body.accessToken as string;

  /** قيم الفلاتر الافتراضية، وأول خيار للقوائم الإلزامية */
  const defaults = async (token: string, code: string) => {
    const def = (await http.get(`/api/reports/def/${code}`).set(as(token)).expect(200)).body;
    const q: Record<string, string> = {};
    for (const f of def.filters) q[f.key] = f.default ?? (f.required && f.options?.length ? f.options[0].value : '');
    return { def, q };
  };

  beforeAll(async () => {
    Object.assign(process.env, {
      DATABASE_URL: DB, JWT_SECRET: 'test-secret', PLATFORM_ADMIN_EMAIL: 'platform@test.org', PLATFORM_ADMIN_PASSWORD: 'Platform123',
      UPLOAD_DIR: '/tmp/sanabel-test-uploads',
    });
    const reset = new DataSource({ type: 'postgres', url: DB });
    await reset.initialize();
    await reset.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
    await reset.destroy();
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(moduleRef.createNestApplication<NestExpressApplication>());
    await app.init();
    http = request(app.getHttpServer());
    platform = await login('admin', 'Platform123');
    const demo = (await http.post('/api/platform/demo-organization').set(as(platform)).expect(201)).body;
    admin = await login('demo-admin@sanabelerp.com', demo.staffPassword, 'demo');
    researcher = await login('demo-researcher@sanabelerp.com', demo.staffPassword, 'demo');
  }, 120_000);

  afterAll(async () => {
    await app.get(DataSource).destroy();
    await app.close();
  });

  it('every organization report runs on the demo association', async () => {
    for (const m of ORG_MODULES) {
      const cat = (await http.get(`/api/reports/catalog/${m}`).set(as(admin)).expect(200)).body;
      expect(cat.reports.length).toBeGreaterThan(3);
      for (const r of cat.reports) {
        const { q } = await defaults(admin, r.code);
        const res = await http.get(`/api/reports/run/${r.code}`).query(q).set(as(admin));
        if (res.status !== 200) throw new Error(`${r.code}: ${res.status} ${JSON.stringify(res.body)}`);
        expect(res.body.title).toBe(r.title);
        expect(Array.isArray(res.body.rows)).toBe(true);
        expect(res.body.columns.length).toBeGreaterThan(0);
        expect(res.body.organizationName).toContain('سنابل');
      }
    }
  }, 120_000);

  it('platform reports run for the platform team only', async () => {
    for (const m of PLATFORM_MODULES) {
      const cat = (await http.get(`/api/reports/catalog/${m}`).set(as(platform)).expect(200)).body;
      expect(cat.reports.length).toBeGreaterThan(3);
      for (const r of cat.reports) {
        const { q } = await defaults(platform, r.code);
        await http.get(`/api/reports/run/${r.code}`).query(q).set(as(platform)).expect(200);
      }
      // موظفو الجمعيات لا يرون تقارير المنصة
      expect((await http.get(`/api/reports/catalog/${m}`).set(as(admin)).expect(200)).body.reports).toHaveLength(0);
    }
    await http.get('/api/reports/run/platform.organizations').set(as(admin)).expect(403);
    // ومدير المنصة لا يرى تقارير بيانات الجمعيات
    expect((await http.get('/api/reports/catalog/hr').set(as(platform)).expect(200)).body.reports).toHaveLength(0);
  }, 60_000);

  it('respects report permissions', async () => {
    // الباحث الاجتماعي ليس له صلاحية تقارير المستفيدين ولا الموارد البشرية
    expect((await http.get('/api/reports/catalog/beneficiaries').set(as(researcher)).expect(200)).body.reports).toHaveLength(0);
    await http.get('/api/reports/run/beneficiaries.register').set(as(researcher)).expect(403);
    await http.get('/api/reports/export/hr.employees?format=xlsx').set(as(researcher)).expect(403);
    await http.get('/api/reports/run/nope.report').set(as(admin)).expect(404);
  });

  it('validates filters', async () => {
    await http.get('/api/reports/run/fundraising.donors').query({ from: '2026-12-01', to: '2026-01-01' }).set(as(admin)).expect(400);
    await http.get('/api/reports/run/fundraising.donors').query({ from: 'yesterday' }).set(as(admin)).expect(400);
    await http.get('/api/reports/run/fundraising.opportunities').query({ kind: 'bitcoin' }).set(as(admin)).expect(400);
    await http.get('/api/reports/run/accounting.ledger').query({ accountId: '' }).set(as(admin)).expect(400);
    await http.get('/api/reports/export/fundraising.donors').query({ format: 'docx' }).set(as(admin)).expect(400);
  });

  it('computes totals and applies the period', async () => {
    const res = (await http.get('/api/reports/run/fundraising.opportunities').query({ from: '2026-01-01', to: '2026-12-31', status: 'approved' })
      .set(as(admin)).expect(200)).body;
    const sum = res.rows.reduce((s: number, r: { amount: number }) => s + r.amount, 0);
    expect(res.totals.amount).toBeCloseTo(sum, 2);
    expect(res.appliedFilters.map((f: { label: string }) => f.label)).toEqual(['الفترة', 'الحالة']);
    const tb = (await http.get('/api/reports/run/accounting.trial-balance').query({ from: '2026-01-01', to: '2026-12-31', level: '9' }).set(as(admin)).expect(200)).body;
    expect(tb.totals.closingDebit).toBeCloseTo(tb.totals.closingCredit, 2);
  });

  it('exports Excel and CSV with Arabic headers', async () => {
    const xlsx = await http.get('/api/reports/export/hr.employees').query({ format: 'xlsx' }).set(as(admin)).buffer(true)
      .parse((res, cb) => { const chunks: Buffer[] = []; res.on('data', (c: Buffer) => chunks.push(c)); res.on('end', () => cb(null, Buffer.concat(chunks))); }).expect(200);
    expect(xlsx.headers['content-type']).toContain('spreadsheetml');
    expect((xlsx.body as Buffer).subarray(0, 2).toString()).toBe('PK');
    expect(decodeURIComponent(xlsx.headers['content-disposition'])).toContain('سجل الموظفين');

    const csv = await http.get('/api/reports/export/beneficiaries.register').query({ format: 'csv' }).set(as(admin)).expect(200);
    expect(csv.text.charCodeAt(0)).toBe(0xfeff);
    expect(csv.text).toContain('رقم الملف');

    const html = await http.get('/api/reports/export/volunteers.hours').query({ format: 'html' }).set(as(admin)).expect(200);
    expect(html.text).toContain('dir="rtl"');
    expect(html.text).toContain('ساعات المتطوعين');
  });

  it('exports PDF when Chromium is available', async () => {
    if (!app.get(ReportPdfService).available) return;
    const pdf = await http.get('/api/reports/export/accounting.trial-balance').query({ format: 'pdf', level: '2' }).set(as(admin)).buffer(true)
      .parse((res, cb) => { const chunks: Buffer[] = []; res.on('data', (c: Buffer) => chunks.push(c)); res.on('end', () => cb(null, Buffer.concat(chunks))); }).expect(200);
    expect(pdf.headers['content-type']).toBe('application/pdf');
    expect((pdf.body as Buffer).subarray(0, 5).toString()).toBe('%PDF-');
  }, 60_000);
});
