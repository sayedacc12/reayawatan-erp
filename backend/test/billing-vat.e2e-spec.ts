import { Test } from '@nestjs/testing';
import { NestExpressApplication } from '@nestjs/platform-express';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/main';
import { quarterPeriod } from '../src/modules/billing/billing.reports';
import { readTlv } from '../src/modules/billing/billing-core.service';

const DB = process.env.TEST_DATABASE_URL ?? 'postgres://erp:erp@localhost:5432/charity_erp_test';
const day = (offset: number) => new Date(Date.now() + 3 * 3600_000 + offset * 86400_000).toISOString().slice(0, 10);
const today = day(0);
const tomorrow = day(1);
const yesterday = day(-1);
const quarterOf = (d: string) => `${d.slice(0, 4)}-Q${Math.floor((Number(d.slice(5, 7)) - 1) / 3) + 1}`;

jest.setTimeout(120_000);

const ADDRESS = { street: 'طريق الملك فهد', buildingNo: '1234', additionalNo: '5678', district: 'العليا', city: 'الرياض', postalCode: '12211', country: 'SA' };

/** تاريخ نفاذ التسجيل في الضريبة، والحساب البنكي في الفاتورة، ومسودة الإقرار الربع سنوي، والبيانات الضريبية من الإعدادات الافتراضية */
describe('Billing: VAT start date, bank details on invoices and the quarterly VAT return', () => {
  let app: NestExpressApplication;
  let http: ReturnType<typeof request>;
  let db: DataSource;
  const tok: Record<string, string> = {};
  const ids: Record<string, string> = {};
  const as = (t: string) => ({ Authorization: `Bearer ${t}` });
  const login = async (login: string, password: string, organization?: string) =>
    (await http.post('/api/auth/login').send({ login, password, organization }).expect(200)).body.accessToken as string;
  const B = '/api/billing';
  const A = '/api/accounting';

  /** منشأة بدليل وسنة مالية وحساب بنكي وموظفين: مُعدّ ومُصدِر */
  async function setupOrg(key: string, platform: string, staff = true) {
    await http.post('/api/platform/organizations').set(as(platform)).send({
      name: `شركة ${key}`, slug: key, adminFullName: 'مدير النظام', adminEmail: `admin@${key}.sa`, adminPassword: 'Admin12345',
    }).expect(201);
    const admin = await login(`admin@${key}.sa`, 'Admin12345', key);
    const Y = Number(today.slice(0, 4));
    await http.post(`${A}/chart/install`).set(as(admin)).expect(201);
    const chart = (await http.get(`${A}/accounts`).set(as(admin)).expect(200)).body.accounts as { id: string; code: string; name: string; kind: string; nature: string }[];
    const find = (nature: string, has: string) => chart.find((a) => a.kind === 'sub' && a.nature === nature && a.name.includes(has))!.id;
    await http.post(`${A}/setup`).set(as(admin)).send({
      fiscalYear: Y, startDate: `${Y}-01-01`, endDate: `${Y}-12-31`, isFirstYear: true, firstYearStart: `${Y}-01-01`, firstYearEnd: `${Y}-12-31`,
    }).expect(201);
    const bankGl = chart.find((a) => a.code.startsWith('11101') && a.kind === 'sub' && a.nature === 'assets')!.id;
    const bank = (await http.post(`${A}/cash-accounts`).set(as(admin)).send({
      kind: 'bank', name: `حساب ${key} الجاري`, bankName: 'مصرف الراجحي', accountNumber: '608010167519', iban: 'SA0380000000608010167519', glAccountId: bankGl,
    }).expect(201)).body.id;
    const role = async (name: string, permissions: string[]) => (await http.post('/api/roles').set(as(admin)).send({ name, permissions }).expect(201)).body.id;
    const user = async (u: string, permissions: string[]) => {
      await http.post('/api/users').set(as(admin)).send({ fullName: `${u} ${key}`, email: `${u}@${key}.sa`, password: 'Staff12345', roleIds: [await role(u, permissions)] }).expect(201);
      return login(`${u}@${key}.sa`, 'Staff12345', key);
    };
    if (!staff) return { admin, clerk: admin, issuer: admin, bank, settings: {} as Record<string, unknown> };
    const clerk = await user('clerk', ['billing.dashboard.read', 'billing.invoices.manage', 'billing.customers.manage', 'billing.items.manage']);
    const issuer = await user('issuer', ['billing.dashboard.read', 'billing.invoices.issue', 'billing.reports.read']);
    const settings = {
      mode: 'registered', sellerName: `شركة ${key}`, vatNumber: '314466205600003', idType: 'CRN', idNumber: '7052873945', address: ADDRESS, vatRate: 15,
      receivablesAccountId: find('assets', 'مدينون تجاريون'), vatOutputAccountId: find('liabilities', 'مخرجات'), revenueAccountId: chart.find((a) => a.kind === 'sub' && a.nature === 'revenue')!.id,
      paymentDays: 30,
    };
    return { admin, clerk, issuer, bank, settings };
  }

  const issueDoc = async (o: { clerk: string; issuer: string }, body: object, date?: string) => {
    const d = (await http.post(`${B}/documents`).set(as(o.clerk)).send(body).expect(200)).body;
    await http.post(`${B}/documents/${d.id}/submit`).set(as(o.clerk)).expect(200);
    return (await http.post(`${B}/documents/${d.id}/issue`).set(as(o.issuer)).send(date ? { date } : {}).expect(200)).body;
  };

  let pre: Awaited<ReturnType<typeof setupOrg>>;
  let live: Awaited<ReturnType<typeof setupOrg>>;

  beforeAll(async () => {
    Object.assign(process.env, {
      DATABASE_URL: DB, JWT_SECRET: 'test-secret', UPLOAD_DIR: mkdtempSync(join(tmpdir(), 'rw-uploads-')), PLATFORM_ADMIN_EMAIL: 'platform@test.org', PLATFORM_ADMIN_PASSWORD: 'Platform123',
    });
    delete process.env.COMPANY_SLUG;
    const reset = new DataSource({ type: 'postgres', url: DB });
    await reset.initialize();
    await reset.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
    await reset.destroy();
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(moduleRef.createNestApplication<NestExpressApplication>());
    await app.init();
    http = request(app.getHttpServer());
    db = app.get(DataSource);
    tok.platform = await login('admin', 'Platform123');
    pre = await setupOrg('pre', tok.platform);
    live = await setupOrg('live', tok.platform);
    tok.outsider = (await setupOrg('outsider', tok.platform, false)).admin;
  });

  afterAll(async () => {
    delete process.env.COMPANY_SLUG;
    await app?.close();
  });

  it('computes the quarterly tax periods and their due dates', () => {
    expect(quarterPeriod('2026-Q4', '2026-12-01')).toEqual({ from: '2026-12-01', to: '2026-12-31', due: '2027-01-31' });
    expect(quarterPeriod('2027-Q1', '2026-12-01')).toEqual({ from: '2027-01-01', to: '2027-03-31', due: '2027-04-30' });
    expect(quarterPeriod('2026-Q3', '2026-12-01')).toBeNull();
    expect(quarterPeriod('bad', null)).toBeNull();
  });

  it('requires the registration effective date for a registered company', async () => {
    const r = await http.put(`${B}/settings`).set(as(pre.admin)).send(pre.settings).expect(400);
    expect(r.body.message).toContain('تاريخ نفاذ التسجيل');
    await http.put(`${B}/settings`).set(as(pre.admin)).send({ ...pre.settings, vatEffectiveFrom: '2026-02-31' }).expect(400);
    const ok = (await http.put(`${B}/settings`).set(as(pre.admin)).send({ ...pre.settings, vatEffectiveFrom: tomorrow, paymentCashAccountId: pre.bank }).expect(200)).body;
    expect(ok.settings).toMatchObject({ mode: 'registered', vatEffectiveFrom: tomorrow, paymentCashAccountId: pre.bank });
    expect(ok.settings.log.at(-1).note).toContain('آيبان ينتهي بـ 7519');
    expect(ok.effectiveMode).toBe('unregistered');
    expect(ok.readiness.vat).toMatchObject({ effectiveFrom: tomorrow, activeToday: false });
    expect(ok.readiness.vat.note).toContain(tomorrow);
  });

  it('rejects a bank account from another organization', async () => {
    await http.put(`${B}/settings`).set(as(live.admin)).send({ ...live.settings, vatEffectiveFrom: yesterday, paymentCashAccountId: pre.bank }).expect(400);
    await http.put(`${B}/settings`).set(as(live.admin)).send({ ...live.settings, vatEffectiveFrom: yesterday, paymentCashAccountId: live.bank }).expect(200);
  });

  it('issues a plain invoice without VAT before the registration takes effect', async () => {
    await http.post(`${B}/documents`).set(as(pre.clerk)).send({ kind: 'invoice', docType: 'standard', buyerName: 'عميل', lines: [{ description: 'استشارة', qty: 1, unitPrice: 1000 }] }).expect(400);
    const d = await issueDoc(pre, { kind: 'invoice', buyerName: 'عميل', lines: [{ description: 'استشارة', qty: 1, unitPrice: 1000 }] });
    expect(d).toMatchObject({ docType: 'nontax', vat: 0, total: 1000, issuedMode: 'unregistered', qr: null, qrImage: null });
    expect(d.seller.vatNumber).toBeNull();
    expect(d.bank).toMatchObject({ bankName: 'مصرف الراجحي', iban: 'SA0380000000608010167519' });
    ids.plain = d.id;
    // الإشعار على فاتورة عادية يتبعها بلا ضريبة
    const line = (await http.get(`${B}/documents/${ids.plain}`).set(as(pre.clerk)).expect(200)).body.creditable[0];
    const cn = await issueDoc(pre, { kind: 'credit_note', refId: ids.plain, reason: 'خصم بعد الإصدار', lines: [{ refLineId: line.lineId, qty: 1, unitPrice: 100 }] });
    expect(cn).toMatchObject({ docType: 'nontax', vat: 0, total: 100, bank: null });
  });

  it('does not move the effective date across documents already issued', async () => {
    const r = await http.put(`${B}/settings`).set(as(pre.admin)).send({ ...pre.settings, vatEffectiveFrom: today }).expect(400);
    expect(r.body.message).toContain('فاتورة عادية');
  });

  it('issues tax invoices with QR from the effective date, and plain ones for supplies before it', async () => {
    const beforeReg = (await http.post(`${B}/documents`).set(as(live.clerk)).send({
      kind: 'invoice', buyerName: 'عميل قديم', supplyDate: day(-2), lines: [{ description: 'استشارة نوفمبر', qty: 1, unitPrice: 500 }],
    }).expect(200)).body;
    expect(beforeReg).toMatchObject({ docType: 'nontax', vat: 0 });
    await http.post(`${B}/documents/${beforeReg.id}/cancel`).set(as(live.clerk)).send({ reason: 'تجربة' }).expect(200);

    const d = await issueDoc(live, { kind: 'invoice', buyerName: 'عميل', lines: [{ description: 'استشارة', qty: 2, unitPrice: 1000 }] });
    expect(d).toMatchObject({ docType: 'simplified', vat: 300, total: 2300, issuedMode: 'registered' });
    expect(readTlv(d.qr)).toMatchObject({ 2: '314466205600003', 4: '2300.00', 5: '300.00' });
    expect(d.bank.iban).toBe('SA0380000000608010167519');
    ids.taxed = d.id;
    const line = (await http.get(`${B}/documents/${ids.taxed}`).set(as(live.clerk)).expect(200)).body.creditable[0];
    const cn = await issueDoc(live, { kind: 'credit_note', refId: ids.taxed, reason: 'خصم بعد الإصدار', lines: [{ refLineId: line.lineId, qty: 1, unitPrice: 200 }] });
    expect(cn).toMatchObject({ vat: 30, total: 230 });
    // تأخير تاريخ النفاذ بعد فاتورة ضريبية صادرة مرفوض
    const r = await http.put(`${B}/settings`).set(as(live.admin)).send({ ...live.settings, vatEffectiveFrom: tomorrow, paymentCashAccountId: live.bank }).expect(400);
    expect(r.body.message).toContain('فاتورة ضريبية');
    // ولا بحفظين: «غير مسجلة» بالتاريخ الجديد ثم «مسجلة» بالتاريخ نفسه
    await http.put(`${B}/settings`).set(as(live.admin)).send({ ...live.settings, mode: 'unregistered', vatEffectiveFrom: tomorrow, paymentCashAccountId: live.bank }).expect(200);
    const back = await http.put(`${B}/settings`).set(as(live.admin)).send({ ...live.settings, vatEffectiveFrom: tomorrow, paymentCashAccountId: live.bank }).expect(400);
    expect(back.body.message).toContain('فاتورة ضريبية');
    await http.put(`${B}/settings`).set(as(live.admin)).send({ ...live.settings, vatEffectiveFrom: yesterday, paymentCashAccountId: live.bank }).expect(200);
  });

  it('builds the quarterly VAT return draft, for the reports permission only', async () => {
    const q = quarterOf(today);
    await http.get('/api/reports/run/billing.vat-return').query({ quarter: q }).set(as(live.clerk)).expect(403);
    const r = (await http.get('/api/reports/run/billing.vat-return').query({ quarter: q }).set(as(live.issuer)).expect(200)).body;
    const box = (b: string) => r.rows.find((x: { box: string }) => x.box === b);
    expect(box('1')).toMatchObject({ amount: 2000, adjustment: -200, vat: 270 });
    expect(box('6')).toMatchObject({ amount: 2000, adjustment: -200, vat: 270 });
    expect(box('13').vat).toBe(270);
    expect(r.subtitle).toContain('314466205600003');
    expect(r.notes.join(' ')).not.toContain('حركة حساب ضريبة المخرجات');

    // المنشأة قبل نفاذ تسجيلها: فواتيرها العادية لا تدخل الإقرار
    const p = (await http.get('/api/reports/run/billing.vat-return').query({ quarter: quarterOf(tomorrow) }).set(as(pre.issuer)).expect(200)).body;
    expect(p.rows.find((x: { box: string }) => x.box === '6').vat).toBe(0);

    // منشأة أخرى لا ترى أرقام هذه المنشأة
    const o = (await http.get('/api/reports/run/billing.vat-return').query({ quarter: q }).set(as(tok.outsider)).expect(200)).body;
    expect(o.rows.find((x: { box: string }) => x.box === '6').vat).toBe(0);
  });

  it('fills the certificate data from the defaults only in the company organization', async () => {
    const other = (await http.post('/api/starter/billing').set(as(tok.outsider)).expect(201)).body;
    expect(other.applied.results.find((x: { key: string }) => x.key === 'tax-profile').added).toBe(0);
    const [o] = await db.query(`SELECT s.vat_number FROM bl_settings s JOIN organizations g ON g.id = s.organization_id WHERE g.slug = 'outsider'`);
    expect(o?.vat_number ?? null).toBeNull();

    await http.post('/api/platform/organizations').set(as(tok.platform)).send({
      name: 'رعاية وطن', slug: 'reayawatan', adminFullName: 'مدير المنظمة', adminEmail: 'admin@reayawatan.sa', adminPassword: 'Admin12345',
    }).expect(201);
    const admin = await login('admin@reayawatan.sa', 'Admin12345', 'reayawatan');
    process.env.COMPANY_SLUG = 'reayawatan';
    try {
      const r = (await http.post('/api/starter/billing').set(as(admin)).expect(201)).body;
      const step = r.applied.results.find((x: { key: string }) => x.key === 'tax-profile');
      expect(step.added).toBeGreaterThan(0);
      expect(step.note).toContain('رقم المبنى');
    } finally {
      delete process.env.COMPANY_SLUG;
    }
    const [s] = await db.query(
      `SELECT s.mode, s.vat_number, s.id_number, to_char(s.vat_effective_from, 'YYYY-MM-DD') AS eff, s.address, s.log FROM bl_settings s JOIN organizations g ON g.id = s.organization_id WHERE g.slug = 'reayawatan'`);
    // رقم المبنى غير موجود في الشهادة، فيبقى النظام غير مفعّل حتى يُكمل
    expect(s).toMatchObject({ mode: 'off', vat_number: '314466205600003', id_number: '7052873945', eff: '2026-12-01' });
    expect(s.address).toMatchObject({ district: 'الرحمانية', city: 'الرياض', postalCode: '12341', buildingNo: null });
    expect(s.log.at(-1).action).toContain('شهادة التسجيل');
  });
});
