import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import { randomUUID } from 'crypto';
import * as QRCode from 'qrcode';
import { DataSource, EntityManager } from 'typeorm';
import { OrgUser } from '../../core/auth/decorators';
import { LineDto } from '../accounting/accounting.dto';
import { ACC_PERMISSIONS as ACC } from '../accounting/accounting.manifest';
import { EntriesService } from '../accounting/entries.service';
import { CashAccount, Voucher } from '../accounting/entities/accounting.entity';
import { VouchersService } from '../accounting/vouchers.service';
import { BILLING_PERMISSIONS as P } from './billing.manifest';
import { CollectDto, DocDto, DocListQueryDto, IssueDto, StatementQueryDto } from './billing.dto';
import {
  BillingCore, LineInput, addDays, addressProblems, blToday, buyerOf, computeDoc, customerCode, diffNote, docCode, fromH, logEntry, qrTlv, r2, toH,
} from './billing-core.service';
import { CatalogService } from './catalog.service';
import { ZatcaService } from './zatca.service';
import {
  BlCustomer, BlDocument, BlItem, BlSettings, BuyerSnapshot, DOC_KINDS, DOC_STATUS, DOC_TYPES, DocKind, DocStatus, DocType, ISSUED, VAT_CATEGORIES, ZATCA_ENVS,
} from './entities/billing.entity';

const can = (a: OrgUser, code: string) => a.isSuperadmin || a.permissions.includes(code);
const READ = [P.read, P.invoices, P.issue, P.reports, P.customers];
export const canReadBilling = (a: OrgUser) => READ.some((x) => can(a, x)) || can(a, ACC.receipts);
/** موظف الفوترة (لا موظف القبض في المالي وحده): يرى رقم هوية المشتري كاملًا */
export const isBillingStaff = (a: OrgUser) => READ.some((x) => can(a, x));
/** إخفاء رقم الهوية أو السجل عن غير موظفي الفوترة: تظهر آخر 4 خانات فقط */
export const maskId = (v: string | null | undefined) => (v ? `${'•'.repeat(Math.max(0, v.length - 4))}${v.slice(-4)}` : v ?? null);
const PENDING_VOUCHER = ['draft', 'pending', 'returned'];

/** المتبقي للتحصيل على الفاتورة: الإجمالي + الإشعارات المدينة − الإشعارات الدائنة − المحصّل */
export const outstandingOf = (d: Pick<BlDocument, 'kind' | 'total' | 'debitedAmount' | 'creditedAmount' | 'paidAmount'>) =>
  d.kind === 'invoice' ? fromH(toH(d.total) + toH(d.debitedAmount) - toH(d.creditedAmount) - toH(d.paidAmount)) : 0;

/**
 * فواتير المبيعات والإشعارات الدائنة والمدينة:
 * مسودة يعدّها موظف الفوترة ← يرسلها للإصدار ← يصدرها موظف آخر (فصل المهام)، فيُسند لها معرّف فريد وعداد متسلسل ورمز QR،
 * وينشئ نظام الفوترة قيدها في النظام المالي (مدين الذمم، دائن الإيراد وضريبة المخرجات). المستند الصادر لا يُعدّل ولا يُلغى،
 * وتصحيحه بإشعار دائن أو مدين. التحصيل بسند قبض في النظام المالي يمر بمراحل اعتماده، فيُحدّث المحصّل عند اعتماده.
 */
@Injectable()
export class DocumentsService implements OnModuleInit {
  constructor(
    private readonly db: DataSource, private readonly core: BillingCore, private readonly catalog: CatalogService,
    private readonly entries: EntriesService, private readonly vouchers: VouchersService, private readonly zatca: ZatcaService,
  ) {}

  onModuleInit() {
    this.vouchers.onStatusChange('billing', (em, v) => this.onVoucher(em, v));
  }

  // ---------------- أدوات ----------------

  private async lock(em: EntityManager, org: string, id: string) {
    const d = await em.getRepository(BlDocument).createQueryBuilder('d').setLock('pessimistic_write').where('d.id = :id AND d.organization_id = :org', { id, org }).getOne();
    if (!d) throw new NotFoundException('المستند غير موجود');
    return d;
  }

  async find(org: string, id: string, em: EntityManager = this.db.manager) {
    const d = await em.getRepository(BlDocument).findOne({ where: { id, organizationId: org } });
    if (!d) throw new NotFoundException('المستند غير موجود');
    return d;
  }

  private async nextNo(em: EntityManager, org: string) {
    await em.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`bl_documents:${org}`]);
    const [{ n }] = await em.query('SELECT COALESCE(MAX(doc_no), 0)::int + 1 AS n FROM bl_documents WHERE organization_id = $1', [org]);
    return n as number;
  }

  /** عداد المستندات الصادرة: يُحجز عند الإصدار بالتسلسل، فلا ينقطع ولا يتكرر */
  private async nextIcv(em: EntityManager, org: string) {
    await em.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`bl_icv:${org}`]);
    const [{ n }] = await em.query('SELECT COALESCE(MAX(icv), 0)::int + 1 AS n FROM bl_documents WHERE organization_id = $1', [org]);
    return n as number;
  }

  /** نوع الفاتورة حسب وضع الجمعية ونوع العميل */
  private resolveType(s: BlSettings, dto: DocDto, customer: BlCustomer | null): DocType {
    if (s.mode === 'unregistered') {
      if (dto.docType && dto.docType !== 'nontax') throw new BadRequestException('الجمعية غير مسجلة في الضريبة، فتصدر فواتير عادية بلا ضريبة');
      return 'nontax';
    }
    if (s.mode === 'off') {
      if (dto.docType) return dto.docType;
      return customer?.kind === 'business' ? 'standard' : 'simplified';
    }
    if (dto.docType === 'nontax') throw new BadRequestException('الجمعية مسجلة في الضريبة، فتصدر فواتير ضريبية أو مبسطة');
    return dto.docType ?? (customer?.kind === 'business' ? 'standard' : 'simplified');
  }

  /** نقص بيانات المشتري للفاتورة الضريبية (B2B): الاسم والعنوان الوطني والرقم الضريبي أو معرّف آخر */
  private buyerProblems(type: DocType, b: BuyerSnapshot | null) {
    if (type !== 'standard') return [];
    if (!b) return ['اختر العميل (الفاتورة الضريبية للمنشآت تلزمها بيانات المشتري)'];
    const out = (b.address?.country ?? 'SA') === 'SA' ? addressProblems(b.address, 'العميل') : [];
    if (!b.vatNumber && !(b.idType && b.idNumber)) out.push('الرقم الضريبي للعميل أو معرّف آخر (السجل التجاري مثلًا)');
    return out;
  }

  /** سطور المستند من المدخلات: الصنف يحدد الفئة والحساب والوصف الافتراضي، وسطور الإشعار الدائن من الفاتورة الأصلية */
  private async buildLines(em: EntityManager, org: string, s: BlSettings, dto: DocDto, ref: BlDocument | null): Promise<LineInput[]> {
    const out: LineInput[] = [];
    for (const [i, l] of dto.lines.entries()) {
      const n = i + 1;
      if (dto.kind === 'credit_note') {
        if (!ref) throw new BadRequestException('اختر الفاتورة الأصلية');
        const rl = ref.lines.find((x) => x.id === l.refLineId);
        if (!rl) throw new BadRequestException(`السطر ${n}: اختر سطرًا من الفاتورة الأصلية`);
        out.push({
          itemId: rl.itemId, description: l.description || rl.description, unit: rl.unit, qty: l.qty, unitPrice: l.unitPrice, discount: l.discount ?? 0,
          category: rl.category, reasonCode: rl.reasonCode, revenueAccountId: rl.revenueAccountId, refLineId: rl.id, rate: rl.rate,
        });
        continue;
      }
      let item: BlItem | null = null;
      if (l.itemId) {
        item = await em.getRepository(BlItem).findOne({ where: { id: l.itemId, organizationId: org } });
        if (!item) throw new BadRequestException(`السطر ${n}: الصنف غير موجود`);
        if (!item.isActive) throw new BadRequestException(`السطر ${n}: الصنف «${item.name}» موقوف`);
      }
      const description = l.description || item?.name;
      if (!description) throw new BadRequestException(`السطر ${n}: اختر الصنف أو اكتب الوصف`);
      const revenueAccountId = item?.revenueAccountId ?? s.revenueAccountId;
      if (!revenueAccountId) throw new BadRequestException('حدد حساب الإيراد الافتراضي في إعدادات الفوترة');
      out.push({
        itemId: item?.id ?? null, description, unit: l.unit ?? item?.unit ?? null, qty: l.qty, unitPrice: l.unitPrice, discount: l.discount ?? 0,
        category: l.category ?? item?.vatCategory ?? 'S', reasonCode: l.reasonCode ?? item?.reasonCode ?? null, revenueAccountId, refLineId: null,
      });
    }
    return out;
  }

  /** الإشعار الدائن لا يتجاوز صافي كل سطر في الفاتورة الأصلية بعد الإشعارات السابقة عليه */
  private async assertCreditLimits(em: EntityManager, ref: BlDocument, doc: Pick<BlDocument, 'lines'>, exceptId: string | null) {
    const rows: { line: string; net: string }[] = await em.query(
      `SELECT l->>'refLineId' AS line, SUM((l->>'net')::numeric) AS net FROM bl_documents d, jsonb_array_elements(d.lines) l
        WHERE d.organization_id = $1 AND d.ref_id = $2 AND d.kind = 'credit_note' AND d.status <> 'cancelled' AND ($3::uuid IS NULL OR d.id <> $3::uuid) GROUP BY 1`,
      [ref.organizationId, ref.id, exceptId]);
    const before = new Map(rows.map((r) => [r.line, toH(r.net)]));
    const mine = new Map<string, number>();
    for (const l of doc.lines) mine.set(l.refLineId!, (mine.get(l.refLineId!) ?? 0) + toH(l.net));
    for (const [lineId, h] of mine) {
      const rl = ref.lines.find((x) => x.id === lineId)!;
      const left = toH(rl.net) - (before.get(lineId) ?? 0);
      if (h > left) throw new BadRequestException(`الإشعار على «${rl.description}» (${fromH(h)}) أكبر من المتبقي في الفاتورة الأصلية (${fromH(Math.max(0, left))})`);
    }
  }

  /**
   * الإشعار الدائن لا يتجاوز المتبقي على الفاتورة بعد التحصيل وسندات القبض قيد الاعتماد،
   * فلا يصير المحصّل أكبر من صافي الفاتورة (لا توجد بعد دورة رد مبالغ للعملاء).
   */
  private async assertCreditRoom(em: EntityManager, ref: BlDocument, totalH: number) {
    const [{ pending }] = await em.query(
      `SELECT COALESCE(SUM(amount), 0)::numeric AS pending FROM acc_vouchers WHERE organization_id = $1 AND source_type = 'billing' AND source_ref = $2 AND status = ANY($3)`,
      [ref.organizationId, ref.id, PENDING_VOUCHER]);
    const roomH = toH(outstandingOf(ref)) - toH(pending);
    if (totalH > roomH) {
      throw new BadRequestException(`الإشعار الدائن (${fromH(totalH)}) أكبر من المتبقي على الفاتورة بعد التحصيل والسندات قيد الاعتماد (${fromH(Math.max(0, roomH))})`);
    }
  }

  // ---------------- الإنشاء والتعديل ----------------

  private async save(a: OrgUser, dto: DocDto, id: string | null) {
    const org = a.organizationId;
    const s = await this.core.settings(org);
    if (s.mode === 'off') throw new BadRequestException('فعّل نظام الفوترة واختر وضع الجمعية الضريبي من الإعدادات أولًا');
    if (dto.dueDate && dto.dueDate < blToday() && !id) throw new BadRequestException('تاريخ الاستحقاق في الماضي');
    if (dto.kind !== 'invoice' && !dto.reason) throw new BadRequestException('اكتب سبب الإشعار');
    await this.core.analytic(org, dto.analyticId);
    return this.db.transaction(async (em) => {
      let ref: BlDocument | null = null;
      let customer: BlCustomer | null = null;
      if (dto.kind !== 'invoice') {
        if (!dto.refId) throw new BadRequestException('اختر الفاتورة الأصلية التي يصدر عليها الإشعار');
        ref = await em.getRepository(BlDocument).findOne({ where: { id: dto.refId, organizationId: org } });
        if (!ref || ref.kind !== 'invoice') throw new BadRequestException('الفاتورة الأصلية غير موجودة');
        if (!ISSUED.includes(ref.status)) throw new ConflictException('يصدر الإشعار على فاتورة صادرة فقط');
        customer = ref.customerId ? await this.catalog.customer(org, ref.customerId, em) : null;
      } else if (dto.customerId) {
        customer = await this.catalog.customer(org, dto.customerId, em);
        if (!customer.isActive) throw new BadRequestException(`العميل «${customer.name}» موقوف`);
      }
      const docType: DocType = ref ? ref.docType : this.resolveType(s, dto, customer);
      const buyer: BuyerSnapshot | null = ref ? ref.buyer : customer ? buyerOf(customer) : dto.buyerName ? { name: dto.buyerName, kind: 'individual', vatNumber: null, idType: null, idNumber: null, address: null, phone: null, email: null } : null;
      const inputs = await this.buildLines(em, org, s, dto, ref);
      const calc = computeDoc(inputs, Number(s.vatRate), docType !== 'nontax');
      if (calc.total <= 0) throw new BadRequestException('إجمالي المستند صفر');
      if (ref && dto.kind === 'credit_note') {
        await this.assertCreditLimits(em, ref, calc, id);
        await this.assertCreditRoom(em, ref, toH(calc.total));
      }
      const body = {
        kind: dto.kind, docType, customerId: customer?.id ?? null, buyer, refId: ref?.id ?? null, reason: dto.kind === 'invoice' ? null : dto.reason ?? null,
        supplyDate: dto.supplyDate ?? null, dueDate: dto.kind === 'credit_note' ? null : dto.dueDate ?? addDays(blToday(), s.paymentDays),
        analyticId: dto.analyticId ?? ref?.analyticId ?? null, notes: dto.notes ?? null, ...calc,
      };
      let d: BlDocument;
      if (id) {
        d = await this.lock(em, org, id);
        if (d.status !== 'draft') throw new ConflictException('لا يُعدّل المستند إلا وهو مسودة');
        if (d.kind !== dto.kind) throw new BadRequestException('لا يتغير نوع المستند بعد إنشائه');
        const snap = (x: BlDocument) => ({ buyer: x.buyer?.name ?? null, docType: x.docType, lines: x.lines.length, taxable: x.taxable, vat: x.vat, total: x.total, dueDate: x.dueDate, reason: x.reason });
        const before = snap(d);
        Object.assign(d, body);
        if (!d.editorIds.includes(a.id)) d.editorIds = [...d.editorIds, a.id];
        d.log = [...d.log, logEntry('تعديل المسودة', a.fullName, diffNote(before, snap(d), {
          buyer: 'المشتري', docType: 'النوع', lines: 'عدد السطور', taxable: 'الصافي', vat: 'الضريبة', total: 'الإجمالي', dueDate: 'الاستحقاق', reason: 'السبب',
        }))];
      } else {
        d = em.create(BlDocument, {
          organizationId: org, docNo: await this.nextNo(em, org), issueDate: blToday(), ...body, status: 'draft', createdById: a.id, createdByName: a.fullName,
          editorIds: [a.id], log: [logEntry(`إنشاء ${DOC_KINDS[dto.kind]}`, a.fullName, ref ? `على ${docCode(ref.kind, ref.docNo)}` : null)],
        });
      }
      const saved = await em.getRepository(BlDocument).save(d);
      return saved.id;
    });
  }

  async create(a: OrgUser, dto: DocDto) {
    if (!can(a, P.invoices)) throw new ForbiddenException('لا تملك صلاحية إنشاء الفواتير');
    return this.get(a, await this.save(a, dto, null));
  }

  async update(a: OrgUser, id: string, dto: DocDto) {
    if (!can(a, P.invoices)) throw new ForbiddenException('لا تملك صلاحية تعديل الفواتير');
    return this.get(a, await this.save(a, dto, id));
  }

  /** إرسال المسودة للإصدار بعد التحقق من اكتمال بياناتها */
  async submit(a: OrgUser, id: string) {
    if (!can(a, P.invoices)) throw new ForbiddenException('لا تملك صلاحية إرسال الفواتير');
    const org = a.organizationId;
    await this.db.transaction(async (em) => {
      const d = await this.lock(em, org, id);
      if (d.status !== 'draft') throw new ConflictException('المستند ليس مسودة');
      const problems = this.buyerProblems(d.docType, d.buyer);
      if (problems.length) throw new BadRequestException(`أكمل بيانات المشتري للفاتورة الضريبية: ${problems.join('، ')}`);
      d.status = 'pending';
      d.returnReason = null;
      if (!d.editorIds.includes(a.id)) d.editorIds = [...d.editorIds, a.id];
      d.log = [...d.log, logEntry('إرسال للإصدار', a.fullName)];
      await em.save(d);
    });
    return this.get(a, id);
  }

  /** إعادة المستند للمسودة للتعديل (من صاحب صلاحية الإصدار) */
  async returnDoc(a: OrgUser, id: string, reason: string) {
    if (!can(a, P.issue)) throw new ForbiddenException('لا تملك صلاحية إصدار الفواتير');
    await this.db.transaction(async (em) => {
      const d = await this.lock(em, a.organizationId, id);
      if (d.status !== 'pending') throw new ConflictException('المستند لا ينتظر الإصدار');
      d.status = 'draft';
      d.returnReason = reason;
      d.log = [...d.log, logEntry('إعادة للتعديل', a.fullName, reason)];
      await em.save(d);
    });
    return this.get(a, id);
  }

  /** إلغاء المسودة أو المستند المنتظر للإصدار (يبقى رقمه). المستند الصادر لا يُلغى، ويُصحح بإشعار دائن */
  async cancel(a: OrgUser, id: string, reason: string) {
    if (!can(a, P.invoices)) throw new ForbiddenException('لا تملك صلاحية إلغاء الفواتير');
    await this.db.transaction(async (em) => {
      const d = await this.lock(em, a.organizationId, id);
      if (ISSUED.includes(d.status)) throw new ConflictException('المستند الصادر لا يُلغى ولا يُحذف. لتصحيحه أصدر إشعارًا دائنًا عليه');
      if (d.status === 'cancelled') throw new ConflictException('المستند ملغى بالفعل');
      d.status = 'cancelled';
      d.returnReason = reason;
      d.log = [...d.log, logEntry('إلغاء قبل الإصدار', a.fullName, reason)];
      await em.save(d);
    });
    return this.get(a, id);
  }

  // ---------------- الإصدار ----------------

  /**
   * إصدار المستند: يُثبت تاريخه ووقته وبيانات البائع والمشتري، ويُسند له المعرّف الفريد والعداد ورمز QR،
   * ويُنشأ قيده في النظام المالي داخل المعاملة نفسها. المصدِر غير من أنشأ المستند أو عدّله أو أرسله.
   */
  async issue(a: OrgUser, id: string, dto: IssueDto) {
    const org = a.organizationId;
    if (!can(a, P.issue)) throw new ForbiddenException('لا تملك صلاحية إصدار الفواتير');
    await this.find(org, id);
    const s = await this.core.settings(org);
    this.core.assertReady(s);
    const today = blToday();
    if (dto.date && s.mode === 'integrated' && dto.date !== today) throw new BadRequestException('بعد الربط مع منصة «فاتورة» يكون تاريخ الإصدار هو اليوم');
    const date = dto.date ?? today;
    if (date > today) throw new BadRequestException('تاريخ الإصدار في المستقبل');
    await this.db.transaction(async (em) => {
      const d = await this.lock(em, org, id);
      if (d.status !== 'pending') throw new ConflictException(d.status === 'draft' ? 'أرسل المستند للإصدار أولًا' : 'المستند لا ينتظر الإصدار');
      if (s.separateIssuer && !a.isSuperadmin && (d.createdById === a.id || d.editorIds.includes(a.id))) throw new ForbiddenException('لا يصدر الموظف مستندًا أنشأه أو عدّله أو أرسله بنفسه (فصل المهام)');
      if (s.mode === 'unregistered' && d.docType !== 'nontax') throw new ConflictException('الجمعية غير مسجلة في الضريبة الآن، فأعد المستند للمسودة وأعد حفظه كفاتورة عادية');
      if (s.mode !== 'unregistered' && d.docType === 'nontax') throw new ConflictException('الجمعية مسجلة في الضريبة الآن، فأعد المستند للمسودة وأعد حفظه كفاتورة ضريبية');
      let ref: BlDocument | null = null;
      if (d.refId) {
        ref = await this.lock(em, org, d.refId);
        if (!ISSUED.includes(ref.status)) throw new ConflictException('الفاتورة الأصلية ليست صادرة');
        if (date < ref.issueDate) throw new BadRequestException('تاريخ الإشعار قبل تاريخ الفاتورة الأصلية');
        if (d.kind === 'credit_note') {
          await this.assertCreditLimits(em, ref, d, d.id);
          await this.assertCreditRoom(em, ref, toH(d.total));
        }
      }
      // بيانات المشتري تُحدّث من ملف العميل لحظة الإصدار (للفاتورة)، وتُؤخذ من الأصلية للإشعار
      let customer: BlCustomer | null = null;
      if (d.customerId) {
        // قفل العميل يمنع إنشاء شريكين له من إصدارين متزامنين، والشريك يُنشأ بعد اجتياز فحوص الإصدار فقط
        customer = await em.getRepository(BlCustomer).createQueryBuilder('c').setLock('pessimistic_write')
          .where('c.id = :id AND c.organization_id = :org', { id: d.customerId, org }).getOne();
        if (!customer) throw new NotFoundException('العميل غير موجود');
      }
      if (d.kind === 'invoice' && customer) d.buyer = buyerOf(customer);
      const problems = this.buyerProblems(d.docType, d.buyer);
      if (problems.length) throw new BadRequestException(`أكمل بيانات المشتري للفاتورة الضريبية: ${problems.join('، ')}`);
      const seller = { name: s.sellerName!, nameEn: s.sellerNameEn, vatNumber: d.docType === 'nontax' ? null : s.vatNumber, idType: s.idType, idNumber: s.idNumber, address: s.address };
      if (customer && s.customerCategoryId) await this.catalog.ensurePartner(em, a, customer, s.customerCategoryId, s.receivablesAccountId!);
      const issuedAt = new Date();
      d.issueDate = date;
      d.issuedAt = issuedAt;
      d.uuid = randomUUID();
      d.icv = await this.nextIcv(em, org);
      // تاريخ الإصدار لا يسبق آخر مستند صادر، فيبقى ترتيب العداد موافقًا لترتيب التواريخ
      const [{ last }] = await em.query(`SELECT to_char(MAX(issue_date), 'YYYY-MM-DD') AS last FROM bl_documents WHERE organization_id = $1 AND icv IS NOT NULL`, [org]);
      if (last && date < last) throw new BadRequestException(`تاريخ الإصدار قبل تاريخ آخر مستند صادر (${last})، فاختر ${last} أو بعده`);
      d.seller = seller;
      d.issuedMode = s.mode;
      d.qr = d.docType !== 'nontax' && s.vatNumber
        ? qrTlv({ seller: s.sellerName!, vatNumber: s.vatNumber, timestamp: `${date}T${issuedAt.toISOString().slice(11, 19)}Z`, total: d.total, vat: d.vat })
        : null;
      // بعد الربط مع «فاتورة»: ملف إلكتروني موقّع وسلسلة بصمات ورمز QR بحقوله التسعة
      const signed = await this.zatca.signOnIssue(em, s, d, ref ? docCode(ref.kind, ref.docNo) : null);
      d.entryId = (await this.postEntry(em, a, s, d, customer)).id;
      d.status = 'issued';
      d.issuedById = a.id;
      d.issuedByName = a.fullName;
      d.log = [...d.log, logEntry(`إصدار ${DOC_KINDS[d.kind]}`, a.fullName, `العداد ${d.icv}${signed ? '، ووُقّع ملفه الإلكتروني' : ''}`)];
      await em.save(d);
      if (ref) {
        if (d.kind === 'credit_note') ref.creditedAmount = fromH(toH(ref.creditedAmount) + toH(d.total));
        else ref.debitedAmount = fromH(toH(ref.debitedAmount) + toH(d.total));
        ref.log = [...ref.log, logEntry(d.kind === 'credit_note' ? 'إشعار دائن عليها' : 'إشعار مدين عليها', a.fullName, `${docCode(d.kind, d.docNo)} بمبلغ ${d.total}`)];
        await em.save(ref);
        await this.refresh(em, ref.id, org);
      }
    });
    return this.get(a, id);
  }

  /**
   * قيد المستند (يملكه نظام الفوترة): الفاتورة والإشعار المدين: مدين الذمم بالإجمالي، ودائن الإيراد لكل حساب وضريبة المخرجات.
   * الإشعار الدائن عكسها. يصدر مرحّلًا بنوع «قيد فاتورة مبيعات» ولا يُعدّل من النظام المالي.
   */
  private async postEntry(em: EntityManager, a: OrgUser, s: BlSettings, d: BlDocument, customer: BlCustomer | null) {
    if (toH(d.vat) > 0 && !s.vatOutputAccountId) throw new BadRequestException('حدد حساب ضريبة المخرجات في إعدادات الفوترة');
    const sign = d.kind === 'credit_note' ? -1 : 1;
    const code = docCode(d.kind, d.docNo);
    const buyer = d.buyer?.name ?? 'عميل نقدي';
    const label = `${DOC_TYPES[d.docType]}${d.kind === 'invoice' ? '' : ` (${DOC_KINDS[d.kind]})`} ${code} للعميل ${buyer}`.slice(0, 250);
    const analytic = d.analyticId ?? s.analyticId;
    const byAccount = new Map<string, number>();
    for (const l of d.lines) byAccount.set(l.revenueAccountId, (byAccount.get(l.revenueAccountId) ?? 0) + toH(l.net));
    const raw: { accountId: string; h: number; label: string; partnerId?: string | null; analytic?: boolean }[] = [
      { accountId: s.receivablesAccountId!, h: sign * toH(d.total), label, partnerId: customer?.partnerId ?? null },
      ...[...byAccount].map(([accountId, h]) => ({ accountId, h: -sign * h, label: `إيراد ${label}`.slice(0, 250), analytic: true })),
      ...(toH(d.vat) > 0 ? [{ accountId: s.vatOutputAccountId!, h: -sign * toH(d.vat), label: `ضريبة القيمة المضافة: ${label}`.slice(0, 250) }] : []),
    ];
    const lines: LineDto[] = raw.filter((l) => l.h !== 0).map((l) => ({
      accountId: l.accountId, debit: l.h > 0 ? fromH(l.h) : 0, credit: l.h < 0 ? fromH(-l.h) : 0, label: l.label, partnerId: l.partnerId ?? undefined,
      analytic: l.analytic && analytic ? [{ analyticId: analytic, percent: 100 }] : [],
    }));
    return this.entries.createBillingEntry(em, a, { documentDate: d.issueDate, description: label, counterparty: buyer }, lines);
  }

  // ---------------- التحصيل ----------------

  /** سند قبض لتحصيل الفاتورة: يُنشأ في سندات القبض بالنظام المالي ويمر بمراحل اعتمادها، ويُحدّث المحصّل عند اعتماده النهائي */
  async collect(a: OrgUser, id: string, dto: CollectDto) {
    const org = a.organizationId;
    if (!can(a, ACC.receipts)) throw new ForbiddenException('التحصيل بسندات القبض لمن لديه صلاحية سندات القبض في النظام المالي');
    await this.find(org, id);
    if (dto.date > blToday()) throw new BadRequestException('تاريخ السند في المستقبل');
    const s = await this.core.settings(org);
    if (!s.receivablesAccountId) throw new BadRequestException('حدد حساب الذمم في إعدادات الفوترة');
    await this.db.transaction(async (em) => {
      const d = await this.lock(em, org, id);
      if (d.kind !== 'invoice' || !['issued', 'partial'].includes(d.status)) throw new ConflictException('يُحصّل على فاتورة صادرة غير محصلة بالكامل');
      if (dto.date < d.issueDate) throw new BadRequestException('تاريخ السند قبل تاريخ الفاتورة');
      const [{ pending }] = await em.query(
        `SELECT COALESCE(SUM(amount), 0)::float AS pending FROM acc_vouchers WHERE organization_id = $1 AND source_type = 'billing' AND source_ref = $2 AND status = ANY($3)`,
        [org, d.id, PENDING_VOUCHER]);
      const left = fromH(toH(outstandingOf(d)) - toH(pending));
      if (toH(dto.amount) > toH(left)) throw new BadRequestException(`المبلغ أكبر من المتبقي للتحصيل (${Math.max(0, left)}) بعد السندات قيد الاعتماد`);
      const c = await em.getRepository(CashAccount).findOne({ where: { id: dto.cashAccountId, organizationId: org } });
      if (!c || !c.isActive) throw new BadRequestException('الحساب البنكي أو الصندوق غير موجود أو موقوف');
      if (dto.method === 'cash' && c.kind !== 'cash') throw new BadRequestException('التحصيل النقدي يكون في صندوق');
      if (dto.method !== 'cash' && c.kind !== 'bank') throw new BadRequestException('التحويل والشبكة يكونان على حساب بنكي');
      const customer = d.customerId ? await this.catalog.customer(org, d.customerId, em) : null;
      const code = docCode(d.kind, d.docNo);
      const label = `تحصيل ${DOC_TYPES[d.docType]} ${code} من ${d.buyer?.name ?? 'عميل نقدي'}`.slice(0, 250);
      const amount = r2(dto.amount);
      const v = await this.vouchers.insertSystemDraft(em, a, 'receipt', {
        voucherDate: dto.date, partyName: d.buyer?.name ?? 'عميل نقدي', partnerId: customer?.partnerId ?? null, amount, purpose: dto.note ? `${label}: ${dto.note}`.slice(0, 600) : label,
        sourceType: 'billing', sourceRef: d.id, method: dto.method, cashAccountId: c.id, counterAccountId: s.receivablesAccountId!,
        lines: [
          { accountId: c.glAccountId, debit: amount, credit: 0, label, analytic: [] },
          { accountId: s.receivablesAccountId!, debit: 0, credit: amount, label, partnerId: customer?.partnerId ?? undefined, analytic: [] },
        ],
      });
      d.log = [...d.log, logEntry('إصدار سند قبض للتحصيل', a.fullName, `السند ${v.serial} بمبلغ ${amount}`)];
      await em.save(d);
    });
    return this.get(a, id);
  }

  private async onVoucher(em: EntityManager, v: Voucher) {
    if (v.sourceRef) await this.refresh(em, v.sourceRef, v.organizationId);
  }

  /** المحصّل = سندات القبض المعتمدة، والحالة من المتبقي */
  private async refresh(em: EntityManager, id: string, org: string) {
    const d = await em.getRepository(BlDocument).findOne({ where: { id, organizationId: org } });
    if (!d || d.kind !== 'invoice' || !ISSUED.includes(d.status)) return;
    const [{ paid }] = await em.query(
      `SELECT COALESCE(SUM(amount), 0)::numeric AS paid FROM acc_vouchers WHERE organization_id = $1 AND source_type = 'billing' AND source_ref = $2 AND status = 'approved'`, [org, d.id]);
    const paidH = toH(paid);
    const leftH = toH(d.total) + toH(d.debitedAmount) - toH(d.creditedAmount) - paidH;
    if (leftH < 0) throw new ConflictException(`لا يُعتمد السند: التحصيل على ${docCode(d.kind, d.docNo)} يتجاوز صافي الفاتورة بعد الإشعارات بمبلغ ${fromH(-leftH)}`);
    const status: DocStatus = leftH <= 0 ? 'paid' : paidH > 0 ? 'partial' : 'issued';
    if (status === d.status && paidH === toH(d.paidAmount)) return;
    await em.getRepository(BlDocument).update({ id: d.id }, {
      paidAmount: fromH(paidH), status,
      log: [...d.log, logEntry(status === 'paid' ? 'اكتمل التحصيل' : status === 'partial' ? 'تحصيل جزئي' : 'تحديث التحصيل', 'النظام المالي', `المحصّل ${fromH(paidH)}`)],
    });
  }

  // ---------------- العرض ----------------

  async list(a: OrgUser, q: DocListQueryDto) {
    if (!canReadBilling(a)) throw new ForbiddenException('لا تملك صلاحية عرض الفواتير');
    const today = blToday();
    const view = q.view === 'pending' ? ['pending'] : q.view === 'drafts' ? ['draft'] : q.view === 'open' || q.view === 'overdue' ? ['issued', 'partial'] : null;
    type Row = BlDocument & { customerName: string | null; refNo: number | null; refKind: DocKind | null; pendingCollect: number };
    const rows: Row[] = await this.db.query(
      `SELECT d.id, d.doc_no AS "docNo", d.kind, d.doc_type AS "docType", d.status, to_char(d.issue_date, 'YYYY-MM-DD') AS "issueDate", to_char(d.due_date, 'YYYY-MM-DD') AS "dueDate",
              d.taxable::float AS taxable, d.vat::float AS vat, d.total::float AS total, d.paid_amount::float AS "paidAmount", d.credited_amount::float AS "creditedAmount",
              d.debited_amount::float AS "debitedAmount", d.icv, d.customer_id AS "customerId", COALESCE(d.buyer->>'name', c.name) AS "customerName",
              r.doc_no AS "refNo", r.kind AS "refKind", d.ref_id AS "refId",
              (SELECT COALESCE(SUM(v.amount), 0)::float FROM acc_vouchers v WHERE v.organization_id = d.organization_id AND v.source_type = 'billing' AND v.source_ref = d.id::text AND v.status IN ('draft', 'pending', 'returned')) AS "pendingCollect"
         FROM bl_documents d LEFT JOIN bl_customers c ON c.id = d.customer_id AND c.organization_id = d.organization_id LEFT JOIN bl_documents r ON r.id = d.ref_id AND r.organization_id = d.organization_id
        WHERE d.organization_id = $1 AND ($2::text IS NULL OR d.status = $2) AND ($3::text IS NULL OR d.kind = $3) AND ($4::text IS NULL OR d.doc_type = $4)
          AND ($5::uuid IS NULL OR d.customer_id = $5::uuid) AND ($6::text[] IS NULL OR d.status = ANY($6))
          AND ($7::text IS NULL OR COALESCE(d.buyer->>'name', c.name, '') ILIKE '%' || $7 || '%' OR LPAD(d.doc_no::text, 6, '0') LIKE '%' || $7 || '%')
          AND ($8::date IS NULL OR d.issue_date >= $8::date) AND ($9::date IS NULL OR d.issue_date <= $9::date)
          AND ($10::boolean IS NOT TRUE OR (d.kind = 'invoice' AND d.due_date < $11::date))
        ORDER BY d.doc_no DESC LIMIT 500`,
      [a.organizationId, q.status || null, q.kind || null, q.docType || null, q.customer || null, view, q.q?.trim() || null, q.from || null, q.to || null, q.view === 'overdue', today]);
    return rows.map((r) => {
      const outstanding = outstandingOf(r);
      return {
        ...r, code: docCode(r.kind, r.docNo), kindLabel: DOC_KINDS[r.kind], typeLabel: DOC_TYPES[r.docType], statusLabel: DOC_STATUS[r.status],
        refCode: r.refNo && r.refKind ? docCode(r.refKind, r.refNo) : null, outstanding,
        overdue: r.kind === 'invoice' && ['issued', 'partial'].includes(r.status) && !!r.dueDate && r.dueDate < today && outstanding > 0,
      };
    });
  }

  async get(a: OrgUser, id: string) {
    if (!canReadBilling(a)) throw new ForbiddenException('لا تملك صلاحية عرض الفواتير');
    const org = a.organizationId;
    const d = await this.find(org, id);
    const [ref, notes, entry, receipts, customer, accounts, analytic] = await Promise.all([
      d.refId ? this.find(org, d.refId) : null,
      d.kind === 'invoice' ? this.db.getRepository(BlDocument).find({ where: { refId: d.id, organizationId: org }, order: { docNo: 'ASC' } }) : Promise.resolve([] as BlDocument[]),
      d.entryId ? this.db.query(
        `SELECT e.id, e.entry_no AS "entryNo", e.voucher_serial AS serial, e.status, y.name AS year FROM acc_entries e JOIN acc_fiscal_years y ON y.id = e.fiscal_year_id
          WHERE e.organization_id = $1 AND e.id = $2`, [org, d.entryId]).then((r: { id: string; entryNo: number; serial: number; status: string; year: string }[]) => r[0] ?? null) : null,
      this.db.query(
        `SELECT id, serial, to_char(voucher_date, 'YYYY-MM-DD') AS "voucherDate", amount::float AS amount, status, method FROM acc_vouchers
          WHERE organization_id = $1 AND source_type = 'billing' AND source_ref = $2 ORDER BY serial`, [org, d.id]) as Promise<{ id: string; serial: number; voucherDate: string; amount: number; status: string; method: string }[]>,
      d.customerId ? this.db.getRepository(BlCustomer).findOne({ where: { id: d.customerId, organizationId: org } }) : null,
      this.db.query('SELECT id, code, name FROM acc_accounts WHERE organization_id = $1 AND id = ANY($2)', [org, [...new Set(d.lines.map((l) => l.revenueAccountId))]]) as Promise<{ id: string; code: string; name: string }[]>,
      d.analyticId ? this.db.query('SELECT id, code, name FROM acc_analytic_accounts WHERE organization_id = $1 AND id = $2', [org, d.analyticId]).then((r: { id: string; code: string; name: string }[]) => r[0] ?? null) : null,
    ]);
    const pendingCollect = fromH(receipts.filter((r) => PENDING_VOUCHER.includes(r.status)).reduce((t, r) => t + toH(r.amount), 0));
    const outstanding = outstandingOf(d);
    const accMap = new Map(accounts.map((x) => [x.id, x]));
    const s = await this.core.settings(org);
    const notMine = !s.separateIssuer || a.isSuperadmin || (d.createdById !== a.id && !d.editorIds.includes(a.id));
    // سطور غيّر فيها المُعدّ الفئة الضريبية عن فئة الصنف: تُعرض للمصدِر قبل قراره
    const itemIds = [...new Set(d.lines.map((l) => l.itemId).filter(Boolean))] as string[];
    const itemCats: { id: string; name: string; vat_category: string }[] = itemIds.length
      ? await this.db.query('SELECT id, name, vat_category FROM bl_items WHERE organization_id = $1 AND id = ANY($2)', [org, itemIds]) : [];
    const categoryOverrides = d.kind === 'credit_note' || d.docType === 'nontax' ? [] : d.lines.flatMap((l) => {
      const it = itemCats.find((x) => x.id === l.itemId);
      return it && it.vat_category !== l.category
        ? [`«${l.description}»: الصنف ${VAT_CATEGORIES[it.vat_category as keyof typeof VAT_CATEGORIES]} وفي الفاتورة ${VAT_CATEGORIES[l.category]}${l.reasonText ? ` (${l.reasonText})` : ''}`] : [];
    });
    const buyer = d.buyer && !isBillingStaff(a) ? { ...d.buyer, idNumber: maskId(d.buyer.idNumber) } : d.buyer;
    const creditable = d.kind === 'invoice' && ISSUED.includes(d.status)
      ? d.lines.map((l) => {
        const used = notes.filter((n) => n.kind === 'credit_note' && n.status !== 'cancelled').flatMap((n) => n.lines).filter((x) => x.refLineId === l.id).reduce((t, x) => t + toH(x.net), 0);
        return { lineId: l.id, description: l.description, qty: l.qty, unitPrice: l.unitPrice, net: l.net, left: fromH(Math.max(0, toH(l.net) - used)) };
      })
      : [];
    return {
      ...d, xml: undefined, hasXml: !!d.xml, signedEnvLabel: d.signedEnv ? ZATCA_ENVS[d.signedEnv] : null, buyer, categoryOverrides, code: docCode(d.kind, d.docNo), kindLabel: DOC_KINDS[d.kind], typeLabel: DOC_TYPES[d.docType], statusLabel: DOC_STATUS[d.status],
      lines: d.lines.map((l) => ({ ...l, categoryLabel: VAT_CATEGORIES[l.category], revenueAccount: accMap.get(l.revenueAccountId) ?? null })),
      qrImage: d.qr ? await QRCode.toDataURL(d.qr, { errorCorrectionLevel: 'M', margin: 1, width: 220 }) : null,
      ref: ref ? { id: ref.id, code: docCode(ref.kind, ref.docNo), issueDate: ref.issueDate, total: ref.total, uuid: ref.uuid } : null,
      adjustments: notes.map((n) => ({ id: n.id, code: docCode(n.kind, n.docNo), kind: n.kind, kindLabel: DOC_KINDS[n.kind], total: n.total, status: n.status, statusLabel: DOC_STATUS[n.status], issueDate: n.issueDate })),
      customer: customer ? { id: customer.id, code: customerCode(customer.customerNo), name: customer.name, kind: customer.kind } : null,
      analytic,
      entry: entry ? { id: entry.id, entryNo: entry.entryNo, status: entry.status, voucherNo: `${entry.serial}/${entry.year}` } : null,
      receipts: receipts.map((r) => ({ ...r, statusLabel: ({ draft: 'مسودة', pending: 'قيد الاعتماد', returned: 'معاد للتعديل', approved: 'معتمد', rejected: 'مرفوض', cancelled: 'ملغي' } as Record<string, string>)[r.status] ?? r.status })),
      outstanding, pendingCollect, creditable,
      overdue: d.kind === 'invoice' && ['issued', 'partial'].includes(d.status) && !!d.dueDate && d.dueDate < blToday() && outstanding > 0,
      buyerProblems: ['draft', 'pending'].includes(d.status) ? this.buyerProblems(d.docType, d.kind === 'invoice' && customer ? buyerOf(customer) : d.buyer) : [],
      terms: s.terms,
      can: {
        edit: d.status === 'draft' && can(a, P.invoices),
        submit: d.status === 'draft' && can(a, P.invoices),
        issue: d.status === 'pending' && can(a, P.issue) && notMine,
        issueBlocked: d.status === 'pending' && can(a, P.issue) && !notMine,
        return: d.status === 'pending' && can(a, P.issue),
        cancel: ['draft', 'pending'].includes(d.status) && can(a, P.invoices),
        collect: d.kind === 'invoice' && ['issued', 'partial'].includes(d.status) && toH(outstanding) - toH(pendingCollect) > 0 && can(a, ACC.receipts),
        creditNote: d.kind === 'invoice' && ISSUED.includes(d.status) && can(a, P.invoices) && creditable.some((x) => x.left > 0),
        debitNote: d.kind === 'invoice' && ISSUED.includes(d.status) && can(a, P.invoices),
      },
    };
  }

  // ---------------- كشف حساب العميل ----------------

  /** كشف حساب العميل: الفواتير والإشعارات المدينة مدينة، والإشعارات الدائنة والتحصيلات المعتمدة دائنة، والرصيد بعد كل حركة */
  async statement(a: OrgUser, customerId: string, q: StatementQueryDto) {
    if (!canReadBilling(a)) throw new ForbiddenException('لا تملك صلاحية كشوف العملاء');
    const org = a.organizationId;
    const c = await this.catalog.customer(org, customerId);
    const rows: { date: string; kind: string; docNo: number; docKind: DocKind; docId: string; debit: number; credit: number; serial: number | null; at: Date }[] = await this.db.query(
      `SELECT * FROM (
         SELECT to_char(d.issue_date, 'YYYY-MM-DD') AS date, d.kind, d.doc_no AS "docNo", d.kind AS "docKind", d.id AS "docId",
                CASE WHEN d.kind = 'credit_note' THEN 0 ELSE d.total END::float AS debit, CASE WHEN d.kind = 'credit_note' THEN d.total ELSE 0 END::float AS credit,
                NULL::int AS serial, d.issued_at AS at
           FROM bl_documents d WHERE d.organization_id = $1 AND d.customer_id = $2 AND d.status = ANY($3)
         UNION ALL
         SELECT to_char(v.voucher_date, 'YYYY-MM-DD'), 'receipt', d.doc_no, d.kind, d.id, 0, v.amount::float, v.serial, COALESCE(v.approved_at, v.updated_at)
           FROM acc_vouchers v JOIN bl_documents d ON d.id::text = v.source_ref AND d.organization_id = v.organization_id
          WHERE v.organization_id = $1 AND v.source_type = 'billing' AND v.status = 'approved' AND d.customer_id = $2
       ) x ORDER BY date, at, "docNo"`, [org, customerId, ISSUED]);
    let opening = 0;
    let balance = 0;
    const lines = [];
    for (const r of rows) {
      if (q.to && r.date > q.to) continue;
      if (q.from && r.date < q.from) {
        opening = r2(opening + r.debit - r.credit);
        continue;
      }
      if (!lines.length) balance = opening;
      balance = r2(balance + r.debit - r.credit);
      lines.push({
        date: r.date, kind: r.kind, kindLabel: r.kind === 'receipt' ? 'تحصيل بسند قبض' : DOC_KINDS[r.kind as DocKind],
        doc: r.kind === 'receipt' ? `سند قبض ${r.serial}` : docCode(r.docKind, r.docNo), docId: r.docId, docCode: docCode(r.docKind, r.docNo), debit: r.debit, credit: r.credit, balance,
      });
    }
    if (!lines.length) balance = opening;
    return {
      customer: { id: c.id, code: customerCode(c.customerNo), name: c.name, vatNumber: c.vatNumber, kind: c.kind },
      from: q.from ?? null, to: q.to ?? null, opening, lines, closing: balance,
      totals: { debit: r2(lines.reduce((t, l) => t + l.debit, 0)), credit: r2(lines.reduce((t, l) => t + l.credit, 0)) },
    };
  }
}
