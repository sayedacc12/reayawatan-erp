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
 * التطوير والتدريب والصف الثاني: فجوة الجدارات من تقييم الأداء، خطة تطوير مقترحة منها قابلة للتعديل
 * بمستهدفات، مراحل اعتمادها ومتابعة تنفيذها حتى الإغلاق، ثم الوظائف البديلة ومرشحو الصف الثاني.
 */
const DB = process.env.TEST_DATABASE_URL ?? 'postgres://erp:erp@localhost:5432/charity_erp_test';

describe('HR development and succession (e2e)', () => {
  let app: NestExpressApplication;
  let http: ReturnType<typeof request>;
  let admin: string;
  let coach: string;
  let uploadDir: string;
  const as = (t: string) => ({ Authorization: `Bearer ${t}` });
  const login = async (login: string, password: string, organization?: string) =>
    (await http.post('/api/auth/login').send({ login, password, organization }).expect(200)).body.accessToken as string;
  const H = '/api/hr';
  const ids: Record<string, string> = {};
  const year = Number(new Date(Date.now() + 3 * 3600000).toISOString().slice(0, 4));

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
      name: 'جمعية الخير', slug: 'khair', adminFullName: 'مدير النظام', adminEmail: 'khair@test.org', adminPassword: 'Admin12345',
    }).expect(201);
    admin = await login('khair@test.org', 'Admin12345', 'khair');
    const role = await http.post('/api/roles').set(as(admin)).send({ name: 'أخصائي التدريب', permissions: ['hr.dashboard.read', 'hr.development.manage'] }).expect(201);
    ids.role = role.body.id;
    await http.post('/api/users').set(as(admin)).send({ fullName: 'أخصائي التدريب', email: 'coach@test.org', password: 'Coach12345', roleIds: [role.body.id] }).expect(201);
    coach = await login('coach@test.org', 'Coach12345', 'khair');

    // هيكل ووظيفتان بجدارات، وموظفان
    const comp = async (name: string, kind: string) => (await http.post(`${H}/competencies`).set(as(admin)).send({
      name, kind, levels: [1, 2, 3, 4, 5].map((level) => ({ level, description: `${name} مستوى ${level}` })),
    }).expect(201)).body.id as string;
    ids.talk = await comp('التواصل', 'core');
    ids.plan = await comp('التخطيط', 'leadership');
    ids.cases = await comp('دراسة الحالات', 'technical');
    ids.unit = (await http.post(`${H}/units`).set(as(admin)).send({ name: 'إدارة البرامج', level: 0 }).expect(201)).body.id;
    const job = (title: string, competencies: { competencyId: string; level: number }[], reportsToJobId: string | null = null) => ({
      title, unitId: ids.unit, headcount: 1, purpose: 'عمل', responsibilities: ['مهمة'], experienceYears: 0, competencies, reportsToJobId,
      kpis: [{ title: 'الإنجاز', weight: 100, target: '100%' }],
    });
    ids.mgrJob = (await http.post(`${H}/jobs`).set(as(admin)).send(job('مدير البرامج', [{ competencyId: ids.talk, level: 4 }, { competencyId: ids.plan, level: 4 }])).expect(201)).body.id;
    ids.resJob = (await http.post(`${H}/jobs`).set(as(admin)).send(job('أخصائي اجتماعي', [{ competencyId: ids.talk, level: 3 }, { competencyId: ids.cases, level: 4 }], ids.mgrJob)).expect(201)).body.id;
    ids.aidJob = (await http.post(`${H}/jobs`).set(as(admin)).send(job('مساعد إداري', [{ competencyId: ids.talk, level: 2 }])).expect(201)).body.id;
    const emp = (fullName: string, nationalId: string, jobId: string) => ({
      fullName, nationalId, nationality: 'سعودي', isSaudi: true, gender: 'male', jobId, hireDate: `${year - 2}-01-01`, contractType: 'indefinite',
      contractStart: `${year - 2}-01-01`, qiwaStatus: 'documented', basicSalary: 8000, allowances: [], gosiFirstRegistration: '2020-01-01',
    });
    ids.mgr = (await http.post(`${H}/employees`).set(as(admin)).send(emp('خالد المدير', '1011111111', ids.mgrJob)).expect(201)).body.id;
    ids.res = (await http.post(`${H}/employees`).set(as(admin)).send(emp('سارة الباحثة', '1022222222', ids.resJob)).expect(201)).body.id;

    // تقييم أداء الباحثة: التواصل 2 من 3 المطلوب، ودراسة الحالات 4 من 4
    const card = (await http.post(`${H}/performance`).set(as(admin)).send({ employeeId: ids.res, year }).expect(201)).body;
    await http.post(`${H}/performance/${card.id}/action`).set(as(admin)).send({ action: 'agree' }).expect(201);
    const c = (await http.get(`${H}/performance/${card.id}`).set(as(admin)).expect(200)).body;
    await http.patch(`${H}/performance/${card.id}`).set(as(admin)).send({
      objectives: c.objectives.map((o: { title: string; weight: number; target: string }) => ({ title: o.title, weight: o.weight, target: o.target, achievement: 90 })),
      competencies: c.competencies.map((x: { competencyId: string; requiredLevel: number }) => ({
        competencyId: x.competencyId, requiredLevel: x.requiredLevel, rating: x.competencyId === ids.talk ? 2 : 4,
      })),
    }).expect(200);
    await http.post(`${H}/performance/${card.id}/action`).set(as(admin)).send({ action: 'evaluate' }).expect(201);
  });

  afterAll(async () => {
    await app.get(DataSource).destroy();
    await app.close();
    rmSync(uploadDir, { recursive: true, force: true });
  });

  it('shows the competency gap between the job description and the latest evaluation', async () => {
    const g = (await http.get(`${H}/development/gaps`).set(as(coach)).expect(200)).body;
    const res = g.rows.find((r: { employeeId: string }) => r.employeeId === ids.res);
    expect(res.evaluatedYear).toBe(year);
    expect(res.totalGap).toBe(1);
    expect(res.competencies.find((x: { competencyId: string }) => x.competencyId === ids.talk)).toMatchObject({ required: 3, actual: 2, gap: 1 });
    // المدير لم يُقيَّم بعد: جداراته بلا مستوى فعلي
    expect(g.rows.find((r: { employeeId: string }) => r.employeeId === ids.mgr).unrated).toBe(2);
    expect(g.topGaps[0].competencyId).toBe(ids.talk);
  });

  it('a development plan is proposed from the gap, then edited with targets and activities', async () => {
    await http.post(`${H}/dev-plans`).set(as(admin)).send({ employeeId: ids.res, kind: 'individual', year: 1999 }).expect(400);
    const p = (await http.post(`${H}/dev-plans`).set(as(coach)).send({ employeeId: ids.res, kind: 'individual', year }).expect(201)).body;
    ids.planA = p.id;
    expect(p.status).toBe('draft');
    expect(p.items).toHaveLength(1);
    expect(p.items[0]).toMatchObject({ competencyId: ids.talk, requiredLevel: 3, currentLevel: 2, targetLevel: 3 });
    expect(p.goals.length).toBeGreaterThan(0);
    await http.post(`${H}/dev-plans`).set(as(coach)).send({ employeeId: ids.res, kind: 'individual', year }).expect(409);

    const item = { ...p.items[0], activityType: 'course', activity: 'دورة مهارات التواصل', provider: 'معهد الإدارة', cost: 1500, hours: 20, dueDate: `${year}-12-31` };
    const strip = ({ id, competencyId, name, requiredLevel, currentLevel, targetLevel, activityType, activity, provider, dueDate, cost, hours, note }: typeof item) =>
      ({ id, competencyId, name, requiredLevel, currentLevel, targetLevel, activityType, activity, provider, dueDate, cost, hours, note });
    const body = (items: object[]) => ({ title: p.title, goals: ['الوصول للمستوى المطلوب في التواصل'], items });
    await http.put(`${H}/dev-plans/${p.id}`).set(as(coach)).send(body([{ ...strip(item), activityType: 'unknown' }])).expect(400);
    await http.put(`${H}/dev-plans/${p.id}`).set(as(coach)).send(body([{ ...strip(item), targetLevel: 2 }])).expect(400);
    const extra = { competencyId: null, name: 'العرض والتقديم', requiredLevel: null, currentLevel: 1, targetLevel: 3, activityType: 'workshop', activity: 'ورشة العرض', provider: null, dueDate: `${year}-10-31`, cost: 500, hours: 6, note: null };
    const u = (await http.put(`${H}/dev-plans/${p.id}`).set(as(coach)).send(body([strip(item), extra])).expect(200)).body;
    expect(u.items).toHaveLength(2);
    expect(u.items[0].id).toBe(p.items[0].id);
    expect(u.progress).toMatchObject({ items: 2, cost: 2000, hours: 26, percent: 0 });
  });

  it('goes through the approval stages, then progress is tracked until the plan is closed', async () => {
    await http.put(`${H}/development/config`).set(as(coach)).send({ stages: [], activityTypes: [{ code: 'course', name: 'دورة' }] }).expect(403);
    const cfg = (await http.get(`${H}/development/config`).set(as(admin)).expect(200)).body.config;
    // نوع مستخدم في خطة لا يُحذف
    await http.put(`${H}/development/config`).set(as(admin)).send({ stages: [], activityTypes: [{ code: 'other', name: 'أخرى' }] }).expect(409);
    await http.put(`${H}/development/config`).set(as(admin)).send({
      stages: [{ name: 'مراجعة مدير الإدارة', roleId: null }, { name: 'اعتماد المدير التنفيذي', roleId: ids.role }], activityTypes: cfg.activityTypes,
    }).expect(200);

    const s = (await http.post(`${H}/dev-plans/${ids.planA}/submit`).set(as(coach)).expect(201)).body;
    expect(s.status).toBe('pending');
    expect(s.stageName).toBe('مراجعة مدير الإدارة');
    await http.post(`${H}/dev-plans/${ids.planA}/decision`).set(as(coach)).send({ decision: 'approve' }).expect(403);
    await http.post(`${H}/dev-plans/${ids.planA}/decision`).set(as(admin)).send({ decision: 'return' }).expect(400);
    expect((await http.post(`${H}/dev-plans/${ids.planA}/decision`).set(as(admin)).send({ decision: 'return', note: 'أضف التكلفة' }).expect(201)).body.status).toBe('returned');
    await http.post(`${H}/dev-plans/${ids.planA}/submit`).set(as(coach)).expect(201);
    const st = (await http.post(`${H}/dev-plans/${ids.planA}/decision`).set(as(admin)).send({ decision: 'approve' }).expect(201)).body;
    expect(st.stageName).toBe('اعتماد المدير التنفيذي');
    expect(st.stages.map((x: { done: boolean; current: boolean }) => [x.done, x.current])).toEqual([[true, false], [false, true]]);
    const fin = (await http.post(`${H}/dev-plans/${ids.planA}/decision`).set(as(admin)).send({ decision: 'approve' }).expect(201)).body;
    expect(fin.status).toBe('approved');
    await http.put(`${H}/dev-plans/${ids.planA}`).set(as(coach)).send({ title: 'x x x', goals: ['x'], items: [] }).expect(409);

    // المتابعة: المنجز يحتاج المستوى المحقق، والإغلاق بعد إنجاز الكل
    const [a, b] = fin.items as { id: string }[];
    await http.post(`${H}/dev-plans/${ids.planA}/progress`).set(as(coach)).send({ items: [{ id: a.id, status: 'done' }] }).expect(400);
    const pr = (await http.post(`${H}/dev-plans/${ids.planA}/progress`).set(as(coach)).send({ items: [{ id: a.id, status: 'done', achievedLevel: 3, note: 'اجتاز' }, { id: b.id, status: 'in_progress' }] }).expect(201)).body;
    expect(pr.progress).toMatchObject({ done: 1, percent: 50, closedGaps: 1 });
    expect(pr.can.complete).toBe(false);
    await http.post(`${H}/dev-plans/${ids.planA}/complete`).set(as(coach)).send({}).expect(400);
    await http.post(`${H}/dev-plans/${ids.planA}/progress`).set(as(coach)).send({ items: [{ id: b.id, status: 'cancelled', note: 'أُلغيت الورشة' }] }).expect(201);
    const done = (await http.post(`${H}/dev-plans/${ids.planA}/complete`).set(as(coach)).send({ note: 'تحققت المستهدفات' }).expect(201)).body;
    expect(done.status).toBe('completed');
    const list = (await http.get(`${H}/dev-plans?year=${year}`).set(as(coach)).expect(200)).body;
    expect(list[0]).toMatchObject({ serial: 1, status: 'completed', percent: 100 });
  });

  it('every job has a backup job and second-line candidates; jobs without a backup are flagged', async () => {
    const s0 = (await http.get(`${H}/succession`).set(as(coach)).expect(200)).body;
    expect(s0.totals).toMatchObject({ jobs: 3, none: 3 });
    expect(s0.rows.find((r: { jobId: string }) => r.jobId === ids.mgrJob).leader).toBe(true);
    await http.put(`${H}/succession/jobs/${ids.mgrJob}`).set(as(coach)).send({ backupJobId: ids.mgrJob }).expect(400);
    // وظيفة بديلة يشغلها موظف تغطي الوظيفة
    const s1 = (await http.put(`${H}/succession/jobs/${ids.mgrJob}`).set(as(coach)).send({ backupJobId: ids.resJob }).expect(200)).body;
    const mgr1 = s1.rows.find((r: { jobId: string }) => r.jobId === ids.mgrJob);
    expect(mgr1).toMatchObject({ backupJobTitle: 'أخصائي اجتماعي', status: 'developing' });
    expect(mgr1.backupHolders.map((h: { fullName: string }) => h.fullName)).toEqual(['سارة الباحثة']);
    // وظيفة بديلة شاغرة لا تكفي
    const s2 = (await http.put(`${H}/succession/jobs/${ids.resJob}`).set(as(coach)).send({ backupJobId: ids.aidJob }).expect(200)).body;
    expect(s2.rows.find((r: { jobId: string }) => r.jobId === ids.resJob).status).toBe('none');

    await http.post(`${H}/succession/jobs/${ids.mgrJob}/candidates`).set(as(coach)).send({ employeeId: ids.mgr, readiness: 'now' }).expect(400);
    const s3 = (await http.post(`${H}/succession/jobs/${ids.mgrJob}/candidates`).set(as(coach)).send({ employeeId: ids.res, readiness: 'now', note: 'تنوب عنه في الإجازات' }).expect(201)).body;
    expect(s3.rows.find((r: { jobId: string }) => r.jobId === ids.mgrJob).status).toBe('ready');
    expect(s3.totals).toMatchObject({ none: 2, ready: 1, candidates: 1, leadersWithout: 0 });

    // خطة إعداد المرشحة للوظيفة: من جدارات الوظيفة المستهدفة
    await http.post(`${H}/dev-plans`).set(as(coach)).send({ employeeId: ids.res, kind: 'succession', year }).expect(400);
    await http.post(`${H}/dev-plans`).set(as(coach)).send({ employeeId: ids.res, kind: 'succession', targetJobId: ids.resJob, year }).expect(400);
    const sp = (await http.post(`${H}/dev-plans`).set(as(coach)).send({ employeeId: ids.res, kind: 'succession', targetJobId: ids.mgrJob, year }).expect(201)).body;
    expect(sp.targetJob.title).toBe('مدير البرامج');
    expect(sp.items.map((i: { competencyId: string; currentLevel: number | null }) => [i.competencyId, i.currentLevel]))
      .toEqual([[ids.talk, 2], [ids.plan, null]]);
    const s4 = (await http.get(`${H}/succession`).set(as(coach)).expect(200)).body;
    const cand = s4.rows.find((r: { jobId: string }) => r.jobId === ids.mgrJob).candidates[0];
    expect(cand.plan).toMatchObject({ id: sp.id, status: 'draft' });
    const s5 = (await http.delete(`${H}/succession/candidates/${cand.id}`).set(as(coach)).expect(200)).body;
    expect(s5.rows.find((r: { jobId: string }) => r.jobId === ids.mgrJob).candidates).toHaveLength(0);
  });
});
