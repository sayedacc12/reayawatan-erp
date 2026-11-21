/* eslint-disable @typescript-eslint/no-explicit-any */
import { ref } from 'vue';
import { api } from '../../api';

export const BL = {
  read: 'billing.dashboard.read', customers: 'billing.customers.manage', items: 'billing.items.manage', invoices: 'billing.invoices.manage',
  issue: 'billing.invoices.issue', reports: 'billing.reports.read', settings: 'billing.settings.manage',
} as const;
/** صلاحية سندات القبض في النظام المالي (لتحصيل الفواتير) */
export const ACC_RECEIPTS = 'accounting.receipts.manage';
export const BL_READ = [BL.read, BL.invoices, BL.issue, BL.reports, BL.customers, ACC_RECEIPTS];

export const DOC_COLOR: Record<string, string> = { draft: '#64748b', pending: '#d97706', issued: '#0369a1', partial: '#ca8a04', paid: '#059669', cancelled: '#94a3b8' };
export const TYPE_COLOR: Record<string, string> = { standard: '#7c3aed', simplified: '#0891b2', nontax: '#64748b' };
export const CAT_COLOR: Record<string, string> = { S: '#0369a1', Z: '#0d9488', E: '#b45309', O: '#64748b' };

export { fmtDate, fmtDateTime, sar, accLabel } from '../procurement/lib';
export const today = () => new Date(Date.now() + 3 * 3600_000).toISOString().slice(0, 10);
export const money = (n: number | null | undefined) => (n === null || n === undefined ? '—' : Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));

/** القوائم المرجعية (الإعدادات والحسابات والفئات الضريبية وأسبابها) مرة واحدة في الصفحة */
const cache = ref<any>(null);
export async function billingLookups(force = false) {
  if (!cache.value || force) cache.value = await api('/billing/lookups');
  return cache.value;
}

export const emptyAddress = () => ({ street: '', buildingNo: '', additionalNo: '', district: '', city: '', postalCode: '', country: 'SA' });
const nul = (v: unknown) => (typeof v === 'string' ? v.trim() || null : v ?? null);
export const addressPayload = (a: any) => {
  if (!a) return null;
  const out = Object.fromEntries(Object.entries(a).map(([k, v]) => [k, nul(v)]));
  return Object.entries(out).some(([k, v]) => k !== 'country' && v) ? out : null;
};
export const addressText = (a: any) => (a ? [a.buildingNo && `مبنى ${a.buildingNo}`, a.street, a.district, a.city, a.postalCode, a.additionalNo && `إضافي ${a.additionalNo}`].filter(Boolean).join('، ') : '—');
