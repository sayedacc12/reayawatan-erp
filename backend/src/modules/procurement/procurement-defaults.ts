import { SupplierDocType } from './entities/procurement.entity';

/** المستندات المطلوبة من الموردين افتراضيًا (وفق المتعارف عليه في المملكة)، وتعدّلها الشركة من الإعدادات */
export const DEFAULT_DOC_TYPES: SupplierDocType[] = [
  { key: 'cr', name: 'السجل التجاري', required: true, hasExpiry: true, entityTypes: ['company', 'establishment'], isActive: true },
  { key: 'vat', name: 'شهادة التسجيل في ضريبة القيمة المضافة', required: false, hasExpiry: false, entityTypes: ['company', 'establishment'], isActive: true },
  { key: 'zakat', name: 'شهادة الزكاة والدخل', required: true, hasExpiry: true, entityTypes: ['company', 'establishment'], isActive: true },
  { key: 'gosi', name: 'شهادة التأمينات الاجتماعية', required: false, hasExpiry: true, entityTypes: ['company', 'establishment'], isActive: true },
  { key: 'saudization', name: 'شهادة السعودة (نطاقات)', required: false, hasExpiry: true, entityTypes: ['company', 'establishment'], isActive: true },
  { key: 'chamber', name: 'شهادة الغرفة التجارية', required: false, hasExpiry: true, entityTypes: ['company', 'establishment'], isActive: true },
  { key: 'address', name: 'العنوان الوطني', required: true, hasExpiry: false, entityTypes: [], isActive: true },
  { key: 'license', name: 'الترخيص المهني أو ترخيص النشاط', required: false, hasExpiry: true, entityTypes: [], isActive: true },
  { key: 'id', name: 'صورة الهوية الوطنية أو الإقامة', required: true, hasExpiry: true, entityTypes: ['individual'], isActive: true },
  { key: 'freelance', name: 'وثيقة العمل الحر', required: false, hasExpiry: true, entityTypes: ['individual'], isActive: true },
  { key: 'profile', name: 'ملف تعريفي بالمنشأة وأعمالها السابقة', required: false, hasExpiry: false, entityTypes: [], isActive: true },
];

export const DEFAULT_ACTIVITIES = [
  'مواد غذائية', 'سلال غذائية وكسوة', 'أجهزة كهربائية ومنزلية', 'أثاث ومفروشات', 'قرطاسية ومستلزمات مكتبية', 'أجهزة حاسب وتقنية',
  'خدمات طبية وعلاجية', 'أدوية ومستلزمات طبية', 'خدمات تأهيلية', 'خدمات تعليمية وتدريبية', 'صيانة وتشغيل', 'مقاولات وترميم',
  'نقل وخدمات لوجستية', 'طباعة وتسويق', 'خدمات استشارية', 'خدمات ضيافة وتموين', 'نظافة وتعقيم', 'أمن وحراسة',
];

export const DEFAULT_SUPPLIER_CATEGORIES = [
  { name: 'موردو مواد غذائية وإيوائية', color: '#15803d', description: 'السلال الغذائية والكسوة والمستلزمات المنزلية' },
  { name: 'مزودو خدمات طبية وتأهيلية', color: '#0369a1', description: 'المستشفيات والعيادات والصيدليات ومراكز التأهيل' },
  { name: 'موردو أجهزة وأثاث', color: '#7c3aed', description: 'الأجهزة الكهربائية والأثاث وأجهزة الحاسب' },
  { name: 'مقاولات وصيانة', color: '#b45309', description: 'الترميم والإنشاءات وصيانة المباني والمعدات' },
  { name: 'خدمات عامة وتشغيلية', color: '#0f766e', description: 'النقل والطباعة والنظافة والضيافة والاستشارات' },
];

export const DEFAULT_UOMS = [
  { name: 'حبة', symbol: 'حبة' }, { name: 'كرتون', symbol: 'كرتون' }, { name: 'علبة', symbol: 'علبة' }, { name: 'كيس', symbol: 'كيس' },
  { name: 'سلة', symbol: 'سلة' }, { name: 'طقم', symbol: 'طقم' }, { name: 'كيلوجرام', symbol: 'كجم' }, { name: 'لتر', symbol: 'لتر' },
  { name: 'متر', symbol: 'م' }, { name: 'رزمة', symbol: 'رزمة' }, { name: 'خدمة', symbol: 'خدمة' }, { name: 'ساعة', symbol: 'ساعة' },
];

/** مجموعات أصناف مقترحة؛ تُربط بحساباتها من الإعدادات أو شاشة المجموعات */
export const DEFAULT_ITEM_GROUPS: { code: string; name: string; kind: 'stock' | 'consumable' | 'asset' | 'service'; parent?: string }[] = [
  { code: 'AID', name: 'مواد الإعانة والتوزيع', kind: 'stock' },
  { code: 'FOOD', name: 'المواد الغذائية', kind: 'stock', parent: 'AID' },
  { code: 'CLTH', name: 'الكسوة والمفروشات', kind: 'stock', parent: 'AID' },
  { code: 'APPL', name: 'الأجهزة المنزلية', kind: 'stock', parent: 'AID' },
  { code: 'OFF', name: 'القرطاسية والمستلزمات المكتبية', kind: 'consumable' },
  { code: 'CLN', name: 'مواد النظافة والضيافة', kind: 'consumable' },
  { code: 'FA', name: 'أصناف تُسجل أصولًا ثابتة', kind: 'asset' },
  { code: 'SRV', name: 'الخدمات', kind: 'service' },
];

/** مصفوفة اعتماد التعميدات المقترحة: كل تعميد يعتمده المستوى الأول، وما بلغ 50 ألفًا يعتمده المستوى الأعلى أيضًا */
export const DEFAULT_APPROVAL_LEVELS = [
  { name: 'مدير المشتريات أو المدير المالي', minAmount: 0, permission: 'procurement.orders.approve' },
  { name: 'المدير التنفيذي', minAmount: 50000, permission: 'procurement.orders.approve_high' },
];

/** معايير تقييم العروض المقترحة (مجموع الأوزان 100) */
export const DEFAULT_EVAL_CRITERIA: { key: string; name: string; weight: number; kind: 'price' | 'technical' }[] = [
  { key: 'price', name: 'السعر', weight: 60, kind: 'price' },
  { key: 'quality', name: 'المطابقة للمواصفات والجودة', weight: 25, kind: 'technical' },
  { key: 'delivery', name: 'مدة التوريد أو التنفيذ', weight: 15, kind: 'technical' },
];

export const DEFAULT_ORDER_TERMS = [
  'يلتزم المورد بتوريد الأصناف أو تنفيذ الخدمات وفق المواصفات والكميات والأسعار الواردة في هذا التعميد.',
  'لا تُقبل الفاتورة إلا بعد الاستلام والفحص، ويُذكر فيها رقم التعميد.',
  'للشركة رفض ما يخالف المواصفات، وعلى المورد استبداله على نفقته.',
  'أي تعديل على التعميد لا يُعتد به إلا إذا صدر كتابيًا عبر بوابة الموردين.',
].join('\n');
