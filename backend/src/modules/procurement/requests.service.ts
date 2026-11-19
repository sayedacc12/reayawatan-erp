import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { DataSource } from 'typeorm';
import { OrgUser } from '../../core/auth/decorators';
import { FileStore } from '../../core/files/file-store.service';
import { ItemFile } from './entities/procurement.entity';
import {
  ORDER_STATUS, PRIORITIES, PrOrder, PrRequest, PrRfq, PURCHASE_METHODS, REQUEST_KINDS, REQUEST_STATUS, RFQ_STATUS, RequestLine, RequestStatus,
} from './entities/sourcing.entity';
import { PROCUREMENT_PERMISSIONS as P } from './procurement.manifest';
import { logEntry, ProcurementCore } from './procurement-core.service';
import { METHOD_RANK, orderCode, r2, requestCode, rfqCode, SourcingCore, suggestMethod } from './sourcing-core.service';
import { RequestDto } from './sourcing.dto';

const MAX_ATTACHMENTS = 15;
/** الطلبات المنتهية لا تدخل في كشف التكرار */
const OPEN_STATUSES: RequestStatus[] = ['submitted', 'returned', 'approved', 'sourcing', 'ordered'];
export const can = (a: OrgUser, p: string) => a.isSuperadmin || a.permissions.includes(p);

/**
 * طلبات الشراء: ينشئها أي موظف مخول، ويعتمدها مخول آخر. يُفحص عند الإرسال والاعتماد المتاح في بند الموازنة
 * أو مصدر التمويل وشروطه، ويُقترح أسلوب الشراء حسب القيمة، وينبّه النظام إلى الطلبات المشابهة المفتوحة.
 */
@Injectable()
export class RequestsService {
  constructor(private readonly db: DataSource, private readonly core: ProcurementCore, private readonly sc: SourcingCore, private readonly files: FileStore) {}

  /** من يرى كل الطلبات (والباقون يرون طلباتهم فقط) */
  private seesAll(a: OrgUser) {
    return [P.approveRequests, P.sourcing, P.approveOrders, P.approveOrdersHigh, P.reports].some((p) => can(a, p));
  }

  async find(a: OrgUser, id: string) {
    const r = await this.db.getRepository(PrRequest).findOne({ where: { id, organizationId: a.organizationId } });
    if (!r || (!this.seesAll(a) && r.requestedById !== a.id)) throw new NotFoundException('طلب الشراء غير موجود');
    return r;
  }

  private async cleanLines(org: string, lines: RequestDto['lines'], keepIds: Set<string>): Promise<RequestLine[]> {
    const itemIds = lines.map((l) => l.itemId).filter((x): x is string => !!x);
    const items: { id: string; name: string; uom_id: string; status: string }[] = itemIds.length
      ? await this.db.query('SELECT id, name, uom_id, status FROM pr_items WHERE organization_id = $1 AND id = ANY($2)', [org, itemIds]) : [];
    const byId = new Map(items.map((i) => [i.id, i]));
    return lines.map((l) => {
      const item = l.itemId ? byId.get(l.itemId) : null;
      if (l.itemId && !item) throw new BadRequestException('أحد الأصناف غير موجود في الدليل');
      if (item && item.status !== 'active') throw new BadRequestException(`الصنف «${item.name}» موقوف، اختر بديله`);
      return {
        id: l.id && keepIds.has(l.id) ? l.id : randomUUID(), itemId: l.itemId ?? null, description: l.description.trim(), qty: Number(l.qty),
        uomId: l.uomId ?? item?.uom_id ?? null, estPrice: r2(Number(l.estPrice)), specs: l.specs ?? null,
      };
    });
  }

  private fields(dto: RequestDto) {
    return {
      title: dto.title.trim(), kind: dto.kind, unitId: dto.unitId ?? null, projectId: dto.projectId ?? null, beneficiaryRef: dto.beneficiaryRef ?? null,
      neededBy: dto.neededBy ?? null, priority: dto.priority, justification: dto.justification ?? null, method: dto.method ?? null, methodReason: dto.methodReason ?? null,
      budgetLineId: dto.budgetLineId ?? null, fundingBatchId: dto.fundingBatchId ?? null,
    };
  }

  async create(a: OrgUser, dto: RequestDto) {
    const org = a.organizationId;
    await this.core.settings(org);
    await this.sc.assertFinance(org, dto.budgetLineId, dto.fundingBatchId);
    const lines = await this.cleanLines(org, dto.lines, new Set());
    const r = await this.db.transaction(async (em) => {
      const no = await this.sc.nextNo(em, 'pr_requests', 'request_no', org);
      return em.getRepository(PrRequest).save(em.create(PrRequest, {
        organizationId: org, requestNo: no, ...this.fields(dto), lines, estimatedTotal: r2(lines.reduce((s, l) => s + l.qty * l.estPrice, 0)),
        status: 'draft', requestedById: a.id, requestedByName: a.fullName, log: [logEntry('إنشاء الطلب', a.fullName)],
      }));
    });
    return this.get(a, r.id);
  }

  async update(a: OrgUser, id: string, dto: RequestDto) {
    const r = await this.find(a, id);
    if (!['draft', 'returned'].includes(r.status)) throw new ConflictException('لا يُعدل الطلب بعد إرساله إلا إذا أعيد للتعديل');
    if (r.requestedById !== a.id && !can(a, P.sourcing)) throw new ForbiddenException('يعدل الطلب صاحبه أو موظف المشتريات');
    await this.sc.assertFinance(a.organizationId, dto.budgetLineId, dto.fundingBatchId);
    const lines = await this.cleanLines(a.organizationId, dto.lines, new Set(r.lines.map((l) => l.id)));
    Object.assign(r, this.fields(dto), { lines, estimatedTotal: r2(lines.reduce((s, l) => s + l.qty * l.estPrice, 0)) });
    r.log = [...r.log, logEntry('تعديل الطلب', a.fullName)];
    await this.db.getRepository(PrRequest).save(r);
    return this.get(a, id);
  }

  /** طلبات مفتوحة فيها نفس الأصناف أو نفس الوصف خلال 90 يومًا */
  async similar(a: OrgUser, id: string) {
    const r = await this.find(a, id);
    const items = r.lines.map((l) => l.itemId).filter(Boolean);
    const descs = r.lines.map((l) => l.description.trim().toLowerCase());
    const rows: { id: string; request_no: number; title: string; status: RequestStatus; requested_by_name: string; created_at: Date }[] = await this.db.query(
      `SELECT DISTINCT q.id, q.request_no, q.title, q.status, q.requested_by_name, q.created_at
         FROM pr_requests q, jsonb_array_elements(q.lines) l
        WHERE q.organization_id = $1 AND q.id <> $2 AND q.status = ANY($3) AND q.created_at > now() - interval '90 days'
          AND ((l->>'itemId') = ANY($4::text[]) OR lower(trim(l->>'description')) = ANY($5::text[]))
        ORDER BY q.created_at DESC LIMIT 10`, [a.organizationId, id, OPEN_STATUSES, items, descs]);
    return rows.map((x) => ({ id: x.id, code: requestCode(x.request_no), title: x.title, status: x.status, statusLabel: REQUEST_STATUS[x.status], requestedByName: x.requested_by_name, createdAt: x.created_at }));
  }

  private methodProblem(r: PrRequest, suggested: keyof typeof PURCHASE_METHODS) {
    const m = r.method ?? suggested;
    if ((m === 'emergency' || METHOD_RANK[m] < METHOD_RANK[suggested]) && !(r.methodReason && r.methodReason.length >= 5)) {
      return m === 'emergency'
        ? 'الشراء الطارئ يحتاج مبررًا مكتوبًا'
        : `الأسلوب المقترح لهذه القيمة «${PURCHASE_METHODS[suggested]}»؛ اكتب مبرر اختيار «${PURCHASE_METHODS[m]}»`;
    }
    return null;
  }

  async submit(a: OrgUser, id: string, confirmDuplicate = false) {
    const r = await this.find(a, id);
    if (!['draft', 'returned'].includes(r.status)) throw new ConflictException('الطلب أُرسل من قبل');
    if (r.requestedById !== a.id && !can(a, P.sourcing)) throw new ForbiddenException('يرسل الطلب صاحبه أو موظف المشتريات');
    if (!r.lines.length) throw new BadRequestException('أضف بندًا واحدًا على الأقل');
    if (!(r.estimatedTotal > 0)) throw new BadRequestException('أدخل الأسعار التقديرية للبنود');
    if (!r.budgetLineId && !r.fundingBatchId) throw new BadRequestException('حدد بند الموازنة أو مصدر التمويل الذي يُصرف منه');
    if (r.kind === 'beneficiary' && !r.beneficiaryRef) throw new BadRequestException('اكتب مرجع المستفيد أو البرنامج (رقم الملف أو الطلب فقط)');
    const s = await this.core.settings(a.organizationId);
    const suggested = suggestMethod(r.estimatedTotal, s);
    const mp = this.methodProblem(r, suggested);
    if (mp) throw new BadRequestException(mp);
    if (!confirmDuplicate && (await this.similar(a, id)).length) throw new ConflictException('توجد طلبات مشابهة مفتوحة. راجعها ثم أكد الإرسال');
    const c = await this.sc.check(a.organizationId, { amount: r.estimatedTotal, budgetLineId: r.budgetLineId, fundingBatchId: r.fundingBatchId, projectId: r.projectId, kind: r.kind });
    r.method = r.method ?? suggested;
    r.budgetCheck = this.sc.snapshot(c);
    r.status = 'submitted';
    r.submittedAt = new Date();
    r.log = [...r.log, logEntry('إرسال للاعتماد', a.fullName, c.allowed ? null : c.message)];
    await this.db.getRepository(PrRequest).save(r);
    return this.get(a, id);
  }

  async decide(a: OrgUser, id: string, decision: 'approve' | 'return' | 'reject', note: string | null) {
    const r = await this.find(a, id);
    if (r.status !== 'submitted') throw new ConflictException('الطلب ليس بانتظار الاعتماد');
    if (r.requestedById === a.id && !a.isSuperadmin) throw new ForbiddenException('لا يعتمد الموظف طلبه بنفسه');
    if (decision !== 'approve' && !note) throw new BadRequestException('اكتب سبب الإعادة أو الرفض');
    if (decision === 'approve') {
      const c = await this.sc.check(a.organizationId, { amount: r.estimatedTotal, budgetLineId: r.budgetLineId, fundingBatchId: r.fundingBatchId, projectId: r.projectId, kind: r.kind });
      r.budgetCheck = this.sc.snapshot(c);
      if (!c.allowed) throw new ConflictException(`${c.message}. أعد الطلب لتعديل مصدر الصرف، أو وفّر المبلغ بمناقلة أولًا`);
    }
    r.status = decision === 'approve' ? 'approved' : decision === 'return' ? 'returned' : 'rejected';
    r.decidedByName = a.fullName;
    r.decidedAt = new Date();
    r.decisionNote = note;
    r.log = [...r.log, logEntry({ approve: 'اعتماد الطلب', return: 'إعادة للتعديل', reject: 'رفض الطلب' }[decision], a.fullName, note)];
    await this.db.getRepository(PrRequest).save(r);
    return this.get(a, id);
  }

  async cancel(a: OrgUser, id: string, reason: string) {
    const r = await this.find(a, id);
    if (['closed', 'cancelled', 'rejected'].includes(r.status)) throw new ConflictException('الطلب منتهٍ');
    if (r.requestedById !== a.id && !can(a, P.sourcing)) throw new ForbiddenException('يلغي الطلب صاحبه أو موظف المشتريات');
    const live = await this.db.query(`SELECT 1 FROM pr_orders WHERE request_id = $1 AND status NOT IN ('cancelled') LIMIT 1`, [id]);
    if (live.length) throw new ConflictException('للطلب تعميد قائم؛ ألغِ التعميد أولًا');
    await this.db.transaction(async (em) => {
      const rfqs = await em.getRepository(PrRfq).find({ where: { requestId: id } });
      for (const q of rfqs.filter((x) => !['cancelled', 'awarded'].includes(x.status))) {
        q.status = 'cancelled';
        q.cancelReason = `إلغاء طلب الشراء: ${reason}`;
        q.log = [...q.log, logEntry('إلغاء المنافسة', a.fullName, q.cancelReason)];
        await em.save(q);
      }
      r.status = 'cancelled';
      r.log = [...r.log, logEntry('إلغاء الطلب', a.fullName, reason)];
      await em.save(r);
    });
    return this.get(a, id);
  }

  /** الكميات التي صدر بها تعميد لكل بند */
  async orderedQty(requestId: string, exceptOrderId: string | null = null) {
    const rows: { lineId: string; qty: number }[] = await this.db.query(
      `SELECT l->>'lineId' AS "lineId", SUM((l->>'qty')::numeric)::float AS qty FROM pr_orders o, jsonb_array_elements(o.lines) l
        WHERE o.request_id = $1 AND o.status <> 'cancelled' AND ($2::uuid IS NULL OR o.id <> $2::uuid) GROUP BY 1`, [requestId, exceptOrderId]);
    return new Map(rows.map((x) => [x.lineId, x.qty]));
  }

  async list(a: OrgUser, q: { status?: string; q?: string; mine?: string; unit?: string }) {
    const org = a.organizationId;
    const mine = !this.seesAll(a) || q.mine === '1';
    const rows: (PrRequest & Record<string, unknown>)[] = await this.db.query(
      `SELECT r.id, r.request_no AS "requestNo", r.title, r.kind, r.status, r.priority, r.method, r.estimated_total::float AS "estimatedTotal",
              r.needed_by AS "neededBy", r.unit_id AS "unitId", r.project_id AS "projectId", r.requested_by_name AS "requestedByName",
              r.submitted_at AS "submittedAt", r.created_at AS "createdAt", jsonb_array_length(r.lines)::int AS "lineCount",
              (r.budget_check->>'allowed')::boolean AS "budgetOk"
         FROM pr_requests r
        WHERE r.organization_id = $1 AND ($2::text IS NULL OR r.status = $2) AND ($3::uuid IS NULL OR r.requested_by_id = $3::uuid)
          AND ($4::uuid IS NULL OR r.unit_id = $4::uuid)
          AND ($5::text IS NULL OR r.title ILIKE '%' || $5 || '%' OR ('REQ-' || LPAD(r.request_no::text, 4, '0')) ILIKE '%' || $5 || '%')
        ORDER BY r.request_no DESC LIMIT 500`,
      [org, q.status || null, mine ? a.id : null, q.unit || null, q.q?.trim() || null]);
    const labels = await this.sc.orgLabels(org, rows.map((r) => r.unitId as string | null), rows.map((r) => r.projectId as string | null));
    const today = new Date().toISOString().slice(0, 10);
    return rows.map((r) => ({
      ...r, code: requestCode(r.requestNo), statusLabel: REQUEST_STATUS[r.status], kindLabel: REQUEST_KINDS[r.kind], priorityLabel: PRIORITIES[r.priority],
      methodLabel: r.method ? PURCHASE_METHODS[r.method] : null, unitName: r.unitId ? labels.units.get(r.unitId) ?? null : null,
      projectName: r.projectId ? labels.projects.get(r.projectId) ?? null : null,
      late: !!r.neededBy && String(r.neededBy) < today && ['submitted', 'approved', 'sourcing'].includes(r.status),
    }));
  }

  async get(a: OrgUser, id: string) {
    const org = a.organizationId;
    const r = await this.find(a, id);
    const s = await this.core.settings(org);
    const [labels, fin, uoms, items, rfqs, orders, ordered] = await Promise.all([
      this.sc.orgLabels(org, [r.unitId], [r.projectId]),
      this.sc.financeLabels(org, [r.budgetLineId], [r.fundingBatchId]),
      this.db.query('SELECT id, name FROM pr_uoms WHERE organization_id = $1', [org]) as Promise<{ id: string; name: string }[]>,
      this.db.query('SELECT id, code, name, kind FROM pr_items WHERE organization_id = $1 AND id = ANY($2)', [org, r.lines.map((l) => l.itemId).filter(Boolean)]) as Promise<{ id: string; code: string; name: string; kind: string }[]>,
      this.db.getRepository(PrRfq).find({ where: { requestId: id }, order: { rfqNo: 'ASC' } }),
      this.db.getRepository(PrOrder).find({ where: { requestId: id }, order: { orderNo: 'ASC' } }),
      this.orderedQty(id),
    ]);
    const uomName = new Map(uoms.map((u) => [u.id, u.name]));
    const itemBy = new Map(items.map((i) => [i.id, i]));
    const supIds = orders.map((o) => o.supplierId);
    const sups: { id: string; name: string }[] = supIds.length ? await this.db.query('SELECT id, name FROM pr_suppliers WHERE id = ANY($1)', [supIds]) : [];
    const supName = new Map(sups.map((x) => [x.id, x.name]));
    const suggested = suggestMethod(r.estimatedTotal, s);
    const live = ['submitted', 'approved', 'sourcing'].includes(r.status) && (r.budgetLineId || r.fundingBatchId) && r.estimatedTotal > 0
      ? await this.sc.check(org, { amount: r.estimatedTotal, budgetLineId: r.budgetLineId, fundingBatchId: r.fundingBatchId, projectId: r.projectId, kind: r.kind }).catch(() => null)
      : null;
    const line = r.budgetLineId ? fin.lines.get(r.budgetLineId) : null;
    const batch = r.fundingBatchId ? fin.batches.get(r.fundingBatchId) : null;
    const mine = r.requestedById === a.id;
    return {
      ...r, code: requestCode(r.requestNo), statusLabel: REQUEST_STATUS[r.status], kindLabel: REQUEST_KINDS[r.kind], priorityLabel: PRIORITIES[r.priority],
      methodLabel: r.method ? PURCHASE_METHODS[r.method] : null, suggestedMethod: suggested, suggestedMethodLabel: PURCHASE_METHODS[suggested],
      unitName: r.unitId ? labels.units.get(r.unitId) ?? null : null, projectName: r.projectId ? labels.projects.get(r.projectId) ?? null : null,
      budgetLine: line ? { id: line.id, name: line.name, budgetCode: line.budgetCode, year: line.year } : null,
      funding: batch ? { id: batch.id, label: `الدفعة ${batch.batchNo} · ${batch.targetName}` } : null,
      liveCheck: live ? this.sc.snapshot(live) : null,
      lines: r.lines.map((l) => ({
        ...l, total: r2(l.qty * l.estPrice), uomName: l.uomId ? uomName.get(l.uomId) ?? null : null,
        item: l.itemId ? itemBy.get(l.itemId) ?? null : null, orderedQty: ordered.get(l.id) ?? 0,
      })),
      rfqs: rfqs.map((q) => ({ id: q.id, code: rfqCode(q.rfqNo), title: q.title, status: q.status, statusLabel: RFQ_STATUS[q.status], closesAt: q.closesAt })),
      orders: orders.map((o) => ({
        id: o.id, code: orderCode(o.orderNo), status: o.status, statusLabel: ORDER_STATUS[o.status], total: o.total, supplierName: supName.get(o.supplierId) ?? '—',
      })),
      can: {
        edit: ['draft', 'returned'].includes(r.status) && (mine || can(a, P.sourcing)),
        submit: ['draft', 'returned'].includes(r.status) && (mine || can(a, P.sourcing)),
        decide: r.status === 'submitted' && can(a, P.approveRequests) && (!mine || a.isSuperadmin),
        cancel: !['closed', 'cancelled', 'rejected'].includes(r.status) && (mine || can(a, P.sourcing)),
        source: ['approved', 'sourcing', 'ordered'].includes(r.status) && can(a, P.sourcing),
      },
    };
  }

  // ---------------- المرفقات ----------------

  async addAttachment(a: OrgUser, id: string, file: Express.Multer.File) {
    const r = await this.find(a, id);
    if (['closed', 'cancelled', 'rejected'].includes(r.status)) throw new ConflictException('الطلب منتهٍ');
    if (r.attachments.length >= MAX_ATTACHMENTS) throw new BadRequestException(`الحد الأعلى ${MAX_ATTACHMENTS} مرفقًا`);
    const saved = await this.files.save(`${a.organizationId}/procurement`, file, 'المرفق');
    const att: ItemFile = { key: saved.key, name: saved.name, mime: saved.mime, size: file.size, at: new Date().toISOString(), byName: a.fullName };
    await this.db.getRepository(PrRequest).update({ id }, { attachments: [...r.attachments, att], log: [...r.log, logEntry('إرفاق مستند', a.fullName, saved.name)] });
    return this.get(a, id);
  }

  async removeAttachment(a: OrgUser, id: string, key: string) {
    const r = await this.find(a, id);
    const att = r.attachments.find((x) => x.key.endsWith(`/${key}`));
    if (!att) throw new NotFoundException('المرفق غير موجود');
    if (!['draft', 'returned'].includes(r.status)) throw new ConflictException('لا تُحذف مرفقات الطلب بعد إرساله');
    await this.files.remove(att.key).catch(() => undefined);
    await this.db.getRepository(PrRequest).update({ id }, { attachments: r.attachments.filter((x) => x !== att), log: [...r.log, logEntry('حذف مرفق', a.fullName, att.name)] });
    return this.get(a, id);
  }

  async file(a: OrgUser, id: string, key: string) {
    const r = await this.find(a, id);
    const att = r.attachments.find((x) => x.key.endsWith(`/${key}`));
    if (!att) throw new NotFoundException('المرفق غير موجود');
    return { stream: this.files.open(att.key), mime: att.mime, name: att.name };
  }
}
