import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { DataSource, In } from 'typeorm';
import { OrgUser } from '../../core/auth/decorators';
import { codeOf, AttendanceService } from './attendance.service';
import { HrEmployee, HrGrade, HrJob, HrLeaveRequest, HrPerformanceCard, HrRequest, HrUnit } from './entities/hr.entity';
import { HrCore, today } from './hr-core.service';
import { round2, serviceSpan } from './hr-policy';
import { CARD_STATUS_AR } from './performance.service';
import { CONTRACT_AR, LEAVE_STATUS_AR, PeopleService } from './people.service';
import { RequestsService } from './requests.service';
import { ACTION_AR } from './self-service';

/**
 * لوحة الموظف (الخدمة الذاتية) ولوحة المدير: بيانات الموظف ورصيد إجازاته وسلفه وراتبه وحضوره وتقييمه وآخر نشاطه،
 * وللمدير: موقعه في الهيكل والموظفون تحت إدارته وطلباتهم وما ينتظر قراره.
 */
@Injectable()
export class SelfServiceService {
  constructor(
    private readonly db: DataSource,
    private readonly core: HrCore,
    private readonly people: PeopleService,
    private readonly attendance: AttendanceService,
    private readonly requests: RequestsService,
  ) {}

  /** ملخص خفيف للواجهة: هل المستخدم موظف؟ وهل هو مدير؟ وكم مهمة تنتظره؟ */
  async summary(actor: OrgUser) {
    const me = await this.requests.me(actor);
    if (!me.employee) return { linked: false, employee: null, isManager: false, team: 0, awaiting: 0 };
    const line = await this.requests.line(actor.organizationId);
    const team = line.team(me.employee.id).length;
    return {
      linked: true,
      employee: { id: me.employee.id, fullName: me.employee.fullName, employeeNo: me.employee.employeeNo, gender: me.employee.gender },
      isManager: team > 0, team, awaiting: (await this.requests.awaiting(me)).length,
    };
  }

  private async basics(org: string, e: HrEmployee) {
    const [job, unit, grade] = await Promise.all([
      this.db.getRepository(HrJob).findOne({ where: { id: e.jobId } }),
      this.db.getRepository(HrUnit).findOne({ where: { id: e.unitId } }),
      e.gradeId ? this.db.getRepository(HrGrade).findOne({ where: { id: e.gradeId } }) : null,
    ]);
    const line = await this.requests.line(org);
    const managerId = line.managerOf(e.id);
    return {
      id: e.id, employeeNo: e.employeeNo, fullName: e.fullName, gender: e.gender, nationality: e.nationality, isSaudi: e.isSaudi, nationalId: e.nationalId,
      phone: e.phone, email: e.email, birthDate: e.birthDate, jobTitle: job?.title ?? '', jobCode: job?.code ?? '', unitName: unit?.name ?? '',
      gradeName: grade ? `${grade.code} ${grade.name}` : null, step: e.step, managerName: managerId ? line.employees.get(managerId)?.fullName ?? null : null,
      hireDate: e.hireDate, contractType: e.contractType, contractTypeLabel: CONTRACT_AR[e.contractType], contractEnd: e.contractEnd, probationEnd: e.probationEnd,
      idExpiry: e.idExpiry, passportExpiry: e.passportExpiry, gosiNumber: e.gosiNumber, status: e.status,
      iban: e.iban ? `${e.iban.slice(0, 4)} •••• ${e.iban.slice(-4)}` : null,
    };
  }

  /** حضور الشهر الحالي وآخر الأيام */
  private async attendanceOf(org: string, e: HrEmployee) {
    const t = today();
    const month = t.slice(0, 7);
    const { cfg, result } = await this.attendance.compute(org, month, [e]);
    const r = result.get(e.id)!;
    const todayPunches: { t: string }[] = await this.db.query(
      'SELECT punch_time AS t FROM hr_attendance_punches WHERE organization_id = $1 AND attendance_code = $2 AND punch_date = $3 ORDER BY punch_time', [org, codeOf(e), t],
    );
    return {
      enabled: cfg.enabled, tracked: r.tracked, workStart: cfg.workStart, workEnd: cfg.workEnd, month,
      totals: { workDays: r.workDays, presentDays: r.presentDays, absentDays: r.absentDays, leaveDays: r.leaveDays, lateMinutes: r.lateMinutes, earlyMinutes: r.earlyMinutes, missingOut: r.missingOut },
      today: { checkIn: todayPunches[0]?.t ?? null, checkOut: todayPunches.length > 1 ? todayPunches[todayPunches.length - 1].t : null },
      recent: r.days.filter((d) => d.date <= t && d.status !== 'no_data' && d.status !== 'not_employed').slice(-10).reverse()
        .map((d) => ({ date: d.date, status: d.status, checkIn: d.checkIn, checkOut: d.checkOut, late: d.late, early: d.early })),
    };
  }

  async dashboard(actor: OrgUser) {
    const me = await this.requests.requireEmployee(actor);
    const e = me.employee;
    const org = actor.organizationId;
    const t = today();
    const policy = await this.core.policy(org);
    const [basics, balances, attendance, cards, reqs, leaves, advances, types, awaiting] = await Promise.all([
      this.basics(org, e),
      this.people.balances(org, e, policy, t),
      this.attendanceOf(org, e),
      this.db.getRepository(HrPerformanceCard).find({ where: { organizationId: org, employeeId: e.id }, order: { year: 'DESC' }, take: 3 }),
      this.db.getRepository(HrRequest).find({ where: { organizationId: org, employeeId: e.id }, order: { updatedAt: 'DESC' }, take: 40 }),
      this.db.getRepository(HrLeaveRequest).find({ where: { organizationId: org, employeeId: e.id }, order: { startDate: 'DESC' }, take: 10 }),
      this.requests.advances(org, { employeeId: e.id }),
      this.requests.availableTypes(org, e),
      this.requests.awaiting(me),
    ]);
    const salary = this.people.breakdown(policy, e, t);
    const line = await this.requests.line(org);
    const team = line.team(e.id);
    const card = cards.find((c) => c.status === 'approved') ?? cards[0] ?? null;

    // آخر نشاط: حركة الطلبات والإجازات والتقييم
    const activity: { at: string; text: string; kind: string; link?: string }[] = [];
    for (const r of reqs) {
      for (const h of r.history.slice(-3)) {
        activity.push({ at: h.at, kind: r.kind, link: `/me/requests/${r.id}`, text: `${ACTION_AR[h.action] ?? h.action}: ${r.typeName} رقم ${r.requestNo}${h.actorName !== actor.fullName ? ` (${h.actorName})` : ''}` });
      }
    }
    for (const l of leaves.filter((x) => !x.requestId)) {
      activity.push({ at: (l.decidedAt ?? l.createdAt).toISOString(), kind: 'leave', text: `${policy.leaveTypes.find((x) => x.code === l.leaveType)?.name ?? l.leaveType} من ${l.startDate}: ${LEAVE_STATUS_AR[l.status]}` });
    }
    for (const c of cards) activity.push({ at: (c.approvedAt ?? c.evaluatedAt ?? c.agreedAt ?? c.createdAt).toISOString(), kind: 'performance', text: `بطاقة أداء ${c.year}: ${CARD_STATUS_AR[c.status]}${c.finalScore !== null ? ` (${c.finalScore})` : ''}` });
    if (attendance.today.checkIn) activity.push({ at: `${t}T${attendance.today.checkIn}:00+03:00`, kind: 'attendance', text: `بصمة حضور اليوم ${attendance.today.checkIn}` });
    activity.sort((a, b) => b.at.localeCompare(a.at));

    const upcoming = leaves.filter((l) => l.status === 'approved' && l.endDate >= t).map((l) => ({
      leaveType: policy.leaveTypes.find((x) => x.code === l.leaveType)?.name ?? l.leaveType, startDate: l.startDate, endDate: l.endDate, days: l.days,
    }));
    const alerts: { level: 'danger' | 'warning' | 'info'; text: string }[] = [];
    const within = (d: string | null, n: number) => !!d && d >= t && d <= new Date(Date.parse(`${t}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
    if (e.idExpiry && e.idExpiry < t) alerts.push({ level: 'danger', text: `${e.isSaudi ? 'هويتك' : 'إقامتك'} منتهية، راجع شؤون الموظفين` });
    else if (within(e.idExpiry, 60)) alerts.push({ level: 'warning', text: `${e.isSaudi ? 'هويتك' : 'إقامتك'} تنتهي في ${e.idExpiry}` });
    if (within(e.contractEnd, 60)) alerts.push({ level: 'warning', text: `عقدك ينتهي في ${e.contractEnd}` });
    if (within(e.probationEnd, 30)) alerts.push({ level: 'info', text: `فترة التجربة تنتهي في ${e.probationEnd}` });
    const returned = reqs.filter((r) => r.status === 'returned');
    // ملف إنهاء الخدمة المفتوح: يتابع الموظف إخلاء طرفه ومستحقاته
    const [sep]: { id: string; separation_no: number; status: string; last_working_day: string; total: number; cleared: number }[] = await this.db.query(
      `SELECT id, separation_no, status, last_working_day::text, jsonb_array_length(items) AS total,
              (SELECT COUNT(*)::int FROM jsonb_array_elements(items) x WHERE x->>'status' = 'cleared') AS cleared
         FROM hr_separations WHERE organization_id = $1 AND employee_id = $2 AND status <> 'cancelled' ORDER BY created_at DESC LIMIT 1`, [org, e.id],
    );
    const separation = sep ? { id: sep.id, separationNo: sep.separation_no, status: sep.status, lastWorkingDay: sep.last_working_day, items: sep.total, cleared: sep.cleared } : null;
    if (separation && separation.status !== 'paid') alerts.push({ level: 'info', text: `ملف إنهاء خدمتك مفتوح: أُخلي ${separation.cleared} من ${separation.items} بنود، وآخر يوم عمل ${separation.lastWorkingDay}` });
    if (returned.length) alerts.push({ level: 'warning', text: `لديك ${returned.length} ${returned.length > 1 ? 'طلبات معادة' : 'طلب معاد'} للتعديل` });

    const adv = advances.filter((a) => a.status === 'active');
    return {
      employee: basics,
      service: { ...serviceSpan(e.hireDate, t), hireDate: e.hireDate },
      balances: balances.filter((b) => b.eligible && (b.entitlement !== null || b.taken > 0 || b.pending > 0)),
      advances: {
        total: round2(adv.reduce((s, a) => s + a.amount, 0)), paid: round2(adv.reduce((s, a) => s + a.paid, 0)), remaining: round2(adv.reduce((s, a) => s + a.remaining, 0)),
        items: adv.filter((a) => a.remaining > 0),
      },
      salary: { items: salary.items, gross: salary.gross, gosiEmployee: salary.gosi.employee.total, net: salary.net, dailyWage: salary.dailyWage },
      attendance,
      performance: card ? {
        id: card.id, year: card.year, status: card.status, statusLabel: CARD_STATUS_AR[card.status], finalScore: card.finalScore, rating: card.rating,
        objectives: card.objectives.length, history: cards.map((c) => ({ year: c.year, finalScore: c.finalScore, rating: c.rating, statusLabel: CARD_STATUS_AR[c.status] })),
      } : null,
      requests: {
        pending: reqs.filter((r) => r.status === 'pending').length, returned: returned.length,
        approvedThisYear: reqs.filter((r) => r.status === 'approved' && String(r.decidedAt?.toISOString() ?? '').startsWith(t.slice(0, 4))).length,
        recent: reqs.slice(0, 6).map((r) => this.requests.row(r)),
      },
      upcoming, alerts, activity: activity.slice(0, 12), types, separation,
      manager: { isManager: team.length > 0, direct: line.direct(e.id).length, team: team.length, awaiting: awaiting.length },
    };
  }

  /** لوحة المدير: موقعه الوظيفي، فريقه، طلباتهم، وما ينتظر قراره */
  async team(actor: OrgUser) {
    const me = await this.requests.requireEmployee(actor);
    const org = actor.organizationId;
    const t = today();
    const line = await this.requests.line(org);
    const ids = line.team(me.employee.id);
    const direct = new Set(line.direct(me.employee.id));
    const [emps, jobs, units] = await Promise.all([
      ids.length ? this.db.getRepository(HrEmployee).find({ where: { id: In(ids) } }) : [],
      this.db.getRepository(HrJob).find({ where: { organizationId: org }, select: ['id', 'title'] }),
      this.db.getRepository(HrUnit).find({ where: { organizationId: org } }),
    ]);
    const onLeave = ids.length ? await this.db.getRepository(HrLeaveRequest).createQueryBuilder('l').where('l.organization_id = :org AND l.status = :s', { org, s: 'approved' })
      .andWhere('l.employee_id IN (:...ids)', { ids }).andWhere('l.start_date <= :t AND l.end_date >= :t', { t }).getMany() : [];
    const codes = emps.map(codeOf);
    const present: { code: string; first: string }[] = codes.length ? await this.db.query(
      `SELECT attendance_code AS code, MIN(punch_time) AS first FROM hr_attendance_punches WHERE organization_id = $1 AND punch_date = $2 AND attendance_code = ANY($3) GROUP BY attendance_code`,
      [org, t, codes],
    ) : [];
    const reqs = ids.length ? await this.db.getRepository(HrRequest).find({ where: { organizationId: org, employeeId: In(ids) }, order: { createdAt: 'DESC' }, take: 200 }) : [];
    const names = await this.requests.names(org);
    const awaiting = await this.requests.awaiting(me);
    const myJob = jobs.find((j) => j.id === me.employee.jobId);
    const managed = units.filter((u) => u.managerEmployeeId === me.employee.id);
    const policy = await this.core.policy(org);
    const leaveName = (c: string) => policy.leaveTypes.find((x) => x.code === c)?.name ?? c;
    const members = emps.map((x) => {
      const leave = onLeave.find((l) => l.employeeId === x.id);
      const p = present.find((r) => r.code === codeOf(x));
      return {
        id: x.id, employeeNo: x.employeeNo, fullName: x.fullName, gender: x.gender, jobTitle: jobs.find((j) => j.id === x.jobId)?.title ?? '',
        unitName: units.find((u) => u.id === x.unitId)?.name ?? '', direct: direct.has(x.id), managerName: names.get(line.managerOf(x.id) ?? '')?.fullName ?? null,
        today: leave ? { status: 'leave', label: `في ${leaveName(leave.leaveType)} حتى ${leave.endDate}` } : p ? { status: 'present', label: `حاضر منذ ${p.first}` } : x.attendanceExempt ? { status: 'exempt', label: 'معفى من البصمة' } : { status: 'unknown', label: 'لا توجد بصمة اليوم' },
        pending: reqs.filter((r) => r.employeeId === x.id && r.status === 'pending').length,
        hireDate: x.hireDate,
      };
    }).sort((a, b) => Number(b.direct) - Number(a.direct) || a.employeeNo - b.employeeNo);
    return {
      position: {
        fullName: me.employee.fullName, jobTitle: myJob?.title ?? '', unitName: units.find((u) => u.id === me.employee.unitId)?.name ?? '',
        managedUnits: managed.map((u) => u.name), managerName: names.get(line.managerOf(me.employee.id) ?? '')?.fullName ?? null,
      },
      stats: {
        team: members.length, direct: direct.size, onLeave: onLeave.length, present: members.filter((m) => m.today.status === 'present').length,
        awaiting: awaiting.length, pending: reqs.filter((r) => r.status === 'pending').length,
      },
      members,
      awaiting: awaiting.map((r) => this.requests.row(r, names)),
      requests: reqs.slice(0, 60).map((r) => this.requests.row(r, names)),
    };
  }

  /** ملف موظف من الفريق كما يراه مديره: بلا بيانات الراتب */
  async member(actor: OrgUser, id: string) {
    const me = await this.requests.requireEmployee(actor);
    const org = actor.organizationId;
    const line = await this.requests.line(org);
    if (!line.chain(id).includes(me.employee.id)) throw new ForbiddenException('هذا الموظف ليس ضمن فريقك');
    const e = await this.db.getRepository(HrEmployee).findOne({ where: { id, organizationId: org } });
    if (!e) throw new NotFoundException('الموظف غير موجود');
    const t = today();
    const policy = await this.core.policy(org);
    const basics = await this.basics(org, e);
    const [balances, attendance, cards, reqs] = await Promise.all([
      this.people.balances(org, e, policy, t),
      this.attendanceOf(org, e),
      this.db.getRepository(HrPerformanceCard).find({ where: { organizationId: org, employeeId: e.id }, order: { year: 'DESC' }, take: 3 }),
      this.db.getRepository(HrRequest).find({ where: { organizationId: org, employeeId: e.id }, order: { createdAt: 'DESC' }, take: 50 }),
    ]);
    return {
      employee: { ...basics, iban: null, gosiNumber: null, nationalId: null, birthDate: null },
      service: { ...serviceSpan(e.hireDate, t), hireDate: e.hireDate },
      balances: balances.filter((b) => b.eligible && (b.entitlement !== null || b.taken > 0)),
      attendance,
      performance: cards.map((c) => ({ id: c.id, year: c.year, statusLabel: CARD_STATUS_AR[c.status], finalScore: c.finalScore, rating: c.rating })),
      requests: reqs.map((r) => this.requests.row(r)),
    };
  }
}
