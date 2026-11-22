/**
 * محتوى حزمة رعاية وطن الجاهزة (الخطة الاستراتيجية 2027 - 2030) لأقسام نظام المخاطر التي لا تُستورد من Excel:
 * الضوابط الرقابية، وسجل الالتزام، واستمرارية الأعمال، وفريق الأزمات. كل خطر مُشار إليه برمزه في ملف المخاطر (R01 ...).
 * الفريق الحالي متعاونون: د. سلمان المطيري (العضو المنتدب)، سيد محمد سيد، عبدالإله السراء، ماجد القادري، أحمد عبدالفتاح.
 */
export const PACK_CODE = 'rw-plan-2027';
export const PACK_FILES = { risk: '1-risk.xlsx', strategic: '2-strategic.xlsx', operational: '3-operational.xlsx', budget: '4-budget.xlsx' };
export const PACK_BUDGET = { title: 'الموازنة التقديرية لشركة رعاية وطن 2027', fiscalYear: 2027, description: 'سنة الأساس (أول سنة تشغيل). مبنية على الخطة التشغيلية 2027 وفريق من المتعاونين دون رواتب أو تأمينات.' };
export const PACK_POLICY = { effectiveDate: '2027-01-01', note: 'الإصدار الأول للائحة إدارة المخاطر مع الخطة الاستراتيجية 2027 - 2030', approvedBy: 'مجلس المديرين' };

const SALMAN = 'د. سلمان المطيري (العضو المنتدب)';
const SAYED = 'سيد محمد سيد';
const ABDULELAH = 'عبدالإله السراء';
const MAJED = 'ماجد القادري';
const AHMED = 'أحمد عبدالفتاح';

type Freq = 'once' | 'monthly' | 'quarterly' | 'semiannual' | 'annual' | 'continuous';

export const PACK_CONTROLS: { name: string; description: string; type: 'preventive' | 'detective' | 'corrective' | 'directive'; automated: boolean; frequency: Freq; ownerName: string; risks: string[] }[] = [
  { name: 'فصل المهام في النظام: المنشئ لا يعتمد، وتوقيعان على كل دفعة', description: 'مسارات الاعتماد في النظام تمنع من أنشأ السند أو الدفعة من اعتمادها، وتحتاج كل دفعة بنكية توقيعين.', type: 'preventive', automated: true, frequency: 'continuous', ownerName: ABDULELAH, risks: ['R22', 'R03'] },
  { name: 'تسوية بنكية شهرية يراجعها غير المحاسب', description: 'يعد المحاسب التسوية في النظام، ويراجعها مسؤول الإدارة المالية ويوقعها.', type: 'detective', automated: false, frequency: 'monthly', ownerName: ABDULELAH, risks: ['R22'] },
  { name: 'توقع نقدي لثلاثة أشهر قادمة يُحدَّث كل أسبوع', description: 'جدول التحصيلات والمدفوعات المتوقعة، ويُبلَّغ العضو المنتدب إذا قلّ الرصيد المتوقع عن شهر واحد من المصروفات.', type: 'detective', automated: false, frequency: 'monthly', ownerName: ABDULELAH, risks: ['R03', 'R04'] },
  { name: 'متابعة أعمار الذمم شهريًا ودفعة مقدمة في كل عقد', description: 'تقرير أعمار الذمم من النظام، ودفعة مقدمة لا تقل عن 30%، وتوقف الأعمال الجديدة للعميل المتأخر أكثر من 60 يومًا.', type: 'preventive', automated: false, frequency: 'monthly', ownerName: AHMED, risks: ['R04', 'R03'] },
  { name: 'إصدار الفواتير الإلكترونية من النظام ومطابقة الإقرار الربعي', description: 'كل فاتورة تصدر من نظام الفوترة المربوط بمنصة فاتورة، ويُطابق الإقرار الربعي مع دفتر الضريبة قبل تقديمه.', type: 'preventive', automated: true, frequency: 'quarterly', ownerName: AHMED, risks: ['R05'] },
  { name: 'اعتماد مجلس المديرين لعقود الجمعية المالكة بأسعار عادلة موثقة', description: 'عقدا إدارة الأصول والخدمات المساندة يُعتمدان من المجلس مع مذكرة تسعير، ويُفصح عنهما في القوائم المالية.', type: 'directive', automated: false, frequency: 'annual', ownerName: MAJED, risks: ['R07', 'R01'] },
  { name: 'نسخ احتياطي يومي خارج الخادم واختبار استرجاع ربعي', description: 'نسخة يومية مشفرة في موقع منفصل، واختبار استرجاع كل ربع يُوثَّق في سجل الضابط.', type: 'corrective', automated: true, frequency: 'quarterly', ownerName: SAYED, risks: ['R11'] },
  { name: 'التحقق الثنائي وصلاحيات بحسب الدور في الأنظمة', description: 'تفعيل التحقق الثنائي لكل الحسابات، ومراجعة الصلاحيات كل ستة أشهر وعند انتهاء أي تعاقد.', type: 'preventive', automated: true, frequency: 'semiannual', ownerName: SAYED, risks: ['R10', 'R11'] },
  { name: 'مراجعة جودة إلزامية قبل تسليم أي مخرج للعميل', description: 'مراجعة من شخص غير معد المخرج وفق قائمة تحقق، وقياس رضا العميل بعد التسليم.', type: 'preventive', automated: false, frequency: 'continuous', ownerName: SAYED, risks: ['R18', 'R19'] },
  { name: 'مراجعة نظامية للعقود والتوزيعات والمنتجات الجديدة قبل اعتمادها', description: 'كل عقد جوهري أو توزيع للفائض أو منتج وقفي جديد يُراجع نظاميًا مقابل شروط الشركة غير الربحية قبل رفعه للمجلس.', type: 'preventive', automated: false, frequency: 'continuous', ownerName: ABDULELAH, risks: ['R06', 'R13', 'R20'] },
];

export const PACK_OBLIGATIONS: { title: string; authority: string; reference?: string; description?: string; ownerName: string; frequency: Freq; nextDueDate?: string; risk?: string }[] = [
  { title: 'تقديم إقرار ضريبة القيمة المضافة الربعي وسداد الضريبة في موعدها', authority: 'هيئة الزكاة والضريبة والجمارك', reference: 'نظام ضريبة القيمة المضافة ولائحته التنفيذية', ownerName: AHMED, frequency: 'quarterly', nextDueDate: '2027-01-31', risk: 'R05' },
  { title: 'إصدار الفواتير الإلكترونية وربطها بمنصة فاتورة', authority: 'هيئة الزكاة والضريبة والجمارك', reference: 'لائحة الفوترة الإلكترونية', ownerName: AHMED, frequency: 'continuous', risk: 'R05' },
  { title: 'المحافظة على شروط الشركة غير الربحية وتوجيه الفائض لأغراضها', authority: 'نظام الشركات واللائحة التنفيذية للشركات غير الربحية', description: 'لا توزيع للأرباح على الشريك إلا وفق نظام الشركة، ولا نشاط خارج أغراضها.', ownerName: ABDULELAH, frequency: 'annual', risk: 'R06' },
  { title: 'إعداد القوائم المالية السنوية ومراجعتها من مراجع خارجي وإيداعها', authority: 'وزارة التجارة', ownerName: ABDULELAH, frequency: 'annual', nextDueDate: '2028-04-30', risk: 'R08' },
  { title: 'تجديد السجل التجاري وعضوية الغرفة التجارية', authority: 'وزارة التجارة', ownerName: ABDULELAH, frequency: 'annual' },
  { title: 'عقد اجتماعات مجلس المديرين وتوثيق محاضرها وقراراتها', authority: 'اللائحة الأساسية للشركة', ownerName: MAJED, frequency: 'quarterly', risk: 'R08' },
  { title: 'الإفصاح عن التعاملات مع الأطراف ذات العلاقة واعتمادها', authority: 'نظام الشركات واللائحة التنفيذية للشركات غير الربحية', ownerName: MAJED, frequency: 'annual', risk: 'R07' },
  { title: 'حماية البيانات الشخصية: سجل أنشطة المعالجة وإشعار الخصوصية والموافقات', authority: 'نظام حماية البيانات الشخصية', ownerName: SAYED, frequency: 'continuous', risk: 'R10' },
  { title: 'عقود مكتوبة وموقعة مع كل متعاون قبل بدء العمل', authority: 'السياسات الداخلية', ownerName: ABDULELAH, frequency: 'continuous', risk: 'R17' },
];

type Step = { title: string; ownerName: string; withinHours: number };
export const PACK_CONTINUITY: {
  activity: string; ownerName: string; description: string; impacts: { financial: number; beneficiaries: number; reputation: number; legal: number; operational: number };
  mtpdHours: number; rtoHours: number; rpoHours: number | null; minResources: string; strategy: string;
  dependencies: { kind: 'people' | 'system' | 'supplier' | 'facility' | 'data'; name: string }[]; steps: Step[]; risks: string[];
}[] = [
  {
    activity: 'الخدمات المساندة وإدارة أصول جمعية عناية', ownerName: SAYED, description: 'الجانب الأكبر من إيرادات 2027: المالية والموارد البشرية والمشتريات والتقنية للجمعية، وإدارة أصولها وتأجيرها.',
    impacts: { financial: 5, beneficiaries: 3, reputation: 4, legal: 3, operational: 4 }, mtpdHours: 168, rtoHours: 72, rpoHours: 24,
    minResources: 'متعاون واحد للمالية ومتعاون للأصول، والوصول إلى الأنظمة وعقود المستأجرين', strategy: 'توزيع المهام الحرجة على متعاونين اثنين لكل دور، وإجراءات موثقة في النظام يستطيع البديل تنفيذها',
    dependencies: [{ kind: 'people', name: ABDULELAH }, { kind: 'people', name: SAYED }, { kind: 'system', name: 'نظام الشركة (ERP)' }, { kind: 'data', name: 'عقود المستأجرين وسجل الأصول' }],
    steps: [{ title: 'إبلاغ الجمعية بالتوقف وتحديد المهام العاجلة', ownerName: SALMAN, withinHours: 4 }, { title: 'تكليف البديل المعتمد لكل دور حرج', ownerName: ABDULELAH, withinHours: 24 }, { title: 'استئناف التحصيل والمدفوعات العاجلة', ownerName: ABDULELAH, withinHours: 72 }],
    risks: ['R01', 'R09', 'R17'],
  },
  {
    activity: 'الأنظمة الإلكترونية: نظام الشركة والبريد والموقع', ownerName: SAYED, description: 'الخادم السحابي ونظام الشركة والبريد والموقع الإلكتروني وبوابة الموظفين.',
    impacts: { financial: 3, beneficiaries: 3, reputation: 4, legal: 3, operational: 5 }, mtpdHours: 48, rtoHours: 24, rpoHours: 24,
    minResources: 'مسؤول تقنية المعلومات، وآخر نسخة احتياطية، وحساب مزود الاستضافة', strategy: 'استرجاع آخر نسخة احتياطية على خادم بديل، وتشغيل البريد من مزوده مباشرة',
    dependencies: [{ kind: 'system', name: 'الخادم السحابي' }, { kind: 'supplier', name: 'مزود الاستضافة' }, { kind: 'supplier', name: 'مزود البريد الإلكتروني' }, { kind: 'data', name: 'النسخ الاحتياطية اليومية' }],
    steps: [{ title: 'تحديد سبب التعطل وإبلاغ المستخدمين', ownerName: SAYED, withinHours: 2 }, { title: 'استرجاع آخر نسخة احتياطية على خادم بديل', ownerName: SAYED, withinHours: 12 }, { title: 'التحقق من سلامة البيانات وإعادة فتح الأنظمة', ownerName: SAYED, withinHours: 24 }],
    risks: ['R11', 'R10'],
  },
  {
    activity: 'تنفيذ المشاريع الاستشارية والتدريبية للعملاء', ownerName: SAYED, description: 'مشاريع الحوكمة والتخطيط وقياس الأثر والتحول الرقمي والتدريب الصحي للجمعيات.',
    impacts: { financial: 4, beneficiaries: 4, reputation: 4, legal: 2, operational: 3 }, mtpdHours: 240, rtoHours: 120, rpoHours: null,
    minResources: 'مدير المشروع، والخبير المتعاون، وملفات المشروع', strategy: 'شبكة خبراء متعاونين بعقود جاهزة، وملفات كل مشروع محفوظة في النظام لا على أجهزة الأفراد',
    dependencies: [{ kind: 'people', name: 'الخبراء المتعاونون' }, { kind: 'data', name: 'ملفات المشاريع' }, { kind: 'facility', name: 'قاعات التدريب' }],
    steps: [{ title: 'إبلاغ العميل بخطة بديلة وموعد جديد', ownerName: SAYED, withinHours: 24 }, { title: 'تكليف خبير بديل من شبكة المتعاونين', ownerName: SAYED, withinHours: 72 }],
    risks: ['R17', 'R18', 'R02'],
  },
  {
    activity: 'المالية والمدفوعات والإقرارات الضريبية', ownerName: ABDULELAH, description: 'الصرف والتحصيل والفوترة الإلكترونية وإقرارات ضريبة القيمة المضافة.',
    impacts: { financial: 5, beneficiaries: 2, reputation: 3, legal: 5, operational: 4 }, mtpdHours: 72, rtoHours: 48, rpoHours: 24,
    minResources: 'المحاسب أو بديله، والوصول للبنك الإلكتروني ومنصة فاتورة', strategy: 'صلاحيتان على البنك الإلكتروني لشخصين، والمحاسب البديل مسجل في منصة الهيئة',
    dependencies: [{ kind: 'people', name: AHMED }, { kind: 'supplier', name: 'البنك' }, { kind: 'system', name: 'منصة فاتورة' }],
    steps: [{ title: 'تكليف المحاسب البديل', ownerName: ABDULELAH, withinHours: 24 }, { title: 'سداد الالتزامات العاجلة بتوقيعين', ownerName: ABDULELAH, withinHours: 48 }],
    risks: ['R03', 'R05', 'R22'],
  },
];

export const PACK_CRISIS_TEAM = {
  name: 'فريق إدارة الأزمات والطوارئ', kind: 'crisis' as const,
  mandate: 'إدارة أي حدث يهدد استمرار خدمات الشركة أو أموالها أو سمعتها أو سمعة الجمعية المالكة، حتى العودة للوضع الطبيعي.',
  members: [
    { name: 'د. سلمان المطيري', teamRole: 'قائد الفريق (العضو المنتدب)' },
    { name: SAYED, teamRole: 'مسؤول التقنية والمخاطر' },
    { name: ABDULELAH, teamRole: 'مسؤول المالية والصرف الطارئ' },
    { name: MAJED, teamRole: 'الاتصال وأعمال المجلس' },
    { name: AHMED, teamRole: 'المحاسبة والإقرارات' },
  ],
  authorities: [
    { authority: 'اعتماد صرف طارئ لاستمرار الخدمة', holder: 'قائد الفريق', limit: 'حتى 20,000 ريال لكل حالة، ويُعرض على المجلس في أول اجتماع' },
    { authority: 'التعاقد المباشر مع مزود أو خبير بديل', holder: 'مسؤول المالية والصرف الطارئ', limit: 'حتى 10,000 ريال' },
    { authority: 'التواصل مع العملاء والجمعية المالكة ووسائل الإعلام', holder: 'الاتصال وأعمال المجلس', limit: null },
  ],
  playbook: [
    { title: 'تقييم الموقف وتحديد شدة الأزمة', ownerName: 'قائد الفريق', withinHours: 2 },
    { title: 'إبلاغ رئيس مجلس المديرين والجمعية المالكة', ownerName: 'الاتصال وأعمال المجلس', withinHours: 6 },
    { title: 'تفعيل خطط التعافي المرتبطة', ownerName: 'مسؤول التقنية والمخاطر', withinHours: 12 },
    { title: 'بيان للعملاء المتأثرين', ownerName: 'الاتصال وأعمال المجلس', withinHours: 24 },
  ],
  communication: 'مجموعة تواصل للفريق، واجتماع يومي خلال الأزمة، وتقرير يومي لرئيس مجلس المديرين.',
};
