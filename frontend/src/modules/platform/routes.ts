import type { RouteRecordRaw } from 'vue-router';

export const platformRoutes: RouteRecordRaw[] = [
  {
    path: '/platform/organizations',
    component: () => import('./views/OrganizationsView.vue'),
    meta: { permission: 'platform.organizations.manage', title: 'الجمعيات' },
  },
];
