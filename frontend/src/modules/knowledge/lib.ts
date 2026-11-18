export const KP = {
  read: 'knowledge.archive.read', manage: 'knowledge.archive.manage', publish: 'knowledge.archive.publish', reports: 'knowledge.reports.read', settings: 'knowledge.settings.manage',
} as const;
export const TYPE_ICON: Record<string, string> = {
  regulation: '§', policy: '◆', procedure: '⇄', guide: '☰', form: '▤', study: '◎', report: '▦', lesson: '✦', training: '✎', media: '◐', other: '•',
};
export const STATUS_COLOR: Record<string, string> = { draft: '#94a3b8', published: '#10b981', archived: '#64748b' };
export const fmtDate = (d: string | null | undefined) =>
  d ? new Date(`${String(d).slice(0, 10)}T00:00:00`).toLocaleDateString('ar-SA-u-ca-gregory', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';
export const fmtDateTime = (d: string | null | undefined) =>
  d ? new Date(d).toLocaleString('ar-SA-u-ca-gregory', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—';
export interface DocRow {
  id: string; code: string | null; title: string; docType: string; typeLabel: string; categoryId: string | null; categoryName: string | null; categoryColor: string;
  summary: string | null; tags: string[]; version: string; issuedOn: string | null; reviewOn: string | null; ownerName: string | null; status: string; statusLabel: string;
  visibility: string; hasFile: boolean; fileName: string | null; externalUrl: string | null; hasContent: boolean; views: number; downloads: number; reviewDue: boolean; updatedAt: string;
}
export const todayStr = () => new Date(Date.now() + 3 * 3600_000).toISOString().slice(0, 10);
