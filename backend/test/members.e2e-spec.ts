import { Test } from '@nestjs/testing';
import { NestExpressApplication } from '@nestjs/platform-express';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/main';
import { addMonths, ageOn, periodEnd } from '../src/modules/members/mem-forms';

/**
 * العضوية: الإعدادات والأنواع، التقديم العام بصورة الهوية والإقرار بالشروط، مراحل الاعتماد والإرجاع،
 * مطالبة الاشتراك والدفع الإلكتروني (البيئة التجريبية) والتحويل والنقد، سند القبض في النظام المالي،
 * التجديد والتنبيهات، بطاقة العضوية، حق التصويت والتقارير.
 */
const DB = process.env.TEST_DATABASE_URL ?? 'postgres://erp:erp@localhost:5432/charity_erp_test';
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 1)]);
const today = () => new Date(Date.now() + 3 * 3600000).toISOString().slice(0, 10);
const shift = (d: string, n: number) => new Date(new Date(`${d}T12:00:00Z`).getTime() + n * 86400000).toISOString().slice(0, 10);

describe('membership date helpers', () => {
  it('computes periods and ages', () => {
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
    expect(periodEnd('2026-03-01', 12)).toBe('2027-02-28');
    expect(periodEnd('2026-01-15', 6)).toBe('2026-07-14');
    expect(ageOn('2008-11-18', '2026-11-17')).toBe(17);
    expect(ageOn('2008-11-17', '2026-11-17')).toBe(18);
  });
});

describe('Members', () => {
  let app: NestExpressApplication;
  let http: ReturnType<typeof request>;
  let admin: string;
  let reviewer: string;
  let clerk: string;
  let uploadDir: string;
  const as = (t: string) => ({ Authorization: `Bearer ${t}` });
  const login = async (login: string, password: string, organization?: string) =>
    (await http.post('/api/auth/login').send({ login, password, organization }).expect(200)).body.accessToken as string;
  const M = '/api/members';
  const PUB = '/api/public/members';
  const A = '/api/accounting';
  const ids: Record<string, string> = {};
  const acc: Record<string, string> = {};
  const year = Number(today().slice(0, 4));
  const person = (over: Record<string, unknown> = {}) => ({
    fullName: 'عبدالله محمد الشهري', nationalId: '1012345678', nationality: 'سعودي', gender: 'male', birthDate: '1985-04-12', mobile: '0551234567',
    email: 'abdullah@example.com', city: 'جدة', occupation: 'مهندس', typeCode: 'working', acceptedConditions: ['capacity', 'record', 'commit', 'fee', 'truth'], ...over,
  });
  const apply = (data: Record<string, unknown>, withId = true) => {
    const r = http.post(`${PUB}/org/albir/apply`).field('data', JSON.stringify(data));
    return withId ? r.attach('id_front', PNG, 'id.png') : r;
  };

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
    const role = async (name: string, permissions: string[]) => (await http.post('/api/roles').set(as(admin)).send({ name, permissions }).expect(201)).body.id as string;
    ids.reviewRole = await role('لجنة العضوية', ['members.dashboard.read', 'members.applications.approve']);
    ids.clerkRole = await role('موظف العضوية', ['members.dashboard.read', 'members.applications.manage', 'members.members.manage']);
    await http.post('/api/users').set(as(admin)).send({ fullName: 'مراجع العضوية', email: 'rev@test.org', password: 'Review12345', roleIds: [ids.reviewRole] }).expect(201);
    await http.post('/api/users').set(as(admin)).send({ fullName: 'موظف العضوية', email: 'clerk@test.org', password: 'Clerk12345', roleIds: [ids.clerkRole] }).expect(201);
    reviewer = await login('rev@test.org', 'Review12345', 'albir');
    clerk = await login('clerk@test.org', 'Clerk12345', 'albir');

    // النظام المالي: الدليل والسنة المالية وبنك وصندوق
    await http.post(`${A}/chart/install`).set(as(admin)).expect(201);
    const accounts = (await http.get(`${A}/accounts`).set(as(admin)).expect(200)).body.accounts as { id: string; code: string; kind: string }[];
    accounts.forEach((a) => (acc[a.code] = a.id));
    acc.revenue = accounts.filter((a) => a.code.startsWith('31205001') && a.kind === 'sub').sort((a, b) => b.code.length - a.code.length)[0].id;
    await http.post(`${A}/setup`).set(as(admin)).send({
      fiscalYear: year, startDate: `${year}-01-01`, endDate: `${year}-12-31`, isFirstYear: true, firstYearStart: `${year}-01-01`, firstYearEnd: `${year}-12-31`,
    }).expect(201);
    ids.bank = (await http.post(`${A}/cash-accounts`).set(as(admin)).send({ kind: 'bank', name: 'الراجحي - الاشتراكات', bankName: 'مصرف الراجحي', accountNumber: '608010167519', glAccountId: acc['1110100201'] }).expect(201)).body.id;
  });

  afterAll(async () => {
    await app.get(DataSource).destroy();
    await app.close();
    rmSync(uploadDir, { recursive: true, force: true });
  });

  it('starts with the default types, conditions, regulation and approval stages', async () => {
    const s = (await http.get(`${M}/settings`).set(as(admin)).expect(200)).body;
    expect(s.types.map((t: { code: string }) => t.code)).toEqual(['working', 'affiliate', 'honorary']);
    expect(s.conditions.length).toBe(5);
    expect(s.stages.length).toBe(2);
    expect(s.payment).toMatchObject({ provider: 'sandbox', hasSecretKey: false });
    expect(s.payment.secretKey).toBeUndefined();
    await http.get(`${M}/settings`).set(as(clerk)).expect(403);
    // المرحلة الثانية لدور لجنة العضوية فقط
    await http.put(`${M}/settings/stages`).set(as(admin)).send({ data: { stages: [{ name: 'مراجعة الشروط', roleId: null }, { name: 'اعتماد اللجنة', roleId: ids.reviewRole }] } }).expect(200);
    // النوع المستخدم لا يُحذف لاحقًا، والآيبان مطلوب للتحويل
    await http.put(`${M}/settings/payment`).set(as(admin)).send({ data: { online: true, transfer: true, cash: true, provider: 'sandbox', dueDays: 10 } }).expect(400);
    await http.put(`${M}/settings/payment`).set(as(admin)).send({ data: { online: true, transfer: true, cash: true, provider: 'sandbox', dueDays: 10, iban: 'SA03 8000 0000 6080 1016 7519', bankName: 'مصرف الراجحي', accountName: 'جمعية البر' } }).expect(200);
    await http.put(`${M}/settings/payment`).set(as(admin)).send({ data: { online: true, transfer: true, cash: true, provider: 'moyasar', dueDays: 10, iban: 'SA0380000000608010167519' } }).expect(400);
    const reg = (await http.put(`${M}/settings/regulation`).set(as(admin)).send({ data: { title: 'أحكام العضوية', sections: [{ title: 'الشروط', body: 'نص' }], effectiveDate: '2026-01-01' } }).expect(200)).body;
    expect(reg.regulation).toMatchObject({ version: 1, updatedByName: 'مدير النظام' });
  });

  it('shows conditions and public types on the public page and validates the application', async () => {
    const info = (await http.get(`${PUB}/org/albir`).expect(200)).body;
    expect(info.types.map((t: { code: string }) => t.code)).toEqual(['working', 'affiliate']);
    expect(info.documents.map((d: { key: string }) => d.key)).toEqual(['id_front', 'photo']);
    // الإقرار بالشروط وصورة الهوية وشروط النوع
    await apply(person({ acceptedConditions: ['capacity'] })).expect(400);
    await apply(person(), false).expect(400);
    await apply(person({ nationality: 'مصري' })).expect(400);
    await apply(person({ birthDate: shift(today(), -365 * 10) })).expect(400);
    await apply(person({ typeCode: 'honorary' })).expect(400);
    const r = (await apply(person()).expect(201)).body;
    expect(r.applicationNo).toBe(`MA-${year}-0001`);
    ids.app1 = r.id;
    ids.app1No = r.applicationNo;
    ids.app1Code = r.trackCode;
    // لا يتكرر طلب مفتوح بنفس الهوية
    await apply(person()).expect(409);
    const track = (await http.get(`${PUB}/org/albir/applications/${r.applicationNo}?code=${r.trackCode}`).expect(200)).body;
    expect(track).toMatchObject({ status: 'in_review', stageName: 'مراجعة الشروط' });
    await http.get(`${PUB}/org/albir/applications/${r.applicationNo}?code=WRONG`).expect(404);
  });

  it('runs the application through its approval stages and issues the subscription invoice', async () => {
    const d = (await http.get(`${M}/applications/${ids.app1}`).set(as(admin)).expect(200)).body;
    expect(d.documents[0]).toMatchObject({ key: 'id_front', mime: 'image/png' });
    await http.get(`${M}/applications/${ids.app1}/documents/id_front`).set(as(clerk)).expect(200);
    await http.post(`${M}/applications/${ids.app1}/decision`).set(as(clerk)).send({ decision: 'approve' }).expect(403);
    await http.post(`${M}/applications/${ids.app1}/decision`).set(as(admin)).send({ decision: 'return' }).expect(400);
    await http.post(`${M}/applications/${ids.app1}/decision`).set(as(reviewer)).send({ decision: 'approve' }).expect(201);
    const awaiting = (await http.get(`${M}/applications?awaiting=1`).set(as(reviewer)).expect(200)).body;
    expect(awaiting.map((x: { id: string }) => x.id)).toEqual([ids.app1]);
    const done = (await http.post(`${M}/applications/${ids.app1}/decision`).set(as(reviewer)).send({ decision: 'approve', note: 'مستوفٍ للشروط' }).expect(201)).body;
    expect(done.status).toBe('awaiting_payment');
    expect(done.invoice).toMatchObject({ amount: 300, status: 'unpaid' });
    ids.inv1 = done.invoice.id;
    ids.pay1 = done.invoice.payToken;
  });

  it('pays online through the sandbox gateway and activates the membership with a receipt voucher', async () => {
    // الربط المالي غير مكتمل بعد: السداد يُعتمد ويُحفظ سبب تعذر السند
    const info = (await http.get(`${PUB}/pay/${ids.pay1}`).expect(200)).body;
    expect(info).toMatchObject({ amount: 300, status: 'unpaid', provider: 'sandbox', bank: { iban: 'SA0380000000608010167519' } });
    const start = (await http.post(`${PUB}/pay/${ids.pay1}/online`).expect(201)).body;
    const ref = new URL(start.url).searchParams.get('sandbox')!;
    expect(ref).toMatch(/^SBX-/);
    await http.post(`${PUB}/pay/${ids.pay1}/sandbox`).send({ ref: 'SBX-WRONG' }).expect(400);
    const paid = (await http.post(`${PUB}/pay/${ids.pay1}/sandbox`).send({ ref }).expect(201)).body;
    expect(paid.status).toBe('paid');
    let inv = (await http.get(`${M}/invoices/${ids.inv1}`).set(as(admin)).expect(200)).body;
    expect(inv.voucher).toBeNull();
    expect(inv.voucherError).toContain('أكمل الربط المالي');
    expect(inv.periodStart).toBe(today());
    // اكتمال الربط ثم إعادة المحاولة
    await http.put(`${M}/settings/accounting`).set(as(admin)).send({ data: { revenueAccountId: acc.revenue, onlineCashAccountId: ids.bank, transferCashAccountId: ids.bank, cashCashAccountId: ids.bank } }).expect(200);
    inv = (await http.post(`${M}/invoices/${ids.inv1}/voucher`).set(as(admin)).expect(201)).body;
    expect(inv.voucher).toMatchObject({ status: 'draft' });
    const v = (await http.get(`${A}/voucher/${inv.voucher.id}`).set(as(admin)).expect(200)).body;
    expect(v).toMatchObject({ kind: 'receipt', amount: 300, sourceType: 'membership', sourceRef: inv.invoiceNo, partyName: 'عبدالله محمد الشهري' });
    const track = (await http.get(`${PUB}/org/albir/applications/${ids.app1No}?code=${ids.app1Code}`).expect(200)).body;
    expect(track).toMatchObject({ status: 'completed', memberNo: 1 });
    const members = (await http.get(`${M}/members`).set(as(admin)).expect(200)).body;
    expect(members[0]).toMatchObject({ memberNo: 1, status: 'active', voting: true, typeName: 'عضو عامل', endDate: periodEnd(today(), 12) });
    ids.m1 = members[0].id;
    const p = (await http.get(`${M}/members/${ids.m1}`).set(as(admin)).expect(200)).body;
    expect(p.documents.map((d: { key: string }) => d.key)).toEqual(['id_front']);
    expect(p.statement[0]).toMatchObject({ status: 'paid', methodLabel: 'دفع إلكتروني', amount: 300 });
    expect(p.totals.paid).toBe(300);
    // بطاقة العضوية والتحقق العام منها
    const verify = (await http.get(`${PUB}/card/${p.cardCode}`).expect(200)).body;
    expect(verify).toMatchObject({ memberNo: 1, valid: true, orgName: 'جمعية البر' });
    expect(verify.nationalId).toBeUndefined();
  });

  it('returns an application to the applicant, who corrects it publicly and pays by bank transfer', async () => {
    const r = (await apply(person({ fullName: 'نورة سعد القحطاني', nationalId: '1098765432', gender: 'female', mobile: '0559876543', typeCode: 'affiliate', nationality: 'سعودي' })).expect(201)).body;
    await http.post(`${M}/applications/${r.id}/decision`).set(as(admin)).send({ decision: 'return', note: 'الصورة غير واضحة' }).expect(201);
    const track = (await http.get(`${PUB}/org/albir/applications/${r.applicationNo}?code=${r.trackCode}`).expect(200)).body;
    expect(track).toMatchObject({ status: 'returned', note: 'الصورة غير واضحة' });
    expect(track.data.documents[0].key).toBe('id_front');
    await http.post(`${PUB}/org/albir/applications/${r.applicationNo}/resubmit?code=${r.trackCode}`)
      .field('data', JSON.stringify(person({ fullName: 'نورة سعد القحطاني', nationalId: '1098765432', gender: 'female', mobile: '0559876543', typeCode: 'affiliate' })))
      .attach('id_front', PNG, 'id2.png').expect(201);
    await http.post(`${M}/applications/${r.id}/decision`).set(as(admin)).send({ decision: 'approve' }).expect(201);
    const d = (await http.post(`${M}/applications/${r.id}/decision`).set(as(admin)).send({ decision: 'approve' }).expect(201)).body;
    expect(d.invoice.amount).toBe(100);
    const tok = d.invoice.payToken;
    await http.post(`${PUB}/pay/${tok}/transfer`).field('reference', 'TRX-5531').expect(400);
    const sent = (await http.post(`${PUB}/pay/${tok}/transfer`).field('reference', 'TRX-5531').attach('receipt', PNG, 'r.png').expect(201)).body;
    expect(sent.status).toBe('review');
    await http.post(`${M}/invoices/${d.invoice.id}/pay`).set(as(clerk)).send({ method: 'transfer', paidOn: today() }).expect(403);
    await http.get(`${M}/invoices/${d.invoice.id}/receipt`).set(as(admin)).expect(200);
    const paid = (await http.post(`${M}/invoices/${d.invoice.id}/pay`).set(as(admin)).send({ method: 'transfer', paidOn: today() }).expect(201)).body;
    expect(paid).toMatchObject({ status: 'paid', paymentRef: 'TRX-5531', voucher: { status: 'draft' } });
    const m = (await http.get(`${M}/members?search=نورة`).set(as(admin)).expect(200)).body;
    expect(m[0]).toMatchObject({ memberNo: 2, typeName: 'عضو منتسب', voting: false });
  });

  it('activates honorary memberships without an invoice and adds existing members directly', async () => {
    const r = (await http.post(`${M}/applications`).set(as(clerk))
      .field('data', JSON.stringify(person({ fullName: 'د. خالد العتيبي', nationalId: '1055555555', mobile: '0505555555', typeCode: 'honorary', birthDate: null })))
      .attach('id_front', PNG, 'id.png').expect(201)).body;
    expect(r.source).toBe('staff');
    await http.post(`${M}/applications/${r.id}/decision`).set(as(admin)).send({ decision: 'approve' }).expect(201);
    const d = (await http.post(`${M}/applications/${r.id}/decision`).set(as(reviewer)).send({ decision: 'approve' }).expect(201)).body;
    expect(d).toMatchObject({ status: 'completed', invoice: null });
    // عضو قائم تنتهي عضويته بعد 5 أيام
    const direct = (await http.post(`${M}/members`).set(as(clerk)).send({
      ...person({ fullName: 'سلمان فهد الدوسري', nationalId: '1066666666', mobile: '0506666666', acceptedConditions: undefined }),
      joinedOn: '2020-03-01', startDate: shift(today(), -360), endDate: shift(today(), 5), memberNo: 50,
    }).expect(201)).body;
    expect(direct).toMatchObject({ memberNo: 50, status: 'expiring', source: 'direct', voting: true });
    ids.m50 = direct.id;
    await http.post(`${M}/members`).set(as(clerk)).send({ ...person({ nationalId: '1066666666', acceptedConditions: undefined }), joinedOn: '2020-03-01', startDate: '2026-01-01' }).expect(409);
    // صاحب عضوية سارية لا يقدم طلبًا جديدًا
    await http.post(`${M}/applications`).set(as(clerk)).field('data', JSON.stringify(person({ nationalId: '1066666666' }))).attach('id_front', PNG, 'id.png').expect(409);
  });

  it('issues renewal invoices before expiry, logs reminders, and renews continuously from the old end date', async () => {
    const r = (await http.get(`${M}/renewals`).set(as(admin)).expect(200)).body;
    const row = r.rows.find((x: { id: string }) => x.id === ids.m50);
    expect(row).toMatchObject({ daysLeft: 5, reminderDue: true, invoice: { amount: 300, status: 'unpaid' } });
    expect(row.message).toContain('سلمان فهد الدوسري');
    expect(row.message).toContain(`/m/pay/${row.invoice.payToken}`);
    await http.post(`${M}/members/${ids.m50}/notices`).set(as(clerk)).send({ channel: 'whatsapp', message: row.message }).expect(201);
    const again = (await http.get(`${M}/renewals`).set(as(admin)).expect(200)).body.rows.find((x: { id: string }) => x.id === ids.m50);
    expect(again).toMatchObject({ reminderDue: false, lastNotice: { channel: 'whatsapp' } });
    // «عضويتي» في الصفحة العامة تعيد المطالبة المفتوحة نفسها
    await http.post(`${PUB}/org/albir/membership`).send({ memberNo: 50, nationalId: '1012345678' }).expect(404);
    const mine = (await http.post(`${PUB}/org/albir/membership`).send({ memberNo: 50, nationalId: '1066666666' }).expect(201)).body;
    expect(mine).toMatchObject({ daysLeft: 5, canRenew: true, card: { memberNo: 50, valid: true } });
    const renew = (await http.post(`${PUB}/org/albir/membership/renew`).send({ memberNo: 50, nationalId: '1066666666' }).expect(201)).body;
    expect(renew.payToken).toBe(row.invoice.payToken);
    const paid = (await http.post(`${M}/invoices/${row.invoice.id}/pay`).set(as(admin)).send({ method: 'cash', paidOn: today(), reference: 'إيصال 77' }).expect(201)).body;
    const start = shift(today(), 6);
    expect(paid).toMatchObject({ status: 'paid', periodStart: start, periodEnd: periodEnd(start, 12), voucher: { status: 'draft' } });
    const p = (await http.get(`${M}/members/${ids.m50}`).set(as(admin)).expect(200)).body;
    expect(p).toMatchObject({ status: 'active', endDate: periodEnd(start, 12), joinedOn: '2020-03-01' });
    expect(p.notices.map((n: { channel: string }) => n.channel)).toEqual(['whatsapp', 'auto']);
  });

  it('suspends members, removes their voting right, and builds the assembly list and reports', async () => {
    await http.post(`${M}/members/${ids.m1}/status`).set(as(clerk)).send({ status: 'suspended' }).expect(400);
    const s = (await http.post(`${M}/members/${ids.m1}/status`).set(as(clerk)).send({ status: 'suspended', note: 'مخالفة اللائحة' }).expect(201)).body;
    expect(s).toMatchObject({ status: 'suspended', voting: false });
    await http.post(`${M}/members/${ids.m1}/renewal`).set(as(admin)).expect(409);
    const asm = (await http.get(`${M}/assembly`).set(as(admin)).expect(200)).body;
    expect(asm).toMatchObject({ eligible: 1, quorum: 1 });
    expect(asm.rows[0].memberNo).toBe(50);
    expect(asm.pending.map((x: { memberNo: number }) => x.memberNo)).toEqual([1]);
    await http.post(`${M}/members/${ids.m1}/status`).set(as(clerk)).send({ status: 'active' }).expect(201);
    const dash = (await http.get(`${M}/dashboard`).set(as(admin)).expect(200)).body;
    expect(dash.members).toMatchObject({ current: 4, voting: 2, female: 1 });
    expect(dash.collected).toBe(700);
    const rep = (await http.get(`${M}/reports`).set(as(admin)).expect(200)).body;
    expect(rep.revenue).toMatchObject({ total: 700, count: 3, withoutVoucher: 0 });
    expect(rep.revenue.byMethod.map((x: { label: string }) => x.label).sort()).toEqual(['تحويل بنكي', 'دفع إلكتروني', 'نقدًا'].sort());
    expect(rep.applications).toMatchObject({ total: 3 });
    await http.get(`${M}/reports`).set(as(clerk)).expect(403);
    // كل الأنواع المستخدمة لا تُحذف
    const st = (await http.get(`${M}/settings`).set(as(admin)).expect(200)).body;
    await http.put(`${M}/settings/types`).set(as(admin)).send({ data: { types: st.types.filter((t: { code: string }) => t.code !== 'affiliate') } }).expect(400);
    // سندات القبض الثلاثة في النظام المالي
    const vouchers = (await http.get(`${A}/vouchers/receipt`).set(as(admin)).expect(200)).body;
    expect(vouchers.items.filter((v: { purpose: string }) => v.purpose.includes('مطالبة MI-')).length).toBe(3);
  });
});
