import { createRouter, createWebHistory } from 'vue-router';
import { moduleRoutes } from './modules';
import { loginPath, useSession } from './stores/session';
import AppShell from './layouts/AppShell.vue';
import { usePortal } from './portal/portal';
import { volunteersPublicRoutes } from './modules/volunteers/routes';
import { membersPublicRoutes } from './modules/members/routes';

export const router = createRouter({
  history: createWebHistory(),
  scrollBehavior: (to, from, saved) => saved ?? (to.path !== from.path ? { top: 0 } : undefined),
  routes: [
    { path: '/login', component: () => import('./views/LoginView.vue'), meta: { public: true } },
    // صفحة دخول موظفي كل جمعية
    { path: '/o/:slug', component: () => import('./views/LoginView.vue'), meta: { public: true } },
    // صفحات الجمعيات العامة: طلب الاشتراك، ومتابعته، ومراجعة العقد الإلكتروني وتوقيعه
    { path: '/register', component: () => import('./registration/RegisterView.vue'), meta: { open: true, title: 'تسجيل جمعية' } },
    { path: '/register/:token', component: () => import('./registration/RegisterTrackView.vue'), meta: { open: true, title: 'متابعة طلب الاشتراك' } },
    { path: '/contract/:token', component: () => import('./registration/ContractSignView.vue'), meta: { open: true, title: 'عقد الاشتراك' } },
    { path: '/pc/:token', component: () => import('./registration/PartnerContractSignView.vue'), meta: { open: true, title: 'اتفاقية شراكة' } },
    // صفحات التطوع العامة: تسجيل المتطوعين والشكاوى، استبانة الرضا، توقيع عقد التطوع، التحقق من الشهادة
    ...volunteersPublicRoutes,
    // استبانة قياس الرضا العامة (نظام الجودة)
    { path: '/minutes/sign/:token', component: () => import('./modules/meetings/public/MinutesSignView.vue'), meta: { open: true, title: 'توقيع محضر' } },
    { path: '/minutes/verify/:code', component: () => import('./modules/meetings/public/MinutesVerifyView.vue'), meta: { open: true, title: 'التحقق من محضر' } },
    { path: '/survey/:token', component: () => import('./views/PublicSurveyView.vue'), meta: { open: true, title: 'استبانة رضا' } },
    // صفحات عضوية الجمعية العمومية العامة: التقديم والسداد والتحقق من البطاقة
    ...membersPublicRoutes,
    // الموقع الإلكتروني العام لكل جمعية بهويتها، مع المتجر والإيصالات
    {
      path: '/w/:slug',
      component: () => import('./site/SiteShell.vue'),
      meta: { open: true },
      children: [
        { path: '', component: () => import('./site/pages/SiteHome.vue'), meta: { open: true } },
        { path: 'about', component: () => import('./site/pages/SiteAbout.vue'), meta: { open: true, title: 'من نحن' } },
        { path: 'programs', component: () => import('./site/pages/SitePrograms.vue'), meta: { open: true, title: 'برامجنا' } },
        { path: 'programs/:pslug', component: () => import('./site/pages/SiteProgram.vue'), meta: { open: true, title: 'برنامج' } },
        { path: 'news', component: () => import('./site/pages/SiteNews.vue'), meta: { open: true, title: 'الأخبار' } },
        { path: 'news/:id', component: () => import('./site/pages/SiteNewsItem.vue'), meta: { open: true, title: 'خبر' } },
        { path: 'governance', component: () => import('./site/pages/SiteGovernance.vue'), meta: { open: true, title: 'الحوكمة والشفافية' } },
        { path: 'partners', component: () => import('./site/pages/SitePartners.vue'), meta: { open: true, title: 'شركاؤنا' } },
        { path: 'contact', component: () => import('./site/pages/SiteContact.vue'), meta: { open: true, title: 'تواصل معنا' } },
        { path: 'donate', component: () => import('./site/pages/SiteDonate.vue'), meta: { open: true, title: 'تبرع الآن' } },
        { path: 'pay/:token', component: () => import('./site/pages/SitePay.vue'), meta: { open: true, title: 'إتمام الدفع' } },
        { path: 'receipt/:token', component: () => import('./site/pages/SiteReceipt.vue'), meta: { open: true, title: 'إيصال التبرع' } },
        { path: 'verify', component: () => import('./site/pages/SiteVerify.vue'), meta: { open: true, title: 'التحقق من إيصال' } },
        { path: 'search', component: () => import('./site/pages/SiteSearch.vue'), meta: { open: true, title: 'البحث' } },
        { path: 'documents/:id', component: () => import('./site/pages/SiteDocument.vue'), meta: { open: true, title: 'وثيقة' } },
      ],
    },
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
        // كل مستخدم في جمعية يبدأ من لوحته /me والأنظمة المصرح بها في جانبها؛ شاشة التطبيقات لمدير المنصة فقط
        { path: '', alias: '/home', component: () => import('./views/HomeView.vue'), meta: { title: 'التطبيقات' }, beforeEnter: homeOrDashboard },
        // خطوات إطلاق الجمعية لمدير نظامها
        { path: 'launch', component: () => import('./onboarding/LaunchView.vue'), meta: { title: 'خطوات الإطلاق' } },
        { path: 'account', component: () => import('./views/AccountView.vue'), meta: { title: 'حسابي' } },
        ...moduleRoutes,
        { path: 'forbidden', component: () => import('./views/ForbiddenView.vue'), meta: { title: 'غير مسموح' } },
      ],
    },
    { path: '/:pathMatch(.*)*', redirect: '/' },
  ],
});

async function homeOrDashboard() {
  const session = useSession();
  await session.restore();
  // مستخدمو الجمعيات كلهم (مربوطين بملف موظف أو لا، ومنهم مدير نظام جمعية جديدة) يبدأون من لوحتهم
  return session.user?.organizationId ? '/me' : true;
}

router.beforeEach(async (to) => {
  if (to.meta.open) return true;
  if (to.meta.portal) {
    const portal = usePortal(to.params.slug as string);
    if (to.meta.portalAuth && !portal.token) return `/portal/${to.params.slug}`;
    return true;
  }
  const session = useSession();
  await session.restore();
  if (to.meta.public) return session.isLoggedIn ? '/' : true;
  // الزائر غير المسجل على الجذر يرى الصفحة التعريفية (يقدّمها الخادم على / مباشرة)
  if (!session.isLoggedIn && (to.path === '/' || to.path === '/home') && import.meta.env.PROD) {
    window.location.replace('/');
    return false;
  }
  if (!session.isLoggedIn) return { path: loginPath(), query: { next: to.fullPath } };
  if (!session.can(to.meta.permission as string | undefined)) return '/forbidden';
  const anyOf = to.meta.anyPermission as string[] | undefined;
  if (anyOf?.length && !anyOf.some((p) => session.can(p))) return '/forbidden';
  // الشاشات غير المسموحة للجمعية لا تُفتح حتى بالرابط المباشر
  if (session.screenHidden(to.path)) return '/forbidden';
  return true;
});

router.afterEach((to) => {
  // الموقع العام يضبط عنوانه باسم الجمعية
  if (to.path.startsWith('/w/')) return;
  document.title = to.meta.title ? `${to.meta.title} · سنابل` : 'سنابل · منصة إدارة الجمعيات';
});
