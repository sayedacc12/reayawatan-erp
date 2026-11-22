import { ListItem } from './entities/crm.entity';

const items = (o: Record<string, string>): ListItem[] => Object.entries(o).map(([key, label]) => ({ key, label, isActive: true }));

/** مصادر يعتمد عليها النظام نفسه، فلا تُحذف من القائمة (يمكن تغيير اسمها) */
export const SYSTEM_SOURCES = ['website', 'import', 'manual'];

export const DEFAULT_SOURCES = items({
  website: 'نماذج الموقع الإلكتروني', manual: 'إدخال مباشر', import: 'استيراد من ملف', phone: 'اتصال هاتفي', whatsapp: 'واتساب',
  event: 'معرض أو ملتقى', referral: 'ترشيح من جهة أو شخص', social: 'وسائل التواصل الاجتماعي', linkedin: 'لينكدإن', visit: 'زيارة مقر الشركة',
});

export const DEFAULT_INTERESTS = items({
  consulting: 'استشارة أو خدمة من خدمات الشركة', impact: 'قياس الأثر', strategy: 'التخطيط الاستراتيجي', governance: 'الحوكمة والامتثال',
  training: 'التدريب الصحي', partnership: 'شراكة', inquiry: 'استفسار عام',
});

export const DEFAULT_REASONS = items({
  no_need: 'لا يوجد احتياج', no_budget: 'لا توجد ميزانية', unreachable: 'تعذر التواصل بعد عدة محاولات', duplicate: 'مكرر',
  spam: 'طلب غير جاد', out_of_scope: 'خارج نطاق خدمات الشركة', other: 'سبب آخر',
});

/**
 * نماذج الموقع التي يمكن أن تدخل عملاءَ محتملين في علاقات العملاء، وما يقابلها من اهتمامات (تختار الشركة منها في الإعدادات).
 * المفاتيح هي مصادر طلبات الموقع (rw_leads.source). الطلب يبقى في قائمة طلبات الموقع كما هو، ويُضاف هنا للمتابعة البيعية.
 */
export const WEB_TOPIC_INTEREST: Record<string, string> = {
  consultation: 'consulting', booking: 'consulting', assessment: 'consulting', calculator: 'impact', guide: 'inquiry',
};
