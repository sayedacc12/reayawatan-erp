import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { DataSource, EntityManager, In } from 'typeorm';
import { OrgUser } from '../../core/auth/decorators';
import {
  allItems, AXES, catalogStats, computePerformance, EMPTY_FIGURES, FIGURES, FINANCIAL_PERFORMANCE, FIN_SPLIT, GRADES, FinFigureKey, FinFigures, findItem, itemPercent, opinionFactor,
  OPINION_AR, reachableSteps, STANDARDS,
} from './catalog';
import {
  GovAction, GovAlertState, GovAnswer, GovAssessment, GovFacts, GovObligation, GovSettings, ObligationKind, ScoreSummary,
} from './entities/governance.entity';
import { evaluate, Evaluation, impactFactor, Opportunity } from './gov-engine';
import { addDays, addMonths, daysBetween, GovFinance, today } from './gov-finance.service';
import { GovSignals } from './gov-signals.service';
import {
  AckDto, ActionDto, AnswerDto, AssessmentDto, AssessmentUpdateDto, FiguresDto, GapActionsDto, GenerateCalendarDto, ObligationDto, SettingsDto,
} from './governance.dto';
import { GOV_PERMISSIONS as P } from './governance.manifest';

export const KIND_AR: Record<string, string> = { self: 'تقييم ذاتي', mock: 'تقييم تجريبي (محاكاة)', official: 'نتيجة التقييم الرسمي' };
export const PERIOD_AR: Record<string, string> = { quarterly: 'ربعي', semiannual: 'نصف سنوي', annual: 'سنوي' };
export const STATUS_AR: Record<string, string> = { draft: 'مسودة', submitted: 'بانتظار الاعتماد', approved: 'معتمد' };
export const OBLIGATION_AR: Record<ObligationKind, string> = {
  board_meeting: 'اجتماع مجلس الإدارة', ga_meeting: 'اجتماع الجمعية العمومية', quarterly_report: 'التقرير المالي الربعي', annual_statements: 'القوائم المالية السنوية',
  programs_report: 'تقرير البرامج والأنشطة', budget: 'الموازنة التقديرية', disclosure: 'نموذج الإفصاح', self_assessment: 'التقييم الذاتي للحوكمة', other: 'أخرى',
};
export const ACTION_STATUS_AR: Record<string, string> = { planned: 'مخطط', in_progress: 'قيد التنفيذ', done: 'منجز', cancelled: 'ملغي' };
export const PRIORITY_AR: Record<string, string> = { low: 'منخفضة', medium: 'متوسطة', high: 'عالية', urgent: 'عاجلة' };

export type AlertLevel = 'critical' | 'warning' | 'info';
export interface GovAlert {
  key: string; level: AlertLevel; category: 'deadline' | 'finance' | 'compliance' | 'data' | 'plan';
  title: string; detail: string; ref: string | null; due: string | null; impact: number | null; link: string | null;
}
const CATEGORY_AR: Record<GovAlert['category'], string> = { deadline: 'المواعيد النظامية', finance: 'السلامة المالية', compliance: 'الامتثال والشفافية', data: 'اكتمال البيانات', plan: 'خطة التحسين' };
export { CATEGORY_AR };

const r2 = (v: number) => Math.round(v * 100) / 100;
/** بنود الدليل التي يخدمها كل نوع من الالتزامات (للربط في التقويم) */
const OBLIGATION_REFS: Record<ObligationKind, string[]> = {
  board_meeting: ['gov.board_meetings', 'gov.board_regular'],
  ga_meeting: ['members.ga_ordinary', 'members.ga_meeting', 'members.ga_notice', 'members.ga_quorum'],
  quarterly_report: ['gov.quarterly', 'gov.quarterly_board', 'gov.quarterly_ncnp'],
  annual_statements: ['gov.statements_issued', 'gov.statements_ga', 'gov.statements_ncnp'],
  programs_report: ['gov.programs_report_ncnp'],
  budget: ['acc.budget'],
  disclosure: ['gov.disclosure_filed', 'gov.disclosure_approved'],
  self_assessment: [],
  other: [],
};
const refsOf = (kind: ObligationKind) => allItems().filter((f) => f.item.auto && OBLIGATION_REFS[kind].includes(f.item.auto)).map((f) => f.item.code);

@Injectable()
export class GovernanceService {
  constructor(private readonly db: DataSource, private readonly finance: GovFinance, private readonly signals: GovSignals) {}

  // ---------------- الدليل والإعدادات ----------------

  catalog() {
    return {
      standards: STANDARDS, axes: AXES, stats: catalogStats(), figures: FIGURES, performance: FINANCIAL_PERFORMANCE, finSplit: FIN_SPLIT, grades: GRADES,
      opinions: OPINION_AR, kinds: KIND_AR, periods: PERIOD_AR, obligationKinds: OBLIGATION_AR,
    };
  }

  async getSettings(a: OrgUser) {
    const s = await this.finance.settings(a.organizationId);
    const ready = await this.finance.ready(a.organizationId);
    return {
      mapping: this.finance.mappingOf(s), overrides: s.mapping, defaults: Object.fromEntries(FIGURES.map((f) => [f.key, f.accounts])),
      figures: FIGURES, facts: s.facts, alertDays: s.alertDays, targetScore: s.targetScore, accounting: ready,
    };
  }

  async saveSettings(a: OrgUser, dto: SettingsDto) {
    const s = await this.finance.settings(a.organizationId);
    if (dto.mapping) {
      const keys = new Set(FIGURES.map((f) => f.key as string));
      const clean: GovSettings['mapping'] = {};
      for (const [k, rules] of Object.entries(dto.mapping)) {
        if (!keys.has(k)) throw new BadRequestException(`رقم مالي غير معروف: ${k}`);
        if (!Array.isArray(rules) || rules.length > 30) throw new BadRequestException('قائمة الحسابات غير صحيحة');
        for (const r of rules) {
          if (!r || typeof r.code !== 'string' || !/^\d{1,10}$/.test(r.code)) throw new BadRequestException(`رمز حساب غير صحيح: ${r?.code ?? ''}`);
          if (r.sign !== undefined && r.sign !== 1 && r.sign !== -1) throw new BadRequestException('الإشارة يجب أن تكون إضافة أو استبعاد');
        }
        const def = FIGURES.find((f) => f.key === k)!;
        const same = JSON.stringify(def.accounts.map((x) => [x.code, x.sign ?? 1])) === JSON.stringify(rules.map((x) => [x.code, x.sign ?? 1]));
        if (!same) clean[k as FinFigureKey] = rules.map((x) => ({ code: x.code, ...(x.sign === -1 ? { sign: -1 as const } : {}) }));
      }
      s.mapping = clean;
    }
    if (dto.facts) s.facts = sanitizeFacts(dto.facts);
    if (dto.alertDays !== undefined) s.alertDays = dto.alertDays;
    if (dto.targetScore !== undefined) s.targetScore = dto.targetScore;
    await this.db.getRepository(GovSettings).save(s);
    return this.getSettings(a);
  }

  /** معاينة الأرقام المالية بالربط الحالي (أو المعدّل قبل حفظه) لفترة */
  async financeView(a: OrgUser, to?: string) {
    const org = a.organizationId;
    const ready = await this.finance.ready(org);
    if (!ready.years) return { ready, snapshot: null, series: null };
    const t = to ?? today();
    const snap = await this.finance.snapshot(org, t);
    const series = await this.finance.series(org, t);
    return { ready, snapshot: snap, series };
  }

  // ---------------- تقويم الالتزامات ----------------

  async obligations(a: OrgUser, year?: number) {
    const rows = await this.db.getRepository(GovObligation).find({
      where: { organizationId: a.organizationId, ...(year ? { fiscalYear: year } : {}) }, order: { dueDate: 'ASC', title: 'ASC' },
    });
    const t = today();
    return rows.map((o) => ({ ...o, kindLabel: OBLIGATION_AR[o.kind], state: obligationState(o, t), daysLeft: daysBetween(t, o.dueDate) }));
  }

  async createObligation(a: OrgUser, dto: ObligationDto) {
    const repo = this.db.getRepository(GovObligation);
    const o = repo.create({
      organizationId: a.organizationId, kind: dto.kind, title: dto.title, dueDate: dto.dueDate, doneDate: dto.doneDate ?? null,
      fiscalYear: Number(dto.dueDate.slice(0, 4)), refs: refsOf(dto.kind), evidence: dto.evidence ?? null, note: dto.note ?? null,
      doneByName: dto.doneDate ? a.fullName : null,
    });
    await repo.save(o);
    return o;
  }

  async updateObligation(a: OrgUser, id: string, dto: ObligationDto) {
    const repo = this.db.getRepository(GovObligation);
    const o = await repo.findOne({ where: { id, organizationId: a.organizationId } });
    if (!o) throw new NotFoundException('الالتزام غير موجود');
    const wasDone = !!o.doneDate;
    Object.assign(o, { kind: dto.kind, title: dto.title, dueDate: dto.dueDate, doneDate: dto.doneDate ?? null, evidence: dto.evidence ?? null, note: dto.note ?? null });
    if (o.doneDate && !wasDone) o.doneByName = a.fullName;
    if (!o.doneDate) o.doneByName = null;
    if (dto.doneDate && dto.doneDate > today()) throw new BadRequestException('تاريخ الإنجاز لا يكون في المستقبل');
    await repo.save(o);
    return o;
  }

  async removeObligation(a: OrgUser, id: string) {
    const r = await this.db.getRepository(GovObligation).delete({ id, organizationId: a.organizationId });
    if (!r.affected) throw new NotFoundException('الالتزام غير موجود');
    return { ok: true };
  }

  /**
   * توليد الالتزامات النظامية لسنة مالية من الدليل: 4 اجتماعات مجلس (CMP-P13)، 4 تقارير مالية ربعية (CMP-P21)،
   * الاجتماع العادي للشركة العمومية والقوائم المالية وتقرير البرامج والموازنة خلال 4 أشهر من نهاية السنة (CMP-P20)،
   * ونموذج الإفصاح، و4 تقييمات ذاتية ربعية (توصية النظام). لا يكرر ما سبق توليده.
   */
  async generateCalendar(a: OrgUser, dto: GenerateCalendarDto) {
    const org = a.organizationId;
    const years = await this.finance.years(org);
    const fy = years.find((y) => y.name === dto.fiscalYear);
    const start = fy?.startDate ?? `${dto.fiscalYear}-01-01`;
    const end = fy?.endDate ?? `${dto.fiscalYear}-12-31`;
    const repo = this.db.getRepository(GovObligation);
    const existing = await repo.find({ where: { organizationId: org, fiscalYear: dto.fiscalYear } });
    const has = (kind: ObligationKind, title: string) => existing.some((o) => o.kind === kind && o.title === title);
    const rows: Partial<GovObligation>[] = [];
    const add = (kind: ObligationKind, title: string, dueDate: string, note: string | null = null) => {
      if (!has(kind, title)) rows.push({ organizationId: org, kind, title, dueDate, fiscalYear: dto.fiscalYear, refs: refsOf(kind), note });
    };
    const q = ['الأول', 'الثاني', 'الثالث', 'الرابع'];
    for (let i = 0; i < 4; i++) {
      const qEnd = addDays(addMonths(start, (i + 1) * 3), -1);
      add('board_meeting', `اجتماع مجلس الإدارة للربع ${q[i]} ${dto.fiscalYear}`, qEnd, 'لا يقل عدد اجتماعات المجلس عن 4 في السنة (اجتماع كل 3 أشهر)');
      add('quarterly_report', `التقرير المالي للربع ${q[i]} ${dto.fiscalYear}: إعداد المشرف المالي وعرضه على المجلس ورفع نسخة للمركز`, addDays(qEnd, 30), 'موعد داخلي مقترح: 30 يوماً بعد نهاية الربع');
      add('self_assessment', `التقييم الذاتي للحوكمة للربع ${q[i]} ${dto.fiscalYear}`, addDays(qEnd, 15), 'توصية النظام: تقييم تنبؤي كل ربع لمعالجة الفجوات قبل التقييم الفعلي');
    }
    const after4 = addMonths(end, 4);
    add('annual_statements', `القوائم المالية المدققة لسنة ${dto.fiscalYear}: اعتمادها من الجمعية العمومية ورفعها للمركز`, after4, 'خلال 4 أشهر من نهاية السنة المالية');
    add('programs_report', `التقرير السنوي للبرامج والأنشطة لسنة ${dto.fiscalYear} ورفعه للمركز ومجلس الإدارة`, after4, 'خلال 4 أشهر من نهاية السنة المالية');
    add('ga_meeting', `الاجتماع العادي للشركة العمومية عن سنة ${dto.fiscalYear}`, after4, 'خلال 4 أشهر من نهاية السنة المالية، والدعوة قبل 15 يوماً مع إبلاغ المركز والجهة المشرفة');
    add('budget', `الموازنة التقديرية لسنة ${dto.fiscalYear + 1} معتمدة من الجمعية العمومية`, after4, 'تُقر في الاجتماع العادي للشركة العمومية');
    add('disclosure', `نموذج الإفصاح السنوي لسنة ${dto.fiscalYear}`, after4, 'موعد داخلي مقترح مع التقارير السنوية');
    if (rows.length) await repo.save(rows.map((r) => repo.create(r)));
    return { created: rows.length, items: await this.obligations(a, dto.fiscalYear) };
  }

  // ---------------- التقييمات ----------------

  async assessments(a: OrgUser) {
    const rows = await this.db.getRepository(GovAssessment).find({ where: { organizationId: a.organizationId }, order: { periodTo: 'DESC', createdAt: 'DESC' } });
    return rows.map((r) => ({
      id: r.id, code: r.code, title: r.title, kind: r.kind, kindLabel: KIND_AR[r.kind], periodType: r.periodType, periodLabel: PERIOD_AR[r.periodType],
      fiscalYear: r.fiscalYear, periodFrom: r.periodFrom, periodTo: r.periodTo, status: r.status, statusLabel: STATUS_AR[r.status],
      scores: r.scores, approvedAt: r.approvedAt, approvedByName: r.approvedByName, createdByName: r.createdByName,
    }));
  }

  private async find(org: string, id: string, em: EntityManager = this.db.manager) {
    const x = await em.getRepository(GovAssessment).findOne({ where: { id, organizationId: org } });
    if (!x) throw new NotFoundException('التقييم غير موجود');
    return x;
  }

  private assertEditable(x: GovAssessment) {
    if (x.status !== 'draft') throw new ConflictException('التقييم مرفوع للاعتماد أو معتمد؛ أعد فتحه أولاً للتعديل');
  }

  async createAssessment(a: OrgUser, dto: AssessmentDto) {
    if (dto.periodFrom > dto.periodTo) throw new BadRequestException('بداية الفترة بعد نهايتها');
    const org = a.organizationId;
    const id = await this.db.transaction(async (em) => {
      const s = await this.finance.settings(org);
      await em.query(`SELECT 1 FROM gov_settings WHERE organization_id = $1 FOR UPDATE`, [org]);
      const no = returned(await em.query(`UPDATE gov_settings SET next_assessment_no = next_assessment_no + 1 WHERE organization_id = $1 RETURNING next_assessment_no - 1 AS n`, [org]));
      const fy = await this.finance.yearOf(org, dto.periodTo, true);
      const fiscalYear = fy ? fy.name : Number(dto.periodTo.slice(0, 4));
      const x = em.getRepository(GovAssessment).create({
        organizationId: org, code: `GOV-${fiscalYear}-${String(no).padStart(2, '0')}`, title: dto.title, kind: dto.kind, periodType: dto.periodType,
        fiscalYear, periodFrom: dto.periodFrom, periodTo: dto.periodTo, opinion: dto.opinion ?? 'unqualified', qualifiedItems: dto.qualifiedItems ?? 0,
        notes: dto.notes ?? null, createdByName: a.fullName, status: 'draft',
      });
      const fig = await this.finance.figures(org, dto.periodFrom, dto.periodTo, s);
      if (fig) { x.figures = fig.figures; x.figuresSource = 'ledger'; x.figuresAt = new Date(); }
      await em.save(x);
      if (dto.copyPrevious) {
        const prev = await em.getRepository(GovAssessment).findOne({ where: { organizationId: org, status: 'approved', kind: In(['self', 'mock']) }, order: { periodTo: 'DESC' } });
        if (prev) {
          const answers = await em.getRepository(GovAnswer).find({ where: { assessmentId: prev.id } });
          if (answers.length) {
            await em.getRepository(GovAnswer).save(answers.map((p) => em.getRepository(GovAnswer).create({
              organizationId: org, assessmentId: x.id, itemCode: p.itemCode, choices: p.choices, percent: p.percent, points: p.points,
              evidence: p.evidence, note: p.note ? `${p.note} (منقول من ${prev.code})` : `منقول من ${prev.code}`, fromSignal: false, answeredByName: a.fullName,
            })));
          }
        }
      }
      return x.id;
    });
    await this.recompute(org, id);
    return this.assessment(a, id);
  }

  async updateAssessment(a: OrgUser, id: string, dto: AssessmentUpdateDto) {
    const x = await this.find(a.organizationId, id);
    this.assertEditable(x);
    if (dto.title) x.title = dto.title;
    if (dto.opinion) x.opinion = dto.opinion;
    if (dto.qualifiedItems !== undefined) x.qualifiedItems = dto.qualifiedItems;
    if (dto.notes !== undefined) x.notes = dto.notes ?? null;
    await this.db.getRepository(GovAssessment).save(x);
    await this.recompute(a.organizationId, id);
    return this.assessment(a, id);
  }

  async removeAssessment(a: OrgUser, id: string) {
    const x = await this.find(a.organizationId, id);
    if (x.status === 'approved') throw new ConflictException('لا يُحذف تقييم معتمد');
    await this.db.transaction(async (em) => {
      await em.getRepository(GovAnswer).delete({ assessmentId: x.id });
      await em.getRepository(GovAction).update({ assessmentId: x.id }, { assessmentId: null });
      await em.getRepository(GovAssessment).delete({ id: x.id });
    });
    return { ok: true };
  }

  /** سياق الحساب: الإجابات والإشارات وآخر تقييم معتمد والأداء المالي الفعلي والمتوقع */
  private async context(org: string, x: GovAssessment) {
    const s = await this.finance.settings(org);
    const [answers, obligations, prev] = await Promise.all([
      this.db.getRepository(GovAnswer).find({ where: { assessmentId: x.id } }),
      this.db.getRepository(GovObligation).find({ where: { organizationId: org } }),
      this.db.getRepository(GovAssessment).findOne({ where: { organizationId: org, status: 'approved', kind: In(['self', 'mock', 'official']) }, order: { periodTo: 'DESC' } }),
    ]);
    const previous = new Map<string, number>();
    if (prev && prev.id !== x.id) {
      for (const p of await this.db.getRepository(GovAnswer).find({ where: { assessmentId: prev.id } })) if (p.percent !== null) previous.set(p.itemCode, p.percent);
    }
    const signals = x.kind === 'official' ? {} : await this.signals.collect(org, s.facts, obligations, x.periodTo < today() ? x.periodTo : today());
    const factor = opinionFactor(x.opinion, x.qualifiedItems);
    let performance = null;
    let forecast = null;
    if (x.figures) {
      performance = computePerformance(x.figures, factor);
      const fy = (await this.finance.years(org)).find((y) => y.startDate <= x.periodTo && y.endDate >= x.periodTo);
      if (fy && x.figuresSource === 'ledger') forecast = computePerformance(this.finance.annualize(x.figures, x.periodFrom < fy.startDate ? fy.startDate : x.periodFrom, x.periodTo, fy).figures, factor);
      else forecast = performance;
    }
    return { answers, signals, previous, performance, forecast, factor, settings: s };
  }

  private summary(e: Evaluation): ScoreSummary {
    return {
      overall: e.overall, predicted: e.predicted, coverage: e.coverage, grade: e.grade,
      axes: e.axes, performance: e.performance?.final ?? 0, regulation: e.standards.find((s) => s.code === 'FRG')!.score,
    };
  }

  private async recompute(org: string, id: string) {
    const x = await this.find(org, id);
    const ctx = await this.context(org, x);
    const e = evaluate({
      answers: new Map(ctx.answers.map((a) => [a.itemCode, a])), signals: ctx.signals, previous: ctx.previous, performance: ctx.performance, forecast: ctx.forecast,
    });
    await this.db.getRepository(GovAssessment).update({ id }, { scores: this.summary(e) });
    return { x, ctx, e };
  }

  async assessment(a: OrgUser, id: string) {
    const org = a.organizationId;
    const x = await this.find(org, id);
    const ctx = await this.context(org, x);
    const e = evaluate({
      answers: new Map(ctx.answers.map((v) => [v.itemCode, v])), signals: ctx.signals, previous: ctx.previous, performance: ctx.performance, forecast: ctx.forecast,
    });
    const canEdit = x.status === 'draft' && (a.isSuperadmin || a.permissions.includes(P.assess));
    return {
      assessment: {
        ...x, kindLabel: KIND_AR[x.kind], periodLabel: PERIOD_AR[x.periodType], statusLabel: STATUS_AR[x.status], opinionLabel: OPINION_AR[x.opinion], factor: ctx.factor,
      },
      answers: Object.fromEntries(ctx.answers.map((v) => [v.itemCode, {
        choices: v.choices, percent: v.percent, points: v.points, evidence: v.evidence, note: v.note, fromSignal: v.fromSignal, answeredByName: v.answeredByName, updatedAt: v.updatedAt,
      }])),
      evaluation: e,
      performance: ctx.performance, forecast: ctx.forecast,
      target: ctx.settings.targetScore,
      canEdit, canApprove: a.isSuperadmin || a.permissions.includes(P.approve),
    };
  }

  async answer(a: OrgUser, id: string, itemCode: string, dto: AnswerDto) {
    const org = a.organizationId;
    const x = await this.find(org, id);
    this.assertEditable(x);
    const flat = findItem(itemCode);
    if (!flat) throw new NotFoundException('البند غير موجود في الدليل');
    const it = flat.item;
    const choices = dto.choices.slice(0, it.steps.length).map((c, i) => {
      if (c === null || c === undefined) return null;
      if (!Number.isInteger(c) || c < 0 || c >= it.steps[i].o.length) throw new BadRequestException('اختيار غير صحيح لأحد الأسئلة');
      return c;
    });
    // ما بعد الإجابة المنهية لا يُحفظ
    const reach = reachableSteps(it, choices);
    const trimmed = choices.slice(0, reach);
    const percent = itemPercent(it, trimmed);
    const repo = this.db.getRepository(GovAnswer);
    const cur = await repo.findOne({ where: { assessmentId: x.id, itemCode } });
    const row = cur ?? repo.create({ organizationId: org, assessmentId: x.id, itemCode });
    Object.assign(row, {
      choices: trimmed, percent, points: percent === null ? 0 : r2((it.points * percent) / 100) , evidence: dto.evidence ?? null, note: dto.note ?? null,
      fromSignal: false, answeredByName: a.fullName,
    });
    await repo.save(row);
    const { e } = await this.recompute(org, id);
    return { itemCode, percent, points: row.points, scores: this.summary(e) };
  }

  async clearAnswer(a: OrgUser, id: string, itemCode: string) {
    const x = await this.find(a.organizationId, id);
    this.assertEditable(x);
    await this.db.getRepository(GovAnswer).delete({ assessmentId: x.id, itemCode });
    const { e } = await this.recompute(a.organizationId, id);
    return { itemCode, scores: this.summary(e) };
  }

  /** اعتماد اقتراحات الإشارات الآلية للبنود غير المُجاب عليها (يراجعها المقيّم بعد ذلك) */
  async applySuggestions(a: OrgUser, id: string) {
    const org = a.organizationId;
    const x = await this.find(org, id);
    this.assertEditable(x);
    const ctx = await this.context(org, x);
    const e = evaluate({ answers: new Map(ctx.answers.map((v) => [v.itemCode, v])), signals: ctx.signals, previous: ctx.previous, performance: ctx.performance });
    const repo = this.db.getRepository(GovAnswer);
    const rows: GovAnswer[] = [];
    for (const s of e.standards) for (const i of s.indicators) for (const p of i.practices) for (const it of p.items) {
      if (it.answered || !it.suggested || it.suggestedPercent === null) continue;
      rows.push(repo.create({
        organizationId: org, assessmentId: x.id, itemCode: it.code, choices: it.suggested, percent: it.suggestedPercent,
        points: r2((it.points * it.suggestedPercent) / 100), evidence: it.signal ? `${it.signal.source}: ${it.signal.text}` : null, note: null, fromSignal: true, answeredByName: a.fullName,
      }));
    }
    if (rows.length) await repo.save(rows);
    await this.recompute(org, id);
    return { applied: rows.length, ...(await this.assessment(a, id)) };
  }

  async refreshFigures(a: OrgUser, id: string) {
    const org = a.organizationId;
    const x = await this.find(org, id);
    this.assertEditable(x);
    const fig = await this.finance.figures(org, x.periodFrom, x.periodTo);
    if (!fig) throw new BadRequestException('لا توجد سنة مالية في النظام المالي تغطي فترة التقييم');
    await this.db.getRepository(GovAssessment).update({ id }, { figures: fig.figures, figuresSource: 'ledger', figuresAt: new Date() });
    await this.recompute(org, id);
    return this.assessment(a, id);
  }

  /** إدخال الأرقام يدوياً من القوائم المالية المدققة (للتقييم الرسمي أو عند عدم استخدام النظام المالي) */
  async setFigures(a: OrgUser, id: string, dto: FiguresDto) {
    const org = a.organizationId;
    const x = await this.find(org, id);
    this.assertEditable(x);
    const f: FinFigures = EMPTY_FIGURES();
    for (const def of FIGURES) {
      const v = Number(dto.figures[def.key] ?? 0);
      if (!Number.isFinite(v) || Math.abs(v) > 1e13) throw new BadRequestException(`قيمة غير صحيحة: ${def.label}`);
      f[def.key] = r2(v);
    }
    await this.db.getRepository(GovAssessment).update({ id }, { figures: f, figuresSource: 'manual', figuresAt: new Date() });
    await this.recompute(org, id);
    return this.assessment(a, id);
  }

  async submit(a: OrgUser, id: string) {
    const x = await this.find(a.organizationId, id);
    this.assertEditable(x);
    const { e } = await this.recompute(a.organizationId, id);
    if (e.coverage < 100 && x.kind !== 'official') {
      const missing = e.standards.flatMap((s) => s.indicators.flatMap((i) => i.practices.flatMap((p) => p.items.filter((it) => !it.answered)))).length;
      throw new ConflictException(`لم تكتمل الإجابة: ${missing} بنداً بدون إجابة${x.figures ? '' : '، والأرقام المالية غير مدخلة'}`);
    }
    await this.db.getRepository(GovAssessment).update({ id }, { status: 'submitted', submittedByName: a.fullName });
    return this.assessment(a, id);
  }

  async approve(a: OrgUser, id: string) {
    const x = await this.find(a.organizationId, id);
    if (x.status !== 'submitted') throw new ConflictException('التقييم غير مرفوع للاعتماد');
    await this.recompute(a.organizationId, id);
    await this.db.getRepository(GovAssessment).update({ id }, { status: 'approved', approvedByName: a.fullName, approvedAt: new Date() });
    return this.assessment(a, id);
  }

  async reopen(a: OrgUser, id: string) {
    const x = await this.find(a.organizationId, id);
    if (x.status === 'draft') throw new ConflictException('التقييم مفتوح بالفعل');
    await this.db.getRepository(GovAssessment).update({ id }, { status: 'draft', approvedByName: null, approvedAt: null });
    return this.assessment(a, id);
  }

  /** التقييم المرجعي للوحة: آخر تقييم ذاتي أو تجريبي (مسودة أو معتمد) */
  private async current(org: string) {
    return this.db.getRepository(GovAssessment).findOne({ where: { organizationId: org, kind: In(['self', 'mock']) }, order: { periodTo: 'DESC', createdAt: 'DESC' } });
  }

  async opportunities(a: OrgUser, id?: string) {
    const x = id ? await this.find(a.organizationId, id) : await this.current(a.organizationId);
    if (!x) return { assessment: null, items: [] as (Opportunity & { planned: boolean })[] };
    const d = await this.assessment(a, x.id);
    const actions = await this.db.getRepository(GovAction).find({ where: { organizationId: a.organizationId, status: In(['planned', 'in_progress']) } });
    const planned = new Set(actions.map((p) => p.itemCode).filter(Boolean));
    return {
      assessment: { id: x.id, code: x.code, title: x.title },
      items: d.evaluation.opportunities.map((o) => ({ ...o, planned: planned.has(o.code) })),
    };
  }

  // ---------------- الإنذار المبكر ----------------

  async alerts(a: OrgUser, includeAcked = false) {
    const org = a.organizationId;
    const t = today();
    const s = await this.finance.settings(org);
    const out: GovAlert[] = [];
    const push = (x: Omit<GovAlert, 'ref' | 'due' | 'impact' | 'link'> & Partial<GovAlert>) => out.push({ ref: null, due: null, impact: null, link: null, ...x });

    // 1) المواعيد النظامية من التقويم
    const obligations = await this.db.getRepository(GovObligation).find({ where: { organizationId: org }, order: { dueDate: 'ASC' } });
    for (const o of obligations) {
      if (o.doneDate) continue;
      const left = daysBetween(t, o.dueDate);
      if (left < 0) {
        push({ key: `obl:${o.id}`, level: 'critical', category: 'deadline', title: `متأخر: ${o.title}`, detail: `تجاوز الموعد بـ ${-left} يوماً. ${o.note ?? ''}`.trim(), ref: o.refs.join('، ') || null, due: o.dueDate, link: '/governance/calendar' });
      } else if (left <= s.alertDays) {
        const extra = o.kind === 'ga_meeting' ? ' أرسل الدعوة قبل 15 يوماً على الأقل وأبلغ المركز والجهة المشرفة.' : '';
        push({ key: `obl:${o.id}`, level: left <= 7 ? 'critical' : 'warning', category: 'deadline', title: `يستحق خلال ${left} يوماً: ${o.title}`, detail: `${o.note ?? ''}${extra}`.trim(), ref: o.refs.join('، ') || null, due: o.dueDate, link: '/governance/calendar' });
      }
    }
    const fy = await this.finance.yearOf(org, t);
    const year = fy?.name ?? Number(t.slice(0, 4));
    if (!obligations.some((o) => o.fiscalYear === year)) {
      push({ key: `cal:${year}`, level: 'warning', category: 'data', title: `لم يُولَّد تقويم الالتزامات لسنة ${year}`, detail: 'ولّد التقويم ليتابع النظام اجتماعات المجلس والتقارير الربعية والمواعيد السنوية وينذر قبلها.', link: '/governance/calendar' });
    }

    // 2) البيانات النظامية
    const f = s.facts ?? {};
    if (f.licenseExpiry) {
      const left = daysBetween(t, f.licenseExpiry);
      if (left < 0) push({ key: 'fact:license', level: 'critical', category: 'compliance', title: 'شهادة تسجيل الشركة منتهية', detail: `انتهت في ${f.licenseExpiry}. بادر بالتجديد فوراً.`, ref: 'CMP-P27-1', due: f.licenseExpiry, link: '/governance/settings' });
      else if (left <= 90) push({ key: 'fact:license', level: 'warning', category: 'compliance', title: `شهادة التسجيل تنتهي خلال ${left} يوماً`, detail: 'ابدأ إجراءات التجديد قبل الانتهاء.', ref: 'CMP-P27-1', due: f.licenseExpiry, link: '/governance/settings' });
    }
    if (f.boardTermEnd) {
      const left = daysBetween(t, f.boardTermEnd);
      if (left >= 0 && left <= 210) {
        const steps = [
          left > 180 ? `دعوة أعضاء الجمعية العمومية للترشح قبل ${addDays(f.boardTermEnd, -180)} (180 يوماً قبل نهاية الدورة)` : null,
          left > 90 ? `إقفال باب الترشح قبل ${addDays(f.boardTermEnd, -90)} ورفع الأسماء للمركز خلال أسبوع` : null,
          `عرض قائمة المرشحين المعتمدة قبل ${addDays(f.boardTermEnd, -15)}`, 'تشكيل لجنة الانتخابات في الاجتماع العمومي السابق للترشيح',
        ].filter(Boolean).join('، ');
        push({ key: 'fact:board_term', level: left <= 90 ? 'critical' : 'warning', category: 'compliance', title: `دورة مجلس الإدارة تنتهي خلال ${left} يوماً`, detail: steps, ref: 'CMP-P17', due: f.boardTermEnd, link: '/governance/settings' });
      } else if (left < 0) {
        push({ key: 'fact:board_term', level: 'critical', category: 'compliance', title: 'انتهت دورة مجلس الإدارة', detail: `انتهت في ${f.boardTermEnd}. حدّث بيانات المجلس الجديد أو تابع إجراءات الانتخاب.`, ref: 'CMP-P17', due: f.boardTermEnd, link: '/governance/settings' });
      }
    }
    if (f.auditorContractEnd && daysBetween(t, f.auditorContractEnd) <= 60) {
      const left = daysBetween(t, f.auditorContractEnd);
      push({ key: 'fact:auditor', level: left < 0 ? 'critical' : 'warning', category: 'compliance', title: left < 0 ? 'انتهى عقد المراجع الخارجي' : `عقد المراجع الخارجي ينتهي خلال ${left} يوماً`, detail: 'التعاقد مع مراجع معتمد شرط لإصدار القوائم المالية المدققة في موعدها.', ref: 'CMP-P20-3', due: f.auditorContractEnd, link: '/governance/settings' });
    }
    if (f.openViolations) push({ key: 'fact:violations', level: 'critical', category: 'compliance', title: `${f.openViolations} مخالفة أو إنذار لم يُصحح`, detail: 'تصحيح المخالفات خلال المدة المحددة يحفظ درجة البند CMP-P18-1.', ref: 'CMP-P18-1', link: '/governance/settings' });
    const missingFacts = (['licenseExpiry', 'boardTermEnd', 'externalAuditor'] as (keyof GovFacts)[]).filter((k) => !f[k]);
    if (missingFacts.length) push({ key: 'fact:missing', level: 'info', category: 'data', title: 'أكمل البيانات النظامية للشركة', detail: 'تاريخ انتهاء شهادة التسجيل ونهاية دورة المجلس والمراجع الخارجي تُستخدم في الإنذار المبكر.', link: '/governance/settings' });

    // 3) السلامة المالية (المتوقع لنهاية السنة)
    const ready = await this.finance.ready(org);
    if (!ready.chart || !ready.years) {
      push({ key: 'fin:setup', level: 'info', category: 'data', title: 'النظام المالي غير مهيأ', detail: 'ثبّت دليل الحسابات الموحد وافتح السنة المالية ليحسب النظام مؤشرات الأداء المالي آلياً.', link: '/accounting' });
    } else {
      const snap = await this.finance.snapshot(org, t);
      if (snap) {
        for (const m of snap.forecast.indicators) for (const sub of m.subs) {
          const unit = sub.unit === '%' ? '%' : ' شهر';
          const ratio = sub.ratio === null ? '—' : `${sub.ratio}${unit}`;
          if (sub.score < 100) {
            const impact = r2(sub.lost * impactFactor('FIN'));
            push({
              key: `fin:${sub.code}`, level: sub.score === 0 || impact >= 1 ? 'critical' : 'warning', category: 'finance',
              title: `${sub.title}: ${ratio} (درجة ${sub.score}%)`, detail: `المتوقع لنهاية السنة يفقد ${sub.lost} درجة من الأداء المالي (${impact} من الدرجة الكلية). المعادلة: ${sub.formula}`,
              ref: sub.code, impact, link: '/governance/finance',
            });
          } else if (sub.ratio !== null && nearEdge(sub)) {
            push({
              key: `fin:${sub.code}:edge`, level: 'info', category: 'finance', title: `${sub.title} قريب من حد خسارة الدرجة`,
              detail: `القيمة المتوقعة ${ratio}، وتبدأ الدرجة بالانخفاض عند ${sub.better === 'range' ? '12 أو 18 شهراً' : `${sub.fullAt}%`}.`, ref: sub.code, link: '/governance/finance',
            });
          }
        }
        const series = await this.finance.series(org, t);
        if (series && series.points.length >= 3 && series.slope <= -1) {
          push({ key: 'fin:trend', level: 'warning', category: 'finance', title: 'اتجاه الأداء المالي هابط', detail: `تنخفض الدرجة بمعدل ${-series.slope} نقطة شهرياً، والمتوقع بنهاية السنة ${series.projected}%.`, link: '/governance/finance' });
        }
      }
    }

    // 4) التقييم الذاتي
    const cur = await this.current(org);
    if (!cur || daysBetween(cur.periodTo, t) > 100) {
      push({ key: 'assess:due', level: 'warning', category: 'compliance', title: 'حان موعد التقييم الذاتي الدوري', detail: cur ? `آخر تقييم ${cur.code} كان لفترة تنتهي ${cur.periodTo}.` : 'لم يُجر أي تقييم ذاتي بعد. ابدأ بتقييم تجريبي لمعرفة وضع الشركة.', link: '/governance/assessments' });
    }
    if (cur) {
      const d = await this.assessment(a, cur.id);
      const e = d.evaluation;
      if (e.predicted < s.targetScore) {
        push({ key: `assess:target:${cur.id}`, level: e.predicted < 70 ? 'critical' : 'warning', category: 'compliance', title: `الدرجة المتوقعة ${e.predicted}% أقل من المستهدف ${s.targetScore}%`, detail: `التقدير المتوقع: ${e.predictedGrade}. أعلى فرص التحسين أثراً: ${e.opportunities.slice(0, 3).map((o) => o.code).join('، ')}.`, impact: r2(s.targetScore - e.predicted), link: '/governance/actions' });
      }
      for (const st of e.standards) for (const ind of st.indicators) {
        const zero = ind.practices.flatMap((p) => p.items.filter((it) => it.answered && it.percent === 0));
        if (!zero.length) continue;
        const lost = r2(zero.reduce((t2, z) => t2 + z.points, 0));
        push({
          key: `gap:${cur.id}:${ind.code}`, level: lost >= 3 ? 'critical' : 'warning', category: 'compliance', title: `${ind.code} ${ind.title}: ${zero.length} بند غير متحقق`,
          detail: `يفقد ${lost} درجة من معيار ${st.title} (${r2(lost * impactFactor(st.code))} من الدرجة الكلية). البنود: ${zero.map((z) => z.code).join('، ')}.`,
          ref: ind.code, impact: r2(lost * impactFactor(st.code)), link: `/governance/assessments/${cur.id}`,
        });
      }
      if (cur.status === 'draft' && e.coverage < 100) {
        push({ key: `assess:coverage:${cur.id}`, level: 'info', category: 'data', title: `التقييم ${cur.code} مكتمل بنسبة ${e.coverage}%`, detail: 'أكمل الإجابة أو اعتمد اقتراحات الإشارات الآلية ثم راجعها.', link: `/governance/assessments/${cur.id}` });
      }
      if (cur.opinion !== 'unqualified') {
        push({ key: `assess:opinion:${cur.id}`, level: 'critical', category: 'finance', title: `رأي المحاسب القانوني: ${OPINION_AR[cur.opinion]}`, detail: `معامل الرأي ${opinionFactor(cur.opinion, cur.qualifiedItems)} يُضرب في درجة الأداء المالي كاملة. عالج بنود التحفظ قبل إصدار القوائم.`, ref: 'FIN', link: `/governance/assessments/${cur.id}` });
      }
    }

    // 5) خطة التحسين
    const overdue = await this.db.query(
      `SELECT id, code, title, due_date::text AS due, owner_name FROM gov_actions WHERE organization_id = $1 AND status IN ('planned', 'in_progress') AND due_date < $2 ORDER BY due_date`, [org, t]);
    for (const x of overdue) push({ key: `act:${x.id}`, level: 'warning', category: 'plan', title: `إجراء تحسين متأخر: ${x.code} ${x.title}`, detail: `المسؤول: ${x.owner_name ?? 'غير محدد'}`, due: x.due, link: '/governance/actions' });

    // الإقرارات والتأجيل
    const states = await this.db.getRepository(GovAlertState).find({ where: { organizationId: org } });
    const st = new Map(states.map((x) => [x.alertKey, x]));
    const order: Record<AlertLevel, number> = { critical: 0, warning: 1, info: 2 };
    const rows = out.map((x) => {
      const ack = st.get(x.key);
      const snoozed = !!ack && (!ack.untilDate || ack.untilDate >= t);
      return { ...x, categoryLabel: CATEGORY_AR[x.category], acknowledged: snoozed, ack: ack ? { until: ack.untilDate, note: ack.note, byName: ack.byName } : null };
    }).filter((x) => includeAcked || !x.acknowledged).sort((x, y) => order[x.level] - order[y.level] || (y.impact ?? 0) - (x.impact ?? 0));
    return {
      items: rows,
      counts: { critical: rows.filter((x) => x.level === 'critical' && !x.acknowledged).length, warning: rows.filter((x) => x.level === 'warning' && !x.acknowledged).length, info: rows.filter((x) => x.level === 'info' && !x.acknowledged).length },
    };
  }

  async ack(a: OrgUser, key: string, dto: AckDto) {
    if (!/^[\w:.-]{1,120}$/.test(key)) throw new BadRequestException('مفتاح الإنذار غير صحيح');
    const repo = this.db.getRepository(GovAlertState);
    await repo.delete({ organizationId: a.organizationId, alertKey: key });
    await repo.save(repo.create({ organizationId: a.organizationId, alertKey: key, untilDate: addDays(today(), dto.days ?? 30), note: dto.note ?? null, byName: a.fullName }));
    return { ok: true };
  }

  async unack(a: OrgUser, key: string) {
    await this.db.getRepository(GovAlertState).delete({ organizationId: a.organizationId, alertKey: key });
    return { ok: true };
  }

  // ---------------- خطة التحسين ----------------

  async actions(a: OrgUser) {
    const rows = await this.db.getRepository(GovAction).find({ where: { organizationId: a.organizationId }, order: { status: 'ASC', dueDate: 'ASC', code: 'ASC' } });
    const t = today();
    return rows.map((r) => ({
      ...r, statusLabel: ACTION_STATUS_AR[r.status], priorityLabel: PRIORITY_AR[r.priority],
      overdue: ['planned', 'in_progress'].includes(r.status) && !!r.dueDate && r.dueDate < t,
      practiceTitle: r.itemCode ? findItem(r.itemCode)?.practice.title ?? null : null,
    }));
  }

  private async nextActionCode(em: EntityManager, org: string) {
    await this.finance.settings(org);
    const n = returned(await em.query(`UPDATE gov_settings SET next_action_no = next_action_no + 1 WHERE organization_id = $1 RETURNING next_action_no - 1 AS n`, [org]));
    return `IMP-${String(n).padStart(3, '0')}`;
  }

  async createAction(a: OrgUser, dto: ActionDto, extra: Partial<GovAction> = {}) {
    const org = a.organizationId;
    if (dto.itemCode && !findItem(dto.itemCode) && !/^FIN-\d[A-C]$/.test(dto.itemCode)) throw new BadRequestException('رمز البند غير موجود في الدليل');
    return this.db.transaction(async (em) => {
      const repo = em.getRepository(GovAction);
      const flat = dto.itemCode ? findItem(dto.itemCode) : undefined;
      const x = repo.create({
        organizationId: org, code: await this.nextActionCode(em, org), title: dto.title, description: dto.description ?? null, ownerName: dto.ownerName ?? null,
        dueDate: dto.dueDate ?? null, priority: dto.priority ?? 'medium', status: dto.status ?? 'planned', progress: dto.progress ?? 0,
        itemCode: dto.itemCode ?? null, practiceCode: flat?.practice.code ?? null, note: dto.note ?? null, source: 'manual', createdByName: a.fullName, ...extra,
      });
      if (x.status === 'done') { x.progress = 100; x.completedAt = today(); }
      return repo.save(x);
    });
  }

  async updateAction(a: OrgUser, id: string, dto: ActionDto) {
    const repo = this.db.getRepository(GovAction);
    const x = await repo.findOne({ where: { id, organizationId: a.organizationId } });
    if (!x) throw new NotFoundException('الإجراء غير موجود');
    Object.assign(x, {
      title: dto.title, description: dto.description ?? null, ownerName: dto.ownerName ?? null, dueDate: dto.dueDate ?? null,
      priority: dto.priority ?? x.priority, status: dto.status ?? x.status, progress: dto.progress ?? x.progress, note: dto.note ?? null,
    });
    if (x.status === 'done') { x.progress = 100; x.completedAt = x.completedAt ?? today(); } else x.completedAt = null;
    return repo.save(x);
  }

  async removeAction(a: OrgUser, id: string) {
    const r = await this.db.getRepository(GovAction).delete({ id, organizationId: a.organizationId });
    if (!r.affected) throw new NotFoundException('الإجراء غير موجود');
    return { ok: true };
  }

  /** إنشاء إجراءات تحسين من فرص التحسين المختارة: العنوان من السؤال، والوصف من الأنشطة المقترحة في البطاقة */
  async actionsFromGaps(a: OrgUser, dto: GapActionsDto) {
    const ops = await this.opportunities(a);
    const existing = new Set((await this.db.getRepository(GovAction).find({ where: { organizationId: a.organizationId, status: In(['planned', 'in_progress']) } })).map((x) => x.itemCode));
    const created: GovAction[] = [];
    for (const code of dto.codes) {
      if (existing.has(code)) continue;
      const o = ops.items.find((x) => x.code === code);
      if (!o) continue;
      const priority = o.impact >= 1 ? 'urgent' : o.impact >= 0.5 ? 'high' : o.impact >= 0.2 ? 'medium' : 'low';
      created.push(await this.createAction(a, {
        title: `${o.code}: ${o.title}`.slice(0, 300), description: o.recommendations.map((r, i) => `${i + 1}. ${r}`).join('\n') || null,
        ownerName: dto.ownerName ?? null, dueDate: dto.dueDate ?? null, priority, itemCode: o.code,
      }, { source: 'gap', expectedGain: o.impact, assessmentId: ops.assessment?.id ?? null }));
    }
    return { created: created.length, items: await this.actions(a) };
  }

  // ---------------- اللوحة ----------------

  async dashboard(a: OrgUser) {
    const org = a.organizationId;
    const t = today();
    const s = await this.finance.settings(org);
    const cur = await this.current(org);
    const [history, alerts, ready, actions] = await Promise.all([
      this.db.getRepository(GovAssessment).find({ where: { organizationId: org }, order: { periodTo: 'ASC', createdAt: 'ASC' } }),
      this.alerts(a),
      this.finance.ready(org),
      this.db.getRepository(GovAction).find({ where: { organizationId: org } }),
    ]);
    const detail = cur ? await this.assessment(a, cur.id) : null;
    const snap = ready.years ? await this.finance.snapshot(org, t) : null;
    const series = ready.years ? await this.finance.series(org, t) : null;
    const e = detail?.evaluation ?? null;
    const upcoming = (await this.obligations(a)).filter((o) => !o.doneDate).slice(0, 6);
    return {
      target: s.targetScore,
      current: cur ? { id: cur.id, code: cur.code, title: cur.title, status: cur.status, statusLabel: STATUS_AR[cur.status], periodTo: cur.periodTo } : null,
      score: e ? {
        overall: e.overall, predicted: e.predicted, coverage: e.coverage, grade: e.grade, predictedGrade: e.predictedGrade, axes: e.axes,
        standards: e.standards.map((x) => ({
          code: x.code, title: x.title, score: x.score, predicted: x.predicted, coverage: x.coverage,
          indicators: x.indicators.map((i) => ({ code: i.code, no: i.no, title: i.title, weight: i.weight, earned: i.earned, predicted: i.predicted, percent: i.percent })),
        })),
        performance: e.performance,
      } : null,
      finance: snap ? {
        year: snap.year.name, elapsed: snap.elapsed, actual: snap.actual.score, forecast: snap.forecast.score,
        indicators: snap.forecast.indicators.map((i) => ({ code: i.code, title: i.title, weight: i.weight, score: i.score, subs: i.subs.map((x) => ({ code: x.code, title: x.title, ratio: x.ratio, unit: x.unit, score: x.score })) })),
        series: series?.points.map((p) => ({ month: p.month, score: p.score })) ?? [], projected: series?.projected ?? null, monthsLeft: series?.monthsLeft ?? 0, slope: series?.slope ?? 0,
      } : null,
      accounting: ready,
      history: history.filter((h) => h.scores).map((h) => ({ id: h.id, code: h.code, kind: h.kind, kindLabel: KIND_AR[h.kind], periodTo: h.periodTo, status: h.status, overall: h.scores!.overall, predicted: h.scores!.predicted, axes: h.scores!.axes })),
      alerts: { counts: alerts.counts, top: alerts.items.slice(0, 6) },
      opportunities: e?.opportunities.slice(0, 8) ?? [],
      opportunitiesCount: e?.opportunities.length ?? 0,
      actions: {
        total: actions.length, done: actions.filter((x) => x.status === 'done').length, open: actions.filter((x) => ['planned', 'in_progress'].includes(x.status)).length,
        overdue: actions.filter((x) => ['planned', 'in_progress'].includes(x.status) && x.dueDate && x.dueDate < t).length,
        expectedGain: r2(actions.filter((x) => ['planned', 'in_progress'].includes(x.status)).reduce((t2, x) => t2 + x.expectedGain, 0)),
      },
      upcoming,
    };
  }
}

/** نتيجة UPDATE ... RETURNING في TypeORM تأتي [الصفوف، عدد المتأثر] */
function returned(res: unknown): number {
  const rows = Array.isArray(res) && Array.isArray(res[0]) ? res[0] : res;
  return Number((rows as { n: number }[])[0].n);
}

function obligationState(o: GovObligation, t: string) {
  if (o.doneDate) return o.doneDate > o.dueDate ? 'late_done' : 'done';
  return o.dueDate < t ? 'overdue' : daysBetween(t, o.dueDate) <= 30 ? 'due_soon' : 'upcoming';
}

function nearEdge(sub: { better: string; ratio: number | null; fullAt: number }) {
  const r = sub.ratio!;
  if (sub.better === 'lower') return r >= sub.fullAt * 0.85;
  if (sub.better === 'higher') return r <= sub.fullAt * 1.15;
  return (r >= 12 && r < 13) || (r > 17 && r <= 18);
}

function sanitizeFacts(raw: Record<string, unknown>): GovFacts {
  const date = (v: unknown) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);
  const text = (v: unknown, max = 200) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null);
  const bool = (v: unknown) => (typeof v === 'boolean' ? v : null);
  const int = (v: unknown) => (v === null || v === '' || v === undefined ? null : Number.isInteger(Number(v)) && Number(v) >= 0 && Number(v) < 1000 ? Number(v) : null);
  return {
    licenseNo: text(raw.licenseNo, 50), licenseExpiry: date(raw.licenseExpiry), boardFormedOn: date(raw.boardFormedOn), boardTermEnd: date(raw.boardTermEnd),
    boardMembers: int(raw.boardMembers), externalAuditor: text(raw.externalAuditor), auditorContractEnd: date(raw.auditorContractEnd),
    hasBranches: bool(raw.hasBranches), branchesApproved: bool(raw.branchesApproved), hasCommittees: bool(raw.hasCommittees),
    openViolations: int(raw.openViolations), websiteUrl: text(raw.websiteUrl, 300), ctfObliged: bool(raw.ctfObliged),
  };
}
