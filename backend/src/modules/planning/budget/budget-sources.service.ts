import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { defaultPolicy, HrPolicy } from '../../hr/hr-policy';
import { today } from '../planning-core.service';
import type { HistSnapshot } from './budget-calc';

const safe = <T>(p: Promise<T[]>) => p.catch(() => [] as T[]);
const r2 = (n: number) => Math.round(n * 100) / 100;

export interface EmployeeRow {
  id: string; employeeNo: number; fullName: string; isSaudi: boolean; hireDate: string; firstRegistration: string | null; unitId: string | null; unitName: string | null;
  costCenterId: string | null; costCenterName: string | null; jobTitle: string | null; gradeName: string | null; basic: number; allowances: { code: string; amount: number }[];
  rating: string | null; ratingScore: number | null;
}

/**
 * قراءة البيانات من الأنظمة الأخرى لبناء الموازنة (قراءة فقط):
 * الموارد البشرية (الموظفون، خطط التعيين، تقييم الأداء، اللائحة)، والمحاسبة (الفعلي حسب الحساب والشهر، مراكز التكلفة)،
 * والخطط التشغيلية (تكلفة الأنشطة)، والمشاريع (موازناتها)، والأصول (الموازنة الرأسمالية).
 */
@Injectable()
export class BudgetSources {
  constructor(private readonly db: DataSource) {}

  async hrPolicy(org: string): Promise<HrPolicy> {
    const [v] = await safe(this.db.query('SELECT policy FROM hr_policy_versions WHERE organization_id = $1 ORDER BY version DESC LIMIT 1', [org]));
    const d = defaultPolicy();
    if (!v) return d;
    const p = (v as { policy: HrPolicy }).policy;
    return { ...d, ...p, gosi: { ...d.gosi, ...(p.gosi ?? {}) }, eos: { ...d.eos, ...(p.eos ?? {}) } };
  }

  /** الموظفون على رأس العمل برواتبهم وبدلاتهم وآخر تقييم أداء معتمد */
  employees(org: string): Promise<EmployeeRow[]> {
    return safe(this.db.query(
      `SELECT e.id, e.employee_no AS "employeeNo", e.full_name AS "fullName", e.is_saudi AS "isSaudi", e.hire_date::text AS "hireDate",
              e.gosi_first_registration::text AS "firstRegistration", e.unit_id AS "unitId", u.name AS "unitName",
              u.analytic_account_id AS "costCenterId", CASE WHEN c.id IS NULL THEN NULL ELSE c.code || ' ' || c.name END AS "costCenterName",
              j.title AS "jobTitle", g.name AS "gradeName", e.basic_salary::float AS basic, e.allowances,
              pc.rating, pc.final_score::float AS "ratingScore"
         FROM hr_employees e
         LEFT JOIN hr_units u ON u.id = e.unit_id
         LEFT JOIN acc_analytic_accounts c ON c.id = u.analytic_account_id
         LEFT JOIN hr_jobs j ON j.id = e.job_id
         LEFT JOIN hr_grades g ON g.id = e.grade_id
         LEFT JOIN LATERAL (SELECT rating, final_score FROM hr_performance_cards p WHERE p.employee_id = e.id AND p.status = 'approved' ORDER BY p.year DESC LIMIT 1) pc ON true
        WHERE e.organization_id = $1 AND e.status = 'active' AND e.employment_kind = 'staff' ORDER BY e.employee_no`, [org]));
  }

  /** خطط التعيين المعتمدة للسنة مع راتب أدنى درجة الوظيفة وبدلاتها */
  staffingPlans(org: string, year: number): Promise<{ id: string; jobTitle: string; unitId: string | null; unitName: string | null; costCenterId: string | null; costCenterName: string | null; gradeName: string | null; count: number; plannedMonth: number; forSaudi: boolean; minSalary: number; gradeAllowances: { code: string; kind: 'percent' | 'fixed'; value: number }[]; fundingSource: string | null }[]> {
    return safe(this.db.query(
      `SELECT s.id, j.title AS "jobTitle", j.unit_id AS "unitId", u.name AS "unitName", u.analytic_account_id AS "costCenterId",
              CASE WHEN c.id IS NULL THEN NULL ELSE c.code || ' ' || c.name END AS "costCenterName", g.name AS "gradeName", s.count, s.planned_month AS "plannedMonth",
              s.for_saudi AS "forSaudi", COALESCE(g.min_salary, 0)::float AS "minSalary", COALESCE(g.allowances, '[]'::jsonb) AS "gradeAllowances", s.funding_source AS "fundingSource"
         FROM hr_staffing_plans s JOIN hr_jobs j ON j.id = s.job_id
         LEFT JOIN hr_units u ON u.id = j.unit_id LEFT JOIN acc_analytic_accounts c ON c.id = u.analytic_account_id
         LEFT JOIN hr_grades g ON g.id = j.grade_id
        WHERE s.organization_id = $1 AND s.year = $2 AND s.status = 'approved' ORDER BY s.planned_month, j.title`, [org, year]));
  }

  /** حسابات مصروفات الرواتب (من فئات تحميل المصروف في الموارد البشرية) حتى لا تُحسب مرتين */
  async payrollAccounts(org: string): Promise<Set<string>> {
    const rows: { accounts: Record<string, string> }[] = await safe(this.db.query('SELECT accounts FROM hr_expense_profiles WHERE organization_id = $1', [org]));
    return new Set(rows.flatMap((r) => Object.values(r.accounts ?? {})).filter(Boolean));
  }

  accounts(org: string, nature?: 'expenses' | 'revenue'): Promise<{ id: string; code: string; name: string; nature: string }[]> {
    return safe(this.db.query(
      `SELECT id, code, name, nature FROM acc_accounts WHERE organization_id = $1 AND kind = 'sub' AND is_active AND nature = ANY($2) ORDER BY code`,
      [org, nature ? [nature] : ['expenses', 'revenue']]));
  }

  /**
   * الفعلي من القيود المرحّلة لحسابات المصروفات أو الإيرادات بين سنتين، حسب الحساب والشهر
   * (مع مركز تكلفة محدد يُؤخذ نصيبه فقط من التوزيع التحليلي للسطر).
   */
  async actuals(org: string, fromYear: number, toYear: number, opts: { accountIds?: string[]; nature?: 'expenses' | 'revenue'; costCenterId?: string | null } = {}) {
    const params: unknown[] = [org, `${fromYear}-01-01`, `${toYear + 1}-01-01`];
    let where = '';
    if (opts.accountIds?.length) { params.push(opts.accountIds); where += ` AND l.account_id = ANY($${params.length})`; }
    if (opts.nature) { params.push(opts.nature); where += ` AND a.nature = $${params.length}`; } else where += ` AND a.nature IN ('expenses', 'revenue')`;
    let share = '1';
    if (opts.costCenterId) {
      params.push(opts.costCenterId);
      share = `COALESCE((SELECT SUM((x->>'percent')::numeric) / 100 FROM jsonb_array_elements(COALESCE(l.analytic, '[]'::jsonb)) x WHERE x->>'analyticId' = $${params.length}), 0)`;
    }
    const rows: { accountId: string; code: string; name: string; nature: string; y: number; m: number; amount: number }[] = await safe(this.db.query(
      `SELECT l.account_id AS "accountId", a.code, a.name, a.nature, EXTRACT(YEAR FROM e.document_date)::int AS y, EXTRACT(MONTH FROM e.document_date)::int AS m,
              SUM(CASE WHEN a.nature = 'revenue' THEN l.credit - l.debit ELSE l.debit - l.credit END * ${share})::float AS amount
         FROM acc_entry_lines l JOIN acc_entries e ON e.id = l.entry_id JOIN acc_accounts a ON a.id = l.account_id
        WHERE e.organization_id = $1 AND e.status = 'posted' AND e.document_date >= $2 AND e.document_date < $3 ${where}
        GROUP BY 1, 2, 3, 4, 5, 6`, params));
    return rows;
  }

  /** لقطة التاريخ لبند: المجاميع السنوية والشهرية وأكبر القيود (لاختيار المصروفات غير المتكررة) */
  async snapshot(org: string, accountId: string, costCenterId: string | null, fiscalYear: number, years: number): Promise<HistSnapshot> {
    const from = fiscalYear - Math.max(1, years);
    const rows = await this.actuals(org, from, fiscalYear - 1, { accountIds: [accountId], costCenterId });
    return this.buildSnapshot(org, rows.filter((r) => r.accountId === accountId), accountId, costCenterId, from, fiscalYear);
  }

  async buildSnapshot(org: string, rows: { y: number; m: number; amount: number }[], accountId: string, costCenterId: string | null, from: number, fiscalYear: number): Promise<HistSnapshot> {
    const t = today();
    const curY = Number(t.slice(0, 4));
    const yearsMap: Record<string, number> = {};
    const months: Record<string, number[]> = {};
    for (let y = from; y < fiscalYear; y++) { yearsMap[String(y)] = 0; months[String(y)] = Array(12).fill(0); }
    for (const r of rows) {
      if (yearsMap[String(r.y)] === undefined) continue;
      yearsMap[String(r.y)] = r2(yearsMap[String(r.y)] + r.amount);
      months[String(r.y)][r.m - 1] = r2(months[String(r.y)][r.m - 1] + r.amount);
    }
    // سنوات بلا أي حركة قبل أول سنة فيها حركة لا تدخل في المتوسط
    for (const y of Object.keys(yearsMap).sort()) { if (yearsMap[y] === 0 && months[y].every((x) => x === 0)) { delete yearsMap[y]; delete months[y]; } else break; }
    const params: unknown[] = [org, accountId, `${from}-01-01`, `${fiscalYear}-01-01`];
    let share = '1';
    if (costCenterId) { params.push(costCenterId); share = `COALESCE((SELECT SUM((x->>'percent')::numeric) / 100 FROM jsonb_array_elements(COALESCE(l.analytic, '[]'::jsonb)) x WHERE x->>'analyticId' = $5), 0)`; }
    const entries: { id: string; date: string; description: string; amount: number }[] = await safe(this.db.query(
      `SELECT e.id, e.document_date::text AS date, e.description, SUM(CASE WHEN a.nature = 'revenue' THEN l.credit - l.debit ELSE l.debit - l.credit END * ${share})::float AS amount
         FROM acc_entry_lines l JOIN acc_entries e ON e.id = l.entry_id JOIN acc_accounts a ON a.id = l.account_id
        WHERE e.organization_id = $1 AND l.account_id = $2 AND e.status = 'posted' AND e.document_date >= $3 AND e.document_date < $4
        GROUP BY e.id, e.document_date, e.description HAVING ABS(SUM(l.debit - l.credit)) > 0 ORDER BY ABS(SUM(l.debit - l.credit)) DESC LIMIT 12`, params));
    return {
      years: yearsMap, months, entries: entries.map((e) => ({ ...e, amount: r2(e.amount) })).filter((e) => e.amount !== 0),
      currentYear: curY, currentMonths: Number(t.slice(5, 7)) - 1 || 0, fetchedAt: new Date().toISOString(),
      source: `القيود المرحّلة في النظام المحاسبي (${from} إلى ${fiscalYear - 1})${costCenterId ? ' لمركز التكلفة المحدد' : ''}`,
    };
  }

  /** عناصر الخطط التشغيلية المعتمدة التي لها تكلفة في السنة (العناصر التنفيذية بلا فروع) */
  activities(org: string, year: number): Promise<{ id: string; code: string; title: string; planId: string; planCode: string; planTitle: string; unitId: string | null; unitName: string | null; startDate: string | null; endDate: string | null; cost: number; fundingType: string | null; costCenterId: string | null; costCenterName: string | null }[]> {
    return this.db.query(
      `SELECT i.id, i.code, i.title, p.id AS "planId", p.code AS "planCode", p.title AS "planTitle", COALESCE(i.unit_id, p.unit_id) AS "unitId", COALESCE(i.unit_name, p.unit_name) AS "unitName",
              i.start_date::text AS "startDate", i.end_date::text AS "endDate", COALESCE((i.cost_by_year->>$2::text)::numeric, 0)::float AS cost, i.funding_type AS "fundingType",
              i.cost_center_id AS "costCenterId", i.cost_center_name AS "costCenterName"
         FROM plan_items i JOIN plan_plans p ON p.id = i.plan_id
        WHERE i.organization_id = $1 AND p.kind = 'operational' AND p.version > 0 AND p.start_year <= $2::int AND p.end_year >= $2::int
          AND i.state NOT IN ('cancelled', 'carried_over') AND NOT EXISTS (SELECT 1 FROM plan_items c WHERE c.parent_id = i.id)
          AND COALESCE((i.cost_by_year->>$2::text)::numeric, 0) > 0
        ORDER BY p.code, i.code`, [org, year]);
  }

  /** المشاريع النشطة التي تتقاطع مدتها مع السنة، ونصيب السنة من موازنتها بالتناسب الزمني */
  async projects(org: string, year: number) {
    const rows: { id: string; code: string; name: string; budget: number | null; startDate: string | null; endDate: string | null }[] = await safe(this.db.query(
      `SELECT a.id, 'PRJ-' || LPAD(p.project_no::text, 4, '0') AS code, a.name, p.budget::float AS budget, p.start_date::text AS "startDate", p.end_date::text AS "endDate"
         FROM activities a JOIN project_profiles p ON p.activity_id = a.id
        WHERE a.organization_id = $1 AND COALESCE(p.budget, 0) > 0`, [org]));
    const ys = Date.UTC(year, 0, 1), ye = Date.UTC(year + 1, 0, 1);
    return rows.map((r) => {
      const s = r.startDate ? Date.parse(r.startDate) : ys, e = r.endDate ? Date.parse(r.endDate) + 86400000 : ye;
      const span = Math.max(1, e - s), overlap = Math.max(0, Math.min(e, ye) - Math.max(s, ys));
      return { ...r, share: r2(((r.budget ?? 0) * overlap) / span) };
    }).filter((r) => r.share > 0);
  }

  /** بنود الموازنة الرأسمالية للأصول في السنة (للعرض في الموازنة الشاملة؛ ملكيتها لنظام الأصول) */
  capital(org: string, year: number): Promise<{ id: string; lineNo: number; description: string; amount: number; budgetTitle: string; status: string }[]> {
    return safe(this.db.query(
      `SELECT l.id, l.line_no AS "lineNo", l.description, (l.quantity * l.amount)::float AS amount, b.title AS "budgetTitle", b.status
         FROM acc_asset_budget_lines l JOIN acc_asset_budgets b ON b.id = l.budget_id JOIN acc_fiscal_years y ON y.id = b.fiscal_year_id
        WHERE l.organization_id = $1 AND y.name = $2::text ORDER BY b.title, l.line_no`, [org, year]));
  }

  /** الفعلي الشهري لسنة على مجموعة حسابات (ومركز تكلفة إن حُدد): مصفوفة 12 شهرًا */
  async actualMonthly(org: string, year: number, accountIds: string[], costCenterId: string | null): Promise<number[]> {
    const out = Array(12).fill(0) as number[];
    if (!accountIds.length) return out;
    for (const r of await this.actuals(org, year, year, { accountIds, costCenterId })) out[r.m - 1] = r2(out[r.m - 1] + r.amount);
    return out;
  }

  /** القيود المرحّلة على حسابات (ومركز تكلفة) في سنة حتى شهر: لتتبع الفعلي إلى مصدره */
  async entriesFor(org: string, year: number, toMonth: number, accountIds: string[], costCenterId: string | null) {
    if (!accountIds.length) return [];
    const params: unknown[] = [org, accountIds, `${year}-01-01`, toMonth >= 12 ? `${year + 1}-01-01` : `${year}-${String(toMonth + 1).padStart(2, '0')}-01`];
    let share = '1';
    if (costCenterId) { params.push(costCenterId); share = `COALESCE((SELECT SUM((x->>'percent')::numeric) / 100 FROM jsonb_array_elements(COALESCE(l.analytic, '[]'::jsonb)) x WHERE x->>'analyticId' = $5), 0)`; }
    const rows: { id: string; entryNo: number; date: string; description: string; voucherId: string | null; voucherType: string; accountCode: string; amount: number }[] = await safe(this.db.query(
      `SELECT e.id, e.entry_no AS "entryNo", e.document_date::text AS date, e.description, e.voucher_id AS "voucherId", e.voucher_type AS "voucherType", MIN(a.code) AS "accountCode",
              SUM(CASE WHEN a.nature = 'revenue' THEN l.credit - l.debit ELSE l.debit - l.credit END * ${share})::float AS amount
         FROM acc_entry_lines l JOIN acc_entries e ON e.id = l.entry_id JOIN acc_accounts a ON a.id = l.account_id
        WHERE e.organization_id = $1 AND l.account_id = ANY($2) AND e.status = 'posted' AND e.document_date >= $3 AND e.document_date < $4
        GROUP BY e.id ORDER BY e.document_date DESC, e.entry_no DESC LIMIT 300`, params));
    return rows.map((r) => ({ ...r, amount: r2(r.amount) })).filter((r) => r.amount !== 0);
  }
}
