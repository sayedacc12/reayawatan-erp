import { BadRequestException, Injectable, OnModuleInit } from '@nestjs/common';
import { ar, dynamicFilter, org, selectFilter } from '../../core/reports/report-helpers';
import { ReportDefinition, ReportRow } from '../../core/reports/report.types';
import { ReportsRegistry } from '../../core/reports/reports.registry';
import { Plan } from './entities/planning.entity';
import { OrgAnalysis, PlanningAnalysis } from './planning-analysis.service';
import { PlanningViews } from './planning-views.service';
import { PLANNING_PERMISSIONS as P } from './planning.manifest';
import { PlansService } from './plans.service';
import { PlanningLinks } from './planning-links.service';

export const EXEC_STATUS: Record<string, string> = {
  not_started: 'لم يبدأ', on_track: 'حسب الخطة', at_risk: 'في خطر', delayed: 'متأخر', completed: 'منجز', cancelled: 'ملغى', carried_over: 'مُرحّل', no_schedule: 'بلا جدول زمني',
};
const WF: Record<string, string> = { draft: 'مسودة', in_review: 'قيد الاعتماد', returned: 'مُرجعة للتعديل', approved: 'معتمدة', rejected: 'مرفوضة' };
const BAND: Record<string, string> = { green: 'محقق', amber: 'قريب من المستهدف', red: 'دون المستهدف' };
const CHANGE: Record<string, string> = { added: 'إضافة', removed: 'حذف', modified: 'تعديل' };
const KIND: Record<string, string> = { item: 'عنصر', kpi: 'مؤشر', link: 'علاقة', plan: 'بيانات الخطة' };
const FUNDING: Record<string, string> = { restricted: 'مقيد', unrestricted: 'غير مقيد', mixed: 'مختلط' };
const show = (v: unknown): string => {
  if (v === null || v === undefined || v === '') return '—';
  if (Array.isArray(v)) return v.map((x) => (typeof x === 'object' ? (x as { text?: string; title?: string; name?: string }).text ?? (x as { title?: string }).title ?? (x as { name?: string }).name ?? JSON.stringify(x) : String(x))).join('، ') || '—';
  if (typeof v === 'object') return Object.entries(v as Record<string, unknown>).map(([k, x]) => `${k}: ${typeof x === 'number' ? x.toLocaleString('en-US') : x}`).join('، ') || '—';
  return String(v);
};

/** تقارير التخطيط في البنية الموحدة (تقرأ من نفس التحليل الذي تعرضه الشاشات) */
@Injectable()
export class PlanningReports implements OnModuleInit {
  constructor(private readonly registry: ReportsRegistry, private readonly analysis: PlanningAnalysis, private readonly views: PlanningViews, private readonly plans: PlansService, private readonly links: PlanningLinks) {}

  onModuleInit() {
    const base = { module: 'planning', permission: P.reports };
    const planOptions = (kind?: 'strategic' | 'operational') => async (u: Parameters<ReportDefinition['run']>[0]) => {
      const a = await this.analysis.analyze(org(u).organizationId);
      return [...a.plans.values()].filter((p) => !kind || p.kind === kind).sort((x, y) => y.startYear - x.startYear || x.code.localeCompare(y.code))
        .map((p) => ({ value: p.id, label: `${p.code} ${p.title} (${p.startYear}${p.endYear !== p.startYear ? `-${p.endYear}` : ''})` }));
    };
    const planOf = (a: OrgAnalysis, id?: string): Plan => {
      const p = id ? a.plans.get(id) : null;
      if (!p) throw new BadRequestException('اختر الخطة');
      return p;
    };
    const tree = (a: OrgAnalysis, planId: string) => {
      const items = a.items.filter((i) => i.planId === planId);
      const out: typeof items = [];
      const walk = (parent: string | null) => items.filter((i) => i.parentId === parent).sort((x, y) => x.sortOrder - y.sortOrder || x.code.localeCompare(y.code)).forEach((i) => { out.push(i); walk(i.id); });
      walk(null);
      return out;
    };
    const defs: ReportDefinition[] = [
      {
        ...base, code: 'planning.structure', category: 'الخطط', title: 'هيكل الخطة ونسب الإنجاز', orientation: 'landscape', indentColumn: 'title',
        description: 'عناصر الخطة بمستوياتها ومسؤوليها ومددها وأوزانها وتكاليفها التقديرية ونسب الإنجاز وتحقق المؤشرات',
        filters: [dynamicFilter('planId', 'الخطة', planOptions(), 'اختر الخطة', true)],
        columns: [
          { key: 'code', label: 'الرمز' }, { key: 'title', label: 'العنصر' }, { key: 'levelName', label: 'المستوى' }, { key: 'ownerName', label: 'المسؤول' },
          { key: 'unitName', label: 'الجهة' }, { key: 'startDate', label: 'البداية', type: 'date' }, { key: 'endDate', label: 'النهاية', type: 'date' },
          { key: 'weight', label: 'الوزن', type: 'number' }, { key: 'cost', label: 'التكلفة التقديرية', type: 'money' }, { key: 'planned', label: 'المخطط', type: 'percent' },
          { key: 'progress', label: 'الإنجاز', type: 'percent' }, { key: 'performance', label: 'تحقق المؤشرات', type: 'percent' }, { key: 'status', label: 'الحالة' },
        ],
        run: async (u, f) => {
          const a = await this.analysis.analyze(org(u).organizationId);
          const p = planOf(a, f.planId);
          const s = this.analysis.summary(a, p);
          const rows: ReportRow[] = tree(a, p.id).map((i) => {
            const r = a.rolled.get(i.id)!;
            return {
              code: i.code, title: i.title, levelName: p.levels[i.level]?.name, ownerName: i.ownerName, unitName: i.unitName, startDate: i.startDate, endDate: i.endDate, weight: i.weight,
              cost: r.cost, planned: r.planned, progress: r.progress, performance: a.perf.get(i.id), status: ar(EXEC_STATUS, r.status), _level: i.level, _style: i.level === 0 ? 'strong' : undefined, _skipTotal: true,
            };
          });
          return {
            rows, subtitle: `${p.code} ${p.title} (${p.startYear} - ${p.endYear}) · ${ar(WF, p.status)} · الإصدار ${p.version || '—'}`,
            summary: [
              { label: 'الإنجاز العام', value: s.progress, type: 'percent' }, { label: 'المخطط حتى اليوم', value: s.planned, type: 'percent' },
              { label: 'تحقق المؤشرات', value: s.performance, type: 'percent' }, { label: 'التكلفة التقديرية', value: s.totalCost, type: 'money' },
            ],
            totals: { cost: s.totalCost },
          };
        },
      },
      {
        ...base, code: 'planning.kpis', category: 'المؤشرات', title: 'تحقق مؤشرات الأداء', orientation: 'landscape',
        description: 'المستهدف والمحقق ونسبة التحقق لكل مؤشر في السنة الحالية من مدة خطته',
        filters: [dynamicFilter('planId', 'الخطة', planOptions()), selectFilter('band', 'مستوى التحقق', { ...BAND, none: 'بلا قراءة' })],
        columns: [
          { key: 'code', label: 'الرمز' }, { key: 'name', label: 'المؤشر' }, { key: 'plan', label: 'الخطة' }, { key: 'item', label: 'العنصر' }, { key: 'unit', label: 'الوحدة' },
          { key: 'year', label: 'السنة' }, { key: 'baseline', label: 'خط الأساس', type: 'number' }, { key: 'target', label: 'المستهدف', type: 'number' },
          { key: 'actual', label: 'المحقق', type: 'number' }, { key: 'ach', label: 'نسبة التحقق', type: 'percent' }, { key: 'band', label: 'المستوى' }, { key: 'ownerName', label: 'المسؤول' },
        ],
        link: '/planning/kpis?kpi={id}',
        run: async (u, f) => (await this.views.kpis(org(u), { planId: f.planId, band: f.band })).map((k) => ({
          id: k.id, code: k.code, name: k.name, plan: k.plan.code, item: k.item ? `${k.item.code} ${k.item.title}` : null, unit: k.unit, year: String(k.year), baseline: k.baseline,
          target: k.stat?.target ?? null, actual: k.stat?.actual ?? null, ach: k.stat?.ach ?? null, band: k.stat?.band ? BAND[k.stat.band] : 'بلا قراءة', ownerName: k.ownerName,
        })),
      },
      {
        ...base, code: 'planning.execution', category: 'التنفيذ', title: 'متابعة تنفيذ الأنشطة', orientation: 'landscape',
        description: 'الأنشطة التنفيذية في الخطط الفعالة: الإنجاز المخطط والفعلي والحالة والإجراء التصحيحي',
        filters: [{ key: 'year', label: 'السنة', type: 'year', default: 'currentYear', required: true }, selectFilter('status', 'الحالة', EXEC_STATUS), selectFilter('kind', 'نوع الخطة', { strategic: 'استراتيجية', operational: 'تشغيلية' })],
        columns: [
          { key: 'planCode', label: 'الخطة' }, { key: 'code', label: 'الرمز' }, { key: 'title', label: 'النشاط' }, { key: 'unitName', label: 'الجهة' }, { key: 'ownerName', label: 'المسؤول' },
          { key: 'startDate', label: 'البداية', type: 'date' }, { key: 'endDate', label: 'النهاية', type: 'date' }, { key: 'yearCost', label: 'تكلفة السنة', type: 'money', total: true },
          { key: 'planned', label: 'المخطط', type: 'percent' }, { key: 'progress', label: 'الفعلي', type: 'percent' }, { key: 'status', label: 'الحالة' }, { key: 'correctiveAction', label: 'الإجراء التصحيحي' },
        ],
        link: '/planning/plans/{planId}?item={id}',
        run: async (u, f) => (await this.views.execution(org(u), { year: f.year, status: f.status, kind: f.kind })).rows.map((r) => ({ ...r, status: ar(EXEC_STATUS, r.status) })),
      },
      {
        ...base, code: 'planning.delayed', category: 'التنفيذ', title: 'الأنشطة المتأخرة والإجراءات التصحيحية',
        description: 'الأنشطة المتأخرة أو المعرضة للتأخر، والفجوة بين المخطط والفعلي، والإجراء التصحيحي المسجل',
        filters: [{ key: 'year', label: 'السنة', type: 'year', default: 'currentYear', required: true }],
        columns: [
          { key: 'planCode', label: 'الخطة' }, { key: 'code', label: 'الرمز' }, { key: 'title', label: 'النشاط' }, { key: 'ownerName', label: 'المسؤول' }, { key: 'endDate', label: 'النهاية', type: 'date' },
          { key: 'gap', label: 'الفجوة', type: 'percent' }, { key: 'status', label: 'الحالة' }, { key: 'correctiveAction', label: 'الإجراء التصحيحي' },
        ],
        link: '/planning/plans/{planId}?item={id}',
        run: async (u, f) => (await this.views.execution(org(u), { year: f.year })).rows.filter((r) => r.status === 'delayed' || r.status === 'at_risk')
          .map((r) => ({ ...r, gap: Math.round(((r.planned ?? 0) - r.progress) * 10) / 10, status: ar(EXEC_STATUS, r.status), correctiveAction: r.correctiveAction ?? 'لم يُسجّل' })),
      },
      {
        ...base, code: 'planning.cost-by-year', category: 'التكاليف', title: 'التكاليف التقديرية موزعة على السنوات', orientation: 'landscape', indentColumn: 'title',
        description: 'التكلفة التقديرية لكل عنصر في الخطة موزعة على السنوات المالية مع نوع التمويل (أساس الموازنة في المرحلة القادمة)',
        filters: [dynamicFilter('planId', 'الخطة', planOptions(), 'اختر الخطة', true)],
        columns: [],
        run: async (u, f) => {
          const a = await this.analysis.analyze(org(u).organizationId);
          const p = planOf(a, f.planId);
          const years = Array.from({ length: p.endYear - p.startYear + 1 }, (_, i) => p.startYear + i);
          const rows: ReportRow[] = tree(a, p.id).filter((i) => i.state !== 'cancelled').map((i) => {
            const r = a.rolled.get(i.id)!;
            return {
              code: i.code, title: i.title, funding: ar(FUNDING, i.fundingType), ...Object.fromEntries(years.map((y) => [`y${y}`, r.costByYear[String(y)] ?? 0])), total: r.cost,
              _level: i.level, _style: i.level === 0 ? 'strong' : undefined, _skipTotal: true,
            };
          });
          const totals: Record<string, number> = { total: 0 };
          for (const i of a.items.filter((x) => x.planId === p.id && x.state !== 'cancelled')) {
            totals.total += i.plannedCost;
            for (const y of years) totals[`y${y}`] = (totals[`y${y}`] ?? 0) + (Number(i.costByYear[String(y)]) || 0);
          }
          return {
            rows, totals, subtitle: `${p.code} ${p.title}`,
            columns: [
              { key: 'code', label: 'الرمز' }, { key: 'title', label: 'العنصر' }, { key: 'funding', label: 'التمويل' },
              ...years.map((y) => ({ key: `y${y}`, label: String(y), type: 'money' as const, total: true })), { key: 'total', label: 'الإجمالي', type: 'money', total: true },
            ],
          };
        },
      },
      {
        ...base, code: 'planning.compare', category: 'الخطط', title: 'مقارنة الخطة الأصلية والمعدلة', orientation: 'landscape',
        description: 'الإضافات والحذف والتعديلات بين إصدارين معتمدين للخطة، أو بين آخر إصدار معتمد والتعديل الجاري',
        filters: [
          dynamicFilter('planId', 'الخطة', planOptions(), 'اختر الخطة', true),
          { key: 'from', label: 'من الإصدار', type: 'text', default: '1', required: true },
          { key: 'to', label: 'إلى الإصدار (0 = التعديل الجاري)', type: 'text', default: '0' },
        ],
        columns: [
          { key: 'kind', label: 'النوع' }, { key: 'change', label: 'التغيير' }, { key: 'code', label: 'الرمز' }, { key: 'title', label: 'العنصر' },
          { key: 'field', label: 'الحقل' }, { key: 'before', label: 'قبل' }, { key: 'after', label: 'بعد' },
        ],
        run: async (u, f) => {
          const ver = (v: string | undefined, d: number) => (v && /^\d{1,4}$/.test(v) ? Number(v) : d);
          const c = await this.plans.compare(org(u), f.planId!, ver(f.from, 1), ver(f.to, 0));
          const rows: ReportRow[] = c.rows.flatMap((r) => r.changes.length
            ? r.changes.map((x, i) => ({ kind: i ? '' : KIND[r.kind], change: i ? '' : CHANGE[r.change], code: i ? '' : r.code, title: i ? '' : r.title, field: x.label, before: show(x.before), after: show(x.after) }))
            : [{ kind: KIND[r.kind], change: CHANGE[r.change], code: r.code, title: r.title, field: '—', before: '—', after: '—' }]);
          return {
            rows, subtitle: `${c.plan.code} ${c.plan.title}: الإصدار ${c.from} مقابل ${c.to ? `الإصدار ${c.to}` : 'التعديل الجاري'}`,
            summary: [
              { label: 'التكلفة قبل', value: c.totals.fromCost, type: 'money' }, { label: 'التكلفة بعد', value: c.totals.toCost, type: 'money' },
              { label: 'العناصر قبل / بعد', value: `${c.totals.fromItems} / ${c.totals.toItems}` }, { label: 'التغييرات', value: c.rows.length, type: 'number' },
            ],
          };
        },
      },
      {
        ...base, code: 'planning.traceability', category: 'الخطط', title: 'الترابط من الأهداف إلى الأنشطة', orientation: 'landscape', indentColumn: 'title',
        description: 'كل عنصر في الخطة الاستراتيجية مع الأنشطة التشغيلية التي تسهم فيه ونسبة مساهمتها وإنجازها وتكلفتها',
        filters: [dynamicFilter('planId', 'الخطة الاستراتيجية', planOptions('strategic'), 'اختر الخطة', true)],
        columns: [
          { key: 'code', label: 'الرمز' }, { key: 'title', label: 'العنصر / النشاط المساهم' }, { key: 'source', label: 'المصدر' }, { key: 'contribution', label: 'المساهمة', type: 'percent' },
          { key: 'cost', label: 'التكلفة', type: 'money' }, { key: 'progress', label: 'الإنجاز', type: 'percent' }, { key: 'performance', label: 'تحقق المؤشرات', type: 'percent' }, { key: 'status', label: 'الحالة' },
        ],
        run: async (u, f) => {
          const a = await this.analysis.analyze(org(u).organizationId);
          const p = planOf(a, f.planId);
          const rows: ReportRow[] = [];
          for (const i of tree(a, p.id)) {
            const r = a.rolled.get(i.id)!;
            rows.push({ code: i.code, title: i.title, source: p.levels[i.level]?.name, cost: r.cost, progress: r.progress, performance: a.perf.get(i.id), status: ar(EXEC_STATUS, r.status), _level: i.level, _style: i.level === 0 ? 'strong' : undefined });
            for (const l of a.links.filter((x) => x.toItemId === i.id)) {
              const c = a.itemById.get(l.fromItemId);
              if (!c) continue;
              const cp = a.plans.get(c.planId)!;
              const cr = a.rolled.get(c.id)!;
              rows.push({ code: c.code, title: `↳ ${c.title}`, source: `${cp.code} ${cp.unitName ?? cp.title}`, contribution: l.contribution, cost: cr.cost, progress: cr.progress, status: ar(EXEC_STATUS, cr.status), _level: i.level + 1, _style: 'muted' });
            }
          }
          return { rows, subtitle: `${p.code} ${p.title}` };
        },
      },
      {
        ...base, code: 'planning.unowned', category: 'التنفيذ', title: 'العناصر والمستهدفات بلا مسؤول',
        description: 'عناصر الخطط الفعالة التي لم يُحدد لها مسؤول، ومؤشرات بلا مسؤول قياس',
        columns: [{ key: 'type', label: 'النوع' }, { key: 'plan', label: 'الخطة' }, { key: 'code', label: 'الرمز' }, { key: 'title', label: 'العنصر' }, { key: 'unitName', label: 'الجهة' }],
        run: async (u) => {
          const a = await this.analysis.analyze(org(u).organizationId);
          const live = [...a.plans.values()].filter((p) => p.status !== 'rejected' && p.endYear >= a.year);
          const ids = new Set(live.map((p) => p.id));
          return [
            ...a.items.filter((i) => ids.has(i.planId) && !i.ownerName && !['cancelled', 'carried_over', 'completed'].includes(i.state))
              .map((i) => ({ type: a.plans.get(i.planId)!.levels[i.level]?.name, plan: a.plans.get(i.planId)!.code, code: i.code, title: i.title, unitName: i.unitName })),
            ...a.kpis.filter((k) => ids.has(k.planId) && !k.ownerName).map((k) => ({ type: 'مؤشر أداء', plan: a.plans.get(k.planId)!.code, code: k.code, title: k.name, unitName: null })),
          ];
        },
      },
      {
        ...base, code: 'planning.plans', category: 'الخطط', title: 'سجل الخطط',
        description: 'كل الخطط الاستراتيجية والتشغيلية وحالتها وإصدارها ونسب إنجازها وتكلفتها',
        filters: [selectFilter('kind', 'النوع', { strategic: 'استراتيجية', operational: 'تشغيلية' }), selectFilter('status', 'الحالة', WF)],
        columns: [
          { key: 'code', label: 'الرمز' }, { key: 'title', label: 'الخطة' }, { key: 'kind', label: 'النوع' }, { key: 'period', label: 'المدة' }, { key: 'unitName', label: 'الإدارة' },
          { key: 'status', label: 'الحالة' }, { key: 'version', label: 'الإصدار', type: 'number' }, { key: 'progress', label: 'الإنجاز', type: 'percent' },
          { key: 'performance', label: 'تحقق المؤشرات', type: 'percent' }, { key: 'cost', label: 'التكلفة التقديرية', type: 'money', total: true },
        ],
        link: '/planning/plans/{id}',
        run: async (u, f) => (await this.plans.list(org(u), { kind: f.kind, status: f.status })).map((p) => ({
          id: p.id, code: p.code, title: p.title, kind: p.kind === 'strategic' ? 'استراتيجية' : 'تشغيلية', period: p.startYear === p.endYear ? String(p.startYear) : `${p.startYear} - ${p.endYear}`,
          unitName: p.unitName ?? 'الشركة', status: ar(WF, p.status), version: p.version, progress: p.summary.progress, performance: p.summary.performance, cost: p.summary.totalCost,
        })),
      },
      {
        ...base, code: 'planning.risks', category: 'الربط بالأنظمة', title: 'تغطية المخاطر الجوهرية بخطط المعالجة', orientation: 'landscape',
        description: 'المخاطر المرتفعة والحرجة في سجل المخاطر، والعناصر التي تعالجها في الخطة وتكلفتها ونسبة إنجازها، والمخاطر غير المغطاة',
        filters: [dynamicFilter('planId', 'الخطة', planOptions(), 'اختر الخطة', true)],
        columns: [
          { key: 'code', label: 'الخطر' }, { key: 'title', label: 'العنوان' }, { key: 'level', label: 'المستوى' }, { key: 'score', label: 'الدرجة', type: 'number' },
          { key: 'ownerName', label: 'مالك الخطر' }, { key: 'items', label: 'عناصر المعالجة في الخطة' }, { key: 'cost', label: 'تكلفة المعالجة', type: 'money', total: true },
          { key: 'progress', label: 'الإنجاز', type: 'percent' }, { key: 'covered', label: 'التغطية' },
        ],
        run: async (u, f) => {
          const o = await this.links.overview(org(u), String(f.planId ?? ''));
          return {
            subtitle: `${o.plan.code} ${o.plan.title}`,
            summary: [
              { label: 'المخاطر الجوهرية', value: o.coverage.materialTotal, type: 'number' }, { label: 'المغطاة بخطط معالجة', value: o.coverage.materialCovered, type: 'number' },
              { label: 'تكلفة المعالجة في الخطة', value: o.coverage.treatmentCost, type: 'money' },
            ],
            rows: o.coverage.risks.map((r) => ({
              code: r.code, title: r.title, level: r.levelName, score: r.score, ownerName: r.ownerName, items: r.items.map((i) => `${i.code} ${i.title}`).join('، ') || '—',
              cost: r.cost, progress: r.progress, covered: r.items.length ? 'مغطى' : r.material ? 'غير مغطى' : 'مرتبط', _style: r.material && !r.items.length ? 'strong' : undefined,
            })) as ReportRow[],
          };
        },
      },
      {
        ...base, code: 'planning.audit-actions', category: 'الربط بالأنظمة', title: 'الإجراءات التصحيحية للمراجعة الداخلية في الخطة', orientation: 'landscape',
        description: 'إجراءات متابعة توصيات المراجعة الداخلية المفتوحة، وأنشطة الخطة المرتبطة بها وتكلفتها، والمتأخر منها. الحالة من نظام المراجعة الداخلية',
        filters: [dynamicFilter('planId', 'الخطة', planOptions(), 'اختر الخطة', true)],
        columns: [
          { key: 'code', label: 'الإجراء' }, { key: 'title', label: 'العنوان' }, { key: 'engagement', label: 'مهمة المراجعة' }, { key: 'priority', label: 'الأولوية' },
          { key: 'unitName', label: 'الجهة المسؤولة' }, { key: 'dueDate', label: 'الموعد المستهدف', type: 'date' }, { key: 'status', label: 'الحالة' },
          { key: 'progress', label: 'الإنجاز', type: 'percent' }, { key: 'items', label: 'أنشطة الخطة' }, { key: 'cost', label: 'التكلفة', type: 'money', total: true },
        ],
        run: async (u, f) => {
          const o = await this.links.overview(org(u), String(f.planId ?? ''));
          return {
            subtitle: `${o.plan.code} ${o.plan.title}`,
            rows: o.coverage.actions.map((x) => ({
              code: x.code, title: x.title, engagement: x.engagement, priority: x.priorityName, unitName: x.unitName, dueDate: x.dueDate, status: `${x.statusName}${x.overdue ? ' (متأخر)' : ''}`,
              progress: x.progress, items: x.items.map((i) => `${i.code} ${i.title}`).join('، ') || '—', cost: x.cost, _style: x.overdue ? 'strong' : undefined,
            })) as ReportRow[],
          };
        },
      },
      {
        ...base, code: 'planning.analysis', category: 'الربط بالأنظمة', title: 'استجابة الخطة لتحليلات PESTEL وSWOT', orientation: 'landscape',
        description: 'عناصر التحليلات المعتمدة (الفرص والتهديدات ونقاط القوة والضعف والعوامل الخارجية) والعناصر التي تستجيب لها في الخطة',
        filters: [dynamicFilter('planId', 'الخطة', planOptions(), 'اختر الخطة', true)],
        columns: [
          { key: 'analysis', label: 'التحليل' }, { key: 'factor', label: 'العامل' }, { key: 'text', label: 'العنصر' }, { key: 'impact', label: 'الأثر', type: 'number' },
          { key: 'items', label: 'العناصر المستجيبة في الخطة' }, { key: 'covered', label: 'الاستجابة' },
        ],
        run: async (u, f) => {
          const o = await this.links.overview(org(u), String(f.planId ?? ''));
          return {
            subtitle: `${o.plan.code} ${o.plan.title}`,
            summary: o.coverage.byFactor.map((x) => ({ label: x.name, value: `${x.linked} من ${x.total}` })),
            rows: o.coverage.factors.map((x) => ({
              analysis: `${x.group} (${x.version})`, factor: x.factorName, text: x.text, impact: x.impact, items: x.items.map((i) => `${i.code} ${i.title}`).join('، ') || '—',
              covered: x.items.length ? 'مستجاب له' : 'لا يوجد', _skipTotal: true,
            })) as ReportRow[],
          };
        },
      },
    ];
    this.registry.register(defs);
  }
}


