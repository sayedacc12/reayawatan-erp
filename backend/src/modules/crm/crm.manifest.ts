import { ErpModuleManifest } from '../../platform/erp-module';

export const CRM_PERMISSIONS = {
  read: 'crm.records.read',
  manage: 'crm.records.manage',
  all: 'crm.records.all',
  assign: 'crm.leads.assign',
  merge: 'crm.parties.merge',
  import: 'crm.data.import',
  reports: 'crm.reports.read',
  settings: 'crm.settings.manage',
} as const;

const P = CRM_PERMISSIONS;

export const crmManifest: ErpModuleManifest = {
  code: 'crm',
  name: 'علاقات العملاء والتسويق',
  description: 'سجل جهات موحد يجمع العميل والعضو والمتطوع والشريك في ملف واحد، والعملاء المحتملون من نماذج الموقع والإدخال والاستيراد وتوزيعهم ومهلة التواصل الأول وتأهيلهم، والأنشطة والمتابعات والتقويم، ومنع التكرار ودمج المكرر',
  icon: 'funnel',
  version: '1.0.0',
  alwaysEnabled: true,
  sequence: 68,
  permissions: [
    { code: P.read, name: 'عرض الجهات والعملاء المحتملين والأنشطة (المسندة إليه، أو كل الجهات إن سمحت الإعدادات)' },
    { code: P.manage, name: 'إضافة الجهات والعملاء المحتملين وتعديلهم وتأهيلهم، وتسجيل الأنشطة والمتابعات' },
    { code: P.all, name: 'رؤية وإدارة سجلات كل الفريق وأنشطتهم (مدير المبيعات والتسويق)' },
    { code: P.assign, name: 'توزيع العملاء المحتملين على الفريق وإعادة إسنادهم' },
    { code: P.merge, name: 'دمج الجهات المكررة وربط الجهات بسجلاتها في الأنظمة الأخرى' },
    { code: P.import, name: 'استيراد العملاء المحتملين من ملف' },
    { code: P.reports, name: 'عرض تقارير علاقات العملاء' },
    { code: P.settings, name: 'إعدادات علاقات العملاء: المهلة والتوزيع والفريق والقوائم والصلاحيات' },
  ],
  settingsPermission: P.settings,
  menu: [
    { label: 'لوحة العلاقات', path: '/crm', permission: P.read },
    { label: 'الجهات', path: '/crm/parties', permission: P.read, group: 'الجهات' },
    { label: 'المكرر والدمج', path: '/crm/duplicates', permission: P.merge, group: 'الجهات' },
    { label: 'العملاء المحتملون', path: '/crm/leads', permission: P.read, group: 'العملاء المحتملون' },
    { label: 'استيراد من ملف', path: '/crm/import', permission: P.import, group: 'العملاء المحتملون' },
    { label: 'الأنشطة والتقويم', path: '/crm/activities', permission: P.read },
    { label: 'التقارير', path: '/crm/reports', permission: P.reports },
    { label: 'الإعدادات', path: '/crm/settings', permission: P.settings },
  ],
};
