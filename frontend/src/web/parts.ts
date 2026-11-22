import { type Service, services } from './site';

/** رقم المجال في دورة العمل (بترتيب الخدمات المنشورة) */
export const svcNo = (s: Service) => services().findIndex((x) => x.slug === s.slug) + 1;

/** حلقة الأوراق حول دوائر الأثر في الصفحة الرئيسية */
export const LEAFP = 'M0 -9 C6 -5 6 5 0 9 C-6 5 -6 -5 0 -9Z';
export function leafRing(r: number, n: number, sc: number) {
  return Array.from({ length: n }, (_, i) => {
    const a = (i / n) * Math.PI * 2 + r;
    const x = (Math.cos(a) * r).toFixed(1);
    const y = (Math.sin(a) * r).toFixed(1);
    return { br: i % 5 === 2, t: `translate(${x} ${y}) rotate(${((a * 180) / Math.PI + 90 + (i % 3) * 25).toFixed(0)}) scale(${sc})` };
  });
}

export const blankVisitor = () => ({ name: '', email: '', orgName: '', phone: '', orgType: '', website: '' });

/** يزيل الحقول الفارغة الاختيارية قبل الإرسال (التحقق في الخادم يرفض النص الفارغ لبعضها) */
export function visitorBody(v: ReturnType<typeof blankVisitor>) {
  const out: Record<string, string> = { name: v.name.trim(), email: v.email.trim() };
  if (v.orgName.trim()) out.orgName = v.orgName.trim();
  if (v.phone.trim()) out.phone = v.phone.trim();
  if (v.orgType) out.orgType = v.orgType;
  if (v.website) out.website = v.website;
  return out;
}

export function setTitle(t?: string) {
  document.title = t ? `${t} · رعاية وطن` : 'رعاية وطن · National Care';
  // الرابط المعتمد لكل صفحة (بلا معاملات الحملات) حتى لا تُعد الصفحات نسخًا مكررة في محركات البحث
  let link = document.querySelector<HTMLLinkElement>('link[rel="canonical"]');
  if (!link) {
    link = document.createElement('link');
    link.rel = 'canonical';
    document.head.appendChild(link);
  }
  link.href = `${location.origin}${location.pathname}`;
}
