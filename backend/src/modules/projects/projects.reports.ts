import { Injectable, OnModuleInit } from '@nestjs/common';
import { org, periodFilters, r2 } from '../../core/reports/report-helpers';
import { ReportColumn, ReportDefinition } from '../../core/reports/report.types';
import { ReportsRegistry } from '../../core/reports/reports.registry';
import { InsightsService, REPORTS } from './insights.service';
import { PROJECT_PERMISSIONS as P } from './projects.manifest';
import { STATUS_AR } from './projects.service';

const CATEGORY: Record<string, string> = {
  financial: 'الموقف المالي', hierarchy: 'الموقف المالي', donors: 'الموقف المالي',
  beneficiaries: 'التنفيذ والصرف', payments: 'التنفيذ والصرف', transfers: 'المناقلات والتعديلات', amendments: 'المناقلات والتعديلات', approvals: 'الاعتماد والمتابعة',
};
const TYPE_MAP: Record<string, ReportColumn['type']> = { money: 'money', number: 'number', date: 'date', percent: 'percent', text: 'text' };

/** تقارير إدارة المشاريع في البنية الموحدة: التقارير الثمانية السابقة نفسها، وتقرير مؤشرات التنفيذ */
@Injectable()
export class ProjectsReports implements OnModuleInit {
  constructor(private readonly registry: ReportsRegistry, private readonly insights: InsightsService) {}

  onModuleInit() {
    const legacy: ReportDefinition[] = REPORTS.map((d) => ({
      code: `projects.${d.key}`, module: 'projects', permission: P.reports, category: CATEGORY[d.key], title: d.name, description: d.description,
      filters: d.dated ? periodFilters() : [],
      columns: [], // الأعمدة تأتي مع النتيجة
      ...(['financial', 'approvals'].includes(d.key) ? { link: '/projects/{id}' } : {}),
      run: async (u, f) => {
        const r = await this.insights.report(org(u), d.key, f.from, f.to);
        const columns: ReportColumn[] = r.columns.map((c) => ({
          key: c.key, label: c.label, type: TYPE_MAP[c.type ?? 'text'] ?? 'text', total: c.type === 'money' || ['projects', 'approved', 'served', 'batches'].includes(c.key),
        }));
        return { rows: r.rows, columns };
      },
    }));
    const performance: ReportDefinition = {
      code: 'projects.performance', module: 'projects', permission: P.reports, category: 'الاعتماد والمتابعة', title: 'مؤشرات تنفيذ المشاريع',
      description: 'المستهدف والمخدوم من المستفيدين، والطلبات، ونسبة الإنفاق من الميزانية والدعم، ومدة المشروع',
      link: '/projects/{id}', orientation: 'landscape',
      columns: [
        { key: 'code', label: 'رقم المشروع' }, { key: 'name', label: 'المشروع' }, { key: 'statusLabel', label: 'حالة الاعتماد' },
        { key: 'startDate', label: 'البداية', type: 'date' }, { key: 'endDate', label: 'النهاية', type: 'date' },
        { key: 'target', label: 'المستهدف', type: 'number', total: true }, { key: 'served', label: 'المخدومون', type: 'number', total: true },
        { key: 'reach', label: 'نسبة التحقق', type: 'percent' }, { key: 'requests', label: 'الطلبات', type: 'number', total: true },
        { key: 'openRequests', label: 'طلبات مفتوحة', type: 'number', total: true }, { key: 'budget', label: 'الميزانية', type: 'money', total: true },
        { key: 'spent', label: 'المصروف', type: 'money', total: true }, { key: 'budgetUse', label: 'من الميزانية', type: 'percent' },
      ],
      run: async (u) => {
        const { projects } = await this.insights.rows(org(u));
        return projects.map((p) => ({
          id: p.id, code: p.code, name: p.name, statusLabel: STATUS_AR[p.approvalStatus], startDate: p.startDate, endDate: p.endDate,
          target: p.targetBeneficiaries, served: p.served, reach: p.targetBeneficiaries ? r2((p.served / p.targetBeneficiaries) * 100) : null,
          requests: p.requests.total, openRequests: p.requests.open, budget: p.budget, spent: p.spent,
          budgetUse: p.budget ? r2((p.spent / Number(p.budget)) * 100) : null,
        }));
      },
    };
    this.registry.register([...legacy, performance]);
  }
}
