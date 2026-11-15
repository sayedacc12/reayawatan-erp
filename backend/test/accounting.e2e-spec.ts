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
 * النظام المالي: تنصيب الدليل الموحد، الافتتاحيات، قواعد القيد (التوازن، سطر مدين أو دائن، التحليلي)،
 * سندات القبض والصرف بمراحل الاعتماد وعكس القيد، الاعتماد الثنائي لإلغاء القبض، الميزان، المحضر وفتح السنة الجديدة.
 */
const DB = process.env.TEST_DATABASE_URL ?? 'postgres://erp:erp@localhost:5432/charity_erp_test';

describe('Accounting', () => {
  let app: NestExpressApplication;
  let http: ReturnType<typeof request>;
  let admin: string;
  let checker: string;
  let uploadDir: string;
  const as = (t: string) => ({ Authorization: `Bearer ${t}` });
  const login = async (login: string, password: string, organization?: string) =>
    (await http.post('/api/auth/login').send({ login, password, organization }).expect(200)).body.accessToken as string;
  const A = '/api/accounting';
  const ids: Record<string, string> = {};

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
      name: 'جمعية البر', slug: 'albir', adminFullName: 'مدير النظام', adminEmail: 'albir@test.org', adminPassword: 'Admin12345',
    }).expect(201);
    admin = await login('albir@test.org', 'Admin12345', 'albir');
    const role = await http.post('/api/roles').set(as(admin)).send({
      name: 'المراجع المالي', permissions: ['accounting.dashboard.read', 'accounting.receipts.cancel_approve', 'accounting.vouchers.approve'],
    }).expect(201);
    await http.post('/api/users').set(as(admin)).send({ fullName: 'المراجع', email: 'checker@test.org', password: 'Check12345', roleIds: [role.body.id] }).expect(201);
    checker = await login('checker@test.org', 'Check12345', 'albir');
  });

  afterAll(async () => {
    await app.get(DataSource).destroy();
    await app.close();
    rmSync(uploadDir, { recursive: true, force: true });
  });

  it('installs the unified NPO chart once, with all sub accounts at one level', async () => {
    const info = await http.get(`${A}/chart`).set(as(admin)).expect(200);
    expect(info.body).toMatchObject({ installedAt: null, canInstall: true, accounts: 1386 });
    await http.post(`${A}/chart/install`).set(as(admin)).expect(201);
    await http.post(`${A}/chart/install`).set(as(admin)).expect(409);
    const list = await http.get(`${A}/accounts`).set(as(admin)).expect(200);
    const accounts = list.body.accounts as { id: string; code: string; name: string; kind: string; nature: string; level: number; requiresAnalytic: boolean; parentId: string | null }[];
    expect(accounts).toHaveLength(1386);
    expect(new Set(accounts.filter((a) => a.kind === 'sub').map((a) => a.level))).toEqual(new Set([6]));
    expect(accounts.filter((a) => !a.parentId).length).toBe(4);
    const sub = (pred: (a: (typeof accounts)[number]) => boolean) => accounts.find((a) => a.kind === 'sub' && pred(a))!;
    ids.bankGl = sub((a) => a.code === '1110100201').id;
    ids.bank2Gl = sub((a) => a.code === '1110100101').id;
    ids.revenue = sub((a) => a.nature === 'revenue').id;
    const expense = sub((a) => a.nature === 'expenses');
    expect(expense.requiresAnalytic).toBe(true);
    ids.expense = expense.id;
    ids.netAssets = sub((a) => a.nature === 'net_assets').id;
    ids.main = accounts.find((a) => a.kind === 'main')!.id;
    const analytic = await http.get(`${A}/analytic`).set(as(admin)).expect(200);
    ids.cc = analytic.body.accounts.find((a: { kind: string }) => a.kind === 'sub').id;
  });

  it('enforces chart rules: unique code, nothing under a sub', async () => {
    const list = (await http.get(`${A}/accounts`).set(as(admin)).expect(200)).body.accounts;
    const any = list.find((a: { id: string }) => a.id === ids.revenue);
    await http.post(`${A}/accounts`).set(as(admin)).send({ code: any.code, name: 'مكرر', kind: 'sub', nature: 'revenue', parentId: any.parentId }).expect((r) => expect([400, 409]).toContain(r.status));
    await http.post(`${A}/accounts`).set(as(admin)).send({ code: `${any.code}9`, name: 'تحت فرعي', kind: 'sub', nature: 'revenue', parentId: any.id }).expect(400);
  });

  it('sets up the first fiscal year with vouchers starting at 1', async () => {
    const res = await http.post(`${A}/setup`).set(as(admin)).send({
      fiscalYear: 2026, startDate: '2026-01-01', endDate: '2026-12-31', isFirstYear: true,
      firstYearStart: '2026-01-01', firstYearEnd: '2026-12-31', taxNumber: '300000000000003',
    }).expect(201);
    ids.year = res.body.years[0].id;
    expect(res.body.taxNumber).toBe('300000000000003');
    await http.post(`${A}/setup`).set(as(admin)).send({ fiscalYear: 2026, startDate: '2026-01-01', endDate: '2026-12-31', isFirstYear: true, firstYearStart: '2026-01-01', firstYearEnd: '2026-12-31' }).expect(409);
    ids.cash = (await http.post(`${A}/cash-accounts`).set(as(admin)).send({
      kind: 'bank', name: 'مصرف الراجحي - الحساب الجاري', bankName: 'مصرف الراجحي', accountNumber: '123456', iban: 'SA0380000000608010167519', glAccountId: ids.bankGl,
    }).expect(201)).body.id;
  });

  it('validates journal entries: balanced, one side per line, analytic required', async () => {
    const date = '2026-03-10';
    const base = { voucherType: 'journal', documentDate: date, description: 'قيد اختبار' };
    await http.post(`${A}/entries`).set(as(admin)).send({ ...base, lines: [
      { accountId: ids.bankGl, debit: 100, credit: 0 }, { accountId: ids.revenue, debit: 0, credit: 90 },
    ] }).expect(400);
    await http.post(`${A}/entries`).set(as(admin)).send({ ...base, lines: [
      { accountId: ids.bankGl, debit: 100, credit: 100 }, { accountId: ids.revenue, debit: 0, credit: 0 },
    ] }).expect(400);
    await http.post(`${A}/entries`).set(as(admin)).send({ ...base, lines: [
      { accountId: ids.main, debit: 100, credit: 0 }, { accountId: ids.revenue, debit: 0, credit: 100 },
    ] }).expect(400);
    const noAnalytic = await http.post(`${A}/entries`).set(as(admin)).send({ ...base, lines: [
      { accountId: ids.expense, debit: 100, credit: 0 }, { accountId: ids.bankGl, debit: 0, credit: 100 },
    ] }).expect(400);
    expect(noAnalytic.body.message).toContain('تحليلي');
    const ok = await http.post(`${A}/entries`).set(as(admin)).send({ ...base, post: true, lines: [
      { accountId: ids.expense, debit: 100, credit: 0, analytic: [{ analyticId: ids.cc, percent: 100 }] }, { accountId: ids.bankGl, debit: 0, credit: 100 },
    ] }).expect(201);
    expect(ok.body).toMatchObject({ entryNo: 1, voucherNo: '1/2026', status: 'posted' });
    await http.put(`${A}/entries/${ok.body.id}`).set(as(admin)).send({ ...base, lines: [] }).expect(400);
    await http.post(`${A}/entries`).set(as(admin)).send({ ...base, voucherType: 'receipt', lines: [
      { accountId: ids.bankGl, debit: 10, credit: 0 }, { accountId: ids.revenue, debit: 0, credit: 10 },
    ] }).expect(400);
    // لا يُغيَّر حساب البنك بعد وجود حركة عليه
    await http.patch(`${A}/cash-accounts/${ids.cash}`).set(as(admin)).send({ kind: 'bank', name: 'مصرف الراجحي - الحساب الجاري', bankName: 'مصرف الراجحي', accountNumber: '123456', glAccountId: ids.bank2Gl }).expect(409);
  });

  it('runs a receipt through the approval stage and posts it with the voucher number', async () => {
    await http.put(`${A}/voucher-stages/receipt`).set(as(admin)).send({ stages: [{ name: 'المراجع المالي' }] }).expect(200);
    const v = await http.post(`${A}/vouchers/receipt`).set(as(admin)).send({
      voucherDate: '2026-04-05', partyName: 'محمد العتيبي', amount: 5250.5, purpose: 'تبرع لكفالة الأيتام', method: 'transfer', methodRef: 'TRX-1',
      cashAccountId: ids.cash, counterAccountId: ids.revenue,
    }).expect(201);
    expect(v.body).toMatchObject({ serial: 1, status: 'draft', amountWords: 'فقط خمسة آلاف ومائتان وخمسون ريالًا سعوديًا وخمسون هللة لا غير' });
    ids.receipt = v.body.id;
    await http.post(`${A}/voucher/${v.body.id}/submit`).set(as(admin)).expect(201);
    await http.post(`${A}/voucher/${v.body.id}/decide`).set(as(checker)).send({ decision: 'return' }).expect(400);
    await http.post(`${A}/voucher/${v.body.id}/decide`).set(as(checker)).send({ decision: 'return', note: 'أرفق صورة الحوالة' }).expect(201);
    await http.put(`${A}/voucher/${v.body.id}`).set(as(admin)).send({
      voucherDate: '2026-04-05', partyName: 'محمد العتيبي', amount: 5250.5, purpose: 'تبرع لكفالة الأيتام (مرفق الحوالة)', method: 'transfer',
      cashAccountId: ids.cash, counterAccountId: ids.revenue,
    }).expect(200);
    await http.post(`${A}/voucher/${v.body.id}/submit`).set(as(admin)).expect(201);
    const done = await http.post(`${A}/voucher/${v.body.id}/decide`).set(as(checker)).send({ decision: 'approve' }).expect(201);
    expect(done.body.status).toBe('approved');
    expect(done.body.entries).toHaveLength(1);
    const entry = await http.get(`${A}/entries/${done.body.entryId}`).set(as(admin)).expect(200);
    expect(entry.body).toMatchObject({ voucherType: 'receipt', voucherNo: '1', status: 'posted', source: 'voucher' });
    await http.post(`${A}/entries/${done.body.entryId}/unpost`).set(as(admin)).expect(409);
  });

  it('reverts a receipt to draft only with a second approver, keeping the voucher number', async () => {
    await http.post(`${A}/voucher/${ids.receipt}/request`).set(as(admin)).send({ kind: 'draft', reason: 'خطأ في اسم المتبرع' }).expect(201);
    await http.post(`${A}/voucher/${ids.receipt}/request/decide`).set(as(admin)).send({ decision: 'approve' }).expect(403);
    const back = await http.post(`${A}/voucher/${ids.receipt}/request/decide`).set(as(checker)).send({ decision: 'approve' }).expect(201);
    expect(back.body).toMatchObject({ status: 'draft', serial: 1, entryId: null });
    expect(back.body.entries[0].status).toBe('cancelled');
    await http.post(`${A}/voucher/${ids.receipt}/submit`).set(as(admin)).expect(201);
    const again = await http.post(`${A}/voucher/${ids.receipt}/decide`).set(as(checker)).send({ decision: 'approve' }).expect(201);
    expect(again.body.entries.map((e: { status: string }) => e.status)).toEqual(['cancelled', 'posted']);
  });

  it('posts a payment with analytic directly when no stages exist, and only the final approver cancels it', async () => {
    const body = {
      voucherDate: '2026-05-01', partyName: 'مؤسسة النور للتوريدات', amount: 1200, purpose: 'سلال غذائية', method: 'cheque', methodRef: '000123',
      cashAccountId: ids.cash, counterAccountId: ids.expense,
    };
    const missing = await http.post(`${A}/vouchers/payment`).set(as(admin)).send(body).expect(400);
    expect(missing.body.message).toContain('تحليلي');
    const p = await http.post(`${A}/vouchers/payment`).set(as(admin)).send({ ...body, analytic: [{ analyticId: ids.cc, percent: 100 }] }).expect(201);
    const posted = await http.post(`${A}/voucher/${p.body.id}/submit`).set(as(admin)).expect(201);
    expect(posted.body).toMatchObject({ status: 'approved', serial: 1 });
    const c = await http.post(`${A}/voucher/${p.body.id}/request`).set(as(admin)).send({ kind: 'cancel', reason: 'صرف مكرر' }).expect(201);
    expect(c.body.status).toBe('cancelled');
    expect(c.body.entries[0].cancelReason).toContain('إلغاء سند');
  });

  it('produces a balanced trial balance and a ledger', async () => {
    const tb = await http.get(`${A}/reports/trial-balance?from=2026-01-01&to=2026-12-31&level=1`).set(as(admin)).expect(200);
    expect(tb.body.totals.debit).toBe(tb.body.totals.credit);
    expect(tb.body.totals.debit).toBe(100 + 5250.5);
    const led = await http.get(`${A}/reports/ledger/${ids.bankGl}?from=2026-01-01&to=2026-12-31`).set(as(admin)).expect(200);
    expect(led.body.closing).toBe(5150.5);
    const dash = await http.get(`${A}/dashboard`).set(as(admin)).expect(200);
    expect(dash.body).toMatchObject({ revenue: 5250.5, expenses: 100 });
  });

  it('keeps opening entries out of posting, and closes months only in sequence after posting all documents', async () => {
    // القيد الافتتاحي يسري بمجرد حفظه ولا يخضع للترحيل
    const opening = await http.post(`${A}/entries`).set(as(admin)).send({
      voucherType: 'opening', documentDate: '2026-01-01', description: 'أرصدة افتتاحية', lines: [
        { accountId: ids.bankGl, debit: 500, credit: 0 }, { accountId: ids.netAssets, debit: 0, credit: 500 },
      ],
    }).expect(201);
    expect(opening.body.status).toBe('posted');
    await http.post(`${A}/entries/${opening.body.id}/unpost`).set(as(admin)).expect(409);
    await http.put(`${A}/entries/${opening.body.id}`).set(as(admin)).send({
      documentDate: '2026-01-01', description: 'أرصدة افتتاحية معدلة', lines: [
        { accountId: ids.bankGl, debit: 600, credit: 0 }, { accountId: ids.netAssets, debit: 0, credit: 600 },
      ],
    }).expect(200);
    await http.post(`${A}/posting/batch`).set(as(admin)).send({ dateFrom: '2026-01-01', dateTo: '2026-12-31', voucherType: 'opening', preview: true }).expect(400);

    // قيد غير مرحّل في فبراير يمنع إغلاقه، ويظهر في المعاينة مع سندات لم تُعتمد
    const draft = await http.post(`${A}/entries`).set(as(admin)).send({
      voucherType: 'journal', documentDate: '2026-02-05', description: 'قيد فبراير', lines: [
        { accountId: ids.bankGl, debit: 20, credit: 0 }, { accountId: ids.revenue, debit: 0, credit: 20 },
      ],
    }).expect(201);
    const pv = await http.post(`${A}/posting/batch`).set(as(admin)).send({ dateFrom: '2026-01-01', dateTo: '2026-02-28', preview: true }).expect(201);
    expect(pv.body.candidates.map((c: { id: string }) => c.id)).toEqual([draft.body.id]);
    expect(pv.body.pendingVouchers).toEqual([]);

    // التسلسل: لا يُغلق فبراير ويناير مفتوح
    const seq = await http.post(`${A}/periods/close`).set(as(admin)).send({ fiscalYearId: ids.year, months: ['2026-02'] }).expect(201);
    expect(seq.body.done).toEqual([]);
    expect(seq.body.failed[0].reason).toContain('السابقة');
    // يناير يُغلق، وفبراير لا يُغلق قبل ترحيل قيده
    const both = await http.post(`${A}/periods/close`).set(as(admin)).send({ fiscalYearId: ids.year, months: ['2026-01', '2026-02'] }).expect(201);
    expect(both.body.done).toEqual(['2026-01']);
    expect(both.body.failed[0].reason).toContain('غير مرحّل');
    await http.post(`${A}/entries/${draft.body.id}/post`).set(as(admin)).expect(201);
    await http.post(`${A}/periods/close`).set(as(admin)).send({ fiscalYearId: ids.year, months: ['2026-02'] }).expect(201);
    const per = await http.get(`${A}/periods/${ids.year}`).set(as(admin)).expect(200);
    expect(per.body.months.filter((m: { closed: boolean }) => m.closed).map((m: { month: string }) => m.month)).toEqual(['2026-01', '2026-02']);
    // لا يُفك ترحيل مستند في شهر مغلق، ولا يُفتح يناير وفبراير مغلق
    await http.post(`${A}/entries/${draft.body.id}/unpost`).set(as(admin)).expect(409);
    const early = await http.post(`${A}/periods/reopen`).set(as(admin)).send({ fiscalYearId: ids.year, months: ['2026-01'] }).expect(201);
    expect(early.body.failed[0].reason).toContain('اللاحقة');
    const reopen = await http.post(`${A}/periods/reopen`).set(as(admin)).send({ fiscalYearId: ids.year, months: ['2026-01', '2026-02'] }).expect(201);
    expect(reopen.body.done).toEqual(['2026-02', '2026-01']);
  });

  it('fills the counter account from the registered partner file', async () => {
    const chart = (await http.get(`${A}/accounts`).set(as(admin)).expect(200)).body.accounts as { id: string; code: string }[];
    const supplierGl = chart.find((a) => a.code === '2130200101')!.id;
    const cats = (await http.get(`${A}/categories`).set(as(admin)).expect(200)).body as { id: string; behavior: string }[];
    const partner = await http.post(`${A}/partners`).set(as(admin)).send({
      name: 'مؤسسة التوريد', categoryId: cats.find((c) => c.behavior === 'supplier')!.id, accountId: supplierGl,
    }).expect(201);
    const v = await http.post(`${A}/vouchers/payment`).set(as(admin)).send({
      voucherDate: '2026-03-12', partyName: 'أي اسم', partnerId: partner.body.id, amount: 75, purpose: 'توريد', method: 'cash',
      cashAccountId: ids.cash, counterAccountId: ids.revenue,
    }).expect(201);
    expect(v.body.counterAccountId).toBe(supplierGl);
    await http.post(`${A}/vouchers/payment`).set(as(admin)).send({
      voucherDate: '2026-03-12', partyName: 'بدون حساب', amount: 75, purpose: 'توريد', method: 'cash', cashAccountId: ids.cash,
    }).expect(400);
    await http.post(`${A}/voucher/${v.body.id}/request`).set(as(admin)).send({ kind: 'cancel', reason: 'سند اختبار' }).expect(201);
  });

  it('lets the association define its own document types, numbered from 1 each year', async () => {
    await http.post(`${A}/document-types`).set(as(admin)).send({ name: 'قيد يومية' }).expect(409);
    const list = (await http.post(`${A}/document-types`).set(as(admin)).send({ name: 'سند عهدة', description: 'صرف وتسوية العهد' }).expect(201)).body;
    const t = list[0];
    expect(t.code).toMatch(/^d_[a-z0-9]+$/);
    const body = { voucherType: t.code, documentDate: '2026-03-20', description: 'عهدة نثرية', lines: [
      { accountId: ids.bankGl, debit: 0, credit: 40 }, { accountId: ids.expense, debit: 40, credit: 0, analytic: [{ analyticId: ids.cc, percent: 100 }] },
    ] };
    const e1 = (await http.post(`${A}/entries`).set(as(admin)).send(body).expect(201)).body;
    expect(e1).toMatchObject({ voucherNo: '1/2026', voucherLabel: 'سند عهدة', status: 'draft' });
    const listed = (await http.get(`${A}/entries?type=${t.code}`).set(as(admin)).expect(200)).body;
    expect(listed.map((x: { id: string }) => x.id)).toEqual([e1.id]);
    // يدخل في الترحيل الجماعي بنوعه وأرقامه
    const pv = (await http.post(`${A}/posting/batch`).set(as(admin)).send({ dateFrom: '2026-01-01', dateTo: '2026-12-31', voucherType: t.code, serialFrom: 1, serialTo: 1, preview: true }).expect(201)).body;
    expect(pv.candidates.map((c: { id: string }) => c.id)).toEqual([e1.id]);
    await http.post(`${A}/entries/${e1.id}/post`).set(as(admin)).expect(201);
    // المستخدم لا يُحذف بل يوقف، والموقوف لا تُسجَّل عليه سندات جديدة
    await http.delete(`${A}/document-types/${t.id}`).set(as(admin)).expect(409);
    await http.patch(`${A}/document-types/${t.id}`).set(as(admin)).send({ name: 'سند عهدة', isActive: false }).expect(200);
    await http.post(`${A}/entries`).set(as(admin)).send(body).expect(400);
    await http.patch(`${A}/document-types/${t.id}`).set(as(admin)).send({ name: 'سند عهدة', isActive: true }).expect(200);
    // يظهر في تسلسلات السنة ومحضر الجرد باسمه
    const setup = (await http.get(`${A}/setup`).set(as(admin)).expect(200)).body;
    expect(setup.years[0].sequences.find((q: { voucherType: string }) => q.voucherType === t.code)).toMatchObject({ label: 'سند عهدة', nextSerial: 2 });
    const inv = (await http.get(`${A}/inventory/${ids.year}`).set(as(admin)).expect(200)).body;
    expect(inv.rows.find((r: { voucherType: string }) => r.voucherType === t.code)).toMatchObject({ label: 'سند عهدة', count: 1, firstNo: '1/2026' });
    // نوع غير مستخدم يُحذف
    const tmp = (await http.post(`${A}/document-types`).set(as(admin)).send({ name: 'إشعار مدين' }).expect(201)).body.find((d: { name: string }) => d.name === 'إشعار مدين');
    await http.delete(`${A}/document-types/${tmp.id}`).set(as(admin)).expect(204);
    await http.post(`${A}/entries`).set(as(admin)).send({ ...body, voucherType: 'd_notexisting1' }).expect(400);
  });

  it('approves the voucher inventory, opens the next year without revenue balances, and closes the year', async () => {
    await http.post(`${A}/inventory/prepare`).set(as(admin)).send({ fiscalYearId: ids.year }).expect(201);
    await http.post(`${A}/inventory/${ids.year}/approve`).set(as(checker)).expect(403);
    const inv = await http.post(`${A}/inventory/${ids.year}/approve`).set(as(admin)).expect((r) => { if (r.status !== 201) console.log('INV', r.body); expect(r.status).toBe(201); });
    const receipts = inv.body.rows.find((r: { voucherType: string }) => r.voucherType === 'receipt');
    expect(receipts).toMatchObject({ first: 1, last: 1, posted: 1 });
    await http.post(`${A}/vouchers/receipt`).set(as(admin)).send({
      voucherDate: '2026-06-01', partyName: 'متبرع', amount: 1, purpose: 'بعد المحضر', method: 'cash', cashAccountId: ids.cash, counterAccountId: ids.revenue,
    }).expect(409);
    const next = await http.post(`${A}/years/next`).set(as(admin)).expect(201);
    const y2027 = next.body.years.find((y: { name: number }) => y.name === 2027);
    expect(y2027.sequences.find((s: { voucherType: string }) => s.voucherType === 'receipt').startSerial).toBe(2);
    const opening = await http.get(`${A}/entries?type=opening&year=${y2027.id}`).set(as(admin)).expect(200);
    expect(opening.body).toHaveLength(1);
    const detail = await http.get(`${A}/entries/${opening.body[0].id}`).set(as(admin)).expect(200);
    const accounts = (await http.get(`${A}/accounts`).set(as(admin))).body.accounts as { id: string; nature: string }[];
    const natures = detail.body.lines.map((l: { accountId: string }) => accounts.find((a) => a.id === l.accountId)!.nature);
    expect(natures).not.toContain('revenue');
    expect(natures).not.toContain('expenses');
    expect(natures).toContain('net_assets');
    await http.post(`${A}/years/${ids.year}/close`).set(as(admin)).expect(201);
    await http.post(`${A}/entries`).set(as(admin)).send({ voucherType: 'journal', documentDate: '2026-07-01', description: 'بعد الإغلاق', lines: [
      { accountId: ids.bankGl, debit: 1, credit: 0 }, { accountId: ids.revenue, debit: 0, credit: 1 },
    ] }).expect(409);
  });
});
