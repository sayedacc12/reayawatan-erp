import type { RouteRecordRaw } from 'vue-router';
import { P } from './lib';

const meta = (title: string, permission: string = P.read) => ({ permission, title, app: 'volunteers' });

export const volunteersRoutes: RouteRecordRaw[] = [
  { path: '/volunteers', component: () => import('./views/DashboardView.vue'), meta: meta('لوحة التطوع') },
  { path: '/volunteers/list', component: () => import('./views/VolunteersView.vue'), meta: meta('سجل المتطوعين') },
  { path: '/volunteers/list/:id', component: () => import('./views/VolunteerView.vue'), props: true, meta: meta('ملف المتطوع') },
  { path: '/volunteers/events', component: () => import('./views/EventsView.vue'), meta: meta('الفعاليات') },
  { path: '/volunteers/events/new', component: () => import('./views/EventEditor.vue'), meta: meta('فعالية جديدة', P.events) },
  { path: '/volunteers/events/:id/edit', component: () => import('./views/EventEditor.vue'), props: true, meta: meta('تعديل الفعالية', P.events) },
  { path: '/volunteers/events/:id', component: () => import('./views/EventView.vue'), props: true, meta: meta('الفعالية') },
  { path: '/volunteers/approvals', component: () => import('./views/EventsView.vue'), props: { approvals: true }, meta: meta('اعتماد الفعاليات', P.approveEvents) },
  { path: '/volunteers/surveys', component: () => import('./views/SurveysView.vue'), meta: meta('استبانات الرضا') },
  { path: '/volunteers/certificates', component: () => import('./views/CertificatesView.vue'), meta: meta('الشهادات') },
  { path: '/volunteers/certificates/:id', component: () => import('./views/CertificateView.vue'), props: true, meta: meta('الشهادة') },
  { path: '/volunteers/contracts', component: () => import('./views/ContractsView.vue'), meta: meta('عقود التطوع') },
  { path: '/volunteers/contracts/:id', component: () => import('./views/ContractView.vue'), props: true, meta: meta('عقد التطوع') },
  { path: '/volunteers/tickets', component: () => import('./views/TicketsView.vue'), meta: meta('الشكاوى والمقترحات') },
  { path: '/volunteers/policy', component: () => import('./views/PolicyView.vue'), meta: meta('لائحة التطوع وميثاقه') },
  { path: '/volunteers/reports', component: () => import('../../components/reports/ReportsHub.vue'), props: { module: 'volunteers', system: 'التطوع' }, meta: meta('تقارير التطوع', P.reports) },
  { path: '/volunteers/settings', component: () => import('./views/SettingsView.vue'), meta: meta('إعدادات التطوع', P.settings) },
];

/** صفحات التطوع العامة بدون دخول: التسجيل والشكاوى، الاستبانة، توقيع العقد، التحقق من الشهادة */
export const volunteersPublicRoutes: RouteRecordRaw[] = [
  { path: '/v/verify', component: () => import('./public/VerifyView.vue'), meta: { open: true, title: 'التحقق من شهادة تطوع' } },
  { path: '/v/survey/:token', component: () => import('./public/SurveyView.vue'), meta: { open: true, title: 'استبانة رضا' } },
  { path: '/v/contract/:token', component: () => import('./public/ContractSignView.vue'), meta: { open: true, title: 'عقد التطوع' } },
  { path: '/v/:slug', component: () => import('./public/JoinView.vue'), meta: { open: true, title: 'التطوع' } },
];
