import type { RouteRecordRaw } from 'vue-router';

const ORGS = 'platform.organizations.manage';
const SUBS = 'platform.subscriptions.manage';
const SITE = 'platform.site.manage';

export const platformRoutes: RouteRecordRaw[] = [
  { path: '/platform/organizations', component: () => import('./views/OrganizationsView.vue'), meta: { permission: ORGS, title: 'الجمعيات' } },
  { path: '/platform/organizations/:id', component: () => import('./views/OrganizationView.vue'), meta: { permission: SUBS, title: 'ملف الجمعية' } },
  { path: '/platform/lifecycle', component: () => import('./views/LifecycleView.vue'), meta: { permission: ORGS, title: 'مواعيد الحذف' } },
  { path: '/platform/applications', component: () => import('./views/ApplicationsView.vue'), meta: { permission: SUBS, title: 'طلبات الاشتراك' } },
  { path: '/platform/applications/:id', component: () => import('./views/ApplicationView.vue'), meta: { permission: SUBS, title: 'طلب اشتراك' } },
  { path: '/platform/contracts', component: () => import('./views/ContractsView.vue'), meta: { permission: SUBS, title: 'العقود' } },
  { path: '/platform/contracts/:id', component: () => import('./views/ContractView.vue'), meta: { permission: SUBS, title: 'العقد' } },
  { path: '/platform/contract-clauses', component: () => import('./views/ContractClausesView.vue'), meta: { permission: SUBS, title: 'بنود العقد' } },
  { path: '/platform/inquiries', component: () => import('./views/InquiriesView.vue'), meta: { permission: SITE, title: 'طلبات الخدمات' } },
  { path: '/platform/mail', component: () => import('./views/MailView.vue'), meta: { permission: SITE, title: 'البريد الإلكتروني' } },
  { path: '/platform/settings', component: () => import('./views/PlatformSettingsView.vue'), meta: { permission: SITE, title: 'إعدادات المنصة' } },
  { path: '/platform/reports', component: () => import('./views/ReportsView.vue'), meta: { permission: 'platform.reports.read', title: 'تقارير المنصة' } },
  { path: '/platform/performance', component: () => import('./views/PerformanceView.vue'), meta: { permission: 'platform.reports.read', title: 'الأداء وحجم البيانات' } },
  { path: '/platform/backups', component: () => import('./views/BackupsView.vue'), meta: { permission: 'platform.reports.read', title: 'النسخ الاحتياطي' } },
];
