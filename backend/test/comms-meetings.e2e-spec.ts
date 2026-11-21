import { Test } from '@nestjs/testing';
import { NestExpressApplication } from '@nestjs/platform-express';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/main';

/**
 * الاتصالات الإدارية والمهام والاجتماعات: سرية المعاملات (لا يراها حتى مدير النظام إن لم يكن طرفًا)، المتابع يطلع ولا يتدخل،
 * الإحالة والإعادة والإنجاز، القرارات وتسجيل الاطلاع، المهام بمسؤول واحد ومساندين للمتابعة، وجرس المهام.
 * والاجتماع من الخطة إلى المحضر: الحضور والنصاب، التوصيات، التوقيع بكلمة المرور وبالرابط والرمز، الامتناع، الاعتماد التلقائي وتحويل التوصيات لمهام، والتحقق العام.
 */
const DB = process.env.TEST_DATABASE_URL ?? 'postgres://erp:erp@localhost:5432/charity_erp_test';
const inDays = (d: number) => new Date(Date.now() + d * 86400000).toISOString().slice(0, 10);

jest.setTimeout(60_000);

describe('Comms, tasks and meetings', () => {
  let app: NestExpressApplication;
  let http: ReturnType<typeof request>;
  let uploadDir: string;
  const tok: Record<string, string> = {};
  const uid: Record<string, string> = {};
  const as = (t: string) => ({ Authorization: `Bearer ${t}` });
  const login = async (login: string, password: string, organization?: string) =>
    (await http.post('/api/auth/login').send({ login, password, organization }).expect(200)).body.accessToken as string;
  const C = '/api/comms';
  const M = '/api/meetings';

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
      name: 'جمعية البر', slug: 'albir', adminFullName: 'مدير النظام', adminEmail: 'albir@test.org', adminPassword: 'Admin12345',
    }).expect(201);
    tok.admin = await login('albir@test.org', 'Admin12345', 'albir');
    const role = await http.post('/api/roles').set(as(tok.admin)).send({
      name: 'موظف', permissions: ['comms.dashboard.read', 'comms.transactions.create', 'meetings.dashboard.read', 'meetings.board.read'],
    }).expect(201);
    for (const [k, name] of [['clerk', 'سارة الكاتبة'], ['manager', 'خالد المدير'], ['outsider', 'فهد الآخر'], ['follower', 'نورة المتابعة']] as const) {
      uid[k] = (await http.post('/api/users').set(as(tok.admin)).send({ fullName: name, email: `${k}@test.org`, password: `${k}-Pass123`, roleIds: [role.body.id] }).expect(201)).body.id;
      tok[k] = await login(`${k}@test.org`, `${k}-Pass123`, 'albir');
    }
  });

  afterAll(async () => {
    await app.get(DataSource).destroy();
    await app.close();
    rmSync(uploadDir, { recursive: true, force: true });
  });

  const txn = (over: Record<string, unknown> = {}) => ({
    docType: 'transaction', kind: 'admin', subject: 'طلب اعتماد خطة التدريب', body: 'نأمل اعتماد خطة التدريب المرفقة', confidentiality: 'normal', priority: 'normal',
    toUserId: uid.manager, purpose: 'approve', dueDate: inDays(5), ...over,
  });

  it('confidential transaction: only parties and named followers see it, not even the system admin', async () => {
    const t = (await http.post(`${C}/transactions`).set(as(tok.clerk)).send(txn({ confidentiality: 'confidential', followerUserIds: [uid.follower] })).expect(201)).body;
    expect(t.refNo).toMatch(/^TR-\d{4}-0001$/);
    await http.get(`${C}/transactions/${t.id}`).set(as(tok.manager)).expect(200);
    const seen = await http.get(`${C}/transactions/${t.id}`).set(as(tok.follower)).expect(200);
    expect(seen.body.can.act).toBe(false);
    await http.get(`${C}/transactions/${t.id}`).set(as(tok.outsider)).expect(403);
    await http.get(`${C}/transactions/${t.id}`).set(as(tok.admin)).expect(403);
    const reg = await http.get(`${C}/transactions?box=registry`).set(as(tok.admin)).expect(200);
    expect(reg.body.items.some((x: { id: string }) => x.id === t.id)).toBe(false);
    // المتابع لا يتدخل
    await http.post(`${C}/transactions/${t.id}/note`).set(as(tok.follower)).send({ note: 'رأيي كذا' }).expect(403);
    await http.post(`${C}/transactions/${t.id}/refer`).set(as(tok.follower)).send({ toUserId: uid.outsider, purpose: 'info' }).expect(403);
    // عالية السرية بلا متابعين
    await http.post(`${C}/transactions`).set(as(tok.clerk)).send(txn({ confidentiality: 'top_secret', followerUserIds: [uid.follower] })).expect(400);
  });

  it('transaction moves: refer, note, return to the referrer, then done', async () => {
    const t = (await http.post(`${C}/transactions`).set(as(tok.clerk)).send(txn()).expect(201)).body;
    const inbox = await http.get(`${C}/transactions?box=inbox`).set(as(tok.manager)).expect(200);
    expect(inbox.body.items.some((x: { id: string }) => x.id === t.id)).toBe(true);
    await http.post(`${C}/transactions/${t.id}/note`).set(as(tok.clerk)).send({ note: 'إضافة' }).expect(403);
    await http.post(`${C}/transactions/${t.id}/refer`).set(as(tok.manager)).send({ toUserId: uid.outsider, purpose: 'opinion', note: 'رأيك' }).expect(201);
    await http.post(`${C}/transactions/${t.id}/note`).set(as(tok.outsider)).send({ note: 'لا مانع' }).expect(201);
    await http.post(`${C}/transactions/${t.id}/return`).set(as(tok.outsider)).send({ note: 'أعيدها بالموافقة' }).expect(201);
    const back = await http.get(`${C}/transactions/${t.id}`).set(as(tok.manager)).expect(200);
    expect(back.body.holderUserId).toBe(uid.manager);
    // المالية بسند تحتاج صلاحية؛ والإدارية تُنجز بإفادة
    await http.post(`${C}/transactions/${t.id}/close`).set(as(tok.manager)).send({ closeKind: 'voucher' }).expect(400);
    await http.post(`${C}/transactions/${t.id}/close`).set(as(tok.manager)).send({ closeKind: 'done' }).expect(400);
    await http.post(`${C}/transactions/${t.id}/close`).set(as(tok.manager)).send({ closeKind: 'done', note: 'اعتُمدت الخطة' }).expect(201);
    const done = await http.get(`${C}/transactions/${t.id}`).set(as(tok.clerk)).expect(200);
    expect(done.body.status).toBe('closed');
    expect(done.body.movements.map((m: { kind: string }) => m.kind)).toEqual(['create', 'refer', 'refer', 'note', 'return', 'done']);
    // المحال إليه سابقًا يبقى طرفًا ويرى المعاملة
    await http.get(`${C}/transactions/${t.id}`).set(as(tok.outsider)).expect(200);
  });

  it('financial transaction closes by voucher only with the permission', async () => {
    const t = (await http.post(`${C}/transactions`).set(as(tok.clerk)).send(txn({ kind: 'financial', financialType: 'payment', amount: 1500, partyName: 'مؤسسة التدريب' })).expect(201)).body;
    await http.post(`${C}/transactions/${t.id}/close`).set(as(tok.manager)).send({ closeKind: 'voucher', cashAccountId: t.id, counterAccountId: t.id }).expect(403);
    await http.post(`${C}/transactions/${t.id}/close`).set(as(tok.manager)).send({ closeKind: 'archive', note: 'أُلغي التدريب' }).expect(201);
    expect((await http.get(`${C}/transactions/${t.id}`).set(as(tok.clerk)).expect(200)).body.status).toBe('archived');
  });

  it('decisions are issued to named recipients, and reading is recorded', async () => {
    await http.post(`${C}/transactions`).set(as(tok.clerk)).send({ ...txn(), docType: 'decision', recipientUserIds: [uid.manager] }).expect(403);
    const d = (await http.post(`${C}/transactions`).set(as(tok.admin)).send({
      docType: 'decision', kind: 'admin', subject: 'قرار تكليف', body: 'يُكلف خالد بإدارة المشروع', confidentiality: 'confidential', priority: 'normal', recipientUserIds: [uid.manager],
    }).expect(201)).body;
    await http.get(`${C}/transactions/${d.id}`).set(as(tok.outsider)).expect(403);
    await http.post(`${C}/transactions/${d.id}/ack`).set(as(tok.manager)).expect(201);
    const r = await http.get(`${C}/transactions/${d.id}`).set(as(tok.admin)).expect(200);
    expect(r.body.status).toBe('issued');
    expect(r.body.recipients[0].readAt).toBeTruthy();
  });

  it('tasks: one owner, supporters only follow, and the bell shows them', async () => {
    await http.post(`${C}/tasks`).set(as(tok.clerk)).send({ title: 'إعداد التقرير', ownerUserId: uid.manager, priority: 'normal', dueDate: inDays(3) }).expect(403);
    const t = (await http.post(`${C}/tasks`).set(as(tok.admin)).send({
      title: 'إعداد التقرير الربعي', ownerUserId: uid.manager, supporterUserIds: [uid.follower], priority: 'urgent', dueDate: inDays(1),
    }).expect(201)).body;
    const bell = await http.get('/api/tasks').set(as(tok.manager)).expect(200);
    expect(JSON.stringify(bell.body)).toContain(`/comms/tasks/${t.id}`);
    await http.post(`${C}/tasks/${t.id}/update`).set(as(tok.follower)).send({ action: 'complete', text: 'تم' }).expect(403);
    await http.post(`${C}/tasks/${t.id}/update`).set(as(tok.follower)).send({ action: 'note', text: 'أرفقت الأرقام' }).expect(201);
    await http.get(`${C}/tasks/${t.id}`).set(as(tok.outsider)).expect(403);
    await http.post(`${C}/tasks/${t.id}/update`).set(as(tok.manager)).send({ action: 'progress', progress: 60 }).expect(201);
    const done = await http.post(`${C}/tasks/${t.id}/update`).set(as(tok.manager)).send({ action: 'complete', text: 'سُلّم التقرير' }).expect(201);
    expect(done.body).toMatchObject({ status: 'done', progress: 100 });
    const sup = await http.get(`${C}/tasks?scope=supporting&status=done`).set(as(tok.follower)).expect(200);
    expect(sup.body.items.map((x: { id: string }) => x.id)).toContain(t.id);
  });

  it('meeting from plan to adopted minutes, with password and code signatures and tasks from recommendations', async () => {
    const body = (await http.post(`${M}/bodies`).set(as(tok.admin)).send({
      kind: 'board', code: 'BRD', name: 'مجلس الإدارة', quorumPercent: 60, isConfidential: false, isActive: true,
      members: [
        { type: 'user', userId: uid.manager, role: 'chair', voting: true },
        { type: 'user', userId: uid.clerk, role: 'secretary', voting: true },
        { type: 'external', name: 'د. سالم الخارجي', role: 'member', mobile: '0500000000', voting: true },
      ],
    }).expect(201)).body;
    const m0 = (await http.post(M).set(as(tok.admin)).send({
      bodyId: body.id, title: 'الاجتماع الأول', meetingType: 'ordinary', mode: 'in_person', location: 'مقر الشركة', meetingDate: inDays(2), startTime: '10:00', endTime: '12:00',
      agenda: ['اعتماد الميزانية', 'خطة التدريب'],
    }).expect(201)).body;
    const id = m0.id;
    // من يملك صلاحية اطلاع مجلس الإدارة يرى اجتماعاته غير السرية دون أن يديرها
    const peek = await http.get(`${M}/m/${id}`).set(as(tok.outsider)).expect(200);
    expect(peek.body.can.manage).toBe(false);
    await http.post(`${M}/m/${id}/submit`).set(as(tok.outsider)).expect(403);
    await http.post(`${M}/m/${id}/submit`).set(as(tok.admin)).expect(201);
    let m = (await http.get(`${M}/m/${id}`).set(as(tok.manager)).expect(200)).body;
    expect(m.status).toBe('scheduled');
    expect(m.attendees).toHaveLength(3);
    await http.post(`${M}/m/${id}/rsvp`).set(as(tok.manager)).send({ rsvp: 'accepted' }).expect(201);
    await http.post(`${M}/m/${id}/start`).set(as(tok.admin)).expect(201);
    await http.post(`${M}/m/${id}/check-in`).set(as(tok.manager)).expect(201);
    const ext = m.attendees.find((a: { type: string }) => a.type === 'external');
    const clerkAtt = m.attendees.find((a: { userId: string }) => a.userId === uid.clerk);
    await http.put(`${M}/m/${id}/attendance`).set(as(tok.admin)).send({ rows: [{ id: ext.id, attendance: 'present' }, { id: clerkAtt.id, attendance: 'present' }] }).expect(200);
    // لا يصدر المحضر قبل إنهاء الاجتماع وتحديد حالة البنود
    await http.post(`${M}/m/${id}/minutes/issue`).set(as(tok.admin)).expect(409);
    m = (await http.get(`${M}/m/${id}`).set(as(tok.admin)).expect(200)).body;
    const [i1, i2] = m.agenda;
    await http.put(`${M}/m/${id}/items/${i1.id}/discussion`).set(as(tok.admin)).send({ discussion: 'استعرض المجلس الميزانية', status: 'discussed' }).expect(200);
    await http.post(`${M}/m/${id}/items/${i1.id}/recommendations`).set(as(tok.admin)).send({
      kind: 'decision', text: 'اعتماد الميزانية وتكليف الكاتبة بتعميمها', ownerUserId: uid.clerk, supporterUserIds: [uid.follower], dueDate: inDays(14), votesFor: 3, votesAgainst: 0, votesAbstain: 0,
    }).expect(201);
    await http.post(`${M}/m/${id}/end`).set(as(tok.admin)).expect(201);
    await http.post(`${M}/m/${id}/minutes/issue`).set(as(tok.admin)).expect(400);
    await http.put(`${M}/m/${id}/items/${i2.id}/discussion`).set(as(tok.admin)).send({ discussion: null, status: 'deferred' }).expect(200);
    await http.post(`${M}/m/${id}/minutes/issue`).set(as(tok.admin)).expect(201);
    m = (await http.get(`${M}/m/${id}`).set(as(tok.manager)).expect(200)).body;
    expect(m.status).toBe('signing');
    expect(m.quorum).toMatchObject({ voting: 3, present: 3 });
    expect(m.minutes.hash).toMatch(/^[a-f0-9]{64}$/);
    expect(m.can.sign).toBe(true);

    // كلمة مرور خاطئة تُرفض، والامتناع يحتاج سببًا
    await http.post(`${M}/m/${id}/minutes/sign`).set(as(tok.manager)).send({ decision: 'sign', password: 'wrong' }).expect(403);
    await http.post(`${M}/m/${id}/minutes/sign`).set(as(tok.manager)).send({ decision: 'sign', password: 'manager-Pass123' }).expect(201);
    await http.post(`${M}/m/${id}/minutes/sign`).set(as(tok.clerk)).send({ decision: 'abstain', password: 'clerk-Pass123' }).expect(400);
    await http.post(`${M}/m/${id}/minutes/sign`).set(as(tok.clerk)).send({ decision: 'abstain', password: 'clerk-Pass123', reason: 'لم أطلع على الأرقام النهائية' }).expect(201);

    // الحاضر من خارج النظام: رابط شخصي ورمز من 6 أرقام
    const link = (await http.post(`${M}/m/${id}/minutes/sign-link/${ext.id}`).set(as(tok.admin)).expect(201)).body;
    expect(link.code).toMatch(/^\d{6}$/);
    const token = link.url.split('/minutes/sign/')[1];
    const view = await http.get(`/api/public/minutes/sign/${token}`).expect(200);
    expect(view.body.minutes.items[0].recommendations[0].text).toContain('اعتماد الميزانية');
    const wrong = link.code === '000000' ? '111111' : '000000';
    await http.post(`/api/public/minutes/sign/${token}`).send({ decision: 'sign', code: wrong }).expect(403);
    await http.post(`/api/public/minutes/sign/${token}`).send({ decision: 'sign', code: link.code }).expect(201);
    await http.post(`/api/public/minutes/sign/${token}`).send({ decision: 'sign', code: link.code }).expect((r) => expect(r.status).toBeGreaterThanOrEqual(400));

    // اكتملت التوقيعات: اعتُمد المحضر وتحولت التوصية لمهمة للمسؤول مع المساند
    m = (await http.get(`${M}/m/${id}`).set(as(tok.admin)).expect(200)).body;
    expect(m.status).toBe('adopted');
    expect(m.minutes.adoptionMethod).toBe('electronic');
    const rec = m.agenda[0].recommendations[0];
    expect(rec.taskId).toBeTruthy();
    const task = (await http.get(`${C}/tasks/${rec.taskId}`).set(as(tok.clerk)).expect(200)).body;
    expect(task).toMatchObject({ sourceType: 'meeting', ownerUserId: uid.clerk, myRole: 'owner' });
    expect(task.supporters.map((s: { userId: string }) => s.userId)).toEqual([uid.follower]);
    const dec = await http.get(`${M}/decisions`).set(as(tok.manager)).expect(200);
    expect(dec.body[0]).toMatchObject({ taskId: rec.taskId, kind: 'decision' });

    // التحقق العام: كل التوقيعات مطابقة لبصمة المحضر
    const v = await http.get(`/api/public/minutes/verify/${m.minutes.verifyCode}`).expect(200);
    expect(v.body.status).toBe('adopted');
    expect(v.body.signatures).toHaveLength(3);
    expect(v.body.signatures.every((s: { matches: boolean }) => s.matches)).toBe(true);
    await http.get('/api/public/minutes/verify/NOPE0000').expect(404);
  });
});
