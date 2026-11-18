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
    expect(demo.staff).toHaveLength(8);
    await http.post('/api/platform/demo-organization').set(as(platform)).expect(409);
  }, 90000);

  it('risk: register with reviews, changes with tasks, compliance, continuity and an active crisis', async () => {
    const admin = await staff('admin');
    const d = (await http.get('/api/risk/dashboard').set(as(admin)).expect(200)).body;
    expect(d.risks.total).toBeGreaterThanOrEqual(10);
    const rep = (await http.get('/api/risk/reports').set(as(admin)).expect(200)).body;
    expect(rep.risks.trend.filter((t: { avg: number | null }) => t.avg != null).length).toBeGreaterThan(6);
    expect(rep.compliance.openGaps.length).toBeGreaterThanOrEqual(2);
    expect(rep.changes.tasks.total).toBeGreaterThanOrEqual(5);
    expect((await http.get('/api/risk/approvals').set(as(admin)).expect(200)).body.length).toBeGreaterThanOrEqual(2);
    const teams = (await http.get('/api/risk/crisis-teams').set(as(admin)).expect(200)).body;
    expect(teams.find((t: { activeEvent: unknown }) => t.activeEvent)).toBeTruthy();
    const policy = (await http.get('/api/risk/policy').set(as(admin)).expect(200)).body;
    expect(policy.history).toHaveLength(2);
    const m = (await http.get('/api/risk/methodologies').set(as(admin)).expect(200)).body;
    expect(m.items.find((x: { code: string }) => x.code === 'MTH-RSK').history).toHaveLength(2);
    expect((await http.get('/api/risk/procedures').set(as(admin)).expect(200)).body.some((p: { status: string }) => p.status === 'approved')).toBe(true);
  });

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

  it('hr: development plans in different stages, competency gaps and the second line', async () => {
    const admin = await staff('admin');
    const plans = (await http.get('/api/hr/dev-plans').set(as(admin)).expect(200)).body as { status: string; kind: string }[];
    expect(new Set(plans.map((p) => p.status))).toEqual(new Set(['approved', 'pending', 'draft', 'completed']));
    expect(plans.some((p) => p.kind === 'succession')).toBe(true);
    const gaps = (await http.get('/api/hr/development/gaps').set(as(admin)).expect(200)).body;
    expect(gaps.topGaps.length).toBeGreaterThan(0);
    const s = (await http.get('/api/hr/succession').set(as(admin)).expect(200)).body;
    expect(s.totals.none).toBeGreaterThan(0);
    expect(s.totals.ready).toBeGreaterThan(0);
    expect(s.rows.filter((r: { candidates: unknown[] }) => r.candidates.length).length).toBeGreaterThanOrEqual(4);
  });

  it('hr: attendance, salary items with accounts, and payroll sheets linked to accounting', async () => {
    const admin = await staff('admin');
    const types = (await http.get('/api/hr/allowance-types').set(as(admin)).expect(200)).body;
    expect(types.every((t: { payableAccountId: string | null; cashAccountId: string | null }) => t.payableAccountId && t.cashAccountId)).toBe(true);
    const profiles = (await http.get('/api/hr/expense-profiles').set(as(admin)).expect(200)).body as { name: string; jobs: number }[];
    expect(profiles.map((p) => p.name)).toEqual(expect.arrayContaining(['المصروفات الإدارية', 'البرامج والأنشطة', 'جمع الأموال']));
    expect(profiles.every((p) => p.jobs > 0)).toBe(true);
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

  it('hr self-service: linked accounts, requests in every stage, approvals by reporting line and the bell', async () => {
    const researcher = await staff('researcher');
    const me = (await http.get('/api/hr/me').set(as(researcher)).expect(200)).body;
    expect(me.employee.fullName).toBeTruthy();
    expect(me.service.totalDays).toBeGreaterThan(600);
    expect(me.balances.find((b: { code: string }) => b.code === 'annual')).toBeTruthy();
    expect(me.types.map((t: { kind: string }) => t.kind)).toEqual(expect.arrayContaining(['leave', 'permission', 'letter', 'advance', 'general']));
    // الباحثة سعودية: تأشيرة الخروج والعودة لغير السعوديين فقط فلا تظهر لها
    expect(me.types.some((t: { kind: string }) => t.kind === 'exit_reentry')).toBe(false);
    const mine = (await http.get('/api/hr/me/requests').set(as(researcher)).expect(200)).body as { kind: string; status: string; id: string }[];
    const letter = mine.find((r) => r.kind === 'letter')!;
    expect(letter.status).toBe('approved');
    const lv = (await http.get(`/api/hr/me/requests/${letter.id}`).set(as(researcher)).expect(200)).body;
    expect(lv.result.body).toContain('مصرف الراجحي');
    expect(lv.can.print).toBe(true);
    // مدير البرامج: فريقه وطلب الإجازة بانتظاره، وجرس المهام
    const manager = await staff('manager');
    const team = (await http.get('/api/hr/me/team').set(as(manager)).expect(200)).body;
    expect(team.stats.team).toBeGreaterThanOrEqual(3);
    expect(team.awaiting.length).toBeGreaterThanOrEqual(2);
    const bell = (await http.get('/api/tasks').set(as(manager)).expect(200)).body;
    expect(bell.groups.find((g: { module: string }) => g.module === 'hr').items.some((i: { link: string }) => i.link.startsWith('/me/requests/'))).toBe(true);
    // الطلب المعاد يظهر لصاحبه في الجرس
    const quality = await staff('quality');
    const qb = (await http.get('/api/tasks').set(as(quality)).expect(200)).body;
    expect(qb.groups.find((g: { module: string }) => g.module === 'hr').items.some((i: { group: string }) => i.group === 'طلباتي المعادة')).toBe(true);
    // السلفة المعتمدة وقسطها في مسير الرواتب
    const fund = await staff('fundraising');
    const fd = (await http.get('/api/hr/me').set(as(fund)).expect(200)).body;
    expect(fd.advances.total).toBe(6000);
    const admin = await staff('admin');
    const runs = (await http.get('/api/hr/payroll-runs').set(as(admin)).expect(200)).body as { id: string; month: string; status: string }[];
    const month = new Date(Date.now() + 3 * 3600000).toISOString().slice(0, 7);
    const cur = (await http.get(`/api/hr/payroll-runs/${runs.find((r) => r.month === month)!.id}`).set(as(admin)).expect(200)).body;
    expect(cur.totals.advanceDeduction).toBe(1000);
    if (runs.some((r) => r.status === 'approved')) expect(fd.advances.paid).toBe(1000);
    const all = (await http.get('/api/hr/requests').set(as(await staff('finance'))).expect(200)).body;
    expect(all.counts.pending).toBeGreaterThanOrEqual(3);
    expect(all.counts.returned).toBe(1);
  });

  it('internal audit: risk-based plans, engagements in every stage and timed recommendations', async () => {
    const auditor = await staff('auditor');
    const plans = (await http.get('/api/audit/plans').set(as(auditor)).expect(200)).body;
    expect(plans).toHaveLength(1);
    expect(plans[0].status).toBe('approved');
    expect(plans[0].subs.map((p: { status: string }) => p.status).sort()).toEqual(['approved', 'approved', 'submitted']);
    const engs = (await http.get('/api/audit/engagements').set(as(auditor)).expect(200)).body as { status: string }[];
    expect(new Set(engs.map((e) => e.status))).toEqual(new Set(['issued', 'closed', 'fieldwork', 'planned']));
    const acts = (await http.get('/api/audit/actions').set(as(auditor)).expect(200)).body;
    expect(acts.counts).toEqual({ active: 4, overdue: 1, submitted: 1, closed: 1 });
    // المدير المالي يرى التوصيات المسندة إليه وغير المسندة لشخص فقط
    const fin = (await http.get('/api/audit/actions').set(as(await staff('finance'))).expect(200)).body;
    expect(fin.items.length).toBeGreaterThanOrEqual(3);
    expect(fin.items.some((a: { assigneeName: string | null }) => a.assigneeName === 'سارة القحطاني')).toBe(false);
    const dash = (await http.get('/api/audit/dashboard').set(as(auditor)).expect(200)).body;
    expect(dash.risk.areas.total).toBe(9);
    expect(dash.actions.aging[0].n).toBe(1);
  });

  it('quality: documents of the QMS itself with maps, audits, nonconformities, complaints, surveys and reviews', async () => {
    const q = await staff('quality');
    const docs = (await http.get('/api/quality/documents').set(as(q)).expect(200)).body;
    const codes = docs.rows.map((d: { code: string }) => d.code);
    for (const c of ['QM-QMS-01', 'QP-QMS-01', 'QP-QMS-02', 'QP-QMS-03', 'QP-QMS-06', 'QF-BEN-01', 'QF-BEN-02']) expect(codes).toContain(c);
    const p6 = docs.rows.find((d: { code: string }) => d.code === 'QP-QMS-06');
    expect(p6.revisionLabel).toBe('Rev.01');
    expect(docs.rows.some((d: { status: string }) => d.status === 'approval')).toBe(true);
    expect(docs.rows.some((d: { status: string; source: string }) => d.status === 'draft' && d.source === 'quality')).toBe(true);
    const maps = (await http.get('/api/quality/maps').set(as(q)).expect(200)).body;
    expect(maps.length).toBeGreaterThanOrEqual(8);
    expect(maps.every((m: { document: unknown }) => m.document)).toBe(true);
    const ncrs = (await http.get('/api/quality/ncrs').set(as(q)).expect(200)).body;
    for (const st of ['open', 'action', 'verification', 'closed']) expect(ncrs.some((n: { status: string }) => n.status === st)).toBe(true);
    const complaints = (await http.get('/api/quality/complaints').set(as(q)).expect(200)).body;
    expect(complaints.rows.some((c: { channel: string }) => c.channel === 'portal')).toBe(true);
    expect(complaints.rows.some((c: { externalRef: string | null }) => c.externalRef?.startsWith('VOL-TKT:'))).toBe(true);
    expect(complaints.pendingImports).toBe(0);
    const dash = (await http.get('/api/quality/dashboard').set(as(q)).expect(200)).body;
    expect(dash.kpis.satisfaction).toBeGreaterThan(50);
    expect(dash.kpis.compliance).toBeGreaterThanOrEqual(80);
    const reviews = (await http.get('/api/quality/reviews').set(as(q)).expect(200)).body;
    expect(reviews.map((r: { status: string }) => r.status).sort()).toEqual(['approved', 'draft']);
    const st = (await http.get('/api/quality/standard').set(as(q)).expect(200)).body;
    const gaps = st.sections.flatMap((s: { clauses: { code: string; status: string }[] }) => s.clauses).filter((c: { status: string }) => c.status === 'gap');
    expect(gaps.map((c: { code: string }) => c.code)).toEqual([]);
  });

  it('members: registry in every status, applications in every stage, payments as receipt vouchers', async () => {
    const admin = await staff('admin');
    const d = (await http.get('/api/members/dashboard').set(as(admin)).expect(200)).body;
    expect(d.members.current).toBeGreaterThanOrEqual(10);
    expect(d.members.grace).toBeGreaterThan(0);
    expect(d.members.expired).toBeGreaterThan(0);
    expect(d.members.suspended).toBe(1);
    expect(d.applications.inReview).toBeGreaterThanOrEqual(3);
    expect(d.applications.returned).toBe(1);
    expect(d.applications.awaitingPayment).toBeGreaterThanOrEqual(2);
    expect(d.invoices.review).toBeGreaterThanOrEqual(2);
    const inv = (await http.get('/api/members/invoices?status=paid').set(as(admin)).expect(200)).body as { method: string; voucher: unknown; voucherError: string | null }[];
    expect(new Set(inv.map((i) => i.method))).toEqual(new Set(['cash', 'online', 'transfer']));
    expect(inv.every((i) => i.voucher && !i.voucherError)).toBe(true);
    const ren = (await http.get('/api/members/renewals').set(as(admin)).expect(200)).body;
    expect(ren.rows.some((r: { reminderDue: boolean }) => r.reminderDue)).toBe(true);
    const asm = (await http.get('/api/members/assembly').set(as(admin)).expect(200)).body;
    expect(asm.eligible).toBeGreaterThan(0);
    expect(asm.pending.length).toBeGreaterThan(0);
  });

  it('governance: approved mock assessment, a quarterly draft, ledger-based financial indicators, alerts and an improvement plan', async () => {
    const admin = await staff('admin');
    const d = (await http.get('/api/governance/dashboard').set(as(admin)).expect(200)).body;
    expect(d.current.status).toBe('draft');
    expect(d.score.coverage).toBeGreaterThan(80);
    expect(d.score.coverage).toBeLessThan(100);
    expect(d.score.overall).toBeGreaterThan(50);
    expect(d.history.filter((h: { status: string }) => h.status === 'approved')).toHaveLength(1);
    expect(d.finance.forecast).toBeGreaterThan(40);
    expect(d.finance.indicators).toHaveLength(5);
    expect(d.opportunities.length).toBeGreaterThan(0);
    expect(d.actions.done).toBe(1);
    expect(d.actions.overdue).toBe(1);
    const al = (await http.get('/api/governance/alerts').set(as(admin)).expect(200)).body as { items: { key: string; level: string }[] };
    expect(al.items.some((x) => x.key === 'fact:license')).toBe(true);
    expect(al.items.some((x) => x.key.startsWith('obl:') && x.level === 'critical')).toBe(true);
    const all = (await http.get('/api/governance/alerts?all=1').set(as(admin)).expect(200)).body as { items: { acked?: unknown }[] };
    expect(all.items.length).toBeGreaterThan(al.items.length);
    const obl = (await http.get('/api/governance/obligations').set(as(admin)).expect(200)).body as { doneDate: string | null }[];
    expect(obl.length).toBe(34);
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
