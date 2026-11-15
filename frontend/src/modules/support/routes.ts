import type { RouteRecordRaw } from 'vue-router';

const WORK = 'support.work';
const MANAGE = 'support.manage';
const REPORTS = 'support.reports';

/** تطبيق الدعم الفني لفريق المنصة (الشاشات في src/support) */
export const supportRoutes: RouteRecordRaw[] = [
  { path: '/support-desk', component: () => import('../../support/DeskDashboardView.vue'), meta: { permission: WORK, title: 'لوحة الدعم' } },
  { path: '/support-desk/tickets', component: () => import('../../support/PlatformSupportView.vue'), meta: { permission: WORK, title: 'طلبات الصيانة' } },
  { path: '/support-desk/tickets/:id', component: () => import('../../support/PlatformTicketView.vue'), meta: { permission: WORK, title: 'طلب صيانة' } },
  { path: '/support-desk/tasks', component: () => import('../../support/TasksView.vue'), meta: { permission: WORK, title: 'المهام والتكليفات' } },
  { path: '/support-desk/tasks/:id', component: () => import('../../support/TaskView.vue'), meta: { permission: WORK, title: 'مهمة' } },
  { path: '/support-desk/team', component: () => import('../../support/TeamView.vue'), meta: { permission: MANAGE, title: 'فريق الدعم' } },
  { path: '/support-desk/performance', component: () => import('../../support/PerformanceView.vue'), meta: { permission: REPORTS, title: 'تقييم الأداء' } },
  { path: '/support-desk/sla', component: () => import('../../support/SlaSettingsView.vue'), meta: { permission: MANAGE, title: 'مستويات الخدمة' } },
  { path: '/support-desk/reports', component: () => import('../../support/SupportReportView.vue'), meta: { permission: REPORTS, title: 'تقارير الدعم الفني' } },
  // الروابط القديمة داخل إدارة المنصة
  { path: '/platform/support', redirect: '/support-desk/tickets' },
  { path: '/platform/support/:id', redirect: (to) => `/support-desk/tickets/${to.params.id}` },
  { path: '/platform/sla', redirect: '/support-desk/sla' },
];
