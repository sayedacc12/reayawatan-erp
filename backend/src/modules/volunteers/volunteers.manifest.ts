import { ErpModuleManifest } from '../../platform/erp-module';

export const VOL_PERMISSIONS = {
  read: 'volunteers.dashboard.read',
  volunteers: 'volunteers.volunteers.manage',
  events: 'volunteers.events.manage',
  approveEvents: 'volunteers.events.approve',
  certificates: 'volunteers.certificates.issue',
  contracts: 'volunteers.contracts.manage',
  tickets: 'volunteers.tickets.manage',
  policy: 'volunteers.policy.manage',
  reports: 'volunteers.reports.read',
  settings: 'volunteers.settings.manage',
} as const;

const P = VOL_PERMISSIONS;

export const volunteersManifest: ErpModuleManifest = {
  code: 'volunteers',
  name: 'التطوع',
  description: 'سجل المتطوعين، الفعاليات الميدانية وعن بعد ومراحل اعتمادها، الساعات والشهادات، عقود التطوع، اللائحة والميثاق، استبانات الرضا والشكاوى',
  icon: 'sprout',
  version: '1.0.0',
  alwaysEnabled: true,
  sequence: 80,
  permissions: [
    { code: P.read, name: 'عرض لوحة التطوع والمتطوعين والفعاليات' },
    { code: P.volunteers, name: 'تسجيل المتطوعين وتعديل بياناتهم وقبولهم' },
    { code: P.events, name: 'إنشاء الفعاليات وإرسالها للاعتماد وتحضير المتطوعين وإغلاقها' },
    { code: P.approveEvents, name: 'اعتماد الفعاليات في مراحلها أو إرجاعها أو رفضها' },
    { code: P.certificates, name: 'إصدار شهادات ساعات التطوع وشهادات الشكر' },
    { code: P.contracts, name: 'إصدار عقود التطوع وتسجيل توقيعها' },
    { code: P.tickets, name: 'استقبال الشكاوى والمقترحات والاستفسارات والرد عليها' },
    { code: P.policy, name: 'تعديل لائحة التطوع وميثاقه' },
    { code: P.reports, name: 'عرض تقارير التطوع' },
    { code: P.settings, name: 'إعدادات التطوع وصلاحياته' },
  ],
  settingsPermission: P.settings,
  menu: [
    { label: 'لوحة التطوع', path: '/volunteers', permission: P.read },
    { label: 'سجل المتطوعين', path: '/volunteers/list', permission: P.read, group: 'المتطوعون' },
    { label: 'عقود التطوع', path: '/volunteers/contracts', permission: P.read, group: 'المتطوعون' },
    { label: 'الشهادات', path: '/volunteers/certificates', permission: P.read, group: 'المتطوعون' },
    { label: 'الفعاليات', path: '/volunteers/events', permission: P.read, group: 'الفعاليات' },
    { label: 'اعتماد الفعاليات', path: '/volunteers/approvals', permission: P.approveEvents, group: 'الفعاليات' },
    { label: 'استبانات الرضا', path: '/volunteers/surveys', permission: P.read, group: 'الفعاليات' },
    { label: 'الشكاوى والمقترحات', path: '/volunteers/tickets', permission: P.read },
    { label: 'لائحة التطوع وميثاقه', path: '/volunteers/policy', permission: P.read },
    { label: 'التقارير', path: '/volunteers/reports', permission: P.reports },
    { label: 'الإعدادات', path: '/volunteers/settings', permission: P.settings },
  ],
};
