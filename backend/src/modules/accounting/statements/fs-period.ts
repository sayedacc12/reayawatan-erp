import { BadRequestException } from '@nestjs/common';
import { addDays, addMonths, monthsBetween } from '../acc-core.service';
import { FiscalYear } from '../entities/accounting.entity';

export type Span = 'M' | 'Q' | 'H' | 'Y';
export const SPANS: Span[] = ['M', 'Q', 'H', 'Y'];
export const MONTHS_AR = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];
const ORD = ['الأول', 'الثاني', 'الثالث', 'الرابع'];

export interface FsPeriod {
  year: FiscalYear;
  span: Span;
  part: number;
  /** مفتاح الفترة داخل السنة المالية: Y أو Q1..Q4 أو H1..H2 أو M01..M12 */
  key: string;
  label: string;
  /** وصف قصير للعناوين: «للفترة من ... إلى ...» */
  range: string;
  from: string;
  to: string;
  /** شهور السنة من بدايتها حتى نهاية الفترة (كلها يجب أن تكون مغلقة قبل الإصدار النهائي) */
  months: string[];
  startsYear: boolean;
  endsYear: boolean;
}

const monthName = (ym: string) => `${MONTHS_AR[Number(ym.slice(5, 7)) - 1]} ${ym.slice(0, 4)}`;
export const dmy = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}`;

/**
 * الفترة المطلوبة داخل سنة مالية: شهر أو ربع أو نصف أو السنة كاملة، محسوبة من شهور السنة المالية نفسها
 * (فتعمل السنة المالية التي لا تبدأ في يناير).
 */
export function fsPeriod(year: FiscalYear, span: Span, part = 1): FsPeriod {
  const all = monthsBetween(year.startDate, year.endDate);
  const size = span === 'M' ? 1 : span === 'Q' ? 3 : span === 'H' ? 6 : all.length;
  const parts = Math.ceil(all.length / size);
  if (!SPANS.includes(span)) throw new BadRequestException('نوع الفترة غير صحيح');
  if (span === 'Y') part = 1;
  if (!Number.isInteger(part) || part < 1 || part > parts) throw new BadRequestException('رقم الفترة خارج السنة المالية');
  const ms = all.slice((part - 1) * size, part * size);
  const from = (part === 1 ? year.startDate : `${ms[0]}-01`);
  const lastMonthEnd = addDays(addMonths(`${ms[ms.length - 1]}-01`, 1), -1);
  const to = lastMonthEnd > year.endDate ? year.endDate : lastMonthEnd;
  const key = span === 'Y' ? 'Y' : span === 'M' ? `M${String(part).padStart(2, '0')}` : `${span}${part}`;
  const span2 = ms.length > 1 ? `${monthName(ms[0])} – ${monthName(ms[ms.length - 1])}` : monthName(ms[0]);
  const label = span === 'Y' ? `السنة المالية ${year.name}`
    : span === 'M' ? `شهر ${monthName(ms[0])}`
      : span === 'Q' ? `الربع ${ORD[part - 1]} من السنة المالية ${year.name} (${span2})`
        : `النصف ${ORD[part - 1]} من السنة المالية ${year.name} (${span2})`;
  return {
    year, span, part, key, label, from, to,
    range: `للفترة من ${dmy(from)} إلى ${dmy(to)}`,
    months: all.slice(0, all.indexOf(ms[ms.length - 1]) + 1),
    startsYear: from === year.startDate, endsYear: to === year.endDate,
  };
}

/** نفس الفترة في السنة المالية السابقة (للمقارنة) */
export function priorRange(p: FsPeriod, prev: FiscalYear) {
  const shift = (d: string, end: boolean) => {
    const x = addMonths(d, -12);
    return end ? addDays(addMonths(`${x.slice(0, 7)}-01`, 1), -1) : x;
  };
  const from = p.startsYear ? prev.startDate : shift(p.from, false);
  const to = p.endsYear ? prev.endDate : shift(p.to, true);
  return { from: from < prev.startDate ? prev.startDate : from, to: to > prev.endDate ? prev.endDate : to };
}
