/** الأسماء العربية لقيم وحدة الموارد المالية وألوانها، وتنسيق المبالغ والتواريخ */
type Opt = { value: string; label: string; color?: string };
const toMap = (opts: Opt[]) => Object.fromEntries(opts.map((o) => [o.value, o]));

export const KINDS: Opt[] = [
  { value: 'cash', label: 'نقدية', color: '#10b981' },
  { value: 'in_kind', label: 'عينية', color: '#f59e0b' },
  { value: 'pledge', label: 'وعد بالدفع', color: '#8b5cf6' },
];
export const STATUSES: Opt[] = [
  { value: 'in_progress', label: 'قيد الاعتماد', color: '#0ea5e9' },
  { value: 'returned', label: 'مُعادة للتعديل', color: '#f59e0b' },
  { value: 'approved', label: 'معتمدة', color: '#10b981' },
  { value: 'rejected', label: 'مرفوضة', color: '#ef4444' },
];
export const TARGETS: Opt[] = [
  { value: 'operational', label: 'تبرعات تشغيلية', color: '#0ea5e9' },
  { value: 'program', label: 'تبرعات مقيدة', color: '#14b8a6' },
  { value: 'waqf', label: 'تبرعات أوقاف', color: '#a16207' },
  { value: 'case', label: 'حالة محددة', color: '#ec4899' },
  { value: 'zakat', label: 'زكاة', color: '#e8b04b' },
];
export const BATCH_STATUSES: Opt[] = [
  { value: 'pending', label: 'بانتظار اعتماد الفرصة', color: '#94a3b8' },
  { value: 'active', label: 'متاحة', color: '#10b981' },
  { value: 'closed', label: 'مستنفدة', color: '#64748b' },
  { value: 'cancelled', label: 'ملغاة', color: '#ef4444' },
];
export const ACTIONS: Opt[] = [
  { value: 'created', label: 'تسجيل الفرصة', color: '#6366f1' },
  { value: 'edited', label: 'تعديل البيانات', color: '#6366f1' },
  { value: 'resubmitted', label: 'إعادة التقديم بعد التعديل', color: '#6366f1' },
  { value: 'approve', label: 'موافقة', color: '#10b981' },
  { value: 'reject', label: 'رفض', color: '#ef4444' },
  { value: 'return', label: 'طلب تعديل', color: '#f59e0b' },
  { value: 'approved_final', label: 'اعتماد نهائي وإصدار القيد', color: '#e8b04b' },
  { value: 'document_added', label: 'إرفاق مستند', color: '#0ea5e9' },
  { value: 'document_removed', label: 'حذف مستند', color: '#94a3b8' },
  { value: 'collected', label: 'سداد من الداعم', color: '#10b981' },
  { value: 'amended', label: 'تعديل فرصة معتمدة', color: '#8b5cf6' },
];
export const CATEGORIES: Opt[] = [
  { value: 'citizen', label: 'مواطنون' },
  { value: 'resident', label: 'مقيمون' },
  { value: 'visitor', label: 'زائرون' },
];
export const DONOR_TYPES: Opt[] = [
  { value: 'individual', label: 'فرد' },
  { value: 'entity', label: 'جهة' },
];
export const FIELD_TYPES: Opt[] = [
  { value: 'text', label: 'نص قصير' },
  { value: 'textarea', label: 'نص طويل' },
  { value: 'number', label: 'رقم' },
  { value: 'percent', label: 'نسبة مئوية' },
  { value: 'mobile', label: 'رقم جوال' },
  { value: 'email', label: 'بريد إلكتروني' },
  { value: 'date', label: 'تاريخ' },
  { value: 'select', label: 'قائمة اختيارات' },
  { value: 'checkbox', label: 'مربع تأكيد (نعم/لا)' },
];

const maps = {
  kind: toMap(KINDS), status: toMap(STATUSES), target: toMap(TARGETS), batch: toMap(BATCH_STATUSES), action: toMap(ACTIONS),
  category: toMap(CATEGORIES), donorType: toMap(DONOR_TYPES), field: toMap(FIELD_TYPES),
};
export type LabelKind = keyof typeof maps;
export const label = (kind: LabelKind, v?: string | null) => (v ? maps[kind][v]?.label ?? v : '—');
export const color = (kind: LabelKind, v?: string | null) => (v ? maps[kind][v]?.color : undefined) ?? '#64748b';

/** المبالغ بالريال السعودي */
export const money = (n: number | null | undefined, digits = 2) =>
  (n ?? 0).toLocaleString('ar-SA', { minimumFractionDigits: 0, maximumFractionDigits: digits });
export const sar = (n: number | null | undefined) => `${money(n)} ر.س`;
export const num = (n: number | null | undefined) => (n ?? 0).toLocaleString('ar-SA');

/** التاريخ الميلادي وبجانبه الهجري (أم القرى) */
export const fmtDate = (d: string | null | undefined) =>
  d ? new Date(`${d.slice(0, 10)}T00:00:00`).toLocaleDateString('ar-SA-u-ca-gregory', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';
export const hijri = (d: string | null | undefined) =>
  d ? new Date(`${d.slice(0, 10)}T00:00:00`).toLocaleDateString('ar-SA-u-ca-islamic-umalqura', { day: 'numeric', month: 'long', year: 'numeric' }) : '';
export const fmtDateTime = (d: string | null | undefined) =>
  d ? new Date(d).toLocaleString('ar-SA-u-ca-gregory', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—';
export const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
export const fmtNo = (prefix: string, n: number | null | undefined) => (n ? `${prefix}-${String(n).padStart(5, '0')}` : '—');

// ---------------- تفقيط المبالغ (كتابة المبلغ بالحروف) ----------------
const ONES = ['', 'واحد', 'اثنان', 'ثلاثة', 'أربعة', 'خمسة', 'ستة', 'سبعة', 'ثمانية', 'تسعة', 'عشرة', 'أحد عشر', 'اثنا عشر',
  'ثلاثة عشر', 'أربعة عشر', 'خمسة عشر', 'ستة عشر', 'سبعة عشر', 'ثمانية عشر', 'تسعة عشر'];
const TENS = ['', '', 'عشرون', 'ثلاثون', 'أربعون', 'خمسون', 'ستون', 'سبعون', 'ثمانون', 'تسعون'];
const HUNDREDS = ['', 'مائة', 'مائتان', 'ثلاثمائة', 'أربعمائة', 'خمسمائة', 'ستمائة', 'سبعمائة', 'ثمانمائة', 'تسعمائة'];
const SCALES: [string, string, string, string][] = [
  // مفرد، مثنى، جمع (3-10)، تمييز (11+)
  ['ألف', 'ألفان', 'آلاف', 'ألفًا'],
  ['مليون', 'مليونان', 'ملايين', 'مليونًا'],
  ['مليار', 'ملياران', 'مليارات', 'مليارًا'],
];

function below1000(n: number) {
  const h = Math.floor(n / 100);
  const r = n % 100;
  const parts: string[] = [];
  if (h) parts.push(HUNDREDS[h]);
  if (r) {
    if (r < 20) parts.push(ONES[r]);
    else {
      const o = r % 10;
      parts.push(o ? `${ONES[o]} و${TENS[Math.floor(r / 10)]}` : TENS[Math.floor(r / 10)]);
    }
  }
  return parts.join(' و');
}

function intWords(n: number): string {
  if (n === 0) return 'صفر';
  const groups: number[] = [];
  while (n > 0) {
    groups.push(n % 1000);
    n = Math.floor(n / 1000);
  }
  const parts: string[] = [];
  for (let i = groups.length - 1; i >= 0; i--) {
    const g = groups[i];
    if (!g) continue;
    if (i === 0) {
      parts.push(below1000(g));
      continue;
    }
    const [one, two, few, many] = SCALES[i - 1];
    if (g === 1) parts.push(one);
    else if (g === 2) parts.push(two);
    else if (g <= 10) parts.push(`${below1000(g)} ${few}`);
    else parts.push(`${below1000(g)} ${many}`);
  }
  return parts.join(' و');
}

/** مثال: 1250.5 ← "فقط ألف ومائتان وخمسون ريالًا سعوديًا وخمسون هللة لا غير" */
export function tafqeet(amount: number) {
  const riyals = Math.floor(amount);
  const halalas = Math.round((amount - riyals) * 100);
  let s = `فقط ${intWords(riyals)} ${riyals % 100 >= 3 && riyals % 100 <= 10 ? 'ريالات سعودية' : 'ريالًا سعوديًا'}`;
  if (halalas) s += ` و${intWords(halalas)} هللة`;
  return `${s} لا غير`;
}
