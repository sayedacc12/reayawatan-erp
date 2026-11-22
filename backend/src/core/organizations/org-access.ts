import { Organization } from '../entities';

/** تاريخ اليوم بتوقيت الرياض بصيغة YYYY-MM-DD */
export function todayRiyadh(now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Riyadh' }).format(now);
}

export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function addMonths(date: string, months: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + months);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

type AccessFields = Pick<Organization, 'isActive' | 'subscriptionStatus' | 'trialEndsOn' | 'subscriptionEndsOn'>;

/** الحالة الفعلية للاشتراك اليوم (تشمل الانتهاء والإيقاف) */
export type EffectiveState = 'suspended' | 'trial' | 'trial_expired' | 'awaiting_contract' | 'active' | 'expired';

export function effectiveState(o: AccessFields, today = todayRiyadh()): EffectiveState {
  if (!o.isActive) return 'suspended';
  if (o.subscriptionStatus === 'trial') return o.trialEndsOn && o.trialEndsOn < today ? 'trial_expired' : 'trial';
  if (o.subscriptionStatus === 'awaiting_contract') return 'awaiting_contract';
  return o.subscriptionEndsOn && o.subscriptionEndsOn < today ? 'expired' : 'active';
}

/** سبب منع دخول الشركة، أو null لو مسموح */
export function accessProblem(o: AccessFields, today = todayRiyadh()): string | null {
  switch (effectiveState(o, today)) {
    case 'suspended': return 'حساب الشركة موقوف، تواصل مع إدارة المنصة';
    case 'trial_expired': return 'انتهت الفترة التجريبية للشركة، تواصل مع إدارة المنصة لإتمام التعاقد';
    case 'awaiting_contract': return 'حساب الشركة بانتظار توقيع عقد الاشتراك';
    case 'expired': return 'انتهى اشتراك الشركة، تواصل مع إدارة المنصة للتجديد';
    default: return null;
  }
}

/** نفس القاعدة بصيغة SQL لاستعلامات الوحدات (مثل بوابة المستفيدين). a = اسم جدول الجمعيات في الاستعلام */
export const orgAccessSql = (a: string) => `(${a}.is_active AND (
  (${a}.subscription_status = 'active' AND (${a}.subscription_ends_on IS NULL OR ${a}.subscription_ends_on >= (now() AT TIME ZONE 'Asia/Riyadh')::date))
  OR (${a}.subscription_status = 'trial' AND (${a}.trial_ends_on IS NULL OR ${a}.trial_ends_on >= (now() AT TIME ZONE 'Asia/Riyadh')::date))))`;
