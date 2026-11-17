import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { OrgUser } from '../../core/auth/decorators';
import { EVENT_KINDS, EVENT_STATUS } from './events.service';
import { EventStatus } from './entities/volunteers.entity';
import { STATUS_LABELS, TICKET_KINDS, TICKET_STATUS } from './volunteers.service';
import { VolCore, today } from './vol-core.service';

const r2 = (v: unknown) => (v === null || v === undefined ? null : Math.round(Number(v) * 100) / 100);

/** لوحة التطوع وتقاريره */
@Injectable()
export class VolReportsService {
  constructor(private readonly db: DataSource, private readonly core: VolCore) {}

  async dashboard(actor: OrgUser) {
    const org = actor.organizationId;
    const year = today().slice(0, 4);
    const [v] = await this.db.query(
      `SELECT COUNT(*) FILTER (WHERE status = 'active')::int AS active, COUNT(*) FILTER (WHERE status = 'pending')::int AS pending,
         COUNT(*) FILTER (WHERE status = 'active' AND gender = 'female')::int AS female, COUNT(*)::int AS total
       FROM vol_volunteers WHERE organization_id = $1`, [org]);
    const [h] = await this.db.query(
      `SELECT COALESCE(SUM(p.hours), 0)::float AS hours, COUNT(DISTINCT p.volunteer_id)::int AS volunteers
       FROM vol_participations p JOIN vol_events e ON e.id = p.event_id WHERE p.organization_id = $1 AND p.status = 'attended' AND to_char(e.start_date, 'YYYY') = $2`, [org, year]);
    const [e] = await this.db.query(
      `SELECT COUNT(*) FILTER (WHERE status = 'in_review')::int AS in_review, COUNT(*) FILTER (WHERE status = 'approved' AND end_date >= $2)::int AS upcoming,
         COUNT(*) FILTER (WHERE status = 'approved' AND end_date < $2)::int AS to_close, COUNT(*) FILTER (WHERE status = 'closed' AND to_char(start_date, 'YYYY') = $3)::int AS closed,
         COALESCE(SUM(actual_beneficiaries) FILTER (WHERE status = 'closed' AND to_char(start_date, 'YYYY') = $3), 0)::int AS beneficiaries
       FROM vol_events WHERE organization_id = $1`, [org, today(), year]);
    const [s] = await this.db.query(
      `SELECT AVG(score) FILTER (WHERE audience = 'volunteer')::float AS vol, AVG(score) FILTER (WHERE audience = 'beneficiary')::float AS ben, COUNT(*)::int AS n
       FROM vol_survey_responses WHERE organization_id = $1`, [org]);
    const [t] = await this.db.query(`SELECT COUNT(*) FILTER (WHERE status <> 'closed')::int AS open FROM vol_tickets WHERE organization_id = $1`, [org]);
    const [c] = await this.db.query(
      `SELECT COUNT(*) FILTER (WHERE status = 'issued')::int AS unsigned FROM vol_contracts WHERE organization_id = $1 AND end_date >= $2`, [org, today()]);
    const upcoming = await this.db.query(
      `SELECT id, event_no, title, kind, start_date::text AS start_date, end_date::text AS end_date, status, (SELECT COUNT(*) FROM vol_participations p WHERE p.event_id = e.id)::int AS volunteers, volunteers_needed
       FROM vol_events e WHERE organization_id = $1 AND status IN ('approved', 'in_review') AND end_date >= $2 ORDER BY start_date LIMIT 8`, [org, today()]);
    const top = await this.db.query(
      `SELECT v.id, v.full_name, SUM(p.hours)::float AS hours, COUNT(*)::int AS events FROM vol_participations p JOIN vol_volunteers v ON v.id = p.volunteer_id
       WHERE p.organization_id = $1 AND p.status = 'attended' GROUP BY v.id ORDER BY hours DESC LIMIT 5`, [org]);
    const monthly: { m: string; hours: number }[] = await this.db.query(
      `SELECT to_char(e.start_date, 'MM') AS m, SUM(p.hours)::float AS hours FROM vol_participations p JOIN vol_events e ON e.id = p.event_id
       WHERE p.organization_id = $1 AND p.status = 'attended' AND to_char(e.start_date, 'YYYY') = $2 GROUP BY 1 ORDER BY 1`, [org, year]);
    return {
      year: Number(year),
      volunteers: v, hours: r2(h.hours), activeVolunteers: h.volunteers,
      events: e, satisfaction: { volunteer: r2(s.vol), beneficiary: r2(s.ben), responses: s.n },
      openTickets: t.open, unsignedContracts: c.unsigned,
      upcoming: upcoming.map((x: Record<string, unknown>) => ({
        id: x.id, eventNo: x.event_no, title: x.title, kind: x.kind, kindLabel: EVENT_KINDS[x.kind as 'field' | 'online'], startDate: x.start_date, endDate: x.end_date,
        status: x.status, statusLabel: EVENT_STATUS[x.status as EventStatus], volunteers: x.volunteers, volunteersNeeded: x.volunteers_needed,
      })),
      top: top.map((x: Record<string, unknown>) => ({ id: x.id, fullName: x.full_name, hours: r2(x.hours), events: x.events })),
      monthly: Array.from({ length: 12 }, (_, i) => r2(monthly.find((m) => Number(m.m) === i + 1)?.hours ?? 0)),
    };
  }

  /** التقارير: كل تقرير جدول مستقل يُطبع أو يُصدَّر من الواجهة */
  async reports(actor: OrgUser, q: { from?: string; to?: string }) {
    const org = actor.organizationId;
    const s = await this.core.settings(org);
    const from = q.from && /^\d{4}-\d{2}-\d{2}$/.test(q.from) ? q.from : `${today().slice(0, 4)}-01-01`;
    const to = q.to && /^\d{4}-\d{2}-\d{2}$/.test(q.to) ? q.to : today();
    const p = [org, from, to];
    const inRange = 'e.start_date <= $3 AND e.end_date >= $2';

    const volunteerHours = await this.db.query(
      `SELECT v.volunteer_no, v.full_name, v.gender, v.type_code, COUNT(*)::int AS events, SUM(p.hours)::float AS hours, AVG(p.rating)::float AS rating
       FROM vol_participations p JOIN vol_events e ON e.id = p.event_id JOIN vol_volunteers v ON v.id = p.volunteer_id
       WHERE p.organization_id = $1 AND p.status = 'attended' AND ${inRange} GROUP BY v.id ORDER BY hours DESC`, p);
    const events = await this.db.query(
      `SELECT e.event_no, e.title, e.kind, e.category_code, e.start_date::text AS start_date, e.end_date::text AS end_date, e.status, e.target_beneficiaries, e.actual_beneficiaries, e.budget::float AS budget,
         e.actual_cost::float AS actual_cost, COUNT(p.id) FILTER (WHERE p.status = 'attended')::int AS attended, COALESCE(SUM(p.hours) FILTER (WHERE p.status = 'attended'), 0)::float AS hours,
         (SELECT AVG(score) FROM vol_survey_responses r WHERE r.event_id = e.id)::float AS satisfaction
       FROM vol_events e LEFT JOIN vol_participations p ON p.event_id = e.id WHERE e.organization_id = $1 AND ${inRange} GROUP BY e.id ORDER BY e.start_date`, p);
    const fields: { code: string; volunteers: number; events: number }[] = await this.db.query(
      `SELECT code, SUM(v)::int AS volunteers, SUM(ev)::int AS events FROM (
         SELECT jsonb_array_elements_text(field_codes) AS code, 1 AS v, 0 AS ev FROM vol_volunteers WHERE organization_id = $1 AND status = 'active'
         UNION ALL SELECT jsonb_array_elements_text(field_codes), 0, 1 FROM vol_events e WHERE organization_id = $1 AND ${inRange} AND status NOT IN ('cancelled', 'rejected')
       ) t GROUP BY code ORDER BY volunteers DESC`, p);
    const statuses = await this.db.query('SELECT status, COUNT(*)::int AS n FROM vol_volunteers WHERE organization_id = $1 GROUP BY status', [org]);
    const types = await this.db.query(`SELECT type_code, COUNT(*)::int AS n FROM vol_volunteers WHERE organization_id = $1 AND status = 'active' GROUP BY type_code`, [org]);
    const tickets = await this.db.query(
      `SELECT kind, status, COUNT(*)::int AS n FROM vol_tickets WHERE organization_id = $1 AND created_at::date BETWEEN $2 AND $3 GROUP BY kind, status`, p);
    const satisfaction = await this.db.query(
      `SELECT r.audience, COUNT(*)::int AS n, AVG(r.score)::float AS score FROM vol_survey_responses r JOIN vol_events e ON e.id = r.event_id
       WHERE r.organization_id = $1 AND ${inRange} GROUP BY r.audience`, p);
    const certificates = await this.db.query(
      `SELECT kind, COUNT(*)::int AS n, COALESCE(SUM(hours), 0)::float AS hours FROM vol_certificates WHERE organization_id = $1 AND NOT is_revoked AND issued_on BETWEEN $2 AND $3 GROUP BY kind`, p);

    const label = (list: typeof s.volunteerTypes, c: string | null) => this.core.label(list, c) ?? 'غير محدد';
    return {
      from, to,
      volunteerHours: volunteerHours.map((r: Record<string, unknown>) => ({
        volunteerNo: r.volunteer_no, fullName: r.full_name, gender: r.gender === 'female' ? 'أنثى' : 'ذكر', type: label(s.volunteerTypes, r.type_code as string),
        events: r.events, hours: r2(r.hours), rating: r2(r.rating),
      })),
      events: events.map((r: Record<string, unknown>) => ({
        eventNo: r.event_no, title: r.title, kind: EVENT_KINDS[r.kind as 'field' | 'online'], category: label(s.eventCategories, r.category_code as string),
        startDate: r.start_date, endDate: r.end_date, status: EVENT_STATUS[r.status as EventStatus], targetBeneficiaries: r.target_beneficiaries,
        actualBeneficiaries: r.actual_beneficiaries, budget: r2(r.budget), actualCost: r2(r.actual_cost), attended: r.attended, hours: r2(r.hours), satisfaction: r2(r.satisfaction),
      })),
      fields: fields.map((f) => ({ name: label(s.volunteerFields, f.code), volunteers: f.volunteers, events: f.events })),
      statuses: statuses.map((r: { status: keyof typeof STATUS_LABELS; n: number }) => ({ name: STATUS_LABELS[r.status], n: r.n })),
      types: types.map((r: { type_code: string | null; n: number }) => ({ name: label(s.volunteerTypes, r.type_code), n: r.n })),
      tickets: tickets.map((r: { kind: keyof typeof TICKET_KINDS; status: keyof typeof TICKET_STATUS; n: number }) => ({ kind: TICKET_KINDS[r.kind], status: TICKET_STATUS[r.status], n: r.n })),
      satisfaction: satisfaction.map((r: { audience: string; n: number; score: number }) => ({ audience: r.audience === 'volunteer' ? 'المتطوعون' : 'المستفيدون', n: r.n, score: r2(r.score) })),
      certificates: certificates.map((r: { kind: string; n: number; hours: number }) => ({ kind: r.kind === 'hours' ? 'شهادات ساعات' : 'شهادات شكر', n: r.n, hours: r2(r.hours) })),
    };
  }
}
