import { Test } from '@nestjs/testing';
import { NestExpressApplication } from '@nestjs/platform-express';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/main';
import {
  achievement, diffSnapshots, execStatus, itemCode, periodEnd, periodsOf, pickRoute, plannedProgress, rollup, spreadTargets, yearActual, yearTarget,
} from '../src/modules/planning/planning-calc';
import { defaultConfig } from '../src/modules/planning/planning-defaults';

/**
 * التخطيط الاستراتيجي والتشغيلي: الحسابات (الفترات، التحقق، الإنجاز المخطط، التجميع عبر الهيكل والعلاقات، المسارات، المقارنة)،
 * ثم دورة كاملة: خطة من قالب، اعتماد بمراحل، تعديل بإصدار جديد دون المساس بالمعتمد، خطة تشغيلية مرتبطة بنسب مساهمة،
 * تحديث الإنجاز والقراءات، الترحيل، إلغاء التعديل، الصلاحيات، والتقارير واللوحة.
 */
const DB = process.env.TEST_DATABASE_URL ?? 'postgres://erp:erp@localhost:5432/charity_erp_test';
const Y = new Date().getUTCFullYear();

describe('Planning calculations', () => {
  it('periods and achievement', () => {
    expect(periodsOf(2026, 'quarterly')).toEqual(['2026-Q1', '2026-Q2', '2026-Q3', '2026-Q4']);
    expect(periodsOf(2026, 'semiannual')).toEqual(['2026-H1', '2026-H2']);
    expect(periodEnd('2026-Q1')).toBe('2026-03-31');
    expect(periodEnd('2028-02')).toBe('2028-02-29');
    expect(achievement('up', 80, 100)).toBe(80);
    expect(achievement('down', 20, 15)).toBe(75);
    const k = { direction: 'up' as const, aggregation: 'sum' as const, targets: { '2026-Q1': 100, '2026-Q2': 100 } };
    expect(yearTarget(k, 2026)).toBe(200);
    expect(yearActual(k, [{ period: '2026-Q1', value: 90 }, { period: '2026-Q2', value: 70 }], 2026)).toBe(160);
    expect(spreadTargets([2026, 2027, 2028], 90, 60)).toEqual({ 2026: 70, 2027: 80, 2028: 90 });
  });

  it('planned progress, status and rollup through children and links', () => {
    expect(plannedProgress('2026-01-01', '2026-12-31', '2025-12-01')).toBe(0);
    expect(plannedProgress('2026-01-01', '2026-12-31', '2027-01-01')).toBe(100);
    expect(plannedProgress('2026-01-01', '2026-01-10', '2026-01-05')).toBe(50);
    expect(execStatus('in_progress', 20, 50, '2026-12-31', '2026-06-01', 10)).toBe('delayed');
    expect(execStatus('in_progress', 44, 50, '2026-12-31', '2026-06-01', 10)).toBe('at_risk');
    expect(execStatus('in_progress', 50, 50, '2026-12-31', '2026-06-01', 10)).toBe('on_track');
    const base = { state: 'in_progress' as const, startDate: null, endDate: null, costByYear: {} };
    const items = [
      { ...base, id: 'g', parentId: null, weight: 1, progress: 0, plannedCost: 0 },
      { ...base, id: 'i1', parentId: 'g', weight: 3, progress: 0, plannedCost: 100, costByYear: { 2026: 100 } },
      { ...base, id: 'i2', parentId: 'g', weight: 1, progress: 80, plannedCost: 50, costByYear: { 2026: 50 } },
      { ...base, id: 'a1', parentId: null, weight: 1, progress: 40, plannedCost: 0 },
      { ...base, id: 'a2', parentId: null, weight: 1, progress: 100, state: 'completed' as const, plannedCost: 0 },
    ];
    const r = rollup(items, [{ fromItemId: 'a1', toItemId: 'i1', contribution: 75 }, { fromItemId: 'a2', toItemId: 'i1', contribution: 25 }], '2026-06-01', 10);
    expect(r.get('i1')!.progress).toBe(55);
    expect(r.get('i1')!.source).toBe('links');
    expect(r.get('g')!.progress).toBe(61.3);
    expect(r.get('g')!.cost).toBe(150);
  });

  it('codes, routes and diffs', () => {
    expect(itemCode('G', 'P2', ['G2.1', 'G2.3'])).toBe('G2.4');
    expect(itemCode('P', null, [])).toBe('P1');
    const routes = defaultConfig().routes;
    expect(pickRoute(routes, 'operational', null, 50_000)?.key).toBe('operational');
    expect(pickRoute(routes, 'operational', null, 2_000_000)?.key).toBe('operational-large');
    expect(pickRoute(routes, 'strategic', null, 0)?.stages.length).toBe(3);
    const snap = (items: { id: string; title: string; plannedCost: number }[]) => ({
      title: 'خطة', description: null, startYear: 2026, endYear: 2028, periodicity: 'annual' as const, vision: null, mission: null, values: [], unitId: null, unitName: null,
      sharedUnits: [], parentPlanId: null, levels: [], ownerName: null, kpis: [], links: [],
      items: items.map((i) => ({ ...i, parentId: null, level: 0, code: i.id, description: null, ownerUserId: null, ownerName: null, unitId: null, unitName: null, participants: [],
        startDate: null, endDate: null, weight: 1, targets: [], milestones: [], resources: [], costByYear: {}, costMethod: 'direct' as const, fundingType: null, costCenterId: null,
        costCenterName: null, customValues: {}, sortOrder: 0 })),
    });
    const d = diffSnapshots(snap([{ id: 'a', title: 'أ', plannedCost: 10 }, { id: 'b', title: 'ب', plannedCost: 0 }]), snap([{ id: 'a', title: 'أ', plannedCost: 20 }, { id: 'c', title: 'ج', plannedCost: 0 }]));
    expect(d.map((x) => `${x.code}:${x.change}`).sort()).toEqual(['a:modified', 'b:removed', 'c:added']);
  });
});

describe('Strategic and operational planning', () => {
  let app: NestExpressApplication;
  let http: ReturnType<typeof request>;
  let admin: string;
  let clerk: string;
  const as = (t: string) => ({ Authorization: `Bearer ${t}` });
  const login = async (login: string, password: string, organization?: string) =>
    (await http.post('/api/auth/login').send({ login, password, organization }).expect(200)).body.accessToken as string;
  const R = '/api/planning';
  const ids: Record<string, string> = {};
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const approveAll = async (planId: string): Promise<any> => {
    let p = (await http.get(`${R}/plans/${planId}`).set(as(admin)).expect(200)).body;
    for (let i = 0; i < 6 && p.status === 'in_review'; i++) p = (await http.post(`${R}/plans/${planId}/decision`).set(as(admin)).send({ decision: 'approve' }).expect(201)).body;
    return p;
  };

  beforeAll(async () => {
    Object.assign(process.env, {
      DATABASE_URL: DB, JWT_SECRET: 'test-secret', UPLOAD_DIR: mkdtempSync(join(tmpdir(), 'sanabel-uploads-')),
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
    await http.post('/api/platform/organizations').set(as(platform)).send({
      name: 'جمعية البر', slug: 'albir', adminFullName: 'مدير النظام', adminEmail: 'albir@test.org', adminPassword: 'Admin12345',
    }).expect(201);
    admin = await login('albir@test.org', 'Admin12345', 'albir');
    const role = await http.post('/api/roles').set(as(admin)).send({ name: 'منسق تخطيط', permissions: ['planning.dashboard.read', 'planning.operational.manage', 'planning.progress.update'] }).expect(201);
    await http.post('/api/users').set(as(admin)).send({ fullName: 'منسق الإدارة', email: 'clerk@test.org', password: 'Clerk12345', roleIds: [role.body.id] }).expect(201);
    clerk = await login('clerk@test.org', 'Clerk12345', 'albir');
    ids.unit = (await http.post('/api/hr/units').set(as(admin)).send({ name: 'إدارة البرامج', level: 0 }).expect(201)).body.id;
  });

  afterAll(async () => { await app?.close(); });

  it('creates a strategic plan from the charity template and approves it through its route', async () => {
    const cfg = (await http.get(`${R}/config`).set(as(admin)).expect(200)).body;
    expect(cfg.templates.map((t: { key: string }) => t.key)).toContain('ncnp-strategic');
    const p = (await http.post(`${R}/plans`).set(as(admin)).send({ kind: 'strategic', title: 'الخطة الاستراتيجية', startYear: Y, endYear: Y + 2, periodicity: 'annual', templateKey: 'ncnp-strategic' }).expect(201)).body;
    ids.sp = p.id;
    expect(p.code).toBe('SP-001');
    expect(p.levels.map((l: { name: string }) => l.name)).toEqual(['محور استراتيجي', 'هدف استراتيجي', 'مبادرة']);
    expect(p.items.filter((i: { level: number }) => i.level === 0)).toHaveLength(4);
    expect(p.kpis.length).toBeGreaterThan(8);
    expect(p.vision).toBeTruthy();
    expect(p.stages).toHaveLength(3);
    // كل المستهدفات موزعة على سنوات الخطة
    expect(Object.keys(p.kpis[0].targets)).toEqual([String(Y), String(Y + 1), String(Y + 2)]);
    const init = p.items.find((i: { title: string }) => i.title === 'برنامج العقود الإطارية');
    ids.init = init.id;
    await http.patch(`${R}/items/${init.id}`).set(as(admin)).send({ costByYear: { [Y]: 120000, [Y + 1]: 80000 }, fundingType: 'unrestricted', ownerName: 'مدير تنمية الموارد' }).expect(200);
    await http.patch(`${R}/items/${init.id}`).set(as(admin)).send({ costByYear: { [Y + 5]: 1 } }).expect(400);
    // التحرير بمستخدم بلا صلاحية الخطط الاستراتيجية
    await http.patch(`${R}/items/${init.id}`).set(as(clerk)).send({ title: 'عنوان آخر' }).expect(403);
    let s = (await http.post(`${R}/plans/${ids.sp}/submit`).set(as(admin)).send({}).expect(201)).body;
    expect(s.status).toBe('in_review');
    expect(s.stageName).toBe('مراجعة إدارة التخطيط والأداء');
    await http.patch(`${R}/items/${init.id}`).set(as(admin)).send({ title: 'عنوان آخر' }).expect(409);
    await http.post(`${R}/plans/${ids.sp}/decision`).set(as(clerk)).send({ decision: 'approve' }).expect(403);
    await http.post(`${R}/plans/${ids.sp}/decision`).set(as(admin)).send({ decision: 'return' }).expect(400);
    s = await approveAll(ids.sp);
    expect(s.status).toBe('approved');
    expect(s.version).toBe(1);
    expect(s.versions).toHaveLength(1);
    expect(s.summary.totalCost).toBe(200000);
  });

  it('revises the approved plan as a new version without touching version 1', async () => {
    const goal = (await http.get(`${R}/plans/${ids.sp}`).set(as(admin))).body.items.find((i: { title: string }) => i.title === 'تنويع مصادر الإيرادات وزيادتها');
    let p = (await http.post(`${R}/plans/${ids.sp}/items`).set(as(admin)).send({ parentId: goal.id, title: 'منصة التبرع الإلكتروني', costByYear: { [Y]: 50000 } }).expect(201)).body;
    expect(p.status).toBe('draft');
    expect(p.version).toBe(1);
    expect(p.items.find((i: { title: string }) => i.title === 'منصة التبرع الإلكتروني').code).toBe('I2.1.3');
    const c = (await http.get(`${R}/plans/${ids.sp}/compare?from=1`).set(as(admin)).expect(200)).body;
    expect(c.rows.some((r: { change: string; title: string }) => r.change === 'added' && r.title === 'منصة التبرع الإلكتروني')).toBe(true);
    expect(c.totals.toCost - c.totals.fromCost).toBe(50000);
    // الإصدار المعتمد لم يتغير
    const v1 = (await http.get(`${R}/plans/${ids.sp}/versions/1`).set(as(admin)).expect(200)).body;
    expect(v1.snapshot.items.some((i: { title: string }) => i.title === 'منصة التبرع الإلكتروني')).toBe(false);
    await http.post(`${R}/plans/${ids.sp}/submit`).set(as(admin)).send({}).expect(400);
    await http.post(`${R}/plans/${ids.sp}/submit`).set(as(admin)).send({ note: 'إضافة مبادرة المنصة الإلكترونية' }).expect(201);
    p = await approveAll(ids.sp);
    expect(p.version).toBe(2);
    expect(p.versions[0].note).toBe('إضافة مبادرة المنصة الإلكترونية');
    // إلغاء تعديل لاحق يعيد الخطة كما في الإصدار 2
    await http.patch(`${R}/plans/${ids.sp}`).set(as(admin)).send({ vision: 'رؤية معدلة' }).expect(200);
    p = (await http.post(`${R}/plans/${ids.sp}/discard`).set(as(admin)).expect(201)).body;
    expect(p.status).toBe('approved');
    expect(p.vision).not.toBe('رؤية معدلة');
  });

  it('builds an operational plan whose activities feed the strategic initiative by contribution', async () => {
    let op = (await http.post(`${R}/plans`).set(as(clerk)).send({ kind: 'operational', title: 'الخطة التشغيلية لإدارة البرامج', startYear: Y, endYear: Y, periodicity: 'quarterly', unitId: ids.unit, parentPlanId: ids.sp }).expect(201)).body;
    ids.op = op.id;
    expect(op.unitName).toBe('إدارة البرامج');
    await http.post(`${R}/plans`).set(as(clerk)).send({ kind: 'strategic', title: 'ممنوعة', startYear: Y, endYear: Y, periodicity: 'annual' }).expect(403);
    op = (await http.post(`${R}/plans/${ids.op}/items`).set(as(clerk)).send({ title: 'برنامج الاستقطاع' }).expect(201)).body;
    const prog = op.items[0];
    expect(prog.code).toBe('B1');
    op = (await http.post(`${R}/plans/${ids.op}/items`).set(as(clerk)).send({
      parentId: prog.id, title: 'حملة تسويق الاستقطاع', startDate: `${Y}-01-01`, endDate: `${Y}-12-31`, costByYear: { [Y]: 30000 },
      milestones: [{ title: 'إطلاق الحملة', dueDate: `${Y}-03-01`, done: false }],
    }).expect(201)).body;
    ids.act1 = op.items.find((i: { title: string }) => i.title === 'حملة تسويق الاستقطاع').id;
    op = (await http.post(`${R}/plans/${ids.op}/items`).set(as(clerk)).send({ parentId: prog.id, title: 'ربط بوابة الدفع', startDate: `${Y}-01-01`, endDate: `${Y}-06-30` }).expect(201)).body;
    ids.act2 = op.items.find((i: { title: string }) => i.title === 'ربط بوابة الدفع').id;
    await http.post(`${R}/plans/${ids.op}/items`).set(as(clerk)).send({ parentId: ids.act1, title: 'مهمة', startDate: `${Y - 1}-01-01` }).expect(400);
    await http.post(`${R}/links`).set(as(clerk)).send({ fromItemId: ids.act1, toItemId: ids.init, relation: 'contributes', contribution: 70 }).expect(201);
    await http.post(`${R}/links`).set(as(clerk)).send({ fromItemId: ids.act2, toItemId: ids.init, relation: 'contributes', contribution: 40 }).expect(400);
    await http.post(`${R}/links`).set(as(clerk)).send({ fromItemId: ids.act2, toItemId: ids.init, relation: 'contributes', contribution: 30 }).expect(201);
    await http.post(`${R}/links`).set(as(clerk)).send({ fromItemId: ids.act2, toItemId: prog.id, relation: 'contributes' }).expect(400);
    // الإنجاز قبل الاعتماد غير متاح
    await http.post(`${R}/items/${ids.act1}/progress`).set(as(clerk)).send({ progress: 10 }).expect(409);
    await http.post(`${R}/plans/${ids.op}/submit`).set(as(clerk)).send({}).expect(201);
    op = await approveAll(ids.op);
    expect(op.routeName).toBe('اعتماد الخطة التشغيلية');
    expect(op.version).toBe(1);
    op = (await http.post(`${R}/items/${ids.act1}/progress`).set(as(clerk)).send({ progress: 50, note: 'نُفذ نصف الحملة', milestonesDone: [true] }).expect(201)).body;
    await http.post(`${R}/items/${ids.act2}/progress`).set(as(clerk)).send({ progress: 100 }).expect(201);
    await http.post(`${R}/items/${prog.id}/progress`).set(as(clerk)).send({ progress: 10 }).expect(400);
    await http.post(`${R}/items/${ids.init}/progress`).set(as(admin)).send({ progress: 10 }).expect(400);
    const sp = (await http.get(`${R}/plans/${ids.sp}`).set(as(admin)).expect(200)).body;
    const init = sp.items.find((i: { id: string }) => i.id === ids.init);
    expect(init.progressSource).toBe('links');
    expect(init.rolledProgress).toBe(65);
    expect(sp.children.map((c: { id: string }) => c.id)).toContain(ids.op);
    expect(sp.links.filter((l: { toItemId: string }) => l.toItemId === ids.init)).toHaveLength(2);
    // لا يُحذف عنصر له سجل إنجاز
    await http.delete(`${R}/items/${ids.act1}`).set(as(clerk)).expect(409);
  });

  it('records KPI readings and computes achievement', async () => {
    const sp = (await http.get(`${R}/plans/${ids.sp}`).set(as(admin))).body;
    const k = sp.kpis.find((x: { name: string }) => x.name === 'نسبة المصروفات العمومية والإدارية');
    await http.put(`${R}/kpis/${k.id}/readings`).set(as(clerk)).send({ period: `${Y}-Q1`, value: 18 }).expect(400);
    const p = (await http.put(`${R}/kpis/${k.id}/readings`).set(as(clerk)).send({ period: String(Y), value: 20 }).expect(200)).body;
    const st = p.kpis.find((x: { id: string }) => x.id === k.id).stat;
    expect(st.actual).toBe(20);
    expect(st.ach).toBe(Math.round((st.target / 20) * 1000) / 10);
    const list = (await http.get(`${R}/kpis`).set(as(admin)).expect(200)).body;
    expect(list.length).toBe(sp.kpis.length);
  });

  it('carries an unfinished activity to the next operational plan', async () => {
    const next = (await http.post(`${R}/plans`).set(as(clerk)).send({ kind: 'operational', title: 'الخطة التشغيلية للعام القادم', startYear: Y + 1, endYear: Y + 1, periodicity: 'quarterly', unitId: ids.unit }).expect(201)).body;
    const withProg = (await http.post(`${R}/plans/${next.id}/items`).set(as(clerk)).send({ title: 'برنامج الاستقطاع' }).expect(201)).body;
    const parent = withProg.items[0];
    await http.post(`${R}/items/${ids.act2}/carry`).set(as(clerk)).send({ targetPlanId: next.id, targetParentId: parent.id, note: 'منجز' }).expect(409);
    await http.post(`${R}/items/${ids.act1}/carry`).set(as(clerk)).send({ targetPlanId: next.id, note: 'تأجيل' }).expect(400);
    const moved = (await http.post(`${R}/items/${ids.act1}/carry`).set(as(clerk)).send({ targetPlanId: next.id, targetParentId: parent.id, note: 'استكمال الحملة في العام القادم' }).expect(201)).body;
    const n = moved.items.find((i: { carriedFromId: string }) => i.carriedFromId === ids.act1);
    expect(n.progress).toBe(50);
    expect(n.startDate).toBe(`${Y + 1}-01-01`);
    // العلاقة انتقلت مع النشاط
    expect(moved.links.some((l: { fromItemId: string; toItemId: string }) => l.fromItemId === n.id && l.toItemId === ids.init)).toBe(true);
    const op = (await http.get(`${R}/plans/${ids.op}`).set(as(clerk))).body;
    expect(op.items.find((i: { id: string }) => i.id === ids.act1).state).toBe('carried_over');
    await http.post(`${R}/items/${ids.act1}/progress`).set(as(clerk)).send({ progress: 60 }).expect(409);
  });

  it('copies a plan, configures routes and custom fields, and serves dashboard, execution and reports', async () => {
    const copy = (await http.post(`${R}/plans/${ids.sp}/copy`).set(as(admin)).send({ title: 'نسخة للتحديث', startYear: Y + 1, endYear: Y + 3 }).expect(201)).body;
    expect(copy.status).toBe('draft');
    expect(copy.items.every((i: { progress: number }) => i.progress === 0)).toBe(true);
    expect(Object.keys(copy.kpis[0].targets)).toEqual([String(Y + 1), String(Y + 2), String(Y + 3)]);
    await http.delete(`${R}/plans/${copy.id}`).set(as(admin)).expect(200);
    await http.delete(`${R}/plans/${ids.sp}`).set(as(admin)).expect(409);

    const cfg = (await http.get(`${R}/config`).set(as(admin))).body.config;
    cfg.customFields = [{ key: 'region', label: 'المنطقة', type: 'select', options: ['الرياض', 'جدة'], appliesTo: 'operational' }];
    cfg.routes.push({ key: 'programs', name: 'مسار إدارة البرامج', planKind: 'operational', unitId: ids.unit, minCost: null, stages: [{ name: 'اعتماد مدير البرامج', roleId: null }] });
    await http.put(`${R}/config`).set(as(clerk)).send({ config: cfg }).expect(403);
    await http.put(`${R}/config`).set(as(admin)).send({ config: { ...cfg, thresholds: { green: 50, amber: 80 } } }).expect(400);
    await http.put(`${R}/config`).set(as(admin)).send({ config: cfg }).expect(200);
    const op = (await http.post(`${R}/plans`).set(as(clerk)).send({ kind: 'operational', title: 'خطة بمسار خاص', startYear: Y, endYear: Y, periodicity: 'annual', unitId: ids.unit }).expect(201)).body;
    expect(op.stages).toEqual(['اعتماد مدير البرامج']);
    await http.post(`${R}/plans/${op.id}/items`).set(as(clerk)).send({ title: 'نشاط', customValues: { region: 'مكة' } }).expect(400);
    const withField = (await http.post(`${R}/plans/${op.id}/items`).set(as(clerk)).send({ title: 'نشاط', customValues: { region: 'جدة', other: 'x' } }).expect(201)).body;
    expect(withField.items[0].customValues).toEqual({ region: 'جدة' });

    const dash = (await http.get(`${R}/dashboard`).set(as(admin)).expect(200)).body;
    expect(dash.strategic.id).toBe(ids.sp);
    expect(dash.strategic.pillars).toHaveLength(4);
    expect(dash.counts.strategic).toBe(1);
    const ex = (await http.get(`${R}/execution`).set(as(admin)).expect(200)).body;
    expect(ex.rows.some((r: { id: string }) => r.id === ids.act2)).toBe(true);
    for (const code of ['planning.structure', 'planning.cost-by-year', 'planning.traceability']) {
      const out = (await http.get(`/api/reports/run/${code}?planId=${ids.sp}`).set(as(admin)).expect(200)).body;
      expect(out.rows.length).toBeGreaterThan(5);
    }
    const tr = (await http.get(`/api/reports/run/planning.traceability?planId=${ids.sp}`).set(as(admin))).body;
    expect(tr.rows.some((r: { title: string }) => String(r.title).includes('حملة تسويق الاستقطاع'))).toBe(true);
    const cmp = (await http.get(`/api/reports/run/planning.compare?planId=${ids.sp}&from=1&to=2`).set(as(admin)).expect(200)).body;
    expect(cmp.rows.some((r: { title: string }) => r.title === 'منصة التبرع الإلكتروني')).toBe(true);
    for (const code of ['planning.kpis', 'planning.execution', 'planning.delayed', 'planning.unowned', 'planning.plans']) {
      await http.get(`/api/reports/run/${code}?year=${Y}`).set(as(admin)).expect(200);
    }
    await http.get(`/api/reports/run/planning.plans`).set(as(clerk)).expect(403);
  });
  it('links plans to the risk register, approved analyses, audit actions and staff goals read-only, with alerts and coverage', async () => {
    const RK = '/api/risk';
    const ago = (n: number) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);
    const riskBody = (l: number) => ({
      title: 'انخفاض التبرعات', source: 'external', category: 'financial', ownerName: 'مدير تنمية الموارد', unitId: ids.unit,
      inherentLikelihood: 5, inherentImpact: 4, residualLikelihood: l, residualImpact: 4, treatment: 'reduce', actions: [], kris: [],
    });
    const risk = (await http.post(`${RK}/risks`).set(as(admin)).send(riskBody(3)).expect(201)).body;
    expect(risk.residualScore).toBe(12);
    const an = (await http.post(`${RK}/analyses`).set(as(admin)).send({
      kind: 'swot', title: 'SWOT', analysisDate: ago(0), items: [{ factor: 'opportunity', text: 'منح تنموية', impact: 4, likelihood: 3 }, { factor: 'threat', text: 'جمعيات جديدة', impact: 3, likelihood: 3 }],
    }).expect(201)).body;
    // التحليل غير المعتمد لا يظهر للتخطيط
    expect((await http.get(`${R}/ref-options?system=risk_analysis`).set(as(clerk)).expect(200)).body).toEqual([]);
    await http.post(`${RK}/analyses/${an.id}/submit`).set(as(admin)).expect(201);
    for (let i = 0; i < 4; i++) await http.post(`${RK}/analyses/${an.id}/decision`).set(as(admin)).send({ decision: 'approve' }).then(() => null);
    const facs = (await http.get(`${R}/ref-options?system=risk_analysis`).set(as(clerk)).expect(200)).body;
    expect(facs.map((f: { meta: { factor: string } }) => f.meta.factor)).toEqual(['opportunity', 'threat']);
    expect(facs[0].version).toMatch(/^Rev\./);
    await http.get(`${R}/ref-options?system=nope`).set(as(clerk)).expect(400);
    // أهداف الموظفين لمن يملك صلاحية الأداء الوظيفي فقط
    expect((await http.get(`${R}/ref-options?system=hr_performance`).set(as(clerk)).expect(200)).body).toEqual([]);
    await http.post(`${R}/items/${ids.init}/refs`).set(as(admin)).send({ system: 'hr_performance', refId: '00000000-0000-4000-8000-000000000000:0' }).expect(400);

    await http.post(`${R}/items/${ids.init}/refs`).set(as(admin)).send({ system: 'risk', refId: risk.id, note: 'المبادرة تخفف الخطر' }).expect(201);
    await http.post(`${R}/items/${ids.init}/refs`).set(as(admin)).send({ system: 'risk', refId: risk.id }).expect(409);
    await http.post(`${R}/items/${ids.init}/refs`).set(as(admin)).send({ system: 'risk_analysis', refId: facs[0].id }).expect(201);
    let sp = (await http.get(`${R}/plans/${ids.sp}`).set(as(clerk)).expect(200)).body;
    const refs = sp.items.find((i: { id: string }) => i.id === ids.init).refs;
    expect(refs.find((r: { system: string }) => r.system === 'risk')).toMatchObject({ refCode: risk.code, refMeta: { score: 12 }, live: { found: true, alert: null } });
    expect(refs.find((r: { system: string }) => r.system === 'risk_analysis').refVersion).toBe(facs[0].version);

    let o = (await http.get(`${R}/plans/${ids.sp}/integrations`).set(as(clerk)).expect(200)).body;
    expect(o.coverage.materialTotal).toBe(1);
    expect(o.coverage.materialCovered).toBe(1);
    expect(o.coverage.byFactor.find((f: { factor: string }) => f.factor === 'opportunity')).toMatchObject({ total: 1, linked: 1 });
    expect(o.alerts).toEqual([]);

    // ارتفاع درجة الخطر في سجل المخاطر يظهر تنبيهًا في الخطة، دون تعديلها
    await http.patch(`${RK}/risks/${risk.id}`).set(as(admin)).send(riskBody(5)).expect(200);
    o = (await http.get(`${R}/plans/${ids.sp}/integrations`).set(as(clerk)).expect(200)).body;
    expect(o.alerts).toEqual([expect.objectContaining({ level: 'danger', message: expect.stringContaining('من 12') })]);
    sp = (await http.get(`${R}/plans/${ids.sp}`).set(as(clerk)).expect(200)).body;
    expect(sp.status).toBe('approved');

    // نشاط معالجة تحت برنامج الخطة التشغيلية: يُنشأ مربوطًا بالخطر وتكلفته تدخل الخطة، والخطر لا يتغير
    let op = (await http.get(`${R}/plans/${ids.op}`).set(as(clerk)).expect(200)).body;
    const prog = op.items.find((i: { title: string }) => i.title === 'برنامج الاستقطاع');
    await http.post(`${R}/items/${prog.id}/treatment`).set(as(clerk)).send({ system: 'audit', refId: risk.id }).expect(400);
    op = (await http.post(`${R}/items/${prog.id}/treatment`).set(as(clerk)).send({ system: 'risk', refId: risk.id, costByYear: { [Y]: 20000 }, endDate: `${Y}-12-31` }).expect(201)).body;
    const tr = op.items.find((i: { title: string }) => i.title.startsWith(`معالجة الخطر ${risk.code}`));
    expect(tr).toMatchObject({ parentId: prog.id, plannedCost: 20000, ownerName: 'مدير تنمية الموارد' });
    expect(tr.refs[0]).toMatchObject({ system: 'risk', refId: risk.id, note: 'نشاط معالجة' });
    expect(op.status).toBe('draft');
    expect((await http.get(`${RK}/risks/${risk.id}`).set(as(admin)).expect(200)).body.residualScore).toBe(20);
    o = (await http.get(`${R}/plans/${ids.op}/integrations`).set(as(clerk)).expect(200)).body;
    expect(o.coverage.treatmentCost).toBe(20000);

    for (const code of ['planning.risks', 'planning.analysis', 'planning.audit-actions']) {
      await http.get(`/api/reports/run/${code}?planId=${ids.sp}`).set(as(admin)).expect(200);
    }
    const rr = (await http.get(`/api/reports/run/planning.risks?planId=${ids.sp}`).set(as(admin)).expect(200)).body;
    expect(rr.rows[0]).toMatchObject({ code: risk.code, covered: 'مغطى' });
  });
});
