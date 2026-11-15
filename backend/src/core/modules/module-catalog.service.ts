import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { DataSource, In, Not } from 'typeorm';
import { ErpModuleManifest } from '../../platform/erp-module';
import { INSTALLED_MODULES, validateManifests } from '../../platform/module-registry';
import { ErpModule, OrganizationModule, Permission } from '../entities';

type Scope = 'organization' | 'platform';
const scopeOf = (m: ErpModuleManifest): Scope => m.scope ?? 'organization';

/**
 * يقرأ manifests الوحدات المثبتة ويزامنها مع جداول erp_modules و permissions
 * عند كل تشغيل، ويحدد الوحدات المفعلة لكل جمعية، ويقدم للواجهة قائمة التطبيقات.
 */
@Injectable()
export class ModuleCatalogService implements OnApplicationBootstrap {
  private readonly logger = new Logger(ModuleCatalogService.name);
  private readonly manifests: ErpModuleManifest[];

  constructor(private readonly db: DataSource) {
    validateManifests(INSTALLED_MODULES);
    this.manifests = [...INSTALLED_MODULES].sort(
      (a, b) => (a.sequence ?? 100) - (b.sequence ?? 100),
    );
  }

  async onApplicationBootstrap() {
    await this.sync();
  }

  async sync() {
    await this.db.transaction(async (em) => {
      for (const m of this.manifests) {
        await em.upsert(
          ErpModule,
          {
            code: m.code, name: m.name, description: m.description ?? null,
            icon: m.icon ?? null, version: m.version, sequence: m.sequence ?? 100,
          },
          ['code'],
        );
        await em.upsert(
          Permission,
          m.permissions.map((p) => ({ code: p.code, moduleCode: m.code, name: p.name })),
          ['code'],
        );
      }
      // صلاحيات حُذفت من الكود تُحذف من القاعدة (وتُسحب من الأدوار تلقائيًا)
      const allCodes = this.manifests.flatMap((m) => m.permissions.map((p) => p.code));
      await em.delete(Permission, { code: Not(In(allCodes)) });
      await em.delete(ErpModule, { code: Not(In(this.manifests.map((m) => m.code))) });
    });
    this.logger.log(`Modules synced: ${this.manifests.map((m) => m.code).join(', ')}`);
  }

  /** الوحدات الاختيارية التي يمكن لمدير المنصة تفعيلها لكل جمعية */
  optionalModules() {
    return this.manifests
      .filter((m) => scopeOf(m) === 'organization' && !m.alwaysEnabled)
      .map(({ code, name, description, icon }) => ({ code, name, description, icon }));
  }

  isOptionalModule(code: string) {
    return this.optionalModules().some((m) => m.code === code);
  }

  /** أكواد وحدات الجمعية المفعلة لها: الأساسية دائمًا + الاختيارية المفعلة */
  async enabledModuleCodes(organizationId: string): Promise<Set<string>> {
    const rows = await this.db.getRepository(OrganizationModule).find({
      where: { organizationId },
      select: { moduleCode: true },
    });
    const enabled = new Set(rows.map((r) => r.moduleCode));
    return new Set(
      this.manifests
        .filter((m) => scopeOf(m) === 'organization' && (m.alwaysEnabled || enabled.has(m.code)))
        .map((m) => m.code),
    );
  }

  /** وحدات الجمعية المفعلة بصلاحياتها (لشاشة مصفوفة الصلاحيات) */
  async organizationModules(organizationId: string) {
    const enabled = await this.enabledModuleCodes(organizationId);
    return this.manifests
      .filter((m) => enabled.has(m.code))
      .map(({ code, name, description, icon, permissions, settingsPermission, menu }) => ({
        code, name, description, icon, permissions,
        // الوحدات اللي ليها شاشة إعدادات بتدير صلاحياتها من جوه الوحدة نفسها
        settingsPath: menu.find((i) => settingsPermission && i.permission === settingsPermission)?.path ?? null,
      }));
  }

  /** manifest وحدة جمعية بالكود */
  manifest(code: string) {
    return this.manifests.find((m) => m.code === code && scopeOf(m) === 'organization');
  }

  /** صلاحيات نطاق معين، ومع تمرير enabled تقتصر على الوحدات المفعلة */
  permissionCodes(scope: Scope, enabled?: Set<string>) {
    return this.manifests
      .filter((m) => scopeOf(m) === scope && (!enabled || enabled.has(m.code)))
      .flatMap((m) => m.permissions.map((p) => p.code));
  }

  /** الوحدات التي يملك المستخدم صلاحية لعنصر واحد على الأقل في قائمتها */
  appsFor(permissions: string[]) {
    const has = new Set(permissions);
    return this.manifests
      .map((m) => ({
        code: m.code,
        name: m.name,
        description: m.description,
        icon: m.icon,
        menu: m.menu.filter((i) => [i.permission, ...(i.anyOf ?? [])].some((p) => has.has(p))).map(({ label, path }) => ({ label, path })),
      }))
      .filter((m) => m.menu.length > 0);
  }
}
