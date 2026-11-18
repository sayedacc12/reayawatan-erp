import { inject, type InjectionKey, type Ref } from 'vue';

/* eslint-disable @typescript-eslint/no-explicit-any */
/** سياق الموقع العام لكل جمعية: البيانات المشتركة ودوال الروابط والاستدعاء */
export interface SiteCtx {
  slug: string;
  preview: string | null;
  data: Ref<any>;
  /** رابط داخلي في الموقع مع الحفاظ على مفتاح المعاينة */
  to: (path?: string) => { path: string; query: Record<string, string> };
  /** استدعاء واجهة الموقع العامة */
  get: <T = any>(path?: string) => Promise<T>;
  post: <T = any>(path: string, body: unknown) => Promise<T>;
  /** رابط لصفحة أو هدف (donate/programs/...) أو رابط خارجي */
  target: (t: string | null | undefined) => { internal: boolean; href: any };
}
export const SITE: InjectionKey<SiteCtx> = Symbol('site');
export function useSite() {
  const s = inject(SITE);
  if (!s) throw new Error('site context missing');
  return s;
}

/** استدعاء عام بدون رمز الدخول */
export async function publicApi<T = any>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const headers = new Headers(init.headers);
  let body = init.body;
  if (init.json !== undefined) {
    headers.set('Content-Type', 'application/json');
    body = JSON.stringify(init.json);
  }
  const res = await fetch(`/api${path}`, { ...init, headers, body });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const m = data?.message;
    throw new Error(Array.isArray(m) ? m[0] : m || 'تعذر الاتصال، حاول مرة أخرى');
  }
  return data as T;
}

export const num = (n: number | null | undefined) => (n ?? 0).toLocaleString('ar-SA', { maximumFractionDigits: 0 });
export const sar = (n: number | null | undefined) => `${num(n)} ر.س`;
export const dateAr = (d: string | Date | null | undefined) =>
  d ? new Date(typeof d === 'string' && d.length === 10 ? `${d}T00:00:00` : d).toLocaleDateString('ar-SA-u-ca-gregory', { day: 'numeric', month: 'long', year: 'numeric' }) : '';
export const paras = (t: string | null | undefined) => String(t ?? '').split(/\n\s*\n|\n/).map((x) => x.trim()).filter(Boolean);

export const SOCIAL: [string, string][] = [
  ['x', 'إكس'], ['instagram', 'إنستغرام'], ['linkedin', 'لينكدإن'], ['youtube', 'يوتيوب'], ['snapchat', 'سناب شات'], ['tiktok', 'تيك توك'], ['facebook', 'فيسبوك'], ['whatsapp', 'واتساب'],
];
export const socialHref = (k: string, v: string) => (k === 'whatsapp' && !/^https?:/.test(v) ? `https://wa.me/${v.replace(/\D/g, '').replace(/^0/, '966')}` : v);

/** يظهر العنصر بحركة عند دخوله الشاشة */
export const vReveal = {
  mounted(el: HTMLElement) {
    el.classList.add('sx-reveal');
    if (typeof IntersectionObserver === 'undefined') {
      el.classList.add('in');
      return;
    }
    const io = new IntersectionObserver((es) => {
      for (const e of es) if (e.isIntersecting) {
        el.classList.add('in');
        io.disconnect();
      }
    }, { threshold: 0.12 });
    io.observe(el);
  },
};
