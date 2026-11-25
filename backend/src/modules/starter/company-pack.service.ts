import { ConflictException, Injectable, Logger, NotFoundException, OnApplicationBootstrap } from '@nestjs/common';
import { readFile } from 'fs/promises';
import { join } from 'path';
import { DataSource } from 'typeorm';
import { OrgUser } from '../../core/auth/decorators';
import { findCompany } from '../../core/company';
import { User } from '../../core/entities';
import { BudgetImportService } from '../planning/budget/budget-import.service';
import { BudgetsService } from '../planning/budget/budgets.service';
import { PlanImportService } from '../planning/plan-import.service';
import { PlanningCore } from '../planning/planning-core.service';
import { BOARD_ROUTE_KINDS, defaultConfig } from '../planning/planning-defaults';
import { PLANNING_PERMISSIONS } from '../planning/planning.manifest';
import { PlansService } from '../planning/plans.service';
import { ComplianceService } from '../risk/compliance.service';
import { ContinuityService } from '../risk/continuity.service';
import { RegisterService } from '../risk/register.service';
import { RiskItem } from '../risk/entities/risk.entity';
import { RiskDto } from '../risk/risk.dto';
import { RiskCore, today } from '../risk/risk-core.service';
import { defaultPolicy } from '../risk/risk-defaults';
import { RISK_PERMISSIONS } from '../risk/risk.manifest';
import { StrategyImportService } from '../risk/strategy-import.service';
import {
  PACK_BUDGET, PACK_CODE, PACK_CONTINUITY, PACK_CONTROLS, PACK_CRISIS_TEAM, PACK_FILES, PACK_LEGACY, PACK_OBLIGATIONS, PACK_POLICY, PACK_TITLES,
} from './company-pack.content';
import { StarterResult } from './starter.entity';
import { StarterService } from './starter.service';

type Status = { status: string };

/**
 * خطوات تعمل مرة واحدة فقط: تُسجَّل عند اكتمالها (organization_starters = rw-plan-2027-2029.<الخطوة>) فلا تُعاد إن أُعيد التشغيل
 * بعد تعثر خطوة لاحقة، فلا يُمس ما عدّله المستخدمون أو اعتمدوه بعدها (مسودة الخطة، أو الموازنة المعتمدة، أو مسارات الاعتماد).
 */
const ONCE = ['routes', 'strategic', 'operational', 'budget'];

/**
 * حزمة رعاية وطن الجاهزة: تُدرج مرة واحدة في منشأة الشركة (COMPANY_SLUG) عند تشغيل الخادم بعد التحديث،
 * بقرار المالك (2026-11-22) أن تكون الخطة والمخاطر والموازنة في النظام دون رفع يدوي:
 * الإعدادات الافتراضية للمخاطر والتخطيط، مسارا اعتماد الخطط والموازنة (الاعتماد الأولي من الإدارة التنفيذية ثم مجلس المديرين)،
 * لائحة المخاطر، تحليلا PESTEL وSWOT والمخاطر، الخطة الاستراتيجية 2027 - 2029 والخطة التشغيلية 2027، موازنة 2027 وأنشطتها،
 * الضوابط، سجل الالتزام، تحليل أثر التوقف وخطط التعافي، وفريق الأزمات.
 *
 * الخطتان والموازنة لا تُعتمد هنا (قرار المالك 2026-11-24): تبقى مسودات حتى تعتمدها الإدارة التنفيذية اعتمادًا أوليًا،
 * ثم يُطبع تقرير الاعتماد ويُرفع لمجلس المديرين ليعتمدها نهائيًا من مسار الاعتماد في النظام.
 *
 * إن كانت الحزمة السابقة (2027 - 2030) مُدرجة: يُستبدل محتوى الخطتين والموازنة في مكانها كمسودة تعديل بسببها
 * (والإصدار المعتمد السابق باقٍ ومحفوظ للمقارنة حتى يُعتمد التعديل)، وتُغلق مخاطر المنتجات الوقفية والاستثمار بمراجعة توضح السبب،
 * وتُضاف المخاطر الجديدة.
 * لا يُستبدل محتوى خطة عليها إنجاز أو قراءات، ولا بند موازنة عليه حجز، فتتوقف الحزمة وتُسجل السبب دون تغيير ذلك.
 *
 * - كل العمليات عبر خدمات الأنظمة نفسها (بنفس التحقق والترقيم ومسارات الاعتماد)، وتُسجَّل باسم مدير نظام الشركة،
 *   واعتمادات المخاطر والتحليلات واستمرارية الأعمال تمر بكل مراحلها المضبوطة باسمه مع ملاحظة أنها إدراج بقرار المالك.
 * - تُحجز في organization_starters (صف واحد للحزمة) فلا تعمل مرتين. إن فشلت خطوة يُلغى الحجز ويُعاد التشغيل التالي
 *   من أولها، وكل خطوة تتجاوز ما أُدرج قبلها (بالعنوان) فلا يتكرر شيء.
 * - لا تعمل في الاختبارات إلا باستدعاء صريح، ولا تعمل إن حذفت الشركة ما أُدرج بعد اكتمالها.
 */
@Injectable()
export class CompanyPackService implements OnApplicationBootstrap {
  private readonly logger = new Logger('CompanyPack');

  constructor(
    private readonly db: DataSource,
    private readonly starters: StarterService,
    private readonly riskCore: RiskCore,
    private readonly register: RegisterService,
    private readonly compliance: ComplianceService,
    private readonly continuity: ContinuityService,
    private readonly strategy: StrategyImportService,
    private readonly planImport: PlanImportService,
    private readonly plans: PlansService,
    private readonly budgets: BudgetsService,
    private readonly budgetImport: BudgetImportService,
    private readonly planningCore: PlanningCore,
  ) {}

  onApplicationBootstrap() {
    if (process.env.NODE_ENV === 'test' || process.env.COMPANY_PACK === 'off') return;
    // بعد اكتمال التشغيل حتى لا يؤخر جاهزية الخادم
    setTimeout(() => { this.run().catch((e) => this.logger.error(`Company pack failed: ${(e as Error).message}`, (e as Error).stack)); }, 5000).unref();
  }

  private dir() {
    return process.env.COMPANY_PACK_DIR ?? join(process.cwd(), 'assets', 'company-pack');
  }

  private async file(name: string): Promise<Express.Multer.File> {
    const buffer = await readFile(join(this.dir(), name));
    return { originalname: name, buffer, size: buffer.length, mimetype: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' } as Express.Multer.File;
  }

  /** مدير نظام الشركة بصلاحيات المخاطر والتخطيط، وتُسجَّل العمليات باسمه */
  private async actor(orgId: string, slug: string): Promise<OrgUser | null> {
    const admin = await this.db.getRepository(User).findOne({ where: { organizationId: orgId, isSuperadmin: true, isActive: true }, order: { createdAt: 'ASC' } });
    if (!admin) return null;
    return {
      id: admin.id, organizationId: orgId, organizationName: null, organizationSlug: slug, email: admin.email, username: null,
      fullName: admin.fullName, isSuperadmin: true, isPlatformAdmin: false,
      permissions: [...Object.values(RISK_PERMISSIONS), ...Object.values(PLANNING_PERMISSIONS)],
    };
  }

  /** يمر بكل مراحل الاعتماد المضبوطة حتى يُعتمد، أو يتوقف عند مرحلة لا يملكها المدير */
  private async approve(submit: () => Promise<Status>, decide: () => Promise<Status>) {
    let s = (await submit()).status;
    for (let i = 0; i < 8 && s === 'in_review'; i++) s = (await decide()).status;
    return s;
  }

  /** تشغيل الحزمة لمنشأة الشركة. يعيد null إن لم تُشغَّل (لا شركة، أو سبق إدراجها، أو تجري الآن) */
  async run(): Promise<StarterResult[] | null> {
    const company = await findCompany(this.db.manager);
    if (!company) return null;
    const actor = await this.actor(company.id, company.slug);
    if (!actor) return null;
    const org = company.id;
    // حجز متروك من تشغيل انقطع (إعادة تشغيل الحاوية أثناء الإدراج) يُعاد بعد 20 دقيقة
    await this.db.query(
      `DELETE FROM organization_starters WHERE organization_id = $1 AND module_code = $2 AND status = 'applying' AND applied_at < now() - interval '20 minutes'`,
      [org, PACK_CODE]);
    const reserved = await this.db.query(
      `INSERT INTO organization_starters (organization_id, module_code, status, applied_by, applied_by_id, results)
       VALUES ($1, $2, 'applying', $3, $4, '[]'::jsonb) ON CONFLICT DO NOTHING RETURNING applied_at::text AS applied_at`,
      [org, PACK_CODE, actor.fullName, actor.id]);
    if (!reserved.length) return null;
    const mine = reserved[0].applied_at as string;
    const results: StarterResult[] = [];
    let current = '';
    try {
      const legacy = !!(await this.db.query(
        `SELECT 1 FROM organization_starters WHERE organization_id = $1 AND module_code = $2 AND status = 'applied'`, [org, PACK_LEGACY.code])).length;
      const done = await this.doneSteps(org);
      if (legacy) await this.preflight(org, done);
      for (const [key, label, step] of this.steps(actor, legacy)) {
        current = label;
        if (done.has(key)) { results.push({ key, label, added: 0, note: 'اكتملت في تشغيل سابق' }); continue; }
        const out = await step();
        if (ONCE.includes(key)) await this.markDone(org, key, actor);
        results.push({ key, label, added: out.added, ...(out.note ? { note: out.note } : {}) });
      }
    } catch (e) {
      this.logger.error(`Company pack stopped at "${current}": ${(e as Error).message}`, (e as Error).stack);
      await this.db.query(
        `DELETE FROM organization_starters WHERE organization_id = $1 AND module_code = $2 AND status = 'applying' AND applied_at = $3::timestamptz`,
        [org, PACK_CODE, mine]).catch(() => undefined);
      throw e;
    }
    await this.db.query(
      `UPDATE organization_starters SET status = 'applied', applied_at = now(), results = $3::jsonb WHERE organization_id = $1 AND module_code = $2 AND applied_at = $4::timestamptz`,
      [org, PACK_CODE, JSON.stringify(results), mine]);
    this.logger.log(`Company pack applied for org ${org}: ${results.map((r) => `${r.key}=${r.added}`).join(', ')}`);
    return results;
  }

  /** الخطوات التي تُسجَّل عند اكتمالها فلا تُعاد إن تعثرت خطوة بعدها وأُعيد التشغيل */
  private async doneSteps(org: string) {
    const rows: { code: string }[] = await this.db.query(
      `SELECT module_code AS code FROM organization_starters WHERE organization_id = $1 AND module_code = ANY($2) AND status = 'applied'`,
      [org, ONCE.map((k) => `${PACK_CODE}.${k}`)]);
    return new Set(rows.map((r) => r.code.slice(PACK_CODE.length + 1)));
  }

  private async markDone(org: string, key: string, a: OrgUser) {
    await this.db.query(
      `INSERT INTO organization_starters (organization_id, module_code, status, applied_by, applied_by_id, results)
       VALUES ($1, $2, 'applied', $3, $4, '[]'::jsonb) ON CONFLICT DO NOTHING`, [org, `${PACK_CODE}.${key}`, a.fullName, a.id]);
  }

  /**
   * فحص قبل أي تعديل في ترقية الحزمة السابقة: لا تعديل جارٍ من المستخدمين على الخطة الاستراتيجية والتشغيلية، ولا أنشطة مرحّلة
   * عليهما، ولا حجز أو مستند يشير إلى بنود الموازنة. أي مانع يوقف الحزمة قبل أن يتغير شيء.
   * بقرار المالك (2026-11-24): الإنجاز وقراءات المؤشرات المسجلة على الخطة التشغيلية القديمة قبل وقت قراره تجريبية، فتُحذف عند
   * استبدال المحتوى وتُحفظ قيمها في سجل الخطة؛ وما سُجّل بعده، أو أي إنجاز على الخطة الاستراتيجية، يوقف الحزمة.
   * والموازنة غير المعتمدة أو قيد الاعتماد تُعاد للتعديل ثم تُستبدل بنودها، وتُحفظ البنود المحذوفة في سجلها.
   * ما عدّلته الحزمة نفسها في تشغيل سابق انقطع (الخطة الاستراتيجية بعنوانها الجديد) يُكمل دون هذا الشرط.
   */
  private async preflight(org: string, done: Set<string>) {
    const revised = (r: { rev: string | null; note: string | null }) => r.rev === PACK_LEGACY.revisionNote || r.note === PACK_LEGACY.revisionNote;
    const problems: string[] = [];
    const [sp] = await this.db.query(
      `SELECT id, code, status FROM plan_plans WHERE organization_id = $1 AND kind = 'strategic' AND title = $2 ORDER BY created_at LIMIT 1`, [org, PACK_LEGACY.strategicTitle]);
    const fresh = !!sp && !done.has('strategic'); // لم يبدأ التعديل بعد
    const plans: { id: string; code: string; status: string }[] = fresh ? [sp] : [];
    const [op] = await this.db.query(
      `SELECT p.id, p.code, p.status, p.revision_note AS rev, (SELECT v.note FROM plan_versions v WHERE v.organization_id = $1 AND v.plan_id = p.id ORDER BY v.version DESC LIMIT 1) AS note
         FROM plan_plans p WHERE p.organization_id = $1 AND p.kind = 'operational' AND p.title = $2 ORDER BY p.created_at LIMIT 1`, [org, PACK_TITLES.operational]);
    if (op && !revised(op) && !done.has('operational')) plans.push(op);
    for (const p of plans) {
      if (fresh && p.status !== 'approved') problems.push(`الخطة ${p.code} عليها تعديل جارٍ أو قيد الاعتماد`);
      const [{ n, carried }] = await this.db.query(
        `WITH i AS (SELECT id FROM plan_items WHERE organization_id = $1 AND plan_id = $2)
         SELECT ((SELECT COUNT(*) FROM plan_progress_updates WHERE organization_id = $1 AND item_id IN (SELECT id FROM i) AND created_at >= $3::timestamptz)
               + (SELECT COUNT(*) FROM plan_kpi_readings r JOIN plan_kpis k ON k.id = r.kpi_id WHERE k.organization_id = $1 AND k.plan_id = $2 AND r.created_at >= $3::timestamptz))::int AS n,
                (SELECT COUNT(*) FROM plan_items WHERE organization_id = $1 AND (carried_from_id IN (SELECT id FROM i) OR (plan_id = $2 AND carried_from_id IS NOT NULL)))::int AS carried`,
        [org, p.id, p === op ? PACK_LEGACY.testEntriesBefore : '-infinity']);
      if (n) problems.push(`الخطة ${p.code} عليها إنجاز أو قراءات مؤشرات${p === op ? ' بعد قرار المالك' : ''}`);
      if (carried) problems.push(`الخطة ${p.code} عليها أنشطة مرحّلة من خطة أخرى أو إليها`);
    }
    const [b] = await this.db.query(
      `SELECT b.id, b.code, b.status, b.revision_note AS rev, (SELECT v.note FROM plan_budget_versions v WHERE v.organization_id = $1 AND v.budget_id = b.id ORDER BY v.version DESC LIMIT 1) AS note
         FROM plan_budgets b WHERE b.organization_id = $1 AND b.fiscal_year = $2 AND b.title = $3 AND NOT b.is_scenario ORDER BY b.created_at LIMIT 1`,
      [org, PACK_BUDGET.fiscalYear, PACK_BUDGET.title]);
    if (b && !revised(b) && !done.has('budget')) {
      if (b.status === 'rejected') problems.push(`الموازنة ${b.code} مرفوضة`);
      if (await this.budgets.lineBlockers(org, b.id)) problems.push(`على بنود الموازنة ${b.code} حجوزات أو مناقلات أو مستندات مرتبطة`);
    }
    if (problems.length) throw new Error(`upgrade to plan 2027-2029 stopped before any change: ${problems.join('؛ ')}`);
  }

  private steps(a: OrgUser, legacy: boolean): [string, string, () => Promise<{ added: number; note?: string }>][] {
    const org = a.organizationId;
    const riskIds = new Map<string, string>();
    const one = async (sql: string, params: unknown[]) => ((await this.db.query(sql, params))[0] as { id: string } | undefined)?.id ?? null;
    const starter = async (code: string) => {
      try { await this.starters.apply(a, code); return { added: 1 }; } catch (e) { if (e instanceof ConflictException) return { added: 0, note: 'مضافة مسبقًا' }; if (e instanceof NotFoundException) return { added: 0, note: 'النظام غير مفعّل' }; throw e; }
    };
    /**
     * الخطة: تُنشأ من الملف مسودةً، أو في حالة الحزمة السابقة يُستبدل محتوى الخطة المعتمدة القائمة (بعنوانها القديم) كمسودة تعديل
     * بسبب التعديل، ما لم تُستبدل في تشغيل سابق. لا تُرفع للاعتماد ولا تُعتمد: الاعتماد الأولي للإدارة التنفيذية ثم للمجلس.
     */
    const plan = async (file: string, kind: 'strategic' | 'operational', titles: string[]) => {
      let target: string | null = null;
      if (legacy) {
        const [p] = await this.db.query(
          `SELECT p.id, p.status, p.version, p.revision_note AS rev, (SELECT v.note FROM plan_versions v WHERE v.organization_id = $1 AND v.plan_id = p.id ORDER BY v.version DESC LIMIT 1) AS note
             FROM plan_plans p WHERE p.organization_id = $1 AND p.kind = $2 AND p.title = ANY($3) ORDER BY p.created_at LIMIT 1`, [org, kind, titles]);
        // عُدّلت في تشغيل سابق إن حملت سبب التعديل (مسودة) أو كان آخر إصدار معتمد لها هو التعديل. الخطة التشغيلية تصبح مسودة
        // بعد استبدال الخطة الأم (أُزيلت روابطها) فتُستبدل هي أيضًا؛ وما عدا ذلك منعه الفحص المسبق
        const done = p && (p.rev === PACK_LEGACY.revisionNote || p.note === PACK_LEGACY.revisionNote);
        if (p && !done && p.version > 0 && ['approved', 'draft', 'returned'].includes(p.status)) target = p.id;
        else if (p) return { added: 0, note: done ? 'عُدّلت مسبقًا' : 'مضافة مسبقًا' };
      }
      // الإنجاز والقراءات المسجلة قبل قرار المالك على الخطة التشغيلية القديمة تجريبية، فتُحذف في معاملة الاستبدال نفسها وتُحفظ قيمها في سجلها
      const discard = target && kind === 'operational' ? PACK_LEGACY.testEntriesBefore : undefined;
      const r = await this.planImport.import(a, await this.file(file), 'apply', target ?? undefined, target ? PACK_LEGACY.revisionNote : undefined, discard);
      if (target && !r.ok) throw new Error(`plan revision failed: ${JSON.stringify(r.errors).slice(0, 500)}`);
      const id = r.plan?.id ?? (r.plan?.title ? await one('SELECT id FROM plan_plans WHERE organization_id = $1 AND title = $2 ORDER BY created_at LIMIT 1', [org, r.plan.title]) : null);
      if (!id) throw new Error(`plan import failed: ${JSON.stringify(r.errors).slice(0, 500)}`);
      if (target) return { added: 0, note: 'عُدّلت كمسودة تعديل بانتظار الاعتماد الأولي ثم المجلس' };
      return r.ok && r.plan?.id ? { added: 1, note: 'مسودة بانتظار الاعتماد الأولي ثم المجلس' } : { added: 0, note: 'مضافة مسبقًا' };
    };
    /** إغلاق مخاطر الحزمة السابقة التي حُذفت من الخطة، بمراجعة تسجل السبب ثم إغلاق الخطر (يبقى في السجل) */
    const retire = async () => {
      let n = 0;
      for (const title of PACK_LEGACY.retiredRisks) {
        const r = await this.db.getRepository(RiskItem).findOne({ where: { organizationId: org, title } });
        if (!r || r.riskState === 'closed' || r.status === 'in_review' || r.status === 'rejected') continue;
        const noted = await one('SELECT id FROM risk_reviews WHERE organization_id = $1 AND risk_id = $2 AND note = $3 LIMIT 1', [org, r.id, PACK_LEGACY.retireNote]);
        if (!noted) await this.register.reviewRisk(a, r.id, { reviewDate: today(), likelihood: r.residualLikelihood, impact: r.residualImpact, note: PACK_LEGACY.retireNote });
        const dto: RiskDto = {
          title: r.title, description: r.description, source: r.source, category: r.category, productName: r.productName, unitId: r.unitId, ownerName: r.ownerName,
          causes: r.causes, consequences: r.consequences, inherentLikelihood: r.inherentLikelihood, inherentImpact: r.inherentImpact,
          residualLikelihood: r.residualLikelihood, residualImpact: r.residualImpact, targetScore: r.targetScore, treatment: r.treatment, treatmentNote: r.treatmentNote,
          actions: r.actions as RiskDto['actions'], kris: r.kris as RiskDto['kris'], riskState: 'closed', identifiedDate: r.identifiedDate,
        };
        await this.register.updateRisk(a, r.id, dto);
        n++;
      }
      return n;
    };
    return [
      ['starter-risk', 'الإعدادات الافتراضية لنظام المخاطر', () => starter('risk')],
      ['starter-planning', 'الإعدادات الافتراضية لنظام التخطيط', () => starter('planning')],
      // مسارا اعتماد الخطط والموازنة بقرار المالك: الاعتماد الأولي من الإدارة التنفيذية ثم الاعتماد النهائي من مجلس المديرين.
      // يستبدل مسارات هذه الأنواع في إعدادات الشركة (ولا يمس مسارات المناقلات)، ولا يغير ما رُفع للاعتماد قبله
      ['routes', 'مراحل اعتماد الخطط والموازنة', async () => {
        const cfg = await this.planningCore.config(org);
        const kinds = new Set<string>(BOARD_ROUTE_KINDS);
        const old = cfg.routes.filter((r) => kinds.has(r.planKind));
        // دور معتمد سبق ضبطه على مرحلة بنفس الاسم في مسار النوع نفسه يبقى عليها
        const want = defaultConfig().routes.filter((r) => kinds.has(r.planKind)).map((r) => ({
          ...r, stages: r.stages.map((st) => ({ ...st, roleId: old.find((o) => o.planKind === r.planKind)?.stages.find((x) => x.name === st.name)?.roleId ?? null })),
        }));
        const keep = cfg.routes.filter((r) => !kinds.has(r.planKind));
        if (JSON.stringify(old) === JSON.stringify(want)) return { added: 0, note: 'مضبوطة مسبقًا' };
        // يُسجَّل ما استُبدل في سجل الخادم للمراجعة
        this.logger.log(`Company pack replaced plan/budget approval routes: ${old.map((r) => `${r.key}[${r.stages.map((x) => `${x.name}${x.roleId ? '*' : ''}`).join(' > ')}]`).join(', ')}`);
        await this.planningCore.saveConfig(a, { ...cfg, routes: [...want, ...keep] } as never);
        return { added: want.length, note: `استُبدل ${old.length} مسارًا بمرحلتي الاعتماد الأولي والمجلس` };
      }],
      ['policy', 'لائحة إدارة المخاطر', async () => {
        if ((await this.riskCore.getPolicy(a)).current) return { added: 0, note: 'اللائحة معتمدة مسبقًا' };
        await this.riskCore.savePolicy(a, { sections: defaultPolicy(), ...PACK_POLICY });
        return { added: 1 };
      }],
      ['analyses', 'تحليلا PESTEL وSWOT والمخاطر', async () => {
        const r = await this.strategy.import(a, await this.file(PACK_FILES.risk), 'apply');
        if (!r.ok) throw new Error(`risk import failed: ${JSON.stringify(r.errors).slice(0, 500)}`);
        const note = 'اعتماد عند الإدراج بقرار المالك';
        for (const an of r.analyses) {
          if (!an.id) continue;
          const [x] = await this.db.query('SELECT status FROM risk_analyses WHERE organization_id = $1 AND id = $2', [org, an.id]);
          if (x.status !== 'approved') await this.approve(() => this.register.submitAnalysis(a, an.id!), () => this.register.decideAnalysis(a, an.id!, 'approve', note));
        }
        for (const rk of r.risks) {
          if (!rk.id) continue;
          riskIds.set(rk.key, rk.id);
          const [x] = await this.db.query('SELECT status FROM risk_register WHERE organization_id = $1 AND id = $2', [org, rk.id]);
          if (x.status !== 'approved') await this.approve(() => this.register.submitRisk(a, rk.id!), () => this.register.decideRisk(a, rk.id!, 'approve', note));
        }
        return { added: r.created.analyses + r.created.risks };
      }],
      ['strategic', 'الخطة الاستراتيجية 2027 - 2029', () => plan(PACK_FILES.strategic, 'strategic', [PACK_LEGACY.strategicTitle])],
      ['operational', 'الخطة التشغيلية 2027', () => plan(PACK_FILES.operational, 'operational', [PACK_TITLES.operational])],
      ['budget', 'الموازنة التقديرية 2027', async () => {
        // تكمل الموازنة إن توقف إدراج سابق في منتصفها: البنود ثم الأنشطة. لا تُرفع للاعتماد ولا تُعتمد هنا
        let id = await one('SELECT id FROM plan_budgets WHERE organization_id = $1 AND fiscal_year = $2 AND title = $3 AND NOT is_scenario ORDER BY created_at LIMIT 1', [org, PACK_BUDGET.fiscalYear, PACK_BUDGET.title]);
        const created = !id;
        if (!id) id = (await this.budgets.create(a, PACK_BUDGET as never)).id as string;
        const lines = (section: string) => this.db.query(
          `SELECT count(*)::int AS n FROM plan_budget_lines WHERE organization_id = $1 AND budget_id = $2 AND ($3 = '' OR section = $3)`, [org, id, section]).then((r) => r[0].n as number);
        const [st] = await this.db.query(
          `SELECT b.status, b.version, b.revision_note AS rev, (SELECT v.note FROM plan_budget_versions v WHERE v.organization_id = $1 AND v.budget_id = b.id ORDER BY v.version DESC LIMIT 1) AS note
             FROM plan_budgets b WHERE b.organization_id = $1 AND b.id = $2`, [org, id]) as { status: string; version: number; rev: string | null; note: string | null }[];
        // الحزمة السابقة: تُحذف بنود الموازنة (فتصبح مسودة تعديل بسببها) وتُستورد بنود الخطة الجديدة وأنشطتها، إلا إن عُدّلت سابقًا.
        // الموازنة قيد الاعتماد تُعاد للتعديل أولًا بملاحظة السبب (قرار المالك 2026-11-24)
        let revised = false;
        if (legacy && !created && st.rev !== PACK_LEGACY.revisionNote && st.note !== PACK_LEGACY.revisionNote && ['approved', 'draft', 'returned', 'in_review'].includes(st.status)) {
          revised = true;
          if (st.status === 'in_review') await this.budgets.decide(a, id, { decision: 'return', note: 'إعادة للتعديل لاستبدال بنودها بموازنة خطة 2027 - 2029 بقرار المالك' } as never);
          await this.budgets.clearLinesForRevision(a, id, PACK_LEGACY.revisionNote);
        } else if (st.status !== 'draft' && st.status !== 'returned') return { added: 0, note: 'مضافة مسبقًا' };
        if (!(await lines(''))) {
          const r = await this.budgetImport.import(a, id, await this.file(PACK_FILES.budget), 'apply');
          if (!r.ok) throw new Error(`budget import failed: ${JSON.stringify(r.errors).slice(0, 500)}`);
        }
        // بنود الأنشطة تُستورد من الخطة التشغيلية التي لها إصدار معتمد فقط (قاعدة النظام)؛ في التثبيت الجديد تُضاف بعد اعتمادها
        if (!(await lines('activity'))) await this.budgets.importLines(a, id, { source: 'activities' });
        const acts = (await lines('activity')) ? '' : '، وبنود الأنشطة تُستورد بعد اعتماد الخطة التشغيلية';
        return { added: created ? 1 : 0, note: `${revised ? 'عُدّلت كمسودة تعديل، ' : 'مسودة، '}بانتظار الاعتماد الأولي ثم المجلس${acts}` };
      }],
      // بعد تعديل الخطة (فلا يُغلق خطر ما زالت الخطة المعتمدة مرتبطة به إن توقف التعديل)
      ['retire', 'إغلاق مخاطر المنتجات الوقفية والاستثمار', async () => {
        const closed = legacy ? await retire() : 0;
        return { added: closed, ...(legacy ? {} : { note: 'لا توجد حزمة سابقة' }) };
      }],
      ['controls', 'الضوابط الرقابية', async () => {
        let n = 0;
        for (const c of PACK_CONTROLS) {
          if (await one('SELECT id FROM risk_controls WHERE organization_id = $1 AND name = $2', [org, c.name])) continue;
          await this.register.saveControl(a, {
            name: c.name, description: c.description, type: c.type, automated: c.automated, frequency: c.frequency, ownerName: c.ownerName,
            effectiveness: 'not_tested', riskIds: c.risks.map((k) => riskIds.get(k)).filter((x): x is string => !!x),
          });
          n++;
        }
        return { added: n };
      }],
      ['compliance', 'سجل الالتزام', async () => {
        let n = 0;
        for (const o of PACK_OBLIGATIONS) {
          if (await one('SELECT id FROM risk_obligations WHERE organization_id = $1 AND title = $2', [org, o.title])) continue;
          await this.compliance.saveObligation(a, {
            title: o.title, authority: o.authority, reference: o.reference ?? null, description: o.description ?? null, ownerName: o.ownerName,
            frequency: o.frequency, nextDueDate: o.nextDueDate ?? null, riskId: o.risk ? riskIds.get(o.risk) ?? null : null,
          });
          n++;
        }
        return { added: n };
      }],
      ['continuity', 'تحليل أثر التوقف وخطط التعافي وفريق الأزمات', async () => {
        let n = 0;
        const note = 'اعتماد عند الإدراج بقرار المالك';
        const ids: string[] = [];
        for (const c of PACK_CONTINUITY) {
          const found = await one('SELECT id FROM risk_continuity WHERE organization_id = $1 AND activity = $2', [org, c.activity]);
          if (found) {
            ids.push(found);
            const [x] = await this.db.query('SELECT status FROM risk_continuity WHERE organization_id = $1 AND id = $2', [org, found]);
            if (x.status === 'draft') await this.approve(() => this.continuity.submitContinuity(a, found), () => this.continuity.decideContinuity(a, found, 'approve', note));
            continue;
          }
          const { risks, ...dto } = c;
          const b = await this.continuity.saveContinuity(a, { ...dto, unitName: null, riskIds: risks.map((k) => riskIds.get(k)).filter((x): x is string => !!x) });
          ids.push(b.id);
          await this.approve(() => this.continuity.submitContinuity(a, b.id), () => this.continuity.decideContinuity(a, b.id, 'approve', note));
          n++;
        }
        if (!(await one('SELECT id FROM risk_crisis_teams WHERE organization_id = $1 AND name = $2', [org, PACK_CRISIS_TEAM.name]))) {
          const t = PACK_CRISIS_TEAM;
          const team = await this.continuity.saveTeam(a, {
            ...t, members: t.members.map((m) => ({ userId: null, ...m })), systemPermissions: [], continuityIds: ids,
          } as never);
          await this.approve(() => this.continuity.submitTeam(a, team.id), () => this.continuity.decideTeam(a, team.id, 'approve', note));
          n++;
        }
        return { added: n };
      }],
    ];
  }
}
