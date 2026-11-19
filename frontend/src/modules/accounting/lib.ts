import { computed, ref } from 'vue';
import { api } from '../../api';
import type { SelectOption } from '../fundraising/components/SearchSelect.vue';

export const P = {
  read: 'accounting.dashboard.read', setup: 'accounting.setup.manage', accounts: 'accounting.accounts.manage', partners: 'accounting.partners.manage',
  banks: 'accounting.banks.manage', warehouses: 'accounting.warehouses.manage', receipts: 'accounting.receipts.manage', payments: 'accounting.payments.manage',
  approveVouchers: 'accounting.vouchers.approve', entries: 'accounting.entries.manage', post: 'accounting.entries.post', unpost: 'accounting.entries.unpost',
  cancel: 'accounting.entries.cancel', approveReceiptCancel: 'accounting.receipts.cancel_approve', closePeriods: 'accounting.periods.close',
  reopenPeriods: 'accounting.periods.reopen', reports: 'accounting.reports.read', settings: 'accounting.settings.manage',
  assetsRead: 'accounting.assets.read', assetsManage: 'accounting.assets.manage', assetsOperate: 'accounting.assets.operate',
  assetsDepreciate: 'accounting.assets.depreciate', assetsReverse: 'accounting.assets.reverse', assetsCustody: 'accounting.assets.custody',
} as const;

export interface Account {
  id: string; code: string; name: string; kind: 'root' | 'main' | 'sub'; kindLabel: string; nature: string; natureLabel: string;
  parentId: string | null; level: number; requiresAnalytic: boolean; description: string | null; isActive: boolean; moves: number; balance: number; children: number;
}
export interface Analytic { id: string; code: string; name: string; kind: 'main' | 'sub'; parentId: string | null; level: number; description: string | null; isActive: boolean; moves: number; children: number }
export interface CashAccount { id: string; kind: 'bank' | 'cash'; name: string; bankName: string | null; accountNumber: string | null; iban: string | null; description: string | null; isActive: boolean; glAccount: { id: string; code: string; name: string } | null; balance: number }
export interface Partner {
  id: string; code: string; name: string; categoryId: string; categoryName: string; behavior: 'customer' | 'supplier' | 'other'; description: string | null;
  phones: string[]; emails: string[]; addresses: { label: string; address: string; city?: string | null }[]; taxNumber: string | null; crNumber: string | null;
  creditLimit: number | null; isActive: boolean; account: { id: string; code: string; name: string } | null; balance: number; overLimit: boolean;
}

export const NATURES = [
  { value: 'assets', label: 'الأصول', color: '#0ea5e9' },
  { value: 'liabilities', label: 'الالتزامات', color: '#f59e0b' },
  { value: 'net_assets', label: 'صافي الأصول', color: '#8b5cf6' },
  { value: 'revenue', label: 'الإيرادات والتبرعات', color: '#10b981' },
  { value: 'expenses', label: 'المصروفات', color: '#ef4444' },
];
export const natureColor = (n: string) => NATURES.find((x) => x.value === n)?.color ?? '#64748b';
export const KINDS = [{ value: 'root', label: 'رئيسي (جذر)' }, { value: 'main', label: 'رئيسي' }, { value: 'sub', label: 'فرعي' }];
export const VOUCHER_TYPES = [
  { value: 'journal', label: 'قيد يومية' }, { value: 'receipt', label: 'سند قبض' }, { value: 'payment', label: 'سند صرف' },
  { value: 'opening', label: 'قيد افتتاحي' }, { value: 'adjustment', label: 'قيد تسوية' },
  { value: 'depreciation', label: 'سند إهلاك' }, { value: 'asset', label: 'سند أصول ثابتة' },
];
/** سندات تصدر من الأصول الثابتة فقط، ولا تُنشأ أو تُعدَّل أو تُلغى من النظام المالي */
export const ASSET_TYPES = ['depreciation', 'asset'];
export const ENTRY_STATUS: Record<string, { label: string; color: string }> = {
  draft: { label: 'غير مرحّل', color: '#f59e0b' }, posted: { label: 'مرحّل', color: '#10b981' }, cancelled: { label: 'ملغي', color: '#ef4444' },
};
export const VOUCHER_STATUS: Record<string, { label: string; color: string }> = {
  draft: { label: 'مسودة', color: '#64748b' }, pending: { label: 'قيد الاعتماد', color: '#6366f1' }, returned: { label: 'معاد للتعديل', color: '#f59e0b' },
  approved: { label: 'معتمد ومرحّل', color: '#10b981' }, rejected: { label: 'مرفوض', color: '#ef4444' }, cancelled: { label: 'ملغي', color: '#b91c1c' },
};
export const METHODS = [
  { value: 'cash', label: 'نقدًا' }, { value: 'transfer', label: 'حوالة بنكية' }, { value: 'cheque', label: 'شيك' }, { value: 'card', label: 'شبكة / بطاقة' },
];
export const METHOD_LABELS: Record<string, string> = { cash: 'نقدًا', transfer: 'حوالة بنكية', cheque: 'شيك', card: 'شبكة / بطاقة', credit: 'آجل' };

const nf = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const money = (v: number | null | undefined) => nf.format(Number(v ?? 0));
export const sar = (v: number | null | undefined) => `${money(v)} ر.س`;
/** رصيد بطبيعته: مدين أو دائن */
export const dc = (v: number) => (v === 0 ? '0.00' : `${money(Math.abs(v))} ${v > 0 ? 'مدين' : 'دائن'}`);
export const todayStr = () => new Date(Date.now() + 3 * 3600_000).toISOString().slice(0, 10);
const MONTHS = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];
export const monthName = (m: string) => `${MONTHS[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}`;
export const shortMonth = (m: string) => MONTHS[Number(m.slice(5, 7)) - 1];
export const dt = (v: string | null | undefined) => (v ? new Date(v).toLocaleString('ar-SA-u-nu-latn', { dateStyle: 'medium', timeStyle: 'short' }) : '');

/** قوائم مشتركة تُحمَّل مرة واحدة في الشاشة */
export function useAccounts() {
  const accounts = ref<Account[]>([]);
  const postingLevel = ref<number | null>(null);
  const chartInstalledAt = ref<string | null>(null);
  async function load() {
    const r = await api<{ accounts: Account[]; postingLevel: number | null; chartInstalledAt: string | null }>('/accounting/accounts');
    accounts.value = r.accounts;
    postingLevel.value = r.postingLevel;
    chartInstalledAt.value = r.chartInstalledAt;
  }
  const subOptions = (filter?: (a: Account) => boolean): SelectOption[] => accounts.value
    .filter((a) => a.kind === 'sub' && a.isActive && (!filter || filter(a)))
    .map((a) => ({ id: a.id, label: `${a.code} ${a.name}`, sub: a.natureLabel }));
  return { accounts, postingLevel, chartInstalledAt, load, subOptions };
}

export async function loadAnalytic() {
  const r = await api<{ levels: number; accounts: Analytic[] }>('/accounting/analytic');
  return r;
}

// ---------------- أنواع السندات الخاصة بالجمعية ----------------

export interface DocType { id: string; code: string; name: string; description: string | null; isActive: boolean; sortOrder: number; entries: number }
/** قائمة مشتركة بين الشاشات والقائمة الجانبية، وتُحدَّث بعد أي تعديل في الإعدادات */
export const docTypes = ref<DocType[]>([]);
let docTypesLoaded: Promise<void> | null = null;
export function loadDocTypes(force = false) {
  if (!docTypesLoaded || force) {
    docTypesLoaded = api<DocType[]>('/accounting/document-types').then((r) => { docTypes.value = r; }).catch(() => { docTypesLoaded = null; });
  }
  return docTypesLoaded;
}
/** كل أنواع المستندات: الأساسية ثم الخاصة بالجمعية */
export const allTypes = computed(() => [...VOUCHER_TYPES, ...docTypes.value.map((d) => ({ value: d.code, label: d.name }))]);
export const typeLabel = (code: string) => allTypes.value.find((t) => t.value === code)?.label ?? code;
