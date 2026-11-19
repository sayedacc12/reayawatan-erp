/** تسميات طلبات الصفحة التعريفية */
export const INQUIRY_KIND: Record<string, { label: string; tone: string }> = {
  consultation: { label: 'استشارة مجانية', tone: 'info' },
  quote: { label: 'عرض سعر', tone: 'warn' },
  demo: { label: 'عرض تجريبي', tone: 'ok' },
};
export const INQUIRY_STATUS: Record<string, { label: string; tone: string }> = {
  new: { label: 'جديد', tone: 'warn' },
  contacted: { label: 'تم التواصل', tone: 'info' },
  in_progress: { label: 'قيد المتابعة', tone: 'info' },
  won: { label: 'تم التعاقد', tone: 'ok' },
  closed: { label: 'مغلق', tone: 'muted' },
};
export const SITE_SERVICES: Record<string, string> = {
  digital: 'التحول الرقمي',
  governance: 'الحوكمة والالتزام',
  risk_audit: 'المخاطر والمراجعة الداخلية',
  impact: 'قياس الأثر الاجتماعي',
  sustainability: 'الاستدامة المالية',
  strategy_quality: 'التخطيط الاستراتيجي والجودة',
  capacity: 'بناء القدرات',
};
/** رقم الجوال السعودي المحلي (05...) إلى الصيغة الدولية لروابط واتساب */
export const waNumber = (phone: string) => {
  const p = phone.replace(/^\+/, '');
  if (/^05\d{8}$/.test(p)) return `966${p.slice(1)}`;
  if (/^5\d{8}$/.test(p)) return `966${p}`;
  return p.replace(/^00/, '');
};
