import { Test } from '@nestjs/testing';
import { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/main';
import { CompanyPackService } from '../src/modules/starter/company-pack.service';

/**
 * حزمة رعاية وطن الجاهزة: تُدرج مرة واحدة في منشأة الشركة فقط، عبر خدمات الأنظمة نفسها:
 * التحليلات والمخاطر والخطتان معتمدة، والموازنة 2027 بأنشطتها، والضوابط والالتزام والاستمرارية وفريق الأزمات.
 * التشغيل الثاني لا يكرر شيئًا، والمنشآت الأخرى لا تتأثر.
 */
const DB = process.env.TEST_DATABASE_URL ?? 'postgres://erp:erp@localhost:5432/charity_erp_test';

describe('Company starter pack (strategy, risks and budget 2027)', () => {
  let app: NestExpressApplication;
  let db: DataSource;
  let pack: CompanyPackService;
  let company: string;
  let other: string;
  const n = async (table: string, org: string, where = 'TRUE') =>
    Number((await db.query(`SELECT count(*)::int AS n FROM ${table} WHERE organization_id = $1 AND ${where}`, [org]))[0].n);

  beforeAll(async () => {
    Object.assign(process.env, {
      DATABASE_URL: DB, JWT_SECRET: 'test-secret', COMPANY_SLUG: 'rw-pack', COMPANY_NAME: 'رعاية وطن',
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
    pack = app.get(CompanyPackService);
    const http = request(app.getHttpServer());
    const platform = (await http.post('/api/auth/login').send({ login: 'admin', password: 'Platform123' }).expect(200)).body.accessToken;
    other = (await http.post('/api/platform/organizations').set({ Authorization: `Bearer ${platform}` })
      .send({ name: 'منشأة أخرى', slug: 'other', adminFullName: 'مدير', adminEmail: 'o@other.org', adminPassword: 'Admin12345' }).expect(201)).body.id;
    company = (await db.query(`SELECT id FROM organizations WHERE slug = 'rw-pack'`))[0].id;
  }, 120000);

  afterAll(async () => {
    delete process.env.COMPANY_SLUG;
    await db.destroy();
    await app.close();
  });

  it('inserts the whole pack once, approved, in the company only', async () => {
    const results = await pack.run();
    expect(results).not.toBeNull();
    expect(results!.map((r) => r.key)).toEqual(['starter-risk', 'starter-planning', 'policy', 'analyses', 'strategic', 'operational', 'budget', 'controls', 'compliance', 'continuity']);

    expect(await n('risk_analyses', company, `status = 'approved'`)).toBe(2);
    expect(await n('risk_register', company)).toBe(23);
    expect(await n('risk_register', company, `status = 'approved'`)).toBe(23);
    expect(await n('risk_policy_versions', company)).toBe(1);
    const plans = await db.query('SELECT kind, status, version FROM plan_plans WHERE organization_id = $1 ORDER BY kind', [company]);
    expect(plans).toEqual([{ kind: 'operational', status: 'approved', version: 1 }, { kind: 'strategic', status: 'approved', version: 1 }]);
    expect(await n('plan_kpis', company)).toBeGreaterThanOrEqual(29);
    // روابط المخاطر وعوامل التحليل كلها محلولة في الخطة الاستراتيجية
    expect(await n('plan_refs', company, `system = 'risk'`)).toBeGreaterThan(0);
    expect(await n('plan_refs', company, `system = 'risk_analysis'`)).toBeGreaterThan(0);

    const [b] = await db.query('SELECT id, status, fiscal_year FROM plan_budgets WHERE organization_id = $1', [company]);
    expect(b).toMatchObject({ status: 'approved', fiscal_year: 2027 });
    const [{ rev, exp }] = await db.query(
      `SELECT sum(amount) FILTER (WHERE section = 'revenue')::numeric AS rev, sum(amount) FILTER (WHERE section <> 'revenue')::numeric AS exp
         FROM plan_budget_lines WHERE organization_id = $1 AND budget_id = $2 AND included`, [company, b.id]);
    expect(Number(rev)).toBe(1230000);
    expect(Number(rev) - Number(exp)).toBe(397500);
    expect(await n('plan_budget_lines', company, `section = 'activity'`)).toBeGreaterThan(0);

    expect(await n('risk_controls', company)).toBe(10);
    expect(await n('risk_obligations', company)).toBe(9);
    expect(await n('risk_continuity', company, `status = 'approved'`)).toBe(4);
    expect(await n('risk_crisis_teams', company, `status = 'approved'`)).toBe(1);

    for (const t of ['risk_register', 'risk_analyses', 'plan_plans', 'plan_budgets', 'risk_controls', 'risk_obligations']) expect(await n(t, other)).toBe(0);
  }, 180000);

  it('never runs twice', async () => {
    expect(await pack.run()).toBeNull();
    expect(await n('risk_register', company)).toBe(23);
    expect(await n('plan_plans', company)).toBe(2);
    expect(await n('plan_budgets', company)).toBe(1);
    const [s] = await db.query(`SELECT status FROM organization_starters WHERE organization_id = $1 AND module_code = 'rw-plan-2027'`, [company]);
    expect(s.status).toBe('applied');
  });
});
