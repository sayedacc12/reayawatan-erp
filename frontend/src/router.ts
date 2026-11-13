import { createRouter, createWebHistory } from 'vue-router';
import { moduleRoutes } from './modules';
import { useSession } from './stores/session';
import AppShell from './layouts/AppShell.vue';

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/login', component: () => import('./views/LoginView.vue'), meta: { public: true } },
    {
      path: '/',
      component: AppShell,
      children: [
        { path: '', component: () => import('./views/HomeView.vue'), meta: { title: 'التطبيقات' } },
        { path: 'account', component: () => import('./views/AccountView.vue'), meta: { title: 'حسابي' } },
        ...moduleRoutes,
        { path: 'forbidden', component: () => import('./views/ForbiddenView.vue'), meta: { title: 'غير مسموح' } },
      ],
    },
    { path: '/:pathMatch(.*)*', redirect: '/' },
  ],
});

router.beforeEach(async (to) => {
  const session = useSession();
  await session.restore();
  if (to.meta.public) return session.isLoggedIn ? '/' : true;
  if (!session.isLoggedIn) return { path: '/login', query: { next: to.fullPath } };
  if (!session.can(to.meta.permission as string | undefined)) return '/forbidden';
  return true;
});

router.afterEach((to) => {
  document.title = to.meta.title ? `${to.meta.title} · سنابل` : 'سنابل · منصة إدارة الجمعيات';
});
