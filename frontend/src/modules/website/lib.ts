/* eslint-disable @typescript-eslint/no-explicit-any */
export const P = {
  read: 'website.dashboard.read',
  leadsRead: 'website.leads.read',
  leadsManage: 'website.leads.manage',
  bookings: 'website.bookings.manage',
  content: 'website.content.manage',
  guides: 'website.guides.manage',
  settings: 'website.settings.manage',
} as const;

export const SOURCES: Record<string, { l: string; c: string }> = {
  consultation: { l: 'طلب استشارة', c: '#164e38' },
  calculator: { l: 'حاسبة مضاعف الأثر', c: '#8f6a45' },
  assessment: { l: 'تقييم الجاهزية', c: '#2563eb' },
  guide: { l: 'تنزيل دليل', c: '#7c3aed' },
  booking: { l: 'حجز جلسة تشخيص', c: '#c2410c' },
};
export const STATUSES: Record<string, { l: string; c: string }> = {
  new: { l: 'جديد', c: '#c2410c' },
  contacted: { l: 'تم التواصل', c: '#2563eb' },
  qualified: { l: 'مؤهل', c: '#7c3aed' },
  proposal: { l: 'عرض مقدم', c: '#8f6a45' },
  won: { l: 'تم التعاقد', c: '#067647' },
  lost: { l: 'لم يتم', c: '#64748b' },
  spam: { l: 'غير جاد', c: '#94a3b8' },
};
export const BOOKING_STATUSES: Record<string, { l: string; c: string }> = {
  booked: { l: 'محجوز', c: '#c2410c' },
  confirmed: { l: 'مؤكد', c: '#067647' },
  done: { l: 'تمت', c: '#164e38' },
  cancelled: { l: 'ملغى', c: '#94a3b8' },
  no_show: { l: 'لم يحضر', c: '#b42318' },
};
export const DAYS = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];

/** وقت بتوقيت الرياض للعرض */
export function riyadh(iso: string | Date | null | undefined, withDate = true) {
  if (!iso) return '—';
  const d = new Date(iso);
  return new Intl.DateTimeFormat('ar-SA-u-nu-latn-ca-gregory', {
    timeZone: 'Asia/Riyadh', ...(withDate ? { weekday: 'long', year: 'numeric', month: 'short', day: 'numeric' } : {}), hour: '2-digit', minute: '2-digit',
  }).format(d);
}
export function dateOnly(iso: string | Date | null | undefined) {
  if (!iso) return '—';
  return new Intl.DateTimeFormat('ar-SA-u-nu-latn-ca-gregory', { timeZone: 'Asia/Riyadh', year: 'numeric', month: 'short', day: 'numeric' }).format(new Date(iso));
}
export const num = (n: number | null | undefined) => (n === null || n === undefined ? '—' : Math.round(n).toLocaleString('en-US'));

export interface LeadRow {
  id: string; leadNo: number; source: string; status: string; name: string; orgName: string | null; email: string; phone: string | null;
  serviceSlug: string | null; score: number | null; nextActionOn: string | null; createdAt: string; assignedName: string | null; bookingAt: string | null;
}
export type Any = any;
