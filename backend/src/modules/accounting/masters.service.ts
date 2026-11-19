import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomBytes } from 'crypto';
import { DataSource, Repository } from 'typeorm';
import { OrgUser } from '../../core/auth/decorators';
import { AccCore, cents, fromCents } from './acc-core.service';
import { CashAccountDto, CategoryDto, DocumentTypeDto, PartnerDto, SettingsDto } from './accounting.dto';
import { AccountsService } from './accounts.service';
import { Account, AccountingSettings, DocumentType, JournalEntry, AccountNature, CashAccount, Partner, PartnerBehavior, PartnerCategory } from './entities/accounting.entity';

export const BEHAVIOR_AR: Record<PartnerBehavior, string> = { customer: 'عملاء', supplier: 'موردون', other: 'تصنيف آخر' };

/**
 * البيانات الأساسية: تصنيفات الشركاء ودليل العملاء والموردين، حسابات البنوك والنقدية، المستودعات،
 * وإعدادات النظام المالي.
 */
@Injectable()
export class MastersService {
  constructor(
    private readonly db: DataSource,
    private readonly core: AccCore,
    private readonly accounts: AccountsService,
    @InjectRepository(PartnerCategory) private readonly categories: Repository<PartnerCategory>,
    @InjectRepository(Partner) private readonly partners: Repository<Partner>,
    @InjectRepository(CashAccount) private readonly cash: Repository<CashAccount>,
  ) {}

  // ---------------- أنواع السندات الخاصة بالجمعية ----------------

  async listDocumentTypes(actor: OrgUser) {
    const rows = await this.core.documentTypes(actor.organizationId);
    const used: { voucher_type: string; n: number }[] = await this.db.query(
      'SELECT voucher_type, COUNT(*)::int AS n FROM acc_entries WHERE organization_id = $1 AND voucher_type LIKE $2 GROUP BY 1', [actor.organizationId, 'd\\_%']);
    return rows.map((d) => ({
      id: d.id, code: d.code, name: d.name, description: d.description, isActive: d.isActive, sortOrder: d.sortOrder,
      entries: used.find((u) => u.voucher_type === d.code)?.n ?? 0,
    }));
  }

  private async assertTypeName(org: string, name: string, exceptId?: string) {
    const builtin = ['قيد يومية', 'سند قبض', 'سند صرف', 'قيد افتتاحي', 'قيد تسوية'];
    if (builtin.includes(name)) throw new ConflictException('الاسم مستخدم لنوع أساسي في النظام');
    const dup = await this.db.getRepository(DocumentType).findOne({ where: { organizationId: org, name } });
    if (dup && dup.id !== exceptId) throw new ConflictException('يوجد نوع سند بنفس الاسم');
  }

  async createDocumentType(actor: OrgUser, dto: DocumentTypeDto) {
    const org = actor.organizationId;
    await this.assertTypeName(org, dto.name);
    const repo = this.db.getRepository(DocumentType);
    const max = await repo.maximum('sortOrder', { organizationId: org });
    await repo.save(repo.create({
      organizationId: org, code: `d_${randomBytes(5).toString('hex')}`, name: dto.name, description: dto.description ?? null,
      isActive: dto.isActive ?? true, sortOrder: (max ?? 0) + 1,
    }));
    return this.listDocumentTypes(actor);
  }

  async updateDocumentType(actor: OrgUser, id: string, dto: DocumentTypeDto) {
    const org = actor.organizationId;
    const repo = this.db.getRepository(DocumentType);
    const d = await repo.findOne({ where: { id, organizationId: org } });
    if (!d) throw new NotFoundException('نوع السند غير موجود');
    await this.assertTypeName(org, dto.name, id);
    await repo.update({ id }, { name: dto.name, description: dto.description ?? null, ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}) });
    return this.listDocumentTypes(actor);
  }

  /** الحذف قبل الاستخدام فقط، وبعده يُوقف النوع ليبقى تسلسله في السجلات ومحاضر الجرد */
  async removeDocumentType(actor: OrgUser, id: string) {
    const org = actor.organizationId;
    const repo = this.db.getRepository(DocumentType);
    const d = await repo.findOne({ where: { id, organizationId: org } });
    if (!d) throw new NotFoundException('نوع السند غير موجود');
    if (await this.db.getRepository(JournalEntry).exists({ where: { organizationId: org, voucherType: d.code } })) {
      throw new ConflictException('صدرت سندات من هذا النوع، فلا يُحذف. أوقفه بدلًا من ذلك');
    }
    await this.db.query('DELETE FROM acc_voucher_sequences WHERE organization_id = $1 AND voucher_type = $2', [org, d.code]);
    await repo.delete({ id });
  }

  // ---------------- الإعدادات ----------------

  async getSettings(actor: OrgUser) {
    const s = await this.core.settings(actor.organizationId);
    const closing = s.closingAccountId ? await this.db.getRepository(Account).findOne({ where: { id: s.closingAccountId } }) : null;
    return {
      analyticLevels: s.analyticLevels, warehouseTypes: s.warehouseTypes, chartInstalledAt: s.chartInstalledAt,
      closingAccount: closing ? { id: closing.id, code: closing.code, name: closing.name } : null,
      categories: await this.listCategories(actor),
    };
  }

  async saveSettings(actor: OrgUser, dto: SettingsDto) {
    const org = actor.organizationId;
    const s = await this.core.settings(org);
    if (dto.analyticLevels !== undefined) {
      await this.accounts.setAnalyticLevels(org, dto.analyticLevels);
      s.analyticLevels = dto.analyticLevels;
    }
    if (dto.closingAccountId !== undefined) {
      if (dto.closingAccountId) {
        const a = await this.accounts.postable(org, dto.closingAccountId);
        if (a.nature !== 'net_assets') throw new BadRequestException('حساب إقفال نتائج النشاط يجب أن يكون من حسابات صافي الأصول');
      }
      s.closingAccountId = dto.closingAccountId;
    }
    if (dto.warehouseTypes) {
      const types = [...new Set(dto.warehouseTypes.map((t) => t.trim()).filter(Boolean))];
      if (!types.length) throw new BadRequestException('أضف نوعًا واحدًا على الأقل للمستودعات');
      s.warehouseTypes = types;
    }
    await this.db.getRepository(AccountingSettings).save(s);
    return this.getSettings(actor);
  }

  // ---------------- تصنيفات الشركاء ----------------

  async listCategories(actor: OrgUser) {
    const org = actor.organizationId;
    if (!(await this.categories.exist({ where: { organizationId: org } }))) {
      await this.categories.save([
        this.categories.create({ organizationId: org, name: 'عملاء', behavior: 'customer', sortOrder: 1 }),
        this.categories.create({ organizationId: org, name: 'موردون', behavior: 'supplier', sortOrder: 2 }),
      ]);
    }
    const rows = await this.categories.find({ where: { organizationId: org }, order: { sortOrder: 'ASC', name: 'ASC' } });
    const counts = await this.db.query('SELECT category_id, COUNT(*)::int AS n FROM acc_partners WHERE organization_id = $1 GROUP BY 1', [org]);
    const n = new Map<string, number>(counts.map((c: { category_id: string; n: number }) => [c.category_id, c.n]));
    return rows.map((c) => ({ id: c.id, name: c.name, behavior: c.behavior, behaviorLabel: BEHAVIOR_AR[c.behavior], partners: n.get(c.id) ?? 0 }));
  }

  async createCategory(actor: OrgUser, dto: CategoryDto) {
    const org = actor.organizationId;
    if (await this.categories.exist({ where: { organizationId: org, name: dto.name } })) throw new ConflictException('يوجد تصنيف بنفس الاسم');
    const max = await this.categories.maximum('sortOrder', { organizationId: org });
    await this.categories.save(this.categories.create({ organizationId: org, name: dto.name, behavior: dto.behavior, sortOrder: (max ?? 0) + 1 }));
    return this.listCategories(actor);
  }

  async updateCategory(actor: OrgUser, id: string, dto: CategoryDto) {
    const c = await this.categories.findOne({ where: { id, organizationId: actor.organizationId } });
    if (!c) throw new NotFoundException('التصنيف غير موجود');
    if (dto.behavior !== c.behavior && (await this.partners.exist({ where: { categoryId: id } }))) {
      throw new ConflictException('لا يمكن تغيير نوع تصنيف عليه شركاء');
    }
    Object.assign(c, { name: dto.name, behavior: dto.behavior });
    await this.categories.save(c);
    return this.listCategories(actor);
  }

  async removeCategory(actor: OrgUser, id: string) {
    const c = await this.categories.findOne({ where: { id, organizationId: actor.organizationId } });
    if (!c) throw new NotFoundException('التصنيف غير موجود');
    if (await this.partners.exist({ where: { categoryId: id } })) throw new ConflictException('لا يمكن حذف تصنيف عليه شركاء');
    await this.categories.delete({ id });
    return this.listCategories(actor);
  }

  // ---------------- الشركاء ----------------

  private async balances(org: string, col: 'partner_id' | 'account_id') {
    const rows = await this.db.query(
      `SELECT l.${col} AS id, COALESCE(SUM(l.debit - l.credit), 0) AS bal FROM acc_entry_lines l JOIN acc_entries e ON e.id = l.entry_id
        WHERE l.organization_id = $1 AND e.status = 'posted' AND l.${col} IS NOT NULL GROUP BY 1`, [org]);
    return new Map<string, number>(rows.map((r: { id: string; bal: string }) => [r.id, cents(r.bal)]));
  }

  async listPartners(actor: OrgUser) {
    const org = actor.organizationId;
    await this.listCategories(actor);
    const [rows, bal] = await Promise.all([
      this.partners.find({ where: { organizationId: org }, relations: { category: true, account: true }, order: { partnerNo: 'ASC' } }),
      this.balances(org, 'partner_id'),
    ]);
    return rows.map((p) => this.partnerView(p, bal.get(p.id) ?? 0));
  }

  private partnerView(p: Partner, balance: number) {
    const behavior = p.category?.behavior ?? 'other';
    return {
      id: p.id, partnerNo: p.partnerNo, code: `P-${String(p.partnerNo).padStart(4, '0')}`, name: p.name, categoryId: p.categoryId,
      categoryName: p.category?.name ?? '', behavior, description: p.description, phones: p.phones, emails: p.emails, addresses: p.addresses,
      taxNumber: p.taxNumber, crNumber: p.crNumber, creditLimit: p.creditLimit, isActive: p.isActive,
      account: p.account ? { id: p.account.id, code: p.account.code, name: p.account.name } : null,
      balance: fromCents(balance),
      overLimit: behavior === 'customer' && p.creditLimit !== null && balance > cents(p.creditLimit),
    };
  }

  private async checkPartner(org: string, dto: PartnerDto) {
    const cat = await this.categories.findOne({ where: { id: dto.categoryId, organizationId: org } });
    if (!cat) throw new NotFoundException('تصنيف الشريك غير موجود');
    if (cat.behavior !== 'other' && !dto.accountId) {
      throw new BadRequestException(cat.behavior === 'customer' ? 'اربط العميل بحساب من حسابات المدينين' : 'اربط المورد بحساب من حسابات الدائنين');
    }
    if (dto.accountId) {
      const a = await this.accounts.postable(org, dto.accountId);
      const need: AccountNature | null = cat.behavior === 'customer' ? 'assets' : cat.behavior === 'supplier' ? 'liabilities' : null;
      if (need && a.nature !== need) {
        throw new BadRequestException(cat.behavior === 'customer' ? 'حساب العميل يجب أن يكون من حسابات المدينين (الأصول)' : 'حساب المورد يجب أن يكون من حسابات الدائنين (الخصوم)');
      }
    }
    return cat;
  }

  async createPartner(actor: OrgUser, dto: PartnerDto) {
    const org = actor.organizationId;
    const cat = await this.checkPartner(org, dto);
    return this.db.transaction(async (em) => {
      const [m] = await em.query('SELECT COALESCE(MAX(partner_no), 0) + 1 AS n FROM acc_partners WHERE organization_id = $1', [org]);
      const p = await em.getRepository(Partner).save(em.create(Partner, {
        organizationId: org, partnerNo: Number(m.n), ...this.partnerFields(dto, cat.behavior),
      }));
      return this.partnerView({ ...p, category: cat, account: null } as Partner, 0);
    });
  }

  private partnerFields(dto: PartnerDto, behavior: PartnerBehavior) {
    return {
      name: dto.name, categoryId: dto.categoryId, description: dto.description ?? null, phones: dto.phones ?? [], emails: dto.emails ?? [],
      addresses: (dto.addresses ?? []).map((a) => ({ label: a.label || 'العنوان', address: a.address, city: a.city ?? null })),
      taxNumber: dto.taxNumber ?? null, crNumber: dto.crNumber ?? null, accountId: dto.accountId ?? null,
      creditLimit: behavior === 'customer' ? dto.creditLimit ?? null : null, isActive: dto.isActive ?? true,
    };
  }

  async updatePartner(actor: OrgUser, id: string, dto: PartnerDto) {
    const org = actor.organizationId;
    const p = await this.partners.findOne({ where: { id, organizationId: org } });
    if (!p) throw new NotFoundException('الشريك غير موجود');
    const cat = await this.checkPartner(org, dto);
    Object.assign(p, this.partnerFields(dto, cat.behavior));
    await this.partners.save(p);
    return (await this.listPartners(actor)).find((x) => x.id === id);
  }

  // ---------------- البنوك والنقدية ----------------

  async listCash(actor: OrgUser) {
    const org = actor.organizationId;
    const [rows, bal] = await Promise.all([
      this.cash.find({ where: { organizationId: org }, relations: { glAccount: true }, order: { kind: 'ASC', createdAt: 'ASC' } }),
      this.balances(org, 'account_id'),
    ]);
    return rows.map((c) => ({
      id: c.id, kind: c.kind, name: c.name, bankName: c.bankName, accountNumber: c.accountNumber, iban: c.iban, description: c.description,
      isActive: c.isActive, glAccount: c.glAccount ? { id: c.glAccount.id, code: c.glAccount.code, name: c.glAccount.name } : null,
      balance: fromCents(bal.get(c.glAccountId) ?? 0),
    }));
  }

  private async checkGl(org: string, glAccountId: string, nature: AccountNature | null) {
    const a = await this.accounts.postable(org, glAccountId);
    if (nature && a.nature !== nature) throw new BadRequestException('الحساب المرتبط يجب أن يكون من حسابات الأصول');
    return a;
  }

  async createCash(actor: OrgUser, dto: CashAccountDto) {
    const org = actor.organizationId;
    if (dto.kind === 'bank' && (!dto.bankName || !dto.accountNumber)) throw new BadRequestException('اكتب اسم البنك ورقم الحساب البنكي');
    await this.checkGl(org, dto.glAccountId, 'assets');
    if (await this.cash.exist({ where: { organizationId: org, glAccountId: dto.glAccountId } })) {
      throw new ConflictException('هذا الحساب المحاسبي مرتبط ببنك أو صندوق آخر');
    }
    const c = await this.cash.save(this.cash.create({ organizationId: org, ...this.cashFields(dto) }));
    return (await this.listCash(actor)).find((x) => x.id === c.id)!;
  }

  private cashFields(dto: CashAccountDto) {
    const bank = dto.kind === 'bank';
    return {
      kind: dto.kind, name: dto.name, bankName: bank ? dto.bankName ?? null : null, accountNumber: bank ? dto.accountNumber ?? null : null,
      iban: bank ? dto.iban ?? null : null, description: dto.description ?? null, glAccountId: dto.glAccountId, isActive: dto.isActive ?? true,
    };
  }

  async updateCash(actor: OrgUser, id: string, dto: CashAccountDto) {
    const org = actor.organizationId;
    const c = await this.cash.findOne({ where: { id, organizationId: org } });
    if (!c) throw new NotFoundException('الحساب غير موجود');
    if (dto.kind === 'bank' && (!dto.bankName || !dto.accountNumber)) throw new BadRequestException('اكتب اسم البنك ورقم الحساب البنكي');
    if (dto.glAccountId !== c.glAccountId) {
      if (await this.accounts.hasMoves(org, c.glAccountId, undefined, false)) {
        throw new ConflictException('لا يمكن تعديل الحساب المحاسبي المرتبط بالبنك بعد التسجيل عليه، ويلزم تفريغ الحساب المحاسبي أولًا من كافة العمليات به');
      }
      await this.checkGl(org, dto.glAccountId, 'assets');
      if (await this.cash.exist({ where: { organizationId: org, glAccountId: dto.glAccountId } })) throw new ConflictException('هذا الحساب المحاسبي مرتبط ببنك أو صندوق آخر');
    }
    Object.assign(c, this.cashFields(dto));
    await this.cash.save(c);
    return (await this.listCash(actor)).find((x) => x.id === id);
  }

  /** الحسابات المحاسبية المرتبطة بالبنوك والصناديق (لسندات القبض والصرف) */
  async cashGlIds(org: string) {
    return new Set((await this.cash.find({ where: { organizationId: org }, select: ['glAccountId'] })).map((c) => c.glAccountId));
  }
}
