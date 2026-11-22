import { ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { DataSource, EntityManager } from 'typeorm';
import { AuthUser } from '../../core/auth/decorators';
import { Organization } from '../../core/entities';
import { FileStore } from '../../core/files/file-store.service';
import { deleteOrganization } from '../../core/lifecycle/org-data';
import { DEMO_EMAIL, DEMO_SLUG, SeedTarget } from './demo-context';
import { AccountingSeed } from './seed-accounting';
import { AssetsSeed } from './seed-assets';
import { AuditSeed } from './seed-audit';
import { GovernanceSeed } from './seed-governance';
import { HrSeed } from './seed-hr';
import { MembersSeed } from './seed-members';
import { PlatformSeed } from './seed-platform';
import { TeamSeed } from './seed-team';
import { RiskSeed } from './seed-risk';
import { QualitySeed } from './seed-quality';
import { SupportSeed } from './seed-support';
import { VolunteersSeed } from './seed-volunteers';
import { WebsiteSeed } from './seed-website';
import { PartnershipsSeed } from './seed-partnerships';
import { ProcurementSeed } from './seed-procurement';
import { SourcingSeed } from './seed-sourcing';
import { InvoicesSeed } from './seed-invoices';
import { ContractsSeed } from './seed-contracts';
import { BillingSeed } from './seed-billing';
import { StockSeed } from './seed-stock';
import { CommsSeed } from './seed-comms';
import { MeetingsSeed } from './seed-meetings';
import { PlanningSeed } from './seed-planning';
import { BudgetSeed } from './seed-budget';

/**
 * الشركة التجريبية الكاملة للشرح والاختبار: كل الأنظمة مترابطة، وكل العمليات تمر عبر خدمات الوحدات
 * نفسها (بنفس التحقق والترقيم والقيود)، وتُسجَّل بأسماء الموظفين حسب أدوارهم.
 */
@Injectable()
export class DemoService {
  private readonly logger = new Logger('Demo');

  constructor(
    private readonly db: DataSource,
    private readonly files: FileStore,
    private readonly teamSeed: TeamSeed,
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
    private readonly planning: PlanningSeed,
    private readonly budget: BudgetSeed,
    private readonly procurement: ProcurementSeed,
    private readonly sourcing: SourcingSeed,
    private readonly stockSeed: StockSeed,
    private readonly invoicesSeed: InvoicesSeed,
    private readonly contractsSeed: ContractsSeed,
    private readonly billingSeed: BillingSeed,
  ) {}

  async create(platformUser: AuthUser, origin: string) {
    if (await this.db.getRepository(Organization).exists({ where: { slug: DEMO_SLUG } })) {
      throw new ConflictException('الشركة التجريبية موجودة بالفعل (المعرّف demo)');
    }
    const staffPassword = `Demo-${randomBytes(4).toString('hex')}`;
    const portalPassword = `Portal-${randomBytes(3).toString('hex')}`;
    const org = await this.db.getRepository(Organization).save({ name: 'منشأة تجريبية', slug: DEMO_SLUG });
    try {
      const built = await this.build(org.id, { slug: DEMO_SLUG, email: DEMO_EMAIL }, staffPassword, portalPassword, origin);
      await this.platform.run(org, platformUser, origin);
      // فريق الدعم الفني يدخل من صفحة دخول المنصة بنفس كلمة مرور الموظفين
      const supportTeam = await this.support.run(built.team, staffPassword);
      return {
        organization: { name: org.name, slug: org.slug },
        staffPassword,
        staff: built.staff,
        portalPassword,
        portalUsers: built.portalUsers,
        supplierPortal: built.supplierPortal,
        supportTeam,
      };
    } catch (e) {
      this.logger.error(`Demo seeding failed: ${(e as Error).message}`, (e as Error).stack);
      await this.remove().catch((err) => this.logger.error(`Demo cleanup failed: ${(err as Error).message}`));
      throw e;
    }
  }

  /**
   * بناء البيانات المترابطة لكل الأنظمة داخل جمعية: تُستخدم للشركة التجريبية الكاملة (demo)،
   * ولزر «إضافة بيانات تجريبية» في جمعية مشتركة خلال فترة التجربة (بلا بيانات المنصة والدعم الفني).
   */
  async build(orgId: string, target: SeedTarget, staffPassword: string, portalPassword: string, origin: string) {
    const { team, accounts } = await this.db.transaction((em) => this.teamSeed.setup(em, orgId, staffPassword, target));
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
    // المشتريات والمستودعات بعد المالي والأصول (الحسابات ومجموعات الأصول) والمشاريع (المستودع الميداني)
    const supplierPortal = await this.procurement.run(team, portalPassword);
    // الاتصالات الإدارية والمهام، ثم الاجتماعات (الجمعية العمومية من أعضاء العضوية، والتوصيات تتحول إلى مهام)
    const commsTeam = await this.comms.grant(team);
    await this.comms.run(commsTeam);
    await this.meetings.run(commsTeam, staffPassword, origin, target.admin ? [target.admin.id] : []);
    // الهوية وأرشيف المعرفة والموقع الإلكتروني (التبرعات تُنشئ سندات قبض في النظام المالي)
    await this.website.run(team);
    // التخطيط بعد الأنظمة التي يربط بها (الهيكل التنظيمي والمشاريع والموازنة الرأسمالية)
    const planning = await this.planning.run(team);
    await this.budget.run(team, planning.strategic);
    // دورة الشراء بعد الموازنة: التعميد يحجز من بنودها ومن مصادر التمويل
    await this.sourcing.run(team);
    // المستودعات بعد دورة الشراء: الاستلام على التعميد المقبول، والصرف والتحويل والإتلاف والجرد
    await this.stockSeed.run(team);
    // فواتير الموردين بعد الاستلام: المطابقة الثلاثية والمستحق في المالي والسداد
    await this.invoicesSeed.run(team);
    // العقود وتقييم الموردين بعد الفواتير: التقييم يقرأ التوريد والفحص والمطابقة
    await this.contractsSeed.run(team);
    // الفوترة والمبيعات بعد المالي: فواتير العملاء وقيودها وتحصيلها بسندات القبض
    await this.billingSeed.run(team);
    // الحوكمة أخيراً: تقرأ إشاراتها من كل الأنظمة السابقة
    await this.governance.run(team);
    return { team, staff: [...accounts, auditor], portalUsers: [] as { fullName: string; nationalId: string }[], supplierPortal };
  }

  /** حذف الشركة التجريبية وكل بياناتها وطلبات الاشتراك التجريبية، لإعادة إنشائها بأحدث بيانات */
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

  private async purge(em: EntityManager, orgId: string) {
    await deleteOrganization(em, orgId);
  }
}
