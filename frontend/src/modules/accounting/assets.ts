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
  insuranceRequired: boolean; insuranceEnd: string | null; warrantyRequired: boolean; warrantyEnd: string | null; nextMaintenance: string | null;
}
export interface Insurance { provider: string; policyNo: string | null; startDate: string; endDate: string; cost: number | null; coverage: number | null; notes: string | null }
export interface Warranty { provider: string; startDate: string | null; endDate: string; notes: string | null }
export interface MaintPlan { intervalMonths: number; nextDate: string; notes: string | null }
export interface MaintRecord {
  id: string; recordNo: number; date: string; kind: 'preventive' | 'repair'; kindLabel: string; description: string; vendor: string | null; cost: number;
  downtimeDays: number; notes: string | null; createdByName: string; voucher: { id: string; serial: number; status: string } | null;
  asset?: { id: string; code: string; name: string; groupName: string };
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
  funding?: { name: string; amount: number; entry: { id: string; entryNo: number; status: string } | null } | null;
  budgetLine?: { id: string; description: string } | null;
  fundingName?: string | null; fundedAmount?: number;
}
export interface AssetDetail extends AssetRow {
  description: string | null; fieldValues: Record<string, string | number | null>; maintenance: Maint[]; salvageValue: number;
  method: string | null; rate: number | null; lifeYears: number | null; analyticId: string | null;
  effective: { method: string; methodLabel: string; rate: number; lifeYears: number | null; monthlyApprox: number };
  group: { id: string; name: string; code: string; fields: FieldDef[]; isTangible: boolean; method: string; rate: number; lifeYears: number | null };
  moves: Move[];
  depreciation: { id: string; runId: string; runNo: number; kind: string; period: string; from: string; to: string; amount: number; accumBefore: number; active: boolean; entryId: string | null; entryNo: number | null }[];
  custody: CustodyForm[]; alerts: Alert[]; createdByName: string; createdAt: string;
  insurance: Insurance | null; warranty: Warranty | null; maintenancePlan: MaintPlan | null; maintenanceLog: MaintRecord[];
  wip: { total: number; pending: number; count: number };
}
export interface Alert { kind: string; label: string; date: string; expired: boolean; assetId?: string; code?: string; name?: string }
export interface Emp { id: string; fullName: string; employeeNo: number; unitId: string | null; status: string }
export interface AssetConfig {
  prefix: string; requireCustody: boolean; alertDays: number; partialMonth: 'days' | 'next_month';
  revaluationAccountId: string | null; impairmentAccountId: string | null; wipAccountId: string | null; grantReleaseAccountId: string | null;
  maintenanceAccountId: string | null; budgetControl: 'warn' | 'block';
  revaluationAccount?: AccRef | null; impairmentAccount?: AccRef | null; wipAccount?: AccRef | null; grantReleaseAccount?: AccRef | null; maintenanceAccount?: AccRef | null;
}
export interface BudgetOption { id: string; description: string; groupId: string; amount: number; remaining: number; year: string; start: string; end: string }
export interface Lookups {
  groups: Group[]; employees: Emp[]; units: { id: string; name: string }[]; analytic: AccRef[]; cash: { id: string; name: string; kind: 'bank' | 'cash' }[];
  partners: { id: string; name: string; accountId: string | null }[]; config: AssetConfig; methods: { value: string; label: string }[];
  years: { id: string; name: number; start: string; end: string }[];
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
  draft: '#64748b', construction: '#d97706', pending_purchase: '#6366f1', active: '#10b981', pending_sale: '#f59e0b', sold: '#0ea5e9', scrapped: '#b91c1c',
};
export const STATUSES = [
  { value: 'books', label: 'في الدفاتر' }, { value: 'active', label: 'في الخدمة' }, { value: 'draft', label: 'مسجل بلا قيمة' }, { value: 'construction', label: 'تحت التنفيذ' },
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

/** ملف محمي بالدخول يُنزَّل باسمه (مثل نموذج الاستيراد) */
export async function downloadFile(path: string, name: string) {
  const t = token.get();
  const res = await fetch(`/api${path}`, { headers: t ? { Authorization: `Bearer ${t}` } : {} });
  if (!res.ok) throw new Error('تعذر تنزيل الملف');
  const url = URL.createObjectURL(await res.blob());
  const el = document.createElement('a');
  el.href = url;
  el.download = name;
  el.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** صورة الأصل محمية بالدخول، فتُحمَّل كملف ثم تُعرض */
export async function imageUrl(assetId: string) {
  const t = token.get();
  const res = await fetch(`/api${AF}/${assetId}/image`, { headers: t ? { Authorization: `Bearer ${t}` } : {} });
  if (!res.ok) return null;
  return URL.createObjectURL(await res.blob());
}
