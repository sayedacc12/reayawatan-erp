import { Test } from '@nestjs/testing';
import { NestExpressApplication } from '@nestjs/platform-express';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/main';
import { criticality, levelOf } from '../src/modules/risk/risk-calc';
import { defaultConfig } from '../src/modules/risk/risk-defaults';

/**
 * المخاطر والتغيير والالتزام: الإعدادات ومراحل الاعتماد، سجل المخاطر ومراجعاته، تحويل عوامل التحليل لمخاطر،
 * الضوابط، سجل التغيير ومهامه، الالتزام، استمرارية الأعمال وتفعيل فريق الأزمة، اللائحة وسجل المنهجيات، والربط مع المراجعة الداخلية.
 */
const DB = process.env.TEST_DATABASE_URL ?? 'postgres://erp:erp@localhost:5432/charity_erp_test';
const ago = (days: number) => new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);

describe('Risk calculations', () => {
  it('levels and criticality', () => {
    const c = defaultConfig();
    expect(levelOf(c, 4).key).toBe('low');
    expect(levelOf(c, 9).key).toBe('medium');
    expect(levelOf(c, 12).key).toBe('high');
    expect(levelOf(c, 20).key).toBe('critical');
    expect(criticality({ financial: 5, beneficiaries: 5, reputation: 3, legal: 2, operational: 4 }, 12).value).toBe(4);
    expect(criticality({ financial: 2, beneficiaries: 1, reputation: 1, legal: 1, operational: 2 }, 720).value).toBe(1);
  });
});

describe('Risk, change and compliance', () => {
  let app: NestExpressApplication;
  let http: ReturnType<typeof request>;
  let admin: string;
  let clerk: string;
  let clerkId: string;
  let uploadDir: string;
  const as = (t: string) => ({ Authorization: `Bearer ${t}` });
  const login = async (login: string, password: string, organization?: string) =>
    (await http.post('/api/auth/login').send({ login, password, organization }).expect(200)).body.accessToken as string;
  const R = '/api/risk';
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
      name: 'جمعية البر', slug: 'albir', adminFullName: 'مدير النظام', adminEmail: 'albir@test.org', adminPassword: 'Admin12345',
    }).expect(201);
    admin = await login('albir@test.org', 'Admin12345', 'albir');
    const role = await http.post('/api/roles').set(as(admin)).send({
      name: 'موظف', permissions: ['risk.dashboard.read', 'risk.register.manage', 'risk.change.manage'],
    }).expect(201);
    clerkId = (await http.post('/api/users').set(as(admin)).send({ fullName: 'موظف المخاطر', email: 'clerk@test.org', password: 'Clerk12345', roleIds: [role.body.id] }).expect(201)).body.id;
    clerk = await login('clerk@test.org', 'Clerk12345', 'albir');
    ids.unit = (await http.post('/api/hr/units').set(as(admin)).send({ name: 'الإدارة التنفيذية', level: 0 }).expect(201)).body.id;
  });

  afterAll(async () => {
    await app.get(DataSource).destroy();
    await app.close();
    rmSync(uploadDir, { recursive: true, force: true });
  });

  it('config with validation and flexible approval stages', async () => {
    const r = await http.get(`${R}/config`).set(as(clerk)).expect(200);
    expect(r.body.config.levels).toHaveLength(4);
    const cfg = r.body.config;
    await http.put(`${R}/config`).set(as(clerk)).send({ config: cfg }).expect(403);
    await http.put(`${R}/config`).set(as(admin)).send({ config: { ...cfg, appetite: 40 } }).expect(400);
    // مرحلة واحدة لاعتماد المخاطر
    const saved = await http.put(`${R}/config`).set(as(admin)).send({ config: { ...cfg, workflows: { ...cfg.workflows, risk: [{ name: 'اعتماد لجنة المخاطر', roleId: null }] } } }).expect(200);
    expect(saved.body.config.workflows.risk).toHaveLength(1);
  });

  const risk = (over: Record<string, unknown> = {}) => ({
    title: 'انخفاض التبرعات', source: 'external', category: 'financial', ownerName: 'مدير تنمية الموارد', unitId: ids.unit,
    inherentLikelihood: 4, inherentImpact: 4, residualLikelihood: 3, residualImpact: 4, treatment: 'reduce',
    actions: [{ title: 'خطة تنويع المانحين', ownerName: 'مدير تنمية الموارد', dueDate: ago(5), status: 'in_progress' }],
    kris: [{ name: 'نسبة التحصيل', threshold: 'أقل من 80%', current: '72%', breached: true }], ...over,
  });

  it('risk register with scoring, reviews and approval', async () => {
    await http.post(`${R}/risks`).set(as(clerk)).send(risk({ residualLikelihood: 5, residualImpact: 5 })).expect(400);
    await http.post(`${R}/risks`).set(as(clerk)).send(risk({ source: 'product' })).expect(400);
    await http.post(`${R}/risks`).set(as(clerk)).send(risk({ treatment: 'accept' })).expect(400);
    const r = await http.post(`${R}/risks`).set(as(clerk)).send(risk()).expect(201);
    ids.risk = r.body.id;
    expect(r.body.code).toBe('RSK-001');
    expect(r.body.inherentScore).toBe(16);
    expect(r.body.residualLevel.key).toBe('high');
    expect(r.body.aboveAppetite).toBe(true);
    expect(r.body.overdueActions).toBe(1);
    expect(r.body.unitName).toBe('الإدارة التنفيذية');
    expect(r.body.reviews).toHaveLength(1);
    await http.post(`${R}/risks/${ids.risk}/submit`).set(as(clerk)).expect(201);
    await http.patch(`${R}/risks/${ids.risk}`).set(as(clerk)).send(risk()).expect(409);
    await http.post(`${R}/risks/${ids.risk}/decision`).set(as(clerk)).send({ decision: 'approve' }).expect(403);
    await http.post(`${R}/risks/${ids.risk}/decision`).set(as(admin)).send({ decision: 'return' }).expect(400);
    const ok = await http.post(`${R}/risks/${ids.risk}/decision`).set(as(admin)).send({ decision: 'approve' }).expect(201);
    expect(ok.body.status).toBe('approved');
    expect(ok.body.revision).toBe(0);
    // المراجعة الدورية لا تعيد الاعتماد
    const rv = await http.post(`${R}/risks/${ids.risk}/reviews`).set(as(clerk)).send({ reviewDate: ago(0), likelihood: 2, impact: 4, note: 'تحسن التحصيل' }).expect(201);
    expect(rv.body.residualScore).toBe(8);
    expect(rv.body.status).toBe('approved');
    expect(rv.body.reviews).toHaveLength(2);
    // تعديل التقييم يعيده مسودة، وإعادة الاعتماد تزيد رقم المراجعة
    const ed = await http.patch(`${R}/risks/${ids.risk}`).set(as(clerk)).send(risk({ residualLikelihood: 2, residualImpact: 3 })).expect(200);
    expect(ed.body.status).toBe('draft');
    await http.post(`${R}/risks/${ids.risk}/submit`).set(as(clerk)).expect(201);
    expect((await http.post(`${R}/risks/${ids.risk}/decision`).set(as(admin)).send({ decision: 'approve' }).expect(201)).body.revision).toBe(1);
    await http.delete(`${R}/risks/${ids.risk}`).set(as(clerk)).expect(409);
    expect((await http.get(`${R}/approvals`).set(as(admin)).expect(200)).body).toHaveLength(0);
  });

  it('PESTEL items become risks in the enterprise register', async () => {
    const a = await http.post(`${R}/analyses`).set(as(admin)).send({
      kind: 'pestel', title: 'تحليل البيئة الخارجية 2026', analysisDate: ago(0),
      items: [{ factor: 'legal', text: 'تحديث اشتراطات الحوكمة للجمعيات', impact: 4, likelihood: 3 }, { factor: 'economic', text: 'ارتفاع الأسعار', impact: 3, likelihood: 4 }],
    }).expect(201);
    ids.analysis = a.body.id;
    await http.post(`${R}/analyses`).set(as(admin)).send({ kind: 'pestel', title: 'خطأ', analysisDate: ago(0), items: [{ factor: 'strength', text: 'x', impact: 1, likelihood: 1 }] }).expect(400);
    const item = a.body.items[0];
    const nr = await http.post(`${R}/analyses/${ids.analysis}/to-risk`).set(as(admin)).send({ itemId: item.id, category: 'compliance' }).expect(201);
    expect(nr.body.source).toBe('external');
    expect(nr.body.inherentScore).toBe(12);
    expect(nr.body.analysis.code).toBe('ANL-001');
    await http.post(`${R}/analyses/${ids.analysis}/to-risk`).set(as(admin)).send({ itemId: item.id, category: 'compliance' }).expect(409);
    ids.risk2 = nr.body.id;
    const swot = await http.post(`${R}/analyses`).set(as(admin)).send({
      kind: 'swot', title: 'SWOT', analysisDate: ago(0), items: [{ factor: 'strength', text: 'سمعة جيدة', impact: 4, likelihood: 5 }],
      strategies: [{ type: 'SO', text: 'استثمار السمعة في حملات جديدة' }],
    }).expect(201);
    await http.post(`${R}/analyses/${swot.body.id}/to-risk`).set(as(admin)).send({ itemId: swot.body.items[0].id, category: 'strategic' }).expect(400);
  });

  it('controls linked to risks', async () => {
    await http.post(`${R}/controls`).set(as(clerk)).send({ name: 'تسوية بنكية شهرية', type: 'detective', automated: false, frequency: 'monthly', effectiveness: 'effective', riskIds: [ids.risk] }).expect(400);
    const c = await http.post(`${R}/controls`).set(as(clerk)).send({
      name: 'تسوية بنكية شهرية', type: 'detective', automated: false, frequency: 'monthly', effectiveness: 'effective', lastTestDate: ago(10), riskIds: [ids.risk],
    }).expect(201);
    expect(c.body.code).toBe('CTL-001');
    ids.control = c.body.id;
    const r = await http.get(`${R}/risks/${ids.risk}`).set(as(clerk)).expect(200);
    expect(r.body.controls[0].code).toBe('CTL-001');
  });

  it('change register with sub tasks assigned by structure', async () => {
    const dto = {
      title: 'تطبيق نظام سنابل', changeType: 'technology', changeClass: 'normal', priority: 'high', reason: 'توحيد الأنظمة',
      impacts: [{ area: 'الأفراد', level: 3 }, { area: 'العمليات', level: 4 }], riskIds: [ids.risk],
    };
    const c = await http.post(`${R}/changes`).set(as(clerk)).send(dto).expect(201);
    ids.change = c.body.id;
    expect(c.body.code).toBe('CHG-001');
    await http.post(`${R}/changes/${ids.change}/progress`).set(as(clerk)).send({ phase: 'implementing' }).expect(409);
    await http.post(`${R}/changes/${ids.change}/submit`).set(as(clerk)).expect(201);
    for (let i = 0; i < 3; i++) await http.post(`${R}/changes/${ids.change}/decision`).set(as(admin)).send({ decision: 'approve' }).expect(201);
    expect((await http.get(`${R}/changes/${ids.change}`).set(as(clerk)).expect(200)).body.status).toBe('approved');
    await http.post(`${R}/changes/${ids.change}/progress`).set(as(clerk)).send({ phase: 'implementing' }).expect(400);
    await http.post(`${R}/changes/${ids.change}/tasks`).set(as(clerk)).send({ title: 'تدريب الموظفين', dueDate: ago(-10) }).expect(400);
    const t = await http.post(`${R}/changes/${ids.change}/tasks`).set(as(clerk)).send({ title: 'تدريب الموظفين', unitId: ids.unit, assigneeUserId: clerkId, dueDate: ago(-10) }).expect(201);
    expect(t.body.unitName).toBe('الإدارة التنفيذية');
    await http.post(`${R}/changes/${ids.change}/progress`).set(as(clerk)).send({ phase: 'implementing' }).expect(201);
    await http.post(`${R}/changes/${ids.change}/progress`).set(as(clerk)).send({ phase: 'completed', reviewResult: 'تم' }).expect(400);
    await http.post(`${R}/tasks/${t.body.id}/progress`).set(as(clerk)).send({ status: 'done', progress: 100 }).expect(400);
    await http.post(`${R}/tasks/${t.body.id}/progress`).set(as(clerk)).send({ status: 'done', progress: 100, completionNote: 'دُرب 12 موظفًا' }).expect(201);
    const mine = await http.get(`${R}/tasks?mine=1`).set(as(clerk)).expect(200);
    expect(mine.body[0].source.code).toBe('CHG-001');
    await http.post(`${R}/changes/${ids.change}/progress`).set(as(clerk)).send({ phase: 'completed', reviewResult: 'تحققت المنافع' }).expect(201);
    expect((await http.post(`${R}/changes/${ids.change}/progress`).set(as(clerk)).send({ phase: 'closed', lessons: 'التدريب المبكر' }).expect(201)).body.phase).toBe('closed');
  });

  it('compliance obligations and approved assessments', async () => {
    const o = await http.post(`${R}/obligations`).set(as(admin)).send({ title: 'رفع القوائم المالية المدققة', authority: 'المركز الوطني لتنمية القطاع غير الربحي', frequency: 'annual', riskId: ids.risk2 }).expect(201);
    ids.obl = o.body.id;
    await http.post(`${R}/obligations/${ids.obl}/assessments`).set(as(admin)).send({ assessmentDate: ago(0), result: 'partial' }).expect(400);
    const a = await http.post(`${R}/obligations/${ids.obl}/assessments`).set(as(admin)).send({
      assessmentDate: ago(0), result: 'partial', gaps: 'تأخر الرفع', correctiveAction: 'جدولة الرفع', actionDueDate: ago(-30),
    }).expect(201);
    const asmId = a.body.assessments[0].id;
    const after = await http.post(`${R}/assessments/${asmId}/submit`).set(as(admin)).expect(201);
    expect(after.body.lastResult).toBeNull();
    const done = await http.post(`${R}/assessments/${asmId}/decision`).set(as(admin)).send({ decision: 'approve' }).expect(201);
    expect(done.body.lastResult).toBe('partial');
    expect(done.body.nextDueDate > ago(-360)).toBe(true);
    await http.delete(`${R}/obligations/${ids.obl}`).set(as(admin)).expect(409);
  });

  it('crisis team activation grants and revokes emergency permissions', async () => {
    const bia = await http.post(`${R}/continuity`).set(as(admin)).send({
      activity: 'صرف المساعدات الشهرية', impacts: { financial: 3, beneficiaries: 5, reputation: 4, legal: 2, operational: 4 },
      mtpdHours: 72, rtoHours: 96, dependencies: [], steps: [],
    }).expect(400);
    expect(bia.body.message).toContain('الوقت المستهدف');
    const b = await http.post(`${R}/continuity`).set(as(admin)).send({
      activity: 'صرف المساعدات الشهرية', impacts: { financial: 3, beneficiaries: 5, reputation: 4, legal: 2, operational: 4 },
      mtpdHours: 72, rtoHours: 48, dependencies: [{ kind: 'system', name: 'نظام سنابل' }], steps: [{ title: 'تفعيل الصرف اليدوي', withinHours: 24 }],
    }).expect(201);
    expect(b.body.criticality.value).toBe(4);
    const team = {
      name: 'فريق إدارة الأزمات', kind: 'crisis', members: [{ userId: clerkId, name: 'موظف المخاطر', teamRole: 'قائد الفريق' }],
      authorities: [{ authority: 'اعتماد صرف طارئ', holder: 'قائد الفريق', limit: 'حتى 50,000 ريال' }],
      systemPermissions: ['risk.compliance.manage'], playbook: [{ title: 'تقييم الموقف', ownerName: 'قائد الفريق', withinHours: 2 }], continuityIds: [b.body.id],
    };
    // الموظف لا يمنح صلاحيات لا يملكها
    const t = await http.post(`${R}/crisis-teams`).set(as(admin)).send(team).expect(201);
    ids.team = t.body.id;
    await http.post(`${R}/crisis-teams/${ids.team}/activate`).set(as(admin)).send({ title: 'تعطل', severity: 'major' }).expect(409);
    await http.post(`${R}/crisis-teams/${ids.team}/submit`).set(as(admin)).expect(201);
    await http.post(`${R}/crisis-teams/${ids.team}/decision`).set(as(admin)).send({ decision: 'approve' }).expect(201);
    // قبل التفعيل لا يملك الموظف صلاحية الالتزام
    await http.post(`${R}/obligations`).set(as(clerk)).send({ title: 'متطلب', authority: 'جهة', frequency: 'annual' }).expect(403);
    const ev = await http.post(`${R}/crisis-teams/${ids.team}/activate`).set(as(admin)).send({ title: 'تعطل الأنظمة', severity: 'major' }).expect(201);
    expect(ev.body.code).toBe('CRS-001');
    expect(ev.body.tasks).toHaveLength(1);
    expect(ev.body.tasks[0].assigneeUserId).toBe(clerkId);
    await http.post(`${R}/obligations`).set(as(clerk)).send({ title: 'متطلب طارئ', authority: 'جهة', frequency: 'once' }).expect(201);
    await http.patch(`${R}/crisis-teams/${ids.team}`).set(as(admin)).send(team).expect(409);
    await http.post(`${R}/crisis-events/${ev.body.id}/log`).set(as(clerk)).send({ text: 'تم تحويل الصرف لليدوي' }).expect(201);
    await http.post(`${R}/crisis-events/${ev.body.id}/close`).set(as(admin)).send({ lessons: 'نسخ احتياطي أسرع' }).expect(201);
    await http.post(`${R}/obligations`).set(as(clerk)).send({ title: 'متطلب', authority: 'جهة', frequency: 'annual' }).expect(403);
  });

  it('policy versions record changed sections, and methodologies keep dated versions', async () => {
    const p = await http.get(`${R}/policy`).set(as(clerk)).expect(200);
    expect(p.body.current).toBeNull();
    const sections = p.body.sections;
    await http.put(`${R}/policy`).set(as(clerk)).send({ sections, effectiveDate: '2026-01-01', note: 'اعتماد' }).expect(403);
    await http.put(`${R}/policy`).set(as(admin)).send({ sections, effectiveDate: '2026-01-01', note: 'الإصدار الأول', approvedBy: 'مجلس الإدارة' }).expect(200);
    await http.put(`${R}/policy`).set(as(admin)).send({ sections, effectiveDate: '2026-06-01', note: 'بلا تغيير' }).expect(400);
    sections[2].body += '\nبند جديد';
    const v2 = await http.put(`${R}/policy`).set(as(admin)).send({ sections, effectiveDate: '2026-06-01', note: 'تعديل الرغبة في المخاطر' }).expect(200);
    expect(v2.body.current.version).toBe(2);
    expect(v2.body.current.changedSections).toEqual([{ title: sections[2].title, change: 'modified' }]);
    expect((await http.get(`${R}/policy/versions/1`).set(as(clerk)).expect(200)).body.sections[2].body).not.toContain('بند جديد');

    const m = await http.post(`${R}/methodologies/install`).set(as(admin)).expect(201);
    expect(m.body.items.length).toBeGreaterThanOrEqual(5);
    const rm = m.body.items.find((x: { code: string }) => x.code === 'MTH-RSK');
    await http.post(`${R}/methodologies/${rm.id}/versions`).set(as(admin)).send({ body: `${rm.current.body}\nإضافة`, effectiveDate: ago(-30), note: 'تحديث المعايير', approvedBy: 'لجنة المخاطر' }).expect(201);
    const at = await http.get(`${R}/methodologies/${rm.id}/at?date=${ago(0)}`).set(as(clerk)).expect(200);
    expect(at.body.version).toBe(1);
    await http.get(`${R}/methodologies/${rm.id}/at?date=2000-01-01`).set(as(clerk)).expect(404);
  });

  it('guide installs defaults once, reports and the internal audit bridge', async () => {
    const g = await http.get(`${R}/guide`).set(as(clerk)).expect(200);
    expect(g.body.filter((e: { kind: string }) => e.kind === 'term').length).toBeGreaterThan(20);
    const d = await http.get(`${R}/dashboard`).set(as(clerk)).expect(200);
    expect(d.body.risks.total).toBe(2);
    expect(d.body.alerts.some((a: { kind: string }) => a.kind === 'kri')).toBe(true);
    await http.get(`${R}/reports`).set(as(clerk)).expect(403);
    const rep = await http.get(`${R}/reports`).set(as(admin)).expect(200);
    expect(rep.body.risks.trend).toHaveLength(12);
    expect(rep.body.compliance.openGaps).toHaveLength(1);
    const bridge = app.get('RISK_REGISTER_LOOKUP', { strict: false });
    const [org] = await app.get(DataSource).query(`SELECT id FROM organizations WHERE slug = 'albir'`);
    const list = await bridge.listRisks(org.id);
    expect(list[0]).toMatchObject({ code: expect.stringMatching(/^RSK-/), level: expect.any(String), levelLabel: expect.any(String) });
    expect(list.find((r: { id: string }) => r.id === ids.risk).unitId).toBe(ids.unit);
    expect((await bridge.listControls(org.id))[0].riskIds).toContain(ids.risk);
  });
});
