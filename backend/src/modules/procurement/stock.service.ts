import { BadRequestException, Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { OrgUser } from '../../core/auth/decorators';
import { PrSettings } from './entities/procurement.entity';
import { MOVE_KINDS, MoveKind } from './entities/stock.entity';
import { PROCUREMENT_PERMISSIONS as P } from './procurement.manifest';
import { addDays, ProcurementCore, prToday } from './procurement-core.service';
import { can } from './requests.service';
import { r2 } from './sourcing-core.service';
import { q3, StockCore } from './stock-core.service';
import { StockSettingsDto } from './stock.dto';

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * أرصدة المخزون وبطاقة الصنف والصلاحية وحدود إعادة الطلب، ومطابقة قيمة أرصدة المستودعات مع حساباتها في الدليل:
 * رصيد كل حساب مخزون في النظام المالي يساوي مجموع حركات المستودعات عليه، وعند الاختلاف علامة حمراء بالسبب.
 */
@Injectable()
export class StockService {
  constructor(private readonly db: DataSource, private readonly core: ProcurementCore, private readonly stock: StockCore) {}

  // ---------------- الإعدادات ----------------

  async saveSettings(a: OrgUser, dto: StockSettingsDto) {
    const org = a.organizationId;
    await this.core.settings(org);
    await this.core.account(org, dto.grniAccountId, 'liabilities', 'حساب البضاعة المستلمة غير المفوترة');
    await this.core.account(org, dto.adjustAccountId, 'expenses', 'حساب فروقات الجرد والإتلاف');
    await this.core.account(org, dto.donationAccountId, 'revenue', 'حساب التبرعات العينية');
    await this.core.account(org, dto.openingAccountId, 'net_assets', 'الحساب المقابل للأرصدة الافتتاحية');
    await this.core.account(org, dto.defaultExpenseAccountId, 'expenses', 'حساب المصروف الافتراضي');
    if (dto.adjustAnalyticId) {
      const [x] = await this.db.query('SELECT id FROM acc_analytic_accounts WHERE organization_id = $1 AND id = $2', [org, dto.adjustAnalyticId]);
      if (!x) throw new BadRequestException('مركز التكلفة غير موجود');
    }
    await this.db.getRepository(PrSettings).update({ organizationId: org }, {
      grniAccountId: dto.grniAccountId ?? null, adjustAccountId: dto.adjustAccountId ?? null, adjustAnalyticId: dto.adjustAnalyticId ?? null,
      donationAccountId: dto.donationAccountId ?? null, openingAccountId: dto.openingAccountId ?? null, defaultExpenseAccountId: dto.defaultExpenseAccountId ?? null,
      expiryAlertDays: dto.expiryAlertDays, overReceiptPct: dto.overReceiptPct, vatInCost: dto.vatInCost, requireInspection: dto.requireInspection,
    });
    return this.core.settings(org);
  }

  /** قوائم شاشات المستودعات: الحسابات بكل طبائعها ومراكز التكلفة ومواقع التخزين ومصادر التمويل */
  async lookups(org: string) {
    const [accounts, analytics, locations, funding] = await Promise.all([
      this.db.query(`SELECT id, code, name, nature, requires_analytic AS "requiresAnalytic" FROM acc_accounts WHERE organization_id = $1 AND kind = 'sub' AND is_active ORDER BY code`, [org]),
      this.db.query('SELECT id, code, name FROM acc_analytic_accounts WHERE organization_id = $1 AND is_active ORDER BY code', [org]).catch(() => []),
      this.db.query('SELECT id, warehouse_id AS "warehouseId", code, name, purpose FROM pr_locations WHERE organization_id = $1 AND is_active ORDER BY sort_order, code', [org]),
      this.db.query(
        `SELECT id, batch_no AS "batchNo", target_name AS "targetName" FROM fundraising_batches WHERE organization_id = $1 AND status = 'active' ORDER BY batch_no`, [org]).catch(() => []),
    ]);
    return { accounts, analytics, locations, funding };
  }

  // ---------------- الأرصدة ----------------

  async balances(a: OrgUser, q: { warehouse?: string; group?: string; q?: string; alert?: string }) {
    const org = a.organizationId;
    const s = await this.core.settings(org);
    const soon = addDays(prToday(), s.expiryAlertDays);
    type Row = { itemId: string; qty: number; value: number; expired: number; expiring: number; reorderPoint: number | null; minQty: number | null } & Record<string, unknown>;
    const rows: Row[] = await this.db.query(
      `WITH RECURSIVE g AS (SELECT id FROM pr_item_groups WHERE id = $3 UNION ALL SELECT c.id FROM pr_item_groups c JOIN g ON c.parent_id = g.id),
       lay AS (SELECT item_id, warehouse_id,
                      SUM(qty_left) FILTER (WHERE expiry_date < $5) AS expired, SUM(qty_left) FILTER (WHERE expiry_date >= $5 AND expiry_date <= $6) AS expiring,
                      MIN(expiry_date) FILTER (WHERE qty_left > 0) AS next_expiry
                 FROM pr_stock_layers WHERE organization_id = $1 AND qty_left > 0 GROUP BY 1, 2)
       SELECT b.item_id AS "itemId", b.warehouse_id AS "warehouseId", b.qty::float AS qty, b.value::float AS value, i.code, i.name, i.kind, u.name AS "uomName",
              i.reorder_point::float AS "reorderPoint", i.min_qty::float AS "minQty", i.max_qty::float AS "maxQty", i.reorder_qty::float AS "reorderQty",
              w.code AS "warehouseCode", w.name AS "warehouseName", gr.name AS "groupName", COALESCE(lay.expired, 0)::float AS expired, COALESCE(lay.expiring, 0)::float AS expiring,
              to_char(lay.next_expiry, 'YYYY-MM-DD') AS "nextExpiry"
         FROM pr_stock_balances b JOIN pr_items i ON i.id = b.item_id JOIN pr_warehouses w ON w.id = b.warehouse_id JOIN pr_uoms u ON u.id = i.uom_id
         JOIN pr_item_groups gr ON gr.id = i.group_id LEFT JOIN lay ON lay.item_id = b.item_id AND lay.warehouse_id = b.warehouse_id
        WHERE b.organization_id = $1 AND ($2::uuid IS NULL OR b.warehouse_id = $2::uuid) AND ($3::uuid IS NULL OR i.group_id IN (SELECT id FROM g))
          AND ($4::text IS NULL OR i.name ILIKE '%' || $4 || '%' OR i.code ILIKE '%' || $4 || '%' OR i.barcode = $4)
          AND (b.qty <> 0 OR b.value <> 0)
        ORDER BY i.code, w.code`, [org, q.warehouse || null, q.group || null, q.q?.trim() || null, prToday(), soon]);
    // حدود إعادة الطلب على إجمالي الصنف في كل المستودعات
    const totals = new Map<string, number>();
    for (const r of rows) totals.set(r.itemId, q3((totals.get(r.itemId) ?? 0) + r.qty));
    let out = rows.map((r) => {
      const total = totals.get(r.itemId as string) ?? 0;
      const reorder = r.reorderPoint !== null && total <= (r.reorderPoint as number);
      const belowMin = r.minQty !== null && total < (r.minQty as number);
      return { ...r, avgCost: (r.qty as number) > 0 ? Math.round(((r.value as number) / (r.qty as number)) * 100) / 100 : 0, totalQty: total, reorder, belowMin };
    });
    if (q.alert === 'reorder') out = out.filter((x) => x.reorder || x.belowMin);
    if (q.alert === 'expiry') out = out.filter((x) => (x.expired as number) > 0 || (x.expiring as number) > 0);
    return {
      rows: out, expiryAlertDays: s.expiryAlertDays,
      totals: { value: r2(out.reduce((t, x) => t + (x.value as number), 0)), lines: out.length, reorder: out.filter((x) => x.reorder || x.belowMin).length, expiry: out.filter((x) => (x.expired as number) > 0 || (x.expiring as number) > 0).length },
    };
  }

  /** بطاقة الصنف: الحركات بالرصيد بعد كل حركة، والأرصدة بالتشغيلة والصلاحية */
  async card(a: OrgUser, itemId: string, q: { warehouse?: string; from?: string; to?: string }) {
    const org = a.organizationId;
    const [item] = await this.stock.items(org, [itemId]).then((m) => [...m.values()]);
    const from = q.from && DATE.test(q.from) ? q.from : null;
    const to = q.to && DATE.test(q.to) ? q.to : null;
    const moves: Record<string, unknown>[] = await this.db.query(
      `SELECT m.id, to_char(m.date, 'YYYY-MM-DD') AS date, m.kind, m.qty::float AS qty, m.value::float AS value, m.balance_qty::float AS "balanceQty", m.balance_value::float AS "balanceValue",
              m.lot, to_char(m.expiry_date, 'YYYY-MM-DD') AS "expiryDate", m.doc_type AS "docType", m.doc_id AS "docId", m.doc_code AS "docCode", m.cancelled, m.by_name AS "byName",
              w.name AS "warehouseName", l.name AS "locationName"
         FROM pr_stock_moves m JOIN pr_warehouses w ON w.id = m.warehouse_id LEFT JOIN pr_locations l ON l.id = m.location_id
        WHERE m.organization_id = $1 AND m.item_id = $2 AND ($3::uuid IS NULL OR m.warehouse_id = $3::uuid)
          AND ($4::date IS NULL OR m.date >= $4::date) AND ($5::date IS NULL OR m.date <= $5::date)
        ORDER BY m.created_at DESC LIMIT 1000`, [org, itemId, q.warehouse || null, from, to]);
    const lots = await this.db.query(
      `SELECT l.warehouse_id AS "warehouseId", w.name AS "warehouseName", l.lot, to_char(l.expiry_date, 'YYYY-MM-DD') AS "expiryDate", loc.name AS "locationName",
              SUM(l.qty_left)::float AS qty, (l.expiry_date IS NOT NULL AND l.expiry_date < $3) AS expired
         FROM pr_stock_layers l JOIN pr_warehouses w ON w.id = l.warehouse_id LEFT JOIN pr_locations loc ON loc.id = l.location_id
        WHERE l.organization_id = $1 AND l.item_id = $2 AND l.qty_left > 0 GROUP BY l.warehouse_id, w.name, l.lot, l.expiry_date, loc.name ORDER BY l.expiry_date NULLS LAST, w.name`, [org, itemId, prToday()]);
    const balances = await this.db.query(
      `SELECT b.warehouse_id AS "warehouseId", w.name AS "warehouseName", b.qty::float AS qty, b.value::float AS value FROM pr_stock_balances b JOIN pr_warehouses w ON w.id = b.warehouse_id
        WHERE b.organization_id = $1 AND b.item_id = $2 AND (b.qty <> 0 OR b.value <> 0) ORDER BY w.code`, [org, itemId]);
    return {
      item: { id: item.id, code: item.code, name: item.name, trackBatch: item.trackBatch, trackExpiry: item.trackExpiry },
      balances, lots, moves: moves.map((m) => ({ ...m, kindLabel: MOVE_KINDS[m.kind as MoveKind] })),
    };
  }

  /** الأرصدة المتاحة بالتشغيلة لصنف في مستودع (لنماذج الصرف والتحويل والإتلاف) */
  lots(a: OrgUser, itemId: string, warehouseId: string) {
    return this.stock.lots(a.organizationId, itemId, warehouseId);
  }

  // ---------------- المطابقة مع الدليل ----------------

  /**
   * رصيد كل حساب مخزون في الدليل (السنة المالية حتى التاريخ، شاملة قيدها الافتتاحي) مقابل مجموع حركات المستودعات عليه.
   * أسباب الفرق: قيود لم تصدر من المستودعات على الحساب، أو حركات بحساب تغير لاحقًا في إعدادات المجموعة أو المستودع.
   */
  async reconcile(org: string, asOfIn?: string) {
    const asOf = asOfIn && DATE.test(asOfIn) ? asOfIn : prToday();
    const s = await this.core.settings(org);
    const configured: { id: string; source: string }[] = await this.db.query(
      `SELECT inventory_account_id AS id, 'المجموعة: ' || name AS source FROM pr_item_groups WHERE organization_id = $1 AND inventory_account_id IS NOT NULL
       UNION ALL SELECT inventory_account_id, 'الصنف: ' || name FROM pr_items WHERE organization_id = $1 AND inventory_account_id IS NOT NULL
       UNION ALL SELECT gl_account_id, 'المستودع: ' || name FROM pr_warehouses WHERE organization_id = $1 AND gl_account_id IS NOT NULL AND $2 = 'warehouse'`, [org, s.accountLevel]);
    const sub: { account_id: string; value: string; moves: number }[] = await this.db.query(
      `SELECT account_id, SUM(value) AS value, COUNT(*)::int AS moves FROM pr_stock_moves WHERE organization_id = $1 AND date <= $2 AND account_id IS NOT NULL GROUP BY 1`, [org, asOf]);
    const ids = [...new Set([...configured.map((c) => c.id), ...sub.map((x) => x.account_id)])];
    if (!ids.length) return { asOf, accounts: [], ok: true, issues: 0 };
    const [year] = await this.db.query(
      `SELECT id, to_char(start_date, 'YYYY-MM-DD') AS start FROM acc_fiscal_years WHERE organization_id = $1 AND start_date <= $2 AND end_date >= $2 LIMIT 1`, [org, asOf]).catch(() => []);
    const gl: { account_id: string; bal: string }[] = await this.db.query(
      `SELECT l.account_id, SUM(l.debit - l.credit) AS bal FROM acc_entry_lines l JOIN acc_entries e ON e.id = l.entry_id
        WHERE e.organization_id = $1 AND e.status = 'posted' AND e.document_date <= $2 AND ($4::uuid IS NULL OR e.fiscal_year_id = $4::uuid) AND l.account_id = ANY($3)
        GROUP BY 1`, [org, asOf, ids, year?.id ?? null]);
    const foreign: { account_id: string; entry_id: string; entry_no: number; date: string; description: string; amount: string; source: string }[] = await this.db.query(
      `SELECT l.account_id, e.id AS entry_id, e.entry_no, to_char(e.document_date, 'YYYY-MM-DD') AS date, e.description, (l.debit - l.credit) AS amount, e.source
         FROM acc_entry_lines l JOIN acc_entries e ON e.id = l.entry_id
        WHERE e.organization_id = $1 AND e.status = 'posted' AND e.document_date <= $2 AND l.account_id = ANY($3) AND e.source NOT IN ('stock', 'system')
        ORDER BY e.document_date, e.entry_no LIMIT 200`, [org, asOf, ids]);
    const accs = await this.core.accountMap(org, ids);
    const accounts = ids.map((id) => {
      const glBal = r2(Number(gl.find((x) => x.account_id === id)?.bal ?? 0));
      const subRow = sub.find((x) => x.account_id === id);
      const subBal = r2(Number(subRow?.value ?? 0));
      const diff = r2(glBal - subBal);
      const fe = foreign.filter((x) => x.account_id === id);
      const sources = configured.filter((c) => c.id === id).map((c) => c.source);
      const problems: string[] = [];
      if (diff !== 0) {
        for (const f of fe.slice(0, 10)) {
          problems.push(`قيد رقم ${f.entry_no} بتاريخ ${f.date} بمبلغ ${Math.abs(Number(f.amount)).toLocaleString('en')} ريال لم يصدر من المستودعات: ${f.description}`);
        }
        if (!sources.length && subRow) problems.push('على الحساب حركات مخزون سابقة، ولم يعد مرتبطًا بأي مجموعة أو صنف أو مستودع (تغير الحساب في الإعدادات بعد الحركات)');
        if (!problems.length) problems.push('راجع كشف الحساب في النظام المالي مقارنة ببطاقات الأصناف وحركات المستودعات');
      }
      const a = accs.get(id);
      return {
        accountId: id, code: a?.code ?? '', name: a?.name ?? '', sources, gl: glBal, subledger: subBal, diff, ok: diff === 0, problems, moves: subRow?.moves ?? 0,
        foreignEntries: fe.map((f) => ({ id: f.entry_id, entryNo: f.entry_no, date: f.date, description: f.description, amount: Number(f.amount) })),
      };
    });
    return { asOf, accounts, ok: accounts.every((x) => x.ok), issues: accounts.filter((x) => !x.ok).length };
  }

  // ---------------- اللوحة ----------------

  async summary(a: OrgUser) {
    const org = a.organizationId;
    const s = await this.core.settings(org);
    const today = prToday();
    const soon = addDays(today, s.expiryAlertDays);
    const [[v], [exp], reorder, [isr], [docs], [cnt], [rc], due, rec, byWh] = await Promise.all([
      this.db.query(`SELECT COALESCE(SUM(value), 0)::float AS value, COUNT(*) FILTER (WHERE qty > 0)::int AS lines FROM pr_stock_balances WHERE organization_id = $1`, [org]),
      this.db.query(
        `SELECT COUNT(DISTINCT (item_id, warehouse_id, lot, expiry_date)) FILTER (WHERE expiry_date < $2)::int AS expired,
                COUNT(DISTINCT (item_id, warehouse_id, lot, expiry_date)) FILTER (WHERE expiry_date >= $2 AND expiry_date <= $3)::int AS expiring
           FROM pr_stock_layers WHERE organization_id = $1 AND qty_left > 0`, [org, today, soon]),
      this.db.query(
        `SELECT i.id, i.code, i.name, SUM(b.qty)::float AS qty, i.reorder_point::float AS "reorderPoint", i.reorder_qty::float AS "reorderQty"
           FROM pr_items i LEFT JOIN pr_stock_balances b ON b.item_id = i.id
          WHERE i.organization_id = $1 AND i.status = 'active' AND i.kind IN ('stock', 'consumable') AND i.reorder_point IS NOT NULL
          GROUP BY i.id HAVING COALESCE(SUM(b.qty), 0) <= i.reorder_point ORDER BY i.code LIMIT 20`, [org]),
      this.db.query(`SELECT COUNT(*) FILTER (WHERE status = 'submitted')::int AS submitted, COUNT(*) FILTER (WHERE status IN ('approved', 'partial'))::int AS "toIssue"
                       FROM pr_issue_requests WHERE organization_id = $1`, [org]),
      this.db.query(`SELECT COUNT(*) FILTER (WHERE status = 'pending')::int AS "pendingWriteoffs",
                            COALESCE(SUM(total) FILTER (WHERE kind = 'issue' AND status = 'posted' AND date >= date_trunc('month', $2::date)), 0)::float AS "issuedMonth"
                       FROM pr_stock_docs WHERE organization_id = $1`, [org, today]),
      this.db.query(`SELECT COUNT(*) FILTER (WHERE status = 'open')::int AS open, COUNT(*) FILTER (WHERE status = 'submitted')::int AS submitted FROM pr_counts WHERE organization_id = $1`, [org]),
      this.db.query(`SELECT COUNT(*) FILTER (WHERE status = 'posted' AND date >= date_trunc('month', $2::date))::int AS month,
                            COALESCE(SUM(total) FILTER (WHERE status = 'posted' AND kind = 'donation'), 0)::float AS donations FROM pr_receipts WHERE organization_id = $1`, [org, today]),
      this.db.query(
        `SELECT o.id, o.order_no AS "orderNo", o.title, o.status, to_char(o.delivery_date, 'YYYY-MM-DD') AS "deliveryDate", s.name AS "supplierName"
           FROM pr_orders o JOIN pr_suppliers s ON s.id = o.supplier_id
          WHERE o.organization_id = $1 AND o.status IN ('issued', 'acknowledged', 'accepted', 'clarification', 'partial') ORDER BY o.delivery_date NULLS LAST LIMIT 10`, [org]),
      this.reconcile(org).catch(() => null),
      this.db.query(
        `SELECT w.name, COALESCE(SUM(b.value), 0)::float AS value FROM pr_warehouses w LEFT JOIN pr_stock_balances b ON b.warehouse_id = w.id
          WHERE w.organization_id = $1 AND w.is_active GROUP BY w.id, w.name, w.code ORDER BY w.code`, [org]),
    ]);
    return {
      value: v.value, lines: v.lines, expired: exp.expired, expiring: exp.expiring, expiryAlertDays: s.expiryAlertDays, reorder, issueRequests: isr, docs, counts: cnt, receipts: rc,
      dueOrders: due.map((o: { deliveryDate: string | null }) => ({ ...o, late: !!o.deliveryDate && o.deliveryDate < today })),
      reconcile: rec ? { ok: rec.ok, issues: rec.issues, accounts: rec.accounts.filter((x) => !x.ok).map((x) => ({ code: x.code, name: x.name, diff: x.diff })) } : null,
      byWarehouse: byWh,
      configured: { grni: !!s.grniAccountId, adjust: !!s.adjustAccountId, donation: !!s.donationAccountId },
      can: { operate: can(a, P.stockOperate), approve: can(a, P.stockApprove) },
    };
  }
}
