import { api } from '../../api';

export const P = {
  read: 'audit.dashboard.read', universe: 'audit.universe.manage', plans: 'audit.plans.manage', approvePlans: 'audit.plans.approve',
  engagements: 'audit.engagements.manage', fieldwork: 'audit.fieldwork.perform', issue: 'audit.reports.issue', respond: 'audit.actions.respond',
  verify: 'audit.actions.verify', reports: 'audit.reports.read', settings: 'audit.settings.manage',
} as const;

export const LEVELS = [
  { value: 'critical', label: 'حرج' }, { value: 'high', label: 'مرتفع' }, { value: 'medium', label: 'متوسط' }, { value: 'low', label: 'منخفض' },
] as const;
export const LEVEL_LABEL: Record<string, string> = { critical: 'حرج', high: 'مرتفع', medium: 'متوسط', low: 'منخفض' };
export const LEVEL_COLOR: Record<string, string> = { critical: '#dc2626', high: '#f97316', medium: '#eab308', low: '#16a34a' };
export const CATEGORIES = [
  { value: 'governance', label: 'الحوكمة' }, { value: 'strategic', label: 'استراتيجي' }, { value: 'operational', label: 'تشغيلي' }, { value: 'financial', label: 'مالي' },
  { value: 'compliance', label: 'الالتزام' }, { value: 'it', label: 'تقنية المعلومات' }, { value: 'programs', label: 'البرامج والمستفيدون' },
  { value: 'fundraising', label: 'تنمية الموارد' }, { value: 'hr', label: 'الموارد البشرية' },
];
export const CONTROLS = [{ value: 'strong', label: 'قوية' }, { value: 'adequate', label: 'مقبولة' }, { value: 'weak', label: 'ضعيفة' }, { value: 'unknown', label: 'غير مقيّمة' }];
export const OPINIONS = [{ value: 'satisfactory', label: 'مرضٍ' }, { value: 'needs_improvement', label: 'يحتاج إلى تحسين' }, { value: 'unsatisfactory', label: 'غير مرضٍ' }];
export const STATUS_COLOR: Record<string, string> = {
  draft: '#94a3b8', submitted: '#f59e0b', approved: '#10b981', closed: '#64748b', planned: '#6366f1', fieldwork: '#0ea5e9', review: '#f59e0b',
  issued: '#a855f7', cancelled: '#94a3b8', open: '#64748b', in_progress: '#0ea5e9', pending: '#94a3b8', satisfactory: '#10b981', finding: '#f97316', na: '#94a3b8',
};
export const ENG_STEPS = [
  { value: 'planned', label: 'مخططة' }, { value: 'fieldwork', label: 'العمل الميداني' }, { value: 'review', label: 'مراجعة التقرير' },
  { value: 'issued', label: 'متابعة التوصيات' }, { value: 'closed', label: 'مغلقة' },
];

export const fmtDate = (d: string | null | undefined) =>
  d ? new Date(`${String(d).slice(0, 10)}T00:00:00`).toLocaleDateString('ar-SA-u-ca-gregory', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';
export const fmtDateTime = (d: string | Date | null | undefined) =>
  d ? new Date(d).toLocaleString('ar-SA-u-ca-gregory', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';
export const todayStr = () => new Date(Date.now() + 3 * 3600_000).toISOString().slice(0, 10);
export const thisYear = () => Number(todayStr().slice(0, 4));
export const addDays = (d: string, n: number) => new Date(new Date(`${d}T00:00:00Z`).getTime() + n * 86400000).toISOString().slice(0, 10);
export const errMsg = (e: unknown) => (e as Error).message;

export interface RiskRef { id: string; code: string; title: string; level: string; score: number | null; levelLabel?: string; status?: string | null; live?: boolean }
export interface RegisterRisk {
  id: string; code: string; title: string; category?: string | null; unitId?: string | null; unitName?: string | null; likelihood?: number | null; impact?: number | null;
  score: number | null; level: string; levelLabel?: string; status?: string;
}
export interface Lookups {
  units: { id: string; parentId: string | null; level: number; name: string; managerName: string | null }[];
  users: { id: string; fullName: string }[];
  risks: RegisterRisk[];
  controls: { id: string; code: string; name: string; riskIds: string[] }[];
  registerAvailable: boolean;
  riskBands: { medium: number; high: number; critical: number };
  dueDays: Record<string, number>;
}
export interface Area {
  id: string; code: string; name: string; category: string; categoryLabel: string; scopeType: 'unit' | 'outside'; unitId: string | null; unitName: string | null;
  outsideLabel: string | null; description: string | null; likelihood: number; impact: number; controlRating: string; controlLabel: string; lastAuditDate: string | null;
  isActive: boolean; riskRefs: RiskRef[]; engagements: number; openEngagements: number; score: number; level: string; levelLabel: string; priority: number;
  frequencyMonths: number; nextDue: string | null; isDue: boolean;
}
export interface PlanStats { total: number; done: number; active: number; hours: number; actualHours: number; findings: number; progress: number }
export interface Plan {
  id: string; code: string; kind: 'master' | 'sub'; parentId: string | null; year: number; title: string; scopeType: 'org' | 'unit' | 'outside'; unitId: string | null;
  scopeLabel: string; outsideLabel: string | null; periodFrom: string; periodTo: string; objectives: string | null; methodology: string | null; availableHours: number;
  riskRefs: RiskRef[]; status: string; statusLabel: string; decisionNote: string | null; approvedByName: string | null; approvedAt: string | null; createdByName: string;
  history: { at: string; by: string; action: string; note?: string | null }[]; stats: PlanStats;
}
export interface EngRow {
  id: string; code: string; title: string; planId: string; planCode: string; planTitle: string; priority: string; priorityLabel: string; status: string; statusLabel: string;
  scopeType: string; scopeLabel: string; plannedStart: string; plannedEnd: string; actualStart: string | null; actualEnd: string | null; leadName: string | null;
  team: { userId: string; name: string; role: string }[]; budgetHours: number; actualHours: number; risks: number; items: number; tested: number; progress: number;
  findings: number; actions: { total: number; closed: number; overdue: number }; late: boolean;
}
export interface ActionRow {
  id: string; code: string; engagementId: string; engagementCode: string | null; engagementTitle: string | null; findingId: string; title: string; description: string;
  priority: string; priorityLabel: string; responsibleUnitId: string; responsibleUnitName: string; assigneeUserId: string | null; assigneeName: string | null;
  startDate: string; dueDate: string; originalDueDate: string; extended: boolean; status: string; statusLabel: string; overdue: boolean; daysLeft: number | null;
  progress: number; closureReport: { title: string; refNo: string | null; date: string; summary: string; submittedByName: string; submittedAt: string } | null;
  verifiedByName: string | null; closedAt: string | null;
}

let cached: Promise<Lookups> | null = null;
/** القوائم المشتركة (الهيكل والمستخدمون وسجل المخاطر) مرة لكل جلسة شاشة */
export function loadLookups(force = false) {
  if (!cached || force) cached = api<Lookups>('/audit/lookups').catch((e) => { cached = null; throw e; });
  return cached;
}

/** شجرة الوحدات مرتبة بمسافة بادئة حسب المستوى */
export function unitOptions(l: Lookups | null) {
  if (!l) return [];
  const out: { id: string; label: string }[] = [];
  const walk = (parent: string | null, depth: number) => {
    for (const u of l.units.filter((x) => x.parentId === parent)) {
      out.push({ id: u.id, label: `${'— '.repeat(depth)}${u.name}` });
      walk(u.id, depth + 1);
    }
  };
  walk(null, 0);
  for (const u of l.units) if (!out.some((o) => o.id === u.id)) out.push({ id: u.id, label: u.name });
  return out;
}

export const levelOf = (bands: Lookups['riskBands'] | undefined, score: number) => {
  const b = bands ?? { medium: 5, high: 10, critical: 16 };
  return score >= b.critical ? 'critical' : score >= b.high ? 'high' : score >= b.medium ? 'medium' : 'low';
};
export const toRef = (r: RegisterRisk | RiskRef): RiskRef => ({ id: r.id, code: r.code, title: r.title, level: r.level, score: r.score });
