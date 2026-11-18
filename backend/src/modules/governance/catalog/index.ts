/**
 * دليل الحوكمة الكامل وقواعد احتساب الدرجات.
 *
 * التقييم الكلي (أدلة المركز الوطني لتنمية القطاع غير الربحي):
 *   الامتثال والالتزام 40% + الشفافية والإفصاح 20% + السلامة المالية 40%
 *   والسلامة المالية = الأداء المالي 50% + التنظيم المالي 50%.
 */
import { COMPLIANCE } from './compliance';
import { FINANCIAL_REGULATION } from './financial-regulation';
import { TRANSPARENCY } from './transparency';
import { CatalogItem, CatalogPractice, CatalogStandard, StandardCode } from './types';

export * from './types';
export * from './financial-performance';
export { COMPLIANCE, TRANSPARENCY, FINANCIAL_REGULATION };

export const STANDARDS: CatalogStandard[] = [COMPLIANCE, TRANSPARENCY, FINANCIAL_REGULATION];

/** أوزان المحاور في الدرجة الكلية */
export const AXES = [
  { code: 'CMP', title: 'الامتثال والالتزام', weight: 40 },
  { code: 'TRN', title: 'الشفافية والإفصاح', weight: 20 },
  { code: 'FIN', title: 'السلامة المالية', weight: 40 },
] as const;
/** نصيب كل من الأداء المالي والتنظيم المالي داخل السلامة المالية */
export const FIN_SPLIT = { performance: 50, regulation: 50 };

export interface FlatItem {
  standard: StandardCode;
  indicatorCode: string;
  indicatorTitle: string;
  practice: CatalogPractice;
  item: CatalogItem;
}

let flat: FlatItem[] | null = null;
export function allItems(): FlatItem[] {
  if (!flat) {
    flat = STANDARDS.flatMap((s) => s.indicators.flatMap((ind) => ind.practices.flatMap((p) =>
      p.items.map((it) => ({ standard: s.code, indicatorCode: ind.code, indicatorTitle: ind.title, practice: p, item: it })))));
  }
  return flat;
}

const byCode = new Map<string, FlatItem>();
export function findItem(code: string): FlatItem | undefined {
  if (!byCode.size) allItems().forEach((f) => byCode.set(f.item.code, f));
  return byCode.get(code);
}

/**
 * نسبة تحقق البند من إجابات أسئلته.
 *  - الإجابة «يتم الانتقال إلى السؤال التالي» تمرّر إلى السؤال الذي بعده.
 *  - سؤال البوابة (فيه خيار انتقال) إذا اختير فيه خيار بنسبة يُنهي البند بهذه النسبة.
 *  - الأسئلة المتعددة التي تشترك في درجة واحدة دون بوابة بينها تُحسب بمتوسط نسبها.
 * تُرجع null إذا لم تكتمل الإجابة على الأسئلة المطلوبة.
 */
export function itemPercent(item: CatalogItem, choices: (number | null | undefined)[]): number | null {
  const vals: number[] = [];
  for (let i = 0; i < item.steps.length; i++) {
    const step = item.steps[i];
    const c = choices[i];
    if (c === null || c === undefined || !step.o[c]) return null;
    const pct = step.o[c][1];
    if (pct === null) continue;
    const isGate = step.o.some((o) => o[1] === null);
    if (isGate) return vals.length ? (vals.reduce((a, b) => a + b, 0) + pct) / (vals.length + 1) : pct;
    vals.push(pct);
  }
  return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
}

/** الأسئلة التي يجب الإجابة عليها حسب الإجابات الحالية (لإخفاء ما بعد إجابة منهية) */
export function reachableSteps(item: CatalogItem, choices: (number | null | undefined)[]): number {
  for (let i = 0; i < item.steps.length; i++) {
    const c = choices[i];
    if (c === null || c === undefined) return i + 1;
    const pct = item.steps[i].o[c]?.[1];
    const isGate = item.steps[i].o.some((o) => o[1] === null);
    if (pct !== null && pct !== undefined && isGate) return i + 1;
  }
  return item.steps.length;
}

/** تحقق من سلامة الدليل: مجموع الدرجات = وزن المؤشر، ومجموع الأوزان = 100، وتفرد الرموز */
export function validateCatalog(): string[] {
  const errors: string[] = [];
  const codes = new Set<string>();
  for (const s of STANDARDS) {
    let total = 0;
    for (const ind of s.indicators) {
      total += ind.weight;
      const pts = ind.practices.reduce((t, p) => t + p.items.reduce((u, it) => u + it.points, 0), 0);
      if (Math.abs(pts - ind.weight) > 0.001) errors.push(`${ind.code}: مجموع الدرجات ${pts} لا يساوي الوزن ${ind.weight}`);
      for (const p of ind.practices) for (const it of p.items) {
        if (codes.has(it.code)) errors.push(`رمز مكرر ${it.code}`);
        codes.add(it.code);
        if (!it.steps.length) errors.push(`${it.code}: بلا أسئلة`);
        const last = it.steps[it.steps.length - 1];
        if (last && last.o.some((o) => o[1] === null)) errors.push(`${it.code}: آخر سؤال لا يصح أن ينقل لسؤال تالٍ`);
      }
    }
    if (Math.abs(total - 100) > 0.001) errors.push(`${s.code}: مجموع أوزان المؤشرات ${total}`);
  }
  return errors;
}

export function catalogStats() {
  return STANDARDS.map((s) => ({
    code: s.code,
    indicators: s.indicators.length,
    practices: s.indicators.reduce((t, i) => t + i.practices.length, 0),
    items: s.indicators.reduce((t, i) => t + i.practices.reduce((u, p) => u + p.items.length, 0), 0),
    questions: s.indicators.reduce((t, i) => t + i.practices.reduce((u, p) => u + p.items.reduce((v, it) => v + it.steps.length, 0), 0), 0),
  }));
}
