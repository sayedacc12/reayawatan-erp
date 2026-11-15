import type { RouteRecordRaw } from 'vue-router';
import { P } from './lib';

const meta = (title: string, permission: string = P.read, anyPermission?: string[]) =>
  ({ permission: anyPermission ? undefined : permission, anyPermission, title, app: 'accounting' });

export const accountingRoutes: RouteRecordRaw[] = [
  { path: '/accounting', component: () => import('./views/DashboardView.vue'), meta: meta('لوحة النظام المالي') },
  { path: '/accounting/receipts', component: () => import('./views/VouchersView.vue'), props: { kind: 'receipt' }, meta: meta('سندات القبض') },
  { path: '/accounting/payments', component: () => import('./views/VouchersView.vue'), props: { kind: 'payment' }, meta: meta('سندات الصرف') },
  { path: '/accounting/vouchers/:id', component: () => import('./views/VoucherView.vue'), props: true, meta: meta('السند') },
  { path: '/accounting/entries', component: () => import('./views/EntriesView.vue'), meta: meta('قيود اليومية') },
  { path: '/accounting/entries/new', component: () => import('./views/EntryEditor.vue'), meta: meta('قيد جديد', P.entries) },
  { path: '/accounting/entries/:id', component: () => import('./views/EntryEditor.vue'), props: true, meta: meta('القيد') },
  { path: '/accounting/posting', component: () => import('./views/PostingView.vue'), meta: meta('الترحيل وإغلاق الفترات', P.post, [P.post, P.closePeriods, P.reopenPeriods]) },
  { path: '/accounting/accounts', component: () => import('./views/AccountsView.vue'), meta: meta('الدليل المحاسبي') },
  { path: '/accounting/analytic', component: () => import('./views/AnalyticView.vue'), meta: meta('الحسابات التحليلية') },
  { path: '/accounting/partners', component: () => import('./views/PartnersView.vue'), meta: meta('العملاء والموردون') },
  { path: '/accounting/banks', component: () => import('./views/BanksView.vue'), meta: meta('البنوك والنقدية') },
  { path: '/accounting/warehouses', component: () => import('./views/WarehousesView.vue'), meta: meta('المستودعات') },
  { path: '/accounting/setup', component: () => import('./views/SetupView.vue'), meta: meta('الافتتاحيات والسنوات المالية', P.setup, [P.setup, P.closePeriods, P.reopenPeriods, P.read]) },
  { path: '/accounting/inventory', component: () => import('./views/InventoryView.vue'), meta: meta('محضر جرد السندات') },
  { path: '/accounting/reports', component: () => import('./views/ReportsView.vue'), meta: meta('تقارير النظام المالي', P.reports) },
  { path: '/accounting/settings', component: () => import('./views/SettingsView.vue'), meta: meta('إعدادات النظام المالي', P.settings) },
];
