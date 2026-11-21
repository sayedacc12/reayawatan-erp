import { ErpModuleManifest } from '../../platform/erp-module';

export const COMMS_PERMISSIONS = {
  read: 'comms.dashboard.read',
  create: 'comms.transactions.create',
  registry: 'comms.registry.read',
  registryMedium: 'comms.registry.medium',
  decisions: 'comms.decisions.issue',
  financial: 'comms.financial.close',
  tasks: 'comms.tasks.assign',
  tasksAll: 'comms.tasks.read_all',
  reports: 'comms.reports.read',
  settings: 'comms.settings.manage',
} as const;

const P = COMMS_PERMISSIONS;

export const commsManifest: ErpModuleManifest = {
  code: 'comms',
  name: 'الاتصالات الإدارية',
  description: 'المعاملات الإدارية والمالية بين الإدارات والأقسام والموظفين بدرجات سرية، والقرارات والتعاميم، ونظام المهام بمسؤول ومساندين ومواعيد إغلاق',
  icon: 'mail',
  version: '1.0.0',
  alwaysEnabled: true,
  sequence: 90,
  depends: ['hr'],
  permissions: [
    { code: P.read, name: 'عرض لوحة الاتصالات الإدارية والمعاملات الموجهة إليه ومهامه' },
    { code: P.create, name: 'إنشاء المعاملات وإحالتها بين الإدارات والموظفين' },
    { code: P.registry, name: 'سجل المعاملات: الاطلاع على المعاملات العادية كلها (الوارد والصادر)' },
    { code: P.registryMedium, name: 'الاطلاع على المعاملات متوسطة السرية في السجل (السرية والعالية السرية للموجهة لهم فقط)' },
    { code: P.decisions, name: 'إصدار القرارات والتعاميم' },
    { code: P.financial, name: 'إغلاق المعاملات المالية بإنشاء سند قبض أو صرف' },
    { code: P.tasks, name: 'إسناد المهام للموظفين' },
    { code: P.tasksAll, name: 'متابعة كل المهام في الشركة (عدا مهام الاجتماعات السرية)' },
    { code: P.reports, name: 'تقارير الاتصالات الإدارية والمهام' },
    { code: P.settings, name: 'إعدادات الاتصالات الإدارية وصلاحياتها' },
  ],
  settingsPermission: P.settings,
  menu: [
    { label: 'لوحة الاتصالات', path: '/comms', permission: P.read },
    { label: 'معاملاتي', path: '/comms/inbox', permission: P.read, group: 'المعاملات' },
    { label: 'معاملة جديدة', path: '/comms/new', permission: P.create, group: 'المعاملات' },
    { label: 'سجل المعاملات', path: '/comms/registry', permission: P.registry, group: 'المعاملات' },
    { label: 'القرارات والتعاميم', path: '/comms/decisions', permission: P.read, group: 'المعاملات' },
    { label: 'مهامي', path: '/comms/tasks', permission: P.read, group: 'المهام' },
    { label: 'كل المهام', path: '/comms/tasks/all', permission: P.tasksAll, group: 'المهام' },
    { label: 'التقارير', path: '/comms/reports', permission: P.reports },
    { label: 'الإعدادات', path: '/comms/settings', permission: P.settings },
  ],
};
