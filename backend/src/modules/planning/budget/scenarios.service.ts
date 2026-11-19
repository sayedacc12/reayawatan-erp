import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { DataSource, EntityManager, In } from 'typeorm';
import { OrgUser } from '../../../core/auth/decorators';
import { PlanningCore } from '../planning-core.service';
import { r2 } from './budget-calc';
import { Section, SECTION_NAME, SECTIONS } from './budget-defaults';
import { PromoteDto, ScenarioDto } from './budget.dto';
import { Budget, BudgetLine } from './budget.entity';
import { BudgetsService } from './budgets.service';

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));
const MAX_SCENARIOS = 10;
type Totals = { sections: Record<Section, number>; expenses: number; revenues: number; balance: number };

function totals(lines: Pick<BudgetLine, 'included' | 'section' | 'amount'>[]): Totals {
  const sections = Object.fromEntries(SECTIONS.map((s) => [s, r2(lines.filter((l) => l.included && l.section === s).reduce((t, l) => t + l.amount, 0))])) as Record<Section, number>;
  const expenses = r2(sections.hr + sections.opex + sections.activity);
  return { sections, expenses, revenues: sections.revenue, balance: r2(sections.revenue - expenses) };
}

/**
 * السيناريوهات: نسخ مستقلة من موازنة أساسية بافتراضاتها وبنودها، تُغيَّر فيها الافتراضات والبنود والمؤثرات
 * (انخفاض الإيرادات، التضخم، العلاوات، التوظيف، تأجيل الأنشطة)، ثم تُقارن ويُحلَّل أثر كل متغير،
 * ويُحوَّل المختار منها إلى مشروع موازنة على الأساسية يخضع لمسار الاعتماد. الموازنة المعتمدة لا تتغير بإنشاء سيناريو.
 */
@Injectable()
export class ScenariosService {
  constructor(private readonly db: DataSource, private readonly core: PlanningCore, private readonly budgets: BudgetsService) {}

  private async base(em: EntityManager, org: string, id: string, lock = false) {
    const b = await this.budgets.budget(em, org, id, lock);
    if (b.isScenario) throw new BadRequestException('اختر الموازنة الأساسية وليس سيناريو');
    return b;
  }

  private async scenario(em: EntityManager, org: string, id: string, lock = false) {
    const s = await this.budgets.budget(em, org, id, lock);
    if (!s.isScenario || !s.baseBudgetId) throw new NotFoundException('السيناريو غير موجود');
    return s;
  }

  async create(actor: OrgUser, baseId: string, dto: ScenarioDto) {
    const org = actor.organizationId;
    const id = await this.db.transaction(async (em) => {
      const base = await this.base(em, org, baseId, true);
      const count = await em.getRepository(Budget).count({ where: { organizationId: org, baseBudgetId: baseId, isScenario: true } });
      if (count >= MAX_SCENARIOS) throw new ConflictException(`الحد الأقصى ${MAX_SCENARIOS} سيناريوهات للموازنة الواحدة. احذف سيناريو لا تحتاجه`);
      const src = dto.copyFromId ? await this.scenario(em, org, dto.copyFromId) : base;
      if (src.isScenario && src.baseBudgetId !== baseId) throw new BadRequestException('السيناريو المنسوخ ليس من هذه الموازنة');
      const repo = em.getRepository(Budget);
      const s = await repo.save(repo.create({
        organizationId: org, code: await this.core.nextCode(em, org, 'SC'), title: dto.title, fiscalYear: base.fiscalYear, description: dto.description ?? null,
        methodology: src.methodology, historyYears: src.historyYears, variables: clone(src.variables), raiseRules: clone(src.raiseRules),
        hrSetup: clone(src.hrSetup), ceilings: clone(src.ceilings), levers: src.isScenario ? clone(src.levers ?? []) : [],
        isScenario: true, baseBudgetId: baseId, status: 'draft', version: 0, createdByName: actor.fullName,
      }));
      const lines = await em.getRepository(BudgetLine).find({ where: { budgetId: src.id }, order: { sortOrder: 'ASC' } });
      const lr = em.getRepository(BudgetLine);
      const rows = lines.map((l) => lr.create({ ...this.budgets.pickLine(l), id: undefined, organizationId: org, budgetId: s.id, baseLineId: src.isScenario ? l.baseLineId : l.id }));
      await lr.save(rows, { chunk: 200 });
      if (dto.levers !== undefined) s.levers = await this.budgets.cleanLevers(org, dto.levers, em, s.id);
      await this.budgets.recalcAll(em, s);
      return s.id;
    });
    return this.budgets.get(actor, id);
  }

  /** سيناريوهات موازنة مع إجمالياتها مقارنة بالأساسية */
  async list(actor: OrgUser, baseId: string) {
    const org = actor.organizationId;
    const base = await this.base(this.db.manager, org, baseId);
    const scs = await this.db.getRepository(Budget).find({ where: { organizationId: org, baseBudgetId: baseId, isScenario: true }, order: { createdAt: 'ASC' } });
    const ids = [base.id, ...scs.map((s) => s.id)];
    const agg: { budgetId: string; section: Section; amount: number; heads: number; newHeads: number }[] = await this.db.query(
      `SELECT budget_id AS "budgetId", section, SUM(CASE WHEN included THEN amount ELSE 0 END)::float AS amount,
              SUM(CASE WHEN included AND kind = 'employee' THEN COALESCE((params->>'count')::numeric, 1) ELSE 0 END)::float AS heads,
              SUM(CASE WHEN included AND kind = 'new_position' THEN COALESCE((params->>'count')::numeric, 1) ELSE 0 END)::float AS "newHeads"
         FROM plan_budget_lines WHERE budget_id = ANY($1) GROUP BY 1, 2`, [ids]);
    const row = (b: Budget) => {
      const a = agg.filter((x) => x.budgetId === b.id);
      const t = totals(a.map((x) => ({ included: true, section: x.section, amount: x.amount })));
      return {
        id: b.id, code: b.code, title: b.title, description: b.description, isScenario: b.isScenario, status: b.status, version: b.version,
        ...t, headcount: { current: a.reduce((s, x) => s + x.heads, 0), new: a.reduce((s, x) => s + x.newHeads, 0) },
        levers: b.levers ?? [], promotedAt: b.promotedAt, promotedByName: b.promotedByName, createdByName: b.createdByName, updatedAt: b.updatedAt, calculatedAt: b.calculatedAt,
      };
    };
    const bt = row(base);
    return {
      base: bt,
      scenarios: scs.map((s) => {
        const r = row(s);
        return { ...r, diff: { expenses: r2(r.expenses - bt.expenses), revenues: r2(r.revenues - bt.revenues), balance: r2(r.balance - bt.balance) } };
      }),
    };
  }

  /**
   * مقارنة الموازنة الأساسية بعدة سيناريوهات: الإجماليات والأقسام والإدارات والأشهر والبنود الأكثر اختلافًا والافتراضات والمؤثرات.
   * من لا يملك صلاحية الرواتب يرى الموظفين الحاليين مجمعين في سطر واحد.
   */
  async compare(actor: OrgUser, baseId: string, ids: string[]) {
    const org = actor.organizationId;
    const base = await this.base(this.db.manager, org, baseId);
    const uniq = [...new Set(ids)].filter((x) => x !== baseId).slice(0, 5);
    const scs = uniq.length ? await this.db.getRepository(Budget).find({ where: { organizationId: org, baseBudgetId: baseId, isScenario: true, id: In(uniq) } }) : [];
    if (scs.length !== uniq.length) throw new BadRequestException('بعض السيناريوهات المختارة ليست من هذه الموازنة');
    const cols = [base, ...uniq.map((id) => scs.find((s) => s.id === id)!)];
    const all = await this.db.getRepository(BudgetLine).find({ where: { budgetId: In(cols.map((c) => c.id)) } });
    const hr = this.budgets.canHr(actor);
    const keyOf = (l: BudgetLine) => (!hr && l.section === 'hr' && l.kind === 'employee' ? 'hr:employees' : l.baseLineId ?? l.id);

    const columns = cols.map((c) => {
      const ls = all.filter((l) => l.budgetId === c.id);
      const s = this.budgets.summary(c, ls, []);
      return {
        id: c.id, code: c.code, title: c.title, isScenario: c.isScenario, ...totals(ls), headcount: s.headcount,
        byMonth: Array.from({ length: 12 }, (_, i) => r2(s.byMonth.revenues[i] - s.byMonth.expenses[i])),
        byUnit: s.byUnit.map((u) => ({ unitId: u.unitId, unitName: u.unitName, total: u.total, ceiling: u.ceiling })), levers: c.levers ?? [],
      };
    });

    // البنود: لكل بند قيمته في كل عمود، مرتبة بأكبر فرق عن الأساسية
    const rows = new Map<string, { key: string; section: string; name: string; values: (number | null)[] }>();
    cols.forEach((c, ci) => {
      for (const l of all.filter((x) => x.budgetId === c.id)) {
        const k = keyOf(l);
        const r = rows.get(k) ?? { key: k, section: l.section, name: k === 'hr:employees' ? 'تكلفة الموظفين الحاليين (مجمعة)' : l.name, values: cols.map(() => null as number | null) };
        r.values[ci] = r2((r.values[ci] ?? 0) + (l.included ? l.amount : 0));
        rows.set(k, r);
      }
    });
    const lineRows = [...rows.values()]
      .map((r) => ({ ...r, maxDiff: r2(Math.max(0, ...r.values.slice(1).map((v) => Math.abs((v ?? 0) - (r.values[0] ?? 0))))) }))
      .filter((r) => r.maxDiff > 0.5)
      .sort((a, b) => b.maxDiff - a.maxDiff)
      .slice(0, 80)
      .map((r) => ({ ...r, sectionName: SECTION_NAME[r.section as Section] }));

    // الافتراضات المختلفة بين الأعمدة
    const vk = new Map<string, { key: string; name: string; values: (number | null)[] }>();
    cols.forEach((c, ci) => {
      for (const v of c.variables) {
        const k = `${v.key}|${v.unitId ?? ''}`;
        const r = vk.get(k) ?? { key: v.key, name: `${v.name}${v.unitName ? ` (${v.unitName})` : ''}`, values: cols.map(() => null as number | null) };
        r.values[ci] = v.value;
        vk.set(k, r);
      }
    });
    const variables = [...vk.values()].filter((r) => new Set(r.values.map((v) => JSON.stringify(v))).size > 1);
    const rules = cols.map((c) => c.raiseRules.map((r) => `${r.name}: ${r.pct}%`));
    return { columns, lines: lineRows, variables, raiseRules: rules };
  }

  /**
   * تحليل الحساسية: يُغيَّر كل متغير عام بنسبة (±10% افتراضيًا) ويُعاد احتساب البنود في الذاكرة دون حفظ،
   * ويُضاف أثر تغيّر كل قسم بنفس النسبة، ثم تُرتب المتغيرات بحجم أثرها على العجز أو الفائض.
   */
  async sensitivity(actor: OrgUser, id: string, stepPct = 10) {
    const org = actor.organizationId;
    const step = Math.min(50, Math.max(1, Math.round(stepPct))) / 100;
    const b = await this.budgets.budget(this.db.manager, org, id);
    const lines = await this.db.getRepository(BudgetLine).find({ where: { budgetId: id } });
    if (!lines.length) throw new BadRequestException('لا توجد بنود في الموازنة');
    const ctx = await this.budgets.ctx(org);
    const t0 = totals(lines);
    const run = (variables: Budget['variables']) => {
      const bb = Object.assign(Object.create(Object.getPrototypeOf(b)), b, { variables }) as Budget;
      const ls = clone(lines) as BudgetLine[];
      for (const l of ls) this.budgets.compute(bb, l, ctx);
      return totals(ls);
    };
    const pick = (t: Totals) => ({ expenses: t.expenses, revenues: t.revenues, balance: t.balance });
    const drivers: { key: string; name: string; kind: 'variable' | 'section'; value: number | null; low: ReturnType<typeof pick>; high: ReturnType<typeof pick>; impact: number }[] = [];
    for (const v of b.variables.filter((x) => !x.unitId && x.value !== 0)) {
      const vary = (f: number) => b.variables.map((x) => (x.key === v.key ? { ...x, value: x.value * f, steps: (x.steps ?? []).map((s) => ({ ...s, value: s.value * f })) } : x));
      const low = pick(run(vary(1 - step))), high = pick(run(vary(1 + step)));
      const impact = r2(Math.abs(high.balance - low.balance));
      if (impact > 0.5) drivers.push({ key: v.key, name: v.name, kind: 'variable', value: v.value, low, high, impact });
    }
    for (const s of SECTIONS) {
      const amt = t0.sections[s];
      if (!amt) continue;
      const sign = s === 'revenue' ? 1 : -1;
      const at = (f: number) => {
        const d = r2(amt * f);
        return s === 'revenue'
          ? { expenses: t0.expenses, revenues: r2(t0.revenues + d), balance: r2(t0.balance + d) }
          : { expenses: r2(t0.expenses + d), revenues: t0.revenues, balance: r2(t0.balance + sign * d) };
      };
      const low = at(-step), high = at(step);
      drivers.push({ key: `section:${s}`, name: `إجمالي ${SECTION_NAME[s]}`, kind: 'section', value: amt, low, high, impact: r2(Math.abs(high.balance - low.balance)) });
    }
    drivers.sort((a, c) => c.impact - a.impact);
    return { step: step * 100, baseline: pick(t0), drivers };
  }

  /**
   * تحويل السيناريو إلى مشروع موازنة: تُنقل افتراضاته وبنوده ومؤثراته إلى الموازنة الأساسية،
   * فتصبح مسودة (أو مسودة تعديل على المعتمدة) تُرفع للاعتماد بمسارها. الإصدار المعتمد يبقى كما هو حتى يُعتمد الجديد.
   */
  async promote(actor: OrgUser, id: string, dto: PromoteDto) {
    const org = actor.organizationId;
    const baseId = await this.db.transaction(async (em) => {
      const s = await this.scenario(em, org, id, true);
      const base = await this.base(em, org, s.baseBudgetId!, true);
      this.budgets.editable(base, actor);
      const lr = em.getRepository(BudgetLine);
      const [sl, bl] = await Promise.all([lr.find({ where: { budgetId: s.id } }), lr.find({ where: { budgetId: base.id } })]);
      const baseIds = new Set(bl.map((l) => l.id));
      const kept = new Set(sl.map((l) => l.baseLineId).filter((x): x is string => !!x && baseIds.has(x)));
      const drop = bl.filter((l) => !kept.has(l.id)).map((l) => l.id);
      if (drop.length) {
        const [{ c }] = await em.query(`SELECT COUNT(*)::int AS c FROM plan_budget_commitments WHERE line_id = ANY($1) AND status <> 'released'`, [drop]);
        if (c) throw new ConflictException('بنود حُذفت في السيناريو عليها حجوزات من أنظمة أخرى في الموازنة الأساسية، فلا يمكن التحويل');
        await em.query('DELETE FROM plan_budget_lines WHERE id = ANY($1)', [drop]);
      }
      // البنود المقابلة تُحدّث في مكانها (فتبقى حجوزاتها)، والجديدة تُضاف
      const idMap = new Map<string, string>();
      for (const l of sl) {
        const data = { ...this.budgets.pickLine(l), organizationId: org, budgetId: base.id, baseLineId: null };
        if (l.baseLineId && kept.has(l.baseLineId)) {
          await lr.save(lr.create({ ...data, id: l.baseLineId }));
          idMap.set(l.id, l.baseLineId);
        } else {
          const saved = await lr.save(lr.create({ ...data, id: undefined }));
          idMap.set(l.id, saved.id);
        }
      }
      Object.assign(base, {
        methodology: s.methodology, historyYears: s.historyYears, variables: clone(s.variables), raiseRules: clone(s.raiseRules), hrSetup: clone(s.hrSetup), ceilings: clone(s.ceilings),
        levers: clone(s.levers ?? []).map((lv) => ({ ...lv, scope: { ...lv.scope, lineIds: lv.scope.lineIds.map((x) => idMap.get(x) ?? x) } })),
      });
      const note = `تطبيق السيناريو ${s.code} «${s.title}»: ${dto.note}`;
      if (base.version > 0) base.revisionNote = note.slice(0, 1000);
      base.approvals = [...base.approvals, { action: 'reopen', stage: null, byName: actor.fullName, at: new Date().toISOString(), note: note.slice(0, 1000) }];
      await em.getRepository(Budget).save(base);
      await this.budgets.recalcAll(em, base);
      s.promotedAt = new Date();
      s.promotedByName = actor.fullName;
      await em.getRepository(Budget).save(s);
      return base.id;
    });
    return this.budgets.get(actor, baseId);
  }
}
