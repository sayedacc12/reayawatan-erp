import { ReportColumnType } from './report.types';

/** تنسيق القيم بالعربي لملفات PDF والطباعة (نفس أسلوب الواجهة) */
const LOCALE = 'ar-SA-u-ca-gregory-nu-arab';
const TZ = 'Asia/Riyadh';

const moneyFmt = new Intl.NumberFormat(LOCALE, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const numFmt = new Intl.NumberFormat(LOCALE, { maximumFractionDigits: 2 });
const dateFmt = new Intl.DateTimeFormat(LOCALE, { year: 'numeric', month: '2-digit', day: '2-digit', timeZone: 'UTC' });
const dateTimeFmt = new Intl.DateTimeFormat(LOCALE, {
  year: 'numeric', month: '2-digit', day: '2-digit', hour: 'numeric', minute: '2-digit', timeZone: TZ,
});

/** تاريخ YYYY-MM-DD أو كائن تاريخ إلى Date (التاريخ المجرد يُقرأ بتوقيت UTC حتى لا يتغير اليوم) */
export function toDate(v: unknown): Date | null {
  if (v === null || v === undefined || v === '') return null;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v;
  const s = String(v);
  const d = /^\d{4}-\d{2}-\d{2}$/.test(s) ? new Date(`${s}T00:00:00Z`) : new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function isEmpty(v: unknown) {
  return v === null || v === undefined || v === '';
}

export function formatValue(v: unknown, type: ReportColumnType = 'text'): string {
  if (isEmpty(v)) return '';
  switch (type) {
    case 'money':
      return Number.isFinite(Number(v)) ? moneyFmt.format(Number(v)) : String(v);
    case 'number':
      return Number.isFinite(Number(v)) ? numFmt.format(Number(v)) : String(v);
    case 'percent':
      return Number.isFinite(Number(v)) ? `${numFmt.format(Number(v))}٪` : String(v);
    case 'date': {
      const d = toDate(v);
      return d ? dateFmt.format(d) : String(v);
    }
    case 'datetime': {
      const d = toDate(v);
      return d ? dateTimeFmt.format(d) : String(v);
    }
    case 'bool':
      return v === true || v === 'true' ? 'نعم' : 'لا';
    default:
      return String(v);
  }
}

export const formatDateText = (s: string) => formatValue(s, 'date');
export const nowText = () => dateTimeFmt.format(new Date());

/** القيمة كما تُكتب في CSV: الأرقام بدون تنسيق، والتواريخ YYYY-MM-DD */
export function plainValue(v: unknown, type: ReportColumnType = 'text'): string {
  if (isEmpty(v)) return '';
  if (type === 'money' || type === 'number' || type === 'percent') return Number.isFinite(Number(v)) ? String(Number(v)) : String(v);
  if (type === 'date') {
    const d = toDate(v);
    return d ? d.toISOString().slice(0, 10) : String(v);
  }
  if (type === 'datetime') {
    const d = toDate(v);
    return d ? new Intl.DateTimeFormat('en-CA', { timeZone: TZ, dateStyle: 'short', timeStyle: 'short', hour12: false }).format(d).replace(',', '') : String(v);
  }
  if (type === 'bool') return v === true || v === 'true' ? 'نعم' : 'لا';
  return String(v);
}

export const isNumeric = (t?: ReportColumnType) => t === 'money' || t === 'number' || t === 'percent';
