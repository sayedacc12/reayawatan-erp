import { DepMethod } from './entities/assets.entity';

/**
 * حساب الإهلاك (دوال بحتة بدون قاعدة بيانات).
 *
 * - القسط الثابت: (التكلفة − القيمة التخريدية − مجمع الإهلاك) موزعة على العمر المتبقي بالأشهر. بدون إضافات يساوي
 *   (التكلفة − القيمة التخريدية) ÷ العمر بالأشهر كل شهر، وعند إضافة تحسين على الأصل يُعاد توزيع صافي القيمة على العمر المتبقي.
 * - القسط المتناقص: نسبة الإهلاك من صافي القيمة الدفترية في بداية السنة المالية (أو عند بدء الاستخدام إن كان خلالها).
 * - الإهلاك المعجل (مجموع أرقام السنين): نصيب السنة k = (ن − k + 1) ÷ (ن(ن+1)/2) من القيمة القابلة للإهلاك.
 *
 * قيود عامة: لا يتجاوز مجمع الإهلاك (التكلفة − 1 ريال)، ولا يقل صافي القيمة عن القيمة التخريدية ولا عن ريال واحد.
 * الشهر الجزئي: days بالأيام الفعلية في شهري الشراء والاستبعاد، أو next_month يبدأ الإهلاك من أول الشهر التالي للشراء
 * ويُحسب شهر الاستبعاد كاملًا.
 */

export type PartialRule = 'days' | 'next_month';

export const DEP_METHOD_AR: Record<DepMethod, string> = {
  straight_line: 'القسط الثابت', declining: 'القسط المتناقص', accelerated: 'الإهلاك المعجل (مجموع أرقام السنين)',
};

const toDate = (s: string) => new Date(`${s}T00:00:00Z`);
const iso = (d: Date) => d.toISOString().slice(0, 10);
export const addDays = (s: string, n: number) => {
  const d = toDate(s);
  d.setUTCDate(d.getUTCDate() + n);
  return iso(d);
};
export const daysInMonth = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();
export const monthStart = (s: string) => `${s.slice(0, 7)}-01`;
export const monthEnd = (s: string) => {
  const y = Number(s.slice(0, 4));
  const m = Number(s.slice(5, 7));
  return `${s.slice(0, 7)}-${String(daysInMonth(y, m)).padStart(2, '0')}`;
};
const nextMonthStart = (s: string) => addDays(monthEnd(s), 1);
const diffDays = (a: string, b: string) => Math.round((toDate(b).getTime() - toDate(a).getTime()) / 86_400_000);

/** عدد الأشهر المكافئة بين تاريخين (من a شاملًا حتى b غير شامل)، الشهر الجزئي بنسبة أيامه */
export function monthsEquivalent(a: string, b: string) {
  if (b <= a) return 0;
  // نفس عمليات الجمع التي كانت تتم شهرًا بشهر (فالنتيجة مطابقة تمامًا)، لكن دون إنشاء تواريخ لكل شهر:
  // كانت تُستدعى لكل شهر من عمر الأصل فتصبح بطيئة جدًا مع آلاف الأصول القديمة
  const y = Number(a.slice(0, 4));
  const m = Number(a.slice(5, 7));
  const firstEnd = addDays(monthEnd(a), 1);
  if (b <= firstEnd) return diffDays(a, b) / daysInMonth(y, m);
  let total = diffDays(a, firstEnd) / daysInMonth(y, m);
  const fy = Number(firstEnd.slice(0, 4));
  const fm = Number(firstEnd.slice(5, 7));
  const by = Number(b.slice(0, 4));
  const bm = Number(b.slice(5, 7));
  for (let k = by * 12 + bm - (fy * 12 + fm); k > 0; k--) total += 1;
  const bd = Number(b.slice(8, 10));
  if (bd > 1) total += (bd - 1) / daysInMonth(by, bm);
  return total;
}

/** العمر الإنتاجي بالسنوات: المُدخل، أو 100 ÷ النسبة */
export function lifeOf(rate: number, lifeYears: number | null) {
  if (lifeYears && lifeYears > 0) return lifeYears;
  return rate > 0 ? 100 / rate : null;
}

/** تاريخ بدء الإهلاك حسب قاعدة الشهر الجزئي */
export function depStart(inService: string, rule: PartialRule) {
  if (rule === 'next_month' && inService.slice(8) !== '01') return nextMonthStart(inService);
  return inService;
}

export interface CalcInput {
  inServiceDate: string;
  /** آخر تاريخ احتُسب حتى نهايته إهلاك (أو تاريخ الرصيد الافتتاحي)، null = لم يُحتسب */
  depreciatedThrough: string | null;
  salvage: number;
  method: DepMethod;
  rate: number;
  lifeYears: number | null;
  /** حركات التكلفة المعتمدة (افتتاحي، شراء، تبرع، إضافة) */
  costMoves: { date: string; amount: number }[];
  /** مجمع الإهلاك الحالي (حتى depreciatedThrough) */
  accum: number;
  /** تاريخ مجمع الإهلاك: الرصيد الافتتاحي وكل إهلاك مرحّل بتاريخ نهايته (للقسط المتناقص) */
  accumHistory: { date: string; amount: number }[];
  /** بداية السنة المالية التي يقع فيها الشهر */
  yearStartOf: (month: string) => string;
  partial: PartialRule;
}

export interface CalcMonth { month: string; from: string; to: string; fraction: number; amount: number }
export interface CalcResult { from: string | null; to: string; amount: number; months: CalcMonth[]; capped: boolean; fully: boolean; reason: string | null }

const r2 = (n: number) => Math.round(n * 100) / 100;

/** إهلاك أصل من اليوم التالي لآخر إهلاك حتى تاريخ to (شاملًا) */
export function computeDepreciation(a: CalcInput, to: string): CalcResult {
  const life = lifeOf(a.rate, a.lifeYears);
  const empty = (reason: string | null, fully = false): CalcResult => ({ from: null, to, amount: 0, months: [], capped: false, fully, reason });
  if (!(a.rate > 0) && !life) return empty('المجموعة لا تُهلك (مثل الأراضي)');
  if (!life) return empty('لم يُحدد العمر الإنتاجي أو نسبة الإهلاك');
  const start = depStart(a.inServiceDate, a.partial);
  const from = a.depreciatedThrough && addDays(a.depreciatedThrough, 1) > start ? addDays(a.depreciatedThrough, 1) : start;
  if (from > to) return empty(a.depreciatedThrough && a.depreciatedThrough >= to ? 'احتُسب إهلاكه حتى هذا التاريخ' : 'لم يبدأ إهلاكه بعد');
  const costAt = (d: string) => a.costMoves.filter((m) => m.date <= d).reduce((s, m) => s + m.amount, 0);
  const lifeMonths = life * 12;
  const syd = Math.max(1, Math.round(life));
  let running = a.accum;
  const months: CalcMonth[] = [];
  let capped = false;
  let cur = from;
  while (cur <= to) {
    const segEnd = monthEnd(cur) < to ? monthEnd(cur) : to;
    const y = Number(cur.slice(0, 4));
    const m = Number(cur.slice(5, 7));
    const fraction = a.partial === 'next_month' ? 1 : (diffDays(cur, segEnd) + 1) / daysInMonth(y, m);
    const cost = costAt(segEnd);
    const floor = Math.max(a.salvage, 1);
    const room = Math.max(0, cost - floor - running);
    let charge = 0;
    const consumed = monthsEquivalent(start, cur);
    if (a.method === 'straight_line') {
      const remaining = lifeMonths - consumed;
      const base = Math.max(0, cost - a.salvage - running);
      charge = remaining <= fraction ? base : base * (fraction / remaining);
    } else if (a.method === 'declining') {
      const ys = a.yearStartOf(cur.slice(0, 7));
      const baseDate = ys > start ? ys : start;
      const accumAtBase = a.accumHistory.filter((h) => h.date < baseDate).reduce((s, h) => s + h.amount, 0)
        + months.filter((x) => x.to < baseDate).reduce((s, x) => s + x.amount, 0);
      const nbv = cost - accumAtBase;
      charge = Math.max(0, nbv) * (a.rate / 100) * (fraction / 12);
    } else {
      const k = Math.floor(consumed / 12) + 1;
      charge = k > syd ? 0 : Math.max(0, cost - a.salvage) * ((syd - k + 1) / ((syd * (syd + 1)) / 2)) * (fraction / 12);
    }
    if (charge > room) {
      charge = room;
      capped = true;
    }
    charge = r2(charge);
    running = r2(running + charge);
    months.push({ month: cur.slice(0, 7), from: cur, to: segEnd, fraction: r2(fraction), amount: charge });
    cur = addDays(segEnd, 1);
  }
  const amount = r2(months.reduce((s, x) => s + x.amount, 0));
  const cost = costAt(to);
  const fully = r2(cost - Math.max(a.salvage, 1) - running) <= 0;
  return { from, to, amount, months, capped, fully, reason: amount === 0 ? (fully ? 'اكتمل إهلاكه' : null) : null };
}

/** يجمع الصفوف حسب الأصل في خريطة واحدة (بدل البحث في القائمة كاملة لكل أصل، وهو بطيء جدًا مع آلاف الأصول) */
export function byAsset<T extends { assetId: string }>(rows: T[], ids: Set<string>) {
  const m = new Map<string, T[]>();
  for (const r of rows) {
    if (!ids.has(r.assetId)) continue;
    const list = m.get(r.assetId);
    if (list) list.push(r);
    else m.set(r.assetId, [r]);
  }
  return m;
}
