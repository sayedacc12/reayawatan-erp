import { ApiError, token } from '../../api';

/** إعداد الميزانية والقوائم المالية: أنواع البيانات وأدوات التنزيل المشتركة بين التبويبات */

export type Span = 'M' | 'Q' | 'H' | 'Y';
export const SPAN_LABEL: Record<Span, string> = { M: 'شهري', Q: 'ربع سنوي', H: 'نصف سنوي', Y: 'سنوي' };
const ORD = ['الأول', 'الثاني', 'الثالث', 'الرابع'];
const MONTHS = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];

export interface FsYear { id: string; name: number | string; startDate: string; endDate: string; status: string; closedMonths: string[] }
export interface FsLineOpt { code: string; statement: 'bs' | 'is'; group: string; groupName: string; name: string }
export interface FsPolicy { maxDevelopmentPct: number; maxDistributionPct: number; minNonprofitPct: number; reserveMonths: number }
export interface FsOptions { years: FsYear[]; channels: string[]; policy: FsPolicy; lines: FsLineOpt[]; pdf: boolean }

export interface FsAccount { id: string; code: string; name: string; source: string; cur: number; cmp: number | null }
export interface FsRow { code: string; name: string; note: number | null; cur: number; cmp: number | null; ytd?: number | null; accounts: FsAccount[] }
export interface FsTotal { cur: number; cmp: number | null; ytd?: number | null }
export interface FsPreview {
  period: { yearId: string; year: string; label: string; range: string; from: string; to: string; startsYear: boolean; endsYear: boolean; key: string };
  comparative: { year: string; from: string; to: string; end: string; closed: boolean } | null;
  bs: {
    groups: { key: string; name: string; rows: FsRow[]; total: FsTotal }[];
    totalAssets: FsTotal; totalLiabilities: FsTotal; totalEquity: FsTotal; totalLiabEquity: FsTotal; difference: FsTotal;
  };
  is: { showYtd: boolean; sections: { key: string; name: string; rows?: FsRow[]; subtotal?: FsTotal }[]; netIncome: number; netIncomeYtd: number };
  equity: { columns: { code: string; name: string }[]; rows: { label: string; values: number[] }[] };
  cash: {
    netIncome: number; depreciation: number; operating: { name: string; amount: number }[]; operatingTotal: number;
    investing: { name: string; amount: number }[]; investingTotal: number; financing: { name: string; amount: number }[]; financingTotal: number;
    netChange: number; cashStart: number; cashEnd: number; difference: number;
  };
  warnings: string[];
  closure: { closed: boolean; yearClosed: boolean; openMonths: string[]; drafts: number; openVouchers: number; reasons: string[] };
  totals: { assets: number; liabilities: number; equity: number; netIncome: number; netIncomeYtd: number; cash: number };
}

/** عدد أجزاء نوع الفترة داخل السنة المالية، وأسماؤها من شهور السنة نفسها */
export function spanParts(y: FsYear | undefined, span: Span): { value: number; label: string }[] {
  if (!y || span === 'Y') return [{ value: 1, label: 'السنة كاملة' }];
  const months: string[] = [];
  for (let d = new Date(`${y.startDate.slice(0, 7)}-01T00:00:00Z`); d.toISOString().slice(0, 7) <= y.endDate.slice(0, 7); d.setUTCMonth(d.getUTCMonth() + 1)) {
    months.push(d.toISOString().slice(0, 7));
  }
  const size = span === 'M' ? 1 : span === 'Q' ? 3 : 6;
  const n = Math.ceil(months.length / size);
  const name = (m: string) => `${MONTHS[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}`;
  return Array.from({ length: n }, (_, i) => {
    const ms = months.slice(i * size, (i + 1) * size);
    const label = span === 'M' ? name(ms[0]) : `${span === 'Q' ? 'الربع' : 'النصف'} ${ORD[i] ?? i + 1} (${name(ms[0])} – ${name(ms[ms.length - 1])})`;
    return { value: i + 1, label };
  });
}

/** الفترة الحالية داخل السنة (أو آخر فترة إن انتهت السنة) لاختيار افتراضي معقول */
export function currentPart(y: FsYear | undefined, span: Span, today: string) {
  if (!y || span === 'Y') return 1;
  const size = span === 'M' ? 1 : span === 'Q' ? 3 : 6;
  const start = new Date(`${y.startDate.slice(0, 7)}-01T00:00:00Z`);
  const t = today > y.endDate ? y.endDate : today < y.startDate ? y.startDate : today;
  const idx = (Number(t.slice(0, 4)) - start.getUTCFullYear()) * 12 + (Number(t.slice(5, 7)) - 1 - start.getUTCMonth());
  return Math.max(1, Math.min(spanParts(y, span).length, Math.floor(idx / size) + 1));
}

async function authed(url: string, init: RequestInit = {}) {
  const t = token.get();
  const headers = new Headers(init.headers);
  if (t) headers.set('Authorization', `Bearer ${t}`);
  const res = await fetch(url, { ...init, headers });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new ApiError(res.status, (Array.isArray(data.message) ? data.message.join('، ') : data.message) || 'تعذر إصدار الملف');
  }
  return res;
}

/** نص HTML لوثيقة تُعرض في إطار معزول */
export async function fetchHtml(path: string) { return (await authed(`/api${path}`)).text(); }

/** تنزيل ملف (PDF أو Excel) باسمه القادم من الخادم */
export async function download(path: string, fallback: string, init: RequestInit & { json?: unknown } = {}) {
  const { json, ...rest } = init;
  const res = await authed(`/api${path}`, json === undefined ? rest : { ...rest, body: JSON.stringify(json), headers: { 'Content-Type': 'application/json' } });
  const m = /filename\*=UTF-8''([^;]+)/.exec(res.headers.get('Content-Disposition') ?? '');
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement('a');
  a.href = url; a.download = m ? decodeURIComponent(m[1]) : fallback;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
  return res;
}

/** طباعة الوثيقة المعروضة في الإطار */
export async function printFrame(frame: HTMLIFrameElement | null) {
  const win = frame?.contentWindow;
  await (win?.document as (Document & { fonts?: FontFaceSet }) | undefined)?.fonts?.ready;
  win?.focus();
  win?.print();
}

/** القيمة السالبة بين قوسين كما في القوائم المالية */
const nf = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const amt = (v: number | null | undefined) => (v === null || v === undefined ? '—' : v < 0 ? `(${nf.format(-v)})` : nf.format(v));
