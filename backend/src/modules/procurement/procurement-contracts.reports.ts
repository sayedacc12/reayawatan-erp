import { Injectable, OnModuleInit } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { ar, org, periodFilters, r2, selectFilter } from '../../core/reports/report-helpers';
import { ReportDefinition, ReportRow } from '../../core/reports/report.types';
import { ReportsRegistry } from '../../core/reports/reports.registry';
import { CONTRACT_KINDS, CONTRACT_STATUS, EVAL_KINDS, GRADES, SUPPLIER_EVAL_STATUS } from './entities/contract.entity';
import { INVOICE_KINDS, INVOICE_STATUS } from './entities/invoice.entity';
import { contractCode } from './contracts.service';
import { evalCode } from './evaluations.service';
import { InsightsService } from './insights.service';
import { invoiceCode } from './invoices.service';
import { PROCUREMENT_PERMISSIONS as P } from './procurement.manifest';
import { prToday, supplierCode } from './procurement-core.service';


/** تقارير المرحلتين الرابعة والخامسة: الفواتير وأعمار المستحقات، والعقود والتزاماتها، وتقييم الموردين، والرقابة ومؤشرات الأداء */
@Injectable()
export class ProcurementContractsReports implements OnModuleInit {
  constructor(private readonly registry: ReportsRegistry, private readonly db: DataSource, private readonly insights: InsightsService) {}

  onModuleInit() {
    const base = { module: 'procurement', permission: P.reports };
    const defs: ReportDefinition[] = [
      {
        ...base, code: 'procurement.invoices', category: 'الفواتير والمستحقات', title: 'فواتير الموردين ومطابقتها',
        description: 'الفواتير والإشعارات الدائنة بحالتها ونتيجة المطابقة الثلاثية والمسدد والمتبقي',
        filters: [...periodFilters('الفاتورة'), selectFilter('status', 'الحالة', INVOICE_STATUS), selectFilter('kind', 'النوع', INVOICE_KINDS)],
        link: '/procurement/invoices/{id}', orientation: 'landscape',
        columns: [
          { key: 'code', label: 'الرقم' }, { key: 'kind', label: 'النوع' }, { key: 'supplier', label: 'المورد' }, { key: 'supplierInvoiceNo', label: 'رقم فاتورة المورد' },
          { key: 'invoiceDate', label: 'التاريخ', type: 'date' }, { key: 'dueDate', label: 'الاستحقاق', type: 'date' },
          { key: 'total', label: 'الإجمالي', type: 'money', total: true }, { key: 'paid', label: 'المسدد', type: 'money', total: true },
          { key: 'left', label: 'المتبقي', type: 'money', total: true }, { key: 'match', label: 'المطابقة' }, { key: 'status', label: 'الحالة' },
        ],
        run: async (u, f) => {
          const rows: Record<string, unknown>[] = await this.db.query(
            `SELECT i.id, i.invoice_no, i.kind, s.supplier_no, s.name AS supplier, i.supplier_invoice_no AS "supplierInvoiceNo", i.invoice_date::text AS "invoiceDate",
                    i.due_date::text AS "dueDate", i.total::float AS total, i.paid_amount::float AS paid, i.credited_amount::float AS credited, i.status,
                    (i.match->>'ok')::boolean AS ok, i.override IS NOT NULL AS overridden
               FROM pr_invoices i JOIN pr_suppliers s ON s.id = i.supplier_id AND s.organization_id = i.organization_id
              WHERE i.organization_id = $1 AND i.invoice_date BETWEEN $2 AND $3 AND ($4::text IS NULL OR i.status = $4) AND ($5::text IS NULL OR i.kind = $5)
              ORDER BY i.invoice_no DESC`, [org(u).organizationId, f.from, f.to, f.status ?? null, f.kind ?? null]);
          return rows.map((r) => {
            const sign = r.kind === 'credit_note' ? -1 : 1;
            const booked = ['posted', 'partial', 'paid'].includes(String(r.status));
            const total = sign * Number(r.total);
            const paid = sign * Number(r.paid);
            return {
              ...r, code: invoiceCode(r.kind as 'invoice', Number(r.invoice_no)), kind: ar(INVOICE_KINDS, r.kind), status: ar(INVOICE_STATUS, r.status),
              supplier: `${supplierCode(Number(r.supplier_no))} ${r.supplier}`, total, paid,
              left: booked && sign > 0 ? r2(Number(r.total) - Number(r.paid) - Number(r.credited)) : 0,
              match: r.ok === null ? '—' : r.ok ? 'مطابقة' : r.overridden ? 'معتمدة بتجاوز' : 'غير مطابقة',
              _style: ['cancelled', 'rejected'].includes(String(r.status)) ? 'muted' : r.ok === false ? 'strong' : undefined,
            };
          });
        },
      },
      {
        ...base, code: 'procurement.payables-aging', category: 'الفواتير والمستحقات', title: 'أعمار مستحقات الموردين',
        description: 'المتبقي على الفواتير المسجلة في المالي لكل مورد، موزعًا حسب أيام التأخر عن الاستحقاق',
        drill: { report: 'procurement.invoices', filters: {} },
        columns: [
          { key: 'supplier', label: 'المورد' }, { key: 'current', label: 'غير مستحق بعد', type: 'money', total: true },
          { key: 'd30', label: '1 إلى 30 يومًا', type: 'money', total: true }, { key: 'd60', label: '31 إلى 60', type: 'money', total: true },
          { key: 'd90', label: '61 إلى 90', type: 'money', total: true }, { key: 'over', label: 'أكثر من 90', type: 'money', total: true },
          { key: 'total', label: 'الإجمالي', type: 'money', total: true },
        ],
        run: async (u) => {
          const today = prToday();
          const rows: { supplier_no: number; supplier: string; due: string; left: number }[] = await this.db.query(
            `SELECT s.supplier_no, s.name AS supplier, COALESCE(i.due_date, i.invoice_date)::text AS due,
                    (i.total - i.paid_amount - i.credited_amount)::float AS left
               FROM pr_invoices i JOIN pr_suppliers s ON s.id = i.supplier_id AND s.organization_id = i.organization_id
              WHERE i.organization_id = $1 AND i.kind = 'invoice' AND i.status IN ('posted', 'partial') AND i.total - i.paid_amount - i.credited_amount > 0.004
              ORDER BY s.name`, [org(u).organizationId]);
          const by = new Map<string, Record<string, number | string>>();
          for (const r of rows) {
            const key = `${supplierCode(Number(r.supplier_no))} ${r.supplier}`;
            const row = by.get(key) ?? { supplier: key, current: 0, d30: 0, d60: 0, d90: 0, over: 0, total: 0 };
            const late = Math.floor((Date.parse(today) - Date.parse(r.due)) / 86400_000);
            const bucket = late <= 0 ? 'current' : late <= 30 ? 'd30' : late <= 60 ? 'd60' : late <= 90 ? 'd90' : 'over';
            row[bucket] = r2(Number(row[bucket]) + r.left) as number;
            row.total = r2(Number(row.total) + r.left) as number;
            by.set(key, row);
          }
          return { rows: [...by.values()].map((r) => ({ ...r, _style: Number(r.over) > 0 ? 'strong' : undefined })), notes: ['المبالغ شاملة الضريبة، بعد خصم المسدد والإشعارات الدائنة.'] };
        },
      },
      {
        ...base, code: 'procurement.contracts', category: 'العقود والموردون', title: 'العقود والتزاماتها',
        description: 'العقود بقيمتها والمستخدم منها بالتعميدات والمتبقي والجزاءات المعتمدة ومدة السريان',
        filters: [selectFilter('status', 'الحالة', CONTRACT_STATUS), selectFilter('kind', 'النوع', CONTRACT_KINDS)],
        link: '/procurement/contracts/{id}', orientation: 'landscape',
        columns: [
          { key: 'code', label: 'الرقم' }, { key: 'title', label: 'العقد' }, { key: 'kind', label: 'النوع' }, { key: 'supplier', label: 'المورد' },
          { key: 'startsOn', label: 'البداية', type: 'date' }, { key: 'endsOn', label: 'النهاية', type: 'date' },
          { key: 'value', label: 'القيمة', type: 'money', total: true }, { key: 'used', label: 'المستخدم', type: 'money', total: true },
          { key: 'left', label: 'المتبقي', type: 'money', total: true }, { key: 'penalties', label: 'الجزاءات المعتمدة', type: 'money', total: true },
          { key: 'partner', label: 'عقد مشترك' }, { key: 'status', label: 'الحالة' },
        ],
        run: async (u, f) => {
          const rows: Record<string, unknown>[] = await this.db.query(
            `SELECT c.id, c.contract_no, c.title, c.kind, s.supplier_no, s.name AS supplier, c.starts_on::text AS "startsOn", c.ends_on::text AS "endsOn",
                    c.value::float AS value, c.status, c.alert_pct, c.alert_days, c.pt_contract_id IS NOT NULL AS partner,
                    (SELECT COALESCE(SUM(o.total), 0) FROM pr_orders o WHERE o.organization_id = c.organization_id AND o.contract_id = c.id AND o.status IN ('pending', 'issued', 'acknowledged', 'accepted', 'clarification', 'partial', 'closed'))::float AS used,
                    (SELECT COALESCE(SUM((p->>'amount')::numeric), 0) FROM jsonb_array_elements(c.penalties) p WHERE p->>'status' = 'approved')::float AS penalties
               FROM pr_contracts c JOIN pr_suppliers s ON s.id = c.supplier_id AND s.organization_id = c.organization_id
              WHERE c.organization_id = $1 AND ($2::text IS NULL OR c.status = $2) AND ($3::text IS NULL OR c.kind = $3) ORDER BY c.contract_no DESC`,
            [org(u).organizationId, f.status ?? null, f.kind ?? null]);
          const today = prToday();
          return rows.map((r) => {
            const value = Number(r.value);
            const used = Number(r.used);
            const daysLeft = Math.floor((Date.parse(String(r.endsOn)) - Date.parse(today)) / 86400_000);
            const alert = r.status === 'active' && ((value > 0 && (used / value) * 100 >= Number(r.alert_pct)) || daysLeft <= Number(r.alert_days));
            return {
              ...r, code: contractCode(Number(r.contract_no)), kind: ar(CONTRACT_KINDS, r.kind), status: ar(CONTRACT_STATUS, r.status),
              supplier: `${supplierCode(Number(r.supplier_no))} ${r.supplier}`, left: r2(value - used), partner: r.partner ? 'نعم' : '—',
              _style: alert ? 'strong' : ['cancelled', 'terminated', 'closed'].includes(String(r.status)) ? 'muted' : undefined,
            };
          });
        },
      },
      {
        ...base, code: 'procurement.evaluations', category: 'العقود والموردون', title: 'تقييم أداء الموردين',
        description: 'التقييمات المعتمدة وغيرها بدرجاتها وتقديراتها ورد المورد عليها',
        filters: [selectFilter('status', 'الحالة', SUPPLIER_EVAL_STATUS), selectFilter('grade', 'التقدير', GRADES)],
        link: '/procurement/evaluations/{id}', orientation: 'landscape',
        columns: [
          { key: 'code', label: 'الرقم' }, { key: 'supplier', label: 'المورد' }, { key: 'kind', label: 'النوع' }, { key: 'period', label: 'الفترة' },
          { key: 'total', label: 'الدرجة', type: 'number' }, { key: 'grade', label: 'التقدير' }, { key: 'evaluator', label: 'المقيّم' },
          { key: 'approvedBy', label: 'المعتمد' }, { key: 'response', label: 'رد المورد' }, { key: 'status', label: 'الحالة' },
        ],
        run: async (u, f) => {
          const rows: Record<string, unknown>[] = await this.db.query(
            `SELECT e.id, e.eval_no, s.supplier_no, s.name AS supplier, e.kind, e.period_from::text AS pf, e.period_to::text AS pt, e.total::float AS total, e.grade,
                    e.evaluator_name AS evaluator, e.approved_by_name AS "approvedBy", e.supplier_response IS NOT NULL AS responded, e.status
               FROM pr_supplier_evaluations e JOIN pr_suppliers s ON s.id = e.supplier_id AND s.organization_id = e.organization_id
              WHERE e.organization_id = $1 AND ($2::text IS NULL OR e.status = $2) AND ($3::text IS NULL OR e.grade = $3) ORDER BY e.eval_no DESC`,
            [org(u).organizationId, f.status ?? null, f.grade ?? null]);
          return rows.map((r) => ({
            ...r, code: evalCode(Number(r.eval_no)), supplier: `${supplierCode(Number(r.supplier_no))} ${r.supplier}`, kind: ar(EVAL_KINDS, r.kind),
            period: `${r.pf} إلى ${r.pt}`, grade: `${r.grade} · ${ar(GRADES, r.grade)}`, status: ar(SUPPLIER_EVAL_STATUS, r.status), response: r.responded ? 'ردّ' : '—',
            _style: r.grade === 'D' ? 'strong' : undefined,
          }));
        },
      },
      {
        ...base, code: 'procurement.controls', category: 'الرقابة والأداء', title: 'استثناءات الرقابة على المشتريات',
        description: 'الفواتير المعتمدة بتجاوز، والمحتملة التكرار، واحتمال تجزئة الشراء، وتغيير الحسابات البنكية، وفروقات الجرد، والجزاءات المعلقة',
        columns: [{ key: 'check', label: 'الفحص' }, { key: 'item', label: 'البند' }, { key: 'detail', label: 'التفاصيل' }],
        run: async (u) => {
          const { checks } = await this.insights.controls(org(u));
          const rows: ReportRow[] = [];
          for (const c of checks) {
            rows.push({ check: c.title, item: `${c.count} حالة`, detail: '', _level: 0, _style: c.count ? 'strong' : 'muted' });
            for (const x of c.rows) rows.push({ check: '', item: x.label, detail: x.detail ?? '', _level: 1 });
          }
          return rows;
        },
      },
      {
        ...base, code: 'procurement.kpis', category: 'الرقابة والأداء', title: 'مؤشرات أداء المشتريات والمستودعات',
        description: 'مدة دورة الشراء، والتوريد في الموعد، ومراجعة الفواتير، والوفورات، ودقة المخزون ودورانه، وتقييم الموردين، واستخدام العقود',
        filters: periodFilters(),
        columns: [
          { key: 'name', label: 'المؤشر' }, { key: 'value', label: 'القيمة', type: 'number' }, { key: 'unit', label: 'الوحدة' },
          { key: 'target', label: 'المستهدف', type: 'number' }, { key: 'met', label: 'التحقق' }, { key: 'note', label: 'ملاحظة' },
        ],
        run: async (u, f) => {
          const r = await this.insights.kpis(org(u), { from: f.from, to: f.to });
          return r.kpis.map((k) => ({
            ...k, met: k.met === null ? '—' : k.met ? 'محقق' : 'غير محقق', _style: k.met === false ? 'strong' : undefined,
          }));
        },
      },
    ];
    this.registry.register(defs);
  }
}
