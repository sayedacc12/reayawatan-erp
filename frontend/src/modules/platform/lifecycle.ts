import { token } from '../../api';
import { fmtDate } from './labels';
import { waNumber } from './siteLabels';

/** موعد حذف جمعية (من الخادم) */
export interface DeletionNotice {
  reason: 'trial' | 'trial_expired' | 'mutual';
  trialEndsOn: string | null;
  deleteOn: string;
  daysToTrialEnd: number | null;
  daysToDelete: number;
}

/** «بعد 5 أيام» بصيغة عربية سليمة */
export const inDays = (n: number) => (n <= 0 ? 'اليوم' : n === 1 ? 'غدًا' : n === 2 ? 'بعد يومين' : n <= 10 ? `بعد ${n} أيام` : `بعد ${n} يومًا`);
export const daysLabel = (n: number) => (n === 1 ? 'يوم واحد' : n === 2 ? 'يومان' : n <= 10 ? `${n} أيام` : `${n} يومًا`);

export const NOTICE_REASON: Record<DeletionNotice['reason'], string> = {
  trial: 'فترة تجريبية', trial_expired: 'انتهت التجربة', mutual: 'إنهاء بالتراضي',
};

/** رسالة تذكير جاهزة لمشغل الجمعية بموعد انتهاء التجربة وحذف البيانات */
export function reminderText(orgName: string, n: DeletionNotice) {
  const del = `${fmtDate(n.deleteOn)} (${inDays(n.daysToDelete)})`;
  if (n.reason === 'mutual') {
    return `السلام عليكم،\nتنفيذًا لاتفاق إنهاء العقد بين منصة سنابل و${orgName}، ستُحذف الجمعية وكل بياناتها من المنصة نهائيًا في ${del}.\nإن رغبتم في نسخة من بياناتكم فتواصلوا معنا قبل هذا الموعد.`;
  }
  if (n.reason === 'trial_expired') {
    return `السلام عليكم،\nانتهت الفترة التجريبية لـ${orgName} في منصة سنابل، وتوقف الدخول إلى النظام.\nستُحذف الجمعية وكل بياناتها نهائيًا في ${del} ما لم يتم التعاقد.\nللاشتراك والاحتفاظ ببياناتكم تواصلوا معنا.`;
  }
  return `السلام عليكم،\nنذكّركم بأن الفترة التجريبية لـ${orgName} في منصة سنابل تنتهي في ${fmtDate(n.trialEndsOn)} (${inDays(n.daysToTrialEnd ?? 0)}).\nبعدها يتوقف الدخول، وتُحذف الجمعية وكل بياناتها نهائيًا في ${del} ما لم يتم التعاقد.\nللاشتراك والاحتفاظ ببياناتكم تواصلوا معنا.`;
}
export const reminderWa = (phone: string, text: string) => `https://wa.me/${waNumber(phone)}?text=${encodeURIComponent(text)}`;

/** تنزيل ملف بيانات الجمعية (JSON) قبل الحذف */
export async function downloadExport(orgId: string, slug: string) {
  const res = await fetch(`/api/platform/organizations/${orgId}/export`, { headers: { Authorization: `Bearer ${token.get()}` } });
  if (!res.ok) throw new Error('تعذر تصدير بيانات الجمعية');
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement('a');
  a.href = url;
  a.download = `${slug}-بيانات-الجمعية.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
