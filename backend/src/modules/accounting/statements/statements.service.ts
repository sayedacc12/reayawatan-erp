import { createHash } from 'crypto';
import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { DataSource, In } from 'typeorm';
import { OrgUser } from '../../../core/auth/decorators';
import { AccCore, addDays, cents, fromCents } from '../acc-core.service';
import { AssetsReports } from '../assets.reports';
import { Account, AccountNature, FiscalYear, PeriodLock } from '../entities/accounting.entity';
import { SetupService } from '../setup.service';
import { FALLBACK, FS_GROUP_NAME, FS_LINE, FS_LINES, FsGroup, FsLine, NONPROFIT_CHANNELS, PROFIT_POLICY, ruleFor, statementOf } from './fs-template';
import { dmy, FsPeriod, fsPeriod, priorRange, Span } from './fs-period';
import { AppropriationInputs, FsAppropriation, FsIssue, FsMapping, HistoryEntry } from './statements.entity';

/** المبالغ داخل هذه الخدمة بالهللات (أعداد صحيحة)، وتُحوَّل للريال عند الإخراج فقط */
type Sums = Map<string, { start: number; move: number }>;
export type MapSource = 'manual' | 'inherited' | 'default' | 'fallback';
interface Resolved { line: string; source: MapSource; via: string | null }
interface AccLite { id: string; code: string; name: string; nature: AccountNature; parentId: string | null; level: number; kind: string; isActive: boolean }

const ASSET_GROUPS: FsGroup[] = ['ca', 'nca'];
const MAX_PARTNER_LINES = 100_000;
const BUCKETS = [{ key: 'b30', label: 'حتى 30 يومًا', max: 30 }, { key: 'b60', label: '31 – 60', max: 60 }, { key: 'b90', label: '61 – 90', max: 90 }, { key: 'b180', label: '91 – 180', max: 180 }, { key: 'b365', label: '181 – 365', max: 365 }, { key: 'older', label: 'أكثر من سنة', max: Infinity }];
const HIST_MAX = 50;

export interface StatementRow { code: string; name: string; group: FsGroup; note: number | null; cur: number; cmp: number | null; ytd?: number | null; accounts: { id: string; code: string; name: string; source: MapSource; cur: number; cmp: number | null }[] }

const days = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
const pushHist = (h: HistoryEntry[], e: HistoryEntry) => [...h, e].slice(-HIST_MAX);

@Injectable()
export class StatementsService {
  constructor(private readonly db: DataSource, private readonly core: AccCore, private readonly setup: SetupService, private readonly assetsReports: AssetsReports) {}

  // ---------------- الفترات والإغلاق ----------------

  async period(org: string, yearId: string, span: Span, part?: number): Promise<FsPeriod> {
    const y = await this.core.year(org, yearId);
    return fsPeriod(y, span, part ?? 1);
  }

  private async prevYear(org: string, y: FiscalYear) {
    return this.db.getRepository(FiscalYear).findOne({ where: { organizationId: org, endDate: addDays(y.startDate, -1) } });
  }

  /** جاهزية الفترة للإصدار النهائي: كل شهور السنة حتى نهاية الفترة مغلقة (والإغلاق لا يتم إلا بعد ترحيل كل القيود والسندات) */
  async closure(org: string, p: FsPeriod) {
    const locks = await this.db.getRepository(PeriodLock).find({ where: { organizationId: org, fiscalYearId: p.year.id, month: In(p.months) } });
    const locked = new Set(locks.map((l) => l.month));
    const openMonths = p.months.filter((m) => !locked.has(m));
    const [drafts] = await this.db.query(
      `SELECT COUNT(*)::int AS n FROM acc_entries WHERE organization_id = $1 AND fiscal_year_id = $2 AND status = 'draft' AND document_date <= $3`, [org, p.year.id, p.to]);
    const [vouchers] = await this.db.query(
      `SELECT COUNT(*)::int AS n FROM acc_vouchers WHERE organization_id = $1 AND fiscal_year_id = $2 AND voucher_date <= $3 AND (status IN ('draft', 'pending', 'returned') OR request_kind IS NOT NULL)`,
      [org, p.year.id, p.to]);
    const closed = openMonths.length === 0 && drafts.n === 0 && vouchers.n === 0;
    const reasons: string[] = [];
    if (openMonths.length) reasons.push(`شهور غير مغلقة حتى نهاية الفترة: ${openMonths.join('، ')}`);
    if (drafts.n) reasons.push(`${drafts.n} قيد غير مرحّل حتى نهاية الفترة`);
    if (vouchers.n) reasons.push(`${vouchers.n} سند قبض أو صرف لم يكتمل اعتماده أو عليه طلب معلق`);
    return { closed, yearClosed: p.year.status === 'closed', openMonths, drafts: drafts.n as number, openVouchers: vouchers.n as number, reasons };
  }

  async assertClosed(org: string, p: FsPeriod) {
    const c = await this.closure(org, p);
    if (!c.closed) throw new ConflictException(`لا تُصدَّر القوائم المالية قبل إغلاق الفترة وترحيل قيودها. ${c.reasons.join('. ')}. أغلق الشهور من شاشة «إغلاق الفترات» ثم أعد الإصدار`);
    return c;
  }

  /** السنوات المالية مع حالة إغلاق شهورها، لاختيار الفترة في الشاشة */
  async options(actor: OrgUser) {
    const org = actor.organizationId;
    const years = await this.core.years(org);
    const locks = await this.db.getRepository(PeriodLock).find({ where: { organizationId: org } });
    return {
      years: years.map((y) => ({ id: y.id, name: y.name, startDate: y.startDate, endDate: y.endDate, status: y.status, closedMonths: locks.filter((l) => l.fiscalYearId === y.id).map((l) => l.month).sort() })),
      channels: NONPROFIT_CHANNELS, policy: PROFIT_POLICY,
      lines: FS_LINES.map((l) => ({ code: l.code, statement: l.statement, group: l.group, groupName: FS_GROUP_NAME[l.group], name: l.name })),
    };
  }

  // ---------------- ربط الدليل ببنود القوائم ----------------

  private async accounts(org: string): Promise<AccLite[]> {
    return this.db.getRepository(Account).find({ where: { organizationId: org }, order: { code: 'ASC' }, select: ['id', 'code', 'name', 'nature', 'parentId', 'level', 'kind', 'isActive'] });
  }

  private async resolver(org: string, accs?: AccLite[]) {
    const list = accs ?? await this.accounts(org);
    const byId = new Map(list.map((a) => [a.id, a]));
    const manual = new Map((await this.db.getRepository(FsMapping).find({ where: { organizationId: org } })).map((m) => [m.accountId, m.lineCode]));
    const cache = new Map<string, Resolved>();
    const compatible = (a: AccLite, line: string | null | undefined) => !!line && FS_LINE.get(line)?.statement === statementOf(a.nature);
    const resolve = (id: string): Resolved => {
      const hit = cache.get(id);
      if (hit) return hit;
      const a = byId.get(id);
      if (!a) return { line: 'BS-CA-OTH', source: 'fallback', via: null };
      let r: Resolved | null = null;
      for (let x: AccLite | undefined = a; x; x = x.parentId ? byId.get(x.parentId) : undefined) {
        const m = manual.get(x.id);
        if (compatible(a, m)) { r = { line: m!, source: x.id === a.id ? 'manual' : 'inherited', via: x.id === a.id ? null : x.code }; break; }
      }
      if (!r) {
        const rule = ruleFor(a.code);
        r = compatible(a, rule) ? { line: rule!, source: 'default', via: null } : { line: FALLBACK[a.nature], source: 'fallback', via: null };
      }
      cache.set(id, r);
      return r;
    };
    return { resolve, byId, list, manual };
  }

  /** شجرة الدليل بربط كل حساب وببنود القوائم، مع مصدر الربط (يدوي، موروث من الأب، افتراضي، أو «آخر» يحتاج مراجعة) */
  async mapping(actor: OrgUser) {
    const org = actor.organizationId;
    const { resolve, list, manual } = await this.resolver(org);
    const [bal] = await Promise.all([
      this.db.query(
        `SELECT l.account_id AS id, SUM(l.debit - l.credit) AS net FROM acc_entry_lines l JOIN acc_entries e ON e.id = l.entry_id
          WHERE e.organization_id = $1 AND e.status = 'posted' GROUP BY 1`, [org]) as Promise<{ id: string; net: string }[]>,
    ]);
    const used = new Set(bal.filter((b) => cents(b.net) !== 0).map((b) => b.id));
    const rows = list.map((a) => {
      const r = resolve(a.id);
      return {
        id: a.id, code: a.code, name: a.name, nature: a.nature, level: a.level, kind: a.kind, parentId: a.parentId, isActive: a.isActive,
        line: r.line, lineName: FS_LINE.get(r.line)!.name, source: r.source, via: r.via, manual: manual.get(a.id) ?? null, hasMoves: used.has(a.id),
      };
    });
    return {
      rows,
      review: rows.filter((r) => r.kind === 'sub' && r.source === 'fallback').map((r) => ({ id: r.id, code: r.code, name: r.name, hasMoves: r.hasMoves })),
      lines: FS_LINES.map((l) => ({ code: l.code, statement: l.statement, group: l.group, groupName: FS_GROUP_NAME[l.group], name: l.name })),
    };
  }

  /** ربط حساب (وما تحته) ببند، أو إلغاء الربط اليدوي ليعود للافتراضي (lineCode = null) */
  async setMapping(actor: OrgUser, accountId: string, lineCode: string | null) {
    const org = actor.organizationId;
    const a = await this.db.getRepository(Account).findOne({ where: { id: accountId, organizationId: org } });
    if (!a) throw new NotFoundException('الحساب غير موجود');
    if (lineCode !== null) {
      const line = FS_LINE.get(lineCode);
      if (!line) throw new BadRequestException('البند غير موجود في نموذج القوائم');
      if (line.statement !== statementOf(a.nature)) {
        throw new BadRequestException(line.statement === 'bs' ? 'حسابات الإيرادات والمصروفات تُربط ببنود قائمة الدخل' : 'حسابات الأصول والالتزامات وحقوق الملكية تُربط ببنود قائمة المركز المالي');
      }
    }
    await this.db.transaction(async (em) => {
      const repo = em.getRepository(FsMapping);
      const cur = await repo.findOne({ where: { organizationId: org, accountId: a.id }, lock: { mode: 'pessimistic_write' } });
      const entry = (action: string, before: unknown, after: unknown): HistoryEntry => ({ at: new Date().toISOString(), by: actor.fullName, byId: actor.id, action, before, after });
      if (lineCode === null) {
        if (!cur || cur.lineCode === null) return;
        // يبقى السجل بلا بند (فيعود الحساب للربط الافتراضي) ويُحفظ أثر الإلغاء في سجل التغييرات
        cur.history = pushHist(cur.history, entry('إلغاء الربط اليدوي والعودة للافتراضي', cur.lineCode, null));
        cur.lineCode = null;
        cur.updatedByName = actor.fullName;
        await repo.save(cur);
        return;
      }
      if (cur) {
        if (cur.lineCode === lineCode) return;
        cur.history = pushHist(cur.history, entry('تعديل الربط', cur.lineCode, lineCode));
        cur.lineCode = lineCode;
        cur.updatedByName = actor.fullName;
        await repo.save(cur);
      } else {
        await repo.save(repo.create({ organizationId: org, accountId: a.id, lineCode, updatedByName: actor.fullName, history: [entry('ربط يدوي', ruleFor(a.code), lineCode)] }));
      }
    });
    return this.mapping(actor);
  }

  // ---------------- الأرصدة ----------------

  /** الرصيد أول الفترة (يشمل القيد الافتتاحي) والحركة خلالها لكل حساب في سنة مالية، من القيود المرحّلة فقط */
  private async sums(org: string, yearId: string, from: string, to: string): Promise<Sums> {
    const rows: { id: string; start: string; move: string }[] = await this.db.query(
      `SELECT l.account_id AS id,
              COALESCE(SUM(l.debit - l.credit) FILTER (WHERE e.document_date < $3 OR e.voucher_type = 'opening'), 0) AS start,
              COALESCE(SUM(l.debit - l.credit) FILTER (WHERE e.document_date >= $3 AND e.voucher_type <> 'opening'), 0) AS move
         FROM acc_entry_lines l JOIN acc_entries e ON e.id = l.entry_id
        WHERE e.organization_id = $1 AND e.fiscal_year_id = $2 AND e.status = 'posted' AND e.document_date <= $4
        GROUP BY 1`, [org, yearId, from, to]);
    return new Map(rows.map((r) => [r.id, { start: cents(r.start), move: cents(r.move) }]));
  }

  /**
   * القوائم المالية لفترة: المركز المالي في نهايتها (مقارنة بنهاية السنة السابقة)، والدخل للفترة (مقارنة بنفس الفترة من السنة السابقة،
   * ومن بداية السنة إن لم تبدأ الفترة ببدايتها)، والتغيرات في حقوق الملكية والتدفقات النقدية للفترة، والإيضاحات.
   */
  async compute(org: string, p: FsPeriod) {
    const prev = await this.prevYear(org, p.year);
    const pr = prev ? priorRange(p, prev) : null;
    const [res, cur, prevIs, prevEnd] = await Promise.all([
      this.resolver(org),
      this.sums(org, p.year.id, p.from, p.to),
      prev && pr ? this.sums(org, prev.id, pr.from, pr.to) : Promise.resolve(null),
      prev ? this.sums(org, prev.id, prev.startDate, prev.endDate) : Promise.resolve(null),
    ]);
    const { resolve, byId } = res;
    const lineOf = (id: string) => FS_LINE.get(resolve(id).line)!;
    const isAssetSide = (l: FsLine) => ASSET_GROUPS.includes(l.group);
    // الإشارة للعرض: الأصول مدينة موجبة، والالتزامات وحقوق الملكية دائنة موجبة، والإيرادات موجبة والمصروفات سالبة
    const present = (l: FsLine, net: number) => (l.statement === 'bs' && isAssetSide(l) ? net : -net);

    type Acc = { start: number; end: number; move: number; ytd: number; cmp: number | null; cmpIs: number | null };
    const perLine = new Map<string, Acc>();
    const perAccount = new Map<string, Map<string, { cur: number; cmp: number | null }>>();
    const addAcc = (line: string, accountId: string, curV: number, cmpV: number | null) => {
      const m = perAccount.get(line) ?? new Map();
      const x = m.get(accountId) ?? { cur: 0, cmp: prev ? 0 : null };
      x.cur += curV;
      if (cmpV !== null) x.cmp = (x.cmp ?? 0) + cmpV;
      m.set(accountId, x);
      perAccount.set(line, m);
    };
    const touch = (code: string) => {
      const x = perLine.get(code) ?? { start: 0, end: 0, move: 0, ytd: 0, cmp: prev ? 0 : null, cmpIs: prev ? 0 : null };
      perLine.set(code, x);
      return x;
    };
    for (const [id, s] of cur) {
      const l = lineOf(id);
      const x = touch(l.code);
      x.start += present(l, s.start); x.move += present(l, s.move); x.end += present(l, s.start + s.move); x.ytd += present(l, s.start + s.move);
      addAcc(l.code, id, l.statement === 'bs' ? present(l, s.start + s.move) : present(l, s.move), null);
    }
    if (prevEnd) {
      for (const [id, s] of prevEnd) {
        const l = lineOf(id);
        if (l.statement !== 'bs') continue;
        touch(l.code).cmp! += present(l, s.start + s.move);
        addAcc(l.code, id, 0, present(l, s.start + s.move));
      }
    }
    if (prevIs) {
      for (const [id, s] of prevIs) {
        const l = lineOf(id);
        if (l.statement !== 'is') continue;
        touch(l.code).cmpIs! += present(l, s.move);
        addAcc(l.code, id, 0, present(l, s.move));
      }
    }
    // صافي الربح: للفترة، ومن بداية السنة حتى نهايتها (يظهر في حقوق الملكية)، وللسنة السابقة كاملة
    const isLines = FS_LINES.filter((l) => l.statement === 'is');
    const get = (code: string) => perLine.get(code);
    const sumLines = (ls: FsLine[], f: (a: Acc) => number | null) => ls.reduce((t, l) => t + (get(l.code) ? (f(get(l.code)!) ?? 0) : 0), 0);
    const niPeriod = sumLines(isLines, (a) => a.move);
    const niYtd = sumLines(isLines, (a) => a.ytd);
    const niBefore = niYtd - niPeriod;
    const niPrevYear = prevEnd ? [...prevEnd].reduce((t, [id, s]) => { const l = lineOf(id); return l.statement === 'is' ? t + present(l, s.start + s.move) : t; }, 0) : null;
    const niPrevPeriod = prevIs ? sumLines(isLines, (a) => a.cmpIs) : null;

    // ترقيم الإيضاحات: ١ التكوين، ٢ أسس الإعداد، ٣ السياسات، ثم بند لكل سطر له رصيد
    let noteNo = 3;
    const noteOf = new Map<string, number>();
    const hasValue = (code: string) => { const a = get(code); return !!a && (a.end || a.start || a.move || a.ytd || a.cmp || a.cmpIs); };
    for (const l of FS_LINES) if (hasValue(l.code)) noteOf.set(l.code, ++noteNo);
    const accountsOf = (code: string) => [...(perAccount.get(code) ?? new Map()).entries()]
      .map(([id, v]) => ({ id, code: byId.get(id)?.code ?? '', name: byId.get(id)?.name ?? '', source: resolve(id).source, cur: fromCents(v.cur), cmp: v.cmp === null ? null : fromCents(v.cmp) }))
      .filter((a) => a.cur || a.cmp).sort((a, b) => a.code.localeCompare(b.code));
    const row = (l: FsLine, curV: number, cmpV: number | null, ytdV?: number | null): StatementRow => ({
      code: l.code, name: l.name, group: l.group, note: noteOf.get(l.code) ?? null, cur: fromCents(curV), cmp: cmpV === null ? null : fromCents(cmpV),
      ...(ytdV !== undefined ? { ytd: ytdV === null ? null : fromCents(ytdV) } : {}), accounts: accountsOf(l.code),
    });

    // ---- قائمة المركز المالي ----
    const bsGroup = (g: FsGroup) => FS_LINES.filter((l) => l.group === g && hasValue(l.code)).map((l) => row(l, get(l.code)!.end, get(l.code)!.cmp));
    const tot = (rs: StatementRow[], k: 'cur' | 'cmp') => (k === 'cmp' && !prev ? null : fromCents(rs.reduce((t, r) => t + cents(r[k] ?? 0), 0)));
    const ca = bsGroup('ca'), nca = bsGroup('nca'), cl = bsGroup('cl'), ncl = bsGroup('ncl'), eq = bsGroup('eq');
    const niRow = { code: 'BS-EQ-NI', name: p.endsYear ? 'صافي ربح (خسارة) السنة' : 'صافي ربح (خسارة) الفترة من بداية السنة', group: 'eq' as FsGroup, note: null, cur: fromCents(niYtd), cmp: niPrevYear === null ? null : fromCents(niPrevYear), accounts: [] };
    const eqAll = [...eq, niRow];
    const assetsCur = cents(tot(ca, 'cur')) + cents(tot(nca, 'cur'));
    const liabCur = cents(tot(cl, 'cur')) + cents(tot(ncl, 'cur'));
    const eqCur = cents(tot(eqAll, 'cur'));
    const cmpSum = (...xs: (number | null)[]) => (prev ? fromCents(xs.reduce<number>((t, x) => t + cents(x ?? 0), 0)) : null);
    const bs = {
      groups: [
        { key: 'ca', name: FS_GROUP_NAME.ca, rows: ca, total: { cur: tot(ca, 'cur'), cmp: tot(ca, 'cmp') } },
        { key: 'nca', name: FS_GROUP_NAME.nca, rows: nca, total: { cur: tot(nca, 'cur'), cmp: tot(nca, 'cmp') } },
        { key: 'cl', name: FS_GROUP_NAME.cl, rows: cl, total: { cur: tot(cl, 'cur'), cmp: tot(cl, 'cmp') } },
        { key: 'ncl', name: FS_GROUP_NAME.ncl, rows: ncl, total: { cur: tot(ncl, 'cur'), cmp: tot(ncl, 'cmp') } },
        { key: 'eq', name: FS_GROUP_NAME.eq, rows: eqAll, total: { cur: tot(eqAll, 'cur'), cmp: tot(eqAll, 'cmp') } },
      ],
      totalAssets: { cur: fromCents(assetsCur), cmp: cmpSum(tot(ca, 'cmp'), tot(nca, 'cmp')) },
      totalLiabilities: { cur: fromCents(liabCur), cmp: cmpSum(tot(cl, 'cmp'), tot(ncl, 'cmp')) },
      totalEquity: { cur: fromCents(eqCur), cmp: tot(eqAll, 'cmp') },
      totalLiabEquity: { cur: fromCents(liabCur + eqCur), cmp: cmpSum(tot(cl, 'cmp'), tot(ncl, 'cmp'), tot(eqAll, 'cmp')) },
      difference: { cur: fromCents(assetsCur - liabCur - eqCur), cmp: prev ? fromCents(cents(cmpSum(tot(ca, 'cmp'), tot(nca, 'cmp'))) - cents(cmpSum(tot(cl, 'cmp'), tot(ncl, 'cmp'), tot(eqAll, 'cmp')))) : null },
    };

    // ---- قائمة الدخل ----
    const showYtd = !p.startsYear;
    const isRow = (l: FsLine) => row(l, get(l.code)?.move ?? 0, prev ? get(l.code)?.cmpIs ?? 0 : null, showYtd ? get(l.code)?.ytd ?? 0 : undefined);
    const isGroup = (gs: FsGroup[]) => isLines.filter((l) => gs.includes(l.group) && hasValue(l.code)).map(isRow);
    const sub = (gs: FsGroup[]) => {
      const ls = isLines.filter((l) => gs.includes(l.group));
      return { cur: fromCents(sumLines(ls, (a) => a.move)), cmp: prev ? fromCents(sumLines(ls, (a) => a.cmpIs)) : null, ytd: showYtd ? fromCents(sumLines(ls, (a) => a.ytd)) : undefined };
    };
    const is = {
      showYtd,
      sections: [
        { key: 'rev', name: FS_GROUP_NAME.rev, rows: isGroup(['rev']) },
        { key: 'cos', name: FS_GROUP_NAME.cos, rows: isGroup(['cos']) },
        { key: 'gross', name: 'مجمل الربح', subtotal: sub(['rev', 'cos']) },
        { key: 'opex', name: FS_GROUP_NAME.opex, rows: isGroup(['opex']) },
        { key: 'op', name: 'الربح (الخسارة) من العمليات', subtotal: sub(['rev', 'cos', 'opex']) },
        { key: 'other', name: FS_GROUP_NAME.other, rows: isGroup(['other', 'fin']) },
        { key: 'pbt', name: 'صافي الربح (الخسارة) قبل الزكاة وضريبة الدخل', subtotal: sub(['rev', 'cos', 'opex', 'other', 'fin']) },
        { key: 'tax', name: FS_GROUP_NAME.tax, rows: isGroup(['tax']) },
        { key: 'net', name: 'صافي ربح (خسارة) الفترة', subtotal: { cur: fromCents(niPeriod), cmp: niPrevPeriod === null ? null : fromCents(niPrevPeriod), ytd: showYtd ? fromCents(niYtd) : undefined } },
      ],
      netIncome: fromCents(niPeriod), netIncomeYtd: fromCents(niYtd),
    };

    // ---- التغيرات في حقوق الملكية للفترة ----
    const eqLines = FS_LINES.filter((l) => l.group === 'eq' && hasValue(l.code));
    const eqStart = (l: FsLine) => (get(l.code)?.start ?? 0) + (l.code === 'BS-EQ-RE' ? niBefore : 0);
    const eqEnd = (l: FsLine) => (get(l.code)?.end ?? 0) + (l.code === 'BS-EQ-RE' ? niYtd : 0);
    if (!eqLines.some((l) => l.code === 'BS-EQ-RE') && (niYtd || niBefore)) eqLines.push(FS_LINE.get('BS-EQ-RE')!);
    const equity = {
      columns: eqLines.map((l) => ({ code: l.code, name: l.name })),
      rows: [
        { label: `الرصيد في ${dmy(addDays(p.from, -1))}`, values: eqLines.map((l) => fromCents(eqStart(l))) },
        { label: 'صافي ربح (خسارة) الفترة', values: eqLines.map((l) => (l.code === 'BS-EQ-RE' ? fromCents(niPeriod) : 0)) },
        { label: 'حركات أخرى (مساهمات وتحويلات للاحتياطيات وتوزيعات)', values: eqLines.map((l) => fromCents(eqEnd(l) - eqStart(l) - (l.code === 'BS-EQ-RE' ? niPeriod : 0))) },
        { label: `الرصيد في ${dmy(p.to)}`, values: eqLines.map((l) => fromCents(eqEnd(l))) },
      ],
    };

    // ---- التدفقات النقدية للفترة (الطريقة غير المباشرة) ----
    const delta = (code: string) => (get(code)?.end ?? 0) - (get(code)?.start ?? 0);
    const depAddBack = -(get('IS-DEP')?.move ?? 0) || 0;
    const cfLine = (l: FsLine) => (isAssetSide(l) ? -delta(l.code) : delta(l.code));
    const bsLines = FS_LINES.filter((l) => l.statement === 'bs' && l.code !== 'BS-CA-CASH');
    const opRows = bsLines.filter((l) => l.cash === 'operating' && delta(l.code)).map((l) => ({ name: `التغير في ${l.name}`, amount: fromCents(cfLine(l)) }));
    const fixed = ['BS-NCA-PPE', 'BS-NCA-INT'];
    const fixedNet = fixed.reduce((t, c) => t + cfLine(FS_LINE.get(c)!), 0) - depAddBack;
    const invRows = [
      ...(fixedNet ? [{ name: 'شراء ممتلكات ومعدات وأصول غير ملموسة (بالصافي بعد المستبعد)', amount: fromCents(fixedNet) }] : []),
      ...bsLines.filter((l) => l.cash === 'investing' && !fixed.includes(l.code) && delta(l.code)).map((l) => ({ name: `التغير في ${l.name}`, amount: fromCents(cfLine(l)) })),
    ];
    const finRows = bsLines.filter((l) => l.cash === 'financing' && delta(l.code)).map((l) => ({ name: l.code === 'BS-EQ-RE' ? 'توزيعات وتحويلات من الأرباح المبقاة' : `التغير في ${l.name}`, amount: fromCents(cfLine(l)) }));
    const opTotal = niPeriod + depAddBack + opRows.reduce((t, r) => t + cents(r.amount), 0);
    const invTotal = invRows.reduce((t, r) => t + cents(r.amount), 0);
    const finTotal = finRows.reduce((t, r) => t + cents(r.amount), 0);
    const cashStart = get('BS-CA-CASH')?.start ?? 0, cashEnd = get('BS-CA-CASH')?.end ?? 0;
    const cash = {
      netIncome: fromCents(niPeriod), depreciation: fromCents(depAddBack), operating: opRows, operatingTotal: fromCents(opTotal),
      investing: invRows, investingTotal: fromCents(invTotal), financing: finRows, financingTotal: fromCents(finTotal),
      netChange: fromCents(opTotal + invTotal + finTotal), cashStart: fromCents(cashStart), cashEnd: fromCents(cashEnd),
      difference: fromCents(cashEnd - cashStart - (opTotal + invTotal + finTotal)),
    };

    // ---- التنبيهات ----
    const fallbackAccounts = [...cur.keys()].filter((id) => resolve(id).source === 'fallback' && (cur.get(id)!.start || cur.get(id)!.move))
      .map((id) => ({ id, code: byId.get(id)?.code ?? '', name: byId.get(id)?.name ?? '' }));
    const mismatches = (await this.setup.mismatches(org).catch(() => [])) as { yearName?: number }[];
    const warnings = [
      ...(bs.difference.cur !== 0 ? [`قائمة المركز المالي غير متوازنة بفرق ${bs.difference.cur}`] : []),
      ...(cash.difference !== 0 ? [`التدفقات النقدية لا تطابق التغير في النقد بفرق ${cash.difference}`] : []),
      ...(fallbackAccounts.length ? [`${fallbackAccounts.length} حساب عليه رصيد لا يطابقه ربط، فظهر في البند «الآخر». راجع تبويب الدليل وفق بنود القوائم`] : []),
      ...(!prev ? ['لا توجد سنة مالية سابقة في النظام، فأعمدة المقارنة فارغة'] : prev.status !== 'closed' ? [`أرقام المقارنة من السنة ${prev.name} وهي غير مغلقة`] : []),
      ...(mismatches.length ? ['رصيد افتتاحي لا يطابق إقفال السنة السابقة. حدّث القيد الافتتاحي من شاشة الافتتاحيات'] : []),
    ];

    return {
      period: { yearId: p.year.id, year: p.year.name, yearStart: p.year.startDate, span: p.span, part: p.part, key: p.key, label: p.label, range: p.range, from: p.from, to: p.to, startsYear: p.startsYear, endsYear: p.endsYear },
      comparative: prev ? { year: prev.name, from: pr!.from, to: pr!.to, end: prev.endDate, closed: prev.status === 'closed' } : null,
      bs, is, equity, cash, warnings, fallbackAccounts,
      notesIndex: [...noteOf.entries()].map(([code, n]) => ({ code, no: n, name: FS_LINE.get(code)!.name, accounts: accountsOf(code), policy: FS_LINE.get(code)!.policy ?? null })),
      totals: { assets: bs.totalAssets.cur, liabilities: bs.totalLiabilities.cur, equity: bs.totalEquity.cur, netIncome: is.netIncome, netIncomeYtd: is.netIncomeYtd, cash: fromCents(cashEnd) },
      raw: { niYtd, niPeriod, expensesYtd: [...cur].reduce((t, [id, x]) => (byId.get(id)?.nature === 'expenses' ? t + x.start + x.move : t), 0), reStart: (get('BS-EQ-RE')?.start ?? 0) + niBefore, reserves: get('BS-EQ-RES')?.end ?? 0 },
    };
  }

  async preview(actor: OrgUser, q: { yearId: string; span: Span; part?: number }) {
    const p = await this.period(actor.organizationId, q.yearId, q.span, q.part);
    const [st, closure] = await Promise.all([this.compute(actor.organizationId, p), this.closure(actor.organizationId, p)]);
    const { raw: _raw, ...rest } = st;
    return { ...rest, closure, appropriation: p.endsYear ? await this.appropriationFor(actor.organizationId, p, st) : null };
  }

  // ---------------- تحليل العملاء والموردين ----------------

  /** رصيد كل عميل أو مورد في نهاية الفترة وحركته من بداية السنة، وأعمار الرصيد بطريقة الوارد أولًا يُسدد أولًا */
  async partners(org: string, p: FsPeriod, behavior: 'customer' | 'supplier') {
    const [{ n }] = await this.db.query(
      `SELECT COUNT(*)::int AS n FROM acc_entry_lines l JOIN acc_entries e ON e.id = l.entry_id JOIN acc_partners pt ON pt.id = l.partner_id JOIN acc_partner_categories c ON c.id = pt.category_id
        WHERE e.organization_id = $1 AND e.fiscal_year_id = $2 AND e.status = 'posted' AND e.document_date <= $3 AND c.behavior = $4`, [org, p.year.id, p.to, behavior]);
    if (n > MAX_PARTNER_LINES) throw new BadRequestException('حركة العملاء أو الموردين أكبر من حد التقرير');
    const lines: { pid: string; d: string; dr: string; cr: string; opening: boolean }[] = await this.db.query(
      `SELECT l.partner_id AS pid, to_char(e.document_date, 'YYYY-MM-DD') AS d, l.debit AS dr, l.credit AS cr, e.voucher_type = 'opening' AS opening
         FROM acc_entry_lines l JOIN acc_entries e ON e.id = l.entry_id JOIN acc_partners pt ON pt.id = l.partner_id JOIN acc_partner_categories c ON c.id = pt.category_id
        WHERE e.organization_id = $1 AND e.fiscal_year_id = $2 AND e.status = 'posted' AND e.document_date <= $3 AND c.behavior = $4
        ORDER BY e.document_date, e.entry_no, l.line_no`, [org, p.year.id, p.to, behavior]);
    const partners: { id: string; partner_no: number; name: string; tax_number: string | null; credit_limit: string | null; category: string }[] = await this.db.query(
      `SELECT pt.id, pt.partner_no, pt.name, pt.tax_number, pt.credit_limit, c.name AS category FROM acc_partners pt JOIN acc_partner_categories c ON c.id = pt.category_id
        WHERE pt.organization_id = $1 AND c.behavior = $2 ORDER BY pt.partner_no`, [org, behavior]);
    const sign = behavior === 'customer' ? 1 : -1; // الرصيد الطبيعي: مدين للعميل، دائن للمورد
    const rows = partners.map((pt) => {
      const ls = lines.filter((l) => l.pid === pt.id);
      const opening = ls.filter((l) => l.opening).reduce((t, l) => t + sign * (cents(l.dr) - cents(l.cr)), 0);
      const inc = ls.filter((l) => !l.opening).reduce((t, l) => t + (sign > 0 ? cents(l.dr) : cents(l.cr)), 0);
      const dec = ls.filter((l) => !l.opening).reduce((t, l) => t + (sign > 0 ? cents(l.cr) : cents(l.dr)), 0);
      const balance = opening + inc - dec;
      // الأعمار: ما زاد الرصيد مرتبًا بالتاريخ، وما أنقصه يُطفئ الأقدم أولًا
      const ups = ls.map((l) => ({ d: l.d, v: sign * (cents(l.dr) - cents(l.cr)) })).filter((x) => x.v > 0);
      let paid = ls.map((l) => sign * (cents(l.dr) - cents(l.cr))).filter((v) => v < 0).reduce((t, v) => t - v, 0);
      const aging: Record<string, number> = Object.fromEntries(BUCKETS.map((b) => [b.key, 0]));
      for (const u of ups) {
        const used = Math.min(paid, u.v);
        paid -= used;
        const rest = u.v - used;
        if (!rest) continue;
        const age = days(u.d, p.to);
        aging[BUCKETS.find((b) => age <= b.max)!.key] += rest;
      }
      return {
        id: pt.id, partnerNo: pt.partner_no, name: pt.name, category: pt.category, taxNumber: pt.tax_number, creditLimit: pt.credit_limit === null ? null : Number(pt.credit_limit),
        opening: fromCents(opening), increase: fromCents(inc), decrease: fromCents(dec), balance: fromCents(balance),
        advance: balance < 0 ? fromCents(-balance) : 0,
        ...Object.fromEntries(BUCKETS.map((b) => [b.key, balance > 0 ? fromCents(aging[b.key]) : 0])),
        overLimit: behavior === 'customer' && pt.credit_limit !== null && balance > cents(pt.credit_limit),
      };
    }).filter((r) => r.opening || r.increase || r.decrease || r.balance);
    const sumK = (k: string) => fromCents(rows.reduce((t, r) => t + cents((r as Record<string, unknown>)[k] as number), 0));
    return {
      behavior, rows, buckets: BUCKETS.map((b) => ({ key: b.key, label: b.label })),
      totals: Object.fromEntries(['opening', 'increase', 'decrease', 'balance', 'advance', ...BUCKETS.map((b) => b.key)].map((k) => [k, sumK(k)])),
    };
  }

  // ---------------- مشروع توزيع الأرباح ----------------

  private defaults(): AppropriationInputs {
    return { developmentPct: PROFIT_POLICY.defaults.developmentPct, distributionPct: PROFIT_POLICY.defaults.distributionPct, reserveMonths: PROFIT_POLICY.reserveMonths, unrealizedHalalas: 0, programs: [], boardDecision: null, notes: null };
  }

  /**
   * احتساب المشروع (بالهللات): الأرباح القابلة للتخصيص = صافي ربح السنة − الخسائر المتراكمة − الأرباح غير المحققة نقدًا،
   * ثم حصة التنمية (حتى 30%) ومنها الاحتياطي التشغيلي حتى يبلغ مصروفات أشهر محددة، والتوزيع (حتى 10%)، والباقي للمصارف غير الربحية.
   */
  calcAppropriation(inp: AppropriationInputs, raw: { niYtd: number; reStart: number; expensesYtd: number; reserves: number }) {
    const losses = Math.min(0, raw.reStart);
    const distributable = Math.max(0, raw.niYtd + losses - Math.max(0, inp.unrealizedHalalas));
    const dev = Math.round(distributable * inp.developmentPct / 100);
    const dist = Math.round(distributable * inp.distributionPct / 100);
    const nonprofit = distributable - dev - dist;
    const target = Math.round(Math.max(0, raw.expensesYtd) * inp.reserveMonths / 12);
    const needed = Math.max(0, target - raw.reserves);
    const reserve = Math.min(needed, dev);
    const programs = inp.programs.reduce((t, x) => t + x.amountHalalas, 0);
    const pct = (x: number) => (distributable ? Math.round((x / distributable) * 10000) / 100 : 0);
    const issues: { level: 'error' | 'warning'; text: string }[] = [];
    if (inp.developmentPct > PROFIT_POLICY.maxDevelopmentPct) issues.push({ level: 'error', text: `حصة التنمية تتجاوز حد النظام الأساس (${PROFIT_POLICY.maxDevelopmentPct}%)` });
    if (inp.distributionPct > PROFIT_POLICY.maxDistributionPct) issues.push({ level: 'error', text: `التوزيع يتجاوز حد النظام الأساس (${PROFIT_POLICY.maxDistributionPct}%)` });
    if (programs > nonprofit) issues.push({ level: 'error', text: 'مجموع البرامج المقترحة أكبر من حصة المصارف غير الربحية' });
    if (distributable && pct(nonprofit) < PROFIT_POLICY.minNonprofitPct) issues.push({ level: 'warning', text: `حصة المصارف غير الربحية أقل من ${PROFIT_POLICY.minNonprofitPct}% المقترحة في سياسة POL-FIN-03` });
    if (inp.distributionPct > 0) issues.push({ level: 'warning', text: 'تقترح السياسة عدم التوزيع، ويُوصى برأي قانوني مكتوب قبل أي توزيع' });
    if (raw.niYtd <= 0) issues.push({ level: 'warning', text: 'لا توجد أرباح للسنة، فلا يُخصص شيء' });
    else if (!distributable) issues.push({ level: 'warning', text: 'الخسائر المتراكمة والأرباح غير المحققة تستوعب ربح السنة' });
    const m = fromCents;
    return {
      netProfit: m(raw.niYtd), accumulatedLosses: m(-losses), unrealized: m(Math.max(0, inp.unrealizedHalalas)), distributable: m(distributable),
      development: m(dev), developmentPct: pct(dev), reserveTarget: m(target), reserveBalance: m(raw.reserves), reserve: m(reserve), expansion: m(dev - reserve),
      distribution: m(dist), distributionPct: pct(dist), nonprofit: m(nonprofit), nonprofitPct: pct(nonprofit),
      programsTotal: m(programs), deferred: m(Math.max(0, nonprofit - programs)),
      entries: [
        ...(reserve ? [{ debit: 'الأرباح المبقاة', credit: 'الاحتياطي التشغيلي (الاحتياطيات)', amount: m(reserve) }] : []),
        ...(dev - reserve ? [{ debit: 'الأرباح المبقاة', credit: 'احتياطي تنمية الاستثمارات والتوسع', amount: m(dev - reserve) }] : []),
        ...(nonprofit ? [{ debit: 'الأرباح المبقاة', credit: 'مخصص الإنفاق في المصارف غير الربحية', amount: m(nonprofit) }] : []),
        ...(dist ? [{ debit: 'الأرباح المبقاة', credit: 'توزيعات مستحقة للعضو الوحيد', amount: m(dist) }] : []),
      ],
      issues, valid: !issues.some((i) => i.level === 'error'),
    };
  }

  private async appropriationFor(org: string, p: FsPeriod, st: Awaited<ReturnType<StatementsService['compute']>>) {
    const row = await this.db.getRepository(FsAppropriation).findOne({ where: { organizationId: org, fiscalYearId: p.year.id } });
    const saved = row && !row.withdrawnAt ? row : null;
    const inputs = saved?.inputs ?? this.defaults();
    return {
      saved: !!saved, updatedByName: row?.updatedByName ?? null, updatedAt: row?.updatedAt ?? null, history: row?.history ?? [],
      inputs: { ...inputs, unrealized: fromCents(inputs.unrealizedHalalas), programs: inputs.programs.map((x) => ({ channel: x.channel, name: x.name, amount: fromCents(x.amountHalalas) })) },
      result: this.calcAppropriation(inputs, st.raw),
    };
  }

  async appropriation(actor: OrgUser, yearId: string) {
    const p = await this.period(actor.organizationId, yearId, 'Y');
    const st = await this.compute(actor.organizationId, p);
    return { year: p.year.name, yearStatus: p.year.status, ...(await this.appropriationFor(actor.organizationId, p, st)) };
  }

  async saveAppropriation(actor: OrgUser, yearId: string, dto: { developmentPct: number; distributionPct: number; reserveMonths: number; unrealized: number; programs: { channel: number; name: string; amount: number }[]; boardDecision?: string | null; notes?: string | null }) {
    const org = actor.organizationId;
    const p = await this.period(org, yearId, 'Y');
    const inputs: AppropriationInputs = {
      developmentPct: dto.developmentPct, distributionPct: dto.distributionPct, reserveMonths: dto.reserveMonths, unrealizedHalalas: cents(dto.unrealized),
      programs: dto.programs.map((x) => ({ channel: x.channel, name: x.name.trim(), amountHalalas: cents(x.amount) })),
      boardDecision: dto.boardDecision?.trim() || null, notes: dto.notes?.trim() || null,
    };
    if (dto.programs.some((x) => x.channel < 1 || x.channel > NONPROFIT_CHANNELS.length)) throw new BadRequestException('المصرف غير موجود في المادة (4) من النظام الأساس');
    const st = await this.compute(org, p);
    const r = this.calcAppropriation(inputs, st.raw);
    if (!r.valid) throw new BadRequestException(r.issues.filter((i) => i.level === 'error').map((i) => i.text).join('. '));
    await this.db.transaction(async (em) => {
      const repo = em.getRepository(FsAppropriation);
      const cur = await repo.findOne({ where: { organizationId: org, fiscalYearId: p.year.id }, lock: { mode: 'pessimistic_write' } });
      const h: HistoryEntry = { at: new Date().toISOString(), by: actor.fullName, byId: actor.id, action: !cur ? 'إعداد المشروع' : cur.withdrawnAt ? 'إعادة إعداد المشروع بعد سحبه' : 'تعديل المشروع', before: cur?.inputs ?? null, after: inputs };
      if (cur) {
        cur.history = pushHist(cur.history, h);
        cur.inputs = inputs;
        cur.withdrawnAt = null;
        cur.updatedByName = actor.fullName;
        await repo.save(cur);
      }
      else await repo.save(repo.create({ organizationId: org, fiscalYearId: p.year.id, inputs, createdByName: actor.fullName, updatedByName: actor.fullName, history: [h] }));
    });
    return this.appropriation(actor, yearId);
  }

  async deleteAppropriation(actor: OrgUser, yearId: string) {
    const y = await this.core.year(actor.organizationId, yearId);
    // سحب لا حذف: يبقى السطر وسجل تغييراته، فيُتتبع ما ظهر في أي إصدار سابق
    await this.db.transaction(async (em) => {
      const repo = em.getRepository(FsAppropriation);
      const cur = await repo.findOne({ where: { organizationId: actor.organizationId, fiscalYearId: y.id }, lock: { mode: 'pessimistic_write' } });
      if (!cur || cur.withdrawnAt) throw new NotFoundException('لا يوجد مشروع توزيع لهذه السنة');
      cur.history = pushHist(cur.history, { at: new Date().toISOString(), by: actor.fullName, byId: actor.id, action: 'سحب المشروع', before: cur.inputs, after: null });
      cur.withdrawnAt = new Date();
      cur.updatedByName = actor.fullName;
      await repo.save(cur);
    });
    return { ok: true };
  }

  // ---------------- الإهلاك التفصيلي والمطابقة ----------------

  async depreciation(org: string, p: FsPeriod) {
    const { rows, groups } = await this.assetsReports.rollForward(org, p.year.startDate, p.to);
    const keys = ['costOpening', 'additions', 'disposals', 'costClosing', 'accumOpening', 'depreciation', 'accumDisposed', 'accumClosing', 'nbv'] as const;
    const byGroup = groups.map((g) => {
      const rs = rows.filter((r) => r.group.id === g.id);
      return {
        id: g.id, name: g.name, method: g.method, rate: g.rate, count: rs.length,
        ...Object.fromEntries(keys.map((k) => [k, fromCents(rs.reduce((t, r) => t + cents(r[k]), 0))])) as Record<(typeof keys)[number], number>,
        assets: rs.map((r) => ({ code: r.asset.code, name: r.asset.name, inServiceDate: r.asset.inServiceDate, ...Object.fromEntries(keys.map((k) => [k, r[k]])) as Record<(typeof keys)[number], number> })),
      };
    }).filter((g) => g.count);
    const total = Object.fromEntries(keys.map((k) => [k, fromCents(byGroup.reduce((t, g) => t + cents(g[k]), 0))])) as Record<(typeof keys)[number], number>;
    return { groups: byGroup, total };
  }

  // ---------------- سجل الإصدارات ----------------

  async issues(actor: OrgUser) {
    const rows = await this.db.getRepository(FsIssue).find({ where: { organizationId: actor.organizationId }, order: { issueNo: 'DESC' }, take: 200 });
    const years = new Map((await this.core.years(actor.organizationId)).map((y) => [y.id, y.name]));
    return rows.map((r) => ({ ...r, year: years.get(r.fiscalYearId) ?? null }));
  }

  /**
   * الإصدار النهائي: يحجز رقم الإصدار التالي (قفل استشاري لكل منشأة حتى لا يتكرر الرقم)، ويولّد الملف بهذا الرقم،
   * ثم يسجل الإصدار وبصمة الملف في المعاملة نفسها؛ فلا يُحجز رقم بلا ملف ولا يصدر ملف بلا سجل.
   */
  async issue(actor: OrgUser, p: FsPeriod, render: (issueNo: number) => Promise<{ pdf: Buffer; totals: Record<string, number> }>) {
    const org = actor.organizationId;
    return this.db.transaction(async (em) => {
      await em.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`acc_fs_issues:${org}`]);
      // تثبيت إغلاق شهور الفترة حتى نهاية المعاملة: فك إغلاق أي منها ينتظر حتى يُسجَّل الإصدار، فلا تتغير الأرقام أثناء التوليد
      await em.query(
        'SELECT month FROM acc_period_locks WHERE organization_id = $1 AND fiscal_year_id = $2 AND month = ANY($3) FOR SHARE', [org, p.year.id, p.months]);
      await this.assertClosed(org, p);
      const [{ n }] = await em.query('SELECT COALESCE(MAX(issue_no), 0) + 1 AS n FROM acc_fs_issues WHERE organization_id = $1', [org]);
      // الأرقام تُحتسب بعد القفل، فتطابق الفترة المغلقة كما هي لحظة الإصدار
      const { pdf, totals } = await render(n);
      const sha256 = createHash('sha256').update(pdf).digest('hex');
      const row = await em.getRepository(FsIssue).save(em.getRepository(FsIssue).create({
        organizationId: org, issueNo: n, fiscalYearId: p.year.id, periodKey: p.key, periodLabel: p.label.slice(0, 120), fromDate: p.from, toDate: p.to,
        totals, sha256, issuedByName: actor.fullName, issuedById: actor.id,
      }));
      return { row, pdf };
    });
  }
}
