import { DataSource, EntityManager } from 'typeorm';
import { Organization } from '../entities';
import { addDays, todayRiyadh } from '../organizations/org-access';

/** إعدادات دورة حياة الجمعيات في platform_settings (المفتاح lifecycle) */
export interface LifecycleSettings {
  /** أيام المهلة بعد نهاية الفترة التجريبية قبل حذف الجمعية وبياناتها */
  trialGraceDays: number;
}
export const DEFAULT_LIFECYCLE: LifecycleSettings = { trialGraceDays: 14 };

export async function lifecycleSettings(db: DataSource | EntityManager): Promise<LifecycleSettings> {
  const [row] = await db.query(`SELECT value FROM platform_settings WHERE key = 'lifecycle'`);
  return { ...DEFAULT_LIFECYCLE, ...(row?.value ?? {}) };
}

export const daysBetween = (from: string, to: string) =>
  Math.round((new Date(`${to}T00:00:00Z`).getTime() - new Date(`${from}T00:00:00Z`).getTime()) / 86400000);

export interface DeletionNotice {
  reason: 'trial' | 'trial_expired' | 'mutual';
  /** آخر يوم في التجربة (للتجربة) */
  trialEndsOn: string | null;
  /** يوم الحذف */
  deleteOn: string;
  daysToTrialEnd: number | null;
  daysToDelete: number;
}

type Org = Pick<Organization, 'id' | 'slug' | 'subscriptionStatus' | 'trialEndsOn'>;

/**
 * موعد حذف الجمعية إن وُجد: إنهاء بالتراضي مجدول، أو جمعية في فترة تجربة (تُحذف بعد نهاية التجربة بالمهلة).
 * الجمعية التجريبية العامة (demo) لا تُحذف تلقائيًا.
 */
export async function deletionNotice(db: DataSource | EntityManager, org: Org, today = todayRiyadh()): Promise<DeletionNotice | null> {
  const [closure] = await db.query(
    `SELECT delete_on::text AS delete_on FROM organization_closures WHERE organization_id = $1 AND status = 'scheduled' ORDER BY created_at DESC LIMIT 1`, [org.id]);
  if (closure) {
    return { reason: 'mutual', trialEndsOn: null, deleteOn: closure.delete_on, daysToTrialEnd: null, daysToDelete: Math.max(0, daysBetween(today, closure.delete_on)) };
  }
  if (org.subscriptionStatus !== 'trial' || !org.trialEndsOn || org.slug === 'demo') return null;
  const s = await lifecycleSettings(db);
  const deleteOn = addDays(org.trialEndsOn, s.trialGraceDays + 1);
  return {
    reason: org.trialEndsOn < today ? 'trial_expired' : 'trial',
    trialEndsOn: org.trialEndsOn, deleteOn,
    daysToTrialEnd: Math.max(0, daysBetween(today, org.trialEndsOn)),
    daysToDelete: Math.max(0, daysBetween(today, deleteOn)),
  };
}

const arDate = (d: string) => new Intl.DateTimeFormat('ar-SA-u-nu-latn-ca-gregory', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${d}T00:00:00Z`));
const days = (n: number) => (n === 0 ? 'اليوم' : n === 1 ? 'بعد يوم واحد' : n === 2 ? 'بعد يومين' : n <= 10 ? `بعد ${n} أيام` : `بعد ${n} يومًا`);

/** رسالة صفحة الدخول بعد توقف الجمعية، توضح موعد حذف بياناتها */
export function loginDeletionText(n: DeletionNotice): string {
  if (n.reason === 'mutual') return `أُنهي عقد الجمعية بالتراضي، وستُحذف الجمعية وكل بياناتها نهائيًا ${days(n.daysToDelete)} (${arDate(n.deleteOn)}).`;
  return `انتهت الفترة التجريبية للجمعية. ستُحذف الجمعية وكل بياناتها نهائيًا ${days(n.daysToDelete)} (${arDate(n.deleteOn)}) ما لم يتم التعاقد. تواصل مع إدارة المنصة.`;
}
