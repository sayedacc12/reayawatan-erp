import { BadRequestException, ConflictException, ForbiddenException, Injectable } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { OrgUser } from '../../core/auth/decorators';
import { CrmActivity, CrmContact, CrmLead, CrmParty, LEAD_STATUS, OPEN_LEAD } from './entities/crm.entity';
import { CrmCore, clean, leadCode, logEntry, normEmail, normPhone, partyCode } from './crm-core.service';
import { WEB_TOPIC_INTEREST } from './crm-defaults';
import { ConvertDto, ImportDto, LeadDto, LeadListQuery, LeadStatusDto } from './crm.dto';
import { PartiesService } from './parties.service';

const HOUR = 3600_000;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const PHONE_RE = /^\+?[0-9]{7,20}$/;

/** رسالة «تواصل معنا» كما يمررها الموقع الإلكتروني */
/** طلب من نماذج الموقع (id = رقم الطلب في rw_leads، topic = مصدره: استشارة أو حجز أو تقييم أو حاسبة أو دليل) */
export interface WebsiteMessage { id: string; name: string; company?: string | null; phone: string | null; email: string | null; topic: string; topicLabel?: string; body: string }

/**
 * العملاء المحتملون: الإدخال والاستيراد واستقبال رسائل الموقع، والتوزيع على الفريق ومهلة التواصل الأول،
 * والتأهيل أو عدم التأهيل بسبب، والتحويل إلى جهة في السجل الموحد.
 */
@Injectable()
export class LeadsService {
  constructor(private readonly core: CrmCore, private readonly parties: PartiesService) {}

  private get db() {
    return this.core.db;
  }

  /** مدير المبيعات ومن يوزّع يرى كل العملاء المحتملين، والموظف يرى المسندين إليه */
  private seesAll(u: OrgUser) {
    return this.core.canAll(u) || this.core.canAssign(u);
  }

  async visible(u: OrgUser, id: string, em: EntityManager = this.db.manager): Promise<CrmLead> {
    const l = await em.findOne(CrmLead, { where: { id, organizationId: u.organizationId } });
    if (!l || (!this.seesAll(u) && l.ownerId !== u.id)) this.core.notFound('العميل المحتمل');
    return l;
  }

  private assertOpen(l: CrmLead) {
    if (!OPEN_LEAD.includes(l.status)) throw new BadRequestException(l.status === 'converted' ? 'تحول هذا العميل المحتمل إلى جهة، وتُتابع من ملفها' : 'هذا العميل المحتمل غير مؤهل، أعد فتحه أولًا');
  }

  // ================= القائمة =================

  async list(u: OrgUser, q: LeadListQuery) {
    const org = u.organizationId;
    const s = await this.core.settings(org);
    const rows: Record<string, unknown>[] = await this.db.query(
      `SELECT l.id, l.lead_no AS "leadNo", l.name, l.company, l.phone, l.email, l.city, l.interest, l.source, l.campaign, l.status, l.owner_id AS "ownerId",
              us.full_name AS "ownerName", l.due_at AS "dueAt", l.first_contact_at AS "firstContactAt", l.created_at AS "createdAt", l.party_id AS "partyId",
              (l.status IN ('new', 'contacted', 'qualified') AND l.first_contact_at IS NULL AND l.due_at < now()) AS overdue,
              (SELECT min(a.due_at) FROM crm_activities a WHERE a.organization_id = $1 AND a.lead_id = l.id AND a.done_at IS NULL) AS "nextActivity"
         FROM crm_leads l LEFT JOIN users us ON us.id = l.owner_id AND us.organization_id = $1
        WHERE l.organization_id = $1 AND ($2::boolean OR l.owner_id = $3)
          AND ($4::text IS NULL OR l.name ILIKE '%' || $4 || '%' OR l.company ILIKE '%' || $4 || '%' OR l.phone LIKE '%' || $4 || '%' OR l.email ILIKE '%' || $4 || '%' OR l.campaign ILIKE '%' || $4 || '%')
          AND ($5::text IS NULL OR ($5 = 'open' AND l.status IN ('new', 'contacted', 'qualified')) OR l.status = $5)
          AND ($6::text IS NULL OR l.source = $6)
          AND ($7::text IS NULL OR l.interest = $7)
          AND ($8::uuid IS NULL OR l.owner_id = $8)
          AND ($9::text IS NULL OR ($9 = 'mine' AND l.owner_id = $3) OR ($9 = 'unassigned' AND l.owner_id IS NULL)
               OR ($9 = 'overdue' AND l.status IN ('new', 'contacted', 'qualified') AND l.first_contact_at IS NULL AND l.due_at < now()))
        ORDER BY (l.status IN ('new', 'contacted', 'qualified')) DESC, l.created_at DESC LIMIT 500`,
      [org, this.seesAll(u), u.id, clean(q.q), q.status ?? null, q.source ?? null, q.interest ?? null, q.owner ?? null, q.scope ?? null]);
    return rows.map((r) => ({
      ...r, code: leadCode(Number(r.leadNo)), statusLabel: LEAD_STATUS[r.status as keyof typeof LEAD_STATUS],
      sourceLabel: this.core.label(s.sources, r.source as string), interestLabel: this.core.label(s.interests, r.interest as string),
    }));
  }

  async get(u: OrgUser, id: string) {
    const org = u.organizationId;
    const l = await this.visible(u, id);
    const s = await this.core.settings(org);
    const [owner, activities, party, dup] = await Promise.all([
      l.ownerId ? this.db.query('SELECT full_name AS "fullName" FROM users WHERE organization_id = $1 AND id = $2', [org, l.ownerId]).then((r) => r[0]?.fullName ?? null) : null,
      this.db.query(
        `SELECT a.id, a.type, a.subject, a.details, a.due_at AS "dueAt", a.done_at AS "doneAt", a.outcome, a.owner_id AS "ownerId", us.full_name AS "ownerName", a.created_by_name AS "createdByName", a.created_at AS "createdAt"
           FROM crm_activities a LEFT JOIN users us ON us.id = a.owner_id AND us.organization_id = $1
          WHERE a.organization_id = $1 AND a.lead_id = $2 ORDER BY COALESCE(a.done_at, a.due_at, a.created_at) DESC`, [org, id]),
      l.partyId ? this.db.query('SELECT id, party_no AS "partyNo", name FROM crm_parties WHERE organization_id = $1 AND id = $2', [org, l.partyId]).then((r) => (r[0] ? { ...r[0], code: partyCode(r[0].partyNo) } : null)) : null,
      OPEN_LEAD.includes(l.status) ? this.parties.duplicatesOf(u, { phone: l.phone ?? undefined, email: l.email ?? undefined, exclude: l.id }) : { parties: [], leads: [], hiddenParties: 0, hiddenLeads: 0 },
    ]);
    return {
      ...l, code: leadCode(l.leadNo), statusLabel: LEAD_STATUS[l.status], ownerName: owner, party,
      sourceLabel: this.core.label(s.sources, l.source), interestLabel: this.core.label(s.interests, l.interest), reasonLabel: this.core.label(s.disqualifyReasons, l.disqualifyReason),
      overdue: OPEN_LEAD.includes(l.status) && !l.firstContactAt && l.dueAt < new Date(),
      activities, similar: dup,
      can: { manage: this.canManage(u, l), assign: this.core.canAssign(u) },
    };
  }

  private canManage(u: OrgUser, l: CrmLead) {
    return this.core.has(u, 'crm.records.manage') && (this.core.canAll(u) || l.ownerId === u.id || (!l.ownerId && this.core.canAssign(u)));
  }
  private assertManage(u: OrgUser, l: CrmLead) {
    if (!this.canManage(u, l)) throw new ForbiddenException('هذا العميل المحتمل مسند لموظف آخر');
  }

  // ================= الإضافة =================

  /** المسؤول عند الإضافة: المختار، أو التالي بالتناوب، أو المُدخل نفسه إن لم يكن ممن يوزّعون */
  private async ownerOnCreate(u: OrgUser | null, em: EntityManager, org: string, ownerId: string | null | undefined) {
    if (ownerId) {
      if (u && ownerId !== u.id && !this.core.canAssign(u)) throw new ForbiddenException('إسناد العميل المحتمل لموظف آخر من صلاحية التوزيع');
      return this.core.user(org, ownerId, em);
    }
    const next = await this.core.nextAssignee(em, org);
    if (next) return next;
    if (u && !this.core.canAssign(u)) return { id: u.id, fullName: u.fullName };
    return null;
  }

  async create(u: OrgUser, dto: LeadDto) {
    const org = u.organizationId;
    const s = await this.core.settings(org);
    const phone = normPhone(dto.phone);
    const email = normEmail(dto.email);
    if (!phone && !email) throw new BadRequestException('اكتب الجوال أو البريد الإلكتروني للتواصل معه');
    return this.db.transaction(async (em) => {
      if (!dto.allowDuplicate) {
        const d = await this.parties.duplicatesOf(u, { phone: phone ?? undefined, email: email ?? undefined }, em);
        if (d.leads.length) throw new ConflictException(`يوجد عميل محتمل مفتوح بالبيانات نفسها: ${d.leads.map((l) => `${l.name} (${l.code})`).join('، ')}`);
        if (d.hiddenLeads) throw new ConflictException('يوجد عميل محتمل مفتوح بالبيانات نفسها لدى موظف آخر. راجع مدير المبيعات، أو أكّد أنه عميل محتمل جديد.');
        if (d.parties.length) throw new ConflictException(`هذا الشخص مسجل جهةً: ${d.parties.map((p) => `${p.name} (${p.code})`).join('، ')}. سجّل النشاط في ملفها، أو أكّد أنه عميل محتمل جديد.`);
        if (d.hiddenParties) throw new ConflictException('هذا الشخص مسجل جهةً خارج نطاق صلاحيتك. راجع مدير المبيعات، أو أكّد أنه عميل محتمل جديد.');
      }
      const owner = await this.ownerOnCreate(u, em, org, dto.ownerId);
      const now = new Date();
      const l = await em.save(em.create(CrmLead, {
        organizationId: org, leadNo: await this.core.nextNo(em, 'crm_leads', org), name: dto.name.trim(), company: clean(dto.company), title: clean(dto.title),
        phone, email, city: clean(dto.city), interest: this.core.key(s.interests, dto.interest, 'الاهتمام'), source: this.core.key(s.sources, dto.source, 'المصدر')!,
        campaign: clean(dto.campaign), message: clean(dto.message), status: 'new', ownerId: owner?.id ?? null, assignedAt: owner ? now : null,
        dueAt: new Date(now.getTime() + s.slaHours * HOUR), createdByName: u.fullName,
        log: [logEntry('إضافة العميل المحتمل', u, owner ? `أُسند إلى ${owner.fullName}` : null)],
      }));
      return { id: l.id, code: leadCode(l.leadNo) };
    });
  }

  async update(u: OrgUser, id: string, dto: LeadDto) {
    const s = await this.core.settings(u.organizationId);
    return this.db.transaction(async (em) => {
      const l = await this.visible(u, id, em);
      this.assertManage(u, l);
      this.assertOpen(l);
      const phone = normPhone(dto.phone);
      const email = normEmail(dto.email);
      if (!phone && !email) throw new BadRequestException('اكتب الجوال أو البريد الإلكتروني للتواصل معه');
      const fields = ['name', 'company', 'title', 'phone', 'email', 'city', 'interest', 'source', 'campaign', 'message'] as const;
      const before = Object.fromEntries(fields.map((k) => [k, l[k]]));
      Object.assign(l, {
        name: dto.name.trim(), company: clean(dto.company), title: clean(dto.title), phone, email, city: clean(dto.city),
        interest: this.core.key(s.interests, dto.interest, 'الاهتمام'), source: this.core.key(s.sources, dto.source, 'المصدر')!, campaign: clean(dto.campaign), message: clean(dto.message),
      });
      const changes = fields.filter((k) => before[k] !== l[k]).map((k) => ({ field: k as string, from: before[k], to: l[k] }));
      if (!changes.length) return { ok: true };
      l.log = [...l.log, logEntry('تعديل البيانات', u, null, changes)];
      await em.save(l);
      return { ok: true };
    });
  }

  // ================= التوزيع والحالة =================

  async assign(u: OrgUser, id: string, ownerId: string | null) {
    return this.db.transaction(async (em) => {
      const l = await this.visible(u, id, em);
      this.assertOpen(l);
      const owner = ownerId ? await this.core.user(u.organizationId, ownerId, em) : null;
      if ((owner?.id ?? null) === l.ownerId) return { ok: true };
      const prev = l.ownerId;
      l.ownerId = owner?.id ?? null;
      l.assignedAt = owner ? new Date() : null;
      l.log = [...l.log, logEntry(owner ? 'إسناد' : 'إلغاء الإسناد', u, owner?.fullName ?? null, [{ field: 'ownerId', from: prev, to: l.ownerId }])];
      await em.save(l);
      return { ok: true };
    });
  }

  async setStatus(u: OrgUser, id: string, dto: LeadStatusDto) {
    const s = await this.core.settings(u.organizationId);
    return this.db.transaction(async (em) => {
      const l = await this.visible(u, id, em);
      this.assertManage(u, l);
      if (l.status === 'converted') throw new BadRequestException('تحول هذا العميل المحتمل إلى جهة، وتُتابع من ملفها');
      if (l.status === dto.status) return { ok: true };
      if (l.status === 'disqualified' && dto.status !== 'new') throw new BadRequestException('أعد فتح العميل المحتمل أولًا');
      const note = clean(dto.note);
      if (dto.status === 'disqualified') {
        l.disqualifyReason = this.core.key(s.disqualifyReasons, dto.reason, 'سبب عدم التأهيل');
        l.disqualifyNote = note;
      } else {
        l.disqualifyReason = null;
        l.disqualifyNote = null;
      }
      if (dto.status === 'contacted' || dto.status === 'qualified') l.firstContactAt = l.firstContactAt ?? new Date();
      const from = l.status;
      l.status = dto.status;
      const label = from === 'disqualified' ? 'إعادة فتح' : `تغيير الحالة إلى «${LEAD_STATUS[dto.status]}»`;
      l.log = [...l.log, logEntry(label, u, dto.status === 'disqualified' ? [this.core.label(s.disqualifyReasons, l.disqualifyReason), note].filter(Boolean).join(': ') : note)];
      await em.save(l);
      return { ok: true };
    });
  }

  /** التحويل إلى جهة: جهة جديدة (منشأة بشخص اتصال، أو شخص)، أو ربطه بجهة موجودة. تنتقل أنشطته إلى ملف الجهة */
  async convert(u: OrgUser, id: string, dto: ConvertDto) {
    const org = u.organizationId;
    return this.db.transaction(async (em) => {
      const l = await this.visible(u, id, em);
      this.assertManage(u, l);
      this.assertOpen(l);
      let party: CrmParty;
      if (dto.partyId) {
        party = await this.parties.visible(u, dto.partyId, em);
        this.parties.assertManage(u, party);
      } else {
        if (!dto.allowDuplicate) {
          const d = await this.parties.duplicatesOf(u, { phone: l.phone ?? undefined, email: l.email ?? undefined }, em);
          if (d.hiddenParties && !d.parties.length) throw new ConflictException('توجد جهة مسجلة بالبيانات نفسها خارج نطاق صلاحيتك. راجع مدير المبيعات قبل إنشاء جهة جديدة.');
          if (d.parties.length) throw new ConflictException(`توجد جهة مسجلة بالبيانات نفسها: ${d.parties.map((p) => `${p.name} (${p.code})`).join('، ')}. اربطه بها بدل إنشاء جهة جديدة.`);
        }
        const isOrg = !!l.company;
        party = await em.save(em.create(CrmParty, {
          organizationId: org, partyNo: await this.core.nextNo(em, 'crm_parties', org), kind: isOrg ? 'org' : 'person', name: isOrg ? l.company! : l.name,
          phone: l.phone, email: l.email, city: l.city, vatNumber: null, crNumber: null, ownerId: l.ownerId ?? u.id, source: l.source, tags: [], consents: {},
          notes: null, createdByName: u.fullName, log: [logEntry('إنشاء الجهة من عميل محتمل', u, leadCode(l.leadNo))],
        }));
        if (isOrg) {
          await em.insert(CrmContact, { organizationId: org, partyId: party.id, name: l.name, title: l.title, phone: l.phone, email: l.email, decisionRole: 'other', isPrimary: true, notes: null });
        }
      }
      await em.query(
        `INSERT INTO crm_party_links (organization_id, party_id, role, ref_id, linked_by_name) VALUES ($1, $2, 'lead', $3, $4) ON CONFLICT DO NOTHING`, [org, party.id, l.id, u.fullName]);
      await em.query('UPDATE crm_activities SET party_id = $3 WHERE organization_id = $1 AND lead_id = $2 AND party_id IS NULL', [org, l.id, party.id]);
      if (dto.partyId) {
        party.log = [...party.log, logEntry('ربط عميل محتمل', u, `${l.name} (${leadCode(l.leadNo)})`)];
        await em.save(party);
      }
      l.status = 'converted';
      l.partyId = party.id;
      l.convertedAt = new Date();
      l.firstContactAt = l.firstContactAt ?? new Date();
      l.log = [...l.log, logEntry(dto.partyId ? 'ربط بجهة موجودة' : 'التحويل إلى جهة', u, `${party.name} (${partyCode(party.partyNo)})`)];
      await em.save(l);
      const next = clean(dto.nextSubject);
      if (next) {
        await em.insert(CrmActivity, {
          organizationId: org, type: 'task', subject: next, details: null, dueAt: dto.nextDueAt ? new Date(dto.nextDueAt) : null, doneAt: null, outcome: null,
          partyId: party.id, leadId: null, ownerId: party.ownerId ?? u.id, createdById: u.id, createdByName: u.fullName,
        });
      }
      return { partyId: party.id };
    });
  }

  // ================= الموقع الإلكتروني =================

  /**
   * طلب من نماذج الموقع: يدخل عميلًا محتملًا إن اختارت الشركة نوع النموذج في الإعدادات.
   * إن كان للمرسل عميل محتمل مفتوح يُضاف الطلب إليه نشاطًا بدل تكراره. آمنة للتكرار (لكل طلب عميل واحد).
   */
  async fromWebsite(org: string, m: WebsiteMessage) {
    const s = await this.core.settings(org);
    const interest = WEB_TOPIC_INTEREST[m.topic];
    if (!interest || !(s.webTopics ?? []).includes(m.topic)) return null;
    const phone = normPhone(m.phone);
    const email = normEmail(m.email);
    return this.db.transaction(async (em) => {
      await em.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`crm_web:${org}`]);
      const [done] = await em.query('SELECT id FROM crm_leads WHERE organization_id = $1 AND web_message_id = $2', [org, m.id]);
      if (done) return done.id as string;
      const [open] = await em.query(
        `SELECT id, owner_id FROM crm_leads WHERE organization_id = $1 AND status IN ('new', 'contacted', 'qualified')
           AND (($2::text IS NOT NULL AND phone = $2) OR ($3::text IS NOT NULL AND email = $3)) ORDER BY created_at DESC LIMIT 1`, [org, phone, email]);
      if (open) {
        const ownerId = open.owner_id ?? (await this.fallbackOwner(em, org));
        if (!ownerId) return open.id as string;
        // المرسل غير موثق: أي شخص يعرف الجوال أو البريد يستطيع الإرسال، فتُعلَّم الرسالة بذلك
        await em.insert(CrmActivity, {
          organizationId: org, type: 'note', subject: `${m.topicLabel ?? 'طلب'} جديد من الموقع (مرسله غير موثق، تحقق قبل الاعتماد عليه)`, details: m.body.slice(0, 4000) || null, dueAt: null, doneAt: new Date(), outcome: null,
          partyId: null, leadId: open.id, ownerId, createdById: null, createdByName: 'الموقع الإلكتروني',
        });
        return open.id as string;
      }
      const owner = await this.ownerOnCreate(null, em, org, null);
      const now = new Date();
      const l = await em.save(em.create(CrmLead, {
        organizationId: org, leadNo: await this.core.nextNo(em, 'crm_leads', org), name: m.name.trim(), company: m.company?.trim() || null, title: null, phone, email, city: null,
        interest: s.interests.some((i) => i.key === interest) ? interest : null, source: s.sources.some((i) => i.key === 'website') ? 'website' : s.sources[0]?.key ?? 'website',
        campaign: null, message: m.body.slice(0, 4000) || null, status: 'new', ownerId: owner?.id ?? null, assignedAt: owner ? now : null,
        dueAt: new Date(now.getTime() + s.slaHours * HOUR), webMessageId: m.id, createdByName: 'الموقع الإلكتروني',
        log: [logEntry(`وصل من الموقع: ${m.topicLabel ?? 'نموذج'}`, 'الموقع الإلكتروني', owner ? `أُسند إلى ${owner.fullName}` : null)],
      }));
      return l.id;
    });
  }

  /** نشاط بلا مسؤول (عميل محتمل غير مسند): يُسجل باسم مدير النظام حتى يظهر لمن يوزّع */
  private async fallbackOwner(em: EntityManager, org: string): Promise<string | null> {
    const [a] = await em.query('SELECT id FROM users WHERE organization_id = $1 AND is_active ORDER BY is_superadmin DESC, created_at LIMIT 1', [org]);
    return a?.id ?? null;
  }

  // ================= الاستيراد =================

  async import(u: OrgUser, dto: ImportDto) {
    const org = u.organizationId;
    const s = await this.core.settings(org);
    const source = this.core.key(s.sources, dto.source, 'المصدر')!;
    const interest = this.core.key(s.interests, dto.interest, 'الاهتمام');
    const existing: { phone: string | null; email: string | null }[] = await this.db.query(
      `SELECT phone, email FROM crm_leads WHERE organization_id = $1 AND status IN ('new', 'contacted', 'qualified')
       UNION ALL SELECT phone, email FROM crm_parties WHERE organization_id = $1 AND is_active`, [org]);
    const phones = new Set(existing.map((e) => e.phone).filter(Boolean));
    const emails = new Set(existing.map((e) => e.email).filter(Boolean));
    const issues: { row: number; name: string; reason: string }[] = [];
    const ok: { name: string; company: string | null; phone: string | null; email: string | null; city: string | null; notes: string | null }[] = [];
    dto.rows.forEach((r, i) => {
      const phone = normPhone(r.phone);
      const email = normEmail(r.email);
      const row = i + 2;
      if (phone && !PHONE_RE.test(phone)) return issues.push({ row, name: r.name, reason: 'رقم الجوال غير صحيح' });
      if (email && !EMAIL_RE.test(email)) return issues.push({ row, name: r.name, reason: 'البريد غير صحيح' });
      if (!phone && !email) return issues.push({ row, name: r.name, reason: 'لا يوجد جوال ولا بريد' });
      if ((phone && phones.has(phone)) || (email && emails.has(email))) return issues.push({ row, name: r.name, reason: 'مسجل من قبل (عميل محتمل مفتوح أو جهة) أو مكرر في الملف' });
      if (phone) phones.add(phone);
      if (email) emails.add(email);
      ok.push({ name: r.name.trim(), company: clean(r.company), phone, email, city: clean(r.city), notes: clean(r.notes) });
    });
    if (dto.dryRun) return { ready: ok.length, skipped: issues.length, issues: issues.slice(0, 200) };
    if (!ok.length) throw new BadRequestException('لا توجد صفوف صالحة للاستيراد');
    const created = await this.db.transaction(async (em) => {
      let no = await this.core.nextNo(em, 'crm_leads', org);
      const now = new Date();
      for (const r of ok) {
        const owner = await this.ownerOnCreate(u, em, org, null);
        await em.insert(CrmLead, {
          organizationId: org, leadNo: no++, name: r.name, company: r.company, title: null, phone: r.phone, email: r.email, city: r.city, interest, source,
          campaign: clean(dto.campaign), message: r.notes, status: 'new', ownerId: owner?.id ?? null, assignedAt: owner ? now : null,
          dueAt: new Date(now.getTime() + s.slaHours * HOUR), createdByName: u.fullName,
          log: [logEntry('استيراد من ملف', u, owner ? `أُسند إلى ${owner.fullName}` : null)] as never,
        });
      }
      return ok.length;
    });
    return { created, skipped: issues.length, issues: issues.slice(0, 200) };
  }
}

