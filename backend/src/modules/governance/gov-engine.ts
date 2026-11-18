/**
 * محرك احتساب درجة الحوكمة (دوال خالصة قابلة للاختبار).
 *
 * الدرجة الكلية = 40% الامتثال والالتزام + 20% الشفافية والإفصاح + 40% السلامة المالية،
 * والسلامة المالية = 50% الأداء المالي (بعد معامل رأي المحاسب القانوني) + 50% التنظيم المالي.
 *
 * ثلاث قراءات للدرجة:
 *  - الحالية: ما أُجيب عليه فقط، وغير المُجاب صفر (أسوأ احتمال).
 *  - المتوقعة: الإجابات + اقتراحات الإشارات الآلية + نتيجة التقييم السابق لما لم يُجب، والأداء المالي المتوقع لنهاية السنة.
 *  - التغطية: نسبة الدرجات التي أُجيب عليها.
 */
import {
  AXES, CatalogItem, FIN_SPLIT, grade, itemPercent, PerformanceResult, STANDARDS, StandardCode,
} from './catalog';
import { Signal, suggestChoices } from './gov-signals.service';

export interface AnswerLike { itemCode: string; choices: (number | null)[]; evidence?: string | null; note?: string | null; fromSignal?: boolean }

export interface ItemEval {
  code: string; points: number; percent: number | null; earned: number; predictedPercent: number; predictedEarned: number;
  signal: Signal | null; suggested: (number | null)[] | null; suggestedPercent: number | null; evidence: string | null; answered: boolean;
}
export interface PracticeEval { no: number; code: string; title: string; possible: number; earned: number; predicted: number; answered: number; items: ItemEval[] }
export interface IndicatorEval { code: string; no: number; title: string; domain: string; weight: number; earned: number; predicted: number; percent: number; practices: PracticeEval[] }
export interface StandardEval { code: StandardCode; title: string; score: number; predicted: number; coverage: number; indicators: IndicatorEval[] }

export interface Opportunity {
  kind: 'item' | 'finance';
  code: string;
  standard: string;
  indicator: string;
  practice: string | null;
  title: string;
  /** الدرجة المفقودة داخل المعيار أو داخل الأداء المالي */
  lost: number;
  /** أثرها على الدرجة الكلية (من 100) */
  impact: number;
  current: number | null;
  recommendations: string[];
  effort: 'low' | 'medium' | 'high';
  signal: string | null;
}

export interface Evaluation {
  standards: StandardEval[];
  performance: { score: number; final: number; factor: number; forecastFinal: number | null } | null;
  financialSafety: number;
  financialSafetyPredicted: number;
  overall: number;
  predicted: number;
  coverage: number;
  grade: string;
  predictedGrade: string;
  axes: { code: string; title: string; weight: number; score: number; predicted: number }[];
  opportunities: Opportunity[];
}

const r2 = (v: number) => Math.round(v * 100) / 100;

/** وزن نقطة البند في الدرجة الكلية */
export function impactFactor(standard: StandardCode | 'FIN'): number {
  if (standard === 'CMP') return 0.4;
  if (standard === 'TRN') return 0.2;
  if (standard === 'FRG') return 0.4 * (FIN_SPLIT.regulation / 100);
  return 0.4 * (FIN_SPLIT.performance / 100);
}

/** توصيات تحسين مؤشرات الأداء المالي (مستخلصة من شرح كل مؤشر في الدليل) */
export const FIN_TIPS: Record<string, string[]> = {
  'FIN-1A': ['مراجعة بنود المصاريف الإدارية وترشيدها (الإيجارات والعقود والخدمات المشتركة)', 'تحميل المصاريف الإدارية المرتبطة بالبرامج على مراكز تكلفة البرامج وفق التصنيف الوظيفي', 'تنمية حجم البرامج والأنشطة لرفع إجمالي المصاريف التشغيلية'],
  'FIN-1B': ['زيادة عوائد الاستدامة (الأوقاف والاستثمارات) غير المقيدة لتغطية المصاريف الإدارية ذاتياً', 'خفض مصاريف إدارة الأوقاف والاستثمارات'],
  'FIN-2A': ['رفع نسبة الإنفاق على البرامج والأنشطة إلى أكثر من 80% من إجمالي المصاريف', 'تحميل المصاريف الإدارية المرتبطة بالأنشطة على مراكز تكلفتها (عمود 3)'],
  'FIN-2B': ['خفض المصاريف الإدارية المحملة على البرامج إلى أقل من 15% من مصاريفها', 'مراجعة أسس توزيع المصاريف المشتركة على البرامج'],
  'FIN-3A': ['خفض مصاريف الأوقاف والاستثمار إلى أقل من 5% من إجمالي المصاريف'],
  'FIN-3B': ['رفع كفاءة إدارة الأوقاف والاستثمارات بحيث لا تتجاوز مصاريفها 10% من عوائدها'],
  'FIN-3C': ['تحسين العائد على أصول الاستدامة ليتجاوز 7.5% (إعادة توظيف الأصول ضعيفة العائد)', 'مراجعة عقود تأجير الأوقاف وتحديث قيمها'],
  'FIN-4A': ['ترشيد مصاريف جمع الأموال لتبقى أقل من 5% من إجمالي المصاريف', 'التوسع في القنوات الرقمية منخفضة التكلفة'],
  'FIN-4B': ['رفع عائد حملات جمع الأموال بحيث لا تتجاوز تكلفتها 10% من التبرعات', 'قياس عائد كل قناة وإيقاف القنوات الأعلى تكلفة'],
  'FIN-5A': ['الاحتفاظ بنقد يغطي صافي الأصول المقيدة وأموال الأوقاف النقدية والالتزامات المتداولة بالكامل', 'عدم استخدام الأموال المقيدة في غير أغراضها'],
  'FIN-5B': ['بناء احتياطي نقدي حر يغطي المصاريف الإدارية من 12 إلى 18 شهراً', 'توظيف الفائض النقدي الذي يتجاوز 18 شهراً في أوقاف أو استثمارات (بموافقة الجمعية العمومية)'],
};

export interface EvaluateInput {
  answers: Map<string, AnswerLike>;
  signals: Record<string, Signal>;
  /** نسب البنود في آخر تقييم معتمد (تُستخدم في الدرجة المتوقعة لما لم يُجب) */
  previous?: Map<string, number>;
  performance: PerformanceResult | null;
  forecast?: PerformanceResult | null;
}

function suggestionFor(item: CatalogItem, signals: Record<string, Signal>) {
  const signal = item.auto ? signals[item.auto] ?? null : null;
  if (!signal) return { signal: null, suggested: null, pct: null };
  const suggested = suggestChoices(item, signal.status);
  const pct = suggested ? itemPercent(item, suggested) : null;
  return { signal, suggested: pct === null ? null : suggested, pct };
}

export function evaluate(input: EvaluateInput): Evaluation {
  const standards: StandardEval[] = STANDARDS.map((s) => {
    let possible = 0;
    let answeredPts = 0;
    const indicators: IndicatorEval[] = s.indicators.map((ind) => {
      const practices: PracticeEval[] = ind.practices.map((p) => {
        const items: ItemEval[] = p.items.map((it) => {
          const a = input.answers.get(it.code);
          const percent = a ? itemPercent(it, a.choices) : null;
          const sug = suggestionFor(it, input.signals);
          const prev = input.previous?.get(it.code) ?? null;
          const predictedPercent = percent ?? sug.pct ?? prev ?? 0;
          return {
            code: it.code, points: it.points, percent, earned: percent === null ? 0 : (it.points * percent) / 100,
            predictedPercent, predictedEarned: (it.points * predictedPercent) / 100,
            signal: sug.signal, suggested: sug.suggested, suggestedPercent: sug.pct, evidence: a?.evidence ?? null, answered: percent !== null,
          };
        });
        const pPossible = items.reduce((t, i) => t + i.points, 0);
        possible += pPossible;
        answeredPts += items.filter((i) => i.answered).reduce((t, i) => t + i.points, 0);
        return {
          no: p.no, code: p.code, title: p.title, possible: pPossible,
          earned: r2(items.reduce((t, i) => t + i.earned, 0)), predicted: r2(items.reduce((t, i) => t + i.predictedEarned, 0)),
          answered: items.filter((i) => i.answered).length, items,
        };
      });
      const earned = practices.reduce((t, p) => t + p.earned, 0);
      return {
        code: ind.code, no: ind.no, title: ind.title, domain: ind.domain, weight: ind.weight, earned: r2(earned),
        predicted: r2(practices.reduce((t, p) => t + p.predicted, 0)), percent: ind.weight ? r2((earned / ind.weight) * 100) : 0, practices,
      };
    });
    return {
      code: s.code, title: s.title, indicators,
      score: r2(indicators.reduce((t, i) => t + i.earned, 0)),
      predicted: r2(indicators.reduce((t, i) => t + i.predicted, 0)),
      coverage: possible ? r2((answeredPts / possible) * 100) : 0,
    };
  });

  const by = (c: StandardCode) => standards.find((s) => s.code === c)!;
  const perf = input.performance;
  const perfFinal = perf ? perf.final : 0;
  const forecastFinal = input.forecast ? input.forecast.final : perf ? perf.final : 0;
  const financialSafety = r2((perfFinal * FIN_SPLIT.performance + by('FRG').score * FIN_SPLIT.regulation) / 100);
  const financialSafetyPredicted = r2((forecastFinal * FIN_SPLIT.performance + by('FRG').predicted * FIN_SPLIT.regulation) / 100);
  const axes = AXES.map((a) => {
    const score = a.code === 'FIN' ? financialSafety : by(a.code).score;
    const predicted = a.code === 'FIN' ? financialSafetyPredicted : by(a.code).predicted;
    return { code: a.code, title: a.title, weight: a.weight, score, predicted };
  });
  const overall = r2(axes.reduce((t, a) => t + (a.score * a.weight) / 100, 0));
  const predicted = r2(axes.reduce((t, a) => t + (a.predicted * a.weight) / 100, 0));
  const coverage = r2((by('CMP').coverage * 40 + by('TRN').coverage * 20 + by('FRG').coverage * 20 + (perf ? 100 : 0) * 20) / 100);

  // ---- فرص التحسين: كل بند لم يحقق كامل درجته، مرتبة حسب أثرها على الدرجة الكلية
  const opportunities: Opportunity[] = [];
  for (const s of STANDARDS) {
    const se = by(s.code);
    for (const ind of s.indicators) {
      const ie = se.indicators.find((i) => i.code === ind.code)!;
      for (const p of ind.practices) {
        const pe = ie.practices.find((x) => x.code === p.code)!;
        for (const it of p.items) {
          const e = pe.items.find((x) => x.code === it.code)!;
          const pct = e.answered ? e.percent! : e.predictedPercent;
          if (pct >= 100) continue;
          const lost = (it.points * (100 - pct)) / 100;
          const lastStep = it.steps[it.steps.length - 1];
          opportunities.push({
            kind: 'item', code: it.code, standard: s.title, indicator: `${ind.code} ${ind.title}`, practice: `${p.code} ${p.title}`,
            title: lastStep.q, lost: r2(lost), impact: r2(lost * impactFactor(s.code)), current: e.answered ? e.percent : null,
            recommendations: p.activities, effort: lastStep.m === 'desk' ? 'low' : lastStep.m === 'both' ? 'medium' : 'medium',
            signal: e.signal?.text ?? null,
          });
        }
      }
    }
  }
  const fin = input.forecast ?? perf;
  if (fin) {
    for (const m of fin.indicators) {
      for (const sub of m.subs) {
        if (sub.lost <= 0) continue;
        opportunities.push({
          kind: 'finance', code: sub.code, standard: 'السلامة المالية — الأداء المالي', indicator: `${m.code} ${m.title}`, practice: null,
          title: `${sub.title} (الحالية ${sub.ratio === null ? '—' : sub.ratio}${sub.unit === '%' ? '%' : ' شهر'}، والمستهدف ${sub.better === 'lower' ? 'أقل من' : sub.better === 'higher' ? 'أكثر من' : 'من 12 إلى 18 شهراً'}${sub.better === 'range' ? '' : ` ${sub.fullAt}%`})`,
          lost: sub.lost, impact: r2(sub.lost * impactFactor('FIN')), current: sub.score, recommendations: FIN_TIPS[sub.code] ?? [], effort: 'high', signal: null,
        });
      }
    }
  }
  opportunities.sort((a, b) => b.impact - a.impact || (a.effort === 'low' ? -1 : 1));

  return {
    standards,
    performance: perf ? { score: perf.score, final: perf.final, factor: perf.factor, forecastFinal: input.forecast ? input.forecast.final : null } : null,
    financialSafety, financialSafetyPredicted, overall, predicted, coverage,
    grade: grade(overall).label, predictedGrade: grade(predicted).label, axes, opportunities,
  };
}
