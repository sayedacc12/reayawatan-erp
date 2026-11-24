import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { readFile } from 'fs/promises';
import { join } from 'path';
import { DataSource } from 'typeorm';
import { OrgUser } from '../../core/auth/decorators';
import { findCompany } from '../../core/company';
import { User } from '../../core/entities';
import { IssueDto, StakeholderDto } from '../planning/planning.dto';
import { PLANNING_PERMISSIONS } from '../planning/planning.manifest';
import { PlansService } from '../planning/plans.service';
import { PACK_CODE } from './company-pack.content';
import { StarterResult } from './starter.entity';

export interface PlanContextFile { label: string; issues: IssueDto[]; stakeholders: StakeholderDto[] }

export const PLAN_CONTEXT_PREFIX = 'rw-ctx.';
export const PLAN_CONTEXT_NOTE = 'إضافة القضايا الجوهرية وخارطة المعنيين عند الإدراج بقرار المالك';

/**
 * القضايا الجوهرية وخارطة المعنيين لشركة رعاية وطن (قرار المالك 2026-11-24): تُدرج في أحدث خطة استراتيجية للشركة
 * من assets/plan-context/rw-plan-context.json، فلا تُترك للإدخال اليدوي.
 *
 * - مرة واحدة لكل خطة (organization_starters = rw-ctx.<رمز الخطة>)، فإن حذفتها الشركة لا تعود. وإن حلت خطة استراتيجية
 *   جديدة محل السابقة (مثل خطة 2027 - 2029) ولم يأتِ ملف رفعها بالقضايا والمعنيين، تُدرج فيها مع التحديث التالي.
 * - الخطة التي فيها قضايا أو معنيون مسبقًا (من ملف الرفع أو الإدخال) لا يُضاف إليها شيء.
 * - عبر خدمة الخطط نفسها وبنفس تحقق الطلبات، باسم مدير نظام الشركة. الخطة المعتمدة تُفتح مسودة تعديل ثم تمر بمراحل
 *   الاعتماد المضبوطة باسمه (إصدار جديد يحفظ الإضافة في سجل الإصدارات)، والخطة المسودة تبقى مسودة. الخطة قيد الاعتماد
 *   أو المرفوضة لا تُمس ويُعاد المحاولة في التشغيل التالي.
 * - تنتظر اكتمال حزمة الشركة (الخطة الاستراتيجية) إن كانت تعمل الآن.
 */
@Injectable()
export class CompanyPlanContextService implements OnApplicationBootstrap {
  private readonly logger = new Logger('CompanyPlanContext');

  constructor(private readonly db: DataSource, private readonly plans: PlansService) {}

  onApplicationBootstrap() {
    if (process.env.NODE_ENV === 'test' || process.env.PLAN_CONTEXT_PACK === 'off') return;
    // بعد حزمة الشركة (5 ثوانٍ) وحزمة الجودة (8 ثوانٍ)، ومحاولة ثانية إن كانت الحزمة لم تكتمل بعد
    const tick = (tries: number) => setTimeout(() => {
      this.run().then((r) => { if (r === 'wait' && tries > 1) tick(tries - 1); })
        .catch((e) => this.logger.error(`Plan context failed: ${(e as Error).message}`, (e as Error).stack));
    }, tries === 3 ? 20_000 : 120_000).unref();
    tick(3);
  }

  private dir() {
    return process.env.PLAN_CONTEXT_DIR ?? join(process.cwd(), 'assets', 'plan-context');
  }

  async content(): Promise<PlanContextFile> {
    const raw = JSON.parse(await readFile(join(this.dir(), 'rw-plan-context.json'), 'utf8')) as PlanContextFile;
    const check = async <T extends object>(cls: new () => T, plain: unknown, what: string) => {
      const dto = plainToInstance(cls, plain);
      const errors = await validate(dto, { whitelist: true, forbidNonWhitelisted: true });
      if (errors.length) throw new Error(`${what}: ${errors.map((e) => `${e.property}: ${Object.values(e.constraints ?? {}).join(', ')}`).join('; ')}`);
      return dto;
    };
    return {
      label: raw.label,
      issues: await Promise.all(raw.issues.map((x, i) => check(IssueDto, x, `issue ${i + 1}`))),
      stakeholders: await Promise.all(raw.stakeholders.map((x, i) => check(StakeholderDto, x, `stakeholder ${i + 1}`))),
    };
  }

  private async actor(orgId: string, slug: string): Promise<OrgUser | null> {
    const admin = await this.db.getRepository(User).findOne({ where: { organizationId: orgId, isSuperadmin: true, isActive: true }, order: { createdAt: 'ASC' } });
    if (!admin) return null;
    return {
      id: admin.id, organizationId: orgId, organizationName: null, organizationSlug: slug, email: admin.email, username: null,
      fullName: admin.fullName, isSuperadmin: true, isPlatformAdmin: false, permissions: Object.values(PLANNING_PERMISSIONS),
    };
  }

  /**
   * يعيد النتيجة، أو 'wait' إن لم توجد خطة بعد أو كانت الحزمة تعمل أو الخطة قيد الاعتماد، أو null إن لم يكن هناك ما يُعمل
   */
  async run(): Promise<StarterResult | 'wait' | null> {
    const company = await findCompany(this.db.manager);
    if (!company) return null;
    const a = await this.actor(company.id, company.slug);
    if (!a) return null;
    const org = company.id;
    const [busy] = await this.db.query(`SELECT 1 FROM organization_starters WHERE organization_id = $1 AND module_code = $2 AND status = 'applying'`, [org, PACK_CODE]);
    if (busy) return 'wait';
    const [plan] = await this.db.query(
      `SELECT id, code, status FROM plan_plans WHERE organization_id = $1 AND kind = 'strategic' ORDER BY start_year DESC, created_at DESC LIMIT 1`, [org]) as { id: string; code: string; status: string }[];
    if (!plan) return 'wait';
    if (plan.status === 'in_review' || plan.status === 'rejected') return 'wait';
    const code = `${PLAN_CONTEXT_PREFIX}${plan.code}`.slice(0, 40);
    await this.db.query(
      `DELETE FROM organization_starters WHERE organization_id = $1 AND module_code = $2 AND status = 'applying' AND applied_at < now() - interval '20 minutes'`, [org, code]);
    const reserved = await this.db.query(
      `INSERT INTO organization_starters (organization_id, module_code, status, applied_by, applied_by_id, results)
       VALUES ($1, $2, 'applying', $3, $4, '[]'::jsonb) ON CONFLICT DO NOTHING RETURNING applied_at::text AS applied_at`,
      [org, code, a.fullName, a.id]);
    if (!reserved.length) return null;
    const mine = reserved[0].applied_at as string;
    try {
      const r = await this.apply(a, plan);
      await this.db.query(
        `UPDATE organization_starters SET status = 'applied', applied_at = now(), results = $3::jsonb WHERE organization_id = $1 AND module_code = $2 AND applied_at = $4::timestamptz`,
        [org, code, JSON.stringify([r]), mine]);
      this.logger.log(`Plan context for ${plan.code}: ${r.added} added${r.note ? ` (${r.note})` : ''}`);
      return r;
    } catch (e) {
      await this.db.query(
        `DELETE FROM organization_starters WHERE organization_id = $1 AND module_code = $2 AND status = 'applying' AND applied_at = $3::timestamptz`,
        [org, code, mine]).catch(() => undefined);
      throw e;
    }
  }

  private async apply(a: OrgUser, plan: { id: string; code: string; status: string }): Promise<StarterResult> {
    const org = a.organizationId;
    const c = await this.content();
    const [{ n }] = await this.db.query(
      `SELECT (SELECT count(*) FROM plan_material_issues WHERE organization_id = $1 AND plan_id = $2) + (SELECT count(*) FROM plan_stakeholders WHERE organization_id = $1 AND plan_id = $2) AS n`,
      [org, plan.id]);
    if (Number(n) > 0) return { key: 'plan-context', label: c.label, added: 0, note: `الخطة ${plan.code} فيها قضايا أو معنيون مسبقًا` };
    const wasApproved = plan.status === 'approved';
    await this.plans.addContextBatch(a, plan.id, c.issues, c.stakeholders);
    let note = `${plan.code}: ${c.issues.length} قضية جوهرية و${c.stakeholders.length} معنيًا`;
    if (wasApproved) {
      let s = (await this.plans.submit(a, plan.id, PLAN_CONTEXT_NOTE)).status as string;
      for (let i = 0; i < 8 && s === 'in_review'; i++) s = (await this.plans.decide(a, plan.id, { decision: 'approve', note: PLAN_CONTEXT_NOTE } as never)).status as string;
      note += s === 'approved' ? '، واعتُمد إصدار جديد للخطة' : '، والخطة بانتظار الاعتماد';
    }
    return { key: 'plan-context', label: c.label, added: c.issues.length + c.stakeholders.length, note };
  }
}
