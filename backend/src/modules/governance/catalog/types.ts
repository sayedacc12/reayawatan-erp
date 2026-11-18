/**
 * أنواع دليل الحوكمة.
 *
 * المرجع: أدلة حوكمة الجمعيات الأهلية الصادرة عن المركز الوطني لتنمية القطاع غير الربحي
 * (الإصدار الثالث/الثاني، أبريل 2022):
 *  - الجزء الأول: معيار الامتثال والالتزام (CMP)
 *  - الجزء الثاني: معيار الشفافية والإفصاح (TRN)
 *  - الجزء الثالث: معيار السلامة المالية (FIN) = الأداء المالي 50% + التنظيم المالي (FRG) 50%
 *
 * كل ممارسة لها «بطاقة تقييم» فيها أسئلة. كل بند مُقيَّم (Item) له درجة (points)
 * وقد يتكون من أكثر من سؤال متتابع: إجابة «يتم الانتقال إلى السؤال التالي» تعني أن البند
 * لا تُحسب نسبته إلا من السؤال الذي بعده (انظر آلية التقييم في كل دليل).
 *
 * نسبة البند = نسبة الحالة المختارة في آخر سؤال تمت الإجابة عليه.
 * درجة البند = الدرجة × النسبة. ومجموع درجات بنود المؤشر = وزنه في المعيار.
 */

/** مكتبي / ميداني / مكتبي وميداني — آلية التقييم كما وردت في بطاقة التقييم */
export type EvalMethod = 'desk' | 'field' | 'both';

/** حالة السؤال: [النص، النسبة]. النسبة null تعني «يتم الانتقال إلى السؤال التالي». */
export type StepOption = [label: string, pct: number | null];

export interface CatalogStep {
  /** نص السؤال كما ورد في بطاقة التقييم */
  q: string;
  m: EvalMethod;
  /** آلية التحقق (الشواهد المطلوبة) */
  ev: string[];
  o: StepOption[];
}

export interface CatalogItem {
  /** رمز البند داخل الدليل، مثل FRG-P01-1 */
  code: string;
  points: number;
  steps: CatalogStep[];
  /**
   * مفتاح إشارة آلية من أنظمة سنابل (اختياري): إن وُجد يقترح النظام إجابة
   * من البيانات الفعلية (مثل وجود الدليل المحاسبي الموحد في النظام المالي).
   */
  auto?: string;
}

export interface CatalogPractice {
  /** رقم بطاقة الممارسة في الدليل */
  no: number;
  code: string;
  title: string;
  /** موضوعات الممارسة */
  topics: string[];
  /** ملخص المتطلب كما ورد في البطاقة */
  requirement: string;
  /** الأنشطة المقترحة لتحقيق الممارسة (تستخدم كفرص تحسين) */
  activities: string[];
  /** الشواهد المتوقعة */
  evidence: string[];
  /** مصدر الممارسة (النظام واللائحة ورقم المادة) كما في البطاقة */
  refs?: string[];
  items: CatalogItem[];
}

export interface CatalogIndicator {
  code: string;
  no: number;
  title: string;
  domain: string;
  /** وزن المؤشر داخل معياره (%) = مجموع درجات بنوده */
  weight: number;
  practices: CatalogPractice[];
}

export type StandardCode = 'CMP' | 'TRN' | 'FRG';

export interface CatalogStandard {
  code: StandardCode;
  title: string;
  /** المرجع: اسم الدليل والإصدار */
  source: string;
  indicators: CatalogIndicator[];
}

/* ---------- أدوات مختصرة لكتابة البطاقات ---------- */

export const NEXT = null;

/** لا يوجد / يوجد بشكل جزئي / يوجد بشكل متكامل */
export const EXIST3: StepOption[] = [
  ['لا يوجد', 0],
  ['يوجد بشكل جزئي', 50],
  ['يوجد بشكل متكامل', 100],
];
/** غير مفعل / مفعل بشكل جزئي / مفعل بشكل متكامل */
export const ACTIVE3: StepOption[] = [
  ['غير مفعل', 0],
  ['مفعل بشكل جزئي', 50],
  ['مفعل بشكل متكامل', 100],
];
/** لم يتم الاعتماد / تم الاعتماد */
export const APPROVED2: StepOption[] = [
  ['لم يتم الاعتماد', 0],
  ['تم الاعتماد', 100],
];

export function yn(no: string, yes: string, noPct = 0, yesPct = 100): StepOption[] {
  return [[no, noPct], [yes, yesPct]];
}
/** سؤال بوابة: «لا» يعطي نسبة، و«نعم» ينتقل إلى السؤال التالي */
export function gate(no: string, noPct = 0, yes = 'نعم'): StepOption[] {
  return [[no, noPct], [yes, NEXT]];
}
/** سؤال بوابة معكوس: «لا» ينتقل للتالي و«نعم» يعطي نسبة */
export function gateYes(yes: string, yesPct: number, no = 'لا'): StepOption[] {
  return [[no, NEXT], [yes, yesPct]];
}

export function step(q: string, m: EvalMethod, ev: string[], o: StepOption[]): CatalogStep {
  return { q, m, ev, o };
}

export function item(code: string, points: number, ...steps: CatalogStep[]): CatalogItem {
  return { code, points, steps };
}

export function withAuto(it: CatalogItem, auto: string): CatalogItem {
  return { ...it, auto };
}
