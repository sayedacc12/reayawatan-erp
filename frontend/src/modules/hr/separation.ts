/** إخلاء الطرف ونهاية الخدمة: أنواع وألوان مشتركة بين الشاشات */
export const SEP_COLOR: Record<string, string> = { clearance: '#f59e0b', settlement: '#6366f1', approved: '#10b981', paid: '#0ea5e9', cancelled: '#94a3b8' };
export const ITEM_COLOR: Record<string, string> = { pending: '#94a3b8', cleared: '#10b981', blocked: '#ef4444' };

export interface SepRow {
  id: string; separationNo: number; employeeId: string; employeeName: string; employeeNo: number | null; reason: string; reasonLabel: string; lastWorkingDay: string;
  status: string; statusLabel: string; items: number; cleared: number; blocked: number; net: number | null; fromRequest: boolean; createdAt: string;
}
export interface SepItem {
  code: string; name: string; description: string | null; kind: string; kindLabel: string; roleName: string | null; approverName: string | null; allowDeduction: boolean;
  status: 'pending' | 'cleared' | 'blocked'; statusLabel: string; deduction: number; note: string | null; actorName: string | null; onBehalf: boolean; at: string | null;
  can: boolean;
}
export interface Settlement {
  contractor?: boolean;
  eos: { amount: number; fullAmount: number; factor: number; wage: number; years: number; months: number; days: number; explanation: string; reasonLabel: string };
  leaveDays: number; dailyWage: number; leaveEncashment: number; advances: { advanceId: string; remaining: number }[]; advancesTotal: number;
  clearanceDeductions: number; adjustments: { kind: 'addition' | 'deduction'; label: string; amount: number }[]; gross: number; deductions: number; net: number;
  computedAt: string; computedByName: string;
}
export interface SepDetail extends Omit<SepRow, 'items'> {
  organizationName: string;
  employee: { id: string; fullName: string; employeeNo: number; nationalId: string | null; jobTitle: string; unitName: string; hireDate: string; iban: string | null };
  noticeDate: string | null; note: string | null; requestId: string | null;
  items: SepItem[];
  settlement: Settlement | null; preview: Settlement | null; plan: { problems: string[]; lines: { accountId: string; debit: number; credit: number; label: string }[] } | null;
  stages: { name: string; current: boolean; done: boolean }[];
  entry: { id: string; entryNo: number } | null; voucher: { id: string; serial: number; amount: number; status: string; statusLabel: string } | null;
  approvedAt: string | null; createdByName: string;
  /** عهدة أصول ثابتة لدى الموظف: تمنع إخلاء الطرف حتى تُستلم منه أو تُنقل */
  assetCustody?: { id: string; code: string; name: string; status: string }[];
  history: { action: string; label: string; note: string | null; actorName: string; at: string; stageName?: string | null }[];
  viewer: { hr: boolean; owner: boolean; responsible: boolean };
  can: { settle: boolean; decide: boolean; decideReason: string | null; pay: boolean; cancel: boolean };
}
