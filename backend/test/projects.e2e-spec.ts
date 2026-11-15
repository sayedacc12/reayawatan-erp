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
 * نظام إدارة المشاريع: الشجرة واعتماد المشاريع، تحميل الطلبات على دفعات الداعمين وفق الاشتراطات،
 * الحجز ثم الخصم بعد الصرف المالي، الصرف العام، المناقلات، تعديل فرصة التبرع بقيد عكسي، واللوحة والتقارير.
 */
const DB = process.env.TEST_DATABASE_URL ?? 'postgres://erp:erp@localhost:5432/charity_erp_test';

describe('Project management', () => {
  let app: NestExpressApplication;
  let http: ReturnType<typeof request>;
  let admin: string;
  let uploadDir: string;
  const as = (t: string) => ({ Authorization: `Bearer ${t}` });
  const login = async (login: string, password: string, organization?: string) =>
    (await http.post('/api/auth/login').send({ login, password, organization }).expect(200)).body.accessToken as string;
  const ids: Record<string, string> = {};
  const P = '/api/projects';
  const OPS = '/api/projects-ops';

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
      name: 'جمعية الخير', slug: 'alkhair', adminFullName: 'مدير', adminEmail: 'alkhair@test.org', adminPassword: 'Admin12345',
    }).expect(201);
    admin = await login('alkhair@test.org', 'Admin12345', 'alkhair');
  });

  afterAll(async () => {
    await app.get(DataSource).destroy();
    await app.close();
    rmSync(uploadDir, { recursive: true, force: true });
  });

  it('builds the tree with project type, zakat and services', async () => {
    const axis = await http.post(`${P}/nodes`).set(as(admin)).send({ level: 'axis', name: 'الصحة' }).expect(201);
    const program = await http.post(`${P}/nodes`).set(as(admin)).send({ level: 'program', name: 'العلاج', parentId: axis.body.id }).expect(201);
    ids.program = program.body.id;
    await http.post(`${P}/nodes`).set(as(admin))
      .send({ level: 'project', name: 'خطأ', parentId: program.body.id, fundingType: 'operational', zakatEligible: true }).expect(400);
    const a = await http.post(`${P}/nodes`).set(as(admin)).send({
      level: 'project', name: 'علاج المرضى', parentId: program.body.id, fundingType: 'restricted', zakatEligible: true,
      budget: 100000, managerName: 'سارة', startDate: '2026-01-01', endDate: '2026-12-31',
      services: [{ name: 'جلسة علاج', cost: 1000 }, { name: 'خدمة داخلية', cost: 50, portalVisible: false }],
    }).expect(201);
    expect(a.body).toMatchObject({ code: 'PRJ-0001', approvalStatus: 'draft', fundingType: 'restricted', zakatEligible: true, spendingMode: 'beneficiaries' });
    ids.a = a.body.id;
    ids.b = (await http.post(`${P}/nodes`).set(as(admin)).send({ level: 'project', name: 'أجهزة طبية', parentId: program.body.id, zakatEligible: true }).expect(201)).body.id;
    ids.media = (await http.post(`${P}/nodes`).set(as(admin)).send({ level: 'project', name: 'حملة توعية', parentId: program.body.id, spendingMode: 'general' }).expect(201)).body.id;
    ids.ops = (await http.post(`${P}/nodes`).set(as(admin)).send({ level: 'project', name: 'رواتب', parentId: program.body.id, fundingType: 'operational' }).expect(201)).body.id;
    const tree = await http.get(`${P}/tree`).set(as(admin)).expect(200);
    expect(tree.body).toHaveLength(6);
  });

  it('runs the approval stages: approve moves on, return goes back, reject needs a reason', async () => {
    const role = await http.post('/api/roles').set(as(admin)).send({ name: 'لجنة المشاريع', permissions: ['projects.approval.process', 'projects.projects.read'] }).expect(201);
    await http.post('/api/users').set(as(admin)).send({ fullName: 'عضو اللجنة', email: 'c@test.org', password: 'Commit1234', roleIds: [role.body.id] }).expect(201);
    const committee = await login('c@test.org', 'Commit1234', 'alkhair');
    const st = await http.put(`${P}/stages`).set(as(admin)).send({ stages: [{ name: 'مراجعة مدير المشاريع' }, { name: 'لجنة المشاريع', roleId: role.body.id }] }).expect(200);
    expect(st.body).toHaveLength(2);

    // مشروع غير معتمد لا يقبل طلبات
    const wf = await http.post('/api/beneficiaries/settings/workflows').set(as(admin)).send({ name: 'سير الطلبات', stages: [{ name: 'الاعتماد' }] }).expect(201);
    ids.workflow = wf.body.id;
    const ben = await http.post('/api/beneficiaries').set(as(admin)).send({ fullName: 'محمد صالح', gender: 'male', category: 'patient', nationality: 'سعودي', residency: 'citizen' }).expect(201);
    ids.ben = ben.body.id;
    await http.post('/api/beneficiaries/requests').set(as(admin)).send({ beneficiaryId: ben.body.id, projectId: ids.a, services: ['جلسة علاج'] }).expect(400);

    let r = await http.post(`${P}/${ids.a}/submit`).set(as(admin)).expect(200);
    expect(r.body).toMatchObject({ approvalStatus: 'pending', currentStage: { name: 'مراجعة مدير المشاريع' } });
    await http.patch(`${P}/nodes/${ids.a}`).set(as(admin)).send({ fundingType: 'unrestricted' }).expect(409);
    await http.post(`${P}/${ids.a}/decision`).set(as(committee)).send({ decision: 'approve' }).expect(200); // مرحلة بدون دور: أي معتمد
    r = await http.get(`${P}/${ids.a}`).set(as(admin)).expect(200);
    expect(r.body.currentStage.name).toBe('لجنة المشاريع');
    await http.post(`${P}/${ids.a}/decision`).set(as(admin)).send({ decision: 'return' }).expect(400);
    await http.post(`${P}/${ids.a}/decision`).set(as(admin)).send({ decision: 'return', note: 'أكمل الأهداف' }).expect(200);
    r = await http.get(`${P}/${ids.a}`).set(as(admin)).expect(200);
    expect(r.body.currentStage.name).toBe('مراجعة مدير المشاريع');
    await http.post(`${P}/${ids.a}/decision`).set(as(admin)).send({ decision: 'approve' }).expect(200);
    const inbox = await http.get(`${P}/approvals/inbox`).set(as(committee)).expect(200);
    expect(inbox.body.map((x: { id: string }) => x.id)).toEqual([ids.a]);
    r = await http.post(`${P}/${ids.a}/decision`).set(as(committee)).send({ decision: 'approve', note: 'موافقة' }).expect(200);
    expect(r.body.approvalStatus).toBe('approved');
    expect(r.body.history.map((h: { kind: string }) => h.kind)).toEqual(['created', 'submitted', 'approved', 'returned', 'approved', 'approved']);

    for (const id of [ids.b, ids.media, ids.ops]) {
      await http.post(`${P}/${id}/submit`).set(as(admin)).expect(200);
      await http.post(`${P}/${id}/decision`).set(as(admin)).send({ decision: 'approve' }).expect(200);
      await http.post(`${P}/${id}/decision`).set(as(admin)).send({ decision: 'approve' }).expect(200);
    }
    const rejected = (await http.post(`${P}/nodes`).set(as(admin)).send({ level: 'project', name: 'مرفوض', parentId: ids.program }).expect(201)).body.id;
    await http.post(`${P}/${rejected}/submit`).set(as(admin)).expect(200);
    await http.post(`${P}/${rejected}/decision`).set(as(admin)).send({ decision: 'reject' }).expect(400);
    r = await http.post(`${P}/${rejected}/decision`).set(as(admin)).send({ decision: 'reject', note: 'خارج الخطة' }).expect(200);
    expect(r.body.approvalStatus).toBe('rejected');

    // البوابة: المشاريع المعتمدة فقط، والخدمات المخفية لا تظهر
    const portal = await http.get('/api/portal/o/alkhair').expect(200);
    const names = portal.body.projects.map((p: { name: string }) => p.name);
    expect(names).toContain('علاج المرضى');
    expect(names).not.toContain('مرفوض');
    expect(portal.body.projects.find((p: { name: string }) => p.name === 'علاج المرضى').services.map((s: { name: string }) => s.name)).toEqual(['جلسة علاج']);
  });

  it('creates approved beneficiary requests and donor batches', async () => {
    const mk = async (beneficiaryId: string, services = ['جلسة علاج']) => {
      const req = await http.post('/api/beneficiaries/requests').set(as(admin)).send({ beneficiaryId, projectId: ids.a, services }).expect(201);
      await http.post(`/api/beneficiaries/requests/${req.body.id}/decision`).set(as(admin)).send({ decision: 'approve' }).expect(201);
      return req.body.id as string;
    };
    ids.req1 = await mk(ids.ben);
    const yemeni = await http.post('/api/beneficiaries').set(as(admin)).send({ fullName: 'علي ناصر', gender: 'male', category: 'patient', nationality: 'يمني', residency: 'resident' }).expect(201);
    ids.req2 = await mk(yemeni.body.id);

    const donor = await http.post('/api/fundraising/donors').set(as(admin)).send({ name: 'مؤسسة الوفاء', type: 'entity' }).expect(201);
    ids.donor = donor.body.id;
    const bank = await http.post('/api/fundraising/settings/banks').set(as(admin)).send({ bankName: 'مصرف الراجحي', accountNumber: '123456789' }).expect(201);
    ids.bank = bank.body.id;
    const opp = await http.post('/api/fundraising/opportunities').set(as(admin)).send({
      kind: 'cash', donorId: donor.body.id, date: '2026-11-01', totalAmount: 20000, bankAccountId: bank.body.id, isZakat: true,
      conditions: { acceptsPatientContribution: false, maxSpend: 1500, nationalities: ['سعودي'], categories: ['citizen'], endDate: '2027-12-31' },
      lines: [
        { targetKind: 'program', activityId: ids.a, mode: 'amount', amount: 12000 },
        { targetKind: 'program', activityId: ids.b, mode: 'amount', amount: 8000 },
      ],
    }).expect(201);
    ids.opp = opp.body.id;
    const general = await http.post('/api/fundraising/opportunities').set(as(admin)).send({
      kind: 'cash', donorId: donor.body.id, date: '2026-11-02', totalAmount: 5000, bankAccountId: bank.body.id,
      lines: [{ targetKind: 'program', activityId: ids.media, mode: 'amount', amount: 5000 }],
    }).expect(201);
    ids.genOpp = general.body.id;
    const batches = await http.get(`/api/fundraising/batches?opportunityId=${ids.opp}`).set(as(admin)).expect(200);
    const list = Array.isArray(batches.body) ? batches.body : batches.body.items;
    ids.batchA = list.find((b: { activityId: string }) => b.activityId === ids.a).id;
    ids.batchB = list.find((b: { activityId: string }) => b.activityId === ids.b).id;
    expect(list.every((b: { status: string }) => b.status === 'active')).toBe(true);
  });

  it('loads a request on a batch only within the donor conditions (reserved)', async () => {
    const opts = await http.get(`${OPS}/support/requests/${ids.req2}/options`).set(as(admin)).expect(200);
    const onA = opts.body.batches.find((b: { id: string }) => b.id === ids.batchA);
    expect(onA.violations.join(' ')).toContain('جنسية المستفيد');
    expect(onA.violations.join(' ')).toContain('فئة المستفيد');
    await http.post(`${OPS}/support/allocate`).set(as(admin)).send({ requestId: ids.req2, batchId: ids.batchA, amount: 500 }).expect(400);
    // دفعة مشروع آخر
    await http.post(`${OPS}/support/allocate`).set(as(admin)).send({ requestId: ids.req1, batchId: ids.batchB, amount: 500 }).expect(400);
    // أكبر من احتياج الطلب (1000)
    const over = await http.post(`${OPS}/support/allocate`).set(as(admin)).send({ requestId: ids.req1, batchId: ids.batchA, amount: 1200 }).expect(400);
    expect(over.body.message).toContain('احتياج الطلب');
    const al = await http.post(`${OPS}/support/allocate`).set(as(admin)).send({ requestId: ids.req1, batchId: ids.batchA, amount: 1000 }).expect(201);
    expect(al.body).toMatchObject({ status: 'reserved', amount: 1000, kind: 'request' });
    ids.alloc1 = al.body.id;
    const b = await http.get(`/api/fundraising/batches/${ids.batchA}`).set(as(admin)).expect(200);
    expect(b.body).toMatchObject({ reservedAmount: 1000, spentAmount: 0, net: 11000 });
    const q = await http.get(`${OPS}/support/queue`).set(as(admin)).expect(200);
    expect(q.body.find((x: { id: string }) => x.id === ids.req1)).toMatchObject({ need: 1000, covered: 1000, outstanding: 0 });
    // مشروع عليه دعم محجوز لا يُعاد فتحه
    await http.post(`${P}/${ids.a}/reopen`).set(as(admin)).send({ note: 'تعديل' }).expect(409);
  });

  it('payment request to finance turns reserved into deducted, with a journal entry and aid record', async () => {
    await http.post(`${OPS}/payments`).set(as(admin)).send({ allocationId: ids.alloc1, amount: 1200, method: 'voucher' }).expect(400);
    const pr = await http.post(`${OPS}/payments`).set(as(admin)).send({ allocationId: ids.alloc1, amount: 1000, method: 'voucher' }).expect(201);
    expect(pr.body).toMatchObject({ status: 'pending', payeeName: 'محمد صالح', payeeKind: 'beneficiary' });
    await http.post(`${OPS}/support/allocations/${ids.alloc1}/release`).set(as(admin)).send({ reason: 'تجربة' }).expect(409);
    await http.post(`${OPS}/payments/${pr.body.id}/execute`).set(as(admin)).send({}).expect(400);
    const paid = await http.post(`${OPS}/payments/${pr.body.id}/execute`).set(as(admin)).send({ referenceNo: 'PV-77', paidOn: '2026-11-10' }).expect(200);
    expect(paid.body).toMatchObject({ status: 'paid', referenceNo: 'PV-77' });
    expect(paid.body.journalEntryId).toBeTruthy();
    const b = await http.get(`/api/fundraising/batches/${ids.batchA}`).set(as(admin)).expect(200);
    expect(b.body).toMatchObject({ reservedAmount: 0, spentAmount: 1000, net: 11000 });
    const allocs = await http.get(`${OPS}/support/allocations?activityId=${ids.a}`).set(as(admin)).expect(200);
    expect(allocs.body[0]).toMatchObject({ status: 'spent', spentAmount: 1000, remaining: 0, donorName: 'مؤسسة الوفاء' });
    const file = await http.get(`/api/beneficiaries/${ids.ben}`).set(as(admin)).expect(200);
    expect(file.body.aids.some((x: { amount: number; referenceNo: string }) => x.amount === 1000 && x.referenceNo === 'PV-77')).toBe(true);
  });

  it('general disbursement reserves the whole batch, then finance records vouchers', async () => {
    const batches = await http.get(`${OPS}/support/projects/${ids.media}/batches`).set(as(admin)).expect(200);
    const batch = batches.body[0];
    await http.post(`${OPS}/support/general`).set(as(admin)).send({ activityId: ids.a, batchId: ids.batchA }).expect(409);
    const al = await http.post(`${OPS}/support/general`).set(as(admin)).send({ activityId: ids.media, batchId: batch.id }).expect(201);
    expect(al.body).toMatchObject({ kind: 'general', amount: 5000, status: 'reserved' });
    const d = await http.post(`${OPS}/payments/direct`).set(as(admin)).send({
      allocationId: al.body.id, amount: 1800, method: 'invoice', payeeName: 'شركة الإعلان', referenceNo: 'INV-5',
    }).expect(201);
    expect(d.body.status).toBe('paid');
    const rel = await http.post(`${OPS}/support/allocations/${al.body.id}/release`).set(as(admin)).send({ reason: 'انتهت الحملة' }).expect(200);
    expect(rel.body).toMatchObject({ status: 'spent', spentAmount: 1800, releasedAmount: 3200 });
  });

  it('transfers the remaining net to another project of the same donor with the same conditions', async () => {
    const t = await http.get(`${OPS}/transfers/targets/${ids.batchA}`).set(as(admin)).expect(200);
    expect(t.body.projects.find((p: { id: string }) => p.id === ids.ops).problems.join(' ')).toContain('زكاة');
    await http.post(`${OPS}/transfers`).set(as(admin)).send({ sourceBatchId: ids.batchA, targetActivityId: ids.ops, amount: 1000, reason: 'نقل' }).expect(400);
    await http.post(`${OPS}/transfers`).set(as(admin)).send({ sourceBatchId: ids.batchA, targetActivityId: ids.b, amount: 99999, reason: 'نقل' }).expect(400);
    const tr = await http.post(`${OPS}/transfers`).set(as(admin)).send({ sourceBatchId: ids.batchA, targetActivityId: ids.b, amount: 3000, reason: 'احتياج أكبر' }).expect(201);
    const child = await http.get(`/api/fundraising/batches/${tr.body.targetBatchId}`).set(as(admin)).expect(200);
    expect(child.body).toMatchObject({ amount: 3000, donorId: ids.donor, activityId: ids.b, parentBatchId: ids.batchA, isZakat: true });
    expect(child.body.conditions.nationalities).toEqual(['سعودي']);
    const src = await http.get(`/api/fundraising/batches/${ids.batchA}`).set(as(admin)).expect(200);
    expect(src.body).toMatchObject({ transferredAmount: 3000, net: 8000 });
  });

  it('amends the opportunity terms with a reversing entry and a reissued entry', async () => {
    await http.post(`${OPS}/amendments`).set(as(admin)).send({
      batchId: ids.batchA, amount: 2000, effectiveDate: '2026-11-15', reason: 'طلب الداعم', donorApproved: false, acknowledged: true,
    }).expect(400);
    await http.post(`${OPS}/amendments`).set(as(admin)).send({
      batchId: ids.batchA, amount: 9000, effectiveDate: '2026-11-15', reason: 'طلب الداعم', donorApproved: true, acknowledged: true,
    }).expect(400);
    const am = await http.post(`${OPS}/amendments`).set(as(admin)).send({
      batchId: ids.batchA, amount: 2000, effectiveDate: '2026-11-15', reason: 'الداعم وسّع الجنسيات',
      nationalities: ['سعودي', 'يمني'], categories: ['citizen', 'resident'], donorApproved: true, donorApprovalRef: 'خطاب 12', acknowledged: true,
    });
    if (am.status !== 201) throw new Error(JSON.stringify(am.body));
    expect(am.body.reversalEntryId).toBeTruthy();
    expect(am.body.reissueEntryId).toBeTruthy();
    expect(am.body.after.conditions.nationalities).toEqual(['سعودي', 'يمني']);
    // الطلب الثاني (يمني مقيم) أصبح مقبولًا على الدفعة الجديدة
    const al = await http.post(`${OPS}/support/allocate`).set(as(admin)).send({ requestId: ids.req2, batchId: am.body.newBatchId, amount: 900 }).expect(201);
    expect(al.body.status).toBe('reserved');
    const journal = await http.get(`/api/fundraising/journal?opportunityId=${ids.opp}`).set(as(admin)).expect(200);
    const entries = Array.isArray(journal.body) ? journal.body : journal.body.items;
    expect(entries.some((e: { description: string }) => e.description.startsWith('قيد عكسي'))).toBe(true);
  });

  it('shows the project page, the dashboard and the reports', async () => {
    const page = await http.get(`${P}/${ids.a}`).set(as(admin)).expect(200);
    expect(page.body.summary).toMatchObject({ funds: 9000, spent: 1000, reserved: 900, transfersOut: 3000, available: 7100 });
    expect(page.body.donors[0]).toMatchObject({ name: 'مؤسسة الوفاء' });
    expect(page.body.entries.length).toBeGreaterThan(0);
    expect(page.body.requests).toHaveLength(2);
    const dash = await http.get(`${P}/dashboard`).set(as(admin)).expect(200);
    const a = dash.body.projects.find((p: { id: string }) => p.id === ids.a);
    expect(a).toMatchObject({ axisName: 'الصحة', programName: 'العلاج', spent: 1000, reserved: 900 });
    expect(dash.body.monthly.length).toBeGreaterThan(0);
    const list = await http.get(`${OPS}/reports`).set(as(admin)).expect(200);
    for (const r of list.body) {
      const rep = await http.get(`${OPS}/reports/${r.key}`).set(as(admin)).expect(200);
      expect(rep.body.columns.length).toBeGreaterThan(0);
    }
    const fin = await http.get(`${OPS}/reports/financial`).set(as(admin)).expect(200);
    expect(fin.body.totals.spent).toBe(2800);
    await http.get(`${OPS}/reports/nothing`).set(as(admin)).expect(400);
  });
});
