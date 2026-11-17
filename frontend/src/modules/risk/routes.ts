import { defineAsyncComponent } from 'vue';
import type { RouteRecordRaw } from 'vue-router';
import { P } from './lib';

const meta = (title: string, permission: string = P.read) => ({ permission, title, app: 'risk' });

export const riskRoutes: RouteRecordRaw[] = [
  { path: '/risk', component: () => import('./views/DashboardView.vue'), meta: meta('لوحة المخاطر') },
  { path: '/risk/approvals', component: () => import('./views/ApprovalsView.vue'), meta: meta('بانتظار اعتمادي') },
  { path: '/risk/register', component: () => import('./views/RegisterView.vue'), meta: meta('سجل المخاطر') },
  { path: '/risk/register/new', component: () => import('./views/RiskView.vue'), meta: meta('خطر جديد', P.register) },
  { path: '/risk/register/:id', component: () => import('./views/RiskView.vue'), props: true, meta: meta('بطاقة الخطر') },
  { path: '/risk/analysis', component: () => import('./views/AnalysesView.vue'), meta: meta('تحليل PESTEL وSWOT') },
  { path: '/risk/analysis/new', component: () => import('./views/AnalysisView.vue'), meta: meta('تحليل جديد', P.analysis) },
  { path: '/risk/analysis/:id', component: () => import('./views/AnalysisView.vue'), props: true, meta: meta('التحليل') },
  { path: '/risk/controls', component: () => import('./views/ControlsView.vue'), meta: meta('الضوابط الرقابية') },
  { path: '/risk/continuity', component: () => import('./views/ContinuityView.vue'), meta: meta('استمرارية الأعمال') },
  { path: '/risk/continuity/new', component: () => import('./views/BiaView.vue'), meta: meta('تحليل أثر توقف نشاط', P.continuity) },
  { path: '/risk/continuity/:id', component: () => import('./views/BiaView.vue'), props: true, meta: meta('تحليل الأثر وخطة التعافي') },
  { path: '/risk/crisis', component: () => import('./views/ContinuityView.vue'), meta: meta('فرق الأزمات والطوارئ') },
  { path: '/risk/crisis/new', component: () => import('./views/CrisisTeamView.vue'), meta: meta('تشكيل فريق أزمة', P.continuity) },
  { path: '/risk/crisis/event/:id', component: () => import('./views/CrisisEventView.vue'), props: true, meta: meta('غرفة الأزمة') },
  { path: '/risk/crisis/:id', component: () => import('./views/CrisisTeamView.vue'), props: true, meta: meta('فريق الأزمة') },
  { path: '/risk/changes', component: () => import('./views/ChangesView.vue'), meta: meta('سجل التغيير') },
  { path: '/risk/changes/new', component: () => import('./views/ChangeView.vue'), meta: meta('طلب تغيير جديد', P.change) },
  { path: '/risk/changes/:id', component: () => import('./views/ChangeView.vue'), props: true, meta: meta('طلب التغيير') },
  { path: '/risk/tasks', component: () => import('./views/TasksView.vue'), meta: meta('مهام المتابعة') },
  { path: '/risk/procedures', component: () => import('./views/ProceduresView.vue'), meta: meta('هندسة الإجراءات') },
  { path: '/risk/procedures/new', component: () => import('./views/ProcedureView.vue'), meta: meta('إجراء جديد', P.procedures) },
  { path: '/risk/procedures/:id', component: () => import('./views/ProcedureView.vue'), props: true, meta: meta('الإجراء') },
  { path: '/risk/compliance', component: () => import('./views/ComplianceView.vue'), meta: meta('سجل الالتزام') },
  { path: '/risk/policy', component: () => import('./views/PolicyView.vue'), meta: meta('سياسة المخاطر') },
  { path: '/risk/methodologies', component: () => import('./views/MethodologiesView.vue'), meta: meta('سجل المنهجيات المعتمدة') },
  { path: '/risk/guide', component: () => import('./views/GuideView.vue'), meta: meta('دليل المصطلحات والمخاطر') },
  { path: '/risk/reports', component: () => import('../../components/reports/ReportsHub.vue'),
    props: { module: 'risk', system: 'المخاطر والالتزام والتغيير', overview: defineAsyncComponent(() => import('./views/ReportsView.vue')), overviewLabel: 'لوحة المخاطر' },
    meta: meta('تقارير المخاطر', P.reports) },
  { path: '/risk/settings', component: () => import('./views/SettingsView.vue'), meta: meta('إعدادات المخاطر', P.settings) },
];
