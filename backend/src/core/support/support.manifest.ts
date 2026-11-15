import { ErpModuleManifest } from '../../platform/erp-module';

export const SUPPORT_PERMISSIONS = {
  /** العمل على طلبات الصيانة والمهام (موظف الدعم) */
  work: 'support.work',
  /** توزيع الطلبات والتكليفات وإدارة الفريق ومستويات الخدمة (مدير الدعم) */
  manage: 'support.manage',
  /** تقارير الدعم وتقييم أداء الفريق */
  reports: 'support.reports',
} as const;

/** أدوار فريق المنصة. null = مالك المنصة وله كل صلاحيات المنصة */
export const PLATFORM_ROLES = ['support_manager', 'support_agent'] as const;
export type PlatformRole = (typeof PLATFORM_ROLES)[number];

export const PLATFORM_ROLE_PERMISSIONS: Record<PlatformRole, string[]> = {
  support_manager: [SUPPORT_PERMISSIONS.work, SUPPORT_PERMISSIONS.manage, SUPPORT_PERMISSIONS.reports],
  support_agent: [SUPPORT_PERMISSIONS.work],
};

/** الدعم الفني: تطبيق مستقل بجانب إدارة المنصة لاستقبال طلبات الصيانة ومعالجتها بمهام وتكليفات وتقييم أداء */
export const supportManifest: ErpModuleManifest = {
  code: 'support',
  name: 'الدعم الفني',
  description: 'طلبات الصيانة من الجمعيات ومهام فريق الدعم وتقييم الأداء',
  icon: 'headset',
  version: '1.0.0',
  scope: 'platform',
  alwaysEnabled: true,
  sequence: 1,
  permissions: [
    { code: SUPPORT_PERMISSIONS.work, name: 'العمل على طلبات الصيانة والمهام' },
    { code: SUPPORT_PERMISSIONS.manage, name: 'توزيع الطلبات والتكليفات وإدارة فريق الدعم' },
    { code: SUPPORT_PERMISSIONS.reports, name: 'تقارير الدعم وتقييم الأداء' },
  ],
  menu: [
    { label: 'لوحة الدعم', path: '/support-desk', permission: SUPPORT_PERMISSIONS.work },
    { label: 'طلبات الصيانة', path: '/support-desk/tickets', permission: SUPPORT_PERMISSIONS.work },
    { label: 'المهام والتكليفات', path: '/support-desk/tasks', permission: SUPPORT_PERMISSIONS.work },
    { label: 'فريق الدعم', path: '/support-desk/team', permission: SUPPORT_PERMISSIONS.manage },
    { label: 'تقييم الأداء', path: '/support-desk/performance', permission: SUPPORT_PERMISSIONS.reports },
    { label: 'مستويات الخدمة', path: '/support-desk/sla', permission: SUPPORT_PERMISSIONS.manage },
    { label: 'التقارير', path: '/support-desk/reports', permission: SUPPORT_PERMISSIONS.reports },
  ],
};
