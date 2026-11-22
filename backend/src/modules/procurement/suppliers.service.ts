import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { randomBytes } from 'crypto';
import { DataSource, EntityManager, In } from 'typeorm';
import { OrgUser } from '../../core/auth/decorators';
import { FileStore } from '../../core/files/file-store.service';
import { MailService } from '../../core/mail/mail.service';
import { mailLayout, publicOrigin } from '../../core/mail/mail-templates';
import { MastersService } from '../accounting/masters.service';
import {
  BANK_STATUS, DOC_STATUS, ENTITY_TYPES, PORTAL_ROLES, PrPortalEvent, PrSettings, PrSupplier, PrSupplierBank, PrSupplierCategory, PrSupplierDoc, PrSupplierUser,
  SUPPLIER_KINDS, SUPPLIER_STATUS, SupplierDocType,
} from './entities/procurement.entity';
import { BankDecisionDto, BankDto, DocMetaDto, DocReviewDto, InviteUserDto, SupplierDecisionDto, SupplierDto, SuspendDto } from './procurement.dto';
import { addDays, cleanIban, ibanProblem, logEntry, prToday, ProcurementCore, supplierCode } from './procurement-core.service';

/** من يقوم بالإجراء: موظف الشركة أو مستخدم بوابة المورد */
export interface Actor { name: string; userId: string | null; via: 'staff' | 'portal' }
export const staffActor = (a: OrgUser): Actor => ({ name: a.fullName, userId: a.id, via: 'staff' });

/** المستندات المطلوبة لنوع الكيان */
export const docTypesFor = (s: PrSettings, entityType: PrSupplier['entityType']) =>
  s.supplierDocTypes.filter((d) => d.isActive && (!d.entityTypes.length || d.entityTypes.includes(entityType)));

/** كلمة مرور مؤقتة سهلة القراءة: حروف وأرقام بلا التباس */
export const tempPassword = () => {
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  const bytes = randomBytes(10);
  return `${Array.from(bytes, (b) => chars[b % chars.length]).join('')}7a`;
};

const SWEEP_EVERY_MS = 6 * 3600_000;

/** سجل الموردين ومزودي الخدمات: البيانات والتصنيف والمستندات والحسابات البنكية والاعتماد وحسابات البوابة */
@Injectable()
export class SuppliersService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger('Suppliers');
  private timer?: NodeJS.Timeout;

  constructor(
    private readonly db: DataSource, private readonly core: ProcurementCore, private readonly files: FileStore,
    private readonly mail: MailService, private readonly masters: MastersService,
  ) {}

  onApplicationBootstrap() {
    if (process.env.JEST_WORKER_ID) return;
    const run = () => this.sweep().catch((e) => this.logger.error(`Supplier documents sweep failed: ${(e as Error).message}`));
    setTimeout(run, 90_000).unref();
    this.timer = setInterval(run, SWEEP_EVERY_MS);
    this.timer.unref();
  }

  onApplicationShutdown() {
    if (this.timer) clearInterval(this.timer);
  }

  // ---------------- القراءة ----------------

  async list(org: string, q: Record<string, string>) {
    await this.core.settings(org);
    const t = prToday();
    const s = await this.core.settings(org);
    const search = q.q?.trim() ? `%${q.q.trim()}%` : null;
    const rows = await this.db.query(
      `SELECT s.id, s.supplier_no AS "supplierNo", s.name, s.entity_type AS "entityType", s.supplier_kind AS "supplierKind", s.category_ids AS "categoryIds",
              s.activities, s.city, s.phone, s.email, s.status, s.source, s.cr_number AS "crNumber", s.vat_number AS "vatNumber", s.submitted_at AS "submittedAt",
              s.acc_partner_id AS "accPartnerId", s.created_at AS "createdAt",
              (SELECT COUNT(*)::int FROM pr_supplier_docs d WHERE d.supplier_id = s.id AND d.is_current AND d.status = 'pending') AS "docsPending",
              (SELECT COUNT(*)::int FROM pr_supplier_docs d WHERE d.supplier_id = s.id AND d.is_current AND d.expiry_date < $2) AS "docsExpired",
              (SELECT COUNT(*)::int FROM pr_supplier_docs d WHERE d.supplier_id = s.id AND d.is_current AND d.expiry_date BETWEEN $2 AND $3) AS "docsExpiring",
              (SELECT COUNT(*)::int FROM pr_supplier_banks b WHERE b.supplier_id = s.id AND b.status = 'pending') AS "banksPending",
              EXISTS (SELECT 1 FROM pr_supplier_banks b WHERE b.supplier_id = s.id AND b.status = 'approved' AND b.is_primary) AS "hasBank",
              (SELECT COUNT(*)::int FROM pr_supplier_users u WHERE u.supplier_id = s.id AND u.is_active) AS users
         FROM pr_suppliers s
        WHERE s.organization_id = $1 AND ($4::text IS NULL OR s.status = $4) AND ($5::text IS NULL OR s.category_ids ? $5) AND ($6::text IS NULL OR s.supplier_kind = $6)
          AND ($7::text IS NULL OR s.activities ? $7)
          AND ($8::text IS NULL OR s.name ILIKE $8 OR s.name_en ILIKE $8 OR s.cr_number ILIKE $8 OR s.vat_number ILIKE $8 OR s.email ILIKE $8 OR s.phone ILIKE $8 OR s.city ILIKE $8)
          AND ($9::text IS NULL OR ($9 = 'expiring' AND EXISTS (SELECT 1 FROM pr_supplier_docs d WHERE d.supplier_id = s.id AND d.is_current AND d.expiry_date <= $3)))
        ORDER BY CASE s.status WHEN 'pending' THEN 0 WHEN 'returned' THEN 1 ELSE 2 END, s.supplier_no DESC LIMIT 2000`,
      [org, t, addDays(t, s.docAlertDays), q.status || null, q.category || null, q.kind || null, q.activity || null, search, q.docs || null]);
    const cats = await this.db.getRepository(PrSupplierCategory).find({ where: { organizationId: org } });
    const cat = new Map(cats.map((c) => [c.id, c]));
    return rows.map((r: PrSupplier & { categoryIds: string[] }) => ({
      ...r, code: supplierCode(r.supplierNo), statusLabel: SUPPLIER_STATUS[r.status], entityTypeLabel: ENTITY_TYPES[r.entityType], kindLabel: SUPPLIER_KINDS[r.supplierKind],
      categories: r.categoryIds.map((id) => cat.get(id)).filter(Boolean).map((c) => ({ id: c!.id, name: c!.name, color: c!.color })),
    }));
  }

  async find(org: string, id: string, em: EntityManager = this.db.manager) {
    const s = await em.getRepository(PrSupplier).findOne({ where: { id, organizationId: org } });
    if (!s) throw new NotFoundException('المورد غير موجود');
    return s;
  }

  /** حالة المستندات المطلوبة: لكل نوع مطلوب هل رُفع؟ وهل قُبل؟ وهل انتهى؟ */
  async checklist(org: string, sup: PrSupplier, em: EntityManager = this.db.manager) {
    const s = await this.core.settings(org, em);
    const docs = await em.getRepository(PrSupplierDoc).find({ where: { supplierId: sup.id, isCurrent: true } });
    const t = prToday();
    const types = docTypesFor(s, sup.entityType);
    const rows = types.map((dt) => {
      const d = docs.find((x) => x.docType === dt.key);
      const expired = !!(d?.expiryDate && d.expiryDate < t);
      return {
        key: dt.key, name: dt.name, required: dt.required, hasExpiry: dt.hasExpiry, uploaded: !!d, status: d?.status ?? null, expired,
        expiring: !!(d?.expiryDate && !expired && d.expiryDate <= addDays(t, s.docAlertDays)), expiryDate: d?.expiryDate ?? null,
      };
    });
    const missing = rows.filter((r) => r.required && (!r.uploaded || r.status === 'rejected' || r.expired));
    const profile: string[] = [];
    if (['company', 'establishment'].includes(sup.entityType) && !sup.crNumber) profile.push('رقم السجل التجاري');
    if (sup.entityType === 'individual' && !sup.nationalId) profile.push('رقم الهوية');
    if (!sup.phone && !sup.email) profile.push('هاتف أو بريد المنشأة');
    if (!sup.city) profile.push('المدينة');
    if (!sup.activities.length) profile.push('الأنشطة والخدمات');
    return { docs: rows, missingDocs: missing.map((m) => m.name), missingProfile: profile, complete: !missing.length && !profile.length };
  }

  async get(org: string, id: string) {
    const sup = await this.find(org, id);
    const [docs, banks, users, events, cats, check] = await Promise.all([
      this.db.getRepository(PrSupplierDoc).find({ where: { supplierId: id }, order: { createdAt: 'DESC' } }),
      this.db.getRepository(PrSupplierBank).find({ where: { supplierId: id }, order: { createdAt: 'DESC' } }),
      this.db.getRepository(PrSupplierUser).find({ where: { supplierId: id }, order: { createdAt: 'ASC' } }),
      this.db.getRepository(PrPortalEvent).find({ where: { supplierId: id }, order: { at: 'DESC' }, take: 60 }),
      this.db.getRepository(PrSupplierCategory).find({ where: { organizationId: org } }),
      this.checklist(org, sup),
    ]);
    const s = await this.core.settings(org);
    const typeName = new Map(s.supplierDocTypes.map((d) => [d.key, d.name]));
    const [partner] = sup.accPartnerId
      ? await this.db.query(`SELECT id, partner_no AS "partnerNo", name FROM acc_partners WHERE id = $1`, [sup.accPartnerId]) : [];
    const t = prToday();
    return {
      ...sup, code: supplierCode(sup.supplierNo), statusLabel: SUPPLIER_STATUS[sup.status], entityTypeLabel: ENTITY_TYPES[sup.entityType], kindLabel: SUPPLIER_KINDS[sup.supplierKind],
      categories: sup.categoryIds.map((cid) => cats.find((c) => c.id === cid)).filter(Boolean).map((c) => ({ id: c!.id, name: c!.name, color: c!.color })),
      docs: docs.map((d) => ({
        ...d, fileKey: undefined, typeName: typeName.get(d.docType) ?? d.docType, statusLabel: DOC_STATUS[d.status],
        expired: !!(d.expiryDate && d.expiryDate < t), expiring: !!(d.expiryDate && d.expiryDate >= t && d.expiryDate <= addDays(t, s.docAlertDays)),
      })),
      banks: banks.map((b) => ({ ...b, fileKey: undefined, statusLabel: BANK_STATUS[b.status] })),
      users: users.map((u) => ({ id: u.id, fullName: u.fullName, email: u.email, phone: u.phone, role: u.role, roleLabel: PORTAL_ROLES[u.role], isActive: u.isActive, lastLoginAt: u.lastLoginAt, mustChangePassword: u.mustChangePassword })),
      events, checklist: check,
      partner: partner ? { id: partner.id, code: `P-${String(partner.partnerNo).padStart(4, '0')}`, name: partner.name } : null,
      portalUrl: await this.portalUrl(org),
    };
  }

  async portalUrl(org: string) {
    const [o] = await this.db.query('SELECT slug FROM organizations WHERE id = $1', [org]);
    return `${publicOrigin() ?? ''}/supplier/${o?.slug ?? ''}`;
  }

  // ---------------- التسجيل والتعديل ----------------

  async assertUnique(org: string, dto: Pick<SupplierDto, 'crNumber' | 'vatNumber' | 'nationalId'>, except?: string, em: EntityManager = this.db.manager) {
    for (const [col, val, label] of [['cr_number', dto.crNumber, 'رقم السجل التجاري'], ['vat_number', dto.vatNumber, 'الرقم الضريبي'], ['national_id', dto.nationalId, 'رقم الهوية']] as const) {
      if (!val) continue;
      const [dup] = await em.query(`SELECT supplier_no, name FROM pr_suppliers WHERE organization_id = $1 AND ${col} = $2 AND id <> COALESCE($3::uuid, gen_random_uuid())`, [org, val, except ?? null]);
      if (dup) throw new ConflictException(`${label} ${val} مسجل للمورد ${supplierCode(dup.supplier_no)} «${dup.name}»`);
    }
  }

  async checkCategories(org: string, ids: string[] | undefined, em: EntityManager = this.db.manager) {
    const uniq = [...new Set(ids ?? [])];
    if (!uniq.length) return [];
    const n = await em.getRepository(PrSupplierCategory).count({ where: { organizationId: org, id: In(uniq) } });
    if (n !== uniq.length) throw new BadRequestException('أحد تصنيفات المورد غير موجود');
    return uniq;
  }

  fields(dto: SupplierDto, categoryIds: string[]) {
    const individual = dto.entityType === 'individual';
    return {
      name: dto.name.trim().replace(/\s+/g, ' '), nameEn: dto.nameEn?.trim() || null, entityType: dto.entityType, supplierKind: dto.supplierKind, categoryIds,
      activities: [...new Set((dto.activities ?? []).map((x) => x.trim()).filter(Boolean))], about: dto.about ?? null,
      crNumber: individual ? null : dto.crNumber || null, crExpiry: individual ? null : dto.crExpiry || null, vatNumber: dto.vatNumber || null,
      nationalId: individual ? dto.nationalId || null : null, city: dto.city ?? null, address: dto.address ?? null, phone: dto.phone || null, email: dto.email || null,
      website: dto.website || null,
      contacts: (dto.contacts ?? []).map((c) => ({ name: c.name.trim(), title: c.title ?? null, phone: c.phone || null, email: c.email || null, authorized: !!c.authorized })),
      branches: (dto.branches ?? []).map((b) => ({ name: b.name.trim(), city: b.city ?? null, address: b.address ?? null, phone: b.phone || null })),
    };
  }

  async nextNo(em: EntityManager, org: string) {
    await em.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`pr-suppliers:${org}`]);
    const [m] = await em.query('SELECT COALESCE(MAX(supplier_no), 0) + 1 AS n FROM pr_suppliers WHERE organization_id = $1', [org]);
    return Number(m.n);
  }

  /** تسجيل مورد من الموظف: يدخل مباشرة في انتظار المراجعة والاعتماد */
  async create(a: OrgUser, dto: SupplierDto) {
    const org = a.organizationId;
    await this.core.settings(org);
    await this.assertUnique(org, dto);
    const cats = await this.checkCategories(org, dto.categoryIds);
    const id = await this.db.transaction(async (em) => {
      const no = await this.nextNo(em, org);
      const s = await em.getRepository(PrSupplier).save(em.create(PrSupplier, {
        organizationId: org, supplierNo: no, ...this.fields(dto, cats), status: 'pending', source: 'internal', submittedAt: new Date(),
        createdByName: a.fullName, log: [logEntry('تسجيل المورد', a.fullName)],
      }));
      return s.id;
    });
    return this.get(org, id);
  }

  /** البيانات النظامية التي يُسجل تغييرها بوضوح في السجل (رقابة تغيير بيانات الموردين) */
  changedFields(before: PrSupplier, after: ReturnType<SuppliersService['fields']>) {
    const labels: Partial<Record<keyof typeof after, string>> = {
      name: 'الاسم', nameEn: 'الاسم بالإنجليزية', entityType: 'نوع الكيان', supplierKind: 'نوع المورد', categoryIds: 'التصنيف', activities: 'الأنشطة',
      crNumber: 'السجل التجاري', crExpiry: 'انتهاء السجل', vatNumber: 'الرقم الضريبي', nationalId: 'رقم الهوية', city: 'المدينة', address: 'العنوان',
      phone: 'الهاتف', email: 'البريد', website: 'الموقع', contacts: 'جهات التواصل', branches: 'الفروع', about: 'النبذة',
    };
    return (Object.keys(labels) as (keyof typeof after)[])
      .filter((k) => JSON.stringify(after[k] ?? null) !== JSON.stringify((before as unknown as Record<string, unknown>)[k] ?? null))
      .map((k) => labels[k]!);
  }

  async update(a: OrgUser, id: string, dto: SupplierDto) {
    const org = a.organizationId;
    const sup = await this.find(org, id);
    if (sup.status === 'rejected') throw new ConflictException('المورد مرفوض، ولا تُعدل بياناته');
    await this.assertUnique(org, dto, id);
    const cats = await this.checkCategories(org, dto.categoryIds);
    const f = this.fields(dto, cats);
    const changed = this.changedFields(sup, f);
    if (!changed.length) return this.get(org, id);
    await this.db.getRepository(PrSupplier).update({ id }, { ...f, log: [...sup.log, logEntry('تعديل بيانات المورد', a.fullName, changed.join('، '))] });
    return this.get(org, id);
  }

  // ---------------- الاعتماد ----------------

  async decide(a: OrgUser, id: string, dto: SupplierDecisionDto) {
    const org = a.organizationId;
    const sup = await this.find(org, id);
    if (sup.status !== 'pending') throw new ConflictException(`حالة المورد «${SUPPLIER_STATUS[sup.status]}»، والقرار على الطلبات التي بانتظار المراجعة فقط`);
    const note = dto.note?.trim() || null;
    if (dto.decision !== 'approve' && !note) throw new BadRequestException(dto.decision === 'return' ? 'اكتب ما يلزم استكماله ليصل للمورد' : 'اكتب سبب الرفض');
    if (dto.decision === 'approve') {
      const check = await this.checklist(org, sup);
      const pendingRequired = check.docs.filter((d) => d.required && d.status === 'pending').map((d) => d.name);
      if (pendingRequired.length) throw new ConflictException(`راجع المستندات الإلزامية واقبلها أولًا: ${pendingRequired.join('، ')}`);
      if (!check.complete) throw new ConflictException(`ملف المورد غير مكتمل: ${[...check.missingProfile, ...check.missingDocs].join('، ')}`);
    }
    const status = dto.decision === 'approve' ? 'approved' : dto.decision === 'return' ? 'returned' : 'rejected';
    const action = { approve: 'اعتماد المورد', return: 'إعادة الطلب للاستكمال', reject: 'رفض المورد' }[dto.decision];
    await this.db.getRepository(PrSupplier).update({ id }, {
      status, reviewNote: note, decidedByName: a.fullName, decidedAt: new Date(), log: [...sup.log, logEntry(action, a.fullName, note)],
    });
    if (dto.decision === 'approve' && !sup.accPartnerId) await this.ensurePartner(a, id).catch((e) => this.logger.warn(`Supplier partner link skipped: ${(e as Error).message}`));
    await this.notify(org, id, `${action}`, dto.decision === 'approve'
      ? ['اعتمدت الشركة تسجيلكم موردًا لديها. يمكنكم الآن استقبال طلبات عروض الأسعار والتعميدات عبر البوابة.']
      : dto.decision === 'return' ? ['أعادت الشركة طلب تسجيلكم لاستكمال بعض البيانات أو المستندات:', note!] : ['نعتذر، لم تعتمد الشركة طلب تسجيلكم:', note!]);
    return this.get(org, id);
  }

  /** ينشئ الشريك المقابل في النظام المالي (حساب الدائنين) إن كانت الإعدادات المالية مضبوطة */
  async ensurePartner(a: OrgUser, id: string) {
    const org = a.organizationId;
    const sup = await this.find(org, id);
    if (sup.accPartnerId) return sup.accPartnerId;
    const s = await this.core.settings(org);
    if (!s.partnerCategoryId || !s.payablesAccountId) {
      throw new BadRequestException('حدد تصنيف الموردين وحساب الدائنين في إعدادات المشتريات أولًا، أو اربط المورد بشريك موجود');
    }
    const p = await this.masters.createPartner(a, {
      name: sup.name, categoryId: s.partnerCategoryId, description: `${supplierCode(sup.supplierNo)} من سجل الموردين`,
      phones: sup.phone ? [sup.phone] : [], emails: sup.email ? [sup.email] : [], addresses: sup.address ? [{ label: 'العنوان الوطني', address: sup.address, city: sup.city }] : [],
      taxNumber: sup.vatNumber, crNumber: sup.crNumber, accountId: s.payablesAccountId, isActive: true,
    } as never);
    await this.db.getRepository(PrSupplier).update({ id }, { accPartnerId: p.id, log: [...sup.log, logEntry('ربط المورد بالنظام المالي', a.fullName, `${p.code} ${p.name}`)] });
    return p.id;
  }

  /** ربط المورد بشريك موجود في النظام المالي (تصنيفه موردون) */
  async linkPartner(a: OrgUser, id: string, partnerId: string | null) {
    const org = a.organizationId;
    const sup = await this.find(org, id);
    if (partnerId === null && !sup.accPartnerId) return this.get(org, id);
    if (partnerId) {
      const [p] = await this.db.query(
        `SELECT p.id, p.partner_no, p.name FROM acc_partners p JOIN acc_partner_categories c ON c.id = p.category_id
          WHERE p.organization_id = $1 AND p.id = $2 AND c.behavior = 'supplier'`, [org, partnerId]);
      if (!p) throw new BadRequestException('الشريك غير موجود في النظام المالي أو ليس من تصنيف الموردين');
      const [used] = await this.db.query('SELECT supplier_no, name FROM pr_suppliers WHERE organization_id = $1 AND acc_partner_id = $2 AND id <> $3', [org, partnerId, id]);
      if (used) throw new ConflictException(`الشريك مربوط بالمورد ${supplierCode(used.supplier_no)} «${used.name}»`);
      await this.db.getRepository(PrSupplier).update({ id }, { accPartnerId: partnerId, log: [...sup.log, logEntry('ربط المورد بالنظام المالي', a.fullName, `P-${String(p.partner_no).padStart(4, '0')} ${p.name}`)] });
    } else {
      await this.db.getRepository(PrSupplier).update({ id }, { accPartnerId: null, log: [...sup.log, logEntry('فك ربط المورد بالنظام المالي', a.fullName)] });
    }
    return this.get(org, id);
  }

  async createPartner(a: OrgUser, id: string) {
    await this.ensurePartner(a, id);
    return this.get(a.organizationId, id);
  }

  async suspend(a: OrgUser, id: string, dto: SuspendDto) {
    const org = a.organizationId;
    const sup = await this.find(org, id);
    if (sup.status !== 'approved') throw new ConflictException('الإيقاف للموردين المعتمدين فقط');
    await this.db.getRepository(PrSupplier).update({ id }, { status: 'suspended', reviewNote: dto.reason, decidedByName: a.fullName, decidedAt: new Date(), log: [...sup.log, logEntry('إيقاف المورد', a.fullName, dto.reason)] });
    await this.notify(org, id, 'إيقاف التعامل', ['أوقفت الشركة التعامل مع حسابكم مؤقتًا للسبب التالي:', dto.reason, 'يمكنكم الدخول للبوابة للاطلاع، والتواصل مع الشركة لمعالجة السبب.']);
    return this.get(org, id);
  }

  async reactivate(a: OrgUser, id: string) {
    const org = a.organizationId;
    const sup = await this.find(org, id);
    if (sup.status !== 'suspended') throw new ConflictException('المورد غير موقوف');
    await this.db.getRepository(PrSupplier).update({ id }, { status: 'approved', reviewNote: null, decidedByName: a.fullName, decidedAt: new Date(), log: [...sup.log, logEntry('إعادة تفعيل المورد', a.fullName)] });
    return this.get(org, id);
  }

  // ---------------- المستندات ----------------

  async addDoc(org: string, supplierId: string, dto: DocMetaDto, file: Express.Multer.File | undefined, by: Actor) {
    const sup = await this.find(org, supplierId);
    const s = await this.core.settings(org);
    const dt = docTypesFor(s, sup.entityType).find((d) => d.key === dto.docType) ?? s.supplierDocTypes.find((d) => d.key === dto.docType && d.isActive);
    if (!dt) throw new BadRequestException('نوع المستند غير معرّف في الإعدادات');
    if (dt.hasExpiry && !dto.expiryDate) throw new BadRequestException(`اكتب تاريخ انتهاء «${dt.name}»`);
    if (dto.expiryDate && dto.expiryDate < prToday()) throw new BadRequestException(`«${dt.name}» منتهي الصلاحية، ارفع النسخة السارية`);
    if (dto.issueDate && dto.expiryDate && dto.issueDate > dto.expiryDate) throw new BadRequestException('تاريخ الإصدار بعد تاريخ الانتهاء');
    const saved = await this.files.save(`${org}/suppliers`, file, `ملف «${dt.name}»`);
    await this.db.transaction(async (em) => {
      await em.getRepository(PrSupplierDoc).update({ supplierId, docType: dt.key, isCurrent: true }, { isCurrent: false });
      await em.getRepository(PrSupplierDoc).insert({
        organizationId: org, supplierId, docType: dt.key, title: dt.name, number: dto.number?.trim() || null, issueDate: dto.issueDate || null,
        expiryDate: dt.hasExpiry ? dto.expiryDate || null : null, fileKey: saved.key, fileName: saved.name, fileMime: saved.mime, fileSize: file?.size ?? 0,
        status: 'pending', uploadedVia: by.via, uploadedByName: by.name,
      });
      await em.getRepository(PrSupplier).update({ id: supplierId }, { log: [...sup.log, logEntry(`رفع مستند: ${dt.name}`, by.name, dto.expiryDate ? `ينتهي ${dto.expiryDate}` : null)] });
    });
  }

  async reviewDoc(a: OrgUser, supplierId: string, docId: string, dto: DocReviewDto) {
    const org = a.organizationId;
    const sup = await this.find(org, supplierId);
    const d = await this.db.getRepository(PrSupplierDoc).findOne({ where: { id: docId, supplierId, organizationId: org } });
    if (!d) throw new NotFoundException('المستند غير موجود');
    if (!d.isCurrent) throw new ConflictException('هذه نسخة سابقة من المستند');
    if (dto.decision === 'reject' && !dto.note?.trim()) throw new BadRequestException('اكتب سبب رفض المستند ليصل للمورد');
    const status = dto.decision === 'accept' ? 'accepted' : 'rejected';
    await this.db.getRepository(PrSupplierDoc).update({ id: docId }, { status, reviewNote: dto.note?.trim() || null, reviewedByName: a.fullName, reviewedAt: new Date() });
    const patch: Partial<PrSupplier> = { log: [...sup.log, logEntry(`${status === 'accepted' ? 'قبول' : 'رفض'} مستند: ${d.title}`, a.fullName, dto.note?.trim() || null)] };
    // السجل التجاري المقبول يحدّث تاريخ انتهاء السجل في ملف المورد
    if (status === 'accepted' && d.docType === 'cr' && d.expiryDate) patch.crExpiry = d.expiryDate;
    await this.db.getRepository(PrSupplier).update({ id: supplierId }, patch);
    if (status === 'rejected') await this.notify(org, supplierId, `رفض مستند: ${d.title}`, [`لم تقبل الشركة المستند «${d.title}» للسبب التالي:`, dto.note!.trim(), 'ارفع نسخة صحيحة من البوابة.']);
    return this.get(org, supplierId);
  }

  async docFile(org: string, supplierId: string, docId: string) {
    const d = await this.db.getRepository(PrSupplierDoc).findOne({ where: { id: docId, supplierId, organizationId: org } });
    if (!d) throw new NotFoundException('المستند غير موجود');
    return { stream: this.files.open(d.fileKey), mime: d.fileMime, name: d.fileName };
  }

  async removeDoc(org: string, supplierId: string, docId: string, by: Actor) {
    const sup = await this.find(org, supplierId);
    const d = await this.db.getRepository(PrSupplierDoc).findOne({ where: { id: docId, supplierId, organizationId: org } });
    if (!d) throw new NotFoundException('المستند غير موجود');
    if (d.status === 'accepted') throw new ConflictException('المستند مقبول ولا يُحذف، ارفع نسخة محدثة بدلًا منه');
    await this.db.transaction(async (em) => {
      await em.getRepository(PrSupplierDoc).delete({ id: docId });
      // تعود النسخة السابقة المقبولة مستندًا حاليًا
      if (d.isCurrent) {
        const prev = await em.getRepository(PrSupplierDoc).findOne({ where: { supplierId, docType: d.docType }, order: { createdAt: 'DESC' } });
        if (prev) await em.getRepository(PrSupplierDoc).update({ id: prev.id }, { isCurrent: true });
      }
      await em.getRepository(PrSupplier).update({ id: supplierId }, { log: [...sup.log, logEntry(`حذف مستند: ${d.title}`, by.name)] });
    });
    await this.files.remove(d.fileKey).catch(() => undefined);
  }

  // ---------------- الحسابات البنكية ----------------

  async addBank(org: string, supplierId: string, dto: BankDto, file: Express.Multer.File | undefined, by: Actor) {
    const sup = await this.find(org, supplierId);
    const problem = ibanProblem(dto.iban);
    if (problem) throw new BadRequestException(problem);
    const iban = cleanIban(dto.iban);
    const [other] = await this.db.query(
      `SELECT s.supplier_no, s.name FROM pr_supplier_banks b JOIN pr_suppliers s ON s.id = b.supplier_id
        WHERE b.organization_id = $1 AND b.iban = $2 AND b.supplier_id <> $3 AND b.status IN ('pending', 'approved')`, [org, iban, supplierId]);
    if (other) throw new ConflictException(`رقم الآيبان مسجل لمورد آخر (${supplierCode(other.supplier_no)} «${other.name}»)، وهذا غير مسموح`);
    if (await this.db.getRepository(PrSupplierBank).exists({ where: { supplierId, iban, status: In(['pending', 'approved']) } })) {
      throw new ConflictException('هذا الحساب مسجل بالفعل للمورد');
    }
    if (by.via === 'portal' && !file) throw new BadRequestException('أرفق خطاب البنك أو شهادة الآيبان المختومة');
    const saved = file ? await this.files.save(`${org}/suppliers`, file, 'خطاب البنك') : null;
    await this.db.getRepository(PrSupplierBank).insert({
      organizationId: org, supplierId, bankName: dto.bankName.trim(), iban, accountName: dto.accountName.trim(),
      fileKey: saved?.key ?? null, fileName: saved?.name ?? null, fileMime: saved?.mime ?? null,
      status: 'pending', requestedVia: by.via, requestedById: by.userId, requestedByName: by.name,
    });
    await this.db.getRepository(PrSupplier).update({ id: supplierId }, { log: [...sup.log, logEntry('طلب إضافة حساب بنكي', by.name, `${dto.bankName.trim()} · ${iban.slice(0, 4)}…${iban.slice(-4)}`)] });
  }

  /** اعتماد الحساب البنكي: مستقل عن طالبه، والحساب المعتمد يصبح الرئيسي ويُستبعد السابق */
  async decideBank(a: OrgUser, supplierId: string, bankId: string, dto: BankDecisionDto) {
    const org = a.organizationId;
    const sup = await this.find(org, supplierId);
    const b = await this.db.getRepository(PrSupplierBank).findOne({ where: { id: bankId, supplierId, organizationId: org } });
    if (!b) throw new NotFoundException('الحساب البنكي غير موجود');
    if (b.status !== 'pending') throw new ConflictException('الحساب ليس بانتظار الاعتماد');
    if (b.requestedById && b.requestedById === a.id) throw new ForbiddenException('لا يعتمد الحساب البنكي من طلب إضافته؛ يعتمده مستخدم آخر (فصل المسؤوليات)');
    if (dto.decision === 'reject' && !dto.note?.trim()) throw new BadRequestException('اكتب سبب رفض الحساب البنكي');
    const masked = `${b.bankName} · ${b.iban.slice(0, 4)}…${b.iban.slice(-4)}`;
    await this.db.transaction(async (em) => {
      if (dto.decision === 'approve') {
        await em.getRepository(PrSupplierBank).update({ supplierId, status: 'approved', isPrimary: true }, { status: 'inactive', isPrimary: false });
      }
      await em.getRepository(PrSupplierBank).update({ id: bankId }, {
        status: dto.decision === 'approve' ? 'approved' : 'rejected', isPrimary: dto.decision === 'approve', decidedByName: a.fullName, decidedAt: new Date(), decisionNote: dto.note?.trim() || null,
      });
      await em.getRepository(PrSupplier).update({ id: supplierId }, {
        log: [...sup.log, logEntry(dto.decision === 'approve' ? 'اعتماد الحساب البنكي' : 'رفض الحساب البنكي', a.fullName, [masked, dto.note?.trim()].filter(Boolean).join(' · '))],
      });
    });
    await this.notify(org, supplierId, dto.decision === 'approve' ? 'اعتماد الحساب البنكي' : 'رفض الحساب البنكي',
      dto.decision === 'approve' ? [`اعتمدت الشركة حسابكم البنكي (${masked})، وستُحوّل إليه مستحقاتكم.`] : [`لم تعتمد الشركة الحساب البنكي (${masked}):`, dto.note!.trim()]);
    return this.get(org, supplierId);
  }

  async bankFile(org: string, supplierId: string, bankId: string) {
    const b = await this.db.getRepository(PrSupplierBank).findOne({ where: { id: bankId, supplierId, organizationId: org } });
    if (!b?.fileKey) throw new NotFoundException('لا يوجد مرفق');
    return { stream: this.files.open(b.fileKey), mime: b.fileMime ?? 'application/pdf', name: b.fileName ?? 'bank' };
  }

  // ---------------- حسابات البوابة ----------------

  async assertEmailFree(org: string, email: string, em: EntityManager = this.db.manager) {
    if (await em.getRepository(PrSupplierUser).exists({ where: { organizationId: org, email } })) {
      throw new ConflictException('البريد الإلكتروني مسجل لمستخدم آخر في بوابة الموردين');
    }
  }

  /** حساب بوابة لمورد سجّله الموظف: كلمة مرور مؤقتة تظهر مرة واحدة، ويغيّرها المورد عند أول دخول */
  async inviteUser(a: OrgUser, supplierId: string, dto: InviteUserDto) {
    const org = a.organizationId;
    const sup = await this.find(org, supplierId);
    if (sup.status === 'rejected') throw new ConflictException('المورد مرفوض');
    await this.assertEmailFree(org, dto.email);
    const password = tempPassword();
    const hasOwner = await this.db.getRepository(PrSupplierUser).exists({ where: { supplierId, role: 'owner', isActive: true } });
    await this.db.getRepository(PrSupplierUser).insert({
      organizationId: org, supplierId, fullName: dto.fullName, email: dto.email, phone: dto.phone || null, role: hasOwner ? dto.role ?? 'viewer' : 'owner',
      passwordHash: await bcrypt.hash(password, 12), mustChangePassword: true,
    });
    await this.db.getRepository(PrSupplier).update({ id: supplierId }, { log: [...sup.log, logEntry('إنشاء حساب في البوابة', a.fullName, dto.email)] });
    const url = await this.portalUrl(org);
    await this.mail.queue({
      to: dto.email, kind: 'supplier-invite', organizationId: org, sensitive: true, event: 'suppliers', createdBy: a.fullName,
      ...mailLayout({
        title: 'حسابكم في بوابة الموردين', greeting: `السلام عليكم ${dto.fullName}`,
        paragraphs: [`أنشأت ${a.organizationName ?? 'الشركة'} حسابًا لمنشأتكم «${sup.name}» في بوابة الموردين، لاستقبال طلبات العروض والتعميدات ورفع المستندات والفواتير.`],
        facts: [{ label: 'البريد للدخول', value: dto.email, ltr: true }, { label: 'كلمة المرور المؤقتة', value: password, ltr: true }],
        button: { label: 'الدخول للبوابة', url }, note: 'ستُطلب منكم كلمة مرور جديدة عند أول دخول.',
      }),
    });
    return { ...(await this.get(org, supplierId)), tempPassword: password, loginUrl: url };
  }

  async resetUser(a: OrgUser, supplierId: string, userId: string) {
    const org = a.organizationId;
    const sup = await this.find(org, supplierId);
    const u = await this.db.getRepository(PrSupplierUser).findOne({ where: { id: userId, supplierId, organizationId: org } });
    if (!u) throw new NotFoundException('المستخدم غير موجود');
    const password = tempPassword();
    await this.db.getRepository(PrSupplierUser).update({ id: userId }, {
      passwordHash: await bcrypt.hash(password, 12), mustChangePassword: true, sessionsValidAfter: new Date(), failedLogins: 0, lockedUntil: null, isActive: true,
    });
    await this.db.getRepository(PrSupplier).update({ id: supplierId }, { log: [...sup.log, logEntry('كلمة مرور مؤقتة لمستخدم البوابة', a.fullName, u.email)] });
    return { ...(await this.get(org, supplierId)), tempPassword: password, loginUrl: await this.portalUrl(org) };
  }

  async setUserActive(a: OrgUser, supplierId: string, userId: string, active: boolean) {
    const org = a.organizationId;
    const sup = await this.find(org, supplierId);
    const u = await this.db.getRepository(PrSupplierUser).findOne({ where: { id: userId, supplierId, organizationId: org } });
    if (!u) throw new NotFoundException('المستخدم غير موجود');
    await this.db.getRepository(PrSupplierUser).update({ id: userId }, { isActive: active, sessionsValidAfter: active ? u.sessionsValidAfter : new Date() });
    await this.db.getRepository(PrSupplier).update({ id: supplierId }, { log: [...sup.log, logEntry(active ? 'تفعيل مستخدم البوابة' : 'إيقاف مستخدم البوابة', a.fullName, u.email)] });
    return this.get(org, supplierId);
  }

  // ---------------- الإشعارات ----------------

  /** بريد لمدير حساب المورد (ومستخدمي المالية لما يخص البنوك لاحقًا) */
  async notify(org: string, supplierId: string, subject: string, paragraphs: string[]) {
    const users = await this.db.getRepository(PrSupplierUser).find({ where: { supplierId, isActive: true, role: 'owner' } });
    const sup = await this.find(org, supplierId);
    const to = [...users.map((u) => u.email), ...(users.length ? [] : [sup.email])];
    if (!to.filter(Boolean).length) return;
    const [o] = await this.db.query('SELECT name FROM organizations WHERE id = $1', [org]);
    await this.mail.queue({
      to, kind: 'supplier-notice', organizationId: org, event: 'suppliers',
      ...mailLayout({
        title: subject, subject: `${o?.name ?? 'الشركة'}: ${subject}`, greeting: `السلام عليكم ${sup.name}`, paragraphs,
        button: { label: 'فتح بوابة الموردين', url: await this.portalUrl(org) },
      }),
    }).catch((e) => this.logger.warn(`Supplier mail failed: ${(e as Error).message}`));
  }

  /** تنبيه الموردين قبل انتهاء مستنداتهم (مرة لكل مستند) */
  async sweep() {
    const rows: { id: string; organization_id: string; supplier_id: string; title: string; expiry_date: string; alert_days: number }[] = await this.db.query(
      `SELECT d.id, d.organization_id, d.supplier_id, d.title, d.expiry_date::text, COALESCE(st.doc_alert_days, 30) AS alert_days
         FROM pr_supplier_docs d JOIN pr_suppliers s ON s.id = d.supplier_id LEFT JOIN pr_settings st ON st.organization_id = d.organization_id
        WHERE d.is_current AND d.status = 'accepted' AND d.alerted_at IS NULL AND d.expiry_date IS NOT NULL
          AND s.status IN ('approved', 'suspended') AND d.expiry_date <= (CURRENT_DATE + COALESCE(st.doc_alert_days, 30))
        LIMIT 500`);
    for (const r of rows) {
      const expired = r.expiry_date < prToday();
      await this.notify(r.organization_id, r.supplier_id, expired ? `انتهى مستند: ${r.title}` : `قرب انتهاء مستند: ${r.title}`, [
        expired ? `انتهت صلاحية «${r.title}» بتاريخ ${r.expiry_date}.` : `تنتهي صلاحية «${r.title}» بتاريخ ${r.expiry_date}.`,
        'ارفعوا النسخة المجددة من البوابة حتى يستمر التعامل معكم دون توقف.',
      ]);
      await this.db.getRepository(PrSupplierDoc).update({ id: r.id }, { alertedAt: new Date() });
    }
    return rows.length;
  }

  /** للوحة: المستندات المنتهية أو القريبة من الانتهاء */
  async expiringDocs(org: string) {
    const s = await this.core.settings(org);
    const t = prToday();
    return this.db.query(
      `SELECT d.id, d.supplier_id AS "supplierId", s.name AS supplier, s.supplier_no AS "supplierNo", d.title, d.expiry_date::text AS "expiryDate", d.expiry_date < $2 AS expired
         FROM pr_supplier_docs d JOIN pr_suppliers s ON s.id = d.supplier_id
        WHERE d.organization_id = $1 AND d.is_current AND s.status IN ('approved', 'suspended', 'pending') AND d.expiry_date <= $3
        ORDER BY d.expiry_date LIMIT 100`, [org, t, addDays(t, s.docAlertDays)]);
  }

  /** طلبات الاعتماد: موردون بانتظار المراجعة، ومستندات بانتظار المراجعة، وحسابات بنكية بانتظار الاعتماد */
  async approvals(a: OrgUser) {
    const org = a.organizationId;
    await this.core.settings(org);
    const [suppliers, docs, banks] = await Promise.all([
      this.db.query(
        `SELECT s.id, s.supplier_no AS "supplierNo", s.name, s.source, s.submitted_at AS "submittedAt", s.entity_type AS "entityType", s.city,
                (SELECT COUNT(*)::int FROM pr_supplier_docs d WHERE d.supplier_id = s.id AND d.is_current AND d.status = 'pending') AS "docsPending"
           FROM pr_suppliers s WHERE s.organization_id = $1 AND s.status = 'pending' ORDER BY s.submitted_at`, [org]),
      this.db.query(
        `SELECT d.id, d.supplier_id AS "supplierId", s.name AS supplier, s.supplier_no AS "supplierNo", d.title, d.expiry_date::text AS "expiryDate", d.uploaded_via AS via, d.created_at AS "createdAt"
           FROM pr_supplier_docs d JOIN pr_suppliers s ON s.id = d.supplier_id
          WHERE d.organization_id = $1 AND d.is_current AND d.status = 'pending' AND s.status <> 'pending' AND s.status <> 'rejected' ORDER BY d.created_at`, [org]),
      this.db.query(
        `SELECT b.id, b.supplier_id AS "supplierId", s.name AS supplier, s.supplier_no AS "supplierNo", b.bank_name AS "bankName", b.iban, b.account_name AS "accountName",
                b.requested_via AS via, b.requested_by_name AS "requestedBy", b.requested_by_id = $2 AS mine, b.created_at AS "createdAt",
                EXISTS (SELECT 1 FROM pr_supplier_banks o WHERE o.supplier_id = b.supplier_id AND o.status = 'approved') AS "isChange"
           FROM pr_supplier_banks b JOIN pr_suppliers s ON s.id = b.supplier_id
          WHERE b.organization_id = $1 AND b.status = 'pending' ORDER BY b.created_at`, [org, a.id]),
    ]);
    const code = <T extends { supplierNo: number }>(r: T) => ({ ...r, code: supplierCode(r.supplierNo) });
    return { suppliers: suppliers.map(code), docs: docs.map(code), banks: banks.map(code) };
  }
}

export type { SupplierDocType };
