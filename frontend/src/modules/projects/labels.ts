/** الأسماء العربية والألوان لقيم نظام إدارة المشاريع */
type Opt = { value: string; label: string; color: string };
const toMap = (o: Opt[]) => Object.fromEntries(o.map((x) => [x.value, x]));

export const FUNDING_TYPES: Opt[] = [
  { value: 'restricted', label: 'مقيد', color: '#0d9488' },
  { value: 'unrestricted', label: 'غير مقيد', color: '#6366f1' },
  { value: 'operational', label: 'تشغيلي', color: '#d97706' },
  { value: 'endowment', label: 'وقف', color: '#7c3aed' },
];
export const DURATIONS: Opt[] = [
  { value: 'annual', label: 'سنوي', color: '#0ea5e9' },
  { value: 'continuous', label: 'مستمر', color: '#10b981' },
];
export const APPROVAL: Opt[] = [
  { value: 'draft', label: 'مسودة', color: '#94a3b8' },
  { value: 'pending', label: 'قيد الاعتماد', color: '#f59e0b' },
  { value: 'returned', label: 'معاد للتعديل', color: '#f97316' },
  { value: 'approved', label: 'معتمد', color: '#10b981' },
  { value: 'rejected', label: 'مرفوض', color: '#ef4444' },
];
export const MODES: Opt[] = [
  { value: 'beneficiaries', label: 'على طلبات المستفيدين', color: '#0ea5e9' },
  { value: 'general', label: 'صرف عام (بفواتير مباشرة)', color: '#a855f7' },
];
export const ALLOC_STATUS: Opt[] = [
  { value: 'reserved', label: 'محجوز', color: '#f59e0b' },
  { value: 'partial', label: 'مصروف جزئيًا', color: '#0ea5e9' },
  { value: 'spent', label: 'مخصوم', color: '#10b981' },
  { value: 'released', label: 'ملغى الحجز', color: '#94a3b8' },
];
export const PAY_STATUS: Opt[] = [
  { value: 'pending', label: 'قيد التنفيذ', color: '#f59e0b' },
  { value: 'paid', label: 'مصروف', color: '#10b981' },
  { value: 'rejected', label: 'مرفوض', color: '#ef4444' },
];
export const METHODS: Opt[] = [
  { value: 'voucher', label: 'سند صرف للمستفيد', color: '#0d9488' },
  { value: 'invoice', label: 'فاتورة مزود خدمة', color: '#6366f1' },
];
export const RESIDENCY: Opt[] = [
  { value: 'citizen', label: 'مواطن', color: '#0d9488' },
  { value: 'resident', label: 'مقيم', color: '#6366f1' },
  { value: 'visitor', label: 'زائر', color: '#d97706' },
];
export const REQUEST_STATUS: Opt[] = [
  { value: 'in_progress', label: 'قيد الإجراء', color: '#f59e0b' },
  { value: 'returned', label: 'معاد للمستفيد', color: '#f97316' },
  { value: 'approved', label: 'معتمد', color: '#10b981' },
  { value: 'rejected', label: 'مرفوض', color: '#ef4444' },
  { value: 'cancelled', label: 'ملغى', color: '#94a3b8' },
];
export const ACTIONS: Record<string, string> = {
  created: 'أنشأ المشروع', submitted: 'أرسله للاعتماد', approved: 'وافق', rejected: 'رفض', returned: 'طلب تعديل', reopened: 'أعاد فتحه للتعديل', edited: 'عدّله',
};

const maps = {
  funding: toMap(FUNDING_TYPES), approval: toMap(APPROVAL), mode: toMap(MODES), alloc: toMap(ALLOC_STATUS),
  pay: toMap(PAY_STATUS), duration: toMap(DURATIONS), method: toMap(METHODS), residency: toMap(RESIDENCY), request: toMap(REQUEST_STATUS),
};
export type Kind = keyof typeof maps;
export const label = (k: Kind, v?: string | null) => (v ? maps[k][v]?.label ?? v : '—');
export const color = (k: Kind, v?: string | null) => (v ? maps[k][v]?.color : undefined) ?? '#64748b';

export const sar = (n: number | null | undefined) => `${(n ?? 0).toLocaleString('ar-SA', { maximumFractionDigits: 2 })} ر.س`;
export const num = (n: number | null | undefined) => (n ?? 0).toLocaleString('ar-SA');
export const fmtDate = (d: string | Date | null | undefined) =>
  d ? new Date(typeof d === 'string' && d.length === 10 ? `${d}T00:00:00` : d).toLocaleDateString('ar-SA-u-ca-gregory', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';
export const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
export const pct = (a: number, b: number) => (b ? Math.round((a / b) * 1000) / 10 : 0);

/** روابط شاشات الأنظمة الأخرى */
export const links = {
  donor: (id: string) => `/fundraising/donors/${id}`,
  opportunity: (id: string) => `/fundraising/opportunities/${id}`,
  receipt: (id: string) => `/fundraising/opportunities/${id}/receipt`,
  batch: (id: string) => `/fundraising/batches/${id}`,
  journal: '/fundraising/journal',
  request: (id: string) => `/beneficiaries/requests/${id}`,
  beneficiary: (id: string) => `/beneficiaries/files/${id}`,
  project: (id: string) => `/projects/${id}`,
  document: (id: string) => `/projects/${id}/document`,
};
