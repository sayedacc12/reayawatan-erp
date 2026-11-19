import { ref } from 'vue';
import { api, token } from '../../api';

/** الأصول الثابتة داخل النظام المالي: الأنواع والقوائم المشتركة بين الشاشات */
export const AF = '/accounting/assets';

export interface AccRef { id: string; code: string; name: string }
export interface FieldDef { key: string; label: string; type: 'text' | 'number' | 'date' | 'select'; required?: boolean; options?: string[]; expiry?: boolean }
export interface Group {
  id: string; code: string; name: string; description: string | null; method: string; methodLabel: string; rate: number; lifeYears: number | null; lifeBasis: 'life' | 'rate';
  depreciable: boolean; isTangible: boolean; isActive: boolean; sortOrder: number; fields: FieldDef[];
  assetAccount: AccRef | null; accumAccount: AccRef | null; expenseAccount: AccRef | null; gainLossAccount: AccRef | null; analytic: AccRef | null;
  assets: number; inBooks: number; cost: number; accum: number; nbv: number;
}
export interface AssetRow {
  id: string; assetNo: number; code: string; name: string; groupId: string; groupName: string; status: string; statusLabel: string; serialNumber: string | null;
  location: string | null; unitId: string | null; unitName: string | null; custodianId: string | null; custodianName: string | null; custodianNo: number | null;
  cost: number; accum: number; nbv: number; inServiceDate: string | null; depreciatedThrough: string | null; acquisition: string | null; hasImage: boolean;
  disposedAt: string | null; isTangible: boolean;
}
export interface Maint { id?: string; provider: string; startDate: string; endDate: string; cost: number | null; notes?: string | null }
export interface CustodyForm {
  id: string; formNo: number; kind: string; kindLabel: string; date: string; assetId: string; assetCode: string; assetName: string;
  fromEmployeeId: string | null; fromName: string | null; toEmployeeId: string | null; toName: string | null; fromLocation: string | null; toLocation: string | null;
  condition: string | null; notes: string | null; confirmedAt: string | null; confirmedByName: string | null; createdByName: string; createdAt: string;
}
export interface Move {
  id: string; moveNo: number; kind: string; kindLabel: string; date: string; amount: number; accumDelta?: number; accum?: number; proceeds: number; gainLoss: number;
  method?: string | null; methodLabel?: string | null; status: string; statusLabel?: string; partyName: string | null; notes: string | null; createdByName: string; cancelReason: string | null;
  asset?: { id: string; code: string; name: string; groupName: string };
  voucher: { id: string; kind: string; serial: number; status: string } | null; entry: { id: string; entryNo: number; voucherNo?: string } | null;
  depRun?: { id: string; runNo: number } | null;
}
export interface AssetDetail extends AssetRow {
  description: string | null; fieldValues: Record<string, string | number | null>; maintenance: Maint[]; salvageValue: number;
  method: string | null; rate: number | null; lifeYears: number | null; analyticId: string | null;
  effective: { method: string; methodLabel: string; rate: number; lifeYears: number | null; monthlyApprox: number };
  group: { id: string; name: string; code: string; fields: FieldDef[]; isTangible: boolean; method: string; rate: number; lifeYears: number | null };
  moves: Move[];
  depreciation: { id: string; runId: string; runNo: number; kind: string; period: string; from: string; to: string; amount: number; accumBefore: number; active: boolean; entryId: string | null; entryNo: number | null }[];
  custody: CustodyForm[]; alerts: Alert[]; createdByName: string; createdAt: string;
}
export interface Alert { kind: string; label: string; date: string; expired: boolean; assetId?: string; code?: string; name?: string }
export interface Emp { id: string; fullName: string; employeeNo: number; unitId: string | null; status: string }
export interface AssetConfig { prefix: string; requireCustody: boolean; alertDays: number; partialMonth: 'days' | 'next_month'; donationAccountId: string | null; donationAccount?: AccRef | null }
export interface Lookups {
  groups: Group[]; employees: Emp[]; units: { id: string; name: string }[]; analytic: AccRef[]; cash: { id: string; name: string; kind: 'bank' | 'cash' }[];
  partners: { id: string; name: string; accountId: string | null }[]; config: AssetConfig; methods: { value: string; label: string }[];
}
export interface ReportRow {
  costOpening: number; additions: number; disposals: number; costClosing: number; accumOpening: number; depreciation: number; otherDepreciation: number;
  accumDisposed: number; accumClosing: number; nbv: number;
}
export interface GroupRow extends ReportRow { groupId: string; groupName: string; assets: number }
export interface AssetReportRow extends ReportRow {
  assetId: string; code: string; name: string; groupId: string; groupName: string; status: string; custodianName: string | null; location: string | null;
  inServiceDate: string | null; methodLabel: string; rate: number; lifeYears: number | null; salvage: number; purchaseCost: number;
  from: string | null; to: string | null; catchUp: boolean; months: { month: string; from: string; to: string; amount: number; fraction: number }[];
  lastDepreciated: string | null; note: string | null;
}
export interface DepReport { period: string; toDate: string; groups: GroupRow[]; assets: AssetReportRow[]; totals: ReportRow; total: number; assetCount: number }
export interface Run {
  id: string; runNo: number; kind: 'period' | 'disposal'; kindLabel: string; period: string; toDate: string; scope: { label: string; assetIds: string[]; groupIds: string[] };
  total: number; assetCount: number; status: 'posted' | 'cancelled'; statusLabel: string; createdByName: string; createdAt: string;
  cancelledAt: string | null; cancelledByName: string | null; cancelReason: string | null; entry: { id: string; entryNo: number; voucherNo: string } | null; cancelBlock: string | null;
}
export interface Recon {
  asOf: string; ok: boolean; issues: number;
  accounts: { accountId: string; code: string; name: string; kind: string; kindLabel: string; groups: string[]; gl: number; subledger: number; diff: number; ok: boolean; problems: string[];
    foreignEntries: { id: string; entryNo: number; date: string; description: string; amount: number }[] }[];
  groups: { groupId: string; name: string; ok: boolean; problems: string[] }[];
}

export const STATUS_COLOR: Record<string, string> = {
  draft: '#64748b', pending_purchase: '#6366f1', active: '#10b981', pending_sale: '#f59e0b', sold: '#0ea5e9', scrapped: '#b91c1c',
};
export const STATUSES = [
  { value: 'books', label: 'في الدفاتر' }, { value: 'active', label: 'في الخدمة' }, { value: 'draft', label: 'مسجل بلا قيمة' },
  { value: 'pending_purchase', label: 'ينتظر اعتماد الشراء' }, { value: 'pending_sale', label: 'ينتظر اعتماد البيع' }, { value: 'disposed', label: 'مستبعد (مباع أو مخرد)' },
];
export const FIELD_TYPES = [{ value: 'text', label: 'نص' }, { value: 'number', label: 'رقم' }, { value: 'date', label: 'تاريخ' }, { value: 'select', label: 'قائمة اختيار' }];
export const CONDITIONS = ['جديد', 'جيد', 'مقبول', 'يحتاج صيانة', 'تالف'];

const lk = ref<Lookups | null>(null);
let lkLoading: Promise<Lookups> | null = null;
/** القوائم المشتركة (المجموعات والموظفون والوحدات والبنوك والشركاء)، وتُحدَّث بعد أي تعديل */
export function useLookups() {
  const load = (force = false) => {
    if (!lkLoading || force) lkLoading = api<Lookups>(`${AF}/lookups`).then((r) => (lk.value = r)).catch((e) => { lkLoading = null; throw e; });
    return lkLoading;
  };
  return { lookups: lk, load };
}

export const ym = (d = new Date(Date.now() + 3 * 3600_000)) => d.toISOString().slice(0, 7);
export const prevMonth = () => {
  const d = new Date(Date.now() + 3 * 3600_000);
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() - 1);
  return ym(d);
};

/** صورة الأصل محمية بالدخول، فتُحمَّل كملف ثم تُعرض */
export async function imageUrl(assetId: string) {
  const t = token.get();
  const res = await fetch(`/api${AF}/${assetId}/image`, { headers: t ? { Authorization: `Bearer ${t}` } : {} });
  if (!res.ok) return null;
  return URL.createObjectURL(await res.blob());
}
