/**
 * مستويات الخدمة (SLA) لطلبات الصيانة والدعم الفني من الجمعيات.
 * لكل مستوى: مهلة أول استجابة، ومهلة الحل، ووصف متى يُختار، وخطوات التعامل، والتصعيد.
 * المهل بالساعات المتصلة (24/7)، ويتوقف احتسابها أثناء انتظار رد الشركة.
 * يعدّلها مدير المنصة من شاشة "مستويات الخدمة".
 */
export const PRIORITIES = ['very_critical', 'critical', 'medium', 'normal', 'low'] as const;
export type Priority = (typeof PRIORITIES)[number];

export interface SlaLevel {
  priority: Priority;
  name: string;
  responseHours: number;
  resolutionHours: number;
  /** متى يُختار هذا المستوى */
  description: string;
  examples: string[];
  /** خطوات التعامل من فريق المنصة */
  handling: string[];
  /** التصعيد عند تجاوز المهلة */
  escalation: string;
}

export const DEFAULT_SLA: SlaLevel[] = [
  {
    priority: 'very_critical', name: 'حرج جدًا', responseHours: 1, resolutionHours: 4,
    description: 'توقف النظام بالكامل أو تعذر دخول جميع مستخدمي الشركة، أو خطر على أمن البيانات أو سلامتها.',
    examples: ['النظام لا يفتح لجميع الموظفين', 'ظهور بيانات جمعية أخرى', 'فقدان بيانات أو اشتباه اختراق'],
    handling: [
      'يستلم مدير المنصة الطلب فورًا على مدار الساعة ويؤكد الاستلام خلال ساعة.',
      'تحديث الشركة بحالة المعالجة كل ساعة حتى الحل.',
      'تطبيق حل مؤقت يعيد الخدمة أولًا، ثم الحل الجذري.',
      'إعداد تقرير بالسبب والإجراءات الوقائية بعد الإغلاق.',
    ],
    escalation: 'يُصعَّد للإدارة العليا للمنصة فور تجاوز نصف مهلة الحل دون تقدم.',
  },
  {
    priority: 'critical', name: 'حرج', responseHours: 2, resolutionHours: 8,
    description: 'تعطل وظيفة أساسية لا يوجد لها بديل وتؤثر على عمل الشركة اليومي.',
    examples: ['تعذر استقبال طلبات الموقع', 'تعذر اعتماد سند أو صرف', 'بوابة الموظفين متوقفة'],
    handling: [
      'تأكيد الاستلام وتحديد المسؤول خلال ساعتين.',
      'تحديث الشركة كل 4 ساعات.',
      'تقديم حل بديل مؤقت إن أمكن حتى الإصلاح.',
    ],
    escalation: 'يُصعَّد لمدير المنصة عند تجاوز مهلة الحل.',
  },
  {
    priority: 'medium', name: 'متوسط', responseHours: 4, resolutionHours: 24,
    description: 'خلل في وظيفة مع وجود طريقة بديلة لإتمام العمل، أو يؤثر على عدد محدود من المستخدمين.',
    examples: ['تقرير يعرض أرقامًا غير دقيقة', 'خطأ في شاشة لموظف واحد', 'بطء ملحوظ في شاشة'],
    handling: ['تأكيد الاستلام خلال 4 ساعات.', 'الحل خلال يوم عمل، أو إشعار الشركة بموعد الإصلاح.'],
    escalation: 'يُراجَع في الاجتماع اليومي لفريق المنصة عند تجاوز المهلة.',
  },
  {
    priority: 'normal', name: 'عادي', responseHours: 8, resolutionHours: 72,
    description: 'استفسار عن طريقة الاستخدام، أو خلل بسيط لا يعطل العمل.',
    examples: ['كيف أضيف موظفًا وأحدد صلاحياته؟', 'خطأ إملائي في شاشة', 'طلب تعديل بيانات بسيط'],
    handling: ['الرد خلال 8 ساعات.', 'الحل أو الإجابة خلال 3 أيام.'],
    escalation: 'يظهر في تقرير الطلبات المتأخرة الأسبوعي.',
  },
  {
    priority: 'low', name: 'منخفض', responseHours: 24, resolutionHours: 168,
    description: 'اقتراح تحسين أو طلب ميزة جديدة لا يؤثر على العمل الحالي.',
    examples: ['إضافة حقل جديد لنموذج', 'اقتراح تقرير إضافي', 'تحسين في التصميم'],
    handling: ['الرد خلال يوم.', 'دراسة الطلب وإدراجه في خطة التطوير، وإشعار الشركة بالقرار خلال أسبوع.'],
    escalation: 'لا تصعيد، ويُراجَع مع خطة التطوير الشهرية.',
  },
];

export const CATEGORIES = ['malfunction', 'access', 'data', 'question', 'feature', 'other'] as const;
export type Category = (typeof CATEGORIES)[number];

export const TICKET_STATUSES = ['new', 'in_progress', 'waiting_customer', 'resolved', 'closed'] as const;
export type TicketStatus = (typeof TICKET_STATUSES)[number];
/** الحالات المفتوحة التي تُحتسب فيها المهل */
export const OPEN_STATUSES: TicketStatus[] = ['new', 'in_progress', 'waiting_customer'];
