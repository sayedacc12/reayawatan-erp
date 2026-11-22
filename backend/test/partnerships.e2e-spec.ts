import { Test } from '@nestjs/testing';
import { NestExpressApplication } from '@nestjs/platform-express';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/main';
import { durationLabel, fillItems, unknownVars } from '../src/modules/partnerships/contracts.service';
import { scoreOf, tierOf } from '../src/modules/partnerships/partnerships.service';

const DB = process.env.TEST_DATABASE_URL ?? 'postgres://erp:erp@localhost:5432/charity_erp_test';

describe('Partnerships rules', () => {
  it('weighted score out of 100 and tiers', () => {
    expect(scoreOf([{ weight: 60, score: 5 }, { weight: 40, score: 3 }])).toBe(84);
    expect(scoreOf([{ weight: 50, score: 1 }, { weight: 50, score: 1 }])).toBe(20);
    const tiers = [{ key: 'b', label: 'رئيسي', min: 70, color: '#000000' }, { key: 'a', label: 'استراتيجي', min: 85, color: '#000000' }];
    expect(tierOf(tiers, 90, false)?.key).toBe('a');
    expect(tierOf(tiers, 72, false)?.key).toBe('b');
    expect(tierOf(tiers, 60, false)).toBeNull();
    expect(tierOf(tiers, 95, true)).toBeNull();
  });

  it('contract text: variables, unknown variables and durations', () => {
    const items = [{ key: '1', clauseId: null, categoryId: 'x', categoryName: 'التمهيد', title: 'بين {{اسم الشركة}}', paragraphs: ['مع {{اسم الشريك}} و{{متغير خطأ}}', ' '], mandatory: false }];
    expect(fillItems(items, { 'اسم الشركة': 'سنابل', 'اسم الشريك': 'الخير' })).toEqual([{ title: 'بين سنابل', category: 'التمهيد', paragraphs: ['مع الخير و{{متغير خطأ}}'] }]);
    expect(unknownVars(items)).toEqual(['متغير خطأ']);
    expect(durationLabel('2026-01-01', '2026-12-31')).toBe('سنة واحدة');
    expect(durationLabel('2026-01-01', '2026-06-30')).toBe('6 أشهر');
    expect(durationLabel('2026-01-01', '2027-12-31')).toBe('سنتان');
  });
});

describe('Partnerships module', () => {
  let app: NestExpressApplication;
  let http: ReturnType<typeof request>;
  let admin: string;
  let officer: string;
  let uploadDir: string;
  const as = (t: string) => ({ Authorization: `Bearer ${t}` });
  const login = async (login: string, password: string, organization?: string) =>
    (await http.post('/api/auth/login').send({ login, password, organization }).expect(200)).body.accessToken as string;
  const PT = '/api/partnerships';
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let lk: any;
  const ids: Record<string, string> = {};

  beforeAll(async () => {
    uploadDir = mkdtempSync(join(tmpdir(), 'sanabel-uploads-'));
    Object.assign(process.env, {
      DATABASE_URL: DB, JWT_SECRET: 'test-secret', UPLOAD_DIR: uploadDir, PLATFORM_ADMIN_EMAIL: 'platform@test.org', PLATFORM_ADMIN_PASSWORD: 'Platform123',
    });
    const reset = new DataSource({ type: 'postgres', url: DB });
    await reset.initialize();
    await reset.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
    await reset.destroy();
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(moduleRef.createNestApplication<NestExpressApplication>());
    await app.init();
    http = request(app.getHttpServer());
    const platform = await login('admin', 'Platform123');
    await http.post('/api/platform/organizations').set(as(platform)).send({
      name: 'جمعية الشراكات', slug: 'pt', adminFullName: 'المدير التنفيذي', adminEmail: 'pt@test.org', adminPassword: 'Admin12345',
    }).expect(201);
    admin = await login('pt@test.org', 'Admin12345', 'pt');
    const role = await http.post('/api/roles').set(as(admin)).send({
      name: 'منسق الشراكات', permissions: ['partnerships.partners.read', 'partnerships.partners.manage', 'partnerships.evaluations.manage', 'partnerships.contracts.manage', 'partnerships.reports.read'],
    }).expect(201);
    await http.post('/api/users').set(as(admin)).send({ fullName: 'منسقة الشراكات', email: 'officer@test.org', password: 'Officer12345', roleIds: [role.body.id] }).expect(201);
    officer = await login('officer@test.org', 'Officer12345', 'pt');
  });

  afterAll(async () => {
    await app.get(DataSource).destroy();
    await app.close();
    rmSync(uploadDir, { recursive: true, force: true });
  });

  it('creates the suggested settings on first use', async () => {
    lk = (await http.get(`${PT}/lookups`).set(as(officer)).expect(200)).body;
    expect(lk.types.length).toBeGreaterThanOrEqual(6);
    expect(lk.classes.length).toBeGreaterThanOrEqual(7);
    expect(lk.criteria.reduce((a: number, c: { weight: number }) => a + c.weight, 0)).toBe(100);
    expect(lk.categories.map((c: { id: string }) => c.id)).toEqual(expect.arrayContaining(['intro', 'duties', 'finance', 'final']));
    const clauses = (await http.get(`${PT}/clauses`).set(as(officer)).expect(200)).body;
    expect(clauses.length).toBeGreaterThan(15);
    // البنود مرتبة حسب التبويب
    expect(clauses[0].categoryId).toBe('intro');
    await http.put(`${PT}/settings/types`).set(as(officer)).send({ types: [] }).expect(403);
  });

  it('criteria weights must total 100', async () => {
    const criteria = lk.criteria.map((c: Record<string, unknown>) => ({ id: c.id, name: c.name, guide: c.guide, weight: c.weight, knockout: c.knockout, isActive: c.isActive }));
    const bad = await http.put(`${PT}/settings/criteria`).set(as(admin)).send({ criteria: [...criteria, { name: 'معيار إضافي', weight: 5, knockout: false, isActive: true }], tiers: lk.tiers }).expect(400);
    expect(bad.body.message).toContain('100%');
    criteria[0].weight -= 5;
    lk = (await http.put(`${PT}/settings/criteria`).set(as(admin)).send({ criteria: [...criteria, { name: 'الانتشار الجغرافي', weight: 5, knockout: false, isActive: true }], tiers: lk.tiers }).expect(200)).body;
    expect(lk.criteria).toHaveLength(criteria.length + 1);
    await http.put(`${PT}/settings/general`).set(as(admin)).send({ alertDays: 60, evaluationMonths: 24, signerName: 'المدير التنفيذي', signerTitle: 'المدير التنفيذي', orgCity: 'الرياض', orgLicense: '555', courtCity: 'الرياض' }).expect(200);
  });

  it('registers partners and evaluates them against the criteria', async () => {
    const funding = lk.types.find((t: { name: string }) => t.name === 'شراكة تمويلية');
    ids.funding = funding.id;
    const p = (await http.post(`${PT}/partners`).set(as(officer)).send({
      name: 'شركة الأمل', classId: lk.classes[1].id, typeIds: [funding.id], registrationNo: '1010999', city: 'الرياض', website: 'amal.sa',
      contactName: 'أ. سالم', contactTitle: 'المدير العام', phone: '0500000000', email: 'CSR@amal.sa', showOnWebsite: true,
    }).expect(201)).body;
    ids.partner = p.id;
    expect(p.code).toBe('PT-0001');
    expect(p.status).toBe('prospect');
    expect(p.website).toBe('https://amal.sa');
    await http.post(`${PT}/partners`).set(as(officer)).send({ name: 'شركة الأمل', typeIds: [], showOnWebsite: false }).expect(409);

    // لا عقد قبل الاعتماد
    await http.post(`${PT}/contracts`).set(as(officer)).send({ partnerId: p.id, typeId: funding.id, title: 'دعم', startsOn: '2026-12-01', endsOn: '2027-11-30' }).expect(400);

    const all = (s: number) => lk.criteria.map((c: { id: string }) => ({ criterionId: c.id, score: s }));
    const incomplete = await http.post(`${PT}/partners/${p.id}/evaluations`).set(as(officer)).send({ typeId: funding.id, scores: all(4).slice(1), submit: true }).expect(400);
    expect(incomplete.body.message).toContain('قيّم كل المعايير');
    // معيار حاسم بدرجة 1 → لا يجتاز القواعد
    const scores = all(4);
    scores[0].score = 1;
    const e = (await http.post(`${PT}/partners/${p.id}/evaluations`).set(as(officer)).send({ typeId: funding.id, scores, recommendation: 'تجربة', submit: true }).expect(201)).body;
    expect(e.knockoutFailed).toBe(true);
    expect(e.meetsRules).toBe(false);
    expect(e.tier).toBeNull();
    await http.post(`${PT}/partners/${p.id}/evaluations`).set(as(officer)).send({ typeId: funding.id, scores: all(5), submit: false }).expect(409);
    // المنسق لا يعتمد
    await http.post(`${PT}/evaluations/${e.id}/decision`).set(as(officer)).send({ decision: 'approve' }).expect(403);
    const ap = (await http.get(`${PT}/approvals`).set(as(admin)).expect(200)).body;
    expect(ap.evaluations).toHaveLength(1);
    expect(ap.evaluations[0].scores.length).toBe(lk.criteria.length);
    // الاعتماد رغم المخالفة يحتاج سببًا
    await http.post(`${PT}/evaluations/${e.id}/decision`).set(as(admin)).send({ decision: 'approve' }).expect(400);
    await http.post(`${PT}/evaluations/${e.id}/decision`).set(as(admin)).send({ decision: 'return', note: 'راجع درجة توافق الأهداف' }).expect(201);
    const fixed = all(5);
    fixed[3].score = 4;
    const e2 = (await http.put(`${PT}/partners/${p.id}/evaluations/${e.id}`).set(as(officer)).send({ typeId: funding.id, scores: fixed, submit: true }).expect(200)).body;
    expect(e2.meetsRules).toBe(true);
    const partner = (await http.post(`${PT}/evaluations/${e.id}/decision`).set(as(admin)).send({ decision: 'approve' }).expect(201)).body;
    expect(partner.status).toBe('approved');
    expect(partner.tier).toBe(e2.tier);
    expect(partner.score).toBeGreaterThan(90);
    expect(partner.nextEvaluationOn).toBeTruthy();
  });

  it('drafts a contract from the categorized clause library', async () => {
    const c = (await http.post(`${PT}/contracts`).set(as(officer)).send({
      partnerId: ids.partner, typeId: ids.funding, title: 'دعم برنامج الأسر المنتجة', startsOn: '2026-12-01', endsOn: '2027-11-30', value: 120000,
    }).expect(201)).body;
    ids.contract = c.id;
    expect(c.number).toMatch(/^PA-\d{4}-0001$/);
    expect(c.orgSignerName).toBe('المدير التنفيذي');
    const titles = c.items.map((i: { title: string }) => i.title);
    // بنود عامة + بنود النوع، دون البنود الاختيارية أو الخاصة بأنواع أخرى
    expect(titles).toEqual(expect.arrayContaining(['التمهيد', 'قيمة الدعم وآلية صرفه', 'تسوية النزاعات']));
    expect(titles).not.toContain('التغطية الإعلامية');
    expect(titles).not.toContain('عدم وجود التزامات مالية');
    // حذف بند إلزامي مرفوض
    const noIntro = c.items.filter((i: { title: string }) => i.title !== 'التمهيد');
    await http.put(`${PT}/contracts/${c.id}`).set(as(officer)).send({ items: noIntro }).expect(400);
    // بند خاص بالعقد بمتغير خطأ يمنع الرفع
    const extra = { key: 'k1', clauseId: null, categoryId: 'finance', title: 'بند خاص', paragraphs: ['يلتزم {{اسم الشريك}} بـ {{خطأ}}'] };
    await http.put(`${PT}/contracts/${c.id}`).set(as(officer)).send({ items: [...c.items, extra] }).expect(200);
    const pv = (await http.get(`${PT}/contracts/${c.id}/preview`).set(as(officer)).expect(200)).body;
    expect(pv.unknown).toEqual(['خطأ']);
    expect(pv.rendered[0].paragraphs.join(' ')).toContain('شركة الأمل');
    await http.post(`${PT}/contracts/${c.id}/submit`).set(as(officer)).expect(400);
    extra.paragraphs = ['يلتزم {{اسم الشريك}} بتقديم تقرير ربعي.'];
    const upd = (await http.put(`${PT}/contracts/${c.id}`).set(as(officer)).send({ items: [...c.items, extra] }).expect(200)).body;
    expect(upd.items.at(-1).mandatory).toBe(false);
    // إضافة بند من المكتبة يُدرج في تبويبه
    const lib = (await http.get(`${PT}/clauses`).set(as(officer)).expect(200)).body;
    const media = lib.find((x: { title: string }) => x.title === 'التغطية الإعلامية');
    const added = (await http.post(`${PT}/contracts/${c.id}/clauses/${media.id}`).set(as(officer)).expect(201)).body;
    const idx = added.items.findIndex((i: { title: string }) => i.title === 'التغطية الإعلامية');
    expect(added.items[idx - 1].categoryId).toBe('brand');
  });

  it('internal approval, sending, change request, new version and e-signature', async () => {
    const id = ids.contract;
    await http.post(`${PT}/contracts/${id}/send`).set(as(officer)).expect(400);
    await http.post(`${PT}/contracts/${id}/submit`).set(as(officer)).expect(201);
    await http.put(`${PT}/contracts/${id}`).set(as(officer)).send({ items: [] }).expect(400);
    const tasks = (await http.get('/api/tasks').set(as(admin)).expect(200)).body;
    expect(JSON.stringify(tasks)).toContain('بانتظار الاعتماد');
    await http.post(`${PT}/contracts/${id}/return`).set(as(admin)).send({}).expect(400);
    await http.post(`${PT}/contracts/${id}/approve`).set(as(admin)).send({}).expect(201);
    const sent = (await http.post(`${PT}/contracts/${id}/send`).set(as(officer)).expect(201)).body;
    expect(sent.status).toBe('sent');
    expect(sent.version).toBe(1);
    expect(sent.contentHash).toMatch(/^[a-f0-9]{64}$/);
    const token = sent.signPath.split('/').pop();
    const pub = (await http.get(`/api/public/partnership-contracts/${token}`).expect(200)).body;
    expect(pub.partnerName).toBe('شركة الأمل');
    expect(pub.needsRegistration).toBe(true);
    expect(pub.rendered[0].category).toBe('التمهيد والتعريفات');
    await http.post(`/api/public/partnership-contracts/${token}/request-changes`).send({ note: 'نرجو تعديل موعد الدفعة الأولى' }).expect(200);
    let c = (await http.get(`${PT}/contracts/${id}`).set(as(officer)).expect(200)).body;
    expect(c.status).toBe('changes_requested');
    expect(c.versions[0].outcome).toBe('طلب الشريك تعديله');
    await http.put(`${PT}/contracts/${id}`).set(as(officer)).send({ terms: { title: c.title, startsOn: '2026-12-15', endsOn: '2027-12-14', value: 120000, orgSignerName: 'المدير التنفيذي', orgSignerTitle: 'المدير التنفيذي' } }).expect(200);
    await http.post(`${PT}/contracts/${id}/submit`).set(as(officer)).expect(201);
    await http.post(`${PT}/contracts/${id}/approve`).set(as(admin)).send({}).expect(201);
    c = (await http.post(`${PT}/contracts/${id}/send`).set(as(officer)).expect(201)).body;
    expect(c.version).toBe(2);
    expect(c.versions).toHaveLength(2);
    const sign = { signerName: 'أ. سالم', signerTitle: 'المدير العام', agree: true };
    const wrong = await http.post(`/api/public/partnership-contracts/${token}/sign`).send({ ...sign, registrationNo: '000' }).expect(400);
    expect(wrong.body.message).toContain('لا يطابق');
    const signed = (await http.post(`/api/public/partnership-contracts/${token}/sign`).send({ ...sign, registrationNo: '1010 999' }).expect(200)).body;
    expect(signed.status).toBe('signed');
    await http.post(`/api/public/partnership-contracts/${token}/sign`).send({ ...sign, registrationNo: '1010999' }).expect(400);
    const v1 = (await http.get(`${PT}/contracts/${id}/versions/1`).set(as(officer)).expect(200)).body;
    expect(v1.rendered.length).toBeGreaterThan(5);
  });

  it('follow-ups, renewal, reports and website partners', async () => {
    const id = ids.contract;
    const list = (await http.post(`${PT}/contracts/${id}/followups`).set(as(officer)).send({ title: 'التقرير الربعي', kind: 'report', party: 'org', dueDate: '2026-01-01', responsible: 'المنسق' }).expect(201)).body;
    expect(list[0].overdue).toBe(true);
    await http.post(`${PT}/followups/${list[0].id}/done`).set(as(officer)).send({ done: true }).expect(201);
    const renewed = (await http.post(`${PT}/contracts/${id}/renew`).set(as(officer)).expect(201)).body;
    expect(renewed.status).toBe('draft');
    expect(renewed.startsOn).toBe('2027-12-15');
    expect(renewed.previous.number).toBeTruthy();
    await http.post(`${PT}/contracts/${id}/renew`).set(as(officer)).expect(409);
    await http.delete(`${PT}/contracts/${renewed.id}`).set(as(officer)).expect(200);
    const ov = (await http.get(`${PT}/overview`).set(as(officer)).expect(200)).body;
    expect(ov.partners.approved).toBe(1);
    expect(ov.contracts.active + ov.contracts.awaitingSign).toBeGreaterThanOrEqual(0);
    for (const code of ['register', 'evaluations', 'contracts', 'expiring', 'followups', 'by_type']) {
      const r = await http.get(`/api/reports/run/partnerships.${code}`).set(as(officer)).expect(200);
      if (code === 'register') expect(r.body.rows[0].name).toBe('شركة الأمل');
    }
    const site = await http.get('/api/public/website/pt');
    expect(site.status).toBeLessThan(500);
    if (site.status === 200) expect(JSON.stringify(site.body.partners)).toContain('شركة الأمل');
    await http.delete(`${PT}/partners/${ids.partner}`).set(as(officer)).expect(409);
  });
});
