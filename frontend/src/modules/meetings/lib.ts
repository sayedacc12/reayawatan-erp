import { api } from '../../api';
import type { Person } from '../comms/lib';

export { fmtDate, fmtDateTime, todayStr, addDays, dueText } from '../comms/lib';

export const P = {
  read: 'meetings.dashboard.read', ga: 'meetings.general_assembly.read', board: 'meetings.board.read', committees: 'meetings.committees.read', teams: 'meetings.teams.read',
  manage: 'meetings.secretariat.manage', teamsManage: 'meetings.teams.manage', approve: 'meetings.plans.approve', reports: 'meetings.reports.read', settings: 'meetings.settings.manage',
} as const;

export const KINDS = [
  { value: 'general_assembly', label: 'الجمعية العمومية', short: 'العمومية', color: '#e8b04b', perm: P.ga, hint: 'الاجتماعات العادية وغير العادية لأعضاء الجمعية العمومية من سجل العضوية.' },
  { value: 'board', label: 'مجلس الإدارة', short: 'المجلس', color: '#14b8a6', perm: P.board, hint: 'اجتماعات مجلس الإدارة وقراراته.' },
  { value: 'committee', label: 'اللجان المتخصصة', short: 'اللجان', color: '#6366f1', perm: P.committees, hint: 'اللجنة التنفيذية ولجنة المراجعة وغيرها من اللجان.' },
  { value: 'team', label: 'فرق العمل', short: 'الفرق', color: '#0ea5e9', perm: P.teams, hint: 'اجتماعات الفرق الداخلية والإدارات.' },
] as const;
export const kindOf = (k: string) => KINDS.find((x) => x.value === k) ?? KINDS[3];

export const STATUS_COLOR: Record<string, string> = {
  draft: '#94a3b8', pending_approval: '#f59e0b', scheduled: '#0ea5e9', in_progress: '#ef4444', held: '#8b5cf6', signing: '#6366f1', adopted: '#10b981', cancelled: '#94a3b8',
};
export const ROLES = [
  { value: 'chair', label: 'الرئيس' }, { value: 'vice', label: 'نائب الرئيس' }, { value: 'secretary', label: 'أمين السر' }, { value: 'member', label: 'عضو' },
  { value: 'rapporteur', label: 'مقرر' }, { value: 'advisor', label: 'مستشار' },
];
export const STEPS = [
  { s: 'draft', l: 'التخطيط' }, { s: 'pending_approval', l: 'الاعتماد' }, { s: 'scheduled', l: 'الدعوات' }, { s: 'in_progress', l: 'الانعقاد' },
  { s: 'held', l: 'المحضر' }, { s: 'signing', l: 'التوقيع' }, { s: 'adopted', l: 'الاعتماد النهائي' },
];
export const HIST_AR: Record<string, string> = {
  create: 'أنشأ الخطة', update: 'عدّل الخطة', submit: 'رفع الخطة للاعتماد', approve: 'اعتمد الخطة وأُرسلت الدعوات', return: 'أعاد الخطة للتعديل', cancel: 'ألغى الاجتماع',
  start: 'بدأ الاجتماع', end: 'أنهى الاجتماع', issue: 'أصدر المحضر للتوقيع', recall: 'سحب المحضر للتعديل', wet: 'رفع النسخة الموقعة يدويًا', finalize: 'اعتمد المحضر بعد المهلة',
  adopt: 'اعتُمد المحضر', guest: 'أضاف مدعوًا', remove: 'أزال مدعوًا', reschedule: 'غيّر الموعد', link: 'أصدر رابط توقيع',
};

export interface Assembly { id: string; fullName: string; mobile: string | null; email: string | null; memberNo: number; voting: boolean }
export interface Lookups {
  people: Person[]; units: { id: string; parentId: string | null; level: number; name: string }[]; assembly: Assembly[];
  labels: { kinds: Record<string, string>; roles: Record<string, string> };
  can: { manage: boolean; teams: boolean; approve: boolean };
}
export interface BodyMember { key?: string; type: 'user' | 'member' | 'external'; userId: string | null; memberId: string | null; name: string; role: string; roleLabel?: string; title: string | null; mobile: string | null; email: string | null; voting: boolean }
export interface Body {
  id: string; kind: string; kindLabel: string; code: string; name: string; description: string | null; unitId: string | null; approverUserId: string | null; approverName: string | null;
  secretaryUserId: string | null; secretaryName: string | null; members: BodyMember[]; votingCount: number; quorumPercent: number; isConfidential: boolean;
  termStart: string | null; termEnd: string | null; isActive: boolean; stats: { total: number; upcoming: number; last: string | null }; canOrganize: boolean; canEdit: boolean;
}
export interface MeetingRow {
  id: string; refNo: string; title: string; kind: string; kindLabel: string; typeLabel: string; mode: string; modeLabel: string; location: string | null; date: string;
  startTime: string; endTime: string | null; status: string; statusLabel: string; isConfidential: boolean; quorumMet: boolean | null; bodyName: string; bodyCode: string;
  invited: number; accepted: number; present: number; signed: number; signers: number; items: number; recs: number; myRsvp: string | null; myRsvpLabel: string | null; mySign: string | null;
}
export interface DecisionRow {
  id: string; kind: string; text: string; ownerName: string | null; dueDate: string | null; votes: { for: number; against: number; abstain: number } | null;
  taskId: string | null; taskRef: string | null; taskStatus: string | null; progress: number | null; overdue: boolean;
  meetingId: string; refNo: string; meetingTitle: string; kindLabel: string; date: string; bodyName: string; item: string; seq: number;
}
export interface Snapshot {
  organization: string; body: string; kind: string; refNo: string; title: string; type: string; mode: string; location: string | null; date: string; startTime: string; endTime: string | null;
  version: number; quorum: { required: number; voting: number; present: number; met: boolean | null };
  attendees: { name: string; role: string; title: string | null; guest: boolean; attendance: string }[]; opening: string | null; closing: string | null;
  items: { seq: number; title: string; presenter: string | null; discussion: string | null; status: string;
    recommendations: { seq: number; kind: string; text: string; owner: string | null; supporters: string[]; dueDate: string | null; votes: { for: number; against: number; abstain: number } | null }[] }[];
}

let cached: Promise<Lookups> | null = null;
export function loadLookups(force = false) {
  if (!cached || force) cached = api<Lookups>('/meetings/lookups').catch((e) => { cached = null; throw e; });
  return cached;
}
export const timeText = (t: string | null | undefined) => (t ? t.slice(0, 5) : '');
