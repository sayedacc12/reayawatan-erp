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
  /** سير عمل بمراحل، والنموذج بيتعمل على أول مرحلة ويتعتمد */
  const workflowWithForm = async (name: string, form: Record<string, unknown>, stages: Record<string, unknown>[]) => {
    const wf = await http.post('/api/beneficiaries/settings/workflows').set(as(admin)).send({ name, stages }).expect(201);
    const f = await http.post('/api/beneficiaries/settings/forms').set(as(admin))
      .send({ ...form, workflowId: wf.body.id, stageId: wf.body.stages[0].id }).expect(201);
    await http.post(`/api/beneficiaries/settings/forms/${f.body.id}/approve`).set(as(admin)).expect(200);
    const all = await http.get('/api/beneficiaries/settings/workflows').set(as(admin)).expect(200);
    return { wf: all.body.find((w: { id: string }) => w.id === wf.body.id), form: f.body };
  };

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
    const scratch = await http.post('/api/beneficiaries/settings/workflows').set(as(admin)).send({ name: 'تجربة', stages: [{ name: 'مرحلة' }] }).expect(201);
    const on = { workflowId: scratch.body.id, stageId: scratch.body.stages[0].id };
    const bad = await http.post(url).set(as(admin)).send({
      ...on, name: 'بحث', scored: true, fields: [{ ...housing, weight: 60, optionScores: [0, 50, 100] }, { ...noIncome, weight: 30 }], rules,
    }).expect(400);
    expect(bad.body.message).toContain('100%');
    // درجة لكل اختيار مطلوبة
    await http.post(url).set(as(admin)).send({
      ...on, name: 'بحث', scored: true, fields: [{ ...housing, weight: 60, optionScores: [0, 50] }, { ...noIncome, weight: 40 }],
    }).expect(400);
    // البنود النصية مايتقيّمش
    await http.post(url).set(as(admin)).send({
      ...on, name: 'بحث', scored: true, fields: [{ key: 'n', label: 'ملاحظات', type: 'text', weight: 100 }],
    }).expect(400);
    // قواعد متداخلة
    await http.post(url).set(as(admin)).send({
      ...on, name: 'بحث', scored: true, fields: [{ ...housing, weight: 60, optionScores: [0, 50, 100] }, { ...noIncome, weight: 40 }],
      rules: [{ min: 0, max: 50, outcome: 'reject' }, { min: 50, max: 100, outcome: 'approve' }],
    }).expect(400);
    // نسبة المساهمة مطلوبة
    await http.post(url).set(as(admin)).send({
      ...on, name: 'بحث', scored: true, fields: [{ ...housing, weight: 60, optionScores: [0, 50, 100] }, { ...noIncome, weight: 40 }],
      rules: [{ min: 0, max: 100, outcome: 'contribution' }],
    }).expect(400);

    await http.delete(`/api/beneficiaries/settings/workflows/${scratch.body.id}`).set(as(admin)).expect(204);

    const { wf, form: ok } = await workflowWithForm('سير العلاج', {
      name: 'البحث الاجتماعي', scored: true,
      fields: [{ ...housing, weight: 60, optionScores: [0, 50, 100] }, { ...noIncome, weight: 40 }, { key: 'notes', label: 'ملاحظات', type: 'text' }],
      rules,
    }, [
      { name: 'البحث الاجتماعي' },
      { name: 'تأكيد مساهمة المستفيد', kind: 'contribution' },
      { name: 'الاعتماد النهائي' },
    ]);
    expect(ok).toMatchObject({ scored: true, rules });
    expect(ok.fields[0]).toMatchObject({ weight: 60, optionScores: [0, 50, 100] });
    ids.form = ok.id;
    // الافتراضي = سير العلاج (التجربة اتحذفت)
    await http.put(`/api/beneficiaries/settings/workflows/${wf.id}`).set(as(admin)).send({
      name: 'سير العلاج', isDefault: true, stages: wf.stages.map((x: { id: string; name: string; kind: string }) => ({ id: x.id, name: x.name, kind: x.kind })),
    }).expect(200);
    expect(wf.stages.map((s: { kind: string }) => s.kind)).toEqual(['standard', 'contribution', 'standard']);
    expect(wf.stages[0].formScored).toBe(true);
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

    // 0.6×0 + 0 = 0% → القاعدة بتقترح رفض، فالقبول محتاج سبب الاختلاف
    const blocked = await decide({ decision: 'approve', formData: { housing: 'جيدة', no_income: false } }).expect(400);
    expect(blocked.body.message).toContain('سبب الاختلاف');

    // سيئة (60×100%) + دخل موجود (0) = 60% → مساهمة 30% من 21000 = 6300
    const scored = await decide({ decision: 'approve', formData: { housing: 'سيئة', no_income: false } }).expect(201);
    expect(scored.body.research).toMatchObject({ score: 60, outcome: 'contribution', contributionPercent: 30, supportPercent: 70, supportAmount: 14700, deviation: false });
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
  it('lets the researcher decide eligible / partially eligible with the association share / not eligible', async () => {
    const { wf } = await workflowWithForm('بقرار الباحث', {
      name: 'بحث بقرار الباحث', fields: [{ key: 'assessment', label: 'تقييم الباحث', type: 'support', required: true }],
    }, [{ name: 'البحث' }, { name: 'المساهمة', kind: 'contribution' }, { name: 'الاعتماد' }]);
    await http.post('/api/beneficiaries/settings/forms').set(as(admin)).send({
      workflowId: wf.id, name: 'غلط', fields: [{ label: 'أ', type: 'support' }, { label: 'ب', type: 'support' }],
    }).expect(400);
    const project = await http.post('/api/beneficiaries/settings/activities').set(as(admin)).send({
      level: 'project', name: 'دعم جزئي', parentId: ids.program, workflowId: wf.id, allowConcurrent: true, recurrence: 'monthly',
      services: [{ name: 'علاج', cost: 10000 }],
    }).expect(201);
    const b = await http.post('/api/beneficiaries').set(as(admin)).send({ fullName: 'حالة بنسبة', gender: 'male', category: 'other' }).expect(201);
    const open = async () => (await http.post('/api/beneficiaries/requests').set(as(admin))
      .send({ beneficiaryId: b.body.id, projectId: project.body.id, services: ['علاج'] }).expect(201)).body.id as string;
    const decide = (id: string, body: Record<string, unknown>) => http.post(`/api/beneficiaries/requests/${id}/decision`).set(as(admin)).send(body);

    const r1 = await open();
    await decide(r1, { decision: 'approve', formData: {} }).expect(400); // مطلوب
    await decide(r1, { decision: 'approve', formData: { assessment: { decision: 'partial' } } }).expect(400); // النسبة مطلوبة
    await decide(r1, { decision: 'approve', formData: { assessment: { decision: 'partial', percent: 100 } } }).expect(400);
    const none = await decide(r1, { decision: 'approve', formData: { assessment: { decision: 'none' } } }).expect(400);
    expect(none.body.message).toContain('غير مستحق');
    await decide(r1, { decision: 'reject', notes: 'غير مستحق' }).expect(201);

    const r2 = await open();
    const partial = await decide(r2, { decision: 'approve', formData: { assessment: { decision: 'partial', percent: 65 } } }).expect(201);
    expect(partial.body.research).toMatchObject({ outcome: 'contribution', supportPercent: 65, supportAmount: 6500, contributionPercent: 35 });
    expect(partial.body.contribution).toMatchObject({ status: 'awaiting', percent: 35, requiredAmount: 3500 });

    const r3 = await open();
    const full = await decide(r3, { decision: 'approve', formData: { assessment: { decision: 'full' } } }).expect(201);
    expect(full.body.research).toMatchObject({ outcome: 'approve', supportPercent: 100, supportAmount: 10000 });
    expect(full.body.actions.map((a: { decision: string }) => a.decision)).toEqual(['submitted', 'approve', 'skipped']);
  });
  it('treats the rules as guidance: a different decision needs a reason and flags the case', async () => {
    const { wf } = await workflowWithForm('استرشادي', {
      name: 'بحث استرشادي', scored: true, rules,
      fields: [{ ...housing, weight: 60, optionScores: [0, 50, 100] }, { ...noIncome, weight: 40 }, { key: 'assessment', label: 'تقييم الباحث', type: 'support', required: true }],
    }, [{ name: 'البحث' }, { name: 'المساهمة', kind: 'contribution' }, { name: 'الاعتماد' }]);
    const project = await http.post('/api/beneficiaries/settings/activities').set(as(admin)).send({
      level: 'project', name: 'استرشادي', parentId: ids.program, workflowId: wf.id, allowConcurrent: true, recurrence: 'monthly',
    }).expect(201);
    const b = await http.post('/api/beneficiaries').set(as(admin)).send({ fullName: 'حالة استرشادية', gender: 'male', category: 'other' }).expect(201);
    const open = async () => (await http.post('/api/beneficiaries/requests').set(as(admin))
      .send({ beneficiaryId: b.body.id, projectId: project.body.id }).expect(201)).body.id as string;
    const decide = (id: string, body: Record<string, unknown>) => http.post(`/api/beneficiaries/requests/${id}/decision`).set(as(admin)).send(body);

    // القاعدة: 60% → مساهمة 30%. الباحث قرر مستحق بالكامل
    const r1 = await open();
    const data = { housing: 'سيئة', no_income: false, assessment: { decision: 'full' } };
    await decide(r1, { decision: 'approve', formData: data }).expect(400);
    const d1 = await decide(r1, { decision: 'approve', formData: data, notes: 'الأسرة عليها ديون علاج' }).expect(201);
    expect(d1.body.research).toMatchObject({
      outcome: 'approve', supportPercent: 100, deviation: true, deviationReason: 'الأسرة عليها ديون علاج',
      suggestion: { score: 60, outcome: 'contribution', contributionPercent: 30 },
    });
    const flagged = await http.get('/api/beneficiaries/requests').set(as(admin)).expect(200);
    expect(flagged.body.items.find((x: { id: string }) => x.id === r1).ruleDeviation).toBe(true);

    // نسبة مختلفة عن القاعدة = اختلاف برضه
    const r2 = await open();
    await decide(r2, { decision: 'approve', formData: { ...data, assessment: { decision: 'partial', percent: 50 } } }).expect(400);
    // نفس نسبة القاعدة = مفيش اختلاف
    const same = await decide(r2, { decision: 'approve', formData: { ...data, assessment: { decision: 'partial', percent: 70 } } }).expect(201);
    expect(same.body.research.deviation).toBe(false);

    // الرفض والقاعدة بتقترح قبول
    const r3 = await open();
    const rej = await decide(r3, { decision: 'reject', notes: 'دخل غير معلن', formData: { housing: 'سيئة', no_income: true, assessment: { decision: 'none' } } }).expect(201);
    expect(rej.body.research).toMatchObject({ outcome: 'reject', deviation: true, suggestion: { outcome: 'approve', score: 100 } });
  });
  it('blocks decisions on a stage until its form is approved, and re-approval after editing', async () => {
    const wf = await http.post('/api/beneficiaries/settings/workflows').set(as(admin)).send({ name: 'مسودة', stages: [{ name: 'البحث' }, { name: 'الاعتماد' }] }).expect(201);
    const f = await http.post('/api/beneficiaries/settings/forms').set(as(admin))
      .send({ name: 'نموذج مسودة', workflowId: wf.body.id, stageId: wf.body.stages[0].id, fields: [{ key: 'note', label: 'ملاحظة', type: 'text' }] }).expect(201);
    expect(f.body.status).toBe('draft');
    await http.post('/api/beneficiaries/settings/forms').set(as(admin))
      .send({ name: 'تاني', workflowId: wf.body.id, stageId: wf.body.stages[0].id, fields: [{ label: 'أ', type: 'text' }] }).expect(409);
    const project = await http.post('/api/beneficiaries/settings/activities').set(as(admin)).send({
      level: 'project', name: 'مسودة', parentId: ids.program, workflowId: wf.body.id, allowConcurrent: true, recurrence: 'monthly',
    }).expect(201);
    const b = await http.post('/api/beneficiaries').set(as(admin)).send({ fullName: 'حالة مسودة', gender: 'male', category: 'other' }).expect(201);
    const r = await http.post('/api/beneficiaries/requests').set(as(admin)).send({ beneficiaryId: b.body.id, projectId: project.body.id }).expect(201);
    const blocked = await http.post(`/api/beneficiaries/requests/${r.body.id}/decision`).set(as(admin)).send({ decision: 'approve', formData: {} }).expect(400);
    expect(blocked.body.message).toContain('اعتماد');
    // المسودة تتحذف وتتشال من المرحلة
    await http.delete(`/api/beneficiaries/settings/forms/${f.body.id}`).set(as(admin)).expect(204);
    const f2 = await http.post('/api/beneficiaries/settings/forms').set(as(admin))
      .send({ name: 'نموذج', workflowId: wf.body.id, stageId: wf.body.stages[0].id, fields: [{ key: 'note', label: 'ملاحظة', type: 'text' }] }).expect(201);
    await http.post(`/api/beneficiaries/settings/forms/${f2.body.id}/approve`).set(as(admin)).expect(200);
    // تعديل المعتمد بيرجّعه مسودة
    const edited = await http.put(`/api/beneficiaries/settings/forms/${f2.body.id}`).set(as(admin))
      .send({ name: 'نموذج معدل', fields: [{ key: 'note', label: 'ملاحظة', type: 'text' }] }).expect(200);
    expect(edited.body).toMatchObject({ status: 'draft', approvedByName: null });
    await http.post(`/api/beneficiaries/requests/${r.body.id}/decision`).set(as(admin)).send({ decision: 'approve', formData: {} }).expect(400);
    await http.post(`/api/beneficiaries/settings/forms/${f2.body.id}/approve`).set(as(admin)).expect(200);
    await http.post(`/api/beneficiaries/requests/${r.body.id}/decision`).set(as(admin)).send({ decision: 'approve', formData: { note: 'تم' } }).expect(201);
    await http.delete(`/api/beneficiaries/settings/workflows/${wf.body.id}`).set(as(admin)).expect(409);
  });
});
