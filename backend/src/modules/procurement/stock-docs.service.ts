import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { DataSource, EntityManager } from 'typeorm';
import { OrgUser } from '../../core/auth/decorators';
import { FundraisingService } from '../fundraising/fundraising.service';
import { BudgetAvailability } from '../planning/budget/budget-availability.service';
import { PrItem, PrSupplier, PrWarehouse } from './entities/procurement.entity';
import { PrOrder } from './entities/sourcing.entity';
import { PrIssueRequest, PrReceipt, PrStockDoc, STOCK_DOC_KINDS, StockDocKind, StockDocLine, WRITEOFF_REASONS } from './entities/stock.entity';
import { PROCUREMENT_PERMISSIONS as P } from './procurement.manifest';
import { logEntry, ProcurementCore, prToday, supplierCode } from './procurement-core.service';
import { can } from './requests.service';
import { orderCode, r2, SourcingCore } from './sourcing-core.service';
import { docCode, GlLine, issueRequestCode, MoveCtx, q3, receiptCode, StockCore } from './stock-core.service';
import { IssueDto, ReturnDto, TransferDto, WriteoffDto } from './stock.dto';

/**
 * مستندات المخزون: سند الصرف (من طلب صرف معتمد)، والتحويل بين المستودعات أو مواقع التخزين، والمرتجع للمورد (من استلام)،
 * والمرتجع من الجهة (من سند صرف)، والإتلاف والشطب (باعتماد مستقل). كل مستند يحدّث الأرصدة فورًا ويصدر سند مخازن،
 * ولا يُعدَّل بعد ترحيله؛ والتصحيح بمستند عكسي (مرتجع أو تحويل معاكس).
 */
@Injectable()
export class StockDocsService {
  constructor(
    private readonly db: DataSource, private readonly core: ProcurementCore, private readonly stock: StockCore, private readonly sc: SourcingCore,
    private readonly avail: BudgetAvailability, private readonly fundraising: FundraisingService,
  ) {}

  async find(org: string, id: string) {
    const d = await this.db.getRepository(PrStockDoc).findOne({ where: { id, organizationId: org } });
    if (!d) throw new NotFoundException('المستند غير موجود');
    return d;
  }

  private operate(a: OrgUser) {
    if (!can(a, P.stockOperate)) throw new ForbiddenException('عمليات المستودع لأمناء المستودعات ومن لديه صلاحيتها');
  }
  private future(date: string) {
    if (date > prToday()) throw new BadRequestException('التاريخ في المستقبل');
  }

  private async newDoc(em: EntityManager, a: OrgUser, kind: StockDocKind, d: Partial<PrStockDoc> & { warehouseId: string; date: string }) {
    const no = await this.stock.nextNo(em, 'pr_stock_docs', 'doc_no', a.organizationId, kind);
    return em.save(em.create(PrStockDoc, {
      organizationId: a.organizationId, kind, docNo: no, status: 'posted', createdById: a.id, createdByName: a.fullName, lines: [], total: 0, ...d,
    }));
  }

  private ctx(a: OrgUser, d: PrStockDoc): MoveCtx {
    return { org: a.organizationId, date: d.date, docType: 'doc', docId: d.id, docCode: docCode(d.kind, d.docNo), byName: a.fullName, projectId: d.projectId, unitId: d.unitId };
  }

  private async location(em: EntityManager, w: PrWarehouse, id: string | null | undefined) {
    if (!id) return null;
    const [l] = await em.query('SELECT id FROM pr_locations WHERE id = $1 AND warehouse_id = $2 AND is_active', [id, w.id]);
    if (!l) throw new BadRequestException(`موقع التخزين ليس في المستودع «${w.name}»`);
    return id;
  }

  // ---------------- الصرف ----------------

  /** سند صرف من طلب صرف معتمد: المصروف مدين (بمركز التكلفة) والمخزون دائن بتكلفة الصرف */
  async issue(a: OrgUser, dto: IssueDto) {
    this.operate(a);
    this.future(dto.date);
    const org = a.organizationId;
    const s = await this.core.settings(org);
    const id = await this.db.transaction(async (em) => {
      const r = await em.getRepository(PrIssueRequest).createQueryBuilder('r').setLock('pessimistic_write').where('r.id = :id AND r.organization_id = :org', { id: dto.issueRequestId, org }).getOne();
      if (!r) throw new NotFoundException('طلب الصرف غير موجود');
      if (!['approved', 'partial'].includes(r.status)) throw new ConflictException('يُصرف من طلب صرف معتمد فقط');
      const w = await this.stock.warehouse(org, r.warehouseId, em);
      this.stock.assertKeeper(a, w);
      const items = await this.stock.items(org, dto.lines.map((l) => l.itemId), em);
      const doc = await this.newDoc(em, a, 'issue', {
        warehouseId: w.id, date: dto.date, issueRequestId: r.id, unitId: r.unitId, projectId: r.projectId, analyticId: r.analyticId, fundingBatchId: r.fundingBatchId,
        receiverName: dto.receiverName ?? r.receiverName, notes: dto.notes ?? null, log: [logEntry('صرف مواد', a.fullName, issueRequestCode(r.requestNo))],
      });
      const ctx = this.ctx(a, doc);
      const gl: GlLine[] = [];
      const lines: StockDocLine[] = [];
      for (const x of dto.lines) {
        const rl = r.lines.find((l) => l.id === x.refLineId) ?? r.lines.find((l) => l.itemId === x.itemId);
        if (!rl || rl.itemId !== x.itemId) throw new BadRequestException('أحد الأصناف ليس في طلب الصرف');
        const left = q3(rl.qty - rl.issuedQty);
        const it = items.get(x.itemId)!;
        if (x.qty > left + 0.0005) throw new ConflictException(`كمية «${it.name}» تتجاوز المتبقي من الطلب (${left})`);
        const eff = await this.stock.effective(org, it, s, em);
        const inv = await this.stock.inventoryAccount(org, it, w, s, em);
        const exp = await this.stock.expenseAccount(org, it, s, em);
        const out = await this.stock.outbound(em, ctx, {
          kind: 'issue', item: it, warehouseId: w.id, warehouseName: w.name, qty: x.qty, valuation: eff.valuation, accountId: inv, lot: x.lot ?? null,
          locationId: await this.location(em, w, x.locationId),
        });
        for (const p of out.picks) {
          lines.push({ id: randomUUID(), itemId: it.id, qty: p.qty, lot: p.lot, expiryDate: p.expiryDate, locationId: p.locationId, toLocationId: null, value: p.value, refLineId: rl.id });
        }
        gl.push({ accountId: exp, debit: out.value, credit: 0, label: `صرف ${it.name}`, analyticId: r.analyticId }, { accountId: inv, debit: 0, credit: out.value, label: `صرف ${it.name}` });
        rl.issuedQty = q3(rl.issuedQty + x.qty);
      }
      const label = `سند صرف ${docCode('issue', doc.docNo)} بطلب ${issueRequestCode(r.requestNo)}: ${r.purpose}`;
      doc.lines = lines;
      doc.total = r2(lines.reduce((t, l) => t + l.value, 0));
      doc.entryId = await this.stock.postEntry(em, a, { documentDate: dto.date, description: label, counterparty: doc.receiverName }, gl, 'طلب الصرف (مركز التكلفة)');
      await em.save(doc);
      r.status = r.lines.every((l) => l.issuedQty + 0.0005 >= l.qty) ? 'issued' : 'partial';
      r.log = [...r.log, logEntry(r.status === 'issued' ? 'صُرف الطلب بالكامل' : 'صرف جزئي', a.fullName, docCode('issue', doc.docNo))];
      await em.save(r);
      return doc.id;
    });
    return this.get(a, id);
  }

  // ---------------- التحويل ----------------

  /** تحويل بين مستودعين (أو بين مواقع المستودع نفسه) بالتكلفة نفسها؛ ويصدر قيد إن اختلف حساب المخزون */
  async transfer(a: OrgUser, dto: TransferDto) {
    this.operate(a);
    this.future(dto.date);
    const org = a.organizationId;
    const s = await this.core.settings(org);
    const id = await this.db.transaction(async (em) => {
      const from = await this.stock.warehouse(org, dto.warehouseId, em);
      const to = await this.stock.warehouse(org, dto.toWarehouseId, em);
      this.stock.assertKeeper(a, from);
      if (!to.isActive) throw new ConflictException(`المستودع «${to.name}» موقوف`);
      const same = from.id === to.id;
      if (same && dto.lines.some((l) => !l.toLocationId)) throw new BadRequestException('التحويل داخل المستودع نفسه يكون بين مواقع التخزين: حدد الموقع المحوّل إليه');
      const items = await this.stock.items(org, dto.lines.map((l) => l.itemId), em);
      const doc = await this.newDoc(em, a, 'transfer', { warehouseId: from.id, toWarehouseId: to.id, date: dto.date, notes: dto.notes ?? null, log: [logEntry('تحويل', a.fullName, `${from.name} ← ${to.name}`)] });
      const ctx = this.ctx(a, doc);
      const gl: GlLine[] = [];
      const lines: StockDocLine[] = [];
      for (const x of dto.lines) {
        const it = items.get(x.itemId)!;
        const eff = await this.stock.effective(org, it, s, em);
        const accFrom = await this.stock.inventoryAccount(org, it, from, s, em);
        const accTo = await this.stock.inventoryAccount(org, it, to, s, em);
        const toLoc = await this.location(em, to, x.toLocationId);
        const out = await this.stock.outbound(em, ctx, {
          kind: 'transfer_out', item: it, warehouseId: from.id, warehouseName: from.name, qty: x.qty, valuation: eff.valuation, accountId: accFrom, lot: x.lot ?? null,
          locationId: await this.location(em, from, x.locationId), allowExpired: true,
        });
        for (const p of out.picks) {
          await this.stock.inbound(em, ctx, { kind: 'transfer_in', item: it, warehouseId: to.id, qty: p.qty, value: p.value, lot: p.lot, expiryDate: p.expiryDate, locationId: toLoc, accountId: accTo });
          lines.push({ id: randomUUID(), itemId: it.id, qty: p.qty, lot: p.lot, expiryDate: p.expiryDate, locationId: p.locationId, toLocationId: toLoc, value: p.value, refLineId: null });
        }
        gl.push({ accountId: accTo, debit: out.value, credit: 0, label: `تحويل ${it.name}` }, { accountId: accFrom, debit: 0, credit: out.value, label: `تحويل ${it.name}` });
      }
      doc.lines = lines;
      doc.total = r2(lines.reduce((t, l) => t + l.value, 0));
      doc.entryId = await this.stock.postEntry(em, a, { documentDate: dto.date, description: `تحويل مخزني ${docCode('transfer', doc.docNo)} من ${from.name} إلى ${to.name}` }, gl, 'التحويل');
      await em.save(doc);
      return doc.id;
    });
    return this.get(a, id);
  }

  // ---------------- المرتجعات ----------------

  /**
   * مرتجع للمورد من استلام بتعميد: يخرج من طبقات ذلك الاستلام، ويُقيد للبضاعة المستلمة غير المفوترة بتكلفة الاستلام
   * (والفرق عن تكلفة المخزون لحساب الفروقات)، ويعود المبلغ إلى حجز الموازنة ومصدر التمويل، وتعود الكمية متبقية في التعميد.
   */
  async returnToSupplier(a: OrgUser, dto: ReturnDto) {
    this.operate(a);
    this.future(dto.date);
    const org = a.organizationId;
    const s = await this.core.settings(org);
    let notify: { supplierId: string; orderId: string; orderNo: number; docId: string; code: string } | null = null;
    const id = await this.db.transaction(async (em) => {
      const rc = await em.getRepository(PrReceipt).findOne({ where: { id: dto.refId, organizationId: org } });
      if (!rc || rc.kind !== 'order' || rc.status !== 'posted' || !rc.warehouseId) throw new NotFoundException('الاستلام غير موجود أو لا يُرجع منه');
      const o = await em.getRepository(PrOrder).createQueryBuilder('o').setLock('pessimistic_write').where('o.id = :id', { id: rc.orderId }).getOneOrFail();
      const w = await this.stock.warehouse(org, rc.warehouseId, em);
      this.stock.assertKeeper(a, w);
      if (!s.grniAccountId) throw new BadRequestException('حدد حساب البضاعة المستلمة غير المفوترة في إعدادات المستودعات أولًا');
      const prior: { ref: string; qty: string }[] = await em.query(
        `SELECT l->>'refLineId' AS ref, SUM((l->>'qty')::numeric) AS qty FROM pr_stock_docs d, jsonb_array_elements(d.lines) l
          WHERE d.ref_id = $1 AND d.kind = 'return_supplier' AND d.status = 'posted' GROUP BY 1`, [rc.id]);
      const returned = new Map(prior.map((p) => [p.ref, Number(p.qty)]));
      const items = await this.stock.items(org, dto.lines.map((l) => l.itemId), em);
      const doc = await this.newDoc(em, a, 'return_supplier', {
        warehouseId: w.id, date: dto.date, refId: rc.id, supplierId: rc.supplierId, projectId: rc.projectId, unitId: o.unitId, notes: dto.notes,
        log: [logEntry('مرتجع للمورد', a.fullName, `${receiptCode(rc.receiptNo)}: ${dto.notes}`)],
      });
      const ctx = this.ctx(a, doc);
      const gl: GlLine[] = [];
      const lines: StockDocLine[] = [];
      let orderValue = 0;
      for (const x of dto.lines) {
        const rl = rc.lines.find((l) => l.id === x.refLineId);
        if (!rl || rl.itemId !== x.itemId || rl.treatment !== 'stock') throw new BadRequestException('أحد البنود ليس من أصناف المخزون في هذا الاستلام (الأصول الثابتة تُعاد بإلغاء الاستلام قبل استخدامها)');
        const left = q3(rl.acceptedQty - (returned.get(rl.id) ?? 0));
        const it = items.get(x.itemId)!;
        if (x.qty > left + 0.0005) throw new ConflictException(`كمية «${it.name}» تتجاوز المستلم غير المرتجع (${left})`);
        const eff = await this.stock.effective(org, it, s, em);
        const out = await this.stock.outbound(em, ctx, {
          kind: 'return_supplier', item: it, warehouseId: w.id, warehouseName: w.name, qty: x.qty, valuation: eff.valuation, accountId: rl.accountId!, sourceId: rc.id, lot: rl.lot,
          allowExpired: true,
        }).catch((e: Error) => { throw new ConflictException(`لا يكفي المتبقي من هذا الاستلام في المستودع: ${e.message}`); });
        const cost = r2((rl.value / rl.acceptedQty) * x.qty);
        for (const p of out.picks) lines.push({ id: randomUUID(), itemId: it.id, qty: p.qty, lot: p.lot, expiryDate: p.expiryDate, locationId: p.locationId, toLocationId: null, value: p.value, refLineId: rl.id });
        gl.push({ accountId: s.grniAccountId, debit: cost, credit: 0, label: `مرتجع ${it.name}` }, { accountId: rl.accountId!, debit: 0, credit: out.value, label: `مرتجع ${it.name}` });
        if (r2(cost - out.value)) {
          if (!s.adjustAccountId) throw new BadRequestException('حدد حساب فروقات المخزون في إعدادات المستودعات أولًا');
          gl.push({ accountId: s.adjustAccountId, debit: r2(out.value - cost) > 0 ? r2(out.value - cost) : 0, credit: r2(cost - out.value) > 0 ? r2(cost - out.value) : 0, label: 'فرق تكلفة المرتجع', analyticId: null });
        }
        const ol = o.lines.find((l) => l.lineId === rl.orderLineId);
        orderValue += (ol?.unitPrice ?? 0) * x.qty;
      }
      const code = docCode('return_supplier', doc.docNo);
      doc.lines = lines;
      doc.total = r2(lines.reduce((t, l) => t + l.value, 0));
      const [sup] = await em.query('SELECT name FROM pr_suppliers WHERE id = $1', [rc.supplierId]);
      for (const g of gl) if (g.accountId === s.adjustAccountId) g.analyticId = s.adjustAnalyticId;
      doc.entryId = await this.stock.postEntry(em, a, { documentDate: dto.date, description: `مرتجع للمورد ${code} من الاستلام ${receiptCode(rc.receiptNo)}`, counterparty: sup?.name ?? null }, gl, 'المرتجع');
      // ---- عودة الحجز وحالة التعميد ----
      const amount = r2(orderValue * (o.subtotal > 0 ? o.total / o.subtotal : 1));
      const live = o.closeKind !== 'short';
      if (o.commitmentId && amount > 0) doc.budgetBack = -(await this.avail.consume(org, o.commitmentId, -amount, a.fullName, em));
      const [{ spent }] = await em.query(
        `SELECT (SELECT COALESCE(SUM(funding_spent), 0) FROM pr_receipts WHERE id = $1) - (SELECT COALESCE(SUM(funding_back), 0) FROM pr_stock_docs WHERE ref_id = $1 AND status = 'posted' AND id <> $2) AS spent`,
        [rc.id, doc.id]);
      const back = r2(Math.min(amount, Number(spent)));
      if (o.fundingBatchId && back > 0) {
        await this.fundraising.unspend(org, o.fundingBatchId, back, live, em);
        doc.fundingBack = back;
        if (live) o.fundingReserved = r2(o.fundingReserved + back);
      }
      if (live && o.status === 'closed') {
        o.status = 'partial';
        o.closeKind = null;
        await em.query(`UPDATE pr_requests SET status = 'ordered', updated_at = now() WHERE id = $1 AND status = 'closed'`, [o.requestId]);
      }
      o.log = [...o.log, logEntry('مرتجع للمورد', a.fullName, `${code}: ${dto.notes}`)];
      await em.save(o);
      await em.save(doc);
      notify = { supplierId: o.supplierId, orderId: o.id, orderNo: o.orderNo, docId: doc.id, code };
      return doc.id;
    });
    const n = notify as { supplierId: string; orderId: string; orderNo: number; docId: string; code: string } | null;
    if (n) {
      await this.sc.notifySuppliers(org, [n.supplierId], {
        kind: 'supplier-receipt', title: `مرتجع على التعميد ${orderCode(n.orderNo)}`, dedupe: `po-return:${n.docId}`, path: `/orders/${n.orderId}`,
        paragraphs: [`نحيطكم علمًا بإرجاع كميات من توريدكم بموجب المستند ${n.code}، والسبب: ${dto.notes}`],
      });
    }
    return this.get(a, id);
  }

  /** مرتجع من الجهة: تعود المواد المصروفة إلى المستودع بتكلفة صرفها، ويُعكس المصروف على مركز التكلفة نفسه */
  async returnIn(a: OrgUser, dto: ReturnDto) {
    this.operate(a);
    this.future(dto.date);
    const org = a.organizationId;
    const s = await this.core.settings(org);
    const id = await this.db.transaction(async (em) => {
      const src = await em.getRepository(PrStockDoc).findOne({ where: { id: dto.refId, organizationId: org } });
      if (!src || src.kind !== 'issue' || src.status !== 'posted') throw new NotFoundException('سند الصرف غير موجود');
      const w = await this.stock.warehouse(org, src.warehouseId, em);
      this.stock.assertKeeper(a, w);
      const prior: { ref: string; qty: string }[] = await em.query(
        `SELECT l->>'refLineId' AS ref, SUM((l->>'qty')::numeric) AS qty FROM pr_stock_docs d, jsonb_array_elements(d.lines) l
          WHERE d.ref_id = $1 AND d.kind = 'return_in' AND d.status = 'posted' GROUP BY 1`, [src.id]);
      const returned = new Map(prior.map((p) => [p.ref, Number(p.qty)]));
      const items = await this.stock.items(org, dto.lines.map((l) => l.itemId), em);
      const doc = await this.newDoc(em, a, 'return_in', {
        warehouseId: w.id, date: dto.date, refId: src.id, issueRequestId: src.issueRequestId, unitId: src.unitId, projectId: src.projectId, analyticId: src.analyticId,
        fundingBatchId: src.fundingBatchId, receiverName: src.receiverName, notes: dto.notes, log: [logEntry('مرتجع من الجهة', a.fullName, `${docCode('issue', src.docNo)}: ${dto.notes}`)],
      });
      const ctx = this.ctx(a, doc);
      const gl: GlLine[] = [];
      const lines: StockDocLine[] = [];
      for (const x of dto.lines) {
        const sl = src.lines.find((l) => l.id === x.refLineId);
        if (!sl || sl.itemId !== x.itemId) throw new BadRequestException('أحد البنود ليس من سند الصرف');
        const it = items.get(x.itemId)!;
        const left = q3(sl.qty - (returned.get(sl.id) ?? 0));
        if (x.qty > left + 0.0005) throw new ConflictException(`كمية «${it.name}» تتجاوز المصروف غير المرتجع (${left})`);
        const value = r2((sl.value / sl.qty) * x.qty);
        const inv = await this.stock.inventoryAccount(org, it, w, s, em);
        const exp = await this.stock.expenseAccount(org, it, s, em);
        await this.stock.inbound(em, ctx, { kind: 'return_in', item: it, warehouseId: w.id, qty: x.qty, value, lot: sl.lot, expiryDate: sl.expiryDate, locationId: sl.locationId, accountId: inv });
        lines.push({ id: randomUUID(), itemId: it.id, qty: q3(x.qty), lot: sl.lot, expiryDate: sl.expiryDate, locationId: sl.locationId, toLocationId: null, value, refLineId: sl.id });
        gl.push({ accountId: inv, debit: value, credit: 0, label: `مرتجع ${it.name}` }, { accountId: exp, debit: 0, credit: value, label: `مرتجع ${it.name}`, analyticId: src.analyticId });
      }
      const code = docCode('return_in', doc.docNo);
      doc.lines = lines;
      doc.total = r2(lines.reduce((t, l) => t + l.value, 0));
      doc.entryId = await this.stock.postEntry(em, a, { documentDate: dto.date, description: `مرتجع من الجهة ${code} على سند الصرف ${docCode('issue', src.docNo)}`, counterparty: src.receiverName }, gl, 'سند الصرف الأصلي');
      await em.save(doc);
      return doc.id;
    });
    return this.get(a, id);
  }

  // ---------------- الإتلاف ----------------

  /** محضر إتلاف أو شطب: يعده أمين المستودع، ويعتمده مسؤول آخر لديه صلاحية الاعتماد، وعندها فقط يخرج من الرصيد */
  async writeoff(a: OrgUser, dto: WriteoffDto) {
    this.operate(a);
    this.future(dto.date);
    const org = a.organizationId;
    const w = await this.stock.warehouse(org, dto.warehouseId);
    this.stock.assertKeeper(a, w);
    const items = await this.stock.items(org, dto.lines.map((l) => l.itemId));
    for (const l of dto.lines) if (['service', 'asset'].includes(items.get(l.itemId)!.kind)) throw new BadRequestException(`«${items.get(l.itemId)!.name}» ليس صنفًا مخزنيًا`);
    const id = await this.db.transaction(async (em) => {
      const doc = await this.newDoc(em, a, 'writeoff', {
        warehouseId: w.id, date: dto.date, reason: dto.reason, notes: dto.notes, status: 'pending',
        lines: dto.lines.map((l) => ({ id: randomUUID(), itemId: l.itemId, qty: q3(l.qty), lot: l.lot ?? null, expiryDate: null, locationId: l.locationId ?? null, toLocationId: null, value: 0, refLineId: null })),
        log: [logEntry('إعداد محضر الإتلاف', a.fullName, WRITEOFF_REASONS[dto.reason])],
      });
      return doc.id;
    });
    return this.get(a, id);
  }

  async approveWriteoff(a: OrgUser, id: string, note: string | null) {
    const org = a.organizationId;
    if (!can(a, P.stockApprove)) throw new ForbiddenException('اعتماد الإتلاف لمن لديه صلاحية اعتماد عمليات المستودعات');
    const s = await this.core.settings(org);
    if (!s.adjustAccountId) throw new BadRequestException('حدد حساب فروقات الجرد والإتلاف في إعدادات المستودعات أولًا');
    await this.db.transaction(async (em) => {
      const doc = await em.getRepository(PrStockDoc).createQueryBuilder('d').setLock('pessimistic_write').where('d.id = :id AND d.organization_id = :org', { id, org }).getOne();
      if (!doc || doc.kind !== 'writeoff') throw new NotFoundException('محضر الإتلاف غير موجود');
      if (doc.status !== 'pending') throw new ConflictException('المحضر ليس بانتظار الاعتماد');
      if (!a.isSuperadmin && doc.createdById === a.id) throw new ForbiddenException('لا يعتمد الموظف محضر إتلاف أعده بنفسه');
      const w = await this.stock.warehouse(org, doc.warehouseId, em);
      const items = await this.stock.items(org, doc.lines.map((l) => l.itemId), em);
      doc.date = doc.date > prToday() ? prToday() : doc.date;
      const ctx = this.ctx(a, doc);
      const gl: GlLine[] = [];
      const lines: StockDocLine[] = [];
      const analytic = s.adjustAnalyticId;
      for (const x of doc.lines) {
        const it = items.get(x.itemId)!;
        const eff = await this.stock.effective(org, it, s, em);
        const inv = await this.stock.inventoryAccount(org, it, w, s, em);
        const out = await this.stock.outbound(em, ctx, {
          kind: 'writeoff', item: it, warehouseId: w.id, warehouseName: w.name, qty: x.qty, valuation: eff.valuation, accountId: inv, lot: x.lot, locationId: x.locationId, allowExpired: true,
        });
        for (const p of out.picks) lines.push({ id: randomUUID(), itemId: it.id, qty: p.qty, lot: p.lot, expiryDate: p.expiryDate, locationId: p.locationId, toLocationId: null, value: p.value, refLineId: x.id });
        gl.push({ accountId: s.adjustAccountId!, debit: out.value, credit: 0, label: `إتلاف ${it.name}`, analyticId: analytic }, { accountId: inv, debit: 0, credit: out.value, label: `إتلاف ${it.name}` });
      }
      const code = docCode('writeoff', doc.docNo);
      doc.lines = lines;
      doc.total = r2(lines.reduce((t, l) => t + l.value, 0));
      doc.entryId = await this.stock.postEntry(em, a, { documentDate: doc.date, description: `إتلاف وشطب ${code} (${WRITEOFF_REASONS[doc.reason!]}) من ${w.name}` }, gl, 'إعدادات المستودعات (مركز تكلفة الفروقات)');
      doc.status = 'posted';
      doc.approvedByName = a.fullName;
      doc.log = [...doc.log, logEntry('اعتماد الإتلاف وترحيله', a.fullName, note)];
      await em.save(doc);
    });
    return this.get(a, id);
  }

  async rejectWriteoff(a: OrgUser, id: string, reason: string) {
    const d = await this.find(a.organizationId, id);
    if (d.kind !== 'writeoff' || d.status !== 'pending') throw new ConflictException('المحضر ليس بانتظار الاعتماد');
    if (!can(a, P.stockApprove) && d.createdById !== a.id) throw new ForbiddenException('لا تملك صلاحية رفض المحضر');
    d.status = 'cancelled';
    d.cancelReason = reason;
    d.log = [...d.log, logEntry(d.createdById === a.id ? 'إلغاء المحضر' : 'رفض المحضر', a.fullName, reason)];
    await this.db.getRepository(PrStockDoc).save(d);
    return this.get(a, id);
  }

  // ---------------- العرض ----------------

  async list(a: OrgUser, q: { kind?: string; warehouse?: string; status?: string; q?: string; ref?: string }) {
    const rows: Record<string, unknown>[] = await this.db.query(
      `SELECT d.id, d.kind, d.doc_no AS "docNo", d.date, d.status, d.total::float AS total, d.receiver_name AS "receiverName", d.reason, d.created_by_name AS "createdByName",
              d.created_by_id AS "createdById", jsonb_array_length(d.lines)::int AS lines, w.name AS "warehouseName", tw.name AS "toWarehouseName", s.name AS "supplierName",
              r.request_no AS "requestNo"
         FROM pr_stock_docs d JOIN pr_warehouses w ON w.id = d.warehouse_id LEFT JOIN pr_warehouses tw ON tw.id = d.to_warehouse_id
         LEFT JOIN pr_suppliers s ON s.id = d.supplier_id LEFT JOIN pr_issue_requests r ON r.id = d.issue_request_id
        WHERE d.organization_id = $1 AND ($2::text IS NULL OR d.kind = $2) AND ($3::uuid IS NULL OR d.warehouse_id = $3::uuid OR d.to_warehouse_id = $3::uuid)
          AND ($4::text IS NULL OR d.status = $4) AND ($5::uuid IS NULL OR d.ref_id = $5::uuid)
          AND ($6::text IS NULL OR d.receiver_name ILIKE '%' || $6 || '%' OR d.notes ILIKE '%' || $6 || '%' OR s.name ILIKE '%' || $6 || '%')
        ORDER BY d.date DESC, d.created_at DESC LIMIT 500`, [a.organizationId, q.kind || null, q.warehouse || null, q.status || null, q.ref || null, q.q?.trim() || null]);
    return rows.map((r) => ({
      ...r, code: docCode(r.kind as StockDocKind, r.docNo as number), kindLabel: STOCK_DOC_KINDS[r.kind as StockDocKind],
      statusLabel: { pending: 'بانتظار الاعتماد', posted: 'مرحّل', cancelled: 'ملغى' }[r.status as string],
      reasonLabel: r.reason ? WRITEOFF_REASONS[r.reason as keyof typeof WRITEOFF_REASONS] : null, requestCode: r.requestNo ? issueRequestCode(r.requestNo as number) : null,
      myApproval: r.status === 'pending' && can(a, P.stockApprove) && (a.isSuperadmin || r.createdById !== a.id),
    }));
  }

  async get(a: OrgUser, id: string) {
    const org = a.organizationId;
    const d = await this.find(org, id);
    const [wh, to, items, locs, entry, sup, req, ref, labels, children] = await Promise.all([
      this.stock.warehouse(org, d.warehouseId),
      d.toWarehouseId ? this.stock.warehouse(org, d.toWarehouseId) : null,
      this.stock.items(org, d.lines.map((l) => l.itemId)).catch(() => new Map<string, PrItem>()),
      this.db.query('SELECT id, name FROM pr_locations WHERE organization_id = $1', [org]) as Promise<{ id: string; name: string }[]>,
      this.stock.entryRef(org, d.entryId),
      d.supplierId ? this.db.getRepository(PrSupplier).findOne({ where: { id: d.supplierId } }) : null,
      d.issueRequestId ? this.db.getRepository(PrIssueRequest).findOne({ where: { id: d.issueRequestId } }) : null,
      d.refId ? (d.kind === 'return_supplier' ? this.db.getRepository(PrReceipt).findOne({ where: { id: d.refId } }) : this.db.getRepository(PrStockDoc).findOne({ where: { id: d.refId } })) : null,
      this.sc.orgLabels(org, [d.unitId], [d.projectId]),
      d.kind === 'issue' ? this.db.getRepository(PrStockDoc).find({ where: { refId: d.id, kind: 'return_in' } }) : Promise.resolve([] as PrStockDoc[]),
    ]);
    const loc = new Map(locs.map((x) => [x.id, x.name]));
    const returned = new Map<string, number>();
    for (const c of children.filter((x) => x.status === 'posted')) for (const l of c.lines) returned.set(l.refLineId ?? '', q3((returned.get(l.refLineId ?? '') ?? 0) + l.qty));
    const refView = ref
      ? 'receiptNo' in ref ? { id: ref.id, code: receiptCode(ref.receiptNo), kind: 'receipt' } : { id: ref.id, code: docCode(ref.kind, ref.docNo), kind: 'doc' }
      : null;
    return {
      ...d, code: docCode(d.kind, d.docNo), kindLabel: STOCK_DOC_KINDS[d.kind], statusLabel: { pending: 'بانتظار الاعتماد', posted: 'مرحّل', cancelled: 'ملغى' }[d.status],
      reasonLabel: d.reason ? WRITEOFF_REASONS[d.reason] : null,
      warehouse: { id: wh.id, code: wh.code, name: wh.name }, toWarehouse: to ? { id: to.id, code: to.code, name: to.name } : null,
      supplier: sup ? { id: sup.id, code: supplierCode(sup.supplierNo), name: sup.name } : null,
      issueRequest: req ? { id: req.id, code: issueRequestCode(req.requestNo), purpose: req.purpose } : null,
      ref: refView, entry,
      unitName: d.unitId ? labels.units.get(d.unitId) ?? null : null, projectName: d.projectId ? labels.projects.get(d.projectId) ?? null : null,
      lines: d.lines.map((l) => {
        const it = items.get(l.itemId);
        return {
          ...l, itemCode: it?.code ?? null, itemName: it?.name ?? null, locationName: l.locationId ? loc.get(l.locationId) ?? null : null,
          toLocationName: l.toLocationId ? loc.get(l.toLocationId) ?? null : null, returnedQty: returned.get(l.id) ?? 0,
        };
      }),
      returns: children.map((c) => ({ id: c.id, code: docCode(c.kind, c.docNo), date: c.date, total: c.total, status: c.status })),
      can: {
        approve: d.kind === 'writeoff' && d.status === 'pending' && can(a, P.stockApprove) && (a.isSuperadmin || d.createdById !== a.id),
        reject: d.kind === 'writeoff' && d.status === 'pending' && (can(a, P.stockApprove) || d.createdById === a.id),
        returnIn: d.kind === 'issue' && d.status === 'posted' && can(a, P.stockOperate) && d.lines.some((l) => l.qty > (returned.get(l.id) ?? 0)),
      },
    };
  }
}
