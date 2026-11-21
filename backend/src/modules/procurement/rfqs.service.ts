import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { DataSource, In } from 'typeorm';
import { OrgUser } from '../../core/auth/decorators';
import { FileStore } from '../../core/files/file-store.service';
import { ItemFile, PrSupplier } from './entities/procurement.entity';
import {
  ORDER_STATUS, PrOrder, PrQuote, PrRequest, PrRfq, PrRfqQuestion, PURCHASE_METHODS, QUOTE_STATUS, QuoteLine, RFQ_STATUS, RfqLine,
} from './entities/sourcing.entity';
import { PROCUREMENT_PERMISSIONS as P } from './procurement.manifest';
import { logEntry, ProcurementCore, supplierCode } from './procurement-core.service';
import { OrdersService } from './orders.service';
import { can, RequestsService } from './requests.service';
import { orderCode, r2, requestCode, rfqCode, SourcingCore, sourcingSettings } from './sourcing-core.service';
import { AnswerDto, ExtendDto, NegotiateDto, QuoteDto, RecommendDto, RfqDto, ScoreDto, StaffQuoteDto } from './sourcing.dto';

const MAX_ATTACHMENTS = 15;

export interface QuoteEvaluation {
  quoteId: string;
  /** متوسط تقدير اللجنة لكل معيار فني */
  technical: Record<string, number | null>;
  technicalScore: number | null;
  financialScore: number | null;
  totalScore: number | null;
  passed: boolean;
  scoredBy: number;
  rank: number | null;
}

/** حساب التقييم: الدرجة الفنية من متوسط تقديرات اللجنة، والمالية = أقل سعر بين المؤهلين ÷ سعر العرض × 100 */
export function evaluate(rfq: PrRfq, quotes: PrQuote[]): Map<string, QuoteEvaluation> {
  const tech = rfq.criteria.filter((c) => c.kind === 'technical');
  const techW = tech.reduce((s, c) => s + c.weight, 0);
  const priceW = rfq.criteria.filter((c) => c.kind === 'price').reduce((s, c) => s + c.weight, 0);
  const out = new Map<string, QuoteEvaluation>();
  for (const q of quotes.filter((x) => x.status === 'submitted')) {
    const members = Object.values(q.scores ?? {});
    const technical: Record<string, number | null> = {};
    for (const c of tech) {
      const v = members.map((m) => m.scores[c.key]).filter((x): x is number => typeof x === 'number');
      technical[c.key] = v.length ? r2(v.reduce((s, x) => s + x, 0) / v.length) : null;
    }
    const complete = tech.every((c) => technical[c.key] !== null);
    const technicalScore = techW && complete ? r2(tech.reduce((s, c) => s + c.weight * technical[c.key]!, 0) / techW) : null;
    const passed = !techW || technicalScore === null || technicalScore >= rfq.technicalPass;
    out.set(q.id, { quoteId: q.id, technical, technicalScore, financialScore: null, totalScore: null, passed, scoredBy: members.length, rank: null });
  }
  const eligible = quotes.filter((q) => out.get(q.id)?.passed && q.total > 0);
  const min = eligible.length ? Math.min(...eligible.map((q) => q.total)) : 0;
  for (const q of eligible) {
    const e = out.get(q.id)!;
    e.financialScore = r2(min / q.total * 100);
    const techPart = techW ? (e.technicalScore === null ? null : tech.reduce((s, c) => s + c.weight * (e.technical[c.key] ?? 0), 0) / 100) : 0;
    e.totalScore = techPart === null ? null : r2(techPart + priceW * e.financialScore / 100);
  }
  const ranked = [...out.values()].filter((e) => e.totalScore !== null).sort((x, y) => y.totalScore! - x.totalScore!);
  ranked.forEach((e, i) => (e.rank = i + 1));
  return out;
}

export const quoteTotals = (rfq: PrRfq, lines: QuoteLine[], vatRate: number) => {
  const price = new Map(lines.map((l) => [l.lineId, l.unitPrice]));
  const subtotal = r2(rfq.lines.reduce((s, l) => s + l.qty * (price.get(l.id) ?? 0), 0));
  const vat = r2(subtotal * vatRate / 100);
  return { subtotal, vat, total: r2(subtotal + vat) };
};

/** يتحقق من بنود العرض: كل بند من الكراسة مرة واحدة، والسعر أكبر من صفر عند الإرسال */
export function cleanQuoteLines(rfq: PrRfq, lines: QuoteDto['lines'], submitting: boolean): QuoteLine[] {
  const ids = new Set(rfq.lines.map((l) => l.id));
  const seen = new Set<string>();
  const out: QuoteLine[] = [];
  for (const l of lines) {
    if (!ids.has(l.lineId)) throw new BadRequestException('أحد البنود ليس من بنود المنافسة');
    if (seen.has(l.lineId)) throw new BadRequestException('بند مكرر في العرض');
    seen.add(l.lineId);
    out.push({ lineId: l.lineId, unitPrice: r2(Number(l.unitPrice)), note: l.note ?? null });
  }
  if (submitting) {
    const missing = rfq.lines.filter((l) => !(out.find((x) => x.lineId === l.id)?.unitPrice ?? 0));
    if (missing.length) throw new BadRequestException(`أدخل سعر البند «${missing[0].description}»`);
  }
  return out;
}

/** هل انتهى موعد التقديم */
export const deadlinePassed = (rfq: PrRfq) => !!rfq.closesAt && rfq.closesAt.getTime() <= Date.now();

/**
 * المنافسات وطلبات عروض الأسعار: الطرح للموردين المؤهلين عبر البوابة، والاستفسارات، والعروض المختومة حتى موعد الفتح،
 * وتقييم لجنة التقييم بمعايير وأوزان، والتفاوض، والتوصية بالترسية التي تُنشئ التعميد في مسار الاعتماد.
 */
@Injectable()
export class RfqsService {
  constructor(
    private readonly db: DataSource, private readonly core: ProcurementCore, private readonly sc: SourcingCore, private readonly requests: RequestsService,
    private readonly orders: OrdersService, private readonly files: FileStore,
  ) {}

  /** أعضاء اللجنة يرون منافساتهم فقط، وموظف المشتريات ومعتمدو التعميد يرون الكل */
  private seesAll(a: OrgUser) {
    return [P.sourcing, P.approveOrders, P.approveOrdersHigh, P.reports].some((p) => can(a, p));
  }

  async find(a: OrgUser, id: string) {
    const q = await this.db.getRepository(PrRfq).findOne({ where: { id, organizationId: a.organizationId } });
    if (!q || (!this.seesAll(a) && !q.committeeIds.includes(a.id))) throw new NotFoundException('المنافسة غير موجودة');
    return q;
  }

  private parseDate(v: string | null | undefined, label: string) {
    if (!v) return null;
    const d = new Date(v);
    if (Number.isNaN(d.getTime())) throw new BadRequestException(`${label} غير صحيح`);
    return d;
  }

  private async rfqLines(org: string, r: PrRequest): Promise<RfqLine[]> {
    const uoms: { id: string; name: string }[] = await this.db.query('SELECT id, name FROM pr_uoms WHERE organization_id = $1', [org]);
    const name = new Map(uoms.map((u) => [u.id, u.name]));
    return r.lines.map((l) => ({ id: l.id, itemId: l.itemId, description: l.description, qty: l.qty, uomName: l.uomId ? name.get(l.uomId) ?? null : null, specs: l.specs }));
  }

  private async fields(a: OrgUser, dto: RfqDto) {
    const sum = dto.criteria.reduce((s, c) => s + c.weight, 0);
    if (sum !== 100) throw new BadRequestException(`مجموع أوزان معايير التقييم ${sum}، ويجب أن يكون 100`);
    if (new Set(dto.criteria.map((c) => c.key)).size !== dto.criteria.length) throw new BadRequestException('رمز معيار مكرر');
    if (dto.committeeIds.length) {
      const users: { id: string }[] = await this.db.query('SELECT id FROM users WHERE organization_id = $1 AND id = ANY($2) AND is_active', [a.organizationId, dto.committeeIds]);
      if (users.length !== new Set(dto.committeeIds).size) throw new BadRequestException('أحد أعضاء اللجنة غير موجود أو موقوف');
    }
    return {
      title: dto.title.trim(), method: dto.method, scope: dto.scope ?? null, terms: dto.terms ?? null,
      questionsUntil: this.parseDate(dto.questionsUntil, 'موعد الاستفسارات'), closesAt: this.parseDate(dto.closesAt, 'موعد إغلاق التقديم'),
      invitedIds: [...new Set(dto.invitedIds)], categoryIds: [...new Set(dto.categoryIds)], criteria: dto.criteria, technicalPass: dto.technicalPass,
      committeeIds: [...new Set(dto.committeeIds)],
    };
  }

  async create(a: OrgUser, dto: RfqDto) {
    const org = a.organizationId;
    if (!dto.requestId) throw new BadRequestException('حدد طلب الشراء');
    const r = await this.requests.find(a, dto.requestId);
    if (!['approved', 'sourcing'].includes(r.status)) throw new ConflictException('تُطرح المنافسة لطلب شراء معتمد');
    const open = await this.db.getRepository(PrRfq).count({ where: { requestId: r.id, status: In(['draft', 'published', 'opened', 'recommended']) } });
    if (open) throw new ConflictException('للطلب منافسة قائمة؛ أكملها أو ألغها أولًا');
    const f = await this.fields(a, dto);
    const lines = await this.rfqLines(org, r);
    const q = await this.db.transaction(async (em) => {
      const no = await this.sc.nextNo(em, 'pr_rfqs', 'rfq_no', org);
      const row = await em.save(em.create(PrRfq, {
        organizationId: org, rfqNo: no, requestId: r.id, ...f, lines, status: 'draft', createdByName: a.fullName,
        log: [logEntry('إنشاء المنافسة', a.fullName, `${PURCHASE_METHODS[dto.method]} لطلب ${requestCode(r.requestNo)}`)],
      }));
      await em.query(`UPDATE pr_requests SET status = 'sourcing', log = log || $2::jsonb, updated_at = now() WHERE id = $1 AND status = 'approved'`,
        [r.id, JSON.stringify([logEntry('طرح منافسة', a.fullName, rfqCode(no))])]);
      return row;
    });
    return this.get(a, q.id);
  }

  async update(a: OrgUser, id: string, dto: RfqDto) {
    const q = await this.find(a, id);
    if (q.status !== 'draft') throw new ConflictException('تُعدل المنافسة قبل نشرها فقط؛ بعد النشر يمكن تمديد الموعد');
    Object.assign(q, await this.fields(a, dto));
    q.log = [...q.log, logEntry('تعديل المنافسة', a.fullName)];
    await this.db.getRepository(PrRfq).save(q);
    return this.get(a, id);
  }

  async publish(a: OrgUser, id: string, fewerReason: string | null) {
    const org = a.organizationId;
    const q = await this.find(a, id);
    if (q.status !== 'draft') throw new ConflictException('المنافسة منشورة من قبل');
    if (!q.closesAt || q.closesAt.getTime() < Date.now() + 3600_000) throw new BadRequestException('حدد موعد إغلاق التقديم بعد ساعة على الأقل من الآن');
    if (q.questionsUntil && q.questionsUntil > q.closesAt) throw new BadRequestException('موعد الاستفسارات يكون قبل موعد إغلاق التقديم');
    if (q.criteria.some((c) => c.kind === 'technical') && !q.committeeIds.length) throw new BadRequestException('حدد أعضاء لجنة التقييم الفني');
    const settings = await this.core.settings(org);
    const s = sourcingSettings(settings);
    let invited = q.invitedIds;
    // استبعاد الموردين ضعيفي الأداء (التقدير D) إذا فعّلته الشركة في إعدادات التقييم
    const blockWeak = !!settings.blockWeak;
    if (blockWeak && invited.length) {
      const weak: { id: string }[] = await this.db.query(
        `SELECT id FROM pr_suppliers WHERE organization_id = $1 AND id = ANY($2) AND grade = 'D'`, [org, invited]);
      if (weak.length) throw new BadRequestException('أحد الموردين المدعوين تقييمه ضعيف (D)، والإعدادات تمنع دعوته');
    }
    if (q.method === 'tender') {
      // المنافسة العامة: كل الموردين المعتمدين في التصنيفات المحددة (أو كلهم)
      const rows: { id: string }[] = await this.db.query(
        `SELECT id FROM pr_suppliers WHERE organization_id = $1 AND status = 'approved' AND (cardinality($2::text[]) = 0 OR category_ids ?| $2::text[])
           AND (NOT $3::boolean OR grade IS DISTINCT FROM 'D')`, [org, q.categoryIds, blockWeak]);
      invited = [...new Set([...invited, ...rows.map((r) => r.id)])];
    }
    const ok: { id: string }[] = invited.length
      ? await this.db.query(`SELECT id FROM pr_suppliers WHERE organization_id = $1 AND id = ANY($2) AND status = 'approved'`, [org, invited]) : [];
    if (ok.length !== invited.length) throw new BadRequestException('أحد الموردين المدعوين غير معتمد');
    if (!invited.length) throw new BadRequestException('لا يوجد موردون معتمدون مدعوون');
    if (q.method === 'quotes' && invited.length < s.minQuotes && !(fewerReason && fewerReason.length >= 5)) {
      throw new BadRequestException(`الحد الأدنى للموردين المدعوين ${s.minQuotes}؛ ادعُ موردين آخرين أو اكتب مبرر العدد الأقل`);
    }
    q.invitedIds = invited;
    q.status = 'published';
    q.publishedAt = new Date();
    q.log = [...q.log, logEntry('نشر المنافسة للموردين', a.fullName, fewerReason ? `دعوة ${invited.length} موردين: ${fewerReason}` : `دعوة ${invited.length} موردين`)];
    await this.db.getRepository(PrRfq).save(q);
    await this.sc.notifySuppliers(org, invited, {
      kind: 'supplier-rfq', title: `دعوة لتقديم عرض: ${q.title}`, dedupe: `rfq-invite:${q.id}`, path: `/rfqs/${q.id}`,
      paragraphs: ['يسرنا دعوتكم لتقديم عرضكم الفني والمالي عبر بوابة الموردين قبل الموعد المحدد.'],
      facts: [{ label: 'رقم المنافسة', value: rfqCode(q.rfqNo) }, { label: 'آخر موعد للتقديم', value: q.closesAt.toISOString().slice(0, 16).replace('T', ' ') }],
    });
    return this.get(a, id);
  }

  async extend(a: OrgUser, id: string, dto: ExtendDto) {
    const q = await this.find(a, id);
    if (q.status !== 'published') throw new ConflictException('يُمدد موعد المنافسة المنشورة فقط');
    const closes = this.parseDate(dto.closesAt, 'الموعد الجديد')!;
    if (closes <= (q.closesAt ?? new Date()) || closes.getTime() < Date.now()) throw new BadRequestException('الموعد الجديد بعد الموعد الحالي');
    q.closesAt = closes;
    if (dto.questionsUntil !== undefined) q.questionsUntil = this.parseDate(dto.questionsUntil, 'موعد الاستفسارات');
    q.log = [...q.log, logEntry('تمديد موعد التقديم', a.fullName, dto.reason)];
    await this.db.getRepository(PrRfq).save(q);
    await this.sc.notifySuppliers(a.organizationId, q.invitedIds, {
      kind: 'supplier-rfq', title: `تمديد موعد التقديم: ${q.title}`, dedupe: `rfq-extend:${q.id}:${closes.getTime()}`, path: `/rfqs/${q.id}`,
      paragraphs: [`مُدد آخر موعد لتقديم العروض. ${dto.reason}`], facts: [{ label: 'الموعد الجديد', value: closes.toISOString().slice(0, 16).replace('T', ' ') }],
    });
    return this.get(a, id);
  }

  /** فتح العروض بعد انتهاء موعد التقديم (قبله تبقى مختومة) */
  async open(a: OrgUser, id: string) {
    const q = await this.find(a, id);
    if (q.status !== 'published') throw new ConflictException('المنافسة ليست بانتظار الفتح');
    if (!deadlinePassed(q)) throw new ConflictException('لا تُفتح العروض قبل انتهاء موعد التقديم');
    const n = await this.db.getRepository(PrQuote).count({ where: { rfqId: id, status: 'submitted' } });
    q.status = 'opened';
    q.openedAt = new Date();
    q.openedByName = a.fullName;
    q.log = [...q.log, logEntry('فتح العروض', a.fullName, `${n} عرضًا مقدمًا`)];
    await this.db.getRepository(PrRfq).save(q);
    return this.get(a, id);
  }

  async cancel(a: OrgUser, id: string, reason: string) {
    const q = await this.find(a, id);
    if (['cancelled', 'awarded'].includes(q.status)) throw new ConflictException('المنافسة منتهية');
    const pending = await this.db.getRepository(PrOrder).findOne({ where: { rfqId: id, status: In(['draft', 'pending', 'returned']) } });
    await this.db.transaction(async (em) => {
      if (pending) {
        pending.status = 'cancelled';
        pending.cancelReason = `إلغاء المنافسة: ${reason}`;
        pending.log = [...pending.log, logEntry('إلغاء التعميد', a.fullName, pending.cancelReason)];
        await em.save(pending);
      }
      q.status = 'cancelled';
      q.cancelReason = reason;
      q.log = [...q.log, logEntry('إلغاء المنافسة', a.fullName, reason)];
      await em.save(q);
      await em.query(`UPDATE pr_requests SET status = 'approved', updated_at = now() WHERE id = $1 AND status = 'sourcing'`, [q.requestId]);
    });
    if (q.publishedAt) {
      await this.sc.notifySuppliers(a.organizationId, q.invitedIds, {
        kind: 'supplier-rfq', title: `إلغاء المنافسة: ${q.title}`, dedupe: `rfq-cancel:${q.id}`, path: `/rfqs/${q.id}`, paragraphs: [`نحيطكم علمًا بإلغاء المنافسة. ${reason}`],
      });
    }
    return this.get(a, id);
  }

  // ---------------- الاستفسارات ----------------

  async answer(a: OrgUser, id: string, qid: string, dto: AnswerDto) {
    const q = await this.find(a, id);
    const row = await this.db.getRepository(PrRfqQuestion).findOne({ where: { id: qid, rfqId: q.id } });
    if (!row) throw new NotFoundException('الاستفسار غير موجود');
    Object.assign(row, { answer: dto.answer.trim(), published: dto.published, answeredByName: a.fullName, answeredAt: new Date() });
    await this.db.getRepository(PrRfqQuestion).save(row);
    const to = dto.published ? q.invitedIds : row.supplierId ? [row.supplierId] : [];
    await this.sc.notifySuppliers(a.organizationId, to, {
      kind: 'supplier-rfq', title: `رد على استفسار في المنافسة ${rfqCode(q.rfqNo)}`, dedupe: `rfq-answer:${row.id}:${dto.published}`, path: `/rfqs/${q.id}`,
      paragraphs: [dto.published ? 'نُشر رد على استفسار يخص المنافسة لجميع المدعوين.' : 'وصل الرد على استفساركم.'],
    });
    return this.get(a, id);
  }

  // ---------------- العروض (من جانب الشركة) ----------------

  /** إدخال عرض ورد ورقيًا أو بالبريد نيابة عن مورد مدعو */
  async staffQuote(a: OrgUser, id: string, dto: StaffQuoteDto) {
    const q = await this.find(a, id);
    if (q.status !== 'published') throw new ConflictException('تُدخل العروض والمنافسة منشورة فقط');
    if (!q.invitedIds.includes(dto.supplierId)) throw new BadRequestException('المورد غير مدعو لهذه المنافسة');
    const lines = cleanQuoteLines(q, dto.lines, true);
    const repo = this.db.getRepository(PrQuote);
    const existing = await repo.findOne({ where: { rfqId: q.id, supplierId: dto.supplierId } });
    if (existing?.status === 'submitted' && existing.via === 'portal') throw new ConflictException('قدّم المورد عرضه عبر البوابة');
    const row = existing ?? repo.create({ organizationId: a.organizationId, rfqId: q.id, supplierId: dto.supplierId });
    Object.assign(row, {
      lines, vatRate: dto.vatRate, ...quoteTotals(q, lines, dto.vatRate), deliveryDays: dto.deliveryDays ?? null, validityDays: dto.validityDays ?? null,
      technicalNote: dto.technicalNote ?? null, via: 'staff', status: 'submitted', submittedAt: new Date(), submittedByName: a.fullName,
    });
    await repo.save(row);
    q.log = [...q.log, logEntry('إدخال عرض ورد خارج البوابة', a.fullName)];
    await this.db.getRepository(PrRfq).save(q);
    return row;
  }

  private async quoteFor(a: OrgUser, quoteId: string) {
    const quote = await this.db.getRepository(PrQuote).findOne({ where: { id: quoteId, organizationId: a.organizationId } });
    if (!quote) throw new NotFoundException('العرض غير موجود');
    const rfq = await this.find(a, quote.rfqId);
    return { quote, rfq };
  }

  async score(a: OrgUser, quoteId: string, dto: ScoreDto) {
    const { quote, rfq } = await this.quoteFor(a, quoteId);
    if (rfq.status !== 'opened') throw new ConflictException('التقييم بعد فتح العروض وقبل التوصية');
    if (!rfq.committeeIds.includes(a.id) || !can(a, P.evaluate)) throw new ForbiddenException('يقيّم العروض أعضاء لجنة التقييم فقط');
    if (quote.status !== 'submitted') throw new ConflictException('العرض غير مؤهل للتقييم');
    const tech = new Set(rfq.criteria.filter((c) => c.kind === 'technical').map((c) => c.key));
    const scores: Record<string, number> = {};
    for (const s of dto.scores) {
      if (!tech.has(s.key)) throw new BadRequestException('معيار غير موجود في المنافسة');
      scores[s.key] = s.score;
    }
    if (Object.keys(scores).length !== tech.size) throw new BadRequestException('قيّم كل المعايير الفنية');
    quote.scores = { ...quote.scores, [a.id]: { name: a.fullName, scores, note: dto.note ?? null, at: new Date().toISOString() } };
    await this.db.getRepository(PrQuote).save(quote);
    return this.get(a, rfq.id);
  }

  async exclude(a: OrgUser, quoteId: string, reason: string | null) {
    const { quote, rfq } = await this.quoteFor(a, quoteId);
    if (rfq.status !== 'opened') throw new ConflictException('الاستبعاد بعد فتح العروض وقبل التوصية');
    if (reason) {
      if (quote.status !== 'submitted') throw new ConflictException('العرض غير مقدم');
      quote.status = 'excluded';
      quote.excludedReason = reason;
    } else {
      if (quote.status !== 'excluded') throw new ConflictException('العرض غير مستبعد');
      quote.status = 'submitted';
      quote.excludedReason = null;
    }
    await this.db.getRepository(PrQuote).save(quote);
    const sup = await this.db.getRepository(PrSupplier).findOneOrFail({ where: { id: quote.supplierId } });
    rfq.log = [...rfq.log, logEntry(reason ? `استبعاد عرض ${sup.name}` : `إعادة عرض ${sup.name}`, a.fullName, reason)];
    await this.db.getRepository(PrRfq).save(rfq);
    return this.get(a, rfq.id);
  }

  /** توثيق جولة تفاوض: الأسعار الجديدة بعد التفاوض مع المورد */
  async negotiate(a: OrgUser, quoteId: string, dto: NegotiateDto) {
    const { quote, rfq } = await this.quoteFor(a, quoteId);
    if (rfq.status !== 'opened') throw new ConflictException('التفاوض بعد فتح العروض وقبل التوصية');
    if (quote.status !== 'submitted') throw new ConflictException('العرض غير مؤهل');
    const changes = new Map(dto.lines.map((l) => [l.lineId, l]));
    const merged = quote.lines.map((l) => (changes.has(l.lineId) ? { ...l, unitPrice: r2(changes.get(l.lineId)!.unitPrice) } : l));
    const before = quote.total;
    Object.assign(quote, { lines: cleanQuoteLines(rfq, merged, true), ...quoteTotals(rfq, merged, quote.vatRate) });
    quote.revisions = [...quote.revisions, { round: quote.revisions.length + 1, at: new Date().toISOString(), byName: a.fullName, note: dto.note, before, after: quote.total }];
    await this.db.getRepository(PrQuote).save(quote);
    const sup = await this.db.getRepository(PrSupplier).findOneOrFail({ where: { id: quote.supplierId } });
    rfq.log = [...rfq.log, logEntry(`جولة تفاوض مع ${sup.name}`, a.fullName, `${before.toLocaleString('en-US')} ← ${quote.total.toLocaleString('en-US')}: ${dto.note}`)];
    await this.db.getRepository(PrRfq).save(rfq);
    return this.get(a, rfq.id);
  }

  /** التوصية بالترسية: تُنشئ التعميد للعرض المختار في مسار الاعتماد (الاعتماد الأخير = اعتماد الترسية والتعميد) */
  async recommend(a: OrgUser, id: string, dto: RecommendDto) {
    const q = await this.find(a, id);
    if (q.status !== 'opened') throw new ConflictException('التوصية بعد فتح العروض');
    const quotes = await this.db.getRepository(PrQuote).find({ where: { rfqId: id } });
    const quote = quotes.find((x) => x.id === dto.quoteId);
    if (!quote || quote.status !== 'submitted') throw new BadRequestException('اختر عرضًا مقدمًا غير مستبعد');
    const ev = evaluate(q, quotes);
    const e = ev.get(quote.id)!;
    if (!e.passed) throw new ConflictException(`العرض لم يجتز الحد الأدنى للتقييم الفني (${q.technicalPass})`);
    const techCriteria = q.criteria.some((c) => c.kind === 'technical');
    if (techCriteria && e.technicalScore === null) throw new ConflictException('أكمل لجنة التقييم تقدير العرض فنيًا أولًا');
    if (e.rank !== 1 && dto.recommendation.trim().length < 30) throw new BadRequestException('العرض المختار ليس الأعلى تقييمًا؛ اكتب مبررات الاختيار بوضوح');
    await this.orders.approvedSupplier(a.organizationId, quote.supplierId);
    const r = await this.requests.find(a, q.requestId);
    const order = await this.db.transaction(async (em) => {
      const o = await this.orders.createFromQuote(em, a, q, quote, r);
      q.status = 'recommended';
      q.recommendedQuoteId = quote.id;
      q.recommendation = dto.recommendation.trim();
      q.recommendedByName = a.fullName;
      q.recommendedAt = new Date();
      q.log = [...q.log, logEntry('التوصية بالترسية', a.fullName, `${orderCode(o.orderNo)} · الترتيب ${e.rank ?? '—'}`)];
      await em.save(q);
      return o;
    });
    return { rfq: await this.get(a, id), orderId: order.id };
  }

  // ---------------- المرفقات ----------------

  async addAttachment(a: OrgUser, id: string, file: Express.Multer.File) {
    const q = await this.find(a, id);
    if (!['draft', 'published'].includes(q.status)) throw new ConflictException('تُرفق مستندات الكراسة قبل فتح العروض');
    if (q.attachments.length >= MAX_ATTACHMENTS) throw new BadRequestException(`الحد الأعلى ${MAX_ATTACHMENTS} مرفقًا`);
    const saved = await this.files.save(`${a.organizationId}/procurement`, file, 'المرفق');
    const att: ItemFile = { key: saved.key, name: saved.name, mime: saved.mime, size: file.size, at: new Date().toISOString(), byName: a.fullName };
    await this.db.getRepository(PrRfq).update({ id }, { attachments: [...q.attachments, att], log: [...q.log, logEntry('إرفاق مستند للكراسة', a.fullName, saved.name)] });
    return this.get(a, id);
  }

  async removeAttachment(a: OrgUser, id: string, key: string) {
    const q = await this.find(a, id);
    if (q.status !== 'draft') throw new ConflictException('لا تُحذف مرفقات الكراسة بعد نشرها');
    const att = q.attachments.find((x) => x.key.endsWith(`/${key}`));
    if (!att) throw new NotFoundException('المرفق غير موجود');
    await this.files.remove(att.key).catch(() => undefined);
    await this.db.getRepository(PrRfq).update({ id }, { attachments: q.attachments.filter((x) => x !== att) });
    return this.get(a, id);
  }

  async file(a: OrgUser, id: string, key: string) {
    const q = await this.find(a, id);
    const att = q.attachments.find((x) => x.key.endsWith(`/${key}`));
    if (!att) throw new NotFoundException('المرفق غير موجود');
    return { stream: this.files.open(att.key), mime: att.mime, name: att.name };
  }

  async quoteFile(a: OrgUser, quoteId: string, key: string) {
    const { quote, rfq } = await this.quoteFor(a, quoteId);
    if (!rfq.openedAt) throw new ForbiddenException('مرفقات العروض مختومة حتى فتح العروض');
    const att = quote.attachments.find((x) => x.key.endsWith(`/${key}`));
    if (!att) throw new NotFoundException('المرفق غير موجود');
    return { stream: this.files.open(att.key), mime: att.mime, name: att.name };
  }

  // ---------------- العرض ----------------

  async list(a: OrgUser, f: { status?: string; q?: string }) {
    const rows: Record<string, unknown>[] = await this.db.query(
      `SELECT q.id, q.rfq_no AS "rfqNo", q.title, q.method, q.status, q.closes_at AS "closesAt", q.published_at AS "publishedAt", q.committee_ids AS "committeeIds",
              jsonb_array_length(q.invited_ids)::int AS invited, r.request_no AS "requestNo", r.estimated_total::float AS "estimatedTotal",
              (SELECT COUNT(*)::int FROM pr_quotes x WHERE x.rfq_id = q.id AND x.status IN ('submitted', 'excluded')) AS quotes
         FROM pr_rfqs q JOIN pr_requests r ON r.id = q.request_id
        WHERE q.organization_id = $1 AND ($2::text IS NULL OR q.status = $2) AND ($3::boolean OR q.committee_ids ? $4)
          AND ($5::text IS NULL OR q.title ILIKE '%' || $5 || '%' OR ('RFQ-' || LPAD(q.rfq_no::text, 4, '0')) ILIKE '%' || $5 || '%')
        ORDER BY q.rfq_no DESC LIMIT 500`, [a.organizationId, f.status || null, this.seesAll(a), a.id, f.q?.trim() || null]);
    return rows.map((r) => {
      const st = r.status as PrRfq['status'];
      const closes = r.closesAt ? new Date(r.closesAt as string) : null;
      return {
        ...r, code: rfqCode(r.rfqNo as number), requestCode: requestCode(r.requestNo as number), statusLabel: RFQ_STATUS[st],
        methodLabel: PURCHASE_METHODS[r.method as 'quotes'], awaitingOpen: st === 'published' && !!closes && closes.getTime() <= Date.now(),
        member: (r.committeeIds as string[]).includes(a.id), committeeIds: undefined,
      };
    });
  }

  async get(a: OrgUser, id: string) {
    const org = a.organizationId;
    const q = await this.find(a, id);
    const [r, quotes, questions, order] = await Promise.all([
      this.db.getRepository(PrRequest).findOneOrFail({ where: { id: q.requestId } }),
      this.db.getRepository(PrQuote).find({ where: { rfqId: id }, order: { submittedAt: 'ASC' } }),
      this.db.getRepository(PrRfqQuestion).find({ where: { rfqId: id }, order: { createdAt: 'ASC' } }),
      this.db.getRepository(PrOrder).findOne({ where: { rfqId: id }, order: { createdAt: 'DESC' } }),
    ]);
    const supIds = [...new Set([...q.invitedIds, ...quotes.map((x) => x.supplierId), ...questions.map((x) => x.supplierId).filter((x): x is string => !!x)])];
    const sups: { id: string; supplier_no: number; name: string; status: string }[] = supIds.length
      ? await this.db.query('SELECT id, supplier_no, name, status FROM pr_suppliers WHERE id = ANY($1)', [supIds]) : [];
    const sup = new Map(sups.map((s) => [s.id, { id: s.id, code: supplierCode(s.supplier_no), name: s.name, status: s.status }]));
    const users = await this.core.userNames(org, q.committeeIds);
    const sealed = !q.openedAt;
    const ev = sealed ? new Map<string, QuoteEvaluation>() : evaluate(q, quotes);
    const visibleQuotes = quotes.filter((x) => x.status !== 'draft');
    const member = q.committeeIds.includes(a.id) && can(a, P.evaluate);
    const sourcing = can(a, P.sourcing);
    return {
      ...q, code: rfqCode(q.rfqNo), statusLabel: RFQ_STATUS[q.status], methodLabel: PURCHASE_METHODS[q.method], deadlinePassed: deadlinePassed(q), sealed,
      request: { id: r.id, code: requestCode(r.requestNo), title: r.title, estimatedTotal: sourcing || !sealed ? r.estimatedTotal : null, neededBy: r.neededBy },
      invited: q.invitedIds.map((sid) => ({
        ...(sup.get(sid) ?? { id: sid, code: '—', name: '—', status: '' }),
        quoteStatus: quotes.find((x) => x.supplierId === sid && x.status !== 'draft')?.status ?? null,
      })),
      committee: q.committeeIds.map((uid) => ({ id: uid, name: users.get(uid) ?? '—' })),
      questions: questions.map((x) => ({ ...x, supplierName: x.supplierId ? sup.get(x.supplierId)?.name ?? '—' : null })),
      // قبل الفتح: من قدّم ومتى فقط، بلا أسعار ولا مرفقات
      quotes: visibleQuotes.map((x) => sealed
        ? { id: x.id, supplier: sup.get(x.supplierId), status: x.status, statusLabel: QUOTE_STATUS[x.status], submittedAt: x.submittedAt, via: x.via }
        : {
          ...x, statusLabel: QUOTE_STATUS[x.status], supplier: sup.get(x.supplierId), evaluation: ev.get(x.id) ?? null,
          myScore: x.scores?.[a.id] ?? null, scores: Object.values(x.scores ?? {}),
        }),
      order: order ? { id: order.id, code: orderCode(order.orderNo), status: order.status, statusLabel: ORDER_STATUS[order.status], total: order.total } : null,
      can: {
        edit: q.status === 'draft' && sourcing, publish: q.status === 'draft' && sourcing, extend: q.status === 'published' && sourcing,
        open: q.status === 'published' && sourcing && deadlinePassed(q), staffQuote: q.status === 'published' && sourcing,
        answer: ['published', 'opened'].includes(q.status) && sourcing, score: q.status === 'opened' && member,
        manageQuotes: q.status === 'opened' && sourcing, recommend: q.status === 'opened' && sourcing,
        cancel: !['cancelled', 'awarded'].includes(q.status) && sourcing,
      },
    };
  }
}
