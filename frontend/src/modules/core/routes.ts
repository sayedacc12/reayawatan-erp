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
];
