import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { DataSource, EntityManager, In } from 'typeorm';
import { OrgUser } from '../../core/auth/decorators';
import { Activity, AidDisbursement, Beneficiary, BeneficiaryRequest } from '../beneficiaries/entities';
import { PaymentRequest, ProjectProfile, ProjectSettings, SupportAllocation } from './entities';
import { FundingBatch, FundingGateway, net } from './funding.gateway';
import { AllocateDto, AllocateSplitDto, DirectPaymentDto, ExecutePaymentDto, GeneralDisbursementDto, PaymentRequestDto, ReasonDto } from './support.dto';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;
/** أقصى عدد من الطلبات المنتظرة يُعرض في الشاشة مرة واحدة */
const QUEUE_LIMIT = 500;
const r2 = (n: number) => Math.round(n * 100) / 100;
export const fmt = (n: number) => r2(n).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
const today = () => new Date().toISOString().slice(0, 10);
/**
 * توحيد كتابة الجنسية للمقارنة: "السعودية" و"سعودية" و"سعودي" جنسية واحدة،
 * وكذلك اختلاف الهمزات والتاء المربوطة والألف المقصورة.
 */
export const norm = (s: string | null | undefined) => {
  let v = (s ?? '').trim().toLowerCase().replace(/[\u064B-\u0652\u0640]/g, '').replace(/[أإآ]/g, 'ا').replace(/ى/g, 'ي').replace(/\s+/g, ' ');
  if (v.startsWith('ال') && v.length > 4) v = v.slice(2);
  if (v.endsWith('ية')) v = v.slice(0, -1);
  else if (v.endsWith('ة') || v.endsWith('ه')) v = v.slice(0, -1);
  return v;
};
const RESIDENCY_AR: Record<string, string> = { citizen: 'مواطن', resident: 'مقيم', visitor: 'زائر' };

/** المتبقي محجوزًا على التحميل */
export const remaining = (a: Pick<SupportAllocation, 'amount' | 'spentAmount' | 'releasedAmount'>) => r2(a.amount - a.spentAmount - a.releasedAmount);

interface CheckContext {
  project: Activity;
  request?: BeneficiaryRequest | null;
  beneficiary?: Beneficiary | null;
  amount: number;
}

/**
 * إدارة الدعم: تحميل طلبات المستفيدين على دفعات الداعمين وفق اشتراطاتهم (رصيد محجوز)،
 * الصرف العام، وطلبات الصرف للمالية وتنفيذها (يتحول المحجوز إلى مخصوم).
 */
@Injectable()
export class SupportService {
  constructor(private readonly db: DataSource, private readonly funding: FundingGateway) {}

  // ---------------- مطابقة اشتراطات الداعم ----------------

  /** أسباب رفض تحميل المبلغ على الدفعة (قائمة فارغة = التحميل مقبول) */
  violations(batch: FundingBatch, ctx: CheckContext): string[] {
    const out: string[] = [];
    const c = batch.conditions ?? {};
    const programId = ctx.project.parentId;
    if (batch.status !== 'active') out.push('الدفعة غير نشطة (لم تُحصّل أو أُغلقت)');
    if (batch.activityId !== ctx.project.id && batch.activityId !== programId) out.push('الدفعة مخصصة لمشروع آخر');
    if (batch.beneficiaryRequestId && batch.beneficiaryRequestId !== ctx.request?.id) out.push('الدفعة مخصصة لحالة مستفيد أخرى');
    if (batch.isZakat && !ctx.project.zakatEligible) out.push('الدفعة زكاة والمشروع ليس ضمن بنود الزكاة');
    if (c.endDate && c.endDate < today()) out.push(`انتهت مدة المشروع المتفق عليها مع الداعم في ${c.endDate}`);
    if (c.maxSpend && ctx.amount > c.maxSpend) out.push(`المبلغ يتجاوز الحد الأعلى للصرف الذي حدده الداعم (${fmt(c.maxSpend)} ريال)`);
    if (ctx.request) {
      const contributes = (ctx.request.contributionPercent ?? 0) > 0 || (ctx.request.contributionAmount ?? 0) > 0;
      if (c.acceptsPatientContribution === false && contributes) out.push('الداعم لا يقبل حالات فيها مساهمة من المستفيد');
      const b = ctx.beneficiary;
      if (c.nationalities?.length) {
        if (!b?.nationality) out.push('الداعم حدد جنسيات معينة، وجنسية المستفيد غير مسجلة في ملفه');
        else if (!c.nationalities.some((n) => norm(n) === norm(b.nationality))) out.push(`جنسية المستفيد (${b.nationality}) ليست من الجنسيات التي حددها الداعم: ${c.nationalities.join('، ')}`);
      }
      if (c.categories?.length) {
        if (!b?.residency) out.push('الداعم حدد فئات إقامة معينة، وفئة إقامة المستفيد غير مسجلة في ملفه');
        else if (!c.categories.includes(b.residency)) out.push(`فئة المستفيد (${RESIDENCY_AR[b.residency]}) ليست من الفئات التي حددها الداعم: ${c.categories.map((x) => RESIDENCY_AR[x] ?? x).join('، ')}`);
      }
    }
    const available = net(batch);
    if (ctx.amount > available) out.push(`المبلغ أكبر من صافي رصيد الدفعة المتاح (${fmt(available)} ريال)`);
    return out;
  }

  // ---------------- الطلبات المنتظرة للدعم ----------------

  /**
   * الطلبات المعتمدة على مشاريع المستفيدين التي لم يكتمل دعمها، ومقدار المغطى والمتبقي من احتياج كل طلب.
   * التصفية بالمشروع وبالمتبقي تتم في قاعدة البيانات، وتُعرض أحدث QUEUE_LIMIT طلبًا مع العدد الكلي،
   * حتى لا تُحمَّل عشرات الآلاف من الطلبات في الجمعيات الكبيرة.
   */
  async queue(actor: OrgUser, projectId?: string) {
    const org = actor.organizationId;
    const rows: Row[] = await this.db.query(
      `SELECT q.*, COUNT(*) OVER () AS "totalCount" FROM (
         SELECT r.id, r.request_no AS "requestNo", r.project_id AS "projectId", p.name AS "projectName", r.estimated_cost AS "estimatedCost",
                r.support_percent AS "supportPercent", r.contribution_percent AS "contributionPercent", r.closed_at AS "approvedAt",
                b.id AS "beneficiaryId", b.full_name AS "beneficiaryName", b.file_no AS "fileNo", b.nationality, b.residency,
                COALESCE(SUM(al.amount - al.released_amount), 0) AS covered
         FROM beneficiary_requests r
         JOIN activities p ON p.id = r.project_id
         JOIN beneficiaries b ON b.id = r.beneficiary_id
         LEFT JOIN project_profiles pp ON pp.activity_id = p.id
         LEFT JOIN project_allocations al ON al.request_id = r.id
         WHERE r.organization_id = $1 AND r.status = 'approved' AND COALESCE(pp.spending_mode, 'beneficiaries') = 'beneficiaries'
           AND ($2::uuid IS NULL OR r.project_id = $2)
         GROUP BY r.id, p.name, b.id
       ) q
       WHERE q."estimatedCost" IS NULL OR ROUND(q."estimatedCost" * COALESCE(q."supportPercent", 100) / 100, 2) - q.covered > 0
       ORDER BY q."approvedAt" DESC NULLS LAST LIMIT ${QUEUE_LIMIT}`,
      [org, projectId ?? null]);
    const items = rows.map(({ totalCount: _t, ...r }): Row => {
      const need = this.need(r.estimatedCost as string | null, r.supportPercent as string | null);
      const covered = Number(r.covered);
      return { ...r, estimatedCost: r.estimatedCost === null ? null : Number(r.estimatedCost), need, covered, outstanding: need === null ? null : r2(Math.max(0, need - covered)) };
    });
    return { items, total: Number(rows[0]?.totalCount ?? 0), limit: QUEUE_LIMIT };
  }

  /** احتياج الطلب = التكلفة التقديرية × نسبة دعم الجمعية (null = غير محدد) */
  private need(cost: number | string | null, supportPercent: number | string | null) {
    if (cost === null || cost === undefined) return null;
    const pct = supportPercent === null || supportPercent === undefined ? 100 : Number(supportPercent);
    return r2((Number(cost) * pct) / 100);
  }

  /** الدفعات المتاحة لطلب معين، مع نتيجة مطابقة الاشتراطات لكل دفعة */
  async optionsForRequest(actor: OrgUser, requestId: string, amount?: number) {
    const org = actor.organizationId;
    const { request, beneficiary, project } = await this.loadRequest(this.db.manager, org, requestId);
    const batches = await this.funding.listBatches(org, { activityIds: [project.id, project.parentId!] });
    const covered = await this.covered(this.db.manager, request.id);
    const need = this.need(request.estimatedCost, request.supportPercent);
    const outstanding = need === null ? null : r2(Math.max(0, need - covered));
    const probe = amount ?? outstanding ?? 0;
    return {
      request: { id: request.id, requestNo: request.requestNo, estimatedCost: request.estimatedCost, supportPercent: request.supportPercent, need, covered, outstanding },
      beneficiary: { id: beneficiary.id, fullName: beneficiary.fullName, nationality: beneficiary.nationality, residency: beneficiary.residency },
      project: { id: project.id, name: project.name, zakatEligible: project.zakatEligible },
      batches: batches
        .filter((b) => !b.beneficiaryRequestId || b.beneficiaryRequestId === request.id)
        .map((b) => ({ ...b, net: net(b), violations: this.violations(b, { project, request, beneficiary, amount: Math.min(probe, net(b)) || probe }) })),
    };
  }

  // ---------------- التحميل والحجز ----------------

  /** تحميل طلب مستفيد على دفعة: المبلغ يصبح محجوزًا على الدفعة */
  async allocate(actor: OrgUser, dto: AllocateDto) {
    const org = actor.organizationId;
    return this.db.transaction(async (em) => {
      await em.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`support:${org}`]);
      const { request, beneficiary, project, profile } = await this.loadRequest(em, org, dto.requestId);
      if (project.approvalStatus !== 'approved') throw new ConflictException('المشروع غير معتمد');
      if (profile && profile.spendingMode === 'general') throw new ConflictException('هذا المشروع صرفه عام وغير مرتبط بالمستفيدين');
      const need = this.need(request.estimatedCost, request.supportPercent);
      const covered = await this.covered(em, request.id);
      if (need !== null && r2(covered + dto.amount) > need) {
        throw new BadRequestException(`المبلغ يتجاوز احتياج الطلب. المتبقي غير المغطى ${fmt(Math.max(0, need - covered))} ريال`);
      }
      const batch = await this.funding.getBatch(org, dto.batchId, em);
      const problems = this.violations(batch, { project, request, beneficiary, amount: dto.amount });
      if (problems.length) throw new BadRequestException(`لا يمكن التحميل على الدفعة ${batch.batchNo}: ${problems.join('، ')}`);
      await this.funding.reserve(org, batch.id, dto.amount, em);
      return em.save(em.create(SupportAllocation, {
        organizationId: org, allocationNo: await this.nextNo(em, org, 'project_allocations', 'allocation_no'), kind: 'request',
        activityId: project.id, batchId: batch.id, requestId: request.id, beneficiaryId: beneficiary.id,
        amount: dto.amount, notes: dto.notes ?? null, createdByName: actor.fullName,
      }));
    });
  }

  /**
   * تحميل طلب مستفيد على أكثر من داعم في معاملة واحدة.
   * لا تُحفظ المعاملة إلا إذا كان مجموع المبالغ يساوي المتبقي من احتياج الطلب بالضبط.
   */
  async allocateSplit(actor: OrgUser, dto: AllocateSplitDto) {
    const org = actor.organizationId;
    return this.db.transaction(async (em) => {
      await em.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`support:${org}`]);
      const { request, beneficiary, project, profile } = await this.loadRequest(em, org, dto.requestId);
      if (project.approvalStatus !== 'approved') throw new ConflictException('المشروع غير معتمد');
      if (profile && profile.spendingMode === 'general') throw new ConflictException('هذا المشروع صرفه عام وغير مرتبط بالمستفيدين');
      const need = this.need(request.estimatedCost, request.supportPercent);
      if (need === null) throw new BadRequestException('حدّد التكلفة التقديرية للطلب أولًا حتى يُعرف مبلغ الدعم المطلوب');
      const outstanding = r2(Math.max(0, need - (await this.covered(em, request.id))));
      if (outstanding <= 0) throw new ConflictException('الطلب مغطى بالكامل');
      const ids = dto.parts.map((p) => p.batchId);
      if (new Set(ids).size !== ids.length) throw new BadRequestException('الدفعة مكررة في التحميل');
      const total = r2(dto.parts.reduce((t, p) => t + p.amount, 0));
      if (total !== outstanding) {
        throw new BadRequestException(`مجموع مبالغ الداعمين (${fmt(total)} ريال) يجب أن يساوي مبلغ دعم المستفيد المتبقي (${fmt(outstanding)} ريال) بالضبط`);
      }
      const saved: SupportAllocation[] = [];
      for (const part of dto.parts) {
        const batch = await this.funding.getBatch(org, part.batchId, em);
        const problems = this.violations(batch, { project, request, beneficiary, amount: part.amount });
        if (problems.length) throw new BadRequestException(`لا يمكن التحميل على الدفعة ${batch.batchNo} (${batch.donorName ?? ''}): ${problems.join('، ')}`);
        await this.funding.reserve(org, batch.id, part.amount, em);
        saved.push(await em.save(em.create(SupportAllocation, {
          organizationId: org, allocationNo: await this.nextNo(em, org, 'project_allocations', 'allocation_no'), kind: 'request',
          activityId: project.id, batchId: batch.id, requestId: request.id, beneficiaryId: beneficiary.id,
          amount: part.amount, notes: dto.notes ?? null, createdByName: actor.fullName,
        })));
      }
      return saved;
    });
  }

  /**
   * الصرف العام لمشروع غير مرتبط بمستفيدين: يتحول صافي رصيد الدفعة بالكامل إلى رصيد محجوز،
   * ثم تحمّل المالية المصروف عليه بسندات الصرف.
   */
  async generalDisbursement(actor: OrgUser, dto: GeneralDisbursementDto) {
    const org = actor.organizationId;
    return this.db.transaction(async (em) => {
      await em.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`support:${org}`]);
      const project = await em.findOne(Activity, { where: { id: dto.activityId, organizationId: org, level: 'project' } });
      if (!project) throw new NotFoundException('المشروع غير موجود');
      const profile = await em.findOne(ProjectProfile, { where: { activityId: project.id } });
      if (project.approvalStatus !== 'approved') throw new ConflictException('المشروع غير معتمد');
      if (profile?.spendingMode !== 'general') throw new ConflictException('الصرف العام للمشاريع غير المرتبطة بالمستفيدين فقط. غيّر طريقة صرف المشروع من بياناته');
      const batch = await this.funding.getBatch(org, dto.batchId, em);
      const amount = net(batch);
      if (amount <= 0) throw new ConflictException('لا يوجد رصيد متاح في الدفعة');
      const problems = this.violations(batch, { project, amount }).filter((p) => !p.startsWith('المبلغ يتجاوز الحد الأعلى'));
      if (problems.length) throw new BadRequestException(`لا يمكن الصرف العام من الدفعة ${batch.batchNo}: ${problems.join('، ')}`);
      await this.funding.reserve(org, batch.id, amount, em);
      return em.save(em.create(SupportAllocation, {
        organizationId: org, allocationNo: await this.nextNo(em, org, 'project_allocations', 'allocation_no'), kind: 'general',
        activityId: project.id, batchId: batch.id, requestId: null, beneficiaryId: null, amount,
        notes: dto.notes ?? null, createdByName: actor.fullName,
      }));
    });
  }

  /** إلغاء المتبقي المحجوز (غير المطلوب صرفه) فيعود لصافي رصيد الدفعة */
  async release(actor: OrgUser, id: string, dto: ReasonDto) {
    const org = actor.organizationId;
    return this.db.transaction(async (em) => {
      const a = await this.lockAllocation(em, org, id);
      const free = r2(remaining(a) - (await this.pendingPayments(em, a.id)));
      if (free <= 0) throw new ConflictException('لا يوجد مبلغ محجوز قابل للإلغاء (المتبقي عليه طلبات صرف قيد التنفيذ)');
      await this.funding.release(org, a.batchId, free, em);
      a.releasedAmount = r2(a.releasedAmount + free);
      a.status = this.statusOf(a);
      a.notes = [a.notes, `إلغاء حجز ${fmt(free)} ريال: ${dto.reason}`].filter(Boolean).join('\n');
      return em.save(a);
    });
  }

  // ---------------- طلبات الصرف ----------------

  /** إدارة المشاريع تصدر طلب صرف للمالية على مبلغ محجوز */
  async requestPayment(actor: OrgUser, dto: PaymentRequestDto, em?: EntityManager): Promise<PaymentRequest> {
    if (!em) return this.db.transaction((m) => this.requestPayment(actor, dto, m));
    const org = actor.organizationId;
    const a = await this.lockAllocation(em, org, dto.allocationId);
    const free = r2(remaining(a) - (await this.pendingPayments(em, a.id)));
    if (dto.amount > free) throw new BadRequestException(`المبلغ أكبر من المحجوز المتاح للصرف (${fmt(free)} ريال)`);
    let payeeName = dto.payeeName ?? null;
    if (!payeeName && a.beneficiaryId) payeeName = (await em.findOne(Beneficiary, { where: { id: a.beneficiaryId } }))?.fullName ?? null;
    if (!payeeName) throw new BadRequestException('اكتب اسم المستفيد من الصرف أو مزود الخدمة');
    return em.save(em.create(PaymentRequest, {
      organizationId: org, requestNo: await this.nextNo(em, org, 'project_payment_requests', 'request_no'),
      activityId: a.activityId, allocationId: a.id, batchId: a.batchId, amount: dto.amount, method: dto.method,
      payeeKind: dto.payeeKind ?? (a.beneficiaryId ? 'beneficiary' : 'provider'), payeeName,
      description: dto.description ?? null, requestedByName: actor.fullName,
    }));
  }

  /**
   * الإدارة المالية تنفذ طلب الصرف بسند صرف للمستفيد أو باعتماد وصرف فاتورة مزود الخدمة:
   * المبلغ يتحول من محجوز إلى مخصوم، ويصدر قيد الصرف، ويُسجل في سجل مساعدات المستفيد.
   */
  async execute(actor: OrgUser, id: string, dto: ExecutePaymentDto, em?: EntityManager): Promise<PaymentRequest> {
    if (!em) return this.db.transaction((m) => this.execute(actor, id, dto, m));
    const org = actor.organizationId;
    const pr = await em.findOne(PaymentRequest, { where: { id, organizationId: org }, lock: { mode: 'pessimistic_write' } });
    if (!pr) throw new NotFoundException('طلب الصرف غير موجود');
    if (pr.status !== 'pending') throw new ConflictException('طلب الصرف ليس قيد التنفيذ');
    const a = await this.lockAllocation(em, org, pr.allocationId);
    if (pr.amount > remaining(a)) throw new ConflictException('المبلغ المحجوز لا يكفي لتنفيذ طلب الصرف');
    await this.funding.spend(org, pr.batchId, pr.amount, em);
    a.spentAmount = r2(a.spentAmount + pr.amount);
    a.status = this.statusOf(a);
    await em.save(a);

    const paidOn = dto.paidOn ?? today();
    const project = await em.findOneOrFail(Activity, { where: { id: pr.activityId } });
    const settings = await em.findOne(ProjectSettings, { where: { organizationId: org } });
    const kind = pr.method === 'voucher' ? 'سند صرف' : 'فاتورة';
    const entry = await this.funding.postEntry(org, {
      date: paidOn,
      description: `صرف مشروع ${project.name} - ${kind} ${dto.referenceNo} - ${pr.payeeName}`,
      source: { module: 'projects', type: 'payment', id: pr.id },
      activityId: pr.activityId, batchId: pr.batchId,
      lines: [
        { accountCode: settings?.expenseDebitCode ?? '5100', accountName: settings?.expenseDebitName ?? 'مصروفات المشاريع', debit: pr.amount, credit: 0 },
        { accountCode: settings?.paymentCreditCode ?? '1110', accountName: settings?.paymentCreditName ?? 'البنك', debit: 0, credit: pr.amount },
      ],
    }, em);
    Object.assign(pr, {
      status: 'paid', referenceNo: dto.referenceNo, paidOn, executedByName: actor.fullName, executedAt: new Date(), journalEntryId: entry?.id ?? null,
    });
    await em.save(pr);

    if (a.kind === 'request' && a.beneficiaryId) {
      await em.save(em.create(AidDisbursement, {
        organizationId: org, beneficiaryId: a.beneficiaryId, requestId: a.requestId,
        aidType: pr.method === 'voucher' ? 'cash' : 'other', amount: pr.amount, disbursedOn: paidOn,
        description: `دعم من مشروع ${project.name} (${kind})`, referenceNo: dto.referenceNo, createdBy: actor.id,
      }));
    }
    return pr;
  }

  /** المالية تسجل سند صرف مباشرة على مبلغ محجوز (مثل الصرف العام) */
  async direct(actor: OrgUser, dto: DirectPaymentDto) {
    return this.db.transaction(async (em) => {
      const pr = await this.requestPayment(actor, dto, em);
      return this.execute(actor, pr.id, dto, em);
    });
  }

  async rejectPayment(actor: OrgUser, id: string, dto: ReasonDto) {
    const pr = await this.db.getRepository(PaymentRequest).findOne({ where: { id, organizationId: actor.organizationId } });
    if (!pr) throw new NotFoundException('طلب الصرف غير موجود');
    if (pr.status !== 'pending') throw new ConflictException('طلب الصرف ليس قيد التنفيذ');
    Object.assign(pr, { status: 'rejected', rejectReason: dto.reason, executedByName: actor.fullName, executedAt: new Date() });
    return this.db.getRepository(PaymentRequest).save(pr);
  }

  // ---------------- القوائم ----------------

  async allocations(actor: OrgUser, q: { activityId?: string; status?: string; batchId?: string } = {}) {
    const org = actor.organizationId;
    const rows: Row[] = await this.db.query(
      `SELECT al.id, al.allocation_no AS "allocationNo", al.kind, al.activity_id AS "activityId", p.name AS "projectName",
              al.batch_id AS "batchId", al.request_id AS "requestId", r.request_no AS "requestNo",
              al.beneficiary_id AS "beneficiaryId", b.full_name AS "beneficiaryName",
              al.amount::float AS amount, al.spent_amount::float AS "spentAmount", al.released_amount::float AS "releasedAmount",
              al.status, al.notes, al.created_by_name AS "createdByName", al.created_at AS "createdAt",
              COALESCE((SELECT SUM(x.amount) FROM project_payment_requests x WHERE x.allocation_id = al.id AND x.status = 'pending'), 0)::float AS "pendingPayments"
       FROM project_allocations al
       JOIN activities p ON p.id = al.activity_id
       LEFT JOIN beneficiary_requests r ON r.id = al.request_id
       LEFT JOIN beneficiaries b ON b.id = al.beneficiary_id
       WHERE al.organization_id = $1 AND ($2::uuid IS NULL OR al.activity_id = $2) AND ($3::text IS NULL OR al.status = $3)
         AND ($4::uuid IS NULL OR al.batch_id = $4)
       ORDER BY al.created_at DESC`, [org, q.activityId ?? null, q.status ?? null, q.batchId ?? null]);
    const batches = await this.batchMap(org, rows.map((r) => r.batchId as string));
    return rows.map((r): Row => {
      const b = batches.get(r.batchId as string);
      const rem = r2((r.amount as number) - (r.spentAmount as number) - (r.releasedAmount as number));
      return { ...r, remaining: rem, batchNo: b?.batchNo ?? null, donorId: b?.donorId ?? null, donorName: b?.donorName ?? null, opportunityId: b?.opportunityId ?? null, opportunityNo: b?.opportunityNo ?? null };
    });
  }

  async payments(actor: OrgUser, q: { status?: string; activityId?: string } = {}) {
    const org = actor.organizationId;
    const rows: Row[] = await this.db.query(
      `SELECT x.id, x.request_no AS "requestNo", x.activity_id AS "activityId", p.name AS "projectName", x.allocation_id AS "allocationId",
              al.allocation_no AS "allocationNo", al.kind AS "allocationKind", al.request_id AS "beneficiaryRequestId", r.request_no AS "beneficiaryRequestNo",
              al.beneficiary_id AS "beneficiaryId",
              x.batch_id AS "batchId", x.amount::float AS amount, x.method, x.payee_kind AS "payeeKind", x.payee_name AS "payeeName",
              x.description, x.status, x.requested_by_name AS "requestedByName", x.reference_no AS "referenceNo", x.paid_on AS "paidOn",
              x.executed_by_name AS "executedByName", x.executed_at AS "executedAt", x.reject_reason AS "rejectReason",
              x.journal_entry_id AS "journalEntryId", x.created_at AS "createdAt"
       FROM project_payment_requests x
       JOIN activities p ON p.id = x.activity_id
       JOIN project_allocations al ON al.id = x.allocation_id
       LEFT JOIN beneficiary_requests r ON r.id = al.request_id
       WHERE x.organization_id = $1 AND ($2::text IS NULL OR x.status = $2) AND ($3::uuid IS NULL OR x.activity_id = $3)
       ORDER BY x.created_at DESC`, [org, q.status ?? null, q.activityId ?? null]);
    const batches = await this.batchMap(org, rows.map((r) => r.batchId as string));
    return rows.map((r): Row => {
      const b = batches.get(r.batchId as string);
      return { ...r, batchNo: b?.batchNo ?? null, donorName: b?.donorName ?? null, opportunityId: b?.opportunityId ?? null };
    });
  }

  /** دفعات المشاريع للاختيار في شاشة إدارة الدعم */
  async batchesForProject(actor: OrgUser, activityId: string) {
    const org = actor.organizationId;
    const project = await this.db.getRepository(Activity).findOne({ where: { id: activityId, organizationId: org, level: 'project' } });
    if (!project) throw new NotFoundException('المشروع غير موجود');
    const batches = await this.funding.listBatches(org, { activityIds: [project.id, project.parentId!] });
    return batches.map((b) => ({ ...b, net: net(b), violations: this.violations(b, { project, amount: 0 }) }));
  }

  // ---------------- مساعدات ----------------

  async batchMap(org: string, ids: string[]) {
    const unique = [...new Set(ids.filter(Boolean))];
    if (!unique.length) return new Map<string, FundingBatch>();
    const all = await this.funding.listBatches(org, {});
    return new Map(all.filter((b) => unique.includes(b.id)).map((b) => [b.id, b]));
  }

  private statusOf(a: SupportAllocation) {
    const rem = remaining(a);
    if (rem > 0) return a.spentAmount > 0 ? 'partial' : 'reserved';
    return a.spentAmount > 0 ? 'spent' : 'released';
  }

  private async covered(em: EntityManager, requestId: string) {
    const [row] = await em.query('SELECT COALESCE(SUM(amount - released_amount), 0)::float AS c FROM project_allocations WHERE request_id = $1', [requestId]);
    return Number(row.c);
  }

  private async pendingPayments(em: EntityManager, allocationId: string) {
    const [row] = await em.query(`SELECT COALESCE(SUM(amount), 0)::float AS s FROM project_payment_requests WHERE allocation_id = $1 AND status = 'pending'`, [allocationId]);
    return Number(row.s);
  }

  private async loadRequest(em: EntityManager, org: string, id: string) {
    const request = await em.findOne(BeneficiaryRequest, { where: { id, organizationId: org } });
    if (!request) throw new NotFoundException('الطلب غير موجود');
    if (request.status !== 'approved') throw new ConflictException('التحميل يكون على طلب معتمد نهائيًا فقط');
    const [beneficiary, project] = await Promise.all([
      em.findOneOrFail(Beneficiary, { where: { id: request.beneficiaryId } }),
      em.findOneOrFail(Activity, { where: { id: request.projectId } }),
    ]);
    const profile = await em.findOne(ProjectProfile, { where: { activityId: project.id } });
    return { request, beneficiary, project, profile };
  }

  private async lockAllocation(em: EntityManager, org: string, id: string) {
    const a = await em.findOne(SupportAllocation, { where: { id, organizationId: org }, lock: { mode: 'pessimistic_write' } });
    if (!a) throw new NotFoundException('التحميل غير موجود');
    return a;
  }

  async nextNo(em: EntityManager, org: string, table: string, column: string) {
    await em.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`${table}:${org}`]);
    const [{ next }] = await em.query(`SELECT COALESCE(MAX(${column}), 0) + 1 AS next FROM ${table} WHERE organization_id = $1`, [org]);
    return Number(next);
  }

  /** تحميلات لها رصيد محجوز على المشروع */
  async activeOnProject(org: string, activityId: string, em: EntityManager = this.db.manager) {
    return em.count(SupportAllocation, { where: { organizationId: org, activityId, status: In(['reserved', 'partial']) } });
  }
}
