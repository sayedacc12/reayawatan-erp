import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { OrgUser } from '../../core/auth/decorators';
import { FileStore } from '../../core/files/file-store.service';
import { VouchersService } from '../accounting/vouchers.service';
import {
  InvoiceItem, InvoiceKind, MemApplication, MemInvoice, MemMember, MemNotice, MemSettings, PayMethod,
} from './entities/members.entity';
import { MEMBER_PERMISSIONS as P } from './members.manifest';
import { NoticeDto, RecordPaymentDto } from './members.dto';
import { INVOICE_STATUS_AR, METHOD_AR, MembersService } from './members.service';
import { MemCore, today, token } from './mem-core.service';
import { addDays, daysBetween, fillTemplate } from './mem-forms';
import { PaymentGateway } from './payment-gateway';

const fmtMoney = (n: number) => `${n.toLocaleString('en-US', { maximumFractionDigits: 2 })} ريال`;

/** فاعل النظام للعمليات التي تتم بدون موظف (الدفع الإلكتروني والإصدار التلقائي) */
function systemActor(org: string, fullName: string): OrgUser {
  return {
    id: null as unknown as string, organizationId: org, organizationName: null, organizationSlug: null, email: '', username: null, fullName,
    isSuperadmin: false, isPlatformAdmin: false, permissions: [],
  };
}

/**
 * المطالبات والتحصيل: مطالبة العضوية الجديدة بعد الاعتماد، مطالبات التجديد (يدويًا أو تلقائيًا قبل الانتهاء)،
 * السداد الإلكتروني عبر البوابة أو بالتحويل أو نقدًا، وسند قبض في النظام المالي لكل تحصيل،
 * وتنبيهات قرب انتهاء العضوية.
 */
@Injectable()
export class BillingService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger('Members');
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly db: DataSource,
    private readonly core: MemCore,
    private readonly members: MembersService,
    private readonly vouchers: VouchersService,
    private readonly files: FileStore,
  ) {}

  // ---------------- الإصدار التلقائي لمطالبات التجديد ----------------

  onApplicationBootstrap() {
    if (process.env.JEST_WORKER_ID || process.env.MEMBERS_SWEEP === 'off') return;
    const run = () => this.sweepAll().catch((e) => this.logger.warn(`Renewal sweep failed: ${(e as Error).message}`));
    setTimeout(run, 60_000).unref();
    this.timer = setInterval(run, 6 * 3600_000);
    this.timer.unref();
  }

  onApplicationShutdown() {
    if (this.timer) clearInterval(this.timer);
  }

  async sweepAll() {
    const orgs: { organization_id: string }[] = await this.db.query(
      `SELECT s.organization_id FROM mem_settings s WHERE s.initialized AND (s.renewal->>'autoInvoiceDays') IS NOT NULL`);
    for (const o of orgs) await this.sweep(o.organization_id);
  }

  /** يصدر مطالبات التجديد للأعضاء الذين اقترب انتهاء عضويتهم ولا توجد لهم مطالبة مفتوحة */
  async sweep(org: string) {
    const s = await this.core.settings(org);
    const days = s.renewal.autoInvoiceDays;
    if (!days) return 0;
    const t = today();
    const due: MemMember[] = await this.db.getRepository(MemMember).createQueryBuilder('m')
      .where('m.organization_id = :org AND m.status = :st', { org, st: 'active' })
      .andWhere('m.end_date <= :limit AND m.end_date >= :from', { limit: addDays(t, days), from: addDays(t, -s.renewal.graceDays) })
      .andWhere(`NOT EXISTS (SELECT 1 FROM mem_invoices i WHERE i.member_id = m.id AND i.kind = 'renewal' AND i.status IN ('unpaid', 'review'))`)
      .getMany();
    let n = 0;
    for (const m of due) {
      const type = this.core.type(s, m.typeCode);
      if (!type || !type.isActive || type.fee <= 0) continue;
      await this.db.transaction(async (em) => {
        const inv = await this.createRenewal(em, s, m, 'النظام (إصدار تلقائي)');
        await em.getRepository(MemNotice).save(em.create(MemNotice, {
          organizationId: org, memberId: m.id, invoiceId: inv.id, channel: 'auto', daysLeft: daysBetween(t, m.endDate),
          message: `صدرت مطالبة التجديد ${inv.invoiceNo} تلقائيًا بمبلغ ${fmtMoney(inv.amount)}`, sentByName: 'النظام',
        }));
      });
      n++;
    }
    return n;
  }

  // ---------------- إصدار المطالبات ----------------

  private async insertInvoice(em: EntityManager, s: MemSettings, p: {
    org: string; kind: InvoiceKind; typeCode: string; memberId: string | null; applicationId: string | null; partyName: string; nationalId: string; mobile: string;
    items: InvoiceItem[]; byName: string;
  }) {
    const n = await this.core.nextNo(em, p.org, 'nextInvoiceNo');
    const year = today().slice(0, 4);
    const amount = Math.round(p.items.reduce((a, i) => a + i.amount, 0) * 100) / 100;
    return em.getRepository(MemInvoice).save(em.create(MemInvoice, {
      organizationId: p.org, invoiceNo: `MI-${year}-${String(n).padStart(4, '0')}`, kind: p.kind, memberId: p.memberId, applicationId: p.applicationId,
      typeCode: p.typeCode, partyName: p.partyName, nationalId: p.nationalId, mobile: p.mobile, items: p.items, amount,
      dueDate: addDays(today(), s.payment.dueDays), status: 'unpaid', payToken: token(), createdByName: p.byName,
    }));
  }

  /** مطالبة العضوية الجديدة بعد الاعتماد النهائي للطلب: الاشتراك ورسوم الانتساب */
  async createForApplication(em: EntityManager, s: MemSettings, app: MemApplication, byName: string) {
    const t = this.core.type(s, app.typeCode)!;
    const items: InvoiceItem[] = [{ label: `اشتراك ${t.name} (${t.durationMonths} شهرًا)`, amount: t.fee }];
    if (t.joiningFee > 0) items.push({ label: 'رسوم الانتساب (مرة واحدة)', amount: t.joiningFee });
    return this.insertInvoice(em, s, {
      org: app.organizationId, kind: 'new', typeCode: t.code, memberId: null, applicationId: app.id, partyName: app.fullName,
      nationalId: app.nationalId, mobile: app.mobile, items: items.filter((i) => i.amount > 0), byName,
    });
  }

  private async createRenewal(em: EntityManager, s: MemSettings, m: MemMember, byName: string) {
    const t = this.core.type(s, m.typeCode)!;
    return this.insertInvoice(em, s, {
      org: m.organizationId, kind: 'renewal', typeCode: t.code, memberId: m.id, applicationId: null, partyName: m.fullName, nationalId: m.nationalId,
      mobile: m.mobile, items: [{ label: `تجديد ${t.name} (${t.durationMonths} شهرًا)`, amount: t.fee }], byName,
    });
  }

  /** مطالبة التجديد لعضو (أو المطالبة المفتوحة إن وُجدت). النوع المجاني يُجدد مباشرة */
  async issueRenewal(org: string, memberId: string, byName: string) {
    const s = await this.core.settings(org);
    return this.db.transaction(async (em) => {
      const m = await em.getRepository(MemMember).createQueryBuilder('m').setLock('pessimistic_write').where('m.id = :id AND m.organization_id = :org', { id: memberId, org }).getOne();
      if (!m) throw new NotFoundException('العضو غير موجود');
      if (m.status !== 'active') throw new ConflictException(m.status === 'suspended' ? 'العضوية موقوفة، أعد تفعيلها قبل التجديد' : 'العضوية منتهية بقرار ولا تُجدد، يلزم طلب عضوية جديد');
      const t = this.core.type(s, m.typeCode);
      if (!t) throw new BadRequestException('نوع العضوية غير موجود');
      if (!t.isActive) throw new ConflictException(`نوع «${t.name}» موقوف، غيّر نوع العضوية قبل التجديد`);
      const open = await em.getRepository(MemInvoice).findOne({ where: { organizationId: org, memberId, kind: 'renewal', status: 'unpaid' } });
      if (open) return { invoice: open, created: false, extended: null };
      if (await em.getRepository(MemInvoice).exists({ where: { organizationId: org, memberId, kind: 'renewal', status: 'review' } })) {
        throw new ConflictException('يوجد تحويل بنكي للتجديد بانتظار التأكيد');
      }
      if (t.fee <= 0) {
        const period = await this.members.extend(em, m, s, byName, today(), 'بدون اشتراك');
        return { invoice: null, created: false, extended: period };
      }
      return { invoice: await this.createRenewal(em, s, m, byName), created: true, extended: null };
    });
  }

  // ---------------- السداد ----------------

  /** اعتماد السداد: تفعيل العضوية الجديدة أو تمديدها، ثم سند القبض في النظام المالي */
  private async markPaid(em: EntityManager, inv: MemInvoice, p: { method: PayMethod; paidOn: string; ref: string | null; byName: string }) {
    if (inv.status === 'paid') return;
    if (inv.status === 'cancelled') throw new ConflictException('المطالبة ملغاة');
    const s = await this.core.settings(inv.organizationId, em);
    let period: { start: string; end: string };
    let memberId = inv.memberId;
    if (inv.kind === 'new') {
      const app = await em.getRepository(MemApplication).findOneOrFail({ where: { id: inv.applicationId! } });
      if (app.status !== 'awaiting_payment') throw new ConflictException('طلب العضوية لا ينتظر السداد');
      const m = await this.members.activateFromApplication(em, app, s, p.byName, p.paidOn);
      period = { start: m.startDate, end: m.endDate };
      memberId = m.id;
    } else {
      const m = await em.getRepository(MemMember).findOneOrFail({ where: { id: inv.memberId! } });
      period = await this.members.extend(em, m, s, p.byName, p.paidOn, inv.invoiceNo);
    }
    await em.getRepository(MemInvoice).update({ id: inv.id }, {
      status: 'paid', method: p.method, paidOn: p.paidOn, paidAt: new Date(), paymentRef: p.ref, receivedByName: p.byName,
      periodStart: period.start, periodEnd: period.end, memberId,
    });
  }

  /** تسجيل سداد نقدي أو بتحويل بواسطة الموظف */
  async recordPayment(actor: OrgUser, id: string, dto: RecordPaymentDto) {
    const org = actor.organizationId;
    if (dto.paidOn > today()) throw new BadRequestException('تاريخ السداد في المستقبل');
    await this.db.transaction(async (em) => {
      const inv = await this.lock(em, org, id);
      if (inv.status !== 'unpaid' && inv.status !== 'review') throw new ConflictException('المطالبة ليست بانتظار السداد');
      await this.markPaid(em, inv, { method: dto.method, paidOn: dto.paidOn, ref: dto.reference ?? inv.transferReceipt?.reference ?? null, byName: actor.fullName });
    });
    await this.createVoucher(org, id, actor);
    return this.get(actor, id);
  }

  async rejectTransfer(actor: OrgUser, id: string, note: string | null | undefined) {
    if (!note) throw new BadRequestException('اكتب سبب رفض التحويل ليظهر للعضو');
    const org = actor.organizationId;
    const old = await this.db.transaction(async (em) => {
      const inv = await this.lock(em, org, id);
      if (inv.status !== 'review') throw new ConflictException('لا يوجد تحويل بانتظار التأكيد');
      await em.getRepository(MemInvoice).update({ id }, { status: 'unpaid', transferReceipt: null, note: `رُفض إيصال التحويل: ${note}` });
      return inv.transferReceipt;
    });
    if (old) await this.files.remove(old.fileKey).catch(() => undefined);
    return this.get(actor, id);
  }

  async cancel(actor: OrgUser, id: string, note: string | null | undefined) {
    if (!note) throw new BadRequestException('اكتب سبب إلغاء المطالبة');
    const org = actor.organizationId;
    await this.db.transaction(async (em) => {
      const inv = await this.lock(em, org, id);
      if (inv.status !== 'unpaid' && inv.status !== 'review') throw new ConflictException('لا تُلغى إلا المطالبة غير المسددة');
      await em.getRepository(MemInvoice).update({ id }, { status: 'cancelled', note });
      if (inv.kind === 'new' && inv.applicationId) {
        const app = await em.getRepository(MemApplication).findOneOrFail({ where: { id: inv.applicationId } });
        await em.getRepository(MemApplication).update({ id: app.id }, {
          status: 'cancelled', approvalLog: [...app.approvalLog, { stage: 'السداد', decision: 'cancel', byName: actor.fullName, at: new Date().toISOString(), note: `إلغاء مطالبة الاشتراك: ${note}` }],
        });
      }
    });
    return this.get(actor, id);
  }

  // ---------------- سند القبض في النظام المالي ----------------

  /**
   * سند قبض مسودة في النظام المالي لكل تحصيل، يمر بمراحل اعتماد سندات القبض المعتادة.
   * يُنشأ في معاملة مستقلة بعد اعتماد السداد: إن تعذر (مثل عدم اكتمال الربط المالي) يبقى السداد معتمدًا
   * ويُحفظ السبب، ويعيد الموظف المحاولة من شاشة المطالبة.
   */
  async createVoucher(org: string, id: string, actor?: OrgUser) {
    try {
      await this.db.transaction(async (em) => {
        const inv = await this.lock(em, org, id);
        if (inv.status !== 'paid' || inv.voucherId) return;
        const s = await this.core.settings(org, em);
        const t = this.core.type(s, inv.typeCode);
        const counter = t?.revenueAccountId ?? s.accounting.revenueAccountId;
        const method = inv.method!;
        const cash = method === 'online' ? s.accounting.onlineCashAccountId : method === 'transfer' ? s.accounting.transferCashAccountId : s.accounting.cashCashAccountId;
        const missing = [!counter && 'حساب إيراد الاشتراكات', !cash && `حساب تحصيل ${METHOD_AR[method]}`].filter(Boolean);
        if (missing.length) throw new BadRequestException(`أكمل الربط المالي في إعدادات العضوية: ${missing.join('، ')}`);
        const [m] = inv.memberId ? await em.query('SELECT member_no FROM mem_members WHERE id = $1', [inv.memberId]) : [];
        const who = actor && actor.id ? actor : systemActor(org, method === 'online' ? 'الدفع الإلكتروني (العضوية)' : inv.receivedByName ?? 'العضوية');
        const v = await this.vouchers.insertDraft(em, who, 'receipt', {
          voucherDate: inv.paidOn!, partyName: inv.partyName, partnerId: null, amount: inv.amount,
          purpose: `${inv.kind === 'new' ? 'اشتراك عضوية جديدة' : 'تجديد عضوية'} (${t?.name ?? inv.typeCode})${m ? ` للعضو رقم ${m.member_no}` : ''} للفترة من ${inv.periodStart} إلى ${inv.periodEnd} - مطالبة ${inv.invoiceNo}`,
          sourceType: 'membership', sourceRef: inv.invoiceNo, projectName: null,
          method: method === 'online' ? 'card' : method, methodRef: inv.paymentRef ?? inv.gatewayId ?? null,
          cashAccountId: cash!, counterAccountId: counter!, analytic: [],
        });
        await em.getRepository(MemInvoice).update({ id }, { voucherId: v.id, voucherError: null });
      });
    } catch (e) {
      const msg = (e as Error).message?.slice(0, 480) || 'تعذر إنشاء سند القبض';
      await this.db.getRepository(MemInvoice).update({ id, organizationId: org }, { voucherError: msg });
      this.logger.warn(`Membership voucher for ${id} failed: ${msg}`);
    }
  }

  async retryVoucher(actor: OrgUser, id: string) {
    const inv = await this.load(actor.organizationId, id);
    if (inv.status !== 'paid') throw new ConflictException('سند القبض يُنشأ للمطالبة المسددة فقط');
    if (inv.voucherId) throw new ConflictException('أُنشئ سند القبض من قبل');
    await this.createVoucher(actor.organizationId, id, actor);
    return this.get(actor, id);
  }

  // ---------------- الدفع العام (بدون دخول) ----------------

  private async byToken(t: string, em: EntityManager = this.db.manager, lock = false) {
    if (!/^[0-9a-f]{32}$/.test(String(t))) throw new NotFoundException('رابط السداد غير صحيح');
    const qb = em.getRepository(MemInvoice).createQueryBuilder('i').where('i.pay_token = :t', { t });
    if (lock) qb.setLock('pessimistic_write');
    const inv = await qb.getOne();
    if (!inv) throw new NotFoundException('رابط السداد غير صحيح');
    return inv;
  }

  async payInfo(t: string) {
    const inv = await this.byToken(t);
    const s = await this.core.settings(inv.organizationId);
    const o = await this.core.orgName(inv.organizationId);
    const type = this.core.type(s, inv.typeCode);
    return {
      orgName: o.name, slug: o.slug, invoiceNo: inv.invoiceNo, kind: inv.kind, kindLabel: inv.kind === 'new' ? 'اشتراك عضوية جديدة' : 'تجديد العضوية',
      partyName: inv.partyName, typeName: type?.name ?? inv.typeCode, items: inv.items, amount: inv.amount, dueDate: inv.dueDate,
      status: inv.status, statusLabel: INVOICE_STATUS_AR[inv.status], paidOn: inv.paidOn, periodStart: inv.periodStart, periodEnd: inv.periodEnd,
      method: inv.method, note: inv.status === 'unpaid' ? inv.note : null,
      methods: { online: s.payment.online, transfer: s.payment.transfer, cash: s.payment.cash },
      provider: s.payment.provider,
      bank: s.payment.transfer ? { bankName: s.payment.bankName, accountName: s.payment.accountName, iban: s.payment.iban } : null,
      transferSubmitted: inv.status === 'review' ? { reference: inv.transferReceipt?.reference ?? null, at: inv.transferReceipt?.uploadedAt ?? null } : null,
    };
  }

  /** بدء الدفع الإلكتروني: يُنشئ عملية في البوابة ويعيد رابط صفحة الدفع */
  async startOnline(t: string, origin: string) {
    const inv = await this.byToken(t);
    const s = await this.core.settings(inv.organizationId);
    if (!s.payment.online) throw new BadRequestException('الدفع الإلكتروني غير متاح حاليًا');
    if (inv.status !== 'unpaid') throw new ConflictException(inv.status === 'paid' ? 'المطالبة مسددة' : 'المطالبة ليست بانتظار السداد');
    const o = await this.core.orgName(inv.organizationId);
    const page = `${origin}/m/pay/${inv.payToken}`;
    const g = await new PaymentGateway(s.payment).checkout({
      amount: inv.amount, invoiceNo: inv.invoiceNo, description: `${o.name}: ${inv.kind === 'new' ? 'اشتراك عضوية' : 'تجديد عضوية'} ${inv.invoiceNo}`,
      returnUrl: `${page}?check=1`, backUrl: page,
    });
    await this.db.getRepository(MemInvoice).update({ id: inv.id }, { gatewayId: g.id, gatewayUrl: g.url });
    return { url: g.url, provider: s.payment.provider };
  }

  /** إتمام الدفع في البيئة التجريبية (لا يعمل إلا إذا كانت البوابة المختارة تجريبية) */
  async sandboxPay(t: string, ref: string) {
    const inv = await this.byToken(t);
    const s = await this.core.settings(inv.organizationId);
    if (s.payment.provider !== 'sandbox' || !s.payment.online) throw new ForbiddenException('البيئة التجريبية غير مفعّلة');
    if (!inv.gatewayId || inv.gatewayId !== ref) throw new BadRequestException('عملية الدفع غير صحيحة، ابدأ الدفع من جديد');
    await this.db.transaction(async (em) => {
      const locked = await this.byToken(t, em, true);
      if (locked.status === 'paid') return;
      if (locked.status !== 'unpaid') throw new ConflictException('المطالبة ليست بانتظار السداد');
      await this.markPaid(em, locked, { method: 'online', paidOn: today(), ref, byName: 'الدفع الإلكتروني' });
    });
    await this.createVoucher(inv.organizationId, inv.id);
    return this.payInfo(t);
  }

  /** التحقق من البوابة بعد عودة العضو من صفحة الدفع (أو من شاشة الموظف) */
  async verifyOnline(t: string) {
    const inv = await this.byToken(t);
    if (inv.status === 'paid') return this.payInfo(t);
    const s = await this.core.settings(inv.organizationId);
    if (!inv.gatewayId) throw new BadRequestException('لم يبدأ الدفع الإلكتروني لهذه المطالبة');
    if (s.payment.provider === 'sandbox') return this.payInfo(t);
    const st = await new PaymentGateway(s.payment).status(inv.gatewayId);
    if (st.paid) {
      if (st.amount !== null && Math.abs(st.amount - inv.amount) > 0.009) throw new ConflictException('المبلغ المسدد في البوابة لا يطابق المطالبة، تواصل مع الجمعية');
      await this.db.transaction(async (em) => {
        const locked = await this.byToken(t, em, true);
        if (locked.status !== 'unpaid' && locked.status !== 'review') return;
        await this.markPaid(em, locked, { method: 'online', paidOn: today(), ref: st.reference, byName: 'الدفع الإلكتروني' });
      });
      await this.createVoucher(inv.organizationId, inv.id);
    }
    return this.payInfo(t);
  }

  async checkGateway(actor: OrgUser, id: string) {
    const inv = await this.load(actor.organizationId, id);
    await this.verifyOnline(inv.payToken);
    return this.get(actor, id);
  }

  /** رفع إيصال التحويل البنكي من رابط السداد، ويؤكده الموظف */
  async submitTransfer(t: string, file: Express.Multer.File | undefined, reference: string | null) {
    const inv = await this.byToken(t);
    const s = await this.core.settings(inv.organizationId);
    if (!s.payment.transfer) throw new BadRequestException('السداد بالتحويل البنكي غير متاح');
    if (inv.status !== 'unpaid') throw new ConflictException(inv.status === 'review' ? 'أُرسل إيصال التحويل من قبل وهو بانتظار التأكيد' : 'المطالبة ليست بانتظار السداد');
    const x = await this.files.save(`${inv.organizationId}/members`, file, 'إيصال التحويل');
    await this.db.getRepository(MemInvoice).update({ id: inv.id }, {
      status: 'review', note: null,
      transferReceipt: { fileKey: x.key, mime: x.mime, fileName: x.name, reference: reference || null, uploadedAt: new Date().toISOString() },
    });
    return this.payInfo(t);
  }

  async receiptFile(org: string, id: string) {
    const inv = await this.load(org, id);
    if (!inv.transferReceipt) throw new NotFoundException('لا يوجد إيصال تحويل');
    return { stream: this.files.open(inv.transferReceipt.fileKey), mime: inv.transferReceipt.mime, name: inv.transferReceipt.fileName };
  }

  // ---------------- العرض ----------------

  private async lock(em: EntityManager, org: string, id: string) {
    const inv = await em.getRepository(MemInvoice).createQueryBuilder('i').setLock('pessimistic_write').where('i.id = :id AND i.organization_id = :org', { id, org }).getOne();
    if (!inv) throw new NotFoundException('المطالبة غير موجودة');
    return inv;
  }

  private async load(org: string, id: string) {
    const inv = await this.db.getRepository(MemInvoice).findOne({ where: { id, organizationId: org } });
    if (!inv) throw new NotFoundException('المطالبة غير موجودة');
    return inv;
  }

  async list(actor: OrgUser, q: { status?: string; kind?: string; search?: string; method?: string }) {
    const org = actor.organizationId;
    const s = await this.core.settings(org);
    const qb = this.db.getRepository(MemInvoice).createQueryBuilder('i').where('i.organization_id = :org', { org });
    if (q.status) qb.andWhere('i.status = :status', { status: q.status });
    if (q.kind) qb.andWhere('i.kind = :kind', { kind: q.kind });
    if (q.method) qb.andWhere('i.method = :method', { method: q.method });
    if (q.search?.trim()) qb.andWhere('(i.party_name ILIKE :t OR i.invoice_no ILIKE :t OR i.national_id ILIKE :t OR i.mobile ILIKE :t)', { t: `%${q.search.trim()}%` });
    const rows = await qb.orderBy('i.created_at', 'DESC').take(500).getMany();
    const vouchers = await this.members.voucherInfo(rows.map((r) => r.voucherId).filter((x): x is string => !!x));
    return rows.map((i) => ({
      id: i.id, invoiceNo: i.invoiceNo, kind: i.kind, kindLabel: i.kind === 'new' ? 'اشتراك جديد' : 'تجديد', partyName: i.partyName, mobile: i.mobile,
      typeName: this.core.typeName(s, i.typeCode), amount: i.amount, dueDate: i.dueDate, overdue: i.status === 'unpaid' && i.dueDate < today(),
      status: i.status, statusLabel: INVOICE_STATUS_AR[i.status], method: i.method, methodLabel: i.method ? METHOD_AR[i.method] : null, paidOn: i.paidOn,
      memberId: i.memberId, applicationId: i.applicationId, voucher: i.voucherId ? vouchers.get(i.voucherId) ?? null : null, voucherError: i.voucherError, createdAt: i.createdAt,
    }));
  }

  async get(actor: OrgUser, id: string) {
    const org = actor.organizationId;
    const s = await this.core.settings(org);
    const inv = await this.load(org, id);
    const vouchers = await this.members.voucherInfo(inv.voucherId ? [inv.voucherId] : []);
    const [m] = inv.memberId ? await this.db.query('SELECT id, member_no AS "memberNo" FROM mem_members WHERE id = $1', [inv.memberId]) : [];
    const [a] = inv.applicationId ? await this.db.query('SELECT id, application_no AS "applicationNo" FROM mem_applications WHERE id = $1', [inv.applicationId]) : [];
    const pay = actor.isSuperadmin || actor.permissions.includes(P.payments);
    const open = inv.status === 'unpaid' || inv.status === 'review';
    return {
      id: inv.id, invoiceNo: inv.invoiceNo, kind: inv.kind, kindLabel: inv.kind === 'new' ? 'اشتراك عضوية جديدة' : 'تجديد العضوية', typeName: this.core.typeName(s, inv.typeCode),
      partyName: inv.partyName, nationalId: inv.nationalId, mobile: inv.mobile, items: inv.items, amount: inv.amount, dueDate: inv.dueDate,
      status: inv.status, statusLabel: INVOICE_STATUS_AR[inv.status], method: inv.method, methodLabel: inv.method ? METHOD_AR[inv.method] : null,
      paidOn: inv.paidOn, paymentRef: inv.paymentRef, receivedByName: inv.receivedByName, periodStart: inv.periodStart, periodEnd: inv.periodEnd,
      gatewayId: inv.gatewayId, transferReceipt: inv.transferReceipt ? { fileName: inv.transferReceipt.fileName, reference: inv.transferReceipt.reference, uploadedAt: inv.transferReceipt.uploadedAt } : null,
      note: inv.note, payToken: inv.payToken, createdByName: inv.createdByName, createdAt: inv.createdAt,
      voucher: inv.voucherId ? vouchers.get(inv.voucherId) ?? null : null, voucherError: inv.voucherError,
      member: m ?? null, application: a ?? null, provider: s.payment.provider,
      can: {
        pay: pay && open, confirmTransfer: pay && inv.status === 'review', cancel: pay && open,
        voucher: pay && inv.status === 'paid' && !inv.voucherId, check: pay && open && !!inv.gatewayId && s.payment.provider !== 'sandbox',
      },
    };
  }

  // ---------------- التجديد والتنبيهات ----------------

  /** رسالة التذكير بمتغيراتها */
  reminderText(s: MemSettings, orgName: string, m: MemMember, amount: number, link: string) {
    return fillTemplate(s.renewal.message, {
      'اسم العضو': m.fullName, 'رقم العضوية': String(m.memberNo), 'نوع العضوية': this.core.typeName(s, m.typeCode), 'اسم الجمعية': orgName,
      'تاريخ الانتهاء': m.endDate, المبلغ: fmtMoney(amount), 'رابط السداد': link,
    });
  }

  /** الأعضاء الذين تقترب عضويتهم من الانتهاء أو انتهت حديثًا، مع آخر تنبيه ومطالبة التجديد المفتوحة */
  async renewals(actor: OrgUser, origin: string) {
    const org = actor.organizationId;
    await this.sweep(org);
    const s = await this.core.settings(org);
    const o = await this.core.orgName(org);
    const t = today();
    const window = Math.max(...s.renewal.reminderDays, 0);
    const members = await this.db.getRepository(MemMember).createQueryBuilder('m').where('m.organization_id = :org AND m.status = :st', { org, st: 'active' })
      .andWhere('m.end_date <= :limit AND m.end_date >= :from', { limit: addDays(t, window), from: addDays(t, -Math.max(90, s.renewal.graceDays)) })
      .orderBy('m.end_date', 'ASC').getMany();
    const ids = members.map((m) => m.id);
    const invoices = ids.length ? await this.db.getRepository(MemInvoice).createQueryBuilder('i')
      .where(`i.member_id = ANY(:ids) AND i.kind = 'renewal' AND i.status IN ('unpaid', 'review')`, { ids }).getMany() : [];
    const notices: { member_id: string; created_at: Date; channel: string; days_left: number }[] = ids.length ? await this.db.query(
      `SELECT DISTINCT ON (member_id) member_id, created_at, channel, days_left FROM mem_notices WHERE member_id = ANY($1) AND channel <> 'auto' ORDER BY member_id, created_at DESC`, [ids]) : [];
    const thresholds = [...s.renewal.reminderDays].sort((a, b) => a - b);
    return {
      reminderDays: s.renewal.reminderDays, graceDays: s.renewal.graceDays, autoInvoiceDays: s.renewal.autoInvoiceDays,
      rows: members.map((m) => {
        const left = daysBetween(t, m.endDate);
        const inv = invoices.find((i) => i.memberId === m.id) ?? null;
        const last = notices.find((n) => n.member_id === m.id) ?? null;
        // التنبيه مستحق إذا دخل العضو عتبة تنبيه جديدة ولم يُنبَّه منذ دخولها
        const threshold = thresholds.find((d) => left <= d) ?? null;
        const due = left < 0 ? !last || last.days_left >= 0 : threshold !== null && (!last || last.days_left > threshold);
        const type = this.core.type(s, m.typeCode);
        const link = inv ? `${origin}/m/pay/${inv.payToken}` : `${origin}/m/${o.slug}?tab=member`;
        const st = this.core.effectiveStatus(m, s);
        return {
          id: m.id, memberNo: m.memberNo, fullName: m.fullName, mobile: m.mobile, email: m.email, typeName: type?.name ?? m.typeCode, endDate: m.endDate,
          daysLeft: left, status: st, fee: type?.fee ?? 0,
          invoice: inv ? { id: inv.id, invoiceNo: inv.invoiceNo, amount: inv.amount, status: inv.status, statusLabel: INVOICE_STATUS_AR[inv.status], payToken: inv.payToken } : null,
          lastNotice: last ? { at: last.created_at, channel: last.channel, daysLeft: last.days_left } : null,
          reminderDue: due,
          message: this.reminderText(s, o.name, m, inv?.amount ?? type?.fee ?? 0, link),
        };
      }),
    };
  }

  /** تسجيل تنبيه أُرسل للعضو (واتساب أو رسالة أو بريد أو اتصال) */
  async notice(actor: OrgUser, memberId: string, dto: NoticeDto) {
    const m = await this.members.load(actor.organizationId, memberId);
    const [inv] = await this.db.query(`SELECT id FROM mem_invoices WHERE member_id = $1 AND kind = 'renewal' AND status IN ('unpaid', 'review') LIMIT 1`, [memberId]);
    await this.db.getRepository(MemNotice).save(this.db.getRepository(MemNotice).create({
      organizationId: actor.organizationId, memberId, invoiceId: inv?.id ?? null, channel: dto.channel, daysLeft: daysBetween(today(), m.endDate),
      message: dto.message, sentByName: actor.fullName,
    }));
    return { ok: true };
  }
}
