import type { RouteRecordRaw } from 'vue-router';

const ORGS = 'platform.organizations.manage';
const SUBS = 'platform.subscriptions.manage';
const SUPPORT = 'platform.support.manage';

export const platformRoutes: RouteRecordRaw[] = [
  { path: '/platform/organizations', component: () => import('./views/OrganizationsView.vue'), meta: { permission: ORGS, title: 'الجمعيات' } },
  { path: '/platform/organizations/:id', component: () => import('./views/OrganizationView.vue'), meta: { permission: SUBS, title: 'ملف الجمعية' } },
  { path: '/platform/applications', component: () => import('./views/ApplicationsView.vue'), meta: { permission: SUBS, title: 'طلبات الاشتراك' } },
  { path: '/platform/applications/:id', component: () => import('./views/ApplicationView.vue'), meta: { permission: SUBS, title: 'طلب اشتراك' } },
  { path: '/platform/contracts', component: () => import('./views/ContractsView.vue'), meta: { permission: SUBS, title: 'العقود' } },
  { path: '/platform/contracts/:id', component: () => import('./views/ContractView.vue'), meta: { permission: SUBS, title: 'العقد' } },
  { path: '/platform/contract-clauses', component: () => import('./views/ContractClausesView.vue'), meta: { permission: SUBS, title: 'بنود العقد' } },
  { path: '/platform/support', component: () => import('../../support/PlatformSupportView.vue'), meta: { permission: SUPPORT, title: 'طلبات الصيانة' } },
  { path: '/platform/support/:id', component: () => import('../../support/PlatformTicketView.vue'), meta: { permission: SUPPORT, title: 'طلب صيانة' } },
  { path: '/platform/sla', component: () => import('../../support/SlaSettingsView.vue'), meta: { permission: SUPPORT, title: 'مستويات الخدمة' } },
  { path: '/platform/reports', component: () => import('./views/ReportsView.vue'), meta: { permission: 'platform.reports.read', title: 'تقارير المنصة' } },
];
