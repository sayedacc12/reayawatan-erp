import { BadRequestException, Injectable, OnModuleInit } from '@nestjs/common';
import { ar, dynamicFilter, org, selectFilter } from '../../../core/reports/report-helpers';
import { ReportDefinition, ReportRow } from '../../../core/reports/report.types';
import { ReportsRegistry } from '../../../core/reports/reports.registry';
import { PLANNING_PERMISSIONS as P } from '../planning.manifest';
import { BudgetAvailability } from './budget-availability.service';
import { HrParams } from './budget-calc';
import { MONTHS_AR, SECTION_NAME } from './budget-defaults';
import { BudgetsService } from './budgets.service';
import { FormulasService } from './formulas.service';

const WF: Record<string, string> = { draft: 'مسودة', in_review: 'قيد الاعتماد', returned: 'مُرجعة للتعديل', approved: 'معتمدة', rejected: 'مرفوضة' };
const FUNDING: Record<string, string> = { restricted: 'مقيد', unrestricted: 'غير مقيد', mixed: 'مختلط' };
const TARGET: Record<string, string> = { hr_monthly: 'رواتب (شهرية)', hr_annual: 'رواتب (سنوية)', opex: 'مصروفات', revenue: 'إيرادات', any: 'عامة' };
const STATUS: Record<string, string> = { active: 'فعالة', draft: 'تحت التجربة', archived: 'موقوفة' };
const KIND: Record<string, string> = {
  employee: 'موظف حالي', employee_group: 'موظفون حاليون', new_position: 'وظيفة جديدة', hr_other: 'مصروف موارد بشرية', account: 'حساب', activity: 'نشاط', project: 'مشروع', manual: 'بند يدوي',
};
const MONTH_COLS = MONTHS_AR.map((label, i) => ({ key: `m${i + 1}`, label, type: 'money' as const, total: true }));

/** تقارير الموازنات التقديرية (من نفس بيانات الشاشة) */
@Injectable()
export class BudgetReports implements OnModuleInit {
  constructor(
    private readonly registry: ReportsRegistry, private readonly budgets: BudgetsService,
    private readonly formulas: FormulasService, private readonly avail: BudgetAvailability,
  ) {}

  onModuleInit() {
    const base = { module: 'planning', permission: [P.reports, P.budgets] };
    const options = async (u: Parameters<ReportDefinition['run']>[0]) => (await this.budgets.list(org(u), {}))
      .map((b) => ({ value: b.id, label: `${b.code} ${b.title} (${ar(WF, b.status)}${b.version ? `، الإصدار ${b.version}` : ''})` }));
    const budgetFilter = dynamicFilter('budgetId', 'الموازنة', options, 'اختر الموازنة', true);
    const load = async (u: Parameters<ReportDefinition['run']>[0], id?: string) => {
      if (!id) throw new BadRequestException('اختر الموازنة');
      return this.budgets.get(org(u), id);
    };
    type Line = { id: string; section: string; kind: string; name: string; unitName: string | null; accountCode: string | null; costCenterName: string | null; fundingType: string | null; methodology: string; auto: number; amount: number; monthly: number[]; included: boolean; overrideNote?: string | null; note?: string | null; params: Record<string, unknown>; trace: { label: string }[] };
    const subtitle = (b: Awaited<ReturnType<BudgetsService['get']>>) => `${b.code} ${b.title} · السنة المالية ${b.fiscalYear} · ${ar(WF, b.status)}${b.version ? ` · الإصدار ${b.version}` : ''}`;

    const defs: ReportDefinition[] = [
      {
        ...base, code: 'planning.budget.lines', category: 'الموازنات', title: 'الموازنة التقديرية الشاملة', orientation: 'landscape',
        description: 'بنود الموازنة بأقسامها: التقدير الآلي والمعتمد والفرق، والإدارة والحساب ونوع التمويل وأساس الاحتساب',
        filters: [budgetFilter, selectFilter('section', 'القسم', SECTION_NAME)],
        columns: [
          { key: 'section', label: 'القسم' }, { key: 'name', label: 'البند' }, { key: 'kind', label: 'النوع' }, { key: 'unitName', label: 'الإدارة' }, { key: 'accountCode', label: 'الحساب' },
          { key: 'funding', label: 'التمويل' }, { key: 'auto', label: 'التقدير الآلي', type: 'money', total: true }, { key: 'amount', label: 'المعتمد', type: 'money', total: true },
          { key: 'diff', label: 'الفرق', type: 'money', total: true }, { key: 'basis', label: 'أساس الاحتساب' },
        ],
        run: async (u, f) => {
          const b = await load(u, f.budgetId);
          const lines = (b.lines as unknown as Line[]).filter((l) => l.included && (!f.section || l.section === f.section));
          const rows: ReportRow[] = lines.map((l) => ({
            section: ar(SECTION_NAME, l.section), name: l.name, kind: ar(KIND, l.kind), unitName: l.unitName ?? 'الجمعية', accountCode: l.accountCode, funding: ar(FUNDING, l.fundingType),
            auto: l.auto, amount: l.amount, diff: Math.round((l.amount - l.auto) * 100) / 100,
            basis: l.overrideNote ? `معدّل: ${l.overrideNote}` : l.trace.filter((t) => !t.label.startsWith('إجمالي') && !t.label.startsWith('التقدير الآلي')).map((t) => t.label).slice(0, 2).join(' · '),
          }));
          const s = b.summary;
          return {
            rows, subtitle: subtitle(b),
            summary: [
              { label: 'إجمالي المصروفات', value: s.expenses, type: 'money' }, { label: 'الإيرادات المتوقعة', value: s.revenues, type: 'money' },
              { label: 'الفائض أو العجز', value: s.balance, type: 'money' }, { label: 'الموازنة الرأسمالية (من نظام الأصول)', value: s.capital, type: 'money' },
            ],
          };
        },
      },
      {
        ...base, code: 'planning.budget.hr', category: 'الموازنات', title: 'موازنة الموارد البشرية', orientation: 'landscape', permissionsAll: [P.budgetsHr],
        description: 'تكلفة كل موظف ووظيفة جديدة: الراتب والعدد وأشهر العمل والعلاوة والتكلفة السنوية',
        filters: [budgetFilter],
        columns: [
          { key: 'name', label: 'الموظف أو الوظيفة' }, { key: 'kind', label: 'النوع' }, { key: 'jobTitle', label: 'المسمى' }, { key: 'unitName', label: 'الإدارة' },
          { key: 'gross', label: 'إجمالي الراتب الحالي', type: 'money' }, { key: 'count', label: 'العدد', type: 'number', total: true }, { key: 'months', label: 'أشهر العمل' },
          { key: 'raise', label: 'العلاوة' }, { key: 'amount', label: 'التكلفة السنوية', type: 'money', total: true },
        ],
        run: async (u, f) => {
          const b = await load(u, f.budgetId);
          const lines = (b.lines as unknown as Line[]).filter((l) => l.included && l.section === 'hr');
          return {
            subtitle: subtitle(b),
            rows: lines.map((l) => {
              const p = l.params as unknown as HrParams;
              const hr = l.kind === 'employee' || l.kind === 'new_position';
              return {
                name: l.name, kind: ar(KIND, l.kind), jobTitle: hr ? p.jobTitle : null, unitName: l.unitName, gross: hr ? (p.basic || 0) + (p.housing || 0) + (p.transport || 0) + (p.other || 0) : null,
                count: hr ? p.count : null, months: hr ? `${p.startMonth} - ${p.endMonth}` : null, raise: hr ? l.trace[0]?.label.replace('العلاوة: ', '') : null, amount: l.amount,
              };
            }),
          };
        },
      },
      {
        ...base, code: 'planning.budget.monthly', category: 'الموازنات', title: 'التوزيع الشهري للموازنة', orientation: 'landscape',
        description: 'المصروفات والإيرادات المتوقعة لكل شهر (للتدفق النقدي)، حسب القسم',
        filters: [budgetFilter],
        columns: [{ key: 'section', label: 'القسم' }, ...MONTH_COLS, { key: 'total', label: 'الإجمالي', type: 'money', total: true }],
        run: async (u, f) => {
          const b = await load(u, f.budgetId);
          const lines = (b.lines as unknown as Line[]).filter((l) => l.included);
          const rows: ReportRow[] = (['hr', 'opex', 'activity', 'revenue'] as const).map((s) => {
            const ls = lines.filter((l) => l.section === s);
            const m = Array.from({ length: 12 }, (_, i) => Math.round(ls.reduce((t, l) => t + (l.monthly[i] ?? 0), 0) * 100) / 100);
            return { section: SECTION_NAME[s], ...Object.fromEntries(m.map((v, i) => [`m${i + 1}`, v])), total: Math.round(m.reduce((t, v) => t + v, 0) * 100) / 100, _skipTotal: s === 'revenue' };
          });
          const net = b.summary.byMonth.revenues.map((r, i) => Math.round((r - b.summary.byMonth.expenses[i]) * 100) / 100);
          rows.push({ section: 'صافي الشهر (الإيرادات - المصروفات)', ...Object.fromEntries(net.map((v, i) => [`m${i + 1}`, v])), total: b.summary.balance, _skipTotal: true, _style: 'strong' });
          return { rows, subtitle: `${subtitle(b)} · الإجمالي للمصروفات فقط` };
        },
      },
      {
        ...base, code: 'planning.budget.ceilings', category: 'الموازنات', title: 'طلبات الإدارات مقابل السقوف',
        description: 'ما تطلبه كل إدارة (من الأسفل) مقابل السقف المحدد لها (من الأعلى) والتجاوز',
        filters: [budgetFilter],
        columns: [
          { key: 'unitName', label: 'الإدارة' }, { key: 'hr', label: 'الموارد البشرية', type: 'money', total: true }, { key: 'opex', label: 'المصروفات التشغيلية', type: 'money', total: true },
          { key: 'activity', label: 'الأنشطة والمشاريع', type: 'money', total: true }, { key: 'total', label: 'الإجمالي', type: 'money', total: true },
          { key: 'ceiling', label: 'السقف', type: 'money' }, { key: 'over', label: 'التجاوز', type: 'money' },
        ],
        run: async (u, f) => {
          const b = await load(u, f.budgetId);
          return { subtitle: subtitle(b), rows: b.summary.byUnit.map((x) => ({ ...x, over: x.over !== null && x.over > 0 ? x.over : null })) };
        },
      },
      {
        ...base, code: 'planning.budget.formulas', category: 'الموازنات', title: 'سجل المعادلات وإصداراتها',
        description: 'معادلات الموازنة: الصيغة الحالية وإصدارها وحالتها ومن عدّلها، وعدد الموازنات التي تستخدمها',
        permission: [P.reports, P.formulas],
        columns: [
          { key: 'code', label: 'الرمز' }, { key: 'name', label: 'المعادلة' }, { key: 'target', label: 'الاستخدام' }, { key: 'expression', label: 'الصيغة' },
          { key: 'version', label: 'الإصدار', type: 'number' }, { key: 'status', label: 'الحالة' }, { key: 'budgets', label: 'الموازنات', type: 'number' }, { key: 'updatedByName', label: 'آخر تعديل' },
        ],
        run: async (u) => (await this.formulas.list(org(u))).formulas.map((x) => ({
          code: x.code, name: x.name, target: ar(TARGET, x.target), expression: x.expression, version: x.version, status: ar(STATUS, x.status), budgets: x.budgets, updatedByName: x.updatedByName,
        })),
      },
      {
        ...base, code: 'planning.budget.availability', category: 'الموازنات', title: 'المتاح للصرف في بنود الموازنة',
        description: 'لكل بند في الموازنة المعتمدة: المعتمد والمحجوز والمصروف والمتاح (للتعميد عند عدم وجود مصدر تمويل)',
        filters: [{ key: 'year', label: 'السنة المالية', type: 'year', default: 'currentYear' }],
        columns: [
          { key: 'name', label: 'البند' }, { key: 'section', label: 'القسم' }, { key: 'unitName', label: 'الإدارة' }, { key: 'budgeted', label: 'المعتمد', type: 'money', total: true },
          { key: 'reserved', label: 'المحجوز', type: 'money', total: true }, { key: 'consumed', label: 'المصروف', type: 'money', total: true }, { key: 'available', label: 'المتاح', type: 'money', total: true },
        ],
        run: async (u, f) => {
          const y = f.year && /^\d{4}$/.test(f.year) ? Number(f.year) : new Date().getFullYear();
          const r = await this.avail.lines(org(u).organizationId, y);
          return {
            subtitle: r.budget ? `${r.budget.code} ${r.budget.title} · الإصدار ${r.budget.version}` : `لا توجد موازنة معتمدة لسنة ${y}`,
            rows: r.lines.map((l) => ({ ...l, section: ar(SECTION_NAME, l.section) })),
          };
        },
      },
    ];
    this.registry.register(defs);
  }
}
