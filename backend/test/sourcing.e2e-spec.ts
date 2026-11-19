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
import { PrQuote, PrRfq } from '../src/modules/procurement/entities/sourcing.entity';
import { evaluate } from '../src/modules/procurement/rfqs.service';

const DB = process.env.TEST_DATABASE_URL ?? 'postgres://erp:erp@localhost:5432/charity_erp_test';
const future = (days: number) => new Date(Date.now() + days * 86400_000).toISOString().slice(0, 10);
const inHours = (h: number) => new Date(Date.now() + h * 3600_000).toISOString();

jest.setTimeout(90_000);

describe('Sourcing evaluation', () => {
  it('scores technical criteria from the committee average and price against the lowest qualified quote', () => {
    const rfq = { technicalPass: 60, criteria: [{ key: 'price', name: 'السعر', weight: 60, kind: 'price' }, { key: 'quality', name: 'الجودة', weight: 40, kind: 'technical' }] } as PrRfq;
    const q = (id: string, total: number, scores: number[]) => ({
      id, total, status: 'submitted', scores: Object.fromEntries(scores.map((s, i) => [`u${i}`, { name: '', scores: { quality: s }, note: null, at: '' }])),
    }) as unknown as PrQuote;
    const ev = evaluate(rfq, [q('a', 1000, [90, 70]), q('b', 800, [50, 60]), q('c', 900, [70, 70])]);
    expect(ev.get('a')).toMatchObject({ technicalScore: 80, passed: true });
    // b لم يجتز الحد الفني فلا يدخل في المقارنة المالية
    expect(ev.get('b')).toMatchObject({ technicalScore: 55, passed: false, totalScore: null, rank: null });
    // أقل سعر بين المؤهلين 900: c مالي 100، و a مالي 90
    expect(ev.get('c')).toMatchObject({ financialScore: 100, totalScore: 88, rank: 1 });
    expect(ev.get('a')).toMatchObject({ financialScore: 90, totalScore: 86, rank: 2 });
  });
});

describe('Sourcing: requests, tenders, award and approval', () => {
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
  const SP = '/api/supplier-portal';

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
      name: 'جمعية الشراء', slug: 'shiraa', adminFullName: 'مدير النظام', adminEmail: 'admin@shiraa.org', adminPassword: 'Admin12345',
    }).expect(201)).body.id;
    tok.admin = await login('admin@shiraa.org', 'Admin12345', 'shiraa');
    const role = async (name: string, permissions: string[]) => (await http.post('/api/roles').set(as(tok.admin)).send({ name, permissions }).expect(201)).body.id;
    const user = async (key: string, fullName: string, roleId: string) => {
      const u = await http.post('/api/users').set(as(tok.admin)).send({ fullName, email: `${key}@shiraa.org`, password: 'Staff12345', roleIds: [roleId] }).expect(201);
      ids[`user_${key}`] = u.body.id;
      tok[key] = await login(`${key}@shiraa.org`, 'Staff12345', 'shiraa');
    };
    await user('requester', 'موظف البرامج', await role('طالب شراء', ['procurement.requests.create']));
    await user('head', 'مدير الإدارة', await role('معتمد طلبات', ['procurement.requests.approve', 'procurement.dashboard.read']));
    await user('buyer', 'مسؤول المشتريات', await role('مشتريات', ['procurement.dashboard.read', 'procurement.sourcing.manage', 'procurement.suppliers.read', 'procurement.reports.read']));
    await user('evaluator', 'عضو لجنة', await role('لجنة تقييم', ['procurement.sourcing.evaluate']));
    await user('evaluator2', 'عضو لجنة ثانٍ', await role('لجنة تقييم 2', ['procurement.sourcing.evaluate']));
    await user('approver', 'المدير المالي', await role('معتمد تعميد', ['procurement.orders.approve']));
    await user('ceo', 'المدير التنفيذي', await role('معتمد أعلى', ['procurement.orders.approve_high']));
    await http.get(`${PR}/lookups`).set(as(tok.buyer)).expect(200);

    // موردون معتمدون وموظف بوابة لكل منهم
    const hash = await bcrypt.hash('Supplier123', 10);
    for (const [i, key] of ['alpha', 'beta', 'gamma'].entries()) {
      const [s] = await db.query(
        `INSERT INTO pr_suppliers (organization_id, supplier_no, name, status, email, created_by_name) VALUES ($1, $2, $3, 'approved', $4, 'اختبار') RETURNING id`,
        [org, i + 1, `مؤسسة ${key}`, `${key}@vendor.sa`]);
      ids[key] = s.id;
      await db.query(
        `INSERT INTO pr_supplier_users (organization_id, supplier_id, full_name, email, role, password_hash) VALUES ($1, $2, $3, $4, 'owner', $5)`,
        [org, s.id, `مدير ${key}`, `${key}@vendor.sa`, hash]);
      tok[key] = (await http.post(`${SP}/o/shiraa/login`).send({ email: `${key}@vendor.sa`, password: 'Supplier123' }).expect(200)).body.accessToken;
    }
    const [pend] = await db.query(`INSERT INTO pr_suppliers (organization_id, supplier_no, name, status, created_by_name) VALUES ($1, 4, 'مورد معلق', 'pending', 'اختبار') RETURNING id`, [org]);
    ids.pending = pend.id;

    // موازنة معتمدة ببند 100 ألف، ومشروع، ومصادر تمويل بشروط مختلفة
    const Y = new Date().getFullYear();
    const [b] = await db.query(
      `INSERT INTO plan_budgets (organization_id, code, title, fiscal_year, status, version, created_by_name) VALUES ($1, 'BG-001', 'الموازنة', $2, 'approved', 1, 'اختبار') RETURNING id`, [org, Y]);
    const [l] = await db.query(
      `INSERT INTO plan_budget_lines (organization_id, budget_id, section, kind, name, amount) VALUES ($1, $2, 'opex', 'manual', 'مستلزمات البرامج', 100000) RETURNING id`, [org, b.id]);
    ids.line = l.id;
    const [act] = await db.query(`INSERT INTO activities (organization_id, level, name) VALUES ($1, 'project', 'مشروع السلال') RETURNING id`, [org]);
    ids.project = act.id;
    const [d] = await db.query(`INSERT INTO fundraising_donors (organization_id, donor_no, name) VALUES ($1, 1, 'داعم') RETURNING id`, [org]);
    const [o] = await db.query(
      `INSERT INTO fundraising_opportunities (organization_id, opportunity_no, kind, donor_id, opportunity_date, conditions) VALUES ($1, 1, 'donation', $2, CURRENT_DATE, '{}') RETURNING id`, [org, d.id]);
    const batch = async (no: number, kind: string, amount: number, conditions: object, activity: string | null = null) => (await db.query(
      `INSERT INTO fundraising_batches (organization_id, batch_no, opportunity_id, donor_id, target_kind, target_name, conditions, amount, status, activity_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'active', $9) RETURNING id`, [org, no, o.id, d.id, kind, `هدف ${no}`, JSON.stringify(conditions), amount, activity]))[0].id;
    ids.opsBatch = await batch(1, 'operational', 20000, {});
    ids.projectBatch = await batch(2, 'program', 20000, {}, act.id);
    ids.caseBatch = await batch(3, 'case', 20000, {});
    ids.expiredBatch = await batch(4, 'operational', 20000, { endDate: '2020-01-01' });
  });

  afterAll(async () => {
    await app?.get(DataSource).destroy();
    await app?.close();
    rmSync(uploadDir, { recursive: true, force: true });
  });

  const lines = (price = 60) => [
    { description: 'سلة غذائية متكاملة', qty: 500, estPrice: price, specs: 'أرز 5 كجم، سكر 2 كجم، زيت 1.5 لتر' },
    { description: 'كيس تغليف قماشي', qty: 500, estPrice: 4 },
  ];
  const req = (extra: object = {}) => ({ title: 'سلال رمضان', kind: 'goods', priority: 'high', neededBy: future(20), justification: 'توزيع رمضان', lines: lines(), ...extra });

  it('requires a funding basis, suggests the purchase method and needs a reason for a lower one', async () => {
    const r = (await http.post(`${PR}/requests`).set(as(tok.requester)).send(req({ method: 'direct' })).expect(201)).body;
    expect(r).toMatchObject({ code: 'REQ-0001', status: 'draft', estimatedTotal: 32000, suggestedMethod: 'quotes' });
    ids.req = r.id;
    await http.post(`${PR}/requests/${r.id}/submit`).set(as(tok.requester)).send({}).expect(400);
    await http.put(`${PR}/requests/${r.id}`).set(as(tok.requester)).send(req({ method: 'direct', budgetLineId: ids.line })).expect(200);
    const bad = await http.post(`${PR}/requests/${r.id}/submit`).set(as(tok.requester)).send({}).expect(400);
    expect(bad.body.message).toContain('طلب عروض أسعار');
    await http.put(`${PR}/requests/${r.id}`).set(as(tok.requester)).send(req({ method: 'quotes', budgetLineId: ids.line })).expect(200);
    const sent = (await http.post(`${PR}/requests/${r.id}/submit`).set(as(tok.requester)).send({}).expect(200)).body;
    expect(sent.status).toBe('submitted');
    expect(sent.budgetCheck).toMatchObject({ allowed: true, basis: 'budget', available: 100000 });
    // الموظف بلا صلاحية اعتماد، والمعتمد يرى الطلب ويعتمده
    await http.post(`${PR}/requests/${r.id}/approve`).set(as(tok.requester)).send({}).expect(403);
    await http.post(`${PR}/requests/${r.id}/return`).set(as(tok.head)).send({}).expect(400);
    expect((await http.post(`${PR}/requests/${r.id}/approve`).set(as(tok.head)).send({ note: 'موافق' }).expect(200)).body.status).toBe('approved');
  });

  it('warns about similar open requests before sending', async () => {
    const r = (await http.post(`${PR}/requests`).set(as(tok.requester)).send(req({ title: 'سلال إضافية', budgetLineId: ids.line, method: 'quotes' })).expect(201)).body;
    const sim = (await http.get(`${PR}/requests/${r.id}/similar`).set(as(tok.requester)).expect(200)).body;
    expect(sim.map((x: { code: string }) => x.code)).toEqual(['REQ-0001']);
    await http.post(`${PR}/requests/${r.id}/submit`).set(as(tok.requester)).send({}).expect(409);
    await http.post(`${PR}/requests/${r.id}/submit`).set(as(tok.requester)).send({ confirmDuplicate: true }).expect(200);
    expect((await http.post(`${PR}/requests/${r.id}/cancel`).set(as(tok.requester)).send({ reason: 'مكرر' }).expect(200)).body.status).toBe('cancelled');
    // صاحب الطلب يرى طلباته فقط
    const mine = (await http.get(`${PR}/requests`).set(as(tok.requester)).expect(200)).body;
    expect(mine).toHaveLength(2);
  });

  it('publishes a tender to invited suppliers with sealed quotes until the deadline', async () => {
    const lk = (await http.get(`${PR}/lookups`).set(as(tok.buyer)).expect(200)).body;
    const body = {
      requestId: ids.req, title: 'توريد سلال رمضان', method: 'quotes', scope: 'توريد وتغليف', terms: 'التسليم في المستودع الرئيسي',
      closesAt: inHours(2), questionsUntil: inHours(1), invitedIds: [ids.alpha, ids.beta], categoryIds: [], criteria: lk.sourcing.evalCriteria, technicalPass: 60,
      committeeIds: [ids.user_evaluator, ids.user_evaluator2],
    };
    await http.post(`${PR}/rfqs`).set(as(tok.buyer)).send({ ...body, criteria: [{ key: 'price', name: 'السعر', weight: 50, kind: 'price' }] }).expect(400);
    const q = (await http.post(`${PR}/rfqs`).set(as(tok.buyer)).send(body).expect(201)).body;
    expect(q).toMatchObject({ code: 'RFQ-0001', status: 'draft' });
    ids.rfq = q.id;
    expect((await http.get(`${PR}/requests/${ids.req}`).set(as(tok.head)).expect(200)).body.status).toBe('sourcing');
    // الموردون أقل من الحد الأدنى (3) فيحتاج مبررًا، والمورد غير المعتمد لا يُدعى
    await http.put(`${PR}/rfqs/${q.id}`).set(as(tok.buyer)).send({ ...body, invitedIds: [ids.alpha, ids.pending] }).expect(200);
    await http.post(`${PR}/rfqs/${q.id}/publish`).set(as(tok.buyer)).send({ fewerReason: 'تخصص نادر' }).expect(400);
    await http.put(`${PR}/rfqs/${q.id}`).set(as(tok.buyer)).send(body).expect(200);
    await http.post(`${PR}/rfqs/${q.id}/publish`).set(as(tok.buyer)).send({}).expect(400);
    const pub = (await http.post(`${PR}/rfqs/${q.id}/publish`).set(as(tok.buyer)).send({ fewerReason: 'لا يتوفر إلا موردان معتمدان لهذا الصنف' }).expect(200)).body;
    expect(pub.status).toBe('published');

    // البوابة: المدعو يرى المنافسة، وغير المدعو لا يراها
    expect((await http.get(`${SP}/rfqs`).set(as(tok.alpha)).expect(200)).body.map((x: { code: string }) => x.code)).toEqual(['RFQ-0001']);
    expect((await http.get(`${SP}/rfqs`).set(as(tok.gamma)).expect(200)).body).toEqual([]);
    await http.get(`${SP}/rfqs/${q.id}`).set(as(tok.gamma)).expect(404);
    const detail = (await http.get(`${SP}/rfqs/${q.id}`).set(as(tok.alpha)).expect(200)).body;
    expect(detail.lines).toHaveLength(2);
    expect(detail.lines[0].estPrice).toBeUndefined();
    ids.l1 = detail.lines[0].id;
    ids.l2 = detail.lines[1].id;
    await http.post(`${SP}/rfqs/${q.id}/questions`).set(as(tok.alpha)).send({ question: 'هل يقبل التسليم على دفعتين؟' }).expect(200);
    // مسودة ثم إرسال
    await http.put(`${SP}/rfqs/${q.id}/quote`).set(as(tok.alpha)).send({ lines: [{ lineId: ids.l1, unitPrice: 58 }], vatRate: 15, submit: true, validityDays: 30 }).expect(400);
    const draft = (await http.put(`${SP}/rfqs/${q.id}/quote`).set(as(tok.alpha)).send({ lines: [{ lineId: ids.l1, unitPrice: 58 }], vatRate: 15 }).expect(200)).body;
    expect(draft.quote.status).toBe('draft');
    const sent = (await http.put(`${SP}/rfqs/${q.id}/quote`).set(as(tok.alpha)).send({
      lines: [{ lineId: ids.l1, unitPrice: 58 }, { lineId: ids.l2, unitPrice: 4 }], vatRate: 15, deliveryDays: 10, validityDays: 30, technicalNote: 'منتجات محلية', submit: true,
    }).expect(200)).body;
    expect(sent.quote).toMatchObject({ status: 'submitted', subtotal: 31000, vat: 4650, total: 35650 });

    // موظف المشتريات يرى من قدّم فقط، ولا يفتح قبل الموعد، ويُدخل عرضًا ورقيًا لمورد مدعو
    const sealed = (await http.get(`${PR}/rfqs/${q.id}`).set(as(tok.buyer)).expect(200)).body;
    expect(sealed.sealed).toBe(true);
    expect(sealed.quotes[0].total).toBeUndefined();
    await http.post(`${PR}/rfqs/${q.id}/open`).set(as(tok.buyer)).expect(409);
    await http.post(`${PR}/rfqs/${q.id}/quotes`).set(as(tok.buyer)).send({ supplierId: ids.gamma, lines: [{ lineId: ids.l1, unitPrice: 50 }, { lineId: ids.l2, unitPrice: 4 }], vatRate: 15 }).expect(400);
    await http.post(`${PR}/rfqs/${q.id}/quotes`).set(as(tok.buyer)).send({
      supplierId: ids.beta, lines: [{ lineId: ids.l1, unitPrice: 56 }, { lineId: ids.l2, unitPrice: 5 }], vatRate: 15, deliveryDays: 15, validityDays: 30,
    }).expect(200);
    const qs = (await http.get(`${PR}/rfqs/${q.id}`).set(as(tok.buyer)).expect(200)).body.questions;
    await http.post(`${PR}/rfqs/${q.id}/questions/${qs[0].id}/answer`).set(as(tok.buyer)).send({ answer: 'نعم، على دفعتين خلال أسبوعين', published: true }).expect(200);
    expect((await http.get(`${SP}/rfqs/${q.id}`).set(as(tok.beta)).expect(200)).body.questions[0].answer).toContain('دفعتين');
  });

  it('opens after the deadline, evaluates by committee, negotiates and recommends the award', async () => {
    await db.query(`UPDATE pr_rfqs SET closes_at = now() - interval '1 minute' WHERE id = $1`, [ids.rfq]);
    await http.put(`${SP}/rfqs/${ids.rfq}/quote`).set(as(tok.alpha)).send({ lines: [{ lineId: ids.l1, unitPrice: 50 }, { lineId: ids.l2, unitPrice: 4 }], vatRate: 15, validityDays: 30, submit: true }).expect(409);
    const opened = (await http.post(`${PR}/rfqs/${ids.rfq}/open`).set(as(tok.buyer)).expect(200)).body;
    expect(opened.status).toBe('opened');
    const qa = opened.quotes.find((x: { supplierId: string }) => x.supplierId === ids.alpha);
    const qb = opened.quotes.find((x: { supplierId: string }) => x.supplierId === ids.beta);
    expect(qb.total).toBe(35075);
    ids.qa = qa.id;
    ids.qb = qb.id;
    // عضو اللجنة يرى منافساته ويقيّم، وموظف المشتريات لا يقيّم
    expect((await http.get(`${PR}/rfqs`).set(as(tok.evaluator)).expect(200)).body).toHaveLength(1);
    await http.post(`${PR}/quotes/${qa.id}/score`).set(as(tok.buyer)).send({ scores: [{ key: 'quality', score: 90 }, { key: 'delivery', score: 90 }] }).expect(403);
    await http.post(`${PR}/quotes/${qa.id}/score`).set(as(tok.evaluator)).send({ scores: [{ key: 'quality', score: 90 }] }).expect(400);
    for (const t of [tok.evaluator, tok.evaluator2]) {
      await http.post(`${PR}/quotes/${qa.id}/score`).set(as(t)).send({ scores: [{ key: 'quality', score: 90 }, { key: 'delivery', score: 90 }] }).expect(200);
      await http.post(`${PR}/quotes/${qb.id}/score`).set(as(t)).send({ scores: [{ key: 'quality', score: 70 }, { key: 'delivery', score: 60 }] }).expect(200);
    }
    let rfq = (await http.get(`${PR}/rfqs/${ids.rfq}`).set(as(tok.buyer)).expect(200)).body;
    const ea = rfq.quotes.find((x: { id: string }) => x.id === qa.id).evaluation;
    expect(ea).toMatchObject({ technicalScore: 90, passed: true, rank: 1 });
    // التفاوض مع المورد الثاني يخفض سعره ويُوثق
    rfq = (await http.post(`${PR}/quotes/${qb.id}/negotiate`).set(as(tok.buyer)).send({ lines: [{ lineId: ids.l1, unitPrice: 52 }], note: 'خفض بعد التفاوض' }).expect(200)).body;
    const nb = rfq.quotes.find((x: { id: string }) => x.id === qb.id);
    expect(nb.total).toBe(32775);
    expect(nb.revisions).toHaveLength(1);
    // اختيار غير الأول يحتاج مبررات واضحة
    const second = rfq.quotes.find((x: { evaluation: { rank: number } }) => x.evaluation.rank === 2).id;
    await http.post(`${PR}/rfqs/${ids.rfq}/recommend`).set(as(tok.buyer)).send({ quoteId: second, recommendation: 'الأفضل عمومًا' }).expect(400);
    const first = rfq.quotes.find((x: { evaluation: { rank: number } }) => x.evaluation.rank === 1);
    const rec = (await http.post(`${PR}/rfqs/${ids.rfq}/recommend`).set(as(tok.buyer)).send({ quoteId: first.id, recommendation: 'الأعلى تقييمًا فنيًا وماليًا' }).expect(200)).body;
    expect(rec.rfq.status).toBe('recommended');
    ids.order = rec.orderId;
    ids.winner = first.supplierId;
    ids.loser = first.supplierId === ids.alpha ? ids.beta : ids.alpha;
  });

  it('approves the order by levels, reserves the budget line and issues it to the supplier', async () => {
    let o = (await http.get(`${PR}/orders/${ids.order}`).set(as(tok.approver)).expect(200)).body;
    expect(o).toMatchObject({ code: 'PO-0001', status: 'pending' });
    expect(o.requiredLevels.map((l: { permission: string }) => l.permission)).toEqual(['procurement.orders.approve']);
    // قيمة أقل من 50 ألف: مستوى واحد. نرفع حد المستوى الأعلى للاختبار: نخفضه إلى 30 ألفًا ونعيد الإرسال
    await http.put(`${PR}/sourcing-settings`).set(as(tok.admin)).send({
      approvalLevels: [{ name: 'المدير المالي', minAmount: 0, permission: 'procurement.orders.approve' }, { name: 'المدير التنفيذي', minAmount: 30000, permission: 'procurement.orders.approve_high' }],
    }).expect(200);
    await http.post(`${PR}/orders/${ids.order}/return`).set(as(tok.approver)).send({ reason: 'إعادة حساب المستويات' }).expect(200);
    await http.post(`${PR}/orders/${ids.order}/submit`).set(as(tok.buyer)).expect(200);
    o = (await http.get(`${PR}/orders/${ids.order}`).set(as(tok.approver)).expect(200)).body;
    expect(o.requiredLevels).toHaveLength(2);
    // المستوى الأعلى لا يسبق الأول، ثم الأول، ثم الأعلى = إصدار
    await http.post(`${PR}/orders/${ids.order}/approve`).set(as(tok.ceo)).send({}).expect(403);
    o = (await http.post(`${PR}/orders/${ids.order}/approve`).set(as(tok.approver)).send({ note: 'مطابق' }).expect(200)).body;
    expect(o.status).toBe('pending');
    expect(o.nextLevel.name).toBe('المدير التنفيذي');
    await http.post(`${PR}/orders/${ids.order}/approve`).set(as(tok.approver)).send({}).expect(403);
    o = (await http.post(`${PR}/orders/${ids.order}/approve`).set(as(tok.ceo)).send({}).expect(200)).body;
    expect(o.status).toBe('issued');
    expect(o.commitmentId).toBeTruthy();
    const [c] = await db.query('SELECT amount::float, status, source_module FROM plan_budget_commitments WHERE id = $1', [o.commitmentId]);
    expect(c).toEqual({ amount: o.total, status: 'reserved', source_module: 'procurement' });
    expect((await http.get(`${PR}/requests/${ids.req}`).set(as(tok.head)).expect(200)).body.status).toBe('ordered');
    expect((await http.get(`${PR}/rfqs/${ids.rfq}`).set(as(tok.buyer)).expect(200)).body.status).toBe('awarded');
    // لا يتكرر التعميد بنفس الكميات
    await http.post(`${PR}/orders`).set(as(tok.buyer)).send({ requestId: ids.req, supplierId: ids.alpha, lines: [{ lineId: ids.l1, qty: 1, unitPrice: 50 }], vatRate: 15 }).expect(409);
  });

  it('lets the supplier acknowledge and accept, and shows the result to the others', async () => {
    const winTok = ids.winner === ids.alpha ? tok.alpha : tok.beta;
    const loseTok = ids.winner === ids.alpha ? tok.beta : tok.alpha;
    expect((await http.get(`${SP}/orders`).set(as(loseTok)).expect(200)).body).toEqual([]);
    const list = (await http.get(`${SP}/orders`).set(as(winTok)).expect(200)).body;
    expect(list[0]).toMatchObject({ code: 'PO-0001', status: 'issued' });
    await http.post(`${SP}/orders/${ids.order}/respond`).set(as(winTok)).send({ action: 'clarify' }).expect(400);
    await http.post(`${SP}/orders/${ids.order}/respond`).set(as(winTok)).send({ action: 'acknowledge' }).expect(200);
    await http.post(`${SP}/orders/${ids.order}/respond`).set(as(winTok)).send({ action: 'clarify', note: 'هل التسليم صباحًا؟' }).expect(200);
    await http.post(`${PR}/orders/${ids.order}/reply`).set(as(tok.buyer)).send({ reason: 'نعم من 8 إلى 12' }).expect(200);
    const acc = (await http.post(`${SP}/orders/${ids.order}/respond`).set(as(winTok)).send({ action: 'accept' }).expect(200)).body;
    expect(acc.status).toBe('accepted');
    await http.post(`${SP}/orders/${ids.order}/respond`).set(as(loseTok)).send({ action: 'accept' }).expect(404);
    const lost = (await http.get(`${SP}/rfqs`).set(as(loseTok)).expect(200)).body[0];
    expect(lost.result).toMatchObject({ won: false, label: 'لم تتم الترسية عليكم' });
  });

  it('amends an issued order down and re-reserves the smaller amount', async () => {
    const o = (await http.get(`${PR}/orders/${ids.order}`).set(as(tok.buyer)).expect(200)).body;
    const ln = o.lines[0];
    await http.post(`${PR}/orders/${ids.order}/amend`).set(as(tok.buyer)).send({ lines: o.lines.map((l: { lineId: string; qty: number; unitPrice: number }) => ({ ...l, qty: l.qty + 1 })), reason: 'زيادة' }).expect(400);
    const am = (await http.post(`${PR}/orders/${ids.order}/amend`).set(as(tok.buyer)).send({
      lines: o.lines.map((l: { lineId: string; qty: number; unitPrice: number }) => (l.lineId === ln.lineId ? { lineId: l.lineId, qty: 400, unitPrice: l.unitPrice } : { lineId: l.lineId, qty: l.qty, unitPrice: l.unitPrice })),
      reason: 'تخفيض الكمية',
    }).expect(200)).body;
    expect(am).toMatchObject({ status: 'issued', version: 2 });
    expect(am.total).toBeLessThan(o.total);
    const rows = await db.query('SELECT amount::float, status FROM plan_budget_commitments WHERE source_id = $1 ORDER BY created_at', [ids.order]);
    expect(rows.map((r: { status: string }) => r.status)).toEqual(['released', 'reserved']);
    expect(rows[1].amount).toBe(am.total);
  });

  it('blocks approval when the budget line has no room and no funding source exists', async () => {
    const r = (await http.post(`${PR}/requests`).set(as(tok.requester)).send(req({
      title: 'أجهزة للبرامج', budgetLineId: ids.line, method: 'tender',
      lines: [{ description: 'ثلاجات', qty: 10, estPrice: 8000 }],
    })).expect(201)).body;
    const sent = (await http.post(`${PR}/requests/${r.id}/submit`).set(as(tok.requester)).send({}).expect(200)).body;
    expect(sent.budgetCheck.allowed).toBe(false);
    const bell = JSON.stringify((await http.get('/api/tasks').set(as(tok.head)).expect(200)).body);
    expect(bell).toContain('اعتماد طلب شراء: أجهزة للبرامج');
    const no = await http.post(`${PR}/requests/${r.id}/approve`).set(as(tok.head)).send({}).expect(409);
    expect(no.body.message).toContain('لا يوجد مصدر تمويل');
  });

  it('checks the funding source first, with its purpose, period and balance, and releases it on cancel', async () => {
    const mk = async (extra: object) => {
      const r = (await http.post(`${PR}/requests`).set(as(tok.requester)).send(req({
        title: `شراء ${Math.random()}`, method: 'direct', lines: [{ description: `قرطاسية ${Math.random()}`, qty: 10, estPrice: 500 }], ...extra,
      })).expect(201)).body;
      await http.post(`${PR}/requests/${r.id}/submit`).set(as(tok.requester)).send({ confirmDuplicate: true }).expect(200);
      return r.id as string;
    };
    // تبرع لحالة مستفيد لا يُستخدم في شراء مواد، وتبرع انتهت مدته، وتبرع لمشروع آخر
    let res = await http.post(`${PR}/requests/${await mk({ fundingBatchId: ids.caseBatch })}/approve`).set(as(tok.head)).send({}).expect(409);
    expect(res.body.message).toContain('حالة مستفيد');
    res = await http.post(`${PR}/requests/${await mk({ fundingBatchId: ids.expiredBatch })}/approve`).set(as(tok.head)).send({}).expect(409);
    expect(res.body.message).toContain('انتهت فترة استخدام التمويل');
    res = await http.post(`${PR}/requests/${await mk({ fundingBatchId: ids.projectBatch })}/approve`).set(as(tok.head)).send({}).expect(409);
    expect(res.body.message).toContain('مشروع');
    await http.post(`${PR}/requests/${await mk({ fundingBatchId: ids.projectBatch, projectId: ids.project })}/approve`).set(as(tok.head)).send({}).expect(200);
    // مصدر التمويل يحكم حتى لو كان بند الموازنة لا يكفي
    const ok = await mk({ fundingBatchId: ids.opsBatch, budgetLineId: ids.line });
    await http.post(`${PR}/requests/${ok}/approve`).set(as(tok.head)).send({}).expect(200);
    const rq = (await http.get(`${PR}/requests/${ok}`).set(as(tok.buyer)).expect(200)).body;
    await http.post(`${PR}/orders`).set(as(tok.buyer)).send({ requestId: ok, supplierId: ids.pending, lines: [{ lineId: rq.lines[0].id, qty: 1, unitPrice: 1 }], vatRate: 15 }).expect(409);
    const po = (await http.post(`${PR}/orders`).set(as(tok.buyer)).send({
      requestId: ok, supplierId: ids.gamma, lines: [{ lineId: rq.lines[0].id, qty: 10, unitPrice: 480 }], vatRate: 15, deliveryDate: future(7),
    }).expect(201)).body;
    await http.post(`${PR}/orders/${po.id}/submit`).set(as(tok.buyer)).expect(200);
    const issued = (await http.post(`${PR}/orders/${po.id}/approve`).set(as(tok.approver)).send({}).expect(200)).body;
    expect(issued).toMatchObject({ status: 'issued', fundingReserved: 5520 });
    expect(issued.budgetCheck.basis).toBe('funding');
    let [b] = await db.query('SELECT reserved_amount::float AS r FROM fundraising_batches WHERE id = $1', [ids.opsBatch]);
    expect(b.r).toBe(5520);
    const cancelled = (await http.post(`${PR}/orders/${po.id}/cancel`).set(as(tok.buyer)).send({ reason: 'اعتذار المورد' }).expect(200)).body;
    expect(cancelled.status).toBe('cancelled');
    [b] = await db.query('SELECT reserved_amount::float AS r FROM fundraising_batches WHERE id = $1', [ids.opsBatch]);
    expect(b.r).toBe(0);
    expect((await http.get(`${PR}/requests/${ok}`).set(as(tok.buyer)).expect(200)).body.status).toBe('approved');
  });

  it('shows dashboard counts, approval tasks and the procurement reports', async () => {
    const dash = (await http.get(`${PR}/dashboard`).set(as(tok.buyer)).expect(200)).body;
    expect(dash.sourcing.orders.live).toBe(1);
    for (const code of ['requests', 'rfqs', 'orders']) {
      const r = (await http.get(`/api/reports/run/procurement.${code}`).set(as(tok.buyer)).expect(200)).body;
      expect(r.rows.length).toBeGreaterThan(0);
    }
    const rfqs = (await http.get('/api/reports/run/procurement.rfqs').set(as(tok.buyer)).expect(200)).body.rows;
    expect(rfqs[0].saving).toBeGreaterThan(0);
  });
});
