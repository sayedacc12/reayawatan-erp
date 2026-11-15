import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import { OrgUser } from '../../core/auth/decorators';
import { CompetencyKind, HrCompetency, HrEmployee, HrGrade, HrJob, HrStaffingPlan, HrUnit } from './entities/hr.entity';
import { CompetencyDto, DecisionDto, GradeDto, JobDto, PlanDto, UnitDto } from './hr.dto';
import { HrCore } from './hr-core.service';
import { gosi, HrPolicy, monthlyEosProvision, round2, WageParts, wageFor } from './hr-policy';

export const COMPETENCY_KIND_AR: Record<CompetencyKind, string> = { core: 'أساسية', leadership: 'قيادية', technical: 'فنية' };
export const FUNDING_AR: Record<string, string> = { own: 'موارد ذاتية', project: 'مشروع', grant: 'منحة', restricted: 'تبرع مقيد' };
export const PLAN_STATUS_AR: Record<string, string> = { draft: 'مسودة', submitted: 'بانتظار الاعتماد', approved: 'معتمدة', rejected: 'مرفوضة' };

/** راتب الدرجة داخل المرتبة: الحد الأدنى مع العلاوة التراكمية، بحد أعلى هو سقف المرتبة */
export function stepSalary(g: Pick<HrGrade, 'minSalary' | 'maxSalary' | 'stepIncrement'>, step: number) {
  return round2(Math.min(g.minSalary * (1 + g.stepIncrement / 100) ** (step - 1), g.maxSalary));
}

/** البدلات الافتراضية للمرتبة على راتب أساسي معيّن */
export function gradeAllowances(g: Pick<HrGrade, 'allowances'>, basic: number) {
  return g.allowances.map((a) => ({ code: a.code, name: a.name, amount: round2(a.kind === 'percent' ? (basic * a.value) / 100 : a.value) }));
}

export function partsOf(basic: number, items: { code: string; amount: number }[]): WageParts {
  const by = (c: string) => items.filter((i) => i.code === c).reduce((s, i) => s + i.amount, 0);
  const housing = by('housing');
  const transport = by('transport');
  return { basic, housing, transport, others: round2(items.reduce((s, i) => s + i.amount, 0) - housing - transport) };
}

/** التكلفة الشهرية التقديرية لوظيفة على أدنى درجة في مرتبتها */
export function estimateMonthlyCost(policy: HrPolicy, grade: HrGrade | null, forSaudi: boolean, onDate: string) {
  if (!grade) return { basic: 0, gross: 0, gosiEmployer: 0, eosProvision: 0, total: 0 };
  const basic = grade.minSalary;
  const parts = partsOf(basic, gradeAllowances(grade, basic));
  const gross = round2(parts.basic + parts.housing + parts.transport + parts.others);
  // التعيين الجديد يخضع للنظام الجديد للتأمينات
  const g = gosi(policy, parts, forSaudi, onDate, onDate);
  const eosProvision = monthlyEosProvision(policy, wageFor(policy.eos.wageBase, parts), 0);
  return { basic, gross, gosiEmployer: g.employer.total, eosProvision, total: round2(gross + g.employer.total + eosProvision) };
}

/**
 * التنظيم والتخطيط: الهيكل التنظيمي بمستويات مرنة، سلم الرواتب، مكتبة الجدارات، الوظائف وأوصافها
 * (بكود جودة وإصدار واعتماد)، وخطط التعيين بتكلفتها التقديرية.
 */
@Injectable()
export class OrgService {
  constructor(
    private readonly db: DataSource,
    private readonly core: HrCore,
    @InjectRepository(HrUnit) private readonly units: Repository<HrUnit>,
    @InjectRepository(HrGrade) private readonly grades: Repository<HrGrade>,
    @InjectRepository(HrCompetency) private readonly comps: Repository<HrCompetency>,
    @InjectRepository(HrJob) private readonly jobs: Repository<HrJob>,
    @InjectRepository(HrStaffingPlan) private readonly plans: Repository<HrStaffingPlan>,
  ) {}

  // ---------------- الهيكل التنظيمي ----------------

  async structure(actor: OrgUser) {
    const org = actor.organizationId;
    const s = await this.core.settings(org);
    const rows = await this.units.find({ where: { organizationId: org }, order: { level: 'ASC', sortOrder: 'ASC', name: 'ASC' } });
    const counts: { unit_id: string; jobs: number; headcount: number }[] = await this.db.query(
      'SELECT unit_id, COUNT(*)::int AS jobs, COALESCE(SUM(headcount),0)::int AS headcount FROM hr_jobs WHERE organization_id = $1 AND is_active GROUP BY 1', [org]);
    const staff: { unit_id: string; n: number }[] = await this.db.query(
      `SELECT unit_id, COUNT(*)::int AS n FROM hr_employees WHERE organization_id = $1 AND status = 'active' GROUP BY 1`, [org]);
    const managers = await this.employeeNames(org, rows.map((r) => r.managerEmployeeId));
    const c = new Map(counts.map((x) => [x.unit_id, x]));
    const e = new Map(staff.map((x) => [x.unit_id, x.n]));
    return {
      levels: s.structureLevels,
      units: rows.map((u) => ({
        id: u.id, parentId: u.parentId, level: u.level, levelName: s.structureLevels[u.level] ?? `المستوى ${u.level + 1}`, code: u.code, name: u.name,
        managerEmployeeId: u.managerEmployeeId, managerName: u.managerEmployeeId ? managers.get(u.managerEmployeeId) ?? null : null,
        costCenter: u.costCenter, description: u.description, sortOrder: u.sortOrder,
        jobs: c.get(u.id)?.jobs ?? 0, headcount: c.get(u.id)?.headcount ?? 0, employees: e.get(u.id) ?? 0,
      })),
    };
  }

  private async employeeNames(org: string, ids: (string | null)[]) {
    const list = [...new Set(ids.filter((x): x is string => !!x))];
    if (!list.length) return new Map<string, string>();
    const rows = await this.db.getRepository(HrEmployee).find({ where: { organizationId: org, id: In(list) }, select: ['id', 'fullName'] });
    return new Map(rows.map((r) => [r.id, r.fullName]));
  }

  private async checkUnit(org: string, dto: UnitDto, selfId?: string) {
    const s = await this.core.settings(org);
    if (dto.level >= s.structureLevels.length) throw new BadRequestException('المستوى غير معرّف في إعدادات الهيكل');
    if (dto.parentId) {
      const parent = await this.core.unit(org, dto.parentId);
      if (parent.level >= dto.level) throw new BadRequestException(`الوحدة على مستوى "${s.structureLevels[dto.level]}" يجب أن تتبع وحدة في مستوى أعلى منه`);
      // منع الدوران: الأب لا يكون من فروع الوحدة نفسها
      let p: HrUnit | null = parent;
      while (p && selfId) {
        if (p.id === selfId) throw new BadRequestException('لا يمكن أن تتبع الوحدة إحدى وحداتها الفرعية');
        p = p.parentId ? await this.units.findOne({ where: { id: p.parentId } }) : null;
      }
    } else if (dto.level !== 0 && (await this.units.exist({ where: { organizationId: org, level: 0 } }))) {
      throw new BadRequestException('اختر الوحدة التي تتبعها هذه الوحدة');
    }
    if (dto.managerEmployeeId && !(await this.db.getRepository(HrEmployee).exist({ where: { id: dto.managerEmployeeId, organizationId: org } }))) {
      throw new BadRequestException('مدير الوحدة غير موجود');
    }
  }

  async createUnit(actor: OrgUser, dto: UnitDto) {
    await this.checkUnit(actor.organizationId, dto);
    const u = await this.units.save(this.units.create({ ...dto, organizationId: actor.organizationId, parentId: dto.parentId ?? null }));
    return { id: u.id };
  }

  async updateUnit(actor: OrgUser, id: string, dto: UnitDto) {
    const u = await this.core.unit(actor.organizationId, id);
    await this.checkUnit(actor.organizationId, dto, id);
    const children = await this.units.find({ where: { organizationId: actor.organizationId, parentId: id } });
    if (children.some((c) => c.level <= dto.level)) throw new BadRequestException('لا يمكن نقل الوحدة لمستوى أدنى من وحداتها الفرعية');
    Object.assign(u, { ...dto, parentId: dto.parentId ?? null });
    await this.units.save(u);
    return { id };
  }

  async removeUnit(actor: OrgUser, id: string) {
    const org = actor.organizationId;
    await this.core.unit(org, id);
    if (await this.units.exist({ where: { organizationId: org, parentId: id } })) throw new ConflictException('احذف الوحدات الفرعية أولًا');
    if (await this.jobs.exist({ where: { organizationId: org, unitId: id } })) throw new ConflictException('الوحدة عليها وظائف، انقلها أولًا');
    if (await this.db.getRepository(HrEmployee).exist({ where: { organizationId: org, unitId: id } })) throw new ConflictException('الوحدة عليها موظفون');
    await this.units.delete({ id, organizationId: org });
  }

  // ---------------- سلم الرواتب ----------------

  async listGrades(actor: OrgUser) {
    const org = actor.organizationId;
    const rows = await this.grades.find({ where: { organizationId: org }, order: { sortOrder: 'ASC', minSalary: 'ASC' } });
    const jobs = await this.jobs.find({ where: { organizationId: org, isActive: true }, select: ['id', 'title', 'gradeId', 'headcount'] });
    const staff: { grade_id: string; n: number; avg: number }[] = await this.db.query(
      `SELECT grade_id, COUNT(*)::int AS n, AVG(basic_salary)::float AS avg FROM hr_employees WHERE organization_id = $1 AND status = 'active' GROUP BY 1`, [org]);
    const st = new Map(staff.map((s) => [s.grade_id, s]));
    const levels = (await this.core.settings(org)).structureLevels;
    return rows.map((g) => ({
      id: g.id, code: g.code, name: g.name, structureLevel: g.structureLevel, structureLevelName: g.structureLevel !== null ? levels[g.structureLevel] ?? null : null,
      minSalary: g.minSalary, maxSalary: g.maxSalary, steps: g.steps, stepIncrement: g.stepIncrement, allowances: g.allowances, sortOrder: g.sortOrder,
      scale: Array.from({ length: g.steps }, (_, i) => {
        const basic = stepSalary(g, i + 1);
        const allowances = gradeAllowances(g, basic);
        return { step: i + 1, basic, allowances, gross: round2(basic + allowances.reduce((s, a) => s + a.amount, 0)) };
      }),
      jobs: jobs.filter((j) => j.gradeId === g.id).map((j) => ({ id: j.id, title: j.title, headcount: j.headcount })),
      employees: st.get(g.id)?.n ?? 0, averageBasic: st.get(g.id) ? round2(st.get(g.id)!.avg) : null,
    }));
  }

  private checkGrade(dto: GradeDto) {
    if (dto.maxSalary < dto.minSalary) throw new BadRequestException('الحد الأعلى للراتب أقل من الحد الأدنى');
    const codes = dto.allowances.map((a) => a.code);
    if (new Set(codes).size !== codes.length) throw new BadRequestException('رموز البدلات مكررة');
  }

  async createGrade(actor: OrgUser, dto: GradeDto) {
    this.checkGrade(dto);
    if (await this.grades.exist({ where: { organizationId: actor.organizationId, code: dto.code } })) throw new ConflictException('رمز المرتبة مستخدم');
    const g = await this.grades.save(this.grades.create({ ...dto, organizationId: actor.organizationId, structureLevel: dto.structureLevel ?? null }));
    return { id: g.id };
  }

  async updateGrade(actor: OrgUser, id: string, dto: GradeDto) {
    this.checkGrade(dto);
    const g = await this.grade(actor.organizationId, id);
    if (dto.code !== g.code && (await this.grades.exist({ where: { organizationId: actor.organizationId, code: dto.code } }))) throw new ConflictException('رمز المرتبة مستخدم');
    Object.assign(g, { ...dto, structureLevel: dto.structureLevel ?? null });
    await this.grades.save(g);
    return { id };
  }

  async removeGrade(actor: OrgUser, id: string) {
    const org = actor.organizationId;
    await this.grade(org, id);
    if (await this.jobs.exist({ where: { organizationId: org, gradeId: id } })) throw new ConflictException('المرتبة مرتبطة بوظائف');
    if (await this.db.getRepository(HrEmployee).exist({ where: { organizationId: org, gradeId: id } })) throw new ConflictException('المرتبة مرتبطة بموظفين');
    await this.grades.delete({ id, organizationId: org });
  }

  async grade(org: string, id: string) {
    const g = await this.grades.findOne({ where: { id, organizationId: org } });
    if (!g) throw new NotFoundException('المرتبة غير موجودة');
    return g;
  }

  // ---------------- الجدارات ----------------

  async listCompetencies(actor: OrgUser) {
    const rows = await this.comps.find({ where: { organizationId: actor.organizationId }, order: { kind: 'ASC', name: 'ASC' } });
    const jobs = await this.jobs.find({ where: { organizationId: actor.organizationId }, select: ['id', 'competencies'] });
    const used = new Map<string, number>();
    jobs.forEach((j) => j.competencies.forEach((c) => used.set(c.competencyId, (used.get(c.competencyId) ?? 0) + 1)));
    return rows.map((c) => ({ ...c, kindLabel: COMPETENCY_KIND_AR[c.kind], jobs: used.get(c.id) ?? 0 }));
  }

  private levels(dto: CompetencyDto) {
    const lv = [...dto.levels].sort((a, b) => a.level - b.level);
    if (new Set(lv.map((l) => l.level)).size !== lv.length) throw new BadRequestException('مستويات الجدارة مكررة');
    return lv;
  }

  async createCompetency(actor: OrgUser, dto: CompetencyDto) {
    const c = await this.comps.save(this.comps.create({ ...dto, levels: this.levels(dto), organizationId: actor.organizationId }));
    return { id: c.id };
  }

  async updateCompetency(actor: OrgUser, id: string, dto: CompetencyDto) {
    const c = await this.comps.findOne({ where: { id, organizationId: actor.organizationId } });
    if (!c) throw new NotFoundException('الجدارة غير موجودة');
    Object.assign(c, { ...dto, levels: this.levels(dto) });
    await this.comps.save(c);
    return { id };
  }

  async removeCompetency(actor: OrgUser, id: string) {
    const jobs = await this.jobs.find({ where: { organizationId: actor.organizationId }, select: ['id', 'competencies'] });
    if (jobs.some((j) => j.competencies.some((c) => c.competencyId === id))) throw new ConflictException('الجدارة مستخدمة في أوصاف وظيفية، أوقفها بدل حذفها');
    await this.comps.delete({ id, organizationId: actor.organizationId });
  }

  // ---------------- الوظائف والأوصاف الوظيفية ----------------

  async listJobs(actor: OrgUser) {
    const org = actor.organizationId;
    const [rows, units, grades, staff] = await Promise.all([
      this.jobs.find({ where: { organizationId: org }, order: { code: 'ASC' } }),
      this.units.find({ where: { organizationId: org } }),
      this.grades.find({ where: { organizationId: org } }),
      this.db.query(`SELECT job_id, COUNT(*)::int AS n FROM hr_employees WHERE organization_id = $1 AND status = 'active' GROUP BY 1`, [org]) as Promise<{ job_id: string; n: number }[]>,
    ]);
    const u = new Map(units.map((x) => [x.id, x.name]));
    const g = new Map(grades.map((x) => [x.id, x]));
    const t = new Map(rows.map((x) => [x.id, x.title]));
    const st = new Map(staff.map((s) => [s.job_id, s.n]));
    return rows.map((j) => ({
      id: j.id, code: j.code, title: j.title, unitId: j.unitId, unitName: u.get(j.unitId) ?? '', gradeId: j.gradeId,
      gradeName: j.gradeId ? `${g.get(j.gradeId)?.code ?? ''} ${g.get(j.gradeId)?.name ?? ''}`.trim() : null,
      reportsToJobId: j.reportsToJobId, reportsToTitle: j.reportsToJobId ? t.get(j.reportsToJobId) ?? null : null,
      headcount: j.headcount, filled: st.get(j.id) ?? 0, vacancies: Math.max(j.headcount - (st.get(j.id) ?? 0), 0),
      qualityCode: j.qualityCode, revision: j.revision, status: j.status, isActive: j.isActive, kpis: j.kpis.length, competencies: j.competencies.length,
    }));
  }

  async job(actor: OrgUser, id: string) {
    const j = await this.jobRow(actor.organizationId, id);
    const comps = await this.comps.find({ where: { organizationId: actor.organizationId } });
    const c = new Map(comps.map((x) => [x.id, x]));
    const unit = await this.units.findOne({ where: { id: j.unitId } });
    const grade = j.gradeId ? await this.grades.findOne({ where: { id: j.gradeId } }) : null;
    const reports = j.reportsToJobId ? await this.jobs.findOne({ where: { id: j.reportsToJobId } }) : null;
    return {
      ...j,
      unitName: unit?.name ?? '', gradeName: grade ? `${grade.code} ${grade.name}` : null, salaryRange: grade ? { min: grade.minSalary, max: grade.maxSalary } : null,
      reportsToTitle: reports?.title ?? null,
      competencies: j.competencies.map((x) => ({
        ...x, name: c.get(x.competencyId)?.name ?? 'جدارة محذوفة', kind: c.get(x.competencyId)?.kind ?? null,
        kindLabel: c.get(x.competencyId) ? COMPETENCY_KIND_AR[c.get(x.competencyId)!.kind] : '',
        levelDescription: c.get(x.competencyId)?.levels.find((l) => l.level === x.level)?.description ?? null,
      })),
    };
  }

  async jobRow(org: string, id: string) {
    const j = await this.jobs.findOne({ where: { id, organizationId: org } });
    if (!j) throw new NotFoundException('الوظيفة غير موجودة');
    return j;
  }

  private async checkJob(org: string, dto: JobDto, selfId?: string) {
    await this.core.unit(org, dto.unitId);
    if (dto.gradeId) await this.grade(org, dto.gradeId);
    if (dto.reportsToJobId) {
      if (dto.reportsToJobId === selfId) throw new BadRequestException('لا يمكن أن ترتبط الوظيفة بنفسها');
      await this.jobRow(org, dto.reportsToJobId);
    }
    const ids = dto.competencies.map((c) => c.competencyId);
    if (new Set(ids).size !== ids.length) throw new BadRequestException('جدارة مكررة في الوصف الوظيفي');
    if (ids.length && (await this.comps.count({ where: { organizationId: org, id: In(ids) } })) !== ids.length) throw new BadRequestException('جدارة غير موجودة');
    if (dto.kpis.length) {
      const total = round2(dto.kpis.reduce((s, k) => s + k.weight, 0));
      if (total !== 100) throw new BadRequestException(`مجموع أوزان مؤشرات الأداء يجب أن يكون 100% (الحالي ${total}%)`);
    }
    if (dto.qualityCode) {
      const dup = await this.jobs.findOne({ where: { organizationId: org, qualityCode: dto.qualityCode } });
      if (dup && dup.id !== selfId) throw new ConflictException(`كود الجودة ${dto.qualityCode} مستخدم في وظيفة "${dup.title}"`);
    }
  }

  async createJob(actor: OrgUser, dto: JobDto) {
    const org = actor.organizationId;
    await this.checkJob(org, dto);
    const id = await this.db.transaction(async (em) => {
      const no = await this.core.nextNo(em, org, 'nextJobNo');
      const j = await em.getRepository(HrJob).save(em.getRepository(HrJob).create({
        ...dto, organizationId: org, code: `JOB-${String(no).padStart(3, '0')}`, gradeId: dto.gradeId ?? null, reportsToJobId: dto.reportsToJobId ?? null,
        responsibilities: dto.responsibilities.map((r) => r.trim()).filter(Boolean), qualityCode: dto.qualityCode ?? `QF-HR-JD-${String(no).padStart(3, '0')}`,
      }));
      return j.id;
    });
    return { id };
  }

  /** تعديل الوصف المعتمد يعيده مسودة، ويزيد رقم الإصدار عند إعادة اعتماده */
  async updateJob(actor: OrgUser, id: string, dto: JobDto) {
    const j = await this.jobRow(actor.organizationId, id);
    await this.checkJob(actor.organizationId, dto, id);
    Object.assign(j, {
      ...dto, gradeId: dto.gradeId ?? null, reportsToJobId: dto.reportsToJobId ?? null, qualityCode: dto.qualityCode ?? j.qualityCode,
      responsibilities: dto.responsibilities.map((r) => r.trim()).filter(Boolean), status: 'draft',
    });
    await this.jobs.save(j);
    return { id };
  }

  async approveJob(actor: OrgUser, id: string) {
    const j = await this.jobRow(actor.organizationId, id);
    if (j.status === 'approved') throw new BadRequestException('الوصف الوظيفي معتمد بالفعل');
    if (!j.purpose || !j.responsibilities.length) throw new BadRequestException('أكمل هدف الوظيفة ومهامها قبل الاعتماد');
    if (!j.gradeId) throw new BadRequestException('حدد مرتبة الوظيفة في سلم الرواتب قبل الاعتماد');
    Object.assign(j, { status: 'approved', revision: j.approvedAt ? j.revision + 1 : j.revision, approvedAt: new Date(), approvedByName: actor.fullName });
    await this.jobs.save(j);
    return { id, revision: j.revision };
  }

  async removeJob(actor: OrgUser, id: string) {
    const org = actor.organizationId;
    const j = await this.jobRow(org, id);
    if (j.approvedAt) throw new ConflictException('الوصف الوظيفي اعتُمد من قبل، أوقف الوظيفة بدل حذفها');
    if (await this.db.getRepository(HrEmployee).exist({ where: { organizationId: org, jobId: id } })) throw new ConflictException('الوظيفة عليها موظفون');
    if (await this.plans.exist({ where: { organizationId: org, jobId: id } })) throw new ConflictException('الوظيفة في خطة تعيين');
    if (await this.jobs.exist({ where: { organizationId: org, reportsToJobId: id } })) throw new ConflictException('وظائف أخرى ترتبط بهذه الوظيفة');
    await this.jobs.delete({ id, organizationId: org });
  }

  // ---------------- خطط التعيين ----------------

  async listPlans(actor: OrgUser, year: number) {
    const org = actor.organizationId;
    const policy = await this.core.policy(org);
    const rows = await this.plans.find({ where: { organizationId: org, year }, order: { plannedMonth: 'ASC', createdAt: 'ASC' } });
    const jobs = await this.jobs.find({ where: { organizationId: org } });
    const grades = new Map((await this.grades.find({ where: { organizationId: org } })).map((g) => [g.id, g]));
    const units = new Map((await this.units.find({ where: { organizationId: org } })).map((u) => [u.id, u.name]));
    const jm = new Map(jobs.map((j) => [j.id, j]));
    const hired: { job_id: string; n: number }[] = await this.db.query(
      `SELECT job_id, COUNT(*)::int AS n FROM hr_employees WHERE organization_id = $1 AND EXTRACT(YEAR FROM hire_date) = $2 GROUP BY 1`, [org, year]);
    const h = new Map(hired.map((x) => [x.job_id, x.n]));
    // التعيين الفعلي يُوزَّع على بنود الخطة المعتمدة للوظيفة نفسها بالترتيب
    const remaining = new Map(h);
    const items = rows.map((p) => {
      const job = jm.get(p.jobId);
      const grade = job?.gradeId ? grades.get(job.gradeId) ?? null : null;
      const monthly = estimateMonthlyCost(policy, grade, p.forSaudi, `${year}-${String(p.plannedMonth).padStart(2, '0')}-01`);
      const months = 13 - p.plannedMonth;
      let filled = 0;
      if (p.status === 'approved') {
        const r = remaining.get(p.jobId) ?? 0;
        filled = Math.min(r, p.count);
        remaining.set(p.jobId, r - filled);
      }
      return {
        id: p.id, year: p.year, jobId: p.jobId, jobTitle: job?.title ?? '', jobCode: job?.code ?? '', unitName: job ? units.get(job.unitId) ?? '' : '',
        gradeName: grade ? `${grade.code} ${grade.name}` : null, count: p.count, plannedMonth: p.plannedMonth, fundingSource: p.fundingSource,
        fundingLabel: FUNDING_AR[p.fundingSource] ?? p.fundingSource, fundingNote: p.fundingNote, forSaudi: p.forSaudi, justification: p.justification,
        status: p.status, statusLabel: PLAN_STATUS_AR[p.status], decisionNote: p.decisionNote, decidedByName: p.decidedByName, createdByName: p.createdByName,
        monthlyCost: monthly, yearCost: round2(monthly.total * months * p.count), annualCost: round2(monthly.total * 12 * p.count), filled,
      };
    });
    const approved = items.filter((i) => i.status === 'approved');
    return {
      year, items,
      totals: {
        positions: approved.reduce((s, i) => s + i.count, 0), filled: approved.reduce((s, i) => s + i.filled, 0),
        yearCost: round2(approved.reduce((s, i) => s + i.yearCost, 0)), annualCost: round2(approved.reduce((s, i) => s + i.annualCost, 0)),
        saudi: approved.filter((i) => i.forSaudi).reduce((s, i) => s + i.count, 0),
        pending: items.filter((i) => i.status === 'submitted').length,
      },
    };
  }

  private async plan(org: string, id: string) {
    const p = await this.plans.findOne({ where: { id, organizationId: org } });
    if (!p) throw new NotFoundException('بند الخطة غير موجود');
    return p;
  }

  async createPlan(actor: OrgUser, dto: PlanDto) {
    await this.jobRow(actor.organizationId, dto.jobId);
    const p = await this.plans.save(this.plans.create({ ...dto, organizationId: actor.organizationId, createdByName: actor.fullName }));
    return { id: p.id };
  }

  async updatePlan(actor: OrgUser, id: string, dto: PlanDto) {
    const p = await this.plan(actor.organizationId, id);
    if (p.status === 'approved' || p.status === 'submitted') throw new BadRequestException('لا يمكن تعديل بند أُرسل للاعتماد أو اعتُمد');
    await this.jobRow(actor.organizationId, dto.jobId);
    Object.assign(p, dto, { status: 'draft' });
    await this.plans.save(p);
    return { id };
  }

  async submitPlan(actor: OrgUser, id: string) {
    const p = await this.plan(actor.organizationId, id);
    if (p.status !== 'draft' && p.status !== 'rejected') throw new BadRequestException('البند ليس مسودة');
    const job = await this.jobRow(actor.organizationId, p.jobId);
    if (job.status !== 'approved') throw new BadRequestException(`اعتمد الوصف الوظيفي "${job.title}" قبل إرسال خطة التعيين`);
    p.status = 'submitted';
    await this.plans.save(p);
    return { id };
  }

  async decidePlan(actor: OrgUser, id: string, dto: DecisionDto) {
    const p = await this.plan(actor.organizationId, id);
    if (p.status !== 'submitted') throw new BadRequestException('البند ليس بانتظار الاعتماد');
    if (dto.decision === 'reject' && !dto.note) throw new BadRequestException('اكتب سبب الرفض');
    Object.assign(p, { status: dto.decision === 'approve' ? 'approved' : 'rejected', decisionNote: dto.note ?? null, decidedByName: actor.fullName, decidedAt: new Date() });
    await this.plans.save(p);
    return { id };
  }

  async removePlan(actor: OrgUser, id: string) {
    const p = await this.plan(actor.organizationId, id);
    if (p.status === 'approved') throw new ConflictException('لا يمكن حذف بند معتمد');
    await this.plans.delete({ id: p.id });
  }

  /** للوحة: إجمالي الشواغر المعتمدة */
  async vacancies(org: string) {
    const [{ n }] = await this.db.query(
      `SELECT COALESCE(SUM(GREATEST(j.headcount - COALESCE(e.n,0), 0)),0)::int AS n FROM hr_jobs j
       LEFT JOIN (SELECT job_id, COUNT(*) AS n FROM hr_employees WHERE organization_id = $1 AND status = 'active' GROUP BY 1) e ON e.job_id = j.id
       WHERE j.organization_id = $1 AND j.is_active`, [org]);
    return n as number;
  }
}
