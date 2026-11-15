import { Test } from '@nestjs/testing';
import { NestExpressApplication } from '@nestjs/platform-express';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/main';

/** نموذج البحث بالأوزان، قواعد النتيجة، مرحلة تأكيد المساهمة، القيد المحاسبي، وقواعد الدعم لكل مشروع */
const DB = process.env.TEST_DATABASE_URL ?? 'postgres://erp:erp@localhost:5432/charity_erp_test';
const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8ffff3f0005fe02fea7d6a4b40000000049454e44ae426082', 'hex');

describe('Scored research, contribution and support rules', () => {
  let app: NestExpressApplication;
  let http: ReturnType<typeof request>;
  let admin: string;
  let uploadDir: string;
  const as = (t: string) => ({ Authorization: `Bearer ${t}` });
  const login = async (login: string, password: string, organization?: string) =>
    (await http.post('/api/auth/login').send({ login, password, organization }).expect(200)).body.accessToken as string;
  const ids: Record<string, string> = {};

  beforeAll(async () => {
    uploadDir = mkdtempSync(join(tmpdir(), 'sanabel-uploads-'));
    Object.assign(process.env, {
      DATABASE_URL: DB, JWT_SECRET: 'test-secret', UPLOAD_DIR: uploadDir,
      PLATFORM_ADMIN_EMAIL: 'platform@test.org', PLATFORM_ADMIN_PASSWORD: 'Platform123',
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
      name: 'جمعية الخير', slug: 'alkhair', adminFullName: 'مدير', adminEmail: 'alkhair@test.org', adminPassword: 'Admin12345',
    }).expect(201);
    admin = await login('alkhair@test.org', 'Admin12345', 'alkhair');

    const axis = await http.post('/api/beneficiaries/settings/activities').set(as(admin)).send({ level: 'axis', name: 'الصحة' }).expect(201);
    ids.program = (await http.post('/api/beneficiaries/settings/activities').set(as(admin))
      .send({ level: 'program', name: 'العلاج', parentId: axis.body.id }).expect(201)).body.id;
  });

  afterAll(async () => {
    await app.get(DataSource).destroy();
    await app.close();
    rmSync(uploadDir, { recursive: true, force: true });
  });

  const housing = { key: 'housing', label: 'حالة السكن', type: 'select', required: true, options: ['جيدة', 'متوسطة', 'سيئة'] };
  const noIncome = { key: 'no_income', label: 'لا يوجد دخل', type: 'checkbox' };
  const rules = [
    { min: 0, max: 39.99, outcome: 'reject' },
    { min: 40, max: 69.99, outcome: 'contribution', contributionPercent: 30 },
    { min: 70, max: 100, outcome: 'approve' },
  ];

  it('accepts a scored research form only when the weights total 100%', async () => {
    const url = '/api/beneficiaries/settings/forms';
    const bad = await http.post(url).set(as(admin)).send({
      name: 'بحث', scored: true, fields: [{ ...housing, weight: 60, optionScores: [0, 50, 100] }, { ...noIncome, weight: 30 }], rules,
    }).expect(400);
    expect(bad.body.message).toContain('100%');
    // درجة لكل اختيار مطلوبة
    await http.post(url).set(as(admin)).send({
      name: 'بحث', scored: true, fields: [{ ...housing, weight: 60, optionScores: [0, 50] }, { ...noIncome, weight: 40 }],
    }).expect(400);
    // البنود النصية مايتقيّمش
    await http.post(url).set(as(admin)).send({
      name: 'بحث', scored: true, fields: [{ key: 'n', label: 'ملاحظات', type: 'text', weight: 100 }],
    }).expect(400);
    // قواعد متداخلة
    await http.post(url).set(as(admin)).send({
      name: 'بحث', scored: true, fields: [{ ...housing, weight: 60, optionScores: [0, 50, 100] }, { ...noIncome, weight: 40 }],
      rules: [{ min: 0, max: 50, outcome: 'reject' }, { min: 50, max: 100, outcome: 'approve' }],
    }).expect(400);
    // نسبة المساهمة مطلوبة
    await http.post(url).set(as(admin)).send({
      name: 'بحث', scored: true, fields: [{ ...housing, weight: 60, optionScores: [0, 50, 100] }, { ...noIncome, weight: 40 }],
      rules: [{ min: 0, max: 100, outcome: 'contribution' }],
    }).expect(400);

    const ok = await http.post(url).set(as(admin)).send({
      name: 'البحث الاجتماعي', scored: true,
      fields: [{ ...housing, weight: 60, optionScores: [0, 50, 100] }, { ...noIncome, weight: 40 }, { key: 'notes', label: 'ملاحظات', type: 'text' }],
      rules,
    }).expect(201);
    expect(ok.body).toMatchObject({ scored: true, rules });
    expect(ok.body.fields[0]).toMatchObject({ weight: 60, optionScores: [0, 50, 100] });
    ids.form = ok.body.id;

    const wf = await http.post('/api/beneficiaries/settings/workflows').set(as(admin)).send({
      name: 'سير العلاج',
      stages: [
        { name: 'البحث الاجتماعي', formId: ids.form },
        { name: 'تأكيد مساهمة المستفيد', kind: 'contribution' },
        { name: 'الاعتماد النهائي' },
      ],
    }).expect(201);
    expect(wf.body.stages.map((s: { kind: string }) => s.kind)).toEqual(['standard', 'contribution', 'standard']);
    expect(wf.body.stages[0].formScored).toBe(true);
  });

  it('saves the accounting direction for beneficiary contributions', async () => {
    expect((await http.get('/api/beneficiaries/settings/accounting').set(as(admin)).expect(200)).body).toMatchObject({ debitAccountCode: null });
    const saved = await http.put('/api/beneficiaries/settings/accounting').set(as(admin)).send({
      debitAccountCode: '1101', debitAccountName: 'الصندوق', creditAccountCode: '4103', creditAccountName: 'إيرادات مساهمات المستفيدين',
      description: 'مساهمة مستفيد',
    }).expect(200);
    expect(saved.body).toMatchObject({ debitAccountCode: '1101', creditAccountName: 'إيرادات مساهمات المستفيدين' });
  });

  it('defines support rules per project: services, concurrent requests and recurrence', async () => {
    const url = '/api/beneficiaries/settings/activities';
    await http.post(url).set(as(admin)).send({
      level: 'project', name: 'مكرر', parentId: ids.program, services: [{ name: 'أشعة' }, { name: 'أشعة' }],
    }).expect(400);
    await http.post(url).set(as(admin)).send({ level: 'project', name: 'تكرار غلط', parentId: ids.program, recurrence: 'daily' }).expect(400);
    const surgery = await http.post(url).set(as(admin)).send({
      level: 'project', name: 'العمليات', parentId: ids.program, recurrence: 'once', multiServices: true,
      services: [{ name: 'عملية', cost: 20000 }, { name: 'أشعة', cost: 1000 }, { name: 'متابعة' }],
    }).expect(201);
    expect(surgery.body).toMatchObject({ recurrence: 'once', multiServices: true, allowConcurrent: false });
    ids.surgery = surgery.body.id;
    ids.monthly = (await http.post(url).set(as(admin)).send({
      level: 'project', name: 'كفالة شهرية', parentId: ids.program, recurrence: 'monthly', allowConcurrent: true,
    }).expect(201)).body.id;
  });

  let portal: string;

  it('shows the support rules and eligibility on the portal and validates services', async () => {
    portal = (await http.post('/api/portal/o/alkhair/register').send({
      fullName: 'محمد علي', nationalId: '27011051402345', phone: '01011112222', gender: 'male', password: 'Portal123',
    }).expect(201)).body.accessToken;

    const projects = (await http.get('/api/portal/projects').set(as(portal)).expect(200)).body;
    const s = projects.find((p: { id: string }) => p.id === ids.surgery);
    expect(s).toMatchObject({ recurrence: 'once', recurrenceLabel: expect.any(String), multiServices: true, eligibility: { canApply: true } });
    expect(s.services).toHaveLength(3);

    await http.post('/api/portal/requests').set(as(portal)).send({ projectId: ids.surgery }).expect(400); // اختر الخدمة
    await http.post('/api/portal/requests').set(as(portal)).send({ projectId: ids.surgery, services: ['زراعة'] }).expect(400);
    const r = await http.post('/api/portal/requests').set(as(portal)).send({ projectId: ids.surgery, services: ['عملية', 'أشعة'] }).expect(201);
    expect(r.body.services).toEqual(['عملية', 'أشعة']);
    ids.req = r.body.id;
    // طلب مفتوح على نفس المشروع يمنع طلب تاني
    const dup = await http.post('/api/portal/requests').set(as(portal)).send({ projectId: ids.surgery, services: ['أشعة'] }).expect(409);
    expect(dup.body.message).toContain('طلب مفتوح');
    // المشروع اللي بيسمح بأكتر من طلب
    await http.post('/api/portal/requests').set(as(portal)).send({ projectId: ids.monthly }).expect(201);
    await http.post('/api/portal/requests').set(as(portal)).send({ projectId: ids.monthly }).expect(201);
    const again = (await http.get('/api/portal/projects').set(as(portal))).body.find((p: { id: string }) => p.id === ids.surgery);
    expect(again.eligibility.canApply).toBe(false);
  });

  it('scores the research, applies the rules, and requires the beneficiary contribution', async () => {
    const decide = (body: Record<string, unknown>) => http.post(`/api/beneficiaries/requests/${ids.req}/decision`).set(as(admin)).send(body);
    const staffView = (await http.get(`/api/beneficiaries/requests/${ids.req}`).set(as(admin)).expect(200)).body;
    expect(staffView.estimatedCost).toBe(21000);

    // 0.6×0 + 0 = 0% → القواعد بتقول رفض، فالقبول ممنوع
    const blocked = await decide({ decision: 'approve', formData: { housing: 'جيدة', no_income: false } }).expect(400);
    expect(blocked.body.message).toContain('رفض');

    // سيئة (60×100%) + دخل موجود (0) = 60% → مساهمة 30% من 21000 = 6300
    const scored = await decide({ decision: 'approve', formData: { housing: 'سيئة', no_income: false } }).expect(201);
    expect(scored.body.research).toEqual({ score: 60, outcome: 'contribution', contributionPercent: 30 });
    expect(scored.body.contribution).toMatchObject({ status: 'awaiting', percent: 30, requiredAmount: 6300 });
    expect(scored.body.actions.at(-1).score).toBe(60);

    // الجمعية مش هتقدر تأكد قبل ما المستفيد يرفع أو تسجل مبلغ
    await decide({ decision: 'approve' }).expect(400);

    // البوابة: المستفيد يشوف المطلوب منه ومايشوفش نتيجة التقييم
    const pv = (await http.get(`/api/portal/requests/${ids.req}`).set(as(portal)).expect(200)).body;
    expect(pv.research).toBeUndefined();
    expect(pv.contribution).toMatchObject({ status: 'awaiting', requiredAmount: 6300 });
    const mine = (await http.get('/api/portal/requests').set(as(portal))).body.find((x: { id: string }) => x.id === ids.req);
    expect(mine.contributionStatus).toBe('awaiting');

    const url = `/api/portal/requests/${ids.req}/contribution`;
    await http.post(url).set(as(portal)).field('amount', '6300').expect(400); // من غير ملف
    await http.post(url).set(as(portal)).field('amount', '6300')
      .attach('file', Buffer.from('not an image'), { filename: 'x.png', contentType: 'image/png' }).expect(400);
    const sent = await http.post(url).set(as(portal)).field('amount', '6300')
      .attach('file', PNG, { filename: 'إيصال.png', contentType: 'image/png' }).expect(200);
    expect(sent.body.contribution.status).toBe('submitted');

    // الإثبات بيظهر للجمعية كمستند على ملف المستفيد
    const sv = (await http.get(`/api/beneficiaries/requests/${ids.req}`).set(as(admin))).body;
    expect(sv.contribution).toMatchObject({ status: 'submitted', amount: 6300 });
    await http.get(`/api/beneficiaries/${sv.beneficiary.id}/documents/${sv.contribution.documentId}/file`).set(as(admin)).expect(200);

    // إرجاع للمستفيد يرجعه "مطلوب" في نفس المرحلة
    const back = await decide({ decision: 'return', notes: 'الإيصال مش واضح' }).expect(201);
    expect(back.body.contribution.status).toBe('awaiting');
    expect(back.body.currentStageId).toBe(sv.currentStageId);
    await http.post(url).set(as(portal)).field('amount', '6300').attach('file', PNG, { filename: 'r.png', contentType: 'image/png' }).expect(200);

    const verified = await decide({ decision: 'approve', notes: 'تم التحقق' }).expect(201);
    expect(verified.body.contribution).toMatchObject({ status: 'verified' });
    expect(verified.body.contribution.journal).toMatchObject({
      amount: 6300, debit: { code: '1101', name: 'الصندوق' }, credit: { code: '4103' }, description: expect.stringContaining('مساهمة مستفيد'),
    });
    const final = await decide({ decision: 'approve' }).expect(201);
    expect(final.body.status).toBe('approved');
    const portalFinal = (await http.get(`/api/portal/requests/${ids.req}`).set(as(portal))).body;
    expect(portalFinal.contribution.journal).toBeUndefined();

    // الدعم في المشروع ده مرة واحدة
    const once = await http.post('/api/portal/requests').set(as(portal)).send({ projectId: ids.surgery, services: ['أشعة'] }).expect(409);
    expect(once.body.message).toContain('مرة واحدة');
  });

  it('skips the contribution stage when the rules approve with no contribution', async () => {
    const b = await http.post('/api/beneficiaries').set(as(admin)).send({ fullName: 'حالة مستحقة', gender: 'female', category: 'other' }).expect(201);
    const r = await http.post('/api/beneficiaries/requests').set(as(admin))
      .send({ beneficiaryId: b.body.id, projectId: ids.surgery, services: ['متابعة'] }).expect(201);
    expect(r.body.estimatedCost).toBeNull(); // خدمة من غير تكلفة
    const d = await http.post(`/api/beneficiaries/requests/${r.body.id}/decision`).set(as(admin))
      .send({ decision: 'approve', formData: { housing: 'متوسطة', no_income: true }, estimatedCost: 5000 }).expect(201);
    expect(d.body.research).toMatchObject({ score: 70, outcome: 'approve', contributionPercent: 0 });
    expect(d.body.estimatedCost).toBe(5000);
    expect(d.body.contribution.status).toBe('none');
    expect(d.body.actions.map((a: { decision: string }) => a.decision)).toEqual(['submitted', 'approve', 'skipped']);
    expect(d.body.workflow.stages.findIndex((s: { id: string }) => s.id === d.body.currentStageId)).toBe(2);

    // الجمعية تقدر تسجل مبلغ مدفوع في المقر بدل رفع البوابة
    const b2 = await http.post('/api/beneficiaries').set(as(admin)).send({ fullName: 'حالة مساهمة', gender: 'male', category: 'other' }).expect(201);
    const r2 = await http.post('/api/beneficiaries/requests').set(as(admin))
      .send({ beneficiaryId: b2.body.id, projectId: ids.surgery, services: ['عملية'] }).expect(201);
    await http.post(`/api/beneficiaries/requests/${r2.body.id}/decision`).set(as(admin))
      .send({ decision: 'approve', formData: { housing: 'سيئة', no_income: false } }).expect(201);
    const paid = await http.post(`/api/beneficiaries/requests/${r2.body.id}/decision`).set(as(admin))
      .send({ decision: 'approve', contributionAmount: 6000, notes: 'دفع في المقر' }).expect(201);
    expect(paid.body.contribution).toMatchObject({ status: 'verified', amount: 6000 });
    expect(paid.body.contribution.journal.amount).toBe(6000);
  });
});
