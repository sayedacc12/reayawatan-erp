import { ref } from 'vue';
import { api } from '../../api';

export const P = {
  read: 'planning.dashboard.read', strategic: 'planning.strategic.manage', operational: 'planning.operational.manage', kpis: 'planning.kpis.manage',
  progress: 'planning.progress.update', approve: 'planning.plans.approve', reports: 'planning.reports.read', settings: 'planning.settings.manage',
} as const;

/* eslint-disable @typescript-eslint/no-explicit-any */
export interface Level { key: string; name: string; prefix: string }
export interface Stage { name: string; roleId: string | null }
export interface Route { key: string; name: string; planKind: 'strategic' | 'operational' | 'any'; unitId: string | null; minCost: number | null; stages: Stage[] }
export interface CustomField { key: string; label: string; type: 'text' | 'number' | 'date' | 'select'; options: string[]; appliesTo: 'strategic' | 'operational' | 'all' }
export interface PlanningConfig {
  strategicLevels: Level[]; operationalLevels: Level[]; relationTypes: { code: string; name: string }[]; kpiUnits: string[];
  thresholds: { green: number; amber: number }; delayTolerance: number; customFields: CustomField[]; routes: Route[];
}
export interface Template { key: string; name: string; description: string; kind: 'strategic' | 'operational'; periodicity: string; levels: Level[] }
export interface ConfigPayload { config: PlanningConfig; defaults: PlanningConfig; templates: Template[]; configurable: string[]; needsDevelopment: string[] }
export interface Lookups {
  units: { id: string; name: string; level: number }[]; users: { id: string; fullName: string }[]; roles: { id: string; name: string }[];
  costCenters: { id: string; code: string; name: string }[]; projects: { id: string; code: string; name: string; budget: number | null }[];
  capitalLines: { id: string; code: string; name: string; amount: number; year: number; status: string }[];
}

const cfgCache = ref<ConfigPayload | null>(null);
export async function loadConfig(force = false) {
  if (!cfgCache.value || force) cfgCache.value = await api<ConfigPayload>('/planning/config');
  return cfgCache.value;
}
let lkCache: Promise<Lookups> | null = null;
export const loadLookups = (force = false) => {
  if (!lkCache || force) lkCache = api<Lookups>('/planning/lookups').catch((e) => { lkCache = null; throw e; });
  return lkCache;
};

export const fmtDate = (d: string | null | undefined) =>
  d ? new Date(`${d.slice(0, 10)}T00:00:00`).toLocaleDateString('ar-SA-u-ca-gregory', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';
export const fmtDateTime = (d: string | null | undefined) =>
  d ? new Date(d).toLocaleString('ar-SA-u-ca-gregory', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';
export const todayStr = () => new Date(Date.now() + 3 * 3600_000).toISOString().slice(0, 10);
export const num = (n: number | null | undefined, d = 1) => (n === null || n === undefined ? '—' : n.toLocaleString('en-US', { maximumFractionDigits: d }));
export const money = (n: number | null | undefined) => (n === null || n === undefined ? '—' : `${Math.round(n).toLocaleString('en-US')} ر.س`);
export const pct = (n: number | null | undefined) => (n === null || n === undefined ? '—' : `${num(n)}%`);
export const errMsg = (e: unknown) => (e as Error).message;

export const KIND: Record<string, string> = { strategic: 'استراتيجية', operational: 'تشغيلية' };
export const PERIODICITY: Record<string, string> = { annual: 'سنوية', semiannual: 'نصف سنوية', quarterly: 'ربع سنوية', monthly: 'شهرية' };
export const WF_STATUS: Record<string, { label: string; color: string }> = {
  draft: { label: 'مسودة', color: '#94a3b8' }, in_review: { label: 'قيد الاعتماد', color: '#f59e0b' }, returned: { label: 'مُرجعة للتعديل', color: '#f97316' },
  approved: { label: 'معتمدة', color: '#10b981' }, rejected: { label: 'مرفوضة', color: '#ef4444' },
};
export const WF_ACTION: Record<string, string> = { submit: 'رفع للاعتماد', approve: 'اعتماد', return: 'إرجاع', reject: 'رفض', reopen: 'بدء تعديل' };
export const EXEC: Record<string, { label: string; color: string }> = {
  not_started: { label: 'لم يبدأ', color: '#94a3b8' }, no_schedule: { label: 'بلا جدول زمني', color: '#94a3b8' }, on_track: { label: 'حسب الخطة', color: '#10b981' },
  at_risk: { label: 'في خطر', color: '#f59e0b' }, delayed: { label: 'متأخر', color: '#ef4444' }, completed: { label: 'منجز', color: '#0ea5e9' },
  cancelled: { label: 'ملغى', color: '#475569' }, carried_over: { label: 'مُرحّل', color: '#a78bfa' },
};
export const STATES: Record<string, string> = { not_started: 'لم يبدأ', in_progress: 'قيد التنفيذ', completed: 'منجز', cancelled: 'ملغى' };
export const BAND: Record<string, { label: string; color: string }> = {
  green: { label: 'محقق', color: '#10b981' }, amber: { label: 'قريب من المستهدف', color: '#f59e0b' }, red: { label: 'دون المستهدف', color: '#ef4444' }, none: { label: 'بلا قراءة', color: '#94a3b8' },
};
export const FUNDING: Record<string, string> = { restricted: 'مقيد', unrestricted: 'غير مقيد', mixed: 'مختلط' };
export const TARGET_KINDS: Record<string, string> = { quantitative: 'كمي', qualitative: 'نوعي', time: 'زمني' };
export const RESOURCE_KINDS: Record<string, string> = { human: 'بشري', material: 'مادي', financial: 'مالي' };
export const DIRECTION: Record<string, string> = { up: 'الأعلى أفضل', down: 'الأقل أفضل' };
export const AGGREGATION: Record<string, string> = { last: 'آخر قراءة', sum: 'مجموع الفترات (تراكمي)', avg: 'متوسط الفترات' };
export const REF_SYSTEMS: Record<string, string> = { projects: 'مشروع', capital_budget: 'موازنة رأسمالية', risk: 'خطر', risk_analysis: 'تحليل', audit: 'توصية مراجعة', hr_performance: 'أداء وظيفي' };

export function periodsOf(year: number, p: string): string[] {
  if (p === 'annual') return [String(year)];
  if (p === 'semiannual') return [`${year}-H1`, `${year}-H2`];
  if (p === 'quarterly') return [1, 2, 3, 4].map((q) => `${year}-Q${q}`);
  return Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, '0')}`);
}
export function periodLabel(s: string) {
  if (s.length === 4) return s;
  const y = s.slice(0, 4);
  if (s[5] === 'H') return `${s[6] === '1' ? 'ن1' : 'ن2'} ${y}`;
  if (s[5] === 'Q') return `ر${s[6]} ${y}`;
  return `${s.slice(5)}/${y}`;
}

export interface Item {
  id: string; planId: string; parentId: string | null; level: number; code: string; title: string; description: string | null; ownerUserId: string | null; ownerName: string | null;
  unitId: string | null; unitName: string | null; participants: { id: string; name: string }[]; startDate: string | null; endDate: string | null; weight: number;
  targets: any[]; milestones: { title: string; dueDate: string | null; done: boolean; doneDate?: string | null }[]; resources: any[]; costByYear: Record<string, number>;
  plannedCost: number; fundingType: string | null; costCenterId: string | null; costCenterName: string | null; customValues: Record<string, any>;
  progress: number; state: string; progressNote: string | null; correctiveAction: string | null; carriedFromId: string | null; carriedToId: string | null; sortOrder: number;
  rolledProgress: number; plannedProgress: number | null; rolledCost: number; rolledCostByYear: Record<string, number>; execStatus: string; progressSource: 'own' | 'children' | 'links';
  performance: number | null; refs: any[]; updates: any[]; hasChildren: boolean;
}
