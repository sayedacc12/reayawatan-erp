import { AuthUser, OrgUser } from '../auth/decorators';
import { ReportFilter, ReportOption } from './report.types';

/** أدوات صغيرة متكررة في تعريفات التقارير */

/** فلترا الفترة القياسيان (من بداية السنة حتى اليوم) */
export const periodFilters = (label = ''): ReportFilter[] => [
  { key: 'from', label: `من تاريخ${label ? ` ${label}` : ''}`, type: 'date', default: 'yearStart', required: true },
  { key: 'to', label: `إلى تاريخ${label ? ` ${label}` : ''}`, type: 'date', default: 'today', required: true },
];

/** قائمة اختيار من خريطة قيم عربية ثابتة */
export const selectFilter = (key: string, label: string, map: Record<string, string>, placeholder = 'الكل'): ReportFilter => ({
  key, label, type: 'select', placeholder, options: Object.entries(map).map(([value, l]) => ({ value, label: l })),
});

/** قائمة اختيار تُحمّل من الجمعية بدالة */
export const dynamicFilter = (key: string, label: string, load: (user: OrgUser) => Promise<ReportOption[]>, placeholder = 'الكل', required = false): ReportFilter => ({
  key, label, type: 'select', placeholder, required, loadOptions: (u: AuthUser) => load(u as OrgUser),
});

/** المستخدم داخل جمعية (التقارير ذات النطاق organization مضمونة الجمعية من السجل) */
export const org = (u: AuthUser) => u as OrgUser;

/** رقم مرجعي بصيغة ثابتة: FR-00012 */
export const refNo = (prefix: string, n: unknown) => (n === null || n === undefined || n === '' ? null : `${prefix}-${String(n).padStart(5, '0')}`);

/** ترجمة قيمة من خريطة الأسماء العربية */
export const ar = (map: Record<string, string>, v: unknown) => (v === null || v === undefined || v === '' ? null : map[String(v)] ?? String(v));

export const r2 = (n: unknown) => (n === null || n === undefined || n === '' ? null : Math.round(Number(n) * 100) / 100);

/** هل التاريخ داخل الفترة؟ (يقبل نصًا أو Date) */
export const within = (d: unknown, from?: string, to?: string) => {
  if (!d) return false;
  const s = (d instanceof Date ? d.toISOString() : String(d)).slice(0, 10);
  return (!from || s >= from) && (!to || s <= to);
};
