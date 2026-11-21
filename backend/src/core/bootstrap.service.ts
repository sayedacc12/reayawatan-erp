import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcryptjs';
import { randomBytes } from 'crypto';
import { DataSource } from 'typeorm';
import { Organization, User } from './entities';
import { companySlug } from './company';

/**
 * أول تشغيل للمنصة: ينشئ حساب مدير المنصة (من PLATFORM_ADMIN_EMAIL / PLATFORM_ADMIN_PASSWORD).
 * مدير المنصة بعدها ينشئ الجمعيات ومدير كل جمعية من شاشة "الجمعيات".
 */
@Injectable()
export class BootstrapService implements OnApplicationBootstrap {
  private readonly logger = new Logger('Bootstrap');

  constructor(private readonly db: DataSource, private readonly config: ConfigService) {}

  async onApplicationBootstrap() {
    await this.ensureCompany();
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

  /**
   * وضع الشركة الواحدة: ينشئ المنشأة ومديرها (المسؤول الأعلى بكل الصلاحيات) عند أول تشغيل.
   * DIRECTOR_PASSWORD إن لم تُضبط تُولَّد كلمة مؤقتة تظهر مرة واحدة في سجل الخادم ويُطلب تغييرها عند أول دخول.
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
      }
      if (await em.exists(User, { where: { organizationId: org.id, isSuperadmin: true } })) return;
      const email = (this.config.get<string>('DIRECTOR_EMAIL') || `director@${slug}.local`).trim().toLowerCase();
      const username = (this.config.get<string>('DIRECTOR_USERNAME') || 'director').trim().toLowerCase();
      let password = this.config.get<string>('DIRECTOR_PASSWORD');
      const generated = !password;
      if (!password) password = `Rw${randomBytes(9).toString('base64url')}7`;
      await em.save(em.create(User, {
        organizationId: org.id,
        fullName: this.config.get<string>('DIRECTOR_NAME') || 'مدير المنظمة',
        email,
        username,
        passwordHash: await bcrypt.hash(password, 12),
        isSuperadmin: true,
        mustChangePassword: generated,
        tempPasswordExpiresAt: generated ? new Date(Date.now() + 86400000) : null,
      }));
      this.logger.warn(generated
        ? `Created organization director "${username}" with temporary password: ${password}  (must be changed at first login, valid 24 hours)`
        : `Created organization director "${username}" (password from DIRECTOR_PASSWORD)`);
    });
  }
}
