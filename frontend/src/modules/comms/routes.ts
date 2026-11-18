import type { RouteRecordRaw } from 'vue-router';
import { P } from './lib';

const meta = (title: string, permission: string = P.read) => ({ permission, title, app: 'comms' });

export const commsRoutes: RouteRecordRaw[] = [
  { path: '/comms', component: () => import('./views/DashboardView.vue'), meta: meta('لوحة الاتصالات الإدارية') },
  { path: '/comms/inbox', component: () => import('./views/BoxView.vue'), props: { box: 'inbox' }, meta: meta('معاملاتي') },
  { path: '/comms/registry', component: () => import('./views/BoxView.vue'), props: { box: 'registry' }, meta: { title: 'سجل المعاملات', app: 'comms', anyPermission: [P.registry, P.registryMedium] } },
  { path: '/comms/decisions', component: () => import('./views/BoxView.vue'), props: { box: 'decisions' }, meta: meta('القرارات والتعاميم') },
  { path: '/comms/new', component: () => import('./views/ComposeView.vue'), meta: { title: 'معاملة جديدة', app: 'comms', anyPermission: [P.create, P.decisions] } },
  { path: '/comms/edit/:id', component: () => import('./views/ComposeView.vue'), props: true, meta: { title: 'تعديل المسودة', app: 'comms' } },
  // صفحات التفاصيل لكل موجه إليه شيء (الخادم يتحقق من السرية والأطراف)
  { path: '/comms/t/:id', component: () => import('./views/TransactionView.vue'), props: true, meta: { title: 'المعاملة', app: 'comms' } },
  { path: '/comms/tasks', component: () => import('./views/TasksView.vue'), meta: { title: 'مهامي', app: 'comms' } },
  { path: '/comms/tasks/all', component: () => import('./views/TasksView.vue'), props: { all: true }, meta: meta('كل المهام', P.tasksAll) },
  { path: '/comms/tasks/:id', component: () => import('./views/TaskView.vue'), props: true, meta: { title: 'المهمة', app: 'comms' } },
  { path: '/comms/reports', component: () => import('../../components/reports/ReportsHub.vue'),
    props: { module: 'comms', system: 'الاتصالات الإدارية', intro: 'كل تقرير يعرض ما يحق لك الاطلاع عليه فقط: المعاملات السرية والعالية السرية لا تظهر إلا لأطرافها.' },
    meta: meta('تقارير الاتصالات الإدارية', P.reports) },
  { path: '/comms/settings', component: () => import('./views/SettingsView.vue'), meta: meta('إعدادات الاتصالات الإدارية', P.settings) },
];
