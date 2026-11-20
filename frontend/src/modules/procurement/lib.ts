/* eslint-disable @typescript-eslint/no-explicit-any */
import { ref } from 'vue';
import { api } from '../../api';

export const PR = {
  read: 'procurement.dashboard.read', items: 'procurement.items.manage', warehouses: 'procurement.warehouses.manage',
  suppliersRead: 'procurement.suppliers.read', suppliers: 'procurement.suppliers.manage', approveSuppliers: 'procurement.suppliers.approve',
  approveBanks: 'procurement.banks.approve', reports: 'procurement.reports.read', settings: 'procurement.settings.manage',
  requests: 'procurement.requests.create', approveRequests: 'procurement.requests.approve', sourcing: 'procurement.sourcing.manage',
  evaluate: 'procurement.sourcing.evaluate', approveOrders: 'procurement.orders.approve', approveOrdersHigh: 'procurement.orders.approve_high',
  stockOperate: 'procurement.stock.operate', stockApprove: 'procurement.stock.approve', issueRequest: 'procurement.issues.request', issueApprove: 'procurement.issues.approve',
  invoices: 'procurement.invoices.manage', invoicesOverride: 'procurement.invoices.override',
} as const;
/** صلاحيات النظام المالي على مستحقات الموردين */
export const ACC_PAY = { payables: 'accounting.payables.manage', payments: 'accounting.payments.manage' } as const;
export const REQ_READ = [PR.requests, PR.approveRequests, PR.sourcing, PR.approveOrders, PR.approveOrdersHigh];
export const RFQ_READ = [PR.sourcing, PR.evaluate, PR.approveOrders, PR.approveOrdersHigh];
export const ORD_READ = [PR.sourcing, PR.approveOrders, PR.approveOrdersHigh, PR.read, PR.stockOperate, PR.invoices, PR.invoicesOverride];
export const STOCK_READ = [PR.stockOperate, PR.stockApprove, PR.read];
export const ISR_READ = [PR.issueRequest, PR.issueApprove, PR.stockOperate, PR.read];
export const INV_READ = [PR.invoices, PR.invoicesOverride, PR.suppliersRead, PR.reports, ACC_PAY.payables, ACC_PAY.payments];

export const REQ_COLOR: Record<string, string> = {
  draft: '#64748b', submitted: '#d97706', returned: '#db2777', approved: '#0369a1', sourcing: '#7c3aed', ordered: '#059669', closed: '#15803d', rejected: '#dc2626', cancelled: '#94a3b8',
};
export const RFQ_COLOR: Record<string, string> = { draft: '#64748b', published: '#0369a1', opened: '#d97706', recommended: '#7c3aed', awarded: '#059669', cancelled: '#94a3b8' };
export const QUOTE_COLOR: Record<string, string> = { draft: '#64748b', submitted: '#0369a1', withdrawn: '#94a3b8', excluded: '#dc2626' };
export const ORDER_COLOR: Record<string, string> = {
  draft: '#64748b', pending: '#d97706', returned: '#db2777', issued: '#0369a1', acknowledged: '#0891b2', accepted: '#059669', clarification: '#c026d3',
  declined: '#dc2626', cancelled: '#94a3b8', closed: '#15803d', partial: '#ca8a04',
};
export const RECEIPT_COLOR: Record<string, string> = { posted: '#059669', cancelled: '#94a3b8' };
export const RECEIPT_KIND_COLOR: Record<string, string> = { order: '#0369a1', donation: '#be185d', opening: '#64748b' };
export const ISR_COLOR: Record<string, string> = {
  draft: '#64748b', submitted: '#d97706', approved: '#0369a1', partial: '#ca8a04', issued: '#059669', returned: '#db2777', rejected: '#dc2626', cancelled: '#94a3b8',
};
export const DOC_KIND_COLOR: Record<string, string> = { issue: '#0369a1', transfer: '#7c3aed', return_supplier: '#b45309', return_in: '#0891b2', writeoff: '#dc2626' };
export const STOCK_DOC_COLOR: Record<string, string> = { pending: '#d97706', posted: '#059669', cancelled: '#94a3b8' };
export const INVOICE_COLOR: Record<string, string> = {
  draft: '#64748b', submitted: '#d97706', returned: '#db2777', rejected: '#dc2626', approved: '#0369a1', posted: '#7c3aed', partial: '#ca8a04', paid: '#059669', cancelled: '#94a3b8',
};
export const COUNT_COLOR: Record<string, string> = { open: '#0369a1', submitted: '#d97706', approved: '#059669', cancelled: '#94a3b8' };
export const fmtQty = (n: number | null | undefined) => (n === null || n === undefined ? '—' : Number(n).toLocaleString('en-US', { maximumFractionDigits: 3 }));
export const today = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);

/** القوائم المرجعية للمستودعات (الحسابات ومراكز التكلفة والمواقع ومصادر التمويل والتسميات) مرة واحدة في الصفحة */
const stockCache = ref<any>(null);
export async function stockLookups(force = false) {
  if (!stockCache.value || force) stockCache.value = await api('/procurement/stock-lookups');
  return stockCache.value;
}
export const PRIORITY_COLOR: Record<string, string> = { normal: '#64748b', high: '#d97706', urgent: '#dc2626' };

/** من تاريخ ووقت محلي (datetime-local) إلى ISO والعكس */
export const toLocalInput = (iso: string | null | undefined) => {
  if (!iso) return '';
  const d = new Date(iso);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
};
export const fromLocalInput = (v: string) => (v ? new Date(v).toISOString() : null);

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

/** نموذج الفاتورة من بنود التعميد القابلة للفوترة (ومن الفاتورة عند التعديل) */
export function invoiceForm(billable: any, inv?: any) {
  return {
    id: inv?.id ?? null, kind: inv?.kind ?? 'invoice', orderId: billable.order.id, refInvoiceId: inv?.refInvoiceId ?? '', supplierInvoiceNo: inv?.supplierInvoiceNo ?? '',
    invoiceDate: inv?.invoiceDate ?? today(), dueDate: inv?.dueDate ?? '', vatRate: inv?.vatRate ?? billable.order.vatRate, extraAmount: inv?.extraAmount ?? 0, notes: inv?.notes ?? '',
    lines: billable.lines.map((l: any) => {
      const x = inv?.lines?.find((y: any) => y.orderLineId === l.orderLineId);
      return { orderLineId: l.orderLineId, qty: x?.qty ?? 0, unitPrice: x?.unitPrice ?? l.unitPrice };
    }),
  };
}
export const invoicePayload = (f: any) => ({
  kind: f.kind, orderId: f.orderId, refInvoiceId: f.kind === 'credit_note' ? f.refInvoiceId || null : null, supplierInvoiceNo: f.supplierInvoiceNo, invoiceDate: f.invoiceDate,
  dueDate: f.dueDate || null, vatRate: Number(f.vatRate), extraAmount: Number(f.extraAmount || 0), notes: f.notes || null,
  lines: f.lines.filter((l: any) => Number(l.qty) > 0).map((l: any) => ({ orderLineId: l.orderLineId, qty: Number(l.qty), unitPrice: Number(l.unitPrice) })),
});
