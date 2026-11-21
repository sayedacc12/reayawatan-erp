import type { RouteRecordRaw } from 'vue-router';
import { BL, BL_READ } from './lib';

const meta = (title: string, permission: string = BL.read) => ({ permission, title, app: 'billing' });
const any = (title: string, anyPermission: string[]) => ({ anyPermission, title, app: 'billing' });

export const billingRoutes: RouteRecordRaw[] = [
  { path: '/billing', component: () => import('./views/DashboardView.vue'), meta: any('لوحة الفوترة والمبيعات', BL_READ) },
  { path: '/billing/invoices', component: () => import('./views/DocumentsView.vue'), meta: any('فواتير المبيعات', BL_READ) },
  { path: '/billing/invoices/new', component: () => import('./views/DocumentFormView.vue'), meta: meta('فاتورة جديدة', BL.invoices) },
  { path: '/billing/invoices/:id', component: () => import('./views/DocumentView.vue'), props: true, meta: any('الفاتورة', BL_READ) },
  { path: '/billing/invoices/:id/edit', component: () => import('./views/DocumentFormView.vue'), props: true, meta: meta('تعديل المسودة', BL.invoices) },
  { path: '/billing/customers', component: () => import('./views/CustomersView.vue'), meta: any('العملاء', BL_READ) },
  { path: '/billing/customers/:id', component: () => import('./views/CustomerView.vue'), props: true, meta: any('ملف العميل وكشف حسابه', BL_READ) },
  { path: '/billing/items', component: () => import('./views/ItemsView.vue'), meta: any('الأصناف والخدمات', [...BL_READ, BL.items]) },
  { path: '/billing/reconciliation', component: () => import('./views/ReconciliationView.vue'), meta: any('المطابقة مع الدليل', [BL.read, BL.reports, BL.settings]) },
  { path: '/billing/reports', component: () => import('../../components/reports/ReportsHub.vue'), props: { module: 'billing', system: 'الفوترة والمبيعات' }, meta: meta('تقارير الفوترة والمبيعات', BL.reports) },
  { path: '/billing/settings', component: () => import('./views/SettingsView.vue'), meta: meta('إعدادات الفوترة', BL.settings) },
];
