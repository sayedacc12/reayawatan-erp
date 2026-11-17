import { Test } from '@nestjs/testing';
import { NestExpressApplication } from '@nestjs/platform-express';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/main';

/**
 * المراجعة الداخلية: مجالات المراجعة وتقييم مخاطرها، الخطة الرئيسية والخطط الفرعية واعتمادها، توزيع المهام،
 * برنامج العمل والملاحظات (البند ← الملاحظة ← الأثر ← التوصية ← الجهة المسؤولة)، إصدار التقرير وتحويل التوصيات
 * إلى مهام مزمنة، ومتابعتها حتى إغلاقها بتقرير إغلاق موثق، ثم اللوحة والتقارير.
 */
const DB = process.env.TEST_DATABASE_URL ?? 'postgres://erp:erp@localhost:5432/charity_erp_test';
const day = (n: number) => new Date(Date.now() + 3 * 3600000 + n * 86400000).toISOString().slice(0, 10);

describe('Internal audit', () => {
  let app: NestExpressApplication;
  let http: ReturnType<typeof request>;
  let admin: string;
  let auditor: string;
  let owner: string;
  let ownerId: string;
  let uploadDir: string;
  const as = (t: string) => ({ Authorization: `Bearer ${t}` });
  const login = async (login: string, password: string, organization?: string) =>
    (await http.post('/api/auth/login').send({ login, password, organization }).expect(200)).body.accessToken as string;
  const A = '/api/audit';
  const ids: Record<string, string> = {};
  const year = Number(day(0).slice(0, 4));

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
    // سجل مخاطر وهمي بنفس عقد وحدة المخاطر (RISK_REGISTER_LOOKUP)
    const register = {
      listRisks: async () => [
        { id: 'r1', code: 'RSK-001', title: 'صرف دون مستندات مؤيدة', level: 'critical', levelLabel: 'حرج', score: 20, status: 'treating', unitName: 'الإدارة المالية' },
        { id: 'r2', code: 'RSK-002', title: 'تسرب بيانات المستفيدين', level: 'high', levelLabel: 'مرتفع', score: 12, status: 'open', unitName: null },
      ],
      listControls: async () => [{ id: 'c1', code: 'CTL-001', name: 'المطابقة الشهرية', riskIds: ['r1'] }],
    };
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider('RISK_REGISTER_LOOKUP').useValue(register).compile();
    app = configureApp(moduleRef.createNestApplication<NestExpressApplication>());
    await app.init();
    http = request(app.getHttpServer());
    const platform = await login('admin', 'Platform123');
    await http.post('/api/platform/organizations').set(as(platform)).send({
      name: 'جمعية البر', slug: 'albir', adminFullName: 'مدير النظام', adminEmail: 'albir@test.org', adminPassword: 'Admin12345',
    }).expect(201);
    admin = await login('albir@test.org', 'Admin12345', 'albir');
    const auditRole = await http.post('/api/roles').set(as(admin)).send({
      name: 'مراجع داخلي', permissions: ['audit.dashboard.read', 'audit.fieldwork.perform', 'audit.engagements.manage'],
    }).expect(201);
    const ownerRole = await http.post('/api/roles').set(as(admin)).send({ name: 'جهة مسؤولة', permissions: ['audit.actions.respond'] }).expect(201);
    await http.post('/api/users').set(as(admin)).send({ fullName: 'المراجع', email: 'auditor@test.org', password: 'Audit12345', roleIds: [auditRole.body.id] }).expect(201);
    ownerId = (await http.post('/api/users').set(as(admin)).send({ fullName: 'مدير المالية', email: 'owner@test.org', password: 'Owner12345', roleIds: [ownerRole.body.id] }).expect(201)).body.id;
    auditor = await login('auditor@test.org', 'Audit12345', 'albir');
    owner = await login('owner@test.org', 'Owner12345', 'albir');
    await http.put('/api/hr/settings').set(as(admin)).send({ structureLevels: ['المدير التنفيذي', 'إدارة'] }).expect(200);
    ids.top = (await http.post('/api/hr/units').set(as(admin)).send({ name: 'الإدارة التنفيذية', level: 0 }).expect(201)).body.id;
    ids.finance = (await http.post('/api/hr/units').set(as(admin)).send({ name: 'الإدارة المالية', level: 1, parentId: ids.top }).expect(201)).body.id;
  });

  afterAll(async () => {
    await app.get(DataSource).destroy();
    await app.close();
    rmSync(uploadDir, { recursive: true, force: true });
  });

  it('audit universe with risk assessment', async () => {
    await http.post(`${A}/areas`).set(as(admin)).send({ code: 'X', name: 'خارج', category: 'financial', scopeType: 'outside', likelihood: 3, impact: 3, controlRating: 'weak' }).expect(400);
    ids.area = (await http.post(`${A}/areas`).set(as(admin)).send({
      code: 'fin-01', name: 'المدفوعات والصرف', category: 'financial', scopeType: 'unit', unitId: ids.finance, likelihood: 4, impact: 4, controlRating: 'weak',
      riskRefs: [{ id: 'r1', code: 'RSK-001', title: 'صرف دون مستندات', level: 'high', score: 16 }],
    }).expect(201)).body.id;
    ids.area2 = (await http.post(`${A}/areas`).set(as(admin)).send({
      code: 'PRT-01', name: 'الشركاء المنفذون', category: 'programs', scopeType: 'outside', outsideLabel: 'الشركاء المنفذون', likelihood: 2, impact: 3, controlRating: 'adequate',
      lastAuditDate: day(-100),
    }).expect(201)).body.id;
    await http.post(`${A}/areas`).set(as(admin)).send({ code: 'FIN-01', name: 'مكرر', category: 'financial', scopeType: 'unit', unitId: ids.finance, likelihood: 1, impact: 1, controlRating: 'strong' }).expect(409);
    const list = (await http.get(`${A}/areas`).set(as(auditor)).expect(200)).body;
    expect(list[0].code).toBe('FIN-01');
    expect(list[0].score).toBe(16);
    expect(list[0].level).toBe('critical');
    expect(list[0].priority).toBe(20);
    expect(list[0].isDue).toBe(true);
    expect(list[0].riskRefs[0].live).toBe(true);
    expect(list[0].riskRefs[0].level).toBe('critical');
    expect(list[1].level).toBe('medium');
    expect(list[1].isDue).toBe(false);
    await http.post(`${A}/areas`).set(as(auditor)).send({ code: 'Z', name: 'zz', category: 'it', scopeType: 'unit', unitId: ids.finance, likelihood: 1, impact: 1, controlRating: 'strong' }).expect(403);
  });

  it('master and sub plans with approval', async () => {
    ids.master = (await http.post(`${A}/plans`).set(as(admin)).send({
      kind: 'master', year, title: `خطة المراجعة الداخلية ${year}`, scopeType: 'org', periodFrom: `${year}-01-01`, periodTo: `${year}-12-31`, availableHours: 1200,
    }).expect(201)).body.id;
    await http.post(`${A}/plans`).set(as(admin)).send({ kind: 'master', year, title: 'خطة ثانية', scopeType: 'org', periodFrom: `${year}-01-01`, periodTo: `${year}-12-31` }).expect(409);
    await http.post(`${A}/plans`).set(as(admin)).send({ kind: 'sub', year, title: 'فرعية', scopeType: 'org', parentId: ids.master, periodFrom: `${year}-01-01`, periodTo: `${year}-06-30` }).expect(400);
    const sub = await http.post(`${A}/plans`).set(as(admin)).send({
      kind: 'sub', year, parentId: ids.master, title: 'خطة الإدارة المالية', scopeType: 'unit', unitId: ids.finance, periodFrom: `${year}-01-01`, periodTo: `${year}-12-31`,
    }).expect(201);
    ids.sub = sub.body.id;
    expect(sub.body.code).toBe(`IAP-${year}-01`);
    await http.post(`${A}/plans/${ids.sub}/submit`).set(as(admin)).expect(400);
    const s = await http.post(`${A}/plans/${ids.sub}/suggest`).set(as(auditor)).send({ areaIds: [ids.area, ids.area2] }).expect(201);
    expect(s.body.created).toBe(2);
    await http.post(`${A}/plans/${ids.sub}/submit`).set(as(admin)).expect(201);
    await http.post(`${A}/plans/${ids.sub}/decision`).set(as(admin)).send({ decision: 'approve' }).expect(400);
    await http.post(`${A}/plans/${ids.master}/submit`).set(as(admin)).expect(201);
    await http.post(`${A}/plans/${ids.master}/decision`).set(as(admin)).send({ decision: 'return' }).expect(400);
    await http.post(`${A}/plans/${ids.master}/decision`).set(as(admin)).send({ decision: 'approve', note: 'اعتماد لجنة المراجعة' }).expect(201);
    await http.post(`${A}/plans/${ids.sub}/decision`).set(as(admin)).send({ decision: 'approve' }).expect(201);
    await http.post(`${A}/plans/${ids.master}/decision`).set(as(auditor)).send({ decision: 'approve' }).expect(403);
    const plans = (await http.get(`${A}/plans?year=${year}`).set(as(auditor)).expect(200)).body;
    expect(plans).toHaveLength(1);
    expect(plans[0].subs).toHaveLength(1);
    expect(plans[0].overall.total).toBe(2);
    const detail = (await http.get(`${A}/plans/${ids.sub}`).set(as(auditor)).expect(200)).body;
    expect(detail.engagements[0].priority).toBe('critical');
    ids.eng = detail.engagements[0].id;
  });

  it('assigns, executes the work program and records findings', async () => {
    const lookups = (await http.get(`${A}/lookups`).set(as(auditor)).expect(200)).body;
    expect(lookups.registerAvailable).toBe(true);
    expect(lookups.risks).toHaveLength(2);
    expect(lookups.controls[0].code).toBe('CTL-001');
    const auditorUser = lookups.users.find((u: { fullName: string }) => u.fullName === 'المراجع');
    await http.post(`${A}/engagements/${ids.eng}/stage`).set(as(auditor)).send({ action: 'start' }).expect(400);
    const eng = (await http.get(`${A}/engagements/${ids.eng}`).set(as(auditor)).expect(200)).body;
    await http.patch(`${A}/engagements/${ids.eng}`).set(as(auditor)).send({
      planId: ids.sub, areaId: ids.area, title: eng.title, scopeType: 'unit', unitId: ids.finance, priority: 'critical',
      plannedStart: eng.plannedStart, plannedEnd: eng.plannedEnd, budgetHours: 60, leadUserId: auditorUser.id, riskRefs: eng.riskRefs.map((r: Record<string, unknown>) => ({ id: r.id, code: r.code, title: r.title, level: r.level, score: r.score })),
    }).expect(200);
    await http.post(`${A}/engagements/${ids.eng}/stage`).set(as(auditor)).send({ action: 'start' }).expect(201);
    ids.item1 = (await http.post(`${A}/engagements/${ids.eng}/items`).set(as(auditor)).send({ title: 'اكتمال مستندات الصرف', criteria: 'اللائحة المالية م12', procedure: 'عينة 30 سندًا' }).expect(201)).body.id;
    ids.item2 = (await http.post(`${A}/engagements/${ids.eng}/items`).set(as(auditor)).send({ title: 'فصل المهام في الصرف' }).expect(201)).body.id;
    await http.post(`${A}/engagements/${ids.eng}/stage`).set(as(auditor)).send({ action: 'submit' }).expect(400);
    await http.post(`${A}/engagements/${ids.eng}/items/${ids.item2}/result`).set(as(auditor)).send({ result: 'satisfactory' }).expect(400);
    await http.post(`${A}/engagements/${ids.eng}/items/${ids.item2}/result`).set(as(auditor)).send({ result: 'satisfactory', conclusion: 'المعد غير المعتمد في كل العينة' }).expect(201);
    await http.post(`${A}/engagements/${ids.eng}/findings`).set(as(auditor)).send({
      itemId: ids.item1, title: 'سندات صرف دون فواتير', observation: '4 سندات من 30 بدون فاتورة', effect: 'احتمال صرف غير مستحق', rating: 'high',
      recommendation: 'إلزام إرفاق الفاتورة قبل الاعتماد', responsibleUnitId: ids.finance, responsibleUserId: ownerId,
    }).expect(201);
    const after = (await http.get(`${A}/engagements/${ids.eng}`).set(as(auditor)).expect(200)).body;
    expect(after.items[0].result).toBe('finding');
    expect(after.items[0].findings[0].dueDate).toBe(day(30));
    expect(after.progress.percent).toBe(100);
    await http.post(`${A}/engagements/${ids.eng}/stage`).set(as(auditor)).send({ action: 'submit', actualHours: 55 }).expect(201);
    await http.post(`${A}/engagements/${ids.eng}/issue`).set(as(auditor)).send({ summary: 'ملخص التقرير للمهمة', opinion: 'needs_improvement' }).expect(403);
  });

  it('issuing the report turns recommendations into timed tasks', async () => {
    await http.post(`${A}/engagements/${ids.eng}/stage`).set(as(admin)).send({ action: 'return' }).expect(400);
    const r = await http.post(`${A}/engagements/${ids.eng}/issue`).set(as(admin)).send({ summary: 'ضعف في مستندات الصرف يحتاج علاجًا', opinion: 'needs_improvement' }).expect(201);
    expect(r.body.actions).toBe(1);
    const eng = (await http.get(`${A}/engagements/${ids.eng}`).set(as(admin)).expect(200)).body;
    expect(eng.status).toBe('issued');
    expect(eng.report.no).toMatch(/-R$/);
    const area = (await http.get(`${A}/areas`).set(as(admin)).expect(200)).body.find((a: { id: string }) => a.id === ids.area);
    expect(area.lastAuditDate).toBe(day(0));
    const mine = (await http.get(`${A}/actions`).set(as(owner)).expect(200)).body;
    expect(mine.items).toHaveLength(1);
    ids.action = mine.items[0].id;
    expect(mine.items[0].responsibleUnitName).toBe('الإدارة المالية');
    expect(mine.items[0].dueDate).toBe(day(30));
    await http.get(`${A}/engagements`).set(as(owner)).expect(403);
    await http.post(`${A}/engagements/${ids.eng}/close`).set(as(admin)).send({}).expect(400);
  });

  it('follow-up until closure with a documented report', async () => {
    await http.post(`${A}/actions/${ids.action}/update`).set(as(owner)).send({ progress: 100 }).expect(400);
    const u = await http.post(`${A}/actions/${ids.action}/update`).set(as(owner)).send({ progress: 50, text: 'عُمِّم على المحاسبين' }).expect(201);
    expect(u.body.status).toBe('in_progress');
    await http.post(`${A}/actions/${ids.action}/extend`).set(as(owner)).send({ dueDate: day(40), reason: 'انتظار النظام' }).expect(403);
    await http.post(`${A}/actions/${ids.action}/extend`).set(as(admin)).send({ dueDate: day(45), reason: 'انتظار تحديث النظام المالي' }).expect(201);
    const pdf = Buffer.from('%PDF-1.4\n% test\n');
    await http.post(`${A}/actions/${ids.action}/documents`).set(as(owner)).field('title', 'تعميم الإدارة المالية').attach('file', pdf, 'circular.pdf').expect(201);
    await http.post(`${A}/actions/${ids.action}/closure`).set(as(owner)).send({ title: 'تقرير إغلاق', date: day(0), summary: 'قصير' }).expect(400);
    const c = await http.post(`${A}/actions/${ids.action}/closure`).set(as(owner)).send({ title: 'تقرير علاج الملاحظة', refNo: 'م/45', date: day(0), summary: 'صدر تعميم بإلزام الفواتير وتم فحص 10 سندات لاحقة' }).expect(201);
    expect(c.body.status).toBe('submitted');
    expect(c.body.documents).toHaveLength(1);
    await http.post(`${A}/actions/${ids.action}/verify`).set(as(owner)).send({ decision: 'close' }).expect(403);
    await http.post(`${A}/actions/${ids.action}/verify`).set(as(admin)).send({ decision: 'return' }).expect(400);
    const v = await http.post(`${A}/actions/${ids.action}/verify`).set(as(admin)).send({ decision: 'close', note: 'تم التحقق من العينة' }).expect(201);
    expect(v.body.status).toBe('closed');
    expect(v.body.extended).toBe(true);
    await http.post(`${A}/engagements/${ids.eng}/close`).set(as(admin)).send({ note: 'أُغلقت كل التوصيات' }).expect(201);
    const feed = (await http.get(`${A}/actions/feed`).set(as(admin)).expect(200)).body;
    expect(feed[0].source.module).toBe('audit');
  });

  it('dashboard and reports', async () => {
    const d = (await http.get(`${A}/dashboard?year=${year}`).set(as(auditor)).expect(200)).body;
    expect(d.engagements.total).toBe(2);
    expect(d.engagements.completed).toBe(1);
    expect(d.actions.closed).toBe(1);
    expect(d.actions.closureRate).toBe(100);
    expect(d.findings.high).toBe(1);
    expect(d.risk.heat.find((h: { likelihood: number; impact: number }) => h.likelihood === 4 && h.impact === 4).areas).toHaveLength(1);
    await http.get(`${A}/reports?year=${year}`).set(as(auditor)).expect(403);
    const r = (await http.get(`${A}/reports?year=${year}`).set(as(admin)).expect(200)).body;
    expect(r.byUnit[0].closureRate).toBe(100);
    expect(r.planExecution).toHaveLength(2);
    expect(d.risk.keyRisks).toBe(2);
    expect(d.risk.keyRisksCovered).toBe(1);
    expect(d.risk.uncovered[0].code).toBe('RSK-002');
    expect(r.riskCoverage.risks[0].engagements).toHaveLength(1);
    expect(r.riskCoverage.areas.find((a: { code: string }) => a.code === 'FIN-01').plannedThisYear).toBe(true);
  });
});
