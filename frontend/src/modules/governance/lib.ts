import { ref } from 'vue';
import { api } from '../../api';

export const P = {
  read: 'governance.dashboard.read', assess: 'governance.assessment.manage', approve: 'governance.assessment.approve',
  actions: 'governance.actions.manage', calendar: 'governance.calendar.manage', reports: 'governance.reports.read', settings: 'governance.settings.manage',
} as const;

// ---------------- الدليل ----------------
export type StepOption = [label: string, pct: number | null];
export interface CatalogStep { q: string; m: 'desk' | 'field' | 'both'; ev: string[]; o: StepOption[] }
export interface CatalogItem { code: string; points: number; steps: CatalogStep[]; auto?: string }
export interface CatalogPractice { no: number; code: string; title: string; topics: string[]; requirement: string; activities: string[]; evidence: string[]; refs?: string[]; items: CatalogItem[] }
export interface CatalogIndicator { code: string; no: number; title: string; domain: string; weight: number; practices: CatalogPractice[] }
export interface CatalogStandard { code: 'CMP' | 'TRN' | 'FRG'; title: string; source: string; indicators: CatalogIndicator[] }
export interface FigureDef { key: string; label: string; source: string; side: 'debit' | 'credit'; kind: 'balance' | 'flow'; accounts: { code: string; sign?: 1 | -1 }[] }
export interface Catalog {
  standards: CatalogStandard[]; axes: { code: string; title: string; weight: number }[]; figures: FigureDef[];
  stats: Record<string, { indicators: number; practices: number; items: number; questions: number }>;
  opinions: Record<string, string>; kinds: Record<string, string>; periods: Record<string, string>; obligationKinds: Record<string, string>;
}
const catalogCache = ref<Catalog | null>(null);
export async function loadCatalog() {
  if (!catalogCache.value) catalogCache.value = await api<Catalog>('/governance/catalog');
  return catalogCache.value;
}

/** نفس منطق الخادم: نسبة البند والأسئلة الظاهرة حسب الإجابات (البوابة تنهي البند) */
export function itemPercent(item: CatalogItem, choices: (number | null | undefined)[]): number | null {
  const vals: number[] = [];
  for (let i = 0; i < item.steps.length; i++) {
    const step = item.steps[i];
    const c = choices[i];
    if (c === null || c === undefined || !step.o[c]) return null;
    const pct = step.o[c][1];
    if (pct === null) continue;
    if (step.o.some((o) => o[1] === null)) return vals.length ? (vals.reduce((a, b) => a + b, 0) + pct) / (vals.length + 1) : pct;
    vals.push(pct);
  }
  return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
}
export function reachableSteps(item: CatalogItem, choices: (number | null | undefined)[]): number {
  for (let i = 0; i < item.steps.length; i++) {
    const c = choices[i];
    if (c === null || c === undefined) return i + 1;
    const pct = item.steps[i].o[c]?.[1];
    if (pct !== null && pct !== undefined && item.steps[i].o.some((o) => o[1] === null)) return i + 1;
  }
  return item.steps.length;
}

// ---------------- التقييم ----------------
export interface Signal { status: 'met' | 'partial' | 'missing' | 'na'; text: string; source: string }
export interface ItemEval {
  code: string; points: number; percent: number | null; earned: number; predictedPercent: number; predictedEarned: number;
  signal: Signal | null; suggested: (number | null)[] | null; suggestedPercent: number | null; evidence: string | null; answered: boolean;
}
export interface PracticeEval { no: number; code: string; title: string; possible: number; earned: number; predicted: number; answered: number; items: ItemEval[] }
export interface IndicatorEval { code: string; no: number; title: string; domain: string; weight: number; earned: number; predicted: number; percent: number; practices: PracticeEval[] }
export interface StandardEval { code: string; title: string; score: number; predicted: number; coverage: number; indicators: IndicatorEval[] }
export interface Opportunity {
  kind: 'item' | 'finance'; code: string; standard: string; indicator: string; practice: string | null; title: string;
  lost: number; impact: number; current: number | null; recommendations: string[]; effort: 'low' | 'medium' | 'high'; signal: string | null; planned?: boolean;
}
export interface Axis { code: string; title: string; weight: number; score: number; predicted: number }
export interface Evaluation {
  standards: StandardEval[]; performance: { score: number; final: number; factor: number; forecastFinal: number | null } | null;
  financialSafety: number; financialSafetyPredicted: number; overall: number; predicted: number; coverage: number; grade: string; predictedGrade: string;
  axes: Axis[]; opportunities: Opportunity[];
}
export interface SubResult {
  code: string; title: string; weight: number; unit: string; ratio: number | null; score: number; formula: string; fullAt: number; zeroAt: number;
  better: 'lower' | 'higher' | 'range'; bands: { from: number | null; to: number | null; rule: string }[]; page: number; lost: number;
}
export interface MainResult { code: string; no: number; title: string; weight: number; score: number; weighted: number; subs: SubResult[] }
export interface PerformanceResult { indicators: MainResult[]; score: number; factor: number; final: number }
export interface AnswerRow { choices: (number | null)[]; percent: number | null; points: number; evidence: string | null; note: string | null; fromSignal: boolean; answeredByName: string | null; updatedAt: string }
export interface AssessmentDetail {
  assessment: {
    id: string; code: string; title: string; kind: string; kindLabel: string; periodType: string; periodLabel: string; fiscalYear: number; periodFrom: string; periodTo: string;
    status: 'draft' | 'submitted' | 'approved'; statusLabel: string; opinion: string; opinionLabel: string; qualifiedItems: number; factor: number; notes: string | null;
    figures: Record<string, number> | null; figuresSource: 'ledger' | 'manual' | null; figuresAt: string | null;
    createdByName: string | null; submittedByName: string | null; approvedByName: string | null; approvedAt: string | null;
  };
  answers: Record<string, AnswerRow>;
  evaluation: Evaluation; performance: PerformanceResult | null; forecast: PerformanceResult | null; target: number; canEdit: boolean; canApprove: boolean;
}

// ---------------- العرض ----------------
export const GRADES = [
  { min: 90, label: 'ممتاز', color: '#059669' }, { min: 80, label: 'جيد جداً', color: '#10b981' }, { min: 70, label: 'جيد', color: '#0ea5e9' },
  { min: 50, label: 'متوسط', color: '#f59e0b' }, { min: 0, label: 'ضعيف', color: '#ef4444' },
];
export const gradeOf = (v: number | null | undefined) => GRADES.find((g) => (v ?? 0) >= g.min) ?? GRADES[GRADES.length - 1];
export const scoreColor = (v: number | null | undefined) => gradeOf(v).color;
export const pctColor = (v: number | null | undefined) => (v === null || v === undefined ? '#94a3b8' : v >= 100 ? '#10b981' : v > 0 ? '#f59e0b' : '#ef4444');

export const LEVELS: Record<string, { label: string; color: string }> = {
  critical: { label: 'حرج', color: '#ef4444' }, warning: { label: 'تحذير', color: '#f59e0b' }, info: { label: 'تنبيه', color: '#6366f1' },
};
export const STATUS: Record<string, { label: string; color: string }> = {
  draft: { label: 'مسودة', color: '#94a3b8' }, submitted: { label: 'بانتظار الاعتماد', color: '#f59e0b' }, approved: { label: 'معتمد', color: '#10b981' },
};
export const ACTION_STATUS: Record<string, { label: string; color: string }> = {
  planned: { label: 'مخطط', color: '#94a3b8' }, in_progress: { label: 'قيد التنفيذ', color: '#0ea5e9' }, done: { label: 'منجز', color: '#10b981' }, cancelled: { label: 'ملغي', color: '#475569' },
};
export const PRIORITIES: Record<string, { label: string; color: string }> = {
  low: { label: 'منخفضة', color: '#10b981' }, medium: { label: 'متوسطة', color: '#0ea5e9' }, high: { label: 'عالية', color: '#f97316' }, urgent: { label: 'عاجلة', color: '#ef4444' },
};
export const OBL_STATE: Record<string, { label: string; color: string }> = {
  done: { label: 'منجز', color: '#10b981' }, late_done: { label: 'منجز متأخراً', color: '#84cc16' }, overdue: { label: 'متأخر', color: '#ef4444' },
  due_soon: { label: 'قريب', color: '#f59e0b' }, upcoming: { label: 'قادم', color: '#94a3b8' },
};
export const SIGNAL: Record<string, { label: string; color: string }> = {
  met: { label: 'متحقق', color: '#10b981' }, partial: { label: 'جزئي', color: '#f59e0b' }, missing: { label: 'غير متحقق', color: '#ef4444' }, na: { label: 'لا ينطبق', color: '#94a3b8' },
};
export const METHOD: Record<string, string> = { desk: 'مكتبي', field: 'ميداني', both: 'مكتبي وميداني' };
export const EFFORT: Record<string, string> = { low: 'جهد منخفض', medium: 'جهد متوسط', high: 'جهد مرتفع' };

export const fmtDate = (d: string | null | undefined) =>
  d ? new Date(`${d.slice(0, 10)}T00:00:00`).toLocaleDateString('ar-SA-u-ca-gregory', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';
export const num = (n: number | null | undefined, d = 1) => (n === null || n === undefined ? '—' : n.toLocaleString('ar-SA', { maximumFractionDigits: d }));
export const money = (n: number | null | undefined) => (n ?? 0).toLocaleString('ar-SA', { maximumFractionDigits: 0 });
export const ratio = (s: { ratio: number | null; unit: string }) =>
  s.ratio === null ? '—' : !Number.isFinite(s.ratio) ? (s.ratio > 0 ? '∞' : '−∞') : `${num(s.ratio)}${s.unit === '%' ? '%' : ' شهر'}`;
export const todayStr = () => new Date(Date.now() + 3 * 3600_000).toISOString().slice(0, 10);
export const addDays = (n: number) => new Date(Date.now() + 3 * 3600_000 + n * 86400000).toISOString().slice(0, 10);
export const errMsg = (e: unknown) => (e as Error).message;
export const OPINIONS: Record<string, string> = {
  unqualified: 'رأي مطلق (نظيف)', qualified: 'رأي متحفظ', adverse: 'رأي معارض', disclaimer: 'امتناع عن إبداء الرأي', not_issued: 'لم تصدر القوائم المالية',
};
