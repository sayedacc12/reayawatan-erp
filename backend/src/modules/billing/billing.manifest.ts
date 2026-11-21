import { ErpModuleManifest } from '../../platform/erp-module';

export const BILLING_PERMISSIONS = {
  read: 'billing.dashboard.read',
  customers: 'billing.customers.manage',
  items: 'billing.items.manage',
  invoices: 'billing.invoices.manage',
  issue: 'billing.invoices.issue',
  reports: 'billing.reports.read',
  settings: 'billing.settings.manage',
} as const;

const P = BILLING_PERMISSIONS;

export const billingManifest: ErpModuleManifest = {
  code: 'billing',
  name: 'الفوترة والمبيعات',
  description: 'فواتير المبيعات الضريبية والمبسطة والإشعارات الدائنة والمدينة برمز QR، وسجل العملاء والأصناف والخدمات وفئات الضريبة، والقيود الآلية في النظام المالي وتحصيلها بسندات القبض، ومطابقة الذمم وضريبة المخرجات مع الدليل، والربط مع منصة «فاتورة» بشهادة لكل جمعية وتوقيع كل فاتورة ضريبية إلكترونيًا',
  icon: 'receipt',
  version: '1.0.0',
  alwaysEnabled: true,
  sequence: 69,
  depends: ['accounting'],
  permissions: [
    { code: P.read, name: 'عرض لوحة الفوترة والفواتير والعملاء والأصناف' },
    { code: P.customers, name: 'إدارة سجل العملاء' },
    { code: P.items, name: 'إدارة الأصناف والخدمات وفئاتها الضريبية' },
    { code: P.invoices, name: 'إنشاء الفواتير والإشعارات الدائنة والمدينة وتعديل مسوداتها وإرسالها للإصدار' },
    { code: P.issue, name: 'إصدار الفواتير والإشعارات (اعتمادها وإنشاء قيدها) أو إعادتها للتعديل' },
    { code: P.reports, name: 'عرض تقارير الفوترة والمبيعات وتصديرها' },
    { code: P.settings, name: 'إعدادات الفوترة والبيانات الضريبية وصلاحياتها' },
  ],
  settingsPermission: P.settings,
  menu: [
    { label: 'لوحة الفوترة', path: '/billing', permission: P.read },
    { label: 'فواتير المبيعات', path: '/billing/invoices', permission: P.read, anyOf: [P.invoices, P.issue], group: 'المبيعات' },
    { label: 'العملاء', path: '/billing/customers', permission: P.read, anyOf: [P.customers], group: 'المبيعات' },
    { label: 'الأصناف والخدمات', path: '/billing/items', permission: P.read, anyOf: [P.items], group: 'المبيعات' },
    { label: 'المطابقة مع الدليل', path: '/billing/reconciliation', permission: P.read, anyOf: [P.reports] },
    { label: 'التقارير', path: '/billing/reports', permission: P.reports },
    { label: 'الربط مع «فاتورة»', path: '/billing/zatca', permission: P.settings },
    { label: 'الإعدادات', path: '/billing/settings', permission: P.settings },
  ],
};
