import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { DataSource } from 'typeorm';
import { OrgUser } from '../../core/auth/decorators';
import { ComplaintStatus, QmsComplaint, QmsSurvey, QmsSurveyResponse, SurveyQuestion } from './entities/quality.entity';
import { ComplaintActionDto, ComplaintDto, SurveyAnswerDto, SurveyDto } from './quality.dto';
import { ImprovementService } from './improvement.service';
import { QmsCore, daysBetween, shortId, step, today } from './quality-core.service';

export const COMPLAINT_STATUS_LABELS: Record<ComplaintStatus, string> = {
  received: 'مستلمة', investigating: 'قيد الدراسة', resolved: 'تمت المعالجة والرد', closed: 'مغلقة', rejected: 'غير مقبولة',
};
export const CHANNEL_LABELS: Record<string, string> = {
  portal: 'الموقع الإلكتروني', phone: 'الهاتف', email: 'البريد الإلكتروني', visit: 'زيارة مباشرة', social: 'وسائل التواصل', box: 'صندوق الشكاوى', other: 'أخرى',
};
export const PARTY_LABELS: Record<string, string> = {
  beneficiary: 'عميل', donor: 'داعم أو مانح', volunteer: 'متطوع', employee: 'موظف', partner: 'شريك', community: 'المجتمع',
};

/** الشكاوى (9.1.2 و10.2) وقياس الرضا (9.1.2) */
@Injectable()
export class FeedbackService {
  constructor(private readonly db: DataSource, private readonly core: QmsCore, private readonly improvement: ImprovementService) {}

  // ---------------- الشكاوى ----------------

  private complaintRow(c: QmsComplaint, depts: Record<string, string>, targetDays: number) {
    const t = today();
    const open = c.status === 'received' || c.status === 'investigating';
    const days = daysBetween(c.receivedDate, c.resolvedDate ?? t);
    return {
      ...c, code: `CMP-${c.receivedDate.slice(0, 4)}-${String(c.complaintNo).padStart(3, '0')}`, statusLabel: COMPLAINT_STATUS_LABELS[c.status],
      channelLabel: CHANNEL_LABELS[c.channel] ?? c.channel, partyLabel: PARTY_LABELS[c.partyType] ?? c.partyType, departmentName: depts[c.department] ?? c.department,
      days, late: open && days > targetDays, targetDays,
    };
  }

  async complaints(actor: OrgUser, q: { status?: string }) {
    const s = await this.core.settings(actor.organizationId);
    const depts = await this.core.deptNames(actor.organizationId);
    const rows = await this.db.getRepository(QmsComplaint).find({ where: { organizationId: actor.organizationId }, order: { complaintNo: 'DESC' } });
    const list = rows.map((c) => this.complaintRow(c, depts, s.complaintDays))
      .filter((c) => !q.status || (q.status === 'open' ? c.status === 'received' || c.status === 'investigating' : c.status === q.status));
    return { rows: list, pendingImports: (await this.portalComplaints(actor.organizationId)).length, targetDays: s.complaintDays };
  }

  async complaint(actor: OrgUser, id: string) {
    const c = await this.db.getRepository(QmsComplaint).findOne({ where: { id, organizationId: actor.organizationId } });
    if (!c) throw new NotFoundException('الشكوى غير موجودة');
    const s = await this.core.settings(actor.organizationId);
    return this.complaintRow(c, await this.core.deptNames(actor.organizationId), s.complaintDays);
  }

  async createComplaint(actor: OrgUser, dto: ComplaintDto, externalRef: string | null = null) {
    const org = actor.organizationId;
    await this.core.department(org, dto.department);
    const c = await this.db.transaction(async (em) => {
      const complaintNo = await this.core.nextNo(em, 'quality_complaints', 'complaint_no', org);
      return em.save(em.create(QmsComplaint, {
        organizationId: org, complaintNo, channel: dto.channel, partyType: dto.partyType, complainantName: dto.complainantName ?? null, contact: dto.contact ?? null,
        subject: dto.subject, details: dto.details, category: dto.category ?? null, department: dto.department, receivedDate: dto.receivedDate,
        assignedTo: dto.assignedTo ?? null, externalRef, history: [step(actor, 'received')],
      }));
    });
    return this.complaint(actor, c.id);
  }

  /** دراسة الشكوى والرد عليها وإغلاقها، أو تحويلها لحالة عدم مطابقة عند تكرارها أو جسامتها */
  async actComplaint(actor: OrgUser, id: string, dto: ComplaintActionDto) {
    const repo = this.db.getRepository(QmsComplaint);
    const c = await repo.findOne({ where: { id, organizationId: actor.organizationId } });
    if (!c) throw new NotFoundException('الشكوى غير موجودة');
    const open = c.status === 'received' || c.status === 'investigating';
    switch (dto.action) {
      case 'investigate':
        if (!open) throw new BadRequestException('الشكوى ليست مفتوحة');
        Object.assign(c, { status: 'investigating', investigation: dto.investigation ?? c.investigation, assignedTo: dto.assignedTo ?? c.assignedTo });
        break;
      case 'resolve':
        if (!open) throw new BadRequestException('الشكوى ليست مفتوحة');
        if (!dto.response) throw new BadRequestException('اكتب الرد على صاحب الشكوى والإجراء المتخذ');
        Object.assign(c, { status: 'resolved', investigation: dto.investigation ?? c.investigation, response: dto.response, resolvedDate: today() });
        break;
      case 'reject':
        if (!open) throw new BadRequestException('الشكوى ليست مفتوحة');
        if (!dto.response) throw new BadRequestException('اكتب سبب عدم قبول الشكوى');
        Object.assign(c, { status: 'rejected', response: dto.response, resolvedDate: today() });
        break;
      case 'close':
        if (c.status !== 'resolved') throw new BadRequestException('تُغلق الشكوى بعد الرد عليها');
        Object.assign(c, { status: 'closed', satisfaction: dto.satisfaction ?? null });
        break;
      case 'ncr': {
        if (c.ncrId) throw new BadRequestException('سُجلت حالة عدم مطابقة لهذه الشكوى من قبل');
        const code = `CMP-${c.receivedDate.slice(0, 4)}-${String(c.complaintNo).padStart(3, '0')}`;
        const n = await this.db.transaction((em) => this.improvement.insertNcr(em, actor, {
          source: 'complaint', sourceRef: code, title: c.subject, description: `${c.details}${c.investigation ? `\n\nنتيجة الدراسة: ${c.investigation}` : ''}`,
          severity: dto.severity ?? 'minor', department: c.department, detectedDate: today(), clause: '8.7',
        }, { complaintId: c.id }));
        c.ncrId = n.id;
        if (c.status === 'received') c.status = 'investigating';
        break;
      }
    }
    c.history = [...c.history, step(actor, dto.action, dto.response ?? dto.investigation ?? null)];
    await repo.save(c);
    return this.complaint(actor, c.id);
  }

  /**
   * الشكاوى الواردة من بوابة العملاء وصفحة التطوع العامة ولم تُسجَّل بعد في سجل الجودة
   * (قراءة فقط من وحدتي العملاء والتطوع)
   */
  async portalComplaints(org: string) {
    const ben: { id: string; ticket_no: number; subject: string; message: string; created_at: Date; full_name: string; phone: string | null }[] = await this.db.query(
      `SELECT t.id, t.ticket_no, t.subject, t.message, t.created_at, b.full_name, b.phone
         FROM beneficiary_tickets t JOIN beneficiaries b ON b.id = t.beneficiary_id
        WHERE t.organization_id = $1 AND t.type = 'complaint'
          AND NOT EXISTS (SELECT 1 FROM quality_complaints q WHERE q.organization_id = $1 AND q.external_ref = 'BEN-TKT:' || t.id::text)`, [org]);
    const vol: { id: string; ticket_no: string; subject: string; body: string; created_at: Date; sender_name: string; sender_mobile: string | null; sender_type: string }[] = await this.db.query(
      `SELECT t.id, t.ticket_no, t.subject, t.body, t.created_at, t.sender_name, t.sender_mobile, t.sender_type
         FROM vol_tickets t
        WHERE t.organization_id = $1 AND t.kind = 'complaint'
          AND NOT EXISTS (SELECT 1 FROM quality_complaints q WHERE q.organization_id = $1 AND q.external_ref = 'VOL-TKT:' || t.id::text)`, [org]).catch(() => []);
    return [
      ...ben.map((r) => ({
        id: r.id, source: 'beneficiaries' as const, sourceLabel: 'الموقع الإلكتروني', ticketNo: String(r.ticket_no), subject: r.subject, message: r.message, createdAt: r.created_at,
        name: r.full_name, phone: r.phone, partyType: 'beneficiary',
      })),
      ...vol.map((r) => ({
        id: r.id, source: 'volunteers' as const, sourceLabel: 'صفحة التطوع', ticketNo: r.ticket_no, subject: r.subject, message: r.body, createdAt: r.created_at,
        name: r.sender_name, phone: r.sender_mobile, partyType: r.sender_type === 'beneficiary' ? 'beneficiary' : r.sender_type === 'volunteer' ? 'volunteer' : 'community',
      })),
    ].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }

  async importPortal(actor: OrgUser, ticketId: string) {
    const t = (await this.portalComplaints(actor.organizationId)).find((x) => x.id === ticketId);
    if (!t) throw new NotFoundException('الشكوى غير موجودة أو سُجلت من قبل');
    const depts = (await this.core.settings(actor.organizationId)).departments;
    const want = t.source === 'volunteers' ? 'VOL' : 'BEN';
    return this.createComplaint(actor, {
      channel: t.source === 'volunteers' ? 'other' : 'portal', partyType: t.partyType, complainantName: t.name, contact: t.phone, subject: t.subject, details: t.message,
      category: t.source === 'volunteers' ? 'التطوع' : 'خدمات العملاء', department: depts.find((d) => d.code === want) ? want : depts[0].code,
      receivedDate: new Date(new Date(t.createdAt).getTime() + 3 * 3600000).toISOString().slice(0, 10),
    }, `${t.source === 'volunteers' ? 'VOL' : 'BEN'}-TKT:${t.id}`);
  }

  // ---------------- استبانات قياس الرضا ----------------

  /** مؤشر الرضا من 100: متوسط أسئلة التقييم (1 = 0%، 5 = 100%) */
  static score(questions: SurveyQuestion[], answers: Record<string, string | number>) {
    const vals = questions.filter((q) => q.type === 'rating').map((q) => Number(answers[q.id])).filter((v) => v >= 1 && v <= 5);
    return vals.length ? Math.round((vals.reduce((s, v) => s + (v - 1) / 4, 0) / vals.length) * 10000) / 100 : null;
  }

  private normQuestions(qs: SurveyDto['questions']): SurveyQuestion[] {
    return qs.map((q) => {
      const options = q.type === 'choice' ? (q.options ?? []).map((o) => o.trim()).filter(Boolean) : undefined;
      if (q.type === 'choice' && (options?.length ?? 0) < 2) throw new BadRequestException(`أضف خيارين على الأقل للسؤال "${q.text}"`);
      return { id: q.id || shortId(), text: q.text, type: q.type, ...(options ? { options } : {}) };
    });
  }

  async surveys(actor: OrgUser) {
    const rows = await this.db.getRepository(QmsSurvey).find({ where: { organizationId: actor.organizationId }, order: { createdAt: 'DESC' } });
    const stats: { survey_id: string; n: string; avg: string | null }[] = await this.db.query(
      `SELECT survey_id, COUNT(*) AS n, AVG(score) AS avg FROM quality_survey_responses WHERE organization_id = $1 GROUP BY survey_id`, [actor.organizationId]);
    const by = new Map(stats.map((s) => [s.survey_id, s]));
    return rows.map((s) => ({
      id: s.id, title: s.title, audience: s.audience, audienceLabel: PARTY_LABELS[s.audience] ?? s.audience, status: s.status, formCode: s.formCode,
      questions: s.questions.length, responses: Number(by.get(s.id)?.n ?? 0), targetResponses: s.targetResponses,
      index: by.get(s.id)?.avg ? Math.round(Number(by.get(s.id)!.avg) * 10) / 10 : null, publicToken: s.publicToken, createdAt: s.createdAt,
    }));
  }

  async survey(actor: OrgUser, id: string) {
    const s = await this.db.getRepository(QmsSurvey).findOne({ where: { id, organizationId: actor.organizationId } });
    if (!s) throw new NotFoundException('الاستبانة غير موجودة');
    const responses = await this.db.getRepository(QmsSurveyResponse).find({ where: { surveyId: s.id }, order: { createdAt: 'DESC' } });
    // تحليل كل سؤال: متوسط التقييم وتوزيعه، أو تكرار الخيارات، أو التعليقات
    const analysis = s.questions.map((q) => {
      const vals = responses.map((r) => r.answers[q.id]).filter((v) => v !== undefined && v !== null && v !== '');
      if (q.type === 'rating') {
        const nums = vals.map(Number).filter((v) => v >= 1 && v <= 5);
        const dist = [1, 2, 3, 4, 5].map((k) => nums.filter((v) => v === k).length);
        const avg = nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : null;
        return { ...q, count: nums.length, average: avg ? Math.round(avg * 100) / 100 : null, index: avg ? Math.round(((avg - 1) / 4) * 1000) / 10 : null, distribution: dist };
      }
      if (q.type === 'choice') return { ...q, count: vals.length, counts: (q.options ?? []).map((o) => ({ option: o, count: vals.filter((v) => v === o).length })) };
      return { ...q, count: vals.length, comments: vals.slice(0, 50).map(String) };
    });
    const scores = responses.map((r) => r.score).filter((v): v is number => v !== null);
    return {
      ...s, audienceLabel: PARTY_LABELS[s.audience] ?? s.audience, responses: responses.length, analysis,
      index: scores.length ? Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 10) / 10 : null,
      recent: responses.slice(0, 20).map((r) => ({ id: r.id, respondentName: r.respondentName, channel: r.channel, score: r.score, createdAt: r.createdAt })),
    };
  }

  async saveSurvey(actor: OrgUser, dto: SurveyDto, id?: string) {
    const repo = this.db.getRepository(QmsSurvey);
    const questions = this.normQuestions(dto.questions);
    if (!questions.length) throw new BadRequestException('أضف سؤالًا واحدًا على الأقل');
    const body = { title: dto.title, audience: dto.audience, description: dto.description ?? null, formCode: dto.formCode?.toUpperCase() ?? null, questions, targetResponses: dto.targetResponses ?? 0 };
    if (id) {
      const s = await repo.findOne({ where: { id, organizationId: actor.organizationId } });
      if (!s) throw new NotFoundException('الاستبانة غير موجودة');
      const answered = await this.db.getRepository(QmsSurveyResponse).count({ where: { surveyId: s.id } });
      if (answered && JSON.stringify(s.questions.map((q) => q.id)) !== JSON.stringify(questions.map((q) => q.id))) {
        throw new BadRequestException('للاستبانة ردود، فلا تُضاف أسئلة أو تُحذف. أنشئ استبانة جديدة للدورة القادمة');
      }
      await repo.save(Object.assign(s, body));
      return this.survey(actor, s.id);
    }
    const s = await repo.save(repo.create({ organizationId: actor.organizationId, ...body, publicToken: randomBytes(12).toString('hex'), createdByName: actor.fullName }));
    return this.survey(actor, s.id);
  }

  async setSurveyStatus(actor: OrgUser, id: string, status: 'draft' | 'open' | 'closed') {
    const repo = this.db.getRepository(QmsSurvey);
    const s = await repo.findOne({ where: { id, organizationId: actor.organizationId } });
    if (!s) throw new NotFoundException('الاستبانة غير موجودة');
    s.status = status;
    await repo.save(s);
    return this.survey(actor, id);
  }

  private validAnswers(s: QmsSurvey, answers: Record<string, string | number>) {
    const clean: Record<string, string | number> = {};
    for (const q of s.questions) {
      const v = answers[q.id];
      if (v === undefined || v === null || v === '') continue;
      if (q.type === 'rating') {
        const n = Number(v);
        if (!Number.isInteger(n) || n < 1 || n > 5) throw new BadRequestException(`التقييم من 1 إلى 5: ${q.text}`);
        clean[q.id] = n;
      } else if (q.type === 'choice') {
        if (!q.options?.includes(String(v))) throw new BadRequestException(`اختر من الخيارات: ${q.text}`);
        clean[q.id] = String(v);
      } else clean[q.id] = String(v).slice(0, 2000);
    }
    if (!s.questions.filter((q) => q.type === 'rating').every((q) => clean[q.id] !== undefined)) throw new BadRequestException('أجب عن كل أسئلة التقييم');
    return clean;
  }

  /** إدخال رد من الموظف (استبانة ورقية أو هاتفية) */
  async addResponse(actor: OrgUser, id: string, dto: SurveyAnswerDto) {
    const s = await this.db.getRepository(QmsSurvey).findOne({ where: { id, organizationId: actor.organizationId } });
    if (!s) throw new NotFoundException('الاستبانة غير موجودة');
    if (s.status === 'draft') throw new BadRequestException('افتح الاستبانة أولًا');
    const answers = this.validAnswers(s, dto.answers);
    await this.db.getRepository(QmsSurveyResponse).save({
      organizationId: s.organizationId, surveyId: s.id, answers, score: FeedbackService.score(s.questions, answers), respondentName: dto.respondentName ?? null, channel: 'manual',
    });
    return this.survey(actor, s.id);
  }

  // ---------------- الرابط العام ----------------

  private async byToken(token: string) {
    const s = await this.db.getRepository(QmsSurvey).findOne({ where: { publicToken: token } });
    if (!s) throw new NotFoundException('الاستبانة غير موجودة');
    return s;
  }

  async publicSurvey(token: string) {
    const s = await this.byToken(token);
    const [org] = await this.db.query('SELECT name FROM organizations WHERE id = $1', [s.organizationId]);
    return { title: s.title, description: s.description, organizationName: org?.name ?? '', questions: s.questions, open: s.status === 'open', formCode: s.formCode };
  }

  async publicAnswer(token: string, dto: SurveyAnswerDto) {
    const s = await this.byToken(token);
    if (s.status !== 'open') throw new BadRequestException('الاستبانة مغلقة حاليًا');
    const answers = this.validAnswers(s, dto.answers);
    await this.db.getRepository(QmsSurveyResponse).save({
      organizationId: s.organizationId, surveyId: s.id, answers, score: FeedbackService.score(s.questions, answers), respondentName: dto.respondentName ?? null, channel: 'link',
    });
    return { ok: true };
  }
}
