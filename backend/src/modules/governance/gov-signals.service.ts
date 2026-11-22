import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { CatalogItem } from './catalog';
import { GovFacts, GovObligation, ObligationKind } from './entities/governance.entity';
import { addDays, today } from './gov-finance.service';

/**
 * حالة الإشارة الآلية:
 *  met = متحقق، partial = جزئي، missing = غير متحقق، na = لا ينطبق على الشركة (يأخذ مسار «لا يوجد» بنسبة 100%).
 */
export type SignalStatus = 'met' | 'partial' | 'missing' | 'na';
export interface Signal { status: SignalStatus; text: string; source: string }

/**
 * يقترح اختيار كل سؤال من حالة الإشارة، بنفس منطق البطاقة (بوابات وانتقال):
 * - «لا ينطبق»: يُختار في السؤال الأول خيار البوابة الذي نسبته 100% (مثل «لا يوجد فروع»).
 * - «متحقق»: تُمرَّر البوابات، وتُختار أعلى نسبة في كل سؤال.
 * - «جزئي»: تُمرَّر البوابات، ويُختار خيار 50% إن وُجد وإلا الأدنى (تحفظاً).
 * - «غير متحقق»: تُمرَّر بوابات «لا ينطبق»، ويُختار أدنى خيار في أول سؤال يقبل ذلك.
 */
export function suggestChoices(item: CatalogItem, status: SignalStatus): (number | null)[] | null {
  const out: (number | null)[] = [];
  for (let i = 0; i < item.steps.length; i++) {
    const o = item.steps[i].o;
    const next = o.findIndex((x) => x[1] === null);
    const nums = o.map((x, k) => ({ k, p: x[1] })).filter((x) => x.p !== null) as { k: number; p: number }[];
    const low = nums.reduce((a, b) => (b.p < a.p ? b : a), nums[0]);
    const high = nums.reduce((a, b) => (b.p > a.p ? b : a), nums[0]);
    if (status === 'na') {
      const full = nums.find((x) => x.p === 100);
      return i === 0 && next >= 0 && full ? [full.k] : null;
    }
    if (next >= 0) {
      const notApplicableGate = nums.every((x) => x.p === 100);
      if (status === 'missing' && !notApplicableGate) { out.push(low.k); return out; }
      out.push(next);
      continue;
    }
    if (status === 'met') out.push(high.k);
    else if (status === 'partial') out.push((nums.find((x) => x.p === 50) ?? low).k);
    else out.push(low.k);
  }
  return out;
}

const DOC_KEYWORDS: Record<string, string[]> = {
  'policy.fundraising': ['جمع التبرعات', 'جمع الأموال'],
  'policy.beneficiaries': ['المستفيدين', 'تقديم الخدمات'],
  'policy.volunteers': ['التطوع', 'المتطوعين'],
  'policy.conflict': ['تعارض المصالح'],
  'policy.whistleblowing': ['الإبلاغ عن المخالفات', 'المبلغين'],
  'policy.privacy': ['الخصوصية', 'سرية البيانات'],
  'policy.retention': ['الاحتفاظ بالوثائق', 'إتلافها', 'حفظ الوثائق'],
  'policy.ctf': ['تمويل الإرهاب'],
  'policy.aml': ['غسل الأموال'],
  'hr.policy': ['الموارد البشرية', 'شؤون الموظفين'],
};

const OBLIGATION_SIGNALS: Record<string, { kind: ObligationKind; need: number; title: string }> = {
  'gov.quarterly': { kind: 'quarterly_report', need: 4, title: 'التقارير المالية الربعية' },
  'gov.quarterly_board': { kind: 'quarterly_report', need: 4, title: 'عرض التقارير الربعية على المجلس' },
  'gov.board_meetings': { kind: 'board_meeting', need: 4, title: 'اجتماعات مجلس الإدارة' },
  'gov.board_regular': { kind: 'board_meeting', need: 4, title: 'انتظام اجتماعات المجلس' },
  'members.ga_ordinary': { kind: 'ga_meeting', need: 1, title: 'الاجتماع العادي للشركة العمومية' },
  'members.ga_meeting': { kind: 'ga_meeting', need: 1, title: 'اجتماع الجمعية العمومية' },
  'gov.statements_ga': { kind: 'annual_statements', need: 1, title: 'اعتماد القوائم المالية من الجمعية العمومية' },
  'gov.statements_issued': { kind: 'annual_statements', need: 1, title: 'إصدار القوائم المالية المدققة' },
  'gov.statements_ncnp': { kind: 'annual_statements', need: 1, title: 'رفع القوائم المالية للمركز خلال 4 أشهر' },
  'gov.programs_report_ncnp': { kind: 'programs_report', need: 1, title: 'رفع تقرير البرامج والأنشطة' },
  'acc.budget': { kind: 'budget', need: 1, title: 'الموازنة التقديرية المعتمدة' },
  'gov.disclosure_filed': { kind: 'disclosure', need: 1, title: 'نموذج الإفصاح' },
  'gov.disclosure_approved': { kind: 'disclosure', need: 1, title: 'اعتماد نموذج الإفصاح' },
};

/**
 * الإشارات الآلية من أنظمة سنابل: تقرأ بيانات الأنظمة الأخرى (قراءة فقط) وتقترح إجابة لبنود البطاقات.
 * كل إشارة اقتراح يراجعه المقيّم ويستطيع تغييره؛ ولا تُعتمد إلا بالحفظ.
 */
@Injectable()
export class GovSignals {
  constructor(private readonly db: DataSource) {}

  private async tables(names: string[]): Promise<Set<string>> {
    const rows: { t: string | null }[] = await this.db.query(`SELECT to_regclass(x)::text AS t FROM unnest($1::text[]) AS x`, [names]);
    return new Set(rows.map((r) => r.t).filter(Boolean) as string[]);
  }

  private async count(sql: string, params: unknown[]): Promise<number> {
    const [r] = await this.db.query(sql, params);
    return Number(r?.n ?? 0);
  }

  async collect(org: string, facts: GovFacts, obligations: GovObligation[], at = today()): Promise<Record<string, Signal>> {
    const out: Record<string, Signal> = {};
    const set = (k: string, status: SignalStatus, text: string, source: string) => { out[k] = { status, text, source }; };
    const t = await this.tables(['acc_settings', 'acc_entries', 'hr_units', 'hr_jobs', 'hr_employees', 'audit_plans', 'audit_engagements', 'mem_members', 'mem_settings',
      'quality_complaints', 'quality_surveys', 'quality_documents', 'risk_register', 'beneficiaries', 'beneficiary_aids', 'acc_vouchers', 'hr_policy_versions', 'mtg_meetings', 'plan_plans']);

    // ---- النظام المالي
    if (t.has('acc_settings')) {
      const chart = await this.count(`SELECT COUNT(*) AS n FROM acc_settings WHERE organization_id = $1 AND chart_installed_at IS NOT NULL`, [org]);
      set('acc.unified_chart', chart ? 'met' : 'missing', chart ? 'دليل الحسابات الموحد مثبّت في النظام المالي' : 'لم يُثبّت دليل الحسابات الموحد بعد', 'النظام المالي');
      const posted = await this.count(`SELECT COUNT(*) AS n FROM acc_entries WHERE organization_id = $1 AND status = 'posted'`, [org]);
      set('acc.software', posted ? 'met' : 'missing', posted ? `الشركة تستخدم النظام المالي (${posted} قيد مرحّل)` : 'لا توجد قيود مرحّلة في النظام المالي', 'النظام المالي');
      const recent = await this.count(`SELECT COUNT(*) AS n FROM acc_entries WHERE organization_id = $1 AND status = 'posted' AND document_date >= $2`, [org, addDays(at, -45)]);
      set('acc.activity', recent ? 'met' : posted ? 'partial' : 'missing', recent ? `${recent} قيد مرحّل خلال آخر 45 يوماً` : 'لا قيود حديثة خلال 45 يوماً', 'النظام المالي');
    }
    if (t.has('acc_vouchers')) {
      const cash = await this.count(`SELECT COUNT(*) AS n FROM acc_vouchers WHERE organization_id = $1 AND method = 'cash' AND voucher_date >= $2`, [org, addDays(at, -365)]);
      // وجود سندات نقدية لا يحدد الالتزام بالإجراءات؛ فيُترك للمقيّم
      if (!cash) set('acc.cash_transactions', 'na', 'لا توجد سندات نقدية خلال السنة الأخيرة', 'النظام المالي');
    }

    // ---- التخطيط: خطة تشغيلية للسنة الحالية
    if (t.has('plan_plans')) {
      const y = Number(at.slice(0, 4));
      const [p] = await this.db.query(
        `SELECT COUNT(*)::int AS n, COUNT(*) FILTER (WHERE version > 0)::int AS ok FROM plan_plans
          WHERE organization_id = $1 AND kind = 'operational' AND status <> 'rejected' AND start_year <= $2 AND end_year >= $2`, [org, y]);
      set('plan.operational', p.ok ? 'met' : p.n ? 'partial' : 'missing',
        p.ok ? `توجد ${p.ok} خطة تشغيلية معتمدة للسنة ${y} (تأكد من اعتمادها من الجمعية العمومية)` : p.n ? 'الخطة التشغيلية للسنة الحالية لم تُعتمد بعد' : `لا توجد خطة تشغيلية للسنة ${y} في نظام التخطيط`, 'التخطيط');
    }

    // ---- الموارد البشرية
    if (t.has('hr_units')) {
      const units = await this.count(`SELECT COUNT(*) AS n FROM hr_units WHERE organization_id = $1`, [org]);
      set('hr.structure', units ? 'met' : 'missing', units ? `الهيكل التنظيمي معرّف (${units} وحدة)` : 'لم يُعرّف الهيكل التنظيمي', 'الموارد البشرية');
    }
    if (t.has('hr_jobs')) {
      const [j] = await this.db.query(
        `SELECT COUNT(*)::int AS n, COUNT(*) FILTER (WHERE status = 'approved')::int AS ok FROM hr_jobs WHERE organization_id = $1 AND is_active`, [org]);
      const status: SignalStatus = !j.n ? 'missing' : j.ok === j.n ? 'met' : 'partial';
      set('hr.job_descriptions', status, j.n ? `${j.ok} من ${j.n} وصف وظيفي معتمد` : 'لا توجد أوصاف وظيفية', 'الموارد البشرية');
    }
    if (t.has('hr_policy_versions')) {
      const pol = await this.count(`SELECT COUNT(*) AS n FROM hr_policy_versions WHERE organization_id = $1`, [org]);
      set('hr.policy', pol ? 'met' : 'missing', pol ? 'لائحة الموارد البشرية مصدرة بإصدارات' : 'لا توجد لائحة موارد بشرية', 'الموارد البشرية');
    }

    // ---- المراجعة الداخلية
    if (t.has('audit_plans')) {
      const plans = await this.count(`SELECT COUNT(*) AS n FROM audit_plans WHERE organization_id = $1 AND status = 'approved'`, [org]);
      set('audit.function', plans ? 'met' : 'missing', plans ? `توجد ${plans} خطة مراجعة داخلية معتمدة` : 'لا توجد خطة مراجعة داخلية معتمدة', 'المراجعة الداخلية');
      const reports = await this.count(`SELECT COUNT(*) AS n FROM audit_engagements WHERE organization_id = $1 AND report_issued_at IS NOT NULL`, [org]);
      set('audit.reports', reports ? 'met' : plans ? 'partial' : 'missing', reports ? `${reports} تقرير مراجعة داخلية صادر` : 'لم يصدر تقرير مراجعة داخلية بعد', 'المراجعة الداخلية');
    }

    // ---- العضوية
    if (t.has('mem_members')) {
      const [m] = await this.db.query(
        `SELECT COUNT(*)::int AS n, COUNT(*) FILTER (WHERE status = 'active')::int AS active,
                COUNT(*) FILTER (WHERE status = 'active' AND card_code IS NOT NULL AND card_code <> '')::int AS cards
           FROM mem_members WHERE organization_id = $1`, [org]);
      set('members.register', m.n ? 'met' : 'missing', m.n ? `سجل الأعضاء محدّث في نظام العضوية (${m.active} عضو نشط)` : 'لا يوجد أعضاء مسجلون في نظام العضوية', 'العضوية');
      set('members.categories', m.n ? 'met' : 'missing', m.n ? 'فئات العضوية وشروطها معرّفة في نظام العضوية' : 'لم تُعرّف فئات العضوية', 'العضوية');
      set('members.cards', !m.active ? 'missing' : m.cards === m.active ? 'met' : 'partial', m.active ? `${m.cards} من ${m.active} عضو لديه بطاقة عضوية` : 'لا أعضاء نشطون', 'العضوية');
      set('members.dues', m.n ? 'met' : 'missing', m.n ? 'الاشتراكات تُتابع بفواتير وتنبيهات في نظام العضوية' : 'لا توجد متابعة اشتراكات', 'العضوية');
      set('members.ga_eligible', m.active ? 'met' : 'missing', m.active ? `${m.active} عضو نشط يحق له حضور الجمعية العمومية` : 'لا أعضاء يحق لهم الحضور', 'العضوية');
    }

    // ---- الجودة
    if (t.has('quality_complaints')) {
      const c = await this.count(`SELECT COUNT(*) AS n FROM quality_complaints WHERE organization_id = $1`, [org]);
      set('quality.complaints', c ? 'met' : 'partial', c ? `آلية الشكاوى مفعّلة (${c} شكوى مسجلة)` : 'آلية الشكاوى موجودة لكن لم تُسجل شكاوى', 'الجودة');
    }
    if (t.has('quality_surveys')) {
      const s = await this.count(`SELECT COUNT(*) AS n FROM quality_surveys WHERE organization_id = $1`, [org]);
      const b = await this.count(`SELECT COUNT(*) AS n FROM quality_surveys WHERE organization_id = $1 AND audience = 'beneficiary'`, [org]);
      set('quality.surveys', s ? 'met' : 'missing', s ? `${s} استبانة رضا` : 'لا توجد استبانات رضا', 'الجودة');
      set('quality.beneficiary_survey', b ? 'met' : s ? 'partial' : 'missing', b ? 'يوجد قياس لرضا المستفيدين' : 'لا يوجد قياس لرضا المستفيدين', 'الجودة');
    }
    if (t.has('quality_documents')) {
      for (const [key, words] of Object.entries(DOC_KEYWORDS)) {
        const [d] = await this.db.query(
          `SELECT code, title, status FROM quality_documents WHERE organization_id = $1 AND title ILIKE ANY($2::text[]) ORDER BY (status = 'approved') DESC LIMIT 1`,
          [org, words.map((w) => `%${w}%`)]);
        if (d) set(key, d.status === 'approved' ? 'met' : 'partial', `${d.code}: ${d.title} (${d.status === 'approved' ? 'معتمدة' : 'غير معتمدة بعد'})`, 'الجودة');
      }
    }

    // ---- المخاطر
    if (t.has('risk_register')) {
      const [r] = await this.db.query(
        `SELECT COUNT(*)::int AS n, COUNT(*) FILTER (WHERE status = 'approved')::int AS ok FROM risk_register
          WHERE organization_id = $1 AND (title ILIKE '%إرهاب%' OR title ILIKE '%غسل%' OR description ILIKE '%تمويل الإرهاب%')`, [org]);
      set('risk.ctf_register', r.n ? 'met' : 'missing', r.n ? `${r.n} خطر متعلق بتمويل الإرهاب وغسل الأموال في سجل المخاطر` : 'لا توجد مخاطر تمويل إرهاب وغسل أموال في سجل المخاطر', 'المخاطر');
      set('risk.ctf_assessed', r.ok ? 'met' : r.n ? 'partial' : 'missing', r.ok ? 'تقييم المخاطر المتأصلة والمتبقية معتمد' : 'تقييم هذه المخاطر غير معتمد بعد', 'المخاطر');
    }

    // ---- المساعدات الاجتماعية
    if (t.has('beneficiaries')) {
      const b = await this.count(`SELECT COUNT(*) AS n FROM beneficiaries WHERE organization_id = $1`, [org]);
      set('ben.records', b ? 'met' : 'missing', b ? `ملفات ${b} مستفيد محفوظة إلكترونياً بصلاحيات وصول` : 'لا توجد ملفات مستفيدين', 'المساعدات الاجتماعية');
      set('ben.eligibility', b ? 'met' : 'missing', b ? 'معايير الاستحقاق مطبقة بنموذج البحث الاجتماعي والأوزان' : 'لا توجد معايير استحقاق مطبقة', 'المساعدات الاجتماعية');
    }
    if (t.has('beneficiary_aids')) {
      const a = await this.count(`SELECT COUNT(*) AS n FROM beneficiary_aids WHERE organization_id = $1`, [org]);
      if (a) set('ben.delivery_tracking', 'met', `${a} مساعدة موثقة بتاريخ الصرف ورقم المرجع`, 'المساعدات الاجتماعية');
    }

    // ---- تقويم الالتزامات (هذا النظام)
    for (const [key, def] of Object.entries(OBLIGATION_SIGNALS)) {
      const due = obligations.filter((o) => o.kind === def.kind && o.dueDate <= at && o.dueDate >= addDays(at, -400));
      const done = due.filter((o) => o.doneDate);
      const late = done.filter((o) => o.doneDate! > o.dueDate);
      if (!due.length) continue;
      const need = Math.min(def.need, due.length);
      const status: SignalStatus = done.length >= need && !late.length ? 'met' : done.length ? 'partial' : 'missing';
      set(key, status, `${def.title}: أُنجز ${done.length} من ${due.length} موعداً مستحقاً${late.length ? `، منها ${late.length} بعد الموعد` : ''}`, 'تقويم الالتزامات');
    }

    // ---- نظام الاجتماعات: الاجتماعات المنعقدة فعلًا خلال السنة الأخيرة (حين لا يكفي تقويم الالتزامات)
    if (t.has('mtg_meetings')) {
      const [mt] = await this.db.query(
        `SELECT COUNT(*) FILTER (WHERE kind = 'board')::int AS board, COUNT(*) FILTER (WHERE kind = 'board' AND status = 'adopted')::int AS board_adopted,
                COUNT(*) FILTER (WHERE kind = 'general_assembly' AND meeting_type = 'ordinary')::int AS ga
           FROM mtg_meetings WHERE organization_id = $1 AND status IN ('held','signing','adopted') AND meeting_date > $2 AND meeting_date <= $3`, [org, addDays(at, -365), at]);
      const fromMeetings = (key: string, n: number, need: number, text: string) => {
        if (out[key] && out[key].status === 'met') return;
        if (n) set(key, n >= need ? 'met' : 'partial', text, 'الاجتماعات واللجان');
      };
      for (const k of ['gov.board_meetings', 'gov.board_regular']) {
        fromMeetings(k, mt.board, 4, `انعقد ${mt.board} اجتماعًا لمجلس الإدارة خلال السنة الأخيرة (${mt.board_adopted} بمحضر معتمد)`);
      }
      for (const k of ['members.ga_ordinary', 'members.ga_meeting']) fromMeetings(k, mt.ga, 1, `انعقد ${mt.ga} اجتماع عادي للشركة العمومية خلال السنة الأخيرة`);
    }

    // ---- البيانات النظامية للشركة (من الإعدادات)
    if (facts.licenseExpiry) {
      set('gov.license', facts.licenseExpiry >= at ? 'met' : 'missing', facts.licenseExpiry >= at ? `شهادة التسجيل سارية حتى ${facts.licenseExpiry}` : `شهادة التسجيل منتهية منذ ${facts.licenseExpiry}`, 'بيانات الشركة');
    }
    if (facts.boardTermEnd) {
      const soon = facts.boardTermEnd <= addDays(at, 30) && facts.boardTermEnd >= addDays(at, -180);
      if (!soon) set('gov.board_term_end', 'na', `دورة المجلس تنتهي ${facts.boardTermEnd} (خارج نافذة الانتخابات في التقييم)`, 'بيانات الشركة');
    }
    if (facts.externalAuditor) {
      const valid = !facts.auditorContractEnd || facts.auditorContractEnd >= at;
      set('gov.external_auditor', valid ? 'met' : 'partial', valid ? `التعاقد مع ${facts.externalAuditor}` : `عقد ${facts.externalAuditor} انتهى ${facts.auditorContractEnd}`, 'بيانات الشركة');
    }
    if (facts.hasBranches === false) set('gov.branches', 'na', 'لا توجد فروع أو مكاتب للشركة', 'بيانات الشركة');
    else if (facts.hasBranches) set('gov.branches', facts.branchesApproved ? 'met' : 'missing', facts.branchesApproved ? 'الفروع بموافقة المركز والجهة المشرفة' : 'توجد فروع دون موافقة موثقة', 'بيانات الشركة');
    if (facts.hasCommittees === false) set('gov.committees', 'na', 'لا توجد لجان دائمة أو مؤقتة', 'بيانات الشركة');
    if (facts.openViolations !== null && facts.openViolations !== undefined) {
      set('gov.violations', facts.openViolations ? 'missing' : 'na', facts.openViolations ? `${facts.openViolations} مخالفة أو إنذار لم يُصحح` : 'لا توجد مخالفات أو إنذارات قائمة', 'بيانات الشركة');
    }
    if (facts.websiteUrl) set('site.exists', 'met', `الموقع الإلكتروني: ${facts.websiteUrl}`, 'بيانات الشركة');
    return out;
  }
}
