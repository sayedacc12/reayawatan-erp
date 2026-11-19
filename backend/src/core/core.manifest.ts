import { ErpModuleManifest } from '../platform/erp-module';

export const CORE_PERMISSIONS = {
  usersRead: 'core.users.read',
  usersManage: 'core.users.manage',
  rolesRead: 'core.roles.read',
  rolesManage: 'core.roles.manage',
  supportManage: 'core.support.manage',
  identityManage: 'core.identity.manage',
} as const;

export const coreManifest: ErpModuleManifest = {
  code: 'core',
  name: 'الإعدادات والصلاحيات',
  description: 'هوية الجمعية وإدارة المستخدمين والأدوار وصلاحيات الوحدات',
  icon: 'settings',
  version: '1.0.0',
  alwaysEnabled: true,
  sequence: 1000,
  permissions: [
    { code: CORE_PERMISSIONS.usersRead, name: 'عرض المستخدمين' },
    { code: CORE_PERMISSIONS.usersManage, name: 'إضافة وتعديل المستخدمين' },
    { code: CORE_PERMISSIONS.rolesRead, name: 'عرض الأدوار والصلاحيات' },
    { code: CORE_PERMISSIONS.rolesManage, name: 'إدارة الأدوار والصلاحيات' },
    { code: CORE_PERMISSIONS.supportManage, name: 'طلبات الصيانة والدعم الفني للمنصة' },
    { code: CORE_PERMISSIONS.identityManage, name: 'إدارة هوية الجمعية: الشعار والألوان والخطوط والرؤية والرسالة والأهداف' },
  ],
  menu: [
    { label: 'هوية الجمعية', path: '/settings/identity', permission: CORE_PERMISSIONS.identityManage },
    { label: 'المستخدمون', path: '/settings/users', permission: CORE_PERMISSIONS.usersRead },
    { label: 'الأدوار والصلاحيات', path: '/settings/roles', permission: CORE_PERMISSIONS.rolesRead },
    { label: 'الدعم الفني والصيانة', path: '/settings/support', permission: CORE_PERMISSIONS.supportManage },
  ],
};

export const PLATFORM_PERMISSIONS = {
  organizationsManage: 'platform.organizations.manage',
  subscriptionsManage: 'platform.subscriptions.manage',
  reportsRead: 'platform.reports.read',
  siteManage: 'platform.site.manage',
} as const;

/** إدارة المنصة: الجمعيات وطلبات اشتراكها وعقودها وتقاريرها. لمدير المنصة فقط ولا تظهر في أدوار الجمعيات. */
export const platformManifest: ErpModuleManifest = {
  code: 'platform',
  name: 'إدارة المنصة',
  description: 'الجمعيات المشتركة في المنصة',
  icon: 'building',
  version: '1.0.0',
  scope: 'platform',
  alwaysEnabled: true,
  sequence: 0,
  permissions: [
    { code: PLATFORM_PERMISSIONS.organizationsManage, name: 'إدارة الجمعيات' },
    { code: PLATFORM_PERMISSIONS.subscriptionsManage, name: 'طلبات الاشتراك والعقود' },
    { code: PLATFORM_PERMISSIONS.reportsRead, name: 'تقارير المنصة' },
    { code: PLATFORM_PERMISSIONS.siteManage, name: 'الصفحة التعريفية: طلبات الخدمات وبيانات التواصل وواتساب' },
  ],
  menu: [
    { label: 'الجمعيات', path: '/platform/organizations', permission: PLATFORM_PERMISSIONS.organizationsManage },
    { label: 'مواعيد الحذف', path: '/platform/lifecycle', permission: PLATFORM_PERMISSIONS.organizationsManage },
    { label: 'طلبات الاشتراك', path: '/platform/applications', permission: PLATFORM_PERMISSIONS.subscriptionsManage },
    { label: 'العقود', path: '/platform/contracts', permission: PLATFORM_PERMISSIONS.subscriptionsManage },
    { label: 'بنود العقد', path: '/platform/contract-clauses', permission: PLATFORM_PERMISSIONS.subscriptionsManage },
    { label: 'طلبات الخدمات', path: '/platform/inquiries', permission: PLATFORM_PERMISSIONS.siteManage },
    { label: 'التقارير', path: '/platform/reports', permission: PLATFORM_PERMISSIONS.reportsRead },
    { label: 'الأداء وحجم البيانات', path: '/platform/performance', permission: PLATFORM_PERMISSIONS.reportsRead },
    { label: 'النسخ الاحتياطي', path: '/platform/backups', permission: PLATFORM_PERMISSIONS.reportsRead },
    { label: 'إعدادات المنصة', path: '/platform/settings', permission: PLATFORM_PERMISSIONS.siteManage },
  ],
};
