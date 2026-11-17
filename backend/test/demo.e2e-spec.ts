import { Test } from '@nestjs/testing';
import { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/main';
import { norm } from '../src/modules/projects/support.service';

/** الجمعية التجريبية: بيانات مترابطة عبر كل الأنظمة، وإعادة إنشائها */
const DB = process.env.TEST_DATABASE_URL ?? 'postgres://erp:erp@localhost:5432/charity_erp_test';

describe('Demo association across all modules', () => {
  let app: NestExpressApplication;
  let http: ReturnType<typeof request>;
  let platform: string;
  let demo: { staffPassword: string; portalPassword: string; portalUsers: { nationalId: string }[]; staff: { email: string }[]; supportTeam: { email: string }[] };
  const as = (t: string) => ({ Authorization: `Bearer ${t}` });
  const login = async (login: string, password: string, organization?: string) =>
    (await http.post('/api/auth/login').send({ login, password, organization }).expect(200)).body.accessToken as string;
  // رموز الدخول تُحفظ لكل موظف حتى لا يتجاوز الاختبار حد محاولات الدخول
  const tokens = new Map<string, string>();
  const staff = async (name: string) => {
    if (!tokens.has(name)) tokens.set(name, await login(`demo-${name}@sanabelerp.com`, demo.staffPassword, 'demo'));
    return tokens.get(name)!;
  };

  beforeAll(async () => {
    Object.assign(process.env, {
      DATABASE_URL: DB, JWT_SECRET: 'test-secret', PLATFORM_ADMIN_EMAIL: 'platform@test.org', PLATFORM_ADMIN_PASSWORD: 'Platform123',
      UPLOAD_DIR: '/tmp/sanabel-test-uploads',
    });
    const reset = new DataSource({ type: 'postgres', url: DB });
    await reset.initialize();
    await reset.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
    await reset.destroy();
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(moduleRef.createNestApplication<NestExpressApplication>());
    await app.init();
    http = request(app.getHttpServer());
    platform = await login('admin', 'Platform123');
  });

  afterAll(async () => {
    await app.get(DataSource).destroy();
    await app.close();
  });

  it('nationality matching ignores gender and the definite article', () => {
    expect(norm('السعودية')).toBe(norm('سعودي'));
    expect(norm('سعودية')).toBe(norm('سعودي'));
    expect(norm('مصرية')).toBe(norm('مصري'));
    expect(norm('يمني')).not.toBe(norm('سعودي'));
  });

  it('creates the demo association in one click', async () => {
    const res = await http.post('/api/platform/demo-organization').set(as(platform)).expect(201);
    demo = res.body;
    expect(res.body.organization.slug).toBe('demo');
    expect(demo.staff).toHaveLength(7);
    await http.post('/api/platform/demo-organization').set(as(platform)).expect(409);
  }, 90000);

  it('volunteers: registry, events in every stage, survey results, certificates, contracts and tickets', async () => {
    const admin = await staff('admin');
    const d = (await http.get('/api/volunteers/dashboard').set(as(admin)).expect(200)).body;
    expect(d.volunteers.active).toBeGreaterThanOrEqual(10);
    expect(d.volunteers.pending).toBe(2);
    expect(d.hours).toBeGreaterThan(0);
    expect(d.events.in_review).toBe(1);
    expect(d.satisfaction.beneficiary).toBeGreaterThan(0);
    const events = (await http.get('/api/volunteers/events').set(as(admin)).expect(200)).body;
    const statuses = new Set(events.map((e: { status: string }) => e.status));
    ['closed', 'approved', 'in_review', 'returned', 'draft'].forEach((s) => expect(statuses.has(s)).toBe(true));
    expect(events.some((e: { kind: string }) => e.kind === 'online')).toBe(true);
    const certs = (await http.get('/api/volunteers/certificates').set(as(admin)).expect(200)).body;
    expect(certs.length).toBe(4);
    const contracts = (await http.get('/api/volunteers/contracts').set(as(admin)).expect(200)).body;
    expect(contracts.filter((c: { status: string }) => c.status === 'signed')).toHaveLength(2);
    const docs = (await http.get('/api/volunteers/documents').set(as(admin)).expect(200)).body;
    expect(docs.policy.current.version).toBe(1);
    expect(docs.charter.current.version).toBe(1);
    const r = (await http.get('/api/volunteers/reports').set(as(admin)).expect(200)).body;
    expect(r.volunteerHours.length).toBeGreaterThan(0);
  });

  it('hr: structure, approved jobs, employees with salaries, leaves and performance cards', async () => {
    const admin = await staff('admin');
    const s = (await http.get('/api/hr/structure').set(as(admin)).expect(200)).body;
    expect(s.levels).toHaveLength(3);
    expect(s.units.length).toBeGreaterThanOrEqual(8);
    const d = (await http.get('/api/hr/dashboard').set(as(admin)).expect(200)).body;
    expect(d.headcount).toBe(10);
    expect(d.alerts.length).toBeGreaterThan(0);
    expect(d.payroll.employerCost).toBeGreaterThan(d.payroll.gross);
    expect(d.pendingLeaves).toBeGreaterThan(0);
    const jobs = (await http.get('/api/hr/jobs').set(as(admin)).expect(200)).body;
    expect(jobs.filter((j: { status: string }) => j.status === 'draft')).toHaveLength(1);
    const perf = (await http.get('/api/hr/performance').set(as(admin)).expect(200)).body;
    expect(perf.cards.some((c: { status: string }) => c.status === 'approved')).toBe(true);
    expect(perf.cards.some((c: { status: string }) => c.status === 'evaluated')).toBe(true);
    const plans = (await http.get('/api/hr/plans').set(as(admin)).expect(200)).body;
    expect(plans.totals.positions).toBe(2);
  });

  it('hr: attendance, salary items with accounts, and payroll sheets linked to accounting', async () => {
    const admin = await staff('admin');
    const types = (await http.get('/api/hr/allowance-types').set(as(admin)).expect(200)).body;
    expect(types.every((t: { expenseAccountId: string | null; cashAccountId: string | null }) => t.expenseAccountId && t.cashAccountId)).toBe(true);
    const month = new Date(Date.now() + 3 * 3600000).toISOString().slice(0, 7);
    const att = (await http.get(`/api/hr/attendance?month=${month}`).set(as(admin)).expect(200)).body;
    expect(att.config.enabled).toBe(true);
    const runs = (await http.get('/api/hr/payroll-runs').set(as(admin)).expect(200)).body;
    expect(runs.find((r: { month: string }) => r.month === month).status).toBe('draft');
    const approved = runs.find((r: { status: string }) => r.status === 'approved');
    if (approved) {
      const r = (await http.get(`/api/hr/payroll-runs/${approved.id}`).set(as(admin)).expect(200)).body;
      expect(r.entry.status).toBe('posted');
      expect(r.vouchers.length).toBeGreaterThanOrEqual(3);
      expect(Math.round(r.vouchers.reduce((s: number, v: { amount: number }) => s + v.amount, 0) * 100) / 100).toBe(r.totals.net);
      expect(r.lines.some((l: { attendance: { absentDays: number } }) => l.attendance.absentDays > 0)).toBe(true);
    }
  });

  it('accounting: unified chart, approved and pending vouchers, a balanced trial balance', async () => {
    const finance = await staff('finance');
    const accounts = await http.get('/api/accounting/accounts').set(as(finance)).expect(200);
    expect(accounts.body.accounts.length).toBeGreaterThan(1300);
    const receipts = await http.get('/api/accounting/vouchers/receipt').set(as(finance)).expect(200);
    expect(receipts.body.counts.approved.count).toBeGreaterThan(0);
    expect(receipts.body.counts.cancelled.count).toBe(1);
    expect(receipts.body.counts.pending.count).toBeGreaterThan(0);
    const tb = await http.get('/api/accounting/reports/trial-balance?level=1').set(as(finance)).expect(200);
    expect(tb.body.totals.debit).toBe(tb.body.totals.credit);
    expect(tb.body.totals.debit).toBeGreaterThan(0);
    // الشهور المغلقة متتالية من بداية السنة، وفي العمليات قيد تسوية
    const setup = await http.get('/api/accounting/setup').set(as(finance)).expect(200);
    const periods = (await http.get(`/api/accounting/periods/${setup.body.years[0].id}`).set(as(finance)).expect(200)).body.months as { closed: boolean }[];
    const closed = periods.map((m) => m.closed);
    expect(closed.indexOf(false) === -1 || closed.slice(closed.indexOf(false)).every((c) => !c)).toBe(true);
    if (new Date().getMonth() > 0) {
      expect((await http.get('/api/accounting/entries?type=adjustment').set(as(finance)).expect(200)).body).toHaveLength(1);
    }
  });

  it('accounting: a custom document type of the association with its own numbering', async () => {
    const finance = await staff('finance');
    const types = (await http.get('/api/accounting/document-types').set(as(finance)).expect(200)).body as { code: string; name: string; entries: number }[];
    expect(types).toHaveLength(1);
    expect(types[0]).toMatchObject({ name: 'سند عهدة نثرية', entries: 2 });
    const rows = (await http.get(`/api/accounting/entries?type=${types[0].code}`).set(as(finance)).expect(200)).body as { voucherNo: string }[];
    expect(rows.map((r) => r.voucherNo.split('/')[0]).sort()).toEqual(['1', '2']);
  });

  it('support desk: a support team with tickets in every state and tasks', async () => {
    expect(demo.supportTeam).toHaveLength(2);
    const mgr = (await http.post('/api/auth/login').send({ login: demo.supportTeam[0].email, password: demo.staffPassword }).expect(200)).body.accessToken;
    const tickets = (await http.get('/api/support-desk/tickets').set(as(mgr)).expect(200)).body as { status: string }[];
    expect(new Set(tickets.map((t) => t.status))).toEqual(new Set(['new', 'in_progress', 'waiting_customer', 'closed']));
    const tasks = (await http.get('/api/support-desk/tasks').set(as(mgr)).expect(200)).body as { status: string; overdue: boolean }[];
    expect(tasks.some((t) => t.status === 'done')).toBe(true);
    expect(tasks.some((t) => t.overdue)).toBe(true);
  });

  it('beneficiaries: cases in every stage, portal and accounting', async () => {
    const admin = await staff('admin');
    const board = await http.get('/api/beneficiaries/requests/board').set(as(admin)).expect(200);
    expect(board.body.byStatus).toMatchObject({ approved: 3, rejected: 1, returned: 1, in_progress: 3 });
    expect((await http.get('/api/beneficiaries/stats').set(as(admin)).expect(200)).body.beneficiaries).toBe(6);

    const t = (await http.post('/api/portal/o/demo/login').send({ nationalId: demo.portalUsers[0].nationalId, password: demo.portalPassword }).expect(200)).body.accessToken;
    const mine = (await http.get('/api/portal/requests').set(as(t)).expect(200)).body;
    expect(mine[0].status).toBe('approved');
    // المشاريع ذات الصرف العام لا تظهر في البوابة
    const info = (await http.get('/api/portal/o/demo').expect(200)).body;
    expect(info.projects.map((p: { name: string }) => p.name).sort()).toEqual(['الحقيبة المدرسية', 'دعم العمليات الجراحية', 'سلة رمضان', 'كفالة الأرامل', 'كفالة الأيتام'].sort());

    const t2 = (await http.post('/api/portal/o/demo/login').send({ nationalId: demo.portalUsers[1].nationalId, password: demo.portalPassword }).expect(200)).body.accessToken;
    const surgery = (await http.get('/api/portal/requests').set(as(t2))).body.find((r: { contributionStatus: string }) => r.contributionStatus === 'awaiting');
    const detail = (await http.get(`/api/portal/requests/${surgery.id}`).set(as(t2))).body;
    expect(detail.contribution).toMatchObject({ percent: 30, requiredAmount: 7500 });
    expect(detail.caseFile).toBeUndefined();
    // الموظف يرى ملف الحالة كاملًا قبل القرار: الأسرة والمستندات والمساعدات والطلبات الأخرى
    const staffView = (await http.get(`/api/beneficiaries/requests/${surgery.id}`).set(as(admin)).expect(200)).body;
    expect(staffView.caseFile).toMatchObject({ family: expect.any(Array), documents: expect.any(Array), aids: expect.any(Array), otherRequests: expect.any(Array) });
    expect(staffView.caseFile.otherRequests.every((o: { id: string }) => o.id !== surgery.id)).toBe(true);
    expect((await http.get('/api/beneficiaries/settings/accounting').set(as(admin)).expect(200)).body.debitAccountCode).toBe('1101');
  });

  it('projects: approved tree with pending, returned and draft examples', async () => {
    const pm = await staff('projects');
    const list = (await http.get('/api/projects/list').set(as(pm)).expect(200)).body as { name: string; approvalStatus: string }[];
    const status = Object.fromEntries(list.map((p) => [p.name, p.approvalStatus]));
    expect(status).toMatchObject({
      'كفالة الأيتام': 'approved', 'تشغيل مقر الجمعية': 'approved', 'حملة التوعية بمرض السكري': 'approved',
      'ترميم منازل الأسر المتعففة': 'pending', 'دورات التأهيل المهني': 'returned', 'سقيا الماء': 'draft',
    });
    // قيد الاعتماد في المرحلة الثانية (اعتماد المدير التنفيذي)
    const admin = await staff('admin');
    const inbox = (await http.get('/api/projects/approvals/inbox').set(as(admin)).expect(200)).body;
    expect(inbox.map((p: { name: string; currentStage: { name: string } }) => [p.name, p.currentStage.name])).toEqual([['ترميم منازل الأسر المتعففة', 'اعتماد المدير التنفيذي']]);
  });

  it('fundraising: opportunities, batches, pledge collection and journal', async () => {
    const fin = await staff('finance');
    const opps = (await http.get('/api/fundraising/opportunities').set(as(fin)).expect(200)).body;
    const rows = (opps.items ?? opps) as { status: string }[];
    const count = (s: string) => rows.filter((o) => o.status === s).length;
    expect([count('approved'), count('in_progress'), count('returned')]).toEqual([5, 1, 1]);

    const batches = (await http.get('/api/fundraising/batches').set(as(fin)).expect(200)).body as { targetName: string; amount: number; reservedAmount: number; spentAmount: number; transferredAmount: number; status: string }[];
    const widows = batches.find((b) => b.targetName.endsWith('كفالة الأرامل') && b.status !== 'pending')!;
    expect(widows).toMatchObject({ amount: 36000, reservedAmount: 11000, spentAmount: 1000 });
    const ramadan = batches.find((b) => b.targetName.endsWith('سلة رمضان'))!;
    expect(ramadan.transferredAmount).toBe(4000);

    const journal = (await http.get('/api/fundraising/journal').set(as(fin)).expect(200)).body;
    const entries = (journal.items ?? journal) as unknown[];
    expect(entries.length).toBeGreaterThanOrEqual(10);
  });

  it('support: allocations, payments, transfers and amendments are linked', async () => {
    const pm = await staff('projects');
    const allocations = (await http.get('/api/projects-ops/support/allocations').set(as(pm)).expect(200)).body as { kind: string }[];
    expect(allocations.filter((a) => a.kind === 'request')).toHaveLength(2);
    expect(allocations.filter((a) => a.kind === 'general')).toHaveLength(2);
    // طلب معتمد ينتظر التحميل، ودفعة الداعم المناسبة متاحة له
    const queue = (await http.get('/api/projects-ops/support/queue').set(as(pm)).expect(200)).body as { id: string; outstanding: number }[];
    const waiting = queue.filter((q) => q.outstanding > 0);
    expect(waiting).toHaveLength(1);
    const options = (await http.get(`/api/projects-ops/support/requests/${waiting[0].id}/options`).set(as(pm)).expect(200)).body;
    expect(options.batches.some((b: { violations: string[] }) => b.violations.length === 0)).toBe(true);
    const payments = (await http.get('/api/projects-ops/payments').set(as(pm)).expect(200)).body as { status: string }[];
    expect(payments.filter((p) => p.status === 'paid')).toHaveLength(4);
    expect(payments.filter((p) => p.status === 'pending')).toHaveLength(1);
    expect((await http.get('/api/projects-ops/transfers').set(as(pm)).expect(200)).body).toHaveLength(1);
    expect((await http.get('/api/projects-ops/amendments').set(as(pm)).expect(200)).body).toHaveLength(1);

    // الصرف التنفيذي سجّل المساعدة في ملف المستفيد
    const admin = await staff('admin');
    const portalUser = demo.portalUsers[0];
    const found = (await http.get('/api/beneficiaries').query({ search: portalUser.nationalId }).set(as(admin)).expect(200)).body;
    const id = (found.items ?? found)[0].id;
    const profile = (await http.get(`/api/beneficiaries/${id}`).set(as(admin)).expect(200)).body;
    expect(profile.aids).toHaveLength(1);
    expect(profile.aids[0]).toMatchObject({ amount: 1000, referenceNo: 'PV-1001' });
  });

  it('pledge batches are deferred donations: spent before collection, still owed by the donor', async () => {
    const admin = await staff('admin');
    const fin = await staff('finance');
    const pm = await staff('projects');
    const allocations = (await http.get('/api/projects-ops/support/allocations').set(as(pm)).expect(200)).body as { id: string; kind: string; activityName?: string; amount: number }[];
    const ops = allocations.find((a) => a.kind === 'general' && a.amount === 30000)!;
    // سدد الداعم 10,000 وصُرف منها 8,000، ويُصرف 5,000 أخرى قبل سدادها
    await http.post('/api/projects-ops/payments/direct').set(as(fin)).send({
      allocationId: ops.id, amount: 5000, method: 'voucher', payeeKind: 'other', payeeName: 'شركة الكهرباء', referenceNo: 'PV-9999',
    }).expect(201);
    const donors = (await http.get('/api/fundraising/donors').query({ search: 'مؤسسة البر' }).set(as(admin)).expect(200)).body.items as { id: string }[];
    const donor = (await http.get(`/api/fundraising/donors/${donors[0].id}`).set(as(admin)).expect(200)).body;
    expect(donor.receivable).toBe(20000); // يبقى المتبقي من الوعد مستحقًا على الداعم
  });

  it('platform: signed contract, active subscription and pending applications', async () => {
    const apps = (await http.get('/api/platform/applications').set(as(platform)).expect(200)).body as { status: string; orgName: string }[];
    expect(apps.map((a) => a.status).sort()).toEqual(['approved', 'returned', 'submitted']);
    const contracts = (await http.get('/api/platform/contracts').set(as(platform)).expect(200)).body as { status: string }[];
    expect(contracts.map((c) => c.status)).toEqual(['signed']);
    const orgs = (await http.get('/api/platform/organizations').set(as(platform)).expect(200)).body as { slug: string; subscriptionStatus: string }[];
    expect(orgs.find((o) => o.slug === 'demo')?.subscriptionStatus).toBe('active');
  });

  it('resets the demo association and creates it again', async () => {
    await http.delete('/api/platform/demo-organization').set(as(platform)).expect(204);
    await http.delete('/api/platform/demo-organization').set(as(platform)).expect(404);
    expect((await http.get('/api/platform/applications').set(as(platform)).expect(200)).body).toHaveLength(0);
    const again = await http.post('/api/platform/demo-organization').set(as(platform)).expect(201);
    expect(again.body.organization.slug).toBe('demo');
  }, 90000);
});
