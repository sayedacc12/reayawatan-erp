import { Injectable, OnModuleInit } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { ar, dynamicFilter, org, periodFilters, refNo, selectFilter } from '../../core/reports/report-helpers';
import { ReportDefinition, ReportFilters } from '../../core/reports/report.types';
import { ReportsRegistry } from '../../core/reports/reports.registry';
import { FUNDRAISING_PERMISSIONS as P } from './fundraising.manifest';
import { FundraisingReportsService } from './reports.service';

const TARGET_AR: Record<string, string> = { operational: 'تبرعات تشغيلية', program: 'تبرعات مقيدة', waqf: 'تبرعات أوقاف', case: 'حالة محددة', zakat: 'زكاة' };
const KIND_AR: Record<string, string> = { cash: 'نقدية', in_kind: 'عينية', pledge: 'وعد بالدفع' };
const STATUS_AR: Record<string, string> = { in_progress: 'قيد الاعتماد', returned: 'مُعادة للتعديل', approved: 'معتمدة', rejected: 'مرفوضة' };
const BATCH_AR: Record<string, string> = { pending: 'بانتظار اعتماد الفرصة', active: 'متاحة', closed: 'مستنفدة', cancelled: 'ملغاة' };
const MANAGER_AR: Record<string, string> = { employee: 'موظف', external: 'خارجي' };

/** تقارير الموارد المالية في البنية الموحدة (التقارير الثمانية السابقة نفسها، مع تقارير جديدة) */
@Injectable()
export class FundraisingReports implements OnModuleInit {
  constructor(private readonly registry: ReportsRegistry, private readonly reports: FundraisingReportsService, private readonly db: DataSource) {}

  onModuleInit() {
    const base = { module: 'fundraising', permission: P.reports, filters: periodFilters('الفرصة') };
    const legacy = async (name: string, u: Parameters<ReportDefinition['run']>[0], f: ReportFilters) =>
      (await this.reports.report(org(u), name, { from: f.from, to: f.to })).rows as Record<string, unknown>[];

    const defs: ReportDefinition[] = [
      {
        ...base, code: 'fundraising.donors', category: 'الداعمون', title: 'تبرعات الداعمين', description: 'إجمالي تبرعات كل داعم في الفترة (الفرص المعتمدة)',
        link: '/fundraising/donors/{id}',
        columns: [
          { key: 'donorNo', label: 'رقم الداعم' }, { key: 'name', label: 'الداعم' }, { key: 'levelName', label: 'المستوى' },
          { key: 'count', label: 'عدد الفرص', type: 'number', total: true }, { key: 'amount', label: 'الإجمالي', type: 'money', total: true },
          { key: 'zakat', label: 'منها زكاة', type: 'money', total: true }, { key: 'lastDonation', label: 'آخر تبرع', type: 'date' },
        ],
        run: async (u, f) => (await legacy('donors', u, f)).map((r) => ({ ...r, donorNo: refNo('D', r.donorNo) })),
      },
      {
        ...base, code: 'fundraising.donor-register', category: 'الداعمون', title: 'سجل الداعمين وحالة التواصل',
        description: 'كل الداعمين ببيانات التواصل وإجمالي تبرعاتهم وآخر تبرع، لمتابعة المنقطعين',
        link: '/fundraising/donors/{id}',
        filters: [
          selectFilter('type', 'نوع الداعم', { individual: 'فرد', entity: 'جهة' }),
          selectFilter('activity', 'النشاط', { active: 'تبرع خلال آخر 12 شهرًا', lapsed: 'منقطع (لا تبرع منذ 12 شهرًا)', never: 'لم يتبرع بعد' }),
        ],
        columns: [
          { key: 'donorNo', label: 'رقم الداعم' }, { key: 'name', label: 'الداعم' }, { key: 'typeLabel', label: 'النوع' }, { key: 'levelName', label: 'المستوى' },
          { key: 'managerName', label: 'مدير الدعم' }, { key: 'phone', label: 'الجوال' }, { key: 'email', label: 'البريد' }, { key: 'city', label: 'المدينة' },
          { key: 'count', label: 'عدد الفرص', type: 'number', total: true }, { key: 'amount', label: 'إجمالي التبرعات', type: 'money', total: true },
          { key: 'lastDonation', label: 'آخر تبرع', type: 'date' },
        ],
        run: async (u, f) => {
          const rows: Record<string, unknown>[] = await this.db.query(
            `SELECT d.id, d.donor_no, d.name, d.type, d.phone, d.email, d.city, l.name AS level_name, m.name AS manager_name,
                    COUNT(o.id)::int AS count, COALESCE(SUM(o.total_amount), 0)::float AS amount, MAX(o.opportunity_date)::text AS last_donation
               FROM fundraising_donors d
               LEFT JOIN fundraising_donor_levels l ON l.id = d.level_id
               LEFT JOIN fundraising_support_managers m ON m.id = d.support_manager_id
               LEFT JOIN fundraising_opportunities o ON o.donor_id = d.id AND o.status = 'approved'
              WHERE d.organization_id = $1 AND d.is_active AND ($2::text IS NULL OR d.type = $2)
              GROUP BY d.id, l.name, m.name ORDER BY d.donor_no`,
            [org(u).organizationId, f.type ?? null],
          );
          const cutoff = new Date(Date.now() - 365 * 86_400_000).toISOString().slice(0, 10);
          return rows
            .filter((r) => !f.activity || (f.activity === 'never' ? !r.last_donation
              : f.activity === 'active' ? !!r.last_donation && String(r.last_donation) >= cutoff : !!r.last_donation && String(r.last_donation) < cutoff))
            .map((r) => ({
              id: r.id, donorNo: refNo('D', r.donor_no), name: r.name, typeLabel: r.type === 'entity' ? 'جهة' : 'فرد', levelName: r.level_name,
              managerName: r.manager_name, phone: r.phone, email: r.email, city: r.city, count: r.count, amount: r.amount, lastDonation: r.last_donation,
            }));
        },
      },
      {
        ...base, code: 'fundraising.opportunities', category: 'الفرص والدفعات', title: 'سجل فرص التبرع', description: 'كل فرص التبرع في الفترة بنوعها وحالتها ومبلغها',
        link: '/fundraising/opportunities/{id}',
        filters: [
          ...periodFilters('الفرصة'),
          selectFilter('kind', 'نوع الفرصة', KIND_AR),
          selectFilter('status', 'الحالة', STATUS_AR),
          dynamicFilter('managerId', 'مدير الدعم', async (u) => (await this.db.query(
            'SELECT id AS value, name AS label FROM fundraising_support_managers WHERE organization_id = $1 ORDER BY name', [u.organizationId])) as { value: string; label: string }[]),
        ],
        columns: [
          { key: 'opportunityNo', label: 'رقم الفرصة' }, { key: 'date', label: 'التاريخ', type: 'date' }, { key: 'donorName', label: 'الداعم' },
          { key: 'kindLabel', label: 'النوع' }, { key: 'isZakat', label: 'زكاة', type: 'bool' }, { key: 'managerName', label: 'مدير الدعم' },
          { key: 'statusLabel', label: 'الحالة' }, { key: 'stageName', label: 'المرحلة الحالية' }, { key: 'amount', label: 'المبلغ', type: 'money', total: true },
          { key: 'collected', label: 'المحصّل', type: 'money', total: true }, { key: 'receiptNo', label: 'رقم السند' },
        ],
        run: async (u, f) => {
          const rows: Record<string, unknown>[] = await this.db.query(
            `SELECT o.id, o.opportunity_no, o.opportunity_date::text AS date, d.name AS donor_name, o.kind, o.is_zakat, m.name AS manager_name, o.status,
                    s.name AS stage_name, o.total_amount::float AS amount,
                    CASE WHEN o.kind = 'pledge' THEN o.collected_amount ELSE CASE WHEN o.status = 'approved' THEN o.total_amount ELSE 0 END END::float AS collected,
                    o.receipt_no
               FROM fundraising_opportunities o JOIN fundraising_donors d ON d.id = o.donor_id
               LEFT JOIN fundraising_support_managers m ON m.id = o.support_manager_id
               LEFT JOIN fundraising_approval_stages s ON s.id = o.current_stage_id
              WHERE o.organization_id = $1 AND o.opportunity_date BETWEEN $2 AND $3
                AND ($4::text IS NULL OR o.kind = $4) AND ($5::text IS NULL OR o.status = $5) AND ($6::uuid IS NULL OR o.support_manager_id = $6)
              ORDER BY o.opportunity_no DESC`,
            [org(u).organizationId, f.from, f.to, f.kind ?? null, f.status ?? null, f.managerId ?? null],
          );
          return rows.map((r) => ({
            id: r.id, opportunityNo: refNo('FR', r.opportunity_no), date: r.date, donorName: r.donor_name, kindLabel: ar(KIND_AR, r.kind), isZakat: r.is_zakat,
            managerName: r.manager_name, statusLabel: ar(STATUS_AR, r.status), stageName: r.status === 'approved' ? null : r.stage_name,
            amount: r.amount, collected: r.collected, receiptNo: r.receipt_no,
          }));
        },
      },
      {
        ...base, code: 'fundraising.monthly', category: 'الفرص والدفعات', title: 'التبرعات الشهرية', description: 'إجمالي التبرعات المعتمدة لكل شهر حسب النوع',
        columns: [
          { key: 'month', label: 'الشهر' }, { key: 'count', label: 'عدد الفرص', type: 'number', total: true }, { key: 'donors', label: 'الداعمون', type: 'number' },
          { key: 'cash', label: 'نقدية', type: 'money', total: true }, { key: 'inKind', label: 'عينية', type: 'money', total: true },
          { key: 'pledge', label: 'وعود بالدفع', type: 'money', total: true }, { key: 'zakat', label: 'منها زكاة', type: 'money', total: true },
          { key: 'total', label: 'الإجمالي', type: 'money', total: true },
        ],
        run: async (u, f) => this.db.query(
          `SELECT to_char(opportunity_date, 'YYYY-MM') AS month, COUNT(*)::int AS count, COUNT(DISTINCT donor_id)::int AS donors,
                  COALESCE(SUM(total_amount) FILTER (WHERE kind = 'cash'), 0)::float AS cash,
                  COALESCE(SUM(total_amount) FILTER (WHERE kind = 'in_kind'), 0)::float AS "inKind",
                  COALESCE(SUM(total_amount) FILTER (WHERE kind = 'pledge'), 0)::float AS pledge,
                  COALESCE(SUM(total_amount) FILTER (WHERE is_zakat), 0)::float AS zakat, SUM(total_amount)::float AS total
             FROM fundraising_opportunities WHERE organization_id = $1 AND status = 'approved' AND opportunity_date BETWEEN $2 AND $3
            GROUP BY 1 ORDER BY 1`, [org(u).organizationId, f.from, f.to]),
      },
      {
        ...base, code: 'fundraising.by-target', category: 'الفرص والدفعات', title: 'التوزيع على البرامج والجهات', description: 'المبالغ والمحجوز والمخصوم والصافي لكل جهة',
        columns: [
          { key: 'targetKind', label: 'التصنيف' }, { key: 'targetName', label: 'الجهة' }, { key: 'batches', label: 'الدفعات', type: 'number', total: true },
          { key: 'amount', label: 'المبلغ', type: 'money', total: true }, { key: 'reserved', label: 'محجوز', type: 'money', total: true },
          { key: 'spent', label: 'مخصوم', type: 'money', total: true }, { key: 'transferred', label: 'مناقلات', type: 'money', total: true },
          { key: 'net', label: 'صافي', type: 'money', total: true },
        ],
        run: async (u, f) => (await legacy('by-target', u, f)).map((r) => ({ ...r, targetKind: ar(TARGET_AR, r.targetKind) })),
      },
      {
        ...base, code: 'fundraising.batches', category: 'الفرص والدفعات', title: 'أرصدة الدفعات', description: 'كل دفعة ورصيدها الصافي بعد الحجز والصرف والمناقلة',
        link: '/fundraising/batches/{id}',
        columns: [
          { key: 'batchNo', label: 'الدفعة' }, { key: 'opportunityNo', label: 'الفرصة' }, { key: 'donorName', label: 'الداعم' }, { key: 'targetName', label: 'الجهة' },
          { key: 'isZakat', label: 'زكاة', type: 'bool' }, { key: 'statusLabel', label: 'الحالة' }, { key: 'amount', label: 'المبلغ', type: 'money', total: true },
          { key: 'reserved', label: 'محجوز', type: 'money', total: true }, { key: 'spent', label: 'مخصوم', type: 'money', total: true },
          { key: 'net', label: 'صافي', type: 'money', total: true },
        ],
        run: async (u, f) => (await legacy('batches', u, f)).map((r) => ({
          ...r, batchNo: refNo('B', r.batchNo), opportunityNo: refNo('FR', r.opportunityNo), statusLabel: ar(BATCH_AR, r.status),
        })),
      },
      {
        ...base, code: 'fundraising.zakat', category: 'الفرص والدفعات', title: 'تقرير الزكاة', description: 'أموال الزكاة ومصارفها والمتبقي منها',
        link: '/fundraising/opportunities/{id}',
        columns: [
          { key: 'opportunityNo', label: 'الفرصة' }, { key: 'donorName', label: 'الداعم' }, { key: 'date', label: 'التاريخ', type: 'date' },
          { key: 'batchNo', label: 'الدفعة' }, { key: 'targetName', label: 'المصرف' }, { key: 'amount', label: 'المبلغ', type: 'money', total: true },
          { key: 'spent', label: 'مصروف', type: 'money', total: true }, { key: 'net', label: 'المتبقي', type: 'money', total: true },
        ],
        run: async (u, f) => (await legacy('zakat', u, f)).map((r) => ({ ...r, opportunityNo: refNo('FR', r.opportunityNo), batchNo: refNo('B', r.batchNo) })),
      },
      {
        ...base, code: 'fundraising.pledges', category: 'الفرص والدفعات', title: 'الوعود بالدفع', description: 'المسدد والمتبقي على كل وعد بالدفع',
        link: '/fundraising/opportunities/{id}',
        columns: [
          { key: 'opportunityNo', label: 'الفرصة' }, { key: 'donorName', label: 'الداعم' }, { key: 'date', label: 'التاريخ', type: 'date' },
          { key: 'endDate', label: 'انتهاء المشروع', type: 'date' }, { key: 'amount', label: 'الوعد', type: 'money', total: true },
          { key: 'collected', label: 'المسدد', type: 'money', total: true }, { key: 'outstanding', label: 'المتبقي', type: 'money', total: true },
        ],
        run: async (u, f) => (await legacy('pledges', u, f)).map((r) => ({ ...r, opportunityNo: refNo('FR', r.opportunityNo) })),
      },
      {
        ...base, code: 'fundraising.banks', category: 'التحصيل والأداء', title: 'التحصيل حسب الحساب البنكي', description: 'التبرعات النقدية وسداد الوعود في كل حساب',
        columns: [
          { key: 'bankName', label: 'البنك' }, { key: 'accountNumber', label: 'رقم الحساب' }, { key: 'count', label: 'العمليات', type: 'number', total: true },
          { key: 'donations', label: 'تبرعات نقدية', type: 'money', total: true }, { key: 'pledgeCollections', label: 'سداد وعود', type: 'money', total: true },
          { key: 'total', label: 'الإجمالي', type: 'money', total: true },
        ],
        run: (u, f) => legacy('banks', u, f),
      },
      {
        ...base, code: 'fundraising.managers', category: 'التحصيل والأداء', title: 'أداء مدراء الدعم', description: 'الداعمون والفرص والمبالغ لكل مدير دعم',
        columns: [
          { key: 'name', label: 'مدير الدعم' }, { key: 'kindLabel', label: 'النوع' }, { key: 'donors', label: 'الداعمون', type: 'number', total: true },
          { key: 'count', label: 'الفرص', type: 'number', total: true }, { key: 'amount', label: 'الإجمالي', type: 'money', total: true },
          { key: 'average', label: 'متوسط الفرصة', type: 'money' },
        ],
        run: async (u, f) => (await legacy('managers', u, f)).map((r) => ({ ...r, kindLabel: ar(MANAGER_AR, r.kind) })),
      },
      {
        ...base, code: 'fundraising.levels', category: 'التحصيل والأداء', title: 'مستويات الداعمين', description: 'التبرعات وعدد الداعمين حسب المستوى',
        columns: [
          { key: 'name', label: 'المستوى' }, { key: 'donors', label: 'الداعمون', type: 'number', total: true },
          { key: 'count', label: 'الفرص', type: 'number', total: true }, { key: 'amount', label: 'الإجمالي', type: 'money', total: true },
        ],
        run: (u, f) => legacy('levels', u, f),
      },
    ];
    this.registry.register(defs);
  }
}
