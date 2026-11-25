import { AccountNature } from '../entities/accounting.entity';

/**
 * بنود القوائم المالية (نموذج الشركات وفق المعيار الدولي للتقرير المالي للمنشآت الصغيرة والمتوسطة المعتمد في المملكة)،
 * وربطها الافتراضي بالدليل المحاسبي للشركة (coa-company.ts) بأطول بادئة رقم مطابقة.
 *
 * الربط الافتراضي يُطبَّق تلقائيًا على كل حساب (ومنه الحسابات التي تُضاف لاحقًا)، ويُعدَّل لأي حساب من تبويب
 * «الدليل وفق بنود القوائم» فيسري على الحساب وما تحته. والحساب الذي لا تطابقه قاعدة يذهب إلى البند «الآخر» حسب طبيعته
 * ويظهر في التنبيهات حتى يُراجع.
 */

export type FsStatement = 'bs' | 'is';
/** مجموعات العرض: الأصول المتداولة وغير المتداولة، والالتزامات المتداولة وغير المتداولة، وحقوق الملكية، وأقسام قائمة الدخل */
export type FsGroup = 'ca' | 'nca' | 'cl' | 'ncl' | 'eq' | 'rev' | 'cos' | 'opex' | 'other' | 'fin' | 'tax';
/** تصنيف البند في قائمة التدفقات النقدية بالطريقة غير المباشرة */
export type CashClass = 'cash' | 'operating' | 'investing' | 'financing';

export interface FsLine {
  code: string;
  statement: FsStatement;
  group: FsGroup;
  name: string;
  /** للبنود الميزانية فقط */
  cash?: CashClass;
  /** شرح السياسة أو المحتوى في الإيضاح */
  policy?: string;
}

export const FS_GROUP_NAME: Record<FsGroup, string> = {
  ca: 'الأصول المتداولة', nca: 'الأصول غير المتداولة', cl: 'الالتزامات المتداولة', ncl: 'الالتزامات غير المتداولة', eq: 'حقوق الملكية',
  rev: 'الإيرادات', cos: 'تكلفة الإيرادات', opex: 'المصاريف التشغيلية', other: 'الإيرادات والمصاريف الأخرى', fin: 'تكاليف التمويل', tax: 'الزكاة وضريبة الدخل',
};

export const FS_LINES: FsLine[] = [
  // ---------- قائمة المركز المالي ----------
  { code: 'BS-CA-CASH', statement: 'bs', group: 'ca', name: 'النقد وما في حكمه', cash: 'cash', policy: 'يشمل النقد في الصندوق والحسابات الجارية لدى البنوك والودائع التي تستحق خلال ثلاثة أشهر أو أقل.' },
  { code: 'BS-CA-INV', statement: 'bs', group: 'ca', name: 'استثمارات قصيرة الأجل', cash: 'investing', policy: 'استثمارات متوافقة مع الضوابط الشرعية تستحق خلال سنة، تُقاس بالتكلفة المطفأة أو القيمة العادلة.' },
  { code: 'BS-CA-AR', statement: 'bs', group: 'ca', name: 'ذمم مدينة تجارية، صافي', cash: 'operating', policy: 'تُثبت بقيمة الفاتورة ناقصًا مخصص الخسائر الائتمانية المتوقعة.' },
  { code: 'BS-CA-ACCR', statement: 'bs', group: 'ca', name: 'إيرادات مستحقة (أصول عقود)', cash: 'operating', policy: 'أعمال منجزة وفق العقود لم تصدر بها فواتير في تاريخ القوائم.' },
  { code: 'BS-CA-RP', statement: 'bs', group: 'ca', name: 'مستحق من جهات ذات علاقة', cash: 'operating' },
  { code: 'BS-CA-PREP', statement: 'bs', group: 'ca', name: 'مصروفات مدفوعة مقدمًا وأرصدة مدينة أخرى', cash: 'operating' },
  { code: 'BS-CA-STOCK', statement: 'bs', group: 'ca', name: 'المخزون', cash: 'operating', policy: 'يُقاس بالتكلفة أو صافي القيمة القابلة للتحقق أيهما أقل.' },
  { code: 'BS-CA-OTH', statement: 'bs', group: 'ca', name: 'أصول متداولة أخرى', cash: 'operating' },
  { code: 'BS-NCA-PPE', statement: 'bs', group: 'nca', name: 'ممتلكات ومعدات، صافي', cash: 'investing', policy: 'تُقاس بالتكلفة ناقصًا مجمع الإهلاك وأي خسائر هبوط، وتُهلك بطريقة القسط الثابت على العمر الإنتاجي لكل مجموعة.' },
  { code: 'BS-NCA-INT', statement: 'bs', group: 'nca', name: 'أصول غير ملموسة، صافي', cash: 'investing', policy: 'البرامج والتراخيص والمنهجيات، تُطفأ على عمرها الإنتاجي.' },
  { code: 'BS-NCA-WIP', statement: 'bs', group: 'nca', name: 'مشاريع رأسمالية تحت التنفيذ', cash: 'investing', policy: 'تتراكم فيها التكاليف حتى جاهزية الأصل للاستخدام، ولا تُهلك قبل ذلك.' },
  { code: 'BS-NCA-OTH', statement: 'bs', group: 'nca', name: 'استثمارات وأصول غير متداولة أخرى', cash: 'investing' },
  { code: 'BS-CL-LOAN', statement: 'bs', group: 'cl', name: 'قروض وتمويلات قصيرة الأجل', cash: 'financing' },
  { code: 'BS-CL-AP', statement: 'bs', group: 'cl', name: 'ذمم دائنة تجارية', cash: 'operating' },
  { code: 'BS-CL-RP', statement: 'bs', group: 'cl', name: 'مستحق لجهات ذات علاقة', cash: 'operating' },
  { code: 'BS-CL-ACCR', statement: 'bs', group: 'cl', name: 'مصروفات مستحقة وأرصدة دائنة أخرى', cash: 'operating' },
  { code: 'BS-CL-DEF', statement: 'bs', group: 'cl', name: 'دفعات مقدمة من العملاء وإيرادات مؤجلة', cash: 'operating' },
  { code: 'BS-CL-TAX', statement: 'bs', group: 'cl', name: 'ضريبة القيمة المضافة والاستقطاع المستحقة', cash: 'operating' },
  { code: 'BS-CL-ZAKAT', statement: 'bs', group: 'cl', name: 'الزكاة وضريبة الدخل المستحقة', cash: 'operating' },
  { code: 'BS-CL-OTH', statement: 'bs', group: 'cl', name: 'التزامات متداولة أخرى', cash: 'operating' },
  { code: 'BS-NCL-LOAN', statement: 'bs', group: 'ncl', name: 'قروض وتمويلات طويلة الأجل', cash: 'financing' },
  { code: 'BS-NCL-EOSB', statement: 'bs', group: 'ncl', name: 'مخصص مكافأة نهاية الخدمة', cash: 'operating', policy: 'يُحتسب وفق نظام العمل السعودي على أساس آخر راتب ومدة الخدمة في تاريخ القوائم.' },
  { code: 'BS-NCL-PROV', statement: 'bs', group: 'ncl', name: 'مخصصات أخرى', cash: 'operating' },
  { code: 'BS-NCL-OTH', statement: 'bs', group: 'ncl', name: 'التزامات غير متداولة أخرى', cash: 'financing' },
  { code: 'BS-EQ-CAP', statement: 'bs', group: 'eq', name: 'رأس المال', cash: 'financing' },
  { code: 'BS-EQ-RES', statement: 'bs', group: 'eq', name: 'الاحتياطيات', cash: 'financing' },
  { code: 'BS-EQ-GRANT', statement: 'bs', group: 'eq', name: 'منح ومساهمات رأسمالية', cash: 'financing' },
  { code: 'BS-EQ-OWNER', statement: 'bs', group: 'eq', name: 'جاري المالك', cash: 'financing' },
  { code: 'BS-EQ-RE', statement: 'bs', group: 'eq', name: 'الأرباح المبقاة (الفائض المتراكم)', cash: 'financing' },
  { code: 'BS-EQ-OTH', statement: 'bs', group: 'eq', name: 'بنود أخرى في حقوق الملكية', cash: 'financing' },
  // ---------- قائمة الدخل ----------
  { code: 'IS-REV', statement: 'is', group: 'rev', name: 'الإيرادات من العقود مع العملاء', policy: 'تُثبت الإيرادات عند الوفاء بالتزامات الأداء: الخدمات الاستشارية والمشاريع على مدى التنفيذ حسب نسبة الإنجاز أو المعالم المتفق عليها، والتدريب عند تقديمه. والإيرادات بعد خصم ضريبة القيمة المضافة.' },
  { code: 'IS-COS', statement: 'is', group: 'cos', name: 'تكلفة الإيرادات (التكاليف المباشرة للخدمات والمشاريع والتدريب)' },
  { code: 'IS-SELL', statement: 'is', group: 'opex', name: 'مصاريف البيع والتسويق' },
  { code: 'IS-GA', statement: 'is', group: 'opex', name: 'المصاريف العمومية والإدارية' },
  { code: 'IS-DEP', statement: 'is', group: 'opex', name: 'الإهلاك والإطفاء' },
  { code: 'IS-GOV', statement: 'is', group: 'opex', name: 'مصاريف الحوكمة' },
  { code: 'IS-INV-INC', statement: 'is', group: 'other', name: 'إيرادات الاستثمار' },
  { code: 'IS-OTH-INC', statement: 'is', group: 'other', name: 'إيرادات ومنح أخرى' },
  { code: 'IS-OTH-EXP', statement: 'is', group: 'other', name: 'مصاريف أخرى' },
  { code: 'IS-FIN', statement: 'is', group: 'fin', name: 'تكاليف التمويل' },
  { code: 'IS-ZAKAT', statement: 'is', group: 'tax', name: 'الزكاة وضريبة الدخل' },
];

export const FS_LINE = new Map(FS_LINES.map((l) => [l.code, l]));

/** الربط الافتراضي بأطول بادئة رقم (دليل الشركات) */
export const DEFAULT_RULES: [prefix: string, line: string][] = [
  ['111', 'BS-CA-CASH'], ['113', 'BS-CA-INV'],
  ['11401', 'BS-CA-PREP'], ['11402', 'BS-CA-AR'], ['11403', 'BS-CA-AR'], ['11404', 'BS-CA-PREP'], ['11404001', 'BS-CA-RP'],
  ['115', 'BS-CA-PREP'], ['116', 'BS-CA-ACCR'], ['117', 'BS-CA-STOCK'], ['118', 'BS-CA-PREP'],
  ['121', 'BS-NCA-PPE'], ['22501', 'BS-NCA-PPE'], ['122', 'BS-NCA-INT'], ['22502', 'BS-NCA-INT'], ['124', 'BS-NCA-WIP'], ['13', 'BS-NCA-OTH'],
  ['211', 'BS-CL-LOAN'], ['21302', 'BS-CL-AP'], ['21601', 'BS-CL-AP'], ['21303', 'BS-CL-RP'], ['21305', 'BS-CL-TAX'], ['21306', 'BS-CL-TAX'],
  ['214', 'BS-CL-ACCR'], ['21602', 'BS-CL-ACCR'], ['21403', 'BS-CL-ZAKAT'], ['215', 'BS-CL-DEF'],
  ['221', 'BS-NCL-LOAN'], ['22401', 'BS-NCL-EOSB'], ['22402', 'BS-NCL-PROV'],
  ['23104', 'BS-EQ-CAP'], ['23103', 'BS-EQ-RES'], ['23101', 'BS-EQ-RE'], ['23102', 'BS-EQ-GRANT'], ['23105', 'BS-EQ-OWNER'],
  ['311', 'IS-REV'], ['31106', 'IS-OTH-INC'], ['312', 'IS-OTH-INC'], ['313', 'IS-INV-INC'], ['314', 'IS-OTH-INC'],
  ['41', 'IS-GA'], ['413', 'IS-DEP'], ['414', 'IS-OTH-EXP'], ['42', 'IS-COS'], ['43', 'IS-ZAKAT'], ['44', 'IS-SELL'], ['45', 'IS-FIN'], ['46', 'IS-GOV'],
];

/** البند «الآخر» لكل طبيعة حساب حين لا تطابقه قاعدة ولا ربط يدوي */
export const FALLBACK: Record<AccountNature, string> = {
  assets: 'BS-CA-OTH', liabilities: 'BS-CL-OTH', net_assets: 'BS-EQ-OTH', revenue: 'IS-OTH-INC', expenses: 'IS-GA',
};

/** الربط الافتراضي لرقم حساب بأطول بادئة، أو null */
export function ruleFor(code: string): string | null {
  let best: [string, string] | null = null;
  for (const r of DEFAULT_RULES) if (code.startsWith(r[0]) && (!best || r[0].length > best[0].length)) best = r;
  return best?.[1] ?? null;
}

/** الحساب الميزاني يُربط ببند ميزانية، وحساب الإيرادات والمصروفات ببند في قائمة الدخل */
export const statementOf = (nature: AccountNature): FsStatement => (nature === 'revenue' || nature === 'expenses' ? 'is' : 'bs');

/** المصارف غير الربحية في المادة (4) من النظام الأساس (سياسة POL-FIN-03) */
export const NONPROFIT_CHANNELS = [
  'الأنشطة الدينية', 'التعليم والتدريب والأبحاث ومجالاتها', 'الشؤون الصحية والنفسية والتمريض وعلاج المرضى وخدماتها', 'برامج رعاية الأسرة والطفولة',
  'دعم برامج التأهيل المهني والصحي والاجتماعي والنفسي والعلمي', 'الآداب والثقافة والفنون والمواهب والهوايات وأنشطتها', 'التراث والسياحة والترفيه وأنشطتها',
  'دعم ورعاية الحرف والمهن بمختلف أنواعها', 'الأنشطة الرياضية', 'تقديم الخدمات القانونية لخدمة المجتمع', 'دعم ورعاية برامج المواطنة والتنمية الاجتماعية والاقتصادية',
  'دعم برامج توفير الإسكان لفئات المجتمع', 'برامج مكافحة الفقر وتقديم الإعانات لمستحقيها، ودعم الدخل وصيانته', 'أنشطة تقنية المعلومات والبيانات والذكاء الاصطناعي',
  'حماية البيئة والحياة الفطرية', 'دعم برامج ريادة الأعمال والمشروعات الصغيرة والمتوسطة وحماية المستهلك', 'إنشاء المستشفيات والمراكز الطبية أو تشغيلها أو صيانتها',
  'دعم وتمكين الاستثمار الاجتماعي والأعمال التطوعية',
];

/** حدود النظام الأساس (المادة 10) والمقترح في سياسة POL-FIN-03 (مسودة لم يعتمدها المجلس) */
export const PROFIT_POLICY = {
  maxDevelopmentPct: 30, maxDistributionPct: 10, minNonprofitPct: 70, reserveMonths: 6,
  defaults: { developmentPct: 30, distributionPct: 0 },
};
