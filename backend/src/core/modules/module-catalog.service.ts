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

  /**
   * صلاحيات نطاق معين، ومع تمرير enabled تقتصر على الوحدات المفعلة.
   * ومع تمرير screens (الشاشات المسموحة للجمعية) تُسحب صلاحيات الشاشات غير المسموحة:
   * - وحدة لا يُسمح بأي شاشة منها تُستبعد بالكامل
   * - صلاحية تظهر في قوائم الوحدة تبقى فقط لو شاشة مسموحة واحدة على الأقل تستخدمها
   * - الصلاحيات الداخلية (غير المرتبطة بشاشة في القائمة) تبقى ما دامت الوحدة لها شاشة مسموحة
   */
  permissionCodes(scope: Scope, enabled?: Set<string>, screens?: string[] | null) {
    const allowed = screens ? new Set(screens) : null;
    return this.manifests
      .filter((m) => scopeOf(m) === scope && (!enabled || enabled.has(m.code)))
      .flatMap((m) => {
        const codes = m.permissions.map((p) => p.code);
        if (!allowed || this.isLockedModule(m)) return codes;
        const open = m.menu.filter((i) => allowed.has(i.path));
        if (m.menu.length && !open.length) return [];
        const usedBy = (c: string, items: typeof m.menu) => items.some((i) => i.permission === c || i.anyOf?.includes(c));
        return codes.filter((c) => !usedBy(c, m.menu) || usedBy(c, open));
      });
  }

  /** الشاشات الأساسية (الإعدادات والصلاحيات) متاحة لكل جمعية ولا يمكن حجبها */
  private isLockedModule(m: ErpModuleManifest) {
    return m.code === 'core';
  }

  /** كل شاشات وحدات الجمعيات مجمعة حسب الوحدة، لشاشة تخصيص الشاشات عند مدير المنصة */
  screenCatalog() {
    return this.manifests
      .filter((m) => scopeOf(m) === 'organization')
      .map((m) => ({
        code: m.code, name: m.name, icon: m.icon ?? null,
        optional: !m.alwaysEnabled, locked: this.isLockedModule(m),
        screens: m.menu.map(({ label, path }) => ({ label, path })),
      }));
  }

  /** كل مسارات الشاشات القابلة للتخصيص */
  screenPaths() {
    return this.screenCatalog().filter((m) => !m.locked).flatMap((m) => m.screens.map((s) => s.path));
  }

  /** اسم الشاشة بالمسار (مثل: المستفيدون ← الطلبات) */
  screenLabel(path: string) {
    for (const m of this.screenCatalog()) {
      const s = m.screens.find((x) => x.path === path);
      if (s) return `${m.name}: ${s.label}`;
    }
    return path;
  }

  /** الوحدات التي يملك المستخدم صلاحية لعنصر واحد على الأقل في قائمتها (ومع screens: المسموح منها فقط) */
  appsFor(permissions: string[], screens?: string[] | null) {
    const has = new Set(permissions);
    const allowed = screens ? new Set(screens) : null;
    return this.manifests
      .map((m) => ({
        code: m.code,
        name: m.name,
        description: m.description,
        icon: m.icon,
        menu: m.menu
          .filter((i) => [i.permission, ...(i.anyOf ?? [])].some((p) => has.has(p)))
          .filter((i) => !allowed || scopeOf(m) !== 'organization' || this.isLockedModule(m) || allowed.has(i.path))
          .map(({ label, path }) => ({ label, path })),
      }))
      .filter((m) => m.menu.length > 0);
  }

  /** للواجهة: الشاشات المحجوبة عن الجمعية والمسموحة، لمنع فتحها بالرابط المباشر */
  screenAccess(screens: string[] | null) {
    if (!screens) return { allowed: [], hidden: [] };
    const all = this.screenPaths();
    const set = new Set(screens);
    return { allowed: all.filter((p) => set.has(p)), hidden: all.filter((p) => !set.has(p)) };
  }
}
