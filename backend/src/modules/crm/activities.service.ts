import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { OrgUser } from '../../core/auth/decorators';
import { PermissionResolver } from '../../core/auth/permission-resolver.service';
import { CRM_PERMISSIONS as P } from './crm.manifest';
import { ACTIVITY_TYPES, CONTACT_TYPES, CrmActivity, CrmLead, CrmParty, LEAD_STATUS, MAX_AUDIENCE_PARTIES, OPEN_LEAD, PARTY_ROLES } from './entities/crm.entity';
import { CrmCore, audienceLabel, clean, leadCode, logEntry, partyCode } from './crm-core.service';
import { ActivityDto, ActivityListQuery, CompleteActivityDto, FollowersDto } from './crm.dto';
import { LeadsService } from './leads.service';
import { PartiesService } from './parties.service';

/** الأنشطة والمتابعات (مكالمات وزيارات ورسائل ومهام وملاحظات) والتقويم، ولوحة المعلومات */
@Injectable()
export class ActivitiesService {
  constructor(
    private readonly core: CrmCore, private readonly parties: PartiesService, private readonly leads: LeadsService, private readonly perms: PermissionResolver,
  ) {}

  private get db() {
    return this.core.db;
  }

  async list(u: OrgUser, q: ActivityListQuery) {
    const org = u.organizationId;
    const all = this.core.canAll(u);
    if (q.owner && q.owner !== u.id && !all) throw new ForbiddenException('أنشطة الموظفين الآخرين يراها مدير المبيعات');
    const sc = await this.parties.scope(u);
    // يرى الموظف أنشطته التي أُسندت إليه، والتي أنشأها لغيره، والتي أُضيف إليها متابعًا. ومدير المبيعات يرى الكل
    const rows: Record<string, unknown>[] = await this.db.query(
      `SELECT a.id, a.type, a.subject, a.details, a.due_at AS "dueAt", a.done_at AS "doneAt", a.outcome, a.owner_id AS "ownerId", us.full_name AS "ownerName",
              a.party_id AS "partyId", a.lead_id AS "leadId",
              -- اسم الجهة أو العميل المحتمل لمن يحق له رؤيته فقط (المسند إليه أو المتابع قد لا يراه)
              CASE WHEN crm_party_visible($1, p.id, p.owner_id, $3, $2, $10, $11::text[]) THEN p.name END AS "partyName",
              CASE WHEN crm_party_visible($1, p.id, p.owner_id, $3, $2, $10, $11::text[]) THEN p.party_no END AS "partyNo",
              CASE WHEN $12::boolean OR l.owner_id = $3 THEN l.name END AS "leadName",
              CASE WHEN $12::boolean OR l.owner_id = $3 THEN l.lead_no END AS "leadNo",
              a.created_by_id AS "createdById", a.created_by_name AS "createdByName", a.created_at AS "createdAt",
              (a.done_at IS NULL AND a.due_at < now()) AS overdue,
              a.audience, a.audience_role AS "audienceRole",
              CASE WHEN a.audience IS NOT NULL THEN (SELECT count(*)::int FROM crm_activity_parties ap WHERE ap.organization_id = $1 AND ap.activity_id = a.id) END AS "partyCount",
              CASE WHEN a.audience IS NOT NULL THEN (
                SELECT COALESCE(jsonb_agg(jsonb_build_object('id', x.id, 'name', x.name) ORDER BY x.name), '[]') FROM (
                  SELECT p2.id, p2.name FROM crm_activity_parties ap JOIN crm_parties p2 ON p2.id = ap.party_id AND p2.organization_id = $1
                   WHERE ap.organization_id = $1 AND ap.activity_id = a.id AND crm_party_visible($1, p2.id, p2.owner_id, $3, $2, $10, $11::text[])
                   ORDER BY p2.name LIMIT 5) x) END AS parties,
              (SELECT COALESCE(jsonb_agg(jsonb_build_object('id', fu.id, 'name', fu.full_name) ORDER BY fu.full_name), '[]')
                 FROM crm_activity_followers f JOIN users fu ON fu.id = f.user_id AND fu.organization_id = $1
                WHERE f.organization_id = $1 AND f.activity_id = a.id) AS followers
         FROM crm_activities a
         LEFT JOIN users us ON us.id = a.owner_id AND us.organization_id = $1
         LEFT JOIN crm_parties p ON p.id = a.party_id AND p.organization_id = $1
         LEFT JOIN crm_leads l ON l.id = a.lead_id AND l.organization_id = $1
        WHERE a.organization_id = $1
          AND ($2::boolean OR a.owner_id = $3 OR a.created_by_id = $3
               OR EXISTS (SELECT 1 FROM crm_activity_followers f WHERE f.organization_id = $1 AND f.activity_id = a.id AND f.user_id = $3))
          AND ($4::uuid IS NULL OR a.owner_id = $4)
          AND ($5::text IS NULL
               OR ($5 = 'open' AND a.done_at IS NULL) OR ($5 = 'done' AND a.done_at IS NOT NULL)
               OR ($5 = 'overdue' AND a.done_at IS NULL AND a.due_at < now())
               OR ($5 = 'today' AND a.done_at IS NULL AND (a.due_at AT TIME ZONE 'Asia/Riyadh')::date <= (now() AT TIME ZONE 'Asia/Riyadh')::date))
          AND ($6::timestamptz IS NULL OR COALESCE(a.due_at, a.done_at, a.created_at) >= $6)
          AND ($7::timestamptz IS NULL OR COALESCE(a.due_at, a.done_at, a.created_at) < $7)
          AND ($8::text IS NULL OR a.type = $8)
        ORDER BY (a.done_at IS NULL) DESC,
                 CASE WHEN $9::boolean THEN COALESCE(a.due_at, a.done_at, a.created_at) END DESC,
                 COALESCE(a.due_at, a.done_at, a.created_at) ASC
        LIMIT 500`,
      [org, all, u.id, q.owner ?? null, q.status ?? null, q.from ?? null, q.to ?? null, q.type ?? null, q.status === 'done', sc.shared, sc.roles, this.core.canAssign(u)]);
    return rows.map((r) => ({
      ...r, typeLabel: ACTIVITY_TYPES[r.type as keyof typeof ACTIVITY_TYPES],
      partyCode: r.partyNo ? partyCode(Number(r.partyNo)) : null, leadCode: r.leadNo ? leadCode(Number(r.leadNo)) : null,
      audienceLabel: audienceLabel(r.audience as string | null, r.audienceRole as string | null, r.partyCount as number | null),
      // متابع فقط: يطّلع على النشاط ولا ينجزه ولا يحذفه
      following: !all && r.ownerId !== u.id && r.createdById !== u.id,
    }));
  }

  /** أول تواصل فعلي مع العميل المحتمل: يُسجل وقته، والجديد يصبح «تم التواصل» */
  private async markContact(em: EntityManager, lead: CrmLead | null, type: string, byName: string) {
    if (!lead || !CONTACT_TYPES.includes(type as never) || lead.firstContactAt || !OPEN_LEAD.includes(lead.status)) return;
    lead.firstContactAt = new Date();
    if (lead.status === 'new') {
      lead.status = 'contacted';
      lead.log = [...lead.log, logEntry(`تغيير الحالة إلى «${LEAD_STATUS.contacted}»`, byName, 'بتسجيل أول تواصل')];
    }
    await em.save(lead);
  }

  /**
   * من يُسند إليه النشاط أو يتابعه: موظف فاعل من المنشأة نفسها يملك صلاحية علاقات العملاء
   * (إدارة الأنشطة للمسؤول، والاطلاع للمتابع)، ويرى الجهة أو العميل المحتمل المرتبط بالنشاط.
   */
  private async colleague(org: string, id: string, need: string, what: string, link: { partyId: string | null; leadId: string | null }, em: EntityManager) {
    const r = await this.perms.resolve(id);
    if (!r || r.organizationId !== org || r.isPlatformAdmin) throw new BadRequestException(`${what} غير موجود أو غير فاعل`);
    const v = r as OrgUser;
    if (!this.core.has(v, need)) throw new BadRequestException(`${v.fullName} لا يملك صلاحية ${need === P.manage ? 'إدارة الأنشطة' : 'الاطلاع على علاقات العملاء'}، فلا يمكن ${what === 'المسؤول' ? 'إسناد النشاط إليه' : 'إضافته متابعًا'}`);
    try {
      if (link.partyId) await this.parties.visible(v, link.partyId, em);
      if (link.leadId) await this.leads.visible(v, link.leadId, em);
    } catch {
      throw new BadRequestException(`${v.fullName} لا يرى ${link.leadId ? 'هذا العميل المحتمل' : 'هذه الجهة'}، فاختر غيره أو أسند ${link.leadId ? 'العميل المحتمل' : 'الجهة'} إليه أولًا`);
    }
    return v;
  }

  private async followerIds(org: string, ids: string[] | undefined, ownerId: string, link: { partyId: string | null; leadId: string | null }, em: EntityManager) {
    const list = [...new Set(ids ?? [])].filter((id) => id !== ownerId);
    for (const id of list) await this.colleague(org, id, P.read, 'المتابع', link, em);
    return list;
  }

  /**
   * الجهات المرتبطة بنشاط لعدة جهات: المختارة (كلها في نطاق رؤية الموظف وفاعلة، وإلا 404)،
   * أو «الكل»: كل الجهات الفاعلة التي يراها الموظف بالدور المختار. ومن طلب عدم التواصل يُستبعد من أنشطة التواصل الجماعية.
   */
  private async audienceParties(u: OrgUser, dto: ActivityDto, picked: string[], em: EntityManager) {
    const org = u.organizationId;
    const sc = await this.parties.scope(u);
    if (!dto.allParties) {
      const found: { id: string; name: string; dnc: boolean }[] = await em.query(
        `SELECT p.id, p.name, p.do_not_contact AS dnc FROM crm_parties p WHERE p.organization_id = $1 AND p.id = ANY($2::uuid[]) AND p.is_active
            AND crm_party_visible($1, p.id, p.owner_id, $3, $4, $5, $6::text[])`, [org, picked, u.id, sc.all, sc.shared, sc.roles]);
      if (found.length !== picked.length) this.core.notFound('الجهة');
      const dnc = found.filter((p) => p.dnc);
      if (dnc.length && CONTACT_TYPES.includes(dto.type as never)) {
        throw new BadRequestException(`طلبت هذه الجهات عدم التواصل معها، فأزلها من القائمة: ${dnc.map((p) => p.name).join('، ')}`);
      }
      return { ids: picked, excluded: 0 };
    }
    const contact = CONTACT_TYPES.includes(dto.type as never);
    const rows: { id: string; dnc: boolean }[] = await em.query(
      `SELECT p.id, p.do_not_contact AS dnc FROM crm_parties p WHERE p.organization_id = $1 AND p.is_active
          AND crm_party_visible($1, p.id, p.owner_id, $2, $3, $4, $5::text[])
          AND ($6::text IS NULL OR EXISTS (SELECT 1 FROM crm_party_links k WHERE k.organization_id = $1 AND k.party_id = p.id AND k.role = $6))
        ORDER BY p.party_no LIMIT ${MAX_AUDIENCE_PARTIES + 1}`, [org, u.id, sc.all, sc.shared, sc.roles, dto.audienceRole ?? null]);
    const ids = rows.filter((r) => !(contact && r.dnc)).map((r) => r.id);
    if (rows.length > MAX_AUDIENCE_PARTIES) throw new BadRequestException(`عدد الجهات أكبر من ${MAX_AUDIENCE_PARTIES}، فاختر دورًا أضيق`);
    if (!ids.length) throw new BadRequestException(rows.length ? 'كل الجهات في هذا الاختيار طلبت عدم التواصل معها' : 'لا توجد جهات في هذا الاختيار');
    return { ids, excluded: rows.length - ids.length };
  }

  async create(u: OrgUser, dto: ActivityDto) {
    const org = u.organizationId;
    const picked = [...new Set(dto.partyIds ?? [])];
    const ways = [!!dto.partyId, picked.length > 0, !!dto.allParties, !!dto.leadId].filter(Boolean).length;
    if (ways > 1) throw new BadRequestException('اربط النشاط بطريقة واحدة: جهة، أو عدة جهات، أو الكل، أو عميل محتمل');
    if (!dto.done && !dto.dueAt && dto.type !== 'note') throw new BadRequestException('حدد موعد النشاط، أو سجّله كنشاط منجز');
    // جهة واحدة من القائمة تُربط مباشرةً كالمعتاد
    const partyId = dto.partyId ?? (picked.length === 1 ? picked[0] : null);
    const multi = dto.allParties || picked.length > 1;
    if (dto.allParties) await this.parties.sync(org).catch(() => undefined);
    return this.db.transaction(async (em) => {
      let lead: CrmLead | null = null;
      if (partyId) {
        const p = await this.parties.visible(u, partyId, em);
        if (!p.isActive) throw new BadRequestException('هذه الجهة غير فاعلة');
      }
      const audience = multi ? await this.audienceParties(u, dto, picked, em) : null;
      if (dto.leadId) lead = await this.leads.visible(u, dto.leadId, em);
      // الإسناد لزميل: أي موظف يدير الأنشطة يسند نشاطًا لموظف فاعل آخر، فيظهر في قائمته وجرس مهامه
      const link = { partyId: multi ? null : partyId, leadId: dto.leadId ?? null };
      const ownerId = dto.ownerId && dto.ownerId !== u.id ? (await this.colleague(org, dto.ownerId, P.manage, 'المسؤول', link, em)).id : u.id;
      const followers = await this.followerIds(org, dto.followerIds, ownerId, link, em);
      const done = dto.done || dto.type === 'note';
      const a = await em.save(em.create(CrmActivity, {
        organizationId: org, type: dto.type, subject: dto.subject.trim(), details: clean(dto.details), dueAt: dto.dueAt ? new Date(dto.dueAt) : null,
        doneAt: done ? new Date() : null, outcome: done ? clean(dto.outcome) : null, partyId: multi ? null : partyId, leadId: dto.leadId ?? null,
        audience: multi ? (dto.allParties ? 'all' : 'many') : null, audienceRole: dto.allParties ? dto.audienceRole ?? null : null,
        ownerId, createdById: u.id, createdByName: u.fullName,
      }));
      if (audience) {
        await em.query('INSERT INTO crm_activity_parties (activity_id, party_id, organization_id) SELECT $1, unnest($2::uuid[]), $3', [a.id, audience.ids, org]);
      }
      if (followers.length) {
        await em.query('INSERT INTO crm_activity_followers (activity_id, user_id, organization_id) SELECT $1, unnest($2::uuid[]), $3', [a.id, followers, org]);
      }
      if (done) await this.markContact(em, lead, dto.type, u.fullName);
      return { id: a.id, parties: audience ? audience.ids.length : partyId ? 1 : 0, excluded: audience?.excluded ?? 0 };
    });
  }

  /** النشاط لمن يحق له إنجازه أو حذفه: المسؤول عنه أو منشئه أو مدير المبيعات. والمتابع يطّلع فقط */
  private async mine(u: OrgUser, id: string, em: EntityManager) {
    // القفل يمنع إنجاز النشاط أو حذفه مرتين في اللحظة نفسها
    const a = await em.findOne(CrmActivity, { where: { id, organizationId: u.organizationId }, lock: { mode: 'pessimistic_write' } });
    if (a && !this.core.canAll(u) && a.ownerId !== u.id && a.createdById !== u.id) {
      const [f] = await em.query('SELECT 1 FROM crm_activity_followers WHERE organization_id = $1 AND activity_id = $2 AND user_id = $3', [u.organizationId, id, u.id]);
      if (f) throw new ForbiddenException('أنت متابع لهذا النشاط للاطلاع فقط، وينجزه المسؤول عنه');
    }
    if (!a || (!this.core.canAll(u) && a.ownerId !== u.id && a.createdById !== u.id)) this.core.notFound('النشاط');
    return a;
  }

  async complete(u: OrgUser, id: string, dto: CompleteActivityDto) {
    return this.db.transaction(async (em) => {
      const a = await this.mine(u, id, em);
      if (a.doneAt) throw new BadRequestException('هذا النشاط منجز من قبل');
      a.doneAt = new Date();
      a.outcome = clean(dto.outcome);
      await em.save(a);
      // أول تواصل يُسجَّل على العميل المحتمل فقط إن كان المُنجز يراه
      const lead = a.leadId ? await this.leads.visible(u, a.leadId, em).catch(() => null) : null;
      await this.markContact(em, lead, a.type, u.fullName);
      const next = clean(dto.nextSubject);
      if (next) {
        if (!dto.nextDueAt) throw new BadRequestException('حدد موعد النشاط التالي');
        // الخطوة التالية تتبع النشاط نفسه: الجهات نفسها والمتابعون أنفسهم
        const n = await em.save(em.create(CrmActivity, {
          organizationId: u.organizationId, type: dto.nextType ?? 'call', subject: next, details: null, dueAt: new Date(dto.nextDueAt), doneAt: null, outcome: null,
          partyId: a.partyId, leadId: a.leadId, audience: a.audience, audienceRole: a.audienceRole, ownerId: a.ownerId, createdById: u.id, createdByName: u.fullName,
        }));
        await em.query(
          `INSERT INTO crm_activity_parties (activity_id, party_id, organization_id) SELECT $3, party_id, organization_id FROM crm_activity_parties WHERE organization_id = $1 AND activity_id = $2`,
          [u.organizationId, a.id, n.id]);
        await em.query(
          `INSERT INTO crm_activity_followers (activity_id, user_id, organization_id) SELECT $3, user_id, organization_id FROM crm_activity_followers WHERE organization_id = $1 AND activity_id = $2`,
          [u.organizationId, a.id, n.id]);
      }
      return { ok: true };
    });
  }

  /** تعديل متابعي النشاط: المسؤول عنه أو منشئه أو مدير المبيعات */
  async setFollowers(u: OrgUser, id: string, dto: FollowersDto) {
    const org = u.organizationId;
    return this.db.transaction(async (em) => {
      const a = await this.mine(u, id, em);
      const list = await this.followerIds(org, dto.userIds, a.ownerId, { partyId: a.partyId, leadId: a.leadId }, em);
      const before: { user_id: string }[] = await em.query('SELECT user_id FROM crm_activity_followers WHERE organization_id = $1 AND activity_id = $2 ORDER BY user_id', [org, a.id]);
      await em.query('DELETE FROM crm_activity_followers WHERE organization_id = $1 AND activity_id = $2', [org, a.id]);
      if (list.length) await em.query('INSERT INTO crm_activity_followers (activity_id, user_id, organization_id) SELECT $1, unnest($2::uuid[]), $3', [a.id, list, org]);
      // التعديل يُسجَّل في سجل الجهة أو العميل المحتمل: من ومتى، والمتابعون قبل التعديل وبعده
      const entry = logEntry('تعديل متابعي نشاط', u, a.subject, [{ field: 'followers', from: before.map((b) => b.user_id), to: [...list].sort() }]);
      await this.appendLog(em, org, a, entry);
      return { ok: true, followers: list.length };
    });
  }

  /** قيد في سجل العميل المحتمل أو الجهة المرتبطة بالنشاط، أو في سجل كل جهة من جهات النشاط الجماعي */
  private async appendLog(em: EntityManager, org: string, a: CrmActivity, entry: ReturnType<typeof logEntry>) {
    const parent = a.leadId ? await em.findOne(CrmLead, { where: { id: a.leadId, organizationId: org } })
      : a.partyId ? await em.findOne(CrmParty, { where: { id: a.partyId, organizationId: org } }) : null;
    if (parent) {
      parent.log = [...parent.log, entry];
      await em.save(parent);
    }
    if (a.audience) {
      await em.query(
        `UPDATE crm_parties SET log = log || $3::jsonb WHERE organization_id = $1
            AND id IN (SELECT party_id FROM crm_activity_parties WHERE organization_id = $1 AND activity_id = $2)`, [org, a.id, JSON.stringify([entry])]);
    }
  }

  /** حذف نشاط مجدول لم يُنفّذ (المنجز يبقى في السجل) */
  async remove(u: OrgUser, id: string) {
    const org = u.organizationId;
    return this.db.transaction(async (em) => {
      const a = await this.mine(u, id, em);
      if (a.doneAt) throw new BadRequestException('النشاط المنجز يبقى في السجل ولا يُحذف');
      // الحذف يُسجَّل في سجل الجهة (أو الجهات) أو العميل المحتمل بتفاصيل النشاط المحذوف
      const snapshot = { type: a.type, subject: a.subject, details: a.details, dueAt: a.dueAt, ownerId: a.ownerId, createdByName: a.createdByName, audience: a.audience };
      const entry = logEntry('حذف نشاط مجدول', u, a.subject, [{ field: 'activity', from: snapshot, to: null }]);
      await this.appendLog(em, org, a, entry);
      await em.query('DELETE FROM crm_activity_parties WHERE organization_id = $1 AND activity_id = $2', [org, a.id]);
      await em.query('DELETE FROM crm_activity_followers WHERE organization_id = $1 AND activity_id = $2', [org, a.id]);
      await em.remove(a);
      return { ok: true };
    });
  }

  // ================= لوحة المعلومات =================

  async dashboard(u: OrgUser) {
    const org = u.organizationId;
    await this.parties.sync(org).catch(() => undefined);
    const s = await this.core.settings(org);
    const allLeads = this.core.canAll(u) || this.core.canAssign(u);
    const allActs = this.core.canAll(u);
    const seesParties = allActs || s.partyVisibility === 'all';
    const [[parties], roles, [leads], bySource, byOwner, [acts], recent, trend] = await Promise.all([
      this.db.query(
        `SELECT count(*)::int AS total, count(*) FILTER (WHERE kind = 'org')::int AS orgs, count(*) FILTER (WHERE created_at > now() - interval '30 days')::int AS new30,
                count(*) FILTER (WHERE owner_id = $2)::int AS mine
           FROM crm_parties WHERE organization_id = $1 AND is_active AND ($3::boolean OR owner_id = $2)`, [org, u.id, seesParties]),
      this.db.query(
        `SELECT l.role, count(DISTINCT l.party_id)::int AS n FROM crm_party_links l JOIN crm_parties p ON p.id = l.party_id
          WHERE l.organization_id = $1 AND p.is_active AND ($3::boolean OR p.owner_id = $2) GROUP BY l.role`, [org, u.id, seesParties]),
      this.db.query(
        `SELECT count(*) FILTER (WHERE status IN ('new', 'contacted', 'qualified'))::int AS open,
                count(*) FILTER (WHERE status = 'new')::int AS "new", count(*) FILTER (WHERE status = 'contacted')::int AS contacted, count(*) FILTER (WHERE status = 'qualified')::int AS qualified,
                count(*) FILTER (WHERE status IN ('new', 'contacted', 'qualified') AND owner_id IS NULL)::int AS unassigned,
                count(*) FILTER (WHERE status IN ('new', 'contacted', 'qualified') AND first_contact_at IS NULL AND due_at < now())::int AS overdue,
                count(*) FILTER (WHERE created_at > now() - interval '90 days')::int AS in90,
                count(*) FILTER (WHERE created_at > now() - interval '90 days' AND status = 'converted')::int AS converted90,
                count(*) FILTER (WHERE created_at > now() - interval '90 days' AND status = 'disqualified')::int AS lost90,
                count(*) FILTER (WHERE first_contact_at IS NOT NULL AND created_at > now() - interval '90 days')::int AS contacted90,
                count(*) FILTER (WHERE first_contact_at IS NOT NULL AND first_contact_at <= due_at AND created_at > now() - interval '90 days')::int AS ontime90,
                round(avg(EXTRACT(EPOCH FROM (first_contact_at - created_at)) / 3600) FILTER (WHERE first_contact_at IS NOT NULL AND created_at > now() - interval '90 days')::numeric, 1)::float AS "avgHours"
           FROM crm_leads WHERE organization_id = $1 AND ($3::boolean OR owner_id = $2)`, [org, u.id, allLeads]),
      this.db.query(
        `SELECT source, count(*)::int AS n, count(*) FILTER (WHERE status = 'converted')::int AS converted FROM crm_leads
          WHERE organization_id = $1 AND created_at > now() - interval '90 days' AND ($3::boolean OR owner_id = $2) GROUP BY source ORDER BY n DESC`, [org, u.id, allLeads]),
      allLeads ? this.db.query(
        `SELECT l.owner_id AS "ownerId", us.full_name AS name, count(*) FILTER (WHERE l.status IN ('new', 'contacted', 'qualified'))::int AS open,
                count(*) FILTER (WHERE l.status IN ('new', 'contacted', 'qualified') AND l.first_contact_at IS NULL AND l.due_at < now())::int AS overdue,
                count(*) FILTER (WHERE l.status = 'converted' AND l.converted_at > now() - interval '90 days')::int AS converted
           FROM crm_leads l JOIN users us ON us.id = l.owner_id AND us.organization_id = $1
          WHERE l.organization_id = $1 GROUP BY l.owner_id, us.full_name ORDER BY open DESC LIMIT 20`, [org]) : [],
      this.db.query(
        `SELECT count(*) FILTER (WHERE done_at IS NULL AND due_at < now())::int AS overdue,
                count(*) FILTER (WHERE done_at IS NULL AND (due_at AT TIME ZONE 'Asia/Riyadh')::date = (now() AT TIME ZONE 'Asia/Riyadh')::date)::int AS today,
                count(*) FILTER (WHERE done_at IS NULL AND due_at >= now() AND due_at < now() + interval '7 days')::int AS week,
                count(*) FILTER (WHERE done_at > now() - interval '30 days')::int AS done30
           FROM crm_activities WHERE organization_id = $1 AND ($3::boolean OR owner_id = $2)`, [org, u.id, allActs]),
      this.list(u, { status: 'open' }).then((r) => r.slice(0, 8)),
      this.db.query(
        `SELECT to_char(date_trunc('week', created_at AT TIME ZONE 'Asia/Riyadh'), 'YYYY-MM-DD') AS week, count(*)::int AS n,
                count(*) FILTER (WHERE status = 'converted')::int AS converted
           FROM crm_leads WHERE organization_id = $1 AND created_at > now() - interval '12 weeks' AND ($3::boolean OR owner_id = $2)
          GROUP BY 1 ORDER BY 1`, [org, u.id, allLeads]),
    ]);
    const closed90 = leads.converted90 + leads.lost90;
    return {
      parties, roles: roles.map((r: { role: string; n: number }) => ({ ...r, label: PARTY_ROLES[r.role as keyof typeof PARTY_ROLES] })),
      leads: { ...leads, conversionRate: closed90 ? Math.round((leads.converted90 / closed90) * 100) : null, onTimeRate: leads.contacted90 ? Math.round((leads.ontime90 / leads.contacted90) * 100) : null },
      bySource: bySource.map((r: { source: string; n: number; converted: number }) => ({ ...r, label: this.core.label(s.sources, r.source) })),
      byOwner, activities: acts, upcoming: recent, trend, slaHours: s.slaHours, scope: { allLeads, allActs },
    };
  }
}
