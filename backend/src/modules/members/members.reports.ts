import { Injectable, OnModuleInit } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { ar, org, periodFilters, selectFilter, within } from '../../core/reports/report-helpers';
import { ReportDefinition } from '../../core/reports/report.types';
import { ReportsRegistry } from '../../core/reports/reports.registry';
import { APP_STATUS_AR } from './applications.service';
import { MemApplication, MemInvoice, MemMember } from './entities/members.entity';
import { MEMBER_STATUS_AR, MemCore, today } from './mem-core.service';
import { ageOn } from './mem-forms';
import { MEMBER_PERMISSIONS as P } from './members.manifest';
import { INVOICE_STATUS_AR, METHOD_AR } from './members.service';
import { MemReportsService } from './reports.service';

const GENDER: Record<string, string> = { male: 'ذكر', female: 'أنثى' };
const KIND: Record<string, string> = { new: 'اشتراك جديد', renewal: 'تجديد' };
const yes = (b: unknown) => (b ? 'نعم' : null);

/** تقارير العضوية في البنية الموحدة، مع بقاء لوحة تقارير العضوية السابقة تبويبًا في الشاشة نفسها */
@Injectable()
export class MembersReports implements OnModuleInit {
  constructor(private readonly registry: ReportsRegistry, private readonly reports: MemReportsService, private readonly core: MemCore, private readonly db: DataSource) {}

  onModuleInit() {
    const base = { module: 'members', permission: P.reports };
    const defs: ReportDefinition[] = [
      {
        ...base, code: 'members.register', category: 'الأعضاء', title: 'سجل الأعضاء', description: 'الأعضاء ونوع العضوية وحالتها الفعلية ومدة الاشتراك وحق التصويت',
        filters: [selectFilter('status', 'الحالة', MEMBER_STATUS_AR), selectFilter('gender', 'الجنس', GENDER)], link: '/members/list/{id}', orientation: 'landscape',
        columns: [
          { key: 'memberNo', label: 'رقم العضوية' }, { key: 'fullName', label: 'الاسم' }, { key: 'typeName', label: 'نوع العضوية' }, { key: 'gender', label: 'الجنس' },
          { key: 'age', label: 'العمر', type: 'number' }, { key: 'nationality', label: 'الجنسية' }, { key: 'city', label: 'المدينة' }, { key: 'mobile', label: 'الجوال' },
          { key: 'joinedOn', label: 'الانضمام', type: 'date' }, { key: 'endDate', label: 'نهاية الاشتراك', type: 'date' }, { key: 'status', label: 'الحالة' }, { key: 'voting', label: 'حق التصويت' },
        ],
        run: async (u, f) => {
          const o = org(u).organizationId;
          const s = await this.core.settings(o);
          const t = today();
          const all = await this.db.getRepository(MemMember).find({ where: { organizationId: o }, order: { memberNo: 'ASC' } });
          return all.map((m) => ({ m, st: this.core.effectiveStatus(m, s) }))
            .filter((x) => (!f.status || x.st === f.status) && (!f.gender || x.m.gender === f.gender))
            .map(({ m, st }) => ({
              id: m.id, memberNo: m.memberNo, fullName: m.fullName, typeName: this.core.typeName(s, m.typeCode), gender: ar(GENDER, m.gender),
              age: m.birthDate ? ageOn(m.birthDate, t) : null, nationality: m.nationality, city: m.city, mobile: m.mobile, joinedOn: m.joinedOn, endDate: m.endDate,
              status: MEMBER_STATUS_AR[st], voting: yes(this.core.voting(m, s).eligible),
            }));
        },
      },
      {
        ...base, code: 'members.assembly', category: 'الأعضاء', title: 'كشف الجمعية العمومية', description: 'أصحاب حق التصويت في التاريخ المحدد والنصاب المطلوب لصحة الاجتماع',
        filters: [{ key: 'on', label: 'في تاريخ', type: 'date', default: 'today', required: true }], link: '/members/list/{id}',
        columns: [
          { key: 'memberNo', label: 'رقم العضوية' }, { key: 'fullName', label: 'الاسم' }, { key: 'nationalId', label: 'رقم الهوية' }, { key: 'typeName', label: 'نوع العضوية' },
          { key: 'joinedOn', label: 'الانضمام', type: 'date' }, { key: 'endDate', label: 'نهاية الاشتراك', type: 'date' }, { key: 'signature', label: 'التوقيع' },
        ],
        run: async (u, f) => {
          const a = await this.reports.assembly(org(u), f.on);
          return {
            rows: a.rows.map((r) => ({ ...r, signature: '' })),
            summary: [{ label: 'أصحاب حق التصويت', value: a.eligible, type: 'number' }, { label: 'النصاب (النصف + 1)', value: a.quorum, type: 'number' }, { label: 'بلا حق تصويت حتى الآن', value: a.pending.length, type: 'number' }],
          };
        },
      },
      {
        ...base, code: 'members.expiring', category: 'التجديد', title: 'الاشتراكات المنتهية والقريبة من الانتهاء', description: 'الأعضاء الذين تنتهي اشتراكاتهم قريبًا أو في فترة السماح أو انتهت لمتابعة التجديد',
        link: '/members/list/{id}',
        columns: [
          { key: 'memberNo', label: 'رقم العضوية' }, { key: 'fullName', label: 'الاسم' }, { key: 'typeName', label: 'نوع العضوية' }, { key: 'mobile', label: 'الجوال' },
          { key: 'endDate', label: 'نهاية الاشتراك', type: 'date' }, { key: 'status', label: 'الحالة' },
        ],
        run: async (u) => {
          const o = org(u).organizationId;
          const s = await this.core.settings(o);
          const all = await this.db.getRepository(MemMember).find({ where: { organizationId: o }, order: { endDate: 'ASC' } });
          return all.map((m) => ({ m, st: this.core.effectiveStatus(m, s) })).filter((x) => ['expiring', 'grace', 'expired'].includes(x.st)).map(({ m, st }) => ({
            id: m.id, memberNo: m.memberNo, fullName: m.fullName, typeName: this.core.typeName(s, m.typeCode), mobile: m.mobile, endDate: m.endDate, status: MEMBER_STATUS_AR[st],
          }));
        },
      },
      {
        ...base, code: 'members.applications', category: 'الطلبات', title: 'طلبات العضوية', description: 'طلبات العضوية المقدمة في الفترة ومصدرها وحالتها',
        filters: [...periodFilters(), selectFilter('status', 'الحالة', APP_STATUS_AR)], link: '/members/applications/{id}', orientation: 'landscape',
        columns: [
          { key: 'applicationNo', label: 'رقم الطلب' }, { key: 'fullName', label: 'مقدم الطلب' }, { key: 'typeName', label: 'نوع العضوية' }, { key: 'gender', label: 'الجنس' },
          { key: 'city', label: 'المدينة' }, { key: 'source', label: 'المصدر' }, { key: 'createdAt', label: 'تاريخ التقديم', type: 'date' }, { key: 'status', label: 'الحالة' },
        ],
        run: async (u, f) => {
          const o = org(u).organizationId;
          const s = await this.core.settings(o);
          const rows = await this.db.getRepository(MemApplication).find({ where: { organizationId: o }, order: { createdAt: 'DESC' } });
          return rows.filter((a) => within(a.createdAt, f.from, f.to) && (!f.status || a.status === f.status)).map((a) => ({
            id: a.id, applicationNo: a.applicationNo, fullName: a.fullName, typeName: this.core.typeName(s, a.typeCode), gender: ar(GENDER, a.gender), city: a.city,
            source: a.source === 'public' ? 'من الموقع' : 'إدخال الموظفين', createdAt: a.createdAt.toISOString().slice(0, 10), status: ar(APP_STATUS_AR, a.status),
          }));
        },
      },
      {
        ...base, code: 'members.invoices', category: 'الإيرادات', title: 'فواتير العضوية', description: 'الفواتير المسددة أو المستحقة في الفترة، مع كل الفواتير غير المسددة، وطريقة الدفع',
        filters: [...periodFilters(), selectFilter('status', 'الحالة', INVOICE_STATUS_AR)], link: '/members/invoices/{id}', orientation: 'landscape',
        columns: [
          { key: 'invoiceNo', label: 'رقم الفاتورة' }, { key: 'partyName', label: 'العضو' }, { key: 'kind', label: 'النوع' }, { key: 'typeName', label: 'نوع العضوية' },
          { key: 'dueDate', label: 'الاستحقاق', type: 'date' }, { key: 'amount', label: 'المبلغ', type: 'money', total: true }, { key: 'status', label: 'الحالة' },
          { key: 'method', label: 'طريقة الدفع' }, { key: 'paidOn', label: 'تاريخ السداد', type: 'date' }, { key: 'overdue', label: 'متأخرة' },
        ],
        run: async (u, f) => {
          const o = org(u).organizationId;
          const s = await this.core.settings(o);
          const t = today();
          const rows = await this.db.getRepository(MemInvoice).find({ where: { organizationId: o }, order: { dueDate: 'DESC' } });
          const open = (i: MemInvoice) => i.status === 'unpaid' || i.status === 'review';
          return rows.filter((i) => (open(i) || within(i.paidOn, f.from, f.to) || within(i.dueDate, f.from, f.to)) && (!f.status || i.status === f.status)).map((i) => ({
            id: i.id, invoiceNo: i.invoiceNo, partyName: i.partyName, kind: ar(KIND, i.kind), typeName: this.core.typeName(s, i.typeCode), dueDate: i.dueDate,
            amount: Number(i.amount), status: ar(INVOICE_STATUS_AR, i.status), method: i.method ? ar(METHOD_AR, i.method) : null, paidOn: i.paidOn,
            overdue: yes((i.status === 'unpaid' || i.status === 'review') && i.dueDate < t),
          }));
        },
      },
      {
        ...base, code: 'members.revenue', category: 'الإيرادات', title: 'إيرادات العضوية الشهرية', description: 'المبالغ المحصلة من الاشتراكات والتجديدات لكل شهر في الفترة',
        filters: periodFilters(),
        columns: [{ key: 'month', label: 'الشهر' }, { key: 'amount', label: 'المحصل', type: 'money', total: true }],
        run: async (u, f) => {
          const r = await this.reports.reports(org(u), { from: f.from, to: f.to });
          return {
            rows: r.revenue.monthly,
            summary: [
              { label: 'إجمالي المحصل', value: r.revenue.total, type: 'money' }, { label: 'عدد الفواتير المسددة', value: r.revenue.count, type: 'number' },
              { label: 'نسبة التجديد', value: r.renewal.rate, type: 'percent' }, { label: 'المستحق غير المسدد', value: r.outstanding.amount, type: 'money' },
            ],
          };
        },
      },
      {
        ...base, code: 'members.by-type', category: 'الأعضاء', title: 'الأعضاء الحاليون حسب النوع', description: 'عدد الأعضاء الحاليين لكل نوع عضوية، وهل للنوع حق التصويت',
        columns: [{ key: 'label', label: 'نوع العضوية' }, { key: 'count', label: 'الأعضاء', type: 'number', total: true }, { key: 'voting', label: 'حق التصويت' }],
        run: async (u) => (await this.reports.reports(org(u), {})).members.byType.map((x) => ({ ...x, voting: x.voting ? 'نعم' : 'لا' })),
      },
    ];
    this.registry.register(defs);
  }
}
