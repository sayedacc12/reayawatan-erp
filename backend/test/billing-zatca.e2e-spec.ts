import { Test } from '@nestjs/testing';
import { NestExpressApplication } from '@nestjs/platform-express';
import { X509Certificate, generateKeyPairSync, sign as ecSign, verify } from 'crypto';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/main';
import { bits, children, ctx, int, name, oid, read, seq, utcTime, utf8 } from '../src/modules/billing/einvoice/asn1';
import { CheckResponse, CsidResponse, ZatcaApi, ZatcaApiError } from '../src/modules/billing/einvoice/zatca-api';
import { FIRST_PIH, hashOfSigned } from '../src/modules/billing/einvoice/ubl';
import { exportOrganization } from '../src/core/lifecycle/org-data';

const DB = process.env.TEST_DATABASE_URL ?? 'postgres://erp:erp@localhost:5432/charity_erp_test';
jest.setTimeout(120_000);

const ADDRESS = { street: 'طريق الملك فهد', buildingNo: '1234', additionalNo: '5678', district: 'العليا', city: 'الرياض', postalCode: '12211', country: 'SA' };
const OTP = '123345';

/** قراءة رمز QR بحقوله كبايتات */
function tlvFields(b64: string) {
  const buf = Buffer.from(b64, 'base64');
  const out: Record<number, Buffer> = {};
  for (let i = 0; i + 2 <= buf.length; i += 2 + buf[i + 1]) out[buf[i]] = buf.subarray(i + 2, i + 2 + buf[i + 1]);
  return out;
}

/**
 * منصة «فاتورة» وهمية للاختبار (الاختبارات لا تتصل بالإنترنت): تصدر شهادات من جهة إصدار تجريبية
 * على المفتاح العام في طلب الشركة، وتتحقق في فحوص الامتثال من البصمة والتوقيع ورمز QR فعليًا.
 */
class FakeZatca {
  readonly ca = generateKeyPairSync('ec', { namedCurve: 'secp256k1' }).privateKey;
  readonly calls: string[] = [];
  private serial = 1000;
  private issued = new Map<string, string>();

  private issue(csrPem: string) {
    const der = Buffer.from(csrPem.replace(/-----[^-]+-----/g, '').replace(/\s+/g, ''), 'base64');
    const [info] = children(read(der));
    const [, subject, spki] = children(info);
    const alg = seq(oid('1.2.840.10045.4.3.2'));
    const issuer = name([['0.9.2342.19200300.100.1.25', utf8('local')], ['0.9.2342.19200300.100.1.25', utf8('gov')], ['2.5.4.3', utf8('TSZEINVOICE-SubCA-1')]]);
    const now = Date.now();
    const tbs = seq(ctx(0, int(2)), int(this.serial++), alg, issuer, seq(utcTime(new Date(now - 86400_000)), utcTime(new Date(now + 365 * 86400_000))), subject.raw, spki.raw);
    const cert = seq(tbs, alg, bits(ecSign('sha256', tbs, this.ca))).toString('base64');
    const token = Buffer.from(cert).toString('base64');
    const secret = `secret-${this.serial}`;
    this.issued.set(token, secret);
    return { token, secret };
  }

  async complianceCsid(env: string, csrPem: string, otp: string): Promise<CsidResponse> {
    this.calls.push(`compliance:${env}`);
    if (otp !== OTP) throw new ZatcaApiError(400, 'Invalid-OTP: رمز التحقق غير صحيح');
    if (!csrPem.includes('BEGIN CERTIFICATE REQUEST')) throw new ZatcaApiError(400, 'Invalid-CSR');
    const { token, secret } = this.issue(csrPem);
    return { requestID: '1234567890123', binarySecurityToken: token, secret, dispositionMessage: 'ISSUED' };
  }

  async complianceCheck(_env: string, token: string, secret: string, doc: { invoiceHash: string; uuid: string; invoice: string }): Promise<CheckResponse> {
    this.calls.push('check');
    if (this.issued.get(token) !== secret) throw new ZatcaApiError(401, 'Unauthorized');
    const xml = Buffer.from(doc.invoice, 'base64').toString('utf8');
    const errors: { code: string; message: string }[] = [];
    if (hashOfSigned(xml) !== doc.invoiceHash) errors.push({ code: 'invoiceHash', message: 'hash mismatch' });
    if (!xml.includes(`<cbc:UUID>${doc.uuid}</cbc:UUID>`)) errors.push({ code: 'uuid', message: 'uuid mismatch' });
    const cert = /<ds:X509Certificate>([^<]+)</.exec(xml)?.[1] ?? '';
    const sig = /<ds:SignatureValue>([^<]+)</.exec(xml)?.[1] ?? '';
    const pub = new X509Certificate(Buffer.from(cert, 'base64')).publicKey;
    if (!verify('sha256', Buffer.from(doc.invoiceHash, 'base64'), pub, Buffer.from(sig, 'base64'))) errors.push({ code: 'signature', message: 'bad signature' });
    const standard = xml.includes('name="0100000"');
    const status = errors.length ? 'ERROR' : 'PASS';
    return { validationResults: { status, errorMessages: errors, warningMessages: [] }, ...(standard ? { clearanceStatus: errors.length ? 'NOT_CLEARED' : 'CLEARED' } : { reportingStatus: errors.length ? 'NOT_REPORTED' : 'REPORTED' }) };
  }

  async productionCsid(_env: string, token: string, secret: string, requestId: string): Promise<CsidResponse> {
    this.calls.push('production');
    if (this.issued.get(token) !== secret || requestId !== '1234567890123') throw new ZatcaApiError(401, 'Unauthorized');
    const der = new X509Certificate(Buffer.from(Buffer.from(token, 'base64').toString(), 'base64'));
    const { token: prod, secret: prodSecret } = this.issue(`-----BEGIN CERTIFICATE REQUEST-----\n${this.csrFromCert(der)}\n-----END CERTIFICATE REQUEST-----`);
    return { requestID: '30368', binarySecurityToken: prod, secret: prodSecret };
  }

  /** شهادة الإنتاج على المفتاح العام نفسه: نبني طلبًا مختصرًا من الشهادة (الموضوع والمفتاح) */
  private csrFromCert(x: X509Certificate) {
    const tbs = children(read(x.raw))[0];
    const parts = children(tbs);
    return seq(seq(int(0), parts[5].raw, parts[6].raw)).toString('base64');
  }
}

/** الفوترة المرحلة الثانية: الربط مع «فاتورة» وتوقيع المستندات وسلسلة البصمات */
describe('Billing stage 2: ZATCA onboarding, signed XML and the hash chain', () => {
  let app: NestExpressApplication;
  let http: ReturnType<typeof request>;
  let db: DataSource;
  const fake = new FakeZatca();
  const tok: Record<string, string> = {};
  const ids: Record<string, string> = {};
  const acc: Record<string, string> = {};
  const as = (t: string) => ({ Authorization: `Bearer ${t}` });
  const login = async (login: string, password: string, organization?: string) =>
    (await http.post('/api/auth/login').send({ login, password, organization }).expect(200)).body.accessToken as string;
  const B = '/api/billing';
  const A = '/api/accounting';
  const issueNew = async (body: Record<string, unknown>) => {
    const d = (await http.post(`${B}/documents`).set(as(tok.clerk)).send(body).expect(200)).body;
    await http.post(`${B}/documents/${d.id}/submit`).set(as(tok.clerk)).expect(200);
    return (await http.post(`${B}/documents/${d.id}/issue`).set(as(tok.issuer)).send({}).expect(200)).body;
  };

  beforeAll(async () => {
    Object.assign(process.env, {
      DATABASE_URL: DB, JWT_SECRET: 'test-secret', UPLOAD_DIR: mkdtempSync(join(tmpdir(), 'sanabel-uploads-')), PLATFORM_ADMIN_EMAIL: 'platform@test.org', PLATFORM_ADMIN_PASSWORD: 'Platform123',
    });
    const reset = new DataSource({ type: 'postgres', url: DB });
    await reset.initialize();
    await reset.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
    await reset.destroy();
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(ZatcaApi).useValue(fake).compile();
    app = configureApp(moduleRef.createNestApplication<NestExpressApplication>());
    await app.init();
    http = request(app.getHttpServer());
    db = app.get(DataSource);
    const platform = await login('admin', 'Platform123');
    for (const [slug, name] of [['sales', 'جمعية المبيعات'], ['other', 'جمعية أخرى']]) {
      await http.post('/api/platform/organizations').set(as(platform)).send({ name, slug, adminFullName: 'مدير النظام', adminEmail: `admin@${slug}.org`, adminPassword: 'Admin12345' }).expect(201);
      tok[slug] = await login(`admin@${slug}.org`, 'Admin12345', slug);
    }
    tok.admin = tok.sales;
    const Y = Number(new Date().toISOString().slice(0, 4));
    await http.post(`${A}/chart/install`).set(as(tok.admin)).expect(201);
    const chart = (await http.get(`${A}/accounts`).set(as(tok.admin)).expect(200)).body.accounts as { id: string; name: string; kind: string; nature: string }[];
    const find = (nature: string, has: string) => chart.find((a) => a.kind === 'sub' && a.nature === nature && a.name.includes(has))!.id;
    acc.ar = find('assets', 'مدينون تجاريون');
    acc.vat = find('liabilities', 'مخرجات');
    acc.revenue = find('revenue', 'مبيعات السلع والخدمات');
    await http.post(`${A}/setup`).set(as(tok.admin)).send({
      fiscalYear: Y, startDate: `${Y}-01-01`, endDate: `${Y}-12-31`, isFirstYear: true, firstYearStart: `${Y}-01-01`, firstYearEnd: `${Y}-12-31`,
    }).expect(201);
    const role = async (rname: string, permissions: string[]) => (await http.post('/api/roles').set(as(tok.admin)).send({ name: rname, permissions }).expect(201)).body.id;
    const user = async (key: string, fullName: string, roleId: string) => {
      await http.post('/api/users').set(as(tok.admin)).send({ fullName, email: `${key}@sales.org`, password: 'Staff12345', roleIds: [roleId] }).expect(201);
      tok[key] = await login(`${key}@sales.org`, 'Staff12345', 'sales');
    };
    await user('clerk', 'موظف الفوترة', await role('فوترة', ['billing.dashboard.read', 'billing.invoices.manage', 'billing.customers.manage', 'billing.items.manage']));
    await user('issuer', 'مدير المبيعات', await role('إصدار', ['billing.dashboard.read', 'billing.invoices.issue']));

    await http.put(`${B}/settings`).set(as(tok.admin)).send({
      mode: 'registered', sellerName: 'جمعية المبيعات', vatNumber: '310123456700003', idType: 'CRN', idNumber: '1010123456', address: ADDRESS, vatRate: 15,
      receivablesAccountId: acc.ar, vatOutputAccountId: acc.vat, revenueAccountId: acc.revenue, paymentDays: 30,
    }).expect(200);
    ids.business = (await http.post(`${B}/customers`).set(as(tok.clerk)).send({ kind: 'business', name: 'شركة النخبة', vatNumber: '300075588700003', address: ADDRESS }).expect(200)).body.id;
    ids.item = (await http.post(`${B}/items`).set(as(tok.clerk)).send({ name: 'دورة تدريبية', kind: 'service', price: 100, vatCategory: 'S' }).expect(200)).body.id;
  });

  afterAll(async () => {
    await app?.close();
  });

  it('keeps onboarding to billing settings managers and starts unlinked', async () => {
    await http.get(`${B}/zatca`).set(as(tok.clerk)).expect(403);
    await http.post(`${B}/zatca/onboard`).set(as(tok.issuer)).send({ otp: OTP }).expect(403);
    const st = (await http.get(`${B}/zatca`).set(as(tok.admin)).expect(200)).body;
    expect(st).toMatchObject({ stage: 'none', env: 'simulation', certificate: null, problems: [] });
    const other = (await http.get(`${B}/zatca`).set(as(tok.other)).expect(200)).body;
    expect(other.problems.length).toBeGreaterThan(0);
    await http.post(`${B}/zatca/onboard`).set(as(tok.other)).send({ otp: OTP }).expect(400);

    // قبل الربط: رمز QR المرحلة الأولى (5 حقول) ولا ملف موقّع
    const d = await issueNew({ kind: 'invoice', customerId: ids.business, lines: [{ itemId: ids.item, qty: 1, unitPrice: 100 }] });
    expect(d.hasXml).toBe(false);
    expect(d.xml).toBeUndefined();
    expect(Object.keys(tlvFields(d.qr))).toHaveLength(5);
    await http.get(`${B}/documents/${d.id}/xml`).set(as(tok.clerk)).expect(404);
  });

  it('rejects a wrong OTP with the platform reason and keeps the stage', async () => {
    await http.post(`${B}/zatca/onboard`).set(as(tok.admin)).send({}).expect(400);
    await http.post(`${B}/zatca/onboard`).set(as(tok.admin)).send({ otp: '12' }).expect(400);
    const bad = await http.post(`${B}/zatca/onboard`).set(as(tok.admin)).send({ otp: '999999' }).expect(400);
    expect(bad.body.message).toContain('Invalid-OTP');
    const st = (await http.get(`${B}/zatca`).set(as(tok.admin)).expect(200)).body;
    expect(st.stage).toBe('none');
    expect(st.lastError).toContain('Invalid-OTP');
  });

  it('links the organization: compliance certificate, six compliance checks, then the production certificate', async () => {
    await http.put(`${B}/zatca/env`).set(as(tok.admin)).send({ env: 'mars' }).expect(400);
    await http.put(`${B}/zatca/env`).set(as(tok.admin)).send({ env: 'sandbox' }).expect(200);
    const st = (await http.post(`${B}/zatca/onboard`).set(as(tok.admin)).send({ otp: OTP }).expect(200)).body;
    expect(st).toMatchObject({ stage: 'production', env: 'sandbox', lastError: null });
    expect(st.checks).toHaveLength(6);
    expect(st.checks.every((c: { ok: boolean }) => c.ok)).toBe(true);
    expect(st.certificate).toMatchObject({ kind: 'production', expiringSoon: false });
    expect(fake.calls.filter((c) => c === 'check')).toHaveLength(6);
    // الأسرار لا تُعاد ولا تُحفظ نصًا صريحًا
    const raw = JSON.stringify(st);
    expect(raw).not.toMatch(/PRIVATE KEY|secret-|private_key|Secret/);
    const [z] = await db.query('SELECT private_key_enc, production_secret_enc, compliance_secret_enc FROM bl_zatca z JOIN organizations o ON o.id = z.organization_id WHERE o.slug = $1', ['sales']);
    for (const v of Object.values(z) as string[]) {
      expect(v.startsWith('v1:')).toBe(true);
      expect(v).not.toMatch(/PRIVATE|secret-/);
    }
    await http.put(`${B}/zatca/env`).set(as(tok.admin)).send({ env: 'production' }).expect(409);
    await http.post(`${B}/zatca/onboard`).set(as(tok.admin)).send({ otp: OTP }).expect(409);
  });

  it('signs each issued tax document, chains its hash and puts the nine QR fields', async () => {
    const inv = await issueNew({ kind: 'invoice', customerId: ids.business, lines: [{ itemId: ids.item, qty: 3, unitPrice: 100, discount: 10 }] });
    expect(inv).toMatchObject({ hasXml: true, signedEnv: 'sandbox', zatcaStatus: 'not_sent', pih: FIRST_PIH });
    expect(inv.invoiceHash).toMatch(/^[A-Za-z0-9+/]{43}=$/);
    const q = tlvFields(inv.qr);
    expect(Object.keys(q)).toHaveLength(8);
    expect(q[6].toString()).toBe(inv.invoiceHash);
    expect(q[4].toString()).toBe('333.50');

    const res = await http.get(`${B}/documents/${inv.id}/xml`).set(as(tok.clerk)).expect(200);
    expect(res.headers['content-type']).toContain('application/xml');
    expect(res.headers['content-disposition']).toContain('attachment');
    const xml = res.text;
    expect(hashOfSigned(xml)).toBe(inv.invoiceHash);
    expect(xml).toContain('<cbc:InvoiceTypeCode name="0100000">388</cbc:InvoiceTypeCode>');
    expect(xml).toContain(`<cbc:UUID>${inv.icv}</cbc:UUID>`);
    expect(xml).toContain('<cbc:CompanyID>300075588700003</cbc:CompanyID>');
    const cert = /<ds:X509Certificate>([^<]+)</.exec(xml)![1];
    const sig = /<ds:SignatureValue>([^<]+)</.exec(xml)![1];
    expect(verify('sha256', Buffer.from(inv.invoiceHash, 'base64'), new X509Certificate(Buffer.from(cert, 'base64')).publicKey, Buffer.from(sig, 'base64'))).toBe(true);
    await http.get(`${B}/documents/${inv.id}/xml`).set(as(tok.other)).expect(404);

    // المبسطة تكمل السلسلة، وفي رمزها الحقل التاسع (توقيع الشهادة)
    const simple = await issueNew({ kind: 'invoice', buyerName: 'زائر', lines: [{ description: 'رسوم فعالية', qty: 1, unitPrice: 50 }] });
    expect(simple.docType).toBe('simplified');
    expect(simple.pih).toBe(inv.invoiceHash);
    expect(Object.keys(tlvFields(simple.qr))).toHaveLength(9);

    // الإشعار الدائن يشير للفاتورة الأصلية ويحمل السبب
    const line = (await http.get(`${B}/documents/${inv.id}`).set(as(tok.clerk)).expect(200)).body.creditable[0];
    const cn = await issueNew({ kind: 'credit_note', refId: inv.id, reason: 'خصم بعد الإصدار', lines: [{ refLineId: line.lineId, qty: 1, unitPrice: 50 }] });
    expect(cn.pih).toBe(simple.invoiceHash);
    const cnXml = (await http.get(`${B}/documents/${cn.id}/xml`).set(as(tok.issuer)).expect(200)).text;
    expect(cnXml).toContain(`<cac:BillingReference><cac:InvoiceDocumentReference><cbc:ID>${inv.code}</cbc:ID>`);
    expect(cnXml).toContain('<cbc:InstructionNote>خصم بعد الإصدار</cbc:InstructionNote>');
    expect(cnXml).toContain('>381</cbc:InvoiceTypeCode>');
  });

  it('starts over on request, keeping the chain, and logs who did it', async () => {
    await http.post(`${B}/zatca/reset`).set(as(tok.clerk)).send({ reason: 'تجديد الشهادة' }).expect(403);
    const st = (await http.post(`${B}/zatca/reset`).set(as(tok.admin)).send({ reason: 'تجديد الشهادة' }).expect(200)).body;
    expect(st).toMatchObject({ stage: 'none', certificate: null, chainStarted: true, signed: 3 });
    expect(st.log[0]).toMatchObject({ action: 'إلغاء الربط والبدء من جديد', byName: 'مدير النظام' });
    const unsigned = await issueNew({ kind: 'invoice', customerId: ids.business, lines: [{ itemId: ids.item, qty: 1, unitPrice: 100 }] });
    expect(unsigned.hasXml).toBe(false);
    const again = (await http.post(`${B}/zatca/onboard`).set(as(tok.admin)).send({ otp: OTP }).expect(200)).body;
    expect(again.stage).toBe('production');
    const [{ last }] = await db.query(`SELECT invoice_hash AS last FROM bl_documents WHERE invoice_hash IS NOT NULL ORDER BY icv DESC LIMIT 1`);
    const next = await issueNew({ kind: 'invoice', customerId: ids.business, lines: [{ itemId: ids.item, qty: 1, unitPrice: 100 }] });
    expect(next.pih).toBe(last);

    // ملف تصدير بيانات الشركة: بلا مفتاح ولا أسرار، ومعه بصمات الفواتير
    const [{ id: orgId }] = await db.query(`SELECT id FROM organizations WHERE slug = 'sales'`);
    const out = await exportOrganization(db.manager, orgId);
    const z = out.bl_zatca[0] as Record<string, unknown>;
    expect(Object.keys(z)).not.toEqual(expect.arrayContaining(['private_key_enc']));
    expect(Object.keys(z).filter((k) => /_enc$/.test(k))).toEqual([]);
    expect(z.last_hash).toBe(next.invoiceHash);
    expect((out.bl_documents as Record<string, unknown>[]).some((d) => d.invoice_hash === next.invoiceHash)).toBe(true);
  });
});
