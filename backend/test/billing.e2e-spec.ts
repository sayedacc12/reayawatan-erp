import { Test } from '@nestjs/testing';
import { NestExpressApplication } from '@nestjs/platform-express';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/main';
import { readTlv } from '../src/modules/billing/billing-core.service';

const DB = process.env.TEST_DATABASE_URL ?? 'postgres://erp:erp@localhost:5432/charity_erp_test';
const today = new Date(Date.now() + 3 * 3600_000).toISOString().slice(0, 10);

jest.setTimeout(120_000);

const ADDRESS = { street: 'طريق الملك فهد', buildingNo: '1234', additionalNo: '5678', district: 'العليا', city: 'الرياض', postalCode: '12211', country: 'SA' };

/** الفوترة والمبيعات المرحلة الأولى: الإعدادات والعملاء والأصناف والفواتير والإشعارات والقيد والتحصيل والمطابقة */
describe('Billing stage 1: invoices, notes, entries, collection and reconciliation', () => {
  let app: NestExpressApplication;
  let http: ReturnType<typeof request>;
  let db: DataSource;
  const tok: Record<string, string> = {};
  const ids: Record<string, string> = {};
  let settingsBase: Record<string, unknown> = {};
  const acc: Record<string, string> = {};
  const as = (t: string) => ({ Authorization: `Bearer ${t}` });
  const login = async (login: string, password: string, organization?: string) =>
    (await http.post('/api/auth/login').send({ login, password, organization }).expect(200)).body.accessToken as string;
  const B = '/api/billing';
  const A = '/api/accounting';
  const entry = async (id: string) => {
    const lines: { account_id: string; debit: string; credit: string; partner_id: string | null }[] = await db.query('SELECT account_id, debit, credit, partner_id FROM acc_entry_lines WHERE entry_id = $1', [id]);
    const [e] = await db.query('SELECT voucher_type, source, status, total::float AS total FROM acc_entries WHERE id = $1', [id]);
    const net = (acct: string) => Math.round(lines.filter((l) => l.account_id === acct).reduce((s, l) => s + Number(l.debit) - Number(l.credit), 0) * 100) / 100;
    const dr = Math.round(lines.reduce((s, l) => s + Number(l.debit), 0) * 100);
    const cr = Math.round(lines.reduce((s, l) => s + Number(l.credit), 0) * 100);
    return { ...e, lines, net, balanced: dr === cr };
  };

  beforeAll(async () => {
    Object.assign(process.env, {
      DATABASE_URL: DB, JWT_SECRET: 'test-secret', UPLOAD_DIR: mkdtempSync(join(tmpdir(), 'sanabel-uploads-')), PLATFORM_ADMIN_EMAIL: 'platform@test.org', PLATFORM_ADMIN_PASSWORD: 'Platform123',
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
    await http.post('/api/platform/organizations').set(as(platform)).send({
      name: 'جمعية المبيعات', slug: 'sales', adminFullName: 'مدير النظام', adminEmail: 'admin@sales.org', adminPassword: 'Admin12345',
    }).expect(201);
    tok.admin = await login('admin@sales.org', 'Admin12345', 'sales');
    await http.post('/api/platform/organizations').set(as(platform)).send({
      name: 'جمعية أخرى', slug: 'other', adminFullName: 'مدير آخر', adminEmail: 'admin@other.org', adminPassword: 'Admin12345',
    }).expect(201);
    tok.other = await login('admin@other.org', 'Admin12345', 'other');

    const Y = Number(today.slice(0, 4));
    await http.post(`${A}/chart/install`).set(as(tok.admin)).expect(201);
    const chart = (await http.get(`${A}/accounts`).set(as(tok.admin)).expect(200)).body.accounts as { id: string; code: string; name: string; kind: string; nature: string }[];
    const find = (nature: string, has: string) => chart.find((a) => a.kind === 'sub' && a.nature === nature && a.name.includes(has))!.id;
    acc.ar = find('assets', 'مدينون تجاريون');
    acc.vat = find('liabilities', 'مخرجات');
    acc.revenue = find('revenue', 'مبيعات السلع والخدمات');
    acc.expense = chart.find((a) => a.kind === 'sub' && a.nature === 'expenses')!.id;
    acc.bankGl = chart.find((a) => a.code === '1110100201')!.id;
    await http.post(`${A}/setup`).set(as(tok.admin)).send({
      fiscalYear: Y, startDate: `${Y}-01-01`, endDate: `${Y}-12-31`, isFirstYear: true, firstYearStart: `${Y}-01-01`, firstYearEnd: `${Y}-12-31`,
    }).expect(201);
    ids.bank = (await http.post(`${A}/cash-accounts`).set(as(tok.admin)).send({ kind: 'bank', name: 'الراجحي', bankName: 'مصرف الراجحي', accountNumber: '608010167519', glAccountId: acc.bankGl }).expect(201)).body.id;
    const cats = (await http.get(`${A}/categories`).set(as(tok.admin)).expect(200)).body as { id: string; behavior: string }[];
    ids.customerCat = cats.find((c) => c.behavior === 'customer')!.id;
    ids.supplierCat = cats.find((c) => c.behavior === 'supplier')!.id;

    const role = async (name: string, permissions: string[]) => (await http.post('/api/roles').set(as(tok.admin)).send({ name, permissions }).expect(201)).body.id;
    const user = async (key: string, fullName: string, roleId: string) => {
      const u = await http.post('/api/users').set(as(tok.admin)).send({ fullName, email: `${key}@sales.org`, password: 'Staff12345', roleIds: [roleId] }).expect(201);
      ids[`user_${key}`] = u.body.id;
      tok[key] = await login(`${key}@sales.org`, 'Staff12345', 'sales');
    };
    await user('clerk', 'موظف الفوترة', await role('فوترة', ['billing.dashboard.read', 'billing.invoices.manage', 'billing.customers.manage', 'billing.items.manage']));
    await user('issuer', 'مدير المبيعات', await role('إصدار', ['billing.dashboard.read', 'billing.invoices.issue', 'billing.reports.read']));
    await user('both', 'موظف بصلاحيتين', await role('إنشاء وإصدار', ['billing.dashboard.read', 'billing.invoices.manage', 'billing.invoices.issue']));
    await user('cashier', 'أمين الصندوق', await role('قبض', ['accounting.dashboard.read', 'accounting.receipts.manage', 'accounting.vouchers.approve']));
    await user('outsider', 'موظف آخر', await role('بلا فوترة', ['accounting.dashboard.read']));
  });

  afterAll(async () => {
    await app?.close();
  });

  it('keeps the system off by default and validates the tax settings before enabling it', async () => {
    const lk = (await http.get(`${B}/lookups`).set(as(tok.clerk)).expect(200)).body;
    expect(lk.settings.mode).toBe('off');
    expect(lk.readiness.ready).toBe(false);
    await http.post(`${B}/documents`).set(as(tok.clerk)).send({ kind: 'invoice', buyerName: 'محمد', lines: [{ description: 'خدمة', qty: 1, unitPrice: 100 }] }).expect(400);

    const base = {
      mode: 'registered', sellerName: 'جمعية المبيعات', vatNumber: '310123456700003', idType: 'CRN', idNumber: '1010123456', address: ADDRESS, vatRate: 15, vatEffectiveFrom: '2020-01-01',
      receivablesAccountId: acc.ar, vatOutputAccountId: acc.vat, revenueAccountId: acc.revenue, customerCategoryId: ids.customerCat, paymentDays: 30,
    };
    await http.put(`${B}/settings`).set(as(tok.clerk)).send(base).expect(403);
    await http.put(`${B}/settings`).set(as(tok.admin)).send({ ...base, mode: 'integrated' }).expect(400);
    await http.put(`${B}/settings`).set(as(tok.admin)).send({ ...base, vatNumber: '123' }).expect(400);
    const noAddr = await http.put(`${B}/settings`).set(as(tok.admin)).send({ ...base, address: { ...ADDRESS, buildingNo: null } }).expect(400);
    expect(noAddr.body.message).toContain('رقم المبنى');
    await http.put(`${B}/settings`).set(as(tok.admin)).send({ ...base, revenueAccountId: acc.expense }).expect(400);
    await http.put(`${B}/settings`).set(as(tok.admin)).send({ ...base, customerCategoryId: ids.supplierCat }).expect(400);
    settingsBase = base;
    const ok = (await http.put(`${B}/settings`).set(as(tok.admin)).send(base).expect(200)).body;
    expect(ok.settings.separateIssuer).toBe(true);
    expect(ok.readiness).toMatchObject({ ready: true, missing: [] });
    expect(ok.settings).toMatchObject({ mode: 'registered', vatNumber: '310123456700003', vatRate: 15 });
  });

  it('manages customers and items with their tax data', async () => {
    await http.post(`${B}/customers`).set(as(tok.outsider)).send({ kind: 'individual', name: 'خالد' }).expect(403);
    await http.post(`${B}/customers`).set(as(tok.clerk)).send({ kind: 'business', name: 'شركة', vatNumber: '300000000000000' }).expect(400);
    const c = (await http.post(`${B}/customers`).set(as(tok.clerk)).send({
      kind: 'business', name: 'شركة النخبة للتجارة', vatNumber: '٣٠٠٠٧٥٥٨٨٧٠٠٠٠٣', address: ADDRESS, phone: '0501234567', email: 'ap@nokhba.sa',
    }).expect(200)).body;
    expect(c).toMatchObject({ code: 'CUS-0001', vatNumber: '300075588700003' });
    ids.business = c.id;
    ids.noAddr = (await http.post(`${B}/customers`).set(as(tok.clerk)).send({ kind: 'business', name: 'مؤسسة بلا عنوان', vatNumber: '300075588700013' }).expect(200)).body.id;

    await http.post(`${B}/items`).set(as(tok.clerk)).send({ name: 'تأجير قاعة', kind: 'service', price: 1000, vatCategory: 'E' }).expect(400);
    ids.training = (await http.post(`${B}/items`).set(as(tok.clerk)).send({ name: 'دورة تدريبية', kind: 'service', unit: 'متدرب', price: 100, vatCategory: 'S' }).expect(200)).body.id;
    const hall = (await http.post(`${B}/items`).set(as(tok.clerk)).send({ name: 'تأجير سكن', kind: 'service', price: 1000, vatCategory: 'E', reasonCode: 'VATEX-SA-30' }).expect(200)).body;
    expect(hall.code).toBe('SRV-002');
    ids.housing = hall.id;
    const list = (await http.get(`${B}/items`).set(as(tok.issuer)).expect(200)).body;
    expect(list).toHaveLength(2);
  });

  it('computes a standard invoice per VAT category and blocks it until the buyer data is complete', async () => {
    const bad = (await http.post(`${B}/documents`).set(as(tok.clerk)).send({
      kind: 'invoice', customerId: ids.noAddr, lines: [{ itemId: ids.training, qty: 1, unitPrice: 100 }],
    }).expect(200)).body;
    expect(bad.docType).toBe('standard');
    await http.post(`${B}/documents/${bad.id}/submit`).set(as(tok.clerk)).expect(400);
    await http.post(`${B}/documents/${bad.id}/cancel`).set(as(tok.clerk)).send({ reason: 'عميل خطأ' }).expect(200);

    const d = (await http.post(`${B}/documents`).set(as(tok.clerk)).send({
      kind: 'invoice', customerId: ids.business, supplyDate: today,
      lines: [{ itemId: ids.training, qty: 10, unitPrice: 100, discount: 50 }, { itemId: ids.housing, qty: 1, unitPrice: 1000 }],
    }).expect(200)).body;
    expect(d).toMatchObject({ code: 'INV-000002', status: 'draft', docType: 'standard', gross: 2000, discount: 50, taxable: 1950, vat: 142.5, total: 2092.5 });
    expect(d.breakdown).toEqual(expect.arrayContaining([
      expect.objectContaining({ category: 'S', rate: 15, taxable: 950, vat: 142.5 }),
      expect.objectContaining({ category: 'E', rate: 0, reasonCode: 'VATEX-SA-30', taxable: 1000, vat: 0 }),
    ]));
    ids.inv = d.id;
    await http.post(`${B}/documents`).set(as(tok.clerk)).send({ kind: 'invoice', customerId: ids.business, lines: [{ itemId: ids.training, qty: 1, unitPrice: 100, discount: 150 }] }).expect(400);
    await http.post(`${B}/documents`).set(as(tok.clerk)).send({ kind: 'invoice', customerId: ids.business, lines: [{ itemId: ids.training, qty: 1, unitPrice: 10.555 }] }).expect(400);
    await http.post(`${B}/documents/${d.id}/submit`).set(as(tok.clerk)).expect(200);
  });

  it('issues only by another employee, with UUID, counter, QR and a balanced billing entry', async () => {
    await http.post(`${B}/documents/${ids.inv}/issue`).set(as(tok.clerk)).send({}).expect(403);
    const mine = (await http.post(`${B}/documents`).set(as(tok.both)).send({ kind: 'invoice', buyerName: 'زائر', lines: [{ description: 'رسوم فعالية', qty: 1, unitPrice: 50 }] }).expect(200)).body;
    expect(mine.docType).toBe('simplified');
    await http.post(`${B}/documents/${mine.id}/submit`).set(as(tok.both)).expect(200);
    await http.post(`${B}/documents/${mine.id}/issue`).set(as(tok.both)).send({}).expect(403);
    ids.simplified = mine.id;

    const d = (await http.post(`${B}/documents/${ids.inv}/issue`).set(as(tok.issuer)).send({}).expect(200)).body;
    expect(d).toMatchObject({ status: 'issued', icv: 1, issueDate: today, issuedByName: 'مدير المبيعات' });
    expect(d.uuid).toMatch(/^[0-9a-f-]{36}$/);
    expect(d.qrImage).toMatch(/^data:image\/png;base64,/);
    const tlv = readTlv(d.qr);
    expect(tlv).toMatchObject({ 1: 'جمعية المبيعات', 2: '310123456700003', 4: '2092.50', 5: '142.50' });
    const e = await entry(d.entryId);
    expect(e).toMatchObject({ voucher_type: 'sale', source: 'billing', status: 'posted', balanced: true });
    expect(e.net(acc.ar)).toBe(2092.5);
    expect(e.net(acc.revenue)).toBe(-1950);
    expect(e.net(acc.vat)).toBe(-142.5);
    expect((e.lines.find((l: { account_id: string }) => l.account_id === acc.ar) as { partner_id: string | null }).partner_id).toBeTruthy();

    // القيد ملك الفوترة: لا يُعدّل ولا يُلغى من النظام المالي، والمستند الصادر لا يُعدّل ولا يُلغى
    await http.post(`${A}/entries/${d.entryId}/unpost`).set(as(tok.admin)).expect(409);
    await http.put(`${B}/documents/${ids.inv}`).set(as(tok.clerk)).send({ kind: 'invoice', customerId: ids.business, lines: [{ itemId: ids.training, qty: 1, unitPrice: 100 }] }).expect(409);
    await http.post(`${B}/documents/${ids.inv}/cancel`).set(as(tok.clerk)).send({ reason: 'تجربة' }).expect(409);

    // لا يسبق تاريخ الإصدار آخر مستند صادر، فيبقى العداد مرتبًا بالتاريخ
    const yesterday = new Date(Date.now() + 3 * 3600_000 - 86400_000).toISOString().slice(0, 10);
    await http.post(`${B}/documents/${ids.simplified}/issue`).set(as(tok.issuer)).send({ date: yesterday }).expect(400);
    const s = (await http.post(`${B}/documents/${ids.simplified}/issue`).set(as(tok.issuer)).send({}).expect(200)).body;
    expect(s).toMatchObject({ icv: 2, total: 57.5, vat: 7.5 });
  });

  it('limits credit notes to what is left on each original line and reverses the entry', async () => {
    const line = (await http.get(`${B}/documents/${ids.inv}`).set(as(tok.clerk)).expect(200)).body.creditable[0];
    expect(line.left).toBe(950);
    await http.post(`${B}/documents`).set(as(tok.clerk)).send({ kind: 'credit_note', refId: ids.inv, lines: [{ refLineId: line.lineId, qty: 1, unitPrice: 100 }] }).expect(400);
    await http.post(`${B}/documents`).set(as(tok.clerk)).send({ kind: 'credit_note', refId: ids.inv, reason: 'غياب', lines: [{ refLineId: line.lineId, qty: 10, unitPrice: 100 }] }).expect(400);
    const cn = (await http.post(`${B}/documents`).set(as(tok.clerk)).send({
      kind: 'credit_note', refId: ids.inv, reason: 'غياب متدربين اثنين', lines: [{ refLineId: line.lineId, qty: 2, unitPrice: 95 }],
    }).expect(200)).body;
    expect(cn).toMatchObject({ code: 'CRN-000004', docType: 'standard', taxable: 190, vat: 28.5, total: 218.5 });
    await http.post(`${B}/documents/${cn.id}/submit`).set(as(tok.clerk)).expect(200);
    const issued = (await http.post(`${B}/documents/${cn.id}/issue`).set(as(tok.issuer)).send({}).expect(200)).body;
    const e = await entry(issued.entryId);
    expect(e.net(acc.ar)).toBe(-218.5);
    expect(e.net(acc.vat)).toBe(28.5);
    const inv = (await http.get(`${B}/documents/${ids.inv}`).set(as(tok.clerk)).expect(200)).body;
    expect(inv).toMatchObject({ creditedAmount: 218.5 });
    expect(inv.creditable[0].left).toBe(760);
  });

  it('collects through a receipt voucher owned by finance and updates the paid amount', async () => {
    await http.post(`${B}/documents/${ids.inv}/collect`).set(as(tok.clerk)).send({ date: today, method: 'transfer', cashAccountId: ids.bank, amount: 100 }).expect(403);
    await http.post(`${B}/documents/${ids.inv}/collect`).set(as(tok.cashier)).send({ date: today, method: 'transfer', cashAccountId: ids.bank, amount: 5000 }).expect(400);
    await http.post(`${B}/documents/${ids.inv}/collect`).set(as(tok.cashier)).send({ date: today, method: 'cash', cashAccountId: ids.bank, amount: 100 }).expect(400);
    const d = (await http.post(`${B}/documents/${ids.inv}/collect`).set(as(tok.cashier)).send({ date: today, method: 'transfer', cashAccountId: ids.bank, amount: 1000 }).expect(200)).body;
    expect(d.receipts).toHaveLength(1);
    const v = d.receipts[0];
    expect(v.status).toBe('draft');
    // سند قيد الاعتماد يحجز مبلغه: المتبقي 1874 − 1000
    await http.post(`${B}/documents/${ids.inv}/collect`).set(as(tok.cashier)).send({ date: today, method: 'transfer', cashAccountId: ids.bank, amount: 900 }).expect(400);
    await http.post(`${A}/voucher/${v.id}/submit`).set(as(tok.cashier)).expect(201);
    const after = (await http.get(`${B}/documents/${ids.inv}`).set(as(tok.clerk)).expect(200)).body;
    expect(after).toMatchObject({ status: 'partial', paidAmount: 1000, outstanding: 874 });
    // إشعار دائن أكبر من المتبقي بعد التحصيل يُرفض، فلا يزيد المحصّل عن صافي الفاتورة
    const housingLine = after.creditable[1];
    const over = await http.post(`${B}/documents`).set(as(tok.clerk)).send({
      kind: 'credit_note', refId: ids.inv, reason: 'إلغاء السكن', lines: [{ refLineId: housingLine.lineId, qty: 1, unitPrice: 1000 }],
    }).expect(400);
    expect(over.body.message).toContain('المتبقي على الفاتورة');
  });

  it('reconciles receivables and output VAT with the chart, and flags foreign entries', async () => {
    const rec = (await http.get(`${B}/reconciliation`).set(as(tok.issuer)).expect(200)).body;
    expect(rec.ok).toBe(true);
    const ar = rec.accounts.find((x: { kind: string }) => x.kind === 'receivables');
    expect(ar).toMatchObject({ gl: 931.5, subledger: 931.5, diff: 0 });
    const vat = rec.accounts.find((x: { kind: string }) => x.kind === 'vat');
    expect(vat).toMatchObject({ gl: 121.5, subledger: 121.5 });

    // قيد يدوي على حساب الذمم يظهر علامة حمراء بسببه (الإيراد يحتاج مركز تكلفة فنستعمل البنك)
    await http.post(`${A}/entries`).set(as(tok.admin)).send({
      voucherType: 'journal', documentDate: today, description: 'تسوية يدوية على العملاء', post: true, lines: [
        { accountId: acc.ar, debit: 10, credit: 0 }, { accountId: acc.bankGl, debit: 0, credit: 10 },
      ],
    }).expect(201);
    const red = (await http.get(`${B}/reconciliation`).set(as(tok.issuer)).expect(200)).body;
    const row = red.accounts.find((x: { kind: string }) => x.kind === 'receivables');
    expect(red.ok).toBe(false);
    expect(row).toMatchObject({ gl: 941.5, subledger: 931.5, diff: 10 });
    expect(row.problems[0]).toContain('لم يصدر من نظام الفوترة');
  });

  it('serves the dashboard, statement and reports', async () => {
    const dash = (await http.get(`${B}/dashboard`).set(as(tok.clerk)).expect(200)).body;
    expect(dash.kpis).toMatchObject({ open: 2, customers: 2, items: 2 });
    const st = (await http.get(`${B}/customers/${ids.business}/statement`).set(as(tok.clerk)).expect(200)).body;
    expect(st.closing).toBe(874);
    expect(st.lines.map((l: { kind: string }) => l.kind)).toEqual(['invoice', 'credit_note', 'receipt']);
    const reg = (await http.get('/api/reports/run/billing.register').query({ from: `${today.slice(0, 4)}-01-01`, to: today }).set(as(tok.issuer)).expect(200)).body;
    expect(reg.rows).toHaveLength(3);
    const vat = (await http.get('/api/reports/run/billing.vat').query({ from: `${today.slice(0, 4)}-01-01`, to: today }).set(as(tok.issuer)).expect(200)).body;
    expect(vat.rows.reduce((t: number, r: { vat: number }) => t + r.vat, 0)).toBeCloseTo(121.5, 2);
    await http.get('/api/reports/run/billing.register').query({ from: '2026-01-01', to: today }).set(as(tok.clerk)).expect(403);
  });

  it('denies users without billing permissions and hides one organization from another', async () => {
    await http.get(`${B}/documents`).set(as(tok.outsider)).expect(403);
    await http.get(`${B}/documents/${ids.inv}`).set(as(tok.outsider)).expect(403);
    await http.post(`${B}/documents/${ids.inv}/issue`).set(as(tok.outsider)).send({}).expect(403);
    await http.get(`${B}/documents/${ids.inv}`).set(as(tok.other)).expect(404);
    await http.get(`${B}/customers/${ids.business}`).set(as(tok.other)).expect(404);
    await http.get(`${B}/customers/${ids.business}/statement`).set(as(tok.other)).expect(404);
    await http.put(`${B}/items/${ids.training}`).set(as(tok.other)).send({ name: 'اختراق', kind: 'service', price: 1, vatCategory: 'S' }).expect(404);
    await http.post(`${B}/documents/${ids.inv}/collect`).set(as(tok.other)).send({ date: today, method: 'transfer', cashAccountId: ids.bank, amount: 1 }).expect(404);
    const list = (await http.get(`${B}/documents`).set(as(tok.other)).expect(200)).body;
    expect(list.rows ?? list).toHaveLength(0);
  });

  it('lets each organization turn off the preparer and issuer separation in its settings', async () => {
    const off = (await http.put(`${B}/settings`).set(as(tok.admin)).send({ ...settingsBase, separateIssuer: false }).expect(200)).body;
    expect(off.settings.separateIssuer).toBe(false);
    expect(off.settings.log.at(-1).note).toContain('فصل المُعدّ عن المُصدِر');
    const mine = (await http.post(`${B}/documents`).set(as(tok.both)).send({ kind: 'invoice', buyerName: 'زائر', lines: [{ description: 'رسوم فعالية', qty: 1, unitPrice: 20 }] }).expect(200)).body;
    await http.post(`${B}/documents/${mine.id}/submit`).set(as(tok.both)).expect(200);
    expect((await http.get(`${B}/documents/${mine.id}`).set(as(tok.both)).expect(200)).body.can.issue).toBe(true);
    await http.post(`${B}/documents/${mine.id}/issue`).set(as(tok.both)).send({}).expect(200);
    const on = (await http.put(`${B}/settings`).set(as(tok.admin)).send({ ...settingsBase, separateIssuer: true }).expect(200)).body;
    expect(on.settings.separateIssuer).toBe(true);
  });
});
