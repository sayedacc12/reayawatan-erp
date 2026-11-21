/** القيم المقترحة للموازنة: المعادلات الأساسية، الافتراضات، المنهجيات، ووصف المتغيرات المتاحة لكل نوع */

export const SECTIONS = ['hr', 'opex', 'activity', 'revenue'] as const;
export type Section = (typeof SECTIONS)[number];
export const SECTION_NAME: Record<Section, string> = { hr: 'الموارد البشرية', opex: 'المصروفات التشغيلية', activity: 'الأنشطة والبرامج', revenue: 'الإيرادات والتمويل' };

export const METHODOLOGIES = ['activity', 'performance', 'historical', 'zero', 'top_down', 'bottom_up', 'mixed'] as const;
export type Methodology = (typeof METHODOLOGIES)[number];
export const METHODOLOGY_NAME: Record<Methodology, string> = {
  activity: 'مبنية على الأنشطة والبرامج', performance: 'مبنية على الأداء', historical: 'تاريخية مع التعديلات', zero: 'صفرية',
  top_down: 'من الأعلى إلى الأسفل', bottom_up: 'من الأسفل إلى الأعلى', mixed: 'مختلطة',
};

/** أهداف المعادلات: أين تُستخدم */
export const FORMULA_TARGETS = ['hr_monthly', 'hr_annual', 'opex', 'revenue', 'any'] as const;
export type FormulaTarget = (typeof FORMULA_TARGETS)[number];

export interface VarDoc { key: string; name: string }
/** المتغيرات التي يوفرها النظام لكل نوع معادلة (إضافة لافتراضات الموازنة) */
export const BUILTIN_VARS: Record<FormulaTarget, VarDoc[]> = {
  hr_monthly: [
    { key: 'basic', name: 'الراتب الأساسي الشهري' }, { key: 'housing', name: 'بدل السكن الشهري' }, { key: 'transport', name: 'بدل النقل الشهري' },
    { key: 'other', name: 'بدلات أخرى شهرية' }, { key: 'gross', name: 'إجمالي الراتب الشهري الحالي' },
    { key: 'raise', name: 'نسبة العلاوة السارية في الشهر (0.05 = 5%)' }, { key: 'gosi', name: 'حصة الشركة في التأمينات للشهر (بعد العلاوة، حسب لائحة الموارد البشرية)' },
    { key: 'eos', name: 'مخصص مكافأة نهاية الخدمة للشهر' }, { key: 'month', name: 'رقم الشهر (1 إلى 12)' }, { key: 'is_saudi', name: '1 للسعودي و0 لغيره' },
    { key: 'service_years', name: 'سنوات الخدمة في الشهر' }, { key: 'is_new', name: '1 للوظيفة الجديدة' },
  ],
  hr_annual: [
    { key: 'basic', name: 'الراتب الأساسي بعد العلاوة' }, { key: 'gross', name: 'إجمالي الراتب بعد العلاوة' }, { key: 'active_months', name: 'عدد أشهر العمل في السنة' },
    { key: 'is_saudi', name: '1 للسعودي و0 لغيره' }, { key: 'is_new', name: '1 للوظيفة الجديدة' }, { key: 'rating_score', name: 'درجة آخر تقييم أداء (0 إن لم يوجد)' },
  ],
  opex: [
    { key: 'hist_avg', name: 'المتوسط التاريخي بعد الاستبعادات (حسب طريقة المتوسط وعدد السنوات)' }, { key: 'hist_last', name: 'فعلي آخر سنة' },
    { key: 'hist_trend', name: 'معدل النمو السنوي التاريخي (0.1 = 10%)' }, { key: 'growth', name: 'نسبة الزيادة للبند (أو العامة)' },
    { key: 'volume_ratio', name: 'نسبة حجم العمل المتوقع إلى الحالي (1 = بلا تغيير)' },
  ],
  revenue: [
    { key: 'hist_avg', name: 'المتوسط التاريخي' }, { key: 'hist_last', name: 'فعلي آخر سنة' }, { key: 'hist_trend', name: 'معدل النمو التاريخي' },
    { key: 'growth', name: 'نسبة الزيادة للبند (أو العامة)' }, { key: 'volume_ratio', name: 'نسبة حجم العمل المتوقع' },
  ],
  any: [],
};

export interface FormulaSeed { code: string; name: string; target: FormulaTarget; expression: string; description: string }
export const SYSTEM_FORMULAS: FormulaSeed[] = [
  {
    code: 'HR_MONTHLY', name: 'التكلفة الشهرية للموظف', target: 'hr_monthly', expression: 'gross * (1 + raise) + gosi + eos + medical_monthly',
    description: 'إجمالي الراتب بعد العلاوة، وحصة الشركة في التأمينات، ومخصص نهاية الخدمة، والتأمين الطبي الشهري.',
  },
  {
    code: 'HR_ANNUAL', name: 'التكاليف السنوية الإضافية للموظف', target: 'hr_annual', expression: 'basic * bonus_months * active_months / 12 + training_per_employee',
    description: 'المكافأة السنوية بعدد رواتب أساسية متناسب مع أشهر العمل، وتكلفة التدريب لكل موظف.',
  },
  {
    code: 'OPEX_HIST', name: 'تاريخي مع نمو وتضخم', target: 'opex', expression: 'hist_avg * (1 + growth) * (1 + inflation)',
    description: 'متوسط المصروف الفعلي بعد استبعاد غير المتكرر، مع نسبة زيادة البند والتضخم المتوقع.',
  },
  {
    code: 'OPEX_VOLUME', name: 'حسب حجم العمل', target: 'opex', expression: 'hist_avg * volume_ratio * (1 + inflation)',
    description: 'المصروف التاريخي معدّلًا بنسبة التغير المتوقع في حجم العمل (مثل أعداد المستفيدين).',
  },
  {
    code: 'OPEX_TREND', name: 'اتجاه النمو التاريخي', target: 'opex', expression: 'hist_last * (1 + CLAMP(hist_trend, -0.3, 0.3))',
    description: 'فعلي آخر سنة مع معدل النمو التاريخي، بحد أعلى وأدنى 30% لتجنب القفزات.',
  },
  {
    code: 'REV_HIST', name: 'إيراد تاريخي مع نمو', target: 'revenue', expression: 'hist_avg * (1 + growth)',
    description: 'متوسط الإيراد الفعلي مع نسبة الزيادة المتوقعة.',
  },
];

export interface BudgetVariable {
  key: string; name: string; value: number; unit: string | null;
  /** قيم مرحلية خلال السنة: تسري كل قيمة من شهرها */
  steps: { fromMonth: number; value: number }[];
  /** متغير خاص بإدارة (فارغ = عام) */
  unitId: string | null; unitName?: string | null;
  note: string | null;
}
export interface RaiseRule {
  key: string; name: string; pct: number; fromMonth: number;
  match: { unitId: string | null; gradeName: string | null; jobTitle: string | null; rating: string | null; nationality: 'saudi' | 'non_saudi' | null };
  appliesToNew: boolean;
}
export interface Ceiling { unitId: string; unitName: string; amount: number }

export const DEFAULT_VARIABLES: BudgetVariable[] = [
  { key: 'general_raise', name: 'العلاوة السنوية العامة', value: 5, unit: '%', steps: [], unitId: null, note: 'تطبق على كل الموظفين ما لم توجد قاعدة أدق' },
  { key: 'raise_month', name: 'شهر سريان العلاوة العامة', value: 1, unit: 'شهر', steps: [], unitId: null, note: null },
  { key: 'medical_monthly', name: 'التأمين الطبي الشهري للموظف', value: 450, unit: 'ر.س', steps: [], unitId: null, note: null },
  { key: 'bonus_months', name: 'المكافأة السنوية (عدد رواتب أساسية)', value: 0.5, unit: 'راتب', steps: [], unitId: null, note: null },
  { key: 'training_per_employee', name: 'التدريب لكل موظف سنويًا', value: 2000, unit: 'ر.س', steps: [], unitId: null, note: null },
  { key: 'inflation', name: 'التضخم المتوقع', value: 0.02, unit: 'نسبة', steps: [], unitId: null, note: '0.02 = 2%' },
  { key: 'growth', name: 'الزيادة العامة في المصروفات', value: 0.03, unit: 'نسبة', steps: [], unitId: null, note: 'تُستخدم لأي بند لم تحدد له نسبة' },
  { key: 'revenue_growth', name: 'نمو الإيرادات المتوقع', value: 0.05, unit: 'نسبة', steps: [], unitId: null, note: null },
];

export const MONTHS_AR = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];

/**
 * مؤثر سيناريو: تغيير يُطبّق على نتيجة البنود المطابقة بعد احتسابها (يظهر في خطوات الاحتساب).
 * pct: زيادة أو خفض بنسبة من شهر معين (انخفاض التبرعات، تضخم الأسعار، تغير أسعار العقود).
 * shift: تأجيل البنود عددًا من الأشهر؛ ما يتجاوز ديسمبر ينتقل للسنة التالية ويخرج من موازنة السنة.
 */
export interface Lever {
  key: string; name: string; type: 'pct' | 'shift'; value: number; fromMonth: number;
  scope: { sections: Section[]; unitId: string | null; unitName?: string | null; fundingType: string | null; accountId: string | null; lineIds: string[] };
  note: string | null;
}
