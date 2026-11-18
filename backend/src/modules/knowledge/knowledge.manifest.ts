import { ErpModuleManifest } from '../../platform/erp-module';

export const KNOWLEDGE_PERMISSIONS = {
  read: 'knowledge.archive.read',
  manage: 'knowledge.archive.manage',
  publish: 'knowledge.archive.publish',
  reports: 'knowledge.reports.read',
  settings: 'knowledge.settings.manage',
} as const;

const P = KNOWLEDGE_PERMISSIONS;

export const knowledgeManifest: ErpModuleManifest = {
  code: 'knowledge',
  name: 'أرشيف المعرفة',
  description: 'اللوائح والسياسات والأدلة والدراسات والتقارير والدروس المستفادة في مكان واحد، بإصدارات وتصنيفات وبحث، مع نشر ما تختاره الجمعية في موقعها',
  icon: 'book',
  version: '1.0.0',
  alwaysEnabled: true,
  sequence: 88,
  permissions: [
    { code: P.read, name: 'تصفح أرشيف المعرفة والاطلاع على الوثائق المنشورة' },
    { code: P.manage, name: 'إضافة الوثائق وتعديلها ورفع إصدارات جديدة' },
    { code: P.publish, name: 'نشر الوثائق وأرشفتها وإتاحتها في الموقع الإلكتروني' },
    { code: P.reports, name: 'عرض تقارير أرشيف المعرفة' },
    { code: P.settings, name: 'إعدادات أرشيف المعرفة وتصنيفاته وصلاحياته' },
  ],
  settingsPermission: P.settings,
  menu: [
    { label: 'أرشيف المعرفة', path: '/knowledge', permission: P.read },
    { label: 'التقارير', path: '/knowledge/reports', permission: P.reports },
    { label: 'الإعدادات', path: '/knowledge/settings', permission: P.settings },
  ],
};
