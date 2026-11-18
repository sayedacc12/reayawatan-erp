import { Injectable, OnModuleInit } from '@nestjs/common';
import { org, periodFilters, selectFilter } from '../../core/reports/report-helpers';
import { ReportDefinition } from '../../core/reports/report.types';
import { ReportsRegistry } from '../../core/reports/reports.registry';
import { CONF_AR, DOC_AR, KIND_AR, SOURCE_AR, TASK_STATUS_AR, TXN_STATUS_AR } from './comms-core.service';
import { COMMS_PERMISSIONS as P } from './comms.manifest';
import { CommsInsights } from './insights.service';

/** تقارير الاتصالات الإدارية والمهام (كل تقرير يعرض ما يحق للمستخدم رؤيته حسب السرية فقط) */
@Injectable()
export class CommsReports implements OnModuleInit {
  constructor(private readonly registry: ReportsRegistry, private readonly insights: CommsInsights) {}

  onModuleInit() {
    const base = { module: 'comms', permission: P.reports };
    const defs: ReportDefinition[] = [
      {
        ...base, code: 'comms.registry', category: 'المعاملات', title: 'سجل المعاملات (الوارد والصادر)', orientation: 'landscape',
        description: 'المعاملات والقرارات والتعاميم في الفترة بأرقامها وتصنيفها وسريتها وحالتها ومن هي عنده الآن',
        filters: [...periodFilters(), selectFilter('docType', 'النوع', DOC_AR), selectFilter('kind', 'إدارية أو مالية', KIND_AR), selectFilter('status', 'الحالة', TXN_STATUS_AR), selectFilter('confidentiality', 'السرية', CONF_AR)],
        link: '/comms/t/{id}',
        columns: [
          { key: 'refNo', label: 'الرقم' }, { key: 'createdAt', label: 'التاريخ', type: 'date' }, { key: 'docType', label: 'النوع' }, { key: 'kind', label: 'إدارية/مالية' },
          { key: 'subject', label: 'الموضوع', width: 40 }, { key: 'origin', label: 'الجهة المنشئة' }, { key: 'confidentiality', label: 'السرية' }, { key: 'status', label: 'الحالة' },
          { key: 'holder', label: 'عند' }, { key: 'dueDate', label: 'الموعد', type: 'date' }, { key: 'amount', label: 'المبلغ', type: 'money', total: true }, { key: 'voucher', label: 'رقم السند' },
        ],
        run: (u, f) => this.insights.registry(org(u), f),
      },
      {
        ...base, code: 'comms.overdue', category: 'المعاملات', title: 'المعاملات المتأخرة', description: 'المعاملات الجارية التي تجاوزت موعد إنجازها، عند من هي وكم يومًا تأخرت',
        filters: [], link: '/comms/t/{id}',
        columns: [
          { key: 'refNo', label: 'الرقم' }, { key: 'subject', label: 'الموضوع', width: 40 }, { key: 'confidentiality', label: 'السرية' }, { key: 'holder', label: 'عند' },
          { key: 'unit', label: 'الإدارة' }, { key: 'purpose', label: 'الغرض' }, { key: 'since', label: 'وصلت إليه', type: 'datetime' }, { key: 'dueDate', label: 'الموعد', type: 'date' },
          { key: 'late', label: 'أيام التأخير', type: 'number' },
        ],
        run: (u) => this.insights.overdue(org(u)),
      },
      {
        ...base, code: 'comms.units', category: 'المعاملات', title: 'حركة المعاملات حسب الإدارة', description: 'عدد الإحالات التي وصلت لكل إدارة في الفترة، والمعلق عندها والمتأخر',
        filters: periodFilters(),
        columns: [
          { key: 'unit', label: 'الإدارة' }, { key: 'received', label: 'الإحالات الواردة', type: 'number', total: true }, { key: 'transactions', label: 'المعاملات', type: 'number', total: true },
          { key: 'pending', label: 'معلقة عندها', type: 'number', total: true }, { key: 'overdue', label: 'متأخرة', type: 'number', total: true },
        ],
        run: (u, f) => this.insights.unitPerformance(org(u), f),
      },
      {
        ...base, code: 'comms.decisions', category: 'القرارات والتعاميم', title: 'الاطلاع على القرارات والتعاميم', description: 'كل قرار أو تعميم صادر وعدد الموجه إليهم ومن اطلع ومن لم يطلع',
        filters: periodFilters(), link: '/comms/t/{id}',
        columns: [
          { key: 'refNo', label: 'الرقم' }, { key: 'issuedAt', label: 'تاريخ الإصدار', type: 'date' }, { key: 'docType', label: 'النوع' }, { key: 'subject', label: 'الموضوع', width: 40 },
          { key: 'confidentiality', label: 'السرية' }, { key: 'total', label: 'الموجه إليهم', type: 'number', total: true }, { key: 'read', label: 'اطلعوا', type: 'number', total: true },
          { key: 'unread', label: 'لم يطلعوا', type: 'number', total: true }, { key: 'rate', label: 'نسبة الاطلاع', type: 'percent' },
        ],
        run: (u, f) => this.insights.decisionsRead(org(u), f),
      },
      {
        ...base, code: 'comms.tasks', category: 'المهام', title: 'سجل المهام', orientation: 'landscape', description: 'المهام في الفترة بمسؤوليها ومصادرها ومواعيدها وحالتها ونسبة إنجازها',
        filters: [...periodFilters(), selectFilter('status', 'الحالة', TASK_STATUS_AR), selectFilter('source', 'المصدر', SOURCE_AR)], link: '/comms/tasks/{id}',
        columns: [
          { key: 'refNo', label: 'الرقم' }, { key: 'title', label: 'المهمة', width: 36 }, { key: 'owner', label: 'المسؤول' }, { key: 'unit', label: 'الإدارة' },
          { key: 'source', label: 'المصدر' }, { key: 'supporters', label: 'المساندون', type: 'number' }, { key: 'dueDate', label: 'الموعد', type: 'date' }, { key: 'extended', label: 'مُدد' },
          { key: 'status', label: 'الحالة' }, { key: 'progress', label: 'الإنجاز', type: 'percent' }, { key: 'overdue', label: 'متأخرة' },
        ],
        run: (u, f) => this.insights.taskList(org(u), f),
      },
      {
        ...base, code: 'comms.tasks-by-owner', category: 'المهام', title: 'إنجاز المهام حسب المسؤول', description: 'لكل موظف: المهام المسندة إليه والمنجزة منها في موعدها والمتأخرة والممددة',
        filters: periodFilters(),
        columns: [
          { key: 'owner', label: 'المسؤول' }, { key: 'unit', label: 'الإدارة' }, { key: 'total', label: 'المهام', type: 'number', total: true }, { key: 'done', label: 'منجزة', type: 'number', total: true },
          { key: 'on_time', label: 'في موعدها', type: 'number', total: true }, { key: 'open', label: 'مفتوحة', type: 'number', total: true }, { key: 'overdue', label: 'متأخرة', type: 'number', total: true },
          { key: 'extended', label: 'مُددت', type: 'number', total: true }, { key: 'completion', label: 'نسبة الإنجاز', type: 'percent' }, { key: 'onTimeRate', label: 'الالتزام بالموعد', type: 'percent' },
        ],
        run: (u, f) => this.insights.tasksByOwner(org(u), f),
      },
    ];
    this.registry.register(defs);
  }
}
