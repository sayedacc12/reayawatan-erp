import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Brackets, DataSource, EntityManager, In } from 'typeorm';
import { OrgUser } from '../../core/auth/decorators';
import { Organization, Role } from '../../core/entities';
import { AccCore, cents, fromCents, VOUCHER_LABEL } from './acc-core.service';
import { LineDto, RequestDecisionDto, VoucherDecisionDto, VoucherDto, VoucherRequestDto, VoucherStagesDto } from './accounting.dto';
import { ACC_PERMISSIONS as P } from './accounting.manifest';
import {
  CashAccount, JournalEntry, Voucher, VoucherAction, VoucherKind, VoucherMethod, VoucherSource, VoucherStage, VoucherStatus,
  Partner,
} from './entities/accounting.entity';

/** سند تنشئه وحدة أخرى بسطور قيد ثابتة (مثل شراء أصل ثابت أو بيعه) */
export interface SystemVoucherInput {
  voucherDate: string; partyName: string; partnerId: string | null; amount: number; purpose: string;
  sourceType: VoucherSource; sourceRef: string | null; method: VoucherMethod; cashAccountId: string | null; counterAccountId: string;
  lines: LineDto[];
}
type VoucherListener = (em: EntityManager, v: Voucher, status: VoucherStatus) => Promise<void>;
type VoucherGuard = (em: EntityManager, v: Voucher) => Promise<void>;
import { EntriesService } from './entries.service';
import { tafqeetSar } from './tafqeet';

export const VOUCHER_STATUS_AR: Record<VoucherStatus, string> = {
  draft: 'مسودة', pending: 'قيد الاعتماد', returned: 'معاد للتعديل', approved: 'معتمد ومرحّل', rejected: 'مرفوض', cancelled: 'ملغي',
};
const METHOD_AR = { cash: 'نقدًا', transfer: 'حوالة بنكية', cheque: 'شيك', card: 'شبكة / بطاقة', credit: 'آجل' } as const;
const ACTION_AR: Record<string, string> = {
  create: 'إنشاء السند', update: 'تعديل السند', submit: 'إرسال للاعتماد', approve: 'موافقة', final: 'اعتماد نهائي وترحيل القيد',
  reject: 'رفض', return: 'إرجاع للتعديل', request_draft: 'طلب إعادة للمسودة', request_cancel: 'طلب إلغاء',
  request_rejected: 'رفض الطلب', to_draft: 'إعادة للمسودة وعكس القيد', cancel: 'إلغاء السند',
};

export interface VoucherFilters { status?: VoucherStatus; q?: string; dateFrom?: string; dateTo?: string; mine?: boolean }

/**
 * سندات القبض والصرف: لكل نوع شاشته ومراحل اعتماده المستقلة (موافقة / رفض / إرجاع).
 * عند الاعتماد النهائي يصدر قيد يومية مرحّل برقم السند نفسه ولا يُعدَّل. التعديل بعده بإعادة السند للمسودة،
 * فيُعكس القيد (يبقى رقمه ويظهر ملغيًا). سند القبض يعاد أو يُلغى باعتماد ثنائي، وسند الصرف يعيده المعتمد النهائي فقط.
 */
@Injectable()
export class VouchersService {
  constructor(private readonly db: DataSource, private readonly core: AccCore, private readonly entries: EntriesService) {}

  private readonly listeners = new Map<VoucherSource, VoucherListener>();
  private readonly guards = new Map<VoucherSource, VoucherGuard>();

  /** تُبلَّغ الوحدة المصدر بتغير حالة سنداتها داخل المعاملة نفسها (اعتماد، رفض، إرجاع، إلغاء، إعادة للمسودة) */
  onStatusChange(source: VoucherSource, fn: VoucherListener) {
    this.listeners.set(source, fn);
  }

  /** تتحقق الوحدة المصدر قبل عكس قيد سند معتمد (مثل منع إلغاء شراء أصل احتُسب له إهلاك) */
  onBeforeReverse(source: VoucherSource, fn: VoucherGuard) {
    this.guards.set(source, fn);
  }

  private async notify(em: EntityManager, id: string) {
    const v = await em.getRepository(Voucher).findOneOrFail({ where: { id } });
    const fn = this.listeners.get(v.sourceType);
    if (fn) await fn(em, v, v.status);
  }

  private managePerm(kind: VoucherKind) {
    return kind === 'receipt' ? P.receipts : P.payments;
  }

  private assertManage(actor: OrgUser, kind: VoucherKind) {
    if (!actor.permissions.includes(this.managePerm(kind))) {
      throw new ForbiddenException(kind === 'receipt' ? 'ليست لديك صلاحية سندات القبض' : 'ليست لديك صلاحية سندات الصرف');
    }
  }

  private async roleIds(actor: OrgUser): Promise<Set<string>> {
    const rows: { role_id: string }[] = await this.db.query('SELECT role_id FROM user_roles WHERE user_id = $1', [actor.id]);
    return new Set(rows.map((r) => r.role_id));
  }

  private canDecideStage(actor: OrgUser, stage: VoucherStage | null | undefined, roles: Set<string>) {
    if (!actor.permissions.includes(P.approveVouchers)) return false;
    if (!stage?.roleId || actor.isSuperadmin) return true;
    return roles.has(stage.roleId);
  }

  // ---------------- مراحل الاعتماد ----------------

  async stages(org: string, kind: VoucherKind, em: EntityManager = this.db.manager) {
    return em.getRepository(VoucherStage).find({ where: { organizationId: org, kind }, order: { sortOrder: 'ASC' } });
  }

  async listStages(actor: OrgUser, kind: VoucherKind) {
    const stages = await this.stages(actor.organizationId, kind);
    const roleIds = stages.map((s) => s.roleId).filter(Boolean) as string[];
    const roles = roleIds.length ? await this.db.getRepository(Role).find({ where: { id: In(roleIds) } }) : [];
    const pending: { current_stage_id: string; n: number }[] = await this.db.query(
      `SELECT current_stage_id, COUNT(*)::int AS n FROM acc_vouchers WHERE organization_id = $1 AND status = 'pending' GROUP BY 1`, [actor.organizationId]);
    return stages.map((s) => ({
      id: s.id, name: s.name, instructions: s.instructions, sortOrder: s.sortOrder, roleId: s.roleId,
      roleName: roles.find((r) => r.id === s.roleId)?.name ?? null, pending: pending.find((p) => p.current_stage_id === s.id)?.n ?? 0,
    }));
  }

  async saveStages(actor: OrgUser, kind: VoucherKind, dto: VoucherStagesDto) {
    const org = actor.organizationId;
    await this.db.transaction(async (em) => {
      const repo = em.getRepository(VoucherStage);
      const existing = await this.stages(org, kind, em);
      const roleIds = [...new Set(dto.stages.map((s) => s.roleId).filter(Boolean) as string[])];
      if (roleIds.length && (await em.count(Role, { where: { id: In(roleIds), organizationId: org } })) !== roleIds.length) {
        throw new BadRequestException('أحد الأدوار المختارة غير موجود');
      }
      const keep = new Set(dto.stages.map((s) => s.id).filter(Boolean));
      for (const s of existing.filter((x) => !keep.has(x.id))) {
        const n = await em.count(Voucher, { where: { currentStageId: s.id, status: 'pending' } });
        if (n) throw new ConflictException(`لا يمكن حذف مرحلة «${s.name}» وعليها ${n} سند ينتظر القرار`);
        await repo.delete({ id: s.id });
      }
      for (const [i, s] of dto.stages.entries()) {
        const data = { name: s.name, instructions: s.instructions ?? null, roleId: s.roleId ?? null, sortOrder: i + 1 };
        if (s.id && existing.some((x) => x.id === s.id)) await repo.update({ id: s.id }, data);
        else await repo.save(repo.create({ organizationId: org, kind, ...data }));
      }
    });
    return this.listStages(actor, kind);
  }

  // ---------------- القراءة ----------------

  async list(actor: OrgUser, kind: VoucherKind, f: VoucherFilters) {
    const org = actor.organizationId;
    const qb = this.db.getRepository(Voucher).createQueryBuilder('v')
      .leftJoinAndSelect('v.cashAccount', 'c').leftJoinAndSelect('v.counterAccount', 'a')
      .where('v.organization_id = :org AND v.kind = :kind', { org, kind });
    if (f.status) qb.andWhere('v.status = :st', { st: f.status });
    if (f.dateFrom) qb.andWhere('v.voucher_date >= :df', { df: f.dateFrom });
    if (f.dateTo) qb.andWhere('v.voucher_date <= :dt', { dt: f.dateTo });
    if (f.q) {
      const q = f.q.trim();
      qb.andWhere(new Brackets((w) => {
        w.where('v.party_name ILIKE :q', { q: `%${q}%` }).orWhere('v.purpose ILIKE :q', { q: `%${q}%` });
        if (/^\d+$/.test(q)) w.orWhere('v.serial = :n', { n: Number(q) });
      }));
    }
    const rows = await qb.orderBy('v.serial', 'DESC').take(500).getMany();
    const [stages, roles] = await Promise.all([this.stages(org, kind), this.roleIds(actor)]);
    const counts: { status: VoucherStatus; n: number; total: string }[] = await this.db.query(
      'SELECT status, COUNT(*)::int AS n, COALESCE(SUM(amount), 0) AS total FROM acc_vouchers WHERE organization_id = $1 AND kind = $2 GROUP BY 1', [org, kind]);
    const items = rows.map((v) => {
      const stage = stages.find((s) => s.id === v.currentStageId);
      return {
        id: v.id, serial: v.serial, voucherDate: v.voucherDate, partyName: v.partyName, amount: v.amount, purpose: v.purpose,
        method: v.method, methodLabel: METHOD_AR[v.method], cashAccountName: v.cashAccount?.name ?? '', counterAccount: v.counterAccount ? `${v.counterAccount.code} ${v.counterAccount.name}` : '',
        status: v.status, statusLabel: VOUCHER_STATUS_AR[v.status], stageName: stage?.name ?? null, requestKind: v.requestKind,
        awaitingMe: (v.status === 'pending' && this.canDecideStage(actor, stage, roles))
          || (!!v.requestKind && v.kind === 'receipt' && actor.permissions.includes(P.approveReceiptCancel) && v.requestById !== actor.id),
        createdByName: v.createdByName,
      };
    });
    return {
      items: f.mine ? items.filter((i) => i.awaitingMe) : items,
      counts: Object.fromEntries(counts.map((c) => [c.status, { count: c.n, total: Number(c.total) }])),
      stagesCount: stages.length,
    };
  }

  private async load(em: EntityManager, org: string, id: string, lock = true) {
    const qb = em.getRepository(Voucher).createQueryBuilder('v').where('v.id = :id AND v.organization_id = :org', { id, org });
    if (lock) qb.setLock('pessimistic_write');
    const v = await qb.getOne();
    if (!v) throw new NotFoundException('السند غير موجود');
    return v;
  }

  async get(actor: OrgUser, id: string) {
    const org = actor.organizationId;
    const v = await this.db.getRepository(Voucher).findOne({
      where: { id, organizationId: org },
      relations: { fiscalYear: true, cashAccount: { glAccount: true }, counterAccount: true, partner: true },
    });
    if (!v) throw new NotFoundException('السند غير موجود');
    const [stages, roles, actions, orgRow, entries] = await Promise.all([
      this.stages(org, v.kind), this.roleIds(actor),
      this.db.getRepository(VoucherAction).find({ where: { voucherId: v.id }, order: { createdAt: 'ASC' } }),
      this.db.getRepository(Organization).findOneOrFail({ where: { id: org } }),
      this.db.getRepository(JournalEntry).find({ where: { voucherId: v.id }, order: { entryNo: 'ASC' } }),
    ]);
    const analyticIds = v.analytic.map((a) => a.analyticId);
    const names: { id: string; code: string; name: string }[] = analyticIds.length
      ? await this.db.query('SELECT id, code, name FROM acc_analytic_accounts WHERE id = ANY($1)', [analyticIds]) : [];
    const stage = stages.find((s) => s.id === v.currentStageId);
    const manage = actor.permissions.includes(this.managePerm(v.kind));
    const finalApprover = this.isFinalApprover(actor, stages, roles);
    const editable = v.status === 'draft' || v.status === 'returned';
    return {
      id: v.id, kind: v.kind, kindLabel: VOUCHER_LABEL[v.kind], serial: v.serial, fiscalYear: v.fiscalYear?.name, voucherDate: v.voucherDate,
      partyName: v.partyName, partnerId: v.partnerId, partnerName: v.partner?.name ?? null,
      amount: v.amount, amountWords: tafqeetSar(v.amount), purpose: v.purpose,
      sourceType: v.sourceType, sourceRef: v.sourceRef, projectName: v.projectName,
      method: v.method, methodLabel: METHOD_AR[v.method], methodRef: v.methodRef,
      cashAccountId: v.cashAccountId, cashAccountName: v.cashAccount?.name ?? '', cashKind: v.cashAccount?.kind,
      cashGl: v.cashAccount?.glAccount ? `${v.cashAccount.glAccount.code} ${v.cashAccount.glAccount.name}` : '',
      counterAccountId: v.counterAccountId, counterAccountCode: v.counterAccount?.code, counterAccountName: v.counterAccount?.name,
      analytic: v.analytic.map((a) => ({ ...a, code: names.find((n) => n.id === a.analyticId)?.code ?? '', name: names.find((n) => n.id === a.analyticId)?.name ?? '' })),
      status: v.status, statusLabel: VOUCHER_STATUS_AR[v.status],
      stages: stages.map((s) => ({ id: s.id, name: s.name, instructions: s.instructions })), currentStageId: v.currentStageId, stageName: stage?.name ?? null,
      request: v.requestKind && { kind: v.requestKind, byName: v.requestByName, reason: v.requestReason, at: v.requestAt },
      entries: entries.map((e) => ({ id: e.id, entryNo: e.entryNo, status: e.status, cancelReason: e.cancelReason, postedAt: e.postedAt, cancelledAt: e.cancelledAt })),
      entryId: v.entryId, approvedAt: v.approvedAt, createdByName: v.createdByName, createdAt: v.createdAt,
      lockedSource: v.sourceType === 'assets',
      lines: v.customLines ? await this.linesView(v.customLines) : null,
      organization: { name: orgRow.name, taxNumber: (orgRow as Organization & { taxNumber?: string | null }).taxNumber ?? null },
      actions: actions.map((a) => ({ id: a.id, action: a.action, label: ACTION_AR[a.action] ?? a.action, stageName: a.stageName, note: a.note, actorName: a.actorName, at: a.createdAt })),
      can: {
        edit: editable && manage && v.sourceType !== 'assets',
        submit: editable && manage,
        decide: v.status === 'pending' && this.canDecideStage(actor, stage, roles),
        approveDirect: editable && !stages.length && actor.permissions.includes(P.approveVouchers),
        cancelDraft: editable && manage,
        request: v.status === 'approved' && !v.requestKind
          && (v.kind === 'receipt' ? actor.permissions.includes(P.cancel) : finalApprover),
        decideRequest: !!v.requestKind && actor.permissions.includes(P.approveReceiptCancel) && v.requestById !== actor.id,
      },
    };
  }

  private async linesView(lines: NonNullable<Voucher['customLines']>) {
    const ids = [...new Set(lines.map((l) => l.accountId))];
    const accs: { id: string; code: string; name: string }[] = await this.db.query('SELECT id, code, name FROM acc_accounts WHERE id = ANY($1)', [ids]);
    return lines.map((l) => {
      const a = accs.find((x) => x.id === l.accountId);
      return { accountCode: a?.code ?? '', accountName: a?.name ?? '', debit: l.debit, credit: l.credit, label: l.label };
    });
  }

  /** المعتمد النهائي: صاحب قرار المرحلة الأخيرة (أو صاحب صلاحية الاعتماد إن لم تُعرَّف مراحل) */
  private isFinalApprover(actor: OrgUser, stages: VoucherStage[], roles: Set<string>) {
    return this.canDecideStage(actor, stages.at(-1) ?? null, roles);
  }

  // ---------------- الإنشاء والتعديل ----------------

  /** بناء سطور القيد المقابل للسند والتحقق منها بقواعد القيود نفسها */
  private async buildLines(em: EntityManager, org: string, kind: VoucherKind, d: {
    amount: number; purpose: string; cashAccountId: string; counterAccountId: string; partnerId: string | null; analytic: { analyticId: string; percent: number }[];
  }): Promise<LineDto[]> {
    const cash = await em.getRepository(CashAccount).findOne({ where: { id: d.cashAccountId, organizationId: org } });
    if (!cash) throw new BadRequestException('البنك أو الصندوق غير موجود');
    if (!cash.isActive) throw new BadRequestException(`«${cash.name}» موقوف`);
    if (cash.glAccountId === d.counterAccountId) throw new BadRequestException('الحساب المقابل هو نفسه حساب البنك أو الصندوق');
    const amount = fromCents(cents(d.amount));
    const cashLine: LineDto = { accountId: cash.glAccountId, debit: kind === 'receipt' ? amount : 0, credit: kind === 'payment' ? amount : 0, label: d.purpose };
    const counterLine: LineDto = {
      accountId: d.counterAccountId, debit: kind === 'payment' ? amount : 0, credit: kind === 'receipt' ? amount : 0, label: d.purpose,
      partnerId: d.partnerId, analytic: d.analytic,
    };
    const lines = kind === 'receipt' ? [cashLine, counterLine] : [counterLine, cashLine];
    await this.entries.cleanLines(org, kind, lines, em);
    return lines;
  }

  private async log(em: EntityManager, actor: OrgUser, v: Voucher, action: string, note: string | null = null, stageName: string | null = null) {
    await em.getRepository(VoucherAction).save(em.create(VoucherAction, {
      organizationId: v.organizationId, voucherId: v.id, action, note, stageName, actorId: actor.id, actorName: actor.fullName,
    }));
  }

  /** الشريك المسجل يحدد الحساب المقابل من ملفه تلقائيًا (حساب العميل أو المورد في الدليل) */
  private async fields(em: EntityManager, org: string, dto: VoucherDto) {
    let counterAccountId = dto.counterAccountId ?? null;
    if (dto.partnerId) {
      const p = await em.getRepository(Partner).findOne({ where: { id: dto.partnerId, organizationId: org } });
      if (!p) throw new BadRequestException('الشريك غير موجود');
      if (p.accountId) counterAccountId = p.accountId;
    }
    if (!counterAccountId) throw new BadRequestException('اختر الحساب المقابل، أو اربط الشريك بحساب في ملفه');
    return {
      voucherDate: dto.voucherDate, partyName: dto.partyName, partnerId: dto.partnerId ?? null, amount: fromCents(cents(dto.amount)),
      purpose: dto.purpose, sourceType: dto.sourceType ?? 'manual', sourceRef: dto.sourceRef ?? null, projectName: dto.projectName ?? null,
      method: dto.method, methodRef: dto.methodRef ?? null, cashAccountId: dto.cashAccountId, counterAccountId,
      analytic: (dto.analytic ?? []).map((a) => ({ analyticId: a.analyticId, percent: a.percent })),
    };
  }

  async create(actor: OrgUser, kind: VoucherKind, dto: VoucherDto) {
    this.assertManage(actor, kind);
    const id = await this.db.transaction(async (em) => (await this.insertDraft(em, actor, kind, dto)).id);
    return this.get(actor, id);
  }

  /**
   * سند مسودة تنشئه وحدة أخرى (مثل مسير الرواتب) داخل معاملتها. صلاحية الإنشاء تتحقق منها الوحدة المرسلة،
   * ثم يمر السند بمراحل اعتماد سندات الصرف المعتادة في النظام المالي.
   */
  async insertDraft(em: EntityManager, actor: OrgUser, kind: VoucherKind, dto: VoucherDto) {
    const org = actor.organizationId;
    const year = await this.core.assertWritable(org, dto.voucherDate, em);
    await this.entries.assertNoApprovedInventory(em, year);
    const f = await this.fields(em, org, dto);
    await this.buildLines(em, org, kind, f);
    // الرقم يُحجز عند الإنشاء ولا يُعاد استخدامه أبدًا (يبقى ولو أُلغي السند)
    const serial = await this.entries.reserveSerial(em, year, kind);
    const v = await em.getRepository(Voucher).save(em.create(Voucher, {
      organizationId: org, kind, fiscalYearId: year.id, serial, ...f, status: 'draft', createdById: actor.id, createdByName: actor.fullName,
    }));
    await this.log(em, actor, v, 'create');
    return v;
  }

  /**
   * سند بسطور قيد ثابتة تنشئه وحدة أخرى (الأصول الثابتة): يُتحقق من سطوره بقواعد القيود، ثم يُرسل لمراحل الاعتماد مباشرة
   * إن وُجدت مراحل، وإلا يبقى مسودة يعتمدها صاحب صلاحية اعتماد السندات. لا يُعدَّل من النظام المالي.
   */
  async insertSystemDraft(em: EntityManager, actor: OrgUser, kind: VoucherKind, d: SystemVoucherInput) {
    const org = actor.organizationId;
    const year = await this.core.assertWritable(org, d.voucherDate, em);
    await this.entries.assertNoApprovedInventory(em, year);
    await this.entries.cleanLines(org, kind, d.lines, em, d.method !== 'credit');
    const serial = await this.entries.reserveSerial(em, year, kind);
    const v = await em.getRepository(Voucher).save(em.create(Voucher, {
      organizationId: org, kind, fiscalYearId: year.id, serial, voucherDate: d.voucherDate, partyName: d.partyName, partnerId: d.partnerId,
      amount: fromCents(cents(d.amount)), purpose: d.purpose, sourceType: d.sourceType, sourceRef: d.sourceRef, projectName: null,
      method: d.method, methodRef: null, cashAccountId: d.cashAccountId, counterAccountId: d.counterAccountId, analytic: [],
      customLines: d.lines.map((l) => ({ accountId: l.accountId, debit: l.debit, credit: l.credit, label: l.label ?? null, partnerId: l.partnerId ?? null, analytic: l.analytic ?? [] })),
      status: 'draft', createdById: actor.id, createdByName: actor.fullName,
    }));
    await this.log(em, actor, v, 'create');
    const stages = await this.stages(org, kind, em);
    if (stages.length) {
      await em.getRepository(Voucher).update({ id: v.id }, { status: 'pending', currentStageId: stages[0].id });
      await this.log(em, actor, v, 'submit', null, stages[0].name);
    }
    return em.getRepository(Voucher).findOneOrFail({ where: { id: v.id } });
  }

  async update(actor: OrgUser, id: string, dto: VoucherDto) {
    const org = actor.organizationId;
    await this.db.transaction(async (em) => {
      const v = await this.load(em, org, id);
      this.assertManage(actor, v.kind);
      if (v.status !== 'draft' && v.status !== 'returned') throw new ConflictException('لا يُعدَّل السند إلا وهو مسودة أو معاد للتعديل');
      if (v.sourceType === 'assets') throw new ConflictException('هذا السند صادر من الأصول الثابتة ولا يُعدَّل من النظام المالي. يمكن إرساله للاعتماد أو إلغاؤه');
      const year = await this.core.assertWritable(org, dto.voucherDate, em);
      if (year.id !== v.fiscalYearId) throw new BadRequestException('لا يمكن نقل السند إلى سنة مالية أخرى، لأن رقمه محجوز في سنته');
      const f = await this.fields(em, org, dto);
      await this.buildLines(em, org, v.kind, f);
      await em.getRepository(Voucher).update({ id }, f);
      await this.log(em, actor, v, 'update');
    });
    return this.get(actor, id);
  }

  // ---------------- الاعتماد ----------------

  async submit(actor: OrgUser, id: string) {
    const org = actor.organizationId;
    await this.db.transaction(async (em) => {
      const v = await this.load(em, org, id);
      this.assertManage(actor, v.kind);
      if (v.status !== 'draft' && v.status !== 'returned') throw new ConflictException('السند ليس مسودة');
      await this.core.assertWritable(org, v.voucherDate, em);
      const stages = await this.stages(org, v.kind, em);
      if (!stages.length) {
        if (!actor.permissions.includes(P.approveVouchers)) {
          throw new ForbiddenException('لم تُعرَّف مراحل اعتماد لهذا النوع، واعتماد السند مباشرة يحتاج صلاحية اعتماد السندات');
        }
        await this.log(em, actor, v, 'submit');
        await this.finalize(em, actor, v, null);
        return;
      }
      await em.getRepository(Voucher).update({ id }, { status: 'pending', currentStageId: stages[0].id });
      await this.log(em, actor, v, 'submit', null, stages[0].name);
    });
    return this.get(actor, id);
  }

  async decide(actor: OrgUser, id: string, dto: VoucherDecisionDto) {
    const org = actor.organizationId;
    await this.db.transaction(async (em) => {
      const v = await this.load(em, org, id);
      if (v.status !== 'pending') throw new ConflictException('السند لا ينتظر قرارًا');
      const stages = await this.stages(org, v.kind, em);
      const idx = stages.findIndex((s) => s.id === v.currentStageId);
      const stage = stages[idx];
      if (!this.canDecideStage(actor, stage, await this.roleIds(actor))) throw new ForbiddenException('القرار في هذه المرحلة ليس من صلاحيتك');
      if (dto.decision !== 'approve' && !dto.note) throw new BadRequestException(dto.decision === 'reject' ? 'اكتب سبب الرفض' : 'اكتب سبب الإرجاع');
      const repo = em.getRepository(Voucher);
      if (dto.decision === 'reject') {
        await repo.update({ id }, { status: 'rejected', currentStageId: null });
        await this.log(em, actor, v, 'reject', dto.note ?? null, stage?.name ?? null);
        await this.notify(em, id);
      } else if (dto.decision === 'return') {
        await repo.update({ id }, { status: 'returned', currentStageId: null });
        await this.log(em, actor, v, 'return', dto.note ?? null, stage?.name ?? null);
        await this.notify(em, id);
      } else if (idx >= 0 && idx < stages.length - 1) {
        await repo.update({ id }, { currentStageId: stages[idx + 1].id });
        await this.log(em, actor, v, 'approve', dto.note ?? null, stage.name);
      } else {
        await this.log(em, actor, v, 'approve', dto.note ?? null, stage?.name ?? null);
        await this.finalize(em, actor, v, stage?.name ?? null);
      }
    });
    return this.get(actor, id);
  }

  /** الاعتماد النهائي: قيد يومية مرحّل برقم السند */
  private async finalize(em: EntityManager, actor: OrgUser, v: Voucher, stageName: string | null) {
    const year = await this.core.assertWritable(v.organizationId, v.voucherDate, em);
    const lines: LineDto[] = v.customLines
      ? v.customLines.map((l) => ({ accountId: l.accountId, debit: l.debit, credit: l.credit, label: l.label ?? undefined, partnerId: l.partnerId ?? undefined, analytic: l.analytic ?? [] }))
      : await this.buildLines(em, v.organizationId, v.kind, { ...v, cashAccountId: v.cashAccountId ?? '' });
    const entry = await this.entries.createVoucherEntry(em, actor, year, v.kind, { id: v.id, serial: v.serial }, {
      documentDate: v.voucherDate, description: `${VOUCHER_LABEL[v.kind]} رقم ${v.serial}: ${v.purpose}`, counterparty: v.partyName,
    }, lines, v.method !== 'credit');
    await em.getRepository(Voucher).update({ id: v.id }, { status: 'approved', currentStageId: null, entryId: entry.id, approvedAt: new Date() });
    await this.log(em, actor, v, 'final', `القيد رقم ${entry.entryNo}`, stageName);
    await this.notify(em, v.id);
  }

  // ---------------- الإعادة للمسودة والإلغاء ----------------

  async request(actor: OrgUser, id: string, dto: VoucherRequestDto) {
    const org = actor.organizationId;
    await this.db.transaction(async (em) => {
      const v = await this.load(em, org, id);
      // سند لم يُعتمد بعد: يُلغى مباشرة (لا قيد له)، ويبقى رقمه ملغيًا
      if (v.status === 'draft' || v.status === 'returned') {
        this.assertManage(actor, v.kind);
        if (dto.kind !== 'cancel') throw new ConflictException('السند مسودة بالفعل');
        await em.getRepository(Voucher).update({ id }, { status: 'cancelled' });
        await this.log(em, actor, v, 'cancel', dto.reason);
        await this.notify(em, id);
        return;
      }
      if (v.status !== 'approved') throw new ConflictException('لا يُعاد للمسودة أو يُلغى إلا السند المعتمد أو المسودة');
      if (v.requestKind) throw new ConflictException('على السند طلب معلق بالفعل');
      await this.core.assertWritable(org, v.voucherDate, em);
      await this.guards.get(v.sourceType)?.(em, v);
      if (v.kind === 'payment') {
        const stages = await this.stages(org, v.kind, em);
        if (!this.isFinalApprover(actor, stages, await this.roleIds(actor))) {
          throw new ForbiddenException('سند الصرف لا يعيده للمسودة أو يلغيه إلا المعتمد النهائي');
        }
        await this.execute(em, actor, v, dto.kind, dto.reason);
        return;
      }
      // سند القبض: طلب يحتاج اعتمادًا ثانيًا من مستخدم آخر
      if (!actor.permissions.includes(P.cancel)) throw new ForbiddenException('ليست لديك صلاحية طلب إلغاء سندات القبض');
      await em.getRepository(Voucher).update({ id }, {
        requestKind: dto.kind, requestById: actor.id, requestByName: actor.fullName, requestReason: dto.reason, requestAt: new Date(),
      });
      await this.log(em, actor, v, dto.kind === 'draft' ? 'request_draft' : 'request_cancel', dto.reason);
    });
    return this.get(actor, id);
  }

  async decideRequest(actor: OrgUser, id: string, dto: RequestDecisionDto) {
    const org = actor.organizationId;
    await this.db.transaction(async (em) => {
      const v = await this.load(em, org, id);
      if (!v.requestKind) throw new ConflictException('لا يوجد طلب معلق على السند');
      if (!actor.permissions.includes(P.approveReceiptCancel)) throw new ForbiddenException('ليست لديك صلاحية الاعتماد الثاني لإلغاء سندات القبض');
      if (v.requestById === actor.id) throw new ForbiddenException('الاعتماد الثاني يكون من مستخدم غير صاحب الطلب');
      if (dto.decision === 'reject') {
        await em.getRepository(Voucher).update({ id }, { requestKind: null, requestById: null, requestByName: null, requestReason: null, requestAt: null });
        await this.log(em, actor, v, 'request_rejected', dto.note ?? null);
        return;
      }
      const reason = `${v.requestReason ?? ''} (طلب ${v.requestByName}، واعتمد ${actor.fullName})`;
      await this.execute(em, actor, v, v.requestKind, reason);
    });
    return this.get(actor, id);
  }

  /** عكس القيد (يبقى رقمه ويظهر ملغيًا) ثم إعادة السند للمسودة أو إلغاؤه */
  private async execute(em: EntityManager, actor: OrgUser, v: Voucher, kind: 'draft' | 'cancel', reason: string) {
    await this.guards.get(v.sourceType)?.(em, v);
    if (v.entryId) await this.entries.reverseVoucherEntry(em, actor, v.entryId, `إلغاء سند: ${VOUCHER_LABEL[v.kind]} رقم ${v.serial}. ${reason}`);
    await em.getRepository(Voucher).update({ id: v.id }, {
      status: kind === 'draft' ? 'draft' : 'cancelled', entryId: null, currentStageId: null, approvedAt: null,
      requestKind: null, requestById: null, requestByName: null, requestReason: null, requestAt: null,
    });
    await this.log(em, actor, v, kind === 'draft' ? 'to_draft' : 'cancel', reason);
    await this.notify(em, v.id);
  }
}
