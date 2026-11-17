import { Injectable, OnModuleInit } from '@nestjs/common';
import { org, periodFilters, within } from '../../core/reports/report-helpers';
import { ReportDefinition } from '../../core/reports/report.types';
import { ReportsRegistry } from '../../core/reports/reports.registry';
import { DocumentsService } from './documents.service';
import { FeedbackService } from './feedback.service';
import { ImprovementService } from './improvement.service';
import { QUALITY_PERMISSIONS as P } from './quality.manifest';

const SEVERITY: Record<string, string> = { minor: 'بسيطة', major: 'جسيمة' };
const KIND: Record<string, string> = { risk: 'خطر', opportunity: 'فرصة' };
const yes = (b: unknown) => (b ? 'نعم' : null);

/** تقارير إدارة الجودة في البنية الموحدة: سجلات قابلة للتصدير، مع بقاء التقرير الدوري لوحةً في التبويب نفسه */
@Injectable()
export class QualityReports implements OnModuleInit {
  constructor(
    private readonly registry: ReportsRegistry,
    private readonly improvement: ImprovementService,
    private readonly feedback: FeedbackService,
    private readonly documents: DocumentsService,
  ) {}

  onModuleInit() {
    const base = { module: 'quality', permission: P.reports };
    const defs: ReportDefinition[] = [
      {
        ...base, code: 'quality.ncrs', category: 'التحسين', title: 'سجل حالات عدم المطابقة', description: 'الحالات المكتشفة في الفترة ومصدرها وخطورتها وحالة إجراءاتها التصحيحية',
        filters: periodFilters(), link: '/quality/ncr/{id}', orientation: 'landscape',
        columns: [
          { key: 'code', label: 'الرقم' }, { key: 'title', label: 'الوصف' }, { key: 'sourceLabel', label: 'المصدر' }, { key: 'severity', label: 'الخطورة' },
          { key: 'departmentName', label: 'الإدارة' }, { key: 'detectedDate', label: 'تاريخ الاكتشاف', type: 'date' }, { key: 'dueDate', label: 'الموعد', type: 'date' },
          { key: 'statusLabel', label: 'الحالة' }, { key: 'actions', label: 'الإجراءات', type: 'number', total: true }, { key: 'actionsDone', label: 'المنفذ', type: 'number', total: true },
          { key: 'daysOpen', label: 'الأيام', type: 'number' }, { key: 'overdue', label: 'متأخرة' },
        ],
        run: async (u, f) => (await this.improvement.ncrs(org(u), {})).filter((n) => within(n.detectedDate, f.from, f.to))
          .map((n) => ({ ...n, severity: SEVERITY[n.severity] ?? n.severity, overdue: yes(n.overdue) })),
      },
      {
        ...base, code: 'quality.audits', category: 'المراجعات', title: 'المراجعات الداخلية ونتائجها', description: 'المراجعات المخططة في الفترة وحالتها وعدد النتائج حسب النوع',
        filters: periodFilters(), link: '/quality/audits/{id}', orientation: 'landscape',
        columns: [
          { key: 'code', label: 'الرقم' }, { key: 'title', label: 'المراجعة' }, { key: 'departmentName', label: 'الإدارة' }, { key: 'leadAuditor', label: 'المراجع الرئيس' },
          { key: 'plannedDate', label: 'المخطط', type: 'date' }, { key: 'actualDate', label: 'المنفذ', type: 'date' }, { key: 'statusLabel', label: 'الحالة' },
          { key: 'major', label: 'جسيمة', type: 'number', total: true }, { key: 'minor', label: 'بسيطة', type: 'number', total: true },
          { key: 'observation', label: 'ملاحظات', type: 'number', total: true }, { key: 'ofi', label: 'فرص تحسين', type: 'number', total: true },
        ],
        run: async (u, f) => (await this.improvement.audits(org(u))).filter((a) => within(a.plannedDate, f.from, f.to)).map((a) => ({ ...a, ...a.findings })),
      },
      {
        ...base, code: 'quality.risks', category: 'التحسين', title: 'سجل المخاطر والفرص', description: 'المخاطر والفرص مرتبة حسب الدرجة، مع المعالجة والإجراءات المفتوحة',
        link: '/quality/risks', orientation: 'landscape',
        columns: [
          { key: 'code', label: 'الرقم' }, { key: 'kind', label: 'النوع' }, { key: 'title', label: 'الوصف' }, { key: 'departmentName', label: 'الإدارة' },
          { key: 'score', label: 'الدرجة', type: 'number' }, { key: 'levelLabel', label: 'المستوى' }, { key: 'residualScore', label: 'الدرجة المتبقية', type: 'number' },
          { key: 'treatmentLabel', label: 'المعالجة' }, { key: 'actionsOpen', label: 'إجراءات مفتوحة', type: 'number', total: true }, { key: 'reviewDue', label: 'تجاوزت المراجعة' },
        ],
        run: async (u) => (await this.improvement.risks(org(u))).map((r) => ({ ...r, kind: KIND[r.kind] ?? r.kind, reviewDue: yes(r.reviewDue) })),
      },
      {
        ...base, code: 'quality.objectives', category: 'الأهداف', title: 'أهداف الجودة ومؤشراتها', description: 'كل هدف ومؤشره والمستهدف وآخر قياس ونسبة الإنجاز',
        filters: [{ key: 'year', label: 'السنة', type: 'year', default: 'currentYear', required: true }], link: '/quality/objectives',
        columns: [
          { key: 'title', label: 'الهدف' }, { key: 'kpi', label: 'المؤشر' }, { key: 'departmentName', label: 'الإدارة' }, { key: 'unit', label: 'الوحدة' },
          { key: 'baseline', label: 'خط الأساس', type: 'number' }, { key: 'target', label: 'المستهدف', type: 'number' }, { key: 'current', label: 'الحالي', type: 'number' },
          { key: 'progress', label: 'الإنجاز', type: 'percent' }, { key: 'statusLabel', label: 'الحالة' },
        ],
        run: async (u, f) => (await this.improvement.objectives(org(u), Number(f.year))).rows.filter((o) => o.isActive),
      },
      {
        ...base, code: 'quality.complaints', category: 'رضا المعنيين', title: 'سجل الشكاوى', description: 'الشكاوى المستلمة في الفترة وقناتها ومدة معالجتها ورضا المشتكي',
        filters: periodFilters(), link: '/quality/complaints', orientation: 'landscape',
        columns: [
          { key: 'code', label: 'الرقم' }, { key: 'subject', label: 'الموضوع' }, { key: 'category', label: 'التصنيف' }, { key: 'channelLabel', label: 'القناة' },
          { key: 'partyLabel', label: 'الجهة' }, { key: 'departmentName', label: 'الإدارة' }, { key: 'receivedDate', label: 'الاستلام', type: 'date' },
          { key: 'resolvedDate', label: 'المعالجة', type: 'date' }, { key: 'days', label: 'الأيام', type: 'number' }, { key: 'statusLabel', label: 'الحالة' },
          { key: 'satisfaction', label: 'الرضا', type: 'number' }, { key: 'late', label: 'متأخرة' },
        ],
        run: async (u, f) => (await this.feedback.complaints(org(u), {})).rows.filter((c) => within(c.receivedDate, f.from, f.to)).map((c) => ({ ...c, late: yes(c.late) })),
      },
      {
        ...base, code: 'quality.surveys', category: 'رضا المعنيين', title: 'استبانات قياس الرضا', description: 'الاستبانات وفئتها وعدد الردود ومؤشر الرضا لكل استبانة',
        link: '/quality/surveys/{id}',
        columns: [
          { key: 'title', label: 'الاستبانة' }, { key: 'audienceLabel', label: 'الفئة' }, { key: 'responses', label: 'الردود', type: 'number', total: true },
          { key: 'index', label: 'مؤشر الرضا', type: 'percent' }, { key: 'status', label: 'الحالة' },
        ],
        run: async (u) => (await this.feedback.surveys(org(u))).map((s) => ({ ...s, status: ({ draft: 'مسودة', open: 'مفتوحة', closed: 'مغلقة' } as Record<string, string>)[s.status] ?? s.status })),
      },
      {
        ...base, code: 'quality.documents', category: 'الوثائق', title: 'سجل الوثائق المضبوطة', description: 'الوثائق وإصداراتها وحالتها ومواعيد مراجعتها والنسخ الموزعة',
        link: '/quality/documents/{id}', orientation: 'landscape',
        columns: [
          { key: 'code', label: 'الرمز' }, { key: 'title', label: 'العنوان' }, { key: 'typeLabel', label: 'النوع' }, { key: 'departmentName', label: 'الإدارة' },
          { key: 'revisionLabel', label: 'الإصدار' }, { key: 'statusLabel', label: 'الحالة' }, { key: 'effectiveDate', label: 'السريان', type: 'date' },
          { key: 'nextReviewDate', label: 'المراجعة القادمة', type: 'date' }, { key: 'copies', label: 'النسخ', type: 'number', total: true },
          { key: 'pendingAck', label: 'بانتظار الإقرار', type: 'number', total: true }, { key: 'reviewOverdue', label: 'تجاوزت المراجعة' },
        ],
        run: async (u) => (await this.documents.list(org(u), {})).rows.filter((d) => d.source === 'quality').map((d) => ({ ...d, reviewOverdue: yes(d.reviewOverdue) })),
      },
    ];
    this.registry.register(defs);
  }
}
