import type { WfStage } from './entities/planning.entity';

/** مستوى في هيكل الخطة (محور، هدف، مبادرة، برنامج، نشاط، مهمة...) */
export interface PlanLevel { key: string; name: string; prefix: string }
/** حقل إضافي يعرّفه المستخدم المخول ويظهر في نموذج عناصر الخطة */
export interface CustomField { key: string; label: string; type: 'text' | 'number' | 'date' | 'select'; options: string[]; appliesTo: 'strategic' | 'operational' | 'all' }
/**
 * مسار اعتماد: يُختار آليًا حسب نوع الخطة والإدارة والتكلفة التقديرية الإجمالية.
 * عند تطابق أكثر من مسار يُختار الأكثر تحديدًا (الإدارة ثم أعلى حد تكلفة).
 */
export interface WorkflowRoute { key: string; name: string; planKind: 'strategic' | 'operational' | 'budget' | 'transfer' | 'any'; unitId: string | null; minCost: number | null; stages: WfStage[] }

export interface PlanningConfig {
  strategicLevels: PlanLevel[];
  operationalLevels: PlanLevel[];
  relationTypes: { code: string; name: string }[];
  kpiUnits: string[];
  /** حدود ألوان تحقق المؤشرات: أخضر من green%، أصفر من amber%، وأحمر دونها */
  thresholds: { green: number; amber: number };
  /** هامش التأخر المسموح (نقاط مئوية بين الإنجاز المخطط والفعلي) قبل اعتبار العنصر متأخرًا */
  delayTolerance: number;
  customFields: CustomField[];
  routes: WorkflowRoute[];
}

export const STRATEGIC_LEVELS: PlanLevel[] = [
  { key: 'pillar', name: 'محور استراتيجي', prefix: 'P' },
  { key: 'goal', name: 'هدف استراتيجي', prefix: 'G' },
  { key: 'initiative', name: 'مبادرة', prefix: 'I' },
];
export const OPERATIONAL_LEVELS: PlanLevel[] = [
  { key: 'program', name: 'برنامج أو مشروع', prefix: 'B' },
  { key: 'activity', name: 'نشاط', prefix: 'A' },
  { key: 'task', name: 'مهمة', prefix: 'T' },
];

/** مرحلتا اعتماد الخطط والموازنة: الأولى الاعتماد الأولي من الإدارة التنفيذية، والأخيرة الاعتماد النهائي من مجلس المديرين */
export const INITIAL_STAGE = 'الاعتماد الأولي من الإدارة التنفيذية';
export const BOARD_STAGE = 'الاعتماد النهائي من مجلس المديرين';
export const BOARD_STAGES = (): WfStage[] => [{ name: INITIAL_STAGE, roleId: null }, { name: BOARD_STAGE, roleId: null }];
/** أنواع المسارات التي تمر بمرحلتي الاعتماد الأولي والمجلس */
export const BOARD_ROUTE_KINDS = ['strategic', 'operational', 'budget'] as const;

export function defaultConfig(): PlanningConfig {
  return {
    strategicLevels: STRATEGIC_LEVELS.map((l) => ({ ...l })),
    operationalLevels: OPERATIONAL_LEVELS.map((l) => ({ ...l })),
    relationTypes: [
      { code: 'contributes', name: 'يسهم في تحقيق' },
      { code: 'supports', name: 'يدعم' },
      { code: 'depends', name: 'يعتمد على' },
    ],
    kpiUnits: ['%', 'عدد', 'ريال', 'ساعة', 'يوم', 'درجة'],
    thresholds: { green: 90, amber: 70 },
    delayTolerance: 10,
    customFields: [],
    // رعاية وطن (قرار المالك 2026-11-24): الخطط والموازنة تمر بمرحلتين؛ الاعتماد الأولي من الإدارة التنفيذية،
    // وبعده يُطبع تقرير الاعتماد ويُرفع لمجلس المديرين، ثم الاعتماد النهائي من المجلس
    routes: [
      { key: 'strategic', name: 'اعتماد الخطة الاستراتيجية', planKind: 'strategic', unitId: null, minCost: null, stages: BOARD_STAGES() },
      { key: 'operational', name: 'اعتماد الخطة التشغيلية', planKind: 'operational', unitId: null, minCost: null, stages: BOARD_STAGES() },
      { key: 'budget', name: 'اعتماد الموازنة التقديرية', planKind: 'budget', unitId: null, minCost: null, stages: BOARD_STAGES() },
      {
        key: 'transfer', name: 'اعتماد مناقلات الموازنة وتعديلاتها', planKind: 'transfer', unitId: null, minCost: null,
        stages: [{ name: 'مراجعة الإدارة المالية', roleId: null }, { name: 'اعتماد المدير التنفيذي', roleId: null }],
      },
      {
        key: 'transfer-large', name: 'مناقلة أو تعديل بمئتي ألف ريال فأكثر', planKind: 'transfer', unitId: null, minCost: 200_000,
        stages: [{ name: 'مراجعة الإدارة المالية', roleId: null }, { name: 'اعتماد المدير التنفيذي', roleId: null }, { name: 'اعتماد مجلس الإدارة', roleId: null }],
      },
    ],
  };
}

/** دمج الإعدادات المحفوظة مع الافتراضية (لأي حقل أُضيف لاحقًا) */
export function mergeConfig(saved: Partial<PlanningConfig> | null | undefined): PlanningConfig {
  const d = defaultConfig();
  const s = saved ?? {};
  const out = { ...d, ...s, thresholds: { ...d.thresholds, ...(s.thresholds ?? {}) } };
  // الإعدادات المحفوظة قبل إضافة الموازنات: يُضاف مسار اعتماد الموازنة المقترح
  if (s.routes && !s.routes.some((r) => r.planKind === 'budget' || r.planKind === 'any')) out.routes = [...s.routes, ...d.routes.filter((r) => r.planKind === 'budget')];
  // وقبل إضافة المناقلات: يُضاف مساراها المقترحان
  if (s.routes && !s.routes.some((r) => r.planKind === 'transfer' || r.planKind === 'any')) out.routes = [...out.routes, ...d.routes.filter((r) => r.planKind === 'transfer')];
  return out;
}

// ---------------------------------------------------------------- القوالب الجاهزة

export interface TemplateKpi { name: string; unit: string; direction?: 'up' | 'down'; aggregation?: 'last' | 'sum' | 'avg'; baseline?: number; target: number; dataSource?: string }
export interface TemplateItem { title: string; description?: string; kpis?: TemplateKpi[]; children?: TemplateItem[] }
export interface PlanTemplate {
  key: string; name: string; description: string; kind: 'strategic' | 'operational'; periodicity: 'annual' | 'semiannual' | 'quarterly' | 'monthly';
  levels: PlanLevel[]; vision?: string; mission?: string; values?: string[]; items: TemplateItem[];
}

const k = (name: string, unit: string, target: number, extra: Partial<TemplateKpi> = {}): TemplateKpi => ({ name, unit, target, ...extra });

/**
 * قوالب مقترحة للشركة: تُنسخ عند إنشاء الخطة ثم تُعدّل بحرية.
 */
export const PLAN_TEMPLATES: PlanTemplate[] = [
  {
    key: 'ncnp-strategic', kind: 'strategic', periodicity: 'annual', levels: STRATEGIC_LEVELS,
    name: 'الخطة الاستراتيجية للشركة',
    description: 'أربعة محاور تغطي أثر العملاء وجودة الخدمات، والاستدامة المالية، والحوكمة والتميز المؤسسي، والشراكات والمسؤولية المجتمعية، بأهداف ومؤشرات قابلة للقياس.',
    vision: 'شريك موثوق للقطاع غير الربحي في بناء منظمات قوية وأثر مستدام',
    mission: 'تقديم استشارات وحلول نوعية في التخطيط والحوكمة وقياس الأثر والاستدامة المالية والتقنية، بخبرة متخصصة ونتائج قابلة للقياس',
    values: ['الأمانة', 'الشفافية', 'الإتقان', 'الشراكة', 'الاستدامة'],
    items: [
      {
        title: 'أثر العملاء وجودة الخدمات',
        children: [
          {
            title: 'رفع جودة الخدمات الاستشارية وقياس أثرها لدى العملاء',
            kpis: [k('نسبة رضا العملاء عن الخدمات', '%', 85, { baseline: 75 }), k('عدد الجهات المخدومة', 'عدد', 60, { aggregation: 'sum', baseline: 30 })],
            children: [{ title: 'تطبيق منهجية لقياس أثر المشاريع لدى العملاء' }, { title: 'تطوير معايير الخدمة وأدلة الإجراءات' }],
          },
          {
            title: 'تنمية قاعدة العملاء وتكرار التعاقد',
            kpis: [k('نسبة العملاء الذين يتعاقدون مرة أخرى', '%', 40, { baseline: 20 })],
            children: [{ title: 'برنامج متابعة العملاء بعد التسليم' }],
          },
        ],
      },
      {
        title: 'الاستدامة المالية',
        children: [
          {
            title: 'تنويع مصادر الإيرادات وزيادتها',
            kpis: [k('نسبة نمو الإيرادات السنوية', '%', 20, { baseline: 8 }), k('نسبة الإيرادات من العقود المتكررة والباقات السنوية', '%', 30, { baseline: 10 })],
            children: [{ title: 'باقات خدمات سنوية للعملاء' }, { title: 'برنامج العقود الإطارية' }],
          },
          {
            title: 'رفع كفاءة الإنفاق',
            kpis: [
              k('نسبة الإنفاق على المشاريع والخدمات من إجمالي المصروفات', '%', 75, { baseline: 65, dataSource: 'النظام المالي: القوائم المالية' }),
              k('نسبة المصروفات العمومية والإدارية', '%', 15, { direction: 'down', baseline: 22, dataSource: 'النظام المالي: القوائم المالية' }),
            ],
          },
        ],
      },
      {
        title: 'الحوكمة والتميز المؤسسي',
        children: [
          {
            title: 'الالتزام بمعايير الحوكمة والشفافية',
            kpis: [k('درجة التقييم الذاتي للحوكمة', '%', 90, { baseline: 78, dataSource: 'نظام الحوكمة: التقييم الذاتي' })],
            children: [{ title: 'استكمال السياسات واللوائح ونشرها' }],
          },
          {
            title: 'تطوير رأس المال البشري',
            kpis: [k('متوسط ساعات التدريب لكل موظف', 'ساعة', 30, { baseline: 12 }), k('نسبة الاحتفاظ بالموظفين', '%', 90, { baseline: 82 })],
            children: [{ title: 'برنامج تطوير القيادات والصف الثاني' }],
          },
          {
            title: 'التحول الرقمي وتميز العمليات',
            kpis: [k('نسبة الإجراءات المؤتمتة', '%', 80, { baseline: 40 })],
            children: [{ title: 'أتمتة الإجراءات الرئيسية' }, { title: 'تطبيق نظام إدارة الجودة ISO 9001' }],
          },
        ],
      },
      {
        title: 'الشراكات والمسؤولية المجتمعية',
        children: [
          {
            title: 'بناء شراكات استراتيجية فاعلة',
            kpis: [k('عدد الشراكات الفاعلة', 'عدد', 12, { baseline: 5 })],
            children: [{ title: 'برنامج الشراكة مع القطاع الخاص' }],
          },
          {
            title: 'دعم الجمعيات الناشئة بخدمات مجانية',
            kpis: [k('عدد ساعات الاستشارات المجانية', 'ساعة', 500, { aggregation: 'sum', baseline: 100 })],
            children: [{ title: 'برنامج الاستشارات المجانية للجمعيات الناشئة' }],
          },
        ],
      },
    ],
  },
  {
    key: 'bsc', kind: 'strategic', periodicity: 'quarterly',
    levels: [{ key: 'perspective', name: 'منظور', prefix: 'V' }, { key: 'goal', name: 'هدف استراتيجي', prefix: 'G' }, { key: 'initiative', name: 'مبادرة', prefix: 'I' }],
    name: 'بطاقة الأداء المتوازن',
    description: 'أربعة منظورات: العملاء والمجتمع، والمالية، والعمليات الداخلية، والتعلم والنمو، بمتابعة ربع سنوية.',
    items: [
      { title: 'العملاء والمجتمع', children: [{ title: 'زيادة رضا العملاء والشركاء', kpis: [k('مؤشر رضا العملاء', '%', 85), k('مؤشر رضا الشركاء', '%', 85)] }] },
      { title: 'المالية', children: [{ title: 'نمو الإيرادات وضبط المصروفات', kpis: [k('نسبة تحقيق مستهدف الإيرادات', '%', 100), k('نسبة المصروفات الإدارية', '%', 15, { direction: 'down' })] }] },
      { title: 'العمليات الداخلية', children: [{ title: 'رفع كفاءة العمليات', kpis: [k('متوسط مدة إعداد العرض الفني', 'يوم', 5, { direction: 'down' })] }] },
      { title: 'التعلم والنمو', children: [{ title: 'تطوير الكفاءات', kpis: [k('نسبة تنفيذ خطة التدريب', '%', 90)] }] },
    ],
  },
  {
    key: 'operational-dept', kind: 'operational', periodicity: 'quarterly', levels: OPERATIONAL_LEVELS,
    name: 'خطة تشغيلية لإدارة',
    description: 'برامج وأنشطة ومهام بمدد ومسؤولين ومعالم وتكاليف، ومتابعة ربع سنوية لنسب الإنجاز.',
    items: [
      { title: 'البرنامج الأول', children: [{ title: 'نشاط', children: [] }] },
    ],
  },
];

/** ما يمكن للمستخدم المخول تهيئته دون برمجة في المرحلة الحالية (يظهر في الإعدادات) */
export const CONFIGURABLE = [
  'إنشاء أي عدد من الخطط الاستراتيجية (متعددة السنوات) والتشغيلية (للإدارات أو مشتركة بينها أو على مستوى الشركة)',
  'تسمية مستويات الهيكل وعددها (حتى 6 مستويات) ورموزها، لكل خطة على حدة',
  'دورية المتابعة لكل خطة ولكل مؤشر: سنوية أو نصف سنوية أو ربع سنوية أو شهرية',
  'أنواع العلاقات بين العناصر ونسب المساهمة والأوزان',
  'وحدات قياس المؤشرات واتجاهها وطريقة تجميع قراءاتها وحدود ألوان التحقق',
  'حقول إضافية لعناصر الخطط (نص، رقم، تاريخ، قائمة)',
  'مسارات اعتماد مختلفة حسب نوع الخطة والإدارة والتكلفة الإجمالية، ومراحلها والأدوار المخولة',
  'هامش التأخر المسموح قبل اعتبار النشاط متأخرًا',
  'معادلات احتساب الموازنة (حسابية وشرطية) بإصدارات، واختبارها قبل تفعيلها، دون تعديل برمجي',
  'متغيرات وافتراضات الموازنة (عامة أو لإدارة، وبقيم مرحلية خلال السنة) وقواعد العلاوات حسب الإدارة والمرتبة والوظيفة والتقييم والجنسية',
  'طريقة تقدير كل بند: عدد سنوات التاريخ، طريقة المتوسط، الاستبعادات، نسبة الزيادة، العقود الجديدة والمنتهية، والتوزيع الشهري',
  'منهجية كل بند (أنشطة، أداء، تاريخية، صفرية، من الأعلى، من الأسفل) وسقوف الإدارات',
  'صلاحيات كل دور في النظام',
];
export const NEEDS_DEVELOPMENT = [
  'السيناريوهات وتحليل الحساسية (المرحلة الثالثة)',
  'تصدير الموازنة المعتمدة للنظام المالي ومتابعة الصرف والمناقلات (المرحلة الرابعة)',
  'الربط بالمخاطر والمراجعة الداخلية والأداء الوظيفي وPESTEL وSWOT (المرحلة الخامسة)',
];
