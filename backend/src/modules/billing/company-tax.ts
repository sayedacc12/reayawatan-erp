import { IdType, NationalAddress } from './entities/billing.entity';

/**
 * البيانات الضريبية لرعاية وطن كما في شهادة التسجيل في ضريبة القيمة المضافة (هيئة الزكاة والضريبة والجمارك، 2026-11-22)
 * والسجل التجاري. تستخدمها الإعدادات الافتراضية للفوترة لتعبئة الحقول الفارغة فقط، وتُعدّل بعد ذلك من شاشة الإعدادات.
 * رقم المبنى والرقم الإضافي غير مذكورين في الشهادة، فيُكملان من العنوان الوطني.
 */
export const COMPANY_TAX_PROFILE: {
  sellerName: string; sellerNameEn: string; vatNumber: string; idType: IdType; idNumber: string; vatEffectiveFrom: string; address: NationalAddress;
} = {
  sellerName: 'شركة رعاية وطن للاستثمار',
  sellerNameEn: 'National Care Investment Company',
  vatNumber: '314466205600003',
  idType: 'CRN',
  idNumber: '7052873945',
  vatEffectiveFrom: '2026-12-01',
  address: { street: 'الوليد التميمي', buildingNo: null, additionalNo: null, district: 'الرحمانية', city: 'الرياض', postalCode: '12341', country: 'SA' },
};
