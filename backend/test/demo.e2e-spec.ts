import { Test } from '@nestjs/testing';
import { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/main';
import { norm } from '../src/modules/projects/support.service';

/** الجمعية التجريبية: بيانات مترابطة عبر كل الأنظمة، وإعادة إنشائها */
const DB = process.env.TEST_DATABASE_URL ?? 'postgres://erp:erp@localhost:5432/charity_erp_test';

describe('Demo association across all modules', () => {
  let app: NestExpressApplication;
  let http: ReturnType<typeof request>;
  let platform: string;
  let demo: { staffPassword: string; portalPassword: string; portalUsers: { nationalId: string }[]; staff: { email: string }[] };
  const as = (t: string) => ({ Authorization: `Bearer ${t}` });
  const login = async (login: string, password: string, organization?: string) =>
    (await http.post('/api/auth/login').send({ login, password, organization }).expect(200)).body.accessToken as string;
  const staff = (name: string) => login(`demo-${name}@sanabelerp.com`, demo.staffPassword, 'demo');

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
    platform = await login('admin', 'Platform123');
  });

  afterAll(async () => {
    await app.get(DataSource).destroy();
    await app.close();
  });

  it('nationality matching ignores gender and the definite article', () => {
    expect(norm('السعودية')).toBe(norm('سعودي'));
    expect(norm('سعودية')).toBe(norm('سعودي'));
    expect(norm('مصرية')).toBe(norm('مصري'));
    expect(norm('يمني')).not.toBe(norm('سعودي'));
  });

  it('creates the demo association in one click', async () => {
    const res = await http.post('/api/platform/demo-organization').set(as(platform)).expect(201);
    demo = res.body;
    expect(res.body.organization.slug).toBe('demo');
    expect(demo.staff).toHaveLength(7);
    await http.post('/api/platform/demo-organization').set(as(platform)).expect(409);
  });

  it('beneficiaries: cases in every stage, portal and accounting', async () => {
    const admin = await staff('admin');
    const board = await http.get('/api/beneficiaries/requests/board').set(as(admin)).expect(200);
    expect(board.body.byStatus).toMatchObject({ approved: 3, rejected: 1, returned: 1, in_progress: 3 });
    expect((await http.get('/api/beneficiaries/stats').set(as(admin)).expect(200)).body.beneficiaries).toBe(6);

    const t = (await http.post('/api/portal/o/demo/login').send({ nationalId: demo.portalUsers[0].nationalId, password: demo.portalPassword }).expect(200)).body.accessToken;
    const mine = (await http.get('/api/portal/requests').set(as(t)).expect(200)).body;
    expect(mine[0].status).toBe('approved');
    // المشاريع ذات الصرف العام لا تظهر في البوابة
    const info = (await http.get('/api/portal/o/demo').expect(200)).body;
    expect(info.projects.map((p: { name: string }) => p.name).sort()).toEqual(['الحقيبة المدرسية', 'دعم العمليات الجراحية', 'سلة رمضان', 'كفالة الأرامل', 'كفالة الأيتام'].sort());

    const t2 = (await http.post('/api/portal/o/demo/login').send({ nationalId: demo.portalUsers[1].nationalId, password: demo.portalPassword }).expect(200)).body.accessToken;
    const surgery = (await http.get('/api/portal/requests').set(as(t2))).body.find((r: { contributionStatus: string }) => r.contributionStatus === 'awaiting');
    const detail = (await http.get(`/api/portal/requests/${surgery.id}`).set(as(t2))).body;
    expect(detail.contribution).toMatchObject({ percent: 30, requiredAmount: 7500 });
    expect(detail.caseFile).toBeUndefined();
    // الموظف يرى ملف الحالة كاملًا قبل القرار: الأسرة والمستندات والمساعدات والطلبات الأخرى
    const staffView = (await http.get(`/api/beneficiaries/requests/${surgery.id}`).set(as(admin)).expect(200)).body;
    expect(staffView.caseFile).toMatchObject({ family: expect.any(Array), documents: expect.any(Array), aids: expect.any(Array), otherRequests: expect.any(Array) });
    expect(staffView.caseFile.otherRequests.every((o: { id: string }) => o.id !== surgery.id)).toBe(true);
    expect((await http.get('/api/beneficiaries/settings/accounting').set(as(admin)).expect(200)).body.debitAccountCode).toBe('1101');
  });

  it('projects: approved tree with pending, returned and draft examples', async () => {
    const pm = await staff('projects');
    const list = (await http.get('/api/projects/list').set(as(pm)).expect(200)).body as { name: string; approvalStatus: string }[];
    const status = Object.fromEntries(list.map((p) => [p.name, p.approvalStatus]));
    expect(status).toMatchObject({
      'كفالة الأيتام': 'approved', 'تشغيل مقر الجمعية': 'approved', 'حملة التوعية بمرض السكري': 'approved',
      'ترميم منازل الأسر المتعففة': 'pending', 'دورات التأهيل المهني': 'returned', 'سقيا الماء': 'draft',
    });
    // قيد الاعتماد في المرحلة الثانية (اعتماد المدير التنفيذي)
    const admin = await staff('admin');
    const inbox = (await http.get('/api/projects/approvals/inbox').set(as(admin)).expect(200)).body;
    expect(inbox.map((p: { name: string; currentStage: { name: string } }) => [p.name, p.currentStage.name])).toEqual([['ترميم منازل الأسر المتعففة', 'اعتماد المدير التنفيذي']]);
  });

  it('fundraising: opportunities, batches, pledge collection and journal', async () => {
    const fin = await staff('finance');
    const opps = (await http.get('/api/fundraising/opportunities').set(as(fin)).expect(200)).body;
    const rows = (opps.items ?? opps) as { status: string }[];
    const count = (s: string) => rows.filter((o) => o.status === s).length;
    expect([count('approved'), count('in_progress'), count('returned')]).toEqual([5, 1, 1]);

    const batches = (await http.get('/api/fundraising/batches').set(as(fin)).expect(200)).body as { targetName: string; amount: number; reservedAmount: number; spentAmount: number; transferredAmount: number; status: string }[];
    const widows = batches.find((b) => b.targetName.endsWith('كفالة الأرامل') && b.status !== 'pending')!;
    expect(widows).toMatchObject({ amount: 36000, reservedAmount: 11000, spentAmount: 1000 });
    const ramadan = batches.find((b) => b.targetName.endsWith('سلة رمضان'))!;
    expect(ramadan.transferredAmount).toBe(4000);

    const journal = (await http.get('/api/fundraising/journal').set(as(fin)).expect(200)).body;
    const entries = (journal.items ?? journal) as unknown[];
    expect(entries.length).toBeGreaterThanOrEqual(10);
  });

  it('support: allocations, payments, transfers and amendments are linked', async () => {
    const pm = await staff('projects');
    const allocations = (await http.get('/api/projects-ops/support/allocations').set(as(pm)).expect(200)).body as { kind: string }[];
    expect(allocations.filter((a) => a.kind === 'request')).toHaveLength(2);
    expect(allocations.filter((a) => a.kind === 'general')).toHaveLength(2);
    // طلب معتمد ينتظر التحميل، ودفعة الداعم المناسبة متاحة له
    const queue = (await http.get('/api/projects-ops/support/queue').set(as(pm)).expect(200)).body as { id: string; outstanding: number }[];
    const waiting = queue.filter((q) => q.outstanding > 0);
    expect(waiting).toHaveLength(1);
    const options = (await http.get(`/api/projects-ops/support/requests/${waiting[0].id}/options`).set(as(pm)).expect(200)).body;
    expect(options.batches.some((b: { violations: string[] }) => b.violations.length === 0)).toBe(true);
    const payments = (await http.get('/api/projects-ops/payments').set(as(pm)).expect(200)).body as { status: string }[];
    expect(payments.filter((p) => p.status === 'paid')).toHaveLength(4);
    expect(payments.filter((p) => p.status === 'pending')).toHaveLength(1);
    expect((await http.get('/api/projects-ops/transfers').set(as(pm)).expect(200)).body).toHaveLength(1);
    expect((await http.get('/api/projects-ops/amendments').set(as(pm)).expect(200)).body).toHaveLength(1);

    // الصرف التنفيذي سجّل المساعدة في ملف المستفيد
    const admin = await staff('admin');
    const portalUser = demo.portalUsers[0];
    const found = (await http.get('/api/beneficiaries').query({ search: portalUser.nationalId }).set(as(admin)).expect(200)).body;
    const id = (found.items ?? found)[0].id;
    const profile = (await http.get(`/api/beneficiaries/${id}`).set(as(admin)).expect(200)).body;
    expect(profile.aids).toHaveLength(1);
    expect(profile.aids[0]).toMatchObject({ amount: 1000, referenceNo: 'PV-1001' });
  });

  it('pledge batches are deferred donations: spent before collection, still owed by the donor', async () => {
    const admin = await staff('admin');
    const fin = await staff('finance');
    const pm = await staff('projects');
    const allocations = (await http.get('/api/projects-ops/support/allocations').set(as(pm)).expect(200)).body as { id: string; kind: string; activityName?: string; amount: number }[];
    const ops = allocations.find((a) => a.kind === 'general' && a.amount === 30000)!;
    // سدد الداعم 10,000 وصُرف منها 8,000، ويُصرف 5,000 أخرى قبل سدادها
    await http.post('/api/projects-ops/payments/direct').set(as(fin)).send({
      allocationId: ops.id, amount: 5000, method: 'voucher', payeeKind: 'other', payeeName: 'شركة الكهرباء', referenceNo: 'PV-9999',
    }).expect(201);
    const donors = (await http.get('/api/fundraising/donors').query({ search: 'مؤسسة البر' }).set(as(admin)).expect(200)).body.items as { id: string }[];
    const donor = (await http.get(`/api/fundraising/donors/${donors[0].id}`).set(as(admin)).expect(200)).body;
    expect(donor.receivable).toBe(20000); // يبقى المتبقي من الوعد مستحقًا على الداعم
  });

  it('platform: signed contract, active subscription and pending applications', async () => {
    const apps = (await http.get('/api/platform/applications').set(as(platform)).expect(200)).body as { status: string; orgName: string }[];
    expect(apps.map((a) => a.status).sort()).toEqual(['approved', 'returned', 'submitted']);
    const contracts = (await http.get('/api/platform/contracts').set(as(platform)).expect(200)).body as { status: string }[];
    expect(contracts.map((c) => c.status)).toEqual(['signed']);
    const orgs = (await http.get('/api/platform/organizations').set(as(platform)).expect(200)).body as { slug: string; subscriptionStatus: string }[];
    expect(orgs.find((o) => o.slug === 'demo')?.subscriptionStatus).toBe('active');
  });

  it('resets the demo association and creates it again', async () => {
    await http.delete('/api/platform/demo-organization').set(as(platform)).expect(204);
    await http.delete('/api/platform/demo-organization').set(as(platform)).expect(404);
    expect((await http.get('/api/platform/applications').set(as(platform)).expect(200)).body).toHaveLength(0);
    const again = await http.post('/api/platform/demo-organization').set(as(platform)).expect(201);
    expect(again.body.organization.slug).toBe('demo');
  });
});
