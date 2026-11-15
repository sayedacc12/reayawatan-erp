import type { RouteRecordRaw } from 'vue-router';

const meta = (title: string) => ({ permission: 'beneficiaries.cases.read', title, app: 'beneficiaries' });

export const beneficiariesRoutes: RouteRecordRaw[] = [
  { path: '/beneficiaries', component: () => import('./views/DashboardView.vue'), meta: meta('لوحة المستفيدين') },
  { path: '/beneficiaries/files', component: () => import('./views/FilesView.vue'), meta: meta('ملفات المستفيدين') },
  { path: '/beneficiaries/files/:id', component: () => import('./views/ProfileView.vue'), meta: meta('ملف مستفيد') },
  { path: '/beneficiaries/aid-log', component: () => import('./views/AidLogView.vue'), meta: meta('سجل المساعدات') },
];
