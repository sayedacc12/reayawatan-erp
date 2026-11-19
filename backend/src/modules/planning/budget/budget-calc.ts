import { BadRequestException } from '@nestjs/common';
import { gosi, HrPolicy, monthlyEosProvision, wageFor } from '../../hr/hr-policy';
import type { Budget, BudgetLine, TraceStep } from './budget.entity';
import type { BudgetVariable, Lever, RaiseRule } from './budget-defaults';
import { FormulaError, run } from './formula-engine';

/**
 * احتساب بنود الموازنة (دوال صافية بلا قاعدة بيانات):
 * الموارد البشرية شهرًا بشهر، والمصروفات والإيرادات من التاريخ الفعلي، والأنشطة من تكلفة الخطة.
 * كل نتيجة تُرجع مع خطوات الاحتساب (المعادلة وإصدارها والمتغيرات وقيمها ومصدرها).
 */

export const r2 = (n: number) => Math.round(n * 100) / 100;
const MONTHS = Array.from({ length: 12 }, (_, i) => i + 1);
export interface FormulaRef { code: string; version: number; expression: string; name: string }

export function formulaError(e: unknown, code: string): never {
  if (e instanceof FormulaError) throw new BadRequestException(`معادلة ${code}: ${e.message}`);
  throw e;
}

/** قيمة متغير في شهر: المتغير الخاص بالإدارة أولًا ثم العام، ومع القيم المرحلية حسب الشهر */
export function variableValue(v: BudgetVariable, month: number) {
  const step = [...(v.steps ?? [])].filter((s) => s.fromMonth <= month).sort((a, b) => b.fromMonth - a.fromMonth)[0];
  return step ? step.value : v.value;
}
export function varsFor(variables: BudgetVariable[], month: number, unitId: string | null): Record<string, number> {
  const out: Record<string, number> = {};
  for (const v of variables) if (!v.unitId) out[v.key] = variableValue(v, month);
  for (const v of variables) if (v.unitId && v.unitId === unitId) out[v.key] = variableValue(v, month);
  return out;
}

export interface HrParams {
  employeeNo?: number | null; jobTitle: string | null; gradeName: string | null; isSaudi: boolean; firstRegistration: string | null; hireDate: string | null;
  basic: number; housing: number; transport: number; other: number; rating: string | null; ratingScore: number | null;
  count: number; startMonth: number; endMonth: number; isNew: boolean; staffingPlanId?: string | null;
  /** قاعدة علاوة مختارة يدويًا (تتجاوز المطابقة الآلية) */
  raisePct?: number | null; raiseFromMonth?: number | null;
}

/** أدق قاعدة علاوة تنطبق على الموظف، أو العلاوة العامة من الافتراضات */
export function raiseFor(rules: RaiseRule[], p: HrParams, unitId: string | null, vars: Record<string, number>) {
  if (p.raisePct !== null && p.raisePct !== undefined) return { pct: p.raisePct, fromMonth: p.raiseFromMonth ?? 1, source: 'نسبة محددة للبند' };
  const ok = rules.filter((r) => (!p.isNew || r.appliesToNew)
    && (!r.match.unitId || r.match.unitId === unitId) && (!r.match.gradeName || r.match.gradeName === p.gradeName)
    && (!r.match.jobTitle || r.match.jobTitle === p.jobTitle) && (!r.match.rating || r.match.rating === p.rating)
    && (!r.match.nationality || (r.match.nationality === 'saudi') === p.isSaudi));
  const score = (r: RaiseRule) => ['unitId', 'gradeName', 'jobTitle', 'rating', 'nationality'].filter((k) => (r.match as Record<string, unknown>)[k]).length;
  ok.sort((a, b) => score(b) - score(a));
  if (ok[0]) return { pct: ok[0].pct, fromMonth: ok[0].fromMonth, source: `قاعدة «${ok[0].name}»` };
  if (p.isNew) return { pct: 0, fromMonth: 1, source: 'الوظيفة الجديدة تبدأ براتبها المتوقع' };
  return { pct: vars.general_raise ?? 0, fromMonth: Math.min(12, Math.max(1, Math.round(vars.raise_month ?? 1))), source: 'العلاوة العامة' };
}

const iso = (y: number, m: number) => `${y}-${String(m).padStart(2, '0')}-01`;
const yearsBetween = (from: string | null, to: string) => (from ? Math.max(0, (Date.parse(to) - Date.parse(from)) / (365.25 * 86400000)) : 0);

/** بند موارد بشرية: شهرًا بشهر بالمعادلة الشهرية، ثم التكاليف السنوية الإضافية موزعة على أشهر العمل */
export function computeHr(year: number, budget: Pick<Budget, 'variables' | 'raiseRules'>, line: Pick<BudgetLine, 'unitId' | 'params'>, policy: HrPolicy, monthlyF: FormulaRef, annualF: FormulaRef | null) {
  const p = line.params as unknown as HrParams;
  const count = Math.max(0, Number(p.count) || 0);
  const start = Math.min(12, Math.max(1, p.startMonth || 1)), end = Math.min(12, Math.max(start, p.endMonth || 12));
  const base = { basic: +p.basic || 0, housing: +p.housing || 0, transport: +p.transport || 0, others: +p.other || 0 };
  const trace: TraceStep[] = [];
  const warnings = new Set<string>();
  const monthly = MONTHS.map(() => 0);
  const v0 = varsFor(budget.variables, 1, line.unitId);
  const raise = raiseFor(budget.raiseRules, p, line.unitId, v0);
  const firstReg = p.isNew ? iso(year, start) : p.firstRegistration ?? p.hireDate;
  let sample: TraceStep | null = null;
  let lastRaised = base;
  for (const m of MONTHS) {
    if (m < start || m > end) continue;
    const vars = varsFor(budget.variables, m, line.unitId);
    const rr = m >= raise.fromMonth ? raise.pct / 100 : 0;
    const w = { basic: base.basic * (1 + rr), housing: base.housing * (1 + rr), transport: base.transport * (1 + rr), others: base.others * (1 + rr) };
    lastRaised = w;
    const date = iso(year, m);
    const g = gosi(policy, w, p.isSaudi, firstReg, date).employer.total;
    const sy = p.isNew ? (m - start) / 12 : yearsBetween(p.hireDate, date);
    const eos = monthlyEosProvision(policy, wageFor(policy.eos.wageBase, w), sy);
    const ctx = {
      ...vars, basic: base.basic, housing: base.housing, transport: base.transport, other: base.others, gross: base.basic + base.housing + base.transport + base.others,
      raise: rr, gosi: g, eos, month: m, is_saudi: p.isSaudi ? 1 : 0, service_years: r2(sy), is_new: p.isNew ? 1 : 0,
    };
    let res;
    try { res = run(monthlyF.expression, ctx); } catch (e) { formulaError(e, monthlyF.code); }
    res.warnings.forEach((x) => warnings.add(x));
    monthly[m - 1] = r2(res.value * count);
    if (!sample || (m === raise.fromMonth && rr)) {
      sample = { label: `التكلفة الشهرية (${m === raise.fromMonth && rr ? 'بعد العلاوة' : 'أول شهر'}) للموظف الواحد`, formula: monthlyF.expression, formulaCode: monthlyF.code, formulaVersion: monthlyF.version, vars: res.used, value: r2(res.value), source: 'بيانات الموظف من الموارد البشرية، والتأمينات ونهاية الخدمة حسب لائحة الموارد البشرية' };
      trace.push(sample);
    }
  }
  trace.unshift({ label: `العلاوة: ${raise.pct}% من شهر ${raise.fromMonth}`, value: raise.pct, source: raise.source });
  const months = Math.max(0, end - start + 1);
  if (annualF && months && count) {
    const vars = varsFor(budget.variables, 12, line.unitId);
    const ctx = {
      ...vars, basic: r2(lastRaised.basic), gross: r2(lastRaised.basic + lastRaised.housing + lastRaised.transport + lastRaised.others), active_months: months,
      is_saudi: p.isSaudi ? 1 : 0, is_new: p.isNew ? 1 : 0, rating_score: p.ratingScore ?? 0,
    };
    let res;
    try { res = run(annualF.expression, ctx); } catch (e) { formulaError(e, annualF.code); }
    res.warnings.forEach((x) => warnings.add(x));
    const extra = r2(res.value * count);
    trace.push({ label: 'التكاليف السنوية الإضافية (موزعة على أشهر العمل)', formula: annualF.expression, formulaCode: annualF.code, formulaVersion: annualF.version, vars: res.used, value: extra, source: 'افتراضات الموازنة' });
    for (let m = start; m <= end; m++) monthly[m - 1] = r2(monthly[m - 1] + extra / months);
  }
  if (count > 1) trace.push({ label: `عدد الوظائف ${count}`, value: count });
  const total = r2(monthly.reduce((s, x) => s + x, 0));
  trace.push({ label: 'إجمالي البند للسنة', value: total });
  return { auto: total, monthly, trace, warnings: [...warnings] };
}

export interface HistParams {
  method: 'formula' | 'manual' | 'zero'; formulaCode: string | null; years: number; avgType: 'mean' | 'weighted' | 'median' | 'last';
  annualizeCurrent: boolean; growth: number | null; volumeBase: number | null; volumeTarget: number | null;
  excludedEntryIds: string[]; adjustments: { year: number; amount: number; note: string }[];
  contracts: { name: string; amount: number; fromMonth: number; toMonth: number; kind: 'new' | 'ending' }[];
  distribution: 'even' | 'seasonal' | 'custom'; weights: number[]; manualAmount: number | null; vars: Record<string, number>;
}
export interface HistSnapshot {
  years: Record<string, number>; months: Record<string, number[]>; entries: { id: string; date: string; description: string; amount: number }[];
  currentYear: number; currentMonths: number; fetchedAt: string; source: string;
}

/** السنوات المعتمدة في التاريخ بعد الاستبعاد والتعديل، مع تحويل السنة الجارية لسنة كاملة إن طُلب */
export function historyYears(h: HistSnapshot, p: HistParams, fiscalYear: number) {
  const ex = new Set(p.excludedEntryIds ?? []);
  const ys = Object.keys(h.years ?? {}).map(Number).filter((y) => y < fiscalYear && !(y === h.currentYear && !h.currentMonths)).sort((a, b) => b - a).slice(0, Math.max(1, p.years || 3)).sort();
  return ys.map((y) => {
    const partial = y === h.currentYear && h.currentMonths > 0 && h.currentMonths < 12;
    const annualize = partial && p.annualizeCurrent;
    // السنة الجارية تُحوّل لسنة كاملة من أشهرها المكتملة فقط
    const inScope = (date: string) => date.slice(0, 4) === String(y) && (!annualize || Number(date.slice(5, 7)) <= h.currentMonths);
    const excluded = r2((h.entries ?? []).filter((e) => ex.has(e.id) && inScope(e.date)).reduce((s, e) => s + e.amount, 0));
    const raw = annualize ? r2((h.months?.[String(y)] ?? []).slice(0, h.currentMonths).reduce((s, x) => s + x, 0)) : h.years[String(y)] ?? 0;
    let v = raw - excluded + (p.adjustments ?? []).filter((a) => a.year === y).reduce((s, a) => s + a.amount, 0);
    if (annualize) v = (v / h.currentMonths) * 12;
    return { year: y, raw, excluded, value: r2(v), annualized: annualize, months: annualize ? h.currentMonths : 12 };
  });
}

export function average(vals: number[], t: HistParams['avgType']) {
  if (!vals.length) return 0;
  if (t === 'last') return vals[vals.length - 1];
  if (t === 'median') { const s = [...vals].sort((a, b) => a - b); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; }
  if (t === 'weighted') { const w = vals.map((_, i) => i + 1); return vals.reduce((s, v, i) => s + v * w[i], 0) / w.reduce((s, x) => s + x, 0); }
  return vals.reduce((s, v) => s + v, 0) / vals.length;
}

/** توزيع مبلغ سنوي على الأشهر: بالتساوي، أو بنمط الأشهر التاريخي، أو بأوزان يدخلها المستخدم */
export function distribute(total: number, how: HistParams['distribution'], weights: number[] | null, pattern: number[] | null, from = 1, to = 12) {
  let w: number[] = MONTHS.map((m) => (m >= from && m <= to ? 1 : 0));
  if (how === 'custom' && weights?.length === 12 && weights.some((x) => x > 0)) w = weights.map((x, i) => (i + 1 >= from && i + 1 <= to ? Math.max(0, +x || 0) : 0));
  if (how === 'seasonal' && pattern?.length === 12 && pattern.some((x) => x > 0)) w = pattern.map((x, i) => (i + 1 >= from && i + 1 <= to ? Math.max(0, x) : 0));
  const sw = w.reduce((s, x) => s + x, 0) || 1;
  const out = w.map((x) => r2((total * x) / sw));
  const diff = r2(total - out.reduce((s, x) => s + x, 0));
  const last = out.map((x, i) => (x ? i : -1)).filter((i) => i >= 0).pop() ?? 11;
  out[last] = r2(out[last] + diff);
  return out;
}

/** بند مصروف أو إيراد: تقدير من التاريخ بالمعادلة، ثم أثر العقود الجديدة والمنتهية، ثم التوزيع الشهري */
export function computeHist(fiscalYear: number, budget: Pick<Budget, 'variables'>, line: Pick<BudgetLine, 'unitId' | 'params' | 'history' | 'section'>, formula: FormulaRef | null) {
  const p = line.params as unknown as HistParams;
  const h = (line.history ?? {}) as unknown as HistSnapshot;
  const trace: TraceStep[] = [];
  const warnings = new Set<string>();
  const ys = historyYears(h, p, fiscalYear);
  const vals = ys.map((y) => y.value);
  const histAvg = r2(average(vals, p.avgType ?? 'mean'));
  const histLast = vals.length ? vals[vals.length - 1] : 0;
  const trend = vals.length > 1 && vals[0] > 0 ? (vals[vals.length - 1] / vals[0]) ** (1 / (vals.length - 1)) - 1 : 0;
  if (ys.length) {
    trace.push({
      label: `الفعلي التاريخي (${ys.map((y) => `${y.year}: ${y.value.toLocaleString('en-US')}${y.excluded ? ` بعد استبعاد ${y.excluded.toLocaleString('en-US')}` : ''}${y.annualized ? ` (أول ${y.months} أشهر محوّلة لسنة كاملة)` : ''}`).join('، ')})`,
      value: histAvg, source: h.source ?? 'النظام المحاسبي',
    });
  }
  // النمط الموسمي من السنوات المكتملة فقط (السنة الجارية الناقصة تشوه النمط)
  const full = Object.entries(h.months ?? {}).filter(([y]) => Number(y) !== h.currentYear || h.currentMonths >= 12).map(([, arr]) => arr);
  const pattern = full.length ? MONTHS.map((_, i) => full.reduce((s, arr) => s + Math.max(0, arr?.[i] ?? 0), 0)) : null;
  const seasonalFallback = !pattern && (p.distribution ?? 'even') === 'seasonal';
  let base = 0;
  if (p.method === 'zero') { base = 0; trace.push({ label: 'موازنة صفرية: لا يُرحّل التاريخ، والمبلغ من العقود والتعديلات', value: 0 }); }
  else if (p.method === 'manual') { base = +(p.manualAmount ?? 0) || 0; trace.push({ label: 'مبلغ محدد يدويًا', value: base }); }
  else {
    if (!formula) throw new BadRequestException('اختر معادلة التقدير للبند');
    const vars = varsFor(budget.variables, 1, line.unitId);
    const growthDefault = line.section === 'revenue' ? vars.revenue_growth ?? vars.growth ?? 0 : vars.growth ?? 0;
    const ctx = {
      ...vars, ...(p.vars ?? {}), hist_avg: histAvg, hist_last: histLast, hist_trend: r2(trend * 10000) / 10000,
      growth: p.growth ?? growthDefault,
      volume_ratio: p.volumeBase && p.volumeTarget ? p.volumeTarget / p.volumeBase : 1,
    };
    let res;
    try { res = run(formula.expression, ctx); } catch (e) { formulaError(e, formula.code); }
    res.warnings.forEach((x) => warnings.add(x));
    base = r2(res.value);
    trace.push({ label: formula.name, formula: formula.expression, formulaCode: formula.code, formulaVersion: formula.version, vars: res.used, value: base, source: p.growth !== null && p.growth !== undefined ? 'نسبة زيادة خاصة بالبند' : 'افتراضات الموازنة' });
    if (!ys.length) warnings.add('لا يوجد تاريخ فعلي لهذا البند: حدد المبلغ أو العقود يدويًا');
  }
  const monthly = distribute(base, p.distribution ?? 'even', p.weights ?? null, pattern);
  if (seasonalFallback && base) trace.push({ label: 'لا توجد سنة فعلية مكتملة لاستخراج النمط الموسمي، فوُزّع المبلغ على الأشهر بالتساوي', value: base });
  for (const c of p.contracts ?? []) {
    const from = Math.min(12, Math.max(1, c.fromMonth || 1)), to = Math.min(12, Math.max(from, c.toMonth || 12));
    const per = (+c.amount || 0) / 12;
    const sign = c.kind === 'ending' ? -1 : 1;
    for (let m = from; m <= to; m++) monthly[m - 1] = r2(monthly[m - 1] + sign * per);
    trace.push({ label: `${c.kind === 'ending' ? 'عقد ينتهي' : 'عقد جديد'}: ${c.name} (${to - from + 1} شهر)`, value: r2(sign * per * (to - from + 1)), source: 'مدخل في البند' });
  }
  const total = r2(monthly.reduce((s, x) => s + x, 0));
  if (total < 0) warnings.add('التقدير سالب بعد العقود المنتهية');
  trace.push({ label: 'التقدير الآلي للسنة', value: total });
  return { auto: total, monthly, trace, warnings: [...warnings] };
}

export interface ActivityParams { kind?: 'activity' | 'project'; planId: string; planCode: string; itemCode: string; startDate: string | null; endDate: string | null; cost: number; distribution: HistParams['distribution']; weights: number[] }

/** بند نشاط: تكلفة السنة من الخطة التشغيلية، موزعة على أشهر تنفيذ النشاط داخل السنة */
export function computeActivity(fiscalYear: number, line: Pick<BudgetLine, 'params'>) {
  const p = line.params as unknown as ActivityParams;
  const ys = `${fiscalYear}-01-01`, ye = `${fiscalYear}-12-31`;
  const from = p.startDate && p.startDate > ys ? Number(p.startDate.slice(5, 7)) : 1;
  const to = p.endDate && p.endDate < ye ? Number(p.endDate.slice(5, 7)) : 12;
  const monthly = distribute(+p.cost || 0, p.distribution ?? 'even', p.weights ?? null, null, from, Math.max(from, to));
  return {
    auto: r2(+p.cost || 0), monthly, warnings: [] as string[],
    trace: [p.kind === 'project'
      ? { label: `نصيب ${fiscalYear} من موازنة المشروع ${p.planCode} بالتناسب الزمني، موزع على أشهر التنفيذ (${from} إلى ${Math.max(from, to)})`, value: r2(+p.cost || 0), source: 'نظام إدارة المشاريع' }
      : { label: `تكلفة ${fiscalYear} في الخطة ${p.planCode} للعنصر ${p.itemCode}، موزعة على أشهر التنفيذ (${from} إلى ${Math.max(from, to)})`, value: r2(+p.cost || 0), source: 'الخطة التشغيلية المعتمدة' }] as TraceStep[],
  };
}

/** القيمة المعتمدة: المقترح من الإدارة إن وجد (ويُوزع بنفس نمط الآلي) وإلا الآلي */
export function finalize(auto: number, monthly: number[], override: number | null) {
  if (override === null || override === undefined) return { amount: r2(auto), monthly };
  const s = monthly.reduce((a, b) => a + b, 0);
  const out = s > 0 ? monthly.map((x) => r2((x * override) / s)) : distribute(override, 'even', null, null);
  const diff = r2(override - out.reduce((a, b) => a + b, 0));
  const last = out.map((x, i) => (x ? i : -1)).filter((i) => i >= 0).pop() ?? 11;
  out[last] = r2(out[last] + diff);
  return { amount: r2(override), monthly: out };
}

const MONTH_AR = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];

/** هل ينطبق المؤثر على البند: البنود المحددة بالاسم، وإلا الأقسام والإدارة ونوع التمويل والحساب */
export function leverMatches(l: Lever, line: Pick<BudgetLine, 'id' | 'baseLineId' | 'section' | 'unitId' | 'fundingType' | 'accountId'>) {
  const sc = l.scope;
  if (sc.lineIds?.length) return sc.lineIds.includes(line.id) || (!!line.baseLineId && sc.lineIds.includes(line.baseLineId));
  if (sc.sections?.length && !sc.sections.includes(line.section)) return false;
  if (sc.unitId && sc.unitId !== line.unitId) return false;
  if (sc.fundingType && sc.fundingType !== (line.fundingType ?? 'none')) return false;
  if (sc.accountId && sc.accountId !== line.accountId) return false;
  return true;
}

/**
 * تطبيق مؤثرات السيناريو على التوزيع الشهري بعد الاحتساب (وبعد تعديل الإدارة).
 * النسبة تسري من شهرها، والتأجيل يزيح التوزيع، وما يتجاوز ديسمبر يخرج من موازنة السنة.
 */
export function applyLevers(levers: Lever[], line: Pick<BudgetLine, 'id' | 'baseLineId' | 'section' | 'unitId' | 'fundingType' | 'accountId'>, monthly: number[]) {
  let m = [...monthly];
  const trace: TraceStep[] = [];
  for (const l of levers ?? []) {
    if (!leverMatches(l, line)) continue;
    const before = r2(m.reduce((a, b) => a + b, 0));
    if (l.type === 'pct') {
      const from = Math.min(12, Math.max(1, l.fromMonth || 1));
      const raw = m.map((x, i) => (i + 1 >= from ? x * (1 + l.value / 100) : x));
      m = raw.map(r2);
      // فرق التقريب يُضاف لآخر شهر فيه مبلغ حتى يطابق الإجمالي النسبة تمامًا
      const diff = r2(r2(raw.reduce((a, b) => a + b, 0)) - m.reduce((a, b) => a + b, 0));
      const last = m.map((x, i) => (x ? i : -1)).filter((i) => i >= 0).pop();
      if (diff && last !== undefined) m[last] = r2(m[last] + diff);
      const after = r2(m.reduce((a, b) => a + b, 0));
      trace.push({ label: `مؤثر السيناريو «${l.name}»: ${l.value > 0 ? '+' : ''}${l.value}%${from > 1 ? ` من ${MONTH_AR[from - 1]}` : ''}`, value: after, source: `الفرق ${r2(after - before).toLocaleString('en-US')}` });
    } else {
      const k = Math.min(11, Math.max(1, Math.round(l.value)));
      const out = Array.from({ length: 12 }, () => 0);
      m.forEach((x, i) => { if (i + k < 12) out[i + k] = r2(out[i + k] + x); });
      m = out;
      const after = r2(m.reduce((a, b) => a + b, 0));
      trace.push({ label: `مؤثر السيناريو «${l.name}»: تأجيل ${k} ${k > 2 ? 'أشهر' : k === 2 ? 'شهرين' : 'شهر'}`, value: after, source: before !== after ? `ينتقل للسنة التالية ${r2(before - after).toLocaleString('en-US')}` : null });
    }
  }
  return { monthly: m, amount: r2(m.reduce((a, b) => a + b, 0)), trace };
}
