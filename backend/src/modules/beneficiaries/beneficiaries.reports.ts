import { Injectable, OnModuleInit } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { todayRiyadh } from '../../core/organizations/org-access';
import { ar, dynamicFilter, org, periodFilters, r2, selectFilter } from '../../core/reports/report-helpers';
import { ReportDefinition } from '../../core/reports/report.types';
import { ReportsRegistry } from '../../core/reports/reports.registry';
import { BENEFICIARY_PERMISSIONS as P } from './beneficiaries.manifest';

const STATUS: Record<string, string> = { new: 'جديدة', under_review: 'تحت الدراسة', eligible: 'مستحقة', ineligible: 'غير مستحقة', suspended: 'موقوفة' };
const CATEGORY: Record<string, string> = {
  orphan: 'أيتام', widow: 'أرملة', elderly: 'مسن', disability: 'ذوو الهمم', poor_family: 'أسرة محتاجة', patient: 'مريض', student: 'طالب علم', debtor: 'غارم', other: 'أخرى',
};
const GENDER: Record<string, string> = { male: 'ذكر', female: 'أنثى' };
const RESIDENCY: Record<string, string> = { citizen: 'مواطن', resident: 'مقيم', visitor: 'زائر' };
const HOUSING: Record<string, string> = { owned: 'ملك', rented: 'إيجار', shared: 'مشاركة مع أسرة', other: 'أخرى' };
const REQUEST: Record<string, string> = { in_progress: 'قيد المعالجة', returned: 'مُعاد لاستكمال البيانات', approved: 'معتمد نهائيًا', rejected: 'مرفوض', cancelled: 'ملغي' };
const AID: Record<string, string> = { cash: 'نقدية', in_kind: 'عينية', medical: 'علاج', education: 'تعليم', housing: 'سكن', seasonal: 'موسمية', other: 'أخرى' };
const TICKET: Record<string, string> = { complaint: 'شكوى', suggestion: 'اقتراح', inquiry: 'استفسار' };
const TICKET_STATUS: Record<string, string> = { open: 'جديدة', answered: 'تم الرد', closed: 'مغلقة' };
const CONTRIBUTION: Record<string, string> = { none: 'لا يوجد', awaiting: 'في انتظار رفع المستفيد', submitted: 'مرفوع ويحتاج إلى تحقق', verified: 'تم التحقق' };
const OUTCOME: Record<string, string> = { approve: 'قبول', contribution: 'قبول بمساهمة', reject: 'رفض' };
const SOURCE: Record<string, string> = { staff: 'الموظفون', portal: 'بوابة المستفيد' };

const age = (birth: unknown) => {
  if (!birth) return null;
  const b = String(birth).slice(0, 10);
  const t = todayRiyadh();
  let a = Number(t.slice(0, 4)) - Number(b.slice(0, 4));
  if (t.slice(5) < b.slice(5)) a--;
  return a;
};

/** تقارير المستفيدين: الحالات والطلبات وسير العمل والمساعدات والشكاوى والمساهمات */
@Injectable()
export class BeneficiariesReports implements OnModuleInit {
  constructor(private readonly registry: ReportsRegistry, private readonly db: DataSource) {}

  private projects = async (u: { organizationId: string }) =>
    (await this.db.query(`SELECT id AS value, name AS label FROM activities WHERE organization_id = $1 AND level = 'project' ORDER BY sort_order, name`, [u.organizationId])) as { value: string; label: string }[];

  onModuleInit() {
    const base = { module: 'beneficiaries', permission: P.reports };
    const defs: ReportDefinition[] = [
      {
        ...base, code: 'beneficiaries.register', category: 'المستفيدون', title: 'سجل المستفيدين', description: 'ملفات المستفيدين ببياناتهم الأساسية ودخلهم وعدد أفراد الأسرة',
        link: '/beneficiaries/files/{id}', orientation: 'landscape',
        filters: [
          selectFilter('status', 'حالة الملف', STATUS), selectFilter('category', 'الفئة', CATEGORY), selectFilter('gender', 'الجنس', GENDER),
          selectFilter('residency', 'الإقامة', RESIDENCY),
          dynamicFilter('city', 'المدينة', async (u) => (await this.db.query(
            `SELECT DISTINCT city AS value, city AS label FROM beneficiaries WHERE organization_id = $1 AND city IS NOT NULL AND city <> '' ORDER BY 1`, [u.organizationId])) as { value: string; label: string }[]),
        ],
        columns: [
          { key: 'fileNo', label: 'رقم الملف' }, { key: 'fullName', label: 'الاسم' }, { key: 'nationalId', label: 'رقم الهوية' }, { key: 'categoryLabel', label: 'الفئة' },
          { key: 'statusLabel', label: 'الحالة' }, { key: 'genderLabel', label: 'الجنس' }, { key: 'age', label: 'العمر', type: 'number' },
          { key: 'nationality', label: 'الجنسية' }, { key: 'city', label: 'المدينة' }, { key: 'phone', label: 'الجوال' },
          { key: 'members', label: 'أفراد الأسرة', type: 'number', total: true }, { key: 'income', label: 'الدخل الشهري', type: 'money' },
          { key: 'housingLabel', label: 'السكن' }, { key: 'createdAt', label: 'تاريخ التسجيل', type: 'date' },
        ],
        run: async (u, f) => {
          const rows: Record<string, unknown>[] = await this.db.query(
            `SELECT b.id, b.file_no, b.full_name, b.national_id, b.category, b.status, b.gender, b.birth_date::text AS birth_date, b.nationality, b.city, b.phone,
                    b.monthly_income::float AS income, b.housing_type, b.created_at,
                    (SELECT COUNT(*) FROM beneficiary_family_members m WHERE m.beneficiary_id = b.id)::int AS members
               FROM beneficiaries b
              WHERE b.organization_id = $1 AND ($2::text IS NULL OR b.status = $2) AND ($3::text IS NULL OR b.category = $3)
                AND ($4::text IS NULL OR b.gender = $4) AND ($5::text IS NULL OR b.residency = $5) AND ($6::text IS NULL OR b.city = $6)
              ORDER BY b.file_no`,
            [org(u).organizationId, f.status ?? null, f.category ?? null, f.gender ?? null, f.residency ?? null, f.city ?? null],
          );
          return rows.map((r) => ({
            id: r.id, fileNo: r.file_no, fullName: r.full_name, nationalId: r.national_id, categoryLabel: ar(CATEGORY, r.category), statusLabel: ar(STATUS, r.status),
            genderLabel: ar(GENDER, r.gender), age: age(r.birth_date), nationality: r.nationality, city: r.city, phone: r.phone, members: r.members,
            income: r.income, housingLabel: ar(HOUSING, r.housing_type), createdAt: r.created_at,
          }));
        },
      },
      {
        ...base, code: 'beneficiaries.by-category', category: 'المستفيدون', title: 'المستفيدون حسب الفئة والحالة',
        description: 'عدد الملفات في كل فئة موزعة على حالات الاستحقاق، مع متوسط الدخل وعدد أفراد الأسر',
        columns: [
          { key: 'category', label: 'الفئة' }, { key: 'total', label: 'إجمالي الملفات', type: 'number', total: true },
          ...Object.entries(STATUS).map(([k, l]) => ({ key: k, label: l, type: 'number' as const, total: true })),
          { key: 'members', label: 'أفراد الأسر', type: 'number', total: true }, { key: 'avgIncome', label: 'متوسط الدخل', type: 'money' },
        ],
        run: async (u) => {
          const rows: Record<string, unknown>[] = await this.db.query(
            `SELECT b.category, b.status, COUNT(*)::int AS n, AVG(b.monthly_income)::float AS income,
                    SUM((SELECT COUNT(*) FROM beneficiary_family_members m WHERE m.beneficiary_id = b.id))::int AS members
               FROM beneficiaries b WHERE b.organization_id = $1 GROUP BY 1, 2`, [org(u).organizationId]);
          const by = new Map<string, Record<string, number | string | null> & { _inc: number; _n: number }>();
          for (const r of rows) {
            const k = String(r.category ?? 'other');
            const g = by.get(k) ?? { category: ar(CATEGORY, k), total: 0, members: 0, avgIncome: null, _inc: 0, _n: 0, ...Object.fromEntries(Object.keys(STATUS).map((s) => [s, 0])) };
            g[String(r.status)] = Number(g[String(r.status)] ?? 0) + Number(r.n);
            g.total = Number(g.total) + Number(r.n);
            g.members = Number(g.members) + Number(r.members ?? 0);
            if (r.income !== null) { g._inc += Number(r.income) * Number(r.n); g._n += Number(r.n); }
            by.set(k, g);
          }
          return [...by.values()].sort((a, b) => Number(b.total) - Number(a.total))
            .map(({ _inc, _n, ...g }) => ({ ...g, avgIncome: _n ? r2(_inc / _n) : null }));
        },
      },
      {
        ...base, code: 'beneficiaries.by-city', category: 'المستفيدون', title: 'التوزيع الجغرافي للمستفيدين', description: 'عدد المستفيدين والمستحقين وأفراد الأسر في كل مدينة',
        columns: [
          { key: 'city', label: 'المدينة' }, { key: 'total', label: 'الملفات', type: 'number', total: true }, { key: 'eligible', label: 'المستحقون', type: 'number', total: true },
          { key: 'members', label: 'أفراد الأسر', type: 'number', total: true }, { key: 'aid', label: 'المساعدات المصروفة', type: 'money', total: true },
        ],
        run: async (u) => this.db.query(
          `SELECT COALESCE(NULLIF(b.city, ''), 'غير محددة') AS city, COUNT(*)::int AS total, COUNT(*) FILTER (WHERE b.status = 'eligible')::int AS eligible,
                  COALESCE(SUM((SELECT COUNT(*) FROM beneficiary_family_members m WHERE m.beneficiary_id = b.id)), 0)::int AS members,
                  COALESCE(SUM((SELECT SUM(a.amount) FROM beneficiary_aids a WHERE a.beneficiary_id = b.id)), 0)::float AS aid
             FROM beneficiaries b WHERE b.organization_id = $1 GROUP BY 1 ORDER BY total DESC`, [org(u).organizationId]),
      },
      {
        ...base, code: 'beneficiaries.requests', category: 'الطلبات', title: 'سجل الطلبات', description: 'طلبات المستفيدين في الفترة بالمشروع والمرحلة والحالة ونتيجة البحث',
        permission: [P.reports], link: '/beneficiaries/requests/{id}', orientation: 'landscape',
        filters: [...periodFilters('الطلب'), selectFilter('status', 'حالة الطلب', REQUEST), dynamicFilter('projectId', 'المشروع', (u) => this.projects(u)),
          selectFilter('source', 'مصدر الطلب', SOURCE)],
        columns: [
          { key: 'requestNo', label: 'رقم الطلب' }, { key: 'createdAt', label: 'التاريخ', type: 'date' }, { key: 'beneficiary', label: 'المستفيد' },
          { key: 'project', label: 'المشروع' }, { key: 'stage', label: 'المرحلة الحالية' }, { key: 'statusLabel', label: 'الحالة' },
          { key: 'sourceLabel', label: 'المصدر' }, { key: 'score', label: 'درجة البحث', type: 'number' }, { key: 'outcome', label: 'نتيجة القواعد' },
          { key: 'supportPercent', label: 'نسبة دعم الجمعية', type: 'percent' }, { key: 'cost', label: 'التكلفة التقديرية', type: 'money', total: true },
          { key: 'deviation', label: 'مخالفة للقواعد', type: 'bool' },
        ],
        run: async (u, f) => {
          const rows: Record<string, unknown>[] = await this.db.query(
            `SELECT r.id, r.request_no, r.created_at, b.full_name, a.name AS project, s.name AS stage, r.status, r.source, r.research_score::float AS score,
                    r.research_outcome, r.support_percent::float AS support_percent, r.estimated_cost::float AS cost, r.rule_deviation
               FROM beneficiary_requests r JOIN beneficiaries b ON b.id = r.beneficiary_id LEFT JOIN activities a ON a.id = r.project_id
               LEFT JOIN workflow_stages s ON s.id = r.current_stage_id
              WHERE r.organization_id = $1 AND (r.created_at AT TIME ZONE 'Asia/Riyadh')::date BETWEEN $2 AND $3
                AND ($4::text IS NULL OR r.status = $4) AND ($5::uuid IS NULL OR r.project_id = $5) AND ($6::text IS NULL OR r.source = $6)
              ORDER BY r.request_no DESC`,
            [org(u).organizationId, f.from, f.to, f.status ?? null, f.projectId ?? null, f.source ?? null],
          );
          return rows.map((r) => ({
            id: r.id, requestNo: r.request_no, createdAt: r.created_at, beneficiary: r.full_name, project: r.project,
            stage: ['in_progress', 'returned'].includes(String(r.status)) ? r.stage : null, statusLabel: ar(REQUEST, r.status), sourceLabel: ar(SOURCE, r.source),
            score: r.score, outcome: ar(OUTCOME, r.research_outcome), supportPercent: r.support_percent, cost: r.cost, deviation: r.rule_deviation,
          }));
        },
      },
      {
        ...base, code: 'beneficiaries.requests-by-project', category: 'الطلبات', title: 'الطلبات حسب المشروع', description: 'عدد الطلبات وحالاتها وتكلفتها التقديرية لكل مشروع',
        filters: periodFilters('الطلب'),
        columns: [
          { key: 'project', label: 'المشروع' }, { key: 'total', label: 'الطلبات', type: 'number', total: true },
          { key: 'in_progress', label: 'قيد المعالجة', type: 'number', total: true }, { key: 'returned', label: 'مُعادة', type: 'number', total: true },
          { key: 'approved', label: 'معتمدة', type: 'number', total: true }, { key: 'rejected', label: 'مرفوضة', type: 'number', total: true },
          { key: 'approvalRate', label: 'نسبة القبول', type: 'percent' }, { key: 'cost', label: 'التكلفة التقديرية للمعتمد', type: 'money', total: true },
        ],
        run: async (u, f) => {
          const rows: Record<string, unknown>[] = await this.db.query(
            `SELECT COALESCE(a.name, 'بدون مشروع') AS project, COUNT(*)::int AS total,
                    COUNT(*) FILTER (WHERE r.status = 'in_progress')::int AS in_progress, COUNT(*) FILTER (WHERE r.status = 'returned')::int AS returned,
                    COUNT(*) FILTER (WHERE r.status = 'approved')::int AS approved, COUNT(*) FILTER (WHERE r.status = 'rejected')::int AS rejected,
                    COALESCE(SUM(r.estimated_cost) FILTER (WHERE r.status = 'approved'), 0)::float AS cost
               FROM beneficiary_requests r LEFT JOIN activities a ON a.id = r.project_id
              WHERE r.organization_id = $1 AND (r.created_at AT TIME ZONE 'Asia/Riyadh')::date BETWEEN $2 AND $3
              GROUP BY 1 ORDER BY total DESC`, [org(u).organizationId, f.from, f.to]);
          return rows.map((r) => {
            const decided = Number(r.approved) + Number(r.rejected);
            return { ...r, approvalRate: decided ? r2((Number(r.approved) / decided) * 100) : null };
          });
        },
      },
      {
        ...base, code: 'beneficiaries.stages', category: 'الطلبات', title: 'الطلبات المفتوحة في مراحل سير العمل',
        description: 'عدد الطلبات المنتظرة في كل مرحلة ومتوسط وأقصى مدة انتظار بالأيام، لاكتشاف الاختناقات',
        columns: [
          { key: 'workflow', label: 'سير العمل' }, { key: 'stage', label: 'المرحلة' }, { key: 'open', label: 'طلبات منتظرة', type: 'number', total: true },
          { key: 'returned', label: 'منها مُعادة للمستفيد', type: 'number', total: true }, { key: 'avgDays', label: 'متوسط الانتظار (يوم)', type: 'number' },
          { key: 'maxDays', label: 'أطول انتظار (يوم)', type: 'number' },
        ],
        run: async (u) => this.db.query(
          `WITH last AS (
             SELECT r.id, r.status, r.current_stage_id, COALESCE((SELECT MAX(x.created_at) FROM beneficiary_request_actions x WHERE x.request_id = r.id), r.created_at) AS since
               FROM beneficiary_requests r WHERE r.organization_id = $1 AND r.status IN ('in_progress', 'returned'))
           SELECT w.name AS workflow, s.name AS stage, COUNT(l.id)::int AS open, COUNT(l.id) FILTER (WHERE l.status = 'returned')::int AS returned,
                  ROUND(AVG(EXTRACT(EPOCH FROM now() - l.since) / 86400)::numeric, 1)::float AS "avgDays",
                  ROUND(MAX(EXTRACT(EPOCH FROM now() - l.since) / 86400)::numeric, 1)::float AS "maxDays"
             FROM workflow_stages s JOIN workflows w ON w.id = s.workflow_id LEFT JOIN last l ON l.current_stage_id = s.id
            WHERE s.organization_id = $1 GROUP BY w.name, s.name, s.sort_order ORDER BY w.name, s.sort_order`, [org(u).organizationId]),
      },
      {
        ...base, code: 'beneficiaries.deviations', category: 'الطلبات', title: 'الحالات المخالفة لقواعد التقييم',
        description: 'الطلبات التي خالف فيها الباحث نتيجة قواعد التقييم الاسترشادية مع السبب المكتوب، للمراجعة والجودة',
        filters: periodFilters('الطلب'), link: '/beneficiaries/requests/{id}',
        columns: [
          { key: 'requestNo', label: 'رقم الطلب' }, { key: 'createdAt', label: 'التاريخ', type: 'date' }, { key: 'beneficiary', label: 'المستفيد' },
          { key: 'project', label: 'المشروع' }, { key: 'score', label: 'درجة البحث', type: 'number' }, { key: 'outcome', label: 'نتيجة الباحث' },
          { key: 'reason', label: 'سبب المخالفة' }, { key: 'statusLabel', label: 'حالة الطلب' },
        ],
        run: async (u, f) => {
          const rows: Record<string, unknown>[] = await this.db.query(
            `SELECT r.id, r.request_no, r.created_at, b.full_name, a.name AS project, r.research_score::float AS score, r.research_outcome, r.deviation_reason, r.status
               FROM beneficiary_requests r JOIN beneficiaries b ON b.id = r.beneficiary_id LEFT JOIN activities a ON a.id = r.project_id
              WHERE r.organization_id = $1 AND r.rule_deviation AND (r.created_at AT TIME ZONE 'Asia/Riyadh')::date BETWEEN $2 AND $3 ORDER BY r.request_no DESC`,
            [org(u).organizationId, f.from, f.to]);
          return rows.map((r) => ({
            id: r.id, requestNo: r.request_no, createdAt: r.created_at, beneficiary: r.full_name, project: r.project, score: r.score,
            outcome: ar(OUTCOME, r.research_outcome), reason: r.deviation_reason, statusLabel: ar(REQUEST, r.status),
          }));
        },
      },
      {
        ...base, code: 'beneficiaries.contributions', category: 'الطلبات', title: 'مساهمات المستفيدين', description: 'الطلبات المقبولة بمساهمة من المستفيد: النسبة والمبلغ وحالة رفع الإيصال والتحقق',
        filters: [selectFilter('status', 'حالة المساهمة', { awaiting: CONTRIBUTION.awaiting, submitted: CONTRIBUTION.submitted, verified: CONTRIBUTION.verified })],
        link: '/beneficiaries/requests/{id}',
        columns: [
          { key: 'requestNo', label: 'رقم الطلب' }, { key: 'beneficiary', label: 'المستفيد' }, { key: 'project', label: 'المشروع' },
          { key: 'percent', label: 'نسبة المساهمة', type: 'percent' }, { key: 'amount', label: 'مبلغ المساهمة', type: 'money', total: true },
          { key: 'statusLabel', label: 'الحالة' }, { key: 'sentAt', label: 'تاريخ الرفع', type: 'date' }, { key: 'verifiedAt', label: 'تاريخ التحقق', type: 'date' },
        ],
        run: async (u, f) => {
          const rows: Record<string, unknown>[] = await this.db.query(
            `SELECT r.id, r.request_no, b.full_name, a.name AS project, r.contribution_percent::float AS percent, r.contribution_amount::float AS amount,
                    r.contribution_status, r.contribution_sent_at, r.contribution_verified_at
               FROM beneficiary_requests r JOIN beneficiaries b ON b.id = r.beneficiary_id LEFT JOIN activities a ON a.id = r.project_id
              WHERE r.organization_id = $1 AND r.contribution_status IS NOT NULL AND r.contribution_status <> 'none' AND ($2::text IS NULL OR r.contribution_status = $2)
              ORDER BY r.request_no DESC`, [org(u).organizationId, f.status ?? null]);
          return rows.map((r) => ({
            id: r.id, requestNo: r.request_no, beneficiary: r.full_name, project: r.project, percent: r.percent, amount: r.amount,
            statusLabel: ar(CONTRIBUTION, r.contribution_status), sentAt: r.contribution_sent_at, verifiedAt: r.contribution_verified_at,
          }));
        },
      },
      {
        ...base, code: 'beneficiaries.aids', category: 'المساعدات', title: 'سجل المساعدات المصروفة', description: 'المساعدات المصروفة للمستفيدين في الفترة بنوعها ومبلغها',
        filters: [...periodFilters('الصرف'), selectFilter('type', 'نوع المساعدة', AID)], link: '/beneficiaries/files/{beneficiaryId}',
        columns: [
          { key: 'date', label: 'تاريخ الصرف', type: 'date' }, { key: 'fileNo', label: 'رقم الملف' }, { key: 'beneficiary', label: 'المستفيد' },
          { key: 'category', label: 'الفئة' }, { key: 'typeLabel', label: 'النوع' }, { key: 'description', label: 'الوصف' },
          { key: 'referenceNo', label: 'المرجع' }, { key: 'requestNo', label: 'رقم الطلب' }, { key: 'amount', label: 'المبلغ', type: 'money', total: true },
        ],
        run: async (u, f) => {
          const rows: Record<string, unknown>[] = await this.db.query(
            `SELECT a.disbursed_on::text AS date, b.id AS beneficiary_id, b.file_no, b.full_name, b.category, a.aid_type, a.description, a.reference_no, r.request_no,
                    a.amount::float AS amount
               FROM beneficiary_aids a JOIN beneficiaries b ON b.id = a.beneficiary_id LEFT JOIN beneficiary_requests r ON r.id = a.request_id
              WHERE a.organization_id = $1 AND a.disbursed_on BETWEEN $2 AND $3 AND ($4::text IS NULL OR a.aid_type = $4)
              ORDER BY a.disbursed_on, b.file_no`, [org(u).organizationId, f.from, f.to, f.type ?? null]);
          return rows.map((r) => ({
            date: r.date, beneficiaryId: r.beneficiary_id, fileNo: r.file_no, beneficiary: r.full_name, category: ar(CATEGORY, r.category), typeLabel: ar(AID, r.aid_type),
            description: r.description, referenceNo: r.reference_no, requestNo: r.request_no, amount: r.amount,
          }));
        },
      },
      {
        ...base, code: 'beneficiaries.aids-summary', category: 'المساعدات', title: 'المساعدات حسب النوع والفئة', description: 'إجمالي المساعدات وعدد المستفيدين منها لكل نوع وفئة',
        filters: periodFilters('الصرف'),
        columns: [
          { key: 'typeLabel', label: 'نوع المساعدة' }, { key: 'category', label: 'الفئة' }, { key: 'count', label: 'عدد المرات', type: 'number', total: true },
          { key: 'beneficiaries', label: 'المستفيدون', type: 'number' }, { key: 'amount', label: 'الإجمالي', type: 'money', total: true },
          { key: 'average', label: 'المتوسط', type: 'money' },
        ],
        run: async (u, f) => {
          const rows: Record<string, unknown>[] = await this.db.query(
            `SELECT a.aid_type, b.category, COUNT(*)::int AS count, COUNT(DISTINCT a.beneficiary_id)::int AS beneficiaries, SUM(a.amount)::float AS amount,
                    AVG(a.amount)::float AS average
               FROM beneficiary_aids a JOIN beneficiaries b ON b.id = a.beneficiary_id
              WHERE a.organization_id = $1 AND a.disbursed_on BETWEEN $2 AND $3 GROUP BY 1, 2 ORDER BY amount DESC`, [org(u).organizationId, f.from, f.to]);
          return rows.map((r) => ({ ...r, typeLabel: ar(AID, r.aid_type), category: ar(CATEGORY, r.category), average: r2(r.average) }));
        },
      },
      {
        ...base, code: 'beneficiaries.tickets', category: 'التواصل', title: 'الشكاوى والمقترحات والاستفسارات', description: 'رسائل المستفيدين من البوابة وحالة الرد عليها ومدة الرد',
        filters: [...periodFilters(), selectFilter('type', 'النوع', TICKET), selectFilter('status', 'الحالة', TICKET_STATUS)],
        columns: [
          { key: 'ticketNo', label: 'الرقم' }, { key: 'createdAt', label: 'التاريخ', type: 'datetime' }, { key: 'beneficiary', label: 'المستفيد' },
          { key: 'typeLabel', label: 'النوع' }, { key: 'subject', label: 'الموضوع' }, { key: 'statusLabel', label: 'الحالة' },
          { key: 'repliedBy', label: 'رد عليها' }, { key: 'hours', label: 'مدة الرد (ساعة)', type: 'number' },
        ],
        run: async (u, f) => {
          const rows: Record<string, unknown>[] = await this.db.query(
            `SELECT t.ticket_no, t.created_at, b.full_name, t.type, t.subject, t.status, t.replied_by_name,
                    CASE WHEN t.replied_at IS NULL THEN NULL ELSE ROUND((EXTRACT(EPOCH FROM t.replied_at - t.created_at) / 3600)::numeric, 1) END::float AS hours
               FROM beneficiary_tickets t JOIN beneficiaries b ON b.id = t.beneficiary_id
              WHERE t.organization_id = $1 AND (t.created_at AT TIME ZONE 'Asia/Riyadh')::date BETWEEN $2 AND $3
                AND ($4::text IS NULL OR t.type = $4) AND ($5::text IS NULL OR t.status = $5) ORDER BY t.ticket_no DESC`,
            [org(u).organizationId, f.from, f.to, f.type ?? null, f.status ?? null]);
          const answered = rows.filter((r) => r.hours !== null);
          return {
            rows: rows.map((r) => ({
              ticketNo: r.ticket_no, createdAt: r.created_at, beneficiary: r.full_name, typeLabel: ar(TICKET, r.type), subject: r.subject,
              statusLabel: ar(TICKET_STATUS, r.status), repliedBy: r.replied_by_name, hours: r.hours,
            })),
            summary: [
              { label: 'إجمالي الرسائل', value: rows.length, type: 'number' },
              { label: 'الشكاوى', value: rows.filter((r) => r.type === 'complaint').length, type: 'number' },
              { label: 'بانتظار الرد', value: rows.filter((r) => r.status === 'open').length, type: 'number' },
              { label: 'متوسط مدة الرد (ساعة)', value: answered.length ? r2(answered.reduce((s, r) => s + Number(r.hours), 0) / answered.length) : null, type: 'number' },
            ],
          };
        },
      },
    ];
    this.registry.register(defs);
  }
}
