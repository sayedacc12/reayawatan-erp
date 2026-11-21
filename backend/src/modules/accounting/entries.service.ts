import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Brackets, DataSource, EntityManager, Repository } from 'typeorm';
import { OrgUser } from '../../core/auth/decorators';
import { AccCore, cents, fmtSar, fromCents, monthOf, today, voucherNo } from './acc-core.service';
import { BatchPostDto, EntryDto, EntryUpdateDto, LineDto } from './accounting.dto';
import { ACC_PERMISSIONS as P } from './accounting.manifest';
import { AccountsService } from './accounts.service';
import {
  AnalyticShare, EntrySource, EntryStatus, FiscalYear, JournalEntry, JournalLine, Partner, VoucherInventory, VoucherSequence, VoucherType,
} from './entities/accounting.entity';
import { MastersService } from './masters.service';

export const STATUS_AR: Record<EntryStatus, string> = { draft: 'غير مرحّل', posted: 'مرحّل', cancelled: 'ملغي' };

export interface ListFilters {
  status?: EntryStatus; voucherType?: VoucherType; dateFrom?: string; dateTo?: string; q?: string; fiscalYearId?: string; 
}

/** سطر جاهز للحفظ بعد التحقق */
interface CleanLine { accountId: string; debit: number; credit: number; label: string | null; partnerId: string | null; analytic: AnalyticShare[] }

/**
 * القيود والسندات: الترقيم (رمز القيد الرئيسي ورقم السند)، التحقق من التوازن والحسابات الفرعية والتحليلي،
 * الترحيل المنفرد والجماعي وفك الترحيل، والإلغاء (سند القبض باعتماد ثنائي). لا يُحذف أي قيد بعد حجز رقمه.
 */
/** قيود الأصول الثابتة (الإهلاك والتخريد والتبرع العيني) لا تُعدَّل ولا تُلغى إلا من الأصول الثابتة */
export const STOCK_ONLY = 'هذا القيد سند مخازن صادر من المستودعات، ولا يُعدَّل ولا يُلغى من النظام المالي. يُلغى بإلغاء المستند المصدر في المشتريات والمستودعات';
export const PAYABLES_ONLY = 'هذا القيد قيد فاتورة مورد، ولا يُعدَّل ولا يُلغى من شاشة القيود. يُلغى من شاشة مستحقات الموردين بإلغاء تسجيل الفاتورة';
export const BILLING_ONLY = 'هذا القيد صادر من نظام الفوترة عند إصدار فاتورة أو إشعار، ولا يُعدَّل ولا يُلغى من النظام المالي. التصحيح يكون بإشعار دائن أو مدين من نظام الفوترة';
export const ASSETS_ONLY = 'هذا القيد صادر من الأصول الثابتة، ولا يُعدَّل ولا يُلغى من النظام المالي. يُلغى من سجل حركات الإهلاك أو سجل العمليات في الأصول الثابتة';
const NO_POSTING_OPENING = 'القيد الافتتاحي لا يخضع للترحيل، ويسري أثره بمجرد حفظه';

@Injectable()
export class EntriesService {
  constructor(
    private readonly db: DataSource,
    private readonly core: AccCore,
    private readonly accounts: AccountsService,
    private readonly masters: MastersService,
    @InjectRepository(JournalEntry) private readonly entries: Repository<JournalEntry>,
  ) {}

  // ---------------- القراءة ----------------

  async list(actor: OrgUser, f: ListFilters) {
    const qb = this.entries.createQueryBuilder('e').leftJoinAndSelect('e.fiscalYear', 'y')
      .where('e.organization_id = :org', { org: actor.organizationId });
    if (f.status) qb.andWhere('e.status = :st', { st: f.status });
    if (f.voucherType) qb.andWhere('e.voucher_type = :vt', { vt: f.voucherType });
    if (f.fiscalYearId) qb.andWhere('e.fiscal_year_id = :fy', { fy: f.fiscalYearId });
    if (f.dateFrom) qb.andWhere('e.document_date >= :df', { df: f.dateFrom });
    if (f.dateTo) qb.andWhere('e.document_date <= :dt', { dt: f.dateTo });
    if (f.q) {
      const q = f.q.trim();
      qb.andWhere(new Brackets((w) => {
        w.where('e.description ILIKE :q', { q: `%${q}%` }).orWhere('e.counterparty ILIKE :q', { q: `%${q}%` });
        if (/^\d+$/.test(q)) w.orWhere('e.entry_no = :n OR e.voucher_serial = :n', { n: Number(q) });
      }));
    }
    const rows = await qb.orderBy('e.documentDate', 'DESC').addOrderBy('e.entryNo', 'DESC').take(500).getMany();
    const labels = await this.core.typeLabels(actor.organizationId);
    return rows.map((e) => this.summary(e, labels));
  }

  summary(e: JournalEntry, labels: Record<string, string>) {
    const year = e.fiscalYear?.name ?? 0;
    return {
      id: e.id, entryNo: e.entryNo, voucherType: e.voucherType, voucherLabel: labels[e.voucherType] ?? e.voucherType, voucherSerial: e.voucherSerial,
      voucherNo: voucherNo(e.voucherType, e.voucherSerial, year), fiscalYear: year, fiscalYearId: e.fiscalYearId,
      entryDate: e.entryDate, documentDate: e.documentDate, description: e.description, counterparty: e.counterparty,
      status: e.status, statusLabel: STATUS_AR[e.status], source: e.source, total: e.total, createdByName: e.createdByName,
      postedAt: e.postedAt, postedByName: e.postedByName, cancelledAt: e.cancelledAt, cancelledByName: e.cancelledByName, cancelReason: e.cancelReason,
      voucherId: e.voucherId,
      createdAt: e.createdAt,
    };
  }

  async get(actor: OrgUser, id: string) {
    const e = await this.entries.findOne({
      where: { id, organizationId: actor.organizationId },
      relations: { fiscalYear: true, lines: { account: true, partner: true } },
    });
    if (!e) throw new NotFoundException('القيد غير موجود');
    const analyticIds = [...new Set((e.lines ?? []).flatMap((l) => l.analytic.map((a) => a.analyticId)))];
    const names = analyticIds.length
      ? new Map<string, { code: string; name: string }>((await this.db.query('SELECT id, code, name FROM acc_analytic_accounts WHERE id = ANY($1)', [analyticIds]))
        .map((a: { id: string; code: string; name: string }) => [a.id, a]))
      : new Map();
    const locked = e.fiscalYear?.status === 'closed' || (await this.core.isMonthLocked(e.organizationId, monthOf(e.documentDate)));
    return {
      ...this.summary(e, await this.core.typeLabels(e.organizationId)), periodLocked: locked,
      lines: (e.lines ?? []).sort((a, b) => a.lineNo - b.lineNo).map((l) => ({
        id: l.id, lineNo: l.lineNo, accountId: l.accountId, accountCode: l.account?.code, accountName: l.account?.name,
        requiresAnalytic: l.account?.requiresAnalytic ?? false,
        debit: l.debit, credit: l.credit, label: l.label, partnerId: l.partnerId, partnerName: l.partner?.name ?? null,
        analytic: l.analytic.map((a) => ({ ...a, code: names.get(a.analyticId)?.code ?? '', name: names.get(a.analyticId)?.name ?? '' })),
      })),
    };
  }

  // ---------------- التحقق ----------------

  /**
   * حسابات المخزون المرتبطة بالمستودعات (حسابات مجموعات الأصناف والأصناف، وحسابات المستودعات إن كانت الحسابات على مستوى المستودع):
   * حركاتها تصدر بسندات المخازن فقط، حتى تبقى مطابقة لأرصدة المستودعات.
   */
  async inventoryAccounts(org: string, ids: string[], em: EntityManager): Promise<Set<string>> {
    if (!ids.length) return new Set();
    const rows: { id: string }[] = await em.query(
      `SELECT inventory_account_id AS id FROM pr_item_groups WHERE organization_id = $1 AND inventory_account_id = ANY($2)
       UNION SELECT inventory_account_id FROM pr_items WHERE organization_id = $1 AND inventory_account_id = ANY($2)
       UNION SELECT w.gl_account_id FROM pr_warehouses w JOIN pr_settings s ON s.organization_id = w.organization_id AND s.account_level = 'warehouse'
              WHERE w.organization_id = $1 AND w.gl_account_id = ANY($2)`, [org, ids]).catch(() => []);
    return new Set(rows.map((r) => r.id));
  }

  async cleanLines(org: string, type: VoucherType, lines: LineDto[], em: EntityManager, requireCash = true): Promise<CleanLine[]> {
    const out: CleanLine[] = [];
    const stockAccounts = type === 'stock' ? new Set<string>() : await this.inventoryAccounts(org, [...new Set(lines.map((l) => l.accountId).filter(Boolean))], em);
    let debit = 0;
    let credit = 0;
    for (const [i, l] of lines.entries()) {
      const n = i + 1;
      const d = cents(l.debit);
      const c = cents(l.credit);
      if ((d > 0) === (c > 0)) {
        throw new BadRequestException(`السطر ${n}: يكون السطر مدينًا أو دائنًا فقط. لا يُسجَّل المدين والدائن في سطر واحد، ولكل منهما سطر مستقل`);
      }
      const account = await this.accounts.postable(org, l.accountId, em).catch((e: Error) => {
        throw new BadRequestException(`السطر ${n}: ${e.message}`);
      });
      if (stockAccounts.has(account.id)) {
        throw new BadRequestException(`السطر ${n}: الحساب ${account.code} «${account.name}» حساب مخزون مرتبط بالمستودعات، وحركاته تصدر بسندات المخازن فقط (الاستلام والصرف والجرد والرصيد الافتتاحي للمستودع)، حتى تبقى مطابقة لأرصدة المستودعات`);
      }
      if (type === 'opening' && (account.nature === 'revenue' || account.nature === 'expenses')) {
        throw new BadRequestException(`السطر ${n}: يُمنع وضع أرصدة افتتاحية لحسابات الإيرادات والتبرعات والمصروفات (${account.code} ${account.name})`);
      }
      const analytic = l.analytic ?? [];
      if (account.requiresAnalytic && !analytic.length) {
        throw new BadRequestException(`السطر ${n}: الحساب ${account.code} «${account.name}» يلزمه حساب تحليلي، ولا يُقبل القيد بدونه`);
      }
      if (analytic.length) {
        const seen = new Set<string>();
        let pct = 0;
        for (const a of analytic) {
          if (seen.has(a.analyticId)) throw new BadRequestException(`السطر ${n}: الحساب التحليلي مكرر في السطر نفسه`);
          seen.add(a.analyticId);
          await this.accounts.analyticPostable(org, a.analyticId, em).catch((e: Error) => {
            throw new BadRequestException(`السطر ${n}: ${e.message}`);
          });
          pct += Math.round(a.percent * 100);
        }
        if (pct !== 10000) throw new BadRequestException(`السطر ${n}: مجموع نسب التوزيع التحليلي يجب أن يساوي 100%`);
      }
      if (l.partnerId) {
        const p = await em.getRepository(Partner).findOne({ where: { id: l.partnerId, organizationId: org } });
        if (!p) throw new BadRequestException(`السطر ${n}: الشريك غير موجود`);
        if (!p.isActive) throw new BadRequestException(`السطر ${n}: الشريك «${p.name}» موقوف`);
      }
      debit += d;
      credit += c;
      out.push({
        accountId: l.accountId, debit: fromCents(d), credit: fromCents(c), label: l.label ?? null, partnerId: l.partnerId ?? null,
        analytic: analytic.map((a) => ({ analyticId: a.analyticId, percent: a.percent })),
      });
    }
    if (debit !== credit) throw new BadRequestException(`القيد غير متوازن: مجموع المدين ${fmtSar(debit)} ومجموع الدائن ${fmtSar(credit)}`);
    if ((type === 'receipt' || type === 'payment') && requireCash) {
      const cash = await this.masters.cashGlIds(org);
      const side = type === 'receipt' ? 'debit' : 'credit';
      if (!out.some((l) => cash.has(l.accountId) && l[side] > 0)) {
        throw new BadRequestException(type === 'receipt'
          ? 'سند القبض يجب أن يكون فيه سطر مدين على حساب بنك أو صندوق معرّف في شاشة البنوك والنقدية'
          : 'سند الصرف يجب أن يكون فيه سطر دائن على حساب بنك أو صندوق معرّف في شاشة البنوك والنقدية');
      }
    }
    return out;
  }

  /** لا تُقبل سندات جديدة في سنة لها محضر جرد سندات معتمد (حتى لا تخرج عن مداه) */
  async assertNoApprovedInventory(em: EntityManager, year: FiscalYear) {
    const inv = await em.getRepository(VoucherInventory).findOne({ where: { fiscalYearId: year.id } });
    if (inv?.status === 'approved') {
      throw new ConflictException(`اعتُمد محضر جرد السندات للسنة ${year.name}، فلا تُقبل سندات جديدة خارج مداه. ألغِ اعتماد المحضر أولًا إن لزم`);
    }
  }

  /** حجز رقم السند التالي في تسلسل نوعه (رمز 2) */
  async reserveSerial(em: EntityManager, year: FiscalYear, type: VoucherType) {
    const repo = em.getRepository(VoucherSequence);
    let seq = await repo.createQueryBuilder('s').setLock('pessimistic_write')
      .where('s.fiscal_year_id = :y AND s.voucher_type = :t', { y: year.id, t: type }).getOne();
    if (!seq) {
      await repo.createQueryBuilder().insert().values({ organizationId: year.organizationId, fiscalYearId: year.id, voucherType: type, startSerial: 1, nextSerial: 1 })
        .orIgnore().execute();
      seq = await repo.createQueryBuilder('s').setLock('pessimistic_write')
        .where('s.fiscal_year_id = :y AND s.voucher_type = :t', { y: year.id, t: type }).getOneOrFail();
    }
    if (seq.endSerial !== null && seq.nextSerial > seq.endSerial) {
      const label = (await this.core.typeLabels(year.organizationId, em))[type] ?? type;
      throw new ConflictException(`انتهى المدى المحدد لـ${label} في السنة ${year.name} (حتى الرقم ${seq.endSerial}). عدّل المدى من شاشة الافتتاحيات`);
    }
    const serial = seq.nextSerial;
    await repo.update({ id: seq.id }, { nextSerial: serial + 1 });
    return serial;
  }

  // ---------------- الإنشاء والتعديل ----------------

  async create(actor: OrgUser, dto: EntryDto) {
    const org = actor.organizationId;
    if (dto.post && dto.voucherType !== 'opening' && !actor.permissions.includes(P.post)) throw new ForbiddenException('ليست لديك صلاحية ترحيل القيود');
    const id = await this.db.transaction(async (em) => {
      if (dto.voucherType === 'receipt' || dto.voucherType === 'payment') {
        throw new BadRequestException('سندات القبض والصرف تُنشأ من شاشتيها، وتصدر قيودها تلقائيًا عند الاعتماد النهائي');
      }
      await this.core.assertManualType(org, dto.voucherType, em);
      const year = await this.core.assertWritable(org, dto.documentDate, em);
      if (dto.voucherType === 'opening' && !year.isFirst) {
        throw new BadRequestException('القيد الافتتاحي اليدوي للسنة المالية الأولى فقط، وفي السنوات التالية ينشئه النظام عند فتح السنة الجديدة');
      }
      await this.assertNoApprovedInventory(em, year);
      const lines = await this.cleanLines(org, dto.voucherType, dto.lines, em);
      const entry = await this.insert(em, actor, year, dto.voucherType, {
        documentDate: dto.documentDate, description: dto.description, counterparty: dto.counterparty ?? null,
      // القيد الافتتاحي لا يخضع للترحيل: يسري أثره بمجرد حفظه
      }, lines, dto.post || dto.voucherType === 'opening' ? 'posted' : 'draft');
      return entry.id;
    });
    return this.get(actor, id);
  }

  private async insert(
    em: EntityManager, actor: { id: string | null; fullName: string }, year: FiscalYear, type: VoucherType,
    head: { documentDate: string; description: string; counterparty: string | null }, lines: CleanLine[], status: EntryStatus,
    source: EntrySource = 'manual', fromVoucher?: { id: string; serial: number },
  ) {
    const org = year.organizationId;
    const entryNo = await this.core.nextEntryNo(em, org);
    const serial = fromVoucher ? fromVoucher.serial : await this.reserveSerial(em, year, type);
    const total = lines.reduce((s, l) => s + cents(l.debit), 0);
    const entry = await em.getRepository(JournalEntry).save(em.create(JournalEntry, {
      organizationId: org, entryNo, fiscalYearId: year.id, voucherType: type, voucherSerial: serial, entryDate: today(),
      documentDate: head.documentDate, description: head.description, counterparty: head.counterparty, status, source,
      total: fromCents(total), createdById: actor.id, createdByName: actor.fullName, voucherId: fromVoucher?.id ?? null,
      ...(status === 'posted' ? { postedAt: new Date(), postedByName: actor.fullName } : {}),
    }));
    await this.saveLines(em, org, entry.id, lines);
    return entry;
  }

  private async saveLines(em: EntityManager, org: string, entryId: string, lines: CleanLine[]) {
    await em.getRepository(JournalLine).save(lines.map((l, i) => em.create(JournalLine, { organizationId: org, entryId, lineNo: i + 1, ...l })));
  }

  /** قيد سند القبض أو الصرف عند اعتماده النهائي: مرحّل مباشرة وبرقم السند نفسه */
  async createVoucherEntry(
    em: EntityManager, actor: OrgUser, year: FiscalYear, type: 'receipt' | 'payment', voucher: { id: string; serial: number },
    head: { documentDate: string; description: string; counterparty: string | null }, lines: LineDto[], requireCash = true,
  ) {
    await this.core.assertWritable(year.organizationId, head.documentDate, em);
    const clean = await this.cleanLines(year.organizationId, type, lines, em, requireCash);
    return this.insert(em, actor, year, type, head, clean, 'posted', 'voucher', voucher);
  }

  /** عكس قيد السند: يبقى رقمه ويُكتب عليه «ملغي» مع السبب */
  async reverseVoucherEntry(em: EntityManager, actor: OrgUser, entryId: string, reason: string) {
    const e = await this.load(em, actor.organizationId, entryId);
    if (e.status === 'cancelled') return;
    await this.core.assertWritable(e.organizationId, e.documentDate, em);
    await em.getRepository(JournalEntry).update({ id: e.id }, { status: 'cancelled', cancelledAt: new Date(), cancelledByName: actor.fullName, cancelReason: reason });
  }

  /** قيد آلي (القيد الافتتاحي للسنة الجديدة): مرحّل مباشرة */
  async createSystemEntry(em: EntityManager, actor: OrgUser, year: FiscalYear, type: VoucherType, head: { documentDate: string; description: string }, lines: CleanLine[]) {
    return this.insert(em, actor, year, type, { ...head, counterparty: null }, lines, 'posted', 'system');
  }

  /** قيد من الأصول الثابتة (سند إهلاك أو سند أصول): مرحّل مباشرة ولا يُعدَّل من النظام المالي */
  async createAssetEntry(
    em: EntityManager, actor: { id: string | null; fullName: string; organizationId: string }, type: 'depreciation' | 'asset',
    head: { documentDate: string; description: string; counterparty?: string | null }, lines: LineDto[],
  ) {
    const year = await this.core.assertWritable(actor.organizationId, head.documentDate, em);
    await this.assertNoApprovedInventory(em, year);
    const clean = await this.cleanLines(actor.organizationId, type, lines, em);
    return this.insert(em, actor, year, type, { ...head, counterparty: head.counterparty ?? null }, clean, 'posted', 'assets');
  }

  /** إلغاء قيد صادر من الأصول الثابتة: يبقى رقمه ويُكتب عليه «ملغي» مع السبب */
  async cancelAssetEntry(em: EntityManager, actor: { fullName: string; organizationId: string }, entryId: string, reason: string) {
    const e = await this.load(em, actor.organizationId, entryId);
    if (e.status === 'cancelled') return;
    if (e.source !== 'assets') throw new ConflictException('القيد ليس من الأصول الثابتة');
    await this.core.assertWritable(e.organizationId, e.documentDate, em);
    await em.getRepository(JournalEntry).update({ id: e.id }, { status: 'cancelled', cancelledAt: new Date(), cancelledByName: actor.fullName, cancelReason: reason });
  }

  /** سند مخازن من المستودعات: مرحّل مباشرة، ولا يُعدَّل ولا يُلغى من النظام المالي */
  async createStockEntry(
    em: EntityManager, actor: { id: string | null; fullName: string; organizationId: string },
    head: { documentDate: string; description: string; counterparty?: string | null }, lines: LineDto[],
  ) {
    const year = await this.core.assertWritable(actor.organizationId, head.documentDate, em);
    await this.assertNoApprovedInventory(em, year);
    const clean = await this.cleanLines(actor.organizationId, 'stock', lines, em);
    return this.insert(em, actor, year, 'stock', { ...head, counterparty: head.counterparty ?? null }, clean, 'posted', 'stock');
  }

  /** إلغاء سند مخازن بإلغاء مستنده في المستودعات: يبقى رقمه ويُكتب عليه «ملغي» مع السبب */
  async cancelStockEntry(em: EntityManager, actor: { fullName: string; organizationId: string }, entryId: string, reason: string) {
    const e = await this.load(em, actor.organizationId, entryId);
    if (e.status === 'cancelled') return;
    if (e.source !== 'stock') throw new ConflictException('القيد ليس سند مخازن');
    await this.core.assertWritable(e.organizationId, e.documentDate, em);
    await em.getRepository(JournalEntry).update({ id: e.id }, { status: 'cancelled', cancelledAt: new Date(), cancelledByName: actor.fullName, cancelReason: reason });
  }

  /** قيد فاتورة مورد يسجله المالي من مستحقات الموردين: مرحّل مباشرة، ولا يُعدَّل ولا يُلغى من شاشة القيود */
  async createPayableEntry(
    em: EntityManager, actor: { id: string | null; fullName: string; organizationId: string },
    head: { documentDate: string; description: string; counterparty?: string | null }, lines: LineDto[],
  ) {
    const year = await this.core.assertWritable(actor.organizationId, head.documentDate, em);
    await this.assertNoApprovedInventory(em, year);
    const clean = await this.cleanLines(actor.organizationId, 'bill', lines, em);
    return this.insert(em, actor, year, 'bill', { ...head, counterparty: head.counterparty ?? null }, clean, 'posted', 'payables');
  }

  /** إلغاء قيد فاتورة مورد من مستحقات الموردين: يبقى رقمه ويُكتب عليه «ملغي» مع السبب */
  async cancelPayableEntry(em: EntityManager, actor: { fullName: string; organizationId: string }, entryId: string, reason: string) {
    const e = await this.load(em, actor.organizationId, entryId);
    if (e.status === 'cancelled') return;
    if (e.source !== 'payables') throw new ConflictException('القيد ليس قيد فاتورة مورد');
    await this.core.assertWritable(e.organizationId, e.documentDate, em);
    await em.getRepository(JournalEntry).update({ id: e.id }, { status: 'cancelled', cancelledAt: new Date(), cancelledByName: actor.fullName, cancelReason: reason });
  }

  /** قيد فاتورة مبيعات أو إشعار يصدره نظام الفوترة عند الإصدار: مرحّل مباشرة، ولا يُعدَّل ولا يُلغى من النظام المالي */
  async createBillingEntry(
    em: EntityManager, actor: { id: string | null; fullName: string; organizationId: string },
    head: { documentDate: string; description: string; counterparty?: string | null }, lines: LineDto[],
  ) {
    const year = await this.core.assertWritable(actor.organizationId, head.documentDate, em);
    await this.assertNoApprovedInventory(em, year);
    const clean = await this.cleanLines(actor.organizationId, 'sale', lines, em);
    return this.insert(em, actor, year, 'sale', { ...head, counterparty: head.counterparty ?? null }, clean, 'posted', 'billing');
  }

  private async load(em: EntityManager, org: string, id: string, lock = true) {
    const qb = em.getRepository(JournalEntry).createQueryBuilder('e').where('e.id = :id AND e.organization_id = :org', { id, org });
    if (lock) qb.setLock('pessimistic_write');
    const e = await qb.getOne();
    if (!e) throw new NotFoundException('القيد غير موجود');
    return e;
  }

  async update(actor: OrgUser, id: string, dto: EntryUpdateDto) {
    const org = actor.organizationId;
    await this.db.transaction(async (em) => {
      const e = await this.load(em, org, id);
      const editableOpening = e.voucherType === 'opening' && e.status === 'posted';
      if (e.status !== 'draft' && !editableOpening) throw new ConflictException(e.status === 'posted' ? 'القيود المرحّلة لا تُعدَّل. فك الترحيل أولًا إن كان الشهر مفتوحًا' : 'القيد ملغي');
      if (e.source !== 'manual') throw new ConflictException(e.source === 'voucher' ? 'هذا القيد ناتج عن سند، ويُعدَّل من شاشة السند بإعادته للمسودة' : e.source === 'assets' ? ASSETS_ONLY : e.source === 'stock' ? STOCK_ONLY : e.source === 'payables' ? PAYABLES_ONLY : e.source === 'billing' ? BILLING_ONLY : 'القيد الافتتاحي الآلي لا يُعدَّل يدويًا');
      await this.core.assertWritable(org, e.documentDate, em);
      const year = await this.core.assertWritable(org, dto.documentDate, em);
      if (year.id !== e.fiscalYearId) throw new BadRequestException('لا يمكن نقل المستند إلى سنة مالية أخرى، لأن رقم السند محجوز في سنته');
      const lines = await this.cleanLines(org, e.voucherType, dto.lines, em);
      await em.getRepository(JournalLine).delete({ entryId: id });
      await this.saveLines(em, org, id, lines);
      await em.getRepository(JournalEntry).update({ id }, {
        documentDate: dto.documentDate, description: dto.description, counterparty: dto.counterparty ?? null,
        total: fromCents(lines.reduce((s, l) => s + cents(l.debit), 0)),
      });
    });
    return this.get(actor, id);
  }

  // ---------------- الترحيل ----------------

  private async postOne(em: EntityManager, actor: OrgUser, e: JournalEntry) {
    if (e.voucherType === 'opening') throw new ConflictException(NO_POSTING_OPENING);
    if (e.status !== 'draft') throw new ConflictException(e.status === 'posted' ? 'القيد مرحّل بالفعل' : 'القيد ملغي');
    await this.core.assertWritable(e.organizationId, e.documentDate, em);
    // إعادة التحقق من الحسابات (قد يكون أحدها أوقف بعد الحفظ)
    const lines = await em.getRepository(JournalLine).find({ where: { entryId: e.id } });
    for (const l of lines) await this.accounts.postable(e.organizationId, l.accountId, em);
    await em.getRepository(JournalEntry).update({ id: e.id }, { status: 'posted', postedAt: new Date(), postedByName: actor.fullName });
  }

  async post(actor: OrgUser, id: string) {
    await this.db.transaction(async (em) => this.postOne(em, actor, await this.load(em, actor.organizationId, id)));
    return this.get(actor, id);
  }

  /** الترحيل الجماعي: خلال فترة من - إلى، وحسب نوع السند ومدى أرقامه */
  async batchPost(actor: OrgUser, dto: BatchPostDto) {
    const org = actor.organizationId;
    if (dto.dateFrom > dto.dateTo) throw new BadRequestException('تاريخ البداية بعد تاريخ النهاية');
    if ((dto.serialFrom || dto.serialTo) && !dto.voucherType) throw new BadRequestException('حدد نوع السند للترحيل بمدى الأرقام');
    const qb = this.entries.createQueryBuilder('e').leftJoinAndSelect('e.fiscalYear', 'y')
      .where(`e.organization_id = :org AND e.status = 'draft' AND e.document_date BETWEEN :df AND :dt`, { org, df: dto.dateFrom, dt: dto.dateTo });
    if (dto.voucherType === 'opening') throw new BadRequestException(NO_POSTING_OPENING);
    qb.andWhere(`e.voucher_type <> 'opening'`);
    if (dto.voucherType) qb.andWhere('e.voucher_type = :vt', { vt: dto.voucherType });
    if (dto.serialFrom) qb.andWhere('e.voucher_serial >= :sf', { sf: dto.serialFrom });
    if (dto.serialTo) qb.andWhere('e.voucher_serial <= :st', { st: dto.serialTo });
    const rows = await qb.orderBy('e.documentDate', 'ASC').addOrderBy('e.entryNo', 'ASC').getMany();
    const labels = await this.core.typeLabels(org);
    if (dto.preview) return { candidates: rows.map((e) => this.summary(e, labels)), pendingVouchers: await this.pendingVouchers(org, dto), posted: 0, failed: [] };
    let posted = 0;
    const failed: { entryNo: number; voucherNo: string; reason: string }[] = [];
    for (const e of rows) {
      try {
        await this.db.transaction(async (em) => this.postOne(em, actor, await this.load(em, org, e.id)));
        posted++;
      } catch (err) {
        failed.push({ entryNo: e.entryNo, voucherNo: voucherNo(e.voucherType, e.voucherSerial, e.fiscalYear?.name ?? 0), reason: (err as Error).message });
      }
    }
    return { candidates: [], posted, failed };
  }

  async unpost(actor: OrgUser, id: string) {
    await this.db.transaction(async (em) => {
      const e = await this.load(em, actor.organizationId, id);
      if (e.voucherType === 'opening') throw new ConflictException(NO_POSTING_OPENING);
      if (e.status !== 'posted') throw new ConflictException('القيد غير مرحّل');
      if (e.source !== 'manual') throw new ConflictException(e.source === 'voucher' ? 'هذا القيد ناتج عن سند، ويُعكس من شاشة السند بإعادته للمسودة' : e.source === 'assets' ? ASSETS_ONLY : e.source === 'stock' ? STOCK_ONLY : e.source === 'payables' ? PAYABLES_ONLY : e.source === 'billing' ? BILLING_ONLY : 'القيد الافتتاحي الآلي لا يُفك ترحيله، ويُحدَّث من شاشة الافتتاحيات');
      await this.core.assertWritable(e.organizationId, e.documentDate, em);
      await em.getRepository(JournalEntry).update({ id }, { status: 'draft', postedAt: null, postedByName: null });
    });
    return this.get(actor, id);
  }

  // ---------------- الإلغاء ----------------

  /** إلغاء القيد اليدوي: يبقى رقمه ويُكتب عليه «ملغي» */
  async cancel(actor: OrgUser, id: string, reason: string) {
    await this.db.transaction(async (em) => {
      const e = await this.load(em, actor.organizationId, id);
      if (e.status === 'cancelled') throw new ConflictException('القيد ملغي بالفعل');
      if (e.source !== 'manual') throw new ConflictException(e.source === 'voucher' ? 'هذا القيد ناتج عن سند، ويُلغى من شاشة السند' : e.source === 'assets' ? ASSETS_ONLY : e.source === 'stock' ? STOCK_ONLY : e.source === 'payables' ? PAYABLES_ONLY : e.source === 'billing' ? BILLING_ONLY : 'القيد الافتتاحي الآلي لا يُلغى يدويًا');
      await this.core.assertWritable(e.organizationId, e.documentDate, em);
      await em.getRepository(JournalEntry).update({ id }, { status: 'cancelled', cancelledAt: new Date(), cancelledByName: actor.fullName, cancelReason: reason });
    });
    return this.get(actor, id);
  }

  /** سندات القبض والصرف التي لم يكتمل اعتمادها: تُرحَّل تلقائيًا عند اعتمادها النهائي، فتُعرض في شاشة الترحيل للمتابعة */
  private async pendingVouchers(org: string, dto: BatchPostDto) {
    if (dto.voucherType && dto.voucherType !== 'receipt' && dto.voucherType !== 'payment') return [];
    const rows: { id: string; kind: string; serial: number; voucher_date: string; party_name: string; amount: string; status: string; request_kind: string | null; year: number }[] = await this.db.query(
      `SELECT v.id, v.kind, v.serial, to_char(v.voucher_date, 'YYYY-MM-DD') AS voucher_date, v.party_name, v.amount, v.status, v.request_kind, y.name AS year
         FROM acc_vouchers v JOIN acc_fiscal_years y ON y.id = v.fiscal_year_id
        WHERE v.organization_id = $1 AND v.voucher_date BETWEEN $2 AND $3 AND ($4::text IS NULL OR v.kind = $4)
          AND ($5::int IS NULL OR v.serial >= $5) AND ($6::int IS NULL OR v.serial <= $6)
          AND (v.status IN ('draft', 'pending', 'returned') OR v.request_kind IS NOT NULL)
        ORDER BY v.voucher_date, v.serial`,
      [org, dto.dateFrom, dto.dateTo, dto.voucherType ?? null, dto.serialFrom ?? null, dto.serialTo ?? null]);
    return rows.map((v) => ({
      id: v.id, kind: v.kind, voucherNo: voucherNo(v.kind as VoucherType, v.serial, v.year), voucherDate: v.voucher_date, partyName: v.party_name,
      amount: Number(v.amount), status: v.status, requestKind: v.request_kind,
    }));
  }

  /** عدد القيود غير المرحّلة في فترة (لإغلاق الشهر أو السنة) */
  async draftCount(em: EntityManager, org: string, from: string, to: string) {
    const [r] = await em.query(
      `SELECT COUNT(*)::int AS n FROM acc_entries WHERE organization_id = $1 AND status = 'draft' AND document_date BETWEEN $2 AND $3`, [org, from, to]);
    return r.n as number;
  }

  /** سندات لم يكتمل اعتمادها أو عليها طلب إعادة/إلغاء معلق في فترة */
  async openVoucherCount(em: EntityManager, org: string, from: string, to: string) {
    const [r] = await em.query(
      `SELECT COUNT(*)::int AS n FROM acc_vouchers WHERE organization_id = $1 AND voucher_date BETWEEN $2 AND $3
        AND (status IN ('draft', 'pending', 'returned') OR request_kind IS NOT NULL)`, [org, from, to]);
    return r.n as number;
  }
}
