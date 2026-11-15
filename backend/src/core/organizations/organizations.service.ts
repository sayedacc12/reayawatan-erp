import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import * as bcrypt from 'bcryptjs';
import { DataSource, Repository } from 'typeorm';
import { Organization, OrganizationModule, User } from '../entities';
import { ModuleCatalogService } from '../modules/module-catalog.service';
import { SubscriptionDto } from '../subscriptions/subscriptions.dto';
import { effectiveState, todayRiyadh } from './org-access';
import { CreateOrganizationDto, UpdateOrganizationDto } from './organizations.dto';

/** إدارة الجمعيات المشتركة في المنصة (لمدير المنصة). */
@Injectable()
export class OrganizationsService {
  constructor(
    private readonly db: DataSource,
    @InjectRepository(Organization) private readonly orgs: Repository<Organization>,
    private readonly catalog: ModuleCatalogService,
  ) {}

  /** الوحدات الاختيارية المتاحة للتفعيل (مثل الموقع ومنصة التبرعات مستقبلًا) */
  optionalModules() {
    return this.catalog.optionalModules();
  }

  async setModules(id: string, modules: string[]) {
    const bad = modules.filter((m) => !this.catalog.isOptionalModule(m));
    if (bad.length) throw new BadRequestException(`وحدات غير قابلة للتفعيل: ${bad.join(', ')}`);
    await this.db.transaction(async (em) => {
      if (!(await em.exists(Organization, { where: { id } }))) throw new NotFoundException('الجمعية غير موجودة');
      await em.delete(OrganizationModule, { organizationId: id });
      if (modules.length) {
        await em.insert(OrganizationModule, modules.map((moduleCode) => ({ organizationId: id, moduleCode })));
      }
    });
    return this.get(id);
  }

  async list() {
    const rows: Array<Organization & { user_count: string; modules: string[]; hasProfile: boolean; contractStatus: string | null }> = await this.orgs
      .createQueryBuilder('o')
      .select(['o.id AS id', 'o.name AS name', 'o.slug AS slug', 'o.is_active AS "isActive"', 'o.created_at AS "createdAt"',
        'o.allowed_screens AS "allowedScreens"', 'o.subscription_status AS "subscriptionStatus"', 'o.trial_ends_on::text AS "trialEndsOn"',
        'o.subscription_starts_on::text AS "subscriptionStartsOn"', 'o.subscription_ends_on::text AS "subscriptionEndsOn"',
        'o.subscription_price AS "subscriptionPrice"', 'o.billing_cycle AS "billingCycle"'])
      .addSelect('EXISTS (SELECT 1 FROM subscription_applications a WHERE a.organization_id = o.id)', 'hasProfile')
      .addSelect(
        `(SELECT c.status FROM subscription_contracts c WHERE c.organization_id = o.id AND c.status <> 'cancelled'
          ORDER BY c.created_at DESC LIMIT 1)`,
        'contractStatus',
      )
      .addSelect('(SELECT count(*) FROM users u WHERE u.organization_id = o.id)::text', 'user_count')
      .addSelect(
        `COALESCE((SELECT array_agg(om.module_code ORDER BY om.module_code) FROM organization_modules om
          WHERE om.organization_id = o.id), '{}')`,
        'modules',
      )
      .orderBy('o.created_at', 'DESC')
      .getRawMany();
    const today = todayRiyadh();
    return rows.map(({ user_count, ...o }) => ({
      ...o,
      userCount: Number(user_count),
      subscriptionPrice: o.subscriptionPrice === null ? null : Number(o.subscriptionPrice),
      state: effectiveState(o, today),
    }));
  }

  /** ينشئ الجمعية ومدير نظامها في معاملة واحدة */
  async create(dto: CreateOrganizationDto) {
    const email = dto.adminEmail.trim().toLowerCase();
    const id = await this.db.transaction(async (em) => {
      if (await em.exists(Organization, { where: { slug: dto.slug } })) {
        throw new ConflictException('معرف الجمعية مستخدم بالفعل');
      }
      if (await em.exists(User, { where: { email } })) {
        throw new ConflictException('بريد مدير الجمعية مستخدم بالفعل');
      }
      const org = await em.save(em.create(Organization, { name: dto.name.trim(), slug: dto.slug }));
      await em.save(em.create(User, {
        organizationId: org.id,
        fullName: dto.adminFullName.trim(),
        email,
        passwordHash: await bcrypt.hash(dto.adminPassword, 12),
        isSuperadmin: true,
      }));
      return org.id;
    });
    return this.get(id);
  }

  async update(id: string, dto: UpdateOrganizationDto) {
    const org = await this.orgs.findOne({ where: { id } });
    if (!org) throw new NotFoundException('الجمعية غير موجودة');
    if (dto.name !== undefined) org.name = dto.name.trim();
    if (dto.isActive !== undefined) org.isActive = dto.isActive;
    await this.orgs.save(org);
    return this.get(id);
  }

  /** الشاشات المسموحة للجمعية والخدمات الاختيارية المفعلة لها */
  async setAccess(id: string, screens: string[] | null, modules: string[]) {
    await this.setModules(id, modules);
    await this.orgs.update(id, { allowedScreens: screens });
    return this.get(id);
  }

  /** تعديل يدوي لحالة الاشتراك (تمديد التجربة، تفعيل، ...) */
  async setSubscription(id: string, dto: SubscriptionDto) {
    const org = await this.orgs.findOne({ where: { id } });
    if (!org) throw new NotFoundException('الجمعية غير موجودة');
    if (dto.status === 'trial' && !dto.trialEndsOn) throw new BadRequestException('حدد آخر يوم في الفترة التجريبية');
    if (dto.startsOn && dto.endsOn && dto.endsOn < dto.startsOn) throw new BadRequestException('نهاية الاشتراك قبل بدايته');
    org.subscriptionStatus = dto.status;
    if (dto.trialEndsOn !== undefined) org.trialEndsOn = dto.trialEndsOn;
    if (dto.startsOn !== undefined) org.subscriptionStartsOn = dto.startsOn;
    if (dto.endsOn !== undefined) org.subscriptionEndsOn = dto.endsOn;
    await this.orgs.save(org);
    return this.get(id);
  }

  async get(id: string) {
    const row = (await this.list()).find((o) => o.id === id);
    if (!row) throw new NotFoundException('الجمعية غير موجودة');
    return row;
  }
}
