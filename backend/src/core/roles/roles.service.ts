import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { OrgUser } from '../auth/decorators';
import { Permission, Role, User } from '../entities';
import { ModuleCatalogService } from '../modules/module-catalog.service';
import { CORE_PERMISSIONS } from '../core.manifest';
import { CreateRoleDto, UpdateRoleDto } from './roles.dto';

@Injectable()
export class RolesService {
  constructor(
    @InjectRepository(Role) private readonly roles: Repository<Role>,
    @InjectRepository(User) private readonly users: Repository<User>,
    private readonly catalog: ModuleCatalogService,
  ) {}

  async list(actor: OrgUser) {
    const roles = await this.roles.find({
      where: { organizationId: actor.organizationId },
      relations: { permissions: true },
      order: { name: 'ASC' },
    });
    const counts: { role_id: string; count: string }[] = await this.roles.manager.query(
      `SELECT ur.role_id, count(*)::text AS count FROM user_roles ur
       JOIN roles r ON r.id = ur.role_id WHERE r.organization_id = $1 GROUP BY ur.role_id`,
      [actor.organizationId],
    );
    const countMap = new Map(counts.map((c) => [c.role_id, Number(c.count)]));
    return roles.map((r) => this.present(r, countMap.get(r.id) ?? 0));
  }

  async create(actor: OrgUser, dto: CreateRoleDto) {
    await this.checkPermissions(actor, dto.permissions);
    await this.ensureUniqueName(actor.organizationId, dto.name);
    const role = await this.roles.save(this.roles.create({
      organizationId: actor.organizationId,
      name: dto.name.trim(),
      description: dto.description?.trim() || null,
      permissions: dto.permissions.map((code) => ({ code }) as Permission),
    }));
    return this.get(actor, role.id);
  }

  async update(actor: OrgUser, id: string, dto: UpdateRoleDto) {
    const role = await this.find(actor, id);
    if (dto.name !== undefined && dto.name.trim() !== role.name) {
      await this.ensureUniqueName(actor.organizationId, dto.name);
      role.name = dto.name.trim();
    }
    if (dto.description !== undefined) role.description = dto.description.trim() || null;
    if (dto.permissions !== undefined) {
      // نتحقق فقط من الصلاحيات المضافة؛ إزالة صلاحية لا تمنح أحدًا شيئًا جديدًا
      const current = new Set(role.permissions.map((p) => p.code));
      await this.checkPermissions(actor, dto.permissions.filter((c) => !current.has(c)));
      role.permissions = dto.permissions.map((code) => ({ code }) as Permission);
    }
    await this.roles.save(role);
    return this.get(actor, id);
  }

  async remove(actor: OrgUser, id: string) {
    const role = await this.find(actor, id);
    if (!actor.isSuperadmin) await this.assertCanAssign(actor, [role]);
    await this.roles.remove(role);
  }

  // ---- صلاحيات وحدة واحدة (من داخل إعدادات الوحدة) ----

  /** يتأكد إن الوحدة مفعلة للجمعية وإن المستخدم يملك إعداداتها أو صلاحيات الأدوار العامة */
  private async moduleFor(actor: OrgUser, code: string, write: boolean) {
    const m = this.catalog.manifest(code);
    const enabled = await this.catalog.enabledModuleCodes(actor.organizationId);
    if (!m || !m.settingsPermission || !enabled.has(code)) throw new NotFoundException('الوحدة غير موجودة');
    const general = write ? CORE_PERMISSIONS.rolesManage : CORE_PERMISSIONS.rolesRead;
    if (!actor.isSuperadmin && !actor.permissions.includes(m.settingsPermission) && !actor.permissions.includes(general)) {
      throw new ForbiddenException('لا تملك صلاحية إعدادات هذه الوحدة');
    }
    return { manifest: m, codes: new Set(m.permissions.map((p) => p.code)) };
  }

  async moduleRoles(actor: OrgUser, code: string) {
    const { manifest, codes } = await this.moduleFor(actor, code, false);
    const all = await this.list(actor);
    return {
      module: { code: manifest.code, name: manifest.name, permissions: manifest.permissions },
      roles: all.map((r) => ({ ...r, permissions: r.permissions.filter((c) => codes.has(c)) })),
    };
  }

  async createForModule(actor: OrgUser, code: string, dto: CreateRoleDto) {
    const { codes } = await this.moduleFor(actor, code, true);
    const outside = dto.permissions.filter((c) => !codes.has(c));
    if (outside.length) throw new BadRequestException(`صلاحيات من خارج الوحدة: ${outside.join(', ')}`);
    await this.create(actor, dto);
    return this.moduleRoles(actor, code);
  }

  /** يستبدل صلاحيات هذه الوحدة فقط في الدور، ويحافظ على صلاحيات الوحدات الأخرى */
  async setModulePermissions(actor: OrgUser, id: string, code: string, permissions: string[]) {
    const { codes } = await this.moduleFor(actor, code, true);
    const outside = permissions.filter((c) => !codes.has(c));
    if (outside.length) throw new BadRequestException(`صلاحيات من خارج الوحدة: ${outside.join(', ')}`);
    const role = await this.find(actor, id);
    const current = new Set(role.permissions.map((p) => p.code));
    await this.checkPermissions(actor, permissions.filter((c) => !current.has(c)));
    const kept = role.permissions.map((p) => p.code).filter((c) => !codes.has(c));
    role.permissions = [...kept, ...permissions].map((c) => ({ code: c }) as Permission);
    await this.roles.save(role);
    return this.moduleRoles(actor, code);
  }

  private async get(actor: OrgUser, id: string) {
    const role = await this.find(actor, id);
    const count = await this.users.count({ where: { roles: { id } } });
    return this.present(role, count);
  }

  private async find(actor: OrgUser, id: string) {
    const role = await this.roles.findOne({
      where: { id, organizationId: actor.organizationId },
      relations: { permissions: true },
    });
    if (!role) throw new NotFoundException('الدور غير موجود');
    return role;
  }

  private present(r: Role, userCount: number) {
    return {
      id: r.id,
      name: r.name,
      description: r.description,
      permissions: r.permissions.map((p) => p.code).sort(),
      userCount,
    };
  }

  private async ensureUniqueName(organizationId: string, name: string) {
    const exists = await this.roles.exist({ where: { organizationId, name: name.trim() } });
    if (exists) throw new ConflictException('يوجد دور بنفس الاسم');
  }

  /**
   * يمنع تصعيد الصلاحيات: المستخدم العادي لا يستطيع منح صلاحية لا يملكها هو.
   * مدير النظام يمنح أي صلاحية.
   */
  private async checkPermissions(actor: OrgUser, codes: string[]) {
    const enabled = await this.catalog.enabledModuleCodes(actor.organizationId);
    const allowed = new Set(this.catalog.permissionCodes('organization', enabled));
    const unknown = codes.filter((c) => !allowed.has(c));
    if (unknown.length) {
      throw new BadRequestException(`صلاحيات غير معروفة أو لوحدة غير مفعلة: ${unknown.join(', ')}`);
    }
    if (actor.isSuperadmin) return;
    const own = new Set(actor.permissions);
    const missing = codes.filter((c) => !own.has(c));
    if (missing.length) {
      throw new ForbiddenException(`لا يمكنك منح صلاحيات لا تملكها: ${missing.join(', ')}`);
    }
  }

  /** يُستخدم من خدمة المستخدمين عند إسناد أدوار */
  async loadForAssignment(actor: OrgUser, roleIds: string[]) {
    if (!roleIds.length) return [];
    const roles = await this.roles.find({
      where: { id: In(roleIds), organizationId: actor.organizationId },
      relations: { permissions: true },
    });
    if (roles.length !== new Set(roleIds).size) throw new BadRequestException('دور غير موجود');
    return roles;
  }

  async assertCanAssign(actor: OrgUser, roles: Role[]) {
    if (actor.isSuperadmin) return;
    // صلاحيات وحدات غير مفعلة في الدور لا تمنح شيئًا، فلا تُحسب هنا
    const enabled = await this.catalog.enabledModuleCodes(actor.organizationId);
    const active = new Set(this.catalog.permissionCodes('organization', enabled));
    await this.checkPermissions(actor, roles.flatMap((r) => r.permissions.map((p) => p.code)).filter((c) => active.has(c)));
  }
}
