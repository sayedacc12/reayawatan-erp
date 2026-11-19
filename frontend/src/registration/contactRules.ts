/**
 * تدقيق بيانات التواصل في نموذج تسجيل الجمعية (الجوالات السعودية والبريد والأسماء).
 * نسخة مطابقة لقواعد الخادم: backend/src/core/contact-validation.ts
 */

/** يحوّل الأرقام العربية والفارسية إلى أرقام إنجليزية */
export const toLatinDigits = (s: string) =>
  s.replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660)).replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0));

/** يحذف المسافات والشرطات والأقواس ويحوّل الأرقام، ثم يوحّد الجوال السعودي على صيغة 05xxxxxxxx */
export function normalizePhone(raw: string) {
  let p = toLatinDigits(raw).replace(/[\s\-()\u200e\u200f]/g, '');
  const m = /^(?:\+966|00966|966)(5\d{8})$/.exec(p) ?? /^(5\d{8})$/.exec(p);
  if (m) p = `0${m[1]}`;
  return p;
}

const MOBILE = /^05\d{8}$/;
/** أرقام مكررة بالكامل مثل 0500000000 */
const fake = (p: string) => /^05(\d)\1{7}$/.test(p);
export const isSaudiMobile = (p: string) => MOBILE.test(p) && !fake(p);
/** هاتف الجمعية: جوال، أو ثابت (01x xxxxxxx)، أو موحّد 9200، أو مجاني 800 */
export const isSaudiPhone = (p: string) => isSaudiMobile(p) || /^01[1-7]\d{7}$/.test(p) || /^9200\d{5}$/.test(p) || /^800\d{7}$/.test(p);

export const MOBILE_MSG = 'جوال سعودي من 10 أرقام يبدأ بـ 05، مثل 0512345678';
export const PHONE_MSG = 'رقم سعودي صحيح: جوال يبدأ بـ 05 (10 أرقام)، أو هاتف ثابت مثل 0112345678، أو رقم موحد يبدأ بـ 9200';

const EMAIL = /^[a-z0-9](?:[a-z0-9._%+-]{0,62}[a-z0-9_-])?@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*\.[a-z]{2,24}$/;
/** أخطاء كتابة شائعة في نطاقات البريد */
const DOMAIN_TYPOS: Record<string, string> = {
  'gmail.co': 'gmail.com', 'gmail.con': 'gmail.com', 'gmail.cm': 'gmail.com', 'gmail.om': 'gmail.com', 'gmail.comm': 'gmail.com',
  'gmial.com': 'gmail.com', 'gmai.com': 'gmail.com', 'gamil.com': 'gmail.com', 'gmal.com': 'gmail.com', 'gmaill.com': 'gmail.com', 'gnail.com': 'gmail.com',
  'hotmail.con': 'hotmail.com', 'hotmail.co': 'hotmail.com', 'hotmial.com': 'hotmail.com', 'hotmal.com': 'hotmail.com', 'hotmai.com': 'hotmail.com',
  'outlook.con': 'outlook.com', 'outlook.co': 'outlook.com', 'outlok.com': 'outlook.com', 'outllook.com': 'outlook.com',
  'yahoo.con': 'yahoo.com', 'yahoo.co': 'yahoo.com', 'yaho.com': 'yahoo.com', 'yahooo.com': 'yahoo.com',
  'icloud.con': 'icloud.com', 'icloud.co': 'icloud.com', 'icoud.com': 'icloud.com',
};
/** يعيد سبب رفض البريد أو null إن كان سليمًا */
export function emailProblem(email: string): string | null {
  const e = email.trim().toLowerCase();
  if (!e) return 'اكتب البريد الإلكتروني';
  if (/[؀-ۿ]/.test(e)) return 'البريد الإلكتروني بالحروف الإنجليزية فقط';
  if (!EMAIL.test(e) || e.includes('..')) return 'البريد الإلكتروني غير صحيح، مثل name@example.com';
  const domain = e.split('@')[1];
  if (DOMAIN_TYPOS[domain]) return `يبدو أن في البريد خطأ كتابة، هل تقصد @${DOMAIN_TYPOS[domain]}؟`;
  return null;
}

/** اسم شخص: حروف عربية أو إنجليزية فقط، ومن كلمتين على الأقل */
export function personNameProblem(name: string): string | null {
  const n = name.trim().replace(/\s+/g, ' ');
  if (/[0-9٠-٩۰-۹]/.test(n)) return 'الاسم لا يحتوي على أرقام';
  if (!/^[\p{L}\p{M}' .-]+$/u.test(n)) return 'الاسم بالحروف فقط بدون رموز';
  if (n.split(' ').filter((w) => w.length > 1).length < 2) return 'اكتب الاسم الكامل (الاسم الأول واسم العائلة على الأقل)';
  return null;
}

/** رقم الترخيص: أرقام (مع / أو - فقط) */
export const LICENSE = /^[0-9][0-9/-]{0,29}$/;
export const normalizeLicense = (v: string) => toLatinDigits(v).replace(/\s+/g, '');

