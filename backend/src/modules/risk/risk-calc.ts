import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import type { BiaImpacts, WfLog, WfStatus } from './entities/risk.entity';
import { RiskConfig, RiskLevel, WfStage } from './risk-defaults';

/** دوال خالصة للحساب والاعتماد، حتى تُختبر وحدها */

export const score = (likelihood: number, impact: number) => likelihood * impact;

/** مستوى الخطر حسب الدرجة (أعلى مستوى تتجاوز الدرجة حده الأدنى) */
export function levelOf(cfg: RiskConfig, s: number): RiskLevel {
  const sorted = [...cfg.levels].sort((a, b) => b.min - a.min);
  return sorted.find((l) => s >= l.min) ?? sorted[sorted.length - 1];
}

export const addDays = (date: string, days: number) => {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

/** موعد المراجعة التالية حسب مستوى الخطر المتبقي */
export const nextReview = (cfg: RiskConfig, residual: number, from: string) => addDays(from, levelOf(cfg, residual).reviewDays);

/** أهمية النشاط في تحليل أثر التوقف: أعلى أثر، وتُرفع درجة إن كانت فترة التوقف المحتملة قصيرة */
export function criticality(impacts: BiaImpacts, mtpdHours: number): { value: number; name: string } {
  const max = Math.max(impacts.financial, impacts.beneficiaries, impacts.reputation, impacts.legal, impacts.operational);
  const v = Math.min(4, Math.max(1, Math.ceil(max * 0.8) + (mtpdHours <= 24 ? 1 : 0) - (mtpdHours > 168 ? 1 : 0)));
  return { value: v, name: ['', 'منخفضة', 'متوسطة', 'عالية', 'حرجة'][v] };
}

/** التحقق من إعدادات المصفوفة والقوائم قبل حفظها */
export function validateConfig(cfg: RiskConfig) {
  for (const [k, scale] of [['الاحتمالية', cfg.likelihood], ['الأثر', cfg.impact]] as const) {
    if (scale.length !== 5 || scale.some((s, i) => s.value !== i + 1 || !s.name?.trim())) throw new BadRequestException(`مقياس ${k} يجب أن يكون 5 درجات بأسماء`);
  }
  if (!cfg.levels.length || cfg.levels.length > 6) throw new BadRequestException('حدد من مستوى إلى 6 مستويات للخطر');
  const mins = cfg.levels.map((l) => l.min);
  if (!mins.includes(1)) throw new BadRequestException('أحد مستويات الخطر يجب أن يبدأ من الدرجة 1');
  if (new Set(mins).size !== mins.length || mins.some((m) => m < 1 || m > 25)) throw new BadRequestException('بدايات مستويات الخطر يجب أن تكون مختلفة وبين 1 و25');
  if (cfg.levels.some((l) => !l.name?.trim() || !/^#[0-9a-fA-F]{6}$/.test(l.color) || !(l.reviewDays >= 1 && l.reviewDays <= 730))) {
    throw new BadRequestException('أكمل اسم ولون ومدة مراجعة كل مستوى (من يوم إلى 730 يومًا)');
  }
  if (!(cfg.appetite >= 1 && cfg.appetite <= 25)) throw new BadRequestException('حد الرغبة في المخاطر بين 1 و25');
  if (!cfg.categories.length) throw new BadRequestException('أضف تصنيفًا واحدًا على الأقل للمخاطر');
  const codes = cfg.categories.map((c) => c.code);
  if (new Set(codes).size !== codes.length) throw new BadRequestException('رموز تصنيفات المخاطر مكررة');
  if (!cfg.changeTypes.length) throw new BadRequestException('أضف نوعًا واحدًا على الأقل لطلبات التغيير');
  for (const stages of Object.values(cfg.workflows)) {
    if (stages.length > 6) throw new BadRequestException('الحد الأعلى 6 مراحل اعتماد لكل إجراء');
    if (stages.some((s) => !s.name?.trim())) throw new BadRequestException('اكتب اسم كل مرحلة اعتماد');
  }
}

// ---------------------------------------------------------------- محرك الاعتماد

export interface WfRecord { status: WfStatus; stageIndex: number | null; approvals: WfLog[]; revision: number; approvedAt: Date | null }

const log = (action: WfLog['action'], stage: string | null, byName: string, note: string | null = null): WfLog =>
  ({ action, stage, byName, at: new Date().toISOString(), note });

/** هل العنصر قابل للتعديل؟ (المسودة والمُرجع فقط، والمعتمد يعود مسودة عند تعديله) */
export function assertEditable(r: WfRecord) {
  if (r.status === 'in_review') throw new ConflictException('العنصر قيد الاعتماد، ولا يُعدّل حتى يُعاد أو يُعتمد');
  if (r.status === 'rejected') throw new ConflictException('العنصر مرفوض ولا يُعدّل');
}

/** تعديل عنصر معتمد يعيده مسودة لإعادة اعتماده (ويزيد رقم مراجعته عند الاعتماد) */
export function markEdited(r: WfRecord, byName: string) {
  if (r.status === 'approved') {
    r.status = 'draft';
    r.approvals = [...r.approvals, log('reopen', null, byName, 'تعديل بعد الاعتماد')];
  }
}

export function wfSubmit(r: WfRecord, stages: WfStage[], byName: string) {
  if (!['draft', 'returned'].includes(r.status)) throw new ConflictException('يُرفع للاعتماد ما كان مسودة أو مُرجعًا فقط');
  r.approvals = [...r.approvals, log('submit', stages[0]?.name ?? null, byName)];
  if (!stages.length) return approve(r);
  r.status = 'in_review';
  r.stageIndex = 0;
}

function approve(r: WfRecord) {
  const wasApproved = r.approvedAt !== null;
  r.status = 'approved';
  r.stageIndex = null;
  if (wasApproved) r.revision += 1;
  r.approvedAt = new Date();
}

export interface Decider { name: string; isSuperadmin: boolean; hasPermission: boolean; roleIds: Set<string> }

export function canDecide(stages: WfStage[], r: WfRecord, d: Decider) {
  if (r.status !== 'in_review' || r.stageIndex === null) return false;
  if (!d.hasPermission && !d.isSuperadmin) return false;
  const stage = stages[r.stageIndex];
  return !stage?.roleId || d.isSuperadmin || d.roleIds.has(stage.roleId);
}

/** قرار في المرحلة الحالية: اعتماد (ينقل للمرحلة التالية أو يعتمد نهائيًا)، أو إرجاع للتعديل، أو رفض. الإرجاع والرفض بسبب إلزامي */
export function wfDecide(r: WfRecord, stages: WfStage[], d: Decider, decision: 'approve' | 'return' | 'reject', note: string | null) {
  if (r.status !== 'in_review' || r.stageIndex === null) throw new ConflictException('العنصر ليس قيد الاعتماد');
  if (!canDecide(stages, r, d)) throw new ForbiddenException('القرار في هذه المرحلة ليس من صلاحيتك');
  if (decision !== 'approve' && !note?.trim()) throw new BadRequestException('اكتب سبب الإرجاع أو الرفض');
  const stage = stages[r.stageIndex]?.name ?? null;
  r.approvals = [...r.approvals, log(decision, stage, d.name, note?.trim() || null)];
  if (decision === 'return') { r.status = 'returned'; r.stageIndex = null; return; }
  if (decision === 'reject') { r.status = 'rejected'; r.stageIndex = null; return; }
  if (r.stageIndex + 1 < stages.length) { r.stageIndex += 1; return; }
  approve(r);
}
