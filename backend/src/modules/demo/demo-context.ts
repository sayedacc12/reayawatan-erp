import { OrgUser } from '../../core/auth/decorators';
import { ACC_PERMISSIONS } from '../accounting/accounting.manifest';
import { BENEFICIARY_PERMISSIONS } from '../beneficiaries/beneficiaries.manifest';
import { FUNDRAISING_PERMISSIONS } from '../fundraising/fundraising.manifest';
import { HR_PERMISSIONS } from '../hr/hr.manifest';
import { PROJECT_PERMISSIONS } from '../projects/projects.manifest';

export const DEMO_SLUG = 'demo';
/** بريد الحسابات وطلبات الاشتراك التجريبية (تُحذف كلها عند إعادة إنشاء الجمعية التجريبية) */
export const DEMO_EMAIL = (name: string) => `demo-${name}@sanabelerp.com`;

export const daysAgo = (n: number) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);
export const daysAhead = (n: number) => daysAgo(-n);

export const ALL_PERMISSIONS = [
  ...Object.values(BENEFICIARY_PERMISSIONS), ...Object.values(FUNDRAISING_PERMISSIONS), ...Object.values(PROJECT_PERMISSIONS),
  ...Object.values(ACC_PERMISSIONS), ...Object.values(HR_PERMISSIONS),
];

/** مستخدم تجريبي بصيغة المستخدم الحالي، لتنفيذ العمليات عبر خدمات الوحدات كما لو نفذها بنفسه */
export function actorOf(
  orgId: string, u: { id: string; fullName: string; email: string }, permissions: string[], isSuperadmin = false,
): OrgUser {
  return {
    id: u.id, organizationId: orgId, organizationName: null, organizationSlug: DEMO_SLUG, email: u.email, username: null,
    fullName: u.fullName, isSuperadmin, isPlatformAdmin: false, permissions,
  };
}

/** فريق الجمعية التجريبية: كل موظف بدوره، وتُسجَّل العمليات بأسمائهم */
export interface DemoTeam {
  admin: OrgUser;
  researcher: OrgUser;
  caseManager: OrgUser;
  quality: OrgUser;
  fundraiser: OrgUser;
  finance: OrgUser;
  projectsManager: OrgUser;
  roles: { researcher: string; caseManager: string; quality: string; fundraiser: string; finance: string; projectsManager: string };
}

/** مشاريع الشجرة التي تنشئها مرحلة الإعداد */
export interface DemoTree {
  axes: { social: string; health: string; education: string };
  programs: { sponsorship: string; food: string; treatment: string; students: string };
  projects: { orphans: string; widows: string; ramadan: string; surgery: string; school: string };
}
