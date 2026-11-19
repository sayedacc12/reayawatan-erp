import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { OrgUser } from '../../../core/auth/decorators';
import { FormulaRef } from './budget-calc';
import { BUILTIN_VARS, DEFAULT_VARIABLES, FormulaTarget, SYSTEM_FORMULAS } from './budget-defaults';
import { FormulaDto, TestFormulaDto, UpdateFormulaDto } from './budget.dto';
import { Budget, PlanFormula } from './budget.entity';
import { compile, FormulaError, FUNCTIONS, run, VAR_KEY, variablesOf } from './formula-engine';

/** مكتبة المعادلات: إنشاء وتعديل بإصدارات، وتجربة المعادلة قبل اعتمادها */
@Injectable()
export class FormulasService {
  constructor(private readonly db: DataSource) {}

  /** المعادلات الأساسية تُنشأ لكل جمعية عند أول استخدام، ويمكن تعديلها بإصدارات */
  async ensure(org: string, em: EntityManager = this.db.manager) {
    const repo = em.getRepository(PlanFormula);
    const have = new Set((await repo.find({ where: { organizationId: org }, select: ['code'] })).map((f) => f.code));
    const missing = SYSTEM_FORMULAS.filter((f) => !have.has(f.code));
    if (missing.length) {
      await repo.createQueryBuilder().insert().values(missing.map((f) => ({
        organizationId: org, code: f.code, name: f.name, target: f.target, expression: f.expression, description: f.description, isSystem: true, status: 'active' as const,
        version: 1, history: [{ version: 1, expression: f.expression, at: new Date().toISOString(), byName: 'النظام', note: 'المعادلة الأساسية' }], updatedByName: 'النظام',
      }))).orIgnore().execute();
    }
  }

  async refs(org: string, em: EntityManager = this.db.manager): Promise<Map<string, FormulaRef & { target: FormulaTarget; status: string }>> {
    await this.ensure(org, em);
    const rows = await em.getRepository(PlanFormula).find({ where: { organizationId: org } });
    return new Map(rows.map((f) => [f.code, { code: f.code, version: f.version, expression: f.expression, name: f.name, target: f.target, status: f.status }]));
  }

  async list(actor: OrgUser) {
    const org = actor.organizationId;
    await this.ensure(org);
    const rows = await this.db.getRepository(PlanFormula).find({ where: { organizationId: org }, order: { isSystem: 'DESC', target: 'ASC', code: 'ASC' } });
    const lineUse: { budgetId: string; code: string }[] = await this.db.query(
      `SELECT DISTINCT budget_id AS "budgetId", params->>'formulaCode' AS code FROM plan_budget_lines WHERE organization_id = $1 AND params->>'formulaCode' IS NOT NULL`, [org]);
    const hrUse: { id: string; m: string | null; a: string | null; hr: boolean }[] = await this.db.query(
      `SELECT b.id, b.hr_setup->>'monthlyFormula' AS m, b.hr_setup->>'annualFormula' AS a, EXISTS (SELECT 1 FROM plan_budget_lines l WHERE l.budget_id = b.id AND l.section = 'hr') AS hr
         FROM plan_budgets b WHERE b.organization_id = $1`, [org]);
    const usedBy = new Map<string, Set<string>>();
    const add = (code: string | null, id: string) => { if (code) usedBy.set(code, (usedBy.get(code) ?? new Set()).add(id)); };
    for (const u of lineUse) add(u.code, u.budgetId);
    for (const b of hrUse) if (b.hr) { add(b.m || 'HR_MONTHLY', b.id); add(b.a === null ? 'HR_ANNUAL' : b.a, b.id); }
    const used = new Map([...usedBy].map(([k, v]) => [k, v.size]));
    return {
      formulas: rows.map((f) => ({ ...f, variables: this.varsOf(f.expression), budgets: used.get(f.code) ?? 0 })),
      functions: Object.entries(FUNCTIONS).map(([name, f]) => ({ name, label: f.label })),
      builtins: BUILTIN_VARS,
      defaultVariables: DEFAULT_VARIABLES,
    };
  }

  private varsOf(expression: string) {
    try { return [...variablesOf(compile(expression))]; } catch { return []; }
  }

  /** فحص المعادلة: صياغة صحيحة، ومتغيرات معروفة (من النظام أو افتراضات الموازنة) */
  private validate(expression: string, target: FormulaTarget, extraVars: string[] = []) {
    let tree;
    try { tree = compile(expression); } catch (e) {
      if (e instanceof FormulaError) throw new BadRequestException(`المعادلة غير صحيحة: ${e.message}`);
      throw e;
    }
    const known = new Set([...(target === 'any' ? Object.values(BUILTIN_VARS).flat() : BUILTIN_VARS[target]).map((v) => v.key), ...DEFAULT_VARIABLES.map((v) => v.key), ...extraVars]);
    const unknown = [...variablesOf(tree)].filter((v) => !known.has(v));
    return { tree, unknown };
  }

  async create(actor: OrgUser, dto: FormulaDto) {
    const org = actor.organizationId;
    await this.ensure(org);
    if (!/^[A-Z][A-Z0-9_]{1,39}$/.test(dto.code)) throw new BadRequestException('رمز المعادلة بحروف إنجليزية كبيرة وأرقام وشرطة سفلية، مثل OPEX_FUEL');
    const { unknown } = this.validate(dto.expression, dto.target);
    const repo = this.db.getRepository(PlanFormula);
    if (await repo.findOne({ where: { organizationId: org, code: dto.code } })) throw new ConflictException('رمز المعادلة مستخدم');
    const f = await repo.save(repo.create({
      organizationId: org, code: dto.code, name: dto.name, target: dto.target, expression: dto.expression.trim(), description: dto.description ?? null, status: dto.status ?? 'active',
      isSystem: false, version: 1, history: [{ version: 1, expression: dto.expression.trim(), at: new Date().toISOString(), byName: actor.fullName, note: 'الإصدار الأول' }], updatedByName: actor.fullName,
    }));
    return { ...f, unknownVariables: unknown };
  }

  /** تعديل المعادلة يرفع إصدارها؛ الموازنات المحتسبة تحتفظ بنتائجها حتى يُعاد احتسابها */
  async update(actor: OrgUser, id: string, dto: UpdateFormulaDto) {
    const repo = this.db.getRepository(PlanFormula);
    const f = await repo.findOne({ where: { id, organizationId: actor.organizationId } });
    if (!f) throw new NotFoundException('المعادلة غير موجودة');
    let unknown: string[] = [];
    if (dto.expression !== undefined && dto.expression.trim() !== f.expression) {
      unknown = this.validate(dto.expression, f.target).unknown;
      f.version += 1;
      f.expression = dto.expression.trim();
      f.history = [...f.history, { version: f.version, expression: f.expression, at: new Date().toISOString(), byName: actor.fullName, note: dto.note ?? null }];
    }
    if (dto.name !== undefined) f.name = dto.name;
    if (dto.description !== undefined) f.description = dto.description;
    if (dto.status !== undefined) {
      if (f.isSystem && dto.status !== 'active') throw new BadRequestException('المعادلات الأساسية لا تُوقف، ويمكن تعديلها');
      f.status = dto.status;
    }
    f.updatedByName = actor.fullName;
    return { ...(await repo.save(f)), unknownVariables: unknown };
  }

  async remove(actor: OrgUser, id: string) {
    const repo = this.db.getRepository(PlanFormula);
    const f = await repo.findOne({ where: { id, organizationId: actor.organizationId } });
    if (!f) throw new NotFoundException('المعادلة غير موجودة');
    if (f.isSystem) throw new BadRequestException('المعادلات الأساسية لا تُحذف');
    const [{ n }] = await this.db.query(
      `SELECT COUNT(*)::int AS n FROM plan_budget_lines WHERE organization_id = $1 AND params->>'formulaCode' = $2`, [actor.organizationId, f.code]);
    const [{ m }] = await this.db.query(
      `SELECT COUNT(*)::int AS m FROM plan_budgets WHERE organization_id = $1 AND (hr_setup->>'monthlyFormula' = $2 OR hr_setup->>'annualFormula' = $2)`, [actor.organizationId, f.code]);
    if (n || m) throw new ConflictException('المعادلة مستخدمة في موازنات، ويمكن إيقافها بدل حذفها');
    await repo.delete({ id });
    return { ok: true };
  }

  /**
   * تجربة معادلة بقيم نموذجية (أو بافتراضات موازنة محددة): تُرجع النتيجة والمتغيرات المستخدمة وقيمها.
   * لا تحفظ شيئًا.
   */
  async test(actor: OrgUser, dto: TestFormulaDto) {
    const sample: Record<string, number> = {
      basic: 8000, housing: 2000, transport: 800, other: 0, gross: 10800, raise: 0.05, gosi: 1170, eos: 375, month: 1, is_saudi: 1, service_years: 3, is_new: 0,
      active_months: 12, rating_score: 85, hist_avg: 120000, hist_last: 130000, hist_trend: 0.06, growth: 0.03, volume_ratio: 1.1,
    };
    const vars: Record<string, number> = { ...sample };
    for (const v of DEFAULT_VARIABLES) vars[v.key] = v.value;
    if (dto.budgetId) {
      const b = await this.db.getRepository(Budget).findOne({ where: { id: dto.budgetId, organizationId: actor.organizationId } });
      if (!b) throw new NotFoundException('الموازنة غير موجودة');
      for (const v of b.variables) if (!v.unitId) vars[v.key] = v.value;
    }
    for (const [k, v] of Object.entries(dto.vars ?? {})) {
      if (!VAR_KEY.test(k)) throw new BadRequestException(`اسم المتغير ${k} غير صحيح`);
      const n = Number(v);
      if (!Number.isFinite(n)) throw new BadRequestException(`قيمة ${k} يجب أن تكون رقمًا`);
      vars[k] = n;
    }
    const { unknown } = this.validate(dto.expression, dto.target, Object.keys(dto.vars ?? {}));
    try {
      const r = run(dto.expression, vars);
      return { value: Math.round(r.value * 100) / 100, used: r.used, warnings: r.warnings, unknownVariables: unknown };
    } catch (e) {
      if (e instanceof FormulaError) return { value: null, used: {}, warnings: [], error: e.message, unknownVariables: unknown };
      throw e;
    }
  }
}
