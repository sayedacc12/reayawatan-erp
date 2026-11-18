import type { RouteRecordRaw } from 'vue-router';
import { PT } from './lib';

const meta = (title: string, permission: string = PT.read) => ({ permission, title, app: 'partnerships' });

export const partnershipsRoutes: RouteRecordRaw[] = [
  { path: '/partnerships', component: () => import('./views/DashboardView.vue'), meta: meta('لوحة الشراكات') },
  { path: '/partnerships/partners', component: () => import('./views/PartnersView.vue'), meta: meta('سجل الشركاء') },
  { path: '/partnerships/partners/:id', component: () => import('./views/PartnerView.vue'), props: true, meta: meta('ملف الشريك') },
  { path: '/partnerships/approvals', component: () => import('./views/ApprovalsView.vue'), meta: meta('اعتمادات الشراكات', PT.approve) },
  { path: '/partnerships/contracts', component: () => import('./views/ContractsView.vue'), meta: meta('عقود الشراكة') },
  { path: '/partnerships/contracts/:id', component: () => import('./views/ContractView.vue'), props: true, meta: meta('عقد شراكة') },
  { path: '/partnerships/followups', component: () => import('./views/FollowupsView.vue'), meta: meta('المتابعة والتنبيهات') },
  { path: '/partnerships/clauses', component: () => import('./views/ClausesView.vue'), meta: meta('مكتبة بنود العقود', PT.contracts) },
  { path: '/partnerships/reports', component: () => import('../../components/reports/ReportsHub.vue'), props: { module: 'partnerships', system: 'الشراكات' }, meta: meta('تقارير الشراكات', PT.reports) },
  { path: '/partnerships/settings', component: () => import('./views/SettingsView.vue'), meta: meta('إعدادات الشراكات', PT.settings) },
];
