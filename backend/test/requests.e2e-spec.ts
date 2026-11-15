import { Test } from '@nestjs/testing';
import { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/main';

/** الأنشطة، سير العمل والنماذج، الطلبات، بوابة المستفيدين، والجمعية التجريبية */
const DB = process.env.TEST_DATABASE_URL ?? 'postgres://erp:erp@localhost:5432/charity_erp_test';

describe('Requests workflow + beneficiary portal', () => {
  let app: NestExpressApplication;
  let http: ReturnType<typeof request>;
  let platform: string;
  let admin: string;
  const as = (t: string) => ({ Authorization: `Bearer ${t}` });
  const login = async (login: string, password: string, organization?: string) =>
    (await http.post('/api/auth/login').send({ login, password, organization }).expect(200)).body.accessToken as string;

  beforeAll(async () => {
    Object.assign(process.env, {
      DATABASE_URL: DB, JWT_SECRET: 'test-secret', PLATFORM_ADMIN_EMAIL: 'platform@test.org', PLATFORM_ADMIN_PASSWORD: 'Platform123',
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
    for (const slug of ['alkhair', 'other']) {
      await http.post('/api/platform/organizations').set(as(platform)).send({
        name: `جمعية ${slug}`, slug, adminFullName: 'مدير', adminEmail: `${slug}@test.org`, adminPassword: 'Admin12345',
      }).expect(201);
    }
    admin = await login('alkhair@test.org', 'Admin12345', 'alkhair');
  });

  afterAll(async () => {
    await app.get(DataSource).destroy();
    await app.close();
  });

  const ids: Record<string, string> = {};

  it('builds the axis → program → project tree', async () => {
    const axis = await http.post('/api/beneficiaries/settings/activities').set(as(admin)).send({ level: 'axis', name: 'الرعاية الاجتماعية' }).expect(201);
    await http.post('/api/beneficiaries/settings/activities').set(as(admin)).send({ level: 'project', name: 'بدون أب', parentId: axis.body.id }).expect(400);
    const program = await http.post('/api/beneficiaries/settings/activities').set(as(admin)).send({ level: 'program', name: 'كفالة الأسر', parentId: axis.body.id }).expect(201);
    const project = await http.post('/api/beneficiaries/settings/activities').set(as(admin)).send({ level: 'project', name: 'كفالة الأيتام', parentId: program.body.id }).expect(201);
    ids.axis = axis.body.id;
    ids.project = project.body.id;
    await http.delete(`/api/beneficiaries/settings/activities/${axis.body.id}`).set(as(admin)).expect(409);
    const list = await http.get('/api/beneficiaries/settings/activities').set(as(admin)).expect(200);
    expect(list.body).toHaveLength(3);
  });

  it('defines dynamic forms and a workflow with stages and responsible roles', async () => {
    await http.post('/api/beneficiaries/settings/forms').set(as(admin))
      .send({ name: 'خطأ', fields: [{ label: 'قائمة', type: 'select' }] }).expect(400);
    const app1 = await http.post('/api/beneficiaries/settings/forms').set(as(admin)).send({
      name: 'بيانات الطلب', fields: [{ key: 'reason', label: 'سبب الطلب', type: 'textarea', required: true }, { label: 'عدد الأفراد', type: 'number' }],
    }).expect(201);
    expect(app1.body.fields[1].key).toBe('f2');
    const research = await http.post('/api/beneficiaries/settings/forms').set(as(admin)).send({
      name: 'البحث الاجتماعي',
      fields: [{ key: 'housing', label: 'حالة السكن', type: 'select', required: true, options: ['جيدة', 'سيئة'] }, { key: 'ok', label: 'تمت الزيارة', type: 'checkbox', required: true }],
    }).expect(201);
    ids.researchForm = research.body.id;

    const role = await http.post('/api/roles').set(as(admin)).send({
      name: 'باحث', permissions: ['beneficiaries.requests.read', 'beneficiaries.requests.process'],
    }).expect(201);
    ids.role = role.body.id;
    await http.post('/api/users').set(as(admin)).send({ fullName: 'منى الباحثة', email: 'r@test.org', password: 'Research123', roleIds: [role.body.id] }).expect(201);
    const clerkRole = await http.post('/api/roles').set(as(admin)).send({
      name: 'معالج عام', permissions: ['beneficiaries.requests.read', 'beneficiaries.requests.process'],
    }).expect(201);
    await http.post('/api/users').set(as(admin)).send({ fullName: 'موظف', email: 'c@test.org', password: 'Clerk12345', roleIds: [clerkRole.body.id] }).expect(201);

    await http.post('/api/beneficiaries/settings/workflows').set(as(admin)).send({ name: 'فاضي', stages: [] }).expect(400);
    const wf = await http.post('/api/beneficiaries/settings/workflows').set(as(admin)).send({
      name: 'سير المساعدات', applicationFormId: app1.body.id,
      stages: [
        { name: 'مراجعة' },
        { name: 'البحث الاجتماعي', formId: research.body.id, roleId: role.body.id, canReject: false },
        { name: 'الاعتماد النهائي' },
      ],
    }).expect(201);
    expect(wf.body.isDefault).toBe(true);
    expect(wf.body.stages.map((s: { name: string }) => s.name)).toEqual(['مراجعة', 'البحث الاجتماعي', 'الاعتماد النهائي']);
    ids.workflow = wf.body.id;
    ids.stages = wf.body.stages.map((s: { id: string }) => s.id).join(',');
  });

  let portal: string;
  let reqId: string;

  it('lets a beneficiary register on the portal, apply and track', async () => {
    const info = await http.get('/api/portal/o/alkhair').expect(200);
    expect(info.body.projects[0]).toMatchObject({ name: 'كفالة الأيتام', program: 'كفالة الأسر', axis: 'الرعاية الاجتماعية' });
    expect(info.body.projects[0].applicationForm.fields).toHaveLength(2);
    await http.get('/api/portal/o/nope').expect(404);

    const reg = await http.post('/api/portal/o/alkhair/register').send({
      fullName: 'سعاد محمود', nationalId: '29001011234567', phone: '01011112222', gender: 'female', password: 'Portal123',
    }).expect(201);
    portal = reg.body.accessToken;
    await http.post('/api/portal/o/alkhair/register').send({
      fullName: 'تاني', nationalId: '29001011234567', phone: '01011112222', gender: 'female', password: 'Portal123',
    }).expect(409);
    await http.post('/api/portal/o/alkhair/login').send({ nationalId: '29001011234567', password: 'wrong' }).expect(401);
    await http.post('/api/portal/o/other/login').send({ nationalId: '29001011234567', password: 'Portal123' }).expect(401);
    portal = (await http.post('/api/portal/o/alkhair/login').send({ nationalId: '٢٩٠٠١٠١١٢٣٤٥٦٧', password: 'Portal123' }).expect(200)).body.accessToken;

    // رمز البوابة لا يفتح نظام الموظفين، ورمز الموظف لا يفتح البوابة
    await http.get('/api/beneficiaries').set(as(portal)).expect(401);
    await http.get('/api/portal/me').set(as(admin)).expect(401);

    const me = await http.get('/api/portal/me').set(as(portal)).expect(200);
    expect(me.body.profile).toMatchObject({ fullName: 'سعاد محمود', fileNo: 1 });

    await http.post('/api/portal/requests').set(as(portal)).send({ projectId: ids.project, applicationData: {} }).expect(400);
    const r = await http.post('/api/portal/requests').set(as(portal))
      .send({ projectId: ids.project, applicationData: { reason: 'أرملة وأعول 3 أطفال', f2: '٤', extra: 'x' } }).expect(201);
    reqId = r.body.id;
    expect(r.body.requestNo).toBe(1);
    expect(r.body.applicationData).toEqual({ reason: 'أرملة وأعول 3 أطفال', f2: 4 });
    expect(r.body.workflow.stages).toHaveLength(3);
    await http.post('/api/portal/requests').set(as(portal)).send({ projectId: ids.project, applicationData: { reason: 'تاني' } }).expect(409);

    const mine = await http.get('/api/portal/requests').set(as(portal)).expect(200);
    expect(mine.body[0]).toMatchObject({ requestNo: 1, stage: 'مراجعة', stageIndex: 1, stageCount: 3 });
  });

  it('returns to the applicant from the first stage and accepts a resubmission', async () => {
    await http.post(`/api/beneficiaries/requests/${reqId}/decision`).set(as(admin)).send({ decision: 'return' }).expect(400);
    const ret = await http.post(`/api/beneficiaries/requests/${reqId}/decision`).set(as(admin))
      .send({ decision: 'return', notes: 'ارفعي صورة البطاقة' }).expect(201);
    expect(ret.body.status).toBe('returned');

    const view = await http.get(`/api/portal/requests/${reqId}`).set(as(portal)).expect(200);
    expect(view.body.status).toBe('returned');
    expect(view.body.actions.at(-1)).toMatchObject({ decision: 'return', notes: 'ارفعي صورة البطاقة', actorName: 'الجمعية' });

    await http.post(`/api/portal/requests/${reqId}/resubmit`).set(as(portal)).send({ notes: 'تم الرفع' }).expect(200);
    expect((await http.get(`/api/portal/requests/${reqId}`).set(as(portal))).body.status).toBe('in_progress');
  });

  it('enforces stage roles and forms, supports return to previous stage, then final approval', async () => {
    const [s1, s2, s3] = ids.stages.split(',');
    await http.post(`/api/beneficiaries/requests/${reqId}/decision`).set(as(admin)).send({ decision: 'approve', notes: 'تمام' }).expect(201);

    // مرحلة البحث: للباحث فقط
    const clerk = await login('c@test.org', 'Clerk12345', 'alkhair');
    const forClerk = await http.get(`/api/beneficiaries/requests/${reqId}`).set(as(clerk)).expect(200);
    expect(forClerk.body.currentStageId).toBe(s2);
    expect(forClerk.body.canDecide).toBe(false);
    await http.post(`/api/beneficiaries/requests/${reqId}/decision`).set(as(clerk)).send({ decision: 'approve' }).expect(403);
    expect((await http.get('/api/beneficiaries/requests?mine=true').set(as(clerk))).body.total).toBe(0);

    const researcher = await login('r@test.org', 'Research123', 'alkhair');
    expect((await http.get('/api/beneficiaries/requests?mine=true').set(as(researcher))).body.total).toBe(1);
    await http.post(`/api/beneficiaries/requests/${reqId}/decision`).set(as(researcher))
      .send({ decision: 'reject', notes: 'x' }).expect(400); // المرحلة لا تسمح بالرفض
    await http.post(`/api/beneficiaries/requests/${reqId}/decision`).set(as(researcher))
      .send({ decision: 'approve', formData: { housing: 'سيئة' } }).expect(400); // تأكيد الزيارة مطلوب
    await http.post(`/api/beneficiaries/requests/${reqId}/decision`).set(as(researcher))
      .send({ decision: 'approve', formData: { housing: 'ممتازة', ok: true } }).expect(400);
    const done = await http.post(`/api/beneficiaries/requests/${reqId}/decision`).set(as(researcher))
      .send({ decision: 'approve', formData: { housing: 'سيئة', ok: true } }).expect(201);
    expect(done.body.currentStageId).toBe(s3);

    // إرجاع للمرحلة السابقة مع السبب
    const back = await http.post(`/api/beneficiaries/requests/${reqId}/decision`).set(as(admin))
      .send({ decision: 'return', notes: 'محتاجين زيارة تانية' }).expect(201);
    expect(back.body.currentStageId).toBe(s2);
    await http.post(`/api/beneficiaries/requests/${reqId}/decision`).set(as(researcher))
      .send({ decision: 'approve', formData: { housing: 'سيئة', ok: true } }).expect(201);
    const final = await http.post(`/api/beneficiaries/requests/${reqId}/decision`).set(as(admin))
      .send({ decision: 'approve', notes: 'اعتماد نهائي' }).expect(201);
    expect(final.body.status).toBe('approved');
    expect(final.body.beneficiary.status).toBe('eligible');
    const research = final.body.actions.find((a: { formName: string }) => a.formName === 'البحث الاجتماعي');
    expect(research.formData).toEqual({ housing: 'سيئة', ok: true });
    expect(s1).toBeTruthy();

    // البوابة لا تعرض ملاحظات القبول الداخلية
    const view = await http.get(`/api/portal/requests/${reqId}`).set(as(portal)).expect(200);
    expect(view.body.status).toBe('approved');
    expect(view.body.actions.find((a: { decision: string }) => a.decision === 'approve').notes).toBeNull();
    expect(view.body.workflow.stages[0].form).toBeUndefined();

    const approved = await http.get('/api/beneficiaries/requests?status=approved').set(as(admin)).expect(200);
    expect(approved.body.total).toBe(1);
    const board = await http.get('/api/beneficiaries/requests/board').set(as(admin)).expect(200);
    expect(board.body.byStatus).toEqual({ approved: 1 });

    // الصرف مربوط بطلب معتمد
    const bid = final.body.beneficiary.id;
    await http.post(`/api/beneficiaries/${bid}/aids`).set(as(admin))
      .send({ aidType: 'cash', amount: 800, disbursedOn: '2026-11-10', requestId: reqId }).expect(201);
  });

  it('blocks deleting a stage that still has requests on it', async () => {
    const b = await http.post('/api/beneficiaries').set(as(admin)).send({ fullName: 'حالة ثانية', gender: 'male', category: 'other' }).expect(201);
    const r = await http.post('/api/beneficiaries/requests').set(as(admin)).send({ beneficiaryId: b.body.id, projectId: ids.project, applicationData: { reason: 'سبب' } }).expect(201);
    expect(r.body.source).toBe('staff');
    const [, s2, s3] = ids.stages.split(',');
    await http.put(`/api/beneficiaries/settings/workflows/${ids.workflow}`).set(as(admin)).send({
      name: 'سير المساعدات', stages: [{ id: s2, name: 'البحث' }, { id: s3, name: 'الاعتماد' }],
    }).expect(409);
    // إعادة تسمية وترتيب بدون حذف: مسموح
    const ok = await http.put(`/api/beneficiaries/settings/workflows/${ids.workflow}`).set(as(admin)).send({
      name: 'سير المساعدات', stages: [{ id: ids.stages.split(',')[0], name: 'مراجعة الطلب' }, { id: s2, name: 'البحث', formId: ids.researchForm, roleId: ids.role }, { id: s3, name: 'الاعتماد' }],
    }).expect(200);
    expect(ok.body.stages[0]).toMatchObject({ name: 'مراجعة الطلب', activeRequests: 1 });
  });

  it('handles complaints, suggestions and inquiries', async () => {
    const t = await http.post('/api/portal/tickets').set(as(portal)).send({ type: 'complaint', subject: 'تأخير', message: 'الطلب اتأخر', requestId: reqId }).expect(201);
    expect(t.body.ticketNo).toBe(1);
    const list = await http.get('/api/beneficiaries/tickets?status=open').set(as(admin)).expect(200);
    expect(list.body.items[0].beneficiary.fullName).toBe('سعاد محمود');
    await http.post(`/api/beneficiaries/tickets/${t.body.id}/reply`).set(as(admin)).send({ reply: 'تم اعتماد طلبك' }).expect(201);
    const mine = await http.get('/api/portal/tickets').set(as(portal)).expect(200);
    expect(mine.body[0]).toMatchObject({ status: 'answered', reply: 'تم اعتماد طلبك', repliedByName: 'مدير' });
    const otherAdmin = await login('other@test.org', 'Admin12345', 'other');
    await http.post(`/api/beneficiaries/tickets/${t.body.id}/reply`).set(as(otherAdmin)).send({ reply: 'محاولة' }).expect(404);
  });

  it('staff can enable portal access for an existing beneficiary', async () => {
    const b = await http.post('/api/beneficiaries').set(as(admin)).send({ fullName: 'حسن علي', nationalId: '28001011234567', gender: 'male', category: 'elderly' }).expect(201);
    await http.post('/api/portal/o/alkhair/login').send({ nationalId: '28001011234567', password: 'Hassan123' }).expect(401);
    await http.post(`/api/beneficiaries/${b.body.id}/portal-access`).set(as(admin)).send({ password: 'Hassan123' }).expect(204);
    expect((await http.get(`/api/beneficiaries/${b.body.id}`).set(as(admin))).body.hasPortalAccess).toBe(true);
    await http.post('/api/portal/o/alkhair/login').send({ nationalId: '28001011234567', password: 'Hassan123' }).expect(200);
  });

  it('platform admin creates a full demo association in one click', async () => {
    await http.post('/api/platform/demo-organization').set(as(admin)).expect(403);
    const demo = await http.post('/api/platform/demo-organization').set(as(platform)).expect(201);
    expect(demo.body.organization.slug).toBe('demo');
    await http.post('/api/platform/demo-organization').set(as(platform)).expect(409);

    const demoAdmin = await login('demo-admin@sanabelerp.com', demo.body.staffPassword, 'demo');
    const board = await http.get('/api/beneficiaries/requests/board').set(as(demoAdmin)).expect(200);
    expect(board.body.byStatus).toMatchObject({ approved: 1, rejected: 1, returned: 1, in_progress: 4 });
    const stats = await http.get('/api/beneficiaries/stats').set(as(demoAdmin)).expect(200);
    expect(stats.body.beneficiaries).toBe(6);

    const p = demo.body.portalUsers[0];
    const t = (await http.post('/api/portal/o/demo/login').send({ nationalId: p.nationalId, password: demo.body.portalPassword }).expect(200)).body.accessToken;
    const mine = await http.get('/api/portal/requests').set(as(t)).expect(200);
    expect(mine.body[0].status).toBe('approved');
    const info = await http.get('/api/portal/o/demo').expect(200);
    expect(info.body.projects).toHaveLength(5);

    // حالة العملية: التقييم بيطلب مساهمة 30% والمستفيد مستني يرفع الإثبات
    const p2 = demo.body.portalUsers[1];
    const t2 = (await http.post('/api/portal/o/demo/login').send({ nationalId: p2.nationalId, password: demo.body.portalPassword }).expect(200)).body.accessToken;
    const surgery = (await http.get('/api/portal/requests').set(as(t2))).body[0];
    expect(surgery.contributionStatus).toBe('awaiting');
    const detail = (await http.get(`/api/portal/requests/${surgery.id}`).set(as(t2))).body;
    expect(detail.contribution).toMatchObject({ percent: 30, requiredAmount: 7500 });
    const acc = await http.get('/api/beneficiaries/settings/accounting').set(as(demoAdmin)).expect(200);
    expect(acc.body.debitAccountCode).toBe('1101');
  });
});
