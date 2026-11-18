import { BadRequestException, ConflictException, ForbiddenException, Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { DataSource, EntityManager, IsNull } from 'typeorm';
import { OrgUser } from '../../core/auth/decorators';
import { FileStore } from '../../core/files/file-store.service';
import { PendingTask } from '../../core/tasks/tasks.registry';
import {
  AgendaItemDto, AttendanceDto, BodyDto, DecisionDto, DiscussionDto, GuestDto, MeetingDto, MinutesTextDto, NoteDto, RecommendationDto, RsvpDto,
} from './meetings.dto';
import {
  ATT_AR, KIND_AR, KIND_PREFIX, MODE_AR, MeetingsCore, ROLE_AR, RSVP_AR, SIGN_AR, STATUS_AR, TYPE_AR, today,
} from './meetings-core.service';
import { MEETINGS_PERMISSIONS as P } from './meetings.manifest';
import { BodyMember, HistoryEntry, MtgAgendaItem, MtgAttendee, MtgBody, MtgMeeting, MtgRecommendation } from './entities/meetings.entity';

const bad = (m: string): never => {
  throw new BadRequestException(m);
};
const PRESENT = ['present', 'remote'];
const ROLE_ORDER: Record<string, number> = { chair: 0, vice: 1, secretary: 2, rapporteur: 3, member: 4, advisor: 5 };

/**
 * الجهات (الجمعية العمومية، مجلس الإدارة، اللجان، فرق العمل) واجتماعاتها: التخطيط، اعتماد الخطة وإرسال الدعوات،
 * تأكيد الحضور، الانعقاد وتسجيل الحضور والنصاب، جدول الأعمال ومناقشات كل بند وتوصياته.
 * المحضر وتوقيعه واعتماده في MinutesService.
 */
@Injectable()
export class MeetingsService {
  constructor(private readonly db: DataSource, private readonly core: MeetingsCore, private readonly files: FileStore) {}

  // ---------------- الجهات ----------------

  async bodies(actor: OrgUser, kind?: string) {
    const org = actor.organizationId;
    const rows = await this.db.getRepository(MtgBody).find({ where: { organizationId: org, ...(kind ? { kind: kind as MtgBody['kind'] } : {}) }, order: { kind: 'ASC', name: 'ASC' } });
    const stats: { body_id: string; total: number; upcoming: number; last: string | null }[] = await this.db.query(
      `SELECT body_id, COUNT(*)::int AS total, COUNT(*) FILTER (WHERE status IN ('scheduled','pending_approval') AND meeting_date >= $2)::int AS upcoming,
              MAX(meeting_date) FILTER (WHERE status IN ('held','signing','adopted'))::text AS last
         FROM mtg_meetings WHERE organization_id = $1 AND status <> 'cancelled' GROUP BY body_id`, [org, today()],
    );
    const st = new Map(stats.map((s) => [s.body_id, s]));
    const names = await this.userNames(org, rows.flatMap((b) => [b.approverUserId, b.secretaryUserId]));
    // الجهات السرية لا تظهر إلا لأعضائها وأمانتها
    return rows.filter((b) => !b.isConfidential || this.core.can(actor, P.manage) || b.secretaryUserId === actor.id || b.approverUserId === actor.id || b.members.some((m) => m.userId === actor.id))
      .map((b) => ({
        ...this.bodyRow(b, names), stats: st.get(b.id) ?? { total: 0, upcoming: 0, last: null },
        canOrganize: this.core.canOrganize(actor, b), canEdit: this.canEditBody(actor, b),
      }));
  }

  private bodyRow(b: MtgBody, names: Map<string, string>) {
    return {
      id: b.id, kind: b.kind, kindLabel: KIND_AR[b.kind], code: b.code, name: b.name, description: b.description, unitId: b.unitId,
      approverUserId: b.approverUserId, approverName: b.approverUserId ? names.get(b.approverUserId) ?? null : null,
      secretaryUserId: b.secretaryUserId, secretaryName: b.secretaryUserId ? names.get(b.secretaryUserId) ?? null : null,
      members: [...b.members].sort((x, y) => ROLE_ORDER[x.role] - ROLE_ORDER[y.role]).map((m) => ({ ...m, roleLabel: ROLE_AR[m.role] })),
      votingCount: b.members.filter((m) => m.voting).length, quorumPercent: b.quorumPercent, isConfidential: b.isConfidential,
      termStart: b.termStart, termEnd: b.termEnd, isActive: b.isActive,
    };
  }

  private canEditBody(u: OrgUser, b: MtgBody) {
    if (this.core.can(u, P.manage)) return true;
    return b.kind === 'team' && this.core.can(u, P.teamsManage) && (b.createdById === u.id || b.secretaryUserId === u.id);
  }

  private async userNames(org: string, ids: (string | null)[]) {
    const list = [...new Set(ids.filter(Boolean))] as string[];
    if (!list.length) return new Map<string, string>();
    const rows: { id: string; full_name: string }[] = await this.db.query('SELECT id, full_name FROM users WHERE organization_id = $1 AND id = ANY($2::uuid[])', [org, list]);
    return new Map(rows.map((r) => [r.id, r.full_name]));
  }

  private async members(em: EntityManager, org: string, list: BodyDto['members']): Promise<BodyMember[]> {
    const out: BodyMember[] = [];
    const seen = new Set<string>();
    for (const m of list) {
      let name = m.name?.trim() ?? '';
      let { mobile = null, email = null } = m;
      if (m.type === 'user') {
        if (!m.userId) bad('اختر الموظف');
        const p = await this.core.comms.person(org, m.userId!, em);
        name = p.fullName;
      } else if (m.type === 'member') {
        if (!m.memberId) bad('اختر عضو الجمعية العمومية');
        const p = await this.core.memberOf(org, m.memberId!, em);
        name = p.fullName;
        mobile = mobile ?? p.mobile;
        email = email ?? p.email;
      } else if (name.length < 3) bad('اكتب اسم العضو من خارج النظام');
      const id = m.userId ?? m.memberId ?? name;
      if (seen.has(id)) bad(`«${name}» مكرر في الأعضاء`);
      seen.add(id);
      out.push({
        key: m.key || randomUUID(), type: m.type, userId: m.type === 'user' ? m.userId! : null, memberId: m.type === 'member' ? m.memberId! : null,
        name, role: m.role, title: m.title ?? null, mobile: mobile ?? null, email: email ?? null, voting: m.voting,
      });
    }
    if (out.filter((m) => m.role === 'chair').length > 1) bad('للجهة رئيس واحد');
    return out;
  }

  async saveBody(actor: OrgUser, id: string | null, dto: BodyDto) {
    const org = actor.organizationId;
    if (!this.core.can(actor, P.manage) && !(dto.kind === 'team' && this.core.can(actor, P.teamsManage))) throw new ForbiddenException('إدارة الجهات لأمانة المجالس، وفرق العمل لمن يملك تنظيمها');
    if (dto.termStart && dto.termEnd && dto.termEnd < dto.termStart) bad('نهاية الدورة قبل بدايتها');
    return this.db.transaction(async (em) => {
      const repo = em.getRepository(MtgBody);
      let b: MtgBody;
      if (id) {
        b = (await repo.findOne({ where: { id, organizationId: org } })) ?? this.core.notFound('الجهة');
        if (!this.canEditBody(actor, b)) throw new ForbiddenException('لا يمكنك تعديل هذه الجهة');
        if (b.kind !== dto.kind && (await em.getRepository(MtgMeeting).exist({ where: { bodyId: id } }))) bad('لا يتغير نوع جهة لها اجتماعات');
      } else b = repo.create({ organizationId: org, createdById: actor.id });
      if (await repo.createQueryBuilder('b').where('b.organization_id = :org AND upper(b.code) = upper(:c) AND b.id <> :id', { org, c: dto.code, id: id ?? '00000000-0000-0000-0000-000000000000' }).getExists()) bad(`الرمز ${dto.code} مستخدم لجهة أخرى`);
      for (const uid of [dto.approverUserId, dto.secretaryUserId]) if (uid) await this.core.comms.person(org, uid, em);
      if (dto.unitId && !(await em.query('SELECT 1 FROM hr_units WHERE id = $1 AND organization_id = $2', [dto.unitId, org])).length) bad('الوحدة غير موجودة');
      Object.assign(b, {
        kind: dto.kind, code: dto.code.toUpperCase(), name: dto.name, description: dto.description ?? null, unitId: dto.unitId ?? null,
        approverUserId: dto.approverUserId ?? null, secretaryUserId: dto.secretaryUserId ?? null, members: await this.members(em, org, dto.members),
        quorumPercent: dto.quorumPercent, isConfidential: dto.isConfidential, termStart: dto.termStart ?? null, termEnd: dto.termEnd ?? null, isActive: dto.isActive,
      });
      const saved = await repo.save(b);
      return this.bodyRow(saved, await this.userNames(org, [saved.approverUserId, saved.secretaryUserId]));
    });
  }

  // ---------------- قائمة الاجتماعات ----------------

  async list(actor: OrgUser, q: { kind?: string; bodyId?: string; status?: string; scope?: string; year?: string; q?: string }) {
    const org = actor.organizationId;
    const params: unknown[] = [org, actor.id];
    const where = ['m.organization_id = $1', this.core.visibleSql(actor, 2)];
    const add = (sql: string, v: unknown) => {
      params.push(v);
      where.push(sql.replaceAll('?', `$${params.length}`));
    };
    if (q.kind) add('m.kind = ?', q.kind);
    if (q.bodyId) add('m.body_id = ?', q.bodyId);
    if (q.status === 'upcoming') add(`m.status IN ('draft','pending_approval','scheduled','in_progress') AND m.meeting_date >= ?`, addDaysAgo(1));
    else if (q.status === 'open') where.push(`m.status IN ('held','signing')`);
    else if (q.status) add('m.status = ?', q.status);
    if (q.scope === 'mine') where.push('EXISTS (SELECT 1 FROM mtg_attendees a WHERE a.meeting_id = m.id AND a.user_id = $2)');
    if (q.year) add(`to_char(m.meeting_date, 'YYYY') = ?`, q.year);
    if (q.q) add('(m.title ILIKE ? OR m.ref_no ILIKE ?)', `%${q.q}%`);
    const rows: Record<string, any>[] = await this.db.query(
      `SELECT m.id, m.ref_no, m.title, m.kind, m.meeting_type, m.mode, m.location, m.meeting_date::text AS date, m.start_time, m.end_time, m.status, m.minutes_status,
              m.is_confidential, m.quorum_met, b.name AS body_name, b.code AS body_code,
              (SELECT COUNT(*) FROM mtg_attendees a WHERE a.meeting_id = m.id)::int AS invited,
              (SELECT COUNT(*) FROM mtg_attendees a WHERE a.meeting_id = m.id AND a.rsvp = 'accepted')::int AS accepted,
              (SELECT COUNT(*) FROM mtg_attendees a WHERE a.meeting_id = m.id AND a.attendance IN ('present','remote'))::int AS present,
              (SELECT COUNT(*) FROM mtg_attendees a WHERE a.meeting_id = m.id AND a.sign_status IN ('signed','abstained'))::int AS signed,
              (SELECT COUNT(*) FROM mtg_attendees a WHERE a.meeting_id = m.id AND a.sign_status <> 'none')::int AS signers,
              (SELECT COUNT(*) FROM mtg_agenda_items i WHERE i.meeting_id = m.id)::int AS items,
              (SELECT COUNT(*) FROM mtg_recommendations r WHERE r.meeting_id = m.id)::int AS recs,
              (SELECT a.rsvp FROM mtg_attendees a WHERE a.meeting_id = m.id AND a.user_id = $2 LIMIT 1) AS my_rsvp,
              (SELECT a.sign_status FROM mtg_attendees a WHERE a.meeting_id = m.id AND a.user_id = $2 LIMIT 1) AS my_sign
         FROM mtg_meetings m JOIN mtg_bodies b ON b.id = m.body_id WHERE ${where.join(' AND ')}
        ORDER BY m.meeting_date DESC, m.start_time DESC LIMIT 500`, params,
    );
    return rows.map((r) => ({
      id: r.id, refNo: r.ref_no, title: r.title, kind: r.kind, kindLabel: KIND_AR[r.kind], typeLabel: TYPE_AR[r.meeting_type], mode: r.mode, modeLabel: MODE_AR[r.mode],
      location: r.location, date: r.date, startTime: r.start_time, endTime: r.end_time, status: r.status, statusLabel: STATUS_AR[r.status], isConfidential: r.is_confidential,
      quorumMet: r.quorum_met, bodyName: r.body_name, bodyCode: r.body_code, invited: r.invited, accepted: r.accepted, present: r.present, signed: r.signed, signers: r.signers,
      items: r.items, recs: r.recs, myRsvp: r.my_rsvp, myRsvpLabel: r.my_rsvp ? RSVP_AR[r.my_rsvp] : null, mySign: r.my_sign,
    }));
  }

  // ---------------- تفاصيل الاجتماع ----------------

  async load(em: EntityManager, org: string, id: string, lock = false) {
    const m = await em.getRepository(MtgMeeting).findOne({ where: { id, organizationId: org }, ...(lock ? { lock: { mode: 'pessimistic_write' as const } } : {}) });
    if (!m) this.core.notFound('الاجتماع');
    const body = await em.getRepository(MtgBody).findOneOrFail({ where: { id: m!.bodyId } });
    const attendees = await em.getRepository(MtgAttendee).find({ where: { meetingId: id }, order: { sortOrder: 'ASC' } });
    return { m: m!, body, attendees };
  }

  async get(actor: OrgUser, id: string) {
    const org = actor.organizationId;
    const { m, body, attendees } = await this.load(this.db.manager, org, id);
    if (!this.visible(actor, { m, body, attendees })) this.core.forbid();
    const items = await this.db.getRepository(MtgAgendaItem).find({ where: { meetingId: id }, order: { seq: 'ASC' } });
    const recs = await this.db.getRepository(MtgRecommendation).find({ where: { meetingId: id }, order: { seq: 'ASC' } });
    const taskIds = recs.map((r) => r.taskId).filter(Boolean) as string[];
    const tasks: { id: string; status: string; progress: number; due_date: string }[] = taskIds.length
      ? await this.db.query('SELECT id, status, progress, due_date::text FROM comms_tasks WHERE id = ANY($1::uuid[])', [taskIds]) : [];
    const tmap = new Map(tasks.map((t) => [t.id, t]));
    const manage = this.core.canManage(actor, m, body);
    const me = attendees.find((a) => a.userId === actor.id);
    const voting = attendees.filter((a) => !a.isGuest && a.voting);
    const votingPresent = voting.filter((a) => a.attendance && PRESENT.includes(a.attendance)).length;
    const names = await this.userNames(org, [body.approverUserId, body.secretaryUserId]);
    return {
      id: m.id, refNo: m.refNo, title: m.title, kind: m.kind, kindLabel: KIND_AR[m.kind], meetingType: m.meetingType, typeLabel: TYPE_AR[m.meetingType],
      mode: m.mode, modeLabel: MODE_AR[m.mode], location: m.location, onlineLink: m.onlineLink, date: m.meetingDate, startTime: m.startTime, endTime: m.endTime,
      objectives: m.objectives, isConfidential: m.isConfidential, status: m.status, statusLabel: STATUS_AR[m.status],
      approverName: m.approverName ?? (body.approverUserId ? names.get(body.approverUserId) ?? null : null), decisionNote: m.decisionNote, approvedAt: m.approvedAt,
      startedAt: m.startedAt, endedAt: m.endedAt, quorumMet: m.quorumMet, createdByName: m.createdByName, createdAt: m.createdAt,
      body: { id: body.id, name: body.name, code: body.code, quorumPercent: body.quorumPercent, secretaryName: body.secretaryUserId ? names.get(body.secretaryUserId) ?? null : null },
      quorum: { voting: voting.length, present: votingPresent, required: Math.ceil((voting.length * body.quorumPercent) / 100), percent: body.quorumPercent },
      attendees: attendees.map((a) => ({
        id: a.id, type: a.type, userId: a.userId, memberId: a.memberId, name: a.name, role: a.role, roleLabel: ROLE_AR[a.role], title: a.title, mobile: manage ? a.mobile : null,
        voting: a.voting, isGuest: a.isGuest, rsvp: a.rsvp, rsvpLabel: RSVP_AR[a.rsvp], rsvpNote: a.rsvpNote, rsvpAt: a.rsvpAt,
        attendance: a.attendance, attendanceLabel: a.attendance ? ATT_AR[a.attendance] : null, checkedInAt: a.checkedInAt,
        signStatus: a.signStatus, signLabel: SIGN_AR[a.signStatus], signedAt: a.signedAt, signMethod: a.signMethod, signReason: a.signReason,
        hasSignLink: !!a.signTokenHash && !!a.signLinkExpires && a.signLinkExpires > new Date(),
      })),
      agenda: items.map((i) => ({
        id: i.id, seq: i.seq, title: i.title, description: i.description, presenterName: i.presenterName, durationMinutes: i.durationMinutes, discussion: i.discussion, status: i.status,
        recommendations: recs.filter((r) => r.itemId === i.id).map((r) => ({
          id: r.id, seq: r.seq, kind: r.kind, text: r.text, ownerUserId: r.ownerUserId, ownerName: r.ownerName, supporters: r.supporters, dueDate: r.dueDate,
          votesFor: r.votesFor, votesAgainst: r.votesAgainst, votesAbstain: r.votesAbstain, taskId: r.taskId, taskRef: r.taskRef,
          task: r.taskId && tmap.get(r.taskId) ? { status: tmap.get(r.taskId)!.status, progress: tmap.get(r.taskId)!.progress, dueDate: tmap.get(r.taskId)!.due_date } : null,
        })),
      })),
      minutes: {
        status: m.minutesStatus, opening: m.minutesOpening, closing: m.minutesClosing, version: m.minutesVersion, hash: m.minutesHash, issuedAt: m.minutesIssuedAt,
        signDeadline: m.signDeadline, adoptedAt: m.adoptedAt, adoptionMethod: m.adoptionMethod, adoptionNote: m.adoptionNote, verifyCode: m.minutesStatus === 'none' ? null : m.verifyCode,
        wetCopy: m.wetCopy ? { name: m.wetCopy.name, at: m.wetCopy.at, byName: m.wetCopy.byName } : null,
      },
      attachments: m.attachments.map(({ key: _k, ...f }) => f),
      history: m.history,
      me: me ? { attendeeId: me.id, rsvp: me.rsvp, attendance: me.attendance, signStatus: me.signStatus, locked: !!me.signLockedUntil && me.signLockedUntil > new Date() } : null,
      can: {
        manage, approve: m.status === 'pending_approval' && this.core.canApprove(actor, body),
        editPlan: manage && ['draft', 'pending_approval', 'scheduled'].includes(m.status),
        editAgenda: manage && ['draft', 'pending_approval', 'scheduled', 'in_progress', 'held'].includes(m.status),
        conduct: manage && ['in_progress', 'held'].includes(m.status),
        rsvp: !!me && ['scheduled'].includes(m.status), checkIn: !!me && m.status === 'in_progress' && !me.attendance,
        sign: !!me && m.status === 'signing' && me.signStatus === 'pending' && !!me.userId,
      },
    };
  }

  /** يرى الاجتماع من يحق له، ومعتمد خطته أثناء انتظار الاعتماد */
  private visible(actor: OrgUser, { m, body, attendees }: { m: MtgMeeting; body: MtgBody; attendees: MtgAttendee[] }) {
    return this.core.canSee(actor, m, body, attendees) || (m.status === 'pending_approval' && this.core.canApprove(actor, body));
  }

  // ---------------- التخطيط ----------------

  private hist(actor: OrgUser, action: string, note: string | null = null): HistoryEntry {
    return { at: new Date().toISOString(), by: actor.fullName, action, note };
  }

  private attendeeFrom(org: string, meetingId: string, m: BodyMember, i: number, isGuest = false) {
    return {
      organizationId: org, meetingId, type: m.type, userId: m.userId, memberId: m.memberId, name: m.name, role: m.role, title: m.title,
      mobile: m.mobile, email: m.email, voting: isGuest ? false : m.voting, isGuest, sortOrder: isGuest ? 100 + i : ROLE_ORDER[m.role] * 10 + i, rsvp: 'pending' as const,
    };
  }

  async create(actor: OrgUser, dto: MeetingDto) {
    const org = actor.organizationId;
    const id = await this.db.transaction(async (em) => {
      const body = (await em.getRepository(MtgBody).findOne({ where: { id: dto.bodyId, organizationId: org } })) ?? this.core.notFound('الجهة');
      if (!body.isActive) bad('الجهة موقوفة');
      if (!this.core.canOrganize(actor, body)) throw new ForbiddenException('تنظيم اجتماعات هذه الجهة لأمانة المجالس أو أمين سرها');
      this.checkPlan(dto);
      const { refNo } = await this.core.nextRef(em, org, `${KIND_PREFIX[body.kind]}${body.kind === 'committee' || body.kind === 'team' ? `-${body.code}` : ''}`, dto.meetingDate.slice(0, 4));
      const m = await em.getRepository(MtgMeeting).save(em.create(MtgMeeting, {
        organizationId: org, bodyId: body.id, kind: body.kind, refNo, title: dto.title, meetingType: dto.meetingType, mode: dto.mode, location: dto.location ?? null,
        onlineLink: dto.onlineLink ?? null, meetingDate: dto.meetingDate, startTime: dto.startTime, endTime: dto.endTime ?? null, objectives: dto.objectives ?? null,
        isConfidential: body.isConfidential || !!dto.isConfidential, status: 'draft', createdById: actor.id, createdByName: actor.fullName,
        verifyCode: randomUUID().replace(/-/g, '').slice(0, 12).toUpperCase(), history: [this.hist(actor, 'create')],
      }));
      await em.getRepository(MtgAttendee).save(body.members.map((bm, i) => em.create(MtgAttendee, this.attendeeFrom(org, m.id, bm, i))));
      const agenda = (dto.agenda ?? []).map((t) => t.trim()).filter(Boolean);
      if (agenda.length) await em.getRepository(MtgAgendaItem).save(agenda.map((title, i) => em.create(MtgAgendaItem, { organizationId: org, meetingId: m.id, seq: i + 1, title })));
      return m.id;
    });
    return this.get(actor, id);
  }

  private checkPlan(dto: Pick<MeetingDto, 'mode' | 'location' | 'onlineLink' | 'startTime' | 'endTime'>) {
    if (dto.mode !== 'online' && !dto.location) bad('اكتب مكان الاجتماع');
    if (dto.mode !== 'in_person' && !dto.onlineLink) bad('اكتب رابط الاجتماع عن بعد');
    if (dto.endTime && dto.endTime <= dto.startTime) bad('وقت النهاية قبل وقت البداية');
  }

  private async mutate(actor: OrgUser, id: string, fn: (em: EntityManager, ctx: Awaited<ReturnType<MeetingsService['load']>>) => Promise<void> | void, needManage = true) {
    await this.db.transaction(async (em) => {
      const ctx = await this.load(em, actor.organizationId, id, true);
      if (!this.visible(actor, ctx)) this.core.forbid();
      if (needManage && !this.core.canManage(actor, ctx.m, ctx.body)) throw new ForbiddenException('تنظيم هذا الاجتماع لأمين السر أو منشئه');
      await fn(em, ctx);
      await em.getRepository(MtgMeeting).save(ctx.m);
    });
    return this.get(actor, id);
  }

  updatePlan(actor: OrgUser, id: string, dto: MeetingDto) {
    return this.mutate(actor, id, async (em, { m }) => {
      if (!['draft', 'pending_approval', 'scheduled'].includes(m.status)) throw new ConflictException('لا تتغير خطة اجتماع بعد انعقاده');
      this.checkPlan(dto);
      const moved = m.meetingDate !== dto.meetingDate || m.startTime !== dto.startTime;
      Object.assign(m, {
        title: dto.title, meetingType: dto.meetingType, mode: dto.mode, location: dto.location ?? null, onlineLink: dto.onlineLink ?? null, meetingDate: dto.meetingDate,
        startTime: dto.startTime, endTime: dto.endTime ?? null, objectives: dto.objectives ?? null, isConfidential: m.isConfidential || !!dto.isConfidential,
      });
      if (moved && m.status === 'scheduled') {
        // تغيير الموعد بعد إرسال الدعوات: تُعاد الدعوات ويطلب تأكيد الحضور من جديد
        await em.getRepository(MtgAttendee).update({ meetingId: m.id }, { rsvp: 'pending', rsvpNote: null, rsvpAt: null });
        m.history.push(this.hist(actor, 'reschedule', `${dto.meetingDate} ${dto.startTime}`));
      } else m.history.push(this.hist(actor, 'update'));
    });
  }

  addGuest(actor: OrgUser, id: string, dto: GuestDto) {
    return this.mutate(actor, id, async (em, { m, attendees }) => {
      if (!['draft', 'pending_approval', 'scheduled', 'in_progress'].includes(m.status)) throw new ConflictException('لا يضاف مدعوون بعد انتهاء الاجتماع');
      const [bm] = await this.members(em, m.organizationId, [{ ...dto, role: 'advisor', voting: false, title: dto.title ?? null }]);
      if (attendees.some((a) => (bm.userId && a.userId === bm.userId) || (bm.memberId && a.memberId === bm.memberId))) bad('مدعو بالفعل');
      await em.getRepository(MtgAttendee).save(em.create(MtgAttendee, { ...this.attendeeFrom(m.organizationId, m.id, bm, attendees.length, true), role: 'advisor' }));
      m.history.push(this.hist(actor, 'guest', bm.name));
    });
  }

  removeAttendee(actor: OrgUser, id: string, attendeeId: string) {
    return this.mutate(actor, id, async (em, { m, attendees }) => {
      if (!['draft', 'pending_approval', 'scheduled'].includes(m.status)) throw new ConflictException('لا يُحذف مدعو بعد انعقاد الاجتماع');
      const a = attendees.find((x) => x.id === attendeeId) ?? this.core.notFound('المدعو');
      await em.getRepository(MtgAttendee).delete({ id: a.id });
      m.history.push(this.hist(actor, 'remove', a.name));
    });
  }

  /** رفع الخطة للاعتماد. تعتمد مباشرة إن كان المنظم هو المعتمد، أو كان اجتماع فريق عمل بلا معتمد محدد */
  submit(actor: OrgUser, id: string) {
    return this.mutate(actor, id, async (em, { m, body, attendees }) => {
      if (m.status !== 'draft') throw new ConflictException('الخطة مرفوعة بالفعل');
      if (!attendees.length) bad('أضف المدعوين أولًا (أعضاء الجهة أو ضيوفًا)');
      if (!(await em.getRepository(MtgAgendaItem).count({ where: { meetingId: m.id } }))) bad('أضف بندًا واحدًا على الأقل في جدول الأعمال');
      if (m.meetingDate < today()) bad('تاريخ الاجتماع مضى؛ عدّل الموعد');
      m.history.push(this.hist(actor, 'submit'));
      if (this.core.canApprove(actor, body) || (body.kind === 'team' && !body.approverUserId)) this.approve(actor, m, attendees, em, 'اعتماد مباشر');
      else m.status = 'pending_approval';
    });
  }

  private approve(actor: OrgUser, m: MtgMeeting, attendees: MtgAttendee[], em: EntityManager, note: string | null) {
    Object.assign(m, { status: 'scheduled', approverName: actor.fullName, approvedAt: new Date(), decisionNote: note });
    m.history.push(this.hist(actor, 'approve', note));
    void attendees;
    void em;
  }

  decide(actor: OrgUser, id: string, dto: DecisionDto) {
    return this.mutate(actor, id, (em, { m, body, attendees }) => {
      if (m.status !== 'pending_approval') throw new ConflictException('الاجتماع ليس بانتظار الاعتماد');
      if (!this.core.canApprove(actor, body)) throw new ForbiddenException('اعتماد خطط اجتماعات هذه الجهة لمعتمدها');
      if (dto.decision === 'approve') this.approve(actor, m, attendees, em, dto.note ?? null);
      else {
        if (!dto.note) bad('اكتب سبب الإعادة');
        Object.assign(m, { status: 'draft', decisionNote: dto.note });
        m.history.push(this.hist(actor, 'return', dto.note));
      }
    }, false);
  }

  /** رد المدعو على الدعوة */
  rsvp(actor: OrgUser, id: string, dto: RsvpDto) {
    return this.mutate(actor, id, async (em, { m, attendees }) => {
      const me = attendees.find((a) => a.userId === actor.id) ?? this.core.forbid();
      if (m.status !== 'scheduled') throw new ConflictException('الرد على الدعوة بعد اعتماد الاجتماع وقبل انعقاده');
      if (dto.rsvp === 'declined' && !dto.note) bad('اكتب سبب الاعتذار');
      await em.getRepository(MtgAttendee).update({ id: me.id }, { rsvp: dto.rsvp, rsvpNote: dto.note ?? null, rsvpAt: new Date() });
    }, false);
  }

  cancel(actor: OrgUser, id: string, dto: NoteDto) {
    return this.mutate(actor, id, (_em, { m }) => {
      if (!['draft', 'pending_approval', 'scheduled'].includes(m.status)) throw new ConflictException('لا يُلغى اجتماع بعد انعقاده');
      m.status = 'cancelled';
      m.history.push(this.hist(actor, 'cancel', dto.note));
    });
  }

  // ---------------- الانعقاد ----------------

  start(actor: OrgUser, id: string) {
    return this.mutate(actor, id, (_em, { m }) => {
      if (m.status !== 'scheduled') throw new ConflictException('يبدأ الاجتماع بعد اعتماده');
      Object.assign(m, { status: 'in_progress', startedAt: new Date() });
      m.history.push(this.hist(actor, 'start'));
    });
  }

  /** تسجيل الحضور من أمين السر */
  attendance(actor: OrgUser, id: string, dto: AttendanceDto) {
    return this.mutate(actor, id, async (em, { m, attendees }) => {
      if (!['in_progress', 'held'].includes(m.status)) throw new ConflictException('يُسجل الحضور أثناء الاجتماع أو قبل إصدار المحضر');
      for (const r of dto.rows) {
        const a = attendees.find((x) => x.id === r.id);
        if (!a) continue;
        await em.getRepository(MtgAttendee).update({ id: a.id }, { attendance: r.attendance ?? null, checkedInAt: r.attendance && PRESENT.includes(r.attendance) ? a.checkedInAt ?? new Date() : null });
      }
    });
  }

  /** تأكيد الحضور من المدعو نفسه أثناء انعقاد الاجتماع */
  checkIn(actor: OrgUser, id: string) {
    return this.mutate(actor, id, async (em, { m, attendees }) => {
      const me = attendees.find((a) => a.userId === actor.id) ?? this.core.forbid();
      if (m.status !== 'in_progress') throw new ConflictException('تأكيد الحضور أثناء انعقاد الاجتماع');
      await em.getRepository(MtgAttendee).update({ id: me.id }, { attendance: m.mode === 'online' ? 'remote' : 'present', checkedInAt: new Date() });
    }, false);
  }

  end(actor: OrgUser, id: string) {
    return this.mutate(actor, id, async (em, { m, body }) => {
      if (m.status !== 'in_progress') throw new ConflictException('الاجتماع ليس منعقدًا');
      const att = await em.getRepository(MtgAttendee).find({ where: { meetingId: m.id } });
      if (!att.some((a) => a.attendance && PRESENT.includes(a.attendance))) bad('سجّل الحضور قبل إنهاء الاجتماع');
      // من لم يُسجل حضوره يعد غائبًا
      await em.getRepository(MtgAttendee).update({ meetingId: m.id, attendance: IsNull() }, { attendance: 'absent' });
      const voting = att.filter((a) => !a.isGuest && a.voting);
      const present = voting.filter((a) => a.attendance && PRESENT.includes(a.attendance)).length;
      Object.assign(m, { status: 'held', endedAt: new Date(), quorumMet: voting.length ? present >= Math.ceil((voting.length * body.quorumPercent) / 100) : true });
      m.history.push(this.hist(actor, 'end', m.quorumMet ? 'اكتمل النصاب' : 'لم يكتمل النصاب'));
    });
  }

  // ---------------- جدول الأعمال والمناقشات والتوصيات ----------------

  private assertAgenda(m: MtgMeeting) {
    if (!['draft', 'pending_approval', 'scheduled', 'in_progress', 'held'].includes(m.status)) throw new ConflictException('جدول الأعمال مقفل بعد إصدار المحضر؛ اسحب المحضر للتعديل');
  }

  addItem(actor: OrgUser, id: string, dto: AgendaItemDto) {
    return this.mutate(actor, id, async (em, { m }) => {
      this.assertAgenda(m);
      const [{ n }] = await em.query('SELECT COALESCE(MAX(seq), 0) + 1 AS n FROM mtg_agenda_items WHERE meeting_id = $1', [m.id]);
      await em.getRepository(MtgAgendaItem).save(em.create(MtgAgendaItem, {
        organizationId: m.organizationId, meetingId: m.id, seq: Number(n), title: dto.title, description: dto.description ?? null, presenterName: dto.presenterName ?? null, durationMinutes: dto.durationMinutes ?? null,
      }));
    });
  }

  updateItem(actor: OrgUser, id: string, itemId: string, dto: AgendaItemDto) {
    return this.mutate(actor, id, async (em, { m }) => {
      this.assertAgenda(m);
      const r = await em.getRepository(MtgAgendaItem).update({ id: itemId, meetingId: m.id }, { title: dto.title, description: dto.description ?? null, presenterName: dto.presenterName ?? null, durationMinutes: dto.durationMinutes ?? null });
      if (!r.affected) this.core.notFound('البند');
    });
  }

  removeItem(actor: OrgUser, id: string, itemId: string) {
    return this.mutate(actor, id, async (em, { m }) => {
      this.assertAgenda(m);
      if (await em.getRepository(MtgRecommendation).exist({ where: { itemId } })) bad('احذف توصيات البند أولًا');
      await em.getRepository(MtgAgendaItem).delete({ id: itemId, meetingId: m.id });
      await em.query('UPDATE mtg_agenda_items i SET seq = x.rn FROM (SELECT id, ROW_NUMBER() OVER (ORDER BY seq) AS rn FROM mtg_agenda_items WHERE meeting_id = $1) x WHERE i.id = x.id', [m.id]);
    });
  }

  moveItem(actor: OrgUser, id: string, itemId: string, dir: number) {
    return this.mutate(actor, id, async (em, { m }) => {
      this.assertAgenda(m);
      const items = await em.getRepository(MtgAgendaItem).find({ where: { meetingId: m.id }, order: { seq: 'ASC' } });
      const i = items.findIndex((x) => x.id === itemId);
      const j = i + (dir < 0 ? -1 : 1);
      if (i < 0 || j < 0 || j >= items.length) return;
      [items[i].seq, items[j].seq] = [items[j].seq, items[i].seq];
      await em.getRepository(MtgAgendaItem).save([items[i], items[j]]);
    });
  }

  /** خانة المناقشات للبند: تُكتب أثناء الاجتماع وبعده حتى إصدار المحضر */
  discussion(actor: OrgUser, id: string, itemId: string, dto: DiscussionDto) {
    return this.mutate(actor, id, async (em, { m }) => {
      if (!['in_progress', 'held'].includes(m.status)) throw new ConflictException('تُكتب المناقشات بعد بدء الاجتماع وقبل إصدار المحضر');
      const r = await em.getRepository(MtgAgendaItem).update({ id: itemId, meetingId: m.id }, { discussion: dto.discussion ?? null, status: dto.status });
      if (!r.affected) this.core.notFound('البند');
    });
  }

  private async recFields(em: EntityManager, org: string, dto: RecommendationDto) {
    let owner: { id: string; fullName: string } | null = null;
    if (dto.ownerUserId) owner = await this.core.comms.person(org, dto.ownerUserId, em);
    if (dto.kind === 'recommendation' && !owner) bad('حدد المسؤول عن تنفيذ التوصية (ستتحول إلى مهمة عند اعتماد المحضر)');
    const supporters: { userId: string; name: string }[] = [];
    for (const uid of [...new Set(dto.supporterUserIds ?? [])].filter((x) => x !== owner?.id)) {
      const p = await this.core.comms.person(org, uid, em);
      supporters.push({ userId: p.id, name: p.fullName });
    }
    return {
      kind: dto.kind, text: dto.text, ownerUserId: owner?.id ?? null, ownerName: owner?.fullName ?? null, supporters, dueDate: dto.dueDate ?? null,
      votesFor: dto.votesFor ?? null, votesAgainst: dto.votesAgainst ?? null, votesAbstain: dto.votesAbstain ?? null,
    };
  }

  addRec(actor: OrgUser, id: string, itemId: string, dto: RecommendationDto) {
    return this.mutate(actor, id, async (em, { m }) => {
      if (!['in_progress', 'held'].includes(m.status)) throw new ConflictException('تُسجل التوصيات بعد بدء الاجتماع وقبل إصدار المحضر');
      if (!(await em.getRepository(MtgAgendaItem).exist({ where: { id: itemId, meetingId: m.id } }))) this.core.notFound('البند');
      const [{ n }] = await em.query('SELECT COALESCE(MAX(seq), 0) + 1 AS n FROM mtg_recommendations WHERE meeting_id = $1', [m.id]);
      await em.getRepository(MtgRecommendation).save(em.create(MtgRecommendation, { organizationId: m.organizationId, meetingId: m.id, itemId, seq: Number(n), ...(await this.recFields(em, m.organizationId, dto)) }));
    });
  }

  updateRec(actor: OrgUser, id: string, recId: string, dto: RecommendationDto) {
    return this.mutate(actor, id, async (em, { m }) => {
      if (!['in_progress', 'held'].includes(m.status)) throw new ConflictException('لا تتغير التوصيات بعد إصدار المحضر');
      const r = await em.getRepository(MtgRecommendation).update({ id: recId, meetingId: m.id }, await this.recFields(em, m.organizationId, dto));
      if (!r.affected) this.core.notFound('التوصية');
    });
  }

  removeRec(actor: OrgUser, id: string, recId: string) {
    return this.mutate(actor, id, async (em, { m }) => {
      if (!['in_progress', 'held'].includes(m.status)) throw new ConflictException('لا تُحذف التوصيات بعد إصدار المحضر');
      await em.getRepository(MtgRecommendation).delete({ id: recId, meetingId: m.id });
      await em.query('UPDATE mtg_recommendations r SET seq = x.rn FROM (SELECT id, ROW_NUMBER() OVER (ORDER BY seq) AS rn FROM mtg_recommendations WHERE meeting_id = $1) x WHERE r.id = x.id', [m.id]);
    });
  }

  minutesText(actor: OrgUser, id: string, dto: MinutesTextDto) {
    return this.mutate(actor, id, (_em, { m }) => {
      if (!['in_progress', 'held'].includes(m.status)) throw new ConflictException('المحضر مقفل');
      Object.assign(m, { minutesOpening: dto.opening ?? null, minutesClosing: dto.closing ?? null });
    });
  }

  // ---------------- المرفقات ----------------

  async attach(actor: OrgUser, id: string, file: Express.Multer.File | undefined) {
    const saved = await this.files.save(`meetings/${actor.organizationId}`, file, 'المرفق');
    return this.mutate(actor, id, (_em, { m }) => {
      m.attachments = [...m.attachments, { id: randomUUID(), key: saved.key, name: saved.name, mime: saved.mime, size: file?.size ?? 0, byName: actor.fullName, at: new Date().toISOString() }];
    });
  }

  async attachment(actor: OrgUser, id: string, fileId: string) {
    const { m, body, attendees } = await this.load(this.db.manager, actor.organizationId, id);
    if (!this.core.canSee(actor, m, body, attendees)) this.core.forbid();
    const f = fileId === 'wet' ? m.wetCopy : m.attachments.find((a) => a.id === fileId);
    if (!f) this.core.notFound('الملف');
    return { doc: { mimeType: f!.mime, fileName: f!.name }, stream: this.files.open(f!.key) };
  }

  // ---------------- سجل القرارات ----------------

  async decisions(actor: OrgUser, q: { kind?: string; bodyId?: string; q?: string; status?: string }) {
    const params: unknown[] = [actor.organizationId, actor.id];
    const where = ['m.organization_id = $1', `m.minutes_status = 'adopted'`, this.core.visibleSql(actor, 2)];
    const add = (sql: string, v: unknown) => {
      params.push(v);
      where.push(sql.replaceAll('?', `$${params.length}`));
    };
    if (q.kind) add('m.kind = ?', q.kind);
    if (q.bodyId) add('m.body_id = ?', q.bodyId);
    if (q.q) add('r.text ILIKE ?', `%${q.q}%`);
    if (q.status === 'open') where.push(`t.status IN ('open','in_progress')`);
    else if (q.status === 'done') where.push(`t.status = 'done'`);
    else if (q.status === 'overdue') add(`t.status IN ('open','in_progress') AND t.due_date < ?`, today());
    const rows: Record<string, any>[] = await this.db.query(
      `SELECT r.id, r.kind, r.text, r.owner_name, r.due_date::text, r.votes_for, r.votes_against, r.votes_abstain, r.task_ref, r.task_id,
              t.status AS task_status, t.progress, t.due_date::text AS task_due, m.id AS meeting_id, m.ref_no, m.title, m.kind AS body_kind,
              m.meeting_date::text AS date, b.name AS body_name, i.seq AS item_seq, i.title AS item_title, r.seq
         FROM mtg_recommendations r JOIN mtg_meetings m ON m.id = r.meeting_id JOIN mtg_bodies b ON b.id = m.body_id
         JOIN mtg_agenda_items i ON i.id = r.item_id LEFT JOIN comms_tasks t ON t.id = r.task_id
        WHERE ${where.join(' AND ')} ORDER BY m.meeting_date DESC, r.seq LIMIT 1000`, params,
    );
    return rows.map((r) => ({
      id: r.id, kind: r.kind, text: r.text, ownerName: r.owner_name, dueDate: r.task_due ?? r.due_date, votes: r.votes_for === null ? null : { for: r.votes_for, against: r.votes_against, abstain: r.votes_abstain },
      taskId: r.task_id, taskRef: r.task_ref, taskStatus: r.task_status, progress: r.progress, overdue: ['open', 'in_progress'].includes(r.task_status) && r.task_due < today(),
      meetingId: r.meeting_id, refNo: r.ref_no, meetingTitle: r.title, kindLabel: KIND_AR[r.body_kind], date: r.date, bodyName: r.body_name, item: `${r.item_seq}. ${r.item_title}`, seq: r.seq,
    }));
  }

  // ---------------- جرس المهام ----------------

  async pendingFor(u: OrgUser): Promise<PendingTask[]> {
    const org = u.organizationId;
    const out: PendingTask[] = [];
    // خطط بانتظار اعتمادي
    const approvals: { id: string; ref_no: string; title: string; date: string; approver: string | null; updated_at: Date; conf: boolean }[] = await this.db.query(
      `SELECT m.id, m.ref_no, m.title, m.meeting_date::text AS date, b.approver_user_id AS approver, m.updated_at, m.is_confidential AS conf
         FROM mtg_meetings m JOIN mtg_bodies b ON b.id = m.body_id WHERE m.organization_id = $1 AND m.status = 'pending_approval'`, [org],
    );
    for (const a of approvals) {
      if (!(a.approver ? a.approver === u.id : this.core.can(u, P.approve))) continue;
      out.push({ id: `mtg-approve:${a.id}`, group: 'خطط اجتماعات للاعتماد', link: `/meetings/m/${a.id}`, at: a.updated_at, urgent: a.date <= addDaysAgo(-3), title: `${a.ref_no}: ${a.title}`, subtitle: `موعده ${a.date}` });
    }
    const mine: { id: string; ref_no: string; title: string; date: string; time: string; status: string; rsvp: string; sign: string; deadline: string | null; at: Date }[] = await this.db.query(
      `SELECT m.id, m.ref_no, m.title, m.meeting_date::text AS date, m.start_time AS time, m.status, a.rsvp, a.sign_status AS sign, m.sign_deadline::text AS deadline, m.updated_at AS at
         FROM mtg_attendees a JOIN mtg_meetings m ON m.id = a.meeting_id WHERE a.organization_id = $1 AND a.user_id = $2
          AND ((m.status = 'scheduled' AND a.rsvp = 'pending') OR (m.status = 'signing' AND a.sign_status = 'pending'))`, [org, u.id],
    );
    for (const x of mine) {
      if (x.status === 'scheduled') out.push({ id: `mtg-rsvp:${x.id}`, group: 'دعوات اجتماعات', link: `/meetings/m/${x.id}`, at: x.at, urgent: x.date <= addDaysAgo(-1), title: `أكّد حضورك: ${x.title}`, subtitle: `${x.ref_no} · ${x.date} الساعة ${x.time}` });
      else out.push({ id: `mtg-sign:${x.id}`, group: 'محاضر للتوقيع', link: `/meetings/m/${x.id}?tab=minutes`, at: x.at, urgent: !!x.deadline && x.deadline <= today(), title: `وقّع محضر: ${x.title}`, subtitle: `${x.ref_no}${x.deadline ? ` · آخر موعد ${x.deadline}` : ''}` });
    }
    return out;
  }
}

/** تاريخ قبل n يوم (سالب = بعد) */
function addDaysAgo(n: number) {
  return new Date(Date.now() + 3 * 3600000 - n * 86400000).toISOString().slice(0, 10);
}
