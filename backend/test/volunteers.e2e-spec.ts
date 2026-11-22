import { Test } from '@nestjs/testing';
import { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/main';
import { fillTemplate, scoreSurvey } from '../src/modules/volunteers/vol-forms';

/**
 * التطوع: الإعدادات المرنة، التسجيل العام والقبول، الفعاليات ومراحل اعتمادها بالأدوار، الترشيح والتحضير والساعات،
 * تقرير الإغلاق والاستبانة العامة، الشهادات والتحقق منها، العقد بفقراته وتوقيعه، الشكاوى ومتابعتها، اللائحة والتقارير.
 */
const DB = process.env.TEST_DATABASE_URL ?? 'postgres://erp:erp@localhost:5432/charity_erp_test';
const ago = (days: number) => new Date(Date.now() + 3 * 3600000 - days * 86400000).toISOString().slice(0, 10);

describe('Volunteer helpers', () => {
  it('scores surveys from ratings and yes/no answers', () => {
    const qs = [
      { key: 'a', text: 'أ', type: 'rating' as const, required: true },
      { key: 'b', text: 'ب', type: 'yesno' as const, required: true },
      { key: 'c', text: 'ج', type: 'text' as const, required: false },
    ];
    expect(scoreSurvey(qs, { a: 5, b: 'yes' }).score).toBe(100);
    expect(scoreSurvey(qs, { a: 3, b: 'no' }).score).toBe(25);
    expect(() => scoreSurvey(qs, { a: 6, b: 'yes' })).toThrow();
    expect(() => scoreSurvey(qs, { b: 'yes' })).toThrow();
  });

  it('fills template variables and keeps unknown ones', () => {
    expect(fillTemplate('{اسم المتطوع} أتم {عدد الساعات} ساعة {مجهول}', { 'اسم المتطوع': 'سارة', 'عدد الساعات': '6' })).toBe('سارة أتم 6 ساعة {مجهول}');
  });
});

describe('Volunteers', () => {
  let app: NestExpressApplication;
  let http: ReturnType<typeof request>;
  let admin: string;
  let coordinator: string;
  let roleId: string;
  const as = (t: string) => ({ Authorization: `Bearer ${t}` });
  const login = async (login: string, password: string, organization?: string) =>
    (await http.post('/api/auth/login').send({ login, password, organization }).expect(200)).body.accessToken as string;
  const V = '/api/volunteers';
  const PUB = '/api/public/volunteers';
  const ids: Record<string, string> = {};
  const vol = (n: number, extra: Record<string, unknown> = {}) => ({
    fullName: `متطوع رقم ${n}`, nationalId: `10000000${String(n).padStart(2, '0')}`, mobile: `05000000${String(n).padStart(2, '0')}`, gender: n % 2 ? 'male' : 'female',
    typeCode: 'field', fieldCodes: ['social'], answers: { experience: 'نعم' }, ...extra,
  });
  const event = (extra: Record<string, unknown> = {}) => ({
    title: 'توزيع سلال غذائية', kind: 'field', categoryCode: 'distribution', fieldCodes: ['relief'], location: 'مستودع الشركة',
    startDate: ago(3), endDate: ago(2), plannedHours: 5, volunteersNeeded: 4, targetBeneficiaries: 100, answers: {}, ...extra,
  });

  beforeAll(async () => {
    Object.assign(process.env, {
      DATABASE_URL: DB, JWT_SECRET: 'test-secret', UPLOAD_DIR: '/tmp/sanabel-test-uploads',
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
      name: 'جمعية العطاء', slug: 'ataa', adminFullName: 'مدير النظام', adminEmail: 'ataa@test.org', adminPassword: 'Admin12345',
    }).expect(201);
    admin = await login('ataa@test.org', 'Admin12345', 'ataa');
    const role = await http.post('/api/roles').set(as(admin)).send({
      name: 'مسؤول التطوع', permissions: ['volunteers.dashboard.read', 'volunteers.volunteers.manage', 'volunteers.events.manage', 'volunteers.events.approve'],
    }).expect(201);
    roleId = role.body.id;
    await http.post('/api/users').set(as(admin)).send({ fullName: 'منسق التطوع', email: 'coord@test.org', password: 'Coord12345', roleIds: [roleId] }).expect(201);
    coordinator = await login('coord@test.org', 'Coord12345', 'ataa');
  });

  afterAll(async () => {
    await app.get(DataSource).destroy();
    await app.close();
  });

  it('settings come with defaults and every section is editable', async () => {
    const s = (await http.get(`${V}/settings`).set(as(admin)).expect(200)).body;
    expect(s.volunteerTypes.length).toBeGreaterThanOrEqual(5);
    expect(s.eventStages).toHaveLength(2);
    expect(s.contractClauses.length).toBeGreaterThan(5);
    await http.get(`${V}/settings`).set(as(coordinator)).expect(403);
    // حقل إلزامي جديد في نموذج التسجيل
    const fields = [...s.registrationFields, { label: 'المؤهل التخصصي', type: 'select', required: true, options: ['ثانوي', 'جامعي'] }];
    const saved = (await http.put(`${V}/settings/registration`).set(as(admin)).send({ data: { registrationFields: fields } }).expect(200)).body;
    ids.fieldKey = saved.registrationFields.at(-1).key;
    await http.put(`${V}/settings/registration`).set(as(admin)).send({ data: { registrationFields: [{ label: 'قائمة', type: 'select', options: [] }] } }).expect(400);
    // مراحل الاعتماد: الأولى لدور مسؤول التطوع، والثانية لأي معتمد
    await http.put(`${V}/settings/events`).set(as(admin)).send({ data: { eventFields: s.eventFields, eventStages: [{ name: 'مراجعة المسؤول', roleId }, { name: 'اعتماد المدير', roleId: null }] } }).expect(200);
    await http.put(`${V}/settings/surveys`).set(as(admin)).send({ data: { surveyQuestions: { volunteer: [], beneficiary: [] } } }).expect(400);
    await http.put(`${V}/settings/unknown`).set(as(admin)).send({ data: {} }).expect(400);
  });

  it('staff registers volunteers with the flexible form; public registration waits for approval', async () => {
    await http.post(`${V}/volunteers`).set(as(coordinator)).send(vol(1)).expect(400);
    const v1 = (await http.post(`${V}/volunteers`).set(as(coordinator)).send(vol(1, { answers: { experience: 'نعم', [ids.fieldKey]: 'جامعي' } })).expect(201)).body;
    expect(v1.status).toBe('active');
    expect(v1.volunteerNo).toBe(1);
    ids.v1 = v1.id;
    ids.v2 = (await http.post(`${V}/volunteers`).set(as(admin)).send(vol(2, { answers: { [ids.fieldKey]: 'ثانوي' } })).expect(201)).body.id;
    await http.post(`${V}/volunteers`).set(as(admin)).send(vol(2, { answers: { [ids.fieldKey]: 'ثانوي' } })).expect(409);
    await http.post(`${V}/volunteers`).set(as(admin)).send(vol(3, { typeCode: 'nope', answers: { [ids.fieldKey]: 'ثانوي' } })).expect(400);

    const info = (await http.get(`${PUB}/org/ataa`).expect(200)).body;
    expect(info.charter.sections.length).toBeGreaterThan(0);
    await http.post(`${PUB}/org/ataa/register`).send({ ...vol(4, { answers: { [ids.fieldKey]: 'جامعي' } }), acceptCharter: false }).expect(400);
    const reg = (await http.post(`${PUB}/org/ataa/register`).send({ ...vol(4, { answers: { [ids.fieldKey]: 'جامعي' } }), acceptCharter: true }).expect(201)).body;
    expect(reg.volunteerNo).toBe(3);
    const pending = (await http.get(`${V}/volunteers?status=pending`).set(as(admin)).expect(200)).body;
    expect(pending).toHaveLength(1);
    ids.v4 = pending[0].id;
    await http.post(`${V}/volunteers/${ids.v4}/status`).set(as(admin)).send({ status: 'rejected' }).expect(400);
    const ok = (await http.post(`${V}/volunteers/${ids.v4}/status`).set(as(admin)).send({ status: 'active' }).expect(201)).body;
    expect(ok.joinedOn).toBeTruthy();
    await http.get(`${PUB}/org/nope`).expect(404);
  });

  it('events pass the approval stages by role, with return and resubmission', async () => {
    await http.post(`${V}/events`).set(as(coordinator)).send(event({ location: null })).expect(400);
    await http.post(`${V}/events`).set(as(coordinator)).send(event({ kind: 'online', location: null })).expect(400);
    const e = (await http.post(`${V}/events`).set(as(coordinator)).send(event()).expect(201)).body;
    ids.e1 = e.id;
    expect(e.status).toBe('draft');
    expect(e.eventNo).toMatch(/^EV-\d{4}-001$/);
    await http.post(`${V}/events/${e.id}/decision`).set(as(coordinator)).send({ decision: 'approve' }).expect(400);
    await http.post(`${V}/events/${e.id}/submit`).set(as(coordinator)).expect(201);
    await http.post(`${V}/events/${e.id}/decision`).set(as(coordinator)).send({ decision: 'return' }).expect(400);
    let d = (await http.post(`${V}/events/${e.id}/decision`).set(as(coordinator)).send({ decision: 'return', note: 'أضف الجهة الشريكة' }).expect(201)).body;
    expect(d.status).toBe('returned');
    await http.patch(`${V}/events/${e.id}`).set(as(coordinator)).send(event({ answers: { partners: 'بنك الطعام' } })).expect(200);
    await http.post(`${V}/events/${e.id}/submit`).set(as(coordinator)).expect(201);
    d = (await http.post(`${V}/events/${e.id}/decision`).set(as(coordinator)).send({ decision: 'approve' }).expect(201)).body;
    expect(d.stageIndex).toBe(1);
    expect(d.stageName).toBe('اعتماد المدير');
    await http.patch(`${V}/events/${e.id}`).set(as(coordinator)).send(event()).expect(400);
    d = (await http.post(`${V}/events/${e.id}/decision`).set(as(admin)).send({ decision: 'approve' }).expect(201)).body;
    expect(d.status).toBe('approved');
    expect(d.approvalLog.map((l: { decision: string }) => l.decision)).toEqual(['submit', 'return', 'submit', 'approve', 'approve']);

    // المرحلة الأولى لدور محدد: مستخدم بصلاحية الاعتماد بدون الدور لا يقرر فيها
    const other = await http.post('/api/roles').set(as(admin)).send({ name: 'معتمد', permissions: ['volunteers.dashboard.read', 'volunteers.events.approve'] }).expect(201);
    await http.post('/api/users').set(as(admin)).send({ fullName: 'معتمد آخر', email: 'appr@test.org', password: 'Appr12345', roleIds: [other.body.id] }).expect(201);
    const approver = await login('appr@test.org', 'Appr12345', 'ataa');
    const e2 = (await http.post(`${V}/events`).set(as(coordinator)).send(event({ title: 'لقاء توعوي عن بعد', kind: 'online', platform: 'Zoom', location: null, startDate: ago(-10), endDate: ago(-10) })).expect(201)).body;
    await http.post(`${V}/events/${e2.id}/submit`).set(as(coordinator)).expect(201);
    await http.post(`${V}/events/${e2.id}/decision`).set(as(approver)).send({ decision: 'approve' }).expect(403);
    const awaiting = (await http.get(`${V}/events?awaiting=1`).set(as(coordinator)).expect(200)).body;
    expect(awaiting.map((x: { id: string }) => x.id)).toEqual([e2.id]);
    ids.e2 = e2.id;
  });

  it('participants, attendance hours, closure report and the public satisfaction survey', async () => {
    const E = `${V}/events/${ids.e1}`;
    await http.post(`${E}/close`).set(as(coordinator)).send({ actualBeneficiaries: 90, closureSummary: 'تم التوزيع بنجاح على الأسر' }).expect(400);
    let d = (await http.post(`${E}/participants`).set(as(coordinator)).send({ volunteerIds: [ids.v1, ids.v2, ids.v4], role: 'توزيع' }).expect(201)).body;
    expect(d.participants).toHaveLength(3);
    // التحضير قبل الإغلاق إلزامي
    await http.post(`${E}/close`).set(as(coordinator)).send({ actualBeneficiaries: 90, closureSummary: 'تم التوزيع بنجاح على الأسر', closureAnswers: { goals_met: 'تحققت بالكامل' } }).expect(400);
    const rows = d.participants.map((p: { id: string; volunteerId: string }) => ({
      id: p.id, status: p.volunteerId === ids.v4 ? 'absent' : 'attended', hours: p.volunteerId === ids.v4 ? 0 : p.volunteerId === ids.v1 ? 8 : 5, rating: 4,
    }));
    await http.put(`${E}/attendance`).set(as(coordinator)).send({ rows: rows.map((r: { id: string }) => ({ ...r, status: 'absent', hours: 3 })) }).expect(400);
    await http.put(`${E}/attendance`).set(as(coordinator)).send({ rows }).expect(200);
    await http.post(`${E}/close`).set(as(coordinator)).send({ actualBeneficiaries: 90, closureSummary: 'تم التوزيع بنجاح على الأسر' }).expect(400);
    d = (await http.post(`${E}/close`).set(as(coordinator)).send({
      actualBeneficiaries: 90, closureSummary: 'تم التوزيع بنجاح على الأسر', recommendations: 'زيادة عدد المتطوعين', closureAnswers: { goals_met: 'تحققت جزئيًا' },
    }).expect(201)).body;
    expect(d.status).toBe('closed');
    expect(d.survey.open).toBe(true);
    const t = d.survey.token;

    const pub = (await http.get(`${PUB}/survey/${t}`).expect(200)).body;
    expect(pub.questions.volunteer.length).toBeGreaterThan(0);
    await http.post(`${PUB}/survey/${t}`).send({ audience: 'volunteer', answers: { organization: 5 } }).expect(400);
    await http.post(`${PUB}/survey/${t}`).send({ audience: 'volunteer', answers: { organization: 5, clarity: 5, support: 5, benefit: 5, again: 'yes' } }).expect(201);
    await http.post(`${PUB}/survey/${t}`).send({ audience: 'beneficiary', answers: { service: 3, treatment: 3, timing: 3, overall: 3 } }).expect(201);
    d = (await http.get(E).set(as(admin)).expect(200)).body;
    expect(d.survey.volunteer.satisfaction).toBe(100);
    expect(d.survey.beneficiary.satisfaction).toBe(50);
    await http.post(`${E}/survey`).set(as(coordinator)).send({ open: false }).expect(201);
    await http.post(`${PUB}/survey/${t}`).send({ audience: 'beneficiary', answers: { service: 3, treatment: 3, timing: 3, overall: 3 } }).expect(400);
    const p1 = (await http.get(`${V}/volunteers/${ids.v1}`).set(as(admin)).expect(200)).body;
    expect(p1.totals).toEqual({ hours: 8, events: 1 });
  });

  it('hours and thanks certificates with public verification', async () => {
    await http.post(`${V}/certificates`).set(as(coordinator)).send({ volunteerId: ids.v1, kind: 'hours' }).expect(403);
    await http.post(`${V}/certificates`).set(as(admin)).send({ volunteerId: ids.v4, kind: 'hours' }).expect(400);
    const c = (await http.post(`${V}/certificates`).set(as(admin)).send({ volunteerId: ids.v1, kind: 'hours', periodFrom: ago(30), periodTo: ago(0) }).expect(201)).body;
    expect(c.hours).toBe(8);
    expect(c.certificateNo).toMatch(/^VC-\d{4}-0001$/);
    expect(c.body).toContain('متطوع رقم 1');
    expect(c.body).toContain('8 ساعة');
    const thanks = (await http.post(`${V}/certificates`).set(as(admin)).send({ volunteerId: ids.v2, kind: 'thanks', eventId: ids.e1 }).expect(201)).body;
    expect(thanks.body).toContain('توزيع سلال غذائية');
    const verified = (await http.get(`${PUB}/certificate/${c.verifyCode.toLowerCase()}`).expect(200)).body;
    expect(verified.volunteerName).toBe('متطوع رقم 1');
    await http.post(`${V}/certificates/${c.id}/revoke`).set(as(admin)).expect(201);
    expect((await http.get(`${PUB}/certificate/${c.verifyCode}`).expect(200)).body.isRevoked).toBe(true);
  });

  it('contract clauses are flexible and the volunteer signs electronically', async () => {
    const s = (await http.get(`${V}/settings`).set(as(admin)).expect(200)).body;
    const clauses = s.contractClauses.map((c: { key: string }) => (c.key === 'expenses' ? { ...c, isActive: false } : c));
    clauses.push({ title: 'التأمين', body: 'تؤمّن الشركة على {اسم المتطوع} ضد الحوادث أثناء الفعاليات الميدانية.', isActive: true });
    await http.put(`${V}/settings/contract`).set(as(admin)).send({ data: { contractClauses: clauses } }).expect(200);
    await http.post(`${V}/contracts`).set(as(admin)).send({ volunteerId: ids.v1, startDate: ago(0), endDate: ago(10) }).expect(400);
    const c = (await http.post(`${V}/contracts`).set(as(admin)).send({ volunteerId: ids.v1, startDate: ago(0), endDate: ago(-365) }).expect(201)).body;
    await http.post(`${V}/contracts`).set(as(admin)).send({ volunteerId: ids.v1, startDate: ago(-10), endDate: ago(-20) }).expect(409);
    const full = (await http.get(`${V}/contracts/${c.id}`).set(as(admin)).expect(200)).body;
    expect(full.clauses.some((x: { title: string }) => x.title === 'المصروفات')).toBe(false);
    expect(full.clauses.at(-1).body).toContain('متطوع رقم 1');
    const pub = (await http.get(`${PUB}/contract/${c.signToken}`).expect(200)).body;
    expect(pub.status).toBe('issued');
    await http.post(`${PUB}/contract/${c.signToken}/sign`).send({ signedName: 'اسم آخر', accept: true }).expect(400);
    const signed = (await http.post(`${PUB}/contract/${c.signToken}/sign`).send({ signedName: 'متطوع  رقم 1', accept: true }).expect(201)).body;
    expect(signed.status).toBe('signed');
    await http.post(`${PUB}/contract/${c.signToken}/sign`).send({ signedName: 'متطوع رقم 1', accept: true }).expect(400);
  });

  it('complaints, suggestions and inquiries from the public page with tracking', async () => {
    await http.post(`${PUB}/org/ataa/tickets`).send({ kind: 'complaint', senderName: 'زائر', subject: 'تأخر', body: 'تأخر وصول الحافلة' }).expect(400);
    const t = (await http.post(`${PUB}/org/ataa/tickets`).send({ kind: 'complaint', senderName: 'زائر', senderMobile: '0501112223', subject: 'تأخر', body: 'تأخر وصول الحافلة' }).expect(201)).body;
    await http.get(`${PUB}/org/ataa/tickets/${t.ticketNo}?code=WRONG`).expect(404);
    const list = (await http.get(`${V}/tickets?status=open`).set(as(coordinator)).expect(200)).body;
    expect(list).toHaveLength(1);
    await http.post(`${V}/tickets/${list[0].id}/reply`).set(as(coordinator)).send({ reply: 'نعتذر', status: 'closed' }).expect(403);
    await http.post(`${V}/tickets/${list[0].id}/reply`).set(as(admin)).send({ reply: 'نعتذر، وسنعالج الأمر', status: 'closed' }).expect(201);
    const tr = (await http.get(`${PUB}/org/ataa/tickets/${t.ticketNo}?code=${t.trackCode}`).expect(200)).body;
    expect(tr.status).toBe('closed');
    expect(tr.reply).toContain('نعتذر');
  });

  it('policy and charter keep versions; dashboard and reports add up', async () => {
    const docs = (await http.get(`${V}/documents`).set(as(coordinator)).expect(200)).body;
    expect(docs.policy.current).toBeNull();
    await http.put(`${V}/documents/policy`).set(as(coordinator)).send({ title: 'لائحة', sections: docs.policy.sections, effectiveDate: ago(0) }).expect(403);
    await http.put(`${V}/documents/policy`).set(as(admin)).send({ title: 'لائحة التطوع', sections: [], effectiveDate: ago(0) }).expect(400);
    let saved = (await http.put(`${V}/documents/policy`).set(as(admin)).send({ title: 'لائحة التطوع', sections: docs.policy.sections, effectiveDate: ago(0) }).expect(200)).body;
    saved = (await http.put(`${V}/documents/policy`).set(as(admin)).send({ title: 'لائحة التطوع', sections: docs.policy.sections.slice(1), effectiveDate: ago(0), note: 'تحديث' }).expect(200)).body;
    expect(saved.policy.current.version).toBe(2);
    expect(saved.policy.history).toHaveLength(2);

    const dash = (await http.get(`${V}/dashboard`).set(as(coordinator)).expect(200)).body;
    expect(dash.volunteers.active).toBe(3);
    expect(dash.hours).toBe(13);
    expect(dash.events.in_review).toBe(1);
    expect(dash.openTickets).toBe(0);
    await http.get(`${V}/reports`).set(as(coordinator)).expect(403);
    const r = (await http.get(`${V}/reports?from=${ago(30)}&to=${ago(-30)}`).set(as(admin)).expect(200)).body;
    expect(r.volunteerHours[0]).toMatchObject({ fullName: 'متطوع رقم 1', hours: 8 });
    expect(r.events).toHaveLength(2);
    expect(r.satisfaction).toHaveLength(2);
    // لا يُحذف متطوع له مشاركات
    await http.delete(`${V}/volunteers/${ids.v1}`).set(as(admin)).expect(400);
  });
});
