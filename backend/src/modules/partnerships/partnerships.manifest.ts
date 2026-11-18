import { ErpModuleManifest } from '../../platform/erp-module';

export const PARTNERSHIP_PERMISSIONS = {
  read: 'partnerships.partners.read',
  partners: 'partnerships.partners.manage',
  evaluate: 'partnerships.evaluations.manage',
  contracts: 'partnerships.contracts.manage',
  approve: 'partnerships.approvals.decide',
  reports: 'partnerships.reports.read',
  settings: 'partnerships.settings.manage',
} as const;

const P = PARTNERSHIP_PERMISSIONS;

export const partnershipsManifest: ErpModuleManifest = {
  code: 'partnerships',
  name: 'الشراكات',
  description: 'اختيار الشركاء بمعايير موزونة، وأنواع الشراكة وتصنيفات الشركاء، والتقييم والاعتماد، وصياغة العقود من مكتبة بنود مبوبة، والتوقيع الإلكتروني ومتابعة الالتزامات والتنبيهات',
  icon: 'handshake',
  version: '1.0.0',
  alwaysEnabled: true,
  sequence: 86,
  permissions: [
    { code: P.read, name: 'عرض لوحة الشراكات وسجل الشركاء والعقود' },
    { code: P.partners, name: 'إضافة الشركاء وتعديل بياناتهم' },
    { code: P.evaluate, name: 'تقييم الشركاء وفق معايير الاختيار ورفع التقييم للاعتماد' },
    { code: P.contracts, name: 'صياغة عقود الشراكة وإرسالها للتوقيع ومتابعة التزاماتها، وإدارة مكتبة البنود' },
    { code: P.approve, name: 'اعتماد تقييمات الشركاء وعقود الشراكة أو إرجاعها أو رفضها' },
    { code: P.reports, name: 'عرض تقارير الشراكات' },
    { code: P.settings, name: 'إعدادات الشراكات: الأنواع والتصنيفات والمعايير وتبويب البنود والصلاحيات' },
  ],
  settingsPermission: P.settings,
  menu: [
    { label: 'لوحة الشراكات', path: '/partnerships', permission: P.read },
    { label: 'سجل الشركاء', path: '/partnerships/partners', permission: P.read, group: 'الشركاء' },
    { label: 'الاعتمادات', path: '/partnerships/approvals', permission: P.approve, group: 'الشركاء' },
    { label: 'عقود الشراكة', path: '/partnerships/contracts', permission: P.read, group: 'العقود' },
    { label: 'المتابعة والتنبيهات', path: '/partnerships/followups', permission: P.read, group: 'العقود' },
    { label: 'مكتبة البنود', path: '/partnerships/clauses', permission: P.contracts, group: 'العقود' },
    { label: 'التقارير', path: '/partnerships/reports', permission: P.reports },
    { label: 'الإعدادات', path: '/partnerships/settings', permission: P.settings },
  ],
};
