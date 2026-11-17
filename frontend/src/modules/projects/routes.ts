import type { RouteRecordRaw } from 'vue-router';

const meta = (title: string, permission = 'projects.projects.read') => ({ permission, title, app: 'projects' });

export const projectsRoutes: RouteRecordRaw[] = [
  { path: '/projects', component: () => import('./views/DashboardView.vue'), meta: meta('لوحة المشاريع') },
  { path: '/projects/list', component: () => import('./views/ProjectsListView.vue'), meta: meta('إجمالي المشاريع') },
  {
    path: '/projects/approvals', component: () => import('./views/ApprovalsView.vue'),
    meta: { ...meta('وثائق المشاريع واعتمادها'), permission: undefined, anyPermission: ['projects.approval.process', 'projects.projects.manage'] },
  },
  { path: '/projects/support', component: () => import('./views/SupportView.vue'), meta: meta('إدارة الدعم', 'projects.support.manage') },
  {
    path: '/projects/disbursements', component: () => import('./views/DisbursementsView.vue'),
    meta: { ...meta('الصرف المالي'), permission: undefined, anyPermission: ['projects.disbursement.execute', 'projects.support.manage'] },
  },
  { path: '/projects/transfers', component: () => import('./views/TransfersView.vue'), meta: meta('المناقلات', 'projects.transfers.manage') },
  { path: '/projects/amendments', component: () => import('./views/AmendmentsView.vue'), meta: meta('تعديل فرص التبرع', 'projects.amendments.manage') },
  { path: '/projects/reports', component: () => import('../../components/reports/ReportsHub.vue'), props: { module: 'projects', system: 'إدارة المشاريع' }, meta: meta('تقارير المشاريع', 'projects.reports.read') },
  { path: '/projects/settings', component: () => import('./views/SettingsView.vue'), meta: meta('إعدادات المشاريع', 'projects.settings.manage') },
  { path: '/projects/:id/document', component: () => import('./views/DocumentView.vue'), meta: meta('وثيقة المشروع') },
  // آخر مسار: صفحة المشروع
  { path: '/projects/:id', component: () => import('./views/ProjectView.vue'), meta: meta('صفحة المشروع') },
];
