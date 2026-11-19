import { Injectable, OnModuleInit } from '@nestjs/common';
import { OrgUser } from '../../core/auth/decorators';
import { PendingTask, TasksRegistry } from '../../core/tasks/tasks.registry';
import { PROCUREMENT_PERMISSIONS as P } from './procurement.manifest';
import { SuppliersService } from './suppliers.service';
import { DataSource } from 'typeorm';
import { OrdersService } from './orders.service';
import { orderCode, requestCode, rfqCode } from './sourcing-core.service';
import { addDays, prToday } from './procurement-core.service';
import { countCode, docCode, issueRequestCode } from './stock-core.service';
import { StockService } from './stock.service';

/** مهام المشتريات في جرس الإشعارات: الموردون ومستنداتهم وحساباتهم البنكية، وطلبات الشراء والتعميدات بانتظار الاعتماد، والمنافسات بانتظار الفتح أو التقييم */
@Injectable()
export class ProcurementTasks implements OnModuleInit {
  constructor(
    private readonly registry: TasksRegistry, private readonly suppliers: SuppliersService, private readonly db: DataSource, private readonly orders: OrdersService,
    private readonly stock: StockService,
  ) {}

  onModuleInit() {
    this.registry.register({ module: 'procurement', name: 'المشتريات والمستودعات', color: '#b45309', collect: (u) => this.collect(u) });
  }

  async collect(u: OrgUser): Promise<PendingTask[]> {
    const can = (p: string) => u.isSuperadmin || u.permissions.includes(p);
    const out: PendingTask[] = [...(await this.sourcing(u, can)), ...(await this.stockTasks(u, can))];
    if (!can(P.approveSuppliers) && !can(P.approveBanks)) return out;
    const a = await this.suppliers.approvals(u);
    if (can(P.approveSuppliers)) {
      for (const s of a.suppliers) {
        out.push({ id: `pr-sup:${s.id}`, group: 'تسجيل الموردين', link: `/procurement/suppliers/${s.id}`, at: s.submittedAt, title: `طلب تسجيل مورد: ${s.name}`, subtitle: s.code });
      }
      for (const d of a.docs) {
        out.push({ id: `pr-doc:${d.id}`, group: 'مستندات الموردين', link: `/procurement/suppliers/${d.supplierId}`, at: d.createdAt, title: `مراجعة مستند «${d.title}»`, subtitle: d.supplier });
      }
    }
    if (can(P.approveBanks)) {
      for (const b of a.banks.filter((x: { mine: boolean }) => !x.mine)) {
        out.push({
          id: `pr-bank:${b.id}`, group: 'الحسابات البنكية للموردين', link: `/procurement/suppliers/${b.supplierId}`, at: b.createdAt, urgent: b.isChange,
          title: `${b.isChange ? 'تغيير' : 'اعتماد'} حساب بنكي: ${b.supplier}`, subtitle: `${b.bankName} · ${b.iban.slice(0, 4)}…${b.iban.slice(-4)}`,
        });
      }
    }
    return out;
  }

  /** مهام المستودعات: اعتماد طلبات الصرف وتنفيذها، واعتماد الإتلاف والجرد، والصلاحية القريبة، وحد إعادة الطلب، وفروق المطابقة مع الدليل */
  private async stockTasks(u: OrgUser, can: (p: string) => boolean): Promise<PendingTask[]> {
    const org = u.organizationId;
    const out: PendingTask[] = [];
    if (can(P.issueApprove)) {
      const rows: { id: string; request_no: number; purpose: string; updated_at: Date; requested_by_name: string }[] = await this.db.query(
        `SELECT id, request_no, purpose, updated_at, requested_by_name FROM pr_issue_requests
          WHERE organization_id = $1 AND status = 'submitted' AND (requested_by_id IS NULL OR requested_by_id <> $2) ORDER BY updated_at`, [org, u.id]);
      for (const r of rows) {
        out.push({ id: `pr-isr:${r.id}`, group: 'طلبات الصرف', link: `/procurement/issue-requests/${r.id}`, at: r.updated_at, title: `اعتماد طلب صرف: ${r.purpose}`, subtitle: `${issueRequestCode(r.request_no)} · ${r.requested_by_name}` });
      }
    }
    if (can(P.stockOperate)) {
      const rows: { id: string; request_no: number; purpose: string; updated_at: Date; needed_by: string | null; keeper_ids: string[] }[] = await this.db.query(
        `SELECT r.id, r.request_no, r.purpose, r.updated_at, to_char(r.needed_by, 'YYYY-MM-DD') AS needed_by, w.keeper_ids
           FROM pr_issue_requests r JOIN pr_warehouses w ON w.id = r.warehouse_id WHERE r.organization_id = $1 AND r.status IN ('approved', 'partial') ORDER BY r.updated_at`, [org]);
      for (const r of rows.filter((x) => u.isSuperadmin || !x.keeper_ids?.length || x.keeper_ids.includes(u.id))) {
        out.push({
          id: `pr-isr-issue:${r.id}`, group: 'طلبات الصرف', link: `/procurement/issue-requests/${r.id}`, at: r.updated_at, urgent: !!r.needed_by && r.needed_by <= prToday(),
          title: `صرف مواد معتمدة: ${r.purpose}`, subtitle: issueRequestCode(r.request_no),
        });
      }
      const s = await this.db.query('SELECT expiry_alert_days FROM pr_settings WHERE organization_id = $1', [org]);
      const soon = addDays(prToday(), s[0]?.expiry_alert_days ?? 60);
      const exp: { item_id: string; warehouse_id: string; name: string; wh: string; expiry: string; qty: number }[] = await this.db.query(
        `SELECT l.item_id, l.warehouse_id, i.name, w.name AS wh, to_char(MIN(l.expiry_date), 'YYYY-MM-DD') AS expiry, SUM(l.qty_left)::float AS qty
           FROM pr_stock_layers l JOIN pr_items i ON i.id = l.item_id JOIN pr_warehouses w ON w.id = l.warehouse_id
          WHERE l.organization_id = $1 AND l.qty_left > 0 AND l.expiry_date <= $2 GROUP BY 1, 2, 3, 4 ORDER BY 5 LIMIT 30`, [org, soon]);
      for (const x of exp) {
        const expired = x.expiry < prToday();
        out.push({
          id: `pr-exp:${x.item_id}:${x.warehouse_id}:${x.expiry}`, group: 'صلاحية الأصناف', link: `/procurement/stock?alert=expiry`, at: new Date(`${x.expiry}T00:00:00Z`), urgent: expired,
          title: `${expired ? 'منتهي الصلاحية' : 'صلاحية قريبة'}: ${x.name}`, subtitle: `${x.wh} · ${x.qty} · ${x.expiry}`,
        });
      }
    }
    if (can(P.stockApprove)) {
      const docs: { id: string; kind: 'writeoff'; doc_no: number; created_at: Date; created_by_id: string | null; notes: string | null }[] = await this.db.query(
        `SELECT id, kind, doc_no, created_at, created_by_id, notes FROM pr_stock_docs WHERE organization_id = $1 AND status = 'pending'`, [org]);
      for (const d of docs.filter((x) => u.isSuperadmin || x.created_by_id !== u.id)) {
        out.push({ id: `pr-wof:${d.id}`, group: 'المستودعات', link: `/procurement/stock-docs/${d.id}`, at: d.created_at, title: 'اعتماد محضر إتلاف', subtitle: `${docCode(d.kind, d.doc_no)} · ${d.notes ?? ''}`.slice(0, 120) });
      }
      const cnt: { id: string; count_no: number; updated_at: Date; submitted_by_id: string | null }[] = await this.db.query(
        `SELECT id, count_no, updated_at, submitted_by_id FROM pr_counts WHERE organization_id = $1 AND status = 'submitted'`, [org]);
      for (const c of cnt.filter((x) => u.isSuperadmin || x.submitted_by_id !== u.id)) {
        out.push({ id: `pr-cnt:${c.id}`, group: 'المستودعات', link: `/procurement/counts/${c.id}`, at: c.updated_at, title: 'اعتماد فروقات الجرد', subtitle: countCode(c.count_no) });
      }
    }
    if (can(P.stockApprove) || can(P.settings)) {
      const [{ n }] = await this.db.query('SELECT COUNT(*)::int AS n FROM pr_stock_moves WHERE organization_id = $1', [org]);
      if (n) {
        const rec = await this.stock.reconcile(org).catch(() => null);
        for (const x of rec?.accounts.filter((a) => !a.ok) ?? []) {
          out.push({
            id: `pr-rec:${x.accountId}:${x.diff}`, group: 'مطابقة المستودعات مع الدليل', link: '/procurement/warehouses?tab=reconcile', at: new Date(), urgent: true,
            title: `فرق ${Math.abs(x.diff).toLocaleString('en-US')} ريال في حساب المخزون ${x.code} ${x.name}`, subtitle: x.problems[0]?.slice(0, 140) ?? '',
          });
        }
      }
    }
    return out;
  }

  private async sourcing(u: OrgUser, can: (p: string) => boolean): Promise<PendingTask[]> {
    const org = u.organizationId;
    const out: PendingTask[] = [];
    if (can(P.approveRequests)) {
      const rows: { id: string; request_no: number; title: string; submitted_at: Date; priority: string; requested_by_name: string }[] = await this.db.query(
        `SELECT id, request_no, title, submitted_at, priority, requested_by_name FROM pr_requests
          WHERE organization_id = $1 AND status = 'submitted' AND (requested_by_id IS NULL OR requested_by_id <> $2) ORDER BY submitted_at`, [org, u.id]);
      for (const r of rows) {
        out.push({
          id: `pr-req:${r.id}`, group: 'طلبات الشراء', link: `/procurement/requests/${r.id}`, at: r.submitted_at, urgent: r.priority === 'urgent',
          title: `اعتماد طلب شراء: ${r.title}`, subtitle: `${requestCode(r.request_no)} · ${r.requested_by_name}`,
        });
      }
    }
    if (can(P.approveOrders) || can(P.approveOrdersHigh)) {
      for (const x of await this.orders.list(u, { status: 'pending', mine: '1' })) {
        const o = x as Record<string, unknown>;
        out.push({
          id: `pr-po:${o.id as string}`, group: 'التعميدات', link: `/procurement/orders/${o.id as string}`, at: o.createdAt as Date,
          title: `اعتماد تعميد: ${o.title as string}`, subtitle: `${x.code} · ${o.supplierName as string} · ${(o.total as number).toLocaleString('en-US')} ريال`,
        });
      }
    }
    if (can(P.sourcing)) {
      const rfqs: { id: string; rfq_no: number; title: string; closes_at: Date }[] = await this.db.query(
        `SELECT id, rfq_no, title, closes_at FROM pr_rfqs WHERE organization_id = $1 AND status = 'published' AND closes_at <= now()`, [org]);
      for (const q of rfqs) {
        out.push({ id: `pr-rfq-open:${q.id}`, group: 'المنافسات', link: `/procurement/rfqs/${q.id}`, at: q.closes_at, title: `فتح العروض: ${q.title}`, subtitle: rfqCode(q.rfq_no) });
      }
      const pos: { id: string; order_no: number; title: string; status: string; updated_at: Date }[] = await this.db.query(
        `SELECT id, order_no, title, status, updated_at FROM pr_orders WHERE organization_id = $1 AND status IN ('clarification', 'declined')`, [org]);
      for (const o of pos) {
        out.push({
          id: `pr-po-resp:${o.id}`, group: 'التعميدات', link: `/procurement/orders/${o.id}`, at: o.updated_at, urgent: o.status === 'declined',
          title: o.status === 'declined' ? `اعتذر المورد عن التعميد: ${o.title}` : `استفسار مورد على التعميد: ${o.title}`, subtitle: orderCode(o.order_no),
        });
      }
    }
    if (can(P.evaluate)) {
      const ev: { id: string; rfq_no: number; title: string; opened_at: Date }[] = await this.db.query(
        `SELECT q.id, q.rfq_no, q.title, q.opened_at FROM pr_rfqs q WHERE q.organization_id = $1 AND q.status = 'opened' AND q.committee_ids ? $2
            AND EXISTS (SELECT 1 FROM pr_quotes x WHERE x.rfq_id = q.id AND x.status = 'submitted' AND NOT (x.scores ? $2))
            AND EXISTS (SELECT 1 FROM jsonb_array_elements(q.criteria) c WHERE c->>'kind' = 'technical')`, [org, u.id]);
      for (const q of ev) {
        out.push({ id: `pr-rfq-eval:${q.id}`, group: 'المنافسات', link: `/procurement/rfqs/${q.id}`, at: q.opened_at, title: `تقييم العروض فنيًا: ${q.title}`, subtitle: rfqCode(q.rfq_no) });
      }
    }
    return out;
  }
}
