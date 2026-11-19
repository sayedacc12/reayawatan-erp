import { Test } from '@nestjs/testing';
import { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/main';

/** الصفحة التعريفية: الزائر يرسل طلب خدمة، ومدير المنصة يتابعه ويحدد بيانات التواصل وواتساب */
const DB = process.env.TEST_DATABASE_URL ?? 'postgres://erp:erp@localhost:5432/charity_erp_test';

describe('Public site inquiries', () => {
  let app: NestExpressApplication;
  let http: ReturnType<typeof request>;
  let platform: string;
  let org: string;

  beforeAll(async () => {
    process.env.DATABASE_URL = DB;
    process.env.JWT_SECRET = 'test-secret';
    process.env.PLATFORM_ADMIN_EMAIL = 'platform@test.org';
    process.env.PLATFORM_ADMIN_PASSWORD = 'Platform123';
    const { DataSource: DS } = await import('typeorm');
    const reset = new DS({ type: 'postgres', url: DB });
    await reset.initialize();
    await reset.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
    await reset.destroy();
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(moduleRef.createNestApplication<NestExpressApplication>());
    await app.init();
    http = request(app.getHttpServer());
    platform = (await http.post('/api/auth/login').send({ login: 'admin', password: 'Platform123' }).expect(200)).body.accessToken;
    await http.post('/api/platform/organizations').set(as(platform))
      .send({ name: 'جمعية أ', slug: 'org-a', adminFullName: 'مدير', adminEmail: 'a@a.org', adminPassword: 'Admin12345' }).expect(201);
    org = (await http.post('/api/auth/login').send({ login: 'a@a.org', password: 'Admin12345', organization: 'org-a' })).body.accessToken;
  });

  afterAll(async () => {
    await app.get(DataSource).destroy();
    await app.close();
  });

  const as = (t: string) => ({ Authorization: `Bearer ${t}` });

  it('serves default contact info and the seven services publicly', async () => {
    const res = await http.get('/api/public/site/contact').expect(200);
    expect(res.body.email).toBe('info@sanabelerp.com');
    expect(res.body.whatsapp).toBeNull();
    expect(res.body.services).toHaveLength(7);
  });

  it('accepts a consultation request and validates input in Arabic', async () => {
    const bad = await http.post('/api/public/site/inquiries').send({ kind: 'quote', orgName: 'ج', contactName: 'أحمد', phone: '12' }).expect(400);
    expect(bad.body.message.join(' ')).toContain('رقم الجوال غير صحيح');
    const ok = await http.post('/api/public/site/inquiries').send({
      kind: 'quote', serviceCode: 'impact', orgName: 'جمعية البر', contactName: 'أحمد علي', phone: '٠٥٠ ١٢٣ ٤٥٦٧', email: 'A@Bir.org', message: 'نرغب في تقرير أثر',
    }).expect(201);
    expect(ok.body.number).toBe(1);
    // الحقل المخفي: يُقبل ظاهريًا ولا يُحفظ
    const bot = await http.post('/api/public/site/inquiries').send({ kind: 'demo', orgName: 'جمعية آلية', contactName: 'آلي آلي', phone: '0500000000', website: 'x' }).expect(201);
    expect(bot.body.number).toBeNull();
  });

  it('lets only the platform admin follow up inquiries', async () => {
    await http.get('/api/platform/site/inquiries').set(as(org)).expect(403);
    const list = await http.get('/api/platform/site/inquiries').set(as(platform)).expect(200);
    expect(list.body.rows).toHaveLength(1);
    expect(list.body.counts.new).toBe(1);
    const row = list.body.rows[0];
    expect(row.phone).toBe('0501234567');
    expect(row.email).toBe('a@bir.org');
    const upd = await http.patch(`/api/platform/site/inquiries/${row.id}`).set(as(platform)).send({ status: 'contacted', note: 'تم الاتصال' }).expect(200);
    expect(upd.body.status).toBe('contacted');
    expect(upd.body.log[0].note).toBe('تم الاتصال');
  });

  it('platform admin sets WhatsApp and contact info shown on the page', async () => {
    await http.put('/api/platform/site/contact').set(as(org)).send({ whatsapp: '966500000000' }).expect(403);
    await http.put('/api/platform/site/contact').set(as(platform)).send({ whatsapp: '05' }).expect(400);
    await http.put('/api/platform/site/contact').set(as(platform)).send({ whatsapp: '+966 55 123 4567', email: 'hello@sanabelerp.com' }).expect(200);
    const res = await http.get('/api/public/site/contact').expect(200);
    expect(res.body.whatsapp).toBe('966551234567');
    expect(res.body.email).toBe('hello@sanabelerp.com');
  });
});
