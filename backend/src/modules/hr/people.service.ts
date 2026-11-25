import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import { OrgUser } from '../../core/auth/decorators';
import { ContractType, HrEmployee, HrGrade, HrJob, HrLeaveRequest, HrPerformanceCard, HrRequest, HrUnit, LeaveStatus, QiwaStatus } from './entities/hr.entity';
import { EmployeeDto, EosCalcDto, LeaveDto, TerminateDto } from './hr.dto';
import { HrCore, today } from './hr-core.service';
import { HR_PERMISSIONS as P } from './hr.manifest';
import {
  accruedMonthly, addDays, daysBetween, employeeEos, endOfService, EOS_REASONS, EosReason, gosi, HrPolicy, LeaveTypeRule, monthlyEosProvision, round2,
  serviceSpan, wageFor, wageTotal,
} from './hr-policy';
import { partsOf } from './org.service';

export const CONTRACT_AR: Record<ContractType, string> = { fixed: 'محدد المدة', indefinite: 'غير محدد المدة', part_time: 'دوام جزئي', temporary: 'مؤقت / موسمي' };
export const QIWA_AR: Record<QiwaStatus, string> = { documented: 'موثّق في قوى', pending: 'بانتظار موافقة الموظف', not_documented: 'غير موثّق' };
export const LEAVE_STATUS_AR: Record<LeaveStatus, string> = { pending: 'بانتظار الاعتماد', approved: 'معتمدة', rejected: 'مرفوضة', cancelled: 'ملغاة' };
export const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
export const lastDay = (month: string) => {
  const [y, m] = month.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
};
export const overlapDays = (a1: string, a2: string, b1: string, b2: string) => {
  const s = a1 > b1 ? a1 : b1;
  const e = a2 < b2 ? a2 : b2;
  return e < s ? 0 : daysBetween(s, e) + 1;
};

/**
 * شؤون الموظفين: الملف والعقد والراتب، تفصيل الراتب والتأمينات، مسير الرواتب للمعاينة، نهاية الخدمة،
 * الإجازات وأرصدتها حسب اللائحة، ولوحة الموارد البشرية وتنبيهاتها.
 */
@Injectable()
export class PeopleService {
  constructor(
    private readonly db: DataSource,
    private readonly core: HrCore,
    @InjectRepository(HrEmployee) private readonly employees: Repository<HrEmployee>,
    @InjectRepository(HrLeaveRequest) private readonly leaves: Repository<HrLeaveRequest>,
  ) {}

  async employee(org: string, id: string) {
    const e = await this.employees.findOne({ where: { id, organizationId: org } });
    if (!e) throw new NotFoundException('الموظف غير موجود');
    return e;
  }

  // ---------------- الموظفون ----------------

  async list(actor: OrgUser, status?: string) {
    const org = actor.organizationId;
    const where = status === 'terminated' ? { organizationId: org, status: 'terminated' as const } : status === 'all' ? { organizationId: org } : { organizationId: org, status: 'active' as const };
    const rows = await this.employees.find({ where, order: { employeeNo: 'ASC' } });
    const { units, jobs, grades } = await this.lookups(org);
    const salaries = actor.permissions.includes(P.salaries) || actor.isSuperadmin;
    return rows.map((e) => ({
      id: e.id, employeeNo: e.employeeNo, fullName: e.fullName, nationalId: e.nationalId, nationality: e.nationality, isSaudi: e.isSaudi, gender: e.gender,
      unitName: units.get(e.unitId)?.name ?? '', jobTitle: jobs.get(e.jobId)?.title ?? '', gradeName: e.gradeId ? grades.get(e.gradeId)?.code ?? null : null,
      hireDate: e.hireDate, contractType: e.contractType, contractTypeLabel: CONTRACT_AR[e.contractType], contractEnd: e.contractEnd,
      qiwaStatus: e.qiwaStatus, status: e.status, terminationDate: e.terminationDate, userId: e.userId,
      employmentKind: e.employmentKind,
      gross: salaries ? (e.employmentKind === 'contractor' ? null : round2(e.basicSalary + e.allowances.reduce((s, a) => s + a.amount, 0))) : null,
    }));
  }

  async users(actor: OrgUser) {
    const rows: { id: string; full_name: string; email: string; is_active: boolean; employee_id: string | null; employee_name: string | null }[] = await this.db.query(
      `SELECT u.id, u.full_name, u.email, u.is_active, e.id AS employee_id, e.full_name AS employee_name FROM users u
         LEFT JOIN hr_employees e ON e.user_id = u.id WHERE u.organization_id = $1 ORDER BY u.full_name`, [actor.organizationId],
    );
    return rows.map((r) => ({ id: r.id, fullName: r.full_name, email: r.email, isActive: r.is_active, employeeId: r.employee_id, employeeName: r.employee_name }));
  }

  private async lookups(org: string) {
    const [u, j, g] = await Promise.all([
      this.db.getRepository(HrUnit).find({ where: { organizationId: org } }),
      this.db.getRepository(HrJob).find({ where: { organizationId: org } }),
      this.db.getRepository(HrGrade).find({ where: { organizationId: org } }),
    ]);
    return { units: new Map(u.map((x) => [x.id, x])), jobs: new Map(j.map((x) => [x.id, x])), grades: new Map(g.map((x) => [x.id, x])) };
  }

  private async rolesOf(org: string, userId: string) {
    const rows: { name: string; kind: string; start_date: string | null; end_date: string | null; note: string | null }[] = await this.db.query(
      `SELECT r.name, 'role' AS kind, NULL::text AS start_date, NULL::text AS end_date, NULL::text AS note
         FROM user_roles ur JOIN roles r ON r.id = ur.role_id AND r.organization_id = $1 WHERE ur.user_id = $2
       UNION ALL
       SELECT r.name, 'assignment', a.start_date::text, a.end_date::text, a.note
         FROM role_assignments a JOIN roles r ON r.id = a.role_id
        WHERE a.organization_id = $1 AND a.user_id = $2 AND a.ended_at IS NULL
          AND (a.end_date IS NULL OR a.end_date >= (now() AT TIME ZONE 'Asia/Riyadh')::date)
       ORDER BY 2, 1`, [org, userId]);
    return rows.map((r) => ({ name: r.name, kind: r.kind as 'role' | 'assignment', startDate: r.start_date, endDate: r.end_date, note: r.note }));
  }

  async profile(actor: OrgUser, id: string) {
    const org = actor.organizationId;
    const e = await this.employee(org, id);
    const policy = await this.core.policy(org);
    const { units, jobs, grades } = await this.lookups(org);
    const manager = e.managerId ? await this.employees.findOne({ where: { id: e.managerId }, select: ['id', 'fullName'] }) : null;
    const salaries = actor.permissions.includes(P.salaries) || actor.isSuperadmin;
    const asOf = e.terminationDate ?? today();
    const grade = e.gradeId ? grades.get(e.gradeId) : null;
    const base = {
      ...e,
      basicSalary: salaries ? e.basicSalary : null, payRate: salaries ? e.payRate : null, allowances: salaries ? e.allowances : [], iban: salaries ? e.iban : null, eosAmount: salaries ? e.eosAmount : null,
      unitName: units.get(e.unitId)?.name ?? '', jobTitle: jobs.get(e.jobId)?.title ?? '', jobCode: jobs.get(e.jobId)?.code ?? '',
      gradeName: grade ? `${grade.code} ${grade.name}` : null, salaryRange: grade && salaries ? { min: grade.minSalary, max: grade.maxSalary } : null,
      managerName: manager?.fullName ?? null,
      userName: e.userId ? ((await this.db.query('SELECT full_name FROM users WHERE id = $1', [e.userId]))[0]?.full_name ?? null) : null,
      // أدوار حساب الدخول وتكليفاته (الدائمة، والتكليفات السارية والقادمة) ليظهر في الملف ما يعمله الموظف
      roles: e.userId ? await this.rolesOf(org, e.userId) : [],
      contractTypeLabel: CONTRACT_AR[e.contractType], qiwaLabel: QIWA_AR[e.qiwaStatus],
      terminationLabel: e.terminationReason ? EOS_REASONS[e.terminationReason as EosReason]?.label ?? e.terminationReason : null,
      service: serviceSpan(e.hireDate, asOf),
      balances: await this.balances(org, e, policy, asOf),
      leaves: (await this.leaves.find({ where: { organizationId: org, employeeId: id }, order: { startDate: 'DESC' }, take: 30 })).map((l) => this.leaveRow(l, policy)),
    };
    // المتعاون بعقد تعاون: لا راتب ولا تأمينات ولا مكافأة نهاية خدمة، وأتعابه في كشف المتعاونين
    if (!salaries || e.employmentKind === 'contractor') return { ...base, breakdown: null, eos: null };
    const wage = wageFor(policy.eos.wageBase, partsOf(e.basicSalary, e.allowances));
    return {
      ...base,
      breakdown: this.breakdown(policy, e, asOf),
      eos: {
        wage,
        contractEnd: endOfService(policy, wage, e.hireDate, asOf, 'contract_end'),
        resignation: endOfService(policy, wage, e.hireDate, asOf, 'resignation'),
      },
    };
  }

  /** تفصيل الراتب الشهري: البنود، التأمينات بحصتيها، الصافي، والتكلفة الكاملة على الشركة */
  breakdown(policy: HrPolicy, e: HrEmployee, onDate: string) {
    const parts = partsOf(e.basicSalary, e.allowances);
    const gross = round2(wageTotal(parts));
    const g = gosi(policy, parts, e.isSaudi, e.gosiFirstRegistration, onDate);
    const service = serviceSpan(e.hireDate, onDate);
    // المتعاون لا يُجنَّب له مخصص نهاية خدمة
    const eosProvision = e.employmentKind === 'contractor' ? 0 : monthlyEosProvision(policy, wageFor(policy.eos.wageBase, parts), service.decimalYears);
    return {
      items: [{ code: 'basic', name: 'الراتب الأساسي', amount: e.basicSalary }, ...e.allowances],
      gross, gosi: g, net: round2(gross - g.employee.total), eosProvision,
      employerCost: round2(gross + g.employer.total + eosProvision),
      dailyWage: round2(gross / policy.payroll.dayBasis),
    };
  }

  private async validate(org: string, dto: EmployeeDto, policy: HrPolicy, selfId?: string) {
    const job = await this.db.getRepository(HrJob).findOne({ where: { id: dto.jobId, organizationId: org } });
    if (!job) throw new BadRequestException('الوظيفة غير موجودة');
    const unitId = dto.unitId ?? job.unitId;
    await this.core.unit(org, unitId);
    if (dto.isSaudi !== dto.nationalId.startsWith('1')) {
      throw new BadRequestException(dto.isSaudi ? 'رقم الهوية الوطنية للسعودي يبدأ بـ 1' : 'رقم الإقامة لغير السعودي يبدأ بـ 2');
    }
    const dup = await this.employees.findOne({ where: { organizationId: org, nationalId: dto.nationalId } });
    if (dup && dup.id !== selfId) throw new ConflictException(`رقم الهوية مسجل للموظف ${dup.fullName}`);
    if (dto.managerId) {
      if (dto.managerId === selfId) throw new BadRequestException('لا يمكن أن يكون الموظف مديرًا لنفسه');
      await this.employee(org, dto.managerId);
    }
    if (dto.userId) {
      const [u] = await this.db.query('SELECT id FROM users WHERE id = $1 AND organization_id = $2', [dto.userId, org]);
      if (!u) throw new BadRequestException('حساب الدخول غير موجود في الشركة');
      const other = await this.employees.findOne({ where: { userId: dto.userId } });
      if (other && other.id !== selfId) throw new ConflictException(`حساب الدخول مربوط بالموظف ${other.fullName}`);
    }
    if (dto.contractType === 'fixed' && !dto.contractEnd) throw new BadRequestException('حدد تاريخ نهاية العقد محدد المدة');
    if (dto.contractEnd && dto.contractEnd <= dto.contractStart) throw new BadRequestException('نهاية العقد يجب أن تكون بعد بدايته');
    if (dto.contractStart > dto.hireDate) throw new BadRequestException('تاريخ المباشرة قبل بداية العقد');
    let probationEnd = dto.probationEnd ?? null;
    if (!probationEnd && !selfId && policy.work.probationDays > 0) probationEnd = addDays(dto.hireDate, policy.work.probationDays - 1);
    if (probationEnd) {
      if (probationEnd < dto.hireDate) throw new BadRequestException('نهاية فترة التجربة قبل المباشرة');
      if (daysBetween(dto.hireDate, probationEnd) + 1 > policy.work.maxProbationDays) {
        throw new BadRequestException(`فترة التجربة لا تتجاوز ${policy.work.maxProbationDays} يومًا حسب اللائحة`);
      }
    }
    if (dto.employmentKind === 'contractor') {
      // المتعاون: أجره من أساس العقد وقيمته، فلا راتب أساسي ولا بدلات ولا تأمينات ولا مرتبة
      if (!dto.payBasis) throw new BadRequestException('اختر طريقة احتساب أجر المتعاون (شهري، يومي، بالساعة، بالمهمة)');
      if (!dto.payRate) throw new BadRequestException('اكتب قيمة أجر المتعاون');
      dto.basicSalary = 0;
      dto.allowances = [];
      dto.salaryException = null;
    } else {
      dto.employmentKind = 'staff';
      dto.payBasis = null;
      dto.payRate = null;
    }
    const codes = dto.allowances.map((a) => a.code);
    if (new Set(codes).size !== codes.length) throw new BadRequestException('بند مكرر في البدلات');
    const types = await this.core.checkCodes(org, codes);
    dto.allowances.forEach((a) => {
      a.name = types.get(a.code)!.name;
    });
    if (dto.attendanceCode) {
      const others: { id: string; full_name: string }[] = await this.db.query(
        `SELECT id, full_name FROM hr_employees WHERE organization_id = $1 AND COALESCE(NULLIF(attendance_code, ''), employee_no::text) = $2 AND id <> COALESCE($3::uuid, '00000000-0000-0000-0000-000000000000')`,
        [org, dto.attendanceCode, selfId ?? null],
      );
      if (others.length) throw new ConflictException(`رقم البصمة ${dto.attendanceCode} مستخدم للموظف ${others[0].full_name}`);
    }
    let gradeId = dto.employmentKind === 'contractor' ? null : job.gradeId;
    if (gradeId) {
      const grade = await this.db.getRepository(HrGrade).findOneOrFail({ where: { id: gradeId } });
      if ((dto.step ?? 1) > grade.steps) throw new BadRequestException(`المرتبة ${grade.code} فيها ${grade.steps} درجات فقط`);
      const out = dto.basicSalary < grade.minSalary || dto.basicSalary > grade.maxSalary;
      if (out && !dto.salaryException) {
        throw new BadRequestException(`الراتب الأساسي خارج حدود المرتبة ${grade.code} (${grade.minSalary} - ${grade.maxSalary})، اكتب سبب الاستثناء`);
      }
    } else gradeId = null;
    const opening: Record<string, number> = {};
    for (const [k, v] of Object.entries(dto.leaveOpening ?? {})) {
      if (!policy.leaveTypes.some((t) => t.code === k)) throw new BadRequestException(`نوع الإجازة "${k}" غير موجود في اللائحة`);
      const n = Number(v);
      if (!Number.isFinite(n) || n < -366 || n > 366) throw new BadRequestException('الرصيد الافتتاحي غير صحيح');
      opening[k] = round2(n);
    }
    return { unitId, gradeId, probationEnd, opening };
  }

  async create(actor: OrgUser, dto: EmployeeDto) {
    const org = actor.organizationId;
    const policy = await this.core.policy(org);
    const v = await this.validate(org, dto, policy);
    const id = await this.db.transaction(async (em) => {
      const no = await this.core.nextNo(em, org, 'nextEmployeeNo');
      const repo = em.getRepository(HrEmployee);
      const e = await repo.save(repo.create({
        ...dto, organizationId: org, employeeNo: no, unitId: v.unitId, gradeId: v.gradeId, probationEnd: v.probationEnd, leaveOpening: v.opening,
        step: dto.step ?? 1, managerId: dto.managerId ?? null, salaryException: dto.salaryException ?? null,
      }));
      return e.id;
    });
    return { id };
  }

  async update(actor: OrgUser, id: string, dto: EmployeeDto) {
    const org = actor.organizationId;
    const e = await this.employee(org, id);
    if (e.status === 'terminated') throw new BadRequestException('لا يمكن تعديل موظف انتهت خدمته');
    const policy = await this.core.policy(org);
    // تصنيف المتعاون وأجره لا يغيّره إلا من يملك صلاحية الرواتب
    const salaries = actor.permissions.includes(P.salaries) || actor.isSuperadmin;
    if (!salaries) {
      dto.employmentKind = e.employmentKind;
      dto.payBasis = e.payBasis;
      dto.payRate = e.payRate;
    }
    if ((dto.employmentKind ?? 'staff') !== e.employmentKind) {
      // لا يتغير التصنيف وهو في كشف قائم لم يُلغَ، حتى لا يُصرف له في كشفين للشهر نفسه
      const [open] = await this.db.query(
        `SELECT r.month FROM hr_payroll_runs r WHERE r.organization_id = $1 AND r.status IN ('draft', 'returned', 'pending')
            AND EXISTS (SELECT 1 FROM jsonb_array_elements(r.lines) x WHERE x->>'employeeId' = $2) LIMIT 1`, [org, id]);
      if (open) throw new ConflictException(`لا يتغير التصنيف وهو في كشف شهر ${open.month} قيد الإعداد أو الاعتماد. اعتمد الكشف أو ألغه أولًا`);
      if (e.employmentKind === 'staff') {
        const [adv] = await this.db.query(
          `SELECT 1 FROM hr_advances a WHERE a.organization_id = $1 AND a.employee_id = $2 AND a.status = 'active'
              AND a.amount > COALESCE((SELECT SUM(p.amount) FROM hr_advance_repayments p WHERE p.organization_id = $1 AND p.advance_id = a.id), 0) LIMIT 1`, [org, id]);
        if (adv) throw new ConflictException('لدى الموظف سلفة لم تُسدد بالكامل، فلا يُحوّل متعاونًا قبل سدادها');
      }
    }
    const v = await this.validate(org, dto, policy, id);
    Object.assign(e, {
      ...dto, unitId: v.unitId, gradeId: v.gradeId, probationEnd: v.probationEnd, leaveOpening: v.opening, step: dto.step ?? e.step,
      managerId: dto.managerId ?? null, salaryException: dto.salaryException ?? null,
    });
    await this.employees.save(e);
    return { id };
  }

  /** إنهاء الخدمة: يحسب المكافأة وتعويض رصيد الإجازة السنوية ويغلق ملف الموظف */
  async terminate(actor: OrgUser, id: string, dto: TerminateDto) {
    const org = actor.organizationId;
    const e = await this.employee(org, id);
    if (e.status === 'terminated') throw new BadRequestException('خدمة الموظف منتهية بالفعل');
    const [{ n }] = await this.db.query(`SELECT COUNT(*)::int AS n FROM hr_separations WHERE organization_id = $1 AND employee_id = $2 AND status IN ('clearance', 'settlement')`, [org, id]);
    if (n) throw new ConflictException('للموظف ملف إنهاء خدمة مفتوح، تُنهى خدمته باعتماد مستحقاته من الملف');
    if (dto.terminationDate < e.hireDate) throw new BadRequestException('تاريخ انتهاء الخدمة قبل المباشرة');
    const policy = await this.core.policy(org);
    const settlement = await this.settlement(org, e, policy, dto.terminationDate, dto.reason);
    await this.db.transaction(async (em) => {
      await em.getRepository(HrEmployee).update({ id }, {
        status: 'terminated', terminationDate: dto.terminationDate, terminationReason: dto.reason, terminationNote: dto.note ?? null, eosAmount: settlement.eos.amount,
      });
      // الإجازات المعلقة بعد آخر يوم تُلغى
      await em.getRepository(HrLeaveRequest).update({ organizationId: org, employeeId: id, status: 'pending' }, { status: 'cancelled', decisionNote: 'أُلغيت بانتهاء الخدمة' });
    });
    return settlement;
  }

  private async settlement(org: string, e: HrEmployee, policy: HrPolicy, end: string, reason: EosReason) {
    const parts = partsOf(e.basicSalary, e.allowances);
    const contractor = e.employmentKind === 'contractor';
    const eos = employeeEos(policy, e.employmentKind, wageFor(policy.eos.wageBase, parts), e.hireDate, end, reason);
    // المتعاون لا مكافأة له ولا تعويض رصيد إجازات؛ أتعابه المستحقة تُصرف من كشف المتعاونين
    const annual = contractor ? null : (await this.balances(org, e, policy, end)).find((b) => b.code === 'annual');
    const leaveDays = Math.max(annual?.available ?? 0, 0);
    const dailyWage = round2(wageTotal(parts) / policy.payroll.dayBasis);
    const leaveEncashment = round2(leaveDays * dailyWage);
    return { contractor, eos, leaveDays, dailyWage, leaveEncashment, total: round2(eos.amount + leaveEncashment) };
  }

  async eosCalc(actor: OrgUser, dto: EosCalcDto) {
    const policy = await this.core.policy(actor.organizationId);
    if (dto.employeeId) {
      const e = await this.employee(actor.organizationId, dto.employeeId);
      return { employee: { id: e.id, fullName: e.fullName, hireDate: e.hireDate, employmentKind: e.employmentKind }, ...(await this.settlement(actor.organizationId, e, policy, dto.endDate, dto.reason)) };
    }
    if (!dto.startDate || dto.wage === null || dto.wage === undefined) throw new BadRequestException('اختر موظفًا أو اكتب الأجر وتاريخ المباشرة');
    if (dto.endDate < dto.startDate) throw new BadRequestException('تاريخ نهاية الخدمة قبل المباشرة');
    return { employee: null, eos: endOfService(policy, dto.wage, dto.startDate, dto.endDate, dto.reason) };
  }

  reasons() {
    return Object.entries(EOS_REASONS).map(([value, r]) => ({ value, label: r.label, kind: r.kind }));
  }

  // ---------------- مسير الرواتب (معاينة) ----------------

  async payroll(actor: OrgUser, month: string) {
    if (!MONTH.test(month)) throw new BadRequestException('الشهر غير صحيح');
    const org = actor.organizationId;
    const policy = await this.core.policy(org);
    const start = `${month}-01`;
    const end = lastDay(month);
    const rows = await this.employees.createQueryBuilder('e')
      .where('e.organization_id = :org', { org }).andWhere(`e.employment_kind = 'staff'`).andWhere('e.hire_date <= :end', { end })
      .andWhere('(e.termination_date IS NULL OR e.termination_date >= :start)', { start }).orderBy('e.employee_no').getMany();
    const unpaidCodes = policy.leaveTypes.filter((t) => t.pay === 'unpaid').map((t) => t.code);
    const leaves = unpaidCodes.length && rows.length
      ? await this.leaves.createQueryBuilder('l').where('l.organization_id = :org', { org }).andWhere('l.status = :s', { s: 'approved' })
        .andWhere('l.leave_type IN (:...codes)', { codes: unpaidCodes }).andWhere('l.start_date <= :end AND l.end_date >= :start', { start, end }).getMany()
      : [];
    const { units, jobs } = await this.lookups(org);
    const monthDays = daysBetween(start, end) + 1;
    const lines = rows.map((e) => {
      const b = this.breakdown(policy, e, end);
      // الاستحقاق الجزئي لمن باشر أو انتهت خدمته خلال الشهر
      const from = e.hireDate > start ? e.hireDate : start;
      const to = e.terminationDate && e.terminationDate < end ? e.terminationDate : end;
      const worked = daysBetween(from, to) + 1;
      const ratio = worked >= monthDays ? 1 : worked / policy.payroll.dayBasis;
      const unpaidDays = leaves.filter((l) => l.employeeId === e.id).reduce((s, l) => s + overlapDays(l.startDate, l.endDate, from, to), 0);
      const earned = round2(Math.min(b.gross * ratio, b.gross));
      const unpaidDeduction = round2(Math.min(unpaidDays * b.dailyWage, earned));
      const gosiEmployee = round2(b.gosi.employee.total * Math.min(ratio, 1));
      const gosiEmployer = round2(b.gosi.employer.total * Math.min(ratio, 1));
      return {
        id: e.id, employeeNo: e.employeeNo, fullName: e.fullName, isSaudi: e.isSaudi, unitName: units.get(e.unitId)?.name ?? '', jobTitle: jobs.get(e.jobId)?.title ?? '',
        items: b.items, gross: b.gross, workedDays: Math.min(worked, monthDays), earned, unpaidDays, unpaidDeduction, gosiEmployee, gosiEmployer,
        net: round2(earned - unpaidDeduction - gosiEmployee), eosProvision: round2(b.eosProvision * Math.min(ratio, 1)),
        employerCost: round2(earned - unpaidDeduction + gosiEmployer + b.eosProvision * Math.min(ratio, 1)), iban: e.iban,
      };
    });
    const sum = (k: keyof (typeof lines)[number]) => round2(lines.reduce((s, l) => s + (l[k] as number), 0));
    const byUnit = new Map<string, { unit: string; employees: number; net: number; employerCost: number }>();
    lines.forEach((l) => {
      const u = byUnit.get(l.unitName) ?? { unit: l.unitName, employees: 0, net: 0, employerCost: 0 };
      u.employees += 1;
      u.net = round2(u.net + l.net);
      u.employerCost = round2(u.employerCost + l.employerCost);
      byUnit.set(l.unitName, u);
    });
    return {
      month, lines, byUnit: [...byUnit.values()],
      totals: {
        employees: lines.length, gross: sum('earned'), unpaidDeduction: sum('unpaidDeduction'), gosiEmployee: sum('gosiEmployee'), gosiEmployer: sum('gosiEmployer'),
        net: sum('net'), eosProvision: sum('eosProvision'), employerCost: sum('employerCost'), missingIban: lines.filter((l) => !l.iban).length,
      },
    };
  }

  // ---------------- الإجازات ----------------

  private leaveRow(l: HrLeaveRequest, policy: HrPolicy) {
    return {
      id: l.id, employeeId: l.employeeId, leaveType: l.leaveType, leaveTypeName: policy.leaveTypes.find((t) => t.code === l.leaveType)?.name ?? l.leaveType,
      startDate: l.startDate, endDate: l.endDate, days: l.days, note: l.note, status: l.status, statusLabel: LEAVE_STATUS_AR[l.status],
      decisionNote: l.decisionNote, decidedByName: l.decidedByName, createdByName: l.createdByName, createdAt: l.createdAt,
    };
  }

  /** أرصدة كل أنواع الإجازات لموظف في تاريخ معيّن */
  async balances(org: string, e: HrEmployee, policy: HrPolicy, asOf: string) {
    const rows = await this.leaves.find({ where: { organizationId: org, employeeId: e.id, status: In(['approved', 'pending']) } });
    const year = asOf.slice(0, 4);
    const serviceMonths = serviceSpan(e.hireDate, asOf).totalDays / 30.4;
    return policy.leaveTypes.filter((t) => !t.gender || t.gender === e.gender).map((t) => {
      const mine = rows.filter((r) => r.leaveType === t.code);
      const sumOf = (list: HrLeaveRequest[]) => list.reduce((s, r) => s + r.days, 0);
      const eligible = serviceMonths >= t.minServiceMonths;
      let entitlement: number | null = null;
      let taken = 0;
      let pending = 0;
      if (t.accrual === 'monthly') {
        const from = e.leaveOpeningDate && e.leaveOpeningDate > e.hireDate ? e.leaveOpeningDate : e.hireDate;
        const opening = e.leaveOpening?.[t.code] ?? 0;
        entitlement = round2(opening + accruedMonthly(t, e.hireDate, from, asOf));
        const counted = mine.filter((r) => r.startDate >= from);
        taken = sumOf(counted.filter((r) => r.status === 'approved'));
        pending = sumOf(counted.filter((r) => r.status === 'pending'));
      } else {
        const scope = t.accrual === 'once' ? mine : mine.filter((r) => r.startDate.startsWith(year));
        taken = sumOf(scope.filter((r) => r.status === 'approved'));
        pending = sumOf(scope.filter((r) => r.status === 'pending'));
        if (t.accrual === 'yearly') entitlement = t.days;
        if (t.accrual === 'once') entitlement = eligible ? t.days : 0;
        if (t.accrual === 'per_request') entitlement = t.days || null;
      }
      const available = entitlement === null ? null : t.accrual === 'per_request' ? entitlement : round2(entitlement - taken - pending);
      return {
        code: t.code, name: t.name, accrual: t.accrual, pay: t.pay, eligible, note: t.note,
        entitlement, taken, pending, available: eligible ? available : 0,
      };
    });
  }

  async listLeaves(actor: OrgUser, status?: string) {
    const org = actor.organizationId;
    const policy = await this.core.policy(org);
    const where = status && status !== 'all' ? { organizationId: org, status: status as LeaveStatus } : { organizationId: org };
    const rows = await this.leaves.find({ where, order: { createdAt: 'DESC' }, take: 300 });
    const names = new Map((await this.employees.find({ where: { organizationId: org }, select: ['id', 'fullName', 'employeeNo'] })).map((e) => [e.id, e]));
    return {
      types: policy.leaveTypes.map((t) => ({ code: t.code, name: t.name, gender: t.gender, accrual: t.accrual, days: t.days })),
      requests: rows.map((l) => ({ ...this.leaveRow(l, policy), employeeName: names.get(l.employeeId)?.fullName ?? '', employeeNo: names.get(l.employeeId)?.employeeNo ?? null })),
    };
  }

  async employeeBalances(actor: OrgUser, id: string) {
    const e = await this.employee(actor.organizationId, id);
    return this.balances(actor.organizationId, e, await this.core.policy(actor.organizationId), today());
  }

  async requestLeave(actor: OrgUser, dto: LeaveDto) {
    const org = actor.organizationId;
    const e = await this.employee(org, dto.employeeId);
    if (e.status !== 'active') throw new BadRequestException('خدمة الموظف منتهية');
    const policy = await this.core.policy(org);
    const rule = policy.leaveTypes.find((t) => t.code === dto.leaveType);
    if (!rule) throw new BadRequestException('نوع الإجازة غير موجود في اللائحة');
    this.checkLeave(rule, e, dto);
    const days = daysBetween(dto.startDate, dto.endDate) + 1;
    const overlap = await this.leaves.createQueryBuilder('l').where('l.organization_id = :org AND l.employee_id = :emp', { org, emp: e.id })
      .andWhere('l.status IN (:...s)', { s: ['pending', 'approved'] }).andWhere('l.start_date <= :end AND l.end_date >= :start', { start: dto.startDate, end: dto.endDate }).getOne();
    if (overlap) throw new ConflictException(`تتداخل مع إجازة أخرى من ${overlap.startDate} إلى ${overlap.endDate}`);
    const bal = (await this.balances(org, e, policy, dto.startDate > today() ? dto.startDate : today())).find((b) => b.code === rule.code);
    if (!bal || !bal.eligible) throw new BadRequestException(`لا يستحق الموظف ${rule.name}${rule.minServiceMonths ? ` قبل إكمال ${rule.minServiceMonths} شهرًا في الخدمة` : ''}`);
    if (rule.accrual === 'per_request') {
      if (rule.days && days > rule.days) throw new BadRequestException(`${rule.name} ${rule.days} أيام في المرة الواحدة`);
    } else if (bal.available !== null && days > bal.available) {
      throw new BadRequestException(`الرصيد المتاح من ${rule.name} ${bal.available} يومًا، والمطلوب ${days}`);
    }
    const l = await this.leaves.save(this.leaves.create({
      organizationId: org, employeeId: e.id, leaveType: rule.code, startDate: dto.startDate, endDate: dto.endDate, days, note: dto.note ?? null, createdByName: actor.fullName,
    }));
    return { id: l.id, days };
  }

  private checkLeave(rule: LeaveTypeRule, e: HrEmployee, dto: LeaveDto) {
    if (dto.endDate < dto.startDate) throw new BadRequestException('نهاية الإجازة قبل بدايتها');
    if (dto.startDate < e.hireDate) throw new BadRequestException('الإجازة قبل تاريخ المباشرة');
    if (rule.gender && rule.gender !== e.gender) throw new BadRequestException(`${rule.name} ${rule.gender === 'female' ? 'للموظفات' : 'للموظفين'} فقط`);
    if (daysBetween(dto.startDate, dto.endDate) + 1 > 366) throw new BadRequestException('مدة الإجازة طويلة جدًا');
  }

  async decideLeave(actor: OrgUser, id: string, decision: 'approve' | 'reject', note: string | null) {
    const l = await this.leaves.findOne({ where: { id, organizationId: actor.organizationId } });
    if (!l) throw new NotFoundException('طلب الإجازة غير موجود');
    if (l.status !== 'pending') throw new BadRequestException('الطلب ليس بانتظار الاعتماد');
    if (decision === 'reject' && !note) throw new BadRequestException('اكتب سبب الرفض');
    Object.assign(l, { status: decision === 'approve' ? 'approved' : 'rejected', decisionNote: note, decidedByName: actor.fullName, decidedAt: new Date() });
    await this.leaves.save(l);
    await this.syncRequest(l, decision === 'approve' ? 'approved' : 'rejected', actor, note);
    return { id };
  }

  async cancelLeave(actor: OrgUser, id: string) {
    const l = await this.leaves.findOne({ where: { id, organizationId: actor.organizationId } });
    if (!l) throw new NotFoundException('طلب الإجازة غير موجود');
    const approver = actor.isSuperadmin || actor.permissions.includes(P.approveLeaves);
    if (l.status === 'approved') {
      if (!approver) throw new ForbiddenException('إلغاء إجازة معتمدة لمن يملك صلاحية الاعتماد');
      if (l.startDate <= today()) throw new BadRequestException('لا يمكن إلغاء إجازة بدأت، عدّل تاريخ المباشرة بدلًا من ذلك');
    } else if (l.status !== 'pending') throw new BadRequestException('الطلب منتهٍ');
    Object.assign(l, { status: 'cancelled', decidedByName: actor.fullName, decidedAt: new Date() });
    await this.leaves.save(l);
    await this.syncRequest(l, 'cancelled', actor, null);
    return { id };
  }

  /**
   * قرار شؤون الموظفين من شاشة الإجازات على إجازة قُدمت من الخدمة الذاتية: يُغلق طلبها بالقرار نفسه
   * (الخطوة الحالية تُسجل باسم متخذ القرار بالنيابة) حتى لا يبقى الطلب معلقًا عند المدير.
   */
  private async syncRequest(l: HrLeaveRequest, status: 'approved' | 'rejected' | 'cancelled', actor: OrgUser, note: string | null) {
    if (!l.requestId) return;
    const repo = this.db.getRepository(HrRequest);
    const r = await repo.findOne({ where: { id: l.requestId } });
    if (!r || (r.status !== 'pending' && r.status !== 'returned')) return;
    const at = new Date().toISOString();
    const steps = r.steps.map((s, i) => (i === r.stepIndex && status !== 'cancelled'
      ? { ...s, status: status === 'approved' ? 'approved' as const : 'rejected' as const, actorName: actor.fullName, onBehalf: true, note, at }
      : s));
    await repo.update({ id: r.id }, {
      status, steps, stepIndex: null, decidedAt: new Date(),
      history: [...r.history, { action: 'hr_decision', note: note ?? (status === 'approved' ? 'اعتماد' : status === 'rejected' ? 'رفض' : 'إلغاء'), actorName: actor.fullName, at }],
    });
  }

  // ---------------- اللوحة والتنبيهات ----------------

  async dashboard(actor: OrgUser, vacancies: number) {
    const org = actor.organizationId;
    const policy = await this.core.policy(org);
    const now = today();
    // العدد والتوطين وتكلفة الرواتب للموظفين فقط؛ المتعاونون يُعدّون منفصلين وتشملهم تنبيهات العقود والهويات
    const everyone = await this.employees.find({ where: { organizationId: org, status: 'active' } });
    const active = everyone.filter((e) => e.employmentKind !== 'contractor');
    const contractors = everyone.length - active.length;
    const { units } = await this.lookups(org);
    const saudi = active.filter((e) => e.isSaudi).length;
    const byUnit = new Map<string, number>();
    active.forEach((e) => byUnit.set(units.get(e.unitId)?.name ?? '-', (byUnit.get(units.get(e.unitId)?.name ?? '-') ?? 0) + 1));
    const within = (d: string | null, days: number) => !!d && d >= now && d <= addDays(now, days);
    const alerts: { kind: string; level: 'danger' | 'warning' | 'info'; text: string; employeeId?: string; date?: string | null }[] = [];
    for (const e of everyone) {
      if (e.contractEnd && e.contractEnd < now) alerts.push({ kind: 'contract', level: 'danger', text: `عقد ${e.fullName} منتهٍ ولم يُجدَّد`, employeeId: e.id, date: e.contractEnd });
      else if (within(e.contractEnd, 60)) alerts.push({ kind: 'contract', level: 'warning', text: `عقد ${e.fullName} ينتهي قريبًا`, employeeId: e.id, date: e.contractEnd });
      if (within(e.probationEnd, 30)) alerts.push({ kind: 'probation', level: 'info', text: `فترة تجربة ${e.fullName} تنتهي، قرّر التثبيت`, employeeId: e.id, date: e.probationEnd });
      if (e.idExpiry && e.idExpiry < now) alerts.push({ kind: 'id', level: 'danger', text: `${e.isSaudi ? 'هوية' : 'إقامة'} ${e.fullName} منتهية`, employeeId: e.id, date: e.idExpiry });
      else if (within(e.idExpiry, 90)) alerts.push({ kind: 'id', level: 'warning', text: `${e.isSaudi ? 'هوية' : 'إقامة'} ${e.fullName} تنتهي خلال 90 يومًا`, employeeId: e.id, date: e.idExpiry });
      if (!e.isSaudi && within(e.passportExpiry, 90)) alerts.push({ kind: 'passport', level: 'warning', text: `جواز ${e.fullName} ينتهي خلال 90 يومًا`, employeeId: e.id, date: e.passportExpiry });
      if (e.qiwaStatus !== 'documented') alerts.push({ kind: 'qiwa', level: 'warning', text: `عقد ${e.fullName} غير موثّق في قوى`, employeeId: e.id });
      if (e.isSaudi && !e.gosiNumber && e.employmentKind !== 'contractor') alerts.push({ kind: 'gosi', level: 'info', text: `لم يُسجَّل رقم التأمينات للموظف ${e.fullName}`, employeeId: e.id });
    }
    const order = { danger: 0, warning: 1, info: 2 };
    alerts.sort((a, b) => order[a.level] - order[b.level] || (a.date ?? '9').localeCompare(b.date ?? '9'));
    const [{ n: pendingLeaves }] = await this.db.query(`SELECT COUNT(*)::int AS n FROM hr_leave_requests WHERE organization_id = $1 AND status = 'pending'`, [org]);
    const [{ n: onLeave }] = await this.db.query(
      `SELECT COUNT(DISTINCT employee_id)::int AS n FROM hr_leave_requests WHERE organization_id = $1 AND status = 'approved' AND start_date <= $2 AND end_date >= $2`, [org, now]);
    const [{ n: draftJobs }] = await this.db.query(`SELECT COUNT(*)::int AS n FROM hr_jobs WHERE organization_id = $1 AND status = 'draft' AND is_active`, [org]);
    const [{ n: pendingPlans }] = await this.db.query(`SELECT COUNT(*)::int AS n FROM hr_staffing_plans WHERE organization_id = $1 AND status = 'submitted'`, [org]);
    const cards = await this.db.getRepository(HrPerformanceCard).find({ where: { organizationId: org, year: Number(now.slice(0, 4)) } });
    const salaries = actor.permissions.includes(P.salaries) || actor.isSuperadmin;
    let payroll: { gross: number; gosiEmployer: number; employerCost: number } | null = null;
    if (salaries) {
      const bs = active.map((e) => this.breakdown(policy, e, now));
      payroll = { gross: round2(bs.reduce((s, b) => s + b.gross, 0)), gosiEmployer: round2(bs.reduce((s, b) => s + b.gosi.employer.total, 0)), employerCost: round2(bs.reduce((s, b) => s + b.employerCost, 0)) };
    }
    return {
      headcount: active.length, contractors, saudi, nonSaudi: active.length - saudi, saudization: active.length ? round2((saudi / active.length) * 100) : 0,
      female: active.filter((e) => e.gender === 'female').length, male: active.filter((e) => e.gender === 'male').length,
      byUnit: [...byUnit.entries()].map(([unit, n]) => ({ unit, n })).sort((a, b) => b.n - a.n),
      vacancies, pendingLeaves, onLeave, draftJobs, pendingPlans,
      performance: {
        year: Number(now.slice(0, 4)), cards: cards.length, approved: cards.filter((c) => c.status === 'approved').length,
        awaitingApproval: cards.filter((c) => c.status === 'evaluated').length,
        average: cards.filter((c) => c.finalScore !== null).length
          ? round2(cards.filter((c) => c.finalScore !== null).reduce((s, c) => s + (c.finalScore as number), 0) / cards.filter((c) => c.finalScore !== null).length) : null,
      },
      payroll, alerts: alerts.slice(0, 40), alertsTotal: alerts.length,
      newHires: active.filter((e) => e.hireDate >= addDays(now, -90)).length,
    };
  }
}
