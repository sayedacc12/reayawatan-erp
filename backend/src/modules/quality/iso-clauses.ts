/**
 * بنود مواصفة ISO 9001:2015 من 4 إلى 10، وأين يُطبَّق كل بند في سنابل.
 * evidence: مفتاح الدليل الذي يحسبه تقرير المطابقة من بيانات الشركة.
 */
export interface IsoClause { code: string; title: string; how: string; path: string; evidence: string }

export const ISO_SECTIONS: { code: string; title: string }[] = [
  { code: '4', title: 'سياق المنظمة' },
  { code: '5', title: 'القيادة' },
  { code: '6', title: 'التخطيط' },
  { code: '7', title: 'الدعم' },
  { code: '8', title: 'التشغيل' },
  { code: '9', title: 'تقييم الأداء' },
  { code: '10', title: 'التحسين' },
];

export const ISO_CLAUSES: IsoClause[] = [
  { code: '4.1', title: 'فهم المنظمة وسياقها', how: 'القضايا الداخلية والخارجية في سياق الشركة', path: '/quality/context', evidence: 'issues' },
  { code: '4.2', title: 'فهم احتياجات الأطراف المعنية وتوقعاتها', how: 'سجل الأطراف المعنية واحتياجاتها وطريقة متابعتها', path: '/quality/context', evidence: 'parties' },
  { code: '4.3', title: 'تحديد نطاق نظام إدارة الجودة', how: 'نطاق النظام والاستثناءات ومبرراتها', path: '/quality/context', evidence: 'scope' },
  { code: '4.4', title: 'نظام إدارة الجودة وعملياته', how: 'قائمة العمليات ومُلّاكها ومؤشراتها، وخرائط الإجراءات', path: '/quality/maps', evidence: 'processes' },
  { code: '5.1', title: 'القيادة والالتزام', how: 'مراجعة الإدارة المعتمدة وقراراتها', path: '/quality/reviews', evidence: 'reviews' },
  { code: '5.2', title: 'سياسة الجودة', how: 'سياسة الجودة المعتمدة والمنشورة للموظفين', path: '/quality/context', evidence: 'policy' },
  { code: '5.3', title: 'الأدوار والمسؤوليات والصلاحيات', how: 'مسؤوليات الجودة، والأوصاف الوظيفية في الموارد البشرية، وصلاحيات الأدوار', path: '/quality/context', evidence: 'responsibilities' },
  { code: '6.1', title: 'إجراءات التعامل مع المخاطر والفرص', how: 'سجل المخاطر والفرص بالتقييم وخطط المعالجة', path: '/quality/risks', evidence: 'risks' },
  { code: '6.2', title: 'أهداف الجودة والتخطيط لتحقيقها', how: 'أهداف قابلة للقياس بمؤشرات وخطط ومسؤولين', path: '/quality/objectives', evidence: 'objectives' },
  { code: '6.3', title: 'التخطيط للتغييرات', how: 'طلبات تعديل الوثائق بملخص التغيير ومسار الاعتماد', path: '/quality/documents', evidence: 'changes' },
  { code: '7.1', title: 'الموارد (البشرية، البنية التحتية، بيئة العمل، المعرفة)', how: 'قرارات الموارد في مراجعة الإدارة والهيكل التنظيمي', path: '/quality/reviews', evidence: 'resources' },
  { code: '7.2', title: 'الكفاءة', how: 'الأوصاف الوظيفية والجدارات وبطاقات الأداء في الموارد البشرية', path: '/hr/jobs', evidence: 'competence' },
  { code: '7.3', title: 'الوعي', how: 'توزيع الوثائق والسياسة على الموظفين وتأكيد استلامها', path: '/quality/documents', evidence: 'awareness' },
  { code: '7.4', title: 'التواصل', how: 'قنوات الشكاوى والاستبانات والتواصل مع الأطراف المعنية', path: '/quality/complaints', evidence: 'communication' },
  { code: '7.5', title: 'المعلومات الموثقة', how: 'سجل الوثائق المضبوطة: الترميز والإصدارات والاعتماد والتوزيع وسحب الملغى', path: '/quality/documents', evidence: 'documents' },
  { code: '8.1', title: 'التخطيط للتشغيل والتحكم فيه', how: 'الإجراءات المعتمدة وسير العمل في الأنظمة', path: '/quality/procedures', evidence: 'procedures' },
  { code: '8.2', title: 'متطلبات الخدمات (التواصل مع العملاء)', how: 'نماذج الموقع وطلبات العملاء والنماذج المعتمدة', path: '/quality/documents', evidence: 'forms' },
  { code: '8.3', title: 'تصميم الخدمات وتطويرها', how: 'إعداد خدمات الشركة واعتمادها ونشرها في الموقع', path: '/website/services', evidence: 'design' },
  { code: '8.4', title: 'ضبط العمليات والخدمات المقدمة من جهات خارجية', how: 'إجراء تقييم الموردين والشركاء ومخاطرهم', path: '/quality/procedures', evidence: 'external' },
  { code: '8.5', title: 'تقديم الخدمة', how: 'متابعة طلبات العملاء وحجوزات التشخيص حتى إغلاقها', path: '/website/leads', evidence: 'delivery' },
  { code: '8.6', title: 'إطلاق الخدمات', how: 'الاعتماد النهائي للطلبات قبل الصرف', path: '/beneficiaries', evidence: 'release' },
  { code: '8.7', title: 'ضبط المخرجات غير المطابقة', how: 'تسجيل عدم المطابقة والتصحيح الفوري', path: '/quality/ncr', evidence: 'nonconforming' },
  { code: '9.1', title: 'الرصد والقياس والتحليل والتقييم (رضا العملاء)', how: 'استبانات قياس الرضا ومؤشرات الأهداف', path: '/quality/surveys', evidence: 'satisfaction' },
  { code: '9.2', title: 'المراجعة الداخلية', how: 'برنامج المراجعة السنوي وقوائم التحقق والنتائج', path: '/quality/audits', evidence: 'audits' },
  { code: '9.3', title: 'مراجعة الإدارة', how: 'محضر مراجعة الإدارة بمدخلاته ومخرجاته', path: '/quality/reviews', evidence: 'reviews' },
  { code: '10.1', title: 'التحسين: عام', how: 'فرص التحسين من المراجعات والمخاطر', path: '/quality/risks', evidence: 'improvement' },
  { code: '10.2', title: 'عدم المطابقة والإجراء التصحيحي', how: 'تحليل السبب الجذري والإجراءات التصحيحية والتحقق من فاعليتها', path: '/quality/ncr', evidence: 'capa' },
  { code: '10.3', title: 'التحسين المستمر', how: 'متابعة تنفيذ قرارات مراجعة الإدارة وتحقق الأهداف', path: '/quality/reviews', evidence: 'continual' },
];

/** مدخلات مراجعة الإدارة حسب البند 9.3.2 */
export const REVIEW_INPUTS: { key: string; title: string }[] = [
  { key: 'previous', title: 'حالة الإجراءات من مراجعات الإدارة السابقة' },
  { key: 'context', title: 'التغيرات في القضايا الداخلية والخارجية' },
  { key: 'satisfaction', title: 'رضا العملاء والتغذية الراجعة من الأطراف المعنية' },
  { key: 'objectives', title: 'مدى تحقق أهداف الجودة' },
  { key: 'processes', title: 'أداء العمليات ومطابقة الخدمات' },
  { key: 'ncr', title: 'حالات عدم المطابقة والإجراءات التصحيحية' },
  { key: 'monitoring', title: 'نتائج الرصد والقياس' },
  { key: 'audits', title: 'نتائج المراجعات الداخلية' },
  { key: 'providers', title: 'أداء الموردين والجهات الخارجية' },
  { key: 'resources', title: 'كفاية الموارد' },
  { key: 'risks', title: 'فاعلية الإجراءات المتخذة للتعامل مع المخاطر والفرص' },
  { key: 'improvement', title: 'فرص التحسين' },
];
