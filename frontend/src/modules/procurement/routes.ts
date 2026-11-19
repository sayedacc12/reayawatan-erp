import type { RouteRecordRaw } from 'vue-router';
import { ORD_READ, PR, REQ_READ, RFQ_READ } from './lib';

const meta = (title: string, permission: string = PR.read) => ({ permission, title, app: 'procurement' });
/** شاشات يكفي لها أي صلاحية من القائمة */
const any = (title: string, anyPermission: string[]) => ({ anyPermission, title, app: 'procurement' });
const SUP_READ = [PR.suppliersRead, PR.suppliers, PR.approveSuppliers, PR.approveBanks];

export const procurementRoutes: RouteRecordRaw[] = [
  { path: '/procurement', component: () => import('./views/DashboardView.vue'), meta: meta('لوحة المشتريات والمستودعات') },
  { path: '/procurement/items', component: () => import('./views/ItemsView.vue'), meta: meta('دليل الأصناف') },
  { path: '/procurement/items/:id', component: () => import('./views/ItemView.vue'), props: true, meta: meta('بطاقة الصنف') },
  { path: '/procurement/item-groups', component: () => import('./views/GroupsView.vue'), meta: meta('مجموعات الأصناف ووحدات القياس') },
  { path: '/procurement/warehouses', component: () => import('./views/WarehousesView.vue'), meta: meta('المستودعات') },
  { path: '/procurement/warehouses/:id', component: () => import('./views/WarehouseView.vue'), props: true, meta: meta('بطاقة المستودع') },
  { path: '/procurement/suppliers', component: () => import('./views/SuppliersView.vue'), meta: any('سجل الموردين', SUP_READ) },
  { path: '/procurement/suppliers/:id', component: () => import('./views/SupplierView.vue'), props: true, meta: any('ملف المورد', SUP_READ) },
  { path: '/procurement/supplier-approvals', component: () => import('./views/ApprovalsView.vue'), meta: any('طلبات اعتماد الموردين', [PR.approveSuppliers, PR.approveBanks]) },
  { path: '/procurement/requests', component: () => import('./views/RequestsView.vue'), meta: any('طلبات الشراء', REQ_READ) },
  { path: '/procurement/requests/new', component: () => import('./views/RequestFormView.vue'), meta: meta('طلب شراء جديد', PR.requests) },
  { path: '/procurement/requests/:id', component: () => import('./views/RequestView.vue'), props: true, meta: any('طلب الشراء', REQ_READ) },
  { path: '/procurement/requests/:id/edit', component: () => import('./views/RequestFormView.vue'), props: true, meta: meta('تعديل طلب الشراء', PR.requests) },
  { path: '/procurement/rfqs', component: () => import('./views/RfqsView.vue'), meta: any('المنافسات وطلبات العروض', RFQ_READ) },
  { path: '/procurement/rfqs/new', component: () => import('./views/RfqFormView.vue'), meta: meta('طرح منافسة', PR.sourcing) },
  { path: '/procurement/rfqs/:id', component: () => import('./views/RfqView.vue'), props: true, meta: any('المنافسة', RFQ_READ) },
  { path: '/procurement/rfqs/:id/edit', component: () => import('./views/RfqFormView.vue'), props: true, meta: meta('تعديل المنافسة', PR.sourcing) },
  { path: '/procurement/orders', component: () => import('./views/OrdersView.vue'), meta: any('التعميدات', ORD_READ) },
  { path: '/procurement/orders/new', component: () => import('./views/OrderFormView.vue'), meta: meta('إعداد تعميد', PR.sourcing) },
  { path: '/procurement/orders/:id', component: () => import('./views/OrderView.vue'), props: true, meta: any('التعميد', ORD_READ) },
  { path: '/procurement/orders/:id/edit', component: () => import('./views/OrderFormView.vue'), props: true, meta: meta('تعديل التعميد', PR.sourcing) },
  { path: '/procurement/reports', component: () => import('../../components/reports/ReportsHub.vue'), props: { module: 'procurement', system: 'المشتريات والمستودعات' }, meta: meta('تقارير المشتريات', PR.reports) },
  { path: '/procurement/settings', component: () => import('./views/SettingsView.vue'), meta: meta('إعدادات المشتريات', PR.settings) },
];
