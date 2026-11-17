import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { DataSource, EntityManager, In } from 'typeorm';
import { OrgUser } from '../../core/auth/decorators';
import { RiskAnalysis, RiskControl, RiskItem, RiskObligation, RiskReview } from './entities/risk.entity';
import { assertEditable, levelOf, markEdited, nextReview, score } from './risk-calc';
import { PESTEL_FACTORS, RiskConfig, SWOT_FACTORS } from './risk-defaults';
import { AnalysisDto, ControlDto, ItemToRiskDto, RiskDto, RiskReviewDto } from './risk.dto';
import { RiskCore, today } from './risk-core.service';

const FACTOR_SOURCE: Record<string, RiskItem['source']> = {
  political: 'external', economic: 'external', social: 'external', technological: 'external', environmental: 'external', legal: 'external',
  weakness: 'internal', threat: 'external', strength: 'internal', opportunity: 'external',
};

/** سجل المخاطر ومراجعاته، الضوابط الرقابية، وتحليلات PESTEL وSWOT */
@Injectable()
export class RegisterService {
  constructor(private readonly db: DataSource, private readonly core: RiskCore) {}

  // ---------------- سجل المخاطر ----------------

  private view(cfg: RiskConfig, r: RiskItem) {
    const lv = (s: number) => { const l = levelOf(cfg, s); return { key: l.key, name: l.name, color: l.color }; };
    const overdueActions = r.actions.filter((a) => a.status !== 'done' && a.dueDate && a.dueDate < today()).length;
    return {
      ...r, inherentLevel: lv(r.inherentScore), residualLevel: lv(r.residualScore), aboveAppetite: r.residualScore > cfg.appetite,
      overdueActions, reviewOverdue: !!r.nextReviewDate && r.nextReviewDate < today() && r.riskState !== 'closed',
      actionsProgress: r.actions.length ? Math.round((r.actions.filter((a) => a.status === 'done').length / r.actions.length) * 100) : null,
    };
  }

  async listRisks(actor: OrgUser, q: { source?: string; category?: string; level?: string; state?: string; status?: string; search?: string }) {
    const cfg = await this.core.config(actor.organizationId);
    const qb = this.db.getRepository(RiskItem).createQueryBuilder('r').where('r.organization_id = :org', { org: actor.organizationId });
    if (q.source) qb.andWhere('r.source = :source', { source: q.source });
    if (q.category) qb.andWhere('r.category = :category', { category: q.category });
    if (q.state) qb.andWhere('r.risk_state = :state', { state: q.state });
    if (q.status) qb.andWhere('r.status = :status', { status: q.status });
    if (q.search) qb.andWhere('(r.title ILIKE :s OR r.code ILIKE :s OR r.owner_name ILIKE :s)', { s: `%${q.search}%` });
    const rows = (await qb.orderBy('r.residual_score', 'DESC').addOrderBy('r.code', 'ASC').getMany()).map((r) => this.view(cfg, r));
    const stage = await this.core.stageInfo(actor, 'risk', cfg);
    return rows.filter((r) => !q.level || r.residualLevel.key === q.level).map((r) => ({ ...r, ...stage(r) }));
  }

  async getRisk(actor: OrgUser, id: string) {
    const org = actor.organizationId;
    const cfg = await this.core.config(org);
    const r = await this.db.getRepository(RiskItem).findOne({ where: { id, organizationId: org } });
    if (!r) throw new NotFoundException('الخطر غير موجود');
    const [reviews, controls, obligations, analysis] = await Promise.all([
      this.db.getRepository(RiskReview).find({ where: { organizationId: org, riskId: id }, order: { reviewDate: 'DESC', createdAt: 'DESC' } }),
      this.db.getRepository(RiskControl).createQueryBuilder('c').where('c.organization_id = :org AND c.risk_ids @> :id', { org, id: JSON.stringify([id]) }).getMany(),
      this.db.getRepository(RiskObligation).find({ where: { organizationId: org, riskId: id } }),
      r.analysisId ? this.db.getRepository(RiskAnalysis).findOne({ where: { id: r.analysisId }, select: { id: true, code: true, title: true, kind: true } }) : null,
    ]);
    return {
      ...this.view(cfg, r), ...(await this.core.stageInfo(actor, 'risk', cfg))(r), reviews, analysis,
      controls: controls.map((c) => ({ id: c.id, code: c.code, name: c.name, type: c.type, effectiveness: c.effectiveness })),
      obligations: obligations.map((o) => ({ id: o.id, code: o.code, title: o.title, lastResult: o.lastResult })),
    };
  }

  private async riskData(org: string, dto: RiskDto, cfg: RiskConfig, em: EntityManager) {
    if (!cfg.categories.some((c) => c.code === dto.category)) throw new BadRequestException('تصنيف الخطر غير معرّف في الإعدادات');
    const inherent = score(dto.inherentLikelihood, dto.inherentImpact);
    const residual = score(dto.residualLikelihood, dto.residualImpact);
    if (residual > inherent) throw new BadRequestException('الخطر المتبقي لا يكون أعلى من الخطر الكامن');
    if (dto.treatment === 'accept' && residual > cfg.appetite && !dto.treatmentNote?.trim()) {
      throw new BadRequestException('قبول خطر فوق حد الرغبة في المخاطر يلزمه كتابة المبرر');
    }
    if (dto.source === 'product' && !dto.productName?.trim()) throw new BadRequestException('حدد المنتج أو الخدمة لمخاطر المنتجات والخدمات');
    if (dto.targetScore && dto.targetScore > residual) throw new BadRequestException('الخطر المستهدف لا يكون أعلى من المتبقي');
    return {
      title: dto.title, description: dto.description ?? null, source: dto.source, category: dto.category, productName: dto.productName ?? null,
      unitId: dto.unitId ?? null, unitName: await this.core.unitName(org, dto.unitId, em), ownerName: dto.ownerName ?? null,
      causes: dto.causes ?? null, consequences: dto.consequences ?? null,
      inherentLikelihood: dto.inherentLikelihood, inherentImpact: dto.inherentImpact, inherentScore: inherent,
      residualLikelihood: dto.residualLikelihood, residualImpact: dto.residualImpact, residualScore: residual, targetScore: dto.targetScore ?? null,
      treatment: dto.treatment, treatmentNote: dto.treatmentNote ?? null,
      actions: dto.actions.map((a) => ({ title: a.title, ownerName: a.ownerName ?? null, dueDate: a.dueDate ?? null, status: a.status, note: a.note ?? null })),
      kris: dto.kris.map((k) => ({ name: k.name, threshold: k.threshold, current: k.current ?? null, breached: k.breached })),
    };
  }

  async createRisk(actor: OrgUser, dto: RiskDto) {
    const org = actor.organizationId;
    const id = await this.db.transaction(async (em) => {
      const cfg = await this.core.config(org, em);
      const data = await this.riskData(org, dto, cfg, em);
      if (dto.analysisId && !(await em.getRepository(RiskAnalysis).exists({ where: { id: dto.analysisId, organizationId: org } }))) {
        throw new BadRequestException('التحليل المرتبط غير موجود');
      }
      const identified = dto.identifiedDate ?? today();
      const r = await em.getRepository(RiskItem).save(em.getRepository(RiskItem).create({
        ...data, organizationId: org, code: await this.core.nextCode(em, org, 'RSK'), createdByName: actor.fullName,
        riskState: dto.riskState ?? 'open', identifiedDate: identified, nextReviewDate: nextReview(cfg, data.residualScore, identified),
        analysisId: dto.analysisId ?? null, analysisItemId: dto.analysisItemId ?? null,
      }));
      await em.getRepository(RiskReview).save({
        organizationId: org, riskId: r.id, reviewDate: identified, likelihood: r.residualLikelihood, impact: r.residualImpact, score: r.residualScore,
        note: 'التقييم الأول', byName: actor.fullName,
      });
      return r.id;
    });
    return this.getRisk(actor, id);
  }

  async updateRisk(actor: OrgUser, id: string, dto: RiskDto) {
    const org = actor.organizationId;
    await this.db.transaction(async (em) => {
      const repo = em.getRepository(RiskItem);
      const r = await repo.findOne({ where: { id, organizationId: org }, lock: { mode: 'pessimistic_write' } });
      if (!r) throw new NotFoundException('الخطر غير موجود');
      assertEditable(r);
      const cfg = await this.core.config(org, em);
      const data = await this.riskData(org, dto, cfg, em);
      const assessmentChanged = data.residualScore !== r.residualScore || data.inherentScore !== r.inherentScore || data.treatment !== r.treatment;
      // تغيير التقييم أو المعالجة في خطر معتمد يعيده للاعتماد، أما تحديث الإجراءات والمؤشرات فلا
      if (assessmentChanged) markEdited(r, actor.fullName);
      Object.assign(r, data, { riskState: dto.riskState ?? r.riskState, identifiedDate: dto.identifiedDate ?? r.identifiedDate });
      if (assessmentChanged) {
        r.nextReviewDate = nextReview(cfg, r.residualScore, today());
        await em.getRepository(RiskReview).save({
          organizationId: org, riskId: id, reviewDate: today(), likelihood: r.residualLikelihood, impact: r.residualImpact, score: r.residualScore,
          note: 'تعديل التقييم', byName: actor.fullName,
        });
      }
      if (r.actions.length && r.riskState === 'open' && r.actions.some((a) => a.status !== 'planned')) r.riskState = 'treating';
      await repo.save(r);
    });
    return this.getRisk(actor, id);
  }

  /** مراجعة دورية: إعادة تقييم الخطر المتبقي في موعده، وتحديد موعد المراجعة التالية حسب المستوى الجديد */
  async reviewRisk(actor: OrgUser, id: string, dto: RiskReviewDto) {
    const org = actor.organizationId;
    await this.db.transaction(async (em) => {
      const repo = em.getRepository(RiskItem);
      const r = await repo.findOne({ where: { id, organizationId: org }, lock: { mode: 'pessimistic_write' } });
      if (!r) throw new NotFoundException('الخطر غير موجود');
      if (r.riskState === 'closed') throw new ConflictException('الخطر مغلق');
      const s = score(dto.likelihood, dto.impact);
      if (s > r.inherentScore) throw new BadRequestException('الخطر المتبقي لا يكون أعلى من الخطر الكامن، عدّل التقييم الكامن أولًا');
      const cfg = await this.core.config(org, em);
      await em.getRepository(RiskReview).save({ organizationId: org, riskId: id, reviewDate: dto.reviewDate, likelihood: dto.likelihood, impact: dto.impact, score: s, note: dto.note ?? null, byName: actor.fullName });
      await repo.update({ id }, {
        residualLikelihood: dto.likelihood, residualImpact: dto.impact, residualScore: s, nextReviewDate: nextReview(cfg, s, dto.reviewDate),
        riskState: r.riskState === 'open' ? 'monitoring' : r.riskState,
      });
    });
    return this.getRisk(actor, id);
  }

  async removeRisk(actor: OrgUser, id: string) {
    const org = actor.organizationId;
    await this.db.transaction(async (em) => {
      const r = await em.getRepository(RiskItem).findOne({ where: { id, organizationId: org } });
      if (!r) throw new NotFoundException('الخطر غير موجود');
      if (r.approvedAt) throw new ConflictException('خطر اعتُمد مرة لا يُحذف، أغلقه بدلًا من ذلك');
      const refs = await em.query(
        `SELECT (SELECT count(*) FROM risk_controls WHERE organization_id = $1 AND risk_ids @> $2::jsonb)
              + (SELECT count(*) FROM risk_obligations WHERE organization_id = $1 AND risk_id = $3)
              + (SELECT count(*) FROM risk_changes WHERE organization_id = $1 AND risk_ids @> $2::jsonb) AS n`, [org, JSON.stringify([id]), id]);
      if (Number(refs[0].n)) throw new ConflictException('الخطر مرتبط بضوابط أو متطلبات أو طلبات تغيير');
      await em.getRepository(RiskReview).delete({ organizationId: org, riskId: id });
      await em.getRepository(RiskItem).delete({ id });
      await em.query(`UPDATE risk_analyses SET items = (SELECT COALESCE(jsonb_agg(CASE WHEN i->>'riskId' = $2 THEN i || '{"riskId": null}'::jsonb ELSE i END), '[]') FROM jsonb_array_elements(items) i) WHERE organization_id = $1`, [org, id]);
    });
  }

  submitRisk(actor: OrgUser, id: string) {
    return this.core.transition(actor, 'risk', (em) => em.getRepository(RiskItem), id, { submit: true });
  }

  decideRisk(actor: OrgUser, id: string, decision: 'approve' | 'return' | 'reject', note?: string | null) {
    return this.core.transition(actor, 'risk', (em) => em.getRepository(RiskItem), id, { decision, note });
  }

  /** قائمة مختصرة للاختيار في الشاشات الأخرى */
  async riskOptions(org: string) {
    return this.db.getRepository(RiskItem).find({
      where: { organizationId: org }, select: { id: true, code: true, title: true, residualScore: true, riskState: true }, order: { code: 'ASC' },
    });
  }

  // ---------------- الضوابط الرقابية ----------------

  async listControls(actor: OrgUser) {
    const org = actor.organizationId;
    const [rows, risks] = await Promise.all([
      this.db.getRepository(RiskControl).find({ where: { organizationId: org }, order: { code: 'ASC' } }),
      this.riskOptions(org),
    ]);
    const byId = new Map(risks.map((r) => [r.id, r]));
    return rows.map((c) => ({ ...c, risks: c.riskIds.map((id) => byId.get(id)).filter(Boolean), testOverdue: !c.lastTestDate || c.lastTestDate < new Date(Date.now() - 365 * 86400000).toISOString().slice(0, 10) }));
  }

  private async checkRefs(em: EntityManager, org: string, riskIds: string[] = [], obligationIds: string[] = []) {
    if (riskIds.length && (await em.getRepository(RiskItem).count({ where: { organizationId: org, id: In(riskIds) } })) !== new Set(riskIds).size) {
      throw new BadRequestException('أحد المخاطر المختارة غير موجود');
    }
    if (obligationIds.length && (await em.getRepository(RiskObligation).count({ where: { organizationId: org, id: In(obligationIds) } })) !== new Set(obligationIds).size) {
      throw new BadRequestException('أحد المتطلبات المختارة غير موجود');
    }
  }

  async saveControl(actor: OrgUser, dto: ControlDto, id?: string) {
    const org = actor.organizationId;
    return this.db.transaction(async (em) => {
      await this.checkRefs(em, org, dto.riskIds, dto.obligationIds);
      if (dto.effectiveness !== 'not_tested' && !dto.lastTestDate) throw new BadRequestException('حدد تاريخ آخر اختبار للضابط عند تقييم فاعليته');
      const data = {
        name: dto.name, description: dto.description ?? null, type: dto.type, automated: dto.automated, frequency: dto.frequency, ownerName: dto.ownerName ?? null,
        effectiveness: dto.effectiveness, lastTestDate: dto.lastTestDate ?? null, lastTestNote: dto.lastTestNote ?? null,
        riskIds: [...new Set(dto.riskIds ?? [])], obligationIds: [...new Set(dto.obligationIds ?? [])], isActive: dto.isActive ?? true,
      };
      const repo = em.getRepository(RiskControl);
      if (id) {
        const c = await repo.findOne({ where: { id, organizationId: org } });
        if (!c) throw new NotFoundException('الضابط غير موجود');
        await repo.update({ id }, data);
        return repo.findOneByOrFail({ id });
      }
      return repo.save(repo.create({ ...data, organizationId: org, code: await this.core.nextCode(em, org, 'CTL') }));
    });
  }

  async removeControl(actor: OrgUser, id: string) {
    const c = await this.db.getRepository(RiskControl).findOne({ where: { id, organizationId: actor.organizationId } });
    if (!c) throw new NotFoundException('الضابط غير موجود');
    if (c.lastTestDate) throw new ConflictException('ضابط اختُبر مرة لا يُحذف حفاظًا على سجل الاختبار، أوقفه بدلًا من ذلك');
    const used = await this.db.query(`SELECT 1 FROM risk_procedures WHERE organization_id = $1 AND control_ids @> $2::jsonb LIMIT 1`, [actor.organizationId, JSON.stringify([id])]);
    if (used.length) throw new ConflictException('الضابط مستخدم في إجراء موثق');
    await this.db.getRepository(RiskControl).delete({ id });
  }

  // ---------------- تحليلات PESTEL وSWOT ----------------

  async listAnalyses(actor: OrgUser) {
    const rows = await this.db.getRepository(RiskAnalysis).find({ where: { organizationId: actor.organizationId }, order: { analysisDate: 'DESC', code: 'DESC' } });
    const stage = await this.core.stageInfo(actor, 'analysis');
    return rows.map((a) => ({
      id: a.id, code: a.code, kind: a.kind, title: a.title, scope: a.scope, analysisDate: a.analysisDate, status: a.status, revision: a.revision,
      items: a.items.length, linkedRisks: a.items.filter((i) => i.riskId).length, createdByName: a.createdByName, ...stage(a),
    }));
  }

  async getAnalysis(actor: OrgUser, id: string) {
    const a = await this.db.getRepository(RiskAnalysis).findOne({ where: { id, organizationId: actor.organizationId } });
    if (!a) throw new NotFoundException('التحليل غير موجود');
    const riskIds = a.items.map((i) => i.riskId).filter((x): x is string => !!x);
    const risks = riskIds.length ? await this.db.getRepository(RiskItem).find({ where: { id: In(riskIds) }, select: { id: true, code: true, residualScore: true } }) : [];
    return { ...a, ...(await this.core.stageInfo(actor, 'analysis'))(a), risks };
  }

  private analysisItems(dto: AnalysisDto, prev: RiskAnalysis['items'] = []) {
    const factors = (dto.kind === 'pestel' ? PESTEL_FACTORS : SWOT_FACTORS).map((f) => f.code);
    if (dto.items.some((i) => !factors.includes(i.factor))) throw new BadRequestException('أحد العوامل لا يتبع نوع التحليل');
    if ((dto.strategies ?? []).length && dto.kind !== 'swot') throw new BadRequestException('استراتيجيات TOWS لتحليل SWOT فقط');
    return dto.items.map((i) => {
      const old = i.id ? prev.find((p) => p.id === i.id) : undefined;
      return {
        id: old?.id ?? randomUUID(), factor: i.factor, text: i.text, impact: i.impact, likelihood: i.likelihood, trend: i.trend ?? null, note: i.note ?? null,
        riskId: old?.riskId ?? null,
      };
    });
  }

  async createAnalysis(actor: OrgUser, dto: AnalysisDto) {
    const org = actor.organizationId;
    const id = await this.db.transaction(async (em) => {
      const repo = em.getRepository(RiskAnalysis);
      const a = await repo.save(repo.create({
        organizationId: org, code: await this.core.nextCode(em, org, 'ANL'), kind: dto.kind, title: dto.title, scope: dto.scope ?? null,
        analysisDate: dto.analysisDate, items: this.analysisItems(dto), strategies: dto.strategies ?? [], summary: dto.summary ?? null, createdByName: actor.fullName,
      }));
      return a.id;
    });
    return this.getAnalysis(actor, id);
  }

  async updateAnalysis(actor: OrgUser, id: string, dto: AnalysisDto) {
    await this.db.transaction(async (em) => {
      const repo = em.getRepository(RiskAnalysis);
      const a = await repo.findOne({ where: { id, organizationId: actor.organizationId }, lock: { mode: 'pessimistic_write' } });
      if (!a) throw new NotFoundException('التحليل غير موجود');
      assertEditable(a);
      if (dto.kind !== a.kind) throw new BadRequestException('لا يتغير نوع التحليل بعد إنشائه');
      markEdited(a, actor.fullName);
      Object.assign(a, { title: dto.title, scope: dto.scope ?? null, analysisDate: dto.analysisDate, items: this.analysisItems(dto, a.items), strategies: dto.strategies ?? [], summary: dto.summary ?? null });
      await repo.save(a);
    });
    return this.getAnalysis(actor, id);
  }

  async removeAnalysis(actor: OrgUser, id: string) {
    const a = await this.db.getRepository(RiskAnalysis).findOne({ where: { id, organizationId: actor.organizationId } });
    if (!a) throw new NotFoundException('التحليل غير موجود');
    if (a.approvedAt || a.items.some((i) => i.riskId)) throw new ConflictException('تحليل معتمد أو نُقلت منه مخاطر للسجل لا يُحذف');
    await this.db.getRepository(RiskAnalysis).delete({ id });
  }

  /** تحويل عامل من التحليل (تهديد أو ضعف أو عامل خارجي) إلى خطر في السجل المؤسسي، بنفس الاحتمالية والأثر */
  async itemToRisk(actor: OrgUser, id: string, dto: ItemToRiskDto) {
    const org = actor.organizationId;
    const a = await this.db.getRepository(RiskAnalysis).findOne({ where: { id, organizationId: org } });
    if (!a) throw new NotFoundException('التحليل غير موجود');
    const item = a.items.find((i) => i.id === dto.itemId);
    if (!item) throw new NotFoundException('العامل غير موجود في التحليل');
    if (item.riskId) throw new ConflictException('هذا العامل نُقل للسجل بالفعل');
    if (['strength', 'opportunity'].includes(item.factor)) throw new BadRequestException('نقاط القوة والفرص لا تُنقل كمخاطر');
    const risk = await this.createRisk(actor, {
      title: item.text.slice(0, 250), description: item.note ?? `من تحليل ${a.kind === 'pestel' ? 'PESTEL' : 'SWOT'}: ${a.title}`,
      source: FACTOR_SOURCE[item.factor] ?? 'external', category: dto.category, ownerName: dto.ownerName ?? null,
      inherentLikelihood: item.likelihood, inherentImpact: item.impact, residualLikelihood: item.likelihood, residualImpact: item.impact,
      treatment: 'reduce', actions: [], kris: [], analysisId: a.id, analysisItemId: item.id,
    } as RiskDto);
    // ربط العامل بالخطر دون إعادة التحليل للاعتماد
    await this.db.query(
      `UPDATE risk_analyses SET items = (SELECT jsonb_agg(CASE WHEN i->>'id' = $2 THEN jsonb_set(i, '{riskId}', to_jsonb($3::text)) ELSE i END) FROM jsonb_array_elements(items) i) WHERE id = $1`,
      [a.id, item.id, risk.id]);
    return risk;
  }

  submitAnalysis(actor: OrgUser, id: string) {
    return this.core.transition(actor, 'analysis', (em) => em.getRepository(RiskAnalysis), id, { submit: true }, {
      beforeSubmit: (a) => { if (!a.items.length) throw new BadRequestException('أضف عوامل للتحليل قبل رفعه'); },
    });
  }

  decideAnalysis(actor: OrgUser, id: string, decision: 'approve' | 'return' | 'reject', note?: string | null) {
    return this.core.transition(actor, 'analysis', (em) => em.getRepository(RiskAnalysis), id, { decision, note });
  }
}
