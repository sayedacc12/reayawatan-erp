import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { DataSource, EntityManager } from 'typeorm';
import { OrgUser } from '../../core/auth/decorators';
import { FileStore } from '../../core/files/file-store.service';
import { LineDto } from '../accounting/accounting.dto';
import { ACC_PERMISSIONS as ACC } from '../accounting/accounting.manifest';
import { AssetOpsService } from '../accounting/asset-ops.service';
import { EntriesService } from '../accounting/entries.service';
import { CashAccount, Partner, Voucher } from '../accounting/entities/accounting.entity';
import { VouchersService } from '../accounting/vouchers.service';
import { FundraisingService } from '../fundraising/fundraising.service';
import { BudgetAvailability } from '../planning/budget/budget-availability.service';
import { BudgetCommitment } from '../planning/budget/budget.entity';
import {
  BOOKED_INVOICE, INVOICE_KINDS, INVOICE_STATUS, InvoiceKind, InvoiceLine, InvoiceStatus, LIVE_INVOICE, MATCH_ISSUES, MatchIssue, MatchResult, PrInvoice,
} from './entities/invoice.entity';
import { ItemFile, PrSettings, PrSupplier } from './entities/procurement.entity';
import { ORDER_STATUS, PrOrder } from './entities/sourcing.entity';
import { InvoiceApproveDto, InvoiceDto, InvoiceListQueryDto, InvoicePayDto, InvoicePostDto, InvoiceSettingsDto, StatementQueryDto } from './invoice.dto';
import { PROCUREMENT_PERMISSIONS as P } from './procurement.manifest';
import { logEntry, ProcurementCore, prToday, supplierCode } from './procurement-core.service';
import { RECEIVABLE, ReceiptsService } from './receipts.service';
import { can } from './requests.service';
import { orderCode, r2, SourcingCore } from './sourcing-core.service';
import { q3 } from './stock-core.service';
import { SupplierPortalUser } from './supplier-portal.guard';

const pad = (n: number) => String(n).padStart(4, '0');
export const invoiceCode = (kind: InvoiceKind, n: number) => `${kind === 'credit_note' ? 'CRN' : 'INV'}-${pad(n)}`;
/** توحيد رقم فاتورة المورد لكشف التكرار: أرقام لاتينية، بلا مسافات ورموز، وبلا أصفار بادئة */
export const invoiceKey = (s: string) =>
  s.replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d))).toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/(^|[A-Z])0+(?=\d)/g, '$1').slice(0, 60);
const addDays = (d: string, n: number) => new Date(new Date(`${d}T00:00:00Z`).getTime() + n * 86400_000).toISOString().slice(0, 10);

/** التعميدات التي تُفوتر */
export const INVOICEABLE = [...RECEIVABLE, 'closed'];
const MAX_FILES = 10;
/** أدوار البوابة التي ترفع الفواتير */
const canInvoice = (p: SupplierPortalUser) => p.role === 'owner' || p.role === 'finance';
const INV_READ = [P.invoices, P.invoicesOverride, P.suppliersRead, P.reports];
const canRead = (a: OrgUser) => INV_READ.some((x) => can(a, x)) || can(a, ACC.payables) || can(a, ACC.payments);

/** صاحب الإجراء: موظف أو مستخدم بوابة */
type Actor = { kind: 'staff'; a: OrgUser } | { kind: 'portal'; p: SupplierPortalUser };

/**
 * فواتير الموردين والمطابقة الثلاثية والمستحقات وكشوف الحساب (المرحلة الرابعة).
 * يرفع المورد فاتورته من البوابة (أو يسجلها الموظف)، فتُطابق آليًا بين التعميد (السعر) والاستلام المعتمد (الكمية المقبولة ناقص المرتجع)
 * والفاتورة، وتُكشف الفواتير المكررة. تعتمدها المشتريات وتحيلها للنظام المالي، والنظام المالي وحده يسجل المستحق بقيد فاتورة مورد
 * (مدين البضاعة المستلمة غير المفوترة وفروق الأسعار وضريبة المدخلات، دائن حساب المورد)، ويسدده بسندات صرف تمر بمراحل اعتمادها.
 */
@Injectable()
export class InvoicesService implements OnModuleInit {
  constructor(
    private readonly db: DataSource, private readonly core: ProcurementCore, private readonly sc: SourcingCore, private readonly receipts: ReceiptsService,
    private readonly entries: EntriesService, private readonly vouchers: VouchersService, private readonly files: FileStore,
    private readonly avail: BudgetAvailability, private readonly fundraising: FundraisingService, private readonly assetOps: AssetOpsService,
  ) {}

  onModuleInit() {
    this.vouchers.onStatusChange('procurement', (em, v) => this.onVoucher(em, v));
  }

  // ---------------- أدوات ----------------

  private async lockInvoice(em: EntityManager, org: string, id: string) {
    const x = await em.getRepository(PrInvoice).createQueryBuilder('i').setLock('pessimistic_write').where('i.id = :id AND i.organization_id = :org', { id, org }).getOne();
    if (!x) throw new NotFoundException('الفاتورة غير موجودة');
    return x;
  }

  /** فواتير التعميد الواحد تُعالج واحدة تلو الأخرى حتى لا تُفوتر الكمية نفسها مرتين */
  private async lockOrder(em: EntityManager, orderId: string) {
    await em.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`pr_invoices:order:${orderId}`]);
  }

  private async order(org: string, id: string, em: EntityManager = this.db.manager) {
    const o = await em.getRepository(PrOrder).findOne({ where: { id, organizationId: org } });
    if (!o) throw new NotFoundException('التعميد غير موجود');
    return o;
  }

  /** صافي المفوتر لكل بند تعميد (الفواتير الحية ناقص الإشعارات الدائنة)، عدا فاتورة محددة */
  async invoicedByLine(orderId: string, exceptId: string | null, em: EntityManager = this.db.manager) {
    const rows: { line_id: string; qty: string }[] = await em.query(
      `SELECT l->>'orderLineId' AS line_id, SUM(CASE WHEN i.kind = 'credit_note' THEN -1 ELSE 1 END * (l->>'qty')::numeric) AS qty
         FROM pr_invoices i, jsonb_array_elements(i.lines) l
        WHERE i.order_id = $1 AND i.status = ANY($2) AND ($3::uuid IS NULL OR i.id <> $3::uuid) GROUP BY 1`, [orderId, LIVE_INVOICE, exceptId]);
    return new Map(rows.map((r) => [r.line_id, Number(r.qty)]));
  }

  private async extraLeft(orderId: string, exceptId: string | null, em: EntityManager) {
    const [{ rec }] = await em.query(`SELECT COALESCE(SUM(extra_cost), 0)::float AS rec FROM pr_receipts WHERE order_id = $1 AND status = 'posted'`, [orderId]);
    const [{ inv }] = await em.query(
      `SELECT COALESCE(SUM(CASE WHEN kind = 'credit_note' THEN -1 ELSE 1 END * extra_amount), 0)::float AS inv FROM pr_invoices
        WHERE order_id = $1 AND status = ANY($2) AND ($3::uuid IS NULL OR id <> $3::uuid)`, [orderId, LIVE_INVOICE, exceptId]);
    return r2(rec - inv);
  }

  /** فاتورة أخرى بالرقم نفسه للمورد نفسه (بعد التوحيد) ليست ملغاة ولا مرفوضة */
  private async exactDuplicate(em: EntityManager, inv: { organizationId: string; supplierId: string; supplierKey: string; kind: InvoiceKind; id?: string }) {
    const [d] = await em.query(
      `SELECT invoice_no AS "invoiceNo", kind, supplier_invoice_no AS no FROM pr_invoices
        WHERE organization_id = $1 AND supplier_id = $2 AND supplier_key = $3 AND kind = $4 AND status NOT IN ('cancelled', 'rejected') AND ($5::uuid IS NULL OR id <> $5::uuid) LIMIT 1`,
      [inv.organizationId, inv.supplierId, inv.supplierKey, inv.kind, inv.id ?? null]);
    if (d) throw new ConflictException(`الرقم «${d.no}» مسجل بالفعل لهذا المورد في ${invoiceCode(d.kind, d.invoiceNo)}، فلا تُسجل الفاتورة مرتين`);
  }

  /**
   * المطابقة الثلاثية: الكمية المفوترة لا تتجاوز المستلم المقبول غير المفوتر، والسعر لا يتجاوز سعر التعميد إلا بالنسبة المسموحة،
   * والمصاريف لا تتجاوز مصاريف الاستلام غير المفوترة، مع تنبيه للفاتورة المحتملة التكرار (المبلغ والتاريخ نفسهما برقم مختلف).
   * والإشعار الدائن لا يتجاوز المفوتر من البند ولا المتبقي على الفاتورة الأصلية.
   */
  async match(em: EntityManager, inv: PrInvoice, s: PrSettings): Promise<MatchResult> {
    const issues: MatchIssue[] = [];
    const [got, billed] = await Promise.all([this.receipts.receivedByLine(inv.orderId, em), this.invoicedByLine(inv.orderId, inv.id ?? null, em)]);
    const tol = 1 + (s.matchTolerancePct ?? 0) / 100;
    for (const l of inv.lines) {
      const received = q3(got.get(l.orderLineId) ?? 0);
      const before = q3(billed.get(l.orderLineId) ?? 0);
      if (inv.kind === 'invoice') {
        const left = q3(received - before);
        if (l.qty > left + 0.0005) {
          issues.push({ kind: 'qty', lineId: l.id, message: `«${l.description}»: الكمية المفوترة ${l.qty} والمستلم المقبول غير المفوتر ${Math.max(0, left)} (المستلم ${received}، والمفوتر سابقًا ${before})` });
        }
        if (l.unitPrice > r2(l.orderPrice * tol) + 0.005) {
          issues.push({ kind: 'price', lineId: l.id, message: `«${l.description}»: سعر الوحدة ${l.unitPrice} وسعر التعميد ${l.orderPrice}${s.matchTolerancePct ? ` مع التجاوز المسموح ${s.matchTolerancePct}%` : ''}` });
        }
      } else if (l.qty > before + 0.0005) {
        issues.push({ kind: 'qty', lineId: l.id, message: `«${l.description}»: الكمية المخصومة ${l.qty} أكبر من صافي المفوتر ${before}` });
      }
    }
    if (inv.kind === 'invoice' && inv.extraAmount > 0) {
      const left = await this.extraLeft(inv.orderId, inv.id ?? null, em);
      if (inv.extraAmount > left + 0.005) issues.push({ kind: 'extra', message: `مصاريف النقل والتخليص ${inv.extraAmount} وغير المفوتر من مصاريف الاستلام ${Math.max(0, left)}` });
    }
    if (inv.kind === 'invoice') {
      const dup: { invoiceNo: number; no: string }[] = await em.query(
        `SELECT invoice_no AS "invoiceNo", supplier_invoice_no AS no FROM pr_invoices
          WHERE organization_id = $1 AND supplier_id = $2 AND kind = 'invoice' AND status NOT IN ('cancelled', 'rejected', 'draft')
            AND invoice_date = $3 AND ABS(total - $4) < 0.01 AND ($5::uuid IS NULL OR id <> $5::uuid) LIMIT 3`,
        [inv.organizationId, inv.supplierId, inv.invoiceDate, inv.total, inv.id ?? null]);
      if (dup.length) {
        issues.push({ kind: 'duplicate', message: `فاتورة بالمبلغ والتاريخ نفسيهما مسجلة: ${dup.map((d) => `${invoiceCode('invoice', d.invoiceNo)} (رقم المورد ${d.no})`).join('، ')}` });
      }
    } else if (inv.refInvoiceId) {
      const ref = await em.getRepository(PrInvoice).findOne({ where: { id: inv.refInvoiceId, organizationId: inv.organizationId } });
      const pendingCredits: { t: number }[] = await em.query(
        `SELECT COALESCE(SUM(total), 0)::float AS t FROM pr_invoices WHERE ref_invoice_id = $1 AND kind = 'credit_note' AND status IN ('submitted', 'approved') AND ($2::uuid IS NULL OR id <> $2::uuid)`,
        [inv.refInvoiceId, inv.id ?? null]);
      const left = ref ? r2((await this.creditableLeft(em, ref)) - (pendingCredits[0]?.t ?? 0)) : 0;
      if (inv.total > left + 0.005) issues.push({ kind: 'credit', message: `الإشعار ${inv.total} والمتبقي غير المسدد على الفاتورة الأصلية ${Math.max(0, left)}` });
    }
    return { ok: !issues.length, issues, at: new Date().toISOString() };
  }

  /** بنود الفاتورة من بنود التعميد وإجمالياتها */
  private build(o: PrOrder, dto: InvoiceDto): Pick<PrInvoice, 'lines' | 'extraAmount' | 'vatRate' | 'subtotal' | 'vat' | 'total'> {
    const seen = new Set<string>();
    const lines: InvoiceLine[] = [];
    for (const [i, x] of dto.lines.entries()) {
      if (!(x.qty > 0)) continue;
      const ol = o.lines.find((l) => l.lineId === x.orderLineId);
      if (!ol) throw new BadRequestException(`البند ${i + 1} ليس من بنود التعميد`);
      if (seen.has(ol.lineId!)) throw new BadRequestException(`البند «${ol.description}» مكرر`);
      seen.add(ol.lineId!);
      lines.push({ id: randomUUID(), orderLineId: ol.lineId!, description: ol.description, qty: q3(x.qty), unitPrice: r2(x.unitPrice), amount: r2(q3(x.qty) * r2(x.unitPrice)), orderPrice: ol.unitPrice });
    }
    if (!lines.length) throw new BadRequestException('اكتب الكمية لبند واحد على الأقل');
    const extraAmount = r2(dto.extraAmount ?? 0);
    const vatRate = dto.vatRate ?? o.vatRate;
    const subtotal = r2(lines.reduce((t, l) => t + l.amount, 0) + extraAmount);
    const vat = r2((subtotal * vatRate) / 100);
    return { lines, extraAmount, vatRate, subtotal, vat, total: r2(subtotal + vat) };
  }

  /**
   * الإشعار الدائن إرجاع لكميات من الفاتورة الأصلية بسعرها نفسه: كل بند من بنودها، وكميته لا تتجاوز كميتها بعد الإشعارات السابقة عليها.
   * فلا يمكن خصم كمية بسعر رمزي ثم فوترتها مرة أخرى بسعرها الكامل.
   */
  private async assertCreditLines(em: EntityManager, ref: PrInvoice, lines: InvoiceLine[], exceptId: string | null) {
    const rows: { line_id: string; qty: string }[] = await em.query(
      `SELECT l->>'orderLineId' AS line_id, SUM((l->>'qty')::numeric) AS qty FROM pr_invoices i, jsonb_array_elements(i.lines) l
        WHERE i.organization_id = $1 AND i.ref_invoice_id = $2 AND i.kind = 'credit_note' AND i.status NOT IN ('cancelled', 'rejected') AND ($3::uuid IS NULL OR i.id <> $3::uuid) GROUP BY 1`,
      [ref.organizationId, ref.id, exceptId]);
    const credited = new Map(rows.map((r) => [r.line_id, Number(r.qty)]));
    for (const l of lines) {
      const rl = ref.lines.find((x) => x.orderLineId === l.orderLineId);
      if (!rl) throw new BadRequestException(`«${l.description}» ليس من بنود الفاتورة الأصلية`);
      if (Math.abs(l.unitPrice - rl.unitPrice) > 0.005) throw new BadRequestException(`سعر «${l.description}» في الإشعار يجب أن يساوي سعره في الفاتورة الأصلية (${rl.unitPrice})`);
      const left = q3(rl.qty - (credited.get(l.orderLineId) ?? 0));
      if (l.qty > left + 0.0005) throw new BadRequestException(`كمية «${l.description}» في الإشعار أكبر من المتبقي في الفاتورة الأصلية (${Math.max(0, left)})`);
    }
  }

  /** المتبقي للخصم على الفاتورة: الإجمالي ناقص المسدد والمخصوم والسندات قيد الاعتماد */
  private async creditableLeft(em: EntityManager, ref: PrInvoice) {
    const [{ pending }] = await em.query(
      `SELECT COALESCE(SUM(amount), 0)::float AS pending FROM acc_vouchers WHERE organization_id = $1 AND source_type = 'procurement' AND source_ref = $2 AND status IN ('draft', 'pending', 'returned')`,
      [ref.organizationId, ref.id]);
    return r2(ref.total - ref.paidAmount - ref.creditedAmount - pending);
  }

  /** إشعارات دائنة غير ملغاة ولا مرفوضة على الفاتورة */
  private async liveCredits(em: EntityManager, inv: PrInvoice) {
    const [{ n }] = await em.query(
      `SELECT COUNT(*)::int AS n FROM pr_invoices WHERE organization_id = $1 AND ref_invoice_id = $2 AND kind = 'credit_note' AND status NOT IN ('cancelled', 'rejected')`,
      [inv.organizationId, inv.id]);
    return n as number;
  }

  private async nextNo(em: EntityManager, org: string) {
    await em.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`pr_invoices:${org}`]);
    const [{ n }] = await em.query('SELECT COALESCE(MAX(invoice_no), 0)::int + 1 AS n FROM pr_invoices WHERE organization_id = $1', [org]);
    return n as number;
  }

  // ---------------- الإنشاء والتعديل (الموظف والبوابة) ----------------

  private async save(actor: Actor, dto: InvoiceDto, id: string | null) {
    const org = actor.kind === 'staff' ? actor.a.organizationId : actor.p.organizationId;
    const byName = actor.kind === 'staff' ? actor.a.fullName : actor.p.fullName;
    if (dto.invoiceDate > prToday()) throw new BadRequestException('تاريخ الفاتورة في المستقبل');
    if (dto.dueDate && dto.dueDate < dto.invoiceDate) throw new BadRequestException('تاريخ الاستحقاق قبل تاريخ الفاتورة');
    const s = await this.core.settings(org);
    return this.db.transaction(async (em) => {
      const o = await this.order(org, dto.orderId, em);
      if (actor.kind === 'portal' && o.supplierId !== actor.p.supplierId) throw new NotFoundException('التعميد غير موجود');
      if (!INVOICEABLE.includes(o.status)) throw new ConflictException(`لا تُسجل فاتورة على تعميد «${ORDER_STATUS[o.status]}»`);
      await this.lockOrder(em, o.id);
      let ref: PrInvoice | null = null;
      if (dto.kind === 'credit_note') {
        if (!dto.refInvoiceId) throw new BadRequestException('اختر الفاتورة الأصلية التي يخصم منها الإشعار');
        ref = await em.getRepository(PrInvoice).findOne({ where: { id: dto.refInvoiceId, organizationId: org } });
        if (!ref || ref.orderId !== o.id || ref.kind !== 'invoice') throw new BadRequestException('الفاتورة الأصلية ليست على هذا التعميد');
        if (!['posted', 'partial'].includes(ref.status)) throw new ConflictException('يُسجل الإشعار الدائن على فاتورة مسجلة في النظام المالي وغير مسددة بالكامل');
      }
      const body = this.build(o, dto);
      if (ref) await this.assertCreditLines(em, ref, body.lines, id);
      const key = invoiceKey(dto.supplierInvoiceNo);
      if (!key) throw new BadRequestException('رقم الفاتورة غير صحيح');
      let inv: PrInvoice;
      if (id) {
        inv = await this.lockInvoice(em, org, id);
        if (actor.kind === 'portal' && (inv.supplierId !== actor.p.supplierId || inv.via !== 'portal')) throw new NotFoundException('الفاتورة غير موجودة');
        if (actor.kind === 'staff' && inv.via !== 'staff') throw new ForbiddenException('الفاتورة مرفوعة من المورد، فيصححها المورد من البوابة بعد إعادتها له');
        if (inv.status !== 'draft' && inv.status !== 'returned') throw new ConflictException('لا تُعدل الفاتورة إلا وهي مسودة أو معادة للتصحيح');
        if (inv.orderId !== o.id || inv.kind !== dto.kind) throw new BadRequestException('لا يتغير التعميد ولا نوع المستند بعد الإنشاء');
        Object.assign(inv, body, { refInvoiceId: ref?.id ?? null, supplierInvoiceNo: dto.supplierInvoiceNo, supplierKey: key, invoiceDate: dto.invoiceDate,
          dueDate: dto.dueDate ?? addDays(dto.invoiceDate, s.paymentDays), notes: dto.notes ?? null });
        inv.log = [...inv.log, logEntry('تعديل', byName)];
        if (actor.kind === 'staff' && !inv.editorIds.includes(actor.a.id)) inv.editorIds = [...inv.editorIds, actor.a.id];
      } else {
        inv = em.create(PrInvoice, {
          organizationId: org, invoiceNo: await this.nextNo(em, org), kind: dto.kind, orderId: o.id, supplierId: o.supplierId, refInvoiceId: ref?.id ?? null,
          supplierInvoiceNo: dto.supplierInvoiceNo, supplierKey: key, invoiceDate: dto.invoiceDate, dueDate: dto.dueDate ?? addDays(dto.invoiceDate, s.paymentDays),
          ...body, status: 'draft', via: actor.kind, notes: dto.notes ?? null, createdById: actor.kind === 'staff' ? actor.a.id : null, editorIds: actor.kind === 'staff' ? [actor.a.id] : [], createdByName: byName,
          log: [logEntry(actor.kind === 'portal' ? `إنشاء ${INVOICE_KINDS[dto.kind]} من بوابة المورد` : `تسجيل ${INVOICE_KINDS[dto.kind]} ورقية`, byName, orderCode(o.orderNo))],
        });
      }
      await this.exactDuplicate(em, inv);
      inv.match = await this.match(em, inv, s);
      const saved = await em.getRepository(PrInvoice).save(inv);
      return saved.id;
    });
  }

  private async submitInv(actor: Actor, id: string) {
    const org = actor.kind === 'staff' ? actor.a.organizationId : actor.p.organizationId;
    const byName = actor.kind === 'staff' ? actor.a.fullName : actor.p.fullName;
    const s = await this.core.settings(org);
    await this.db.transaction(async (em) => {
      const inv = await this.lockInvoice(em, org, id);
      if (actor.kind === 'portal' && (inv.supplierId !== actor.p.supplierId || inv.via !== 'portal')) throw new NotFoundException('الفاتورة غير موجودة');
      if (actor.kind === 'staff' && inv.via !== 'staff') throw new ForbiddenException('الفاتورة مرفوعة من المورد، فيرسلها المورد من البوابة');
      if (inv.status !== 'draft' && inv.status !== 'returned') throw new ConflictException('الفاتورة ليست مسودة');
      if (actor.kind === 'portal' && !inv.attachments.length) throw new BadRequestException('أرفق صورة الفاتورة الضريبية قبل الإرسال');
      await this.lockOrder(em, inv.orderId);
      await this.exactDuplicate(em, inv);
      inv.match = await this.match(em, inv, s);
      inv.status = 'submitted';
      inv.submittedAt = new Date();
      if (actor.kind === 'staff' && !inv.editorIds.includes(actor.a.id)) inv.editorIds = [...inv.editorIds, actor.a.id];
      inv.returnReason = null;
      inv.log = [...inv.log, logEntry('إرسال للمراجعة والمطابقة', byName, inv.match.ok ? 'مطابقة' : `${inv.match.issues.length} استثناء`)];
      await em.save(inv);
    });
  }

  // ---------------- الموظف ----------------

  async create(a: OrgUser, dto: InvoiceDto) {
    if (!can(a, P.invoices)) throw new ForbiddenException('لا تملك صلاحية تسجيل الفواتير');
    return this.get(a, await this.save({ kind: 'staff', a }, dto, null));
  }

  async update(a: OrgUser, id: string, dto: InvoiceDto) {
    if (!can(a, P.invoices)) throw new ForbiddenException('لا تملك صلاحية تسجيل الفواتير');
    return this.get(a, await this.save({ kind: 'staff', a }, dto, id));
  }

  async submit(a: OrgUser, id: string) {
    if (!can(a, P.invoices)) throw new ForbiddenException('لا تملك صلاحية تسجيل الفواتير');
    await this.submitInv({ kind: 'staff', a }, id);
    return this.get(a, id);
  }

  /** اعتماد الفاتورة المطابقة وإحالتها للنظام المالي. الاستثناءات لا تُعتمد إلا بصلاحية التجاوز وسبب مكتوب */
  async approve(a: OrgUser, id: string, dto: InvoiceApproveDto) {
    const org = a.organizationId;
    if (!can(a, P.invoices) && !can(a, P.invoicesOverride)) throw new ForbiddenException('لا تملك صلاحية اعتماد الفواتير');
    const s = await this.core.settings(org);
    let notify: PrInvoice | null = null;
    await this.db.transaction(async (em) => {
      const inv = await this.lockInvoice(em, org, id);
      if (inv.status !== 'submitted') throw new ConflictException('الفاتورة لا تنتظر المراجعة');
      if (!a.isSuperadmin && (inv.createdById === a.id || inv.editorIds.includes(a.id))) throw new ForbiddenException('لا يعتمد الموظف فاتورة سجلها أو عدلها أو أرسلها بنفسه (فصل المهام)');
      const o = await this.order(org, inv.orderId, em);
      if (!a.isSuperadmin && o.createdById === a.id) throw new ForbiddenException('لا يعتمد فاتورة التعميد من أعد التعميد (فصل المهام)');
      await this.lockOrder(em, inv.orderId);
      await this.exactDuplicate(em, inv);
      inv.match = await this.match(em, inv, s);
      if (!inv.match.ok) {
        if (!can(a, P.invoicesOverride)) {
          throw new ConflictException(`الفاتورة غير مطابقة: ${inv.match.issues.map((x) => x.message).join(' | ')}. أعدها للمورد للتصحيح، أو يعتمدها صاحب صلاحية التجاوز بسبب مكتوب`);
        }
        if (!dto.overrideReason) throw new BadRequestException('الفاتورة غير مطابقة: اكتب سبب اعتمادها رغم الاستثناءات');
        inv.override = { byName: a.fullName, reason: dto.overrideReason, at: new Date().toISOString() };
      } else inv.override = null;
      inv.status = 'approved';
      inv.approvedById = a.id;
      inv.approvedByName = a.fullName;
      inv.approvedAt = new Date();
      inv.log = [...inv.log, logEntry(inv.override ? 'اعتماد مع تجاوز استثناءات المطابقة وإحالة للمالي' : 'اعتماد المطابقة وإحالة للمالي', a.fullName, inv.override?.reason ?? dto.note ?? null)];
      await em.save(inv);
      notify = inv;
    });
    if (notify) await this.notify(org, notify, 'اعتُمدت فاتورتكم بعد المطابقة وأُحيلت للإدارة المالية للسداد.');
    return this.get(a, id);
  }

  /** إعادة الفاتورة للمورد (أو لمن سجلها) للتصحيح، أو رفضها */
  async decline(a: OrgUser, id: string, kind: 'return' | 'reject', reason: string) {
    const org = a.organizationId;
    if (!can(a, P.invoices) && !can(a, P.invoicesOverride)) throw new ForbiddenException('لا تملك صلاحية مراجعة الفواتير');
    let notify: PrInvoice | null = null;
    await this.db.transaction(async (em) => {
      const inv = await this.lockInvoice(em, org, id);
      if (inv.status !== 'submitted') throw new ConflictException('الفاتورة لا تنتظر المراجعة');
      if (await this.liveCredits(em, inv)) throw new ConflictException('على الفاتورة إشعار دائن قائم، فيُلغى أو يُرفض أولًا');
      inv.status = kind === 'return' ? 'returned' : 'rejected';
      inv.returnReason = reason;
      inv.log = [...inv.log, logEntry(kind === 'return' ? 'إعادة للتصحيح' : 'رفض الفاتورة', a.fullName, reason)];
      await em.save(inv);
      notify = inv;
    });
    if (notify && (notify as PrInvoice).via === 'portal') {
      await this.notify(org, notify, kind === 'return' ? `أُعيدت فاتورتكم للتصحيح: ${reason}` : `رُفضت الفاتورة: ${reason}`);
    }
    return this.get(a, id);
  }

  /** إلغاء الفاتورة قبل تسجيلها في النظام المالي (يبقى رقمها) */
  async cancel(a: OrgUser, id: string, reason: string) {
    const org = a.organizationId;
    if (!can(a, P.invoices)) throw new ForbiddenException('لا تملك صلاحية إلغاء الفواتير');
    await this.db.transaction(async (em) => {
      const inv = await this.lockInvoice(em, org, id);
      if (!['draft', 'submitted', 'returned', 'approved'].includes(inv.status)) {
        throw new ConflictException(BOOKED_INVOICE.includes(inv.status) ? 'سُجل مستحق الفاتورة في النظام المالي، فيُلغى تسجيلها من مستحقات الموردين أولًا' : 'الفاتورة منتهية');
      }
      if (await this.liveCredits(em, inv)) throw new ConflictException('على الفاتورة إشعار دائن قائم، فيُلغى أو يُرفض أولًا');
      inv.status = 'cancelled';
      inv.returnReason = reason;
      inv.log = [...inv.log, logEntry('إلغاء', a.fullName, reason)];
      await em.save(inv);
    });
    return this.get(a, id);
  }

  async message(a: OrgUser, id: string, text: string) {
    if (!can(a, P.invoices) && !can(a, P.invoicesOverride) && !can(a, ACC.payables)) throw new ForbiddenException('لا تملك صلاحية مراسلة المورد');
    const org = a.organizationId;
    const inv = await this.db.transaction(async (em) => {
      const x = await this.lockInvoice(em, org, id);
      x.messages = [...x.messages, { from: 'staff', byName: a.fullName, text, at: new Date().toISOString() }];
      return em.save(x);
    });
    if (inv.via === 'portal') await this.notify(org, inv, `رد على استفسار الفاتورة: ${text}`);
    return this.get(a, id);
  }

  async addFile(a: OrgUser, id: string, file: Express.Multer.File) {
    if (!can(a, P.invoices)) throw new ForbiddenException('لا تملك صلاحية تسجيل الفواتير');
    const inv = await this.findOrg(a.organizationId, id);
    if (inv.via !== 'staff' || (inv.status !== 'draft' && inv.status !== 'returned')) throw new ConflictException('تُرفق صورة الفاتورة وهي مسودة');
    await this.attach(inv, file, a.fullName);
    return this.get(a, id);
  }

  async removeFile(a: OrgUser, id: string, key: string) {
    if (!can(a, P.invoices)) throw new ForbiddenException('لا تملك صلاحية تسجيل الفواتير');
    const inv = await this.findOrg(a.organizationId, id);
    if (inv.via !== 'staff' || (inv.status !== 'draft' && inv.status !== 'returned')) throw new ConflictException('لا يُحذف المرفق بعد الإرسال');
    await this.detach(inv, key);
    return this.get(a, id);
  }

  async file(a: OrgUser, id: string, key: string) {
    if (!canRead(a)) throw new ForbiddenException('لا تملك صلاحية عرض الفواتير');
    const inv = await this.findOrg(a.organizationId, id);
    const att = inv.attachments.find((x) => x.key.endsWith(`/${key}`));
    if (!att) throw new NotFoundException('المرفق غير موجود');
    return { stream: this.files.open(att.key), mime: att.mime, name: att.name };
  }

  private async attach(inv: PrInvoice, file: Express.Multer.File, byName: string) {
    if (inv.attachments.length >= MAX_FILES) throw new BadRequestException(`الحد الأعلى ${MAX_FILES} مرفقات`);
    const saved = await this.files.save(`${inv.organizationId}/procurement`, file, 'المرفق');
    const att: ItemFile = { key: saved.key, name: saved.name, mime: saved.mime, size: file.size, at: new Date().toISOString(), byName };
    await this.db.query(`UPDATE pr_invoices SET attachments = attachments || $2::jsonb, updated_at = now() WHERE id = $1`, [inv.id, JSON.stringify([att])]);
  }

  private async detach(inv: PrInvoice, key: string) {
    const att = inv.attachments.find((x) => x.key.endsWith(`/${key}`));
    if (!att) throw new NotFoundException('المرفق غير موجود');
    await this.files.remove(att.key).catch(() => undefined);
    await this.db.getRepository(PrInvoice).update({ id: inv.id }, { attachments: inv.attachments.filter((x) => x !== att) });
  }

  private async findOrg(org: string, id: string) {
    const inv = await this.db.getRepository(PrInvoice).findOne({ where: { id, organizationId: org } });
    if (!inv) throw new NotFoundException('الفاتورة غير موجودة');
    return inv;
  }

  // ---------------- العرض ----------------

  async list(a: OrgUser, q: InvoiceListQueryDto) {
    if (!canRead(a)) throw new ForbiddenException('لا تملك صلاحية عرض الفواتير');
    const today = prToday();
    const view = q.view === 'open' ? ['approved', 'posted', 'partial'] : q.view === 'overdue' ? ['posted', 'partial'] : q.view === 'review' ? ['submitted'] : null;
    type Row = { id: string; invoiceNo: number; kind: InvoiceKind; status: InvoiceStatus; dueDate: string | null; total: number; paidAmount: number; creditedAmount: number; orderNo: number } & Record<string, unknown>;
    const rows: Row[] = await this.db.query(
      `SELECT i.id, i.invoice_no AS "invoiceNo", i.kind, i.status, i.supplier_invoice_no AS "supplierInvoiceNo", to_char(i.invoice_date, 'YYYY-MM-DD') AS "invoiceDate",
              to_char(i.due_date, 'YYYY-MM-DD') AS "dueDate", i.total::float AS total, i.paid_amount::float AS "paidAmount", i.credited_amount::float AS "creditedAmount",
              i.via, (i.match->>'ok')::boolean AS "matchOk", jsonb_array_length(COALESCE(i.match->'issues', '[]'::jsonb))::int AS issues, i.override IS NOT NULL AS overridden,
              i.order_id AS "orderId", o.order_no AS "orderNo", s.id AS "supplierId", s.name AS "supplierName",
              (SELECT COALESCE(SUM(v.amount), 0)::float FROM acc_vouchers v WHERE v.source_type = 'procurement' AND v.source_ref = i.id::text AND v.status IN ('draft', 'pending', 'returned')) AS "pendingPay"
         FROM pr_invoices i JOIN pr_orders o ON o.id = i.order_id JOIN pr_suppliers s ON s.id = i.supplier_id
        WHERE i.organization_id = $1 AND ($2::text IS NULL OR i.status = $2) AND ($3::text IS NULL OR i.kind = $3) AND ($4::uuid IS NULL OR i.supplier_id = $4::uuid)
          AND ($5::uuid IS NULL OR i.order_id = $5::uuid) AND ($6::text[] IS NULL OR i.status = ANY($6))
          AND ($7::text IS NULL OR s.name ILIKE '%' || $7 || '%' OR i.supplier_invoice_no ILIKE '%' || $7 || '%'
               OR ('INV-' || LPAD(i.invoice_no::text, 4, '0')) ILIKE '%' || $7 || '%' OR ('PO-' || LPAD(o.order_no::text, 4, '0')) ILIKE '%' || $7 || '%')
          AND ($8::boolean IS NOT TRUE OR i.due_date < $9::date)
        ORDER BY i.invoice_no DESC LIMIT 500`,
      [a.organizationId, q.status || null, q.kind || null, q.supplier || null, q.order || null, view, q.q?.trim() || null, q.view === 'overdue', today]);
    return rows.map((r) => {
      const outstanding = r.kind === 'invoice' ? r2(r.total - r.paidAmount - r.creditedAmount) : 0;
      return {
        ...r, code: invoiceCode(r.kind, r.invoiceNo), kindLabel: INVOICE_KINDS[r.kind], statusLabel: INVOICE_STATUS[r.status],
        orderCode: orderCode(r.orderNo), outstanding,
        overdue: ['posted', 'partial'].includes(r.status) && !!r.dueDate && r.dueDate < today && outstanding > 0,
      };
    });
  }

  /** ما يُفوتر على التعميد: لكل بند المعمد والمستلم المقبول والمفوتر والمتبقي للفوترة */
  async billable(org: string, o: PrOrder, exceptId: string | null = null) {
    const [got, billed, extraLeft] = await Promise.all([this.receipts.receivedByLine(o.id), this.invoicedByLine(o.id, exceptId), this.extraLeft(o.id, exceptId, this.db.manager)]);
    const invoices = await this.db.getRepository(PrInvoice).find({ where: { orderId: o.id, organizationId: org, kind: 'invoice' }, order: { invoiceNo: 'ASC' } });
    return {
      order: { id: o.id, code: orderCode(o.orderNo), title: o.title, status: o.status, statusLabel: ORDER_STATUS[o.status], vatRate: o.vatRate, total: o.total, invoiceable: INVOICEABLE.includes(o.status) },
      extraLeft: Math.max(0, extraLeft),
      lines: o.lines.map((l) => {
        const received = q3(got.get(l.lineId ?? '') ?? 0);
        const invoiced = q3(billed.get(l.lineId ?? '') ?? 0);
        return { orderLineId: l.lineId, description: l.description, ordered: l.qty, received, invoiced, left: Math.max(0, q3(received - invoiced)), unitPrice: l.unitPrice };
      }),
      invoices: invoices.filter((x) => LIVE_INVOICE.includes(x.status)).map((x) => ({
        id: x.id, code: invoiceCode(x.kind, x.invoiceNo), supplierInvoiceNo: x.supplierInvoiceNo, total: x.total, outstanding: r2(x.total - x.paidAmount - x.creditedAmount), status: x.status,
      })),
    };
  }

  async billableForStaff(a: OrgUser, orderId: string) {
    if (!canRead(a)) throw new ForbiddenException('لا تملك صلاحية عرض الفواتير');
    return this.billable(a.organizationId, await this.order(a.organizationId, orderId));
  }

  private async payments(org: string, ids: string[]): Promise<{ id: string; serial: number; voucherDate: string; amount: number; status: string; sourceRef: string; method: string }[]> {
    if (!ids.length) return [];
    return this.db.query(
      `SELECT id, serial, to_char(voucher_date, 'YYYY-MM-DD') AS "voucherDate", amount::float AS amount, status, source_ref AS "sourceRef", method
         FROM acc_vouchers WHERE organization_id = $1 AND source_type = 'procurement' AND source_ref = ANY($2) ORDER BY serial`, [org, ids]);
  }

  private async view(inv: PrInvoice) {
    const org = inv.organizationId;
    const [o, sup, entry, pays, credits, ref] = await Promise.all([
      this.db.getRepository(PrOrder).findOneOrFail({ where: { id: inv.orderId, organizationId: org } }),
      this.db.getRepository(PrSupplier).findOneOrFail({ where: { id: inv.supplierId, organizationId: org } }),
      inv.entryId ? this.db.query(
        `SELECT e.id, e.entry_no AS "entryNo", e.voucher_serial AS serial, e.status, y.name AS year FROM acc_entries e JOIN acc_fiscal_years y ON y.id = e.fiscal_year_id
          WHERE e.organization_id = $1 AND e.id = $2`, [org, inv.entryId]).then((r: { id: string; entryNo: number; serial: number; status: string; year: string }[]) => r[0] ?? null) : null,
      this.payments(org, [inv.id]),
      this.db.getRepository(PrInvoice).find({ where: { refInvoiceId: inv.id, organizationId: org } }),
      inv.refInvoiceId ? this.db.getRepository(PrInvoice).findOne({ where: { id: inv.refInvoiceId, organizationId: org } }) : null,
    ]);
    const pending = r2(pays.filter((p) => ['draft', 'pending', 'returned'].includes(p.status)).reduce((t, p) => t + p.amount, 0));
    const outstanding = inv.kind === 'invoice' ? r2(inv.total - inv.paidAmount - inv.creditedAmount) : 0;
    const live = inv.status === 'draft' || inv.status === 'returned' || inv.status === 'submitted';
    return {
      inv, o, sup, outstanding, pending,
      data: {
        ...inv, code: invoiceCode(inv.kind, inv.invoiceNo), kindLabel: INVOICE_KINDS[inv.kind], statusLabel: INVOICE_STATUS[inv.status],
        order: { id: o.id, code: orderCode(o.orderNo), title: o.title, total: o.total, statusLabel: ORDER_STATUS[o.status] },
        supplier: { id: sup.id, code: supplierCode(sup.supplierNo), name: sup.name, vatNumber: sup.vatNumber },
        ref: ref ? { id: ref.id, code: invoiceCode(ref.kind, ref.invoiceNo), supplierInvoiceNo: ref.supplierInvoiceNo, total: ref.total } : null,
        credits: credits.map((c) => ({ id: c.id, code: invoiceCode(c.kind, c.invoiceNo), total: c.total, status: c.status, statusLabel: INVOICE_STATUS[c.status] })),
        // المطابقة تُعرض محدثة ما دامت الفاتورة قيد المراجعة
        match: live ? await this.match(this.db.manager, inv, await this.core.settings(org)) : inv.match,
        matchIssues: MATCH_ISSUES,
        attachments: inv.attachments.map((x) => ({ key: x.key.split('/').pop(), name: x.name, size: x.size, at: x.at, byName: x.byName })),
        entry: entry ? { id: entry.id, entryNo: entry.entryNo, status: entry.status, voucherNo: `${entry.serial}/${entry.year}` } : null,
        payments: pays.map((p) => ({ ...p, statusLabel: ({ draft: 'مسودة', pending: 'قيد الاعتماد', returned: 'معاد للتعديل', approved: 'معتمد ومرحّل', rejected: 'مرفوض', cancelled: 'ملغي' } as Record<string, string>)[p.status] ?? p.status })),
        outstanding, pendingPay: pending,
        overdue: ['posted', 'partial'].includes(inv.status) && !!inv.dueDate && inv.dueDate < prToday() && outstanding > 0,
      },
    };
  }

  async get(a: OrgUser, id: string) {
    if (!canRead(a)) throw new ForbiddenException('لا تملك صلاحية عرض الفواتير');
    const inv = await this.findOrg(a.organizationId, id);
    const v = await this.view(inv);
    const review = inv.status === 'submitted';
    const staffEdit = inv.via === 'staff' && (inv.status === 'draft' || inv.status === 'returned') && can(a, P.invoices);
    const notMine = a.isSuperadmin || (inv.createdById !== a.id && v.o.createdById !== a.id);
    const fin = a.isSuperadmin || (inv.approvedById !== a.id && inv.createdById !== a.id);
    return {
      ...v.data,
      billable: staffEdit ? await this.billable(a.organizationId, v.o, inv.id) : null,
      can: {
        edit: staffEdit, submit: staffEdit,
        approve: review && notMine && (can(a, P.invoices) || can(a, P.invoicesOverride)),
        override: review && notMine && can(a, P.invoicesOverride),
        decline: review && (can(a, P.invoices) || can(a, P.invoicesOverride)),
        cancel: ['draft', 'submitted', 'returned', 'approved'].includes(inv.status) && can(a, P.invoices),
        message: can(a, P.invoices) || can(a, P.invoicesOverride) || can(a, ACC.payables),
        post: inv.status === 'approved' && can(a, ACC.payables) && fin,
        unpost: BOOKED_INVOICE.includes(inv.status) && inv.paidAmount === 0 && v.pending === 0 && inv.creditedAmount === 0 && can(a, ACC.payables),
        pay: inv.kind === 'invoice' && ['posted', 'partial'].includes(inv.status) && r2(v.outstanding - v.pending) > 0 && can(a, ACC.payments),
        creditNote: inv.kind === 'invoice' && LIVE_INVOICE.includes(inv.status) && can(a, P.invoices),
      },
    };
  }

  // ---------------- النظام المالي: تسجيل المستحق والسداد ----------------

  /** حساب المورد الدائن: حساب شريكه في النظام المالي، وإلا حساب الموردين في إعدادات المشتريات */
  private async payable(em: EntityManager, org: string, sup: PrSupplier, s: PrSettings) {
    const p = sup.accPartnerId ? await em.getRepository(Partner).findOne({ where: { id: sup.accPartnerId, organizationId: org } }) : null;
    const accountId = p?.accountId ?? s.payablesAccountId;
    if (!accountId) throw new BadRequestException(`اربط المورد «${sup.name}» بشريك في النظام المالي له حساب، أو حدد حساب الموردين في إعدادات المشتريات`);
    return { accountId, partnerId: p?.id ?? null };
  }

  /**
   * تسجيل المستحق (النظام المالي): قيد فاتورة مورد مرحّل. البضاعة المستلمة غير المفوترة مدينة بتكلفة الاستلام،
   * وفرق السعر على حساب الفروقات، وضريبة المدخلات على حسابها إن لم تكن جزءًا من التكلفة، والمورد دائن بإجمالي الفاتورة.
   * والإشعار الدائن عكسه، ويخصم من المتبقي على فاتورته الأصلية.
   */
  async post(a: OrgUser, id: string, dto: InvoicePostDto) {
    const org = a.organizationId;
    if (!can(a, ACC.payables)) throw new ForbiddenException('تسجيل مستحقات الموردين للنظام المالي');
    const s = await this.core.settings(org);
    await this.db.transaction(async (em) => {
      const inv = await this.lockInvoice(em, org, id);
      if (inv.status !== 'approved') throw new ConflictException('تُسجل الفاتورة المعتمدة المحالة للمالي فقط');
      if (!a.isSuperadmin && (inv.approvedById === a.id || inv.createdById === a.id || inv.editorIds.includes(a.id))) throw new ForbiddenException('لا يسجل المستحق من سجل الفاتورة أو عدلها أو اعتمد مطابقتها (فصل المهام)');
      if (!s.grniAccountId) throw new BadRequestException('حدد حساب البضاعة المستلمة غير المفوترة في إعدادات المستودعات');
      const o = await em.getRepository(PrOrder).findOneOrFail({ where: { id: inv.orderId, organizationId: org } });
      const sup = await em.getRepository(PrSupplier).findOneOrFail({ where: { id: inv.supplierId, organizationId: org } });
      const pay = await this.payable(em, org, sup, s);
      const factor = s.vatInCost ? 1 + o.vatRate / 100 : 1;
      const extraFactor = s.vatInCost ? 1 + inv.vatRate / 100 : 1;
      const grni = r2(inv.lines.reduce((t, l) => t + r2(l.qty * l.orderPrice * factor), 0) + r2(inv.extraAmount * extraFactor));
      const vatIn = s.vatInCost ? 0 : inv.vat;
      if (vatIn > 0 && !s.vatInputAccountId) throw new BadRequestException('حدد حساب ضريبة المدخلات في إعدادات الفواتير، أو اجعل الضريبة جزءًا من التكلفة');
      // بنود الأصول الثابتة: فرق السعر يُضاف لتكلفة الأصل بدل حساب الفروقات
      const assetParts = await this.assetParts(em, org, inv, factor);
      const assetTotal = r2(assetParts.reduce((t, x) => t + x.amount, 0));
      const variance = r2(inv.total - grni - vatIn - assetTotal);
      if (variance !== 0 && !s.adjustAccountId) throw new BadRequestException('حدد حساب الفروقات في إعدادات المستودعات لتسجيل فرق السعر');
      const code = invoiceCode(inv.kind, inv.invoiceNo);
      const label = `${INVOICE_KINDS[inv.kind]} المورد ${sup.name} رقم ${inv.supplierInvoiceNo} (${code}) على التعميد ${orderCode(o.orderNo)}`.slice(0, 250);
      const sign = inv.kind === 'invoice' ? 1 : -1;
      const raw: { accountId: string; net: number; label: string; partnerId?: string | null; analytic?: boolean }[] = [
        { accountId: s.grniAccountId, net: sign * grni, label },
        ...(vatIn > 0 ? [{ accountId: s.vatInputAccountId!, net: sign * vatIn, label: `ضريبة المدخلات: ${label}`.slice(0, 250) }] : []),
        ...assetParts.flatMap((x) => x.shares.map((sh) => ({ accountId: sh.accountId, net: sign * sh.amount, label: `فرق سعر الأصل ${sh.code} عن التعميد: ${label}`.slice(0, 250) }))),
        ...(variance !== 0 ? [{ accountId: s.adjustAccountId!, net: sign * variance, label: `فرق سعر الفاتورة عن التعميد: ${label}`.slice(0, 250), analytic: true }] : []),
        { accountId: pay.accountId, net: -sign * inv.total, label, partnerId: pay.partnerId },
      ];
      const lines: LineDto[] = raw.filter((l) => r2(l.net) !== 0).map((l) => ({
        accountId: l.accountId, debit: l.net > 0 ? r2(l.net) : 0, credit: l.net < 0 ? r2(-l.net) : 0, label: l.label, partnerId: l.partnerId ?? undefined,
        analytic: l.analytic && s.adjustAnalyticId ? [{ analyticId: s.adjustAnalyticId, percent: 100 }] : [],
      }));
      const date = dto.date ?? inv.invoiceDate;
      if (date > prToday()) throw new BadRequestException('تاريخ القيد في المستقبل');
      const e = await this.entries.createPayableEntry(em, a, { documentDate: date, description: label, counterparty: sup.name }, lines);
      inv.entryId = e.id;
      inv.assetMoveIds = [];
      for (const sh of assetParts.flatMap((x) => x.shares)) {
        const m = await this.assetOps.adjustFromProcurement(em, a, { assetId: sh.assetId, date, amount: sign * sh.amount, entryId: e.id, note: `فرق سعر ${code} (فاتورة المورد ${inv.supplierInvoiceNo}) عن التعميد ${orderCode(o.orderNo)}` });
        if (m) inv.assetMoveIds.push(m);
      }
      await this.chargeDifference(em, a, inv, o);
      inv.status = 'posted';
      inv.postedByName = a.fullName;
      inv.postedAt = new Date();
      inv.log = [...inv.log, logEntry('تسجيل المستحق في النظام المالي', a.fullName, `القيد ${e.entryNo}`)];
      await em.save(inv);
      if (inv.kind === 'credit_note' && inv.refInvoiceId) {
        const ref = await this.lockInvoice(em, org, inv.refInvoiceId);
        if (!['posted', 'partial'].includes(ref.status)) throw new ConflictException('الفاتورة الأصلية غير مسجلة في النظام المالي، فلا يُسجل الإشعار عليها');
        if ((await this.creditableLeft(em, ref)) + 0.005 < inv.total) throw new ConflictException('الإشعار أكبر من المتبقي على الفاتورة الأصلية بعد المسدد وسندات الصرف قيد الاعتماد');
        ref.creditedAmount = r2(ref.creditedAmount + inv.total);
        ref.log = [...ref.log, logEntry('خصم إشعار دائن', a.fullName, `${code} بمبلغ ${inv.total}`)];
        await em.save(ref);
        await this.refresh(em, ref.id);
      }
    });
    return this.get(a, id);
  }

  /** إلغاء تسجيل المستحق: يُلغى القيد وتعود الفاتورة لقائمة المحالة للمالي (إن لم يُسدد منها شيء ولم يُخصم منها إشعار) */
  async unpost(a: OrgUser, id: string, reason: string) {
    const org = a.organizationId;
    if (!can(a, ACC.payables)) throw new ForbiddenException('إلغاء تسجيل المستحقات للنظام المالي');
    await this.db.transaction(async (em) => {
      const inv = await this.lockInvoice(em, org, id);
      if (!BOOKED_INVOICE.includes(inv.status)) throw new ConflictException('الفاتورة غير مسجلة في النظام المالي');
      const [{ n }] = await em.query(
        `SELECT COUNT(*)::int AS n FROM acc_vouchers WHERE organization_id = $1 AND source_type = 'procurement' AND source_ref = $2 AND status NOT IN ('rejected', 'cancelled')`, [org, inv.id]);
      if (n || inv.paidAmount > 0) throw new ConflictException('على الفاتورة سندات صرف، فألغها أولًا من سندات الصرف');
      if (inv.creditedAmount > 0 || (inv.kind === 'invoice' && await this.liveCredits(em, inv))) throw new ConflictException('على الفاتورة إشعار دائن قائم، فيُلغى أو يُلغى تسجيله أولًا');
      if (inv.entryId) await this.entries.cancelPayableEntry(em, a, inv.entryId, `إلغاء تسجيل الفاتورة ${invoiceCode(inv.kind, inv.invoiceNo)}: ${reason}`);
      if (inv.kind === 'credit_note' && inv.refInvoiceId) {
        const ref = await this.lockInvoice(em, org, inv.refInvoiceId);
        ref.creditedAmount = r2(Math.max(0, ref.creditedAmount - inv.total));
        ref.log = [...ref.log, logEntry('إلغاء خصم إشعار دائن', a.fullName, invoiceCode(inv.kind, inv.invoiceNo))];
        await em.save(ref);
        await this.refresh(em, ref.id);
      }
      await this.reverseDifference(em, a, inv);
      await this.assetOps.cancelProcurementAdjustments(em, a, inv.assetMoveIds ?? [], `إلغاء تسجيل الفاتورة ${invoiceCode(inv.kind, inv.invoiceNo)}: ${reason}`);
      inv.assetMoveIds = [];
      inv.entryId = null;
      inv.status = 'approved';
      inv.postedAt = null;
      inv.postedByName = null;
      inv.log = [...inv.log, logEntry('إلغاء تسجيل المستحق', a.fullName, reason)];
      await em.save(inv);
    });
    return this.get(a, id);
  }

  /** فرق السعر لبنود الأصول الثابتة موزعًا على الأصول القائمة المنشأة من استلامها، بحساب مجموعة كل أصل */
  private async assetParts(em: EntityManager, org: string, inv: PrInvoice, factor: number) {
    const out: { lineId: string; amount: number; shares: { assetId: string; code: string; accountId: string; amount: number }[] }[] = [];
    for (const l of inv.lines) {
      const diff = r2(l.qty * (l.unitPrice - l.orderPrice) * factor);
      if (!diff) continue;
      const rows: { id: string; code: string; account: string }[] = await em.query(
        `SELECT a.id, a.code, g.asset_account_id AS account FROM pr_receipts r, jsonb_array_elements(r.lines) rl, jsonb_array_elements_text(rl->'assetIds') x(asset_id)
           JOIN acc_assets a ON a.id = x.asset_id::uuid JOIN acc_asset_groups g ON g.id = a.group_id
          WHERE r.organization_id = $1 AND r.order_id = $2 AND r.status = 'posted' AND rl->>'orderLineId' = $3 AND rl->>'treatment' = 'asset' AND a.status = 'active'
          ORDER BY a.asset_no`, [org, inv.orderId, l.orderLineId]);
      if (!rows.length) continue;
      const n = Math.min(rows.length, Math.max(1, Math.round(l.qty)));
      let rest = diff;
      const shares = rows.slice(0, n).map((x, i) => {
        const amount = i === n - 1 ? rest : r2(diff / n);
        rest = r2(rest - amount);
        return { assetId: x.id, code: x.code, accountId: x.account, amount };
      });
      out.push({ lineId: l.id, amount: diff, shares });
    }
    return out;
  }

  /**
   * ربط الفاتورة بالموازنة: استهلك الاستلام بند الموازنة ومصدر التمويل بأسعار التعميد، فيُحمّل فرق سعر الفاتورة (شامل الضريبة والمصاريف المفوترة)
   * عند تسجيلها: يُفحص مصدر التمويل أولًا، وإن لم يوجد فلا يُسمح بتجاوز المتاح في البند. والفرق السالب (والإشعار الدائن) يُعيد للبند والمصدر.
   */
  private async chargeDifference(em: EntityManager, a: OrgUser, inv: PrInvoice, o: PrOrder) {
    const org = a.organizationId;
    const ratio = o.subtotal > 0 ? o.total / o.subtotal : 1;
    const base = r2(inv.lines.reduce((t, l) => t + l.qty * l.orderPrice, 0) * ratio);
    const diff = r2((inv.kind === 'invoice' ? 1 : -1) * (inv.total - base));
    inv.budgetDiff = 0;
    inv.fundingDiff = 0;
    inv.budgetCommitmentId = null;
    if (!diff || (!o.budgetLineId && !o.fundingBatchId)) return;
    const code = invoiceCode(inv.kind, inv.invoiceNo);
    if (o.fundingBatchId) {
      if (diff > 0) {
        await this.fundraising.reserve(org, o.fundingBatchId, diff, em).catch((e: Error) => { throw new ConflictException(`فرق سعر الفاتورة (${diff}) لا يغطيه مصدر التمويل: ${e.message}`); });
        await this.fundraising.spend(org, o.fundingBatchId, diff, em);
      } else await this.fundraising.unspend(org, o.fundingBatchId, -diff, false, em);
      inv.fundingDiff = diff;
    }
    if (o.budgetLineId) {
      await em.query('SELECT id FROM plan_budget_lines WHERE id = $1 AND organization_id = $2 FOR UPDATE', [o.budgetLineId, org]);
      const line = await this.avail.line(org, o.budgetLineId, em);
      if (diff > 0 && !o.fundingBatchId && line.available < diff) {
        throw new ConflictException(`لا يوجد مصدر تمويل للتعميد، وفرق سعر الفاتورة عن التعميد (${diff}) يتجاوز المتاح في بند الموازنة «${line.name}» (${line.available})`);
      }
      const repo = em.getRepository(BudgetCommitment);
      const row = await repo.save(repo.create({
        organizationId: org, budgetId: line.budgetId, lineId: o.budgetLineId, fundingBatchId: o.fundingBatchId, sourceModule: 'procurement', sourceRef: `${code} ${orderCode(o.orderNo)}`,
        sourceId: inv.id, amount: diff, status: 'consumed', note: `فرق سعر ${INVOICE_KINDS[inv.kind]} المورد عن التعميد`, createdByName: a.fullName,
      }));
      inv.budgetCommitmentId = row.id;
    }
    inv.budgetDiff = diff;
    inv.log = [...inv.log, logEntry(diff > 0 ? 'تحميل فرق السعر على الموازنة' : 'إعادة فرق السعر للموازنة', a.fullName, `${Math.abs(diff)} ريال`)];
  }

  private async reverseDifference(em: EntityManager, a: OrgUser, inv: PrInvoice) {
    const org = a.organizationId;
    const o = await em.getRepository(PrOrder).findOneOrFail({ where: { id: inv.orderId, organizationId: org } });
    if (inv.fundingDiff && o.fundingBatchId) {
      if (inv.fundingDiff > 0) await this.fundraising.unspend(org, o.fundingBatchId, inv.fundingDiff, false, em);
      else {
        await this.fundraising.reserve(org, o.fundingBatchId, -inv.fundingDiff, em);
        await this.fundraising.spend(org, o.fundingBatchId, -inv.fundingDiff, em);
      }
    }
    if (inv.budgetCommitmentId) await em.query(`UPDATE plan_budget_commitments SET status = 'released', updated_at = now() WHERE id = $1 AND organization_id = $2`, [inv.budgetCommitmentId, org]);
    inv.budgetDiff = 0;
    inv.fundingDiff = 0;
    inv.budgetCommitmentId = null;
  }

  /** سند صرف لسداد الفاتورة: يُنشأ في سندات الصرف ويمر بمراحل اعتمادها، ويُحدّث المسدد عند اعتماده النهائي */
  async pay(a: OrgUser, id: string, dto: InvoicePayDto) {
    const org = a.organizationId;
    if (!can(a, ACC.payments)) throw new ForbiddenException('سداد الفواتير بسندات الصرف لمن لديه صلاحية سندات الصرف');
    if (dto.date > prToday()) throw new BadRequestException('تاريخ السند في المستقبل');
    const s = await this.core.settings(org);
    await this.db.transaction(async (em) => {
      const inv = await this.lockInvoice(em, org, id);
      if (inv.kind !== 'invoice' || !['posted', 'partial'].includes(inv.status)) throw new ConflictException('يُسدد المستحق المسجل في النظام المالي فقط');
      const [{ pending }] = await em.query(
        `SELECT COALESCE(SUM(amount), 0)::float AS pending FROM acc_vouchers WHERE organization_id = $1 AND source_type = 'procurement' AND source_ref = $2 AND status IN ('draft', 'pending', 'returned')`,
        [org, inv.id]);
      const left = r2(inv.total - inv.paidAmount - inv.creditedAmount - pending);
      if (dto.amount > left + 0.005) throw new BadRequestException(`المبلغ أكبر من المتبقي للسداد (${left}) بعد السندات قيد الاعتماد`);
      const c = await em.getRepository(CashAccount).findOne({ where: { id: dto.cashAccountId, organizationId: org } });
      if (!c || !c.isActive) throw new BadRequestException('الحساب البنكي أو الصندوق غير موجود أو موقوف');
      if (dto.method === 'bank' && c.kind !== 'bank') throw new BadRequestException('اختر حسابًا بنكيًا');
      if (dto.method === 'cash' && c.kind !== 'cash') throw new BadRequestException('اختر صندوق نقدية');
      const sup = await em.getRepository(PrSupplier).findOneOrFail({ where: { id: inv.supplierId, organizationId: org } });
      const pay = await this.payable(em, org, sup, s);
      const o = await em.getRepository(PrOrder).findOneOrFail({ where: { id: inv.orderId, organizationId: org } });
      const code = invoiceCode(inv.kind, inv.invoiceNo);
      const label = `سداد فاتورة المورد ${sup.name} رقم ${inv.supplierInvoiceNo} (${code}) على التعميد ${orderCode(o.orderNo)}`.slice(0, 250);
      const amount = r2(dto.amount);
      const v = await this.vouchers.insertSystemDraft(em, a, 'payment', {
        voucherDate: dto.date, partyName: sup.name, partnerId: pay.partnerId, amount, purpose: dto.note ? `${label}: ${dto.note}`.slice(0, 600) : label,
        sourceType: 'procurement', sourceRef: inv.id, method: dto.method === 'bank' ? 'transfer' : 'cash', cashAccountId: c.id, counterAccountId: pay.accountId,
        lines: [
          { accountId: pay.accountId, debit: amount, credit: 0, label, partnerId: pay.partnerId ?? undefined, analytic: [] },
          { accountId: c.glAccountId, debit: 0, credit: amount, label, analytic: [] },
        ],
      });
      inv.log = [...inv.log, logEntry('إصدار سند صرف للسداد', a.fullName, `السند ${v.serial} بمبلغ ${amount}`)];
      await em.save(inv);
    });
    return this.get(a, id);
  }

  /** تُبلَّغ الفاتورة بتغير حالة سندات سدادها (اعتماد أو رفض أو إلغاء أو إعادة للمسودة) */
  private async onVoucher(em: EntityManager, v: Voucher) {
    if (!v.sourceRef) return;
    await this.refresh(em, v.sourceRef, v.organizationId);
  }

  /** المسدد = سندات الصرف المعتمدة، والحالة من المتبقي */
  private async refresh(em: EntityManager, id: string, org?: string) {
    const inv = await em.getRepository(PrInvoice).findOne({ where: org ? { id, organizationId: org } : { id } });
    if (!inv || inv.kind !== 'invoice' || !BOOKED_INVOICE.includes(inv.status)) return;
    const [{ paid }] = await em.query(
      `SELECT COALESCE(SUM(amount), 0)::float AS paid FROM acc_vouchers WHERE organization_id = $1 AND source_type = 'procurement' AND source_ref = $2 AND status = 'approved'`,
      [inv.organizationId, inv.id]);
    const left = r2(inv.total - paid - inv.creditedAmount);
    const status: InvoiceStatus = left <= 0.005 ? 'paid' : paid > 0 ? 'partial' : 'posted';
    if (status === inv.status && r2(paid) === inv.paidAmount) return;
    const before = inv.status;
    await em.getRepository(PrInvoice).update({ id: inv.id }, {
      paidAmount: r2(paid), status, log: [...inv.log, logEntry(status === 'paid' ? 'اكتمل السداد' : status === 'partial' ? 'سداد جزئي' : 'تحديث السداد', 'النظام المالي', `المسدد ${r2(paid)}`)],
    });
    if (status !== before && (status === 'paid' || status === 'partial')) {
      await this.notify(inv.organizationId, inv, status === 'paid' ? 'سُددت الفاتورة بالكامل.' : `سُدد جزء من الفاتورة، والمسدد حتى الآن ${r2(paid).toLocaleString('en-US')} ريال.`);
    }
  }

  /** المستحقات للنظام المالي: المحالة للتسجيل، وغير المسددة، والمتأخرة، وأعمار الديون */
  async payables(a: OrgUser) {
    if (!can(a, ACC.payables) && !can(a, ACC.payments)) throw new ForbiddenException('مستحقات الموردين للنظام المالي');
    const rows = await this.list(a, { view: 'open' });
    const today = prToday();
    const age = { current: 0, d30: 0, d60: 0, d90: 0, over: 0 };
    for (const r of rows.filter((x) => x.status !== 'approved' && x.kind === 'invoice')) {
      const days = r.dueDate ? Math.floor((Date.parse(today) - Date.parse(r.dueDate)) / 86400_000) : 0;
      const k = days <= 0 ? 'current' : days <= 30 ? 'd30' : days <= 60 ? 'd60' : days <= 90 ? 'd90' : 'over';
      age[k] = r2(age[k] + r.outstanding);
    }
    const toPost = rows.filter((x) => x.status === 'approved');
    const open = rows.filter((x) => x.status !== 'approved');
    return {
      toPost, open, aging: age,
      totals: {
        toPost: r2(toPost.reduce((t, x) => t + (x.kind === 'invoice' ? x.total : -x.total), 0)),
        outstanding: r2(open.reduce((t, x) => t + x.outstanding, 0)),
        overdue: r2(open.filter((x) => x.overdue).reduce((t, x) => t + x.outstanding, 0)),
      },
    };
  }

  /** حسابات السداد وإعدادات المطابقة للشاشات */
  async lookups(org: string) {
    const s = await this.core.settings(org);
    const cashAccounts = await this.db.query(`SELECT id, name, kind FROM acc_cash_accounts WHERE organization_id = $1 AND is_active ORDER BY kind, name`, [org]);
    return { cashAccounts, settings: { matchTolerancePct: s.matchTolerancePct, vatInputAccountId: s.vatInputAccountId, paymentDays: s.paymentDays, vatInCost: s.vatInCost } };
  }

  // ---------------- كشف حساب المورد ----------------

  /** كشف حساب المورد: الفواتير المسجلة دائنة، والإشعارات الدائنة وسندات السداد المعتمدة مدينة، والرصيد المستحق للمورد بعد كل حركة */
  async statement(org: string, supplierId: string, q: StatementQueryDto) {
    const sup = await this.db.getRepository(PrSupplier).findOne({ where: { id: supplierId, organizationId: org } });
    if (!sup) throw new NotFoundException('المورد غير موجود');
    const rows: { date: string; kind: string; ref: string | null; invoiceNo: number; invKind: InvoiceKind; supplierInvoiceNo: string; orderNo: number; orderId: string; invoiceId: string; debit: number; credit: number; serial: number | null }[] =
      await this.db.query(
        `SELECT * FROM (
           SELECT to_char(e.document_date, 'YYYY-MM-DD') AS date, i.kind, NULL::text AS ref, i.invoice_no AS "invoiceNo", i.kind AS "invKind", i.supplier_invoice_no AS "supplierInvoiceNo",
                  o.order_no AS "orderNo", o.id AS "orderId", i.id AS "invoiceId",
                  CASE WHEN i.kind = 'credit_note' THEN i.total ELSE 0 END::float AS debit, CASE WHEN i.kind = 'invoice' THEN i.total ELSE 0 END::float AS credit, NULL::int AS serial, i.posted_at AS at
             FROM pr_invoices i JOIN pr_orders o ON o.id = i.order_id JOIN acc_entries e ON e.id = i.entry_id
            WHERE i.organization_id = $1 AND i.supplier_id = $2 AND i.status = ANY($3) AND ($4::uuid IS NULL OR i.order_id = $4::uuid)
           UNION ALL
           SELECT to_char(v.voucher_date, 'YYYY-MM-DD'), 'payment', v.source_ref, i.invoice_no, i.kind, i.supplier_invoice_no, o.order_no, o.id, i.id, v.amount::float, 0, v.serial, COALESCE(v.approved_at, v.updated_at)
             FROM acc_vouchers v JOIN pr_invoices i ON i.id::text = v.source_ref JOIN pr_orders o ON o.id = i.order_id
            WHERE v.organization_id = $1 AND i.organization_id = $1 AND v.source_type = 'procurement' AND v.status = 'approved' AND i.supplier_id = $2 AND ($4::uuid IS NULL OR i.order_id = $4::uuid)
         ) x ORDER BY date, at, "invoiceNo"`,
        [org, supplierId, BOOKED_INVOICE, q.order ?? null]);
    const from = q.from ?? null;
    const to = q.to ?? null;
    let opening = 0;
    let balance = 0;
    const lines = [];
    for (const r of rows) {
      if (to && r.date > to) continue;
      if (from && r.date < from) {
        opening = r2(opening + r.credit - r.debit);
        continue;
      }
      if (!lines.length) balance = opening;
      balance = r2(balance + r.credit - r.debit);
      lines.push({
        date: r.date, kind: r.kind, kindLabel: r.kind === 'payment' ? 'سداد بسند صرف' : INVOICE_KINDS[r.kind as InvoiceKind],
        doc: r.kind === 'payment' ? `سند صرف ${r.serial}` : invoiceCode(r.invKind, r.invoiceNo), invoiceId: r.invoiceId, invoiceCode: invoiceCode(r.invKind, r.invoiceNo),
        supplierInvoiceNo: r.supplierInvoiceNo, orderId: r.orderId, orderCode: orderCode(r.orderNo), debit: r.debit, credit: r.credit, balance,
      });
    }
    if (!lines.length) balance = opening;
    const [pend] = await this.db.query(
      `SELECT COALESCE(SUM(CASE WHEN kind = 'credit_note' THEN -total ELSE total END), 0)::float AS t, COUNT(*)::int AS n FROM pr_invoices
        WHERE organization_id = $1 AND supplier_id = $2 AND status IN ('submitted', 'approved')`, [org, supplierId]);
    return {
      supplier: { id: sup.id, code: supplierCode(sup.supplierNo), name: sup.name, vatNumber: sup.vatNumber },
      from, to, opening, lines, closing: balance,
      totals: { debit: r2(lines.reduce((t, l) => t + l.debit, 0)), credit: r2(lines.reduce((t, l) => t + l.credit, 0)) },
      underReview: { amount: pend.t, count: pend.n },
    };
  }

  async staffStatement(a: OrgUser, supplierId: string, q: StatementQueryDto) {
    if (!canRead(a)) throw new ForbiddenException('لا تملك صلاحية كشوف الموردين');
    return this.statement(a.organizationId, supplierId, q);
  }

  // ---------------- الإعدادات ----------------

  async saveSettings(a: OrgUser, dto: InvoiceSettingsDto) {
    const org = a.organizationId;
    await this.core.settings(org);
    await this.core.account(org, dto.vatInputAccountId, 'assets', 'حساب ضريبة المدخلات');
    await this.db.getRepository(PrSettings).update({ organizationId: org }, { matchTolerancePct: dto.matchTolerancePct, vatInputAccountId: dto.vatInputAccountId ?? null, paymentDays: dto.paymentDays });
    return this.core.settings(org);
  }

  // ---------------- بوابة الموردين ----------------

  private portalOk(p: SupplierPortalUser, write = false) {
    if (p.supplierStatus !== 'approved') throw new ForbiddenException('تظهر الفواتير بعد اعتماد حسابكم مورّدًا');
    if (write && !canInvoice(p)) throw new ForbiddenException('رفع الفواتير لمدير الحساب ومستخدم المالية');
  }

  private async portalInvoice(p: SupplierPortalUser, id: string) {
    this.portalOk(p);
    const inv = await this.db.getRepository(PrInvoice).findOne({ where: { id, organizationId: p.organizationId, supplierId: p.supplierId } });
    if (!inv) throw new NotFoundException('الفاتورة غير موجودة');
    return inv;
  }

  async portalList(p: SupplierPortalUser) {
    this.portalOk(p);
    const rows = await this.db.getRepository(PrInvoice).find({ where: { organizationId: p.organizationId, supplierId: p.supplierId }, order: { invoiceNo: 'DESC' } });
    const orders = rows.length ? await this.db.query('SELECT id, order_no AS "orderNo" FROM pr_orders WHERE id = ANY($1)', [[...new Set(rows.map((r) => r.orderId))]]) : [];
    const on = new Map<string, number>(orders.map((o: { id: string; orderNo: number }) => [o.id, o.orderNo]));
    return rows.filter((r) => r.via === 'portal' || r.status !== 'draft').map((r) => ({
      id: r.id, code: invoiceCode(r.kind, r.invoiceNo), kind: r.kind, kindLabel: INVOICE_KINDS[r.kind], supplierInvoiceNo: r.supplierInvoiceNo, invoiceDate: r.invoiceDate,
      dueDate: r.dueDate, total: r.total, paidAmount: r.paidAmount, creditedAmount: r.creditedAmount, outstanding: r.kind === 'invoice' ? r2(r.total - r.paidAmount - r.creditedAmount) : 0,
      status: r.status, statusLabel: INVOICE_STATUS[r.status], orderId: r.orderId, orderCode: orderCode(on.get(r.orderId) ?? 0),
    }));
  }

  /** التعميدات التي يرفع عليها المورد فواتيره */
  async portalBillable(p: SupplierPortalUser, orderId?: string) {
    this.portalOk(p);
    if (orderId) {
      const o = await this.order(p.organizationId, orderId);
      if (o.supplierId !== p.supplierId) throw new NotFoundException('التعميد غير موجود');
      return this.billable(p.organizationId, o);
    }
    const rows = await this.db.getRepository(PrOrder).createQueryBuilder('o')
      .where('o.organization_id = :org AND o.supplier_id = :sid AND o.status IN (:...st)', { org: p.organizationId, sid: p.supplierId, st: INVOICEABLE })
      .orderBy('o.order_no', 'DESC').getMany();
    return rows.map((o) => ({ id: o.id, code: orderCode(o.orderNo), title: o.title, total: o.total, statusLabel: ORDER_STATUS[o.status] }));
  }

  async portalGet(p: SupplierPortalUser, id: string) {
    const inv = await this.portalInvoice(p, id);
    if (inv.via !== 'portal' && inv.status === 'draft') throw new NotFoundException('الفاتورة غير موجودة');
    const v = await this.view(inv);
    const d = v.data;
    const editable = inv.via === 'portal' && (inv.status === 'draft' || inv.status === 'returned') && canInvoice(p);
    return {
      id: d.id, code: d.code, kind: d.kind, kindLabel: d.kindLabel, status: d.status, statusLabel: d.statusLabel, supplierInvoiceNo: d.supplierInvoiceNo, invoiceDate: d.invoiceDate,
      dueDate: d.dueDate, lines: d.lines, extraAmount: d.extraAmount, vatRate: d.vatRate, subtotal: d.subtotal, vat: d.vat, total: d.total, notes: d.notes, returnReason: d.returnReason,
      order: d.order, ref: d.ref, refInvoiceId: d.refInvoiceId, orderId: d.orderId, attachments: d.attachments, messages: d.messages,
      match: d.match ? { ok: d.match.ok, issues: d.match.issues.map((x) => ({ kind: x.kind, message: x.message })) } : null,
      paidAmount: d.paidAmount, creditedAmount: d.creditedAmount, outstanding: d.outstanding,
      payments: d.payments.filter((x) => x.status === 'approved').map((x) => ({ voucherDate: x.voucherDate, amount: x.amount, serial: x.serial })),
      log: d.log.map((x) => ({ action: x.action, at: x.at, note: x.action.startsWith('إعادة') || x.action.startsWith('رفض') ? x.note : null })),
      billable: editable ? await this.billable(p.organizationId, v.o, inv.id) : null,
      can: { edit: editable, submit: editable, cancel: editable && inv.status === 'draft', message: true },
    };
  }

  async portalSave(p: SupplierPortalUser, dto: InvoiceDto, id: string | null) {
    this.portalOk(p, true);
    return this.portalGet(p, await this.save({ kind: 'portal', p }, dto, id));
  }

  async portalSubmit(p: SupplierPortalUser, id: string) {
    this.portalOk(p, true);
    await this.submitInv({ kind: 'portal', p }, id);
    return this.portalGet(p, id);
  }

  /** المورد يلغي مسودته (يبقى رقمها) */
  async portalCancel(p: SupplierPortalUser, id: string) {
    this.portalOk(p, true);
    await this.db.transaction(async (em) => {
      const inv = await this.lockInvoice(em, p.organizationId, id);
      if (inv.supplierId !== p.supplierId || inv.via !== 'portal') throw new NotFoundException('الفاتورة غير موجودة');
      if (inv.status !== 'draft') throw new ConflictException('يلغي المورد المسودة فقط');
      inv.status = 'cancelled';
      inv.log = [...inv.log, logEntry('إلغاء المسودة من البوابة', p.fullName)];
      await em.save(inv);
    });
    return this.portalGet(p, id);
  }

  async portalMessage(p: SupplierPortalUser, id: string, text: string) {
    await this.portalInvoice(p, id);
    await this.db.transaction(async (em) => {
      const x = await this.lockInvoice(em, p.organizationId, id);
      x.messages = [...x.messages, { from: 'supplier', byName: p.fullName, text, at: new Date().toISOString() }];
      await em.save(x);
    });
    return this.portalGet(p, id);
  }

  async portalAddFile(p: SupplierPortalUser, id: string, file: Express.Multer.File) {
    this.portalOk(p, true);
    const inv = await this.portalInvoice(p, id);
    if (inv.via !== 'portal' || (inv.status !== 'draft' && inv.status !== 'returned')) throw new ConflictException('تُرفق الفاتورة وهي مسودة أو معادة للتصحيح');
    await this.attach(inv, file, p.fullName);
    return this.portalGet(p, id);
  }

  async portalRemoveFile(p: SupplierPortalUser, id: string, key: string) {
    this.portalOk(p, true);
    const inv = await this.portalInvoice(p, id);
    if (inv.via !== 'portal' || (inv.status !== 'draft' && inv.status !== 'returned')) throw new ConflictException('لا يُحذف المرفق بعد الإرسال');
    await this.detach(inv, key);
    return this.portalGet(p, id);
  }

  async portalFile(p: SupplierPortalUser, id: string, key: string) {
    const inv = await this.portalInvoice(p, id);
    const att = inv.attachments.find((x) => x.key.endsWith(`/${key}`));
    if (!att) throw new NotFoundException('المرفق غير موجود');
    return { stream: this.files.open(att.key), mime: att.mime, name: att.name };
  }

  async portalStatement(p: SupplierPortalUser, q: StatementQueryDto) {
    this.portalOk(p, true);
    return this.statement(p.organizationId, p.supplierId, q);
  }

  private async notify(org: string, inv: PrInvoice, text: string) {
    await this.sc.notifySuppliers(org, [inv.supplierId], {
      kind: 'supplier-invoice', title: `${INVOICE_KINDS[inv.kind]} رقم ${inv.supplierInvoiceNo}`, dedupe: `invoice:${inv.id}:${inv.status}:${inv.messages.length}:${inv.paidAmount}`,
      path: `/invoices/${inv.id}`, paragraphs: [text], facts: [{ label: 'المبلغ', value: `${inv.total.toLocaleString('en-US')} ريال` }],
    });
  }
}
