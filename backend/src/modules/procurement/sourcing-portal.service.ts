import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { DataSource, In, IsNull, Not } from 'typeorm';
import { FileStore } from '../../core/files/file-store.service';
import { ItemFile } from './entities/procurement.entity';
import { ORDER_KINDS, ORDER_STATUS, PrOrder, PrQuote, PrRfq, PrRfqQuestion, PURCHASE_METHODS, QUOTE_STATUS, RFQ_STATUS } from './entities/sourcing.entity';
import { ProcurementCore } from './procurement-core.service';
import { OrdersService } from './orders.service';
import { cleanQuoteLines, deadlinePassed, quoteTotals } from './rfqs.service';
import { orderCode, rfqCode, sourcingSettings } from './sourcing-core.service';
import { QuestionDto, QuoteDto, RespondDto } from './sourcing.dto';
import { SupplierPortalUser } from './supplier-portal.guard';

const MAX_QUOTE_FILES = 10;
/** أدوار البوابة التي تقدم العروض وترد على التعميدات */
const canQuote = (p: SupplierPortalUser) => p.role === 'owner' || p.role === 'sales';

/**
 * المنافسات والتعميدات في بوابة الموردين: يرى المورد المعتمد المنافسات المدعو لها فقط، ويستفسر ويقدم عرضه ويعدله قبل الموعد،
 * ويرى نتيجتها بعد الترسية وفق سياسة الإفصاح، ويستقبل تعميداته ويؤكد استلامها أو يقبلها أو يطلب توضيحًا أو يعتذر.
 */
@Injectable()
export class SourcingPortalService {
  constructor(private readonly db: DataSource, private readonly core: ProcurementCore, private readonly orders: OrdersService, private readonly files: FileStore) {}

  private approved(p: SupplierPortalUser) {
    if (p.supplierStatus !== 'approved') throw new ForbiddenException('تظهر المنافسات والتعميدات بعد اعتماد حسابكم مورّدًا');
  }

  private async rfq(p: SupplierPortalUser, id: string) {
    this.approved(p);
    const q = await this.db.getRepository(PrRfq).findOne({ where: { id, organizationId: p.organizationId } });
    if (!q || q.status === 'draft' || !q.invitedIds.includes(p.supplierId)) throw new NotFoundException('المنافسة غير موجودة');
    return q;
  }

  /** نتيجة المنافسة كما تظهر للمورد */
  private async result(p: SupplierPortalUser, q: PrRfq, discloseWinner: boolean) {
    if (q.status === 'cancelled') return { label: 'أُلغيت المنافسة', won: false, winner: null };
    if (q.status !== 'awarded') return null;
    const o = await this.db.getRepository(PrOrder).findOne({ where: { rfqId: q.id, issuedAt: Not(IsNull()), status: Not('cancelled') }, order: { createdAt: 'DESC' } });
    if (!o) return null;
    const won = o.supplierId === p.supplierId;
    let winner: string | null = null;
    if (discloseWinner && !won) {
      const [s] = await this.db.query('SELECT name FROM pr_suppliers WHERE id = $1', [o.supplierId]);
      winner = s?.name ?? null;
    }
    return { label: won ? 'تمت الترسية عليكم' : 'لم تتم الترسية عليكم', won, winner };
  }

  async rfqs(p: SupplierPortalUser) {
    this.approved(p);
    const s = sourcingSettings(await this.core.settings(p.organizationId));
    const rows = await this.db.getRepository(PrRfq).createQueryBuilder('q')
      .where('q.organization_id = :org AND q.status <> :draft AND q.invited_ids ? :sid', { org: p.organizationId, draft: 'draft', sid: p.supplierId })
      .orderBy('q.rfq_no', 'DESC').getMany();
    const quotes = rows.length ? await this.db.getRepository(PrQuote).find({ where: { rfqId: In(rows.map((r) => r.id)), supplierId: p.supplierId } }) : [];
    const out = [];
    for (const q of rows) {
      const mine = quotes.find((x) => x.rfqId === q.id);
      out.push({
        id: q.id, code: rfqCode(q.rfqNo), title: q.title, methodLabel: PURCHASE_METHODS[q.method], closesAt: q.closesAt, questionsUntil: q.questionsUntil,
        open: q.status === 'published' && !deadlinePassed(q), statusLabel: q.status === 'published' && deadlinePassed(q) ? 'انتهى التقديم' : RFQ_STATUS[q.status],
        myQuote: mine ? { status: mine.status, statusLabel: QUOTE_STATUS[mine.status], total: mine.total, submittedAt: mine.submittedAt } : null,
        result: await this.result(p, q, s.discloseWinner),
      });
    }
    return out;
  }

  async rfqDetail(p: SupplierPortalUser, id: string) {
    const q = await this.rfq(p, id);
    const s = sourcingSettings(await this.core.settings(p.organizationId));
    const [quote, questions] = await Promise.all([
      this.db.getRepository(PrQuote).findOne({ where: { rfqId: id, supplierId: p.supplierId } }),
      this.db.getRepository(PrRfqQuestion).find({ where: [{ rfqId: id, published: true }, { rfqId: id, supplierId: p.supplierId }], order: { createdAt: 'ASC' } }),
    ]);
    const open = q.status === 'published' && !deadlinePassed(q);
    return {
      id: q.id, code: rfqCode(q.rfqNo), title: q.title, methodLabel: PURCHASE_METHODS[q.method], scope: q.scope, terms: q.terms, lines: q.lines,
      attachments: q.attachments.map((x) => ({ key: x.key.split('/').pop(), name: x.name, size: x.size })),
      criteria: q.criteria.map((c) => ({ name: c.name, weight: c.weight })), closesAt: q.closesAt, questionsUntil: q.questionsUntil, open,
      canAsk: open && (!q.questionsUntil || q.questionsUntil.getTime() > Date.now()), canQuote: open && canQuote(p),
      statusLabel: q.status === 'published' && deadlinePassed(q) ? 'انتهى التقديم' : RFQ_STATUS[q.status],
      questions: questions.map((x) => ({ id: x.id, question: x.question, answer: x.answer, mine: x.supplierId === p.supplierId, published: x.published, createdAt: x.createdAt })),
      quote: quote ? {
        ...quote, statusLabel: QUOTE_STATUS[quote.status], scores: undefined, revisions: quote.revisions.map((r) => ({ round: r.round, at: r.at, after: r.after })),
        attachments: quote.attachments.map((x) => ({ key: x.key.split('/').pop(), name: x.name, size: x.size })),
      } : null,
      result: await this.result(p, q, s.discloseWinner),
    };
  }

  async ask(p: SupplierPortalUser, id: string, dto: QuestionDto) {
    const q = await this.rfq(p, id);
    if (q.status !== 'published' || deadlinePassed(q) || (q.questionsUntil && q.questionsUntil.getTime() <= Date.now())) throw new ConflictException('انتهى موعد الاستفسارات');
    await this.db.getRepository(PrRfqQuestion).save(this.db.getRepository(PrRfqQuestion).create({
      organizationId: p.organizationId, rfqId: id, supplierId: p.supplierId, question: dto.question.trim(), askedByName: p.fullName,
    }));
    return this.rfqDetail(p, id);
  }

  /** حفظ العرض مسودة أو إرساله؛ يُعدل ويُعاد إرساله حتى موعد الإغلاق */
  async saveQuote(p: SupplierPortalUser, id: string, dto: QuoteDto) {
    const q = await this.rfq(p, id);
    if (!canQuote(p)) throw new ForbiddenException('تقديم العروض لمدير الحساب ومستخدم المبيعات');
    if (q.status !== 'published' || deadlinePassed(q)) throw new ConflictException('انتهى موعد تقديم العروض');
    const repo = this.db.getRepository(PrQuote);
    const row = (await repo.findOne({ where: { rfqId: id, supplierId: p.supplierId } })) ?? repo.create({ organizationId: p.organizationId, rfqId: id, supplierId: p.supplierId });
    if (row.via === 'staff' && row.status === 'submitted') throw new ConflictException('سجّلت الجمعية عرضكم الورقي؛ تواصلوا معها لتعديله');
    const lines = cleanQuoteLines(q, dto.lines, !!dto.submit);
    Object.assign(row, {
      lines, vatRate: dto.vatRate, ...quoteTotals(q, lines, dto.vatRate), deliveryDays: dto.deliveryDays ?? null, validityDays: dto.validityDays ?? null,
      technicalNote: dto.technicalNote ?? null, via: 'portal',
    });
    if (dto.submit) {
      if (!dto.validityDays) throw new BadRequestException('حدد مدة سريان العرض');
      row.status = 'submitted';
      row.submittedAt = new Date();
      row.submittedByName = p.fullName;
    } else if (row.status !== 'submitted') {
      row.status = 'draft';
    }
    await repo.save(row);
    return this.rfqDetail(p, id);
  }

  async withdraw(p: SupplierPortalUser, id: string) {
    const q = await this.rfq(p, id);
    if (!canQuote(p)) throw new ForbiddenException('سحب العروض لمدير الحساب ومستخدم المبيعات');
    if (q.status !== 'published' || deadlinePassed(q)) throw new ConflictException('لا يُسحب العرض بعد موعد الإغلاق');
    const row = await this.db.getRepository(PrQuote).findOne({ where: { rfqId: id, supplierId: p.supplierId } });
    if (!row || row.status !== 'submitted') throw new ConflictException('لا يوجد عرض مقدم');
    row.status = 'withdrawn';
    await this.db.getRepository(PrQuote).save(row);
    return this.rfqDetail(p, id);
  }

  async addQuoteFile(p: SupplierPortalUser, id: string, file: Express.Multer.File) {
    const q = await this.rfq(p, id);
    if (!canQuote(p)) throw new ForbiddenException('رفع مرفقات العروض لمدير الحساب ومستخدم المبيعات');
    if (q.status !== 'published' || deadlinePassed(q)) throw new ConflictException('انتهى موعد تقديم العروض');
    const repo = this.db.getRepository(PrQuote);
    const row = (await repo.findOne({ where: { rfqId: id, supplierId: p.supplierId } }))
      ?? await repo.save(repo.create({ organizationId: p.organizationId, rfqId: id, supplierId: p.supplierId, status: 'draft', via: 'portal' }));
    if (row.attachments.length >= MAX_QUOTE_FILES) throw new BadRequestException(`الحد الأعلى ${MAX_QUOTE_FILES} مرفقات`);
    const saved = await this.files.save(`${p.organizationId}/procurement`, file, 'المرفق');
    const att: ItemFile = { key: saved.key, name: saved.name, mime: saved.mime, size: file.size, at: new Date().toISOString(), byName: p.fullName };
    await repo.update({ id: row.id }, { attachments: [...row.attachments, att] });
    return this.rfqDetail(p, id);
  }

  async removeQuoteFile(p: SupplierPortalUser, id: string, key: string) {
    const q = await this.rfq(p, id);
    if (!canQuote(p) || q.status !== 'published' || deadlinePassed(q)) throw new ConflictException('انتهى موعد تقديم العروض');
    const row = await this.db.getRepository(PrQuote).findOne({ where: { rfqId: id, supplierId: p.supplierId } });
    const att = row?.attachments.find((x) => x.key.endsWith(`/${key}`));
    if (!row || !att) throw new NotFoundException('المرفق غير موجود');
    await this.files.remove(att.key).catch(() => undefined);
    await this.db.getRepository(PrQuote).update({ id: row.id }, { attachments: row.attachments.filter((x) => x !== att) });
    return this.rfqDetail(p, id);
  }

  async file(p: SupplierPortalUser, id: string, key: string) {
    const q = await this.rfq(p, id);
    let att = q.attachments.find((x) => x.key.endsWith(`/${key}`));
    if (!att) {
      const row = await this.db.getRepository(PrQuote).findOne({ where: { rfqId: id, supplierId: p.supplierId } });
      att = row?.attachments.find((x) => x.key.endsWith(`/${key}`));
    }
    if (!att) throw new NotFoundException('المرفق غير موجود');
    return { stream: this.files.open(att.key), mime: att.mime, name: att.name };
  }

  // ---------------- التعميدات ----------------

  async ordersList(p: SupplierPortalUser) {
    this.approved(p);
    const rows = await this.db.getRepository(PrOrder).find({
      where: { organizationId: p.organizationId, supplierId: p.supplierId, issuedAt: Not(IsNull()) }, order: { orderNo: 'DESC' },
    });
    return rows.map((o) => ({
      id: o.id, code: orderCode(o.orderNo), title: o.title, kindLabel: ORDER_KINDS[o.kind], status: o.status, statusLabel: ORDER_STATUS[o.status],
      total: o.total, deliveryDate: o.deliveryDate, issuedAt: o.issuedAt, version: o.version,
    }));
  }

  async order(p: SupplierPortalUser, id: string) {
    this.approved(p);
    const o = await this.db.getRepository(PrOrder).findOne({ where: { id, organizationId: p.organizationId, supplierId: p.supplierId, issuedAt: Not(IsNull()) } });
    if (!o) throw new NotFoundException('التعميد غير موجود');
    const [uoms, wh, org] = await Promise.all([
      this.db.query('SELECT id, name FROM pr_uoms WHERE organization_id = $1', [p.organizationId]) as Promise<{ id: string; name: string }[]>,
      o.warehouseId ? this.db.query('SELECT name, city, address FROM pr_warehouses WHERE id = $1', [o.warehouseId]) : Promise.resolve([]),
      this.db.query('SELECT name FROM organizations WHERE id = $1', [p.organizationId]),
    ]);
    const uomName = new Map(uoms.map((u) => [u.id, u.name]));
    const can = canQuote(p);
    // نتائج الاستلام والفحص والمرتجعات (بلا قيم محاسبية داخلية)
    const receipts: { id: string; receipt_no: number; date: string; delivery_ref: string | null; inspection: { result: string; note: string | null } | null; lines: { orderLineId: string | null; qty: number; acceptedQty: number; rejectedQty: number; rejectReason: string | null; description: string }[] }[] =
      await this.db.query(`SELECT id, receipt_no, to_char(date, 'YYYY-MM-DD') AS date, delivery_ref, inspection, lines FROM pr_receipts WHERE order_id = $1 AND status = 'posted' ORDER BY receipt_no`, [o.id]);
    const returns: { doc_no: number; date: string; notes: string | null; lines: { qty: number; refLineId: string | null }[] }[] = await this.db.query(
      `SELECT d.doc_no, to_char(d.date, 'YYYY-MM-DD') AS date, d.notes, d.lines FROM pr_stock_docs d JOIN pr_receipts r ON r.id = d.ref_id
        WHERE r.order_id = $1 AND d.kind = 'return_supplier' AND d.status = 'posted' ORDER BY d.doc_no`, [o.id]);
    const recLine = new Map(receipts.flatMap((r) => r.lines.map((l) => [(l as unknown as { id: string }).id, l.description] as const)));
    const inspectionAr: Record<string, string> = { accepted: 'مطابق', partial: 'مطابق جزئيًا', rejected: 'غير مطابق' };
    return {
      receipts: receipts.map((r) => ({
        code: `GRN-${String(r.receipt_no).padStart(4, '0')}`, date: r.date, deliveryRef: r.delivery_ref, inspection: r.inspection ? inspectionAr[r.inspection.result] ?? null : null,
        inspectionNote: r.inspection?.note ?? null,
        lines: r.lines.map((l) => ({ description: l.description, delivered: Number(l.qty), accepted: Number(l.acceptedQty), rejected: Number(l.rejectedQty), rejectReason: l.rejectReason })),
      })),
      returns: returns.map((d) => ({
        code: `RTS-${String(d.doc_no).padStart(4, '0')}`, date: d.date, reason: d.notes, lines: d.lines.map((l) => ({ description: recLine.get(l.refLineId ?? '') ?? '', qty: Number(l.qty) })),
      })),
      id: o.id, code: orderCode(o.orderNo), title: o.title, kind: o.kind, kindLabel: ORDER_KINDS[o.kind], status: o.status, statusLabel: ORDER_STATUS[o.status],
      version: o.version, organizationName: org[0]?.name ?? '',
      lines: o.lines.map((l) => ({ description: l.description, qty: l.qty, uomName: l.uomId ? uomName.get(l.uomId) ?? null : null, unitPrice: l.unitPrice, total: l.total })),
      vatRate: o.vatRate, subtotal: o.subtotal, vat: o.vat, total: o.total, deliveryDate: o.deliveryDate, deliveryPlace: o.deliveryPlace, warehouse: wh[0] ?? null,
      // أقل قدر من بيانات المستفيد: المرجع فقط
      beneficiaryRef: o.beneficiaryRef, terms: o.terms, issuedAt: o.issuedAt, acknowledgedAt: o.acknowledgedAt, acceptedAt: o.acceptedAt, cancelReason: o.status === 'cancelled' ? o.cancelReason : null,
      responses: o.responses,
      can: {
        acknowledge: can && o.status === 'issued', accept: can && ['issued', 'acknowledged'].includes(o.status),
        clarify: can && ['issued', 'acknowledged'].includes(o.status), decline: can && ['issued', 'acknowledged', 'clarification'].includes(o.status),
      },
    };
  }

  async respond(p: SupplierPortalUser, id: string, dto: RespondDto) {
    this.approved(p);
    if (!canQuote(p)) throw new ForbiddenException('الرد على التعميدات لمدير الحساب ومستخدم المبيعات');
    await this.orders.respond(p.organizationId, id, p.supplierId, dto.action, dto.note ?? null, `${p.fullName} (المورد)`);
    return this.order(p, id);
  }

  /** ما يحتاج انتباه المورد في الصفحة الرئيسية للبوابة */
  async summary(p: SupplierPortalUser) {
    if (p.supplierStatus !== 'approved') return { openRfqs: 0, newOrders: 0 };
    const [[r], [o]] = await Promise.all([
      this.db.query(
        `SELECT COUNT(*)::int AS n FROM pr_rfqs q WHERE q.organization_id = $1 AND q.status = 'published' AND q.closes_at > now() AND q.invited_ids ? $2
            AND NOT EXISTS (SELECT 1 FROM pr_quotes x WHERE x.rfq_id = q.id AND x.supplier_id = $2::uuid AND x.status = 'submitted')`, [p.organizationId, p.supplierId]),
      this.db.query(`SELECT COUNT(*) FILTER (WHERE status = 'issued')::int AS n FROM pr_orders WHERE organization_id = $1 AND supplier_id = $2`, [p.organizationId, p.supplierId]),
    ]);
    return { openRfqs: r.n, newOrders: o.n };
  }
}

