import { ref, watch } from 'vue';
import { useSession } from '../stores/session';

/**
 * مسودة تلقائية لنموذج طويل حتى لا يضيع ما أُدخل (إغلاق النافذة، انقطاع الاتصال، خطأ في الحفظ).
 * تُحفظ في متصفح المستخدم نفسه فقط باسم المنشأة والمستخدم، ولا تُرسل للخادم.
 * النموذج الذي فيه بيانات شخصية أو مالية يمرّر `keep`: قائمة الحقول المسموح حفظها فقط، وما سواها لا يُحفظ أبدًا.
 * وفي كل الأحوال لا تُحفظ الهوية والآيبان والتأمينات وكلمات المرور. تُحذف المسودة بعد الحفظ الفعلي،
 * أو بعد 7 أيام، وتُحذف كل مسودات الجهاز عند تسجيل الخروج.
 */
const SENSITIVE = /^(nationalId|iban|gosiNumber|password|passport.*|idNumber|.*salary.*|allowances)$/i;
const MAX_AGE = 7 * 24 * 3600_000;
const PREFIX = 'draft:';

/** عند تسجيل الخروج: حذف كل المسودات المحفوظة في هذا المتصفح */
export function clearDrafts() {
  try {
    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k?.startsWith(PREFIX)) keys.push(k); }
    keys.forEach((k) => localStorage.removeItem(k));
  } catch { /* تجاهل */ }
}

interface Stored<T> { at: number; data: Partial<T> }

function strip(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(strip);
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).filter(([k]) => !SENSITIVE.test(k)).map(([k, x]) => [k, strip(x)]));
  return v;
}

export function useDraft<T extends object>(name: string, form: T, opts: { keep?: (keyof T & string)[] } = {}) {
  const session = useSession();
  const key = `${PREFIX}${session.user?.organizationId ?? '-'}:${session.user?.id ?? '-'}:${name}`;
  const found = ref<Stored<T> | null>(null);
  const savedAt = ref<number | null>(null);
  let armed = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  try {
    const raw = localStorage.getItem(key);
    const s = raw ? (JSON.parse(raw) as Stored<T>) : null;
    if (s && Date.now() - s.at < MAX_AGE) found.value = s;
    else if (s) localStorage.removeItem(key);
  } catch { /* متصفح يمنع التخزين: يعمل النموذج بلا مسودة */ }

  function write() {
    try {
      const at = Date.now();
      const all = JSON.parse(JSON.stringify(form)) as Record<string, unknown>;
      const picked = opts.keep ? Object.fromEntries(opts.keep.filter((k) => k in all).map((k) => [k, all[k]])) : all;
      localStorage.setItem(key, JSON.stringify({ at, data: strip(picked) }));
      savedAt.value = at;
    } catch { /* تجاهل */ }
  }
  watch(() => JSON.stringify(form), () => {
    if (!armed) return;
    clearTimeout(timer);
    timer = setTimeout(write, 800);
  });

  return {
    /** مسودة سابقة لم تُستعد بعد */
    found,
    /** وقت آخر حفظ تلقائي في هذه الجلسة */
    savedAt,
    /** يبدأ الحفظ التلقائي (بعد تحميل بيانات النموذج الأصلية) */
    arm() { armed = true; },
    restore() {
      if (!found.value) return;
      const allowed = opts.keep ? new Set<string>(opts.keep) : null;
      const data = Object.fromEntries(Object.entries(found.value.data as Record<string, unknown>).filter(([k]) => k in form && (!allowed || allowed.has(k)) && !SENSITIVE.test(k)));
      Object.assign(form, data);
      found.value = null;
      armed = true;
    },
    /** حفظ يدوي فوري: «حفظ كمسودة» */
    saveNow() { armed = true; clearTimeout(timer); write(); },
    /** بعد الحفظ الفعلي أو عند تجاهل المسودة */
    discard() {
      clearTimeout(timer);
      found.value = null;
      savedAt.value = null;
      try { localStorage.removeItem(key); } catch { /* تجاهل */ }
    },
  };
}
