import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { OrgUser } from '../../core/auth/decorators';
import { EvaluationCreateDto, EvaluationListQueryDto, EvaluationSettingsDto, EvaluationUpdateDto, SupplierResponseDto } from './contract.dto';
import {
  DEFAULT_GRADE_LIMITS, DEFAULT_SUPPLIER_CRITERIA, EVAL_KINDS, EvalMetrics, EvalScore, Grade, GRADES, PrContract, PrSupplierEvaluation, SUPPLIER_EVAL_STATUS,
} from './entities/contract.entity';
import { PrSettings, PrSupplier } from './entities/procurement.entity';
import { PrOrder } from './entities/sourcing.entity';
import { PROCUREMENT_PERMISSIONS as P } from './procurement.manifest';
import { logEntry, ProcurementCore, prToday, supplierCode } from './procurement-core.service';
import { can } from './requests.service';
import { orderCode, r2 } from './sourcing-core.service';
import { SupplierPortalUser } from './supplier-portal.guard';

export const evalCode = (n: number) => `EV-${String(n).padStart(4, '0')}`;
const pct = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 1000) / 10 : null);

export function criteriaOf(s: PrSettings) {
  return s.supplierCriteria?.length ? s.supplierCriteria : DEFAULT_SUPPLIER_CRITERIA;
}
export function gradeLimits(s: PrSettings) {
  return s.gradeLimits ?? DEFAULT_GRADE_LIMITS;
}
export function gradeOf(total: number, s: PrSettings): Grade {
  const g = gradeLimits(s);
  return total >= g.A ? 'A' : total >= g.B ? 'B' : total >= g.C ? 'C' : 'D';
}

/**
 * تقييم الموردين: مؤشرات محسوبة آليًا من التعميدات والاستلامات والفواتير والعقود (الالتزام بالمواعيد والكميات والجودة ودقة الفواتير ومستويات الخدمة)،
 * يقترح منها درجات المعايير ويعدلها المقيّم بملاحظاته، ثم يعتمدها غيره فيُحدَّث تقدير المورد. التقدير الضعيف يضع المورد تحت الرقابة،
 * ويمكن منعه من الدعوة للمنافسات. ويطلع المورد على النتيجة المشاركة ويرد عليها بخطة تحسين.
 */
@Injectable()
export class EvaluationsService {
  constructor(private readonly db: DataSource, private readonly core: ProcurementCore) {}

  private canRead(a: OrgUser) {
    return [P.evaluations, P.evaluationsApprove, P.suppliersRead, P.reports, P.contracts].some((x) => can(a, x));
  }

  /** المؤشرات المحسوبة للمورد في الفترة (أو لتعميد أو عقد محدد) */
  async metrics(org: string, supplierId: string, from: string, to: string, scope: { orderId?: string | null; contractId?: string | null } = {}, em: EntityManager = this.db.manager): Promise<EvalMetrics> {
    const args = [org, supplierId, from, to, scope.orderId ?? null, scope.contractId ?? null];
    const orderScope = `o.organization_id = $1 AND o.supplier_id = $2 AND ($5::uuid IS NULL OR o.id = $5::uuid) AND ($6::uuid IS NULL OR o.contract_id = $6::uuid)
      AND o.status IN ('issued', 'acknowledged', 'accepted', 'clarification', 'partial', 'closed')`;
    const [ord] = await em.query(
      `SELECT COUNT(*)::int AS n, AVG(EXTRACT(EPOCH FROM (o.acknowledged_at - o.issued_at)) / 3600)::float AS resp
         FROM pr_orders o WHERE ${orderScope} AND o.issued_at::date BETWEEN $3 AND $4`, args);
    const [del] = await em.query(
      `SELECT COUNT(*)::int AS n,
              COUNT(*) FILTER (WHERE o.delivery_date IS NULL OR r.date <= o.delivery_date)::int AS on_time,
              AVG(GREATEST(0, r.date - o.delivery_date)) FILTER (WHERE o.delivery_date IS NOT NULL AND r.date > o.delivery_date)::float AS delay
         FROM pr_receipts r JOIN pr_orders o ON o.id = r.order_id AND o.organization_id = r.organization_id
        WHERE ${orderScope} AND r.status = 'posted' AND r.date BETWEEN $3 AND $4`, args);
    const [qty] = await em.query(
      `SELECT COALESCE(SUM((l->>'acceptedQty')::numeric), 0)::float AS accepted, COALESCE(SUM(COALESCE((l->>'rejectedQty')::numeric, 0)), 0)::float AS rejected
         FROM pr_receipts r JOIN pr_orders o ON o.id = r.order_id AND o.organization_id = r.organization_id, jsonb_array_elements(r.lines) l
        WHERE ${orderScope} AND r.status = 'posted' AND r.date BETWEEN $3 AND $4`, args);
    // نسبة التنفيذ: للتعميدات المستحقة التسليم في الفترة (أو المغلقة)
    const [fill] = await em.query(
      `SELECT COALESCE(SUM((l->>'qty')::numeric), 0)::float AS ordered,
              COALESCE(SUM((SELECT COALESCE(SUM((rl->>'acceptedQty')::numeric), 0) FROM pr_receipts r, jsonb_array_elements(r.lines) rl
                              WHERE r.order_id = o.id AND r.status = 'posted' AND rl->>'orderLineId' = l->>'lineId')), 0)::float AS received
         FROM pr_orders o, jsonb_array_elements(o.lines) l
        WHERE ${orderScope} AND (o.status = 'closed' OR COALESCE(o.delivery_date, o.issued_at::date) BETWEEN $3 AND $4)`, args);
    const [inv] = await em.query(
      `SELECT COUNT(*)::int AS n, COUNT(*) FILTER (WHERE (i.match->>'ok')::boolean IS FALSE)::int AS ex,
              COALESCE(SUM(CASE WHEN i.status IN ('posted', 'partial', 'paid') THEN (CASE WHEN i.kind = 'credit_note' THEN -i.total ELSE i.total END) ELSE 0 END), 0)::float AS spend
         FROM pr_invoices i JOIN pr_orders o ON o.id = i.order_id AND o.organization_id = i.organization_id
        WHERE ${orderScope} AND i.kind = 'invoice' AND i.status NOT IN ('draft', 'cancelled') AND i.invoice_date BETWEEN $3 AND $4`, args);
    const contracts = await em.getRepository(PrContract).find({ where: { organizationId: org, supplierId, ...(scope.contractId ? { id: scope.contractId } : {}) } });
    const fromP = from.slice(0, 7);
    const toP = to.slice(0, 7);
    let penalties = 0;
    let penaltyAmount = 0;
    let kpiMet = 0;
    let kpiTotal = 0;
    for (const c of contracts) {
      for (const p of c.penalties) if (p.status === 'approved' && p.date >= from && p.date <= to && (!scope.orderId || p.orderId === scope.orderId)) { penalties++; penaltyAmount += p.amount; }
      for (const k of c.kpiReadings) if (k.period >= fromP && k.period <= toP) { kpiTotal++; if (k.met) kpiMet++; }
    }
    const total = qty.accepted + qty.rejected;
    return {
      orders: ord.n, deliveries: del.n, onTime: del.on_time, late: del.n - del.on_time, onTimePct: pct(del.on_time, del.n), avgDelayDays: del.delay === null ? null : Math.round(del.delay * 10) / 10,
      ordered: fill.ordered, received: fill.received, fillPct: fill.ordered ? Math.min(100, pct(fill.received, fill.ordered)!) : null,
      rejected: qty.rejected, rejectPct: pct(qty.rejected, total), invoices: inv.n, invoiceExceptions: inv.ex, invoiceOkPct: pct(inv.n - inv.ex, inv.n),
      avgResponseHours: ord.resp === null ? null : Math.round(ord.resp * 10) / 10, penalties, penaltyAmount: r2(penaltyAmount), kpiMet, kpiTotal, kpiPct: pct(kpiMet, kpiTotal),
      spend: r2(inv.spend),
    };
  }

  /** الدرجة المقترحة من المؤشر (0 إلى 100)، والجزاءات تنقص درجة الالتزام بالعقد */
  private suggest(metric: string | null, m: EvalMetrics): number | null {
    if (!metric) return null;
    if (metric === 'qualityPct') return m.rejectPct === null ? null : Math.max(0, r2(100 - m.rejectPct * 2));
    if (metric === 'kpiPct') {
      if (m.kpiPct === null && !m.penalties) return null;
      return Math.max(0, r2((m.kpiPct ?? 100) - m.penalties * 10));
    }
    const v = (m as unknown as Record<string, number | null>)[metric];
    return v === null || v === undefined ? null : Math.max(0, Math.min(100, v));
  }

  private totalOf(scores: EvalScore[]) {
    const w = scores.reduce((t, s) => t + s.weight, 0);
    return w ? r2(scores.reduce((t, s) => t + s.score * s.weight, 0) / w) : 0;
  }

  async find(org: string, id: string, em: EntityManager = this.db.manager) {
    const e = await em.getRepository(PrSupplierEvaluation).findOne({ where: { id, organizationId: org } });
    if (!e) throw new NotFoundException('التقييم غير موجود');
    return e;
  }

  private async lock(em: EntityManager, org: string, id: string) {
    const e = await em.getRepository(PrSupplierEvaluation).createQueryBuilder('e').setLock('pessimistic_write').where('e.id = :id AND e.organization_id = :org', { id, org }).getOne();
    if (!e) throw new NotFoundException('التقييم غير موجود');
    return e;
  }

  async create(a: OrgUser, dto: EvaluationCreateDto) {
    if (!can(a, P.evaluations)) throw new ForbiddenException('لا تملك صلاحية تقييم الموردين');
    const org = a.organizationId;
    if (dto.periodTo < dto.periodFrom) throw new BadRequestException('نهاية الفترة قبل بدايتها');
    if (dto.periodTo > prToday()) throw new BadRequestException('نهاية الفترة في المستقبل');
    const sup = await this.db.getRepository(PrSupplier).findOne({ where: { id: dto.supplierId, organizationId: org } });
    if (!sup) throw new NotFoundException('المورد غير موجود');
    if (dto.kind === 'order') {
      if (!dto.orderId) throw new BadRequestException('اختر التعميد');
      const o = await this.db.getRepository(PrOrder).findOne({ where: { id: dto.orderId, organizationId: org } });
      if (!o || o.supplierId !== sup.id) throw new BadRequestException('التعميد ليس لهذا المورد');
    }
    if (dto.kind === 'contract') {
      if (!dto.contractId) throw new BadRequestException('اختر العقد');
      const c = await this.db.getRepository(PrContract).findOne({ where: { id: dto.contractId, organizationId: org } });
      if (!c || c.supplierId !== sup.id) throw new BadRequestException('العقد ليس لهذا المورد');
    }
    const s = await this.core.settings(org);
    const scope = { orderId: dto.kind === 'order' ? dto.orderId : null, contractId: dto.kind === 'contract' ? dto.contractId : null };
    const m = await this.metrics(org, sup.id, dto.periodFrom, dto.periodTo, scope);
    const scores: EvalScore[] = criteriaOf(s).map((c) => {
      const auto = this.suggest(c.metric, m);
      return { key: c.key, name: c.name, weight: c.weight, metric: c.metric, auto, score: auto ?? 0, note: null };
    });
    const total = this.totalOf(scores);
    const e = await this.db.transaction(async (em) => {
      await em.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`pr_sup_evals:${org}`]);
      const [{ n }] = await em.query('SELECT COALESCE(MAX(eval_no), 0)::int + 1 AS n FROM pr_supplier_evaluations WHERE organization_id = $1', [org]);
      return em.save(em.create(PrSupplierEvaluation, {
        organizationId: org, evalNo: n, supplierId: sup.id, kind: dto.kind, orderId: scope.orderId ?? null, contractId: scope.contractId ?? null,
        periodFrom: dto.periodFrom, periodTo: dto.periodTo, metrics: m, scores, total, grade: gradeOf(total, s), status: 'draft',
        evaluatorId: a.id, evaluatorName: a.fullName, editorIds: [a.id], log: [logEntry('إنشاء التقييم بالمؤشرات المحسوبة', a.fullName)],
      }));
    });
    return this.get(a, e.id);
  }

  async update(a: OrgUser, id: string, dto: EvaluationUpdateDto) {
    if (!can(a, P.evaluations)) throw new ForbiddenException('لا تملك صلاحية تقييم الموردين');
    const org = a.organizationId;
    const s = await this.core.settings(org);
    await this.db.transaction(async (em) => {
      const e = await this.lock(em, org, id);
      if (!['draft', 'returned'].includes(e.status)) throw new ConflictException('يُعدل التقييم وهو مسودة أو معاد');
      const given = new Map(dto.scores.map((x) => [x.key, x]));
      e.scores = e.scores.map((c) => {
        const x = given.get(c.key);
        return x ? { ...c, score: r2(x.score), note: x.note ?? null } : c;
      });
      const changed = e.scores.filter((c) => c.auto !== null && Math.abs(c.score - c.auto) > 10 && !c.note);
      if (changed.length) throw new BadRequestException(`اكتب سبب اختلاف درجة «${changed[0].name}» عن المؤشر المحسوب (${changed[0].auto})`);
      e.total = this.totalOf(e.scores);
      e.grade = gradeOf(e.total, s);
      e.strengths = dto.strengths ?? null;
      e.weaknesses = dto.weaknesses ?? null;
      e.recommendation = dto.recommendation ?? null;
      if (dto.shareWithSupplier !== undefined) e.shareWithSupplier = dto.shareWithSupplier;
      if (!e.editorIds.includes(a.id)) e.editorIds = [...e.editorIds, a.id];
      e.log = [...e.log, logEntry('تعديل الدرجات', a.fullName, `${e.total} (${GRADES[e.grade]})`)];
      await em.save(e);
    });
    return this.get(a, id);
  }

  async submit(a: OrgUser, id: string) {
    if (!can(a, P.evaluations)) throw new ForbiddenException('لا تملك صلاحية تقييم الموردين');
    await this.db.transaction(async (em) => {
      const e = await this.lock(em, a.organizationId, id);
      if (!['draft', 'returned'].includes(e.status)) throw new ConflictException('التقييم ليس مسودة');
      if (e.scores.some((x) => x.auto === null && x.score === 0)) throw new BadRequestException('أدخل درجة كل معيار ليس له مؤشر محسوب');
      if (e.grade === 'D' && !e.weaknesses) throw new BadRequestException('اكتب نقاط الضعف للتقدير الضعيف');
      if (!e.editorIds.includes(a.id)) e.editorIds = [...e.editorIds, a.id];
      e.status = 'submitted';
      e.returnReason = null;
      e.log = [...e.log, logEntry('إرسال للاعتماد', a.fullName)];
      await em.save(e);
    });
    return this.get(a, id);
  }

  /** اعتماد التقييم (غير المقيّم)، فيُحدّث تقدير المورد بآخر تقييم معتمد */
  async decide(a: OrgUser, id: string, decision: 'approve' | 'return', note: string | null) {
    if (!can(a, P.evaluationsApprove)) throw new ForbiddenException('لا تملك صلاحية اعتماد تقييم الموردين');
    await this.db.transaction(async (em) => {
      const e = await this.lock(em, a.organizationId, id);
      if (e.status !== 'submitted') throw new ConflictException('التقييم لا ينتظر الاعتماد');
      if (!a.isSuperadmin && (e.evaluatorId === a.id || e.editorIds.includes(a.id))) throw new ForbiddenException('لا يعتمد التقييم من أعده أو عدّل درجاته أو أرسله (فصل المهام)');
      if (decision === 'return') {
        if (!note || note.length < 3) throw new BadRequestException('اكتب سبب الإعادة');
        e.status = 'returned';
        e.returnReason = note;
        e.log = [...e.log, logEntry('إعادة للمقيّم', a.fullName, note)];
      } else {
        e.status = 'approved';
        e.approvedById = a.id;
        e.approvedByName = a.fullName;
        e.approvedAt = new Date();
        e.log = [...e.log, logEntry('اعتماد التقييم', a.fullName, note)];
        const sup = await em.getRepository(PrSupplier).createQueryBuilder('s').setLock('pessimistic_write')
          .where('s.id = :id AND s.organization_id = :org', { id: e.supplierId, org: e.organizationId }).getOneOrFail();
        // آخر تقييم معتمد بحسب نهاية الفترة هو تقدير المورد الحالي
        const [later] = await em.query(
          `SELECT id FROM pr_supplier_evaluations WHERE organization_id = $1 AND supplier_id = $2 AND status = 'approved' AND period_to > $3 LIMIT 1`,
          [e.organizationId, e.supplierId, e.periodTo]);
        if (!later) {
          sup.rating = e.total;
          sup.grade = e.grade;
          sup.ratedAt = new Date();
          sup.log = [...sup.log, logEntry(`تحديث التقدير: ${GRADES[e.grade]} (${e.total})`, a.fullName, evalCode(e.evalNo))];
          await em.save(sup);
        }
      }
      await em.save(e);
    });
    return this.get(a, id);
  }

  async list(a: OrgUser, q: EvaluationListQueryDto) {
    if (!this.canRead(a)) throw new ForbiddenException('لا تملك صلاحية عرض تقييم الموردين');
    const rows: { id: string; evalNo: number; kind: keyof typeof EVAL_KINDS; supplierId: string; supplierName: string; periodFrom: string; periodTo: string; total: number; grade: Grade; status: keyof typeof SUPPLIER_EVAL_STATUS; evaluatorName: string; responded: boolean; orderNo: number | null; contractNo: number | null }[] =
      await this.db.query(
        `SELECT e.id, e.eval_no AS "evalNo", e.kind, e.supplier_id AS "supplierId", s.name AS "supplierName", to_char(e.period_from, 'YYYY-MM-DD') AS "periodFrom",
                to_char(e.period_to, 'YYYY-MM-DD') AS "periodTo", e.total::float AS total, e.grade, e.status, e.evaluator_name AS "evaluatorName", e.supplier_response IS NOT NULL AS responded,
                o.order_no AS "orderNo", c.contract_no AS "contractNo"
           FROM pr_supplier_evaluations e JOIN pr_suppliers s ON s.id = e.supplier_id AND s.organization_id = e.organization_id
           LEFT JOIN pr_orders o ON o.id = e.order_id AND o.organization_id = e.organization_id LEFT JOIN pr_contracts c ON c.id = e.contract_id AND c.organization_id = e.organization_id
          WHERE e.organization_id = $1 AND ($2::uuid IS NULL OR e.supplier_id = $2::uuid) AND ($3::text IS NULL OR e.status = $3) ORDER BY e.eval_no DESC`,
        [a.organizationId, q.supplier || null, q.status || null]);
    return rows.map((r) => ({
      ...r, code: evalCode(r.evalNo), kindLabel: EVAL_KINDS[r.kind], gradeLabel: GRADES[r.grade], statusLabel: SUPPLIER_EVAL_STATUS[r.status],
      ref: r.orderNo ? orderCode(r.orderNo) : r.contractNo ? `CT-${String(r.contractNo).padStart(4, '0')}` : null,
    }));
  }

  async get(a: OrgUser, id: string) {
    if (!this.canRead(a)) throw new ForbiddenException('لا تملك صلاحية عرض تقييم الموردين');
    const org = a.organizationId;
    const e = await this.find(org, id);
    const [sup, history] = await Promise.all([
      this.db.getRepository(PrSupplier).findOneOrFail({ where: { id: e.supplierId, organizationId: org } }),
      this.db.query(
        `SELECT id, eval_no AS "evalNo", total::float AS total, grade, to_char(period_to, 'YYYY-MM-DD') AS "periodTo" FROM pr_supplier_evaluations
          WHERE organization_id = $1 AND supplier_id = $2 AND status = 'approved' ORDER BY period_to`, [org, e.supplierId]),
    ]);
    const [ref] = e.orderId
      ? await this.db.query('SELECT id, order_no AS no FROM pr_orders WHERE organization_id = $1 AND id = $2', [org, e.orderId])
      : e.contractId ? await this.db.query('SELECT id, contract_no AS no FROM pr_contracts WHERE organization_id = $1 AND id = $2', [org, e.contractId]) : [];
    const editable = ['draft', 'returned'].includes(e.status) && can(a, P.evaluations);
    return {
      ...e, code: evalCode(e.evalNo), kindLabel: EVAL_KINDS[e.kind], gradeLabel: GRADES[e.grade], statusLabel: SUPPLIER_EVAL_STATUS[e.status], grades: GRADES,
      supplier: { id: sup.id, code: supplierCode(sup.supplierNo), name: sup.name, grade: sup.grade, rating: sup.rating },
      ref: ref ? { id: ref.id, code: e.orderId ? orderCode(ref.no) : `CT-${String(ref.no).padStart(4, '0')}`, kind: e.orderId ? 'order' : 'contract' } : null,
      history: history.map((h: { evalNo: number }) => ({ ...h, code: evalCode(h.evalNo) })),
      can: {
        edit: editable, submit: editable,
        decide: e.status === 'submitted' && can(a, P.evaluationsApprove) && (a.isSuperadmin || (e.evaluatorId !== a.id && !e.editorIds.includes(a.id))),
      },
    };
  }

  /** قوائم نموذج التقييم: الموردون المعتمدون مع تعميداتهم وعقودهم */
  async lookups(a: OrgUser) {
    if (!this.canRead(a)) throw new ForbiddenException('لا تملك صلاحية عرض تقييم الموردين');
    const org = a.organizationId;
    const s = await this.core.settings(org);
    const [suppliers, orders, contracts] = await Promise.all([
      this.db.query(`SELECT id, name, supplier_no AS "supplierNo", grade, rating::float AS rating FROM pr_suppliers WHERE organization_id = $1 AND status IN ('approved', 'suspended') ORDER BY name`, [org]),
      this.db.query(`SELECT id, order_no AS "orderNo", title, supplier_id AS "supplierId" FROM pr_orders WHERE organization_id = $1 AND status IN ('partial', 'closed') ORDER BY order_no DESC`, [org]),
      this.db.query(`SELECT id, contract_no AS "contractNo", title, supplier_id AS "supplierId" FROM pr_contracts WHERE organization_id = $1 AND status IN ('active', 'suspended', 'closed', 'terminated') ORDER BY contract_no DESC`, [org]),
    ]);
    return {
      kinds: EVAL_KINDS, status: SUPPLIER_EVAL_STATUS, grades: GRADES, criteria: criteriaOf(s), gradeLimits: gradeLimits(s), blockWeak: s.blockWeak, auditAreaIds: s.auditAreaIds,
      suppliers: suppliers.map((x: { supplierNo: number }) => ({ ...x, code: supplierCode(x.supplierNo) })),
      orders: orders.map((o: { orderNo: number }) => ({ ...o, code: orderCode(o.orderNo) })),
      contracts: contracts.map((c: { contractNo: number }) => ({ ...c, code: `CT-${String(c.contractNo).padStart(4, '0')}` })),
      auditAreas: await this.db.query('SELECT id, name FROM audit_areas WHERE organization_id = $1 ORDER BY name', [org]).catch(() => []),
    };
  }

  async saveSettings(a: OrgUser, dto: EvaluationSettingsDto) {
    if (!can(a, P.settings)) throw new ForbiddenException('لا تملك صلاحية الإعدادات');
    const org = a.organizationId;
    const w = dto.criteria.reduce((t, c) => t + c.weight, 0);
    if (Math.abs(w - 100) > 0.01) throw new BadRequestException(`مجموع أوزان المعايير ${w}، ويجب أن يكون 100`);
    if (new Set(dto.criteria.map((c) => c.key)).size !== dto.criteria.length) throw new BadRequestException('رموز المعايير مكررة');
    if (!(dto.gradeA > dto.gradeB && dto.gradeB > dto.gradeC)) throw new BadRequestException('حدود التقديرات: ممتاز أعلى من جيد، وجيد أعلى من مقبول');
    const areas = [...new Set(dto.auditAreaIds ?? [])];
    if (areas.length) {
      const [{ n }] = await this.db.query('SELECT COUNT(*)::int AS n FROM audit_areas WHERE organization_id = $1 AND id = ANY($2)', [org, areas]).catch(() => [{ n: -1 }]);
      if (n !== areas.length) throw new BadRequestException('أحد مجالات المراجعة غير موجود');
    }
    await this.core.settings(org);
    await this.db.getRepository(PrSettings).update({ organizationId: org }, {
      supplierCriteria: dto.criteria.map((c) => ({ key: c.key, name: c.name, weight: c.weight, metric: c.metric ?? null })),
      gradeLimits: { A: dto.gradeA, B: dto.gradeB, C: dto.gradeC }, blockWeak: dto.blockWeak, auditAreaIds: areas,
    });
    return this.lookups(a);
  }

  // ---------------- بوابة المورد ----------------

  async portalList(p: SupplierPortalUser) {
    if (p.supplierStatus !== 'approved') throw new ForbiddenException('تظهر التقييمات بعد اعتماد حسابكم مورّدًا');
    const rows = await this.db.getRepository(PrSupplierEvaluation).find({
      where: { organizationId: p.organizationId, supplierId: p.supplierId, status: 'approved', shareWithSupplier: true }, order: { evalNo: 'DESC' },
    });
    return rows.map((e) => this.portalView(e));
  }

  private portalView(e: PrSupplierEvaluation) {
    return {
      id: e.id, code: evalCode(e.evalNo), kindLabel: EVAL_KINDS[e.kind], periodFrom: e.periodFrom, periodTo: e.periodTo, total: e.total, grade: e.grade, gradeLabel: GRADES[e.grade],
      scores: e.scores.map((s) => ({ name: s.name, weight: s.weight, score: s.score, note: s.note })), strengths: e.strengths, weaknesses: e.weaknesses,
      metrics: { onTimePct: e.metrics.onTimePct, fillPct: e.metrics.fillPct, rejectPct: e.metrics.rejectPct, invoiceOkPct: e.metrics.invoiceOkPct, kpiPct: e.metrics.kpiPct },
      supplierResponse: e.supplierResponse, improvementPlan: e.improvementPlan, responseAt: e.responseAt, approvedAt: e.approvedAt,
    };
  }

  /** رد المورد على التقييم وخطة التحسين (مرة واحدة، ولا يعدل الدرجات) */
  async portalRespond(p: SupplierPortalUser, id: string, dto: SupplierResponseDto) {
    if (p.supplierStatus !== 'approved') throw new ForbiddenException('تظهر التقييمات بعد اعتماد حسابكم مورّدًا');
    if (p.role !== 'owner') throw new ForbiddenException('يرد على التقييم مدير الحساب');
    await this.db.transaction(async (em) => {
      const e = await this.lock(em, p.organizationId, id);
      if (e.supplierId !== p.supplierId || e.status !== 'approved' || !e.shareWithSupplier) throw new NotFoundException('التقييم غير موجود');
      if (e.supplierResponse) throw new ConflictException('سبق الرد على هذا التقييم');
      e.supplierResponse = dto.response;
      e.improvementPlan = dto.improvementPlan ?? null;
      e.responseAt = new Date();
      e.log = [...e.log, logEntry('رد المورد وخطة التحسين', p.fullName)];
      await em.save(e);
    });
    return this.portalView(await this.find(p.organizationId, id));
  }
}
