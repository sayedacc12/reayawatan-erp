import { PLATFORM_ROLE_PERMISSIONS } from '../support/support.manifest';
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { Role, User } from '../entities';
import { ModuleCatalogService } from '../modules/module-catalog.service';
import { accessProblem } from '../organizations/org-access';
import { AuthUser } from './decorators';

/**
 * يحسب صلاحيات المستخدم الفعلية:
 * - مدير المنصة: صلاحيات وحدات المنصة فقط (لا يرى بيانات الجمعيات)
 * - مدير نظام الشركة: كل صلاحيات وحدات الشركة
 * - باقي المستخدمين: اتحاد صلاحيات أدوارهم الدائمة وأدوار تكليفاتهم السارية اليوم
 * ويرفض المستخدم الموقوف أو التابع لجمعية موقوفة.
 */
@Injectable()
export class PermissionResolver {
  constructor(
    @InjectRepository(User) private readonly users: Repository<User>,
    @InjectRepository(Role) private readonly roles: Repository<Role>,
    private readonly catalog: ModuleCatalogService,
  ) {}

  async resolve(userId: string): Promise<AuthUser | null> {
    const user = await this.users.findOne({
      where: { id: userId },
      relations: { roles: { permissions: true }, organization: true },
    });
    if (!user || !user.isActive) return null;
    // الشركة الموقوفة أو المنتهية فترتها التجريبية أو اشتراكها تمنع كل مستخدميها
    if (!user.isPlatformAdmin && (!user.organization || accessProblem(user.organization))) return null;

    let codes: string[];
    if (user.isPlatformAdmin) {
      const all = this.catalog.permissionCodes('platform');
      // فريق الدعم يرى تطبيق الدعم الفني فقط حسب دوره
      codes = user.platformRole ? all.filter((c) => PLATFORM_ROLE_PERMISSIONS[user.platformRole!]?.includes(c)) : all;
    } else {
      // صلاحيات الوحدات غير المفعلة للشركة لا تُحسب حتى لو موجودة في الأدوار
      const enabled = await this.catalog.enabledModuleCodes(user.organizationId!);
      // وصلاحيات الشاشات غير المسموحة للشركة تُسحب كذلك
      const orgCodes = this.catalog.permissionCodes('organization', enabled, user.organization!.allowedScreens);
      codes = user.isSuperadmin ? orgCodes : this.fromRoles([...user.roles, ...(await this.assigned(user))], new Set(orgCodes));
    }
    return {
      id: user.id,
      organizationId: user.organizationId,
      organizationName: user.organization?.name ?? null,
      organizationSlug: user.organization?.slug ?? null,
      email: user.email,
      username: user.username,
      fullName: user.fullName,
      isSuperadmin: user.isSuperadmin,
      isPlatformAdmin: user.isPlatformAdmin,
      permissions: codes.sort(),
      mustChangePassword: user.mustChangePassword,
      sessionsValidAfter: user.sessionsValidAfter,
      allowedScreens: user.isPlatformAdmin ? null : user.organization!.allowedScreens,
    };
  }

  /** أدوار التكليفات السارية اليوم (تسقط تلقائيًا بعد تاريخ نهايتها) */
  private async assigned(user: User): Promise<Role[]> {
    const rows: { role_id: string }[] = await this.users.manager.query(
      `SELECT role_id FROM effective_user_roles WHERE user_id = $1`, [user.id]);
    const own = new Set(user.roles.map((r) => r.id));
    const extra = rows.map((r) => r.role_id).filter((id) => !own.has(id));
    if (!extra.length) return [];
    return this.roles.find({ where: { id: In(extra), organizationId: user.organizationId! }, relations: { permissions: true } });
  }

  private fromRoles(roles: Role[], allowed: Set<string>) {
    const codes = new Set(roles.flatMap((r) => r.permissions.map((p) => p.code)));
    return [...codes].filter((c) => allowed.has(c));
  }
}
