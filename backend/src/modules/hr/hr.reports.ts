import { Injectable, OnModuleInit } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { addDays, todayRiyadh } from '../../core/organizations/org-access';
import { ar, dynamicFilter, org, periodFilters, r2, selectFilter } from '../../core/reports/report-helpers';
import { ReportDefinition, ReportRow } from '../../core/reports/report.types';
import { ReportsRegistry } from '../../core/reports/reports.registry';
import { AttendanceService } from './attendance.service';
import { DevelopmentService } from './development.service';
import { HrCore } from './hr-core.service';
import { HR_PERMISSIONS as P } from './hr.manifest';
import { OrgService } from './org.service';
import { PayrollService } from './payroll.service';
import { CONTRACT_AR, LEAVE_STATUS_AR, PeopleService, QIWA_AR } from './people.service';
import { PerformanceService } from './performance.service';

const EMP_STATUS: Record<string, string> = { active: 'على رأس العمل', terminated: 'منتهية خدمته' };
const GENDER: Record<string, string> = { male: 'ذكر', female: 'أنثى' };
const DAYS: Record<string, string> = { '30': 'خلال 30 يومًا', '60': 'خلال 60 يومًا', '90': 'خلال 90 يومًا', '180': 'خلال 6 أشهر' };
const SUCCESSION: Record<string, string> = { none: 'بلا بديل', developing: 'بديل قيد التطوير', ready: 'بديل جاهز' };

/** تقارير الموارد البشرية: الموظفون والتوطين والوثائق، الإجازات والحضور، الرواتب والتأمينات، الأداء والتطوير والتخطيط */
@Injectable()
export class HrReports implements OnModuleInit {
  constructor(
    private readonly registry: ReportsRegistry,
    private readonly db: DataSource,
    private readonly core: HrCore,
    private readonly people: PeopleService,
    private readonly attendance: AttendanceService,
    private readonly payroll: PayrollService,
    private readonly performance: PerformanceService,
    private readonly development: DevelopmentService,
    private readonly orgs: OrgService,
  ) {}

  private units = async (u: { organizationId: string }) =>
    (await this.db.query('SELECT id AS value, name AS label FROM hr_units WHERE organization_id = $1 ORDER BY level, sort_order, name', [u.organizationId])) as { value: string; label: string }[];

  private runs = async (u: { organizationId: string }) => {
    const rows: { id: string; month: string; status: string }[] = await this.db.query(
      `SELECT id, month, status FROM hr_payroll_runs WHERE organization_id = $1 AND status <> 'cancelled' ORDER BY month DESC`, [u.organizationId]);
    const MONTHS = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];
    return rows.map((r) => ({ value: r.id, label: `${MONTHS[Number(r.month.slice(5)) - 1]} ${r.month.slice(0, 4)}${r.status === 'approved' ? '' : ' (غير معتمد)'}` }));
  };

  private runLines = async (u: Parameters<ReportDefinition['run']>[0], runId: string) => {
    const run = await this.payroll.get(org(u), runId);
    return { run, lines: run.lines };
  };

  onModuleInit() {
    const base = { module: 'hr', permission: P.reports };
    const salary = { ...base, permissionsAll: [P.salaries] };
    const runFilter = { key: 'runId', label: 'كشف الشهر', type: 'select' as const, required: true, loadOptions: (u: Parameters<ReportDefinition['run']>[0]) => this.runs(org(u)) };

    const defs: ReportDefinition[] = [
      {
        ...base, code: 'hr.employees', category: 'الموظفون', title: 'سجل الموظفين', description: 'بيانات الموظفين الوظيفية والتعاقدية',
        link: '/hr/employees/{id}', orientation: 'landscape',
        filters: [{ ...selectFilter('status', 'الحالة', EMP_STATUS), default: 'active' }, dynamicFilter('unitId', 'الوحدة الإدارية', (u) => this.units(u)),
          selectFilter('contract', 'نوع العقد', CONTRACT_AR), selectFilter('saudi', 'الجنسية', { yes: 'سعودي', no: 'غير سعودي' })],
        columns: [
          { key: 'employeeNo', label: 'الرقم الوظيفي' }, { key: 'fullName', label: 'الاسم' }, { key: 'nationalId', label: 'رقم الهوية' },
          { key: 'nationality', label: 'الجنسية' }, { key: 'gender', label: 'الجنس' }, { key: 'unitName', label: 'الوحدة' }, { key: 'jobTitle', label: 'الوظيفة' },
          { key: 'gradeName', label: 'الدرجة' }, { key: 'hireDate', label: 'تاريخ التعيين', type: 'date' }, { key: 'contract', label: 'نوع العقد' },
          { key: 'contractEnd', label: 'نهاية العقد', type: 'date' }, { key: 'qiwa', label: 'توثيق قوى' }, { key: 'status', label: 'الحالة' },
        ],
        run: async (u, f) => {
          const rows: Record<string, unknown>[] = await this.db.query(
            `SELECT e.id, e.employee_no, e.full_name, e.national_id, e.nationality, e.is_saudi, e.gender, un.name AS unit_name, j.title AS job_title, g.name AS grade_name,
                    e.hire_date::text AS hire_date, e.contract_type, e.contract_end::text AS contract_end, e.qiwa_status, e.status
               FROM hr_employees e LEFT JOIN hr_units un ON un.id = e.unit_id LEFT JOIN hr_jobs j ON j.id = e.job_id LEFT JOIN hr_grades g ON g.id = e.grade_id
              WHERE e.organization_id = $1 AND ($2::text IS NULL OR e.status = $2) AND ($3::uuid IS NULL OR e.unit_id = $3)
                AND ($4::text IS NULL OR e.contract_type = $4) AND ($5::boolean IS NULL OR e.is_saudi = $5)
              ORDER BY e.employee_no`,
            [org(u).organizationId, f.status ?? null, f.unitId ?? null, f.contract ?? null, f.saudi ? f.saudi === 'yes' : null]);
          return rows.map((r) => ({
            id: r.id, employeeNo: r.employee_no, fullName: r.full_name, nationalId: r.national_id, nationality: r.nationality, gender: ar(GENDER, r.gender),
            unitName: r.unit_name, jobTitle: r.job_title, gradeName: r.grade_name, hireDate: r.hire_date, contract: ar(CONTRACT_AR, r.contract_type),
            contractEnd: r.contract_end, qiwa: ar(QIWA_AR, r.qiwa_status), status: ar(EMP_STATUS, r.status),
          }));
        },
      },
      {
        ...base, code: 'hr.saudization', category: 'الموظفون', title: 'التوطين والتركيبة حسب الوحدة', description: 'عدد الموظفين على رأس العمل في كل وحدة، ونسبة السعوديين والنساء',
        columns: [
          { key: 'unit', label: 'الوحدة الإدارية' }, { key: 'total', label: 'الموظفون', type: 'number', total: true }, { key: 'saudi', label: 'سعوديون', type: 'number', total: true },
          { key: 'nonSaudi', label: 'غير سعوديين', type: 'number', total: true }, { key: 'saudiRate', label: 'نسبة التوطين', type: 'percent' },
          { key: 'female', label: 'نساء', type: 'number', total: true }, { key: 'femaleRate', label: 'نسبة النساء', type: 'percent' },
        ],
        run: async (u) => {
          const rows: { unit: string; total: number; saudi: number; female: number }[] = await this.db.query(
            `SELECT COALESCE(un.name, 'بدون وحدة') AS unit, COUNT(*)::int AS total, COUNT(*) FILTER (WHERE e.is_saudi)::int AS saudi,
                    COUNT(*) FILTER (WHERE e.gender = 'female')::int AS female
               FROM hr_employees e LEFT JOIN hr_units un ON un.id = e.unit_id
              WHERE e.organization_id = $1 AND e.status = 'active' GROUP BY un.name, un.level, un.sort_order ORDER BY un.level, un.sort_order`, [org(u).organizationId]);
          const t = rows.reduce((a, r) => ({ total: a.total + r.total, saudi: a.saudi + r.saudi, female: a.female + r.female }), { total: 0, saudi: 0, female: 0 });
          return {
            rows: rows.map((r) => ({ ...r, nonSaudi: r.total - r.saudi, saudiRate: r.total ? r2((r.saudi / r.total) * 100) : null, femaleRate: r.total ? r2((r.female / r.total) * 100) : null })),
            summary: [
              { label: 'الموظفون على رأس العمل', value: t.total, type: 'number' }, { label: 'نسبة التوطين', value: t.total ? r2((t.saudi / t.total) * 100) : null, type: 'percent' },
              { label: 'نسبة النساء', value: t.total ? r2((t.female / t.total) * 100) : null, type: 'percent' },
            ],
          };
        },
      },
      {
        ...base, code: 'hr.expiries', category: 'الموظفون', title: 'الوثائق والعقود القريبة من الانتهاء',
        description: 'الهويات وجوازات السفر والعقود وفترات التجربة التي تنتهي خلال المدة المختارة أو انتهت، لتجديدها في وقتها',
        filters: [{ ...selectFilter('days', 'المدة', DAYS), default: '60', required: true }], link: '/hr/employees/{id}',
        columns: [
          { key: 'employeeNo', label: 'الرقم الوظيفي' }, { key: 'fullName', label: 'الموظف' }, { key: 'unitName', label: 'الوحدة' },
          { key: 'document', label: 'الوثيقة' }, { key: 'expiry', label: 'تاريخ الانتهاء', type: 'date' }, { key: 'daysLeft', label: 'الأيام المتبقية', type: 'number' },
          { key: 'state', label: 'الحالة' },
        ],
        run: async (u, f) => {
          const today = todayRiyadh();
          const until = addDays(today, Number(f.days ?? 60));
          const rows: Record<string, unknown>[] = await this.db.query(
            `SELECT e.id, e.employee_no, e.full_name, un.name AS unit_name, d.document, d.expiry::text AS expiry
               FROM hr_employees e LEFT JOIN hr_units un ON un.id = e.unit_id
               CROSS JOIN LATERAL (VALUES ('الهوية / الإقامة', e.id_expiry), ('جواز السفر', e.passport_expiry), ('العقد', e.contract_end), ('فترة التجربة', e.probation_end)) d(document, expiry)
              WHERE e.organization_id = $1 AND e.status = 'active' AND d.expiry IS NOT NULL AND d.expiry <= $2
                AND (d.document <> 'فترة التجربة' OR d.expiry >= $3)
              ORDER BY d.expiry`, [org(u).organizationId, until, today]);
          return rows.map((r) => {
            const left = Math.round((Date.parse(String(r.expiry)) - Date.parse(today)) / 86_400_000);
            return {
              id: r.id, employeeNo: r.employee_no, fullName: r.full_name, unitName: r.unit_name, document: r.document, expiry: r.expiry, daysLeft: left,
              state: left < 0 ? 'منتهية' : left <= 30 ? 'عاجل' : 'قريبًا', _style: left < 0 ? 'strong' as const : undefined,
            };
          });
        },
      },
      {
        ...base, code: 'hr.leaves', category: 'الإجازات والحضور', title: 'سجل الإجازات', description: 'طلبات الإجازات في الفترة بنوعها وأيامها وحالتها',
        filters: [...periodFilters('بداية الإجازة'), selectFilter('status', 'الحالة', LEAVE_STATUS_AR),
          dynamicFilter('type', 'نوع الإجازة', async (u) => (await this.core.policy(u.organizationId)).leaveTypes.map((t) => ({ value: t.code, label: t.name })))],
        columns: [
          { key: 'employeeNo', label: 'الرقم الوظيفي' }, { key: 'fullName', label: 'الموظف' }, { key: 'unitName', label: 'الوحدة' }, { key: 'type', label: 'نوع الإجازة' },
          { key: 'startDate', label: 'من', type: 'date' }, { key: 'endDate', label: 'إلى', type: 'date' }, { key: 'days', label: 'الأيام', type: 'number', total: true },
          { key: 'status', label: 'الحالة' }, { key: 'decidedBy', label: 'صاحب القرار' },
        ],
        run: async (u, f) => {
          const o = org(u).organizationId;
          const types = new Map((await this.core.policy(o)).leaveTypes.map((t) => [t.code, t.name]));
          const rows: Record<string, unknown>[] = await this.db.query(
            `SELECT e.employee_no, e.full_name, un.name AS unit_name, l.leave_type, l.start_date::text AS start_date, l.end_date::text AS end_date, l.days, l.status, l.decided_by_name
               FROM hr_leave_requests l JOIN hr_employees e ON e.id = l.employee_id LEFT JOIN hr_units un ON un.id = e.unit_id
              WHERE l.organization_id = $1 AND l.start_date BETWEEN $2 AND $3 AND ($4::text IS NULL OR l.status = $4) AND ($5::text IS NULL OR l.leave_type = $5)
              ORDER BY l.start_date`, [o, f.from, f.to, f.status ?? null, f.type ?? null]);
          return rows.map((r) => ({
            employeeNo: r.employee_no, fullName: r.full_name, unitName: r.unit_name, type: types.get(String(r.leave_type)) ?? r.leave_type,
            startDate: r.start_date, endDate: r.end_date, days: r.days, status: ar(LEAVE_STATUS_AR, r.status), decidedBy: r.decided_by_name,
            _skipTotal: ['rejected', 'cancelled'].includes(String(r.status)), _style: ['rejected', 'cancelled'].includes(String(r.status)) ? 'muted' as const : undefined,
          }));
        },
      },
      {
        ...base, code: 'hr.leave-balances', category: 'الإجازات والحضور', title: 'أرصدة الإجازات', description: 'الاستحقاق والمأخوذ والمعلق والمتاح لكل موظف حسب لائحة الجمعية',
        filters: [dynamicFilter('type', 'نوع الإجازة', async (u) => (await this.core.policy(u.organizationId)).leaveTypes
          .filter((t) => t.accrual !== 'per_request').map((t) => ({ value: t.code, label: t.name })), 'اختر...', true)],
        columns: [
          { key: 'employeeNo', label: 'الرقم الوظيفي' }, { key: 'fullName', label: 'الموظف' }, { key: 'unitName', label: 'الوحدة' },
          { key: 'entitlement', label: 'الاستحقاق', type: 'number', total: true }, { key: 'taken', label: 'المأخوذ', type: 'number', total: true },
          { key: 'pending', label: 'بانتظار الاعتماد', type: 'number', total: true }, { key: 'available', label: 'المتاح', type: 'number', total: true },
        ],
        run: async (u, f) => {
          const o = org(u);
          const emps: { id: string; employee_no: number; full_name: string; unit_name: string }[] = await this.db.query(
            `SELECT e.id, e.employee_no, e.full_name, un.name AS unit_name FROM hr_employees e LEFT JOIN hr_units un ON un.id = e.unit_id
              WHERE e.organization_id = $1 AND e.status = 'active' ORDER BY e.employee_no`, [o.organizationId]);
          const rows: ReportRow[] = [];
          for (const e of emps) {
            const b = (await this.people.employeeBalances(o, e.id) as { code: string; eligible: boolean; entitlement: number; taken: number; pending: number; available: number }[])
              .find((x) => x.code === f.type);
            if (!b || !b.eligible) continue;
            rows.push({ employeeNo: e.employee_no, fullName: e.full_name, unitName: e.unit_name, entitlement: b.entitlement, taken: b.taken, pending: b.pending, available: b.available });
          }
          return rows;
        },
      },
      {
        ...base, code: 'hr.attendance', category: 'الإجازات والحضور', title: 'ملخص الحضور الشهري', description: 'أيام العمل والحضور والغياب والإجازات ودقائق التأخير لكل موظف من البصمات',
        filters: [{ key: 'month', label: 'الشهر', type: 'month', default: 'currentMonth', required: true }],
        columns: [
          { key: 'employeeNo', label: 'الرقم الوظيفي' }, { key: 'fullName', label: 'الموظف' }, { key: 'unitName', label: 'الوحدة' },
          { key: 'workDays', label: 'أيام العمل', type: 'number' }, { key: 'presentDays', label: 'حضور', type: 'number', total: true },
          { key: 'absentDays', label: 'غياب', type: 'number', total: true }, { key: 'leaveDays', label: 'إجازات', type: 'number', total: true },
          { key: 'lateMinutes', label: 'تأخير (دقيقة)', type: 'number', total: true }, { key: 'earlyMinutes', label: 'خروج مبكر (دقيقة)', type: 'number', total: true },
          { key: 'missingOut', label: 'بصمة خروج ناقصة', type: 'number', total: true }, { key: 'note', label: 'ملاحظة' },
        ],
        run: async (u, f) => {
          const s = await this.attendance.summary(org(u), f.month!);
          return {
            subtitle: s.coverageEnd ? `البيانات حتى ${s.coverageEnd}` : undefined,
            rows: s.rows.map((r) => ({
              ...r, note: r.exempt ? 'معفى من البصمة' : r.tracked ? null : 'لا توجد بصمات', _style: r.exempt ? 'muted' as const : undefined, _skipTotal: !!r.exempt,
            })),
          };
        },
      },
      {
        ...salary, code: 'hr.payroll', category: 'الرواتب والتأمينات', title: 'كشف الرواتب الشهري', description: 'تفصيل راتب كل موظف في كشف الشهر: المستحق والإضافات والاستقطاعات والصافي',
        filters: [runFilter], orientation: 'landscape',
        columns: [
          { key: 'employeeNo', label: 'الرقم' }, { key: 'fullName', label: 'الموظف' }, { key: 'unitName', label: 'الوحدة' }, { key: 'jobTitle', label: 'الوظيفة' },
          { key: 'workedDays', label: 'أيام العمل', type: 'number' }, { key: 'gross', label: 'إجمالي الراتب', type: 'money', total: true },
          { key: 'earned', label: 'المستحق', type: 'money', total: true }, { key: 'additions', label: 'إضافات', type: 'money', total: true },
          { key: 'gosiEmployee', label: 'تأمينات الموظف', type: 'money', total: true }, { key: 'otherDeductions', label: 'استقطاعات أخرى', type: 'money', total: true },
          { key: 'net', label: 'الصافي', type: 'money', total: true }, { key: 'iban', label: 'الآيبان' },
        ],
        run: async (u, f) => {
          const { run, lines } = await this.runLines(u, f.runId!);
          return {
            subtitle: `${run.monthLabel} · ${run.statusLabel}`,
            rows: lines.map((l) => ({
              employeeNo: l.employeeNo, fullName: l.fullName, unitName: l.unitName, jobTitle: l.jobTitle, workedDays: l.workedDays, gross: l.gross, earned: l.earned,
              additions: r2(l.additions.reduce((s, a) => s + a.amount, 0)), gosiEmployee: l.gosiEmployee,
              otherDeductions: r2(l.totalDeductions - l.gosiEmployee), net: l.net, iban: l.iban,
            })),
            summary: [
              { label: 'عدد الموظفين', value: lines.length, type: 'number' }, { label: 'صافي الرواتب', value: run.totals.net, type: 'money' },
              { label: 'تكلفة الجمعية', value: run.totals.employerCost, type: 'money' },
            ],
          };
        },
      },
      {
        ...salary, code: 'hr.payroll-units', category: 'الرواتب والتأمينات', title: 'تكلفة الرواتب حسب الوحدة', description: 'إجمالي المستحق والصافي وتكلفة الجمعية لكل وحدة إدارية في كشف الشهر',
        filters: [runFilter],
        columns: [
          { key: 'unitName', label: 'الوحدة الإدارية' }, { key: 'employees', label: 'الموظفون', type: 'number', total: true },
          { key: 'earned', label: 'المستحق', type: 'money', total: true }, { key: 'gosiEmployer', label: 'تأمينات على الجمعية', type: 'money', total: true },
          { key: 'net', label: 'الصافي', type: 'money', total: true }, { key: 'employerCost', label: 'التكلفة الكلية', type: 'money', total: true },
          { key: 'share', label: 'النسبة من الإجمالي', type: 'percent' },
        ],
        run: async (u, f) => {
          const { run, lines } = await this.runLines(u, f.runId!);
          const by = new Map<string, { unitName: string; employees: number; earned: number; gosiEmployer: number; net: number; employerCost: number }>();
          for (const l of lines) {
            const g = by.get(l.unitName) ?? { unitName: l.unitName, employees: 0, earned: 0, gosiEmployer: 0, net: 0, employerCost: 0 };
            g.employees++; g.earned += l.earned; g.gosiEmployer += l.gosiEmployer; g.net += l.net; g.employerCost += l.employerCost;
            by.set(l.unitName, g);
          }
          const total = lines.reduce((s, l) => s + l.employerCost, 0);
          return {
            subtitle: `${run.monthLabel} · ${run.statusLabel}`,
            rows: [...by.values()].map((g) => ({
              ...g, earned: r2(g.earned), gosiEmployer: r2(g.gosiEmployer), net: r2(g.net), employerCost: r2(g.employerCost), share: total ? r2((g.employerCost / total) * 100) : null,
            })).sort((a, b) => Number(b.employerCost) - Number(a.employerCost)),
          };
        },
      },
      {
        ...salary, code: 'hr.gosi', category: 'الرواتب والتأمينات', title: 'اشتراكات التأمينات الاجتماعية', description: 'حصة الموظف وحصة الجمعية من اشتراكات التأمينات لكل موظف في كشف الشهر',
        filters: [runFilter],
        columns: [
          { key: 'employeeNo', label: 'الرقم' }, { key: 'fullName', label: 'الموظف' }, { key: 'nationality', label: 'الجنسية' },
          { key: 'gosiNumber', label: 'رقم الاشتراك' }, { key: 'gosiEmployee', label: 'حصة الموظف', type: 'money', total: true },
          { key: 'gosiEmployer', label: 'حصة الجمعية', type: 'money', total: true }, { key: 'total', label: 'الإجمالي', type: 'money', total: true },
        ],
        run: async (u, f) => {
          const { run, lines } = await this.runLines(u, f.runId!);
          const nums = new Map((await this.db.query('SELECT id, gosi_number FROM hr_employees WHERE organization_id = $1', [org(u).organizationId]) as { id: string; gosi_number: string | null }[])
            .map((e) => [e.id, e.gosi_number]));
          return {
            subtitle: `${run.monthLabel} · ${run.statusLabel}`,
            rows: lines.map((l) => ({
              employeeNo: l.employeeNo, fullName: l.fullName, nationality: l.isSaudi ? 'سعودي' : 'غير سعودي', gosiNumber: nums.get(l.employeeId) ?? null,
              gosiEmployee: l.gosiEmployee, gosiEmployer: l.gosiEmployer, total: r2(l.gosiEmployee + l.gosiEmployer),
            })),
          };
        },
      },
      {
        ...base, code: 'hr.performance', category: 'الأداء والتطوير', title: 'نتائج تقييم الأداء', description: 'بطاقات الأداء للسنة بحالتها والدرجة النهائية والتقدير',
        filters: [{ key: 'year', label: 'السنة', type: 'year', default: 'currentYear', required: true }],
        columns: [
          { key: 'employeeNo', label: 'الرقم الوظيفي' }, { key: 'employeeName', label: 'الموظف' }, { key: 'unitName', label: 'الوحدة' }, { key: 'jobTitle', label: 'الوظيفة' },
          { key: 'objectives', label: 'الأهداف', type: 'number' }, { key: 'competencies', label: 'الجدارات', type: 'number' }, { key: 'statusLabel', label: 'حالة البطاقة' },
          { key: 'finalScore', label: 'الدرجة النهائية', type: 'number' }, { key: 'rating', label: 'التقدير' },
        ],
        run: async (u, f) => {
          const r = await this.performance.list(org(u), Number(f.year));
          const scored = r.cards.filter((c) => c.finalScore !== null);
          return {
            rows: [
              ...r.cards,
              ...r.withoutCard.map((e) => ({ employeeNo: e.employeeNo, employeeName: e.fullName, statusLabel: 'لا توجد بطاقة', _style: 'muted' as const })),
            ],
            summary: [
              { label: 'البطاقات', value: r.cards.length, type: 'number' }, { label: 'المعتمدة', value: r.cards.filter((c) => c.status === 'approved').length, type: 'number' },
              { label: 'متوسط الدرجة', value: scored.length ? r2(scored.reduce((s, c) => s + Number(c.finalScore), 0) / scored.length) : null, type: 'number' },
              { label: 'موظفون بلا بطاقة', value: r.withoutCard.length, type: 'number' },
            ],
          };
        },
      },
      {
        ...base, code: 'hr.competency-gaps', category: 'الأداء والتطوير', title: 'فجوات الجدارات', description: 'الفرق بين المستوى المطلوب في الوصف الوظيفي وآخر تقييم لكل موظف وجدارة',
        filters: [selectFilter('only', 'العرض', { gaps: 'الفجوات فقط' }, 'كل الجدارات')],
        columns: [
          { key: 'employeeNo', label: 'الرقم' }, { key: 'fullName', label: 'الموظف' }, { key: 'jobTitle', label: 'الوظيفة' }, { key: 'competency', label: 'الجدارة' },
          { key: 'required', label: 'المطلوب', type: 'number' }, { key: 'actual', label: 'الفعلي', type: 'number' }, { key: 'gap', label: 'الفجوة', type: 'number', total: true },
          { key: 'plan', label: 'خطة تطوير' },
        ],
        run: async (u, f) => {
          const g = await this.development.gaps(org(u)) as { rows: { employeeNo: number; fullName: string; jobTitle: string; plan: unknown; competencies: { name: string; required: number; actual: number | null; gap: number | null }[] }[] };
          return g.rows.flatMap((e) => e.competencies
            .filter((c) => f.only !== 'gaps' || (c.gap ?? 0) > 0)
            .map((c) => ({
              employeeNo: e.employeeNo, fullName: e.fullName, jobTitle: e.jobTitle, competency: c.name, required: c.required, actual: c.actual,
              gap: c.gap, plan: e.plan ? 'يوجد' : null, _style: (c.gap ?? 0) > 0 ? 'strong' as const : undefined,
            })));
        },
      },
      {
        ...base, code: 'hr.succession', category: 'الأداء والتطوير', title: 'الصف الثاني (الإحلال الوظيفي)', description: 'لكل وظيفة: شاغلها والوظيفة البديلة والمرشحون وجاهزيتهم',
        columns: [
          { key: 'code', label: 'الكود' }, { key: 'title', label: 'الوظيفة' }, { key: 'unitName', label: 'الوحدة' }, { key: 'holders', label: 'الشاغلون' },
          { key: 'backup', label: 'الوظيفة البديلة' }, { key: 'candidates', label: 'المرشحون وجاهزيتهم' }, { key: 'state', label: 'الحالة' },
        ],
        run: async (u) => {
          const s = await this.development.succession(org(u)) as { rows: { code: string; title: string; unitName: string; status: string; holders: { fullName: string }[]; backupJobTitle: string | null; candidates: { fullName: string; readinessLabel: string }[] }[] };
          return s.rows.map((r) => ({
            code: r.code, title: r.title, unitName: r.unitName, holders: r.holders.map((h) => h.fullName).join('، ') || 'شاغرة', backup: r.backupJobTitle,
            candidates: r.candidates.map((c) => `${c.fullName} (${c.readinessLabel})`).join('، ') || null, state: ar(SUCCESSION, r.status),
            _style: r.status === 'none' ? 'strong' as const : undefined,
          }));
        },
      },
      {
        ...base, code: 'hr.jobs', category: 'التنظيم والتخطيط', title: 'الوظائف والشواغر', description: 'كل وظيفة بعدد المعتمد والمشغول والشاغر وحالة اعتماد الوصف الوظيفي',
        columns: [
          { key: 'code', label: 'الكود' }, { key: 'title', label: 'الوظيفة' }, { key: 'unitName', label: 'الوحدة' }, { key: 'gradeName', label: 'الدرجة' },
          { key: 'headcount', label: 'المعتمد', type: 'number', total: true }, { key: 'filled', label: 'المشغول', type: 'number', total: true },
          { key: 'vacancies', label: 'الشاغر', type: 'number', total: true }, { key: 'qualityCode', label: 'كود الجودة' }, { key: 'state', label: 'الوصف الوظيفي' },
        ],
        run: async (u) => (await this.orgs.listJobs(org(u))).map((j) => ({
          ...j, state: j.status === 'approved' ? 'معتمد' : 'مسودة', _style: j.vacancies > 0 ? 'strong' as const : undefined,
        })),
      },
      {
        ...base, code: 'hr.staffing-plans', category: 'التنظيم والتخطيط', title: 'خطط التعيين وتكلفتها', description: 'الوظائف المخطط تعيينها في السنة بالعدد والتمويل والتكلفة المتوقعة',
        filters: [{ key: 'year', label: 'السنة', type: 'year', default: 'currentYear', required: true }],
        permissionsAll: [P.salaries],
        columns: [
          { key: 'jobTitle', label: 'الوظيفة' }, { key: 'unitName', label: 'الوحدة' }, { key: 'count', label: 'العدد', type: 'number', total: true },
          { key: 'filled', label: 'تم التعيين', type: 'number', total: true }, { key: 'plannedMonth', label: 'شهر التعيين', type: 'number' },
          { key: 'fundingLabel', label: 'التمويل' }, { key: 'statusLabel', label: 'الحالة' }, { key: 'monthly', label: 'التكلفة الشهرية', type: 'money', total: true },
          { key: 'yearCost', label: 'تكلفة السنة', type: 'money', total: true },
        ],
        run: async (u, f) => {
          const r = await this.orgs.listPlans(org(u), Number(f.year)) as { items: { jobTitle: string; unitName: string; count: number; filled: number; plannedMonth: number; fundingLabel: string; statusLabel: string; monthlyCost: { total: number }; yearCost: number }[] };
          return r.items.map((p) => ({ ...p, monthly: r2(p.monthlyCost.total * p.count), yearCost: p.yearCost }));
        },
      },
    ];
    this.registry.register(defs);
  }
}
