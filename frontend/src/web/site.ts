/* eslint-disable @typescript-eslint/no-explicit-any */
import { reactive } from 'vue';

/** بيانات الموقع العام من النظام (المحتوى والخدمات والأدلة) — تُحمَّل مرة واحدة لكل زيارة */
export interface Service {
  slug: string; title: string; stage: string; icon: string; short: string; intro: string; value: string;
  deliverables: { title: string; desc: string }[]; audience: string[]; steps: { title: string; desc: string }[];
  shifts: { from: string; to: string }[]; kpis: string[]; featured: boolean;
}
export interface SiteData {
  company: { name: string };
  content: Record<string, any>;
  services: Service[];
  guides: { slug: string; title: string; summary: string; serviceSlug: string | null; pages: number | null; hasCover: boolean }[];
}

export const site = reactive<{ data: SiteData | null; error: string; loading: boolean }>({ data: null, error: '', loading: false });

let pending: Promise<void> | null = null;
export function loadSite(force = false) {
  if (pending && !force) return pending;
  site.loading = true;
  pending = fetch('/api/public/web')
    .then(async (r) => {
      if (!r.ok) throw new Error('تعذر تحميل الموقع، حاولوا بعد قليل');
      site.data = await r.json();
      site.error = '';
    })
    .catch((e) => { site.error = (e as Error).message; pending = null; })
    .finally(() => { site.loading = false; });
  return pending;
}

export const C = () => site.data?.content ?? {};
export const services = () => site.data?.services ?? [];
export const bySlug = (slug: string) => services().find((s) => s.slug === slug);

/** أرقام عربية مشرقية للعرض */
export const AR = (n: number | string) => String(n).replace(/\d/g, (d) => '٠١٢٣٤٥٦٧٨٩'[Number(d)]);
export const fmt = (n: number) => Math.round(n).toLocaleString('ar-SA');

/** يقسم النص إلى أجزاء عادية وأجزاء معلقة {{...}} تظهر مظللة */
export function segments(text: string | null | undefined): { t: string; ph: boolean }[] {
  if (!text) return [];
  const out: { t: string; ph: boolean }[] = [];
  const re = /\{\{(.*?)\}\}/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push({ t: text.slice(last, m.index), ph: false });
    out.push({ t: m[1], ph: true });
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push({ t: text.slice(last), ph: false });
  return out;
}

/** إرسال نموذج للنظام */
export async function post<T = any>(path: string, body: unknown): Promise<T> {
  const r = await fetch(`/api/public/web${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    const msg = Array.isArray(data.message) ? data.message.join('، ') : data.message;
    throw new Error(r.status === 429 ? 'محاولات كثيرة، انتظروا دقيقة ثم أعيدوا المحاولة' : msg || 'تعذر الإرسال، حاولوا مرة أخرى');
  }
  return data as T;
}

/** معلومات الزيارة المرفقة بالنموذج (الصفحة ومصدر الحملة) */
export function visitMeta() {
  const q = new URLSearchParams(location.search);
  const utm = ['utm_source', 'utm_medium', 'utm_campaign'].map((k) => q.get(k)).filter(Boolean).join('/');
  return { page: location.pathname.slice(0, 300), ...(utm ? { utm: utm.slice(0, 120) } : {}) };
}

/** ما ينتقل من الحاسبة أو التقييم إلى نموذج الاستشارة أو الحجز */
export const handoff = reactive<{ message: string; service: string; calculator: any; assessment: any }>({ message: '', service: '', calculator: null, assessment: null });

/** أيقونات المجالات كعناصر SVG ثابتة (بلا v-html) */
export const ICONS: Record<string, { tag: string; a: Record<string, string> }[]> = {
  pm: [{ tag: 'path', a: { 'd': 'M4 6h10M4 12h16M4 18h7' } }, { tag: 'circle', a: { 'cx': '18', 'cy': '6', 'r': '2' } }, { tag: 'circle', a: { 'cx': '15', 'cy': '18', 'r': '2' } }],
  impact: [{ tag: 'path', a: { 'd': 'M4 20V10M10 20V4M16 20v-7M22 20H2' } }],
  gov: [{ tag: 'path', a: { 'd': 'M12 3l8 4v5c0 4.5-3.4 8.3-8 9-4.6-.7-8-4.5-8-9V7z' } }, { tag: 'path', a: { 'd': 'M9 12l2 2 4-4' } }],
  strategy: [{ tag: 'circle', a: { 'cx': '12', 'cy': '12', 'r': '8' } }, { tag: 'circle', a: { 'cx': '12', 'cy': '12', 'r': '4' } }, { tag: 'path', a: { 'd': 'M12 2v3M22 12h-3' } }],
  finance: [{ tag: 'path', a: { 'd': 'M12 3v18M16.5 7.5c0-1.7-2-3-4.5-3s-4.5 1.3-4.5 3S9.5 10.5 12 11s4.5 1.3 4.5 3.5-2 3.5-4.5 3.5-4.5-1.3-4.5-3' } }],
  tech: [{ tag: 'rect', a: { 'x': '7', 'y': '7', 'width': '10', 'height': '10', 'rx': '2' } }, { tag: 'path', a: { 'd': 'M10 3v4M14 3v4M10 17v4M14 17v4M3 10h4M3 14h4M17 10h4M17 14h4' } }],
  health: [{ tag: 'path', a: { 'd': 'M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z' } }, { tag: 'path', a: { 'd': 'M9 11h6M12 8v6' } }],
};
