import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { OrgUser } from '../../core/auth/decorators';
import { ACTIVITY_TYPES, CONTACT_TYPES, CrmActivity, CrmLead, CrmParty, LEAD_STATUS, OPEN_LEAD, PARTY_ROLES } from './entities/crm.entity';
import { CrmCore, clean, leadCode, logEntry, partyCode } from './crm-core.service';
import { ActivityDto, ActivityListQuery, CompleteActivityDto } from './crm.dto';
import { LeadsService } from './leads.service';
import { PartiesService } from './parties.service';

/** الأنشطة والمتابعات (مكالمات وزيارات ورسائل ومهام وملاحظات) والتقويم، ولوحة المعلومات */
@Injectable()
export class ActivitiesService {
  constructor(private readonly core: CrmCore, private readonly parties: PartiesService, private readonly leads: LeadsService) {}

  private get db() {
    return this.core.db;
  }

  async list(u: OrgUser, q: ActivityListQuery) {
    const org = u.organizationId;
    const all = this.core.canAll(u);
    if (q.owner && q.owner !== u.id && !all) throw new ForbiddenException('أنشطة الموظفين الآخرين يراها مدير المبيعات');
    const rows: Record<string, unknown>[] = await this.db.query(
      `SELECT a.id, a.type, a.subject, a.details, a.due_at AS "dueAt", a.done_at AS "doneAt", a.outcome, a.owner_id AS "ownerId", us.full_name AS "ownerName",
              a.party_id AS "partyId", p.name AS "partyName", p.party_no AS "partyNo", a.lead_id AS "leadId", l.name AS "leadName", l.lead_no AS "leadNo",
              a.created_by_name AS "createdByName", a.created_at AS "createdAt",
              (a.done_at IS NULL AND a.due_at < now()) AS overdue
         FROM crm_activities a
         LEFT JOIN users us ON us.id = a.owner_id AND us.organization_id = $1
         LEFT JOIN crm_parties p ON p.id = a.party_id AND p.organization_id = $1
         LEFT JOIN crm_leads l ON l.id = a.lead_id AND l.organization_id = $1
        WHERE a.organization_id = $1 AND ($2::boolean OR a.owner_id = $3)
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
      [org, all, u.id, q.owner ?? null, q.status ?? null, q.from ?? null, q.to ?? null, q.type ?? null, q.status === 'done']);
    return rows.map((r) => ({
      ...r, typeLabel: ACTIVITY_TYPES[r.type as keyof typeof ACTIVITY_TYPES],
      partyCode: r.partyNo ? partyCode(Number(r.partyNo)) : null, leadCode: r.leadNo ? leadCode(Number(r.leadNo)) : null,
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

  async create(u: OrgUser, dto: ActivityDto) {
    const org = u.organizationId;
    if (dto.partyId && dto.leadId) throw new BadRequestException('اربط النشاط بجهة أو بعميل محتمل، لا بكليهما');
    if (!dto.done && !dto.dueAt && dto.type !== 'note') throw new BadRequestException('حدد موعد النشاط، أو سجّله كنشاط منجز');
    return this.db.transaction(async (em) => {
      let lead: CrmLead | null = null;
      if (dto.partyId) {
        const p = await this.parties.visible(u, dto.partyId, em);
        if (!p.isActive) throw new BadRequestException('هذه الجهة غير فاعلة');
      }
      if (dto.leadId) lead = await this.leads.visible(u, dto.leadId, em);
      let ownerId = u.id;
      if (dto.ownerId && dto.ownerId !== u.id) {
        if (!this.core.canAll(u) && !this.core.canAssign(u)) throw new ForbiddenException('إسناد النشاط لموظف آخر من صلاحية مدير المبيعات');
        ownerId = (await this.core.user(org, dto.ownerId, em)).id;
      }
      const done = dto.done || dto.type === 'note';
      const a = await em.save(em.create(CrmActivity, {
        organizationId: org, type: dto.type, subject: dto.subject.trim(), details: clean(dto.details), dueAt: dto.dueAt ? new Date(dto.dueAt) : null,
        doneAt: done ? new Date() : null, outcome: done ? clean(dto.outcome) : null, partyId: dto.partyId ?? null, leadId: dto.leadId ?? null,
        ownerId, createdById: u.id, createdByName: u.fullName,
      }));
      if (done) await this.markContact(em, lead, dto.type, u.fullName);
      return { id: a.id };
    });
  }

  private async mine(u: OrgUser, id: string, em: EntityManager) {
    const a = await em.findOne(CrmActivity, { where: { id, organizationId: u.organizationId } });
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
      const lead = a.leadId ? await em.findOne(CrmLead, { where: { id: a.leadId, organizationId: u.organizationId } }) : null;
      await this.markContact(em, lead, a.type, u.fullName);
      const next = clean(dto.nextSubject);
      if (next) {
        if (!dto.nextDueAt) throw new BadRequestException('حدد موعد النشاط التالي');
        await em.insert(CrmActivity, {
          organizationId: u.organizationId, type: dto.nextType ?? 'call', subject: next, details: null, dueAt: new Date(dto.nextDueAt), doneAt: null, outcome: null,
          partyId: a.partyId, leadId: a.leadId, ownerId: a.ownerId, createdById: u.id, createdByName: u.fullName,
        });
      }
      return { ok: true };
    });
  }

  /** حذف نشاط مجدول لم يُنفّذ (المنجز يبقى في السجل) */
  async remove(u: OrgUser, id: string) {
    return this.db.transaction(async (em) => {
      const a = await this.mine(u, id, em);
      if (a.doneAt) throw new BadRequestException('النشاط المنجز يبقى في السجل ولا يُحذف');
      // الحذف يُسجَّل في سجل الجهة أو العميل المحتمل بتفاصيل النشاط المحذوف
      const snapshot = { type: a.type, subject: a.subject, details: a.details, dueAt: a.dueAt, ownerId: a.ownerId, createdByName: a.createdByName };
      const entry = logEntry('حذف نشاط مجدول', u, a.subject, [{ field: 'activity', from: snapshot, to: null }]);
      const parent = a.leadId ? await em.findOne(CrmLead, { where: { id: a.leadId, organizationId: u.organizationId } })
        : a.partyId ? await em.findOne(CrmParty, { where: { id: a.partyId, organizationId: u.organizationId } }) : null;
      if (parent) {
        parent.log = [...parent.log, entry];
        await em.save(parent);
      }
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
