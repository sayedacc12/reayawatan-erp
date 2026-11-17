import { Test } from '@nestjs/testing';
import { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/main';
import { FeedbackService } from '../src/modules/quality/feedback.service';

/**
 * نظام إدارة الجودة: الترميز الموحد، دورة اعتماد الوثيقة وإصداراتها وتوزيعها وسحب الملغى، خرائط الإجراءات،
 * المراجعة الداخلية وإصدار حالات عدم المطابقة، الإجراء التصحيحي حتى الإغلاق، الشكاوى والاستبانات والرابط العام،
 * الأهداف بالقياس التلقائي، مراجعة الإدارة، مصفوفة المطابقة، والصلاحيات.
 */
const DB = process.env.TEST_DATABASE_URL ?? 'postgres://erp:erp@localhost:5432/charity_erp_test';

describe('Quality management (ISO 9001)', () => {
  let app: NestExpressApplication;
  let http: ReturnType<typeof request>;
  let admin: string;
  let reviewer: string;
  let viewer: string;
  const as = (t: string) => ({ Authorization: `Bearer ${t}` });
  const login = async (login: string, password: string, organization?: string) =>
    (await http.post('/api/auth/login').send({ login, password, organization }).expect(200)).body.accessToken as string;
  const Q = '/api/quality';
  const ids: Record<string, string> = {};
  const today = new Date(Date.now() + 3 * 3600000).toISOString().slice(0, 10);

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
      name: 'جمعية البر', slug: 'albir', adminFullName: 'مدير النظام', adminEmail: 'albir@test.org', adminPassword: 'Admin12345',
    }).expect(201);
    admin = await login('albir@test.org', 'Admin12345', 'albir');
    const qRole = await http.post('/api/roles').set(as(admin)).send({
      name: 'مراجع الجودة', permissions: ['quality.dashboard.read', 'quality.documents.manage', 'quality.documents.review', 'quality.ncr.manage'],
    }).expect(201);
    const vRole = await http.post('/api/roles').set(as(admin)).send({ name: 'مطلع', permissions: ['quality.dashboard.read'] }).expect(201);
    await http.post('/api/users').set(as(admin)).send({ fullName: 'هبة الجودة', email: 'q@test.org', password: 'Quality123', roleIds: [qRole.body.id] }).expect(201);
    await http.post('/api/users').set(as(admin)).send({ fullName: 'مطلع', email: 'v@test.org', password: 'Viewer1234', roleIds: [vRole.body.id] }).expect(201);
    reviewer = await login('q@test.org', 'Quality123', 'albir');
    viewer = await login('v@test.org', 'Viewer1234', 'albir');
  });

  afterAll(async () => {
    await app.get(DataSource).destroy();
    await app.close();
  });

  it('satisfaction score from ratings', () => {
    const qs = [{ id: 'a', text: 'a', type: 'rating' as const }, { id: 'b', text: 'b', type: 'rating' as const }, { id: 'c', text: 'c', type: 'text' as const }];
    expect(FeedbackService.score(qs, { a: 5, b: 3, c: 'x' })).toBe(75);
    expect(FeedbackService.score(qs, { a: 1, b: 1 })).toBe(0);
  });

  it('settings and unified coding', async () => {
    const s = (await http.get(`${Q}/settings`).set(as(admin)).expect(200)).body;
    expect(s.prefixes.procedure).toBe('QP');
    expect(s.example).toBe('QP-QMS-01');
    await http.put(`${Q}/settings`).set(as(admin)).send({ ...s, prefixes: { ...s.prefixes, form: 'QP' } }).expect(400);
    await http.put(`${Q}/settings`).set(as(reviewer)).send(s).expect(403);
    const next = (await http.get(`${Q}/codes/next?type=procedure&department=QMS`).set(as(admin)).expect(200)).body;
    expect(next.code).toBe('QP-QMS-01');
  });

  it('document lifecycle: review, approval, distribution, new revision and withdrawal', async () => {
    const created = (await http.post(`${Q}/documents`).set(as(reviewer)).send({
      title: 'إجراء ضبط الوثائق', docType: 'procedure', department: 'QMS', isoClauses: ['7.5'], sections: [],
    }).expect(201)).body;
    ids.doc = created.id;
    expect(created.code).toBe('QP-QMS-01');
    expect(created.sections.map((s: { title: string }) => s.title)).toContain('خطوات الإجراء');
    // كود مكرر مرفوض، والكود التالي يتقدم
    await http.post(`${Q}/documents`).set(as(reviewer)).send({ code: 'qp-qms-01', title: 'مكرر', docType: 'procedure', department: 'QMS', isoClauses: [], sections: [] }).expect(409);
    expect((await http.get(`${Q}/codes/next?type=procedure&department=QMS`).set(as(reviewer)).expect(200)).body.code).toBe('QP-QMS-02');
    await http.post(`${Q}/documents/${ids.doc}/action`).set(as(reviewer)).send({ action: 'submit' }).expect(400);
    const sections = created.sections.map((s: { title: string }) => ({ ...s, body: `محتوى ${s.title}` }));
    await http.put(`${Q}/documents/${ids.doc}`).set(as(reviewer)).send({ title: created.title, docType: 'procedure', department: 'QMS', isoClauses: ['7.5'], sections }).expect(200);
    await http.post(`${Q}/documents/${ids.doc}/action`).set(as(reviewer)).send({ action: 'submit' }).expect(200);
    await http.post(`${Q}/documents/${ids.doc}/action`).set(as(reviewer)).send({ action: 'return' }).expect(400);
    await http.post(`${Q}/documents/${ids.doc}/action`).set(as(reviewer)).send({ action: 'pass' }).expect(200);
    // مراجع الجودة لا يعتمد
    await http.post(`${Q}/documents/${ids.doc}/action`).set(as(reviewer)).send({ action: 'approve' }).expect(403);
    let d = (await http.post(`${Q}/documents/${ids.doc}/action`).set(as(admin)).send({ action: 'approve' }).expect(200)).body;
    expect(d.status).toBe('approved');
    expect(d.revisionLabel).toBe('Rev.00');
    expect(d.nextReviewDate > today).toBe(true);
    d = (await http.post(`${Q}/documents/${ids.doc}/distribute`).set(as(reviewer)).send({ holders: ['إدارة البرامج', 'المالية'] }).expect(200)).body;
    expect(d.copies).toBe(2);
    d = (await http.post(`${Q}/documents/${ids.doc}/copies/1/acknowledge`).set(as(viewer)).expect(200)).body;
    expect(d.pendingAck).toBe(1);
    await http.put(`${Q}/documents/${ids.doc}`).set(as(reviewer)).send({ title: 'x', docType: 'procedure', department: 'QMS', isoClauses: [], sections }).expect(400);
    await http.post(`${Q}/documents/${ids.doc}/action`).set(as(reviewer)).send({ action: 'revise' }).expect(400);
    d = (await http.post(`${Q}/documents/${ids.doc}/action`).set(as(reviewer)).send({ action: 'revise', note: 'إضافة سحب الملغى' }).expect(200)).body;
    expect(d.status).toBe('draft');
    expect(d.revisionLabel).toBe('Rev.00');
    expect(d.workingRevision).toBe('Rev.01');
    await http.post(`${Q}/documents/${ids.doc}/action`).set(as(reviewer)).send({ action: 'submit' }).expect(200);
    await http.post(`${Q}/documents/${ids.doc}/action`).set(as(reviewer)).send({ action: 'pass' }).expect(200);
    d = (await http.post(`${Q}/documents/${ids.doc}/action`).set(as(admin)).send({ action: 'approve' }).expect(200)).body;
    expect(d.revisionLabel).toBe('Rev.01');
    expect(d.revisions).toHaveLength(2);
    expect(d.revisions[1].supersededAt).toBe(today);
    expect(d.revisions[0].supersededAt).toBeNull();
    // نسخ الإصدار السابق سُحبت وأعيد إصدارها بالإصدار الجديد
    expect(d.distribution.filter((c: { withdrawnAt: string | null }) => c.withdrawnAt)).toHaveLength(2);
    expect(d.distribution.filter((c: { withdrawnAt: string | null; revision: number }) => !c.withdrawnAt && c.revision === 1)).toHaveLength(2);
    await http.delete(`${Q}/documents/${ids.doc}`).set(as(reviewer)).expect(400);
    await http.post(`${Q}/documents`).set(as(viewer)).send({ title: 'x', docType: 'form', department: 'QMS', isoClauses: [], sections: [] }).expect(403);
  });

  it('process map validation and link to the procedure', async () => {
    const steps = [
      { id: 's', kind: 'start', label: 'بداية', lane: 0, next: [{ to: 'a' }] },
      { id: 'a', kind: 'decision', label: 'مطابق؟', lane: 1, next: [{ to: 'z', label: 'نعم' }] },
      { id: 'z', kind: 'end', label: 'نهاية', lane: 0, next: [] },
    ];
    await http.post(`${Q}/maps`).set(as(reviewer)).send({ title: 'خريطة', lanes: ['المالك', 'الجودة'], steps, documentId: ids.doc }).expect(400);
    steps[1].next.push({ to: 's', label: 'لا' });
    const m = (await http.post(`${Q}/maps`).set(as(reviewer)).send({ title: 'خريطة ضبط الوثائق', lanes: ['المالك', 'الجودة'], steps, documentId: ids.doc }).expect(201)).body;
    expect(m.code).toBe('PM-QP-QMS-01');
    const d = (await http.get(`${Q}/documents/${ids.doc}`).set(as(viewer)).expect(200)).body;
    expect(d.maps[0].id).toBe(m.id);
  });

  it('internal audit completion raises nonconformities', async () => {
    const a = (await http.post(`${Q}/audits`).set(as(admin)).send({
      title: 'مراجعة الطلبات', scope: 'طلبات المستفيدين', department: 'BEN', clauses: ['8.5'], leadAuditor: 'هبة', plannedDate: today,
      checklist: [{ clause: '8.5', question: 'مدة الدراسة؟' }, { clause: '7.5', question: 'النسخ السارية؟' }],
    }).expect(201)).body;
    ids.audit = a.id;
    expect(a.code).toMatch(/^IA-\d{4}-01$/);
    const checklist = [{ clause: '8.5', question: 'مدة الدراسة؟', result: 'minor', evidence: null }, { clause: '7.5', question: 'النسخ السارية؟', result: 'conform', evidence: 'سليم' }];
    await http.post(`${Q}/audits/${a.id}/execute`).set(as(admin)).send({ checklist: [{ ...checklist[0], result: null }, checklist[1]], complete: true }).expect(400);
    await http.post(`${Q}/audits/${a.id}/execute`).set(as(admin)).send({ checklist, complete: true }).expect(400);
    checklist[0].evidence = '4 طلبات تجاوزت 15 يومًا' as never;
    const done = (await http.post(`${Q}/audits/${a.id}/execute`).set(as(admin)).send({ checklist, complete: true }).expect(200)).body;
    expect(done.status).toBe('completed');
    expect(done.ncrs).toHaveLength(1);
    ids.ncr = done.ncrs[0].id;
  });

  it('corrective action: root cause, actions, verification and closure', async () => {
    let n = (await http.get(`${Q}/ncrs/${ids.ncr}`).set(as(reviewer)).expect(200)).body;
    expect(n.status).toBe('open');
    expect(n.source).toBe('audit');
    await http.put(`${Q}/ncrs/${ids.ncr}/analysis`).set(as(reviewer)).send({ rcaMethod: 'five_whys', whys: [], actions: [{ title: 'إجراء', ownerName: 'خالد', status: 'open' }] }).expect(400);
    n = (await http.put(`${Q}/ncrs/${ids.ncr}/analysis`).set(as(reviewer)).send({ correction: 'توزيع الطلبات', rcaMethod: 'five_whys', whys: ['لماذا؟'], actions: [] }).expect(200)).body;
    expect(n.status).toBe('analysis');
    n = (await http.put(`${Q}/ncrs/${ids.ncr}/analysis`).set(as(reviewer)).send({
      correction: 'توزيع الطلبات', rcaMethod: 'five_whys', whys: ['لماذا؟'], rootCause: 'لا توجد مدة مستهدفة', actions: [{ title: 'تحديد مدة لكل مرحلة', ownerName: 'خالد', status: 'open' }],
    }).expect(200)).body;
    expect(n.status).toBe('action');
    await http.post(`${Q}/ncrs/${ids.ncr}/verify`).set(as(admin)).send({ result: 'effective' }).expect(400);
    n = (await http.put(`${Q}/ncrs/${ids.ncr}/analysis`).set(as(reviewer)).send({
      correction: 'توزيع الطلبات', rcaMethod: 'five_whys', whys: ['لماذا؟'], rootCause: 'لا توجد مدة مستهدفة',
      actions: [{ id: n.actionItems[0].id, title: 'تحديد مدة لكل مرحلة', ownerName: 'خالد', status: 'done' }],
    }).expect(200)).body;
    expect(n.status).toBe('verification');
    // مراجع الجودة هنا لا يملك صلاحية الإغلاق
    await http.post(`${Q}/ncrs/${ids.ncr}/verify`).set(as(reviewer)).send({ result: 'effective' }).expect(403);
    n = (await http.post(`${Q}/ncrs/${ids.ncr}/verify`).set(as(admin)).send({ result: 'effective', note: 'تحقق بعينة' }).expect(200)).body;
    expect(n.status).toBe('closed');
  });

  it('complaints, surveys with a public link, objectives and management review', async () => {
    const c = (await http.post(`${Q}/complaints`).set(as(admin)).send({
      channel: 'phone', partyType: 'beneficiary', subject: 'تأخر الرد', details: 'لم يتواصل معي أحد', department: 'BEN', receivedDate: today,
    }).expect(201)).body;
    await http.post(`${Q}/complaints/${c.id}/action`).set(as(admin)).send({ action: 'close' }).expect(400);
    const toNcr = (await http.post(`${Q}/complaints/${c.id}/action`).set(as(admin)).send({ action: 'ncr' }).expect(200)).body;
    expect(toNcr.ncrId).toBeTruthy();
    await http.post(`${Q}/complaints/${c.id}/action`).set(as(admin)).send({ action: 'resolve', response: 'تم التواصل والاعتذار' }).expect(200);
    const closed = (await http.post(`${Q}/complaints/${c.id}/action`).set(as(admin)).send({ action: 'close', satisfaction: 4 }).expect(200)).body;
    expect(closed.status).toBe('closed');

    const s = (await http.post(`${Q}/surveys`).set(as(admin)).send({
      title: 'رضا المستفيدين', audience: 'beneficiary', questions: [{ text: 'رضاك العام', type: 'rating' }, { text: 'القناة', type: 'choice', options: ['البوابة', 'الهاتف'] }],
    }).expect(201)).body;
    const pub = `/api/public/surveys/${s.publicToken}`;
    expect((await http.get(pub).expect(200)).body.open).toBe(false);
    await http.post(pub).send({ answers: { [s.questions[0].id]: 5 } }).expect(400);
    await http.post(`${Q}/surveys/${s.id}/status`).set(as(admin)).send({ status: 'open' }).expect(200);
    await http.post(pub).send({ answers: { [s.questions[1].id]: 'البوابة' } }).expect(400);
    await http.post(pub).send({ answers: { [s.questions[0].id]: 5, [s.questions[1].id]: 'البوابة' } }).expect(200);
    const r = (await http.post(`${Q}/surveys/${s.id}/responses`).set(as(admin)).send({ answers: { [s.questions[0].id]: 3 } }).expect(200)).body;
    expect(r.responses).toBe(2);
    expect(r.index).toBe(75);

    const year = Number(today.slice(0, 4));
    const o = (await http.post(`${Q}/objectives`).set(as(admin)).send({
      year, title: 'رفع الرضا', kpi: 'مؤشر الرضا', unit: '%', target: 80, direction: 'increase', frequency: 'quarterly', autoMetric: 'satisfaction', department: 'QMS', ownerName: 'هبة',
    }).expect(201)).body;
    expect(o.current).toBe(75);
    expect(o.status).toBe('on_track');
    await http.post(`${Q}/objectives/${o.id}/measurements`).set(as(admin)).send({ period: `${year}-Q1`, value: 70 }).expect(400);

    const mr = (await http.post(`${Q}/reviews`).set(as(admin)).send({ title: 'مراجعة الإدارة', meetingDate: today, chairName: 'المدير التنفيذي' }).expect(201)).body;
    expect(mr.inputs).toHaveLength(12);
    expect(mr.inputs.find((i: { key: string }) => i.key === 'audits').summary).toContain('المنفذة 1');
    await http.post(`${Q}/reviews/${mr.id}/approve`).set(as(admin)).expect(400);
    await http.put(`${Q}/reviews/${mr.id}`).set(as(admin)).send({ title: mr.title, meetingDate: mr.meetingDate, chairName: mr.chairName, inputs: mr.inputs.map(({ key, title, summary }: { key: string; title: string; summary: string }) => ({ key, title, summary })), outputs: [{ type: 'resources', decision: 'تعيين باحث', ownerName: 'المدير', status: 'open' }] }).expect(200);
    const approved = (await http.post(`${Q}/reviews/${mr.id}/approve`).set(as(admin)).expect(200)).body;
    expect(approved.status).toBe('approved');
  });

  it('standard matrix, dashboard and report', async () => {
    const st = (await http.get(`${Q}/standard`).set(as(viewer)).expect(200)).body;
    expect(st.sections).toHaveLength(7);
    const clauses = st.sections.flatMap((s: { clauses: { code: string; status: string }[] }) => s.clauses);
    expect(clauses.find((c: { code: string }) => c.code === '9.2').status).toBe('met');
    expect(clauses.find((c: { code: string }) => c.code === '4.3').status).toBe('gap');
    const dash = (await http.get(`${Q}/dashboard`).set(as(viewer)).expect(200)).body;
    expect(dash.kpis.auditsDone).toBe(1);
    await http.get(`${Q}/reports`).set(as(viewer)).expect(403);
    const rep = (await http.get(`${Q}/reports`).set(as(admin)).expect(200)).body;
    expect(rep.ncr.total).toBe(2);
    expect(rep.complaints.toNcr).toBe(1);
    expect(rep.organizationName).toBe('جمعية البر');
  });
});
