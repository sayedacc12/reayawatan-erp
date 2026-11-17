import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { OrgUser } from '../../core/auth/decorators';
import { MemApplication, MemInvoice, MemMember } from './entities/members.entity';
import { EffectiveStatus, MEMBER_STATUS_AR, MemCore, today } from './mem-core.service';
import { ageOn, daysBetween } from './mem-forms';
import { APP_STATUS_AR } from './applications.service';
import { MembersService, METHOD_AR } from './members.service';

const round = (n: number) => Math.round(n * 100) / 100;
const countBy = <T>(rows: T[], key: (r: T) => string | null | undefined) => {
  const m = new Map<string, number>();
  rows.forEach((r) => {
    const k = key(r) || 'غير محدد';
    m.set(k, (m.get(k) ?? 0) + 1);
  });
  return [...m].map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count);
};

/** لوحة العضوية وتقاريرها وكشف الجمعية العمومية */
@Injectable()
export class MemReportsService {
  constructor(private readonly db: DataSource, private readonly core: MemCore, private readonly members: MembersService) {}

  async dashboard(actor: OrgUser) {
    const org = actor.organizationId;
    const s = await this.core.settings(org);
    const t = today();
    const year = Number(t.slice(0, 4));
    const all = await this.db.getRepository(MemMember).find({ where: { organizationId: org } });
    const rows = all.map((m) => ({ m, st: this.core.effectiveStatus(m, s) }));
    const cnt = (st: EffectiveStatus) => rows.filter((r) => r.st === st).length;
    const current = rows.filter((r) => r.st === 'active' || r.st === 'expiring');
    const voting = current.filter((r) => this.core.voting(r.m, s).eligible).length;
    const apps: { status: string; n: number }[] = await this.db.query('SELECT status, COUNT(*)::int AS n FROM mem_applications WHERE organization_id = $1 GROUP BY status', [org]);
    const appN = (st: string) => apps.find((a) => a.status === st)?.n ?? 0;
    const inv: { status: string; n: number; amount: string }[] = await this.db.query(
      `SELECT status, COUNT(*)::int AS n, COALESCE(SUM(amount), 0) AS amount FROM mem_invoices WHERE organization_id = $1 AND status IN ('unpaid', 'review') GROUP BY status`, [org]);
    const monthly: { m: number; amount: string; n: number }[] = await this.db.query(
      `SELECT EXTRACT(MONTH FROM paid_on)::int AS m, SUM(amount) AS amount, COUNT(*)::int AS n FROM mem_invoices
        WHERE organization_id = $1 AND status = 'paid' AND EXTRACT(YEAR FROM paid_on) = $2 GROUP BY 1`, [org, year]);
    const joins: { m: number; n: number }[] = await this.db.query(
      `SELECT EXTRACT(MONTH FROM joined_on)::int AS m, COUNT(*)::int AS n FROM mem_members WHERE organization_id = $1 AND EXTRACT(YEAR FROM joined_on) = $2 GROUP BY 1`, [org, year]);
    const awaiting = (await this.db.getRepository(MemApplication).find({ where: { organizationId: org, status: 'in_review' } }));
    let mine = 0;
    for (const a of awaiting) if (await this.core.canDecide(actor, a.stages[a.stageIndex])) mine++;
    const expiring = rows.filter((r) => r.st === 'expiring' || r.st === 'grace').sort((a, b) => (a.m.endDate < b.m.endDate ? -1 : 1)).slice(0, 8)
      .map((r) => ({ id: r.m.id, memberNo: r.m.memberNo, fullName: r.m.fullName, typeName: this.core.typeName(s, r.m.typeCode), endDate: r.m.endDate, daysLeft: daysBetween(t, r.m.endDate), status: r.st, statusLabel: MEMBER_STATUS_AR[r.st] }));
    const recent = await this.db.getRepository(MemApplication).find({ where: { organizationId: org }, order: { createdAt: 'DESC' }, take: 6 });
    return {
      year,
      members: {
        current: current.length, active: cnt('active'), expiring: cnt('expiring'), grace: cnt('grace'), expired: cnt('expired'),
        suspended: cnt('suspended'), terminated: cnt('terminated'), total: all.length, female: current.filter((r) => r.m.gender === 'female').length, voting,
      },
      quorum: Math.floor(voting / 2) + 1,
      applications: { inReview: appN('in_review'), returned: appN('returned'), awaitingPayment: appN('awaiting_payment'), mine },
      invoices: {
        unpaid: inv.find((x) => x.status === 'unpaid')?.n ?? 0, unpaidAmount: Number(inv.find((x) => x.status === 'unpaid')?.amount ?? 0),
        review: inv.find((x) => x.status === 'review')?.n ?? 0,
      },
      collected: round(monthly.reduce((a, x) => a + Number(x.amount), 0)),
      monthly: Array.from({ length: 12 }, (_, i) => round(Number(monthly.find((x) => x.m === i + 1)?.amount ?? 0))),
      joins: Array.from({ length: 12 }, (_, i) => joins.find((x) => x.m === i + 1)?.n ?? 0),
      byType: s.types.map((ty) => ({ code: ty.code, name: ty.name, color: ty.color, count: current.filter((r) => r.m.typeCode === ty.code).length })),
      expiring,
      recent: recent.map((a) => ({ id: a.id, applicationNo: a.applicationNo, fullName: a.fullName, typeName: this.core.typeName(s, a.typeCode), status: a.status, statusLabel: APP_STATUS_AR[a.status], source: a.source, createdAt: a.createdAt })),
      publicEnabled: s.publicEnabled,
    };
  }

  async reports(actor: OrgUser, q: { from?: string; to?: string }) {
    const org = actor.organizationId;
    const s = await this.core.settings(org);
    const t = today();
    const from = q.from && /^\d{4}-\d{2}-\d{2}$/.test(q.from) ? q.from : `${t.slice(0, 4)}-01-01`;
    const to = q.to && /^\d{4}-\d{2}-\d{2}$/.test(q.to) ? q.to : t;
    const all = await this.db.getRepository(MemMember).find({ where: { organizationId: org } });
    const rows = all.map((m) => ({ m, st: this.core.effectiveStatus(m, s) }));
    const current = rows.filter((r) => r.st === 'active' || r.st === 'expiring').map((r) => r.m);
    const bands = [[0, 29, 'أقل من 30'], [30, 39, '30 - 39'], [40, 49, '40 - 49'], [50, 59, '50 - 59'], [60, 200, '60 فأكثر']] as const;

    const paid = await this.db.getRepository(MemInvoice).createQueryBuilder('i').where('i.organization_id = :org AND i.status = :st', { org, st: 'paid' })
      .andWhere('i.paid_on BETWEEN :from AND :to', { from, to }).getMany();
    const months = new Map<string, number>();
    paid.forEach((i) => months.set(i.paidOn!.slice(0, 7), round((months.get(i.paidOn!.slice(0, 7)) ?? 0) + i.amount)));
    const sumBy = (key: (i: MemInvoice) => string) => {
      const m = new Map<string, { count: number; amount: number }>();
      paid.forEach((i) => {
        const k = key(i);
        const v = m.get(k) ?? { count: 0, amount: 0 };
        m.set(k, { count: v.count + 1, amount: round(v.amount + i.amount) });
      });
      return [...m].map(([label, v]) => ({ label, ...v })).sort((a, b) => b.amount - a.amount);
    };

    const apps = await this.db.getRepository(MemApplication).createQueryBuilder('a').where('a.organization_id = :org', { org })
      .andWhere('a.created_at::date BETWEEN :from AND :to', { from, to }).getMany();
    const decided = apps.map((a) => {
      const end = [...a.approvalLog].reverse().find((l) => l.decision === 'approve' || l.decision === 'reject');
      return end && ['awaiting_payment', 'completed', 'rejected'].includes(a.status) ? daysBetween(a.createdAt.toISOString().slice(0, 10), end.at.slice(0, 10)) : null;
    }).filter((x): x is number => x !== null);

    // التجديد: الأعضاء الذين انتهت مدتهم السابقة داخل الفترة، هل جددوا؟
    const renewals = await this.db.getRepository(MemInvoice).createQueryBuilder('i').where(`i.organization_id = :org AND i.kind = 'renewal' AND i.status = 'paid'`, { org })
      .andWhere('i.period_start BETWEEN :from AND :to', { from, to }).getCount();
    const lapsed = rows.filter((r) => r.m.endDate >= from && r.m.endDate < to && (r.st === 'expired' || r.st === 'grace')).length;

    const outstanding: { n: number; amount: string; overdue: number }[] = await this.db.query(
      `SELECT COUNT(*)::int AS n, COALESCE(SUM(amount), 0) AS amount, COUNT(*) FILTER (WHERE due_date < $2)::int AS overdue
        FROM mem_invoices WHERE organization_id = $1 AND status IN ('unpaid', 'review')`, [org, t]);
    const voting = current.filter((m) => this.core.voting(m, s).eligible).length;

    return {
      from, to,
      members: {
        byStatus: (['active', 'expiring', 'grace', 'expired', 'suspended', 'terminated'] as EffectiveStatus[]).map((st) => ({ status: st, label: MEMBER_STATUS_AR[st], count: rows.filter((r) => r.st === st).length })),
        byType: s.types.map((ty) => ({ label: ty.name, color: ty.color, count: current.filter((m) => m.typeCode === ty.code).length, voting: ty.votingRights })),
        byGender: [{ label: 'ذكور', count: current.filter((m) => m.gender === 'male').length }, { label: 'إناث', count: current.filter((m) => m.gender === 'female').length }],
        byCity: countBy(current, (m) => m.city).slice(0, 10),
        byNationality: countBy(current, (m) => m.nationality).slice(0, 8),
        byAge: bands.map(([a, b, label]) => ({ label: label as string, count: current.filter((m) => m.birthDate && ageOn(m.birthDate, t) >= a && ageOn(m.birthDate, t) <= b).length }))
          .concat([{ label: 'غير محدد', count: current.filter((m) => !m.birthDate).length }]),
        joinedInPeriod: all.filter((m) => m.joinedOn >= from && m.joinedOn <= to).length,
        current: current.length, voting, quorum: Math.floor(voting / 2) + 1,
      },
      applications: {
        total: apps.length,
        byStatus: Object.entries(APP_STATUS_AR).map(([k, label]) => ({ status: k, label, count: apps.filter((a) => a.status === k).length })),
        bySource: [{ label: 'من الموقع', count: apps.filter((a) => a.source === 'public').length }, { label: 'إدخال الموظفين', count: apps.filter((a) => a.source === 'staff').length }],
        avgDays: decided.length ? round(decided.reduce((a, b) => a + b, 0) / decided.length) : null,
      },
      revenue: {
        total: round(paid.reduce((a, i) => a + i.amount, 0)), count: paid.length,
        byMethod: sumBy((i) => METHOD_AR[i.method ?? 'cash']),
        byKind: sumBy((i) => (i.kind === 'new' ? 'اشتراكات جديدة' : 'تجديدات')),
        byType: sumBy((i) => this.core.typeName(s, i.typeCode)),
        monthly: [...months].sort(([a], [b]) => (a < b ? -1 : 1)).map(([month, amount]) => ({ month, amount })),
        withoutVoucher: paid.filter((i) => !i.voucherId).length,
      },
      renewal: { renewed: renewals, lapsed, rate: renewals + lapsed ? round((renewals / (renewals + lapsed)) * 100) : null },
      outstanding: { count: outstanding[0].n, amount: Number(outstanding[0].amount), overdue: outstanding[0].overdue },
    };
  }

  /** كشف الجمعية العمومية: أصحاب حق التصويت والنصاب، ومن لم يكتسب الحق بعد مع السبب */
  async assembly(actor: OrgUser, on?: string) {
    const org = actor.organizationId;
    const s = await this.core.settings(org);
    const date = on && /^\d{4}-\d{2}-\d{2}$/.test(on) ? on : today();
    const all = await this.db.getRepository(MemMember).find({ where: { organizationId: org }, order: { memberNo: 'ASC' } });
    const rows = all.map((m) => {
      const v = this.core.voting(m, s, date);
      const st = this.core.effectiveStatus(m, s, date);
      return {
        id: m.id, memberNo: m.memberNo, fullName: m.fullName, nationalId: m.nationalId, mobile: m.mobile, typeName: this.core.typeName(s, m.typeCode),
        joinedOn: m.joinedOn, endDate: m.endDate, status: st, statusLabel: MEMBER_STATUS_AR[st], eligible: v.eligible, reason: v.reason,
        votingType: !!this.core.type(s, m.typeCode)?.votingRights,
      };
    });
    const eligible = rows.filter((r) => r.eligible);
    return {
      date, eligible: eligible.length, quorum: Math.floor(eligible.length / 2) + 1,
      // نوع له حق التصويت لكن العضو لا يملكه في التاريخ المحدد (انتهاء أو مدة)
      pending: rows.filter((r) => r.votingType && !r.eligible && r.status !== 'terminated'),
      rows: eligible,
      attendees: rows.filter((r) => r.status === 'active' || r.status === 'expiring'),
    };
  }
}
