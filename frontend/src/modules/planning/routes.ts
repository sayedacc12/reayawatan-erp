import type { RouteRecordRaw } from 'vue-router';
import { P } from './lib';

const meta = (title: string, permission: string = P.read) => ({ permission, title, app: 'planning' });

export const planningRoutes: RouteRecordRaw[] = [
  { path: '/planning', component: () => import('./views/DashboardView.vue'), meta: meta('لوحة التخطيط') },
  { path: '/planning/approvals', component: () => import('./views/ApprovalsView.vue'), meta: meta('بانتظار اعتمادي') },
  { path: '/planning/strategic', component: () => import('./views/PlansView.vue'), props: { kind: 'strategic' }, meta: meta('الخطط الاستراتيجية') },
  { path: '/planning/operational', component: () => import('./views/PlansView.vue'), props: { kind: 'operational' }, meta: meta('الخطط التشغيلية') },
  { path: '/planning/plans/:id', component: () => import('./views/PlanView.vue'), props: true, meta: meta('الخطة') },
  { path: '/planning/kpis', component: () => import('./views/KpisView.vue'), meta: meta('مؤشرات الأداء') },
  { path: '/planning/execution', component: () => import('./views/ExecutionView.vue'), meta: meta('متابعة التنفيذ') },
  { path: '/planning/budgets', component: () => import('./views/BudgetsView.vue'), meta: meta('الموازنات التقديرية') },
  { path: '/planning/budgets/:id', component: () => import('./views/BudgetView.vue'), props: true, meta: meta('الموازنة التقديرية') },
  { path: '/planning/formulas', component: () => import('./views/FormulasView.vue'), meta: meta('المعادلات والافتراضات') },
  { path: '/planning/board-reports', component: () => import('./views/BoardReportsView.vue'), meta: { ...meta('تقارير المجلس'), permission: undefined, anyPermission: [P.reports, P.budgets] } },
  { path: '/planning/reports', component: () => import('../../components/reports/ReportsHub.vue'),
    props: { module: 'planning', system: 'التخطيط والموازنات' }, meta: meta('تقارير التخطيط', P.reports) },
  { path: '/planning/settings', component: () => import('./views/SettingsView.vue'), meta: meta('إعدادات التخطيط', P.settings) },
];
