/** أسماء وألوان مشتركة لطلبات الصيانة ومستويات الخدمة */
export const PRIORITY: Record<string, { label: string; color: string; icon: string }> = {
  very_critical: { label: 'حرج جدًا', color: '#b91c1c', icon: '🔴' },
  critical: { label: 'حرج', color: '#ea580c', icon: '🟠' },
  medium: { label: 'متوسط', color: '#ca8a04', icon: '🟡' },
  normal: { label: 'عادي', color: '#2563eb', icon: '🔵' },
  low: { label: 'منخفض', color: '#64748b', icon: '⚪' },
};
export const PRIORITY_KEYS = Object.keys(PRIORITY);

export const CATEGORY: Record<string, string> = {
  malfunction: 'عطل أو خطأ في النظام', access: 'مشكلة دخول أو صلاحيات', data: 'تصحيح بيانات',
  question: 'استفسار عن الاستخدام', feature: 'طلب تطوير أو ميزة', other: 'أخرى',
};

export const STATUS: Record<string, { label: string; tone: string }> = {
  new: { label: 'جديد', tone: 'warn' },
  in_progress: { label: 'قيد المعالجة', tone: 'info' },
  waiting_customer: { label: 'بانتظار رد الجمعية', tone: 'muted' },
  resolved: { label: 'تم الحل', tone: 'ok' },
  closed: { label: 'مغلق', tone: 'muted' },
};

export const SLA_STATE: Record<string, { label: string; tone: string }> = {
  met: { label: 'ضمن المهلة', tone: 'ok' },
  on_track: { label: 'ضمن المهلة', tone: 'ok' },
  at_risk: { label: 'قاربت على الانتهاء', tone: 'warn' },
  breached: { label: 'تجاوز المهلة', tone: 'bad' },
  paused: { label: 'متوقفة (بانتظار الجمعية)', tone: 'muted' },
};

export interface SlaLevel {
  priority: string; name: string; responseHours: number; resolutionHours: number;
  description: string; examples: string[]; handling: string[]; escalation: string;
}
export interface TicketSla {
  responseDueAt: string; resolutionDueAt: string; response: string; resolution: string; needsEscalation: boolean;
}
export interface TicketSummary {
  id: string; number: string; subject: string; category: string; priority: string; requestedPriority: string; status: string;
  screen: string | null; createdByName: string; contactPhone: string | null; assigneeName: string | null;
  createdAt: string; updatedAt: string; firstResponseAt: string | null; resolvedAt: string | null; closedAt: string | null;
  escalatedAt: string | null; rating: number | null; organization?: { id: string; name: string; slug: string }; sla: TicketSla;
}
export interface TicketDetail extends TicketSummary {
  level: SlaLevel;
  history: { step: string; by: string; at: string; note?: string }[];
  messages: { id: string; side: 'org' | 'platform'; authorName: string; body: string; isInternal: boolean; createdAt: string; file: { name: string; mime: string } | null }[];
  canReopen: boolean;
}

/** المدة بالساعات بصيغة مقروءة */
export function hoursLabel(h: number) {
  if (h < 1) return `${Math.round(h * 60)} دقيقة`;
  if (h < 24) return h === 1 ? 'ساعة' : h === 2 ? 'ساعتان' : `${h} ساعات`;
  const d = Math.round((h / 24) * 10) / 10;
  return d === 1 ? 'يوم' : d === 2 ? 'يومان' : `${d} أيام`;
}

/** الوقت المتبقي أو المتجاوز حتى موعد */
export function remaining(due: string, now = Date.now()) {
  const ms = new Date(due).getTime() - now;
  const abs = Math.abs(ms);
  const m = Math.round(abs / 60000);
  const txt = m < 60 ? `${m} د` : m < 1440 ? `${Math.floor(m / 60)} س ${m % 60} د` : `${Math.floor(m / 1440)} يوم ${Math.floor((m % 1440) / 60)} س`;
  return ms >= 0 ? `متبقٍ ${txt}` : `متأخر ${txt}`;
}

export const fmtDT = (d?: string | null) => (d ? new Date(d).toLocaleString('ar-SA-u-ca-gregory-nu-latn', { dateStyle: 'medium', timeStyle: 'short' }) : '—');

/** وصف أحداث سجل الطلب */
export function historyLabel(h: { step: string; note?: string }) {
  switch (h.step) {
    case 'created': return 'تقديم الطلب';
    case 'status': return `تغيير الحالة إلى: ${STATUS[h.note ?? '']?.label ?? h.note}`;
    case 'priority': return 'تعديل مستوى الخدمة';
    case 'assigned': return `إسناد الطلب إلى ${h.note}`;
    case 'escalated': return 'تصعيد الطلب';
    case 'closed': return 'إغلاق الطلب';
    case 'reopened': return 'إعادة فتح الطلب';
    default: return h.step;
  }
}
/** ملاحظة الحدث تُعرض فقط إن لم تكن جزءًا من الوصف */
export const historyNote = (h: { step: string; note?: string }) => (h.step === 'status' || h.step === 'assigned' ? '' : h.note ?? '');
