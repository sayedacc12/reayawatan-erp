import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { OrgUser } from '../../core/auth/decorators';
import { DocumentStorage } from '../beneficiaries/document-storage.service';
import {
  ApprovalStage, BankAccount, Batch, BatchTarget, Donor, DonorConditions, LedgerEntry, Opportunity, OpportunityAction, OpportunityActionType,
  OpportunityDocument, PledgeCollection, SupportManager, WaqfProject,
} from './entities';
import { FUNDRAISING_PERMISSIONS as P } from './fundraising.manifest';
import { LedgerService } from './ledger.service';
import { CollectDto, ConditionsDto, DecisionDto, LineDto, ListBatchesQuery, ListOpportunitiesQuery, OpportunityDto } from './opportunities.dto';
import { FundraisingSettingsService } from './settings.service';

export interface Actor { organizationId: string; userId: string | null; name: string }
const actorOf = (u: OrgUser): Actor => ({ organizationId: u.organizationId, userId: u.id, name: u.fullName });

const r2 = (n: number) => Math.round(n * 100) / 100;
const net = (b: Pick<Batch, 'amount' | 'reservedAmount' | 'spentAmount' | 'transferredAmount'>) =>
  r2(b.amount - b.reservedAmount - b.spentAmount - b.transferredAmount);

/** صف من شجرة الأنشطة مع خصائص التمويل (الأعمدة يملكها نظام إدارة المشاريع) */
interface FundableActivity {
  id: string; level: 'axis' | 'program' | 'project'; parentId: string | null; name: string; isActive: boolean;
  fundingType: 'restricted' | 'unrestricted' | 'operational'; zakatEligible: boolean; approvalStatus: string;
}

/** صف دفعة كما تعيده listBatches (المبالغ أرقام) */
export interface BatchRow {
  id: string; batchNo: number; opportunityId: string; opportunityNo: number; opportunityKind: string; donorId: string; donorName: string;
  targetKind: BatchTarget; targetName: string; activityId: string | null; waqfProjectId: string | null; beneficiaryRequestId: string | null;
  allocationMode: 'amount' | 'percent'; percent: number | null; amount: number; isZakat: boolean; isPromised: boolean; conditions: DonorConditions;
  status: string; reservedAmount: number; spentAmount: number; transferredAmount: number; net: number; parentBatchId: string | null; createdAt: Date;
}

interface ResolvedLine { line: LineDto; amount: number; percent: number | null; activityId: string | null; waqfProjectId: string | null; requestId: string | null; targetName: string }

export interface AmendInput {
  conditions?: Partial<DonorConditions>;
  conditionsText?: string | null;
  /** تغيير مبالغ دفعات قائمة (موجب = زيادة، سالب = تخفيض بما لا يتجاوز صافي الدفعة) */
  batchDeltas?: { batchId: string; delta: number }[];
  effectiveDate?: string;
  notes?: string | null;
  actorName?: string;
}

/**
 * فرص التبرع ودفعاتها: التسجيل والتوزيع والتحقق من الاشتراطات، مراحل الاعتماد، القيود،
 * سداد الوعود، والمستندات. ويصدّر لنظام إدارة المشاريع: الحجز والصرف والمناقلة والتعديل.
 */
@Injectable()
export class FundraisingService {
  constructor(
    private readonly db: DataSource,
    private readonly ledger: LedgerService,
    private readonly settings: FundraisingSettingsService,
    private readonly storage: DocumentStorage,
  ) {}

  // ================= جهات التوزيع =================

  private async activities(q: EntityManager | DataSource, orgId: string): Promise<FundableActivity[]> {
    return q.query(
      `SELECT id, level, parent_id AS "parentId", name, is_active AS "isActive", funding_type AS "fundingType",
              zakat_eligible AS "zakatEligible", approval_status AS "approvalStatus"
         FROM activities WHERE organization_id = $1 ORDER BY sort_order, created_at`,
      [orgId],
    );
  }

  private pathOf(all: FundableActivity[], a: FundableActivity) {
    const names = [a.name];
    let p = all.find((x) => x.id === a.parentId);
    while (p) {
      names.unshift(p.name);
      p = all.find((x) => x.id === p!.parentId);
    }
    return names.join(' ← ');
  }

  /** الجهات المتاحة لتوزيع التبرع: البرامج والمشاريع المعتمدة، التشغيلية، الأوقاف، وطلبات المستفيدين */
  async targets(actor: OrgUser) {
    const org = actor.organizationId;
    const [acts, waqf, cases] = await Promise.all([
      this.activities(this.db, org),
      this.db.getRepository(WaqfProject).find({ where: { organizationId: org, isActive: true }, order: { createdAt: 'ASC' } }),
      this.db.query(
        `SELECT r.id, r.request_no AS "requestNo", r.status, r.services, r.estimated_cost::float AS "estimatedCost",
                b.full_name AS "beneficiaryName", b.file_no AS "fileNo", a.id AS "projectId", a.name AS "projectName",
                a.zakat_eligible AS "zakatEligible",
                COALESCE((SELECT SUM(x.amount) FROM fundraising_batches x WHERE x.beneficiary_request_id = r.id AND x.status <> 'cancelled'), 0)::float AS "funded"
           FROM beneficiary_requests r
           JOIN beneficiaries b ON b.id = r.beneficiary_id
           JOIN activities a ON a.id = r.project_id
          WHERE r.organization_id = $1 AND r.status IN ('in_progress', 'approved')
          ORDER BY r.request_no DESC LIMIT 300`,
        [org],
      ),
    ]);
    const usable = acts.filter((a) => a.isActive && a.approvalStatus === 'approved' && a.level !== 'axis');
    const row = (a: FundableActivity) => ({ id: a.id, level: a.level, name: a.name, path: this.pathOf(acts, a), zakatEligible: a.zakatEligible && a.level === 'project' });
    return {
      programs: usable.filter((a) => a.fundingType === 'restricted').map(row),
      operational: usable.filter((a) => a.fundingType === 'operational').map(row),
      waqf: waqf.map((w) => ({ id: w.id, name: w.name, description: w.description, targetAmount: w.targetAmount })),
      cases,
    };
  }

  /** يحسب مبلغ كل بند ويتحقق من الجهة المستهدفة ومن قيود الزكاة وتطابق الإجمالي */
  private async resolveLines(em: EntityManager, orgId: string, dto: OpportunityDto): Promise<ResolvedLine[]> {
    const total = r2(dto.totalAmount);
    const acts = await this.activities(em, orgId);
    const zakat = !!dto.isZakat;
    const out: ResolvedLine[] = [];
    for (const [i, line] of dto.lines.entries()) {
      const n = i + 1;
      let amount: number;
      let percent: number | null = null;
      if (line.mode === 'percent') {
        if (!line.percent || line.percent <= 0) throw new BadRequestException(`البند رقم ${n}: حدّد النسبة`);
        percent = Math.round(line.percent * 10000) / 10000;
        amount = r2((total * percent) / 100);
      } else {
        if (!line.amount || line.amount <= 0) throw new BadRequestException(`البند رقم ${n}: حدّد المبلغ`);
        amount = r2(line.amount);
      }
      const base = { line, amount, percent, activityId: null as string | null, waqfProjectId: null as string | null, requestId: null as string | null };
      const act = (id?: string | null) => (id ? acts.find((a) => a.id === id) : undefined);
      switch (line.targetKind) {
        case 'operational': {
          if (zakat) throw new BadRequestException('تبرع الزكاة لا يُوجَّه إلى التبرعات التشغيلية');
          if (line.activityId) {
            const a = act(line.activityId);
            if (!a || !a.isActive || a.approvalStatus !== 'approved' || a.fundingType !== 'operational') {
              throw new BadRequestException(`البند رقم ${n}: المشروع المختار ليس مشروعًا تشغيليًا معتمدًا`);
            }
            out.push({ ...base, activityId: a.id, targetName: this.pathOf(acts, a) });
          } else out.push({ ...base, targetName: 'التبرعات التشغيلية العامة' });
          break;
        }
        case 'program': {
          const a = act(line.activityId);
          if (!a) throw new BadRequestException(`البند رقم ${n}: اختر البرنامج أو المشروع`);
          if (!a.isActive || a.approvalStatus !== 'approved' || a.level === 'axis' || a.fundingType !== 'restricted') {
            throw new BadRequestException(`البند رقم ${n}: "${a.name}" ليس برنامجًا أو مشروعًا مقيدًا معتمدًا`);
          }
          if (zakat && !(a.level === 'project' && a.zakatEligible)) {
            throw new BadRequestException(`البند رقم ${n}: "${a.name}" ليس من المشاريع المعتمدة ضمن مصارف الزكاة`);
          }
          out.push({ ...base, activityId: a.id, targetName: this.pathOf(acts, a) });
          break;
        }
        case 'waqf': {
          if (zakat) throw new BadRequestException('تبرع الزكاة لا يُوجَّه إلى مشاريع الأوقاف');
          const w = line.waqfProjectId ? await em.findOne(WaqfProject, { where: { id: line.waqfProjectId, organizationId: orgId } }) : null;
          if (!w || !w.isActive) throw new BadRequestException(`البند رقم ${n}: اختر مشروع الوقف`);
          out.push({ ...base, waqfProjectId: w.id, targetName: `وقف: ${w.name}` });
          break;
        }
        case 'case': {
          if (!line.beneficiaryRequestId) throw new BadRequestException(`البند رقم ${n}: اختر طلب المستفيد`);
          const [r] = await em.query(
            `SELECT r.id, r.request_no AS "requestNo", r.status, r.project_id AS "projectId", b.full_name AS "name"
               FROM beneficiary_requests r JOIN beneficiaries b ON b.id = r.beneficiary_id
              WHERE r.id = $1 AND r.organization_id = $2`,
            [line.beneficiaryRequestId, orgId],
          );
          if (!r) throw new BadRequestException(`البند رقم ${n}: الطلب غير موجود`);
          if (!['in_progress', 'approved'].includes(r.status)) throw new BadRequestException(`البند رقم ${n}: الطلب رقم ${r.requestNo} مغلق ولا يقبل الدعم`);
          const p = act(r.projectId);
          if (zakat && !p?.zakatEligible) throw new BadRequestException(`البند رقم ${n}: مشروع الطلب رقم ${r.requestNo} ليس ضمن مصارف الزكاة`);
          out.push({ ...base, activityId: r.projectId, requestId: r.id, targetName: `حالة: ${r.name} (طلب ${r.requestNo}${p ? ` · ${p.name}` : ''})` });
          break;
        }
      }
    }
    // التقريب في النسب: لو مجموع النسب 100% يمتص آخر بند نسبة فرق الهللات
    const sumPct = out.reduce((s, l) => s + (l.percent ?? 0), 0);
    if (out.every((l) => l.percent !== null) && Math.abs(sumPct - 100) < 0.0001) {
      const diff = r2(total - out.reduce((s, l) => s + l.amount, 0));
      out[out.length - 1].amount = r2(out[out.length - 1].amount + diff);
    }
    const sum = r2(out.reduce((s, l) => s + l.amount, 0));
    if (sum !== total) {
      throw new BadRequestException(`مجموع بنود التوزيع (${sum.toLocaleString('en-US')} ريال) يجب أن يساوي إجمالي التبرع (${total.toLocaleString('en-US')} ريال)`);
    }
    return out;
  }

  private conditions(c?: ConditionsDto | Partial<DonorConditions>, prev?: DonorConditions): DonorConditions {
    const base: DonorConditions = prev ?? { acceptsPatientContribution: false, maxSpend: null, nationalities: [], categories: [], endDate: null };
    if (!c) return base;
    return {
      acceptsPatientContribution: c.acceptsPatientContribution ?? base.acceptsPatientContribution,
      maxSpend: c.maxSpend === undefined ? base.maxSpend : c.maxSpend === null ? null : r2(c.maxSpend),
      nationalities: c.nationalities ? [...new Set(c.nationalities.map((x) => x.trim()).filter(Boolean))].map((x) => x.slice(0, 60)) : base.nationalities,
      categories: c.categories ? [...new Set(c.categories)] : base.categories,
      endDate: c.endDate === undefined ? base.endDate : c.endDate ? c.endDate.slice(0, 10) : null,
    };
  }

  private async checkHeader(em: EntityManager, orgId: string, dto: OpportunityDto) {
    const donor = await em.findOne(Donor, { where: { id: dto.donorId, organizationId: orgId } });
    if (!donor) throw new BadRequestException('الداعم غير موجود');
    if (!donor.isActive) throw new BadRequestException('الداعم موقوف، فعّله أولًا من سجل الداعمين');
    if (dto.supportManagerId && !(await em.exists(SupportManager, { where: { id: dto.supportManagerId, organizationId: orgId } }))) {
      throw new BadRequestException('مدير الدعم غير موجود');
    }
    if (dto.kind === 'cash') {
      if (!dto.bankAccountId) throw new BadRequestException('اختر الحساب البنكي الذي حُوِّل إليه التبرع');
    }
    if (dto.bankAccountId) {
      const bank = await em.findOne(BankAccount, { where: { id: dto.bankAccountId, organizationId: orgId } });
      if (!bank || !bank.isActive) throw new BadRequestException('الحساب البنكي غير موجود أو موقوف');
    }
    if (dto.kind === 'in_kind' && !dto.inKindDescription) throw new BadRequestException('اكتب وصف التبرع العيني (الأصناف والكميات)');
    if (dto.conditions?.endDate && dto.conditions.endDate.slice(0, 10) < dto.date.slice(0, 10)) {
      throw new BadRequestException('تاريخ انتهاء المشروع يجب أن يكون بعد تاريخ الفرصة');
    }
    return donor;
  }

  private async nextNo(em: EntityManager, table: string, column: string, orgId: string) {
    await em.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`${table}:${orgId}`]);
    const [{ next }] = await em.query(`SELECT COALESCE(MAX(${column}), 0) + 1 AS next FROM ${table} WHERE organization_id = $1`, [orgId]);
    return Number(next);
  }

  /** رقم سند القبض: تسلسل واحد للفرص النقدية وسداد الوعود */
  private async nextReceipt(em: EntityManager, orgId: string) {
    await em.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`receipts:${orgId}`]);
    const [{ next }] = await em.query(
      `SELECT GREATEST(
         COALESCE((SELECT MAX(receipt_no) FROM fundraising_opportunities WHERE organization_id = $1), 0),
         COALESCE((SELECT MAX(receipt_no) FROM fundraising_pledge_collections WHERE organization_id = $1), 0)) + 1 AS next`,
      [orgId],
    );
    return Number(next);
  }

  private async writeBatches(em: EntityManager, o: Opportunity, lines: ResolvedLine[]) {
    let no = await this.nextNo(em, 'fundraising_batches', 'batch_no', o.organizationId);
    const rows = lines.map((l, i) => em.create(Batch, {
      organizationId: o.organizationId, batchNo: no++, opportunityId: o.id, lineNo: i + 1, donorId: o.donorId,
      targetKind: l.line.targetKind as BatchTarget, activityId: l.activityId, waqfProjectId: l.waqfProjectId, beneficiaryRequestId: l.requestId,
      targetName: l.targetName.slice(0, 300), allocationMode: l.line.mode, percent: l.percent, amount: l.amount,
      isZakat: o.isZakat, isPromised: o.kind === 'pledge', conditions: o.conditions, status: 'pending',
      reservedAmount: 0, spentAmount: 0, transferredAmount: 0, parentBatchId: null,
    }));
    await em.save(rows);
  }

  // ================= التسجيل والتعديل =================

  async create(user: OrgUser, dto: OpportunityDto) {
    const actor = actorOf(user);
    const id = await this.db.transaction(async (em) => {
      const org = user.organizationId;
      await this.checkHeader(em, org, dto);
      const lines = await this.resolveLines(em, org, dto);
      const stages = await em.find(ApprovalStage, { where: { organizationId: org }, order: { sortOrder: 'ASC' } });
      const o = await em.save(em.create(Opportunity, {
        organizationId: org, opportunityNo: await this.nextNo(em, 'fundraising_opportunities', 'opportunity_no', org),
        kind: dto.kind, status: 'in_progress', currentStageId: stages[0]?.id ?? null, donorId: dto.donorId,
        supportManagerId: dto.supportManagerId ?? null, date: dto.date.slice(0, 10), totalAmount: r2(dto.totalAmount),
        bankAccountId: dto.bankAccountId ?? null, transferReference: dto.transferReference ?? null, isZakat: !!dto.isZakat,
        conditions: this.conditions(dto.conditions), conditionsText: dto.conditionsText ?? null,
        inKindDescription: dto.kind === 'in_kind' ? dto.inKindDescription ?? null : null,
        collectedAmount: 0, createdBy: user.id, createdByName: user.fullName,
      }));
      await this.writeBatches(em, o, lines);
      await this.log(em, actor, o.id, 'created', stages[0]?.name ?? null, null);
      if (!stages.length) await this.finalize(em, actor, o);
      return o.id;
    });
    return this.get(user, id);
  }

  /**
   * تعديل الفرصة: متاح قبل أول قرار موافقة، أو بعد إعادتها لمُنشئها.
   * الدفعات تُولَّد من جديد بأرقام جديدة، والفرصة المعادة تُقدَّم مرة أخرى لأول مرحلة.
   */
  async update(user: OrgUser, id: string, dto: OpportunityDto) {
    const actor = actorOf(user);
    await this.db.transaction(async (em) => {
      const o = await this.lock(em, user.organizationId, id);
      const approvedOnce = await em.exists(OpportunityAction, { where: { opportunityId: id, action: 'approve' } });
      const editable = o.status === 'returned' || (o.status === 'in_progress' && !approvedOnce);
      if (!editable) throw new BadRequestException('لا يمكن تعديل الفرصة بعد بدء اعتمادها. اطلب إعادتها للتعديل من المرحلة الحالية');
      await this.checkHeader(em, o.organizationId, dto);
      const lines = await this.resolveLines(em, o.organizationId, dto);
      Object.assign(o, {
        kind: dto.kind, donorId: dto.donorId, supportManagerId: dto.supportManagerId ?? null, date: dto.date.slice(0, 10),
        totalAmount: r2(dto.totalAmount), bankAccountId: dto.bankAccountId ?? null, transferReference: dto.transferReference ?? null,
        isZakat: !!dto.isZakat, conditions: this.conditions(dto.conditions), conditionsText: dto.conditionsText ?? null,
        inKindDescription: dto.kind === 'in_kind' ? dto.inKindDescription ?? null : null,
      });
      await em.delete(Batch, { opportunityId: o.id });
      await this.writeBatches(em, o, lines);
      if (o.status === 'returned') {
        const stages = await em.find(ApprovalStage, { where: { organizationId: o.organizationId }, order: { sortOrder: 'ASC' } });
        Object.assign(o, { status: 'in_progress', currentStageId: stages[0]?.id ?? null });
        await em.save(o);
        await this.log(em, actor, o.id, 'resubmitted', stages[0]?.name ?? null, null);
        if (!stages.length) await this.finalize(em, actor, o);
      } else {
        await em.save(o);
        await this.log(em, actor, o.id, 'edited', null, null);
      }
    });
    return this.get(user, id);
  }

  // ================= الاعتماد =================

  async canDecide(user: OrgUser, stageId: string | null) {
    if (!stageId || !user.permissions.includes(P.process)) return false;
    const stage = await this.db.getRepository(ApprovalStage).findOne({ where: { id: stageId, organizationId: user.organizationId } });
    if (!stage) return false;
    if (!stage.roleId || user.isSuperadmin) return true;
    const [row] = await this.db.query('SELECT 1 FROM user_roles WHERE user_id = $1 AND role_id = $2', [user.id, stage.roleId]);
    return !!row;
  }

  async decide(user: OrgUser, id: string, dto: DecisionDto) {
    const actor = actorOf(user);
    await this.db.transaction(async (em) => {
      const o = await this.lock(em, user.organizationId, id);
      if (o.status !== 'in_progress' || !o.currentStageId) throw new BadRequestException('الفرصة ليست في مرحلة تنتظر قرارًا');
      if (!(await this.canDecide(user, o.currentStageId))) throw new ForbiddenException('القرار في هذه المرحلة لمسؤول آخر');
      const stages = await em.find(ApprovalStage, { where: { organizationId: o.organizationId }, order: { sortOrder: 'ASC' } });
      const idx = stages.findIndex((s) => s.id === o.currentStageId);
      const stage = stages[idx];
      if (dto.decision === 'approve') {
        await this.log(em, actor, o.id, 'approve', stage.name, dto.notes ?? null);
        const next = stages[idx + 1];
        if (next) {
          o.currentStageId = next.id;
          await em.save(o);
        } else await this.finalize(em, actor, o);
        return;
      }
      if (!dto.notes) throw new BadRequestException(dto.decision === 'reject' ? 'اكتب سبب الرفض' : 'اكتب سبب طلب التعديل');
      if (dto.decision === 'reject') {
        if (!stage.canReject) throw new BadRequestException('هذه المرحلة لا تسمح بالرفض');
        Object.assign(o, { status: 'rejected', currentStageId: null, closedAt: new Date() });
        await em.update(Batch, { opportunityId: o.id }, { status: 'cancelled' });
      } else {
        if (!stage.canReturn) throw new BadRequestException('هذه المرحلة لا تسمح بطلب التعديل');
        if (idx > 0) o.currentStageId = stages[idx - 1].id;
        else Object.assign(o, { status: 'returned', currentStageId: null });
      }
      await em.save(o);
      await this.log(em, actor, o.id, dto.decision, stage.name, dto.notes);
    });
    return this.get(user, id);
  }

  /** الاعتماد النهائي: تفعيل الدفعات، رقم سند القبض للنقدية، وقيد الإثبات */
  private async finalize(em: EntityManager, actor: Actor, o: Opportunity) {
    const org = o.organizationId;
    const batches = await em.find(Batch, { where: { opportunityId: o.id }, order: { lineNo: 'ASC' } });
    const routing = (await this.settings.general(org, em)).journalRouting;
    let debit: { code: string | null; name: string };
    let description: string | null;
    if (o.kind === 'cash') {
      const bank = await em.findOneOrFail(BankAccount, { where: { id: o.bankAccountId!, organizationId: org } });
      debit = { code: bank.glCode, name: bank.glName ?? `البنك - ${bank.bankName} (${bank.accountNumber})` };
      description = routing.cash.description;
      o.receiptNo = await this.nextReceipt(em, org);
    } else if (o.kind === 'in_kind') {
      debit = { code: routing.inKind.debit.code, name: routing.inKind.debit.name ?? 'مخزون التبرعات العينية' };
      description = routing.inKind.description;
    } else {
      debit = { code: routing.pledge.debit.code, name: routing.pledge.debit.name ?? 'ذمم الداعمين - وعود بالدفع' };
      description = routing.pledge.description;
    }
    const donor = await em.findOneOrFail(Donor, { where: { id: o.donorId } });
    const creditOf = (b: Batch) => {
      const c = o.isZakat ? routing.credit.zakat : routing.credit[b.targetKind === 'program' ? 'restricted' : b.targetKind];
      return { code: c.code, name: c.name ?? 'إيرادات التبرعات' };
    };
    const entry = await this.ledger.postEntry(org, {
      date: o.date,
      description: `${description ?? 'إثبات فرصة تبرع'} - فرصة رقم ${o.opportunityNo} - ${donor.name}`,
      source: { module: 'fundraising', type: `opportunity_${o.kind}`, id: o.id },
      opportunityId: o.id, createdByName: actor.name,
      lines: [
        { accountCode: debit.code, accountName: debit.name, debit: o.totalAmount, credit: 0, memo: `فرصة رقم ${o.opportunityNo}` },
        ...batches.map((b) => ({
          accountCode: creditOf(b).code, accountName: creditOf(b).name, debit: 0, credit: b.amount,
          memo: `دفعة رقم ${b.batchNo} - ${b.targetName}`, batchId: b.id, activityId: b.activityId,
        })),
      ],
    }, em);
    Object.assign(o, { status: 'approved', currentStageId: null, approvedAt: new Date(), journalEntryId: entry.id });
    await em.save(o);
    await em.update(Batch, { opportunityId: o.id }, { status: 'active' });
    await this.log(em, actor, o.id, 'approved_final', null, `قيد رقم ${entry.entryNo}${o.receiptNo ? ` · سند قبض رقم ${o.receiptNo}` : ''}`);
  }

  // ================= سداد الوعد بالدفع =================

  async collect(user: OrgUser, id: string, dto: CollectDto) {
    const actor = actorOf(user);
    await this.db.transaction(async (em) => {
      const o = await this.lock(em, user.organizationId, id);
      if (o.kind !== 'pledge' || o.status !== 'approved') throw new BadRequestException('السداد متاح للوعود بالدفع المعتمدة فقط');
      const outstanding = r2(o.totalAmount - o.collectedAmount);
      const amount = r2(dto.amount);
      if (amount > outstanding) throw new BadRequestException(`المبلغ أكبر من المتبقي على الوعد (${outstanding.toLocaleString('en-US')} ريال)`);
      const bank = await em.findOne(BankAccount, { where: { id: dto.bankAccountId, organizationId: o.organizationId } });
      if (!bank || !bank.isActive) throw new BadRequestException('الحساب البنكي غير موجود أو موقوف');
      const routing = (await this.settings.general(o.organizationId, em)).journalRouting;
      const receiptNo = await this.nextReceipt(em, o.organizationId);
      const donor = await em.findOneOrFail(Donor, { where: { id: o.donorId } });
      const entry = await this.ledger.postEntry(o.organizationId, {
        date: dto.date.slice(0, 10),
        description: `${routing.pledgeCollection.description ?? 'تحصيل وعد بالدفع'} - فرصة رقم ${o.opportunityNo} - ${donor.name} - سند قبض ${receiptNo}`,
        source: { module: 'fundraising', type: 'pledge_collection', id: o.id }, opportunityId: o.id, createdByName: actor.name,
        lines: [
          { accountCode: bank.glCode, accountName: bank.glName ?? `البنك - ${bank.bankName} (${bank.accountNumber})`, debit: amount, credit: 0 },
          { accountCode: routing.pledge.debit.code, accountName: routing.pledge.debit.name ?? 'ذمم الداعمين - وعود بالدفع', debit: 0, credit: amount },
        ],
      }, em);
      await em.save(em.create(PledgeCollection, {
        organizationId: o.organizationId, opportunityId: o.id, collectedOn: dto.date.slice(0, 10), amount, bankAccountId: bank.id,
        transferReference: dto.transferReference ?? null, receiptNo, journalEntryId: entry.id, createdByName: actor.name,
      }));
      o.collectedAmount = r2(o.collectedAmount + amount);
      await em.save(o);
      if (o.collectedAmount >= o.totalAmount) await em.update(Batch, { opportunityId: o.id }, { isPromised: false });
      await this.log(em, actor, o.id, 'collected', null, `سداد ${amount.toLocaleString('en-US')} ريال · سند قبض رقم ${receiptNo} · قيد رقم ${entry.entryNo}`);
    });
    return this.get(user, id);
  }

  // ================= العرض =================

  async list(user: OrgUser, q: ListOpportunitiesQuery) {
    const page = q.page ?? 1;
    const size = q.pageSize ?? 25;
    const conds = ['o.organization_id = $1'];
    const params: unknown[] = [user.organizationId];
    const add = (sql: string, v: unknown) => {
      params.push(v);
      conds.push(sql.split('?').join(`$${params.length}`));
    };
    const term = q.search?.trim();
    if (term) {
      if (/^\d{1,9}$/.test(term)) add('(o.opportunity_no = ? OR o.receipt_no = ?)', Number(term));
      else add('d.name ILIKE ?', `%${term}%`);
    }
    if (q.status) add('o.status = ?', q.status);
    if (q.kind) add('o.kind = ?', q.kind);
    if (q.donorId) add('o.donor_id = ?', q.donorId);
    if (q.zakat) add('o.is_zakat = ?', q.zakat === 'true');
    if (q.from) add('o.opportunity_date >= ?', q.from.slice(0, 10));
    if (q.to) add('o.opportunity_date <= ?', q.to.slice(0, 10));
    if (q.mine) {
      // الفرص التي تنتظر قرار المستخدم الحالي
      params.push(user.id);
      conds.push(`o.status = 'in_progress' AND (s.role_id IS NULL OR ${user.isSuperadmin ? 'true' : `s.role_id IN (SELECT role_id FROM user_roles WHERE user_id = $${params.length})`})`);
    }
    const where = conds.join(' AND ');
    const from = `FROM fundraising_opportunities o JOIN fundraising_donors d ON d.id = o.donor_id
                  LEFT JOIN fundraising_approval_stages s ON s.id = o.current_stage_id`;
    const [[agg], items] = await Promise.all([
      this.db.query(`SELECT COUNT(*)::int AS total, COALESCE(SUM(o.total_amount), 0)::float AS amount ${from} WHERE ${where}`, params),
      this.db.query(
        `SELECT o.id, o.opportunity_no AS "opportunityNo", o.kind, o.status, o.opportunity_date AS date, o.total_amount::float AS "totalAmount",
                o.collected_amount::float AS "collectedAmount", o.is_zakat AS "isZakat", o.receipt_no AS "receiptNo",
                d.id AS "donorId", d.name AS "donorName", s.name AS "stageName",
                (SELECT COUNT(*)::int FROM fundraising_batches b WHERE b.opportunity_id = o.id) AS "batchCount",
                (SELECT string_agg(DISTINCT b.target_kind, ',') FROM fundraising_batches b WHERE b.opportunity_id = o.id) AS "targetKinds"
           ${from} WHERE ${where}
          ORDER BY o.opportunity_no DESC LIMIT ${size} OFFSET ${(page - 1) * size}`,
        params,
      ),
    ]);
    return { items, total: agg.total, amount: agg.amount, page, pageSize: size };
  }

  async get(user: OrgUser, id: string) {
    const o = await this.getOpportunity(user.organizationId, id);
    return { ...o, canDecide: o.status === 'in_progress' && (await this.canDecide(user, o.currentStageId)) };
  }

  /** الفرصة كاملة: الداعم، الدفعات، المراحل، سجل الأنشطة، المستندات، السداد، والقيود (مصدّرة لنظام المشاريع) */
  async getOpportunity(orgId: string, id: string, m?: EntityManager) {
    const em = m ?? this.db.manager;
    const o = await em.findOne(Opportunity, {
      where: { id, organizationId: orgId },
      relations: { donor: { level: true }, bankAccount: true, supportManager: true, currentStage: true },
    });
    if (!o) throw new NotFoundException('الفرصة غير موجودة');
    const [batches, actions, documents, collections, stages, entries] = await Promise.all([
      em.find(Batch, { where: { opportunityId: id }, order: { lineNo: 'ASC' } }),
      em.find(OpportunityAction, { where: { opportunityId: id }, order: { createdAt: 'ASC' } }),
      em.find(OpportunityDocument, { where: { opportunityId: id }, order: { createdAt: 'ASC' } }),
      em.find(PledgeCollection, { where: { opportunityId: id }, relations: { bankAccount: true }, order: { createdAt: 'ASC' } }),
      this.settings.listStages(orgId, em),
      this.ledger.listEntries(orgId, { opportunityId: id }),
    ]);
    const { donor, bankAccount, supportManager, currentStage, ...rest } = o;
    return {
      ...rest,
      donor: donor ? { id: donor.id, donorNo: donor.donorNo, name: donor.name, phone: donor.phone, email: donor.email, identifier: donor.identifier, levelName: donor.level?.name ?? null, levelColor: donor.level?.color ?? null } : null,
      bankAccount: bankAccount ? { id: bankAccount.id, bankName: bankAccount.bankName, accountNumber: bankAccount.accountNumber, iban: bankAccount.iban } : null,
      supportManagerName: supportManager?.name ?? null,
      stageName: currentStage?.name ?? null,
      batches: batches.map((b) => ({ ...b, net: net(b) })),
      actions, documents, stages,
      collections: collections.map(({ bankAccount: b, ...c }) => ({ ...c, bankName: b?.bankName ?? null })),
      entries,
    };
  }

  /** بيانات سند القبض للطباعة */
  async receipt(user: OrgUser, id: string, collectionId?: string) {
    const o = await this.getOpportunity(user.organizationId, id);
    const [org] = await this.db.query('SELECT name FROM organizations WHERE id = $1', [user.organizationId]);
    if (collectionId) {
      const c = o.collections.find((x) => x.id === collectionId);
      if (!c) throw new NotFoundException('السداد غير موجود');
      return { organizationName: org.name, receiptNo: c.receiptNo, date: c.collectedOn, amount: c.amount, donor: o.donor, opportunityNo: o.opportunityNo,
        bankName: c.bankName, transferReference: c.transferReference, purpose: `سداد وعد بالدفع - فرصة رقم ${o.opportunityNo}`, batches: o.batches, isZakat: o.isZakat };
    }
    if (o.kind !== 'cash' || o.status !== 'approved' || !o.receiptNo) throw new BadRequestException('سند القبض يصدر للفرص النقدية بعد اعتمادها النهائي');
    return { organizationName: org.name, receiptNo: o.receiptNo, date: o.date, amount: o.totalAmount, donor: o.donor, opportunityNo: o.opportunityNo,
      bankName: o.bankAccount?.bankName ?? null, transferReference: o.transferReference, purpose: o.isZakat ? 'زكاة' : 'تبرع', batches: o.batches, isZakat: o.isZakat };
  }

  // ================= المستندات =================

  async addDocument(user: OrgUser, id: string, title: string, file: Express.Multer.File) {
    const o = await this.db.getRepository(Opportunity).findOne({ where: { id, organizationId: user.organizationId } });
    if (!o) throw new NotFoundException('الفرصة غير موجودة');
    const saved = await this.storage.save(user.organizationId, file);
    try {
      await this.db.transaction(async (em) => {
        await em.save(em.create(OpportunityDocument, {
          organizationId: user.organizationId, opportunityId: id, title, fileName: (file.originalname || 'file').slice(0, 255),
          storageKey: saved.key, mimeType: saved.mime, sizeBytes: file.size, uploadedByName: user.fullName,
        }));
        await this.log(em, actorOf(user), id, 'document_added', null, title);
      });
    } catch (e) {
      await this.storage.remove([saved.key]);
      throw e;
    }
    return this.get(user, id);
  }

  async document(user: OrgUser, id: string, docId: string) {
    const d = await this.db.getRepository(OpportunityDocument).findOne({ where: { id: docId, opportunityId: id, organizationId: user.organizationId } });
    if (!d) throw new NotFoundException('المستند غير موجود');
    return { doc: d, stream: this.storage.open(d.storageKey) };
  }

  async removeDocument(user: OrgUser, id: string, docId: string) {
    const d = await this.db.getRepository(OpportunityDocument).findOne({ where: { id: docId, opportunityId: id, organizationId: user.organizationId } });
    if (!d) throw new NotFoundException('المستند غير موجود');
    await this.db.transaction(async (em) => {
      await em.delete(OpportunityDocument, { id: d.id });
      await this.log(em, actorOf(user), id, 'document_removed', null, d.title);
    });
    await this.storage.remove([d.storageKey]);
    return this.get(user, id);
  }

  // ================= الدفعات (مصدّرة لنظام إدارة المشاريع) =================

  async listBatches(orgId: string, f: ListBatchesQuery & { activityIds?: string[] } = {}): Promise<BatchRow[]> {
    const conds = ['b.organization_id = $1'];
    const params: unknown[] = [orgId];
    const add = (sql: string, v: unknown) => {
      params.push(v);
      conds.push(sql.split('?').join(`$${params.length}`));
    };
    if (f.status) add('b.status = ?', f.status);
    else conds.push(`b.status <> 'cancelled'`);
    if (f.targetKind) add('b.target_kind = ?', f.targetKind);
    if (f.activityId) add('b.activity_id = ?', f.activityId);
    if (f.activityIds?.length) add('b.activity_id = ANY(?::uuid[])', f.activityIds);
    if (f.donorId) add('b.donor_id = ?', f.donorId);
    if (f.opportunityId) add('b.opportunity_id = ?', f.opportunityId);
    if (f.zakat) add('b.is_zakat = ?', f.zakat === 'true');
    const term = f.search?.trim();
    if (term) {
      if (/^\d{1,9}$/.test(term)) add('(b.batch_no = ? OR o.opportunity_no = ?)', Number(term));
      else add('(d.name ILIKE ? OR b.target_name ILIKE ?)', `%${term}%`);
    }
    const rows: Omit<BatchRow, 'net'>[] = await this.db.query(
      `SELECT b.id, b.batch_no AS "batchNo", b.opportunity_id AS "opportunityId", o.opportunity_no AS "opportunityNo", o.kind AS "opportunityKind",
              b.donor_id AS "donorId", d.name AS "donorName", b.target_kind AS "targetKind", b.target_name AS "targetName",
              b.activity_id AS "activityId", b.waqf_project_id AS "waqfProjectId", b.beneficiary_request_id AS "beneficiaryRequestId",
              b.allocation_mode AS "allocationMode", b.percent::float AS percent, b.amount::float AS amount, b.is_zakat AS "isZakat",
              b.is_promised AS "isPromised", b.conditions, b.status, b.reserved_amount::float AS "reservedAmount",
              b.spent_amount::float AS "spentAmount", b.transferred_amount::float AS "transferredAmount",
              b.parent_batch_id AS "parentBatchId", b.created_at AS "createdAt"
         FROM fundraising_batches b
         JOIN fundraising_opportunities o ON o.id = b.opportunity_id
         JOIN fundraising_donors d ON d.id = b.donor_id
        WHERE ${conds.join(' AND ')}
        ORDER BY b.batch_no DESC LIMIT 1000`,
      params,
    );
    return rows.map((b) => ({ ...b, net: net(b) }));
  }

  async getBatch(orgId: string, id: string, m?: EntityManager) {
    const em = m ?? this.db.manager;
    const b = await em.findOne(Batch, { where: { id, organizationId: orgId }, relations: { donor: true, opportunity: true, parentBatch: true } });
    if (!b) throw new NotFoundException('الدفعة غير موجودة');
    const [children, entries] = await Promise.all([
      em.find(Batch, { where: { parentBatchId: id }, order: { batchNo: 'ASC' } }),
      this.ledger.listEntries(orgId, { batchId: id }),
    ]);
    const { donor, opportunity, parentBatch, ...rest } = b;
    return {
      ...rest, net: net(b),
      donorName: donor?.name ?? null, opportunityNo: opportunity?.opportunityNo ?? null, opportunityKind: opportunity?.kind ?? null,
      opportunityStatus: opportunity?.status ?? null, parentBatchNo: parentBatch?.batchNo ?? null,
      children: children.map((c) => ({ id: c.id, batchNo: c.batchNo, targetName: c.targetName, amount: c.amount, status: c.status })),
      entries,
    };
  }

  private async lockBatch(em: EntityManager, orgId: string, id: string) {
    const b = await em.findOne(Batch, { where: { id, organizationId: orgId }, lock: { mode: 'pessimistic_write' } });
    if (!b) throw new NotFoundException('الدفعة غير موجودة');
    return b;
  }

  private positive(amount: number) {
    const a = r2(amount);
    if (!(a > 0)) throw new BadRequestException('المبلغ يجب أن يكون أكبر من صفر');
    return a;
  }

  private async withManager<T>(m: EntityManager | undefined, fn: (em: EntityManager) => Promise<T>) {
    return m ? fn(m) : this.db.transaction(fn);
  }

  /** حجز مبلغ من صافي الدفعة (تحميل دعم دون صرف) */
  async reserve(orgId: string, batchId: string, amount: number, m?: EntityManager) {
    return this.withManager(m, async (em) => {
      const b = await this.lockBatch(em, orgId, batchId);
      const a = this.positive(amount);
      if (b.status !== 'active') throw new BadRequestException(`الدفعة رقم ${b.batchNo} غير متاحة للتحميل`);
      if (a > net(b)) throw new BadRequestException(`المبلغ أكبر من صافي الدفعة رقم ${b.batchNo} (${net(b).toLocaleString('en-US')} ريال)`);
      b.reservedAmount = r2(b.reservedAmount + a);
      return em.save(b);
    });
  }

  /** فك حجز (إلغاء تحميل لم يُصرف) */
  async release(orgId: string, batchId: string, amount: number, m?: EntityManager) {
    return this.withManager(m, async (em) => {
      const b = await this.lockBatch(em, orgId, batchId);
      const a = this.positive(amount);
      if (a > b.reservedAmount) throw new BadRequestException(`المبلغ أكبر من المحجوز في الدفعة رقم ${b.batchNo}`);
      b.reservedAmount = r2(b.reservedAmount - a);
      if (b.status === 'closed' && net(b) > 0) b.status = 'active';
      return em.save(b);
    });
  }

  /** صرف من المحجوز: المحجوز يتحول إلى مخصوم */
  async spend(orgId: string, batchId: string, amount: number, m?: EntityManager) {
    return this.withManager(m, async (em) => {
      const b = await this.lockBatch(em, orgId, batchId);
      const a = this.positive(amount);
      if (a > b.reservedAmount) throw new BadRequestException(`الصرف يكون من المحجوز، والمحجوز في الدفعة رقم ${b.batchNo} أقل من المبلغ`);
      if (b.isPromised) {
        // الوعد بالدفع يُحجز عليه، لكن لا يُصرف منه إلا بقدر ما سدده الداعم فعلًا (بنسبة الدفعة من إجمالي الوعد)
        const o = await em.findOneOrFail(Opportunity, { where: { id: b.opportunityId } });
        const collected = o.totalAmount > 0 ? r2((b.amount * o.collectedAmount) / o.totalAmount) : 0;
        if (r2(b.spentAmount + a) > collected) {
          throw new BadRequestException(`الدفعة رقم ${b.batchNo} من وعد بالدفع، ولا يُصرف منها إلا بقدر ما سدده الداعم. المتاح للصرف الآن ${Math.max(0, r2(collected - b.spentAmount)).toLocaleString('en-US')} ريال`);
        }
      }
      b.reservedAmount = r2(b.reservedAmount - a);
      b.spentAmount = r2(b.spentAmount + a);
      if (net(b) === 0 && b.reservedAmount === 0) b.status = 'closed';
      return em.save(b);
    });
  }

  /**
   * مناقلة: نقل جزء من صافي الدفعة إلى مشروع آخر لنفس الداعم وبنفس الاشتراطات.
   * المشروع الجديد يجب أن يطابق نوع الدفعة (مقيد/تشغيلي) وشرط الزكاة.
   * conditionsOverride: لتعديل الفرصة، تحمل الدفعة الجديدة الاشتراطات المعدلة بموافقة الداعم.
   */
  async transfer(orgId: string, sourceBatchId: string, targetActivityId: string, amount: number, m?: EntityManager, conditionsOverride?: Partial<DonorConditions>) {
    return this.withManager(m, async (em) => {
      const src = await this.lockBatch(em, orgId, sourceBatchId);
      const a = this.positive(amount);
      if (src.status !== 'active') throw new BadRequestException(`الدفعة رقم ${src.batchNo} غير متاحة للمناقلة`);
      if (a > net(src)) throw new BadRequestException(`المبلغ أكبر من صافي الدفعة رقم ${src.batchNo} (${net(src).toLocaleString('en-US')} ريال)`);
      if (src.activityId === targetActivityId && !conditionsOverride) throw new BadRequestException('المشروع الجديد هو نفس مشروع الدفعة');
      const acts = await this.activities(em, orgId);
      const t = acts.find((x) => x.id === targetActivityId);
      if (!t || !t.isActive || t.approvalStatus !== 'approved' || t.level === 'axis') throw new BadRequestException('المشروع الجديد غير معتمد');
      let kind: BatchTarget;
      if (src.targetKind === 'operational') {
        if (t.fundingType !== 'operational') throw new BadRequestException('الدفعة تشغيلية، لذا تُناقل إلى مشروع تشغيلي فقط');
        kind = 'operational';
      } else if (src.targetKind === 'waqf') {
        throw new BadRequestException('دفعات الأوقاف لا تُناقل إلى مشاريع الأنشطة');
      } else {
        if (t.fundingType !== 'restricted') throw new BadRequestException('الدفعة مقيدة، لذا تُناقل إلى مشروع مقيد فقط');
        kind = 'program';
      }
      if (src.isZakat && !(t.level === 'project' && t.zakatEligible)) throw new BadRequestException('الدفعة زكاة، والمشروع الجديد ليس ضمن مصارف الزكاة');
      src.transferredAmount = r2(src.transferredAmount + a);
      if (net(src) === 0 && src.reservedAmount === 0) src.status = 'closed';
      await em.save(src);
      return em.save(em.create(Batch, {
        organizationId: orgId, batchNo: await this.nextNo(em, 'fundraising_batches', 'batch_no', orgId), opportunityId: src.opportunityId,
        lineNo: src.lineNo, donorId: src.donorId, targetKind: kind, activityId: t.id, waqfProjectId: null, beneficiaryRequestId: null,
        targetName: `${this.pathOf(acts, t)} (مناقلة من الدفعة ${src.batchNo})`.slice(0, 300), allocationMode: 'amount', percent: null,
        amount: a, isZakat: src.isZakat, isPromised: src.isPromised,
        conditions: conditionsOverride ? this.conditions(conditionsOverride, src.conditions) : src.conditions, status: 'active',
        reservedAmount: 0, spentAmount: 0, transferredAmount: 0, parentBatchId: src.id,
      }));
    });
  }

  /**
   * تعديل فرصة تبرع معتمدة (ينفذه نظام إدارة المشاريع بعد موافقة الداعم):
   * تحديث الاشتراطات على الفرصة ودفعاتها النشطة، وتغيير مبالغ الدفعات بما لا يتجاوز صافيها.
   * القيود العكسية وإعادة الإصدار مسؤولية المستدعي عبر LedgerService.
   */
  async amendOpportunity(orgId: string, id: string, input: AmendInput, m?: EntityManager) {
    return this.withManager(m, async (em) => {
      const o = await this.lock(em, orgId, id);
      if (o.status !== 'approved') throw new BadRequestException('التعديل متاح للفرص المعتمدة فقط');
      if (input.conditions) {
        o.conditions = this.conditions(input.conditions, o.conditions);
        await em.update(Batch, { opportunityId: o.id, status: 'active' }, { conditions: o.conditions });
      }
      if (input.conditionsText !== undefined) o.conditionsText = input.conditionsText;
      let delta = 0;
      for (const d of input.batchDeltas ?? []) {
        const b = await this.lockBatch(em, orgId, d.batchId);
        if (b.opportunityId !== o.id) throw new BadRequestException(`الدفعة رقم ${b.batchNo} لا تخص هذه الفرصة`);
        const change = r2(d.delta);
        if (change < 0 && -change > net(b)) throw new BadRequestException(`التخفيض أكبر من صافي الدفعة رقم ${b.batchNo} (${net(b).toLocaleString('en-US')} ريال)`);
        b.amount = r2(b.amount + change);
        if (b.status === 'closed' && net(b) > 0) b.status = 'active';
        if (b.status === 'active' && net(b) === 0 && b.reservedAmount === 0) b.status = 'closed';
        await em.save(b);
        delta = r2(delta + change);
      }
      o.totalAmount = r2(o.totalAmount + delta);
      if (o.totalAmount <= 0) throw new BadRequestException('إجمالي الفرصة بعد التعديل يجب أن يكون أكبر من صفر');
      if (o.kind === 'pledge' && o.collectedAmount > o.totalAmount) throw new BadRequestException('إجمالي الوعد بعد التعديل أقل مما سدده الداعم');
      await em.save(o);
      const notes = [input.notes, input.effectiveDate ? `يسري من ${input.effectiveDate}` : null, delta ? `تغيير الإجمالي ${delta.toLocaleString('en-US')} ريال` : null]
        .filter(Boolean).join(' · ') || null;
      await this.log(em, { organizationId: orgId, userId: null, name: input.actorName ?? 'نظام إدارة المشاريع' }, o.id, 'amended', null, notes);
      return this.getOpportunity(orgId, id, em);
    });
  }

  // ================= مساعدات =================

  private async lock(em: EntityManager, orgId: string, id: string) {
    const o = await em.findOne(Opportunity, { where: { id, organizationId: orgId }, lock: { mode: 'pessimistic_write' } });
    if (!o) throw new NotFoundException('الفرصة غير موجودة');
    return o;
  }

  private async log(em: EntityManager, actor: Actor, opportunityId: string, action: OpportunityActionType, stageName: string | null, notes: string | null) {
    await em.save(em.create(OpportunityAction, {
      organizationId: actor.organizationId, opportunityId, action, stageName, notes, actorUserId: actor.userId, actorName: actor.name,
    }));
  }

  /** يستخدمه التحقق من القيد في التقارير */
  entryRepo() {
    return this.db.getRepository(LedgerEntry);
  }
}
