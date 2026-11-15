import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { OrgUser } from '../../core/auth/decorators';
import { Activity } from '../beneficiaries/entities';
import { BatchTransfer, OpportunityAmendment } from './entities';
import { BatchConditions, FundingBatch, FundingGateway, net } from './funding.gateway';
import { fmt, SupportService } from './support.service';
import { AmendmentDto, TransferDto } from './support.dto';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;
const today = () => new Date().toISOString().slice(0, 10);

/**
 * المناقلات: نقل المتبقي من صافي رصيد دفعة إلى مشروع آخر لنفس الداعم وبنفس اشتراطاته.
 * تعديل فرصة التبرع: اشتراطات جديدة من تاريخ التعديل بموافقة الداعم، بقيد عكسي ثم قيد جديد بالمبلغ نفسه.
 */
@Injectable()
export class TransfersService {
  constructor(private readonly db: DataSource, private readonly funding: FundingGateway, private readonly support: SupportService) {}

  /** هل يقبل المشروع الهدف اشتراطات الدفعة؟ (قائمة فارغة = مقبول) */
  compatibility(batch: FundingBatch, target: Activity, conditions: BatchConditions = batch.conditions ?? {}) {
    const out: string[] = [];
    if (target.level !== 'project') out.push('اختر مشروعًا');
    if (target.approvalStatus !== 'approved') out.push('المشروع المنقول إليه غير معتمد');
    if (!target.isActive) out.push('المشروع المنقول إليه موقوف');
    if (batch.isZakat && !target.zakatEligible) out.push('الدفعة زكاة والمشروع المنقول إليه ليس ضمن بنود الزكاة');
    if (batch.targetKind === 'operational' && target.fundingType !== 'operational') out.push('الدفعة تشغيلية، فتُنقل إلى مشروع تشغيلي فقط');
    if (batch.targetKind !== 'operational' && target.fundingType === 'operational') out.push('الدفعة مقيدة، فلا تُنقل إلى مشروع تشغيلي');
    if (batch.targetKind === 'waqf' && target.fundingType !== 'endowment') out.push('الدفعة وقف، فتُنقل إلى مشروع وقف فقط');
    if (batch.targetKind !== 'waqf' && target.fundingType === 'endowment') out.push('مشاريع الأوقاف تستقبل دفعات الوقف فقط');
    if (conditions.endDate && conditions.endDate < today()) out.push(`انتهت مدة المشروع المتفق عليها مع الداعم في ${conditions.endDate}`);
    if (batch.beneficiaryRequestId) out.push('الدفعة مخصصة لحالة مستفيد بعينها');
    return out;
  }

  /** المشاريع التي يمكن النقل إليها من دفعة، مع سبب عدم القبول لكل مشروع */
  async targets(actor: OrgUser, batchId: string) {
    const org = actor.organizationId;
    const batch = await this.funding.getBatch(org, batchId);
    const projects = await this.db.getRepository(Activity).find({ where: { organizationId: org, level: 'project' }, order: { name: 'ASC' } });
    return {
      batch: { ...batch, net: net(batch) },
      projects: projects.filter((p) => p.id !== batch.activityId).map((p) => ({
        id: p.id, name: p.name, fundingType: p.fundingType, zakatEligible: p.zakatEligible, approvalStatus: p.approvalStatus,
        problems: this.compatibility(batch, p),
      })),
    };
  }

  async transfer(actor: OrgUser, dto: TransferDto) {
    const org = actor.organizationId;
    return this.db.transaction(async (em) => {
      await em.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`support:${org}`]);
      const batch = await this.funding.getBatch(org, dto.sourceBatchId, em);
      const target = await this.target(em, org, dto.targetActivityId);
      if (target.id === batch.activityId) throw new BadRequestException('اختر مشروعًا غير مشروع الدفعة الحالي');
      const problems = this.compatibility(batch, target);
      if (problems.length) throw new BadRequestException(`لا يمكن النقل: ${problems.join('، ')}`);
      const available = net(batch);
      if (dto.amount > available) throw new BadRequestException(`المبلغ أكبر من صافي رصيد الدفعة المتاح (${fmt(available)} ريال)`);
      const child = await this.funding.transfer(org, batch.id, target.id, dto.amount, em);
      return em.save(em.create(BatchTransfer, {
        organizationId: org, transferNo: await this.support.nextNo(em, org, 'project_transfers', 'transfer_no'),
        sourceBatchId: batch.id, targetBatchId: child.id, sourceActivityId: batch.activityId, targetActivityId: target.id,
        donorId: batch.donorId, amount: dto.amount, reason: dto.reason, createdByName: actor.fullName,
      }));
    });
  }

  async listTransfers(actor: OrgUser, activityId?: string) {
    const org = actor.organizationId;
    const rows: Row[] = await this.db.query(
      `SELECT t.id, t.transfer_no AS "transferNo", t.source_batch_id AS "sourceBatchId", t.target_batch_id AS "targetBatchId",
              t.source_activity_id AS "sourceActivityId", s.name AS "sourceName", t.target_activity_id AS "targetActivityId", g.name AS "targetName",
              t.donor_id AS "donorId", t.amount::float AS amount, t.reason, t.created_by_name AS "createdByName", t.created_at AS "createdAt"
       FROM project_transfers t LEFT JOIN activities s ON s.id = t.source_activity_id JOIN activities g ON g.id = t.target_activity_id
       WHERE t.organization_id = $1 AND ($2::uuid IS NULL OR t.source_activity_id = $2 OR t.target_activity_id = $2)
       ORDER BY t.created_at DESC`, [org, activityId ?? null]);
    const batches = await this.support.batchMap(org, rows.flatMap((r) => [r.sourceBatchId as string, r.targetBatchId as string]));
    return rows.map((r): Row => ({
      ...r,
      sourceBatchNo: batches.get(r.sourceBatchId as string)?.batchNo ?? null,
      targetBatchNo: batches.get(r.targetBatchId as string)?.batchNo ?? null,
      donorName: batches.get(r.sourceBatchId as string)?.donorName ?? null,
    }));
  }

  // ---------------- تعديل فرصة التبرع ----------------

  async amend(actor: OrgUser, dto: AmendmentDto) {
    const org = actor.organizationId;
    return this.db.transaction(async (em) => {
      await em.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`support:${org}`]);
      const batch = await this.funding.getBatch(org, dto.batchId, em);
      const available = net(batch);
      if (dto.amount > available) {
        throw new BadRequestException(`مبلغ التعديل لا يزيد عن صافي رصيد الدفعة غير المحجوز وغير المخصوم (${fmt(available)} ريال)`);
      }
      const old = batch.conditions ?? {};
      const conditions: BatchConditions = {
        acceptsPatientContribution: dto.acceptsPatientContribution ?? old.acceptsPatientContribution,
        maxSpend: dto.maxSpend !== undefined ? dto.maxSpend : old.maxSpend ?? null,
        nationalities: dto.nationalities !== undefined ? dto.nationalities.map((x) => x.trim()).filter(Boolean) : old.nationalities ?? [],
        categories: dto.categories ?? old.categories ?? [],
        endDate: dto.endDate !== undefined ? dto.endDate : old.endDate ?? null,
      };
      const targetId = dto.newActivityId ?? batch.activityId;
      if (!targetId) throw new BadRequestException('اختر المشروع بعد التعديل');
      const target = await this.target(em, org, targetId);
      const problems = this.compatibility(batch, target, conditions).filter((p) => !p.startsWith('الدفعة مخصصة لحالة'));
      if (problems.length) throw new BadRequestException(`لا يمكن اعتماد التعديل: ${problems.join('، ')}`);
      const oldActivity = batch.activityId ? await em.findOne(Activity, { where: { id: batch.activityId } }) : null;
      const child = await this.funding.transfer(org, batch.id, target.id, dto.amount, em, conditions);

      // الأثر المالي: قيد عكسي بالمبلغ على توجيه القيد الأصلي، ثم قيد جديد بالمبلغ نفسه على الدفعة الجديدة
      const lines = await this.originalLines(org, batch, em);
      const no = await this.support.nextNo(em, org, 'opportunity_amendments', 'amendment_no');
      const label = `تعديل فرصة التبرع ${batch.opportunityNo ?? ''} رقم ${no}`.replace(/\s+/g, ' ');
      const reversal = await this.funding.postEntry(org, {
        date: dto.effectiveDate, description: `قيد عكسي - ${label} - الدفعة ${batch.batchNo}`,
        source: { module: 'projects', type: 'amendment_reversal', id: batch.id },
        opportunityId: batch.opportunityId, batchId: batch.id, activityId: batch.activityId,
        lines: [
          { ...lines.credit, debit: dto.amount, credit: 0, batchId: batch.id, activityId: batch.activityId },
          { ...lines.debit, debit: 0, credit: dto.amount },
        ],
      }, em);
      const reissue = await this.funding.postEntry(org, {
        date: dto.effectiveDate, description: `إعادة إصدار - ${label} - الدفعة ${child.batchNo}`,
        source: { module: 'projects', type: 'amendment_reissue', id: child.id },
        opportunityId: batch.opportunityId, batchId: child.id, activityId: target.id,
        lines: [
          { ...lines.debit, debit: dto.amount, credit: 0 },
          { ...lines.credit, debit: 0, credit: dto.amount, batchId: child.id, activityId: target.id },
        ],
      }, em);
      return em.save(em.create(OpportunityAmendment, {
        organizationId: org, amendmentNo: no, opportunityId: batch.opportunityId, batchId: batch.id, newBatchId: child.id,
        effectiveDate: dto.effectiveDate, amount: dto.amount, reason: dto.reason,
        before: { activityId: batch.activityId, activityName: oldActivity?.name ?? null, conditions: old as Record<string, unknown> },
        after: { activityId: target.id, activityName: target.name, conditions: conditions as Record<string, unknown> },
        donorApproved: true, donorApprovalRef: dto.donorApprovalRef ?? null, acknowledgedByName: actor.fullName,
        reversalEntryId: reversal?.id ?? null, reissueEntryId: reissue?.id ?? null,
      }));
    });
  }

  async listAmendments(actor: OrgUser, activityId?: string) {
    const org = actor.organizationId;
    const rows = await this.db.getRepository(OpportunityAmendment).find({ where: { organizationId: org }, order: { createdAt: 'DESC' } });
    const filtered = activityId ? rows.filter((r) => r.before.activityId === activityId || r.after.activityId === activityId) : rows;
    const batches = await this.support.batchMap(org, filtered.flatMap((r) => [r.batchId, r.newBatchId ?? '']));
    return filtered.map((r) => {
      const b = batches.get(r.batchId);
      return { ...r, batchNo: b?.batchNo ?? null, newBatchNo: r.newBatchId ? batches.get(r.newBatchId)?.batchNo ?? null : null, donorName: b?.donorName ?? null, opportunityNo: b?.opportunityNo ?? null };
    });
  }

  /** توجيه القيد الأصلي للفرصة: الطرف المدين (البنك) والطرف الدائن (إيراد التبرع) الخاص بالدفعة */
  private async originalLines(org: string, batch: FundingBatch, em: EntityManager) {
    void em;
    const entries = await this.funding.listEntries(org, { opportunityId: batch.opportunityId });
    // القيد الأصلي: قيد الفرصة من الموارد المالية، وليس قيدًا عكسيًا ولا قيد تسوية سابق
    const candidates = entries.filter((e) => !e.reversalOfId && e.sourceModule !== 'projects' && e.lines?.length);
    candidates.sort((a, b) => a.entryNo - b.entryNo);
    const original = candidates.find((e) => (e.lines ?? []).some((l) => l.batchId === batch.id || l.batchId === batch.parentBatchId)) ?? candidates[0];
    if (!original?.lines) throw new ConflictException('لا يوجد قيد محاسبي لفرصة التبرع، فلا يمكن عمل قيد التسوية');
    const credit = original.lines.find((l) => Number(l.credit) > 0 && l.batchId === batch.id) ?? original.lines.find((l) => Number(l.credit) > 0);
    const debit = original.lines.find((l) => Number(l.debit) > 0);
    if (!credit || !debit) throw new ConflictException('توجيه القيد الأصلي لفرصة التبرع غير مكتمل');
    return {
      debit: { accountCode: debit.accountCode ?? '', accountName: debit.accountName },
      credit: { accountCode: credit.accountCode ?? '', accountName: credit.accountName },
    };
  }

  private async target(em: EntityManager, org: string, id: string) {
    const target = await em.findOne(Activity, { where: { id, organizationId: org } });
    if (!target) throw new NotFoundException('المشروع غير موجود');
    return target;
  }
}

