import type { RouteRecordRaw } from 'vue-router';
import { P } from './lib';

const meta = (title: string, permission: string = P.read) => ({ permission, title, app: 'members' });

export const membersRoutes: RouteRecordRaw[] = [
  { path: '/members', component: () => import('./views/DashboardView.vue'), meta: meta('لوحة العضوية') },
  { path: '/members/applications', component: () => import('./views/ApplicationsView.vue'), meta: meta('طلبات العضوية') },
  { path: '/members/approvals', component: () => import('./views/ApplicationsView.vue'), props: { approvals: true }, meta: meta('اعتماد طلبات العضوية', P.approve) },
  { path: '/members/applications/:id', component: () => import('./views/ApplicationView.vue'), props: true, meta: meta('طلب العضوية') },
  { path: '/members/list', component: () => import('./views/MembersView.vue'), meta: meta('سجل الأعضاء') },
  { path: '/members/list/:id', component: () => import('./views/MemberView.vue'), props: true, meta: meta('ملف العضو') },
  { path: '/members/renewals', component: () => import('./views/RenewalsView.vue'), meta: meta('التجديد والتنبيهات') },
  { path: '/members/assembly', component: () => import('./views/AssemblyView.vue'), meta: meta('الجمعية العمومية') },
  { path: '/members/invoices', component: () => import('./views/InvoicesView.vue'), meta: meta('المطالبات والمدفوعات') },
  { path: '/members/invoices/:id', component: () => import('./views/InvoiceView.vue'), props: true, meta: meta('المطالبة') },
  { path: '/members/reports', component: () => import('./views/ReportsView.vue'), meta: meta('تقارير العضوية', P.reports) },
  { path: '/members/settings', component: () => import('./views/SettingsView.vue'), meta: meta('إعدادات العضوية', P.settings) },
];

/** صفحات العضوية العامة بدون دخول: الشروط والتقديم والمتابعة وعضويتي، رابط السداد، والتحقق من البطاقة */
export const membersPublicRoutes: RouteRecordRaw[] = [
  { path: '/m/verify', component: () => import('./public/VerifyView.vue'), meta: { open: true, title: 'التحقق من بطاقة عضوية' } },
  { path: '/m/pay/:token', component: () => import('./public/PayView.vue'), meta: { open: true, title: 'سداد اشتراك العضوية' } },
  { path: '/m/:slug', component: () => import('./public/MemberPortalView.vue'), meta: { open: true, title: 'العضوية' } },
];
