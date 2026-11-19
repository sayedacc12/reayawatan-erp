import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { OrgUser } from '../../core/auth/decorators';
import { generateTempPassword, PasswordResetService, tempExpiry } from '../../core/auth/password-reset.service';
import { LookupsService } from '../../core/lookups/lookups.service';
import { DECISION_TO_STATUS } from './constants';
import {
  AidDto, AidLogQuery, CreateBeneficiaryDto, FamilyMemberDto, ListBeneficiariesQuery, ResearchDto,
  UpdateBeneficiaryDto, UpdateFamilyMemberDto, UploadDocumentDto,
} from './beneficiaries.dto';
import { DocumentStorage } from './document-storage.service';
import * as bcrypt from 'bcryptjs';
import { AidDisbursement, Beneficiary, BeneficiaryDocument, BeneficiaryRequest, CaseResearch, FamilyMember } from './entities';

/** حالات لا يُصرف لها مساعدات */
const NO_AID_STATUSES = new Set(['ineligible', 'suspended']);

/**
 * كل العمليات مقيدة بجمعية المستخدم (organizationId)؛ أي سجل من جمعية أخرى
 * يُعامل كأنه غير موجود.
 */
@Injectable()
export class BeneficiariesService {
  constructor(
    private readonly db: DataSource,
    @InjectRepository(Beneficiary) private readonly beneficiaries: Repository<Beneficiary>,
    @InjectRepository(FamilyMember) private readonly family: Repository<FamilyMember>,
    @InjectRepository(CaseResearch) private readonly researches: Repository<CaseResearch>,
    @InjectRepository(AidDisbursement) private readonly aids: Repository<AidDisbursement>,
    @InjectRepository(BeneficiaryDocument) private readonly documents: Repository<BeneficiaryDocument>,
    private readonly storage: DocumentStorage,
    private readonly lookups: LookupsService,
    private readonly resets: PasswordResetService,
  ) {}

  // ---------------- الملفات ----------------

  async list(actor: OrgUser, q: ListBeneficiariesQuery) {
    const page = q.page ?? 1;
    const pageSize = q.pageSize ?? 25;
    const qb = this.beneficiaries.createQueryBuilder('b')
      .where('b.organization_id = :org', { org: actor.organizationId });
    if (q.status) qb.andWhere('b.status = :status', { status: q.status });
    if (q.category) qb.andWhere('b.category = :category', { category: q.category });
    if (q.search) {
      const term = q.search.replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660));
      const conds = ['b.full_name ILIKE :like', 'b.national_id LIKE :prefix', 'b.phone LIKE :prefix'];
      if (/^\d{1,9}$/.test(term)) conds.push('b.file_no = :fileNo');
      qb.andWhere(`(${conds.join(' OR ')})`, {
        like: `%${term.replace(/[%_\\]/g, '\\$&')}%`,
        prefix: `${term.replace(/[%_\\]/g, '\\$&')}%`,
        fileNo: Number(term),
      });
    }
    const total = await qb.getCount();
    const rows = await qb
      .select([
        'b.id', 'b.fileNo', 'b.fullName', 'b.nationalId', 'b.phone', 'b.city', 'b.category', 'b.status',
        'b.gender', 'b.monthlyIncome', 'b.createdAt',
      ])
      .addSelect((s) => s.select('COUNT(*)').from(FamilyMember, 'f').where('f.beneficiary_id = b.id'), 'family_count')
      .addSelect(
        (s) => s.select('COALESCE(SUM(a.amount), 0)').from(AidDisbursement, 'a').where('a.beneficiary_id = b.id'),
        'aid_total',
      )
      .addSelect((s) => s.select("to_char(MAX(a.disbursed_on), 'YYYY-MM-DD')").from(AidDisbursement, 'a').where('a.beneficiary_id = b.id'), 'last_aid_on')
      .orderBy('b.file_no', 'DESC')
      .offset((page - 1) * pageSize)
      .limit(pageSize)
      .getRawAndEntities();

    const items = rows.entities.map((b, i) => {
      const raw = rows.raw[i];
      return {
        id: b.id, fileNo: b.fileNo, fullName: b.fullName, nationalId: b.nationalId, phone: b.phone, city: b.city,
        category: b.category, status: b.status, gender: b.gender, monthlyIncome: b.monthlyIncome, createdAt: b.createdAt,
        familySize: Number(raw.family_count) + 1,
        aidTotal: Number(raw.aid_total),
        lastAidOn: raw.last_aid_on ?? null,
      };
    });
    return { items, total, page, pageSize };
  }

  async create(actor: OrgUser, dto: CreateBeneficiaryDto) {
    const id = await this.db.transaction(async (em) => {
      await this.lookups.assertNationalities(actor.organizationId, [dto.nationality], em);
      await this.ensureUniqueNationalId(em, actor.organizationId, dto.nationalId ?? null);
      // قفل على مستوى الجمعية حتى لا يأخذ ملفان نفس الرقم في نفس اللحظة
      await em.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`beneficiaries:${actor.organizationId}`]);
      const [{ next }] = await em.query(
        'SELECT COALESCE(MAX(file_no), 0) + 1 AS next FROM beneficiaries WHERE organization_id = $1',
        [actor.organizationId],
      );
      const saved = await em.save(em.create(Beneficiary, {
        ...this.withoutUndefined(dto),
        organizationId: actor.organizationId,
        fileNo: Number(next),
        status: dto.status ?? 'new',
        monthlyIncome: dto.monthlyIncome ?? 0,
        createdBy: actor.id,
      }));
      return saved.id;
    });
    return this.get(actor, id);
  }

  async get(actor: OrgUser, id: string) {
    const b = await this.beneficiaries.findOne({
      where: { id, organizationId: actor.organizationId },
      relations: { family: true, researches: true, aids: true, documents: true },
      order: {
        family: { birthDate: { direction: 'ASC', nulls: 'LAST' } },
        researches: { visitDate: 'DESC', createdAt: 'DESC' },
        aids: { disbursedOn: 'DESC', createdAt: 'DESC' },
        documents: { createdAt: 'DESC' },
      },
    });
    if (!b) throw new NotFoundException('ملف المستفيد غير موجود');
    const [{ portal }] = await this.db.query(
      'SELECT portal_password_hash IS NOT NULL AS portal FROM beneficiaries WHERE id = $1', [b.id],
    );
    const portalResets = await this.resets.portalLog(actor.organizationId, b.id);
    const family = b.family ?? [];
    const aids = b.aids ?? [];
    const familySize = family.length + 1;
    const householdIncome = b.monthlyIncome + family.reduce((s, m) => s + m.monthlyIncome, 0);
    return {
      ...b,
      hasPortalAccess: portal as boolean,
      portalResetPending: portalResets.some((r) => r.status === 'pending'),
      portalResets,
      summary: {
        familySize,
        householdIncome,
        // نصيب الفرد من الدخل بعد خصم الإيجار: مؤشر أساسي للاستحقاق
        perCapitaIncome: Math.round(((householdIncome - (b.monthlyRent ?? 0)) / familySize) * 100) / 100,
        aidTotal: aids.reduce((s, a) => s + a.amount, 0),
        aidCount: aids.length,
        lastAidOn: aids[0]?.disbursedOn ?? null,
      },
    };
  }

  async update(actor: OrgUser, id: string, dto: UpdateBeneficiaryDto) {
    const b = await this.find(actor, id);
    if (dto.nationality === null) throw new BadRequestException('اختر الجنسية');
    // الجنسية القديمة تبقى كما هي، وأي جنسية جديدة يجب أن تكون من القائمة المعتمدة
    if (dto.nationality !== undefined && dto.nationality !== b.nationality) {
      await this.lookups.assertNationalities(actor.organizationId, [dto.nationality]);
    }
    if (dto.nationalId !== undefined && dto.nationalId !== b.nationalId) {
      await this.ensureUniqueNationalId(this.db.manager, actor.organizationId, dto.nationalId ?? null, b.id);
    }
    Object.assign(b, this.withoutUndefined(dto));
    await this.beneficiaries.save(b);
    return this.get(actor, id);
  }

  async remove(actor: OrgUser, id: string) {
    const b = await this.find(actor, id);
    const docs = await this.documents.find({
      where: { beneficiaryId: b.id },
      select: { id: true, storageKey: true },
    });
    await this.beneficiaries.delete({ id: b.id });
    await this.storage.remove(docs.map((d) => d.storageKey));
  }

  /**
   * كلمة مرور مؤقتة للبوابة (بعد طلب «نسيت كلمة المرور» أو بمبادرة الموظف):
   * تظهر للموظف مرة واحدة ليرسلها لجوال المستفيد المسجل، صالحة 24 ساعة، ويغيّرها المستفيد عند أول دخول.
   */
  async portalTempPassword(actor: OrgUser, id: string) {
    const b = await this.find(actor, id);
    if (!b.nationalId) throw new BadRequestException('سجّل رقم الهوية أولًا، فالمستفيد يدخل البوابة به');
    const password = generateTempPassword();
    const expiresAt = tempExpiry();
    await this.db.transaction(async (em) => {
      await em.getRepository(Beneficiary).update(b.id, {
        portalPasswordHash: await bcrypt.hash(password, 12), portalMustChangePassword: true, portalTempExpiresAt: expiresAt, portalSessionsValidAfter: new Date(),
      });
      await this.resets.issuedForBeneficiary(em, { organizationId: actor.organizationId, beneficiaryId: b.id, name: b.fullName }, actor.fullName, expiresAt);
    });
    return { password, nationalId: b.nationalId, phone: b.phone, fullName: b.fullName, expiresAt };
  }

  /** الموظف يفعّل دخول المستفيد للبوابة بكلمة مرور (الدخول برقم الهوية) */
  async setPortalAccess(actor: OrgUser, id: string, password: string | null) {
    const b = await this.find(actor, id);
    if (password && !b.nationalId) throw new BadRequestException('سجّل رقم الهوية أولًا، فالمستفيد يدخل البوابة به');
    await this.beneficiaries.update(b.id, {
      portalPasswordHash: password ? await bcrypt.hash(password, 12) : null, portalMustChangePassword: false, portalTempExpiresAt: null,
      // إيقاف البوابة ينهي الجلسات المفتوحة فورًا
      ...(password ? {} : { portalSessionsValidAfter: new Date() }),
    });
  }

  // ---------------- الأسرة ----------------

  async addFamilyMember(actor: OrgUser, id: string, dto: FamilyMemberDto) {
    const b = await this.find(actor, id);
    return this.family.save(this.family.create({
      ...this.withoutUndefined(dto),
      monthlyIncome: dto.monthlyIncome ?? 0,
      organizationId: actor.organizationId,
      beneficiaryId: b.id,
    }));
  }

  async updateFamilyMember(actor: OrgUser, id: string, memberId: string, dto: UpdateFamilyMemberDto) {
    const m = await this.findChild(this.family, actor, id, memberId, 'فرد الأسرة غير موجود');
    Object.assign(m, this.withoutUndefined(dto));
    return this.family.save(m);
  }

  async removeFamilyMember(actor: OrgUser, id: string, memberId: string) {
    const m = await this.findChild(this.family, actor, id, memberId, 'فرد الأسرة غير موجود');
    await this.family.delete({ id: m.id });
  }

  // ---------------- البحث الاجتماعي ----------------

  /** تسجيل بحث جديد يحدّث حالة الملف حسب القرار */
  async addResearch(actor: OrgUser, id: string, dto: ResearchDto) {
    const b = await this.find(actor, id);
    return this.db.transaction(async (em) => {
      const r = await em.save(em.create(CaseResearch, {
        ...this.withoutUndefined(dto),
        organizationId: actor.organizationId,
        beneficiaryId: b.id,
        createdBy: actor.id,
      }));
      await em.update(Beneficiary, { id: b.id }, { status: DECISION_TO_STATUS[dto.decision] });
      return r;
    });
  }

  async removeResearch(actor: OrgUser, id: string, researchId: string) {
    const r = await this.findChild(this.researches, actor, id, researchId, 'البحث غير موجود');
    await this.researches.delete({ id: r.id });
  }

  // ---------------- المساعدات ----------------

  async addAid(actor: OrgUser, id: string, dto: AidDto) {
    const b = await this.find(actor, id);
    if (NO_AID_STATUSES.has(b.status)) {
      throw new BadRequestException('لا يمكن صرف مساعدة لحالة غير مستحقة أو موقوفة. غيّر حالة الملف أولًا');
    }
    if (dto.requestId) {
      const req = await this.db.getRepository(BeneficiaryRequest).findOne({
        where: { id: dto.requestId, beneficiaryId: b.id, organizationId: actor.organizationId },
      });
      if (!req) throw new BadRequestException('الطلب غير موجود');
      if (req.status !== 'approved') throw new BadRequestException('الصرف يكون على طلب معتمد نهائيًا فقط');
    }
    return this.aids.save(this.aids.create({
      ...this.withoutUndefined(dto),
      organizationId: actor.organizationId,
      beneficiaryId: b.id,
      createdBy: actor.id,
    }));
  }

  async removeAid(actor: OrgUser, id: string, aidId: string) {
    const a = await this.findChild(this.aids, actor, id, aidId, 'المساعدة غير موجودة');
    await this.aids.delete({ id: a.id });
  }

  /** سجل كل المساعدات المصروفة في الجمعية مع إجمالي الفترة */
  async aidLog(actor: OrgUser, q: AidLogQuery) {
    const page = q.page ?? 1;
    const pageSize = q.pageSize ?? 50;
    const qb = this.aids.createQueryBuilder('a')
      .innerJoin('a.beneficiary', 'b')
      .where('a.organization_id = :org', { org: actor.organizationId });
    if (q.from) qb.andWhere('a.disbursed_on >= :from', { from: q.from });
    if (q.to) qb.andWhere('a.disbursed_on <= :to', { to: q.to });
    if (q.aidType) qb.andWhere('a.aid_type = :type', { type: q.aidType });

    const totals = await qb.clone()
      .select('COUNT(*)', 'count')
      .addSelect('COALESCE(SUM(a.amount), 0)', 'amount')
      .addSelect('COUNT(DISTINCT a.beneficiary_id)', 'beneficiaries')
      .getRawOne();
    const rows = await qb
      .select(['a.id', 'a.aidType', 'a.amount', 'a.description', 'a.disbursedOn', 'a.referenceNo', 'a.createdAt'])
      .addSelect(['b.id', 'b.fileNo', 'b.fullName'])
      .orderBy('a.disbursed_on', 'DESC')
      .addOrderBy('a.created_at', 'DESC')
      .offset((page - 1) * pageSize)
      .limit(pageSize)
      .getMany();
    return {
      items: rows.map((a) => ({
        id: a.id, aidType: a.aidType, amount: a.amount, description: a.description,
        disbursedOn: a.disbursedOn, referenceNo: a.referenceNo,
        beneficiary: { id: a.beneficiary!.id, fileNo: a.beneficiary!.fileNo, fullName: a.beneficiary!.fullName },
      })),
      total: Number(totals.count),
      totalAmount: Number(totals.amount),
      beneficiaryCount: Number(totals.beneficiaries),
      page,
      pageSize,
    };
  }

  // ---------------- المستندات ----------------

  async uploadDocument(actor: OrgUser, id: string, dto: UploadDocumentDto, file: Express.Multer.File) {
    const b = await this.find(actor, id);
    const { key, mime } = await this.storage.save(actor.organizationId, file);
    try {
      const doc = await this.documents.save(this.documents.create({
        organizationId: actor.organizationId,
        beneficiaryId: b.id,
        title: dto.title,
        docType: dto.docType,
        // multer يقرأ اسم الملف latin1؛ نرجعه UTF-8 علشان الأسماء العربية
        originalName: Buffer.from(file.originalname, 'latin1').toString('utf8').slice(0, 255),
        mimeType: mime,
        size: file.size,
        storageKey: key,
        uploadedBy: actor.id,
      }));
      const { storageKey: _omit, ...rest } = doc;
      return rest;
    } catch (e) {
      await this.storage.remove([key]);
      throw e;
    }
  }

  async openDocument(actor: OrgUser, id: string, docId: string) {
    const doc = await this.documents.findOne({
      where: { id: docId, beneficiaryId: id, organizationId: actor.organizationId },
      select: { id: true, title: true, originalName: true, mimeType: true, size: true, storageKey: true },
    });
    if (!doc) throw new NotFoundException('المستند غير موجود');
    return { doc, stream: this.storage.open(doc.storageKey) };
  }

  async removeDocument(actor: OrgUser, id: string, docId: string) {
    const doc = await this.documents.findOne({
      where: { id: docId, beneficiaryId: id, organizationId: actor.organizationId },
      select: { id: true, storageKey: true },
    });
    if (!doc) throw new NotFoundException('المستند غير موجود');
    await this.documents.delete({ id: doc.id });
    await this.storage.remove([doc.storageKey]);
  }

  // ---------------- لوحة المؤشرات ----------------

  async stats(actor: OrgUser) {
    const org = actor.organizationId;
    const [byStatus, byCategory, aidByType, monthly, [counts], recent, reviews] = await Promise.all([
      this.db.query('SELECT status, COUNT(*)::int AS count FROM beneficiaries WHERE organization_id = $1 GROUP BY status', [org]),
      this.db.query('SELECT category, COUNT(*)::int AS count FROM beneficiaries WHERE organization_id = $1 GROUP BY category ORDER BY count DESC', [org]),
      this.db.query(
        `SELECT aid_type AS "aidType", COUNT(*)::int AS count, COALESCE(SUM(amount), 0)::float AS amount
         FROM beneficiary_aids WHERE organization_id = $1 AND disbursed_on >= date_trunc('year', CURRENT_DATE)
         GROUP BY aid_type ORDER BY amount DESC`, [org]),
      // آخر 6 شهور، بما فيها الشهور اللي مفيهاش صرف
      this.db.query(
        `SELECT to_char(m, 'YYYY-MM') AS month, COALESCE(SUM(a.amount), 0)::float AS amount, COUNT(a.id)::int AS count
         FROM generate_series(date_trunc('month', CURRENT_DATE) - interval '5 months', date_trunc('month', CURRENT_DATE), interval '1 month') m
         LEFT JOIN beneficiary_aids a ON a.organization_id = $1 AND date_trunc('month', a.disbursed_on) = m
         GROUP BY m ORDER BY m`, [org]),
      this.db.query(
        `SELECT
           (SELECT COUNT(*)::int FROM beneficiaries WHERE organization_id = $1) AS beneficiaries,
           (SELECT COUNT(*)::int FROM beneficiary_family_members WHERE organization_id = $1) AS "familyMembers",
           (SELECT COALESCE(SUM(amount), 0)::float FROM beneficiary_aids WHERE organization_id = $1
              AND disbursed_on >= date_trunc('month', CURRENT_DATE)) AS "aidThisMonth",
           (SELECT COALESCE(SUM(amount), 0)::float FROM beneficiary_aids WHERE organization_id = $1
              AND disbursed_on >= date_trunc('year', CURRENT_DATE)) AS "aidThisYear"`, [org]),
      this.db.query(
        `SELECT a.id, a.aid_type AS "aidType", a.amount::float AS amount, to_char(a.disbursed_on, 'YYYY-MM-DD') AS "disbursedOn",
                b.id AS "beneficiaryId", b.full_name AS "fullName", b.file_no AS "fileNo"
         FROM beneficiary_aids a JOIN beneficiaries b ON b.id = a.beneficiary_id
         WHERE a.organization_id = $1 ORDER BY a.disbursed_on DESC, a.created_at DESC LIMIT 6`, [org]),
      // حالات موعد مراجعتها حلّ أو خلال أسبوعين (من آخر بحث لكل حالة)
      this.db.query(
        `SELECT * FROM (
           SELECT DISTINCT ON (r.beneficiary_id) b.id, b.full_name AS "fullName", b.file_no AS "fileNo",
                  to_char(r.next_review_date, 'YYYY-MM-DD') AS "nextReviewDate"
           FROM beneficiary_researches r JOIN beneficiaries b ON b.id = r.beneficiary_id
           WHERE r.organization_id = $1
           ORDER BY r.beneficiary_id, r.visit_date DESC, r.created_at DESC
         ) last WHERE "nextReviewDate" IS NOT NULL AND "nextReviewDate"::date <= CURRENT_DATE + 14
         ORDER BY "nextReviewDate" LIMIT 8`, [org]),
    ]);
    return {
      ...counts,
      byStatus: Object.fromEntries(byStatus.map((r: { status: string; count: number }) => [r.status, r.count])),
      byCategory,
      aidByType,
      monthly,
      recentAids: recent,
      upcomingReviews: reviews,
    };
  }

  // ---------------- مساعدات داخلية ----------------

  private async find(actor: OrgUser, id: string) {
    const b = await this.beneficiaries.findOne({ where: { id, organizationId: actor.organizationId } });
    if (!b) throw new NotFoundException('ملف المستفيد غير موجود');
    return b;
  }

  private async findChild<T extends { id: string }>(
    repo: Repository<T>, actor: OrgUser, beneficiaryId: string, id: string, message: string,
  ): Promise<T> {
    const row = await repo.findOne({
      where: { id, beneficiaryId, organizationId: actor.organizationId } as never,
    });
    if (!row) throw new NotFoundException(message);
    return row;
  }

  private async ensureUniqueNationalId(em: EntityManager, organizationId: string, nationalId: string | null, exceptId?: string) {
    if (!nationalId) return;
    const other = await em.findOne(Beneficiary, {
      where: { organizationId, nationalId },
      select: { id: true, fileNo: true, fullName: true },
    });
    if (other && other.id !== exceptId) {
      throw new ConflictException(`رقم الهوية مسجل بالفعل للمستفيد ${other.fullName} (ملف رقم ${other.fileNo})`);
    }
  }

  private withoutUndefined<T extends object>(o: T): Partial<T> {
    return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>;
  }
}
