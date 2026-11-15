import { createRouter, createWebHistory } from 'vue-router';
import { moduleRoutes } from './modules';
import { useSession } from './stores/session';
import AppShell from './layouts/AppShell.vue';
import { usePortal } from './portal/portal';

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/login', component: () => import('./views/LoginView.vue'), meta: { public: true } },
    // بوابة المستفيدين: مستقلة عن دخول الموظفين
    {
      path: '/portal/:slug',
      component: () => import('./portal/PortalShell.vue'),
      meta: { portal: true },
      children: [
        { path: '', component: () => import('./portal/PortalAuthView.vue'), meta: { portal: true, title: 'بوابة المستفيدين' } },
        { path: 'home', component: () => import('./portal/PortalHomeView.vue'), meta: { portal: true, portalAuth: true, title: 'طلباتي' } },
        { path: 'apply', component: () => import('./portal/PortalApplyView.vue'), meta: { portal: true, portalAuth: true, title: 'تقديم طلب' } },
        { path: 'requests/:id', component: () => import('./portal/PortalRequestView.vue'), meta: { portal: true, portalAuth: true, title: 'متابعة الطلب' } },
        { path: 'messages', component: () => import('./portal/PortalMessagesView.vue'), meta: { portal: true, portalAuth: true, title: 'شكاوى واستفسارات' } },
        { path: 'profile', component: () => import('./portal/PortalProfileView.vue'), meta: { portal: true, portalAuth: true, title: 'بياناتي' } },
      ],
    },
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
  if (to.meta.portal) {
    const portal = usePortal(to.params.slug as string);
    if (to.meta.portalAuth && !portal.token) return `/portal/${to.params.slug}`;
    return true;
  }
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
