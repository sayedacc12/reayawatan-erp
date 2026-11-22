import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { readFile } from 'fs/promises';
import { join } from 'path';
import { DataSource, In } from 'typeorm';
import { OrgUser } from '../../../core/auth/decorators';
import { FileStore } from '../../../core/files/file-store.service';
import { COMPANY_BRAND } from '../../../core/identity/company-brand';
import { OrgIdentity } from '../../../core/identity/identity.entity';
import { MONTHS_AR, SECTION_NAME, SECTIONS, Section } from '../budget/budget-defaults';
import { BudgetExecution, ExecRow } from '../budget/budget-execution.service';
import { BudgetTransfer, BudgetVersion } from '../budget/budget.entity';
import { BudgetsService } from '../budget/budgets.service';
import { Plan, PlanItem, PlanKpi, PlanRef, PlanVersion, WfLog } from '../entities/planning.entity';
import { OrgAnalysis, planYear, PlanningAnalysis } from '../planning-analysis.service';
import { PERIOD_LABEL, yearTarget } from '../planning-calc';
import { today } from '../planning-core.service';
import { PLANNING_PERMISSIONS as P } from '../planning.manifest';
import { Block, BoardDoc, DocSection, fv as formatValue, nowStamp as nowText, Tone } from './board-doc';

/**
 * نماذج تقارير مجلس المديرين في نظام التخطيط والموازنات (مرمّزة بصيغة وحدة الجودة):
 *   QF-PLN-01 تقرير اعتماد الخطة الاستراتيجية       QF-PLN-04 تقرير تقييم أداء الخطة الاستراتيجية
 *   QF-PLN-02 تقرير اعتماد الخطة التشغيلية           QF-PLN-05 تقرير تقييم أداء الخطة التشغيلية
 *   QF-PLN-03 تقرير اعتماد الموازنة التقديرية        QF-PLN-06 تقرير أداء الموازنة (المخطط مقابل الفعلي)
 * كل تقرير يُبنى من نفس التحليل الذي تعرضه الشاشات، فلا تختلف الأرقام بين الشاشة والتقرير.
 */
export const BOARD_TYPES = ['plan-approval', 'plan-performance', 'budget-approval', 'budget-performance'] as const;
export type BoardType = (typeof BOARD_TYPES)[number];

export const BOARD_FORMS = [
  { code: 'QF-PLN-01', type: 'plan-approval', kind: 'strategic', title: 'تقرير اعتماد الخطة الاستراتيجية', purpose: 'يُرفع إلى مجلس المديرين لاعتماد الخطة الاستراتيجية بمحاورها وأهدافها ومبادراتها ومؤشراتها وتكلفتها' },
  { code: 'QF-PLN-02', type: 'plan-approval', kind: 'operational', title: 'تقرير اعتماد الخطة التشغيلية', purpose: 'يُرفع لاعتماد الخطة التشغيلية السنوية بأنشطتها وجدولها الزمني وتكلفتها وارتباطها بالخطة الاستراتيجية' },
  { code: 'QF-PLN-03', type: 'budget-approval', kind: null, title: 'تقرير اعتماد الموازنة التقديرية', purpose: 'يُرفع لاعتماد الموازنة التقديرية بافتراضاتها وأقسامها وبنودها وتوزيعها الشهري' },
  { code: 'QF-PLN-04', type: 'plan-performance', kind: 'strategic', title: 'تقرير تقييم أداء الخطة الاستراتيجية', purpose: 'تقرير دوري للمجلس عن إنجاز المحاور والمبادرات وتحقق المؤشرات والانحرافات والإجراءات التصحيحية' },
  { code: 'QF-PLN-05', type: 'plan-performance', kind: 'operational', title: 'تقرير تقييم أداء الخطة التشغيلية', purpose: 'تقرير دوري عن تنفيذ الأنشطة مقابل المخطط والمعالم والمؤشرات والإجراءات التصحيحية' },
  { code: 'QF-PLN-06', type: 'budget-performance', kind: null, title: 'تقرير أداء الموازنة التقديرية', purpose: 'تقرير دوري عن الموازنة المعدلة مقابل الفعلي والانحرافات والتوقع لنهاية السنة والمناقلات' },
] as const;

const WF: Record<string, string> = { draft: 'مسودة', in_review: 'قيد الاعتماد', returned: 'مُرجعة للتعديل', approved: 'معتمدة', rejected: 'مرفوضة' };
const ACTION: Record<WfLog['action'], string> = { submit: 'رفع للاعتماد', approve: 'اعتماد', return: 'إعادة للتعديل', reject: 'رفض', reopen: 'فتح للتعديل' };
const EXEC: Record<string, string> = { not_started: 'لم يبدأ', on_track: 'حسب الخطة', at_risk: 'في خطر', delayed: 'متأخر', completed: 'منجز', cancelled: 'ملغى', carried_over: 'مُرحّل', no_schedule: 'بلا جدول زمني' };
const EXEC_TONE: Record<string, Tone> = { completed: 'good', on_track: 'good', at_risk: 'warn', delayed: 'bad', not_started: 'neutral', no_schedule: 'neutral', cancelled: 'neutral', carried_over: 'neutral' };
const BAND: Record<string, string> = { green: 'محقق', amber: 'قريب من المستهدف', red: 'دون المستهدف' };
const BAND_TONE: Record<string, Tone> = { green: 'good', amber: 'warn', red: 'bad' };
const FUNDING: Record<string, string> = { restricted: 'مقيد', unrestricted: 'غير مقيد', mixed: 'مختلط', none: 'غير محدد' };
const FREQ: Record<string, string> = { annual: 'سنوي', semiannual: 'نصف سنوي', quarterly: 'ربع سنوي', monthly: 'شهري' };
const REF_SYS: Record<string, string> = { projects: 'مشروع', capital_budget: 'موازنة رأسمالية', risk: 'خطر', risk_analysis: 'عامل تحليل استراتيجي', audit: 'توصية مراجعة', hr_performance: 'هدف أداء وظيفي' };
const KIND_LINE: Record<string, string> = { employee: 'موظف حالي', employee_group: 'موظفون حاليون', new_position: 'وظيفة جديدة', hr_other: 'مصروف موارد بشرية', account: 'حساب', activity: 'نشاط', project: 'مشروع', manual: 'بند يدوي', hr_group: 'الرواتب' };
const ROLE: Record<string, string> = { chair: 'رئيس المجلس', vice: 'نائب الرئيس', member: 'عضو المجلس', secretary: 'أمين سر المجلس', rapporteur: 'مقرر المجلس', advisor: 'مستشار' };
const ROLE_ORDER = ['chair', 'vice', 'member', 'rapporteur', 'secretary'];
const TRANSFER: Record<string, string> = { transfer: 'مناقلة', increase: 'زيادة', decrease: 'تخفيض' };

const MAX_LOGO = 2 * 1024 * 1024;
const r1 = (n: number) => Math.round(n * 10) / 10;
const r2 = (n: number) => Math.round(n * 100) / 100;
const pct = (a: number, b: number) => (b ? r1((a / b) * 100) : null);
const money = (n: number) => `${formatValue(n, 'money')} ريال`;
const pctText = (n: number | null) => (n === null ? '—' : `${formatValue(n, 'percent')}`);
const sum = (xs: number[]) => r2(xs.reduce((s, x) => s + (Number(x) || 0), 0));
const dateText = (d: Date | string | null) => (d ? formatValue(d instanceof Date ? d.toISOString() : d, 'datetime') : null);

export interface BoardQuery { kind?: string; planId?: string; budgetId?: string; period?: string; meetingNo?: string }

/** نهاية الفترة: YYYY أو YYYY-H1/H2 أو YYYY-Q1..Q4 أو YYYY-MM */
export function periodEndOf(p: string): string {
  const m = /^(\d{4})(?:-(H[12]|Q[1-4]|0[1-9]|1[0-2]))?$/.exec(p);
  if (!m) throw new BadRequestException('الفترة غير صحيحة');
  const y = Number(m[1]);
  const endMonth = !m[2] ? 12 : m[2][0] === 'H' ? Number(m[2][1]) * 6 : m[2][0] === 'Q' ? Number(m[2][1]) * 3 : Number(m[2]);
  const last = new Date(Date.UTC(y, endMonth, 0)).getUTCDate();
  return `${y}-${String(endMonth).padStart(2, '0')}-${String(last).padStart(2, '0')}`;
}
const periodLabel = (p: string) => (/^\d{4}-\d{2}$/.test(p) ? `${MONTHS_AR[Number(p.slice(5)) - 1]} ${p.slice(0, 4)}` : PERIOD_LABEL(p));

@Injectable()
export class BoardReportsService {
  private readonly log = new Logger('BoardReports');
  constructor(
    private readonly db: DataSource, private readonly files: FileStore, private readonly analysis: PlanningAnalysis,
    private readonly budgets: BudgetsService, private readonly exec: BudgetExecution,
  ) {}

  /** قائمة النماذج والخطط والموازنات المتاحة للاختيار */
  async catalog(actor: OrgUser) {
    const org = actor.organizationId;
    const canPlan = this.canPlan(actor), canBudget = this.canBudget(actor);
    const plans = !canPlan ? [] : await this.db.getRepository(Plan).find({ where: { organizationId: org }, order: { startYear: 'DESC', code: 'ASC' }, select: ['id', 'code', 'kind', 'title', 'startYear', 'endYear', 'status', 'version'] });
    const budgets = canBudget ? (await this.budgets.list(actor, {}))
      .map((b) => ({ id: b.id, code: b.code, title: b.title, fiscalYear: b.fiscalYear, status: b.status, version: b.version })) : [];
    return {
      forms: BOARD_FORMS.filter((f) => (f.type.startsWith('budget') ? canBudget : canPlan)),
      plans: plans.map((p) => ({ ...p, statusName: WF[p.status] })),
      budgets: budgets.map((b) => ({ ...b, statusName: WF[b.status] })),
      today: today(),
    };
  }

  /** تقارير الخطط لمن يملك تقارير التخطيط، وتقارير الموازنة له أو لمعد الموازنة (كتقارير الموازنة في تبويب التقارير) */
  canPlan(actor: OrgUser) { return actor.isSuperadmin || actor.permissions.includes(P.reports); }
  canBudget(actor: OrgUser) { return actor.isSuperadmin || actor.permissions.includes(P.reports) || actor.permissions.includes(P.budgets); }

  async build(actor: OrgUser, type: BoardType, q: BoardQuery): Promise<BoardDoc> {
    if (!(type.startsWith('budget') ? this.canBudget(actor) : this.canPlan(actor))) throw new ForbiddenException('هذا التقرير ليس من صلاحيتك');
    if (type === 'plan-approval') return this.planApproval(actor, q);
    if (type === 'plan-performance') return this.planPerformance(actor, q);
    if (type === 'budget-approval') return this.budgetApproval(actor, q);
    return this.budgetPerformance(actor, q);
  }

  // ---------------- مشترك ----------------

  private async shell(actor: OrgUser, form: (typeof BOARD_FORMS)[number], docNo: string, subject: string, period: string, control: BoardDoc['control'], sections: DocSection[]): Promise<BoardDoc> {
    const org = actor.organizationId;
    const id = await this.db.getRepository(OrgIdentity).findOne({ where: { organizationId: org } });
    const [o] = await this.db.query('SELECT name FROM organizations WHERE id = $1', [org]);
    return {
      formCode: form.code, docNo, kindLabel: form.type.endsWith('approval') ? 'تقرير اعتماد' : 'تقرير تقييم أداء دوري', title: form.title, subject, period,
      audience: await this.boardName(org), organizationName: id?.displayName || o?.name || COMPANY_BRAND.displayName, englishName: id?.englishName ?? null,
      logo: await this.logo(id), colors: { primary: id?.colors?.primary ?? COMPANY_BRAND.colors.primary, accent: id?.colors?.accent ?? COMPANY_BRAND.colors.accent, dark: id?.colors?.dark ?? COMPANY_BRAND.colors.dark },
      control: [{ label: 'رمز النموذج', value: form.code }, { label: 'رقم الوثيقة', value: docNo }, ...control, { label: 'أُعد بواسطة', value: actor.fullName }, { label: 'تاريخ الإصدار', value: nowText() }],
      sections, generatedBy: actor.fullName, generatedAt: nowText(), classification: 'سري، للاستخدام الداخلي',
    };
  }

  /** الشعار من هوية الشركة، وإلا الشعار الافتراضي المرفق مع النظام */
  private async logo(id: OrgIdentity | null) {
    const read = async () => {
      if (id?.logo?.key) {
        const chunks: Buffer[] = [];
        let size = 0;
        // يتوقف عند تجاوز الحد بدل قراءة ملف كبير كاملًا في الذاكرة
        for await (const c of this.files.open(id.logo.key)) {
          size += (c as Buffer).length;
          if (size > MAX_LOGO) throw new Error('logo too large');
          chunks.push(c as Buffer);
        }
        return { buf: Buffer.concat(chunks), mime: id.logo.mime };
      }
      const dir = process.env.BRAND_DIR ?? join(process.cwd(), 'assets', 'brand');
      return { buf: await readFile(join(dir, COMPANY_BRAND.logos.logo)), mime: 'image/png' };
    };
    try {
      const { buf, mime } = await read();
      if (!/^image\/(png|jpeg|webp)$/.test(mime) || buf.length > MAX_LOGO) return null;
      return `data:${mime};base64,${buf.toString('base64')}`;
    } catch (e) {
      this.log.warn(`Logo not embedded: ${(e as Error).message}`);
      return null;
    }
  }

  /** مجلس المديرين من نظام الاجتماعات (قراءة فقط) لتعبئة صفحة التوقيعات. الجهة السرية لا تُقرأ هنا، لأن نظام الاجتماعات يخفيها عن غير أعضائها */
  private async board(org: string): Promise<{ name: string; members: { role: string; name: string; title: string | null }[] } | null> {
    const rows: { name: string; members: { role: string; name: string; title: string | null }[] }[] = await this.db.query(
      `SELECT name, members FROM mtg_bodies WHERE organization_id = $1 AND kind = 'board' AND is_active = true AND is_confidential = false ORDER BY created_at LIMIT 1`, [org]).catch((e) => { this.log.warn(`Board body not read: ${(e as Error).message}`); return []; });
    return rows[0] ?? null;
  }

  private async boardName(org: string) { return (await this.board(org))?.name || 'مجلس المديرين'; }

  private async signatures(org: string, prepared: { role: string; name: string | null }[]): Promise<Block> {
    const b = await this.board(org);
    const members = (b?.members ?? []).filter((m) => ROLE_ORDER.includes(m.role)).sort((x, y) => ROLE_ORDER.indexOf(x.role) - ROLE_ORDER.indexOf(y.role));
    const rows = members.length
      ? members.map((m) => ({ role: ROLE[m.role] ?? m.role, name: m.name, title: m.title }))
      : [{ role: 'رئيس المجلس', name: null }, { role: 'عضو المجلس', name: null }, { role: 'عضو المجلس', name: null }, { role: 'أمين سر المجلس', name: null }];
    return { t: 'signatures', rows: [...prepared, ...rows], note: members.length ? `الأسماء من تشكيل «${b!.name}» في نظام الاجتماعات.` : 'لم يُسجل تشكيل المجلس في نظام الاجتماعات بعد، فتُكتب الأسماء يدويًا.' };
  }

  private decisionSection(title: string, lead: string, options: string[], sign: Block, meetingNo?: string): DocSection {
    return {
      title, lead,
      blocks: [
        { t: 'kv', items: [{ label: 'رقم الاجتماع', value: meetingNo || '....................' }, { label: 'تاريخ الاجتماع', value: '..... / ..... / ..........' }, { label: 'رقم القرار', value: '....................' }, { label: 'مكان الانعقاد', value: '....................' }] },
        { t: 'h', text: 'قرار المجلس' }, { t: 'decision', options },
        { t: 'lines', label: 'ملاحظات المجلس وتوجيهاته', count: 6 },
        { t: 'h', text: 'التوقيعات' }, sign,
      ],
    };
  }

  private wfTable(logs: WfLog[]): Block {
    return {
      t: 'table', small: true, empty: 'لم تُرفع للاعتماد بعد',
      columns: [{ key: 'action', label: 'الإجراء' }, { key: 'stage', label: 'المرحلة' }, { key: 'by', label: 'بواسطة' }, { key: 'at', label: 'التاريخ', type: 'datetime' }, { key: 'note', label: 'الملاحظة' }],
      rows: logs.map((l) => ({ action: ACTION[l.action] ?? l.action, stage: l.stage, by: l.byName, at: l.at, note: l.note })),
    };
  }

  // ---------------- الخطط ----------------

  private async loadPlan(actor: OrgUser, q: BoardQuery, asOf?: string) {
    if (!q.planId || !/^[0-9a-f-]{36}$/i.test(q.planId)) throw new BadRequestException('اختر الخطة');
    const a = await this.analysis.analyze(actor.organizationId, asOf);
    const p = a.plans.get(q.planId);
    if (!p) throw new NotFoundException('الخطة غير موجودة');
    return { a, p };
  }

  private tree(a: OrgAnalysis, planId: string) {
    const items = a.items.filter((i) => i.planId === planId);
    const kids = new Map<string | null, PlanItem[]>();
    for (const i of items) kids.set(i.parentId, [...(kids.get(i.parentId) ?? []), i]);
    for (const v of kids.values()) v.sort((x, y) => x.sortOrder - y.sortOrder || x.code.localeCompare(y.code));
    const desc = (id: string): PlanItem[] => (kids.get(id) ?? []).flatMap((c) => [c, ...desc(c.id)]);
    return { items, roots: kids.get(null) ?? [], kids, desc, isLeaf: (id: string) => !(kids.get(id)?.length) };
  }

  private targetsText(i: PlanItem) {
    return i.targets.map((t) => [t.text, t.value !== null && t.value !== undefined ? `${formatValue(t.value, 'number')}${t.unit ? ` ${t.unit}` : ''}` : '', t.dueDate ? `حتى ${formatValue(t.dueDate, 'date')}` : ''].filter(Boolean).join(' ')).join('، ') || null;
  }

  private formFor(type: BoardType, kind: string | null) {
    return BOARD_FORMS.find((f) => f.type === type && (f.kind === null || f.kind === kind))!;
  }

  private async planApproval(actor: OrgUser, q: BoardQuery): Promise<BoardDoc> {
    const { a, p } = await this.loadPlan(actor, q);
    const org = actor.organizationId;
    const form = this.formFor('plan-approval', p.kind);
    const t = this.tree(a, p.id);
    const s = this.analysis.summary(a, p);
    const strategic = p.kind === 'strategic';
    const lvl = (n: number) => p.levels[n]?.name ?? `المستوى ${n + 1}`;
    const live = t.items.filter((i) => i.state !== 'cancelled');
    const years = Array.from({ length: p.endYear - p.startYear + 1 }, (_, i) => p.startYear + i);
    const kpis = a.kpis.filter((k) => k.planId === p.id);
    const totalCost = s.totalCost;
    const levelCounts = p.levels.map((l, n) => ({ label: l.name, value: live.filter((i) => i.level === n).length, type: 'number' as const }));
    const rootsW = t.roots.reduce((x, r) => x + Math.max(0, r.weight), 0);
    const [refs, versions, children, parent] = await Promise.all([
      t.items.length ? this.db.getRepository(PlanRef).find({ where: { organizationId: org, itemId: In(t.items.map((i) => i.id)) } }) : Promise.resolve([] as PlanRef[]),
      this.db.getRepository(PlanVersion).find({ where: { organizationId: org, planId: p.id }, order: { version: 'DESC' }, select: ['id', 'version', 'note', 'approvedByName', 'approvedAt'] }),
      this.db.getRepository(Plan).find({ where: { organizationId: org, parentPlanId: p.id }, select: ['id', 'code', 'title', 'unitName', 'status', 'startYear', 'endYear'] }),
      p.parentPlanId ? this.db.getRepository(Plan).findOne({ where: { organizationId: org, id: p.parentPlanId }, select: ['id', 'code', 'title'] }) : Promise.resolve(null),
    ]);
    const periodText = p.startYear === p.endYear ? `السنة ${p.startYear}` : `${p.startYear} - ${p.endYear} (${years.length} سنوات)`;
    const noOwner = live.filter((i) => !i.ownerName).length;
    const noKpiRoots = t.roots.filter((r) => !kpis.some((k) => k.itemId === r.id || t.desc(r.id).some((d) => d.id === k.itemId)));
    const largest = [...t.roots].map((r) => ({ r, cost: a.rolled.get(r.id)?.cost ?? 0 })).sort((x, y) => y.cost - x.cost)[0];

    const sections: DocSection[] = [];
    // 1. الملخص التنفيذي
    const exec: Block[] = [
      { t: 'cards', items: [
        { label: 'مدة الخطة', value: periodText }, { label: `عدد ${lvl(0)}`, value: t.roots.length, type: 'number' },
        { label: 'إجمالي العناصر', value: live.length, type: 'number' }, { label: 'مؤشرات الأداء', value: kpis.length, type: 'number' },
        { label: 'التكلفة التقديرية', value: totalCost, type: 'money', hint: 'ريال' }, { label: 'حالة الخطة', value: `${WF[p.status]}${p.version ? ` · إصدار ${p.version}` : ''}` },
      ] },
      { t: 'p', text: `تتكون ${strategic ? 'الخطة الاستراتيجية' : 'الخطة التشغيلية'} «${p.title}» من ${t.roots.length} ${lvl(0)} و${live.length} عنصرًا على ${p.levels.length} مستويات (${p.levels.map((l) => l.name).join('، ')})، وتُقاس بـ${kpis.length} مؤشر أداء، بتكلفة تقديرية إجمالية ${money(totalCost)} موزعة على ${years.length === 1 ? 'سنة واحدة' : `${years.length} سنوات`}.${largest && totalCost ? ` أعلى ${lvl(0)} تكلفة «${largest.r.title}» بنسبة ${pctText(pct(largest.cost, totalCost))} من الإجمالي.` : ''}${!strategic && parent ? ` وتنفذ الخطة الاستراتيجية «${parent.code} ${parent.title}».` : ''}` },
      { t: 'h', text: `${lvl(0)} الخطة باختصار` },
      { t: 'table', columns: [{ key: 'code', label: 'الرمز', width: '9%' }, { key: 'title', label: lvl(0) }, { key: 'n', label: 'العناصر', type: 'number' }, { key: 'k', label: 'المؤشرات', type: 'number' }, { key: 'cost', label: 'التكلفة', type: 'money' }, { key: 'share', label: 'من الإجمالي', type: 'percent' }],
        rows: t.roots.map((r) => { const d = t.desc(r.id); const cost = a.rolled.get(r.id)?.cost ?? 0; return { code: r.code, title: r.title, n: d.length, k: kpis.filter((k) => k.itemId === r.id || d.some((x) => x.id === k.itemId)).length, cost, share: pct(cost, totalCost) }; }),
        totals: { cost: totalCost, share: totalCost ? 100 : null } },
    ];
    const gaps = [
      ...(noOwner ? [`${noOwner} عنصرًا بلا مسؤول محدد`] : []),
      ...(noKpiRoots.length ? [`${noKpiRoots.length} من ${lvl(0)} بلا مؤشر أداء: ${noKpiRoots.map((r) => r.code).join('، ')}`] : []),
      ...(kpis.filter((k) => years.every((y) => yearTarget(k, y) === null)).length ? [`${kpis.filter((k) => years.every((y) => yearTarget(k, y) === null)).length} مؤشرًا بلا مستهدفات`] : []),
      ...(live.filter((i) => t.isLeaf(i.id) && (!i.startDate || !i.endDate)).length ? [`${live.filter((i) => t.isLeaf(i.id) && (!i.startDate || !i.endDate)).length} عنصرًا تنفيذيًا بلا مدة زمنية`] : []),
    ];
    exec.push({ t: 'h', text: 'ملاحظات الجاهزية قبل الاعتماد' }, gaps.length ? { t: 'list', tone: 'warn', items: gaps } : { t: 'callout', tone: 'good', title: 'الخطة مكتملة البيانات', text: 'كل العناصر لها مسؤول، وكل محور له مؤشر، وكل المؤشرات لها مستهدفات.' });
    exec.push({ t: 'callout', tone: 'info', title: 'القرار المطلوب من المجلس', text: `اعتماد ${strategic ? 'الخطة الاستراتيجية' : 'الخطة التشغيلية'} «${p.code} ${p.title}» للفترة ${periodText} بتكلفتها التقديرية ${money(totalCost)}، وتفويض الإدارة التنفيذية بتنفيذها ومتابعتها ورفع تقارير الأداء الدورية.` });
    sections.push({ title: 'الملخص التنفيذي', lead: 'صورة مختصرة للخطة وما يطلب من المجلس اعتماده', blocks: exec });

    // 2. الإطار العام
    const frame: Block[] = [
      { t: 'kv', items: [
        { label: 'رمز الخطة', value: p.code }, { label: 'نوع الخطة', value: strategic ? 'استراتيجية' : 'تشغيلية' }, { label: 'المدة', value: periodText },
        { label: 'دورية المتابعة', value: FREQ[p.periodicity] }, { label: 'مالك الخطة', value: p.ownerName }, { label: 'الإدارة', value: p.unitName ?? 'على مستوى الشركة' },
        ...(p.sharedUnits.length ? [{ label: 'الإدارات المشاركة', value: p.sharedUnits.map((u) => u.name).join('، ') }] : []),
        ...(parent ? [{ label: 'الخطة الاستراتيجية الأم', value: `${parent.code} ${parent.title}` }] : []),
        { label: 'مستويات الهيكل', value: p.levels.map((l) => l.name).join(' ← ') },
      ] },
      ...(p.description ? [{ t: 'h', text: 'نبذة' } as Block, { t: 'p', text: p.description } as Block] : []),
      ...(p.vision ? [{ t: 'h', text: 'الرؤية' } as Block, { t: 'p', text: p.vision } as Block] : []),
      ...(p.mission ? [{ t: 'h', text: 'الرسالة' } as Block, { t: 'p', text: p.mission } as Block] : []),
      ...(p.values.length ? [{ t: 'h', text: 'القيم' } as Block, { t: 'list', items: p.values } as Block] : []),
      { t: 'h', text: 'مكونات الخطة حسب المستوى' }, { t: 'cards', items: levelCounts },
    ];
    sections.push({ title: strategic ? 'الإطار الاستراتيجي' : 'نطاق الخطة وإطارها', lead: strategic ? 'الرؤية والرسالة والقيم وبيانات الخطة' : 'بيانات الخطة والإدارة المسؤولة والارتباط بالخطة الاستراتيجية', blocks: frame });

    // 3. تفصيل الهيكل لكل محور
    const detail: Block[] = [];
    for (const r of t.roots) {
      const d = [r, ...t.desc(r.id)];
      detail.push({ t: 'h', text: `${r.code} ${r.title}`, note: `${d.length - 1} عنصرًا · ${money(a.rolled.get(r.id)?.cost ?? 0)} · الوزن ${pctText(rootsW ? pct(Math.max(0, r.weight), rootsW) : null)}` });
      if (r.description) detail.push({ t: 'p', text: r.description, muted: true });
      detail.push({ t: 'table', small: true, indent: 'title',
        columns: [{ key: 'code', label: 'الرمز', width: '9%' }, { key: 'title', label: 'العنصر' }, { key: 'level', label: 'المستوى', width: '11%' }, { key: 'owner', label: 'المسؤول / الجهة', width: '15%' },
          { key: 'start', label: 'البداية', type: 'date' }, { key: 'end', label: 'النهاية', type: 'date' }, { key: 'cost', label: 'التكلفة', type: 'money' }, { key: 'targets', label: 'المستهدفات', width: '20%' }],
        rows: d.map((i) => ({ code: i.code, title: i.title, level: lvl(i.level), owner: [i.ownerName, i.unitName].filter(Boolean).join(' / ') || null, start: i.startDate, end: i.endDate,
          cost: i.plannedCost || null, targets: this.targetsText(i), _level: i.level - r.level, _style: i.id === r.id ? 'strong' : i.state === 'cancelled' ? 'muted' : undefined })) });
    }
    sections.push({ title: `تفصيل ${lvl(0)} وعناصرها`, lead: 'كل عنصر بمسؤوله ومدته وتكلفته المباشرة ومستهدفاته (تكلفة العنصر الأب تشمل فروعه في الملخص)', blocks: detail.length ? detail : [{ t: 'p', text: 'لا توجد عناصر في الخطة.' }] });

    // 4. الجدول الزمني (التشغيلية)
    if (!strategic) {
      const leaves = live.filter((i) => t.isLeaf(i.id));
      sections.push({ title: 'الجدول الزمني للأنشطة', lead: `مدد الأنشطة التنفيذية خلال سنة ${p.startYear}`, blocks: [
        { t: 'gantt', year: p.startYear, items: leaves.map((i) => ({ label: `${i.code} ${i.title}`, start: i.startDate, end: i.endDate, progress: null })) },
        ...(leaves.some((i) => i.milestones.length) ? [{ t: 'h', text: 'المعالم الرئيسية' } as Block, { t: 'table', small: true, columns: [{ key: 'item', label: 'النشاط' }, { key: 'm', label: 'المعلم' }, { key: 'due', label: 'الموعد', type: 'date' }],
          rows: leaves.flatMap((i) => i.milestones.map((m) => ({ item: `${i.code} ${i.title}`, m: m.title, due: m.dueDate }))) } as Block] : []),
      ] });
    }

    // 5. مؤشرات الأداء
    sections.push({ title: 'مؤشرات الأداء ومستهدفاتها', lead: 'المؤشرات التي يقيس بها المجلس تحقق الخطة، بخط الأساس والمستهدف لكل سنة', blocks: [
      { t: 'table', small: true, empty: 'لم تُعرّف مؤشرات أداء لهذه الخطة',
        columns: [{ key: 'code', label: 'الرمز' }, { key: 'name', label: 'المؤشر', width: '26%' }, { key: 'item', label: 'العنصر' }, { key: 'unit', label: 'الوحدة' }, { key: 'freq', label: 'الدورية' }, { key: 'baseline', label: 'خط الأساس', type: 'number' },
          ...years.map((y) => ({ key: `y${y}`, label: String(y), type: 'number' as const }))],
        rows: kpis.map((k) => ({ code: k.code, name: `${k.name}${k.direction === 'down' ? ' (الأقل أفضل)' : ''}`, item: k.itemId ? a.itemById.get(k.itemId)?.code : null, unit: k.unit, freq: FREQ[k.frequency], baseline: k.baseline,
          ...Object.fromEntries(years.map((y) => [`y${y}`, yearTarget(k, y)])) })) },
    ] });

    // 6. التكلفة والتمويل
    const byYear = t.roots.map((r) => { const c = a.rolled.get(r.id)?.costByYear ?? {}; return { code: r.code, title: r.title, ...Object.fromEntries(years.map((y) => [`y${y}`, Number(c[String(y)]) || 0])), total: a.rolled.get(r.id)?.cost ?? 0 }; });
    const funding: Record<string, number> = {};
    for (const i of live) if (i.plannedCost) funding[i.fundingType ?? 'none'] = r2((funding[i.fundingType ?? 'none'] ?? 0) + i.plannedCost);
    sections.push({ title: 'التكلفة التقديرية ومصادر التمويل', lead: 'توزيع التكلفة على السنوات المالية ونوع التمويل؛ وتُدرج تكلفة كل سنة في موازنتها التقديرية', blocks: [
      { t: 'table', columns: [{ key: 'code', label: 'الرمز' }, { key: 'title', label: lvl(0) }, ...years.map((y) => ({ key: `y${y}`, label: String(y), type: 'money' as const })), { key: 'total', label: 'الإجمالي', type: 'money' }],
        rows: byYear, totals: { ...Object.fromEntries(years.map((y) => [`y${y}`, sum(byYear.map((r) => Number((r as Record<string, unknown>)[`y${y}`]) || 0))])), total: totalCost } },
      { t: 'h', text: 'التكلفة حسب نوع التمويل' },
      { t: 'table', columns: [{ key: 'f', label: 'نوع التمويل' }, { key: 'amount', label: 'المبلغ', type: 'money' }, { key: 'share', label: 'النسبة', type: 'percent' }],
        rows: Object.entries(funding).map(([k, v]) => ({ f: FUNDING[k] ?? k, amount: v, share: pct(v, totalCost) })), empty: 'لم تُقدّر تكاليف' },
    ] });

    // 7. الارتباطات
    const links: Block[] = [];
    if (strategic) {
      links.push({ t: 'h', text: 'الخطط التشغيلية المنفذة لها' }, { t: 'table', small: true, empty: 'لم تُربط خطط تشغيلية بعد', columns: [{ key: 'code', label: 'الرمز' }, { key: 'title', label: 'الخطة' }, { key: 'unit', label: 'الإدارة' }, { key: 'years', label: 'السنة' }, { key: 'status', label: 'الحالة' }],
        rows: children.map((c) => ({ code: c.code, title: c.title, unit: c.unitName ?? 'الشركة', years: c.startYear === c.endYear ? String(c.startYear) : `${c.startYear}-${c.endYear}`, status: WF[c.status] })) });
    } else {
      const ids = new Set(t.items.map((i) => i.id));
      const out = a.links.filter((l) => ids.has(l.fromItemId) && !ids.has(l.toItemId));
      links.push({ t: 'h', text: 'مساهمة الأنشطة في الخطة الاستراتيجية' }, { t: 'table', small: true, empty: 'لا توجد روابط مع عناصر الخطة الاستراتيجية',
        columns: [{ key: 'from', label: 'النشاط' }, { key: 'to', label: 'العنصر الاستراتيجي' }, { key: 'c', label: 'نسبة المساهمة', type: 'percent' }],
        rows: out.map((l) => { const f = a.itemById.get(l.fromItemId), to = a.itemById.get(l.toItemId); return { from: f ? `${f.code} ${f.title}` : null, to: to ? `${a.plans.get(to.planId)?.code ?? ''} · ${to.code} ${to.title}` : null, c: l.contribution }; }) });
    }
    links.push({ t: 'h', text: 'المخاطر والمراجع المرتبطة' }, { t: 'table', small: true, empty: 'لا توجد مخاطر أو مراجع مرتبطة',
      columns: [{ key: 'item', label: 'العنصر' }, { key: 'sys', label: 'النوع' }, { key: 'label', label: 'المرجع' }, { key: 'note', label: 'ملاحظة' }],
      rows: refs.map((r) => { const i = a.itemById.get(r.itemId); return { item: i ? `${i.code} ${i.title}` : null, sys: REF_SYS[r.system] ?? r.system, label: [r.refCode, r.refLabel].filter(Boolean).join(' '), note: r.note }; }) });
    sections.push({ title: 'الارتباطات والمخاطر', lead: strategic ? 'ما ينفذ الخطة وما يرتبط بها من مخاطر ومراجع في الأنظمة الأخرى' : 'كيف تخدم الخطة أهداف الخطة الاستراتيجية وما يرتبط بها من مخاطر', blocks: links });

    // 8. سجل الاعتماد
    sections.push({ title: 'سجل الإعداد والاعتماد', lead: 'مراحل المراجعة الداخلية قبل العرض على المجلس، والإصدارات المعتمدة السابقة', blocks: [
      { t: 'kv', items: [{ label: 'أعدها', value: p.createdByName }, { label: 'مسار الاعتماد', value: p.routeName ?? 'الافتراضي' }, { label: 'الحالة', value: WF[p.status] }, { label: 'آخر إصدار معتمد', value: p.version || 'لم تُعتمد بعد' }, ...(p.revisionNote ? [{ label: 'سبب التعديل', value: p.revisionNote }] : [])] },
      this.wfTable(p.approvals),
      { t: 'h', text: 'الإصدارات' },
      { t: 'table', small: true, empty: 'لا توجد إصدارات معتمدة سابقة', columns: [{ key: 'v', label: 'الإصدار', type: 'number' }, { key: 'by', label: 'اعتمده' }, { key: 'at', label: 'التاريخ', type: 'datetime' }, { key: 'note', label: 'ملاحظة الإصدار' }],
        rows: versions.map((v) => ({ v: v.version, by: v.approvedByName, at: v.approvedAt, note: v.note })) },
    ] });

    sections.push(this.decisionSection('قرار المجلس والتوقيعات', 'يُعبأ في اجتماع المجلس ويُحفظ مع محضره', ['الموافقة على اعتماد الخطة', 'الموافقة مع التعديلات الواردة في الملاحظات', 'إعادتها للدراسة واستكمال الملاحظات', 'عدم الموافقة'],
      await this.signatures(org, [{ role: 'إعداد', name: p.createdByName }, { role: 'مراجعة: مسؤول التخطيط', name: p.ownerName }]), q.meetingNo));

    return this.shell(actor, form, `${form.code}/${p.code}${p.version ? `/V${p.version}` : ''}`, `${p.code} · ${p.title}`, `الفترة ${periodText}`, [
      { label: 'الخطة', value: `${p.code} ${p.title}` }, { label: 'حالة الخطة', value: WF[p.status] }, { label: 'الإصدار', value: p.version || 'مسودة قبل أول اعتماد' }, { label: 'تاريخ آخر تحديث للخطة', value: p.updatedAt, type: 'datetime' },
    ], sections);
  }

  private async planPerformance(actor: OrgUser, q: BoardQuery): Promise<BoardDoc> {
    const t0 = today();
    const period = q.period || t0.slice(0, 4);
    const end = periodEndOf(period);
    const asOf = end < t0 ? end : t0;
    const { a, p } = await this.loadPlan(actor, q, asOf);
    const org = actor.organizationId;
    const form = this.formFor('plan-performance', p.kind);
    const t = this.tree(a, p.id);
    const s = this.analysis.summary(a, p);
    const lvl = (n: number) => p.levels[n]?.name ?? `المستوى ${n + 1}`;
    const y = planYear(p, a.year);
    const live = t.items.filter((i) => i.state !== 'cancelled');
    const leaves = live.filter((i) => t.isLeaf(i.id) && i.state !== 'carried_over');
    const st = (i: PlanItem) => a.rolled.get(i.id)?.status ?? 'not_started';
    const kpis = a.kpis.filter((k) => k.planId === p.id);
    const gap = s.progress !== null && s.planned !== null ? r1(s.progress - s.planned) : null;
    const assess = gap === null ? 'لا تتوفر بيانات كافية للحكم' : gap >= 0 ? 'متقدم على المخطط أو مطابق له' : gap >= -10 ? 'ضمن المسار مع تأخر محدود' : 'متأخر عن المخطط ويحتاج تدخلًا';
    const assessTone: Tone = gap === null ? 'neutral' : gap >= 0 ? 'good' : gap >= -10 ? 'warn' : 'bad';
    const delayed = leaves.filter((i) => st(i) === 'delayed'), atRisk = leaves.filter((i) => st(i) === 'at_risk'), completed = leaves.filter((i) => st(i) === 'completed');
    const kstat = (k: PlanKpi) => a.kpiStat.get(k.id);
    const kb = s.kpiBands;
    const best = kpis.filter((k) => kstat(k)?.ach !== null && kstat(k)?.ach !== undefined).sort((x, z) => (kstat(z)!.ach! - kstat(x)!.ach!));
    const overdueMs = leaves.flatMap((i) => i.milestones.filter((m) => !m.done && m.dueDate && m.dueDate <= asOf).map((m) => ({ i, m })));
    const sections: DocSection[] = [];

    sections.push({ title: 'الملخص التنفيذي', lead: `أداء الخطة حتى ${formatValue(asOf, 'date')}`, blocks: [
      { t: 'cards', items: [
        { label: 'الإنجاز الفعلي', value: s.progress, type: 'percent', tone: assessTone }, { label: 'المخطط حتى تاريخه', value: s.planned, type: 'percent' },
        { label: 'الفجوة', value: gap, type: 'number', tone: assessTone, hint: 'نقطة مئوية' }, { label: 'تحقق المؤشرات', value: s.performance, type: 'percent' },
        { label: 'منجز', value: completed.length, type: 'number', tone: 'good' }, { label: 'متأخر', value: delayed.length, type: 'number', tone: delayed.length ? 'bad' : 'good' },
        { label: 'في خطر', value: atRisk.length, type: 'number', tone: atRisk.length ? 'warn' : 'good' }, { label: `المؤشرات المحققة`, value: `${kb.green} من ${kpis.length}` },
      ] },
      { t: 'callout', tone: assessTone, title: `التقييم العام: ${assess}`, text: `بلغ الإنجاز العام ${pctText(s.progress)} مقابل ${pctText(s.planned)} مخطط حتى ${formatValue(asOf, 'date')}${gap === null ? '' : gap < 0 ? `، متأخرًا بـ${formatValue(-gap, 'number')} نقطة مئوية` : gap > 0 ? `، متقدمًا بـ${formatValue(gap, 'number')} نقطة مئوية` : ''}. من ${leaves.length} عنصرًا تنفيذيًا: ${completed.length} منجز، ${leaves.filter((i) => st(i) === 'on_track').length} حسب الخطة، ${atRisk.length} في خطر، ${delayed.length} متأخر. وتحقق ${kb.green} مؤشرًا مستهدف ${y}، وقارب ${kb.amber}، وجاء ${kb.red} دون المستهدف${kb.none ? `، ولا قراءة بعد لـ${kb.none}` : ''}.` },
      { t: 'h', text: 'أبرز الإنجازات' },
      { t: 'list', tone: 'good', empty: 'لا توجد إنجازات مكتملة في الفترة بعد', items: [
        ...completed.slice(0, 5).map((i) => `اكتمل ${i.code} ${i.title}`),
        ...best.filter((k) => kstat(k)!.band === 'green').slice(0, 3).map((k) => `حقق المؤشر «${k.name}» ${pctText(kstat(k)!.ach)} من مستهدفه`),
      ] },
      { t: 'h', text: 'أبرز التحديات' },
      { t: 'list', tone: 'bad', empty: 'لا توجد عناصر متأخرة أو مؤشرات دون المستهدف', items: [
        ...delayed.slice(0, 5).map((i) => `${i.code} ${i.title}: إنجاز ${pctText(i.progress)} والمخطط ${pctText(a.rolled.get(i.id)?.planned ?? null)}`),
        ...kpis.filter((k) => kstat(k)?.band === 'red').slice(0, 3).map((k) => `المؤشر «${k.name}» عند ${pctText(kstat(k)!.ach)} من مستهدفه`),
      ] },
    ] });

    const rootRows = t.roots.map((r) => { const ro = a.rolled.get(r.id)!; return { code: r.code, title: r.title, planned: ro.planned, progress: ro.progress, gap: ro.planned !== null ? r1(ro.progress - ro.planned) : null, perf: a.perf.get(r.id) ?? null, yearCost: Number(ro.costByYear[String(y)]) || 0, status: EXEC[ro.status], _tone: EXEC_TONE[ro.status] }; });
    sections.push({ title: `الأداء حسب ${lvl(0)}`, lead: 'الإنجاز الفعلي مقابل المخطط لكل محور، والخط الداكن يمثل المخطط حتى تاريخه', blocks: [
      { t: 'bars', items: t.roots.map((r) => { const ro = a.rolled.get(r.id)!; return { label: `${r.code} ${r.title}`, value: ro.progress, ref: ro.planned, tone: EXEC_TONE[ro.status] === 'neutral' ? 'info' : EXEC_TONE[ro.status] }; }) },
      { t: 'table', columns: [{ key: 'code', label: 'الرمز' }, { key: 'title', label: lvl(0) }, { key: 'planned', label: 'المخطط', type: 'percent' }, { key: 'progress', label: 'الفعلي', type: 'percent' }, { key: 'gap', label: 'الفجوة', type: 'number' }, { key: 'perf', label: 'تحقق المؤشرات', type: 'percent' }, { key: 'yearCost', label: `تكلفة ${y}`, type: 'money' }, { key: 'status', label: 'الحالة' }],
        rows: rootRows, totals: { planned: s.planned, progress: s.progress, gap, perf: s.performance, yearCost: s.yearCost }, totalLabel: 'الخطة' },
    ] });

    const detail: Block[] = [];
    for (const r of t.roots) {
      const d = [r, ...t.desc(r.id)].filter((i) => i.state !== 'cancelled');
      const ro = a.rolled.get(r.id)!;
      detail.push({ t: 'h', text: `${r.code} ${r.title}`, note: `إنجاز ${pctText(ro.progress)} · المخطط ${pctText(ro.planned)} · ${EXEC[ro.status]}` });
      detail.push({ t: 'table', small: true, indent: 'title',
        columns: [{ key: 'code', label: 'الرمز', width: '8%' }, { key: 'title', label: 'العنصر' }, { key: 'owner', label: 'المسؤول', width: '13%' }, { key: 'end', label: 'النهاية', type: 'date' },
          { key: 'planned', label: 'المخطط', type: 'percent' }, { key: 'progress', label: 'الفعلي', type: 'percent' }, { key: 'status', label: 'الحالة' }, { key: 'note', label: 'ملاحظة التنفيذ', width: '22%' }],
        rows: d.map((i) => { const x = a.rolled.get(i.id)!; return { code: i.code, title: i.title, owner: i.ownerName, end: i.endDate, planned: x.planned, progress: x.progress, status: EXEC[x.status], note: i.progressNote, _level: i.level - r.level, _style: i.id === r.id ? 'strong' : undefined, _tone: EXEC_TONE[x.status] }; }) });
    }
    sections.push({ title: 'تفصيل الإنجاز لكل عنصر', lead: 'كل عنصر بنسبة إنجازه المخططة والفعلية وحالته وآخر ملاحظة تنفيذ', blocks: detail });

    sections.push({ title: 'تحقق مؤشرات الأداء', lead: `المستهدف والمحقق لكل مؤشر في سنة ${y}`, blocks: [
      { t: 'cards', items: [{ label: 'محقق', value: kb.green, type: 'number', tone: 'good' }, { label: 'قريب من المستهدف', value: kb.amber, type: 'number', tone: 'warn' }, { label: 'دون المستهدف', value: kb.red, type: 'number', tone: 'bad' }, { label: 'بلا قراءة', value: kb.none, type: 'number', tone: 'neutral' }] },
      { t: 'table', small: true, empty: 'لا توجد مؤشرات',
        columns: [{ key: 'code', label: 'الرمز' }, { key: 'name', label: 'المؤشر', width: '26%' }, { key: 'unit', label: 'الوحدة' }, { key: 'baseline', label: 'خط الأساس', type: 'number' }, { key: 'target', label: 'المستهدف', type: 'number' }, { key: 'actual', label: 'المحقق', type: 'number' }, { key: 'ach', label: 'نسبة التحقق', type: 'percent' }, { key: 'band', label: 'المستوى' }, { key: 'missing', label: 'فترات بلا قراءة' }],
        rows: kpis.map((k) => { const x = kstat(k); return { code: k.code, name: k.name, unit: k.unit, baseline: k.baseline, target: x?.target ?? null, actual: x?.actual ?? null, ach: x?.ach ?? null, band: x?.band ? BAND[x.band] : 'بلا قراءة', missing: x?.missing.length ? x.missing.map(PERIOD_LABEL).join('، ') : null, _tone: x?.band ? BAND_TONE[x.band] : undefined }; }) },
    ] });

    const lagging = [...delayed, ...atRisk];
    sections.push({ title: 'الانحرافات والإجراءات التصحيحية', lead: 'العناصر المتأخرة أو المعرضة للتأخر والمعالم المتجاوزة لمواعيدها', blocks: [
      { t: 'table', small: true, empty: 'لا توجد عناصر متأخرة أو في خطر',
        columns: [{ key: 'code', label: 'الرمز' }, { key: 'title', label: 'العنصر' }, { key: 'owner', label: 'المسؤول' }, { key: 'gap', label: 'الفجوة', type: 'number' }, { key: 'status', label: 'الحالة' }, { key: 'action', label: 'الإجراء التصحيحي', width: '30%' }],
        rows: lagging.map((i) => { const x = a.rolled.get(i.id)!; return { code: i.code, title: i.title, owner: i.ownerName, gap: x.planned !== null ? r1(x.progress - x.planned) : null, status: EXEC[x.status], action: i.correctiveAction ?? 'لم يُسجّل إجراء تصحيحي', _tone: EXEC_TONE[x.status] }; }) },
      { t: 'h', text: 'المعالم المتجاوزة لموعدها' },
      { t: 'table', small: true, empty: 'لا توجد معالم متجاوزة لموعدها', columns: [{ key: 'item', label: 'العنصر' }, { key: 'm', label: 'المعلم' }, { key: 'due', label: 'الموعد', type: 'date' }],
        rows: overdueMs.map(({ i, m }) => ({ item: `${i.code} ${i.title}`, m: m.title, due: m.dueDate, _tone: 'bad' as Tone })) },
    ] });

    const recs = [
      ...(lagging.filter((i) => !i.correctiveAction).length ? [`تكليف مسؤولي ${lagging.filter((i) => !i.correctiveAction).length} عنصرًا متأخرًا بتسجيل إجراء تصحيحي بموعد محدد`] : []),
      ...(kb.none ? [`استكمال قراءات ${kb.none} مؤشرًا بلا قراءة لتمكين المجلس من الحكم على التحقق`] : []),
      ...(kb.red ? [`مراجعة أسباب انخفاض ${kb.red} مؤشرًا دون المستهدف وإمكانية تعديل المبادرات المرتبطة`] : []),
      ...(overdueMs.length ? [`متابعة ${overdueMs.length} معلمًا تجاوز موعده وتحديث الجدول الزمني`] : []),
      ...(s.unowned ? [`تحديد مسؤول لـ${s.unowned} عنصرًا بلا مسؤول`] : []),
    ];
    sections.push({ title: 'التوصيات المقترحة', lead: 'توصيات مولّدة من نتائج الأداء، يضيف إليها معد التقرير ما يراه', blocks: [
      { t: 'list', numbered: true, items: recs, empty: 'لا توجد توصيات آلية؛ الأداء ضمن المسار.' },
      { t: 'lines', label: 'توصيات إضافية من الإدارة التنفيذية', count: 4 },
    ] });

    sections.push(this.decisionSection('توجيهات المجلس والتوقيعات', 'يُعبأ في اجتماع المجلس ويُحفظ مع محضره', ['الاطلاع والإحاطة', 'اعتماد الإجراءات التصحيحية المقترحة', 'طلب إيضاحات إضافية', 'التوجيه بتعديل الخطة'],
      await this.signatures(org, [{ role: 'إعداد', name: actor.fullName }, { role: 'مراجعة: مالك الخطة', name: p.ownerName }]), q.meetingNo));

    return this.shell(actor, form, `${form.code}/${p.code}/${period}`, `${p.code} · ${p.title}`, `فترة التقرير: ${periodLabel(period)} (حتى ${formatValue(asOf, 'date')})`, [
      { label: 'الخطة', value: `${p.code} ${p.title}` }, { label: 'فترة التقرير', value: periodLabel(period) }, { label: 'البيانات حتى', value: asOf, type: 'date' }, { label: 'إصدار الخطة', value: p.version || 'غير معتمدة' },
      { label: 'ملاحظة', value: 'نسب الإنجاز كما سُجلت في النظام وقت الإصدار، وقراءات المؤشرات حسب فتراتها' },
    ], sections);
  }

  // ---------------- الموازنات ----------------

  private budgetId(q: BoardQuery) {
    if (!q.budgetId || !/^[0-9a-f-]{36}$/i.test(q.budgetId)) throw new BadRequestException('اختر الموازنة');
    return q.budgetId;
  }

  private async budgetApproval(actor: OrgUser, q: BoardQuery): Promise<BoardDoc> {
    const b = await this.budgets.get(actor, this.budgetId(q));
    if (b.isScenario) throw new BadRequestException('السيناريو لا يُرفع للمجلس. حوّله إلى الموازنة أولًا');
    const org = actor.organizationId;
    const form = this.formFor('budget-approval', null);
    const s = b.summary;
    type L = { id: string; section: Section; kind: string; name: string; unitName: string | null; accountCode: string | null; accountName?: string | null; fundingType: string | null; amount: number; auto: number; included: boolean; overrideNote?: string | null; note?: string | null; params: Record<string, unknown>; trace?: { label: string }[]; monthly: number[] };
    const lines = (b.lines as unknown as L[]).filter((l) => l.included);
    const total = s.expenses;
    const versions = b.versions as unknown as BudgetVersion[];
    const sectionsDoc: DocSection[] = [];
    const balTone: Tone = s.balance >= 0 ? 'good' : 'bad';

    sectionsDoc.push({ title: 'الملخص التنفيذي', lead: 'الأرقام الرئيسة للموازنة وما يطلب من المجلس اعتماده', blocks: [
      { t: 'cards', items: [
        { label: 'إجمالي المصروفات', value: s.expenses, type: 'money' }, { label: 'الإيرادات المتوقعة', value: s.revenues, type: 'money' },
        { label: s.balance >= 0 ? 'الفائض المتوقع' : 'العجز المتوقع', value: Math.abs(s.balance), type: 'money', tone: balTone }, { label: 'الموازنة الرأسمالية', value: s.capital, type: 'money', hint: 'من نظام الأصول' },
        { label: 'الوظائف الحالية', value: s.headcount.current, type: 'number' }, { label: 'وظائف جديدة', value: s.headcount.new, type: 'number' },
      ] },
      { t: 'p', text: `أُعدت الموازنة التقديرية «${b.title}» للسنة المالية ${b.fiscalYear} بمنهجية ${b.methodologyName}، بإجمالي مصروفات ${money(s.expenses)} (الموارد البشرية ${pctText(pct(s.sections.hr, total))}، المصروفات التشغيلية ${pctText(pct(s.sections.opex, total))}، الأنشطة والبرامج ${pctText(pct(s.sections.activity, total))})، مقابل إيرادات متوقعة ${money(s.revenues)}، ${s.balance >= 0 ? `بفائض ${money(s.balance)}` : `بعجز ${money(Math.abs(s.balance))} يلزم تحديد مصدر تغطيته`}. وعدد بنودها ${lines.length} بندًا${s.overrides ? `، عُدّل ${s.overrides} منها يدويًا عن التقدير الآلي بمبرر مسجل` : ''}.` },
      { t: 'h', text: 'هيكل المصروفات' },
      { t: 'bars', valueLabel: 'النسبة من المصروفات', items: (['hr', 'opex', 'activity'] as Section[]).map((k) => ({ label: SECTION_NAME[k], value: pct(s.sections[k], total), tone: 'info' as Tone, text: `${formatValue(s.sections[k], 'money')} (${pctText(pct(s.sections[k], total))})` })) },
      { t: 'h', text: 'فحوص السلامة' },
      b.checks.length ? { t: 'list', tone: 'warn', items: b.checks.map((c) => c.text) } : { t: 'callout', tone: 'good', title: 'لا توجد ملاحظات', text: 'لا ازدواج في الرواتب، ولا تجاوز للسقوف، ولا معادلات قديمة.' },
      { t: 'callout', tone: 'info', title: 'القرار المطلوب من المجلس', text: `اعتماد الموازنة التقديرية للسنة المالية ${b.fiscalYear} بإجمالي مصروفات ${money(s.expenses)} وإيرادات متوقعة ${money(s.revenues)}${s.capital ? ` وموازنة رأسمالية ${money(s.capital)}` : ''}، وتفويض الإدارة التنفيذية بالصرف في حدود بنودها وفق الصلاحيات المالية.` },
    ] });

    const vars = b.variables ?? [];
    sectionsDoc.push({ title: 'الأسس والافتراضات', lead: 'المنهجية والافتراضات التي بُنيت عليها التقديرات، وسقوف الإدارات', blocks: [
      { t: 'kv', items: [{ label: 'السنة المالية', value: b.fiscalYear }, { label: 'المنهجية', value: b.methodologyName }, { label: 'سنوات الأساس التاريخي', value: b.historyYears }, { label: 'آخر احتساب', value: dateText(b.calculatedAt) }] },
      ...(b.description ? [{ t: 'p', text: b.description } as Block] : []),
      { t: 'h', text: 'الافتراضات' },
      { t: 'table', small: true, empty: 'لا توجد افتراضات', columns: [{ key: 'name', label: 'الافتراض' }, { key: 'value', label: 'القيمة', type: 'number' }, { key: 'unit', label: 'الوحدة' }, { key: 'scope', label: 'النطاق' }, { key: 'steps', label: 'قيم مرحلية' }, { key: 'note', label: 'ملاحظة' }],
        rows: vars.map((v) => ({ name: v.name, value: v.value, unit: v.unit, scope: v.unitName ?? 'عام', steps: v.steps?.length ? v.steps.map((x) => `من ${MONTHS_AR[x.fromMonth - 1]}: ${formatValue(x.value, 'number')}`).join('، ') : null, note: v.note })) },
      ...((b.raiseRules ?? []).length ? [{ t: 'h', text: 'قواعد العلاوات' } as Block, { t: 'table', small: true, columns: [{ key: 'name', label: 'القاعدة' }, { key: 'pct', label: 'النسبة', type: 'percent' }, { key: 'from', label: 'من شهر' }], rows: b.raiseRules.map((r) => ({ name: r.name, pct: r.pct, from: MONTHS_AR[r.fromMonth - 1] })) } as Block] : []),
      { t: 'h', text: 'المصروفات حسب الإدارة' },
      { t: 'table', small: true, columns: [{ key: 'unit', label: 'الإدارة' }, { key: 'hr', label: 'الموارد البشرية', type: 'money' }, { key: 'opex', label: 'التشغيلية', type: 'money' }, { key: 'activity', label: 'الأنشطة', type: 'money' }, { key: 'total', label: 'الإجمالي', type: 'money' }, { key: 'ceiling', label: 'السقف', type: 'money' }, { key: 'over', label: 'التجاوز', type: 'money' }],
        rows: s.byUnit.map((u) => ({ unit: u.unitName, hr: u.hr, opex: u.opex, activity: u.activity, total: u.total, ceiling: u.ceiling, over: u.over !== null && u.over > 0 ? u.over : null, _tone: u.over !== null && u.over > 0 ? 'bad' as Tone : undefined })),
        totals: { hr: s.sections.hr, opex: s.sections.opex, activity: s.sections.activity, total: s.expenses } },
      { t: 'h', text: 'المصروفات حسب نوع التمويل' },
      { t: 'table', small: true, columns: [{ key: 'f', label: 'نوع التمويل' }, { key: 'amount', label: 'المبلغ', type: 'money' }, { key: 'share', label: 'النسبة', type: 'percent' }],
        rows: Object.entries(s.byFunding).filter(([, v]) => v).map(([k, v]) => ({ f: FUNDING[k] ?? k, amount: v, share: pct(v, total) })) },
    ] });

    sectionsDoc.push({ title: 'ملخص الموازنة حسب الأقسام', lead: 'الإيرادات والمصروفات الإجمالية وصافيها', blocks: [
      { t: 'table', columns: [{ key: 'sec', label: 'القسم' }, { key: 'n', label: 'عدد البنود', type: 'number' }, { key: 'amount', label: 'المبلغ المقترح', type: 'money' }, { key: 'share', label: 'من المصروفات', type: 'percent' }],
        rows: [
          ...(['hr', 'opex', 'activity'] as Section[]).map((k) => ({ sec: SECTION_NAME[k], n: lines.filter((l) => l.section === k).length, amount: s.sections[k], share: pct(s.sections[k], total) })),
          { sec: 'إجمالي المصروفات', n: lines.filter((l) => l.section !== 'revenue').length, amount: s.expenses, share: total ? 100 : null, _style: 'strong' },
          { sec: SECTION_NAME.revenue, n: lines.filter((l) => l.section === 'revenue').length, amount: s.revenues, share: null },
          { sec: s.balance >= 0 ? 'الفائض' : 'العجز', n: null, amount: s.balance, share: null, _style: 'strong', _tone: balTone },
          ...(s.capital ? [{ sec: 'الموازنة الرأسمالية (من نظام الأصول)', n: b.capital.length, amount: s.capital, share: null, _style: 'muted' as const }] : []),
        ] },
    ] });

    for (const k of SECTIONS) {
      const ls = lines.filter((l) => l.section === k);
      if (!ls.length) continue;
      const amount = sum(ls.map((l) => l.amount));
      const basis = (l: L) => l.overrideNote ? `معدّل يدويًا: ${l.overrideNote}` : (l.trace ?? []).filter((x) => !x.label.startsWith('إجمالي') && !x.label.startsWith('التقدير الآلي')).map((x) => x.label).slice(0, 2).join(' · ') || l.note || null;
      const byUnit = new Map<string, number>();
      for (const l of ls) byUnit.set(l.unitName ?? 'على مستوى الشركة', r2((byUnit.get(l.unitName ?? 'على مستوى الشركة') ?? 0) + l.amount));
      sectionsDoc.push({ title: `بنود ${SECTION_NAME[k]}`, lead: `${ls.length} بندًا بإجمالي ${money(amount)}${k !== 'revenue' ? ` (${pctText(pct(amount, total))} من المصروفات)` : ''}`, blocks: [
        { t: 'cards', items: [...byUnit.entries()].sort((x, z) => z[1] - x[1]).slice(0, 6).map(([u, v]) => ({ label: u, value: v, type: 'money' as const })) },
        { t: 'table', small: true,
          columns: [{ key: 'name', label: 'البند', width: '24%' }, { key: 'kind', label: 'النوع' }, { key: 'unit', label: 'الإدارة' }, { key: 'account', label: 'الحساب' }, { key: 'funding', label: 'التمويل' }, { key: 'auto', label: 'التقدير الآلي', type: 'money' }, { key: 'amount', label: 'المقترح', type: 'money' }, { key: 'basis', label: 'أساس الاحتساب', width: '22%' }],
          rows: ls.map((l) => ({ name: l.name, kind: KIND_LINE[l.kind] ?? l.kind, unit: l.unitName ?? 'الشركة', account: [l.accountCode, l.accountName].filter(Boolean).join(' ') || null, funding: l.fundingType ? FUNDING[l.fundingType] : null, auto: l.auto, amount: l.amount, basis: basis(l), _tone: l.overrideNote ? 'warn' as Tone : undefined })),
          totals: { auto: sum(ls.map((l) => l.auto)), amount } },
        ...(k === 'hr' && !b.canHr ? [{ t: 'p', text: 'تكلفة الموظفين الحاليين مجمعة لكل إدارة لأن عرض الرواتب الفردية ليس من صلاحية معد التقرير.', muted: true } as Block] : []),
      ] });
    }

    const exp = s.byMonth.expenses, rev = s.byMonth.revenues;
    sectionsDoc.push({ title: 'التوزيع الشهري', lead: 'توزيع المصروفات والإيرادات على أشهر السنة، وهو أساس متابعة التنفيذ والتدفق النقدي', blocks: [
      { t: 'columns', labels: MONTHS_AR.map((m) => m.slice(0, 3)), series: [{ name: 'المصروفات', values: exp, tone: 'bad' }, { name: 'الإيرادات', values: rev, tone: 'good' }] },
      { t: 'table', small: true, columns: [{ key: 'm', label: 'الشهر' }, { key: 'exp', label: 'المصروفات', type: 'money' }, { key: 'rev', label: 'الإيرادات', type: 'money' }, { key: 'net', label: 'الصافي', type: 'money' }, { key: 'cum', label: 'الصافي التراكمي', type: 'money' }],
        rows: MONTHS_AR.map((m, i) => ({ m, exp: exp[i], rev: rev[i], net: r2(rev[i] - exp[i]), cum: sum(rev.slice(0, i + 1)) - sum(exp.slice(0, i + 1)), _tone: sum(rev.slice(0, i + 1)) - sum(exp.slice(0, i + 1)) < 0 ? 'warn' as Tone : undefined })),
        totals: { exp: sum(exp), rev: sum(rev), net: r2(sum(rev) - sum(exp)) } },
    ] });

    if (b.capital.length) {
      sectionsDoc.push({ title: 'الموازنة الرأسمالية', lead: 'بنود شراء الأصول للسنة من نظام الأصول الثابتة (قراءة فقط)', blocks: [
        { t: 'table', small: true, columns: [{ key: 'no', label: 'الرقم' }, { key: 'd', label: 'البند' }, { key: 'b', label: 'موازنة الأصول' }, { key: 'amount', label: 'المبلغ', type: 'money' }],
          rows: b.capital.map((c) => ({ no: c.lineNo, d: c.description, b: c.budgetTitle, amount: c.amount })), totals: { amount: s.capital } },
      ] });
    }

    sectionsDoc.push({ title: 'سجل الإعداد والاعتماد', lead: 'مراحل المراجعة الداخلية والإصدارات المعتمدة', blocks: [
      { t: 'kv', items: [{ label: 'أعدها', value: b.createdByName }, { label: 'مسار الاعتماد', value: b.routeName ?? 'الافتراضي' }, { label: 'الحالة', value: WF[b.status] }, { label: 'آخر إصدار معتمد', value: b.version || 'لم تُعتمد بعد' }, ...(b.revisionNote ? [{ label: 'سبب التعديل', value: b.revisionNote }] : [])] },
      this.wfTable(b.approvals),
      { t: 'h', text: 'الإصدارات' },
      { t: 'table', small: true, empty: 'لا توجد إصدارات معتمدة سابقة', columns: [{ key: 'v', label: 'الإصدار', type: 'number' }, { key: 'exp', label: 'المصروفات', type: 'money' }, { key: 'rev', label: 'الإيرادات', type: 'money' }, { key: 'by', label: 'اعتمده' }, { key: 'at', label: 'التاريخ', type: 'datetime' }, { key: 'note', label: 'ملاحظة' }],
        rows: versions.map((v) => ({ v: v.version, exp: v.expenses, rev: v.revenues, by: v.approvedByName, at: v.approvedAt, note: v.note })) },
    ] });

    sectionsDoc.push(this.decisionSection('قرار المجلس والتوقيعات', 'يُعبأ في اجتماع المجلس ويُحفظ مع محضره', ['الموافقة على اعتماد الموازنة', 'الموافقة مع التعديلات الواردة في الملاحظات', 'إعادتها للدراسة', 'عدم الموافقة'],
      await this.signatures(org, [{ role: 'إعداد', name: b.createdByName }, { role: 'مراجعة: المسؤول المالي', name: null }]), q.meetingNo));

    return this.shell(actor, form, `${form.code}/${b.code}${b.version ? `/V${b.version}` : ''}`, `${b.code} · ${b.title}`, `السنة المالية ${b.fiscalYear}`, [
      { label: 'الموازنة', value: `${b.code} ${b.title}` }, { label: 'السنة المالية', value: b.fiscalYear }, { label: 'الحالة', value: WF[b.status] }, { label: 'الإصدار', value: b.version || 'مسودة قبل أول اعتماد' },
    ], sectionsDoc);
  }

  private async budgetPerformance(actor: OrgUser, q: BoardQuery): Promise<BoardDoc> {
    const org = actor.organizationId;
    const b = await this.exec.approved(org, this.budgetId(q));
    const form = this.formFor('budget-performance', null);
    const t0 = today();
    const period = q.period || (b.fiscalYear === Number(t0.slice(0, 4)) ? t0.slice(0, 7) : String(b.fiscalYear));
    const end = periodEndOf(period);
    if (Number(end.slice(0, 4)) !== b.fiscalYear) throw new BadRequestException(`اختر فترة داخل السنة المالية ${b.fiscalYear}`);
    const month = Math.min(Number(end.slice(5, 7)), b.fiscalYear === Number(t0.slice(0, 4)) ? Number(t0.slice(5, 7)) : b.fiscalYear < Number(t0.slice(0, 4)) ? 12 : 0);
    const ex = await this.exec.compute(org, b, { month });
    const transfers = await this.db.getRepository(BudgetTransfer).find({ where: { organizationId: org, budgetId: b.id, status: 'approved' }, order: { createdAt: 'ASC' } });
    const E = ex.totals.expenses, R = ex.totals.revenues;
    const execPct = pct(E.actual, E.plannedToDate), yearPct = pct(E.actual, E.current), revPct = pct(R.actual, R.plannedToDate);
    const variance = r2(E.actual - E.plannedToDate);
    const tone = (r: ExecRow): Tone | undefined => (r.status === 'over' ? 'bad' : r.status === 'warn' ? 'warn' : undefined);
    const exp = ex.rows.filter((r) => r.section !== 'revenue'), rev = ex.rows.filter((r) => r.section === 'revenue');
    const forecastGap = r2(E.forecast - E.current);
    const monthName = month ? MONTHS_AR[month - 1] : 'بداية السنة';
    const sections: DocSection[] = [];
    const overallTone: Tone = ex.rows.some((r) => r.status === 'over') ? 'bad' : forecastGap > 0 || (execPct !== null && execPct > 110) ? 'warn' : 'good';

    sections.push({ title: 'الملخص التنفيذي', lead: `تنفيذ الموازنة حتى نهاية ${monthName} ${b.fiscalYear}`, blocks: [
      { t: 'cards', items: [
        { label: 'الموازنة المعدلة للمصروفات', value: E.current, type: 'money' }, { label: 'المخطط حتى تاريخه', value: E.plannedToDate, type: 'money' },
        { label: 'الفعلي حتى تاريخه', value: E.actual, type: 'money' }, { label: 'نسبة التنفيذ من المخطط', value: execPct, type: 'percent', tone: overallTone },
        { label: 'المتوقع لنهاية السنة', value: E.forecast, type: 'money', tone: forecastGap > 0 ? 'warn' : 'good' }, { label: 'المتاح للصرف', value: E.available, type: 'money' },
        { label: 'الإيرادات الفعلية', value: R.actual, type: 'money' }, { label: 'تحصيل الإيرادات من المخطط', value: revPct, type: 'percent', tone: revPct !== null && revPct < 90 ? 'warn' : 'good' },
      ] },
      { t: 'callout', tone: overallTone, title: overallTone === 'good' ? 'التنفيذ ضمن الموازنة' : overallTone === 'warn' ? 'يحتاج متابعة' : 'يوجد تجاوز في بنود', text: `صُرف ${money(E.actual)} حتى نهاية ${monthName} مقابل ${money(E.plannedToDate)} مخطط (${pctText(execPct)})، أي ${pctText(yearPct)} من الموازنة المعدلة للسنة البالغة ${money(E.current)}، ${variance > 0 ? `بزيادة ${money(variance)} عن المخطط` : variance < 0 ? `بوفر ${money(Math.abs(variance))} عن المخطط` : 'مطابقًا للمخطط'}. والتوقع لنهاية السنة ${money(E.forecast)} ${forecastGap > 0 ? `بتجاوز ${money(forecastGap)}` : `بوفر ${money(Math.abs(forecastGap))}`}. وحُصّل من الإيرادات ${money(R.actual)} مقابل ${money(R.plannedToDate)} مخطط.${transfers.length ? ` واعتُمدت ${transfers.length} مناقلة أو تعديل خلال السنة.` : ''}` },
      { t: 'h', text: 'أبرز الملاحظات' },
      { t: 'list', tone: 'warn', items: ex.alerts.slice(0, 8).map((x) => x.text), empty: 'لا توجد تنبيهات: كل البنود ضمن حدودها.' },
    ] });

    const secRows = (['hr', 'opex', 'activity', 'revenue'] as Section[]).map((k) => {
      const rs = ex.rows.filter((r) => r.section === k);
      const c = sum(rs.map((r) => r.current)), p = sum(rs.map((r) => r.plannedToDate)), a = sum(rs.map((r) => r.actual)), f = sum(rs.map((r) => r.forecast));
      return { k, sec: SECTION_NAME[k], current: c, planned: p, actual: a, variance: r2(a - p), vpct: p ? r1(((a - p) / p) * 100) : null, exec: pct(a, p), forecast: f, _style: k === 'revenue' ? 'group' as const : undefined, n: rs.length };
    }).filter((r) => r.n);
    sections.push({ title: 'الأداء حسب الأقسام', lead: 'الموازنة المعدلة (المعتمدة مع المناقلات) مقابل المخطط والفعلي حتى تاريخه', blocks: [
      { t: 'bars', valueLabel: 'الفعلي من الموازنة المعدلة', refLabel: 'المخطط حتى تاريخه', items: secRows.map((r) => ({ label: r.sec, value: pct(r.actual, r.current), ref: pct(r.planned, r.current), tone: (r.k !== 'revenue' && r.actual > r.planned * 1.1) ? 'warn' as Tone : 'good' as Tone })) },
      { t: 'table', columns: [{ key: 'sec', label: 'القسم' }, { key: 'current', label: 'الموازنة المعدلة', type: 'money' }, { key: 'planned', label: 'المخطط حتى تاريخه', type: 'money' }, { key: 'actual', label: 'الفعلي', type: 'money' }, { key: 'variance', label: 'الانحراف', type: 'money' }, { key: 'vpct', label: 'الانحراف %', type: 'percent' }, { key: 'forecast', label: 'المتوقع للسنة', type: 'money' }],
        rows: [...secRows.filter((r) => r.k !== 'revenue'), { sec: 'إجمالي المصروفات', current: E.current, planned: E.plannedToDate, actual: E.actual, variance, vpct: E.plannedToDate ? r1((variance / E.plannedToDate) * 100) : null, forecast: E.forecast, _style: 'strong' }, ...secRows.filter((r) => r.k === 'revenue')] },
      { t: 'h', text: 'مكونات الموازنة المعدلة' },
      { t: 'kv', items: [{ label: 'الأصلية (الإصدار الأول)', value: E.original, type: 'money' }, { label: 'المعتمدة الحالية', value: E.approved, type: 'money' }, { label: 'صافي المناقلات', value: E.transfers, type: 'money' }, { label: 'المعدلة', value: E.current, type: 'money' }, { label: 'المحجوز من الأنظمة الأخرى', value: E.reserved, type: 'money' }, { label: 'المتاح', value: E.available, type: 'money' }] },
    ] });

    for (const k of ['hr', 'opex', 'activity', 'revenue'] as Section[]) {
      const rs = ex.rows.filter((r) => r.section === k);
      if (!rs.length) continue;
      const isRev = k === 'revenue';
      sections.push({ title: `تفصيل ${SECTION_NAME[k]}`, lead: `${rs.length} بندًا · الفعلي ${money(sum(rs.map((r) => r.actual)))} من ${money(sum(rs.map((r) => r.current)))}`, blocks: [
        { t: 'table', small: true,
          columns: [{ key: 'name', label: 'البند', width: '24%' }, { key: 'unit', label: 'الإدارة' }, { key: 'current', label: 'المعدلة', type: 'money' }, { key: 'planned', label: 'المخطط حتى تاريخه', type: 'money' }, { key: 'actual', label: 'الفعلي', type: 'money' }, { key: 'vpct', label: 'الانحراف %', type: 'percent' },
            ...(isRev ? [] : [{ key: 'available', label: 'المتاح', type: 'money' as const }]), { key: 'forecast', label: 'المتوقع', type: 'money' }, { key: 'status', label: 'الحالة' }],
          rows: rs.map((r) => ({ name: r.name, unit: r.unitName ?? 'الشركة', current: r.current, planned: r.plannedToDate, actual: r.actual, vpct: r.variancePct, available: r.available, forecast: r.forecast, status: r.status === 'over' ? 'تجاوز' : r.status === 'warn' ? 'انتباه' : 'ضمن الحد', _tone: tone(r) })),
          totals: { current: sum(rs.map((r) => r.current)), planned: sum(rs.map((r) => r.plannedToDate)), actual: sum(rs.map((r) => r.actual)), ...(isRev ? {} : { available: sum(rs.map((r) => r.available ?? 0)) }), forecast: sum(rs.map((r) => r.forecast)) } },
        ...(rs.some((r) => !r.mapped && r.actualSource === 'commitments') ? [{ t: 'p', text: 'البنود غير المربوطة بحسابات يُحسب فعليها من الحجوزات المصروفة في الأنظمة الأخرى.', muted: true } as Block] : []),
      ] });
    }

    const bm = ex.byMonth;
    sections.push({ title: 'الأداء الشهري', lead: 'المخطط مقابل الفعلي لكل شهر حتى تاريخ التقرير', blocks: [
      { t: 'columns', labels: MONTHS_AR.map((m) => m.slice(0, 3)), series: [{ name: 'المصروفات المخططة', values: bm.planned, tone: 'neutral' }, { name: 'المصروفات الفعلية', values: bm.actual, tone: 'info' }] },
      { t: 'table', small: true, columns: [{ key: 'm', label: 'الشهر' }, { key: 'p', label: 'المصروفات المخططة', type: 'money' }, { key: 'a', label: 'المصروفات الفعلية', type: 'money' }, { key: 'v', label: 'الانحراف', type: 'money' }, { key: 'rp', label: 'الإيرادات المخططة', type: 'money' }, { key: 'ra', label: 'الإيرادات الفعلية', type: 'money' }],
        rows: MONTHS_AR.map((m, i) => ({ m, p: bm.planned[i], a: i < month ? bm.actual[i] : null, v: i < month ? r2(bm.actual[i] - bm.planned[i]) : null, rp: bm.revPlanned[i], ra: i < month ? bm.revActual[i] : null, _style: i >= month ? 'muted' as const : undefined })),
        totals: { p: sum(bm.planned), a: sum(bm.actual), rp: sum(bm.revPlanned), ra: sum(bm.revActual) } },
    ] });

    sections.push({ title: 'المناقلات والمصروفات خارج الموازنة', lead: 'التعديلات المعتمدة على الموازنة خلال السنة، والصرف على حسابات لا يقابلها بند', blocks: [
      { t: 'table', small: true, empty: 'لم تُعتمد مناقلات أو تعديلات', columns: [{ key: 'code', label: 'الرقم' }, { key: 'kind', label: 'النوع' }, { key: 'from', label: 'من بند' }, { key: 'to', label: 'إلى بند' }, { key: 'amount', label: 'المبلغ', type: 'money' }, { key: 'reason', label: 'السبب', width: '28%' }, { key: 'at', label: 'التاريخ', type: 'date' }],
        rows: transfers.map((x) => ({ code: x.code, kind: TRANSFER[x.kind], from: x.fromName, to: x.toName, amount: x.amount, reason: x.reason, at: x.approvedAt ?? x.createdAt })) },
      { t: 'h', text: 'فعلي على حسابات خارج الموازنة' },
      { t: 'table', small: true, empty: 'لا يوجد صرف خارج بنود الموازنة', columns: [{ key: 'code', label: 'الحساب' }, { key: 'name', label: 'الاسم' }, { key: 'nature', label: 'الطبيعة' }, { key: 'actual', label: 'الفعلي', type: 'money' }],
        rows: ex.outside.map((o) => ({ code: o.code, name: o.name, nature: o.nature === 'revenue' ? 'إيراد' : 'مصروف', actual: o.actual, _tone: o.nature === 'revenue' ? undefined : 'warn' as Tone })) },
    ] });

    const sig = [...exp.filter((r) => r.status !== 'ok'), ...rev.filter((r) => r.status !== 'ok')];
    const recs = [
      ...(exp.filter((r) => r.status === 'over').length ? [`إيقاف الصرف على ${exp.filter((r) => r.status === 'over').length} بندًا متجاوزًا حتى اعتماد مناقلة أو زيادة بمبرر`] : []),
      ...(forecastGap > 0 ? [`دراسة تغطية التجاوز المتوقع لنهاية السنة (${money(forecastGap)}) بمناقلة من بنود الوفر أو بترشيد`] : []),
      ...(revPct !== null && revPct < 90 ? [`متابعة خطة تحصيل الإيرادات؛ المحصل ${pctText(revPct)} من المخطط`] : []),
      ...(ex.outside.filter((o) => o.nature === 'expenses').length ? [`ربط ${ex.outside.filter((o) => o.nature === 'expenses').length} حسابًا عليه صرف ببنود الموازنة أو إيضاح سببه`] : []),
    ];
    sections.push({ title: 'الانحرافات الجوهرية والتوصيات', lead: 'البنود التي تجاوزت حد الانحراف المعتمد وتتطلب إيضاحًا من الإدارة', blocks: [
      { t: 'table', small: true, empty: 'لا توجد انحرافات جوهرية', columns: [{ key: 'name', label: 'البند' }, { key: 'sec', label: 'القسم' }, { key: 'variance', label: 'الانحراف', type: 'money' }, { key: 'vpct', label: '%', type: 'percent' }, { key: 'forecastVar', label: 'فرق المتوقع عن الموازنة', type: 'money' }, { key: 'why', label: 'إيضاح الإدارة', width: '28%' }],
        rows: sig.map((r) => ({ name: r.name, sec: r.sectionName, variance: r.variance, vpct: r.variancePct, forecastVar: r.forecastVariance, why: '', _tone: tone(r) })) },
      { t: 'h', text: 'التوصيات المقترحة' },
      { t: 'list', numbered: true, items: recs, empty: 'لا توجد توصيات آلية؛ التنفيذ ضمن الموازنة.' },
      { t: 'lines', label: 'توصيات إضافية من الإدارة المالية', count: 3 },
    ] });

    sections.push(this.decisionSection('توجيهات المجلس والتوقيعات', 'يُعبأ في اجتماع المجلس ويُحفظ مع محضره', ['الاطلاع والإحاطة', 'اعتماد التوصيات المقترحة', 'طلب إيضاحات إضافية', 'التوجيه بتعديل الموازنة'],
      await this.signatures(org, [{ role: 'إعداد', name: actor.fullName }, { role: 'مراجعة: المسؤول المالي', name: null }]), q.meetingNo));

    return this.shell(actor, form, `${form.code}/${b.code}/${period}`, `${b.code} · ${b.title}`, `حتى نهاية ${monthName} ${b.fiscalYear} (${periodLabel(period)})`, [
      { label: 'الموازنة', value: `${b.code} ${b.title}` }, { label: 'السنة المالية', value: b.fiscalYear }, { label: 'الإصدار المعتمد', value: b.version }, { label: 'الفعلي حتى', value: monthName },
      { label: 'مصدر الفعلي', value: 'القيود المرحّلة في النظام المحاسبي بتاريخ المستند، والحجوزات المصروفة' }, { label: 'حد الانحراف', value: ex.threshold, type: 'percent' },
    ], sections);
  }
}
