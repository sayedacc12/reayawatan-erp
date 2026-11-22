import { BadRequestException, Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { DataSource, EntityManager } from 'typeorm';
import { toLatinDigits } from '../../core/contact-validation';
import {
  BILLING_MODES, BlSettings, BuyerSnapshot, CUSTOMER_KINDS, DOC_KINDS, DOC_STATUS, DOC_TYPES, DocKind, DocLine, ID_TYPES, ITEM_KINDS, LogEntry, NOTE_REASONS,
  NationalAddress, PaymentBank, SELLER_ID_TYPES, VAT_CATEGORIES, VAT_REASONS, VatBreakdown, VatCategory,
} from './entities/billing.entity';

/** تاريخ اليوم بتوقيت الرياض */
export const blToday = () => new Date(Date.now() + 3 * 3600_000).toISOString().slice(0, 10);
export const addDays = (d: string, n: number) => new Date(new Date(`${d}T00:00:00Z`).getTime() + n * 86400_000).toISOString().slice(0, 10);
export const logEntry = (action: string, byName: string, note: string | null = null): LogEntry => ({ action, note, byName, at: new Date().toISOString() });
/** وصف التغييرات بالقيم قبل وبعد لسجل التدقيق: «الحقل: القديم ← الجديد» */
export function diffNote(before: Record<string, unknown>, after: Record<string, unknown>, labels: Record<string, string>) {
  const show = (v: unknown) => (v === null || v === undefined || v === '' ? '—' : typeof v === 'object' ? JSON.stringify(v) : String(v));
  const out = Object.keys(labels).filter((k) => show(before[k]) !== show(after[k])).map((k) => `${labels[k]}: ${show(before[k])} ← ${show(after[k])}`);
  return out.length ? out.join('، ').slice(0, 1900) : null;
}

const pad = (n: number, w: number) => String(n).padStart(w, '0');
export const DOC_PREFIX: Record<DocKind, string> = { invoice: 'INV', credit_note: 'CRN', debit_note: 'DBN' };
export const docCode = (kind: DocKind, n: number) => `${DOC_PREFIX[kind]}-${pad(n, 6)}`;
export const customerCode = (n: number) => `CUS-${pad(n, 4)}`;

/** المبالغ بالهللات لتجنب أخطاء الكسور */
export const toH = (n: number | string | null | undefined) => Math.round(Number(n ?? 0) * 100);
export const fromH = (h: number) => h / 100;
export const r2 = (n: number) => fromH(toH(n));

/**
 * الوضع الضريبي الفعلي في تاريخ معيّن: الشركة المسجلة قبل تاريخ نفاذ تسجيلها تعامل كغير مسجلة،
 * فتصدر فواتير عادية بلا ضريبة ولا رقم ضريبي ولا رمز QR. لا تُحصّل ضريبة قبل نفاذ التسجيل.
 */
export function modeOn(s: Pick<BlSettings, 'mode' | 'vatEffectiveFrom'>, date: string): BlSettings['mode'] {
  if ((s.mode === 'registered' || s.mode === 'integrated') && s.vatEffectiveFrom && date < s.vatEffectiveFrom) return 'unregistered';
  return s.mode;
}

/** تاريخ استحقاق الضريبة (نقطة الضريبة) للتحقق من نفاذ التسجيل: الأسبق من تاريخ الإصدار وتاريخ التوريد */
export const taxPoint = (issueDate: string, supplyDate: string | null | undefined) => (supplyDate && supplyDate < issueDate ? supplyDate : issueDate);

/** الرقم الضريبي السعودي: 15 رقمًا يبدأ وينتهي بـ 3 */
export const vatProblem = (v: string) => (/^3\d{13}3$/.test(v) ? null : 'الرقم الضريبي 15 رقمًا يبدأ بـ 3 وينتهي بـ 3');
export const cleanDigits = (v: string | null | undefined) => (v ? toLatinDigits(v).replace(/\s+/g, '') : null) || null;

/** نقص العنوان الوطني المطلوب في الفاتورة الضريبية (الشارع، ورقم المبنى، والحي، والمدينة، والرمز البريدي 5 أرقام) */
export function addressProblems(a: NationalAddress | null | undefined, who: string): string[] {
  const out: string[] = [];
  if (!a) return [`العنوان الوطني لـ${who}`];
  if (!a.street) out.push(`اسم الشارع في عنوان ${who}`);
  if (!a.buildingNo || !/^\d{4}$/.test(a.buildingNo)) out.push(`رقم المبنى (4 أرقام) في عنوان ${who}`);
  if (!a.district) out.push(`الحي في عنوان ${who}`);
  if (!a.city) out.push(`المدينة في عنوان ${who}`);
  if (!a.postalCode || !/^\d{5}$/.test(a.postalCode)) out.push(`الرمز البريدي (5 أرقام) في عنوان ${who}`);
  return out;
}

/** سطر إدخال قبل الحساب */
export interface LineInput {
  itemId: string | null; description: string; unit: string | null; qty: number; unitPrice: number; discount: number;
  category: VatCategory; reasonCode: string | null; revenueAccountId: string; refLineId: string | null; id?: string;
  /** نسبة الضريبة الثابتة (للإشعار الدائن: نسبة السطر الأصلي ولو تغيرت النسبة بعده) */
  rate?: number;
}

/**
 * حساب المستند بالهللات:
 * صافي السطر = الكمية × السعر − الخصم، وضريبة السطر = الصافي × النسبة (للعرض)،
 * وضريبة المستند تُحسب لكل فئة ونسبة من مجموع صافيها ثم تُجمع (قاعدة الهيئة)، والإجمالي = الصافي + الضريبة.
 */
export function computeDoc(inputs: LineInput[], baseRate: number, taxable: boolean) {
  const lines: DocLine[] = inputs.map((l) => {
    const category: VatCategory = taxable ? l.category : 'O';
    const rate = category === 'S' ? l.rate ?? baseRate : 0;
    const grossH = Math.round(Number(l.qty) * Number(l.unitPrice) * 100);
    const discH = toH(l.discount);
    if (discH > grossH) throw new BadRequestException(`خصم «${l.description}» أكبر من قيمة السطر`);
    const netH = grossH - discH;
    const vatH = Math.round((netH * rate) / 100);
    const reason = category === 'S' ? null : l.reasonCode && VAT_REASONS[l.reasonCode]?.category === category ? l.reasonCode : null;
    if (taxable && category !== 'S' && !reason) throw new BadRequestException(`«${l.description}»: اختر سبب ${VAT_CATEGORIES[category]} من قائمة الهيئة`);
    return {
      id: l.id ?? randomUUID(), itemId: l.itemId, description: l.description, unit: l.unit, qty: Number(l.qty), unitPrice: r2(l.unitPrice), discount: fromH(discH),
      net: fromH(netH), category, rate, reasonCode: taxable ? reason : null, reasonText: taxable && reason ? VAT_REASONS[reason].label : null,
      vat: fromH(vatH), total: fromH(netH + vatH), revenueAccountId: l.revenueAccountId, refLineId: l.refLineId,
    };
  });
  const groups = new Map<string, VatBreakdown & { taxH: number }>();
  for (const l of lines) {
    const k = `${l.category}|${l.rate}|${l.reasonCode ?? ''}`;
    const g = groups.get(k) ?? { category: l.category, rate: l.rate, reasonCode: l.reasonCode, reasonText: l.reasonText, taxable: 0, vat: 0, taxH: 0 };
    g.taxH += toH(l.net);
    groups.set(k, g);
  }
  const breakdown: VatBreakdown[] = [...groups.values()].map((g) => ({
    category: g.category, rate: g.rate, reasonCode: g.reasonCode, reasonText: g.reasonText, taxable: fromH(g.taxH), vat: fromH(Math.round((g.taxH * g.rate) / 100)),
  }));
  const grossH = lines.reduce((t, l) => t + Math.round(l.qty * l.unitPrice * 100), 0);
  const discountH = lines.reduce((t, l) => t + toH(l.discount), 0);
  const taxableH = lines.reduce((t, l) => t + toH(l.net), 0);
  const vatH = breakdown.reduce((t, b) => t + toH(b.vat), 0);
  return { lines, breakdown, gross: fromH(grossH), discount: fromH(discountH), taxable: fromH(taxableH), vat: fromH(vatH), total: fromH(taxableH + vatH) };
}

/**
 * رمز QR للفاتورة الإلكترونية (المرحلة الأولى): خمسة حقول بترميز TLV ثم Base64:
 * 1 اسم البائع، 2 الرقم الضريبي، 3 وقت الإصدار، 4 الإجمالي شامل الضريبة، 5 مبلغ الضريبة.
 */
export function qrTlv(fields: { seller: string; vatNumber: string; timestamp: string; total: number; vat: number }) {
  const parts = [fields.seller, fields.vatNumber, fields.timestamp, fields.total.toFixed(2), fields.vat.toFixed(2)].map((v, i) => {
    const value = Buffer.from(v, 'utf8');
    if (value.length > 255) throw new BadRequestException('اسم البائع طويل جدًا لرمز QR');
    return Buffer.concat([Buffer.from([i + 1, value.length]), value]);
  });
  return Buffer.concat(parts).toString('base64');
}

/** قراءة رمز QR (للتحقق في الاختبارات وشاشة العرض) */
export function readTlv(b64: string) {
  const buf = Buffer.from(b64, 'base64');
  const out: Record<number, string> = {};
  let i = 0;
  while (i + 2 <= buf.length) {
    const tag = buf[i];
    const len = buf[i + 1];
    out[tag] = buf.subarray(i + 2, i + 2 + len).toString('utf8');
    i += 2 + len;
  }
  return out;
}

export const buyerOf = (c: { name: string; kind: BuyerSnapshot['kind']; vatNumber: string | null; idType: BuyerSnapshot['idType']; idNumber: string | null; address: NationalAddress | null; phone: string | null; email: string | null }): BuyerSnapshot => ({
  name: c.name, kind: c.kind, vatNumber: c.vatNumber, idType: c.idType, idNumber: c.idNumber, address: c.address, phone: c.phone, email: c.email,
});

/**
 * أساس نظام الفوترة: الإعدادات (تُنشأ عند أول استخدام)، والتحقق من الحسابات، وجاهزية الشركة للإصدار، والقوائم المرجعية.
 */
@Injectable()
export class BillingCore {
  constructor(private readonly db: DataSource) {}

  async settings(org: string, em: EntityManager = this.db.manager): Promise<BlSettings> {
    const repo = em.getRepository(BlSettings);
    let s = await repo.findOne({ where: { organizationId: org } });
    if (!s) {
      const [o] = await em.query('SELECT name, tax_number FROM organizations WHERE id = $1', [org]);
      await repo.createQueryBuilder().insert().values({
        organizationId: org, sellerName: o?.name ?? null, vatNumber: o?.tax_number && !vatProblem(o.tax_number) ? o.tax_number : null,
      }).orIgnore().execute();
      s = await repo.findOneOrFail({ where: { organizationId: org } });
    }
    return s;
  }

  /** حساب فرعي نشط في الدليل بطبيعة محددة */
  async account(org: string, id: string | null | undefined, nature: 'assets' | 'liabilities' | 'revenue' | null, label: string, em: EntityManager = this.db.manager) {
    if (!id) return null;
    const [a] = await em.query('SELECT id, code, name, kind, nature, is_active FROM acc_accounts WHERE organization_id = $1 AND id = $2', [org, id]);
    if (!a) throw new BadRequestException(`${label}: الحساب غير موجود في الدليل`);
    if (a.kind !== 'sub') throw new BadRequestException(`${label}: الحساب ${a.code} ليس حسابًا فرعيًا`);
    if (!a.is_active) throw new BadRequestException(`${label}: الحساب ${a.code} موقوف`);
    if (nature && a.nature !== nature) {
      const names = { assets: 'الأصول', liabilities: 'الخصوم', revenue: 'الإيرادات' };
      throw new BadRequestException(`${label}: يجب أن يكون الحساب من ${names[nature]}`);
    }
    return a as { id: string; code: string; name: string };
  }

  /** حساب تحليلي (مركز تكلفة) فرعي نشط */
  async analytic(org: string, id: string | null | undefined, em: EntityManager = this.db.manager) {
    if (!id) return null;
    const [a] = await em.query('SELECT id, code, name, kind, is_active FROM acc_analytic_accounts WHERE organization_id = $1 AND id = $2', [org, id]);
    if (!a || !a.is_active) throw new BadRequestException('مركز التكلفة غير موجود أو موقوف');
    if (a.kind !== 'sub') throw new BadRequestException(`مركز التكلفة ${a.code} ليس فرعيًا`);
    return a as { id: string; code: string; name: string };
  }

  /**
   * الحساب البنكي المطبوع في الفاتورة: المختار في الإعدادات، وإلا الحساب البنكي النشط الوحيد في «البنوك والصناديق».
   * إن وُجد أكثر من حساب بنكي ولم يُختر أحدها فلا يظهر حساب. البيانات تُقرأ من شاشة البنوك، ولا تُكتب من الكود.
   */
  async paymentBank(org: string, id: string | null | undefined, em: EntityManager = this.db.manager): Promise<PaymentBank | null> {
    if (!id) {
      const banks: { id: string }[] = await em.query(`SELECT id FROM acc_cash_accounts WHERE organization_id = $1 AND kind = 'bank' AND is_active LIMIT 2`, [org]);
      if (banks.length !== 1) return null;
      id = banks[0].id;
    }
    const [c] = await em.query(`SELECT name, bank_name, iban, kind, is_active FROM acc_cash_accounts WHERE organization_id = $1 AND id = $2`, [org, id]);
    if (!c || c.kind !== 'bank' || !c.is_active) return null;
    return { bankName: c.bank_name ?? null, accountName: c.name, iban: c.iban ?? null };
  }

  /** ما ينقص الشركة لإصدار الفواتير في وضعها الحالي */
  readiness(s: BlSettings) {
    const missing: string[] = [];
    if (s.mode === 'off') missing.push('تفعيل النظام واختيار وضع الشركة الضريبي من الإعدادات');
    if (!s.sellerName) missing.push('اسم الشركة كما يظهر في الفاتورة');
    if (!s.receivablesAccountId) missing.push('حساب الذمم المدينة (العملاء)');
    if (!s.revenueAccountId) missing.push('حساب الإيراد الافتراضي');
    if (s.mode === 'registered' || s.mode === 'integrated') {
      if (!s.vatNumber || vatProblem(s.vatNumber)) missing.push('الرقم الضريبي للشركة');
      if (!s.vatOutputAccountId) missing.push('حساب ضريبة القيمة المضافة (المخرجات)');
      if (!s.idType || !s.idNumber) missing.push('المعرّف الآخر للشركة (السجل أو ترخيص الشركة)');
      missing.push(...addressProblems(s.address, 'الشركة'));
    }
    const today = blToday();
    const vat = {
      effectiveFrom: s.vatEffectiveFrom, activeToday: modeOn(s, today) === 'registered' || modeOn(s, today) === 'integrated',
      note: s.vatEffectiveFrom && modeOn(s, today) === 'unregistered' && s.mode !== 'unregistered'
        ? `التسجيل في الضريبة ينفذ في ${s.vatEffectiveFrom}، فالفواتير قبله فواتير عادية بلا ضريبة` : null,
    };
    return { ready: !missing.length, missing, vat };
  }

  assertReady(s: BlSettings) {
    const r = this.readiness(s);
    if (!r.ready) throw new BadRequestException(`أكمل إعدادات الفوترة قبل الإصدار: ${r.missing.join('، ')}`);
  }

  /** القوائم المرجعية لشاشات النظام */
  async lookups(org: string) {
    const s = await this.settings(org);
    const [accounts, analytics, categories, cash] = await Promise.all([
      this.db.query(`SELECT id, code, name, nature FROM acc_accounts WHERE organization_id = $1 AND kind = 'sub' AND is_active AND nature IN ('assets', 'liabilities', 'revenue') ORDER BY code`, [org]),
      this.db.query(`SELECT id, code, name FROM acc_analytic_accounts WHERE organization_id = $1 AND kind = 'sub' AND is_active ORDER BY code`, [org]).catch(() => []),
      this.db.query(`SELECT id, name FROM acc_partner_categories WHERE organization_id = $1 AND behavior = 'customer' ORDER BY sort_order, name`, [org]).catch(() => []),
      this.db.query(`SELECT id, name, kind, bank_name AS "bankName", iban FROM acc_cash_accounts WHERE organization_id = $1 AND is_active ORDER BY kind, name`, [org]),
    ]);
    return {
      settings: s, readiness: this.readiness(s), effectiveMode: modeOn(s, blToday()), accounts, analytics, partnerCategories: categories, cashAccounts: cash,
      modes: BILLING_MODES, idTypes: ID_TYPES, sellerIdTypes: SELLER_ID_TYPES, vatCategories: VAT_CATEGORIES,
      vatReasons: Object.entries(VAT_REASONS).map(([code, r]) => ({ code, ...r })), itemKinds: ITEM_KINDS, customerKinds: CUSTOMER_KINDS,
      docKinds: DOC_KINDS, docTypes: DOC_TYPES, docStatus: DOC_STATUS, noteReasons: NOTE_REASONS,
    };
  }
}
