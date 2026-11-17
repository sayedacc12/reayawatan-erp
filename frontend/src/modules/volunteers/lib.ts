import { ref } from 'vue';
import { api } from '../../api';

export const P = {
  read: 'volunteers.dashboard.read', volunteers: 'volunteers.volunteers.manage', events: 'volunteers.events.manage', approveEvents: 'volunteers.events.approve',
  certificates: 'volunteers.certificates.issue', contracts: 'volunteers.contracts.manage', tickets: 'volunteers.tickets.manage', policy: 'volunteers.policy.manage',
  reports: 'volunteers.reports.read', settings: 'volunteers.settings.manage',
} as const;

export const errMsg = (e: unknown) => (e as Error).message;
export const num = (n: number | null | undefined) => (n ?? 0).toLocaleString('ar-SA', { maximumFractionDigits: 2 });
export const sar = (n: number | null | undefined) => `${num(n)} ر.س`;
export const fmtDate = (d: string | null | undefined) =>
  d ? new Date(`${d.slice(0, 10)}T00:00:00`).toLocaleDateString('ar-SA-u-ca-gregory', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';
export const hijri = (d: string | null | undefined) =>
  d ? new Date(`${d.slice(0, 10)}T00:00:00`).toLocaleDateString('ar-SA-u-ca-islamic-umalqura', { day: 'numeric', month: 'long', year: 'numeric' }) : '';
export const fmtDateTime = (d: string | null | undefined) =>
  d ? new Date(d).toLocaleString('ar-SA-u-ca-gregory', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—';
export const todayStr = () => new Date(Date.now() + 3 * 3600_000).toISOString().slice(0, 10);
export const addDays = (d: string, n: number) => new Date(new Date(`${d}T12:00:00Z`).getTime() + n * 86400000).toISOString().slice(0, 10);
export const MONTHS = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];

export const STATUS_COLOR: Record<string, string> = {
  pending: '#f59e0b', active: '#10b981', inactive: '#94a3b8', rejected: '#ef4444',
  draft: '#94a3b8', in_review: '#f59e0b', returned: '#f97316', approved: '#10b981', closed: '#6366f1', cancelled: '#64748b',
  registered: '#0ea5e9', attended: '#10b981', absent: '#ef4444', issued: '#f59e0b', signed: '#10b981',
  open: '#f59e0b', in_progress: '#0ea5e9',
};
export const VOL_STATUS = [
  { value: 'active', label: 'نشط' }, { value: 'pending', label: 'بانتظار القبول' }, { value: 'inactive', label: 'موقوف' }, { value: 'rejected', label: 'مرفوض' },
];
export const EVENT_STATUS = [
  { value: 'draft', label: 'مسودة' }, { value: 'in_review', label: 'قيد الاعتماد' }, { value: 'returned', label: 'معادة للتعديل' }, { value: 'approved', label: 'معتمدة' },
  { value: 'closed', label: 'مغلقة' }, { value: 'rejected', label: 'مرفوضة' }, { value: 'cancelled', label: 'ملغاة' },
];
export const KIND_LABEL: Record<string, string> = { field: 'ميدانية', online: 'عن بعد' };
export const PART_STATUS: Record<string, string> = { registered: 'مرشح', attended: 'حضر', absent: 'غائب' };
export const CONTRACT_STATUS: Record<string, string> = { issued: 'بانتظار التوقيع', signed: 'موقّع', cancelled: 'ملغى' };
export const TICKET_KINDS = [{ value: 'complaint', label: 'شكوى', color: '#ef4444' }, { value: 'suggestion', label: 'مقترح', color: '#10b981' }, { value: 'inquiry', label: 'استفسار', color: '#0ea5e9' }];
export const AVAILABILITY = ['صباحي', 'مسائي', 'عطلة نهاية الأسبوع', 'عن بعد', 'المواسم فقط'];
export const DECISION_LABEL: Record<string, string> = { submit: 'إرسال للاعتماد', approve: 'اعتماد', return: 'إرجاع للتعديل', reject: 'رفض', close: 'إغلاق بتقرير', cancel: 'إلغاء' };

export type FieldType = 'text' | 'textarea' | 'number' | 'date' | 'select' | 'checkbox';
export interface FormField { key: string; label: string; type: FieldType; required: boolean; options?: string[]; placeholder?: string }
export interface LookupItem { code: string; name: string; description?: string | null; isActive: boolean }
export interface Stage { name: string; roleId: string | null }
export interface Lookups {
  volunteerTypes: LookupItem[]; volunteerFields: LookupItem[]; eventCategories: LookupItem[];
  registrationFields: FormField[]; eventFields: FormField[]; closureFields: FormField[]; stages: Stage[]; publicRegistration: boolean;
}
export interface VolunteerRow {
  id: string; volunteerNo: number; fullName: string; nationalId: string; mobile: string; gender: string; city: string | null; typeCode: string | null; typeName: string | null;
  fields: string[]; status: string; statusLabel: string; source: string; joinedOn: string | null; createdAt: string; hours: number; events: number; contractStatus: string | null;
}
export interface EventRow {
  id: string; eventNo: string; title: string; kind: 'field' | 'online'; kindLabel: string; categoryName: string | null; fields: string[]; location: string | null; platform: string | null;
  startDate: string; endDate: string; startTime: string | null; endTime: string | null; plannedHours: number; volunteersNeeded: number; targetBeneficiaries: number;
  status: string; statusLabel: string; stageName: string | null; stageIndex: number; stagesCount: number; supervisorName: string | null; createdByName: string | null;
  volunteers: number; attended: number; hours: number; responses: number; satisfaction: number | null; canDecide: boolean;
}

/** القوائم المرنة من الإعدادات: تُحمّل مرة وتُشارك بين الشاشات */
export const lookups = ref<Lookups | null>(null);
export async function loadLookups(force = false) {
  if (!lookups.value || force) lookups.value = await api<Lookups>('/volunteers/lookups');
  return lookups.value;
}
export const labelOf = (list: LookupItem[] | undefined, code: string | null | undefined) => list?.find((x) => x.code === code)?.name ?? code ?? '—';
/** الرابط الكامل لصفحة عامة */
export const publicUrl = (path: string) => `${window.location.origin}${path}`;
export async function copy(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
/** تصدير جدول إلى ملف CSV يفتح في Excel */
export function exportCsv(name: string, headers: string[], rows: (string | number | null | undefined)[][]) {
  const esc = (v: string | number | null | undefined) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const csv = '﻿' + [headers, ...rows].map((r) => r.map(esc).join(',')).join('\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  a.download = `${name}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}
