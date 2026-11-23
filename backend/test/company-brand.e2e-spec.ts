import { Test } from '@nestjs/testing';
import { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/main';
import { FileStore } from '../src/core/files/file-store.service';
import { COMPANY_BRAND, seedCompanyBrand } from '../src/core/identity/company-brand';
import { BootstrapService } from '../src/core/bootstrap.service';
import { deletionNotice } from '../src/core/lifecycle/lifecycle-rules';
import { Organization } from '../src/core/entities';

/**
 * هوية رعاية وطن الافتراضية: تُملأ عند أول تشغيل (الشعار والألوان والبيانات النظامية والرقم الضريبي)،
 * ولا تُكتب فوق ما يحفظه مدير الشركة من شاشة «هوية الشركة».
 */
const DB = process.env.TEST_DATABASE_URL ?? 'postgres://erp:erp@localhost:5432/charity_erp_test';

describe('Reaya Watan default brand identity', () => {
  let app: NestExpressApplication;
  let http: ReturnType<typeof request>;
  let director: string;
  const as = (t: string) => ({ Authorization: `Bearer ${t}` });

  beforeAll(async () => {
    Object.assign(process.env, {
      DATABASE_URL: DB, JWT_SECRET: 'test-secret', COMPANY_SLUG: 'reayawatan', COMPANY_NAME: 'رعاية وطن',
      DIRECTOR_EMAIL: 'director@rw.test', DIRECTOR_USERNAME: 'director', DIRECTOR_PASSWORD: 'RwAdmin2026', UPLOAD_DIR: '/tmp/rw-brand-uploads',
    });
    delete process.env.PLATFORM_ADMIN_PASSWORD;
    const reset = new DataSource({ type: 'postgres', url: DB });
    await reset.initialize();
    await reset.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
    await reset.destroy();
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(moduleRef.createNestApplication<NestExpressApplication>());
    await app.init();
    http = request(app.getHttpServer());
    director = (await http.post('/api/auth/login').send({ login: 'director', password: 'RwAdmin2026' }).expect(200)).body.accessToken;
  }, 120000);

  afterAll(async () => {
    await app.get(DataSource).destroy();
    await app.close();
  });

  it('fills the identity, logos and tax number on first boot', async () => {
    const pub = await http.get('/api/public/identity/reayawatan').expect(200);
    expect(pub.body.name).toBe('شركة رعاية وطن للاستثمار');
    expect(pub.body.englishName).toBe('National Care');
    expect(pub.body.colors).toEqual(COMPANY_BRAND.colors);
    expect(pub.body.fonts).toEqual(COMPANY_BRAND.fonts);
    expect(pub.body.licenseNo).toBe('7052873945');
    expect(pub.body.contact.email).toBe('info@reayawatan.com');
    expect(pub.body.logoUrl).toContain('/api/public/identity/reayawatan/logo');
    expect(pub.body.logoLightUrl).toContain('/logoLight');
    const logo = await http.get('/api/public/identity/reayawatan/logo').expect(200);
    expect(logo.headers['content-type']).toContain('image/png');
    const [org] = await app.get(DataSource).query("SELECT tax_number FROM organizations WHERE slug = 'reayawatan'");
    expect(org.tax_number).toBe('314466205600003');
  });

  it('never overwrites what the director saves', async () => {
    const v = (await http.get('/api/identity').set(as(director)).expect(200)).body;
    const dto = {
      displayName: 'اسم معدّل', shortName: v.shortName, englishName: v.englishName, slogan: v.slogan, about: v.about, vision: v.vision,
      mission: v.mission, goals: v.goals, values: v.values, colors: { ...v.colors, primary: '#123456' }, fonts: v.fonts, contact: v.contact,
      licenseNo: v.licenseNo, licenseAuthority: v.licenseAuthority, foundedOn: v.foundedOn, applyToSystem: v.applyToSystem,
    };
    await http.put('/api/identity').set(as(director)).send(dto).expect(200);
    const db = app.get(DataSource);
    const [org] = await db.query("SELECT id, slug FROM organizations WHERE slug = 'reayawatan'");
    await db.query('UPDATE organizations SET tax_number = NULL WHERE id = $1', [org.id]);
    await seedCompanyBrand(db, app.get(FileStore), org);
    // الرقم الضريبي لا يُعاد بعد أول تعبئة
    expect((await db.query('SELECT tax_number FROM organizations WHERE id = $1', [org.id]))[0].tax_number).toBeNull();
    const after = (await http.get('/api/public/identity/reayawatan').expect(200)).body;
    expect(after.name).toBe('اسم معدّل');
    expect(after.colors.primary).toBe('#123456');
  });
  it('keeps the company subscription permanent: no trial expiry, notice or automatic deletion', async () => {
    const db = app.get(DataSource);
    // حالة موروثة من منصة سنابل: فترة تجربة انتهت أمس
    await db.query(`UPDATE organizations SET subscription_status = 'trial', trial_ends_on = CURRENT_DATE - 1 WHERE slug = 'reayawatan'`);
    const stale = await db.getRepository(Organization).findOneByOrFail({ slug: 'reayawatan' });
    expect(await deletionNotice(db, stale)).toBeNull();
    await (app.get(BootstrapService) as unknown as { ensureCompany(): Promise<void> }).ensureCompany();
    const org = await db.getRepository(Organization).findOneByOrFail({ slug: 'reayawatan' });
    expect(org.subscriptionStatus).toBe('active');
    expect(org.trialEndsOn).toBeNull();
    expect(org.subscriptionEndsOn).toBeNull();
    expect(org.isActive).toBe(true);
    await http.post('/api/auth/login').send({ login: 'director', password: 'RwAdmin2026' }).expect(200);
    // الإيقاف المتعمد يبقى كما هو بعد إعادة التشغيل
    await db.query(`UPDATE organizations SET is_active = false WHERE slug = 'reayawatan'`);
    await (app.get(BootstrapService) as unknown as { ensureCompany(): Promise<void> }).ensureCompany();
    expect((await db.getRepository(Organization).findOneByOrFail({ slug: 'reayawatan' })).isActive).toBe(false);
    await db.query(`UPDATE organizations SET is_active = true WHERE slug = 'reayawatan'`);
  });
  it('fills the approved contact details: empty identity fields and still-pending site fields, never a saved value', async () => {
    const db = app.get(DataSource);
    const [org] = await db.query("SELECT id, slug FROM organizations WHERE slug = 'reayawatan'");
    // هوية محفوظة قبل اعتماد الهاتف: الهاتف وأوقات العمل والواتساب فارغة، والبريد مُدخل يدويًا
    await db.query(`UPDATE org_identity SET contact = contact || '{"phone":"","workingHours":"","email":"manual@reayawatan.com"}'::jsonb
                      || jsonb_build_object('social', (contact->'social') || '{"whatsapp":""}'::jsonb) WHERE organization_id = $1`, [org.id]);
    // صفحة تواصل محفوظة قبل الاعتماد: الهاتف معلّق، والبريد معدّل يدويًا
    await db.query(`INSERT INTO rw_site_content (organization_id, key, data) VALUES ($1, 'contact', $2)
                    ON CONFLICT (organization_id, key) DO UPDATE SET data = EXCLUDED.data`,
      [org.id, JSON.stringify({ phone: '{{يُستكمل}}', whatsapp: '{{يُستكمل}}', hours: 'الأحد إلى الخميس، {{الساعات}}', email: 'sales@reayawatan.com' })]);
    await seedCompanyBrand(db, app.get(FileStore), org);
    const id = (await http.get('/api/identity').set(as(director)).expect(200)).body;
    expect(id.contact.phone).toBe('+966564355564');
    expect(id.contact.workingHours).toContain('من 9 صباحاً إلى 2 ظهراً');
    expect(id.contact.social.whatsapp).toBe('966564355564');
    expect(id.contact.email).toBe('manual@reayawatan.com');
    const site = (await http.get('/api/public/web').expect(200)).body;
    expect(site.content.contact.phone).toBe('+966 56 435 5564');
    expect(site.content.contact.whatsapp).toBe('+966 56 435 5564');
    expect(site.content.contact.hours).toBe('الأحد إلى الخميس، من 9 صباحاً إلى 2 ظهراً. الجمعة والسبت إجازة.');
    expect(site.content.contact.email).toBe('sales@reayawatan.com');
  });
});
