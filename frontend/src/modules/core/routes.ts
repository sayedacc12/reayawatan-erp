import type { RouteRecordRaw } from 'vue-router';

export const coreRoutes: RouteRecordRaw[] = [
  {
    path: '/settings/users',
    component: () => import('./views/UsersView.vue'),
    meta: { permission: 'core.users.read', title: 'المستخدمون', app: 'core' },
  },
  {
    path: '/settings/roles',
    component: () => import('./views/RolesView.vue'),
    meta: { permission: 'core.roles.read', title: 'الأدوار والصلاحيات', app: 'core' },
  },
  {
    path: '/settings/support',
    component: () => import('../../support/SupportView.vue'),
    meta: { permission: 'core.support.manage', title: 'الدعم الفني والصيانة', app: 'core' },
  },
  {
    path: '/settings/support/:id',
    component: () => import('../../support/SupportTicketView.vue'),
    meta: { permission: 'core.support.manage', title: 'طلب صيانة', app: 'core' },
  },
];
