/** أسماء عربية وألوان لحالات الاشتراكات والطلبات والعقود */
export const APPLICATION_STATUS: Record<string, { label: string; tone: string }> = {
  submitted: { label: 'بانتظار المراجعة', tone: 'warn' },
  returned: { label: 'معاد للاستكمال', tone: 'info' },
  approved: { label: 'معتمد', tone: 'ok' },
  rejected: { label: 'مرفوض', tone: 'bad' },
};

export const ORG_STATE: Record<string, { label: string; tone: string }> = {
  trial: { label: 'فترة تجريبية', tone: 'info' },
  trial_expired: { label: 'انتهت التجربة', tone: 'bad' },
  awaiting_contract: { label: 'بانتظار العقد', tone: 'warn' },
  active: { label: 'اشتراك ساري', tone: 'ok' },
  expired: { label: 'اشتراك منتهٍ', tone: 'bad' },
  suspended: { label: 'موقوفة', tone: 'muted' },
};

export const CONTRACT_STATUS: Record<string, { label: string; tone: string }> = {
  draft: { label: 'مسودة', tone: 'muted' },
  sent: { label: 'بانتظار توقيع الجمعية', tone: 'warn' },
  changes_requested: { label: 'طلبت الجمعية تعديلًا', tone: 'info' },
  signed: { label: 'موقّع وساري', tone: 'ok' },
  cancelled: { label: 'ملغى', tone: 'bad' },
};

export const CYCLES: { value: string; label: string; months: number }[] = [
  { value: 'monthly', label: 'شهرية', months: 1 },
  { value: 'quarterly', label: 'ربع سنوية', months: 3 },
  { value: 'semiannual', label: 'نصف سنوية', months: 6 },
  { value: 'annual', label: 'سنوية', months: 12 },
];
export const cycleLabel = (v?: string | null) => CYCLES.find((c) => c.value === v)?.label ?? '—';

export const HISTORY_STEP: Record<string, string> = {
  created: 'إنشاء المسودة', edited: 'تعديل', sent: 'إرسال للجمعية', withdrawn: 'سحب وإعادة للمسودة',
  changes_requested: 'طلب تعديل من الجمعية', signed: 'توقيع إلكتروني', cancelled: 'إلغاء',
  submitted: 'تقديم الطلب', resubmitted: 'إعادة التقديم بعد الاستكمال', returned: 'إعادة للاستكمال',
  rejected: 'رفض', approved: 'اعتماد الطلب',
};

export const money = (n: number | null | undefined) =>
  n === null || n === undefined ? '—' : `${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ر.س`;

export const fmtDate = (d?: string | null) => (d ? new Date(d.length === 10 ? `${d}T12:00:00` : d).toLocaleDateString('ar-SA-u-ca-gregory-nu-latn', { year: 'numeric', month: 'short', day: 'numeric' }) : '—');
export const fmtDateTime = (d?: string | null) => (d ? new Date(d).toLocaleString('ar-SA-u-ca-gregory-nu-latn', { dateStyle: 'medium', timeStyle: 'short' }) : '—');

export const todayIso = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Riyadh' }).format(new Date());
export const addDaysIso = (d: string, n: number) => {
  const x = new Date(`${d}T00:00:00Z`);
  x.setUTCDate(x.getUTCDate() + n);
  return x.toISOString().slice(0, 10);
};

export interface ScreenModule {
  code: string;
  name: string;
  icon: string | null;
  optional: boolean;
  locked: boolean;
  screens: { label: string; path: string }[];
}

/** نسخ نص للحافظة، ويعمل كذلك على الروابط غير الآمنة (http) */
export function copyText(s: string) {
  if (navigator.clipboard && window.isSecureContext) return navigator.clipboard.writeText(s);
  const t = document.createElement('textarea');
  t.value = s;
  t.style.position = 'fixed';
  t.style.opacity = '0';
  document.body.appendChild(t);
  t.select();
  document.execCommand('copy');
  t.remove();
}

/** معرف عشوائي (crypto.randomUUID غير متاح على http) */
export const uid = () => (crypto.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`);
