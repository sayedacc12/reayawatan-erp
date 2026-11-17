/**
 * أدوات تبويب التقارير الموحد في الواجهة: الأنواع، تنسيق الخلايا، والتصدير.
 * الخادم يعرّف التقارير (core/reports)، والواجهة تعرضها بمكون ReportsHub واحد لكل الأنظمة.
 */
import { ApiError, token } from '../../api';

export type ColumnType = 'text' | 'number' | 'money' | 'percent' | 'date' | 'datetime' | 'bool';
export interface ReportColumn { key: string; label: string; type?: ColumnType; total?: boolean }
export interface ReportOption { value: string; label: string }
export interface ReportFilterDef {
  key: string; label: string; type: 'date' | 'month' | 'year' | 'select' | 'text';
  required: boolean; placeholder: string | null; default: string | null; options: ReportOption[] | null;
}
export interface CatalogItem { code: string; title: string; description: string; category: string | null }
export interface ReportDef extends CatalogItem {
  module: string; columns: ReportColumn[]; filters: ReportFilterDef[];
  link: string | null; drill: { report: string; filters: Record<string, string> } | null;
}
export type Row = Record<string, unknown> & { _level?: number; _style?: 'strong' | 'muted' | 'group' };
export interface ReportOutput {
  code: string; title: string; description: string; subtitle: string | null; organizationName: string | null;
  generatedAt: string; generatedBy: string; appliedFilters: { label: string; value: string }[];
  columns: ReportColumn[]; rows: Row[]; totals: Record<string, number> | null;
  summary: { label: string; value: number | string | null; type?: ColumnType }[]; notes: string[];
  indentColumn: string | null;
}
export type ExportFormat = 'pdf' | 'xlsx' | 'csv' | 'html';

const L = 'ar-SA-u-ca-gregory';
export const isNumeric = (t?: ColumnType) => t === 'money' || t === 'number' || t === 'percent';

export function formatCell(v: unknown, type: ColumnType = 'text'): string {
  if (v === null || v === undefined || v === '') return '—';
  switch (type) {
    case 'money': return Number(v).toLocaleString(L, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    case 'number': return Number(v).toLocaleString(L, { maximumFractionDigits: 2 });
    case 'percent': return `${Number(v).toLocaleString(L, { maximumFractionDigits: 2 })}٪`;
    case 'date': {
      const s = String(v);
      const d = /^\d{4}-\d{2}-\d{2}$/.test(s) ? new Date(`${s}T00:00:00`) : new Date(s);
      return Number.isNaN(d.getTime()) ? s : d.toLocaleDateString(L, { year: 'numeric', month: 'short', day: 'numeric' });
    }
    case 'datetime': {
      const d = new Date(String(v));
      return Number.isNaN(d.getTime()) ? String(v) : d.toLocaleString(L, { year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
    }
    case 'bool': return v === true || v === 'true' ? 'نعم' : 'لا';
    default: return String(v);
  }
}

/** استبدال {key} في قالب الرابط بقيم الصف */
export const fillTemplate = (tpl: string, row: Row) =>
  tpl.replace(/\{(\w+)\}/g, (_, k: string) => (row[k] === null || row[k] === undefined ? '' : encodeURIComponent(String(row[k]))));

export function queryString(filters: Record<string, string | null>, extra: Record<string, string> = {}) {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(filters)) q.set(k, v ?? '');
  for (const [k, v] of Object.entries(extra)) q.set(k, v);
  return q.toString();
}

async function fetchExport(code: string, format: ExportFormat, filters: Record<string, string | null>) {
  const t = token.get();
  const res = await fetch(`/api/reports/export/${encodeURIComponent(code)}?${queryString(filters, { format })}`, {
    headers: t ? { Authorization: `Bearer ${t}` } : {},
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new ApiError(res.status, (Array.isArray(data.message) ? data.message.join('، ') : data.message) || 'تعذر تصدير التقرير');
  }
  return res;
}

/** تنزيل التقرير بالصيغة المطلوبة باسم ملف عربي من الخادم */
export async function downloadReport(code: string, format: Exclude<ExportFormat, 'html'>, filters: Record<string, string | null>) {
  const res = await fetchExport(code, format, filters);
  const cd = res.headers.get('Content-Disposition') ?? '';
  const m = /filename\*=UTF-8''([^;]+)/.exec(cd);
  const name = m ? decodeURIComponent(m[1]) : `report.${format}`;
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

/** طباعة التقرير بنفس تصميم ملف PDF (إطار مخفي ثم نافذة الطباعة) */
export async function printReport(code: string, filters: Record<string, string | null>) {
  const html = await (await fetchExport(code, 'html', filters)).text();
  const frame = document.createElement('iframe');
  frame.setAttribute('aria-hidden', 'true');
  Object.assign(frame.style, { position: 'fixed', left: '-10000px', top: '0', width: '1100px', height: '800px', border: '0' });
  document.body.appendChild(frame);
  await new Promise<void>((resolve) => {
    frame.onload = () => resolve();
    frame.srcdoc = html;
  });
  const win = frame.contentWindow!;
  await (win.document as Document & { fonts?: FontFaceSet }).fonts?.ready;
  win.focus();
  win.print();
  setTimeout(() => frame.remove(), 60_000);
}
