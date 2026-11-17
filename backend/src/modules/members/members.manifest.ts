import { ErpModuleManifest } from '../../platform/erp-module';

export const MEMBER_PERMISSIONS = {
  read: 'members.dashboard.read',
  applications: 'members.applications.manage',
  approve: 'members.applications.approve',
  members: 'members.members.manage',
  payments: 'members.payments.manage',
  reports: 'members.reports.read',
  settings: 'members.settings.manage',
} as const;

const P = MEMBER_PERMISSIONS;

export const membersManifest: ErpModuleManifest = {
  code: 'members',
  name: 'العضوية',
  description: 'عضوية الجمعية العمومية: طلبات العضوية ومراحل اعتمادها، سجل الأعضاء وهوياتهم، أنواع العضوية واشتراكاتها، الدفع الإلكتروني، التجديد والتنبيهات، وحق التصويت',
  icon: 'badge',
  version: '1.0.0',
  alwaysEnabled: true,
  sequence: 85,
  depends: ['accounting'],
  permissions: [
    { code: P.read, name: 'عرض لوحة العضوية وسجل الأعضاء والطلبات' },
    { code: P.applications, name: 'إدخال طلبات العضوية وتعديلها' },
    { code: P.approve, name: 'اعتماد طلبات العضوية في مراحلها أو إرجاعها أو رفضها' },
    { code: P.members, name: 'تعديل بيانات الأعضاء وإضافة الأعضاء الحاليين وإيقاف العضوية وإنهائها' },
    { code: P.payments, name: 'إصدار مطالبات الاشتراك والتجديد وتسجيل السداد وتأكيد التحويلات' },
    { code: P.reports, name: 'عرض تقارير العضوية' },
    { code: P.settings, name: 'إعدادات العضوية وصلاحياتها' },
  ],
  settingsPermission: P.settings,
  menu: [
    { label: 'لوحة العضوية', path: '/members', permission: P.read },
    { label: 'طلبات العضوية', path: '/members/applications', permission: P.read, group: 'الطلبات' },
    { label: 'اعتماد الطلبات', path: '/members/approvals', permission: P.approve, group: 'الطلبات' },
    { label: 'سجل الأعضاء', path: '/members/list', permission: P.read, group: 'الأعضاء' },
    { label: 'التجديد والتنبيهات', path: '/members/renewals', permission: P.read, group: 'الأعضاء' },
    { label: 'الجمعية العمومية', path: '/members/assembly', permission: P.read, group: 'الأعضاء' },
    { label: 'المطالبات والمدفوعات', path: '/members/invoices', permission: P.read },
    { label: 'التقارير', path: '/members/reports', permission: P.reports },
    { label: 'الإعدادات', path: '/members/settings', permission: P.settings },
  ],
};
