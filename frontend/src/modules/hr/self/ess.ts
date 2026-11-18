import { reactive } from 'vue';
import { api } from '../../../api';

/** الخدمة الذاتية: حالة مشتركة بين الشاشات (هل المستخدم موظف؟ مدير؟ ووضع العرض) */
export interface EssSummary { linked: boolean; employee: { id: string; fullName: string; employeeNo: number; gender: string } | null; isManager: boolean; team: number; awaiting: number }

const MODE_KEY = 'erp.ess.mode';
const readMode = (): 'employee' | 'manager' => {
  try {
    return localStorage.getItem(MODE_KEY) === 'manager' ? 'manager' : 'employee';
  } catch {
    return 'employee';
  }
};

export const ess = reactive({
  summary: null as EssSummary | null,
  loading: null as Promise<EssSummary | null> | null,
  mode: readMode(),
});

export function setMode(m: 'employee' | 'manager') {
  ess.mode = m;
  try {
    localStorage.setItem(MODE_KEY, m);
  } catch { /* التخزين غير متاح */ }
}

/** يحمّل ملخص الموظف مرة واحدة (force لإعادة التحميل بعد قرار أو طلب) */
export function loadSummary(force = false) {
  if (ess.loading && !force) return ess.loading;
  ess.loading = api<EssSummary>('/hr/me/summary')
    .then((s) => (ess.summary = s))
    .catch(() => (ess.summary = { linked: false, employee: null, isManager: false, team: 0, awaiting: 0 }));
  return ess.loading;
}

export function resetEss() {
  ess.summary = null;
  ess.loading = null;
}

export const KIND_ICON: Record<string, string> = {
  leave: '🌴', permission: '⏱️', exit_reentry: '✈️', letter: '📄', advance: '💳', general: '📝',
};
export const REQ_COLOR: Record<string, string> = {
  pending: '#f59e0b', returned: '#f97316', approved: '#10b981', rejected: '#ef4444', cancelled: '#94a3b8',
};
export const STEP_COLOR: Record<string, string> = {
  waiting: '#94a3b8', approved: '#10b981', returned: '#f97316', rejected: '#ef4444', skipped: '#cbd5e1',
};
export const STEP_LABEL: Record<string, string> = {
  waiting: 'بالانتظار', approved: 'وافق', returned: 'أعاده للتعديل', rejected: 'رفض', skipped: 'تُجووزت',
};

export interface ReqRow {
  id: string; requestNo: number; kind: string; kindLabel: string; typeId: string; typeName: string; summary: string; startDate: string | null;
  status: string; statusLabel: string; currentStep: string | null; currentApprover: string | null; attachments: number; createdAt: string; decidedAt: string | null;
  employeeId: string; employeeName: string | null; employeeNo: number | null;
}
export interface Rules {
  gender: string | null; nationality: string; minServiceMonths: number; allowPastDays: number; minNoticeDays: number; maxFutureDays: number | null;
  maxPerMonth: number | null; maxPerYear: number | null; oneOpen: boolean; attachment: 'none' | 'optional' | 'required'; attachmentHint: string | null;
  maxHoursPerMonth: number | null; maxSalaryMultiple: number | null; maxInstallments: number | null;
}
export interface Field { key: string; label: string; type: string; required: boolean; options?: string[]; hint?: string | null }
export interface ReqType {
  id: string; code: string; name: string; kind: string; kindLabel: string; category: string; description: string | null; color: string;
  fields: Field[]; rules: Rules; leaveTypes: string[]; permissionKinds: { code: string; name: string; maxHours: number | null }[];
  templates: { id: string; name: string; withSalary: boolean; body?: string }[]; leaveOptions?: { code: string; name: string; note: string | null }[];
  approval: { kind: string; name: string; level?: number | null; roleId?: string | null; kindLabel: string; roleName?: string | null }[];
  isActive: boolean; sortOrder: number; requests?: number;
}

export const rel = (iso: string | null | undefined) => {
  if (!iso) return '';
  const d = (Date.now() - new Date(iso).getTime()) / 60000;
  if (d < 1) return 'الآن';
  if (d < 60) return `قبل ${Math.round(d)} دقيقة`;
  if (d < 60 * 24) return `قبل ${Math.round(d / 60)} ساعة`;
  const days = Math.round(d / 1440);
  return days < 30 ? `قبل ${days} يوم` : new Date(iso).toLocaleDateString('ar-SA-u-ca-gregory', { day: 'numeric', month: 'short' });
};
export const isoDay = (n = 0) => new Date(Date.now() + 3 * 3600_000 + n * 86400000).toISOString().slice(0, 10);

/** شرح القيود بلغة بسيطة للموظف قبل التقديم */
export function rulesHints(r: Rules, kind: string) {
  const out: string[] = [];
  if (r.minNoticeDays) out.push(`يُقدَّم قبل ${r.minNoticeDays} يومًا على الأقل من تاريخه`);
  else if (r.allowPastDays) out.push(`يقبل تاريخًا سابقًا حتى ${r.allowPastDays} أيام`);
  else if (['leave', 'permission', 'exit_reentry'].includes(kind)) out.push('لا يقبل تاريخًا سابقًا لليوم');
  if (r.maxFutureDays) out.push(`حتى ${r.maxFutureDays} يومًا من اليوم`);
  if (r.maxPerMonth) out.push(`${r.maxPerMonth} طلبات في الشهر على الأكثر`);
  if (r.maxPerYear) out.push(`${r.maxPerYear} في السنة على الأكثر`);
  if (r.maxHoursPerMonth) out.push(`رصيد ${r.maxHoursPerMonth} ساعات في الشهر`);
  if (r.maxSalaryMultiple) out.push(`الحد الأعلى ${r.maxSalaryMultiple} من إجمالي الراتب`);
  if (r.maxInstallments) out.push(`حتى ${r.maxInstallments} أقساط`);
  if (r.oneOpen) out.push('طلب واحد مفتوح في الوقت نفسه');
  if (r.attachment === 'required') out.push(`مرفق إلزامي${r.attachmentHint ? `: ${r.attachmentHint}` : ''}`);
  return out;
}

export const DAY_COLOR: Record<string, string> = { present: '#10b981', absent: '#ef4444', weekend: '#cbd5e1', holiday: '#a78bfa', leave: '#0ea5e9' };
export const DAY_AR: Record<string, string> = { present: 'حاضر', absent: 'غائب', weekend: 'راحة', holiday: 'عطلة', leave: 'إجازة' };
