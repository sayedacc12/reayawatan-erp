import { Injectable, OnModuleInit } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { ar, dynamicFilter, org, periodFilters, selectFilter } from '../../core/reports/report-helpers';
import { ReportDefinition, ReportRow } from '../../core/reports/report.types';
import { REPORT_QUERY_LIMIT, ReportsRegistry } from '../../core/reports/reports.registry';
import { AccCore, voucherNo } from './acc-core.service';
import { ACC_PERMISSIONS as P } from './accounting.manifest';
import { NATURE_AR } from './accounts.service';
import { STATUS_AR } from './entries.service';
import { VoucherType } from './entities/accounting.entity';
import { ReportsService } from './reports.service';
import { VOUCHER_STATUS_AR } from './vouchers.service';

const METHOD_AR: Record<string, string> = { cash: 'نقدًا', transfer: 'حوالة بنكية', cheque: 'شيك', card: 'شبكة / بطاقة', credit: 'آجل' };
const SOURCE_AR: Record<string, string> = { manual: 'يدوي', opportunity: 'فرصة تبرع', store: 'المتجر', payroll: 'الرواتب', assets: 'الأصول الثابتة' };
const KIND_AR: Record<string, string> = { receipt: 'سند قبض', payment: 'سند صرف' };
const LEVELS: Record<string, string> = { '1': 'المستوى 1', '2': 'حتى المستوى 2', '3': 'حتى المستوى 3', '4': 'حتى المستوى 4', '5': 'حتى المستوى 5', '9': 'كل المستويات' };

const STATEMENT_COLUMNS = [
  { key: 'documentDate', label: 'التاريخ', type: 'date' as const }, { key: 'entryNo', label: 'رقم القيد' }, { key: 'voucherLabel', label: 'نوع المستند' },
  { key: 'voucherNo', label: 'رقم المستند' }, { key: 'description', label: 'البيان' }, { key: 'account', label: 'الحساب' },
  { key: 'partnerName', label: 'الشريك' }, { key: 'debit', label: 'مدين', type: 'money' as const, total: true },
  { key: 'credit', label: 'دائن', type: 'money' as const, total: true }, { key: 'balance', label: 'الرصيد', type: 'money' as const },
];

/** تقارير النظام المالي في البنية الموحدة */
@Injectable()
export class AccountingReports implements OnModuleInit {
  constructor(
    private readonly registry: ReportsRegistry,
    private readonly reports: ReportsService,
    private readonly core: AccCore,
    private readonly db: DataSource,
  ) {}

  private accountOptions = async (u: { organizationId: string }) =>
    (await this.db.query('SELECT id AS value, code || \' \' || name AS label FROM acc_accounts WHERE organization_id = $1 ORDER BY code', [u.organizationId])) as { value: string; label: string }[];

  onModuleInit() {
    const base = { module: 'accounting', permission: P.reports };
    const statementRows = (m: { rows: Record<string, unknown>[] }) => m.rows.map((r) => ({
      ...r, account: `${r.accountCode} ${r.accountName}`,
    }));
    const statementSummary = (m: { opening: number; debit: number; credit: number; closing: number }) => [
      { label: 'الرصيد الافتتاحي', value: m.opening, type: 'money' as const }, { label: 'إجمالي المدين', value: m.debit, type: 'money' as const },
      { label: 'إجمالي الدائن', value: m.credit, type: 'money' as const }, { label: 'الرصيد الختامي', value: m.closing, type: 'money' as const },
    ];

    const defs: ReportDefinition[] = [
      {
        ...base, code: 'accounting.trial-balance', category: 'الأرصدة', title: 'ميزان المراجعة',
        description: 'أرصدة الحسابات: افتتاحي وحركة الفترة وختامي، لأي فترة داخل السنة المالية',
        filters: [...periodFilters(), { ...selectFilter('level', 'المستوى', LEVELS), default: '9', required: true }],
        drill: { report: 'accounting.ledger', filters: { accountId: '{id}' } },
        orientation: 'landscape', indentColumn: 'name',
        columns: [
          { key: 'code', label: 'رقم الحساب' }, { key: 'name', label: 'اسم الحساب' }, { key: 'natureLabel', label: 'الطبيعة' },
          { key: 'openingDebit', label: 'افتتاحي مدين', type: 'money' }, { key: 'openingCredit', label: 'افتتاحي دائن', type: 'money' },
          { key: 'debit', label: 'حركة مدين', type: 'money' }, { key: 'credit', label: 'حركة دائن', type: 'money' },
          { key: 'closingDebit', label: 'ختامي مدين', type: 'money' }, { key: 'closingCredit', label: 'ختامي دائن', type: 'money' },
        ],
        run: async (u, f) => {
          const tb = await this.reports.trialBalance(org(u), f.from!, f.to!, Number(f.level ?? 9));
          return {
            subtitle: `السنة المالية ${tb.year}`,
            rows: tb.rows.map((r) => ({ ...r, _level: r.level, _style: r.level === 1 ? 'strong' as const : undefined })),
            totals: tb.totals,
          };
        },
      },
      {
        ...base, code: 'accounting.ledger', category: 'كشوف الحسابات', title: 'كشف حساب (دفتر الأستاذ)',
        description: 'حركة الحساب وكل الحسابات التابعة له بالرصيد التراكمي',
        filters: [{ key: 'accountId', label: 'الحساب', type: 'select', required: true, loadOptions: (u) => this.accountOptions(org(u)) }, ...periodFilters()],
        columns: STATEMENT_COLUMNS, orientation: 'landscape',
        run: async (u, f) => {
          const m = await this.reports.ledger(org(u), f.accountId!, f.from!, f.to!);
          return { subtitle: `${m.account.code} ${m.account.name} (${m.account.natureLabel}) · السنة المالية ${m.year}`, rows: statementRows(m), summary: statementSummary(m) };
        },
      },
      {
        ...base, code: 'accounting.partner-statement', category: 'كشوف الحسابات', title: 'كشف حساب عميل أو مورد', description: 'حركة الشريك ورصيده في الفترة',
        filters: [
          dynamicFilter('partnerId', 'العميل / المورد', async (u) => (await this.db.query(
            `SELECT id AS value, name || ' (' || partner_no || ')' AS label FROM acc_partners WHERE organization_id = $1 ORDER BY name`, [u.organizationId])) as { value: string; label: string }[], 'اختر...', true),
          ...periodFilters(),
        ],
        columns: STATEMENT_COLUMNS, orientation: 'landscape',
        run: async (u, f) => {
          const m = await this.reports.partnerStatement(org(u), f.partnerId!, f.from!, f.to!);
          return { subtitle: `${m.partner.name} · السنة المالية ${m.year}`, rows: statementRows(m), summary: statementSummary(m) };
        },
      },
      {
        ...base, code: 'accounting.income-expense', category: 'الأرصدة', title: 'الإيرادات والمصروفات',
        description: 'حركة حسابات الإيرادات والمصروفات في الفترة وصافي الفائض أو العجز (القيود المرحلة)',
        filters: [...periodFilters(), { ...selectFilter('level', 'المستوى', LEVELS), default: '3', required: true }],
        drill: { report: 'accounting.ledger', filters: { accountId: '{id}' } },
        indentColumn: 'name',
        columns: [{ key: 'code', label: 'رقم الحساب' }, { key: 'name', label: 'اسم الحساب' }, { key: 'amount', label: 'المبلغ', type: 'money' }],
        run: async (u, f) => {
          const tb = await this.reports.trialBalance(org(u), f.from!, f.to!, Number(f.level ?? 3));
          const rows: ReportRow[] = [];
          const totals: Record<string, number> = {};
          for (const nature of ['revenue', 'expenses'] as const) {
            const list = tb.rows.filter((r) => r.nature === nature);
            rows.push({ code: '', name: NATURE_AR[nature], amount: null, _style: 'group' });
            for (const r of list) {
              const amount = Math.round((nature === 'revenue' ? r.credit - r.debit : r.debit - r.credit) * 100) / 100;
              rows.push({ id: r.id, code: r.code, name: r.name, amount, _level: r.level, _style: r.level === 1 ? 'strong' : undefined });
            }
            const top = list.filter((r) => r.level === Math.min(...list.map((x) => x.level)));
            totals[nature] = Math.round(top.reduce((s, r) => s + (nature === 'revenue' ? r.credit - r.debit : r.debit - r.credit), 0) * 100) / 100;
          }
          const surplus = Math.round((totals.revenue - totals.expenses) * 100) / 100;
          rows.push({ code: '', name: surplus >= 0 ? 'صافي الفائض' : 'صافي العجز', amount: surplus, _style: 'strong' });
          return {
            subtitle: `السنة المالية ${tb.year}`, rows, totals: {},
            summary: [
              { label: 'إجمالي الإيرادات', value: totals.revenue, type: 'money' }, { label: 'إجمالي المصروفات', value: totals.expenses, type: 'money' },
              { label: surplus >= 0 ? 'الفائض' : 'العجز', value: surplus, type: 'money' },
            ],
          };
        },
      },
      {
        ...base, code: 'accounting.cash-balances', category: 'الأرصدة', title: 'أرصدة البنوك والصناديق', description: 'رصيد كل حساب بنكي وصندوق في تاريخ محدد (القيود المرحلة)',
        filters: [{ key: 'asOf', label: 'الرصيد في تاريخ', type: 'date', default: 'today', required: true }],
        drill: { report: 'accounting.ledger', filters: { accountId: '{glAccountId}' } },
        columns: [
          { key: 'name', label: 'الحساب' }, { key: 'kindLabel', label: 'النوع' }, { key: 'bankName', label: 'البنك' }, { key: 'iban', label: 'الآيبان' },
          { key: 'glAccount', label: 'الحساب في الدليل' }, { key: 'debit', label: 'إجمالي المدين', type: 'money', total: true },
          { key: 'credit', label: 'إجمالي الدائن', type: 'money', total: true }, { key: 'balance', label: 'الرصيد', type: 'money', total: true },
        ],
        run: async (u, f) => {
          const year = await this.core.yearOf(org(u).organizationId, f.asOf!);
          const rows: Record<string, unknown>[] = await this.db.query(
            `SELECT c.name, c.kind, c.bank_name, c.iban, c.gl_account_id, a.code || ' ' || a.name AS gl,
                    COALESCE(SUM(l.debit), 0)::float AS debit, COALESCE(SUM(l.credit), 0)::float AS credit
               FROM acc_cash_accounts c JOIN acc_accounts a ON a.id = c.gl_account_id
               LEFT JOIN acc_entry_lines l ON l.account_id = c.gl_account_id
                 AND EXISTS (SELECT 1 FROM acc_entries e WHERE e.id = l.entry_id AND e.fiscal_year_id = $2 AND e.status = 'posted' AND e.document_date <= $3)
              WHERE c.organization_id = $1 AND c.is_active GROUP BY c.id, a.code, a.name ORDER BY c.kind, c.name`,
            [org(u).organizationId, year.id, f.asOf],
          );
          return {
            subtitle: `السنة المالية ${year.name}`,
            rows: rows.map((r) => ({
              name: r.name, kindLabel: r.kind === 'bank' ? 'بنك' : 'صندوق', bankName: r.bank_name, iban: r.iban, glAccountId: r.gl_account_id, glAccount: r.gl,
              debit: r.debit, credit: r.credit, balance: Math.round((Number(r.debit) - Number(r.credit)) * 100) / 100,
            })),
          };
        },
      },
      {
        ...base, code: 'accounting.journal', category: 'القيود والسندات', title: 'سجل القيود', description: 'كل القيود في الفترة بنوعها وحالتها وإجماليها',
        filters: [
          ...periodFilters(),
          selectFilter('status', 'الحالة', STATUS_AR),
          dynamicFilter('type', 'نوع المستند', async (u) => Object.entries(await this.core.typeLabels(u.organizationId)).map(([value, label]) => ({ value, label }))),
        ],
        link: '/accounting/entries/{id}',
        columns: [
          { key: 'entryNo', label: 'رقم القيد' }, { key: 'documentDate', label: 'تاريخ المستند', type: 'date' }, { key: 'typeLabel', label: 'نوع المستند' },
          { key: 'voucherNo', label: 'رقم المستند' }, { key: 'description', label: 'البيان' }, { key: 'counterparty', label: 'الجهة' },
          { key: 'total', label: 'الإجمالي', type: 'money', total: true }, { key: 'statusLabel', label: 'الحالة' },
          { key: 'createdBy', label: 'أنشأه' }, { key: 'postedBy', label: 'رحّله' },
        ],
        run: async (u, f) => {
          const o = org(u).organizationId;
          const labels = await this.core.typeLabels(o);
          const rows: Record<string, unknown>[] = await this.db.query(
            `SELECT e.id, e.entry_no, to_char(e.document_date, 'YYYY-MM-DD') AS document_date, e.voucher_type, e.voucher_serial, y.name AS year, e.description,
                    e.counterparty, e.total::float AS total, e.status, e.created_by_name, e.posted_by_name
               FROM acc_entries e JOIN acc_fiscal_years y ON y.id = e.fiscal_year_id
              WHERE e.organization_id = $1 AND e.document_date BETWEEN $2 AND $3 AND ($4::text IS NULL OR e.status = $4) AND ($5::text IS NULL OR e.voucher_type = $5)
              ORDER BY e.document_date, e.entry_no
              LIMIT ${REPORT_QUERY_LIMIT}`,
            [o, f.from, f.to, f.status ?? null, f.type ?? null],
          );
          return rows.map((r) => ({
            id: r.id, entryNo: r.entry_no, documentDate: r.document_date, typeLabel: labels[r.voucher_type as string] ?? r.voucher_type,
            voucherNo: voucherNo(r.voucher_type as VoucherType, r.voucher_serial as number, Number(r.year)), description: r.description, counterparty: r.counterparty,
            total: r.total, statusLabel: ar(STATUS_AR, r.status), createdBy: r.created_by_name, postedBy: r.posted_by_name,
            _style: r.status === 'cancelled' ? 'muted' as const : undefined, _skipTotal: r.status === 'cancelled',
          }));
        },
      },
      {
        ...base, code: 'accounting.journal-lines', category: 'القيود والسندات', title: 'دفتر اليومية التفصيلي', description: 'أسطر القيود المرحلة بحساباتها ومبالغها، مرتبة بالتاريخ',
        filters: periodFilters(), orientation: 'landscape',
        columns: [
          { key: 'documentDate', label: 'التاريخ', type: 'date' }, { key: 'entryNo', label: 'رقم القيد' }, { key: 'typeLabel', label: 'نوع المستند' },
          { key: 'account', label: 'الحساب' }, { key: 'analytic', label: 'الحساب التحليلي' }, { key: 'partnerName', label: 'الشريك' }, { key: 'label', label: 'البيان' },
          { key: 'debit', label: 'مدين', type: 'money', total: true }, { key: 'credit', label: 'دائن', type: 'money', total: true },
        ],
        run: async (u, f) => {
          const o = org(u).organizationId;
          const labels = await this.core.typeLabels(o);
          const rows: Record<string, unknown>[] = await this.db.query(
            `SELECT to_char(e.document_date, 'YYYY-MM-DD') AS document_date, e.entry_no, e.voucher_type, a.code || ' ' || a.name AS account,
                    (SELECT string_agg(an.name || CASE WHEN (x->>'percent')::numeric < 100 THEN ' ' || (x->>'percent') || '%' ELSE '' END, '، ')
                       FROM jsonb_array_elements(COALESCE(l.analytic, '[]'::jsonb)) x JOIN acc_analytic_accounts an ON an.id = (x->>'analyticId')::uuid) AS analytic,
                    p.name AS partner_name, COALESCE(NULLIF(l.label, ''), e.description) AS label, l.debit::float AS debit, l.credit::float AS credit
               FROM acc_entry_lines l JOIN acc_entries e ON e.id = l.entry_id JOIN acc_accounts a ON a.id = l.account_id
               LEFT JOIN acc_partners p ON p.id = l.partner_id
              WHERE e.organization_id = $1 AND e.status = 'posted' AND e.document_date BETWEEN $2 AND $3
              ORDER BY e.document_date, e.entry_no, l.line_no
              LIMIT ${REPORT_QUERY_LIMIT}`,
            [o, f.from, f.to],
          );
          return rows.map((r) => ({
            documentDate: r.document_date, entryNo: r.entry_no, typeLabel: labels[r.voucher_type as string] ?? r.voucher_type, account: r.account,
            analytic: r.analytic, partnerName: r.partner_name, label: r.label, debit: r.debit || null, credit: r.credit || null,
          }));
        },
      },
      {
        ...base, code: 'accounting.vouchers', category: 'القيود والسندات', title: 'سجل سندات القبض والصرف', description: 'السندات في الفترة بطريقة الدفع والحالة والمصدر',
        filters: [...periodFilters(), selectFilter('kind', 'نوع السند', KIND_AR), selectFilter('status', 'الحالة', VOUCHER_STATUS_AR), selectFilter('method', 'طريقة الدفع', METHOD_AR)],
        orientation: 'landscape',
        columns: [
          { key: 'voucherNo', label: 'رقم السند' }, { key: 'date', label: 'التاريخ', type: 'date' }, { key: 'kindLabel', label: 'النوع' },
          { key: 'partyName', label: 'الجهة / الشخص' }, { key: 'purpose', label: 'البيان' }, { key: 'methodLabel', label: 'طريقة الدفع' },
          { key: 'cashAccount', label: 'البنك / الصندوق' }, { key: 'sourceLabel', label: 'المصدر' }, { key: 'statusLabel', label: 'الحالة' },
          { key: 'receipts', label: 'مقبوضات', type: 'money', total: true }, { key: 'payments', label: 'مدفوعات', type: 'money', total: true },
        ],
        run: async (u, f) => {
          const rows: Record<string, unknown>[] = await this.db.query(
            `SELECT v.id, v.kind, v.serial, to_char(v.voucher_date, 'YYYY-MM-DD') AS date, v.party_name, v.purpose, v.method, c.name AS cash_name, v.source_type,
                    v.status, v.amount::float AS amount
               FROM acc_vouchers v LEFT JOIN acc_cash_accounts c ON c.id = v.cash_account_id
              WHERE v.organization_id = $1 AND v.voucher_date BETWEEN $2 AND $3 AND ($4::text IS NULL OR v.kind = $4)
                AND ($5::text IS NULL OR v.status = $5) AND ($6::text IS NULL OR v.method = $6)
              ORDER BY v.voucher_date, v.kind, v.serial
              LIMIT ${REPORT_QUERY_LIMIT}`,
            [org(u).organizationId, f.from, f.to, f.kind ?? null, f.status ?? null, f.method ?? null],
          );
          return rows.map((r) => {
            const live = !['rejected', 'cancelled'].includes(String(r.status));
            return {
              voucherNo: r.serial ? String(r.serial) : 'مسودة', date: r.date, kindLabel: ar(KIND_AR, r.kind), partyName: r.party_name, purpose: r.purpose,
              methodLabel: ar(METHOD_AR, r.method), cashAccount: r.cash_name, sourceLabel: ar(SOURCE_AR, r.source_type), statusLabel: ar(VOUCHER_STATUS_AR, r.status),
              receipts: r.kind === 'receipt' ? r.amount : null, payments: r.kind === 'payment' ? r.amount : null,
              _style: live ? undefined : 'muted' as const, _skipTotal: !live,
            };
          });
        },
      },
    ];
    this.registry.register(defs);
  }
}
