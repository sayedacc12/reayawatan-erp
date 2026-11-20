import { Test } from '@nestjs/testing';
import { NestExpressApplication } from '@nestjs/platform-express';
import * as bcrypt from 'bcryptjs';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/main';

const DB = process.env.TEST_DATABASE_URL ?? 'postgres://erp:erp@localhost:5432/charity_erp_test';
const day = (n: number) => new Date(Date.now() + 3 * 3600_000 + n * 86400_000).toISOString().slice(0, 10);
const today = day(0);
const inHours = (h: number) => new Date(Date.now() + h * 3600_000).toISOString();

jest.setTimeout(120_000);

/** المرحلة الخامسة: العقود والملاحق والجزاءات، وتقييم الموردين، والرقابة ومؤشرات الأداء، وبوابة المورد */
describe('Procurement stage 5: contracts, supplier evaluation, controls and KPIs', () => {
  let app: NestExpressApplication;
  let http: ReturnType<typeof request>;
  let db: DataSource;
  let uploadDir: string;
  let org: string;
  const tok: Record<string, string> = {};
  const ids: Record<string, string> = {};
  const as = (t: string) => ({ Authorization: `Bearer ${t}` });
  const login = async (login: string, password: string, organization?: string) =>
    (await http.post('/api/auth/login').send({ login, password, organization }).expect(200)).body.accessToken as string;
  const PR = '/api/procurement';
  const A = '/api/accounting';
  const SP = '/api/supplier-portal';

  const approvedRequest = async (title: string, qty: number, price: number, method = 'direct') => {
    const r = (await http.post(`${PR}/requests`).set(as(tok.buyer)).send({
      title, kind: 'goods', priority: 'normal', neededBy: day(10), method, budgetLineId: ids.line,
      lines: [{ itemId: ids.blanket, description: 'بطانية شتوية', qty, uomId: ids.piece, estPrice: price }],
    }).expect(201)).body;
    await http.post(`${PR}/requests/${r.id}/submit`).set(as(tok.buyer)).send({ confirmDuplicate: true }).expect(200);
    await http.post(`${PR}/requests/${r.id}/approve`).set(as(tok.approver)).send({}).expect(200);
    return r as { id: string; lines: { id: string; qty: number; estPrice: number }[] };
  };
  const orderBody = (r: { id: string; lines: { id: string; qty: number; estPrice: number }[] }, extra: object = {}) => ({
    requestId: r.id, supplierId: ids.supplier, vatRate: 15, deliveryDate: day(5),
    lines: r.lines.map((l) => ({ lineId: l.id, qty: l.qty, unitPrice: l.estPrice })), ...extra,
  });

  beforeAll(async () => {
    uploadDir = mkdtempSync(join(tmpdir(), 'sanabel-uploads-'));
    Object.assign(process.env, {
      DATABASE_URL: DB, JWT_SECRET: 'test-secret', UPLOAD_DIR: uploadDir, PLATFORM_ADMIN_EMAIL: 'platform@test.org', PLATFORM_ADMIN_PASSWORD: 'Platform123',
    });
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
    org = (await http.post('/api/platform/organizations').set(as(platform)).send({
      name: 'جمعية العقود', slug: 'oqood', adminFullName: 'مدير النظام', adminEmail: 'admin@oqood.org', adminPassword: 'Admin12345',
    }).expect(201)).body.id;
    tok.admin = await login('admin@oqood.org', 'Admin12345', 'oqood');
    await http.post('/api/platform/organizations').set(as(platform)).send({
      name: 'جمعية أخرى', slug: 'other', adminFullName: 'مدير آخر', adminEmail: 'admin@other.org', adminPassword: 'Admin12345',
    }).expect(201);
    tok.other = await login('admin@other.org', 'Admin12345', 'other');

    const Y = Number(today.slice(0, 4));
    await http.post(`${A}/chart/install`).set(as(tok.admin)).expect(201);
    await http.post(`${A}/setup`).set(as(tok.admin)).send({
      fiscalYear: Y, startDate: `${Y}-01-01`, endDate: `${Y}-12-31`, isFirstYear: true, firstYearStart: `${Y}-01-01`, firstYearEnd: `${Y}-12-31`,
    }).expect(201);

    const role = async (name: string, permissions: string[]) => (await http.post('/api/roles').set(as(tok.admin)).send({ name, permissions }).expect(201)).body.id;
    const user = async (key: string, fullName: string, roleId: string) => {
      const u = await http.post('/api/users').set(as(tok.admin)).send({ fullName, email: `${key}@oqood.org`, password: 'Staff12345', roleIds: [roleId] }).expect(201);
      ids[`user_${key}`] = u.body.id;
      tok[key] = await login(`${key}@oqood.org`, 'Staff12345', 'oqood');
    };
    await user('buyer', 'مسؤول المشتريات', await role('مشتريات', ['procurement.dashboard.read', 'procurement.sourcing.manage', 'procurement.requests.create', 'procurement.suppliers.read']));
    await user('approver', 'مدير المشتريات', await role('معتمد', [
      'procurement.orders.approve', 'procurement.requests.approve', 'procurement.dashboard.read', 'procurement.contracts.approve', 'procurement.evaluations.approve',
    ]));
    // مسؤول العقود يملك الإدارة والاعتماد معًا، لاختبار فصل المهام
    await user('lead', 'مسؤول العقود', await role('عقود', ['procurement.dashboard.read', 'procurement.contracts.manage', 'procurement.contracts.approve', 'procurement.suppliers.read']));
    await user('evaluator', 'مقيّم الموردين', await role('تقييم', ['procurement.evaluations.manage', 'procurement.evaluations.approve', 'procurement.suppliers.read']));
    await user('keeper', 'أمين المستودع', await role('أمين مستودع', ['procurement.dashboard.read', 'procurement.stock.operate']));

    const lk = (await http.get(`${PR}/lookups`).set(as(tok.admin)).expect(200)).body;
    const grp = (c: string) => lk.groups.find((g: { code: string }) => g.code === c).id;
    ids.piece = lk.uoms.find((u: { name: string }) => u.name === 'حبة').id;
    ids.blanket = (await http.post(`${PR}/items`).set(as(tok.admin)).send({ name: 'بطانية شتوية', groupId: grp('AID'), uomId: ids.piece }).expect(201)).body.id;

    const sup = async (no: number, name: string, email: string, status = 'approved') =>
      (await db.query(`INSERT INTO pr_suppliers (organization_id, supplier_no, name, status, email, created_by_name) VALUES ($1, $2, $3, $4, $5, 'اختبار') RETURNING id`,
        [org, no, name, status, email]))[0].id as string;
    ids.supplier = await sup(1, 'مؤسسة الدفء', 'dafa@vendor.sa');
    ids.rival = await sup(2, 'مؤسسة النور', 'noor@vendor.sa');
    ids.pending = await sup(3, 'مورد تحت التسجيل', 'new@vendor.sa', 'submitted');
    const hash = await bcrypt.hash('Supplier123', 10);
    await db.query(`INSERT INTO pr_supplier_users (organization_id, supplier_id, full_name, email, role, password_hash) VALUES ($1, $2, 'مالك الدفء', 'dafa@vendor.sa', 'owner', $3), ($1, $4, 'مالك النور', 'noor@vendor.sa', 'owner', $3)`,
      [org, ids.supplier, hash, ids.rival]);
    tok.dafa = (await http.post(`${SP}/o/oqood/login`).send({ email: 'dafa@vendor.sa', password: 'Supplier123' }).expect(200)).body.accessToken;
    tok.noor = (await http.post(`${SP}/o/oqood/login`).send({ email: 'noor@vendor.sa', password: 'Supplier123' }).expect(200)).body.accessToken;
    const [b] = await db.query(`INSERT INTO plan_budgets (organization_id, code, title, fiscal_year, status, version, created_by_name) VALUES ($1, 'BG-001', 'الموازنة', $2, 'approved', 1, 'اختبار') RETURNING id`, [org, Y]);
    ids.line = (await db.query(`INSERT INTO plan_budget_lines (organization_id, budget_id, section, kind, name, amount) VALUES ($1, $2, 'opex', 'manual', 'كسوة الشتاء', 500000) RETURNING id`, [org, b.id]))[0].id;
  });

  afterAll(async () => {
    await app?.get(DataSource).destroy();
    await app?.close();
    rmSync(uploadDir, { recursive: true, force: true });
  });

  const contractBody = (extra: object = {}) => ({
    kind: 'framework', supplierId: ids.supplier, reference: 'FA-2026-01', title: 'اتفاقية توريد البطانيات', scope: 'توريد بطانيات شتوية حسب الطلب',
    startsOn: day(-1), endsOn: day(60), value: 10000, alertPct: 80, alertDays: 30,
    prices: [{ itemId: ids.blanket, description: 'بطانية شتوية', unit: 'حبة', unitPrice: 100, maxQty: 200 }],
    guarantees: [{ kind: 'final', amount: 500, ref: 'LG-77', issuer: 'مصرف الراجحي', expiresOn: day(90) }],
    slas: [{ name: 'التسليم خلال 5 أيام', target: 95, unit: '%', direction: 'min' }],
    penaltyRules: [{ name: 'غرامة التأخير', basis: 'per_day', rate: 100, capPct: 5 }],
    requiredDocs: ['خطاب الضمان النهائي'], ...extra,
  });

  it('enforces approval, segregation of duties and validates the supplier', async () => {
    await http.post(`${PR}/contracts`).set(as(tok.lead)).send(contractBody({ supplierId: ids.pending })).expect(409);
    await http.post(`${PR}/contracts`).set(as(tok.lead)).send(contractBody({ endsOn: day(-5) })).expect(400);
    const c = (await http.post(`${PR}/contracts`).set(as(tok.lead)).send(contractBody()).expect(200)).body;
    expect(c).toMatchObject({ code: 'CT-0001', status: 'draft', value: 10000 });
    ids.contract = c.id;
    await http.post(`${PR}/contracts/${c.id}/submit`).set(as(tok.lead)).send({}).expect(200);
    // من أعدّ العقد لا يعتمده، والمشتريات بلا صلاحية لا تعتمد
    await http.post(`${PR}/contracts/${c.id}/approve`).set(as(tok.lead)).send({}).expect(403);
    await http.post(`${PR}/contracts/${c.id}/approve`).set(as(tok.buyer)).send({}).expect(403);
    const ok = (await http.post(`${PR}/contracts/${c.id}/approve`).set(as(tok.approver)).send({ note: 'مطابق للترسية' }).expect(200)).body;
    expect(ok.status).toBe('active');
    const sc = (await http.get(`${PR}/suppliers/${ids.supplier}/contracts`).set(as(tok.buyer)).expect(200)).body;
    expect(sc.map((x: { id: string }) => x.id)).toEqual([c.id]);
  });

  it('caps orders issued under the contract at its remaining value', async () => {
    // 100 × 100 + 15% = 11,500 فوق قيمة العقد 10,000
    const big = await approvedRequest('بطانيات كثيرة', 100, 100);
    await http.post(`${PR}/orders`).set(as(tok.buyer)).send(orderBody(big, { contractId: ids.contract })).expect(409);
    // مورد آخر غير مورد العقد
    await http.post(`${PR}/orders`).set(as(tok.buyer)).send(orderBody(big, { contractId: ids.contract, supplierId: ids.rival })).expect(400);
    const r1 = await approvedRequest('دفعة أولى', 50, 100);
    const o1 = (await http.post(`${PR}/orders`).set(as(tok.buyer)).send(orderBody(r1, { contractId: ids.contract })).expect(201)).body;
    await http.post(`${PR}/orders/${o1.id}/submit`).set(as(tok.buyer)).send({}).expect(200);
    const issued = (await http.post(`${PR}/orders/${o1.id}/approve`).set(as(tok.approver)).send({}).expect(200)).body;
    expect(issued.contract).toMatchObject({ id: ids.contract, used: 5750 });
    ids.order = o1.id;
    // الباقي 4,250، والدفعة الثانية 4,600
    const r2 = await approvedRequest('دفعة ثانية', 40, 100);
    await http.post(`${PR}/orders`).set(as(tok.buyer)).send(orderBody(r2, { contractId: ids.contract })).expect(409);
    ids.req2 = r2.id;
    const c = (await http.get(`${PR}/contracts/${ids.contract}`).set(as(tok.lead)).expect(200)).body;
    expect(c.used).toBe(5750);
    expect(c.orders.map((x: { id: string }) => x.id)).toEqual([o1.id]);
  });

  it('applies amendments only after approval by someone else', async () => {
    // التخفيض دون المستخدم من العقد مرفوض
    await http.post(`${PR}/contracts/${ids.contract}/amendments`).set(as(tok.lead)).send({ kind: 'value', reason: 'تخفيض القيمة', value: 5000 }).expect(409);
    await http.post(`${PR}/contracts/${ids.contract}/amendments`).set(as(tok.lead)).send({ kind: 'value', reason: 'زيادة الكميات للموسم', value: 20000 }).expect(200);
    await http.post(`${PR}/contracts/${ids.contract}/amendments`).set(as(tok.lead)).send({ kind: 'extension', reason: 'ملحق ثانٍ', endsOn: day(90) }).expect(409);
    await http.post(`${PR}/contracts/${ids.contract}/amendments/1/decide`).set(as(tok.lead)).send({ decision: 'approve' }).expect(403);
    const c = (await http.post(`${PR}/contracts/${ids.contract}/amendments/1/decide`).set(as(tok.approver)).send({ decision: 'approve' }).expect(200)).body;
    expect(c).toMatchObject({ value: 20000, version: 2 });
    // الآن تتسع الدفعة الثانية
    const r2 = (await http.get(`${PR}/requests/${ids.req2}`).set(as(tok.buyer)).expect(200)).body;
    await http.post(`${PR}/orders`).set(as(tok.buyer)).send(orderBody(r2, { contractId: ids.contract })).expect(201);
  });

  it('computes penalties from the rule and enforces their cap', async () => {
    // 3 أيام × 100 = 300، والسقف 5% من 20,000 = 1,000
    const c = (await http.post(`${PR}/contracts/${ids.contract}/penalties`).set(as(tok.lead)).send({
      ruleKey: (await http.get(`${PR}/contracts/${ids.contract}`).set(as(tok.lead)).expect(200)).body.penaltyRules[0].key,
      date: today, days: 3, reason: 'تأخر توريد الدفعة الأولى', orderId: ids.order,
    }).expect(200)).body;
    const p = c.penalties[0];
    expect(p).toMatchObject({ amount: 300, status: 'pending' });
    await http.post(`${PR}/contracts/${ids.contract}/penalties`).set(as(tok.lead)).send({ ruleKey: p.ruleKey, date: today, days: 8, reason: 'تأخر آخر طويل' }).expect(409);
    await http.post(`${PR}/contracts/${ids.contract}/penalties/${p.id}/decide`).set(as(tok.lead)).send({ decision: 'approve' }).expect(403);
    const d = (await http.post(`${PR}/contracts/${ids.contract}/penalties/${p.id}/decide`).set(as(tok.approver)).send({ decision: 'approve' }).expect(200)).body;
    expect(d.penalties[0].status).toBe('approved');
    const sla = d.slas[0].key;
    const k = (await http.post(`${PR}/contracts/${ids.contract}/kpis`).set(as(tok.lead)).send({ slaKey: sla, period: today.slice(0, 7), value: 90 }).expect(200)).body;
    expect(k.kpiReadings[0]).toMatchObject({ value: 90, met: false });
  });

  it('scores the supplier, approves by another person and updates the supplier grade', async () => {
    const from = `${today.slice(0, 4)}-01-01`;
    await http.post(`${PR}/evaluations`).set(as(tok.evaluator)).send({ supplierId: ids.supplier, kind: 'periodic', periodFrom: from, periodTo: day(3) }).expect(400);
    const e = (await http.post(`${PR}/evaluations`).set(as(tok.evaluator)).send({ supplierId: ids.supplier, kind: 'contract', contractId: ids.contract, periodFrom: from, periodTo: today }).expect(200)).body;
    expect(e).toMatchObject({ code: 'EV-0001', status: 'draft' });
    ids.eval = e.id;
    const scores = e.scores.map((s: { key: string }) => ({ key: s.key, score: 40, note: 'تأخر متكرر وضعف في الاستجابة' }));
    const u = (await http.put(`${PR}/evaluations/${e.id}`).set(as(tok.evaluator)).send({ scores, strengths: 'أسعار مناسبة' }).expect(200)).body;
    expect(u).toMatchObject({ total: 40, grade: 'D' });
    await http.post(`${PR}/evaluations/${e.id}/submit`).set(as(tok.evaluator)).send({}).expect(400);
    await http.put(`${PR}/evaluations/${e.id}`).set(as(tok.evaluator)).send({ scores, strengths: 'أسعار مناسبة', weaknesses: 'التأخير وعدم الرد' }).expect(200);
    await http.post(`${PR}/evaluations/${e.id}/submit`).set(as(tok.evaluator)).send({}).expect(200);
    await http.post(`${PR}/evaluations/${e.id}/approve`).set(as(tok.evaluator)).send({}).expect(403);
    await http.post(`${PR}/evaluations/${e.id}/approve`).set(as(tok.approver)).send({}).expect(200);
    const [s] = await db.query('SELECT grade, rating::float AS rating FROM pr_suppliers WHERE id = $1', [ids.supplier]);
    expect(s).toEqual({ grade: 'D', rating: 40 });
  });

  it('blocks weak suppliers from new competitions when the setting is on', async () => {
    const lk = (await http.get(`${PR}/evaluation-lookups`).set(as(tok.admin)).expect(200)).body;
    const criteria = lk.criteria.map((c: { key: string; name: string; weight: number; metric: string | null }) => ({ key: c.key, name: c.name, weight: c.weight, metric: c.metric }));
    await http.put(`${PR}/evaluation-settings`).set(as(tok.admin)).send({ criteria: criteria.map((c: object) => ({ ...c, weight: 10 })), gradeA: 90, gradeB: 75, gradeC: 60, blockWeak: true }).expect(400);
    await http.put(`${PR}/evaluation-settings`).set(as(tok.admin)).send({ criteria, gradeA: 90, gradeB: 75, gradeC: 60, blockWeak: true }).expect(200);
    const r = await approvedRequest('منافسة بطانيات', 10, 100, 'quotes');
    const q = (await http.post(`${PR}/rfqs`).set(as(tok.buyer)).send({
      requestId: r.id, title: 'منافسة بطانيات', method: 'quotes', closesAt: inHours(3), invitedIds: [ids.supplier, ids.rival], categoryIds: [],
      criteria: [{ key: 'price', name: 'السعر', weight: 100, kind: 'price' }], technicalPass: 60, committeeIds: [],
    }).expect(201)).body;
    const res = await http.post(`${PR}/rfqs/${q.id}/publish`).set(as(tok.buyer)).send({ fewerReason: 'موردان فقط في هذا التخصص' }).expect(400);
    expect(res.body.message).toContain('ضعيف');
  });

  it('shows the supplier its own contracts and evaluations only, and accepts one reply', async () => {
    const mine = (await http.get(`${SP}/contracts`).set(as(tok.dafa)).expect(200)).body;
    expect(mine.map((x: { id: string }) => x.id)).toEqual([ids.contract]);
    await http.get(`${SP}/contracts/${ids.contract}`).set(as(tok.dafa)).expect(200);
    expect((await http.get(`${SP}/contracts`).set(as(tok.noor)).expect(200)).body).toEqual([]);
    await http.get(`${SP}/contracts/${ids.contract}`).set(as(tok.noor)).expect(404);
    const ev = (await http.get(`${SP}/evaluations`).set(as(tok.dafa)).expect(200)).body;
    expect(ev.map((x: { id: string }) => x.id)).toEqual([ids.eval]);
    await http.post(`${SP}/evaluations/${ids.eval}/respond`).set(as(tok.noor)).send({ response: 'ليس تقييمنا' }).expect(404);
    await http.post(`${SP}/evaluations/${ids.eval}/respond`).set(as(tok.dafa)).send({ response: 'نعتذر عن التأخير', improvementPlan: 'زيادة أسطول النقل' }).expect(200);
    await http.post(`${SP}/evaluations/${ids.eval}/respond`).set(as(tok.dafa)).send({ response: 'رد ثانٍ مكرر' }).expect(409);
    // رمز البوابة لا يُقبل على مسارات الموظفين
    await http.get(`${PR}/contracts`).set(as(tok.dafa)).expect(401);
  });

  it('reports risks, control exceptions and KPIs', async () => {
    const risks = (await http.get(`${PR}/insights/risks`).set(as(tok.approver)).expect(200)).body;
    expect(risks.signals.some((s: { kind: string }) => s.kind === 'weak')).toBe(true);
    const controls = (await http.get(`${PR}/insights/controls`).set(as(tok.approver)).expect(200)).body;
    expect(controls.checks.map((c: { kind: string }) => c.kind)).toEqual(expect.arrayContaining(['override', 'duplicate', 'split', 'bank', 'penalty']));
    const kpis = (await http.get(`${PR}/insights/kpis`).set(as(tok.approver)).expect(200)).body;
    const ct = kpis.kpis.find((k: { key: string }) => k.key === 'contracts');
    expect(ct.value).toBeGreaterThan(0);
    const rep = (await http.get('/api/reports/run/procurement.contracts').set(as(tok.admin)).expect(200)).body;
    expect(rep.rows[0]).toMatchObject({ code: 'CT-0001', penalties: 300 });
    await http.get('/api/reports/run/procurement.kpis').query({ from: `${today.slice(0, 4)}-01-01`, to: today }).set(as(tok.admin)).expect(200);
    await http.get('/api/reports/run/procurement.payables-aging').set(as(tok.admin)).expect(200);
  });

  it('denies users without permission and hides other organizations', async () => {
    await http.get(`${PR}/contracts`).set(as(tok.keeper)).expect(403);
    await http.post(`${PR}/contracts`).set(as(tok.buyer)).send(contractBody()).expect(403);
    await http.get(`${PR}/evaluations`).set(as(tok.keeper)).expect(403);
    await http.get(`${PR}/insights/risks`).set(as(tok.keeper)).expect(403);
    await http.get(`${PR}/insights/kpis`).set(as(tok.keeper)).expect(200);
    await http.put(`${PR}/evaluation-settings`).set(as(tok.lead)).send({ criteria: [], gradeA: 90, gradeB: 75, gradeC: 60, blockWeak: false }).expect(403);
    await http.get(`${PR}/contracts/${ids.contract}`).set(as(tok.other)).expect(404);
    await http.post(`${PR}/contracts/${ids.contract}/submit`).set(as(tok.other)).send({}).expect(404);
    await http.get(`${PR}/evaluations/${ids.eval}`).set(as(tok.other)).expect(404);
    await http.get(`${PR}/suppliers/${ids.supplier}/contracts`).set(as(tok.other)).expect(404);
    expect((await http.get(`${PR}/contracts`).set(as(tok.other)).expect(200)).body).toHaveLength(0);
    expect((await http.get(`${PR}/evaluations`).set(as(tok.other)).expect(200)).body).toHaveLength(0);
  });
});
