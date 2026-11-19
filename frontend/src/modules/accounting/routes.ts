import type { RouteRecordRaw } from 'vue-router';
import { P } from './lib';

const meta = (title: string, permission: string = P.read, anyPermission?: string[]) =>
  ({ permission: anyPermission ? undefined : permission, anyPermission, title, app: 'accounting' });

/** أي صلاحية من صلاحيات الأصول تكفي للاطلاع */
const ASSET_READ = [P.assetsRead, P.assetsManage, P.assetsOperate, P.assetsDepreciate, P.assetsCustody];

export const accountingRoutes: RouteRecordRaw[] = [
  { path: '/accounting', component: () => import('./views/DashboardView.vue'), meta: meta('لوحة النظام المالي') },
  { path: '/accounting/receipts', component: () => import('./views/VouchersView.vue'), props: { kind: 'receipt' }, meta: meta('سندات القبض') },
  { path: '/accounting/payments', component: () => import('./views/VouchersView.vue'), props: { kind: 'payment' }, meta: meta('سندات الصرف') },
  { path: '/accounting/vouchers/:id', component: () => import('./views/VoucherView.vue'), props: true, meta: meta('السند') },
  { path: '/accounting/entries', component: () => import('./views/EntriesView.vue'), meta: meta('قيود اليومية') },
  { path: '/accounting/documents/:code', component: () => import('./views/EntriesView.vue'), props: (r) => ({ fixedType: String(r.params.code) }), meta: meta('سندات الجمعية') },
  { path: '/accounting/adjustments', component: () => import('./views/EntriesView.vue'), props: { fixedType: 'adjustment' }, meta: meta('قيود التسوية') },
  { path: '/accounting/entries/new', component: () => import('./views/EntryEditor.vue'), meta: meta('قيد جديد', P.entries) },
  { path: '/accounting/entries/:id', component: () => import('./views/EntryEditor.vue'), props: true, meta: meta('القيد') },
  { path: '/accounting/posting', component: () => import('./views/PostingView.vue'), meta: meta('ترحيل القيود', P.post) },
  { path: '/accounting/periods', component: () => import('./views/PeriodsView.vue'), meta: meta('إغلاق الفترات', P.closePeriods, [P.closePeriods, P.reopenPeriods]) },
  { path: '/accounting/accounts', component: () => import('./views/AccountsView.vue'), meta: meta('الدليل المحاسبي') },
  { path: '/accounting/analytic', component: () => import('./views/AnalyticView.vue'), meta: meta('الحسابات التحليلية') },
  { path: '/accounting/partners', component: () => import('./views/PartnersView.vue'), meta: meta('العملاء والموردون') },
  { path: '/accounting/banks', component: () => import('./views/BanksView.vue'), meta: meta('البنوك والنقدية') },
  { path: '/accounting/warehouses', component: () => import('./views/WarehousesView.vue'), meta: meta('المستودعات') },
  { path: '/accounting/setup', component: () => import('./views/SetupView.vue'), meta: meta('الافتتاحيات والسنوات المالية', P.setup, [P.setup, P.closePeriods, P.reopenPeriods, P.read]) },
  { path: '/accounting/inventory', component: () => import('./views/InventoryView.vue'), meta: meta('محضر جرد السندات') },
  // الأصول الثابتة
  { path: '/accounting/assets', component: () => import('./views/assets/AssetsDashboard.vue'), meta: meta('الأصول الثابتة', P.assetsRead, ASSET_READ) },
  { path: '/accounting/assets/register', component: () => import('./views/assets/AssetRegisterView.vue'), meta: meta('سجل الأصول', P.assetsRead, ASSET_READ) },
  { path: '/accounting/assets/groups', component: () => import('./views/assets/AssetGroupsView.vue'), meta: meta('مجموعات الأصول', P.assetsRead, ASSET_READ) },
  { path: '/accounting/assets/opening', component: () => import('./views/assets/AssetOpeningView.vue'), meta: meta('الأرصدة الافتتاحية للأصول', P.assetsRead, ASSET_READ) },
  { path: '/accounting/assets/operations', component: () => import('./views/assets/AssetOperationsView.vue'), meta: meta('عمليات الأصول', P.assetsRead, ASSET_READ) },
  { path: '/accounting/assets/depreciation', component: () => import('./views/assets/DepreciationView.vue'), meta: meta('احتساب الإهلاك', P.assetsDepreciate) },
  { path: '/accounting/assets/runs', component: () => import('./views/assets/DepRunsView.vue'), meta: meta('سجل حركات الإهلاك', P.assetsRead, ASSET_READ) },
  { path: '/accounting/assets/runs/:id', component: () => import('./views/assets/DepRunView.vue'), props: true, meta: meta('حركة الإهلاك', P.assetsRead, ASSET_READ) },
  { path: '/accounting/assets/custody', component: () => import('./views/assets/CustodyView.vue'), meta: meta('العهد', P.assetsRead, ASSET_READ) },
  { path: '/accounting/assets/custody/forms/:id', component: () => import('./views/assets/CustodyFormView.vue'), props: true, meta: meta('نموذج العهدة', P.assetsRead, ASSET_READ) },
  { path: '/accounting/assets/stocktakes', component: () => import('./views/assets/StocktakesView.vue'), meta: meta('الجرد الدوري', P.assetsRead, ASSET_READ) },
  { path: '/accounting/assets/stocktakes/:id', component: () => import('./views/assets/StocktakeView.vue'), props: true, meta: meta('الجرد', P.assetsRead, ASSET_READ) },
  { path: '/accounting/assets/labels', component: () => import('./views/assets/LabelsView.vue'), meta: meta('ملصقات الأصول', P.assetsRead, ASSET_READ) },
  { path: '/accounting/assets/a/:code', component: () => import('./views/assets/AssetByCode.vue'), props: true, meta: meta('الأصل', P.assetsRead, ASSET_READ) },
  { path: '/accounting/assets/:id', component: () => import('./views/assets/AssetDetailView.vue'), props: true, meta: meta('بطاقة الأصل', P.assetsRead, ASSET_READ) },
  { path: '/accounting/reports', component: () => import('../../components/reports/ReportsHub.vue'), props: { module: 'accounting', system: 'النظام المالي' }, meta: meta('تقارير النظام المالي', P.reports, [P.reports, P.assetsRead]) },
  { path: '/accounting/settings', component: () => import('./views/SettingsView.vue'), meta: meta('إعدادات النظام المالي', P.settings) },
];
