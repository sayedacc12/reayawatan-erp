import { Injectable, OnModuleInit } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { ar, dynamicFilter, org, selectFilter } from '../../core/reports/report-helpers';
import { ReportDefinition, ReportFilters, ReportRow } from '../../core/reports/report.types';
import { ReportsRegistry } from '../../core/reports/reports.registry';
import { OrgUser } from '../../core/auth/decorators';
import { FIGURES, findItem, grade, STANDARDS } from './catalog';
import { GovAssessment } from './entities/governance.entity';
import { GovFinance, today } from './gov-finance.service';
import { GOV_PERMISSIONS as P } from './governance.manifest';
import { ACTION_STATUS_AR, GovernanceService, KIND_AR, OBLIGATION_AR, PRIORITY_AR, STATUS_AR } from './governance.service';

const METHOD: Record<string, string> = { desk: 'مكتبي', field: 'ميداني', both: 'مكتبي وميداني' };
const STD_SHORT: Record<string, string> = { CMP: 'الامتثال والالتزام', TRN: 'الشفافية والإفصاح', FRG: 'التنظيم المالي' };
const LEVEL: Record<string, string> = { critical: 'حرج', warning: 'تحذير', info: 'تنبيه' };
const OBL_STATE: Record<string, string> = { done: 'منجز في موعده', late_done: 'منجز بعد الموعد', overdue: 'متأخر', due_soon: 'يستحق قريباً', upcoming: 'قادم' };

/** تقارير الحوكمة في البنية الموحدة: الدرجة ومكوناتها، الفجوات، الأداء المالي، الإنذارات، الخطة، التقويم */
@Injectable()
export class GovernanceReports implements OnModuleInit {
  constructor(
    private readonly registry: ReportsRegistry,
    private readonly gov: GovernanceService,
    private readonly finance: GovFinance,
    private readonly db: DataSource,
  ) {}

  /** التقييم المختار، أو آخر تقييم ذاتي/تجريبي */
  private async pick(u: OrgUser, f: ReportFilters) {
    const repo = this.db.getRepository(GovAssessment);
    const x = f.assessment
      ? await repo.findOne({ where: { id: f.assessment, organizationId: u.organizationId } })
      : await repo.createQueryBuilder('a').where('a.organization_id = :o', { o: u.organizationId }).andWhere(`a.kind IN ('self', 'mock')`)
        .orderBy('a.period_to', 'DESC').addOrderBy('a.created_at', 'DESC').getOne();
    return x ? this.gov.assessment(u, x.id) : null;
  }

  onModuleInit() {
    const base = { module: 'governance', permission: P.reports };
    const assessmentFilter = dynamicFilter('assessment', 'التقييم', async (u) => {
      const rows = await this.db.getRepository(GovAssessment).find({ where: { organizationId: u.organizationId }, order: { periodTo: 'DESC' } });
      return rows.map((r) => ({ value: r.id, label: `${r.code} — ${r.title} (${STATUS_AR[r.status]})` }));
    }, 'آخر تقييم');
    const none = (msg = 'لا يوجد تقييم بعد. ابدأ تقييماً ذاتياً من شاشة التقييم الذاتي.') => ({ rows: [], notes: [msg] });

    const defs: ReportDefinition[] = [
      {
        ...base, code: 'governance.scorecard', category: 'الدرجة الكلية', title: 'بطاقة درجة الحوكمة',
        description: 'الدرجة الحالية والمتوقعة لكل محور ومعيار ومؤشر، بأوزان أدلة المركز الوطني (40% امتثال، 20% شفافية، 40% سلامة مالية)',
        filters: [assessmentFilter], indentColumn: 'title',
        columns: [
          { key: 'code', label: 'الرمز' }, { key: 'title', label: 'المحور / المؤشر' }, { key: 'weight', label: 'الوزن', type: 'percent' },
          { key: 'earned', label: 'الدرجة المحققة', type: 'number' }, { key: 'percent', label: 'نسبة التحقق', type: 'percent' },
          { key: 'predicted', label: 'المتوقعة', type: 'number' },
        ],
        run: async (u, f) => {
          const d = await this.pick(org(u), f);
          if (!d) return none();
          const e = d.evaluation;
          const rows: ReportRow[] = [];
          for (const ax of e.axes) {
            rows.push({ code: ax.code, title: `محور ${ax.title}`, weight: ax.weight, earned: ax.score, percent: ax.score, predicted: ax.predicted, _style: 'group' });
            if (ax.code === 'FIN') {
              rows.push({ code: 'FIN-P', title: 'الأداء المالي (بعد معامل رأي المحاسب)', weight: 50, earned: e.performance?.final ?? 0, percent: e.performance?.final ?? 0, predicted: e.performance?.forecastFinal ?? e.performance?.final ?? 0, _level: 1, _style: 'strong' });
            }
            const st = e.standards.find((s) => s.code === (ax.code === 'FIN' ? 'FRG' : ax.code));
            if (!st) continue;
            if (ax.code === 'FIN') rows.push({ code: 'FRG', title: 'التنظيم المالي', weight: 50, earned: st.score, percent: st.score, predicted: st.predicted, _level: 1, _style: 'strong' });
            for (const i of st.indicators) rows.push({ code: i.code, title: i.title, weight: i.weight, earned: i.earned, percent: i.percent, predicted: i.predicted, _level: ax.code === 'FIN' ? 2 : 1 });
          }
          return {
            rows, subtitle: `${d.assessment.code} — ${d.assessment.title} (${d.assessment.periodFrom} إلى ${d.assessment.periodTo})`,
            summary: [
              { label: 'الدرجة الكلية الحالية', value: e.overall, type: 'percent' }, { label: 'التقدير', value: e.grade },
              { label: 'الدرجة المتوقعة', value: e.predicted, type: 'percent' }, { label: 'التقدير المتوقع', value: e.predictedGrade },
              { label: 'اكتمال الإجابة', value: e.coverage, type: 'percent' }, { label: 'المستهدف', value: d.target, type: 'percent' },
            ],
            notes: [
              'الدرجة الحالية تحتسب البنود غير المُجاب عليها صفراً؛ والمتوقعة تكمّلها من الإشارات الآلية وآخر تقييم معتمد ومن الأداء المالي المتوقع لنهاية السنة.',
              'التقدير: أقل من 50 ضعيف، 50–69 متوسط، 70–79 جيد، 80–89 جيد جداً، 90 فأكثر ممتاز.',
            ],
          };
        },
      },
      {
        ...base, code: 'governance.practices', category: 'الدرجة الكلية', title: 'نتائج الممارسات',
        description: 'كل ممارسة في الأدلة الثلاثة بدرجتها المحققة من درجتها الكاملة وعدد البنود المُجاب عليها',
        filters: [assessmentFilter, selectFilter('standard', 'المعيار', STD_SHORT)], orientation: 'landscape', indentColumn: 'title',
        columns: [
          { key: 'code', label: 'الرمز' }, { key: 'title', label: 'الممارسة' }, { key: 'possible', label: 'الدرجة الكاملة', type: 'number', total: true },
          { key: 'earned', label: 'المحققة', type: 'number', total: true }, { key: 'percent', label: 'نسبة التحقق', type: 'percent' },
          { key: 'answered', label: 'البنود المُجابة' }, { key: 'predicted', label: 'المتوقعة', type: 'number', total: true },
        ],
        run: async (u, f) => {
          const d = await this.pick(org(u), f);
          if (!d) return none();
          const rows: ReportRow[] = [];
          for (const s of d.evaluation.standards) {
            if (f.standard && s.code !== f.standard) continue;
            rows.push({ code: s.code, title: `معيار ${s.title}`, _style: 'group', _skipTotal: true });
            for (const i of s.indicators) {
              rows.push({ code: i.code, title: i.title, possible: i.weight, earned: i.earned, percent: i.percent, predicted: i.predicted, _level: 1, _style: 'strong', _skipTotal: true });
              for (const p of i.practices) {
                rows.push({
                  code: p.code, title: p.title, possible: p.possible, earned: p.earned, percent: p.possible ? Math.round((p.earned / p.possible) * 10000) / 100 : 0,
                  answered: `${p.answered} من ${p.items.length}`, predicted: p.predicted, _level: 2,
                });
              }
            }
          }
          return { rows, subtitle: `${d.assessment.code} — ${d.assessment.title}` };
        },
      },
      {
        ...base, code: 'governance.answers', category: 'التقييم الذاتي', title: 'سجل الإجابات والشواهد',
        description: 'كل بند بأسئلته والإجابة المختارة ونسبتها والشواهد المرفقة ومصدرها (إجابة المقيّم أو إشارة آلية)',
        filters: [assessmentFilter, selectFilter('standard', 'المعيار', STD_SHORT), selectFilter('state', 'الحالة', { answered: 'مُجاب', missing: 'غير مُجاب', gap: 'دون 100%' })],
        orientation: 'landscape',
        columns: [
          { key: 'code', label: 'البند' }, { key: 'question', label: 'السؤال' }, { key: 'method', label: 'آلية التقييم' }, { key: 'answer', label: 'الإجابة' },
          { key: 'points', label: 'الدرجة', type: 'number', total: true }, { key: 'percent', label: 'النسبة', type: 'percent' }, { key: 'earned', label: 'المحققة', type: 'number', total: true },
          { key: 'evidence', label: 'الشواهد' }, { key: 'source', label: 'المصدر' },
        ],
        run: async (u, f) => {
          const d = await this.pick(org(u), f);
          if (!d) return none();
          const rows: ReportRow[] = [];
          for (const s of d.evaluation.standards) {
            if (f.standard && s.code !== f.standard) continue;
            for (const i of s.indicators) for (const p of i.practices) for (const it of p.items) {
              if (f.state === 'answered' && !it.answered) continue;
              if (f.state === 'missing' && it.answered) continue;
              if (f.state === 'gap' && it.answered && (it.percent ?? 0) >= 100) continue;
              const item = findItem(it.code)!.item;
              const ans = d.answers[it.code];
              const labels = ans ? ans.choices.map((c: number | null, k: number) => (c === null ? null : item.steps[k]?.o[c]?.[0])).filter(Boolean).join(' ← ') : null;
              rows.push({
                code: it.code, question: item.steps.map((st, k) => `${k + 1}) ${st.q}`).join('\n'), method: [...new Set(item.steps.map((st) => METHOD[st.m]))].join('، '),
                answer: labels ?? 'لم يُجب', points: it.points, percent: it.percent, earned: Math.round(it.earned * 100) / 100,
                evidence: ans?.evidence ?? item.steps.flatMap((st) => st.ev).join('؛ '), source: ans ? (ans.fromSignal ? 'إشارة آلية' : ans.answeredByName) : null,
              });
            }
          }
          return { rows, subtitle: `${d.assessment.code} — ${d.assessment.title}`, notes: ['عند عدم الإجابة يظهر في عمود الشواهد آلية التحقق المطلوبة من الدليل.'] };
        },
      },
      {
        ...base, code: 'governance.opportunities', category: 'فرص التحسين', title: 'فرص التحسين مرتبة حسب الأثر',
        description: 'البنود ومؤشرات الأداء المالي التي لم تحقق كامل درجتها، مرتبة حسب الدرجات التي تضيفها للتقييم الكلي، مع الأنشطة المقترحة من الدليل',
        filters: [assessmentFilter], orientation: 'landscape',
        columns: [
          { key: 'rank', label: '#', type: 'number' }, { key: 'code', label: 'الرمز' }, { key: 'standard', label: 'المعيار' }, { key: 'title', label: 'الفجوة' },
          { key: 'current', label: 'الحالية', type: 'percent' }, { key: 'lost', label: 'المفقود من المعيار', type: 'number', total: true },
          { key: 'impact', label: 'الأثر على الدرجة الكلية', type: 'number', total: true }, { key: 'recommendations', label: 'الأنشطة المقترحة' },
        ],
        run: async (u, f) => {
          const d = await this.pick(org(u), f);
          if (!d) return none();
          const items = d.evaluation.opportunities;
          return {
            rows: items.map((o, i) => ({ rank: i + 1, code: o.code, standard: o.standard, title: o.title, current: o.current, lost: o.lost, impact: o.impact, recommendations: o.recommendations.join('\n') })),
            subtitle: `${d.assessment.code} — ${d.assessment.title}`,
            summary: [
              { label: 'الدرجة المتوقعة', value: d.evaluation.predicted, type: 'percent' },
              { label: 'المتاح كسبه', value: Math.round(items.reduce((t, o) => t + o.impact, 0) * 100) / 100, type: 'number' },
              { label: 'أعلى 10 فرص تضيف', value: Math.round(items.slice(0, 10).reduce((t, o) => t + o.impact, 0) * 100) / 100, type: 'number' },
            ],
          };
        },
      },
      {
        ...base, code: 'governance.financial', category: 'السلامة المالية', title: 'مؤشرات الأداء المالي',
        description: 'المؤشرات الخمسة ومؤشراتها التحليلية الأحد عشر بالنسبة والدرجة والمعادلة، فعلي حتى تاريخه ومتوقع لنهاية السنة',
        filters: [{ key: 'to', label: 'حتى تاريخ', type: 'date', default: 'today', required: true }], orientation: 'landscape', indentColumn: 'title',
        columns: [
          { key: 'code', label: 'الرمز' }, { key: 'title', label: 'المؤشر' }, { key: 'weight', label: 'الوزن', type: 'percent' },
          { key: 'ratio', label: 'النسبة الفعلية', type: 'number' }, { key: 'score', label: 'الدرجة الفعلية', type: 'percent' },
          { key: 'fratio', label: 'النسبة المتوقعة', type: 'number' }, { key: 'fscore', label: 'الدرجة المتوقعة', type: 'percent' },
          { key: 'rule', label: 'قاعدة الدليل' },
        ],
        run: async (u, f) => {
          const s = await this.finance.snapshot(org(u).organizationId, f.to ?? today());
          if (!s) return none('النظام المالي غير مهيأ: لا توجد سنة مالية.');
          const rows: ReportRow[] = [];
          s.forecast.indicators.forEach((m, mi) => {
            const act = s.actual.indicators[mi];
            rows.push({ code: m.code, title: m.title, weight: m.weight, score: act.score, fscore: m.score, _style: 'strong' });
            m.subs.forEach((x, si) => {
              const ax = act.subs[si];
              rows.push({ code: x.code, title: `${x.title} (${x.unit})`, weight: x.weight, ratio: ax.ratio, score: ax.score, fratio: x.ratio, fscore: x.score, rule: x.bands.map((b) => b.rule).join('؛ '), _level: 1 });
            });
          });
          return {
            rows, subtitle: `السنة المالية ${s.year.name}: من ${s.from} إلى ${s.to} (مضى ${s.elapsed}% من السنة)`,
            summary: [
              { label: 'درجة الأداء المالي الفعلية', value: s.actual.score, type: 'percent' }, { label: 'المتوقعة لنهاية السنة', value: s.forecast.score, type: 'percent' },
              { label: 'التقدير المتوقع', value: grade(s.forecast.score).label },
            ],
            notes: ['المتوقع يحوّل حركة الإيرادات والمصروفات حتى تاريخه إلى سنة كاملة، والأرصدة كما هي.', 'المرجع: دليل حوكمة الجمعيات الأهلية — الجزء الثالث: معيار السلامة المالية، الفصل الثاني.'],
          };
        },
      },
      {
        ...base, code: 'governance.figures', category: 'السلامة المالية', title: 'الأرقام المالية ومصدرها من الدليل المحاسبي',
        description: 'كل رقم تستخدمه المعادلات، وقيمته، والحسابات التي جُمع منها وفق ربط الحسابات في الإعدادات',
        filters: [{ key: 'to', label: 'حتى تاريخ', type: 'date', default: 'today', required: true }], indentColumn: 'label',
        columns: [{ key: 'label', label: 'البند' }, { key: 'amount', label: 'المبلغ', type: 'money' }, { key: 'source', label: 'المصدر في الدليل' }],
        run: async (u, f) => {
          const s = await this.finance.snapshot(org(u).organizationId, f.to ?? today());
          if (!s) return none('النظام المالي غير مهيأ: لا توجد سنة مالية.');
          const rows: ReportRow[] = [];
          for (const def of FIGURES) {
            rows.push({ label: def.label, amount: s.figures[def.key], source: def.source, _style: 'strong' });
            for (const p of s.breakdown[def.key] ?? []) rows.push({ label: `${p.code} ${p.name}`, amount: p.amount, _level: 1, _style: 'muted' });
          }
          return { rows, subtitle: `السنة المالية ${s.year.name}: من ${s.from} إلى ${s.to}` };
        },
      },
      {
        ...base, code: 'governance.trend', category: 'السلامة المالية', title: 'اتجاه الأداء المالي الشهري والتنبؤ',
        description: 'درجة الأداء المالي في نهاية كل شهر (تراكمياً ومحوّلة لسنة كاملة)، وميل الاتجاه، والدرجة المتوقعة بنهاية السنة',
        filters: [{ key: 'to', label: 'حتى تاريخ', type: 'date', default: 'today', required: true }], orientation: 'landscape',
        columns: [
          { key: 'month', label: 'الشهر' }, { key: 'score', label: 'درجة الأداء المالي', type: 'percent' },
          ...['FIN-1', 'FIN-2', 'FIN-3', 'FIN-4', 'FIN-5'].map((c, i) => ({ key: c, label: ['الإدارية', 'البرامج', 'الاستدامة', 'جمع الأموال', 'الالتزامات'][i], type: 'percent' as const })),
        ],
        run: async (u, f) => {
          const s = await this.finance.series(org(u).organizationId, f.to ?? today());
          if (!s) return none('النظام المالي غير مهيأ: لا توجد سنة مالية.');
          return {
            rows: s.points.map((p) => ({ month: p.month, score: p.score, ...p.indicators })),
            summary: [
              { label: 'ميل الاتجاه (نقطة/شهر)', value: s.slope, type: 'number' }, { label: 'المتوقع بنهاية السنة', value: s.projected, type: 'percent' },
              { label: 'الأشهر المتبقية', value: s.monthsLeft, type: 'number' },
            ],
          };
        },
      },
      {
        ...base, code: 'governance.alerts', category: 'الإنذار المبكر', title: 'الإنذارات والإشارات الحالية',
        description: 'المواعيد النظامية القريبة والمتأخرة، ومؤشرات السلامة المالية المعرضة لخسارة الدرجة، والفجوات في التقييم، والإجراءات المتأخرة',
        filters: [selectFilter('level', 'المستوى', LEVEL), selectFilter('all', 'المؤجلة', { '1': 'تشمل المؤجلة' }, 'بدون المؤجلة')], orientation: 'landscape',
        columns: [
          { key: 'level', label: 'المستوى' }, { key: 'category', label: 'المجال' }, { key: 'title', label: 'الإنذار' }, { key: 'detail', label: 'التفاصيل' },
          { key: 'ref', label: 'المرجع' }, { key: 'due', label: 'الموعد', type: 'date' }, { key: 'impact', label: 'الأثر', type: 'number' }, { key: 'ack', label: 'مؤجل حتى' },
        ],
        run: async (u, f) => {
          const r = await this.gov.alerts(org(u), f.all === '1');
          return {
            rows: r.items.filter((x) => !f.level || x.level === f.level).map((x) => ({
              level: ar(LEVEL, x.level), category: x.categoryLabel, title: x.title, detail: x.detail, ref: x.ref, due: x.due, impact: x.impact, ack: x.ack?.until ?? null,
            })),
            summary: [{ label: 'حرجة', value: r.counts.critical, type: 'number' }, { label: 'تحذيرات', value: r.counts.warning, type: 'number' }, { label: 'تنبيهات', value: r.counts.info, type: 'number' }],
          };
        },
      },
      {
        ...base, code: 'governance.actions', category: 'فرص التحسين', title: 'خطة التحسين ومتابعة التنفيذ',
        description: 'إجراءات التحسين بالمسؤول والموعد ونسبة الإنجاز والدرجات المتوقع كسبها',
        filters: [selectFilter('status', 'الحالة', ACTION_STATUS_AR), selectFilter('priority', 'الأولوية', PRIORITY_AR)], orientation: 'landscape', link: '/governance/actions',
        columns: [
          { key: 'code', label: 'الرمز' }, { key: 'title', label: 'الإجراء' }, { key: 'itemCode', label: 'البند' }, { key: 'ownerName', label: 'المسؤول' },
          { key: 'dueDate', label: 'الموعد', type: 'date' }, { key: 'priority', label: 'الأولوية' }, { key: 'status', label: 'الحالة' },
          { key: 'progress', label: 'الإنجاز', type: 'percent' }, { key: 'expectedGain', label: 'الكسب المتوقع', type: 'number', total: true }, { key: 'overdue', label: 'متأخر', type: 'bool' },
        ],
        run: async (u, f) => {
          const rows = (await this.gov.actions(org(u))).filter((x) => (!f.status || x.status === f.status) && (!f.priority || x.priority === f.priority));
          return {
            rows: rows.map((x) => ({ ...x, priority: x.priorityLabel, status: x.statusLabel })),
            summary: [
              { label: 'الإجراءات', value: rows.length, type: 'number' }, { label: 'المنجزة', value: rows.filter((x) => x.status === 'done').length, type: 'number' },
              { label: 'المتأخرة', value: rows.filter((x) => x.overdue).length, type: 'number' },
            ],
          };
        },
      },
      {
        ...base, code: 'governance.calendar', category: 'الإنذار المبكر', title: 'تقويم الالتزامات النظامية',
        description: 'اجتماعات المجلس والجمعية العمومية والتقارير الربعية والسنوية ومواعيد الرفع للمركز، وحالة الالتزام بكل موعد',
        filters: [{ key: 'year', label: 'السنة المالية', type: 'year', default: 'currentYear' }, selectFilter('kind', 'النوع', OBLIGATION_AR as Record<string, string>)], orientation: 'landscape',
        columns: [
          { key: 'title', label: 'الالتزام' }, { key: 'kind', label: 'النوع' }, { key: 'dueDate', label: 'الموعد', type: 'date' }, { key: 'doneDate', label: 'تاريخ الإنجاز', type: 'date' },
          { key: 'state', label: 'الحالة' }, { key: 'refs', label: 'بنود الدليل' }, { key: 'evidence', label: 'الشاهد' },
        ],
        run: async (u, f) => {
          const rows = (await this.gov.obligations(org(u), f.year ? Number(f.year) : undefined)).filter((o) => !f.kind || o.kind === f.kind);
          return {
            rows: rows.map((o) => ({ title: o.title, kind: o.kindLabel, dueDate: o.dueDate, doneDate: o.doneDate, state: ar(OBL_STATE, o.state), refs: o.refs.join('، '), evidence: o.evidence })),
            summary: [
              { label: 'الالتزامات', value: rows.length, type: 'number' }, { label: 'في موعدها', value: rows.filter((o) => o.state === 'done').length, type: 'number' },
              { label: 'متأخرة', value: rows.filter((o) => o.state === 'overdue' || o.state === 'late_done').length, type: 'number' },
            ],
          };
        },
      },
      {
        ...base, code: 'governance.history', category: 'الدرجة الكلية', title: 'مقارنة دورات التقييم',
        description: 'تطور الدرجة الكلية ومحاورها عبر دورات التقييم الذاتي والتجريبي والرسمي',
        columns: [
          { key: 'code', label: 'الرمز' }, { key: 'title', label: 'التقييم' }, { key: 'kind', label: 'النوع' }, { key: 'periodTo', label: 'نهاية الفترة', type: 'date' },
          { key: 'status', label: 'الحالة' }, { key: 'CMP', label: 'الامتثال', type: 'percent' }, { key: 'TRN', label: 'الشفافية', type: 'percent' },
          { key: 'FIN', label: 'السلامة المالية', type: 'percent' }, { key: 'overall', label: 'الكلية', type: 'percent' }, { key: 'grade', label: 'التقدير' },
        ],
        link: '/governance/assessments/{id}',
        run: async (u) => {
          const rows = await this.gov.assessments(org(u));
          return rows.filter((r) => r.scores).map((r) => ({
            id: r.id, code: r.code, title: r.title, kind: ar(KIND_AR, r.kind), periodTo: r.periodTo, status: r.statusLabel,
            ...Object.fromEntries(r.scores!.axes.map((x) => [x.code, x.score])), overall: r.scores!.overall, grade: r.scores!.grade,
          }));
        },
      },
      {
        ...base, code: 'governance.guide', category: 'الدليل', title: 'دليل بطاقات التقييم',
        description: 'المؤشرات والممارسات والبنود بدرجاتها وآلية تقييمها كما في أدلة المركز الوطني، للاستخدام في التحضير والتوعية',
        filters: [selectFilter('standard', 'المعيار', STD_SHORT)], orientation: 'landscape', indentColumn: 'title',
        columns: [{ key: 'code', label: 'الرمز' }, { key: 'title', label: 'العنوان / السؤال' }, { key: 'points', label: 'الدرجة', type: 'number' }, { key: 'method', label: 'آلية التقييم' }, { key: 'refs', label: 'المصدر النظامي' }],
        run: async (_u, f) => {
          const rows: ReportRow[] = [];
          for (const s of STANDARDS) {
            if (f.standard && s.code !== f.standard) continue;
            rows.push({ code: s.code, title: `معيار ${s.title}`, points: 100, _style: 'group' });
            for (const i of s.indicators) {
              rows.push({ code: i.code, title: i.title, points: i.weight, _level: 1, _style: 'strong' });
              for (const p of i.practices) {
                rows.push({ code: p.code, title: p.title, points: p.items.reduce((t, x) => t + x.points, 0), refs: p.refs?.join('؛ ') ?? null, _level: 2 });
                for (const it of p.items) rows.push({ code: it.code, title: it.steps.map((st) => st.q).join(' ← '), points: it.points, method: [...new Set(it.steps.map((st) => METHOD[st.m]))].join('، '), _level: 3, _style: 'muted' });
              }
            }
          }
          return { rows, notes: STANDARDS.map((s) => s.source) };
        },
      },
    ];
    this.registry.register(defs);
  }
}
