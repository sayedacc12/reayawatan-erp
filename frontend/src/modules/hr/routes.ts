import type { RouteRecordRaw } from 'vue-router';
import { P } from './lib';

const meta = (title: string, permission: string = P.read) => ({ permission, title, app: 'hr' });

const ess = (title: string) => ({ title, layoutKey: 'ess' });

export const hrRoutes: RouteRecordRaw[] = [
  // الخدمة الذاتية: متاحة لكل موظف مربوط حسابه بملفه، بلا صلاحية خاصة
  {
    path: '/me',
    component: () => import('./self/SelfLayout.vue'),
    children: [
      { path: '', component: () => import('./self/MyDashboard.vue'), meta: ess('لوحتي') },
      { path: 'new', component: () => import('./self/NewRequest.vue'), meta: ess('طلب جديد') },
      { path: 'new/:typeId', component: () => import('./self/NewRequest.vue'), props: true, meta: ess('طلب جديد') },
      { path: 'requests', component: () => import('./self/RequestsList.vue'), meta: ess('طلباتي') },
      { path: 'requests/:id', component: () => import('./self/RequestDetail.vue'), props: true, meta: ess('تفاصيل الطلب') },
      { path: 'requests/:id/letter', component: () => import('./self/LetterView.vue'), props: true, meta: ess('الخطاب') },
      { path: 'approvals', component: () => import('./self/ApprovalsView.vue'), meta: ess('بانتظار اعتمادي') },
      { path: 'manager', component: () => import('./self/ManagerDashboard.vue'), meta: ess('لوحة المدير') },
      { path: 'team', component: () => import('./self/TeamView.vue'), meta: ess('فريقي') },
      { path: 'team/:id', component: () => import('./self/MemberView.vue'), props: true, meta: ess('موظف من فريقي') },
    ],
  },
  // إخلاء الطرف ونهاية الخدمة: القائمة لشؤون الموظفين والمعتمدين، وصفحة الملف لمسؤولي البنود والموظف أيضًا (الخادم يتحقق)
  { path: '/hr/separations', component: () => import('./views/SeparationsView.vue'), meta: { title: 'إخلاء الطرف ونهاية الخدمة', app: 'hr', anyPermission: [P.separations, P.approveSeparations, P.payPayroll] } },
  { path: '/hr/separations/:id', component: () => import('./views/SeparationView.vue'), props: true, meta: { title: 'ملف إنهاء الخدمة', app: 'hr' } },
  { path: '/hr/separations/:id/print', component: () => import('./views/SeparationPrint.vue'), props: true, meta: { title: 'إخلاء الطرف وبيان المستحقات', app: 'hr' } },
  { path: '/hr/requests', component: () => import('./views/RequestsAdminView.vue'), meta: meta('طلبات الموظفين', P.requests) },
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
  { path: '/hr/reports', component: () => import('../../components/reports/ReportsHub.vue'), props: { module: 'hr', system: 'الموارد البشرية' }, meta: meta('تقارير الموارد البشرية', 'hr.reports.read') },
  { path: '/hr/settings', component: () => import('./views/SettingsView.vue'), meta: meta('إعدادات الموارد البشرية', P.settings) },
];
