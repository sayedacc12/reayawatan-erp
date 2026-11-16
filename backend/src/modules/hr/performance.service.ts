import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import { OrgUser } from '../../core/auth/decorators';
import { CardStatus, HrCompetency, HrEmployee, HrJob, HrPerformanceCard, HrUnit } from './entities/hr.entity';
import { CardActionDto, CardCreateDto, CardUpdateDto } from './hr.dto';
import { HrCore } from './hr-core.service';
import { HR_PERMISSIONS as P } from './hr.manifest';
import { HrPolicy, performanceScore, round2 } from './hr-policy';

export const CARD_STATUS_AR: Record<CardStatus, string> = {
  draft: 'إعداد الأهداف', agreed: 'أهداف معتمدة، بانتظار التقييم', evaluated: 'مُقيَّمة، بانتظار الاعتماد', approved: 'معتمدة',
};

/**
 * بطاقة الأداء المستهدف: تبدأ من مؤشرات الوظيفة وجداراتها، ثم يُتفق على الأهداف بأوزان مجموعها 100%،
 * ثم يقيّم المدير نسبة الإنجاز ومستوى كل جدارة، ثم يعتمد صاحب الصلاحية النتيجة.
 */
@Injectable()
export class PerformanceService {
  constructor(
    private readonly db: DataSource,
    private readonly core: HrCore,
    @InjectRepository(HrPerformanceCard) private readonly cards: Repository<HrPerformanceCard>,
  ) {}

  private async card(org: string, id: string) {
    const c = await this.cards.findOne({ where: { id, organizationId: org } });
    if (!c) throw new NotFoundException('بطاقة الأداء غير موجودة');
    return c;
  }

  private score(policy: HrPolicy, c: HrPerformanceCard) {
    return performanceScore(policy, c.objectivesWeight, c.objectives, c.competencies);
  }

  async list(actor: OrgUser, year: number) {
    const org = actor.organizationId;
    const rows = await this.cards.find({ where: { organizationId: org, year } });
    const emps = await this.db.getRepository(HrEmployee).find({ where: { organizationId: org } });
    const units = new Map((await this.db.getRepository(HrUnit).find({ where: { organizationId: org } })).map((u) => [u.id, u.name]));
    const jobs = new Map((await this.db.getRepository(HrJob).find({ where: { organizationId: org } })).map((j) => [j.id, j.title]));
    const em = new Map(emps.map((e) => [e.id, e]));
    const withCard = new Set(rows.map((r) => r.employeeId));
    return {
      year,
      cards: rows.map((c) => {
        const e = em.get(c.employeeId);
        return {
          id: c.id, employeeId: c.employeeId, employeeName: e?.fullName ?? '', employeeNo: e?.employeeNo ?? null,
          unitName: e ? units.get(e.unitId) ?? '' : '', jobTitle: e ? jobs.get(e.jobId) ?? '' : '', status: c.status, statusLabel: CARD_STATUS_AR[c.status],
          objectives: c.objectives.length, competencies: c.competencies.length, finalScore: c.finalScore, rating: c.rating,
        };
      }).sort((a, b) => (a.employeeNo ?? 0) - (b.employeeNo ?? 0)),
      withoutCard: emps.filter((e) => e.status === 'active' && !withCard.has(e.id)).map((e) => ({ id: e.id, fullName: e.fullName, employeeNo: e.employeeNo })),
    };
  }

  async get(actor: OrgUser, id: string) {
    const org = actor.organizationId;
    const c = await this.card(org, id);
    const policy = await this.core.policy(org);
    const e = await this.db.getRepository(HrEmployee).findOneOrFail({ where: { id: c.employeeId } });
    const job = await this.db.getRepository(HrJob).findOne({ where: { id: e.jobId } });
    const unit = await this.db.getRepository(HrUnit).findOne({ where: { id: e.unitId } });
    const manager = e.managerId ? await this.db.getRepository(HrEmployee).findOne({ where: { id: e.managerId }, select: ['id', 'fullName'] }) : null;
    const comps = await this.db.getRepository(HrCompetency).find({ where: { organizationId: org, id: In(c.competencies.map((x) => x.competencyId).concat(['00000000-0000-0000-0000-000000000000'])) } });
    const cm = new Map(comps.map((x) => [x.id, x]));
    return {
      ...c, statusLabel: CARD_STATUS_AR[c.status],
      employee: { id: e.id, fullName: e.fullName, employeeNo: e.employeeNo, jobTitle: job?.title ?? '', unitName: unit?.name ?? '', managerName: manager?.fullName ?? null },
      competencies: c.competencies.map((x) => ({ ...x, levels: cm.get(x.competencyId)?.levels ?? [] })),
      preview: this.score(policy, c), bands: policy.performance.bands, maxAchievement: policy.performance.maxAchievement,
      allCompetencies: (await this.db.getRepository(HrCompetency).find({ where: { organizationId: org, isActive: true }, order: { name: 'ASC' } })).map((x) => ({ id: x.id, name: x.name })),
    };
  }

  private async build(org: string, employeeId: string, year: number, policy: HrPolicy) {
    const e = await this.db.getRepository(HrEmployee).findOne({ where: { id: employeeId, organizationId: org } });
    if (!e) throw new NotFoundException('الموظف غير موجود');
    if (e.status !== 'active') throw new BadRequestException(`خدمة ${e.fullName} منتهية`);
    const job = await this.db.getRepository(HrJob).findOneOrFail({ where: { id: e.jobId } });
    const comps = new Map((await this.db.getRepository(HrCompetency).find({ where: { organizationId: org } })).map((x) => [x.id, x.name]));
    return this.cards.create({
      organizationId: org, employeeId, year, objectivesWeight: policy.performance.objectivesWeight,
      objectives: job.kpis.map((k) => ({ title: k.title, weight: k.weight, target: k.unit ? `${k.target} ${k.unit}` : k.target, achievement: null, note: null })),
      competencies: job.competencies.map((x) => ({ competencyId: x.competencyId, name: comps.get(x.competencyId) ?? '', requiredLevel: x.level, rating: null })),
    });
  }

  async create(actor: OrgUser, dto: CardCreateDto) {
    const org = actor.organizationId;
    if (await this.cards.exist({ where: { organizationId: org, employeeId: dto.employeeId, year: dto.year } })) throw new ConflictException('للموظف بطاقة أداء لهذه السنة');
    const c = await this.cards.save(await this.build(org, dto.employeeId, dto.year, await this.core.policy(org)));
    return { id: c.id };
  }

  /** إنشاء بطاقات لكل الموظفين النشطين الذين ليست لهم بطاقة في السنة */
  async generate(actor: OrgUser, year: number) {
    const org = actor.organizationId;
    const policy = await this.core.policy(org);
    const active = await this.db.getRepository(HrEmployee).find({ where: { organizationId: org, status: 'active' }, select: ['id'] });
    const existing = new Set((await this.cards.find({ where: { organizationId: org, year }, select: ['employeeId'] })).map((c) => c.employeeId));
    let created = 0;
    for (const e of active.filter((x) => !existing.has(x.id))) {
      await this.cards.save(await this.build(org, e.id, year, policy));
      created++;
    }
    return { created };
  }

  async update(actor: OrgUser, id: string, dto: CardUpdateDto) {
    const org = actor.organizationId;
    const c = await this.card(org, id);
    if (c.status === 'approved' || c.status === 'evaluated') throw new BadRequestException('البطاقة مقفلة، أعد فتحها أولًا');
    if (dto.objectives) {
      if (c.status === 'draft') c.objectives = dto.objectives.map((o) => ({ title: o.title, weight: o.weight, target: o.target, achievement: null, note: o.note ?? null }));
      else {
        // بعد اعتماد الأهداف: يُعدَّل الإنجاز والملاحظات فقط
        if (dto.objectives.length !== c.objectives.length) throw new BadRequestException('لا يمكن تغيير الأهداف بعد اعتمادها');
        c.objectives = c.objectives.map((o, i) => ({ ...o, achievement: dto.objectives![i].achievement ?? null, note: dto.objectives![i].note ?? null }));
      }
    }
    if (dto.competencies) {
      const names = new Map((await this.db.getRepository(HrCompetency).find({ where: { organizationId: org } })).map((x) => [x.id, x.name]));
      if (c.status === 'draft') {
        const ids = dto.competencies.map((x) => x.competencyId);
        if (new Set(ids).size !== ids.length) throw new BadRequestException('جدارة مكررة');
        if (ids.some((x) => !names.has(x))) throw new BadRequestException('جدارة غير موجودة');
        c.competencies = dto.competencies.map((x) => ({ competencyId: x.competencyId, name: names.get(x.competencyId)!, requiredLevel: x.requiredLevel, rating: null }));
      } else {
        const r = new Map(dto.competencies.map((x) => [x.competencyId, x.rating ?? null]));
        c.competencies = c.competencies.map((x) => ({ ...x, rating: r.has(x.competencyId) ? r.get(x.competencyId)! : x.rating }));
      }
    }
    if (dto.managerNote !== undefined) c.managerNote = dto.managerNote ?? null;
    if (dto.employeeNote !== undefined) c.employeeNote = dto.employeeNote ?? null;
    await this.cards.save(c);
    return this.get(actor, id);
  }

  async action(actor: OrgUser, id: string, dto: CardActionDto) {
    const org = actor.organizationId;
    const c = await this.card(org, id);
    const can = (p: string) => actor.isSuperadmin || actor.permissions.includes(p);
    const policy = await this.core.policy(org);
    if (dto.action === 'agree') {
      if (c.status !== 'draft') throw new BadRequestException('الأهداف معتمدة بالفعل');
      if (!c.objectives.length && !c.competencies.length) throw new BadRequestException('أضف هدفًا أو جدارة على الأقل');
      const total = round2(c.objectives.reduce((s, o) => s + o.weight, 0));
      if (c.objectives.length && total !== 100) throw new BadRequestException(`مجموع أوزان الأهداف يجب أن يكون 100% (الحالي ${total}%)`);
      Object.assign(c, { status: 'agreed', agreedAt: new Date() });
    } else if (dto.action === 'evaluate') {
      if (c.status !== 'agreed') throw new BadRequestException('اعتمد الأهداف أولًا');
      if (c.objectives.some((o) => o.achievement === null)) throw new BadRequestException('أدخل نسبة الإنجاز لكل الأهداف');
      if (c.competencies.some((x) => x.rating === null)) throw new BadRequestException('قيّم مستوى كل الجدارات');
      const s = this.score(policy, c);
      Object.assign(c, { ...s, status: 'evaluated', evaluatedByName: actor.fullName, evaluatedAt: new Date() });
    } else if (dto.action === 'approve') {
      if (!can(P.approvePerformance)) throw new ForbiddenException('الاعتماد النهائي للتقييم لمن يملك صلاحيته');
      if (c.status !== 'evaluated') throw new BadRequestException('البطاقة لم تُقيَّم بعد');
      Object.assign(c, { status: 'approved', approvedByName: actor.fullName, approvedAt: new Date() });
    } else {
      if (c.status === 'evaluated' || c.status === 'approved') {
        if (!can(P.approvePerformance)) throw new ForbiddenException('إعادة فتح تقييم لمن يملك صلاحية الاعتماد');
        Object.assign(c, { status: 'agreed', finalScore: null, objectivesScore: null, competenciesScore: null, rating: null, approvedAt: null, approvedByName: null });
      } else if (c.status === 'agreed') Object.assign(c, { status: 'draft', agreedAt: null });
      else throw new BadRequestException('البطاقة في مرحلة الإعداد بالفعل');
    }
    await this.cards.save(c);
    return this.get(actor, id);
  }

  async remove(actor: OrgUser, id: string) {
    const c = await this.card(actor.organizationId, id);
    if (c.status !== 'draft') throw new ConflictException('لا تُحذف إلا البطاقة في مرحلة الإعداد');
    await this.cards.delete({ id: c.id });
  }
}
