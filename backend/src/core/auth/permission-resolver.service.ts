import { PLATFORM_ROLE_PERMISSIONS } from '../support/support.manifest';
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '../entities';
import { ModuleCatalogService } from '../modules/module-catalog.service';
import { accessProblem } from '../organizations/org-access';
import { AuthUser } from './decorators';

/**
 * يحسب صلاحيات المستخدم الفعلية:
 * - مدير المنصة: صلاحيات وحدات المنصة فقط (لا يرى بيانات الجمعيات)
 * - مدير نظام الشركة: كل صلاحيات وحدات الشركة
 * - باقي المستخدمين: اتحاد صلاحيات أدوارهم
 * ويرفض المستخدم الموقوف أو التابع لجمعية موقوفة.
 */
@Injectable()
export class PermissionResolver {
  constructor(
    @InjectRepository(User) private readonly users: Repository<User>,
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
      codes = user.isSuperadmin ? orgCodes : this.fromRoles(user, new Set(orgCodes));
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

  private fromRoles(user: User, allowed: Set<string>) {
    const codes = new Set(user.roles.flatMap((r) => r.permissions.map((p) => p.code)));
    return [...codes].filter((c) => allowed.has(c));
  }
}
