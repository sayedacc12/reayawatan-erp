import type { RouteRecordRaw } from 'vue-router';
import { P } from './lib';

const meta = (title: string, permission: string = P.read) => ({ permission, title, app: 'website' });

export const websiteRoutes: RouteRecordRaw[] = [
  { path: '/website', component: () => import('./views/DashboardView.vue'), meta: meta('لوحة الموقع') },
  { path: '/website/leads', component: () => import('./views/LeadsView.vue'), meta: meta('العملاء المحتملون', P.leadsRead) },
  { path: '/website/leads/:id', component: () => import('./views/LeadView.vue'), props: true, meta: meta('عميل محتمل', P.leadsRead) },
  { path: '/website/bookings', component: () => import('./views/BookingsView.vue'), meta: meta('حجوزات التشخيص', P.leadsRead) },
  { path: '/website/availability', component: () => import('./views/AvailabilityView.vue'), meta: meta('أوقات الإتاحة', P.bookings) },
  { path: '/website/pages', component: () => import('./views/PagesView.vue'), meta: meta('صفحات الموقع', P.content) },
  { path: '/website/services', component: () => import('./views/ServicesView.vue'), meta: meta('خدمات الموقع', P.content) },
  { path: '/website/guides', component: () => import('./views/GuidesView.vue'), meta: meta('مكتبة الأدلة', P.guides) },
  { path: '/website/settings', component: () => import('./views/SettingsView.vue'), meta: meta('إعدادات الموقع', P.settings) },
];
