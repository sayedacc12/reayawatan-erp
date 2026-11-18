import type { RouteRecordRaw } from 'vue-router';
import { KP } from './lib';

const meta = (title: string, permission: string = KP.read) => ({ permission, title, app: 'knowledge' });

export const knowledgeRoutes: RouteRecordRaw[] = [
  { path: '/knowledge', component: () => import('./views/ArchiveView.vue'), meta: meta('أرشيف المعرفة') },
  { path: '/knowledge/reports', component: () => import('../../components/reports/ReportsHub.vue'), props: { module: 'knowledge', system: 'أرشيف المعرفة' }, meta: meta('تقارير أرشيف المعرفة', KP.reports) },
  { path: '/knowledge/settings', component: () => import('./views/SettingsView.vue'), meta: meta('إعدادات أرشيف المعرفة', KP.settings) },
  { path: '/knowledge/:id', component: () => import('./views/DocumentView.vue'), props: true, meta: meta('وثيقة') },
];
