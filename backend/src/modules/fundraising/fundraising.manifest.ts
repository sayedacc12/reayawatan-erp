import { ErpModuleManifest } from '../../platform/erp-module';

export const FUNDRAISING_PERMISSIONS = {
  donorsRead: 'fundraising.donors.read',
  donorsManage: 'fundraising.donors.manage',
  read: 'fundraising.opportunities.read',
  create: 'fundraising.opportunities.create',
  process: 'fundraising.opportunities.process',
  collect: 'fundraising.pledges.collect',
  journal: 'fundraising.journal.read',
  reports: 'fundraising.reports.read',
  settings: 'fundraising.settings.manage',
} as const;

const P = FUNDRAISING_PERMISSIONS;

export const fundraisingManifest: ErpModuleManifest = {
  code: 'fundraising',
  name: 'الموارد المالية',
  description: 'الداعمون وفرص التبرع والدفعات والقيود والتقارير',
  icon: 'coins',
  version: '1.0.0',
  alwaysEnabled: true,
  sequence: 40,
  depends: ['beneficiaries'],
  permissions: [
    { code: P.donorsRead, name: 'عرض سجل الداعمين' },
    { code: P.donorsManage, name: 'إضافة وتعديل وإيقاف الداعمين' },
    { code: P.read, name: 'عرض فرص التبرع والدفعات' },
    { code: P.create, name: 'تسجيل فرص التبرع وتعديلها قبل الاعتماد' },
    { code: P.process, name: 'اتخاذ القرارات في مراحل اعتماد الفرص' },
    { code: P.collect, name: 'تسجيل سداد الوعود بالدفع' },
    { code: P.journal, name: 'عرض قيود اليومية' },
    { code: P.reports, name: 'عرض لوحة المعلومات والتقارير' },
    { code: P.settings, name: 'إعدادات الموارد المالية' },
  ],
  settingsPermission: P.settings,
  menu: [
    { label: 'لوحة الموارد المالية', path: '/fundraising', permission: P.reports },
    { label: 'سجل الداعمين', path: '/fundraising/donors', permission: P.donorsRead },
    { label: 'فرص التبرع', path: '/fundraising/opportunities', permission: P.read },
    { label: 'الدفعات', path: '/fundraising/batches', permission: P.read },
    { label: 'قيود اليومية', path: '/fundraising/journal', permission: P.journal },
    { label: 'التقارير', path: '/fundraising/reports', permission: P.reports },
    { label: 'الإعدادات', path: '/fundraising/settings', permission: P.settings },
  ],
};
