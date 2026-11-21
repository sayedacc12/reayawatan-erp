import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { DataSource, EntityManager } from 'typeorm';
import { OrgUser } from '../../core/auth/decorators';
import { BILLING_PERMISSIONS as P } from './billing.manifest';
import { BillingCore, blToday, computeDoc, diffNote, docCode, logEntry } from './billing-core.service';
import {
  BlDocument, BlSettings, BlZatca, DOC_KINDS, DOC_TYPES, DocKind, LogEntry, ZATCA_ENVS, ZATCA_STAGES, ZatcaCheck, ZatcaEnv,
} from './entities/billing.entity';
import { CheckResponse, ZatcaApi, ZatcaApiError } from './einvoice/zatca-api';
import { buildCsr, certBody, certInfo, certMatchesKey, generateKeys, seal, unseal } from './einvoice/zatca-crypto';
import { FIRST_PIH, UblInput, signInvoice } from './einvoice/ubl';

const can = (a: OrgUser, code: string) => a.isSuperadmin || a.permissions.includes(code);
/** وقت الإصدار بتوقيت الرياض HH:mm:ss */
export const riyadhTime = (d: Date) => new Date(d.getTime() + 3 * 3600_000).toISOString().slice(11, 19);
const SOLUTION = 'Sanabel';
const VERSION = '2.0';
const WARN_DAYS = 30;

/** المستندات التجريبية التي تطلبها الهيئة لفحص الامتثال (للنوعين: الضريبية والمبسطة) */
const SAMPLES: { kind: DocKind; docType: 'standard' | 'simplified' }[] = [
  { kind: 'invoice', docType: 'standard' }, { kind: 'credit_note', docType: 'standard' }, { kind: 'debit_note', docType: 'standard' },
  { kind: 'invoice', docType: 'simplified' }, { kind: 'credit_note', docType: 'simplified' }, { kind: 'debit_note', docType: 'simplified' },
];
const SAMPLE_BUYER = {
  name: 'عميل تجريبي لفحص الامتثال', kind: 'business' as const, vatNumber: '300000000000003', idType: null, idNumber: null, phone: null, email: null,
  address: { street: 'طريق الملك فهد', buildingNo: '1234', additionalNo: '5678', district: 'العليا', city: 'الرياض', postalCode: '12211', country: 'SA' },
};

/**
 * الربط مع منصة «فاتورة» (المرحلة الثانية):
 * 1) رمز OTP من بوابة «فاتورة» ← مفتاح الشركة وطلب الشهادة ← شهادة الامتثال.
 * 2) فحوص الامتثال: ستة مستندات تجريبية موقّعة تُرسل للمنصة.
 * 3) شهادة الإنتاج. بعدها يُوقّع كل مستند ضريبي عند إصداره، ويُبنى ملفه وسلسلة بصماته ورمز QR بحقوله التسعة.
 * الإرسال الفعلي للمستندات (التخليص والإبلاغ) في المرحلة الثالثة.
 */
@Injectable()
export class ZatcaService {
  private readonly running = new Set<string>();

  constructor(private readonly db: DataSource, private readonly core: BillingCore, private readonly api: ZatcaApi) {}

  private assertSettings(a: OrgUser) {
    if (!can(a, P.settings)) throw new ForbiddenException('لا تملك صلاحية إعدادات الفوترة');
  }

  async row(org: string, em: EntityManager = this.db.manager) {
    const repo = em.getRepository(BlZatca);
    let z = await repo.findOne({ where: { organizationId: org } });
    if (!z) {
      await repo.createQueryBuilder().insert().values({ organizationId: org }).orIgnore().execute();
      z = await repo.findOneOrFail({ where: { organizationId: org } });
    }
    return z;
  }

  /** حالة الربط للعرض (بلا مفتاح ولا أسرار) */
  async status(a: OrgUser) {
    const org = a.organizationId;
    const [z, s] = await Promise.all([this.row(org), this.core.settings(org)]);
    const cert = z.productionCert ?? z.complianceCert;
    let certificate: { kind: string; issuer: string; serial: string; validTo: string; daysLeft: number; expiringSoon: boolean } | null = null;
    if (cert) {
      try {
        const ci = certInfo(cert);
        const daysLeft = Math.floor((ci.validTo.getTime() - Date.now()) / 86400_000);
        certificate = { kind: z.productionCert ? 'production' : 'compliance', issuer: ci.issuer, serial: ci.serial, validTo: ci.validTo.toISOString(), daysLeft, expiringSoon: daysLeft <= WARN_DAYS };
      } catch {
        certificate = null;
      }
    }
    const [{ signed }] = await this.db.query(`SELECT COUNT(*)::int AS signed FROM bl_documents WHERE organization_id = $1 AND invoice_hash IS NOT NULL`, [org]);
    return {
      env: z.env, envLabel: ZATCA_ENVS[z.env], envs: ZATCA_ENVS, stage: z.stage, stageLabel: ZATCA_STAGES[z.stage], stages: ZATCA_STAGES,
      egsSerial: z.egsSerial, commonName: z.commonName, certificate, checks: z.checks, lastError: z.lastError, signed,
      chainStarted: !!z.lastHash, problems: this.problems(s), log: [...z.log].reverse().slice(0, 50),
      sending: false,
    };
  }

  /** ما ينقص الشركة قبل الربط */
  private problems(s: BlSettings) {
    const out = [...this.core.readiness(s).missing];
    if (s.mode !== 'registered' && s.mode !== 'integrated') out.unshift('اختيار وضع «مسجلة في الضريبة» في إعدادات الفوترة');
    return [...new Set(out)];
  }

  /** حفظ خطوة: الشرط على المرحلة في جملة التحديث نفسها، فلا تتجاوز خطوةٌ إلغاءً أو خطوةً متزامنة */
  private async save(org: string, patch: Partial<BlZatca>, entry: LogEntry, expectStage?: BlZatca['stage']) {
    const z = await this.row(org);
    const where = expectStage ? { organizationId: org, stage: expectStage } : { organizationId: org, stage: z.stage };
    const r = await this.db.getRepository(BlZatca).update(where, { ...patch, log: [...z.log, entry].slice(-200), updatedAt: new Date() });
    if (!r.affected) throw new ConflictException('تغيرت حالة الربط من شاشة أخرى. حدّث الصفحة');
  }

  /** اختيار البيئة قبل بدء الربط */
  async setEnv(a: OrgUser, env: ZatcaEnv) {
    this.assertSettings(a);
    const z = await this.row(a.organizationId);
    if (z.stage !== 'none') throw new ConflictException('ابدأ الربط من جديد قبل تغيير البيئة');
    if (z.env !== env) await this.save(a.organizationId, { env }, logEntry('تغيير بيئة الربط', a.fullName, diffNote({ env: ZATCA_ENVS[z.env] }, { env: ZATCA_ENVS[env] }, { env: 'البيئة' })), 'none');
    return this.status(a);
  }

  /** إلغاء الربط الحالي والبدء من جديد (مثل تجديد الشهادة أو تغيير البيئة). سلسلة البصمات تستمر */
  async reset(a: OrgUser, reason: string) {
    this.assertSettings(a);
    if (this.running.has(a.organizationId)) throw new ConflictException('خطوات الربط جارية الآن. انتظر حتى تنتهي');
    const z = await this.row(a.organizationId);
    if (z.stage === 'none' && !z.privateKeyEnc) throw new ConflictException('لا يوجد ربط لإلغائه');
    await this.save(a.organizationId, {
      stage: 'none', privateKeyEnc: null, csr: null, complianceCert: null, complianceSecretEnc: null, complianceRequestId: null,
      productionCert: null, productionSecretEnc: null, certExpiresAt: null, checks: [], lastError: null,
    }, logEntry('إلغاء الربط والبدء من جديد', a.fullName, `${reason} (كانت المرحلة: ${ZATCA_STAGES[z.stage]})`));
    return this.status(a);
  }

  /** تنفيذ خطوات الربط بالترتيب حتى تنجح كلها أو تتوقف عند خطوة مع سببها. otp مطلوب للخطوة الأولى فقط */
  async onboard(a: OrgUser, otp?: string) {
    this.assertSettings(a);
    const org = a.organizationId;
    if (this.running.has(org)) throw new ConflictException('خطوات الربط جارية الآن. انتظر حتى تنتهي');
    this.running.add(org);
    try {
      const s = await this.core.settings(org);
      const problems = this.problems(s);
      if (problems.length) throw new BadRequestException(`أكمل قبل الربط: ${problems.join('، ')}`);
      let z = await this.row(org);
      if (z.stage === 'production') throw new ConflictException('الشركة مربوطة بالفعل. لتجديد الشهادة ابدأ الربط من جديد');
      try {
        if (z.stage === 'none') {
          if (!otp || !/^\d{6}$/.test(otp)) throw new BadRequestException('اكتب رمز التحقق (OTP) المكوّن من 6 أرقام من بوابة «فاتورة»');
          await this.compliance(a, s, z, otp);
          z = await this.row(org);
        }
        if (z.stage === 'compliance') {
          await this.runChecks(a, s, z);
          z = await this.row(org);
        }
        if (z.stage === 'checked') await this.production(a, z);
      } catch (e) {
        const msg = e instanceof ZatcaApiError ? `ردت منصة «فاتورة»: ${e.detail}` : (e as Error).message;
        await this.db.getRepository(BlZatca).update({ organizationId: org }, { lastError: msg.slice(0, 2000) });
        if (e instanceof ZatcaApiError) throw new BadRequestException(msg);
        throw e;
      }
      return this.status(a);
    } finally {
      this.running.delete(org);
    }
  }

  private async compliance(a: OrgUser, s: BlSettings, z: BlZatca, otp: string) {
    const key = generateKeys();
    const serial = `1-${SOLUTION}|2-${VERSION}|3-${randomUUID()}`;
    const commonName = `${SOLUTION}-${s.vatNumber}-${z.env}`.slice(0, 64);
    const csr = buildCsr(key, {
      env: z.env, commonName, orgUnit: (s.sellerName ?? '').slice(0, 64) || 'Main', orgName: s.sellerName!.slice(0, 64), serial, vatNumber: s.vatNumber!,
      invoiceTypes: '1100', location: [s.address?.city, s.address?.district].filter(Boolean).join(' - ').slice(0, 64) || 'SA', industry: 'شركة غير ربحية',
    });
    const r = await this.api.complianceCsid(z.env, csr, otp);
    if (!r?.binarySecurityToken || !r.secret || !r.requestID) throw new ZatcaApiError(0, r?.dispositionMessage || 'لم تصدر شهادة الامتثال');
    const cert = certBody(Buffer.from(r.binarySecurityToken, 'base64').toString('utf8'));
    if (!certMatchesKey(cert, key)) throw new ZatcaApiError(0, 'الشهادة المستلمة لا تطابق مفتاح الشركة');
    await this.save(z.organizationId, {
      stage: 'compliance', egsSerial: serial, commonName, privateKeyEnc: seal(key, z.organizationId), csr, complianceCert: cert, complianceSecretEnc: seal(r.secret, z.organizationId),
      complianceRequestId: String(r.requestID), lastError: null, checks: [],
    }, logEntry('صدرت شهادة الامتثال', a.fullName, `البيئة: ${ZATCA_ENVS[z.env]}`), 'none');
  }

  /** بيانات مستند تجريبي لفحص الامتثال من بيانات الشركة الحقيقية */
  private sample(s: BlSettings, i: number, pih: string, x: (typeof SAMPLES)[number]): UblInput {
    const rate = Number(s.vatRate);
    const c = computeDoc([{ itemId: null, description: 'خدمة تجريبية لفحص الامتثال', unit: null, qty: 1, unitPrice: 100, discount: 0, category: 'S', reasonCode: null, revenueAccountId: '', refLineId: null }], rate, true);
    const now = new Date();
    return {
      kind: x.kind, docType: x.docType, code: `${docCode(x.kind, i)}-T`, uuid: randomUUID(), icv: i, pih,
      issueDate: blToday(), issueTime: riyadhTime(now), supplyDate: null,
      seller: { name: s.sellerName!, vatNumber: s.vatNumber, idType: s.idType, idNumber: s.idNumber, address: s.address },
      buyer: x.docType === 'standard' ? SAMPLE_BUYER : null,
      refCode: x.kind === 'invoice' ? null : `${docCode('invoice', 1)}-T`, reason: x.kind === 'invoice' ? null : 'تعديل السعر أو الكمية',
      lines: c.lines, breakdown: c.breakdown, taxable: c.taxable, vat: c.vat, total: c.total,
    };
  }

  private async runChecks(a: OrgUser, s: BlSettings, z: BlZatca) {
    const key = unseal(z.privateKeyEnc!, z.organizationId);
    const secret = unseal(z.complianceSecretEnc!, z.organizationId);
    const token = Buffer.from(z.complianceCert!).toString('base64');
    const checks: ZatcaCheck[] = [];
    let pih = FIRST_PIH;
    for (const [n, x] of SAMPLES.entries()) {
      const input = this.sample(s, n + 1, pih, x);
      const signed = signInvoice(input, { privateKey: key, cert: z.complianceCert! });
      pih = signed.hash;
      const r: CheckResponse = await this.api.complianceCheck(z.env, token, secret, { invoiceHash: signed.hash, uuid: input.uuid, invoice: Buffer.from(signed.xml).toString('base64') });
      const v = r?.validationResults ?? {};
      const accepted = x.docType === 'standard' ? r?.clearanceStatus === 'CLEARED' : r?.reportingStatus === 'REPORTED';
      const ok = (v.status === 'PASS' || v.status === 'WARNING') && accepted;
      const messages = [...(v.errorMessages ?? []), ...(v.warningMessages ?? [])].map((m) => [m.code, m.message].filter(Boolean).join(': ')).filter(Boolean).slice(0, 20);
      checks.push({ label: `${DOC_TYPES[x.docType]}: ${DOC_KINDS[x.kind]}`, kind: x.kind, docType: x.docType, status: v.status ?? r?.clearanceStatus ?? r?.reportingStatus ?? '—', ok, messages });
    }
    const passed = checks.every((c) => c.ok);
    await this.save(z.organizationId, { checks, stage: passed ? 'checked' : 'compliance', lastError: passed ? null : 'لم تنجح كل فحوص الامتثال. راجع الأسباب لكل مستند' },
      logEntry(passed ? 'نجحت فحوص الامتثال' : 'لم تنجح فحوص الامتثال', a.fullName, `${checks.filter((c) => c.ok).length} من ${checks.length}`), 'compliance');
    if (!passed) throw new BadRequestException('لم تنجح كل فحوص الامتثال. راجع الأسباب لكل مستند ثم أعد المحاولة');
  }

  private async production(a: OrgUser, z: BlZatca) {
    const token = Buffer.from(z.complianceCert!).toString('base64');
    const r = await this.api.productionCsid(z.env, token, unseal(z.complianceSecretEnc!, z.organizationId), z.complianceRequestId!);
    if (!r?.binarySecurityToken || !r.secret) throw new ZatcaApiError(0, r?.dispositionMessage || 'لم تصدر شهادة الإنتاج');
    const cert = certBody(Buffer.from(r.binarySecurityToken, 'base64').toString('utf8'));
    const ci = certInfo(cert);
    if (!certMatchesKey(cert, unseal(z.privateKeyEnc!, z.organizationId))) throw new ZatcaApiError(0, 'شهادة الإنتاج لا تطابق مفتاح الشركة');
    await this.save(z.organizationId, { stage: 'production', productionCert: cert, productionSecretEnc: seal(r.secret, z.organizationId), certExpiresAt: ci.validTo, lastError: null },
      logEntry('صدرت شهادة الإنتاج', a.fullName, `البيئة: ${ZATCA_ENVS[z.env]}، تنتهي ${ci.validTo.toISOString().slice(0, 10)}`), 'checked');
  }

  /**
   * توقيع المستند عند إصداره داخل معاملة الإصدار نفسها: يُقفل صف الربط فتبقى سلسلة البصمات موافقة لترتيب العداد.
   * لا يُوقّع إلا بعد صدور شهادة الإنتاج، ولا يُوقّع المستند غير الضريبي.
   */
  async signOnIssue(em: EntityManager, s: BlSettings, d: BlDocument, refCode: string | null) {
    if (d.docType === 'nontax' || !d.uuid || !d.icv || !d.issuedAt) return false;
    const z = await em.getRepository(BlZatca).createQueryBuilder('z').setLock('pessimistic_write').where('z.organization_id = :org', { org: d.organizationId }).getOne();
    if (!z || z.stage !== 'production' || !z.productionCert || !z.privateKeyEnc) return false;
    if (z.certExpiresAt && z.certExpiresAt.getTime() < Date.now()) throw new ConflictException('انتهت شهادة الربط مع منصة «فاتورة». جدّدها من شاشة الربط قبل إصدار الفواتير الضريبية');
    const pih = z.lastHash ?? FIRST_PIH;
    const signed = signInvoice({
      kind: d.kind, docType: d.docType, code: docCode(d.kind, d.docNo), uuid: d.uuid, icv: d.icv, pih,
      issueDate: d.issueDate, issueTime: riyadhTime(d.issuedAt), supplyDate: d.supplyDate,
      seller: { name: s.sellerName!, vatNumber: s.vatNumber, idType: s.idType, idNumber: s.idNumber, address: s.address },
      buyer: d.buyer, refCode, reason: d.reason, lines: d.lines, breakdown: d.breakdown, taxable: d.taxable, vat: d.vat, total: d.total,
    }, { privateKey: unseal(z.privateKeyEnc, z.organizationId), cert: z.productionCert });
    d.pih = pih;
    d.invoiceHash = signed.hash;
    d.xml = signed.xml;
    d.qr = signed.qr;
    d.signedEnv = z.env;
    d.zatcaStatus = 'not_sent';
    await em.getRepository(BlZatca).update({ organizationId: d.organizationId }, { lastHash: signed.hash });
    return true;
  }

  /** ملف المستند الموقّع للتنزيل */
  async xml(org: string, id: string) {
    const [d] = await this.db.query('SELECT kind, doc_no AS "docNo", xml FROM bl_documents WHERE organization_id = $1 AND id = $2', [org, id]);
    if (!d) throw new NotFoundException('المستند غير موجود');
    if (!d.xml) throw new NotFoundException('لا يوجد ملف إلكتروني موقّع لهذا المستند');
    return { name: `${docCode(d.kind, d.docNo)}.xml`, xml: d.xml as string };
  }
}
