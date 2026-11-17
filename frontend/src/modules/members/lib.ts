import { ref } from 'vue';
import { api } from '../../api';

export const P = {
  read: 'members.dashboard.read', applications: 'members.applications.manage', approve: 'members.applications.approve', members: 'members.members.manage',
  payments: 'members.payments.manage', reports: 'members.reports.read', settings: 'members.settings.manage',
} as const;

export const num = (n: number | null | undefined) => (n ?? 0).toLocaleString('ar-SA', { maximumFractionDigits: 2 });
export const sar = (n: number | null | undefined) => `${num(n)} ر.س`;
export const fmtDate = (d: string | null | undefined) =>
  d ? new Date(`${d.slice(0, 10)}T00:00:00`).toLocaleDateString('ar-SA-u-ca-gregory', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';
export const hijri = (d: string | null | undefined) =>
  d ? new Date(`${d.slice(0, 10)}T00:00:00`).toLocaleDateString('ar-SA-u-ca-islamic-umalqura', { day: 'numeric', month: 'long', year: 'numeric' }) : '';
export const fmtDateTime = (d: string | null | undefined) =>
  d ? new Date(d).toLocaleString('ar-SA-u-ca-gregory', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—';
export const todayStr = () => new Date(Date.now() + 3 * 3600_000).toISOString().slice(0, 10);
export const MONTHS = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];

export const STATUS_COLOR: Record<string, string> = {
  active: '#10b981', expiring: '#f59e0b', grace: '#f97316', expired: '#ef4444', suspended: '#64748b', terminated: '#334155',
  in_review: '#f59e0b', returned: '#f97316', rejected: '#ef4444', awaiting_payment: '#0ea5e9', completed: '#10b981', cancelled: '#94a3b8',
  unpaid: '#f59e0b', review: '#0ea5e9', paid: '#10b981', draft: '#94a3b8', pending: '#f59e0b', approved: '#10b981',
};
export const MEMBER_STATUS = [
  { value: 'current', label: 'سارية (كلها)' }, { value: 'active', label: 'سارية' }, { value: 'expiring', label: 'تنتهي قريبًا' }, { value: 'grace', label: 'في مهلة السماح' },
  { value: 'expired', label: 'منتهية' }, { value: 'suspended', label: 'موقوفة' }, { value: 'terminated', label: 'منتهية بقرار' },
];
export const APP_STATUS = [
  { value: 'open', label: 'المفتوحة' }, { value: 'in_review', label: 'قيد الاعتماد' }, { value: 'returned', label: 'معادة لاستكمال البيانات' },
  { value: 'awaiting_payment', label: 'بانتظار السداد' }, { value: 'completed', label: 'مكتملة' }, { value: 'rejected', label: 'مرفوضة' }, { value: 'cancelled', label: 'ملغاة' },
];
export const INVOICE_STATUS = [
  { value: 'unpaid', label: 'بانتظار السداد' }, { value: 'review', label: 'تحويل بانتظار التأكيد' }, { value: 'paid', label: 'مسددة' }, { value: 'cancelled', label: 'ملغاة' },
];
export const VOUCHER_STATUS: Record<string, string> = { draft: 'مسودة', pending: 'قيد الاعتماد', returned: 'معاد', approved: 'معتمد', rejected: 'مرفوض', cancelled: 'ملغى' };
export const DECISION_LABEL: Record<string, string> = { submit: 'تقديم الطلب', resubmit: 'إعادة التقديم', approve: 'اعتماد', return: 'إرجاع لاستكمال البيانات', reject: 'رفض', cancel: 'إلغاء' };
export const CHANNELS: Record<string, string> = { whatsapp: 'واتساب', sms: 'رسالة نصية', email: 'بريد إلكتروني', call: 'اتصال', auto: 'تلقائي' };
export const HISTORY_LABEL: Record<string, string> = {
  join: 'الانضمام', rejoin: 'إعادة العضوية', renew: 'تجديد', direct: 'إضافة عضو قائم', type: 'تغيير النوع', update: 'تعديل البيانات', document: 'رفع مستند',
  active: 'إعادة التفعيل', suspended: 'إيقاف', terminated: 'إنهاء العضوية',
};

export type FieldType = 'text' | 'textarea' | 'number' | 'date' | 'select' | 'checkbox';
export interface FormField { key: string; label: string; type: FieldType; required: boolean; options?: string[]; placeholder?: string }
export interface MembershipType {
  code: string; name: string; description: string | null; fee: number; joiningFee: number; durationMonths: number; votingRights: boolean; votingAfterDays: number;
  minAge: number | null; saudiOnly: boolean; publicApply: boolean; benefits: string | null; revenueAccountId: string | null; color: string; isActive: boolean;
}
export interface Condition { key: string; text: string; reference: string | null; isActive: boolean }
export interface DocReq { key: string; name: string; required: boolean; isActive: boolean }
export interface Lookups {
  types: MembershipType[]; conditions: Condition[]; applicationFields: FormField[]; documents: DocReq[]; stages: { name: string; roleId: string | null }[];
  nationalities: string[]; publicEnabled: boolean; payment: { online: boolean; transfer: boolean; cash: boolean; provider: string };
  renewal: { reminderDays: number[]; graceDays: number; message: string }; card: { title: string; signatoryName: string; signatoryTitle: string; note: string };
  regulation: { title: string; sections: { title: string; body: string }[]; version: number; effectiveDate: string | null };
}
export interface MemberRow {
  id: string; memberNo: number; fullName: string; nationalId: string; mobile: string; email: string | null; gender: string; nationality: string; city: string | null;
  typeCode: string; typeName: string; typeColor: string; status: string; statusLabel: string; joinedOn: string; startDate: string; endDate: string; daysLeft: number;
  voting: boolean; votingNote: string | null; source: string; occupation: string | null;
}

export const lookups = ref<Lookups | null>(null);
export async function loadLookups(force = false) {
  if (!lookups.value || force) lookups.value = await api<Lookups>('/members/lookups');
  return lookups.value;
}
export const publicUrl = (path: string) => `${window.location.origin}${path}`;
export async function copy(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
/** رابط واتساب برسالة جاهزة (الجوال السعودي بصيغة دولية) */
export function whatsappLink(mobile: string, text: string) {
  const intl = mobile.replace(/^\+/, '').replace(/^05/, '9665');
  return `https://wa.me/${intl}?text=${encodeURIComponent(text)}`;
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
/** نص مدة العضوية */
export const durationLabel = (m: number) => (m === 12 ? 'سنويًا' : m === 6 ? 'كل ستة أشهر' : m === 24 ? 'كل سنتين' : `كل ${m} شهرًا`);
/** البيانات كنص JSON في الحقل data، والمستندات ملفات بأسماء مفاتيحها */
export function toFormData(data: Record<string, unknown>, files: Record<string, File>) {
  const fd = new FormData();
  fd.append('data', JSON.stringify(data));
  Object.entries(files).forEach(([k, f]) => fd.append(k, f));
  return fd;
}

/** بيانات بطاقة العضوية */
export interface CardData {
  orgName: string; title: string; memberNo: number; fullName: string; typeName: string; typeColor: string; joinedOn: string; endDate: string;
  statusLabel: string; valid: boolean; voting: boolean; cardCode: string; signatoryName?: string; signatoryTitle?: string; note?: string; nationalId?: string;
}
