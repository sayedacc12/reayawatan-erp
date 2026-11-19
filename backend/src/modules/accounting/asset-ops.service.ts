import { ConflictException, ForbiddenException, Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import { DataSource, EntityManager, In } from 'typeorm';
import { OrgUser } from '../../core/auth/decorators';
import { AccCore, cents, fromCents, monthOf, today } from './acc-core.service';
import { ACC_PERMISSIONS as P } from './accounting.manifest';
import { LineDto } from './accounting.dto';
import { AccountsService } from './accounts.service';
import {
  amountOf, ASSET_STATUS_AR, AssetsService, bad, dateOf, idOf, IN_BOOKS, MOVE_AR, optId, str,
} from './assets.service';
import { addDays, CalcResult, computeDepreciation, DEP_METHOD_AR, monthEnd, monthStart, PartialRule } from './depreciation';
import { CashAccount, FiscalYear, Partner, Voucher, VoucherStatus } from './entities/accounting.entity';
import { AssetCustody, AssetGroup, AssetMove, AssetMoveStatus, AssetPayMethod, DepLine, DepRun, FixedAsset } from './entities/assets.entity';
import { EntriesService } from './entries.service';
import { VouchersService } from './vouchers.service';

const r2 = (n: number) => fromCents(cents(n));
const PERIOD = /^\d{4}-(0[1-9]|1[0-2])$/;
const METHOD_AR: Record<AssetPayMethod, string> = { cash: 'نقدًا', bank: 'بنكي', credit: 'آجل' };
const MOVE_STATUS_AR: Record<AssetMoveStatus, string> = { pending: 'بانتظار اعتماد السند', done: 'منفذة', cancelled: 'ملغاة' };

interface Scope { period: string; groupIds: string[]; assetIds: string[] }

/** سطر في تقرير الإهلاك لكل أصل */
export interface DepReportAsset {
  assetId: string; code: string; name: string; groupId: string; groupName: string; status: string; custodianName: string | null; location: string | null;
  inServiceDate: string | null; methodLabel: string; rate: number; lifeYears: number | null; salvage: number;
  purchaseCost: number; costOpening: number; additions: number; disposals: number; costClosing: number;
  accumOpening: number; depreciation: number; otherDepreciation: number; accumDisposed: number; accumClosing: number; nbv: number;
  from: string | null; to: string | null; catchUp: boolean; months: { month: string; from: string; to: string; fraction: number; amount: number }[];
  lastDepreciated: string | null; note: string | null;
}

/**
 * عمليات الأصول الثابتة المالية: الشراء والإضافات (بسند صرف يعتمد بمراحله)، التبرع العيني (قيد بسند أصول)، البيع (إهلاك جزئي ثم سند قبض)
 * والتخريد، واحتساب الإهلاك الشهري وترحيله وإلغاؤه بالتسلسل، والمطابقة مع الدليل المحاسبي، ولوحة الأصول.
 */
@Injectable()
export class AssetOpsService implements OnModuleInit {
  constructor(
    private readonly db: DataSource,
    private readonly core: AccCore,
    private readonly accounts: AccountsService,
    private readonly assets: AssetsService,
    private readonly entries: EntriesService,
    private readonly vouchers: VouchersService,
  ) {}

  onModuleInit() {
    this.vouchers.onStatusChange('assets', (em, v, status) => this.onVoucher(em, v, status));
    this.vouchers.onBeforeReverse('assets', (em, v) => this.guardVoucher(em, v));
  }

  // ---------------- أدوات ----------------

  private async yearStartFn(org: string, em: EntityManager) {
    const years = await this.core.years(org, em);
    return (month: string) => {
      const d = `${month}-01`;
      return years.find((y: FiscalYear) => y.startDate <= d && d <= y.endDate)?.startDate ?? `${month.slice(0, 4)}-01-01`;
    };
  }

  private async movesOf(em: EntityManager, ids: string[]) {
    return ids.length ? em.getRepository(AssetMove).find({ where: { assetId: In(ids) }, order: { date: 'ASC', moveNo: 'ASC' } }) : [];
  }

  private async linesOf(em: EntityManager, ids: string[]) {
    return ids.length ? em.getRepository(DepLine).find({ where: { assetId: In(ids), active: true }, order: { toDate: 'ASC' } }) : [];
  }

  /** إهلاك أصل حتى تاريخ */
  private calc(a: FixedAsset, g: AssetGroup, moves: AssetMove[], lines: DepLine[], partial: PartialRule, yearStartOf: (m: string) => string, to: string): CalcResult {
    const pol = this.assets.policy(a, g);
    const done = moves.filter((m) => m.assetId === a.id && m.status === 'done');
    return computeDepreciation({
      inServiceDate: a.inServiceDate!, depreciatedThrough: a.depreciatedThrough, salvage: a.salvageValue, method: pol.method, rate: pol.rate, lifeYears: pol.lifeYears,
      costMoves: done.filter((m) => ['opening', 'purchase', 'donation', 'addition'].includes(m.kind)).map((m) => ({ date: m.date, amount: m.amount })),
      accum: a.accum,
      accumHistory: [
        ...done.filter((m) => m.kind === 'opening').map((m) => ({ date: m.date, amount: m.accumDelta })),
        ...lines.filter((l) => l.assetId === a.id).map((l) => ({ date: l.toDate, amount: l.amount })),
      ],
      yearStartOf, partial,
    }, to);
  }

  /** سطر قيد مع مركز التكلفة إن تطلبه الحساب */
  private async line(em: EntityManager, org: string, accountId: string, debit: number, credit: number, label: string, analyticId: string | null, who: string, partnerId?: string | null): Promise<LineDto> {
    const acc = await this.accounts.postable(org, accountId, em);
    if (acc.requiresAnalytic && !analyticId) bad(`الحساب ${acc.code} «${acc.name}» يلزمه مركز تكلفة. حدده في ${who}`);
    return { accountId, debit: r2(debit), credit: r2(credit), label, partnerId: partnerId ?? null, analytic: analyticId && acc.requiresAnalytic ? [{ analyticId, percent: 100 }] : [] };
  }

  private async newMove(em: EntityManager, actor: OrgUser, d: Partial<AssetMove> & { assetId: string; kind: AssetMove['kind']; date: string }) {
    const org = actor.organizationId;
    return em.getRepository(AssetMove).save(em.create(AssetMove, {
      organizationId: org, moveNo: await this.assets.nextNo(em, 'acc_asset_moves', 'move_no', org), status: 'done', createdByName: actor.fullName, ...d,
    }));
  }

  // ---------------- الشراء والإضافات والتبرع العيني ----------------

  /** شراء أصل جديد أو إضافة على أصل قائم: سند صرف بمراحل الاعتماد، ولا يدخل الأصل الدفاتر إلا باعتماده النهائي */
  async purchase(actor: OrgUser, input: Record<string, unknown>) {
    this.assets.need(actor, P.assetsOperate, 'ليست لديك صلاحية عمليات الأصول');
    const org = actor.organizationId;
    const kind = input.kind === 'addition' ? 'addition' : 'purchase';
    let moveId = '';
    await this.db.transaction(async (em) => {
      await this.assets.lock(em, org);
      const a = await this.assets.load(em, org, idOf(input.assetId, 'الأصل'));
      const g = await this.assets.group(org, a.groupId, em);
      const moves = await this.movesOf(em, [a.id]);
      if (kind === 'purchase') {
        if (a.status !== 'draft') bad(a.status === 'pending_purchase' ? 'للأصل سند شراء ينتظر الاعتماد' : 'الأصل مسجل بقيمته بالفعل. للتحسينات اختر «إضافة على أصل»');
        const cfg = await this.assets.config(org, em);
        if (g.isTangible && cfg.requireCustody && !a.custodianEmployeeId) bad('سلّم الأصل لموظف أولًا (الأصول المادية يجب أن تكون في عهدة موظف)');
      } else {
        if (a.status !== 'active') bad('الإضافة والتحسين على أصل في الخدمة فقط');
        if (moves.some((m) => m.status === 'pending')) bad('للأصل عملية تنتظر اعتماد سندها');
      }
      const date = dateOf(input.date, kind === 'purchase' ? 'تاريخ الشراء' : 'تاريخ الإضافة');
      if (date > today()) bad('التاريخ في المستقبل');
      if (kind === 'addition' && a.depreciatedThrough && date <= a.depreciatedThrough) {
        bad(`احتُسب إهلاك الأصل حتى ${a.depreciatedThrough}، فتكون الإضافة بعد هذا التاريخ ليُعاد احتساب الإهلاك على العمر المتبقي`);
      }
      const amount = amountOf(input.amount, 'المبلغ');
      const pay = await this.payment(em, org, input);
      const label = `${kind === 'purchase' ? 'شراء أصل ثابت' : 'إضافة وتحسين على الأصل'} ${a.code} ${a.name}`;
      const lines = [
        await this.line(em, org, g.assetAccountId, amount, 0, label, null, `مجموعة «${g.name}»`),
        { accountId: pay.accountId!, debit: 0, credit: amount, label, partnerId: pay.partnerId },
      ];
      const v = await this.vouchers.insertSystemDraft(em, actor, 'payment', {
        voucherDate: date, partyName: str(input.partyName, 250) ?? pay.partyName ?? 'المورد', partnerId: pay.partnerId, amount, purpose: str(input.notes, 600) ? `${label}: ${str(input.notes, 600)}` : label,
        sourceType: 'assets', sourceRef: a.code, method: pay.voucherMethod, cashAccountId: pay.cashAccountId, counterAccountId: g.assetAccountId, lines,
      });
      const m = await this.newMove(em, actor, {
        assetId: a.id, kind, date, amount, status: 'pending', method: pay.method, cashAccountId: pay.cashAccountId, partnerId: pay.partnerId,
        partyName: v.partyName, voucherId: v.id, notes: str(input.notes, 1000),
      });
      moveId = m.id;
      if (v.status === 'approved') await this.onVoucher(em, v, 'approved');
      await this.assets.refresh(em, org, a.id);
    });
    return this.operation(actor, moveId);
  }

  /** طريقة السداد أو التحصيل: نقدي أو بنكي (حساب من البنوك والنقدية) أو آجل (حساب الشريك) */
  private async payment(em: EntityManager, org: string, input: Record<string, unknown>) {
    const method = (['cash', 'bank', 'credit'] as const).find((m) => m === input.method) ?? bad('اختر طريقة السداد: نقدي أو بنكي أو آجل');
    if (method === 'credit') {
      const p = await em.getRepository(Partner).findOne({ where: { id: idOf(input.partnerId, 'الشريك (المورد أو العميل)'), organizationId: org } }) ?? bad('الشريك غير موجود');
      if (!p.isActive) bad(`الشريك «${p.name}» موقوف`);
      if (!p.accountId) bad(`اربط الشريك «${p.name}» بحساب في الدليل من شاشة العملاء والموردين`);
      return { method, voucherMethod: 'credit' as const, accountId: p.accountId, partnerId: p.id, cashAccountId: null, partyName: p.name };
    }
    const c = await em.getRepository(CashAccount).findOne({ where: { id: idOf(input.cashAccountId, method === 'bank' ? 'الحساب البنكي' : 'الصندوق'), organizationId: org } }) ?? bad('الحساب غير موجود');
    if (!c.isActive) bad(`«${c.name}» موقوف`);
    if (method === 'bank' && c.kind !== 'bank') bad('اختر حسابًا بنكيًا');
    if (method === 'cash' && c.kind !== 'cash') bad('اختر صندوق نقدية');
    const partnerId = optId(input.partnerId);
    const partner = partnerId ? await em.getRepository(Partner).findOne({ where: { id: partnerId, organizationId: org } }) : null;
    return { method, voucherMethod: method === 'bank' ? 'transfer' as const : 'cash' as const, accountId: c.glAccountId, partnerId: partner?.id ?? null, cashAccountId: c.id, partyName: partner?.name ?? null };
  }

  /** أصل متبرع به عينيًا: يُثبت بقيمته العادلة مقابل حساب التبرعات العينية بسند أصول ثابتة، بدون سند صرف */
  async donation(actor: OrgUser, input: Record<string, unknown>) {
    this.assets.need(actor, P.assetsOperate, 'ليست لديك صلاحية عمليات الأصول');
    const org = actor.organizationId;
    let moveId = '';
    await this.db.transaction(async (em) => {
      await this.assets.lock(em, org);
      const a = await this.assets.load(em, org, idOf(input.assetId, 'الأصل'));
      if (a.status !== 'draft') bad('التبرع العيني لأصل مسجل بلا قيمة فقط');
      const g = await this.assets.group(org, a.groupId, em);
      const cfg = await this.assets.config(org, em);
      if (g.isTangible && cfg.requireCustody && !a.custodianEmployeeId) bad('سلّم الأصل لموظف أولًا (الأصول المادية يجب أن تكون في عهدة موظف)');
      const date = dateOf(input.date, 'تاريخ الاستلام');
      if (date > today()) bad('التاريخ في المستقبل');
      const value = amountOf(input.amount, 'القيمة العادلة');
      const counter = optId(input.counterAccountId) ?? cfg.donationAccountId ?? bad('اختر حساب التبرعات العينية، أو حدده في إعدادات الأصول');
      const donor = str(input.partyName, 250) ?? 'متبرع';
      const label = `تبرع عيني بأصل ثابت ${a.code} ${a.name} من ${donor}`;
      const analytic = a.analyticId ?? g.analyticId;
      const entry = await this.entries.createAssetEntry(em, actor, 'asset', { documentDate: date, description: label, counterparty: donor }, [
        await this.line(em, org, g.assetAccountId, value, 0, label, analytic, `مجموعة «${g.name}»`),
        await this.line(em, org, counter, 0, value, label, analytic, `مجموعة «${g.name}»`),
      ]);
      const m = await this.newMove(em, actor, { assetId: a.id, kind: 'donation', date, amount: value, counterAccountId: counter, partyName: donor, entryId: entry.id, notes: str(input.notes, 1000) });
      moveId = m.id;
      await this.assets.refresh(em, org, a.id);
    });
    return this.operation(actor, moveId);
  }

  // ---------------- البيع والتخريد ----------------

  /** إهلاك جزئي من آخر إهلاك حتى تاريخ الاستبعاد (قبل البيع أو التخريد) */
  private async partialDep(em: EntityManager, actor: OrgUser, a: FixedAsset, g: AssetGroup, date: string, label: string) {
    const org = actor.organizationId;
    if (a.depreciatedThrough && a.depreciatedThrough > date) {
      bad(`احتُسب إهلاك الأصل حتى ${a.depreciatedThrough}، وتاريخ ${label} قبله. ألغِ حركات الإهلاك اللاحقة أولًا من سجل حركات الإهلاك`);
    }
    const cfg = await this.assets.config(org, em);
    const moves = await this.movesOf(em, [a.id]);
    const lines = await this.linesOf(em, [a.id]);
    const res = this.calc(a, g, moves, lines, cfg.partialMonth, await this.yearStartFn(org, em), date);
    if (res.amount <= 0) return null;
    const run = await this.postRun(em, actor, 'disposal', monthOf(date), date, { assetIds: [a.id], label: `إهلاك جزئي حتى ${label}: ${a.code}` },
      [{ asset: a, group: g, res }]);
    return run;
  }

  async sale(actor: OrgUser, input: Record<string, unknown>) {
    this.assets.need(actor, P.assetsOperate, 'ليست لديك صلاحية عمليات الأصول');
    const org = actor.organizationId;
    let moveId = '';
    await this.db.transaction(async (em) => {
      await this.assets.lock(em, org);
      let a = await this.assets.load(em, org, idOf(input.assetId, 'الأصل'));
      if (a.status !== 'active') bad(a.status === 'pending_sale' ? 'للأصل سند بيع ينتظر الاعتماد' : 'البيع لأصل في الخدمة فقط');
      const moves = await this.movesOf(em, [a.id]);
      if (moves.some((m) => m.status === 'pending')) bad('للأصل عملية تنتظر اعتماد سندها');
      const g = await this.assets.group(org, a.groupId, em);
      const date = dateOf(input.date, 'تاريخ البيع');
      if (date > today()) bad('تاريخ البيع في المستقبل');
      if (a.inServiceDate && date < a.inServiceDate) bad('تاريخ البيع قبل تاريخ شراء الأصل');
      const price = amountOf(input.price, 'قيمة البيع');
      const pay = await this.payment(em, org, input);
      // الخطوة الأولى: إهلاك من آخر إهلاك محتسب حتى تاريخ البيع
      const run = await this.partialDep(em, actor, a, g, date, 'البيع');
      a = await this.assets.load(em, org, a.id);
      // الخطوة الثانية: سند قبض بعكس حسابات الأصل حسب طبيعتها والفرق أرباح أو خسائر
      const cost = a.cost;
      const accum = a.accum;
      const nbv = r2(cost - accum);
      const gain = r2(price - nbv);
      const label = `بيع الأصل الثابت ${a.code} ${a.name}`;
      const analytic = a.analyticId ?? g.analyticId;
      const lines: LineDto[] = [{ accountId: pay.accountId!, debit: price, credit: 0, label, partnerId: pay.partnerId }];
      if (accum > 0) lines.push(await this.line(em, org, g.accumAccountId ?? bad(`حدد حساب مجمع الإهلاك لمجموعة «${g.name}»`), accum, 0, label, analytic, `مجموعة «${g.name}»`));
      lines.push(await this.line(em, org, g.assetAccountId, 0, cost, label, analytic, `مجموعة «${g.name}»`));
      if (gain !== 0) lines.push(await this.line(em, org, g.gainLossAccountId, gain < 0 ? -gain : 0, gain > 0 ? gain : 0, `${gain > 0 ? 'ربح' : 'خسارة'} بيع الأصل ${a.code}`, analytic, `مجموعة «${g.name}»`));
      const v = await this.vouchers.insertSystemDraft(em, actor, 'receipt', {
        voucherDate: date, partyName: str(input.partyName, 250) ?? pay.partyName ?? 'المشتري', partnerId: pay.partnerId, amount: price,
        purpose: str(input.notes, 600) ? `${label}: ${str(input.notes, 600)}` : label, sourceType: 'assets', sourceRef: a.code, method: pay.voucherMethod,
        cashAccountId: pay.cashAccountId, counterAccountId: g.assetAccountId, lines,
      });
      const m = await this.newMove(em, actor, {
        assetId: a.id, kind: 'sale', date, amount: -cost, accumDelta: -accum, proceeds: price, gainLoss: gain, status: 'pending', method: pay.method,
        cashAccountId: pay.cashAccountId, partnerId: pay.partnerId, partyName: v.partyName, voucherId: v.id, depRunId: run?.id ?? null, notes: str(input.notes, 1000),
      });
      moveId = m.id;
      await this.assets.refresh(em, org, a.id);
    });
    return this.operation(actor, moveId);
  }

  async scrap(actor: OrgUser, input: Record<string, unknown>) {
    this.assets.need(actor, P.assetsOperate, 'ليست لديك صلاحية عمليات الأصول');
    const org = actor.organizationId;
    let moveId = '';
    await this.db.transaction(async (em) => {
      await this.assets.lock(em, org);
      let a = await this.assets.load(em, org, idOf(input.assetId, 'الأصل'));
      if (a.status !== 'active') bad('التخريد لأصل في الخدمة فقط');
      const moves = await this.movesOf(em, [a.id]);
      if (moves.some((m) => m.status === 'pending')) bad('للأصل عملية تنتظر اعتماد سندها');
      const g = await this.assets.group(org, a.groupId, em);
      const date = dateOf(input.date, 'تاريخ التخريد');
      if (date > today()) bad('تاريخ التخريد في المستقبل');
      const reason = str(input.notes, 1000) ?? bad('اكتب سبب التخريد');
      const run = await this.partialDep(em, actor, a, g, date, 'التخريد');
      a = await this.assets.load(em, org, a.id);
      const nbv = r2(a.cost - a.accum);
      const label = `تخريد الأصل الثابت ${a.code} ${a.name}`;
      const analytic = a.analyticId ?? g.analyticId;
      const lines: LineDto[] = [];
      if (a.accum > 0) lines.push(await this.line(em, org, g.accumAccountId ?? bad(`حدد حساب مجمع الإهلاك لمجموعة «${g.name}»`), a.accum, 0, label, analytic, `مجموعة «${g.name}»`));
      if (nbv > 0) lines.push(await this.line(em, org, g.gainLossAccountId, nbv, 0, `خسارة تخريد الأصل ${a.code}`, analytic, `مجموعة «${g.name}»`));
      lines.push(await this.line(em, org, g.assetAccountId, 0, a.cost, label, analytic, `مجموعة «${g.name}»`));
      const entry = await this.entries.createAssetEntry(em, actor, 'asset', { documentDate: date, description: `${label}. السبب: ${reason}` }, lines);
      const m = await this.newMove(em, actor, {
        assetId: a.id, kind: 'scrap', date, amount: -a.cost, accumDelta: -a.accum, gainLoss: -nbv, entryId: entry.id, depRunId: run?.id ?? null, notes: reason,
      });
      moveId = m.id;
      await this.release(em, actor, a, date, 'إنهاء العهدة بتخريد الأصل');
      await this.assets.refresh(em, org, a.id);
    });
    return this.operation(actor, moveId);
  }

  private async release(em: EntityManager, actor: { fullName: string; organizationId: string }, a: FixedAsset, date: string, notes: string) {
    if (!a.custodianEmployeeId) return;
    await this.assets.addCustody(em, actor, a, { kind: 'release', toEmployeeId: null, toLocation: a.location, date, condition: null, notes });
  }

  /** إعادة العهدة لآخر موظف كان الأصل في عهدته (بعد إلغاء بيع أو تخريد) */
  private async restoreCustody(em: EntityManager, actor: { fullName: string; organizationId: string }, assetId: string, date: string, notes: string) {
    const last = await em.getRepository(AssetCustody).findOne({ where: { assetId }, order: { formNo: 'DESC' } });
    if (!last || last.kind !== 'release' || !last.fromEmployeeId) return;
    const a = await this.assets.load(em, actor.organizationId, assetId);
    await this.assets.addCustody(em, actor, a, { kind: 'issue', toEmployeeId: last.fromEmployeeId, toLocation: last.fromLocation, date, condition: null, notes });
  }

  /** إلغاء عملية لا تمر بسند قبض أو صرف (التبرع العيني والتخريد): يُلغى قيدها ويبقى رقمه */
  async cancelOperation(actor: OrgUser, id: string, reasonIn: unknown) {
    this.assets.need(actor, P.assetsReverse, 'ليست لديك صلاحية إلغاء عمليات الأصول');
    const org = actor.organizationId;
    const reason = str(reasonIn, 1000) ?? bad('اكتب سبب الإلغاء');
    await this.db.transaction(async (em) => {
      await this.assets.lock(em, org);
      const m = await em.getRepository(AssetMove).findOne({ where: { id, organizationId: org } }) ?? bad('العملية غير موجودة');
      if (m.status === 'cancelled') bad('العملية ملغاة بالفعل');
      if (m.voucherId) bad('هذه العملية بسند قبض أو صرف، وتُلغى من شاشة السند في النظام المالي حسب صلاحيات السندات');
      if (m.kind === 'opening') bad('الرصيد الافتتاحي يُعدَّل أو يُحذف من شاشة الأرصدة الافتتاحية');
      if (m.kind === 'donation') {
        const lines = await this.linesOf(em, [m.assetId]);
        if (lines.length) bad('احتُسب إهلاك للأصل بعد استلامه، فلا يُلغى التبرع إلا بعد إلغاء حركات الإهلاك');
        const later = await em.getRepository(AssetMove).count({ where: { assetId: m.assetId, status: In(['pending', 'done']) } });
        if (later > 1) bad('للأصل عمليات بعد التبرع، فلا يُلغى');
      }
      if (m.entryId) await this.entries.cancelAssetEntry(em, actor, m.entryId, `إلغاء ${MOVE_AR[m.kind]} من الأصول الثابتة: ${reason}`);
      await em.getRepository(AssetMove).update({ id }, { status: 'cancelled', cancelledByName: actor.fullName, cancelReason: reason });
      if (m.kind === 'scrap') await this.restoreCustody(em, actor, m.assetId, today(), 'إعادة العهدة بعد إلغاء التخريد');
      await this.assets.refresh(em, org, m.assetId);
    });
    return this.operation(actor, id);
  }

  // ---------------- ربط سندات القبض والصرف ----------------

  private async onVoucher(em: EntityManager, v: Voucher, status: VoucherStatus) {
    const m = await em.getRepository(AssetMove).findOne({ where: { voucherId: v.id } });
    if (!m) return;
    const next: AssetMoveStatus = status === 'approved' ? 'done' : status === 'rejected' || status === 'cancelled' ? 'cancelled' : 'pending';
    if (next === m.status) return;
    const who = { fullName: 'النظام المالي', organizationId: m.organizationId };
    await em.getRepository(AssetMove).update({ id: m.id }, {
      status: next, ...(next === 'cancelled' ? { cancelledByName: who.fullName, cancelReason: `${status === 'rejected' ? 'رُفض' : 'أُلغي'} سند ${v.kind === 'receipt' ? 'القبض' : 'الصرف'} رقم ${v.serial}` } : {}),
    });
    if (m.kind === 'sale') {
      const a = await this.assets.load(em, m.organizationId, m.assetId);
      if (next === 'done') await this.release(em, who, a, m.date, 'إنهاء العهدة ببيع الأصل');
      else if (m.status === 'done') await this.restoreCustody(em, who, m.assetId, today(), 'إعادة العهدة بعد إلغاء سند البيع');
    }
    await this.assets.refresh(em, m.organizationId, m.assetId);
  }

  /** لا يُعكس سند شراء أو إضافة احتُسب بعده إهلاك أو استُبعد الأصل */
  private async guardVoucher(em: EntityManager, v: Voucher) {
    const m = await em.getRepository(AssetMove).findOne({ where: { voucherId: v.id } });
    if (!m || m.kind === 'sale') return;
    const [dep] = await em.query('SELECT COUNT(*)::int AS n FROM acc_asset_dep_lines WHERE asset_id = $1 AND active AND to_date >= $2', [m.assetId, m.date]);
    if (dep.n) throw new ConflictException('احتُسب إهلاك للأصل بعد هذا السند، فلا يُعكس إلا بعد إلغاء حركات الإهلاك من سجل حركات الإهلاك في الأصول الثابتة');
    const [d] = await em.query(`SELECT COUNT(*)::int AS n FROM acc_asset_moves WHERE asset_id = $1 AND kind IN ('sale', 'scrap') AND status <> 'cancelled'`, [m.assetId]);
    if (d.n) throw new ConflictException('الأصل مستبعد بالبيع أو التخريد، فلا يُعكس سند شرائه');
  }

  // ---------------- سجل العمليات ----------------

  async operations(actor: OrgUser, f: { kind?: string; status?: string; assetId?: string }) {
    const org = actor.organizationId;
    const rows: Record<string, unknown>[] = await this.db.query(
      `SELECT m.id FROM acc_asset_moves m WHERE m.organization_id = $1 AND m.kind <> 'opening'
          AND ($2::text IS NULL OR m.kind = $2) AND ($3::text IS NULL OR m.status = $3) AND ($4::uuid IS NULL OR m.asset_id = $4)
        ORDER BY m.date DESC, m.move_no DESC LIMIT 1000`, [org, f.kind || null, f.status || null, f.assetId || null]);
    return this.opViews(org, rows.map((r) => String(r.id)));
  }

  async operation(actor: OrgUser, id: string) {
    const [v] = await this.opViews(actor.organizationId, [id]);
    if (!v) throw new NotFoundException('العملية غير موجودة');
    return v;
  }

  private async opViews(org: string, ids: string[]) {
    if (!ids.length) return [];
    const rows: Record<string, string | number | null>[] = await this.db.query(
      `SELECT m.id, m.move_no, m.kind, to_char(m.date, 'YYYY-MM-DD') AS date, m.amount, m.accum_delta, m.proceeds, m.gain_loss, m.method, m.party_name, m.status,
              m.notes, m.created_by_name, m.cancel_reason, m.asset_id, a.code, a.name, g.name AS group_name,
              v.id AS voucher_id, v.kind AS voucher_kind, v.serial AS voucher_serial, v.status AS voucher_status,
              e.id AS entry_id, e.entry_no, e.voucher_type, e.voucher_serial AS entry_serial, e.status AS entry_status, y.name AS year,
              r.id AS run_id, r.run_no, r.total AS run_total
         FROM acc_asset_moves m JOIN acc_assets a ON a.id = m.asset_id JOIN acc_asset_groups g ON g.id = a.group_id
         LEFT JOIN acc_vouchers v ON v.id = m.voucher_id LEFT JOIN acc_entries e ON e.id = m.entry_id LEFT JOIN acc_fiscal_years y ON y.id = e.fiscal_year_id
         LEFT JOIN acc_asset_dep_runs r ON r.id = m.dep_run_id
        WHERE m.organization_id = $1 AND m.id = ANY($2) ORDER BY m.date DESC, m.move_no DESC`, [org, ids]);
    return rows.map((r) => ({
      id: r.id, moveNo: r.move_no, kind: r.kind, kindLabel: MOVE_AR[String(r.kind)], date: r.date, amount: Math.abs(Number(r.amount)), accum: Math.abs(Number(r.accum_delta)),
      proceeds: Number(r.proceeds), gainLoss: Number(r.gain_loss), method: r.method, methodLabel: r.method ? METHOD_AR[r.method as AssetPayMethod] : null, partyName: r.party_name,
      status: r.status, statusLabel: MOVE_STATUS_AR[r.status as AssetMoveStatus], notes: r.notes, createdByName: r.created_by_name, cancelReason: r.cancel_reason,
      asset: { id: r.asset_id, code: r.code, name: r.name, groupName: r.group_name },
      voucher: r.voucher_id ? { id: r.voucher_id, kind: r.voucher_kind, serial: r.voucher_serial, status: r.voucher_status } : null,
      entry: r.entry_id ? { id: r.entry_id, entryNo: r.entry_no, voucherNo: `${r.entry_serial}/${r.year}`, status: r.entry_status } : null,
      depRun: r.run_id ? { id: r.run_id, runNo: r.run_no, total: Number(r.run_total) } : null,
    }));
  }

  // ---------------- الإهلاك ----------------

  private scopeOf(input: Record<string, unknown>): Scope {
    const period = typeof input.period === 'string' && PERIOD.test(input.period) ? input.period : bad('اختر الشهر');
    if (period > monthOf(today())) bad('لا يُحتسب إهلاك لشهر لم يبدأ بعد');
    const ids = (v: unknown) => (Array.isArray(v) ? v : typeof v === 'string' && v ? v.split(',') : []).map(optId).filter(Boolean) as string[];
    return { period, groupIds: ids(input.groupIds), assetIds: ids(input.assetIds) };
  }

  /** الأصول المرشحة للإهلاك ونتيجة احتساب كل منها */
  private async candidates(em: EntityManager, org: string, s: Scope) {
    const to = monthEnd(`${s.period}-01`);
    const qb = em.getRepository(FixedAsset).createQueryBuilder('a').where(`a.organization_id = :org AND a.status = 'active'`, { org });
    if (s.groupIds.length) qb.andWhere('a.group_id IN (:...g)', { g: s.groupIds });
    if (s.assetIds.length) qb.andWhere('a.id IN (:...ids)', { ids: s.assetIds });
    const assets = await qb.orderBy('a.asset_no', 'ASC').getMany();
    const groups = await em.getRepository(AssetGroup).find({ where: { organizationId: org } });
    const ids = assets.map((a) => a.id);
    const [moves, lines] = await Promise.all([this.movesOf(em, ids), this.linesOf(em, ids)]);
    const cfg = await this.assets.config(org, em);
    const ys = await this.yearStartFn(org, em);
    return {
      to, moves, lines, groups,
      items: assets.map((a) => {
        const g = groups.find((x) => x.id === a.groupId)!;
        return { asset: a, group: g, res: a.inServiceDate ? this.calc(a, g, moves, lines, cfg.partialMonth, ys, to) : null };
      }),
    };
  }

  private async scopeLabel(em: EntityManager, s: Scope) {
    if (s.assetIds.length) {
      const a = await em.getRepository(FixedAsset).find({ where: { id: In(s.assetIds) }, select: ['code'] });
      return `أصول محددة: ${a.map((x) => x.code).join('، ')}`;
    }
    if (s.groupIds.length) {
      const g = await em.getRepository(AssetGroup).find({ where: { id: In(s.groupIds) }, select: ['name'] });
      return `مجموعات: ${g.map((x) => x.name).join('، ')}`;
    }
    return 'كل الأصول';
  }

  /** «بدء الاحتساب»: تقرير الإهلاك للفترة قبل الترحيل */
  async preview(actor: OrgUser, input: Record<string, unknown>) {
    this.assets.need(actor, P.assetsDepreciate, 'ليست لديك صلاحية احتساب الإهلاك');
    const org = actor.organizationId;
    const s = this.scopeOf(input);
    const em = this.db.manager;
    const c = await this.candidates(em, org, s);
    const included = c.items.filter((i) => i.res && i.res.amount > 0);
    const skipped = c.items.filter((i) => !i.res || i.res.amount <= 0).map((i) => ({
      assetId: i.asset.id, code: i.asset.code, name: i.asset.name, groupName: i.group.name,
      reason: !i.res ? 'لا يوجد تاريخ شراء' : i.res.reason ?? 'لا يوجد إهلاك في الفترة',
    }));
    let blocked: string | null = null;
    try {
      await this.core.assertWritable(org, c.to);
    } catch (e) {
      blocked = (e as Error).message;
    }
    const pending: { n: number }[] = await this.db.query(
      `SELECT COUNT(*)::int AS n FROM acc_asset_moves m JOIN acc_assets a ON a.id = m.asset_id WHERE m.organization_id = $1 AND m.status = 'pending' AND m.kind IN ('purchase', 'addition')
          AND ($2::uuid[] IS NULL OR a.group_id = ANY($2))`, [org, s.groupIds.length ? s.groupIds : null]);
    const report = await this.report(em, org, s.period, c.to, included.map((i) => ({
      assetId: i.asset.id, amount: i.res!.amount, from: i.res!.from, to: i.res!.to, months: i.res!.months,
    })), c.items.map((i) => i.asset.id));
    return {
      period: s.period, toDate: c.to, scope: s, scopeLabel: await this.scopeLabel(em, s), ...report, skipped, blocked,
      pendingPurchases: pending[0]?.n ?? 0, canPost: !blocked && included.length > 0,
    };
  }

  /** «ترحيل قيد الإهلاك»: يعيد الاحتساب داخل معاملة واحدة ثم يصدر سند إهلاك مرحّلًا ويسجل الحركة في سجل الإهلاك */
  async post(actor: OrgUser, input: Record<string, unknown>) {
    this.assets.need(actor, P.assetsDepreciate, 'ليست لديك صلاحية ترحيل الإهلاك');
    const org = actor.organizationId;
    const s = this.scopeOf(input);
    const runId = await this.db.transaction(async (em) => {
      await this.assets.lock(em, org);
      const c = await this.candidates(em, org, s);
      const items = c.items.filter((i) => i.res && i.res.amount > 0) as { asset: FixedAsset; group: AssetGroup; res: CalcResult }[];
      if (!items.length) bad('لا يوجد إهلاك مستحق للترحيل في هذه الفترة (ربما احتُسب من قبل)');
      const expected = input.expectedTotal === undefined ? null : cents(Number(input.expectedTotal));
      const total = items.reduce((x, i) => x + cents(i.res.amount), 0);
      if (expected !== null && expected !== total) throw new ConflictException('تغيرت بيانات الأصول منذ عرض التقرير. أعد الاحتساب ثم رحّل');
      const run = await this.postRun(em, actor, 'period', s.period, c.to, { groupIds: s.groupIds, assetIds: s.assetIds, label: await this.scopeLabel(em, s) }, items);
      return run.id;
    });
    return this.run(actor, runId);
  }

  /** ترحيل عملية إهلاك: سند إهلاك (مدين مصروف الإهلاك، دائن مجمع الإهلاك لكل مجموعة) وسطر لكل أصل */
  private async postRun(em: EntityManager, actor: OrgUser, kind: 'period' | 'disposal', period: string, toDate: string, scope: DepRun['scope'],
    items: { asset: FixedAsset; group: AssetGroup; res: CalcResult }[]) {
    const org = actor.organizationId;
    const byGroup = new Map<string, { group: AssetGroup; total: number; byAnalytic: Map<string, number> }>();
    for (const i of items) {
      const k = byGroup.get(i.group.id) ?? { group: i.group, total: 0, byAnalytic: new Map() };
      k.total += cents(i.res.amount);
      const an = i.asset.analyticId ?? i.group.analyticId ?? '';
      k.byAnalytic.set(an, (k.byAnalytic.get(an) ?? 0) + cents(i.res.amount));
      byGroup.set(i.group.id, k);
    }
    const periodLabel = kind === 'period' ? `شهر ${period}` : `الفترة حتى ${toDate}`;
    const lines: LineDto[] = [];
    for (const { group: g, total, byAnalytic } of byGroup.values()) {
      if (!g.expenseAccountId || !g.accumAccountId) bad(`حدد حساب مصروف الإهلاك وحساب مجمع الإهلاك لمجموعة «${g.name}»`);
      for (const [an, amt] of byAnalytic) {
        lines.push(await this.line(em, org, g.expenseAccountId!, fromCents(amt), 0, `مصروف إهلاك ${g.name} عن ${periodLabel}`, an || null, `مجموعة «${g.name}» أو بطاقة الأصل`));
      }
      lines.push(await this.line(em, org, g.accumAccountId!, 0, fromCents(total), `مجمع إهلاك ${g.name} عن ${periodLabel}`, null, `مجموعة «${g.name}»`));
    }
    const total = fromCents(items.reduce((x, i) => x + cents(i.res.amount), 0));
    const runNo = await this.assets.nextNo(em, 'acc_asset_dep_runs', 'run_no', org);
    const entry = await this.entries.createAssetEntry(em, actor, 'depreciation', {
      documentDate: toDate, description: `${kind === 'period' ? 'إهلاك الأصول الثابتة' : 'إهلاك جزئي قبل الاستبعاد'} عن ${periodLabel} (حركة إهلاك رقم ${runNo}) · ${scope.label}`,
    }, lines);
    const run = await em.getRepository(DepRun).save(em.create(DepRun, {
      organizationId: org, runNo, kind, period, toDate, scope, total, assetCount: items.length, entryId: entry.id, status: 'posted', createdByName: actor.fullName,
    }));
    await em.getRepository(DepLine).save(items.map((i) => em.create(DepLine, {
      organizationId: org, runId: run.id, assetId: i.asset.id, groupId: i.group.id, fromDate: i.res.from!, toDate: i.res.to, amount: i.res.amount,
      accumBefore: i.asset.accum, cost: i.asset.cost, months: i.res.months, active: true,
    })));
    for (const i of items) await this.assets.refresh(em, org, i.asset.id);
    return run;
  }

  /**
   * تقرير الإهلاك بطريقة عرض الميزانية: لكل مجموعة رصيد الأصول أول الفترة والإضافات والاستبعادات ورصيد آخر الفترة،
   * ثم مجمع الإهلاك أول الفترة والإهلاك المحتسب ومجمع آخر الفترة، وصفحة لكل أصل.
   */
  private async report(em: EntityManager, org: string, period: string, to: string,
    dep: { assetId: string; amount: number; from: string | null; to: string; months: DepReportAsset['months'] }[], scopeIds: string[]) {
    const ps = monthStart(`${period}-01`);
    const pe = to;
    const ids = [...new Set([...scopeIds, ...dep.map((d) => d.assetId)])];
    const assets = ids.length ? await em.getRepository(FixedAsset).find({ where: { id: In(ids) }, order: { assetNo: 'ASC' } }) : [];
    const groups = await em.getRepository(AssetGroup).find({ where: { organizationId: org } });
    const moves = (await this.movesOf(em, ids)).filter((m) => m.status === 'done');
    const lines = await this.linesOf(em, ids);
    const runLineIds = new Set(dep.map((d) => d.assetId));
    const emps = await this.assets.employees(org, [...new Set(assets.map((a) => a.custodianEmployeeId).filter(Boolean))] as string[], em);
    const rows: DepReportAsset[] = [];
    for (const a of assets) {
      const g = groups.find((x) => x.id === a.groupId)!;
      const mv = moves.filter((m) => m.assetId === a.id);
      const ln = lines.filter((l) => l.assetId === a.id);
      const d = dep.find((x) => x.assetId === a.id);
      const isAcq = (m: AssetMove) => ['opening', 'purchase', 'donation', 'addition'].includes(m.kind);
      const isDisp = (m: AssetMove) => m.kind === 'sale' || m.kind === 'scrap';
      const sum = (xs: number[]) => r2(xs.reduce((s, x) => s + x, 0));
      const costOpening = sum(mv.filter((m) => m.date < ps).map((m) => m.amount));
      const additions = sum(mv.filter((m) => isAcq(m) && m.date >= ps && m.date <= pe).map((m) => m.amount));
      const disposals = sum(mv.filter((m) => isDisp(m) && m.date >= ps && m.date <= pe).map((m) => -m.amount));
      const inBooksDuringPeriod = costOpening !== 0 || additions !== 0 || disposals !== 0;
      if (!inBooksDuringPeriod && !d) continue;
      // في التقرير المعروض قبل الترحيل: الإهلاك المحتسب لم يُرحَّل بعد، وبعد الترحيل يُستبعد من «إهلاك آخر» حتى لا يتكرر
      const runLines = d ? ln.filter((l) => l.toDate === d.to && l.fromDate === d.from && runLineIds.has(a.id)) : [];
      const accumOpening = sum([...mv.filter((m) => m.kind === 'opening' && m.date < ps).map((m) => m.accumDelta), ...ln.filter((l) => l.toDate < ps).map((l) => l.amount),
        ...mv.filter((m) => isDisp(m) && m.date < ps).map((m) => m.accumDelta)]);
      const otherDepreciation = sum([...ln.filter((l) => l.toDate >= ps && l.toDate <= pe && !runLines.includes(l)).map((l) => l.amount),
        ...mv.filter((m) => m.kind === 'opening' && m.date >= ps && m.date <= pe).map((m) => m.accumDelta)]);
      const depreciation = d?.amount ?? 0;
      const accumDisposed = sum(mv.filter((m) => isDisp(m) && m.date >= ps && m.date <= pe).map((m) => -m.accumDelta));
      // إهلاك يسبق الفترة لم يُرحَّل وقت عرضه (احتساب متأخر) يدخل في الإهلاك المحتسب، فأول الفترة كما هو في الدفاتر
      const costClosing = r2(costOpening + additions - disposals);
      const accumClosing = r2(accumOpening + depreciation + otherDepreciation - accumDisposed);
      const pol = this.assets.policy(a, g);
      const firstAcq = mv.find((m) => m.kind !== 'addition' && isAcq(m));
      rows.push({
        assetId: a.id, code: a.code, name: a.name, groupId: g.id, groupName: g.name, status: ASSET_STATUS_AR[a.status],
        custodianName: emps.find((e) => e.id === a.custodianEmployeeId)?.fullName ?? null, location: a.location,
        inServiceDate: a.inServiceDate, methodLabel: DEP_METHOD_AR[pol.method], rate: pol.rate, lifeYears: pol.life ? r2(pol.life) : null, salvage: a.salvageValue,
        purchaseCost: firstAcq?.amount ?? 0, costOpening, additions, disposals, costClosing, accumOpening, depreciation, otherDepreciation, accumDisposed, accumClosing,
        nbv: r2(costClosing - accumClosing), from: d?.from ?? null, to: d?.to ?? null, catchUp: !!d?.from && d.from < ps, months: d?.months ?? [],
        lastDepreciated: a.depreciatedThrough, note: null,
      });
    }
    const keys = ['costOpening', 'additions', 'disposals', 'costClosing', 'accumOpening', 'depreciation', 'otherDepreciation', 'accumDisposed', 'accumClosing', 'nbv'] as const;
    const groupRows = groups.filter((g) => rows.some((r) => r.groupId === g.id)).map((g) => {
      const rs = rows.filter((r) => r.groupId === g.id);
      return { groupId: g.id, groupName: g.name, assets: rs.length, ...Object.fromEntries(keys.map((k) => [k, r2(rs.reduce((s, r) => s + r[k], 0))])) } as Record<string, unknown>;
    });
    const totals = Object.fromEntries(keys.map((k) => [k, r2(rows.reduce((s, r) => s + r[k], 0))]));
    return { groups: groupRows, assets: rows, totals, total: r2(dep.reduce((s, d) => s + d.amount, 0)), assetCount: dep.length };
  }

  async runs(actor: OrgUser) {
    const org = actor.organizationId;
    const rows: Record<string, string | number | null>[] = await this.db.query(
      `SELECT r.id, r.run_no, r.kind, r.period, to_char(r.to_date, 'YYYY-MM-DD') AS to_date, r.scope, r.total, r.asset_count, r.status, r.created_by_name, r.created_at,
              r.cancelled_at, r.cancelled_by_name, r.cancel_reason, e.id AS entry_id, e.entry_no, e.voucher_serial, y.name AS year
         FROM acc_asset_dep_runs r LEFT JOIN acc_entries e ON e.id = r.entry_id LEFT JOIN acc_fiscal_years y ON y.id = e.fiscal_year_id
        WHERE r.organization_id = $1 ORDER BY r.to_date DESC, r.run_no DESC`, [org]);
    const views = rows.map((r) => this.runView(r));
    // آخر حركة نشطة لكل أصل تحدد ما يمكن إلغاؤه (لا يُلغى إهلاك من المنتصف)
    const blockers = await this.cancelBlockers(this.db.manager, org, views.filter((v) => v.status === 'posted').map((v) => String(v.id)));
    return views.map((v) => ({ ...v, cancelBlock: v.status === 'posted' ? blockers.get(String(v.id)) ?? null : null }));
  }

  private runView(r: Record<string, string | number | null | unknown>) {
    return {
      id: r.id as string, runNo: Number(r.run_no), kind: r.kind as string, kindLabel: r.kind === 'period' ? 'إهلاك فترة' : 'إهلاك جزئي قبل الاستبعاد', period: r.period as string,
      toDate: r.to_date as string, scope: r.scope as DepRun['scope'], total: Number(r.total), assetCount: Number(r.asset_count), status: r.status as string,
      statusLabel: r.status === 'posted' ? 'مرحّل' : 'ملغي', createdByName: r.created_by_name, createdAt: r.created_at, cancelledAt: r.cancelled_at,
      cancelledByName: r.cancelled_by_name, cancelReason: r.cancel_reason,
      entry: r.entry_id ? { id: r.entry_id as string, entryNo: Number(r.entry_no), voucherNo: `${r.voucher_serial}/${r.year}` } : null,
    };
  }

  /** موانع إلغاء كل حركة إهلاك: حركات إهلاك لاحقة نشطة لنفس الأصول، أو بيع أو تخريد بعدها */
  private async cancelBlockers(em: EntityManager, org: string, runIds: string[]) {
    const out = new Map<string, string>();
    if (!runIds.length) return out;
    const later: { run_id: string; later_run: number; code: string }[] = await em.query(
      `SELECT DISTINCT ON (l.run_id) l.run_id, r2.run_no AS later_run, a.code
         FROM acc_asset_dep_lines l JOIN acc_asset_dep_lines l2 ON l2.asset_id = l.asset_id AND l2.active AND l2.run_id <> l.run_id AND l2.to_date > l.to_date
         JOIN acc_asset_dep_runs r2 ON r2.id = l2.run_id JOIN acc_assets a ON a.id = l.asset_id
        WHERE l.run_id = ANY($1) AND l.active ORDER BY l.run_id, l2.to_date DESC`, [runIds]);
    for (const x of later) out.set(x.run_id, `ألغِ أولًا حركة الإهلاك اللاحقة رقم ${x.later_run} (الأصل ${x.code})، لأن الإلغاء يكون من الأحدث إلى الأقدم`);
    const disp: { run_id: string; kind: string; code: string }[] = await em.query(
      `SELECT DISTINCT ON (l.run_id) l.run_id, m.kind, a.code FROM acc_asset_dep_lines l
         JOIN acc_asset_moves m ON m.asset_id = l.asset_id AND m.kind IN ('sale', 'scrap') AND m.status <> 'cancelled' AND m.date >= l.to_date
         JOIN acc_assets a ON a.id = l.asset_id
        WHERE l.run_id = ANY($1) AND l.active ORDER BY l.run_id`, [runIds]);
    for (const x of disp) if (!out.has(x.run_id)) out.set(x.run_id, `ألغِ أولًا عملية ${x.kind === 'sale' ? 'بيع' : 'تخريد'} الأصل ${x.code}`);
    return out;
  }

  async run(actor: OrgUser, id: string) {
    const org = actor.organizationId;
    const [r] = await this.db.query(
      `SELECT r.*, to_char(r.to_date, 'YYYY-MM-DD') AS to_date, e.id AS entry_id, e.entry_no, e.voucher_serial, y.name AS year
         FROM acc_asset_dep_runs r LEFT JOIN acc_entries e ON e.id = r.entry_id LEFT JOIN acc_fiscal_years y ON y.id = e.fiscal_year_id
        WHERE r.id = $1 AND r.organization_id = $2`, [id, org]);
    if (!r) throw new NotFoundException('حركة الإهلاك غير موجودة');
    const lines = await this.db.getRepository(DepLine).find({ where: { runId: id } });
    const view = this.runView(r);
    const report = await this.report(this.db.manager, org, r.period, r.to_date, lines.map((l) => ({
      assetId: l.assetId, amount: l.amount, from: l.fromDate, to: l.toDate, months: l.months,
    })), []);
    const blockers = view.status === 'posted' ? await this.cancelBlockers(this.db.manager, org, [id]) : new Map();
    return { ...view, ...report, cancelBlock: blockers.get(id) ?? null, toDate: r.to_date };
  }

  /** إلغاء حركة إهلاك: من الأحدث إلى الأقدم فقط، ويُلغى قيدها ويبقى رقمه */
  async cancelRun(actor: OrgUser, id: string, reasonIn: unknown) {
    this.assets.need(actor, P.assetsReverse, 'ليست لديك صلاحية إلغاء حركات الإهلاك');
    const org = actor.organizationId;
    const reason = str(reasonIn, 1000) ?? bad('اكتب سبب الإلغاء');
    await this.db.transaction(async (em) => {
      await this.assets.lock(em, org);
      const run = await em.getRepository(DepRun).findOne({ where: { id, organizationId: org } }) ?? bad('حركة الإهلاك غير موجودة');
      if (run.status !== 'posted') bad('الحركة ملغاة بالفعل');
      const block = (await this.cancelBlockers(em, org, [id])).get(id);
      if (block) throw new ConflictException(block);
      if (run.entryId) await this.entries.cancelAssetEntry(em, actor, run.entryId, `إلغاء حركة الإهلاك رقم ${run.runNo}: ${reason}`);
      await em.getRepository(DepRun).update({ id }, { status: 'cancelled', cancelledAt: new Date(), cancelledByName: actor.fullName, cancelReason: reason });
      const lines = await em.getRepository(DepLine).find({ where: { runId: id } });
      await em.getRepository(DepLine).update({ runId: id }, { active: false });
      for (const l of lines) await this.assets.refresh(em, org, l.assetId);
    });
    return this.run(actor, id);
  }

  // ---------------- المطابقة مع الدليل المحاسبي ----------------

  /** قيمة الأصول ومجمع إهلاكها لكل مجموعة في تاريخ */
  async subledger(org: string, asOf: string, em: EntityManager = this.db.manager) {
    const rows: { group_id: string; cost: string; accum: string; n: number }[] = await em.query(
      `WITH c AS (SELECT a.group_id, a.id, COALESCE(SUM(m.amount), 0) AS cost,
                         COALESCE(SUM(m.accum_delta) FILTER (WHERE m.kind IN ('opening', 'sale', 'scrap')), 0) AS acc
                    FROM acc_assets a JOIN acc_asset_moves m ON m.asset_id = a.id AND m.status = 'done' AND m.date <= $2
                   WHERE a.organization_id = $1 GROUP BY 1, 2),
            d AS (SELECT l.asset_id, SUM(l.amount) AS dep FROM acc_asset_dep_lines l WHERE l.organization_id = $1 AND l.active AND l.to_date <= $2 GROUP BY 1)
       SELECT c.group_id, SUM(c.cost) AS cost, SUM(c.acc + COALESCE(d.dep, 0)) AS accum, COUNT(*) FILTER (WHERE c.cost <> 0)::int AS n
         FROM c LEFT JOIN d ON d.asset_id = c.id GROUP BY 1`, [org, asOf]);
    return rows.map((r) => ({ groupId: r.group_id, cost: Number(r.cost), accum: Number(r.accum), count: r.n }));
  }

  async reconcile(actor: OrgUser, asOfIn?: string) {
    const org = actor.organizationId;
    const asOf = asOfIn ? dateOf(asOfIn, 'تاريخ المطابقة') : today();
    const groups = await this.db.getRepository(AssetGroup).find({ where: { organizationId: org }, order: { sortOrder: 'ASC' } });
    const sub = await this.subledger(org, asOf);
    const accIds = [...new Set(groups.flatMap((g) => [g.assetAccountId, g.accumAccountId]).filter(Boolean))] as string[];
    if (!accIds.length) return { asOf, accounts: [], groups: [], ok: true, issues: 0 };
    const gl: { account_id: string; bal: string; opening: string }[] = await this.db.query(
      `SELECT l.account_id, SUM(l.debit - l.credit) AS bal, COALESCE(SUM(l.debit - l.credit) FILTER (WHERE e.voucher_type = 'opening'), 0) AS opening
         FROM acc_entry_lines l JOIN acc_entries e ON e.id = l.entry_id
        WHERE e.organization_id = $1 AND e.status = 'posted' AND e.document_date <= $2 AND l.account_id = ANY($3) GROUP BY 1`, [org, asOf, accIds]);
    const accs: { id: string; code: string; name: string }[] = await this.db.query('SELECT id, code, name FROM acc_accounts WHERE id = ANY($1)', [accIds]);
    const openingSub: { group_id: string; cost: string; accum: string }[] = await this.db.query(
      `SELECT a.group_id, SUM(m.amount) AS cost, SUM(m.accum_delta) AS accum FROM acc_asset_moves m JOIN acc_assets a ON a.id = m.asset_id
        WHERE m.organization_id = $1 AND m.kind = 'opening' AND m.status = 'done' AND m.date <= $2 GROUP BY 1`, [org, asOf]);
    const foreign: { account_id: string; entry_id: string; entry_no: number; date: string; description: string; amount: string; source: string; voucher_type: string }[] = await this.db.query(
      `SELECT l.account_id, e.id AS entry_id, e.entry_no, to_char(e.document_date, 'YYYY-MM-DD') AS date, e.description, (l.debit - l.credit) AS amount, e.source, e.voucher_type
         FROM acc_entry_lines l JOIN acc_entries e ON e.id = l.entry_id LEFT JOIN acc_vouchers v ON v.id = e.voucher_id
        WHERE e.organization_id = $1 AND e.status = 'posted' AND e.document_date <= $2 AND l.account_id = ANY($3) AND e.voucher_type <> 'opening'
          AND e.source <> 'assets' AND NOT (e.source = 'voucher' AND COALESCE(v.source_type, '') = 'assets')
        ORDER BY e.document_date, e.entry_no LIMIT 200`, [org, asOf, accIds]);
    const accounts = accIds.map((id) => {
      const asCost = groups.filter((g) => g.assetAccountId === id);
      const asAccum = groups.filter((g) => g.accumAccountId === id);
      const sign = asCost.length ? 1 : -1;
      const subTotal = r2([...asCost.map((g) => sub.find((s) => s.groupId === g.id)?.cost ?? 0), ...asAccum.map((g) => sub.find((s) => s.groupId === g.id)?.accum ?? 0)].reduce((a, b) => a + b, 0));
      const glRow = gl.find((x) => x.account_id === id);
      const glBal = r2(sign * Number(glRow?.bal ?? 0));
      const diff = r2(glBal - subTotal);
      const a = accs.find((x) => x.id === id);
      const problems: string[] = [];
      if (diff !== 0) {
        const openGl = r2(sign * Number(glRow?.opening ?? 0));
        const openSub = r2([...asCost.map((g) => Number(openingSub.find((o) => o.group_id === g.id)?.cost ?? 0)), ...asAccum.map((g) => Number(openingSub.find((o) => o.group_id === g.id)?.accum ?? 0))].reduce((x, y) => x + y, 0));
        if (openGl !== openSub) problems.push(`الرصيد الافتتاحي للحساب في القيد الافتتاحي ${openGl.toLocaleString('en')} ريال، ومجموع الأرصدة الافتتاحية للأصول ${openSub.toLocaleString('en')} ريال`);
        for (const f of foreign.filter((x) => x.account_id === id).slice(0, 10)) {
          problems.push(`قيد رقم ${f.entry_no} بتاريخ ${f.date} بمبلغ ${Math.abs(Number(f.amount)).toLocaleString('en')} ريال لم يصدر من الأصول الثابتة: ${f.description}`);
        }
        if (!problems.length) problems.push('راجع حركات الحساب في كشف الحساب مقارنة بسجل الأصول');
      }
      return {
        accountId: id, code: a?.code ?? '', name: a?.name ?? '', kind: asCost.length ? 'cost' : 'accum', kindLabel: asCost.length ? 'حساب الأصول' : 'حساب مجمع الإهلاك',
        groups: [...asCost, ...asAccum].map((g) => g.name), gl: glBal, subledger: subTotal, diff, ok: diff === 0, problems,
        foreignEntries: foreign.filter((x) => x.account_id === id).map((f) => ({ id: f.entry_id, entryNo: f.entry_no, date: f.date, description: f.description, amount: Number(f.amount) })),
      };
    });
    const groupFlags = groups.map((g) => {
      const bad1 = accounts.filter((x) => (x.accountId === g.assetAccountId || x.accountId === g.accumAccountId) && !x.ok);
      return { groupId: g.id, name: g.name, ok: !bad1.length, problems: bad1.map((b) => `${b.kindLabel} ${b.code}: فرق ${b.diff.toLocaleString('en')} ريال`) };
    });
    return { asOf, accounts, groups: groupFlags, ok: accounts.every((x) => x.ok), issues: accounts.filter((x) => !x.ok).length };
  }

  // ---------------- لوحة الأصول ----------------

  async dashboard(actor: OrgUser) {
    const org = actor.organizationId;
    const t = today();
    const years = await this.core.years(org);
    const year = years.find((y) => y.startDate <= t && t <= y.endDate) ?? years.at(-1);
    const [k] = await this.db.query(
      `SELECT COUNT(*) FILTER (WHERE status IN ('active', 'pending_sale'))::int AS books, COUNT(*) FILTER (WHERE status = 'draft')::int AS draft,
              COUNT(*) FILTER (WHERE status IN ('pending_purchase', 'pending_sale'))::int AS pending, COUNT(*) FILTER (WHERE status IN ('sold', 'scrapped'))::int AS disposed,
              COALESCE(SUM(cost) FILTER (WHERE status IN ('active', 'pending_sale')), 0) AS cost, COALESCE(SUM(accum) FILTER (WHERE status IN ('active', 'pending_sale')), 0) AS accum,
              COUNT(*) FILTER (WHERE status = 'active' AND cost > 0 AND cost - accum <= GREATEST(salvage_value, 1))::int AS fully
         FROM acc_assets WHERE organization_id = $1`, [org]);
    const [dep] = year ? await this.db.query(
      `SELECT COALESCE(SUM(amount), 0) AS y FROM acc_asset_dep_lines WHERE organization_id = $1 AND active AND to_date BETWEEN $2 AND $3`, [org, year.startDate, year.endDate]) : [{ y: 0 }];
    const monthly: { m: string; amount: string }[] = year ? await this.db.query(
      `SELECT to_char(to_date, 'YYYY-MM') AS m, SUM(amount) AS amount FROM acc_asset_dep_lines WHERE organization_id = $1 AND active AND to_date BETWEEN $2 AND $3 GROUP BY 1 ORDER BY 1`,
      [org, year.startDate, year.endDate]) : [];
    const prevEnd = addDays(monthStart(t), -1);
    const behind: { id: string; code: string; name: string; through: string | null }[] = await this.db.query(
      `SELECT a.id, a.code, a.name, to_char(a.depreciated_through, 'YYYY-MM-DD') AS through FROM acc_assets a JOIN acc_asset_groups g ON g.id = a.group_id
        WHERE a.organization_id = $1 AND a.status = 'active' AND (g.rate > 0 OR g.life_years IS NOT NULL OR a.rate > 0 OR a.life_years IS NOT NULL)
          AND a.cost - a.accum > GREATEST(a.salvage_value, 1) AND a.in_service_date <= $2 AND (a.depreciated_through IS NULL OR a.depreciated_through < $2)
        ORDER BY a.asset_no LIMIT 50`, [org, prevEnd]);
    const groups = await this.assets.listGroups(actor);
    const rec = await this.reconcile(actor);
    const cfg = await this.assets.config(org);
    const allGroups = await this.db.getRepository(AssetGroup).find({ where: { organizationId: org } });
    const held = await this.db.getRepository(FixedAsset).find({ where: { organizationId: org, status: In(['draft', 'pending_purchase', 'active', 'pending_sale']) } });
    const alerts = held.flatMap((a) => this.assets.alerts(a, allGroups.find((g) => g.id === a.groupId)!, cfg.alertDays).map((x) => ({ ...x, assetId: a.id, code: a.code, name: a.name })))
      .sort((a, b) => a.date.localeCompare(b.date)).slice(0, 30);
    const noCustody = held.filter((a) => !a.custodianEmployeeId && allGroups.find((g) => g.id === a.groupId)?.isTangible).length;
    const pendingOps = await this.operations(actor, { status: 'pending' });
    const lastRuns = (await this.runs(actor)).slice(0, 6);
    const [st] = await this.db.query(`SELECT COUNT(*) FILTER (WHERE status = 'open')::int AS open FROM acc_asset_stocktakes WHERE organization_id = $1`, [org]);
    const disposals: { kind: string; n: number; gain: string; proceeds: string }[] = year ? await this.db.query(
      `SELECT kind, COUNT(*)::int AS n, COALESCE(SUM(gain_loss), 0) AS gain, COALESCE(SUM(proceeds), 0) AS proceeds FROM acc_asset_moves
        WHERE organization_id = $1 AND status = 'done' AND kind IN ('sale', 'scrap') AND date BETWEEN $2 AND $3 GROUP BY 1`, [org, year.startDate, year.endDate]) : [];
    const cost = Number(k.cost);
    const accum = Number(k.accum);
    return {
      kpis: {
        inBooks: k.books, draft: k.draft, pending: k.pending, disposed: k.disposed, cost, accum, nbv: r2(cost - accum), fully: k.fully,
        depYear: Number(dep.y), year: year?.name ?? null, noCustody, openStocktakes: st.open, consumed: cost ? Math.round((accum / cost) * 1000) / 10 : 0,
      },
      monthly: monthly.map((m) => ({ month: m.m, amount: Number(m.amount) })),
      groups, reconciliation: rec, behind, alerts, pendingOps, lastRuns,
      disposals: disposals.map((d) => ({ kind: d.kind, label: d.kind === 'sale' ? 'مبيعات' : 'تخريد', count: d.n, gainLoss: Number(d.gain), proceeds: Number(d.proceeds) })),
      config: cfg,
    };
  }

  /** للتحقق من الصلاحية في نقطة الوصول العامة */
  assertRead(actor: OrgUser) {
    if (!actor.isSuperadmin && ![P.assetsRead, P.read].some((p) => actor.permissions.includes(p))) throw new ForbiddenException('ليست لديك صلاحية الاطلاع على الأصول الثابتة');
  }
}
