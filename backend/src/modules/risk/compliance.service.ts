import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { OrgUser } from '../../core/auth/decorators';
import { RiskAssessment, RiskControl, RiskItem, RiskObligation } from './entities/risk.entity';
import { addDays, assertEditable, markEdited } from './risk-calc';
import { AssessmentDto, ObligationDto } from './risk.dto';
import { RiskCore, today } from './risk-core.service';

const FREQ_DAYS: Record<string, number | null> = { once: null, monthly: 30, quarterly: 91, semiannual: 182, annual: 365, continuous: 30 };

/** سجل الالتزام وتقييمات الامتثال */
@Injectable()
export class ComplianceService {
  constructor(private readonly db: DataSource, private readonly core: RiskCore) {}

  async listObligations(actor: OrgUser, q: { authority?: string; result?: string }) {
    const org = actor.organizationId;
    const qb = this.db.getRepository(RiskObligation).createQueryBuilder('o').where('o.organization_id = :org', { org });
    if (q.authority) qb.andWhere('o.authority = :a', { a: q.authority });
    if (q.result === 'not_assessed') qb.andWhere('o.last_result IS NULL');
    else if (q.result) qb.andWhere('o.last_result = :r', { r: q.result });
    const rows = await qb.orderBy('o.code', 'ASC').getMany();
    const pending: { obligation_id: string; n: string }[] = await this.db.query(
      `SELECT obligation_id, count(*) AS n FROM risk_compliance_assessments WHERE organization_id = $1 AND status IN ('draft','in_review','returned') GROUP BY obligation_id`, [org]);
    const openGaps: { obligation_id: string; n: string }[] = await this.db.query(
      `SELECT obligation_id, count(*) AS n FROM risk_compliance_assessments WHERE organization_id = $1 AND status = 'approved' AND result IN ('partial','non_compliant') AND NOT action_done GROUP BY obligation_id`, [org]);
    const m = (arr: { obligation_id: string; n: string }[]) => new Map(arr.map((x) => [x.obligation_id, Number(x.n)]));
    const pend = m(pending); const gaps = m(openGaps);
    return rows.map((o) => ({ ...o, pendingAssessments: pend.get(o.id) ?? 0, openGaps: gaps.get(o.id) ?? 0, due: o.isActive && !!o.nextDueDate && o.nextDueDate <= today() }));
  }

  async getObligation(actor: OrgUser, id: string) {
    const org = actor.organizationId;
    const o = await this.db.getRepository(RiskObligation).findOne({ where: { id, organizationId: org } });
    if (!o) throw new NotFoundException('المتطلب غير موجود');
    const [assessments, controls, risk] = await Promise.all([
      this.db.getRepository(RiskAssessment).find({ where: { organizationId: org, obligationId: id }, order: { assessmentDate: 'DESC', createdAt: 'DESC' } }),
      this.db.getRepository(RiskControl).createQueryBuilder('c').where('c.organization_id = :org AND c.obligation_ids @> :id', { org, id: JSON.stringify([id]) }).getMany(),
      o.riskId ? this.db.getRepository(RiskItem).findOne({ where: { id: o.riskId }, select: { id: true, code: true, title: true, residualScore: true } }) : null,
    ]);
    const stage = await this.core.stageInfo(actor, 'compliance');
    return {
      ...o, risk, controls: controls.map((c) => ({ id: c.id, code: c.code, name: c.name, effectiveness: c.effectiveness })),
      assessments: assessments.map((a) => ({ ...a, ...stage(a) })),
    };
  }

  private async obligationData(em: EntityManager, org: string, dto: ObligationDto) {
    if (dto.riskId && !(await em.getRepository(RiskItem).exists({ where: { id: dto.riskId, organizationId: org } }))) throw new BadRequestException('الخطر المرتبط غير موجود');
    return {
      title: dto.title, authority: dto.authority, reference: dto.reference ?? null, description: dto.description ?? null, ownerName: dto.ownerName ?? null,
      frequency: dto.frequency, nextDueDate: dto.nextDueDate ?? null, riskId: dto.riskId ?? null, isActive: dto.isActive ?? true,
    };
  }

  async saveObligation(actor: OrgUser, dto: ObligationDto, id?: string) {
    const org = actor.organizationId;
    const saved = await this.db.transaction(async (em) => {
      const repo = em.getRepository(RiskObligation);
      const data = await this.obligationData(em, org, dto);
      if (id) {
        if (!(await repo.exists({ where: { id, organizationId: org } }))) throw new NotFoundException('المتطلب غير موجود');
        await repo.update({ id }, data);
        return id;
      }
      return (await repo.save(repo.create({ ...data, organizationId: org, code: await this.core.nextCode(em, org, 'CMP') }))).id;
    });
    return this.getObligation(actor, saved);
  }

  async removeObligation(actor: OrgUser, id: string) {
    const org = actor.organizationId;
    if (!(await this.db.getRepository(RiskObligation).exists({ where: { id, organizationId: org } }))) throw new NotFoundException('المتطلب غير موجود');
    if (await this.db.getRepository(RiskAssessment).exists({ where: { organizationId: org, obligationId: id } })) throw new ConflictException('متطلب له تقييمات لا يُحذف، أوقفه بدلًا من ذلك');
    await this.db.getRepository(RiskObligation).delete({ id });
  }

  private assessmentData(dto: AssessmentDto) {
    const gap = dto.result === 'partial' || dto.result === 'non_compliant';
    if (gap && (!dto.gaps?.trim() || !dto.correctiveAction?.trim() || !dto.actionDueDate)) {
      throw new BadRequestException('عدم الامتثال يلزمه وصف الفجوة والإجراء التصحيحي وموعده');
    }
    if (dto.result === 'compliant' && !dto.evidence?.trim()) throw new BadRequestException('الامتثال يلزمه ذكر الدليل');
    return {
      assessmentDate: dto.assessmentDate, result: dto.result, evidence: dto.evidence ?? null, gaps: gap ? dto.gaps ?? null : null,
      correctiveAction: gap ? dto.correctiveAction ?? null : null, actionOwner: gap ? dto.actionOwner ?? null : null,
      actionDueDate: gap ? dto.actionDueDate ?? null : null, actionDone: gap ? dto.actionDone ?? false : false,
    };
  }

  async addAssessment(actor: OrgUser, obligationId: string, dto: AssessmentDto) {
    const org = actor.organizationId;
    await this.db.transaction(async (em) => {
      const o = await em.getRepository(RiskObligation).findOne({ where: { id: obligationId, organizationId: org } });
      if (!o) throw new NotFoundException('المتطلب غير موجود');
      if (!o.isActive) throw new ConflictException('المتطلب موقوف');
      const repo = em.getRepository(RiskAssessment);
      await repo.save(repo.create({ ...this.assessmentData(dto), organizationId: org, obligationId, code: await this.core.nextCode(em, org, 'ASM'), createdByName: actor.fullName }));
    });
    return this.getObligation(actor, obligationId);
  }

  async updateAssessment(actor: OrgUser, id: string, dto: AssessmentDto) {
    const org = actor.organizationId;
    const obligationId = await this.db.transaction(async (em) => {
      const repo = em.getRepository(RiskAssessment);
      const a = await repo.findOne({ where: { id, organizationId: org }, lock: { mode: 'pessimistic_write' } });
      if (!a) throw new NotFoundException('التقييم غير موجود');
      if (a.status === 'approved') {
        // بعد الاعتماد يُحدّث إنجاز الإجراء التصحيحي فقط
        if (a.result !== dto.result || a.assessmentDate !== dto.assessmentDate) throw new ConflictException('التقييم معتمد، أضف تقييمًا جديدًا لتغيير النتيجة');
        await repo.update({ id }, { actionDone: dto.actionDone ?? a.actionDone, evidence: dto.evidence ?? a.evidence });
        return a.obligationId;
      }
      assertEditable(a);
      markEdited(a, actor.fullName);
      Object.assign(a, this.assessmentData(dto));
      await repo.save(a);
      return a.obligationId;
    });
    return this.getObligation(actor, obligationId);
  }

  submitAssessment(actor: OrgUser, id: string) {
    return this.core.transition(actor, 'compliance', (em) => em.getRepository(RiskAssessment), id, { submit: true }, { afterApprove: (a, em) => this.applyResult(a, em) });
  }

  decideAssessment(actor: OrgUser, id: string, decision: 'approve' | 'return' | 'reject', note?: string | null) {
    return this.core.transition(actor, 'compliance', (em) => em.getRepository(RiskAssessment), id, { decision, note }, { afterApprove: (a, em) => this.applyResult(a, em) });
  }

  /** التقييم المعتمد يحدّث نتيجة المتطلب وموعد تقييمه القادم حسب دوريته */
  private async applyResult(a: RiskAssessment, em: EntityManager) {
    const o = await em.getRepository(RiskObligation).findOneByOrFail({ id: a.obligationId });
    if (o.lastAssessedAt && o.lastAssessedAt > a.assessmentDate) return;
    const days = FREQ_DAYS[o.frequency];
    await em.getRepository(RiskObligation).update({ id: o.id }, {
      lastResult: a.result, lastAssessedAt: a.assessmentDate, nextDueDate: days ? addDays(a.assessmentDate, days) : null,
    });
  }
}
