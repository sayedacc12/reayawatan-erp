import type { RouteRecordRaw } from 'vue-router';
import { P } from './lib';

const meta = (title: string, permission: string = P.read) => ({ permission, title, app: 'meetings' });

export const meetingsRoutes: RouteRecordRaw[] = [
  { path: '/meetings', component: () => import('./views/DashboardView.vue'), meta: meta('لوحة الاجتماعات') },
  { path: '/meetings/k/general_assembly', component: () => import('./views/ListView.vue'), props: { kind: 'general_assembly' }, meta: meta('اجتماعات الجمعية العمومية', P.ga) },
  { path: '/meetings/k/board', component: () => import('./views/ListView.vue'), props: { kind: 'board' }, meta: meta('اجتماعات مجلس الإدارة', P.board) },
  { path: '/meetings/k/committee', component: () => import('./views/ListView.vue'), props: { kind: 'committee' }, meta: meta('اجتماعات اللجان المتخصصة', P.committees) },
  { path: '/meetings/k/team', component: () => import('./views/ListView.vue'), props: { kind: 'team' }, meta: meta('اجتماعات فرق العمل', P.teams) },
  // تفاصيل الاجتماع لكل مدعو أو منظم (الخادم يتحقق من السرية والعضوية)
  { path: '/meetings/m/:id', component: () => import('./views/MeetingView.vue'), props: true, meta: { title: 'الاجتماع', app: 'meetings' } },
  { path: '/meetings/m/:id/print', component: () => import('./views/MinutesPrint.vue'), props: true, meta: { title: 'محضر الاجتماع', app: 'meetings' } },
  { path: '/meetings/decisions', component: () => import('./views/DecisionsView.vue'), meta: meta('سجل القرارات والتوصيات') },
  { path: '/meetings/bodies', component: () => import('./views/BodiesView.vue'), meta: meta('المجالس واللجان وأعضاؤها') },
  { path: '/meetings/reports', component: () => import('../../components/reports/ReportsHub.vue'),
    props: { module: 'meetings', system: 'الاجتماعات واللجان', intro: 'تقارير الاجتماعات والحضور والتوصيات وتنفيذها، وتعرض ما يحق لك الاطلاع عليه فقط.' },
    meta: meta('تقارير الاجتماعات', P.reports) },
  { path: '/meetings/settings', component: () => import('./views/SettingsView.vue'), meta: meta('إعدادات الاجتماعات', P.settings) },
];
