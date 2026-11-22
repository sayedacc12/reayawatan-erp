import { ErpModuleManifest } from '../../platform/erp-module';

export const WEBSITE_PERMISSIONS = {
  read: 'website.dashboard.read',
  leadsRead: 'website.leads.read',
  leadsManage: 'website.leads.manage',
  bookings: 'website.bookings.manage',
  content: 'website.content.manage',
  guides: 'website.guides.manage',
  settings: 'website.settings.manage',
} as const;

const P = WEBSITE_PERMISSIONS;

/**
 * الموقع الإلكتروني لرعاية وطن ولوحة تحكمه: كل نماذج الموقع تصل هنا كعملاء محتملين،
 * وحجز جلسات التشخيص، ومكتبة الأدلة، ومحتوى الصفحات والخدمات.
 */
export const websiteManifest: ErpModuleManifest = {
  code: 'website',
  name: 'الموقع والعملاء المحتملون',
  description: 'محتوى الموقع الإلكتروني وخدماته، وطلبات الاستشارة ونتائج الحاسبة وتقييم الجاهزية، وحجز جلسات التشخيص المجانية، ومكتبة الأدلة',
  icon: 'globe',
  version: '1.0.0',
  alwaysEnabled: true,
  sequence: 5,
  permissions: [
    { code: P.read, name: 'عرض لوحة الموقع' },
    { code: P.leadsRead, name: 'عرض العملاء المحتملين وطلبات الموقع' },
    { code: P.leadsManage, name: 'متابعة العملاء المحتملين: الحالة والملاحظات والإسناد' },
    { code: P.bookings, name: 'إدارة حجوزات جلسات التشخيص وأوقات الإتاحة' },
    { code: P.content, name: 'تعديل محتوى صفحات الموقع وخدماته' },
    { code: P.guides, name: 'إدارة مكتبة الأدلة المجانية' },
    { code: P.settings, name: 'إعدادات الموقع: إشعارات الفريق وصلاحيات الوحدة' },
  ],
  settingsPermission: P.settings,
  menu: [
    { label: 'لوحة الموقع', path: '/website', permission: P.read },
    { label: 'العملاء المحتملون', path: '/website/leads', permission: P.leadsRead, group: 'العملاء' },
    { label: 'حجوزات التشخيص', path: '/website/bookings', permission: P.leadsRead, group: 'العملاء' },
    { label: 'أوقات الإتاحة', path: '/website/availability', permission: P.bookings, group: 'العملاء' },
    { label: 'صفحات الموقع', path: '/website/pages', permission: P.content, group: 'المحتوى' },
    { label: 'الخدمات', path: '/website/services', permission: P.content, group: 'المحتوى' },
    { label: 'مكتبة الأدلة', path: '/website/guides', permission: P.guides, group: 'المحتوى' },
    { label: 'الإعدادات', path: '/website/settings', permission: P.settings },
  ],
};
