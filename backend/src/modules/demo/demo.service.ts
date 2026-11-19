import { ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { DataSource, EntityManager } from 'typeorm';
import { AuthUser } from '../../core/auth/decorators';
import { Organization } from '../../core/entities';
import { FileStore } from '../../core/files/file-store.service';
import { DEMO_SLUG } from './demo-context';
import { AccountingSeed } from './seed-accounting';
import { AssetsSeed } from './seed-assets';
import { AuditSeed } from './seed-audit';
import { BeneficiariesSeed } from './seed-beneficiaries';
import { FinanceSeed } from './seed-finance';
import { GovernanceSeed } from './seed-governance';
import { HrSeed } from './seed-hr';
import { MembersSeed } from './seed-members';
import { PlatformSeed } from './seed-platform';
import { ProjectsSeed } from './seed-projects';
import { RiskSeed } from './seed-risk';
import { QualitySeed } from './seed-quality';
import { SupportSeed } from './seed-support';
import { VolunteersSeed } from './seed-volunteers';
import { WebsiteSeed } from './seed-website';
import { PartnershipsSeed } from './seed-partnerships';
import { CommsSeed } from './seed-comms';
import { MeetingsSeed } from './seed-meetings';

/**
 * الجمعية التجريبية الكاملة للشرح والاختبار: كل الأنظمة مترابطة، وكل العمليات تمر عبر خدمات الوحدات
 * نفسها (بنفس التحقق والترقيم والقيود)، وتُسجَّل بأسماء الموظفين حسب أدوارهم.
 */
@Injectable()
export class DemoService {
  private readonly logger = new Logger('Demo');

  constructor(
    private readonly db: DataSource,
    private readonly files: FileStore,
    private readonly beneficiaries: BeneficiariesSeed,
    private readonly projects: ProjectsSeed,
    private readonly finance: FinanceSeed,
    private readonly platform: PlatformSeed,
    private readonly accounting: AccountingSeed,
    private readonly assets: AssetsSeed,
    private readonly support: SupportSeed,
    private readonly hr: HrSeed,
    private readonly risk: RiskSeed,
    private readonly volunteers: VolunteersSeed,
    private readonly quality: QualitySeed,
    private readonly audit: AuditSeed,
    private readonly members: MembersSeed,
    private readonly website: WebsiteSeed,
    private readonly governance: GovernanceSeed,
    private readonly partnerships: PartnershipsSeed,
    private readonly comms: CommsSeed,
    private readonly meetings: MeetingsSeed,
  ) {}

  async create(platformUser: AuthUser, origin: string) {
    if (await this.db.getRepository(Organization).exists({ where: { slug: DEMO_SLUG } })) {
      throw new ConflictException('الجمعية التجريبية موجودة بالفعل (المعرّف demo)');
    }
    const staffPassword = `Demo-${randomBytes(4).toString('hex')}`;
    const portalPassword = `Portal-${randomBytes(3).toString('hex')}`;
    const org = await this.db.getRepository(Organization).save({ name: 'جمعية سنابل الخير (تجريبية)', slug: DEMO_SLUG });
    try {
      const { team, tree, accounts } = await this.db.transaction((em) => this.beneficiaries.setup(em, org.id, staffPassword));
      const extra = await this.projects.run(team, tree);
      const cases = await this.beneficiaries.cases(org.id, team, tree, portalPassword);
      await this.finance.run(team, tree, extra, cases);
      await this.accounting.run(team);
      await this.hr.run(team);
      await this.assets.run(team);
      await this.accounting.closeMonths(team);
      await this.risk.run(team);
      await this.volunteers.run(team);
      await this.quality.run(team);
      // المراجعة الداخلية بعد الموارد البشرية (تعتمد على الهيكل التنظيمي)
      const auditor = await this.audit.run(team, staffPassword);
      await this.members.run(team);
      // الشراكات قبل الموقع: الشركاء المعتمدون يظهرون في صفحة الشركاء
      await this.partnerships.run(team);
      // الاتصالات الإدارية والمهام، ثم الاجتماعات (الجمعية العمومية من أعضاء العضوية، والتوصيات تتحول إلى مهام)
      const commsTeam = await this.comms.grant(team);
      await this.comms.run(commsTeam);
      await this.meetings.run(commsTeam, staffPassword, origin);
      // الهوية وأرشيف المعرفة والموقع الإلكتروني (التبرعات تُنشئ سندات قبض في النظام المالي)
      await this.website.run(team, tree, origin);
      // الحوكمة أخيراً: تقرأ إشاراتها من كل الأنظمة السابقة
      await this.governance.run(team);
      await this.platform.run(org, platformUser, origin);
      // فريق الدعم الفني يدخل من صفحة دخول المنصة بنفس كلمة مرور الموظفين
      const supportTeam = await this.support.run(team, staffPassword);
      return {
        organization: { name: org.name, slug: org.slug },
        staffPassword,
        staff: [...accounts, auditor],
        portalPassword,
        portalUsers: cases.portalUsers,
        supportTeam,
      };
    } catch (e) {
      this.logger.error(`Demo seeding failed: ${(e as Error).message}`, (e as Error).stack);
      await this.remove().catch((err) => this.logger.error(`Demo cleanup failed: ${(err as Error).message}`));
      throw e;
    }
  }

  /** حذف الجمعية التجريبية وكل بياناتها وطلبات الاشتراك التجريبية، لإعادة إنشائها بأحدث بيانات */
  async reset() {
    const org = await this.db.getRepository(Organization).findOne({ where: { slug: DEMO_SLUG } });
    if (!org) throw new NotFoundException('لا توجد جمعية تجريبية');
    await this.remove();
  }

  private async remove() {
    const keys: string[] = await this.db.transaction(async (em) => {
      const [org] = await em.query('SELECT id FROM organizations WHERE slug = $1', [DEMO_SLUG]);
      const apps: { license_file_key: string }[] = await em.query(
        `DELETE FROM subscription_applications WHERE organization_id = $1 OR admin_email LIKE 'demo-%@sanabelerp.com' RETURNING license_file_key`,
        [org?.id ?? null]);
      if (org) await this.purge(em, org.id);
      return apps.map((a) => a.license_file_key);
    });
    await Promise.all(keys.map((k) => this.files.remove(k).catch(() => undefined)));
  }

  /**
   * حذف كل بيانات الجمعية من كل الجداول. بعض العلاقات بين الجداول تمنع الحذف المنفرد عمدًا
   * (مثل حذف مستفيد له طلبات)، فيُحذف كل جدول بعد الجداول المعتمدة عليه، بالمحاولة المتكررة.
   */
  private async purge(em: EntityManager, orgId: string) {
    let tables: string[] = (await em.query(
      `SELECT table_name FROM information_schema.columns WHERE table_schema = 'public' AND column_name = 'organization_id' ORDER BY table_name`,
    )).map((r: { table_name: string }) => r.table_name);
    while (tables.length) {
      const failed: string[] = [];
      for (const t of tables) {
        await em.query('SAVEPOINT demo_purge');
        try {
          await em.query(`DELETE FROM "${t}" WHERE organization_id = $1`, [orgId]);
          await em.query('RELEASE SAVEPOINT demo_purge');
        } catch {
          await em.query('ROLLBACK TO SAVEPOINT demo_purge');
          failed.push(t);
        }
      }
      if (failed.length === tables.length) throw new ConflictException(`تعذر حذف بيانات الجمعية التجريبية من: ${failed.join('، ')}`);
      tables = failed;
    }
    await em.query('DELETE FROM organizations WHERE id = $1', [orgId]);
  }
}
