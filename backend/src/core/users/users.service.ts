import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import * as bcrypt from 'bcryptjs';
import { Repository } from 'typeorm';
import { OrgUser } from '../auth/decorators';
import { User } from '../entities';
import { RolesService } from '../roles/roles.service';
import { CreateUserDto, UpdateUserDto } from './users.dto';

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User) private readonly users: Repository<User>,
    private readonly roles: RolesService,
  ) {}

  async list(actor: OrgUser) {
    const users = await this.users.find({
      where: { organizationId: actor.organizationId },
      relations: { roles: true },
      order: { fullName: 'ASC' },
    });
    return users.map((u) => this.present(u));
  }

  async create(actor: OrgUser, dto: CreateUserDto) {
    if (dto.isSuperadmin && !actor.isSuperadmin) {
      throw new ForbiddenException('فقط مدير النظام يمكنه إنشاء مدير نظام');
    }
    const email = dto.email.trim().toLowerCase();
    await this.ensureUniqueEmail(email);
    const roles = await this.roles.loadForAssignment(actor, dto.roleIds);
    await this.roles.assertCanAssign(actor, roles);

    const user = await this.users.save(this.users.create({
      organizationId: actor.organizationId,
      fullName: dto.fullName.trim(),
      email,
      passwordHash: await bcrypt.hash(dto.password, 12),
      isActive: dto.isActive ?? true,
      isSuperadmin: dto.isSuperadmin ?? false,
      roles,
    }));
    return this.get(actor, user.id);
  }

  async update(actor: OrgUser, id: string, dto: UpdateUserDto) {
    const user = await this.find(actor, id);

    // تعديل مدير نظام أو منح/سحب صفة مدير النظام: لمدير النظام فقط
    if ((user.isSuperadmin || dto.isSuperadmin !== undefined) && !actor.isSuperadmin) {
      throw new ForbiddenException('فقط مدير النظام يمكنه تعديل حسابات مديري النظام');
    }
    if (id === actor.id && (dto.isActive === false || dto.isSuperadmin === false)) {
      throw new BadRequestException('لا يمكنك إيقاف حسابك أو سحب صلاحية مدير النظام من نفسك');
    }
    const losesAdmin =
      user.isSuperadmin && user.isActive && (dto.isActive === false || dto.isSuperadmin === false);
    if (losesAdmin && (await this.activeSuperadminCount(actor.organizationId)) <= 1) {
      throw new BadRequestException('يجب أن يبقى مدير نظام واحد نشط على الأقل');
    }

    if (dto.fullName !== undefined) user.fullName = dto.fullName.trim();
    if (dto.email !== undefined) {
      const email = dto.email.trim().toLowerCase();
      if (email !== user.email) await this.ensureUniqueEmail(email);
      user.email = email;
    }
    if (dto.password !== undefined) user.passwordHash = await bcrypt.hash(dto.password, 12);
    if (dto.isActive !== undefined) user.isActive = dto.isActive;
    if (dto.isSuperadmin !== undefined) user.isSuperadmin = dto.isSuperadmin;
    if (dto.roleIds !== undefined) {
      const roles = await this.roles.loadForAssignment(actor, dto.roleIds);
      const current = new Set(user.roles.map((r) => r.id));
      // لا يضيف أحد لنفسه دورًا جديدًا (ومنه دور تكليف مؤقت يريد جعله دائمًا)
      if (id === actor.id && !actor.isSuperadmin && roles.some((r) => !current.has(r.id))) {
        throw new ForbiddenException('لا يمكنك إضافة أدوار لنفسك؛ يضيفها مستخدم آخر');
      }
      await this.roles.assertCanAssign(actor, roles.filter((r) => !current.has(r.id)));
      user.roles = roles;
    }
    await this.users.save(user);
    return this.get(actor, id);
  }

  private async get(actor: OrgUser, id: string) {
    return this.present(await this.find(actor, id));
  }

  private async find(actor: OrgUser, id: string) {
    const user = await this.users.findOne({
      where: { id, organizationId: actor.organizationId },
      relations: { roles: true },
    });
    if (!user) throw new NotFoundException('المستخدم غير موجود');
    return user;
  }

  private async ensureUniqueEmail(email: string) {
    if (await this.users.exist({ where: { email } })) {
      throw new ConflictException('البريد الإلكتروني مستخدم بالفعل');
    }
  }

  private activeSuperadminCount(organizationId: string) {
    return this.users.count({ where: { organizationId, isSuperadmin: true, isActive: true } });
  }

  private present(u: User) {
    return {
      id: u.id,
      fullName: u.fullName,
      email: u.email,
      isActive: u.isActive,
      isSuperadmin: u.isSuperadmin,
      lastLoginAt: u.lastLoginAt,
      createdAt: u.createdAt,
      roles: u.roles.map((r) => ({ id: r.id, name: r.name })),
    };
  }
}
