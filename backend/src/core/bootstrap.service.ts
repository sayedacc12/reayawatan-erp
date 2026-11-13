import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcryptjs';
import { randomBytes } from 'crypto';
import { DataSource } from 'typeorm';
import { User } from './entities';

/**
 * أول تشغيل للمنصة: ينشئ حساب مدير المنصة (من PLATFORM_ADMIN_EMAIL / PLATFORM_ADMIN_PASSWORD).
 * مدير المنصة بعدها ينشئ الجمعيات ومدير كل جمعية من شاشة "الجمعيات".
 */
@Injectable()
export class BootstrapService implements OnApplicationBootstrap {
  private readonly logger = new Logger('Bootstrap');

  constructor(private readonly db: DataSource, private readonly config: ConfigService) {}

  async onApplicationBootstrap() {
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
}
