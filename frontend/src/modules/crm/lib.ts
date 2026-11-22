/* eslint-disable @typescript-eslint/no-explicit-any */
import { ref } from 'vue';
import { api } from '../../api';

export const CR = {
  read: 'crm.records.read', manage: 'crm.records.manage', all: 'crm.records.all', assign: 'crm.leads.assign', merge: 'crm.parties.merge',
  import: 'crm.data.import', reports: 'crm.reports.read', settings: 'crm.settings.manage',
} as const;

export const LEAD_COLOR: Record<string, string> = { new: '#0284c7', contacted: '#7c3aed', qualified: '#d97706', converted: '#059669', disqualified: '#94a3b8' };
export const ROLE_COLOR: Record<string, string> = { customer: '#0369a1', member: '#7c3aed', volunteer: '#059669', partner: '#b45309', lead: '#0891b2' };
export const ACTIVITY_ICON: Record<string, string> = { call: '☎', meeting: '◎', whatsapp: '✆', email: '✉', task: '✓', note: '✎' };
export const CHANNEL_ICON: Record<string, string> = { email: '✉', whatsapp: '✆', sms: '✉︎' };
export const MATCH_LABEL: Record<string, string> = { phone: 'الجوال', email: 'البريد', vat: 'الرقم الضريبي', name: 'الاسم' };

export const fmtDate = (d: string | null | undefined) =>
  d ? new Date(String(d).length <= 10 ? `${d}T00:00:00` : d).toLocaleDateString('ar-SA-u-ca-gregory-nu-latn', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';
export const fmtDateTime = (d: string | null | undefined) =>
  d ? new Date(d).toLocaleString('ar-SA-u-ca-gregory-nu-latn', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : '—';
export const sar = (n: number | null | undefined) => (n === null || n === undefined ? '—' : `${Number(n).toLocaleString('en-US', { maximumFractionDigits: 2 })} ريال`);
/** «منذ 3 ساعات» أو «بعد يومين» */
export function relTime(d: string | null | undefined) {
  if (!d) return '—';
  const diff = new Date(d).getTime() - Date.now();
  const abs = Math.abs(diff);
  const m = Math.round(abs / 60000);
  const h = Math.round(abs / 3600000);
  const days = Math.round(abs / 86400000);
  const v = m < 60 ? `${m} دقيقة` : h < 48 ? `${h} ساعة` : `${days} يوم`;
  return diff < 0 ? `منذ ${v}` : `بعد ${v}`;
}
/** قيمة حقل datetime-local من تاريخ ISO (بتوقيت المتصفح) */
export const toLocalInput = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
export const fromLocalInput = (v: string) => (v ? new Date(v).toISOString() : null);

/** القوائم المرجعية (الإعدادات والفريق والتسميات) مخزنة مرة واحدة في الصفحة */
const cache = ref<any>(null);
export async function lookups(force = false) {
  if (!cache.value || force) cache.value = await api('/crm/lookups');
  return cache.value;
}
export function setLookups(v: any) {
  cache.value = v;
}
export const labelOf = (list: { key: string; label: string }[] | undefined, key: string | null | undefined) => (key ? list?.find((i) => i.key === key)?.label ?? key : '—');
