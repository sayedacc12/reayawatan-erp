import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { DataSource } from 'typeorm';
import { OrgUser } from '../../core/auth/decorators';
import { ISSUE_REQUEST_STATUS, IssueRequestStatus, PrIssueRequest, PrStockDoc } from './entities/stock.entity';
import { PROCUREMENT_PERMISSIONS as P } from './procurement.manifest';
import { logEntry } from './procurement-core.service';
import { can } from './requests.service';
import { SourcingCore } from './sourcing-core.service';
import { docCode, issueRequestCode, q3, StockCore } from './stock-core.service';
import { IssueRequestDto } from './stock.dto';

/**
 * طلبات الصرف: تطلب الإدارة أو المشروع مواد من المستودع، ويعتمدها مسؤول مختلف عن الطالب،
 * ثم يصرفها أمين المستودع بسند صرف (كليًا أو جزئيًا) يُحمّل على مركز التكلفة والمشروع ومصدر التمويل.
 */
@Injectable()
export class IssueRequestsService {
  constructor(private readonly db: DataSource, private readonly stock: StockCore, private readonly sc: SourcingCore) {}

  async find(org: string, id: string) {
    const r = await this.db.getRepository(PrIssueRequest).findOne({ where: { id, organizationId: org } });
    if (!r) throw new NotFoundException('طلب الصرف غير موجود');
    return r;
  }

  private async clean(a: OrgUser, dto: IssueRequestDto) {
    const org = a.organizationId;
    const wh = await this.stock.warehouse(org, dto.warehouseId);
    if (!wh.isActive) throw new ConflictException(`المستودع «${wh.name}» موقوف`);
    const items = await this.stock.items(org, dto.lines.map((l) => l.itemId));
    const seen = new Set<string>();
    const lines = dto.lines.map((l) => {
      const it = items.get(l.itemId)!;
      if (seen.has(it.id)) throw new BadRequestException(`الصنف «${it.name}» مكرر`);
      seen.add(it.id);
      if (it.kind === 'service' || it.kind === 'asset') throw new BadRequestException(`«${it.name}» ليس صنفًا مخزنيًا يُصرف من المستودع`);
      if (it.status !== 'active') throw new ConflictException(`الصنف «${it.name}» موقوف`);
      return { id: l.id && /^[0-9a-f-]{36}$/.test(l.id) ? l.id : randomUUID(), itemId: it.id, qty: q3(l.qty), issuedQty: 0, note: l.note ?? null };
    });
    if (dto.fundingBatchId || dto.projectId) await this.sc.assertFinance(org, null, dto.fundingBatchId);
    return {
      warehouseId: wh.id, purpose: dto.purpose.trim(), unitId: dto.unitId ?? null, projectId: dto.projectId ?? null, fundingBatchId: dto.fundingBatchId ?? null,
      analyticId: dto.analyticId ?? null, beneficiaryRef: dto.beneficiaryRef ?? null, receiverName: dto.receiverName ?? null, neededBy: dto.neededBy ?? null, lines,
    };
  }

  async create(a: OrgUser, dto: IssueRequestDto, submit = false) {
    if (!can(a, P.issueRequest)) throw new ForbiddenException('لا تملك صلاحية طلب الصرف');
    const data = await this.clean(a, dto);
    const id = await this.db.transaction(async (em) => {
      const no = await this.stock.nextNo(em, 'pr_issue_requests', 'request_no', a.organizationId);
      const r = await em.save(em.create(PrIssueRequest, {
        organizationId: a.organizationId, requestNo: no, ...data, status: submit ? 'submitted' : 'draft', requestedById: a.id, requestedByName: a.fullName,
        log: [logEntry('إنشاء طلب الصرف', a.fullName), ...(submit ? [logEntry('إرسال للاعتماد', a.fullName)] : [])],
      }));
      return r.id;
    });
    return this.get(a, id);
  }

  async update(a: OrgUser, id: string, dto: IssueRequestDto) {
    const r = await this.find(a.organizationId, id);
    if (!['draft', 'returned'].includes(r.status)) throw new ConflictException('لا يُعدل الطلب بعد إرساله إلا إذا أعيد');
    if (!a.isSuperadmin && r.requestedById !== a.id) throw new ForbiddenException('يعدل الطلبَ صاحبُه');
    Object.assign(r, await this.clean(a, dto));
    r.log = [...r.log, logEntry('تعديل الطلب', a.fullName)];
    await this.db.getRepository(PrIssueRequest).save(r);
    return this.get(a, id);
  }

  async submit(a: OrgUser, id: string) {
    const r = await this.find(a.organizationId, id);
    if (!['draft', 'returned'].includes(r.status)) throw new ConflictException('الطلب مرسل بالفعل');
    if (!a.isSuperadmin && r.requestedById !== a.id) throw new ForbiddenException('يرسل الطلبَ صاحبُه');
    r.status = 'submitted';
    r.log = [...r.log, logEntry('إرسال للاعتماد', a.fullName)];
    await this.db.getRepository(PrIssueRequest).save(r);
    return this.get(a, id);
  }

  private canDecide(a: OrgUser, r: PrIssueRequest) {
    if (r.status !== 'submitted') return { ok: false, why: 'الطلب ليس بانتظار الاعتماد' };
    if (!can(a, P.issueApprove)) return { ok: false, why: 'اعتماد طلبات الصرف لمن لديه صلاحيته' };
    if (!a.isSuperadmin && r.requestedById === a.id) return { ok: false, why: 'لا يعتمد الموظف طلب صرف قدمه بنفسه' };
    return { ok: true, why: null };
  }

  async decide(a: OrgUser, id: string, action: 'approve' | 'return' | 'reject', note: string | null) {
    const r = await this.find(a.organizationId, id);
    const c = this.canDecide(a, r);
    if (!c.ok) throw new ForbiddenException(c.why);
    if (action !== 'approve' && !(note && note.length >= 3)) throw new BadRequestException(action === 'return' ? 'اكتب المطلوب تعديله' : 'اكتب سبب الرفض');
    const next: Record<string, IssueRequestStatus> = { approve: 'approved', return: 'returned', reject: 'rejected' };
    r.status = next[action];
    r.decisionNote = note;
    r.decidedByName = a.fullName;
    r.log = [...r.log, logEntry({ approve: 'اعتماد الصرف', return: 'إعادة للتعديل', reject: 'رفض الطلب' }[action], a.fullName, note)];
    await this.db.getRepository(PrIssueRequest).save(r);
    return this.get(a, id);
  }

  async cancel(a: OrgUser, id: string, reason: string) {
    const r = await this.find(a.organizationId, id);
    if (['issued', 'rejected', 'cancelled'].includes(r.status)) throw new ConflictException('الطلب منتهٍ');
    if (!a.isSuperadmin && r.requestedById !== a.id && !can(a, P.issueApprove)) throw new ForbiddenException('يلغي الطلبَ صاحبُه أو معتمد طلبات الصرف');
    // الطلب المصروف جزئيًا يُغلق بما صُرف
    r.status = r.lines.some((l) => l.issuedQty > 0) ? 'issued' : 'cancelled';
    r.log = [...r.log, logEntry(r.status === 'issued' ? 'إغلاق الطلب بما صُرف' : 'إلغاء الطلب', a.fullName, reason)];
    await this.db.getRepository(PrIssueRequest).save(r);
    return this.get(a, id);
  }

  async list(a: OrgUser, q: { status?: string; warehouse?: string; q?: string; mine?: string; todo?: string }) {
    const org = a.organizationId;
    const rows: Record<string, unknown>[] = await this.db.query(
      `SELECT r.id, r.request_no AS "requestNo", r.purpose, r.status, r.needed_by AS "neededBy", r.created_at AS "createdAt", r.requested_by_id AS "requestedById",
              r.requested_by_name AS "requestedByName", r.receiver_name AS "receiverName", jsonb_array_length(r.lines)::int AS lines,
              w.id AS "warehouseId", w.name AS "warehouseName", w.keeper_ids AS "keeperIds", u.name AS "unitName"
         FROM pr_issue_requests r JOIN pr_warehouses w ON w.id = r.warehouse_id LEFT JOIN hr_units u ON u.id = r.unit_id
        WHERE r.organization_id = $1 AND ($2::text IS NULL OR r.status = $2) AND ($3::uuid IS NULL OR r.warehouse_id = $3::uuid)
          AND ($4::text IS NULL OR r.purpose ILIKE '%' || $4 || '%' OR r.requested_by_name ILIKE '%' || $4 || '%' OR ('ISR-' || LPAD(r.request_no::text, 4, '0')) ILIKE '%' || $4 || '%')
        ORDER BY r.request_no DESC LIMIT 500`, [org, q.status || null, q.warehouse || null, q.q?.trim() || null]);
    let out = rows.map((r) => ({
      ...r, requestedById: r.requestedById as string | null, code: issueRequestCode(r.requestNo as number), statusLabel: ISSUE_REQUEST_STATUS[r.status as IssueRequestStatus],
      myDecision: r.status === 'submitted' && can(a, P.issueApprove) && (a.isSuperadmin || r.requestedById !== a.id),
      myIssue: ['approved', 'partial'].includes(r.status as string) && can(a, P.stockOperate) && this.stock.isKeeper(a, { keeperIds: r.keeperIds as string[] }),
      keeperIds: undefined,
    }));
    if (q.mine === '1') out = out.filter((x) => x.requestedById === a.id);
    if (q.todo === '1') out = out.filter((x) => x.myDecision || x.myIssue);
    // من لا يملك الاعتماد أو الصرف يرى طلباته فقط
    if (!can(a, P.issueApprove) && !can(a, P.stockOperate) && !can(a, P.read)) out = out.filter((x) => x.requestedById === a.id);
    return out;
  }

  async get(a: OrgUser, id: string) {
    const org = a.organizationId;
    const r = await this.find(org, id);
    if (!can(a, P.issueApprove) && !can(a, P.stockOperate) && !can(a, P.read) && r.requestedById !== a.id) throw new NotFoundException('طلب الصرف غير موجود');
    const [wh, items, uoms, labels, fin, bal, docs, analytic] = await Promise.all([
      this.stock.warehouse(org, r.warehouseId),
      this.stock.items(org, r.lines.map((l) => l.itemId)),
      this.db.query('SELECT id, name FROM pr_uoms WHERE organization_id = $1', [org]) as Promise<{ id: string; name: string }[]>,
      this.sc.orgLabels(org, [r.unitId], [r.projectId]),
      this.sc.financeLabels(org, [], [r.fundingBatchId]),
      this.db.query(
        `SELECT l.item_id, COALESCE(SUM(l.qty_left) FILTER (WHERE l.expiry_date IS NULL OR l.expiry_date >= CURRENT_DATE), 0)::float AS qty
           FROM pr_stock_layers l WHERE l.warehouse_id = $1 AND l.item_id = ANY($2) GROUP BY 1`, [r.warehouseId, r.lines.map((l) => l.itemId)]) as Promise<{ item_id: string; qty: number }[]>,
      this.db.getRepository(PrStockDoc).find({ where: { issueRequestId: r.id }, order: { docNo: 'ASC' } }),
      r.analyticId ? this.db.query('SELECT id, code, name FROM acc_analytic_accounts WHERE id = $1', [r.analyticId]).catch(() => []) : Promise.resolve([]),
    ]);
    const uom = new Map(uoms.map((u) => [u.id, u.name]));
    const avail = new Map(bal.map((b) => [b.item_id, b.qty]));
    const batch = r.fundingBatchId ? fin.batches.get(r.fundingBatchId) : null;
    const decide = this.canDecide(a, r);
    return {
      ...r, code: issueRequestCode(r.requestNo), statusLabel: ISSUE_REQUEST_STATUS[r.status],
      warehouse: { id: wh.id, code: wh.code, name: wh.name },
      unitName: r.unitId ? labels.units.get(r.unitId) ?? null : null, projectName: r.projectId ? labels.projects.get(r.projectId) ?? null : null,
      funding: batch ? { id: batch.id, label: `الدفعة ${batch.batchNo} · ${batch.targetName}` } : null,
      analytic: analytic[0] ?? null,
      lines: r.lines.map((l) => {
        const it = items.get(l.itemId)!;
        return { ...l, itemCode: it.code, itemName: it.name, uomName: uom.get(it.uomId) ?? null, remaining: Math.max(0, q3(l.qty - l.issuedQty)), available: avail.get(l.itemId) ?? 0, trackBatch: it.trackBatch };
      }),
      docs: docs.map((d) => ({ id: d.id, kind: d.kind, code: docCode(d.kind, d.docNo), date: d.date, total: d.total, status: d.status })),
      can: {
        edit: ['draft', 'returned'].includes(r.status) && (a.isSuperadmin || r.requestedById === a.id),
        submit: ['draft', 'returned'].includes(r.status) && (a.isSuperadmin || r.requestedById === a.id),
        decide: decide.ok, decideWhy: r.status === 'submitted' ? decide.why : null,
        issue: ['approved', 'partial'].includes(r.status) && can(a, P.stockOperate) && this.stock.isKeeper(a, wh),
        cancel: !['issued', 'rejected', 'cancelled'].includes(r.status) && (a.isSuperadmin || r.requestedById === a.id || can(a, P.issueApprove)),
      },
    };
  }
}
