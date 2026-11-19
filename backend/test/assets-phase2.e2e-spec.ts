import { Test } from '@nestjs/testing';
import { NestExpressApplication } from '@nestjs/platform-express';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/main';
import ExcelJS from 'exceljs';

/**
 * الأصول الثابتة (المرحلة الثانية): إعادة التقييم وهبوط القيمة، التأمين والضمان وتنبيهاتهما، سجل الصيانة وخطة الصيانة الوقائية والأصول كثيرة الأعطال،
 * الأصول الممولة من منحة (تخفيض المقيد عند اعتماد الشراء)، الأصول تحت التنفيذ ورسملتها، استيراد الأصول من Excel، الموازنة الرأسمالية.
 */
const DB = process.env.TEST_DATABASE_URL ?? 'postgres://erp:erp@localhost:5432/charity_erp_test';

describe('Fixed assets phase 2', () => {
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
    ids.driver = await emp('سائق الجمعية');
    ids.keeper = await emp('أمين المستودع');

    const group = (body: Record<string, unknown>) => http.post(`${F}/groups`).set(as(admin)).send({ gainLossAccountId: acc['3120500401'], analyticId: acc.CC01, ...body }).expect(201).then((r) => r.body.id as string);
    ids.it = await group({ code: 'IT', name: 'أجهزة الحاسب', method: 'straight_line', lifeYears: 4, assetAccountId: acc['1211000101'], accumAccountId: acc['2250101001'], expenseAccountId: acc['4131000101'] });
    ids.bld = await group({ code: 'BLD', name: 'المباني', method: 'straight_line', rate: 4, assetAccountId: acc['1210200201'], accumAccountId: acc['2250100201'], expenseAccountId: acc['4130200101'] });
    ids.land = await group({ code: 'LAND', name: 'الأراضي', method: 'straight_line', rate: 0, assetAccountId: acc['1210100201'] });
    ids.car = await group({
      code: 'CAR', name: 'السيارات', method: 'straight_line', rate: 20, assetAccountId: acc['1210400201'], accumAccountId: acc['2250100401'], expenseAccountId: acc['4130400201'],
      fields: [{ label: 'رقم اللوحة', type: 'text', required: true }],
    });
    await http.put(`${F}/config`).set(as(admin)).send({
      revaluationAccountId: acc['2310100101'], impairmentAccountId: acc['4140100101'], wipAccountId: acc['1240100201'],
      grantReleaseAccountId: acc['3140100101'], maintenanceAccountId: acc['4120201001'],
    }).expect(200);
  });

  const db = () => app.get(DataSource);
  const glBalance = async (code: string) => Number((await db().query(
    `SELECT COALESCE(SUM(l.debit - l.credit), 0) AS b FROM acc_entry_lines l JOIN acc_entries e ON e.id = l.entry_id WHERE e.status = 'posted' AND l.account_id = $1`, [acc[code]]))[0].b);
  const approve = (voucherId: string) => http.post(`${A}/voucher/${voucherId}/submit`).set(as(admin)).expect(201);
  const recOk = async () => (await http.get(`${F}/reconciliation`).set(as(admin)).expect(200)).body;
  const buy = async (groupId: string, name: string, date: string, amount: number, extra: Record<string, unknown> = {}) => {
    const a = await http.post(F).set(as(admin)).send({ groupId, name, custodianEmployeeId: ids.keeper }).expect(201);
    const op = await http.post(`${F}/operations/purchase`).set(as(admin)).send({ assetId: a.body.id, date, amount, method: 'bank', cashAccountId: ids.bank, ...extra }).expect(201);
    await approve(op.body.voucher.id);
    return { id: a.body.id as string, op: op.body };
  };

  afterAll(async () => {
    await app.get(DataSource).destroy();
    await app.close();
    rmSync(uploadDir, { recursive: true, force: true });
  });

  it('revalues upward and records impairment, then depreciates the new value over the remaining life', async () => {
    const pc = await buy(ids.it, 'خادم الشبكة', `${year}-01-01`, 48000);
    ids.server = pc.id;
    for (const m of [1, 2, 3]) await http.post(`${F}/depreciation/post`).set(as(admin)).send({ period: ym(m), assetIds: [pc.id] }).expect(201);
    let a = (await http.get(`${F}/${pc.id}`).set(as(admin)).expect(200)).body;
    expect(a.accum).toBe(3000);
    // القيمة العادلة أقل من صافي القيمة: ليست إعادة تقييم
    await http.post(`${F}/operations/revaluation`).set(as(admin)).send({ assetId: pc.id, date: `${year}-04-01`, fairValue: 40000, partyName: 'مقيّم معتمد' }).expect(400);
    // قبل آخر إهلاك مرفوض
    await http.post(`${F}/operations/revaluation`).set(as(admin)).send({ assetId: pc.id, date: `${year}-03-15`, fairValue: 50000, partyName: 'مقيّم معتمد' }).expect(400);
    const rv = await http.post(`${F}/operations/revaluation`).set(as(admin)).send({ assetId: pc.id, date: `${year}-04-01`, fairValue: 49500, partyName: 'مقيّم معتمد' }).expect(201);
    expect(rv.body.amount).toBe(4500);
    a = (await http.get(`${F}/${pc.id}`).set(as(admin)).expect(200)).body;
    expect(a.cost).toBe(52500);
    expect(await glBalance('2310100101')).toBe(-4500);
    // أبريل: صافي 49,500 على 45 شهرًا متبقية
    const p = await http.post(`${F}/depreciation/preview`).set(as(admin)).send({ period: ym(4), assetIds: [pc.id] }).expect(201);
    expect(p.body.total).toBeCloseTo(1100, 1);
    const im = await http.post(`${F}/operations/impairment`).set(as(admin)).send({ assetId: pc.id, date: `${year}-04-10`, recoverable: 45000, notes: 'تلف جزئي بسبب تسرب مياه' }).expect(201);
    expect(im.body.accum).toBe(4500);
    a = (await http.get(`${F}/${pc.id}`).set(as(admin)).expect(200)).body;
    expect(a.nbv).toBe(45000);
    expect(await glBalance('4140100101')).toBe(4500);
    expect((await recOk()).ok).toBe(true);
    // إلغاء هبوط القيمة يعيد صافي القيمة
    await http.post(`${F}/operations/${im.body.id}/cancel`).set(as(admin)).send({ reason: 'أعيد التقدير' }).expect(201);
    expect((await http.get(`${F}/${pc.id}`).set(as(admin)).expect(200)).body.nbv).toBe(49500);
    // هبوط قيمة أرض: يخفض التكلفة لأن الأراضي بلا مجمع إهلاك
    const land = await buy(ids.land, 'أرض المستودع', `${year}-02-01`, 300000);
    await http.post(`${F}/operations/impairment`).set(as(admin)).send({ assetId: land.id, date: `${year}-05-01`, recoverable: 280000, notes: 'انخفاض أسعار المنطقة' }).expect(201);
    expect((await http.get(`${F}/${land.id}`).set(as(admin)).expect(200)).body.cost).toBe(280000);
    expect((await recOk()).ok).toBe(true);
  });

  it('tracks insurance and warranty only when the asset requires them', async () => {
    const car = await http.post(F).set(as(admin)).send({
      groupId: ids.car, name: 'سيارة نقل', custodianEmployeeId: ids.driver, fieldValues: { f1: 'ن ق ل 77' }, insuranceRequired: true, warrantyRequired: false,
    }).expect(201);
    const op = await http.post(`${F}/operations/purchase`).set(as(admin)).send({ assetId: car.body.id, date: `${year}-03-01`, amount: 90000, method: 'bank', cashAccountId: ids.bank }).expect(201);
    await approve(op.body.voucher.id);
    let a = (await http.get(`${F}/${car.body.id}`).set(as(admin)).expect(200)).body;
    expect(a.alerts.some((x: { kind: string }) => x.kind === 'insurance')).toBe(true);
    // وثيقة نهايتها قبل بدايتها مرفوضة
    const body = { groupId: ids.car, name: 'سيارة نقل', fieldValues: { f1: 'ن ق ل 77' }, insuranceRequired: true, warrantyRequired: true };
    await http.patch(`${F}/${car.body.id}`).set(as(admin)).send({ ...body, insurance: { provider: 'التعاونية', startDate: `${year}-03-01`, endDate: `${year}-01-01` } }).expect(400);
    await http.patch(`${F}/${car.body.id}`).set(as(admin)).send({
      ...body, insurance: { provider: 'التعاونية', policyNo: 'POL-1', startDate: `${year}-03-01`, endDate: `${year + 1}-12-31`, cost: 2500, coverage: 90000 },
      warranty: { provider: 'الوكيل', endDate: `${year + 3}-03-01` },
    }).expect(200);
    a = (await http.get(`${F}/${car.body.id}`).set(as(admin)).expect(200)).body;
    expect(a.insurance.policyNo).toBe('POL-1');
    expect(a.alerts.filter((x: { kind: string }) => x.kind === 'insurance' || x.kind === 'warranty')).toHaveLength(0);
    ids.truck = car.body.id;
  });

  it('logs maintenance, advances the preventive plan, pays by voucher and flags frequent failures', async () => {
    const t = new Date().toISOString().slice(0, 10);
    const body = { groupId: ids.car, name: 'سيارة نقل', fieldValues: { f1: 'ن ق ل 77' }, insuranceRequired: true, insurance: { provider: 'التعاونية', startDate: `${year}-03-01`, endDate: `${year + 1}-12-31` }, maintenancePlan: { intervalMonths: 3, nextDate: t } };
    await http.patch(`${F}/${ids.truck}`).set(as(admin)).send(body).expect(200);
    expect((await http.get(`${F}/maintenance/due`).set(as(admin)).expect(200)).body.some((d: { assetId: string }) => d.assetId === ids.truck)).toBe(true);
    const pm = await http.post(`${F}/maintenance`).set(as(admin)).send({
      assetId: ids.truck, kind: 'preventive', date: t, description: 'تغيير الزيت والفلاتر', vendor: 'مركز الصيانة', cost: 450, pay: true, method: 'bank', cashAccountId: ids.bank,
    }).expect(201);
    expect(pm.body.voucher.status).toBeDefined();
    const a = (await http.get(`${F}/${ids.truck}`).set(as(admin)).expect(200)).body;
    expect(a.maintenancePlan.nextDate > t).toBe(true);
    expect(a.maintenanceLog).toHaveLength(1);
    // لا يُحذف سجل له سند صرف قائم
    await http.delete(`${F}/maintenance/${pm.body.id}`).set(as(admin)).expect(400);
    await approve(pm.body.voucher.id);
    expect(await glBalance('4120201001')).toBe(450);
    for (const d of ['04-10', '05-20', '06-15']) {
      await http.post(`${F}/maintenance`).set(as(admin)).send({ assetId: ids.truck, kind: 'repair', date: `${year}-${d}`, description: 'عطل في ناقل الحركة', cost: 3000, downtimeDays: 4 }).expect(201);
    }
    const f = (await http.get(`${F}/maintenance/failures`).set(as(admin)).query({ from: `${year}-01-01`, to: `${year}-12-31` }).expect(200)).body;
    const row = f.rows.find((r: { assetId: string }) => r.assetId === ids.truck);
    expect(row.repairs).toBe(3);
    expect(row.frequent).toBe(true);
    expect(row.downtimeDays).toBe(12);
  });

  it('reduces restricted net assets as soon as a grant-funded purchase is approved', async () => {
    const a = await http.post(F).set(as(admin)).send({ groupId: ids.it, name: 'أجهزة مشروع التدريب', custodianEmployeeId: ids.keeper }).expect(201);
    // المبلغ الممول أكبر من الشراء مرفوض
    await http.post(`${F}/operations/purchase`).set(as(admin)).send({
      assetId: a.body.id, date: `${year}-05-01`, amount: 12000, method: 'bank', cashAccountId: ids.bank, fundingAccountId: acc['2310200101'], fundingName: 'منحة التدريب', fundedAmount: 15000,
    }).expect(400);
    const op = await http.post(`${F}/operations/purchase`).set(as(admin)).send({
      assetId: a.body.id, date: `${year}-05-01`, amount: 12000, method: 'bank', cashAccountId: ids.bank, fundingAccountId: acc['2310200101'], fundingName: 'منحة صندوق دعم الجمعيات',
    }).expect(201);
    expect(op.body.funding.entry).toBeNull();
    expect(await glBalance('2310200101')).toBe(0);
    await approve(op.body.voucher.id);
    const done = (await http.get(`${F}/operations`).set(as(admin)).query({ assetId: a.body.id }).expect(200)).body[0];
    expect(done.funding.entry.status).toBe('posted');
    expect(await glBalance('2310200101')).toBe(12000);
    expect(await glBalance('3140100101')).toBe(-12000);
    expect((await recOk()).ok).toBe(true);
  });

  it('accumulates work in progress and capitalizes it into the asset group', async () => {
    const b = await http.post(F).set(as(admin)).send({ groupId: ids.bld, name: 'مبنى مركز الأسرة', custodianEmployeeId: ids.keeper }).expect(201);
    ids.building = b.body.id;
    const p1 = await http.post(`${F}/operations/purchase`).set(as(admin)).send({ kind: 'wip', assetId: b.body.id, date: `${year}-02-01`, amount: 500000, method: 'bank', cashAccountId: ids.bank, partyName: 'مقاول البناء' }).expect(201);
    expect((await http.get(`${F}/${b.body.id}`).set(as(admin)).expect(200)).body.status).toBe('construction');
    await approve(p1.body.voucher.id);
    const p2 = await http.post(`${F}/operations/purchase`).set(as(admin)).send({ kind: 'wip', assetId: b.body.id, date: `${year}-04-01`, amount: 300000, method: 'bank', cashAccountId: ids.bank }).expect(201);
    // لا رسملة ودفعة تنتظر الاعتماد
    await http.post(`${F}/operations/capitalize`).set(as(admin)).send({ assetId: b.body.id, date: `${year}-05-01` }).expect(400);
    await approve(p2.body.voucher.id);
    expect(await glBalance('1240100201')).toBe(800000);
    let rec = await recOk();
    expect(rec.accounts.find((x: { kind: string }) => x.kind === 'wip').subledger).toBe(800000);
    expect(rec.ok).toBe(true);
    // لا تدخل الدفعات تكلفة الأصل ولا الإهلاك قبل الرسملة
    expect((await http.get(`${F}/${b.body.id}`).set(as(admin)).expect(200)).body.cost).toBe(0);
    await http.post(`${F}/operations/capitalize`).set(as(admin)).send({ assetId: b.body.id, date: `${year}-03-01` }).expect(400);
    const cap = await http.post(`${F}/operations/capitalize`).set(as(admin)).send({ assetId: b.body.id, date: `${year}-05-01` }).expect(201);
    expect(cap.body.amount).toBe(800000);
    const a = (await http.get(`${F}/${b.body.id}`).set(as(admin)).expect(200)).body;
    expect(a.status).toBe('active');
    expect(a.cost).toBe(800000);
    expect(a.inServiceDate).toBe(`${year}-05-01`);
    expect(await glBalance('1240100201')).toBe(0);
    rec = await recOk();
    expect(rec.ok).toBe(true);
    // سند دفعة رُسملت لا يُعكس
    await http.post(`${A}/voucher/${p1.body.voucher.id}/request`).set(as(admin)).send({ kind: 'cancel', reason: 'خطأ' }).expect(409);
  });

  it('imports assets from the Excel template with complete, partial and rejected results', async () => {
    const tpl = await http.get(`${F}/import/template`).set(as(admin)).buffer(true).parse((res, cb) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => cb(null, Buffer.concat(chunks)));
    }).expect(200);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(tpl.body as ArrayBuffer);
    const ws = wb.getWorksheet('الأصول')!;
    const header = (ws.getRow(1).values as string[]).slice(1);
    expect(header[0]).toBe('رمز المجموعة *');
    const plate = header.indexOf('رقم اللوحة (CAR) *') + 1;
    expect(plate).toBeGreaterThan(0);
    const fill = (r: number, vals: (string | number | Date)[], extra: Record<number, string> = {}) => {
      vals.forEach((v, i) => (ws.getRow(r).getCell(i + 1).value = v));
      for (const [c, v] of Object.entries(extra)) ws.getRow(r).getCell(Number(c)).value = v;
    };
    const empNo = String((await db().query('SELECT employee_no FROM hr_employees WHERE id = $1', [ids.keeper]))[0].employee_no);
    fill(2, ['IT', 'حاسب مكتبي قديم', '', 'OLD-1', 'المقر', empNo, `${year - 2}-06-01`, 6000, 3000, 0, 'لا', 'لا']);
    fill(3, ['CAR', 'سيارة قديمة', '', '', 'المقر', empNo, `15/06/${year - 3}`, 80000, 40000, 0, 'نعم', 'لا'], { [plate]: 'ق د م 1' });
    fill(4, ['IT', 'جهاز بلا موظف', '', 'OLD-1', '', '', `${year - 1}-01-01`, 3000, 5000]);
    fill(5, ['XX', '', '', '', '', '', '', '', '']);
    const buf = Buffer.from(await wb.xlsx.writeBuffer());
    const strict = await http.post(`${F}/import`).set(as(admin)).field('mode', 'strict').attach('file', buf, 'assets.xlsx').expect(201);
    expect(strict.body.status).toBe('rejected');
    expect(strict.body.imported).toBe(0);
    const partial = await http.post(`${F}/import`).set(as(admin)).attach('file', buf, 'assets.xlsx').expect(201);
    expect(partial.body.status).toBe('partial');
    expect(partial.body.imported).toBe(2);
    const row4 = partial.body.errors.find((e: { row: number }) => e.row === 4).messages.join(' ');
    expect(row4).toContain('عهدة');
    expect(row4).toContain('مكرر');
    expect(row4).toContain('مجمع الإهلاك');
    expect(partial.body.errors.find((e: { row: number }) => e.row === 5).messages.join(' ')).toContain('رمز المجموعة');
    const car = partial.body.assets.find((x: { name: string }) => x.name === 'سيارة قديمة');
    const a = (await http.get(`${F}/${car.id}`).set(as(admin)).expect(200)).body;
    expect(a.status).toBe('active');
    expect(a.cost).toBe(80000);
    expect(a.inServiceDate).toBe(`${year - 3}-06-15`);
    expect(a.insuranceRequired).toBe(true);
    // ملف ليس النموذج مرفوض برسالة واضحة
    const other = new ExcelJS.Workbook();
    other.addWorksheet('ورقة').addRow(['اسم', 'قيمة']);
    const bad = await http.post(`${F}/import`).set(as(admin)).attach('file', Buffer.from(await other.xlsx.writeBuffer()), 'x.xlsx').expect(400);
    expect(bad.body.message).toContain('ليس نموذج الاستيراد');
    // ملف كله سليم: مكتمل
    const wb2 = new ExcelJS.Workbook();
    await wb2.xlsx.load(tpl.body as ArrayBuffer);
    const ws2 = wb2.getWorksheet('الأصول')!;
    ['IT', 'طابعة قديمة', '', 'OLD-9', '', empNo].forEach((v, i) => (ws2.getRow(2).getCell(i + 1).value = v));
    const ok = await http.post(`${F}/import`).set(as(admin)).attach('file', Buffer.from(await wb2.xlsx.writeBuffer()), 'ok.xlsx').expect(201);
    expect(ok.body.status).toBe('complete');
    expect((await http.get(`${F}/import`).set(as(admin)).expect(200)).body).toHaveLength(3);
  });

  it('plans a capital budget and compares it with actual purchases', async () => {
    const fy = (await db().query('SELECT id FROM acc_fiscal_years LIMIT 1'))[0];
    const b = await http.post(`${F}/budgets`).set(as(admin)).send({
      fiscalYearId: fy.id, externalRef: 'PLAN-2026', lines: [
        { groupId: ids.it, description: 'أجهزة حاسب للموظفين الجدد', quantity: 4, amount: 10000, quarter: 2, externalRef: 'P-IT-1' },
        { groupId: ids.car, description: 'سيارة توزيع', amount: 95000, quarter: 3 },
      ],
    }).expect(201);
    expect(b.body.planned).toBe(105000);
    const a = await http.post(F).set(as(admin)).send({ groupId: ids.it, name: 'حاسب موظف جديد', custodianEmployeeId: ids.keeper }).expect(201);
    const line = b.body.lines[0].id;
    // الموازنة غير معتمدة
    await http.post(`${F}/operations/purchase`).set(as(admin)).send({ assetId: a.body.id, date: `${year}-06-01`, amount: 4000, method: 'bank', cashAccountId: ids.bank, budgetLineId: line }).expect(400);
    await http.post(`${F}/budgets/${b.body.id}/approve`).set(as(admin)).expect(201);
    // بند لمجموعة أخرى مرفوض
    await http.post(`${F}/operations/purchase`).set(as(admin)).send({ assetId: a.body.id, date: `${year}-06-01`, amount: 4000, method: 'bank', cashAccountId: ids.bank, budgetLineId: b.body.lines[1].id }).expect(400);
    const op = await http.post(`${F}/operations/purchase`).set(as(admin)).send({ assetId: a.body.id, date: `${year}-06-01`, amount: 4000, method: 'bank', cashAccountId: ids.bank, budgetLineId: line }).expect(201);
    let g = (await http.get(`${F}/budgets/${b.body.id}`).set(as(admin)).expect(200)).body;
    expect(g.lines[0].committed).toBe(4000);
    await approve(op.body.voucher.id);
    g = (await http.get(`${F}/budgets/${b.body.id}`).set(as(admin)).expect(200)).body;
    expect(g.lines[0].actual).toBe(4000);
    expect(g.lines[0].remaining).toBe(6000);
    expect(g.unbudgetedTotal).toBeGreaterThan(0);
    // رقابة المنع عند التجاوز
    await http.put(`${F}/config`).set(as(admin)).send({ budgetControl: 'block' }).expect(200);
    const a2 = await http.post(F).set(as(admin)).send({ groupId: ids.it, name: 'حاسب إضافي', custodianEmployeeId: ids.keeper }).expect(201);
    await http.post(`${F}/operations/purchase`).set(as(admin)).send({ assetId: a2.body.id, date: `${year}-06-02`, amount: 7000, method: 'bank', cashAccountId: ids.bank, budgetLineId: line }).expect(400);
    expect((await http.get(`${F}/budgets/options`).set(as(admin)).expect(200)).body.find((o: { id: string }) => o.id === line).remaining).toBe(6000);
    // لا تُحذف موازنة معتمدة
    await http.delete(`${F}/budgets/${b.body.id}`).set(as(admin)).expect(400);
  });

  it('runs the new reports and the dashboard', async () => {
    for (const code of ['insurance', 'maintenance', 'failures', 'revaluations', 'wip', 'funded', 'capital-budget', 'roll-forward', 'card']) {
      const def = (await http.get(`/api/reports/def/accounting.assets.${code}`).set(as(admin)).expect(200)).body;
      const q: Record<string, string> = {};
      for (const f of def.filters) q[f.key] = f.default ?? (f.required && f.options?.length ? f.options[0].value : '');
      if (q.from === 'yearStart') q.from = `${year}-01-01`;
      if (q.to === 'today') q.to = `${year}-12-31`;
      if (code === 'card') q.assetId = ids.server;
      const res = await http.get(`/api/reports/run/accounting.assets.${code}`).query(q).set(as(admin));
      expect([code, res.status]).toEqual([code, 200]);
      if (['failures', 'wip', 'funded', 'capital-budget', 'revaluations', 'maintenance'].includes(code)) expect([code, res.body.rows.length > 0]).toEqual([code, true]);
    }
    const d = (await http.get(`${F}/dashboard`).set(as(admin)).expect(200)).body;
    expect(d.kpis.maintenanceYear).toBeGreaterThan(0);
    expect(d.budget.planned).toBe(105000);
  });
});
