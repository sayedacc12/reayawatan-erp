import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { OrgUser } from '../../core/auth/decorators';
import { FileStore } from '../../core/files/file-store.service';
import {
  HistoryEntry, MemApplication, MemInvoice, MemMember, MemNotice, MembershipType, MemSettings, StoredDoc,
} from './entities/members.entity';
import { ChangeTypeDto, DirectMemberDto, MemberStatusDto, PersonDto } from './members.dto';
import { EffectiveStatus, MEMBER_STATUS_AR, MemCore, shortCode, today } from './mem-core.service';
import { ageOn, daysBetween, periodEnd, validateAnswers } from './mem-forms';

export const INVOICE_STATUS_AR: Record<string, string> = { unpaid: 'بانتظار السداد', review: 'تحويل بانتظار التأكيد', paid: 'مسددة', cancelled: 'ملغاة' };
export const METHOD_AR: Record<string, string> = { online: 'دفع إلكتروني', transfer: 'تحويل بنكي', cash: 'نقدًا' };
const SAUDI = 'سعودي';

export const historyOf = (action: string, byName: string, note: string | null = null): HistoryEntry => ({ action, note, byName, at: new Date().toISOString() });

/** الحقول الشخصية النظيفة من النموذج */
export function personFields(dto: PersonDto) {
  return {
    fullName: dto.fullName, nationalId: dto.nationalId, idExpiry: dto.idExpiry || null, nationality: dto.nationality, gender: dto.gender,
    birthDate: dto.birthDate || null, mobile: dto.mobile, email: dto.email || null, city: dto.city || null, address: dto.address || null,
    occupation: dto.occupation || null, employer: dto.employer || null, qualification: dto.qualification || null,
  };
}

/**
 * سجل الأعضاء: التفعيل من الطلب المعتمد، إضافة الأعضاء القائمين، البيانات والمستندات، الحالة،
 * بطاقة العضوية والتحقق منها، وكشف حساب العضو.
 */
@Injectable()
export class MembersService {
  constructor(private readonly db: DataSource, private readonly core: MemCore, private readonly files: FileStore) {}

  // ---------------- التحقق المشترك ----------------

  /** شروط نوع العضوية (العمر والجنسية) والحقول الإضافية */
  checkEligibility(s: MemSettings, dto: PersonDto, opts: { publicOnly?: boolean; allowInactive?: string | null } = {}) {
    const t = this.core.type(s, dto.typeCode);
    if (!t || (!t.isActive && t.code !== opts.allowInactive)) throw new BadRequestException('نوع العضوية غير متاح، اختر من الأنواع المعرّفة في الإعدادات');
    if (opts.publicOnly && !t.publicApply) throw new BadRequestException(`نوع «${t.name}» لا يُطلب من الصفحة العامة`);
    this.checkTypeRules(t, dto.birthDate ?? null, dto.nationality);
    return { type: t, answers: validateAnswers(s.applicationFields, dto.answers) };
  }

  /** شروط النوع: أقل عمر والجنسية */
  checkTypeRules(t: MembershipType, birthDate: string | null, nationality: string) {
    if (birthDate && birthDate > today()) throw new BadRequestException('تاريخ الميلاد في المستقبل');
    if (t.minAge !== null) {
      if (!birthDate) throw new BadRequestException(`تاريخ الميلاد مطلوب لعضوية «${t.name}»`);
      if (ageOn(birthDate, today()) < t.minAge) throw new BadRequestException(`يشترط لعضوية «${t.name}» ألا يقل العمر عن ${t.minAge} سنة`);
    }
    if (t.saudiOnly && nationality !== SAUDI) throw new BadRequestException(`عضوية «${t.name}» للسعوديين فقط`);
  }

  /** حفظ ملفات المستندات المرفوعة حسب المستندات المطلوبة في الإعدادات */
  async saveDocuments(org: string, s: MemSettings, files: Express.Multer.File[], existing: StoredDoc[] = [], enforceRequired = true) {
    const reqs = s.documents.filter((d) => d.isActive);
    const saved: StoredDoc[] = [];
    try {
      for (const f of files) {
        const r = reqs.find((d) => d.key === f.fieldname);
        if (!r) throw new BadRequestException('ملف مرفوع لمستند غير معرّف');
        const x = await this.files.save(`${org}/members`, f, r.name);
        saved.push({ key: r.key, name: r.name, fileKey: x.key, mime: x.mime, fileName: x.name, uploadedAt: new Date().toISOString() });
      }
      if (enforceRequired) {
        for (const r of reqs.filter((d) => d.required)) {
          if (!saved.some((d) => d.key === r.key) && !existing.some((d) => d.key === r.key)) throw new BadRequestException(`أرفق ${r.name}`);
        }
      }
    } catch (e) {
      await this.removeFiles(saved);
      throw e;
    }
    const replaced = existing.filter((d) => saved.some((x) => x.key === d.key));
    const merged = [...existing.filter((d) => !saved.some((x) => x.key === d.key)), ...saved];
    return { docs: merged, saved, replaced };
  }

  async removeFiles(docs: StoredDoc[]) {
    await Promise.all(docs.map((d) => this.files.remove(d.fileKey).catch(() => undefined)));
  }

  /** يمنع التكرار: طلب مفتوح أو عضوية قائمة بنفس الهوية */
  async assertNoDuplicate(em: EntityManager, org: string, s: MemSettings, nationalId: string, exceptApplicationId?: string) {
    const open = await em.getRepository(MemApplication).createQueryBuilder('a')
      .where('a.organization_id = :org AND a.national_id = :nid', { org, nid: nationalId })
      .andWhere(`a.status IN ('in_review', 'returned', 'awaiting_payment')`)
      .andWhere(exceptApplicationId ? 'a.id <> :id' : '1=1', { id: exceptApplicationId }).getOne();
    if (open) throw new ConflictException(`يوجد طلب عضوية مفتوح بنفس رقم الهوية برقم ${open.applicationNo}`);
    const m = await em.getRepository(MemMember).findOne({ where: { organizationId: org, nationalId } });
    if (m) {
      const st = this.core.effectiveStatus(m, s);
      if (st !== 'expired' && st !== 'terminated') {
        throw new ConflictException(`صاحب هذه الهوية عضو مسجل برقم ${m.memberNo}. للتجديد استخدم «عضويتي» أو تواصل مع الجمعية`);
      }
    }
  }

  // ---------------- التفعيل ----------------

  /**
   * تفعيل العضوية من طلب معتمد (بعد السداد أو مباشرة إن كان الاشتراك مجانيًا).
   * إن كان صاحب الهوية عضوًا سابقًا انتهت عضويته يُعاد تفعيل سجله برقمه نفسه، ويُحتسب انضمامه من جديد.
   */
  async activateFromApplication(em: EntityManager, app: MemApplication, s: MemSettings, byName: string, start: string) {
    const t = this.core.type(s, app.typeCode)!;
    const end = periodEnd(start, t.durationMonths);
    const data = {
      typeCode: app.typeCode, fullName: app.fullName, nationalId: app.nationalId, idExpiry: app.idExpiry, nationality: app.nationality, gender: app.gender,
      birthDate: app.birthDate, mobile: app.mobile, email: app.email, city: app.city, address: app.address, occupation: app.occupation,
      employer: app.employer, qualification: app.qualification, answers: app.answers, documents: app.documents,
      status: 'active' as const, joinedOn: start, startDate: start, endDate: end, applicationId: app.id, statusNote: null,
    };
    const repo = em.getRepository(MemMember);
    const old = await repo.findOne({ where: { organizationId: app.organizationId, nationalId: app.nationalId } });
    let member: MemMember;
    if (old) {
      const note = `إعادة العضوية بطلب ${app.applicationNo} (${t.name}) من ${start} إلى ${end}`;
      await repo.update({ id: old.id }, { ...data, history: [...old.history, historyOf('rejoin', byName, note)] });
      member = await repo.findOneOrFail({ where: { id: old.id } });
    } else {
      const memberNo = await this.core.nextNo(em, app.organizationId, 'nextMemberNo');
      member = await repo.save(repo.create({
        organizationId: app.organizationId, memberNo, ...data, cardCode: shortCode(), source: 'application', createdByName: byName,
        history: [historyOf('join', byName, `انضم بطلب ${app.applicationNo} (${t.name}) من ${start} إلى ${end}`)],
      }));
    }
    await em.getRepository(MemApplication).update({ id: app.id }, { status: 'completed', memberId: member.id });
    return member;
  }

  /** تمديد العضوية بعد سداد التجديد: من نهاية المدة السابقة إن كان داخل مهلة السماح، وإلا من تاريخ السداد */
  async extend(em: EntityManager, member: MemMember, s: MemSettings, byName: string, paidOn: string, ref: string) {
    const t = this.core.type(s, member.typeCode)!;
    const continuous = daysBetween(member.endDate, paidOn) <= s.renewal.graceDays;
    const start = continuous ? addOne(member.endDate) : paidOn;
    const end = periodEnd(start, t.durationMonths);
    const note = `تجديد ${t.name} من ${start} إلى ${end}${ref ? ` (${ref})` : ''}${continuous ? '' : '، بعد انقطاع'}`;
    await em.getRepository(MemMember).update({ id: member.id }, {
      startDate: start, endDate: end, ...(continuous ? {} : { joinedOn: start }), history: [...member.history, historyOf('renew', byName, note)],
    });
    return { start, end };
  }

  // ---------------- الإضافة المباشرة والتعديل ----------------

  /** إضافة عضو قائم (أعضاء الجمعية قبل استخدام النظام) دون طلب ولا مطالبة */
  async createDirect(actor: OrgUser, dto: DirectMemberDto) {
    const org = actor.organizationId;
    const s = await this.core.settings(org);
    const { type, answers } = this.checkEligibility(s, dto);
    if (dto.startDate < dto.joinedOn) throw new BadRequestException('بداية العضوية الحالية قبل تاريخ الانضمام');
    const end = dto.endDate || periodEnd(dto.startDate, type.durationMonths);
    if (end < dto.startDate) throw new BadRequestException('نهاية العضوية قبل بدايتها');
    const id = await this.db.transaction(async (em) => {
      await this.assertNoDuplicate(em, org, s, dto.nationalId);
      if (await em.getRepository(MemMember).exists({ where: { organizationId: org, nationalId: dto.nationalId } })) {
        throw new ConflictException('صاحب هذه الهوية مسجل في سجل الأعضاء، حدّث بياناته من ملفه');
      }
      let memberNo = dto.memberNo ?? null;
      if (memberNo) {
        if (await em.getRepository(MemMember).exists({ where: { organizationId: org, memberNo } })) throw new ConflictException(`رقم العضوية ${memberNo} مستخدم`);
        // الترقيم التلقائي يبدأ بعد أكبر رقم مدخل يدويًا
        await this.core.settings(org, em);
        await em.query('UPDATE mem_settings SET next_member_no = GREATEST(next_member_no, $2) WHERE organization_id = $1', [org, memberNo + 1]);
      } else {
        memberNo = await this.core.nextNo(em, org, 'nextMemberNo');
      }
      const m = await em.getRepository(MemMember).save(em.getRepository(MemMember).create({
        organizationId: org, memberNo, typeCode: type.code, ...personFields(dto), answers, documents: [], status: 'active',
        joinedOn: dto.joinedOn, startDate: dto.startDate, endDate: end, cardCode: shortCode(), source: 'direct', createdByName: actor.fullName,
        history: [historyOf('direct', actor.fullName, `أُضيف عضوًا قائمًا (${type.name}) منضمًا منذ ${dto.joinedOn}، والعضوية الحالية حتى ${end}`)],
      }));
      return m.id;
    });
    return this.profile(actor, id);
  }

  async update(actor: OrgUser, id: string, dto: PersonDto) {
    const org = actor.organizationId;
    const s = await this.core.settings(org);
    const m = await this.load(org, id);
    const { type, answers } = this.checkEligibility(s, dto, { allowInactive: m.typeCode });
    if (dto.nationalId !== m.nationalId && await this.db.getRepository(MemMember).exists({ where: { organizationId: org, nationalId: dto.nationalId } })) {
      throw new ConflictException('رقم الهوية مسجل لعضو آخر');
    }
    const history = [...m.history];
    if (type.code !== m.typeCode) history.push(historyOf('type', actor.fullName, `تغيير نوع العضوية من ${this.core.typeName(s, m.typeCode)} إلى ${type.name}`));
    else history.push(historyOf('update', actor.fullName));
    await this.db.getRepository(MemMember).update({ id }, { ...personFields(dto), typeCode: type.code, answers, history });
    return this.profile(actor, id);
  }

  async changeType(actor: OrgUser, id: string, dto: ChangeTypeDto) {
    const org = actor.organizationId;
    const s = await this.core.settings(org);
    const m = await this.load(org, id);
    const t = this.core.type(s, dto.typeCode);
    if (!t || !t.isActive) throw new BadRequestException('نوع العضوية غير متاح');
    if (t.code === m.typeCode) throw new BadRequestException('العضو على هذا النوع بالفعل');
    this.checkTypeRules(t, m.birthDate, m.nationality);
    await this.db.getRepository(MemMember).update({ id }, {
      typeCode: t.code, history: [...m.history, historyOf('type', actor.fullName, `تغيير نوع العضوية من ${this.core.typeName(s, m.typeCode)} إلى ${t.name}${dto.note ? `: ${dto.note}` : ''}`)],
    });
    return this.profile(actor, id);
  }

  async setStatus(actor: OrgUser, id: string, dto: MemberStatusDto) {
    const m = await this.load(actor.organizationId, id);
    if (m.status === dto.status) throw new BadRequestException('العضوية على هذه الحالة بالفعل');
    if (dto.status !== 'active' && !dto.note) throw new BadRequestException(dto.status === 'suspended' ? 'اكتب سبب إيقاف العضوية' : 'اكتب سبب إنهاء العضوية');
    const label = { active: 'إعادة تفعيل العضوية', suspended: 'إيقاف العضوية', terminated: 'إنهاء العضوية' }[dto.status];
    await this.db.getRepository(MemMember).update({ id }, {
      status: dto.status, statusNote: dto.note ?? null, history: [...m.history, historyOf(dto.status, actor.fullName, dto.note ? `${label}: ${dto.note}` : label)],
    });
    return this.profile(actor, id);
  }

  async uploadDocument(actor: OrgUser, id: string, file: Express.Multer.File) {
    const org = actor.organizationId;
    const s = await this.core.settings(org);
    const m = await this.load(org, id);
    const { docs, replaced } = await this.saveDocuments(org, s, [file], m.documents, false);
    await this.db.getRepository(MemMember).update({ id }, { documents: docs, history: [...m.history, historyOf('document', actor.fullName, `رفع ${s.documents.find((d) => d.key === file.fieldname)?.name ?? 'مستند'}`)] });
    await this.removeFiles(replaced);
    return this.profile(actor, id);
  }

  async documentFile(org: string, id: string, key: string) {
    const m = await this.load(org, id);
    const d = m.documents.find((x) => x.key === key);
    if (!d) throw new NotFoundException('المستند غير موجود');
    return { stream: this.files.open(d.fileKey), mime: d.mime, name: d.fileName };
  }

  // ---------------- العرض ----------------

  async load(org: string, id: string) {
    const m = await this.db.getRepository(MemMember).findOne({ where: { id, organizationId: org } });
    if (!m) throw new NotFoundException('العضو غير موجود');
    return m;
  }

  row(m: MemMember, s: MemSettings) {
    const st = this.core.effectiveStatus(m, s);
    const v = this.core.voting(m, s);
    const t = this.core.type(s, m.typeCode);
    return {
      id: m.id, memberNo: m.memberNo, fullName: m.fullName, nationalId: m.nationalId, mobile: m.mobile, email: m.email, gender: m.gender,
      nationality: m.nationality, city: m.city, birthDate: m.birthDate, occupation: m.occupation, typeCode: m.typeCode, typeName: t?.name ?? m.typeCode,
      typeColor: t?.color ?? '#94a3b8', status: st, statusLabel: MEMBER_STATUS_AR[st], joinedOn: m.joinedOn, startDate: m.startDate, endDate: m.endDate,
      daysLeft: daysBetween(today(), m.endDate), voting: v.eligible, votingNote: v.reason, votingFrom: v.from, source: m.source,
      hasId: m.documents.some((d) => d.key === 'id_front') || m.documents.length > 0,
    };
  }

  async list(actor: OrgUser, q: { status?: string; type?: string; search?: string; voting?: string; gender?: string }) {
    const org = actor.organizationId;
    const s = await this.core.settings(org);
    const qb = this.db.getRepository(MemMember).createQueryBuilder('m').where('m.organization_id = :org', { org });
    if (q.type) qb.andWhere('m.type_code = :type', { type: q.type });
    if (q.gender) qb.andWhere('m.gender = :gender', { gender: q.gender });
    if (q.search?.trim()) {
      const term = `%${q.search.trim()}%`;
      qb.andWhere('(m.full_name ILIKE :term OR m.national_id ILIKE :term OR m.mobile ILIKE :term OR m.member_no::text = :exact)', { term, exact: q.search.trim() });
    }
    let rows = (await qb.orderBy('m.member_no', 'ASC').getMany()).map((m) => this.row(m, s));
    if (q.status) rows = rows.filter((r) => (q.status === 'current' ? r.status === 'active' || r.status === 'expiring' : r.status === q.status));
    if (q.voting === '1') rows = rows.filter((r) => r.voting);
    return rows;
  }

  async profile(actor: OrgUser, id: string) {
    const org = actor.organizationId;
    const s = await this.core.settings(org);
    const m = await this.load(org, id);
    const invoices = await this.db.getRepository(MemInvoice).find({ where: { organizationId: org, memberId: id }, order: { createdAt: 'DESC' } });
    const app = m.applicationId ? await this.db.getRepository(MemApplication).findOne({ where: { id: m.applicationId }, select: ['id', 'applicationNo'] }) : null;
    // مطالبة العضوية الجديدة مربوطة بالطلب
    const appInvoices = app ? await this.db.getRepository(MemInvoice).find({ where: { organizationId: org, applicationId: app.id } }) : [];
    const all = [...invoices, ...appInvoices.filter((x) => !invoices.some((y) => y.id === x.id))].sort((a, b) => +b.createdAt - +a.createdAt);
    const notices = await this.db.getRepository(MemNotice).find({ where: { organizationId: org, memberId: id }, order: { createdAt: 'DESC' }, take: 30 });
    const vouchers = await this.voucherInfo(all.map((i) => i.voucherId).filter((x): x is string => !!x));
    const t = this.core.type(s, m.typeCode);
    const paid = all.filter((i) => i.status === 'paid');
    const open = all.filter((i) => i.status === 'unpaid' || i.status === 'review');
    return {
      ...this.row(m, s), idExpiry: m.idExpiry, address: m.address, employer: m.employer, qualification: m.qualification, answers: m.answers,
      documents: m.documents.map((d) => ({ key: d.key, name: d.name, mime: d.mime, fileName: d.fileName, uploadedAt: d.uploadedAt })),
      statusNote: m.statusNote, cardCode: m.cardCode, history: [...m.history].reverse(), createdByName: m.createdByName, createdAt: m.createdAt,
      application: app ? { id: app.id, applicationNo: app.applicationNo } : null,
      type: t ?? null,
      statement: all.map((i) => ({
        id: i.id, invoiceNo: i.invoiceNo, kind: i.kind, kindLabel: i.kind === 'new' ? 'اشتراك جديد' : 'تجديد', amount: i.amount, status: i.status,
        statusLabel: INVOICE_STATUS_AR[i.status], method: i.method, methodLabel: i.method ? METHOD_AR[i.method] : null, paidOn: i.paidOn, dueDate: i.dueDate,
        periodStart: i.periodStart, periodEnd: i.periodEnd, createdAt: i.createdAt, payToken: i.status === 'unpaid' ? i.payToken : null,
        voucher: i.voucherId ? vouchers.get(i.voucherId) ?? null : null, voucherError: i.voucherError,
      })),
      totals: { paid: round(paid.reduce((a, i) => a + i.amount, 0)), open: round(open.reduce((a, i) => a + i.amount, 0)), years: paid.length },
      notices: notices.map((n) => ({ id: n.id, channel: n.channel, daysLeft: n.daysLeft, message: n.message, sentByName: n.sentByName, createdAt: n.createdAt })),
    };
  }

  async voucherInfo(ids: string[]) {
    const map = new Map<string, { id: string; serial: number; status: string }>();
    if (!ids.length) return map;
    const rows: { id: string; serial: number; status: string }[] = await this.db.query('SELECT id, serial, status FROM acc_vouchers WHERE id = ANY($1)', [ids]);
    rows.forEach((r) => map.set(r.id, r));
    return map;
  }

  // ---------------- بطاقة العضوية ----------------

  async card(org: string, id: string) {
    const s = await this.core.settings(org);
    const m = await this.load(org, id);
    return this.cardOf(m, s, (await this.core.orgName(org)).name);
  }

  private cardOf(m: MemMember, s: MemSettings, orgName: string) {
    const st = this.core.effectiveStatus(m, s);
    const t = this.core.type(s, m.typeCode);
    return {
      orgName, title: s.card.title, signatoryName: s.card.signatoryName, signatoryTitle: s.card.signatoryTitle, note: s.card.note,
      memberNo: m.memberNo, fullName: m.fullName, nationalId: maskId(m.nationalId), typeName: t?.name ?? m.typeCode, typeColor: t?.color ?? '#0f766e',
      joinedOn: m.joinedOn, endDate: m.endDate, status: st, statusLabel: MEMBER_STATUS_AR[st], valid: st === 'active' || st === 'expiring',
      voting: this.core.voting(m, s).eligible, cardCode: m.cardCode, hasPhoto: m.documents.some((d) => d.key === 'photo' && d.mime.startsWith('image/')),
    };
  }

  /** التحقق العام من بطاقة العضوية برمزها */
  async verifyCard(code: string) {
    const m = await this.db.getRepository(MemMember).findOne({ where: { cardCode: String(code ?? '').trim().toUpperCase() } });
    if (!m) throw new NotFoundException('رمز التحقق غير صحيح، لا توجد بطاقة عضوية بهذا الرمز');
    const s = await this.core.settings(m.organizationId);
    const c = this.cardOf(m, s, (await this.core.orgName(m.organizationId)).name);
    return { orgName: c.orgName, memberNo: c.memberNo, fullName: c.fullName, typeName: c.typeName, endDate: c.endDate, status: c.status, statusLabel: c.statusLabel, valid: c.valid };
  }

  /** «عضويتي» في الصفحة العامة: برقم العضوية ورقم الهوية */
  async findForPublic(org: string, memberNo: number, nationalId: string) {
    const m = await this.db.getRepository(MemMember).findOne({ where: { organizationId: org, memberNo, nationalId } });
    if (!m) throw new NotFoundException('لا توجد عضوية بهذا الرقم ورقم الهوية');
    return m;
  }

  async publicMembership(org: string, memberNo: number, nationalId: string) {
    const s = await this.core.settings(org);
    const m = await this.findForPublic(org, memberNo, nationalId);
    const invoices = await this.db.getRepository(MemInvoice).createQueryBuilder('i').where('i.organization_id = :org', { org })
      .andWhere('(i.member_id = :id OR i.application_id = :app)', { id: m.id, app: m.applicationId ?? '00000000-0000-0000-0000-000000000000' })
      .orderBy('i.created_at', 'DESC').take(20).getMany();
    const t = this.core.type(s, m.typeCode);
    const st = this.core.effectiveStatus(m, s);
    return {
      card: this.cardOf(m, s, (await this.core.orgName(org)).name),
      daysLeft: daysBetween(today(), m.endDate),
      canRenew: (st === 'expiring' || st === 'grace' || st === 'expired' || st === 'active') && !!t && t.fee > 0,
      renewalAmount: t?.fee ?? 0,
      benefits: t?.benefits ?? null,
      invoices: invoices.map((i) => ({
        invoiceNo: i.invoiceNo, kindLabel: i.kind === 'new' ? 'اشتراك جديد' : 'تجديد', amount: i.amount, status: i.status, statusLabel: INVOICE_STATUS_AR[i.status],
        paidOn: i.paidOn, periodStart: i.periodStart, periodEnd: i.periodEnd, payToken: i.status === 'unpaid' ? i.payToken : null,
      })),
    };
  }

  typeOf(s: MemSettings, code: string): MembershipType {
    const t = this.core.type(s, code);
    if (!t) throw new BadRequestException('نوع العضوية غير موجود');
    return t;
  }

  /** الحالة الفعلية لعضو (تستخدمها الخدمات الأخرى) */
  statusOf(m: MemMember, s: MemSettings): EffectiveStatus {
    return this.core.effectiveStatus(m, s);
  }
}

const addOne = (d: string) => new Date(new Date(`${d}T12:00:00Z`).getTime() + 86400000).toISOString().slice(0, 10);
const round = (n: number) => Math.round(n * 100) / 100;
/** إخفاء جزء من رقم الهوية في البطاقة والتحقق العام */
export const maskId = (nid: string) => `${nid.slice(0, 2)}******${nid.slice(-2)}`;
