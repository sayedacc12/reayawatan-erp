import { ErpModuleManifest } from '../../platform/erp-module';

export const GOV_PERMISSIONS = {
  read: 'governance.dashboard.read',
  assess: 'governance.assessment.manage',
  approve: 'governance.assessment.approve',
  actions: 'governance.actions.manage',
  calendar: 'governance.calendar.manage',
  reports: 'governance.reports.read',
  settings: 'governance.settings.manage',
} as const;

const P = GOV_PERMISSIONS;

export const governanceManifest: ErpModuleManifest = {
  code: 'governance',
  name: 'الحوكمة',
  description: 'التقييم الذاتي التنبؤي وفق أدلة حوكمة الجمعيات الأهلية (الامتثال، الشفافية، السلامة المالية)، مؤشرات الأداء المالي من الدليل المحاسبي، الإنذار المبكر، وخطة التحسين',
  icon: 'scale',
  version: '1.0.0',
  alwaysEnabled: true,
  sequence: 75,
  permissions: [
    { code: P.read, name: 'عرض لوحة الحوكمة والمؤشرات والإنذارات' },
    { code: P.assess, name: 'إعداد التقييم الذاتي وتسجيل الإجابات والشواهد' },
    { code: P.approve, name: 'اعتماد التقييم الذاتي وإعادة فتحه' },
    { code: P.actions, name: 'إدارة خطة التحسين ومتابعة تنفيذها' },
    { code: P.calendar, name: 'إدارة تقويم الالتزامات (الاجتماعات والتقارير والمواعيد النظامية)' },
    { code: P.reports, name: 'عرض تقارير الحوكمة وتصديرها' },
    { code: P.settings, name: 'إعدادات الحوكمة وربط الحسابات وبيانات الجمعية النظامية' },
  ],
  settingsPermission: P.settings,
  menu: [
    { label: 'لوحة الحوكمة', path: '/governance', permission: P.read },
    { label: 'الإنذار المبكر', path: '/governance/alerts', permission: P.read },
    { label: 'التقييم الذاتي', path: '/governance/assessments', permission: P.read },
    { label: 'السلامة المالية', path: '/governance/finance', permission: P.read },
    { label: 'خطة التحسين', path: '/governance/actions', permission: P.read },
    { label: 'تقويم الالتزامات', path: '/governance/calendar', permission: P.read },
    { label: 'دليل الحوكمة', path: '/governance/guide', permission: P.read },
    { label: 'التقارير', path: '/governance/reports', permission: P.reports },
    { label: 'الإعدادات', path: '/governance/settings', permission: P.settings },
  ],
};
