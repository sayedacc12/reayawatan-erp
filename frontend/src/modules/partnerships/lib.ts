/* eslint-disable @typescript-eslint/no-explicit-any */
import { ref } from 'vue';
import { api } from '../../api';

export const PT = {
  read: 'partnerships.partners.read', partners: 'partnerships.partners.manage', evaluate: 'partnerships.evaluations.manage',
  contracts: 'partnerships.contracts.manage', approve: 'partnerships.approvals.decide', reports: 'partnerships.reports.read', settings: 'partnerships.settings.manage',
} as const;

export const PARTNER_COLOR: Record<string, string> = {
  prospect: '#64748b', evaluating: '#0369a1', pending: '#d97706', approved: '#059669', rejected: '#dc2626', suspended: '#7c3aed',
};
export const CONTRACT_COLOR: Record<string, string> = {
  draft: '#64748b', review: '#d97706', approved: '#0369a1', sent: '#7c3aed', changes_requested: '#db2777', signed: '#059669', expired: '#b45309', terminated: '#dc2626', cancelled: '#94a3b8',
};
export const EVAL_COLOR: Record<string, string> = { draft: '#64748b', submitted: '#d97706', approved: '#059669', rejected: '#dc2626', returned: '#db2777' };
export const KIND_ICON: Record<string, string> = { obligation: '◆', report: '▤', payment: '﷼', meeting: '◎', review: '✦', other: '•' };

export const fmtDate = (d: string | null | undefined) =>
  d ? new Date(`${String(d).slice(0, 10)}T00:00:00`).toLocaleDateString('ar-SA-u-ca-gregory-nu-latn', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';
export const fmtDateTime = (d: string | null | undefined) =>
  d ? new Date(d).toLocaleString('ar-SA-u-ca-gregory-nu-latn', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—';
export const sar = (n: number | null | undefined) => (n === null || n === undefined ? '—' : `${Math.round(n).toLocaleString('en-US')} ريال`);
export const today = () => new Date(Date.now() + 3 * 3600_000).toISOString().slice(0, 10);
export const addMonthsStr = (d: string, m: number) => {
  const x = new Date(`${d}T00:00:00Z`);
  x.setUTCMonth(x.getUTCMonth() + m);
  x.setUTCDate(x.getUTCDate() - 1);
  return x.toISOString().slice(0, 10);
};
export const uid = () => (crypto.randomUUID ? crypto.randomUUID() : `k${Date.now()}${Math.random().toString(36).slice(2)}`);
export const ORD = ['الأول', 'الثاني', 'الثالث', 'الرابع', 'الخامس', 'السادس', 'السابع', 'الثامن', 'التاسع', 'العاشر', 'الحادي عشر', 'الثاني عشر', 'الثالث عشر',
  'الرابع عشر', 'الخامس عشر', 'السادس عشر', 'السابع عشر', 'الثامن عشر', 'التاسع عشر', 'العشرون', 'الحادي والعشرون', 'الثاني والعشرون', 'الثالث والعشرون',
  'الرابع والعشرون', 'الخامس والعشرون', 'السادس والعشرون', 'السابع والعشرون', 'الثامن والعشرون', 'التاسع والعشرون', 'الثلاثون'];
export const SCALE = [
  { v: 1, label: 'ضعيف جدًا' }, { v: 2, label: 'ضعيف' }, { v: 3, label: 'مقبول' }, { v: 4, label: 'جيد' }, { v: 5, label: 'ممتاز' },
];
export const highlight = (s: string) =>
  s.replace(/[&<>]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[ch]!).replace(/\{\{\s*([^{}]+?)\s*\}\}/g, '<mark>$1</mark>');

/** القوائم المرجعية (الأنواع والتصنيفات والمعايير والتبويب) مخزنة مرة واحدة في الصفحة */
const cache = ref<any>(null);
export async function lookups(force = false) {
  if (!cache.value || force) cache.value = await api('/partnerships/lookups');
  return cache.value;
}
export function setLookups(v: any) {
  cache.value = v;
}
