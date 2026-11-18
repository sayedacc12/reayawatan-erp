import { api } from '../../api';

export const P = {
  read: 'comms.dashboard.read', create: 'comms.transactions.create', registry: 'comms.registry.read', registryMedium: 'comms.registry.medium',
  decisions: 'comms.decisions.issue', financial: 'comms.financial.close', tasks: 'comms.tasks.assign', tasksAll: 'comms.tasks.read_all',
  reports: 'comms.reports.read', settings: 'comms.settings.manage',
} as const;

export const CONF = [
  { value: 'normal', label: 'عادية', hint: 'يراها أطرافها ومتابعوها ومن يملك سجل المعاملات' },
  { value: 'medium', label: 'متوسطة السرية', hint: 'لأطرافها ومتابعيها ومن يملك صلاحية متوسطة السرية' },
  { value: 'confidential', label: 'سرية', hint: 'للموجهة لهم ومتابعيها المسمَّين فقط' },
  { value: 'top_secret', label: 'عالية السرية', hint: 'للموجهة لهم فقط، بلا متابعين' },
] as const;
export const CONF_COLOR: Record<string, string> = { normal: '#64748b', medium: '#0ea5e9', confidential: '#f59e0b', top_secret: '#dc2626' };
export const PRIORITIES = [{ value: 'normal', label: 'عادية' }, { value: 'urgent', label: 'عاجلة' }, { value: 'very_urgent', label: 'عاجلة جدًا' }];
export const PRIORITY_COLOR: Record<string, string> = { normal: '#64748b', urgent: '#f97316', very_urgent: '#dc2626' };
export const PURPOSES = [
  { value: 'action', label: 'للتنفيذ' }, { value: 'opinion', label: 'لإبداء الرأي' }, { value: 'approve', label: 'للاعتماد' }, { value: 'sign', label: 'للتوقيع' }, { value: 'info', label: 'للاطلاع' },
];
export const STATUS_COLOR: Record<string, string> = {
  draft: '#94a3b8', open: '#0ea5e9', closed: '#10b981', archived: '#64748b', issued: '#8b5cf6', cancelled: '#94a3b8', in_progress: '#0ea5e9', done: '#10b981',
};
export const MOVE_AR: Record<string, string> = {
  create: 'أنشأ المعاملة', refer: 'أحال', return: 'أعاد المعاملة إلى', note: 'إفادة', followers: 'حدّث المتابعين', ack: 'اطلع', issue: 'أصدر', done: 'أنجز المعاملة',
  archive: 'حفظ المعاملة', voucher: 'أنهى المعاملة بسند', reopen: 'أعاد فتح المعاملة', cancel: 'ألغى المعاملة', attach: 'أرفق', task: 'أسند مهمة إلى',
};
export const TASK_LOG_AR: Record<string, string> = {
  create: 'أُنشئت المهمة', note: 'ملاحظة', support: 'ملاحظة مساند', progress: 'تحديث الإنجاز', complete: 'أُنجزت', reopen: 'أُعيد فتحها', cancel: 'أُلغيت',
  extend: 'مُدد الموعد', reassign: 'أُعيد الإسناد', supporters: 'المساندون',
};

export interface Person { id: string; fullName: string; unitId: string | null; unitName: string | null; jobTitle: string | null }
export interface Unit { id: string; parentId: string | null; level: number; name: string; managerUserId: string | null; managerName: string | null }
export interface Lookups {
  people: Person[]; units: Unit[]; categories: { code: string; name: string; kind: 'admin' | 'financial'; dueDays: number }[];
  can: { create: boolean; decisions: boolean; financial: boolean; tasks: boolean; tasksAll: boolean; registry: boolean };
}
export interface TxnRow {
  id: string; refNo: string; docType: string; docLabel: string; kind: string; kindLabel: string; direction: string; directionLabel: string; externalParty: string | null;
  categoryName: string | null; subject: string; confidentiality: string; confidentialityLabel: string; priority: string; priorityLabel: string; financialType: string | null;
  amount: number | null; status: string; statusLabel: string; createdByName: string; originUnitName: string | null; holderUserId: string | null; holderName: string | null;
  holderUnitName: string | null; holderPurpose: string | null; holderPurposeLabel: string | null; holderSince: string | null; dueDate: string | null; overdue: boolean;
  isHolder: boolean; isFollower: boolean; unread: boolean; recipientsCount: number; readCount: number; voucherSerial: number | null; closeKind: string | null;
  createdAt: string; updatedAt: string; issuedAt: string | null;
}
export interface TaskRow {
  id: string; refNo: string; title: string; description: string | null; ownerUserId: string; ownerName: string; ownerUnitName: string | null;
  supporters: { userId: string; name: string; unitName?: string | null }[]; assignedById: string; assignedByName: string; priority: string; priorityLabel: string;
  startDate: string; dueDate: string; originalDueDate: string; extended: boolean; status: string; statusLabel: string; overdue: boolean; daysLeft: number | null;
  progress: number; sourceType: string; sourceLabel: string; sourceRef: string | null; sourceLink: string | null; isConfidential: boolean; completionNote: string | null;
  completedAt: string | null; createdAt: string; myRole: 'owner' | 'supporter' | 'assigner' | 'viewer';
}

let cached: Promise<Lookups> | null = null;
export function loadLookups(force = false) {
  if (!cached || force) cached = api<Lookups>('/comms/lookups').catch((e) => { cached = null; throw e; });
  return cached;
}

export function unitOptions(units: Unit[]) {
  const out: { id: string; label: string; manager: string | null }[] = [];
  const walk = (parent: string | null, depth: number) => {
    for (const u of units.filter((x) => x.parentId === parent)) {
      out.push({ id: u.id, label: `${'— '.repeat(depth)}${u.name}`, manager: u.managerName });
      walk(u.id, depth + 1);
    }
  };
  walk(null, 0);
  for (const u of units) if (!out.some((o) => o.id === u.id)) out.push({ id: u.id, label: u.name, manager: u.managerName });
  return out;
}

export const fmtDate = (d: string | null | undefined) =>
  d ? new Date(`${String(d).slice(0, 10)}T00:00:00`).toLocaleDateString('ar-SA-u-ca-gregory', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';
export const fmtDateTime = (d: string | Date | null | undefined) =>
  d ? new Date(d).toLocaleString('ar-SA-u-ca-gregory', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—';
export const money = (n: number | null | undefined) => (n === null || n === undefined ? '—' : `${Number(n).toLocaleString('en-US', { maximumFractionDigits: 2 })} ريال`);
export const todayStr = () => new Date(Date.now() + 3 * 3600_000).toISOString().slice(0, 10);
export const addDays = (d: string, n: number) => new Date(new Date(`${d}T00:00:00Z`).getTime() + n * 86400000).toISOString().slice(0, 10);
export const dueText = (daysLeft: number | null) => (daysLeft === null ? '' : daysLeft < 0 ? `متأخرة ${-daysLeft} يوم` : daysLeft === 0 ? 'موعدها اليوم' : `باقي ${daysLeft} يوم`);
