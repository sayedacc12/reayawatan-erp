import { createHash } from 'crypto';
import { BillingCycle } from '../entities/organization.entity';
import { addMonths } from '../organizations/org-access';
import { ProviderInfo } from './contract-defaults';
import { ContractItem, ContractTerms } from './entities';

export const CYCLE_LABELS: Record<BillingCycle, string> = {
  monthly: 'شهرية', quarterly: 'ربع سنوية', semiannual: 'نصف سنوية', annual: 'سنوية',
};
export const CYCLE_MONTHS: Record<BillingCycle, number> = { monthly: 1, quarterly: 3, semiannual: 6, annual: 12 };

const money = (n: number) =>
  `${new Intl.NumberFormat('ar-SA-u-nu-latn', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n)} ريال سعودي`;

/** تاريخ ميلادي مع ما يوافقه هجريًا (تقويم أم القرى)، مثل: 15/11/2026م الموافق 5 جمادى الآخرة 1448هـ */
export function formatDate(iso: string | null | undefined) {
  if (!iso) return '........';
  const d = new Date(`${iso.slice(0, 10)}T12:00:00Z`);
  const [y, m, day] = iso.slice(0, 10).split('-');
  const hijri = new Intl.DateTimeFormat('ar-SA-u-ca-islamic-umalqura-nu-latn', {
    day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC',
  }).format(d).replace(/\s*هـ$/, '');
  return `${day}/${m}/${y}م الموافق ${hijri}هـ`;
}

export function monthsLabel(n: number) {
  if (n === 1) return 'شهر واحد';
  if (n === 2) return 'شهران';
  if (n >= 3 && n <= 10) return `${n} أشهر`;
  return `${n} شهرًا`;
}

/** القيم المالية المحسوبة من شروط العقد */
export function contractAmounts(t: Pick<ContractTerms, 'price' | 'billingCycle' | 'vatRate' | 'months'>) {
  const vat = Math.round(t.price * t.vatRate) / 100;
  const cycles = Math.ceil(t.months / CYCLE_MONTHS[t.billingCycle]);
  const gross = t.price + vat;
  return { vat, gross, cycles, total: Math.round(gross * cycles * 100) / 100 };
}

export interface RenderContext {
  number: string;
  issuedOn: string;
  provider: ProviderInfo;
  org: { name: string; slug: string; licenseNumber?: string; licenseStartDate?: string; city?: string; director?: string; email?: string };
  terms: ContractTerms;
  screenLabels: string[] | null;
  origin: string;
}

export function contractVariables(c: RenderContext): Record<string, string> {
  const t = c.terms;
  const a = contractAmounts(t);
  const or = (v: string | undefined | null) => (v && v.trim() ? v : '........');
  return {
    'رقم العقد': c.number,
    'تاريخ العقد': formatDate(c.issuedOn),
    'اسم مقدم الخدمة': or(c.provider.name),
    'السجل التجاري لمقدم الخدمة': or(c.provider.crNumber),
    'الرقم الضريبي لمقدم الخدمة': or(c.provider.vatNumber),
    'عنوان مقدم الخدمة': or(c.provider.address),
    'بريد مقدم الخدمة': or(c.provider.email),
    'مدينة المحكمة المختصة': or(c.provider.courtCity),
    'اسم الجمعية': c.org.name,
    'رقم ترخيص الجمعية': or(c.org.licenseNumber),
    'تاريخ ترخيص الجمعية': formatDate(c.org.licenseStartDate),
    'مدينة الجمعية': or(c.org.city),
    'المدير التنفيذي': or(c.org.director),
    'بريد الجمعية': or(c.org.email),
    'تاريخ بداية الاشتراك': formatDate(t.startsOn),
    'تاريخ نهاية الاشتراك': formatDate(addMonths(t.startsOn, t.months)),
    'مدة الاشتراك': monthsLabel(t.months),
    'قيمة الاشتراك': money(t.price),
    'دورة السداد': CYCLE_LABELS[t.billingCycle],
    'نسبة الضريبة': `${t.vatRate}%`,
    'قيمة الضريبة': money(a.vat),
    'الإجمالي شامل الضريبة': money(a.gross),
    'إجمالي قيمة العقد': money(a.total),
    'الشاشات المشمولة': c.screenLabels ? c.screenLabels.join('، ') || 'الشاشات الأساسية فقط' : 'جميع شاشات المنصة المتاحة',
    'أيام الفترة التجريبية': String(t.trialDays),
    'رابط دخول الموظفين': `${c.origin}/o/${c.org.slug}`,
    'رابط بوابة المستفيدين': `${c.origin}/portal/${c.org.slug}`,
  };
}

/** يستبدل {{المتغير}} بقيمته، والمتغير غير المعروف يبقى كما هو ليظهر للمراجع */
export function renderItems(items: ContractItem[], vars: Record<string, string>) {
  const fill = (s: string) => s.replace(/\{\{\s*([^{}]+?)\s*\}\}/g, (m, k: string) => vars[k] ?? m);
  return items.map((i) => ({ title: fill(i.title), paragraphs: i.paragraphs.map(fill).filter((p) => p.trim()) }));
}

export function hashRendered(number: string, rendered: { title: string; paragraphs: string[] }[]) {
  return createHash('sha256').update(JSON.stringify({ number, rendered })).digest('hex');
}

/** متغيرات غير معروفة داخل البنود (للتنبيه قبل الإرسال) */
export function unknownVariables(items: ContractItem[], known: string[]) {
  const set = new Set(known);
  const found = new Set<string>();
  for (const i of items) {
    for (const s of [i.title, ...i.paragraphs]) {
      for (const m of s.matchAll(/\{\{\s*([^{}]+?)\s*\}\}/g)) if (!set.has(m[1])) found.add(m[1]);
    }
  }
  return [...found];
}
