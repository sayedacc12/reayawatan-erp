import type { AttendanceConfig } from './entities/hr.entity';

export const DEFAULT_ATTENDANCE: AttendanceConfig = { enabled: false, workStart: '08:00', workEnd: '15:00', weekend: [5, 6], holidays: [] };

export type DayStatus = 'present' | 'absent' | 'weekend' | 'holiday' | 'leave' | 'not_employed' | 'no_data';
export const DAY_STATUS_AR: Record<DayStatus, string> = {
  present: 'حاضر', absent: 'غائب', weekend: 'راحة أسبوعية', holiday: 'عطلة رسمية', leave: 'إجازة', not_employed: 'خارج مدة الخدمة', no_data: 'لم تصل بياناته بعد',
};

export interface DayResult {
  date: string; weekday: number; status: DayStatus; holiday: string | null;
  checkIn: string | null; checkOut: string | null; punches: number;
  /** دقائق التأخير والخروج المبكر الفعلية */
  late: number; early: number;
  /** ما يُحتسب للخصم منها بعد فترة السماح */
  deductible: number; missingOut: boolean;
}

export interface MonthResult {
  days: DayResult[]; workDays: number; presentDays: number; absentDays: number; leaveDays: number;
  lateMinutes: number; earlyMinutes: number; deductibleMinutes: number; missingOut: number;
}

const minutes = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
const addDay = (d: string, n = 1) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);

/**
 * حضور موظف خلال شهر: لكل يوم عمل (ليس راحة ولا عطلة ولا إجازة معتمدة) أول بصمة حضور وآخر بصمة انصراف.
 * لا بصمة = غياب. بصمة واحدة = انصراف ناقص (لا يُحسب خروج مبكر). الأيام بعد آخر يوم وصلت بياناته لا تُحتسب.
 */
export function attendanceMonth(o: {
  month: string; from: string; to: string; coverageEnd: string | null; cfg: AttendanceConfig; graceMinutes: number;
  leaves: { startDate: string; endDate: string }[]; punches: Map<string, string[]>;
}): MonthResult {
  const start = `${o.month}-01`;
  const days: DayResult[] = [];
  const holidays = new Map(o.cfg.holidays.map((h) => [h.date, h.name]));
  const ws = minutes(o.cfg.workStart);
  const we = minutes(o.cfg.workEnd);
  for (let d = start; d.slice(0, 7) === o.month; d = addDay(d)) {
    const weekday = new Date(`${d}T00:00:00Z`).getUTCDay();
    const list = (o.punches.get(d) ?? []).slice().sort();
    const row: DayResult = {
      date: d, weekday, status: 'present', holiday: holidays.get(d) ?? null, checkIn: list[0] ?? null, checkOut: list.length > 1 ? list[list.length - 1] : null,
      punches: list.length, late: 0, early: 0, deductible: 0, missingOut: false,
    };
    if (d < o.from || d > o.to) row.status = 'not_employed';
    else if (holidays.has(d)) row.status = 'holiday';
    else if (o.cfg.weekend.includes(weekday)) row.status = 'weekend';
    else if (o.leaves.some((l) => l.startDate <= d && l.endDate >= d)) row.status = 'leave';
    else if (!list.length) row.status = !o.coverageEnd || d > o.coverageEnd ? 'no_data' : 'absent';
    else {
      row.late = Math.max(0, minutes(list[0]) - ws);
      row.missingOut = list.length < 2;
      row.early = row.checkOut ? Math.max(0, we - minutes(row.checkOut)) : 0;
      row.deductible = (row.late > o.graceMinutes ? row.late : 0) + (row.early > o.graceMinutes ? row.early : 0);
    }
    days.push(row);
  }
  const count = (s: DayStatus) => days.filter((x) => x.status === s).length;
  const sum = (k: 'late' | 'early' | 'deductible') => days.reduce((s, x) => s + x[k], 0);
  return {
    days, workDays: count('present') + count('absent'), presentDays: count('present'), absentDays: count('absent'), leaveDays: count('leave'),
    lateMinutes: sum('late'), earlyMinutes: sum('early'), deductibleMinutes: sum('deductible'), missingOut: days.filter((x) => x.missingOut).length,
  };
}

/** يكمل إعدادات الحضور المحفوظة بالقيم الافتراضية */
export function attendanceConfig(saved: Partial<AttendanceConfig> | null | undefined): AttendanceConfig {
  return { ...DEFAULT_ATTENDANCE, ...(saved ?? {}) };
}
