import { X509Certificate, createCipheriv, createDecipheriv, createHash, createHmac, createPrivateKey, createPublicKey, generateKeyPairSync, randomBytes, sign as ecSign } from 'crypto';
import { bits, children, ctx, name, oid, printable, read, seq, set, int, octets, utf8 } from './asn1';

/**
 * التشفير الخاص بالفوترة الإلكترونية (المرحلة الثانية):
 * مفتاح ECDSA على منحنى secp256k1 لكل جمعية، وطلب شهادة (CSR) بحقول الهيئة، وتوقيع بصمة الفاتورة،
 * وقراءة شهادة الهيئة (المفتاح العام وتوقيع الشهادة والمصدر والرقم التسلسلي).
 */

export type ZatcaEnv = 'sandbox' | 'simulation' | 'production';

/** اسم قالب الشهادة حسب البيئة (حقل 1.3.6.1.4.1.311.20.2 في الطلب) */
export const TEMPLATE_NAME: Record<ZatcaEnv, string> = {
  sandbox: 'TSTZATCA-Code-Signing',
  simulation: 'PREZATCA-Code-Signing',
  production: 'ZATCA-Code-Signing',
};

const OID = {
  C: '2.5.4.6', OU: '2.5.4.11', O: '2.5.4.10', CN: '2.5.4.3',
  SN: '2.5.4.4', UID: '0.9.2342.19200300.100.1.1', title: '2.5.4.12', registeredAddress: '2.5.4.26', businessCategory: '2.5.4.15',
  extensionRequest: '1.2.840.113549.1.9.14', subjectAltName: '2.5.29.17', templateName: '1.3.6.1.4.1.311.20.2', ecdsaSha256: '1.2.840.10045.4.3.2',
};

export function generateKeys() {
  const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'secp256k1' });
  return privateKey.export({ type: 'sec1', format: 'pem' }).toString();
}

export interface CsrInput {
  env: ZatcaEnv;
  commonName: string;
  orgUnit: string;
  orgName: string;
  /** 1-اسم الحل|2-الإصدار|3-رقم تسلسلي فريد */
  serial: string;
  vatNumber: string;
  /** أنواع الفواتير: الخانة 1 الضريبية والخانة 2 المبسطة (1100 = النوعان) */
  invoiceTypes: string;
  location: string;
  industry: string;
}

/** طلب شهادة بصيغة PEM موقّع بمفتاح الجمعية */
export function buildCsr(privatePem: string, i: CsrInput) {
  const key = createPrivateKey(privatePem);
  const spki = createPublicKey(key).export({ type: 'spki', format: 'der' });
  const subject = name([[OID.C, printable('SA')], [OID.OU, utf8(i.orgUnit)], [OID.O, utf8(i.orgName)], [OID.CN, utf8(i.commonName)]]);
  const dir = name([[OID.SN, utf8(i.serial)], [OID.UID, utf8(i.vatNumber)], [OID.title, utf8(i.invoiceTypes)], [OID.registeredAddress, utf8(i.location)], [OID.businessCategory, utf8(i.industry)]]);
  const extensions = seq(
    seq(oid(OID.templateName), octets(utf8(TEMPLATE_NAME[i.env]))),
    seq(oid(OID.subjectAltName), octets(seq(ctx(4, dir)))),
  );
  const attributes = ctx(0, seq(oid(OID.extensionRequest), set(extensions)));
  const info = seq(int(0), subject, spki, attributes);
  const signature = ecSign('sha256', info, key);
  const der = seq(info, seq(oid(OID.ecdsaSha256)), bits(signature));
  return `-----BEGIN CERTIFICATE REQUEST-----\n${der.toString('base64').replace(/(.{64})/g, '$1\n').trim()}\n-----END CERTIFICATE REQUEST-----\n`;
}

/** توقيع بصمة الفاتورة (ECDSA مع SHA-256 على بايتات البصمة) بترميز Base64 */
export function signHash(privatePem: string, invoiceHashB64: string) {
  return ecSign('sha256', Buffer.from(invoiceHashB64, 'base64'), createPrivateKey(privatePem)).toString('base64');
}

/** نص الشهادة بترميز Base64 بلا ترويسة (كما يوضع في ملف XML) */
export const certBody = (pemOrBody: string) => pemOrBody.replace(/-----(BEGIN|END) CERTIFICATE-----/g, '').replace(/\s+/g, '');
export const certPem = (body: string) => `-----BEGIN CERTIFICATE-----\n${certBody(body).replace(/(.{64})/g, '$1\n').trim()}\n-----END CERTIFICATE-----\n`;

/** بيانات الشهادة اللازمة للتوقيع ورمز QR */
export function certInfo(body: string) {
  const b = certBody(body);
  const x = new X509Certificate(certPem(b));
  const der = Buffer.from(b, 'base64');
  const parts = children(read(der));
  const sigBits = parts[2];
  if (!sigBits || sigBits.tag !== 0x03) throw new Error('certificate signature not found');
  return {
    /** بصمة الشهادة كما تطلبها الهيئة: SHA-256 لنص Base64 بالترميز الست عشري ثم Base64 */
    hash: Buffer.from(createHash('sha256').update(b).digest('hex')).toString('base64'),
    issuer: x.issuer.split('\n').reverse().join(', '),
    serial: BigInt(`0x${x.serialNumber}`).toString(10),
    publicKey: x.publicKey.export({ type: 'spki', format: 'der' }),
    signature: sigBits.value.subarray(1),
    validTo: new Date(x.validTo),
    validFrom: new Date(x.validFrom),
    subject: x.subject,
  };
}

// ---------------- حفظ الأسرار مشفرة ----------------

/**
 * المفتاح الخاص للجمعية وكلمة سر الشهادة يُحفظان مشفرين (AES-256-GCM).
 * مفتاح التشفير من ZATCA_KEY_SECRET إن وُجد في البيئة، وإلا يُشتق من JWT_SECRET (فلا يلزم متغير جديد).
 * تغيير JWT_SECRET بعد الربط يتطلب إعادة الربط، لذا يُفضّل ضبط ZATCA_KEY_SECRET على السيرفر.
 */
function vaultKey() {
  const own = process.env.ZATCA_KEY_SECRET;
  if (own) return createHash('sha256').update(own).digest();
  const base = process.env.JWT_SECRET;
  if (!base) throw new Error('JWT_SECRET must be set');
  return createHmac('sha256', base).update('sanabel:zatca:vault').digest();
}

/** التشفير مربوط بالجمعية (بيانات إضافية موثّقة)، فلا يصلح سر جمعية إن نُقل إلى صف جمعية أخرى */
export function seal(plain: string, org: string) {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', vaultKey(), iv, { authTagLength: 16 });
  c.setAAD(Buffer.from(`sanabel:zatca:${org}`));
  const ct = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return `v1:${iv.toString('base64')}:${c.getAuthTag().toString('base64')}:${ct.toString('base64')}`;
}

export function unseal(sealed: string, org: string) {
  const [v, iv, tag, ct] = sealed.split(':');
  if (v !== 'v1' || !iv || !tag || !ct) throw new Error('unknown vault format');
  const tagBuf = Buffer.from(tag, 'base64');
  if (tagBuf.length !== 16) throw new Error('invalid vault tag');
  const d = createDecipheriv('aes-256-gcm', vaultKey(), Buffer.from(iv, 'base64'), { authTagLength: 16 });
  d.setAAD(Buffer.from(`sanabel:zatca:${org}`));
  d.setAuthTag(tagBuf);
  return Buffer.concat([d.update(Buffer.from(ct, 'base64')), d.final()]).toString('utf8');
}

/** هل الشهادة صادرة على المفتاح العام لمفتاح الجمعية؟ */
export function certMatchesKey(body: string, privatePem: string) {
  return certInfo(body).publicKey.equals(createPublicKey(createPrivateKey(privatePem)).export({ type: 'spki', format: 'der' }));
}
