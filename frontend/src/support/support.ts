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
  waiting_customer: { label: 'بانتظار رد الشركة', tone: 'muted' },
  resolved: { label: 'تم الحل', tone: 'ok' },
  closed: { label: 'مغلق', tone: 'muted' },
};

export const SLA_STATE: Record<string, { label: string; tone: string }> = {
  met: { label: 'ضمن المهلة', tone: 'ok' },
  on_track: { label: 'ضمن المهلة', tone: 'ok' },
  at_risk: { label: 'قاربت على الانتهاء', tone: 'warn' },
  breached: { label: 'تجاوز المهلة', tone: 'bad' },
  paused: { label: 'متوقفة (بانتظار الشركة)', tone: 'muted' },
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
  screen: string | null; createdByName: string; contactPhone: string | null; assigneeId?: string | null; assigneeName: string | null;
  createdAt: string; updatedAt: string; firstResponseAt: string | null; resolvedAt: string | null; closedAt: string | null;
  escalatedAt: string | null; rating: number | null; organization?: { id: string; name: string; slug: string }; sla: TicketSla;
}
export interface TicketDetail extends TicketSummary {
  level: SlaLevel;
  history: { step: string; by: string; at: string; note?: string }[];
  messages: { id: string; side: 'org' | 'platform'; authorName: string; body: string; isInternal: boolean; createdAt: string; file: { name: string; mime: string } | null }[];
  canReopen: boolean;
  tasks?: { id: string; number: string; title: string; status: string; assigneeName: string; dueAt: string; spentHours: number }[];
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

export const TASK_STATUS: Record<string, { label: string; tone: string }> = {
  todo: { label: 'لم تبدأ', tone: 'muted' },
  in_progress: { label: 'قيد التنفيذ', tone: 'info' },
  done: { label: 'منجزة', tone: 'ok' },
  cancelled: { label: 'ملغاة', tone: 'bad' },
};

export const ROLE: Record<string, string> = {
  owner: 'مالك المنصة',
  support_manager: 'مدير الدعم',
  support_agent: 'موظف الدعم',
};

export interface SupportTask {
  id: string; number: string; title: string; description: string; priority: string; status: string;
  assigneeId: string; assigneeName: string; createdByName: string; dueAt: string; estimatedHours: number | null; spentHours: number;
  startedAt: string | null; completedAt: string | null; createdAt: string; overdue: boolean; onTime: boolean | null;
  history: { step: string; by: string; at: string; note?: string; hours?: number }[];
  ticket: { id: string; number: string; subject: string } | null;
}

export interface MemberScore {
  id: string; fullName: string; role: string; responses: number; responseCompliance: number | null; avgResponseHours: number | null;
  resolved: number; resolutionCompliance: number | null; avgResolutionHours: number | null;
  tasksDone: number; tasksOnTime: number; tasksOverdue: number; taskCompliance: number | null; hoursLogged: number;
  avgRating: number | null; ratings: number; score: number | null; grade: string;
}

export const SUPPORT_MANAGE = 'support.manage';
export const scoreTone = (n: number | null) => (n === null ? 'muted' : n >= 90 ? 'ok' : n >= 70 ? 'info' : n >= 60 ? 'warn' : 'bad');
