import { BadRequestException, Injectable, OnModuleInit } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { ar, dynamicFilter, org, periodFilters, selectFilter } from '../../core/reports/report-helpers';
import { ReportDefinition } from '../../core/reports/report.types';
import { ReportsRegistry } from '../../core/reports/reports.registry';
import { BILLING_PERMISSIONS as P } from './billing.manifest';
import { BillingCore, blToday, customerCode, docCode, fromH, r2, toH } from './billing-core.service';
import { BillingOpsService } from './billing-ops.service';
import { CUSTOMER_KINDS, DOC_KINDS, DOC_STATUS, DOC_TYPES, DocKind, ISSUED, ITEM_KINDS, VAT_CATEGORIES, VAT_REASONS } from './entities/billing.entity';

type Row = Record<string, unknown>;

const QN = ['الأول', 'الثاني', 'الثالث', 'الرابع'];
const lastDay = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);

/**
 * الفترة الضريبية الربع سنوية التقويمية من رمزها (2026-Q4)، وتبدأ من تاريخ نفاذ التسجيل إن وقع داخلها.
 * موعد الإقرار والسداد: آخر يوم من الشهر التالي لنهاية الفترة.
 */
export function quarterPeriod(code: string, effectiveFrom: string | null) {
  const m = /^(\d{4})-Q([1-4])$/.exec(code);
  if (!m) return null;
  const y = Number(m[1]);
  const q = Number(m[2]);
  let from = `${y}-${String(q * 3 - 2).padStart(2, '0')}-01`;
  const to = lastDay(y, q * 3);
  if (effectiveFrom && effectiveFrom > to) return null;
  if (effectiveFrom && effectiveFrom > from) from = effectiveFrom;
  const due = q === 4 ? lastDay(y + 1, 1) : lastDay(y, q * 3 + 1);
  return { from, to, due };
}

/** تقارير الفوترة والمبيعات: سجل المبيعات، والمبيعات حسب العميل والصنف، وملخص ضريبة المخرجات، وأعمار الذمم، والمطابقة */
@Injectable()
export class BillingReports implements OnModuleInit {
  constructor(private readonly registry: ReportsRegistry, private readonly db: DataSource, private readonly ops: BillingOpsService, private readonly core: BillingCore) {}

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
        ...base, code: 'billing.vat-return', category: 'الضريبة', title: 'مسودة إقرار ضريبة القيمة المضافة',
        description: 'خانات الإقرار الربع سنوي (المبيعات والمشتريات والضريبة المستحقة) من الفواتير الصادرة وفواتير الموردين المسجلة، مع مطابقتها بحسابي الضريبة في الدليل',
        filters: [dynamicFilter('quarter', 'الفترة الضريبية', async (u) => this.quarters(u.organizationId), 'اختر الفترة', true)],
        columns: [
          { key: 'box', label: 'الخانة' }, { key: 'label', label: 'البيان' }, { key: 'amount', label: 'المبلغ (ريال)', type: 'money' },
          { key: 'adjustment', label: 'التعديلات', type: 'money' }, { key: 'vat', label: 'مبلغ الضريبة', type: 'money' },
        ],
        run: async (u, f) => this.vatReturn(org(u).organizationId, f.quarter),
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

  /** الفترات الربع سنوية (تقويمية) من ربع نفاذ التسجيل حتى الربع الحالي، الأحدث أولًا */
  private async quarters(org: string) {
    const s = await this.core.settings(org);
    const today = blToday();
    const start = s.vatEffectiveFrom ?? today;
    const out: { value: string; label: string }[] = [];
    let y = Number(start.slice(0, 4));
    let q = Math.floor((Number(start.slice(5, 7)) - 1) / 3) + 1;
    const endY = Number(today.slice(0, 4));
    const endQ = Math.floor((Number(today.slice(5, 7)) - 1) / 3) + 1;
    while ((y < endY || (y === endY && q <= endQ)) && out.length < 40) {
      const p = quarterPeriod(`${y}-Q${q}`, s.vatEffectiveFrom)!;
      out.unshift({ value: `${y}-Q${q}`, label: `الربع ${QN[q - 1]} ${y} (${p.from} إلى ${p.to})، الإقرار مستحق ${p.due}` });
      if (++q > 4) { q = 1; y++; }
    }
    return out;
  }

  /**
   * مسودة الإقرار: المبيعات من فواتير الفوترة الصادرة وإشعاراتها، والمشتريات من فواتير الموردين المسجلة في المشتريات.
   * الحساب بالهللات. الإقرار الرسمي يُعدّ ويُقدّم من بوابة الهيئة، وهذا التقرير يساعد في تعبئته ومراجعته.
   */
  private async vatReturn(org: string, quarter: string | undefined) {
    const s = await this.core.settings(org);
    const p = quarterPeriod(quarter ?? '', s.vatEffectiveFrom);
    if (!p) throw new BadRequestException('اختر الفترة الضريبية');
    const notes: string[] = [];
    // ---- المبيعات: كل سطر ضريبي في المستندات الصادرة في الفترة حسب فئته وسبب الإعفاء ----
    const sales: { kind: DocKind; category: string; reason: string | null; taxable: string; vat: string }[] = await this.db.query(
      `SELECT d.kind, b->>'category' AS category, b->>'reasonCode' AS reason, SUM((b->>'taxable')::numeric) AS taxable, SUM((b->>'vat')::numeric) AS vat
         FROM bl_documents d CROSS JOIN LATERAL jsonb_array_elements(d.breakdown) b
        WHERE d.organization_id = $1 AND d.status = ANY($2) AND d.doc_type <> 'nontax' AND d.issue_date BETWEEN $3 AND $4
        GROUP BY 1, 2, 3`, [org, ISSUED, p.from, p.to]);
    const box = (category: string, reason: string | null): 1 | 2 | 3 | 4 | 5 | null => {
      if (category === 'S') return 1;
      if (category === 'E') return 5;
      if (category === 'Z') return reason === 'VATEX-SA-HEA' || reason === 'VATEX-SA-EDU' ? 2 : reason === 'VATEX-SA-32' || reason === 'VATEX-SA-33' ? 4 : 3;
      return null; // خارج النطاق لا يدخل الإقرار
    };
    const S = new Map<number, { amount: number; adj: number; vat: number }>([1, 2, 3, 4, 5].map((n) => [n, { amount: 0, adj: 0, vat: 0 }]));
    let outOfScope = 0;
    for (const r of sales) {
      const n = box(r.category, r.reason);
      const t = toH(r.taxable);
      const v = toH(r.vat);
      if (n === null) { outOfScope += r.kind === 'credit_note' ? -t : t; continue; }
      const x = S.get(n)!;
      if (r.kind === 'credit_note') { x.adj -= t; x.vat -= v; } else { x.amount += t; x.vat += v; }
    }
    const [plain] = await this.db.query(
      `SELECT COUNT(*)::int AS n, COALESCE(SUM(CASE WHEN kind = 'credit_note' THEN -taxable ELSE taxable END), 0) AS v FROM bl_documents
        WHERE organization_id = $1 AND status = ANY($2) AND doc_type = 'nontax' AND issue_date BETWEEN $3 AND $4`, [org, ISSUED, p.from, p.to]);
    // ---- المشتريات: فواتير الموردين المسجلة في النظام المالي (قراءة فقط من نظام المشتريات) ----
    const [pr] = await this.db.query(`SELECT vat_in_cost, vat_input_account_id FROM pr_settings WHERE organization_id = $1`, [org]);
    const purchases: { kind: string; taxed: boolean; no_vat_no: boolean; base: string; vat: string; n: number }[] = await this.db.query(
      `SELECT i.kind, (i.vat > 0) AS taxed, (i.vat > 0 AND s.vat_number IS NULL) AS no_vat_no, SUM(i.subtotal) AS base, SUM(i.vat) AS vat, COUNT(*)::int AS n
         FROM pr_invoices i LEFT JOIN pr_suppliers s ON s.id = i.supplier_id AND s.organization_id = i.organization_id
        WHERE i.organization_id = $1 AND i.status = ANY($2) AND i.invoice_date BETWEEN $3 AND $4 GROUP BY 1, 2, 3`,
      [org, ['posted', 'partial', 'paid'], p.from, p.to]);
    const recoverable = pr ? !pr.vat_in_cost : false;
    const P7 = { amount: 0, adj: 0, vat: 0 };
    let zeroOrExempt = 0;
    for (const r of purchases) {
      const sign = r.kind === 'credit_note' ? -1 : 1;
      if (!r.taxed) { zeroOrExempt += sign * toH(r.base); continue; }
      if (r.no_vat_no) notes.push(`${r.n} فاتورة مورد عليها ضريبة ومورّدها بلا رقم ضريبي في سجل الموردين: تحقق أنها فواتير ضريبية قبل خصم ضريبتها.`);
      if (sign < 0) P7.adj -= toH(r.base); else P7.amount += toH(r.base);
      if (recoverable) P7.vat += sign * toH(r.vat);
    }
    if (purchases.some((r) => r.taxed) && !recoverable) notes.push('إعداد المشتريات يجعل ضريبة المشتريات جزءًا من تكلفة الصنف، فلا تظهر ضريبة مدخلات قابلة للخصم. بعد التسجيل في الضريبة غيّر الإعداد من إعدادات المستودعات في المشتريات.');
    const totalSales = [...S.values()].reduce((t, x) => ({ amount: t.amount + x.amount, adj: t.adj + x.adj, vat: t.vat + x.vat }), { amount: 0, adj: 0, vat: 0 });
    const due = totalSales.vat - P7.vat;
    const m = (h: number) => fromH(h);
    const line = (box: string, label: string, x: { amount: number; adj: number; vat: number } | null, style?: 'strong' | 'group') =>
      ({ box, label, amount: x ? m(x.amount) : null, adjustment: x ? m(x.adj) : null, vat: x ? m(x.vat) : null, ...(style ? { _style: style } : {}) });
    const rows = [
      { box: '', label: 'ضريبة القيمة المضافة على المبيعات', _style: 'group' as const },
      line('1', 'المبيعات الخاضعة للنسبة الأساسية', S.get(1)!),
      line('2', 'المبيعات للمواطنين (الخدمات الصحية الخاصة والتعليم الأهلي الخاص)', S.get(2)!),
      line('3', 'المبيعات المحلية الخاضعة للنسبة الصفرية', S.get(3)!),
      line('4', 'الصادرات', S.get(4)!),
      line('5', 'المبيعات المعفاة', S.get(5)!),
      line('6', 'إجمالي المبيعات', totalSales, 'strong'),
      { box: '', label: 'ضريبة القيمة المضافة على المشتريات', _style: 'group' as const },
      line('7', 'المشتريات الخاضعة للنسبة الأساسية', P7),
      { box: '8', label: 'الاستيرادات الخاضعة للضريبة المدفوعة في الجمارك', amount: null, adjustment: null, vat: null, _style: 'muted' as const },
      { box: '9', label: 'الاستيرادات الخاضعة للضريبة بآلية الاحتساب العكسي', amount: null, adjustment: null, vat: null, _style: 'muted' as const },
      line('10 و 11', 'المشتريات الخاضعة للنسبة الصفرية والمعفاة (بلا ضريبة)', { amount: zeroOrExempt, adj: 0, vat: 0 }),
      line('12', 'إجمالي المشتريات', { amount: P7.amount + zeroOrExempt, adj: P7.adj, vat: P7.vat }, 'strong'),
      { box: '13', label: 'إجمالي الضريبة المستحقة للفترة الحالية', amount: null, adjustment: null, vat: m(due), _style: 'strong' as const },
      { box: '14', label: 'تصحيحات من الفترات السابقة (بين ± 5,000 ريال)', amount: null, adjustment: null, vat: null, _style: 'muted' as const },
      { box: '15', label: 'ضريبة القيمة المضافة المرحّلة من الفترة السابقة', amount: null, adjustment: null, vat: null, _style: 'muted' as const },
      { box: '16', label: due >= 0 ? 'صافي الضريبة المستحقة (قبل الخانتين 14 و 15)' : 'صافي الضريبة القابلة للاسترداد أو الترحيل (قبل الخانتين 14 و 15)', amount: null, adjustment: null, vat: m(due), _style: 'strong' as const },
    ].map((r) => ({ ...r, _skipTotal: true }));
    // ---- المطابقة مع الدليل: حركة حسابي ضريبة المخرجات والمدخلات في الفترة ----
    const gl = async (id: string | null | undefined) => {
      if (!id) return null;
      const [x] = await this.db.query(
        `SELECT COALESCE(SUM(l.credit - l.debit), 0) AS v FROM acc_entry_lines l JOIN acc_entries e ON e.id = l.entry_id
          WHERE e.organization_id = $1 AND e.status = 'posted' AND e.document_date BETWEEN $2 AND $3 AND l.account_id = $4`, [org, p.from, p.to, id]);
      return toH(x.v);
    };
    const glOut = await gl(s.vatOutputAccountId);
    const glIn = recoverable ? await gl(pr?.vat_input_account_id) : null;
    if (glOut !== null && glOut !== totalSales.vat) notes.push(`حركة حساب ضريبة المخرجات في الدليل للفترة ${m(glOut)} ريال، وضريبة المبيعات هنا ${m(totalSales.vat)}: الفرق ${m(glOut - totalSales.vat)} من قيود من خارج الفوترة، فراجعه قبل تقديم الإقرار.`);
    if (glIn !== null && -glIn !== P7.vat) notes.push(`حركة حساب ضريبة المدخلات في الدليل للفترة ${m(-glIn)} ريال، وضريبة المشتريات هنا ${m(P7.vat)}: الفرق ${m(-glIn - P7.vat)} من مصروفات أو قيود من خارج المشتريات (مثل سندات الصرف المباشرة)، فأضف ما يخصها للخانة 7 بعد التحقق من فواتيرها.`);
    if (plain.n) notes.push(`${plain.n} فاتورة عادية بلا ضريبة في الفترة (${m(toH(plain.v))} ريال) لا تدخل الإقرار.`);
    if (outOfScope) notes.push(`مبيعات خارج نطاق الضريبة ${m(outOfScope)} ريال لا تدخل الإقرار.`);
    notes.push('الخانات 8 و 9 و 14 و 15 تُعبأ يدويًا من مستندات الجمارك والإقرار السابق. والإقرار الرسمي يُقدّم من بوابة هيئة الزكاة والضريبة والجمارك.');
    return {
      rows, notes,
      subtitle: `الفترة ${p.from} إلى ${p.to}${s.vatNumber ? ` · الرقم الضريبي ${s.vatNumber}` : ''} · آخر موعد للتقديم والسداد ${p.due}`,
      summary: [
        { label: 'ضريبة المبيعات', value: m(totalSales.vat), type: 'money' as const },
        { label: 'ضريبة المشتريات القابلة للخصم', value: m(P7.vat), type: 'money' as const },
        { label: due >= 0 ? 'الصافي المستحق' : 'الصافي القابل للاسترداد', value: m(Math.abs(due)), type: 'money' as const },
        { label: 'موعد التقديم', value: p.due },
      ],
    };
  }
}
