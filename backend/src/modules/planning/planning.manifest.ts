import { ErpModuleManifest } from '../../platform/erp-module';

export const PLANNING_PERMISSIONS = {
  read: 'planning.dashboard.read',
  strategic: 'planning.strategic.manage',
  operational: 'planning.operational.manage',
  kpis: 'planning.kpis.manage',
  progress: 'planning.progress.update',
  approve: 'planning.plans.approve',
  reports: 'planning.reports.read',
  settings: 'planning.settings.manage',
} as const;

const P = PLANNING_PERMISSIONS;

export const planningManifest: ErpModuleManifest = {
  code: 'planning',
  name: 'التخطيط والموازنات',
  description: 'الخطط الاستراتيجية والتشغيلية بهيكل مرن، ومؤشرات الأداء ومستهدفاتها، والربط بين الأهداف والمبادرات والأنشطة، والإصدارات والاعتماد، ومتابعة الإنجاز',
  icon: 'target',
  version: '1.0.0',
  alwaysEnabled: true,
  sequence: 72,
  permissions: [
    { code: P.read, name: 'عرض الخطط والمؤشرات ولوحة التخطيط' },
    { code: P.strategic, name: 'إعداد الخطط الاستراتيجية وتعديلها' },
    { code: P.operational, name: 'إعداد الخطط التشغيلية وتعديلها وترحيل الأنشطة' },
    { code: P.kpis, name: 'إدارة مؤشرات الأداء ومستهدفاتها' },
    { code: P.progress, name: 'تحديث نسب الإنجاز وقراءات المؤشرات' },
    { code: P.approve, name: 'اعتماد الخطط (حسب مراحل مسار الاعتماد)' },
    { code: P.reports, name: 'عرض تقارير التخطيط وتصديرها' },
    { code: P.settings, name: 'إعدادات التخطيط ومسارات الاعتماد وصلاحياتها' },
  ],
  settingsPermission: P.settings,
  menu: [
    { label: 'لوحة التخطيط', path: '/planning', permission: P.read },
    { label: 'بانتظار اعتمادي', path: '/planning/approvals', permission: P.read },
    { label: 'الخطط الاستراتيجية', path: '/planning/strategic', permission: P.read, group: 'الخطط' },
    { label: 'الخطط التشغيلية', path: '/planning/operational', permission: P.read, group: 'الخطط' },
    { label: 'مؤشرات الأداء', path: '/planning/kpis', permission: P.read },
    { label: 'متابعة التنفيذ', path: '/planning/execution', permission: P.read },
    { label: 'التقارير', path: '/planning/reports', permission: P.reports },
    { label: 'الإعدادات', path: '/planning/settings', permission: P.settings },
  ],
};
