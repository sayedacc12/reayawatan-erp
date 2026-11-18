import { ErpModuleManifest } from '../../platform/erp-module';

export const WEBSITE_PERMISSIONS = {
  read: 'website.dashboard.read',
  edit: 'website.content.edit',
  publish: 'website.content.publish',
  pages: 'website.pages.manage',
  donations: 'website.donations.read',
  messages: 'website.messages.manage',
  reports: 'website.reports.read',
  settings: 'website.settings.manage',
} as const;

const P = WEBSITE_PERMISSIONS;

export const websiteManifest: ErpModuleManifest = {
  code: 'website',
  name: 'الموقع الإلكتروني',
  description: 'موقع الجمعية ولوحة تحكمه: الصفحات والأخبار والبرامج والحوكمة والشركاء، ومتجر التبرعات بالدفع الإلكتروني والإيصالات والتبرع الشهري والإهداء',
  icon: 'globe',
  version: '1.0.0',
  alwaysEnabled: true,
  sequence: 90,
  depends: ['accounting', 'knowledge'],
  permissions: [
    { code: P.read, name: 'عرض لوحة الموقع الإلكتروني' },
    { code: P.edit, name: 'إضافة الأخبار والبرامج وتعديلها وإرسالها للاعتماد (محرر)' },
    { code: P.publish, name: 'اعتماد الأخبار والبرامج ونشرها وتحديد بيانات المتجر (مدير المحتوى)' },
    { code: P.pages, name: 'تعديل صفحات الموقع: الرئيسية ومن نحن والحوكمة والشركاء' },
    { code: P.donations, name: 'عرض تبرعات المتجر والتبرع الشهري' },
    { code: P.messages, name: 'استقبال رسائل الزوار ومتابعتها' },
    { code: P.reports, name: 'عرض تقارير الموقع والمتجر' },
    { code: P.settings, name: 'إعدادات الموقع والمتجر والدفع والربط المالي وصلاحياته' },
  ],
  settingsPermission: P.settings,
  menu: [
    { label: 'لوحة الموقع', path: '/website', permission: P.read },
    { label: 'الأخبار', path: '/website/news', permission: P.read, group: 'المحتوى' },
    { label: 'البرامج والمشاريع', path: '/website/programs', permission: P.read, group: 'المحتوى' },
    { label: 'صفحات الموقع', path: '/website/pages', permission: P.pages, group: 'المحتوى' },
    { label: 'مكتبة الصور', path: '/website/media', permission: P.edit, group: 'المحتوى' },
    { label: 'التبرعات', path: '/website/donations', permission: P.donations, group: 'المتجر' },
    { label: 'التبرع الشهري', path: '/website/subscriptions', permission: P.donations, group: 'المتجر' },
    { label: 'رسائل الزوار', path: '/website/messages', permission: P.messages },
    { label: 'سجل النشاط', path: '/website/activity', permission: P.settings },
    { label: 'التقارير', path: '/website/reports', permission: P.reports },
    { label: 'الإعدادات', path: '/website/settings', permission: P.settings },
  ],
};
