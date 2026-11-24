import { Test } from '@nestjs/testing';
import { NestExpressApplication } from '@nestjs/platform-express';
import { join } from 'path';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/main';
import { OrgUser } from '../src/core/auth/decorators';
import { BudgetsService } from '../src/modules/planning/budget/budgets.service';
import { BoardReportsService } from '../src/modules/planning/board/board-reports.service';
import { PlansService } from '../src/modules/planning/plans.service';
import { CompanyPackService } from '../src/modules/starter/company-pack.service';
import { PACK_LEGACY } from '../src/modules/starter/company-pack.content';

/**
 * ترقية حزمة رعاية وطن من الخطة 2027 - 2030 (المُدرجة سابقًا) إلى 2027 - 2029:
 * الخطتان والموازنة تُعدَّل في مكانها كمسودة تعديل لا تُعتمد (قرار المالك 2026-11-24)، والإصدار الأول المعتمد باقٍ،
 * ثم تمر بالاعتماد الأولي من الإدارة التنفيذية (وبعده فقط يُطبع تقرير المجلس) ثم اعتماد المجلس فتصبح إصدارًا ثانيًا.
 * مخاطر الأوقاف والاستثمار تُغلق، والخطة التي عليها إنجاز لا يُستبدل محتواها.
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
  let actor: OrgUser;
  /** يمر بمراحل الاعتماد كلها */
  const approveAll = async (submit: () => Promise<unknown>, decide: () => Promise<{ status: string }>) => {
    await submit();
    let st = 'in_review';
    for (let i = 0; i < 5 && st === 'in_review'; i++) st = (await decide()).status;
    expect(st).toBe('approved');
  };
  const planIds = async () => Object.fromEntries((await db.query('SELECT kind, id FROM plan_plans WHERE organization_id = $1', [company])).map((r: { kind: string; id: string }) => [r.kind, r.id]));
  const budgetId = async () => (await db.query('SELECT id FROM plan_budgets WHERE organization_id = $1', [company]))[0].id as string;
  /**
   * يحاكي الحزمة السابقة كما هي في الإنتاج: ملفات 2027 - 2030 معتمدة إصدارًا أول (الخطتان ثم الموازنة بأنشطتها)،
   * ومسارات الاعتماد القديمة الموروثة في الإعدادات، ثم تسجيلها بالرمز القديم
   */
  const installOld = async () => {
    process.env.COMPANY_PACK_DIR = OLD_DIR;
    expect(await pack.run()).not.toBeNull();
    delete process.env.COMPANY_PACK_DIR;
    actor = await (pack as unknown as { actor(o: string, s: string): Promise<OrgUser> }).actor(company, 'rw-upgrade');
    const plans = app.get(PlansService), budgets = app.get(BudgetsService);
    const ids = await planIds();
    for (const k of ['strategic', 'operational']) await approveAll(() => plans.submit(actor, ids[k], null), () => plans.decide(actor, ids[k], { decision: 'approve', note: 'قرار مجلس المديرين رقم 1/2027' } as never));
    const b = await budgetId();
    await budgets.importLines(actor, b, { source: 'activities' });
    await approveAll(() => budgets.submit(actor, b, null), () => budgets.decide(actor, b, { decision: 'approve', note: 'قرار مجلس المديرين رقم 1/2027' } as never));
    await db.query(`UPDATE plan_settings SET config = jsonb_set(config, '{routes}', $2::jsonb) WHERE organization_id = $1`, [company, JSON.stringify(OLD_ROUTES)]);
    await db.query(`UPDATE organization_starters SET module_code = $2 WHERE organization_id = $1 AND module_code = 'rw-plan-2027-2029'`, [company, PACK_LEGACY.code]);
    // الحزمة السابقة لم تكن تسجل خطواتها
    await db.query(`DELETE FROM organization_starters WHERE organization_id = $1 AND module_code LIKE 'rw-plan-2027-2029.%'`, [company]);
  };
  const OLD_ROUTES = [
    { key: 'strategic', name: 'اعتماد الخطة الاستراتيجية', planKind: 'strategic', unitId: null, minCost: null, stages: [{ name: 'مراجعة إدارة التخطيط والأداء', roleId: null }, { name: 'اعتماد المدير التنفيذي', roleId: null }, { name: 'اعتماد مجلس الإدارة', roleId: null }] },
    { key: 'operational-large', name: 'خطة تشغيلية كبيرة', planKind: 'operational', unitId: null, minCost: 1000000, stages: [{ name: 'اعتماد المدير التنفيذي', roleId: null }] },
    { key: 'budget', name: 'اعتماد الموازنة التقديرية', planKind: 'budget', unitId: null, minCost: null, stages: [{ name: 'اعتماد المدير التنفيذي', roleId: null }] },
    { key: 'transfer', name: 'اعتماد المناقلات', planKind: 'transfer', unitId: null, minCost: null, stages: [{ name: 'مراجعة الإدارة المالية', roleId: null }] },
  ];

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

  it('revises plans and budget in place as drafts awaiting approval, and closes the waqf and investment risks', async () => {
    const results = await pack.run();
    expect(results).not.toBeNull();

    const plans = await db.query('SELECT id, kind, title, end_year, status, version, revision_note, parent_plan_id FROM plan_plans WHERE organization_id = $1 ORDER BY kind', [company]);
    // لا اعتماد: مسودة تعديل على الإصدار الأول المعتمد، بسبب التعديل جاهزًا للرفع
    expect(plans.map((p: { kind: string; status: string; version: number; revision_note: string }) => [p.kind, p.status, p.version, p.revision_note]))
      .toEqual([['operational', 'draft', 1, PACK_LEGACY.revisionNote], ['strategic', 'draft', 1, PACK_LEGACY.revisionNote]]);
    const [op, sp] = plans;
    expect(sp).toMatchObject({ title: 'الخطة الاستراتيجية لشركة رعاية وطن 2027 - 2029', end_year: 2029 });
    expect(op.parent_plan_id).toBe(sp.id);
    // الإصدار الأول المعتمد محفوظ كما هو
    const versions = await db.query('SELECT version FROM plan_versions WHERE organization_id = $1 AND plan_id = $2 ORDER BY version', [company, sp.id]);
    expect(versions.map((v: { version: number }) => v.version)).toEqual([1]);
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

    const [b] = await db.query('SELECT id, status, version, revision_note FROM plan_budgets WHERE organization_id = $1', [company]);
    expect(b).toMatchObject({ status: 'draft', version: 1, revision_note: PACK_LEGACY.revisionNote });
    const [{ rev, exp }] = await db.query(
      `SELECT sum(amount) FILTER (WHERE section = 'revenue')::numeric AS rev, sum(amount) FILTER (WHERE section <> 'revenue')::numeric AS exp
         FROM plan_budget_lines WHERE organization_id = $1 AND budget_id = $2 AND included`, [company, b.id]);
    expect(Number(rev)).toBe(1220000);
    expect(Number(rev) - Number(exp)).toBe(402500);
    // أنشطة الموازنة كلها من عناصر الخطة التشغيلية الجديدة
    expect(await n('plan_budget_lines', `budget_id = '${b.id}' AND section = 'activity'`)).toBeGreaterThan(0);
    expect(await n('plan_budget_lines', `budget_id = '${b.id}' AND section = 'activity' AND source_id NOT IN (SELECT id FROM plan_items WHERE plan_id = '${op.id}')`)).toBe(0);
    expect(await n('plan_budget_versions', `budget_id = '${b.id}'`)).toBe(1);

    // مسارات الخطط والموازنة صارت مرحلتين، ومسار المناقلات باقٍ كما هو
    const [{ config }] = await db.query('SELECT config FROM plan_settings WHERE organization_id = $1', [company]);
    const stages = (kind: string) => config.routes.filter((r: { planKind: string }) => r.planKind === kind).map((r: { stages: { name: string }[] }) => r.stages.map((x) => x.name));
    for (const kind of ['strategic', 'operational', 'budget']) expect(stages(kind)).toEqual([['الاعتماد الأولي من الإدارة التنفيذية', 'الاعتماد النهائي من مجلس المديرين']]);
    expect(stages('transfer')).toEqual([['مراجعة الإدارة المالية']]);

    // مخاطر الأوقاف والاستثمار مغلقة ومعها سبب الإغلاق، والمخاطر الجديدة معتمدة
    const closed = await db.query(`SELECT r.id FROM risk_register r WHERE r.organization_id = $1 AND r.title = ANY($2) AND r.risk_state = 'closed'`, [company, PACK_LEGACY.retiredRisks]);
    expect(closed).toHaveLength(4);
    expect(await n('risk_reviews', `risk_id = ANY('{${closed.map((c: { id: string }) => c.id).join(',')}}') AND note = '${PACK_LEGACY.retireNote}'`)).toBe(4);
    expect(await n('risk_register', `title = 'تأخر توقيع عقود جمعية عناية أو تقليص نطاقها' AND status = 'approved'`)).toBe(1);
    expect(await n('risk_register')).toBe(27);
    // لا روابط من الخطة الجديدة لمخاطر مغلقة
    expect(await n('plan_refs', `system = 'risk' AND ref_id = ANY('{${closed.map((c: { id: string }) => c.id).join(',')}}')`)).toBe(0);
  }, 180000);

  it('prints the board report only after the executive initial approval, then the board approval makes version 2', async () => {
    const plans = app.get(PlansService), budgets = app.get(BudgetsService), board = app.get(BoardReportsService);
    const { strategic: sp } = await planIds();
    const b = await budgetId();
    await expect(board.build(actor, 'plan-approval', { planId: sp })).rejects.toThrow(/الاعتماد الأولي|اعتمادها الأولي/);
    await expect(board.build(actor, 'budget-approval', { budgetId: b })).rejects.toThrow(/اعتمادها الأولي/);
    expect((await board.catalog(actor)).plans.every((p: { printable: boolean }) => !p.printable)).toBe(true);

    // الرفع يستخدم سبب التعديل المسجل، والمرحلة الأولى هي الاعتماد الأولي من الإدارة التنفيذية
    const sub = await plans.submit(actor, sp, null) as { status: string; stageName: string | null };
    expect(sub).toMatchObject({ status: 'in_review', stageName: 'الاعتماد الأولي من الإدارة التنفيذية' });
    await expect(board.build(actor, 'plan-approval', { planId: sp })).rejects.toThrow(/اعتمادها الأولي/);
    const initial = await plans.decide(actor, sp, { decision: 'approve' } as never) as { status: string; stageName: string | null };
    expect(initial).toMatchObject({ status: 'in_review', stageName: 'الاعتماد النهائي من مجلس المديرين' });
    const doc = await board.build(actor, 'plan-approval', { planId: sp });
    expect(JSON.stringify(doc)).toContain('معتمدة مبدئيًا من الإدارة التنفيذية');
    expect((await board.catalog(actor)).plans.find((p: { id: string }) => p.id === sp)!.printable).toBe(true);
    // قرار المجلس يُسجَّل بمرجعه
    await expect(plans.decide(actor, sp, { decision: 'approve' } as never)).rejects.toThrow(/قرار مجلس المديرين/);
    expect((await plans.decide(actor, sp, { decision: 'approve', note: 'قرار مجلس المديرين رقم 1/2027' } as never)).status).toBe('approved');
    const versions = await db.query('SELECT version, note FROM plan_versions WHERE organization_id = $1 AND plan_id = $2 ORDER BY version', [company, sp]);
    expect(versions.map((v: { version: number; note: string }) => [v.version, v.note])).toEqual([[1, 'الإصدار الأول المعتمد'], [2, PACK_LEGACY.revisionNote]]);

    await budgets.submit(actor, b, null);
    await budgets.decide(actor, b, { decision: 'approve' } as never);
    expect((await board.build(actor, 'budget-approval', { budgetId: b })).formCode).toBe('QF-PLN-03');
  }, 180000);

  it('a retry after a later step failed does not touch what users approved or configured since', async () => {
    // اعتماد الخطة التشغيلية بسبب كتبه المستخدم (فيُستبدل سبب التعديل)، وتعديل مسار الاعتماد، ثم إعادة تشغيل كأن خطوة لاحقة تعثرت
    const plans = app.get(PlansService);
    const { operational: op, strategic: sp } = await planIds();
    await plans.submit(actor, op, 'رفع الخطة التشغيلية للاعتماد الأولي');
    await plans.decide(actor, op, { decision: 'approve' } as never);
    await plans.decide(actor, op, { decision: 'return', note: 'إعادة للمراجعة' } as never);
    await db.query(`UPDATE plan_settings SET config = jsonb_set(config, '{routes,0,name}', '"مسار عدّله المستخدم"') WHERE organization_id = $1`, [company]);
    const before = await db.query(`SELECT id, status, version, revision_note, updated_at FROM plan_plans WHERE organization_id = $1 ORDER BY kind`, [company]);
    const items = await n('plan_items');
    const [b0] = await db.query(`SELECT status, version, updated_at FROM plan_budgets WHERE organization_id = $1`, [company]);
    await db.query(`DELETE FROM organization_starters WHERE organization_id = $1 AND module_code = 'rw-plan-2027-2029'`, [company]);

    const results = await pack.run();
    expect(results!.filter((r) => ['routes', 'strategic', 'operational', 'budget'].includes(r.key)).map((r) => r.note)).toEqual(Array(4).fill('اكتملت في تشغيل سابق'));
    expect(await db.query(`SELECT id, status, version, revision_note, updated_at FROM plan_plans WHERE organization_id = $1 ORDER BY kind`, [company])).toEqual(before);
    expect(before.find((p: { id: string }) => p.id === op).status).toBe('returned');
    expect(before.find((p: { id: string }) => p.id === sp)).toMatchObject({ status: 'approved', version: 2 });
    expect(await n('plan_items')).toBe(items);
    expect((await db.query(`SELECT status, version, updated_at FROM plan_budgets WHERE organization_id = $1`, [company]))[0]).toEqual(b0);
    const [{ config }] = await db.query('SELECT config FROM plan_settings WHERE organization_id = $1', [company]);
    expect(config.routes[0].name).toBe('مسار عدّله المستخدم');
  }, 180000);

  it('never runs twice', async () => {
    expect(await pack.run()).toBeNull();
    expect(await n('plan_plans')).toBe(2);
    expect(await n('plan_budgets')).toBe(1);
  });
});
