import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { AuthUser } from '../auth/decorators';
import { Organization } from '../entities';
import { addDays, todayRiyadh } from '../organizations/org-access';
import { PlatformSetting } from '../subscriptions/entities';
import { ClosureEvent, OrganizationClosure } from './closure.entity';
import { DEFAULT_LIFECYCLE, LifecycleSettings, deletionNotice, lifecycleSettings } from './lifecycle-rules';
import { deleteOrganization, exportOrganization } from './org-data';

/** فحص الحذف المجدول كل ساعة (يتوقف في الاختبارات) */
const SWEEP_EVERY_MS = 60 * 60 * 1000;

const event = (by: string, action: ClosureEvent['action'], note?: string): ClosureEvent => ({ at: new Date().toISOString(), by, action, note });

/**
 * دورة حياة الجمعية بعد التعاقد أو التجربة:
 * - إنهاء العقد بالتراضي: يتوقف دخول الجمعية فورًا، وتُحذف بياناتها بعد مهلة يحددها مدير المنصة (يمكن الإلغاء خلالها).
 * - جمعيات التجربة: تُحذف تلقائيًا بعد نهاية التجربة بمهلة (إعداد المنصة)، ما لم تُمدد التجربة أو يتم التعاقد.
 * - التصدير قبل الحذف، وسجل دائم بكل جمعية حُذفت.
 */
@Injectable()
export class LifecycleService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger('Lifecycle');
  private timer: NodeJS.Timeout | null = null;

  constructor(private readonly db: DataSource) {}

  onApplicationBootstrap() {
    if (process.env.JEST_WORKER_ID || process.env.LIFECYCLE_SWEEP === 'off') return;
    const run = () => this.sweep().catch((e) => this.logger.error(`Lifecycle sweep failed: ${(e as Error).message}`));
    setTimeout(run, 60 * 1000).unref();
    this.timer = setInterval(run, SWEEP_EVERY_MS);
    this.timer.unref();
  }

  onApplicationShutdown() {
    if (this.timer) clearInterval(this.timer);
  }

  settings() {
    return lifecycleSettings(this.db);
  }

  async saveSettings(dto: LifecycleSettings) {
    const days = Math.round(Number(dto.trialGraceDays));
    if (!Number.isFinite(days) || days < 0 || days > 365) throw new BadRequestException('مهلة الحذف بين 0 و365 يومًا');
    await this.db.getRepository(PlatformSetting).save({ key: 'lifecycle', value: { ...DEFAULT_LIFECYCLE, trialGraceDays: days } });
    return this.settings();
  }

  private async org(id: string) {
    const org = await this.db.getRepository(Organization).findOne({ where: { id } });
    if (!org) throw new NotFoundException('الجمعية غير موجودة');
    return org;
  }

  private assertConfirm(org: Organization, confirm: string | undefined) {
    if ((confirm ?? '').trim().toLowerCase() !== org.slug.toLowerCase()) throw new BadRequestException('اكتب معرّف الجمعية كما هو للتأكيد');
  }

  /** موعد الحذف لجمعية (لملف الجمعية ولشريط التنبيه داخلها) */
  async notice(orgId: string) {
    const org = await this.org(orgId);
    return deletionNotice(this.db, org);
  }

  /** حالة الإغلاق في ملف الجمعية: الموعد، والإنهاء المجدول إن وجد */
  async status(orgId: string) {
    const org = await this.org(orgId);
    const scheduled = await this.db.getRepository(OrganizationClosure).findOne({ where: { organizationId: orgId, status: 'scheduled' } });
    const history = await this.db.getRepository(OrganizationClosure).find({ where: { organizationId: orgId }, order: { createdAt: 'DESC' } });
    return { notice: await deletionNotice(this.db, org), scheduled, history };
  }

  /**
   * إنهاء العقد بالتراضي: يُسجَّل الاتفاق، ويتوقف دخول الجمعية فورًا، وتُحذف بياناتها في يوم الحذف.
   * المهلة 0 تعني الحذف في أول فحص (خلال ساعة) أو بزر «احذف الآن».
   */
  async terminate(orgId: string, dto: { agreementDate: string; charityRep: string; note?: string; graceDays: number; confirm: string }, actor: AuthUser) {
    const org = await this.org(orgId);
    this.assertConfirm(org, dto.confirm);
    if (org.slug === 'demo') throw new BadRequestException('الجمعية التجريبية العامة تُحذف من شاشة الجمعيات');
    const grace = Math.round(Number(dto.graceDays));
    if (!Number.isFinite(grace) || grace < 0 || grace > 365) throw new BadRequestException('مهلة الحذف بين 0 و365 يومًا');
    if (!dto.charityRep?.trim()) throw new BadRequestException('اكتب اسم ممثل الجمعية في الاتفاق');
    return this.db.transaction(async (em) => {
      await em.query('SELECT 1 FROM organizations WHERE id = $1 FOR UPDATE', [orgId]);
      if (await em.exists(OrganizationClosure, { where: { organizationId: orgId, status: 'scheduled' } })) {
        throw new ConflictException('يوجد إنهاء مجدول لهذه الجمعية بالفعل');
      }
      const deleteOn = addDays(todayRiyadh(), grace);
      const c = await em.save(em.create(OrganizationClosure, {
        organizationId: org.id, orgName: org.name, orgSlug: org.slug, reason: 'mutual', status: 'scheduled', deleteOn,
        agreement: { date: dto.agreementDate, charityRep: dto.charityRep.trim(), note: dto.note?.trim() || null },
        requestedBy: actor.fullName,
        log: [event(actor.fullName, 'scheduled', `إنهاء بالتراضي بتاريخ ${dto.agreementDate} مع ${dto.charityRep.trim()}، والحذف في ${deleteOn}`)],
      }));
      await em.update(Organization, { id: orgId }, { isActive: false });
      // العقود غير الموقعة تُلغى، والموقعة تبقى في السجل حتى الحذف
      await em.query(`UPDATE subscription_contracts SET status = 'cancelled' WHERE organization_id = $1 AND status IN ('draft', 'sent', 'changes_requested')`, [orgId]);
      this.logger.warn(`Organization ${org.slug} terminated by mutual agreement by ${actor.fullName}; deletion on ${deleteOn}`);
      return c;
    });
  }

  /** إلغاء الإنهاء خلال المهلة: تعود الجمعية نشطة */
  async cancel(orgId: string, actor: AuthUser) {
    return this.db.transaction(async (em) => {
      const c = await em.findOne(OrganizationClosure, { where: { organizationId: orgId, status: 'scheduled' }, lock: { mode: 'pessimistic_write' } });
      if (!c) throw new NotFoundException('لا يوجد إنهاء مجدول لهذه الجمعية');
      c.status = 'cancelled';
      c.log = [...c.log, event(actor.fullName, 'cancelled')];
      await em.save(c);
      await em.update(Organization, { id: orgId }, { isActive: true });
      return c;
    });
  }

  /** الحذف الآن (مدير المنصة): لجمعية لها إنهاء مجدول أو انتهت تجربتها، بعد كتابة معرفها */
  async deleteNow(orgId: string, confirm: string, actor: AuthUser) {
    const org = await this.org(orgId);
    this.assertConfirm(org, confirm);
    const n = await deletionNotice(this.db, org);
    if (!n || n.reason === 'trial') throw new BadRequestException('الحذف متاح بعد إنهاء العقد بالتراضي أو بعد انتهاء الفترة التجريبية');
    return this.remove(org, actor.fullName);
  }

  /** تصدير بيانات الجمعية (ملف JSON) لتسليمه لها قبل الحذف */
  async export(orgId: string, actor: AuthUser) {
    const org = await this.org(orgId);
    const data = await exportOrganization(this.db.manager, orgId);
    await this.db.query(
      `UPDATE organization_closures SET log = log || $2::jsonb WHERE organization_id = $1 AND status = 'scheduled'`,
      [orgId, JSON.stringify([event(actor.fullName, 'exported')])]);
    this.logger.log(`Organization ${org.slug} exported by ${actor.fullName}`);
    return { org, json: JSON.stringify({ exportedAt: new Date().toISOString(), organization: { name: org.name, slug: org.slug }, tables: data }, null, 1) };
  }

  /** الحذف الفعلي: كل بيانات الجمعية، مع سجل دائم بلا بيانات من داخلها */
  private async remove(org: Organization, by: string) {
    const n = await deletionNotice(this.db, org);
    const deleted = await this.db.transaction(async (em) => {
      const count = await deleteOrganization(em, org.id);
      const scheduled = await em.findOne(OrganizationClosure, { where: { organizationId: org.id, status: 'scheduled' } });
      const note = `حُذف ${count} سجلًا`;
      if (scheduled) {
        Object.assign(scheduled, { status: 'deleted', deletedAt: new Date(), deletedRecords: count, log: [...scheduled.log, event(by, 'deleted', note)] });
        await em.save(scheduled);
      } else {
        await em.save(em.create(OrganizationClosure, {
          organizationId: org.id, orgName: org.name, orgSlug: org.slug, reason: 'trial_expired', status: 'deleted',
          deleteOn: n?.deleteOn ?? todayRiyadh(), agreement: null, requestedBy: by, deletedAt: new Date(), deletedRecords: count,
          log: [event(by, 'deleted', `انتهت الفترة التجريبية في ${org.trialEndsOn} دون تعاقد. ${note}`)],
        }));
      }
      return count;
    });
    this.logger.warn(`Organization ${org.slug} deleted (${n?.reason ?? 'manual'}) by ${by}: ${deleted} records`);
    return { deleted, organization: { name: org.name, slug: org.slug } };
  }

  /** الفحص الدوري: يحذف كل جمعية حلّ يوم حذفها */
  async sweep(today = todayRiyadh()) {
    const orgs = await this.db.getRepository(Organization).find();
    const done: string[] = [];
    for (const org of orgs) {
      const n = await deletionNotice(this.db, org, today);
      if (!n || n.reason === 'trial' || n.deleteOn > today) continue;
      try {
        await this.remove(org, 'الحذف التلقائي');
        done.push(org.slug);
      } catch (e) {
        this.logger.error(`Could not delete ${org.slug}: ${(e as Error).message}`);
      }
    }
    return done;
  }

  /**
   * قائمة المتابعة لمدير المنصة: جمعيات التجربة والإنهاءات المجدولة بموعد حذفها وأيامها المتبقية،
   * مع جوال المدير التنفيذي لإرسال التذكير، وسجل الجمعيات المحذوفة.
   */
  async overview() {
    const today = todayRiyadh();
    const orgs = await this.db.getRepository(Organization).find({ order: { name: 'ASC' } });
    const contacts: { organization_id: string; phone: string | null; name: string | null; org_phone: string | null }[] = await this.db.query(
      `SELECT DISTINCT ON (organization_id) organization_id, executive_director->>'phone' AS phone, executive_director->>'name' AS name, org_phone
         FROM subscription_applications WHERE organization_id IS NOT NULL ORDER BY organization_id, created_at DESC`);
    const contact = new Map(contacts.map((c) => [c.organization_id, c]));
    const upcoming = [];
    for (const org of orgs) {
      const n = await deletionNotice(this.db, org, today);
      if (!n) continue;
      const c = contact.get(org.id);
      upcoming.push({
        id: org.id, name: org.name, slug: org.slug, ...n,
        directorName: c?.name ?? null, phone: c?.phone || c?.org_phone || null,
      });
    }
    upcoming.sort((a, b) => a.deleteOn.localeCompare(b.deleteOn));
    const deleted = await this.db.getRepository(OrganizationClosure).find({ where: { status: 'deleted' }, order: { deletedAt: 'DESC' }, take: 100 });
    return { today, settings: await this.settings(), upcoming, deleted };
  }
}

