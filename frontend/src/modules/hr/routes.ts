import type { RouteRecordRaw } from 'vue-router';
import { P } from './lib';

const meta = (title: string, permission: string = P.read) => ({ permission, title, app: 'hr' });

export const hrRoutes: RouteRecordRaw[] = [
  { path: '/hr', component: () => import('./views/DashboardView.vue'), meta: meta('لوحة الموارد البشرية') },
  { path: '/hr/employees', component: () => import('./views/EmployeesView.vue'), meta: meta('الموظفون') },
  { path: '/hr/employees/:id', component: () => import('./views/EmployeeView.vue'), props: true, meta: meta('ملف الموظف') },
  { path: '/hr/leaves', component: () => import('./views/LeavesView.vue'), meta: meta('الإجازات') },
  { path: '/hr/attendance', component: () => import('./views/AttendanceView.vue'), meta: meta('الحضور والانصراف') },
  { path: '/hr/payroll', component: () => import('./views/PayrollView.vue'), meta: meta('مسير الرواتب', P.salaries) },
  { path: '/hr/payroll/:id', component: () => import('./views/PayrollRunView.vue'), props: true, meta: meta('كشف الرواتب', P.salaries) },
  { path: '/hr/eos', component: () => import('./views/EosView.vue'), meta: meta('حاسبة نهاية الخدمة', P.salaries) },
  { path: '/hr/structure', component: () => import('./views/StructureView.vue'), meta: meta('الهيكل التنظيمي') },
  { path: '/hr/jobs', component: () => import('./views/JobsView.vue'), meta: meta('الأوصاف الوظيفية') },
  { path: '/hr/jobs/new', component: () => import('./views/JobEditor.vue'), meta: meta('وصف وظيفي جديد', P.jobs) },
  { path: '/hr/jobs/:id', component: () => import('./views/JobEditor.vue'), props: true, meta: meta('الوصف الوظيفي') },
  { path: '/hr/grades', component: () => import('./views/GradesView.vue'), meta: meta('سلم الرواتب') },
  { path: '/hr/competencies', component: () => import('./views/CompetenciesView.vue'), meta: meta('نماذج الجدارات') },
  { path: '/hr/plans', component: () => import('./views/PlansView.vue'), meta: meta('خطط التعيين') },
  { path: '/hr/performance', component: () => import('./views/PerformanceView.vue'), meta: meta('بطاقات الأداء والتقييم') },
  { path: '/hr/performance/:id', component: () => import('./views/CardView.vue'), props: true, meta: meta('بطاقة الأداء') },
  { path: '/hr/development', component: () => import('./views/DevelopmentView.vue'), meta: meta('التطوير والتدريب') },
  { path: '/hr/development/plans/:id', component: () => import('./views/DevPlanView.vue'), props: true, meta: meta('خطة التطوير') },
  { path: '/hr/policy', component: () => import('./views/PolicyView.vue'), meta: meta('لائحة الموارد البشرية') },
  { path: '/hr/settings', component: () => import('./views/SettingsView.vue'), meta: meta('إعدادات الموارد البشرية', P.settings) },
];
