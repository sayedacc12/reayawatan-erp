import { Test } from '@nestjs/testing';
import { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/main';
import { routeInventory, RouteInfo } from './route-inventory';

/**
 * بوابة أمنية: عزل بيانات الجمعيات (قراءة).
 *
 * جمعية «الضحية» فيها بيانات تجريبية في كل الأنظمة، وجمعية «المهاجم» يدخلها مدير نظامها بكل الصلاحيات.
 * 1) كل مسار GET بدون معاملات: رد المهاجم يجب ألا يحتوي أي معرف (UUID) تملكه الضحية في قاعدة البيانات.
 * 2) كل مسار GET بمعامل واحد في آخره (مثل /x/:id): يُجرَّب بمعرفات الضحية الظاهرة في قائمتها الأم (/x)،
 *    والرد يجب ألا يكون نجاحًا يحتوي ذلك المعرف.
 *
 * مجموعة «معرفات الضحية» تُقرأ من القاعدة مباشرة (كل جدول فيه organization_id)، فلا تعتمد على كود التطبيق.
 * الاختبار يمسح قاعدة الاختبار: شغّله وحده (npx jest test/security/tenant-isolation.e2e-spec.ts).
 */
const DB = process.env.TEST_DATABASE_URL ?? 'postgres://erp:erp@localhost:5432/charity_erp_test';
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

/** مسارات تُستثنى عمدًا مع السبب (يجب أن تبقى القائمة قصيرة ومبررة) */
const SKIP: Record<string, string> = {
  'GET /hr/iclock/cdata': 'بروتوكول أجهزة البصمة، ليس واجهة بيانات',
  'GET /hr/iclock/getrequest': 'بروتوكول أجهزة البصمة، ليس واجهة بيانات',
};

describe('Security gate: tenant isolation on every read endpoint', () => {
  let app: NestExpressApplication;
  let http: ReturnType<typeof request>;
  let db: DataSource;
  let victim: string;
  let attacker: string;
  let victimOrgId: string;
  let victimIds = new Set<string>();
  const as = (t: string) => ({ Authorization: `Bearer ${t}` });
  const login = async (login: string, password: string, organization?: string) =>
    (await http.post('/api/auth/login').send({ login, password, organization }).expect(200)).body.accessToken as string;

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
    db = app.get(DataSource);
    const platform = await login('admin', 'Platform123');

    const mk = async (slug: string, email: string) => {
      const org = (await http.post('/api/platform/organizations').set(as(platform)).send({
        name: `جمعية ${slug}`, slug, adminFullName: `مدير ${slug}`, adminEmail: email, adminPassword: 'Admin12345',
      }).expect(201)).body;
      await http.patch(`/api/platform/organizations/${org.id}/subscription`).set(as(platform))
        .send({ status: 'trial', trialEndsOn: new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10) }).expect(200);
      return org.id as string;
    };
    victimOrgId = await mk('victim', 'owner@victim.sa');
    await mk('attacker', 'owner@attacker.sa');
    victim = await login('owner@victim.sa', 'Admin12345', 'victim');
    attacker = await login('owner@attacker.sa', 'Admin12345', 'attacker');
    await http.post('/api/sample-data').set(as(victim)).expect(201);

    // كل معرف تملكه الضحية، من القاعدة مباشرة
    const tables: { table_name: string }[] = await db.query(`
      SELECT c.table_name FROM information_schema.columns c
      JOIN information_schema.columns i ON i.table_name = c.table_name AND i.table_schema = c.table_schema AND i.column_name = 'id' AND i.data_type = 'uuid'
      WHERE c.table_schema = 'public' AND c.column_name = 'organization_id'`);
    for (const { table_name } of tables) {
      const rows: { id: string }[] = await db.query(`SELECT id::text AS id FROM "${table_name}" WHERE organization_id = $1`, [victimOrgId]);
      rows.forEach((r) => victimIds.add(r.id.toLowerCase()));
    }
    victimIds.add(victimOrgId.toLowerCase());
  }, 600000);

  afterAll(async () => {
    await db?.destroy();
    await app?.close();
  });

  const routes = routeInventory().filter((r) => r.method === 'GET' && r.decision !== 'public' && !SKIP[r.key]);
  const noParam = routes.filter((r) => !r.path.includes(':'));
  const oneParam = routes.filter((r) => (r.path.match(/:/g) ?? []).length === 1 && /\/:[A-Za-z]+$/.test(r.path));

  const leaked = (body: unknown) => {
    const text = typeof body === 'string' ? body : Buffer.isBuffer(body) ? '' : JSON.stringify(body ?? '');
    return [...new Set((text.match(UUID) ?? []).map((x) => x.toLowerCase()))].filter((x) => victimIds.has(x));
  };

  it('the victim really has data in many tables', () => {
    expect(victimIds.size).toBeGreaterThan(500);
  });

  const victimLists = new Map<string, string[]>();

  it('list/dashboard endpoints never return another organization\'s records', async () => {
    const leaks: string[] = [];
    for (const r of noParam) {
      const url = '/api' + r.path;
      const v = await http.get(url).set(as(victim));
      if (v.status < 300) victimLists.set(r.path, leaked(v.body).slice(0, 3));
      const a = await http.get(url).set(as(attacker));
      if (a.status < 300) {
        const ids = leaked(a.body);
        if (ids.length) leaks.push(`${r.key} (${r.controller}.${r.handler}) -> ${ids.length} victim ids`);
      }
    }
    expect(leaks).toEqual([]);
  }, 600000);

  it('detail endpoints reject another organization\'s ids', async () => {
    const leaks: string[] = [];
    let probes = 0;
    for (const r of oneParam) {
      const parent = r.path.replace(/\/:[A-Za-z]+$/, '');
      const candidates = victimLists.get(parent) ?? [];
      for (const id of candidates) {
        probes++;
        const url = '/api' + r.path.replace(/:[A-Za-z]+$/, id);
        const a = await http.get(url).set(as(attacker));
        if (a.status < 300 && leaked(a.body).includes(id)) leaks.push(`${r.key} with ${id} -> ${a.status} (${r.controller}.${r.handler})`);
      }
    }
    expect(probes).toBeGreaterThan(20);
    expect(leaks).toEqual([]);
  }, 600000);
});
