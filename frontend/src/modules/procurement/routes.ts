import type { RouteRecordRaw } from 'vue-router';
import { PR } from './lib';

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
  { path: '/procurement/reports', component: () => import('../../components/reports/ReportsHub.vue'), props: { module: 'procurement', system: 'المشتريات والمستودعات' }, meta: meta('تقارير المشتريات', PR.reports) },
  { path: '/procurement/settings', component: () => import('./views/SettingsView.vue'), meta: meta('إعدادات المشتريات', PR.settings) },
];
