import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { DataSource } from 'typeorm';
import { AuthUser } from '../../core/auth/decorators';
import { Organization, User } from '../../core/entities';
import { DEMO_SLUG, SAMPLE_EMAIL } from './demo-context';
import { DemoService } from './demo.service';
import { PEOPLE_TABLES, Snapshot, bySystem, countOf, diff, orgTables, purgeExcept, snapshot } from '../../core/lifecycle/org-data';
import { OrganizationSampleData, SampleDataEvent } from './sample-data.entity';

/** إذا بقيت الإضافة «جارية» أكثر من هذا (توقف الخادم مثلًا) تُعامل كمتوقفة */
const STALE_MS = 20 * 60 * 1000;

/**
 * البيانات التجريبية داخل جمعية مشتركة في فترة التجربة:
 * - زر «إضافة بيانات تجريبية» لمدير نظام الشركة (أو لمدير المنصة): يبني نفس بيانات الشركة التجريبية
 *   داخل الشركة، بعد أخذ لقطة من سجلاتها، ثم يحفظ معرف كل سجل تجريبي أُضيف.
 * - زر «تحويل إلى جمعية فعلية» لمدير المنصة: يحذف كل البيانات التي أضيفت بعد اللقطة (التجريبية وما أدخلته الشركة
 *   خلال التجربة، بعد عرض عددها بوضوح)، ويعيد إعدادات الأنظمة كما كانت، ويبقي الشركة واشتراكها وعقودها
 *   ومدير نظامها وكل حساب موظف أو دور أنشأته الشركة بنفسها.
 */
@Injectable()
export class SampleDataService {
  private readonly logger = new Logger('SampleData');

  constructor(
    private readonly db: DataSource,
    private readonly demo: DemoService,
  ) {}

  private repo() {
    return this.db.getRepository(OrganizationSampleData);
  }

  private async org(id: string) {
    const org = await this.db.getRepository(Organization).findOne({ where: { id } });
    if (!org) throw new NotFoundException('الشركة غير موجودة');
    return org;
  }

  private stale(r: OrganizationSampleData) {
    return r.status === 'loading' && Date.now() - new Date(r.loadedAt).getTime() > STALE_MS;
  }

  /** حالة البيانات التجريبية لجمعية، وهل يمكن إضافتها الآن */
  async status(orgId: string) {
    const org = await this.org(orgId);
    const r = await this.repo().findOne({ where: { organizationId: orgId } });
    const status = !r ? 'none' : this.stale(r) ? 'stalled' : r.status;
    return {
      status,
      canLoad: !r && org.subscriptionStatus === 'trial' && org.slug !== DEMO_SLUG,
      isTrial: org.subscriptionStatus === 'trial',
      loadedAt: r?.loadedAt ?? null, loadedBy: r?.loadedBy ?? null,
      clearedAt: r?.clearedAt ?? null, clearedBy: r?.clearedBy ?? null,
      log: r?.log ?? [],
    };
  }

  /**
   * إضافة البيانات التجريبية. تستغرق دقيقة أو دقيقتين لأن كل العمليات تمر عبر خدمات الأنظمة نفسها.
   * إن فشلت أي خطوة تُحذف كل السجلات التي أضيفت، وتعود الشركة كما كانت.
   */
  async load(orgId: string, actor: AuthUser, origin: string) {
    const org = await this.org(orgId);
    if (org.slug === DEMO_SLUG) throw new BadRequestException('الشركة التجريبية العامة لها زر خاص في شاشة الجمعيات');
    if (org.subscriptionStatus !== 'trial') throw new BadRequestException('البيانات التجريبية متاحة للجمعيات في الفترة التجريبية فقط');
    const admin = await this.db.getRepository(User).findOne({
      where: { organizationId: orgId, isSuperadmin: true, isActive: true }, order: { createdAt: 'ASC' },
    });
    if (!admin) throw new BadRequestException('لا يوجد مدير نظام نشط في الشركة');

    // حجز العملية: صف واحد لكل جمعية يمنع الإضافة مرتين أو في نفس الوقت
    const baseline = await this.db.transaction(async (em) => {
      const [existing] = await em.query('SELECT status FROM organization_sample_data WHERE organization_id = $1 FOR UPDATE', [orgId]);
      if (existing) {
        throw new ConflictException(existing.status === 'loading' ? 'جارٍ إضافة البيانات التجريبية الآن، انتظر قليلًا' : 'سبق إضافة البيانات التجريبية لهذه الشركة');
      }
      const snap = await snapshot(em, orgId);
      await em.insert(OrganizationSampleData, { organizationId: orgId, status: 'loading', loadedBy: actor.fullName, baseline: snap as never, log: [] });
      return snap;
    });

    const staffPassword = `Try-${randomBytes(4).toString('hex')}`;
    const portalPassword = `Portal-${randomBytes(3).toString('hex')}`;
    const started = Date.now();
    try {
      const built = await this.demo.build(
        orgId, { slug: org.slug, email: SAMPLE_EMAIL(org.slug), admin: { id: admin.id, fullName: admin.fullName, email: admin.email } },
        staffPassword, portalPassword, origin,
      );
      const after = await snapshot(this.db.manager, orgId);
      const sample = diff(after, baseline);
      const event: SampleDataEvent = { at: new Date().toISOString(), by: actor.fullName, action: 'loaded', counts: { records: countOf(sample) } };
      await this.db.query(
        `UPDATE organization_sample_data SET status = 'loaded', sample = $2, log = log || $3::jsonb WHERE organization_id = $1`,
        [orgId, JSON.stringify(sample), JSON.stringify([event])]);
      this.logger.log(`Sample data loaded into ${org.slug}: ${countOf(sample)} records in ${Math.round((Date.now() - started) / 1000)}s by ${actor.fullName}`);
      return {
        records: countOf(sample),
        systems: bySystem(sample),
        staffPassword,
        staff: built.staff,
        portalPassword,
        portalUsers: built.portalUsers,
        supplierPortal: built.supplierPortal,
      };
    } catch (e) {
      this.logger.error(`Sample data failed for ${org.slug}: ${(e as Error).message}`, (e as Error).stack);
      // إرجاع الشركة كما كانت تمامًا، ثم حذف الحجز ليمكن المحاولة مرة أخرى
      await this.db.transaction(async (em) => {
        await purgeExcept(em, orgId, baseline.ids, baseline.settings);
        await em.query('DELETE FROM organization_sample_data WHERE organization_id = $1', [orgId]);
      }).catch((err) => this.logger.error(`Sample data rollback failed for ${org.slug}: ${(err as Error).message}`));
      throw new BadRequestException(`تعذرت إضافة البيانات التجريبية، ولم يتغير شيء في الشركة. السبب: ${(e as Error).message}`);
    }
  }

  /** ما سيحدث عند التحويل: عدد السجلات التجريبية، وعدد ما أُضيف بعدها (غالبًا من إدخال الشركة) بحسب النظام */
  async preview(orgId: string) {
    const org = await this.org(orgId);
    const r = await this.full(orgId);
    const current = await snapshot(this.db.manager, orgId);
    const plan = this.plan(current, r.baseline, r.sample);
    return {
      organization: { name: org.name, slug: org.slug },
      status: this.stale(r) ? 'stalled' : r.status,
      loadedAt: r.loadedAt,
      sample: { total: countOf(plan.sample), systems: bySystem(plan.sample) },
      own: { total: countOf(plan.own), systems: bySystem(plan.own) },
      keptPeople: { users: plan.keptUsers, roles: plan.keptRoles },
    };
  }

  private async full(orgId: string) {
    const r = await this.repo().findOne({
      where: { organizationId: orgId },
      select: { organizationId: true, status: true, loadedAt: true, loadedBy: true, baseline: true, sample: true, log: true, clearedAt: true, clearedBy: true },
    });
    if (!r) throw new NotFoundException('لم تُضف بيانات تجريبية لهذه الشركة');
    if (r.status === 'cleared') throw new BadRequestException('سبق تحويل هذه الشركة إلى جمعية فعلية وحذف بياناتها التجريبية');
    if (r.status === 'loading' && !this.stale(r)) throw new ConflictException('جارٍ إضافة البيانات التجريبية الآن، انتظر حتى تنتهي');
    return r;
  }

  /**
   * تقسيم السجلات الحالية: ما كان قبل البيانات التجريبية يبقى، والتجريبي يُحذف، وما أضيف بعدها يُحذف أيضًا
   * (الشركة تبدأ فارغة) عدا حسابات الموظفين والأدوار التي أنشأتها الشركة بنفسها.
   * إن توقفت الإضافة قبل اكتمالها (sample فارغ) يُعد كل ما بعد اللقطة تجريبيًا.
   */
  private plan(current: Snapshot, baseline: Snapshot, sampleIds: Record<string, string[]> | null) {
    const added = diff(current, baseline);
    const sample: Record<string, string[]> = {};
    const own: Record<string, string[]> = {};
    const keep: Record<string, string[]> = { ...baseline.ids };
    let keptUsers = 0;
    let keptRoles = 0;
    for (const [t, ids] of Object.entries(added)) {
      const s = sampleIds ? new Set(sampleIds[t] ?? []) : null;
      const isSample = ids.filter((id) => !s || s.has(id));
      const isOwn = ids.filter((id) => s && !s.has(id));
      if (isSample.length) sample[t] = isSample;
      if (!isOwn.length) continue;
      if (PEOPLE_TABLES.has(t)) {
        keep[t] = [...(keep[t] ?? []), ...isOwn];
        if (t === 'users') keptUsers = isOwn.length;
        else keptRoles = isOwn.length;
      } else {
        own[t] = isOwn;
      }
    }
    return { sample, own, keep, keptUsers, keptRoles };
  }

  /**
   * التحويل إلى جمعية فعلية (مدير المنصة فقط): يتطلب كتابة معرف الشركة للتأكيد.
   * كل الحذف في معاملة واحدة: إما يكتمل كله أو لا يتغير شيء. ويُسجل في سجل العمليات بالأعداد.
   */
  async clear(orgId: string, confirm: string, actor: AuthUser) {
    const org = await this.org(orgId);
    if ((confirm ?? '').trim().toLowerCase() !== org.slug.toLowerCase()) {
      throw new BadRequestException('اكتب معرّف الشركة كما هو للتأكيد');
    }
    const result = await this.db.transaction(async (em) => {
      await em.query('SELECT 1 FROM organization_sample_data WHERE organization_id = $1 FOR UPDATE', [orgId]);
      const r = await em.getRepository(OrganizationSampleData).findOne({
        where: { organizationId: orgId },
        select: { organizationId: true, status: true, loadedAt: true, baseline: true, sample: true, log: true },
      });
      if (!r) throw new NotFoundException('لم تُضف بيانات تجريبية لهذه الشركة');
      if (r.status === 'cleared') throw new BadRequestException('سبق تحويل هذه الشركة إلى جمعية فعلية');
      if (r.status === 'loading' && !this.stale(r)) throw new ConflictException('جارٍ إضافة البيانات التجريبية الآن، انتظر حتى تنتهي');
      // بعد الربط مع «فاتورة» أو توقيع فواتير إلكترونية لا يُعاد ضبط البيانات، حتى لا تُفقد الشهادة أو سلسلة البصمات
      const [linked] = await em.query(
        `SELECT EXISTS (SELECT 1 FROM bl_zatca WHERE organization_id = $1 AND stage <> 'none') OR EXISTS (SELECT 1 FROM bl_documents WHERE organization_id = $1 AND invoice_hash IS NOT NULL) AS v`, [orgId]);
      if (linked?.v) throw new ConflictException('الشركة مربوطة بمنصة «فاتورة» أو أصدرت فواتير إلكترونية موقّعة، فلا يمكن تحويلها بحذف البيانات التجريبية');
      const tables = await orgTables(em);
      const current = await snapshot(em, orgId, tables);
      const plan = this.plan(current, r.baseline, r.sample);
      const deleted = await purgeExcept(em, orgId, plan.keep, r.baseline.settings, tables);
      // المحذوف = التجريبي + ما أضيف بعده (بعض السجلات تُحذف تبعًا لسجلاتها الأصلية فلا تظهر في عدّ كل جدول)
      const counts = { sample: countOf(plan.sample), own: countOf(plan.own), deleted: countOf(plan.sample) + countOf(plan.own) };
      const event: SampleDataEvent = {
        at: new Date().toISOString(), by: actor.fullName, action: 'cleared', counts,
        note: counts.own ? `حُذف معها ${counts.own} سجلًا أُضيفت خلال التجربة` : undefined,
      };
      await em.query(
        `UPDATE organization_sample_data SET status = 'cleared', cleared_at = now(), cleared_by = $2, sample = NULL, log = log || $3::jsonb WHERE organization_id = $1`,
        [orgId, actor.fullName, JSON.stringify([event])]);
      return { ...counts, keptUsers: plan.keptUsers, keptRoles: plan.keptRoles, systems: bySystem({ ...plan.sample, ...plan.own }), tables: Object.keys(deleted).length };
    });
    this.logger.warn(`Organization ${org.slug} converted to real by ${actor.fullName}: ${result.deleted} records deleted (${result.own} entered during trial)`);
    return result;
  }
}
