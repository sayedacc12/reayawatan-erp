import type { RouteRecordRaw } from 'vue-router';
import { WP } from './lib';

const meta = (title: string, permission: string = WP.read) => ({ permission, title, app: 'website' });

export const websiteRoutes: RouteRecordRaw[] = [
  { path: '/website', component: () => import('./views/DashboardView.vue'), meta: meta('لوحة الموقع الإلكتروني') },
  { path: '/website/news', component: () => import('./views/NewsView.vue'), meta: meta('الأخبار') },
  { path: '/website/news/new', component: () => import('./views/NewsEditView.vue'), meta: meta('خبر جديد') },
  { path: '/website/news/:id', component: () => import('./views/NewsEditView.vue'), props: true, meta: meta('خبر') },
  { path: '/website/programs', component: () => import('./views/ProgramsView.vue'), meta: meta('البرامج') },
  { path: '/website/programs/new', component: () => import('./views/ProgramEditView.vue'), meta: meta('برنامج جديد') },
  { path: '/website/programs/:id', component: () => import('./views/ProgramEditView.vue'), props: true, meta: meta('برنامج') },
  { path: '/website/pages', component: () => import('./views/PagesView.vue'), meta: meta('صفحات الموقع', WP.pages) },
  { path: '/website/media', component: () => import('./views/MediaView.vue'), meta: meta('مكتبة الصور', WP.edit) },
  { path: '/website/donations', component: () => import('./views/DonationsView.vue'), meta: meta('تبرعات المتجر', WP.donations) },
  { path: '/website/subscriptions', component: () => import('./views/SubscriptionsView.vue'), meta: meta('التبرعات الشهرية', WP.donations) },
  { path: '/website/messages', component: () => import('./views/MessagesView.vue'), meta: meta('رسائل الزوار', WP.messages) },
  { path: '/website/activity', component: () => import('./views/ActivityView.vue'), meta: meta('سجل النشاط', WP.settings) },
  { path: '/website/reports', component: () => import('../../components/reports/ReportsHub.vue'), props: { module: 'website', system: 'الموقع الإلكتروني' }, meta: meta('تقارير الموقع', WP.reports) },
  { path: '/website/settings', component: () => import('./views/SettingsView.vue'), meta: meta('إعدادات الموقع', WP.settings) },
];
