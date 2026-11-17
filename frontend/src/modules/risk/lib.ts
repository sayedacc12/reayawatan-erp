import { ref } from 'vue';
import { api } from '../../api';

export const P = {
  read: 'risk.dashboard.read', register: 'risk.register.manage', approveRegister: 'risk.register.approve', analysis: 'risk.analysis.manage',
  change: 'risk.change.manage', approveChange: 'risk.change.approve', compliance: 'risk.compliance.manage', approveCompliance: 'risk.compliance.approve',
  continuity: 'risk.continuity.manage', activateCrisis: 'risk.crisis.activate', methodologies: 'risk.methodologies.manage', procedures: 'risk.procedures.manage',
  approveProcedures: 'risk.procedures.approve', guide: 'risk.guide.manage', policy: 'risk.policy.manage', reports: 'risk.reports.read', settings: 'risk.settings.manage',
} as const;

export interface ScaleLevel { value: number; name: string; description: string }
export interface Level { key: string; name: string; min: number; color: string; action: string; reviewDays: number }
export interface Stage { name: string; roleId: string | null }
export interface RiskConfig {
  likelihood: ScaleLevel[]; impact: ScaleLevel[]; levels: Level[]; appetite: number; categories: { code: string; name: string }[];
  changeTypes: { code: string; name: string }[]; authorities: string[]; workflows: Record<string, Stage[]>;
}
export interface ConfigPayload { config: RiskConfig; defaults: RiskConfig; processes: Record<string, string>; pestel: { code: string; name: string }[]; swot: { code: string; name: string }[] }
export interface WfLog { action: string; stage: string | null; byName: string; at: string; note: string | null }
export interface WfFields { status: string; stageName: string | null; stages: string[]; canDecide: boolean; approvals: WfLog[]; revision: number; stageIndex: number | null }
export interface Lookups { units: { id: string; name: string; level: number }[]; users: { id: string; fullName: string }[]; roles: { id: string; name: string }[]; risks: { id: string; code: string; title: string; residualScore: number; riskState: string }[] }

/** الإعدادات تُحمّل مرة وتُشارك بين الشاشات */
const cfgCache = ref<ConfigPayload | null>(null);
export async function loadConfig(force = false) {
  if (!cfgCache.value || force) cfgCache.value = await api<ConfigPayload>('/risk/config');
  return cfgCache.value;
}
export const loadLookups = () => api<Lookups>('/risk/lookups');

export function levelOf(cfg: RiskConfig, score: number): Level {
  const sorted = [...cfg.levels].sort((a, b) => b.min - a.min);
  return sorted.find((l) => score >= l.min) ?? sorted[sorted.length - 1];
}

export const fmtDate = (d: string | null | undefined) =>
  d ? new Date(`${d.slice(0, 10)}T00:00:00`).toLocaleDateString('ar-SA-u-ca-gregory', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';
export const fmtDateTime = (d: string | null | undefined) =>
  d ? new Date(d).toLocaleString('ar-SA-u-ca-gregory', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';
export const hijri = (d: string | null | undefined) =>
  d ? new Date(`${d.slice(0, 10)}T00:00:00`).toLocaleDateString('ar-SA-u-ca-islamic-umalqura', { day: 'numeric', month: 'long', year: 'numeric' }) : '';
export const todayStr = () => new Date(Date.now() + 3 * 3600_000).toISOString().slice(0, 10);
export const addDays = (n: number) => new Date(Date.now() + 3 * 3600_000 + n * 86400000).toISOString().slice(0, 10);
export const num = (n: number | null | undefined) => (n ?? 0).toLocaleString('ar-SA', { maximumFractionDigits: 1 });
export const errMsg = (e: unknown) => (e as Error).message;

export const WF_STATUS: Record<string, { label: string; color: string }> = {
  draft: { label: 'مسودة', color: '#94a3b8' }, in_review: { label: 'قيد الاعتماد', color: '#f59e0b' }, returned: { label: 'مُرجع للتعديل', color: '#f97316' },
  approved: { label: 'معتمد', color: '#10b981' }, rejected: { label: 'مرفوض', color: '#ef4444' },
};
export const WF_ACTION: Record<string, string> = { submit: 'رفع للاعتماد', approve: 'اعتماد', return: 'إرجاع', reject: 'رفض', reopen: 'إعادة فتح للتعديل' };
export const SOURCES: Record<string, { label: string; color: string; hint: string }> = {
  internal: { label: 'داخلي', color: '#6366f1', hint: 'ينشأ من العمليات والأفراد والأنظمة والحوكمة' },
  external: { label: 'خارجي', color: '#0ea5e9', hint: 'ينشأ من البيئة المحيطة: الأنظمة والاقتصاد والمانحين والكوارث' },
  product: { label: 'منتج / خدمة', color: '#d946ef', hint: 'يرتبط ببرامج الجمعية وخدماتها ومشاريعها وسلامة المستفيدين' },
};
export const TREATMENTS: Record<string, { label: string; hint: string }> = {
  avoid: { label: 'تجنب', hint: 'إيقاف النشاط المسبب للخطر' }, reduce: { label: 'تخفيف', hint: 'ضوابط وإجراءات تقلل الاحتمالية أو الأثر' },
  transfer: { label: 'نقل', hint: 'تأمين أو تعاقد مع طرف آخر' }, accept: { label: 'قبول', hint: 'قبول الخطر بمبرر موثق' },
};
export const RISK_STATES: Record<string, { label: string; color: string }> = {
  open: { label: 'مفتوح', color: '#ef4444' }, treating: { label: 'قيد المعالجة', color: '#f59e0b' }, monitoring: { label: 'تحت المراقبة', color: '#0ea5e9' }, closed: { label: 'مغلق', color: '#94a3b8' },
};
export const ACTION_STATUS: Record<string, string> = { planned: 'مخطط', in_progress: 'قيد التنفيذ', done: 'منجز' };
export const CONTROL_TYPES: Record<string, string> = { preventive: 'وقائي', detective: 'كاشف', corrective: 'تصحيحي', directive: 'توجيهي' };
export const EFFECTIVENESS: Record<string, { label: string; color: string }> = {
  effective: { label: 'فعّال', color: '#10b981' }, partial: { label: 'فعّال جزئيًا', color: '#f59e0b' }, ineffective: { label: 'غير فعّال', color: '#ef4444' }, not_tested: { label: 'لم يُختبر', color: '#94a3b8' },
};
export const FREQUENCIES: Record<string, string> = { once: 'مرة واحدة', monthly: 'شهري', quarterly: 'ربع سنوي', semiannual: 'نصف سنوي', annual: 'سنوي', continuous: 'مستمر' };
export const RESULTS: Record<string, { label: string; color: string }> = {
  compliant: { label: 'ممتثل', color: '#10b981' }, partial: { label: 'ممتثل جزئيًا', color: '#f59e0b' }, non_compliant: { label: 'غير ممتثل', color: '#ef4444' }, not_applicable: { label: 'لا ينطبق', color: '#94a3b8' },
};
export const PHASES: Record<string, { label: string; color: string }> = {
  request: { label: 'طلب', color: '#94a3b8' }, implementing: { label: 'قيد التنفيذ', color: '#0ea5e9' }, completed: { label: 'مكتمل', color: '#10b981' }, closed: { label: 'مغلق', color: '#475569' },
};
export const PRIORITIES: Record<string, { label: string; color: string }> = {
  low: { label: 'منخفضة', color: '#10b981' }, medium: { label: 'متوسطة', color: '#0ea5e9' }, high: { label: 'عالية', color: '#f97316' }, urgent: { label: 'عاجلة', color: '#ef4444' },
};
export const CHANGE_CLASSES: Record<string, { label: string; hint: string }> = {
  standard: { label: 'قياسي', hint: 'متكرر ومنخفض المخاطر بإجراء معتمد مسبقًا' }, normal: { label: 'عادي', hint: 'يمر بكل مراحل التقييم والاعتماد' },
  emergency: { label: 'طارئ', hint: 'يُنفذ عاجلًا ويُستكمل اعتماده بعد التنفيذ' },
};
export const TASK_STATUS: Record<string, { label: string; color: string }> = {
  open: { label: 'جديدة', color: '#94a3b8' }, in_progress: { label: 'قيد التنفيذ', color: '#0ea5e9' }, done: { label: 'منجزة', color: '#10b981' }, cancelled: { label: 'ملغاة', color: '#475569' },
};
export const TEAM_KINDS: Record<string, string> = { crisis: 'إدارة الأزمات', disaster: 'الكوارث والطوارئ', recovery: 'التعافي واستعادة الأعمال' };
export const SEVERITY: Record<string, { label: string; color: string }> = { minor: { label: 'محدودة', color: '#f59e0b' }, major: { label: 'كبيرة', color: '#f97316' }, critical: { label: 'حرجة', color: '#ef4444' } };
export const DEP_KINDS: Record<string, string> = { people: 'أفراد', system: 'أنظمة', supplier: 'موردون', facility: 'مبانٍ ومرافق', data: 'بيانات' };
export const DOMAINS: Record<string, string> = { risk: 'المخاطر', change: 'التغيير', compliance: 'الالتزام', continuity: 'الاستمرارية', procedures: 'الإجراءات', other: 'أخرى' };
export const IMPACT_AREAS = ['الأفراد', 'العمليات والإجراءات', 'الأنظمة والتقنية', 'التكلفة والميزانية', 'المستفيدون', 'الالتزام النظامي'];
export const BIA_IMPACTS: { key: 'financial' | 'beneficiaries' | 'reputation' | 'legal' | 'operational'; label: string }[] = [
  { key: 'financial', label: 'مالي' }, { key: 'beneficiaries', label: 'المستفيدون' }, { key: 'reputation', label: 'السمعة' }, { key: 'legal', label: 'نظامي' }, { key: 'operational', label: 'تشغيلي' },
];
export const hours = (h: number | null | undefined) => (h == null ? '—' : h < 24 ? `${h} ساعة` : h % 24 === 0 ? `${h / 24} يوم` : `${(h / 24).toFixed(1)} يوم`);
