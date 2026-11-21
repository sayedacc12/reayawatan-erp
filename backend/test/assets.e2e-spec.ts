import { Test } from '@nestjs/testing';
import { NestExpressApplication } from '@nestjs/platform-express';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/main';
import { AssetsService } from '../src/modules/accounting/assets.service';
import { computeDepreciation } from '../src/modules/accounting/depreciation';

/**
 * الأصول الثابتة: المجموعات والتوجيه المحاسبي، العهدة الإلزامية، الأرصدة الافتتاحية، الإهلاك الشهري وترحيله وإلغاؤه بالتسلسل،
 * قفل قيود الإهلاك من النظام المالي، الشراء بسند صرف (نقدي وآجل) لا يدخل الدفاتر إلا باعتماده، البيع بإهلاك جزئي ثم سند قبض،
 * التخريد والتبرع العيني والإضافات، المطابقة مع الدليل، العهد ومنع إخلاء الطرف، الجرد بملصقات QR، والتقارير.
 */
const DB = process.env.TEST_DATABASE_URL ?? 'postgres://erp:erp@localhost:5432/charity_erp_test';

describe('Fixed assets', () => {
  let app: NestExpressApplication;
  let http: ReturnType<typeof request>;
  let admin: string;
  let uploadDir: string;
  const as = (t: string) => ({ Authorization: `Bearer ${t}` });
  const login = async (login: string, password: string, organization?: string) =>
    (await http.post('/api/auth/login').send({ login, password, organization }).expect(200)).body.accessToken as string;
  const A = '/api/accounting';
  const F = '/api/accounting/assets';
  const H = '/api/hr';
  const acc: Record<string, string> = {};
  const ids: Record<string, string> = {};
  const year = Number(new Date().toISOString().slice(0, 4));
  const ym = (m: number) => `${year}-${String(m).padStart(2, '0')}`;

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
      name: 'جمعية النماء', slug: 'namaa', adminFullName: 'مدير النظام', adminEmail: 'admin@namaa.org', adminPassword: 'Admin12345',
    }).expect(201);
    admin = await login('admin@namaa.org', 'Admin12345', 'namaa');

    await http.post(`${A}/chart/install`).set(as(admin)).expect(201);
    ((await http.get(`${A}/accounts`).set(as(admin)).expect(200)).body.accounts as { id: string; code: string }[]).forEach((a) => (acc[a.code] = a.id));
    ((await http.get(`${A}/analytic`).set(as(admin)).expect(200)).body.accounts as { id: string; code: string }[]).forEach((a) => (acc[a.code] = a.id));
    await http.post(`${A}/setup`).set(as(admin)).send({
      fiscalYear: year, startDate: `${year}-01-01`, endDate: `${year}-12-31`, isFirstYear: true, firstYearStart: `${year}-01-01`, firstYearEnd: `${year}-12-31`,
    }).expect(201);
    ids.bank = (await http.post(`${A}/cash-accounts`).set(as(admin)).send({ kind: 'bank', name: 'الراجحي', bankName: 'مصرف الراجحي', accountNumber: '608010167519', glAccountId: acc['1110100201'] }).expect(201)).body.id;
    const cats = (await http.get(`${A}/categories`).set(as(admin)).expect(200)).body as { id: string; behavior: string }[];
    ids.supplier = (await http.post(`${A}/partners`).set(as(admin)).send({ name: 'مؤسسة التقنية الحديثة', categoryId: cats.find((c) => c.behavior === 'supplier')!.id, accountId: acc['2130200101'] }).expect(201)).body.id;
    ids.customer = (await http.post(`${A}/partners`).set(as(admin)).send({ name: 'معرض السيارات المستعملة', categoryId: cats.find((c) => c.behavior === 'customer')!.id, accountId: acc['1140200101'] }).expect(201)).body.id;

    // الموارد البشرية: وحدة ووظيفة وموظفان (أصحاب العهد)
    ids.unit = (await http.post(`${H}/units`).set(as(admin)).send({ name: 'الإدارة العامة', level: 0, analyticAccountId: acc.CC01 }).expect(201)).body.id;
    ids.job = (await http.post(`${H}/jobs`).set(as(admin)).send({
      title: 'مشرف خدمات', unitId: ids.unit, headcount: 5, purpose: 'الخدمات العامة', responsibilities: ['المتابعة'], experienceYears: 1, competencies: [], kpis: [],
    }).expect(201)).body.id;
    let n = 0;
    const emp = async (fullName: string) => {
      n++;
      return (await http.post(`${H}/employees`).set(as(admin)).send({
        fullName, nationalId: `10000000${String(n).padStart(2, '0')}`, nationality: 'سعودي', isSaudi: true, gender: 'male', jobId: ids.job,
        hireDate: `${year - 3}-01-01`, contractType: 'indefinite', contractStart: `${year - 3}-01-01`, qiwaStatus: 'documented', basicSalary: 7000,
        allowances: [], iban: 'SA0380000000608010167599', userId: null,
      }).expect(201)).body.id as string;
    };
    ids.driver = await emp('سائق الشركة');
    ids.keeper = await emp('أمين المستودع');
  });

  afterAll(async () => {
    await app.get(DataSource).destroy();
    await app.close();
    rmSync(uploadDir, { recursive: true, force: true });
  });

  it('calculates the three methods and respects the 1-riyal floor', () => {
    const base = { inServiceDate: '2020-01-01', depreciatedThrough: '2019-12-31', salvage: 0, rate: 20, lifeYears: null, accum: 0, accumHistory: [], yearStartOf: (m: string) => `${m.slice(0, 4)}-01-01`, partial: 'days' as const };
    const sl = computeDepreciation({ ...base, method: 'straight_line', costMoves: [{ date: '2020-01-01', amount: 12000 }] }, '2020-12-31');
    expect(sl.amount).toBe(2400);
    expect(sl.months).toHaveLength(12);
    const db = computeDepreciation({ ...base, method: 'declining', costMoves: [{ date: '2020-01-01', amount: 12000 }] }, '2021-12-31');
    expect(db.months.filter((m) => m.month.startsWith('2020')).reduce((s, m) => s + m.amount, 0)).toBeCloseTo(2400, 1);
    expect(db.months.filter((m) => m.month.startsWith('2021')).reduce((s, m) => s + m.amount, 0)).toBeCloseTo(1920, 1);
    const syd = computeDepreciation({ ...base, method: 'accelerated', costMoves: [{ date: '2020-01-01', amount: 15000 }] }, '2020-12-31');
    expect(syd.amount).toBeCloseTo(5000, 0); // 5 سنوات: 5/15 في السنة الأولى
    const full = computeDepreciation({ ...base, method: 'straight_line', costMoves: [{ date: '2020-01-01', amount: 12000 }] }, '2030-12-31');
    expect(full.amount).toBe(11999);
    expect(full.fully).toBe(true);
    const half = computeDepreciation({ ...base, inServiceDate: '2020-01-16', depreciatedThrough: null, method: 'straight_line', costMoves: [{ date: '2020-01-16', amount: 12000 }] }, '2020-01-31');
    expect(half.amount).toBeCloseTo(103.23, 1);
    const next = computeDepreciation({ ...base, inServiceDate: '2020-01-16', depreciatedThrough: null, partial: 'next_month', method: 'straight_line', costMoves: [{ date: '2020-01-16', amount: 12000 }] }, '2020-01-31');
    expect(next.amount).toBe(0);
  });

  it('defines groups with their GL accounts, including land without depreciation', async () => {
    const g = await http.post(`${F}/groups`).set(as(admin)).send({
      code: 'CAR', name: 'السيارات', method: 'straight_line', rate: 20, assetAccountId: acc['1210400201'], accumAccountId: acc['2250100401'],
      expenseAccountId: acc['4130400201'], gainLossAccountId: acc['3120500401'], analyticId: acc.CC01,
      fields: [{ label: 'رقم اللوحة', type: 'text', required: true }, { label: 'انتهاء الترخيص', type: 'date', required: true, expiry: true }],
    }).expect(201);
    ids.cars = g.body.id;
    expect(g.body.lifeYears).toBe(5);
    ids.it = (await http.post(`${F}/groups`).set(as(admin)).send({
      code: 'IT', name: 'أجهزة الحاسب', method: 'straight_line', lifeYears: 4, assetAccountId: acc['1211000101'],
      accumAccountId: acc['2250101001'], expenseAccountId: acc['4131000101'], gainLossAccountId: acc['3120500401'], analyticId: acc.CC01,
    }).expect(201)).body.id;
    const land = await http.post(`${F}/groups`).set(as(admin)).send({ code: 'LAND', name: 'الأراضي', method: 'straight_line', rate: 0, assetAccountId: acc['1210100201'], gainLossAccountId: acc['3120500401'] }).expect(201);
    expect(land.body.depreciable).toBe(false);
    await http.post(`${F}/groups`).set(as(admin)).send({ code: 'BAD', name: 'خطأ', method: 'straight_line', rate: 10, assetAccountId: acc['1210400201'], gainLossAccountId: acc['3120500401'] }).expect(400);
  });

  it('requires custody for tangible assets and validates flexible fields', async () => {
    await http.post(F).set(as(admin)).send({ groupId: ids.cars, name: 'تويوتا هايس', fieldValues: { f1: 'أ ب ج 1234', f2: `${year}-12-01` } }).expect(400);
    await http.post(F).set(as(admin)).send({ groupId: ids.cars, name: 'تويوتا هايس', custodianEmployeeId: ids.driver, fieldValues: { f1: 'أ ب ج 1234' } }).expect(400);
    const car = await http.post(F).set(as(admin)).send({
      groupId: ids.cars, name: 'حافلة تويوتا هايس', custodianEmployeeId: ids.driver, location: 'المقر الرئيسي', fieldValues: { f1: 'أ ب ج 1234', f2: `${year}-12-01` },
      maintenance: [{ provider: 'وكالة تويوتا', startDate: `${year}-01-01`, endDate: `${year}-12-31`, cost: 3000 }],
    }).expect(201);
    ids.car = car.body.id;
    expect(car.body.code).toBe('FA-CAR-0001');
    expect(car.body.status).toBe('draft');
    expect(car.body.custodianName).toBe('سائق الشركة');
    expect(car.body.custody[0].kind).toBe('issue');
  });

  it('records an opening balance that matches the GL opening entry', async () => {
    await http.post(`${F}/opening`).set(as(admin)).send({ assetId: ids.car, purchaseDate: `${year - 2}-01-01`, asOf: `${year - 1}-12-31`, cost: 120000, accum: 119999.5 }).expect(400);
    const o = await http.post(`${F}/opening`).set(as(admin)).send({ assetId: ids.car, purchaseDate: `${year - 2}-01-01`, asOf: `${year - 1}-12-31`, cost: 120000, accum: 48000 }).expect(201);
    expect(o.body.rows).toHaveLength(1);
    let rec = (await http.get(`${F}/reconciliation`).set(as(admin)).expect(200)).body;
    expect(rec.ok).toBe(false);
    expect(rec.accounts.find((x: { code: string }) => x.code === '1210400201').problems[0]).toContain('الرصيد الافتتاحي');
    await http.post(`${A}/entries`).set(as(admin)).send({
      voucherType: 'opening', documentDate: `${year}-01-01`, description: 'أرصدة الأصول الافتتاحية', post: true,
      lines: [
        { accountId: acc['1210400201'], debit: 120000, credit: 0 }, { accountId: acc['2250100401'], debit: 0, credit: 48000 },
        { accountId: acc['1110100201'], debit: 200000, credit: 0 }, { accountId: acc['2310100101'], debit: 0, credit: 272000 },
      ],
    }).expect(201);
    rec = (await http.get(`${F}/reconciliation`).set(as(admin)).expect(200)).body;
    expect(rec.ok).toBe(true);
  });

  it('runs monthly depreciation, locks its entries and reverses only from the latest', async () => {
    const p = await http.post(`${F}/depreciation/preview`).set(as(admin)).send({ period: ym(1) }).expect(201);
    expect(p.body.total).toBe(2000);
    expect(p.body.groups[0].costOpening).toBe(120000);
    expect(p.body.groups[0].accumOpening).toBe(48000);
    expect(p.body.groups[0].accumClosing).toBe(50000);
    const r1 = await http.post(`${F}/depreciation/post`).set(as(admin)).send({ period: ym(1), expectedTotal: 2000 }).expect(201);
    expect(r1.body.entry.voucherNo).toBe(`1/${year}`);
    ids.run1 = r1.body.id;
    await http.post(`${F}/depreciation/post`).set(as(admin)).send({ period: ym(1) }).expect(400);
    // قيد الإهلاك مقفل من النظام المالي
    const e = r1.body.entry.id;
    await http.post(`${A}/entries/${e}/cancel`).set(as(admin)).send({ reason: 'تجربة' }).expect(409);
    await http.post(`${A}/entries/${e}/unpost`).set(as(admin)).expect(409);
    const de = await http.get(`${A}/entries/${e}`).set(as(admin)).expect(200);
    const ac = (de.body.lines as { accountId: string }[]).map((l) => l.accountId);
    const twoLines = [{ accountId: ac[0], debit: 10, credit: 0 }, { accountId: ac[ac.length - 1], debit: 0, credit: 10 }];
    await http.put(`${A}/entries/${e}`).set(as(admin)).send({ documentDate: `${year}-01-31`, description: 'تعديل', lines: twoLines }).expect(409);
    // لا يُنشأ سند إهلاك ولا سند أصول من قيود اليومية حتى بسطور صحيحة
    for (const t of ['depreciation', 'asset']) {
      await http.post(`${A}/entries`).set(as(admin)).send({
        voucherType: t, documentDate: `${year}-01-31`, description: 'يدوي',
        lines: twoLines,
      }).expect(400);
    }
    const r2 = await http.post(`${F}/depreciation/post`).set(as(admin)).send({ period: ym(2) }).expect(201);
    ids.run2 = r2.body.id;
    const blocked = await http.post(`${F}/runs/${ids.run1}/cancel`).set(as(admin)).send({ reason: 'خطأ' }).expect(409);
    expect(blocked.body.message).toContain(String(r2.body.runNo));
    await http.post(`${F}/runs/${ids.run2}/cancel`).set(as(admin)).send({ reason: 'خطأ' }).expect(201);
    await http.post(`${F}/runs/${ids.run1}/cancel`).set(as(admin)).send({ reason: 'خطأ' }).expect(201);
    let car = (await http.get(`${F}/${ids.car}`).set(as(admin)).expect(200)).body;
    expect(car.accum).toBe(48000);
    expect(car.depreciatedThrough).toBe(`${year - 1}-12-31`);
    // إعادة الاحتساب لشهرين دفعة واحدة (احتساب متأخر) ثم الشهر الثالث
    const p2 = await http.post(`${F}/depreciation/preview`).set(as(admin)).send({ period: ym(2) }).expect(201);
    expect(p2.body.total).toBe(4000);
    expect(p2.body.assets[0].catchUp).toBe(true);
    await http.post(`${F}/depreciation/post`).set(as(admin)).send({ period: ym(2) }).expect(201);
    car = (await http.get(`${F}/${ids.car}`).set(as(admin)).expect(200)).body;
    expect(car.accum).toBe(52000);
    expect((await http.get(`${F}/reconciliation`).set(as(admin)).expect(200)).body.ok).toBe(true);
  });

  it('adds a purchased asset only after its payment voucher is approved', async () => {
    const pc = await http.post(F).set(as(admin)).send({ groupId: ids.it, name: 'حاسب محمول', custodianEmployeeId: ids.keeper, serialNumber: 'SN-1' }).expect(201);
    ids.pc = pc.body.id;
    const op = await http.post(`${F}/operations/purchase`).set(as(admin)).send({ assetId: ids.pc, date: `${year}-02-16`, amount: 4800, method: 'bank', cashAccountId: ids.bank }).expect(201);
    expect(op.body.status).toBe('pending');
    expect((await http.get(`${F}/${ids.pc}`).set(as(admin)).expect(200)).body.status).toBe('pending_purchase');
    const p = await http.post(`${F}/depreciation/preview`).set(as(admin)).send({ period: ym(3) }).expect(201);
    expect(p.body.assets.find((a: { assetId: string }) => a.assetId === ids.pc)).toBeUndefined();
    // سند الصرف لا يُعدَّل من النظام المالي، ويُعتمد بالطريقة المعتادة
    const v = op.body.voucher.id;
    const vv = (await http.get(`${A}/voucher/${v}`).set(as(admin)).expect(200)).body;
    expect(vv.lockedSource).toBe(true);
    expect(vv.can.edit).toBe(false);
    await http.post(`${A}/voucher/${v}/submit`).set(as(admin)).expect(201);
    expect((await http.get(`${F}/${ids.pc}`).set(as(admin)).expect(200)).body.status).toBe('active');
    const p3 = await http.post(`${F}/depreciation/preview`).set(as(admin)).send({ period: ym(3) }).expect(201);
    const row = p3.body.assets.find((a: { assetId: string }) => a.assetId === ids.pc);
    expect(row.catchUp).toBe(true);
    expect(row.depreciation).toBeCloseTo(100 * (13 / 28) + 100, 0);
    expect(p3.body.groups.find((g: { groupName: string }) => g.groupName === 'أجهزة الحاسب').additions).toBe(0);
    await http.post(`${F}/depreciation/post`).set(as(admin)).send({ period: ym(3) }).expect(201);
    // لا يُعكس سند الشراء بعد احتساب إهلاك للأصل
    await http.post(`${A}/voucher/${v}/request`).set(as(admin)).send({ kind: 'cancel', reason: 'خطأ' }).expect(409);
    expect((await http.get(`${F}/reconciliation`).set(as(admin)).expect(200)).body.ok).toBe(true);
  });

  it('buys on credit from a supplier and records additions on remaining life', async () => {
    const pc2 = await http.post(F).set(as(admin)).send({ groupId: ids.it, name: 'طابعة ليزر', custodianEmployeeId: ids.keeper }).expect(201);
    const op = await http.post(`${F}/operations/purchase`).set(as(admin)).send({ assetId: pc2.body.id, date: `${year}-04-01`, amount: 2400, method: 'credit', partnerId: ids.supplier }).expect(201);
    const v = (await http.get(`${A}/voucher/${op.body.voucher.id}`).set(as(admin)).expect(200)).body;
    expect(v.methodLabel).toBe('آجل');
    expect(v.lines.find((l: { credit: number }) => l.credit > 0).credit).toBe(2400);
    await http.post(`${A}/voucher/${v.id}/submit`).set(as(admin)).expect(201);
    expect((await http.get(`${F}/${pc2.body.id}`).set(as(admin)).expect(200)).body.status).toBe('active');
    // إضافة قبل آخر إهلاك مرفوضة، وبعده مقبولة
    await http.post(`${F}/operations/purchase`).set(as(admin)).send({ kind: 'addition', assetId: ids.pc, date: `${year}-03-10`, amount: 600, method: 'bank', cashAccountId: ids.bank }).expect(400);
    const add = await http.post(`${F}/operations/purchase`).set(as(admin)).send({ kind: 'addition', assetId: ids.pc, date: `${year}-04-01`, amount: 600, method: 'bank', cashAccountId: ids.bank }).expect(201);
    await http.post(`${A}/voucher/${add.body.voucher.id}/submit`).set(as(admin)).expect(201);
    expect((await http.get(`${F}/${ids.pc}`).set(as(admin)).expect(200)).body.cost).toBe(5400);
    expect((await http.get(`${F}/reconciliation`).set(as(admin)).expect(200)).body.ok).toBe(true);
  });

  it('sells an asset: partial depreciation to the sale date, then a receipt voucher with gain or loss', async () => {
    const s = await http.post(`${F}/operations/sale`).set(as(admin)).send({ assetId: ids.car, date: `${year}-04-15`, price: 70000, method: 'credit', partnerId: ids.customer }).expect(201);
    expect(s.body.depRun.total).toBeCloseTo(1000, 0); // مارس مُهلَك، ونصف أبريل
    const car = (await http.get(`${F}/${ids.car}`).set(as(admin)).expect(200)).body;
    expect(car.status).toBe('pending_sale');
    const accum = car.accum;
    expect(s.body.gainLoss).toBeCloseTo(70000 - (120000 - accum), 2);
    // لا إهلاك بعد البيع لأصل ينتظر البيع
    await http.post(`${F}/runs/${s.body.depRun.id}/cancel`).set(as(admin)).send({ reason: 'تجربة' }).expect(409);
    await http.post(`${A}/voucher/${s.body.voucher.id}/submit`).set(as(admin)).expect(201);
    const sold = (await http.get(`${F}/${ids.car}`).set(as(admin)).expect(200)).body;
    expect(sold.status).toBe('sold');
    expect(sold.custodianId).toBeNull();
    expect((await http.get(`${F}/reconciliation`).set(as(admin)).expect(200)).body.ok).toBe(true);
  });

  it('records in-kind donations and scrapping, and cancels a scrap', async () => {
    const d = await http.post(F).set(as(admin)).send({ groupId: ids.it, name: 'شاشة عرض متبرع بها', custodianEmployeeId: ids.keeper }).expect(201);
    const don = await http.post(`${F}/operations/donation`).set(as(admin)).send({ assetId: d.body.id, date: `${year}-04-05`, amount: 1200, counterAccountId: acc['3120200101'], partyName: 'متبرع كريم' }).expect(201);
    expect(don.body.entry.voucherNo).toBe(`1/${year}`);
    const sc = await http.post(`${F}/operations/scrap`).set(as(admin)).send({ assetId: d.body.id, date: `${year}-04-20`, notes: 'تلف كامل' }).expect(201);
    expect((await http.get(`${F}/${d.body.id}`).set(as(admin)).expect(200)).body.status).toBe('scrapped');
    expect((await http.get(`${F}/reconciliation`).set(as(admin)).expect(200)).body.ok).toBe(true);
    await http.post(`${F}/operations/${sc.body.id}/cancel`).set(as(admin)).send({ reason: 'تم إصلاحه' }).expect(201);
    const back = (await http.get(`${F}/${d.body.id}`).set(as(admin)).expect(200)).body;
    expect(back.status).toBe('active');
    expect(back.custodianId).toBe(ids.keeper);
    expect((await http.get(`${F}/reconciliation`).set(as(admin)).expect(200)).body.ok).toBe(true);
  });

  it('flags a manual entry on an asset account in the reconciliation', async () => {
    await http.post(`${A}/entries`).set(as(admin)).send({
      voucherType: 'journal', documentDate: `${year}-04-25`, description: 'شراء أثاث مسجل خطأ على حساب الحاسبات', post: true,
      lines: [{ accountId: acc['1211000101'], debit: 500, credit: 0 }, { accountId: acc['1110100201'], debit: 0, credit: 500 }],
    }).expect(201);
    const rec = (await http.get(`${F}/reconciliation`).set(as(admin)).expect(200)).body;
    expect(rec.ok).toBe(false);
    const bad = rec.accounts.find((x: { ok: boolean }) => !x.ok);
    expect(bad.diff).toBe(500);
    expect(bad.problems.join(' ')).toContain('لم يصدر من الأصول الثابتة');
    expect(rec.groups.find((g: { name: string }) => g.name === 'أجهزة الحاسب').ok).toBe(false);
  });

  it('moves custody between employees and blocks clearance while assets are held', async () => {
    const svc = app.get(AssetsService);
    const org = (await app.get(DataSource).query(`SELECT id FROM organizations WHERE slug = 'namaa'`))[0].id;
    await expect(svc.assertNoCustody(org, ids.keeper)).rejects.toThrow('عهدة أصول ثابتة');
    const held = (await http.get(`${F}/custody/employee/${ids.keeper}`).set(as(admin)).expect(200)).body.held as { id: string }[];
    for (const a of held) await http.post(`${F}/${a.id}/custody`).set(as(admin)).send({ toEmployeeId: ids.driver, toLocation: 'المستودع', condition: 'جيد' }).expect(201);
    await expect(svc.assertNoCustody(org, ids.keeper)).resolves.toBeUndefined();
    const board = (await http.get(`${F}/custody`).set(as(admin)).expect(200)).body;
    expect(board.employees[0].name).toBe('سائق الشركة');
    const form = board.recent[0];
    await http.post(`${F}/custody/forms/${form.id}/confirm`).set(as(admin)).expect(201);
    expect((await http.get(`${F}/custody/forms/${form.id}`).set(as(admin)).expect(200)).body.to.name).toBe('سائق الشركة');
  });

  it('runs a stocktake with QR labels and reports variances', async () => {
    const labels = (await http.get(`${F}/labels?base=https://app.example.org`).set(as(admin)).expect(200)).body.labels;
    expect(labels[0].svg).toContain('<svg');
    const st = await http.post(`${F}/stocktakes`).set(as(admin)).send({ title: 'جرد نهاية الربع' }).expect(201);
    const first = st.body.lines[0];
    const c = await http.post(`${F}/stocktakes/${st.body.id}/count`).set(as(admin)).send({ code: `https://app.example.org/accounting/assets/a/${first.code}`, location: 'غرفة الاجتماعات', condition: 'جيد' }).expect(201);
    expect(c.body.matched).toBe(true);
    await http.post(`${F}/stocktakes/${st.body.id}/count`).set(as(admin)).send({ code: 'FA-XX-9999' }).expect(201);
    const closed = (await http.post(`${F}/stocktakes/${st.body.id}/close`).set(as(admin)).expect(201)).body;
    expect(closed.counts.missing).toBe(closed.counts.total - 1);
    expect(closed.counts.extras).toBe(1);
  });

  it('runs every fixed-asset report and the dashboard', async () => {
    const cat = (await http.get('/api/reports/catalog/accounting').set(as(admin)).expect(200)).body as { code: string }[] | { reports: { code: string }[] };
    const list = (Array.isArray(cat) ? cat : cat.reports).filter((r) => r.code.startsWith('accounting.assets.'));
    expect(list.length).toBeGreaterThanOrEqual(14);
    for (const r of list) {
      const def = (await http.get(`/api/reports/def/${r.code}`).set(as(admin)).expect(200)).body;
      const q: Record<string, string> = {};
      for (const f of def.filters) q[f.key] = f.default ?? (f.required && f.options?.length ? f.options[0].value : '');
      if (q.from === 'yearStart') q.from = `${year}-01-01`;
      if (q.to === 'today' || q.asOf === 'today') { q.to = `${year}-12-31`; q.asOf = `${year}-12-31`; }
      if (q.year === 'currentYear') q.year = String(year);
      const res = await http.get(`/api/reports/run/${r.code}`).query(q).set(as(admin));
      expect([r.code, res.status]).toEqual([r.code, 200]);
    }
    const d = (await http.get(`${F}/dashboard`).set(as(admin)).expect(200)).body;
    expect(d.kpis.inBooks).toBeGreaterThan(0);
    expect(d.reconciliation.ok).toBe(false);
  });
});
