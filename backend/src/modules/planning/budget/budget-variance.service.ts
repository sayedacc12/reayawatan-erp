import { BadRequestException, Injectable } from '@nestjs/common';
import ExcelJS from 'exceljs';
import { DataSource, In } from 'typeorm';
import { OrgUser } from '../../../core/auth/decorators';
import { Block, BoardDoc, DocColumn, DocRow, DocSection, nowStamp, Tone } from '../../../core/reports/board-doc';
import { DocBrand } from '../../../core/reports/doc-brand';
import { PlanItem } from '../entities/planning.entity';
import { PLANNING_PERMISSIONS as P } from '../planning.manifest';
import { r2 } from './budget-calc';
import { MONTHS_AR, SECTION_NAME } from './budget-defaults';
import { BudgetExecution, ExecRow } from './budget-execution.service';
import { Budget, BudgetLine } from './budget.entity';


export const VARIANCE_VIEWS = ['section', 'line', 'unit', 'costcenter', 'account', 'plan', 'month'] as const;
export type VarianceView = (typeof VARIANCE_VIEWS)[number];
export const VARIANCE_VIEW_NAME: Record<VarianceView, string> = {
  section: 'حسب أقسام الموازنة', line: 'حسب البند', unit: 'حسب الإدارة', costcenter: 'حسب مركز التكلفة', account: 'حسب الحساب في الدليل', plan: 'حسب الخطة التشغيلية والبرنامج', month: 'حسب الشهر',
};
export type VarSpan = 'M' | 'Q' | 'H' | 'Y';
export interface VarianceQuery { budgetId: string; span: VarSpan; part?: number; basis?: 'period' | 'ytd'; threshold?: number }

export const VAR_FORM = { code: 'QF-FIN-09', title: 'تقرير انحرافات الموازنة عن المخطط' };
type Status = 'favorable' | 'unfavorable' | 'within';
const STATUS_AR: Record<Status, string> = { favorable: 'انحراف إيجابي', unfavorable: 'انحراف سلبي', within: 'ضمن الحد' };
const STATUS_TONE: Record<Status, Tone> = { favorable: 'good', unfavorable: 'bad', within: 'neutral' };
const ORD = ['الأول', 'الثاني', 'الثالث', 'الرابع'];

interface Item { row: ExecRow; planned: number; actual: number; current: number; forecast: number; isRev: boolean; line: BudgetLine | null; accounts: string; plan: string; program: string; progress: number | null }
export interface VarGroup {
  key: string; label: string; section: string | null; kind: 'expense' | 'revenue';
  planned: number; actual: number; variance: number; variancePct: number | null; current: number; usedPct: number | null; forecast: number; forecastVariance: number;
  status: Status; statusName: string; count: number; progress: number | null;
}

/** الجمع بالهللات ثم التحويل، فلا تنحرف الإجماليات بكسور الأرقام العشرية */
const sum = (xs: number[]) => xs.reduce((t, x) => t + Math.round(x * 100), 0) / 100 + 0;

/**
 * تقرير انحرافات الموازنة: يربط بنود الموازنة التقديرية المعتمدة (وأنشطة الخطط التشغيلية التي بُنيت منها)
 * بالفعلي من القيود المرحّلة في النظام المالي، لأي فترة (شهر، ربع، نصف، سنة) أو من بداية السنة حتى نهايتها،
 * ويعرضه بعدة أشكال (أقسام، بنود، إدارات، مراكز تكلفة، حسابات، خطط وبرامج، أشهر) على الشاشة وفي PDF وExcel.
 * الانحراف = الفعلي − المخطط؛ وهو إيجابي في المصروفات إذا قل الصرف، وفي الإيرادات إذا زاد التحصيل.
 */
@Injectable()
export class BudgetVariance {
  constructor(private readonly db: DataSource, private readonly exec: BudgetExecution) {}

  private range(q: VarianceQuery) {
    const span = q.span;
    const size = span === 'M' ? 1 : span === 'Q' ? 3 : span === 'H' ? 6 : 12;
    const part = span === 'Y' ? 1 : q.part ?? 1;
    if (!Number.isInteger(part) || part < 1 || part > 12 / size) throw new BadRequestException('رقم الفترة خارج السنة');
    const m2 = part * size;
    const m1 = q.basis === 'ytd' ? 1 : m2 - size + 1;
    return { span, part, m1, m2 };
  }

  private label(year: number, span: VarSpan, part: number, m1: number, m2: number, basis: 'period' | 'ytd') {
    const base = span === 'Y' ? `السنة ${year}` : span === 'M' ? `${MONTHS_AR[part - 1]} ${year}` : span === 'Q' ? `الربع ${ORD[part - 1]} ${year}` : `النصف ${ORD[part - 1]} ${year}`;
    return basis === 'ytd' && m1 !== m2 && span !== 'Y' ? `${base} (من بداية السنة: ${MONTHS_AR[m1 - 1]} – ${MONTHS_AR[m2 - 1]})` : `${base}${m1 !== m2 ? ` (${MONTHS_AR[m1 - 1]} – ${MONTHS_AR[m2 - 1]})` : ''}`;
  }

  /** بيانات الموارد البشرية التفصيلية لصاحب صلاحيتها فقط؛ وغيره يرى قسم الموارد البشرية إجماليًا واحدًا */
  private canHr(actor: OrgUser) { return actor.isSuperadmin || actor.permissions.includes(P.budgetsHr); }

  /** الموازنات المعتمدة المتاحة للتقرير */
  async budgets(actor: OrgUser) {
    const bs = await this.db.getRepository(Budget).find({ where: { organizationId: actor.organizationId, isScenario: false }, order: { fiscalYear: 'DESC', code: 'ASC' }, select: ['id', 'code', 'title', 'fiscalYear', 'version', 'status'] });
    return bs.filter((b) => b.version >= 1).map((b) => ({ id: b.id, code: b.code, title: b.title, fiscalYear: b.fiscalYear, version: b.version }));
  }

  async build(actor: OrgUser, q: VarianceQuery) {
    const org = actor.organizationId;
    const b = await this.exec.approved(org, q.budgetId);
    const basis = q.basis === 'ytd' ? 'ytd' : 'period';
    const { span, part, m1, m2 } = this.range({ ...q, basis });
    const threshold = Math.min(100, Math.max(1, q.threshold ?? 10));
    const [end, before] = await Promise.all([
      this.exec.compute(org, b, { month: m2, threshold }),
      m1 > 1 ? this.exec.compute(org, b, { month: m1 - 1, threshold }) : Promise.resolve(null),
    ]);
    const lines = await this.db.getRepository(BudgetLine).find({ where: { budgetId: b.id, organizationId: org } });
    const lineById = new Map(lines.map((l) => [l.id, l]));
    // أسماء الحسابات المربوطة بالبنود
    const accIds = [...new Set(lines.flatMap((l) => (l.actualMap?.accountIds?.length ? l.actualMap.accountIds : l.accountId ? [l.accountId] : [])))];
    const accs: { id: string; code: string; name: string }[] = accIds.length
      ? await this.db.query('SELECT id, code, name FROM acc_accounts WHERE organization_id = $1 AND id = ANY($2)', [org, accIds]).catch(() => []) : [];
    const accName = new Map(accs.map((a) => [a.id, `${a.code} ${a.name}`]));
    // الأنشطة والبرامج من الخطط التشغيلية (بنود الأنشطة مصدرها عنصر في الخطة)
    const srcIds = [...new Set(lines.filter((l) => l.kind === 'activity' && l.sourceId).map((l) => l.sourceId!))];
    const items = srcIds.length ? await this.db.getRepository(PlanItem).find({ where: { organizationId: org, id: In(srcIds) } }) : [];
    const parents = new Map<string, PlanItem>();
    let frontier = [...new Set(items.map((i) => i.parentId).filter(Boolean) as string[])];
    for (let depth = 0; frontier.length && depth < 8; depth++) {
      const ps = await this.db.getRepository(PlanItem).find({ where: { organizationId: org, id: In(frontier) } });
      ps.forEach((x) => parents.set(x.id, x));
      frontier = [...new Set(ps.map((x) => x.parentId).filter((x): x is string => !!x && !parents.has(x)))];
    }
    const planIds = [...new Set(items.map((i) => i.planId))];
    const plans: { id: string; code: string; title: string }[] = planIds.length ? await this.db.query('SELECT id, code, title FROM plan_plans WHERE organization_id = $1 AND id = ANY($2)', [org, planIds]) : [];
    const planName = new Map(plans.map((p) => [p.id, `${p.code} ${p.title}`]));
    const itemById = new Map(items.map((i) => [i.id, i]));
    const topOf = (i: PlanItem) => { let x = i; for (let d = 0; d < 10 && x.parentId && parents.has(x.parentId); d++) x = parents.get(x.parentId)!; return x; };

    const hr = this.canHr(actor);
    const beforeOf = new Map((before?.rows ?? []).map((r) => [r.key, r]));
    const span12 = (a: number[]) => sum(a.slice(m1 - 1, m2));
    let rows = end.rows;
    if (!hr) {
      const hrRows = rows.filter((r) => r.section === 'hr');
      if (hrRows.length) {
        const merged: ExecRow = { ...hrRows[0], key: 'hr:all', name: 'الموارد البشرية (إجمالي القسم)', kind: 'hr_group', unitName: null, ref: null, lineIds: hrRows.flatMap((r) => r.lineIds),
          planned: Array.from({ length: 12 }, (_, i) => sum(hrRows.map((r) => r.planned[i]))), actualByMonth: Array.from({ length: 12 }, (_, i) => sum(hrRows.map((r) => r.actualByMonth[i]))),
          current: sum(hrRows.map((r) => r.current)), actual: sum(hrRows.map((r) => r.actual)), forecast: sum(hrRows.map((r) => r.forecast)), consumed: sum(hrRows.map((r) => r.consumed)),
          actualSource: hrRows.every((r) => r.actualSource === 'commitments') ? 'commitments' : 'account' };
        const mergedBefore = before ? before.rows.filter((r) => r.section === 'hr').reduce((t, r) => t + r.actual, 0) : 0;
        beforeOf.set('hr:all', { ...merged, actual: r2(mergedBefore) });
        rows = [merged, ...rows.filter((r) => r.section !== 'hr')];
      }
    }
    const notes: string[] = [];
    const its: Item[] = rows.map((r) => {
      const planned = span12(r.planned);
      // الفعلي من القيود شهريًا؛ وما لا حساب له فعليه من الحجوزات المصروفة (تراكمي، فيُطرح ما قبل الفترة)
      const actual = r.actualSource === 'commitments' ? r2(r.actual - (m1 > 1 ? beforeOf.get(r.key)?.actual ?? 0 : 0)) : span12(r.actualByMonth);
      const l = r.lineIds.length === 1 ? lineById.get(r.lineIds[0]) ?? null : null;
      const ids = l ? (l.actualMap?.accountIds?.length ? l.actualMap.accountIds : l.accountId ? [l.accountId] : []) : [];
      const item = l?.sourceId ? itemById.get(l.sourceId) : undefined;
      const top = item ? topOf(item) : undefined;
      return {
        row: r, planned, actual, current: r.current, forecast: r.forecast, isRev: r.section === 'revenue', line: l,
        accounts: r.key === 'hr:group' || r.key === 'hr:all' ? 'حسابات الرواتب' : ids.length ? ids.map((id) => accName.get(id) ?? '—').join('، ') : 'بلا حساب مربوط',
        plan: item ? planName.get(item.planId) ?? 'خطة تشغيلية' : 'خارج الخطط التشغيلية',
        program: item ? (top && top.id !== item.id ? `${top.code} ${top.title}` : `${item.code} ${item.title}`) : r.sectionName,
        progress: item ? item.progress : null,
      };
    });
    if (its.some((i) => i.row.actualSource === 'commitments')) notes.push('البنود التي لا يربطها حساب في الدليل يُحتسب فعليها من الحجوزات المصروفة في الأنظمة الأخرى.');
    if (!hr && rows.some((r) => r.key === 'hr:all')) notes.push('قسم الموارد البشرية يظهر إجماليًا لأن تفاصيل الرواتب خارج صلاحيتك.');

    const group = (key: string, label: string, xs: Item[], section: string | null): VarGroup => {
      const isRev = xs.every((x) => x.isRev);
      const planned = sum(xs.map((x) => x.planned)), actual = sum(xs.map((x) => x.actual)), current = sum(xs.map((x) => x.current)), forecast = sum(xs.map((x) => x.forecast));
      const variance = r2(actual - planned);
      const variancePct = planned ? r2((variance / planned) * 100) : null;
      const over = variancePct === null ? (variance !== 0 ? 100 : 0) : Math.abs(variancePct);
      const good = isRev ? variance > 0 : variance < 0;
      const status: Status = over <= threshold ? 'within' : good ? 'favorable' : 'unfavorable';
      const ws = xs.filter((x) => x.progress !== null);
      return {
        key, label, section, kind: isRev ? 'revenue' : 'expense', planned, actual, variance, variancePct, current, usedPct: current ? r2((sum(xs.map((x) => x.row.actual)) / current) * 100) : null,
        forecast, forecastVariance: r2(forecast - current), status, statusName: STATUS_AR[status], count: xs.length,
        progress: ws.length ? r2(ws.reduce((t, x) => t + (x.progress ?? 0), 0) / ws.length) : null,
      };
    };
    const by = (f: (i: Item) => string, withSection = true) => {
      const out: VarGroup[] = [];
      for (const kind of ['expense', 'revenue'] as const) {
        const xs = its.filter((i) => (kind === 'revenue') === i.isRev);
        const m = new Map<string, Item[]>();
        for (const i of xs) m.set(f(i), [...(m.get(f(i)) ?? []), i]);
        for (const [k, g] of m) out.push(group(`${kind}:${k}`, k, g, withSection ? (kind === 'revenue' ? SECTION_NAME.revenue : 'المصروفات') : null));
      }
      return out;
    };
    const views: Record<Exclude<VarianceView, 'month'>, VarGroup[]> = {
      section: by((i) => i.row.sectionName),
      line: its.map((i) => group(i.row.key, i.row.name, [i], i.row.sectionName)),
      unit: by((i) => i.row.unitName ?? i.line?.unitName ?? 'على مستوى الشركة'),
      costcenter: by((i) => i.line?.costCenterName ?? 'بلا مركز تكلفة'),
      account: by((i) => i.accounts),
      plan: by((i) => (i.isRev ? 'الإيرادات' : `${i.plan} · ${i.program}`)),
    };
    const months = Array.from({ length: m2 - m1 + 1 }, (_, k) => m1 + k).map((m) => {
      const e = { planned: end.byMonth.planned[m - 1], actual: end.byMonth.actual[m - 1] };
      const rv = { planned: end.byMonth.revPlanned[m - 1], actual: end.byMonth.revActual[m - 1] };
      return { month: m, name: MONTHS_AR[m - 1], expPlanned: e.planned, expActual: e.actual, expVariance: r2(e.actual - e.planned), revPlanned: rv.planned, revActual: rv.actual, revVariance: r2(rv.actual - rv.planned), net: r2(rv.actual - e.actual) };
    });
    const totals = (kind: 'expense' | 'revenue') => group(kind, kind === 'revenue' ? 'إجمالي الإيرادات' : 'إجمالي المصروفات', its.filter((i) => (kind === 'revenue') === i.isRev), null);
    const exp = totals('expense'), rev = totals('revenue');
    // الصرف خارج الموازنة في الفترة: الفعلي حتى نهايتها ناقصًا ما قبلها
    const outsideBefore = new Map((before?.outside ?? []).map((o) => [o.accountId, o.actual]));
    const outside = end.outside.map((o) => ({ ...o, actual: r2(o.actual - (outsideBefore.get(o.accountId) ?? 0)) })).filter((o) => o.actual !== 0);
    const top = views.line.filter((g) => g.status === 'unfavorable').sort((a, c) => Math.abs(c.variance) - Math.abs(a.variance)).slice(0, 10);
    return {
      budget: { id: b.id, code: b.code, title: b.title, fiscalYear: b.fiscalYear, version: b.version },
      period: { span, part, basis, m1, m2, label: this.label(b.fiscalYear, span, part, m1, m2, basis) },
      threshold, totals: { expenses: exp, revenues: rev, netPlanned: r2(rev.planned - exp.planned), netActual: r2(rev.actual - exp.actual) },
      views, months, outside, top, notes, hrMasked: !hr,
    };
  }

  // ---------------- الأشكال: وثيقة PDF وملف Excel ----------------

  doc(v: Awaited<ReturnType<BudgetVariance['build']>>, brand: DocBrand, actorName: string): BoardDoc {
    const money = (key: string, label: string): DocColumn => ({ key, label, type: 'money', paren: true });
    const cols = (first: string): DocColumn[] => [
      { key: 'label', label: first }, money('planned', 'المخطط'), money('actual', 'الفعلي'), money('variance', 'الانحراف'), { key: 'variancePct', label: 'النسبة', type: 'percent' },
      money('current', 'الموازنة المعدلة للسنة'), { key: 'usedPct', label: 'المستهلك', type: 'percent' }, { key: 'statusName', label: 'التقييم' },
    ];
    const rows = (gs: VarGroup[]): DocRow[] => gs.map((g) => ({ ...g, _tone: STATUS_TONE[g.status] }));
    const split = (gs: VarGroup[], title: string): Block[] => {
      const e = gs.filter((g) => g.kind === 'expense'), r = gs.filter((g) => g.kind === 'revenue');
      return [
        ...(e.length ? [{ t: 'h' as const, text: 'المصروفات' }, { t: 'table' as const, small: true, columns: cols(title), rows: rows(e), totals: { planned: v.totals.expenses.planned, actual: v.totals.expenses.actual, variance: v.totals.expenses.variance, current: v.totals.expenses.current } }] : []),
        ...(r.length ? [{ t: 'h' as const, text: 'الإيرادات' }, { t: 'table' as const, small: true, columns: cols(title), rows: rows(r), totals: { planned: v.totals.revenues.planned, actual: v.totals.revenues.actual, variance: v.totals.revenues.variance, current: v.totals.revenues.current } }] : []),
      ];
    };
    const e = v.totals.expenses, r = v.totals.revenues;
    const sections: DocSection[] = [
      { title: 'الملخص التنفيذي', lead: `${v.budget.code} ${v.budget.title} · ${v.period.label} · حد الانحراف المقبول ${v.threshold}%`, blocks: [
        { t: 'cards', items: [
          { label: 'المصروفات المخططة', value: e.planned, type: 'money' }, { label: 'المصروفات الفعلية', value: e.actual, type: 'money', tone: STATUS_TONE[e.status] },
          { label: 'انحراف المصروفات', value: e.variance, type: 'money', tone: STATUS_TONE[e.status], hint: e.variancePct === null ? undefined : `${e.variancePct}%` },
          { label: 'الإيرادات المخططة', value: r.planned, type: 'money' }, { label: 'الإيرادات الفعلية', value: r.actual, type: 'money', tone: STATUS_TONE[r.status] },
          { label: 'صافي الفعلي (إيرادات − مصروفات)', value: v.totals.netActual, type: 'money', hint: `المخطط ${Math.round(v.totals.netPlanned).toLocaleString('en-US')}` },
        ] },
        { t: 'bars', valueLabel: 'الفعلي من المخطط', items: v.views.section.map((g) => ({ label: g.label, value: g.planned ? Math.min(100, (g.actual / g.planned) * 100) : null, text: g.planned ? `${Math.round((g.actual / g.planned) * 100)}%` : '—', tone: STATUS_TONE[g.status] })) },
        { t: 'h', text: 'أكبر الانحرافات السلبية' },
        { t: 'table', small: true, empty: 'لا توجد انحرافات سلبية تتجاوز الحد', columns: cols('البند'), rows: rows(v.top) },
        { t: 'list', items: v.notes },
      ] },
      { title: VARIANCE_VIEW_NAME.section, blocks: split(v.views.section, 'القسم') },
      { title: VARIANCE_VIEW_NAME.unit, blocks: split(v.views.unit, 'الإدارة') },
      { title: VARIANCE_VIEW_NAME.plan, lead: 'الأنشطة المرتبطة بالخطط التشغيلية مع متوسط نسبة الإنجاز مقابل الصرف', blocks: [
        { t: 'table', small: true, columns: [...cols('الخطة · البرنامج').slice(0, 5), { key: 'progress', label: 'الإنجاز', type: 'percent' }, { key: 'statusName', label: 'التقييم' }], rows: rows(v.views.plan.filter((g) => g.kind === 'expense')) },
      ] },
      { title: VARIANCE_VIEW_NAME.costcenter, blocks: split(v.views.costcenter, 'مركز التكلفة') },
      { title: VARIANCE_VIEW_NAME.account, blocks: split(v.views.account, 'الحساب') },
      { title: VARIANCE_VIEW_NAME.line, blocks: split(v.views.line, 'البند') },
      { title: VARIANCE_VIEW_NAME.month, blocks: [
        { t: 'columns', labels: v.months.map((m) => m.name), series: [{ name: 'المصروفات المخططة', values: v.months.map((m) => m.expPlanned), tone: 'neutral' }, { name: 'المصروفات الفعلية', values: v.months.map((m) => m.expActual), tone: 'warn' }, { name: 'الإيرادات الفعلية', values: v.months.map((m) => m.revActual), tone: 'good' }] },
        { t: 'table', small: true, columns: [{ key: 'name', label: 'الشهر' }, money('expPlanned', 'مصروفات مخططة'), money('expActual', 'مصروفات فعلية'), money('expVariance', 'انحراف المصروفات'), money('revPlanned', 'إيرادات مخططة'), money('revActual', 'إيرادات فعلية'), money('revVariance', 'انحراف الإيرادات'), money('net', 'الصافي الفعلي')], rows: v.months },
      ] },
      { title: 'صرف خارج الموازنة', lead: 'حسابات عليها حركة في الفترة ولا يقابلها بند في الموازنة', blocks: [
        { t: 'table', small: true, empty: 'لا يوجد صرف خارج الموازنة في الفترة', columns: [{ key: 'code', label: 'رقم الحساب' }, { key: 'name', label: 'الحساب' }, { key: 'natureName', label: 'النوع' }, money('actual', 'الفعلي')],
          rows: v.outside.map((o) => ({ ...o, natureName: o.nature === 'revenue' ? 'إيراد' : 'مصروف' })) },
      ] },
    ];
    const docNo = `${VAR_FORM.code}/${v.budget.code}-${v.period.span}${v.period.part}${v.period.basis === 'ytd' ? '-YTD' : ''}`;
    return {
      formCode: VAR_FORM.code, docNo, kindLabel: 'تقرير تقييم دوري', title: VAR_FORM.title, subject: `${v.budget.code} ${v.budget.title}`, period: v.period.label,
      audience: 'الإدارة التنفيذية ومجلس المديرين', ...brand,
      control: [{ label: 'رمز النموذج', value: VAR_FORM.code }, { label: 'رقم الوثيقة', value: docNo }, { label: 'الموازنة', value: `${v.budget.code} (الإصدار ${v.budget.version})` }, { label: 'الفترة', value: v.period.label },
        { label: 'حد الانحراف', value: v.threshold, type: 'percent' }, { label: 'مصدر الفعلي', value: 'القيود المرحّلة في النظام المالي' }, { label: 'أُعد بواسطة', value: actorName }, { label: 'تاريخ الإصدار', value: nowStamp() }],
      sections, generatedBy: actorName, generatedAt: nowStamp(), classification: 'سري، للاستخدام الداخلي', issuer: 'صادر من النظام المالي ونظام التخطيط والموازنات',
    };
  }

  async xlsx(v: Awaited<ReturnType<BudgetVariance['build']>>, orgName: string): Promise<Buffer> {
    const wb = new ExcelJS.Workbook();
    wb.creator = orgName;
    wb.created = new Date();
    const head = ['البيان', 'النوع', 'المخطط', 'الفعلي', 'الانحراف', 'نسبة الانحراف %', 'الموازنة المعدلة للسنة', 'المستهلك %', 'التوقع لنهاية السنة', 'التقييم', 'الإنجاز %'];
    const sheet = (name: string, gs: VarGroup[]) => {
      const ws = wb.addWorksheet(name.slice(0, 31), { views: [{ rightToLeft: true, state: 'frozen', ySplit: 3 }] });
      ws.addRow([`${v.budget.code} ${v.budget.title} · ${v.period.label}`]).font = { bold: true, size: 12 };
      ws.addRow([`${VARIANCE_VIEW_NAME[name as VarianceView] ?? name} · حد الانحراف ${v.threshold}%`]).font = { color: { argb: 'FF64748B' } };
      const h = ws.addRow(head);
      h.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      h.eachCell((c) => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF164E38' } }; });
      for (const g of gs) {
        ws.addRow([g.label, g.kind === 'revenue' ? 'إيراد' : 'مصروف', g.planned, g.actual, g.variance, g.variancePct, g.current, g.usedPct, g.forecast, g.statusName, g.progress]);
      }
      [3, 4, 5, 7, 9].forEach((i) => { ws.getColumn(i).numFmt = '#,##0.00;[Red](#,##0.00)'; });
      ws.getColumn(1).width = 48;
      for (let i = 2; i <= head.length; i++) ws.getColumn(i).width = 16;
    };
    sheet('الملخص', [v.totals.expenses, v.totals.revenues, ...v.top]);
    for (const k of ['section', 'unit', 'plan', 'costcenter', 'account', 'line'] as const) sheet(k, v.views[k]);
    const ms = wb.addWorksheet('month', { views: [{ rightToLeft: true }] });
    ms.addRow(['الشهر', 'مصروفات مخططة', 'مصروفات فعلية', 'انحراف المصروفات', 'إيرادات مخططة', 'إيرادات فعلية', 'انحراف الإيرادات', 'الصافي الفعلي']).font = { bold: true };
    for (const m of v.months) ms.addRow([m.name, m.expPlanned, m.expActual, m.expVariance, m.revPlanned, m.revActual, m.revVariance, m.net]);
    ms.getColumn(1).width = 14;
    const os = wb.addWorksheet('outside', { views: [{ rightToLeft: true }] });
    os.addRow(['رقم الحساب', 'الحساب', 'النوع', 'الفعلي']).font = { bold: true };
    for (const o of v.outside) os.addRow([o.code, o.name, o.nature === 'revenue' ? 'إيراد' : 'مصروف', o.actual]);
    // أسماء الأوراق بالعربية (تبقى الرموز اللاتينية ثابتة للاستخدام البرمجي في أول التحميل)
    const AR: Record<string, string> = { section: 'الأقسام', unit: 'الإدارات', plan: 'الخطط والبرامج', costcenter: 'مراكز التكلفة', account: 'الحسابات', line: 'البنود', month: 'الأشهر', outside: 'خارج الموازنة' };
    wb.worksheets.forEach((ws) => { if (AR[ws.name]) ws.name = AR[ws.name]; });
    // الخلايا النصية التي تبدأ بعلامة معادلة تبقى نصًا
    wb.worksheets.forEach((ws) => ws.eachRow((row) => row.eachCell((c) => { if (typeof c.value === 'string' && /^[=+\-@]/.test(c.value)) c.value = `'${c.value}`; })));
    return Buffer.from(await wb.xlsx.writeBuffer());
  }
}

