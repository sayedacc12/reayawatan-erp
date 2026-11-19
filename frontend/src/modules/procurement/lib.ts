/* eslint-disable @typescript-eslint/no-explicit-any */
import { ref } from 'vue';
import { api } from '../../api';

export const PR = {
  read: 'procurement.dashboard.read', items: 'procurement.items.manage', warehouses: 'procurement.warehouses.manage',
  suppliersRead: 'procurement.suppliers.read', suppliers: 'procurement.suppliers.manage', approveSuppliers: 'procurement.suppliers.approve',
  approveBanks: 'procurement.banks.approve', reports: 'procurement.reports.read', settings: 'procurement.settings.manage',
} as const;

export const SUPPLIER_COLOR: Record<string, string> = {
  draft: '#64748b', pending: '#d97706', returned: '#db2777', approved: '#059669', rejected: '#dc2626', suspended: '#7c3aed',
};
export const DOC_COLOR: Record<string, string> = { pending: '#d97706', accepted: '#059669', rejected: '#dc2626' };
export const BANK_COLOR: Record<string, string> = { pending: '#d97706', approved: '#059669', rejected: '#dc2626', inactive: '#94a3b8' };
export const KIND_COLOR: Record<string, string> = { stock: '#0f766e', consumable: '#0369a1', asset: '#7c3aed', service: '#b45309' };

export const fmtDate = (d: string | null | undefined) =>
  d ? new Date(`${String(d).slice(0, 10)}T00:00:00`).toLocaleDateString('ar-SA-u-ca-gregory-nu-latn', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';
export const fmtDateTime = (d: string | null | undefined) =>
  d ? new Date(d).toLocaleString('ar-SA-u-ca-gregory-nu-latn', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—';
export const sar = (n: number | null | undefined) => (n === null || n === undefined ? '—' : `${Number(n).toLocaleString('en-US', { maximumFractionDigits: 2 })} ريال`);
export const fmtSize = (b: number) => (b > 1024 * 1024 ? `${(b / 1024 / 1024).toFixed(1)} م.ب` : `${Math.max(1, Math.round(b / 1024))} ك.ب`);
/** عرض الآيبان على مجموعات من 4 */
export const ibanView = (s: string) => s.replace(/(.{4})/g, '$1 ').trim();
export const accLabel = (a: { code: string; name: string } | null | undefined) => (a ? `${a.code} · ${a.name}` : '—');

/** رفع ملف مع حقول نصية عبر نفس عميل الموظفين */
export function upload<T = any>(path: string, file: File, fields: Record<string, string | null | undefined> = {}) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) if (v !== null && v !== undefined && v !== '') fd.append(k, v);
  fd.append('file', file);
  return api<T>(path, { method: 'POST', body: fd });
}

/** القوائم المرجعية (المجموعات والوحدات والتصنيفات والحسابات والإعدادات) مرة واحدة في الصفحة */
const cache = ref<any>(null);
export async function lookups(force = false) {
  if (!cache.value || force) cache.value = await api('/procurement/lookups');
  return cache.value;
}
export function setLookups(v: any) {
  cache.value = v;
}

/** ترتيب المجموعات شجريًا مع مستوى كل مجموعة (للقوائم المنسدلة) */
export function groupTree<T extends { id: string; parentId: string | null } = any>(groups: T[]) {
  const out: (T & { depth: number })[] = [];
  const walk = (parent: string | null, depth: number) => {
    for (const g of groups.filter((x) => x.parentId === parent)) {
      out.push({ ...g, depth });
      walk(g.id, depth + 1);
    }
  };
  walk(null, 0);
  // مجموعات يتيمة (أصلها محذوف) تظهر في الأخير
  for (const g of groups) if (!out.some((x) => x.id === g.id)) out.push({ ...g, depth: 0 });
  return out;
}
export const indent = (depth: number) => '   '.repeat(depth) + (depth ? '└ ' : '');

/** نموذج بيانات المورد المشترك بين الموظف وبوابة الموردين */
export function supplierForm(s?: any) {
  return {
    name: s?.name ?? '', nameEn: s?.nameEn ?? '', entityType: s?.entityType ?? 'company', supplierKind: s?.supplierKind ?? 'supplier',
    categoryIds: [...(s?.categoryIds ?? [])] as string[], activities: [...(s?.activities ?? [])] as string[], about: s?.about ?? '',
    crNumber: s?.crNumber ?? '', crExpiry: s?.crExpiry ?? '', vatNumber: s?.vatNumber ?? '', nationalId: s?.nationalId ?? '',
    city: s?.city ?? '', address: s?.address ?? '', phone: s?.phone ?? '', email: s?.email ?? '', website: s?.website ?? '',
    contacts: (s?.contacts ?? []).map((c: any) => ({ ...c, title: c.title ?? '', phone: c.phone ?? '', email: c.email ?? '' })) as any[],
    branches: (s?.branches ?? []).map((b: any) => ({ ...b, city: b.city ?? '', address: b.address ?? '', phone: b.phone ?? '' })) as any[],
  };
}
export type SupplierForm = ReturnType<typeof supplierForm>;
const nul = (v: string) => (v?.trim() ? v.trim() : null);
export function supplierPayload(f: SupplierForm) {
  const individual = f.entityType === 'individual';
  return {
    name: f.name, nameEn: nul(f.nameEn), entityType: f.entityType, supplierKind: f.supplierKind, categoryIds: f.categoryIds, activities: f.activities,
    about: nul(f.about), crNumber: individual ? null : nul(f.crNumber), crExpiry: individual ? null : nul(f.crExpiry), vatNumber: nul(f.vatNumber),
    nationalId: individual ? nul(f.nationalId) : null, city: nul(f.city), address: nul(f.address), phone: nul(f.phone), email: nul(f.email), website: nul(f.website),
    contacts: f.contacts.filter((c) => c.name?.trim()).map((c) => ({ name: c.name, title: nul(c.title), phone: nul(c.phone), email: nul(c.email), authorized: !!c.authorized })),
    branches: f.branches.filter((b) => b.name?.trim()).map((b) => ({ name: b.name, city: nul(b.city), address: nul(b.address), phone: nul(b.phone) })),
  };
}
