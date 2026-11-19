import { Injectable, OnModuleInit } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { ar, dynamicFilter, org, selectFilter } from '../../core/reports/report-helpers';
import { ReportDefinition } from '../../core/reports/report.types';
import { ReportsRegistry } from '../../core/reports/reports.registry';
import { BANK_STATUS, DOC_STATUS, ENTITY_TYPES, ITEM_KINDS, LOCATION_KINDS, LOCATION_PURPOSE, SUPPLIER_KINDS, SUPPLIER_STATUS, VALUATION, WAREHOUSE_KINDS } from './entities/procurement.entity';
import { PROCUREMENT_PERMISSIONS as P } from './procurement.manifest';
import { addDays, prToday, supplierCode } from './procurement-core.service';

/** تقارير المشتريات والمستودعات (المرحلة الأولى: البيانات الأساسية والموردون) */
@Injectable()
export class ProcurementReports implements OnModuleInit {
  constructor(private readonly registry: ReportsRegistry, private readonly db: DataSource) {}

  onModuleInit() {
    const base = { module: 'procurement', permission: P.reports };
    const groupFilter = dynamicFilter('group', 'المجموعة', async (u) =>
      this.db.query('SELECT id AS value, code || \' · \' || name AS label FROM pr_item_groups WHERE organization_id = $1 ORDER BY sort_order', [u.organizationId]));
    const categoryFilter = dynamicFilter('category', 'التصنيف', async (u) =>
      this.db.query('SELECT id::text AS value, name AS label FROM pr_supplier_categories WHERE organization_id = $1 ORDER BY sort_order', [u.organizationId]));
    const defs: ReportDefinition[] = [
      {
        ...base, code: 'procurement.items', category: 'الأصناف والمستودعات', title: 'دليل الأصناف', description: 'كل الأصناف بمجموعاتها ووحداتها وحدود إعادة الطلب وطرق التتبع',
        filters: [groupFilter, selectFilter('kind', 'النوع', ITEM_KINDS), selectFilter('status', 'الحالة', { active: 'نشط', stopped: 'موقوف' })],
        link: '/procurement/items/{id}', orientation: 'landscape',
        columns: [
          { key: 'code', label: 'الرمز' }, { key: 'name', label: 'الصنف' }, { key: 'group', label: 'المجموعة' }, { key: 'kind', label: 'النوع' }, { key: 'uom', label: 'الوحدة' },
          { key: 'barcode', label: 'الباركود' }, { key: 'tracking', label: 'التتبع' }, { key: 'minQty', label: 'الحد الأدنى', type: 'number' },
          { key: 'reorderPoint', label: 'نقطة إعادة الطلب', type: 'number' }, { key: 'maxQty', label: 'الحد الأعلى', type: 'number' },
          { key: 'refPrice', label: 'السعر المرجعي', type: 'money' }, { key: 'status', label: 'الحالة' },
        ],
        run: async (u, f) => {
          const rows = await this.db.query(
            `SELECT i.id, i.code, i.name, g.name AS "group", i.kind, u.name AS uom, i.barcode, i.track_batch, i.track_serial, i.track_expiry, i.min_qty::float AS "minQty",
                    i.reorder_point::float AS "reorderPoint", i.max_qty::float AS "maxQty", i.ref_price::float AS "refPrice", i.status
               FROM pr_items i JOIN pr_item_groups g ON g.id = i.group_id JOIN pr_uoms u ON u.id = i.uom_id
              WHERE i.organization_id = $1 AND ($2::uuid IS NULL OR i.group_id = $2::uuid) AND ($3::text IS NULL OR i.kind = $3) AND ($4::text IS NULL OR i.status = $4)
              ORDER BY i.code`, [org(u).organizationId, f.group ?? null, f.kind ?? null, f.status ?? null]);
          return rows.map((r: Record<string, unknown>) => ({
            ...r, kind: ar(ITEM_KINDS, r.kind), status: r.status === 'active' ? 'نشط' : 'موقوف', _style: r.status === 'stopped' ? 'muted' : undefined,
            tracking: [r.track_batch && 'دفعات', r.track_serial && 'أرقام تسلسلية', r.track_expiry && 'صلاحية'].filter(Boolean).join('، ') || '—',
          }));
        },
      },
      {
        ...base, code: 'procurement.groups', category: 'الأصناف والمستودعات', title: 'مجموعات الأصناف وحساباتها', description: 'المجموعات بأنواعها وحسابات المخزون والمصروف وطرق التقييم وعدد أصنافها',
        columns: [
          { key: 'code', label: 'الرمز' }, { key: 'name', label: 'المجموعة' }, { key: 'kind', label: 'النوع' }, { key: 'inventory', label: 'حساب المخزون' },
          { key: 'expense', label: 'حساب المصروف' }, { key: 'valuation', label: 'التقييم' }, { key: 'items', label: 'عدد الأصناف', type: 'number', total: true },
        ],
        run: async (u) => {
          const rows = await this.db.query(
            `SELECT g.code, g.name, g.kind, g.valuation, g.parent_id, ia.code || ' ' || ia.name AS inventory, ea.code || ' ' || ea.name AS expense,
                    (SELECT COUNT(*)::int FROM pr_items i WHERE i.group_id = g.id) AS items
               FROM pr_item_groups g LEFT JOIN acc_accounts ia ON ia.id = g.inventory_account_id LEFT JOIN acc_accounts ea ON ea.id = g.expense_account_id
              WHERE g.organization_id = $1 ORDER BY g.sort_order, g.code`, [org(u).organizationId]);
          return rows.map((r: Record<string, unknown>) => ({
            ...r, kind: ar(ITEM_KINDS, r.kind), valuation: r.valuation ? ar(VALUATION, r.valuation) : 'إعداد الجمعية', _level: r.parent_id ? 1 : 0,
            inventory: r.inventory ?? (r.kind === 'service' ? '—' : 'غير محدد'),
          }));
        },
      },
      {
        ...base, code: 'procurement.warehouses', category: 'الأصناف والمستودعات', title: 'المستودعات ومواقع التخزين', description: 'المستودعات بأنواعها وتبعيتها وأمنائها وحساباتها ومواقع التخزين بداخلها',
        orientation: 'landscape',
        columns: [
          { key: 'code', label: 'الرمز' }, { key: 'name', label: 'المستودع أو الموقع' }, { key: 'kind', label: 'النوع' }, { key: 'purpose', label: 'الاستخدام' },
          { key: 'city', label: 'المدينة' }, { key: 'keepers', label: 'أمناء المستودع' }, { key: 'account', label: 'حساب المخزون' }, { key: 'active', label: 'نشط', type: 'bool' },
        ],
        run: async (u) => {
          const o = org(u).organizationId;
          const wh = await this.db.query(
            `SELECT w.id, w.code, w.name, w.kind, w.city, w.is_active AS active, a.code || ' ' || a.name AS account,
                    (SELECT string_agg(us.full_name, '، ') FROM users us WHERE w.keeper_ids ? us.id::text) AS keepers
               FROM pr_warehouses w LEFT JOIN acc_accounts a ON a.id = w.gl_account_id WHERE w.organization_id = $1 ORDER BY w.code`, [o]);
          const locs = await this.db.query('SELECT warehouse_id, code, name, kind, purpose, is_active AS active FROM pr_locations WHERE organization_id = $1 ORDER BY sort_order, code', [o]);
          return wh.flatMap((w: Record<string, unknown>) => [
            { ...w, kind: ar(WAREHOUSE_KINDS, w.kind), _style: 'strong' as const },
            ...locs.filter((l: Record<string, unknown>) => l.warehouse_id === w.id).map((l: Record<string, unknown>) => ({
              code: `${w.code}/${l.code}`, name: l.name, kind: ar(LOCATION_KINDS, l.kind), purpose: ar(LOCATION_PURPOSE, l.purpose), active: l.active, _level: 1,
            })),
          ]);
        },
      },
      {
        ...base, code: 'procurement.suppliers', category: 'الموردون', title: 'سجل الموردين ومزودي الخدمات', description: 'الموردون بتصنيفاتهم وأنشطتهم وحالة اعتمادهم ومستنداتهم وحساباتهم البنكية',
        filters: [selectFilter('status', 'الحالة', SUPPLIER_STATUS), selectFilter('kind', 'نوع المورد', SUPPLIER_KINDS), categoryFilter], link: '/procurement/suppliers/{id}', orientation: 'landscape',
        columns: [
          { key: 'code', label: 'الرقم' }, { key: 'name', label: 'المورد' }, { key: 'entityType', label: 'الكيان' }, { key: 'kind', label: 'النوع' }, { key: 'categories', label: 'التصنيف' },
          { key: 'activities', label: 'الأنشطة' }, { key: 'city', label: 'المدينة' }, { key: 'crNumber', label: 'السجل التجاري' }, { key: 'vatNumber', label: 'الرقم الضريبي' },
          { key: 'status', label: 'الحالة' }, { key: 'hasBank', label: 'حساب بنكي معتمد', type: 'bool' }, { key: 'linked', label: 'مربوط بالمالي', type: 'bool' },
        ],
        run: async (u, f) => {
          const rows = await this.db.query(
            `SELECT s.id, s.supplier_no, s.name, s.entity_type, s.supplier_kind, s.city, s.cr_number AS "crNumber", s.vat_number AS "vatNumber", s.status,
                    (SELECT string_agg(c.name, '، ') FROM pr_supplier_categories c WHERE s.category_ids ? c.id::text) AS categories,
                    (SELECT string_agg(x, '، ') FROM jsonb_array_elements_text(s.activities) x) AS activities,
                    EXISTS (SELECT 1 FROM pr_supplier_banks b WHERE b.supplier_id = s.id AND b.status = 'approved') AS "hasBank", s.acc_partner_id IS NOT NULL AS linked
               FROM pr_suppliers s WHERE s.organization_id = $1 AND ($2::text IS NULL OR s.status = $2) AND ($3::text IS NULL OR s.supplier_kind = $3)
                AND ($4::text IS NULL OR s.category_ids ? $4) AND s.status <> 'draft'
              ORDER BY s.supplier_no`, [org(u).organizationId, f.status ?? null, f.kind ?? null, f.category ?? null]);
          return rows.map((r: Record<string, unknown>) => ({
            ...r, code: supplierCode(Number(r.supplier_no)), entityType: ar(ENTITY_TYPES, r.entity_type), kind: ar(SUPPLIER_KINDS, r.supplier_kind), status: ar(SUPPLIER_STATUS, r.status),
            _style: r.status === 'suspended' || r.status === 'rejected' ? 'muted' : undefined,
          }));
        },
      },
      {
        ...base, code: 'procurement.supplier-docs', category: 'الموردون', title: 'صلاحية مستندات الموردين', description: 'المستندات الحالية بتواريخ انتهائها، مع تمييز المنتهي والقريب من الانتهاء',
        filters: [selectFilter('state', 'الصلاحية', { expired: 'منتهية', expiring: 'تنتهي قريبًا', valid: 'سارية' }), selectFilter('status', 'حالة المراجعة', DOC_STATUS)],
        link: '/procurement/suppliers/{supplierId}', orientation: 'landscape',
        columns: [
          { key: 'supplier', label: 'المورد' }, { key: 'title', label: 'المستند' }, { key: 'number', label: 'الرقم' }, { key: 'issueDate', label: 'الإصدار', type: 'date' },
          { key: 'expiryDate', label: 'الانتهاء', type: 'date' }, { key: 'days', label: 'الأيام المتبقية', type: 'number' }, { key: 'status', label: 'المراجعة' }, { key: 'via', label: 'رُفع من' },
        ],
        run: async (u, f) => {
          const o = org(u).organizationId;
          const [s] = await this.db.query('SELECT doc_alert_days FROM pr_settings WHERE organization_id = $1', [o]);
          const t = prToday();
          const soon = addDays(t, s?.doc_alert_days ?? 30);
          const rows = await this.db.query(
            `SELECT d.supplier_id AS "supplierId", s.supplier_no, s.name AS supplier, d.title, d.number, d.issue_date::text AS "issueDate", d.expiry_date::text AS "expiryDate",
                    (d.expiry_date - $2::date) AS days, d.status, d.uploaded_via AS via
               FROM pr_supplier_docs d JOIN pr_suppliers s ON s.id = d.supplier_id
              WHERE d.organization_id = $1 AND d.is_current AND s.status <> 'draft' AND ($4::text IS NULL OR d.status = $4)
                AND ($5::text IS NULL OR ($5 = 'expired' AND d.expiry_date < $2) OR ($5 = 'expiring' AND d.expiry_date BETWEEN $2 AND $3) OR ($5 = 'valid' AND (d.expiry_date IS NULL OR d.expiry_date > $3)))
              ORDER BY d.expiry_date NULLS LAST, s.name`, [o, t, soon, f.status ?? null, f.state ?? null]);
          return rows.map((r: Record<string, unknown>) => ({
            ...r, supplier: `${supplierCode(Number(r.supplier_no))} ${r.supplier}`, status: ar(DOC_STATUS, r.status), via: r.via === 'portal' ? 'بوابة المورد' : 'موظف الجمعية',
            _style: r.expiryDate && String(r.expiryDate) < t ? 'strong' : undefined,
          }));
        },
      },
      {
        ...base, code: 'procurement.supplier-banks', category: 'الموردون', title: 'سجل الحسابات البنكية للموردين', description: 'كل طلبات إضافة الحسابات البنكية وتغييرها، ومن طلبها ومن اعتمدها (رقابة تغيير بيانات الموردين)',
        filters: [selectFilter('status', 'الحالة', BANK_STATUS)], link: '/procurement/suppliers/{supplierId}', orientation: 'landscape',
        columns: [
          { key: 'supplier', label: 'المورد' }, { key: 'bankName', label: 'البنك' }, { key: 'iban', label: 'الآيبان' }, { key: 'accountName', label: 'اسم الحساب' },
          { key: 'requestedBy', label: 'الطالب' }, { key: 'createdAt', label: 'تاريخ الطلب', type: 'datetime' }, { key: 'status', label: 'الحالة' },
          { key: 'decidedBy', label: 'المعتمد' }, { key: 'decidedAt', label: 'تاريخ القرار', type: 'datetime' },
        ],
        run: async (u, f) => {
          const rows = await this.db.query(
            `SELECT b.supplier_id AS "supplierId", s.supplier_no, s.name, b.bank_name AS "bankName", b.iban, b.account_name AS "accountName", b.requested_by_name AS "requestedBy",
                    b.created_at AS "createdAt", b.status, b.decided_by_name AS "decidedBy", b.decided_at AS "decidedAt"
               FROM pr_supplier_banks b JOIN pr_suppliers s ON s.id = b.supplier_id
              WHERE b.organization_id = $1 AND ($2::text IS NULL OR b.status = $2) ORDER BY b.created_at DESC`, [org(u).organizationId, f.status ?? null]);
          return rows.map((r: Record<string, unknown>) => ({ ...r, supplier: `${supplierCode(Number(r.supplier_no))} ${r.name}`, status: ar(BANK_STATUS, r.status) }));
        },
      },
    ];
    this.registry.register(defs);
  }
}
