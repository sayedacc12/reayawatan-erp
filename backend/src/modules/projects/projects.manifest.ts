import { ErpModuleManifest } from '../../platform/erp-module';

export const PROJECT_PERMISSIONS = {
  read: 'projects.projects.read',
  manage: 'projects.projects.manage',
  approve: 'projects.approval.process',
  support: 'projects.support.manage',
  disburse: 'projects.disbursement.execute',
  transfers: 'projects.transfers.manage',
  amendments: 'projects.amendments.manage',
  reports: 'projects.reports.read',
  settings: 'projects.settings.manage',
} as const;

export const projectsManifest: ErpModuleManifest = {
  code: 'projects',
  name: 'إدارة المشاريع',
  description: 'المحاور والبرامج والمشاريع والخدمات، اعتماد المشاريع، إدارة الدعم والصرف والمناقلات',
  icon: 'layers',
  version: '1.0.0',
  alwaysEnabled: true,
  sequence: 50,
  depends: ['beneficiaries', 'fundraising'],
  permissions: [
    { code: PROJECT_PERMISSIONS.read, name: 'عرض المشاريع ولوحة المعلومات' },
    { code: PROJECT_PERMISSIONS.manage, name: 'إضافة وتعديل المحاور والبرامج والمشاريع والخدمات' },
    { code: PROJECT_PERMISSIONS.approve, name: 'اتخاذ القرار في مراحل اعتماد المشاريع' },
    { code: PROJECT_PERMISSIONS.support, name: 'إدارة الدعم: تحميل الطلبات على الدفعات والصرف العام وطلبات الصرف' },
    { code: PROJECT_PERMISSIONS.disburse, name: 'الصرف المالي: تنفيذ طلبات الصرف بسند صرف أو فاتورة (الإدارة المالية)' },
    { code: PROJECT_PERMISSIONS.transfers, name: 'المناقلات بين الدفعات' },
    { code: PROJECT_PERMISSIONS.amendments, name: 'تعديل فرص التبرع وقيود التسوية' },
    { code: PROJECT_PERMISSIONS.reports, name: 'تقارير إدارة المشاريع' },
    { code: PROJECT_PERMISSIONS.settings, name: 'إعدادات إدارة المشاريع ومراحل الاعتماد' },
  ],
  settingsPermission: PROJECT_PERMISSIONS.settings,
  menu: [
    { label: 'لوحة المشاريع', path: '/projects', permission: PROJECT_PERMISSIONS.read },
    { label: 'إجمالي المشاريع', path: '/projects/list', permission: PROJECT_PERMISSIONS.read },
    { label: 'اعتماد المشاريع', path: '/projects/approvals', permission: PROJECT_PERMISSIONS.approve },
    { label: 'إدارة الدعم', path: '/projects/support', permission: PROJECT_PERMISSIONS.support },
    { label: 'الصرف المالي', path: '/projects/disbursements', permission: PROJECT_PERMISSIONS.disburse, anyOf: [PROJECT_PERMISSIONS.support] },
    { label: 'المناقلات', path: '/projects/transfers', permission: PROJECT_PERMISSIONS.transfers },
    { label: 'تعديل فرص التبرع', path: '/projects/amendments', permission: PROJECT_PERMISSIONS.amendments },
    { label: 'التقارير', path: '/projects/reports', permission: PROJECT_PERMISSIONS.reports },
    { label: 'الإعدادات', path: '/projects/settings', permission: PROJECT_PERMISSIONS.settings },
  ],
};
