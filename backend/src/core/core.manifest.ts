import { ErpModuleManifest } from '../platform/erp-module';

export const CORE_PERMISSIONS = {
  usersRead: 'core.users.read',
  usersManage: 'core.users.manage',
  rolesRead: 'core.roles.read',
  rolesManage: 'core.roles.manage',
} as const;

export const coreManifest: ErpModuleManifest = {
  code: 'core',
  name: 'الإعدادات والصلاحيات',
  description: 'إدارة المستخدمين والأدوار وصلاحيات الوحدات',
  icon: 'settings',
  version: '1.0.0',
  alwaysEnabled: true,
  sequence: 1000,
  permissions: [
    { code: CORE_PERMISSIONS.usersRead, name: 'عرض المستخدمين' },
    { code: CORE_PERMISSIONS.usersManage, name: 'إضافة وتعديل المستخدمين' },
    { code: CORE_PERMISSIONS.rolesRead, name: 'عرض الأدوار والصلاحيات' },
    { code: CORE_PERMISSIONS.rolesManage, name: 'إدارة الأدوار والصلاحيات' },
  ],
  menu: [
    { label: 'المستخدمون', path: '/settings/users', permission: CORE_PERMISSIONS.usersRead },
    { label: 'الأدوار والصلاحيات', path: '/settings/roles', permission: CORE_PERMISSIONS.rolesRead },
  ],
};

export const PLATFORM_PERMISSIONS = {
  organizationsManage: 'platform.organizations.manage',
} as const;

/** إدارة المنصة: إنشاء الجمعيات وإيقافها. لمدير المنصة فقط ولا تظهر في أدوار الجمعيات. */
export const platformManifest: ErpModuleManifest = {
  code: 'platform',
  name: 'إدارة المنصة',
  description: 'الجمعيات المشتركة في المنصة',
  icon: 'building',
  version: '1.0.0',
  scope: 'platform',
  alwaysEnabled: true,
  sequence: 0,
  permissions: [{ code: PLATFORM_PERMISSIONS.organizationsManage, name: 'إدارة الجمعيات' }],
  menu: [{ label: 'الجمعيات', path: '/platform/organizations', permission: PLATFORM_PERMISSIONS.organizationsManage }],
};
