import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { DataSource, In } from 'typeorm';
import { OrgUser } from '../../core/auth/decorators';
import { PlanItem, PlanRef, RefSystem } from './entities/planning.entity';
import { PlanningAnalysis } from './planning-analysis.service';
import { PlanningCore, today } from './planning-core.service';
import { PLANNING_PERMISSIONS as P } from './planning.manifest';

/**
 * الربط بالأنظمة الأخرى (المرحلة الخامسة): المخاطر وتحليلات PESTEL/SWOT والمراجعة الداخلية والأداء الوظيفي.
 * قراءة فقط: لا يكتب التخطيط في جداول تلك الأنظمة، ولا يغيّر تقييم خطر أو حالة توصية أو تقييم موظف.
 * المرجع يحفظ حالة العنصر وقت الربط، ثم تُقارن بحالته الحالية لإظهار التنبيهات.
 */

const safe = <T>(p: Promise<T[]>) => p.catch(() => [] as T[]);

export interface RefOption { id: string; code: string; label: string; group: string | null; version: string | null; meta: Record<string, unknown>; url: string | null }
export interface RefLive { found: boolean; statusName: string | null; color: string | null; progress: number | null; dueDate: string | null; alert: string | null; level: 'danger' | 'warning' | 'info' | null; detail: string | null; url: string | null }

interface RegisterRisk { id: string; code: string; title: string; category: string; unitName: string | null; score: number; level: string; levelLabel: string; status: string }
interface RiskLookup { listRisks(orgId: string): Promise<RegisterRisk[]> }

const LEVEL_COLOR: Record<string, string> = { low: '#10b981', medium: '#f59e0b', high: '#f97316', critical: '#ef4444' };
const RISK_STATE: Record<string, string> = { open: 'مفتوح', treating: 'قيد المعالجة', monitoring: 'تحت المراقبة', closed: 'مغلق' };
const ACTION_STATUS: Record<string, string> = { open: 'لم يبدأ', in_progress: 'قيد التنفيذ', submitted: 'بانتظار تحقق المراجعة', closed: 'مغلق بعد التحقق', cancelled: 'ملغى' };
const PRIORITY: Record<string, string> = { low: 'منخفضة', medium: 'متوسطة', high: 'مرتفعة', critical: 'حرجة' };
const CARD_STATUS: Record<string, string> = { draft: 'مسودة', agreed: 'متفق عليها', evaluated: 'مقيّمة', approved: 'معتمدة' };
export const FACTOR_NAME: Record<string, string> = {
  political: 'سياسي', economic: 'اقتصادي', social: 'اجتماعي', technological: 'تقني', environmental: 'بيئي', legal: 'قانوني وتنظيمي',
  strength: 'قوة', weakness: 'ضعف', opportunity: 'فرصة', threat: 'تهديد',
};
export const SYSTEM_NAME: Record<RefSystem, string> = {
  projects: 'المشاريع', capital_budget: 'الموازنة الرأسمالية', risk: 'سجل المخاطر', risk_analysis: 'تحليلات PESTEL وSWOT', audit: 'توصيات المراجعة الداخلية', hr_performance: 'الأداء الوظيفي',
};
const MATERIAL = new Set(['high', 'critical']);

@Injectable()
export class PlanningLinks {
  constructor(
    private readonly db: DataSource, private readonly moduleRef: ModuleRef,
    private readonly core: PlanningCore, private readonly analysis: PlanningAnalysis,
  ) {}

  canHr(actor: OrgUser) {
    return actor.isSuperadmin || actor.permissions.includes(P.budgetsHr) || actor.permissions.includes('hr.performance.manage');
  }

  private riskLookup(): RiskLookup | null {
    try {
      return this.moduleRef.get<RiskLookup>('RISK_REGISTER_LOOKUP', { strict: false });
    } catch {
      return null;
    }
  }

  /** عناصر النظام المرتبط القابلة للربط، بحالتها الحالية */
  async options(actor: OrgUser, system: RefSystem): Promise<RefOption[]> {
    const org = actor.organizationId;
    if (system === 'projects') {
      return (await safe(this.core.projectOptions(org))).map((p) => ({ id: p.id, code: p.code, label: p.name, group: p.managerName, version: null, meta: { budget: p.budget }, url: `/projects/${p.id}` }));
    }
    if (system === 'capital_budget') {
      return (await safe(this.core.capitalOptions(org))).map((c) => ({ id: c.id, code: c.code, label: c.name, group: String(c.year), version: null, meta: { amount: c.amount }, url: '/accounting/assets/budget' }));
    }
    if (system === 'risk') {
      const bridge = this.riskLookup();
      const risks = bridge ? await bridge.listRisks(org).catch(() => [] as RegisterRisk[]) : [];
      const rows: { id: string; treatment: string; actions: { title: string; status: string; dueDate: string | null; ownerName: string | null }[]; owner_name: string | null }[] =
        await safe(this.db.query('SELECT id, treatment, actions, owner_name FROM risk_register WHERE organization_id = $1', [org]));
      const ex = new Map(rows.map((r) => [r.id, r]));
      return risks.map((r) => {
        const acts = ex.get(r.id)?.actions ?? [];
        return {
          id: r.id, code: r.code, label: r.title, group: r.levelLabel, version: null, url: `/risk/register/${r.id}`,
          meta: {
            score: r.score, level: r.level, levelName: r.levelLabel, state: r.status, category: r.category, unitName: r.unitName, ownerName: ex.get(r.id)?.owner_name ?? null,
            treatment: ex.get(r.id)?.treatment ?? null, actions: acts.length, actionsDone: acts.filter((a) => a.status === 'done').length,
            actionsLate: acts.filter((a) => a.status !== 'done' && a.dueDate && a.dueDate < today()).length,
          },
        };
      });
    }
    if (system === 'risk_analysis') {
      const rows: { id: string; code: string; kind: string; title: string; revision: number; approved_at: Date | null; items: { id: string; factor: string; text: string; impact: number; likelihood: number; trend: string | null }[] }[] =
        await safe(this.db.query(`SELECT id, code, kind, title, revision, approved_at, items FROM risk_analyses WHERE organization_id = $1 AND status = 'approved' ORDER BY analysis_date DESC, code`, [org]));
      return rows.flatMap((a) => (a.items ?? []).map((it) => ({
        id: `${a.id}:${it.id}`, code: a.code, label: `${FACTOR_NAME[it.factor] ?? it.factor}: ${it.text}`, group: `${a.code} ${a.title}`, version: `Rev.${a.revision}`,
        url: `/risk/analysis/${a.id}`,
        meta: { kind: a.kind, factor: it.factor, factorName: FACTOR_NAME[it.factor] ?? it.factor, impact: it.impact, likelihood: it.likelihood, trend: it.trend, analysisId: a.id, analysisTitle: a.title, text: it.text },
      })));
    }
    if (system === 'audit') {
      // مهام المتابعة لا تُنشأ إلا من تقرير معتمد صادر، فهي التوصيات المصرح بمشاركتها مع الإدارات
      const rows: { id: string; code: string; title: string; priority: string; due_date: string; original_due_date: string; status: string; progress: number; assignee_name: string | null; unit_name: string | null; recommendation: string | null; eng_code: string | null }[] =
        await safe(this.db.query(
          `SELECT a.id, a.code, a.title, a.priority, a.due_date::text AS due_date, a.original_due_date::text AS original_due_date, a.status, a.progress, a.assignee_name,
                  u.name AS unit_name, f.recommendation, e.code AS eng_code
             FROM audit_actions a LEFT JOIN audit_findings f ON f.id = a.finding_id LEFT JOIN audit_engagements e ON e.id = a.engagement_id
             LEFT JOIN hr_units u ON u.id = a.responsible_unit_id
            WHERE a.organization_id = $1 AND a.status <> 'cancelled' ORDER BY a.due_date, a.code`, [org]));
      return rows.map((a) => ({
        id: a.id, code: a.code, label: a.title, group: a.eng_code, version: null, url: `/audit/actions/${a.id}`,
        meta: {
          priority: a.priority, priorityName: PRIORITY[a.priority] ?? a.priority, dueDate: a.due_date, originalDueDate: a.original_due_date, status: a.status,
          progress: a.progress, assigneeName: a.assignee_name, unitName: a.unit_name, recommendation: a.recommendation,
        },
      }));
    }
    // أهداف بطاقات الأداء: لمن يملك صلاحية الأداء الوظيفي أو بيانات الرواتب في الموازنات
    if (!this.canHr(actor)) return [];
    const cards: { id: string; year: number; status: string; rating: string | null; objectives: { title: string; weight: number; target: string; achievement: number | null }[]; full_name: string; job_title: string | null }[] =
      await safe(this.db.query(
        `SELECT c.id, c.year, c.status, c.rating, c.objectives, e.full_name, j.title AS job_title
           FROM hr_performance_cards c JOIN hr_employees e ON e.id = c.employee_id LEFT JOIN hr_jobs j ON j.id = e.job_id
          WHERE c.organization_id = $1 AND c.status <> 'draft' ORDER BY c.year DESC, e.full_name`, [org]));
    return cards.flatMap((c) => (c.objectives ?? []).map((o, i) => ({
      id: `${c.id}:${i}`, code: String(c.year), label: `${c.full_name}: ${o.title}`, group: `${c.full_name}${c.job_title ? ` · ${c.job_title}` : ''}`, version: null,
      url: `/hr/performance/${c.id}`,
      meta: { employeeName: c.full_name, objective: o.title, weight: o.weight, target: o.target, achievement: o.achievement, cardStatus: c.status, rating: c.rating, year: c.year },
    })));
  }

  async resolve(actor: OrgUser, system: RefSystem, refId: string) {
    if (system === 'hr_performance' && !this.canHr(actor)) throw new BadRequestException('الربط بأهداف الموظفين لمن يملك صلاحية الأداء الوظيفي');
    const o = (await this.options(actor, system)).find((x) => x.id === refId);
    if (!o) throw new BadRequestException('العنصر غير موجود في النظام المرتبط');
    return o;
  }

  /** الحالة الحالية لكل مرجع مقارنة بحالته وقت الربط */
  async live(actor: OrgUser, refs: PlanRef[]): Promise<Map<string, RefLive>> {
    const out = new Map<string, RefLive>();
    const systems = [...new Set(refs.map((r) => r.system))];
    const opts = new Map<RefSystem, Map<string, RefOption>>();
    await Promise.all(systems.map(async (s) => opts.set(s, new Map((await this.options(actor, s)).map((o) => [o.id, o])))));
    const now = today();
    for (const r of refs) {
      const o = opts.get(r.system)?.get(r.refId);
      const m = r.refMeta ?? {};
      const blank: RefLive = { found: !!o, statusName: null, color: null, progress: null, dueDate: null, alert: null, level: null, detail: null, url: o?.url ?? null };
      if (!o) {
        // أهداف الموظفين لا تُعرض لمن لا يملك الصلاحية، فلا يُعدّ غيابها حذفًا
        if (r.system === 'hr_performance' && !this.canHr(actor)) out.set(r.id, { ...blank, found: true, detail: 'تفاصيل الهدف لمن يملك صلاحية الأداء الوظيفي' });
        else out.set(r.id, { ...blank, alert: 'لم يعد العنصر موجودًا أو متاحًا في النظام المصدر', level: 'warning' });
        continue;
      }
      const x = o.meta;
      if (r.system === 'risk') {
        const score = Number(x.score), before = m.score === undefined ? null : Number(m.score);
        const live: RefLive = {
          ...blank, statusName: `${x.levelName} (${score}) · ${RISK_STATE[String(x.state)] ?? x.state}`, color: LEVEL_COLOR[String(x.level)] ?? '#64748b',
          progress: Number(x.actions) ? Math.round((Number(x.actionsDone) / Number(x.actions)) * 100) : null,
          detail: Number(x.actions) ? `إجراءات المعالجة: ${x.actionsDone} من ${x.actions} منفذة` : 'لا توجد إجراءات معالجة مسجلة',
        };
        if (before !== null && score > before) Object.assign(live, { alert: `ارتفعت درجة الخطر من ${before} (${m.levelName}) إلى ${score} (${x.levelName}) منذ الربط`, level: 'danger' });
        else if (Number(x.actionsLate)) Object.assign(live, { alert: `${x.actionsLate} من إجراءات المعالجة متأخرة في سجل المخاطر`, level: 'warning' });
        else if (before !== null && score < before) Object.assign(live, { alert: `انخفضت درجة الخطر من ${before} إلى ${score}`, level: 'info' });
        out.set(r.id, live);
      } else if (r.system === 'risk_analysis') {
        const live: RefLive = { ...blank, statusName: `${x.factorName} · الأثر ${x.impact} · الاحتمال ${x.likelihood}`, color: ['strength', 'opportunity'].includes(String(x.factor)) ? '#10b981' : '#f97316' };
        if (r.refVersion && o.version && r.refVersion !== o.version) Object.assign(live, { alert: `حُدّث التحليل من ${r.refVersion} إلى ${o.version}. راجع أثر التغيير على الخطة`, level: 'warning' });
        else if (m.impact !== undefined && (Number(m.impact) !== Number(x.impact) || Number(m.likelihood) !== Number(x.likelihood))) Object.assign(live, { alert: 'تغير تقدير هذا العامل في التحليل', level: 'warning' });
        out.set(r.id, live);
      } else if (r.system === 'audit') {
        const st = String(x.status), due = String(x.dueDate), open = !['closed', 'cancelled'].includes(st);
        const live: RefLive = {
          ...blank, statusName: ACTION_STATUS[st] ?? st, color: st === 'closed' ? '#10b981' : open && due < now ? '#ef4444' : '#0ea5e9',
          progress: Number(x.progress), dueDate: due, detail: x.recommendation ? `التوصية: ${x.recommendation}` : null,
        };
        if (open && due < now) Object.assign(live, { alert: `الإجراء التصحيحي متأخر عن موعده ${due}`, level: 'danger' });
        else if (x.originalDueDate && due > String(x.originalDueDate)) Object.assign(live, { alert: `مُدد موعد الإجراء من ${x.originalDueDate} إلى ${due}`, level: 'warning' });
        else if (open && m.dueDate && due !== m.dueDate) Object.assign(live, { alert: `تغير موعد الإجراء إلى ${due}`, level: 'info' });
        out.set(r.id, live);
      } else if (r.system === 'hr_performance') {
        out.set(r.id, {
          ...blank, statusName: `البطاقة ${CARD_STATUS[String(x.cardStatus)] ?? x.cardStatus}${x.rating ? ` · التقدير ${x.rating}` : ''}`,
          color: '#a78bfa', progress: x.achievement === null || x.achievement === undefined ? null : Number(x.achievement), detail: `المستهدف: ${x.target} · الوزن ${x.weight}%`,
        });
      } else {
        out.set(r.id, blank);
      }
    }
    return out;
  }

  /** لوحة الربط لخطة: المراجع وحالتها والتنبيهات، وتغطية المخاطر الجوهرية والتوصيات وعناصر التحليل، والعناصر بلا مسؤول */
  async overview(actor: OrgUser, planId: string) {
    const org = actor.organizationId;
    const a = await this.analysis.analyze(org);
    const p = a.plans.get(planId);
    if (!p) throw new NotFoundException('الخطة غير موجودة');
    const items = a.items.filter((i) => i.planId === planId);
    const ids = items.map((i) => i.id);
    const refs = ids.length ? await this.db.getRepository(PlanRef).find({ where: { organizationId: org, itemId: In(ids) }, order: { createdAt: 'ASC' } }) : [];
    const live = await this.live(actor, refs);
    const it = (id: string) => { const i = a.itemById.get(id)!; return { id: i.id, code: i.code, title: i.title, level: i.level, levelName: p.levels[i.level]?.name ?? '', progress: a.rolled.get(i.id)?.progress ?? 0, cost: a.rolled.get(i.id)?.cost ?? 0, ownerName: i.ownerName, unitName: i.unitName }; };
    const rows = refs.map((r) => ({
      id: r.id, system: r.system, systemName: SYSTEM_NAME[r.system], refId: r.refId, refCode: r.refCode, refLabel: r.refLabel, refVersion: r.refVersion, refMeta: r.refMeta,
      contribution: r.contribution, note: r.note, createdByName: r.createdByName, createdAt: r.createdAt, item: it(r.itemId), live: live.get(r.id)!,
    }));
    const alerts = rows.filter((r) => r.live.alert).map((r) => ({ level: r.live.level, system: r.systemName, ref: `${r.refCode ?? ''} ${r.refLabel}`.trim(), item: r.item, message: r.live.alert, url: r.live.url }));
    const linked = (s: RefSystem) => { const m = new Map<string, typeof rows>(); for (const r of rows.filter((x) => x.system === s)) m.set(r.refId, [...(m.get(r.refId) ?? []), r]); return m; };

    // تغطية المخاطر الجوهرية: هل لكل خطر مرتفع أو حرج عنصر في الخطة يعالجه، وبأي تكلفة
    const riskLinks = linked('risk');
    const risks = (await this.options(actor, 'risk')).filter((r) => r.meta.state !== 'closed');
    const material = risks.filter((r) => MATERIAL.has(String(r.meta.level)) || riskLinks.has(r.id)).map((r) => {
      const ls = riskLinks.get(r.id) ?? [];
      return {
        id: r.id, code: r.code, title: r.label, score: r.meta.score, level: r.meta.level, levelName: r.meta.levelName, color: LEVEL_COLOR[String(r.meta.level)] ?? '#64748b',
        material: MATERIAL.has(String(r.meta.level)), ownerName: r.meta.ownerName, url: r.url,
        items: ls.map((l) => l.item), cost: ls.reduce((s, l) => s + l.item.cost, 0), progress: ls.length ? Math.round(ls.reduce((s, l) => s + l.item.progress, 0) / ls.length) : null,
      };
    }).sort((x, y) => Number(y.score) - Number(x.score));

    const auditLinks = linked('audit');
    const actions = (await this.options(actor, 'audit')).filter((x) => x.meta.status !== 'closed' || auditLinks.has(x.id)).map((x) => {
      const ls = auditLinks.get(x.id) ?? [];
      return {
        id: x.id, code: x.code, title: x.label, engagement: x.group, priorityName: x.meta.priorityName, dueDate: x.meta.dueDate, status: x.meta.status, statusName: ACTION_STATUS[String(x.meta.status)],
        progress: x.meta.progress, overdue: x.meta.status !== 'closed' && String(x.meta.dueDate) < today(), unitName: x.meta.unitName, url: x.url,
        items: ls.map((l) => l.item), cost: ls.reduce((s, l) => s + l.item.cost, 0),
      };
    });

    // استجابة الخطة لعناصر التحليل المعتمدة: لكل عامل عدد العناصر المربوطة بالخطة
    const anLinks = linked('risk_analysis');
    const factors = (await this.options(actor, 'risk_analysis')).map((x) => ({ id: x.id, group: x.group, version: x.version, factor: String(x.meta.factor), factorName: String(x.meta.factorName), kind: x.meta.kind, text: x.meta.text, impact: x.meta.impact, likelihood: x.meta.likelihood, url: x.url, items: (anLinks.get(x.id) ?? []).map((l) => l.item) }));
    const byFactor = Object.entries(FACTOR_NAME).map(([k, name]) => ({ factor: k, name, total: factors.filter((f) => f.factor === k).length, linked: factors.filter((f) => f.factor === k && f.items.length).length })).filter((f) => f.total);

    // العناصر التنفيذية (بلا فروع) بلا مسؤول محدد
    const parents = new Set(items.map((i) => i.parentId).filter(Boolean));
    const unowned = items.filter((i) => !parents.has(i.id) && !i.ownerUserId && !i.ownerName?.trim()).map((i) => it(i.id));
    const hr = rows.filter((r) => r.system === 'hr_performance');

    return {
      plan: { id: p.id, code: p.code, title: p.title, kind: p.kind, status: p.status, levels: p.levels },
      canHr: this.canHr(actor),
      counts: Object.fromEntries((Object.keys(SYSTEM_NAME) as RefSystem[]).map((s) => [s, rows.filter((r) => r.system === s).length])),
      refs: rows, alerts,
      coverage: {
        risks: material, materialTotal: material.filter((r) => r.material).length, materialCovered: material.filter((r) => r.material && r.items.length).length,
        treatmentCost: material.reduce((s, r) => s + r.cost, 0),
        actions, actionsOpen: actions.filter((x) => x.status !== 'closed').length, actionsCovered: actions.filter((x) => x.status !== 'closed' && x.items.length).length,
        actionsCost: actions.reduce((s, x) => s + x.cost, 0),
        factors, byFactor,
      },
      unowned,
      hr: { linked: hr.length, employees: new Set(hr.map((r) => String(r.refMeta?.employeeName ?? r.refLabel.split(':')[0]))).size },
    };
  }

  /** للتقارير: كل المراجع في خطط الشركة مع حالتها الحالية */
  async allRefs(actor: OrgUser, system?: RefSystem) {
    const org = actor.organizationId;
    const refs = await this.db.getRepository(PlanRef).find({ where: { organizationId: org, ...(system ? { system } : {}) }, order: { createdAt: 'ASC' } });
    const live = await this.live(actor, refs);
    const items = refs.length ? await this.db.getRepository(PlanItem).find({ where: { id: In([...new Set(refs.map((r) => r.itemId))]) } }) : [];
    return { refs, live, items: new Map(items.map((i) => [i.id, i])) };
  }
}
