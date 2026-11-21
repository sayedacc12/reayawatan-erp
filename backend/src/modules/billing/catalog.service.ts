import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { OrgUser } from '../../core/auth/decorators';
import { MastersService } from '../accounting/masters.service';
import { AddressDto, CustomerDto, CustomerListQueryDto, ItemDto } from './billing.dto';
import { BillingCore, customerCode, diffNote, logEntry } from './billing-core.service';
import { BlCustomer, BlItem, CUSTOMER_KINDS, ID_TYPES, ITEM_KINDS, NationalAddress, VAT_CATEGORIES, VAT_REASONS } from './entities/billing.entity';

const CUSTOMER_LABELS: Record<string, string> = {
  kind: 'النوع', name: 'الاسم', nameEn: 'الاسم بالإنجليزية', vatNumber: 'الرقم الضريبي', idType: 'نوع المعرّف', idNumber: 'رقم المعرّف', address: 'العنوان الوطني',
  phone: 'الجوال', email: 'البريد', notes: 'الملاحظات', isActive: 'نشط',
};
const ITEM_LABELS: Record<string, string> = {
  code: 'الرمز', name: 'الاسم', nameEn: 'الاسم بالإنجليزية', kind: 'النوع', unit: 'الوحدة', price: 'السعر', vatCategory: 'الفئة الضريبية', reasonCode: 'سبب الإعفاء',
  revenueAccountId: 'حساب الإيراد', isActive: 'نشط',
};

export const cleanAddress = (a: AddressDto | null | undefined): NationalAddress | null => {
  if (!a) return null;
  const x: NationalAddress = {
    street: a.street ?? null, buildingNo: a.buildingNo ?? null, additionalNo: a.additionalNo ?? null, district: a.district ?? null,
    city: a.city ?? null, postalCode: a.postalCode ?? null, country: a.country ?? 'SA',
  };
  return Object.entries(x).some(([k, v]) => k !== 'country' && v) ? x : null;
};

/** سجل العملاء والأصناف والخدمات */
@Injectable()
export class CatalogService {
  constructor(private readonly db: DataSource, private readonly core: BillingCore, private readonly masters: MastersService) {}

  // ---------------- العملاء ----------------

  private view(c: BlCustomer, extra: Record<string, unknown> = {}) {
    return { ...c, code: customerCode(c.customerNo), kindLabel: CUSTOMER_KINDS[c.kind], idTypeLabel: c.idType ? ID_TYPES[c.idType] : null, ...extra };
  }

  async customers(org: string, q: CustomerListQueryDto) {
    const rows: (BlCustomer & { balance: number; docs: number })[] = await this.db.query(
      `SELECT c.id, c.customer_no AS "customerNo", c.kind, c.name, c.name_en AS "nameEn", c.vat_number AS "vatNumber", c.phone, c.email, c.is_active AS "isActive",
              c.address, c.partner_id AS "partnerId",
              COALESCE((SELECT SUM(CASE WHEN d.kind = 'credit_note' THEN -d.total ELSE d.total END) FROM bl_documents d
                         WHERE d.organization_id = $1 AND d.customer_id = c.id AND d.status IN ('issued', 'partial', 'paid')), 0)::float
              - COALESCE((SELECT SUM(d.paid_amount) FROM bl_documents d WHERE d.organization_id = $1 AND d.customer_id = c.id AND d.kind = 'invoice'), 0)::float AS balance,
              (SELECT COUNT(*)::int FROM bl_documents d WHERE d.organization_id = $1 AND d.customer_id = c.id AND d.status <> 'cancelled') AS docs
         FROM bl_customers c
        WHERE c.organization_id = $1 AND ($2::text IS NULL OR c.kind = $2) AND ($3::text IS NULL OR c.is_active = ($3 = 'active'))
          AND ($4::text IS NULL OR c.name ILIKE '%' || $4 || '%' OR c.vat_number LIKE '%' || $4 || '%' OR c.phone LIKE '%' || $4 || '%'
               OR ('CUS-' || LPAD(c.customer_no::text, 4, '0')) ILIKE '%' || $4 || '%')
        ORDER BY c.name LIMIT 1000`, [org, q.kind ?? null, q.status ?? null, q.q?.trim() || null]);
    return rows.map((c) => this.view(c, { balance: Math.round(c.balance * 100) / 100 }));
  }

  async customer(org: string, id: string, em: EntityManager = this.db.manager) {
    const c = await em.getRepository(BlCustomer).findOne({ where: { id, organizationId: org } });
    if (!c) throw new NotFoundException('العميل غير موجود');
    return c;
  }

  async getCustomer(org: string, id: string) {
    return this.view(await this.customer(org, id));
  }

  private async checkCustomer(org: string, dto: CustomerDto, exceptId: string | null) {
    if (dto.idType && !dto.idNumber) throw new BadRequestException('اكتب رقم المعرّف');
    if (dto.idNumber && !dto.idType) throw new BadRequestException('اختر نوع المعرّف');
    if (dto.kind === 'individual' && dto.vatNumber) throw new BadRequestException('الرقم الضريبي للمنشآت. اختر نوع العميل «منشأة»');
    if (dto.vatNumber) {
      const [d] = await this.db.query(
        'SELECT customer_no, name FROM bl_customers WHERE organization_id = $1 AND vat_number = $2 AND ($3::uuid IS NULL OR id <> $3::uuid) LIMIT 1', [org, dto.vatNumber, exceptId]);
      if (d) throw new ConflictException(`الرقم الضريبي مسجل للعميل ${customerCode(d.customer_no)} «${d.name}»`);
    }
  }

  async createCustomer(a: OrgUser, dto: CustomerDto) {
    const org = a.organizationId;
    await this.checkCustomer(org, dto, null);
    const id = await this.db.transaction(async (em) => {
      await em.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`bl_customers:${org}`]);
      const [{ n }] = await em.query('SELECT COALESCE(MAX(customer_no), 0)::int + 1 AS n FROM bl_customers WHERE organization_id = $1', [org]);
      const c = await em.getRepository(BlCustomer).save(em.create(BlCustomer, {
        organizationId: org, customerNo: n, ...this.fields(dto), isActive: dto.isActive ?? true, log: [logEntry('تسجيل العميل', a.fullName)],
      }));
      return c.id;
    });
    return this.getCustomer(org, id);
  }

  private fields(dto: CustomerDto) {
    return {
      kind: dto.kind, name: dto.name, nameEn: dto.nameEn ?? null, vatNumber: dto.vatNumber ?? null, idType: dto.idType ?? null, idNumber: dto.idNumber ?? null,
      address: cleanAddress(dto.address), phone: dto.phone ?? null, email: dto.email ?? null, notes: dto.notes ?? null,
    };
  }

  async updateCustomer(a: OrgUser, id: string, dto: CustomerDto) {
    const org = a.organizationId;
    const c = await this.customer(org, id);
    await this.checkCustomer(org, dto, id);
    const before = { ...c };
    Object.assign(c, this.fields(dto), { isActive: dto.isActive ?? c.isActive });
    c.log = [...c.log, logEntry('تعديل بيانات العميل', a.fullName, diffNote(before, c as never, CUSTOMER_LABELS))];
    await this.db.transaction(async (em) => {
      await em.getRepository(BlCustomer).save(c);
      // اسم الشريك المقابل في النظام المالي يتبع اسم العميل (عبر خدمة النظام المالي)
      if (c.partnerId) await this.masters.syncPartnerIdentity(org, c.partnerId, c.name, c.vatNumber, em);
    });
    return this.getCustomer(org, id);
  }

  /**
   * الشريك المقابل للعميل في النظام المالي (لتفصيل الذمم في كشوف الحساب): يُنشأ عند أول إصدار إن حُدد تصنيف العملاء في الإعدادات.
   * حسابه حساب الذمم في إعدادات الفوترة، فتبقى ذمم العملاء كلها على حساب رقابي واحد يُطابق مع الفوترة.
   */
  async ensurePartner(em: EntityManager, a: OrgUser, c: BlCustomer, categoryId: string | null, receivablesAccountId: string) {
    if (c.partnerId) {
      const [p] = await em.query('SELECT id, is_active FROM acc_partners WHERE id = $1 AND organization_id = $2', [c.partnerId, a.organizationId]);
      if (p?.is_active) return c.partnerId;
    }
    if (!categoryId) return null;
    const p = await this.masters.createPartner(a, {
      name: c.name, categoryId, description: `${customerCode(c.customerNo)} من سجل عملاء الفوترة`, phones: c.phone ? [c.phone] : [], emails: c.email ? [c.email] : [],
      addresses: c.address ? [{ label: 'العنوان الوطني', address: [c.address.street, c.address.buildingNo, c.address.district].filter(Boolean).join('، ') || '—', city: c.address.city }] : [],
      taxNumber: c.vatNumber, crNumber: c.idType === 'CRN' ? c.idNumber : null, accountId: receivablesAccountId, isActive: true,
    } as never);
    await em.getRepository(BlCustomer).update({ id: c.id }, { partnerId: p.id, log: [...c.log, logEntry('ربط العميل بالنظام المالي', a.fullName, `${p.code} ${p.name}`)] });
    c.partnerId = p.id;
    return p.id as string;
  }

  // ---------------- الأصناف والخدمات ----------------

  private itemView(i: BlItem, accounts: Map<string, { code: string; name: string }>) {
    return {
      ...i, kindLabel: ITEM_KINDS[i.kind], categoryLabel: VAT_CATEGORIES[i.vatCategory], reasonLabel: i.reasonCode ? VAT_REASONS[i.reasonCode]?.label ?? null : null,
      revenueAccount: i.revenueAccountId ? accounts.get(i.revenueAccountId) ?? null : null,
    };
  }

  async items(org: string, activeOnly = false) {
    const rows = await this.db.getRepository(BlItem).find({ where: activeOnly ? { organizationId: org, isActive: true } : { organizationId: org }, order: { code: 'ASC' } });
    const ids = [...new Set(rows.map((r) => r.revenueAccountId).filter(Boolean))] as string[];
    const accs: { id: string; code: string; name: string }[] = ids.length ? await this.db.query('SELECT id, code, name FROM acc_accounts WHERE organization_id = $1 AND id = ANY($2)', [org, ids]) : [];
    const m = new Map(accs.map((x) => [x.id, x]));
    return rows.map((i) => this.itemView(i, m));
  }

  async item(org: string, id: string, em: EntityManager = this.db.manager) {
    const i = await em.getRepository(BlItem).findOne({ where: { id, organizationId: org } });
    if (!i) throw new NotFoundException('الصنف غير موجود');
    return i;
  }

  private async checkItem(org: string, dto: ItemDto) {
    if (dto.vatCategory === 'S') dto.reasonCode = null;
    else if (!dto.reasonCode || VAT_REASONS[dto.reasonCode]?.category !== dto.vatCategory) {
      throw new BadRequestException(`اختر سبب «${VAT_CATEGORIES[dto.vatCategory]}» من قائمة الهيئة`);
    }
    await this.core.account(org, dto.revenueAccountId, 'revenue', 'حساب الإيراد');
  }

  async createItem(a: OrgUser, dto: ItemDto) {
    const org = a.organizationId;
    await this.checkItem(org, dto);
    const id = await this.db.transaction(async (em) => {
      await em.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`bl_items:${org}`]);
      let code = dto.code?.toUpperCase() ?? null;
      if (!code) {
        const [{ n }] = await em.query(`SELECT COUNT(*)::int + 1 AS n FROM bl_items WHERE organization_id = $1`, [org]);
        code = `${dto.kind === 'product' ? 'PRD' : 'SRV'}-${String(n).padStart(3, '0')}`;
        while (await em.getRepository(BlItem).exists({ where: { organizationId: org, code } })) code = `${code}-1`;
      } else if (await em.getRepository(BlItem).exists({ where: { organizationId: org, code } })) {
        throw new ConflictException(`الرمز ${code} مستخدم لصنف آخر`);
      }
      const fields = { ...this.itemFields(dto), code, isActive: dto.isActive ?? true };
      const i = await em.getRepository(BlItem).save(em.create(BlItem, {
        organizationId: org, ...fields, log: [logEntry('إضافة الصنف', a.fullName, diffNote({}, fields, ITEM_LABELS))],
      }));
      return i.id;
    });
    return (await this.items(org)).find((x) => x.id === id);
  }

  private itemFields(dto: ItemDto) {
    return {
      name: dto.name, nameEn: dto.nameEn ?? null, kind: dto.kind, unit: dto.unit ?? null, price: Math.round(dto.price * 100) / 100,
      vatCategory: dto.vatCategory, reasonCode: dto.reasonCode ?? null, revenueAccountId: dto.revenueAccountId ?? null,
    };
  }

  async updateItem(a: OrgUser, id: string, dto: ItemDto) {
    const org = a.organizationId;
    const i = await this.item(org, id);
    await this.checkItem(org, dto);
    const code = dto.code?.toUpperCase() || i.code;
    if (code !== i.code && await this.db.getRepository(BlItem).exists({ where: { organizationId: org, code } })) throw new ConflictException(`الرمز ${code} مستخدم لصنف آخر`);
    const before = { ...i };
    Object.assign(i, this.itemFields(dto), { code, isActive: dto.isActive ?? i.isActive });
    const note = diffNote(before, i as never, ITEM_LABELS);
    if (note) i.log = [...i.log, logEntry('تعديل الصنف', a.fullName, note)].slice(-200);
    await this.db.getRepository(BlItem).save(i);
    return (await this.items(org)).find((x) => x.id === id);
  }
}
