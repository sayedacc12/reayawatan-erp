import { createRouter, createWebHistory } from 'vue-router';
import { moduleRoutes } from './modules';
import { loginPath, useSession } from './stores/session';
import AppShell from './layouts/AppShell.vue';
import { useSupplierPortal } from './supplier/supplier';
import { volunteersPublicRoutes } from './modules/volunteers/routes';
import { membersPublicRoutes } from './modules/members/routes';

export const router = createRouter({
  history: createWebHistory(),
  scrollBehavior: (to, from, saved) => saved ?? (to.path !== from.path ? { top: 0 } : undefined),
  routes: [
    { path: '/login', component: () => import('./views/LoginView.vue'), meta: { public: true } },
    // من دخل بكلمة مرور مؤقتة يختار كلمة جديدة قبل أي شاشة أخرى
    { path: '/change-password', component: () => import('./views/ForceChangeView.vue'), meta: { title: 'كلمة مرور جديدة' } },
    // رابط الدخول القديم بمعرّف المنشأة يقود لشاشة الدخول نفسها (نظام شركة واحدة)
    { path: '/o/:slug', redirect: '/login' },
    { path: '/pc/:token', component: () => import('./registration/PartnerContractSignView.vue'), meta: { open: true, title: 'اتفاقية شراكة' } },
    // صفحات التطوع العامة: تسجيل المتطوعين والشكاوى، استبانة الرضا، توقيع عقد التطوع، التحقق من الشهادة
    ...volunteersPublicRoutes,
    // استبانة قياس الرضا العامة (نظام الجودة)
    { path: '/minutes/sign/:token', component: () => import('./modules/meetings/public/MinutesSignView.vue'), meta: { open: true, title: 'توقيع محضر' } },
    { path: '/minutes/verify/:code', component: () => import('./modules/meetings/public/MinutesVerifyView.vue'), meta: { open: true, title: 'التحقق من محضر' } },
    { path: '/survey/:token', component: () => import('./views/PublicSurveyView.vue'), meta: { open: true, title: 'استبانة رضا' } },
    // صفحات عضوية الجمعية العمومية العامة: التقديم والسداد والتحقق من البطاقة
    ...membersPublicRoutes,
    // موقع رعاية وطن العام: محتواه ونماذجه تُدار من لوحة التحكم (وحدة الموقع والعملاء المحتملون)
    {
      path: '/',
      component: () => import('./web/WebShell.vue'),
      meta: { open: true },
      children: [
        { path: '', component: () => import('./web/pages/Home.vue'), meta: { open: true, web: true } },
        { path: 'about', component: () => import('./web/pages/About.vue'), meta: { open: true, web: true } },
        { path: 'services', component: () => import('./web/pages/Services.vue'), meta: { open: true, web: true } },
        { path: 'services/:slug', component: () => import('./web/pages/Service.vue'), meta: { open: true, web: true } },
        { path: 'assess', component: () => import('./web/pages/Assess.vue'), meta: { open: true, web: true } },
        { path: 'contact', component: () => import('./web/pages/Contact.vue'), meta: { open: true, web: true } },
        { path: 'book', component: () => import('./web/pages/Book.vue'), meta: { open: true, web: true } },
        { path: 'book/manage/:token', component: () => import('./web/pages/BookManage.vue'), meta: { open: true, web: true } },
        { path: 'guides', component: () => import('./web/pages/Guides.vue'), meta: { open: true, web: true } },
      ],
    },
    // بوابة الموردين: مستقلة عن دخول الموظفين وعن بوابة المستفيدين
    {
      path: '/supplier/:slug',
      component: () => import('./supplier/SupplierShell.vue'),
      meta: { supplier: true },
      children: [
        { path: '', component: () => import('./supplier/SupplierAuthView.vue'), meta: { supplier: true, title: 'بوابة الموردين' } },
        { path: 'home', component: () => import('./supplier/SupplierHomeView.vue'), meta: { supplier: true, supplierAuth: true, title: 'حالة الطلب' } },
        { path: 'profile', component: () => import('./supplier/SupplierProfileView.vue'), meta: { supplier: true, supplierAuth: true, title: 'بيانات المنشأة' } },
        { path: 'docs', component: () => import('./supplier/SupplierDocsView.vue'), meta: { supplier: true, supplierAuth: true, title: 'المستندات' } },
        { path: 'banks', component: () => import('./supplier/SupplierBanksView.vue'), meta: { supplier: true, supplierAuth: true, title: 'الحساب البنكي' } },
        { path: 'users', component: () => import('./supplier/SupplierUsersView.vue'), meta: { supplier: true, supplierAuth: true, title: 'المستخدمون' } },
        { path: 'rfqs', component: () => import('./supplier/SupplierRfqsView.vue'), meta: { supplier: true, supplierAuth: true, title: 'المنافسات' } },
        { path: 'rfqs/:id', component: () => import('./supplier/SupplierRfqView.vue'), meta: { supplier: true, supplierAuth: true, title: 'المنافسة' } },
        { path: 'orders', component: () => import('./supplier/SupplierOrdersView.vue'), meta: { supplier: true, supplierAuth: true, title: 'التعميدات' } },
        { path: 'orders/:id', component: () => import('./supplier/SupplierOrderView.vue'), meta: { supplier: true, supplierAuth: true, title: 'التعميد' } },
        { path: 'invoices', component: () => import('./supplier/SupplierInvoicesView.vue'), meta: { supplier: true, supplierAuth: true, title: 'الفواتير' } },
        { path: 'invoices/new', component: () => import('./supplier/SupplierInvoiceView.vue'), meta: { supplier: true, supplierAuth: true, title: 'رفع فاتورة' } },
        { path: 'invoices/:id', component: () => import('./supplier/SupplierInvoiceView.vue'), meta: { supplier: true, supplierAuth: true, title: 'الفاتورة' } },
        { path: 'contracts', component: () => import('./supplier/SupplierContractsView.vue'), meta: { supplier: true, supplierAuth: true, title: 'العقود' } },
        { path: 'contracts/:id', component: () => import('./supplier/SupplierContractView.vue'), meta: { supplier: true, supplierAuth: true, title: 'العقد' } },
        { path: 'evaluations', component: () => import('./supplier/SupplierEvaluationsView.vue'), meta: { supplier: true, supplierAuth: true, title: 'تقييم الأداء' } },
        { path: 'statement', component: () => import('./supplier/SupplierStatementView.vue'), meta: { supplier: true, supplierAuth: true, title: 'كشف الحساب' } },
      ],
    },
    {
      path: '/',
      component: AppShell,
      children: [
        // الموظف يبدأ من لوحته /me والأنظمة المصرح بها في جانبها؛ شاشة التطبيقات لمدير المنصة فقط
        { path: 'home', component: () => import('./views/HomeView.vue'), meta: { title: 'التطبيقات' }, beforeEnter: homeOrDashboard },
        // خطوات إطلاق الشركة لمدير نظامها
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
  if (to.meta.supplier) {
    const sp = useSupplierPortal(to.params.slug as string);
    if (to.meta.supplierAuth && !sp.token) return `/supplier/${to.params.slug}`;
    return true;
  }
  const session = useSession();
  await session.restore();
  if (to.meta.public) return session.isLoggedIn ? '/home' : true;
  if (!session.isLoggedIn) return { path: loginPath(), query: { next: to.fullPath } };
  if (session.user?.mustChangePassword) return to.path === '/change-password' ? true : '/change-password';
  if (to.path === '/change-password') return '/home';
  if (!session.can(to.meta.permission as string | undefined)) return '/forbidden';
  const anyOf = to.meta.anyPermission as string[] | undefined;
  if (anyOf?.length && !anyOf.some((p) => session.can(p))) return '/forbidden';
  // الشاشات غير المسموحة للشركة لا تُفتح حتى بالرابط المباشر
  if (session.screenHidden(to.path)) return '/forbidden';
  return true;
});

router.afterEach((to) => {
  // صفحات الموقع العام تضبط عناوينها بنفسها
  if (to.meta.web) return;
  document.title = to.meta.title ? `${to.meta.title} · رعاية وطن` : 'رعاية وطن · National Care';
});
