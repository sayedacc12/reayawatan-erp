import { reactive } from 'vue';
import { api } from '../../../api';
import type { ReqRow } from './ess';

export interface Member {
  id: string; employeeNo: number; fullName: string; gender: string; jobTitle: string; unitName: string; direct: boolean; managerName: string | null;
  today: { status: string; label: string }; pending: number; hireDate: string;
}
export interface TeamData {
  position: { fullName: string; jobTitle: string; unitName: string; managedUnits: string[]; managerName: string | null };
  stats: { team: number; direct: number; onLeave: number; present: number; awaiting: number; pending: number };
  members: Member[]; awaiting: ReqRow[]; requests: ReqRow[];
}
export const TODAY_COLOR: Record<string, string> = { present: '#10b981', leave: '#6366f1', exempt: '#0ea5e9', unknown: '#cbd5e1' };

/** بيانات الفريق مشتركة بين لوحة المدير وشاشة الفريق */
export const team = reactive({ data: null as TeamData | null, error: '' });
export async function loadTeam() {
  try {
    team.data = await api<TeamData>('/hr/me/team');
    team.error = '';
  } catch (e) {
    team.error = (e as Error).message;
  }
}
export const initials = (n: string) => n.split(' ').slice(0, 2).map((w) => w.charAt(0)).join(' ');
