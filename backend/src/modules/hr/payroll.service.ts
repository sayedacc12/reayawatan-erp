import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { OrgUser } from '../../core/auth/decorators';
import { AccCore } from '../accounting/acc-core.service';
import { LineDto } from '../accounting/accounting.dto';
import { EntriesService } from '../accounting/entries.service';
import { VouchersService, VOUCHER_STATUS_AR } from '../accounting/vouchers.service';
import { AttendanceService } from './attendance.service';
import {
  HrAdvanceRepayment, HrAllowanceType, HrEmployee, HrExpenseProfile, HrJob, HrLeaveRequest, HrPayrollRun, HrSettings, HrUnit, PayrollConfig, PayrollRunStatus, RunHistory, RunLine,
} from './entities/hr.entity';
import { AllowanceTypeDto, ExpenseProfileDto, PayrollConfigDto, RunDecisionDto, RunLineDto, RunVouchersDto } from './hr.dto';
import { HrCore, today } from './hr-core.service';
import { HR_PERMISSIONS as P } from './hr.manifest';
import { daysBetween, gosi, HrPolicy, round2 } from './hr-policy';
import { partsOf } from './org.service';
import { lastDay, MONTH, overlapDays } from './people.service';
import { RequestsService } from './requests.service';

export const RUN_STATUS_AR: Record<PayrollRunStatus, string> = {
  draft: 'قيد الإعداد', pending: 'قيد الاعتماد', returned: 'معاد للتعديل', approved: 'معتمد', cancelled: 'ملغي',
};
const ACTION_AR: Record<string, string> = {
  create: 'إصدار الكشف', recalc: 'إعادة الاحتساب', line: 'تعديل سطر', submit: 'رفع للاعتماد', approve: 'موافقة', final: 'اعتماد نهائي وإصدار القيد',
  return: 'إرجاع للتعديل', reopen: 'إلغاء الاعتماد وعكس القيد', cancel: 'إلغاء الكشف', vouchers: 'إنشاء سندات الصرف',
};
const MONTHS_AR = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];
export const monthLabel = (m: string) => `${MONTHS_AR[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}`;

const EMPTY_CONFIG: PayrollConfig = {
  payableAccountId: null, gosiPayableAccountId: null, deductionsAccountId: null, advancesAccountId: null, defaultCashAccountId: null, stages: [],
};

/** يخصم مبلغًا من بنود الراتب: من الأساسي أولًا ثم باقي البنود بالترتيب */
function deductFrom(parts: { code: string; amount: number }[], total: number) {
  let left = Math.round(total * 100);
  const order = [...parts.filter((p) => p.code === 'basic'), ...parts.filter((p) => p.code !== 'basic')];
  const out = new Map(parts.map((p) => [p.code, Math.round(p.amount * 100)]));
  for (const p of order) {
    if (left <= 0) break;
    const cur = out.get(p.code)!;
    const take = Math.min(cur, left);
    out.set(p.code, cur - take);
    left -= take;
  }
  return parts.map((p) => ({ code: p.code, amount: out.get(p.code)! / 100 }));
}

/** توزيع سطر الموظف على البنود: المصروف (بعد خصومات الحضور) والمستحق للصرف (بعد التأمينات والاستقطاعات) */
export function allocateLine(l: RunLine) {
  const merged = new Map<string, number>();
  l.items.forEach((i) => merged.set(i.code, round2((merged.get(i.code) ?? 0) + i.earned)));
  l.additions.forEach((a) => merged.set(a.code, round2((merged.get(a.code) ?? 0) + a.amount)));
  const parts = [...merged].map(([code, amount]) => ({ code, amount }));
  const attendance = round2(l.unpaidDeduction + l.absenceDeduction + l.lateDeduction);
  const expense = deductFrom(parts, attendance);
  const payable = deductFrom(expense, round2(l.gosiEmployee + l.otherDeduction + (l.advanceDeduction ?? 0)));
  return expense.map((e, i) => ({ code: e.code, expense: e.amount, payable: payable[i].amount }));
}

/** يحسب مبالغ السطر من مدخلاته (البنود والحضور والإضافات والاستقطاعات) */
export function computeLine(l: RunLine, policy: HrPolicy): RunLine {
  const py = policy.payroll;
  const a = l.attendance;
  const absenceDeduction = a.tracked && py.deductAbsence ? round2(a.absentDays * py.absenceFactor * l.dailyWage) : 0;
  const lateDeduction = a.tracked && py.deductLate ? round2((a.lateMinutes * l.dailyWage * py.lateFactor) / (policy.work.dailyHours * 60)) : 0;
  const unpaidDeduction = round2(l.unpaidDays * l.dailyWage);
  const earned = round2(l.items.reduce((s, i) => s + i.earned, 0) + l.additions.reduce((s, x) => s + x.amount, 0));
  // خصومات الحضور والإجازة بدون أجر لا تتجاوز المستحق: إن زادت تُخفض بالنسبة نفسها
  const raw = unpaidDeduction + absenceDeduction + lateDeduction;
  const scale = raw > earned && raw > 0 ? earned / raw : 1;
  const out = { ...l, earned, unpaidDeduction: round2(unpaidDeduction * scale), absenceDeduction: round2(absenceDeduction * scale), lateDeduction: round2(lateDeduction * scale) };
  const attendance = round2(out.unpaidDeduction + out.absenceDeduction + out.lateDeduction);
  // أقساط السلف لا تتجاوز ما يتبقى من الراتب بعد الاستقطاعات الأخرى، ويُرحَّل الباقي للأشهر التالية
  let room = Math.max(0, round2(earned - attendance - l.gosiEmployee - l.otherDeduction));
  out.advances = (l.advances ?? []).map((a) => {
    const amount = round2(Math.min(a.amount, room));
    room = round2(room - amount);
    return { advanceId: a.advanceId, amount };
  }).filter((a) => a.amount > 0);
  out.advanceDeduction = round2(out.advances.reduce((s, a) => s + a.amount, 0));
  out.totalDeductions = round2(attendance + l.gosiEmployee + l.otherDeduction + out.advanceDeduction);
  out.net = round2(earned - out.totalDeductions);
  out.employerCost = round2(earned - attendance + l.gosiEmployer);
  return out;
}

function totalsOf(lines: RunLine[]) {
  const sum = (f: (l: RunLine) => number) => round2(lines.reduce((s, l) => s + f(l), 0));
  return {
    employees: lines.length, gross: sum((l) => l.earned), additions: sum((l) => l.additions.reduce((s, a) => s + a.amount, 0)),
    unpaidDeduction: sum((l) => l.unpaidDeduction), absenceDeduction: sum((l) => l.absenceDeduction), lateDeduction: sum((l) => l.lateDeduction),
    gosiEmployee: sum((l) => l.gosiEmployee), gosiEmployer: sum((l) => l.gosiEmployer), otherDeduction: sum((l) => l.otherDeduction), advanceDeduction: sum((l) => l.advanceDeduction ?? 0),
    totalDeductions: sum((l) => l.totalDeductions), net: sum((l) => l.net), employerCost: sum((l) => l.employerCost),
    missingIban: lines.filter((l) => !l.iban && l.net > 0).length,
  };
}

interface PlanVoucher { cashAccountId: string; payableAccountId: string; amount: number; codes: string[]; employees: number }

/**
 * مسير الرواتب: البنود (الأساسي والبدلات) وحساباتها، الربط المحاسبي ومراحل الاعتماد، وكشف رواتب كل شهر:
 * يُعد من بيانات الموظفين والإجازات والحضور، ثم يُعتمد، فيصدر قيد استحقاق الرواتب في النظام المالي محمّلًا على
 * الحساب التحليلي لكل وحدة إدارية، ثم تُنشأ سندات الصرف (سند لكل بنك وحساب استحقاق) لتمر بمراحل اعتماد سندات الصرف.
 */
@Injectable()
export class PayrollService {
  constructor(
    private readonly db: DataSource,
    private readonly core: HrCore,
    private readonly attendance: AttendanceService,
    private readonly accCore: AccCore,
    private readonly entries: EntriesService,
    private readonly vouchers: VouchersService,
    private readonly requests: RequestsService,
  ) {}

  // ---------------- بنود الراتب ----------------

  async listAllowances(actor: OrgUser) {
    const org = actor.organizationId;
    const rows = await this.core.allowanceTypes(org);
    const usage: { code: string; n: number }[] = await this.db.query(
      `SELECT x->>'code' AS code, COUNT(*)::int AS n FROM hr_employees e, jsonb_array_elements(e.allowances) x WHERE e.organization_id = $1 AND e.status = 'active' GROUP BY 1`, [org],
    );
    const [{ n: active }] = await this.db.query(`SELECT COUNT(*)::int AS n FROM hr_employees WHERE organization_id = $1 AND status = 'active'`, [org]);
    return rows.map((r) => ({ ...r, employees: r.code === 'basic' ? active : usage.find((u) => u.code === r.code)?.n ?? 0 }));
  }

  private async assertAccounts(org: string, ids: { id: string | null | undefined; label: string; nature?: string[] }[]) {
    for (const x of ids) {
      if (!x.id) continue;
      const [a] = await this.db.query('SELECT code, name, kind, nature, is_active FROM acc_accounts WHERE id = $1 AND organization_id = $2', [x.id, org]);
      if (!a) throw new BadRequestException(`${x.label}: الحساب غير موجود في دليل الحسابات`);
      if (a.kind !== 'sub') throw new BadRequestException(`${x.label}: الحساب ${a.code} «${a.name}» ليس فرعيًا`);
      if (!a.is_active) throw new BadRequestException(`${x.label}: الحساب ${a.code} «${a.name}» موقوف`);
      if (x.nature && !x.nature.includes(a.nature)) throw new BadRequestException(`${x.label}: الحساب ${a.code} «${a.name}» ليس من النوع المناسب`);
    }
  }

  private async assertCash(org: string, id: string | null | undefined, label: string) {
    if (!id) return;
    const [c] = await this.db.query('SELECT name, is_active FROM acc_cash_accounts WHERE id = $1 AND organization_id = $2', [id, org]);
    if (!c) throw new BadRequestException(`${label}: البنك غير موجود في شاشة البنوك والنقدية`);
    if (!c.is_active) throw new BadRequestException(`${label}: «${c.name}» موقوف`);
  }

  async saveAllowance(actor: OrgUser, dto: AllowanceTypeDto, id?: string) {
    const org = actor.organizationId;
    const repo = this.db.getRepository(HrAllowanceType);
    await this.core.allowanceTypes(org);
    await this.assertAccounts(org, [{ id: dto.payableAccountId, label: 'حساب الاستحقاق', nature: ['liabilities'] }]);
    await this.assertCash(org, dto.cashAccountId, 'بنك الصرف');
    const dup = await repo.findOne({ where: { organizationId: org, code: dto.code } });
    const fields = {
      name: dto.name, defaultKind: dto.defaultKind, defaultValue: dto.defaultValue,
      payableAccountId: dto.payableAccountId ?? null, cashAccountId: dto.cashAccountId ?? null, isActive: dto.isActive ?? true,
      ...(dto.sortOrder !== undefined ? { sortOrder: dto.sortOrder } : {}),
    };
    if (id) {
      const row = await repo.findOne({ where: { id, organizationId: org } });
      if (!row) throw new NotFoundException('البند غير موجود');
      if (dup && dup.id !== id) throw new ConflictException(`الرمز ${dto.code} مستخدم لبند «${dup.name}»`);
      if (row.code !== dto.code) throw new BadRequestException('لا يتغير رمز البند بعد إنشائه، لأنه مستخدم في المراتب والموظفين');
      if (row.isSystem && fields.isActive === false) throw new BadRequestException('الراتب الأساسي لا يوقف');
      await repo.update({ id }, row.isSystem ? { ...fields, defaultKind: 'fixed', defaultValue: 0 } : fields);
    } else {
      if (dup) throw new ConflictException(`الرمز ${dto.code} مستخدم لبند «${dup.name}»`);
      const max = await repo.maximum('sortOrder', { organizationId: org });
      await repo.save(repo.create({ organizationId: org, code: dto.code, ...fields, sortOrder: dto.sortOrder ?? (max ?? 0) + 1 }));
    }
    return this.listAllowances(actor);
  }

  async removeAllowance(actor: OrgUser, id: string) {
    const org = actor.organizationId;
    const repo = this.db.getRepository(HrAllowanceType);
    const row = await repo.findOne({ where: { id, organizationId: org } });
    if (!row) throw new NotFoundException('البند غير موجود');
    if (row.isSystem) throw new BadRequestException('الراتب الأساسي لا يُحذف');
    const [{ n }] = await this.db.query(
      `SELECT (SELECT COUNT(*) FROM hr_employees e, jsonb_array_elements(e.allowances) x WHERE e.organization_id = $1 AND x->>'code' = $2)
            + (SELECT COUNT(*) FROM hr_grades g, jsonb_array_elements(g.allowances) x WHERE g.organization_id = $1 AND x->>'code' = $2) AS n`, [org, row.code],
    );
    if (Number(n) > 0) throw new ConflictException(`البند مستخدم في ${n} من الموظفين والمراتب، فلا يُحذف. يمكنك إيقافه بدلًا من ذلك`);
    await repo.delete({ id });
    return this.listAllowances(actor);
  }

  // ---------------- الربط المحاسبي ----------------

  async config(org: string, em: EntityManager = this.db.manager): Promise<PayrollConfig> {
    const { gosiExpenseAccountId: _legacy, ...cfg } = (await this.core.settings(org, em)).payrollConfig ?? {};
    return { ...EMPTY_CONFIG, ...cfg };
  }

  async getConfig(actor: OrgUser) {
    return { config: await this.config(actor.organizationId), ...(await this.lookups(actor.organizationId)) };
  }

  async saveConfig(actor: OrgUser, dto: PayrollConfigDto) {
    const org = actor.organizationId;
    await this.assertAccounts(org, [
      { id: dto.payableAccountId, label: 'الرواتب المستحقة', nature: ['liabilities'] },
      { id: dto.gosiPayableAccountId, label: 'التأمينات المستحقة', nature: ['liabilities'] },
      { id: dto.deductionsAccountId, label: 'حساب الاستقطاعات' },
      { id: dto.advancesAccountId, label: 'حساب سلف الموظفين' },
    ]);
    await this.assertCash(org, dto.defaultCashAccountId, 'البنك الافتراضي');
    if (dto.stages.length) {
      const roleIds = dto.stages.map((s) => s.roleId).filter((x): x is string => !!x);
      const roles: { id: string }[] = roleIds.length ? await this.db.query('SELECT id FROM roles WHERE organization_id = $1 AND id = ANY($2)', [org, roleIds]) : [];
      if (roles.length !== new Set(roleIds).size) throw new BadRequestException('أحد الأدوار المختارة غير موجود');
    }
    const config: PayrollConfig = {
      payableAccountId: dto.payableAccountId ?? null, gosiPayableAccountId: dto.gosiPayableAccountId ?? null,
      deductionsAccountId: dto.deductionsAccountId ?? null, advancesAccountId: dto.advancesAccountId ?? null, defaultCashAccountId: dto.defaultCashAccountId ?? null,
      stages: dto.stages.map((s) => ({ name: s.name, roleId: s.roleId ?? null })),
    };
    await this.core.settings(org);
    await this.db.getRepository(HrSettings).update({ organizationId: org }, { payrollConfig: config });
    return this.getConfig(actor);
  }

  // ---------------- فئات تحميل المصروف ----------------

  async listProfiles(actor: OrgUser) {
    const org = actor.organizationId;
    const rows = await this.core.expenseProfiles(org);
    const jobs: { p: string | null; n: number }[] = await this.db.query(
      'SELECT expense_profile_id AS p, COUNT(*)::int AS n FROM hr_jobs WHERE organization_id = $1 AND is_active GROUP BY 1', [org],
    );
    const unassigned = jobs.find((j) => j.p === null)?.n ?? 0;
    return rows.map((r) => ({
      id: r.id, name: r.name, description: r.description, accounts: r.accounts, isDefault: r.isDefault, sortOrder: r.sortOrder,
      jobs: (jobs.find((j) => j.p === r.id)?.n ?? 0) + (r.isDefault ? unassigned : 0),
    }));
  }

  async saveProfile(actor: OrgUser, dto: ExpenseProfileDto, id?: string) {
    const org = actor.organizationId;
    const repo = this.db.getRepository(HrExpenseProfile);
    const rows = await this.core.expenseProfiles(org);
    const codes = new Set([...(await this.core.allowanceTypes(org)).map((t) => t.code), 'gosi']);
    const accounts: Record<string, string> = {};
    for (const a of dto.accounts) {
      if (!codes.has(a.code)) throw new BadRequestException(`البند «${a.code}» غير معرّف`);
      accounts[a.code] = a.accountId;
    }
    await this.assertAccounts(org, dto.accounts.map((a) => ({ id: a.accountId, label: `حساب مصروف «${a.code === 'gosi' ? 'التأمينات' : a.code}»`, nature: ['expenses'] })));
    const dup = rows.find((r) => r.name === dto.name && r.id !== id);
    if (dup) throw new ConflictException(`توجد فئة باسم «${dto.name}»`);
    let saved: HrExpenseProfile;
    if (id) {
      const row = rows.find((r) => r.id === id);
      if (!row) throw new NotFoundException('الفئة غير موجودة');
      if (row.isDefault && dto.isDefault === false) throw new BadRequestException('اختر فئة أخرى افتراضية بدلًا منها');
      await repo.update({ id }, { name: dto.name, description: dto.description ?? null, accounts });
      saved = { ...row, name: dto.name };
    } else {
      saved = await repo.save(repo.create({ organizationId: org, name: dto.name, description: dto.description ?? null, accounts, isDefault: false, sortOrder: rows.length }));
    }
    if (dto.isDefault) {
      await repo.update({ organizationId: org }, { isDefault: false });
      await repo.update({ id: saved.id }, { isDefault: true });
    }
    return this.listProfiles(actor);
  }

  async removeProfile(actor: OrgUser, id: string) {
    const org = actor.organizationId;
    const row = (await this.core.expenseProfiles(org)).find((r) => r.id === id);
    if (!row) throw new NotFoundException('الفئة غير موجودة');
    if (row.isDefault) throw new BadRequestException('الفئة الافتراضية لا تُحذف. اجعل فئة أخرى افتراضية أولًا');
    const [{ n }] = await this.db.query('SELECT COUNT(*)::int AS n FROM hr_jobs WHERE organization_id = $1 AND expense_profile_id = $2', [org, id]);
    if (n) throw new ConflictException(`الفئة مستخدمة في ${n} من الوظائف. انقلها لفئة أخرى أولًا`);
    await this.db.getRepository(HrExpenseProfile).delete({ id });
    return this.listProfiles(actor);
  }

  /** قوائم الاختيار من النظام المالي: الحسابات الفرعية، الحسابات التحليلية، البنوك، والأدوار */
  async lookups(org: string) {
    const [accounts, analytics, cash, roles] = await Promise.all([
      this.db.query(`SELECT id, code, name, nature, requires_analytic AS "requiresAnalytic" FROM acc_accounts WHERE organization_id = $1 AND kind = 'sub' AND is_active ORDER BY code`, [org]),
      this.db.query(`SELECT id, code, name FROM acc_analytic_accounts WHERE organization_id = $1 AND kind = 'sub' AND is_active ORDER BY code`, [org]),
      this.db.query(`SELECT id, name, kind, bank_name AS "bankName", iban FROM acc_cash_accounts WHERE organization_id = $1 AND is_active ORDER BY kind, name`, [org]),
      this.db.query('SELECT id, name FROM roles WHERE organization_id = $1 ORDER BY name', [org]),
    ]);
    return { accounts, analytics, cashAccounts: cash, roles };
  }

  // ---------------- إعداد الكشف ----------------

  private async buildLines(org: string, month: string, prev: RunLine[] = []) {
    const policy = await this.core.policy(org);
    const start = `${month}-01`;
    const end = lastDay(month);
    const employees = await this.db.getRepository(HrEmployee).createQueryBuilder('e').where('e.organization_id = :org', { org })
      .andWhere('e.hire_date <= :end', { end }).andWhere('(e.termination_date IS NULL OR e.termination_date >= :start)', { start })
      .orderBy('e.employee_no').getMany();
    const types = new Map((await this.core.allowanceTypes(org)).map((t) => [t.code, t]));
    const [units, jobs] = await Promise.all([
      this.db.getRepository(HrUnit).find({ where: { organizationId: org } }),
      this.db.getRepository(HrJob).find({ where: { organizationId: org }, select: ['id', 'title', 'expenseProfileId'] }),
    ]);
    const profiles = await this.core.expenseProfiles(org);
    const defaultProfile = profiles.find((p) => p.isDefault)!.id;
    const unpaidCodes = policy.leaveTypes.filter((t) => t.pay === 'unpaid').map((t) => t.code);
    const unpaid = unpaidCodes.length ? await this.db.getRepository(HrLeaveRequest).createQueryBuilder('l')
      .where('l.organization_id = :org AND l.status = :s', { org, s: 'approved' }).andWhere('l.leave_type IN (:...codes)', { codes: unpaidCodes })
      .andWhere('l.start_date <= :end AND l.end_date >= :start', { start, end }).getMany() : [];
    const att = await this.attendance.compute(org, month, employees);
    const due = await this.requests.dueInstallments(org, month);
    const warnings: string[] = [];
    if (att.cfg.enabled && !att.coverageEnd) warnings.push('لا توجد بصمات حضور لهذا الشهر، فلم يُخصم غياب أو تأخير');
    else if (att.cfg.enabled && att.coverageEnd && att.coverageEnd < end) warnings.push(`بيانات الحضور واصلة حتى ${att.coverageEnd}، وما بعده لا يُحتسب غيابًا`);
    const monthDays = daysBetween(start, end) + 1;
    const lines = employees.map((e) => {
      const old = prev.find((p) => p.employeeId === e.id);
      const from = e.hireDate > start ? e.hireDate : start;
      const to = e.terminationDate && e.terminationDate < end ? e.terminationDate : end;
      const worked = daysBetween(from, to) + 1;
      const ratio = worked >= monthDays ? 1 : round2(worked / policy.payroll.dayBasis);
      const raw = [{ code: 'basic', name: types.get('basic')?.name ?? 'الراتب الأساسي', amount: e.basicSalary }, ...e.allowances];
      const items = raw.map((i) => ({ code: i.code, name: types.get(i.code)?.name ?? i.name, full: i.amount, earned: round2(Math.min(i.amount * ratio, i.amount)) }));
      const gross = round2(raw.reduce((s, i) => s + i.amount, 0));
      const dailyWage = round2(gross / policy.payroll.dayBasis);
      const g = gosi(policy, partsOf(e.basicSalary, e.allowances), e.isSaudi, e.gosiFirstRegistration, end);
      const unpaidDays = unpaid.filter((l) => l.employeeId === e.id).reduce((s, l) => s + overlapDays(l.startDate, l.endDate, from, to), 0);
      const a = att.result.get(e.id)!;
      const attendance = old?.attendance.overridden && a.tracked
        ? old.attendance
        : { tracked: a.tracked, absentDays: a.tracked ? a.absentDays : 0, lateMinutes: a.tracked ? a.deductibleMinutes : 0, missingOut: a.tracked ? a.missingOut : 0, overridden: false };
      return computeLine({
        employeeId: e.id, employeeNo: e.employeeNo, fullName: e.fullName, isSaudi: e.isSaudi, unitId: e.unitId,
        unitName: units.find((u) => u.id === e.unitId)?.name ?? '', jobTitle: jobs.find((j) => j.id === e.jobId)?.title ?? '', iban: e.iban,
        expenseProfileId: jobs.find((j) => j.id === e.jobId)?.expenseProfileId ?? defaultProfile,
        items, gross, workedDays: Math.min(worked, monthDays), ratio, dailyWage, unpaidDays, unpaidDeduction: round2(unpaidDays * dailyWage),
        attendance, absenceDeduction: 0, lateDeduction: 0,
        additions: old?.additions ?? [], otherDeduction: old?.otherDeduction ?? 0, otherDeductionNote: old?.otherDeductionNote ?? null,
        advances: e.terminationDate && e.terminationDate < start ? [] : due.get(e.id) ?? [], advanceDeduction: 0,
        earned: 0, gosiEmployee: round2(g.employee.total * Math.min(ratio, 1)), gosiEmployer: round2(g.employer.total * Math.min(ratio, 1)),
        totalDeductions: 0, net: 0, employerCost: 0,
      }, policy);
    });
    const noIban = lines.filter((l) => !l.iban && l.net > 0).length;
    if (noIban) warnings.push(`${noIban} من الموظفين بدون آيبان، فلن يظهروا في كشف التحويل البنكي`);
    return { lines, warnings };
  }

  private history(actor: OrgUser, action: string, note: string | null = null, stageName: string | null = null): RunHistory {
    return { action, stageName, note, actorName: actor.fullName, at: new Date().toISOString() };
  }

  private async load(em: EntityManager, org: string, id: string) {
    const r = await em.getRepository(HrPayrollRun).createQueryBuilder('r').setLock('pessimistic_write')
      .where('r.id = :id AND r.organization_id = :org', { id, org }).getOne();
    if (!r) throw new NotFoundException('كشف الرواتب غير موجود');
    return r;
  }

  private editable(r: HrPayrollRun) {
    if (r.status !== 'draft' && r.status !== 'returned') throw new ConflictException('لا يُعدَّل الكشف إلا وهو قيد الإعداد أو معاد للتعديل');
  }

  async list(actor: OrgUser) {
    const rows = await this.db.getRepository(HrPayrollRun).find({ where: { organizationId: actor.organizationId }, order: { month: 'DESC', createdAt: 'DESC' } });
    const config = await this.config(actor.organizationId);
    return rows.map((r) => ({
      id: r.id, month: r.month, monthLabel: monthLabel(r.month), status: r.status, statusLabel: RUN_STATUS_AR[r.status],
      stageName: r.status === 'pending' && r.stageIndex !== null ? config.stages[r.stageIndex]?.name ?? null : null,
      employees: r.totals.employees ?? 0, net: r.totals.net ?? 0, employerCost: r.totals.employerCost ?? 0, vouchers: r.voucherIds.length,
      createdByName: r.createdByName, approvedAt: r.approvedAt,
    }));
  }

  async create(actor: OrgUser, month: string) {
    if (!MONTH.test(month)) throw new BadRequestException('الشهر غير صحيح');
    if (month > today().slice(0, 7)) throw new BadRequestException('لا يُصدر كشف لشهر لم يبدأ بعد');
    const org = actor.organizationId;
    const exists = await this.db.getRepository(HrPayrollRun).createQueryBuilder('r')
      .where('r.organization_id = :org AND r.month = :month AND r.status <> :c', { org, month, c: 'cancelled' }).getOne();
    if (exists) throw new ConflictException(`يوجد كشف رواتب لشهر ${monthLabel(month)}`);
    const { lines, warnings } = await this.buildLines(org, month);
    if (!lines.length) throw new BadRequestException('لا يوجد موظفون على رأس العمل في هذا الشهر');
    const repo = this.db.getRepository(HrPayrollRun);
    const run = await repo.save(repo.create({
      organizationId: org, month, status: 'draft', lines, totals: totalsOf(lines), warnings, history: [this.history(actor, 'create')], createdByName: actor.fullName,
    }));
    return this.get(actor, run.id);
  }

  async recalc(actor: OrgUser, id: string) {
    const org = actor.organizationId;
    await this.db.transaction(async (em) => {
      const r = await this.load(em, org, id);
      this.editable(r);
      const { lines, warnings } = await this.buildLines(org, r.month, r.lines);
      await em.getRepository(HrPayrollRun).update({ id }, { lines, totals: totalsOf(lines), warnings, history: [...r.history, this.history(actor, 'recalc')] });
    });
    return this.get(actor, id);
  }

  async updateLine(actor: OrgUser, id: string, employeeId: string, dto: RunLineDto) {
    const org = actor.organizationId;
    const policy = await this.core.policy(org);
    const types = new Map((await this.core.allowanceTypes(org)).map((t) => [t.code, t]));
    await this.db.transaction(async (em) => {
      const r = await this.load(em, org, id);
      this.editable(r);
      const idx = r.lines.findIndex((l) => l.employeeId === employeeId);
      if (idx < 0) throw new NotFoundException('الموظف ليس في هذا الكشف');
      const l = r.lines[idx];
      for (const a of dto.additions) {
        const t = types.get(a.code);
        if (!t || !t.isActive) throw new BadRequestException(`بند الإضافة «${a.code}» غير معرّف أو موقوف`);
      }
      if (dto.otherDeduction > 0 && !dto.otherDeductionNote) throw new BadRequestException('اكتب سبب الاستقطاع (سلفة أو جزاء مثلًا)');
      let attendance = l.attendance;
      if (dto.overrideAttendance) {
        if (!l.attendance.tracked) throw new BadRequestException('الموظف غير خاضع للبصمة في هذا الشهر');
        attendance = { ...l.attendance, absentDays: dto.absentDays ?? l.attendance.absentDays, lateMinutes: dto.lateMinutes ?? l.attendance.lateMinutes, overridden: true };
      }
      const next = computeLine({
        ...l, attendance, additions: dto.additions.map((a) => ({ code: a.code, amount: a.amount, note: a.note ?? null })),
        otherDeduction: dto.otherDeduction, otherDeductionNote: dto.otherDeduction > 0 ? dto.otherDeductionNote ?? null : null,
      }, policy);
      if (next.net < 0) throw new BadRequestException(`الاستقطاعات أكبر من مستحقات ${l.fullName} في هذا الشهر`);
      const lines = r.lines.slice();
      lines[idx] = next;
      await em.getRepository(HrPayrollRun).update({ id }, { lines, totals: totalsOf(lines), history: [...r.history, this.history(actor, 'line', l.fullName)] });
    });
    // إن أُلغي التعديل اليدوي على الحضور نعيد احتسابه من البصمات
    if (dto.overrideAttendance === false) {
      const r = await this.db.getRepository(HrPayrollRun).findOneByOrFail({ id });
      const lines = r.lines.map((l) => (l.employeeId === employeeId ? { ...l, attendance: { ...l.attendance, overridden: false } } : l));
      const built = await this.buildLines(org, r.month, lines);
      await this.db.getRepository(HrPayrollRun).update({ id }, { lines: built.lines, totals: totalsOf(built.lines), warnings: built.warnings });
    }
    return this.get(actor, id);
  }

  async cancel(actor: OrgUser, id: string) {
    await this.db.transaction(async (em) => {
      const r = await this.load(em, actor.organizationId, id);
      this.editable(r);
      await em.getRepository(HrPayrollRun).update({ id }, { status: 'cancelled', stageIndex: null, history: [...r.history, this.history(actor, 'cancel')] });
    });
    return this.get(actor, id);
  }

  // ---------------- القيد المحاسبي وسندات الصرف ----------------

  /** الحساب التحليلي للوحدة: حسابها، أو حساب أقرب وحدة أعلى منها */
  private analyticOf(units: HrUnit[], unitId: string) {
    let u = units.find((x) => x.id === unitId);
    for (let i = 0; u && i < 12; i++) {
      if (u.analyticAccountId) return u.analyticAccountId;
      u = units.find((x) => x.id === u!.parentId);
    }
    return null;
  }

  /** يبني سطور قيد الاستحقاق وخطة سندات الصرف، ويجمع كل النواقص في رسالة واحدة */
  async plan(org: string, r: HrPayrollRun, em: EntityManager = this.db.manager) {
    const cfg = await this.config(org, em);
    const types = new Map((await this.core.allowanceTypes(org, em)).map((t) => [t.code, t]));
    const units = await em.getRepository(HrUnit).find({ where: { organizationId: org } });
    const profiles = await this.core.expenseProfiles(org, em);
    const defaultProfile = profiles.find((p) => p.isDefault)!;
    const accounts: { id: string; code: string; name: string; requiresAnalytic: boolean }[] = await em.query(
      'SELECT id, code, name, requires_analytic AS "requiresAnalytic" FROM acc_accounts WHERE organization_id = $1', [org],
    );
    const acc = new Map(accounts.map((a) => [a.id, a]));
    const problems = new Set<string>();
    if (!cfg.payableAccountId) problems.add('حساب الرواتب المستحقة');
    const totals = totalsOf(r.lines);
    if (totals.gosiEmployee + totals.gosiEmployer > 0 && !cfg.gosiPayableAccountId) problems.add('حساب التأمينات المستحقة');
    if (totals.otherDeduction > 0 && !cfg.deductionsAccountId) problems.add('حساب الاستقطاعات');
    const advancesAccount = cfg.advancesAccountId ?? cfg.deductionsAccountId;
    if (totals.advanceDeduction > 0 && !advancesAccount) problems.add('حساب سلف الموظفين (أو حساب الاستقطاعات)');
    const lines = new Map<string, LineDto & { analyticId: string | null }>();
    const add = (side: 'debit' | 'credit', accountId: string, amount: number, analyticId: string | null, label: string) => {
      if (amount <= 0) return;
      const a = acc.get(accountId);
      const useAnalytic = side === 'debit' || a?.requiresAnalytic ? analyticId : null;
      const key = `${side}|${accountId}|${useAnalytic ?? ''}`;
      const cur = lines.get(key) ?? { accountId, debit: 0, credit: 0, label, analyticId: useAnalytic, analytic: useAnalytic ? [{ analyticId: useAnalytic, percent: 100 }] : [] };
      cur[side] = round2(cur[side] + amount);
      lines.set(key, cur);
    };
    const vouchers = new Map<string, PlanVoucher>();
    const banks = new Map<string, Map<string, { employeeId: string; employeeNo: number; fullName: string; iban: string | null; amount: number }>>();
    for (const l of r.lines) {
      const analyticId = this.analyticOf(units, l.unitId);
      const profile = profiles.find((p) => p.id === l.expenseProfileId) ?? defaultProfile;
      for (const part of allocateLine(l)) {
        const t = types.get(part.code);
        const name = t?.name ?? part.code;
        const expenseId = profile.accounts[part.code];
        if (!expenseId) {
          problems.add(`حساب مصروف «${name}» في فئة «${profile.name}»`);
          continue;
        }
        if (acc.get(expenseId)?.requiresAnalytic && !analyticId) problems.add(`الحساب التحليلي للوحدة «${l.unitName}»`);
        add('debit', expenseId, part.expense, analyticId, name);
        const payable = t?.payableAccountId ?? cfg.payableAccountId;
        const cash = t?.cashAccountId ?? cfg.defaultCashAccountId;
        if (!cash) problems.add(`بنك صرف بند «${name}» (أو البنك الافتراضي للرواتب)`);
        if (!payable || part.payable <= 0) continue;
        add('credit', payable, part.payable, analyticId, `${name} المستحق`);
        if (!cash) continue;
        const key = `${cash}|${payable}`;
        const v = vouchers.get(key) ?? { cashAccountId: cash, payableAccountId: payable, amount: 0, codes: [], employees: 0 };
        v.amount = round2(v.amount + part.payable);
        if (!v.codes.includes(part.code)) v.codes.push(part.code);
        vouchers.set(key, v);
        const sheet = banks.get(cash) ?? new Map();
        const row = sheet.get(l.employeeId) ?? { employeeId: l.employeeId, employeeNo: l.employeeNo, fullName: l.fullName, iban: l.iban, amount: 0 };
        row.amount = round2(row.amount + part.payable);
        sheet.set(l.employeeId, row);
        banks.set(cash, sheet);
      }
      if (l.gosiEmployer > 0) {
        const gosiId = profile.accounts.gosi;
        if (!gosiId) problems.add(`حساب مصروف التأمينات في فئة «${profile.name}»`);
        else {
          if (acc.get(gosiId)?.requiresAnalytic && !analyticId) problems.add(`الحساب التحليلي للوحدة «${l.unitName}»`);
          add('debit', gosiId, l.gosiEmployer, analyticId, 'حصة الجمعية في التأمينات الاجتماعية');
        }
      }
      if (cfg.gosiPayableAccountId) add('credit', cfg.gosiPayableAccountId, round2(l.gosiEmployee + l.gosiEmployer), analyticId, 'التأمينات الاجتماعية المستحقة');
      if (cfg.deductionsAccountId) add('credit', cfg.deductionsAccountId, l.otherDeduction, analyticId, 'استقطاعات من الرواتب');
      if (advancesAccount) add('credit', advancesAccount, l.advanceDeduction ?? 0, analyticId, 'أقساط سلف الموظفين');
    }
    vouchers.forEach((v) => {
      v.employees = banks.get(v.cashAccountId)?.size ?? 0;
    });
    const entryLines: LineDto[] = [...lines.values()]
      .sort((a, b) => (a.debit > 0 ? 0 : 1) - (b.debit > 0 ? 0 : 1))
      .map(({ accountId, debit, credit, label, analytic }) => ({ accountId, debit, credit, label, analytic }));
    return {
      problems: [...problems], entryLines, vouchers: [...vouchers.values()],
      banks: [...banks].map(([cashAccountId, rows]) => ({ cashAccountId, rows: [...rows.values()].sort((a, b) => a.employeeNo - b.employeeNo) })),
      typeName: (code: string) => types.get(code)?.name ?? code,
    };
  }

  private async readyPlan(org: string, r: HrPayrollRun, em: EntityManager) {
    const p = await this.plan(org, r, em);
    if (p.problems.length) {
      throw new BadRequestException(`أكمل الربط المحاسبي قبل الاعتماد: ${p.problems.join('، ')}. من إعدادات الموارد البشرية (تبويب البدلات والربط المحاسبي) أو الهيكل التنظيمي`);
    }
    // تحقق مسبق بقواعد القيود نفسها في النظام المالي
    await this.entries.cleanLines(org, 'journal', p.entryLines, em);
    return p;
  }

  private async roleIds(actor: OrgUser): Promise<Set<string>> {
    const rows: { role_id: string }[] = await this.db.query('SELECT role_id FROM user_roles WHERE user_id = $1', [actor.id]);
    return new Set(rows.map((r) => r.role_id));
  }

  private canDecide(actor: OrgUser, stage: { roleId: string | null } | undefined, roles: Set<string>) {
    if (!actor.permissions.includes(P.approvePayroll) && !actor.isSuperadmin) return false;
    if (!stage?.roleId || actor.isSuperadmin) return true;
    return roles.has(stage.roleId);
  }

  async submit(actor: OrgUser, id: string) {
    const org = actor.organizationId;
    await this.db.transaction(async (em) => {
      const r = await this.load(em, org, id);
      this.editable(r);
      if (r.lines.some((l) => l.net < 0)) throw new BadRequestException('في الكشف موظف صافي راتبه بالسالب');
      await this.readyPlan(org, r, em);
      const cfg = await this.config(org, em);
      const repo = em.getRepository(HrPayrollRun);
      if (!cfg.stages.length) {
        if (!this.canDecide(actor, undefined, new Set())) {
          throw new ForbiddenException('لم تُعرَّف مراحل لاعتماد المسير، والاعتماد المباشر يحتاج صلاحية اعتماد مسير الرواتب');
        }
        await this.finalize(em, actor, r, [...r.history, this.history(actor, 'submit')], null);
        return;
      }
      await repo.update({ id }, { status: 'pending', stageIndex: 0, history: [...r.history, this.history(actor, 'submit', null, cfg.stages[0].name)] });
    });
    return this.get(actor, id);
  }

  async decide(actor: OrgUser, id: string, dto: RunDecisionDto) {
    const org = actor.organizationId;
    await this.db.transaction(async (em) => {
      const r = await this.load(em, org, id);
      if (r.status !== 'pending') throw new ConflictException('الكشف لا ينتظر قرارًا');
      const cfg = await this.config(org, em);
      const idx = r.stageIndex ?? 0;
      const stage = cfg.stages[idx];
      if (!this.canDecide(actor, stage, await this.roleIds(actor))) throw new ForbiddenException('القرار في هذه المرحلة ليس من صلاحيتك');
      const repo = em.getRepository(HrPayrollRun);
      if (dto.decision === 'return') {
        if (!dto.note) throw new BadRequestException('اكتب سبب الإرجاع');
        await repo.update({ id }, { status: 'returned', stageIndex: null, history: [...r.history, this.history(actor, 'return', dto.note, stage?.name ?? null)] });
      } else if (idx < cfg.stages.length - 1) {
        await repo.update({ id }, { stageIndex: idx + 1, history: [...r.history, this.history(actor, 'approve', dto.note ?? null, stage?.name ?? null)] });
      } else {
        await this.finalize(em, actor, r, [...r.history, this.history(actor, 'approve', dto.note ?? null, stage?.name ?? null)], stage?.name ?? null);
      }
    });
    return this.get(actor, id);
  }

  /** الاعتماد النهائي: قيد استحقاق الرواتب مرحّل في النظام المالي بتاريخ آخر يوم في الشهر */
  private async finalize(em: EntityManager, actor: OrgUser, r: HrPayrollRun, history: RunHistory[], stageName: string | null) {
    const org = actor.organizationId;
    const p = await this.readyPlan(org, r, em);
    const date = lastDay(r.month);
    const year = await this.accCore.assertWritable(org, date, em);
    await this.entries.assertNoApprovedInventory(em, year);
    const clean = await this.entries.cleanLines(org, 'journal', p.entryLines, em);
    const entry = await this.entries.createSystemEntry(em, actor, year, 'journal', {
      documentDate: date, description: `استحقاق رواتب شهر ${monthLabel(r.month)} (${r.lines.length} موظفًا) من مسير الرواتب`,
    }, clean);
    // أقساط السلف المستردة بهذا الكشف
    const reps = r.lines.flatMap((l) => (l.advances ?? []).filter((a) => a.amount > 0).map((a) => ({ organizationId: org, advanceId: a.advanceId, runId: r.id, month: r.month, amount: a.amount })));
    if (reps.length) await em.getRepository(HrAdvanceRepayment).insert(reps);
    await em.getRepository(HrPayrollRun).update({ id: r.id }, {
      status: 'approved', stageIndex: null, entryId: entry.id, approvedAt: new Date(),
      history: [...history, this.history(actor, 'final', `القيد رقم ${entry.entryNo}`, stageName)],
    });
  }

  private async voucherRows(ids: string[], em: EntityManager = this.db.manager) {
    if (!ids.length) return [];
    const rows: { id: string; serial: number; amount: string; status: keyof typeof VOUCHER_STATUS_AR; purpose: string; cash: string; voucher_date: string }[] = await em.query(
      `SELECT v.id, v.serial, v.amount, v.status, v.purpose, v.voucher_date::text, c.name AS cash FROM acc_vouchers v
        JOIN acc_cash_accounts c ON c.id = v.cash_account_id WHERE v.id = ANY($1) ORDER BY v.serial`, [ids],
    );
    return rows.map((v) => ({
      id: v.id, serial: v.serial, amount: Number(v.amount), status: v.status, statusLabel: VOUCHER_STATUS_AR[v.status], purpose: v.purpose, cashAccountName: v.cash, voucherDate: v.voucher_date,
    }));
  }

  /** إلغاء الاعتماد قبل الصرف: يُعكس القيد ويعود الكشف للتعديل */
  async reopen(actor: OrgUser, id: string, note: string | null | undefined) {
    const org = actor.organizationId;
    if (!note) throw new BadRequestException('اكتب سبب إلغاء الاعتماد');
    await this.db.transaction(async (em) => {
      const r = await this.load(em, org, id);
      if (r.status !== 'approved') throw new ConflictException('الكشف غير معتمد');
      if (!this.canDecide(actor, undefined, new Set())) throw new ForbiddenException('إلغاء الاعتماد يحتاج صلاحية اعتماد مسير الرواتب');
      const live = (await this.voucherRows(r.voucherIds, em)).filter((v) => v.status !== 'cancelled' && v.status !== 'rejected');
      if (live.length) throw new ConflictException('أُنشئت سندات صرف لهذا الكشف. ألغِ السندات من النظام المالي أولًا، ثم ألغِ اعتماد الكشف');
      if (r.entryId) await this.entries.reverseVoucherEntry(em, actor, r.entryId, `إلغاء اعتماد مسير رواتب ${monthLabel(r.month)}: ${note}`);
      await em.getRepository(HrAdvanceRepayment).delete({ runId: r.id });
      await em.getRepository(HrPayrollRun).update({ id }, {
        status: 'returned', entryId: null, voucherIds: [], approvedAt: null, history: [...r.history, this.history(actor, 'reopen', note)],
      });
    });
    return this.get(actor, id);
  }

  /** سندات صرف مسودة في النظام المالي: سند لكل بنك وحساب استحقاق، ثم تمر بمراحل اعتماد سندات الصرف */
  async createVouchers(actor: OrgUser, id: string, dto: RunVouchersDto) {
    const org = actor.organizationId;
    await this.db.transaction(async (em) => {
      const r = await this.load(em, org, id);
      if (r.status !== 'approved') throw new ConflictException('تُنشأ سندات الصرف بعد الاعتماد النهائي للكشف');
      const live = (await this.voucherRows(r.voucherIds, em)).filter((v) => v.status !== 'cancelled' && v.status !== 'rejected');
      if (live.length) throw new ConflictException('أُنشئت سندات الصرف لهذا الكشف من قبل');
      const p = await this.readyPlan(org, r, em);
      if (!p.vouchers.length) throw new BadRequestException('لا توجد مبالغ للصرف في هذا الكشف');
      const label = monthLabel(r.month);
      const ids: string[] = [];
      for (const v of p.vouchers) {
        const names = v.codes.map(p.typeName).join(' و');
        const saved = await this.vouchers.insertDraft(em, actor, 'payment', {
          voucherDate: dto.voucherDate, partyName: `موظفو الجمعية (${v.employees} موظفًا)`, amount: v.amount,
          purpose: `صرف ${names} لشهر ${label} حسب مسير الرواتب المعتمد`, sourceType: 'payroll', sourceRef: r.month, projectName: null,
          method: 'transfer', methodRef: null, cashAccountId: v.cashAccountId, counterAccountId: v.payableAccountId, partnerId: null, analytic: [],
        });
        ids.push(saved.id);
      }
      await em.getRepository(HrPayrollRun).update({ id }, { voucherIds: ids, history: [...r.history, this.history(actor, 'vouchers', `${ids.length} سند`)] });
    });
    return this.get(actor, id);
  }

  // ---------------- العرض ----------------

  async get(actor: OrgUser, id: string) {
    const org = actor.organizationId;
    const r = await this.db.getRepository(HrPayrollRun).findOne({ where: { id, organizationId: org } });
    if (!r) throw new NotFoundException('كشف الرواتب غير موجود');
    const cfg = await this.config(org);
    const roles = await this.roleIds(actor);
    const stage = r.status === 'pending' && r.stageIndex !== null ? cfg.stages[r.stageIndex] : undefined;
    const [entry] = r.entryId ? await this.db.query('SELECT id, entry_no AS "entryNo", status FROM acc_entries WHERE id = $1', [r.entryId]) : [];
    const vouchers = await this.voucherRows(r.voucherIds);
    const live = vouchers.filter((v) => v.status !== 'cancelled' && v.status !== 'rejected');
    let plan: Awaited<ReturnType<PayrollService['plan']>> | null = null;
    let planError: string | null = null;
    if (r.status !== 'cancelled') {
      plan = await this.plan(org, r);
      if (plan.problems.length) planError = `ينقص الربط المحاسبي: ${plan.problems.join('، ')}`;
    }
    const lookups = plan ? await this.lookups(org) : null;
    const accName = (aid: string) => {
      const a = lookups?.accounts.find((x: { id: string }) => x.id === aid) as { code: string; name: string } | undefined;
      return a ? `${a.code} ${a.name}` : '';
    };
    const cashName = (cid: string) => (lookups?.cashAccounts.find((x: { id: string }) => x.id === cid) as { name: string } | undefined)?.name ?? '';
    const types = new Map((await this.core.allowanceTypes(org)).map((t) => [t.code, t]));
    const manage = actor.permissions.includes(P.payroll) || actor.isSuperadmin;
    const editable = r.status === 'draft' || r.status === 'returned';
    return {
      id: r.id, month: r.month, monthLabel: monthLabel(r.month), status: r.status, statusLabel: RUN_STATUS_AR[r.status],
      lines: r.lines, totals: r.totals, warnings: r.warnings,
      stages: cfg.stages.map((s, i) => ({ name: s.name, current: r.status === 'pending' && r.stageIndex === i, done: r.status === 'approved' || (r.status === 'pending' && (r.stageIndex ?? 0) > i) })),
      stageName: stage?.name ?? null,
      history: r.history.map((h) => ({ ...h, label: ACTION_AR[h.action] ?? h.action })),
      entry: entry ?? null, vouchers, createdByName: r.createdByName, approvedAt: r.approvedAt, createdAt: r.createdAt,
      allowanceTypes: [...types.values()].filter((t) => t.isActive).map((t) => ({ code: t.code, name: t.name })),
      planError,
      entryPreview: plan && !plan.problems.length ? plan.entryLines.map((l) => ({
        account: accName(l.accountId), debit: l.debit, credit: l.credit, label: l.label,
        analytic: l.analytic?.length ? (lookups?.analytics.find((a: { id: string }) => a.id === l.analytic![0].analyticId) as { code: string; name: string } | undefined)?.name ?? '' : '',
      })) : [],
      voucherPlan: plan ? plan.vouchers.map((v) => ({ cashAccountName: cashName(v.cashAccountId), payableAccount: accName(v.payableAccountId), amount: v.amount, items: v.codes.map(plan!.typeName), employees: v.employees })) : [],
      bankSheets: plan ? plan.banks.map((b) => ({
        cashAccountId: b.cashAccountId, cashAccountName: cashName(b.cashAccountId), total: round2(b.rows.reduce((s, x) => s + x.amount, 0)), rows: b.rows,
      })) : [],
      can: {
        edit: editable && manage,
        submit: editable && manage,
        cancel: editable && manage,
        decide: r.status === 'pending' && this.canDecide(actor, stage, roles),
        reopen: r.status === 'approved' && !live.length && this.canDecide(actor, undefined, roles),
        vouchers: r.status === 'approved' && !live.length && (actor.permissions.includes(P.payPayroll) || actor.isSuperadmin),
      },
    };
  }
}
