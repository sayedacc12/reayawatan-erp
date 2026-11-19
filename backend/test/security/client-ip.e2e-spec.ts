import { Test } from '@nestjs/testing';
import { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/main';

/**
 * بوابة أمنية: حد محاولات الدخول يُحسب لكل عميل حقيقي، لا للوسيط (Caddy/nginx).
 * في الإنتاج يصل الطلب من شبكة Docker الخاصة ومعه X-Forwarded-For: <العميل>, <Caddy>.
 */
const DB = process.env.TEST_DATABASE_URL ?? 'postgres://erp:erp@localhost:5432/charity_erp_test';

describe('Security gate: rate limits use the real client IP behind the proxies', () => {
  let app: NestExpressApplication;
  let http: ReturnType<typeof request>;

  beforeAll(async () => {
    Object.assign(process.env, { DATABASE_URL: DB, JWT_SECRET: 'test-secret', PLATFORM_ADMIN_EMAIL: 'platform@test.org', PLATFORM_ADMIN_PASSWORD: 'Platform123' });
    const reset = new DataSource({ type: 'postgres', url: DB });
    await reset.initialize();
    await reset.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
    await reset.destroy();
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(moduleRef.createNestApplication<NestExpressApplication>());
    await app.init();
    http = request(app.getHttpServer());
  }, 120000);

  afterAll(async () => {
    await app.get(DataSource).destroy();
    await app.close();
  });

  const attempt = (client: string) => http.post('/api/auth/login')
    .set('X-Forwarded-For', `${client}, 172.18.0.5`) // العميل ثم Caddy داخل شبكة Docker
    .send({ login: 'nobody', password: 'wrong-password' });

  it('an attacker hitting the login limit does not lock out other users', async () => {
    for (let i = 0; i < 10; i++) expect((await attempt('203.0.113.7')).status).toBe(401);
    expect((await attempt('203.0.113.7')).status).toBe(429);
    // مستخدم آخر من عنوان مختلف ما زال يستطيع المحاولة
    expect((await attempt('198.51.100.20')).status).toBe(401);
  });

  it('a forged X-Forwarded-For prefix cannot reset the attacker\'s counter', async () => {
    // Caddy يستبدل X-Forwarded-For القادم من الإنترنت، فما يصل للخادم دائمًا: <العميل الحقيقي>, <Caddy>.
    // لو أضاف المهاجم قيمة مزورة فإنها تظهر يسار عنوانه الحقيقي ولا تُستخدم.
    const forged = await http.post('/api/auth/login')
      .set('X-Forwarded-For', '10.0.0.1, 203.0.113.7, 172.18.0.5')
      .send({ login: 'nobody', password: 'wrong-password' });
    expect(forged.status).toBe(429);
  });
});
