import {
  AccountingLink, ApprovalStage, CardConfig, DocumentRequirement, MembershipCondition, MembershipType, PaymentConfig, Regulation, RenewalConfig,
} from './entities/members.entity';

/**
 * القيم الافتراضية عند أول استخدام لنظام العضوية. كلها مسودة مقترحة تعدّلها الجمعية من الإعدادات
 * بما يطابق لائحتها الأساسية المعتمدة.
 */
export const DEFAULT_TYPES: MembershipType[] = [
  {
    code: 'working', name: 'عضو عامل', description: 'العضو الذي يحضر الجمعية العمومية ويصوّت فيها ويحق له الترشح لمجلس الإدارة',
    fee: 300, joiningFee: 0, durationMonths: 12, votingRights: true, votingAfterDays: 0, minAge: 18, saudiOnly: true, publicApply: true,
    benefits: 'حضور اجتماعات الجمعية العمومية والتصويت على قراراتها\nالترشح لعضوية مجلس الإدارة وفق اللائحة\nالاطلاع على التقارير السنوية للجمعية',
    revenueAccountId: null, color: '#0f766e', isActive: true,
  },
  {
    code: 'affiliate', name: 'عضو منتسب', description: 'من يرغب في دعم الجمعية والمشاركة في أنشطتها دون حق التصويت',
    fee: 100, joiningFee: 0, durationMonths: 12, votingRights: false, votingAfterDays: 0, minAge: 18, saudiOnly: false, publicApply: true,
    benefits: 'حضور اجتماعات الجمعية العمومية دون تصويت\nالمشاركة في برامج الجمعية وفعالياتها', revenueAccountId: null, color: '#6366f1', isActive: true,
  },
  {
    code: 'honorary', name: 'عضو فخري', description: 'يمنحه مجلس الإدارة لمن قدم للجمعية خدمات جليلة، ويُعفى من الاشتراك',
    fee: 0, joiningFee: 0, durationMonths: 12, votingRights: false, votingAfterDays: 0, minAge: null, saudiOnly: false, publicApply: false,
    benefits: 'حضور اجتماعات الجمعية العمومية دون تصويت\nالتكريم في المناسبات الرسمية للجمعية', revenueAccountId: null, color: '#d97706', isActive: true,
  },
];

const REF = 'اللائحة الأساسية: أحكام العضوية';
export const DEFAULT_CONDITIONS: MembershipCondition[] = [
  { key: 'capacity', text: 'أن أكون كامل الأهلية المعتبرة شرعًا', reference: REF, isActive: true },
  { key: 'record', text: 'ألا يكون قد صدر بحقي حكم بإدانة في جريمة مخلة بالشرف أو الأمانة، ما لم يكن قد رُد إليّ اعتباري', reference: REF, isActive: true },
  { key: 'commit', text: 'أن ألتزم بأحكام اللائحة الأساسية للجمعية وقرارات الجمعية العمومية ومجلس الإدارة', reference: REF, isActive: true },
  { key: 'fee', text: 'أن أسدد اشتراك العضوية في موعده، وأعلم أن عدم السداد يوقف حقوق العضوية', reference: REF, isActive: true },
  { key: 'truth', text: 'أقر بصحة جميع البيانات والمستندات المرفقة، وأتحمل مسؤولية ما يخالف ذلك', reference: null, isActive: true },
];

export const DEFAULT_REGULATION: Regulation = {
  title: 'أحكام العضوية في اللائحة الأساسية للجمعية',
  version: 0,
  effectiveDate: null,
  updatedByName: null,
  sections: [
    { title: 'أنواع العضوية', body: 'العضوية في الجمعية أنواع تحددها اللائحة الأساسية، منها: العضو العامل، والعضو المنتسب، والعضو الفخري. ولكل نوع حقوقه والتزاماته واشتراكه.' },
    { title: 'شروط العضوية العاملة', body: 'يشترط في العضو العامل أن يكون سعودي الجنسية، وألا يقل عمره عن ثمانية عشر عامًا، وأن يكون كامل الأهلية، وغير محكوم عليه بإدانة في جريمة مخلة بالشرف أو الأمانة ما لم يكن قد رُد إليه اعتباره، وأن يسدد الاشتراك المقرر.' },
    { title: 'حقوق العضو العامل', body: 'حضور اجتماعات الجمعية العمومية والتصويت على قراراتها، والترشح لعضوية مجلس الإدارة وفق الشروط النظامية، والاطلاع على تقارير الجمعية وقوائمها المالية.' },
    { title: 'واجبات العضو', body: 'الالتزام بأحكام اللائحة الأساسية وقرارات الجمعية العمومية ومجلس الإدارة، وسداد الاشتراك في موعده، والمحافظة على سمعة الجمعية وممتلكاتها.' },
    { title: 'انتهاء العضوية', body: 'تنتهي العضوية بالوفاة، أو بالانسحاب بطلب مكتوب، أو بفقد أحد شروطها، أو بعدم سداد الاشتراك بعد انتهاء مهلة السماح، أو بقرار من الجمعية العمومية وفق اللائحة.' },
    { title: 'إعادة العضوية', body: 'يجوز لمن انتهت عضويته بسبب عدم سداد الاشتراك أن يطلب إعادتها بعد سداد الاشتراك المستحق، ويعامل معاملة العضو الجديد في احتساب مدة اكتساب حق التصويت.' },
  ],
};

export const DEFAULT_DOCUMENTS: DocumentRequirement[] = [
  { key: 'id_front', name: 'صورة الهوية الوطنية أو الإقامة', required: true, isActive: true },
  { key: 'photo', name: 'صورة شخصية حديثة', required: false, isActive: true },
];

export const DEFAULT_STAGES: ApprovalStage[] = [
  { name: 'مراجعة الطلب والتحقق من الشروط', roleId: null },
  { name: 'اعتماد مجلس الإدارة', roleId: null },
];

export const DEFAULT_PAYMENT: PaymentConfig = {
  online: true, transfer: true, cash: true, provider: 'sandbox', publishableKey: null, secretKey: null,
  bankName: null, accountName: null, iban: null, dueDays: 14,
};

export const DEFAULT_ACCOUNTING: AccountingLink = { revenueAccountId: null, onlineCashAccountId: null, transferCashAccountId: null, cashCashAccountId: null };

export const DEFAULT_RENEWAL: RenewalConfig = {
  reminderDays: [30, 7],
  graceDays: 30,
  autoInvoiceDays: 30,
  message: 'السلام عليكم {اسم العضو}،\nنذكّركم بأن عضويتكم رقم {رقم العضوية} ({نوع العضوية}) في {اسم الجمعية} تنتهي بتاريخ {تاريخ الانتهاء}.\nلتجديد العضوية وسداد الاشتراك ({المبلغ}) عبر الرابط: {رابط السداد}\nشاكرين لكم عطاءكم.',
};

export const DEFAULT_CARD: CardConfig = {
  title: 'بطاقة عضوية', signatoryName: '', signatoryTitle: 'رئيس مجلس الإدارة',
  note: 'البطاقة شخصية، ويمكن التحقق من صحتها برمز التحقق في صفحة الجمعية.',
};
