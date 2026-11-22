import { OrgUser } from '../../core/auth/decorators';
import { ACC_PERMISSIONS } from '../accounting/accounting.manifest';
import { AUDIT_PERMISSIONS } from '../audit/audit.manifest';
import { HR_PERMISSIONS } from '../hr/hr.manifest';
import { MEMBER_PERMISSIONS } from '../members/members.manifest';
import { RISK_PERMISSIONS } from '../risk/risk.manifest';
import { VOL_PERMISSIONS } from '../volunteers/volunteers.manifest';
import { QUALITY_PERMISSIONS } from '../quality/quality.manifest';
import { GOV_PERMISSIONS } from '../governance/governance.manifest';
import { KNOWLEDGE_PERMISSIONS } from '../knowledge/knowledge.manifest';
import { WEBSITE_PERMISSIONS } from '../website/website.manifest';
import { PARTNERSHIP_PERMISSIONS } from '../partnerships/partnerships.manifest';
import { COMMS_PERMISSIONS } from '../comms/comms.manifest';
import { MEETINGS_PERMISSIONS } from '../meetings/meetings.manifest';
import { PLANNING_PERMISSIONS } from '../planning/planning.manifest';
import { PROCUREMENT_PERMISSIONS } from '../procurement/procurement.manifest';
import { BILLING_PERMISSIONS } from '../billing/billing.manifest';
import { CRM_PERMISSIONS } from '../crm/crm.manifest';

export const DEMO_SLUG = 'demo';
/** بريد الحسابات وطلبات الاشتراك التجريبية (تُحذف كلها عند إعادة إنشاء الشركة التجريبية) */
export const DEMO_EMAIL = (name: string) => `demo-${name}@sanabelerp.com`;

/** تاريخ اليوم بتوقيت الرياض (UTC+3) مثل خدمات النظام، حتى لا تتعارض البيانات التجريبية معها بين 21:00 و24:00 UTC */
export const daysAgo = (n: number) => new Date(Date.now() + 3 * 3600000 - n * 86400000).toISOString().slice(0, 10);
export const daysAhead = (n: number) => daysAgo(-n);

export const ALL_PERMISSIONS = [
  ...Object.values(ACC_PERMISSIONS), ...Object.values(HR_PERMISSIONS), ...Object.values(RISK_PERMISSIONS), ...Object.values(VOL_PERMISSIONS), ...Object.values(QUALITY_PERMISSIONS), ...Object.values(AUDIT_PERMISSIONS), ...Object.values(MEMBER_PERMISSIONS),
  ...Object.values(GOV_PERMISSIONS),
  ...Object.values(KNOWLEDGE_PERMISSIONS), ...Object.values(WEBSITE_PERMISSIONS), ...Object.values(COMMS_PERMISSIONS), ...Object.values(MEETINGS_PERMISSIONS), ...Object.values(PARTNERSHIP_PERMISSIONS),
  ...Object.values(PLANNING_PERMISSIONS), ...Object.values(PROCUREMENT_PERMISSIONS), ...Object.values(BILLING_PERMISSIONS), ...Object.values(CRM_PERMISSIONS),
];

/** مستخدم تجريبي بصيغة المستخدم الحالي، لتنفيذ العمليات عبر خدمات الوحدات كما لو نفذها بنفسه */
export function actorOf(
  orgId: string, u: { id: string; fullName: string; email: string }, permissions: string[], isSuperadmin = false, slug = DEMO_SLUG,
): OrgUser {
  return {
    id: u.id, organizationId: orgId, organizationName: null, organizationSlug: slug, email: u.email, username: null,
    fullName: u.fullName, isSuperadmin, isPlatformAdmin: false, permissions,
  };
}

/** فريق الشركة التجريبية: كل موظف بدوره، وتُسجَّل العمليات بأسمائهم */
export interface DemoTeam {
  /** معرّف الشركة التي تُبنى فيها البيانات (demo أو جمعية تجريبية أضافت بيانات تجريبية) */
  slug: string;
  /** بريد حسابات الموظفين التجريبيين (فريد على مستوى المنصة) */
  email: (name: string) => string;
  admin: OrgUser;
  researcher: OrgUser;
  caseManager: OrgUser;
  quality: OrgUser;
  fundraiser: OrgUser;
  finance: OrgUser;
  projectsManager: OrgUser;
  roles: { researcher: string; caseManager: string; quality: string; fundraiser: string; finance: string; projectsManager: string };
}

/** بريد الموظفين التجريبيين داخل جمعية حقيقية في فترة التجربة: فريد لكل جمعية */
export const SAMPLE_EMAIL = (slug: string) => (name: string) => `sample-${name}.${slug}@sanabelerp.com`;

/** إعدادات البناء: الشركة التجريبية الكاملة، أو بيانات تجريبية داخل جمعية مشتركة */
export interface SeedTarget {
  slug: string;
  email: (name: string) => string;
  /** مدير نظام الشركة الحالي: تُسجَّل باسمه عمليات «المدير» بدل إنشاء حساب مدير تجريبي */
  admin?: { id: string; fullName: string; email: string };
}
