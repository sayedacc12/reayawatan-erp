import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { DataSource, EntityManager } from 'typeorm';
import { OrgUser } from '../../core/auth/decorators';
import { PaymentGateway } from '../../core/payments/payment-gateway';
import { VouchersService } from '../accounting/vouchers.service';
import { DonationKind, DonationStatus, WebDonation, WebProgram, WebSettings, WebSubscription } from './entities/website.entity';
import { DonateDto } from './website.dto';
import { DEFAULT_PROGRAM_STORE } from './website-defaults';
import { storeBlock } from './content.service';
import { UUID, WebCore, randomToken, webToday } from './web-core.service';

export const DONATION_STATUS: Record<DonationStatus, string> = { pending: 'بانتظار الدفع', paid: 'مدفوع', failed: 'لم يكتمل', cancelled: 'ملغى' };
export const KIND_AR: Record<DonationKind, string> = { project: 'تبرع لمشروع', waqf: 'تبرع وقفي', general: 'تبرع عام' };
export const SUB_STATUS: Record<string, string> = { active: 'نشط', paused: 'موقوف مؤقتًا', cancelled: 'ملغى' };

/** رقم جوال سعودي بصيغة 05XXXXXXXX ('' = غير صحيح) */
export function normPhone(v: string | null | undefined) {
  let p = String(v ?? '').replace(/[\s\-()]/g, '').replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)));
  p = p.replace(/^(\+966|00966|966)/, '0');
  if (/^5\d{8}$/.test(p)) p = `0${p}`;
  return /^05\d{8}$/.test(p) ? p : '';
}
const maskPhone = (p: string | null) => (p ? `${p.slice(0, 3)}•••••${p.slice(-2)}` : '');
export function addMonth(iso: string) {
  const d = new Date(`${iso.slice(0, 10)}T12:00:00Z`);
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + 1);
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, last));
  return d.toISOString().slice(0, 10);
}
export const receiptLabel = (n: number | null) => (n ? `W-${String(n).padStart(6, '0')}` : null);

/** فاعل النظام للعمليات التي تتم بدون موظف (الدفع الإلكتروني من الموقع) */
function systemActor(org: string): OrgUser {
  return {
    id: null as unknown as string, organizationId: org, organizationName: null, organizationSlug: null, email: '', username: null,
    fullName: 'متجر الموقع الإلكتروني', isSuperadmin: false, isPlatformAdmin: false, permissions: [],
  };
}

/**
 * متجر التبرعات: إنشاء التبرع من الموقع والدفع عبر البوابة، والإيصال ورمز التحقق، والتبرع الشهري،
 * وسند قبض في النظام المالي لكل تبرع مدفوع يمر بمراحل اعتماد سندات القبض.
 */
@Injectable()
export class StoreService {
  private readonly logger = new Logger('WebsiteStore');

  constructor(private readonly db: DataSource, private readonly core: WebCore, private readonly vouchers: VouchersService) {}

  // ---------------- الحدود ----------------

  bounds(s: WebSettings, p: WebProgram | null) {
    const ps = p ? { ...DEFAULT_PROGRAM_STORE, ...p.store } : null;
    const min = Math.max(s.store.min || 1, ps?.min || 0);
    const max = Math.min(s.store.max || 100000, ps?.max || Number.MAX_SAFE_INTEGER);
    const presets = (ps?.presets?.length ? ps.presets : s.store.presets).filter((v) => v >= min && v <= max);
    return { min, max, presets, monthly: s.store.monthly && (ps ? ps.monthly : true), gift: s.store.gift && (ps ? ps.gift : true) };
  }

  // ---------------- التبرع من الموقع ----------------

  async donate(slug: string, dto: DonateDto, origin: string) {
    const org = await this.core.identity.organization(slug);
    const s = await this.core.settings(org.id);
    if (!s.published) throw new NotFoundException('موقع الجمعية غير منشور حاليًا');
    if (!s.store.enabled || !s.sections.store) throw new BadRequestException('استقبال التبرعات متوقف حاليًا');
    let p: WebProgram | null = null;
    if (dto.programId) {
      if (!UUID.test(dto.programId)) throw new NotFoundException('البرنامج غير موجود');
      p = await this.db.getRepository(WebProgram).findOne({ where: { id: dto.programId, organizationId: org.id } });
      if (!p) throw new NotFoundException('البرنامج غير موجود');
      const block = storeBlock({ ...p, store: { ...DEFAULT_PROGRAM_STORE, ...p.store } });
      if (block) throw new BadRequestException(block);
    } else if (!s.store.general) {
      throw new BadRequestException('اختر برنامجًا للتبرع له');
    }
    const b = this.bounds(s, p);
    if (dto.amount < b.min) throw new BadRequestException(`أقل مبلغ للتبرع ${b.min} ريال`);
    if (dto.amount > b.max) throw new BadRequestException(`أعلى مبلغ للتبرع الواحد ${b.max.toLocaleString('en-US')} ريال`);
    const phone = normPhone(dto.phone);
    if (!phone) throw new BadRequestException('اكتب رقم جوال سعودي صحيح يبدأ بـ 05');
    if (dto.monthly && !b.monthly) throw new BadRequestException('التبرع الشهري غير متاح لهذا البرنامج');
    if (dto.gift && !b.gift) throw new BadRequestException('الإهداء غير متاح لهذا البرنامج');
    if (dto.gift && dto.monthly) throw new BadRequestException('الإهداء للتبرع لمرة واحدة فقط');
    const giftPhone = dto.gift?.phone ? normPhone(dto.gift.phone) : '';
    if (dto.gift?.phone && !giftPhone) throw new BadRequestException('جوال المُهدى إليه غير صحيح');
    const kind: DonationKind = !p ? 'general' : p.store.kind === 'waqf' ? 'waqf' : 'project';
    const d = await this.db.getRepository(WebDonation).save({
      organizationId: org.id, programId: p?.id ?? null, programName: p?.name ?? s.store.generalTitle, kind, amount: dto.amount,
      donorName: dto.name?.trim() || null, donorPhone: phone, donorEmail: dto.email?.trim() || null,
      gift: dto.gift ? { to: dto.gift.to, phone: giftPhone, message: dto.gift.message?.trim() ?? '' } : null,
      monthly: !!dto.monthly, status: 'pending', payToken: randomToken(), verifyCode: randomBytes(3).toString('hex').toUpperCase(),
    });
    return this.checkout(org.slug, s, d, origin);
  }

  private async checkout(slug: string, s: WebSettings, d: WebDonation, origin: string) {
    const base = `${origin}/w/${slug}`;
    const g = await new PaymentGateway(s.payment).checkout({
      amount: d.amount, description: `${KIND_AR[d.kind]}: ${d.programName}`, invoiceNo: d.id,
      returnUrl: `${base}/receipt/${d.payToken}`, backUrl: `${base}/pay/${d.payToken}`, metadata: { donation: d.id },
    });
    await this.db.getRepository(WebDonation).update({ id: d.id }, { gatewayId: g.id, gatewayUrl: g.url });
    return { token: d.payToken, url: g.url };
  }

  private async byToken(slug: string, token: string, em: EntityManager = this.db.manager, lock = false) {
    if (!/^[0-9a-f]{32}$/.test(String(token))) throw new NotFoundException('رابط التبرع غير صحيح');
    const org = await this.core.identity.organization(slug);
    const qb = em.getRepository(WebDonation).createQueryBuilder('d').where('d.pay_token = :t AND d.organization_id = :o', { t: token, o: org.id });
    if (lock) qb.setLock('pessimistic_write');
    const d = await qb.getOne();
    if (!d) throw new NotFoundException('رابط التبرع غير صحيح');
    return { org, d };
  }

  /** صفحة الدفع: بيانات التبرع قبل الدفع (للبيئة التجريبية ولإعادة المحاولة) */
  async payInfo(slug: string, token: string) {
    const { org, d } = await this.byToken(slug, token);
    const s = await this.core.settings(org.id);
    return {
      status: d.status, amount: d.amount, programName: d.programName, kind: d.kind, kindLabel: KIND_AR[d.kind], monthly: d.monthly,
      provider: s.payment.provider, gatewayId: d.status === 'pending' && s.payment.provider === 'sandbox' ? d.gatewayId : null,
      gatewayUrl: d.status === 'pending' && s.payment.provider !== 'sandbox' ? d.gatewayUrl : null,
    };
  }

  /** البيئة التجريبية: محاكاة نجاح الدفع */
  async sandboxPay(slug: string, token: string, ref: string) {
    const org = await this.core.identity.organization(slug);
    const s = await this.core.settings(org.id);
    if (s.payment.provider !== 'sandbox') throw new ForbiddenException('البيئة التجريبية غير مفعّلة');
    const id = await this.db.transaction(async (em) => {
      const { d } = await this.byToken(slug, token, em, true);
      if (d.status !== 'pending') return d.id;
      if (!d.gatewayId || d.gatewayId !== ref) throw new BadRequestException('عملية الدفع غير صحيحة، ابدأ التبرع من جديد');
      await this.markPaid(em, s, d, ref);
      return d.id;
    });
    await this.createVoucher(org.id, id);
    return this.receipt(slug, token);
  }

  /** بعد العودة من بوابة ميسر: التحقق من حالة الدفع من البوابة نفسها قبل اعتماده */
  private async confirm(slug: string, token: string) {
    const { org, d } = await this.byToken(slug, token);
    if (d.status !== 'pending' || !d.gatewayId) return;
    const s = await this.core.settings(org.id);
    if (s.payment.provider === 'sandbox') return;
    const st = await new PaymentGateway(s.payment).status(d.gatewayId).catch(() => null);
    if (!st?.paid) return;
    if (st.amount !== null && Math.abs(st.amount - d.amount) > 0.001) {
      this.logger.warn(`Donation ${d.id}: paid amount ${st.amount} differs from ${d.amount}`);
      return;
    }
    const paid = await this.db.transaction(async (em) => {
      const { d: locked } = await this.byToken(slug, token, em, true);
      if (locked.status !== 'pending') return false;
      await this.markPaid(em, s, locked, st.reference ?? locked.gatewayId!);
      return true;
    });
    if (paid) await this.createVoucher(org.id, d.id);
  }

  /** اعتماد الدفع: رقم الإيصال، وحصيلة البرنامج، وبدء التبرع الشهري أو تحديثه */
  private async markPaid(em: EntityManager, s: WebSettings, d: WebDonation, ref: string) {
    // TypeORM يعيد [rows, count] لاستعلامات UPDATE في PostgreSQL
    const res = await em.query(
      'UPDATE web_settings SET next_receipt_no = next_receipt_no + 1 WHERE organization_id = $1 RETURNING next_receipt_no - 1 AS no', [d.organizationId]);
    const rows = Array.isArray(res[0]) ? res[0] : res;
    const no = Number(rows[0]?.no);
    if (!no) throw new Error('تعذر إصدار رقم الإيصال');
    const patch: Partial<WebDonation> = { status: 'paid', receiptNo: no, paidAt: new Date(), paymentRef: ref.slice(0, 120) };
    if (d.programId) {
      await em.query('UPDATE web_programs SET raised = raised + $2, donations_count = donations_count + 1 WHERE id = $1', [d.programId, d.amount]);
    }
    if (d.subscriptionId) {
      const sub = await em.getRepository(WebSubscription).findOne({ where: { id: d.subscriptionId } });
      if (sub) await em.getRepository(WebSubscription).update({ id: sub.id }, { charges: sub.charges + 1, lastPaidAt: new Date(), nextDue: addMonth(sub.nextDue), openDonationId: null });
    } else if (d.monthly) {
      const sub = await em.getRepository(WebSubscription).save({
        organizationId: d.organizationId, programId: d.programId, programName: d.programName, amount: d.amount, donorName: d.donorName,
        donorPhone: d.donorPhone!, status: 'active', nextDue: addMonth(webToday()), charges: 1, lastPaidAt: new Date(),
      });
      patch.subscriptionId = sub.id;
    }
    await em.getRepository(WebDonation).update({ id: d.id }, patch);
    void s;
  }

  /** الإيصال (أو بطاقة الإهداء بدون المبلغ) */
  async receipt(slug: string, token: string, giftView = false) {
    await this.confirm(slug, token).catch((e) => this.logger.warn(`Confirm failed: ${(e as Error).message}`));
    const { org, d } = await this.byToken(slug, token);
    const s = await this.core.settings(org.id);
    if (giftView) {
      if (!d.gift || d.status !== 'paid') throw new NotFoundException('بطاقة الإهداء غير متاحة');
      return { gift: true, to: d.gift.to, message: d.gift.message, from: d.donorName || 'فاعل خير', programName: d.programName, kindLabel: KIND_AR[d.kind], date: d.paidAt };
    }
    return {
      status: d.status, statusLabel: DONATION_STATUS[d.status], receiptNo: receiptLabel(d.receiptNo), verifyCode: d.status === 'paid' ? d.verifyCode : null,
      amount: d.amount, programName: d.programName, kind: d.kind, kindLabel: KIND_AR[d.kind], donorName: d.donorName || 'فاعل خير',
      phone: maskPhone(d.donorPhone), date: d.paidAt ?? d.createdAt, monthly: d.monthly, gift: d.gift ? { to: d.gift.to, message: d.gift.message } : null,
      paymentRef: d.paymentRef, receiptNote: s.store.receiptNote, thanks: s.store.thanks, provider: s.payment.provider,
    };
  }

  /** التحقق من صحة إيصال برقمه ورمزه */
  async verify(slug: string, no: string, code: string) {
    const org = await this.core.identity.organization(slug);
    const n = Number(String(no ?? '').replace(/^W-?/i, ''));
    if (!Number.isInteger(n) || n < 1 || !/^[0-9A-F]{6}$/i.test(String(code ?? ''))) throw new BadRequestException('اكتب رقم الإيصال ورمز التحقق كما في الإيصال');
    const d = await this.db.getRepository(WebDonation).findOne({ where: { organizationId: org.id, receiptNo: n, status: 'paid' } });
    if (!d || d.verifyCode !== String(code).toUpperCase()) return { valid: false };
    return { valid: true, receiptNo: receiptLabel(d.receiptNo), amount: d.amount, programName: d.programName, date: d.paidAt, kindLabel: KIND_AR[d.kind] };
  }

  // ---------------- سند القبض ----------------

  async createVoucher(org: string, id: string, actor?: OrgUser) {
    try {
      await this.db.transaction(async (em) => {
        const d = await em.getRepository(WebDonation).createQueryBuilder('d').where('d.id = :id AND d.organization_id = :org', { id, org }).setLock('pessimistic_write').getOne();
        if (!d || d.status !== 'paid' || d.voucherId) return;
        const s = await this.core.settings(org, em);
        const p = d.programId ? await em.getRepository(WebProgram).findOne({ where: { id: d.programId } }) : null;
        const counter = p?.store?.revenueAccountId ?? (d.kind === 'waqf' ? s.accounting.waqfRevenueAccountId ?? s.accounting.generalRevenueAccountId : s.accounting.generalRevenueAccountId);
        const cash = s.accounting.onlineCashAccountId;
        const missing = [!counter && (d.kind === 'waqf' ? 'حساب إيراد التبرعات الوقفية أو العامة' : 'حساب إيراد التبرعات'), !cash && 'حساب تحصيل الدفع الإلكتروني'].filter(Boolean);
        if (missing.length) throw new BadRequestException(`أكمل الربط المالي في إعدادات الموقع: ${missing.join('، ')}`);
        const [act] = p?.activityId ? await em.query('SELECT name FROM activities WHERE id = $1', [p.activityId]) : [];
        const who = actor && actor.id ? actor : systemActor(org);
        const v = await this.vouchers.insertDraft(em, who, 'receipt', {
          voucherDate: new Date(d.paidAt!.getTime() + 3 * 3600000).toISOString().slice(0, 10), partyName: d.donorName || 'فاعل خير', partnerId: null, amount: d.amount,
          purpose: `${KIND_AR[d.kind]} من الموقع الإلكتروني: ${d.programName}${d.monthly ? ' (تبرع شهري)' : ''}${d.gift ? ` - إهداء إلى ${d.gift.to}` : ''} - إيصال ${receiptLabel(d.receiptNo)}`,
          sourceType: 'store', sourceRef: receiptLabel(d.receiptNo), projectName: act?.name ?? (p ? p.name : null),
          method: 'card', methodRef: d.paymentRef ?? d.gatewayId ?? null, cashAccountId: cash!, counterAccountId: counter!, analytic: [],
        });
        await em.getRepository(WebDonation).update({ id }, { voucherId: v.id, voucherError: null });
      });
    } catch (e) {
      const msg = (e as Error).message?.slice(0, 480) || 'تعذر إنشاء سند القبض';
      await this.db.getRepository(WebDonation).update({ id, organizationId: org }, { voucherError: msg });
      this.logger.warn(`Website voucher for ${id} failed: ${msg}`);
    }
  }

  async retryVoucher(actor: OrgUser, id: string) {
    const d = await this.loadDonation(actor.organizationId, id);
    if (d.status !== 'paid') throw new ConflictException('سند القبض يُنشأ للتبرع المدفوع فقط');
    if (d.voucherId) throw new ConflictException('أُنشئ سند القبض من قبل');
    await this.createVoucher(actor.organizationId, id, actor);
    return this.donation(actor, id);
  }

  // ---------------- شاشات الموظفين ----------------

  private async loadDonation(org: string, id: string) {
    if (!UUID.test(id)) throw new NotFoundException('التبرع غير موجود');
    const d = await this.db.getRepository(WebDonation).findOne({ where: { id, organizationId: org } });
    if (!d) throw new NotFoundException('التبرع غير موجود');
    return d;
  }

  private donationRow(d: WebDonation & { voucher_status?: string; voucher_serial?: string }) {
    return {
      id: d.id, receiptNo: receiptLabel(d.receiptNo), programId: d.programId, programName: d.programName, kind: d.kind, kindLabel: KIND_AR[d.kind],
      amount: d.amount, donorName: d.donorName, donorPhone: d.donorPhone, donorEmail: d.donorEmail, gift: d.gift, monthly: d.monthly,
      status: d.status, statusLabel: DONATION_STATUS[d.status], paidAt: d.paidAt, createdAt: d.createdAt, paymentRef: d.paymentRef,
      voucherId: d.voucherId, voucherError: d.voucherError, payToken: d.status === 'pending' ? d.payToken : null,
    };
  }

  async donations(actor: OrgUser, f: { status?: string; program?: string; from?: string; to?: string; q?: string; kind?: string }) {
    const qb = this.db.getRepository(WebDonation).createQueryBuilder('d').where('d.organization_id = :org', { org: actor.organizationId });
    if (f.status && f.status in DONATION_STATUS) qb.andWhere('d.status = :st', { st: f.status });
    if (f.kind && f.kind in KIND_AR) qb.andWhere('d.kind = :k', { k: f.kind });
    if (f.program === 'general') qb.andWhere('d.program_id IS NULL');
    else if (f.program && UUID.test(f.program)) qb.andWhere('d.program_id = :p', { p: f.program });
    const date = /^\d{4}-\d{2}-\d{2}$/;
    if (f.from && date.test(f.from)) qb.andWhere(`(d.created_at AT TIME ZONE 'Asia/Riyadh')::date >= :from`, { from: f.from });
    if (f.to && date.test(f.to)) qb.andWhere(`(d.created_at AT TIME ZONE 'Asia/Riyadh')::date <= :to`, { to: f.to });
    const q = (f.q ?? '').trim().replace(/[%_]/g, '');
    if (q) {
      const n = Number(q.replace(/^W-?/i, ''));
      qb.andWhere(`(d.donor_name ILIKE :q OR d.donor_phone ILIKE :q OR d.program_name ILIKE :q${Number.isInteger(n) && n > 0 ? ' OR d.receipt_no = :n' : ''})`, { q: `%${q}%`, n });
    }
    const rows = await qb.orderBy('d.created_at', 'DESC').take(2000).getMany();
    const paid = rows.filter((r) => r.status === 'paid');
    return {
      rows: rows.map((d) => this.donationRow(d)),
      totals: { count: paid.length, amount: Math.round(paid.reduce((a, r) => a + r.amount, 0) * 100) / 100, pending: rows.filter((r) => r.status === 'pending').length, voucherErrors: paid.filter((r) => !r.voucherId).length },
    };
  }

  async donation(actor: OrgUser, id: string) {
    const d = await this.loadDonation(actor.organizationId, id);
    const [v] = d.voucherId ? await this.db.query('SELECT serial, status FROM acc_vouchers WHERE id = $1', [d.voucherId]).catch(() => []) : [];
    return { ...this.donationRow(d), verifyCode: d.status === 'paid' ? d.verifyCode : null, voucher: v ? { serial: v.serial, status: v.status } : null, payUrl: `/w/${actor.organizationSlug}/pay/${d.payToken}`, receiptUrl: `/w/${actor.organizationSlug}/receipt/${d.payToken}` };
  }

  /** تبرع معلّق لم يُدفع: يلغيه الموظف (مثل تبرع قديم لم يكتمل) */
  async cancelDonation(actor: OrgUser, id: string) {
    const d = await this.loadDonation(actor.organizationId, id);
    if (d.status !== 'pending') throw new ConflictException('يُلغى التبرع غير المدفوع فقط');
    await this.db.getRepository(WebDonation).update({ id }, { status: 'cancelled' });
    if (d.subscriptionId) await this.db.query('UPDATE web_subscriptions SET open_donation_id = NULL WHERE id = $1 AND open_donation_id = $2', [d.subscriptionId, d.id]);
    await this.core.log(actor.organizationId, actor.fullName, 'إلغاء تبرع غير مدفوع', `${d.programName} - ${d.amount} ريال`);
    return this.donation(actor, id);
  }

  // ---------------- التبرع الشهري ----------------

  /** يُصدر رابط سداد لكل اشتراك شهري حل موعده ولم يُصدر له رابط بعد */
  async processDue(org: string) {
    const today = webToday();
    const due = await this.db.getRepository(WebSubscription).createQueryBuilder('s')
      .where(`s.organization_id = :org AND s.status = 'active' AND s.next_due <= :today AND s.open_donation_id IS NULL`, { org, today }).take(200).getMany();
    for (const sub of due) {
      await this.db.transaction(async (em) => {
        const d = await em.getRepository(WebDonation).save({
          organizationId: org, programId: sub.programId, programName: sub.programName, kind: 'project' as DonationKind, amount: sub.amount,
          donorName: sub.donorName, donorPhone: sub.donorPhone, monthly: true, subscriptionId: sub.id, status: 'pending',
          payToken: randomToken(), verifyCode: randomBytes(3).toString('hex').toUpperCase(),
        });
        if (sub.programId) {
          const [p] = await em.query('SELECT store FROM web_programs WHERE id = $1', [sub.programId]);
          if (p?.store?.kind === 'waqf') await em.update(WebDonation, { id: d.id }, { kind: 'waqf' });
        } else await em.update(WebDonation, { id: d.id }, { kind: 'general' });
        await em.update(WebSubscription, { id: sub.id }, { openDonationId: d.id });
      });
    }
    return due.length;
  }

  async subscriptions(actor: OrgUser, origin: string) {
    const org = actor.organizationId;
    await this.processDue(org);
    const s = await this.core.settings(org);
    const rows = await this.db.query(
      `SELECT s.*, to_char(s.next_due, 'YYYY-MM-DD') AS next_due_s, d.pay_token, d.gateway_id FROM web_subscriptions s LEFT JOIN web_donations d ON d.id = s.open_donation_id AND d.status = 'pending'
        WHERE s.organization_id = $1 ORDER BY s.status, s.next_due`, [org]);
    return rows.map((r: Record<string, unknown>) => ({
      id: r.id, programName: r.program_name, amount: Number(r.amount), donorName: r.donor_name, donorPhone: r.donor_phone, status: r.status,
      statusLabel: SUB_STATUS[r.status as string], nextDue: (r.next_due_s as string | null) ?? null, charges: r.charges,
      lastPaidAt: r.last_paid_at, createdAt: r.created_at,
      payLink: r.pay_token ? `${origin}/w/${actor.organizationSlug}/pay/${r.pay_token}` : null, provider: s.payment.provider,
    }));
  }

  async setSubscription(actor: OrgUser, id: string, status: string) {
    if (!UUID.test(id)) throw new NotFoundException('الاشتراك غير موجود');
    const sub = await this.db.getRepository(WebSubscription).findOne({ where: { id, organizationId: actor.organizationId } });
    if (!sub) throw new NotFoundException('الاشتراك غير موجود');
    if (sub.status === 'cancelled') throw new ConflictException('الاشتراك ملغى ولا يُعاد تفعيله، يبدأ المتبرع اشتراكًا جديدًا');
    const patch: Partial<WebSubscription> = { status: status as WebSubscription['status'] };
    if (status === 'active' && sub.nextDue < webToday()) patch.nextDue = webToday();
    await this.db.getRepository(WebSubscription).update({ id }, patch);
    if (status !== 'active' && sub.openDonationId) {
      await this.db.query(`UPDATE web_donations SET status = 'cancelled' WHERE id = $1 AND status = 'pending'`, [sub.openDonationId]);
      await this.db.getRepository(WebSubscription).update({ id }, { openDonationId: null });
    }
    await this.core.log(actor.organizationId, actor.fullName, `${SUB_STATUS[status]}: تبرع شهري`, `${sub.donorName ?? sub.donorPhone} - ${sub.amount} ريال`);
    return { ok: true };
  }

  // ---------------- اللوحة ----------------

  async totals(org: string) {
    const [t] = await this.db.query(
      `SELECT COALESCE(sum(amount) FILTER (WHERE status = 'paid'), 0)::float AS raised, count(*) FILTER (WHERE status = 'paid')::int AS count,
              count(DISTINCT donor_phone) FILTER (WHERE status = 'paid')::int AS donors
         FROM web_donations WHERE organization_id = $1`, [org]);
    return t as { raised: number; count: number; donors: number };
  }
}
