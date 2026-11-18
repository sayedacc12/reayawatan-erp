import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { OrgUser } from '../../core/auth/decorators';
import { KIND_AR, MeetingsCore, STATUS_AR, today } from './meetings-core.service';
import { MeetingsService } from './meetings.service';

/** لوحة الاجتماعات وبيانات التقارير (على ما يحق للمستخدم رؤيته فقط) */
@Injectable()
export class MeetingsInsights {
  constructor(private readonly db: DataSource, private readonly core: MeetingsCore, private readonly meetings: MeetingsService) {}

  async dashboard(actor: OrgUser) {
    const all = await this.meetings.list(actor, {});
    const t = today();
    const upcoming = all.filter((m) => ['pending_approval', 'scheduled', 'in_progress'].includes(m.status) && m.date >= t).sort((a, b) => (a.date + a.startTime).localeCompare(b.date + b.startTime));
    const mine = upcoming.filter((m) => m.myRsvp);
    const byKind = Object.keys(KIND_AR).map((k) => {
      const list = all.filter((m) => m.kind === k && m.status !== 'cancelled');
      return { kind: k, label: KIND_AR[k], total: list.length, adopted: list.filter((m) => m.status === 'adopted').length, upcoming: list.filter((m) => upcoming.includes(m)).length };
    });
    const decisions = await this.meetings.decisions(actor, {});
    return {
      counts: {
        upcoming: upcoming.length, myInvites: mine.filter((m) => m.myRsvp === 'pending').length, toSign: all.filter((m) => m.status === 'signing' && m.mySign === 'pending').length,
        signing: all.filter((m) => m.status === 'signing').length, drafting: all.filter((m) => m.status === 'held').length, adopted: all.filter((m) => m.status === 'adopted').length,
        recs: decisions.length, recsOpen: decisions.filter((d) => ['open', 'in_progress'].includes(d.taskStatus)).length, recsOverdue: decisions.filter((d) => d.overdue).length,
        recsDone: decisions.filter((d) => d.taskStatus === 'done').length,
      },
      upcoming: upcoming.slice(0, 8), awaiting: all.filter((m) => ['held', 'signing'].includes(m.status)).slice(0, 8), byKind,
      recent: decisions.slice(0, 8),
    };
  }

  async meetingsReport(actor: OrgUser, f: { from?: string; to?: string; kind?: string; status?: string }) {
    const rows = (await this.meetings.list(actor, { kind: f.kind })).filter((m) => m.date >= f.from! && m.date <= f.to! && (!f.status || m.status === f.status));
    return rows.reverse().map((m) => ({
      id: m.id, refNo: m.refNo, date: m.date, kind: m.kindLabel, body: m.bodyName, title: m.title, type: m.typeLabel, mode: m.modeLabel, status: m.statusLabel,
      invited: m.invited, accepted: m.accepted, present: m.present, attendanceRate: m.invited ? Math.round((m.present / m.invited) * 1000) / 10 : null,
      quorum: m.quorumMet === null ? null : m.quorumMet ? 'مكتمل' : 'غير مكتمل', items: m.items, recs: m.recs,
    }));
  }

  async attendanceReport(actor: OrgUser, f: { from?: string; to?: string; kind?: string }) {
    const ids = (await this.meetings.list(actor, { kind: f.kind })).filter((m) => m.date >= f.from! && m.date <= f.to! && ['held', 'signing', 'adopted'].includes(m.status)).map((m) => m.id);
    if (!ids.length) return [];
    return this.db.query(
      `SELECT a.name, MAX(b.name) AS body, COUNT(*)::int AS invited, COUNT(*) FILTER (WHERE a.attendance IN ('present','remote'))::int AS present,
              COUNT(*) FILTER (WHERE a.attendance = 'excused')::int AS excused, COUNT(*) FILTER (WHERE a.attendance = 'absent')::int AS absent,
              ROUND(100.0 * COUNT(*) FILTER (WHERE a.attendance IN ('present','remote')) / NULLIF(COUNT(*), 0), 1)::float AS rate,
              COUNT(*) FILTER (WHERE a.sign_status = 'signed')::int AS signed, COUNT(*) FILTER (WHERE a.sign_status = 'abstained')::int AS abstained
         FROM mtg_attendees a JOIN mtg_meetings m ON m.id = a.meeting_id JOIN mtg_bodies b ON b.id = m.body_id
        WHERE a.meeting_id = ANY($1::uuid[]) AND NOT a.is_guest GROUP BY COALESCE(a.user_id::text, a.member_id::text, a.name), a.name ORDER BY rate NULLS LAST, a.name`, [ids],
    );
  }

  async recommendationsReport(actor: OrgUser, f: { from?: string; to?: string; kind?: string; status?: string }) {
    const rows = (await this.meetings.decisions(actor, { kind: f.kind, status: f.status })).filter((d) => d.date >= f.from! && d.date <= f.to!);
    const ST: Record<string, string> = { open: 'لم تبدأ', in_progress: 'قيد التنفيذ', done: 'منجزة', cancelled: 'ملغاة' };
    return rows.map((d) => ({
      id: d.meetingId, refNo: d.refNo, date: d.date, body: d.bodyName, item: d.item, kind: d.kind === 'decision' ? 'قرار' : 'توصية', text: d.text, owner: d.ownerName,
      task: d.taskRef, dueDate: d.dueDate, status: d.taskStatus ? ST[d.taskStatus] : 'بلا مهمة', progress: d.progress, overdue: d.overdue ? 'نعم' : null,
      votes: d.votes ? `${d.votes.for} موافق / ${d.votes.against} معارض / ${d.votes.abstain} ممتنع` : null,
    }));
  }

  async signaturesReport(actor: OrgUser, f: { from?: string; to?: string }) {
    const ids = (await this.meetings.list(actor, {})).filter((m) => m.date >= f.from! && m.date <= f.to! && ['signing', 'adopted'].includes(m.status)).map((m) => m.id);
    if (!ids.length) return [];
    const rows: Record<string, any>[] = await this.db.query(
      `SELECT m.id, m.ref_no, m.title, m.meeting_date::text AS date, m.status, m.minutes_version, m.adoption_method, m.adopted_at, m.sign_deadline::text AS deadline,
              COUNT(a.*) FILTER (WHERE a.sign_status <> 'none')::int AS signers, COUNT(a.*) FILTER (WHERE a.sign_status = 'signed')::int AS signed,
              COUNT(a.*) FILTER (WHERE a.sign_status = 'abstained')::int AS abstained, COUNT(a.*) FILTER (WHERE a.sign_status = 'pending')::int AS pending,
              COUNT(a.*) FILTER (WHERE a.sign_method = 'wet')::int AS wet, (m.wet_copy IS NOT NULL) AS has_wet
         FROM mtg_meetings m LEFT JOIN mtg_attendees a ON a.meeting_id = m.id WHERE m.id = ANY($1::uuid[]) GROUP BY m.id ORDER BY m.meeting_date`, [ids],
    );
    const METHOD: Record<string, string> = { electronic: 'إلكتروني', wet: 'توقيع حي', mixed: 'إلكتروني وحي' };
    return rows.map((r) => ({
      id: r.id, refNo: r.ref_no, title: r.title, date: r.date, status: STATUS_AR[r.status], version: r.minutes_version, signers: r.signers, signed: r.signed,
      abstained: r.abstained, pending: r.pending, wet: r.wet, deadline: r.deadline, method: r.adoption_method ? METHOD[r.adoption_method] : null, adoptedAt: r.adopted_at,
      wetCopy: r.has_wet ? 'نعم' : null,
    }));
  }
}
