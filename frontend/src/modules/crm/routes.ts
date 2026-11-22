import type { RouteRecordRaw } from 'vue-router';
import { CR } from './lib';

const meta = (title: string, permission: string = CR.read) => ({ permission, title, app: 'crm' });

export const crmRoutes: RouteRecordRaw[] = [
  { path: '/crm', component: () => import('./views/DashboardView.vue'), meta: meta('لوحة علاقات العملاء') },
  { path: '/crm/parties', component: () => import('./views/PartiesView.vue'), meta: meta('الجهات') },
  { path: '/crm/parties/:id', component: () => import('./views/PartyView.vue'), props: true, meta: meta('ملف الجهة') },
  { path: '/crm/duplicates', component: () => import('./views/DuplicatesView.vue'), meta: meta('المكرر والدمج', CR.merge) },
  { path: '/crm/leads', component: () => import('./views/LeadsView.vue'), meta: meta('العملاء المحتملون') },
  { path: '/crm/leads/:id', component: () => import('./views/LeadView.vue'), props: true, meta: meta('العميل المحتمل') },
  { path: '/crm/import', component: () => import('./views/ImportView.vue'), meta: meta('استيراد العملاء المحتملين', CR.import) },
  { path: '/crm/activities', component: () => import('./views/ActivitiesView.vue'), meta: meta('الأنشطة والتقويم') },
  { path: '/crm/reports', component: () => import('../../components/reports/ReportsHub.vue'), props: { module: 'crm', system: 'علاقات العملاء والتسويق' }, meta: meta('تقارير علاقات العملاء', CR.reports) },
  { path: '/crm/settings', component: () => import('./views/SettingsView.vue'), meta: meta('إعدادات علاقات العملاء', CR.settings) },
];
