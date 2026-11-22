import { BadRequestException, ConflictException, ForbiddenException, HttpException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { OrgUser } from '../../core/auth/decorators';
import { ModuleCatalogService } from '../../core/modules/module-catalog.service';
import { OrganizationStarter, StarterResult } from './starter.entity';
import { StarterPack } from './starter.types';

export const STARTER_PACKS = Symbol('STARTER_PACKS');

/** إن بقيت الإضافة «جارية» أكثر من هذا (توقف الخادم مثلًا) تُعامل كمتوقفة ويمكن إعادتها */
const STALE_MS = 20 * 60 * 1000;

/**
 * زر «الإعدادات الافتراضية» داخل كل نظام: يضيف إعدادات بداية جاهزة (مراحل اعتماد، تصنيفات، قوائم، دليل...)
 * تعدّلها الشركة بعد ذلك بحرية. يُفعّل مرة واحدة فقط لكل نظام في الشركة، ولا يعدّل ولا يحذف أي شيء موجود.
 * يختلف عن «البيانات التجريبية»: هذه إعدادات حقيقية للعمل الفعلي، لا عمليات تجريبية.
 */
@Injectable()
export class StarterService {
  private readonly logger = new Logger('Starter');
  private readonly packs: Map<string, StarterPack>;

  constructor(
    private readonly db: DataSource,
    private readonly catalog: ModuleCatalogService,
    @Inject(STARTER_PACKS) packs: StarterPack[],
  ) {
    this.packs = new Map(packs.map((p) => [p.module, p]));
  }

  /** النظام موجود ومفعّل للشركة وله إعدادات افتراضية، والمستخدم يملك إدارة إعداداته */
  private async resolve(actor: OrgUser, code: string) {
    const pack = this.packs.get(code);
    const manifest = this.catalog.manifest(code);
    if (!pack || !manifest) throw new NotFoundException('النظام غير موجود');
    const enabled = await this.catalog.enabledModuleCodes(actor.organizationId);
    if (!enabled.has(code)) throw new NotFoundException('النظام غير موجود');
    if (!actor.isSuperadmin && !(manifest.settingsPermission && actor.permissions.includes(manifest.settingsPermission))) {
      throw new ForbiddenException('الإعدادات الافتراضية لمن يملك إدارة إعدادات هذا النظام');
    }
    return { pack, manifest };
  }

  private stale(r: OrganizationStarter) {
    return r.status === 'applying' && Date.now() - new Date(r.appliedAt).getTime() > STALE_MS;
  }

  async status(actor: OrgUser, code: string) {
    const { pack, manifest } = await this.resolve(actor, code);
    const r = await this.db.getRepository(OrganizationStarter).findOne({ where: { organizationId: actor.organizationId, moduleCode: code } });
    const state = !r ? 'available' : this.stale(r) ? 'available' : r.status;
    return {
      module: code,
      moduleName: manifest.name,
      status: state as 'available' | 'applying' | 'applied',
      steps: pack.steps.map((s) => ({ key: s.key, label: s.label, detail: s.detail })),
      applied: r && r.status === 'applied' ? { at: r.appliedAt, by: r.appliedBy, results: r.results } : null,
    };
  }

  /**
   * تنفيذ الإعدادات الافتراضية: حجز صف (منشأة، نظام) أولًا يمنع التفعيل مرتين أو في نفس الوقت،
   * ثم تنفيذ الخطوات بالترتيب عبر خدمات النظام نفسه (بنفس التحقق). إن فشلت خطوة يُلغى الحجز
   * ليمكن المحاولة مرة أخرى، وما أُضيف قبلها لا يتكرر لأن كل خطوة تضيف الناقص فقط.
   */
  async apply(actor: OrgUser, code: string) {
    const { pack, manifest } = await this.resolve(actor, code);
    const org = actor.organizationId;
    // حجز ذري: الإدراج ينجح لطلب واحد فقط، وأي طلب متزامن يحصل على 409 لا خطأ داخلي
    await this.db.query(
      `DELETE FROM organization_starters WHERE organization_id = $1 AND module_code = $2 AND status = 'applying' AND applied_at < now() - ($3 || ' milliseconds')::interval`,
      [org, code, String(STALE_MS)]);
    const reserved: unknown[] = await this.db.query(
      `INSERT INTO organization_starters (organization_id, module_code, status, applied_by, applied_by_id, results)
       VALUES ($1, $2, 'applying', $3, $4, '[]'::jsonb) ON CONFLICT DO NOTHING RETURNING module_code`,
      [org, code, actor.fullName, actor.id]);
    if (!reserved.length) {
      const [row] = await this.db.query('SELECT status FROM organization_starters WHERE organization_id = $1 AND module_code = $2', [org, code]);
      throw new ConflictException(row?.status === 'applying'
        ? 'جارٍ إضافة الإعدادات الافتراضية الآن، انتظر قليلًا'
        : `سبق إضافة الإعدادات الافتراضية لنظام «${manifest.name}»، ويمكنك تعديلها من شاشة الإعدادات`);
    }

    // تُنفَّذ الخطوات بصلاحيات هذا النظام فقط (لمن يملك إدارة إعداداته)، وتُسجَّل العمليات باسم المستخدم نفسه
    const runner: OrgUser = { ...actor, permissions: [...new Set([...actor.permissions, ...manifest.permissions.map((p) => p.code)])] };
    const results: StarterResult[] = [];
    let current = '';
    try {
      for (const step of pack.steps) {
        current = step.label;
        const out = await step.run(runner);
        results.push({ key: step.key, label: step.label, added: out.added, ...(out.note ? { note: out.note } : {}) });
      }
    } catch (e) {
      this.logger.error(`Starter ${code} failed for org ${org} at "${current}": ${(e as Error).message}`, (e as Error).stack);
      await this.db.query(`DELETE FROM organization_starters WHERE organization_id = $1 AND module_code = $2 AND status = 'applying'`, [org, code]).catch(() => undefined);
      // رسائل التحقق من خدمات الأنظمة عربية وآمنة للعرض، وغيرها (أخطاء قاعدة البيانات مثلًا) لا تُعرض
      const reason = e instanceof HttpException ? `: ${(e as Error).message}` : '';
      throw new BadRequestException(`تعذرت إضافة «${current}»${reason}. ما أُضيف قبلها باقٍ، ويمكنك المحاولة مرة أخرى لإكمال الباقي.`);
    }
    await this.db.query(
      `UPDATE organization_starters SET status = 'applied', applied_at = now(), results = $3::jsonb WHERE organization_id = $1 AND module_code = $2`,
      [org, code, JSON.stringify(results)]);
    this.logger.log(`Starter ${code} applied for org ${org} by ${actor.id}: ${results.map((r) => `${r.key}=${r.added}`).join(', ')}`);
    return this.status(actor, code);
  }
}
