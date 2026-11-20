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
const PDF = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n');

jest.setTimeout(120_000);

/** المرحلة الرابعة: فواتير الموردين والمطابقة الثلاثية والمستحقات وسدادها وكشوف الحساب */
describe('Procurement stage 4: supplier invoices, three-way match, payables and statements', () => {
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
  const SP = '/api/supplier-portal';
  const entry = async (id: string) => {
    const lines: { account_id: string; debit: string; credit: string; partner_id: string | null }[] = await db.query('SELECT account_id, debit, credit, partner_id FROM acc_entry_lines WHERE entry_id = $1 ORDER BY line_no', [id]);
    const [e] = await db.query('SELECT voucher_type, source, status, total::float AS total FROM acc_entries WHERE id = $1', [id]);
    const net = (acct: string) => Math.round(lines.filter((l) => l.account_id === acct).reduce((s, l) => s + Number(l.debit) - Number(l.credit), 0) * 100) / 100;
    return { ...e, lines, net };
  };
  const consumed = async (line: string) => (await db.query(`SELECT COALESCE(SUM(amount), 0)::float AS c FROM plan_budget_commitments WHERE line_id = $1 AND status = 'consumed'`, [line]))[0].c as number;

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
      name: 'جمعية الفواتير', slug: 'fawater', adminFullName: 'مدير النظام', adminEmail: 'admin@fawater.org', adminPassword: 'Admin12345',
    }).expect(201)).body.id;
    tok.admin = await login('admin@fawater.org', 'Admin12345', 'fawater');
    await http.post('/api/platform/organizations').set(as(platform)).send({
      name: 'جمعية أخرى', slug: 'other', adminFullName: 'مدير آخر', adminEmail: 'admin@other.org', adminPassword: 'Admin12345',
    }).expect(201);
    tok.other = await login('admin@other.org', 'Admin12345', 'other');

    const Y = Number(today.slice(0, 4));
    await http.post(`${A}/chart/install`).set(as(tok.admin)).expect(201);
    const chart = (await http.get(`${A}/accounts`).set(as(tok.admin)).expect(200)).body.accounts as { id: string; code: string; name: string; kind: string; nature: string }[];
    const sub = (nature: string, has?: string, skip = 0) => chart.filter((a) => a.kind === 'sub' && a.nature === nature && (!has || a.name.includes(has)))[skip].id;
    acc.inventory = sub('assets', 'مخزون');
    acc.grni = sub('liabilities', 'مستحق');
    acc.adjust = sub('expenses', undefined, 1);
    acc.expense = sub('expenses');
    acc.vatIn = sub('assets', 'مدخلات');
    acc.payables = chart.find((a) => a.code === '2130200101')!.id;
    acc.bankGl = chart.find((a) => a.code === '1110100201')!.id;
    const analytic = (await http.get(`${A}/analytic`).set(as(tok.admin)).expect(200)).body.accounts as { id: string; code: string }[];
    acc.cc = analytic.find((x) => x.code === 'CC01')?.id ?? analytic[0].id;
    await http.post(`${A}/setup`).set(as(tok.admin)).send({
      fiscalYear: Y, startDate: `${Y}-01-01`, endDate: `${Y}-12-31`, isFirstYear: true, firstYearStart: `${Y}-01-01`, firstYearEnd: `${Y}-12-31`,
    }).expect(201);
    const byCode = (c: string) => chart.find((a) => a.code === c)!.id;
    acc.assetAccount = byCode('1211000101');
    ids.assetGroup = (await http.post(`${A}/assets/groups`).set(as(tok.admin)).send({
      code: 'IT', name: 'أجهزة الحاسب', method: 'straight_line', lifeYears: 4, assetAccountId: acc.assetAccount, accumAccountId: byCode('2250101001'),
      expenseAccountId: byCode('4131000101'), gainLossAccountId: byCode('3120500401'), analyticId: acc.cc,
    }).expect(201)).body.id;
    ids.bank = (await http.post(`${A}/cash-accounts`).set(as(tok.admin)).send({ kind: 'bank', name: 'الراجحي', bankName: 'مصرف الراجحي', accountNumber: '608010167519', glAccountId: acc.bankGl }).expect(201)).body.id;

    const role = async (name: string, permissions: string[]) => (await http.post('/api/roles').set(as(tok.admin)).send({ name, permissions }).expect(201)).body.id;
    const user = async (key: string, fullName: string, roleId: string) => {
      const u = await http.post('/api/users').set(as(tok.admin)).send({ fullName, email: `${key}@fawater.org`, password: 'Staff12345', roleIds: [roleId] }).expect(201);
      ids[`user_${key}`] = u.body.id;
      tok[key] = await login(`${key}@fawater.org`, 'Staff12345', 'fawater');
    };
    await user('buyer', 'مسؤول المشتريات', await role('مشتريات', ['procurement.dashboard.read', 'procurement.sourcing.manage', 'procurement.requests.create', 'procurement.suppliers.read']));
    await user('approver', 'مدير المشتريات', await role('معتمد', ['procurement.orders.approve', 'procurement.requests.approve', 'procurement.dashboard.read']));
    await user('keeper', 'أمين المستودع', await role('أمين مستودع', ['procurement.dashboard.read', 'procurement.stock.operate']));
    await user('clerk', 'مراجع الفواتير', await role('فواتير', ['procurement.invoices.manage', 'procurement.suppliers.read']));
    await user('auditor', 'رئيس المشتريات', await role('تجاوز', ['procurement.invoices.override']));
    await user('accountant', 'محاسب الدائنين', await role('دائنون', ['accounting.dashboard.read', 'accounting.payables.manage']));
    await user('cashier', 'أمين الصندوق', await role('صرف', ['accounting.dashboard.read', 'accounting.payments.manage', 'accounting.vouchers.approve']));

    // الأصناف والمستودع والإعدادات: الضريبة قابلة للاسترداد (ليست من التكلفة)، وتجاوز سعر مسموح 2%
    const lk = (await http.get(`${PR}/lookups`).set(as(tok.admin)).expect(200)).body;
    const grp = (c: string) => lk.groups.find((g: { code: string }) => g.code === c).id;
    ids.piece = lk.uoms.find((u: { name: string }) => u.name === 'حبة').id;
    await http.patch(`${PR}/groups/${grp('AID')}`).set(as(tok.admin)).send({ code: 'AID', name: 'المساعدات العينية', kind: 'stock', inventoryAccountId: acc.inventory, expenseAccountId: acc.expense }).expect(200);
    ids.blanket = (await http.post(`${PR}/items`).set(as(tok.admin)).send({ name: 'بطانية شتوية', groupId: grp('AID'), uomId: ids.piece }).expect(201)).body.id;
    ids.heater = (await http.post(`${PR}/items`).set(as(tok.admin)).send({ name: 'دفاية كهربائية', groupId: grp('AID'), uomId: ids.piece }).expect(201)).body.id;
    await http.patch(`${PR}/groups/${grp('FA')}`).set(as(tok.admin)).send({ code: 'FA', name: 'الأصول الثابتة', kind: 'asset', assetGroupId: ids.assetGroup }).expect(200);
    ids.laptop = (await http.post(`${PR}/items`).set(as(tok.admin)).send({ name: 'حاسب محمول', groupId: grp('FA'), uomId: ids.piece, kind: 'asset' }).expect(201)).body.id;
    ids.main = (await http.post(`${PR}/warehouses`).set(as(tok.admin)).send({ code: 'WH-01', name: 'المستودع الرئيس', kind: 'main', keeperIds: [ids.user_keeper] }).expect(201)).body.id;
    await http.put(`${PR}/stock-settings`).set(as(tok.admin)).send({
      grniAccountId: acc.grni, adjustAccountId: acc.adjust, adjustAnalyticId: acc.cc, defaultExpenseAccountId: acc.expense, expiryAlertDays: 60, overReceiptPct: 0, vatInCost: false, requireInspection: false,
    }).expect(200);
    await http.put(`${PR}/invoice-settings`).set(as(tok.admin)).send({ matchTolerancePct: 2, vatInputAccountId: acc.expense, paymentDays: 30 }).expect(400);
    const st = (await http.put(`${PR}/invoice-settings`).set(as(tok.admin)).send({ matchTolerancePct: 2, vatInputAccountId: acc.vatIn, paymentDays: 30 }).expect(200)).body;
    expect(st).toMatchObject({ matchTolerancePct: 2, paymentDays: 30 });
    const cats = (await http.get(`${A}/categories`).set(as(tok.admin)).expect(200)).body as { id: string; behavior: string }[];
    await http.put(`${PR}/settings`).set(as(tok.admin)).send({ partnerCategoryId: cats.find((c) => c.behavior === 'supplier')!.id, payablesAccountId: acc.payables }).expect(200);

    // مورد معتمد مرتبط بشريك، ومستخدم بوابة للمالية، وموازنة معتمدة
    const [s] = await db.query(`INSERT INTO pr_suppliers (organization_id, supplier_no, name, status, email, created_by_name) VALUES ($1, 1, 'مؤسسة الدفء', 'approved', 'dafa@vendor.sa', 'اختبار') RETURNING id`, [org]);
    ids.supplier = s.id;
    ids.partner = (await http.post(`${PR}/suppliers/${s.id}/partner`).set(as(tok.admin)).expect(200)).body.partner.id;
    await db.query(`INSERT INTO pr_supplier_users (organization_id, supplier_id, full_name, email, role, password_hash) VALUES ($1, $2, 'محاسب الدفء', 'dafa@vendor.sa', 'finance', $3)`,
      [org, s.id, await bcrypt.hash('Supplier123', 10)]);
    tok.dafa = (await http.post(`${SP}/o/fawater/login`).send({ email: 'dafa@vendor.sa', password: 'Supplier123' }).expect(200)).body.accessToken;
    const [b] = await db.query(`INSERT INTO plan_budgets (organization_id, code, title, fiscal_year, status, version, created_by_name) VALUES ($1, 'BG-001', 'الموازنة', $2, 'approved', 1, 'اختبار') RETURNING id`, [org, Y]);
    ids.line = (await db.query(`INSERT INTO plan_budget_lines (organization_id, budget_id, section, kind, name, amount) VALUES ($1, $2, 'opex', 'manual', 'كسوة الشتاء', 100000) RETURNING id`, [org, b.id]))[0].id;

    // تعميد: 100 بطانية × 50 و20 دفاية × 100، ضريبة 15%، واستلام 60 بطانية و20 دفاية بمصاريف نقل 100
    const r = (await http.post(`${PR}/requests`).set(as(tok.buyer)).send({
      title: 'كسوة الشتاء', kind: 'goods', priority: 'normal', neededBy: day(10), method: 'direct', budgetLineId: ids.line,
      lines: [{ itemId: ids.blanket, description: 'بطانية شتوية', qty: 100, uomId: ids.piece, estPrice: 50 }, { itemId: ids.heater, description: 'دفاية كهربائية', qty: 20, uomId: ids.piece, estPrice: 100 }],
    }).expect(201)).body;
    await http.post(`${PR}/requests/${r.id}/submit`).set(as(tok.buyer)).send({}).expect(200);
    await http.post(`${PR}/requests/${r.id}/approve`).set(as(tok.approver)).send({}).expect(200);
    const o = (await http.post(`${PR}/orders`).set(as(tok.buyer)).send({
      requestId: r.id, supplierId: ids.supplier, vatRate: 15, warehouseId: ids.main, deliveryDate: day(5),
      lines: r.lines.map((l: { id: string; estPrice: number; qty: number }) => ({ lineId: l.id, qty: l.qty, unitPrice: l.estPrice })),
    }).expect(201)).body;
    await http.post(`${PR}/orders/${o.id}/submit`).set(as(tok.buyer)).send({}).expect(200);
    const issued = (await http.post(`${PR}/orders/${o.id}/approve`).set(as(tok.approver)).send({}).expect(200)).body;
    ids.order = o.id;
    ids.blanketLine = issued.lines[0].lineId;
    ids.heaterLine = issued.lines[1].lineId;
    const g = (await http.post(`${PR}/receipts`).set(as(tok.keeper)).send({
      kind: 'order', orderId: o.id, date: today, extraCost: 100, lines: [{ orderLineId: ids.blanketLine, qty: 60 }, { orderLineId: ids.heaterLine, qty: 20 }],
    }).expect(201)).body;
    expect(g.total).toBe(5100);
    expect((await entry(g.entryId)).net(acc.grni)).toBe(-5100);
  });

  afterAll(async () => {
    await app?.get(DataSource).destroy();
    await app?.close();
    rmSync(uploadDir, { recursive: true, force: true });
  });

  it('lets the supplier draft an invoice in the portal and flags three-way match exceptions', async () => {
    const orders = (await http.get(`${SP}/billable`).set(as(tok.dafa)).expect(200)).body;
    expect(orders.map((x: { id: string }) => x.id)).toEqual([ids.order]);
    const bl = (await http.get(`${SP}/billable/${ids.order}`).set(as(tok.dafa)).expect(200)).body;
    expect(bl.lines.map((l: { received: number; left: number }) => [l.received, l.left])).toEqual([[60, 60], [20, 20]]);
    expect(bl.extraLeft).toBe(100);

    const body = (lines: object[], extra: object = {}) => ({ kind: 'invoice', orderId: ids.order, supplierInvoiceNo: 'INV 0012', invoiceDate: today, lines, extraAmount: 100, ...extra });
    // 80 بطانية أكثر من المستلم، وسعر 55 أعلى من سعر التعميد بأكثر من 2%
    const d = (await http.post(`${SP}/invoices`).set(as(tok.dafa)).send(body([{ orderLineId: ids.blanketLine, qty: 80, unitPrice: 55 }, { orderLineId: ids.heaterLine, qty: 20, unitPrice: 100 }])).expect(200)).body;
    ids.inv = d.id;
    expect(d).toMatchObject({ code: 'INV-0001', status: 'draft', subtotal: 6500, vat: 975, total: 7475 });
    expect(d.match.ok).toBe(false);
    expect(d.match.issues.map((x: { kind: string }) => x.kind).sort()).toEqual(['price', 'qty']);
    // لا يُرسل بلا صورة الفاتورة
    await http.post(`${SP}/invoices/${d.id}/submit`).set(as(tok.dafa)).expect(400);
    await http.post(`${SP}/invoices/${d.id}/files`).set(as(tok.dafa)).attach('file', PDF, { filename: 'invoice.pdf', contentType: 'application/pdf' }).expect(200);
    const sent = (await http.post(`${SP}/invoices/${d.id}/submit`).set(as(tok.dafa)).expect(200)).body;
    expect(sent.status).toBe('submitted');
  });

  it('keeps unmatched invoices from approval without an override, and returns them to the supplier', async () => {
    await http.get(`${PR}/invoices`).set(as(tok.keeper)).expect(403);
    await http.get(`${PR}/invoices/${ids.inv}`).set(as(tok.other)).expect(404);
    const v = (await http.get(`${PR}/invoices/${ids.inv}`).set(as(tok.clerk)).expect(200)).body;
    expect(v.can).toMatchObject({ approve: true, override: false, post: false });
    const r = await http.post(`${PR}/invoices/${ids.inv}/approve`).set(as(tok.clerk)).send({}).expect(409);
    expect(r.body.message).toContain('غير مطابقة');
    await http.post(`${PR}/invoices/${ids.inv}/messages`).set(as(tok.clerk)).send({ text: 'الكمية المستلمة 60 بطانية فقط' }).expect(200);
    const back = (await http.post(`${PR}/invoices/${ids.inv}/return`).set(as(tok.clerk)).send({ reason: 'صحح الكمية والسعر حسب الاستلام والتعميد' }).expect(200)).body;
    expect(back).toMatchObject({ status: 'returned' });
    const portal = (await http.get(`${SP}/invoices/${ids.inv}`).set(as(tok.dafa)).expect(200)).body;
    expect(portal).toMatchObject({ status: 'returned', returnReason: 'صحح الكمية والسعر حسب الاستلام والتعميد', can: { edit: true } });
    expect(portal.messages[0].text).toContain('60');
    expect(portal.override).toBeUndefined();
  });

  it('rejects duplicate supplier invoice numbers and approves the corrected match within tolerance', async () => {
    // رقم مكرر بصيغة أخرى من الموظف
    const dup = await http.post(`${PR}/invoices`).set(as(tok.clerk)).send({
      kind: 'invoice', orderId: ids.order, supplierInvoiceNo: 'inv-12', invoiceDate: today, lines: [{ orderLineId: ids.heaterLine, qty: 1, unitPrice: 100 }],
    }).expect(409);
    expect(dup.body.message).toContain('INV-0001');
    const fixed = (await http.put(`${SP}/invoices/${ids.inv}`).set(as(tok.dafa)).send({
      kind: 'invoice', orderId: ids.order, supplierInvoiceNo: 'INV 0012', invoiceDate: today, extraAmount: 100,
      lines: [{ orderLineId: ids.blanketLine, qty: 60, unitPrice: 51 }, { orderLineId: ids.heaterLine, qty: 20, unitPrice: 100 }],
    }).expect(200)).body;
    expect(fixed).toMatchObject({ subtotal: 5160, vat: 774, total: 5934 });
    expect(fixed.match.ok).toBe(true);
    await http.post(`${SP}/invoices/${ids.inv}/submit`).set(as(tok.dafa)).expect(200);
    const ok = (await http.post(`${PR}/invoices/${ids.inv}/approve`).set(as(tok.clerk)).send({ note: 'مطابقة' }).expect(200)).body;
    expect(ok).toMatchObject({ status: 'approved', approvedByName: 'مراجع الفواتير', override: null });
    // كل المستلم فُوتر
    const bl = (await http.get(`${PR}/orders/${ids.order}/billable`).set(as(tok.clerk)).expect(200)).body;
    expect(bl.lines.map((l: { left: number }) => l.left)).toEqual([0, 0]);
    expect(bl.extraLeft).toBe(0);
  });

  it('enforces segregation and overrides on staff-registered invoices', async () => {
    const x = (await http.post(`${PR}/invoices`).set(as(tok.clerk)).send({
      kind: 'invoice', orderId: ids.order, supplierInvoiceNo: 'P-900', invoiceDate: today, lines: [{ orderLineId: ids.blanketLine, qty: 5, unitPrice: 50 }],
    }).expect(200)).body;
    await http.post(`${PR}/invoices/${x.id}/submit`).set(as(tok.clerk)).expect(200);
    // من سجلها لا يعتمدها، وصاحب التجاوز يحتاج سببًا
    await http.post(`${PR}/invoices/${x.id}/approve`).set(as(tok.clerk)).send({}).expect(403);
    await http.post(`${PR}/invoices/${x.id}/approve`).set(as(tok.auditor)).send({}).expect(400);
    const rej = (await http.post(`${PR}/invoices/${x.id}/reject`).set(as(tok.auditor)).send({ reason: 'لا يوجد استلام مقابل' }).expect(200)).body;
    expect(rej.status).toBe('rejected');
  });

  it('records the payable in accounting only, charging the price difference to the budget', async () => {
    // قيود فواتير الموردين لا تُنشأ يدويًا
    await http.post(`${A}/entries`).set(as(tok.admin)).send({
      voucherType: 'bill', documentDate: today, description: 'يدوي', lines: [{ accountId: acc.grni, debit: 10, credit: 0 }, { accountId: acc.payables, debit: 0, credit: 10 }],
    }).expect(400);
    await http.post(`${PR}/invoices/${ids.inv}/post`).set(as(tok.clerk)).send({}).expect(403);
    const before = await consumed(ids.line);
    const p = (await http.post(`${PR}/invoices/${ids.inv}/post`).set(as(tok.accountant)).send({}).expect(200)).body;
    expect(p).toMatchObject({ status: 'posted', budgetDiff: 184, outstanding: 5934 });
    const e = await entry(p.entry.id);
    expect(e).toMatchObject({ voucher_type: 'bill', source: 'payables', status: 'posted' });
    expect(e.net(acc.grni)).toBe(5100);
    expect(e.net(acc.vatIn)).toBe(774);
    expect(e.net(acc.adjust)).toBe(60);
    expect(e.net(acc.payables)).toBe(-5934);
    expect(e.lines.find((l: { credit: string }) => Number(l.credit) > 0)!.partner_id).toBe(ids.partner);
    // فرق السعر شامل الضريبة والمصاريف المفوترة: 5934 − (60×50 + 20×100) × 1.15 = 184
    expect(Math.round((await consumed(ids.line)) - before)).toBe(184);
    // القيد لا يُلغى من شاشة القيود
    const c = await http.post(`${A}/entries/${p.entry.id}/cancel`).set(as(tok.admin)).send({ reason: 'تجربة' });
    expect(c.status).toBe(409);
    expect(c.body.message).toContain('مستحقات الموردين');
  });

  it('pays through payment vouchers and blocks unposting a paid invoice', async () => {
    await http.post(`${PR}/invoices/${ids.inv}/pay`).set(as(tok.accountant)).send({ date: today, method: 'bank', cashAccountId: ids.bank, amount: 1000 }).expect(403);
    await http.post(`${PR}/invoices/${ids.inv}/pay`).set(as(tok.cashier)).send({ date: today, method: 'bank', cashAccountId: ids.bank, amount: 9000 }).expect(400);
    const p = (await http.post(`${PR}/invoices/${ids.inv}/pay`).set(as(tok.cashier)).send({ date: today, method: 'bank', cashAccountId: ids.bank, amount: 2000 }).expect(200)).body;
    expect(p).toMatchObject({ status: 'posted', pendingPay: 2000 });
    const v = p.payments[0];
    // السند من المشتريات لا يُعدَّل، ويُعتمد من سندات الصرف
    const vv = (await http.get(`${A}/voucher/${v.id}`).set(as(tok.cashier)).expect(200)).body;
    expect(vv).toMatchObject({ lockedSource: true, can: { edit: false } });
    await http.post(`${A}/voucher/${v.id}/submit`).set(as(tok.cashier)).expect(201);
    const after = (await http.get(`${PR}/invoices/${ids.inv}`).set(as(tok.accountant)).expect(200)).body;
    expect(after).toMatchObject({ status: 'partial', paidAmount: 2000, outstanding: 3934, can: { unpost: false } });
    await http.post(`${PR}/invoices/${ids.inv}/unpost`).set(as(tok.accountant)).send({ reason: 'تجربة الإلغاء' }).expect(409);
  });

  it('applies a supplier credit note against the invoice and shows the statement in both portals', async () => {
    const cn = (await http.post(`${SP}/invoices`).set(as(tok.dafa)).send({
      kind: 'credit_note', orderId: ids.order, refInvoiceId: ids.inv, supplierInvoiceNo: 'CN-5', invoiceDate: today, lines: [{ orderLineId: ids.blanketLine, qty: 10, unitPrice: 51 }],
    }).expect(200)).body;
    expect(cn).toMatchObject({ code: 'CRN-0003', total: 586.5 });
    await http.post(`${SP}/invoices/${cn.id}/files`).set(as(tok.dafa)).attach('file', PDF, { filename: 'cn.pdf', contentType: 'application/pdf' }).expect(200);
    await http.post(`${SP}/invoices/${cn.id}/submit`).set(as(tok.dafa)).expect(200);
    await http.post(`${PR}/invoices/${cn.id}/approve`).set(as(tok.clerk)).send({}).expect(200);
    const posted = (await http.post(`${PR}/invoices/${cn.id}/post`).set(as(tok.accountant)).send({}).expect(200)).body;
    const e = await entry(posted.entry.id);
    expect(e.net(acc.payables)).toBe(586.5);
    expect(e.net(acc.grni)).toBe(-500);
    expect(e.net(acc.vatIn)).toBe(-76.5);
    expect(e.net(acc.adjust)).toBe(-10);
    const inv = (await http.get(`${PR}/invoices/${ids.inv}`).set(as(tok.accountant)).expect(200)).body;
    expect(inv).toMatchObject({ creditedAmount: 586.5, outstanding: 3347.5, status: 'partial' });

    const staff = (await http.get(`${PR}/suppliers/${ids.supplier}/statement`).set(as(tok.clerk)).expect(200)).body;
    expect(staff.lines.map((l: { kind: string; debit: number; credit: number }) => [l.kind, l.debit, l.credit])).toEqual([['invoice', 0, 5934], ['payment', 2000, 0], ['credit_note', 586.5, 0]]);
    expect(staff.closing).toBe(3347.5);
    const portal = (await http.get(`${SP}/statement`).set(as(tok.dafa)).expect(200)).body;
    expect(portal.closing).toBe(3347.5);
    const later = (await http.get(`${SP}/statement?from=${day(1)}`).set(as(tok.dafa)).expect(200)).body;
    expect(later).toMatchObject({ opening: 3347.5, closing: 3347.5, lines: [] });
    await http.get(`${PR}/suppliers/${ids.supplier}/statement`).set(as(tok.other)).expect(404);

    const pay = (await http.get(`${PR}/payables`).set(as(tok.accountant)).expect(200)).body;
    expect(pay.totals).toMatchObject({ outstanding: 3347.5, toPost: 0, overdue: 0 });
    expect(pay.aging.current).toBe(3347.5);
    await http.get(`${PR}/payables`).set(as(tok.clerk)).expect(403);
  });

  it('adds the invoice price difference of a fixed-asset line to the asset cost', async () => {
    const r = (await http.post(`${PR}/requests`).set(as(tok.buyer)).send({
      title: 'أجهزة', kind: 'assets', priority: 'normal', neededBy: day(10), method: 'direct', budgetLineId: ids.line,
      lines: [{ itemId: ids.laptop, description: 'حاسب محمول', qty: 2, uomId: ids.piece, estPrice: 2500 }],
    }).expect(201)).body;
    await http.post(`${PR}/requests/${r.id}/submit`).set(as(tok.buyer)).send({}).expect(200);
    await http.post(`${PR}/requests/${r.id}/approve`).set(as(tok.approver)).send({}).expect(200);
    const o = (await http.post(`${PR}/orders`).set(as(tok.buyer)).send({
      requestId: r.id, supplierId: ids.supplier, vatRate: 15, warehouseId: ids.main, deliveryDate: day(5), lines: [{ lineId: r.lines[0].id, qty: 2, unitPrice: 2500 }],
    }).expect(201)).body;
    await http.post(`${PR}/orders/${o.id}/submit`).set(as(tok.buyer)).send({}).expect(200);
    const issued = (await http.post(`${PR}/orders/${o.id}/approve`).set(as(tok.approver)).send({}).expect(200)).body;
    const g = (await http.post(`${PR}/receipts`).set(as(tok.keeper)).send({ kind: 'order', orderId: o.id, date: today, lines: [{ orderLineId: issued.lines[0].lineId, qty: 2 }] }).expect(201)).body;
    const assetIds: string[] = g.lines[0].assets.map((x: { id: string }) => x.id);
    expect(assetIds).toHaveLength(2);
    const inv = (await http.post(`${SP}/invoices`).set(as(tok.dafa)).send({
      kind: 'invoice', orderId: o.id, supplierInvoiceNo: 'LP-77', invoiceDate: today, lines: [{ orderLineId: issued.lines[0].lineId, qty: 2, unitPrice: 2550 }],
    }).expect(200)).body;
    await http.post(`${SP}/invoices/${inv.id}/files`).set(as(tok.dafa)).attach('file', PDF, { filename: 'lp.pdf', contentType: 'application/pdf' }).expect(200);
    await http.post(`${SP}/invoices/${inv.id}/submit`).set(as(tok.dafa)).expect(200);
    await http.post(`${PR}/invoices/${inv.id}/approve`).set(as(tok.clerk)).send({}).expect(200);
    const p = (await http.post(`${PR}/invoices/${inv.id}/post`).set(as(tok.accountant)).send({}).expect(200)).body;
    const e = await entry(p.entry.id);
    expect(e.net(acc.assetAccount)).toBe(100);
    expect(e.net(acc.grni)).toBe(5000);
    expect(e.net(acc.vatIn)).toBe(765);
    expect(e.net(acc.adjust)).toBe(0);
    expect(e.net(acc.payables)).toBe(-5865);
    const costs = await db.query('SELECT cost::float AS cost FROM acc_assets WHERE id = ANY($1) ORDER BY asset_no', [assetIds]);
    expect(costs).toEqual([{ cost: 2550 }, { cost: 2550 }]);
    // سجل الأصول يبقى مطابقًا لحساب الأصل في الدليل
    const rec = (await http.get(`${A}/assets/reconciliation`).set(as(tok.admin)).expect(200)).body;
    expect(rec.ok).toBe(true);
    // إلغاء التسجيل يعيد التكلفة
    await http.post(`${PR}/invoices/${inv.id}/unpost`).set(as(tok.accountant)).send({ reason: 'تصحيح تاريخ القيد' }).expect(200);
    const back = await db.query('SELECT cost::float AS cost FROM acc_assets WHERE id = ANY($1) ORDER BY asset_no', [assetIds]);
    expect(back).toEqual([{ cost: 2500 }, { cost: 2500 }]);
  });
});
