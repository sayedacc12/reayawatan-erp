import type { RouteRecordRaw } from 'vue-router';

const meta = (title: string) => ({ permission: 'beneficiaries.cases.read', title, app: 'beneficiaries' });

export const beneficiariesRoutes: RouteRecordRaw[] = [
  { path: '/beneficiaries', component: () => import('./views/DashboardView.vue'), meta: meta('لوحة المستفيدين') },
  { path: '/beneficiaries/files', component: () => import('./views/FilesView.vue'), meta: meta('ملفات المستفيدين') },
  { path: '/beneficiaries/files/:id', component: () => import('./views/ProfileView.vue'), meta: meta('ملف مستفيد') },
  { path: '/beneficiaries/aid-log', component: () => import('./views/AidLogView.vue'), meta: meta('سجل المساعدات') },
  { path: '/beneficiaries/requests', component: () => import('./views/RequestsView.vue'), meta: { ...meta('الطلبات'), permission: 'beneficiaries.requests.read' } },
  { path: '/beneficiaries/requests/:id', component: () => import('./views/RequestView.vue'), meta: { ...meta('تفاصيل الطلب'), permission: 'beneficiaries.requests.read' } },
  { path: '/beneficiaries/tickets', component: () => import('./views/TicketsView.vue'), meta: { ...meta('الشكاوى والمقترحات'), permission: 'beneficiaries.tickets.manage' } },
  { path: '/beneficiaries/settings', component: () => import('./views/SettingsView.vue'), meta: { ...meta('إعدادات المستفيدين'), permission: 'beneficiaries.settings.manage' } },
];
