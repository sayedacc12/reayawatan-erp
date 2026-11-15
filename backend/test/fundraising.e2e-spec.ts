import { Test } from '@nestjs/testing';
import { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/main';
import { FundraisingService } from '../src/modules/fundraising/fundraising.service';
import { LedgerService } from '../src/modules/fundraising/ledger.service';

/** الموارد المالية: الداعمون، فرص التبرع وتوزيعها، الزكاة، مراحل الاعتماد، القيود، الوعود، والدفعات */
const DB = process.env.TEST_DATABASE_URL ?? 'postgres://erp:erp@localhost:5432/charity_erp_test';

describe('Fundraising', () => {
  let app: NestExpressApplication;
  let http: ReturnType<typeof request>;
  let db: DataSource;
  let admin: string;
  let other: string;
  let approver: string;
  let orgId: string;
  const as = (t: string) => ({ Authorization: `Bearer ${t}` });
  const login = async (login: string, password: string, organization?: string) =>
    (await http.post('/api/auth/login').send({ login, password, organization }).expect(200)).body.accessToken as string;
  const ids: Record<string, string> = {};

  beforeAll(async () => {
    Object.assign(process.env, { DATABASE_URL: DB, JWT_SECRET: 'test-secret', PLATFORM_ADMIN_EMAIL: 'platform@test.org', PLATFORM_ADMIN_PASSWORD: 'Platform123' });
    const reset = new DataSource({ type: 'postgres', url: DB });
    await reset.initialize();
    await reset.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
    await reset.destroy();
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(moduleRef.createNestApplication<NestExpressApplication>());
    await app.init();
    http = request(app.getHttpServer());
    db = app.get(DataSource);
    const platform = await login('admin', 'Platform123');
    for (const slug of ['alkhair', 'other']) {
      await http.post('/api/platform/organizations').set(as(platform)).send({
        name: `جمعية ${slug}`, slug, adminFullName: 'مدير', adminEmail: `${slug}@test.org`, adminPassword: 'Admin12345',
      }).expect(201);
    }
    admin = await login('alkhair@test.org', 'Admin12345', 'alkhair');
    other = await login('other@test.org', 'Admin12345', 'other');
    [{ id: orgId }] = await db.query("SELECT id FROM organizations WHERE slug = 'alkhair'");
  });

  afterAll(async () => {
    await db.destroy();
    await app.close();
  });

  it('configures banks, levels, managers, waqf, donor fields and approval stages', async () => {
    const bank = await http.post('/api/fundraising/settings/banks').set(as(admin))
      .send({ bankName: 'مصرف الراجحي', accountNumber: '123456789', iban: 'SA0380000000608010167519', glCode: '1121', glName: 'بنك الراجحي - التبرعات' }).expect(201);
    ids.bank = bank.body.id;
    await http.post('/api/fundraising/settings/banks').set(as(admin)).send({ bankName: 'مكرر', accountNumber: '123456789' }).expect(409);
    await http.post('/api/fundraising/settings/banks').set(as(admin)).send({ bankName: 'خطأ', accountNumber: '999999', iban: 'EG12' }).expect(400);
    ids.level = (await http.post('/api/fundraising/settings/levels').set(as(admin)).send({ name: 'ماسي', color: '#60a5fa', minAmount: 100000 }).expect(201)).body.id;
    ids.manager = (await http.post('/api/fundraising/settings/managers').set(as(admin)).send({ name: 'شركة تنمية', kind: 'external', entityName: 'مؤسسة خارجية' }).expect(201)).body.id;
    await http.post('/api/fundraising/settings/managers').set(as(admin)).send({ name: 'بدون جهة', kind: 'external' }).expect(400);
    ids.waqf = (await http.post('/api/fundraising/settings/waqf').set(as(admin)).send({ name: 'وقف العمارة السكنية' }).expect(201)).body.id;

    await http.put('/api/fundraising/settings/general').set(as(admin)).send({
      donorFields: [
        { label: 'جوال المسؤول', type: 'mobile', required: true },
        { label: 'نسبة الخصم', type: 'percent' },
        { label: 'القطاع', type: 'select', options: ['تجاري', 'حكومي'] },
      ],
    }).expect(200);
    const s = await http.get('/api/fundraising/settings').set(as(admin)).expect(200);
    expect(s.body.donorFields).toHaveLength(3);
    expect(s.body.journalRouting.credit.zakat.code).toBe('4130');

    const role = await http.post('/api/roles').set(as(admin)).send({
      name: 'مدير تنمية الموارد', permissions: ['fundraising.opportunities.read', 'fundraising.opportunities.process'],
    }).expect(201);
    await http.post('/api/users').set(as(admin)).send({ fullName: 'معتمد الفرص', email: 'ap@test.org', password: 'Approve123', roleIds: [role.body.id] }).expect(201);
    approver = await login('ap@test.org', 'Approve123', 'alkhair');
    const stages = await http.put('/api/fundraising/settings/stages').set(as(admin)).send({
      stages: [{ name: 'مراجعة تنمية الموارد' }, { name: 'اعتماد المدير المالي', roleId: role.body.id }],
    }).expect(200);
    expect(stages.body.map((x: { name: string }) => x.name)).toEqual(['مراجعة تنمية الموارد', 'اعتماد المدير المالي']);
  });

  it('validates donor custom fields and numbers donors', async () => {
    const field = (await http.get('/api/fundraising/settings').set(as(admin))).body.donorFields as { key: string; label: string }[];
    const [mobile, pct] = field;
    await http.post('/api/fundraising/donors').set(as(admin)).send({ name: 'شركة البر', type: 'entity', customData: {} }).expect(400);
    await http.post('/api/fundraising/donors').set(as(admin)).send({ name: 'شركة البر', type: 'entity', customData: { [mobile.key]: '0551234567', [pct.key]: 140 } }).expect(400);
    const d = await http.post('/api/fundraising/donors').set(as(admin)).send({
      name: 'شركة البر', type: 'entity', identifier: '7001234567', levelId: ids.level, supportManagerId: ids.manager,
      customData: { [mobile.key]: '0551234567', [pct.key]: 10 },
    }).expect(201);
    expect(d.body.donorNo).toBe(1);
    ids.donor = d.body.id;
    await http.post('/api/fundraising/donors').set(as(admin)).send({ name: 'مكرر', type: 'entity', identifier: '7001234567', customData: { [mobile.key]: '0551234567' } }).expect(409);
    ids.donor2 = (await http.post('/api/fundraising/donors').set(as(admin)).send({ name: 'عبدالله المحسن', type: 'individual', customData: { [mobile.key]: '0501111111' } }).expect(201)).body.id;
    await http.get(`/api/fundraising/donors/${ids.donor}`).set(as(other)).expect(404);
  });

  it('builds activities with funding attributes', async () => {
    const mk = async (body: object) => (await http.post('/api/beneficiaries/settings/activities').set(as(admin)).send(body).expect(201)).body.id as string;
    ids.axis = await mk({ level: 'axis', name: 'الرعاية الصحية' });
    ids.program = await mk({ level: 'program', name: 'علاج المرضى', parentId: ids.axis });
    ids.zakatProject = await mk({ level: 'project', name: 'الغسيل الكلوي', parentId: ids.program });
    ids.plainProject = await mk({ level: 'project', name: 'التوعية الصحية', parentId: ids.program });
    ids.opProject = await mk({ level: 'project', name: 'رواتب الإدارة', parentId: ids.program });
    // يملكها نظام إدارة المشاريع؛ هنا نضبطها مباشرة للاختبار
    await db.query('UPDATE activities SET zakat_eligible = true WHERE id = $1', [ids.zakatProject]);
    await db.query("UPDATE activities SET funding_type = 'operational' WHERE id = $1", [ids.opProject]);
    const t = await http.get('/api/fundraising/targets').set(as(admin)).expect(200);
    expect(t.body.programs.map((p: { name: string }) => p.name)).toEqual(expect.arrayContaining(['علاج المرضى', 'الغسيل الكلوي', 'التوعية الصحية']));
    expect(t.body.operational.map((p: { name: string }) => p.name)).toEqual(['رواتب الإدارة']);
    expect(t.body.programs.find((p: { id: string }) => p.id === ids.zakatProject).path).toBe('الرعاية الصحية ← علاج المرضى ← الغسيل الكلوي');
  });

  const base = () => ({
    kind: 'cash', donorId: ids.donor, supportManagerId: ids.manager, date: '2026-11-10', totalAmount: 100000, bankAccountId: ids.bank,
    transferReference: 'TRX-1', conditions: { acceptsPatientContribution: true, maxSpend: 5000, nationalities: ['سعودي'], categories: ['citizen', 'resident'], endDate: '2027-06-30' },
    conditionsText: 'تقرير ربع سنوي للداعم',
  });

  it('enforces distribution rules: sum, bank, zakat', async () => {
    const post = (body: object) => http.post('/api/fundraising/opportunities').set(as(admin)).send(body);
    let r = await post({ ...base(), lines: [{ targetKind: 'program', activityId: ids.plainProject, mode: 'amount', amount: 60000 }] }).expect(400);
    expect(r.body.message).toContain('يجب أن يساوي إجمالي التبرع');
    await post({ ...base(), bankAccountId: null, lines: [{ targetKind: 'operational', mode: 'amount', amount: 100000 }] }).expect(400);
    r = await post({ ...base(), isZakat: true, lines: [{ targetKind: 'program', activityId: ids.plainProject, mode: 'percent', percent: 100 }] }).expect(400);
    expect(r.body.message).toContain('مصارف الزكاة');
    r = await post({ ...base(), isZakat: true, lines: [{ targetKind: 'program', activityId: ids.program, mode: 'percent', percent: 100 }] }).expect(400);
    await post({ ...base(), isZakat: true, lines: [{ targetKind: 'program', activityId: ids.zakatProject, mode: 'amount', amount: 90000 }, { targetKind: 'operational', mode: 'amount', amount: 10000 }] }).expect(400);
    await post({ ...base(), lines: [{ targetKind: 'operational', activityId: ids.plainProject, mode: 'amount', amount: 100000 }] }).expect(400);
    await post({ ...base(), lines: [{ targetKind: 'program', activityId: ids.opProject, mode: 'amount', amount: 100000 }] }).expect(400);
  });

  it('creates a split opportunity, generates batches, and runs the approval stages', async () => {
    const r = await http.post('/api/fundraising/opportunities').set(as(admin)).send({
      ...base(), totalAmount: 100000, lines: [
        { targetKind: 'program', activityId: ids.plainProject, mode: 'percent', percent: 33.333 },
        { targetKind: 'operational', mode: 'percent', percent: 33.333 },
        { targetKind: 'waqf', waqfProjectId: ids.waqf, mode: 'percent', percent: 33.334 },
      ],
    }).expect(201);
    ids.opp = r.body.id;
    expect(r.body.opportunityNo).toBe(1);
    expect(r.body.status).toBe('in_progress');
    expect(r.body.stageName).toBe('مراجعة تنمية الموارد');
    expect(r.body.batches).toHaveLength(3);
    expect(r.body.batches.reduce((s: number, b: { amount: number }) => s + b.amount, 0)).toBe(100000);
    expect(r.body.batches.every((b: { status: string }) => b.status === 'pending')).toBe(true);
    expect(r.body.batches[0].conditions.categories).toEqual(['citizen', 'resident']);

    await http.post(`/api/fundraising/opportunities/${ids.opp}/decision`).set(as(admin)).send({ decision: 'return' }).expect(400);
    let d = await http.post(`/api/fundraising/opportunities/${ids.opp}/decision`).set(as(admin)).send({ decision: 'return', notes: 'أرفق الاتفاقية' }).expect(200);
    expect(d.body.status).toBe('returned');

    // التعديل بعد الإرجاع يعيد التقديم لأول مرحلة بدفعات جديدة
    const e = await http.put(`/api/fundraising/opportunities/${ids.opp}`).set(as(admin)).send({
      ...base(), lines: [
        { targetKind: 'program', activityId: ids.plainProject, mode: 'amount', amount: 70000 },
        { targetKind: 'operational', mode: 'amount', amount: 30000 },
      ],
    }).expect(200);
    expect(e.body.status).toBe('in_progress');
    expect(e.body.batches.map((b: { batchNo: number }) => b.batchNo)).toEqual([1, 2]);

    d = await http.post(`/api/fundraising/opportunities/${ids.opp}/decision`).set(as(admin)).send({ decision: 'approve' }).expect(200);
    expect(d.body.stageName).toBe('اعتماد المدير المالي');
    expect(d.body.canDecide).toBe(true); // مدير النظام
    await http.put(`/api/fundraising/opportunities/${ids.opp}`).set(as(admin)).send({ ...base(), lines: [{ targetKind: 'operational', mode: 'amount', amount: 100000 }] }).expect(400);
    // طلب تعديل من المرحلة الثانية يعيدها للأولى
    d = await http.post(`/api/fundraising/opportunities/${ids.opp}/decision`).set(as(approver)).send({ decision: 'return', notes: 'راجع المبلغ' }).expect(200);
    expect(d.body.stageName).toBe('مراجعة تنمية الموارد');
    await http.post(`/api/fundraising/opportunities/${ids.opp}/decision`).set(as(admin)).send({ decision: 'approve' }).expect(200);
    d = await http.post(`/api/fundraising/opportunities/${ids.opp}/decision`).set(as(approver)).send({ decision: 'approve', notes: 'معتمد' }).expect(200);
    expect(d.body.status).toBe('approved');
    expect(d.body.receiptNo).toBe(1);
    expect(d.body.batches.every((b: { status: string }) => b.status === 'active')).toBe(true);
    expect(d.body.actions.map((a: { action: string }) => a.action)).toEqual(
      ['created', 'return', 'resubmitted', 'approve', 'return', 'approve', 'approve', 'approved_final'],
    );
    // القيد: البنك مدين بالإجمالي، والإيرادات دائنة حسب كل بند
    const [entry] = d.body.entries;
    expect(entry.total).toBe(100000);
    const lines = entry.lines.map((l: { accountCode: string; debit: number; credit: number }) => [l.accountCode, l.debit, l.credit]);
    expect(lines).toEqual([['1121', 100000, 0], ['4120', 0, 70000], ['4110', 0, 30000]]);
    const receipt = await http.get(`/api/fundraising/opportunities/${ids.opp}/receipt`).set(as(admin)).expect(200);
    expect(receipt.body).toMatchObject({ receiptNo: 1, amount: 100000, bankName: 'مصرف الراجحي' });
  });

  it('rejects with a reason and cancels the batches', async () => {
    const r = await http.post('/api/fundraising/opportunities').set(as(admin)).send({
      ...base(), donorId: ids.donor2, totalAmount: 5000, isZakat: true,
      lines: [{ targetKind: 'program', activityId: ids.zakatProject, mode: 'amount', amount: 5000 }],
    }).expect(201);
    await http.post(`/api/fundraising/opportunities/${r.body.id}/decision`).set(as(admin)).send({ decision: 'reject' }).expect(400);
    const d = await http.post(`/api/fundraising/opportunities/${r.body.id}/decision`).set(as(admin)).send({ decision: 'reject', notes: 'التحويل لم يصل' }).expect(200);
    expect(d.body.status).toBe('rejected');
    expect(d.body.batches[0].status).toBe('cancelled');
    expect(d.body.entries).toHaveLength(0);
  });

  it('records a pledge, posts receivable entries, and collects in parts', async () => {
    await db.query('DELETE FROM fundraising_approval_stages');
    const r = await http.post('/api/fundraising/opportunities').set(as(admin)).send({
      ...base(), kind: 'pledge', bankAccountId: null, totalAmount: 20000, isZakat: true,
      lines: [{ targetKind: 'program', activityId: ids.zakatProject, mode: 'amount', amount: 20000 }],
    }).expect(201);
    expect(r.body.status).toBe('approved'); // بدون مراحل = اعتماد مباشر
    expect(r.body.receiptNo).toBeNull();
    expect(r.body.batches[0]).toMatchObject({ isPromised: true, isZakat: true, status: 'active' });
    expect(r.body.entries[0].lines.map((l: { accountCode: string }) => l.accountCode)).toEqual(['1150', '4130']);
    ids.pledge = r.body.id;
    ids.zakatBatch = r.body.batches[0].id;
    await http.post(`/api/fundraising/opportunities/${ids.pledge}/collections`).set(as(admin)).send({ date: '2026-11-12', amount: 25000, bankAccountId: ids.bank }).expect(400);
    let c = await http.post(`/api/fundraising/opportunities/${ids.pledge}/collections`).set(as(admin)).send({ date: '2026-11-12', amount: 15000, bankAccountId: ids.bank }).expect(201);
    expect(c.body.collectedAmount).toBe(15000);
    expect(c.body.collections[0].receiptNo).toBe(2);
    c = await http.post(`/api/fundraising/opportunities/${ids.pledge}/collections`).set(as(admin)).send({ date: '2026-11-13', amount: 5000, bankAccountId: ids.bank }).expect(201);
    expect(c.body.batches[0].isPromised).toBe(false);
    expect(c.body.entries).toHaveLength(3);
    await http.get(`/api/fundraising/opportunities/${ids.pledge}/receipt?collection=${c.body.collections[1].id}`).set(as(admin)).expect(200);
  });

  it('reserves, spends and transfers batch balances for the projects module', async () => {
    const svc = app.get(FundraisingService);
    const batches = await svc.listBatches(orgId, { activityIds: [ids.plainProject] });
    const b = batches[0];
    expect(b.amount).toBe(70000);
    await svc.reserve(orgId, b.id, 10000);
    await expect(svc.reserve(orgId, b.id, 60001)).rejects.toThrow();
    await svc.spend(orgId, b.id, 4000);
    await expect(svc.spend(orgId, b.id, 7000)).rejects.toThrow();
    await svc.release(orgId, b.id, 6000);
    const child = await svc.transfer(orgId, b.id, ids.program, 20000);
    expect(child.parentBatchId).toBe(b.id);
    await expect(svc.transfer(orgId, b.id, ids.opProject, 1000)).rejects.toThrow('مقيد');
    await expect(svc.transfer(orgId, ids.zakatBatch, ids.plainProject, 1000)).rejects.toThrow('الزكاة');
    const after = await svc.getBatch(orgId, b.id);
    expect(after).toMatchObject({ reservedAmount: 0, spentAmount: 4000, transferredAmount: 20000, net: 46000 });
    expect(after.children).toHaveLength(1);
    const amended = await svc.transfer(orgId, b.id, ids.program, 1000, undefined, { maxSpend: 9000 });
    expect(amended.conditions.maxSpend).toBe(9000);
    expect(amended.conditions.nationalities).toEqual(['سعودي']);
  });

  it('reverses ledger entries and serves dashboard and reports', async () => {
    const ledger = app.get(LedgerService);
    const [orig] = await ledger.listEntries(orgId, { opportunityId: ids.opp });
    const rev = await ledger.reverseEntry(orgId, orig.id, 'اختبار');
    const [check] = await ledger.listEntries(orgId, { batchId: (await ledger.listEntries(orgId, { opportunityId: ids.opp }))[0].lines![1].batchId! });
    expect(check.id).toBe(rev.id);
    await expect(ledger.reverseEntry(orgId, orig.id, 'مرة ثانية')).rejects.toThrow('معكوس');
    await expect(ledger.postEntry(orgId, { date: '2026-11-15', description: 'x', source: { module: 't', type: 't' }, lines: [
      { accountCode: '1', accountName: 'أ', debit: 10, credit: 0 }, { accountCode: '2', accountName: 'ب', debit: 0, credit: 9 },
    ] })).rejects.toThrow('غير متوازن');
    const entries = await http.get('/api/fundraising/journal').set(as(admin)).expect(200);
    expect(entries.body.length).toBeGreaterThanOrEqual(5);
    const dash = await http.get('/api/fundraising/dashboard?from=2026-11-01&to=2026-11-30').set(as(admin)).expect(200);
    expect(dash.body.current.total).toBe(120000);
    expect(dash.body.current.zakat).toBe(20000);
    expect(dash.body.bucket).toBe('day');
    expect(dash.body.pipeline.pledgeOutstanding).toBe(0);
    for (const name of ['by-target', 'pledges', 'banks', 'zakat', 'managers', 'levels', 'donors', 'batches']) {
      await http.get(`/api/fundraising/reports/${name}?from=2026-01-01&to=2026-12-31`).set(as(admin)).expect(200);
    }
    const banks = await http.get('/api/fundraising/reports/banks?from=2026-01-01&to=2026-12-31').set(as(admin)).expect(200);
    expect(banks.body.rows[0]).toMatchObject({ donations: 100000, pledgeCollections: 20000, total: 120000 });
    await http.get('/api/fundraising/reports/nope').set(as(admin)).expect(400);
    await http.get('/api/fundraising/dashboard').set(as(approver)).expect(403);
    const other_ = await http.get('/api/fundraising/opportunities').set(as(other)).expect(200);
    expect(other_.body.total).toBe(0);
  });
});
