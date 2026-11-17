import { defineAsyncComponent } from 'vue';
import type { RouteRecordRaw } from 'vue-router';
import { P } from './lib';

const meta = (title: string, permission: string = P.read) => ({ permission, title, app: 'quality' });

export const qualityRoutes: RouteRecordRaw[] = [
  { path: '/quality', component: () => import('./views/DashboardView.vue'), meta: meta('لوحة الجودة') },
  { path: '/quality/context', component: () => import('./views/ContextView.vue'), meta: meta('سياق الجمعية وسياسة الجودة') },
  { path: '/quality/risks', component: () => import('./views/RisksView.vue'), meta: meta('المخاطر والفرص') },
  { path: '/quality/objectives', component: () => import('./views/ObjectivesView.vue'), meta: meta('أهداف الجودة ومؤشراتها') },
  { path: '/quality/documents', component: () => import('./views/DocumentsView.vue'), meta: meta('سجل الوثائق المضبوطة') },
  { path: '/quality/procedures', component: () => import('./views/DocumentsView.vue'), props: { procedures: true }, meta: meta('سجل الإجراءات') },
  { path: '/quality/documents/:id', component: () => import('./views/DocumentView.vue'), props: true, meta: meta('الوثيقة') },
  { path: '/quality/maps', component: () => import('./views/MapsView.vue'), meta: meta('خرائط الإجراءات') },
  { path: '/quality/maps/:id', component: () => import('./views/MapView.vue'), props: true, meta: meta('خريطة الإجراء') },
  { path: '/quality/audits', component: () => import('./views/AuditsView.vue'), meta: meta('المراجعة الداخلية') },
  { path: '/quality/audits/:id', component: () => import('./views/AuditView.vue'), props: true, meta: meta('المراجعة الداخلية') },
  { path: '/quality/ncr', component: () => import('./views/NcrsView.vue'), meta: meta('عدم المطابقة والإجراءات التصحيحية') },
  { path: '/quality/ncr/:id', component: () => import('./views/NcrView.vue'), props: true, meta: meta('حالة عدم مطابقة') },
  { path: '/quality/reviews', component: () => import('./views/ReviewsView.vue'), meta: meta('مراجعة الإدارة') },
  { path: '/quality/reviews/:id', component: () => import('./views/ReviewView.vue'), props: true, meta: meta('محضر مراجعة الإدارة') },
  { path: '/quality/complaints', component: () => import('./views/ComplaintsView.vue'), meta: meta('الشكاوى') },
  { path: '/quality/surveys', component: () => import('./views/SurveysView.vue'), meta: meta('قياس الرضا') },
  { path: '/quality/surveys/:id', component: () => import('./views/SurveyView.vue'), props: true, meta: meta('نتائج الاستبانة') },
  { path: '/quality/standard', component: () => import('./views/StandardView.vue'), meta: meta('متطلبات المواصفة') },
  { path: '/quality/reports', component: () => import('../../components/reports/ReportsHub.vue'),
    props: { module: 'quality', system: 'إدارة الجودة', overview: defineAsyncComponent(() => import('./views/ReportsView.vue')), overviewLabel: 'التقرير الدوري للجودة' },
    meta: meta('تقارير الجودة', P.reports) },
  { path: '/quality/settings', component: () => import('./views/SettingsView.vue'), meta: meta('إعدادات الجودة', P.settings) },
];
