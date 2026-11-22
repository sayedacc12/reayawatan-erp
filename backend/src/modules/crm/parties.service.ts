import { BadRequestException, ConflictException, ForbiddenException, Injectable } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { OrgUser } from '../../core/auth/decorators';
import { BILLING_PERMISSIONS } from '../billing/billing.manifest';
import { MEMBER_PERMISSIONS } from '../members/members.manifest';
import { PARTNERSHIP_PERMISSIONS } from '../partnerships/partnerships.manifest';
import { VOL_PERMISSIONS } from '../volunteers/volunteers.manifest';
import {
  ACTIVITY_TYPES, CHANNELS, Consents, CrmContact, CrmMerge, CrmParty, CrmPartyLink, DECISION_ROLES, LEAD_STATUS, PARTY_KINDS, PARTY_ROLES, PartyKind, PartyRole,
} from './entities/crm.entity';
import { CRM_PERMISSIONS as P } from './crm.manifest';
import { CrmCore, SYSTEM_ACTOR, clean, leadCode, logEntry, normEmail, normName, normPhone, partyCode } from './crm-core.service';
import { ConsentsDto, ContactDto, DuplicateCheckQuery, LinkDto, PartyDto, PartyListQuery } from './crm.dto';

type ExternalRole = Exclude<PartyRole, 'lead'>;
/** سجل خارجي كما يُقرأ من نظامه للربط */
interface SourceRow { id: string; kind: PartyKind; name: string; phone: string | null; email: string | null; city: string | null; vat: string | null; linkTo?: string | null }

/**
 * مصادر السجلات في الأنظمة الأخرى (قراءة فقط، مقيدة بالمنشأة). الكتابة تبقى في كل نظام.
 * linkTo: سجل آخر يُفضّل الربط بجهته (غير مستخدم حاليًا بعد إلغاء نظام الداعمين).
 */
const SOURCES: Record<ExternalRole, { sync: string; byId: string; candidates: string; one: string }> = {
  customer: {
    sync: `SELECT d.id, CASE WHEN d.kind = 'business' THEN 'org' ELSE 'person' END AS kind, d.name, d.phone, d.email, d.address->>'city' AS city, d.vat_number AS vat, NULL AS "linkTo" FROM bl_customers d
      WHERE d.organization_id = $1 AND NOT EXISTS (SELECT 1 FROM crm_party_links l WHERE l.organization_id = $1 AND l.role = 'customer' AND l.ref_id = d.id)
      ORDER BY d.created_at LIMIT 5000`,
    byId: `SELECT d.id, CASE WHEN d.kind = 'business' THEN 'org' ELSE 'person' END AS kind, d.name, d.phone, d.email, d.address->>'city' AS city, d.vat_number AS vat, NULL AS "linkTo" FROM bl_customers d WHERE d.organization_id = $1 AND d.id = $2`,
    candidates: `SELECT x.id, x.name, x.phone, x.email,
        (SELECT p.name FROM crm_party_links l JOIN crm_parties p ON p.id = l.party_id AND p.organization_id = $1 WHERE l.organization_id = $1 AND l.role = 'customer' AND l.ref_id = x.id) AS "linkedTo"
      FROM (SELECT d.id, CASE WHEN d.kind = 'business' THEN 'org' ELSE 'person' END AS kind, d.name, d.phone, d.email, d.address->>'city' AS city, d.vat_number AS vat, NULL AS "linkTo" FROM bl_customers d WHERE d.organization_id = $1) x
      WHERE ($2::text IS NULL OR x.name ILIKE '%' || $2 || '%' OR x.phone LIKE '%' || $2 || '%') ORDER BY x.name LIMIT 30`,
    one: 'SELECT id, customer_no AS no, name, is_active AS active FROM bl_customers WHERE organization_id = $1 AND id = $2',
  },
  partner: {
    sync: `SELECT d.id, 'org' AS kind, d.name, d.phone, d.email, d.city, NULL AS vat, NULL AS "linkTo" FROM pt_partners d
      WHERE d.organization_id = $1 AND NOT EXISTS (SELECT 1 FROM crm_party_links l WHERE l.organization_id = $1 AND l.role = 'partner' AND l.ref_id = d.id)
      ORDER BY d.created_at LIMIT 5000`,
    byId: `SELECT d.id, 'org' AS kind, d.name, d.phone, d.email, d.city, NULL AS vat, NULL AS "linkTo" FROM pt_partners d WHERE d.organization_id = $1 AND d.id = $2`,
    candidates: `SELECT x.id, x.name, x.phone, x.email,
        (SELECT p.name FROM crm_party_links l JOIN crm_parties p ON p.id = l.party_id AND p.organization_id = $1 WHERE l.organization_id = $1 AND l.role = 'partner' AND l.ref_id = x.id) AS "linkedTo"
      FROM (SELECT d.id, 'org' AS kind, d.name, d.phone, d.email, d.city, NULL AS vat, NULL AS "linkTo" FROM pt_partners d WHERE d.organization_id = $1) x
      WHERE ($2::text IS NULL OR x.name ILIKE '%' || $2 || '%' OR x.phone LIKE '%' || $2 || '%') ORDER BY x.name LIMIT 30`,
    one: 'SELECT id, partner_no AS no, name, status FROM pt_partners WHERE organization_id = $1 AND id = $2',
  },
  member: {
    sync: `SELECT d.id, 'person' AS kind, d.full_name AS name, d.mobile AS phone, d.email, d.city, NULL AS vat, NULL AS "linkTo" FROM mem_members d
      WHERE d.organization_id = $1 AND NOT EXISTS (SELECT 1 FROM crm_party_links l WHERE l.organization_id = $1 AND l.role = 'member' AND l.ref_id = d.id)
      ORDER BY d.created_at LIMIT 5000`,
    byId: `SELECT d.id, 'person' AS kind, d.full_name AS name, d.mobile AS phone, d.email, d.city, NULL AS vat, NULL AS "linkTo" FROM mem_members d WHERE d.organization_id = $1 AND d.id = $2`,
    candidates: `SELECT x.id, x.name, x.phone, x.email,
        (SELECT p.name FROM crm_party_links l JOIN crm_parties p ON p.id = l.party_id AND p.organization_id = $1 WHERE l.organization_id = $1 AND l.role = 'member' AND l.ref_id = x.id) AS "linkedTo"
      FROM (SELECT d.id, 'person' AS kind, d.full_name AS name, d.mobile AS phone, d.email, d.city, NULL AS vat, NULL AS "linkTo" FROM mem_members d WHERE d.organization_id = $1) x
      WHERE ($2::text IS NULL OR x.name ILIKE '%' || $2 || '%' OR x.phone LIKE '%' || $2 || '%') ORDER BY x.name LIMIT 30`,
    one: 'SELECT id, member_no AS no, full_name AS name, status FROM mem_members WHERE organization_id = $1 AND id = $2',
  },
  volunteer: {
    sync: `SELECT d.id, 'person' AS kind, d.full_name AS name, d.mobile AS phone, d.email, d.city, NULL AS vat, NULL AS "linkTo" FROM vol_volunteers d
      WHERE d.organization_id = $1 AND NOT EXISTS (SELECT 1 FROM crm_party_links l WHERE l.organization_id = $1 AND l.role = 'volunteer' AND l.ref_id = d.id)
      ORDER BY d.created_at LIMIT 5000`,
    byId: `SELECT d.id, 'person' AS kind, d.full_name AS name, d.mobile AS phone, d.email, d.city, NULL AS vat, NULL AS "linkTo" FROM vol_volunteers d WHERE d.organization_id = $1 AND d.id = $2`,
    candidates: `SELECT x.id, x.name, x.phone, x.email,
        (SELECT p.name FROM crm_party_links l JOIN crm_parties p ON p.id = l.party_id AND p.organization_id = $1 WHERE l.organization_id = $1 AND l.role = 'volunteer' AND l.ref_id = x.id) AS "linkedTo"
      FROM (SELECT d.id, 'person' AS kind, d.full_name AS name, d.mobile AS phone, d.email, d.city, NULL AS vat, NULL AS "linkTo" FROM vol_volunteers d WHERE d.organization_id = $1) x
      WHERE ($2::text IS NULL OR x.name ILIKE '%' || $2 || '%' OR x.phone LIKE '%' || $2 || '%') ORDER BY x.name LIMIT 30`,
    one: 'SELECT id, volunteer_no AS no, full_name AS name, status FROM vol_volunteers WHERE organization_id = $1 AND id = $2',
  },
};
/** ترتيب الربط: العملاء أولًا ثم الشركاء ثم الأعضاء والمتطوعون */
const SYNC_ORDER: ExternalRole[] = ['customer', 'partner', 'member', 'volunteer'];

/** صلاحية عرض تفاصيل السجل في نظامه الأصلي */
const DETAIL_PERMISSION: Record<PartyRole, string[]> = {
  customer: [BILLING_PERMISSIONS.read],
  member: [MEMBER_PERMISSIONS.read],
  volunteer: [VOL_PERMISSIONS.read],
  partner: [PARTNERSHIP_PERMISSIONS.read],
  lead: [P.read],
};

/** آخر مزامنة لكل منشأة في ذاكرة الخادم، حتى لا تتكرر المزامنة مع كل طلب */
const lastSync = new Map<string, number>();

/**
 * سجل الجهات الموحد: الإضافة والتعديل، ومنع التكرار، والدمج، والموافقات التسويقية،
 * وأشخاص الاتصال، والربط بالسجلات في الأنظمة الأخرى، وملف الجهة الشامل (360).
 */
@Injectable()
export class PartiesService {
  constructor(private readonly core: CrmCore) {}

  private get db() {
    return this.core.db;
  }

  // ================= الرؤية والملكية =================

  /** أدوار السجلات الخارجية التي يملك الموظف صلاحية الاطلاع عليها في أنظمتها */
  allowedRoles(u: OrgUser): ExternalRole[] {
    return SYNC_ORDER.filter((r) => DETAIL_PERMISSION[r].some((perm) => this.core.has(u, perm)));
  }

  /**
   * نطاق رؤية الجهات للموظف. يرى الجهة: مدير المبيعات (كل السجلات)، أو المسؤول عنها، أو غيرهما إن كانت الرؤية للجميع
   * وكانت الجهة أُنشئت في علاقات العملاء (بلا سجل خارجي) أو لها سجل في نظام يملك الموظف صلاحية الاطلاع عليه.
   * فلا تظهر بيانات العملاء أو الأعضاء أو المتطوعين لمن لا يراها في أنظمتها.
   */
  async scope(u: OrgUser) {
    const all = this.core.canAll(u);
    const shared = all || (await this.core.settings(u.organizationId)).partyVisibility === 'all';
    return { all, shared, roles: this.allowedRoles(u) as string[] };
  }

  /** الجهة كما يراها الموظف، و404 إن لم تكن من منشأته أو لا يحق له رؤيتها */
  async visible(u: OrgUser, id: string, em: EntityManager = this.db.manager): Promise<CrmParty> {
    const p = await em.findOne(CrmParty, { where: { id, organizationId: u.organizationId } });
    if (!p) this.core.notFound('الجهة');
    const sc = await this.scope(u);
    const [ok] = await em.query('SELECT 1 FROM crm_parties p WHERE p.organization_id = $1 AND p.id = $2 AND crm_party_visible($1, p.id, p.owner_id, $3, $4, $5, $6::text[])',
      [u.organizationId, id, u.id, sc.all, sc.shared, sc.roles]);
    if (!ok) this.core.notFound('الجهة');
    return p;
  }

  /** من يعدّل الجهة: مدير المبيعات، أو المسؤول عنها، أو أي موظف إن لم يكن لها مسؤول */
  assertManage(u: OrgUser, p: CrmParty) {
    if (!this.core.canAll(u) && p.ownerId && p.ownerId !== u.id) throw new ForbiddenException('هذه الجهة مسندة لموظف آخر، ويعدّلها هو أو مدير المبيعات');
    if (!p.isActive) throw new BadRequestException(p.mergedInto ? 'هذه الجهة دُمجت في جهة أخرى' : 'هذه الجهة موقوفة');
  }

  /** البحث في سجلات نظام آخر وربطها يتطلب صلاحية الاطلاع عليها في نظامها (404 حتى لا يُكشف وجودها) */
  private assertRole(u: OrgUser, role: ExternalRole) {
    if (!this.allowedRoles(u).includes(role)) this.core.notFound('السجل');
  }

  private async ownerFor(u: OrgUser, ownerId: string | null | undefined, em: EntityManager) {
    if (!ownerId) return null;
    if (ownerId !== u.id && !this.core.canAll(u) && !this.core.canAssign(u)) throw new ForbiddenException('إسناد الجهة لموظف آخر من صلاحية مدير المبيعات');
    return (await this.core.user(u.organizationId, ownerId, em)).id;
  }

  // ================= القائمة والبحث =================

  async list(u: OrgUser, q: PartyListQuery) {
    const org = u.organizationId;
    await this.sync(org).catch(() => undefined);
    const sc = await this.scope(u);
    const term = clean(q.q);
    const rows: Record<string, unknown>[] = await this.db.query(
      `SELECT p.id, p.party_no AS "partyNo", p.kind, p.name, p.phone, p.email, p.city, p.tags, p.owner_id AS "ownerId", p.do_not_contact AS "doNotContact",
              p.consents, p.created_at AS "createdAt", us.full_name AS "ownerName",
              COALESCE((SELECT jsonb_agg(DISTINCT l.role) FROM crm_party_links l WHERE l.organization_id = $1 AND l.party_id = p.id), '[]') AS roles,
              (SELECT max(COALESCE(a.done_at, a.created_at)) FROM crm_activities a WHERE a.organization_id = $1 AND a.party_id = p.id) AS "lastActivity"
         FROM crm_parties p LEFT JOIN users us ON us.id = p.owner_id AND us.organization_id = $1
        WHERE p.organization_id = $1 AND p.is_active
          AND crm_party_visible($1, p.id, p.owner_id, $3, $2, $10, $11::text[])
          AND ($4::text IS NULL OR p.name ILIKE '%' || $4 || '%' OR p.phone LIKE '%' || $4 || '%' OR p.email ILIKE '%' || $4 || '%' OR p.vat_number LIKE '%' || $4 || '%' OR p.city ILIKE '%' || $4 || '%')
          AND ($5::text IS NULL OR EXISTS (SELECT 1 FROM crm_party_links l WHERE l.organization_id = $1 AND l.party_id = p.id AND l.role = $5))
          AND ($6::text IS NULL OR p.kind = $6)
          AND ($7::uuid IS NULL OR p.owner_id = $7)
          AND ($8::text IS NULL OR p.tags ? $8)
          AND ($9::text IS NULL OR ($9 = 'mine' AND p.owner_id = $3) OR ($9 = 'unowned' AND p.owner_id IS NULL))
        ORDER BY p.updated_at DESC LIMIT 500`,
      [org, sc.all, u.id, term, q.role ?? null, q.kind ?? null, q.owner ?? null, clean(q.tag), q.scope ?? null, sc.shared, sc.roles]);
    return rows.map((r) => ({ ...r, code: partyCode(Number(r.partyNo)) }));
  }

  /** الجهات والعملاء المحتملون المشابهون (بالجوال أو البريد أو الرقم الضريبي أو الاسم) قبل الإضافة */
  /**
   * الجهات والعملاء المحتملون المطابقون (للتنبيه على التكرار). يُعرض للموظف ما يقع في نطاق رؤيته فقط،
   * ويُذكر عدد المطابق خارج نطاقه دون أي بيانات عنه.
   */
  async duplicatesOf(u: OrgUser, q: DuplicateCheckQuery, em: EntityManager = this.db.manager) {
    const org = u.organizationId;
    const phone = normPhone(q.phone);
    const email = normEmail(q.email);
    const vat = clean(q.vat);
    const name = q.name && q.name.trim().length >= 3 ? normName(q.name) : null;
    if (!phone && !email && !vat && !name) return { parties: [], leads: [], hiddenParties: 0, hiddenLeads: 0 };
    const sc = await this.scope(u);
    const parties: ({ name: string; partyNo: number; matchedBy: string; visible: boolean } & Record<string, unknown>)[] = await em.query(
      `SELECT p.id, p.party_no AS "partyNo", p.kind, p.name, p.phone, p.email, p.vat_number AS "vatNumber", p.city,
              CASE WHEN $2::text IS NOT NULL AND p.phone = $2 THEN 'phone' WHEN $3::text IS NOT NULL AND p.email = $3 THEN 'email'
                   WHEN $4::text IS NOT NULL AND p.vat_number = $4 THEN 'vat' ELSE 'name' END AS "matchedBy",
              crm_party_visible($1, p.id, p.owner_id, $7, $8, $9, $10::text[]) AS visible
         FROM crm_parties p
        WHERE p.organization_id = $1 AND p.is_active AND ($6::uuid IS NULL OR p.id <> $6)
          AND (($2::text IS NOT NULL AND p.phone = $2) OR ($3::text IS NOT NULL AND p.email = $3) OR ($4::text IS NOT NULL AND p.vat_number = $4)
               OR ($5::text IS NOT NULL AND lower(regexp_replace(translate(p.name, 'أإآةى', 'اااهي'), '\\s+', ' ', 'g')) = $5))
        LIMIT 10`, [org, phone, email, vat, name, q.exclude ?? null, u.id, sc.all, sc.shared, sc.roles]);
    const leads: ({ name: string; leadNo: number; status: string; visible: boolean } & Record<string, unknown>)[] = await em.query(
      `SELECT id, lead_no AS "leadNo", name, company, phone, email, status, ($5::boolean OR owner_id = $6) AS visible FROM crm_leads
        WHERE organization_id = $1 AND status IN ('new', 'contacted', 'qualified') AND ($4::uuid IS NULL OR id <> $4)
          AND (($2::text IS NOT NULL AND phone = $2) OR ($3::text IS NOT NULL AND email = $3)) LIMIT 10`,
      [org, phone, email, q.exclude ?? null, this.core.canAll(u) || this.core.canAssign(u), u.id]);
    return {
      parties: parties.filter((p) => p.visible).map(({ visible: _v, ...p }) => ({ ...p, code: partyCode(Number(p.partyNo)) })),
      leads: leads.filter((l) => l.visible).map(({ visible: _v, ...l }) => ({ ...l, code: leadCode(Number(l.leadNo)), statusLabel: LEAD_STATUS[l.status as keyof typeof LEAD_STATUS] })),
      hiddenParties: parties.filter((p) => !p.visible && p.matchedBy !== 'name').length,
      hiddenLeads: leads.filter((l) => !l.visible).length,
    };
  }


  private async guardDuplicate(u: OrgUser, d: { phone: string | null; email: string | null; vat: string | null }, allow: boolean | undefined, em: EntityManager, exclude?: string) {
    if (allow) return;
    const { parties, hiddenParties } = await this.duplicatesOf(u, { phone: d.phone ?? undefined, email: d.email ?? undefined, vat: d.vat ?? undefined, exclude }, em);
    const strong = parties.filter((p) => p.matchedBy !== 'name');
    if (strong.length || hiddenParties) {
      const names = strong.map((p) => `${p.name} (${p.code})`).join('، ');
      throw new ConflictException(`${names ? `توجد جهة مسجلة بالبيانات نفسها: ${names}.` : 'توجد جهة مسجلة بالبيانات نفسها خارج نطاق صلاحيتك.'} افتحها بدل إضافة جهة جديدة، أو أكّد أنها جهة مختلفة.`);
    }
  }


  // ================= الإضافة والتعديل =================

  private fields(dto: PartyDto) {
    return {
      kind: dto.kind, name: dto.name.trim(), phone: normPhone(dto.phone), email: normEmail(dto.email), city: clean(dto.city),
      vatNumber: dto.kind === 'org' ? clean(dto.vatNumber) : null, crNumber: dto.kind === 'org' ? clean(dto.crNumber) : null,
      tags: [...new Set((dto.tags ?? []).map((t) => t.trim()).filter(Boolean))], notes: clean(dto.notes),
    };
  }

  async create(u: OrgUser, dto: PartyDto) {
    const org = u.organizationId;
    const s = await this.core.settings(org);
    const f = this.fields(dto);
    return this.db.transaction(async (em) => {
      await this.guardDuplicate(u, { phone: f.phone, email: f.email, vat: f.vatNumber }, dto.allowDuplicate, em);
      const ownerId = dto.ownerId === undefined ? u.id : await this.ownerFor(u, dto.ownerId, em);
      const p = await em.save(em.create(CrmParty, {
        ...f, organizationId: org, partyNo: await this.core.nextNo(em, 'crm_parties', org), ownerId, source: this.core.key(s.sources, dto.source ?? 'manual', 'المصدر'),
        consents: {}, createdByName: u.fullName, log: [logEntry('إضافة الجهة', u, dto.allowDuplicate ? 'أُضيفت رغم وجود جهة مشابهة' : null)],
      }));
      return { id: p.id, code: partyCode(p.partyNo) };
    });
  }

  async update(u: OrgUser, id: string, dto: PartyDto) {
    const org = u.organizationId;
    const s = await this.core.settings(org);
    return this.db.transaction(async (em) => {
      const p = await this.visible(u, id, em);
      this.assertManage(u, p);
      const f = this.fields(dto);
      await this.guardDuplicate(u, { phone: f.phone !== p.phone ? f.phone : null, email: f.email !== p.email ? f.email : null, vat: f.vatNumber !== p.vatNumber ? f.vatNumber : null }, dto.allowDuplicate, em, id);
      const changes = (Object.keys(f) as (keyof typeof f)[]).filter((k) => JSON.stringify(p[k]) !== JSON.stringify(f[k])).map((k) => ({ field: k as string, from: p[k], to: f[k] }));
      Object.assign(p, f);
      if (dto.ownerId !== undefined && (dto.ownerId ?? null) !== p.ownerId) {
        const before = p.ownerId;
        p.ownerId = await this.ownerFor(u, dto.ownerId, em);
        changes.push({ field: 'ownerId', from: before, to: p.ownerId });
      }
      if (dto.source !== undefined) {
        const src = this.core.key(s.sources, dto.source, 'المصدر');
        if (src !== p.source) changes.push({ field: 'source', from: p.source, to: src });
        p.source = src;
      }
      if (changes.length) p.log = [...p.log, logEntry('تعديل البيانات', u, changes.map((c) => FIELD_LABEL[c.field] ?? c.field).join('، '), changes)];
      await em.save(p);
      return { ok: true };
    });
  }

  async setOwner(u: OrgUser, id: string, ownerId: string | null) {
    return this.db.transaction(async (em) => {
      const p = await this.visible(u, id, em);
      if (!this.core.canAssign(u)) throw new ForbiddenException('إسناد الجهات من صلاحية مدير المبيعات');
      const owner = ownerId ? await this.core.user(u.organizationId, ownerId, em) : null;
      const before = p.ownerId;
      if ((owner?.id ?? null) === before) return { ok: true };
      p.ownerId = owner?.id ?? null;
      p.log = [...p.log, logEntry(owner ? 'إسناد الجهة' : 'إلغاء الإسناد', u, owner?.fullName ?? null, [{ field: 'ownerId', from: before, to: p.ownerId }])];
      await em.save(p);
      return { ok: true };
    });
  }

  /** الموافقات التسويقية لكل قناة مع مصدرها وتاريخها، وقائمة «لا تتواصل» */
  async setConsents(u: OrgUser, id: string, dto: ConsentsDto) {
    return this.db.transaction(async (em) => {
      const p = await this.visible(u, id, em);
      this.assertManage(u, p);
      const at = new Date().toISOString();
      const next: Consents = { ...p.consents };
      const notes: string[] = [];
      for (const c of dto.items) {
        if (next[c.channel]?.granted === c.granted) continue;
        next[c.channel] = { granted: c.granted, at, source: c.source.trim(), byName: u.fullName };
        notes.push(`${CHANNELS[c.channel]}: ${c.granted ? 'موافق' : 'غير موافق'} (${c.source.trim()})`);
      }
      if (dto.doNotContact !== p.doNotContact) notes.push(dto.doNotContact ? 'أُضيف لقائمة «لا تتواصل»' : 'أُزيل من قائمة «لا تتواصل»');
      if (!notes.length) return { ok: true };
      p.consents = next;
      p.doNotContact = dto.doNotContact;
      p.log = [...p.log, logEntry('تحديث الموافقات التسويقية', u, notes.join('، '))];
      await em.save(p);
      return { ok: true };
    });
  }

  // ================= أشخاص الاتصال =================

  async saveContact(u: OrgUser, partyId: string, dto: ContactDto, contactId?: string) {
    return this.db.transaction(async (em) => {
      const p = await this.visible(u, partyId, em);
      this.assertManage(u, p);
      if (p.kind !== 'org') throw new BadRequestException('أشخاص الاتصال للمنشآت فقط');
      const org = u.organizationId;
      const row = contactId ? await em.findOne(CrmContact, { where: { id: contactId, partyId, organizationId: org } }) : em.create(CrmContact, { organizationId: org, partyId });
      if (!row) this.core.notFound('الشخص');
      const before = contactId ? { name: row.name, title: row.title, phone: row.phone, email: row.email, decisionRole: row.decisionRole, isPrimary: row.isPrimary } : null;
      Object.assign(row, { name: dto.name.trim(), title: clean(dto.title), phone: normPhone(dto.phone), email: normEmail(dto.email), decisionRole: dto.decisionRole, isPrimary: dto.isPrimary, notes: clean(dto.notes) });
      if (dto.isPrimary) await em.query('UPDATE crm_contacts SET is_primary = false WHERE organization_id = $1 AND party_id = $2', [org, partyId]);
      await em.save(row);
      p.log = [...p.log, logEntry(contactId ? 'تعديل شخص اتصال' : 'إضافة شخص اتصال', u, row.name, before ? [{ field: 'contact', from: before, to: { name: row.name, title: row.title, phone: row.phone, email: row.email, decisionRole: row.decisionRole, isPrimary: row.isPrimary } }] : undefined)];
      await em.save(p);
      return { id: row.id };
    });
  }

  async removeContact(u: OrgUser, partyId: string, contactId: string) {
    return this.db.transaction(async (em) => {
      const p = await this.visible(u, partyId, em);
      this.assertManage(u, p);
      const row = await em.findOne(CrmContact, { where: { id: contactId, partyId, organizationId: u.organizationId } });
      if (!row) this.core.notFound('الشخص');
      const snapshot = { name: row.name, title: row.title, phone: row.phone, email: row.email, decisionRole: row.decisionRole, isPrimary: row.isPrimary };
      await em.remove(row);
      p.log = [...p.log, logEntry('حذف شخص اتصال', u, row.name, [{ field: 'contact', from: snapshot, to: null }])];
      await em.save(p);
      return { ok: true };
    });
  }

  // ================= الربط بالأنظمة الأخرى =================

  /**
   * ربط السجلات الجديدة في الأنظمة الأخرى بجهاتها: يطابق بالرقم الضريبي ثم الجوال ثم البريد،
   * وينشئ جهة جديدة لما لا يطابق شيئًا. آمن للتكرار ولا يعدّل بيانات أي نظام آخر.
   */
  async sync(org: string, force = false) {
    if (!force && Date.now() - (lastSync.get(org) ?? 0) < 60_000) return { linked: 0, created: 0 };
    lastSync.set(org, Date.now());
    return this.db.transaction(async (em) => {
      await em.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`crm_sync:${org}`]);
      const existing: { id: string; phone: string | null; email: string | null; vat_number: string | null }[] = await em.query(
        'SELECT id, phone, email, vat_number FROM crm_parties WHERE organization_id = $1 AND is_active ORDER BY party_no', [org]);
      const byPhone = new Map<string, string>();
      const byEmail = new Map<string, string>();
      const byVat = new Map<string, string>();
      const index = (id: string, phone: string | null, email: string | null, vat: string | null) => {
        if (phone && !byPhone.has(phone)) byPhone.set(phone, id);
        if (email && !byEmail.has(email)) byEmail.set(email, id);
        if (vat && !byVat.has(vat)) byVat.set(vat, id);
      };
      for (const p of existing) index(p.id, p.phone, p.email, p.vat_number);
      let linked = 0;
      let created = 0;
      let nextNo: number | null = null;
      for (const role of SYNC_ORDER) {
        const rows: SourceRow[] = await em.query(SOURCES[role].sync, [org]);
        for (const r of rows) {
          const phone = normPhone(r.phone);
          const email = normEmail(r.email);
          const vat = clean(r.vat);
          let partyId = (vat && byVat.get(vat)) || (phone && byPhone.get(phone)) || (email && byEmail.get(email)) || null;
          if (partyId) {
            linked++;
          } else {
            nextNo = nextNo ?? (await this.core.nextNo(em, 'crm_parties', org));
            const p = await em.save(em.create(CrmParty, {
              organizationId: org, partyNo: nextNo++, kind: r.kind, name: r.name.trim() || '—', phone, email, city: clean(r.city), vatNumber: vat, crNumber: null,
              ownerId: null, source: null, tags: [], consents: {}, notes: null, createdByName: SYSTEM_ACTOR,
              log: [logEntry('إنشاء الجهة آليًا', SYSTEM_ACTOR, `من سجل ${PARTY_ROLES[role]} في نظامه`)],
            }));
            partyId = p.id;
            created++;
          }
          index(partyId, phone, email, vat);
          await em.query(
            `INSERT INTO crm_party_links (organization_id, party_id, role, ref_id, linked_by_name) VALUES ($1, $2, $3, $4, $5) ON CONFLICT DO NOTHING`,
            [org, partyId, role, r.id, SYSTEM_ACTOR]);
        }
      }
      return { linked, created };
    });
  }

  /** ربط يدوي لسجل من نظام آخر بالجهة */
  async link(u: OrgUser, id: string, dto: LinkDto) {
    const org = u.organizationId;
    return this.db.transaction(async (em) => {
      this.assertRole(u, dto.role);
      const p = await this.visible(u, id, em);
      this.assertManage(u, p);
      const [ref] = await em.query(SOURCES[dto.role].one, [org, dto.refId]);
      if (!ref) this.core.notFound('السجل');
      const [other] = await em.query('SELECT l.party_id, p.name FROM crm_party_links l JOIN crm_parties p ON p.id = l.party_id WHERE l.organization_id = $1 AND l.role = $2 AND l.ref_id = $3', [org, dto.role, dto.refId]);
      if (other?.party_id === id) return { ok: true };
      if (other) throw new ConflictException(`هذا السجل مرتبط بالجهة «${other.name}». إن كانتا الجهة نفسها فادمجهما من شاشة المكرر والدمج.`);
      await em.insert(CrmPartyLink, { organizationId: org, partyId: id, role: dto.role, refId: dto.refId, linkedByName: u.fullName });
      p.log = [...p.log, logEntry('ربط سجل من نظام آخر', u, `${PARTY_ROLES[dto.role]}: ${ref.name}`)];
      await em.save(p);
      return { ok: true };
    });
  }

  /** فصل سجل رُبط بالجهة خطأً (مثل فردين من عائلة بجوال واحد): يُنقل إلى جهة جديدة من بياناته في نظامه */
  async detach(u: OrgUser, id: string, linkId: string) {
    const org = u.organizationId;
    return this.db.transaction(async (em) => {
      const p = await this.visible(u, id, em);
      const link = await em.findOne(CrmPartyLink, { where: { id: linkId, partyId: id, organizationId: org } });
      if (!link) this.core.notFound('الربط');
      if (link.role === 'lead') throw new BadRequestException('العميل المحتمل الذي تحول لهذه الجهة لا يُفصل عنها');
      this.assertManage(u, p);
      this.assertRole(u, link.role as ExternalRole);
      const [src]: SourceRow[] = await em.query(SOURCES[link.role as ExternalRole].byId, [org, link.refId]);
      if (!src) this.core.notFound('السجل');
      const n = await this.core.nextNo(em, 'crm_parties', org);
      const np = await em.save(em.create(CrmParty, {
        organizationId: org, partyNo: n, kind: src.kind, name: src.name.trim(), phone: normPhone(src.phone), email: normEmail(src.email), city: clean(src.city),
        vatNumber: clean(src.vat), crNumber: null, ownerId: p.ownerId, source: null, tags: [], consents: {}, notes: null, createdByName: u.fullName,
        log: [logEntry('إنشاء الجهة بالفصل', u, `فُصل ${PARTY_ROLES[link.role]} «${src.name}» عن ${p.name} (${partyCode(p.partyNo)})`)],
      }));
      link.partyId = np.id;
      await em.save(link);
      p.log = [...p.log, logEntry('فصل سجل مرتبط', u, `${PARTY_ROLES[link.role]}: ${src.name}، وأصبح جهة مستقلة ${partyCode(n)}`)];
      await em.save(p);
      return { id: np.id };
    });
  }

  /** السجلات في الأنظمة الأخرى غير المرتبطة بهذه الجهة، للربط اليدوي */
  async linkCandidates(u: OrgUser, id: string, role: ExternalRole, q: string | undefined) {
    if (!SOURCES[role]) throw new BadRequestException('نوع السجل غير معروف');
    this.assertRole(u, role);
    await this.visible(u, id);
    const term = clean(q);
    return this.db.query(SOURCES[role].candidates, [u.organizationId, term]);
  }

  // ================= المكرر والدمج =================

  /** مجموعات الجهات المشتبه بتكرارها: نفس الجوال أو البريد أو الرقم الضريبي أو الاسم */
  async duplicateGroups(u: OrgUser) {
    const org = u.organizationId;
    await this.sync(org).catch(() => undefined);
    const sc = await this.scope(u);
    const groups: { by: string; value: string; ids: string[] }[] = await this.db.query(
      `WITH p AS (SELECT q.id, q.phone, q.email, q.vat_number, lower(regexp_replace(translate(q.name, 'أإآةى', 'اااهي'), '\\s+', ' ', 'g')) AS nm
                    FROM crm_parties q WHERE q.organization_id = $1 AND q.is_active AND crm_party_visible($1, q.id, q.owner_id, $2, $3, $4, $5::text[]))
       SELECT 'phone' AS by, phone AS value, array_agg(id::text ORDER BY id) AS ids FROM p WHERE phone IS NOT NULL GROUP BY phone HAVING count(*) > 1
       UNION ALL SELECT 'email', email, array_agg(id::text ORDER BY id) FROM p WHERE email IS NOT NULL GROUP BY email HAVING count(*) > 1
       UNION ALL SELECT 'vat', vat_number, array_agg(id::text ORDER BY id) FROM p WHERE vat_number IS NOT NULL GROUP BY vat_number HAVING count(*) > 1
       UNION ALL SELECT 'name', nm, array_agg(id::text ORDER BY id) FROM p GROUP BY nm HAVING count(*) > 1
       LIMIT 200`, [org, u.id, sc.all, sc.shared, sc.roles]);
    const ids = [...new Set(groups.flatMap((g) => g.ids))];
    if (!ids.length) return [];
    const rows: Record<string, unknown>[] = await this.db.query(
      `SELECT p.id, p.party_no AS "partyNo", p.kind, p.name, p.phone, p.email, p.vat_number AS "vatNumber", p.city, p.created_at AS "createdAt",
              COALESCE((SELECT jsonb_agg(l.role) FROM crm_party_links l WHERE l.organization_id = $1 AND l.party_id = p.id), '[]') AS roles,
              (SELECT count(*)::int FROM crm_activities a WHERE a.organization_id = $1 AND a.party_id = p.id) AS activities
         FROM crm_parties p WHERE p.organization_id = $1 AND p.id = ANY($2::uuid[])`, [org, ids]);
    const map = new Map(rows.map((r) => [r.id as string, { ...r, code: partyCode(Number(r.partyNo)) }]));
    // المجموعة نفسها قد تظهر بأكثر من سبب: تُعرض مرة واحدة بأسبابها
    const merged = new Map<string, { by: string[]; value: string; parties: unknown[] }>();
    for (const g of groups) {
      const k = g.ids.join(',');
      const cur = merged.get(k);
      if (cur) cur.by.push(g.by);
      else merged.set(k, { by: [g.by], value: g.value, parties: g.ids.map((i) => map.get(i)).filter(Boolean) });
    }
    return [...merged.values()];
  }

  /** دمج جهة مكررة في الجهة الأساسية: تُنقل أدوارها وأشخاصها وأنشطتها وعملاؤها المحتملون، وتُكمَّل البيانات الناقصة */
  async merge(u: OrgUser, keepId: string, removeId: string) {
    if (keepId === removeId) throw new BadRequestException('اختر جهتين مختلفتين');
    const org = u.organizationId;
    return this.db.transaction(async (em) => {
      const locked: CrmParty[] = await em.createQueryBuilder(CrmParty, 'p').setLock('pessimistic_write')
        .where('p.organization_id = :org AND p.id IN (:...ids)', { org, ids: [keepId, removeId] }).getMany();
      const keep = locked.find((p) => p.id === keepId);
      const rem = locked.find((p) => p.id === removeId);
      if (!keep || !rem) this.core.notFound('الجهة');
      if (!keep.isActive || !rem.isActive) throw new BadRequestException('إحدى الجهتين دُمجت أو أوقفت من قبل');
      // الدمج يمس الجهتين معًا: يجب أن تكونا في نطاق رؤية الموظف ومن حقه تعديلهما
      for (const x of [keep, rem]) {
        await this.visible(u, x.id, em);
        this.assertManage(u, x);
      }
      const snapshot = { ...rem } as unknown as Record<string, unknown>;
      const moved = {
        links: (await em.query('UPDATE crm_party_links SET party_id = $3 WHERE organization_id = $1 AND party_id = $2', [org, removeId, keepId]))[1] as number,
        contacts: (await em.query('UPDATE crm_contacts SET party_id = $3 WHERE organization_id = $1 AND party_id = $2', [org, removeId, keepId]))[1] as number,
        activities: (await em.query('UPDATE crm_activities SET party_id = $3 WHERE organization_id = $1 AND party_id = $2', [org, removeId, keepId]))[1] as number,
        leads: (await em.query('UPDATE crm_leads SET party_id = $3 WHERE organization_id = $1 AND party_id = $2', [org, removeId, keepId]))[1] as number,
      };
      // البيانات الناقصة في الأساسية تُكمَّل من المكررة
      for (const k of ['phone', 'email', 'city', 'vatNumber', 'crNumber', 'ownerId', 'source'] as const) {
        if (!keep[k] && rem[k]) (keep as unknown as Record<string, unknown>)[k] = rem[k];
      }
      keep.tags = [...new Set([...keep.tags, ...rem.tags])];
      if (rem.notes) keep.notes = [keep.notes, rem.notes].filter(Boolean).join('\n').slice(0, 2000);
      // الموافقة لكل قناة: الأحدث تاريخًا. ومن طلب عدم التواصل لا يُتواصل معه
      const consents: Consents = { ...keep.consents };
      for (const ch of Object.keys(CHANNELS) as (keyof typeof CHANNELS)[]) {
        const a = keep.consents[ch];
        const b = rem.consents[ch];
        if (b && (!a || b.at > a.at)) consents[ch] = b;
      }
      keep.consents = consents;
      keep.doNotContact = keep.doNotContact || rem.doNotContact;
      keep.log = [...keep.log, logEntry('دمج جهة مكررة', u, `${rem.name} (${partyCode(rem.partyNo)}): ${moved.links} ربط، ${moved.contacts} شخص، ${moved.activities} نشاط، ${moved.leads} عميل محتمل`)];
      rem.isActive = false;
      rem.mergedInto = keepId;
      rem.log = [...rem.log, logEntry('دُمجت في جهة أخرى', u, `${keep.name} (${partyCode(keep.partyNo)})`)];
      await em.save([keep, rem]);
      await em.insert(CrmMerge, { organizationId: org, keptId: keepId, removedId: removeId, snapshot: snapshot as never, byName: u.fullName });
      return { ok: true, moved };
    });
  }

  // ================= ملف الجهة الشامل =================

  async profile(u: OrgUser, id: string) {
    const org = u.organizationId;
    const p = await this.visible(u, id);
    const s = await this.core.settings(org);
    const links: CrmPartyLink[] = await this.db.getRepository(CrmPartyLink).find({ where: { organizationId: org, partyId: id }, order: { createdAt: 'ASC' } });
    const records = [];
    for (const l of links) records.push(await this.record(u, l));
    const [contacts, activities, leads, owner, merges] = await Promise.all([
      this.db.getRepository(CrmContact).find({ where: { organizationId: org, partyId: id }, order: { isPrimary: 'DESC', name: 'ASC' } }),
      this.db.query(
        `SELECT a.id, a.type, a.subject, a.details, a.due_at AS "dueAt", a.done_at AS "doneAt", a.outcome, a.owner_id AS "ownerId", us.full_name AS "ownerName",
                a.created_by_name AS "createdByName", a.created_at AS "createdAt", a.lead_id AS "leadId"
           FROM crm_activities a LEFT JOIN users us ON us.id = a.owner_id AND us.organization_id = $1
          WHERE a.organization_id = $1 AND a.party_id = $2 ORDER BY COALESCE(a.done_at, a.due_at, a.created_at) DESC LIMIT 200`, [org, id]),
      this.db.query(`SELECT id, lead_no AS "leadNo", name, status, source, interest, created_at AS "createdAt", converted_at AS "convertedAt" FROM crm_leads WHERE organization_id = $1 AND party_id = $2 ORDER BY created_at DESC`, [org, id]),
      p.ownerId ? this.db.query('SELECT full_name AS "fullName" FROM users WHERE organization_id = $1 AND id = $2', [org, p.ownerId]).then((r) => r[0]?.fullName ?? null) : null,
      this.db.query(`SELECT removed_id AS "removedId", snapshot->>'name' AS name, by_name AS "byName", created_at AS "createdAt" FROM crm_merges WHERE organization_id = $1 AND kept_id = $2 ORDER BY created_at DESC`, [org, id]),
    ]);
    return {
      ...p, code: partyCode(p.partyNo), kindLabel: PARTY_KINDS[p.kind], ownerName: owner, sourceLabel: this.core.label(s.sources, p.source),
      mergedIntoCode: p.mergedInto ? (await this.db.query('SELECT party_no FROM crm_parties WHERE organization_id = $1 AND id = $2', [org, p.mergedInto]))[0]?.party_no ?? null : null,
      records,
      contacts: contacts.map((c) => ({ ...c, decisionRoleLabel: DECISION_ROLES[c.decisionRole] })),
      activities: activities.map((a: Record<string, unknown>) => ({ ...a, typeLabel: ACTIVITY_TYPES[a.type as keyof typeof ACTIVITY_TYPES] })),
      leads: leads.map((l: Record<string, unknown>) => ({ ...l, code: leadCode(Number(l.leadNo)), statusLabel: LEAD_STATUS[l.status as keyof typeof LEAD_STATUS], sourceLabel: this.core.label(s.sources, l.source as string) })),
      merges,
      can: {
        manage: this.core.has(u, P.manage) && p.isActive && (this.core.canAll(u) || !p.ownerId || p.ownerId === u.id),
        assign: this.core.canAssign(u), merge: this.core.has(u, P.merge),
      },
    };
  }

  /** تفاصيل السجل المرتبط من نظامه، لمن يملك صلاحية العرض فيه فقط */
  private async record(u: OrgUser, l: CrmPartyLink) {
    const org = u.organizationId;
    const base = { linkId: l.id, role: l.role, roleLabel: PARTY_ROLES[l.role], refId: l.refId, linkedByName: l.linkedByName, linkedAt: l.createdAt };
    const allowed = DETAIL_PERMISSION[l.role].some((perm) => this.core.has(u, perm));
    if (!allowed) return { ...base, hidden: true };
    if (l.role === 'lead') {
      const [r] = await this.db.query('SELECT lead_no, name, status FROM crm_leads WHERE organization_id = $1 AND id = $2', [org, l.refId]);
      return { ...base, title: r?.name ?? '—', no: r ? leadCode(r.lead_no) : null, status: r ? LEAD_STATUS[r.status as keyof typeof LEAD_STATUS] : null, link: `/crm/leads/${l.refId}` };
    }
    const [r] = await this.db.query(SOURCES[l.role].one, [org, l.refId]);
    if (!r) return { ...base, title: 'سجل محذوف من نظامه', missing: true };
    const out: Record<string, unknown> = { ...base, title: r.name, no: r.no };
    if (l.role === 'customer') {
      out.link = `/billing/customers/${l.refId}`;
      const [st] = await this.db.query(
        `SELECT COALESCE(SUM(CASE WHEN kind = 'credit_note' THEN -total ELSE total END) FILTER (WHERE status IN ('issued', 'partial', 'paid')), 0)::float AS billed,
                COALESCE(SUM(paid_amount) FILTER (WHERE kind = 'invoice'), 0)::float AS settled,
                count(*) FILTER (WHERE kind = 'invoice' AND status IN ('issued', 'partial', 'paid'))::int AS n,
                count(*) FILTER (WHERE kind = 'invoice' AND status IN ('issued', 'partial') AND due_date < (now() AT TIME ZONE 'Asia/Riyadh')::date)::int AS overdue,
                round(COALESCE(SUM(CASE WHEN kind = 'credit_note' THEN -total ELSE total END) FILTER (WHERE status IN ('issued', 'partial', 'paid')), 0)
                      - COALESCE(SUM(paid_amount) FILTER (WHERE kind = 'invoice'), 0), 2)::text AS balance
           FROM bl_documents WHERE organization_id = $1 AND customer_id = $2`, [org, l.refId]);
      const recent = await this.db.query(
        `SELECT id, doc_no AS no, kind, status, issue_date::text AS date, total::float AS amount, due_date::text AS due FROM bl_documents
          WHERE organization_id = $1 AND customer_id = $2 AND status <> 'cancelled' ORDER BY issue_date DESC, doc_no DESC LIMIT 5`, [org, l.refId]);
      out.stats = [{ label: 'فواتير صادرة', value: st.n }, { label: 'إجمالي المبيعات', value: st.billed, money: true }, { label: 'الرصيد المستحق', value: Number(st.balance), money: true, alert: Number(st.balance) > 0 }, { label: 'فواتير متأخرة', value: st.overdue, alert: st.overdue > 0 }];
      out.items = recent.map((d: Record<string, unknown>) => ({
        id: d.id, title: `${DOC_KIND[d.kind as string] ?? d.kind} ${d.no ?? ''}`.trim(), sub: d.due ? `تستحق ${d.due}` : null, status: DOC_STATUS[d.status as string] ?? d.status, date: d.date, amount: d.amount, link: `/billing/invoices/${d.id}`,
      }));
    } else if (l.role === 'member') {
      out.link = `/members/list/${l.refId}`;
      out.status = MEMBER_STATUS[r.status] ?? r.status;
    } else if (l.role === 'volunteer') {
      out.link = `/volunteers/list/${l.refId}`;
      out.status = VOL_STATUS[r.status] ?? r.status;
    } else if (l.role === 'partner') {
      out.link = `/partnerships/partners/${l.refId}`;
      out.status = PT_STATUS[r.status] ?? r.status;
    }
    return out;
  }
}

const FIELD_LABEL: Record<string, string> = {
  kind: 'النوع', name: 'الاسم', phone: 'الجوال', email: 'البريد', city: 'المدينة', vatNumber: 'الرقم الضريبي', crNumber: 'السجل التجاري', tags: 'الوسوم', notes: 'الملاحظات', ownerId: 'المسؤول', source: 'المصدر',
};
const DOC_KIND: Record<string, string> = { invoice: 'فاتورة', credit_note: 'إشعار دائن', debit_note: 'إشعار مدين' };
const DOC_STATUS: Record<string, string> = { draft: 'مسودة', pending: 'بانتظار الإصدار', issued: 'صادرة', partial: 'محصلة جزئيًا', paid: 'محصلة', cancelled: 'ملغاة' };
const MEMBER_STATUS: Record<string, string> = { active: 'عضوية سارية', suspended: 'موقوفة', terminated: 'منتهية' };
const VOL_STATUS: Record<string, string> = { pending: 'بانتظار الاعتماد', active: 'فاعل', inactive: 'غير فاعل', rejected: 'مرفوض' };
const PT_STATUS: Record<string, string> = { prospect: 'شريك محتمل', evaluating: 'قيد التقييم', pending: 'بانتظار الاعتماد', approved: 'شريك معتمد', rejected: 'غير مقبول', suspended: 'موقوف' };
