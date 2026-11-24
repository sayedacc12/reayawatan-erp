import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { DataSource, EntityManager, In } from 'typeorm';
import { OrgUser } from '../../../core/auth/decorators';
import { HrPolicy } from '../../hr/hr-policy';
import { DecideDto } from '../planning.dto';
import { canDecide, markEdited, pickRoute, wfDecide, wfSubmit } from '../planning-calc';
import { PlanningCore } from '../planning-core.service';
import { PLANNING_PERMISSIONS as P } from '../planning.manifest';
import { ActivityParams, applyLevers, computeActivity, computeHist, computeHr, finalize, FormulaRef, HistParams, HistSnapshot, HrParams, r2 } from './budget-calc';
import { BUILTIN_VARS, BudgetVariable, Ceiling, DEFAULT_VARIABLES, Lever, METHODOLOGY_NAME, RaiseRule, Section, SECTION_NAME, SECTIONS } from './budget-defaults';
import { BudgetDto, ImportDto, LineDto, UpdateBudgetDto, UpdateLineDto } from './budget.dto';
import { Budget, BudgetLine, BudgetSnapshot, BudgetVersion, SnapLine } from './budget.entity';
import { BudgetSources } from './budget-sources.service';
import { FormulasService } from './formulas.service';
import { VAR_KEY } from './formula-engine';

export type Ctx = { policy: HrPolicy; formulas: Map<string, FormulaRef & { status: string }> };
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));
const n = (v: unknown, d = 0) => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? d : Number(v));
const month = (v: unknown, d: number) => Math.min(12, Math.max(1, Math.round(n(v, d))));
const nullableNum = (v: unknown) => (v === null || v === undefined || v === '' ? null : Number.isFinite(Number(v)) ? Number(v) : null);
const str = (v: unknown, max = 200) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null);
const HR_KINDS = ['employee', 'new_position'];

/** بند مستورد من Excel بعد فحصه (انظر BudgetImportService) */
export interface ExcelLine { section: Section; kind: 'new_position' | 'hr_other' | 'manual'; name: string; params: Record<string, unknown>; fundingType: string | null; note: string | null }
class LineDryRun extends Error {}
const KINDS: Record<Section, string[]> = { hr: ['employee', 'new_position', 'hr_other'], opex: ['account', 'manual'], activity: ['activity', 'project', 'manual'], revenue: ['account', 'manual'] };
// growth متغير في الافتراضات يمكن تخصيصه للبند أو للإدارة، فليس محجوزًا
const BUILTIN_KEYS = new Set(Object.values(BUILTIN_VARS).flat().map((v) => v.key).filter((k) => k !== 'growth'));
const LINE_KEYS: (keyof SnapLine)[] = [
  'id', 'section', 'kind', 'name', 'sourceId', 'sourceRef', 'baseLineId', 'unitId', 'unitName', 'accountId', 'accountCode', 'accountName', 'costCenterId', 'costCenterName', 'fundingType',
  'methodology', 'params', 'history', 'allocations', 'auto', 'overrideAmount', 'overrideNote', 'amount', 'monthly', 'trace', 'warnings', 'included', 'note', 'sortOrder',
];

/** في التاريخ سنة مكتملة يصلح نمطها الشهري للتوزيع الموسمي */
const hasFullYear = (h: HistSnapshot) => Object.keys(h.months ?? {}).some((y) => Number(y) !== h.currentYear || h.currentMonths >= 12);

export function histDefaults(formulaCode: string | null, years: number, method: HistParams['method'] = 'formula'): HistParams {
  return {
    method, formulaCode, years, avgType: 'mean', annualizeCurrent: true, growth: null, volumeBase: null, volumeTarget: null,
    excludedEntryIds: [], adjustments: [], contracts: [], distribution: method === 'formula' ? 'seasonal' : 'even', weights: [], manualAmount: null, vars: {},
  };
}

/**
 * الموازنات التقديرية: الإعداد والاستيراد من الأنظمة الأخرى والاحتساب بالمعادلات والتجميع والاعتماد والإصدارات.
 * النتائج تُحفظ في البنود وقت الاحتساب، ولا تُعاد إلا في موازنة قابلة للتعديل.
 */
@Injectable()
export class BudgetsService {
  constructor(private readonly db: DataSource, private readonly core: PlanningCore, private readonly sources: BudgetSources, private readonly formulas: FormulasService) {}

  // ---------------- مساعدات ----------------

  canHr(actor: OrgUser) { return actor.isSuperadmin || actor.permissions.includes(P.budgetsHr); }

  private assertHr(actor: OrgUser) {
    if (!this.canHr(actor)) throw new ForbiddenException('بيانات رواتب الموظفين في الموازنة ليست من صلاحيتك');
  }

  async budget(em: EntityManager, org: string, id: string, lock = false) {
    const b = await em.getRepository(Budget).findOne({ where: { id, organizationId: org }, ...(lock ? { lock: { mode: 'pessimistic_write' as const } } : {}) });
    if (!b) throw new NotFoundException('الموازنة غير موجودة');
    return b;
  }

  /** الموازنة قيد الاعتماد أو المرفوضة لا تُعدّل؛ والمعتمدة تتحول لمسودة تعديل ويبقى إصدارها المعتمد كما هو */
  editable(b: Budget, actor: OrgUser) {
    if (b.status === 'in_review') throw new ConflictException('الموازنة قيد الاعتماد، ولا تُعدّل حتى تُعاد أو تُعتمد');
    if (b.status === 'rejected') throw new ConflictException('الموازنة مرفوضة ولا تُعدّل. يمكنك نسخها في موازنة جديدة');
    markEdited(b, actor.fullName);
  }

  async ctx(org: string, em: EntityManager = this.db.manager): Promise<Ctx> {
    const [policy, formulas] = await Promise.all([this.sources.hrPolicy(org), this.formulas.refs(org, em)]);
    return { policy, formulas };
  }

  /** احتساب بند واحد وحفظ نتيجته وخطواته فيه (بدون حفظ في القاعدة) */
  compute(b: Budget, line: BudgetLine, ctx: Ctx) {
    let r: { auto: number; monthly: number[]; trace: BudgetLine['trace']; warnings: string[] };
    if (line.section === 'hr' && HR_KINDS.includes(line.kind)) {
      const mc = b.hrSetup?.monthlyFormula || 'HR_MONTHLY';
      const m = ctx.formulas.get(mc);
      if (!m) throw new BadRequestException(`معادلة التكلفة الشهرية ${mc} غير موجودة`);
      const ac = b.hrSetup?.annualFormula ?? 'HR_ANNUAL';
      const a = ac ? ctx.formulas.get(ac) ?? null : null;
      if (ac && !a) throw new BadRequestException(`معادلة التكاليف السنوية ${ac} غير موجودة`);
      r = computeHr(b.fiscalYear, b, line, ctx.policy, m, a);
    } else if (line.kind === 'activity' || line.kind === 'project') {
      r = computeActivity(b.fiscalYear, line);
    } else {
      const p = line.params as unknown as HistParams;
      const f = p.method === 'formula' ? ctx.formulas.get(p.formulaCode ?? '') ?? null : null;
      if (p.method === 'formula' && !f) throw new BadRequestException(`المعادلة ${p.formulaCode ?? ''} غير موجودة (البند: ${line.name})`);
      r = computeHist(b.fiscalYear, b, line, f);
    }
    const fin = finalize(r.auto, r.monthly, line.overrideAmount);
    const trace = [...r.trace];
    if (line.overrideAmount !== null && line.overrideAmount !== undefined) {
      trace.push({ label: `المبلغ المقترح من الإدارة (الفرق عن الآلي ${r2(line.overrideAmount - r.auto).toLocaleString('en-US')})${line.overrideNote ? `: ${line.overrideNote}` : ''}`, value: line.overrideAmount, source: 'تعديل يدوي بمبرر' });
    }
    const lv = b.levers?.length ? applyLevers(b.levers, line, fin.monthly) : null;
    if (lv?.trace.length) {
      trace.push(...lv.trace);
      Object.assign(line, { auto: r.auto, amount: lv.amount, monthly: lv.monthly, trace, warnings: r.warnings });
    } else Object.assign(line, { auto: r.auto, amount: fin.amount, monthly: fin.monthly, trace, warnings: r.warnings });
    return line;
  }

  async recalcAll(em: EntityManager, b: Budget, ctx?: Ctx) {
    const c = ctx ?? (await this.ctx(b.organizationId, em));
    const lines = await em.getRepository(BudgetLine).find({ where: { budgetId: b.id } });
    for (const l of lines) this.compute(b, l, c);
    await em.getRepository(BudgetLine).save(lines, { chunk: 200 });
    b.calculatedAt = new Date();
    await em.getRepository(Budget).save(b);
    return lines;
  }

  // ---------------- القوائم ----------------

  async list(actor: OrgUser, q: { year?: string }) {
    const org = actor.organizationId;
    const where: Record<string, unknown> = { organizationId: org, isScenario: false };
    if (q.year && /^\d{4}$/.test(q.year)) where.fiscalYear = Number(q.year);
    const budgets = await this.db.getRepository(Budget).find({ where, order: { fiscalYear: 'DESC', code: 'DESC' } });
    const totals: { budgetId: string; section: Section; amount: number; lines: number }[] = budgets.length ? await this.db.query(
      `SELECT budget_id AS "budgetId", section, SUM(CASE WHEN included THEN amount ELSE 0 END)::float AS amount, COUNT(*)::int AS lines
         FROM plan_budget_lines WHERE budget_id = ANY($1) GROUP BY 1, 2`, [budgets.map((b) => b.id)]) : [];
    const d = await this.core.decider(actor, P.budgetsApprove);
    return budgets.map((b) => {
      const t = Object.fromEntries(SECTIONS.map((s) => [s, totals.find((x) => x.budgetId === b.id && x.section === s)?.amount ?? 0])) as Record<Section, number>;
      const expenses = r2(t.hr + t.opex + t.activity);
      return {
        id: b.id, code: b.code, title: b.title, fiscalYear: b.fiscalYear, methodology: b.methodology, methodologyName: METHODOLOGY_NAME[b.methodology], status: b.status, version: b.version,
        stageName: b.status === 'in_review' && b.stageIndex !== null ? b.wfStages[b.stageIndex]?.name ?? null : null, canDecide: canDecide(b, d),
        sections: t, expenses, revenues: r2(t.revenue), balance: r2(t.revenue - expenses), lines: totals.filter((x) => x.budgetId === b.id).reduce((s, x) => s + x.lines, 0),
        calculatedAt: b.calculatedAt, createdByName: b.createdByName, updatedAt: b.updatedAt,
      };
    });
  }

  async lookups(actor: OrgUser) {
    const org = actor.organizationId;
    const safe = <T>(p: Promise<T[]>) => p.catch(() => [] as T[]);
    const [base, accounts, payroll, formulas, grades, jobs, ratings] = await Promise.all([
      this.core.lookups(actor),
      this.sources.accounts(org),
      this.sources.payrollAccounts(org),
      this.formulas.refs(org),
      safe(this.db.query('SELECT DISTINCT name FROM hr_grades WHERE organization_id = $1 ORDER BY name', [org])),
      safe(this.db.query('SELECT DISTINCT title FROM hr_jobs WHERE organization_id = $1 ORDER BY title', [org])),
      safe(this.db.query(`SELECT DISTINCT rating FROM hr_performance_cards WHERE organization_id = $1 AND rating IS NOT NULL ORDER BY rating`, [org])),
    ]);
    return {
      units: base.units, costCenters: base.costCenters,
      accounts: accounts.map((a) => ({ ...a, payroll: payroll.has(a.id) })),
      formulas: [...formulas.values()].filter((f) => f.status === 'active'),
      grades: (grades as { name: string }[]).map((g) => g.name), jobs: (jobs as { title: string }[]).map((j) => j.title), ratings: (ratings as { rating: string }[]).map((r) => r.rating),
      methodologies: Object.entries(METHODOLOGY_NAME).map(([key, name]) => ({ key, name })),
      sections: SECTIONS.map((key) => ({ key, name: SECTION_NAME[key] })),
      builtins: BUILTIN_VARS, defaultVariables: DEFAULT_VARIABLES, canHr: this.canHr(actor),
    };
  }

  // ---------------- الموازنة ----------------

  async create(actor: OrgUser, dto: BudgetDto) {
    const org = actor.organizationId;
    const id = await this.db.transaction(async (em) => {
      const src = dto.copyFromId ? await this.budget(em, org, dto.copyFromId) : null;
      const code = await this.core.nextCode(em, org, 'BG');
      const b = await em.getRepository(Budget).save(em.getRepository(Budget).create({
        organizationId: org, code, title: dto.title, fiscalYear: dto.fiscalYear, description: dto.description ?? null,
        methodology: dto.methodology ?? src?.methodology ?? 'mixed', historyYears: dto.historyYears ?? src?.historyYears ?? 3,
        variables: src ? clone(src.variables) : clone(DEFAULT_VARIABLES), raiseRules: src ? clone(src.raiseRules) : [],
        hrSetup: src ? clone(src.hrSetup) : { monthlyFormula: 'HR_MONTHLY', annualFormula: 'HR_ANNUAL' }, ceilings: src ? clone(src.ceilings) : [],
        status: 'draft', version: 0, createdByName: actor.fullName,
      }));
      if (src) {
        // تُنسخ بنود المصروفات والإيرادات بطريقة تقديرها، ويُعاد جلب تاريخها للسنة الجديدة
        const lines = await em.getRepository(BudgetLine).find({ where: { budgetId: src.id, section: In(['opex', 'revenue']) }, order: { sortOrder: 'ASC' } });
        for (const l of lines) {
          const params = clone(l.params) as unknown as HistParams;
          params.excludedEntryIds = [];
          params.adjustments = [];
          params.contracts = (params.contracts ?? []).filter((c) => c.kind === 'new').map((c) => ({ ...c, fromMonth: 1, toMonth: 12 }));
          const history = l.kind === 'account' && l.accountId
            ? await this.sources.snapshot(org, l.accountId, l.costCenterId, b.fiscalYear, params.years || b.historyYears) : {};
          await em.getRepository(BudgetLine).save(em.getRepository(BudgetLine).create({
            ...this.pickLine(l), id: undefined, organizationId: org, budgetId: b.id, params: params as unknown as Record<string, unknown>, history: history as unknown as Record<string, unknown>,
            overrideAmount: null, overrideNote: null,
          }));
        }
        await this.recalcAll(em, b);
      }
      return b.id;
    });
    return this.get(actor, id);
  }

  pickLine(l: BudgetLine): SnapLine {
    return clone(Object.fromEntries(LINE_KEYS.map((k) => [k, l[k]])) as SnapLine);
  }

  async get(actor: OrgUser, id: string) {
    const org = actor.organizationId;
    const b = await this.budget(this.db.manager, org, id);
    const [lines, versions, capital, ctx, d] = await Promise.all([
      this.db.getRepository(BudgetLine).find({ where: { budgetId: id }, order: { section: 'ASC', sortOrder: 'ASC', name: 'ASC' } }),
      this.db.getRepository(BudgetVersion).find({ where: { organizationId: org, budgetId: id }, order: { version: 'DESC' }, select: ['id', 'version', 'note', 'approvedByName', 'approvedAt', 'expenses', 'revenues'] }),
      this.sources.capital(org, b.fiscalYear),
      this.ctx(org),
      this.core.decider(actor, P.budgetsApprove),
    ]);
    const checks = await this.checks(org, b, lines, ctx);
    const summary = this.summary(b, lines, capital);
    const hr = this.canHr(actor);
    const base = b.isScenario && b.baseBudgetId
      ? await this.db.getRepository(Budget).findOne({ where: { id: b.baseBudgetId, organizationId: org }, select: ['id', 'code', 'title', 'status', 'version'] }) : null;
    const scenarios = b.isScenario ? 0 : await this.db.getRepository(Budget).count({ where: { organizationId: org, baseBudgetId: b.id, isScenario: true } });
    return {
      ...b, base, scenarios, methodologyName: METHODOLOGY_NAME[b.methodology], canDecide: canDecide(b, d), canHr: hr,
      stageName: b.status === 'in_review' && b.stageIndex !== null ? b.wfStages[b.stageIndex]?.name ?? null : null,
      lines: hr ? lines : this.maskHr(lines), summary, checks, versions, capital,
    };
  }

  /** من لا يملك صلاحية رواتب الموازنة يرى تكلفة الموظفين الحاليين مجمعة لكل إدارة */
  maskHr(lines: BudgetLine[]) {
    const out: (BudgetLine | Record<string, unknown>)[] = lines.filter((l) => !(l.section === 'hr' && l.kind === 'employee'));
    const groups = new Map<string, BudgetLine[]>();
    for (const l of lines.filter((x) => x.section === 'hr' && x.kind === 'employee')) {
      const k = l.unitId ?? 'none';
      groups.set(k, [...(groups.get(k) ?? []), l]);
    }
    for (const [k, ls] of groups) {
      const inc = ls.filter((l) => l.included);
      out.push({
        id: `unit:${k}`, section: 'hr', kind: 'employee_group', masked: true, name: `الموظفون الحاليون: ${ls[0].unitName ?? 'بلا إدارة'} (${ls.length})`,
        unitId: ls[0].unitId, unitName: ls[0].unitName, costCenterName: ls[0].costCenterName, fundingType: null, included: true, params: { count: ls.length },
        auto: r2(inc.reduce((s, l) => s + l.auto, 0)), amount: r2(inc.reduce((s, l) => s + l.amount, 0)),
        monthly: Array.from({ length: 12 }, (_, i) => r2(inc.reduce((s, l) => s + (l.monthly[i] ?? 0), 0))), trace: [], warnings: [], allocations: [], history: {},
      });
    }
    return out;
  }

  summary(b: Budget, lines: BudgetLine[], capital: { amount: number }[]) {
    const inc = lines.filter((l) => l.included);
    const sections = Object.fromEntries(SECTIONS.map((s) => [s, r2(inc.filter((l) => l.section === s).reduce((t, l) => t + l.amount, 0))])) as Record<Section, number>;
    const expenses = r2(sections.hr + sections.opex + sections.activity);
    const sum12 = (ls: BudgetLine[]) => Array.from({ length: 12 }, (_, i) => r2(ls.reduce((s, l) => s + (l.monthly[i] ?? 0), 0)));
    const exp = inc.filter((l) => l.section !== 'revenue');
    const units = new Map<string, { unitId: string | null; unitName: string; hr: number; opex: number; activity: number; total: number; ceiling: number | null }>();
    for (const l of exp) {
      const k = l.unitId ?? 'none';
      const u = units.get(k) ?? { unitId: l.unitId, unitName: l.unitName ?? 'على مستوى الشركة', hr: 0, opex: 0, activity: 0, total: 0, ceiling: null };
      u[l.section as 'hr' | 'opex' | 'activity'] = r2(u[l.section as 'hr' | 'opex' | 'activity'] + l.amount);
      u.total = r2(u.total + l.amount);
      units.set(k, u);
    }
    for (const c of b.ceilings) {
      const u = units.get(c.unitId) ?? { unitId: c.unitId, unitName: c.unitName, hr: 0, opex: 0, activity: 0, total: 0, ceiling: null };
      u.ceiling = c.amount;
      units.set(c.unitId, u);
    }
    const funding: Record<string, number> = { restricted: 0, unrestricted: 0, mixed: 0, none: 0 };
    for (const l of exp) funding[l.fundingType ?? 'none'] = r2((funding[l.fundingType ?? 'none'] ?? 0) + l.amount);
    const methods: Record<string, number> = {};
    for (const l of exp) methods[l.methodology] = r2((methods[l.methodology] ?? 0) + l.amount);
    const heads = inc.filter((l) => l.section === 'hr' && HR_KINDS.includes(l.kind));
    const capitalTotal = r2(capital.reduce((s, c) => s + c.amount, 0));
    return {
      sections, expenses, revenues: sections.revenue, balance: r2(sections.revenue - expenses), capital: capitalTotal,
      totalWithCapital: r2(expenses + capitalTotal),
      byMonth: { expenses: sum12(exp), revenues: sum12(inc.filter((l) => l.section === 'revenue')) },
      byUnit: [...units.values()].map((u) => ({ ...u, over: u.ceiling !== null ? r2(u.total - u.ceiling) : null })).sort((a, b2) => b2.total - a.total),
      byFunding: funding,
      byMethodology: Object.entries(methods).map(([key, amount]) => ({ key, name: METHODOLOGY_NAME[key as keyof typeof METHODOLOGY_NAME] ?? key, amount })),
      headcount: {
        current: heads.filter((l) => l.kind === 'employee').reduce((s, l) => s + n((l.params as { count?: number }).count, 1), 0),
        new: heads.filter((l) => l.kind === 'new_position').reduce((s, l) => s + n((l.params as { count?: number }).count, 1), 0),
      },
      overrides: inc.filter((l) => l.overrideAmount !== null).length,
      lines: lines.length,
    };
  }

  /** فحوص السلامة: الازدواج، البيانات القديمة، تجاوز السقوف، العجز، والمعادلات المعدّلة بعد الاحتساب */
  async checks(org: string, b: Budget, lines: BudgetLine[], ctx: Ctx) {
    const out: { level: 'danger' | 'warning' | 'info'; key: string; text: string; lineIds?: string[] }[] = [];
    const inc = lines.filter((l) => l.included);
    const hasHr = inc.some((l) => l.section === 'hr');
    const payroll = await this.sources.payrollAccounts(org);
    const dbl = inc.filter((l) => l.section === 'opex' && l.accountId && payroll.has(l.accountId));
    if (hasHr && dbl.length) out.push({ level: 'danger', key: 'double_payroll', text: `${dbl.length} بند مصروف على حسابات الرواتب، وتكلفتها محسوبة في قسم الموارد البشرية (ازدواج)`, lineIds: dbl.map((l) => l.id) });
    const stale = lines.filter((l) => l.trace.some((t) => t.formulaCode && ctx.formulas.get(t.formulaCode) && ctx.formulas.get(t.formulaCode)!.version !== t.formulaVersion));
    if (stale.length) out.push({ level: 'warning', key: 'stale_formula', text: `${stale.length} بند محتسب بإصدار سابق من معادلته. أعد الاحتساب لتطبيق الإصدار الحالي`, lineIds: stale.map((l) => l.id) });
    const warn = inc.filter((l) => l.warnings.length);
    if (warn.length) out.push({ level: 'info', key: 'line_warnings', text: `${warn.length} بند عليه ملاحظات احتساب`, lineIds: warn.map((l) => l.id) });
    const s = this.summary(b, lines, []);
    for (const u of s.byUnit) if (u.over !== null && u.over > 0) out.push({ level: 'warning', key: 'ceiling', text: `طلبات ${u.unitName} تتجاوز سقفها بمبلغ ${u.over.toLocaleString('en-US')}` });
    if (s.revenues > 0 && s.balance < 0) out.push({ level: 'warning', key: 'deficit', text: `المصروفات تتجاوز الإيرادات المتوقعة بمبلغ ${Math.abs(s.balance).toLocaleString('en-US')}` });
    const noOwner = inc.filter((l) => l.section !== 'revenue' && !l.unitId && l.section !== 'opex');
    if (noOwner.length) out.push({ level: 'info', key: 'no_unit', text: `${noOwner.length} بند بلا إدارة محددة`, lineIds: noOwner.map((l) => l.id) });
    if (b.status !== 'approved' && b.status !== 'in_review') {
      // تغيّر المصدر بعد الاستيراد
      const acts = lines.filter((l) => l.kind === 'activity' && l.sourceId);
      if (acts.length) {
        const cur = new Map((await this.sources.activities(org, b.fiscalYear)).map((a) => [a.id, a.cost]));
        const changed = acts.filter((l) => cur.get(l.sourceId!) !== undefined && r2(cur.get(l.sourceId!)!) !== r2(n((l.params as unknown as ActivityParams).cost)));
        const gone = acts.filter((l) => !cur.has(l.sourceId!));
        if (changed.length) out.push({ level: 'warning', key: 'activity_changed', text: `${changed.length} نشاط تغيرت تكلفته في الخطة التشغيلية بعد استيراده. أعد الاستيراد لتحديثه`, lineIds: changed.map((l) => l.id) });
        if (gone.length) out.push({ level: 'warning', key: 'activity_gone', text: `${gone.length} نشاط لم يعد في الخطط التشغيلية المعتمدة للسنة`, lineIds: gone.map((l) => l.id) });
        const projects = inc.filter((l) => l.kind === 'project' && l.sourceId);
        if (projects.length) {
          const refs: { refId: string }[] = await this.db.query(
            `SELECT DISTINCT ref_id AS "refId" FROM plan_refs WHERE organization_id = $1 AND system = 'projects' AND item_id = ANY($2)`, [org, acts.filter((l) => l.included).map((l) => l.sourceId)]);
          const linked = new Set(refs.map((r) => r.refId));
          const dup = projects.filter((l) => linked.has(l.sourceId!));
          if (dup.length) out.push({ level: 'danger', key: 'double_project', text: `${dup.length} مشروع مرتبط بنشاط مستورد من الخطة التشغيلية (ازدواج محتمل)`, lineIds: dup.map((l) => l.id) });
        }
      }
      if (this.canHrLines(lines)) {
        const emps = await this.sources.employees(org);
        const have = new Set(lines.filter((l) => l.kind === 'employee').map((l) => l.sourceId));
        const missing = emps.filter((e) => !have.has(e.id)).length;
        if (missing) out.push({ level: 'info', key: 'new_employees', text: `${missing} موظف على رأس العمل غير موجود في الموازنة. استورد الموظفين لإضافتهم` });
      }
    }
    return out;
  }

  private canHrLines(lines: BudgetLine[]) { return lines.some((l) => l.kind === 'employee'); }

  async update(actor: OrgUser, id: string, dto: UpdateBudgetDto) {
    const org = actor.organizationId;
    await this.db.transaction(async (em) => {
      const b = await this.budget(em, org, id, true);
      this.editable(b, actor);
      let recalc = false;
      if (dto.title !== undefined) b.title = dto.title;
      if (dto.description !== undefined) b.description = dto.description;
      if (dto.methodology !== undefined) b.methodology = dto.methodology;
      if (dto.historyYears !== undefined) b.historyYears = dto.historyYears;
      if (dto.variables !== undefined) { b.variables = await this.cleanVariables(org, dto.variables, em); recalc = true; }
      if (dto.raiseRules !== undefined) { b.raiseRules = await this.cleanRules(org, dto.raiseRules, em); recalc = true; }
      if (dto.ceilings !== undefined) b.ceilings = await this.cleanCeilings(org, dto.ceilings, em);
      if (dto.levers !== undefined) { b.levers = await this.cleanLevers(org, dto.levers, em, b.id); recalc = true; }
      if (dto.hrSetup !== undefined) {
        const refs = await this.formulas.refs(org, em);
        const m = str(dto.hrSetup.monthlyFormula, 40) ?? 'HR_MONTHLY';
        const a = str(dto.hrSetup.annualFormula, 40) ?? '';
        if (refs.get(m)?.status !== 'active') throw new BadRequestException('معادلة التكلفة الشهرية غير موجودة أو موقوفة');
        if (a && refs.get(a)?.status !== 'active') throw new BadRequestException('معادلة التكاليف السنوية غير موجودة أو موقوفة');
        b.hrSetup = { monthlyFormula: m, annualFormula: a };
        recalc = true;
      }
      await em.getRepository(Budget).save(b);
      if (recalc) await this.recalcAll(em, b);
    });
    return this.get(actor, id);
  }

  async cleanVariables(org: string, input: unknown[], em: EntityManager): Promise<BudgetVariable[]> {
    const vs = input.map((x) => {
      const v = (x ?? {}) as Record<string, unknown>;
      const key = String(v.key ?? '').trim();
      if (!VAR_KEY.test(key)) throw new BadRequestException(`رمز المتغير «${key || String(v.name ?? '')}» بحروف إنجليزية صغيرة وأرقام وشرطة سفلية`);
      if (BUILTIN_KEYS.has(key)) throw new BadRequestException(`الرمز ${key} محجوز للنظام`);
      const name = str(v.name, 150);
      if (!name) throw new BadRequestException(`اكتب اسم المتغير ${key}`);
      const value = Number(v.value);
      if (!Number.isFinite(value)) throw new BadRequestException(`قيمة المتغير «${name}» يجب أن تكون رقمًا`);
      const steps = (Array.isArray(v.steps) ? v.steps : []).map((s: Record<string, unknown>) => {
        const sv = Number(s.value);
        if (!Number.isFinite(sv)) throw new BadRequestException(`قيمة مرحلية غير صحيحة في «${name}»`);
        return { fromMonth: month(s.fromMonth, 1), value: sv };
      });
      return { key, name, value, unit: str(v.unit, 20), steps, unitId: str(v.unitId, 40), note: str(v.note, 300) } as BudgetVariable;
    });
    const seen = new Set<string>();
    for (const v of vs) {
      const k = `${v.key}|${v.unitId ?? ''}`;
      if (seen.has(k)) throw new BadRequestException(`المتغير ${v.key} مكرر${v.unitId ? ' لنفس الإدارة' : ''}`);
      seen.add(k);
      if (v.unitId && !vs.some((g) => g.key === v.key && !g.unitId)) throw new BadRequestException(`المتغير ${v.key} الخاص بإدارة يحتاج متغيرًا عامًا بنفس الرمز`);
    }
    const names = await this.core.unitNames(org, vs.map((v) => v.unitId).filter((x): x is string => !!x), em);
    return vs.map((v) => ({ ...v, unitName: v.unitId ? names.get(v.unitId) ?? null : null }));
  }

  async cleanRules(org: string, input: unknown[], em: EntityManager): Promise<RaiseRule[]> {
    const rules = input.map((x, i) => {
      const r = (x ?? {}) as Record<string, unknown>;
      const m = (r.match ?? {}) as Record<string, unknown>;
      const name = str(r.name, 150);
      if (!name) throw new BadRequestException('اكتب اسم كل قاعدة علاوة');
      const pct = Number(r.pct);
      if (!Number.isFinite(pct) || pct < -50 || pct > 100) throw new BadRequestException(`نسبة العلاوة في «${name}» بين -50 و100`);
      const nat = m.nationality === 'saudi' || m.nationality === 'non_saudi' ? m.nationality : null;
      return {
        key: str(r.key, 40) ?? `r${i + 1}`, name, pct, fromMonth: month(r.fromMonth, 1), appliesToNew: !!r.appliesToNew,
        match: { unitId: str(m.unitId, 40), gradeName: str(m.gradeName, 100), jobTitle: str(m.jobTitle, 200), rating: str(m.rating, 40), nationality: nat },
      } as RaiseRule;
    });
    await this.core.unitNames(org, rules.map((r) => r.match.unitId).filter((x): x is string => !!x), em);
    return rules;
  }

  /** تنظيف مؤثرات السيناريو: نوع وقيمة ونطاق صحيح، والبنود المحددة من نفس الموازنة */
  async cleanLevers(org: string, input: unknown[], em: EntityManager, budgetId: string | null): Promise<Lever[]> {
    if (input.length > 30) throw new BadRequestException('الحد الأقصى 30 مؤثرًا للسيناريو');
    const levers = input.map((x, i) => {
      const l = (x ?? {}) as Record<string, unknown>;
      const sc = (l.scope ?? {}) as Record<string, unknown>;
      const name = str(l.name, 150);
      if (!name) throw new BadRequestException('اكتب اسم كل مؤثر');
      const type = l.type === 'shift' ? 'shift' as const : 'pct' as const;
      const value = Number(l.value);
      if (!Number.isFinite(value)) throw new BadRequestException(`قيمة المؤثر «${name}» يجب أن تكون رقمًا`);
      if (type === 'pct' && (value < -100 || value > 500)) throw new BadRequestException(`نسبة المؤثر «${name}» بين -100% و500%`);
      if (type === 'shift' && (value < 1 || value > 11)) throw new BadRequestException(`التأجيل في «${name}» من شهر إلى 11 شهرًا`);
      const sections = (Array.isArray(sc.sections) ? sc.sections : []).filter((v): v is Section => SECTIONS.includes(v as Section));
      const ft = ['restricted', 'unrestricted', 'mixed', 'none'].includes(String(sc.fundingType)) ? String(sc.fundingType) : null;
      return {
        key: str(l.key, 40) ?? `lv${i + 1}`, name, type, value: r2(value), fromMonth: month(l.fromMonth, 1),
        scope: { sections, unitId: str(sc.unitId, 40), fundingType: ft, accountId: str(sc.accountId, 40), lineIds: (Array.isArray(sc.lineIds) ? sc.lineIds : []).map(String).slice(0, 200) },
        note: str(l.note, 500),
      } as Lever;
    });
    const ids = [...new Set(levers.flatMap((l) => l.scope.lineIds))];
    if (ids.length && budgetId) {
      // في السيناريو يُقبل رقم البند فيه أو رقم البند المقابل في الموازنة الأساسية
      const ok: { id: string; base: string | null }[] = await em.query(
        'SELECT id, base_line_id AS base FROM plan_budget_lines WHERE budget_id = $1 AND (id = ANY($2) OR base_line_id = ANY($2))', [budgetId, ids]);
      const known = new Set(ok.flatMap((r) => [r.id, r.base]));
      if (ids.some((x) => !known.has(x))) throw new BadRequestException('بعض البنود المحددة في المؤثرات ليست من هذه الموازنة');
    }
    const names = await this.core.unitNames(org, levers.map((l) => l.scope.unitId).filter((x): x is string => !!x), em);
    return levers.map((l) => ({ ...l, scope: { ...l.scope, unitName: l.scope.unitId ? names.get(l.scope.unitId) ?? null : null } }));
  }

  private async cleanCeilings(org: string, input: unknown[], em: EntityManager): Promise<Ceiling[]> {
    const cs = input.map((x) => {
      const c = (x ?? {}) as Record<string, unknown>;
      const amount = Number(c.amount);
      if (!str(c.unitId, 40)) throw new BadRequestException('اختر الإدارة لكل سقف');
      if (!Number.isFinite(amount) || amount < 0) throw new BadRequestException('مبلغ السقف غير صحيح');
      return { unitId: String(c.unitId), amount: r2(amount) };
    });
    if (new Set(cs.map((c) => c.unitId)).size !== cs.length) throw new BadRequestException('للإدارة سقف واحد فقط');
    const names = await this.core.unitNames(org, cs.map((c) => c.unitId), em);
    return cs.map((c) => ({ ...c, unitName: names.get(c.unitId)! }));
  }

  async remove(actor: OrgUser, id: string) {
    const org = actor.organizationId;
    await this.db.transaction(async (em) => {
      const b = await this.budget(em, org, id, true);
      if (b.version > 0 || b.status === 'in_review') throw new ConflictException('الموازنة المعتمدة أو قيد الاعتماد لا تُحذف');
      const [{ c }] = await em.query('SELECT COUNT(*)::int AS c FROM plan_budget_commitments WHERE budget_id = $1', [id]);
      if (c) throw new ConflictException('على الموازنة حجوزات من أنظمة أخرى');
      // سيناريوهات الموازنة تُحذف معها
      const ids = [id, ...(await em.getRepository(Budget).find({ where: { organizationId: org, baseBudgetId: id, isScenario: true }, select: ['id'] })).map((x) => x.id)];
      await em.query('DELETE FROM plan_budget_lines WHERE budget_id = ANY($1)', [ids]);
      await em.getRepository(Budget).delete({ id: In(ids) });
    });
    return { ok: true };
  }

  async recalculate(actor: OrgUser, id: string) {
    const org = actor.organizationId;
    await this.db.transaction(async (em) => {
      const b = await this.budget(em, org, id, true);
      this.editable(b, actor);
      await this.recalcAll(em, b);
    });
    return this.get(actor, id);
  }

  // ---------------- الاستيراد من الأنظمة الأخرى ----------------

  async importLines(actor: OrgUser, id: string, dto: ImportDto) {
    const org = actor.organizationId;
    if (dto.source === 'employees' || dto.source === 'staffing') this.assertHr(actor);
    let added = 0, skipped = 0, updated = 0;
    await this.db.transaction(async (em) => {
      const b = await this.budget(em, org, id, true);
      this.editable(b, actor);
      const repo = em.getRepository(BudgetLine);
      const existing = await repo.find({ where: { budgetId: id } });
      const ctx = await this.ctx(org, em);
      let order = existing.reduce((m, l) => Math.max(m, l.sortOrder), 0);
      const bySource = (kind: string) => new Map(existing.filter((l) => l.kind === kind && l.sourceId).map((l) => [l.sourceId!, l]));
      const save = async (data: Partial<BudgetLine>) => {
        const l = repo.create({ organizationId: org, budgetId: id, sortOrder: ++order, methodology: b.methodology, allocations: [], included: true, history: {}, ...data } as BudgetLine);
        this.compute(b, l, ctx);
        await repo.save(l);
        added++;
      };
      const fy = b.fiscalYear;
      if (dto.source === 'employees') {
        const have = bySource('employee');
        for (const e of await this.sources.employees(org)) {
          if (have.has(e.id)) { skipped++; continue; }
          const items = e.allowances ?? [];
          const by = (c: string) => items.filter((i) => i.code === c).reduce((s, i) => s + Number(i.amount || 0), 0);
          const housing = by('housing'), transport = by('transport');
          const params: HrParams = {
            employeeNo: e.employeeNo, jobTitle: e.jobTitle, gradeName: e.gradeName, isSaudi: e.isSaudi, firstRegistration: e.firstRegistration, hireDate: e.hireDate,
            basic: e.basic, housing, transport, other: r2(items.reduce((s, i) => s + Number(i.amount || 0), 0) - housing - transport),
            rating: e.rating, ratingScore: e.ratingScore, count: 1, startMonth: 1, endMonth: 12, isNew: false, raisePct: null, raiseFromMonth: null,
          };
          await save({
            section: 'hr', kind: 'employee', name: `${e.fullName} (${e.employeeNo})`, sourceId: e.id, sourceRef: String(e.employeeNo), unitId: e.unitId, unitName: e.unitName,
            costCenterId: e.costCenterId, costCenterName: e.costCenterName, fundingType: 'unrestricted', params: params as unknown as Record<string, unknown>,
          });
        }
      } else if (dto.source === 'staffing') {
        const have = bySource('new_position');
        for (const s of await this.sources.staffingPlans(org, fy)) {
          if (have.has(s.id)) { skipped++; continue; }
          const allow = (s.gradeAllowances ?? []).map((a) => ({ code: a.code, amount: a.kind === 'percent' ? (s.minSalary * a.value) / 100 : a.value }));
          const by = (c: string) => allow.filter((i) => i.code === c).reduce((t, i) => t + i.amount, 0);
          const housing = r2(by('housing')), transport = r2(by('transport'));
          const params: HrParams = {
            employeeNo: null, jobTitle: s.jobTitle, gradeName: s.gradeName, isSaudi: s.forSaudi, firstRegistration: null, hireDate: null,
            basic: s.minSalary, housing, transport, other: r2(allow.reduce((t, i) => t + i.amount, 0) - housing - transport),
            rating: null, ratingScore: null, count: s.count, startMonth: month(s.plannedMonth, 1), endMonth: 12, isNew: true, staffingPlanId: s.id, raisePct: null, raiseFromMonth: null,
          };
          await save({
            section: 'hr', kind: 'new_position', name: `وظيفة جديدة: ${s.jobTitle}`, sourceId: s.id, sourceRef: 'خطة التعيين', unitId: s.unitId, unitName: s.unitName,
            costCenterId: s.costCenterId, costCenterName: s.costCenterName, fundingType: s.fundingSource && s.fundingSource !== 'own' ? 'restricted' : 'unrestricted', params: params as unknown as Record<string, unknown>,
          });
        }
      } else if (dto.source === 'expenses' || dto.source === 'revenues') {
        const nature = dto.source === 'expenses' ? 'expenses' : 'revenue';
        const section: Section = dto.source === 'expenses' ? 'opex' : 'revenue';
        const from = fy - b.historyYears;
        const rows = await this.sources.actuals(org, from, fy - 1, { nature });
        const payroll = nature === 'expenses' ? await this.sources.payrollAccounts(org) : new Set<string>();
        const have = new Set(existing.filter((l) => l.section === section && l.kind === 'account' && !l.costCenterId).map((l) => l.accountId));
        const accounts = [...new Map(rows.map((r) => [r.accountId, r])).values()].sort((a, c) => a.code.localeCompare(c.code));
        for (const a of accounts) {
          if (have.has(a.accountId)) { skipped++; continue; }
          const history = await this.sources.buildSnapshot(org, rows.filter((r) => r.accountId === a.accountId), a.accountId, null, from, fy);
          if (!Object.values(history.years).some((v) => v !== 0)) { skipped++; continue; }
          const isPayroll = payroll.has(a.accountId);
          await save({
            section, kind: 'account', name: a.name, sourceId: a.accountId, sourceRef: a.code, accountId: a.accountId, accountCode: a.code, accountName: a.name,
            fundingType: section === 'opex' ? 'unrestricted' : null, methodology: 'historical',
            params: { ...histDefaults(section === 'opex' ? 'OPEX_HIST' : 'REV_HIST', b.historyYears), distribution: hasFullYear(history) ? 'seasonal' : 'even' } as unknown as Record<string, unknown>,
            history: history as unknown as Record<string, unknown>,
            included: !isPayroll, note: isPayroll ? 'حساب رواتب: تكلفته محسوبة في قسم الموارد البشرية، فاستُبعد حتى لا تُحسب مرتين' : null,
          });
        }
      } else if (dto.source === 'activities') {
        const have = bySource('activity');
        for (const a of await this.sources.activities(org, fy)) {
          const params: ActivityParams = { kind: 'activity', planId: a.planId, planCode: a.planCode, itemCode: a.code, startDate: a.startDate, endDate: a.endDate, cost: a.cost, distribution: 'even', weights: [] };
          const cur = have.get(a.id);
          if (cur) {
            // تحديث تكلفة النشاط وتواريخه من الخطة مع بقاء تعديلات الموازنة عليه
            const old = cur.params as unknown as ActivityParams;
            if (r2(old.cost) === r2(a.cost) && old.startDate === a.startDate && old.endDate === a.endDate) { skipped++; continue; }
            cur.params = { ...old, cost: a.cost, startDate: a.startDate, endDate: a.endDate } as unknown as Record<string, unknown>;
            this.compute(b, cur, ctx);
            await repo.save(cur);
            updated++;
            continue;
          }
          await save({
            section: 'activity', kind: 'activity', name: `${a.code} ${a.title}`, sourceId: a.id, sourceRef: `${a.planCode}/${a.code}`, unitId: a.unitId, unitName: a.unitName,
            costCenterId: a.costCenterId, costCenterName: a.costCenterName, fundingType: a.fundingType, methodology: 'activity', params: params as unknown as Record<string, unknown>,
          });
        }
      } else if (dto.source === 'projects') {
        const have = bySource('project');
        for (const p of await this.sources.projects(org, fy)) {
          if (have.has(p.id)) { skipped++; continue; }
          const params: ActivityParams = { kind: 'project', planId: '', planCode: p.code, itemCode: '', startDate: p.startDate, endDate: p.endDate, cost: p.share, distribution: 'even', weights: [] };
          await save({
            section: 'activity', kind: 'project', name: `${p.code} ${p.name}`, sourceId: p.id, sourceRef: p.code, fundingType: 'restricted', methodology: 'activity',
            params: params as unknown as Record<string, unknown>,
          });
        }
      }
      b.calculatedAt = new Date();
      await em.getRepository(Budget).save(b);
    });
    return { added, updated, skipped, budget: await this.get(actor, id) };
  }

  // ---------------- البنود ----------------

  private async line(em: EntityManager, org: string, id: string) {
    const l = await em.getRepository(BudgetLine).findOne({ where: { id, organizationId: org } });
    if (!l) throw new NotFoundException('البند غير موجود');
    return l;
  }

  /** تنظيف مدخلات البند حسب نوعه (الحقول المعروفة فقط وبأنواعها) */
  private cleanParams(section: Section, kind: string, input: Record<string, unknown>, years: number): Record<string, unknown> {
    if (section === 'hr' && HR_KINDS.includes(kind)) {
      const startMonth = month(input.startMonth, 1);
      return {
        employeeNo: nullableNum(input.employeeNo), jobTitle: str(input.jobTitle), gradeName: str(input.gradeName, 100), isSaudi: !!input.isSaudi,
        firstRegistration: str(input.firstRegistration, 10), hireDate: str(input.hireDate, 10),
        basic: Math.max(0, n(input.basic)), housing: Math.max(0, n(input.housing)), transport: Math.max(0, n(input.transport)), other: Math.max(0, n(input.other)),
        rating: str(input.rating, 40), ratingScore: nullableNum(input.ratingScore), count: Math.max(0, Math.min(500, Math.round(n(input.count, 1)))),
        startMonth, endMonth: Math.max(startMonth, month(input.endMonth, 12)), isNew: kind === 'new_position', staffingPlanId: str(input.staffingPlanId, 40),
        raisePct: nullableNum(input.raisePct), raiseFromMonth: input.raiseFromMonth ? month(input.raiseFromMonth, 1) : null,
      };
    }
    if (kind === 'activity' || kind === 'project') {
      const w = Array.isArray(input.weights) ? input.weights.slice(0, 12).map((x) => Math.max(0, n(x))) : [];
      return {
        kind, planId: str(input.planId, 40) ?? '', planCode: str(input.planCode, 60) ?? '', itemCode: str(input.itemCode, 60) ?? '', startDate: str(input.startDate, 10), endDate: str(input.endDate, 10),
        cost: Math.max(0, n(input.cost)), distribution: ['even', 'custom'].includes(String(input.distribution)) ? input.distribution : 'even', weights: w.length === 12 ? w : [],
      };
    }
    const method = ['formula', 'manual', 'zero'].includes(String(input.method)) ? (input.method as HistParams['method']) : kind === 'account' ? 'formula' : 'manual';
    const p = histDefaults(str(input.formulaCode, 40), years, method);
    const vars: Record<string, number> = {};
    for (const [k, v] of Object.entries((input.vars ?? {}) as Record<string, unknown>)) {
      if (!VAR_KEY.test(k) || BUILTIN_KEYS.has(k)) throw new BadRequestException(`رمز المتغير ${k} غير صحيح أو محجوز`);
      if (!Number.isFinite(Number(v))) throw new BadRequestException(`قيمة المتغير ${k} يجب أن تكون رقمًا`);
      vars[k] = Number(v);
    }
    const contracts = (Array.isArray(input.contracts) ? input.contracts : []).map((c: Record<string, unknown>) => {
      const name = str(c.name, 200);
      if (!name) throw new BadRequestException('اكتب اسم كل عقد');
      const fromMonth = month(c.fromMonth, 1);
      return { name, amount: Math.max(0, n(c.amount)), fromMonth, toMonth: Math.max(fromMonth, month(c.toMonth, 12)), kind: c.kind === 'ending' ? 'ending' as const : 'new' as const };
    });
    const adjustments = (Array.isArray(input.adjustments) ? input.adjustments : []).map((a: Record<string, unknown>) => {
      const note = str(a.note, 300);
      if (!note) throw new BadRequestException('اكتب سبب كل تعديل على التاريخ');
      return { year: Math.round(n(a.year)), amount: n(a.amount), note };
    });
    const w = Array.isArray(input.weights) ? input.weights.slice(0, 12).map((x) => Math.max(0, n(x))) : [];
    return {
      ...p, years: Math.max(1, Math.min(10, Math.round(n(input.years, years)))), avgType: ['mean', 'weighted', 'median', 'last'].includes(String(input.avgType)) ? input.avgType : 'mean',
      annualizeCurrent: input.annualizeCurrent === undefined ? true : !!input.annualizeCurrent, growth: nullableNum(input.growth),
      volumeBase: nullableNum(input.volumeBase), volumeTarget: nullableNum(input.volumeTarget),
      excludedEntryIds: (Array.isArray(input.excludedEntryIds) ? input.excludedEntryIds : []).map(String).slice(0, 50), adjustments, contracts,
      distribution: ['even', 'seasonal', 'custom'].includes(String(input.distribution)) ? input.distribution : p.distribution, weights: w.length === 12 ? w : [],
      manualAmount: nullableNum(input.manualAmount), vars,
    };
  }

  private async refs(org: string, em: EntityManager, dto: { unitId?: string | null; costCenterId?: string | null; accountId?: string | null }, l: Partial<BudgetLine>) {
    if (dto.unitId !== undefined) { l.unitId = dto.unitId || null; l.unitName = l.unitId ? (await this.core.unitNames(org, [l.unitId], em)).get(l.unitId)! : null; }
    if (dto.costCenterId !== undefined) { l.costCenterId = dto.costCenterId || null; l.costCenterName = await this.core.costCenterName(org, l.costCenterId, em); }
    if (dto.accountId !== undefined) {
      l.accountId = dto.accountId || null;
      if (l.accountId) {
        const [a] = await em.query(`SELECT code, name, nature FROM acc_accounts WHERE organization_id = $1 AND id = $2 AND kind = 'sub'`, [org, l.accountId]).catch(() => []);
        if (!a) throw new BadRequestException('الحساب المختار غير موجود أو ليس حسابًا فرعيًا');
        if ((l.section === 'revenue') !== (a.nature === 'revenue')) throw new BadRequestException(l.section === 'revenue' ? 'اختر حساب إيرادات' : 'اختر حساب مصروفات');
        l.accountCode = a.code; l.accountName = a.name;
      } else { l.accountCode = null; l.accountName = null; }
    }
  }

  async addLine(actor: OrgUser, id: string, dto: LineDto) {
    const org = actor.organizationId;
    if (dto.section === 'hr') this.assertHr(actor);
    if (!KINDS[dto.section].includes(dto.kind)) throw new BadRequestException('نوع البند لا يناسب القسم');
    if (dto.kind === 'account' && !dto.accountId) throw new BadRequestException('اختر الحساب');
    const lineId = await this.db.transaction(async (em) => {
      const b = await this.budget(em, org, id, true);
      this.editable(b, actor);
      const repo = em.getRepository(BudgetLine);
      const [{ m }] = await em.query('SELECT COALESCE(MAX(sort_order), 0)::int AS m FROM plan_budget_lines WHERE budget_id = $1', [id]);
      const l = repo.create({
        organizationId: org, budgetId: id, section: dto.section, kind: dto.kind, name: dto.name, sortOrder: m + 1, methodology: b.methodology, allocations: [], included: true,
        fundingType: dto.section === 'revenue' ? null : 'unrestricted', overrideAmount: null,
      });
      await this.refs(org, em, dto, l);
      const input = { ...(dto.params ?? {}) };
      if (dto.kind === 'account' && !input.formulaCode) input.formulaCode = dto.section === 'revenue' ? 'REV_HIST' : 'OPEX_HIST';
      if (dto.kind === 'hr_other') input.method = 'manual';
      l.params = this.cleanParams(dto.section, dto.kind, input, b.historyYears);
      l.history = l.accountId ? await this.sources.snapshot(org, l.accountId, l.costCenterId, b.fiscalYear, b.historyYears) as unknown as Record<string, unknown> : {};
      this.compute(b, l, await this.ctx(org, em));
      await repo.save(l);
      await em.getRepository(Budget).save(b);
      return l.id;
    });
    return this.db.getRepository(BudgetLine).findOneByOrFail({ id: lineId });
  }

  /**
   * بنود من ملف Excel في معاملة واحدة، بنفس قواعد الإضافة اليدوية. البند الموجود بالقسم والاسم نفسيهما لا يتكرر.
   * dryRun يحتسب البنود ويعيد النتيجة دون حفظ.
   */
  async importExcelLines(actor: OrgUser, id: string, rows: ExcelLine[], dryRun: boolean) {
    const org = actor.organizationId;
    if (rows.some((r) => r.section === 'hr')) this.assertHr(actor);
    for (const r of rows) if (!KINDS[r.section].includes(r.kind) || !['new_position', 'hr_other', 'manual'].includes(r.kind)) throw new BadRequestException(`نوع البند «${r.name}» لا يناسب القسم`);
    const run = async (em: EntityManager) => {
      const b = await this.budget(em, org, id, true);
      this.editable(b, actor);
      const repo = em.getRepository(BudgetLine);
      const existing = await repo.find({ where: { budgetId: id, organizationId: org }, select: ['id', 'section', 'name', 'sortOrder'] });
      const have = new Set(existing.map((l) => `${l.section}|${l.name}`));
      let order = existing.reduce((m, l) => Math.max(m, l.sortOrder), 0);
      const ctx = await this.ctx(org, em);
      const out: { name: string; section: Section; amount: number; status: 'new' | 'exists' }[] = [];
      for (const r of rows) {
        if (have.has(`${r.section}|${r.name}`)) { out.push({ name: r.name, section: r.section, amount: 0, status: 'exists' }); continue; }
        have.add(`${r.section}|${r.name}`);
        const l = repo.create({
          organizationId: org, budgetId: id, section: r.section, kind: r.kind, name: r.name, sortOrder: ++order, methodology: b.methodology, allocations: [], included: true,
          fundingType: r.section === 'revenue' ? null : r.fundingType ?? 'unrestricted', overrideAmount: null, note: r.note, history: {},
          sourceRef: 'استيراد من Excel',
        });
        const input = { ...r.params };
        if (r.kind === 'hr_other' || r.kind === 'manual') input.method = 'manual';
        l.params = this.cleanParams(r.section, r.kind, input, b.historyYears);
        this.compute(b, l, ctx);
        if (!dryRun) await repo.save(l);
        out.push({ name: r.name, section: r.section, amount: Number(l.amount ?? 0), status: 'new' });
      }
      if (!dryRun) await em.getRepository(Budget).save(b);
      return { budget: { id: b.id, code: b.code, title: b.title, fiscalYear: b.fiscalYear }, lines: out };
    };
    if (!dryRun) return this.db.transaction(run);
    // الفحص داخل معاملة تُلغى في النهاية، فلا يتغير شيء
    let result: Awaited<ReturnType<typeof run>> | null = null;
    await this.db.transaction(async (em) => { result = await run(em); throw new LineDryRun(); }).catch((e) => { if (!(e instanceof LineDryRun)) throw e; });
    return result!;
  }

  async updateLine(actor: OrgUser, lineId: string, dto: UpdateLineDto) {
    const org = actor.organizationId;
    return this.db.transaction(async (em) => {
      const l = await this.line(em, org, lineId);
      if (l.section === 'hr') this.assertHr(actor);
      const b = await this.budget(em, org, l.budgetId, true);
      this.editable(b, actor);
      if (dto.name !== undefined) l.name = dto.name;
      if (dto.included !== undefined) l.included = dto.included;
      if (dto.methodology !== undefined) l.methodology = dto.methodology;
      if (dto.fundingType !== undefined) l.fundingType = dto.fundingType;
      if (dto.note !== undefined) l.note = dto.note;
      if (dto.overrideAmount !== undefined) {
        if (dto.overrideAmount !== null && !(dto.overrideNote ?? l.overrideNote)) throw new BadRequestException('اكتب مبرر تعديل المبلغ عن التقدير الآلي');
        l.overrideAmount = dto.overrideAmount === null ? null : r2(dto.overrideAmount);
        if (l.overrideAmount === null) l.overrideNote = null;
      }
      if (dto.overrideNote !== undefined && l.overrideAmount !== null) l.overrideNote = dto.overrideNote;
      if (dto.allocations !== undefined) {
        const al = dto.allocations.map((a) => ({ costCenterId: a.costCenterId || null, name: String(a.name ?? '').trim().slice(0, 200), pct: r2(n(a.pct)) }));
        const t = r2(al.reduce((s, a) => s + a.pct, 0));
        if (al.length && (t !== 100 || al.some((a) => a.pct <= 0 || !a.name))) throw new BadRequestException('نسب التوزيع على مراكز التكلفة يجب أن يكون مجموعها 100% ولكل سطر اسم');
        l.allocations = al;
      }
      const accountChanged = dto.accountId !== undefined && (dto.accountId || null) !== l.accountId;
      const ccChanged = dto.costCenterId !== undefined && (dto.costCenterId || null) !== l.costCenterId;
      await this.refs(org, em, dto, l);
      if (dto.params !== undefined) l.params = this.cleanParams(l.section, l.kind, { ...l.params, ...dto.params }, b.historyYears);
      const years = n((l.params as { years?: number }).years, b.historyYears);
      const histYears = Object.keys((l.history as { years?: object }).years ?? {}).length;
      if (l.accountId && (accountChanged || ccChanged || (l.kind === 'account' && years > histYears && dto.params !== undefined))) {
        l.history = await this.sources.snapshot(org, l.accountId, l.costCenterId, b.fiscalYear, Math.max(years, b.historyYears)) as unknown as Record<string, unknown>;
        (l.params as { excludedEntryIds?: string[] }).excludedEntryIds = [];
      }
      this.compute(b, l, await this.ctx(org, em));
      await em.getRepository(BudgetLine).save(l);
      await em.getRepository(Budget).save(b);
      return l;
    });
  }

  /** إعادة جلب الفعلي من المحاسبة لبند (بعد ترحيل قيود جديدة) */
  async refreshHistory(actor: OrgUser, lineId: string) {
    const org = actor.organizationId;
    return this.db.transaction(async (em) => {
      const l = await this.line(em, org, lineId);
      if (!l.accountId) throw new BadRequestException('البند غير مرتبط بحساب');
      const b = await this.budget(em, org, l.budgetId, true);
      this.editable(b, actor);
      const years = n((l.params as { years?: number }).years, b.historyYears);
      l.history = await this.sources.snapshot(org, l.accountId, l.costCenterId, b.fiscalYear, Math.max(years, b.historyYears)) as unknown as Record<string, unknown>;
      const ids = new Set(((l.history as { entries?: { id: string }[] }).entries ?? []).map((e) => e.id));
      const p = l.params as { excludedEntryIds?: string[] };
      p.excludedEntryIds = (p.excludedEntryIds ?? []).filter((x) => ids.has(x));
      this.compute(b, l, await this.ctx(org, em));
      await em.getRepository(BudgetLine).save(l);
      await em.getRepository(Budget).save(b);
      return l;
    });
  }

  async removeLine(actor: OrgUser, lineId: string) {
    const org = actor.organizationId;
    await this.db.transaction(async (em) => {
      const l = await this.line(em, org, lineId);
      if (l.section === 'hr') this.assertHr(actor);
      const b = await this.budget(em, org, l.budgetId, true);
      this.editable(b, actor);
      const [{ c }] = await em.query(`SELECT COUNT(*)::int AS c FROM plan_budget_commitments WHERE line_id = $1 AND status <> 'released'`, [lineId]);
      if (c) throw new ConflictException('على البند حجوزات من أنظمة أخرى، فلا يُحذف');
      await em.getRepository(BudgetLine).delete({ id: lineId });
      await em.getRepository(Budget).save(b);
    });
    return { ok: true };
  }

  /**
   * عدد ما يشير إلى بنود الموازنة من خارجها: حجوزات غير محررة، ومناقلات، ومستندات مشتريات وعقود وحركات أصول، وبنود سيناريوهات.
   * أي إشارة تمنع حذف البنود جملة (لا قيود مفاتيح في الجداول، فالفحص هنا هو الحماية).
   */
  async lineBlockers(org: string, budgetId: string, em: EntityManager = this.db.manager): Promise<number> {
    const [{ n }] = await em.query(
      `WITH l AS (SELECT id FROM plan_budget_lines WHERE organization_id = $1 AND budget_id = $2)
       SELECT ((SELECT COUNT(*) FROM plan_budget_commitments WHERE organization_id = $1 AND status <> 'released' AND line_id IN (SELECT id FROM l))
             + (SELECT COUNT(*) FROM plan_budget_transfers WHERE organization_id = $1 AND (from_line_id IN (SELECT id FROM l) OR to_line_id IN (SELECT id FROM l)))
             + (SELECT COUNT(*) FROM plan_budget_lines WHERE organization_id = $1 AND base_line_id IN (SELECT id FROM l))
             + (SELECT COUNT(*) FROM pr_requests WHERE organization_id = $1 AND budget_line_id IN (SELECT id FROM l))
             + (SELECT COUNT(*) FROM pr_orders WHERE organization_id = $1 AND budget_line_id IN (SELECT id FROM l))
             + (SELECT COUNT(*) FROM pr_contracts WHERE organization_id = $1 AND budget_line_id IN (SELECT id FROM l))
             + (SELECT COUNT(*) FROM acc_asset_moves WHERE organization_id = $1 AND budget_line_id IN (SELECT id FROM l)))::int AS n`,
      [org, budgetId]);
    return n;
  }

  /**
   * حذف كل بنود الموازنة في معاملة واحدة تمهيدًا لإعادة بنائها (تعديل الموازنة المعتمدة إلى إصدار جديد، وإصدارها السابق محفوظ).
   * يرفض دون تغيير شيء إن أشار إلى أي بند حجز أو مناقلة أو مستند. يستخدمه إدراج حزمة الشركة فقط.
   */
  async clearLinesForRevision(actor: OrgUser, id: string) {
    const org = actor.organizationId;
    await this.db.transaction(async (em) => {
      const b = await this.budget(em, org, id, true);
      if (b.isScenario) throw new BadRequestException('السيناريو لا يُعدّل بهذه الطريقة');
      if (await em.getRepository(BudgetLine).exists({ where: { organizationId: org, budgetId: id, section: 'hr' } })) this.assertHr(actor);
      if (await this.lineBlockers(org, id, em)) throw new ConflictException('على بنود الموازنة حجوزات أو مناقلات أو مستندات مرتبطة، فلا تُحذف بنودها');
      this.editable(b, actor);
      await em.query('DELETE FROM plan_budget_lines WHERE organization_id = $1 AND budget_id = $2', [org, id]);
      await em.getRepository(Budget).save(b);
    });
  }

  // ---------------- الاعتماد والإصدارات ----------------

  async snapshot(em: EntityManager, b: Budget): Promise<BudgetSnapshot> {
    const lines = await em.getRepository(BudgetLine).find({ where: { budgetId: b.id }, order: { section: 'ASC', sortOrder: 'ASC' } });
    const refs = await this.formulas.refs(b.organizationId, em);
    const used = new Set(lines.flatMap((l) => l.trace.map((t) => t.formulaCode).filter((x): x is string => !!x)));
    return clone({
      title: b.title, fiscalYear: b.fiscalYear, description: b.description, methodology: b.methodology, historyYears: b.historyYears,
      variables: b.variables, raiseRules: b.raiseRules, hrSetup: b.hrSetup, ceilings: b.ceilings, levers: b.levers ?? [],
      lines: lines.map((l) => this.pickLine(l)),
      formulas: [...used].map((c) => refs.get(c)).filter(Boolean).map((f) => ({ code: f!.code, version: f!.version, expression: f!.expression })),
    });
  }

  async submit(actor: OrgUser, id: string, note: string | null) {
    const org = actor.organizationId;
    const cfg = await this.core.config(org);
    await this.db.transaction(async (em) => {
      const b = await this.budget(em, org, id, true);
      if (b.isScenario) throw new BadRequestException('السيناريو لا يُرفع للاعتماد. حوّله إلى مشروع موازنة على الموازنة الأساسية');
      const lines = await em.getRepository(BudgetLine).find({ where: { budgetId: id } });
      if (!lines.length) throw new BadRequestException('أضف بنود الموازنة قبل رفعها للاعتماد');
      const ctx = await this.ctx(org, em);
      const stale = lines.filter((l) => l.trace.some((t) => t.formulaCode && ctx.formulas.get(t.formulaCode)?.version !== t.formulaVersion));
      if (stale.length) throw new BadRequestException(`${stale.length} بند محتسب بإصدار سابق من معادلته. أعد الاحتساب قبل الرفع`);
      if (b.version > 0) {
        const text = note?.trim() || b.revisionNote;
        if (!text) throw new BadRequestException('اكتب سبب التعديل على الموازنة المعتمدة');
        b.revisionNote = text;
      }
      const expenses = lines.filter((l) => l.included && l.section !== 'revenue').reduce((s, l) => s + l.amount, 0);
      const route = pickRoute(cfg.routes, 'budget', null, expenses);
      b.routeName = route?.name ?? null;
      wfSubmit(b, route?.stages ?? [], actor.fullName, note?.trim() || null);
      await em.getRepository(Budget).save(b);
      if (b.status === 'approved') await this.afterApprove(em, b, actor.fullName);
    });
    return this.get(actor, id);
  }

  async decide(actor: OrgUser, id: string, dto: DecideDto) {
    const org = actor.organizationId;
    const d = await this.core.decider(actor, P.budgetsApprove);
    await this.db.transaction(async (em) => {
      const b = await this.budget(em, org, id, true);
      wfDecide(b, d, dto.decision, dto.note ?? null);
      await em.getRepository(Budget).save(b);
      if (b.status === 'approved') await this.afterApprove(em, b, actor.fullName);
    });
    return this.get(actor, id);
  }

  private async afterApprove(em: EntityManager, b: Budget, byName: string) {
    b.version += 1;
    const snap = await this.snapshot(em, b);
    const inc = snap.lines.filter((l) => l.included);
    await em.getRepository(BudgetVersion).save(em.getRepository(BudgetVersion).create({
      organizationId: b.organizationId, budgetId: b.id, version: b.version, snapshot: snap,
      expenses: r2(inc.filter((l) => l.section !== 'revenue').reduce((s, l) => s + l.amount, 0)), revenues: r2(inc.filter((l) => l.section === 'revenue').reduce((s, l) => s + l.amount, 0)),
      note: b.version === 1 ? 'الإصدار الأول المعتمد' : b.revisionNote, approvedByName: byName, approvedAt: b.approvedAt ?? new Date(),
    }));
    b.revisionNote = null;
    await em.getRepository(Budget).save(b);
  }

  /** إلغاء التعديل الجاري والعودة لآخر إصدار معتمد (البنود والافتراضات كما اعتُمدت) */
  async discard(actor: OrgUser, id: string) {
    const org = actor.organizationId;
    await this.db.transaction(async (em) => {
      const b = await this.budget(em, org, id, true);
      if (b.version < 1) throw new ConflictException('لا يوجد إصدار معتمد للعودة إليه');
      if (!['draft', 'returned', 'rejected'].includes(b.status)) throw new ConflictException('لا يوجد تعديل جارٍ على الموازنة');
      const v = await em.getRepository(BudgetVersion).findOneOrFail({ where: { budgetId: id, version: b.version } });
      const s = v.snapshot;
      const keep = new Set(s.lines.map((l) => l.id));
      const [{ c }] = await em.query(`SELECT COUNT(*)::int AS c FROM plan_budget_commitments WHERE budget_id = $1 AND status <> 'released' AND NOT (line_id = ANY($2))`, [id, [...keep]]);
      if (c) throw new ConflictException('على بنود أُضيفت بعد الاعتماد حجوزات من أنظمة أخرى');
      await em.query('DELETE FROM plan_budget_lines WHERE budget_id = $1 AND NOT (id = ANY($2))', [id, [...keep]]);
      for (const sl of s.lines) await em.getRepository(BudgetLine).save(em.getRepository(BudgetLine).create({ ...sl, organizationId: org, budgetId: id }));
      Object.assign(b, { title: s.title, description: s.description, methodology: s.methodology, historyYears: s.historyYears, variables: s.variables, raiseRules: s.raiseRules, hrSetup: s.hrSetup, ceilings: s.ceilings, levers: s.levers ?? [] });
      b.status = 'approved';
      b.stageIndex = null;
      b.revisionNote = null;
      b.approvals = [...b.approvals, { action: 'reopen', stage: null, byName: actor.fullName, at: new Date().toISOString(), note: `إلغاء التعديل والعودة للإصدار ${b.version}` }];
      await em.getRepository(Budget).save(b);
    });
    return this.get(actor, id);
  }

  async version(actor: OrgUser, id: string, version: number) {
    const v = await this.db.getRepository(BudgetVersion).findOne({ where: { organizationId: actor.organizationId, budgetId: id, version } });
    if (!v) throw new NotFoundException('الإصدار غير موجود');
    if (!this.canHr(actor)) v.snapshot.lines = v.snapshot.lines.filter((l) => !(l.section === 'hr' && l.kind === 'employee'));
    return v;
  }

  /** مقارنة إصدارين (أو إصدار والمسودة الحالية): البنود المضافة والمحذوفة والمعدلة، والإجماليات، والافتراضات */
  async compare(actor: OrgUser, id: string, from: number, to: number) {
    const b = await this.budget(this.db.manager, actor.organizationId, id);
    const a = (await this.version(actor, id, from)).snapshot;
    const c = to ? (await this.version(actor, id, to)).snapshot : await this.snapshot(this.db.manager, b);
    const hide = (s: BudgetSnapshot) => (this.canHr(actor) ? s.lines : s.lines.filter((l) => !(l.section === 'hr' && l.kind === 'employee')));
    const la = new Map(hide(a).map((l) => [l.id, l])), lc = new Map(hide(c).map((l) => [l.id, l]));
    const rows: { change: 'added' | 'removed' | 'modified'; section: string; name: string; before: number | null; after: number | null; diff: number }[] = [];
    for (const [k, l] of lc) {
      const o = la.get(k);
      const after = l.included ? l.amount : 0;
      if (!o) rows.push({ change: 'added', section: l.section, name: l.name, before: null, after, diff: after });
      else { const before = o.included ? o.amount : 0; if (r2(before) !== r2(after)) rows.push({ change: 'modified', section: l.section, name: l.name, before, after, diff: r2(after - before) }); }
    }
    for (const [k, l] of la) if (!lc.has(k)) rows.push({ change: 'removed', section: l.section, name: l.name, before: l.included ? l.amount : 0, after: null, diff: -(l.included ? l.amount : 0) });
    rows.sort((x, y) => Math.abs(y.diff) - Math.abs(x.diff));
    const tot = (s: BudgetSnapshot) => Object.fromEntries(SECTIONS.map((k) => [k, r2(s.lines.filter((l) => l.included && l.section === k).reduce((t, l) => t + l.amount, 0))]));
    const vars: { key: string; name: string; before: number | null; after: number | null }[] = [];
    const va = new Map(a.variables.map((v) => [`${v.key}|${v.unitId ?? ''}`, v])), vc = new Map(c.variables.map((v) => [`${v.key}|${v.unitId ?? ''}`, v]));
    for (const k of new Set([...va.keys(), ...vc.keys()])) {
      const x = va.get(k), y = vc.get(k);
      if (JSON.stringify(x?.value ?? null) !== JSON.stringify(y?.value ?? null) || JSON.stringify(x?.steps ?? []) !== JSON.stringify(y?.steps ?? [])) {
        vars.push({ key: k.split('|')[0], name: `${(y ?? x)!.name}${(y ?? x)!.unitName ? ` (${(y ?? x)!.unitName})` : ''}`, before: x?.value ?? null, after: y?.value ?? null });
      }
    }
    return { from, to, totals: { before: tot(a), after: tot(c) }, rows, variables: vars, rulesChanged: JSON.stringify(a.raiseRules) !== JSON.stringify(c.raiseRules) };
  }
}
