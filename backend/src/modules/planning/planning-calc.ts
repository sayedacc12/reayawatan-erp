import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import type { ItemState, Periodicity, PlanSnapshot, WfLog, WfStage, WfStatus } from './entities/planning.entity';
import type { PlanningConfig, WorkflowRoute } from './planning-defaults';

/** دوال خالصة للحساب والاعتماد والمقارنة، حتى تُختبر وحدها */

export const r2 = (v: number) => Math.round(v * 100) / 100;
export const r1 = (v: number) => Math.round(v * 10) / 10;

// ---------------------------------------------------------------- الفترات

/** فترات السنة حسب الدورية: 2026 | 2026-H1 | 2026-Q1 | 2026-01 */
export function periodsOf(year: number, p: Periodicity): string[] {
  if (p === 'annual') return [String(year)];
  if (p === 'semiannual') return [`${year}-H1`, `${year}-H2`];
  if (p === 'quarterly') return [1, 2, 3, 4].map((q) => `${year}-Q${q}`);
  return Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, '0')}`);
}

export const isPeriod = (s: string) => /^\d{4}(-(H[12]|Q[1-4]|0[1-9]|1[0-2]))?$/.test(s);
export const periodYear = (s: string) => Number(s.slice(0, 4));

/** آخر يوم في الفترة */
export function periodEnd(s: string): string {
  const y = periodYear(s);
  const m = s.length === 4 ? 12 : s[5] === 'H' ? Number(s[6]) * 6 : s[5] === 'Q' ? Number(s[6]) * 3 : Number(s.slice(5));
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
}

export const PERIOD_LABEL = (s: string) => {
  if (s.length === 4) return s;
  const y = s.slice(0, 4);
  if (s[5] === 'H') return `${s[6] === '1' ? 'النصف الأول' : 'النصف الثاني'} ${y}`;
  if (s[5] === 'Q') return `الربع ${['', 'الأول', 'الثاني', 'الثالث', 'الرابع'][Number(s[6])]} ${y}`;
  return `${s.slice(5)}/${y}`;
};

// ---------------------------------------------------------------- المؤشرات

export interface KpiLike { direction: 'up' | 'down'; aggregation: 'last' | 'sum' | 'avg'; targets: Record<string, number> }

function aggregate(values: number[], how: KpiLike['aggregation']): number | null {
  if (!values.length) return null;
  if (how === 'sum') return values.reduce((a, b) => a + b, 0);
  if (how === 'avg') return values.reduce((a, b) => a + b, 0) / values.length;
  return values[values.length - 1];
}

/** القيمة الفعلية للسنة من قراءات فتراتها (مرتبة زمنيًا) */
export function yearActual(kpi: KpiLike, readings: { period: string; value: number }[], year: number) {
  const rs = readings.filter((r) => periodYear(r.period) === year).sort((a, b) => a.period.localeCompare(b.period));
  return aggregate(rs.map((r) => r.value), kpi.aggregation);
}

/** مستهدف السنة: المسجل للسنة نفسها، أو تجميع مستهدفات فتراتها */
export function yearTarget(kpi: KpiLike, year: number): number | null {
  if (kpi.targets[String(year)] !== undefined) return kpi.targets[String(year)];
  const parts = Object.entries(kpi.targets).filter(([p]) => p.length > 4 && periodYear(p) === year).sort(([a], [b]) => a.localeCompare(b)).map(([, v]) => v);
  return aggregate(parts, kpi.aggregation);
}

/** نسبة التحقق: الفعلي إلى المستهدف (أو العكس للمؤشرات التي الأقل فيها أفضل) */
export function achievement(direction: 'up' | 'down', actual: number | null, target: number | null): number | null {
  if (actual === null || target === null) return null;
  if (direction === 'up') return target === 0 ? 100 : r1(Math.max(0, (actual / target) * 100));
  if (actual <= 0) return 100;
  return r1(Math.max(0, (target / actual) * 100));
}

export type Band = 'green' | 'amber' | 'red';
export function band(cfg: Pick<PlanningConfig, 'thresholds'>, ach: number | null): Band | null {
  if (ach === null) return null;
  return ach >= cfg.thresholds.green ? 'green' : ach >= cfg.thresholds.amber ? 'amber' : 'red';
}

/** توزيع مستهدفات السنوات خطيًا من خط الأساس إلى المستهدف النهائي */
export function spreadTargets(years: number[], target: number, baseline?: number | null): Record<string, number> {
  const out: Record<string, number> = {};
  years.forEach((y, i) => {
    out[String(y)] = baseline === undefined || baseline === null ? target : r2(baseline + ((target - baseline) * (i + 1)) / years.length);
  });
  return out;
}

// ---------------------------------------------------------------- الإنجاز والتأخر

const dayMs = 86400000;
const toTime = (d: string) => new Date(`${d}T00:00:00Z`).getTime();

/** الإنجاز المخطط حتى تاريخ: خطي بين البداية والنهاية */
export function plannedProgress(start: string | null, end: string | null, asOf: string): number | null {
  if (!start || !end) return null;
  const s = toTime(start), e = toTime(end) + dayMs, t = toTime(asOf) + dayMs;
  if (t <= s) return 0;
  if (t >= e) return 100;
  return r1(((t - s) / (e - s)) * 100);
}

export type ExecStatus = 'not_started' | 'on_track' | 'at_risk' | 'delayed' | 'completed' | 'cancelled' | 'carried_over' | 'no_schedule';

/** حالة التنفيذ المحسوبة: مقارنة الإنجاز الفعلي بالمخطط مع هامش التأخر المسموح */
export function execStatus(state: ItemState, progress: number, planned: number | null, end: string | null, asOf: string, tolerance: number): ExecStatus {
  if (state === 'completed' || progress >= 100) return 'completed';
  if (state === 'cancelled' || state === 'carried_over') return state;
  if (planned === null) return progress > 0 ? 'on_track' : 'no_schedule';
  if (end && end < asOf) return 'delayed';
  const gap = planned - progress;
  if (gap > tolerance) return 'delayed';
  if (gap > tolerance / 2) return 'at_risk';
  if (planned === 0 && progress === 0) return 'not_started';
  return 'on_track';
}

export interface RollItem {
  id: string; parentId: string | null; weight: number; progress: number; state: ItemState; startDate: string | null; endDate: string | null;
  plannedCost: number; costByYear: Record<string, number>;
}
export interface RollLink { fromItemId: string; toItemId: string; contribution: number | null }
export interface Rolled { progress: number; planned: number | null; cost: number; costByYear: Record<string, number>; status: ExecStatus; source: 'own' | 'children' | 'links' }

/**
 * تجميع الإنجاز والتكلفة على الهيكل:
 * - العنصر بفروع: متوسط إنجاز فروعه الموزون (الملغاة لا تُحتسب)، وتكلفته = تكلفته + تكاليف فروعه.
 * - العنصر بلا فروع وتسهم فيه عناصر أخرى (مثل مبادرة تنفذها أنشطة تشغيلية): متوسط إنجازها موزونًا بنسب المساهمة.
 * - غير ذلك: الإنجاز المدخل.
 * العلاقات الدائرية تُكسر بالرجوع للإنجاز المدخل.
 */
export function rollup(items: RollItem[], links: RollLink[], asOf: string, tolerance: number): Map<string, Rolled> {
  const byId = new Map(items.map((i) => [i.id, i]));
  const children = new Map<string, RollItem[]>();
  for (const i of items) if (i.parentId && byId.has(i.parentId)) children.set(i.parentId, [...(children.get(i.parentId) ?? []), i]);
  const incoming = new Map<string, RollLink[]>();
  for (const l of links) if (byId.has(l.fromItemId) && byId.has(l.toItemId)) incoming.set(l.toItemId, [...(incoming.get(l.toItemId) ?? []), l]);
  const out = new Map<string, Rolled>();
  const visiting = new Set<string>();

  const calc = (it: RollItem): Rolled => {
    const done = out.get(it.id);
    if (done) return done;
    if (visiting.has(it.id)) {
      const p = plannedProgress(it.startDate, it.endDate, asOf);
      return { progress: it.progress, planned: p, cost: it.plannedCost, costByYear: { ...it.costByYear }, status: execStatus(it.state, it.progress, p, it.endDate, asOf, tolerance), source: 'own' };
    }
    visiting.add(it.id);
    const kids = (children.get(it.id) ?? []);
    const live = kids.filter((k) => k.state !== 'cancelled' && k.state !== 'carried_over');
    const costByYear: Record<string, number> = { ...it.costByYear };
    let cost = it.plannedCost;
    for (const k of kids) {
      const r = calc(k);
      if (k.state === 'cancelled') continue;
      cost += r.cost;
      for (const [y, v] of Object.entries(r.costByYear)) costByYear[y] = r2((costByYear[y] ?? 0) + v);
    }
    let progress = it.progress;
    let planned = plannedProgress(it.startDate, it.endDate, asOf);
    let source: Rolled['source'] = 'own';
    if (live.length) {
      const w = live.map((k) => (k.weight > 0 ? k.weight : 0));
      const total = w.reduce((a, b) => a + b, 0) || live.length;
      const wt = (i: number) => (w.reduce((a, b) => a + b, 0) ? w[i] : 1);
      progress = r1(live.reduce((s, k, i) => s + calc(k).progress * wt(i), 0) / total);
      const plans = live.map((k, i) => ({ p: calc(k).planned, w: wt(i) })).filter((x) => x.p !== null);
      if (plans.length) planned = r1(plans.reduce((s, x) => s + (x.p as number) * x.w, 0) / plans.reduce((s, x) => s + x.w, 0));
      source = 'children';
    } else if (incoming.get(it.id)?.length) {
      const ls = incoming.get(it.id)!.filter((l) => {
        const f = byId.get(l.fromItemId)!;
        return f.state !== 'cancelled' && f.state !== 'carried_over';
      });
      if (ls.length) {
        const w = ls.map((l) => (l.contribution ?? 100));
        const total = w.reduce((a, b) => a + b, 0) || 1;
        progress = r1(ls.reduce((s, l, i) => s + calc(byId.get(l.fromItemId)!).progress * w[i], 0) / total);
        const plans = ls.map((l, i) => ({ p: calc(byId.get(l.fromItemId)!).planned, w: w[i] })).filter((x) => x.p !== null);
        if (plans.length && planned === null) planned = r1(plans.reduce((s, x) => s + (x.p as number) * x.w, 0) / (plans.reduce((s, x) => s + x.w, 0) || 1));
        source = 'links';
      }
    }
    const state: ItemState = source === 'own' ? it.state : progress >= 100 ? 'completed' : it.state === 'cancelled' ? 'cancelled' : progress > 0 ? 'in_progress' : 'not_started';
    const r: Rolled = { progress, planned, cost: r2(cost), costByYear, status: execStatus(state, progress, planned, source === 'own' ? it.endDate : null, asOf, tolerance), source };
    visiting.delete(it.id);
    out.set(it.id, r);
    return r;
  };
  for (const i of items) calc(i);
  return out;
}

/** تحقق المؤشرات على الهيكل: العنصر بمؤشرات = متوسطها الموزون، وإلا متوسط فروعه الموزون */
export function performance(items: { id: string; parentId: string | null; weight: number; state: ItemState }[], kpiScores: Map<string, { weight: number; ach: number | null }[]>) {
  const children = new Map<string, typeof items>();
  for (const i of items) if (i.parentId) children.set(i.parentId, [...(children.get(i.parentId) ?? []), i]);
  const out = new Map<string, number | null>();
  const calc = (id: string, depth = 0): number | null => {
    if (out.has(id)) return out.get(id)!;
    if (depth > 20) return null;
    const own = (kpiScores.get(id) ?? []).filter((k) => k.ach !== null);
    let v: number | null = null;
    if (own.length) {
      const tw = own.reduce((s, k) => s + (k.weight > 0 ? k.weight : 0), 0);
      v = r1(own.reduce((s, k) => s + Math.min(100, k.ach as number) * (tw ? Math.max(0, k.weight) : 1), 0) / (tw || own.length));
    } else {
      const ks = (children.get(id) ?? []).filter((c) => c.state !== 'cancelled').map((c) => ({ w: c.weight > 0 ? c.weight : 0, v: calc(c.id, depth + 1) })).filter((x) => x.v !== null);
      if (ks.length) {
        const tw = ks.reduce((s, x) => s + x.w, 0);
        v = r1(ks.reduce((s, x) => s + (x.v as number) * (tw ? x.w : 1), 0) / (tw || ks.length));
      }
    }
    out.set(id, v);
    return v;
  };
  for (const i of items) calc(i.id);
  return out;
}

// ---------------------------------------------------------------- الترقيم

/** رمز العنصر: بادئة المستوى + الترقيم الهرمي (P1، G1.2، I1.2.3) */
export function itemCode(prefix: string, parentCode: string | null, siblingCodes: string[]): string {
  const base = parentCode ? parentCode.replace(/^[^\d]*/, '') : '';
  const nums = siblingCodes.map((c) => Number(c.replace(/^[^\d]*/, '').split('.').pop())).filter((n) => Number.isFinite(n));
  const n = (nums.length ? Math.max(...nums) : 0) + 1;
  return `${prefix}${base ? `${base}.` : ''}${n}`;
}

// ---------------------------------------------------------------- مسارات الاعتماد

/** المسار الأكثر تحديدًا الذي ينطبق على الخطة (الإدارة ثم أعلى حد تكلفة) */
export function pickRoute(routes: WorkflowRoute[], kind: 'strategic' | 'operational', unitId: string | null, totalCost: number): WorkflowRoute | null {
  const ok = routes.filter((r) => (r.planKind === 'any' || r.planKind === kind) && (!r.unitId || r.unitId === unitId) && (r.minCost === null || totalCost >= r.minCost));
  ok.sort((a, b) => (b.unitId ? 2 : 0) - (a.unitId ? 2 : 0) || (b.minCost ?? -1) - (a.minCost ?? -1) || (b.planKind === kind ? 1 : 0) - (a.planKind === kind ? 1 : 0));
  return ok[0] ?? null;
}

export function validateConfig(cfg: PlanningConfig) {
  for (const [name, levels] of [['الاستراتيجية', cfg.strategicLevels], ['التشغيلية', cfg.operationalLevels]] as const) validateLevels(levels, name);
  if (!cfg.relationTypes.length) throw new BadRequestException('أضف نوعًا واحدًا على الأقل للعلاقات بين العناصر');
  const rc = cfg.relationTypes.map((r) => r.code);
  if (new Set(rc).size !== rc.length || cfg.relationTypes.some((r) => !r.name?.trim() || !/^[a-z][a-z0-9_]{0,29}$/.test(r.code))) throw new BadRequestException('أكمل أسماء أنواع العلاقات برموز إنجليزية غير مكررة');
  if (!cfg.kpiUnits.length || cfg.kpiUnits.some((u) => !u?.trim() || u.length > 30)) throw new BadRequestException('أكمل وحدات قياس المؤشرات');
  const { green, amber } = cfg.thresholds;
  if (!(amber > 0 && green > amber && green <= 150)) throw new BadRequestException('حد اللون الأخضر يجب أن يكون أعلى من حد الأصفر، وكلاهما بين 1 و150');
  if (!(cfg.delayTolerance >= 0 && cfg.delayTolerance <= 50)) throw new BadRequestException('هامش التأخر المسموح بين 0 و50 نقطة مئوية');
  const fk = cfg.customFields.map((f) => f.key);
  if (new Set(fk).size !== fk.length) throw new BadRequestException('رموز الحقول الإضافية مكررة');
  for (const f of cfg.customFields) {
    if (!f.label?.trim() || !/^[a-z][a-z0-9_]{0,29}$/.test(f.key)) throw new BadRequestException('أكمل اسم كل حقل إضافي ورمزه بالإنجليزية');
    if (!['text', 'number', 'date', 'select'].includes(f.type)) throw new BadRequestException('نوع الحقل الإضافي غير صحيح');
    if (f.type === 'select' && !f.options?.filter((o) => o.trim()).length) throw new BadRequestException(`أضف خيارات القائمة للحقل «${f.label}»`);
  }
  if (!cfg.routes.length) throw new BadRequestException('أضف مسار اعتماد واحدًا على الأقل');
  for (const r of cfg.routes) {
    if (!r.name?.trim()) throw new BadRequestException('اكتب اسم كل مسار اعتماد');
    if (!['strategic', 'operational', 'any'].includes(r.planKind)) throw new BadRequestException('نوع الخطة في مسار الاعتماد غير صحيح');
    if (r.minCost !== null && !(r.minCost >= 0)) throw new BadRequestException('حد التكلفة في مسار الاعتماد غير صحيح');
    if (r.stages.length > 8) throw new BadRequestException('الحد الأعلى 8 مراحل لكل مسار اعتماد');
    if (r.stages.some((s) => !s.name?.trim())) throw new BadRequestException(`اكتب اسم كل مرحلة في مسار «${r.name}»`);
  }
}

export function validateLevels(levels: { key: string; name: string; prefix: string }[], name = '') {
  if (!levels.length || levels.length > 6) throw new BadRequestException(`مستويات الخطة ${name} من مستوى إلى 6 مستويات`);
  if (levels.some((l) => !l.name?.trim() || !/^[A-Z]{1,3}$/.test(l.prefix) || !/^[a-z][a-z0-9_]{0,29}$/.test(l.key))) {
    throw new BadRequestException(`أكمل اسم كل مستوى ${name} ورمزه (حروف إنجليزية كبيرة من 1 إلى 3)`);
  }
  if (new Set(levels.map((l) => l.prefix)).size !== levels.length || new Set(levels.map((l) => l.key)).size !== levels.length) {
    throw new BadRequestException(`رموز مستويات الخطة ${name} مكررة`);
  }
}

// ---------------------------------------------------------------- محرك الاعتماد

export interface WfRecord { status: WfStatus; stageIndex: number | null; wfStages: WfStage[]; approvals: WfLog[]; approvedAt: Date | null }
export interface Decider { name: string; isSuperadmin: boolean; hasPermission: boolean; roleIds: Set<string> }

const log = (action: WfLog['action'], stage: string | null, byName: string, note: string | null = null): WfLog =>
  ({ action, stage, byName, at: new Date().toISOString(), note });

/** الخطة قيد الاعتماد أو مرفوضة لا تُعدّل؛ والمعتمدة تتحول إلى «مسودة تعديل» مع بقاء إصدارها المعتمد كما هو */
export function assertEditable(r: WfRecord) {
  if (r.status === 'in_review') throw new ConflictException('الخطة قيد الاعتماد، ولا تُعدّل حتى تُعاد أو تُعتمد');
  if (r.status === 'rejected') throw new ConflictException('الخطة مرفوضة ولا تُعدّل. يمكنك استعادة آخر إصدار معتمد إن وُجد');
}

export function markEdited(r: WfRecord, byName: string) {
  if (r.status === 'approved') {
    r.status = 'draft';
    r.approvals = [...r.approvals, log('reopen', null, byName, 'بدء تعديل على الخطة المعتمدة')];
  }
}

/** الرفع للاعتماد: تُجمّد مراحل المسار المطابق على الخطة حتى نهاية الدورة */
export function wfSubmit(r: WfRecord, stages: WfStage[], byName: string, note: string | null) {
  if (!['draft', 'returned'].includes(r.status)) throw new ConflictException('تُرفع للاعتماد الخطة المسودة أو المُرجعة فقط');
  r.wfStages = stages.map((s) => ({ ...s }));
  r.approvals = [...r.approvals, log('submit', stages[0]?.name ?? null, byName, note)];
  if (!stages.length) return wfApprove(r);
  r.status = 'in_review';
  r.stageIndex = 0;
}

function wfApprove(r: WfRecord) {
  r.status = 'approved';
  r.stageIndex = null;
  r.approvedAt = new Date();
}

export function canDecide(r: WfRecord, d: Decider) {
  if (r.status !== 'in_review' || r.stageIndex === null) return false;
  if (!d.hasPermission && !d.isSuperadmin) return false;
  const stage = r.wfStages[r.stageIndex];
  return !stage?.roleId || d.isSuperadmin || d.roleIds.has(stage.roleId);
}

export function wfDecide(r: WfRecord, d: Decider, decision: 'approve' | 'return' | 'reject', note: string | null) {
  if (r.status !== 'in_review' || r.stageIndex === null) throw new ConflictException('الخطة ليست قيد الاعتماد');
  if (!canDecide(r, d)) throw new ForbiddenException('القرار في هذه المرحلة ليس من صلاحيتك');
  if (decision !== 'approve' && !note?.trim()) throw new BadRequestException('اكتب سبب الإرجاع أو الرفض');
  const stage = r.wfStages[r.stageIndex]?.name ?? null;
  r.approvals = [...r.approvals, log(decision, stage, d.name, note?.trim() || null)];
  if (decision === 'return') { r.status = 'returned'; r.stageIndex = null; return; }
  if (decision === 'reject') { r.status = 'rejected'; r.stageIndex = null; return; }
  if (r.stageIndex + 1 < r.wfStages.length) { r.stageIndex += 1; return; }
  wfApprove(r);
}

// ---------------------------------------------------------------- مقارنة الإصدارات

export interface FieldChange { field: string; label: string; before: unknown; after: unknown }
export interface DiffRow { kind: 'item' | 'kpi' | 'link' | 'plan'; change: 'added' | 'removed' | 'modified'; code: string; title: string; changes: FieldChange[] }

const ITEM_FIELDS: [keyof PlanSnapshot['items'][number], string][] = [
  ['title', 'العنوان'], ['parentId', 'الموقع في الهيكل'], ['ownerName', 'المسؤول'], ['unitName', 'الجهة'], ['startDate', 'البداية'], ['endDate', 'النهاية'],
  ['weight', 'الوزن'], ['plannedCost', 'التكلفة التقديرية'], ['costByYear', 'توزيع التكلفة على السنوات'], ['targets', 'المستهدفات'], ['fundingType', 'نوع التمويل'],
  ['description', 'الوصف'], ['milestones', 'المعالم'], ['resources', 'الموارد'], ['costCenterName', 'مركز التكلفة'],
];
const KPI_FIELDS: [keyof PlanSnapshot['kpis'][number], string][] = [
  ['name', 'الاسم'], ['itemId', 'العنصر المرتبط'], ['unit', 'الوحدة'], ['direction', 'الاتجاه'], ['baseline', 'خط الأساس'], ['targets', 'المستهدفات'], ['weight', 'الوزن'],
];
const PLAN_FIELDS: [keyof PlanSnapshot, string][] = [
  ['title', 'عنوان الخطة'], ['startYear', 'سنة البداية'], ['endYear', 'سنة النهاية'], ['periodicity', 'دورية المتابعة'], ['vision', 'الرؤية'], ['mission', 'الرسالة'], ['values', 'القيم'],
  ['unitName', 'الإدارة'], ['levels', 'مستويات الهيكل'],
];

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/** الفروق بين إصدارين (أو بين إصدار والمسودة الحالية): العناصر والمؤشرات والعلاقات المضافة والمحذوفة والمعدلة */
export function diffSnapshots(a: PlanSnapshot, b: PlanSnapshot): DiffRow[] {
  const out: DiffRow[] = [];
  const pc = PLAN_FIELDS.filter(([f]) => !same(a[f], b[f])).map(([f, label]) => ({ field: f, label, before: a[f], after: b[f] }));
  if (pc.length) out.push({ kind: 'plan', change: 'modified', code: '—', title: b.title, changes: pc });
  const codeOf = new Map([...a.items, ...b.items].map((i) => [i.id, i.code]));
  const ai = new Map(a.items.map((i) => [i.id, i]));
  const bi = new Map(b.items.map((i) => [i.id, i]));
  for (const i of b.items) {
    const o = ai.get(i.id);
    if (!o) { out.push({ kind: 'item', change: 'added', code: i.code, title: i.title, changes: [] }); continue; }
    const ch = ITEM_FIELDS.filter(([f]) => !same(o[f], i[f])).map(([f, label]) => ({
      field: f, label, before: f === 'parentId' ? codeOf.get(o.parentId ?? '') ?? null : o[f], after: f === 'parentId' ? codeOf.get(i.parentId ?? '') ?? null : i[f],
    }));
    if (ch.length) out.push({ kind: 'item', change: 'modified', code: i.code, title: i.title, changes: ch });
  }
  for (const i of a.items) if (!bi.has(i.id)) out.push({ kind: 'item', change: 'removed', code: i.code, title: i.title, changes: [] });
  const ak = new Map(a.kpis.map((k) => [k.id, k]));
  const bk = new Map(b.kpis.map((k) => [k.id, k]));
  for (const k of b.kpis) {
    const o = ak.get(k.id);
    if (!o) { out.push({ kind: 'kpi', change: 'added', code: k.code, title: k.name, changes: [] }); continue; }
    const ch = KPI_FIELDS.filter(([f]) => !same(o[f], k[f])).map(([f, label]) => ({
      field: f, label, before: f === 'itemId' ? codeOf.get(o.itemId ?? '') ?? null : o[f], after: f === 'itemId' ? codeOf.get(k.itemId ?? '') ?? null : k[f],
    }));
    if (ch.length) out.push({ kind: 'kpi', change: 'modified', code: k.code, title: k.name, changes: ch });
  }
  for (const k of a.kpis) if (!bk.has(k.id)) out.push({ kind: 'kpi', change: 'removed', code: k.code, title: k.name, changes: [] });
  const key = (l: PlanSnapshot['links'][number]) => `${l.fromItemId}>${l.toItemId}`;
  const al = new Map(a.links.map((l) => [key(l), l]));
  const bl = new Map(b.links.map((l) => [key(l), l]));
  const lt = (l: PlanSnapshot['links'][number]) => `${codeOf.get(l.fromItemId) ?? 'عنصر خارجي'} ← ${codeOf.get(l.toItemId) ?? 'عنصر خارجي'}`;
  for (const [kk, l] of bl) {
    const o = al.get(kk);
    if (!o) out.push({ kind: 'link', change: 'added', code: '—', title: lt(l), changes: [] });
    else if (!same(o.contribution, l.contribution) || o.relation !== l.relation) {
      out.push({ kind: 'link', change: 'modified', code: '—', title: lt(l), changes: [{ field: 'contribution', label: 'نسبة المساهمة / نوع العلاقة', before: `${o.relation} ${o.contribution ?? ''}`, after: `${l.relation} ${l.contribution ?? ''}` }] });
    }
  }
  for (const [kk, l] of al) if (!bl.has(kk)) out.push({ kind: 'link', change: 'removed', code: '—', title: lt(l), changes: [] });
  return out;
}

export const sumCost = (byYear: Record<string, number>) => r2(Object.values(byYear).reduce((s, v) => s + (Number(v) || 0), 0));
