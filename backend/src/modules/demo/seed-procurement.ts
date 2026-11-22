import { Injectable } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { DataSource } from 'typeorm';
import { OrgUser } from '../../core/auth/decorators';
import { CatalogService } from '../procurement/catalog.service';
import { PrSettings, PrSupplierUser, SupplierStatus } from '../procurement/entities/procurement.entity';
import { ProcurementCore } from '../procurement/procurement-core.service';
import { SupplierDto } from '../procurement/procurement.dto';
import { SupplierPortalUser } from '../procurement/supplier-portal.guard';
import { SupplierPortalService } from '../procurement/supplier-portal.service';
import { SuppliersService, staffActor } from '../procurement/suppliers.service';
import { WarehousesService } from '../procurement/warehouses.service';
import { DemoTeam, daysAgo, daysAhead } from './demo-context';

/** ملف PDF صغير صالح يُرفق مكان المستندات الحقيقية */
const PDF = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF');
const file = (name: string) => ({ buffer: PDF, originalname: `${name}.pdf`, mimetype: 'application/pdf', size: PDF.length }) as Express.Multer.File;

export interface DemoSupplierLogin { supplier: string; status: string; fullName: string; email: string }

/**
 * المشتريات والمستودعات في الشركة التجريبية (المرحلة الأولى):
 * ربط المجموعات بحساباتها، ودليل أصناف ببدائل وصنف موقوف، ومستودعات بمواقعها،
 * وموردون في كل حالة: معتمد بحساب بنكي معتمد، ومستند قارب على الانتهاء، وطلب من البوابة بانتظار الاعتماد،
 * وطلب معاد للاستكمال، وتسجيل لم يكتمل، وطلب تغيير حساب بنكي بانتظار المالية.
 * تُنفَّذ عبر خدمات الوحدة نفسها كما لو نفذها الموظفون والموردون.
 */
@Injectable()
export class ProcurementSeed {
  constructor(
    private readonly db: DataSource, private readonly core: ProcurementCore, private readonly catalog: CatalogService,
    private readonly warehouses: WarehousesService, private readonly suppliers: SuppliersService, private readonly portal: SupplierPortalService,
  ) {}

  async run(team: DemoTeam, portalPassword: string) {
    const admin = team.admin;
    const org = admin.organizationId;
    // المالية تعتمد الحسابات البنكية التي يسجلها مدير النظام (فصل المهام)
    const finance: OrgUser = team.finance;
    const settings = await this.core.settings(org);

    // ---- الحسابات من الدليل الموحد (إن وُجدت) ----
    const acc = async (name: string) =>
      ((await this.db.query(`SELECT id FROM acc_accounts WHERE organization_id = $1 AND kind = 'sub' AND is_active AND name = $2 LIMIT 1`, [org, name]))[0]?.id ?? null) as string | null;
    const [payables] = await this.db.query(`SELECT id FROM acc_accounts WHERE organization_id = $1 AND kind = 'sub' AND code = '2130200101'`, [org]);
    const [category] = await this.db.query(`SELECT id FROM acc_partner_categories WHERE organization_id = $1 AND behavior = 'supplier' ORDER BY sort_order LIMIT 1`, [org]);
    await this.db.getRepository(PrSettings).update({ organizationId: org }, {
      payablesAccountId: payables?.id ?? null, partnerCategoryId: category?.id ?? null, docAlertDays: 30,
      portalIntro: 'نرحب بالموردين ومزودي الخدمات الراغبين في التعامل مع الشركة. سجّل منشأتك وارفع مستنداتك النظامية، وستصلك طلبات عروض الأسعار في مجال نشاطك.',
    });

    const charity = await acc('بضائع ومنتجات للتوزيع الخيري');
    const officeStock = await acc('مخزون مستلزمات مكتبية');
    const otherStock = await acc('مخزون مستهلكات أخرى');
    const foodBasket = await acc('مصاريف برامج وأنشطة ــ السلة الغذائية');
    const aidExpense = await acc('مصاريف برامج وأنشطة ــ مساعدات');
    const officeExpense = await acc('مستلزمات مكتبية');
    const hospitality = await acc('مصاريف الضيافة');
    const [assetGroup] = await this.db.query(`SELECT id FROM acc_asset_groups WHERE organization_id = $1 AND is_active ORDER BY sort_order, code LIMIT 1`, [org]).catch(() => []);

    const groups = await this.catalog.groups(org);
    const g = (code: string) => groups.find((x) => x.code === code)!;
    const setGroup = (code: string, patch: Record<string, unknown>) => {
      const x = g(code);
      return this.catalog.updateGroup(admin, x.id, {
        parentId: x.parentId, code: x.code, name: x.name, kind: x.kind, inventoryAccountId: x.inventoryAccountId, expenseAccountId: x.expenseAccountId,
        assetGroupId: x.assetGroupId, valuation: x.valuation, description: x.description, isActive: x.isActive, ...patch,
      } as never);
    };
    await setGroup('AID', { inventoryAccountId: charity, expenseAccountId: aidExpense });
    await setGroup('FOOD', { inventoryAccountId: charity, expenseAccountId: foodBasket ?? aidExpense });
    await setGroup('OFF', { inventoryAccountId: officeStock, expenseAccountId: officeExpense });
    await setGroup('CLN', { inventoryAccountId: otherStock, expenseAccountId: hospitality });
    if (assetGroup) await setGroup('FA', { assetGroupId: assetGroup.id });

    // ---- دليل الأصناف ----
    const uoms = await this.catalog.uoms(org);
    const u = (name: string) => uoms.find((x) => x.name === name)!.id;
    const item = (group: string, dto: Record<string, unknown>) =>
      this.catalog.createItem(admin, { groupId: g(group).id, uomId: u('حبة'), confirmSimilar: true, ...dto } as never);
    const rice = await item('FOOD', {
      name: 'أرز بسمتي كيس 10 كجم', uomId: u('كيس'), barcode: '6281000010101', refPrice: 85, trackBatch: true, trackExpiry: true, shelfLifeDays: 540, issuePolicy: 'fefo',
      minQty: 50, maxQty: 600, reorderPoint: 120, reorderQty: 300, units: [{ uomId: u('كرتون'), factor: 2, barcode: '6281000010118' }],
      specs: [{ name: 'النوع', value: 'بسمتي طويل الحبة' }, { name: 'بلد المنشأ', value: 'الهند' }],
    });
    const rice2 = await item('FOOD', { name: 'أرز مزة سيلا 5 كجم', uomId: u('كيس'), refPrice: 49, trackExpiry: true, shelfLifeDays: 540, issuePolicy: 'fefo', reorderPoint: 80 });
    await item('FOOD', { name: 'زيت دوار الشمس 1.5 لتر', uomId: u('علبة'), refPrice: 18.5, trackExpiry: true, shelfLifeDays: 365, issuePolicy: 'fefo', reorderPoint: 150, units: [{ uomId: u('كرتون'), factor: 6, barcode: null }] });
    await item('FOOD', { name: 'سكر أبيض ناعم 5 كجم', uomId: u('كيس'), refPrice: 22, trackExpiry: true, shelfLifeDays: 720, reorderPoint: 100 });
    await item('FOOD', { name: 'تمر سكري معبأ 3 كجم', uomId: u('علبة'), refPrice: 45, trackExpiry: true, shelfLifeDays: 365, issuePolicy: 'fefo', reorderPoint: 60 });
    const basket = await item('FOOD', {
      name: 'سلة غذائية متكاملة لأسرة', uomId: u('سلة'), refPrice: 350, reorderPoint: 40, reorderQty: 200, trackBatch: true,
      description: 'أرز وزيت وسكر وطحين ومعلبات وبقوليات تكفي أسرة من 5 أفراد لشهر', specs: [{ name: 'الوزن التقريبي', value: '35 كجم' }],
    });
    await item('CLTH', { name: 'بطانية شتوية مزدوجة', refPrice: 120, reorderPoint: 30, specs: [{ name: 'المقاس', value: '220 × 240 سم' }] });
    await item('CLTH', { name: 'كسوة عيد للأطفال', uomId: u('طقم'), refPrice: 150, description: 'طقم ملابس بمقاسات من 4 إلى 12 سنة' });
    await item('APPL', { name: 'ثلاجة منزلية 14 قدم', refPrice: 1650, trackSerial: true, specs: [{ name: 'السعة', value: '14 قدم' }, { name: 'الضمان', value: 'سنتان' }] });
    await item('APPL', { name: 'مكيف شباك 18 ألف وحدة', refPrice: 1350, trackSerial: true });
    await item('OFF', { name: 'ورق تصوير A4', uomId: u('رزمة'), refPrice: 19, reorderPoint: 20, units: [{ uomId: u('كرتون'), factor: 5, barcode: null }] });
    await item('OFF', { name: 'حبر طابعة ليزر أسود', refPrice: 240, reorderPoint: 4 });
    await item('CLN', { name: 'مناديل ورقية', uomId: u('كرتون'), refPrice: 55, reorderPoint: 10 });
    await item('CLN', { name: 'مياه شرب معبأة 330 مل', uomId: u('كرتون'), refPrice: 14, trackExpiry: true, shelfLifeDays: 365 });
    if (assetGroup) await item('FA', { name: 'حاسب محمول للموظفين', refPrice: 3800, trackSerial: true, specs: [{ name: 'المعالج', value: 'Core i5' }, { name: 'الذاكرة', value: '16 جيجا' }] });
    await item('SRV', { name: 'خدمة نقل وتوزيع السلال', uomId: u('خدمة'), refPrice: 900, description: 'نقل السلال من المستودع إلى نقاط التوزيع داخل المدينة' });
    await item('SRV', { name: 'صيانة أجهزة التكييف', uomId: u('ساعة'), refPrice: 120 });
    // بديل معتمد، وصنف قديم موقوف ببديله
    await this.catalog.addAlternative(admin, rice.id, { itemId: rice2.id, kind: 'alternative', note: 'عند عدم توفر البسمتي' });
    const oldBasket = await item('FOOD', { name: 'سلة رمضانية (النموذج السابق)', uomId: u('سلة'), refPrice: 280 });
    await this.catalog.addAlternative(admin, oldBasket.id, { itemId: basket.id, kind: 'equivalent', note: null });
    await this.catalog.stopItem(admin, oldBasket.id, { reason: 'استُبدلت بالسلة المتكاملة بعد تحديث مكوناتها', replacedById: basket.id });

    // ---- المستودعات ----
    const project = ((await this.db.query(
      `SELECT a.id FROM activities a JOIN project_profiles p ON p.activity_id = a.id WHERE a.organization_id = $1 ORDER BY p.project_no LIMIT 1`, [org]))[0]?.id ?? null) as string | null;
    const wh = (dto: Record<string, unknown>) => this.warehouses.create(admin, {
      kind: 'main', keeperIds: [admin.id], city: 'الرياض', isActive: true, ...dto,
    } as never);
    const main = await wh({ name: 'المستودع الرئيسي', address: 'حي السلي، شارع الخرج', capacity: '600 م² · 120 منصة', glAccountId: null });
    const loc = (w: { id: string }, code: string, name: string, kind: string, purpose: string) =>
      this.warehouses.createLocation(admin, w.id, { code, name, kind, purpose } as never);
    await loc(main, 'RCV', 'منطقة الاستلام والفحص', 'zone', 'receiving');
    await loc(main, 'A-01', 'الممر A - المواد الغذائية', 'aisle', 'storage');
    await loc(main, 'A-01-R1', 'الرف 1 - الأرز والسكر', 'rack', 'storage');
    await loc(main, 'B-01', 'الممر B - الكسوة والأجهزة', 'aisle', 'storage');
    await loc(main, 'QRN', 'منطقة العزل', 'zone', 'quarantine');
    await loc(main, 'DMG', 'التالف', 'zone', 'damaged');
    await loc(main, 'RTN', 'المرتجعات', 'zone', 'returns');
    const office = await wh({ name: 'مستودع المقر (القرطاسية والضيافة)', kind: 'sub', parentId: main.id, capacity: 'غرفة 20 م²' });
    await loc(office, 'S-01', 'خزانة القرطاسية', 'shelf', 'storage');
    if (project) await wh({ name: 'المستودع الميداني لمشروع الحي', kind: 'field', parentId: main.id, projectId: project, city: 'الخرج' });

    // ---- الموردون ----
    const base: Partial<SupplierDto> = { entityType: 'company', supplierKind: 'supplier', contacts: [], branches: [], categoryIds: [] };
    const cats = (await this.core.lookups(org)).categories;
    const cat = (prefix: string) => cats.filter((c) => c.name.startsWith(prefix)).map((c) => c.id);
    const staffDocs = async (id: string, docs: [string, string | null][]) => {
      for (const [docType, expiry] of docs) {
        await this.suppliers.addDoc(org, id, { docType, number: null, issueDate: daysAgo(200), expiryDate: expiry } as never, file(docType), staffActor(admin));
      }
    };
    const acceptAll = async (id: string) => {
      const sup = await this.suppliers.get(org, id);
      for (const d of sup.docs.filter((x) => x.isCurrent && x.status === 'pending')) await this.suppliers.reviewDoc(admin, id, d.id, { decision: 'accept', note: null });
    };
    const bank = async (id: string, bankName: string, iban: string, accountName: string, approve: boolean) => {
      await this.suppliers.addBank(org, id, { bankName, iban, accountName }, file('bank-letter'), staffActor(admin));
      if (!approve) return;
      const b = (await this.suppliers.get(org, id)).banks.find((x) => x.status === 'pending')!;
      await this.suppliers.decideBank(finance, id, b.id, { decision: 'approve', note: 'طوبق الاسم مع خطاب البنك' });
    };

    // 1) مورد معتمد بالكامل: مستنداته مقبولة وحسابه البنكي معتمد ومرتبط بالمالي
    const wafa = await this.suppliers.create(admin, {
      ...base, name: 'شركة الوفاء للتموين الغذائي', nameEn: 'Al Wafa Food Supply Co.', crNumber: '1010567890', crExpiry: daysAhead(400), vatNumber: '310456789000003',
      city: 'الرياض', address: 'حي العزيزية، طريق الخرج', phone: '0114567890', activities: ['مواد غذائية', 'سلال غذائية وكسوة'], categoryIds: cat('موردو مواد غذائية'),
      about: 'توريد المواد الغذائية والسلال الرمضانية للجمعيات منذ 2012', contacts: [{ name: 'خالد العتيبي', title: 'مدير المبيعات', phone: '0551234567', email: null, authorized: true }],
      branches: [{ name: 'فرع الخرج', city: 'الخرج', address: null, phone: null }],
    } as SupplierDto);
    await staffDocs(wafa.id, [['cr', daysAhead(400)], ['vat', null], ['zakat', daysAhead(150)], ['gosi', daysAhead(90)], ['address', null]]);
    await acceptAll(wafa.id);
    await this.suppliers.decide(admin, wafa.id, { decision: 'approve', note: null });
    await bank(wafa.id, 'مصرف الراجحي', 'SA0380000000608010167519', 'شركة الوفاء للتموين الغذائي', true);

    // 2) مورد معتمد شهادة زكاته تنتهي خلال 20 يومًا (تظهر في التنبيهات)، وطلب تغيير حسابه البنكي بانتظار المالية
    const dafa = await this.suppliers.create(admin, {
      ...base, name: 'مؤسسة الدفء للملابس والمفروشات', entityType: 'establishment', crNumber: '1010678901', vatNumber: '310567890100003',
      city: 'الرياض', phone: '0112223344', activities: ['سلال غذائية وكسوة', 'أثاث ومفروشات'], categoryIds: cat('موردو مواد غذائية'),
    } as SupplierDto);
    await staffDocs(dafa.id, [['cr', daysAhead(300)], ['zakat', daysAhead(20)], ['address', null]]);
    await acceptAll(dafa.id);
    await this.suppliers.decide(admin, dafa.id, { decision: 'approve', note: 'معتمد لتوريد البطانيات وكسوة العيد' });
    await bank(dafa.id, 'البنك الأهلي السعودي', 'SA4420000001234567891234', 'مؤسسة الدفء للملابس والمفروشات', true);
    await bank(dafa.id, 'بنك الرياض', 'SA4210000001234567890123', 'مؤسسة الدفء للملابس والمفروشات', false);

    // 3) مزود خدمة فرد (عمل حر) معتمد
    const naql = await this.suppliers.create(admin, {
      ...base, name: 'فهد سعد الشمري (نقل وتوصيل)', entityType: 'individual', supplierKind: 'service_provider', nationalId: '1023456789',
      city: 'الرياض', phone: '0559988776', activities: ['نقل وخدمات لوجستية'], categoryIds: cat('خدمات عامة'),
    } as SupplierDto);
    await staffDocs(naql.id, [['id', daysAhead(900)], ['freelance', daysAhead(200)], ['address', null]]);
    await acceptAll(naql.id);
    await this.suppliers.decide(admin, naql.id, { decision: 'approve', note: null });

    // ---- موردون سجلوا من البوابة ----
    const logins: DemoSupplierLogin[] = [];
    const register = async (key: string, owner: string, dto: Partial<SupplierDto>) => {
      const email = team.email(`supplier-${key}`);
      await this.portal.register(team.slug, { ...base, ...dto, ownerName: owner, ownerEmail: email, ownerPhone: '0501112233', password: portalPassword } as never, null);
      const [row] = await this.db.query('SELECT id, supplier_id FROM pr_supplier_users WHERE organization_id = $1 AND email = $2', [org, email]);
      logins.push({ supplier: dto.name!, status: '', fullName: owner, email });
      const p: SupplierPortalUser = {
        userId: row.id, supplierId: row.supplier_id, organizationId: org, fullName: owner, email, role: 'owner', supplierStatus: 'draft', mustChangePassword: false,
      };
      return p;
    };
    const portalDocs = async (p: SupplierPortalUser, docs: [string, string | null][]) => {
      for (const [docType, expiry] of docs) await this.portal.addDoc(p, { docType, number: null, issueDate: daysAgo(100), expiryDate: expiry } as never, file(docType));
    };

    // التسجيل الذاتي من البوابة (يُتخطى إن أغلقت الشركة البوابة)
    if (settings.portalOpen) {
      // 4) طلب مكتمل من البوابة بانتظار الاعتماد
      const naqaa = await register('naqaa', 'نورة الدوسري', {
        name: 'شركة النقاء لمواد النظافة', crNumber: '2050123456', vatNumber: '310678901200003', city: 'الدمام', phone: '0138887777',
        activities: ['نظافة وتعقيم'], categoryIds: cat('خدمات عامة'), about: 'مواد النظافة والتعقيم للمنشآت',
      });
      await portalDocs(naqaa, [['cr', daysAhead(250)], ['zakat', daysAhead(120)], ['address', null], ['license', daysAhead(60)]]);
      await this.portal.submit(naqaa);

      // 5) طلب أعادته الشركة للاستكمال
      const tech = await register('tech', 'ماجد الحربي', {
        name: 'مؤسسة التقنية الحديثة', entityType: 'establishment', crNumber: '1010789012', city: 'الرياض', phone: '0114443322',
        activities: ['أجهزة حاسب وتقنية'], categoryIds: cat('موردو أجهزة'),
      });
      await portalDocs(tech, [['cr', daysAhead(180)], ['zakat', daysAhead(45)], ['address', null]]);
      await this.portal.submit(tech);
      const techDocs = (await this.suppliers.get(org, tech.supplierId)).docs;
      await this.suppliers.reviewDoc(admin, tech.supplierId, techDocs.find((d) => d.docType === 'zakat')!.id, { decision: 'reject', note: 'الشهادة لا تخص المنشأة نفسها' });
      await this.suppliers.decide(admin, tech.supplierId, { decision: 'return', note: 'ارفعوا شهادة الزكاة باسم المؤسسة، وأضيفوا الرقم الضريبي' });

      // 6) تسجيل بدأ ولم يكتمل
      await register('binaa', 'عبدالله القرني', {
        name: 'شركة البناء المتين للمقاولات', city: 'الرياض', activities: ['مقاولات وترميم', 'صيانة وتشغيل'], supplierKind: 'service_provider', categoryIds: cat('مقاولات'),
      });
    }

    // حساب بوابة لمورد معتمد سجّله الموظف، بكلمة مرور البوابة التجريبية
    const wafaEmail = team.email('supplier-wafa');
    await this.db.getRepository(PrSupplierUser).insert({
      organizationId: org, supplierId: wafa.id, fullName: 'خالد العتيبي', email: wafaEmail, phone: '0551234567', role: 'owner',
      passwordHash: await bcrypt.hash(portalPassword, 10), mustChangePassword: false,
    });
    logins.unshift({ supplier: wafa.name, status: '', fullName: 'خالد العتيبي', email: wafaEmail });

    const statuses: { email: string; status: SupplierStatus }[] = await this.db.query(
      'SELECT u.email, s.status FROM pr_supplier_users u JOIN pr_suppliers s ON s.id = u.supplier_id WHERE u.organization_id = $1', [org]);
    const label = { draft: 'تسجيل غير مكتمل', pending: 'بانتظار الاعتماد', returned: 'معاد للاستكمال', approved: 'معتمد', rejected: 'مرفوض', suspended: 'موقوف' };
    for (const l of logins) l.status = label[statuses.find((x) => x.email === l.email)?.status ?? 'draft'];
    return { url: await this.suppliers.portalUrl(org), users: logins };
  }
}
