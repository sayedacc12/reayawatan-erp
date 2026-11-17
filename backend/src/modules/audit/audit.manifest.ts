import { ErpModuleManifest } from '../../platform/erp-module';

export const AUDIT_PERMISSIONS = {
  read: 'audit.dashboard.read',
  universe: 'audit.universe.manage',
  plans: 'audit.plans.manage',
  approvePlans: 'audit.plans.approve',
  engagements: 'audit.engagements.manage',
  fieldwork: 'audit.fieldwork.perform',
  issue: 'audit.reports.issue',
  respond: 'audit.actions.respond',
  verify: 'audit.actions.verify',
  reports: 'audit.reports.read',
  settings: 'audit.settings.manage',
} as const;

const P = AUDIT_PERMISSIONS;

export const auditManifest: ErpModuleManifest = {
  code: 'audit',
  name: 'المراجعة الداخلية',
  description: 'مراجعة داخلية مبنية على المخاطر: مجالات المراجعة وتقييمها، الخطة الرئيسية والخطط الفرعية، توزيع المهام وبرامج العمل، الملاحظات والتوصيات، ومتابعة تنفيذها مع الجهات المسؤولة حتى إغلاقها بتقرير موثق',
  icon: 'shieldCheck',
  version: '1.0.0',
  alwaysEnabled: true,
  sequence: 80,
  permissions: [
    { code: P.read, name: 'عرض لوحة المراجعة الداخلية والخطط والمهام والتوصيات' },
    { code: P.universe, name: 'إدارة مجالات المراجعة وتقييم مخاطرها' },
    { code: P.plans, name: 'إعداد خطط المراجعة الرئيسية والفرعية' },
    { code: P.approvePlans, name: 'اعتماد خطط المراجعة أو إعادتها' },
    { code: P.engagements, name: 'إنشاء مهام المراجعة وتوزيعها على الفريق' },
    { code: P.fieldwork, name: 'تنفيذ أعمال المراجعة: بنود البرنامج والملاحظات والتوصيات' },
    { code: P.issue, name: 'اعتماد تقارير المراجعة وإصدارها (تتحول التوصيات إلى مهام متابعة)' },
    { code: P.respond, name: 'متابعة التوصيات المسندة لجهته وتقديم تقارير الإغلاق' },
    { code: P.verify, name: 'التحقق من تقارير الإغلاق وإغلاق التوصيات أو إعادتها وتمديد مواعيدها' },
    { code: P.reports, name: 'تقارير المراجعة الداخلية' },
    { code: P.settings, name: 'إعدادات المراجعة الداخلية وصلاحياتها' },
  ],
  settingsPermission: P.settings,
  menu: [
    { label: 'لوحة المراجعة الداخلية', path: '/audit', permission: P.read },
    { label: 'مجالات المراجعة والمخاطر', path: '/audit/universe', permission: P.read, group: 'التخطيط' },
    { label: 'خطط المراجعة', path: '/audit/plans', permission: P.read, group: 'التخطيط' },
    { label: 'مهام المراجعة', path: '/audit/engagements', permission: P.read, group: 'التنفيذ والمتابعة' },
    { label: 'متابعة التوصيات', path: '/audit/actions', permission: P.read, anyOf: [P.respond], group: 'التنفيذ والمتابعة' },
    { label: 'التقارير', path: '/audit/reports', permission: P.reports },
    { label: 'الإعدادات', path: '/audit/settings', permission: P.settings },
  ],
};
