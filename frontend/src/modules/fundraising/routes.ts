import type { RouteRecordRaw } from 'vue-router';

const meta = (title: string, permission: string) => ({ permission, title, app: 'fundraising' });
const P = {
  donors: 'fundraising.donors.read', read: 'fundraising.opportunities.read', create: 'fundraising.opportunities.create',
  journal: 'fundraising.journal.read', reports: 'fundraising.reports.read', settings: 'fundraising.settings.manage',
};

export const fundraisingRoutes: RouteRecordRaw[] = [
  { path: '/fundraising', component: () => import('./views/DashboardView.vue'), meta: meta('لوحة الموارد المالية', P.reports) },
  { path: '/fundraising/donors', component: () => import('./views/DonorsView.vue'), meta: meta('سجل الداعمين', P.donors) },
  { path: '/fundraising/donors/:id', component: () => import('./views/DonorView.vue'), meta: meta('ملف داعم', P.donors) },
  { path: '/fundraising/opportunities', component: () => import('./views/OpportunitiesView.vue'), meta: meta('فرص التبرع', P.read) },
  { path: '/fundraising/opportunities/new', component: () => import('./views/OpportunityFormView.vue'), meta: meta('فرصة تبرع جديدة', P.create) },
  { path: '/fundraising/opportunities/:id/edit', component: () => import('./views/OpportunityFormView.vue'), meta: meta('تعديل فرصة تبرع', P.create) },
  { path: '/fundraising/opportunities/:id/receipt', component: () => import('./views/ReceiptView.vue'), meta: meta('سند قبض', P.read) },
  { path: '/fundraising/opportunities/:id', component: () => import('./views/OpportunityView.vue'), meta: meta('فرصة تبرع', P.read) },
  { path: '/fundraising/batches', component: () => import('./views/BatchesView.vue'), meta: meta('الدفعات', P.read) },
  { path: '/fundraising/batches/:id', component: () => import('./views/BatchView.vue'), meta: meta('دفعة', P.read) },
  { path: '/fundraising/journal', component: () => import('./views/JournalView.vue'), meta: meta('قيود اليومية', P.journal) },
  { path: '/fundraising/reports', component: () => import('./views/ReportsView.vue'), meta: meta('تقارير الموارد المالية', P.reports) },
  { path: '/fundraising/settings', component: () => import('./views/SettingsView.vue'), meta: meta('إعدادات الموارد المالية', P.settings) },
];
