import { createHash } from 'crypto';
import { BuyerSnapshot, DocKind, DocLine, IdType, NationalAddress, VatBreakdown } from '../entities/billing.entity';
import { certBody, certInfo, signHash } from './zatca-crypto';

/**
 * محرك ملف الفاتورة الإلكترونية (UBL 2.1 حسب مواصفات هيئة الزكاة والضريبة والجمارك):
 * يبني الملف، ويحسب بصمته، ويوقّعه بمفتاح الشركة وشهادتها، ويضع رمز QR بحقوله التسعة.
 *
 * الملف يُكتب بالشكل القياسي (Canonical XML 1.1) مباشرة وبلا مسافات بين العناصر، فتكون بصمته
 * هي SHA-256 للنص بعد حذف عناصر التوقيع ورمز QR فقط، كما تحسبها الهيئة، دون مكتبة XML خارجية.
 */

/** بصمة أول فاتورة في السلسلة: SHA-256 للرقم 0 كما تحدده الهيئة */
export const FIRST_PIH = Buffer.from(createHash('sha256').update('0').digest('hex')).toString('base64');

const NS = {
  inv: 'urn:oasis:names:specification:ubl:schema:xsd:Invoice-2',
  cac: 'urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2',
  cbc: 'urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2',
  ext: 'urn:oasis:names:specification:ubl:schema:xsd:CommonExtensionComponents-2',
};
const ROOT_OPEN = `<Invoice xmlns="${NS.inv}" xmlns:cac="${NS.cac}" xmlns:cbc="${NS.cbc}" xmlns:ext="${NS.ext}">`;
const ROOT_CLOSE = '</Invoice>';

/** ترميز النص حسب قواعد الشكل القياسي */
export const escText = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\r/g, '&#xD;');
const escAttr = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;').replace(/\t/g, '&#x9;').replace(/\n/g, '&#xA;').replace(/\r/g, '&#xD;');

/** عنصر بنص أو بعناصر فرعية. الخصائص تُرتّب أبجديًا كما يتطلب الشكل القياسي (كلها بلا بادئة) */
function el(tag: string, content: string | string[], attrs: Record<string, string> = {}) {
  const a = Object.keys(attrs).sort().map((k) => ` ${k}="${escAttr(attrs[k])}"`).join('');
  const body = Array.isArray(content) ? content.join('') : escText(content);
  return `<${tag}${a}>${body}</${tag}>`;
}
const opt = (cond: unknown, fn: () => string) => (cond ? fn() : '');
const amt = (n: number) => (Math.round(n * 100) / 100).toFixed(2);
const sar = (tag: string, n: number) => el(tag, amt(n), { currencyID: 'SAR' });
const qty = (n: number) => String(Math.round(n * 1000) / 1000);

export interface UblParty {
  name: string; vatNumber: string | null; idType: IdType | null; idNumber: string | null; address: NationalAddress | null;
}

export interface UblInput {
  kind: DocKind;
  docType: 'standard' | 'simplified';
  code: string;
  uuid: string;
  icv: number;
  pih: string;
  issueDate: string;
  /** وقت الإصدار HH:mm:ss بتوقيت الرياض */
  issueTime: string;
  supplyDate: string | null;
  seller: UblParty;
  buyer: BuyerSnapshot | null;
  refCode: string | null;
  reason: string | null;
  lines: DocLine[];
  breakdown: VatBreakdown[];
  taxable: number;
  vat: number;
  total: number;
}

const TYPE_CODE: Record<DocKind, string> = { invoice: '388', credit_note: '381', debit_note: '383' };

function address(a: NationalAddress | null) {
  if (!a) return '';
  return el('cac:PostalAddress', [
    opt(a.street, () => el('cbc:StreetName', a.street!)),
    opt(a.buildingNo, () => el('cbc:BuildingNumber', a.buildingNo!)),
    opt(a.additionalNo, () => el('cbc:PlotIdentification', a.additionalNo!)),
    opt(a.district, () => el('cbc:CitySubdivisionName', a.district!)),
    opt(a.city, () => el('cbc:CityName', a.city!)),
    opt(a.postalCode, () => el('cbc:PostalZone', a.postalCode!)),
    el('cac:Country', [el('cbc:IdentificationCode', a.country || 'SA')]),
  ]);
}

function party(p: UblParty, isSeller: boolean) {
  const idPart = p.idType && p.idNumber && (isSeller || !p.vatNumber) ? el('cac:PartyIdentification', [el('cbc:ID', p.idNumber, { schemeID: p.idType })]) : '';
  return el('cac:Party', [
    idPart,
    address(p.address),
    el('cac:PartyTaxScheme', [opt(p.vatNumber, () => el('cbc:CompanyID', p.vatNumber!)), el('cac:TaxScheme', [el('cbc:ID', 'VAT')])]),
    el('cac:PartyLegalEntity', [el('cbc:RegistrationName', p.name)]),
  ]);
}

function taxCategory(tag: 'cac:TaxCategory' | 'cac:ClassifiedTaxCategory', b: { category: string; rate: number; reasonCode: string | null; reasonText: string | null }, withReason: boolean) {
  const scheme = tag === 'cac:TaxCategory' ? { schemeAgencyID: '6', schemeID: 'UN/ECE 5305' } : undefined;
  return el(tag, [
    el('cbc:ID', b.category, scheme),
    el('cbc:Percent', amt(b.rate)),
    opt(withReason && b.category !== 'S' && b.reasonCode, () => el('cbc:TaxExemptionReasonCode', b.reasonCode!) + el('cbc:TaxExemptionReason', b.reasonText ?? b.reasonCode!)),
    el('cac:TaxScheme', [el('cbc:ID', 'VAT', tag === 'cac:TaxCategory' ? { schemeAgencyID: '6', schemeID: 'UN/ECE 5153' } : undefined)]),
  ]);
}

function line(l: DocLine, n: number) {
  const gross = Math.round(l.qty * l.unitPrice * 100) / 100;
  const discounted = Math.round(l.discount * 100) > 0;
  // مع الخصم يُكتب السعر الصافي للكمية كاملة (كمية الأساس = الكمية)، فيطابق صافي السطر دون كسور
  const price = el('cac:Price', [
    sar('cbc:PriceAmount', discounted ? l.net : l.unitPrice),
    opt(discounted, () => el('cbc:BaseQuantity', qty(l.qty), { unitCode: 'PCE' })),
    opt(discounted, () => el('cac:AllowanceCharge', [el('cbc:ChargeIndicator', 'false'), el('cbc:AllowanceChargeReason', 'discount'), sar('cbc:Amount', l.discount), sar('cbc:BaseAmount', gross)])),
  ]);
  return el('cac:InvoiceLine', [
    el('cbc:ID', String(n)),
    el('cbc:InvoicedQuantity', qty(l.qty), { unitCode: 'PCE' }),
    sar('cbc:LineExtensionAmount', l.net),
    el('cac:TaxTotal', [sar('cbc:TaxAmount', l.vat), sar('cbc:RoundingAmount', l.total)]),
    el('cac:Item', [el('cbc:Name', l.description), taxCategory('cac:ClassifiedTaxCategory', l, false)]),
    price,
  ]);
}

const QR_MARK = '\u0000QR\u0000';
const EXT_MARK = '\u0000EXT\u0000';

/** بناء الملف: النص الخاضع للبصمة، ودالة تجميع الملف الموقّع */
export function buildInvoice(i: UblInput) {
  const buyer: UblParty | null = i.buyer ? { name: i.buyer.name, vatNumber: i.buyer.vatNumber, idType: i.buyer.idType, idNumber: i.buyer.idNumber, address: i.buyer.address } : null;
  const parts: string[] = [
    EXT_MARK,
    el('cbc:ProfileID', 'reporting:1.0'),
    el('cbc:ID', i.code),
    el('cbc:UUID', i.uuid),
    el('cbc:IssueDate', i.issueDate),
    el('cbc:IssueTime', i.issueTime),
    el('cbc:InvoiceTypeCode', TYPE_CODE[i.kind], { name: i.docType === 'standard' ? '0100000' : '0200000' }),
    el('cbc:DocumentCurrencyCode', 'SAR'),
    el('cbc:TaxCurrencyCode', 'SAR'),
    opt(i.kind !== 'invoice' && i.refCode, () => el('cac:BillingReference', [el('cac:InvoiceDocumentReference', [el('cbc:ID', i.refCode!)])])),
    el('cac:AdditionalDocumentReference', [el('cbc:ID', 'ICV'), el('cbc:UUID', String(i.icv))]),
    el('cac:AdditionalDocumentReference', [el('cbc:ID', 'PIH'), el('cac:Attachment', [el('cbc:EmbeddedDocumentBinaryObject', i.pih, { mimeCode: 'text/plain' })])]),
    QR_MARK,
    el('cac:AccountingSupplierParty', [party(i.seller, true)]),
    el('cac:AccountingCustomerParty', buyer ? [party(buyer, false)] : []),
    el('cac:Delivery', [el('cbc:ActualDeliveryDate', i.supplyDate ?? i.issueDate)]),
    el('cac:PaymentMeans', [el('cbc:PaymentMeansCode', i.docType === 'simplified' ? '10' : '30'), opt(i.kind !== 'invoice' && i.reason, () => el('cbc:InstructionNote', i.reason!))]),
    el('cac:TaxTotal', [sar('cbc:TaxAmount', i.vat)]),
    el('cac:TaxTotal', [
      sar('cbc:TaxAmount', i.vat),
      ...i.breakdown.map((b) => el('cac:TaxSubtotal', [sar('cbc:TaxableAmount', b.taxable), sar('cbc:TaxAmount', b.vat), taxCategory('cac:TaxCategory', b, true)])),
    ]),
    el('cac:LegalMonetaryTotal', [
      sar('cbc:LineExtensionAmount', i.taxable), sar('cbc:TaxExclusiveAmount', i.taxable), sar('cbc:TaxInclusiveAmount', i.total),
      sar('cbc:AllowanceTotalAmount', 0), sar('cbc:PrepaidAmount', 0), sar('cbc:PayableAmount', i.total),
    ]),
    ...i.lines.map((l, n) => line(l, n + 1)),
  ];
  const body = parts.join('');
  const pure = ROOT_OPEN + body.replace(EXT_MARK, '').replace(QR_MARK, '') + ROOT_CLOSE;
  const signatureRef = el('cac:Signature', [el('cbc:ID', 'urn:oasis:names:specification:ubl:signature:Invoice'), el('cbc:SignatureMethod', 'urn:oasis:names:specification:ubl:dsig:enveloped:xades')]);
  return {
    pure,
    hash: createHash('sha256').update(pure, 'utf8').digest('base64'),
    assemble: (ext: string, qr: string) => `<?xml version="1.0" encoding="UTF-8"?>\n${ROOT_OPEN}${body
      .replace(EXT_MARK, ext)
      .replace(QR_MARK, el('cac:AdditionalDocumentReference', [el('cbc:ID', 'QR'), el('cac:Attachment', [el('cbc:EmbeddedDocumentBinaryObject', qr, { mimeCode: 'text/plain' })])]) + signatureRef)}${ROOT_CLOSE}`,
  };
}

/** رمز QR بحقوله: نصوص أو بايتات، كل حقل بطول لا يتجاوز 255 بايتًا */
export function qrTlvFields(values: (string | Buffer)[]) {
  return Buffer.concat(values.map((v, i) => {
    const b = typeof v === 'string' ? Buffer.from(v, 'utf8') : v;
    if (b.length > 255) throw new Error(`QR field ${i + 1} too long`);
    return Buffer.concat([Buffer.from([i + 1, b.length]), b]);
  })).toString('base64');
}

const sp = (n: number) => ' '.repeat(n);
const DS = 'http://www.w3.org/2000/09/xmldsig#';
const SHA256 = 'http://www.w3.org/2001/04/xmlenc#sha256';

/**
 * الخصائص الموقّعة (XAdES): تُحسب بصمتها على الصيغة التي تعتمدها الهيئة، وتُضمّن في الملف بالمسافات نفسها
 * (المسافات داخل هذا العنصر جزء من بصمته عند الهيئة).
 */
function signedProperties(p: { time: string; certHash: string; issuer: string; serial: string }, forHash: boolean) {
  const dsNs = forHash ? ` xmlns:ds="${DS}"` : '';
  const digestMethod = forHash ? `<ds:DigestMethod${dsNs} Algorithm="${SHA256}"/>` : `<ds:DigestMethod Algorithm="${SHA256}"></ds:DigestMethod>`;
  return [
    `<xades:SignedProperties xmlns:xades="http://uri.etsi.org/01903/v1.3.2#" Id="xadesSignedProperties">`,
    `${sp(36)}<xades:SignedSignatureProperties>`,
    `${sp(40)}<xades:SigningTime>${p.time}</xades:SigningTime>`,
    `${sp(40)}<xades:SigningCertificate>`,
    `${sp(44)}<xades:Cert>`,
    `${sp(48)}<xades:CertDigest>`,
    `${sp(52)}${digestMethod}`,
    `${sp(52)}<ds:DigestValue${dsNs}>${p.certHash}</ds:DigestValue>`,
    `${sp(48)}</xades:CertDigest>`,
    `${sp(48)}<xades:IssuerSerial>`,
    `${sp(52)}<ds:X509IssuerName${dsNs}>${escText(p.issuer)}</ds:X509IssuerName>`,
    `${sp(52)}<ds:X509SerialNumber${dsNs}>${p.serial}</ds:X509SerialNumber>`,
    `${sp(48)}</xades:IssuerSerial>`,
    `${sp(44)}</xades:Cert>`,
    `${sp(40)}</xades:SigningCertificate>`,
    `${sp(36)}</xades:SignedSignatureProperties>`,
    `${sp(32)}</xades:SignedProperties>`,
  ].join('\n');
}

function transform(xpath: string) {
  return `<ds:Transform Algorithm="http://www.w3.org/TR/1999/REC-xpath-19991116"><ds:XPath>${escText(xpath)}</ds:XPath></ds:Transform>`;
}

export interface SignedInvoice { xml: string; hash: string; signature: string; qr: string }

/**
 * توقيع الفاتورة: البصمة، ثم توقيع ECDSA عليها، ثم رمز QR بالحقول التسعة (التاسع للمبسطة وإشعاراتها فقط)،
 * ثم كتلة التوقيع (XAdES) في أول الملف.
 */
export function signInvoice(i: UblInput, cred: { privateKey: string; cert: string }, signingTime = new Date()): SignedInvoice {
  const b = buildInvoice(i);
  const signature = signHash(cred.privateKey, b.hash);
  const ci = certInfo(cred.cert);
  const qrValues: (string | Buffer)[] = [
    i.seller.name, i.seller.vatNumber ?? '', `${i.issueDate}T${i.issueTime}`, amt(i.total), amt(i.vat), b.hash, signature, ci.publicKey,
  ];
  if (i.docType === 'simplified') qrValues.push(ci.signature);
  const qr = qrTlvFields(qrValues);
  const props = { time: `${signingTime.toISOString().slice(0, 19)}Z`, certHash: ci.hash, issuer: ci.issuer, serial: ci.serial };
  const propsHash = Buffer.from(createHash('sha256').update(signedProperties(props, true), 'utf8').digest('hex')).toString('base64');
  const ext = [
    '<ext:UBLExtensions><ext:UBLExtension><ext:ExtensionURI>urn:oasis:names:specification:ubl:dsig:enveloped:xades</ext:ExtensionURI><ext:ExtensionContent>',
    '<sig:UBLDocumentSignatures xmlns:sac="urn:oasis:names:specification:ubl:schema:xsd:SignatureAggregateComponents-2" xmlns:sbc="urn:oasis:names:specification:ubl:schema:xsd:SignatureBasicComponents-2" xmlns:sig="urn:oasis:names:specification:ubl:schema:xsd:CommonSignatureComponents-2">',
    '<sac:SignatureInformation><cbc:ID>urn:oasis:names:specification:ubl:signature:1</cbc:ID><sbc:ReferencedSignatureID>urn:oasis:names:specification:ubl:signature:Invoice</sbc:ReferencedSignatureID>',
    `<ds:Signature xmlns:ds="${DS}" Id="signature"><ds:SignedInfo>`,
    '<ds:CanonicalizationMethod Algorithm="http://www.w3.org/2006/12/xml-c14n11"></ds:CanonicalizationMethod>',
    '<ds:SignatureMethod Algorithm="http://www.w3.org/2001/04/xmldsig-more#ecdsa-sha256"></ds:SignatureMethod>',
    '<ds:Reference Id="invoiceSignedData" URI=""><ds:Transforms>',
    transform('not(//ancestor-or-self::ext:UBLExtensions)'),
    transform('not(//ancestor-or-self::cac:Signature)'),
    transform("not(//ancestor-or-self::cac:AdditionalDocumentReference[cbc:ID='QR'])"),
    '<ds:Transform Algorithm="http://www.w3.org/2006/12/xml-c14n11"></ds:Transform></ds:Transforms>',
    `<ds:DigestMethod Algorithm="${SHA256}"></ds:DigestMethod><ds:DigestValue>${b.hash}</ds:DigestValue></ds:Reference>`,
    `<ds:Reference Type="http://www.w3.org/2000/09/xmldsig#SignatureProperties" URI="#xadesSignedProperties"><ds:DigestMethod Algorithm="${SHA256}"></ds:DigestMethod><ds:DigestValue>${propsHash}</ds:DigestValue></ds:Reference>`,
    `</ds:SignedInfo><ds:SignatureValue>${signature}</ds:SignatureValue>`,
    `<ds:KeyInfo><ds:X509Data><ds:X509Certificate>${certBody(cred.cert)}</ds:X509Certificate></ds:X509Data></ds:KeyInfo>`,
    `<ds:Object><xades:QualifyingProperties xmlns:xades="http://uri.etsi.org/01903/v1.3.2#" Target="signature">${signedProperties(props, false)}</xades:QualifyingProperties></ds:Object>`,
    '</ds:Signature></sac:SignatureInformation></sig:UBLDocumentSignatures></ext:ExtensionContent></ext:UBLExtension></ext:UBLExtensions>',
  ].join('');
  return { xml: b.assemble(ext, qr), hash: b.hash, signature, qr };
}

/** بصمة ملف موقّع: حذف كتلة التوقيع ومرجع التوقيع ورمز QR ثم SHA-256 (للتحقق من الملفات المحفوظة) */
export function hashOfSigned(xml: string) {
  const pure = xml
    .replace(/^<\?xml[^>]*\?>\n?/, '')
    .replace(/<ext:UBLExtensions>[\s\S]*?<\/ext:UBLExtensions>/, '')
    .replace(/<cac:Signature>[\s\S]*?<\/cac:Signature>/, '')
    .replace(/<cac:AdditionalDocumentReference><cbc:ID>QR<\/cbc:ID>[\s\S]*?<\/cac:AdditionalDocumentReference>/, '');
  return createHash('sha256').update(pure, 'utf8').digest('base64');
}
