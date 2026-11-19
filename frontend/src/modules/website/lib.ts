export const WP = {
  read: 'website.dashboard.read', edit: 'website.content.edit', publish: 'website.content.publish', pages: 'website.pages.manage',
  donations: 'website.donations.read', messages: 'website.messages.manage', reports: 'website.reports.read', settings: 'website.settings.manage',
} as const;
export const ICONS = [
  'heart', 'hands', 'users', 'home', 'book', 'grad', 'medal', 'shield', 'chart', 'handshake', 'eye', 'target', 'clip', 'phone', 'mail',
  'globe', 'pin', 'star', 'check', 'building', 'search', 'clock', 'megaphone', 'gift', 'food', 'water', 'health', 'bus', 'leaf', 'kaaba',
];
export const STATUS_COLOR: Record<string, string> = {
  draft: '#94a3b8', pending: '#f59e0b', returned: '#f97316', published: '#10b981', approved: '#10b981', rejected: '#ef4444',
  paid: '#10b981', failed: '#ef4444', cancelled: '#94a3b8', active: '#10b981', paused: '#f59e0b', new: '#0ea5e9', in_progress: '#f59e0b', closed: '#64748b',
};
export const num = (n: number | null | undefined) => (n ?? 0).toLocaleString('ar-SA', { maximumFractionDigits: 2 });
export const sar = (n: number | null | undefined) => `${num(n)} ر.س`;
export const fmtDate = (d: string | null | undefined) =>
  d ? new Date(`${String(d).slice(0, 10)}T00:00:00`).toLocaleDateString('ar-SA-u-ca-gregory', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';
export const fmtDateTime = (d: string | Date | null | undefined) =>
  d ? new Date(d).toLocaleString('ar-SA-u-ca-gregory', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—';
export const todayStr = () => new Date(Date.now() + 3 * 3600_000).toISOString().slice(0, 10);
export const siteUrl = (slug: string | null | undefined, path = '', preview?: string | null) =>
  `${window.location.origin}/w/${slug ?? ''}${path}${preview ? `${path.includes('?') ? '&' : '?'}preview=${preview}` : ''}`;
export async function copy(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
/** رابط واتساب لإرسال رسالة لرقم سعودي */
export const waLink = (phone: string | null | undefined, text: string) =>
  `https://wa.me/${String(phone ?? '').replace(/^0/, '966')}?text=${encodeURIComponent(text)}`;
/** صفحات الموقع التي يمكن ربط الأزرار والإعلانات بها */
export const LINK_TARGETS: Record<string, string> = {
  donate: 'صفحة التبرع', programs: 'البرامج', news: 'الأخبار', about: 'من نحن', governance: 'الحوكمة والشفافية', partners: 'الشركاء',
  contact: 'تواصل معنا', volunteer: 'التطوع', membership: 'العضوية', portal: 'بوابة المستفيدين', staff: 'بوابة الموظفين',
};
export const errMsg = (e: unknown) => (e as Error).message;
