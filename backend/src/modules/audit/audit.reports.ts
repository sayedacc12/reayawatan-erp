import { Injectable, OnModuleInit } from '@nestjs/common';
import { org } from '../../core/reports/report-helpers';
import { ReportDefinition, ReportFilter } from '../../core/reports/report.types';
import { ReportsRegistry } from '../../core/reports/reports.registry';
import { AUDIT_PERMISSIONS as P } from './audit.manifest';
import { InsightsService } from './insights.service';

const yes = (b: unknown) => (b ? 'نعم' : null);
const YEAR: ReportFilter = { key: 'year', label: 'سنة الخطة', type: 'year', default: 'currentYear', required: true };

/** تقارير المراجعة الداخلية في البنية الموحدة (على بيانات خدمة التقارير الحالية نفسها) */
@Injectable()
export class AuditReports implements OnModuleInit {
  constructor(private readonly registry: ReportsRegistry, private readonly insights: InsightsService) {}

  onModuleInit() {
    const base = { module: 'audit', permission: P.reports, filters: [YEAR] };
    const data = (u: Parameters<ReportDefinition['run']>[0], f: Record<string, string | undefined>) => this.insights.reports(org(u), Number(f.year));
    const defs: ReportDefinition[] = [
      {
        ...base, code: 'audit.plan-execution', category: 'الخطط', title: 'تنفيذ خطة المراجعة', description: 'الخطط السنوية والفرعية وعدد المهام المنفذة والساعات المخططة والفعلية',
        columns: [
          { key: 'code', label: 'الرمز' }, { key: 'title', label: 'الخطة' }, { key: 'scopeLabel', label: 'النطاق' }, { key: 'status', label: 'الحالة' },
          { key: 'total', label: 'المهام', type: 'number', total: true }, { key: 'done', label: 'المنفذة', type: 'number', total: true }, { key: 'progress', label: 'الإنجاز', type: 'percent' },
          { key: 'hours', label: 'الساعات المخططة', type: 'number', total: true }, { key: 'actualHours', label: 'الساعات الفعلية', type: 'number', total: true },
          { key: 'findings', label: 'الملاحظات', type: 'number', total: true },
        ],
        run: async (u, f) => (await data(u, f)).planExecution,
      },
      {
        ...base, code: 'audit.engagements', category: 'المهام', title: 'مهام المراجعة', description: 'مهام المراجعة في السنة ومواعيدها وساعاتها ورأي التقرير، مع المهام المتأخرة',
        link: '/audit/engagements/{id}', orientation: 'landscape',
        columns: [
          { key: 'code', label: 'الرمز' }, { key: 'title', label: 'المهمة' }, { key: 'scopeLabel', label: 'الجهة' }, { key: 'leadName', label: 'رئيس الفريق' },
          { key: 'priority', label: 'الأولوية' }, { key: 'plannedStart', label: 'البداية', type: 'date' }, { key: 'plannedEnd', label: 'النهاية', type: 'date' },
          { key: 'budgetHours', label: 'الساعات المخططة', type: 'number', total: true }, { key: 'actualHours', label: 'الساعات الفعلية', type: 'number', total: true },
          { key: 'status', label: 'الحالة' }, { key: 'opinion', label: 'رأي التقرير' }, { key: 'late', label: 'متأخرة' },
        ],
        run: async (u, f) => (await data(u, f)).engagements.map((e) => ({ ...e, budgetHours: e.budgetHours === null ? null : Number(e.budgetHours), actualHours: e.actualHours === null ? null : Number(e.actualHours), late: yes(e.late) })),
      },
      {
        ...base, code: 'audit.findings', category: 'الملاحظات', title: 'الملاحظات حسب المجال والخطورة', description: 'عدد ملاحظات المراجعة الصادرة في السنة لكل مجال حسب درجة الخطورة',
        columns: [
          { key: 'category', label: 'المجال' }, { key: 'critical', label: 'حرجة', type: 'number', total: true }, { key: 'high', label: 'مرتفعة', type: 'number', total: true },
          { key: 'medium', label: 'متوسطة', type: 'number', total: true }, { key: 'low', label: 'منخفضة', type: 'number', total: true }, { key: 'total', label: 'الإجمالي', type: 'number', total: true },
        ],
        run: async (u, f) => (await data(u, f)).findingsByCategory,
      },
      {
        ...base, code: 'audit.actions-by-unit', category: 'الإجراءات التصحيحية', title: 'تنفيذ الإجراءات حسب الوحدة', description: 'الإجراءات التصحيحية لكل وحدة: المغلق والمفتوح والمتأخر والممدد ونسبة الإغلاق',
        columns: [
          { key: 'unit', label: 'الوحدة' }, { key: 'total', label: 'الإجراءات', type: 'number', total: true }, { key: 'closed', label: 'مغلقة', type: 'number', total: true },
          { key: 'open', label: 'مفتوحة', type: 'number', total: true }, { key: 'overdue', label: 'متأخرة', type: 'number', total: true },
          { key: 'submitted', label: 'بانتظار التحقق', type: 'number', total: true }, { key: 'extended', label: 'مُددت', type: 'number', total: true },
          { key: 'closureRate', label: 'نسبة الإغلاق', type: 'percent' },
        ],
        run: async (u, f) => (await data(u, f)).byUnit,
      },
      {
        module: 'audit', permission: P.reports, code: 'audit.overdue-actions', category: 'الإجراءات التصحيحية', title: 'الإجراءات التصحيحية المتأخرة', description: 'كل إجراء تجاوز موعده ولم يُغلق، مع المسؤول ونسبة التقدم وأيام التأخير',
        link: '/audit/actions/{id}', orientation: 'landscape',
        columns: [
          { key: 'code', label: 'الرمز' }, { key: 'title', label: 'الإجراء' }, { key: 'engagement', label: 'المهمة' }, { key: 'unit', label: 'الوحدة' }, { key: 'assignee', label: 'المسؤول' },
          { key: 'priority', label: 'الأولوية' }, { key: 'due', label: 'الموعد', type: 'date' }, { key: 'daysLate', label: 'أيام التأخير', type: 'number' },
          { key: 'progress', label: 'التقدم', type: 'percent' }, { key: 'status', label: 'الحالة' },
        ],
        run: async (u) => (await this.insights.reports(org(u), new Date().getFullYear())).overdue,
      },
      {
        ...base, code: 'audit.coverage', category: 'التغطية', title: 'تغطية مجالات المراجعة', description: 'مجالات عالم المراجعة ودرجة خطورتها وآخر مراجعة لها وهل هي مستحقة أو مخططة هذه السنة',
        link: '/audit/universe',
        columns: [
          { key: 'code', label: 'الرمز' }, { key: 'name', label: 'المجال' }, { key: 'levelLabel', label: 'الخطورة' }, { key: 'score', label: 'الدرجة', type: 'number' },
          { key: 'lastAuditDate', label: 'آخر مراجعة', type: 'date' }, { key: 'nextDue', label: 'الاستحقاق القادم', type: 'date' },
          { key: 'isDue', label: 'مستحق' }, { key: 'plannedThisYear', label: 'مخطط في السنة' },
        ],
        run: async (u, f) => (await data(u, f)).riskCoverage.areas.map((a) => ({ ...a, isDue: yes(a.isDue), plannedThisYear: yes(a.plannedThisYear) })),
      },
      {
        ...base, code: 'audit.risk-coverage', category: 'التغطية', title: 'تغطية المخاطر بمهام المراجعة', description: 'مخاطر سجل المخاطر القائمة والمهام التي تغطيها في السنة، والمخاطر غير المغطاة',
        columns: [
          { key: 'code', label: 'الرمز' }, { key: 'title', label: 'الخطر' }, { key: 'levelLabel', label: 'المستوى' }, { key: 'score', label: 'الدرجة', type: 'number' },
          { key: 'unitName', label: 'الوحدة' }, { key: 'engagements', label: 'مهام المراجعة' },
        ],
        run: async (u, f) => {
          const c = (await data(u, f)).riskCoverage;
          return {
            rows: c.risks.map((r) => ({ ...r, engagements: r.engagements.join('، ') || 'غير مغطى' })),
            notes: c.registerAvailable ? [] : ['نظام المخاطر غير مفعّل لهذه الشركة، لذلك لا تظهر مخاطر في هذا التقرير.'],
          };
        },
      },
    ];
    this.registry.register(defs);
  }
}
