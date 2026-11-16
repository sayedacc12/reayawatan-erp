import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { OrgUser } from '../../core/auth/decorators';
import { AccCore, cents, fromCents, monthsBetween, today, voucherNo } from './acc-core.service';
import { ACC_PERMISSIONS as P } from './accounting.manifest';
import { NATURE_AR } from './accounts.service';
import { Account, Partner, VoucherType } from './entities/accounting.entity';
import { SetupService } from './setup.service';

/** قائمة تقارير النظام المالي: المتاح الآن، والنماذج التي تُضاف لاحقًا */
const CATALOG = [
  { code: 'trial-balance', name: 'ميزان المراجعة', description: 'أرصدة الحسابات افتتاحي وحركة وختامي لأي فترة ومستوى', ready: true },
  { code: 'ledger', name: 'كشف حساب (دفتر الأستاذ)', description: 'حركة حساب أو مجموعة حسابات بالرصيد التراكمي', ready: true },
  { code: 'partner', name: 'كشف حساب عميل أو مورد', description: 'حركة الشريك ورصيده', ready: true },
  { code: 'financial-position', name: 'قائمة المركز المالي', description: 'وفق نموذج المعايير المحاسبية للجهات غير الهادفة للربح', ready: false },
  { code: 'activities', name: 'قائمة الأنشطة', description: 'الإيرادات والتبرعات والمصروفات حسب القيود على صافي الأصول', ready: false },
  { code: 'cash-flows', name: 'قائمة التدفقات النقدية', description: '', ready: false },
  { code: 'net-assets', name: 'قائمة التغيرات في صافي الأصول', description: '', ready: false },
  { code: 'functional', name: 'المصروفات حسب التصنيف الوظيفي', description: 'برامج وأنشطة، جمع أموال، إدارية وعمومية، حوكمة', ready: false },
];

type BalanceRow = { account_id: string; opening: string; debit: string; credit: string };

@Injectable()
export class ReportsService {
  constructor(private readonly db: DataSource, private readonly core: AccCore, private readonly setup: SetupService) {}

  catalog() {
    return CATALOG;
  }

  // ---------------- اللوحة ----------------

  async dashboard(actor: OrgUser) {
    const labels = await this.core.typeLabels(actor.organizationId);
    const org = actor.organizationId;
    const [years, settings, accCount] = await Promise.all([
      this.core.years(org), this.core.settings(org), this.db.getRepository(Account).count({ where: { organizationId: org } }),
    ]);
    const d = today();
    const year = years.find((y) => y.startDate <= d && y.endDate >= d) ?? years.at(-1) ?? null;
    const showMismatch = actor.isSuperadmin || actor.permissions.includes(P.settings) || actor.permissions.includes(P.reopenPeriods);
    const base = {
      setup: { hasYear: years.length > 0, chartInstalled: !!settings.chartInstalledAt, accounts: accCount },
      mismatches: showMismatch ? await this.setup.mismatches(org) : [],
    };
    if (!year) return { ...base, year: null };

    const [cash, totals, monthly, counts, vouchers, recent] = await Promise.all([
      this.db.query(
        `SELECT c.id, c.name, c.kind, a.code, COALESCE(SUM(l.debit - l.credit) FILTER (WHERE e.status = 'posted'), 0) AS balance
           FROM acc_cash_accounts c JOIN acc_accounts a ON a.id = c.gl_account_id
           LEFT JOIN acc_entry_lines l ON l.account_id = c.gl_account_id
           LEFT JOIN acc_entries e ON e.id = l.entry_id AND e.fiscal_year_id = $2
          WHERE c.organization_id = $1 AND c.is_active GROUP BY c.id, a.code ORDER BY c.name`, [org, year.id]),
      this.db.query(
        `SELECT a.nature, SUM(l.credit - l.debit) AS net FROM acc_entry_lines l JOIN acc_entries e ON e.id = l.entry_id
           JOIN acc_accounts a ON a.id = l.account_id
          WHERE e.fiscal_year_id = $1 AND e.status = 'posted' AND a.nature IN ('revenue', 'expenses') GROUP BY 1`, [year.id]),
      this.db.query(
        `SELECT to_char(e.document_date, 'YYYY-MM') AS month, a.nature, SUM(l.credit - l.debit) AS net
           FROM acc_entry_lines l JOIN acc_entries e ON e.id = l.entry_id JOIN acc_accounts a ON a.id = l.account_id
          WHERE e.fiscal_year_id = $1 AND e.status = 'posted' AND a.nature IN ('revenue', 'expenses') GROUP BY 1, 2`, [year.id]),
      this.db.query(
        `SELECT status, COUNT(*)::int AS n FROM acc_entries WHERE fiscal_year_id = $1 GROUP BY 1`, [year.id]),
      this.db.query(
        `SELECT kind, status, COUNT(*)::int AS n, COALESCE(SUM(amount), 0) AS total FROM acc_vouchers WHERE fiscal_year_id = $1 GROUP BY 1, 2`, [year.id]),
      this.db.query(
        `SELECT id, entry_no, voucher_type, voucher_serial, to_char(document_date, 'YYYY-MM-DD') AS document_date, description, status, total FROM acc_entries
          WHERE fiscal_year_id = $1 ORDER BY created_at DESC LIMIT 8`, [year.id]),
    ]);
    const num = (v: unknown) => fromCents(cents(v as string));
    const revenue = num(totals.find((t: { nature: string }) => t.nature === 'revenue')?.net);
    const expenses = -num(totals.find((t: { nature: string }) => t.nature === 'expenses')?.net);
    const vcount = (kind: string, statuses: string[]) => vouchers
      .filter((v: { kind: string; status: string }) => v.kind === kind && statuses.includes(v.status))
      .reduce((s: { n: number; total: number }, v: { n: number; total: string }) => ({ n: s.n + v.n, total: s.total + num(v.total) }), { n: 0, total: 0 });
    return {
      ...base,
      year: { id: year.id, name: year.name, startDate: year.startDate, endDate: year.endDate, status: year.status },
      cash: cash.map((c: { id: string; name: string; kind: string; code: string; balance: string }) => ({ ...c, balance: num(c.balance) })),
      revenue, expenses, surplus: fromCents(cents(revenue) - cents(expenses)),
      monthly: monthsBetween(year.startDate, year.endDate).map((m) => ({
        month: m,
        revenue: num(monthly.find((r: { month: string; nature: string }) => r.month === m && r.nature === 'revenue')?.net),
        expenses: -num(monthly.find((r: { month: string; nature: string }) => r.month === m && r.nature === 'expenses')?.net),
      })),
      entries: Object.fromEntries(counts.map((c: { status: string; n: number }) => [c.status, c.n])),
      receipts: { approved: vcount('receipt', ['approved']), pending: vcount('receipt', ['draft', 'pending', 'returned']) },
      payments: { approved: vcount('payment', ['approved']), pending: vcount('payment', ['draft', 'pending', 'returned']) },
      recent: recent.map((e: { id: string; entry_no: number; voucher_type: VoucherType; voucher_serial: number; document_date: string; description: string; status: string; total: string }) => ({
        id: e.id, entryNo: e.entry_no, voucherLabel: labels[e.voucher_type] ?? e.voucher_type, voucherNo: voucherNo(e.voucher_type, e.voucher_serial, year.name),
        documentDate: e.document_date, description: e.description, status: e.status, total: num(e.total),
      })),
    };
  }

  // ---------------- ميزان المراجعة ----------------

  private async period(org: string, from: string, to: string) {
    if (from > to) throw new BadRequestException('تاريخ البداية بعد تاريخ النهاية');
    const year = await this.core.yearOf(org, from);
    if (to > year.endDate) throw new BadRequestException(`الفترة يجب أن تكون داخل السنة المالية ${year.name} (حتى ${year.endDate})`);
    return year;
  }

  async trialBalance(actor: OrgUser, from: string, to: string, level: number) {
    const org = actor.organizationId;
    const year = await this.period(org, from, to);
    const [accounts, sums] = await Promise.all([
      this.db.getRepository(Account).find({ where: { organizationId: org }, order: { code: 'ASC' } }),
      this.db.query(
        `SELECT l.account_id,
                COALESCE(SUM(l.debit - l.credit) FILTER (WHERE e.document_date < $2), 0) AS opening,
                COALESCE(SUM(l.debit) FILTER (WHERE e.document_date >= $2), 0) AS debit,
                COALESCE(SUM(l.credit) FILTER (WHERE e.document_date >= $2), 0) AS credit
           FROM acc_entry_lines l JOIN acc_entries e ON e.id = l.entry_id
          WHERE e.fiscal_year_id = $1 AND e.status = 'posted' AND e.document_date <= $3 GROUP BY 1`, [year.id, from, to]) as Promise<BalanceRow[]>,
    ]);
    const byId = new Map(accounts.map((a) => [a.id, a]));
    const agg = new Map<string, { opening: number; debit: number; credit: number }>();
    for (const s of sums) {
      let a = byId.get(s.account_id);
      while (a) {
        const cur = agg.get(a.id) ?? { opening: 0, debit: 0, credit: 0 };
        cur.opening += cents(s.opening); cur.debit += cents(s.debit); cur.credit += cents(s.credit);
        agg.set(a.id, cur);
        a = a.parentId ? byId.get(a.parentId) : undefined;
      }
    }
    const rows = accounts.filter((a) => a.level <= level && agg.has(a.id)).map((a) => {
      const v = agg.get(a.id)!;
      const closing = v.opening + v.debit - v.credit;
      return {
        id: a.id, code: a.code, name: a.name, level: a.level, kind: a.kind, nature: a.nature, natureLabel: NATURE_AR[a.nature],
        openingDebit: fromCents(Math.max(v.opening, 0)), openingCredit: fromCents(Math.max(-v.opening, 0)),
        debit: fromCents(v.debit), credit: fromCents(v.credit),
        closingDebit: fromCents(Math.max(closing, 0)), closingCredit: fromCents(Math.max(-closing, 0)),
      };
    });
    const roots = rows.filter((r) => r.level === 1);
    const sum = (k: keyof (typeof rows)[number]) => fromCents(roots.reduce((s, r) => s + cents(r[k] as number), 0));
    return {
      year: year.name, from, to, level, rows,
      totals: {
        openingDebit: sum('openingDebit'), openingCredit: sum('openingCredit'), debit: sum('debit'), credit: sum('credit'),
        closingDebit: sum('closingDebit'), closingCredit: sum('closingCredit'),
      },
    };
  }

  // ---------------- كشف الحساب ----------------

  private async movements(org: string, yearId: string, from: string, to: string, where: string, params: unknown[]) {
    const labels = await this.core.typeLabels(org);
    const [open] = await this.db.query(
      `SELECT COALESCE(SUM(l.debit - l.credit), 0) AS bal FROM acc_entry_lines l JOIN acc_entries e ON e.id = l.entry_id
        WHERE e.fiscal_year_id = $1 AND e.status = 'posted' AND e.document_date < $2 AND ${where}`, [yearId, from, ...params]);
    const lines = await this.db.query(
      `SELECT e.id AS entry_id, e.entry_no, e.voucher_type, e.voucher_serial, to_char(e.document_date, 'YYYY-MM-DD') AS document_date, e.description, l.label, l.debit, l.credit,
              a.code AS account_code, a.name AS account_name, p.name AS partner_name, y.name AS year
         FROM acc_entry_lines l JOIN acc_entries e ON e.id = l.entry_id JOIN acc_accounts a ON a.id = l.account_id
         JOIN acc_fiscal_years y ON y.id = e.fiscal_year_id LEFT JOIN acc_partners p ON p.id = l.partner_id
        WHERE e.fiscal_year_id = $1 AND e.status = 'posted' AND e.document_date BETWEEN $2 AND $3 AND ${where.replace(/\$(\d+)/g, (_, n) => `$${Number(n) + 1}`)}
        ORDER BY e.document_date, e.entry_no, l.line_no`, [yearId, from, to, ...params]);
    let bal = cents(open.bal);
    const opening = fromCents(bal);
    let debit = 0;
    let credit = 0;
    const rows = lines.map((l: Record<string, string | number>) => {
      debit += cents(l.debit as string); credit += cents(l.credit as string);
      bal += cents(l.debit as string) - cents(l.credit as string);
      return {
        entryId: l.entry_id, entryNo: l.entry_no, voucherLabel: labels[l.voucher_type as string] ?? l.voucher_type,
        voucherNo: voucherNo(l.voucher_type as VoucherType, l.voucher_serial as number, l.year as number),
        documentDate: l.document_date, description: l.label || l.description, accountCode: l.account_code, accountName: l.account_name,
        partnerName: l.partner_name, debit: fromCents(cents(l.debit as string)), credit: fromCents(cents(l.credit as string)), balance: fromCents(bal),
      };
    });
    return { opening, rows, debit: fromCents(debit), credit: fromCents(credit), closing: fromCents(bal) };
  }

  async ledger(actor: OrgUser, accountId: string, from: string, to: string) {
    const org = actor.organizationId;
    const year = await this.period(org, from, to);
    const account = await this.db.getRepository(Account).findOne({ where: { id: accountId, organizationId: org } });
    if (!account) throw new NotFoundException('الحساب غير موجود');
    // الحساب وكل الحسابات تحته
    const ids: { id: string }[] = await this.db.query(
      `WITH RECURSIVE t AS (SELECT id FROM acc_accounts WHERE id = $1 UNION ALL SELECT a.id FROM acc_accounts a JOIN t ON a.parent_id = t.id) SELECT id FROM t`, [accountId]);
    const m = await this.movements(org, year.id, from, to, 'l.account_id = ANY($3)', [ids.map((i) => i.id)]);
    return { year: year.name, from, to, account: { id: account.id, code: account.code, name: account.name, kind: account.kind, natureLabel: NATURE_AR[account.nature] }, ...m };
  }

  async partnerStatement(actor: OrgUser, partnerId: string, from: string, to: string) {
    const org = actor.organizationId;
    const year = await this.period(org, from, to);
    const partner = await this.db.getRepository(Partner).findOne({ where: { id: partnerId, organizationId: org } });
    if (!partner) throw new NotFoundException('الشريك غير موجود');
    const m = await this.movements(org, year.id, from, to, 'l.partner_id = $3', [partnerId]);
    return { year: year.name, from, to, partner: { id: partner.id, name: partner.name, partnerNo: partner.partnerNo }, ...m };
  }
}
