import { Test } from '@nestjs/testing';
import { NestExpressApplication } from '@nestjs/platform-express';
import { join } from 'path';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/main';
import { CompanyPackService } from '../src/modules/starter/company-pack.service';
import { PACK_LEGACY } from '../src/modules/starter/company-pack.content';

/**
 * ترقية حزمة رعاية وطن من الخطة 2027 - 2030 (المُدرجة سابقًا) إلى 2027 - 2029:
 * الخطتان والموازنة تُعدَّل في مكانها وتصبح إصدارًا ثانيًا معتمدًا (والأول محفوظ)، ومخاطر الأوقاف والاستثمار تُغلق،
 * والخطة التي عليها إنجاز لا يُستبدل محتواها.
 */
const DB = process.env.TEST_DATABASE_URL ?? 'postgres://erp:erp@localhost:5432/charity_erp_test';
const OLD_DIR = join(__dirname, 'fixtures', 'company-pack-2027-2030');

describe('Company starter pack upgrade (2027-2030 -> 2027-2029)', () => {
  let app: NestExpressApplication;
  let db: DataSource;
  let pack: CompanyPackService;
  let company: string;
  const n = async (table: string, where = 'TRUE') =>
    Number((await db.query(`SELECT count(*)::int AS n FROM ${table} WHERE organization_id = $1 AND ${where}`, [company]))[0].n);
  /** يحاكي الحزمة السابقة: إدراج ملفات 2027 - 2030 ثم تسجيلها بالرمز القديم */
  const installOld = async () => {
    process.env.COMPANY_PACK_DIR = OLD_DIR;
    expect(await pack.run()).not.toBeNull();
    delete process.env.COMPANY_PACK_DIR;
    await db.query(`UPDATE organization_starters SET module_code = $2 WHERE organization_id = $1 AND module_code = 'rw-plan-2027-2029'`, [company, PACK_LEGACY.code]);
  };

  beforeAll(async () => {
    Object.assign(process.env, {
      DATABASE_URL: DB, JWT_SECRET: 'test-secret', COMPANY_SLUG: 'rw-upgrade', COMPANY_NAME: 'رعاية وطن',
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
    company = (await db.query(`SELECT id FROM organizations WHERE slug = 'rw-upgrade'`))[0].id;
    await installOld();
  }, 180000);

  afterAll(async () => {
    delete process.env.COMPANY_SLUG;
    delete process.env.COMPANY_PACK_DIR;
    await db.destroy();
    await app.close();
  });

  it('starts from the old approved 2027-2030 package', async () => {
    const [sp] = await db.query(`SELECT title, end_year, version, status FROM plan_plans WHERE organization_id = $1 AND kind = 'strategic'`, [company]);
    expect(sp).toEqual({ title: PACK_LEGACY.strategicTitle, end_year: 2030, version: 1, status: 'approved' });
    expect(await n('risk_register', `title = ANY('{${PACK_LEGACY.retiredRisks.join(',')}}') AND risk_state <> 'closed'`)).toBe(4);
  });

  /** حالة البيانات قبل الترقية: تبقى كما هي إن أوقفها مانع */
  const untouched = async () => {
    const plans = await db.query('SELECT kind, title, version, status FROM plan_plans WHERE organization_id = $1 ORDER BY kind', [company]);
    expect(plans).toEqual([
      { kind: 'operational', title: 'الخطة التشغيلية لشركة رعاية وطن 2027', version: 1, status: 'approved' },
      { kind: 'strategic', title: PACK_LEGACY.strategicTitle, version: 1, status: 'approved' },
    ]);
    const [b] = await db.query('SELECT id, version, status FROM plan_budgets WHERE organization_id = $1', [company]);
    expect(b).toMatchObject({ version: 1, status: 'approved' });
    expect(await n('plan_budget_lines', `budget_id = '${b.id}'`)).toBe(lines);
    expect(await n('plan_links')).toBe(links);
    expect(await n('risk_register', `title = ANY('{${PACK_LEGACY.retiredRisks.join(',')}}') AND risk_state <> 'closed'`)).toBe(4);
    // الحجز يُلغى فيُعاد التشغيل بعد معالجة السبب
    expect(await n('organization_starters', `module_code = 'rw-plan-2027-2029'`)).toBe(0);
  };
  let lines = 0;
  let links = 0;

  it('stops before any change when the operational plan has recorded progress', async () => {
    lines = await n('plan_budget_lines');
    links = await n('plan_links');
    const [item] = await db.query(`SELECT i.id FROM plan_items i JOIN plan_plans p ON p.id = i.plan_id WHERE i.organization_id = $1 AND p.kind = 'operational' LIMIT 1`, [company]);
    await db.query(`INSERT INTO plan_progress_updates (organization_id, item_id, update_date, progress, state, by_name) VALUES ($1, $2, '2027-01-15', 10, 'in_progress', 'مستخدم')`, [company, item.id]);
    await expect(pack.run()).rejects.toThrow(/before any change/);
    await untouched();
    await db.query('DELETE FROM plan_progress_updates WHERE organization_id = $1 AND item_id = $2', [company, item.id]);
  }, 180000);

  it('stops before any change when a budget line has a commitment', async () => {
    const [l] = await db.query(`SELECT id, budget_id FROM plan_budget_lines WHERE organization_id = $1 AND section = 'opex' LIMIT 1`, [company]);
    await db.query(`INSERT INTO plan_budget_commitments (organization_id, budget_id, line_id, source_module, source_ref, amount, status, created_by_name)
      VALUES ($1, $2, $3, 'procurement', 'PO-TEST', 100, 'reserved', 'مستخدم')`, [company, l.budget_id, l.id]);
    await expect(pack.run()).rejects.toThrow(/before any change/);
    await untouched();
    await db.query(`DELETE FROM plan_budget_commitments WHERE organization_id = $1 AND source_ref = 'PO-TEST'`, [company]);
  }, 180000);

  it('stops before any change when a user is editing the strategic plan', async () => {
    await db.query(`UPDATE plan_plans SET status = 'draft' WHERE organization_id = $1 AND kind = 'strategic'`, [company]);
    await expect(pack.run()).rejects.toThrow(/before any change/);
    await db.query(`UPDATE plan_plans SET status = 'approved' WHERE organization_id = $1 AND kind = 'strategic'`, [company]);
    await untouched();
  }, 180000);

  it('revises plans and budget in place as version 2 and closes the waqf and investment risks', async () => {
    const results = await pack.run();
    expect(results).not.toBeNull();

    const plans = await db.query('SELECT id, kind, title, end_year, status, version, parent_plan_id FROM plan_plans WHERE organization_id = $1 ORDER BY kind', [company]);
    expect(plans.map((p: { kind: string; status: string; version: number }) => [p.kind, p.status, p.version])).toEqual([['operational', 'approved', 2], ['strategic', 'approved', 2]]);
    const [op, sp] = plans;
    expect(sp).toMatchObject({ title: 'الخطة الاستراتيجية لشركة رعاية وطن 2027 - 2029', end_year: 2029 });
    expect(op.parent_plan_id).toBe(sp.id);
    // الإصدار الأول محفوظ، والثاني بسبب التعديل
    const versions = await db.query('SELECT version, note FROM plan_versions WHERE organization_id = $1 AND plan_id = $2 ORDER BY version', [company, sp.id]);
    expect(versions.map((v: { version: number }) => v.version)).toEqual([1, 2]);
    expect(versions[1].note).toBe(PACK_LEGACY.revisionNote);
    const [{ old }] = await db.query(`SELECT snapshot::text LIKE '%' || $2 || '%' AS old FROM plan_versions WHERE plan_id = $1 AND version = 1`, [sp.id, 'التوسع في المنتجات الوقفية']);
    expect(old).toBe(true);
    // التوجه الثالث صار الاستدامة المؤسسية، ولا عناصر وقفية أو استثمارية
    expect(await n('plan_items', `plan_id = '${sp.id}' AND title = 'تحقيق الاستدامة المؤسسية'`)).toBe(1);
    expect(await n('plan_items', `plan_id = '${sp.id}' AND (title LIKE '%وقف%' OR title LIKE '%الاستثمار%')`)).toBe(0);
    expect(await n('plan_items', `plan_id = '${sp.id}' AND level = 0`)).toBe(4);
    expect(await n('plan_items', `plan_id = '${sp.id}' AND level = 1`)).toBe(12);
    // أنشطة الخطة التشغيلية مرتبطة بمبادرات الخطة الجديدة
    const [{ links }] = await db.query(
      `SELECT count(*)::int AS links FROM plan_links l JOIN plan_items f ON f.id = l.from_item_id JOIN plan_items t ON t.id = l.to_item_id
        WHERE l.organization_id = $1 AND f.plan_id = $2 AND t.plan_id = $3`, [company, op.id, sp.id]);
    expect(links).toBe(await n('plan_items', `plan_id = '${op.id}'`));

    const [b] = await db.query('SELECT id, status, version FROM plan_budgets WHERE organization_id = $1', [company]);
    expect(b).toMatchObject({ status: 'approved', version: 2 });
    const [{ rev, exp }] = await db.query(
      `SELECT sum(amount) FILTER (WHERE section = 'revenue')::numeric AS rev, sum(amount) FILTER (WHERE section <> 'revenue')::numeric AS exp
         FROM plan_budget_lines WHERE organization_id = $1 AND budget_id = $2 AND included`, [company, b.id]);
    expect(Number(rev)).toBe(1220000);
    expect(Number(rev) - Number(exp)).toBe(402500);
    // أنشطة الموازنة كلها من عناصر الخطة التشغيلية الجديدة
    expect(await n('plan_budget_lines', `budget_id = '${b.id}' AND section = 'activity' AND source_id NOT IN (SELECT id FROM plan_items WHERE plan_id = '${op.id}')`)).toBe(0);
    const bv = await db.query('SELECT version, note FROM plan_budget_versions WHERE organization_id = $1 AND budget_id = $2 ORDER BY version', [company, b.id]);
    expect(bv.map((v: { version: number }) => v.version)).toEqual([1, 2]);
    expect(bv[1].note).toBe(PACK_LEGACY.revisionNote);

    // مخاطر الأوقاف والاستثمار مغلقة ومعها سبب الإغلاق، والمخاطر الجديدة معتمدة
    const closed = await db.query(`SELECT r.id FROM risk_register r WHERE r.organization_id = $1 AND r.title = ANY($2) AND r.risk_state = 'closed'`, [company, PACK_LEGACY.retiredRisks]);
    expect(closed).toHaveLength(4);
    expect(await n('risk_reviews', `risk_id = ANY('{${closed.map((c: { id: string }) => c.id).join(',')}}') AND note = '${PACK_LEGACY.retireNote}'`)).toBe(4);
    expect(await n('risk_register', `title = 'تأخر توقيع عقود جمعية عناية أو تقليص نطاقها' AND status = 'approved'`)).toBe(1);
    expect(await n('risk_register')).toBe(27);
    // لا روابط من الخطة الجديدة لمخاطر مغلقة
    expect(await n('plan_refs', `system = 'risk' AND ref_id = ANY('{${closed.map((c: { id: string }) => c.id).join(',')}}')`)).toBe(0);
  }, 180000);

  it('never runs twice', async () => {
    expect(await pack.run()).toBeNull();
    expect(await n('plan_plans')).toBe(2);
    expect(await n('plan_budgets')).toBe(1);
  });
});
