import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import * as bcrypt from 'bcryptjs';
import { DataSource, Repository } from 'typeorm';
import { Organization, OrganizationModule, User } from '../entities';
import { ModuleCatalogService } from '../modules/module-catalog.service';
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
    const rows: Array<Organization & { user_count: string; modules: string[] }> = await this.orgs
      .createQueryBuilder('o')
      .select(['o.id AS id', 'o.name AS name', 'o.slug AS slug', 'o.is_active AS "isActive"', 'o.created_at AS "createdAt"'])
      .addSelect('(SELECT count(*) FROM users u WHERE u.organization_id = o.id)::text', 'user_count')
      .addSelect(
        `COALESCE((SELECT array_agg(om.module_code ORDER BY om.module_code) FROM organization_modules om
          WHERE om.organization_id = o.id), '{}')`,
        'modules',
      )
      .orderBy('o.created_at', 'DESC')
      .getRawMany();
    return rows.map(({ user_count, ...o }) => ({ ...o, userCount: Number(user_count) }));
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

  private async get(id: string) {
    const row = (await this.list()).find((o) => o.id === id);
    if (!row) throw new NotFoundException('الجمعية غير موجودة');
    return row;
  }
}
