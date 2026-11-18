import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { DataSource, EntityManager, In } from 'typeorm';
import { OrgUser } from '../../core/auth/decorators';
import { FileStore } from '../../core/files/file-store.service';
import {
  HrAdvance, HrAdvanceRepayment, HrEmployee, HrJob, HrLeaveRequest, HrRequest, HrRequestType, HrUnit, RequestAttachment, RequestHistory, RequestKind,
  RequestStatus, RequestStep,
} from './entities/hr.entity';
import { HrCore, today } from './hr-core.service';
import { HR_PERMISSIONS as P } from './hr.manifest';
import { daysBetween, round2, serviceSpan } from './hr-policy';
import { PeopleService } from './people.service';
import {
  ACTION_AR, APPROVER_AR, checkEligibility, checkFields, checkStartDate, defaultRequestTypes, eligible, hoursBetween, isKind, KIND_AR, LETTER_VARS, money,
  normalizeApproval, normalizeFields, normalizePermissionKinds, normalizeRules, normalizeTemplates, renderLetter, reportingLine, REQUEST_STATUS_AR, rulesOf,
} from './self-service';

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const bad = (m: string): never => {
  throw new BadRequestException(m);
};
const str = (v: unknown, max = 500) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null);
const dateOf = (v: unknown, label: string) => (typeof v === 'string' && DATE.test(v) ? v : bad(`اختر ${label}`));
const monthAfter = (d: string) => {
  const x = new Date(`${d.slice(0, 7)}-01T00:00:00Z`);
  x.setUTCMonth(x.getUTCMonth() + 1);
  return x.toISOString().slice(0, 7);
};
const fmtAr = (d: string) => new Date(`${d}T00:00:00`).toLocaleDateString('ar-SA-u-ca-gregory', { day: 'numeric', month: 'long', year: 'numeric' });
const hijriAr = (d: string) => new Date(`${d}T00:00:00`).toLocaleDateString('ar-SA-u-ca-islamic-umalqura', { day: 'numeric', month: 'long', year: 'numeric' });

export interface RequestInput {
  typeId: string;
  data?: Record<string, unknown>;
  fields?: Record<string, unknown>;
}
export interface TypeInput {
  name: string; kind: RequestKind; category?: string; description?: string | null; color?: string; fields?: unknown; approval?: unknown; rules?: unknown;
  leaveTypes?: unknown; permissionKinds?: unknown; templates?: unknown; isActive?: boolean; sortOrder?: number;
}
type Files = Express.Multer.File[] | undefined;

/** سياق المستخدم في الخدمة الذاتية: موظفه المربوط وأدواره */
export interface Me { actor: OrgUser; employee: HrEmployee | null; roles: Set<string> }

/**
 * طلبات الموظفين (الخدمة الذاتية): أنواع الطلبات بقيودها ومسارات اعتمادها في الإعدادات، تقديم الطلب بمرفقاته،
 * مسار الاعتماد حسب التبعية الإدارية في الهيكل، وأثر الاعتماد النهائي: الإجازة تعتمد في سجل الإجازات،
 * السلفة تُسجل وتُسترد من مسير الرواتب، والخطاب يصدر برقم وتاريخ جاهزًا للطباعة.
 */
@Injectable()
export class RequestsService {
  constructor(
    private readonly db: DataSource,
    private readonly core: HrCore,
    private readonly people: PeopleService,
    private readonly files: FileStore,
  ) {}

  // ---------------- السياق ----------------

  async me(actor: OrgUser): Promise<Me> {
    const employee = await this.db.getRepository(HrEmployee).findOne({ where: { organizationId: actor.organizationId, userId: actor.id } });
    const rows: { role_id: string }[] = await this.db.query('SELECT role_id FROM user_roles WHERE user_id = $1', [actor.id]);
    return { actor, employee, roles: new Set(rows.map((r) => r.role_id)) };
  }

  async requireEmployee(actor: OrgUser) {
    const me = await this.me(actor);
    if (!me.employee) throw new ForbiddenException('حسابك غير مربوط بملف موظف. اطلب من شؤون الموظفين ربط حسابك بملفك');
    return me as Me & { employee: HrEmployee };
  }

  async line(org: string, em: EntityManager = this.db.manager) {
    const [employees, units] = await Promise.all([
      em.getRepository(HrEmployee).find({ where: { organizationId: org }, select: ['id', 'managerId', 'unitId', 'status', 'fullName', 'userId', 'jobId', 'employeeNo'] }),
      em.getRepository(HrUnit).find({ where: { organizationId: org } }),
    ]);
    return { ...reportingLine(employees, units), employees: new Map(employees.map((e) => [e.id, e])), units };
  }

  // ---------------- أنواع الطلبات ----------------

  /** أنواع الطلبات، مع إنشاء الأنواع الافتراضية للجمعية أول مرة */
  async types(org: string) {
    const repo = this.db.getRepository(HrRequestType);
    const n = await repo.count({ where: { organizationId: org } });
    if (!n) await this.addDefaults(org);
    return repo.find({ where: { organizationId: org }, order: { sortOrder: 'ASC', name: 'ASC' } });
  }

  /** يضيف الأنواع الافتراضية الناقصة (بالرمز) دون المساس بالموجود */
  async addDefaults(org: string) {
    const repo = this.db.getRepository(HrRequestType);
    const existing = new Set((await repo.find({ where: { organizationId: org }, select: ['code'] })).map((t) => t.code));
    const defs = defaultRequestTypes();
    const rows = defs.filter((d) => !existing.has(d.code)).map((d) => repo.create({
      organizationId: org, code: d.code, name: d.name, kind: d.kind, category: d.category, description: d.description, color: d.color,
      approval: d.approval, rules: d.rules, leaveTypes: d.leaveTypes ?? [], permissionKinds: d.permissionKinds ?? [], templates: d.templates ?? [],
      fields: d.fields ?? [], sortOrder: defs.indexOf(d),
    }));
    if (rows.length) await repo.createQueryBuilder().insert().values(rows).orIgnore().execute();
    return rows.length;
  }

  private typeView(t: HrRequestType, roleNames?: Map<string, string>) {
    return {
      id: t.id, code: t.code, name: t.name, kind: t.kind, kindLabel: KIND_AR[t.kind], category: t.category, description: t.description, color: t.color,
      fields: t.fields, rules: rulesOf(t.rules), leaveTypes: t.leaveTypes, permissionKinds: t.permissionKinds, isActive: t.isActive, sortOrder: t.sortOrder,
      templates: t.templates,
      approval: t.approval.map((s) => ({ ...s, kindLabel: APPROVER_AR[s.kind], roleName: s.roleId ? roleNames?.get(s.roleId) ?? null : null })),
    };
  }

  async listTypes(actor: OrgUser) {
    const org = actor.organizationId;
    const rows = await this.types(org);
    const roles: { id: string; name: string }[] = await this.db.query('SELECT id, name FROM roles WHERE organization_id = $1 ORDER BY name', [org]);
    const used: { type_id: string; n: number }[] = await this.db.query('SELECT type_id, COUNT(*)::int AS n FROM hr_requests WHERE organization_id = $1 GROUP BY type_id', [org]);
    const policy = await this.core.policy(org);
    const settings = await this.core.settings(org);
    const roleNames = new Map(roles.map((r) => [r.id, r.name]));
    return {
      types: rows.map((t) => ({ ...this.typeView(t, roleNames), requests: used.find((u) => u.type_id === t.id)?.n ?? 0 })),
      lookups: {
        roles, leaveTypes: policy.leaveTypes.map((l) => ({ code: l.code, name: l.name })), structureLevels: settings.structureLevels,
        approverKinds: Object.entries(APPROVER_AR).map(([value, label]) => ({ value, label })),
        kinds: Object.entries(KIND_AR).map(([value, label]) => ({ value, label })), letterVars: LETTER_VARS,
      },
    };
  }

  private async cleanType(org: string, dto: TypeInput) {
    const name = str(dto.name, 150) ?? bad('اكتب اسم نوع الطلب');
    if (!isKind(dto.kind)) bad('اختر سلوك الطلب');
    const approval = normalizeApproval(dto.approval);
    if (!approval.length) bad('أضف خطوة اعتماد واحدة على الأقل');
    const roleIds = approval.map((s) => s.roleId).filter(Boolean) as string[];
    if (roleIds.length) {
      const [{ n }] = await this.db.query('SELECT COUNT(*)::int AS n FROM roles WHERE organization_id = $1 AND id = ANY($2)', [org, [...new Set(roleIds)]]);
      if (n !== new Set(roleIds).size) bad('أحد الأدوار في مسار الاعتماد غير موجود');
    }
    const out = {
      name, kind: dto.kind, category: str(dto.category, 60) ?? 'أخرى', description: str(dto.description, 500),
      color: typeof dto.color === 'string' && /^#[0-9a-fA-F]{6}$/.test(dto.color) ? dto.color : '#6366f1',
      fields: normalizeFields(dto.fields), approval, rules: normalizeRules(dto.rules),
      leaveTypes: [] as string[], permissionKinds: normalizePermissionKinds(dto.permissionKinds), templates: normalizeTemplates(dto.templates),
      isActive: dto.isActive !== false, sortOrder: Number.isInteger(dto.sortOrder) ? Number(dto.sortOrder) : 0,
    };
    if (dto.kind === 'leave') {
      const policy = await this.core.policy(org);
      const codes = Array.isArray(dto.leaveTypes) ? (dto.leaveTypes as unknown[]).map(String) : [];
      out.leaveTypes = codes.filter((c) => policy.leaveTypes.some((l) => l.code === c));
      if (!out.leaveTypes.length) bad('اختر نوع إجازة واحدًا على الأقل من اللائحة');
    }
    if (dto.kind === 'permission' && !out.permissionKinds.length) bad('أضف نوع استئذان واحدًا على الأقل');
    if (dto.kind === 'letter' && !out.templates.length) bad('أضف نموذج خطاب واحدًا على الأقل');
    if (dto.kind === 'general' && !out.fields.length) bad('أضف حقلًا واحدًا على الأقل للطلب العام');
    return out;
  }

  async createType(actor: OrgUser, dto: TypeInput) {
    const org = actor.organizationId;
    const clean = await this.cleanType(org, dto);
    const repo = this.db.getRepository(HrRequestType);
    const code = `t${Date.now().toString(36)}${randomUUID().slice(0, 4)}`;
    const t = await repo.save(repo.create({ organizationId: org, code, ...clean }));
    return this.typeView(t);
  }

  async updateType(actor: OrgUser, id: string, dto: TypeInput) {
    const org = actor.organizationId;
    const repo = this.db.getRepository(HrRequestType);
    const t = await repo.findOne({ where: { id, organizationId: org } });
    if (!t) throw new NotFoundException('نوع الطلب غير موجود');
    if (dto.kind !== t.kind) {
      const [{ n }] = await this.db.query('SELECT COUNT(*)::int AS n FROM hr_requests WHERE type_id = $1', [id]);
      if (n) bad('لا يتغير سلوك نوع عليه طلبات، أنشئ نوعًا جديدًا');
    }
    Object.assign(t, await this.cleanType(org, dto));
    return this.typeView(await repo.save(t));
  }

  async removeType(actor: OrgUser, id: string) {
    const repo = this.db.getRepository(HrRequestType);
    const t = await repo.findOne({ where: { id, organizationId: actor.organizationId } });
    if (!t) throw new NotFoundException('نوع الطلب غير موجود');
    const [{ n }] = await this.db.query('SELECT COUNT(*)::int AS n FROM hr_requests WHERE type_id = $1', [id]);
    if (n) throw new ConflictException('على هذا النوع طلبات سابقة، أوقفه بدلًا من حذفه');
    await repo.delete({ id });
  }

  /** الأنواع التي يستطيع الموظف تقديمها (المفعلة والمستوفي شروطها) */
  async availableTypes(org: string, e: HrEmployee) {
    const t = today();
    const policy = await this.core.policy(org);
    return (await this.types(org)).filter((x) => x.isActive && eligible(rulesOf(x.rules), e, t)).map((x) => ({
      ...this.typeView(x),
      leaveOptions: x.kind === 'leave'
        ? policy.leaveTypes.filter((l) => x.leaveTypes.includes(l.code) && (!l.gender || l.gender === e.gender)).map((l) => ({ code: l.code, name: l.name, note: l.note }))
        : [],
      templates: x.templates.map((tp) => ({ id: tp.id, name: tp.name, withSalary: tp.withSalary })),
    }));
  }

  // ---------------- تقديم الطلب ----------------

  /** يتحقق من بيانات الطلب حسب سلوكه وقيوده، ويعيد البيانات النظيفة والملخص */
  private async prepare(org: string, type: HrRequestType, e: HrEmployee, input: RequestInput, selfId: string | null) {
    const t = today();
    const rules = rulesOf(type.rules);
    checkEligibility(rules, e, t, type.name);
    const d = input.data ?? {};
    const extra = checkFields(type.fields, input.fields);
    let data: Record<string, unknown> = {};
    let summary = type.name;
    let startDate: string | null = null;
    const policy = await this.core.policy(org);

    if (type.kind === 'leave') {
      const code = String(d.leaveType ?? '');
      if (!type.leaveTypes.includes(code)) bad('اختر نوع الإجازة');
      const rule = policy.leaveTypes.find((l) => l.code === code) ?? bad('نوع الإجازة غير موجود في اللائحة');
      const start = dateOf(d.startDate, 'تاريخ بداية الإجازة');
      const end = dateOf(d.endDate, 'تاريخ نهاية الإجازة');
      if (end < start) bad('نهاية الإجازة قبل بدايتها');
      checkStartDate(rules, start, t, 'تاريخ بداية الإجازة');
      const days = daysBetween(start, end) + 1;
      data = { leaveType: code, leaveTypeName: rule.name, startDate: start, endDate: end, days, note: str(d.note, 1000) };
      summary = `${rule.name} ${days} ${days > 10 ? 'يومًا' : 'أيام'} من ${start}`;
      startDate = start;
    } else if (type.kind === 'permission') {
      const k = type.permissionKinds.find((x) => x.code === d.permissionKind) ?? bad('اختر نوع الاستئذان');
      const date = dateOf(d.date, 'تاريخ الاستئذان');
      checkStartDate(rules, date, t, 'تاريخ الاستئذان');
      const fromTime = String(d.fromTime ?? '');
      const toTime = String(d.toTime ?? '');
      const hours = hoursBetween(fromTime, toTime);
      if (k.maxHours && hours > k.maxHours) bad(`${k.name} ${k.maxHours} ساعة على الأكثر في المرة`);
      if (rules.maxHoursPerMonth) {
        const [{ h }] = await this.db.query(
          `SELECT COALESCE(SUM((data->>'hours')::numeric), 0)::float AS h FROM hr_requests WHERE organization_id = $1 AND employee_id = $2 AND type_id = $3
            AND status IN ('pending', 'approved', 'returned') AND to_char(start_date, 'YYYY-MM') = $4 AND id <> COALESCE($5::uuid, '00000000-0000-0000-0000-000000000000')`,
          [org, e.id, type.id, date.slice(0, 7), selfId],
        );
        if (h + hours > rules.maxHoursPerMonth) bad(`رصيد الاستئذان الشهري ${rules.maxHoursPerMonth} ساعات، استُخدم منه ${round2(h)} ساعة`);
      }
      data = { permissionKind: k.code, permissionKindName: k.name, date, fromTime, toTime, hours, note: str(d.note, 1000) };
      summary = `${k.name} ${hours} ساعة يوم ${date}`;
      startDate = date;
    } else if (type.kind === 'exit_reentry') {
      const travel = dateOf(d.travelDate, 'تاريخ السفر');
      const back = dateOf(d.returnDate, 'تاريخ العودة');
      if (back <= travel) bad('تاريخ العودة يجب أن يكون بعد تاريخ السفر');
      checkStartDate(rules, travel, t, 'تاريخ السفر');
      const visaType = d.visaType === 'multiple' ? 'multiple' : 'single';
      const dependents = Number(d.dependents ?? 0);
      if (!Number.isInteger(dependents) || dependents < 0 || dependents > 20) bad('عدد المرافقين غير صحيح');
      data = {
        visaType, visaTypeName: visaType === 'multiple' ? 'متعددة' : 'مفردة', travelDate: travel, returnDate: back, days: daysBetween(travel, back),
        destination: str(d.destination, 100) ?? bad('اكتب جهة السفر'), dependents, note: str(d.note, 1000),
      };
      summary = `خروج وعودة ${data.visaTypeName} إلى ${data.destination} من ${travel} إلى ${back}`;
      startDate = travel;
    } else if (type.kind === 'letter') {
      const tp = type.templates.find((x) => x.id === d.templateId) ?? bad('اختر نموذج الخطاب');
      data = { templateId: tp.id, templateName: tp.name, addressee: str(d.addressee, 200) ?? 'إلى من يهمه الأمر', note: str(d.note, 1000) };
      summary = `${tp.name}${d.addressee ? ` إلى ${String(data.addressee)}` : ''}`;
    } else if (type.kind === 'advance') {
      const amount = round2(Number(d.amount));
      if (!Number.isFinite(amount) || amount <= 0) bad('اكتب مبلغ السلفة');
      const installments = Number(d.installments);
      if (!Number.isInteger(installments) || installments < 1) bad('اختر عدد الأقساط');
      if (rules.maxInstallments && installments > rules.maxInstallments) bad(`أقصى عدد للأقساط ${rules.maxInstallments}`);
      const gross = round2(e.basicSalary + e.allowances.reduce((s, a) => s + a.amount, 0));
      if (rules.maxSalaryMultiple && amount > round2(gross * rules.maxSalaryMultiple)) {
        bad(`الحد الأعلى للسلفة ${money(round2(gross * rules.maxSalaryMultiple))} (${rules.maxSalaryMultiple} من إجمالي الراتب)`);
      }
      if (rules.oneOpen) {
        const open = await this.advanceBalances(org, [e.id]);
        if ((open.get(e.id)?.remaining ?? 0) > 0) bad('لديك سلفة لم تُسدد بالكامل، ولا تُقدم سلفة جديدة قبل سدادها');
      }
      data = { amount, installments, installmentAmount: round2(amount / installments), reason: str(d.reason, 500) ?? bad('اكتب سبب السلفة') };
      summary = `سلفة ${money(amount)} على ${installments} ${installments > 10 ? 'قسطًا' : 'أقساط'}`;
    } else if (type.kind === 'resignation') {
      const last = dateOf(d.lastWorkingDay, 'آخر يوم عمل');
      checkStartDate(rules, last, t, 'آخر يوم عمل');
      if (last < e.hireDate) bad('آخر يوم عمل قبل تاريخ المباشرة');
      const [{ n }] = await this.db.query(
        `SELECT COUNT(*)::int AS n FROM hr_separations WHERE organization_id = $1 AND employee_id = $2 AND status <> 'cancelled'`, [org, e.id],
      );
      if (n) bad('لديك ملف إنهاء خدمة مفتوح لدى شؤون الموظفين');
      data = { lastWorkingDay: last, noticeDays: daysBetween(t, last), reason: str(d.reason, 1000) ?? bad('اكتب سبب الاستقالة') };
      summary = `استقالة، آخر يوم عمل ${last}`;
      startDate = last;
    } else {
      const firstText = type.fields.find((f) => f.type === 'text' && extra[f.key]);
      if (firstText) summary = `${type.name}: ${String(extra[firstText.key]).slice(0, 120)}`;
      const firstDate = type.fields.find((f) => f.type === 'date' && extra[f.key]);
      if (firstDate) {
        startDate = String(extra[firstDate.key]);
        checkStartDate(rules, startDate, t, `«${firstDate.label}»`);
      }
    }

    // الحدود العددية وعدم تكرار الطلب المفتوح
    const exclude = selfId ?? '00000000-0000-0000-0000-000000000000';
    if (rules.oneOpen) {
      const [{ n }] = await this.db.query(
        `SELECT COUNT(*)::int AS n FROM hr_requests WHERE organization_id = $1 AND employee_id = $2 AND type_id = $3 AND status IN ('pending', 'returned') AND id <> $4`,
        [org, e.id, type.id, exclude],
      );
      if (n) bad(`لديك ${type.name} قيد الاعتماد، انتظر القرار فيه أو ألغه أولًا`);
    }
    const ref = startDate ?? t;
    if (rules.maxPerMonth) {
      const [{ n }] = await this.db.query(
        `SELECT COUNT(*)::int AS n FROM hr_requests WHERE organization_id = $1 AND employee_id = $2 AND type_id = $3 AND status IN ('pending', 'returned', 'approved')
          AND to_char(COALESCE(start_date, (created_at AT TIME ZONE 'Asia/Riyadh')::date), 'YYYY-MM') = $4 AND id <> $5`,
        [org, e.id, type.id, ref.slice(0, 7), exclude],
      );
      if (n >= rules.maxPerMonth) bad(`الحد الشهري من ${type.name} ${rules.maxPerMonth} ${rules.maxPerMonth > 2 ? 'طلبات' : 'طلب'}`);
    }
    if (rules.maxPerYear) {
      const [{ n }] = await this.db.query(
        `SELECT COUNT(*)::int AS n FROM hr_requests WHERE organization_id = $1 AND employee_id = $2 AND type_id = $3 AND status IN ('pending', 'returned', 'approved')
          AND to_char(COALESCE(start_date, (created_at AT TIME ZONE 'Asia/Riyadh')::date), 'YYYY') = $4 AND id <> $5`,
        [org, e.id, type.id, ref.slice(0, 4), exclude],
      );
      if (n >= rules.maxPerYear) bad(`الحد السنوي من ${type.name} ${rules.maxPerYear}`);
    }
    return { data: { ...data, extra }, summary: summary.slice(0, 300), startDate, rules };
  }

  /** يحوّل مسار الاعتماد المعرّف إلى خطوات بأسماء المعتمدين حسب موقع الموظف في الهيكل */
  async resolveSteps(org: string, type: HrRequestType, e: HrEmployee, em: EntityManager = this.db.manager): Promise<RequestStep[]> {
    const line = await this.line(org, em);
    const name = (id: string | null) => (id ? line.employees.get(id)?.fullName ?? null : null);
    const used = new Set<string>();
    const steps: RequestStep[] = type.approval.map((s) => {
      const base: RequestStep = { kind: s.kind, name: s.name, roleId: s.roleId ?? null, approverEmployeeId: null, approverName: null, status: 'waiting', actorName: null, onBehalf: false, note: null, at: null };
      if (s.kind === 'role' || s.kind === 'hr') return base;
      let target: string | null = null;
      if (s.kind === 'direct_manager') target = line.managerOf(e.id);
      else if (s.kind === 'second_manager') target = line.managerOf(e.id) ? line.managerOf(line.managerOf(e.id)!) : null;
      else if (s.kind === 'unit_head') target = line.unitHead(e, s.level ?? 0);
      else target = line.top();
      if (!target) return { ...base, status: 'skipped', note: 'لا يوجد مدير معرّف لهذه الخطوة في الهيكل' };
      if (target === e.id) return { ...base, approverEmployeeId: target, approverName: name(target), status: 'skipped', note: 'صاحب الطلب نفسه' };
      if (used.has(target)) return { ...base, approverEmployeeId: target, approverName: name(target), status: 'skipped', note: 'اعتمد في خطوة سابقة' };
      used.add(target);
      return { ...base, approverEmployeeId: target, approverName: name(target) };
    });
    if (!steps.some((s) => s.status === 'waiting')) {
      steps.push({ kind: 'hr', name: APPROVER_AR.hr, roleId: null, approverEmployeeId: null, approverName: null, status: 'waiting', actorName: null, onBehalf: false, note: 'أضيفت تلقائيًا لعدم وجود معتمد في الهيكل', at: null });
    }
    return steps;
  }

  private hist(actor: OrgUser, action: string, note: string | null = null): RequestHistory {
    return { action, note, actorName: actor.fullName, at: new Date().toISOString() };
  }

  private async saveFiles(org: string, actor: OrgUser, files: Files): Promise<RequestAttachment[]> {
    const out: RequestAttachment[] = [];
    for (const f of files ?? []) {
      const saved = await this.files.save(`hr-requests/${org}`, f, 'المرفق');
      out.push({ id: randomUUID(), key: saved.key, name: saved.name, mime: saved.mime, size: f.size, uploadedByName: actor.fullName, at: new Date().toISOString() });
    }
    return out;
  }

  /** ينشئ سجل الإجازة المرتبط (بانتظار الاعتماد) بعد التحقق من الرصيد والتداخل */
  private async createLeave(actor: OrgUser, e: HrEmployee, data: Record<string, unknown>, requestId: string) {
    const l = await this.people.requestLeave(actor, {
      employeeId: e.id, leaveType: String(data.leaveType), startDate: String(data.startDate), endDate: String(data.endDate), note: (data.note as string | null) ?? null,
    });
    await this.db.getRepository(HrLeaveRequest).update({ id: l.id }, { requestId });
    return l.id;
  }

  async submit(actor: OrgUser, input: RequestInput, files: Files) {
    const me = await this.requireEmployee(actor);
    const e = me.employee;
    if (e.status !== 'active') bad('خدمتك منتهية');
    const org = actor.organizationId;
    const type = await this.db.getRepository(HrRequestType).findOne({ where: { id: input.typeId, organizationId: org } });
    if (!type || !type.isActive) bad('نوع الطلب غير متاح');
    const t = type as HrRequestType;
    const p = await this.prepare(org, t, e, input, null);
    if (p.rules.attachment === 'required' && !files?.length) bad(`أرفق ${p.rules.attachmentHint ?? 'المستند المطلوب'}`);
    if (p.rules.attachment === 'none' && files?.length) bad('هذا الطلب لا يحتاج مرفقات');
    const attachments = await this.saveFiles(org, actor, files);
    let leaveId: string | null = null;
    const id = randomUUID();
    try {
      if (t.kind === 'leave') leaveId = await this.createLeave(actor, e, p.data, id);
      await this.db.transaction(async (em) => {
        await em.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`hr_requests:${org}`]);
        const [{ n }] = await em.query('SELECT COALESCE(MAX(request_no), 0)::int + 1 AS n FROM hr_requests WHERE organization_id = $1', [org]);
        const steps = await this.resolveSteps(org, t, e, em);
        await em.getRepository(HrRequest).insert({
          id, organizationId: org, requestNo: n, typeId: t.id, kind: t.kind, typeName: t.name, employeeId: e.id, data: p.data, summary: p.summary,
          startDate: p.startDate, status: 'pending', steps, stepIndex: steps.findIndex((s) => s.status === 'waiting'), attachments, leaveId,
          history: [this.hist(actor, 'submit')], createdByName: actor.fullName,
        });
      });
    } catch (err) {
      if (leaveId) await this.db.getRepository(HrLeaveRequest).delete({ id: leaveId });
      for (const a of attachments) await this.files.remove(a.key);
      throw err;
    }
    return this.view(actor, id);
  }

  /** تعديل الطلب المعاد وإعادة تقديمه: يُعاد التحقق ويبدأ مسار الاعتماد من جديد */
  async resubmit(actor: OrgUser, id: string, input: RequestInput, files: Files) {
    const me = await this.requireEmployee(actor);
    const org = actor.organizationId;
    const r = await this.find(org, id);
    if (r.employeeId !== me.employee.id) throw new ForbiddenException('هذا الطلب ليس لك');
    if (r.status !== 'returned') bad('لا يُعدَّل إلا الطلب المعاد للتعديل');
    const type = await this.db.getRepository(HrRequestType).findOneOrFail({ where: { id: r.typeId } });
    const p = await this.prepare(org, type, me.employee, { ...input, typeId: type.id }, r.id);
    const added = await this.saveFiles(org, actor, files);
    const attachments = [...r.attachments, ...added];
    if (p.rules.attachment === 'required' && !attachments.length) bad(`أرفق ${p.rules.attachmentHint ?? 'المستند المطلوب'}`);
    let leaveId: string | null = null;
    try {
      if (type.kind === 'leave') leaveId = await this.createLeave(actor, me.employee, p.data, r.id);
      const steps = await this.resolveSteps(org, type, me.employee);
      await this.db.getRepository(HrRequest).update({ id }, {
        data: p.data, summary: p.summary, startDate: p.startDate, status: 'pending', steps, stepIndex: steps.findIndex((s) => s.status === 'waiting'),
        attachments, leaveId, history: [...r.history, this.hist(actor, 'resubmit', str(input.data?.resubmitNote, 500))],
      });
    } catch (err) {
      if (leaveId) await this.db.getRepository(HrLeaveRequest).delete({ id: leaveId });
      for (const a of added) await this.files.remove(a.key);
      throw err;
    }
    return this.view(actor, id);
  }

  async cancel(actor: OrgUser, id: string) {
    const me = await this.requireEmployee(actor);
    const r = await this.find(actor.organizationId, id);
    if (r.employeeId !== me.employee.id) throw new ForbiddenException('هذا الطلب ليس لك');
    if (r.status !== 'pending' && r.status !== 'returned') bad('لا يُلغى إلا الطلب قيد الاعتماد أو المعاد');
    await this.db.transaction(async (em) => {
      await this.syncLeave(em, r, 'cancelled', actor.fullName, null);
      await em.getRepository(HrRequest).update({ id }, { status: 'cancelled', stepIndex: null, decidedAt: new Date(), history: [...r.history, this.hist(actor, 'cancel')] });
    });
    return this.view(actor, id);
  }

  async addAttachments(actor: OrgUser, id: string, files: Files) {
    const r = await this.find(actor.organizationId, id);
    const me = await this.me(actor);
    const owner = me.employee?.id === r.employeeId;
    const step = r.stepIndex !== null ? r.steps[r.stepIndex] : undefined;
    const approver = r.status === 'pending' && step ? this.canAct(me, step).ok : false;
    if (!(owner && ['pending', 'returned'].includes(r.status)) && !approver) throw new ForbiddenException('لا يمكنك إرفاق ملفات بهذا الطلب الآن');
    if (!files?.length) bad('اختر ملفًا');
    if (r.attachments.length + (files?.length ?? 0) > 10) bad('الحد 10 مرفقات للطلب');
    const added = await this.saveFiles(actor.organizationId, actor, files);
    await this.db.getRepository(HrRequest).update({ id }, { attachments: [...r.attachments, ...added], history: [...r.history, this.hist(actor, 'attach', added.map((a) => a.name).join('، '))] });
    return this.view(actor, id);
  }

  async attachment(actor: OrgUser, id: string, attId: string) {
    const r = await this.find(actor.organizationId, id);
    await this.assertVisible(actor, r);
    const a = r.attachments.find((x) => x.id === attId);
    if (!a) throw new NotFoundException('المرفق غير موجود');
    return { doc: { mimeType: a.mime, fileName: a.name }, stream: this.files.open(a.key) };
  }

  // ---------------- الاعتماد ----------------

  /** من يتخذ القرار في الخطوة: المدير المعني بنفسه، أو حامل الدور، أو شؤون الموظفين، ومدير النظام بالنيابة */
  canAct(me: Me, step: RequestStep): { ok: boolean; onBehalf: boolean } {
    const a = me.actor;
    const hr = a.isSuperadmin || a.permissions.includes(P.approveRequests);
    let ok = false;
    if (step.kind === 'hr') ok = hr;
    else if (step.kind === 'role') ok = !!step.roleId && me.roles.has(step.roleId);
    else ok = !!me.employee && me.employee.id === step.approverEmployeeId;
    if (ok) return { ok, onBehalf: false };
    if (a.isSuperadmin) return { ok: true, onBehalf: true };
    return { ok: false, onBehalf: false };
  }

  async decide(actor: OrgUser, id: string, decision: 'approve' | 'return' | 'reject', note: string | null) {
    const org = actor.organizationId;
    const me = await this.me(actor);
    await this.db.transaction(async (em) => {
      const r = await em.getRepository(HrRequest).createQueryBuilder('r').setLock('pessimistic_write').where('r.id = :id AND r.organization_id = :org', { id, org }).getOne();
      if (!r) throw new NotFoundException('الطلب غير موجود');
      if (r.status !== 'pending' || r.stepIndex === null) throw new ConflictException('الطلب لا ينتظر قرارًا');
      const step = r.steps[r.stepIndex];
      const can = this.canAct(me, step);
      if (!can.ok) throw new ForbiddenException('القرار في هذه الخطوة ليس من صلاحيتك');
      if (me.employee?.id === r.employeeId && !actor.isSuperadmin) throw new ForbiddenException('لا تعتمد طلبك بنفسك');
      if ((decision === 'return' || decision === 'reject') && !note) bad(decision === 'return' ? 'اكتب المطلوب تعديله' : 'اكتب سبب الرفض');
      const steps = r.steps.map((s, i) => (i === r.stepIndex
        ? { ...s, status: decision === 'approve' ? 'approved' as const : decision === 'return' ? 'returned' as const : 'rejected' as const, actorName: actor.fullName, onBehalf: can.onBehalf, note, at: new Date().toISOString() }
        : s));
      const history = [...r.history, this.hist(actor, decision, note)];
      const repo = em.getRepository(HrRequest);
      if (decision === 'reject') {
        await this.syncLeave(em, r, 'rejected', actor.fullName, note);
        await repo.update({ id }, { status: 'rejected', steps, stepIndex: null, decidedAt: new Date(), history });
        return;
      }
      if (decision === 'return') {
        await this.syncLeave(em, r, 'cancelled', actor.fullName, 'أعيد الطلب للتعديل');
        await repo.update({ id }, { status: 'returned', steps, stepIndex: null, leaveId: null, history });
        return;
      }
      const next = steps.findIndex((s, i) => i > r.stepIndex! && s.status === 'waiting');
      if (next >= 0) {
        await repo.update({ id }, { steps, stepIndex: next, history });
        return;
      }
      const result = await this.finalize(em, actor, r);
      await this.syncLeave(em, r, 'approved', actor.fullName, note);
      await repo.update({ id }, { status: 'approved', steps, stepIndex: null, decidedAt: new Date(), result: result as never, history: [...history, this.hist(actor, 'final')] });
    });
    return this.view(actor, id);
  }

  /** حالة سجل الإجازة المرتبط تتبع قرار الطلب */
  private async syncLeave(em: EntityManager, r: HrRequest, status: 'approved' | 'rejected' | 'cancelled', by: string, note: string | null) {
    if (!r.leaveId) return;
    await em.getRepository(HrLeaveRequest).update({ id: r.leaveId, status: 'pending' }, { status, decidedByName: by, decidedAt: new Date(), decisionNote: note });
  }

  /** أثر الاعتماد النهائي حسب نوع الطلب */
  private async finalize(em: EntityManager, actor: OrgUser, r: HrRequest): Promise<Record<string, unknown> | null> {
    const org = actor.organizationId;
    const t = today();
    if (r.kind === 'advance') {
      const d = r.data as { amount: number; installments: number; installmentAmount: number; reason: string };
      const a = await em.getRepository(HrAdvance).save(em.getRepository(HrAdvance).create({
        organizationId: org, employeeId: r.employeeId, requestId: r.id, amount: d.amount, installments: d.installments,
        installmentAmount: d.installmentAmount, startMonth: monthAfter(t), reason: d.reason,
      }));
      return { advanceId: a.id, startMonth: a.startMonth };
    }
    if (r.kind === 'letter') {
      const type = await em.getRepository(HrRequestType).findOne({ where: { id: r.typeId } });
      const tp = type?.templates.find((x) => x.id === r.data.templateId);
      if (!tp) bad('نموذج الخطاب لم يعد موجودًا في الإعدادات');
      const e = await em.getRepository(HrEmployee).findOneOrFail({ where: { id: r.employeeId } });
      const [job, unit] = await Promise.all([
        em.getRepository(HrJob).findOne({ where: { id: e.jobId } }), em.getRepository(HrUnit).findOne({ where: { id: e.unitId } }),
      ]);
      const [org1] = await em.query('SELECT name FROM organizations WHERE id = $1', [org]);
      const gross = round2(e.basicSalary + e.allowances.reduce((s, x) => s + x.amount, 0));
      const span = serviceSpan(e.hireDate, t);
      const letterNo = `${t.slice(0, 4)}/${String(r.requestNo).padStart(4, '0')}`;
      const vars: Record<string, string> = {
        اسم_الموظف: e.fullName, رقم_الهوية: e.nationalId, الجنسية: e.nationality, الرقم_الوظيفي: String(e.employeeNo), المسمى_الوظيفي: job?.title ?? '',
        الإدارة: unit?.name ?? '', تاريخ_المباشرة: fmtAr(e.hireDate), مدة_الخدمة: `${span.years} سنة و${span.months} شهر`,
        الراتب_الأساسي: money(e.basicSalary), البدلات: e.allowances.map((a) => `${a.name}: ${money(a.amount)}`).join('\n'), إجمالي_الراتب: money(gross),
        الجهة: String(r.data.addressee ?? 'إلى من يهمه الأمر'), اسم_الجمعية: org1?.name ?? actor.organizationName ?? '', التاريخ: fmtAr(t), التاريخ_الهجري: hijriAr(t),
        رقم_الخطاب: letterNo,
      };
      return { letterNo, date: t, templateName: tp!.name, body: renderLetter(tp!.body, vars), organizationName: vars.اسم_الجمعية, signedBy: actor.fullName };
    }
    if (r.kind === 'resignation' && this.resignationHook) return this.resignationHook(em, actor, r);
    return null;
  }

  /** يُسجله ملف إنهاء الخدمة: اعتماد الاستقالة يفتح ملف إخلاء الطرف (بلا اعتماد دائري بين الخدمتين) */
  private resignationHook: ((em: EntityManager, actor: OrgUser, r: HrRequest) => Promise<Record<string, unknown>>) | null = null;
  onResignationApproved(fn: (em: EntityManager, actor: OrgUser, r: HrRequest) => Promise<Record<string, unknown>>) {
    this.resignationHook = fn;
  }

  // ---------------- القراءة ----------------

  async find(org: string, id: string) {
    const r = await this.db.getRepository(HrRequest).findOne({ where: { id, organizationId: org } });
    if (!r) throw new NotFoundException('الطلب غير موجود');
    return r;
  }

  /** صاحب الطلب، أو أحد مديريه في التسلسل، أو من له دور في مساره، أو شؤون الموظفين */
  private async access(actor: OrgUser, r: HrRequest) {
    const me = await this.me(actor);
    const owner = me.employee?.id === r.employeeId;
    const hr = actor.isSuperadmin || actor.permissions.includes(P.requests) || actor.permissions.includes(P.approveRequests);
    let manager = false;
    if (me.employee && !owner) manager = (await this.line(actor.organizationId)).chain(r.employeeId).includes(me.employee.id);
    const inPath = r.steps.some((s) => (s.approverEmployeeId && s.approverEmployeeId === me.employee?.id) || (s.roleId && me.roles.has(s.roleId)));
    return { me, owner, hr, manager, inPath, visible: owner || hr || manager || inPath };
  }

  private async assertVisible(actor: OrgUser, r: HrRequest) {
    const a = await this.access(actor, r);
    if (!a.visible) throw new ForbiddenException('ليس لديك صلاحية على هذا الطلب');
    return a;
  }

  async view(actor: OrgUser, id: string) {
    const org = actor.organizationId;
    const r = await this.find(org, id);
    const a = await this.assertVisible(actor, r);
    const e = await this.db.getRepository(HrEmployee).findOne({ where: { id: r.employeeId } });
    const [job, unit] = e ? await Promise.all([
      this.db.getRepository(HrJob).findOne({ where: { id: e.jobId }, select: ['id', 'title'] }), this.db.getRepository(HrUnit).findOne({ where: { id: e.unitId }, select: ['id', 'name'] }),
    ]) : [null, null];
    const type = await this.db.getRepository(HrRequestType).findOne({ where: { id: r.typeId } });
    const roleIds = r.steps.map((s) => s.roleId).filter(Boolean) as string[];
    const roles: { id: string; name: string }[] = roleIds.length ? await this.db.query('SELECT id, name FROM roles WHERE id = ANY($1)', [roleIds]) : [];
    const step = r.stepIndex !== null ? r.steps[r.stepIndex] : undefined;
    const can = step && r.status === 'pending' ? this.canAct(a.me, step) : { ok: false, onBehalf: false };
    const self = a.me.employee?.id === r.employeeId;
    let balance: unknown = null;
    if (r.kind === 'leave' && e && (a.owner || a.hr || a.manager || a.inPath)) {
      const bals = await this.people.balances(org, e, await this.core.policy(org), today());
      balance = bals.find((b) => b.code === r.data.leaveType) ?? null;
    }
    let advance: unknown = null;
    if (r.kind === 'advance' && r.result?.advanceId) {
      const adv = (await this.advances(org, { requestId: r.id }))[0];
      advance = adv ?? null;
    }
    return {
      id: r.id, requestNo: r.requestNo, kind: r.kind, kindLabel: KIND_AR[r.kind], typeId: r.typeId, typeName: r.typeName, color: type?.color ?? '#6366f1',
      status: r.status, statusLabel: REQUEST_STATUS_AR[r.status], summary: r.summary, data: r.data, startDate: r.startDate,
      fields: type?.fields ?? [], rules: type ? rulesOf(type.rules) : null,
      employee: e ? { id: e.id, employeeNo: e.employeeNo, fullName: e.fullName, jobTitle: job?.title ?? '', unitName: unit?.name ?? '' } : null,
      steps: r.steps.map((s, i) => ({ ...s, current: i === r.stepIndex, kindLabel: APPROVER_AR[s.kind], roleName: roles.find((x) => x.id === s.roleId)?.name ?? null })),
      currentStep: step ? step.name : null,
      attachments: r.attachments.map(({ key: _k, ...x }) => x),
      history: r.history.map((h) => ({ ...h, label: ACTION_AR[h.action] ?? h.action })),
      result: r.result, balance, advance,
      createdByName: r.createdByName, createdAt: r.createdAt, decidedAt: r.decidedAt,
      can: {
        decide: can.ok && (!self || actor.isSuperadmin), onBehalf: can.onBehalf,
        cancel: self && ['pending', 'returned'].includes(r.status),
        edit: self && r.status === 'returned',
        attach: (self && ['pending', 'returned'].includes(r.status)) || (can.ok && r.status === 'pending'),
        print: r.kind === 'letter' && r.status === 'approved',
      },
      viewer: { owner: a.owner, manager: a.manager, hr: a.hr },
    };
  }

  /** صف مختصر للقوائم */
  row(r: HrRequest, names?: Map<string, { fullName: string; employeeNo: number }>) {
    const step = r.stepIndex !== null ? r.steps[r.stepIndex] : undefined;
    return {
      id: r.id, requestNo: r.requestNo, kind: r.kind, kindLabel: KIND_AR[r.kind], typeId: r.typeId, typeName: r.typeName, summary: r.summary, startDate: r.startDate,
      status: r.status, statusLabel: REQUEST_STATUS_AR[r.status], currentStep: step?.name ?? null, currentApprover: step?.approverName ?? null,
      attachments: r.attachments.length, createdAt: r.createdAt, decidedAt: r.decidedAt, employeeId: r.employeeId,
      employeeName: names?.get(r.employeeId)?.fullName ?? null, employeeNo: names?.get(r.employeeId)?.employeeNo ?? null,
    };
  }

  async names(org: string) {
    const rows = await this.db.getRepository(HrEmployee).find({ where: { organizationId: org }, select: ['id', 'fullName', 'employeeNo'] });
    return new Map(rows.map((e) => [e.id, e]));
  }

  async mine(actor: OrgUser) {
    const me = await this.requireEmployee(actor);
    const rows = await this.db.getRepository(HrRequest).find({ where: { organizationId: actor.organizationId, employeeId: me.employee.id }, order: { createdAt: 'DESC' }, take: 300 });
    return rows.map((r) => this.row(r));
  }

  /** الطلبات التي تنتظر قرار المستخدم الآن */
  async awaiting(me: Me) {
    const rows = await this.db.getRepository(HrRequest).find({ where: { organizationId: me.actor.organizationId, status: 'pending' }, order: { createdAt: 'ASC' } });
    return rows.filter((r) => r.stepIndex !== null && r.employeeId !== me.employee?.id && this.canAct(me, r.steps[r.stepIndex]).ok && (!this.canAct(me, r.steps[r.stepIndex]).onBehalf));
  }

  async approvals(actor: OrgUser) {
    const me = await this.me(actor);
    const org = actor.organizationId;
    const names = await this.names(org);
    const waiting = await this.awaiting(me);
    const decided: HrRequest[] = await this.db.getRepository(HrRequest).createQueryBuilder('r').where('r.organization_id = :org', { org })
      .andWhere(`EXISTS (SELECT 1 FROM jsonb_array_elements(r.steps) s WHERE s->>'actorName' = :name)`, { name: actor.fullName })
      .orderBy('r.updated_at', 'DESC').take(40).getMany();
    return { waiting: waiting.map((r) => this.row(r, names)), decided: decided.map((r) => this.row(r, names)) };
  }

  /** كل الطلبات لشؤون الموظفين */
  async all(actor: OrgUser, q: { status?: string; typeId?: string; employeeId?: string }) {
    const org = actor.organizationId;
    const where: Record<string, unknown> = { organizationId: org };
    if (q.status && ['pending', 'returned', 'approved', 'rejected', 'cancelled'].includes(q.status)) where.status = q.status as RequestStatus;
    if (q.typeId && /^[0-9a-f-]{36}$/i.test(q.typeId)) where.typeId = q.typeId;
    if (q.employeeId && /^[0-9a-f-]{36}$/i.test(q.employeeId)) where.employeeId = q.employeeId;
    const rows = await this.db.getRepository(HrRequest).find({ where, order: { createdAt: 'DESC' }, take: 500 });
    const names = await this.names(org);
    const [{ pending, returned, approved, rejected }] = await this.db.query(
      `SELECT COUNT(*) FILTER (WHERE status = 'pending')::int AS pending, COUNT(*) FILTER (WHERE status = 'returned')::int AS returned,
              COUNT(*) FILTER (WHERE status = 'approved')::int AS approved, COUNT(*) FILTER (WHERE status = 'rejected')::int AS rejected
         FROM hr_requests WHERE organization_id = $1`, [org],
    );
    const types = (await this.types(org)).map((t) => ({ id: t.id, name: t.name }));
    return { counts: { pending, returned, approved, rejected }, types, rows: rows.map((r) => this.row(r, names)) };
  }

  // ---------------- السلف ----------------

  /** المسدد والمتبقي من سلف الموظفين */
  async advanceBalances(org: string, employeeIds?: string[], em: EntityManager = this.db.manager) {
    const rows: { employee_id: string; amount: number; paid: number }[] = await em.query(
      `SELECT a.employee_id, SUM(a.amount)::float AS amount, COALESCE(SUM(p.paid), 0)::float AS paid FROM hr_advances a
         LEFT JOIN (SELECT advance_id, SUM(amount) AS paid FROM hr_advance_repayments GROUP BY advance_id) p ON p.advance_id = a.id
        WHERE a.organization_id = $1 AND a.status = 'active' ${employeeIds ? 'AND a.employee_id = ANY($2)' : ''} GROUP BY a.employee_id`,
      employeeIds ? [org, employeeIds] : [org],
    );
    return new Map(rows.map((r) => [r.employee_id, { amount: round2(r.amount), paid: round2(r.paid), remaining: round2(r.amount - r.paid) }]));
  }

  async advances(org: string, q: { employeeId?: string; requestId?: string } = {}) {
    const where: Record<string, unknown> = { organizationId: org };
    if (q.employeeId) where.employeeId = q.employeeId;
    if (q.requestId) where.requestId = q.requestId;
    const rows = await this.db.getRepository(HrAdvance).find({ where, order: { createdAt: 'DESC' } });
    if (!rows.length) return [];
    const reps = await this.db.getRepository(HrAdvanceRepayment).find({ where: { advanceId: In(rows.map((r) => r.id)) }, order: { month: 'ASC' } });
    const names = await this.names(org);
    return rows.map((a) => {
      const mine = reps.filter((p) => p.advanceId === a.id);
      const paid = round2(mine.reduce((s, p) => s + p.amount, 0));
      return {
        id: a.id, employeeId: a.employeeId, employeeName: names.get(a.employeeId)?.fullName ?? '', requestId: a.requestId, amount: a.amount, installments: a.installments,
        installmentAmount: a.installmentAmount, startMonth: a.startMonth, status: a.status, reason: a.reason, createdAt: a.createdAt,
        paid, remaining: round2(a.amount - paid), paidInstallments: mine.length, repayments: mine.map((p) => ({ month: p.month, amount: p.amount })),
      };
    });
  }

  /** أقساط السلف المستحقة على الموظفين في شهر معيّن (لمسير الرواتب) */
  async dueInstallments(org: string, month: string, em: EntityManager = this.db.manager) {
    const rows: { id: string; employee_id: string; amount: number; installment: number; paid: number; start_month: string }[] = await em.query(
      `SELECT a.id, a.employee_id, a.amount::float AS amount, a.installment_amount::float AS installment, a.start_month,
              COALESCE((SELECT SUM(p.amount) FROM hr_advance_repayments p WHERE p.advance_id = a.id), 0)::float AS paid
         FROM hr_advances a WHERE a.organization_id = $1 AND a.status = 'active' AND a.start_month <= $2 ORDER BY a.created_at`, [org, month],
    );
    const due = new Map<string, { advanceId: string; amount: number }[]>();
    for (const r of rows) {
      const left = round2(r.amount - r.paid);
      if (left <= 0) continue;
      const list = due.get(r.employee_id) ?? [];
      list.push({ advanceId: r.id, amount: round2(Math.min(r.installment, left)) });
      due.set(r.employee_id, list);
    }
    return due;
  }
}
