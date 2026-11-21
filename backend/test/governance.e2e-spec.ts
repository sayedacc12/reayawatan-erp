import { Test } from '@nestjs/testing';
import { NestExpressApplication } from '@nestjs/platform-express';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/main';
import {
  catalogStats, computePerformance, EMPTY_FIGURES, findItem, grade, itemPercent, opinionFactor, STANDARDS, validateCatalog,
} from '../src/modules/governance/catalog';
import { suggestChoices } from '../src/modules/governance/gov-signals.service';

/**
 * الحوكمة: سلامة الدليل (الأوزان والدرجات)، معادلات الأداء المالي على أمثلة الدليل، منطق البطاقات (البوابات والانتقال)،
 * ثم التكامل: استخراج الأرقام من الدليل المحاسبي، الربط في الإعدادات، تقويم الالتزامات، التقييم والإجابات والإشارات،
 * الإنذار المبكر، فرص التحسين وخطة التحسين، والاعتماد.
 */
const DB = process.env.TEST_DATABASE_URL ?? 'postgres://erp:erp@localhost:5432/charity_erp_test';

/** أرقام الشركة (أ) في الدليل (الجزء الثالث، ص 18–19) */
const A_FIG = {
  ...EMPTY_FIGURES(), adminExpenses: 1150000, programExpenses: 8810000, adminAllocated: 510000, sustExpenses: 890000, sustExpensesRestricted: 80000,
  fundraisingExpenses: 350000, sustReturns: 1970000, sustReturnsRestricted: 320000, sustAssets: 25200000, donations: 10890000, cash: 5000000,
  currentInvestments: 1800000, currentLiabilities: 200000, restrictedNetAssets: 5180000, totalExpenses: 11200000,
};
/** أرقام الشركة (ب) */
const B_FIG = {
  ...EMPTY_FIGURES(), adminExpenses: 760000, programExpenses: 2070000, adminAllocated: 500000, sustExpenses: 120000, fundraisingExpenses: 290000,
  sustReturns: 240000, sustAssets: 6220000, donations: 5110000, cash: 1820000, currentInvestments: 600000, currentLiabilities: 350000,
  restrictedNetAssets: 4180000, totalExpenses: 3740000,
};

describe('Governance catalog and formulas', () => {
  it('catalog is consistent with the guides: weights, points and unique codes', () => {
    expect(validateCatalog()).toEqual([]);
    const stats = Object.fromEntries(catalogStats().map((s) => [s.code, s]));
    expect(stats.CMP).toMatchObject({ indicators: 10, practices: 35 });
    expect(stats.TRN).toMatchObject({ indicators: 6, practices: 15 });
    expect(stats.FRG).toMatchObject({ indicators: 5, practices: 13 });
    for (const s of STANDARDS) expect(s.indicators.reduce((t, i) => t + i.weight, 0)).toBeCloseTo(100, 6);
  });

  it('financial performance reproduces the guide examples', () => {
    const a = computePerformance(A_FIG);
    // الدليل: 93.5% (بتقريب النسب الوسيطة)
    expect(Math.abs(a.score - 93.5)).toBeLessThan(0.2);
    const ind = Object.fromEntries(a.indicators.map((i) => [i.code, i]));
    expect(ind['FIN-1'].score).toBeCloseTo(94.6, 0);
    expect(ind['FIN-2'].score).toBe(100);
    const sub = Object.fromEntries(a.indicators.flatMap((i) => i.subs).map((s) => [s.code, s]));
    expect(sub['FIN-1A'].ratio).toBeCloseTo(10.27, 1);
    expect(sub['FIN-1B'].ratio).toBeCloseTo(73.04, 1);
    expect(sub['FIN-5A'].ratio).toBeCloseTo(92.94, 1);
    expect(sub['FIN-5B'].score).toBe(100);
    const b = computePerformance(B_FIG);
    // الدليل يعطي (ب) 45.6% لأنه منح مؤشر النقد 40% عند نسبة 40%، والقاعدة الصريحة «أقل من 50% = صفر»
    const bsub = Object.fromEntries(b.indicators.flatMap((i) => i.subs).map((s) => [s.code, s]));
    expect(bsub['FIN-5A'].ratio).toBeCloseTo(40.2, 0);
    expect(bsub['FIN-5A'].score).toBe(0);
    expect(bsub['FIN-5B'].score).toBe(0);
    expect(bsub['FIN-1A'].score).toBeCloseTo(46.8, 0);
    expect(bsub['FIN-4A'].ratio).toBeCloseTo(7.75, 1);
    expect(b.score + 0.7 * 40 * 0.15).toBeCloseTo(45.5, 0);
    expect(grade(b.score).label).toBe('ضعيف');
    expect(grade(a.score).label).toBe('ممتاز');
  });

  it('auditor opinion factor', () => {
    expect(opinionFactor('unqualified')).toBe(1);
    expect(opinionFactor('qualified', 3)).toBe(0.7);
    expect(opinionFactor('qualified', 4)).toBe(0.6);
    expect(opinionFactor('qualified', 12)).toBe(0);
    expect(opinionFactor('adverse')).toBe(0);
    expect(opinionFactor('not_issued')).toBe(0);
    expect(computePerformance(A_FIG, 0.6).final).toBeCloseTo(computePerformance(A_FIG).score * 0.6, 1);
  });

  it('card logic: gates, "go to next question" and shared points', () => {
    const p04 = findItem('CMP-P04-1')!.item;
    expect(itemPercent(p04, [0])).toBe(100); // لم تُعدّل اللائحة
    expect(itemPercent(p04, [1])).toBeNull(); // انتقل للسؤال التالي ولم يُجب
    expect(itemPercent(p04, [1, 0])).toBe(0);
    expect(itemPercent(p04, [1, 1])).toBe(100);
    const p33 = findItem('CMP-P33-1')!.item; // بوابة ثم سؤالان يشتركان في الدرجة
    expect(itemPercent(p33, [0])).toBe(0);
    expect(itemPercent(p33, [1, 2, 1])).toBe(75);
    const p21 = findItem('CMP-P21-1')!.item;
    expect(itemPercent(p21, [1, 1])).toBe(50);
    // الإشارات: «لا ينطبق» يختار مسار 100%، و«غير متحقق» لا يتوقف عند بوابة «لا ينطبق»
    const branches = findItem('CMP-P19-1')!.item;
    expect(itemPercent(branches, suggestChoices(branches, 'na')!)).toBe(100);
    expect(itemPercent(branches, suggestChoices(branches, 'missing')!)).toBe(0);
    expect(itemPercent(branches, suggestChoices(branches, 'met')!)).toBe(100);
    expect(itemPercent(p21, suggestChoices(p21, 'partial')!)).toBe(50);
    expect(itemPercent(p21, suggestChoices(p21, 'missing')!)).toBe(0);
  });
});

describe('Governance module', () => {
  let app: NestExpressApplication;
  let http: ReturnType<typeof request>;
  let admin: string;
  let viewer: string;
  let uploadDir: string;
  const as = (t: string) => ({ Authorization: `Bearer ${t}` });
  const login = async (login: string, password: string, organization?: string) =>
    (await http.post('/api/auth/login').send({ login, password, organization }).expect(200)).body.accessToken as string;
  const G = '/api/governance';
  const AC = '/api/accounting';
  const ids: Record<string, string> = {};

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
    await http.post('/api/platform/organizations').set(as(platform)).send({
      name: 'جمعية الحوكمة', slug: 'gov', adminFullName: 'مدير النظام', adminEmail: 'gov@test.org', adminPassword: 'Admin12345',
    }).expect(201);
    admin = await login('gov@test.org', 'Admin12345', 'gov');
    const role = await http.post('/api/roles').set(as(admin)).send({ name: 'مطلع', permissions: ['governance.dashboard.read', 'governance.reports.read'] }).expect(201);
    await http.post('/api/users').set(as(admin)).send({ fullName: 'عضو المجلس', email: 'viewer@test.org', password: 'Viewer12345', roleIds: [role.body.id] }).expect(201);
    viewer = await login('viewer@test.org', 'Viewer12345', 'gov');
  });

  afterAll(async () => {
    await app.get(DataSource).destroy();
    await app.close();
    rmSync(uploadDir, { recursive: true, force: true });
  });

  it('works before the accounting system is set up', async () => {
    const f = await http.get(`${G}/finance`).set(as(viewer)).expect(200);
    expect(f.body.snapshot).toBeNull();
    const al = await http.get(`${G}/alerts`).set(as(viewer)).expect(200);
    expect(al.body.items.map((x: { key: string }) => x.key)).toEqual(expect.arrayContaining(['fin:setup', 'assess:due', 'fact:missing']));
    const d = await http.get(`${G}/dashboard`).set(as(viewer)).expect(200);
    expect(d.body.score).toBeNull();
    const c = await http.get(`${G}/catalog`).set(as(viewer)).expect(200);
    expect(c.body.standards).toHaveLength(3);
  });

  it('extracts financial figures from the unified chart of accounts', async () => {
    await http.post(`${AC}/chart/install`).set(as(admin)).expect(201);
    await http.post(`${AC}/setup`).set(as(admin)).send({
      fiscalYear: 2026, startDate: '2026-01-01', endDate: '2026-12-31', isFirstYear: true, firstYearStart: '2026-01-01', firstYearEnd: '2026-12-31',
    }).expect(201);
    const accounts = (await http.get(`${AC}/accounts`).set(as(admin)).expect(200)).body.accounts as { id: string; code: string; kind: string; requiresAnalytic: boolean }[];
    const cc = (await http.get(`${AC}/analytic`).set(as(admin)).expect(200)).body.accounts.find((a: { kind: string }) => a.kind === 'sub').id;
    const leaf = (prefix: string, not?: string) => accounts.find((a) => a.kind === 'sub' && a.code.startsWith(prefix) && (!not || !a.code.startsWith(not)))!;
    const line = (prefix: string, debit: number, credit: number, not?: string) => {
      const acc = leaf(prefix, not);
      return { accountId: acc.id, debit, credit, ...(acc.requiresAnalytic ? { analytic: [{ analyticId: cc, percent: 100 }] } : {}) };
    };
    const bank = '1110100201';
    await http.post(`${AC}/entries`).set(as(admin)).send({
      voucherType: 'opening', documentDate: '2026-01-01', description: 'أرصدة افتتاحية', post: true,
      lines: [
        line(bank, 5380000, 0), line('134', 23400000, 0),
        line('23102', 0, 5180000), line('21', 0, 200000), line('23103002', 0, 23400000),
      ],
    }).expect(201);
    const je = (description: string, lines: unknown[]) => http.post(`${AC}/entries`).set(as(admin)).send({ voucherType: 'journal', documentDate: '2026-03-15', description, post: true, lines }).expect(201);
    await je('مصروفات السنة حسب التصنيف الوظيفي', [
      line('41', 1000000, 0), line('46', 150000, 0), line('42', 8810000, 0, '423'), line('423', 510000, 0),
      line('43', 500000, 0), line('45', 390000, 0), line('44', 350000, 0), line(bank, 0, 11710000),
    ]);
    await je('الإيرادات والتبرعات', [
      line(bank, 12860000, 0), line('31205', 0, 1000000), line('31303', 0, 600000), line('31304', 0, 370000), line('31201', 0, 10890000),
    ]);
    await je('استثمارات متداولة', [line('113', 1800000, 0), line(bank, 0, 1800000)]);

    const f = await http.get(`${G}/finance?to=2026-12-31`).set(as(viewer)).expect(200);
    expect(f.body.ready).toMatchObject({ chart: true, years: 1 });
    expect(f.body.snapshot.figures).toMatchObject({
      adminExpenses: 1150000, programExpenses: 8810000, adminAllocated: 510000, sustExpenses: 890000, fundraisingExpenses: 350000,
      totalExpenses: 11710000, sustReturns: 1970000, donations: 10890000, cash: 4730000, currentInvestments: 1800000,
      currentLiabilities: 200000, restrictedNetAssets: 5180000, sustAssets: 25200000,
    });
    // السنة كاملة: لا تحويل، والمتوقع = الفعلي
    expect(f.body.snapshot.elapsed).toBe(100);
    expect(f.body.snapshot.forecast.score).toBe(f.body.snapshot.actual.score);
    expect(f.body.snapshot.breakdown.adminExpenses.length).toBe(2);
    expect(f.body.series.points.length).toBe(12);
  });

  it('account mapping in settings changes the figures', async () => {
    await http.put(`${G}/settings`).set(as(viewer)).send({ alertDays: 20 }).expect(403);
    await http.put(`${G}/settings`).set(as(admin)).send({ mapping: { sustReturnsRestricted: [{ code: '31A' }] } }).expect(400);
    await http.put(`${G}/settings`).set(as(admin)).send({ mapping: { nothing: [] } }).expect(400);
    const s = await http.put(`${G}/settings`).set(as(admin)).send({
      mapping: { sustReturnsRestricted: [{ code: '31304' }] },
      facts: { licenseExpiry: '2026-12-20', boardTermEnd: '2027-04-30', externalAuditor: 'مكتب المراجعة المعتمد', hasBranches: false, openViolations: 0 },
      targetScore: 90,
    }).expect(200);
    expect(s.body.overrides).toEqual({ sustReturnsRestricted: [{ code: '31304' }] });
    expect(s.body.facts).toMatchObject({ hasBranches: false, licenseExpiry: '2026-12-20' });
    const f = await http.get(`${G}/finance?to=2026-12-31`).set(as(viewer)).expect(200);
    expect(f.body.snapshot.figures.sustReturnsRestricted).toBe(370000);
  });

  it('generates the statutory calendar once and tracks it', async () => {
    const g = await http.post(`${G}/obligations/generate`).set(as(admin)).send({ fiscalYear: 2026 }).expect(201);
    expect(g.body.created).toBe(17);
    expect((await http.post(`${G}/obligations/generate`).set(as(admin)).send({ fiscalYear: 2026 }).expect(201)).body.created).toBe(0);
    const items = g.body.items as { id: string; kind: string; dueDate: string; refs: string[] }[];
    expect(items.filter((o) => o.kind === 'board_meeting')).toHaveLength(4);
    expect(items.find((o) => o.kind === 'ga_meeting')!.dueDate).toBe('2027-04-30');
    expect(items.find((o) => o.kind === 'quarterly_report')!.refs).toEqual(expect.arrayContaining(['CMP-P21-1']));
    const boards = items.filter((o) => o.kind === 'board_meeting').slice(0, 3);
    for (const b of boards) {
      await http.put(`${G}/obligations/${b.id}`).set(as(admin)).send({ kind: 'board_meeting', title: 'اجتماع المجلس', dueDate: b.dueDate, doneDate: b.dueDate, evidence: 'محضر الاجتماع' }).expect(200);
    }
    await http.put(`${G}/obligations/${boards[0].id}`).set(as(admin)).send({ kind: 'board_meeting', title: 'اجتماع المجلس', dueDate: boards[0].dueDate, doneDate: '2099-01-01' }).expect(400);
    ids.quarterly = items.find((o) => o.kind === 'quarterly_report')!.id;
  });

  it('runs a self-assessment with card logic, signals and live scoring', async () => {
    await http.post(`${G}/assessments`).set(as(viewer)).send({ title: 'x', kind: 'self', periodType: 'quarterly', periodFrom: '2026-01-01', periodTo: '2026-09-30' }).expect(403);
    await http.post(`${G}/assessments`).set(as(admin)).send({ title: 'تقييم', kind: 'self', periodType: 'quarterly', periodFrom: '2026-09-30', periodTo: '2026-01-01' }).expect(400);
    const r = await http.post(`${G}/assessments`).set(as(admin)).send({
      title: 'التقييم الذاتي للربع الثالث', kind: 'self', periodType: 'quarterly', periodFrom: '2026-01-01', periodTo: '2026-09-30',
    }).expect(201);
    ids.a = r.body.assessment.id;
    expect(r.body.assessment.code).toBe('GOV-2026-01');
    expect(r.body.assessment.figures.adminExpenses).toBe(1150000);
    expect(r.body.forecast).not.toBeNull();
    expect(r.body.evaluation.coverage).toBeLessThan(25);
    // الإشارات الآلية: الدليل المحاسبي مثبّت، ولا فروع
    const flat = r.body.evaluation.standards.flatMap((s: { indicators: { practices: { items: { code: string; signal: { status: string } | null; suggestedPercent: number | null }[] }[] }[] }) =>
      s.indicators.flatMap((i) => i.practices.flatMap((p) => p.items)));
    expect(flat.find((i: { code: string }) => i.code === 'FRG-P13-2' || i.code.startsWith('FRG-P13'))).toBeTruthy();
    expect(flat.find((i: { code: string }) => i.code === 'CMP-P19-1').suggestedPercent).toBe(100);

    const put = (code: string, choices: (number | null)[], evidence?: string) => http.put(`${G}/assessments/${ids.a}/answers/${code}`).set(as(admin)).send({ choices, evidence });
    await put('CMP-P01-1', [5]).expect(400);
    await put('XYZ', [0]).expect(400);
    await put('CMP-P99-1', [0]).expect(404);
    await http.put(`${G}/assessments/${ids.a}/answers/CMP-P01-1`).set(as(viewer)).send({ choices: [1] }).expect(403);
    const one = await put('CMP-P01-1', [1], 'اللائحة الأساسية المعتمدة').expect(200);
    expect(one.body).toMatchObject({ percent: 100, points: 3 });
    expect((await put('CMP-P04-1', [1, 0]).expect(200)).body.percent).toBe(0);
    // ما بعد الإجابة المنهية لا يُحفظ
    expect((await put('CMP-P04-1', [0, 1]).expect(200)).body.percent).toBe(100);
    expect((await put('CMP-P33-1', [1, 2, 1]).expect(200)).body.percent).toBe(75);
    const zero = await put('CMP-P23-1', [0]).expect(200);
    expect(zero.body.scores.overall).toBeGreaterThan(0);

    const applied = await http.post(`${G}/assessments/${ids.a}/apply-suggestions`).set(as(admin)).expect(201);
    expect(applied.body.applied).toBeGreaterThan(5);
    expect(applied.body.answers['CMP-P19-1']).toMatchObject({ fromSignal: true, percent: 100 });
    // اعتماد الاقتراحات لا يغيّر إجابات المقيّم
    expect(applied.body.answers['CMP-P04-1'].fromSignal).toBe(false);
    await http.post(`${G}/assessments/${ids.a}/submit`).set(as(admin)).expect(409);
    await http.delete(`${G}/assessments/${ids.a}/answers/CMP-P33-1`).set(as(admin)).expect(200);
    const d = await http.get(`${G}/assessments/${ids.a}`).set(as(viewer)).expect(200);
    expect(d.body.answers['CMP-P33-1']).toBeUndefined();
    expect(d.body.canEdit).toBe(false);
    // المتوقع يكمّل غير المُجاب من الإشارات وآخر تقييم معتمد، فلا يقل عن الحالي في الامتثال
    const std = Object.fromEntries(d.body.evaluation.standards.map((s: { code: string }) => [s.code, s]));
    expect(std.CMP.predicted).toBeGreaterThanOrEqual(std.CMP.score);
    expect(['ضعيف', 'متوسط', 'جيد', 'جيد جداً', 'ممتاز']).toContain(d.body.evaluation.predictedGrade);
  });

  it('ranks improvement opportunities and builds the improvement plan', async () => {
    const o = await http.get(`${G}/opportunities`).set(as(viewer)).expect(200);
    const items = o.body.items as { code: string; impact: number; kind: string; recommendations: string[] }[];
    expect(items.length).toBeGreaterThan(20);
    for (let i = 1; i < items.length; i++) expect(items[i - 1].impact).toBeGreaterThanOrEqual(items[i].impact);
    const p23 = items.find((x) => x.code === 'CMP-P23-1')!;
    expect(p23.impact).toBeCloseTo(0.5 * 0.4, 5);
    expect(p23.recommendations.length).toBeGreaterThan(0);
    await http.post(`${G}/actions/from-gaps`).set(as(viewer)).send({ codes: ['CMP-P23-1'] }).expect(403);
    const c = await http.post(`${G}/actions/from-gaps`).set(as(admin)).send({ codes: ['CMP-P23-1', items[0].code], ownerName: 'مسؤول الالتزام', dueDate: '2026-10-15' }).expect(201);
    expect(c.body.created).toBe(2);
    expect((await http.post(`${G}/actions/from-gaps`).set(as(admin)).send({ codes: ['CMP-P23-1'] }).expect(201)).body.created).toBe(0);
    const act = c.body.items.find((x: { itemCode: string }) => x.itemCode === 'CMP-P23-1');
    expect(act).toMatchObject({ source: 'gap', ownerName: 'مسؤول الالتزام', status: 'planned' });
    expect(act.code).toMatch(/^IMP-\d{3}$/);
    const done = await http.put(`${G}/actions/${act.id}`).set(as(admin)).send({ title: act.title, status: 'done' }).expect(200);
    expect(done.body).toMatchObject({ progress: 100, status: 'done' });
    await http.post(`${G}/actions`).set(as(admin)).send({ title: 'إجراء', itemCode: 'CMP-P99-9' }).expect(400);
    ids.manual = (await http.post(`${G}/actions`).set(as(admin)).send({ title: 'تحديث سياسة الاحتفاظ بالوثائق', priority: 'high', dueDate: '2026-01-15' }).expect(201)).body.id;
  });

  it('early warning: deadlines, finance, gaps, overdue actions, acknowledgement', async () => {
    const r = await http.get(`${G}/alerts`).set(as(viewer)).expect(200);
    const keys = r.body.items.map((x: { key: string }) => x.key) as string[];
    expect(keys).toContain(`obl:${ids.quarterly}`); // التقرير الربعي الأول متأخر
    expect(keys).toContain('fact:license'); // تنتهي خلال أقل من 90 يوماً
    expect(keys).toContain('fact:board_term'); // تنتهي خلال 210 أيام
    expect(keys).toContain(`act:${ids.manual}`);
    expect(keys.some((k) => k.startsWith('gap:'))).toBe(true);
    expect(keys.some((k) => k.startsWith('fin:FIN-'))).toBe(true);
    expect(r.body.items[0].level).toBe('critical');
    await http.post(`${G}/alerts/${encodeURIComponent(`obl:${ids.quarterly}`)}/ack`).set(as(viewer)).send({ days: 10 }).expect(403);
    await http.post(`${G}/alerts/${encodeURIComponent(`obl:${ids.quarterly}`)}/ack`).set(as(admin)).send({ days: 10, note: 'تم الرفع ورقياً' }).expect(201);
    const after = await http.get(`${G}/alerts`).set(as(viewer)).expect(200);
    expect(after.body.items.map((x: { key: string }) => x.key)).not.toContain(`obl:${ids.quarterly}`);
    const all = await http.get(`${G}/alerts?all=1`).set(as(viewer)).expect(200);
    expect(all.body.items.find((x: { key: string }) => x.key === `obl:${ids.quarterly}`)).toMatchObject({ acknowledged: true });
    await http.delete(`${G}/alerts/${encodeURIComponent(`obl:${ids.quarterly}`)}/ack`).set(as(admin)).expect(200);
  });

  it('official result with audited figures and auditor opinion, approval cycle', async () => {
    const r = await http.post(`${G}/assessments`).set(as(admin)).send({
      title: 'نتيجة التقييم الرسمي 2025', kind: 'official', periodType: 'annual', periodFrom: '2025-01-01', periodTo: '2025-12-31', opinion: 'qualified', qualifiedItems: 2,
    }).expect(201);
    const id = r.body.assessment.id;
    expect(r.body.assessment.figures).toBeNull();
    const f = await http.put(`${G}/assessments/${id}/figures`).set(as(admin)).send({ figures: A_FIG }).expect(200);
    expect(f.body.assessment.figuresSource).toBe('manual');
    expect(f.body.performance.score).toBeCloseTo(computePerformance(A_FIG).score, 2);
    expect(f.body.performance.final).toBeCloseTo(f.body.performance.score * 0.8, 1);
    await http.post(`${G}/assessments/${id}/submit`).set(as(admin)).expect(201);
    await http.put(`${G}/assessments/${id}`).set(as(admin)).send({ title: 'تعديل' }).expect(409);
    const ap = await http.post(`${G}/assessments/${id}/approve`).set(as(admin)).expect(201);
    expect(ap.body.assessment).toMatchObject({ status: 'approved', approvedByName: 'مدير النظام' });
    await http.delete(`${G}/assessments/${id}`).set(as(admin)).expect(409);
    const list = await http.get(`${G}/assessments`).set(as(viewer)).expect(200);
    expect(list.body).toHaveLength(2);
    expect(list.body.find((x: { id: string }) => x.id === id).scores.performance).toBeGreaterThan(0);
  });

  it('dashboard and unified reports', async () => {
    const d = await http.get(`${G}/dashboard`).set(as(viewer)).expect(200);
    expect(d.body.current.code).toBe('GOV-2026-01');
    expect(d.body.score.axes).toHaveLength(3);
    expect(d.body.finance.series.length).toBeGreaterThan(0);
    expect(d.body.alerts.counts.critical).toBeGreaterThan(0);
    expect(d.body.actions).toMatchObject({ total: 3, done: 1 });
    const cat = await http.get('/api/reports/catalog/governance').set(as(viewer)).expect(200);
    const codes = (cat.body.reports ?? cat.body).map((x: { code: string }) => x.code) as string[];
    expect(codes.length).toBeGreaterThanOrEqual(12);
    for (const code of codes) {
      const out = await http.get(`/api/reports/run/${code}`).set(as(viewer)).expect(200);
      expect(Array.isArray(out.body.rows)).toBe(true);
    }
    const sc = await http.get(`/api/reports/run/governance.scorecard?assessment=${ids.a}`).set(as(viewer)).expect(200);
    expect(sc.body.rows.length).toBeGreaterThan(20);
  });
});
