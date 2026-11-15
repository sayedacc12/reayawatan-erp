import { Test } from '@nestjs/testing';
import { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/main';

/** طلبات الصيانة: الجمعية تقدّم، والمنصة ترد وتعالج حسب مستوى الخدمة، والجمعية تغلق وتقيّم */
const DB = process.env.TEST_DATABASE_URL ?? 'postgres://erp:erp@localhost:5432/charity_erp_test';

describe('Support tickets & SLA', () => {
  let app: NestExpressApplication;
  let http: ReturnType<typeof request>;
  let platform: string;
  let org: string;
  let other: string;
  let ticketId: string;

  beforeAll(async () => {
    process.env.DATABASE_URL = DB;
    process.env.JWT_SECRET = 'test-secret';
    process.env.PLATFORM_ADMIN_EMAIL = 'platform@test.org';
    process.env.PLATFORM_ADMIN_PASSWORD = 'Platform123';
    process.env.UPLOAD_DIR = '/tmp/sanabel-test-uploads';
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
    for (const [slug, email] of [['org-a', 'a@a.org'], ['org-b', 'b@b.org']]) {
      await http.post('/api/platform/organizations').set(as(platform))
        .send({ name: `جمعية ${slug}`, slug, adminFullName: 'مدير', adminEmail: email, adminPassword: 'Admin12345' }).expect(201);
    }
    org = (await http.post('/api/auth/login').send({ login: 'a@a.org', password: 'Admin12345', organization: 'org-a' })).body.accessToken;
    other = (await http.post('/api/auth/login').send({ login: 'b@b.org', password: 'Admin12345', organization: 'org-b' })).body.accessToken;
  });

  afterAll(async () => {
    await app.get(DataSource).destroy();
    await app.close();
  });

  const as = (t: string) => ({ Authorization: `Bearer ${t}` });

  it('exposes the five service levels with handling steps', async () => {
    const res = await http.get('/api/support/sla').set(as(org)).expect(200);
    expect(res.body.map((l: { name: string }) => l.name)).toEqual(['حرج جدًا', 'حرج', 'متوسط', 'عادي', 'منخفض']);
    expect(res.body[0].responseHours).toBe(1);
    expect(res.body[0].handling.length).toBeGreaterThan(2);
  });

  it('association submits a ticket with an attachment', async () => {
    await http.post('/api/support/tickets').set(as(org)).send({ subject: 'x', description: 'قصير', category: 'malfunction', priority: 'critical' }).expect(400);
    const res = await http.post('/api/support/tickets').set(as(org))
      .field('subject', 'تعذر تسجيل طلبات المستفيدين').field('description', 'تظهر رسالة خطأ عند حفظ أي طلب جديد منذ الصباح')
      .field('category', 'malfunction').field('priority', 'critical')
      .attach('file', Buffer.from('%PDF-1.4 x'), 'error.pdf').expect(201);
    ticketId = res.body.id;
    expect(res.body.number).toMatch(/^SR-\d{4}-0001$/);
    expect(res.body.status).toBe('new');
    expect(res.body.sla.response).toBe('on_track');
    const hours = (+new Date(res.body.sla.resolutionDueAt) - +new Date(res.body.createdAt)) / 3_600_000;
    expect(Math.round(hours)).toBe(8);
    expect(res.body.messages[0].file.name).toBe('error.pdf');
    await http.get(`/api/support/tickets/${ticketId}/messages/${res.body.messages[0].id}/file`).set(as(org)).expect(200);
    // جمعية أخرى لا ترى الطلب
    await http.get(`/api/support/tickets/${ticketId}`).set(as(other)).expect(404);
    expect((await http.get('/api/support/tickets').set(as(other))).body).toEqual([]);
    await http.get('/api/support-desk/tickets').set(as(org)).expect(403);
  });

  it('platform replies, reclassifies, waits on the association, and resolves', async () => {
    const inbox = await http.get('/api/support-desk/tickets?status=open').set(as(platform)).expect(200);
    expect(inbox.body[0].organization.name).toBe('جمعية org-a');

    await http.post(`/api/support-desk/tickets/${ticketId}/messages`).set(as(platform)).send({ body: 'ملاحظة للفريق', internal: true }).expect(201);
    let t = (await http.get(`/api/support-desk/tickets/${ticketId}`).set(as(platform))).body;
    expect(t.firstResponseAt).toBeNull();
    expect((await http.get(`/api/support/tickets/${ticketId}`).set(as(org))).body.messages).toHaveLength(1);

    t = (await http.post(`/api/support-desk/tickets/${ticketId}/messages`).set(as(platform))
      .send({ body: 'استلمنا طلبكم ونعمل عليه', status: 'waiting_customer' }).expect(201)).body;
    expect(t.sla.response).toBe('met');
    expect(t.status).toBe('waiting_customer');
    expect(t.sla.resolution).toBe('paused');

    await http.patch(`/api/support-desk/tickets/${ticketId}`).set(as(platform)).send({ priority: 'very_critical' }).expect(400);
    t = (await http.patch(`/api/support-desk/tickets/${ticketId}`).set(as(platform))
      .send({ priority: 'very_critical', priorityReason: 'يؤثر على جميع الموظفين' }).expect(200)).body;
    expect(t.priority).toBe('very_critical');
    expect(t.requestedPriority).toBe('critical');

    const team = (await http.get('/api/support-desk/assignees').set(as(platform))).body;
    t = (await http.patch(`/api/support-desk/tickets/${ticketId}`).set(as(platform)).send({ assigneeId: team[0].id }).expect(200)).body;
    expect(t.assigneeName).toBe('مدير المنصة');

    // رد الجمعية يعيد الطلب للمعالجة
    t = (await http.post(`/api/support/tickets/${ticketId}/messages`).set(as(org)).send({ body: 'المشكلة تظهر في شاشة الطلبات فقط' }).expect(201)).body;
    expect(t.status).toBe('in_progress');
    expect(t.messages.some((m: { body: string }) => m.body.includes('مستوى الخدمة'))).toBe(true);

    await http.post(`/api/support-desk/tickets/${ticketId}/escalate`).set(as(platform)).send({ note: 'يحتاج مطورًا' }).expect(200);
    t = (await http.patch(`/api/support-desk/tickets/${ticketId}`).set(as(platform)).send({ status: 'resolved' }).expect(200)).body;
    expect(t.status).toBe('resolved');
    expect(t.sla.resolution).toBe('met');
  });

  it('association reopens, then closes with a rating', async () => {
    let t = (await http.post(`/api/support/tickets/${ticketId}/reopen`).set(as(org)).send({ note: 'ما زالت تظهر' }).expect(200)).body;
    expect(t.status).toBe('in_progress');
    await http.patch(`/api/support-desk/tickets/${ticketId}`).set(as(platform)).send({ status: 'resolved' }).expect(200);
    t = (await http.post(`/api/support/tickets/${ticketId}/close`).set(as(org)).send({ rating: 5 }).expect(200)).body;
    expect(t.status).toBe('closed');
    expect(t.rating).toBe(5);
    await http.post(`/api/support/tickets/${ticketId}/messages`).set(as(org)).send({ body: 'شكرًا' }).expect(400);
  });

  it('flags breached tickets for escalation and reports compliance', async () => {
    const res = await http.post('/api/support/tickets').set(as(org))
      .send({ subject: 'استفسار عن الصلاحيات', description: 'كيف أضيف موظفًا جديدًا بصلاحية محددة؟', category: 'question', priority: 'normal' }).expect(201);
    // نرجع وقت التقديم للماضي لمحاكاة تجاوز المهلة
    await app.get(DataSource).query(
      `UPDATE support_tickets SET created_at = now() - interval '4 days', response_due_at = now() - interval '3 days', resolution_due_at = now() - interval '1 day' WHERE id = $1`,
      [res.body.id],
    );
    const t = (await http.get(`/api/support-desk/tickets/${res.body.id}`).set(as(platform))).body;
    expect(t.sla.response).toBe('breached');
    expect(t.sla.needsEscalation).toBe(true);

    const r = (await http.get('/api/support-desk/report').set(as(platform)).expect(200)).body;
    expect(r.totals.total).toBe(2);
    expect(r.totals.open).toBe(1);
    expect(r.totals.breached).toBe(1);
    expect(r.totals.avgRating).toBe(5);
    const vc = r.byPriority.find((p: { priority: string }) => p.priority === 'very_critical');
    expect(vc.responseCompliance).toBe(100);
    expect(r.attention).toHaveLength(1);
  });

  it('platform edits the service levels', async () => {
    const levels = (await http.get('/api/support-desk/sla').set(as(platform))).body;
    levels[4].resolutionHours = 240;
    await http.put('/api/support-desk/sla').set(as(platform)).send({ levels: [{ ...levels[0], resolutionHours: 0.5 }] }).expect(400);
    const saved = (await http.put('/api/support-desk/sla').set(as(platform)).send({ levels }).expect(200)).body;
    expect(saved[4].resolutionHours).toBe(240);
  });

  it('support desk: team roles, assignments, tasks with hours, and performance', async () => {
    // مدير المنصة يضيف موظف دعم
    await http.post('/api/support-desk/team').set(as(platform))
      .send({ fullName: 'موظف الدعم', email: 'agent@sanabel.test', password: 'Agent12345', role: 'support_agent' }).expect(201);
    const login = (await http.post('/api/auth/login').send({ login: 'agent@sanabel.test', password: 'Agent12345' }).expect(200)).body;
    const agent = login.accessToken;
    expect(login.user.permissions).toEqual(['support.work']);
    // موظف الدعم لا يدخل إدارة المنصة ولا إدارة الفريق ولا التقارير
    await http.get('/api/platform/organizations').set(as(agent)).expect(403);
    await http.get('/api/support-desk/team').set(as(agent)).expect(403);
    await http.get('/api/support-desk/performance').set(as(agent)).expect(403);
    await http.put('/api/support-desk/sla').set(as(agent)).send({ levels: [] }).expect(403);

    const open = (await http.get('/api/support-desk/tickets?status=open').set(as(agent)).expect(200)).body;
    const t = open.find((x: { assigneeId: string | null }) => !x.assigneeId);
    const team = (await http.get('/api/support-desk/assignees').set(as(agent))).body as { id: string; fullName: string }[];
    const agentId = login.user.id;
    const ownerId = team.find((u) => u.id !== agentId)!.id;
    // لا يوزّع على غيره ولا يغيّر المستوى، لكن يستلم الطلب لنفسه
    await http.patch(`/api/support-desk/tickets/${t.id}`).set(as(agent)).send({ assigneeId: ownerId }).expect(403);
    await http.patch(`/api/support-desk/tickets/${t.id}`).set(as(agent)).send({ priority: 'low', priorityReason: 'بسيط' }).expect(403);
    const taken = (await http.patch(`/api/support-desk/tickets/${t.id}`).set(as(agent)).send({ assigneeId: agentId }).expect(200)).body;
    expect(taken.assigneeName).toBe('موظف الدعم');
    await http.post(`/api/support-desk/tickets/${t.id}/messages`).set(as(agent)).send({ body: 'نعمل على المشكلة' }).expect(201);

    // مدير المنصة يكلّف الموظف بمهمة على الطلب، والموظف لا يكلّف غيره
    await http.post('/api/support-desk/tasks').set(as(agent)).send({ title: 'مهمة لغيري', assigneeId: ownerId }).expect(403);
    const task = (await http.post('/api/support-desk/tasks').set(as(platform))
      .send({ title: 'مراجعة سجلات الخطأ', ticketId: t.id, assigneeId: agentId, estimatedHours: 2 }).expect(201)).body;
    expect(task.number).toMatch(/^TK-\d{4}-0001$/);
    expect(task.ticket.id).toBe(t.id);
    expect(task.dueAt).toBe(taken.sla.resolutionDueAt);
    const mine = (await http.get('/api/support-desk/tasks').set(as(agent))).body;
    expect(mine).toHaveLength(1);
    let k = (await http.post(`/api/support-desk/tasks/${task.id}/hours`).set(as(agent)).send({ hours: 1.5, note: 'تحليل' }).expect(201)).body;
    expect(k.spentHours).toBe(1.5);
    expect(k.status).toBe('in_progress');
    await http.patch(`/api/support-desk/tasks/${task.id}`).set(as(agent)).send({ status: 'cancelled' }).expect(403);
    k = (await http.patch(`/api/support-desk/tasks/${task.id}`).set(as(agent)).send({ status: 'done' }).expect(200)).body;
    expect(k.completedAt).toBeTruthy();
    // الموعد كان متجاوزًا أصلًا (طلب متأخر)، فالمهمة متأخرة
    expect(k.onTime).toBe(false);
    const detail = (await http.get(`/api/support-desk/tickets/${t.id}`).set(as(agent))).body;
    expect(detail.tasks).toHaveLength(1);

    const perf = (await http.get('/api/support-desk/performance').set(as(platform)).expect(200)).body;
    const me = perf.members.find((m: { id: string }) => m.id === agentId);
    expect(me.responses).toBe(1);
    expect(me.responseCompliance).toBe(0);
    expect(me.tasksDone).toBe(1);
    expect(me.taskCompliance).toBe(0);
    expect(me.hoursLogged).toBe(1.5);
    expect(me.score).toBe(0);
    const owner = perf.members.find((m: { id: string }) => m.id === ownerId);
    expect(owner.responseCompliance).toBe(100);
    expect(owner.avgRating).toBe(5);

    const dash = (await http.get('/api/support-desk/dashboard').set(as(agent)).expect(200)).body;
    expect(dash.myTickets).toHaveLength(1);
    expect(dash.team).toBeUndefined();
    // إيقاف الموظف يمنع دخوله
    await http.patch(`/api/support-desk/team/${agentId}`).set(as(platform)).send({ isActive: false }).expect(200);
    await http.get('/api/support-desk/tickets').set(as(agent)).expect(401);
    await http.patch(`/api/support-desk/team/${ownerId}`).set(as(platform)).send({ role: 'support_agent' }).expect(403);
  });
});
