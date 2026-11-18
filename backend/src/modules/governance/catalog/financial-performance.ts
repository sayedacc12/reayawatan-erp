/**
 * مؤشرات الأداء المالي (50% من معيار السلامة المالية).
 *
 * المرجع: دليل حوكمة الجمعيات الأهلية، الجزء الثالث: معيار السلامة المالية (الإصدار الثاني، أبريل 2022)،
 * الفصل الثاني «حساب مؤشرات الأداء المالي» ص 12–44، وجدول ملخص المؤشرات.
 *
 * الأرقام تُستخرج من دليل الحسابات الموحد للجمعيات الأهلية (الإصدار الثاني 2019) المثبّت في النظام المالي،
 * وتقابل أعمدة «تقرير التصنيف الوظيفي للمصروفات» كما في الدليل:
 *   (1) المصاريف العمومية والإدارية = 41، (2) البرامج والأنشطة المباشرة = 42 عدا 423،
 *   (3) الإدارية المحملة على البرامج = 423، (4) الأوقاف = 43، (5) الاستثمار = 45، (6) جمع الأموال = 44، (7) الحوكمة = 46.
 * ويمكن للجمعية تعديل ربط الحسابات من إعدادات النظام.
 */

/** الأرقام المالية التي تحتاجها المعادلات */
export type FinFigureKey =
  | 'adminExpenses' | 'programExpenses' | 'adminAllocated' | 'sustExpenses' | 'sustExpensesRestricted'
  | 'fundraisingExpenses' | 'totalExpenses' | 'sustReturns' | 'sustReturnsRestricted' | 'sustAssets'
  | 'donations' | 'cash' | 'currentInvestments' | 'currentLiabilities' | 'restrictedNetAssets';

export type FinFigures = Record<FinFigureKey, number>;

/** حساب في الربط: رمز الحساب (يشمل كل ما تحته) والإشارة (−1 للاستبعاد) */
export interface AccountRule { code: string; sign?: 1 | -1 }

export interface FigureDef {
  key: FinFigureKey;
  label: string;
  /** وصف البند كما ورد في الدليل (مصدر الرقم) */
  source: string;
  /** طبيعة الرصيد: مدين (أصول ومصروفات) أو دائن (التزامات وصافي أصول وإيرادات) */
  side: 'debit' | 'credit';
  /** رصيد في تاريخ (الميزانية) أو حركة خلال السنة (قائمة الأنشطة) */
  kind: 'balance' | 'flow';
  accounts: AccountRule[];
}

export const FIGURES: FigureDef[] = [
  { key: 'adminExpenses', label: 'المصاريف العمومية والإدارية (شاملة الحوكمة)', source: 'حاصل جمع عمود المصاريف الإدارية رقم (1) + عمود مصاريف الحوكمة رقم (7) في تقرير التصنيف الوظيفي للمصروفات', side: 'debit', kind: 'flow', accounts: [{ code: '41' }, { code: '46' }] },
  { key: 'programExpenses', label: 'مصاريف البرامج والأنشطة المباشرة', source: 'حاصل جمع عمود رقم (2) في تقرير التصنيف الوظيفي للمصروفات', side: 'debit', kind: 'flow', accounts: [{ code: '42' }, { code: '423', sign: -1 }] },
  { key: 'adminAllocated', label: 'المصاريف الإدارية المحملة على البرامج والأنشطة', source: 'حاصل جمع عمود رقم (3) في تقرير التصنيف الوظيفي للمصروفات', side: 'debit', kind: 'flow', accounts: [{ code: '423' }] },
  { key: 'sustExpenses', label: 'مصاريف الاستدامة المالية', source: 'حاصل جمع عمود مصاريف الأوقاف رقم (4) + عمود مصاريف الاستثمار رقم (5) في تقرير التصنيف الوظيفي للمصروفات', side: 'debit', kind: 'flow', accounts: [{ code: '43' }, { code: '45' }] },
  { key: 'sustExpensesRestricted', label: 'منها: مصاريف استدامة مقيدة', source: 'الجزء المقيد من مصاريف الاستدامة (يُستبعد من مؤشر تغطية المصاريف الإدارية)', side: 'debit', kind: 'flow', accounts: [] },
  { key: 'fundraisingExpenses', label: 'مصاريف جمع الأموال', source: 'حاصل جمع عمود رقم (6) في تقرير التصنيف الوظيفي للمصروفات', side: 'debit', kind: 'flow', accounts: [{ code: '44' }] },
  { key: 'totalExpenses', label: 'إجمالي المصاريف', source: 'إجمالي تقرير التصنيف الوظيفي للمصروفات (عدا التحويلات وإعادة التصنيف 47)', side: 'debit', kind: 'flow', accounts: [{ code: '41' }, { code: '42' }, { code: '43' }, { code: '44' }, { code: '45' }, { code: '46' }] },
  { key: 'sustReturns', label: 'عوائد الاستدامة المالية', source: 'الحسابات التجميعية: 31205 إيرادات غير مقيدة + 31303 إيرادات ريع أوقاف + 31304 أرباح استثمارات وقفية', side: 'credit', kind: 'flow', accounts: [{ code: '31205' }, { code: '31303' }, { code: '31304' }] },
  { key: 'sustReturnsRestricted', label: 'منها: عوائد استدامة مقيدة', source: 'الجزء المقيد من عوائد الاستدامة (يُستبعد من مؤشر تغطية المصاريف الإدارية)', side: 'credit', kind: 'flow', accounts: [] },
  { key: 'sustAssets', label: 'أصول الاستدامة المالية', source: 'مجموع الأصول الاستثمارية: 113 الاستثمارات المتداولة + 123 الاستثمارات غير المتداولة + 133 الاستثمارات الوقفية + 134 الأصول الثابتة الوقفية', side: 'debit', kind: 'balance', accounts: [{ code: '113' }, { code: '123' }, { code: '133' }, { code: '134' }] },
  { key: 'donations', label: 'إجمالي التبرعات', source: 'إجمالي عمود التبرعات في قائمة الأنشطة: 311 عدا الإيرادات المقيدة 31106، و31201–31204، و31301–31302', side: 'credit', kind: 'flow', accounts: [{ code: '311' }, { code: '31106', sign: -1 }, { code: '31201' }, { code: '31202' }, { code: '31203' }, { code: '31204' }, { code: '31301' }, { code: '31302' }] },
  { key: 'cash', label: 'النقد وما في حكمه', source: '111 النقدية في الصناديق والبنوك', side: 'debit', kind: 'balance', accounts: [{ code: '111' }] },
  { key: 'currentInvestments', label: 'الاستثمارات المتداولة', source: '113 الاستثمارات المتداولة', side: 'debit', kind: 'balance', accounts: [{ code: '113' }] },
  { key: 'currentLiabilities', label: 'الالتزامات المتداولة', source: '21 الالتزامات المتداولة', side: 'credit', kind: 'balance', accounts: [{ code: '21' }] },
  { key: 'restrictedNetAssets', label: 'صافي الأصول المقيدة وصافي أصول الأوقاف النقدية', source: '23102 صافي الأصول المقيدة + 23103 صافي أصول الأوقاف عدا 23103002 الأوقاف العينية', side: 'credit', kind: 'balance', accounts: [{ code: '23102' }, { code: '23103' }, { code: '23103002', sign: -1 }] },
];

export const EMPTY_FIGURES = (): FinFigures => Object.fromEntries(FIGURES.map((f) => [f.key, 0])) as FinFigures;

/** شرائح الدرجة كما في الدليل؛ تُستخدم للعرض ولحساب «المسافة إلى خسارة الدرجة» في الإنذار المبكر */
export interface Band { from: number | null; to: number | null; rule: string }

export interface SubIndicator {
  code: string;
  title: string;
  /** وزن المؤشر التحليلي داخل مؤشره الرئيسي (%) */
  weight: number;
  formula: string;
  unit: '%' | 'شهر';
  /** الاتجاه الأفضل: أقل أو أعلى أو نطاق مثالي */
  better: 'lower' | 'higher' | 'range';
  /** حد الدرجة الكاملة (النسبة التي إذا تجاوزها المؤشر بدأ يفقد درجات) */
  fullAt: number;
  /** الحد الذي تصبح عنده الدرجة صفراً */
  zeroAt: number;
  bands: Band[];
  page: number;
  ratio: (f: FinFigures) => number | null;
  score: (r: number) => number;
}

export interface MainIndicator {
  code: string;
  no: number;
  title: string;
  /** الوزن داخل مؤشرات الأداء المالي (%) */
  weight: number;
  subs: SubIndicator[];
}

const pct = (n: number, d: number): number | null => {
  if (d === 0) return n === 0 ? 0 : n > 0 ? Infinity : -Infinity;
  return (n / d) * 100;
};
const clamp = (v: number) => Math.max(0, Math.min(100, v));

/** «أقل من A = 100، من A إلى B تنخفض خطياً، B فأكثر = صفر» */
function lowerBetter(a: number, b: number) {
  return (r: number) => (r < a ? 100 : r >= b ? 0 : clamp(100 - ((r - a) * 100) / (b - a)));
}

export const FINANCIAL_PERFORMANCE: MainIndicator[] = [
  {
    code: 'FIN-1', no: 1, weight: 20, title: 'مؤشر المصاريف الإدارية',
    subs: [
      {
        code: 'FIN-1A', title: 'نسبة المصاريف العمومية والإدارية', weight: 80, unit: '%', better: 'lower', fullAt: 15, zeroAt: 25, page: 26,
        formula: '(المصاريف العمومية والإدارية ÷ إجمالي المصاريف) × 100',
        bands: [{ from: null, to: 15, rule: 'أقل من 15% = 100%' }, { from: 15, to: 25, rule: 'من 15% إلى 25%: 100 − (النسبة − 15) × 10' }, { from: 25, to: null, rule: 'أكثر من 25% = صفر' }],
        ratio: (f) => pct(f.adminExpenses, f.totalExpenses),
        score: (r) => (r < 15 ? 100 : r > 25 ? 0 : clamp(100 - (r - 15) * 10)),
      },
      {
        code: 'FIN-1B', title: 'نسبة تغطية عوائد الاستدامة للمصاريف الإدارية', weight: 20, unit: '%', better: 'higher', fullAt: 100, zeroAt: 0, page: 28,
        formula: '[(عوائد الاستدامة غير المقيدة − مصاريف الاستدامة غير المقيدة) ÷ المصاريف العمومية والإدارية] × 100',
        bands: [{ from: 100, to: null, rule: 'أكثر من 100% = 100%' }, { from: 0, to: 100, rule: 'من صفر إلى 100%: الدرجة = النسبة' }, { from: null, to: 0, rule: 'صفر أو أقل = صفر' }],
        ratio: (f) => pct((f.sustReturns - f.sustReturnsRestricted) - (f.sustExpenses - f.sustExpensesRestricted), f.adminExpenses),
        score: (r) => (r > 100 ? 100 : r <= 0 ? 0 : r),
      },
    ],
  },
  {
    code: 'FIN-2', no: 2, weight: 45, title: 'مؤشر مصاريف البرامج والأنشطة',
    subs: [
      {
        code: 'FIN-2A', title: 'نسبة مصاريف البرامج والأنشطة', weight: 60, unit: '%', better: 'higher', fullAt: 80, zeroAt: 40, page: 30,
        formula: '[(مصاريف البرامج والأنشطة + المصاريف الإدارية المحملة على البرامج) ÷ إجمالي المصاريف] × 100',
        bands: [{ from: 80, to: null, rule: 'أكثر من 80% = 100%' }, { from: 40, to: 80, rule: 'من 41% إلى 80%: 2.5 × (النسبة − 40)' }, { from: null, to: 40, rule: '40% أو أقل = صفر' }],
        ratio: (f) => pct(f.programExpenses + f.adminAllocated, f.totalExpenses),
        score: (r) => (r > 80 ? 100 : r <= 40 ? 0 : clamp(2.5 * (r - 40))),
      },
      {
        code: 'FIN-2B', title: 'نسبة المصاريف الإدارية المحملة على البرامج والأنشطة', weight: 40, unit: '%', better: 'lower', fullAt: 15, zeroAt: 25, page: 31,
        formula: '(المصاريف الإدارية المحملة على البرامج ÷ مصاريف البرامج والأنشطة) × 100',
        bands: [{ from: null, to: 15, rule: 'أقل من 15% = 100%' }, { from: 15, to: 25, rule: 'من 15% إلى 25%: 100 − (النسبة − 15) × 10' }, { from: 25, to: null, rule: 'أكثر من 25% = صفر' }],
        ratio: (f) => pct(f.adminAllocated, f.programExpenses),
        score: (r) => (r < 15 ? 100 : r > 25 ? 0 : clamp(100 - (r - 15) * 10)),
      },
    ],
  },
  {
    // ملاحظة: نص الدليل (ص 32) يذكر وزن 20% لهذا المؤشر، بينما جدول الملخص والجدول النهائي يذكران 10%،
    // وبه يكون مجموع الأوزان 100%؛ لذلك اعتُمد 10%.
    code: 'FIN-3', no: 3, weight: 10, title: 'مؤشر الاستدامة المالية',
    subs: [
      {
        code: 'FIN-3A', title: 'نسبة مصاريف الاستدامة إلى إجمالي المصاريف', weight: 30, unit: '%', better: 'lower', fullAt: 5, zeroAt: 10, page: 33,
        formula: '(مصاريف الاستدامة المالية ÷ إجمالي المصاريف) × 100',
        bands: [{ from: null, to: 5, rule: 'أقل من 5% = 100%' }, { from: 5, to: 10, rule: 'من 5% إلى 10%: 100 − (النسبة − 5) × 20' }, { from: 10, to: null, rule: '10% فأكثر = صفر' }],
        ratio: (f) => pct(f.sustExpenses, f.totalExpenses),
        score: lowerBetter(5, 10),
      },
      {
        code: 'FIN-3B', title: 'نسبة مصاريف الاستدامة إلى عوائدها', weight: 30, unit: '%', better: 'lower', fullAt: 10, zeroAt: 20, page: 35,
        formula: '(مصاريف الاستدامة المالية ÷ عوائد الاستدامة المالية) × 100',
        bands: [{ from: null, to: 10, rule: 'أقل من 10% = 100%' }, { from: 10, to: 20, rule: 'من 10% إلى 20%: 100 − (النسبة − 10) × 10' }, { from: 20, to: null, rule: '20% فأكثر = صفر' }],
        ratio: (f) => pct(f.sustExpenses, f.sustReturns),
        score: lowerBetter(10, 20),
      },
      {
        code: 'FIN-3C', title: 'نسبة عوائد الاستدامة إلى أصولها', weight: 40, unit: '%', better: 'higher', fullAt: 7.5, zeroAt: 0, page: 36,
        formula: '(عوائد الاستدامة المالية ÷ أصول الاستدامة المالية) × 100',
        bands: [{ from: 7.5, to: null, rule: 'أكثر من 7.5% = 100%' }, { from: 0, to: 7.5, rule: 'من صفر إلى 7.5%: (النسبة ÷ 7.5) × 100' }, { from: null, to: 0, rule: 'صفر أو أقل = صفر' }],
        ratio: (f) => pct(f.sustReturns, f.sustAssets),
        score: (r) => (r > 7.5 ? 100 : r <= 0 ? 0 : clamp((r / 7.5) * 100)),
      },
    ],
  },
  {
    code: 'FIN-4', no: 4, weight: 10, title: 'مؤشر جمع الأموال',
    subs: [
      {
        code: 'FIN-4A', title: 'نسبة مصاريف جمع الأموال إلى إجمالي المصاريف', weight: 50, unit: '%', better: 'lower', fullAt: 5, zeroAt: 10, page: 38,
        formula: '(مصاريف جمع الأموال ÷ إجمالي المصاريف) × 100',
        bands: [{ from: null, to: 5, rule: 'أقل من 5% = 100%' }, { from: 5, to: 10, rule: 'من 5% إلى 10%: 100 − (النسبة − 5) × 20' }, { from: 10, to: null, rule: '10% فأكثر = صفر' }],
        ratio: (f) => pct(f.fundraisingExpenses, f.totalExpenses),
        score: lowerBetter(5, 10),
      },
      {
        code: 'FIN-4B', title: 'نسبة مصاريف جمع الأموال إلى التبرعات', weight: 50, unit: '%', better: 'lower', fullAt: 10, zeroAt: 20, page: 39,
        formula: '(مصاريف جمع الأموال ÷ إجمالي التبرعات) × 100',
        bands: [{ from: null, to: 10, rule: 'أقل من 10% = 100%' }, { from: 10, to: 20, rule: 'من 10% إلى 20%: 100 − (النسبة − 10) × 10' }, { from: 20, to: null, rule: '20% فأكثر = صفر' }],
        ratio: (f) => pct(f.fundraisingExpenses, f.donations),
        score: lowerBetter(10, 20),
      },
    ],
  },
  {
    code: 'FIN-5', no: 5, weight: 15, title: 'مؤشر القدرة على تغطية الالتزامات المستقبلية',
    subs: [
      {
        code: 'FIN-5A', title: 'نسبة النقد إلى الالتزامات والأصول المقيدة', weight: 70, unit: '%', better: 'higher', fullAt: 100, zeroAt: 50, page: 41,
        formula: '[النقد وما في حكمه (111) ÷ (صافي الأصول المقيدة + صافي أصول الأوقاف النقدية + الالتزامات المتداولة)] × 100',
        bands: [{ from: 100, to: null, rule: 'أكثر من 100% = 100%' }, { from: 50, to: 100, rule: 'من 50% إلى 100%: الدرجة = النسبة' }, { from: null, to: 50, rule: 'أقل من 50% = صفر' }],
        // ملاحظة: مثال الجمعية (ب) في الدليل منحها 40% عند نسبة 40%، وهذا يخالف قاعدة الدليل الصريحة
        // («أقل من 50% = صفر»)؛ اعتمدنا القاعدة، ولذلك تظهر نتيجة (ب) 41.3% بدل 45.6%.
        ratio: (f) => pct(f.cash, f.restrictedNetAssets + f.currentLiabilities),
        score: (r) => (r > 100 ? 100 : r < 50 ? 0 : r),
      },
      {
        code: 'FIN-5B', title: 'عدد أشهر تغطية المصاريف الإدارية من النقد الحر', weight: 30, unit: 'شهر', better: 'range', fullAt: 12, zeroAt: 0, page: 43,
        formula: '[(النقد 111 + الاستثمارات المتداولة 113) − (الالتزامات المتداولة 21 + صافي الأصول المقيدة + صافي أصول الأوقاف النقدية)] ÷ (المصاريف الإدارية ÷ 12)',
        bands: [{ from: null, to: 12, rule: 'أقل من 12 شهراً: (عدد الأشهر ÷ 12) × 100' }, { from: 12, to: 18, rule: 'من 12 إلى 18 شهراً = 100%' }, { from: 18, to: null, rule: 'أكثر من 18 شهراً: 100 − (عدد الأشهر − 18) × 12.5' }],
        ratio: (f) => {
          const free = (f.cash + f.currentInvestments) - (f.currentLiabilities + f.restrictedNetAssets);
          const monthly = f.adminExpenses / 12;
          if (monthly === 0) return free > 0 ? Infinity : 0;
          return free / monthly;
        },
        score: (m) => (m < 12 ? clamp((m / 12) * 100) : m <= 18 ? 100 : clamp(100 - (m - 18) * 12.5)),
      },
    ],
  },
];

/* ---------------- رأي المحاسب القانوني والتقديرات ---------------- */

export type AuditorOpinion = 'unqualified' | 'qualified' | 'adverse' | 'disclaimer' | 'not_issued';

export const OPINION_AR: Record<AuditorOpinion, string> = {
  unqualified: 'رأي مطلق (نظيف)',
  qualified: 'رأي متحفظ',
  adverse: 'رأي معارض',
  disclaimer: 'امتناع عن إبداء الرأي',
  not_issued: 'لم تصدر القوائم المالية',
};

/** معامل رأي المحاسب القانوني (ص 13): 1 للمطلق، 1 − 0.1 × عدد البنود المتحفظ عليها، وصفر للمعارض والممتنع وعدم الإصدار */
export function opinionFactor(opinion: AuditorOpinion, qualifiedItems = 0): number {
  if (opinion === 'unqualified') return 1;
  if (opinion === 'qualified') return Math.max(0, Math.round((1 - 0.1 * Math.max(1, qualifiedItems)) * 100) / 100);
  return 0;
}

/** التقدير النهائي حسب جدول الدليل */
export const GRADES = [
  { min: 90, label: 'ممتاز', tone: 'excellent' },
  { min: 80, label: 'جيد جداً', tone: 'very_good' },
  { min: 70, label: 'جيد', tone: 'good' },
  { min: 50, label: 'متوسط', tone: 'average' },
  { min: 0, label: 'ضعيف', tone: 'weak' },
] as const;

export function grade(score: number) {
  return GRADES.find((g) => score >= g.min) ?? GRADES[GRADES.length - 1];
}

export interface SubResult {
  code: string; title: string; weight: number; unit: string; ratio: number | null; score: number; formula: string;
  fullAt: number; zeroAt: number; better: SubIndicator['better']; bands: Band[]; page: number;
  /** الدرجة المفقودة من الأداء المالي (من 100) بسبب هذا المؤشر */
  lost: number;
}
export interface MainResult { code: string; no: number; title: string; weight: number; score: number; weighted: number; subs: SubResult[] }
export interface PerformanceResult { indicators: MainResult[]; score: number; factor: number; final: number }

const round = (v: number, d = 2) => Math.round(v * 10 ** d) / 10 ** d;

/** يحسب مؤشرات الأداء المالي من الأرقام، ويطبّق معامل رأي المحاسب القانوني */
export function computePerformance(f: FinFigures, factor = 1): PerformanceResult {
  const indicators = FINANCIAL_PERFORMANCE.map((m) => {
    const subs: SubResult[] = m.subs.map((s) => {
      const r = s.ratio(f);
      const score = r === null || Number.isNaN(r) ? 0 : clamp(s.score(r));
      return {
        code: s.code, title: s.title, weight: s.weight, unit: s.unit, formula: s.formula, fullAt: s.fullAt, zeroAt: s.zeroAt, better: s.better, bands: s.bands, page: s.page,
        ratio: r === null || !Number.isFinite(r) ? r === null ? null : r > 0 ? 9999 : -9999 : round(r),
        score: round(score),
        lost: round(((100 - score) * s.weight * m.weight) / 10000),
      };
    });
    const score = subs.reduce((t, s) => t + (s.score * s.weight) / 100, 0);
    return { code: m.code, no: m.no, title: m.title, weight: m.weight, score: round(score), weighted: round((score * m.weight) / 100), subs };
  });
  const score = round(indicators.reduce((t, i) => t + i.weighted, 0));
  return { indicators, score, factor, final: round(score * factor) };
}
