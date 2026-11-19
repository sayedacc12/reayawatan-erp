import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { ASSET_VOUCHER_TYPES, AccountingSettings, BuiltinVoucherType, CUSTOM_TYPE_RE, DocumentType, FiscalYear, PeriodLock, VOUCHER_TYPES, VoucherType } from './entities/accounting.entity';

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

export const VOUCHER_LABEL: Record<BuiltinVoucherType, string> = {
  journal: 'قيد يومية', receipt: 'سند قبض', payment: 'سند صرف', opening: 'قيد افتتاحي', adjustment: 'قيد تسوية',
  depreciation: 'سند إهلاك', asset: 'سند أصول ثابتة',
};
/** سندات القبض والصرف تسلسلها مستمر بين السنوات، وباقي السندات تبدأ من 1 كل سنة متبوعة بالسنة */
export const CONTINUOUS: VoucherType[] = ['receipt', 'payment'];
export const voucherNo = (type: VoucherType, serial: number, year: number) =>
  CONTINUOUS.includes(type) ? String(serial) : `${serial}/${year}`;

export const ALL_VOUCHER_TYPES = VOUCHER_TYPES;
/** الأنواع التي تُسجَّل يدويًا من شاشة القيود (القبض والصرف من شاشتيهما) */
export const MANUAL_BUILTIN: BuiltinVoucherType[] = ['journal', 'adjustment', 'opening'];
export const isAssetType = (t: string) => (ASSET_VOUCHER_TYPES as readonly string[]).includes(t);
export const isBuiltin = (t: string): t is BuiltinVoucherType => (VOUCHER_TYPES as readonly string[]).includes(t);
/** رمز نوع مستند صالح الصيغة (أساسي أو خاص بالجمعية) */
export const isTypeCode = (t: string): t is VoucherType => isBuiltin(t) || CUSTOM_TYPE_RE.test(t);

/**
 * مصدر أرقام كل نوع سند: سندات القبض والصرف أرقامها في جدول السندات (قد يتكرر رقمها في القيود بعد العكس وإعادة الاعتماد)،
 * وباقي الأنواع في جدول القيود. الحالات موحّدة: posted مرحّل، cancelled ملغي، draft لم يكتمل.
 */
export function serialSource(type: VoucherType) {
  if (!isTypeCode(type)) throw new BadRequestException('نوع المستند غير صحيح');
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

  /** أنواع السندات الخاصة بالجمعية */
  async documentTypes(org: string, em: EntityManager = this.db.manager) {
    return em.getRepository(DocumentType).find({ where: { organizationId: org }, order: { sortOrder: 'ASC', createdAt: 'ASC' } });
  }

  /** أسماء كل أنواع المستندات للجمعية: الأساسية والخاصة */
  async typeLabels(org: string, em: EntityManager = this.db.manager): Promise<Record<string, string>> {
    const custom = await this.documentTypes(org, em);
    return { ...VOUCHER_LABEL, ...Object.fromEntries(custom.map((d) => [d.code, d.name])) };
  }

  /** كل أنواع المستندات للجمعية بالترتيب (للتسلسلات ومحضر الجرد) */
  async allTypes(org: string, em: EntityManager = this.db.manager): Promise<VoucherType[]> {
    return [...ALL_VOUCHER_TYPES, ...(await this.documentTypes(org, em)).map((d) => d.code)];
  }

  /** نوع قيد يدوي صالح: قيد يومية أو تسوية أو افتتاحي، أو نوع سند خاص مفعّل */
  async assertManualType(org: string, type: string, em: EntityManager = this.db.manager) {
    if (isAssetType(type)) throw new BadRequestException('سندات الإهلاك وسندات الأصول الثابتة تصدر من الأصول الثابتة فقط، ولا تُنشأ من النظام المالي');
    if (isBuiltin(type)) return type;
    const d = CUSTOM_TYPE_RE.test(type) ? await em.getRepository(DocumentType).findOne({ where: { organizationId: org, code: type as `d_${string}` } }) : null;
    if (!d) throw new BadRequestException('نوع المستند غير موجود');
    if (!d.isActive) throw new BadRequestException(`نوع السند «${d.name}» موقوف من الإعدادات`);
    return d.code;
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
