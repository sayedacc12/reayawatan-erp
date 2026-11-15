import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { AccountingSettings, FiscalYear, PeriodLock, VOUCHER_TYPES, VoucherType } from './entities/accounting.entity';

/** المبالغ تُحسب بالهللات لتجنب أخطاء الكسور */
export const cents = (n: number | string | null | undefined) => Math.round(Number(n ?? 0) * 100);
export const fromCents = (c: number) => Math.round(c) / 100;
export const fmtSar = (c: number) => `${fromCents(c).toLocaleString('en-US', { minimumFractionDigits: 2 })} ريال`;

/** تاريخ اليوم بتوقيت الرياض */
export const today = () => new Date(Date.now() + 3 * 3600_000).toISOString().slice(0, 10);
export const monthOf = (date: string) => date.slice(0, 7);

export function addDays(date: string, days: number) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
export function addMonths(date: string, months: number) {
  const d = new Date(`${date}T00:00:00Z`);
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + months);
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, last));
  return d.toISOString().slice(0, 10);
}
/** شهور السنة المالية بصيغة YYYY-MM */
export function monthsBetween(start: string, end: string) {
  const out: string[] = [];
  let m = `${monthOf(start)}-01`;
  while (monthOf(m) <= monthOf(end)) {
    out.push(monthOf(m));
    m = addMonths(m, 1);
  }
  return out;
}

export const VOUCHER_LABEL: Record<VoucherType, string> = {
  journal: 'قيد يومية', receipt: 'سند قبض', payment: 'سند صرف', opening: 'قيد افتتاحي', adjustment: 'قيد تسوية',
};
/** سندات القبض والصرف تسلسلها مستمر بين السنوات، وباقي السندات تبدأ من 1 كل سنة متبوعة بالسنة */
export const CONTINUOUS: VoucherType[] = ['receipt', 'payment'];
export const voucherNo = (type: VoucherType, serial: number, year: number) =>
  CONTINUOUS.includes(type) ? String(serial) : `${serial}/${year}`;

export const ALL_VOUCHER_TYPES = VOUCHER_TYPES;

/**
 * مصدر أرقام كل نوع سند: سندات القبض والصرف أرقامها في جدول السندات (قد يتكرر رقمها في القيود بعد العكس وإعادة الاعتماد)،
 * وباقي الأنواع في جدول القيود. الحالات موحّدة: posted مرحّل، cancelled ملغي، draft لم يكتمل.
 */
export function serialSource(type: VoucherType) {
  return CONTINUOUS.includes(type)
    ? {
      sql: `SELECT serial AS voucher_serial,
                   CASE WHEN status = 'approved' THEN 'posted' WHEN status IN ('cancelled', 'rejected') THEN 'cancelled' ELSE 'draft' END AS status
              FROM acc_vouchers WHERE fiscal_year_id = $1 AND kind = '${type}'`,
    }
    : { sql: `SELECT voucher_serial, status FROM acc_entries WHERE fiscal_year_id = $1 AND voucher_type = '${type}'` };
}

/**
 * أساس النظام المحاسبي: الإعدادات، والسنة المالية التي يقع فيها التاريخ،
 * والتحقق من أن الفترة مفتوحة للتسجيل.
 */
@Injectable()
export class AccCore {
  constructor(private readonly db: DataSource) {}

  async settings(org: string, em: EntityManager = this.db.manager): Promise<AccountingSettings> {
    const repo = em.getRepository(AccountingSettings);
    let s = await repo.findOne({ where: { organizationId: org } });
    if (!s) {
      await repo.createQueryBuilder().insert().values({ organizationId: org }).orIgnore().execute();
      s = await repo.findOneOrFail({ where: { organizationId: org } });
    }
    return s;
  }

  /** حجز رقم القيد الرئيسي التالي (رمز 1) */
  async nextEntryNo(em: EntityManager, org: string) {
    await this.settings(org, em);
    const [row] = await em.query(
      'UPDATE acc_settings SET next_entry_no = next_entry_no + 1 WHERE organization_id = $1 RETURNING next_entry_no - 1 AS no',
      [org],
    );
    return Number(row[0]?.no ?? row.no);
  }

  async years(org: string, em: EntityManager = this.db.manager) {
    return em.getRepository(FiscalYear).find({ where: { organizationId: org }, order: { startDate: 'ASC' } });
  }

  async year(org: string, id: string, em: EntityManager = this.db.manager) {
    const y = await em.getRepository(FiscalYear).findOne({ where: { id, organizationId: org } });
    if (!y) throw new NotFoundException('السنة المالية غير موجودة');
    return y;
  }

  /** السنة المالية التي يقع فيها التاريخ */
  async yearOf(org: string, date: string, em: EntityManager = this.db.manager) {
    const y = await em.getRepository(FiscalYear).createQueryBuilder('y')
      .where('y.organization_id = :org AND :d BETWEEN y.start_date AND y.end_date', { org, d: date }).getOne();
    if (!y) throw new BadRequestException(`لا توجد سنة مالية مفتوحة تشمل التاريخ ${date}. افتح السنة المالية من شاشة الافتتاحيات أولًا`);
    return y;
  }

  async isMonthLocked(org: string, month: string, em: EntityManager = this.db.manager) {
    return em.getRepository(PeriodLock).exists({ where: { organizationId: org, month } });
  }

  /** يرفض أي تسجيل أو تعديل في سنة مغلقة أو شهر مغلق */
  async assertWritable(org: string, date: string, em: EntityManager = this.db.manager) {
    const y = await this.yearOf(org, date, em);
    if (y.status === 'closed') {
      throw new ConflictException(`السنة المالية ${y.name} مغلقة، لا يمكن التعديل عليها ولا إدخال معاملات جديدة بها إلا بعد فتحها من صاحب الصلاحية`);
    }
    if (await this.isMonthLocked(org, monthOf(date), em)) {
      throw new ConflictException(`شهر ${monthOf(date)} مغلق، لا يمكن التسجيل أو التعديل أو فك الترحيل فيه إلا بعد فك إغلاقه`);
    }
    return y;
  }
}
