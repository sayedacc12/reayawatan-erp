import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcryptjs';
import { randomBytes } from 'crypto';
import { PASSWORD_CHARS } from './validation';
import { DataSource, In } from 'typeorm';
import { Organization, Permission, Role, RoleAssignment, User } from './entities';
import { COMPANY_TEAM, TEAM_ASSIGNMENT_NOTE } from './company-team';
import { ModuleCatalogService } from './modules/module-catalog.service';
import { DEFAULT_ROLES } from './roles/default-roles';
import { OrganizationStarter } from '../modules/starter/starter.entity';
import { companySlug } from './company';
import { FileStore } from './files/file-store.service';
import { seedCompanyBrand } from './identity/company-brand';

/**
 * أول تشغيل للمنصة: ينشئ حساب مدير المنصة (من PLATFORM_ADMIN_EMAIL / PLATFORM_ADMIN_PASSWORD).
 * مدير المنصة بعدها ينشئ الجمعيات ومدير كل جمعية من شاشة "الجمعيات".
 */
@Injectable()
export class BootstrapService implements OnApplicationBootstrap {
  private readonly logger = new Logger('Bootstrap');

  constructor(
    private readonly db: DataSource,
    private readonly config: ConfigService,
    private readonly files: FileStore,
    private readonly catalog: ModuleCatalogService,
  ) {}

  async onApplicationBootstrap() {
    await this.ensureCompany();
    await this.ensureBrand();
    await this.ensureDefaultRoles();
    await this.ensureTeam();
    // وضع الشركة الواحدة: لا حساب لمدير منصة إلا إذا طُلب صراحة بكلمة مرور
    if (companySlug() && !this.config.get<string>('PLATFORM_ADMIN_PASSWORD')) return;
    await this.db.transaction(async (em) => {
      // قفل لتفادي الإنشاء مرتين لو اشتغلت نسختين من الخادم معًا
      await em.query('SELECT pg_advisory_xact_lock(424242)');
      if (await em.exists(User, { where: { isPlatformAdmin: true } })) return;

      const email = (this.config.get<string>('PLATFORM_ADMIN_EMAIL') ?? 'platform@example.org').toLowerCase();
      let password = this.config.get<string>('PLATFORM_ADMIN_PASSWORD');
      const generated = !password;
      if (!password) password = randomBytes(9).toString('base64url');

      await em.save(em.create(User, {
        organizationId: null,
        fullName: 'مدير المنصة',
        email,
        username: 'admin',
        passwordHash: await bcrypt.hash(password, 12),
        isPlatformAdmin: true,
      }));
      this.logger.warn(
        generated
          ? `Created platform admin "admin" (${email}) with generated password: ${password}  (change it after first login)`
          : `Created platform admin ${email} (password from PLATFORM_ADMIN_PASSWORD)`,
      );
    });
  }

  /** هوية رعاية وطن الافتراضية (الشعار والألوان والبيانات النظامية) ما لم تُعدَّل يدويًا. خطؤها لا يوقف التشغيل. */
  private async ensureBrand() {
    const slug = companySlug();
    if (!slug) return;
    try {
      const org = await this.db.getRepository(Organization).findOne({ where: { slug } });
      if (org) await seedCompanyBrand(this.db, this.files, org, this.logger);
    } catch (e) {
      this.logger.error(`Company identity defaults not applied: ${(e as Error).message}`);
    }
  }

  /**
   * الأدوار الافتراضية للشركة (default-roles.ts): تُضاف مرة واحدة فقط بعد إنشاء المدير، ويُسجَّل ذلك في organization_starters
   * (النظام «core») فلا تعود لو عدّلها المدير أو حذفها. دور موجود بالاسم نفسه لا يُمس. خطؤها لا يوقف التشغيل.
   */
  private async ensureDefaultRoles() {
    const slug = companySlug();
    if (!slug) return;
    try {
      await this.catalog.synced();
      await this.db.transaction(async (em) => {
        await em.query('SELECT pg_advisory_xact_lock(424244)');
        const org = await em.findOne(Organization, { where: { slug } });
        if (!org) return;
        if (await em.exists(OrganizationStarter, { where: { organizationId: org.id, moduleCode: 'core' } })) return;
        const director = await em.findOne(User, { where: { organizationId: org.id, isSuperadmin: true }, order: { createdAt: 'ASC' } });
        if (!director) return;
        const known = new Map((await em.find(Permission)).map((p) => [p.code, p]));
        const existing = new Set((await em.find(Role, { where: { organizationId: org.id, name: In(DEFAULT_ROLES.map((r) => r.name)) } })).map((r) => r.name));
        let added = 0;
        for (const r of DEFAULT_ROLES) {
          if (existing.has(r.name)) continue;
          const permissions = [...new Set(r.permissions)].map((c) => known.get(c)).filter((p): p is Permission => !!p);
          await em.save(em.create(Role, { organizationId: org.id, name: r.name, description: r.description, permissions }));
          added++;
        }
        await em.save(em.create(OrganizationStarter, {
          organizationId: org.id, moduleCode: 'core', status: 'applied', appliedBy: 'النظام (الأدوار الافتراضية)', appliedById: director.id,
          results: [{ key: 'roles', label: 'الأدوار الافتراضية', added, ...(added < DEFAULT_ROLES.length ? { note: 'أدوار بالاسم نفسه موجودة مسبقًا فلم تتغير' } : {}) }],
        }));
        this.logger.log(`Default company roles added: ${added}`);
      });
    } catch (e) {
      this.logger.error(`Default company roles not applied: ${(e as Error).message}`);
    }
  }

  /**
   * فريق الشركة (company-team.ts): حساباتهم وتكليفاتهم المفتوحة بأدوارهم، مرة واحدة بعد الأدوار الافتراضية،
   * ويُسجَّل في organization_starters (core.team) فلا يعود ما حذفه المدير أو أنهاه. بريد موجود يُستخدم حسابه ولا يُعدَّل،
   * ومدير النظام لا يُكلَّف (يملك كل الصلاحيات). الحسابات بلا كلمة مرور صالحة حتى يصدر المدير «كلمة مؤقتة».
   */
  private async ensureTeam() {
    const slug = companySlug();
    if (!slug) return;
    try {
      await this.db.transaction(async (em) => {
        await em.query('SELECT pg_advisory_xact_lock(424245)');
        const org = await em.findOne(Organization, { where: { slug } });
        if (!org) return;
        // بعد الأدوار الافتراضية فقط، ومرة واحدة
        if (!(await em.exists(OrganizationStarter, { where: { organizationId: org.id, moduleCode: 'core' } }))) return;
        if (await em.exists(OrganizationStarter, { where: { organizationId: org.id, moduleCode: 'core.team' } })) return;
        const director = await em.findOne(User, { where: { organizationId: org.id, isSuperadmin: true }, order: { createdAt: 'ASC' } });
        if (!director) return;
        const roles = new Map((await em.find(Role, { where: { organizationId: org.id } })).map((r) => [r.name, r]));
        const today = new Date(Date.now() + 3 * 3600000).toISOString().slice(0, 10);
        let users = 0;
        let assignments = 0;
        const skipped: string[] = [];
        for (const m of COMPANY_TEAM) {
          const email = m.email.toLowerCase();
          let user = await em.findOne(User, { where: { email } });
          if (user && user.organizationId !== org.id) { skipped.push(`${m.fullName}: البريد لحساب خارج الشركة`); continue; }
          if (!user) {
            // كلمة مرور عشوائية لا يعرفها أحد: الدخول بكلمة مؤقتة يصدرها المدير
            user = await em.save(em.create(User, {
              organizationId: org.id, fullName: m.fullName, email,
              passwordHash: await bcrypt.hash(randomBytes(24).toString('base64url'), 12), isActive: true, mustChangePassword: true,
            }));
            users++;
          }
          if (user.isSuperadmin) continue;
          for (const name of m.roles) {
            const role = roles.get(name);
            if (!role) { skipped.push(`${m.fullName}: دور «${name}» غير موجود`); continue; }
            const has = await em.exists(RoleAssignment, { where: { organizationId: org.id, userId: user.id, roleId: role.id } });
            if (has) continue;
            await em.save(em.create(RoleAssignment, {
              organizationId: org.id, userId: user.id, roleId: role.id, startDate: today, endDate: null,
              note: `${m.title}، ${TEAM_ASSIGNMENT_NOTE}`, createdByName: 'النظام (فريق الشركة)',
            }));
            assignments++;
          }
        }
        await em.save(em.create(OrganizationStarter, {
          organizationId: org.id, moduleCode: 'core.team', status: 'applied', appliedBy: 'النظام (فريق الشركة)', appliedById: director.id,
          results: [
            { key: 'users', label: 'حسابات فريق الشركة', added: users },
            { key: 'assignments', label: 'تكليفات الفريق المفتوحة', added: assignments, ...(skipped.length ? { note: skipped.join('؛ ') } : {}) },
          ],
        }));
        this.logger.log(`Company team: ${users} accounts, ${assignments} open assignments${skipped.length ? `, ${skipped.length} skipped` : ''}`);
      });
    } catch (e) {
      this.logger.error(`Company team not applied: ${(e as Error).message}`);
    }
  }

  /**
   * وضع الشركة الواحدة: ينشئ المنشأة ومديرها (المسؤول الأعلى بكل الصلاحيات) عند أول تشغيل.
   * كلمة مرور المدير من DIRECTOR_PASSWORD (يولّدها deploy/setup.sh ويعرضها مرة واحدة على الشاشة، ولا تُكتب في السجل).
   * DIRECTOR_PASSWORD_TEMPORARY=1 تجعلها مؤقتة: صالحة 24 ساعة ويُطلب تغييرها عند أول دخول.
   */
  private async ensureCompany() {
    const slug = companySlug();
    if (!slug) return;
    await this.db.transaction(async (em) => {
      await em.query('SELECT pg_advisory_xact_lock(424243)');
      let org = await em.findOne(Organization, { where: { slug } });
      if (!org) {
        org = await em.save(em.create(Organization, { name: this.config.get<string>('COMPANY_NAME') || 'رعاية وطن', slug, subscriptionStatus: 'active' }));
        this.logger.log(`Created company organization "${slug}"`);
      } else if (org.subscriptionStatus !== 'active' || org.trialEndsOn || org.subscriptionEndsOn) {
        // منشأة الشركة الواحدة اشتراكها دائم: لا فترة تجربة ولا انتهاء (موروثات منصة سنابل). الإيقاف المتعمد (isActive) لا يُلغى هنا
        this.logger.warn(`Company "${slug}" had subscription ${org.subscriptionStatus} (trial ends ${org.trialEndsOn ?? '-'}, ends ${org.subscriptionEndsOn ?? '-'}); set to permanent active`);
        await em.update(Organization, { id: org.id }, { subscriptionStatus: 'active', trialEndsOn: null, subscriptionEndsOn: null });
      }
      if (await em.exists(User, { where: { organizationId: org.id, isSuperadmin: true } })) return;
      const password = this.config.get<string>('DIRECTOR_PASSWORD');
      if (!password) {
        this.logger.warn('No organization director yet: set DIRECTOR_PASSWORD (deploy/setup.sh does this) and restart to create one');
        return;
      }
      const email = (this.config.get<string>('DIRECTOR_EMAIL') || `director@${slug}.local`).trim().toLowerCase();
      const username = (this.config.get<string>('DIRECTOR_USERNAME') || 'director').trim().toLowerCase();
      const temporary = this.config.get<string>('DIRECTOR_PASSWORD_TEMPORARY') === '1';
      // نفس سياسة كلمات المرور: 8 أحرف إنجليزية على الأقل، فيها حرف ورقم، ولا تحتوي اسم الدخول
      if (password.length < 8 || !PASSWORD_CHARS.test(password) || !/[A-Za-z]/.test(password) || !/\d/.test(password)
        || password.toLowerCase().includes(username) || password.toLowerCase().includes(email.split('@')[0])) {
        this.logger.error('DIRECTOR_PASSWORD does not meet the password policy (8+ English characters with a letter and a digit, not containing the login name); director not created');
        return;
      }
      await em.save(em.create(User, {
        organizationId: org.id,
        fullName: this.config.get<string>('DIRECTOR_NAME') || 'مدير المنظمة',
        email,
        username,
        passwordHash: await bcrypt.hash(password, 12),
        isSuperadmin: true,
        mustChangePassword: temporary,
        tempPasswordExpiresAt: temporary ? new Date(Date.now() + 86400000) : null,
      }));
      this.logger.warn(`Created organization director "${username}"${temporary ? ' with a temporary password (must be changed at first login, valid 24 hours)' : ''}`);
    });
  }
}
