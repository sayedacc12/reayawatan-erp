import type { RouteRecordRaw } from 'vue-router';
import { P } from './lib';

const meta = (title: string, permission: string = P.read) => ({ permission, title, app: 'audit' });

export const auditRoutes: RouteRecordRaw[] = [
  { path: '/audit', component: () => import('./views/DashboardView.vue'), meta: meta('لوحة المراجعة الداخلية') },
  { path: '/audit/universe', component: () => import('./views/UniverseView.vue'), meta: meta('مجالات المراجعة والمخاطر') },
  { path: '/audit/plans', component: () => import('./views/PlansView.vue'), meta: meta('خطط المراجعة') },
  { path: '/audit/plans/:id', component: () => import('./views/PlanView.vue'), props: true, meta: meta('خطة المراجعة') },
  { path: '/audit/engagements', component: () => import('./views/EngagementsView.vue'), meta: meta('مهام المراجعة') },
  { path: '/audit/engagements/:id', component: () => import('./views/EngagementView.vue'), props: true, meta: meta('مهمة المراجعة') },
  { path: '/audit/engagements/:id/report', component: () => import('./views/ReportPrintView.vue'), props: true, meta: meta('تقرير المراجعة') },
  // الجهات المسؤولة تصل لمتابعة توصياتها بصلاحية المتابعة فقط
  { path: '/audit/actions', component: () => import('./views/ActionsView.vue'), meta: { title: 'متابعة التوصيات', app: 'audit', anyPermission: [P.read, P.respond] } },
  { path: '/audit/actions/:id', component: () => import('./views/ActionView.vue'), props: true, meta: { title: 'مهمة متابعة', app: 'audit', anyPermission: [P.read, P.respond] } },
  { path: '/audit/reports', component: () => import('./views/ReportsView.vue'), meta: meta('تقارير المراجعة الداخلية', P.reports) },
  { path: '/audit/settings', component: () => import('./views/SettingsView.vue'), meta: meta('إعدادات المراجعة الداخلية', P.settings) },
];
