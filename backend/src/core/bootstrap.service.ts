import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcryptjs';
import { randomBytes } from 'crypto';
import { PASSWORD_CHARS } from './validation';
import { DataSource } from 'typeorm';
import { Organization, User } from './entities';
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

  constructor(private readonly db: DataSource, private readonly config: ConfigService, private readonly files: FileStore) {}

  async onApplicationBootstrap() {
    await this.ensureCompany();
    await this.ensureBrand();
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
