import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { OrgUser } from '../../core/auth/decorators';
import { PrSupplier } from './entities/procurement.entity';
import {
  LIVE_ORDER, ORDER_KINDS, ORDER_STATUS, OrderKind, OrderLine, PrOrder, PrQuote, PrRequest, PrRfq, PURCHASE_METHODS, RequestKind, SupplierResponse,
} from './entities/sourcing.entity';
import { PROCUREMENT_PERMISSIONS as P } from './procurement.manifest';
import { addDays, logEntry, ProcurementCore, prToday, supplierCode } from './procurement-core.service';
import { can, RequestsService } from './requests.service';
import { levelsFor, orderCode, r2, requestCode, rfqCode, SourcingCore, sourcingSettings } from './sourcing-core.service';
import { AmendDto, OrderDto } from './sourcing.dto';

export const orderKindFor = (k: RequestKind): OrderKind => (k === 'beneficiary' ? 'beneficiary' : k === 'services' ? 'services' : 'goods');
const totals = (lines: OrderLine[], vatRate: number) => {
  const subtotal = r2(lines.reduce((s, l) => s + l.total, 0));
  const vat = r2(subtotal * vatRate / 100);
  return { subtotal, vat, total: r2(subtotal + vat) };
};

/**
 * التعميدات وأوامر الشراء: تُنشأ من توصية الترسية أو مباشرة من طلب معتمد (شراء مباشر أو طارئ)،
 * وتُعتمد بمستويات حسب القيمة (كل مستوى بمعتمد مختلف عن المُعد ومن سبقه)، وعند الاعتماد الأخير
 * يُفحص مصدر التمويل أولًا ثم بند الموازنة، ويُحجز المبلغ، ويصدر التعميد للمورد في البوابة.
 */
@Injectable()
export class OrdersService {
  constructor(
    private readonly db: DataSource, private readonly core: ProcurementCore, private readonly sc: SourcingCore, private readonly requests: RequestsService,
  ) {}

  async find(org: string, id: string) {
    const o = await this.db.getRepository(PrOrder).findOne({ where: { id, organizationId: org } });
    if (!o) throw new NotFoundException('التعميد غير موجود');
    return o;
  }

  async approvedSupplier(org: string, id: string) {
    const s = await this.db.getRepository(PrSupplier).findOne({ where: { id, organizationId: org } });
    if (!s) throw new NotFoundException('المورد غير موجود');
    if (s.status !== 'approved') throw new ConflictException(`المورد «${s.name}» غير معتمد، فلا يصدر له تعميد`);
    return s;
  }

  /** يبني بنود التعميد من بنود الطلب، ويمنع تجاوز الكمية المطلوبة (منع التعميد المكرر) */
  private async buildLines(r: PrRequest, input: { lineId?: string | null; qty: number; unitPrice: number }[], exceptOrderId: string | null, maxPrice?: Map<string, number>) {
    const ordered = await this.requests.orderedQty(r.id, exceptOrderId);
    const seen = new Set<string>();
    return input.map((x) => {
      const rl = r.lines.find((l) => l.id === x.lineId);
      if (!rl) throw new BadRequestException('أحد البنود ليس من بنود طلب الشراء');
      if (seen.has(rl.id)) throw new BadRequestException(`البند «${rl.description}» مكرر`);
      seen.add(rl.id);
      const left = r2(rl.qty - (ordered.get(rl.id) ?? 0));
      if (x.qty > left + 0.0005) throw new ConflictException(`كمية «${rl.description}» تتجاوز المتبقي من الطلب (${left})، وصدر بالباقي تعميد سابق`);
      const cap = maxPrice?.get(rl.id);
      if (cap !== undefined && x.unitPrice > cap + 0.005) throw new BadRequestException(`سعر «${rl.description}» أعلى من سعر العرض المرسى (${cap})`);
      return { lineId: rl.id, itemId: rl.itemId, description: rl.description, qty: Number(x.qty), uomId: rl.uomId, unitPrice: r2(x.unitPrice), total: r2(x.qty * x.unitPrice) } satisfies OrderLine;
    });
  }

  /** تعميد مباشر من طلب معتمد (شراء مباشر أو طارئ، أو استكمال كمية) */
  async createDirect(a: OrgUser, dto: OrderDto) {
    const org = a.organizationId;
    if (!dto.requestId || !dto.supplierId) throw new BadRequestException('حدد طلب الشراء والمورد');
    const r = await this.requests.find(a, dto.requestId);
    if (!['approved', 'ordered'].includes(r.status)) throw new ConflictException('يصدر التعميد من طلب شراء معتمد');
    if (!['direct', 'emergency'].includes(r.method ?? '')) {
      throw new ConflictException(`أسلوب الشراء في الطلب «${PURCHASE_METHODS[r.method ?? 'quotes']}»؛ اطرح منافسة واستقبل العروض، ثم أوصِ بالترسية`);
    }
    const sup = await this.approvedSupplier(org, dto.supplierId);
    const lines = await this.buildLines(r, dto.lines, null);
    const s = await this.core.settings(org);
    const o = await this.db.transaction(async (em) => {
      const no = await this.sc.nextNo(em, 'pr_orders', 'order_no', org);
      return em.save(em.create(PrOrder, {
        organizationId: org, orderNo: no, kind: orderKindFor(r.kind), requestId: r.id, supplierId: sup.id, title: dto.title?.trim() || r.title, lines, vatRate: dto.vatRate,
        ...totals(lines, dto.vatRate), unitId: r.unitId, projectId: r.projectId, beneficiaryRef: r.beneficiaryRef, budgetLineId: r.budgetLineId, fundingBatchId: r.fundingBatchId,
        warehouseId: dto.warehouseId ?? null, deliveryDate: dto.deliveryDate ?? r.neededBy, deliveryPlace: dto.deliveryPlace ?? null,
        terms: dto.terms ?? sourcingSettings(s).orderTerms, status: 'draft', createdById: a.id, createdByName: a.fullName,
        log: [logEntry('إعداد التعميد', a.fullName, `${PURCHASE_METHODS[r.method!]} من ${requestCode(r.requestNo)}`)],
      }));
    });
    return this.get(a, o.id);
  }

  /** تعميد من العرض الموصى بترسيته: يدخل مباشرة في مسار الاعتماد */
  async createFromQuote(em: EntityManager, a: OrgUser, rfq: PrRfq, quote: PrQuote, r: PrRequest) {
    const org = a.organizationId;
    const s = await this.core.settings(org);
    const price = new Map(quote.lines.map((l) => [l.lineId, l.unitPrice]));
    const ordered = await this.requests.orderedQty(r.id);
    const lines: OrderLine[] = r.lines.filter((l) => (price.get(l.id) ?? 0) > 0).map((l) => {
      const qty = r2(l.qty - (ordered.get(l.id) ?? 0));
      return { lineId: l.id, itemId: l.itemId, description: l.description, qty, uomId: l.uomId, unitPrice: price.get(l.id)!, total: r2(qty * price.get(l.id)!) };
    }).filter((l) => l.qty > 0);
    if (!lines.length) throw new ConflictException('لا توجد كميات متبقية في الطلب');
    const t = totals(lines, quote.vatRate);
    const no = await this.sc.nextNo(em, 'pr_orders', 'order_no', org);
    return em.save(em.create(PrOrder, {
      organizationId: org, orderNo: no, kind: orderKindFor(r.kind), requestId: r.id, rfqId: rfq.id, quoteId: quote.id, supplierId: quote.supplierId, title: rfq.title, lines,
      vatRate: quote.vatRate, ...t, unitId: r.unitId, projectId: r.projectId, beneficiaryRef: r.beneficiaryRef, budgetLineId: r.budgetLineId, fundingBatchId: r.fundingBatchId,
      deliveryDate: quote.deliveryDays ? addDays(prToday(), quote.deliveryDays) : r.neededBy, terms: [rfq.terms, sourcingSettings(s).orderTerms].filter(Boolean).join('\n\n'),
      status: 'pending', requiredLevels: levelsFor(t.total, s), createdById: a.id, createdByName: a.fullName,
      log: [logEntry('إعداد التعميد من توصية الترسية', a.fullName, rfqCode(rfq.rfqNo)), logEntry('إرسال للاعتماد', a.fullName)],
    }));
  }

  async update(a: OrgUser, id: string, dto: OrderDto) {
    const o = await this.find(a.organizationId, id);
    if (!['draft', 'returned'].includes(o.status)) throw new ConflictException('لا يُعدل التعميد بعد إرساله للاعتماد إلا إذا أعيد');
    const r = await this.requests.find(a, o.requestId);
    // التعميد المبني على عرض: لا يُغير المورد ولا يُرفع السعر عن العرض
    let maxPrice: Map<string, number> | undefined;
    if (o.quoteId) {
      const q = await this.db.getRepository(PrQuote).findOneOrFail({ where: { id: o.quoteId } });
      maxPrice = new Map(q.lines.map((l) => [l.lineId, l.unitPrice]));
    } else if (dto.supplierId && dto.supplierId !== o.supplierId) {
      o.supplierId = (await this.approvedSupplier(a.organizationId, dto.supplierId)).id;
    }
    o.lines = await this.buildLines(r, dto.lines, o.id, maxPrice);
    o.vatRate = o.quoteId ? o.vatRate : dto.vatRate;
    Object.assign(o, totals(o.lines, o.vatRate), {
      title: dto.title?.trim() || o.title, warehouseId: dto.warehouseId ?? null, deliveryDate: dto.deliveryDate ?? null, deliveryPlace: dto.deliveryPlace ?? null, terms: dto.terms ?? null,
    });
    o.log = [...o.log, logEntry('تعديل التعميد', a.fullName)];
    await this.db.getRepository(PrOrder).save(o);
    return this.get(a, id);
  }

  async submit(a: OrgUser, id: string) {
    const o = await this.find(a.organizationId, id);
    if (!['draft', 'returned'].includes(o.status)) throw new ConflictException('التعميد أُرسل للاعتماد من قبل');
    if (!o.deliveryDate) throw new BadRequestException('حدد تاريخ التسليم أو التنفيذ');
    const c = await this.sc.check(a.organizationId, { amount: o.total, budgetLineId: o.budgetLineId, fundingBatchId: o.fundingBatchId, projectId: o.projectId, kind: o.kind });
    o.budgetCheck = this.sc.snapshot(c);
    if (!c.allowed) throw new ConflictException(c.message);
    o.requiredLevels = levelsFor(o.total, await this.core.settings(a.organizationId));
    o.approvals = [];
    o.status = 'pending';
    o.log = [...o.log, logEntry('إرسال للاعتماد', a.fullName)];
    await this.db.getRepository(PrOrder).save(o);
    return this.get(a, id);
  }

  /** المستوى التالي المطلوب ومن يحق له اعتماده */
  private nextLevel(o: PrOrder) {
    return o.requiredLevels[o.approvals.length] ?? null;
  }
  private canApprove(a: OrgUser, o: PrOrder) {
    const lvl = this.nextLevel(o);
    if (o.status !== 'pending' || !lvl) return { ok: false, why: 'التعميد ليس بانتظار الاعتماد' };
    if (!can(a, lvl.permission)) return { ok: false, why: `هذا المستوى (${lvl.name}) يعتمده من لديه صلاحيته` };
    if (!a.isSuperadmin && o.createdById === a.id) return { ok: false, why: 'لا يعتمد الموظف تعميدًا أعده بنفسه' };
    if (!a.isSuperadmin && o.approvals.some((x) => x.byId === a.id)) return { ok: false, why: 'اعتمدت مستوى سابقًا؛ المستوى التالي لمعتمد آخر' };
    return { ok: true, why: null };
  }

  async approve(a: OrgUser, id: string, note: string | null) {
    const org = a.organizationId;
    const o = await this.find(org, id);
    const chk = this.canApprove(a, o);
    if (!chk.ok) throw new ForbiddenException(chk.why);
    const lvl = this.nextLevel(o)!;
    const approval = { level: o.approvals.length + 1, name: lvl.name, byId: a.id, byName: a.fullName, at: new Date().toISOString(), note };
    if (o.approvals.length + 1 < o.requiredLevels.length) {
      o.approvals = [...o.approvals, approval];
      o.log = [...o.log, logEntry(`اعتماد: ${lvl.name}`, a.fullName, note)];
      await this.db.getRepository(PrOrder).save(o);
      return this.get(a, id);
    }
    // الاعتماد الأخير = التعميد: فحص التمويل والموازنة وحجز المبلغ، ثم الإصدار للمورد
    await this.approvedSupplier(org, o.supplierId);
    const res = await this.sc.reserve(org, {
      amount: o.total, budgetLineId: o.budgetLineId, fundingBatchId: o.fundingBatchId, projectId: o.projectId, kind: o.kind,
      sourceRef: `تعميد ${orderCode(o.orderNo)} · ${o.title}`.slice(0, 120), sourceId: o.id, byName: a.fullName, note: 'حجز آلي عند اعتماد التعميد',
    });
    try {
      await this.db.transaction(async (em) => {
        o.approvals = [...o.approvals, approval];
        o.commitmentId = res.commitmentId;
        o.fundingReserved = res.fundingReserved;
        o.budgetCheck = res.snapshot;
        o.status = 'issued';
        o.issuedAt = new Date();
        o.log = [...o.log, logEntry(`اعتماد: ${lvl.name}`, a.fullName, note), logEntry('إصدار التعميد للمورد وحجز المبلغ', a.fullName, res.snapshot.message)];
        await em.save(o);
        await em.query(`UPDATE pr_requests SET status = 'ordered', log = log || $2::jsonb, updated_at = now() WHERE id = $1 AND status IN ('approved', 'sourcing')`,
          [o.requestId, JSON.stringify([logEntry('صدور التعميد', a.fullName, orderCode(o.orderNo))])]);
        if (o.rfqId) {
          await em.query(`UPDATE pr_rfqs SET status = 'awarded', log = log || $2::jsonb, updated_at = now() WHERE id = $1`,
            [o.rfqId, JSON.stringify([logEntry('اعتماد الترسية بصدور التعميد', a.fullName, orderCode(o.orderNo))])]);
        }
      });
    } catch (e) {
      await this.sc.release(org, { commitmentId: res.commitmentId, fundingBatchId: o.fundingBatchId, fundingReserved: res.fundingReserved }).catch(() => undefined);
      throw e;
    }
    await this.sc.notifySuppliers(org, [o.supplierId], {
      kind: 'supplier-order', title: `تعميد جديد ${orderCode(o.orderNo)}`, dedupe: `po-issued:${o.id}:${o.version}`, path: `/orders/${o.id}`,
      paragraphs: ['صدر لكم تعميد معتمد. نأمل الاطلاع عليه في بوابة الموردين، وتأكيد استلامه وقبوله.'],
      facts: [{ label: 'التعميد', value: o.title }, { label: 'القيمة شاملة الضريبة', value: `${o.total.toLocaleString('en-US')} ريال` }, { label: 'تاريخ التسليم', value: o.deliveryDate ?? '—' }],
    });
    return this.get(a, id);
  }

  async returnOrder(a: OrgUser, id: string, note: string) {
    const o = await this.find(a.organizationId, id);
    const chk = this.canApprove(a, o);
    if (!chk.ok) throw new ForbiddenException(chk.why);
    o.status = 'returned';
    o.approvals = [];
    o.log = [...o.log, logEntry('إعادة للتعديل', a.fullName, note)];
    await this.db.getRepository(PrOrder).save(o);
    return this.get(a, id);
  }

  async cancel(a: OrgUser, id: string, reason: string) {
    const org = a.organizationId;
    const o = await this.find(org, id);
    if (['cancelled', 'closed'].includes(o.status)) throw new ConflictException('التعميد منتهٍ');
    if (o.status === 'partial') throw new ConflictException('استُلم جزء من التعميد، فلا يُلغى. أغلقه بالمستلم لفك حجز الباقي');
    if (!can(a, P.sourcing) && !can(a, P.approveOrders) && !can(a, P.approveOrdersHigh)) throw new ForbiddenException('لا تملك صلاحية إلغاء التعميد');
    const wasLive = LIVE_ORDER.includes(o.status);
    if (wasLive) await this.sc.release(org, o);
    await this.db.transaction(async (em) => {
      o.status = 'cancelled';
      o.cancelReason = reason;
      o.log = [...o.log, logEntry('إلغاء التعميد', a.fullName, wasLive ? `${reason} (فُك حجز المبلغ)` : reason)];
      await em.save(o);
      // تعود المنافسة لمرحلة التقييم لتُختار توصية أخرى
      if (o.rfqId) {
        await em.query(`UPDATE pr_rfqs SET status = 'opened', recommended_quote_id = NULL, log = log || $2::jsonb, updated_at = now() WHERE id = $1 AND status IN ('recommended', 'awarded')`,
          [o.rfqId, JSON.stringify([logEntry('إلغاء التعميد وإعادة المنافسة للتقييم', a.fullName, reason)])]);
      }
      const [{ n }] = await em.query(`SELECT COUNT(*)::int AS n FROM pr_orders WHERE request_id = $1 AND status <> 'cancelled'`, [o.requestId]);
      if (!n) {
        const [{ rfq }] = await em.query(`SELECT COUNT(*)::int AS rfq FROM pr_rfqs WHERE request_id = $1 AND status NOT IN ('cancelled', 'draft')`, [o.requestId]);
        await em.query(`UPDATE pr_requests SET status = $2, updated_at = now() WHERE id = $1 AND status = 'ordered'`, [o.requestId, rfq ? 'sourcing' : 'approved']);
      }
    });
    if (wasLive) {
      await this.sc.notifySuppliers(org, [o.supplierId], {
        kind: 'supplier-order', title: `إلغاء التعميد ${orderCode(o.orderNo)}`, dedupe: `po-cancel:${o.id}`, path: `/orders/${o.id}`,
        paragraphs: ['نحيطكم علمًا بإلغاء التعميد التالي، فنأمل عدم التوريد أو التنفيذ بموجبه.'], facts: [{ label: 'التعميد', value: o.title }, { label: 'السبب', value: reason }],
      });
    }
    return this.get(a, id);
  }

  /** تعديل تعميد صادر: تخفيض الكميات أو الأسعار أو تغيير الموعد والشروط، ويعيد المورد تأكيده */
  async amend(a: OrgUser, id: string, dto: AmendDto) {
    const org = a.organizationId;
    const o = await this.find(org, id);
    if (o.status === 'partial') throw new ConflictException('استُلم جزء من التعميد، فلا يُعدل. أغلقه بالمستلم وأصدر تعميدًا جديدًا للباقي إن لزم');
    if (!LIVE_ORDER.includes(o.status) || o.status === 'declined') throw new ConflictException('يُعدل التعميد الصادر فقط');
    let lines = o.lines;
    if (dto.lines) {
      const old = new Map(o.lines.map((l) => [l.lineId, l]));
      lines = dto.lines.map((x) => {
        const l = old.get(x.lineId ?? null);
        if (!l) throw new BadRequestException('لا تُضاف بنود جديدة بالتعديل؛ أصدر تعميدًا آخر');
        if (x.qty > l.qty + 0.0005 || x.unitPrice > l.unitPrice + 0.005) throw new BadRequestException('التعديل يخفض الكميات أو الأسعار فقط؛ الزيادة بتعميد جديد معتمد');
        return { ...l, qty: Number(x.qty), unitPrice: r2(x.unitPrice), total: r2(x.qty * x.unitPrice) };
      });
    }
    const t = totals(lines, o.vatRate);
    if (t.total !== o.total) {
      // فك الحجز القديم وحجز القيمة الجديدة (أقل من السابقة فيُسمح دائمًا)
      await this.sc.release(org, o);
      const res = await this.sc.reserve(org, {
        amount: t.total, budgetLineId: o.budgetLineId, fundingBatchId: o.fundingBatchId, projectId: o.projectId, kind: o.kind,
        sourceRef: `تعميد ${orderCode(o.orderNo)} (تعديل ${o.version + 1})`.slice(0, 120), sourceId: o.id, byName: a.fullName, note: dto.reason,
      });
      o.commitmentId = res.commitmentId;
      o.fundingReserved = res.fundingReserved;
      o.budgetCheck = res.snapshot;
    }
    Object.assign(o, t, { lines, deliveryDate: dto.deliveryDate ?? o.deliveryDate, terms: dto.terms ?? o.terms });
    o.version += 1;
    o.status = 'issued';
    o.acknowledgedAt = null;
    o.acceptedAt = null;
    o.log = [...o.log, logEntry(`تعديل التعميد (الإصدار ${o.version})`, a.fullName, dto.reason)];
    await this.db.getRepository(PrOrder).save(o);
    await this.sc.notifySuppliers(org, [o.supplierId], {
      kind: 'supplier-order', title: `تعديل التعميد ${orderCode(o.orderNo)}`, dedupe: `po-amend:${o.id}:${o.version}`, path: `/orders/${o.id}`,
      paragraphs: ['عُدّل التعميد التالي. نأمل الاطلاع على التعديل وتأكيد قبوله.'], facts: [{ label: 'سبب التعديل', value: dto.reason }],
    });
    return this.get(a, id);
  }

  /** رد الجمعية على طلب توضيح من المورد */
  async reply(a: OrgUser, id: string, note: string) {
    const o = await this.find(a.organizationId, id);
    if (o.status !== 'clarification') throw new ConflictException('لا يوجد طلب توضيح قائم');
    o.responses = [...o.responses, { action: 'reply', note, byName: a.fullName, at: new Date().toISOString(), via: 'staff' }];
    o.status = o.acknowledgedAt ? 'acknowledged' : 'issued';
    o.log = [...o.log, logEntry('الرد على استفسار المورد', a.fullName, note)];
    await this.db.getRepository(PrOrder).save(o);
    await this.sc.notifySuppliers(a.organizationId, [o.supplierId], {
      kind: 'supplier-order', title: `رد على استفساركم في التعميد ${orderCode(o.orderNo)}`, dedupe: `po-reply:${o.id}:${o.responses.length}`, path: `/orders/${o.id}`,
      paragraphs: [note],
    });
    return this.get(a, id);
  }

  /** رد المورد (من البوابة): استلام، قبول، طلب توضيح، اعتذار */
  async respond(org: string, id: string, supplierId: string, action: SupplierResponse['action'], note: string | null, byName: string) {
    const o = await this.find(org, id);
    if (o.supplierId !== supplierId || !o.issuedAt) throw new NotFoundException('التعميد غير موجود');
    const allowed: Record<string, string[]> = {
      acknowledge: ['issued'], accept: ['issued', 'acknowledged'], clarify: ['issued', 'acknowledged'], decline: ['issued', 'acknowledged', 'clarification'],
    };
    if (!allowed[action]?.includes(o.status)) throw new ConflictException(`لا يمكن هذا الإجراء والتعميد «${ORDER_STATUS[o.status]}»`);
    if ((action === 'clarify' || action === 'decline') && !(note && note.length >= 3)) throw new BadRequestException(action === 'clarify' ? 'اكتب ما تحتاج توضيحه' : 'اكتب سبب الاعتذار');
    const now = new Date();
    if (action === 'acknowledge') { o.status = 'acknowledged'; o.acknowledgedAt = now; }
    if (action === 'accept') { o.status = 'accepted'; o.acceptedAt = now; o.acknowledgedAt = o.acknowledgedAt ?? now; }
    if (action === 'clarify') o.status = 'clarification';
    if (action === 'decline') o.status = 'declined';
    const label = { acknowledge: 'تأكيد المورد استلام التعميد', accept: 'قبول المورد للتعميد', clarify: 'طلب المورد توضيحًا', decline: 'اعتذار المورد عن التعميد', reply: '' }[action];
    o.responses = [...o.responses, { action, note, byName, at: now.toISOString(), via: 'portal' }];
    o.log = [...o.log, logEntry(label, byName, note)];
    await this.db.getRepository(PrOrder).save(o);
    return o;
  }

  async list(a: OrgUser, q: { status?: string; supplier?: string; q?: string; mine?: string }) {
    const org = a.organizationId;
    const rows: Record<string, unknown>[] = await this.db.query(
      `SELECT o.id, o.order_no AS "orderNo", o.kind, o.title, o.status, o.total::float AS total, o.delivery_date AS "deliveryDate", o.issued_at AS "issuedAt",
              o.created_at AS "createdAt", o.required_levels AS "requiredLevels", jsonb_array_length(o.approvals)::int AS approved, o.created_by_id AS "createdById",
              o.approvals, s.id AS "supplierId", s.name AS "supplierName", s.supplier_no AS "supplierNo", r.request_no AS "requestNo", o.project_id AS "projectId"
         FROM pr_orders o JOIN pr_suppliers s ON s.id = o.supplier_id JOIN pr_requests r ON r.id = o.request_id
        WHERE o.organization_id = $1 AND ($2::text IS NULL OR o.status = $2) AND ($3::uuid IS NULL OR o.supplier_id = $3::uuid)
          AND ($4::text IS NULL OR o.title ILIKE '%' || $4 || '%' OR s.name ILIKE '%' || $4 || '%' OR ('PO-' || LPAD(o.order_no::text, 4, '0')) ILIKE '%' || $4 || '%')
        ORDER BY o.order_no DESC LIMIT 500`, [org, q.status || null, q.supplier || null, q.q?.trim() || null]);
    const today = prToday();
    const out = rows.map((r) => {
      const o = r as unknown as PrOrder & { approved: number };
      const lvl = o.status === 'pending' ? o.requiredLevels[o.approved] ?? null : null;
      return {
        ...r, code: orderCode(o.orderNo), statusLabel: ORDER_STATUS[o.status], kindLabel: ORDER_KINDS[o.kind], supplierCode: supplierCode(r.supplierNo as number),
        requestCode: requestCode(r.requestNo as number), nextLevel: lvl?.name ?? null,
        myTurn: !!lvl && this.canApprove(a, { ...o, approvals: (r.approvals as PrOrder['approvals']) } as PrOrder).ok,
        late: ['issued', 'acknowledged', 'accepted'].includes(o.status) && !!o.deliveryDate && String(o.deliveryDate) < today,
        approvals: undefined, requiredLevels: undefined,
      };
    });
    return q.mine === '1' ? out.filter((x) => x.myTurn) : out;
  }

  async get(a: OrgUser, id: string) {
    const org = a.organizationId;
    const o = await this.find(org, id);
    const [r, sup, labels, fin, uoms, wh] = await Promise.all([
      this.db.getRepository(PrRequest).findOneOrFail({ where: { id: o.requestId } }),
      this.db.getRepository(PrSupplier).findOneOrFail({ where: { id: o.supplierId } }),
      this.sc.orgLabels(org, [o.unitId], [o.projectId]),
      this.sc.financeLabels(org, [o.budgetLineId], [o.fundingBatchId]),
      this.db.query('SELECT id, name FROM pr_uoms WHERE organization_id = $1', [org]) as Promise<{ id: string; name: string }[]>,
      o.warehouseId ? this.db.query('SELECT id, code, name FROM pr_warehouses WHERE id = $1', [o.warehouseId]) : Promise.resolve([]),
    ]);
    const rfq = o.rfqId ? await this.db.getRepository(PrRfq).findOne({ where: { id: o.rfqId } }) : null;
    const receipts: { id: string; receipt_no: number; date: string; status: string; total: number; inspection: string | null; lines: { orderLineId: string | null; acceptedQty: number; rejectedQty: number }[] }[] =
      await this.db.query(`SELECT id, receipt_no, to_char(date, 'YYYY-MM-DD') AS date, status, total::float AS total, inspection->>'result' AS inspection, lines FROM pr_receipts WHERE order_id = $1 ORDER BY receipt_no`, [o.id]);
    const returnsQ: { ref: string; qty: string }[] = await this.db.query(
      `SELECT rl->>'orderLineId' AS ref, SUM((dl->>'qty')::numeric) AS qty FROM pr_stock_docs d JOIN pr_receipts r ON r.id = d.ref_id, jsonb_array_elements(d.lines) dl, jsonb_array_elements(r.lines) rl
        WHERE r.order_id = $1 AND d.kind = 'return_supplier' AND d.status = 'posted' AND rl->>'id' = dl->>'refLineId' GROUP BY 1`, [o.id]);
    const recQty = new Map<string, number>();
    for (const x of receipts.filter((x) => x.status === 'posted')) for (const l of x.lines) if (l.orderLineId) recQty.set(l.orderLineId, (recQty.get(l.orderLineId) ?? 0) + Number(l.acceptedQty));
    for (const x of returnsQ) recQty.set(x.ref, (recQty.get(x.ref) ?? 0) - Number(x.qty));
    const uomName = new Map(uoms.map((u) => [u.id, u.name]));
    const line = o.budgetLineId ? fin.lines.get(o.budgetLineId) : null;
    const batch = o.fundingBatchId ? fin.batches.get(o.fundingBatchId) : null;
    const lvl = o.status === 'pending' ? this.nextLevel(o) : null;
    const approve = this.canApprove(a, o);
    const preview = ['draft', 'returned', 'pending'].includes(o.status)
      ? await this.sc.check(org, { amount: o.total, budgetLineId: o.budgetLineId, fundingBatchId: o.fundingBatchId, projectId: o.projectId, kind: o.kind }).catch(() => null)
      : null;
    const sourcing = can(a, P.sourcing);
    return {
      ...o, code: orderCode(o.orderNo), statusLabel: ORDER_STATUS[o.status], kindLabel: ORDER_KINDS[o.kind],
      supplier: { id: sup.id, code: supplierCode(sup.supplierNo), name: sup.name, vatNumber: sup.vatNumber, crNumber: sup.crNumber, phone: sup.phone, email: sup.email, address: sup.address, city: sup.city },
      request: { id: r.id, code: requestCode(r.requestNo), title: r.title, method: r.method, methodLabel: r.method ? PURCHASE_METHODS[r.method] : null, requestedByName: r.requestedByName },
      rfq: rfq ? { id: rfq.id, code: rfqCode(rfq.rfqNo), title: rfq.title, recommendation: rfq.recommendation } : null,
      unitName: o.unitId ? labels.units.get(o.unitId) ?? null : null, projectName: o.projectId ? labels.projects.get(o.projectId) ?? null : null,
      budgetLine: line ? { id: line.id, name: line.name, budgetCode: line.budgetCode, year: line.year } : null,
      funding: batch ? { id: batch.id, label: `الدفعة ${batch.batchNo} · ${batch.targetName}` } : null,
      warehouse: wh[0] ?? null,
      lines: o.lines.map((l) => ({ ...l, uomName: l.uomId ? uomName.get(l.uomId) ?? null : null, receivedQty: Math.round((recQty.get(l.lineId ?? '') ?? 0) * 1000) / 1000 })),
      receipts: receipts.map((x) => ({
        id: x.id, code: `GRN-${String(x.receipt_no).padStart(4, '0')}`, date: x.date, status: x.status, total: x.total, inspection: x.inspection,
        rejected: x.lines.some((l) => Number(l.rejectedQty) > 0),
      })),
      nextLevel: lvl, liveCheck: preview ? this.sc.snapshot(preview) : null,
      can: {
        edit: ['draft', 'returned'].includes(o.status) && sourcing,
        submit: ['draft', 'returned'].includes(o.status) && sourcing,
        approve: approve.ok, approveWhy: o.status === 'pending' ? approve.why : null,
        cancel: !['cancelled', 'closed', 'partial'].includes(o.status) && (sourcing || can(a, P.approveOrders) || can(a, P.approveOrdersHigh)),
        receive: ['issued', 'acknowledged', 'accepted', 'clarification', 'partial'].includes(o.status) && can(a, P.stockOperate) && (a.isSuperadmin || o.createdById !== a.id),
        shortClose: o.status === 'partial' && (sourcing || can(a, P.approveOrders) || can(a, P.approveOrdersHigh)),
        amend: LIVE_ORDER.includes(o.status) && o.status !== 'declined' && sourcing,
        reply: o.status === 'clarification' && sourcing,
      },
    };
  }
}

