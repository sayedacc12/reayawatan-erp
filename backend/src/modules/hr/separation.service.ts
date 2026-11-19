import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import { DataSource, EntityManager, In } from 'typeorm';
import { OrgUser } from '../../core/auth/decorators';
import { AccCore } from '../accounting/acc-core.service';
import { LineDto } from '../accounting/accounting.dto';
import { EntriesService } from '../accounting/entries.service';
import { VouchersService, VOUCHER_STATUS_AR } from '../accounting/vouchers.service';
import { AssetsService } from '../accounting/assets.service';
import {
  ClearanceItem, ClearanceItemDef, HrAdvanceRepayment, HrEmployee, HrJob, HrLeaveRequest, HrSeparation, HrSettings, HrUnit,
  SeparationConfig, SeparationHistory, Settlement, SettlementAdjustment,
} from './entities/hr.entity';
import { HrCore, today } from './hr-core.service';
import { HR_PERMISSIONS as P } from './hr.manifest';
import { endOfService, EOS_REASONS, EosReason, round2, wageFor, wageTotal } from './hr-policy';
import { partsOf } from './org.service';
import { PayrollService } from './payroll.service';
import { PeopleService } from './people.service';
import { Me, RequestsService } from './requests.service';
import { APPROVER_AR } from './self-service';

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const bad = (m: string): never => {
  throw new BadRequestException(m);
};
const str = (v: unknown, max = 500) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null);
const KINDS = ['direct_manager', 'second_manager', 'unit_head', 'top_manager', 'role', 'hr'] as const;

export const SEPARATION_STATUS_AR = {
  clearance: 'إخلاء الطرف', settlement: 'بيان المستحقات قيد الاعتماد', approved: 'معتمد بانتظار الصرف', paid: 'صُرفت المستحقات', cancelled: 'ملغي',
} as const;
const ITEM_STATUS_AR = { pending: 'بانتظار الإخلاء', cleared: 'تم الإخلاء', blocked: 'متوقف لملاحظة' } as const;
const ACTION_AR: Record<string, string> = {
  create: 'فتح ملف إنهاء الخدمة', clear: 'إخلاء بند', block: 'إيقاف بند بملاحظة', reopen: 'إعادة فتح بند', settle: 'إعداد بيان المستحقات',
  approve: 'اعتماد', return: 'إرجاع للتعديل', final: 'الاعتماد النهائي وإنهاء الخدمة', pay: 'إنشاء سند صرف المستحقات', cancel: 'إلغاء الملف',
};

/** نموذج إخلاء الطرف الافتراضي: كل بند ومسؤول إخلائه */
export function defaultClearanceItems(): ClearanceItemDef[] {
  return [
    { code: 'handover', name: 'تسليم المهام والملفات', description: 'تسليم الأعمال الجارية والملفات الورقية والإلكترونية لمن يكلفه المدير', approver: 'direct_manager', allowDeduction: false },
    { code: 'assets', name: 'العهد والأجهزة والمفاتيح', description: 'استلام الحاسب والجوال وبطاقة الدخول والمفاتيح وأي عهدة عينية', approver: 'hr', allowDeduction: true },
    { code: 'finance', name: 'الشؤون المالية', description: 'تسوية العهد النقدية والمطالبات المالية والسلف', approver: 'unit_head', level: 1, allowDeduction: true },
    { code: 'systems', name: 'إيقاف الحسابات والصلاحيات', description: 'إيقاف حساب الدخول والبريد وصلاحيات الأنظمة', approver: 'hr', allowDeduction: false },
    { code: 'exit_interview', name: 'مقابلة الخروج', description: 'مقابلة الموظف وتوثيق أسباب المغادرة ومقترحاته', approver: 'hr', allowDeduction: false },
  ];
}
const DEFAULT_CONFIG: SeparationConfig = {
  items: defaultClearanceItems(), stages: [], eosAccountId: null, leaveAccountId: null, otherAccountId: null, payableAccountId: null, cashAccountId: null, encashLeave: true,
};

export interface SeparationInput { employeeId: string; reason: string; lastWorkingDay: string; noticeDate?: string | null; note?: string | null }

/**
 * إخلاء الطرف وصرف مستحقات نهاية الخدمة:
 * ملف لكل موظف تنتهي خدمته (من شؤون الموظفين أو من اعتماد طلب الاستقالة) ← بنود إخلاء الطرف يخليها كل مسؤول حسب
 * التبعية في الهيكل أو دوره ← بيان المستحقات (المكافأة وبدل الإجازات وخصم السلف والعهد) ← مراحل اعتماد لا يعتمد فيها
 * معدّ البيان ← الاعتماد النهائي ينهي الخدمة ويقيد المستحقات في النظام المالي ← سند صرف يمر باعتمادات النظام المالي.
 */
@Injectable()
export class SeparationService implements OnModuleInit {
  constructor(
    private readonly db: DataSource,
    private readonly core: HrCore,
    private readonly people: PeopleService,
    private readonly requests: RequestsService,
    private readonly payroll: PayrollService,
    private readonly accCore: AccCore,
    private readonly entries: EntriesService,
    private readonly vouchers: VouchersService,
    private readonly assets: AssetsService,
  ) {}

  onModuleInit() {
    // اعتماد طلب الاستقالة من الخدمة الذاتية يفتح ملف إخلاء الطرف تلقائيًا
    this.requests.onResignationApproved(async (em, actor, r) => {
      const d = r.data as { lastWorkingDay: string; reason?: string };
      const s = await this.open(em, actor, {
        employeeId: r.employeeId, reason: 'resignation', lastWorkingDay: d.lastWorkingDay,
        noticeDate: new Date(r.createdAt).toISOString().slice(0, 10), note: d.reason ?? null,
      }, r.id);
      return { separationId: s.id, separationNo: s.separationNo };
    });
  }

  // ---------------- الإعدادات ----------------

  async config(org: string, em: EntityManager = this.db.manager): Promise<SeparationConfig> {
    const c = (await this.core.settings(org, em)).separationConfig ?? {};
    return { ...DEFAULT_CONFIG, ...c, items: c.items ?? DEFAULT_CONFIG.items, stages: c.stages ?? [] };
  }

  async getConfig(actor: OrgUser) {
    const org = actor.organizationId;
    return { config: await this.config(org), ...(await this.payroll.lookups(org)), structureLevels: (await this.core.settings(org)).structureLevels };
  }

  async saveConfig(actor: OrgUser, input: Partial<SeparationConfig>) {
    const org = actor.organizationId;
    if (!Array.isArray(input.items)) bad('بنود إخلاء الطرف غير صحيحة');
    if (input.items!.length > 20) bad('بنود إخلاء الطرف 20 بندًا على الأكثر');
    const codes = new Set<string>();
    const roles = new Set<string>(((await this.db.query('SELECT id FROM roles WHERE organization_id = $1', [org])) as { id: string }[]).map((r) => r.id));
    const items: ClearanceItemDef[] = input.items!.map((x, i) => {
      const name = str(x?.name, 150) ?? bad(`اكتب اسم البند ${i + 1}`);
      const approver = KINDS.includes(x.approver as never) ? x.approver : bad(`اختر المسؤول عن بند «${name}»`);
      let code = typeof x.code === 'string' && /^[a-z][a-z0-9_]{0,29}$/.test(x.code) ? x.code : `item${i + 1}`;
      while (codes.has(code)) code = `${code}_${i}`;
      codes.add(code);
      const out: ClearanceItemDef = { code, name, description: str(x.description, 500), approver, allowDeduction: x.allowDeduction === true };
      if (approver === 'unit_head') out.level = Number.isInteger(x.level) && Number(x.level) >= 0 && Number(x.level) <= 7 ? Number(x.level) : bad(`اختر مستوى الهيكل لبند «${name}»`);
      if (approver === 'role') out.roleId = typeof x.roleId === 'string' && roles.has(x.roleId) ? x.roleId : bad(`اختر الدور المسؤول عن بند «${name}»`);
      return out;
    });
    const stages = (Array.isArray(input.stages) ? input.stages : []).map((s, i) => ({
      name: str(s?.name, 100) ?? bad(`اكتب اسم مرحلة الاعتماد ${i + 1}`),
      roleId: s?.roleId ? (roles.has(s.roleId) ? s.roleId : bad(`الدور في مرحلة ${i + 1} غير موجود`)) : null,
    }));
    if (stages.length > 6) bad('مراحل الاعتماد 6 مراحل على الأكثر');
    const acc = async (id: unknown, label: string) => {
      if (!id) return null;
      const [a] = await this.db.query('SELECT kind, is_active FROM acc_accounts WHERE id = $1 AND organization_id = $2', [id, org]);
      if (!a || a.kind !== 'sub' || !a.is_active) bad(`${label}: اختر حسابًا فرعيًا فعالًا من دليل الحسابات`);
      return id as string;
    };
    let cashAccountId: string | null = null;
    if (input.cashAccountId) {
      const [c] = await this.db.query('SELECT is_active FROM acc_cash_accounts WHERE id = $1 AND organization_id = $2', [input.cashAccountId, org]);
      if (!c?.is_active) bad('بنك صرف المستحقات غير موجود أو موقوف');
      cashAccountId = input.cashAccountId;
    }
    const config: SeparationConfig = {
      items, stages, cashAccountId, encashLeave: input.encashLeave !== false,
      eosAccountId: await acc(input.eosAccountId, 'حساب مكافأة نهاية الخدمة'), leaveAccountId: await acc(input.leaveAccountId, 'حساب بدل الإجازات'),
      otherAccountId: await acc(input.otherAccountId, 'حساب المستحقات الأخرى'), payableAccountId: await acc(input.payableAccountId, 'حساب مستحقات نهاية الخدمة'),
    };
    await this.core.settings(org);
    await this.db.getRepository(HrSettings).update({ organizationId: org }, { separationConfig: config });
    return this.getConfig(actor);
  }

  // ---------------- فتح الملف ----------------

  async create(actor: OrgUser, input: SeparationInput) {
    const s = await this.db.transaction((em) => this.open(em, actor, input, null));
    return this.get(actor, s.id);
  }

  private async open(em: EntityManager, actor: OrgUser, input: SeparationInput, requestId: string | null) {
    const org = actor.organizationId;
    if (!(input.reason in EOS_REASONS)) bad('اختر سبب انتهاء الخدمة');
    if (!DATE.test(input.lastWorkingDay ?? '')) bad('اختر آخر يوم عمل');
    if (input.noticeDate && !DATE.test(input.noticeDate)) bad('تاريخ الإشعار غير صحيح');
    const e = await em.getRepository(HrEmployee).findOne({ where: { id: input.employeeId, organizationId: org } });
    if (!e) throw new NotFoundException('الموظف غير موجود');
    if (e.status === 'terminated') bad('خدمة الموظف منتهية بالفعل');
    if (input.lastWorkingDay < e.hireDate) bad('آخر يوم عمل قبل تاريخ المباشرة');
    await em.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`hr-sep:${org}`]);
    const [{ n }] = await em.query(`SELECT COUNT(*)::int AS n FROM hr_separations WHERE organization_id = $1 AND employee_id = $2 AND status <> 'cancelled'`, [org, e.id]);
    if (n) throw new ConflictException(`يوجد ملف إنهاء خدمة مفتوح للموظف ${e.fullName}`);
    const cfg = await this.config(org, em);
    const items = await this.resolveItems(org, cfg.items, e, em);
    const [{ next }] = await em.query('SELECT COALESCE(MAX(separation_no), 0) + 1 AS next FROM hr_separations WHERE organization_id = $1', [org]);
    const repo = em.getRepository(HrSeparation);
    return repo.save(repo.create({
      organizationId: org, separationNo: next, employeeId: e.id, reason: input.reason, lastWorkingDay: input.lastWorkingDay, noticeDate: input.noticeDate ?? null,
      requestId, note: str(input.note, 1000), status: 'clearance', items, settlement: null, stageIndex: null,
      history: [this.hist(actor, 'create', requestId ? 'من طلب الاستقالة المعتمد' : str(input.note, 300))], createdById: actor.id, createdByName: actor.fullName,
    }));
  }

  /** يحدد مسؤول كل بند من موقع الموظف في الهيكل (أو الدور أو شؤون الموظفين) */
  private async resolveItems(org: string, defs: ClearanceItemDef[], e: HrEmployee, em: EntityManager): Promise<ClearanceItem[]> {
    const line = await this.requests.line(org, em);
    const name = (id: string | null) => (id ? line.employees.get(id)?.fullName ?? null : null);
    return defs.map((d) => {
      const base: ClearanceItem = {
        code: d.code, name: d.name, description: d.description, kind: d.approver, roleId: d.roleId ?? null, approverEmployeeId: null, approverName: null,
        allowDeduction: d.allowDeduction, status: 'pending', deduction: 0, note: null, actorName: null, onBehalf: false, at: null,
      };
      if (d.approver === 'role' || d.approver === 'hr') return base;
      let target: string | null = null;
      if (d.approver === 'direct_manager') target = line.managerOf(e.id);
      else if (d.approver === 'second_manager') target = line.managerOf(e.id) ? line.managerOf(line.managerOf(e.id)!) : null;
      else if (d.approver === 'unit_head') target = line.unitHead(e, d.level ?? 0);
      else target = line.top();
      // لا يخلي الموظف طرفه بنفسه: يؤول البند لشؤون الموظفين
      if (!target || target === e.id) return { ...base, kind: 'hr', note: target ? 'آل لشؤون الموظفين لأن المسؤول هو الموظف نفسه' : 'آل لشؤون الموظفين لعدم وجود مسؤول في الهيكل' };
      return { ...base, approverEmployeeId: target, approverName: name(target) };
    });
  }

  // ---------------- إخلاء البنود ----------------

  private canClear(me: Me, item: ClearanceItem) {
    const a = me.actor;
    let ok = false;
    if (item.kind === 'hr') ok = a.permissions.includes(P.separations);
    else if (item.kind === 'role') ok = !!item.roleId && me.roles.has(item.roleId);
    else ok = !!me.employee && me.employee.id === item.approverEmployeeId;
    if (ok) return { ok, onBehalf: false };
    return a.isSuperadmin ? { ok: true, onBehalf: true } : { ok: false, onBehalf: false };
  }

  async clearItem(actor: OrgUser, id: string, code: string, input: { decision?: string; deduction?: unknown; note?: unknown }) {
    const org = actor.organizationId;
    const me = await this.requests.me(actor);
    await this.db.transaction(async (em) => {
      const s = await this.lock(em, org, id);
      if (s.status !== 'clearance') throw new ConflictException('انتهت مرحلة إخلاء الطرف في هذا الملف');
      const item = s.items.find((x) => x.code === code) ?? bad('البند غير موجود');
      const can = this.canClear(me, item);
      if (!can.ok) throw new ForbiddenException('لست المسؤول عن إخلاء هذا البند');
      if (me.employee?.id === s.employeeId && !actor.isSuperadmin) throw new ForbiddenException('لا يخلي الموظف طرفه بنفسه');
      const note = str(input.note, 1000);
      const decision = input.decision;
      if (decision === 'clear') {
        const deduction = input.deduction === undefined || input.deduction === null || input.deduction === '' ? 0 : Number(input.deduction);
        if (!Number.isFinite(deduction) || deduction < 0 || deduction > 1_000_000) bad('مبلغ الخصم غير صحيح');
        if (deduction > 0 && !item.allowDeduction) bad('هذا البند لا يقبل تسجيل خصم');
        if (deduction > 0 && !note) bad('اكتب سبب الخصم');
        Object.assign(item, { status: 'cleared', deduction: round2(deduction), note });
      } else if (decision === 'block') {
        if (!note) bad('اكتب ما يمنع إخلاء البند');
        Object.assign(item, { status: 'blocked', deduction: 0, note });
      } else if (decision === 'reopen') {
        if (item.status === 'pending') bad('البند لم يُتخذ فيه إجراء');
        Object.assign(item, { status: 'pending', deduction: 0, note });
      } else bad('اختر الإجراء');
      Object.assign(item, { actorName: actor.fullName, onBehalf: can.onBehalf, at: new Date().toISOString() });
      const action = decision === 'clear' ? 'clear' : decision === 'block' ? 'block' : 'reopen';
      const extra = item.deduction ? ` (خصم ${item.deduction} ريال)` : '';
      await em.getRepository(HrSeparation).update({ id }, { items: s.items, history: [...s.history, this.hist(actor, action, `${item.name}${extra}${note ? `: ${note}` : ''}`)] });
    });
    return this.get(actor, id);
  }

  // ---------------- بيان المستحقات ----------------

  async compute(org: string, s: HrSeparation, adjustments: SettlementAdjustment[], actor: OrgUser, em: EntityManager = this.db.manager): Promise<Settlement> {
    const e = await em.getRepository(HrEmployee).findOneOrFail({ where: { id: s.employeeId } });
    const policy = await this.core.policy(org);
    const cfg = await this.config(org, em);
    const parts = partsOf(e.basicSalary, e.allowances);
    const eos = endOfService(policy, wageFor(policy.eos.wageBase, parts), e.hireDate, s.lastWorkingDay, s.reason as EosReason);
    let leaveDays = 0;
    if (cfg.encashLeave) {
      const annual = (await this.people.balances(org, e, policy, s.lastWorkingDay)).find((b) => b.code === 'annual');
      leaveDays = round2(Math.max(annual?.available ?? 0, 0));
    }
    const dailyWage = round2(wageTotal(parts) / policy.payroll.dayBasis);
    const leaveEncashment = round2(leaveDays * dailyWage);
    const adv = await this.requests.advances(org, { employeeId: e.id });
    const advances = adv.filter((a) => a.status === 'active' && a.remaining > 0).map((a) => ({ advanceId: a.id, remaining: a.remaining }));
    const advancesTotal = round2(advances.reduce((x, a) => x + a.remaining, 0));
    const clearanceDeductions = round2(s.items.reduce((x, i) => x + (i.status === 'cleared' ? i.deduction : 0), 0));
    const adds = round2(adjustments.filter((a) => a.kind === 'addition').reduce((x, a) => x + a.amount, 0));
    const subs = round2(adjustments.filter((a) => a.kind === 'deduction').reduce((x, a) => x + a.amount, 0));
    const gross = round2(eos.amount + leaveEncashment + adds);
    const deductions = round2(advancesTotal + clearanceDeductions + subs);
    return {
      eos: {
        amount: eos.amount, fullAmount: eos.fullAmount, factor: eos.factor, wage: eos.wage, years: eos.service.years, months: eos.service.months, days: eos.service.days,
        explanation: eos.explanation, reasonLabel: eos.reasonLabel,
      },
      leaveDays, dailyWage, leaveEncashment, advances, advancesTotal, clearanceDeductions, adjustments, gross, deductions, net: round2(gross - deductions),
      computedAt: new Date().toISOString(), computedById: actor.id, computedByName: actor.fullName,
    };
  }

  private cleanAdjustments(input: unknown): SettlementAdjustment[] {
    if (input === undefined || input === null) return [];
    if (!Array.isArray(input) || input.length > 15) bad('البنود الإضافية غير صحيحة');
    return (input as Record<string, unknown>[]).map((a, i) => {
      const kind = a?.kind === 'addition' || a?.kind === 'deduction' ? a.kind : bad(`اختر نوع البند الإضافي ${i + 1}`);
      const label = str(a.label, 200) ?? bad(`اكتب وصف البند الإضافي ${i + 1}`);
      const amount = Number(a.amount);
      if (!Number.isFinite(amount) || amount <= 0 || amount > 10_000_000) bad(`مبلغ «${label}» غير صحيح`);
      return { kind, label, amount: round2(amount) };
    });
  }

  /** يعد بيان المستحقات بعد اكتمال إخلاء الطرف، أو يعيد حسابه قبل أول اعتماد */
  async settle(actor: OrgUser, id: string, input: { adjustments?: unknown; note?: unknown }) {
    const org = actor.organizationId;
    const adjustments = this.cleanAdjustments(input.adjustments);
    await this.db.transaction(async (em) => {
      const s = await this.lock(em, org, id);
      if (s.status === 'clearance') {
        const open = s.items.filter((i) => i.status !== 'cleared');
        if (open.length) bad(`لا يُعد بيان المستحقات قبل إخلاء كل البنود: ${open.map((i) => i.name).join('، ')}`);
        // عهدة الأصول الثابتة: لا يُخلى طرف الموظف حتى تُستلم منه أو تُنقل لموظف آخر
        await this.assets.assertNoCustody(org, s.employeeId, em);
      } else if (s.status !== 'settlement' || (s.stageIndex ?? 0) > 0) {
        throw new ConflictException('لا يُعدل البيان بعد بدء اعتماده. يُرجعه المعتمد للتعديل أولًا');
      }
      const settlement = await this.compute(org, s, adjustments, actor, em);
      await em.getRepository(HrSeparation).update({ id }, {
        status: 'settlement', stageIndex: 0, settlement,
        history: [...s.history, this.hist(actor, 'settle', `صافي المستحقات ${settlement.net} ريال${str(input.note, 300) ? `: ${str(input.note, 300)}` : ''}`)],
      });
    });
    return this.get(actor, id);
  }

  private async stagesOf(org: string, em: EntityManager = this.db.manager) {
    const cfg = await this.config(org, em);
    return cfg.stages.length ? cfg.stages : [{ name: 'اعتماد المستحقات', roleId: null }];
  }

  private async canDecide(actor: OrgUser, s: HrSeparation, em: EntityManager = this.db.manager) {
    if (s.status !== 'settlement' || s.stageIndex === null || !s.settlement) return { ok: false, reason: 'البيان لا ينتظر اعتمادًا', stage: null };
    const stages = await this.stagesOf(s.organizationId, em);
    const stage = stages[s.stageIndex] ?? stages[stages.length - 1];
    if (!actor.isSuperadmin) {
      if (!actor.permissions.includes(P.approveSeparations)) return { ok: false, reason: 'ليست لديك صلاحية اعتماد مستحقات نهاية الخدمة', stage };
      // فصل المهام: معد البيان لا يعتمده، والموظف لا يعتمد مستحقاته
      if (s.settlement.computedById === actor.id) return { ok: false, reason: 'معد بيان المستحقات لا يعتمده', stage };
      const [own] = await em.query('SELECT 1 FROM hr_employees WHERE id = $1 AND user_id = $2', [s.employeeId, actor.id]);
      if (own) return { ok: false, reason: 'لا يعتمد الموظف مستحقاته', stage };
      if (stage.roleId) {
        const [row] = await em.query('SELECT 1 FROM user_roles WHERE user_id = $1 AND role_id = $2', [actor.id, stage.roleId]);
        if (!row) return { ok: false, reason: `هذه المرحلة «${stage.name}» لدور آخر`, stage };
      }
    }
    return { ok: true, reason: null, stage };
  }

  async decide(actor: OrgUser, id: string, input: { decision?: string; note?: unknown }) {
    const org = actor.organizationId;
    const note = str(input.note, 1000);
    await this.db.transaction(async (em) => {
      const s = await this.lock(em, org, id);
      const can = await this.canDecide(actor, s, em);
      if (!can.ok) throw new ForbiddenException(can.reason);
      const stages = await this.stagesOf(org, em);
      if (input.decision === 'return') {
        if (!note) bad('اكتب سبب الإرجاع');
        await em.getRepository(HrSeparation).update({ id }, { stageIndex: 0, history: [...s.history, this.hist(actor, 'return', note, can.stage?.name)] });
        return;
      }
      if (input.decision !== 'approve') bad('اختر القرار');
      const history = [...s.history, this.hist(actor, 'approve', note, can.stage?.name)];
      if (s.stageIndex! + 1 < stages.length) {
        await em.getRepository(HrSeparation).update({ id }, { stageIndex: s.stageIndex! + 1, history });
        return;
      }
      await this.finalize(em, actor, s, history);
    });
    return this.get(actor, id);
  }

  /** الاعتماد النهائي: إنهاء الخدمة، تسوية السلف، وقيد المستحقات في النظام المالي */
  private async finalize(em: EntityManager, actor: OrgUser, s: HrSeparation, history: SeparationHistory[]) {
    const org = actor.organizationId;
    const set = s.settlement!;
    await this.assets.assertNoCustody(org, s.employeeId, em);
    if (set.net < 0) bad(`المستقطعات أكبر من المستحقات بمبلغ ${Math.abs(set.net)} ريال. سوّها مع الموظف وعدّل البيان قبل الاعتماد`);
    // السلف التي سُددت أو أُضيفت بعد إعداد البيان تجعل البيان قديمًا
    const fresh = await this.requests.advances(org, { employeeId: s.employeeId });
    const remaining = round2(fresh.filter((a) => a.status === 'active' && a.remaining > 0).reduce((x, a) => x + a.remaining, 0));
    if (remaining !== set.advancesTotal) bad('تغير رصيد سلف الموظف بعد إعداد البيان. يُرجع البيان ويُعاد حسابه');
    const plan = await this.plan(org, s, em);
    if (plan.problems.length) bad(`أكمل الربط المحاسبي لنهاية الخدمة قبل الاعتماد: ${plan.problems.join('، ')}. من إعدادات الموارد البشرية، تبويب «إخلاء الطرف ونهاية الخدمة»`);
    let entryId: string | null = null;
    let entryNo: number | null = null;
    if (plan.lines.length) {
      const date = today() < s.lastWorkingDay ? s.lastWorkingDay : today();
      const year = await this.accCore.assertWritable(org, date, em);
      await this.entries.assertNoApprovedInventory(em, year);
      const clean = await this.entries.cleanLines(org, 'journal', plan.lines, em);
      const e = await em.getRepository(HrEmployee).findOneOrFail({ where: { id: s.employeeId } });
      const entry = await this.entries.createSystemEntry(em, actor, year, 'journal', {
        documentDate: date, description: `مستحقات نهاية خدمة ${e.fullName} (ملف رقم ${s.separationNo})`,
      }, clean);
      entryId = entry.id;
      entryNo = entry.entryNo;
    }
    const month = s.lastWorkingDay.slice(0, 7);
    if (set.advances.length) {
      await em.getRepository(HrAdvanceRepayment).insert(set.advances.map((a) => ({ organizationId: org, advanceId: a.advanceId, runId: null, month, amount: a.remaining })));
    }
    await em.getRepository(HrEmployee).update({ id: s.employeeId }, {
      status: 'terminated', terminationDate: s.lastWorkingDay, terminationReason: s.reason, terminationNote: s.note, eosAmount: set.eos.amount,
    });
    await em.getRepository(HrLeaveRequest).createQueryBuilder().update().set({ status: 'cancelled', decisionNote: 'أُلغيت بانتهاء الخدمة' })
      .where('organization_id = :org AND employee_id = :e AND status = :st AND start_date > :d', { org, e: s.employeeId, st: 'pending', d: s.lastWorkingDay }).execute();
    await em.getRepository(HrSeparation).update({ id: s.id }, {
      status: set.net > 0 ? 'approved' : 'paid', stageIndex: null, entryId, approvedAt: new Date(),
      history: [...history, this.hist(actor, 'final', entryNo ? `القيد رقم ${entryNo}` : 'لا توجد مبالغ للقيد')],
    });
  }

  /** سطور قيد المستحقات: المكافأة وبدل الإجازات والإضافات مدينة، والسلف والخصومات وصافي المستحق دائنة */
  async plan(org: string, s: HrSeparation, em: EntityManager = this.db.manager) {
    const set = s.settlement!;
    const cfg = await this.config(org, em);
    const pay = await this.payroll.config(org, em);
    const e = await em.getRepository(HrEmployee).findOneOrFail({ where: { id: s.employeeId } });
    const units = await em.getRepository(HrUnit).find({ where: { organizationId: org } });
    let u = units.find((x) => x.id === e.unitId);
    let analyticId: string | null = null;
    for (let i = 0; u && i < 12 && !analyticId; i++) {
      analyticId = u.analyticAccountId;
      u = units.find((x) => x.id === u!.parentId);
    }
    const accounts: { id: string; requires_analytic: boolean }[] = await em.query('SELECT id, requires_analytic FROM acc_accounts WHERE organization_id = $1', [org]);
    const needs = new Map(accounts.map((a) => [a.id, a.requires_analytic]));
    const problems: string[] = [];
    const lines: LineDto[] = [];
    const add = (side: 'debit' | 'credit', accountId: string | null | undefined, amount: number, label: string, missing: string) => {
      if (amount <= 0) return;
      if (!accountId) {
        problems.push(missing);
        return;
      }
      const a = needs.get(accountId) && analyticId ? [{ analyticId, percent: 100 }] : [];
      if (needs.get(accountId) && !analyticId) problems.push('الحساب التحليلي لوحدة الموظف');
      lines.push({ accountId, debit: side === 'debit' ? amount : 0, credit: side === 'credit' ? amount : 0, label, analytic: a });
    };
    const adds = round2(set.adjustments.filter((a) => a.kind === 'addition').reduce((x, a) => x + a.amount, 0));
    const subs = round2(set.adjustments.filter((a) => a.kind === 'deduction').reduce((x, a) => x + a.amount, 0));
    add('debit', cfg.eosAccountId, set.eos.amount, 'مكافأة نهاية الخدمة', 'حساب مكافأة نهاية الخدمة');
    add('debit', cfg.leaveAccountId, set.leaveEncashment, `بدل رصيد الإجازات (${set.leaveDays} يوم)`, 'حساب بدل الإجازات');
    add('debit', cfg.otherAccountId, adds, 'مستحقات أخرى لنهاية الخدمة', 'حساب المستحقات الأخرى');
    add('credit', pay.advancesAccountId ?? pay.deductionsAccountId, set.advancesTotal, 'تسوية رصيد سلف الموظف', 'حساب سلف الموظفين (في الربط المحاسبي للرواتب)');
    add('credit', pay.deductionsAccountId, round2(set.clearanceDeductions + subs), 'خصومات إخلاء الطرف', 'حساب الاستقطاعات (في الربط المحاسبي للرواتب)');
    add('credit', cfg.payableAccountId ?? pay.payableAccountId, set.net, 'صافي مستحقات نهاية الخدمة', 'حساب مستحقات نهاية الخدمة');
    return { problems: [...new Set(problems)], lines };
  }

  /** سند صرف المستحقات: مسودة في النظام المالي تمر بمراحل اعتماد سندات الصرف */
  async pay(actor: OrgUser, id: string, input: { voucherDate?: string; cashAccountId?: string | null }) {
    const org = actor.organizationId;
    await this.db.transaction(async (em) => {
      const s = await this.lock(em, org, id);
      if (s.status !== 'approved') throw new ConflictException('يُنشأ سند الصرف بعد الاعتماد النهائي للمستحقات');
      const cfg = await this.config(org, em);
      const pay = await this.payroll.config(org, em);
      const cash = input.cashAccountId || cfg.cashAccountId || pay.defaultCashAccountId || bad('اختر البنك الذي تُصرف منه المستحقات');
      const payable = cfg.payableAccountId ?? pay.payableAccountId ?? bad('حدد حساب مستحقات نهاية الخدمة');
      const date = input.voucherDate && DATE.test(input.voucherDate) ? input.voucherDate : today();
      const e = await em.getRepository(HrEmployee).findOneOrFail({ where: { id: s.employeeId } });
      const v = await this.vouchers.insertDraft(em, actor, 'payment', {
        voucherDate: date, partyName: e.fullName, amount: s.settlement!.net,
        purpose: `صرف مستحقات نهاية خدمة ${e.fullName} حسب ملف إنهاء الخدمة رقم ${s.separationNo}`, sourceType: 'separation', sourceRef: String(s.separationNo), projectName: null,
        method: 'transfer', methodRef: e.iban, cashAccountId: cash, counterAccountId: payable, partnerId: null, analytic: [],
      });
      await em.getRepository(HrSeparation).update({ id }, { status: 'paid', voucherId: v.id, history: [...s.history, this.hist(actor, 'pay', `سند رقم ${v.serial}`)] });
    });
    return this.get(actor, id);
  }

  async cancel(actor: OrgUser, id: string, note: unknown) {
    const org = actor.organizationId;
    const n = str(note, 1000) ?? bad('اكتب سبب إلغاء الملف');
    await this.db.transaction(async (em) => {
      const s = await this.lock(em, org, id);
      if (!['clearance', 'settlement'].includes(s.status)) throw new ConflictException('لا يُلغى الملف بعد اعتماد المستحقات');
      await em.getRepository(HrSeparation).update({ id }, { status: 'cancelled', stageIndex: null, history: [...s.history, this.hist(actor, 'cancel', n)] });
    });
    return this.get(actor, id);
  }

  // ---------------- القراءة ----------------

  private async lock(em: EntityManager, org: string, id: string) {
    const s = await em.getRepository(HrSeparation).createQueryBuilder('s').setLock('pessimistic_write').where('s.id = :id AND s.organization_id = :org', { id, org }).getOne();
    if (!s) throw new NotFoundException('ملف إنهاء الخدمة غير موجود');
    return s;
  }

  private hist(actor: OrgUser, action: string, note: string | null = null, stageName: string | null = null): SeparationHistory {
    return { action, note, actorName: actor.fullName, at: new Date().toISOString(), stageName };
  }

  async list(actor: OrgUser, status?: string) {
    const org = actor.organizationId;
    const where: Record<string, unknown> = { organizationId: org };
    if (status && status in SEPARATION_STATUS_AR) where.status = status;
    const rows = await this.db.getRepository(HrSeparation).find({ where, order: { createdAt: 'DESC' }, take: 300 });
    const emps = rows.length ? await this.db.getRepository(HrEmployee).find({ where: { id: In([...new Set(rows.map((r) => r.employeeId))]) } }) : [];
    const [{ c, s, a }] = await this.db.query(
      `SELECT COUNT(*) FILTER (WHERE status = 'clearance')::int AS c, COUNT(*) FILTER (WHERE status = 'settlement')::int AS s, COUNT(*) FILTER (WHERE status = 'approved')::int AS a
         FROM hr_separations WHERE organization_id = $1`, [org],
    );
    return {
      counts: { clearance: c, settlement: s, approved: a },
      rows: rows.map((r) => this.row(r, emps.find((e) => e.id === r.employeeId))),
    };
  }

  row(r: HrSeparation, e?: HrEmployee | null) {
    const cleared = r.items.filter((i) => i.status === 'cleared').length;
    return {
      id: r.id, separationNo: r.separationNo, employeeId: r.employeeId, employeeName: e?.fullName ?? '', employeeNo: e?.employeeNo ?? null,
      reason: r.reason, reasonLabel: EOS_REASONS[r.reason as EosReason]?.label ?? r.reason, lastWorkingDay: r.lastWorkingDay, status: r.status,
      statusLabel: SEPARATION_STATUS_AR[r.status], items: r.items.length, cleared, blocked: r.items.filter((i) => i.status === 'blocked').length,
      net: r.settlement?.net ?? null, fromRequest: !!r.requestId, createdAt: r.createdAt,
    };
  }

  /** من يرى الملف: شؤون الموظفين ومعتمدو المستحقات، ومسؤولو بنود الإخلاء، والموظف نفسه */
  private async access(actor: OrgUser, s: HrSeparation) {
    const me = await this.requests.me(actor);
    const hr = actor.isSuperadmin || [P.separations, P.approveSeparations, P.payPayroll].some((p) => actor.permissions.includes(p));
    const owner = !!me.employee && me.employee.id === s.employeeId;
    const responsible = s.items.some((i) => this.canClear(me, i).ok && !this.canClear(me, i).onBehalf);
    if (!hr && !owner && !responsible) throw new ForbiddenException('لا تملك صلاحية الاطلاع على هذا الملف');
    return { me, hr, owner, responsible };
  }

  async get(actor: OrgUser, id: string) {
    const org = actor.organizationId;
    const s = await this.db.getRepository(HrSeparation).findOne({ where: { id, organizationId: org } });
    if (!s) throw new NotFoundException('ملف إنهاء الخدمة غير موجود');
    const a = await this.access(actor, s);
    const e = await this.db.getRepository(HrEmployee).findOneOrFail({ where: { id: s.employeeId } });
    const [job, unit] = await Promise.all([
      this.db.getRepository(HrJob).findOne({ where: { id: e.jobId }, select: ['id', 'title'] }), this.db.getRepository(HrUnit).findOne({ where: { id: e.unitId }, select: ['id', 'name'] }),
    ]);
    const roleIds = s.items.map((i) => i.roleId).filter(Boolean) as string[];
    const roles: { id: string; name: string }[] = roleIds.length ? await this.db.query('SELECT id, name FROM roles WHERE id = ANY($1)', [roleIds]) : [];
    const stages = await this.stagesOf(org);
    const decide = await this.canDecide(actor, s);
    const [org1] = await this.db.query('SELECT name FROM organizations WHERE id = $1', [org]);
    let entry: { id: string; entryNo: number } | null = null;
    if (s.entryId) [entry] = await this.db.query('SELECT id, entry_no AS "entryNo" FROM acc_entries WHERE id = $1', [s.entryId]);
    let voucher: unknown = null;
    if (s.voucherId) {
      const [v] = await this.db.query('SELECT id, serial, amount::float AS amount, status FROM acc_vouchers WHERE id = $1', [s.voucherId]);
      voucher = v ? { ...v, statusLabel: VOUCHER_STATUS_AR[v.status as keyof typeof VOUCHER_STATUS_AR] ?? v.status } : null;
    }
    const preview = s.status === 'clearance' && a.hr ? await this.compute(org, s, [], actor) : null;
    const assetCustody = ['clearance', 'settlement', 'approved'].includes(s.status) ? await this.assets.heldBy(org, s.employeeId) : [];
    const plan = s.settlement && ['settlement', 'approved'].includes(s.status) && a.hr ? await this.plan(org, s) : null;
    const salaries = actor.isSuperadmin || actor.permissions.includes(P.salaries) || a.owner || actor.permissions.includes(P.approveSeparations);
    return {
      ...this.row(s, e),
      organizationName: org1?.name ?? '',
      employee: { id: e.id, fullName: e.fullName, employeeNo: e.employeeNo, nationalId: a.hr || a.owner ? e.nationalId : null, jobTitle: job?.title ?? '', unitName: unit?.name ?? '', hireDate: e.hireDate, iban: a.hr || a.owner ? e.iban : null },
      noticeDate: s.noticeDate, note: s.note, requestId: s.requestId,
      items: s.items.map((i) => {
        const c = this.canClear(a.me, i);
        return {
          ...i, statusLabel: ITEM_STATUS_AR[i.status], kindLabel: APPROVER_AR[i.kind], roleName: roles.find((r) => r.id === i.roleId)?.name ?? null,
          can: s.status === 'clearance' && c.ok && (!a.owner || actor.isSuperadmin), onBehalf: c.onBehalf,
        };
      }),
      settlement: salaries ? s.settlement : null, preview: salaries ? preview : null, plan,
      stages: stages.map((st, i) => ({ name: st.name, current: s.status === 'settlement' && i === s.stageIndex, done: s.status === 'approved' || s.status === 'paid' || (s.stageIndex !== null && i < s.stageIndex) })),
      entry, voucher, approvedAt: s.approvedAt, createdByName: s.createdByName, assetCustody,
      history: s.history.map((h) => ({ ...h, label: ACTION_AR[h.action] ?? h.action })),
      viewer: { hr: a.hr, owner: a.owner, responsible: a.responsible },
      can: {
        settle: actor.permissions.includes(P.separations) || actor.isSuperadmin
          ? (s.status === 'clearance' && s.items.every((i) => i.status === 'cleared')) || (s.status === 'settlement' && s.stageIndex === 0)
          : false,
        decide: decide.ok, decideReason: s.status === 'settlement' ? decide.reason : null,
        pay: s.status === 'approved' && (actor.isSuperadmin || actor.permissions.includes(P.payPayroll)),
        cancel: ['clearance', 'settlement'].includes(s.status) && (actor.isSuperadmin || actor.permissions.includes(P.separations)),
      },
    };
  }

  /** بنود إخلاء الطرف التي تنتظر المستخدم (للجرس وشاشة «بانتظار اعتمادي») */
  async awaitingItems(actor: OrgUser) {
    const me = await this.requests.me(actor);
    const rows = await this.db.getRepository(HrSeparation).find({ where: { organizationId: actor.organizationId, status: 'clearance' }, order: { createdAt: 'ASC' } });
    const emps = rows.length ? await this.db.getRepository(HrEmployee).find({ where: { id: In(rows.map((r) => r.employeeId)) }, select: ['id', 'fullName'] }) : [];
    return rows.flatMap((s) => s.items.filter((i) => i.status !== 'cleared' && me.employee?.id !== s.employeeId)
      .filter((i) => {
        const c = this.canClear(me, i);
        return c.ok && !c.onBehalf;
      })
      .map((i) => ({
        separationId: s.id, separationNo: s.separationNo, employeeName: emps.find((e) => e.id === s.employeeId)?.fullName ?? '', lastWorkingDay: s.lastWorkingDay,
        code: i.code, name: i.name, status: i.status, at: s.createdAt,
      })));
  }

  /** بيانات المهام لشؤون الموظفين والمعتمدين والصرف */
  async pendingFor(actor: OrgUser) {
    const org = actor.organizationId;
    const rows = await this.db.getRepository(HrSeparation).find({ where: { organizationId: org, status: In(['clearance', 'settlement', 'approved']) }, order: { createdAt: 'ASC' } });
    const emps = rows.length ? await this.db.getRepository(HrEmployee).find({ where: { id: In(rows.map((r) => r.employeeId)) }, select: ['id', 'fullName'] }) : [];
    const name = (id: string) => emps.find((e) => e.id === id)?.fullName ?? '';
    const out: { id: string; title: string; subtitle: string; link: string; at: Date; group: string; urgent: boolean }[] = [];
    const isHr = actor.isSuperadmin || actor.permissions.includes(P.separations);
    for (const s of rows) {
      const link = `/hr/separations/${s.id}`;
      if (s.status === 'clearance' && isHr && s.items.every((i) => i.status === 'cleared')) {
        out.push({ id: `sep-settle-${s.id}`, title: `إعداد بيان مستحقات ${name(s.employeeId)}`, subtitle: 'اكتمل إخلاء الطرف', link, at: s.updatedAt, group: 'نهاية الخدمة', urgent: s.lastWorkingDay < today() });
      }
      if (s.status === 'settlement' && (await this.canDecide(actor, s)).ok) {
        out.push({ id: `sep-approve-${s.id}`, title: `اعتماد مستحقات نهاية خدمة ${name(s.employeeId)}`, subtitle: `صافي ${s.settlement?.net ?? 0} ريال`, link, at: s.updatedAt, group: 'نهاية الخدمة', urgent: false });
      }
      if (s.status === 'approved' && (actor.isSuperadmin || actor.permissions.includes(P.payPayroll))) {
        out.push({ id: `sep-pay-${s.id}`, title: `صرف مستحقات ${name(s.employeeId)}`, subtitle: `صافي ${s.settlement?.net ?? 0} ريال`, link, at: s.updatedAt, group: 'نهاية الخدمة', urgent: false });
      }
    }
    for (const i of await this.awaitingItems(actor)) {
      out.push({
        id: `sep-item-${i.separationId}-${i.code}`, title: `إخلاء طرف ${i.employeeName}: ${i.name}`, subtitle: `آخر يوم عمل ${i.lastWorkingDay}`, link: `/hr/separations/${i.separationId}`,
        at: i.at, group: 'إخلاء الطرف', urgent: i.lastWorkingDay < today(),
      });
    }
    return out;
  }

  /** ملف إنهاء الخدمة المفتوح للموظف نفسه (لوحته الشخصية) */
  async mine(employeeId: string, org: string) {
    const s = await this.db.getRepository(HrSeparation).findOne({ where: { organizationId: org, employeeId, status: In(['clearance', 'settlement', 'approved', 'paid']) }, order: { createdAt: 'DESC' } });
    return s ? this.row(s) : null;
  }
}
