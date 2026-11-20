import { ForbiddenException, Injectable } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { DataSource } from 'typeorm';
import { OrgUser } from '../../core/auth/decorators';
import { KpiQueryDto } from './contract.dto';
import { canAudit, canRisk } from './contracts.service';
import { GRADES } from './entities/contract.entity';
import { PROCUREMENT_PERMISSIONS as P } from './procurement.manifest';
import { addDays, ProcurementCore, prToday, supplierCode } from './procurement-core.service';
import { can } from './requests.service';
import { orderCode, r2, sourcingSettings } from './sourcing-core.service';

interface RiskLookup { listRisks(orgId: string): Promise<{ id: string; code: string; title: string; score: number | null; level: string; levelLabel?: string; status?: string; category?: string | null }[]> }
export interface Signal { kind: string; level: 'high' | 'medium' | 'low'; title: string; detail: string; link: string | null }

const ACTION_STATUS: Record<string, string> = { open: 'مفتوحة', in_progress: 'قيد التنفيذ', pending_verification: 'بانتظار التحقق', closed: 'مغلقة', overdue: 'متأخرة' };

/**
 * الرقابة والمخاطر والأداء في المشتريات والمستودعات:
 * - مؤشرات المخاطر (الاعتماد على مورد واحد، التأخير، التالف، الموردون الضعفاء، العقود والضمانات القريبة الانتهاء) والمخاطر المرتبطة من سجل المخاطر.
 * - الفحوص الرقابية (تجاوز المطابقة، احتمال التكرار، تجزئة الشراء، تغيير الحسابات البنكية، فروقات الجرد).
 * - توصيات المراجعة الداخلية في مجالات المشتريات (قراءة فقط، دون أي صلاحية تنفيذية للمراجعة).
 * - مؤشرات الأداء: مدة دورة الشراء، الالتزام بالمواعيد، مدة معالجة الفواتير، الوفورات، دقة المخزون ودورانه، تقدير الموردين.
 */
@Injectable()
export class InsightsService {
  constructor(private readonly db: DataSource, private readonly core: ProcurementCore, private readonly moduleRef: ModuleRef) {}

  private assert(a: OrgUser, kpis = false) {
    if (![P.reports, ...(kpis ? [P.read] : []), P.contracts, P.contractsApprove, P.evaluationsApprove, P.approveOrders, P.approveOrdersHigh].some((x) => can(a, x))) {
      throw new ForbiddenException('لا تملك صلاحية الرقابة ومؤشرات المشتريات');
    }
  }

  private riskLookup(): RiskLookup | null {
    try {
      return this.moduleRef.get<RiskLookup>('RISK_REGISTER_LOOKUP', { strict: false });
    } catch {
      return null;
    }
  }

  /** مؤشرات مخاطر التوريد والتعاقد والتخزين، والمخاطر المرتبطة بالعقود من سجل المخاطر */
  async risks(a: OrgUser) {
    this.assert(a);
    const org = a.organizationId;
    const since = addDays(prToday(), -365);
    const today = prToday();
    const signals: Signal[] = [];

    // الاعتماد على مورد واحد: حصة المورد من قيمة التعميدات في آخر سنة
    const spend: { id: string; name: string; supplierNo: number; t: number }[] = await this.db.query(
      `SELECT s.id, s.name, s.supplier_no AS "supplierNo", SUM(o.total)::float AS t FROM pr_orders o JOIN pr_suppliers s ON s.id = o.supplier_id AND s.organization_id = o.organization_id
        WHERE o.organization_id = $1 AND o.status IN ('issued', 'acknowledged', 'accepted', 'clarification', 'partial', 'closed') AND o.issued_at::date >= $2
        GROUP BY 1, 2, 3 ORDER BY t DESC`, [org, since]);
    const all = spend.reduce((t, x) => t + x.t, 0);
    for (const x of spend) {
      const share = all ? (x.t / all) * 100 : 0;
      if (share >= 40 && spend.length > 0) {
        signals.push({ kind: 'concentration', level: share >= 60 ? 'high' : 'medium', title: `اعتماد مرتفع على مورد واحد: ${x.name}`,
          detail: `${Math.round(share)}% من قيمة التعميدات في آخر سنة (${r2(x.t)} من ${r2(all)}). يُقترح تأهيل مورد بديل.`, link: `/procurement/suppliers/${x.id}` });
      }
    }
    // التأخير والتالف لكل مورد (3 توريدات على الأقل)
    const perf: { id: string; name: string; n: number; late: number; acc: number; rej: number }[] = await this.db.query(
      `SELECT s.id, s.name, COUNT(DISTINCT r.id)::int AS n,
              COUNT(DISTINCT r.id) FILTER (WHERE o.delivery_date IS NOT NULL AND r.date > o.delivery_date)::int AS late,
              COALESCE(SUM((l->>'acceptedQty')::numeric), 0)::float AS acc, COALESCE(SUM(COALESCE((l->>'rejectedQty')::numeric, 0)), 0)::float AS rej
         FROM pr_receipts r JOIN pr_orders o ON o.id = r.order_id AND o.organization_id = r.organization_id
         JOIN pr_suppliers s ON s.id = o.supplier_id AND s.organization_id = o.organization_id, jsonb_array_elements(r.lines) l
        WHERE r.organization_id = $1 AND r.status = 'posted' AND r.date >= $2 GROUP BY 1, 2`, [org, since]);
    for (const x of perf) {
      if (x.n >= 3 && x.late / x.n >= 0.2) {
        signals.push({ kind: 'late', level: x.late / x.n >= 0.4 ? 'high' : 'medium', title: `تأخر متكرر في التوريد: ${x.name}`, detail: `${x.late} من ${x.n} توريدات بعد الموعد`, link: `/procurement/suppliers/${x.id}` });
      }
      const tot = x.acc + x.rej;
      if (tot > 0 && x.rej / tot >= 0.05) {
        signals.push({ kind: 'quality', level: x.rej / tot >= 0.1 ? 'high' : 'medium', title: `نسبة تالف أو مرفوض مرتفعة: ${x.name}`, detail: `${Math.round((x.rej / tot) * 1000) / 10}% من الكميات المستلمة رُفضت`, link: `/procurement/suppliers/${x.id}` });
      }
    }
    // التعميدات المتأخرة المفتوحة
    const late: { id: string; orderNo: number; title: string; supplier: string; days: number }[] = await this.db.query(
      `SELECT o.id, o.order_no AS "orderNo", o.title, s.name AS supplier, ($2::date - o.delivery_date)::int AS days
         FROM pr_orders o JOIN pr_suppliers s ON s.id = o.supplier_id AND s.organization_id = o.organization_id
        WHERE o.organization_id = $1 AND o.status IN ('issued', 'acknowledged', 'accepted', 'clarification', 'partial') AND o.delivery_date < $2 ORDER BY o.delivery_date LIMIT 20`, [org, today]);
    for (const o of late) {
      signals.push({ kind: 'overdue', level: o.days > 14 ? 'high' : 'medium', title: `تعميد متأخر التسليم ${orderCode(o.orderNo)}`, detail: `${o.supplier}: متأخر ${o.days} يومًا (${o.title})`, link: `/procurement/orders/${o.id}` });
    }
    // الموردون ذوو التقدير الضعيف
    const weak: { id: string; name: string; rating: number }[] = await this.db.query(
      `SELECT id, name, rating::float AS rating FROM pr_suppliers WHERE organization_id = $1 AND grade = 'D' AND status = 'approved'`, [org]);
    for (const s of weak) signals.push({ kind: 'weak', level: 'high', title: `مورد تحت الرقابة: ${s.name}`, detail: `آخر تقييم ${s.rating} (${GRADES.D})`, link: `/procurement/suppliers/${s.id}` });
    // العقود: الانتهاء القريب وبلوغ السقف والضمانات
    const contracts: { id: string; contractNo: number; title: string; endsOn: string; value: number; alertPct: number; alertDays: number; guarantees: { kind: string; ref: string | null; expiresOn: string | null; released: boolean }[]; used: number; riskIds: string[] }[] =
      await this.db.query(
        `SELECT c.id, c.contract_no AS "contractNo", c.title, to_char(c.ends_on, 'YYYY-MM-DD') AS "endsOn", c.value::float AS value, c.alert_pct AS "alertPct", c.alert_days AS "alertDays",
                c.guarantees, c.risk_ids AS "riskIds",
                COALESCE((SELECT SUM(o.total) FROM pr_orders o WHERE o.organization_id = c.organization_id AND o.contract_id = c.id
                           AND o.status IN ('pending', 'issued', 'acknowledged', 'accepted', 'clarification', 'partial', 'closed')), 0)::float AS used
           FROM pr_contracts c WHERE c.organization_id = $1 AND c.status IN ('active', 'suspended')`, [org]);
    for (const c of contracts) {
      const code = `CT-${String(c.contractNo).padStart(4, '0')}`;
      if (c.endsOn <= addDays(today, c.alertDays)) {
        signals.push({ kind: 'contract_end', level: c.endsOn < today ? 'high' : 'medium', title: `${c.endsOn < today ? 'انتهت مدة' : 'قرب انتهاء'} العقد ${code}`, detail: `${c.title}: ينتهي ${c.endsOn}. استمرارية التوريد تحتاج تجديدًا أو بديلًا.`, link: `/procurement/contracts/${c.id}` });
      }
      if (c.value && (c.used / c.value) * 100 >= c.alertPct) {
        signals.push({ kind: 'contract_cap', level: c.used >= c.value ? 'high' : 'medium', title: `العقد ${code} قارب سقفه`, detail: `المستخدم ${r2(c.used)} من ${c.value} (${Math.round((c.used / c.value) * 100)}%)`, link: `/procurement/contracts/${c.id}` });
      }
      for (const g of c.guarantees ?? []) {
        if (!g.released && g.expiresOn && g.expiresOn <= addDays(today, 30)) {
          signals.push({ kind: 'guarantee', level: g.expiresOn < today ? 'high' : 'medium', title: `ضمان ينتهي على العقد ${code}`, detail: `${g.ref ?? ''} ينتهي ${g.expiresOn}`.trim(), link: `/procurement/contracts/${c.id}` });
        }
      }
    }
    // المخزون: أصناف منتهية الصلاحية أو تحت حد إعادة الطلب تؤثر على مستوى الخدمة
    const [exp] = await this.db.query(
      `SELECT COUNT(DISTINCT item_id)::int AS n, COALESCE(SUM(qty_left * unit_cost), 0)::float AS v FROM pr_stock_layers
        WHERE organization_id = $1 AND qty_left > 0 AND expiry_date IS NOT NULL AND expiry_date < $2`, [org, today]);
    if (exp.n) signals.push({ kind: 'expired', level: 'medium', title: 'مخزون منتهي الصلاحية', detail: `${exp.n} صنف بقيمة ${r2(exp.v)} ينتظر الإتلاف`, link: '/procurement/stock' });

    // المخاطر المرتبطة من سجل المخاطر (عبر واجهة نظام المخاطر، قراءة فقط)
    const ids = [...new Set(contracts.flatMap((c) => c.riskIds ?? []))];
    const reg = canRisk(a) ? this.riskLookup() : null;
    const all_ = reg ? await reg.listRisks(org).catch(() => []) : [];
    const linked = all_.filter((r) => ids.includes(r.id)).map((r) => ({
      id: r.id, code: r.code, title: r.title, score: r.score, level: r.level, levelLabel: r.levelLabel ?? r.level, status: r.status ?? null,
      contracts: contracts.filter((c) => (c.riskIds ?? []).includes(r.id)).map((c) => ({ id: c.id, code: `CT-${String(c.contractNo).padStart(4, '0')}` })),
    }));
    const procurementRisks = all_.filter((r) => !ids.includes(r.id) && /(مورد|توريد|مشتري|مخزون|مستودع|تعاقد|عقد)/.test(`${r.title} ${r.category ?? ''}`))
      .map((r) => ({ id: r.id, code: r.code, title: r.title, score: r.score, level: r.level, levelLabel: r.levelLabel ?? r.level, status: r.status ?? null, contracts: [] }));
    const order = { high: 0, medium: 1, low: 2 };
    signals.sort((x, y) => order[x.level] - order[y.level]);
    return {
      signals, riskRegister: [...linked, ...procurementRisks], riskModule: !!reg, riskAllowed: canRisk(a),
      concentration: spend.slice(0, 5).map((x) => ({ id: x.id, code: supplierCode(x.supplierNo), name: x.name, amount: r2(x.t), share: all ? Math.round((x.t / all) * 1000) / 10 : 0 })),
    };
  }

  /** الفحوص الرقابية المستمرة، وتوصيات المراجعة الداخلية في مجالات المشتريات */
  async controls(a: OrgUser) {
    this.assert(a);
    const org = a.organizationId;
    const s = await this.core.settings(org);
    const since = addDays(prToday(), -180);
    const checks: { kind: string; title: string; count: number; rows: { label: string; detail: string; link: string | null }[] }[] = [];

    const over: { id: string; invoiceNo: number; supplier: string; reason: string; byName: string }[] = await this.db.query(
      `SELECT i.id, i.invoice_no AS "invoiceNo", s.name AS supplier, i.override->>'reason' AS reason, i.override->>'byName' AS "byName"
         FROM pr_invoices i JOIN pr_suppliers s ON s.id = i.supplier_id AND s.organization_id = i.organization_id
        WHERE i.organization_id = $1 AND i.override IS NOT NULL AND i.status NOT IN ('cancelled', 'rejected') AND i.created_at::date >= $2 ORDER BY i.invoice_no DESC`, [org, since]);
    checks.push({ kind: 'override', title: 'فواتير اعتُمدت بتجاوز استثناءات المطابقة', count: over.length,
      rows: over.map((x) => ({ label: `INV-${String(x.invoiceNo).padStart(4, '0')} · ${x.supplier}`, detail: `${x.byName}: ${x.reason}`, link: `/procurement/invoices/${x.id}` })) });

    const dup: { id: string; invoiceNo: number; supplier: string; message: string }[] = await this.db.query(
      `SELECT i.id, i.invoice_no AS "invoiceNo", s.name AS supplier, x->>'message' AS message
         FROM pr_invoices i JOIN pr_suppliers s ON s.id = i.supplier_id AND s.organization_id = i.organization_id, jsonb_array_elements(COALESCE(i.match->'issues', '[]'::jsonb)) x
        WHERE i.organization_id = $1 AND x->>'kind' = 'duplicate' AND i.status NOT IN ('cancelled', 'rejected', 'draft') AND i.created_at::date >= $2`, [org, since]);
    checks.push({ kind: 'duplicate', title: 'فواتير محتملة التكرار (المبلغ والتاريخ نفسهما)', count: dup.length,
      rows: dup.map((x) => ({ label: `INV-${String(x.invoiceNo).padStart(4, '0')} · ${x.supplier}`, detail: x.message, link: `/procurement/invoices/${x.id}` })) });

    // تجزئة الشراء: تعميدات مباشرة للمورد نفسه خلال 30 يومًا، كل منها دون حد الشراء المباشر ومجموعها فوقه
    const limit = sourcingSettings(s).methodLimits.direct;
    const split: { supplierId: string; supplier: string; n: number; t: number; orders: number[] }[] = await this.db.query(
      `SELECT o.supplier_id AS "supplierId", s.name AS supplier, COUNT(*)::int AS n, SUM(o.total)::float AS t, array_agg(o.order_no ORDER BY o.order_no) AS orders
         FROM pr_orders o JOIN pr_suppliers s ON s.id = o.supplier_id AND s.organization_id = o.organization_id
        WHERE o.organization_id = $1 AND o.rfq_id IS NULL AND o.status NOT IN ('draft', 'cancelled', 'returned') AND o.created_at::date >= $2 AND o.total <= $3
        GROUP BY 1, 2, date_trunc('month', o.created_at) HAVING COUNT(*) > 1 AND SUM(o.total) > $3`, [org, since, limit]);
    checks.push({ kind: 'split', title: `احتمال تجزئة الشراء (تعميدات مباشرة لمورد واحد في شهر، مجموعها فوق حد الشراء المباشر ${limit})`, count: split.length,
      rows: split.map((x) => ({ label: x.supplier, detail: `${x.n} تعميدات بمجموع ${r2(x.t)}: ${x.orders.map(orderCode).join('، ')}`, link: `/procurement/suppliers/${x.supplierId}` })) });

    const banks: { supplierId: string; supplier: string; bank: string; status: string; at: Date; via: string }[] = await this.db.query(
      `SELECT b.supplier_id AS "supplierId", s.name AS supplier, b.bank_name AS bank, b.status, b.created_at AS at, b.requested_via AS via
         FROM pr_supplier_banks b JOIN pr_suppliers s ON s.id = b.supplier_id AND s.organization_id = b.organization_id
        WHERE b.organization_id = $1 AND b.created_at::date >= $2
          AND EXISTS (SELECT 1 FROM pr_supplier_banks p WHERE p.organization_id = b.organization_id AND p.supplier_id = b.supplier_id AND p.id <> b.id AND p.created_at < b.created_at)
        ORDER BY b.created_at DESC`, [org, addDays(prToday(), -90)]);
    checks.push({ kind: 'bank', title: 'تغيير الحسابات البنكية للموردين في آخر 90 يومًا', count: banks.length,
      rows: banks.map((x) => ({ label: x.supplier, detail: `${x.bank} · ${x.status === 'approved' ? 'معتمد' : x.status === 'pending' ? 'بانتظار الاعتماد' : x.status} · ${x.via === 'portal' ? 'من البوابة' : 'من موظف'}`, link: `/procurement/suppliers/${x.supplierId}` })) });

    const counts: { id: string; countNo: number; shortage: number; surplus: number; status: string }[] = await this.db.query(
      `SELECT id, count_no AS "countNo", shortage::float AS shortage, surplus::float AS surplus, status FROM pr_counts
        WHERE organization_id = $1 AND status IN ('submitted', 'approved') AND (shortage > 0 OR surplus > 0) AND date >= $2 ORDER BY count_no DESC`, [org, since]);
    checks.push({ kind: 'count', title: 'فروقات الجرد', count: counts.length,
      rows: counts.map((x) => ({ label: `جرد ${x.countNo}`, detail: `عجز ${x.shortage} · زيادة ${x.surplus} · ${x.status === 'approved' ? 'معتمد' : 'بانتظار الاعتماد'}`, link: `/procurement/counts/${x.id}` })) });

    const pen: { id: string; contractNo: number; amount: number; reason: string; byName: string }[] = await this.db.query(
      `SELECT c.id, c.contract_no AS "contractNo", (p->>'amount')::float AS amount, p->>'reason' AS reason, p->>'byName' AS "byName"
         FROM pr_contracts c, jsonb_array_elements(c.penalties) p WHERE c.organization_id = $1 AND p->>'status' = 'pending'`, [org]);
    checks.push({ kind: 'penalty', title: 'جزاءات تعاقدية بانتظار الاعتماد', count: pen.length,
      rows: pen.map((x) => ({ label: `CT-${String(x.contractNo).padStart(4, '0')}`, detail: `${x.amount}: ${x.reason} (${x.byName})`, link: `/procurement/contracts/${x.id}` })) });

    // توصيات المراجعة الداخلية في المجالات المحددة (قراءة فقط من نظام المراجعة)
    let audit: { id: string; code: string; title: string; status: string; statusLabel: string; dueDate: string; overdue: boolean; assignee: string | null; recommendation: string | null; engagement: string | null }[] = [];
    // توصيات المراجعة الداخلية لمن يملك صلاحية العرض في نظام المراجعة فقط
    if (s.auditAreaIds?.length && canAudit(a)) {
      const rows: { id: string; code: string; title: string; status: string; due_date: string; assignee_name: string | null; recommendation: string | null; eng: string | null }[] = await this.db.query(
        `SELECT a.id, a.code, a.title, a.status, a.due_date::text AS due_date, a.assignee_name, f.recommendation, e.code || ' ' || e.title AS eng
           FROM audit_actions a JOIN audit_engagements e ON e.id = a.engagement_id AND e.organization_id = a.organization_id
           LEFT JOIN audit_findings f ON f.id = a.finding_id AND f.organization_id = a.organization_id
          WHERE a.organization_id = $1 AND e.area_id = ANY($2) AND a.status <> 'cancelled' ORDER BY a.status = 'closed', a.due_date`, [org, s.auditAreaIds]).catch(() => []);
      const today = prToday();
      audit = rows.map((r) => ({
        id: r.id, code: r.code, title: r.title, status: r.status, statusLabel: ACTION_STATUS[r.status] ?? r.status, dueDate: r.due_date,
        overdue: r.status !== 'closed' && r.due_date < today, assignee: r.assignee_name, recommendation: r.recommendation, engagement: r.eng,
      }));
    }
    return { checks, audit, auditConfigured: !!s.auditAreaIds?.length, auditAllowed: canAudit(a) };
  }

  /** مؤشرات أداء المشتريات والمستودعات للفترة */
  async kpis(a: OrgUser, q: KpiQueryDto) {
    this.assert(a, true);
    const org = a.organizationId;
    const to = q.to ?? prToday();
    const from = q.from ?? `${to.slice(0, 4)}-01-01`;
    const [cycle] = await this.db.query(
      `SELECT AVG(EXTRACT(EPOCH FROM (o.issued_at - r.submitted_at)) / 86400)::float AS days, COUNT(*)::int AS n
         FROM pr_orders o JOIN pr_requests r ON r.id = o.request_id AND r.organization_id = o.organization_id
        WHERE o.organization_id = $1 AND o.issued_at IS NOT NULL AND r.submitted_at IS NOT NULL AND o.issued_at::date BETWEEN $2 AND $3`, [org, from, to]);
    const [del] = await this.db.query(
      `SELECT COUNT(*)::int AS n, COUNT(*) FILTER (WHERE o.delivery_date IS NULL OR r.date <= o.delivery_date)::int AS ok
         FROM pr_receipts r JOIN pr_orders o ON o.id = r.order_id AND o.organization_id = r.organization_id
        WHERE r.organization_id = $1 AND r.status = 'posted' AND r.date BETWEEN $2 AND $3`, [org, from, to]);
    const [inv] = await this.db.query(
      `SELECT AVG(EXTRACT(EPOCH FROM (approved_at - submitted_at)) / 86400)::float AS review, COUNT(*)::int AS n,
              COUNT(*) FILTER (WHERE (match->>'ok')::boolean)::int AS matched,
              AVG(EXTRACT(EPOCH FROM (posted_at - approved_at)) / 86400) FILTER (WHERE posted_at IS NOT NULL)::float AS posting
         FROM pr_invoices WHERE organization_id = $1 AND kind = 'invoice' AND approved_at IS NOT NULL AND approved_at::date BETWEEN $2 AND $3`, [org, from, to]);
    const [sav] = await this.db.query(
      `SELECT COALESCE(SUM(r.estimated_total), 0)::float AS est, COALESCE(SUM(o.total), 0)::float AS act, COUNT(*)::int AS n
         FROM pr_orders o JOIN pr_requests r ON r.id = o.request_id AND r.organization_id = o.organization_id
        WHERE o.organization_id = $1 AND o.rfq_id IS NOT NULL AND o.issued_at::date BETWEEN $2 AND $3 AND r.estimated_total > 0`, [org, from, to]);
    const [cnt] = await this.db.query(
      `SELECT COALESCE(SUM(ABS((l->>'diffValue')::numeric)), 0)::float AS diff, COALESCE(SUM((l->>'systemQty')::numeric * (l->>'unitCost')::numeric), 0)::float AS sys
         FROM pr_counts c, jsonb_array_elements(c.lines) l WHERE c.organization_id = $1 AND c.status = 'approved' AND c.date BETWEEN $2 AND $3`, [org, from, to]);
    const [iss] = await this.db.query(
      `SELECT COALESCE(SUM(total), 0)::float AS t FROM pr_stock_docs WHERE organization_id = $1 AND kind = 'issue' AND status = 'posted' AND date BETWEEN $2 AND $3`, [org, from, to]);
    const [stock] = await this.db.query(`SELECT COALESCE(SUM(qty_left * unit_cost), 0)::float AS v FROM pr_stock_layers WHERE organization_id = $1 AND qty_left > 0`, [org]);
    const [sup] = await this.db.query(
      `SELECT AVG(rating)::float AS avg, COUNT(*) FILTER (WHERE grade = 'A')::int AS a, COUNT(*) FILTER (WHERE grade = 'B')::int AS b,
              COUNT(*) FILTER (WHERE grade = 'C')::int AS c, COUNT(*) FILTER (WHERE grade = 'D')::int AS d, COUNT(*) FILTER (WHERE grade IS NULL)::int AS none
         FROM pr_suppliers WHERE organization_id = $1 AND status = 'approved'`, [org]);
    const [ct] = await this.db.query(
      `SELECT COUNT(*)::int AS n, COALESCE(SUM(value), 0)::float AS value,
              COALESCE(SUM((SELECT COALESCE(SUM(o.total), 0) FROM pr_orders o WHERE o.organization_id = c.organization_id AND o.contract_id = c.id
                              AND o.status IN ('pending', 'issued', 'acknowledged', 'accepted', 'clarification', 'partial', 'closed'))), 0)::float AS used
         FROM pr_contracts c WHERE c.organization_id = $1 AND c.status IN ('active', 'suspended')`, [org]);
    const days = Math.max(1, (Date.parse(to) - Date.parse(from)) / 86400_000 + 1);
    const round = (v: number | null, d = 1) => (v === null || v === undefined ? null : Math.round(v * 10 ** d) / 10 ** d);
    const kpi = (key: string, name: string, value: number | null, unit: string, target: number | null, better: 'up' | 'down', note: string) =>
      ({ key, name, value, unit, target, better, note, met: value === null || target === null ? null : better === 'up' ? value >= target : value <= target });
    return {
      from, to,
      kpis: [
        kpi('cycle', 'متوسط مدة دورة الشراء (من الطلب إلى التعميد)', round(cycle.days), 'يوم', 14, 'down', `${cycle.n} تعميد`),
        kpi('onTime', 'نسبة التوريد في الموعد', del.n ? round((del.ok / del.n) * 100) : null, '%', 90, 'up', `${del.ok} من ${del.n} توريد`),
        kpi('invoiceReview', 'متوسط مدة مراجعة الفواتير ومطابقتها', round(inv.review), 'يوم', 5, 'down', `${inv.n} فاتورة`),
        kpi('invoicePosting', 'متوسط مدة تسجيل المستحق في المالي', round(inv.posting), 'يوم', 3, 'down', ''),
        kpi('firstMatch', 'نسبة الفواتير المطابقة دون استثناء', inv.n ? round((inv.matched / inv.n) * 100) : null, '%', 85, 'up', ''),
        kpi('savings', 'وفورات المنافسات عن التقدير', sav.est ? round(((sav.est - sav.act) / sav.est) * 100) : null, '%', 5, 'up', `${r2(sav.est - sav.act)} في ${sav.n} تعميد`),
        kpi('accuracy', 'دقة المخزون في الجرد', cnt.sys ? round(100 - (cnt.diff / cnt.sys) * 100) : null, '%', 98, 'up', `فروقات ${r2(cnt.diff)}`),
        kpi('turnover', 'معدل دوران المخزون (سنوي)', stock.v ? round((iss.t / stock.v) * (365 / days), 2) : null, 'مرة', 4, 'up', `منصرف ${r2(iss.t)} ورصيد ${r2(stock.v)}`),
        kpi('rating', 'متوسط تقييم الموردين المعتمدين', round(sup.avg), 'درجة', 75, 'up', `ممتاز ${sup.a} · جيد ${sup.b} · مقبول ${sup.c} · ضعيف ${sup.d} · غير مقيّم ${sup.none}`),
        kpi('contracts', 'نسبة استخدام سقوف العقود السارية', ct.value ? round((ct.used / ct.value) * 100) : null, '%', null, 'up', `${ct.n} عقد بقيمة ${r2(ct.value)}`),
      ],
    };
  }
}
