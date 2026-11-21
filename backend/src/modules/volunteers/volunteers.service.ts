import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { OrgUser } from '../../core/auth/decorators';
import { formatDate } from '../../core/subscriptions/contract-render';
import {
  VolCertificate, VolContract, VolEvent, VolTicket, VolVolunteer, VolunteerStatus,
} from './entities/volunteers.entity';
import { DEFAULT_CERTIFICATES } from './volunteers-defaults';
import { CertificateDto, ContractDto, PublicVolunteerDto, TicketDto, TicketReplyDto, VolunteerDto, VolunteerStatusDto } from './volunteers.dto';
import { VolCore, shortCode, today, token } from './vol-core.service';
import { fillTemplate, validateAnswers } from './vol-forms';

export const STATUS_LABELS: Record<VolunteerStatus, string> = { pending: 'بانتظار القبول', active: 'نشط', inactive: 'موقوف', rejected: 'مرفوض' };
export const TICKET_KINDS = { complaint: 'شكوى', suggestion: 'مقترح', inquiry: 'استفسار' } as const;
export const TICKET_STATUS = { open: 'جديدة', in_progress: 'قيد المعالجة', closed: 'مغلقة' } as const;
const year = () => today().slice(0, 4);
const pad = (n: number) => String(n).padStart(4, '0');
const round2 = (n: number) => Math.round(n * 100) / 100;

/** المتطوعون والشهادات والعقود والشكاوى */
@Injectable()
export class VolunteersService {
  constructor(private readonly db: DataSource, private readonly core: VolCore) {}

  // ---------------- السجل ----------------

  async list(actor: OrgUser, q: { status?: string; search?: string; field?: string; type?: string }) {
    const org = actor.organizationId;
    const s = await this.core.settings(org);
    const params: unknown[] = [org];
    let where = 'v.organization_id = $1';
    if (q.status) { params.push(q.status); where += ` AND v.status = $${params.length}`; }
    if (q.type) { params.push(q.type); where += ` AND v.type_code = $${params.length}`; }
    if (q.field) { params.push(JSON.stringify([q.field])); where += ` AND v.field_codes @> $${params.length}::jsonb`; }
    if (q.search?.trim()) {
      params.push(`%${q.search.trim()}%`);
      where += ` AND (v.full_name ILIKE $${params.length} OR v.national_id LIKE $${params.length} OR v.mobile LIKE $${params.length})`;
    }
    const rows: Record<string, unknown>[] = await this.db.query(
      `SELECT v.id, v.volunteer_no, v.full_name, v.national_id, v.mobile, v.gender, v.city, v.type_code, v.field_codes, v.status, v.source, v.joined_on::text AS joined_on, v.created_at,
         COALESCE(h.hours, 0)::float AS hours, COALESCE(h.events, 0)::int AS events,
         (SELECT c.status FROM vol_contracts c WHERE c.volunteer_id = v.id AND c.status <> 'cancelled' ORDER BY c.created_at DESC LIMIT 1) AS contract_status
       FROM vol_volunteers v
       LEFT JOIN (SELECT volunteer_id, SUM(hours) AS hours, COUNT(*) AS events FROM vol_participations WHERE organization_id = $1 AND status = 'attended' GROUP BY volunteer_id) h
         ON h.volunteer_id = v.id
       WHERE ${where} ORDER BY v.volunteer_no DESC LIMIT 1000`, params);
    return rows.map((r) => ({
      id: r.id, volunteerNo: r.volunteer_no, fullName: r.full_name, nationalId: r.national_id, mobile: r.mobile, gender: r.gender, city: r.city,
      typeCode: r.type_code, typeName: this.core.label(s.volunteerTypes, r.type_code as string),
      fields: (r.field_codes as string[]).map((c) => this.core.label(s.volunteerFields, c)),
      status: r.status, statusLabel: STATUS_LABELS[r.status as VolunteerStatus], source: r.source, joinedOn: r.joined_on, createdAt: r.created_at,
      hours: round2(r.hours as number), events: r.events, contractStatus: r.contract_status,
    }));
  }

  async volunteer(org: string, id: string) {
    const v = await this.db.getRepository(VolVolunteer).findOne({ where: { id, organizationId: org } });
    if (!v) throw new NotFoundException('المتطوع غير موجود');
    return v;
  }

  async profile(actor: OrgUser, id: string) {
    const org = actor.organizationId;
    const v = await this.volunteer(org, id);
    const s = await this.core.settings(org);
    const events = await this.db.query(
      `SELECT p.id, p.status, p.hours::float AS hours, p.role, p.rating, p.note, e.id AS event_id, e.event_no, e.title, e.kind, e.start_date::text AS start_date, e.end_date::text AS end_date, e.status AS event_status
       FROM vol_participations p JOIN vol_events e ON e.id = p.event_id WHERE p.organization_id = $1 AND p.volunteer_id = $2 ORDER BY e.start_date DESC`, [org, id]);
    const certificates = await this.db.getRepository(VolCertificate).find({ where: { organizationId: org, volunteerId: id }, order: { createdAt: 'DESC' } });
    const contracts = await this.db.getRepository(VolContract).find({ where: { organizationId: org, volunteerId: id }, order: { createdAt: 'DESC' } });
    const attended = events.filter((e: { status: string }) => e.status === 'attended');
    return {
      ...v,
      statusLabel: STATUS_LABELS[v.status],
      typeName: this.core.label(s.volunteerTypes, v.typeCode),
      fields: v.fieldCodes.map((c) => this.core.label(s.volunteerFields, c)),
      registrationFields: s.registrationFields,
      totals: { hours: round2(attended.reduce((a: number, e: { hours: number }) => a + e.hours, 0)), events: attended.length },
      events: events.map((e: Record<string, unknown>) => ({
        id: e.id, status: e.status, hours: e.hours, role: e.role, rating: e.rating, note: e.note, eventId: e.event_id, eventNo: e.event_no, title: e.title,
        kind: e.kind, startDate: e.start_date, endDate: e.end_date, eventStatus: e.event_status,
      })),
      certificates: certificates.map((c) => ({ id: c.id, certificateNo: c.certificateNo, kind: c.kind, title: c.title, hours: c.hours, issuedOn: c.issuedOn, isRevoked: c.isRevoked })),
      contracts: contracts.map((c) => this.contractRow(c, v)),
    };
  }

  private async checkVolunteer(org: string, dto: VolunteerDto) {
    const s = await this.core.settings(org);
    this.core.checkCode(s.volunteerTypes, dto.typeCode, 'نوع التطوع');
    const fieldCodes = [...new Set(dto.fieldCodes ?? [])];
    fieldCodes.forEach((c) => this.core.checkCode(s.volunteerFields, c, 'مجال التطوع'));
    const answers = validateAnswers(s.registrationFields, dto.answers);
    const mobile = dto.mobile.replace(/^\+?966/, '0');
    return {
      fullName: dto.fullName, nationalId: dto.nationalId, mobile, email: dto.email?.toLowerCase() ?? null, gender: dto.gender, birthDate: dto.birthDate ?? null,
      city: dto.city ?? null, qualification: dto.qualification ?? null, typeCode: dto.typeCode ?? null, fieldCodes, skills: dto.skills ?? null,
      availability: [...new Set((dto.availability ?? []).map((x) => x.trim()).filter(Boolean))], answers,
    };
  }

  async create(actor: OrgUser | null, org: string, dto: VolunteerDto, source: 'staff' | 'public' = 'staff') {
    const data = await this.checkVolunteer(org, dto);
    return this.db.transaction(async (em) => {
      const exists = await em.getRepository(VolVolunteer).findOne({ where: { organizationId: org, nationalId: data.nationalId } });
      if (exists) throw new ConflictException(source === 'public' ? 'رقم الهوية مسجل مسبقًا لدى الشركة، تواصل معنا لتحديث بياناتك' : `رقم الهوية مسجل للمتطوع رقم ${exists.volunteerNo}`);
      const no = await this.core.nextNo(em, org, 'nextVolunteerNo');
      const staff = source === 'staff';
      return em.getRepository(VolVolunteer).save(em.getRepository(VolVolunteer).create({
        ...data, organizationId: org, volunteerNo: no, source, status: staff ? 'active' : 'pending', joinedOn: staff ? today() : null,
        createdByName: actor?.fullName ?? null,
      }));
    });
  }

  async register(org: string, dto: PublicVolunteerDto) {
    const s = await this.core.settings(org);
    if (!s.publicRegistration) throw new BadRequestException('التسجيل الإلكتروني للمتطوعين متوقف حاليًا في الشركة');
    const v = await this.create(null, org, dto, 'public');
    return { volunteerNo: v.volunteerNo, fullName: v.fullName };
  }

  async update(actor: OrgUser, id: string, dto: VolunteerDto) {
    const org = actor.organizationId;
    const v = await this.volunteer(org, id);
    const data = await this.checkVolunteer(org, dto);
    if (data.nationalId !== v.nationalId) {
      const other = await this.db.getRepository(VolVolunteer).findOne({ where: { organizationId: org, nationalId: data.nationalId } });
      if (other) throw new ConflictException(`رقم الهوية مسجل للمتطوع رقم ${other.volunteerNo}`);
    }
    Object.assign(v, data);
    await this.db.getRepository(VolVolunteer).save(v);
    return this.profile(actor, id);
  }

  async setStatus(actor: OrgUser, id: string, dto: VolunteerStatusDto) {
    const v = await this.volunteer(actor.organizationId, id);
    if (dto.status === 'rejected' && v.status !== 'pending') throw new BadRequestException('الرفض لطلبات التسجيل الجديدة فقط، وللمتطوع المسجل استخدم الإيقاف');
    if ((dto.status === 'rejected' || dto.status === 'inactive') && !dto.note) throw new BadRequestException('اكتب السبب');
    v.status = dto.status;
    v.statusNote = dto.note ?? null;
    if (dto.status === 'active' && !v.joinedOn) v.joinedOn = today();
    await this.db.getRepository(VolVolunteer).save(v);
    return this.profile(actor, id);
  }

  async remove(actor: OrgUser, id: string) {
    const v = await this.volunteer(actor.organizationId, id);
    const [{ n }] = await this.db.query(
      `SELECT (SELECT COUNT(*) FROM vol_participations WHERE volunteer_id = $1) + (SELECT COUNT(*) FROM vol_certificates WHERE volunteer_id = $1)
        + (SELECT COUNT(*) FROM vol_contracts WHERE volunteer_id = $1) AS n`, [id]);
    if (Number(n) > 0) throw new BadRequestException('للمتطوع مشاركات أو شهادات أو عقود، فلا يُحذف. أوقفه بدلًا من الحذف');
    await this.db.getRepository(VolVolunteer).delete({ id: v.id });
  }

  // ---------------- الشهادات ----------------

  async certificates(actor: OrgUser) {
    const rows: Record<string, unknown>[] = await this.db.query(
      `SELECT c.id, c.certificate_no, c.kind, c.title, c.hours::float AS hours, c.issued_on::text AS issued_on, c.issued_by_name, c.is_revoked, c.verify_code,
         v.id AS volunteer_id, v.full_name, v.volunteer_no, e.title AS event_title
       FROM vol_certificates c JOIN vol_volunteers v ON v.id = c.volunteer_id LEFT JOIN vol_events e ON e.id = c.event_id
       WHERE c.organization_id = $1 ORDER BY c.created_at DESC LIMIT 1000`, [actor.organizationId]);
    return rows.map((r) => ({
      id: r.id, certificateNo: r.certificate_no, kind: r.kind, title: r.title, hours: r.hours, issuedOn: r.issued_on, issuedByName: r.issued_by_name,
      isRevoked: r.is_revoked, verifyCode: r.verify_code, volunteerId: r.volunteer_id, volunteerName: r.full_name, volunteerNo: r.volunteer_no, eventTitle: r.event_title,
    }));
  }

  /** ساعات المتطوع المعتمدة (حضور فعلي) لفعالية أو خلال فترة */
  private async hoursOf(org: string, volunteerId: string, dto: CertificateDto) {
    const params: unknown[] = [org, volunteerId];
    let where = `p.organization_id = $1 AND p.volunteer_id = $2 AND p.status = 'attended'`;
    if (dto.eventId) { params.push(dto.eventId); where += ` AND p.event_id = $${params.length}`; }
    if (dto.periodFrom) { params.push(dto.periodFrom); where += ` AND e.end_date >= $${params.length}`; }
    if (dto.periodTo) { params.push(dto.periodTo); where += ` AND e.start_date <= $${params.length}`; }
    const rows: { title: string; hours: number; start_date: string; end_date: string }[] = await this.db.query(
      `SELECT e.title, p.hours::float AS hours, e.start_date::text AS start_date, e.end_date::text AS end_date FROM vol_participations p JOIN vol_events e ON e.id = p.event_id
       WHERE ${where} ORDER BY e.start_date`, params);
    return rows;
  }

  async issueCertificate(actor: OrgUser, dto: CertificateDto) {
    const org = actor.organizationId;
    const v = await this.volunteer(org, dto.volunteerId);
    if (v.status !== 'active' && v.status !== 'inactive') throw new BadRequestException('الشهادات للمتطوعين المقبولين فقط');
    if (dto.periodFrom && dto.periodTo && dto.periodFrom > dto.periodTo) throw new BadRequestException('بداية الفترة بعد نهايتها');
    let event: VolEvent | null = null;
    if (dto.eventId) {
      event = await this.db.getRepository(VolEvent).findOne({ where: { id: dto.eventId, organizationId: org } });
      if (!event) throw new NotFoundException('الفعالية غير موجودة');
    }
    const rows = await this.hoursOf(org, v.id, dto);
    const hours = round2(rows.reduce((a, r) => a + r.hours, 0));
    if (dto.kind === 'hours' && hours <= 0) throw new BadRequestException('لا توجد ساعات تطوع معتمدة لهذا المتطوع في الفعالية أو الفترة المختارة');
    if (dto.kind === 'thanks' && !rows.length) throw new BadRequestException('شهادة الشكر لمتطوع شارك فعليًا (حضر) في فعالية واحدة على الأقل');
    const s = await this.core.settings(org);
    const t = { ...DEFAULT_CERTIFICATES, ...s.certificateTemplates };
    const from = dto.periodFrom ?? rows[0]?.start_date ?? today();
    const to = dto.periodTo ?? rows[rows.length - 1]?.end_date ?? today();
    const titles = [...new Set(rows.map((r) => r.title))];
    const vars = {
      'اسم الشركة': actor.organizationName ?? 'الشركة', 'اسم المتطوع': v.fullName, 'رقم الهوية': v.nationalId, 'عدد الساعات': String(hours),
      'من تاريخ': formatDate(from), 'إلى تاريخ': formatDate(to), 'تاريخ الإصدار': formatDate(today()),
      'الفعاليات': event ? `فعالية «${event.title}»` : titles.length === 1 ? `فعالية «${titles[0]}»` : `${titles.length} فعاليات تطوعية`,
      'اسم الفعالية': event?.title ?? titles.join('، '),
    };
    const id = await this.db.transaction(async (em) => {
      const n = await this.core.nextNo(em, org, 'nextCertificateNo');
      const c = await em.getRepository(VolCertificate).save(em.getRepository(VolCertificate).create({
        organizationId: org, certificateNo: `VC-${year()}-${pad(n)}`, volunteerId: v.id, kind: dto.kind, eventId: event?.id ?? null, hours,
        periodFrom: from, periodTo: to, title: dto.kind === 'hours' ? t.hoursTitle : t.thanksTitle,
        body: fillTemplate(dto.kind === 'hours' ? t.hoursBody : t.thanksBody, vars), signatoryName: t.signatoryName || null, signatoryTitle: t.signatoryTitle || null,
        verifyCode: shortCode(), issuedOn: today(), issuedByName: actor.fullName,
      }));
      return c.id;
    });
    return this.certificate(org, id, actor.organizationName);
  }

  async certificate(org: string, id: string, orgName: string | null) {
    const c = await this.db.getRepository(VolCertificate).findOne({ where: { id, organizationId: org } });
    if (!c) throw new NotFoundException('الشهادة غير موجودة');
    const v = await this.volunteer(org, c.volunteerId);
    return { ...c, volunteerName: v.fullName, volunteerNo: v.volunteerNo, organizationName: orgName };
  }

  async revokeCertificate(actor: OrgUser, id: string) {
    const c = await this.certificate(actor.organizationId, id, null);
    await this.db.getRepository(VolCertificate).update({ id: c.id }, { isRevoked: true });
    return { ok: true };
  }

  /** التحقق العام من الشهادة برمزها */
  async verifyCertificate(code: string) {
    const [row] = await this.db.query(
      `SELECT c.certificate_no, c.kind, c.title, c.hours::float AS hours, c.issued_on::text AS issued_on, c.is_revoked, v.full_name, o.name AS org_name
       FROM vol_certificates c JOIN vol_volunteers v ON v.id = c.volunteer_id JOIN organizations o ON o.id = c.organization_id
       WHERE c.verify_code = $1`, [code.trim().toUpperCase()]);
    if (!row) throw new NotFoundException('لا توجد شهادة بهذا الرمز');
    return {
      certificateNo: row.certificate_no, kind: row.kind, title: row.title, hours: row.hours, issuedOn: row.issued_on, isRevoked: row.is_revoked,
      volunteerName: row.full_name, organizationName: row.org_name,
    };
  }

  // ---------------- العقود ----------------

  private contractRow(c: VolContract, v?: VolVolunteer) {
    return {
      id: c.id, contractNo: c.contractNo, volunteerId: c.volunteerId, volunteerName: v?.fullName, startDate: c.startDate, endDate: c.endDate, status: c.status,
      signedName: c.signedName, signedAt: c.signedAt, signedVia: c.signedVia, issuedByName: c.issuedByName, createdAt: c.createdAt, signToken: c.signToken,
      expired: c.endDate < today(),
    };
  }

  async contracts(actor: OrgUser) {
    const rows = await this.db.getRepository(VolContract).find({ where: { organizationId: actor.organizationId }, order: { createdAt: 'DESC' }, take: 1000 });
    const vols = await this.db.getRepository(VolVolunteer).find({ where: { organizationId: actor.organizationId } });
    const map = new Map(vols.map((v) => [v.id, v]));
    return rows.map((c) => this.contractRow(c, map.get(c.volunteerId)));
  }

  async issueContract(actor: OrgUser, dto: ContractDto) {
    const org = actor.organizationId;
    const v = await this.volunteer(org, dto.volunteerId);
    if (v.status !== 'active') throw new BadRequestException('يُصدر العقد للمتطوع النشط فقط. اقبل طلب التسجيل أولًا');
    if (dto.startDate > dto.endDate) throw new BadRequestException('تاريخ بداية العقد بعد نهايته');
    const open = await this.db.query(`SELECT 1 FROM vol_contracts WHERE volunteer_id = $1 AND status <> 'cancelled' AND end_date >= $2 AND start_date <= $3`, [v.id, dto.startDate, dto.endDate]);
    if (open.length) throw new ConflictException('للمتطوع عقد ساري يتداخل مع هذه الفترة. ألغِ العقد السابق أولًا');
    const s = await this.core.settings(org);
    return this.db.transaction(async (em) => {
      const n = await this.core.nextNo(em, org, 'nextContractNo');
      const no = `VA-${year()}-${pad(n)}`;
      const vars = {
        'اسم الشركة': actor.organizationName ?? 'الشركة', 'اسم المتطوع': v.fullName, 'رقم الهوية': v.nationalId, 'رقم الجوال': v.mobile, 'رقم العقد': no,
        'تاريخ العقد': formatDate(today()), 'تاريخ البداية': formatDate(dto.startDate), 'تاريخ النهاية': formatDate(dto.endDate),
        'مجالات التطوع': v.fieldCodes.map((c) => this.core.label(s.volunteerFields, c)).join('، ') || 'المجالات التي تحددها الشركة',
        'نوع التطوع': this.core.label(s.volunteerTypes, v.typeCode) ?? 'متطوع',
      };
      const clauses = s.contractClauses.filter((c) => c.isActive).map((c) => ({ title: c.title, body: fillTemplate(c.body, vars) }));
      const c = await em.getRepository(VolContract).save(em.getRepository(VolContract).create({
        organizationId: org, contractNo: no, volunteerId: v.id, startDate: dto.startDate, endDate: dto.endDate, clauses, signToken: token(), issuedByName: actor.fullName,
      }));
      return this.contractRow(c, v);
    });
  }

  async contract(org: string, id: string) {
    const c = await this.db.getRepository(VolContract).findOne({ where: { id, organizationId: org } });
    if (!c) throw new NotFoundException('العقد غير موجود');
    const v = await this.volunteer(org, c.volunteerId);
    return { ...this.contractRow(c, v), clauses: c.clauses, nationalId: v.nationalId, mobile: v.mobile };
  }

  /** تسجيل توقيع العقد الورقي، أو إلغاء العقد */
  async contractAction(actor: OrgUser, id: string, action: 'paper' | 'cancel') {
    const org = actor.organizationId;
    const c = await this.db.getRepository(VolContract).findOne({ where: { id, organizationId: org } });
    if (!c) throw new NotFoundException('العقد غير موجود');
    if (c.status === 'cancelled') throw new BadRequestException('العقد ملغى');
    if (action === 'paper') {
      if (c.status === 'signed') throw new BadRequestException('العقد موقّع مسبقًا');
      const v = await this.volunteer(org, c.volunteerId);
      Object.assign(c, { status: 'signed', signedName: v.fullName, signedAt: new Date(), signedVia: 'paper' });
    } else {
      c.status = 'cancelled';
    }
    await this.db.getRepository(VolContract).save(c);
    return this.contract(org, id);
  }

  /** صفحة توقيع العقد العامة للمتطوع */
  async publicContract(signToken: string) {
    const c = await this.db.getRepository(VolContract).findOne({ where: { signToken } });
    if (!c || c.status === 'cancelled') throw new NotFoundException('رابط العقد غير صحيح أو أُلغي العقد');
    const v = await this.volunteer(c.organizationId, c.volunteerId);
    const [org] = await this.db.query('SELECT name FROM organizations WHERE id = $1', [c.organizationId]);
    return {
      contractNo: c.contractNo, organizationName: org?.name, volunteerName: v.fullName, startDate: c.startDate, endDate: c.endDate, clauses: c.clauses,
      status: c.status, signedName: c.signedName, signedAt: c.signedAt,
    };
  }

  async signContract(signToken: string, signedName: string) {
    const c = await this.db.getRepository(VolContract).findOne({ where: { signToken } });
    if (!c || c.status === 'cancelled') throw new NotFoundException('رابط العقد غير صحيح أو أُلغي العقد');
    if (c.status === 'signed') throw new BadRequestException('العقد موقّع مسبقًا');
    const v = await this.volunteer(c.organizationId, c.volunteerId);
    const norm = (x: string) => x.replace(/\s+/g, ' ').trim();
    if (norm(signedName) !== norm(v.fullName)) throw new BadRequestException('اكتب اسمك الكامل كما هو مسجل في العقد');
    Object.assign(c, { status: 'signed', signedName: norm(signedName), signedAt: new Date(), signedVia: 'electronic' });
    await this.db.getRepository(VolContract).save(c);
    return this.publicContract(signToken);
  }

  // ---------------- الشكاوى والمقترحات والاستفسارات ----------------

  async tickets(actor: OrgUser, q: { status?: string; kind?: string }) {
    const params: unknown[] = [actor.organizationId];
    let where = 't.organization_id = $1';
    if (q.status) { params.push(q.status); where += ` AND t.status = $${params.length}`; }
    if (q.kind) { params.push(q.kind); where += ` AND t.kind = $${params.length}`; }
    const rows: Record<string, unknown>[] = await this.db.query(
      `SELECT t.*, e.title AS event_title, v.full_name AS volunteer_name FROM vol_tickets t
       LEFT JOIN vol_events e ON e.id = t.event_id LEFT JOIN vol_volunteers v ON v.id = t.volunteer_id
       WHERE ${where} ORDER BY (t.status = 'closed'), t.created_at DESC LIMIT 1000`, params);
    return rows.map((t) => ({
      id: t.id, ticketNo: t.ticket_no, kind: t.kind, kindLabel: TICKET_KINDS[t.kind as keyof typeof TICKET_KINDS], senderName: t.sender_name, senderMobile: t.sender_mobile,
      senderEmail: t.sender_email, senderType: t.sender_type, volunteerId: t.volunteer_id, volunteerName: t.volunteer_name, eventId: t.event_id, eventTitle: t.event_title,
      subject: t.subject, body: t.body, status: t.status, statusLabel: TICKET_STATUS[t.status as keyof typeof TICKET_STATUS], reply: t.reply, repliedByName: t.replied_by_name,
      repliedAt: t.replied_at, source: t.source, trackCode: t.track_code, createdAt: t.created_at,
    }));
  }

  async createTicket(org: string, dto: TicketDto, source: 'staff' | 'public') {
    if (dto.volunteerId) await this.volunteer(org, dto.volunteerId);
    if (dto.eventId && !(await this.db.getRepository(VolEvent).exists({ where: { id: dto.eventId, organizationId: org } }))) throw new NotFoundException('الفعالية غير موجودة');
    if (source === 'public' && !dto.senderMobile && !dto.senderEmail) throw new BadRequestException('اكتب رقم الجوال أو البريد الإلكتروني للتواصل معك');
    return this.db.transaction(async (em) => {
      const n = await this.core.nextNo(em, org, 'nextTicketNo');
      const t = await em.getRepository(VolTicket).save(em.getRepository(VolTicket).create({
        organizationId: org, ticketNo: `VT-${year()}-${pad(n)}`, kind: dto.kind, senderName: dto.senderName, senderMobile: dto.senderMobile?.replace(/^\+?966/, '0') ?? null,
        senderEmail: dto.senderEmail?.toLowerCase() ?? null, senderType: dto.senderType ?? 'volunteer', volunteerId: dto.volunteerId ?? null, eventId: dto.eventId ?? null,
        subject: dto.subject, body: dto.body, source, trackCode: shortCode(),
      }));
      return { id: t.id, ticketNo: t.ticketNo, trackCode: t.trackCode };
    });
  }

  async replyTicket(actor: OrgUser, id: string, dto: TicketReplyDto) {
    const t = await this.db.getRepository(VolTicket).findOne({ where: { id, organizationId: actor.organizationId } });
    if (!t) throw new NotFoundException('الطلب غير موجود');
    Object.assign(t, { reply: dto.reply, status: dto.status, repliedByName: actor.fullName, repliedAt: new Date() });
    await this.db.getRepository(VolTicket).save(t);
    return { ok: true };
  }

  /** متابعة الطلب من الصفحة العامة برقمه ورمز المتابعة */
  async trackTicket(org: string, ticketNo: string, code: string) {
    const t = await this.db.getRepository(VolTicket).findOne({ where: { organizationId: org, ticketNo: ticketNo.trim().toUpperCase() } });
    if (!t || t.trackCode !== code.trim().toUpperCase()) throw new NotFoundException('لا يوجد طلب بهذا الرقم ورمز المتابعة');
    return {
      ticketNo: t.ticketNo, kind: t.kind, kindLabel: TICKET_KINDS[t.kind], subject: t.subject, status: t.status, statusLabel: TICKET_STATUS[t.status],
      reply: t.reply, repliedAt: t.repliedAt, createdAt: t.createdAt,
    };
  }
}
