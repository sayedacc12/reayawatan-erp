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

jest.setTimeout(120_000);

/** المرحلة الثالثة: الاستلام والفحص والصرف والتحويل والمرتجعات والتبرعات العينية والإتلاف والجرد، وسندات المخازن والمطابقة مع الدليل */
describe('Procurement stage 3: receipts, stock and warehouse vouchers', () => {
  let app: NestExpressApplication;
  let http: ReturnType<typeof request>;
  let db: DataSource;
  let uploadDir: string;
  let org: string;
  const tok: Record<string, string> = {};
  const ids: Record<string, string> = {};
  const acc: Record<string, string> = {};
  const as = (t: string) => ({ Authorization: `Bearer ${t}` });
  const login = async (login: string, password: string, organization?: string) =>
    (await http.post('/api/auth/login').send({ login, password, organization }).expect(200)).body.accessToken as string;
  const PR = '/api/procurement';
  const A = '/api/accounting';
  const entry = async (id: string) => {
    const lines: { account_id: string; debit: string; credit: string; analytic: unknown[] }[] = await db.query('SELECT account_id, debit, credit, analytic FROM acc_entry_lines WHERE entry_id = $1 ORDER BY line_no', [id]);
    const [e] = await db.query('SELECT voucher_type, source, status, total FROM acc_entries WHERE id = $1', [id]);
    const net = (acct: string) => Math.round(lines.filter((l) => l.account_id === acct).reduce((s, l) => s + Number(l.debit) - Number(l.credit), 0) * 100) / 100;
    return { ...e, lines, net };
  };
  const balance = async (item: string, wh: string) => {
    const [b] = await db.query('SELECT qty::float AS qty, value::float AS value FROM pr_stock_balances WHERE item_id = $1 AND warehouse_id = $2', [item, wh]);
    return b ?? { qty: 0, value: 0 };
  };

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
      name: 'جمعية المخازن', slug: 'makhazen', adminFullName: 'مدير النظام', adminEmail: 'admin@makhazen.org', adminPassword: 'Admin12345',
    }).expect(201)).body.id;
    tok.admin = await login('admin@makhazen.org', 'Admin12345', 'makhazen');

    // الدليل والسنة المالية ومراكز التكلفة
    const Y = Number(today.slice(0, 4));
    await http.post(`${A}/chart/install`).set(as(tok.admin)).expect(201);
    const chart = (await http.get(`${A}/accounts`).set(as(tok.admin)).expect(200)).body.accounts as { id: string; code: string; name: string; kind: string; nature: string }[];
    const sub = (nature: string, has?: string, skip = 0) => chart.filter((a) => a.kind === 'sub' && a.nature === nature && (!has || a.name.includes(has)))[skip].id;
    acc.inventory = sub('assets', 'مخزون');
    acc.inventory2 = sub('assets', 'مخزون', 1);
    acc.grni = sub('liabilities', 'مستحق');
    acc.donation = sub('revenue', 'عينية');
    acc.opening = sub('net_assets');
    acc.expense = sub('expenses');
    acc.adjust = sub('expenses', undefined, 1);
    const byCode = (c: string) => chart.find((a) => a.code === c)!.id;
    const analytic = (await http.get(`${A}/analytic`).set(as(tok.admin)).expect(200)).body.accounts as { id: string; code: string }[];
    acc.cc = analytic.find((x) => x.code === 'CC01')?.id ?? analytic[0].id;
    await http.post(`${A}/setup`).set(as(tok.admin)).send({
      fiscalYear: Y, startDate: `${Y}-01-01`, endDate: `${Y}-12-31`, isFirstYear: true, firstYearStart: `${Y}-01-01`, firstYearEnd: `${Y}-12-31`,
    }).expect(201);
    ids.assetGroup = (await http.post(`${A}/assets/groups`).set(as(tok.admin)).send({
      code: 'IT', name: 'أجهزة الحاسب', method: 'straight_line', lifeYears: 4, assetAccountId: byCode('1211000101'), accumAccountId: byCode('2250101001'),
      expenseAccountId: byCode('4131000101'), gainLossAccountId: byCode('3120500401'), analyticId: acc.cc,
    }).expect(201)).body.id;
    acc.assetAccount = byCode('1211000101');

    const role = async (name: string, permissions: string[]) => (await http.post('/api/roles').set(as(tok.admin)).send({ name, permissions }).expect(201)).body.id;
    const user = async (key: string, fullName: string, roleId: string) => {
      const u = await http.post('/api/users').set(as(tok.admin)).send({ fullName, email: `${key}@makhazen.org`, password: 'Staff12345', roleIds: [roleId] }).expect(201);
      ids[`user_${key}`] = u.body.id;
      tok[key] = await login(`${key}@makhazen.org`, 'Staff12345', 'makhazen');
    };
    await user('buyer', 'مسؤول المشتريات', await role('مشتريات', ['procurement.dashboard.read', 'procurement.sourcing.manage', 'procurement.requests.create', 'procurement.suppliers.read']));
    await user('approver', 'المدير المالي', await role('معتمد', ['procurement.orders.approve', 'procurement.requests.approve', 'procurement.dashboard.read']));
    await user('keeper', 'أمين المستودع', await role('أمين مستودع', ['procurement.dashboard.read', 'procurement.stock.operate']));
    await user('keeper2', 'أمين الفرع', await role('أمين فرع', ['procurement.dashboard.read', 'procurement.stock.operate']));
    await user('controller', 'المراقب المالي', await role('مراقب', ['procurement.dashboard.read', 'procurement.stock.approve', 'procurement.issues.approve']));
    await user('requester', 'موظف البرامج', await role('طالب صرف', ['procurement.issues.request']));

    // المشتريات: المجموعات بحساباتها، والأصناف، والمستودعات بأمنائها
    const lk = (await http.get(`${PR}/lookups`).set(as(tok.admin)).expect(200)).body;
    const grp = (c: string) => lk.groups.find((g: { code: string }) => g.code === c).id;
    ids.piece = lk.uoms.find((u: { name: string }) => u.name === 'حبة').id;
    await http.patch(`${PR}/groups/${grp('FOOD')}`).set(as(tok.admin)).send({ code: 'FOOD', name: 'المواد الغذائية', kind: 'stock', inventoryAccountId: acc.inventory, expenseAccountId: acc.expense }).expect(200);
    await http.patch(`${PR}/groups/${grp('AID')}`).set(as(tok.admin)).send({ code: 'AID', name: 'المساعدات العينية', kind: 'stock', inventoryAccountId: acc.inventory, expenseAccountId: acc.expense }).expect(200);
    await http.patch(`${PR}/groups/${grp('FA')}`).set(as(tok.admin)).send({ code: 'FA', name: 'الأصول الثابتة', kind: 'asset', assetGroupId: ids.assetGroup }).expect(200);
    const item = async (name: string, group: string, extra: object = {}) => (await http.post(`${PR}/items`).set(as(tok.admin)).send({ name, groupId: grp(group), uomId: ids.piece, ...extra }).expect(201)).body.id;
    ids.rice = await item('أرز بسمتي 5 كيلو', 'FOOD', { trackBatch: true, trackExpiry: true, shelfLifeDays: 365, reorderPoint: 30 });
    ids.blanket = await item('بطانية شتوية', 'AID');
    ids.laptop = await item('حاسب محمول', 'FA', { kind: 'asset' });
    ids.main = (await http.post(`${PR}/warehouses`).set(as(tok.admin)).send({ code: 'WH-01', name: 'المستودع الرئيس', kind: 'main', keeperIds: [ids.user_keeper] }).expect(201)).body.id;
    ids.branch = (await http.post(`${PR}/warehouses`).set(as(tok.admin)).send({ code: 'WH-02', name: 'مستودع الفرع', kind: 'sub', keeperIds: [ids.user_keeper2] }).expect(201)).body.id;

    // مورد معتمد بمستخدم بوابة، وموازنة معتمدة ببند
    const [s] = await db.query(`INSERT INTO pr_suppliers (organization_id, supplier_no, name, status, email, created_by_name) VALUES ($1, 1, 'مؤسسة الوفاء', 'approved', 'wafa@vendor.sa', 'اختبار') RETURNING id`, [org]);
    ids.supplier = s.id;
    await db.query(`INSERT INTO pr_supplier_users (organization_id, supplier_id, full_name, email, role, password_hash) VALUES ($1, $2, 'مدير الوفاء', 'wafa@vendor.sa', 'owner', $3)`,
      [org, s.id, await bcrypt.hash('Supplier123', 10)]);
    tok.wafa = (await http.post('/api/supplier-portal/o/makhazen/login').send({ email: 'wafa@vendor.sa', password: 'Supplier123' }).expect(200)).body.accessToken;
    const [b] = await db.query(`INSERT INTO plan_budgets (organization_id, code, title, fiscal_year, status, version, created_by_name) VALUES ($1, 'BG-001', 'الموازنة', $2, 'approved', 1, 'اختبار') RETURNING id`, [org, Y]);
    ids.line = (await db.query(`INSERT INTO plan_budget_lines (organization_id, budget_id, section, kind, name, amount) VALUES ($1, $2, 'opex', 'manual', 'المساعدات', 100000) RETURNING id`, [org, b.id]))[0].id;
  });

  afterAll(async () => {
    await app?.get(DataSource).destroy();
    await app?.close();
    rmSync(uploadDir, { recursive: true, force: true });
  });

  it('validates warehouse settings by account nature', async () => {
    const base = { expiryAlertDays: 60, overReceiptPct: 0, vatInCost: true, requireInspection: false };
    const bad = await http.put(`${PR}/stock-settings`).set(as(tok.admin)).send({ ...base, grniAccountId: acc.grni, donationAccountId: acc.expense }).expect(400);
    expect(bad.body.message).toContain('الإيرادات');
    const s = (await http.put(`${PR}/stock-settings`).set(as(tok.admin)).send({
      ...base, grniAccountId: acc.grni, adjustAccountId: acc.adjust, adjustAnalyticId: acc.cc, donationAccountId: acc.donation, openingAccountId: acc.opening, defaultExpenseAccountId: acc.expense,
    }).expect(200)).body;
    expect(s).toMatchObject({ grniAccountId: acc.grni, vatInCost: true });
  });

  it('blocks manual entries on inventory accounts and manual warehouse vouchers', async () => {
    const lines = [{ accountId: acc.inventory, debit: 100, credit: 0 }, { accountId: acc.grni, debit: 0, credit: 100 }];
    const r = await http.post(`${A}/entries`).set(as(tok.admin)).send({ voucherType: 'journal', documentDate: today, description: 'تجربة مخزون', lines }).expect(400);
    expect(r.body.message).toContain('سندات المخازن');
    await http.post(`${A}/entries`).set(as(tok.admin)).send({ voucherType: 'stock', documentDate: today, description: 'سند مخازن يدوي', lines }).expect(400);
  });

  it('receives an order after inspection: stock and fixed assets in one warehouse voucher, consuming the budget reservation', async () => {
    const reqBody = {
      title: 'سلال ومعدات', kind: 'goods', priority: 'normal', neededBy: day(10), method: 'direct', budgetLineId: ids.line,
      lines: [{ itemId: ids.rice, description: 'أرز بسمتي 5 كيلو', qty: 100, uomId: ids.piece, estPrice: 40 }, { itemId: ids.laptop, description: 'حاسب محمول', qty: 2, uomId: ids.piece, estPrice: 2500 }],
    };
    const r = (await http.post(`${PR}/requests`).set(as(tok.buyer)).send(reqBody).expect(201)).body;
    await http.post(`${PR}/requests/${r.id}/submit`).set(as(tok.buyer)).send({}).expect(200);
    await http.post(`${PR}/requests/${r.id}/approve`).set(as(tok.approver)).send({}).expect(200);
    const o = (await http.post(`${PR}/orders`).set(as(tok.buyer)).send({
      requestId: r.id, supplierId: ids.supplier, vatRate: 15, warehouseId: ids.main, deliveryDate: day(5),
      lines: r.lines.map((l: { id: string; estPrice: number; qty: number }) => ({ lineId: l.id, qty: l.qty, unitPrice: l.estPrice })),
    }).expect(201)).body;
    await http.post(`${PR}/orders/${o.id}/submit`).set(as(tok.buyer)).send({}).expect(200);
    const issued = (await http.post(`${PR}/orders/${o.id}/approve`).set(as(tok.approver)).send({}).expect(200)).body;
    expect(issued).toMatchObject({ status: 'issued', total: 10350 });
    ids.order = o.id;
    ids.riceLine = issued.lines[0].lineId;
    ids.laptopLine = issued.lines[1].lineId;

    const rv = (await http.get(`${PR}/receipts/receivable/${o.id}`).set(as(tok.keeper)).expect(200)).body;
    expect(rv.lines[0]).toMatchObject({ remaining: 100, unitCost: 46, treatment: 'stock', trackBatch: true });
    expect(rv.lines[1]).toMatchObject({ treatment: 'asset' });
    const body = (lines: object[], extra: object = {}) => ({ kind: 'order', orderId: o.id, date: today, deliveryRef: 'DN-77', lines, ...extra });
    const rice = (qty: number, rejected = 0, lot = 'L-1', exp = day(300)) => ({ orderLineId: ids.riceLine, qty, rejectedQty: rejected, rejectReason: rejected ? 'أكياس ممزقة' : null, lot, expiryDate: exp });
    // أمين مستودع آخر لا يستلم في المستودع الرئيس، ومعد التعميد لا يستلمه (فصل المهام)
    await http.post(`${PR}/receipts`).set(as(tok.keeper2)).send(body([rice(10)])).expect(403);
    await http.post(`${PR}/receipts`).set(as(tok.buyer)).send(body([rice(10)])).expect(403);
    // المرفوض يحتاج نتيجة فحص، والصنف المتتبع يحتاج التشغيلة والصلاحية، ولا تجاوز للمتبقي
    await http.post(`${PR}/receipts`).set(as(tok.keeper)).send(body([rice(70, 10)])).expect(400);
    await http.post(`${PR}/receipts`).set(as(tok.keeper)).send(body([{ orderLineId: ids.riceLine, qty: 10 }])).expect(400);
    await http.post(`${PR}/receipts`).set(as(tok.keeper)).send(body([rice(101)])).expect(409);

    const g = (await http.post(`${PR}/receipts`).set(as(tok.keeper)).send(body(
      [rice(70, 10), { orderLineId: ids.laptopLine, qty: 2 }],
      { extraCost: 0, inspection: { committee: ['أمين المستودع', 'مندوب المالية'], result: 'partial', note: 'رفض 10 أكياس' } },
    )).expect(201)).body;
    expect(g).toMatchObject({ code: 'GRN-0001', total: 8510, orderValue: 7400, status: 'posted' });
    expect(g.lines[0]).toMatchObject({ acceptedQty: 60, rejectedQty: 10, value: 2760, treatment: 'stock' });
    expect(g.lines[1].assets).toHaveLength(2);
    ids.grn1 = g.id;
    ids.grn1Rice = g.lines[0].id;
    const e = await entry(g.entryId);
    expect(e).toMatchObject({ voucher_type: 'stock', source: 'stock', status: 'posted' });
    expect(e.net(acc.inventory)).toBe(2760);
    expect(e.net(acc.assetAccount)).toBe(5750);
    expect(e.net(acc.grni)).toBe(-8510);
    expect(await balance(ids.rice, ids.main)).toEqual({ qty: 60, value: 2760 });
    // الأصول الثابتة أُنشئت في الخدمة بحركة شراء مرتبطة بالاستلام
    const assets = await db.query(`SELECT a.status, a.cost::float AS cost, m.pr_receipt_id FROM acc_assets a JOIN acc_asset_moves m ON m.asset_id = a.id WHERE a.organization_id = $1`, [org]);
    expect(assets).toEqual([{ status: 'active', cost: 2875, pr_receipt_id: g.id }, { status: 'active', cost: 2875, pr_receipt_id: g.id }]);
    // حجز الموازنة: استُهلكت قيمة المقبول بأسعار التعميد شاملة الضريبة (7400 × 1.15)
    const c = await db.query(`SELECT status, amount::float AS amount FROM plan_budget_commitments WHERE source_id = $1 ORDER BY status`, [o.id]);
    expect(c).toEqual([{ status: 'consumed', amount: 8510 }, { status: 'reserved', amount: 1840 }]);
    const ord = (await http.get(`${PR}/orders/${o.id}`).set(as(tok.buyer)).expect(200)).body;
    expect(ord).toMatchObject({ status: 'partial', can: { cancel: false, shortClose: true } });
    expect(ord.lines[0].receivedQty).toBe(60);
    await http.post(`${PR}/orders/${o.id}/cancel`).set(as(tok.buyer)).send({ reason: 'لا حاجة' }).expect(409);
    await http.post(`${PR}/orders/${o.id}/amend`).set(as(tok.buyer)).send({ reason: 'تعديل', deliveryDate: day(9) }).expect(409);
    // المورد يرى نتيجة الفحص والمرفوض في البوابة
    const portal = (await http.get(`/api/supplier-portal/orders/${o.id}`).set(as(tok.wafa)).expect(200)).body;
    expect(portal.receipts[0]).toMatchObject({ code: 'GRN-0001', inspection: 'مطابق جزئيًا' });
    expect(portal.receipts[0].lines[0]).toMatchObject({ delivered: 70, accepted: 60, rejected: 10, rejectReason: 'أكياس ممزقة' });
  });

  it('keeps warehouse vouchers and their assets read-only in accounting and fixed assets', async () => {
    const g = (await http.get(`${PR}/receipts/${ids.grn1}`).set(as(tok.keeper)).expect(200)).body;
    const c = await http.post(`${A}/entries/${g.entryId}/cancel`).set(as(tok.admin)).send({ reason: 'تجربة' }).expect(409);
    expect(c.body.message).toContain('سند مخازن');
    const [m] = await db.query('SELECT id FROM acc_asset_moves WHERE pr_receipt_id = $1 LIMIT 1', [ids.grn1]);
    const x = await http.post(`${A}/assets/operations/${m.id}/cancel`).set(as(tok.admin)).send({ reason: 'تجربة' }).expect(400);
    expect(x.body.message).toContain('المشتريات');
  });

  it('issues approved requests by FEFO at cost, charged to the cost center', async () => {
    // دفعة ثانية تنتهي أقرب: تُصرف أولًا
    await http.post(`${PR}/receipts`).set(as(tok.keeper)).send({
      kind: 'order', orderId: ids.order, date: today, lines: [{ orderLineId: ids.riceLine, qty: 10, lot: 'L-2', expiryDate: day(40) }],
    }).expect(201);
    const body = { warehouseId: ids.main, purpose: 'توزيع على الأسر', analyticId: acc.cc, receiverName: 'فريق التوزيع', lines: [{ itemId: ids.rice, qty: 25 }] };
    const r = (await http.post(`${PR}/issue-requests?submit=1`).set(as(tok.requester)).send(body).expect(201)).body;
    expect(r).toMatchObject({ code: 'ISR-0001', status: 'submitted' });
    await http.post(`${PR}/issue-requests/${r.id}/approve`).set(as(tok.requester)).send({}).expect(403);
    await http.post(`${PR}/stock-docs/issue`).set(as(tok.keeper)).send({ issueRequestId: r.id, date: today, lines: [{ itemId: ids.rice, qty: 5 }] }).expect(409);
    await http.post(`${PR}/issue-requests/${r.id}/approve`).set(as(tok.controller)).send({}).expect(200);
    await http.post(`${PR}/stock-docs/issue`).set(as(tok.keeper)).send({ issueRequestId: r.id, date: today, lines: [{ itemId: ids.rice, qty: 30 }] }).expect(409);
    const d = (await http.post(`${PR}/stock-docs/issue`).set(as(tok.keeper)).send({ issueRequestId: r.id, date: today, lines: [{ itemId: ids.rice, qty: 15 }] }).expect(201)).body;
    expect(d).toMatchObject({ code: 'ISS-0001', total: 690 });
    // FEFO: العشر الأقرب انتهاءً (L-2) ثم خمس من L-1
    expect(d.lines.map((l: { lot: string; qty: number }) => [l.lot, l.qty])).toEqual([['L-2', 10], ['L-1', 5]]);
    const e = await entry(d.entryId);
    expect(e.net(acc.expense)).toBe(690);
    expect(e.net(acc.inventory)).toBe(-690);
    expect(e.lines.find((l: { account_id: string }) => l.account_id === acc.expense)!.analytic).toEqual([{ analyticId: acc.cc, percent: 100 }]);
    expect((await http.get(`${PR}/issue-requests/${r.id}`).set(as(tok.requester)).expect(200)).body).toMatchObject({ status: 'partial' });
    ids.issueDoc = d.id;
    ids.issueLineL1 = d.lines[1].id;
    // مرتجع من الجهة بتكلفة الصرف
    const back = (await http.post(`${PR}/stock-docs/return-in`).set(as(tok.keeper)).send({ refId: d.id, date: today, notes: 'زيادة عن الحاجة', lines: [{ itemId: ids.rice, qty: 2, refLineId: ids.issueLineL1 }] }).expect(201)).body;
    expect(back).toMatchObject({ code: 'RTN-0001', total: 92 });
    expect(await balance(ids.rice, ids.main)).toEqual({ qty: 57, value: 2622 });
  });

  it('transfers between warehouses without an entry when the inventory account is the same', async () => {
    await http.post(`${PR}/stock-docs/transfer`).set(as(tok.keeper2)).send({ warehouseId: ids.main, toWarehouseId: ids.branch, date: today, lines: [{ itemId: ids.rice, qty: 10 }] }).expect(403);
    const t = (await http.post(`${PR}/stock-docs/transfer`).set(as(tok.keeper)).send({ warehouseId: ids.main, toWarehouseId: ids.branch, date: today, lines: [{ itemId: ids.rice, qty: 10, lot: 'L-1' }] }).expect(201)).body;
    expect(t).toMatchObject({ code: 'TRF-0001', total: 460, entryId: null });
    expect(await balance(ids.rice, ids.branch)).toEqual({ qty: 10, value: 460 });
    expect(await balance(ids.rice, ids.main)).toEqual({ qty: 47, value: 2162 });
  });

  it('returns goods to the supplier from the receipt, giving back the budget and reopening the order quantity', async () => {
    const r = (await http.post(`${PR}/stock-docs/return-supplier`).set(as(tok.keeper)).send({
      refId: ids.grn1, date: today, notes: 'عيب في التغليف', lines: [{ itemId: ids.rice, qty: 5, refLineId: ids.grn1Rice }],
    }).expect(201)).body;
    expect(r).toMatchObject({ code: 'RTS-0001', total: 230, budgetBack: 230 });
    const e = await entry(r.entryId);
    expect(e.net(acc.grni)).toBe(230);
    expect(e.net(acc.inventory)).toBe(-230);
    const rv = (await http.get(`${PR}/receipts/receivable/${ids.order}`).set(as(tok.keeper)).expect(200)).body;
    expect(rv.lines[0]).toMatchObject({ received: 65, remaining: 35 });
    // الاستلام الذي صُرف منه لا يُلغى
    const c = await http.post(`${PR}/receipts/${ids.grn1}/cancel`).set(as(tok.controller)).send({ reason: 'تجربة' }).expect(409);
    expect(c.body.message).toContain('مرتجع');
  });

  it('closes the order when fully received, consuming the whole reservation', async () => {
    const g = (await http.post(`${PR}/receipts`).set(as(tok.keeper)).send({
      kind: 'order', orderId: ids.order, date: today, lines: [{ orderLineId: ids.riceLine, qty: 35, lot: 'L-3', expiryDate: day(200) }],
    }).expect(201)).body;
    expect(g.order.status).toBe('closed');
    const c = await db.query(`SELECT status, amount::float AS amount FROM plan_budget_commitments WHERE source_id = $1 ORDER BY status`, [ids.order]);
    expect(c).toEqual([{ status: 'consumed', amount: 10350 }, { status: 'reserved', amount: 0 }]);
    const [req] = await db.query('SELECT status FROM pr_requests WHERE id = (SELECT request_id FROM pr_orders WHERE id = $1)', [ids.order]);
    expect(req.status).toBe('closed');
  });

  it('records in-kind donations at fair value against donation revenue', async () => {
    await http.post(`${PR}/receipts`).set(as(tok.keeper)).send({ kind: 'donation', warehouseId: ids.main, date: today, lines: [{ itemId: ids.blanket, qty: 20, unitPrice: 50 }] }).expect(400);
    const d = (await http.post(`${PR}/receipts`).set(as(tok.keeper)).send({
      kind: 'donation', warehouseId: ids.main, date: today, donorName: 'فاعل خير', lines: [{ itemId: ids.blanket, qty: 20, unitPrice: 50 }],
    }).expect(201)).body;
    expect(d).toMatchObject({ kind: 'donation', total: 1000 });
    const e = await entry(d.entryId);
    expect(e.net(acc.inventory)).toBe(1000);
    expect(e.net(acc.donation)).toBe(-1000);
    // رصيد افتتاحي يُلغى ما دام لم يُصرف منه
    const op = (await http.post(`${PR}/receipts`).set(as(tok.keeper)).send({ kind: 'opening', warehouseId: ids.main, date: today, lines: [{ itemId: ids.blanket, qty: 4, unitPrice: 40 }] }).expect(201)).body;
    expect(await balance(ids.blanket, ids.main)).toEqual({ qty: 24, value: 1160 });
    await http.post(`${PR}/receipts/${op.id}/cancel`).set(as(tok.keeper)).send({ reason: 'خطأ' }).expect(403);
    await http.post(`${PR}/receipts/${op.id}/cancel`).set(as(tok.controller)).send({ reason: 'إدخال خاطئ' }).expect(200);
    expect(await balance(ids.blanket, ids.main)).toEqual({ qty: 20, value: 1000 });
    expect((await entry(op.entryId)).status).toBe('cancelled');
  });

  it('blocks issuing expired lots, which leave only by an approved write-off', async () => {
    await db.query(`UPDATE pr_stock_layers SET expiry_date = $2 WHERE organization_id = $1 AND lot = 'L-3'`, [org, day(-1)]);
    const r = (await http.post(`${PR}/issue-requests?submit=1`).set(as(tok.requester)).send({ warehouseId: ids.main, purpose: 'مطبخ الجمعية', analyticId: acc.cc, lines: [{ itemId: ids.rice, qty: 60 }] }).expect(201)).body;
    await http.post(`${PR}/issue-requests/${r.id}/approve`).set(as(tok.controller)).send({}).expect(200);
    const x = await http.post(`${PR}/stock-docs/issue`).set(as(tok.keeper)).send({ issueRequestId: r.id, date: today, lines: [{ itemId: ids.rice, qty: 60 }] }).expect(409);
    expect(x.body.message).toContain('منتهية الصلاحية');
    const w = (await http.post(`${PR}/stock-docs/writeoff`).set(as(tok.keeper)).send({ warehouseId: ids.main, date: today, reason: 'expired', notes: 'محضر إتلاف رقم 3', lines: [{ itemId: ids.rice, qty: 35, lot: 'L-3' }] }).expect(201)).body;
    expect(w).toMatchObject({ status: 'pending', can: { approve: false } });
    expect(await balance(ids.rice, ids.main)).toMatchObject({ qty: 77 });
    await http.post(`${PR}/stock-docs/${w.id}/approve`).set(as(tok.keeper)).send({}).expect(403);
    const ok = (await http.post(`${PR}/stock-docs/${w.id}/approve`).set(as(tok.controller)).send({}).expect(200)).body;
    expect(ok).toMatchObject({ status: 'posted', total: 1610 });
    expect((await entry(ok.entryId)).net(acc.adjust)).toBe(1610);
    expect(await balance(ids.rice, ids.main)).toEqual({ qty: 42, value: 1932 });
  });

  it('counts stock, and a different approver posts the shortage as an adjustment', async () => {
    const c = (await http.post(`${PR}/counts`).set(as(tok.keeper)).send({ kind: 'periodic', warehouseId: ids.main, date: today }).expect(201)).body;
    expect(c.code).toBe('CNT-0001');
    await http.post(`${PR}/counts`).set(as(tok.keeper)).send({ kind: 'surprise', warehouseId: ids.main, date: today }).expect(409);
    const lines = c.lines.map((l: { index: number; itemId: string; systemQty: number }) => ({ index: l.index, countedQty: l.itemId === ids.blanket ? l.systemQty - 2 : l.systemQty }));
    await http.post(`${PR}/counts/${c.id}/submit`).set(as(tok.keeper)).send({}).expect(400);
    await http.put(`${PR}/counts/${c.id}/lines`).set(as(tok.keeper)).send({ lines }).expect(200);
    const s = (await http.post(`${PR}/counts/${c.id}/submit`).set(as(tok.keeper)).send({}).expect(200)).body;
    expect(s).toMatchObject({ status: 'submitted', shortage: 100, surplus: 0 });
    const ap = (await http.post(`${PR}/counts/${c.id}/approve`).set(as(tok.controller)).send({}).expect(200)).body;
    expect(ap).toMatchObject({ status: 'approved', shortage: 100 });
    expect(await balance(ids.blanket, ids.main)).toEqual({ qty: 18, value: 900 });
  });

  it('reconciles warehouse values with the chart, and flags differences with the reason', async () => {
    const ok = (await http.get(`${PR}/stock/reconcile`).set(as(tok.controller)).expect(200)).body;
    expect(ok.ok).toBe(true);
    const inv = ok.accounts.find((x: { accountId: string }) => x.accountId === acc.inventory);
    expect(inv.gl).toBe(inv.subledger);
    expect(inv.subledger).toBe(1932 + 460 + 900);
    // قيد على حساب المخزون لم يصدر من المستودعات (يُحاكى بإدراج مباشر لأن النظام يمنعه)
    const [{ id: eid }] = await db.query(`SELECT id FROM acc_entries WHERE organization_id = $1 AND source = 'stock' AND status = 'posted' ORDER BY entry_no LIMIT 1`, [org]);
    await db.query(`UPDATE acc_entries SET source = 'manual' WHERE id = $1`, [eid]);
    await db.query(`UPDATE acc_entry_lines SET debit = debit + 10 WHERE entry_id = $1 AND account_id = $2 AND debit > 0`, [eid, acc.inventory]);
    const bad = (await http.get(`${PR}/stock/reconcile`).set(as(tok.controller)).expect(200)).body;
    const row = bad.accounts.find((x: { accountId: string }) => x.accountId === acc.inventory);
    expect(row).toMatchObject({ ok: false, diff: 10 });
    expect(row.problems[0]).toContain('لم يصدر من المستودعات');
    const tasks = (await http.get('/api/tasks').set(as(tok.controller)).expect(200)).body;
    expect(JSON.stringify(tasks)).toContain('فرق 10 ريال في حساب المخزون');
    await db.query(`UPDATE acc_entry_lines SET debit = debit - 10 WHERE entry_id = $1 AND account_id = $2 AND debit > 0`, [eid, acc.inventory]);
    await db.query(`UPDATE acc_entries SET source = 'stock' WHERE id = $1`, [eid]);
  });

  it('shows balances with reorder and expiry alerts, the item card and the dashboard', async () => {
    const b = (await http.get(`${PR}/stock?alert=reorder`).set(as(tok.keeper)).expect(200)).body;
    expect(b.rows.map((r: { itemId: string }) => r.itemId)).toEqual([]);
    const all = (await http.get(`${PR}/stock`).set(as(tok.keeper)).expect(200)).body;
    expect(all.totals.value).toBe(1932 + 460 + 900);
    const card = (await http.get(`${PR}/stock/items/${ids.rice}?warehouse=${ids.main}`).set(as(tok.keeper)).expect(200)).body;
    expect(card.moves[0]).toMatchObject({ kind: 'writeoff', balanceQty: 42 });
    const dash = (await http.get(`${PR}/dashboard`).set(as(tok.keeper)).expect(200)).body;
    expect(dash.stock).toMatchObject({ value: 3292, reconcile: { ok: true } });
  });
});
