import { assertInvoiceCover } from './invoice-cover';
import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { DataSource, EntityManager } from 'typeorm';
import { OrgUser } from '../../core/auth/decorators';
import { AssetOpsService } from '../accounting/asset-ops.service';
import { FundraisingService } from '../fundraising/fundraising.service';
import { BudgetAvailability } from '../planning/budget/budget-availability.service';
import { ITEM_KINDS, PrItem, PrSupplier } from './entities/procurement.entity';
import { ORDER_STATUS, PrOrder } from './entities/sourcing.entity';
import { INSPECTION_RESULTS, LINE_TREATMENT, LineTreatment, PrReceipt, PrStockDoc, RECEIPT_KINDS, RECEIPT_STATUS, ReceiptLine } from './entities/stock.entity';
import { PROCUREMENT_PERMISSIONS as P } from './procurement.manifest';
import { logEntry, ProcurementCore, prToday, supplierCode } from './procurement-core.service';
import { can } from './requests.service';
import { orderCode, r2, SourcingCore } from './sourcing-core.service';
import { GlLine, MoveCtx, q3, receiptCode, StockCore } from './stock-core.service';
import { ReceiptDto } from './stock.dto';

/** حالات التعميد التي يُستلم عليها */
export const RECEIVABLE = ['issued', 'acknowledged', 'accepted', 'clarification', 'partial'];

/**
 * الاستلام والفحص: استلام المواد أو إنجاز الخدمة بتعميد (بعد فحص لجنة الاستلام، والمرفوض لا يدخل)، والتبرع العيني بالقيمة العادلة،
 * والرصيد الافتتاحي للمستودعات. كل استلام يصدر سند مخازن واحد: المخزون أو الأصل الثابت أو المصروف مدين،
 * والبضاعة المستلمة غير المفوترة (أو التبرعات العينية أو الرصيد الافتتاحي) دائنة. والأصل الثابت يُنشأ تلقائيًا في الأصول الثابتة.
 * ويستهلك الاستلام بتعميد حجزه في بند الموازنة ومصدر التمويل بقيمته بأسعار التعميد.
 */
@Injectable()
export class ReceiptsService {
  constructor(
    private readonly db: DataSource, private readonly core: ProcurementCore, private readonly sc: SourcingCore, private readonly stock: StockCore,
    private readonly avail: BudgetAvailability, private readonly fundraising: FundraisingService, private readonly assetOps: AssetOpsService,
  ) {}

  async find(org: string, id: string, em: EntityManager = this.db.manager) {
    const r = await em.getRepository(PrReceipt).findOne({ where: { id, organizationId: org } });
    if (!r) throw new NotFoundException('الاستلام غير موجود');
    return r;
  }

  /** المستلم الصافي لكل بند تعميد: المقبول في الاستلامات المعتمدة ناقص المرتجع للمورد */
  async receivedByLine(orderId: string, em: EntityManager = this.db.manager) {
    const rows: { line_id: string; qty: string }[] = await em.query(
      `SELECT x.line_id, SUM(x.qty) AS qty FROM (
         SELECT l->>'orderLineId' AS line_id, (l->>'acceptedQty')::numeric AS qty
           FROM pr_receipts r, jsonb_array_elements(r.lines) l WHERE r.order_id = $1 AND r.status = 'posted'
         UNION ALL
         SELECT rl->>'orderLineId', -(dl->>'qty')::numeric
           FROM pr_stock_docs d JOIN pr_receipts r ON r.id = d.ref_id, jsonb_array_elements(d.lines) dl, jsonb_array_elements(r.lines) rl
          WHERE r.order_id = $1 AND d.kind = 'return_supplier' AND d.status = 'posted' AND rl->>'id' = dl->>'refLineId'
       ) x WHERE x.line_id IS NOT NULL GROUP BY 1`, [orderId]);
    return new Map(rows.map((r) => [r.line_id, Number(r.qty)]));
  }

  /** ما يُستلم على التعميد: الكمية المعمدة والمستلمة والمتبقية لكل بند */
  async receivable(a: OrgUser, orderId: string) {
    const org = a.organizationId;
    const o = await this.db.getRepository(PrOrder).findOne({ where: { id: orderId, organizationId: org } });
    if (!o) throw new NotFoundException('التعميد غير موجود');
    const [got, items, s, sup] = await Promise.all([
      this.receivedByLine(o.id), this.stock.items(org, o.lines.map((l) => l.itemId!).filter(Boolean)), this.core.settings(org),
      this.db.getRepository(PrSupplier).findOneOrFail({ where: { id: o.supplierId } }),
    ]);
    const factor = s.vatInCost ? 1 + o.vatRate / 100 : 1;
    return {
      order: { id: o.id, code: orderCode(o.orderNo), title: o.title, status: o.status, statusLabel: ORDER_STATUS[o.status], warehouseId: o.warehouseId, kind: o.kind, vatRate: o.vatRate },
      supplier: { id: sup.id, name: sup.name, code: supplierCode(sup.supplierNo) },
      receivable: RECEIVABLE.includes(o.status),
      settings: { overReceiptPct: s.overReceiptPct, requireInspection: s.requireInspection, vatInCost: s.vatInCost },
      lines: o.lines.map((l) => {
        const item = l.itemId ? items.get(l.itemId) ?? null : null;
        const received = q3(got.get(l.lineId ?? '') ?? 0);
        return {
          orderLineId: l.lineId, itemId: l.itemId, itemCode: item?.code ?? null, description: l.description, uomId: l.uomId, ordered: l.qty, received,
          remaining: Math.max(0, q3(l.qty - received)), unitPrice: l.unitPrice, unitCost: r2(l.unitPrice * factor),
          treatment: this.treatment(item, !!o.warehouseId), trackBatch: !!item?.trackBatch, trackExpiry: !!item?.trackExpiry, shelfLifeDays: item?.shelfLifeDays ?? null,
        };
      }),
    };
  }

  /** معالجة البند: الأصول تُنشأ أصلًا ثابتًا، والخدمات والبنود الحرة والتسليم المباشر مصروف، والباقي يدخل المخزون */
  private treatment(item: PrItem | null, hasWarehouse: boolean): LineTreatment {
    if (!item || item.kind === 'service') return 'expense';
    if (item.kind === 'asset') return 'asset';
    return hasWarehouse ? 'stock' : 'expense';
  }

  async create(a: OrgUser, dto: ReceiptDto) {
    const org = a.organizationId;
    if (!can(a, P.stockOperate)) throw new ForbiddenException('لا تملك صلاحية الاستلام');
    if (dto.date > prToday()) throw new BadRequestException('تاريخ الاستلام في المستقبل');
    const s = await this.core.settings(org);
    const out: { notify?: { supplierId: string; order: PrOrder; receipt: PrReceipt } } = {};
    const id = await this.db.transaction(async (em) => {
      let o: PrOrder | null = null;
      if (dto.kind === 'order') {
        if (!dto.orderId) throw new BadRequestException('اختر التعميد');
        o = await em.getRepository(PrOrder).createQueryBuilder('o').setLock('pessimistic_write').where('o.id = :id AND o.organization_id = :org', { id: dto.orderId, org }).getOne();
        if (!o) throw new NotFoundException('التعميد غير موجود');
        if (!RECEIVABLE.includes(o.status)) throw new ConflictException(`لا يُستلم على تعميد «${ORDER_STATUS[o.status]}»`);
        if (!a.isSuperadmin && o.createdById === a.id) throw new ForbiddenException('لا يستلم الموظف تعميدًا أعده بنفسه (فصل المهام)');
      } else if (dto.kind === 'donation') {
        if (!dto.donorName) throw new BadRequestException('اكتب اسم المتبرع');
        if (!s.donationAccountId) throw new BadRequestException('حدد حساب التبرعات العينية في إعدادات المستودعات أولًا');
      } else if (!s.openingAccountId) throw new BadRequestException('حدد الحساب المقابل للأرصدة الافتتاحية في إعدادات المستودعات أولًا');
      const warehouseId = dto.warehouseId ?? o?.warehouseId ?? null;
      const wh = warehouseId ? await this.stock.warehouse(org, warehouseId, em) : null;
      if (wh) this.stock.assertKeeper(a, wh);
      if (dto.kind === 'opening' && !wh) throw new BadRequestException('اختر المستودع');
      const credit = dto.kind === 'order' ? s.grniAccountId : dto.kind === 'donation' ? s.donationAccountId : s.openingAccountId;
      if (!credit) throw new BadRequestException('حدد حساب البضاعة المستلمة غير المفوترة في إعدادات المستودعات أولًا');

      // ---- البنود ----
      const got = o ? await this.receivedByLine(o.id, em) : new Map<string, number>();
      const items = await this.stock.items(org, [...(o?.lines.map((l) => l.itemId!) ?? []), ...dto.lines.map((l) => l.itemId!)].filter(Boolean), em);
      const factor = o && s.vatInCost ? 1 + o.vatRate / 100 : 1;
      const seen = new Set<string>();
      const lines: (ReceiptLine & { item: PrItem | null; orderPrice: number })[] = [];
      for (const [i, x] of dto.lines.entries()) {
        const n = i + 1;
        if (!(x.qty > 0)) continue;
        const rejected = q3(x.rejectedQty ?? 0);
        const accepted = q3(x.qty - rejected);
        if (accepted < 0) throw new BadRequestException(`البند ${n}: المرفوض أكبر من المسلّم`);
        if (rejected > 0 && !x.rejectReason) throw new BadRequestException(`البند ${n}: اكتب سبب رفض الكمية`);
        let item: PrItem | null;
        let description: string;
        let uomId: string | null;
        let unitPrice: number;
        let orderPrice = 0;
        let orderLineId: string | null = null;
        if (o) {
          const ol = o.lines.find((l) => l.lineId === x.orderLineId);
          if (!ol) throw new BadRequestException(`البند ${n} ليس من بنود التعميد`);
          if (seen.has(ol.lineId!)) throw new BadRequestException(`البند «${ol.description}» مكرر`);
          seen.add(ol.lineId!);
          const remaining = q3(ol.qty - (got.get(ol.lineId!) ?? 0));
          const max = q3(remaining * (1 + s.overReceiptPct / 100));
          if (accepted > max + 0.0005) {
            throw new ConflictException(`المقبول من «${ol.description}» (${accepted}) يتجاوز المتبقي من التعميد (${remaining})${s.overReceiptPct ? ` مع نسبة الزيادة المسموحة ${s.overReceiptPct}%` : ''}`);
          }
          item = ol.itemId ? items.get(ol.itemId) ?? null : null;
          description = ol.description;
          uomId = ol.uomId;
          orderPrice = ol.unitPrice;
          unitPrice = r2(ol.unitPrice * factor);
          orderLineId = ol.lineId;
        } else {
          if (!x.itemId) throw new BadRequestException(`البند ${n}: اختر الصنف من الدليل`);
          item = items.get(x.itemId)!;
          if (item.status !== 'active') throw new ConflictException(`الصنف «${item.name}» موقوف`);
          description = x.description ?? item.name;
          uomId = item.uomId;
          if (!(x.unitPrice && x.unitPrice > 0)) throw new BadRequestException(`البند ${n}: اكتب ${dto.kind === 'donation' ? 'القيمة العادلة للوحدة' : 'تكلفة الوحدة'}`);
          unitPrice = r2(x.unitPrice);
        }
        const treatment = this.treatment(item, !!wh);
        if (dto.kind === 'opening' && treatment !== 'stock') {
          throw new BadRequestException(`البند ${n}: الرصيد الافتتاحي للمستودع لأصناف المخزون فقط (${item ? ITEM_KINDS[item.kind] : 'بند حر'}). الأصول الثابتة لها أرصدتها الافتتاحية في الأصول`);
        }
        if (treatment === 'asset' && accepted && !Number.isInteger(accepted)) throw new BadRequestException(`البند ${n}: الأصول الثابتة تُستلم بعدد صحيح (كل وحدة أصل مستقل)`);
        if (treatment === 'asset' && accepted > 200) throw new BadRequestException(`البند ${n}: أقصى عدد أصول في استلام واحد 200`);
        if (x.locationId && (!wh || !(await em.query('SELECT 1 FROM pr_locations WHERE id = $1 AND warehouse_id = $2', [x.locationId, wh.id])).length)) {
          throw new BadRequestException(`البند ${n}: موقع التخزين ليس في المستودع`);
        }
        const expiry = x.expiryDate ?? null;
        if (treatment === 'stock' && accepted > 0 && item?.trackExpiry && !expiry) throw new BadRequestException(`البند ${n}: الصنف «${item.name}» له تاريخ صلاحية، فحدده`);
        if (treatment === 'stock' && accepted > 0 && item?.trackBatch && !x.lot) throw new BadRequestException(`البند ${n}: الصنف «${item.name}» يُتتبع بالتشغيلة، فاكتب رقمها`);
        if (expiry && expiry < dto.date && accepted > 0) throw new BadRequestException(`البند ${n}: الصنف منتهي الصلاحية في ${expiry}، فلا يُقبل`);
        lines.push({
          id: randomUUID(), orderLineId, itemId: item?.id ?? null, description, uomId, treatment, qty: q3(x.qty), acceptedQty: accepted, rejectedQty: rejected,
          rejectReason: rejected > 0 ? x.rejectReason ?? null : null, unitPrice, extraUnit: 0, value: 0, lot: treatment === 'stock' ? x.lot ?? null : null,
          expiryDate: treatment === 'stock' ? expiry : null, locationId: treatment === 'stock' ? x.locationId ?? null : null, accountId: null, assetIds: [], item, orderPrice,
        });
      }
      if (!lines.length) throw new BadRequestException('اكتب الكمية المسلّمة لبند واحد على الأقل');
      if (s.requireInspection && dto.kind === 'order' && !dto.inspection) throw new BadRequestException('فحص لجنة الاستلام إلزامي: سجّل أعضاء اللجنة ونتيجة الفحص');
      if (lines.some((l) => l.rejectedQty > 0) && !dto.inspection) throw new BadRequestException('سجّل نتيجة فحص لجنة الاستلام عند رفض كميات');
      if (dto.inspection && !dto.inspection.committee.length) throw new BadRequestException('اكتب أعضاء لجنة الاستلام والفحص');

      // ---- التكلفة: السعر + نصيب مصاريف النقل والتخليص بنسبة القيمة ----
      const accepted = lines.filter((l) => l.acceptedQty > 0);
      if (!accepted.length && !(dto.inspection?.result === 'rejected')) throw new BadRequestException('لا توجد كميات مقبولة');
      const base = accepted.reduce((t, l) => t + l.acceptedQty * l.unitPrice, 0);
      const extra = r2(dto.extraCost ?? 0);
      let extraLeft = extra;
      for (const [i, l] of accepted.entries()) {
        const share = i === accepted.length - 1 ? extraLeft : r2(base > 0 ? (extra * l.acceptedQty * l.unitPrice) / base : 0);
        extraLeft = r2(extraLeft - share);
        l.value = r2(l.acceptedQty * l.unitPrice + share);
        l.extraUnit = l.acceptedQty > 0 ? Math.round((share / l.acceptedQty) * 10000) / 10000 : 0;
      }
      const total = r2(accepted.reduce((t, l) => t + l.value, 0));
      const orderValue = r2(accepted.reduce((t, l) => t + l.acceptedQty * l.orderPrice, 0));

      // ---- الحسابات ----
      for (const l of accepted) {
        if (l.treatment === 'stock') l.accountId = await this.stock.inventoryAccount(org, l.item!, wh!, s, em);
        else if (l.treatment === 'expense') l.accountId = await this.stock.expenseAccount(org, l.item, s, em);
        else {
          const eff = await this.stock.effective(org, l.item!, s, em);
          if (!eff.assetGroupId) throw new BadRequestException(`حدد مجموعة الأصول الثابتة للصنف «${l.item!.name}» في مجموعته بدليل الأصناف`);
          const [g] = await em.query('SELECT asset_account_id FROM acc_asset_groups WHERE id = $1 AND organization_id = $2', [eff.assetGroupId, org]);
          if (!g) throw new BadRequestException('مجموعة الأصول الثابتة غير موجودة');
          l.accountId = g.asset_account_id;
        }
      }
      const expenseLines = accepted.filter((l) => l.treatment === 'expense');

      // ---- المستند ----
      const no = await this.stock.nextNo(em, 'pr_receipts', 'receipt_no', org);
      const code = receiptCode(no);
      const r = await em.getRepository(PrReceipt).save(em.create(PrReceipt, {
        organizationId: org, receiptNo: no, kind: dto.kind, orderId: o?.id ?? null, supplierId: o?.supplierId ?? null, warehouseId: wh?.id ?? null, date: dto.date,
        deliveryRef: dto.deliveryRef ?? null, donorName: dto.kind === 'donation' ? dto.donorName ?? null : null, analyticId: dto.analyticId ?? null,
        projectId: dto.projectId ?? o?.projectId ?? null, lines: lines.map(({ item: _i, orderPrice: _p, ...l }) => l), extraCost: extra, extraNote: dto.extraNote ?? null,
        total, orderValue, status: 'posted', notes: dto.notes ?? null, createdById: a.id, createdByName: a.fullName,
        inspection: dto.inspection ? { committee: dto.inspection.committee, result: dto.inspection.result, note: dto.inspection.note ?? null, byName: a.fullName, at: new Date().toISOString() } : null,
        log: [logEntry(`اعتماد ${RECEIPT_KINDS[dto.kind]}`, a.fullName, o ? orderCode(o.orderNo) : dto.donorName ?? null)],
      }));
      const ctx: MoveCtx = { org, date: dto.date, docType: 'receipt', docId: r.id, docCode: code, byName: a.fullName, projectId: r.projectId, unitId: o?.unitId ?? null };
      for (const l of accepted.filter((x) => x.treatment === 'stock')) {
        await this.stock.inbound(em, ctx, {
          kind: dto.kind === 'order' ? 'receipt' : dto.kind, item: l.item!, warehouseId: wh!.id, qty: l.acceptedQty, value: l.value, lot: l.lot, expiryDate: l.expiryDate,
          locationId: l.locationId, accountId: l.accountId!,
        });
      }
      const sup = o ? await em.getRepository(PrSupplier).findOneOrFail({ where: { id: o.supplierId } }) : null;
      const party = sup?.name ?? dto.donorName ?? null;
      const label = dto.kind === 'order' ? `استلام ${code} على التعميد ${orderCode(o!.orderNo)} من ${party}` : dto.kind === 'donation' ? `تبرع عيني ${code} من ${party}` : `رصيد افتتاحي للمستودع ${wh!.name} ${code}`;
      const gl: GlLine[] = [];
      for (const l of accepted) {
        gl.push({ accountId: l.accountId!, debit: l.value, credit: 0, label: `${label}: ${l.description}`.slice(0, 250), analyticId: l.treatment === 'expense' ? dto.analyticId ?? null : null });
        gl.push({ accountId: credit, debit: 0, credit: l.value, label, analyticId: null });
      }
      r.entryId = await this.stock.postEntry(em, a, { documentDate: dto.date, description: label, counterparty: party }, gl, expenseLines.length ? 'الاستلام (مركز التكلفة)' : 'الاستلام');
      // ---- الأصول الثابتة: أصل لكل وحدة مقبولة ----
      for (const l of accepted.filter((x) => x.treatment === 'asset')) {
        const eff = await this.stock.effective(org, l.item!, s, em);
        let rest = l.value;
        for (let k = 0; k < l.acceptedQty; k++) {
          const v = k === l.acceptedQty - 1 ? rest : r2(l.value / l.acceptedQty);
          rest = r2(rest - v);
          const asset = await this.assetOps.receiveFromProcurement(em, a, {
            groupId: eff.assetGroupId!, name: l.description, description: `${label}`, serialNumber: null, location: wh?.name ?? null, unitId: o?.unitId ?? null,
            analyticId: null, date: dto.date, amount: v, donation: dto.kind === 'donation', counterAccountId: credit, partyName: party, entryId: r.entryId!, receiptId: r.id,
            note: `${code}${o ? ` · ${orderCode(o.orderNo)}` : ''}`,
          });
          const rl = r.lines.find((x) => x.id === l.id)!;
          rl.assetIds = [...rl.assetIds, asset.id];
        }
      }
      for (const rl of r.lines) rl.accountId = accepted.find((x) => x.id === rl.id)?.accountId ?? null;

      // ---- استهلاك حجز الموازنة ومصدر التمويل وحالة التعميد ----
      if (o) {
        // يشمل هذا الاستلام (محفوظ في المعاملة نفسها)
        const after = await this.receivedByLine(o.id, em);
        const full = o.lines.every((l) => (after.get(l.lineId ?? '') ?? 0) + 0.0005 >= l.qty);
        const amount = r2(orderValue * (o.subtotal > 0 ? o.total / o.subtotal : 1));
        if (o.commitmentId) r.consumed = await this.avail.consume(org, o.commitmentId, full ? 1e12 : amount, a.fullName, em);
        const spend = r2(full ? o.fundingReserved : Math.min(amount, o.fundingReserved));
        if (o.fundingBatchId && spend > 0) {
          await this.fundraising.spend(org, o.fundingBatchId, spend, em);
          o.fundingReserved = r2(o.fundingReserved - spend);
          r.fundingSpent = spend;
        }
        const prev = o.status;
        o.status = full ? 'closed' : 'partial';
        o.closeKind = full ? 'received' : null;
        o.log = [...o.log, logEntry(full ? 'اكتمل الاستلام وأُغلق التعميد' : 'استلام جزئي', a.fullName, `${code} بقيمة ${total.toLocaleString('en-US')} ريال`)];
        await em.save(o);
        if (full) await this.closeRequestIfDone(em, o, a.fullName);
        if (prev !== o.status || accepted.length || lines.some((l) => l.rejectedQty > 0)) out.notify = { supplierId: o.supplierId, order: o, receipt: r };
      }
      await em.save(r);
      return r.id;
    });
    if (out.notify) await this.notifySupplier(org, out.notify);
    return this.get(a, id);
  }

  /** يُغلق طلب الشراء إذا أُغلقت كل تعميداته */
  async closeRequestIfDone(em: EntityManager, o: PrOrder, byName: string) {
    const [{ open }] = await em.query(`SELECT COUNT(*)::int AS open FROM pr_orders WHERE request_id = $1 AND status NOT IN ('closed', 'cancelled')`, [o.requestId]);
    if (open) return;
    await em.query(`UPDATE pr_requests SET status = 'closed', log = log || $2::jsonb, updated_at = now() WHERE id = $1 AND status = 'ordered'`,
      [o.requestId, JSON.stringify([logEntry('اكتمل استلام التعميدات', byName, orderCode(o.orderNo))])]);
  }

  private async notifySupplier(org: string, n: { supplierId: string; order: PrOrder; receipt: PrReceipt }) {
    const rejected = n.receipt.lines.filter((l) => l.rejectedQty > 0);
    await this.sc.notifySuppliers(org, [n.supplierId], {
      kind: 'supplier-receipt', title: `نتيجة استلام التعميد ${orderCode(n.order.orderNo)}`, dedupe: `po-receipt:${n.receipt.id}`, path: `/orders/${n.order.id}`,
      paragraphs: [
        `استُلمت التوريدات بموجب التعميد بتاريخ ${n.receipt.date} (${receiptCode(n.receipt.receiptNo)}).`,
        ...(n.receipt.inspection ? [`نتيجة فحص لجنة الاستلام: ${INSPECTION_RESULTS[n.receipt.inspection.result]}.`] : []),
        ...rejected.map((l) => `رُفضت كمية ${l.rejectedQty} من «${l.description}»: ${l.rejectReason ?? ''}`),
        n.order.status === 'closed' ? 'اكتمل استلام التعميد.' : 'التعميد مستلم جزئيًا، ونأمل توريد الكميات المتبقية في موعدها.',
      ],
    });
  }

  /** إلغاء الاستلام: إن لم يُصرف من كمياته ولم يُرجع منها شيء ولم تُستخدم أصوله، ويعود حجز الموازنة والتمويل */
  async cancel(a: OrgUser, id: string, reason: string) {
    const org = a.organizationId;
    if (!can(a, P.stockApprove)) throw new ForbiddenException('إلغاء الاستلام لمن لديه صلاحية اعتماد عمليات المستودعات');
    await this.db.transaction(async (em) => {
      const r = await em.getRepository(PrReceipt).createQueryBuilder('r').setLock('pessimistic_write').where('r.id = :id AND r.organization_id = :org', { id, org }).getOne();
      if (!r) throw new NotFoundException('الاستلام غير موجود');
      if (r.status !== 'posted') throw new ConflictException('الاستلام ملغى بالفعل');
      const [{ n }] = await em.query(`SELECT COUNT(*)::int AS n FROM pr_stock_docs WHERE ref_id = $1 AND status <> 'cancelled'`, [r.id]);
      if (n) throw new ConflictException('على هذا الاستلام مرتجع للمورد، فلا يُلغى');
      if (r.orderId) {
        const cut = new Map<string, number>();
        const names = new Map<string, string>();
        for (const l of r.lines) if (l.orderLineId) { cut.set(l.orderLineId, (cut.get(l.orderLineId) ?? 0) + Number(l.acceptedQty)); names.set(l.orderLineId, l.description); }
        await assertInvoiceCover(em, org, r.orderId, cut, names);
      }
      const code = receiptCode(r.receiptNo);
      const ok = await this.stock.reverseInbound(em, { org, date: prToday(), docType: 'receipt', docId: r.id, docCode: code, byName: a.fullName }, r.id);
      if (!ok) throw new ConflictException('صُرف أو حُوّل جزء من كميات هذا الاستلام، فلا يُلغى. أرجع الكميات المتبقية للمورد بمرتجع');
      if (r.lines.some((l) => l.assetIds.length)) await this.assetOps.cancelFromProcurement(em, a, r.id, `إلغاء الاستلام ${code}: ${reason}`);
      await this.stock.cancelEntry(em, a, r.entryId, `إلغاء الاستلام ${code} من المستودعات: ${reason}`);
      if (r.orderId) {
        const o = await em.getRepository(PrOrder).createQueryBuilder('o').setLock('pessimistic_write').where('o.id = :id', { id: r.orderId }).getOneOrFail();
        if (o.commitmentId && r.consumed > 0) await this.avail.consume(org, o.commitmentId, -r.consumed, a.fullName, em);
        const live = o.closeKind !== 'short';
        if (o.fundingBatchId && r.fundingSpent > 0) {
          await this.fundraising.unspend(org, o.fundingBatchId, r.fundingSpent, live, em);
          if (live) o.fundingReserved = r2(o.fundingReserved + r.fundingSpent);
        }
        if (live) {
          const [{ c }] = await em.query(`SELECT COUNT(*)::int AS c FROM pr_receipts WHERE order_id = $1 AND status = 'posted' AND id <> $2`, [o.id, r.id]);
          o.status = c ? 'partial' : o.acceptedAt ? 'accepted' : o.acknowledgedAt ? 'acknowledged' : 'issued';
          o.closeKind = null;
          await em.query(`UPDATE pr_requests SET status = 'ordered', updated_at = now() WHERE id = $1 AND status = 'closed'`, [o.requestId]);
        }
        o.log = [...o.log, logEntry('إلغاء استلام', a.fullName, `${code}: ${reason}`)];
        await em.save(o);
      }
      r.status = 'cancelled';
      r.cancelReason = reason;
      r.log = [...r.log, logEntry('إلغاء الاستلام', a.fullName, reason)];
      await em.save(r);
    });
    return this.get(a, id);
  }

  async list(a: OrgUser, q: { kind?: string; warehouse?: string; q?: string; status?: string; order?: string }) {
    const rows: Record<string, unknown>[] = await this.db.query(
      `SELECT r.id, r.receipt_no AS "receiptNo", r.kind, r.date, r.status, r.total::float AS total, r.donor_name AS "donorName", r.created_by_name AS "createdByName",
              r.inspection->>'result' AS inspection, jsonb_array_length(r.lines)::int AS lines,
              EXISTS (SELECT 1 FROM jsonb_array_elements(r.lines) l WHERE (l->>'rejectedQty')::numeric > 0) AS "hasRejected",
              o.id AS "orderId", o.order_no AS "orderNo", s.name AS "supplierName", w.name AS "warehouseName"
         FROM pr_receipts r LEFT JOIN pr_orders o ON o.id = r.order_id LEFT JOIN pr_suppliers s ON s.id = r.supplier_id LEFT JOIN pr_warehouses w ON w.id = r.warehouse_id
        WHERE r.organization_id = $1 AND ($2::text IS NULL OR r.kind = $2) AND ($3::uuid IS NULL OR r.warehouse_id = $3::uuid) AND ($4::text IS NULL OR r.status = $4)
          AND ($5::uuid IS NULL OR r.order_id = $5::uuid)
          AND ($6::text IS NULL OR s.name ILIKE '%' || $6 || '%' OR r.donor_name ILIKE '%' || $6 || '%' OR ('GRN-' || LPAD(r.receipt_no::text, 4, '0')) ILIKE '%' || $6 || '%')
        ORDER BY r.receipt_no DESC LIMIT 500`, [a.organizationId, q.kind || null, q.warehouse || null, q.status || null, q.order || null, q.q?.trim() || null]);
    return rows.map((r) => ({
      ...r, code: receiptCode(r.receiptNo as number), kindLabel: RECEIPT_KINDS[r.kind as keyof typeof RECEIPT_KINDS], statusLabel: RECEIPT_STATUS[r.status as keyof typeof RECEIPT_STATUS],
      orderCode: r.orderNo ? orderCode(r.orderNo as number) : null, inspectionLabel: r.inspection ? INSPECTION_RESULTS[r.inspection as keyof typeof INSPECTION_RESULTS] : null,
    }));
  }

  async get(a: OrgUser, id: string) {
    const org = a.organizationId;
    const r = await this.find(org, id);
    const [o, sup, wh, items, uoms, locs, accs, entry, assets, returns] = await Promise.all([
      r.orderId ? this.db.getRepository(PrOrder).findOne({ where: { id: r.orderId } }) : null,
      r.supplierId ? this.db.getRepository(PrSupplier).findOne({ where: { id: r.supplierId } }) : null,
      r.warehouseId ? this.stock.warehouse(org, r.warehouseId) : null,
      this.stock.items(org, r.lines.map((l) => l.itemId!).filter(Boolean)).catch(() => new Map<string, PrItem>()),
      this.db.query('SELECT id, name FROM pr_uoms WHERE organization_id = $1', [org]) as Promise<{ id: string; name: string }[]>,
      this.db.query('SELECT id, name FROM pr_locations WHERE organization_id = $1', [org]) as Promise<{ id: string; name: string }[]>,
      this.core.accountMap(org, r.lines.map((l) => l.accountId)),
      this.stock.entryRef(org, r.entryId),
      this.db.query('SELECT id, code, name, status FROM acc_assets WHERE id = ANY($1)', [r.lines.flatMap((l) => l.assetIds)]) as Promise<{ id: string; code: string; name: string; status: string }[]>,
      this.db.getRepository(PrStockDoc).find({ where: { refId: r.id, kind: 'return_supplier' }, order: { docNo: 'ASC' } }),
    ]);
    const uom = new Map(uoms.map((u) => [u.id, u.name]));
    const loc = new Map(locs.map((u) => [u.id, u.name]));
    const asset = new Map(assets.map((x) => [x.id, x]));
    const returned = new Map<string, number>();
    for (const d of returns.filter((x) => x.status === 'posted')) for (const l of d.lines) returned.set(l.refLineId ?? '', q3((returned.get(l.refLineId ?? '') ?? 0) + l.qty));
    return {
      ...r, code: receiptCode(r.receiptNo), kindLabel: RECEIPT_KINDS[r.kind], statusLabel: RECEIPT_STATUS[r.status],
      order: o ? { id: o.id, code: orderCode(o.orderNo), title: o.title, status: o.status, statusLabel: ORDER_STATUS[o.status] } : null,
      supplier: sup ? { id: sup.id, code: supplierCode(sup.supplierNo), name: sup.name } : null,
      warehouse: wh ? { id: wh.id, code: wh.code, name: wh.name } : null,
      inspectionLabel: r.inspection ? INSPECTION_RESULTS[r.inspection.result] : null,
      entry,
      lines: r.lines.map((l) => ({
        ...l, itemCode: l.itemId ? items.get(l.itemId)?.code ?? null : null, uomName: l.uomId ? uom.get(l.uomId) ?? null : null, treatmentLabel: LINE_TREATMENT[l.treatment],
        locationName: l.locationId ? loc.get(l.locationId) ?? null : null, account: l.accountId ? accs.get(l.accountId) ?? null : null,
        assets: l.assetIds.map((x) => asset.get(x)).filter(Boolean), returnedQty: returned.get(l.id) ?? 0,
      })),
      returns: returns.map((d) => ({ id: d.id, code: `RTS-${String(d.docNo).padStart(4, '0')}`, date: d.date, total: d.total, status: d.status })),
      can: {
        cancel: r.status === 'posted' && can(a, P.stockApprove),
        returnToSupplier: r.status === 'posted' && r.kind === 'order' && can(a, P.stockOperate) && r.lines.some((l) => l.treatment === 'stock' && l.acceptedQty > (returned.get(l.id) ?? 0)),
      },
    };
  }

  /** إغلاق التعميد المستلم جزئيًا بالمستلم: يُفك حجز الباقي على بند الموازنة ومصدر التمويل */
  async shortClose(a: OrgUser, orderId: string, reason: string) {
    const org = a.organizationId;
    if (!can(a, P.sourcing) && !can(a, P.approveOrders) && !can(a, P.approveOrdersHigh)) throw new ForbiddenException('لا تملك صلاحية إغلاق التعميد');
    const o = await this.db.transaction(async (em) => {
      const x = await em.getRepository(PrOrder).createQueryBuilder('o').setLock('pessimistic_write').where('o.id = :id AND o.organization_id = :org', { id: orderId, org }).getOne();
      if (!x) throw new NotFoundException('التعميد غير موجود');
      if (x.status !== 'partial') throw new ConflictException('يُغلق بالمستلم التعميد المستلم جزئيًا فقط؛ والتعميد الذي لم يُستلم منه شيء يُلغى');
      if (x.commitmentId) {
        await em.query(`UPDATE plan_budget_commitments SET status = 'released', updated_at = now() WHERE id = $1 AND status = 'reserved'`, [x.commitmentId]);
      }
      if (x.fundingBatchId && x.fundingReserved > 0) await this.fundraising.release(org, x.fundingBatchId, x.fundingReserved, em);
      x.fundingReserved = 0;
      x.status = 'closed';
      x.closeKind = 'short';
      x.log = [...x.log, logEntry('إغلاق التعميد بالمستلم وفك حجز الباقي', a.fullName, reason)];
      await em.save(x);
      await this.closeRequestIfDone(em, x, a.fullName);
      return x;
    });
    await this.sc.notifySuppliers(org, [o.supplierId], {
      kind: 'supplier-order', title: `إغلاق التعميد ${orderCode(o.orderNo)}`, dedupe: `po-short:${o.id}`, path: `/orders/${o.id}`,
      paragraphs: ['أُغلق التعميد بالكميات المستلمة، فنأمل عدم توريد الكميات المتبقية.'], facts: [{ label: 'السبب', value: reason }],
    });
    return o;
  }
}
