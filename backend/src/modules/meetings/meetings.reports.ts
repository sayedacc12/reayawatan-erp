import { Injectable, OnModuleInit } from '@nestjs/common';
import { org, periodFilters, selectFilter } from '../../core/reports/report-helpers';
import { ReportDefinition } from '../../core/reports/report.types';
import { ReportsRegistry } from '../../core/reports/reports.registry';
import { MeetingsInsights } from './insights.service';
import { KIND_AR, STATUS_AR } from './meetings-core.service';
import { MEETINGS_PERMISSIONS as P } from './meetings.manifest';

const TASK_STATUS: Record<string, string> = { open: 'المفتوحة', done: 'المنجزة', overdue: 'المتأخرة' };

/** تقارير الاجتماعات والقرارات (كل تقرير يعرض ما يحق للمستخدم رؤيته فقط؛ الاجتماعات السرية لحاضريها) */
@Injectable()
export class MeetingsReports implements OnModuleInit {
  constructor(private readonly registry: ReportsRegistry, private readonly insights: MeetingsInsights) {}

  onModuleInit() {
    const base = { module: 'meetings', permission: P.reports };
    const defs: ReportDefinition[] = [
      {
        ...base, code: 'meetings.register', category: 'الاجتماعات', title: 'سجل الاجتماعات', orientation: 'landscape',
        description: 'الاجتماعات في الفترة لكل جهة: نوعها وطريقة انعقادها وحالتها والمدعوون والحاضرون والنصاب وعدد البنود والتوصيات',
        filters: [...periodFilters(), selectFilter('kind', 'الجهة', KIND_AR), selectFilter('status', 'الحالة', STATUS_AR)], link: '/meetings/m/{id}',
        columns: [
          { key: 'refNo', label: 'الرقم' }, { key: 'date', label: 'التاريخ', type: 'date' }, { key: 'body', label: 'الجهة' }, { key: 'title', label: 'الاجتماع', width: 34 },
          { key: 'type', label: 'النوع' }, { key: 'mode', label: 'الانعقاد' }, { key: 'status', label: 'الحالة' }, { key: 'invited', label: 'المدعوون', type: 'number', total: true },
          { key: 'present', label: 'الحاضرون', type: 'number', total: true }, { key: 'attendanceRate', label: 'نسبة الحضور', type: 'percent' }, { key: 'quorum', label: 'النصاب' },
          { key: 'items', label: 'البنود', type: 'number', total: true }, { key: 'recs', label: 'التوصيات', type: 'number', total: true },
        ],
        run: (u, f) => this.insights.meetingsReport(org(u), f),
      },
      {
        ...base, code: 'meetings.attendance', category: 'الاجتماعات', title: 'حضور الأعضاء', description: 'لكل عضو: عدد الاجتماعات المدعو لها والحضور والغياب بعذر وبدون عذر ونسبة الحضور، والتوقيع على المحاضر',
        filters: [...periodFilters(), selectFilter('kind', 'الجهة', KIND_AR)],
        columns: [
          { key: 'name', label: 'العضو' }, { key: 'body', label: 'الجهة' }, { key: 'invited', label: 'المدعو لها', type: 'number', total: true }, { key: 'present', label: 'حضر', type: 'number', total: true },
          { key: 'excused', label: 'بعذر', type: 'number', total: true }, { key: 'absent', label: 'غائب', type: 'number', total: true }, { key: 'rate', label: 'نسبة الحضور', type: 'percent' },
          { key: 'signed', label: 'وقّع', type: 'number', total: true }, { key: 'abstained', label: 'امتنع', type: 'number', total: true },
        ],
        run: (u, f) => this.insights.attendanceReport(org(u), f),
      },
      {
        ...base, code: 'meetings.recommendations', category: 'القرارات والتوصيات', title: 'متابعة تنفيذ التوصيات والقرارات', orientation: 'landscape',
        description: 'توصيات وقرارات المحاضر المعتمدة، ومسؤول كل منها ومهمتها وموعدها ونسبة إنجازها والمتأخر منها',
        filters: [...periodFilters(), selectFilter('kind', 'الجهة', KIND_AR), selectFilter('status', 'حالة التنفيذ', TASK_STATUS)], link: '/meetings/m/{id}',
        columns: [
          { key: 'refNo', label: 'الاجتماع' }, { key: 'date', label: 'التاريخ', type: 'date' }, { key: 'body', label: 'الجهة' }, { key: 'kind', label: 'النوع' },
          { key: 'text', label: 'النص', width: 44 }, { key: 'owner', label: 'المسؤول' }, { key: 'task', label: 'المهمة' }, { key: 'dueDate', label: 'الموعد', type: 'date' },
          { key: 'status', label: 'الحالة' }, { key: 'progress', label: 'الإنجاز', type: 'percent' }, { key: 'overdue', label: 'متأخرة' },
        ],
        run: (u, f) => this.insights.recommendationsReport(org(u), f),
      },
      {
        ...base, code: 'meetings.signatures', category: 'المحاضر', title: 'اعتماد المحاضر والتوقيعات', description: 'كل محضر صادر: إصداره وعدد الموقعين والممتنعين ومن لم يوقع، وطريقة الاعتماد (إلكتروني أو حي)',
        filters: periodFilters(), link: '/meetings/m/{id}',
        columns: [
          { key: 'refNo', label: 'الاجتماع' }, { key: 'date', label: 'التاريخ', type: 'date' }, { key: 'title', label: 'العنوان', width: 30 }, { key: 'status', label: 'الحالة' },
          { key: 'version', label: 'الإصدار', type: 'number' }, { key: 'signers', label: 'المطلوب توقيعهم', type: 'number', total: true }, { key: 'signed', label: 'وقّعوا', type: 'number', total: true },
          { key: 'abstained', label: 'امتنعوا', type: 'number', total: true }, { key: 'pending', label: 'لم يوقعوا', type: 'number', total: true }, { key: 'method', label: 'طريقة الاعتماد' },
          { key: 'adoptedAt', label: 'تاريخ الاعتماد', type: 'date' },
        ],
        run: (u, f) => this.insights.signaturesReport(org(u), f),
      },
    ];
    this.registry.register(defs);
  }
}
