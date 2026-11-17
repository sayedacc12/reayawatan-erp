import { api } from '../../api';

export const P = {
  read: 'hr.dashboard.read', structure: 'hr.structure.manage', jobs: 'hr.jobs.manage', approveJobs: 'hr.jobs.approve', grades: 'hr.grades.manage',
  competencies: 'hr.competencies.manage', plans: 'hr.plans.manage', approvePlans: 'hr.plans.approve', employees: 'hr.employees.manage',
  salaries: 'hr.salaries.read', leaves: 'hr.leaves.manage', approveLeaves: 'hr.leaves.approve', performance: 'hr.performance.manage',
  approvePerformance: 'hr.performance.approve', policy: 'hr.policy.manage', settings: 'hr.settings.manage',
  attendance: 'hr.attendance.manage', payroll: 'hr.payroll.manage', approvePayroll: 'hr.payroll.approve', payPayroll: 'hr.payroll.pay',
  development: 'hr.development.manage', approveDevelopment: 'hr.development.approve',
} as const;

export const sar = (n: number | null | undefined) => `${(n ?? 0).toLocaleString('ar-SA', { minimumFractionDigits: 0, maximumFractionDigits: 2 })} ر.س`;
export const num = (n: number | null | undefined) => (n ?? 0).toLocaleString('ar-SA', { maximumFractionDigits: 2 });
export const fmtDate = (d: string | null | undefined) =>
  d ? new Date(`${d.slice(0, 10)}T00:00:00`).toLocaleDateString('ar-SA-u-ca-gregory', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';
/** التاريخ الهجري المقابل (أم القرى) */
export const hijri = (d: string | null | undefined) =>
  d ? new Date(`${d.slice(0, 10)}T00:00:00`).toLocaleDateString('ar-SA-u-ca-islamic-umalqura', { day: 'numeric', month: 'long', year: 'numeric' }) : '';
export const todayStr = () => new Date(Date.now() + 3 * 3600_000).toISOString().slice(0, 10);
export const thisYear = () => Number(todayStr().slice(0, 4));
export const errMsg = (e: unknown) => (e as Error).message;

export const STATUS_COLOR: Record<string, string> = {
  draft: '#94a3b8', submitted: '#f59e0b', returned: '#f97316', approved: '#10b981', completed: '#6366f1', rejected: '#ef4444', pending: '#f59e0b', cancelled: '#94a3b8',
  agreed: '#6366f1', evaluated: '#0ea5e9', active: '#10b981', terminated: '#ef4444',
};
export const CONTRACT_TYPES = [
  { value: 'fixed', label: 'محدد المدة' }, { value: 'indefinite', label: 'غير محدد المدة' }, { value: 'part_time', label: 'دوام جزئي' }, { value: 'temporary', label: 'مؤقت / موسمي' },
];
export const QIWA = [{ value: 'documented', label: 'موثّق في قوى' }, { value: 'pending', label: 'بانتظار موافقة الموظف' }, { value: 'not_documented', label: 'غير موثّق' }];
export const FUNDING = [{ value: 'own', label: 'موارد ذاتية' }, { value: 'project', label: 'مشروع' }, { value: 'grant', label: 'منحة' }, { value: 'restricted', label: 'تبرع مقيد' }];
export const COMP_KINDS = [{ value: 'core', label: 'أساسية' }, { value: 'leadership', label: 'قيادية' }, { value: 'technical', label: 'فنية' }];
export const MONTHS = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];

export interface Unit {
  id: string; parentId: string | null; level: number; levelName: string; code: string | null; name: string; managerEmployeeId: string | null; managerName: string | null;
  costCenter: string | null; analyticAccountId: string | null; description: string | null; sortOrder: number; jobs: number; headcount: number; employees: number;
}
/** بند من بنود الراتب (الأساسي والبدلات) معرّف في الإعدادات */
export interface AllowanceType {
  id: string; code: string; name: string; defaultKind: 'percent' | 'fixed'; defaultValue: number; payableAccountId: string | null;
  cashAccountId: string | null; isSystem: boolean; isActive: boolean; sortOrder: number; employees: number;
}
/** قوائم الاختيار من النظام المالي */
export interface AccLookups {
  accounts: { id: string; code: string; name: string; nature: string; requiresAnalytic: boolean }[];
  analytics: { id: string; code: string; name: string }[];
  cashAccounts: { id: string; name: string; kind: string; bankName: string | null; iban: string | null }[];
  roles: { id: string; name: string }[];
}
export const accLabel = (l: AccLookups | null, id: string | null | undefined) => {
  const a = l?.accounts.find((x) => x.id === id);
  return a ? `${a.code} ${a.name}` : '—';
};
export const monthLabel = (m: string) => `${MONTHS[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}`;
export interface GradeAllowance { code: string; name: string; kind: 'percent' | 'fixed'; value: number }
export interface Grade {
  id: string; code: string; name: string; structureLevel: number | null; structureLevelName: string | null; minSalary: number; maxSalary: number; steps: number; stepIncrement: number;
  allowances: GradeAllowance[]; sortOrder: number; scale: { step: number; basic: number; gross: number; allowances: { code: string; name: string; amount: number }[] }[];
  jobs: { id: string; title: string; headcount: number }[]; employees: number; averageBasic: number | null;
}
export interface Competency { id: string; name: string; kind: string; kindLabel: string; description: string | null; levels: { level: number; description: string }[]; isActive: boolean; jobs: number }
export interface JobRow {
  id: string; code: string; title: string; unitId: string; unitName: string; gradeId: string | null; gradeName: string | null; reportsToJobId: string | null; reportsToTitle: string | null;
  headcount: number; filled: number; vacancies: number; qualityCode: string | null; revision: number; status: 'draft' | 'approved'; isActive: boolean; kpis: number; competencies: number;
  expenseProfileId?: string | null; expenseProfileName?: string | null; backupJobId?: string | null;
}
export interface EmpRow {
  id: string; employeeNo: number; fullName: string; nationalId: string; nationality: string; isSaudi: boolean; gender: string; unitName: string; jobTitle: string; gradeName: string | null;
  hireDate: string; contractType: string; contractTypeLabel: string; contractEnd: string | null; qiwaStatus: string; status: string; terminationDate: string | null; gross: number | null;
}

/** قوائم مشتركة تُحمَّل مرة لكل شاشة */
export async function loadLookups() {
  const [structure, jobs] = await Promise.all([
    api<{ levels: string[]; units: Unit[] }>('/hr/structure'),
    api<JobRow[]>('/hr/jobs'),
  ]);
  return { ...structure, jobs };
}
