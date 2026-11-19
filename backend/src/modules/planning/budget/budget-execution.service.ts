import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { DataSource, EntityManager, In } from 'typeorm';
import { OrgUser } from '../../../core/auth/decorators';
import { DecideDto } from '../planning.dto';
import { canDecide, pickRoute, wfDecide, wfSubmit } from '../planning-calc';
import { PlanningCore } from '../planning-core.service';
import { PLANNING_PERMISSIONS as P } from '../planning.manifest';
import { r2 } from './budget-calc';
import { MONTHS_AR, Section, SECTION_NAME } from './budget-defaults';
import { LineMappingDto, TransferDto } from './budget.dto';
import { Budget, BudgetLine, BudgetTransfer, BudgetVersion, SnapLine } from './budget.entity';
import { BudgetSources } from './budget-sources.service';

const sum = (a: number[]) => r2(a.reduce((s, x) => s + x, 0));
const KIND_NAME = { transfer: 'مناقلة', increase: 'زيادة', decrease: 'تخفيض' } as const;
export type ExecMethod = 'plan' | 'run_rate';

export interface ExecRow {
  key: string; lineId: string | null; lineIds: string[]; section: Section; sectionName: string; kind: string; name: string; unitName: string | null; ref: string | null;
  original: number; approved: number; transfers: number; current: number; plannedToDate: number;
  actual: number; actualSource: 'account' | 'payroll' | 'commitments'; reserved: number; consumed: number; available: number | null;
  variance: number; variancePct: number | null; forecast: number; forecastVariance: number; status: 'over' | 'warn' | 'ok'; mapped: boolean;
  planned: number[]; actualByMonth: number[];
}

/**
 * متابعة الموازنة أثناء التنفيذ مع النظام المالي:
 * الأصلية (الإصدار الأول) والمعتمدة الحالية والمناقلات المعتمدة، والمخطط حتى الشهر مقابل الفعلي من القيود المرحّلة،
 * والحجوزات من الأنظمة الأخرى، والمتاح، والانحرافات، والتوقع حتى نهاية السنة، والتتبع إلى القيود.
 * والمناقلات والزيادات والتخفيضات بدراسة أثر قبل الطلب ومسار اعتماد خاص.
 */
@Injectable()
export class BudgetExecution {
  constructor(private readonly db: DataSource, private readonly core: PlanningCore, private readonly sources: BudgetSources) {}

  private async approvedBudget(em: EntityManager, org: string, id: string, lock = false) {
    const b = await em.getRepository(Budget).findOne({ where: { id, organizationId: org }, ...(lock ? { lock: { mode: 'pessimistic_write' as const } } : {}) });
    if (!b) throw new NotFoundException('الموازنة غير موجودة');
    if (b.isScenario) throw new BadRequestException('السيناريو لا يُتابع تنفيذه. حوّله إلى الموازنة أولًا');
    if (b.version < 1) throw new ConflictException('تبدأ متابعة التنفيذ بعد اعتماد الموازنة');
    return b;
  }

  approved(org: string, id: string) { return this.approvedBudget(this.db.manager, org, id); }

  /** الشهر الافتراضي للمتابعة: الشهر الحالي في السنة الجارية، و12 لسنة مضت، و0 لسنة لم تبدأ */
  defaultMonth(year: number) {
    const now = new Date();
    const y = now.getFullYear();
    return year < y ? 12 : year > y ? 0 : now.getMonth() + 1;
  }

  /** المناقلات المعتمدة على كل بند (مبلغ موجب للزيادة وسالب للتخفيض، وشهر السريان) */
  private transfersNet(ts: BudgetTransfer[]) {
    const net = new Map<string, { amount: number; from: number }[]>();
    const add = (id: string | null, amount: number, from: number) => { if (id) net.set(id, [...(net.get(id) ?? []), { amount, from }]); };
    for (const t of ts.filter((x) => x.status === 'approved')) {
      add(t.toLineId, t.amount, t.fromMonth);
      add(t.fromLineId, -t.amount, t.fromMonth);
    }
    return net;
  }

  /**
   * أثر المناقلات على التوزيع الشهري لبند: الزيادة توزع بالتساوي من شهر سريانها،
   * والتخفيض يُخصم من الأشهر المتبقية بنسبها، فإن لم تكفِ فمن كل أشهر السنة بنسبها (فلا يصبح شهر سالبًا).
   */
  private applyTransfers(monthly: number[], ts: { amount: number; from: number }[]) {
    const m = [...monthly];
    for (const t of ts) {
      const from = Math.min(12, Math.max(1, t.from));
      if (t.amount >= 0) { for (let i = from - 1; i < 12; i++) m[i] += t.amount / (12 - from + 1); continue; }
      const cut = -t.amount;
      const rest = m.slice(from - 1).reduce((a, x) => a + Math.max(0, x), 0);
      const total = m.reduce((a, x) => a + Math.max(0, x), 0);
      const start = rest >= cut ? from - 1 : 0, base = rest >= cut ? rest : total;
      if (base <= 0) { m[11] -= cut; continue; }
      for (let i = start; i < 12; i++) m[i] -= (Math.max(0, m[i]) / base) * cut;
    }
    return m.map(r2);
  }

  async execution(actor: OrgUser, id: string, q: { month?: number; method?: ExecMethod; threshold?: number } = {}) {
    const b = await this.approvedBudget(this.db.manager, actor.organizationId, id);
    const r = await this.compute(actor.organizationId, b, q);
    const ts = await this.db.getRepository(BudgetTransfer).find({ where: { budgetId: id }, order: { createdAt: 'DESC' } });
    const ctrl = await this.core.decider(actor, P.budgetsApprove);
    return {
      ...r,
      transfers: ts.map((t) => ({ ...t, kindName: KIND_NAME[t.kind], canDecide: canDecide(t, ctrl), stageName: t.status === 'in_review' && t.stageIndex !== null ? t.wfStages[t.stageIndex]?.name ?? null : null })),
    };
  }

  /** حساب المتابعة لموازنة معتمدة حتى شهر */
  async compute(org: string, b: Budget, q: { month?: number; method?: ExecMethod; threshold?: number } = {}) {
    const id = b.id;
    const month = q.month === undefined || q.month === null || Number.isNaN(q.month) ? this.defaultMonth(b.fiscalYear) : Math.min(12, Math.max(0, Math.round(q.month)));
    const method: ExecMethod = q.method === 'run_rate' ? 'run_rate' : 'plan';
    const threshold = Math.min(100, Math.max(1, q.threshold ?? 10));
    const [latest, first, live, transfers, commits, payroll] = await Promise.all([
      this.db.getRepository(BudgetVersion).findOneOrFail({ where: { budgetId: id, version: b.version } }),
      this.db.getRepository(BudgetVersion).findOneOrFail({ where: { budgetId: id, version: 1 } }),
      this.db.getRepository(BudgetLine).find({ where: { budgetId: id }, select: ['id', 'actualMap', 'accountId', 'costCenterId'] }),
      this.db.getRepository(BudgetTransfer).find({ where: { budgetId: id }, order: { createdAt: 'DESC' } }),
      this.db.query(
        `SELECT line_id AS "lineId", COALESCE(SUM(CASE WHEN status = 'reserved' THEN amount END), 0)::float AS reserved,
                COALESCE(SUM(CASE WHEN status = 'consumed' THEN amount END), 0)::float AS consumed
           FROM plan_budget_commitments WHERE budget_id = $1 GROUP BY 1`, [id]) as Promise<{ lineId: string; reserved: number; consumed: number }[]>,
      this.sources.payrollAccounts(org),
    ]);
    const liveMap = new Map(live.map((l) => [l.id, l]));
    const firstAmt = new Map(first.snapshot.lines.filter((l) => l.included).map((l) => [l.id, l.amount]));
    const net = this.transfersNet(transfers);
    const cm = new Map(commits.map((c) => [c.lineId, c]));
    const lines = latest.snapshot.lines.filter((l) => l.included);

    // مصادر الفعلي: الحسابات المربوطة بكل بند، وحسابات الرواتب لمجموعة الموارد البشرية
    const mapping = (l: SnapLine) => {
      const m = liveMap.get(l.id);
      if (m?.actualMap?.accountIds?.length) return { accountIds: m.actualMap.accountIds, costCenterId: m.actualMap.costCenterId ?? null, mapped: true };
      if (l.accountId) return { accountIds: [l.accountId], costCenterId: l.costCenterId, mapped: false };
      return null;
    };
    const cache = new Map<string, Promise<number[]>>();
    const actualFor = (accountIds: string[], cc: string | null) => {
      const k = `${[...accountIds].sort().join(',')}|${cc ?? ''}`;
      if (!cache.has(k)) cache.set(k, this.sources.actualMonthly(org, b.fiscalYear, accountIds, cc));
      return cache.get(k)!;
    };
    const upTo = (a: number[]) => sum(a.slice(0, month));

    const rows: ExecRow[] = [];
    const build = async (key: string, ls: SnapLine[], base: Partial<ExecRow>, act: { monthly: number[]; source: ExecRow['actualSource'] } | null, mapped: boolean) => {
      const section = ls[0].section as Section;
      const approvedM = Array.from({ length: 12 }, (_, i) => r2(ls.reduce((s, l) => s + (l.monthly[i] ?? 0), 0)));
      const planned = Array.from({ length: 12 }, () => 0);
      for (const l of ls) this.applyTransfers(l.monthly.length === 12 ? l.monthly : Array(12).fill(0), net.get(l.id) ?? []).forEach((x, i) => { planned[i] = r2(planned[i] + x); });
      const original = r2(ls.reduce((s, l) => s + (firstAmt.get(l.id) ?? 0), 0));
      const approved = sum(approvedM), transfersAmt = r2(ls.reduce((s, l) => s + (net.get(l.id) ?? []).reduce((a, t) => a + t.amount, 0), 0)), current = r2(approved + transfersAmt);
      const reserved = r2(ls.reduce((s, l) => s + (cm.get(l.id)?.reserved ?? 0), 0));
      const consumed = r2(ls.reduce((s, l) => s + (cm.get(l.id)?.consumed ?? 0), 0));
      const actualByMonth = act ? act.monthly.map((x, i) => (i < month ? x : 0)) : Array(12).fill(0);
      // بلا حساب مربوط: الفعلي هو ما صُرف من الحجوزات
      const actual = act ? upTo(act.monthly) : consumed;
      const plannedToDate = upTo(planned);
      const isRev = section === 'revenue';
      // الصرف من الحجوزات يظهر في القيود أيضًا، فيُؤخذ الأكبر منهما لتجنب الاحتساب مرتين
      const used = act ? Math.max(actual, consumed) : consumed;
      const available = isRev ? null : r2(current - used - reserved);
      // المتبقي من الموازنة المعدلة بعد المخطط حتى الشهر يُضاف للفعلي (طريقة الخطة)، أو يُمدّ معدل الصرف الشهري (طريقة المعدل)
      const rest = Math.max(0, r2(current - plannedToDate));
      let forecast = method === 'run_rate' && month > 0 ? r2((actual / month) * 12) : r2(actual + rest);
      // المحجوز سيُصرف: لا يقل التوقع عن الفعلي مع المحجوز
      if (!isRev) forecast = Math.max(forecast, r2(used + reserved));
      const variance = r2(actual - plannedToDate);
      const variancePct = plannedToDate ? r2((variance / plannedToDate) * 100) : null;
      let status: ExecRow['status'] = 'ok';
      if (isRev) { if (variancePct !== null && variancePct < -threshold) status = 'warn'; }
      else if (available !== null && available < 0) status = 'over';
      else if ((variancePct !== null && variancePct > threshold) || forecast > current * (1 + threshold / 100)) status = 'warn';
      rows.push({
        key, lineId: null, lineIds: ls.map((l) => l.id), section, sectionName: SECTION_NAME[section], kind: ls[0].kind, name: ls[0].name, unitName: ls[0].unitName, ref: ls[0].accountCode ?? ls[0].sourceRef ?? null,
        original, approved, transfers: transfersAmt, current, plannedToDate, actual, actualSource: act?.source ?? 'commitments', reserved, consumed, available,
        variance, variancePct, forecast, forecastVariance: r2(forecast - current), status, mapped, planned, actualByMonth, ...base,
      });
    };

    // الموارد البشرية: البنود غير المربوطة تُجمع في صف واحد فعليه من حسابات الرواتب
    const hrGroup = lines.filter((l) => l.section === 'hr' && (l.kind === 'employee' || !mapping(l)));
    if (hrGroup.length) {
      const ids = [...payroll];
      await build('hr:group', hrGroup, { name: `الرواتب وتكاليف الموظفين (${hrGroup.length} بندًا)`, kind: 'hr_group', unitName: null, ref: ids.length ? 'حسابات الرواتب' : null },
        ids.length ? { monthly: await actualFor(ids, null), source: 'payroll' } : null, false);
    }
    for (const l of lines.filter((x) => !hrGroup.includes(x))) {
      const mp = mapping(l);
      await build(l.id, [l], { lineId: l.id }, mp ? { monthly: await actualFor(mp.accountIds, mp.costCenterId), source: 'account' } : null, !!mp?.mapped);
    }
    // بنود أضافتها مناقلات (غير موجودة في الإصدار المعتمد) لا تُتوقع: المناقلة بين بنود الإصدار فقط

    // فعلي خارج الموازنة: حسابات مصروفات أو إيرادات عليها حركة ولا يربطها بند
    const covered = new Set<string>([...(hrGroup.length ? payroll : []), ...lines.flatMap((l) => mapping(l)?.accountIds ?? [])]);
    const all = await this.sources.actuals(org, b.fiscalYear, b.fiscalYear);
    const outside = new Map<string, { accountId: string; code: string; name: string; nature: string; actual: number }>();
    for (const r of all.filter((x) => x.m <= month && !covered.has(x.accountId))) {
      const o = outside.get(r.accountId) ?? { accountId: r.accountId, code: r.code, name: r.name, nature: r.nature, actual: 0 };
      o.actual = r2(o.actual + r.amount);
      outside.set(r.accountId, o);
    }

    const exp = rows.filter((r) => r.section !== 'revenue'), rev = rows.filter((r) => r.section === 'revenue');
    const tot = (rs: ExecRow[]) => ({
      original: sum(rs.map((r) => r.original)), approved: sum(rs.map((r) => r.approved)), transfers: sum(rs.map((r) => r.transfers)), current: sum(rs.map((r) => r.current)),
      plannedToDate: sum(rs.map((r) => r.plannedToDate)), actual: sum(rs.map((r) => r.actual)), reserved: sum(rs.map((r) => r.reserved)),
      available: sum(rs.map((r) => r.available ?? 0)), forecast: sum(rs.map((r) => r.forecast)),
    });
    const outsideList = [...outside.values()].filter((o) => o.actual !== 0).sort((a, c) => Math.abs(c.actual) - Math.abs(a.actual));
    const alerts = [
      ...exp.filter((r) => r.status === 'over').map((r) => ({ level: 'danger', key: r.key, text: `تجاوز «${r.name}» موازنته المعدلة بمبلغ ${Math.abs(r.available ?? 0).toLocaleString('en-US')}` })),
      ...exp.filter((r) => r.status === 'warn').map((r) => ({ level: 'warning', key: r.key, text: r.variancePct !== null && r.variancePct > threshold
        ? `الصرف في «${r.name}» أعلى من المخطط حتى ${MONTHS_AR[Math.max(0, month - 1)]} بنسبة ${r.variancePct}%` : `التوقع لنهاية السنة في «${r.name}» يتجاوز موازنته بمبلغ ${r.forecastVariance.toLocaleString('en-US')}` })),
      ...rev.filter((r) => r.status === 'warn').map((r) => ({ level: 'warning', key: r.key, text: `التحصيل في «${r.name}» أقل من المخطط بنسبة ${Math.abs(r.variancePct ?? 0)}%` })),
      ...outsideList.filter((o) => o.nature === 'expenses').slice(0, 5).map((o) => ({ level: 'info', key: `acc:${o.accountId}`, text: `مصروف على الحساب ${o.code} ${o.name} (${o.actual.toLocaleString('en-US')}) لا يقابله بند في الموازنة` })),
    ];
    const monthsTotal = (rs: ExecRow[], f: 'planned' | 'actualByMonth') => Array.from({ length: 12 }, (_, i) => sum(rs.map((r) => r[f][i])));
    return {
      budget: { id: b.id, code: b.code, title: b.title, fiscalYear: b.fiscalYear, version: b.version, status: b.status },
      month, method, threshold, monthName: month ? MONTHS_AR[month - 1] : null,
      rows, outside: outsideList,
      totals: { expenses: tot(exp), revenues: tot(rev) },
      byMonth: { planned: monthsTotal(exp, 'planned'), actual: monthsTotal(exp, 'actualByMonth'), revPlanned: monthsTotal(rev, 'planned'), revActual: monthsTotal(rev, 'actualByMonth') },
      alerts,
    };
  }

  /** القيود والحجوزات خلف صف في المتابعة: تتبع الفعلي إلى مصدره */
  async trace(actor: OrgUser, id: string, key: string, month?: number) {
    const org = actor.organizationId;
    const b = await this.approvedBudget(this.db.manager, org, id);
    const m = month === undefined || Number.isNaN(month) ? this.defaultMonth(b.fiscalYear) : Math.min(12, Math.max(0, month));
    let accountIds: string[] = [], cc: string | null = null, lineIds: string[] = [];
    if (key === 'hr:group') {
      accountIds = [...(await this.sources.payrollAccounts(org))];
      const v = await this.db.getRepository(BudgetVersion).findOneOrFail({ where: { budgetId: id, version: b.version } });
      lineIds = v.snapshot.lines.filter((l) => l.section === 'hr').map((l) => l.id);
    } else {
      const l = await this.db.getRepository(BudgetLine).findOne({ where: { id: key, budgetId: id } });
      if (!l) throw new NotFoundException('البند غير موجود');
      if (l.section === 'hr' && l.kind === 'employee' && !(actor.isSuperadmin || actor.permissions.includes(P.budgetsHr))) throw new BadRequestException('بيانات الموظف ليست من صلاحيتك');
      lineIds = [l.id];
      if (l.actualMap?.accountIds?.length) { accountIds = l.actualMap.accountIds; cc = l.actualMap.costCenterId ?? null; } else if (l.accountId) { accountIds = [l.accountId]; cc = l.costCenterId; }
    }
    const [entries, commitments] = await Promise.all([
      this.sources.entriesFor(org, b.fiscalYear, m, accountIds, cc),
      this.db.query(
        `SELECT id, source_module AS "sourceModule", source_ref AS "sourceRef", amount::float, status, note, funding_batch_id AS "fundingBatchId", created_by_name AS "createdByName", created_at AS "createdAt"
           FROM plan_budget_commitments WHERE line_id = ANY($1) ORDER BY created_at DESC LIMIT 200`, [lineIds]),
    ]);
    return { key, month: m, accountIds, costCenterId: cc, entries, commitments, source: accountIds.length ? 'القيود المرحّلة في النظام المحاسبي بتاريخ المستند' : 'لا يوجد حساب مربوط؛ الفعلي من الحجوزات المصروفة' };
  }

  /** ربط بند بحسابات الفعلي (لا يغيّر الموازنة المعتمدة) */
  async map(actor: OrgUser, lineId: string, dto: LineMappingDto) {
    const org = actor.organizationId;
    const l = await this.db.getRepository(BudgetLine).findOne({ where: { id: lineId, organizationId: org } });
    if (!l) throw new NotFoundException('البند غير موجود');
    const b = await this.db.getRepository(Budget).findOneOrFail({ where: { id: l.budgetId } });
    if (b.isScenario) throw new BadRequestException('الربط بالفعلي للموازنة وليس للسيناريو');
    const ids = [...new Set(dto.accountIds ?? [])];
    if (ids.length) {
      const ok: { id: string; nature: string }[] = await this.db.query(`SELECT id, nature FROM acc_accounts WHERE organization_id = $1 AND id = ANY($2) AND kind = 'sub'`, [org, ids]).catch(() => []);
      if (ok.length !== ids.length) throw new BadRequestException('بعض الحسابات غير موجودة أو ليست حسابات فرعية');
      if (ok.some((a) => (a.nature === 'revenue') !== (l.section === 'revenue'))) throw new BadRequestException(l.section === 'revenue' ? 'اختر حسابات إيرادات' : 'اختر حسابات مصروفات');
      if (dto.costCenterId) await this.core.costCenterName(org, dto.costCenterId, this.db.manager);
    }
    l.actualMap = ids.length ? { accountIds: ids, costCenterId: dto.costCenterId || null } : null;
    await this.db.getRepository(BudgetLine).update({ id: l.id }, { actualMap: l.actualMap });
    return { id: l.id, actualMap: l.actualMap };
  }

  // ---------------- المناقلات والتعديلات ----------------

  /** دراسة الأثر: المتاح في البندين وإجمالي الموازنة قبل وبعد */
  private async impact(org: string, b: Budget, dto: TransferDto) {
    const ex = await this.compute(org, b, {});
    const row = (id: string | null | undefined) => {
      if (!id) return null;
      const r = ex.rows.find((x) => x.lineIds.includes(id));
      if (!r) throw new BadRequestException('البند غير موجود في الإصدار المعتمد من الموازنة');
      if (r.section === 'revenue') throw new BadRequestException('المناقلات على بنود المصروفات فقط');
      return r;
    };
    const from = row(dto.fromLineId), to = row(dto.toLineId);
    if (dto.kind === 'transfer' && (!from || !to)) throw new BadRequestException('حدد البند المنقول منه والبند المنقول إليه');
    if (dto.kind === 'transfer' && from === to) throw new BadRequestException('اختر بندين مختلفين');
    if (dto.kind === 'increase' && !to) throw new BadRequestException('حدد البند المراد زيادته');
    if (dto.kind === 'decrease' && !from) throw new BadRequestException('حدد البند المراد تخفيضه');
    const side = (r: ExecRow | null, sign: number) => r && ({ name: r.name, current: r.current, available: r.available, after: r2(r.current + sign * dto.amount), availableAfter: r2((r.available ?? 0) + sign * dto.amount) });
    const delta = dto.kind === 'increase' ? dto.amount : dto.kind === 'decrease' ? -dto.amount : 0;
    return {
      from: dto.kind === 'increase' ? null : side(from, -1), to: dto.kind === 'decrease' ? null : side(to, 1),
      totalBefore: ex.totals.expenses.current, totalAfter: r2(ex.totals.expenses.current + delta),
      balanceBefore: r2(ex.totals.revenues.current - ex.totals.expenses.current), balanceAfter: r2(ex.totals.revenues.current - ex.totals.expenses.current - delta),
      fromName: from?.name ?? null, toName: to?.name ?? null,
    };
  }

  async preview(actor: OrgUser, id: string, dto: TransferDto) {
    const b = await this.approvedBudget(this.db.manager, actor.organizationId, id);
    const im = await this.impact(actor.organizationId, b, dto);
    const short = im.from && dto.kind !== 'increase' && (im.from.available ?? 0) < dto.amount ? r2(dto.amount - (im.from.available ?? 0)) : 0;
    return { ...im, allowed: !short, message: short ? `المبلغ يتجاوز المتاح في «${im.from!.name}» بمبلغ ${short.toLocaleString('en-US')}` : null };
  }

  async request(actor: OrgUser, id: string, dto: TransferDto) {
    const org = actor.organizationId;
    const cfg = await this.core.config(org);
    const tid = await this.db.transaction(async (em) => {
      const b = await this.approvedBudget(em, org, id, true);
      const p = await this.preview(actor, id, dto);
      if (!p.allowed) throw new ConflictException(p.message);
      const repo = em.getRepository(BudgetTransfer);
      const unit = dto.toLineId ?? dto.fromLineId;
      const [u] = unit ? await em.query('SELECT unit_id AS "unitId" FROM plan_budget_lines WHERE id = $1', [unit]) : [{ unitId: null }];
      const t = repo.create({
        organizationId: org, budgetId: b.id, code: await this.core.nextCode(em, org, 'BT'), kind: dto.kind,
        fromLineId: dto.kind === 'increase' ? null : dto.fromLineId ?? null, toLineId: dto.kind === 'decrease' ? null : dto.toLineId ?? null,
        fromName: p.fromName, toName: p.toName, amount: r2(dto.amount), fromMonth: dto.fromMonth ?? 1, reason: dto.reason, impact: p as unknown as Record<string, unknown>,
        status: 'draft', approvals: [], wfStages: [], createdByName: actor.fullName,
      });
      const route = pickRoute(cfg.routes, 'transfer', u?.unitId ?? null, t.amount);
      t.routeName = route?.name ?? null;
      wfSubmit(t, route?.stages ?? [], actor.fullName, dto.reason);
      await repo.save(t);
      return t.id;
    });
    return this.db.getRepository(BudgetTransfer).findOneByOrFail({ id: tid });
  }

  async decide(actor: OrgUser, transferId: string, dto: DecideDto) {
    const org = actor.organizationId;
    const d = await this.core.decider(actor, P.budgetsApprove);
    return this.db.transaction(async (em) => {
      const t = await em.getRepository(BudgetTransfer).findOne({ where: { id: transferId, organizationId: org }, lock: { mode: 'pessimistic_write' } });
      if (!t) throw new NotFoundException('الطلب غير موجود');
      wfDecide(t, d, dto.decision, dto.note ?? null);
      if (t.status === 'approved' && t.fromLineId) {
        // يُعاد فحص المتاح عند الاعتماد النهائي (قد يتغير الصرف بعد الطلب)
        const p = await this.preview(actor, t.budgetId, { kind: t.kind, fromLineId: t.fromLineId, toLineId: t.toLineId, amount: t.amount, reason: t.reason, fromMonth: t.fromMonth });
        if (!p.allowed) throw new ConflictException(`لا يمكن الاعتماد الآن: ${p.message}`);
      }
      return em.getRepository(BudgetTransfer).save(t);
    });
  }

  async cancel(actor: OrgUser, transferId: string) {
    const t = await this.db.getRepository(BudgetTransfer).findOne({ where: { id: transferId, organizationId: actor.organizationId } });
    if (!t) throw new NotFoundException('الطلب غير موجود');
    if (t.status === 'approved') throw new ConflictException('المناقلة المعتمدة لا تُلغى. اطلب مناقلة عكسية');
    await this.db.getRepository(BudgetTransfer).delete({ id: t.id });
    return { ok: true };
  }

  /** طلبات المناقلة بانتظار قرار المستخدم (لجرس المهام) */
  async pendingFor(actor: OrgUser) {
    const ts = await this.db.getRepository(BudgetTransfer).find({ where: { organizationId: actor.organizationId, status: 'in_review' } });
    const d = await this.core.decider(actor, P.budgetsApprove);
    return ts.filter((t) => canDecide(t, d));
  }

  /** صافي المناقلات المعتمدة على بنود (للمتاح) */
  async netFor(lineIds: string[], em: EntityManager = this.db.manager) {
    if (!lineIds.length) return new Map<string, number>();
    const ts = await em.getRepository(BudgetTransfer).find({ where: [{ fromLineId: In(lineIds), status: 'approved' }, { toLineId: In(lineIds), status: 'approved' }] });
    const out = new Map<string, number>();
    for (const t of ts) {
      if (t.toLineId) out.set(t.toLineId, r2((out.get(t.toLineId) ?? 0) + t.amount));
      if (t.fromLineId) out.set(t.fromLineId, r2((out.get(t.fromLineId) ?? 0) - t.amount));
    }
    return out;
  }
}
