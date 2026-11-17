import { api } from '../../api';

export const P = {
  read: 'quality.dashboard.read', context: 'quality.context.manage', documents: 'quality.documents.manage', reviewDocs: 'quality.documents.review',
  approveDocs: 'quality.documents.approve', audits: 'quality.audits.manage', ncr: 'quality.ncr.manage', closeNcr: 'quality.ncr.close',
  risks: 'quality.risks.manage', objectives: 'quality.objectives.manage', reviews: 'quality.reviews.manage', approveReviews: 'quality.reviews.approve',
  feedback: 'quality.feedback.manage', reports: 'quality.reports.read', settings: 'quality.settings.manage',
} as const;

export const fmtDate = (d: string | null | undefined) =>
  d ? new Date(`${d.slice(0, 10)}T00:00:00`).toLocaleDateString('ar-SA-u-ca-gregory', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';
export const num = (n: number | null | undefined, d = 1) => (n === null || n === undefined ? '—' : n.toLocaleString('ar-SA', { maximumFractionDigits: d }));
export const todayStr = () => new Date(Date.now() + 3 * 3600_000).toISOString().slice(0, 10);
export const thisYear = () => Number(todayStr().slice(0, 4));
export const errMsg = (e: unknown) => (e as Error).message;
export const uid = () => Math.random().toString(36).slice(2, 8);

/** ألوان الحالات في كل سجلات الجودة */
export const STATUS_COLOR: Record<string, string> = {
  draft: '#94a3b8', review: '#f59e0b', approval: '#6366f1', approved: '#10b981', obsolete: '#ef4444',
  open: '#ef4444', analysis: '#f97316', action: '#f59e0b', verification: '#6366f1', closed: '#10b981',
  planned: '#6366f1', in_progress: '#f59e0b', completed: '#10b981', cancelled: '#94a3b8',
  received: '#ef4444', investigating: '#f59e0b', resolved: '#0ea5e9', rejected: '#94a3b8',
  treated: '#0ea5e9', achieved: '#10b981', on_track: '#0ea5e9', behind: '#ef4444', no_data: '#94a3b8',
  met: '#10b981', partial: '#f59e0b', gap: '#ef4444', done: '#10b981',
};
export const LEVEL_COLOR: Record<string, string> = { high: '#ef4444', medium: '#f59e0b', low: '#10b981' };
export const RESULT_COLOR: Record<string, string> = { conform: '#10b981', minor: '#f59e0b', major: '#ef4444', observation: '#6366f1', ofi: '#0ea5e9', na: '#94a3b8' };

export const DOC_TYPES = [
  { value: 'manual', label: 'دليل' }, { value: 'policy', label: 'سياسة' }, { value: 'procedure', label: 'إجراء' }, { value: 'instruction', label: 'تعليمات عمل' },
  { value: 'form', label: 'نموذج' }, { value: 'record', label: 'سجل' }, { value: 'plan', label: 'خطة' }, { value: 'external', label: 'وثيقة خارجية' },
];
export const NCR_SOURCES = [
  { value: 'audit', label: 'مراجعة داخلية' }, { value: 'complaint', label: 'شكوى' }, { value: 'process', label: 'متابعة العمليات' }, { value: 'beneficiary', label: 'ملاحظة مستفيد' },
  { value: 'supplier', label: 'مورد أو جهة خارجية' }, { value: 'review', label: 'مراجعة الإدارة' }, { value: 'risk', label: 'خطر تحقق' }, { value: 'other', label: 'أخرى' },
];
export const AUDIT_RESULTS = [
  { value: 'conform', label: 'مطابق' }, { value: 'minor', label: 'عدم مطابقة بسيطة' }, { value: 'major', label: 'عدم مطابقة جسيمة' },
  { value: 'observation', label: 'ملاحظة' }, { value: 'ofi', label: 'فرصة تحسين' }, { value: 'na', label: 'لا ينطبق' },
];
export const TREATMENTS = [
  { value: 'mitigate', label: 'تخفيف' }, { value: 'avoid', label: 'تجنب' }, { value: 'transfer', label: 'نقل' }, { value: 'accept', label: 'قبول' },
  { value: 'exploit', label: 'استغلال (فرصة)' }, { value: 'enhance', label: 'تعزيز (فرصة)' }, { value: 'share', label: 'مشاركة (فرصة)' },
];
export const CHANNELS = [
  { value: 'portal', label: 'بوابة المستفيدين' }, { value: 'phone', label: 'الهاتف' }, { value: 'email', label: 'البريد الإلكتروني' }, { value: 'visit', label: 'زيارة مباشرة' },
  { value: 'social', label: 'وسائل التواصل' }, { value: 'box', label: 'صندوق الشكاوى' }, { value: 'other', label: 'أخرى' },
];
export const PARTIES = [
  { value: 'beneficiary', label: 'مستفيد' }, { value: 'donor', label: 'داعم ومتبرع' }, { value: 'volunteer', label: 'متطوع' }, { value: 'employee', label: 'موظف' },
  { value: 'partner', label: 'شريك' }, { value: 'community', label: 'المجتمع' },
];
export const FREQUENCIES = [{ value: 'monthly', label: 'شهري' }, { value: 'quarterly', label: 'ربع سنوي' }, { value: 'semiannual', label: 'نصف سنوي' }, { value: 'annual', label: 'سنوي' }];
export const OUTPUT_TYPES = [{ value: 'improvement', label: 'فرصة تحسين' }, { value: 'change', label: 'تغيير في النظام' }, { value: 'resources', label: 'احتياج موارد' }];
export const ISO_CLAUSES = ['4.1', '4.2', '4.3', '4.4', '5.1', '5.2', '5.3', '6.1', '6.2', '6.3', '7.1', '7.2', '7.3', '7.4', '7.5', '8.1', '8.2', '8.3', '8.4', '8.5', '8.6', '8.7', '9.1', '9.2', '9.3', '10.1', '10.2', '10.3'];
export const label = (list: { value: string; label: string }[], v: string | null | undefined) => list.find((x) => x.value === v)?.label ?? v ?? '—';

export interface Dept { code: string; name: string }
export interface QSettings {
  prefixes: Record<string, string>; departments: Dept[]; seqDigits: number; reviewMonths: number; complaintDays: number; ncrDays: number;
  docTypes: { value: string; label: string }[]; example: string;
}
let settingsCache: Promise<QSettings> | null = null;
/** إعدادات الجودة (الإدارات والبادئات) تُحمَّل مرة لكل جلسة */
export function loadSettings(force = false) {
  if (!settingsCache || force) settingsCache = api<QSettings>('/quality/settings').catch((e) => { settingsCache = null; throw e; });
  return settingsCache;
}

export interface ActionItem { id?: string; title: string; ownerName: string; dueDate: string | null; status: 'open' | 'done'; doneAt?: string | null; note?: string | null }
export interface DocRow {
  id: string; code: string; title: string; docType: string; typeLabel: string; department: string; departmentName: string; revisionLabel: string; workingRevision: string | null;
  approvedRevision: number | null; status: string; statusLabel: string; ownerName: string | null; isoClauses: string[]; effectiveDate: string | null; nextReviewDate: string | null;
  reviewDue: boolean; reviewOverdue: boolean; copies: number; pendingAck: number; mapId: string | null; source: string; sourceLabel: string; path: string;
}
export interface MapStep { id: string; kind: 'start' | 'task' | 'decision' | 'document' | 'end'; label: string; lane: number; docCode?: string | null; next: { to: string; label?: string | null }[] }
