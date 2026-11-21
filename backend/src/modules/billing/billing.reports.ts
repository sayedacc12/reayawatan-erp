import { Injectable, OnModuleInit } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { ar, dynamicFilter, org, periodFilters, selectFilter } from '../../core/reports/report-helpers';
import { ReportDefinition } from '../../core/reports/report.types';
import { ReportsRegistry } from '../../core/reports/reports.registry';
import { BILLING_PERMISSIONS as P } from './billing.manifest';
import { blToday, customerCode, docCode, r2 } from './billing-core.service';
import { BillingOpsService } from './billing-ops.service';
import { CUSTOMER_KINDS, DOC_KINDS, DOC_STATUS, DOC_TYPES, DocKind, ISSUED, ITEM_KINDS, VAT_CATEGORIES, VAT_REASONS } from './entities/billing.entity';

type Row = Record<string, unknown>;

/** تقارير الفوترة والمبيعات: سجل المبيعات، والمبيعات حسب العميل والصنف، وملخص ضريبة المخرجات، وأعمار الذمم، والمطابقة */
@Injectable()
export class BillingReports implements OnModuleInit {
  constructor(private readonly registry: ReportsRegistry, private readonly db: DataSource, private readonly ops: BillingOpsService) {}

  onModuleInit() {
    const base = { module: 'billing', permission: P.reports };
    const customerFilter = dynamicFilter('customer', 'العميل', async (u) =>
      this.db.query('SELECT id::text AS value, name AS label FROM bl_customers WHERE organization_id = $1 ORDER BY name', [u.organizationId]));
    const defs: ReportDefinition[] = [
      {
        ...base, code: 'billing.register', category: 'المبيعات', title: 'سجل فواتير المبيعات', description: 'كل الفواتير والإشعارات الصادرة في الفترة بمبالغها وضريبتها وحالة تحصيلها',
        filters: [...periodFilters(), selectFilter('kind', 'المستند', DOC_KINDS), selectFilter('docType', 'النوع', DOC_TYPES), customerFilter],
        link: '/billing/invoices/{id}', orientation: 'landscape',
        columns: [
          { key: 'code', label: 'الرقم' }, { key: 'date', label: 'التاريخ', type: 'date' }, { key: 'kind', label: 'المستند' }, { key: 'docType', label: 'النوع' },
          { key: 'buyer', label: 'العميل' }, { key: 'vatNumber', label: 'الرقم الضريبي' }, { key: 'taxable', label: 'الصافي', type: 'money', total: true },
          { key: 'vat', label: 'الضريبة', type: 'money', total: true }, { key: 'total', label: 'الإجمالي', type: 'money', total: true }, { key: 'status', label: 'الحالة' },
        ],
        run: async (u, f) => {
          const rows = await this.db.query(
            `SELECT id, kind, doc_no, doc_type, status, issue_date::text AS date, COALESCE(buyer->>'name', 'عميل نقدي') AS buyer, buyer->>'vatNumber' AS "vatNumber",
                    taxable::float, vat::float, total::float
               FROM bl_documents WHERE organization_id = $1 AND status = ANY($2) AND issue_date BETWEEN $3 AND $4
                AND ($5::text IS NULL OR kind = $5) AND ($6::text IS NULL OR doc_type = $6) AND ($7::uuid IS NULL OR customer_id = $7::uuid)
              ORDER BY issue_date, icv`, [org(u).organizationId, ISSUED, f.from, f.to, f.kind ?? null, f.docType ?? null, f.customer ?? null]);
          return rows.map((r: Row) => {
            const sign = r.kind === 'credit_note' ? -1 : 1;
            return {
              ...r, code: docCode(r.kind as DocKind, r.doc_no as number), kind: ar(DOC_KINDS, r.kind), docType: ar(DOC_TYPES, r.doc_type), status: ar(DOC_STATUS, r.status),
              taxable: sign * (r.taxable as number), vat: sign * (r.vat as number), total: sign * (r.total as number),
            };
          });
        },
      },
      {
        ...base, code: 'billing.by-customer', category: 'المبيعات', title: 'المبيعات حسب العميل', description: 'صافي المبيعات والضريبة والمحصّل والمتبقي لكل عميل في الفترة',
        filters: periodFilters(), link: '/billing/customers/{id}',
        columns: [
          { key: 'code', label: 'الرمز' }, { key: 'name', label: 'العميل' }, { key: 'kind', label: 'النوع' }, { key: 'docs', label: 'المستندات', type: 'number', total: true },
          { key: 'taxable', label: 'الصافي', type: 'money', total: true }, { key: 'vat', label: 'الضريبة', type: 'money', total: true }, { key: 'total', label: 'الإجمالي', type: 'money', total: true },
        ],
        run: async (u, f) => {
          const rows = await this.db.query(
            `SELECT c.id, c.customer_no, COALESCE(c.name, 'عملاء نقديون بلا ملف') AS name, c.kind, COUNT(*)::int AS docs,
                    SUM(CASE WHEN d.kind = 'credit_note' THEN -d.taxable ELSE d.taxable END)::float AS taxable,
                    SUM(CASE WHEN d.kind = 'credit_note' THEN -d.vat ELSE d.vat END)::float AS vat,
                    SUM(CASE WHEN d.kind = 'credit_note' THEN -d.total ELSE d.total END)::float AS total
               FROM bl_documents d LEFT JOIN bl_customers c ON c.id = d.customer_id AND c.organization_id = d.organization_id
              WHERE d.organization_id = $1 AND d.status = ANY($2) AND d.issue_date BETWEEN $3 AND $4
              GROUP BY c.id, c.customer_no, c.name, c.kind ORDER BY total DESC`, [org(u).organizationId, ISSUED, f.from, f.to]);
          return rows.map((r: Row) => ({ ...r, code: r.customer_no ? customerCode(r.customer_no as number) : '—', kind: ar(CUSTOMER_KINDS, r.kind) }));
        },
      },
      {
        ...base, code: 'billing.by-item', category: 'المبيعات', title: 'المبيعات حسب الصنف أو الخدمة', description: 'الكميات والصافي والضريبة لكل صنف أو خدمة في الفترة (بعد الإشعارات)',
        filters: periodFilters(),
        columns: [
          { key: 'code', label: 'الرمز' }, { key: 'name', label: 'الصنف أو الخدمة' }, { key: 'kind', label: 'النوع' }, { key: 'qty', label: 'الكمية', type: 'number' },
          { key: 'net', label: 'الصافي', type: 'money', total: true }, { key: 'vat', label: 'الضريبة', type: 'money', total: true },
        ],
        run: async (u, f) => {
          const rows = await this.db.query(
            `SELECT i.code, COALESCE(i.name, MIN(l->>'description'), 'بنود بلا صنف') AS name, i.kind,
                    SUM(CASE WHEN d.kind = 'credit_note' THEN -1 ELSE 1 END * (l->>'qty')::numeric)::float AS qty,
                    SUM(CASE WHEN d.kind = 'credit_note' THEN -1 ELSE 1 END * (l->>'net')::numeric)::float AS net,
                    SUM(CASE WHEN d.kind = 'credit_note' THEN -1 ELSE 1 END * (l->>'vat')::numeric)::float AS vat
               FROM bl_documents d CROSS JOIN LATERAL jsonb_array_elements(d.lines) l
               LEFT JOIN bl_items i ON i.id::text = l->>'itemId' AND i.organization_id = d.organization_id
              WHERE d.organization_id = $1 AND d.status = ANY($2) AND d.issue_date BETWEEN $3 AND $4
              GROUP BY i.id, i.code, i.name, i.kind ORDER BY net DESC`, [org(u).organizationId, ISSUED, f.from, f.to]);
          return rows.map((r: Row) => ({ ...r, code: r.code ?? '—', kind: ar(ITEM_KINDS, r.kind) }));
        },
      },
      {
        ...base, code: 'billing.vat', category: 'الضريبة', title: 'ملخص ضريبة المخرجات', description: 'المبيعات حسب الفئة الضريبية والنسبة وسبب الإعفاء، تمهيدًا لإقرار ضريبة القيمة المضافة',
        filters: periodFilters(),
        columns: [
          { key: 'category', label: 'الفئة' }, { key: 'rate', label: 'النسبة', type: 'percent' }, { key: 'reason', label: 'سبب الإعفاء أو الصفر' },
          { key: 'sales', label: 'المبيعات', type: 'money', total: true }, { key: 'credits', label: 'الإشعارات الدائنة', type: 'money', total: true },
          { key: 'net', label: 'الصافي', type: 'money', total: true }, { key: 'vat', label: 'الضريبة', type: 'money', total: true },
        ],
        run: async (u, f) => {
          const rows: { category: string; rate: string; reason: string | null; sales: number; credits: number; vat: number }[] = await this.db.query(
            `SELECT b->>'category' AS category, (b->>'rate') AS rate, b->>'reasonCode' AS reason,
                    SUM(CASE WHEN d.kind <> 'credit_note' THEN (b->>'taxable')::numeric ELSE 0 END)::float AS sales,
                    SUM(CASE WHEN d.kind = 'credit_note' THEN (b->>'taxable')::numeric ELSE 0 END)::float AS credits,
                    SUM(CASE WHEN d.kind = 'credit_note' THEN -1 ELSE 1 END * (b->>'vat')::numeric)::float AS vat
               FROM bl_documents d CROSS JOIN LATERAL jsonb_array_elements(d.breakdown) b
              WHERE d.organization_id = $1 AND d.status = ANY($2) AND d.issue_date BETWEEN $3 AND $4
              GROUP BY 1, 2, 3 ORDER BY 1, 2 DESC`, [org(u).organizationId, ISSUED, f.from, f.to]);
          return {
            rows: rows.map((r) => ({
              category: ar(VAT_CATEGORIES, r.category), rate: Number(r.rate), reason: r.reason ? `${r.reason}: ${VAT_REASONS[r.reason]?.label ?? ''}` : '—',
              sales: r.sales, credits: -r.credits, net: r2(r.sales - r.credits), vat: r.vat,
            })),
            notes: ['المبالغ من الفواتير والإشعارات الصادرة فقط. الإقرار الضريبي الرسمي يُعدّ ويُقدّم من بوابة هيئة الزكاة والضريبة والجمارك.'],
          };
        },
      },
      {
        ...base, code: 'billing.aging', category: 'التحصيل', title: 'أعمار ذمم العملاء', description: 'المتبقي على الفواتير الصادرة موزعًا حسب أيام التأخر عن الاستحقاق',
        filters: [{ key: 'asOf', label: 'حتى تاريخ', type: 'date', default: 'today', required: true }], link: '/billing/customers/{id}', orientation: 'landscape',
        columns: [
          { key: 'name', label: 'العميل' }, { key: 'current', label: 'غير مستحقة', type: 'money', total: true }, { key: 'd30', label: '1 - 30 يومًا', type: 'money', total: true },
          { key: 'd60', label: '31 - 60', type: 'money', total: true }, { key: 'd90', label: '61 - 90', type: 'money', total: true },
          { key: 'older', label: 'أكثر من 90', type: 'money', total: true }, { key: 'total', label: 'الإجمالي', type: 'money', total: true },
        ],
        run: async (u, f) => {
          const asOf = f.asOf ?? blToday();
          return this.db.query(
            `WITH o AS (
               SELECT customer_id, COALESCE(buyer->>'name', 'عميل نقدي') AS buyer, ($2::date - COALESCE(due_date, issue_date)) AS late,
                      (total + debited_amount - credited_amount - paid_amount) AS left
                 FROM bl_documents WHERE organization_id = $1 AND kind = 'invoice' AND status IN ('issued', 'partial') AND issue_date <= $2)
             SELECT o.customer_id AS id, COALESCE(c.name, MIN(o.buyer)) AS name,
                    SUM(left) FILTER (WHERE late <= 0)::float AS current, SUM(left) FILTER (WHERE late BETWEEN 1 AND 30)::float AS d30,
                    SUM(left) FILTER (WHERE late BETWEEN 31 AND 60)::float AS d60, SUM(left) FILTER (WHERE late BETWEEN 61 AND 90)::float AS d90,
                    SUM(left) FILTER (WHERE late > 90)::float AS older, SUM(left)::float AS total
               FROM o LEFT JOIN bl_customers c ON c.id = o.customer_id AND c.organization_id = $1
              WHERE o.left > 0 GROUP BY o.customer_id, c.name ORDER BY total DESC`, [org(u).organizationId, asOf]);
        },
      },
      {
        ...base, code: 'billing.reconciliation', category: 'التحصيل', title: 'مطابقة الفوترة مع الدليل', description: 'رصيد حسابي الذمم وضريبة المخرجات في الدليل مقابل الفواتير والتحصيل، وأسباب أي فرق',
        filters: [{ key: 'asOf', label: 'حتى تاريخ', type: 'date', default: 'today', required: true }],
        columns: [
          { key: 'account', label: 'الحساب' }, { key: 'kind', label: 'الغرض' }, { key: 'gl', label: 'رصيد الدليل', type: 'money' },
          { key: 'subledger', label: 'رصيد الفوترة', type: 'money' }, { key: 'diff', label: 'الفرق', type: 'money' }, { key: 'state', label: 'الحالة' },
        ],
        run: async (u, f) => {
          const rec = await this.ops.reconcile(org(u), { asOf: f.asOf });
          return {
            rows: rec.accounts.map((x) => ({ account: `${x.code} ${x.name}`, kind: x.kindLabel, gl: x.gl, subledger: x.subledger, diff: x.diff, state: x.ok ? 'مطابق' : 'غير مطابق', _style: x.ok ? undefined : 'strong' as const })),
            notes: rec.accounts.flatMap((x) => x.problems),
          };
        },
      },
    ];
    this.registry.register(defs);
  }
}
