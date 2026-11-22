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
import { PLANNING_PERMISSIONS } from '../planning/planning.manifest';
import { PlansService } from '../planning/plans.service';
import { ComplianceService } from '../risk/compliance.service';
import { ContinuityService } from '../risk/continuity.service';
import { RegisterService } from '../risk/register.service';
import { RiskCore } from '../risk/risk-core.service';
import { defaultPolicy } from '../risk/risk-defaults';
import { RISK_PERMISSIONS } from '../risk/risk.manifest';
import { StrategyImportService } from '../risk/strategy-import.service';
import {
  PACK_BUDGET, PACK_CODE, PACK_CONTINUITY, PACK_CONTROLS, PACK_CRISIS_TEAM, PACK_FILES, PACK_OBLIGATIONS, PACK_POLICY,
} from './company-pack.content';
import { StarterResult } from './starter.entity';
import { StarterService } from './starter.service';

type Status = { status: string };

/**
 * حزمة رعاية وطن الجاهزة: تُدرج مرة واحدة في منشأة الشركة (COMPANY_SLUG) عند تشغيل الخادم بعد التحديث،
 * بقرار المالك (2026-11-22) أن تكون الخطة والمخاطر والموازنة في النظام دون رفع يدوي:
 * الإعدادات الافتراضية للمخاطر والتخطيط، لائحة المخاطر، تحليلا PESTEL وSWOT و23 خطرًا، الخطة الاستراتيجية 2027 - 2030
 * والخطة التشغيلية 2027، موازنة 2027 وأنشطتها، الضوابط، سجل الالتزام، تحليل أثر التوقف وخطط التعافي، وفريق الأزمات.
 *
 * - كل العمليات عبر خدمات الأنظمة نفسها (بنفس التحقق والترقيم ومسارات الاعتماد)، وتُسجَّل باسم مدير نظام الشركة،
 *   والاعتمادات تمر بكل مراحلها المضبوطة باسمه مع ملاحظة أنها إدراج بقرار المالك.
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
      for (const [key, label, step] of this.steps(actor)) {
        current = label;
        const out = await step();
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

  private steps(a: OrgUser): [string, string, () => Promise<{ added: number; note?: string }>][] {
    const org = a.organizationId;
    const riskIds = new Map<string, string>();
    const one = async (sql: string, params: unknown[]) => ((await this.db.query(sql, params))[0] as { id: string } | undefined)?.id ?? null;
    const starter = async (code: string) => {
      try { await this.starters.apply(a, code); return { added: 1 }; } catch (e) { if (e instanceof ConflictException) return { added: 0, note: 'مضافة مسبقًا' }; if (e instanceof NotFoundException) return { added: 0, note: 'النظام غير مفعّل' }; throw e; }
    };
    const plan = async (file: string) => {
      const r = await this.planImport.import(a, await this.file(file), 'apply');
      const title = r.plan?.title;
      const id = r.plan?.id ?? (title ? await one('SELECT id FROM plan_plans WHERE organization_id = $1 AND title = $2 ORDER BY created_at LIMIT 1', [org, title]) : null);
      if (!id) throw new Error(`plan import failed: ${JSON.stringify(r.errors).slice(0, 500)}`);
      const [p] = await this.db.query('SELECT status FROM plan_plans WHERE organization_id = $1 AND id = $2', [org, id]);
      if (p.status === 'approved') return { added: r.plan?.id ? 1 : 0 };
      const note = 'اعتماد عند الإدراج بقرار المالك (الخطة الاستراتيجية 2027 - 2030)';
      const s = await this.approve(() => this.plans.submit(a, id, note), () => this.plans.decide(a, id, { decision: 'approve', note } as never));
      return { added: 1, note: s === 'approved' ? 'معتمدة' : 'بانتظار الاعتماد' };
    };
    return [
      ['starter-risk', 'الإعدادات الافتراضية لنظام المخاطر', () => starter('risk')],
      ['starter-planning', 'الإعدادات الافتراضية لنظام التخطيط', () => starter('planning')],
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
      ['strategic', 'الخطة الاستراتيجية 2027 - 2030', () => plan(PACK_FILES.strategic)],
      ['operational', 'الخطة التشغيلية 2027', () => plan(PACK_FILES.operational)],
      ['budget', 'الموازنة التقديرية 2027', async () => {
        // تكمل الموازنة إن توقف إدراج سابق في منتصفها: البنود ثم الأنشطة ثم الاعتماد
        let id = await one('SELECT id FROM plan_budgets WHERE organization_id = $1 AND fiscal_year = $2 AND title = $3 LIMIT 1', [org, PACK_BUDGET.fiscalYear, PACK_BUDGET.title]);
        const created = !id;
        if (!id) id = (await this.budgets.create(a, PACK_BUDGET as never)).id as string;
        const lines = (section: string) => this.db.query(
          `SELECT count(*)::int AS n FROM plan_budget_lines WHERE organization_id = $1 AND budget_id = $2 AND ($3 = '' OR section = $3)`, [org, id, section]).then((r) => r[0].n as number);
        const [st] = await this.db.query('SELECT status FROM plan_budgets WHERE organization_id = $1 AND id = $2', [org, id]);
        if (st.status === 'approved') return { added: 0, note: 'الموازنة معتمدة مسبقًا' };
        if (st.status === 'draft' || st.status === 'returned') {
          if (!(await lines(''))) {
            const r = await this.budgetImport.import(a, id, await this.file(PACK_FILES.budget), 'apply');
            if (!r.ok) throw new Error(`budget import failed: ${JSON.stringify(r.errors).slice(0, 500)}`);
          }
          if (!(await lines('activity'))) await this.budgets.importLines(a, id, { source: 'activities' });
        }
        const note = 'اعتماد عند الإدراج بقرار المالك (موازنة سنة الأساس 2027)';
        const s = st.status === 'in_review'
          ? await this.approve(async () => ({ status: 'in_review' }), () => this.budgets.decide(a, id!, { decision: 'approve', note } as never))
          : await this.approve(() => this.budgets.submit(a, id!, note), () => this.budgets.decide(a, id!, { decision: 'approve', note } as never));
        return { added: created ? 1 : 0, note: s === 'approved' ? 'معتمدة' : 'بانتظار الاعتماد' };
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
