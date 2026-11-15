import { ErpModuleManifest } from '../../platform/erp-module';

export const BENEFICIARY_PERMISSIONS = {
  read: 'beneficiaries.cases.read',
  manage: 'beneficiaries.cases.manage',
  delete: 'beneficiaries.cases.delete',
  research: 'beneficiaries.research.manage',
  aid: 'beneficiaries.aid.manage',
  documents: 'beneficiaries.documents.manage',
} as const;

export const beneficiariesManifest: ErpModuleManifest = {
  code: 'beneficiaries',
  name: 'المستفيدون',
  description: 'ملفات الحالات والأسر والبحث الاجتماعي والمساعدات',
  icon: 'hand',
  version: '1.0.0',
  alwaysEnabled: true,
  sequence: 30,
  permissions: [
    { code: BENEFICIARY_PERMISSIONS.read, name: 'عرض ملفات المستفيدين' },
    { code: BENEFICIARY_PERMISSIONS.manage, name: 'إضافة وتعديل المستفيدين وأفراد أسرهم' },
    { code: BENEFICIARY_PERMISSIONS.delete, name: 'حذف ملف مستفيد' },
    { code: BENEFICIARY_PERMISSIONS.research, name: 'تسجيل البحث الاجتماعي وقرار الاستحقاق' },
    { code: BENEFICIARY_PERMISSIONS.aid, name: 'تسجيل المساعدات المصروفة' },
    { code: BENEFICIARY_PERMISSIONS.documents, name: 'رفع وحذف المستندات' },
  ],
  menu: [
    { label: 'لوحة المستفيدين', path: '/beneficiaries', permission: BENEFICIARY_PERMISSIONS.read },
    { label: 'ملفات المستفيدين', path: '/beneficiaries/files', permission: BENEFICIARY_PERMISSIONS.read },
    { label: 'سجل المساعدات', path: '/beneficiaries/aid-log', permission: BENEFICIARY_PERMISSIONS.read },
  ],
};
