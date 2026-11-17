import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { DataSource, In } from 'typeorm';
import { OrgUser } from '../../core/auth/decorators';
import { AUDIENCES, Audience, EventStatus, VolEvent, VolParticipation, VolSurveyResponse, VolVolunteer } from './entities/volunteers.entity';
import { VOL_PERMISSIONS as P } from './volunteers.manifest';
import { AttendanceDto, ClosureDto, DecisionDto, EventDto, ParticipantsDto, SurveyAnswerDto } from './volunteers.dto';
import { VolCore, today, token } from './vol-core.service';
import { scoreSurvey, validateAnswers } from './vol-forms';

export const EVENT_STATUS: Record<EventStatus, string> = {
  draft: 'مسودة', in_review: 'قيد الاعتماد', returned: 'معادة للتعديل', rejected: 'مرفوضة', approved: 'معتمدة', closed: 'مغلقة', cancelled: 'ملغاة',
};
export const EVENT_KINDS = { field: 'ميدانية', online: 'عن بعد' } as const;
const round2 = (n: number) => Math.round(n * 100) / 100;

/** الفعاليات: الإنشاء بنموذج مرن، مراحل الاعتماد، ترشيح المتطوعين وتحضيرهم، تقرير الإغلاق، واستبانة الرضا */
@Injectable()
export class EventsService {
  constructor(private readonly db: DataSource, private readonly core: VolCore) {}

  async event(org: string, id: string) {
    const e = await this.db.getRepository(VolEvent).findOne({ where: { id, organizationId: org } });
    if (!e) throw new NotFoundException('الفعالية غير موجودة');
    return e;
  }

  private async roleIds(actor: OrgUser) {
    const rows: { role_id: string }[] = await this.db.query('SELECT role_id FROM user_roles WHERE user_id = $1', [actor.id]);
    return new Set(rows.map((r) => r.role_id));
  }

  /** هل يملك المستخدم قرار المرحلة الحالية للفعالية */
  private canDecide(actor: OrgUser, e: VolEvent, roles: Set<string>) {
    if (e.status !== 'in_review') return false;
    if (!actor.isSuperadmin && !actor.permissions.includes(P.approveEvents)) return false;
    const stage = e.stages[e.stageIndex];
    if (!stage?.roleId || actor.isSuperadmin) return true;
    return roles.has(stage.roleId);
  }

  async list(actor: OrgUser, q: { status?: string; kind?: string; awaiting?: string }) {
    const org = actor.organizationId;
    const s = await this.core.settings(org);
    const where: Record<string, unknown> = { organizationId: org };
    if (q.status) where.status = q.status;
    if (q.kind) where.kind = q.kind;
    const events = await this.db.getRepository(VolEvent).find({ where, order: { startDate: 'DESC', createdAt: 'DESC' }, take: 1000 });
    const counts: { event_id: string; total: number; attended: number; hours: number }[] = events.length ? await this.db.query(
      `SELECT event_id, COUNT(*)::int AS total, COUNT(*) FILTER (WHERE status = 'attended')::int AS attended, COALESCE(SUM(hours) FILTER (WHERE status = 'attended'), 0)::float AS hours
       FROM vol_participations WHERE organization_id = $1 GROUP BY event_id`, [org]) : [];
    const surveys: { event_id: string; n: number; score: number | null }[] = events.length ? await this.db.query(
      'SELECT event_id, COUNT(*)::int AS n, AVG(score)::float AS score FROM vol_survey_responses WHERE organization_id = $1 GROUP BY event_id', [org]) : [];
    const cm = new Map(counts.map((c) => [c.event_id, c]));
    const sm = new Map(surveys.map((c) => [c.event_id, c]));
    const roles = await this.roleIds(actor);
    let rows = events.map((e) => ({
      ...this.summary(e, s),
      volunteers: cm.get(e.id)?.total ?? 0, attended: cm.get(e.id)?.attended ?? 0, hours: round2(cm.get(e.id)?.hours ?? 0),
      responses: sm.get(e.id)?.n ?? 0, satisfaction: sm.get(e.id)?.score != null ? round2(sm.get(e.id)!.score!) : null,
      canDecide: this.canDecide(actor, e, roles),
    }));
    if (q.awaiting === '1') rows = rows.filter((r) => r.canDecide);
    return rows;
  }

  private summary(e: VolEvent, s: Awaited<ReturnType<VolCore['settings']>>) {
    return {
      id: e.id, eventNo: e.eventNo, title: e.title, kind: e.kind, kindLabel: EVENT_KINDS[e.kind], categoryCode: e.categoryCode,
      categoryName: this.core.label(s.eventCategories, e.categoryCode), fields: e.fieldCodes.map((c) => this.core.label(s.volunteerFields, c)),
      location: e.location, platform: e.platform, startDate: e.startDate, endDate: e.endDate, startTime: e.startTime, endTime: e.endTime,
      plannedHours: e.plannedHours, volunteersNeeded: e.volunteersNeeded, targetBeneficiaries: e.targetBeneficiaries, status: e.status,
      statusLabel: EVENT_STATUS[e.status], stageName: e.status === 'in_review' ? e.stages[e.stageIndex]?.name ?? null : null,
      stageIndex: e.stageIndex, stagesCount: e.stages.length, supervisorName: e.supervisorName, createdByName: e.createdByName,
    };
  }

  async detail(actor: OrgUser, id: string) {
    const org = actor.organizationId;
    const e = await this.event(org, id);
    const s = await this.core.settings(org);
    const participants: Record<string, unknown>[] = await this.db.query(
      `SELECT p.id, p.volunteer_id, p.role, p.status, p.hours::float AS hours, p.rating, p.note, v.full_name, v.volunteer_no, v.mobile, v.gender
       FROM vol_participations p JOIN vol_volunteers v ON v.id = p.volunteer_id WHERE p.event_id = $1 ORDER BY v.full_name`, [id]);
    const roles = await this.roleIds(actor);
    return {
      ...e,
      ...this.summary(e, s),
      eventFields: s.eventFields,
      closureFields: s.closureFields,
      canDecide: this.canDecide(actor, e, roles),
      participants: participants.map((p) => ({
        id: p.id as string, volunteerId: p.volunteer_id as string, volunteerName: p.full_name as string, volunteerNo: p.volunteer_no as number,
        mobile: p.mobile as string, gender: p.gender as string, role: p.role as string | null, status: p.status as string, hours: p.hours as number,
        rating: p.rating as number | null, note: p.note as string | null,
      })),
      survey: await this.surveyResults(org, e),
    };
  }

  private async check(org: string, dto: EventDto) {
    const s = await this.core.settings(org);
    if (dto.startDate > dto.endDate) throw new BadRequestException('تاريخ بداية الفعالية بعد نهايتها');
    if (dto.kind === 'field' && !dto.location) throw new BadRequestException('اكتب موقع الفعالية الميدانية');
    if (dto.kind === 'online' && !dto.platform && !dto.onlineLink) throw new BadRequestException('اكتب المنصة أو رابط الفعالية عن بعد');
    this.core.checkCode(s.eventCategories, dto.categoryCode, 'تصنيف الفعالية');
    const fieldCodes = [...new Set(dto.fieldCodes ?? [])];
    fieldCodes.forEach((c) => this.core.checkCode(s.volunteerFields, c, 'مجال التطوع'));
    return {
      title: dto.title, kind: dto.kind, categoryCode: dto.categoryCode ?? null, fieldCodes, description: dto.description ?? null, objectives: dto.objectives ?? null,
      location: dto.kind === 'field' ? dto.location ?? null : null, platform: dto.kind === 'online' ? dto.platform ?? null : null,
      onlineLink: dto.kind === 'online' ? dto.onlineLink ?? null : null, startDate: dto.startDate, endDate: dto.endDate, startTime: dto.startTime ?? null,
      endTime: dto.endTime ?? null, plannedHours: dto.plannedHours, volunteersNeeded: dto.volunteersNeeded ?? 0, targetBeneficiaries: dto.targetBeneficiaries ?? 0,
      budget: dto.budget ?? 0, supervisorName: dto.supervisorName ?? null, answers: validateAnswers(s.eventFields, dto.answers),
    };
  }

  async create(actor: OrgUser, dto: EventDto) {
    const org = actor.organizationId;
    const data = await this.check(org, dto);
    const e = await this.db.transaction(async (em) => {
      const n = await this.core.nextNo(em, org, 'nextEventNo');
      return em.getRepository(VolEvent).save(em.getRepository(VolEvent).create({
        ...data, organizationId: org, eventNo: `EV-${dto.startDate.slice(0, 4)}-${String(n).padStart(3, '0')}`, createdByName: actor.fullName,
      }));
    });
    return this.detail(actor, e.id);
  }

  async update(actor: OrgUser, id: string, dto: EventDto) {
    const e = await this.event(actor.organizationId, id);
    if (!['draft', 'returned'].includes(e.status)) throw new BadRequestException('تُعدّل الفعالية وهي مسودة أو معادة للتعديل فقط');
    Object.assign(e, await this.check(actor.organizationId, dto));
    await this.db.getRepository(VolEvent).save(e);
    return this.detail(actor, id);
  }

  async remove(actor: OrgUser, id: string) {
    const e = await this.event(actor.organizationId, id);
    if (e.status !== 'draft' || e.approvalLog.length) throw new BadRequestException('تُحذف الفعالية المسودة التي لم تُرسل للاعتماد فقط، وغيرها يُلغى');
    await this.db.getRepository(VolParticipation).delete({ eventId: e.id });
    await this.db.getRepository(VolEvent).delete({ id: e.id });
  }

  private log(e: VolEvent, actor: OrgUser, decision: VolEvent['approvalLog'][number]['decision'], stage: string, note: string | null = null) {
    e.approvalLog = [...e.approvalLog, { stage, decision, byName: actor.fullName, at: new Date().toISOString(), note }];
  }

  /** إرسال الفعالية للاعتماد: تُنسخ مراحل الاعتماد الحالية من الإعدادات */
  async submit(actor: OrgUser, id: string) {
    const e = await this.event(actor.organizationId, id);
    if (!['draft', 'returned'].includes(e.status)) throw new BadRequestException('الفعالية أُرسلت للاعتماد مسبقًا');
    const s = await this.core.settings(actor.organizationId);
    validateAnswers(s.eventFields, e.answers);
    e.stages = s.eventStages.length ? s.eventStages : [{ name: 'الاعتماد', roleId: null }];
    e.stageIndex = 0;
    e.status = 'in_review';
    this.log(e, actor, 'submit', 'الإنشاء');
    await this.db.getRepository(VolEvent).save(e);
    return this.detail(actor, id);
  }

  async decide(actor: OrgUser, id: string, dto: DecisionDto) {
    const e = await this.event(actor.organizationId, id);
    if (e.status !== 'in_review') throw new BadRequestException('الفعالية ليست بانتظار الاعتماد');
    if (!this.canDecide(actor, e, await this.roleIds(actor))) throw new ForbiddenException('القرار في هذه المرحلة ليس من صلاحيتك');
    if (dto.decision !== 'approve' && !dto.note) throw new BadRequestException(dto.decision === 'return' ? 'اكتب سبب الإرجاع' : 'اكتب سبب الرفض');
    const stage = e.stages[e.stageIndex]?.name ?? 'الاعتماد';
    this.log(e, actor, dto.decision, stage, dto.note ?? null);
    if (dto.decision === 'approve') {
      if (e.stageIndex + 1 < e.stages.length) e.stageIndex += 1;
      else e.status = 'approved';
    } else {
      e.status = dto.decision === 'return' ? 'returned' : 'rejected';
      e.stageIndex = 0;
    }
    await this.db.getRepository(VolEvent).save(e);
    return this.detail(actor, id);
  }

  async cancel(actor: OrgUser, id: string, note: string | null) {
    const e = await this.event(actor.organizationId, id);
    if (['closed', 'cancelled', 'rejected'].includes(e.status)) throw new BadRequestException('لا يمكن إلغاء هذه الفعالية');
    if (!note) throw new BadRequestException('اكتب سبب الإلغاء');
    e.status = 'cancelled';
    this.log(e, actor, 'cancel', 'الإلغاء', note);
    await this.db.getRepository(VolEvent).save(e);
    return this.detail(actor, id);
  }

  // ---------------- المتطوعون في الفعالية ----------------

  /** ترشيح متطوعين نشطين للفعالية المعتمدة (أو قبل الاعتماد للتخطيط) */
  async addParticipants(actor: OrgUser, id: string, dto: ParticipantsDto) {
    const org = actor.organizationId;
    const e = await this.event(org, id);
    if (['closed', 'cancelled', 'rejected'].includes(e.status)) throw new BadRequestException('لا يمكن ترشيح متطوعين لفعالية مغلقة أو ملغاة');
    const ids = [...new Set(dto.volunteerIds)];
    if (!ids.length) throw new BadRequestException('اختر متطوعًا واحدًا على الأقل');
    const vols = await this.db.getRepository(VolVolunteer).find({ where: { organizationId: org, id: In(ids) } });
    if (vols.length !== ids.length) throw new NotFoundException('أحد المتطوعين غير موجود');
    const inactive = vols.find((v) => v.status !== 'active');
    if (inactive) throw new BadRequestException(`المتطوع «${inactive.fullName}» غير نشط`);
    await this.db.getRepository(VolParticipation).createQueryBuilder().insert().values(ids.map((v) => ({
      organizationId: org, eventId: id, volunteerId: v, role: dto.role ?? null, hours: 0,
    }))).orIgnore().execute();
    return this.detail(actor, id);
  }

  async removeParticipant(actor: OrgUser, id: string, participationId: string) {
    const e = await this.event(actor.organizationId, id);
    if (e.status === 'closed') throw new BadRequestException('الفعالية مغلقة');
    await this.db.getRepository(VolParticipation).delete({ id: participationId, eventId: e.id, organizationId: actor.organizationId });
    return this.detail(actor, id);
  }

  /** التحضير: الحضور والساعات الفعلية وتقييم المشرف (بعد الاعتماد وحتى الإغلاق) */
  async attendance(actor: OrgUser, id: string, dto: AttendanceDto) {
    const e = await this.event(actor.organizationId, id);
    if (e.status !== 'approved') throw new BadRequestException('التحضير للفعالية المعتمدة قبل إغلاقها');
    if (e.startDate > today()) throw new BadRequestException('لم تبدأ الفعالية بعد، والتحضير يكون من يوم بدايتها');
    const repo = this.db.getRepository(VolParticipation);
    const rows = await repo.find({ where: { eventId: e.id } });
    const map = new Map(rows.map((r) => [r.id, r]));
    for (const r of dto.rows) {
      const p = map.get(r.id);
      if (!p) throw new NotFoundException('أحد المتطوعين ليس في الفعالية');
      if (r.status !== 'attended' && r.hours > 0) throw new BadRequestException('الساعات تُسجل للحاضرين فقط');
      Object.assign(p, { status: r.status, hours: r.status === 'attended' ? r.hours : 0, rating: r.rating ?? null, role: r.role ?? p.role, note: r.note ?? null });
    }
    await repo.save([...map.values()]);
    return this.detail(actor, id);
  }

  /** تقرير إغلاق الفعالية، ويصدر معه رابط استبانة الرضا */
  async close(actor: OrgUser, id: string, dto: ClosureDto) {
    const org = actor.organizationId;
    const e = await this.event(org, id);
    if (e.status !== 'approved') throw new BadRequestException('تُغلق الفعالية المعتمدة فقط');
    if (e.endDate > today()) throw new BadRequestException('لا تُغلق الفعالية قبل يوم نهايتها');
    const pending = await this.db.getRepository(VolParticipation).count({ where: { eventId: e.id, status: 'registered' } });
    if (pending) throw new BadRequestException(`حضّر المتطوعين أولًا: ${pending} متطوع بدون تسجيل حضور أو غياب`);
    const s = await this.core.settings(org);
    Object.assign(e, {
      actualBeneficiaries: dto.actualBeneficiaries, closureSummary: dto.closureSummary, achievements: dto.achievements ?? null, challenges: dto.challenges ?? null,
      recommendations: dto.recommendations ?? null, actualCost: dto.actualCost ?? null, closureAnswers: validateAnswers(s.closureFields, dto.closureAnswers),
      status: 'closed', closedAt: new Date(), closedByName: actor.fullName,
    });
    this.log(e, actor, 'close', 'تقرير الإغلاق');
    if (dto.openSurvey !== false) this.prepareSurvey(e, s);
    await this.db.getRepository(VolEvent).save(e);
    return this.detail(actor, id);
  }

  private prepareSurvey(e: VolEvent, s: Awaited<ReturnType<VolCore['settings']>>) {
    if (!e.surveyToken) e.surveyToken = token(12);
    if (!e.surveyQuestions) e.surveyQuestions = s.surveyQuestions;
    e.surveyOpen = true;
  }

  /** فتح الاستبانة أو إيقاف استقبال الردود */
  async setSurvey(actor: OrgUser, id: string, open: boolean) {
    const e = await this.event(actor.organizationId, id);
    if (e.status !== 'closed') throw new BadRequestException('تُصدر الاستبانة بعد إغلاق الفعالية بتقريرها');
    if (open) this.prepareSurvey(e, await this.core.settings(actor.organizationId));
    else e.surveyOpen = false;
    await this.db.getRepository(VolEvent).save(e);
    return this.detail(actor, id);
  }

  // ---------------- الاستبانة ----------------

  async surveyResults(org: string, e: VolEvent) {
    if (!e.surveyToken) return null;
    const rows = await this.db.getRepository(VolSurveyResponse).find({ where: { organizationId: org, eventId: e.id }, order: { createdAt: 'DESC' } });
    const result = {} as Record<Audience, unknown>;
    for (const a of AUDIENCES) {
      const qs = e.surveyQuestions?.[a] ?? [];
      const list = rows.filter((r) => r.audience === a);
      const scored = list.filter((r) => r.score !== null);
      result[a] = {
        responses: list.length,
        satisfaction: scored.length ? round2(scored.reduce((x, r) => x + r.score!, 0) / scored.length) : null,
        questions: qs.map((q) => {
          const vals = list.map((r) => r.answers[q.key]).filter((v) => v !== undefined && v !== null && v !== '');
          if (q.type === 'rating') {
            const nums = vals.map(Number);
            return { ...q, count: nums.length, average: nums.length ? round2(nums.reduce((x, y) => x + y, 0) / nums.length) : null, dist: [1, 2, 3, 4, 5].map((n) => nums.filter((v) => v === n).length) };
          }
          if (q.type === 'yesno') return { ...q, count: vals.length, yes: vals.filter((v) => v === 'yes').length, no: vals.filter((v) => v === 'no').length };
          return { ...q, count: vals.length, texts: vals.slice(0, 50).map(String) };
        }),
      };
    }
    return { token: e.surveyToken, open: e.surveyOpen, ...result };
  }

  /** صفحة الاستبانة العامة */
  async publicSurvey(t: string) {
    const e = await this.db.getRepository(VolEvent).findOne({ where: { surveyToken: t } });
    if (!e) throw new NotFoundException('رابط الاستبانة غير صحيح');
    const [org] = await this.db.query('SELECT name FROM organizations WHERE id = $1', [e.organizationId]);
    return {
      organizationName: org?.name, eventTitle: e.title, kindLabel: EVENT_KINDS[e.kind], startDate: e.startDate, endDate: e.endDate, open: e.surveyOpen,
      questions: e.surveyQuestions ?? {},
    };
  }

  async answerSurvey(t: string, dto: SurveyAnswerDto) {
    const e = await this.db.getRepository(VolEvent).findOne({ where: { surveyToken: t } });
    if (!e) throw new NotFoundException('رابط الاستبانة غير صحيح');
    if (!e.surveyOpen) throw new BadRequestException('انتهى استقبال الردود على هذه الاستبانة');
    const { answers, score } = scoreSurvey(e.surveyQuestions?.[dto.audience] ?? [], dto.answers);
    await this.db.getRepository(VolSurveyResponse).save({
      organizationId: e.organizationId, eventId: e.id, audience: dto.audience, respondentName: dto.respondentName ?? null, answers, score,
    });
    return { ok: true };
  }

  /** كل الاستبانات الصادرة ونتائجها المختصرة */
  async surveys(actor: OrgUser) {
    const org = actor.organizationId;
    const rows: Record<string, unknown>[] = await this.db.query(
      `SELECT e.id, e.event_no, e.title, e.kind, e.end_date::text AS end_date, e.survey_open, e.survey_token,
         COUNT(r.id) FILTER (WHERE r.audience = 'volunteer')::int AS vol_n, AVG(r.score) FILTER (WHERE r.audience = 'volunteer')::float AS vol_score,
         COUNT(r.id) FILTER (WHERE r.audience = 'beneficiary')::int AS ben_n, AVG(r.score) FILTER (WHERE r.audience = 'beneficiary')::float AS ben_score
       FROM vol_events e LEFT JOIN vol_survey_responses r ON r.event_id = e.id
       WHERE e.organization_id = $1 AND e.survey_token IS NOT NULL GROUP BY e.id ORDER BY e.end_date DESC`, [org]);
    const r2 = (v: unknown) => (v === null || v === undefined ? null : round2(Number(v)));
    return rows.map((r) => ({
      id: r.id, eventNo: r.event_no, title: r.title, kind: r.kind, kindLabel: EVENT_KINDS[r.kind as 'field' | 'online'], endDate: r.end_date, open: r.survey_open,
      token: r.survey_token, volunteer: { responses: r.vol_n, satisfaction: r2(r.vol_score) }, beneficiary: { responses: r.ben_n, satisfaction: r2(r.ben_score) },
    }));
  }
}
