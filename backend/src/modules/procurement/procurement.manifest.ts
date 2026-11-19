import { ErpModuleManifest } from '../../platform/erp-module';

export const PROCUREMENT_PERMISSIONS = {
  read: 'procurement.dashboard.read',
  items: 'procurement.items.manage',
  warehouses: 'procurement.warehouses.manage',
  suppliersRead: 'procurement.suppliers.read',
  suppliers: 'procurement.suppliers.manage',
  approveSuppliers: 'procurement.suppliers.approve',
  approveBanks: 'procurement.banks.approve',
  reports: 'procurement.reports.read',
  settings: 'procurement.settings.manage',
} as const;

const P = PROCUREMENT_PERMISSIONS;

export const procurementManifest: ErpModuleManifest = {
  code: 'procurement',
  name: 'المشتريات والمستودعات',
  description: 'دليل الأصناف ووحدات القياس، والمستودعات ومواقع التخزين وحساباتها، وسجل الموردين ومزودي الخدمات وبوابتهم الإلكترونية للتسجيل والمستندات والحسابات البنكية',
  icon: 'box',
  version: '1.0.0',
  alwaysEnabled: true,
  sequence: 68,
  depends: ['accounting'],
  permissions: [
    { code: P.read, name: 'عرض الأصناف والمستودعات ولوحة المشتريات' },
    { code: P.items, name: 'إدارة دليل الأصناف ومجموعاتها ووحدات القياس' },
    { code: P.warehouses, name: 'إدارة المستودعات ومواقع التخزين' },
    { code: P.suppliersRead, name: 'عرض سجل الموردين ومستنداتهم' },
    { code: P.suppliers, name: 'تسجيل الموردين وتحديث بياناتهم ومستنداتهم' },
    { code: P.approveSuppliers, name: 'اعتماد الموردين ومراجعة مستنداتهم وإيقافهم' },
    { code: P.approveBanks, name: 'اعتماد الحسابات البنكية للموردين وتغييرها' },
    { code: P.reports, name: 'عرض تقارير المشتريات والمستودعات وتصديرها' },
    { code: P.settings, name: 'إعدادات المشتريات والمستودعات وصلاحياتها' },
  ],
  settingsPermission: P.settings,
  menu: [
    { label: 'لوحة المشتريات والمستودعات', path: '/procurement', permission: P.read },
    { label: 'دليل الأصناف', path: '/procurement/items', permission: P.read, group: 'الأصناف والمستودعات' },
    { label: 'المجموعات ووحدات القياس', path: '/procurement/item-groups', permission: P.read, group: 'الأصناف والمستودعات' },
    { label: 'المستودعات ومواقع التخزين', path: '/procurement/warehouses', permission: P.read, group: 'الأصناف والمستودعات' },
    { label: 'سجل الموردين', path: '/procurement/suppliers', permission: P.suppliersRead, group: 'الموردون' },
    { label: 'طلبات الاعتماد', path: '/procurement/supplier-approvals', permission: P.approveSuppliers, anyOf: [P.approveBanks], group: 'الموردون' },
    { label: 'التقارير', path: '/procurement/reports', permission: P.reports },
    { label: 'الإعدادات', path: '/procurement/settings', permission: P.settings },
  ],
};
