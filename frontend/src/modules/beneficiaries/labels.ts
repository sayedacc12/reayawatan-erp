/** الأسماء العربية لقيم الوحدة وألوانها */
type Opt = { value: string; label: string; color?: string };
const toMap = (opts: Opt[]) => Object.fromEntries(opts.map((o) => [o.value, o]));

export const STATUSES: Opt[] = [
  { value: 'new', label: 'جديدة', color: '#0ea5e9' },
  { value: 'under_review', label: 'تحت الدراسة', color: '#f59e0b' },
  { value: 'eligible', label: 'مستحقة', color: '#10b981' },
  { value: 'ineligible', label: 'غير مستحقة', color: '#ef4444' },
  { value: 'suspended', label: 'موقوفة', color: '#94a3b8' },
];
export const CATEGORIES: Opt[] = [
  { value: 'orphan', label: 'أيتام', color: '#14b8a6' },
  { value: 'widow', label: 'أرملة', color: '#8b5cf6' },
  { value: 'elderly', label: 'مسن', color: '#f59e0b' },
  { value: 'disability', label: 'ذوو الهمم', color: '#0ea5e9' },
  { value: 'poor_family', label: 'أسرة محتاجة', color: '#ec4899' },
  { value: 'patient', label: 'مريض', color: '#ef4444' },
  { value: 'student', label: 'طالب علم', color: '#6366f1' },
  { value: 'debtor', label: 'غارم', color: '#a16207' },
  { value: 'other', label: 'أخرى', color: '#64748b' },
];
export const AID_TYPES: Opt[] = [
  { value: 'cash', label: 'نقدية', color: '#10b981' },
  { value: 'in_kind', label: 'عينية', color: '#f59e0b' },
  { value: 'medical', label: 'علاج', color: '#ef4444' },
  { value: 'education', label: 'تعليم', color: '#6366f1' },
  { value: 'housing', label: 'سكن', color: '#0ea5e9' },
  { value: 'seasonal', label: 'موسمية', color: '#ec4899' },
  { value: 'other', label: 'أخرى', color: '#64748b' },
];
export const DECISIONS: Opt[] = [
  { value: 'eligible', label: 'مستحقة', color: '#10b981' },
  { value: 'needs_followup', label: 'تحتاج متابعة', color: '#f59e0b' },
  { value: 'ineligible', label: 'غير مستحقة', color: '#ef4444' },
];
export const GENDERS: Opt[] = [
  { value: 'male', label: 'ذكر' },
  { value: 'female', label: 'أنثى' },
];
export const MARITAL: Opt[] = [
  { value: 'single', label: 'أعزب / عزباء' },
  { value: 'married', label: 'متزوج / متزوجة' },
  { value: 'widowed', label: 'أرمل / أرملة' },
  { value: 'divorced', label: 'مطلق / مطلقة' },
];
export const HOUSING: Opt[] = [
  { value: 'owned', label: 'ملك' },
  { value: 'rented', label: 'إيجار' },
  { value: 'shared', label: 'مشاركة مع أسرة' },
  { value: 'other', label: 'أخرى' },
];
export const DOC_TYPES: Opt[] = [
  { value: 'national_id', label: 'بطاقة الهوية' },
  { value: 'death_certificate', label: 'شهادة وفاة' },
  { value: 'medical_report', label: 'تقرير طبي' },
  { value: 'income_proof', label: 'إثبات دخل' },
  { value: 'lease', label: 'عقد إيجار' },
  { value: 'photo', label: 'صورة' },
  { value: 'other', label: 'أخرى' },
];
export const RELATIONS = ['زوج', 'زوجة', 'ابن', 'ابنة', 'أب', 'أم', 'أخ', 'أخت', 'حفيد', 'حفيدة'];

export const REQUEST_STATUSES: Opt[] = [
  { value: 'in_progress', label: 'قيد المعالجة', color: '#0ea5e9' },
  { value: 'returned', label: 'مُعاد لاستكمال البيانات', color: '#f59e0b' },
  { value: 'approved', label: 'معتمد نهائيًا', color: '#10b981' },
  { value: 'rejected', label: 'مرفوض', color: '#ef4444' },
  { value: 'cancelled', label: 'ملغي', color: '#94a3b8' },
];
export const ACTION_LABELS: Opt[] = [
  { value: 'submitted', label: 'تقديم الطلب', color: '#6366f1' },
  { value: 'approve', label: 'قبول', color: '#10b981' },
  { value: 'reject', label: 'رفض', color: '#ef4444' },
  { value: 'return', label: 'إرجاع', color: '#f59e0b' },
  { value: 'resubmitted', label: 'إعادة تقديم', color: '#6366f1' },
  { value: 'cancelled', label: 'إلغاء', color: '#94a3b8' },
  { value: 'skipped', label: 'تخطي تلقائي', color: '#94a3b8' },
  { value: 'contribution_sent', label: 'رفع إثبات المساهمة', color: '#8b5cf6' },
];
export const OUTCOMES: Opt[] = [
  { value: 'approve', label: 'قبول', color: '#10b981' },
  { value: 'contribution', label: 'قبول بمساهمة من المستفيد', color: '#f59e0b' },
  { value: 'reject', label: 'رفض', color: '#ef4444' },
];
export const RECURRENCES: Opt[] = [
  { value: 'once', label: 'مرة واحدة' },
  { value: 'weekly', label: 'أسبوعي' },
  { value: 'monthly', label: 'شهري' },
  { value: 'quarterly', label: 'كل 3 شهور' },
  { value: 'semiannual', label: 'كل 6 شهور' },
  { value: 'yearly', label: 'سنوي' },
];
export const CONTRIBUTION_STATUSES: Opt[] = [
  { value: 'none', label: 'لا يوجد' },
  { value: 'awaiting', label: 'في انتظار رفع المستفيد', color: '#f59e0b' },
  { value: 'submitted', label: 'مرفوع ومحتاج تحقق', color: '#0ea5e9' },
  { value: 'verified', label: 'تم التحقق', color: '#10b981' },
];
export const TICKET_TYPES: Opt[] = [
  { value: 'complaint', label: 'شكوى', color: '#ef4444' },
  { value: 'suggestion', label: 'اقتراح', color: '#8b5cf6' },
  { value: 'inquiry', label: 'استفسار', color: '#0ea5e9' },
];
export const TICKET_STATUSES: Opt[] = [
  { value: 'open', label: 'جديدة', color: '#f59e0b' },
  { value: 'answered', label: 'تم الرد', color: '#10b981' },
  { value: 'closed', label: 'مغلقة', color: '#94a3b8' },
];
export const FIELD_TYPES: Opt[] = [
  { value: 'text', label: 'نص قصير' },
  { value: 'textarea', label: 'نص طويل' },
  { value: 'number', label: 'رقم' },
  { value: 'date', label: 'تاريخ' },
  { value: 'select', label: 'قائمة اختيارات' },
  { value: 'checkbox', label: 'مربع تأكيد (نعم/لا)' },
  { value: 'support', label: 'تقييم الباحث (مستحق / بنسبة / غير مستحق)' },
];
export const SUPPORT_DECISIONS: Opt[] = [
  { value: 'full', label: 'مستحق', color: '#10b981' },
  { value: 'partial', label: 'مستحق بنسبة', color: '#f59e0b' },
  { value: 'none', label: 'غير مستحق', color: '#ef4444' },
];

const maps = {
  status: toMap(STATUSES), category: toMap(CATEGORIES), aid: toMap(AID_TYPES), decision: toMap(DECISIONS),
  gender: toMap(GENDERS), marital: toMap(MARITAL), housing: toMap(HOUSING), doc: toMap(DOC_TYPES),
  request: toMap(REQUEST_STATUSES), action: toMap(ACTION_LABELS), ticket: toMap(TICKET_TYPES), ticketStatus: toMap(TICKET_STATUSES),
  field: toMap(FIELD_TYPES), outcome: toMap(OUTCOMES), recurrence: toMap(RECURRENCES), contribution: toMap(CONTRIBUTION_STATUSES),
};
export type LabelKind = keyof typeof maps;
export const label = (kind: LabelKind, v?: string | null) => (v ? maps[kind][v]?.label ?? v : '—');
export const color = (kind: LabelKind, v?: string | null) => (v ? maps[kind][v]?.color : undefined) ?? '#64748b';

export const money = (n: number | null | undefined) =>
  (n ?? 0).toLocaleString('ar-EG', { maximumFractionDigits: 2 });
export const fmtDate = (d: string | null | undefined) =>
  d ? new Date(`${d.slice(0, 10)}T00:00:00`).toLocaleDateString('ar-EG', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';
export const age = (birth: string | null | undefined) => {
  if (!birth) return null;
  const b = new Date(birth);
  const n = new Date();
  let a = n.getFullYear() - b.getFullYear();
  if (n.getMonth() < b.getMonth() || (n.getMonth() === b.getMonth() && n.getDate() < b.getDate())) a--;
  return a;
};
export const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

export const fmtDateTime = (d: string | null | undefined) =>
  d ? new Date(d).toLocaleString('ar-EG', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : '—';

/** عرض إجابة حقل نموذج */
export const answer = (type: string, v: unknown) => {
  if (v === undefined || v === null || v === '') return '—';
  if (type === 'checkbox') return v ? 'نعم ✓' : 'لا';
  if (type === 'support') {
    const a = v as { decision?: string; percent?: number };
    if (a.decision === 'partial') return `مستحق بنسبة (الجمعية ${a.percent}% والمستفيد ${Math.round((100 - (a.percent ?? 0)) * 100) / 100}%)`;
    return a.decision === 'full' ? 'مستحق (الجمعية 100%)' : a.decision === 'none' ? 'غير مستحق' : '—';
  }
  if (type === 'date') return fmtDate(String(v));
  if (type === 'number') return Number(v).toLocaleString('ar-EG');
  return String(v);
};

/** نفس حساب السيرفر: مجموع (أهمية البند × درجة الإجابة) ثم القاعدة اللي النتيجة واقعة فيها */
export function scoreOf(form: { fields: { key: string; type: string; weight?: number; options?: string[]; optionScores?: number[] }[]; rules?: { min: number; max: number; outcome: string; contributionPercent?: number }[] }, data: Record<string, unknown>) {
  let score = 0;
  for (const f of form.fields) {
    if (!f.weight) continue;
    let s = 0;
    if (f.type === 'checkbox') s = data[f.key] === true ? 100 : 0;
    else if (f.type === 'select') {
      const i = f.options?.indexOf(String(data[f.key] ?? '')) ?? -1;
      s = i >= 0 ? f.optionScores?.[i] ?? 0 : 0;
    }
    score += (f.weight * s) / 100;
  }
  score = Math.round(score * 100) / 100;
  const rule = (form.rules ?? []).find((r) => score >= r.min && score <= r.max) ?? null;
  return { score, rule };
}
