import { defineAsyncComponent } from 'vue';
import type { RouteRecordRaw } from 'vue-router';
import { P } from './lib';

const meta = (title: string, permission: string = P.read) => ({ permission, title, app: 'governance' });

export const governanceRoutes: RouteRecordRaw[] = [
  { path: '/governance', component: () => import('./views/DashboardView.vue'), meta: meta('لوحة الحوكمة') },
  { path: '/governance/alerts', component: () => import('./views/AlertsView.vue'), meta: meta('الإنذار المبكر') },
  { path: '/governance/assessments', component: () => import('./views/AssessmentsView.vue'), meta: meta('التقييمات الدورية') },
  { path: '/governance/assessments/:id', component: () => import('./views/AssessmentView.vue'), props: true, meta: meta('بطاقات التقييم') },
  { path: '/governance/finance', component: () => import('./views/FinanceView.vue'), meta: meta('مؤشرات السلامة المالية') },
  { path: '/governance/actions', component: () => import('./views/ActionsView.vue'), meta: meta('فرص وخطة التحسين') },
  { path: '/governance/calendar', component: () => import('./views/CalendarView.vue'), meta: meta('تقويم الالتزامات') },
  { path: '/governance/guide', component: () => import('./views/GuideView.vue'), meta: meta('دليل التقييم') },
  { path: '/governance/reports', component: () => import('../../components/reports/ReportsHub.vue'),
    props: { module: 'governance', system: 'الحوكمة', overview: defineAsyncComponent(() => import('./views/DashboardView.vue')), overviewLabel: 'لوحة الحوكمة' },
    meta: meta('تقارير الحوكمة', P.reports) },
  { path: '/governance/settings', component: () => import('./views/SettingsView.vue'), meta: meta('إعدادات الحوكمة', P.settings) },
];
